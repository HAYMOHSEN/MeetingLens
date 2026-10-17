/* MeetingLens local vision worker. The unmodified MediaPipe distribution and
 * models live next to the app; no remote requests or camera uploads are used. */
"use strict";
self.exports = {};
importScripts("./vision_bundle.js");
const { FilesetResolver, FaceLandmarker, ImageSegmenter } = self.exports;
let faceTask = null, segmentTask = null, lastTimestamp = 0, lastPersonTimestamp = 0;
let initialized = false, initializing = null, initializationGeneration = 0;
let segmentationDelegate = "CPU";
let personSettings = null;

function closeTask(task) { try { task?.close(); } catch {} }

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
    personSettings = nextSegmentTask ? { files, modelAssetPath: new URL("person_segmenter_multiclass.tflite", modelRoot).href } : null;
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

class PersonSegmentationExecutionError extends Error {}

function largestFaceRegion(mask) {
  const { width, height } = mask;
  if (width * height > 1048576) return null;
  const confidence = mask.getAsFloat32Array();
  if (confidence.length !== width * height || confidence.some(value => !Number.isFinite(value))) return null;
  const visited = new Uint8Array(confidence.length), queue = new Int32Array(confidence.length), components = [];
  for (let start = 0; start < confidence.length; start++) {
    if (visited[start] || confidence[start] <= 0.5) continue;
    let read = 0, count = 1, left = start % width, right = left, top = Math.floor(start / width), bottom = top;
    queue[0] = start; visited[start] = 1;
    while (read < count) {
      const i = queue[read++], x = i % width, y = Math.floor(i / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
        if (next < 0 || visited[next] || confidence[next] <= 0.5) continue;
        visited[next] = 1; queue[count++] = next;
      }
    }
    components.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1, area: count });
  }
  components.sort((a, b) => b.area - a.area);
  const face = components[0];
  return face && face.area >= 8 ? { ...face, others: components.slice(1).filter(region => region.area >= Math.max(32, face.area * 0.25)) } : null;
}

function copyPersonMask(segmentation, detectHead = false) {
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
    // The background complement preserves hair, body/face skin, clothes and
    // accessories together. Keep the established confident-endpoint calibration.
    const person = Math.max(0, Math.min(1, 1 - data[i]));
    const value = Math.max(0, Math.min(1, (person - 0.1) / 0.8));
    const p = i * 4;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
    pixels[p + 3] = Math.round(value * value * (3 - 2 * value) * 255);
  }
  const mask = { width, height, pixels };
  // Head localization uses semantic face skin already produced by this task;
  // it never requires the separate landmark model or retains model memory.
  if (detectHead) try { mask.headRegion = largestFaceRegion(masks[3]); } catch { /* Optional detail cannot invalidate a usable full-frame matte. */ }
  return mask;
}

function segmentPerson(task, bitmap, timestamp, detectHead = false) {
  let mask = null, validationError = null;
  try {
    // Copy while MediaPipe owns the mask memory. Let the callback return normally
    // even for invalid output so the task can release its temporary mask storage.
    task.segmentForVideo(bitmap, timestamp, segmentation => {
      try { mask = copyPersonMask(segmentation, detectHead); }
      catch (error) { validationError = error; }
    });
  } catch (error) {
    // Bad confidence data is a model/output error, never a reason to hide it by
    // switching delegates. Only an inference execution failure can trigger CPU.
    if (validationError) throw validationError;
    throw new PersonSegmentationExecutionError(error.message || String(error));
  }
  if (validationError) throw validationError;
  if (!mask) throw new Error("Person segmentation returned no confidence mask.");
  return mask;
}

async function retryPersonOnCPU(failedTask, bitmap, timestamp, generation, detectHead = false) {
  const settings = personSettings;
  if (!settings || generation !== initializationGeneration || segmentTask !== failedTask) {
    throw new Error("Local vision analysis was cancelled.");
  }
  segmentTask = null; segmentationDelegate = "CPU";
  closeTask(failedTask);
  let cpuTask = null;
  try {
    cpuTask = await createPersonSegmenter(settings.files, settings.modelAssetPath, "CPU");
    if (generation !== initializationGeneration || personSettings !== settings) throw new Error("Local vision analysis was cancelled.");
    // Retry the exact retained frame and timestamp; no older or raw frame can be
    // published as a successful background result during delegate recovery.
    const mask = segmentPerson(cpuTask, bitmap, timestamp, detectHead);
    if (generation !== initializationGeneration || personSettings !== settings) throw new Error("Local vision analysis was cancelled.");
    segmentTask = cpuTask; cpuTask = null;
    return mask;
  } finally { closeTask(cpuTask); }
}

function nextPersonTimestamp(timestamp) {
  lastPersonTimestamp = Math.max(lastPersonTimestamp + 1, timestamp);
  return lastPersonTimestamp;
}

function headCrop(mask, bitmap) {
  const face = mask.headRegion, sw = bitmap.width, sh = bitmap.height;
  if (!face || !Number.isInteger(sw) || !Number.isInteger(sh) || sw <= 0 || sh <= 0) return null;
  const sx = sw / mask.width, sy = sh / mask.height;
  const fw = face.width * sx, fh = face.height * sy;
  if (fw < 16 || fh < 16) return null;
  const cx = (face.x + face.width / 2) * sx, cy = (face.y + face.height / 2) * sy - 0.28 * fh;
  const width = Math.max(fw * 2.8, fh * 2.1), height = Math.max(fh * 2, fw * 2.4);
  const x = Math.max(0, Math.floor(cx - width / 2)), y = Math.max(0, Math.floor(cy - height / 2));
  const right = Math.min(sw, Math.ceil(cx + width / 2)), bottom = Math.min(sh, Math.ceil(cy + height / 2));
  if (right - x < 16 || bottom - y < 16 || (right - x) * (bottom - y) > sw * sh * 0.8) return null;
  // A nearby second face must keep its original complete-person prediction.
  if (face.others.some(other => other.x * sx < right && (other.x + other.width) * sx > x && other.y * sy < bottom && (other.y + other.height) * sy > y)) return null;
  return { x, y, width: right - x, height: bottom - y,
    face: { x: face.x * sx, y: face.y * sy, width: fw, height: fh } };
}

function plausibleHeadDetail(detail, crop) {
  const face = detail.headRegion;
  if (!face) return false;
  const sx = crop.width / detail.width, sy = crop.height / detail.height;
  const left = crop.x + face.x * sx, top = crop.y + face.y * sy;
  const right = left + face.width * sx, bottom = top + face.height * sy;
  const overlap = Math.max(0, Math.min(right, crop.face.x + crop.face.width) - Math.max(left, crop.face.x)) *
    Math.max(0, Math.min(bottom, crop.face.y + crop.face.height) - Math.max(top, crop.face.y));
  return overlap >= crop.face.width * crop.face.height * 0.2;
}

function mergeHeadDetail(mask, detail, crop, bitmap) {
  const pixels = new Uint8ClampedArray(mask.pixels), sw = bitmap.width, sh = bitmap.height;
  const alpha = (x, y) => detail.pixels[(y * detail.width + x) * 4 + 3];
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const u = ((x + 0.5) * sw / mask.width - crop.x) / crop.width;
    const v = ((y + 0.5) * sh / mask.height - crop.y) / crop.height;
    if (u <= 0 || u >= 1 || v <= 0 || v >= 1) continue;
    const edge = Math.max(0, Math.min(1, Math.min(u, 1 - u, v, 1 - v) / 0.08));
    const weight = edge * edge * (3 - 2 * edge);
    const px = Math.max(0, Math.min(detail.width - 1, u * detail.width - 0.5));
    const py = Math.max(0, Math.min(detail.height - 1, v * detail.height - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(detail.width - 1, x0 + 1), y1 = Math.min(detail.height - 1, y0 + 1);
    const dx = px - x0, dy = py - y0;
    const sampled = (alpha(x0, y0) * (1 - dx) + alpha(x1, y0) * dx) * (1 - dy) +
      (alpha(x0, y1) * (1 - dx) + alpha(x1, y1) * dx) * dy;
    const i = (y * mask.width + x) * 4 + 3;
    pixels[i] = Math.round(pixels[i] + (sampled - pixels[i]) * weight);
  }
  return { width: mask.width, height: mask.height, pixels };
}

async function refineHeadMask(mask, bitmap, frameTimestamp, generation) {
  const crop = headCrop(mask, bitmap), task = segmentTask;
  const retained = reason => ({ mask, headDetail: { applied: false, reason } });
  if (!crop || !task) return retained("no-usable-face-crop");
  if (typeof createImageBitmap !== "function") return retained("crop-unavailable");
  let cropped = null;
  try {
    cropped = await createImageBitmap(bitmap, crop.x, crop.y, crop.width, crop.height);
    if (generation !== initializationGeneration || segmentTask !== task) throw new Error("Local vision analysis was cancelled.");
    const detail = segmentPerson(task, cropped, nextPersonTimestamp(frameTimestamp), true);
    if (generation !== initializationGeneration || segmentTask !== task) throw new Error("Local vision analysis was cancelled.");
    return plausibleHeadDetail(detail, crop) ? { mask: mergeHeadDetail(mask, detail, crop, bitmap), headDetail: { applied: true, reason: "applied" } } : retained("crop-missing-face");
  } catch (error) {
    if (generation !== initializationGeneration || segmentTask !== task) throw new Error("Local vision analysis was cancelled.");
    // A failed optional crop keeps this frame's valid full-person result. It
    // cannot tear down the working base task or publish an incomplete matte.
    return retained("crop-failed");
  } finally { cropped?.close(); }
}

self.onmessage = async event => {
  const { id, type, bitmap, timestamp, options = {} } = event.data;
  const generation = initializationGeneration;
  let runtimeCapabilitiesChanged = false;
  try {
    if (type === "init") { self.postMessage({ id, capabilities: await initialize() }); return; }
    if (type === "dispose") {
      initializationGeneration++; initializing = null;
      faceTask?.close(); segmentTask?.close(); faceTask = segmentTask = null; initialized = false;
      segmentationDelegate = "CPU"; personSettings = null; lastTimestamp = lastPersonTimestamp = 0;
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
      const task = segmentTask;
      const personTimestamp = nextPersonTimestamp(result.timestamp), headDetail = options.headDetail === true;
      try { result.mask = segmentPerson(task, bitmap, personTimestamp, headDetail); }
      catch (error) {
        if (!(error instanceof PersonSegmentationExecutionError) || segmentationDelegate !== "GPU" || segmentTask !== task) throw error;
        runtimeCapabilitiesChanged = true;
        result.mask = await retryPersonOnCPU(task, bitmap, personTimestamp, generation, headDetail);
      }
      if (headDetail) {
        if (performance.now() - started > 6000) result.headDetail = { applied: false, reason: "frame-budget" };
        else {
          const refined = await refineHeadMask(result.mask, bitmap, result.timestamp, generation);
          result.mask = refined.mask; result.headDetail = refined.headDetail;
        }
      }
      delete result.mask.headRegion;
    }
    if (generation !== initializationGeneration) throw new Error("Local vision analysis was cancelled.");
    result.inferenceMs = performance.now() - started;
    self.postMessage({ id, result, ...(runtimeCapabilitiesChanged ? { capabilities: capabilities() } : {}) }, result.mask ? [result.mask.pixels.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error),
      ...(runtimeCapabilitiesChanged && generation === initializationGeneration ? { capabilities: capabilities() } : {}) });
  } finally { bitmap?.close(); }
};
