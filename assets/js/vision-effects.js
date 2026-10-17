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
  let cached = { face: null, faceLandmarks: null, mask: null, timestamp: 0, completedAt: 0, validForMs: 1500, inferenceMs: 0 };
  let availability = { face: false, segmentation: false, backend: "unavailable", eyeContact: false };
  const pending = new Map();
  let renderBuffers = new WeakMap();
  let edgeMasks = new WeakMap();
  let cancelGeneration = 0;
  let lastComposition = { mode: "source", reason: null };
  function freshCached() {
    const now = performance.now();
    const captureStale = cached.timestamp && now - cached.timestamp > 1500;
    // The app retains the exact camera frame that produced a person mask. A
    // slow successful result is usable when it arrives, even if its capture is
    // older than the normal face-tracking lifetime. Cached/error paths never
    // refresh completedAt, so an abandoned result still expires promptly.
    const maskStale = cached.completedAt && now - cached.completedAt > cached.validForMs;
    return captureStale || maskStale ? { ...cached,
      face: captureStale ? null : cached.face,
      faceLandmarks: captureStale ? null : cached.faceLandmarks,
      mask: maskStale ? null : cached.mask,
      stale: Boolean(maskStale || (captureStale && !cached.mask)) } : cached;
  }

  function status(state, message, details = {}) {
    try { statusCallback({ state, message, ...details, capabilities: { ...availability } }); } catch { /* UI callbacks cannot stop capture. */ }
  }
  function readyMessage() {
    if (availability.face && availability.segmentation) return `On-device AI ready · ${availability.backend} · no camera uploads`;
    if (availability.segmentation) return `Background detection ready · ${availability.backend}. Face tracking is unavailable.`;
    if (availability.face) return "Face tracking ready. Background detection is unavailable. Camera and manual controls still work.";
    return "AI models could not load. Camera and manual controls still work.";
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
    cached = { ...cached, face: null, faceLandmarks: null, mask: null, completedAt: 0, validForMs: 1500 };
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
    cached = { ...cached, face: null, faceLandmarks: null, mask: null, completedAt: 0, validForMs: 1500 };
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
          if (event.data.capabilities) {
            const previous = availability;
            availability = { ...event.data.capabilities };
            if (previous.backend !== availability.backend || previous.segmentation !== availability.segmentation || previous.face !== availability.face) {
              status(availability.face || availability.segmentation ? "ready" : "unavailable", readyMessage());
            }
          }
          if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data);
        };
        worker.onerror = event => failWorker(new Error(event.message || "Local vision worker stopped."), loadingWorker);
        const loaded = await request("init", {}, [], 90000);
        if (disposed || loadingWorker !== worker) return { ...availability };
        availability = loaded.capabilities;
        const ready = availability.face || availability.segmentation;
        status(ready ? "ready" : "unavailable", readyMessage());
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
    const minimumInterval = availability.segmentationDelegate === "GPU" && options.face === false ? 33 : 125;
    if (!options.force && now - lastStart < minimumInterval) return freshCached();
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
      const { result } = await request("analyze", { bitmap, timestamp, options: { face: options.face !== false, segmentation: options.segmentation !== false, headDetail: Boolean(options.headDetail) } }, [bitmap], 20000);
      if (generation !== cancelGeneration || disposed) return cached;
      // An old worker reply must not renew the usable lifetime of its mask or
      // overwrite the pixels attached to the currently completed camera frame.
      if (!Number.isFinite(result?.timestamp) || result.timestamp < timestamp || (cached.timestamp && result.timestamp <= cached.timestamp)) return freshCached();
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
      const completedAt = performance.now();
      // Slow but progressing devices keep a complete frame while the next one
      // is analyzed. Even the slowest accepted pair expires within five seconds
      // of its last genuine completion if processing stalls.
      const validForMs = Math.max(1500, Math.min(5000, (completedAt - timestamp) * 2.5));
      cached = { ...result, completedAt, validForMs, face: options.face === false ? null : result.face, faceLandmarks: result.faceLandmarks || null };
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
  // The model matte is much smaller than a camera frame. Treat it as
  // confidence, rather than displaying its entire soft transition as fog.
  // Color weights are quantized only for lookup; source RGB is never changed.
  const matteColorWeights = Float32Array.from({ length: 3073 }, (_, i) => Math.exp(-i * 64 / (2 * 36 * 36)));
  function matteAxis(length, modelLength, pixelStride, maskStride) {
    const positions = new Int32Array(length * 4), measured = new Int32Array(length * 4);
    const weights = new Float32Array(length * 4), distances = new Float32Array(length * 4);
    const scale = length / modelLength;
    for (let p = 0; p < length; p++) {
      const at = (p + 0.5) / scale - 0.5, center = Math.floor(at);
      for (let d = -1; d <= 2; d++) {
        const q = Math.max(0, Math.min(modelLength - 1, center + d)), i = p * 4 + d + 1;
        positions[i] = Math.min(length - 1, Math.floor((q + 0.5) * scale)) * pixelStride;
        measured[i] = q * maskStride; distances[i] = (q - at) * (q - at);
        // Fade the small outer tail to zero before a sample leaves the window.
        // That makes floor-based sampling continuous along diagonal outlines.
        const taper = clamp(2 - Math.abs(q - at));
        weights[i] = Math.exp(-distances[i] / (2 * 0.85 * 0.85)) * taper * taper * (3 - 2 * taper);
      }
    }
    return { positions, measured, weights, distances };
  }
  function cleanPersonMask(mask, version, source, width, height) {
    const size = imageSize(mask);
    if (!size || size.width * size.height > 1048576) return mask;
    // Bound the occasional readback on very large camera inputs. At ordinary
    // 720p this is native resolution, so no extra mask enlargement softens it.
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const sourceSize = imageSize(source);
    let record = edgeMasks.get(mask);
    if (record && Number.isFinite(version) && record.version === version && record.canvas.width === w && record.canvas.height === h &&
      record.maskWidth === size.width && record.maskHeight === size.height && record.source === source &&
      record.sourceWidth === sourceSize?.width && record.sourceHeight === sourceSize?.height) return record.canvas;
    if (!record) { record = { canvas: canvas(), measured: canvas(), guide: canvas(), version: null }; edgeMasks.set(mask, record); }
    const c = record.canvas; c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    try {
      ctx.imageSmoothingEnabled = true; ctx.drawImage(mask, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h), pixels = image.data;
      const measured = record.measured; measured.width = size.width; measured.height = size.height;
      const measuredContext = measured.getContext("2d", { willReadFrequently: true });
      measuredContext.drawImage(mask, 0, 0);
      const alpha = measuredContext.getImageData(0, 0, size.width, size.height).data;
      const sx = w / size.width, sy = h / size.height;
      let guide = null;
      // The guide is read once for a new inference result, not every rendered
      // video frame. If readback is unavailable, confidence cleanup still works.
      if (sourceSize && (sx > 1.25 || sy > 1.25)) try {
        const g = record.guide; g.width = w; g.height = h;
        const guideContext = g.getContext("2d", { willReadFrequently: true });
        guideContext.drawImage(source, 0, 0, w, h); guide = guideContext.getImageData(0, 0, w, h).data;
      } catch { /* Cross-origin/closed image: retain the confidence-only matte. */ }
      const guided = Boolean(guide && (sx > 1.25 || sy > 1.25));
      if (guided && (!record.geometry || record.geometry.width !== w || record.geometry.height !== h ||
        record.geometry.maskWidth !== size.width || record.geometry.maskHeight !== size.height)) {
        // Geometry is constant between model frames. Precompute the separable
        // four-sample neighborhood so uncertain pixels use cheap lookups,
        // not coordinate conversions and exponentials on every draw. The tapered
        // outer tail keeps diagonal edges continuous when the window advances.
        record.geometry = { width: w, height: h, maskWidth: size.width, maskHeight: size.height,
          x: matteAxis(w, size.width, 4, 4), y: matteAxis(h, size.height, w * 4, size.width * 4) };
      }
      const gx = record.geometry?.x, gy = record.geometry?.y;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, original = pixels[i + 3];
        if (original === 0 || original === 255) continue;
        let confidence = original / 255;
        if (guided && original > 8 && original < 247) {
          const xi = x * 4, yi = y * 4;
          let total = 0.1, weighted = confidence * total, matchingMinimum = confidence;
          // Joint bilateral upsampling favors nearby mask samples with colors
          // matching this camera pixel. It follows shoulders and hair edges
          // without using scene colors or shrinking every silhouette equally.
          for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
            const q = gy.positions[yi + dy] + gx.positions[xi + dx];
            const dr = guide[i] - guide[q], dg = guide[i + 1] - guide[q + 1], db = guide[i + 2] - guide[q + 2];
            const colorWeight = matteColorWeights[(dr * dr + dg * dg + db * db) >> 6];
            const distance = gy.distances[yi + dy] + gx.distances[xi + dx];
            const weight = colorWeight * gy.weights[yi + dy] * gx.weights[xi + dx];
            const measuredConfidence = alpha[gy.measured[yi + dy] + gx.measured[xi + dx] + 3] / 255;
            total += weight; weighted += measuredConfidence * weight;
            if (colorWeight > 0.8 && distance <= 2.25) matchingMinimum = Math.min(matchingMinimum, measuredConfidence);
          }
          confidence = weighted / total;
          // A broad model edge can include room-colored pixels. Contract only
          // toward nearby low-confidence samples matching this source color,
          // rather than eroding hair against a differently colored room.
          confidence = confidence * 0.8 + Math.min(confidence, matchingMinimum) * 0.2;
        }
        // Narrow, symmetric transition: 50% remains 50%, confident pixels stay
        // opaque, and a small antialiased band survives instead of a hard cut.
        const t = clamp((confidence - 0.18) / 0.64);
        pixels[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
      }
      ctx.putImageData(image, 0, 0);
      Object.assign(record, { version, maskWidth: size.width, maskHeight: size.height, source,
        sourceWidth: sourceSize?.width, sourceHeight: sourceSize?.height });
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
      // Refinement already supplies an antialiased edge at camera resolution.
      // Scene softness applies only below; never blur the person's outline.
      fg.filter = "none";
      fg.drawImage(cleanPersonMask(mask, maskVersion, b.source, w, h), 0, 0, w, h);
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
    cached = { face: null, faceLandmarks: null, mask: null, timestamp: 0, completedAt: 0, validForMs: 1500, inferenceMs: 0 };
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
