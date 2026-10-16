# MeetingLens local vision engine

Include `assets/js/vision-effects.js` as an ordinary deferred script. It exposes `window.MeetingLensVision`. The engine does not start until `init()` is called. All inference uses bundled model/runtime files on the app's own origin; it never uploads camera frames.

```js
const vision = window.MeetingLensVision;
const capabilities = await vision.init({
  onStatus: ({ state, message, capabilities }) => updateStatus(message)
});
// Call without awaiting in the animation loop, then use the cached result.
// Requests are serialized and limited to at most eight starts per second.
vision.analyze(rawCanvas, performance.now(), {
  face: autoFraming || skinRefinement || teethRefinement,
  segmentation: backgroundBlur > 0 || portraitLight > 0,
  enabled: effectsEnabled
});
const analysis = vision.latest;
vision.process(rawCanvas, processedCanvas, {
  analysis,
  backgroundBlur: 12, // CSS-pixel equivalent at 1280px wide, range 0..36
  portraitLight: 0.3, // 0..1, soft local fill light on measured person
  skinSmoothing: 0.2, // 0..1, face oval excluding eyes and lips
  teethWhitening: 0.2 // 0..1, plausible light teeth inside measured inner lips
});
const crop = vision.autoFrameCrop(analysis, rawCanvas.width, rawCanvas.height, 1.22);
// Crop processedCanvas, then mirror. Landmark coordinates describe unmirrored input.
```

`init()` resolves `{face, segmentation, backend, eyeContact:false, errors?}`. Partial capability is possible; disable only the failed controls. Backend is `CPU/WASM worker`, never NPU. MediaPipe uses WebGL2 for its image texture bridge even with the CPU inference delegate. A preflight test rejects unavailable WebGL2 cleanly. Current Edge/Chrome with Workers, OffscreenCanvas, ImageBitmap, WebAssembly and WebGL2 are required for AI; ordinary camera/manual controls remain available when these features are absent.

`onStatus` receives `loading`, `ready`, `recovering`, `error` or `unavailable` with a user-readable message and current capabilities. Initialization errors resolve unavailable instead of throwing into the camera UI. Three consecutive inference errors disable the engine. A timed-out initialization is not automatically retried. An explicit retry may call `dispose()` then `init()`.

`analyze(source, timestamp, options)` accepts a decoded video, image or canvas and resolves `{face, faceLandmarks, mask, timestamp, inferenceMs}`. `face` is a normalized `{x,y,width,height,eyes:[{x,y},{x,y}],mouth:{x,y}}`; the box has temporal smoothing while individual landmark positions retain measured values. `faceLandmarks` is an array of 478 normalized `{x,y,z}` points. `mask` is a stable HTMLCanvasElement, white RGB with alpha equal to the soft person confidence. For the pinned single-channel SelfieSegmenter, confidence channel 0 is the person mask, as documented in its model card. `mask` is owned/reused by the engine; copy it if a permanent still is needed. Frames are reduced to a maximum dimension of 640 for inference. Disabled/hidden/busy/throttled calls resolve cached results immediately. Set `{force:true}` for a still image. Results older than 1.5 seconds lose their face and mask rather than apply stale tracking indefinitely.

`process(inputCanvas, outputCanvas, options)` is synchronous and returns the output canvas. Both canvases retain input dimensions. `analysis` may be a still-image result. Refinement is restrained image processing guided by actual facial landmarks, rather than a generative face reconstruction. It cannot repair reflections, restore clipped highlights or guarantee correct teeth classification. Background blur uses the actual segmented person matte and preserves a sharp foreground. Segment boundaries can miss fine hair, fingers or fast movement. `compositeBackgroundBlur(source, mask, target, amount)` is also exposed independently.

Call `reset()` on camera switch, source change or privacy activation. It discards the cached face/mask, clears captured image canvases, invalidates pending results and releases render-buffer references. Call `dispose()` when the page/app is closed or the engine is explicitly unloaded; this terminates the worker and releases its models. Never label eye contact as available: the engine deliberately reports `eyeContact:false`; true gaze correction belongs to a separately implemented Windows native integration.

## Validation

Run `CHROMIUM_PATH=/path/to/chromium node assets/vendor/vision/verify-vision.cjs` with Playwright installed. This validates actual inference on the included professional portrait, plausible face geometry, 478 landmarks, foreground/background mask, alpha silhouette overlap, rendering changes, serialized calls, reset/disposal and absence of third-party requests. Results are written to `VALIDATION.json`. Headless Linux requires working WebGL2; software SwiftShader is sufficient. First combined inference measured around 220–245ms in the software-rendered validation environment; this is not a Windows hardware performance guarantee. Inference runs in a worker, so the animation loop does not wait for it.

## Primary references

- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js
- https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
- https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md

Bundled distribution, model versions, checksums, attribution and licensing are recorded in `THIRD_PARTY_NOTICES.md` and `LICENSE`.
