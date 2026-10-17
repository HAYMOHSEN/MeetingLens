# Changelog

## 3.2.1 — 2026-10-17

- Fixed live backgrounds remaining inactive when successful person analysis took longer than 1.5 seconds. Genuine new results now record completion time, and matching captured-frame masks have a bounded 1.5–5-second lifetime measured from completion according to actual analysis duration. Fast results retain the normal 1.5-second stall limit; face tracking still expires by capture age.
- Prevented cached, repeated, mismatched or failed responses from refreshing mask expiry or replacing a valid captured-frame pair.
- Extended same-model CPU recovery to GPU execution failures after successful initialization. The worker retries the exact retained input frame and updates the active backend/capabilities; invalid confidence output remains an explicit error.
- Kept usable effects visible during slower processing, displayed decimal effect rates below 10 fps and distinguished background processing from rate measurement. Slow device cadence remains a limitation, not a promised camera/output rate.

Apply the app's Update banner and reload an existing installation. See VALIDATION.md for the completed verification evidence and its limits. Physical Windows hardware and generated-package testing remain separate; this update does not add meeting-app routing or NPU execution.

## 3.2.0 — 2026-10-17

- Replaced the older square SelfieSegmenter with the bundled SelfieMulticlass 256×256 person model. The foreground combines all non-background classes, including body skin, hair, clothing and accessories, to improve shoulder and arm coverage.
- Paired each live person mask with the captured camera frame used for analysis. Replacement, room blur, person lighting, split comparison and snapshots use the completed pair rather than applying an older silhouette to a newer pose.
- Enabled GPU person segmentation for recognized hardware renderers, with the same model on CPU/WebAssembly for software/unknown renderers or failed GPU initialization. Face analysis remains on CPU.
- Kept bounded frame buffers, stale-analysis fallback and privacy cleanup. Matching-frame output adds processing delay and can lower motion cadence on CPU; the FPS label now counts completed person-effect frame updates as effects and labels ordinary rendering as preview refresh.
- Updated model attribution, update guidance and English/Arabic Store copy. Fine hair, fingers, lighting and fast motion remain segmentation limitations; no global output-FPS or perfect-outline guarantee is made.

Apply the app's Update banner and reload to cache the replacement model. See VALIDATION.md for the completed checks and their scope. External meeting-app routing and separate native source remain unchanged.

## 3.1.1 — 2026-10-17

- Reduced the foggy outline around the person during live background replacement with a tighter transition at the person boundary.
- Kept selected-scene softness behind the person without adding blur to the captured foreground.
- Retained local model loading, actual-room fallback, privacy cleanup and the six professional scenes. Fine hair, fingers and fast motion remain subject to segmentation quality and camera conditions.

Apply the app's Update banner and reload an existing installation before evaluating the change. See VALIDATION.md for the completed checks and their limits. The effect still applies to MeetingLens previews and snapshots; external meeting-app routing and native source are unchanged.

## 3.1.0 — 2026-10-16

- Corrected the background-selection limitation: all six professional scenes can now replace the room behind a person in the live MeetingLens camera preview and captured snapshots.
- Made scene selection arm replacement before or after camera start, with automatic local model loading and a dedicated replacement switch.
- Added Use real background to disable replacement and room blur together; Original, Basic preview and zero enhancement intensity bypass background processing.
- Applied scene softness behind the segmented person, with honest loading, unavailable, retry and stale-analysis feedback instead of reporting an effect before it is ready.
- Updated English/Arabic Store copy, policies, feature status and release guidance to distinguish live replacement from the sample and from external meeting-app routing.

Existing installations should apply the app's Update banner and reload the new version. Processing remains local in the CPU/WebAssembly vision worker and requires a WebGL2 texture bridge. This release does not add a virtual camera or send enhanced video into Zoom or Teams. See VALIDATION.md for the completed checks and their limits.

## 3.0.1 — 2026-10-16

- Made local vision failures retryable, including partial model availability, and bounded stale live-analysis use during slow inference.
- Stopped camera, microphone and private recording before activating an app update.
- Preserved photo selection, edits, masks and Undo when imports fail; bounded thumbnails and included enlarged whiteboards in memory limits.
- Prevented delayed backup enablement, queued writes and old recording callbacks from overriding newer user choices.
- Released native camera bitmap buffers deterministically and guarded late frame/device callbacks during disposal and shutdown.
- Preserved exact 64-bit native capability flags and rejected invalid/unreadable requested DirectShow modes.
- Kept the installed PWA in standard standalone mode; a custom window-controls overlay is not implemented.
- Added shipping regression tests, updated screenshots and retained reviewed results. See SHIP_REVIEW.md for publication requirements and validation limits.

## 3.0.0 — 2026-10-16

- Added bundled local face-landmark/person-segmentation models in a CPU/WebAssembly worker, with failure fallback to regular preview/manual controls.
- Added face-based Auto Framing, live Background Blur, Portrait Light, and modest landmark-masked skin/teeth adjustments.
- Added fine digital zoom, reported camera capability/resolution/FPS controls, and Basic preview that bypasses app effects.
- Added Photo Lab for automatic local tone enhancement, Lab reference-color matching, batch JPEG ZIP export, small-object neighborhood inpainting, and manual/assisted face refinement.
- Added perspective whiteboard correction with bright-board corner suggestions, four editable corners, homography rectification, and ink cleanup.
- Added opt-in browser microphone processing, a level meter, and a local test recording limited to 60 seconds.
- Added local QR decoding with jsQR fallback, explicit copying, and optional automatic copying of new QR links.
- Added opt-in snapshot folder/browser backups, latest-50 browser retention, and backup failure feedback.
- Extended Privacy Shield and hidden-app cleanup to microphone sessions and temporary test recordings.
- Added a read-only local Windows capability-report viewer, explicit Settings links, and duplicate-blur guidance.
- Added separate native Windows source for supported KS effect controls, camera preview/modes/zoom, a DirectShow diagnostic, and a pinned Microsoft virtual-camera reference with build instructions.
- Updated policy pages, bilingual Store copy, feature status, release guidance, and ten screenshots.

The PWA still processes its own preview/audio and does not route them into meeting apps. Browser models do not select an NPU or synthesize eye contact. Windows effects depend on hardware; the virtual-camera reference is not connected to the PWA canvas. See FEATURE_MATRIX.md and VALIDATION.md for scope and testing.

## 2.0.1 — 2026-10-16

- Replaced illustrated backgrounds with six realistic professional interiors and matching photo thumbnails.
- Added background-only softness while keeping the original portrait sharp.
- Added reliable image loading, neutral fallback, and offline caching for all six scenes.
- Refreshed Store screenshots and poster artwork.

## 2.0.0 — 2026-10-16

- Redesigned the studio with a light workspace, navy navigation rail, violet controls, and a professional fictional AI demo portrait with a visible label.
- Added color temperature and vignette alongside brightness, contrast, saturation, and visual looks.
- Added true original-view and split-view comparisons.
- Added camera selection and 720p, 1080p, and efficient quality preferences.
- Added six backgrounds for the AI demo portrait; live replacement was subsequently added in 3.1.0.
- Added zoom, mirror, grid, eye-line, and manual framing controls.
- Added immediate or timed PNG/JPEG snapshot downloads.
- Added local preset save, load, delete, import, and export with imported-data validation.
- Improved permission errors, device-loss recovery, and protection against delayed camera requests reopening the camera after a privacy stop.
- Added camera stop when hidden, enabled by default, and clearer Privacy Shield behavior.
- Refined the offline shell and explicit update flow.
- Updated English and Arabic Store copy, six app screenshots, policy wording, and release validation guidance.

This is a local preview PWA. It does not provide an operating-system virtual camera or alter video in external meeting applications. Automated browser checks are accompanied by a required Windows hardware and package-install checklist; release notes do not imply Store certification.

## 1.0.0

- Initial camera-preview studio with visual adjustments, framing guidance, local settings, PNG snapshots, privacy controls, and a PWA shell.
