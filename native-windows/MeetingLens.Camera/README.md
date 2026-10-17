# MeetingLens Windows Camera host

This .NET 8 WPF/WebView2 application bundles the MeetingLens camera UI and sends its explicit meeting output directly to the MeetingLens Media Foundation camera provider. It does not capture a window, screen, browser tab, or OBS output. The public PWA alone cannot create a Windows camera device.

## Requirements and use

Windows 11 22H2 or newer, x64, Microsoft Edge WebView2 Evergreen Runtime, and the installed MeetingLens camera provider are required. Build/install instructions live in the parent `native-windows` documentation.

1. Launch `MeetingLens.Camera.exe`.
2. Click **Enable virtual camera**. Windows may request camera access. Registration runs on a dedicated MTA thread while the UI stays responsive.
3. Click **Start camera** in the local studio and choose effects/backgrounds.
4. Click **Start meeting camera** in the studio. This separate explicit action enables sending processed video.
5. Select **MeetingLens Virtual Camera** in the meeting service's camera selector.
6. Keep this application running. **Stop output**, camera off, privacy shield, missing processed frames, or a disconnected renderer produce black frames. **Disable virtual camera** removes the current session device.

There is one shared processed output for all consumers. Teams/Zoom/Meet compatibility, simultaneous consumers, and minimized-window operation require the Windows acceptance checks; compilation and portable tests cannot certify those behaviors. No virtual microphone is included. Choose your usual microphone in the meeting app.

## Transport and security

The only trusted document is `https://appassets.meetinglens.example/index.html`, mapped by WebView2 to bundled files. Its permission origin is checked separately from the full document URL. Remote resources and remote navigation are blocked; no localhost HTTP server or network listener exists. Host objects and developer tools are disabled. Browsing bundled Photo Lab/legal/setup pages blacks and disables meeting output.

After the user enables the virtual camera, WebView2 shares one fixed 3,686,400-byte read/write buffer with the trusted document. The browser copies 1280×720 tightly packed RGBA to this buffer only when a host pull request is pending. A short JSON message acknowledges the request. The host validates exact origin/document, random session token, protocol, dimensions, sequence, JSON types/size, and a 600 ms request deadline before copying pixels. RGBA is converted to top-down opaque BGRA in one bounded latest-frame store. No camera frames, tokens, or pipe names are written to logs or files.

Eight bounded named-pipe instances support independent source connections. The random pipe basename contains 256 bits of randomness and is passed to the provider as an MF attribute before Start. Only the current user, LocalService, and SYSTEM receive ACL access. Remote pipe clients are rejected. LocalService gets individual data rights without `FILE_CREATE_PIPE_INSTANCE`. Every client requests `NEXT` and receives the fixed 40-byte header plus the latest BGRA frame; no video queue accumulates.

Header (little endian): magic `MLF1` (uint32), protocol 1 (uint16), header bytes 40 (uint16), width 1280 (uint32), height 720 (uint32), stride 5120 (uint32), payload 3686400 (uint32), sequence (uint64), capture `Environment.TickCount64` (uint64). The provider compares capture time to `GetTickCount64`. Source frames expire after 750 ms. A black frame has sequence zero. Repeated reads preserve a real frame's original capture timestamp.

The camera uses `MFVirtualCameraLifetime_Session` and `MFVirtualCameraAccess_CurrentUser`. The desktop host does not elevate or install COM registrations. It removes/stops/shuts down its session device on normal close. Windows lifetime cleanup handles process termination.

## Tests

`dotnet run --project tests/ProtocolTests.csproj` runs portable protocol/pixel/message tests. On Windows the published executable accepts:

- `--self-test`: fixed protocol/header/freshness sanity checks, no camera capture.
- `--provider-smoke-test`: explicitly initializes COM and activates the registered provider's IMFActivate interface, no camera capture.
- `--camera-smoke-test`: creates a current-user session camera, starts it, confirms its exact symbolic link appears in `MFEnumDeviceSources`, then stops/removes/shuts down. It does not open a physical camera or certify meeting-app video capture.

All CLI checks produce JSON on stdout and a nonzero exit code on failure. The source uses the official stable WebView2 NuGet SDK `1.0.4258.31`; the Evergreen runtime supplies browser security updates.
