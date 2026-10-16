/* MeetingLens Photo Lab. All photo data stays in this document; no upload endpoints. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const clamp = (x, a = 0, b = 255) => Math.max(a, Math.min(b, x));
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const MAX_EDGE = 2048, MAX_PHOTOS = 8, PIXEL_BUDGET = 12000000, HISTORY_BUDGET = 24000000;
  const canvas = $("photoCanvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const overlay = $("maskCanvas"), maskCtx = overlay.getContext("2d", { willReadFrequently: true });
  const state = { photos: [], active: -1, tool: "enhance", busy: false, compare: false, history: [], maskHistory: [], reference: null, corners: [], pointer: null };
  const photo = () => state.photos[state.active];
  const clone = data => new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  const status = (message, error = false) => { $("status").textContent = message; $("status").classList.toggle("error", error); };
  const working = async (message, action) => {
    if (state.busy) return;
    state.busy = true; document.body.classList.add("busy");
    const controls = [...document.querySelectorAll("button,input,select")], disabled = controls.map(el => el.disabled);
    controls.forEach(el => { el.disabled = true; }); status(message);
    try { await pause(); await action(); } catch (error) { status(error.message || "This edit could not be completed. Your photo is unchanged.", true); }
    finally { controls.forEach((el, i) => { el.disabled = disabled[i]; }); state.busy = false; document.body.classList.remove("busy"); updateButtons(); }
  };
  function tempCanvas(data) { const c = document.createElement("canvas"); c.width = data.width; c.height = data.height; c.getContext("2d").putImageData(data, 0, 0); return c; }
  function percentiles(data) {
    const hist = new Uint32Array(256), means = [0, 0, 0]; let count = 0;
    const step = Math.max(1, Math.floor(data.width * data.height / 160000));
    for (let i = 0; i < data.data.length; i += 4 * step) { if (data.data[i + 3] < 20) continue; hist[Math.round(luminance(data.data[i], data.data[i + 1], data.data[i + 2]))]++; count++; for (let c = 0; c < 3; c++) means[c] += data.data[i + c]; }
    const percentile = p => { let n = 0; for (let i = 0; i < 256; i++) { n += hist[i]; if (n >= count * p) return i; } return 255; };
    return { black: percentile(.015), white: percentile(.985), median: percentile(.5), means: means.map(v => v / Math.max(1, count)) };
  }
  function autoEnhance(input, amount = .65) {
    const out = clone(input), stats = percentiles(input), { black, white, median, means } = stats;
    const low = Math.min(black, 35), high = Math.max(white, 205), range = Math.max(80, high - low);
    const mid = clamp((median - low) / range, .04, .96), gamma = clamp(Math.log(.49) / Math.log(mid), .6, 1.25);
    const avg = means.reduce((a, b) => a + b, 0) / 3;
    const balance = means.map(v => clamp(avg / Math.max(v, 8), .88, 1.12));
    for (let i = 0; i < input.data.length; i += 4) {
      const channels = [0, 1, 2].map(c => 255 * Math.pow(clamp((input.data[i + c] * balance[c] - low) / range, 0, 1), gamma));
      const l = luminance(...channels);
      for (let c = 0; c < 3; c++) out.data[i + c] = input.data[i + c] * (1 - amount) + clamp(l + (channels[c] - l) * 1.05) * amount;
    }
    return out;
  }
  function rgbToLab(r, g, b) {
    const linear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    r = linear(r); g = linear(g); b = linear(b);
    const f = v => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
    const x = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047), y = f(.2126729 * r + .7151522 * g + .072175 * b), z = f((.0193339 * r + .119192 * g + .9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function labToRgb(l, a, b) {
    const y = (l + 16) / 116, x = a / 500 + y, z = y - b / 200;
    const inverse = v => v ** 3 > .008856 ? v ** 3 : (v - 16 / 116) / 7.787;
    const X = .95047 * inverse(x), Y = inverse(y), Z = 1.08883 * inverse(z);
    const gamma = v => 255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - .055);
    return [gamma(3.2404542 * X - 1.5371385 * Y - .4985314 * Z), gamma(-.969266 * X + 1.8760108 * Y + .041556 * Z), gamma(.0556434 * X - .2040259 * Y + 1.0572252 * Z)];
  }
  function colorStats(data) {
    const sums = [0, 0, 0], squares = [0, 0, 0]; let n = 0;
    const step = Math.max(1, Math.floor(data.width * data.height / 70000));
    for (let i = 0; i < data.data.length; i += 4 * step) { if (data.data[i + 3] < 20) continue; const lab = rgbToLab(data.data[i], data.data[i + 1], data.data[i + 2]); for (let c = 0; c < 3; c++) { sums[c] += lab[c]; squares[c] += lab[c] ** 2; } n++; }
    const mean = sums.map(v => v / Math.max(1, n));
    return { mean, std: squares.map((v, c) => Math.sqrt(Math.max(.01, v / Math.max(1, n) - mean[c] ** 2))) };
  }
  function matchColor(input, reference, amount = .65) {
    const source = colorStats(input), target = reference.mean ? reference : colorStats(reference), output = clone(input);
    for (let i = 0; i < input.data.length; i += 4) {
      const lab = rgbToLab(input.data[i], input.data[i + 1], input.data[i + 2]);
      const matched = lab.map((v, c) => (v - source.mean[c]) * clamp(target.std[c] / Math.max(1, source.std[c]), .5, 1.8) + target.mean[c]);
      const rgb = labToRgb(clamp(matched[0], 0, 100), clamp(matched[1], -100, 100), clamp(matched[2], -100, 100));
      for (let c = 0; c < 3; c++) output.data[i + c] = input.data[i + c] * (1 - amount) + clamp(rgb[c]) * amount;
    }
    return output;
  }
  function blurPixels(input, radius) {
    const { width: w, height: h, data } = input, horizontal = new Float32Array(data.length), out = new Uint8ClampedArray(data.length), size = radius * 2 + 1;
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let sum = 0; for (let k = -radius; k <= radius; k++) sum += data[(y * w + clamp(k, 0, w - 1)) * 4 + c]; for (let x = 0; x < w; x++) { horizontal[(y * w + x) * 4 + c] = sum / size; sum += data[(y * w + clamp(x + radius + 1, 0, w - 1)) * 4 + c] - data[(y * w + clamp(x - radius, 0, w - 1)) * 4 + c]; } }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let sum = 0; for (let k = -radius; k <= radius; k++) sum += horizontal[(clamp(k, 0, h - 1) * w + x) * 4 + c]; for (let y = 0; y < h; y++) { out[(y * w + x) * 4 + c] = sum / size; sum += horizontal[(clamp(y + radius + 1, 0, h - 1) * w + x) * 4 + c] - horizontal[(clamp(y - radius, 0, h - 1) * w + x) * 4 + c]; } }
    for (let i = 3; i < out.length; i += 4) out[i] = data[i]; return new ImageData(out, w, h);
  }
  function retouch(input, mask, mode, amount = .3) {
    const out = clone(input), blurred = mode === "skin" ? blurPixels(input, Math.max(2, Math.round(Math.min(input.width, input.height) / 180))) : null;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue; const i = p * 4, blend = Math.min(1, mask[p] / 128) * amount;
      if (mode === "skin") {
        const delta = Math.abs(luminance(input.data[i], input.data[i + 1], input.data[i + 2]) - luminance(blurred.data[i], blurred.data[i + 1], blurred.data[i + 2]));
        const edgeWeight = Math.exp(-delta * delta / 800);
        for (let c = 0; c < 3; c++) out.data[i + c] += (blurred.data[i + c] - input.data[i + c]) * blend * edgeWeight;
      } else {
        const r = input.data[i], g = input.data[i + 1], b = input.data[i + 2], l = luminance(r, g, b), saturation = Math.max(r, g, b) - Math.min(r, g, b);
        if (l < 85 || saturation > 105) continue;
        const target = clamp(l * 1.12 + 8);
        for (let c = 0; c < 3; c++) out.data[i + c] += (target - input.data[i + c]) * blend;
      }
    }
    return out;
  }
  async function inpaint(input, mask) {
    const { width: w, height: h } = input, n = w * h, out = clone(input), known = new Uint8Array(n), queue = new Int32Array(n); let count = 0, head = 0, tail = 0;
    for (let p = 0; p < n; p++) { known[p] = mask[p] > 8 ? 0 : 1; if (!known[p]) count++; }
    if (!count) throw new Error("Paint over the item you want to remove first.");
    if (count > n * .25) throw new Error("Select a smaller area: local fill supports up to one quarter of the photo.");
    const neighbors = p => { const x = p % w, y = Math.floor(p / w), a = []; if (x) a.push(p - 1); if (x < w - 1) a.push(p + 1); if (y) a.push(p - w); if (y < h - 1) a.push(p + w); return a; };
    for (let p = 0; p < n; p++) if (known[p] === 0 && neighbors(p).some(q => known[q] === 1)) { known[p] = 2; queue[tail++] = p; }
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w), sum = [0, 0, 0]; let weight = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h || (!dx && !dy)) continue; const q = ny * w + nx; if (known[q] !== 1) continue; const s = 1 / (dx * dx + dy * dy); weight += s; for (let c = 0; c < 3; c++) sum[c] += out.data[q * 4 + c] * s; }
      if (weight) { for (let c = 0; c < 3; c++) out.data[p * 4 + c] = sum[c] / weight; }
      known[p] = 1; for (const q of neighbors(p)) if (known[q] === 0) { known[q] = 2; queue[tail++] = q; }
      if (!(head % 8192)) await pause();
    }
    // Diffuse the interior to remove propagation seams while preserving every unmasked pixel.
    for (let pass = 0; pass < 12; pass++) { for (let q = 0; q < tail; q++) { const p = queue[q]; if (!mask[p]) continue; const near = neighbors(p); for (let c = 0; c < 3; c++) { let sum = 0; for (const k of near) sum += out.data[k * 4 + c]; out.data[p * 4 + c] = sum / near.length; } } await pause(); }
    return out;
  }
  function validateCorners(points, w, h) {
    if (!Array.isArray(points) || points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > w - 1 || p.y > h - 1)) throw new Error("All four corners must stay inside the photo.");
    let area = 0;
    for (let i = 0; i < 4; i++) { const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4]; const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); if (cross <= 0) throw new Error("Keep the corners in order: top left, top right, bottom right, bottom left. The outline must not cross."); area += a.x * b.y - b.x * a.y; }
    if (area / 2 < w * h * .01) throw new Error("The selected board is too small. Move the corners farther apart.");
  }
  function solve(matrix, vector) {
    const rows = matrix.map((r, i) => [...r, vector[i]]), n = vector.length;
    for (let c = 0; c < n; c++) { let pivot = c; for (let r = c + 1; r < n; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r; [rows[c], rows[pivot]] = [rows[pivot], rows[c]]; if (Math.abs(rows[c][c]) < 1e-10) throw new Error("This corner layout cannot be flattened. Spread the corners apart."); const k = rows[c][c]; for (let j = c; j <= n; j++) rows[c][j] /= k; for (let r = 0; r < n; r++) if (r !== c) { const f = rows[r][c]; for (let j = c; j <= n; j++) rows[r][j] -= f * rows[c][j]; } }
    return rows.map(r => r[n]);
  }
  function rectify(input, points, longest = 1600, clean = true) {
    validateCorners(points, input.width, input.height);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const aspect = clamp((distance(points[0], points[1]) + distance(points[3], points[2])) / Math.max(1, distance(points[0], points[3]) + distance(points[1], points[2])), .2, 5);
    const edge = clamp(Math.round(longest), 64, MAX_EDGE), w = Math.round(aspect >= 1 ? edge : edge * aspect), h = Math.round(aspect >= 1 ? edge / aspect : edge);
    const dst = [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }], matrix = [], vector = [];
    for (let i = 0; i < 4; i++) { const { x, y } = dst[i], { x: u, y: v } = points[i]; matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]); vector.push(u, v); }
    const a = solve(matrix, vector), out = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const den = a[6] * x + a[7] * y + 1, sx = clamp((a[0] * x + a[1] * y + a[2]) / den, 0, input.width - 1), sy = clamp((a[3] * x + a[4] * y + a[5]) / den, 0, input.height - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(input.width - 1, x0 + 1), y1 = Math.min(input.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0, i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[i + c] = input.data[(y0 * input.width + x0) * 4 + c] * (1 - fx) * (1 - fy) + input.data[(y0 * input.width + x1) * 4 + c] * fx * (1 - fy) + input.data[(y1 * input.width + x0) * 4 + c] * (1 - fx) * fy + input.data[(y1 * input.width + x1) * 4 + c] * fx * fy;
    }
    if (clean) {
      const stats = percentiles(out), white = Math.max(175, stats.white), black = Math.min(60, stats.black);
      for (let i = 0; i < out.data.length; i += 4) { const max = Math.max(out.data[i], out.data[i + 1], out.data[i + 2]), min = Math.min(out.data[i], out.data[i + 1], out.data[i + 2]); for (let c = 0; c < 3; c++) { let v = clamp((out.data[i + c] - black) * 255 / (white - black)); if (max - min < 35 && v > 180) v += (255 - v) * .4; out.data[i + c] = v; } }
    }
    return out;
  }
  function suggestBoard(input) {
    const scale = Math.min(1, 220 / Math.max(input.width, input.height)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(input.width * scale)); c.height = Math.max(1, Math.round(input.height * scale)); c.getContext("2d").drawImage(tempCanvas(input), 0, 0, c.width, c.height);
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height), w = c.width, h = c.height, valid = new Uint8Array(w * h), visited = new Uint8Array(w * h), threshold = clamp(percentiles(data).median + 20, 150, 220);
    for (let p = 0; p < valid.length; p++) { const i = p * 4, r = data.data[i], g = data.data[i + 1], b = data.data[i + 2]; valid[p] = luminance(r, g, b) > threshold && Math.max(r, g, b) - Math.min(r, g, b) < 65 ? 1 : 0; }
    let largest = [];
    for (let start = 0; start < valid.length; start++) { if (!valid[start] || visited[start]) continue; const queue = [start]; visited[start] = 1; for (let q = 0; q < queue.length; q++) { const p = queue[q], x = p % w, y = Math.floor(p / w); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = ny * w + nx; if (nx < 0 || nx >= w || ny < 0 || ny >= h || visited[n] || !valid[n]) continue; visited[n] = 1; queue.push(n); } } if (queue.length > largest.length) largest = queue; }
    if (largest.length < valid.length * .1) throw new Error("No clear bright board found. Place the four corners manually.");
    const scores = [Infinity, -Infinity, -Infinity, Infinity], points = [null, null, null, null];
    for (const p of largest) { const x = p % w, y = Math.floor(p / w), sum = x + y, diff = x - y; if (sum < scores[0]) { scores[0] = sum; points[0] = { x, y }; } if (diff > scores[1]) { scores[1] = diff; points[1] = { x, y }; } if (sum > scores[2]) { scores[2] = sum; points[2] = { x, y }; } if (diff < scores[3]) { scores[3] = diff; points[3] = { x, y }; } }
    const result = points.map(p => ({ x: clamp(p.x / scale, 0, input.width - 1), y: clamp(p.y / scale, 0, input.height - 1) })); validateCorners(result, input.width, input.height); return { corners: result, coverage: largest.length / valid.length };
  }
  function resetCorners() { const p = photo(); if (!p) return; const w = p.current.width - 1, h = p.current.height - 1; state.corners = [{ x: w * .08, y: h * .08 }, { x: w * .92, y: h * .08 }, { x: w * .92, y: h * .92 }, { x: w * .08, y: h * .92 }]; updateCorners(); }
  function updateCorners() { if (!photo()) return; const { width: w, height: h } = photo().current; $("boardOverlay").setAttribute("viewBox", `0 0 ${w} ${h}`); $("boardPolygon").setAttribute("points", state.corners.map(p => `${p.x},${p.y}`).join(" ")); document.querySelectorAll(".corner").forEach((button, i) => { const point = state.corners[i]; if (!point) return; button.style.left = `${100 * point.x / w}%`; button.style.top = `${100 * point.y / h}%`; button.setAttribute("aria-valuetext", `${Math.round(point.x)}, ${Math.round(point.y)} pixels`); }); }
  function clearMask() { maskCtx.clearRect(0, 0, overlay.width, overlay.height); state.maskHistory = []; $("maskCount").textContent = "No area painted"; }
  function getMask() { const pixels = maskCtx.getImageData(0, 0, overlay.width, overlay.height).data, mask = new Uint8Array(overlay.width * overlay.height); for (let p = 0; p < mask.length; p++) mask[p] = pixels[p * 4 + 3]; return mask; }
  function restoreMask(mask) { const data = new ImageData(overlay.width, overlay.height); for (let p = 0; p < mask.length; p++) { const i = p * 4; data.data[i] = 194; data.data[i + 1] = 116; data.data[i + 2] = 225; data.data[i + 3] = mask[p]; } maskCtx.putImageData(data, 0, 0); updateMaskCount(mask); }
  function updateMaskCount(mask = getMask()) { let n = 0; for (const value of mask) if (value > 8) n++; $("maskCount").textContent = n ? `${Math.round(100 * n / mask.length)}% of the photo selected` : "No area painted"; }
  function workingPixels(items, changedPhoto, changedData) { return items.reduce((sum, item) => { const current = item === changedPhoto ? changedData : item.current; return sum + Math.max(item.original.width * item.original.height, current.width * current.height); }, 0); }
  function saveHistory() { const p = photo(); if (!p) return; state.history.push(clone(p.current)); while (state.history.length > 3 || state.history.reduce((sum, d) => sum + d.data.length, 0) > HISTORY_BUDGET) state.history.shift(); }
  function commit(data, name) { const p = photo(); if (!p) return; if (workingPixels(state.photos, p, data) > PIXEL_BUDGET) throw new Error("This output exceeds the working photo set size. Remove another photo and try again."); saveHistory(); p.current = data; p.modified = true; state.compare = false; clearMask(); render(); refreshThumb(p); resetCorners(); status(name); }
  function render() {
    const p = photo(); if (!p) return; const data = state.compare ? p.original : p.current;
    canvas.width = data.width; canvas.height = data.height; ctx.putImageData(data, 0, 0); overlay.width = p.current.width; overlay.height = p.current.height;
    $("photoName").textContent = p.name; $("photoDimensions").textContent = `${data.width} × ${data.height}`; $("sampleLabel").hidden = !p.sample; $("sampleLabel").textContent = p.sampleLabel || "AI-generated sample portrait"; $("compareButton").textContent = state.compare ? "Show edited" : "Show original"; $("compareButton").setAttribute("aria-pressed", String(state.compare));
    // Fit tall imports within the workspace without distorting the photo or corner coordinates.
    const maxHeight = Math.max(240, Math.min(window.innerHeight * .64, 700)); $("canvasWrap").style.maxWidth = `${maxHeight * data.width / data.height}px`;
    overlay.classList.toggle("painting", !state.compare && ["remove", "retouch"].includes(state.tool));
    $("boardOverlay").hidden = state.compare || state.tool !== "board"; $("boardCorners").hidden = state.compare || state.tool !== "board";
    updateButtons(); updateCorners();
  }
  function updateButtons() { $("undoButton").disabled = state.busy || !state.history.length; for (const id of ["matchButton", "matchAllButton"]) $(id).disabled = state.busy || !state.reference; $("removeButton").disabled = state.busy || state.compare; $("retouchButton").disabled = state.busy || state.compare; }
  function thumbnail(data) { const c = document.createElement("canvas"), scale = Math.min(1, 180 / Math.max(data.width, data.height)); c.width = Math.max(1, Math.round(data.width * scale)); c.height = Math.max(1, Math.round(data.height * scale)); c.getContext("2d").drawImage(tempCanvas(data), 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", .7); }
  function refreshThumb(p) { p.thumb = thumbnail(p.current); refreshStrip(); }
  function refreshStrip() {
    $("filmstrip").replaceChildren(); state.photos.forEach((p, i) => { const item = document.createElement("div"); item.className = "film-item" + (i === state.active ? " active" : ""); const choose = document.createElement("button"); choose.className = "film-select"; choose.setAttribute("aria-label", `Edit ${p.name}`); choose.setAttribute("aria-pressed", String(i === state.active)); const img = document.createElement("img"); img.alt = ""; img.src = p.thumb; const label = document.createElement("span"); label.textContent = p.name; choose.append(img, label); choose.addEventListener("click", () => { if (state.busy) return; state.active = i; state.history = []; state.compare = false; clearMask(); resetCorners(); render(); refreshStrip(); }); item.append(choose); if (state.photos.length > 1) { const remove = document.createElement("button"); remove.className = "remove-photo"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${p.name} from set`); remove.addEventListener("click", () => { if (state.busy) return; state.photos.splice(i, 1); state.active = Math.min(state.active - (i < state.active ? 1 : 0), state.photos.length - 1); state.history = []; state.compare = false; clearMask(); resetCorners(); render(); refreshStrip(); status("Photo removed from this working set."); }); item.append(remove); } $("filmstrip").append(item); }); $("setCount").textContent = `${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}`;
  }
  async function decodeFile(file) {
    if (!/\.(jpe?g|png|webp|avif|bmp)$/i.test(file.name) || (file.type && !/^image\/(jpeg|png|webp|avif|bmp|x-ms-bmp)$/.test(file.type))) throw new Error(`${file.name}: use a JPEG, PNG, WebP, AVIF or BMP photo.`);
    if (file.size > 35 * 1024 * 1024) throw new Error(`${file.name}: this file is larger than the 35 MB safety limit.`);
    const url = URL.createObjectURL(file); let image;
    try { image = new Image(); image.decoding = "async"; await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`${file.name}: the photo could not be read. It may be damaged or unsupported.`)); image.src = url; }); if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 120000000) throw new Error(`${file.name}: the photo dimensions exceed the import limit.`); const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale)); const context = c.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, c.width, c.height); context.drawImage(image, 0, 0, c.width, c.height); return context.getImageData(0, 0, c.width, c.height); }
    finally { URL.revokeObjectURL(url); if (image) image.src = ""; }
  }
  async function importPhotos(files) { await working("Importing photos on this device…", async () => {
    const errors = [], nextPhotos = state.photos.length === 1 && photo().sample ? [] : [...state.photos]; let count = 0;
    // Decode into a candidate set first. A rejected import must preserve edits, Undo,
    // the selected photo and a painted mask, including edits made to a sample.
    for (const file of [...files]) {
      if (nextPhotos.length >= MAX_PHOTOS) { errors.push("The working set is limited to 8 photos."); break; }
      try {
        const data = await decodeFile(file);
        if (workingPixels(nextPhotos) + data.width * data.height > PIXEL_BUDGET) { errors.push(`${file.name}: the photo set has reached its memory limit. Remove a photo first.`); continue; }
        const p = { name: file.name, original: data, current: clone(data), sample: false, modified: false }; p.thumb = thumbnail(data); nextPhotos.push(p); count++; await pause();
      } catch (error) { errors.push(error.message); }
    }
    if (count) { state.photos = nextPhotos; state.active = state.photos.length - 1; state.history = []; state.compare = false; clearMask(); render(); resetCorners(); refreshStrip(); }
    status(`${count ? `${count} photo${count > 1 ? "s" : ""} imported. Originals remain available with Reset photo.` : "No photos were imported. Your current photos and edits are unchanged."}${errors.length ? " " + errors.join(" ") : ""}`, Boolean(errors.length));
  }); }
  function setTool(tool) { if (state.busy) return; state.tool = tool; if (state.compare) { state.compare = false; render(); } clearMask(); document.querySelectorAll("[data-tool]").forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); }); document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active")); $(tool + "Panel").classList.add("active"); $("toolTitle").textContent = ({ enhance: "Smart Enhance", match: "Color Match", remove: "Object Removal", retouch: "Face Refinement", board: "Whiteboard" })[tool]; overlay.classList.toggle("painting", tool === "remove" || tool === "retouch"); $("boardOverlay").hidden = tool !== "board"; $("boardCorners").hidden = tool !== "board"; if (tool === "board") resetCorners(); status(({ enhance: "Adjust the strength, then enhance this photo or the full set.", match: "Import a reference photo, or use the current photo as your reference.", remove: "Paint over a small item. Fill works best on simple surrounding textures.", retouch: "Paint only over skin or teeth, then apply your chosen retouch.", board: "Place the four handles onto the board corners, following the numbered order." })[tool]); }
  function pointFromEvent(event) { const rect = overlay.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) * overlay.width / rect.width, 0, overlay.width - 1), y: clamp((event.clientY - rect.top) * overlay.height / rect.height, 0, overlay.height - 1) }; }
  function drawStroke(a, b) { const size = Number($(state.tool === "remove" ? "brushSize" : "retouchBrushSize").value); maskCtx.strokeStyle = "rgba(194,116,225,.6)"; maskCtx.fillStyle = "rgba(194,116,225,.6)"; maskCtx.lineWidth = size; maskCtx.lineCap = "round"; maskCtx.lineJoin = "round"; maskCtx.beginPath(); maskCtx.moveTo(a.x, a.y); maskCtx.lineTo(b.x, b.y); maskCtx.stroke(); if (a.x === b.x && a.y === b.y) { maskCtx.beginPath(); maskCtx.arc(a.x, a.y, size / 2, 0, Math.PI * 2); maskCtx.fill(); } }
  async function batchEdit(operation, description) { await working(`${description} your photo set…`, async () => { const results = []; for (let i = 0; i < state.photos.length; i++) { const p = state.photos[i], next = await operation(p.current); if (!next || next.width !== p.current.width || next.height !== p.current.height) throw new Error("The batch edit returned an invalid image. Your photo set is unchanged."); results.push({ data: next, thumb: thumbnail(next) }); status(`${description} photo ${i + 1} of ${state.photos.length}…`); await pause(); } state.photos.forEach((p, i) => { p.current = results[i].data; p.modified = true; p.thumb = results[i].thumb; }); state.history = []; state.compare = false; clearMask(); render(); refreshStrip(); status(`${description} complete for ${state.photos.length} photos. Reset photo restores each imported original.`); }); }
  function safeName(name) { return name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "MeetingLens-photo"; }
  async function jpegBlob(data) { const c = tempCanvas(data), context = c.getContext("2d"); context.globalCompositeOperation = "destination-over"; context.fillStyle = "#fff"; context.fillRect(0, 0, c.width, c.height); const result = await new Promise(resolve => c.toBlob(resolve, "image/jpeg", .94)); c.width = c.height = 1; if (!result) throw new Error("The browser could not encode this photo. Try a smaller photo."); return result; }
  function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  const crcTable = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
  function zipStore(entries) {
    const parts = [], central = []; let offset = 0;
    for (const entry of entries) { const name = new TextEncoder().encode(entry.name), bytes = entry.bytes, crc = crc32(bytes), header = new Uint8Array(30 + name.length), v = new DataView(header.buffer); v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(12, 0x21, true); v.setUint32(14, crc, true); v.setUint32(18, bytes.length, true); v.setUint32(22, bytes.length, true); v.setUint16(26, name.length, true); header.set(name, 30); parts.push(header, bytes); const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer); d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 0x21, true); d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46); central.push(directory); offset += header.length + bytes.length; }
    const centralSize = central.reduce((s, p) => s + p.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true); return new Blob([...parts, ...central, end], { type: "application/zip" });
  }
  function setReference(data, name) { state.reference = { ...colorStats(data), name }; $("referenceThumb").src = thumbnail(data); $("referenceName").textContent = name; $("referenceCard").hidden = false; updateButtons(); status(`Reference tone saved from ${name}. Your photos have not been changed yet.`); }
  async function loadSample(showStatus = true) { const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); const [portrait, background] = await Promise.all([load("./assets/demo/professional-portrait.webp"), load("./assets/demo/backgrounds/executive-office.webp")]); const c = document.createElement("canvas"); c.width = 1280; c.height = 720; const context = c.getContext("2d"); context.drawImage(background, 0, 0, c.width, c.height); const h = c.height * .985, w = portrait.naturalWidth * h / portrait.naturalHeight; context.drawImage(portrait, (c.width - w) / 2, c.height - h, w, h); const data = context.getImageData(0, 0, c.width, c.height); const p = { name: "Professional sample", sample: true, original: data, current: clone(data), modified: false }; p.thumb = thumbnail(data); state.photos.push(p); state.active = state.photos.length - 1; render(); resetCorners(); refreshStrip(); if (showStatus) status("Explore the AI-generated sample, or import your own photos. Edits stay in this browser session."); }
  async function loadBoardSample() { await working("Loading the whiteboard sample on this device…", async () => {
    if (state.photos.length >= MAX_PHOTOS) throw new Error("Remove a photo first. The working set is limited to 8 photos.");
    const image = new Image(); image.decoding = "async";
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("The included whiteboard sample could not be loaded. Your current photo set is unchanged.")); image.src = "./assets/demo/whiteboard-meeting.webp"; });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("The whiteboard sample has invalid dimensions. Your current photo set is unchanged.");
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const used = workingPixels(state.photos);
      if (used + c.width * c.height > PIXEL_BUDGET) throw new Error("Remove a photo before loading this sample. The working set has reached its memory limit.");
      const context = c.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, c.width, c.height); context.drawImage(image, 0, 0, c.width, c.height); const data = context.getImageData(0, 0, c.width, c.height);
      const p = { name: "Whiteboard sample", sample: true, sampleLabel: "AI-generated whiteboard sample", original: data, current: clone(data), modified: false }; p.thumb = thumbnail(data);
      state.photos.push(p); state.active = state.photos.length - 1; state.history = []; state.compare = false; clearMask(); render(); resetCorners(); refreshStrip(); $("boardDetectionStatus").textContent = "Place corners manually, or use Suggest and review the result."; status("AI-generated whiteboard sample loaded. Place the four board corners, or choose Suggest bright board corners and review them.");
    } finally { image.src = ""; }
  }); }
  document.querySelectorAll("[data-tool]").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
  for (const [id, suffix] of [["enhanceAmount", "%"], ["matchAmount", "%"], ["brushSize", " px"], ["retouchBrushSize", " px"], ["retouchAmount", "%"]]) $(id).addEventListener("input", () => $(id + "Value").textContent = $(id).value + suffix);
  $("photoInput").addEventListener("change", event => { const files = [...event.target.files]; event.target.value = ""; if (files.length) importPhotos(files); });
  $("referenceInput").addEventListener("change", event => { const file = event.target.files[0]; event.target.value = ""; if (file) working("Reading the reference tone…", async () => setReference(await decodeFile(file), file.name)); });
  $("useCurrentReferenceButton").addEventListener("click", () => setReference(photo().current, photo().name));
  $("enhanceButton").addEventListener("click", () => working("Analyzing light and color…", () => commit(autoEnhance(photo().current, Number($("enhanceAmount").value) / 100), "Smart Enhance applied. Use Show original to compare, or Undo to restore the previous edit.")));
  $("enhanceAllButton").addEventListener("click", () => batchEdit(data => autoEnhance(data, Number($("enhanceAmount").value) / 100), "Enhancement"));
  $("matchButton").addEventListener("click", () => working("Matching the reference tone…", () => commit(matchColor(photo().current, state.reference, Number($("matchAmount").value) / 100), "Reference tone matched to this photo.")));
  $("matchAllButton").addEventListener("click", () => batchEdit(data => matchColor(data, state.reference, Number($("matchAmount").value) / 100), "Color matching"));
  $("undoButton").addEventListener("click", () => { if (!state.history.length || state.busy) return; photo().current = state.history.pop(); photo().modified = true; state.compare = false; clearMask(); render(); resetCorners(); refreshThumb(photo()); status("Previous edit restored."); });
  $("resetPhotoButton").addEventListener("click", () => { if (!state.busy) commit(clone(photo().original), "Imported original restored."); });
  $("compareButton").addEventListener("click", () => { if (state.busy) return; state.compare = !state.compare; clearMask(); render(); overlay.classList.toggle("painting", !state.compare && ["remove", "retouch"].includes(state.tool)); $("boardOverlay").hidden = state.compare || state.tool !== "board"; $("boardCorners").hidden = state.compare || state.tool !== "board"; });
  $("exportPhotoButton").addEventListener("click", () => working("Preparing your edited JPEG…", async () => { download(await jpegBlob(photo().current), safeName(photo().name) + "-MeetingLens.jpg"); status("JPEG prepared. Your browser handles the download; the imported original is unchanged."); }));
  $("exportSetButton").addEventListener("click", () => working("Preparing the photo set…", async () => { const entries = []; for (let i = 0; i < state.photos.length; i++) { const p = state.photos[i]; entries.push({ name: `${String(i + 1).padStart(2, "0")}-${safeName(p.name)}-MeetingLens.jpg`, bytes: new Uint8Array(await (await jpegBlob(p.current)).arrayBuffer()) }); await pause(); } download(zipStore(entries), "MeetingLens-photo-set.zip"); status(`${entries.length} edited JPEG${entries.length === 1 ? "" : "s"} packaged in one ZIP.`); }));
  $("removeButton").addEventListener("click", () => { const mask = getMask(); working("Filling the selected area from nearby pixels…", async () => commit(await inpaint(photo().current, mask), "Local fill applied. Inspect the result closely; Undo is available.")); });
  $("retouchButton").addEventListener("click", () => { const mask = getMask(); if (!mask.some(v => v > 8)) { status("Paint over the skin or teeth area first. Only the painted area will change.", true); return; } working("Applying a targeted retouch…", () => commit(retouch(photo().current, mask, $("retouchMode").value, Number($("retouchAmount").value) / 100), "Retouch applied only inside your painted selection.")); });
  $("faceRefineButton").addEventListener("click", () => working("Finding facial landmarks on this device…", async () => { const vision = window.MeetingLensVision; if (!vision) throw new Error("Face assistance is unavailable. Use the manual skin and teeth brushes."); $("faceRefineStatus").textContent = "Preparing local face models…"; await vision.init({ onStatus: info => { $("faceRefineStatus").textContent = typeof info === "string" ? info : info.message || "Loading local models…"; } }); const input = tempCanvas(photo().current), output = document.createElement("canvas"), analysis = await vision.analyze(input, performance.now(), { face: true, segmentation: false, force: true }); if (!analysis?.face || !analysis?.faceLandmarks?.length) throw new Error("No clear face landmarks were found. Try a front-facing photo or use manual brushes."); await vision.process(input, output, { skinSmoothing: Number($("retouchAmount").value) / 100, teethWhitening: Number($("retouchAmount").value) / 100 * .7, portraitLight: 0, analysis }); if (!output.width || !output.height) throw new Error("Face assistance could not produce an image. Your photo is unchanged."); commit(output.getContext("2d").getImageData(0, 0, output.width, output.height), "Landmark-guided refinement applied to facial regions. Inspect the result and adjust with Undo if needed."); $("faceRefineStatus").textContent = "Local face landmarks used. Imported originals are retained."; }));
  for (const id of ["clearMaskButton", "clearRetouchMaskButton"]) $(id).addEventListener("click", clearMask);
  $("undoMaskButton").addEventListener("click", () => { const mask = state.maskHistory.pop(); if (mask) restoreMask(mask); });
  overlay.addEventListener("pointerdown", event => { if (state.busy || state.compare || event.button !== 0) return; event.preventDefault(); overlay.setPointerCapture(event.pointerId); state.maskHistory.push(getMask()); if (state.maskHistory.length > 3) state.maskHistory.shift(); state.pointer = pointFromEvent(event); drawStroke(state.pointer, state.pointer); });
  overlay.addEventListener("pointermove", event => { if (!state.pointer || state.busy) return; const next = pointFromEvent(event); drawStroke(state.pointer, next); state.pointer = next; });
  const endStroke = () => { if (state.pointer) { state.pointer = null; updateMaskCount(); } }; overlay.addEventListener("pointerup", endStroke); overlay.addEventListener("pointercancel", endStroke); overlay.addEventListener("lostpointercapture", endStroke);
  $("suggestBoardButton").addEventListener("click", () => working("Looking for a bright rectangular board…", () => { const result = suggestBoard(photo().current); state.corners = result.corners; updateCorners(); $("boardDetectionStatus").textContent = `Bright region found (${Math.round(result.coverage * 100)}% of photo). Review all four corners before applying.`; status("Suggested corners placed. Check and move the handles to match the actual board edges."); }));
  $("loadBoardSampleButton").addEventListener("click", loadBoardSample);
  $("rectifyButton").addEventListener("click", () => working("Straightening your board…", () => commit(rectify(photo().current, state.corners, Number($("boardSize").value), $("cleanBoard").checked), "Perspective corrected. Save JPEG to keep the readable board capture.")));
  document.querySelectorAll(".corner").forEach(button => { let dragging = false; const i = Number(button.dataset.corner); button.addEventListener("pointerdown", event => { if (state.busy || state.compare) return; event.preventDefault(); dragging = true; button.setPointerCapture(event.pointerId); }); button.addEventListener("pointermove", event => { if (!dragging) return; const rect = canvas.getBoundingClientRect(), p = photo().current; state.corners[i] = { x: clamp((event.clientX - rect.left) * p.width / rect.width, 0, p.width - 1), y: clamp((event.clientY - rect.top) * p.height / rect.height, 0, p.height - 1) }; updateCorners(); }); button.addEventListener("pointerup", () => dragging = false); button.addEventListener("pointercancel", () => dragging = false); button.addEventListener("lostpointercapture", () => dragging = false); button.addEventListener("keydown", event => { if (state.busy || !/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return; event.preventDefault(); const n = event.shiftKey ? 10 : 1, p = state.corners[i], data = photo().current; if (event.key === "ArrowLeft") p.x -= n; if (event.key === "ArrowRight") p.x += n; if (event.key === "ArrowUp") p.y -= n; if (event.key === "ArrowDown") p.y += n; p.x = clamp(p.x, 0, data.width - 1); p.y = clamp(p.y, 0, data.height - 1); updateCorners(); }); });
  for (const type of ["dragenter", "dragover"]) $("dropZone").addEventListener(type, event => { event.preventDefault(); if (!state.busy) $("dropZone").classList.add("dragging"); });
  $("dropZone").addEventListener("dragleave", event => { if (!$("dropZone").contains(event.relatedTarget)) $("dropZone").classList.remove("dragging"); });
  $("dropZone").addEventListener("drop", event => { event.preventDefault(); $("dropZone").classList.remove("dragging"); if (!state.busy && event.dataTransfer.files.length) importPhotos(event.dataTransfer.files); });
  document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) { event.preventDefault(); $("undoButton").click(); } });
  window.addEventListener("resize", () => { if (photo() && !state.busy) { const maxHeight = Math.max(240, Math.min(window.innerHeight * .64, 700)); $("canvasWrap").style.maxWidth = `${maxHeight * canvas.width / canvas.height}px`; } });
  window.MeetingLensPhoto = { autoEnhance, colorStats, matchColor, inpaint, retouch, rectify, suggestBoard, validateCorners, zipStore, loadBoardSample, getState: () => ({ photos: state.photos.length, active: state.active, tool: state.tool, busy: state.busy, corners: state.corners.map(p => ({ ...p })), width: canvas.width, height: canvas.height }) };
  working("Loading your sample…", async () => { try { await loadSample(); } catch { const c = new ImageData(640, 360); for (let i = 0; i < c.data.length; i += 4) { c.data[i] = 245; c.data[i + 1] = 244; c.data[i + 2] = 240; c.data[i + 3] = 255; } const p = { name: "Import a photo to begin", original: c, current: clone(c), sample: true }; p.thumb = thumbnail(c); state.photos = [p]; state.active = 0; render(); resetCorners(); refreshStrip(); $("sampleLabel").hidden = true; status("The sample could not be loaded. Import a photo to use the local editing tools.", true); } });
})();
