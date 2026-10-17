#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$AppDirectory = (Join-Path $PSScriptRoot 'artifacts/MeetingLens-Camera-win-x64/app'),
    [string]$ReportDirectory = (Join-Path $PSScriptRoot 'artifacts/camera-validation'),
    [switch]$RegisterProviderForTest,
    [switch]$TestCameraEnumeration
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Validation requires 64-bit Windows PowerShell.' }
$AppDirectory = [IO.Path]::GetFullPath($AppDirectory)
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -Path $ReportDirectory -ItemType Directory -Force | Out-Null
$exe = Join-Path $AppDirectory 'MeetingLens.Camera.exe'
$providerPath = Join-Path $AppDirectory 'MeetingLens.VirtualCamera.dll'
foreach ($file in @($exe, $providerPath, (Join-Path $AppDirectory 'web/index.html'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required build file is missing: $file" }
}
function Invoke-CameraCheck([string]$Argument, [string]$Name) {
    $stdout = Join-Path $ReportDirectory "$Name.stdout.txt"
    $stderr = Join-Path $ReportDirectory "$Name.stderr.txt"
    $result = [ordered]@{ check = $Name; passed = $false; exitCode = $null; error = $null }
    try {
        $process = Start-Process -FilePath $exe -ArgumentList $Argument -WorkingDirectory $ReportDirectory -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $process.WaitForExit(60000)) { $process.Kill(); $process.WaitForExit(); throw "$Name timed out after 60 seconds." }
        $result.exitCode = $process.ExitCode
        if ($process.ExitCode -ne 0) { throw "$Name failed (exit $($process.ExitCode)). See $stdout and $stderr." }
        $result.passed = $true
    } catch { $result.error = $_.Exception.Message }
    $script:checks += $result
    if (-not $result.passed) { throw $result.error }
}
$checks = @()
$clsid = '{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}'
$registryPath = "SOFTWARE\Classes\CLSID\$clsid"
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
$createdRegistry = $false
$validationError = $null
try {
    Invoke-CameraCheck '--self-test' 'protocol-self-test'
    if ($RegisterProviderForTest) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'RegisterProviderForTest requires an administrator shell; it never elevates automatically.' }
        $existing = $machine.OpenSubKey($registryPath)
        if ($null -ne $existing) { $existing.Dispose(); throw 'The test CLSID is already registered. Validation will not overwrite it.' }
        $key = $machine.CreateSubKey($registryPath, $true)
        $createdRegistry = $true
        try {
            $key.SetValue('', 'MeetingLens Virtual Camera validation', [Microsoft.Win32.RegistryValueKind]::String)
            $server = $key.CreateSubKey('InprocServer32', $true)
            try {
                $server.SetValue('', $providerPath, [Microsoft.Win32.RegistryValueKind]::String)
                $server.SetValue('ThreadingModel', 'Both', [Microsoft.Win32.RegistryValueKind]::String)
            } finally { $server.Dispose() }
        } finally { $key.Dispose() }
    }
    Invoke-CameraCheck '--provider-smoke-test' 'provider-com-activation'
    if ($TestCameraEnumeration) { Invoke-CameraCheck '--camera-smoke-test' 'session-camera-enumeration' }
    Write-Output 'Protocol and COM validation passed. The report lists whether session-camera enumeration was requested. Physical webcam and meeting-app acceptance remain separate tests.'
} catch {
    $validationError = $_.Exception.Message
    throw
} finally {
    try {
        if ($createdRegistry) { $machine.DeleteSubKeyTree($registryPath, $false) }
    } catch {
        $validationError = "Test registration cleanup failed: $($_.Exception.Message)"
        throw
    } finally {
        $machine.Dispose()
        [ordered]@{
        schema = 'meetinglens.camera.validation.v1'
        generatedUtc = [DateTime]::UtcNow.ToString('O')
        windowsVersion = [Environment]::OSVersion.Version.ToString()
        architecture = $env:PROCESSOR_ARCHITECTURE
        passed = ($null -eq $validationError)
        error = $validationError
        checks = $checks
        physicalWebcamTested = $false
        teamsTested = $false
        zoomTested = $false
        signedPackageTested = $false
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ReportDirectory 'camera-validation.json') -Encoding UTF8
    }
}
