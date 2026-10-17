# Head edge detail validation — 3.2.3

Checked on 17 October 2026 in Chromium 153 on Linux. The supplied unprocessed camera capture reproduced a chair being classified as hair. This release adds an optional closer head analysis using the existing bundled model, enabled by default for replacement and room blur.

## Actual supplied-camera-image check

The unmodified production worker processed the same original image with head detail off and on. Each analysis used a 640×360 bitmap, and the production compositor rendered the matching original at 1280×720. Both outputs used the same plain replacement background. The processed image supplied separately had different framing and was used to identify the reported artifact, not as pixel-aligned ground truth.

| Measured region | Standard analysis | Head edge detail |
|---|---:|---:|
| Chair core, mean alpha | 0.5188 | 0 |
| Wider chair region, mean alpha | 0.4522 | 0.0134 |
| Hair core, mean alpha | 0.99984 | 1 |
| Face and torso cores, mean alpha | 1 | 1 |

The tested arm/shoulder regions retained coverage. All 57,600 lower-body mask pixels outside the head crop stayed identical. The worker reported `headDetail.applied: true`. No page errors or external requests occurred. The source photo, private diagnostic code and private before/after images are excluded from the repository update.

One local CPU run took 464 ms for standard analysis and 654 ms with head detail. These are individual measurements in explicitly configured software graphics, not a Windows device benchmark. The extra pass can lower effect cadence. If full-frame analysis already exceeds six seconds, the worker skips the extra pass and keeps the usable ordinary mask.

## Regression checks

| Command or suite | Result | Scope |
|---|---|---|
| `node scripts/verify-person-worker.cjs` | 17/17 passed | Crop geometry, timestamps, body preservation, disabled/skipped detail, optional failures, GPU-to-CPU recovery, frame budget, memory bound and disposal. |
| `node scripts/verify-ai-startup.cjs` | 22/22 passed | Saved settings, partial availability, diagnostics, flag transport, toggle behavior, privacy/bypass gates and rejection of an old in-flight pair. |
| `node scripts/verify-shipping-camera.cjs` | 11/11 passed | Retry, stale analysis, camera lifecycle and update shutdown. |
| `node scripts/verify-studio.cjs` | 13/13 passed | Layout, manual pixels, presets, snapshots and camera errors. |
| `node scripts/verify-frame-pairing.cjs` | 6/6 passed | Delayed masks, matching source frames, exports, expiry and privacy. |
| `node scripts/verify-offline.cjs` | 3/3 passed | Offline shell/scenes and user-applied update. |
| `node scripts/verify-shipping-shell.cjs` | 6/6 passed | Repository subpath, links, layouts, cache update and offline navigation. |
| `node scripts/verify-background-compositor.cjs` | 15/15 passed | Real model plus pixel checks for edges, hair, opaque cores and fallback. |
| `node assets/vendor/vision/verify-vision.cjs` | Passed | Real bundled face/person inference, rendering, reset, disposal and local-only requests. |
| `scripts/verify-live-backgrounds.cjs` | All 10 scenarios passed | Real models with a canvas MediaStream; scenes, snapshots, slow results, missing assets, bypass, expiry and privacy. |

The first six live-camera scenarios completed in a full run. The remaining four completed in focused runs using `LIVE_BACKGROUND_CHECK` values `Late scene`, `Basic preview`, `Stalled live`, and `Privacy Shield`. The helper now waits for the app's valid completed frame pair and its actual expiry, replacing outdated fixed capture-age waits; pixel assertions remain intact. The complete release command, native and Photo Lab suites were not rerun for this focused correction. Modified JavaScript passed syntax checks. Model bytes remain unchanged.

Set `CHROMIUM_PATH` to an installed Chromium executable when needed. Actual-model checks explicitly enable SwiftShader software graphics; controlled worker checks do not run the models. These checks do not establish physical Windows webcam compatibility, default browser graphics support, NPU behavior or Store package readiness.

## Remaining limits

The head region is localized semantically from the same frame, without a geometric haircut. It can still be wrong for other people, hats, headphones, poses or lighting. Missing/unsuitable regions, a nearby second face and optional failures keep the ordinary mask. Strong window backlighting in the original capture can leave a real pale rim in the hair; the change does not reconstruct clipped highlights or provide pixel-perfect hair matting. Verify live results on the affected Windows camera after deployment.
