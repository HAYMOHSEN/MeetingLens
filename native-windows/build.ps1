[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64',
    [switch]$SkipDirectShow,
    [switch]$BuildVirtualCameraReference
)
$ErrorActionPreference = 'Stop'
$nativeRoot = $PSScriptRoot
$artifactRoot = Join-Path $nativeRoot 'artifacts'
$controlsOutput = Join-Path $artifactRoot "controls-$Architecture"
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'Install the .NET 8 SDK before building.' }
& dotnet publish (Join-Path $nativeRoot 'MeetingLens.Windows/MeetingLens.Windows.csproj') `
    --configuration Release --runtime "win-$Architecture" --self-contained true --output $controlsOutput
if ($LASTEXITCODE -ne 0) { throw 'MeetingLens.Windows publish failed.' }

if (-not $SkipDirectShow) {
    if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { throw 'Install CMake and Visual Studio C++ desktop build tools.' }
    $cmakeArchitecture = if ($Architecture -eq 'arm64') { 'ARM64' } else { 'x64' }
    $directShowBuild = Join-Path $artifactRoot "basic-camera-$Architecture"
    & cmake -S (Join-Path $nativeRoot 'BasicCamera') -B $directShowBuild -A $cmakeArchitecture
    if ($LASTEXITCODE -ne 0) { throw 'DirectShow CMake configure failed.' }
    & cmake --build $directShowBuild --config Release
    if ($LASTEXITCODE -ne 0) { throw 'DirectShow build failed.' }
    Copy-Item (Join-Path $directShowBuild 'Release/MeetingLens.BasicCamera.exe') $controlsOutput -Force
}

if ($BuildVirtualCameraReference) {
    if ($Architecture -ne 'x64') { throw 'The pinned upstream installer reference is validated by this script only for x64.' }
    & (Join-Path $nativeRoot 'build-virtual-camera-reference.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Upstream virtual camera reference build failed.' }
}

Write-Output "Build complete: $artifactRoot"
Write-Output 'Building does not install a camera, change settings, register COM classes, or launch a microphone.'
