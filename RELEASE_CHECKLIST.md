# MeetingLens 2.0.0 release checklist

Record results for the exact deployed revision and generated Windows package you plan to submit. An unchecked item is still pending. This checklist does not claim a successful test run, certification, or zero defects.

## Release record

| Field | Record before submission |
|---|---|
| Source commit or ZIP identifier | |
| Deployed HTTPS app URL | |
| Version and package identity | |
| Windows version/build | |
| Edge version | |
| Cameras and driver versions tested | |
| Test date and tester | |
| Known issues and release decision | |

## Automated development checks

~~~bash
npm install
npx playwright install chromium
npm test
~~~

Set CHROMIUM_PATH to the browser executable if using an existing Chromium installation. The test command runs studio checks and service-worker offline/update checks. Review both scripts and their output to establish which behaviors were exercised; a completed command is not evidence for checks it does not implement.

- [ ] Dependencies install and both browser-check scripts pass.
- [ ] No uncaught app exceptions occur during the exercised browser flows.
- [ ] Manifest, service-worker paths, icons, portrait, and screenshots load at the deployed repository path.
- [ ] Inspect all six screenshots at full size and confirm they match the shipped interface.

## Required manual Windows camera checks

Use Microsoft Edge on the intended supported Windows versions with real hardware. Browser simulation cannot establish hardware reliability.

- [ ] First launch: the camera stays off until the user starts it and grants permission.
- [ ] Deny permission in Edge: a useful error appears, no live camera starts, and the demo remains usable.
- [ ] Restore permission in Edge and retry without losing control of the app.
- [ ] With two cameras, switch between built-in and USB cameras and confirm old tracks stop.
- [ ] Disconnect an active USB camera: verify a clear status and recovery after reconnection.
- [ ] Test a camera occupied by another application and recover after that application releases it.
- [ ] Start permission acquisition, then activate Privacy Shield or hide the app before completing permission; verify the delayed request does not leave the camera running.
- [ ] Stop the camera repeatedly and confirm the browser camera indicator turns off when capture tracks stop.
- [ ] Hide the tab or minimize the installed app with automatic stop enabled; verify capture stops and requires an explicit restart.
- [ ] Disable automatic stop and verify the selected behavior and visible status are clear.
- [ ] Sleep and resume Windows with the camera active, then check status and recovery.
- [ ] Test 720p, 1080p, and efficient preferences; verify the displayed actual resolution.
- [ ] Run a sustained live session and assess responsiveness, CPU/memory behavior, and recoverable errors on the target PC.

## Required manual visual and local-file checks

- [ ] Brightness, contrast, saturation, temperature, vignette, and looks visibly affect the preview.
- [ ] Original view removes enhancements; split view shows original and adjusted regions correctly.
- [ ] Zoom and mirror behave predictably for demo and live preview.
- [ ] Grid, eye-line, and framing guides are legible and do not imply automatic face tracking.
- [ ] All six backgrounds work with the demo, and live-background limitations are clearly stated.
- [ ] The fictional AI demo subject stays labeled throughout its flow and screenshots.
- [ ] Download PNG and JPEG snapshots, including a timed capture, and open the files to check format, orientation, crop, and rendering.
- [ ] Privacy Shield cancels a pending timed capture and prevents hidden image capture.
- [ ] Save/load/delete presets, reload the app, and verify expected persistence.
- [ ] Export a preset and import it in a fresh local session.
- [ ] Invalid, excessive, or incompatible imported input shows a useful message and preserves usable settings.
- [ ] Simulate unavailable browser storage and verify that the app stays usable with appropriate feedback.
- [ ] Test keyboard operation, visible focus, reduced-motion preference, 200% zoom, and a narrow window.

## Required hosted PWA and Windows package checks

- [ ] The HTTPS host serves the app and all files successfully.
- [ ] Privacy and terms pages contain the real publisher/support contact, not placeholders.
- [ ] The public privacy-policy URL opens without sign-in.
- [ ] The app installs from Edge and launches as a standalone window.
- [ ] After a successful first load, the shell reopens offline.
- [ ] Deploy a newer version and verify the update notice and explicit update action.
- [ ] Review PWABuilder's report, manifest, identity, icons, and Windows support settings.
- [ ] Install the generated Windows package on a test Windows PC; repeat permission, privacy, camera-loss, and snapshot checks there.
- [ ] Upgrade the previous installed package and verify launch, saved presets, updates, and policy links.
- [ ] Review uninstall/reinstall behavior and document expected local-data persistence.

## Store readiness

- [ ] Reserve the final Store name and match Partner Center identity values exactly.
- [ ] Confirm all descriptions, captions, six screenshots, and optional art describe this version.
- [ ] Keep the in-app AI demo disclosure visible in screenshots showing the sample portrait.
- [ ] Do not claim virtual-camera output, meeting-app integration, live background replacement, face tracking, or a measured readiness score.
- [ ] Declare only implemented and tested interface languages. Localized listing text alone does not establish interface support.
- [ ] Complete the current Partner Center age-rating, privacy, availability, pricing, support, and package declarations.
- [ ] Record remaining known issues and decide whether they block release before submission.
