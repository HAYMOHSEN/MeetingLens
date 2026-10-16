/* MeetingLens local vision worker. The unmodified MediaPipe distribution and
 * models live next to the app; no remote requests or camera uploads are used. */
"use strict";
self.exports = {};
importScripts("./vision_bundle.js");
const { FilesetResolver, FaceLandmarker, ImageSegmenter } = self.exports;
let faceTask = null, segmentTask = null, lastTimestamp = 0;
let initialized = false, initializing = null;

async function initialize() {
  if (initialized) return capabilities();
  if (initializing) return initializing;
  initializing = (async () => {
    // CPU inference still uses WebGL2 for MediaPipe's image texture bridge.
    const probe = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!probe) throw new Error("WebGL2 is disabled or unavailable for local vision processing.");
    probe.getExtension("WEBGL_lose_context")?.loseContext();
    const files = await FilesetResolver.forVisionTasks(new URL("./wasm", self.location.href).href);
    const modelRoot = new URL("../../models/", self.location.href);
    const errors = {};
    // Sequential construction limits peak memory on lower-powered computers.
    try {
      faceTask = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("face_landmarker.task", modelRoot).href, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false
      });
    } catch (error) { errors.face = error.message || String(error); }
    try {
      segmentTask = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("selfie_segmenter.tflite", modelRoot).href, delegate: "CPU" },
        runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false
      });
    } catch (error) { errors.segmentation = error.message || String(error); }
    initialized = true;
    return { ...capabilities(), errors };
  })();
  return initializing;
}

function capabilities() {
  return { face: Boolean(faceTask), segmentation: Boolean(segmentTask), backend: "CPU/WASM worker", eyeContact: false };
}

function describeFace(points) {
  if (!points?.length) return null;
  let x = 1, y = 1, right = 0, bottom = 0;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const midpoint = (a, b) => ({ x: (points[a].x + points[b].x) / 2, y: (points[a].y + points[b].y) / 2 });
  return { x, y, width: right - x, height: bottom - y,
    eyes: [midpoint(33, 133), midpoint(362, 263)], mouth: midpoint(13, 14) };
}

self.onmessage = async event => {
  const { id, type, bitmap, timestamp, options = {} } = event.data;
  try {
    if (type === "init") { self.postMessage({ id, capabilities: await initialize() }); return; }
    if (type === "dispose") {
      faceTask?.close(); segmentTask?.close(); faceTask = segmentTask = null; initialized = false;
      self.postMessage({ id, disposed: true }); return;
    }
    if (type !== "analyze") return;
    const started = performance.now();
    lastTimestamp = Math.max(lastTimestamp + 1, Number(timestamp) || performance.now());
    const result = { timestamp: lastTimestamp, face: null, faceLandmarks: null, mask: null };
    if (options.face !== false && faceTask) {
      const faces = faceTask.detectForVideo(bitmap, lastTimestamp);
      result.faceLandmarks = faces.faceLandmarks?.[0] || null;
      result.face = describeFace(result.faceLandmarks);
    }
    if (options.segmentation !== false && segmentTask) {
      // Copy inside the callback: MediaPipe owns/reuses the underlying memory.
      segmentTask.segmentForVideo(bitmap, lastTimestamp, segmentation => {
        const person = segmentation.confidenceMasks?.[0];
        if (!person) return;
        const data = person.getAsFloat32Array();
        const pixels = new Uint8ClampedArray(person.width * person.height * 4);
        for (let i = 0; i < data.length; i++) {
          const value = Math.max(0, Math.min(1, (data[i] - 0.1) / 0.8));
          const p = i * 4;
          pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
          pixels[p + 3] = Math.round(value * value * (3 - 2 * value) * 255);
        }
        result.mask = { width: person.width, height: person.height, pixels };
      });
    }
    result.inferenceMs = performance.now() - started;
    self.postMessage({ id, result }, result.mask ? [result.mask.pixels.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  } finally { bitmap?.close(); }
};
