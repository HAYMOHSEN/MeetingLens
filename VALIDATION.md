# MeetingLens 3.2.0 validation record

Checked for the **17 October 2026** release. This is development evidence for the tested configuration, not Microsoft Store certification or proof of compatibility with every webcam. Browser tests ran in headless Chromium on Linux; camera/microphone flows used synthetic media and controlled events unless otherwise stated.

## Release regression scope

The current release command covers **145 browser checks across fifteen browser suites**, plus **five Node worker-protocol checks**, for **150 behavioral checks**. The real bundled-vision verification runs separately in the same command; historical native checks are also separate.

Final serial command result: **passed, exit code 0**. All 145 browser scenarios and five Node worker-protocol checks passed, followed by the separate real bundled-vision verification.

| Browser suite | Checks | What the checks exercise |
|---|---:|---|
| Studio — scripts/verify-studio.cjs | 13 | Loading/navigation, responsive layout, adjustments, original/split comparison, presets and hostile/blocked storage, image downloads/timers, camera lifecycle, permission races, hidden-app release, disconnect and permission-denial recovery. |
| Backgrounds — scripts/verify-backgrounds.cjs | 6 | Six scene assets/thumbnails, distinct scene rendering, stable portrait, background-only softness, rapid-switch and missing-image recovery, and Privacy Shield release. |
| Offline — scripts/verify-offline.cjs | 3 | Cached app/resources, selectable scenes offline, and controlled service-worker updates/cache cleanup. |
| Advanced studio — scripts/verify-advanced.cjs | 9 | Integrated local face analysis/effects, framing and blur output, fine zoom, Basic preview, driver capability preferences/fallback, session integration, and privacy boundaries. |
| Photo Lab — scripts/verify-photo-workbench.cjs | 18 | Imports/limits, real tone/color processing, reference matching, local inpainting/retouch, Undo/reset, batch JPEG ZIP export, whiteboard sample/perspective correction, responsive layout, validation, and browser-error checks. |
| Session — scripts/verify-session.cjs | 13 | Explicit microphone access, a real local recording blob from synthetic audio, privacy/cancellation, IndexedDB latest-50 backups/deletion, QR fixture decoding/copy, and simulated folder permissions/writes. |
| Native report — scripts/verify-native-report.cjs | 9 | Real v1 report schema rendering, exact 64-bit decimal flags, rational FPS, duplicate-blur warning, safe text rendering of hostile strings, malformed/oversize/schema rejection, narrow layout, clearing, and no capture requests. |
| Offline tools — scripts/verify-offline-tools.cjs | 5 | Actual service-worker caching, Photo Lab/whiteboard JPEG export, local native-report import, real QR decoding, and face/segmentation model inference after the HTTP server was closed and the browser switched offline. |
| Shipping camera — scripts/verify-shipping-camera.cjs | 11 | Full/partial model retry, stale worker isolation and cancellation, bounded live analysis, hidden/error sample recovery, still-analysis retention, update shutdown and video-only status wording. |
| Shipping photo — scripts/verify-shipping-photo.cjs | 7 | Rejected-import edit/selection/mask/Undo preservation, bounded tall-image thumbnails, enlarged-whiteboard memory accounting, alpha/EXIF handling and export. |
| Shipping session — scripts/verify-shipping-session.cjs | 16 | Backup mode/picker/deletion races, recorder callback isolation, tied-time retention, database retry/late connection closure, quota/write aborts, QR privacy and late microphone cleanup. |
| Shipping shell — scripts/verify-shipping-shell.cjs | 6 | Local links/assets, manifest scope/dimensions, actual repository-path service worker, 320/768/1366 layouts/named controls, offline pages and scoped update/cache cleanup. |
| Background compositor — scripts/verify-background-compositor.cjs | 15 | Actual scene/person compositing, foreground preservation, aspect-cover cropping, scene-only softness, matte edge cleanup, narrower confidence transitions, exact clothing texture, partial hair coverage, smooth diagonal boundaries, unavailable-image/mask fallback, real bundled segmentation and browser errors. |
| Live backgrounds — scripts/verify-live-backgrounds.cjs | 9 | All six scenes on a controlled MediaStream, automatic model loading, actual PNG export, real-room restore, delayed/missing models, scene-loading races, original/Basic bypass, stale masks, Shield and camera restart. |
| Matching frames — scripts/verify-frame-pairing.cjs | 5 | Moving captured poses with delayed analysis, cached/failed inference recovery, current Original/Basic preview, matching split comparison and actual PNG export, and Shield/stop/mute/hidden-state buffer cleanup with late-result rejection. |

Suite totals are behavioral scenarios, not a guarantee of defect-free software. The session folder tests use simulated directory APIs; they do not replace a real Windows folder permission/write test. Synthetic microphones do not establish speech clarity or real-room noise suppression. File exports and QR decoding are actual browser outputs from controlled fixtures.

Native-report testing exposed and corrected overflow from long imported text at a 390-pixel viewport. The viewer reads JSON locally, renders strings as text, and does not control the camera or persist its report.

Reviewed JSON results belong in docs/validation/ and must be refreshed from the completed final command before delivery. Recorded fixture timings describe Linux/SwiftShader runs, not Windows performance. SHIP_REVIEW.md lists corrected defects and the remaining publication requirements.

The live-background checks feed a generated portrait and a controlled room through an actual browser MediaStream and the bundled segmentation model. Pixel comparisons verify that all six scenes change the room while retaining measured foreground pixels; the exported PNG is decoded and checked too. This reproduces the live rendering path without opening a physical webcam. The Store background screenshot shows that controlled stream and visibly labels the generated-portrait demonstration. Real-camera quality across hair, motion and lighting still requires Windows hardware testing.

The boundary regressions compare a broad confidence ramp with an independent copy of the prior rendering path. Separate fixtures check clothing texture, partial hair strands and gaps, gradual diagonal crossings without ringing, room-color fringe cleanup and unchanged subject pixels when only scene softness increases. Consult the refreshed compositor JSON for current transition-width, fringe and timing measurements. These are fixture measurements, not quality guarantees for every webcam. A passing synthetic hair fixture does not prove that the model detects every real hair, and Linux fixture timings are not Windows frame-rate claims.

## Worker-protocol checks

scripts/verify-person-worker.cjs adds **five Node checks** using deterministic MediaPipe task doubles. They cover the complete foreground union and alpha calibration, same-model CPU fallback after GPU initialization failure, software/private/unknown renderer handling, invalid class shapes/confidence rejection, and disposal during initialization followed by a clean retry. They exercise the worker protocol; actual model quality is checked separately. These five checks plus the 145 browser scenarios make 150; the standalone real-vision module is not counted again.

## Supplied-camera-photo production-path check

The sanitized report in docs/validation/production-camera-validation.json records a completed check using one supplied camera still streamed through the actual production camera path and the bundled SelfieMulticlass 256×256 model on CPU/WebAssembly. It tested **all six scenes**, with **eight foreground regions** and **two background regions per scene**. This is a still-image source in an actual browser MediaStream, not a physical Windows webcam session or a live-motion test.

- Minimum sampled foreground alpha: **1**; maximum sampled foreground RGB difference from the source: **0**.
- Maximum sampled background alpha: **0**; maximum background RGB difference from the selected scene: **0**.
- The exported **1920×1080 PNG** matched the compared rendered output, with maximum and mean RGB differences both **0**.
- A fresh matching frame pair was confirmed before every scene measurement. A later metadata query expired during readback/encoding; the report retains this timing qualification.
- No uncaught errors were recorded, and requests remained on the same origin.

These region samples demonstrate that the tested body areas were retained and the sampled room areas replaced in this supplied image. They do not establish perfect segmentation across every pixel, pose, person or webcam. The retained report contains numerical summaries only; the supplied image, private paths and intermediate renders are excluded from deliverables.

Version 3.2.0 combines all non-background model classes and displays each completed mask with its matching captured frame. It retains the preceding completed pair while the next analysis runs, adding delay and potentially reducing motion cadence, especially on CPU. The interface measures new completed pairs as fps · effects; ordinary/Original/Basic rendering is labeled fps · preview refresh. Preview refresh is not physical-camera capture FPS. Pair freshness is limited to 1.5 seconds. Recognized hardware can use GPU segmentation, with the same model on CPU when GPU initialization fails or the renderer is software/unknown; physical-GPU performance remains untested.

## Real bundled vision inference

The separate real-vision verification exercised the replacement person model and existing Face Landmarker in a local worker using the bundled sample fixture. The completed v3.2.0 results are retained in assets/vendor/vision/VALIDATION.json. Status: **passed**.

- Detected face landmarks: **478**.
- Person-mask fixture silhouette intersection-over-union: **0.9932**.
- Controlled blur background mean absolute error: **47.29**; foreground mean absolute error: **0.00**.
- Framing, six concurrent requests and reset/disposal checks passed. Requests stayed on the same origin and no uncaught browser errors were recorded.
- Measured fixture inference time in milliseconds: **484.3**. This is one Linux measurement, not an FPS, battery, NPU, or Windows performance claim.
- The tested backend was CPU/WASM worker, with CPU segmentation. Production person segmentation may use recognized hardware GPUs; the same model is available on CPU/WebAssembly, face tracking stays on CPU and eye contact remains unsupported.

These fixture metrics do not predict every face, hairstyle, room, movement, or lighting condition. Inspect real webcam results and provide manual controls/fallbacks.

## Historical native Windows source validation

Evidence: native-windows/validation/managed-source-check.json.

- Managed Windows UI source compilation **passed** against **209 official .NET/Windows reference assemblies**, using warnings as errors.
- **12 Kernel Streaming protocol/report checks passed** in a Linux harness, including property/header layout, allowed-mode filtering, response parsing, truncation, oversized payload, driver-failure rejection and exact nullable 64-bit flag serialization.

**Not run:** full Windows publishing, DirectShow C++ compilation, upstream virtual-camera C++ compilation, physical camera/microphone/NPU testing, and end-to-end meeting-app validation. Cross-compilation/source validation does not prove that a Windows executable installs/runs successfully or that a driver implements any given effect.

## Historical v2.0.1 baseline

The previous professional-background update passed 22 checks on 16 October 2026: six background, 13 studio, and three offline/update scenarios. Visual checks covered 1920×1080, 1366×768, and 390×844. Those historical results remain a separate baseline; the table above describes the v3.2.0 verification scope.

## Release requirements still separate

Complete RELEASE_CHECKLIST.md with real built-in/USB webcams and microphones on supported Windows builds and the actual generated PWABuilder package. Record sustained performance, driver modes, sleep/resume, folder permissions, microphone quality, and supported Windows effects. Verify offline inference after completed caching, not just an offline page shell.

The PWA does not route its processed canvas or audio into other meeting applications. The separate native virtual-camera reference is not connected to that canvas. A capability report is a read-only snapshot, not native-to-browser live control. Windows manages NPU use for its supported effects; the browser implementation does not select an NPU.

Fill in the real publisher/support contacts in privacy.html and terms.html before publication. Confirm that the deployed app, policies, ten Store screenshots, listing, and final package describe the same release. Retain reviewed test output; do not ship transient browser profiles or private QA data in the source archive.
