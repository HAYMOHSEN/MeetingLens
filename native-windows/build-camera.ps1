#requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Build this Windows x64 package on Windows with Visual Studio 2022 C++ tools.' }
foreach ($tool in @('dotnet', 'msbuild', 'nuget')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool. Install the build requirements listed in CAMERA-INSTALL.md." }
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = [string](Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'package.json must contain a numeric three-part release version.' }
$artifacts = Join-Path $PSScriptRoot 'artifacts'
$publishRoot = Join-Path $artifacts 'camera-host-x64'
$providerRoot = Join-Path $artifacts 'camera-provider-x64'
$providerTestRoot = Join-Path $artifacts 'camera-provider-tests-x64'
$packageRoot = Join-Path $artifacts 'MeetingLens-Camera-win-x64'
foreach ($output in @($publishRoot, $providerRoot, $providerTestRoot, $packageRoot)) {
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
    New-Item -Path $output -ItemType Directory -Force | Out-Null
}
$providerProject = Join-Path $PSScriptRoot 'VirtualCameraProvider/MeetingLens.VirtualCamera.vcxproj'
$providerPackages = Join-Path $PSScriptRoot 'VirtualCameraProvider/packages'
& nuget restore (Join-Path $PSScriptRoot 'VirtualCameraProvider/packages.config') -PackagesDirectory $providerPackages -NonInteractive
if ($LASTEXITCODE -ne 0) { throw 'Provider NuGet restore failed.' }
& msbuild $providerProject /m "/p:Configuration=$Configuration" /p:Platform=x64 "/p:OutDir=$providerRoot\" /p:WindowsTargetPlatformVersion=10.0.26100.0
if ($LASTEXITCODE -ne 0) { throw 'MeetingLens virtual-camera provider build failed.' }
foreach ($testProject in @('ProtocolTests', 'ProviderRuntimeTests')) {
    & msbuild (Join-Path $PSScriptRoot "VirtualCameraProvider/$testProject.vcxproj") /m /p:Configuration=Release /p:Platform=x64 "/p:OutDir=$providerTestRoot\" /p:WindowsTargetPlatformVersion=10.0.26100.0
    if ($LASTEXITCODE -ne 0) { throw "$testProject build failed." }
}
foreach ($test in @(
    @{ name = 'MeetingLens.ProtocolTests'; argument = '' },
    @{ name = 'MeetingLens.ProviderRuntimeTests'; argument = ('"' + (Join-Path $providerRoot 'MeetingLens.VirtualCamera.dll') + '"') }
)) {
    $options = @{
        FilePath = (Join-Path $providerTestRoot ($test.name + '.exe'))
        WorkingDirectory = $providerTestRoot
        PassThru = $true
        RedirectStandardOutput = (Join-Path $providerTestRoot ($test.name + '.stdout.txt'))
        RedirectStandardError = (Join-Path $providerTestRoot ($test.name + '.stderr.txt'))
    }
    if ($test.argument) { $options.ArgumentList = $test.argument }
    $testProcess = Start-Process @options
    if (-not $testProcess.WaitForExit(60000)) { $testProcess.Kill(); $testProcess.WaitForExit(); throw "$($test.name) timed out after 60 seconds." }
    if ($testProcess.ExitCode -ne 0) { throw "$($test.name) failed (exit $($testProcess.ExitCode)); inspect the provider test stdout/stderr logs." }
    Get-Content -LiteralPath $options.RedirectStandardOutput
}
& dotnet publish (Join-Path $PSScriptRoot 'MeetingLens.Camera/MeetingLens.Camera.csproj') --configuration $Configuration --runtime win-x64 --self-contained true --output $publishRoot "-p:Version=$version"
if ($LASTEXITCODE -ne 0) { throw 'MeetingLens Camera host publish failed.' }

$appRoot = Join-Path $packageRoot 'app'
New-Item -Path $appRoot -ItemType Directory | Out-Null
Copy-Item -Path (Join-Path $publishRoot '*') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $providerRoot 'MeetingLens.VirtualCamera.dll') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'VirtualCameraProvider/LICENSE-Microsoft.txt') -Destination (Join-Path $appRoot 'Provider-Microsoft-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD_PARTY_NOTICES.md') -Destination $appRoot
$licenseRoot = Join-Path $appRoot 'licenses'
function Copy-PackageLicenses([string]$PackageDirectory, [string]$PackageIdentity) {
    if (-not (Test-Path -LiteralPath $PackageDirectory -PathType Container)) { throw "Restored package is missing: $PackageIdentity" }
    $legalFiles = @(Get-ChildItem -LiteralPath $PackageDirectory -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|NOTICE|THIRD[-_ ]?PARTY|EULA|COPYING)' })
    if ($legalFiles.Count -eq 0) { throw "No redistribution license/notice files found in $PackageIdentity. Check the restored package before shipping." }
    foreach ($legalFile in $legalFiles) {
        $relative = $legalFile.FullName.Substring($PackageDirectory.Length + 1)
        $destination = Join-Path (Join-Path $licenseRoot $PackageIdentity) $relative
        New-Item -Path (Split-Path -Parent $destination) -ItemType Directory -Force | Out-Null
        Copy-Item -LiteralPath $legalFile.FullName -Destination $destination
    }
}
Copy-PackageLicenses (Join-Path $providerPackages 'Microsoft.Windows.CppWinRT.3.0.260520.1') 'Microsoft.Windows.CppWinRT.3.0.260520.1'
Copy-PackageLicenses (Join-Path $providerPackages 'Microsoft.Windows.ImplementationLibrary.1.0.260126.7') 'Microsoft.Windows.ImplementationLibrary.1.0.260126.7'
$nugetCacheOutput = @(& dotnet nuget locals global-packages --list --force-english-output)
if ($LASTEXITCODE -ne 0) { throw 'Could not locate the restored WebView2 redistribution license.' }
$cacheLines = @($nugetCacheOutput | Where-Object { $_ -match '^global-packages:\s*' })
if ($cacheLines.Count -ne 1) { throw 'Unexpected NuGet global-package path output.' }
$globalPackageRoot = $cacheLines[0].Substring('global-packages:'.Length).Trim()
$webViewNode = Select-Xml -LiteralPath (Join-Path $PSScriptRoot 'MeetingLens.Camera/MeetingLens.Camera.csproj') -XPath "/Project/ItemGroup/PackageReference[@Include='Microsoft.Web.WebView2']"
if ($null -eq $webViewNode) { throw 'Missing pinned WebView2 package reference.' }
$webViewVersion = $webViewNode.Node.GetAttribute('Version')
Copy-PackageLicenses (Join-Path $globalPackageRoot "microsoft.web.webview2/$webViewVersion") "Microsoft.Web.WebView2.$webViewVersion"
foreach ($filename in @('Install-Camera.ps1', 'Uninstall-Camera.ps1', 'CAMERA-INSTALL.md', 'validate-camera.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $filename) -Destination $packageRoot
}
foreach ($required in @('MeetingLens.Camera.exe', 'MeetingLens.VirtualCamera.dll', 'web/index.html', 'web/photo-workbench.html', 'web/assets/js/app.js', 'web/assets/js/virtual-camera.js', 'web/assets/js/vision-effects.js', 'web/assets/vendor/vision/meetinglens-worker.js', 'web/assets/models/face_landmarker.task', 'web/assets/models/person_segmenter_multiclass.tflite')) {
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot $required) -PathType Leaf)) { throw "Incomplete package: missing $required." }
}
$fileRecords = @(Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
[ordered]@{
    schema = 'meetinglens.camera.package.v1'
    version = $version
    architecture = 'x64'
    minimumWindowsBuild = 22621
    providerClsid = '{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}'
    providerFile = 'MeetingLens.VirtualCamera.dll'
    builtUtc = [DateTime]::UtcNow.ToString('O')
    sourceCommit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { 'local-build' }
    signed = $false
    files = $fileRecords
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageRoot 'package-manifest.json') -Encoding UTF8
$sumLines = @(Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
})
$sumLines | Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt') -Encoding UTF8
$zipPath = Join-Path $artifacts "MeetingLens-Camera-$version-win-x64-UNSIGNED-TEST.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
'{0}  {1}' -f (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant(), [IO.Path]::GetFileName($zipPath) | Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII
Write-Output "Built $zipPath"
Write-Output 'Build completed without registration, installation, camera capture, automatic publication or signing.'
