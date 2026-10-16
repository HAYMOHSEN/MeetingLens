# MediaPipe runtime and model attribution

MeetingLens uses Google MediaPipe on the device. Google does not receive input images through this integration. This product is not affiliated with or endorsed by Google.

## Runtime

- Package: `@mediapipe/tasks-vision`, pinned version **0.10.21**.
- Publisher: MediaPipe Authors / Google.
- Source: https://github.com/google-ai-edge/mediapipe
- Download: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz
- npm SHA-512 integrity: `sha512-TuhKH+credq4zLksGbYrnvJ1aLIWMc5r0UHwzxzql4BHECJwIAoBR61ZrqwGOW6ZmSBIzU1t4VtKj8hbxFaKeA==`
- Files: unmodified `vision_bundle.cjs`, `vision_bundle.mjs`, SIMD and non-SIMD JavaScript/WASM loaders, upstream README and package metadata. `vision_bundle.js` is a byte-identical copy of `vision_bundle.cjs`, provided with a conventional `.js` extension so GitHub Pages serves the correct JavaScript MIME type. The classic worker imports that bundle via `importScripts` and an `exports` namespace. MeetingLens-specific code is in `meetinglens-worker.js` and `../../js/vision-effects.js`; it is separate from the vendored runtime.
- License: Apache License 2.0; complete text in `LICENSE`.

Both WASM builds are included so the upstream FilesetResolver can select SIMD when supported and ordinary WASM otherwise. No CDN URLs are used at runtime.

## Face Landmarker model bundle

- File: `assets/models/face_landmarker.task` (3,758,596 bytes).
- Google MediaPipe Face Landmarker float16 model bundle, immutable version path **1**.
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Contains short-range face detection, 478-point Face Mesh V2 and face blendshape models. MeetingLens does not enable expression/blendshape output, facial identity recognition or identity storage.
- Face Mesh V2 model authors: Geng Yan and Ivan Grishchenko, Google.
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- License stated by Google model cards: Apache License 2.0.
- Additional bundled model cards linked by the official overview: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

## Selfie Segmentation model

- File: `assets/models/selfie_segmenter.tflite` (249,537 bytes).
- Google MediaPipe SelfieSegmenter square float16 model, immutable version path **1**, input 256×256.
- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
- SHA-256: `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`
- Authors: Tingbo Hou, Siargey Pisarchyk and Karthik Raveendran, Google.
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf
- License stated by model card: Apache License 2.0.
- Limitations: matte boundaries are estimates; fine features, distance, low light, occlusion and fast movement can reduce quality. Multiple similarly sized people may all be included in the matte. This model is used for local visual effects and is not an identity or surveillance system.

Model and runtime download/checksum verification was performed on 2026-10-16. Preserve these notices and the Apache license when redistributing the app.
