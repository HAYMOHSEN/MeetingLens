[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$sampleRoot = Join-Path $PSScriptRoot 'vendor/Samples/VirtualCamera'
$packageRoot = Join-Path $sampleRoot 'packages'
if (-not (Get-Command msbuild -ErrorAction SilentlyContinue)) { throw 'Run from a Visual Studio developer shell with C++ desktop tools and Windows SDK 10.0.26100.' }
if (-not (Get-Command nuget -ErrorAction SilentlyContinue)) { throw 'Install NuGet CLI (nuget.exe) and add it to PATH.' }

# Build the real upstream source DLL and its real installer/test console. No placeholder CLSID.
# Build neither the MSI nor the optional WinUI manager in this headless build step.
foreach ($projectName in @('VirtualCameraMediaSource', 'VirtualCamera_Installer')) {
    $projectDirectory = Join-Path $sampleRoot $projectName
    & nuget restore (Join-Path $projectDirectory 'packages.config') -PackagesDirectory $packageRoot -NonInteractive
    if ($LASTEXITCODE -ne 0) { throw "NuGet restore failed: $projectName" }
    $project = Join-Path $projectDirectory "$projectName.vcxproj"
    & msbuild $project /m "/p:Configuration=$Configuration" /p:Platform=x64 "/p:SolutionDir=$sampleRoot\" /p:WindowsTargetPlatformVersion=10.0.26100.0
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $projectName" }
}
Write-Output "Upstream reference built in $sampleRoot/x64/$Configuration."
Write-Output 'The result is an upstream reference, not an installed MeetingLens virtual camera.'
