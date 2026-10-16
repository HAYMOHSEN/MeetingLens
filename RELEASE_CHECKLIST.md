# MeetingLens 3.1.1 release checklist

Record results for the exact deployed source and generated Windows package being submitted. Unchecked items remain pending. Automated simulations do not establish hardware reliability, native binary compatibility, or Store certification.

## Release record

| Field | Record before submission |
|---|---|
| Source commit / archive identifier | |
| Deployed HTTPS URL | |
| Version / package identity | |
| Windows build / Edge version | |
| Camera / microphone / driver versions | |
| Native binary build identifier, if distributed separately | |
| Tester / date / known issues / release decision | |

## Automated checks and packaging

- [ ] Install development dependencies and run the full test command plus every relevant dedicated suite in package.json.
- [ ] Review vision, advanced-studio, Photo Lab, session, native-report, background, and offline results; retain actual output.
- [ ] Verify syntax, manifest paths, licensed bundled dependencies/models, required files, and archives.
- [ ] Build archives into temporary files and replace the deliverables only after successful close and full extraction/CRC verification. Download the saved archives again and verify their full extraction before sharing.
- [ ] Run at the deployed repository subpath, not only localhost root.
- [ ] Review all ten Store screenshots at full size; confirm they show the shipped UI and preserve AI sample labels.

## Camera and device recovery on Windows

- [ ] Camera remains off at first launch; camera and microphone permissions are requested separately.
- [ ] Deny/restore camera permission; confirm clear feedback and usable demo/manual tools.
- [ ] Switch built-in/USB cameras; confirm previous tracks stop.
- [ ] Disconnect/reconnect the active USB camera; test a camera occupied by another application.
- [ ] Stop or shield during a delayed permission request; confirm late tracks are released.
- [ ] Verify the Windows/browser camera indicator goes off after Stop/Shield.
- [ ] Hide/minimize with automatic stop on and off; verify the chosen camera behavior. Hidden microphone capture must stop in both cases.
- [ ] Sleep/resume with camera active and confirm recoverable status.
- [ ] Test reported resolution/FPS modes and fallback; check actual delivered resolution.
- [ ] Test fine digital zoom and Basic preview; ensure Basic preview is not described as raw DirectShow.
- [ ] Run a sustained session on a target low-power PC; record frame responsiveness, memory, CPU, thermal behavior, and recovery.

## Local vision and visual tools

- [ ] Confirm local models load from bundled paths with no inference upload.
- [ ] Move a face across the frame: Auto Framing follows smoothly and falls back sensibly when no face is detected.
- [ ] Inspect person-blur edges around hair, hands, movement, and difficult backgrounds.
- [ ] Start a built-in/USB camera and select each of the six scenes; verify the webcam subject, not the fictional sample, appears over the selected interior.
- [ ] Select a scene before camera start; confirm it activates after camera start and local segmentation becomes ready.
- [ ] Confirm scene selection loads local models automatically, displays progress, and offers truthful unavailable/retry feedback when the model or WebGL2 bridge is unavailable.
- [ ] Change scenes and softness during live capture; inspect segmentation, hair/hands, scene framing and sustained responsiveness.
- [ ] Stall/stop analysis; the actual room returns with status feedback instead of reusing an old mask indefinitely.
- [ ] Use real background disables both replacement and room blur. Original, Basic preview and zero intensity bypass background processing; test snapshots and original/split comparison as well as the preview.
- [ ] Compare Portrait Light and skin/teeth refinement at modest strength; check visible artifacts.
- [ ] Simulate missing model/worker failure: ordinary preview/manual controls remain usable.
- [ ] Verify no browser UI promises gaze synthesis, NPU selection, or perfect glare removal.
- [ ] With Windows Studio Effects already active, inspect the result and disable duplicate local effects.
- [ ] All six scenes and softness also work with the clearly labeled fictional sample without starting a camera.
- [ ] Original/split comparison, mirror, guides, presets, imports, PNG/JPEG capture, timers, and cancellation work as labeled.

## Photo Lab and whiteboard

- [ ] Import supported image types; reject corrupt/oversize input with useful feedback.
- [ ] Up to eight photos load with a capped 2048-pixel edge; switching/undo/reset/original comparison works.
- [ ] Smart Enhance changes tone; reference Color Match changes a set; exported JPEG/ZIP files open correctly.
- [ ] Small-object masks fill predictably; inspect complex-texture limits and Undo.
- [ ] Manual skin/teeth brushes and optional landmark assistance remain bounded to intended areas.
- [ ] Capture/import an angled classroom or meeting-room whiteboard; inspect suggested corners and correct them manually.
- [ ] Move every corner by mouse/touch/keyboard; check perspective, orientation, ink contrast, and saved JPEG.
- [ ] Test unusual/dim/glossy boards; do not accept unchecked automatic corner guesses as reliable output.

## Audio, QR, clipboard, and backups

- [ ] Microphone does not start automatically; deny/retry and switch device permissions in Windows.
- [ ] Verify actual supported noise suppression/echo cancellation/gain settings and listen to a real spoken sample.
- [ ] Meter, mute, up-to-60-second recording, playback/download, and discard work; no audio routes to other apps.
- [ ] Hidden-tab and Shield disconnect microphone tracks and clear temporary audio; Stop mic releases tracks and ends recording while retaining the completed clip for review.
- [ ] Decode an actual QR code through available detector and local jsQR fallback.
- [ ] Verify explicit copying; enable optional link auto-copy and test duplicates and blocked clipboard access. No URL opens automatically.
- [ ] Backups stay off until enabled; verify the selected folder and browser IndexedDB modes separately.
- [ ] Capture stills and open normal downloads and backup copies; verify latest-50 browser retention.
- [ ] Revoke folder permission, fill storage, and test failed writes; failures must not be reported as successful backups.
- [ ] Turning backup off stops future automatic copies without deleting previous files; delete-browser-backup controls work.

## Native companion, when distributed separately

- [ ] Follow native-windows/README.md to compile the managed utility and DirectShow diagnostic on Windows.
- [ ] Run native self-tests; record Windows build, compiler/SDK versions, and exact binaries.
- [ ] Inspect unsupported cameras and ensure unavailable KS modes remain disabled.
- [ ] Test supported blur/eye-contact/portrait-light/framing/device-zoom controls and restore behavior on real hardware.
- [ ] Verify basic DirectShow diagnostic preview; do not call its output guaranteed raw sensor data.
- [ ] Export/import a capability report, malformed JSON, unsupported schema, and files over 1 MB; all strings render safely as text.
- [ ] Confirm the report page describes snapshots, not live control; Settings opens only by user click.
- [ ] Test OS multi-app camera options only on supported Windows/device setups; document availability.
- [ ] Keep the upstream virtual-camera reference separate from claims of connected PWA output. Build/start testing does not prove end-to-end routing.
- [ ] Do not claim NPU performance or a Windows effect without hardware evidence.

## Hosted PWA, accessibility, and Store

- [ ] Public HTTPS URL serves all required assets and actual publisher-completed policies without sign-in.
- [ ] Edge installation and standalone launch work; repeat camera, microphone, privacy, and local-file checks in the generated PWABuilder package.
- [ ] After initial cache, all three workspaces and bundled models/decoders open offline; test cold reload and cache eviction behavior.
- [ ] Explicit update activates the next version safely, preserves unrelated caches, and upgrades saved presets.
- [ ] Upgrade an existing 3.0.1 or 3.1.0 installation through the Update banner, then test a selected scene with a live camera in 3.1.1.
- [ ] Inspect shoulders, arms, hair and fingers against both dark and light scenes. Confirm the body boundary is clear without a broad translucent halo, excessive trimming or jagged edges. Check while still and moving; repeat with built-in and USB webcams.
- [ ] Keyboard focus, labeled controls, reduced motion, narrow layout, 200% zoom, and readable status messages work.
- [ ] Partner Center identity, supported Windows versions, permissions, privacy/age declarations, languages, pricing, availability, and support match the actual app.
- [ ] Store copy and ten screenshots match FEATURE_MATRIX.md; native-only or unfinished integration is not advertised as a PWA feature.
- [ ] Record all known limitations and the release decision before submission.
