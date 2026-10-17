# MeetingLens 3.3.0 Windows camera integration candidate

The implementation now includes a dedicated `MeetingLens.Camera` WebView2 desktop host and a product-specific Media Foundation source under `VirtualCameraProvider`. The existing Windows controls app and the preserved Microsoft sample remain separate.

## Implemented connection

The desktop host loads its bundled studio from a trusted virtual HTTPS origin. Explicit meeting-output start permits the JavaScript bridge to copy processed canvas pixels into a reusable WebView2 shared buffer. The host validates each message and hands the latest BGRA frame to the native source through a random, access-controlled local named pipe. There is one frame request at a time, no JPEG round trip, no HTTP listener, no screen capture, and no virtual microphone.

The provider advertises fixed 1280 × 720 RGB32/NV12 video with a nominal 30 fps. Its pipe clock uses monotonic Windows uptime; stale frames expire after 750 ms. Stopped, shielded, unavailable or failed input produces safe blank output. Actual effect updates can be slower than the nominal camera cadence.

The camera has a distinct MeetingLens COM identity. Its registration belongs in a stable protected installation directory, and its device lifetime belongs to the running host session. The install and uninstall scripts do not change unrelated camera settings or install a kernel driver.

## Remaining production gates

1. Execute the Windows virtual-camera build workflow and retain its actual build, COM, camera and installer validation outputs.
2. Test the installed candidate on physical Windows PCs: built-in/USB cameras; denied permission; busy/disconnected camera; stop/restart; shield; sleep/resume; process crash; minimize/background; slow segmentation; and full uninstall/reinstall.
3. Select the virtual camera in current Teams and Zoom desktop clients and supported browser services. Check colors, orientation, backgrounds, latency, continued rendering and simultaneous consumers. Record exact Windows, client and binary versions.
4. Test a sustained call on a low-power device. The 720p output clock does not imply 30 new AI-processed frames per second.
5. Sign the final executable, source DLL and production installer using publisher-controlled certificates, and review Store packaging/claims against that tested product. No publisher certificate or signature is invented by the source build.
6. Publish native feature claims and replacement screenshots only after acceptance passes. A PWABuilder PWA package alone does not install this native camera.

See `native-windows/CAMERA-INSTALL.md`, `native-windows/implementation-status.json`, and `docs/validation/virtual-camera-3.3.0.md` for the reproducible build and current evidence. Source/protocol tests are not Windows hardware or meeting-app certification.
