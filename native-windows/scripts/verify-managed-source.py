#!/usr/bin/env python3
"""Compile against real .NET/Windows refs without claiming a Windows packaging test.

Useful on restricted Linux hosts where dotnet's MSBuild process inspection fails.
Requires an extracted .NET 8 SDK and extracted official reference NuGet packages:
Microsoft.WindowsDesktop.App.Ref 8.0.32 and Microsoft.Windows.SDK.NET.Ref 10.0.22621.56.
It neither substitutes fake Windows APIs nor invokes a Windows camera.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dotnet-sdk', required=True, type=Path)
    parser.add_argument('--desktop-ref', required=True, type=Path)
    parser.add_argument('--windows-sdk-ref', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sdk = args.dotnet_sdk.resolve()
    sdk_versions = sorted((sdk / 'sdk').iterdir())
    net_refs = sorted((sdk / 'packs/Microsoft.NETCore.App.Ref').iterdir())
    compiler = sdk_versions[-1] / 'Roslyn/bincore/csc.dll'
    references = {path.name: path for path in (net_refs[-1] / 'ref/net8.0').glob('*.dll')}
    references.update({path.name: path for path in (args.desktop_ref / 'ref/net8.0').glob('*.dll')})
    references.update({path.name: path for path in (args.windows_sdk_ref / 'lib/net8.0').glob('*.dll')})
    if not compiler.is_file() or len(references) < 150:
        raise SystemExit('Missing SDK/compiler or incomplete official metadata references.')
    project = root / 'MeetingLens.Windows'
    with tempfile.TemporaryDirectory(prefix='meetinglens-native-compile-') as directory:
        output = Path(directory)
        usings = output / 'GlobalUsings.g.cs'
        usings.write_text('\n'.join(f'global using {name};' for name in [
            'System', 'System.Collections.Generic', 'System.IO', 'System.Linq', 'System.Threading', 'System.Threading.Tasks']))
        base = ['-nologo', '-langversion:12', '-nullable:enable', '-warnaserror+']
        refs = [f'-reference:"{path.resolve()}"' for path in references.values()]

        def compile_sources(name, sources, target):
            rsp = output / f'{name}.rsp'
            rsp.write_text('\n'.join(base + [f'-target:{target}', f'-out:"{output / (name + ".dll")}"'] + refs +
                                     [f'"{source.resolve()}"' for source in sources]))
            subprocess.run([str(sdk / 'dotnet'), str(compiler), '@' + str(rsp)], check=True, cwd=output)

        compile_sources('MeetingLens.Windows', sorted(project.glob('*.cs')) + [usings], 'winexe')
        harness = output / 'Harness.cs'
        harness.write_text('namespace MeetingLens.Windows; internal static class Harness { static int Main() => ProtocolTests.Run(); }')
        compile_sources('ProtocolChecks', [project / 'KsControl.cs', project / 'ProtocolTests.cs', usings, harness], 'exe')
        (output / 'ProtocolChecks.runtimeconfig.json').write_text(json.dumps({
            'runtimeOptions': {'tfm': 'net8.0', 'framework': {'name': 'Microsoft.NETCore.App', 'version': '8.0.0'}}}))
        subprocess.run([str(sdk / 'dotnet'), str(output / 'ProtocolChecks.dll')], check=True, cwd=output)
        result = json.loads((output / 'native-self-test.json').read_text())
        report = {
            'managedSourceCompilation': 'passed',
            'warningsAsErrors': True,
            'officialMetadataReferenceCount': len(references),
            'sdk': sdk_versions[-1].name,
            'protocolTests': result,
            'windowsPackagingBuild': 'not-run',
            'directShowNativeBuild': 'not-run',
            'virtualCameraNativeBuild': 'not-run',
            'webcamAndNpuHardwareValidation': 'not-run',
        }
        text = json.dumps(report, indent=2) + '\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text)
        print(text)


if __name__ == '__main__':
    main()
