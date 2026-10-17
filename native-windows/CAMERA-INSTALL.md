# MeetingLens Camera for Windows: build, install and test

This desktop application hosts the bundled MeetingLens effects page and supplies a Windows Media Foundation virtual camera. The browser PWA alone cannot create that camera. The desktop app must remain open while another application uses its video. This component handles video; select your ordinary microphone in the meeting application.

The source includes build and validation scripts. A ZIP containing source code is not an installed executable. A successful Windows build produces an **unsigned test package**; it still requires the hardware checks below before a production release.

## Requirements

- Windows 11 22H2 (build 22621) or later, x64. This initial camera package does not target Windows 10, ARM64 or 32-bit meeting clients.
- Microsoft Edge WebView2 Evergreen Runtime. Install the official runtime from [Microsoft's WebView2 download page](https://developer.microsoft.com/microsoft-edge/webview2/). The installer does not silently download or install it.
- Permission to use the physical camera and desktop camera applications in Windows privacy settings.
- Administrator access for the one-time COM provider installation. Run the camera app afterward as your normal user.

The package includes the .NET 8 runtime and the app's local vision models. Initial use of a physical webcam still requires Windows camera permission. There is no local HTTP server, inbound network port, auto-start entry or background Windows service installed by these scripts.

## Build on GitHub

1. Upload the supplied source files to the repository root, preserving `native-windows/` and `.github/workflows/`.
2. Open **Actions → Windows virtual camera test package → Run workflow** on the branch containing the files.
3. Check that compilation, full managed/C++ protocol tests, actual provider sample delivery, installer collision protection and COM activation passed. Read the separate camera-enumeration result and test limits; a hosted runner is not a physical webcam acceptance test.
4. Download the **MeetingLens-Camera-win-x64-UNSIGNED-TEST** artifact. Extract that download, then extract the versioned `MeetingLens-Camera-…-win-x64-UNSIGNED-TEST.zip` inside it into its own folder.
5. Keep the checksum file and validation reports with the tested build. Do not publish it as a signed production installer.

No release is automatically created or uploaded to Microsoft Store. No signing credential is included. A production installer must be signed with the publisher's certificate and tested under the intended distribution method; PWABuilder does not automatically install this desktop COM provider.

## Build locally

Install Visual Studio 2022 **Desktop development with C++**, Windows SDK **10.0.26100**, .NET 8 SDK and NuGet CLI. Open a 64-bit Visual Studio Developer PowerShell from the repository root:

```powershell
./native-windows/build-camera.ps1
```

The build restores the pinned provider dependencies, compiles the x64 DLL, runs its protocol and real-source sample tests, publishes a self-contained desktop app and copies its web assets. The sample test activates the actual source in-process and requests NV12 and RGB32 black fallback frames without a physical camera, installation or registration. It checks buffer bytes, timing, tokens and stop/restart/shutdown. The build writes a file-level manifest, SHA-256 checksums and an unsigned test ZIP under `native-windows/artifacts/`. Building does not register a virtual device or start physical camera capture.

## Install the test package

1. Close MeetingLens Camera and any old camera test instance.
2. Inspect `Install-Camera.ps1` and the package checksums. Open **64-bit PowerShell as administrator**, navigate to the extracted package folder, and run:

   ```powershell
   ./Install-Camera.ps1
   ```

3. The script verifies every payload checksum and refuses an existing installation or CLSID registration. It installs into `C:\Program Files\MeetingLens Camera` and registers only its own 64-bit COM provider. It does not start the camera.
4. Close the administrator shell. Launch `MeetingLens.Camera.exe` from the installed folder as your normal user.

The installer does not alter PowerShell execution policy or bypass Windows security prompts. If your organization blocks unsigned scripts or applications, use your administrator's approved signing and installation process. Checksums detect accidental corruption; they do not establish the publisher's identity.

## Use in a meeting

1. Open the installed MeetingLens Camera desktop app, start its physical camera preview, and choose the background/effects.
2. Start the app's virtual-camera output. Keep the window running.
3. In Teams, Zoom or another 64-bit camera application, open its camera device selector and choose **MeetingLens Virtual Camera**. Windows may append a virtual-camera suffix to the friendly name.
4. Keep your usual microphone selected. This integration does not create a virtual microphone.
5. Stop the virtual output before closing the desktop app. It uses a current-user session camera; the device is removed when its registration session is shut down. Restart the meeting app if its device list was opened before the camera was started.

Only one MeetingLens desktop producer may run per user session. Multiple consumers require acceptance testing in the actual meeting apps. A meeting application's enterprise policy can block virtual cameras. MeetingLens does not change that policy or force another app to accept its device.

## Validate on Windows

After installing, open a **normal-user** 64-bit PowerShell from the source repository and run:

```powershell
./native-windows/validate-camera.ps1 -AppDirectory 'C:\Program Files\MeetingLens Camera' -TestCameraEnumeration
```

This runs the protocol self-tests, activates the real registered COM provider and requests a temporary session camera start/enumeration test. It writes reports without webcam images or audio under `native-windows/artifacts/camera-validation/`. The command does not substitute for watching a live camera in a meeting. The `-RegisterProviderForTest` switch is for an administrator-controlled test machine with no existing installation: it temporarily registers the DLL and removes that test registration in `finally`.

Before shipping, record the exact Windows build, app build, camera/driver, browser runtime and meeting-app versions, then verify:

| Check | Acceptance result to record |
|---|---|
| Camera denied, absent, busy or unplugged | Clear error; no stale frame presented as live; recovery works |
| Start/stop/restart output at least 20 times | No duplicate device, exception or orphaned process |
| Teams desktop and Zoom desktop | Real enhanced video appears as camera input, including a moving hand and a background change |
| Two meeting clients using the virtual camera | Both receive current video; one closing does not break the other |
| Producer closed or killed | Camera output becomes a neutral unavailable frame; no indefinitely frozen private image |
| Camera/window minimized, locked session, sleep/resume | Behavior is visible and safe; reconnect works |
| Low light, motion, USB reconnect, at least 60 minutes | No unbounded memory growth, accumulating delay or continuous CPU spikes |
| Uninstall/reinstall | Owned registration and files removed; ordinary cameras remain usable |

Any failed check blocks a production claim for that environment. The source authoring environment cannot certify Windows webcam, Teams or Zoom behavior.

## Uninstall and update

Close MeetingLens, Teams, Zoom, Camera and other consumers. Open **64-bit PowerShell as administrator** and run the installed uninstaller:

```powershell
& 'C:\Program Files\MeetingLens Camera\Uninstall-Camera.ps1'
```

It verifies the owned installation marker and exact registered DLL path before removal. If a client or Windows Camera Frame Server still has the DLL loaded, the script leaves the installation in place; restart Windows and try again. It never kills a process or stops a Windows service. Install the newer package after uninstalling the older test build. Existing browser/PWA settings and other camera devices are not changed.

## Troubleshooting

- **Camera missing in Teams/Zoom:** Start output in the desktop app first, then reopen the meeting app's camera selector. Confirm the Windows build and that you are using a 64-bit client. Check Windows desktop-camera privacy permission and organizational policy.
- **Only the browser PWA is open:** Launch the installed desktop `MeetingLens.Camera.exe`; the public website cannot install a virtual device.
- **WebView2 missing:** Install Microsoft's Evergreen Runtime and restart MeetingLens.
- **Install refuses an existing path or CLSID:** Uninstall the prior owned build first. Do not manually delete unknown registry keys.
- **Black/unavailable output:** Inspect the desktop app's status and physical-camera preview. Stop/start output after permission or camera errors. Do not promise a live meeting until the actual acceptance test passes.
