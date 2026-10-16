/* MeetingLens on-device vision and restrained face-aware rendering.
 * Public API is documented in assets/vendor/vision/MEETINGLENS_INTEGRATION.md. */
(() => {
  "use strict";
  const scriptURL = document.currentScript?.src || new URL("assets/js/vision-effects.js", document.baseURI).href;
  const workerURL = new URL("../vendor/vision/meetinglens-worker.js", scriptURL);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, Number(v) || 0));
  const canvas = (w = 1, h = 1) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const maskCanvas = canvas(), captureCanvas = canvas();
  let worker = null, initializing = null, busy = false, nextID = 1, lastStart = -Infinity;
  let lastFaceAt = 0, failureCount = 0, disposed = false, statusCallback = () => {};
  let cached = { face: null, faceLandmarks: null, mask: null, timestamp: 0, inferenceMs: 0 };
  let availability = { face: false, segmentation: false, backend: "unavailable", eyeContact: false };
  const pending = new Map();
  let renderBuffers = new WeakMap();
  let edgeMasks = new WeakMap();
  let cancelGeneration = 0;
  let lastComposition = { mode: "source", reason: null };
  function freshCached() {
    return cached.timestamp && performance.now() - cached.timestamp > 1500
      ? { ...cached, face: null, faceLandmarks: null, mask: null, stale: true } : cached;
  }

  function status(state, message, details = {}) {
    try { statusCallback({ state, message, ...details, capabilities: { ...availability } }); } catch { /* UI callbacks cannot stop capture. */ }
  }
  function request(type, payload = {}, transfer = [], timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = nextID++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Local vision processing timed out.")); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, type, ...payload }, transfer); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function failWorker(error, failedWorker = worker) {
    // An event from a worker that was replaced/disposed must not tear down its
    // replacement (an asynchronous startup may still finish after disposal).
    if (failedWorker !== worker) return;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
    pending.clear(); worker?.terminate(); worker = null;
    availability = { face: false, segmentation: false, backend: "unavailable", eyeContact: false };
    cached = { ...cached, face: null, faceLandmarks: null, mask: null };
    status("error", "Local AI is unavailable. Camera and manual controls still work.", { error: error.message });
  }
  async function init({ onStatus } = {}) {
    if (typeof onStatus === "function") statusCallback = onStatus;
    if (initializing) return initializing;
    if (worker && availability.face && availability.segmentation) return { ...availability };
    disposed = false;
    reset();
    // A failed initialization is retryable. In particular, a cached failed
    // promise must not leave the visible Load models button permanently inert.
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Local models are restarting.")); }
    pending.clear(); worker?.terminate(); worker = null;
    availability = { face: false, segmentation: false, backend: "unavailable", eyeContact: false };
    cached = { ...cached, face: null, faceLandmarks: null, mask: null };
    const operation = (async () => {
      if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap || !window.WebAssembly) {
        status("unavailable", "This browser cannot run local AI effects. Use current Microsoft Edge or Chrome.");
        return { ...availability };
      }
      status("loading", "Loading on-device face tracking and person segmentation…");
      let loadingWorker = null;
      try {
        worker = new Worker(workerURL, { name: "MeetingLens local vision" });
        loadingWorker = worker;
        worker.onmessage = event => {
          const task = pending.get(event.data.id); if (!task) return;
          clearTimeout(task.timer); pending.delete(event.data.id);
          if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data);
        };
        worker.onerror = event => failWorker(new Error(event.message || "Local vision worker stopped."), loadingWorker);
        const loaded = await request("init", {}, [], 90000);
        if (disposed || loadingWorker !== worker) return { ...availability };
        availability = loaded.capabilities;
        const ready = availability.face || availability.segmentation;
        status(ready ? "ready" : "unavailable", ready ? "On-device AI ready · CPU/WASM · no camera uploads" : "AI models could not load. Camera and manual controls still work.");
      } catch (error) { if (!disposed && (!loadingWorker || loadingWorker === worker)) failWorker(error, loadingWorker); }
      return { ...availability };
    })();
    initializing = operation;
    try { return await operation; }
    finally { if (initializing === operation) initializing = null; }
  }
  async function analyze(source, timestamp = performance.now(), options = {}) {
    const now = performance.now();
    if (disposed || options.enabled === false || document.hidden || busy || !worker || (!availability.face && !availability.segmentation)) return freshCached();
    if (!options.force && now - lastStart < 125) return freshCached();
    const w = source?.videoWidth || source?.naturalWidth || source?.width || 0;
    const h = source?.videoHeight || source?.naturalHeight || source?.height || 0;
    if (!w || !h || (source.readyState !== undefined && source.readyState < 2)) return cached;
    busy = true; lastStart = now;
    const generation = cancelGeneration;
    try {
      const scale = Math.min(1, 640 / Math.max(w, h));
      captureCanvas.width = Math.max(1, Math.round(w * scale)); captureCanvas.height = Math.max(1, Math.round(h * scale));
      captureCanvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, captureCanvas.width, captureCanvas.height);
      const bitmap = await createImageBitmap(captureCanvas);
      if (generation !== cancelGeneration || disposed || !worker) { bitmap.close(); return cached; }
      const { result } = await request("analyze", { bitmap, timestamp, options: { face: options.face !== false, segmentation: options.segmentation !== false } }, [bitmap], 20000);
      if (generation !== cancelGeneration || disposed) return cached;
      // Smooth only the framing rectangle. Landmark masks retain their measured positions.
      if (result.face) {
        const previous = cached.face;
        if (previous && now - lastFaceAt < 600 && !options.force) {
          for (const key of ["x", "y", "width", "height"]) result.face[key] = previous[key] * 0.7 + result.face[key] * 0.3;
          if (previous.eyes?.length && result.face.eyes?.length) for (let i = 0; i < 2; i++) {
            result.face.eyes[i].x = previous.eyes[i].x * 0.7 + result.face.eyes[i].x * 0.3;
            result.face.eyes[i].y = previous.eyes[i].y * 0.7 + result.face.eyes[i].y * 0.3;
          }
        }
        lastFaceAt = now;
      } else if (!options.force && options.face !== false && now - lastFaceAt < 400) result.face = cached.face;
      if (result.mask) {
        maskCanvas.width = result.mask.width; maskCanvas.height = result.mask.height;
        maskCanvas.getContext("2d").putImageData(new ImageData(result.mask.pixels, result.mask.width, result.mask.height), 0, 0);
        result.mask = maskCanvas;
      }
      cached = { ...result, face: options.face === false ? null : result.face, faceLandmarks: result.faceLandmarks || null };
      failureCount = 0;
      return freshCached();
    } catch (error) {
      if (disposed || generation !== cancelGeneration) return freshCached();
      if (++failureCount >= 3) failWorker(error);
      else status("recovering", "Frame analysis paused; retrying safely…", { error: error.message });
      return cached;
    } finally { busy = false; }
  }
  function buffers(target, w, h) {
    let b = renderBuffers.get(target);
    if (!b) { b = { source: canvas(), layer: canvas(), mask: canvas() }; renderBuffers.set(target, b); }
    for (const c of Object.values(b)) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return b;
  }
  function polygon(ctx, landmarks, indices, w, h) {
    if (!landmarks || indices.some(i => !landmarks[i])) return false;
    ctx.beginPath(); indices.forEach((i, n) => { const p = landmarks[i]; ctx[n ? "lineTo" : "moveTo"](p.x * w, p.y * h); }); ctx.closePath(); return true;
  }
  const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  const LEFT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
  const RIGHT_EYE = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
  const LIPS = [61,40,37,0,267,270,291,321,314,17,84,91];
  const INNER_MOUTH = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];

  function compositeBackgroundBlur(source, mask, target, amount = 12) {
    const w = target.width || source.width, h = target.height || source.height;
    const ctx = target.getContext("2d");
    const b = buffers(target, w, h);
    b.source.getContext("2d").drawImage(source, 0, 0, w, h);
    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    if (!mask || !amount) { ctx.drawImage(b.source, 0, 0); ctx.restore(); return target; }
    const radius = clamp(amount, 0, 36) * w / 1280;
    ctx.filter = `blur(${Math.max(0.5, radius)}px)`;
    // Bleed the background past every edge so blur cannot create dark borders.
    ctx.drawImage(b.source, -radius * 2, -radius * 2, w + radius * 4, h + radius * 4); ctx.filter = "none";
    const fg = b.layer.getContext("2d"); fg.clearRect(0, 0, w, h); fg.globalCompositeOperation = "source-over"; fg.drawImage(b.source, 0, 0);
    fg.globalCompositeOperation = "destination-in"; fg.filter = `blur(${Math.max(0.4, w / 1800)}px)`; fg.drawImage(mask, 0, 0, w, h); fg.filter = "none"; fg.globalCompositeOperation = "source-over";
    ctx.drawImage(b.layer, 0, 0); ctx.restore(); return target;
  }
  function imageSize(image) {
    if (!image || image.complete === false || (image.readyState !== undefined && image.readyState < 2)) return null;
    const width = Number(image.naturalWidth || image.videoWidth || image.width);
    const height = Number(image.naturalHeight || image.videoHeight || image.height);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
  }
  function drawCover(ctx, image, width, height, bleed = 0) {
    const size = imageSize(image);
    if (!size) return false;
    const scale = Math.max((width + bleed * 2) / size.width, (height + bleed * 2) / size.height);
    const dw = size.width * scale, dh = size.height * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return true;
  }
  function cleanPersonMask(mask, version) {
    const size = imageSize(mask);
    if (!size || size.width * size.height > 1048576) return mask;
    let record = edgeMasks.get(mask);
    if (record && Number.isFinite(version) && record.version === version && record.canvas.width === size.width && record.canvas.height === size.height) return record.canvas;
    if (!record) { record = { canvas: canvas(), version: null }; edgeMasks.set(mask, record); }
    const c = record.canvas; c.width = size.width; c.height = size.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(mask, 0, 0);
      const image = ctx.getImageData(0, 0, size.width, size.height), original = new Uint8ClampedArray(image.data);
      // Pull the matte in by less than half of one model pixel. Mixing a local
      // minimum with the measured confidence reduces room-colored fringes;
      // unlike repeated alpha multiplication it preserves soft uniform regions
      // and full-confidence foreground. Do not trim where a person meets the
      // frame edge. Source RGB pixels are never recolored.
      for (let y = 1; y < size.height - 1; y++) for (let x = 1; x < size.width - 1; x++) {
        const i = (y * size.width + x) * 4 + 3, alpha = original[i];
        if (!alpha) continue;
        let minimum = alpha;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) minimum = Math.min(minimum, original[i + (dy * size.width + dx) * 4]);
        image.data[i] = Math.round(alpha * 0.55 + minimum * 0.45);
      }
      ctx.putImageData(image, 0, 0); record.version = version;
      return c;
    } catch { return mask; }
  }
  function compositeBackgroundReplace(source, mask, target, backgroundImage, amount = 0, maskVersion) {
    const w = target.width || source.width, h = target.height || source.height;
    const b = buffers(target, w, h), ctx = target.getContext("2d");
    const fallback = reason => {
      lastComposition = { mode: "source", reason };
      return compositeBackgroundBlur(source, mask, target, amount);
    };
    // Keep the real room visible until both inputs are usable. A slow download,
    // an unsupported image or a missing person mask must never blank the camera.
    if (!imageSize(backgroundImage)) return fallback("background-not-ready");
    if (!imageSize(mask)) return fallback("person-mask-not-ready");
    b.source.getContext("2d").drawImage(source, 0, 0, w, h);
    const fg = b.layer.getContext("2d");
    ctx.save(); fg.save();
    try {
      fg.globalCompositeOperation = "source-over"; fg.globalAlpha = 1; fg.filter = "none";
      fg.clearRect(0, 0, w, h); fg.drawImage(b.source, 0, 0);
      fg.globalCompositeOperation = "destination-in";
      // The bundled segmentation mask stores person confidence in alpha. A
      // small feather removes stair stepping without erasing foreground detail.
      fg.filter = `blur(${Math.max(0.4, w / 1800)}px)`;
      fg.drawImage(cleanPersonMask(mask, maskVersion), 0, 0, w, h); fg.filter = "none";
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.filter = "none";
      ctx.clearRect(0, 0, w, h);
      // Opaque backing also makes transparent custom scenes predictable.
      ctx.fillStyle = "#edf0f4"; ctx.fillRect(0, 0, w, h);
      const radius = clamp(amount, 0, 36) * w / 1280;
      if (radius) ctx.filter = `blur(${Math.max(0.5, radius)}px)`;
      drawCover(ctx, backgroundImage, w, h, radius * 2);
      ctx.filter = "none"; ctx.drawImage(b.layer, 0, 0);
      lastComposition = { mode: "replacement", reason: null };
    } catch {
      // A decoded image can still become unavailable (for example a closed
      // ImageBitmap). Restore all drawing state before the normal camera path.
      fg.restore(); ctx.restore();
      return fallback("background-draw-failed");
    }
    fg.restore(); ctx.restore(); return target;
  }
  function portraitLight(ctx, analysis, amount, w, h, b) {
    if (!analysis.mask && !analysis.face) return;
    const face = analysis.face;
    const x = face ? (face.x + face.width / 2) * w : w / 2;
    const y = face ? (face.y + face.height / 2) * h : h * 0.42;
    const radius = face ? Math.max(face.width * w * 1.5, face.height * h) : Math.max(w, h) * 0.6;
    const layer = b.layer.getContext("2d"); layer.clearRect(0, 0, w, h);
    const gradient = layer.createRadialGradient(x, y, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, `rgba(255,244,228,${0.24 * amount})`);
    gradient.addColorStop(0.45, `rgba(255,244,228,${0.12 * amount})`); gradient.addColorStop(1, "rgba(255,244,228,0)");
    layer.fillStyle = gradient; layer.fillRect(0, 0, w, h);
    if (analysis.mask) { layer.globalCompositeOperation = "destination-in"; layer.drawImage(analysis.mask, 0, 0, w, h); layer.globalCompositeOperation = "source-over"; }
    ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.drawImage(b.layer, 0, 0); ctx.restore();
  }
  function smoothSkin(target, b, analysis, amount, w, h) {
    const points = analysis.faceLandmarks; if (!points?.length) return;
    const mask = b.mask.getContext("2d"); mask.clearRect(0, 0, w, h); mask.fillStyle = "white";
    if (polygon(mask, points, FACE_OVAL, w, h)) mask.fill();
    mask.globalCompositeOperation = "destination-out";
    for (const path of [LEFT_EYE, RIGHT_EYE, LIPS]) if (polygon(mask, points, path, w, h)) { mask.lineWidth = w / 120; mask.strokeStyle = "white"; mask.fill(); mask.stroke(); }
    mask.globalCompositeOperation = "source-over";
    const layer = b.layer.getContext("2d"); layer.clearRect(0, 0, w, h); layer.filter = `blur(${Math.max(0.5, w / 720)}px)`; layer.drawImage(target, 0, 0); layer.filter = "none";
    layer.globalCompositeOperation = "destination-in"; layer.drawImage(b.mask, 0, 0); layer.globalCompositeOperation = "source-over";
    const ctx = target.getContext("2d"); ctx.save(); ctx.globalAlpha = amount * 0.55; ctx.drawImage(b.layer, 0, 0); ctx.restore();
  }
  function whitenTeeth(target, b, analysis, amount, w, h) {
    const points = analysis.faceLandmarks; if (!points?.length) return;
    const mouth = INNER_MOUTH.map(i => points[i]);
    const minX = Math.max(0, Math.floor(Math.min(...mouth.map(p => p.x)) * w));
    const minY = Math.max(0, Math.floor(Math.min(...mouth.map(p => p.y)) * h));
    const mw = Math.min(w - minX, Math.ceil(Math.max(...mouth.map(p => p.x)) * w) - minX);
    const mh = Math.min(h - minY, Math.ceil(Math.max(...mouth.map(p => p.y)) * h) - minY);
    if (mw < 2 || mh < 2) return;
    const mask = b.mask.getContext("2d", { willReadFrequently: true }); mask.clearRect(0, 0, w, h); mask.fillStyle = "white";
    if (!polygon(mask, points, INNER_MOUTH, w, h)) return; mask.fill();
    const ctx = target.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(minX, minY, mw, mh), region = mask.getImageData(minX, minY, mw, mh).data;
    for (let i = 0; i < image.data.length; i += 4) {
      if (region[i + 3] < 128) continue;
      const r = image.data[i], g = image.data[i + 1], blue = image.data[i + 2];
      const luminance = (r * 0.2126 + g * 0.7152 + blue * 0.0722) / 255;
      const spread = Math.max(r, g, blue) - Math.min(r, g, blue);
      // Preserve gums, lips, dark mouth and shadows: only plausible light teeth.
      if (luminance < 0.5 || spread > 85 || r > g * 1.35 || g < blue * 0.65) continue;
      const lift = amount * clamp((luminance - 0.5) / 0.3) * 0.28;
      const neutral = (r + g + blue) / 3;
      for (let k = 0; k < 3; k++) image.data[i + k] = image.data[i + k] * (1 - lift) + neutral * lift + (255 - image.data[i + k]) * lift * 0.35;
    }
    ctx.putImageData(image, minX, minY);
  }
  function process(input, output, options = {}) {
    lastComposition = { mode: "source", reason: null };
    const w = input.width || input.videoWidth || input.naturalWidth, h = input.height || input.videoHeight || input.naturalHeight;
    if (!w || !h) return output;
    if (output.width !== w) output.width = w; if (output.height !== h) output.height = h;
    const analysis = options.analysis || cached, b = buffers(output, w, h);
    b.source.getContext("2d").drawImage(input, 0, 0, w, h);
    if (options.backgroundImage) compositeBackgroundReplace(b.source, analysis.mask, output, options.backgroundImage,
      clamp(options.backgroundSoftness ?? options.backgroundBlur, 0, 36), analysis.timestamp);
    else { lastComposition = { mode: "source", reason: null }; compositeBackgroundBlur(b.source, analysis.mask, output, clamp(options.backgroundBlur, 0, 36)); }
    if (options.portraitLight > 0) portraitLight(output.getContext("2d"), analysis, clamp(options.portraitLight), w, h, b);
    if (options.skinSmoothing > 0) smoothSkin(output, b, analysis, clamp(options.skinSmoothing), w, h);
    if (options.teethWhitening > 0) whitenTeeth(output, b, analysis, clamp(options.teethWhitening), w, h);
    return output;
  }
  function autoFrameCrop(analysis, width, height, zoom = 1.22) {
    const face = analysis?.face;
    if (!face) return { x: 0, y: 0, width, height };
    const scale = clamp(zoom, 1, 1.8), cw = width / scale, ch = height / scale;
    const centerX = (face.x + face.width / 2) * width;
    const eyeY = face.eyes?.length ? (face.eyes[0].y + face.eyes[1].y) / 2 : face.y + face.height * 0.36;
    return { x: clamp(centerX - cw / 2, 0, width - cw), y: clamp(eyeY * height - ch * 0.38, 0, height - ch), width: cw, height: ch };
  }
  function reset() {
    cancelGeneration++; lastStart = -Infinity; lastFaceAt = 0; failureCount = 0;
    lastComposition = { mode: "source", reason: null };
    captureCanvas.width = captureCanvas.height = maskCanvas.width = maskCanvas.height = 1;
    renderBuffers = new WeakMap();
    edgeMasks = new WeakMap();
    cached = { face: null, faceLandmarks: null, mask: null, timestamp: 0, inferenceMs: 0 };
  }
  function dispose() {
    disposed = true; reset(); worker?.terminate(); worker = null;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Vision processor disposed.")); } pending.clear();
    busy = false; initializing = null; availability = { face: false, segmentation: false, backend: "unavailable", eyeContact: false };
  }
  window.MeetingLensVision = { init, analyze, process, compositeBackgroundBlur, compositeBackgroundReplace, autoFrameCrop, reset, dispose,
    get lastComposition() { return { ...lastComposition }; },
    get lastBackgroundApplied() { return lastComposition.mode === "replacement"; },
    get capabilities() { return { ...availability }; }, get latest() { return freshCached(); }, get busy() { return busy; } };
})();
