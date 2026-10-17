# MeetingLens Windows companion source

This folder supplies a Windows camera control application, a separate DirectShow diagnostic utility, and a new **MeetingLens Camera** integration candidate. The latter embeds the bundled PWA in WebView2 and sends its processed canvas to a product-specific Media Foundation virtual-camera provider. See [CAMERA-INSTALL.md](./CAMERA-INSTALL.md) to build and test it. These native projects are separate from the installable web PWA. The browser does not silently install a camera, start a local HTTP service, or change system effects.

## What is implemented

| Area | Included implementation | Availability |
|---|---|---|
| Auto framing | `DigitalWindowControl` supported-mode query, current-state display and `Configure` | Camera must advertise `Auto` |
| Background blur | KS GET/SET for standard and portrait modes, capability filtering, state confirmation | Camera/Windows must advertise each mode |
| Eye contact | KS GET/SET for Standard and Teleprompter modes | Supported Windows Studio camera; model/device dependent |
| Portrait light | Windows Studio StageLight KS property | Exposed only when the driver supports it |
| NPU use | Requests Windows-provided Studio effects | Windows selects and manages its acceleration; the app does not allocate an NPU |
| Voice Focus | Opens Windows Sound Settings | Windows controls the microphone feature; no camera-property microphone toggle is invented |
| Camera selection | Enumerates built-in and USB capture devices | Windows camera permissions and driver support apply |
| Resolution and frame rate | Lists all formats exposed by the selected color frame source; restores the previous format after a rejected change | Driver-exposed modes only |
| Fine zoom | Queries real hardware minimum/maximum/step; rounds to the supported step | Cameras with `ZoomControl.Supported` |
| Multi-app camera | Opens the selected camera's Windows settings and explains Advanced camera options | Windows version, driver and enterprise policy decide availability |
| Basic camera mode | Opens the same Windows settings page; separate DirectShow diagnostics enumerate modes and preview a selected camera | DirectShow diagnostics do not guarantee unprocessed pixels or bypass Studio effects |
| Capability report | Exports a real point-in-time JSON report without pictures, audio or raw device identifiers | Import/report integration is status-only, not a live bridge |
| Virtual camera | MeetingLens-specific provider, WebView2 studio host, shared frame buffer, local named pipe, build/install/test scripts | Integration source candidate; Windows build/install and meeting-app acceptance remain release gates |

The native preview uses the system camera stream. Do not layer equivalent app filters on top of active system effects. The companion queries the current flags and displays their state instead of assuming all effects are off. Effects are not enabled merely by connecting a camera.

## Build and run

Requirements for `MeetingLens.Windows`: Windows 11 22H2 or later, .NET 8 SDK, network access for NuGet restore. For `BasicCamera`: Visual Studio 2022 C++ desktop tools, a current Windows SDK and CMake. The code targets SDK 10.0.22621; this is separate from the larger upstream virtual-camera sample's SDK 10.0.26100 requirement.

From PowerShell on Windows:

```powershell
cd native-windows
./build.ps1
./artifacts/controls-x64/MeetingLens.Windows.exe
```

`build.ps1` publishes a self-contained x64 controls app and copies the DirectShow utility beside it. Open the app, choose a device, and select **Connect camera**. Windows may ask for camera consent. Export the real capability report after connection if you want a record of support and current flags.

To build only the managed controls application, use `./build.ps1 -SkipDirectShow`. An ARM64 controls/diagnostics build is available with `-Architecture arm64` when the matching Visual Studio C++ tools are installed; ARM64 has not been hardware validated in this workspace.

The application does not change Windows defaults. It tracks changes it makes and attempts to restore those settings when it disconnects. If another client changes a value during the connection, it leaves that newer value alone. Unplugging a camera or terminating a process may prevent restoration; inspect the camera's actual state next time it connects.

## DirectShow diagnostics

```powershell
./artifacts/controls-x64/MeetingLens.BasicCamera.exe --list
./artifacts/controls-x64/MeetingLens.BasicCamera.exe --camera 0
./artifacts/controls-x64/MeetingLens.BasicCamera.exe --camera 0 --mode 2 --preview
./artifacts/controls-x64/MeetingLens.BasicCamera.exe --interactive
```

`--list` enumerates devices without starting a camera. `--camera N` reports the selected device's advertised DirectShow modes. `--mode N --preview` selects an advertised mode and shows its preview; closing the renderer stops the graph. The companion's **DirectShow diagnostics** button disconnects its own stream first, then opens the interactive device picker. Camera indexes belong to each enumeration API and are never assumed interchangeable.

DirectShow and Windows' **Basic camera** setting are different mechanisms. A DirectShow graph can still include camera firmware processing, driver processing or Windows effects. Use Windows settings and the KS state report to investigate processing; this tool never edits camera policy or the registry to force a bypass.

## MeetingLens Camera integration candidate

`MeetingLens.Camera/` is the dedicated desktop application, and `VirtualCameraProvider/` is its native Media Foundation provider. The browser bridge sends processed canvas pixels through a WebView2 shared buffer after explicit output start. A local named pipe grants access to the user and Windows Frame Server's service identity; there is no TCP listener or screen capture. The provider has its own CLSID and uses a current-user, session-lifetime camera. It delivers fixed 1280 × 720 RGB32/NV12 video at a nominal 30 fps while honoring slower local effect updates. No virtual microphone is supplied.

Run `build-camera.ps1` on Windows or use the separate Windows virtual-camera workflow. Follow `CAMERA-INSTALL.md` before installing or distributing its output. A successful source/protocol check is not a Windows installation test. Public release requires the real Teams/Zoom acceptance checks, including privacy, producer crash, camera removal, sleep/resume, simultaneous clients, and complete uninstall. The source and package remain a candidate until those checks pass.

## Preserved upstream reference

Microsoft's source under `vendor/Samples/VirtualCamera/` implements a real COM media source with synthetic, physical-camera wrapper and augmented-camera modes. It includes its actual activation class, stream code, installer, manager, tests and MSI projects. This prevents a registration-only demo from referring to a nonexistent producer DLL.

To build the upstream source DLL and installer console on Windows, install Visual Studio C++ tools, SDK 10.0.26100, NuGet CLI, and invoke:

```powershell
./build-virtual-camera-reference.ps1
```

The script builds without registering or installing anything. For a developer test installation, open the pinned upstream `VirtualCameraSample.sln` and follow its `README.md`, including the Visual Studio Installer Projects extension and MSI registration steps. The optional upstream WinUI manager has its own package/SDK requirements; the headless build script does not build it. Preserve sample licensing and replace the sample name/CLSID before releasing a MeetingLens-specific provider.

The upstream reference is not the MeetingLens camera package. Its wrapper alone does not establish concurrent streaming in every meeting app. The new MeetingLens provider and desktop host implement the frame transport separately; they still require actual Windows build, install, signing and acceptance checks before a production release. Where supported, Windows' own Multi-App Camera option can share the physical camera without a MeetingLens virtual device.

## Verification and release checks

`workflows/windows-native-build.yml` is the workflow template. A copy is included at the repository root as `.github/workflows/windows-native-build.yml`, ready to run after upload to GitHub. It compiles the WPF app and DirectShow tool, runs twelve KS payload/report tests, enumerates DirectShow devices without capture, and separately builds the pinned Microsoft provider DLL and installer console. A successful cloud build is compile/smoke evidence, not webcam or meeting-app certification.

The managed WPF source compiled with warnings treated as errors against 209 official .NET 8 / Windows metadata reference assemblies, and all twelve protocol/report tests passed in a Linux harness. The reproducible metadata compilation helper is `scripts/verify-managed-source.py`; its result is in `validation/managed-source-check.json`. This verifies C# syntax and real API signatures. A full Windows publish, DirectShow C++ build, upstream virtual-camera C++ build and physical-device validation have not been executed in the Linux authoring workspace. `implementation-status.json` records those limits. On a Windows machine, test:

1. No camera, denied permission, busy camera, unplug/replug, and repeat connect/disconnect.
2. Integrated webcam plus at least two USB webcams; confirm device names and active device.
3. An ordinary non-NPU PC: unavailable effects remain unavailable and standard preview still works.
4. A compatible Studio Effects PC: read initial flags, change each supported mode, verify image changes and readback, and confirm session restoration.
5. Every advertised format you plan to expose in production; reject/roll back unusable modes without guessing hidden ones.
6. Driver-specific zoom bounds/steps; keyboard and pointer changes.
7. Windows Multi-App Camera enabled/disabled: test the same physical device in Teams, Zoom and Camera simultaneously; record Windows build, driver version and results.
8. Basic camera settings and DirectShow preview separately; document any processing still present.
9. Low light, glare, glasses, diverse faces, movement and different microphones; judge results on the actual supported hardware.
10. Virtual source install/uninstall, privacy permission denial, multi-client streaming, app crashes, sleep/resume and physical-camera removal before any virtual-camera release.

## Report contract

`Export capability report` produces `MeetingLens-Windows-Capabilities.json` with schema `meetinglens.windows.capabilities.v1`. The important fields are `generatedAt`, `device.name`, `device.idHash`, `effects[]`, `autoFraming`, `zoom`, `formats`, `voiceFocus`, `npu` and `virtualCamera`.

Each `effects[]` entry has `id`, `label`, `supported`, nullable `flags`/`capabilities`, supported `modes[]` and an optional `error`. Supported flag and capability values are decimal strings so JavaScript preserves every 64-bit flag exactly. Effect ids are `backgroundBlur`, `eyeContact` and `portraitLight`. `autoFraming.supported` is queried separately. A report is a snapshot and can become stale if another application, device mode, driver or Windows update changes support. A PWA that reads it must never interpret it as permission to control system effects.

The controls/report utility installs no HTTP listener, port, service, protocol handler or remote-control endpoint. The separate MeetingLens Camera host adds only the documented local shared-buffer/named-pipe video transport. Voice Focus reports `controlledByCompanion: false`; the NPU reports that acceleration is managed by Windows. Camera device identifiers are hashed for exported reports, and there are no raw video/audio samples in those reports.

## Primary references

- [Windows Studio Effects overview and KS integration](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/studio-effects)
- [Current Windows Studio Effects support and device availability](https://support.microsoft.com/en-us/windows/ai/ai-features/windows-studio-effects)
- [Microsoft Windows Studio sample, pinned source](https://github.com/microsoft/Windows-Camera/tree/626f8b19c5f367602f2e89c6b314573d3776c9df/Samples/WindowsStudio)
- [DigitalWindowControl](https://learn.microsoft.com/en-us/uwp/api/windows.media.devices.digitalwindowcontrol)
- [Manual camera controls](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/capture-device-controls-for-photo-and-video-capture)
- [MediaFrameReader](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/process-media-frames-with-mediaframereader)
- [Windows updates: Multi-App Camera and Basic Camera](https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/inside-this-update)
- [Windows 11 26H2 IT guidance: camera settings/policy](https://learn.microsoft.com/en-us/windows/whats-new/whats-new-windows-11-version-26h2)
- [DirectShow camera capture](https://learn.microsoft.com/en-us/windows/win32/directshow/video-capture)
- [MFCreateVirtualCamera API](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nf-mfvirtualcamera-mfcreatevirtualcamera)
- [Microsoft VirtualCamera sample, pinned source](https://github.com/microsoft/Windows-Camera/tree/626f8b19c5f367602f2e89c6b314573d3776c9df/Samples/VirtualCamera)

Some older overview/sample text limits Studio effects to embedded front-facing cameras, while current Microsoft Support notes compatible third-party camera support. MeetingLens enumerates every camera and queries actual effect capability; it never assumes support from the device label or USB connection alone.
