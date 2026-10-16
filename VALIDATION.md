# MeetingLens 3.0.0 validation record

Checked on **16 October 2026**. This is development evidence for the tested configuration, not Microsoft Store certification or proof of compatibility with every webcam. Browser tests ran in headless Chromium on Linux; camera/microphone flows used synthetic media and controlled events unless otherwise stated.

## Browser results

**75 browser checks passed** across eight suites.

| Suite | Result | What the checks establish |
|---|---:|---|
| Studio — scripts/verify-studio.cjs | 13/13 | Loading/navigation, responsive layout, adjustments, original/split comparison, presets and hostile/blocked storage, image downloads/timers, camera lifecycle, permission races, hidden-app release, disconnect and permission-denial recovery. |
| Backgrounds — scripts/verify-backgrounds.cjs | 6/6 | Six scene assets/thumbnails, distinct scene rendering, stable portrait, background-only softness, rapid-switch and missing-image recovery, and Privacy Shield release. |
| Offline — scripts/verify-offline.cjs | 3/3 | Cached app/resources, selectable scenes offline, and controlled service-worker updates/cache cleanup. |
| Advanced studio — scripts/verify-advanced.cjs | 9/9 | Integrated local face analysis/effects, framing and blur output, fine zoom, Basic preview, driver capability preferences/fallback, session integration, and privacy boundaries. |
| Photo Lab — scripts/verify-photo-workbench.cjs | 18/18 | Imports/limits, real tone/color processing, reference matching, local inpainting/retouch, Undo/reset, batch JPEG ZIP export, whiteboard sample/perspective correction, responsive layout, validation, and browser-error checks. |
| Session — scripts/verify-session.cjs | 13/13 | Explicit microphone access, a real local recording blob from synthetic audio, privacy/cancellation, IndexedDB latest-50 backups/deletion, QR fixture decoding/copy, and simulated folder permissions/writes. |
| Native report — scripts/verify-native-report.cjs | 8/8 | Real v1 report schema rendering, rational FPS, duplicate-blur warning, safe text rendering of hostile strings, malformed/oversize/schema rejection, narrow layout, clearing, and no capture requests. |
| Offline tools — scripts/verify-offline-tools.cjs | 5/5 | Actual service-worker caching, Photo Lab/whiteboard JPEG export, local native-report import, real QR decoding, and face/segmentation model inference after the HTTP server was closed and the browser switched offline. |

Suite totals are behavioral scenarios, not a guarantee of defect-free software. The session folder tests use simulated directory APIs; they do not replace a real Windows folder permission/write test. Synthetic microphones do not establish speech clarity or real-room noise suppression. File exports and QR decoding are actual browser outputs from controlled fixtures.

Native-report testing exposed and corrected overflow from long imported text at a 390-pixel viewport. The viewer reads JSON locally, renders strings as text, and does not control the camera or persist its report.

Reviewed JSON results are included in docs/validation/. The separate offline-tools run detected 478 face landmarks and a person mask from cached models; its fixture inference took approximately 200 ms in Linux/SwiftShader. This is not a Windows performance measurement.

## Real bundled vision inference

The local vision verification ran the included models in a CPU/WebAssembly worker using the bundled sample fixture. Results are recorded in assets/vendor/vision/VALIDATION.json.

- Face landmarks were detected: **478 landmarks**.
- Person segmentation returned foreground/background/partial pixels, with fixture silhouette intersection-over-union **0.9873**.
- The controlled blur fixture changed the background (mean absolute error **47.29**) while retaining the tested foreground pixels (mean absolute error **0**).
- Local framing produced a changed crop, six concurrent requests were exercised, and reset/disposal checks passed.
- The recorded fixture inference took approximately **234 ms** in that run. This is one Linux test measurement, not an FPS, battery, NPU, or Windows performance claim.
- Recorded model/script/image requests were local app paths; the check reported no uncaught browser errors. The implementation uses local CPU/WebAssembly and reports eye contact as unsupported.

These fixture metrics do not predict every face, hairstyle, room, movement, or lighting condition. Inspect real webcam results and provide manual controls/fallbacks.

## Native Windows source validation

Evidence: native-windows/validation/managed-source-check.json.

- Managed Windows UI source compilation **passed** against **209 official .NET/Windows reference assemblies**, using warnings as errors.
- **10 Kernel Streaming protocol checks passed** in a Linux harness, including property/header layout, allowed-mode filtering, response parsing, truncation, oversized payload, and driver-failure rejection.

**Not run:** full Windows publishing, DirectShow C++ compilation, upstream virtual-camera C++ compilation, physical camera/microphone/NPU testing, and end-to-end meeting-app validation. Cross-compilation/source validation does not prove that a Windows executable installs/runs successfully or that a driver implements any given effect.

## Historical v2.0.1 baseline

The previous professional-background update passed 22 checks on 16 October 2026: six background, 13 studio, and three offline/update scenarios. Visual checks covered 1920×1080, 1366×768, and 390×844. Those historical results remain a separate baseline; the table above describes the new v3 test run.

## Release requirements still separate

Complete RELEASE_CHECKLIST.md with real built-in/USB webcams and microphones on supported Windows builds and the actual generated PWABuilder package. Record sustained performance, driver modes, sleep/resume, folder permissions, microphone quality, and supported Windows effects. Verify offline inference after completed caching, not just an offline page shell.

The PWA does not route its processed canvas or audio into other meeting applications. The separate native virtual-camera reference is not connected to that canvas. A capability report is a read-only snapshot, not native-to-browser live control. Windows manages NPU use for its supported effects; the browser implementation does not select an NPU.

Fill in the real publisher/support contacts in privacy.html and terms.html before publication. Confirm that the deployed app, policies, ten Store screenshots, listing, and final package describe the same release. Retain reviewed test output; do not ship transient browser profiles or private QA data in the source archive.
