# MeetingLens 3.1.1 validation record

Checked for the **17 October 2026** release. This is development evidence for the tested configuration, not Microsoft Store certification or proof of compatibility with every webcam. Browser tests ran in headless Chromium on Linux; camera/microphone flows used synthetic media and controlled events unless otherwise stated.

## Browser results

**140 browser checks passed** across fourteen suites. This includes the existing camera, photo, session and shipping workflows, plus 24 checks for the live background compositor and its camera integration.

| Suite | Result | What the checks establish |
|---|---:|---|
| Studio — scripts/verify-studio.cjs | 13/13 | Loading/navigation, responsive layout, adjustments, original/split comparison, presets and hostile/blocked storage, image downloads/timers, camera lifecycle, permission races, hidden-app release, disconnect and permission-denial recovery. |
| Backgrounds — scripts/verify-backgrounds.cjs | 6/6 | Six scene assets/thumbnails, distinct scene rendering, stable portrait, background-only softness, rapid-switch and missing-image recovery, and Privacy Shield release. |
| Offline — scripts/verify-offline.cjs | 3/3 | Cached app/resources, selectable scenes offline, and controlled service-worker updates/cache cleanup. |
| Advanced studio — scripts/verify-advanced.cjs | 9/9 | Integrated local face analysis/effects, framing and blur output, fine zoom, Basic preview, driver capability preferences/fallback, session integration, and privacy boundaries. |
| Photo Lab — scripts/verify-photo-workbench.cjs | 18/18 | Imports/limits, real tone/color processing, reference matching, local inpainting/retouch, Undo/reset, batch JPEG ZIP export, whiteboard sample/perspective correction, responsive layout, validation, and browser-error checks. |
| Session — scripts/verify-session.cjs | 13/13 | Explicit microphone access, a real local recording blob from synthetic audio, privacy/cancellation, IndexedDB latest-50 backups/deletion, QR fixture decoding/copy, and simulated folder permissions/writes. |
| Native report — scripts/verify-native-report.cjs | 9/9 | Real v1 report schema rendering, exact 64-bit decimal flags, rational FPS, duplicate-blur warning, safe text rendering of hostile strings, malformed/oversize/schema rejection, narrow layout, clearing, and no capture requests. |
| Offline tools — scripts/verify-offline-tools.cjs | 5/5 | Actual service-worker caching, Photo Lab/whiteboard JPEG export, local native-report import, real QR decoding, and face/segmentation model inference after the HTTP server was closed and the browser switched offline. |
| Shipping camera — scripts/verify-shipping-camera.cjs | 11/11 | Full/partial model retry, stale worker isolation and cancellation, bounded live analysis, hidden/error sample recovery, still-analysis retention, update shutdown and video-only status wording. |
| Shipping photo — scripts/verify-shipping-photo.cjs | 7/7 | Rejected-import edit/selection/mask/Undo preservation, bounded tall-image thumbnails, enlarged-whiteboard memory accounting, alpha/EXIF handling and export. |
| Shipping session — scripts/verify-shipping-session.cjs | 16/16 | Backup mode/picker/deletion races, recorder callback isolation, tied-time retention, database retry/late connection closure, quota/write aborts, QR privacy and late microphone cleanup. |
| Shipping shell — scripts/verify-shipping-shell.cjs | 6/6 | Local links/assets, manifest scope/dimensions, actual repository-path service worker, 320/768/1366 layouts/named controls, offline pages and scoped update/cache cleanup. |
| Background compositor — scripts/verify-background-compositor.cjs | 15/15 | Actual scene/person compositing, foreground preservation, aspect-cover cropping, scene-only softness, matte edge cleanup, narrower confidence transitions, exact clothing texture, partial hair coverage, smooth diagonal boundaries, unavailable-image/mask fallback, real bundled segmentation and browser errors. |
| Live backgrounds — scripts/verify-live-backgrounds.cjs | 9/9 | All six scenes on a controlled MediaStream, automatic model loading, actual PNG export, real-room restore, delayed/missing models, scene-loading races, original/Basic bypass, stale masks, Shield and camera restart. |

Suite totals are behavioral scenarios, not a guarantee of defect-free software. The session folder tests use simulated directory APIs; they do not replace a real Windows folder permission/write test. Synthetic microphones do not establish speech clarity or real-room noise suppression. File exports and QR decoding are actual browser outputs from controlled fixtures.

Native-report testing exposed and corrected overflow from long imported text at a 390-pixel viewport. The viewer reads JSON locally, renders strings as text, and does not control the camera or persist its report.

Reviewed JSON results are included in docs/validation/. The separate offline-tools run detected 478 face landmarks and a person mask from cached models. Recorded fixture timings describe Linux/SwiftShader runs, not Windows performance. SHIP_REVIEW.md lists corrected defects and the remaining publication requirements.

The live-background checks feed a generated portrait and a controlled room through an actual browser MediaStream and the bundled segmentation model. Pixel comparisons verify that all six scenes change the room while retaining measured foreground pixels; the exported PNG is decoded and checked too. This reproduces the live rendering path without opening a physical webcam. The Store background screenshot shows that controlled stream and visibly labels the generated-portrait demonstration. Real-camera quality across hair, motion and lighting still requires Windows hardware testing.

The v3.1.1 boundary regressions compare a broad confidence ramp with an independent copy of the prior rendering path. The measured 10–90% transition narrowed from 77 to 37 pixels while retaining intermediate alpha coverage. The controlled room-fringe fixture measured a 40.7% reduction against its untrimmed baseline. Separate fixtures check byte-exact clothing texture, visible partial hair strands and gaps, gradual diagonal crossings without ringing, and unchanged subject pixels when only scene softness increases. These are fixture measurements, not quality guarantees for every webcam. A passing synthetic hair fixture does not prove that the model detects every real hair. Refinement timings in the JSON record describe this Linux fixture only; they are not Windows frame-rate claims.

## Real bundled vision inference

The local vision verification ran the included models in a CPU/WebAssembly worker using the bundled sample fixture. Results are recorded in assets/vendor/vision/VALIDATION.json.

- Face landmarks were detected: **478 landmarks**.
- Person segmentation returned foreground/background/partial pixels, with fixture silhouette intersection-over-union **0.9873**.
- The controlled blur fixture changed the background (mean absolute error **47.29**) while retaining the tested foreground pixels (mean absolute error **0**).
- Local framing produced a changed crop, six concurrent requests were exercised, and reset/disposal checks passed.
- The JSON report includes its measured fixture inference time. This is one Linux test measurement, not an FPS, battery, NPU, or Windows performance claim.
- Recorded model/script/image requests were local app paths; the check reported no uncaught browser errors. The implementation uses local CPU/WebAssembly and reports eye contact as unsupported.

These fixture metrics do not predict every face, hairstyle, room, movement, or lighting condition. Inspect real webcam results and provide manual controls/fallbacks.

## Native Windows source validation

Evidence: native-windows/validation/managed-source-check.json.

- Managed Windows UI source compilation **passed** against **209 official .NET/Windows reference assemblies**, using warnings as errors.
- **12 Kernel Streaming protocol/report checks passed** in a Linux harness, including property/header layout, allowed-mode filtering, response parsing, truncation, oversized payload, driver-failure rejection and exact nullable 64-bit flag serialization.

**Not run:** full Windows publishing, DirectShow C++ compilation, upstream virtual-camera C++ compilation, physical camera/microphone/NPU testing, and end-to-end meeting-app validation. Cross-compilation/source validation does not prove that a Windows executable installs/runs successfully or that a driver implements any given effect.

## Historical v2.0.1 baseline

The previous professional-background update passed 22 checks on 16 October 2026: six background, 13 studio, and three offline/update scenarios. Visual checks covered 1920×1080, 1366×768, and 390×844. Those historical results remain a separate baseline; the table above describes the v3.1.1 test run.

## Release requirements still separate

Complete RELEASE_CHECKLIST.md with real built-in/USB webcams and microphones on supported Windows builds and the actual generated PWABuilder package. Record sustained performance, driver modes, sleep/resume, folder permissions, microphone quality, and supported Windows effects. Verify offline inference after completed caching, not just an offline page shell.

The PWA does not route its processed canvas or audio into other meeting applications. The separate native virtual-camera reference is not connected to that canvas. A capability report is a read-only snapshot, not native-to-browser live control. Windows manages NPU use for its supported effects; the browser implementation does not select an NPU.

Fill in the real publisher/support contacts in privacy.html and terms.html before publication. Confirm that the deployed app, policies, ten Store screenshots, listing, and final package describe the same release. Retain reviewed test output; do not ship transient browser profiles or private QA data in the source archive.
