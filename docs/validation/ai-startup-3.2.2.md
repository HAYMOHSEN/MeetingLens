# AI startup correction validation — 3.2.2

Checked on 17 October 2026 with Chromium 153 in a Linux test environment. This patch restores model loading for saved effects and makes failures readable. The exact startup failure on the reported Windows browser remains unconfirmed.

| Check | Result | Scope |
|---|---|---|
| `node scripts/verify-ai-startup.cjs` | 18/18 passed | Real studio/vision bridge with controlled worker responses and browser fake camera. Startup/model/frame errors, literal text rendering, recovery, saved settings, bypass gates, stable partial workers, truthful blur status, and independent face processing. |
| `node scripts/verify-shipping-camera.cjs` | 11/11 passed | Controlled worker faults, fake camera/microphone, stale analysis, retries, privacy and explicit-update shutdown. |
| `node scripts/verify-studio.cjs` | 13/13 passed | Layout, manual pixel changes, presets, snapshots, camera lifecycle and failure recovery. |
| `node scripts/verify-offline.cjs` | 3/3 passed | Actual service worker, offline scenes/shortcuts and user-applied update. |
| `node scripts/verify-shipping-shell.cjs` | 6/6 passed | Repository subpath, local links, manifest, compact layouts, offline navigation and scoped cache cleanup. |
| `LIVE_BACKGROUND_CHECK='Choosing a background' node scripts/verify-live-backgrounds.cjs` | 1/1 passed | Bundled model inference and automatic camera-background startup, using a canvas MediaStream with a fictional portrait. |

Set `CHROMIUM_PATH` when using an existing Chromium installation. Modified JavaScript passed `node --check`. The new startup suite is available as `npm run test:ai-startup` and is included in `npm run test:release`; the full release command was not rerun for this focused patch.

The real-model check explicitly enables SwiftShader software graphics. It demonstrates inference in that configured browser, not default browser graphics support, hardware GPU/NPU acceleration, physical Windows webcam compatibility or Store package readiness. Controlled worker tests do not run the models. No physical Windows device was available for these checks.

The published 3.2.1 origin was separately checked: ten startup/runtime/model files returned HTTP 200 and matched the intended local bytes, with appropriate JavaScript/WASM MIME types. That rules out missing or corrupt origin files in those requests; a particular client's cached version and graphics capabilities still require diagnosis. The new disclosure shows errors already returned by the local worker, stores them only in tab memory and sends no error reports.

The model, runtime and WebGL2 requirement are unchanged. Existing installations must apply the app's Update banner and reload after this patch is deployed. Reproduce any remaining failure on the affected Windows installation and read **Live effects → AI diagnostic details** before claiming its startup cause is resolved.
