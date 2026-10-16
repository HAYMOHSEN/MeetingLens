# MeetingLens Windows source and remaining release work

The PWA and native Windows source have different capabilities. Review `native-windows/README.md` and `native-windows/implementation-status.json` before building or listing the native features.

## Included source now

- A Windows 11 WPF controls app with actual device enumeration, preview, driver-advertised resolution/frame-rate selection, hardware zoom, guarded Kernel Streaming read/write for background blur, eye contact and portrait light, and DigitalWindow automatic framing.
- Explicit links to Windows camera and sound settings for system-managed Voice Focus, Multi-App Camera and Basic camera options where available.
- A DirectShow C++ diagnostic application with webcam enumeration, advertised-mode inspection/selection and real preview; this is an alternative capture path, not a guarantee of raw pixels.
- Complete Microsoft MIT-licensed virtual-camera provider, installer, manager and tests pinned to a specific upstream commit, plus a script that builds the actual provider DLL and installer console.
- A Windows build workflow and twelve hardware-independent tests for KS binary layout, supported-mode filtering, malformed responses and exact report serialization.
- A locally exported capability/status JSON contract so the PWA can explain actual Windows support without pretending to have a live system-control bridge.

## Native hardware/OS dependencies

Studio effects are supplied by Windows and the camera driver. NPU support, installed effect packages, camera opt-in and specific supported modes decide whether controls can be used. Windows owns the NPU acceleration path. No feature toggles or registry edits force unsupported eye-contact models, portrait-light modes or USB hardware support. Voice Focus remains managed in Windows sound controls; no camera KS write is used as a microphone toggle.

## Before a MeetingLens virtual-camera release

1. Create product-specific media-source identity, installer, uninstaller and signing workflow from the included Microsoft reference; do not ship the unmodified sample identity as a finished MeetingLens provider.
2. Connect a single native capture/compositor producer to the virtual-camera media source using authenticated local IPC/shared memory with bounded queues, validated dimensions/stride, a stable frame clock and explicit media-type negotiation.
3. Decide whether the enhanced source lives in a native UI, a packaged WebView2 host, or a separate native rendering engine. The web PWA currently has no transport to the provider.
4. Treat camera/microphone consent and a visible capture indicator as part of the actual native flow. Make privacy stop all native capture and release devices.
5. Test simultaneous clients with Teams, Zoom and Windows Camera, format changes, camera unplug, sleep/resume, NPU-unavailable fallback, app crashes and complete uninstall. Windows' native Multi-App Camera option can share the physical webcam on supported builds, but does not itself route the MeetingLens web canvas.
6. Publish native feature claims only after Windows build and physical-device checks succeed; update Store screenshots from that exact released product.

## Current validation limit

The managed Windows UI source compiled against 209 official .NET/Windows reference assemblies with warnings treated as errors, and all twelve KS protocol/report tests passed in a Linux harness. Full Windows packaging, the DirectShow/upstream provider C++ builds and physical-device tests have not run in this authoring workspace. The included Windows CI workflow is ready after upload. Browser tests of the PWA are separate evidence and do not certify Windows NPU behavior, virtual-camera routing, microphone Voice Focus or meeting-app compatibility.
