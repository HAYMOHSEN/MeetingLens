/* MeetingLens local vision worker. The unmodified MediaPipe distribution and
 * models live next to the app; no remote requests or camera uploads are used. */
"use strict";
self.exports = {};
importScripts("./vision_bundle.js");
const { FilesetResolver, FaceLandmarker, ImageSegmenter } = self.exports;
let faceTask = null, segmentTask = null, lastTimestamp = 0;
let initialized = false, initializing = null, initializationGeneration = 0;
let segmentationDelegate = "CPU";

function hasHardwareRenderer(context) {
  // Keep renderer details local to this probe; capabilities never expose them.
  // Missing/private debug information must not opt software rendering into GPU.
  try {
    const info = context.getExtension("WEBGL_debug_renderer_info");
    if (!info) return false;
    const renderer = String(context.getParameter(info.UNMASKED_RENDERER_WEBGL) || "");
    if (!renderer || /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft\s+basic|microsoft.*render|mesa\s+offscreen|gdi\s+generic|\bwarp\b/i.test(renderer)) return false;
    return /nvidia|geforce|quadro|amd|radeon|\bati\b|intel|apple|adreno|qualcomm|\barm\b|mali|powervr|vivante/i.test(renderer);
  } catch { return false; }
}

async function createPersonSegmenter(files, modelAssetPath, delegate) {
  let task = null;
  try {
    task = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false
    });
    const labels = task.getLabels?.();
    if (labels?.length && (labels.length !== 6 || String(labels[0]).trim().toLowerCase() !== "background")) {
      throw new Error("Person segmentation model must provide six classes with background at index 0.");
    }
    return task;
  } catch (error) { task?.close(); throw error; }
}

async function initialize() {
  if (initialized) return capabilities();
  if (initializing) return initializing;
  const generation = initializationGeneration;
  const operation = (async () => {
    // CPU inference still uses WebGL2 for MediaPipe's image texture bridge.
    const probe = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!probe) throw new Error("WebGL2 is disabled or unavailable for local vision processing.");
    const preferGPU = hasHardwareRenderer(probe);
    probe.getExtension("WEBGL_lose_context")?.loseContext();
    const files = await FilesetResolver.forVisionTasks(new URL("./wasm", self.location.href).href);
    const modelRoot = new URL("../../models/", self.location.href);
    const errors = {};
    let nextFaceTask = null, nextSegmentTask = null, nextDelegate = "CPU";
    const rejectCancelled = () => {
      if (generation === initializationGeneration) return;
      nextFaceTask?.close(); nextSegmentTask?.close();
      nextFaceTask = nextSegmentTask = null;
      throw new Error("Local vision initialization was cancelled.");
    };
    rejectCancelled();
    // Sequential construction limits peak memory on lower-powered computers.
    try {
      nextFaceTask = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("face_landmarker.task", modelRoot).href, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false
      });
    } catch (error) { errors.face = error.message || String(error); }
    rejectCancelled();
    try {
      const modelAssetPath = new URL("person_segmenter_multiclass.tflite", modelRoot).href;
      if (preferGPU) {
        try {
          nextSegmentTask = await createPersonSegmenter(files, modelAssetPath, "GPU");
          nextDelegate = "GPU";
        } catch {
          // Retry the same quality model on CPU, never the old selfie model.
          rejectCancelled();
          nextSegmentTask = await createPersonSegmenter(files, modelAssetPath, "CPU");
        }
      } else nextSegmentTask = await createPersonSegmenter(files, modelAssetPath, "CPU");
    } catch (error) { errors.segmentation = error.message || String(error); }
    rejectCancelled();
    faceTask = nextFaceTask; segmentTask = nextSegmentTask;
    segmentationDelegate = nextDelegate;
    initialized = true;
    return { ...capabilities(), errors };
  })();
  initializing = operation;
  try { return await operation; }
  finally { if (initializing === operation) initializing = null; }
}

function capabilities() {
  return { face: Boolean(faceTask), segmentation: Boolean(segmentTask),
    backend: segmentTask && segmentationDelegate === "GPU" ? "GPU person segmentation + CPU/WASM face tracking" : "CPU/WASM worker",
    segmentationDelegate: segmentTask ? segmentationDelegate : "CPU",
    analysisIntervalMs: segmentTask && segmentationDelegate === "GPU" ? 33 : 125,
    personModel: segmentTask ? "SelfieMulticlass 256×256" : null, eyeContact: false };
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
      initializationGeneration++; initializing = null;
      faceTask?.close(); segmentTask?.close(); faceTask = segmentTask = null; initialized = false;
      segmentationDelegate = "CPU"; lastTimestamp = 0;
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
        const masks = segmentation.confidenceMasks;
        const background = masks?.[0];
        const width = background?.width, height = background?.height;
        if (masks?.length !== 6 || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
            masks.some(mask => !mask || mask.width !== width || mask.height !== height || typeof mask.getAsFloat32Array !== "function")) {
          throw new Error("Person segmentation returned an invalid six-class confidence mask.");
        }
        const data = background.getAsFloat32Array();
        if (data.length !== width * height) throw new Error("Person segmentation returned an invalid background confidence shape.");
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i++) {
          if (!Number.isFinite(data[i])) throw new Error("Person segmentation returned an invalid background confidence value.");
          // Preserve every foreground class: hair, body/face skin, clothes,
          // and accessories. One class alone would erase shoulders and arms.
          const person = Math.max(0, Math.min(1, 1 - data[i]));
          // Calibrate confident endpoints after the foreground union so low
          // background noise is opaque room and high-confidence skin is solid.
          const value = Math.max(0, Math.min(1, (person - 0.1) / 0.8));
          const p = i * 4;
          pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
          pixels[p + 3] = Math.round(value * value * (3 - 2 * value) * 255);
        }
        result.mask = { width, height, pixels };
      });
    }
    result.inferenceMs = performance.now() - started;
    self.postMessage({ id, result }, result.mask ? [result.mask.pixels.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  } finally { bitmap?.close(); }
};
