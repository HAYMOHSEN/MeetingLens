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

## Multiclass person segmentation model

- File: `assets/models/person_segmenter_multiclass.tflite` (16,371,837 bytes).
- Google MediaPipe SelfieMulticlass 256×256 float32 model, immutable version path **1**. Replaces the earlier single-channel SelfieSegmenter in MeetingLens 3.2.0.
- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite
- SHA-256: `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`
- Author listed by the model card: Adel Ahmadyan, Google. Model date: 10 May 2023.
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
- License stated by model card: Apache License 2.0.
- Output classes in zero-based API order: background, hair, body-skin, face-skin, clothes, and others/accessories. MeetingLens forms foreground confidence from `1 - backgroundConfidence`, combines all non-background classes, and calibrates that confidence into alpha for compositing.
- Limitations: boundaries are estimates and are not pixel-perfect masks. Low or back lighting, noise, occlusion and fast motion can reduce quality. More than one person can be included. MeetingLens uses this model only for local visual effects, without identity recognition or surveillance.

Runtime and face-model provenance was recorded on 2026-10-16; replacement person-model provenance was recorded on 2026-10-17. Verify the shipped model bytes against the checksum as part of release packaging. Preserve these notices and the Apache license when redistributing the app.
