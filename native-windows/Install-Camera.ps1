#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This installer deliberately does not elevate itself, alter execution policy,
# download code, kill applications, or replace an existing installation.
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
    throw 'Use 64-bit PowerShell on an x64 Windows PC.'
}
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This package supports native x64 Windows only; x64 emulation on ARM64 cannot load this provider into Camera Frame Server.' }
if ([Environment]::OSVersion.Version.Build -lt 22621) { throw 'Windows 11 22H2 (build 22621) or later is required.' }
if (Get-Process -Name 'MeetingLens.Camera' -ErrorAction SilentlyContinue) {
    throw 'Close MeetingLens Camera before installation. No process was stopped.'
}
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'MeetingLens Camera'
$clsid = '{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}'
$registryPath = "SOFTWARE\Classes\CLSID\$clsid"
$manifestPath = Join-Path $packageRoot 'package-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Missing package-manifest.json. Extract the complete release ZIP first.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'meetinglens.camera.package.v1' -or $manifest.architecture -ne 'x64' -or $manifest.providerClsid -ne $clsid) {
    throw 'The package manifest is not a supported MeetingLens Camera x64 package.'
}
$providerFile = [string]$manifest.providerFile
if ($providerFile -ne 'MeetingLens.VirtualCamera.dll') { throw 'Unexpected provider filename.' }
if (Test-Path -LiteralPath $installRoot) { throw "Installation already exists at $installRoot. Close meeting apps and uninstall it first; existing files were not changed." }
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
$existing = $machine.OpenSubKey($registryPath)
if ($null -ne $existing) { $existing.Dispose(); $machine.Dispose(); throw "The provider CLSID $clsid is already registered. Uninstall the existing provider first; its registration was not changed." }

$seen = @{}
foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ([string]::IsNullOrWhiteSpace($relative) -or $relative.Contains('\') -or [IO.Path]::IsPathRooted($relative) -or $relative.Split('/') -contains '..' -or $relative.Split('/') -contains '.' -or $relative.Contains(':')) {
        throw "Unsafe manifest path: $relative"
    }
    if ($seen.ContainsKey($relative)) { throw "Duplicate manifest path: $relative" }
    $seen[$relative] = $true
    $filePath = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    if (-not $filePath.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes package: $relative" }
    $item = Get-Item -LiteralPath $filePath
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Expected a regular file: $relative" }
    if ($item.Length -ne [long]$entry.size -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne [string]$entry.sha256) { throw "Package checksum failed: $relative" }
}
foreach ($required in @('app/MeetingLens.Camera.exe', "app/$providerFile", 'app/web/index.html', 'Uninstall-Camera.ps1', 'CAMERA-INSTALL.md')) {
    if (-not $seen.ContainsKey($required)) { throw "Missing required manifest entry: $required" }
}
# Reject extra app files and directory junctions as well as missing/changed files.
if ((Get-Item -LiteralPath (Join-Path $packageRoot 'app')).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The app directory cannot be a symbolic link or junction.' }
foreach ($item in Get-ChildItem -LiteralPath (Join-Path $packageRoot 'app') -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains a symbolic link or junction.' }
    if (-not $item.PSIsContainer) {
        $relative = $item.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
        if (-not $seen.ContainsKey($relative)) { throw "Unlisted app file: $relative" }
    }
}

$createdDirectory = $false
$createdRegistry = $false
try {
    # Copying to Program Files gives ordinary users read/execute access and keeps
    # the COM DLL out of user-writable download folders.
    New-Item -Path $installRoot -ItemType Directory | Out-Null
    $createdDirectory = $true
    Copy-Item -Path (Join-Path $packageRoot 'app/*') -Destination $installRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $packageRoot 'Uninstall-Camera.ps1') -Destination $installRoot
    Copy-Item -LiteralPath (Join-Path $packageRoot 'CAMERA-INSTALL.md') -Destination $installRoot
    $providerPath = Join-Path $installRoot $providerFile
    $key = $machine.CreateSubKey($registryPath, $true)
    $createdRegistry = $true
    try {
        $key.SetValue('', 'MeetingLens Virtual Camera', [Microsoft.Win32.RegistryValueKind]::String)
        $server = $key.CreateSubKey('InprocServer32', $true)
        try {
            $server.SetValue('', $providerPath, [Microsoft.Win32.RegistryValueKind]::String)
            $server.SetValue('ThreadingModel', 'Both', [Microsoft.Win32.RegistryValueKind]::String)
        } finally { $server.Dispose() }
    } finally { $key.Dispose() }
    [ordered]@{
        schema = 'meetinglens.camera.install.v1'
        version = [string]$manifest.version
        providerClsid = $clsid
        providerFile = $providerFile
        installPath = $installRoot
        installedUtc = [DateTime]::UtcNow.ToString('O')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'meetinglens-install.json') -Encoding UTF8
    Write-Output "Installed MeetingLens Camera $($manifest.version) at $installRoot."
    Write-Output 'Launch MeetingLens.Camera.exe as your normal user, allow camera access, and press Start virtual camera. No camera has been started by this installer.'
    Write-Output 'Install the Microsoft Edge WebView2 Evergreen Runtime if the app reports it is missing. This unsigned test package is not a Store installer.'
} catch {
    $originalError = $_
    if ($createdRegistry) {
        # This key was absent before the install and belongs only to this provider.
        try { $machine.DeleteSubKeyTree($registryPath, $false) } catch { Write-Warning 'Rollback could not remove the newly created provider registration.' }
    }
    if ($createdDirectory) {
        try { Remove-Item -LiteralPath $installRoot -Recurse -Force } catch { Write-Warning "Rollback could not remove $installRoot. No existing installation was overwritten." }
    }
    throw $originalError
} finally { $machine.Dispose() }
