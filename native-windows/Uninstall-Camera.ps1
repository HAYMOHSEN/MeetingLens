#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell.' }
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'MeetingLens Camera'
$clsid = '{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}'
$registryPath = "SOFTWARE\Classes\CLSID\$clsid"
if (Get-Process -Name 'MeetingLens.Camera' -ErrorAction SilentlyContinue) { throw 'Close MeetingLens Camera and meeting apps first. No process was stopped.' }
$markerPath = Join-Path $installRoot 'meetinglens-install.json'
if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'No owned MeetingLens Camera installation marker found. Nothing was removed.' }
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
if ($marker.schema -ne 'meetinglens.camera.install.v1' -or $marker.providerClsid -ne $clsid -or $marker.installPath -ne $installRoot -or $marker.providerFile -ne 'MeetingLens.VirtualCamera.dll') {
    throw 'The installation marker does not match this installer. Nothing was removed.'
}
$providerPath = Join-Path $installRoot $marker.providerFile
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
try {
    $server = $machine.OpenSubKey("$registryPath\InprocServer32")
    if ($null -ne $server) {
        try { $registeredPath = [string]$server.GetValue('') } finally { $server.Dispose() }
        if (-not [string]::Equals($registeredPath, $providerPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'The CLSID belongs to a different path. Its registration and all files were left unchanged.' }
    } elseif ($null -ne ($otherKey = $machine.OpenSubKey($registryPath))) {
        $otherKey.Dispose()
        throw 'The CLSID has an unexpected registration. Nothing was removed.'
    }
    # If Frame Server or another camera client still has our provider loaded,
    # leave the installation intact and ask the user to close clients/reboot.
    if (Test-Path -LiteralPath $providerPath) {
        try { $lock = [IO.File]::Open($providerPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); $lock.Dispose() }
        catch { throw 'The camera provider is still in use. Close Teams, Zoom, Camera and MeetingLens, or restart Windows, then uninstall again. Nothing was removed.' }
    }
    # Rename first, before touching registration. This avoids a half-uninstall
    # when another app opens the DLL or permissions prevent moving the folder.
    $removedRoot = "$installRoot.removing-$([Guid]::NewGuid().ToString('N'))"
    Move-Item -LiteralPath $installRoot -Destination $removedRoot
    try {
        $machine.DeleteSubKeyTree($registryPath, $false)
    } catch {
        Move-Item -LiteralPath $removedRoot -Destination $installRoot
        throw
    }
    try { Remove-Item -LiteralPath $removedRoot -Recurse -Force }
    catch { Write-Warning "Registration was removed. Some locked files remain at $removedRoot; remove that exact folder after restarting Windows." }
    Write-Output 'MeetingLens Camera was uninstalled. Your browser/PWA settings and other cameras were not changed.'
} finally { $machine.Dispose() }
