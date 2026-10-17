# MeetingLens local vision engine

Include `assets/js/vision-effects.js` as an ordinary deferred script. It exposes `window.MeetingLensVision`. The engine does not start until `init()` is called. All inference uses bundled model/runtime files on the app's own origin; it never uploads camera frames.

```js
const vision = window.MeetingLensVision;
const capabilities = await vision.init({
  onStatus: ({ state, message, capabilities }) => updateStatus(message)
});
// Schedule outside the animation loop. frozenCanvas is the captured camera
// frame and must remain unchanged until this request completes.
const capturedAt = performance.now();
const analysis = await vision.analyze(frozenCanvas, capturedAt, {
  face: autoFraming || skinRefinement || teethRefinement,
  segmentation: !!backgroundImage || backgroundBlur > 0 || portraitLight > 0,
  enabled: effectsEnabled
});
// A skipped/recoverable request can return an older cache. Do not pair it with
// the new capture. The studio retains its previous completed pair in that case.
if (analysis.timestamp >= capturedAt && analysis.mask) {
  vision.process(frozenCanvas, processedCanvas, {
    analysis,
    backgroundImage, // optional decoded HTMLImageElement/canvas for room replacement
    backgroundSoftness: 3, // selected-scene blur, range 0..36
    backgroundBlur: 12, // CSS-pixel equivalent at 1280px wide, range 0..36
    portraitLight: 0.3, // 0..1, soft local fill light on measured person
    skinSmoothing: 0.2, // 0..1, face oval excluding eyes and lips
    teethWhitening: 0.2 // 0..1, plausible light teeth inside measured inner lips
  });
  const crop = vision.autoFrameCrop(analysis, frozenCanvas.width, frozenCanvas.height, 1.22);
  // Crop processedCanvas, then mirror. Landmark coordinates describe unmirrored input.
}
```

`init()` resolves `{face, segmentation, backend, segmentationDelegate, analysisIntervalMs, personModel, eyeContact:false, errors?}`. Partial capability is possible; disable only the failed controls. Person segmentation uses GPU only when the local WebGL renderer probe identifies recognized hardware. Software or unknown renderers use CPU, and GPU initialization failure retries the same person model on CPU. Face Landmarker always uses CPU. Backend text is `GPU person segmentation + CPU/WASM face tracking` or `CPU/WASM worker`, never NPU. Renderer details stay local to the probe and are not exported in capabilities. MediaPipe needs WebGL2 even for its CPU image texture bridge. A preflight test rejects unavailable WebGL2 cleanly. Current Edge/Chrome with Workers, OffscreenCanvas, ImageBitmap, WebAssembly and WebGL2 are required for AI; ordinary camera/manual controls remain available when these features are absent. Inference requests are serialized; `analysisIntervalMs` is a scheduling hint, not a promised frame rate.

`onStatus` receives `loading`, `ready`, `recovering`, `error` or `unavailable` with a user-readable message and current capabilities. Initialization errors resolve unavailable instead of throwing into the camera UI. Three consecutive inference errors disable the engine. A timed-out initialization is not automatically retried. An explicit retry may call `dispose()` then `init()`.

`analyze(source, timestamp, options)` accepts a decoded video, image or canvas and resolves `{face, faceLandmarks, mask, timestamp, inferenceMs}`. `face` is a normalized `{x,y,width,height,eyes:[{x,y},{x,y}],mouth:{x,y}}`; the box has temporal smoothing while individual landmark positions retain measured values. `faceLandmarks` is an array of 478 normalized `{x,y,z}` points. `mask` is a stable HTMLCanvasElement with white RGB and calibrated foreground alpha. The pinned SelfieMulticlass 256×256 model returns six classes: background, hair, body-skin, face-skin, clothes, and others/accessories. The worker validates mask shapes, forms foreground confidence as `1 - backgroundConfidence`, then applies the existing smoothstep endpoint calibration over 0.1–0.9 before converting to alpha. Using one foreground class would omit other body parts. The model is unchanged between GPU and CPU delegates. `mask` is owned/reused by the engine; copy it if a permanent still is needed. Frames are reduced to a maximum dimension of 640 before inference; the model's own tensor is 256×256. Disabled/hidden/busy/throttled calls resolve cached results immediately. Set `{force:true}` for a still image. Results older than 1.5 seconds lose their face and mask rather than apply stale tracking indefinitely.

The studio freezes each live segmentation input into one of two bounded canvases, retaining only the completed frame and one pending frame. It commits a new frame only with that request's successful analysis and never attaches a cached older mask to a newer pose. Replacement, room blur, person lighting, split comparison and snapshots render the matching completed pair. The prior pair stays visible while inference runs; this introduces delay and may lower processed motion cadence, particularly on CPU. While person effects are active, the FPS label counts newly committed matching pairs over measurement windows of at least 1.2 seconds and shows N fps · effects. It shows Processing background… before a usable measurement. Ordinary, Hold original and Basic rendering instead show N fps · preview refresh; that is rendering cadence, not measured physical-camera capture FPS. A pair older than 1.5 seconds from capture is bypassed in favor of the current ordinary video; Hold original and Basic preview also use current video. Camera changes, Stop, Shield, mute and hidden-state cleanup invalidate pending results and clear frame pixels and effect-rate counters. Keep this source/mask pairing when integrating the engine elsewhere; `process()` does not capture a matching source by itself.

`process(inputCanvas, outputCanvas, options)` is synchronous and returns the output canvas. Both canvases retain input dimensions. `analysis` may be a still-image result. Refinement is restrained image processing guided by actual facial landmarks, rather than a generative face reconstruction. It cannot repair reflections, restore clipped highlights or guarantee correct teeth classification. Background blur uses the actual segmented person matte and preserves a sharp foreground. Segment boundaries can miss fine hair, fingers or fast movement. `compositeBackgroundBlur(source, mask, target, amount)` is also exposed independently.

When `backgroundImage` is ready and a person mask is available, the renderer cover-crops the scene without stretching, applies `backgroundSoftness` only to that scene, and composites the camera foreground using a cleaned person matte. The boundary refinement introduced in 3.1.1 is retained: a camera-resolution matte, capped at 1280 pixels along the longest side, is built for each inference result. Nearby camera colors guide uncertain mask pixels through cached tapered 4×4 sampling, selective matching-color contraction and a narrower confidence transition. Partial edge coverage is retained. The replacement stage changes alpha coverage, leaves source RGB unchanged and does not add a second Canvas blur to the person layer. Fine hair, fingers and fast movement can still be misclassified; this is not a high-resolution hair-matting model. The replacement person model is bundled locally and introduces no cloud inference. Missing or unusable images/masks retain the camera rendering. Read `lastBackgroundApplied` or `lastComposition` after processing to report whether replacement actually succeeded. The studio rejects live analysis older than 1.5 seconds before calling the renderer and resets analysis on camera/privacy changes.

Call `reset()` on camera switch, source change or privacy activation. It discards the cached face/mask, clears captured image canvases, invalidates pending results and releases render-buffer references. Call `dispose()` when the page/app is closed or the engine is explicitly unloaded; this terminates the worker and releases its models. Never label eye contact as available: the engine deliberately reports `eyeContact:false`; true gaze correction belongs to a separately implemented Windows native integration.

## Validation

Run `CHROMIUM_PATH=/path/to/chromium node assets/vendor/vision/verify-vision.cjs` with Playwright installed. This validates actual inference on the included professional portrait, plausible face geometry, 478 landmarks, foreground/background mask, alpha silhouette overlap, rendering changes, serialized calls, reset/disposal and absence of third-party requests. Results are written to `VALIDATION.json`; consult the current root VALIDATION.md and retained release records for completed checks and measured timings. Headless Linux requires working WebGL2; software SwiftShader can exercise the CPU path. It does not establish physical-GPU speed or Windows camera performance. Inference runs in a worker, and the animation loop displays the last usable matching frame without waiting for each request.

## Primary references

- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js
- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
- https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md

Bundled distribution, model versions, checksums, attribution and licensing are recorded in `THIRD_PARTY_NOTICES.md` and `LICENSE`.
