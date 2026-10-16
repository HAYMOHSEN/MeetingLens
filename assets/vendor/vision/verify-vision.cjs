/* Local inference regression test. Run from repository root:
 * CHROMIUM_PATH=/path/to/chromium node assets/vendor/vision/verify-vision.cjs */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../..");
const mime = { ".js": "text/javascript", ".cjs": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".png": "image/png", ".webp": "image/webp" };
(async () => {
  const requests = [], errors = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/vision-test") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/assets/js/vision-effects.js"></script></body></html>'); return; }
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (e, bytes) => { if (e) res.writeHead(404).end(); else { res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); res.end(bytes); } });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => requests.push(r.url()));
    page.on("console", m => { if (m.type() === "error") console.log("BROWSER", m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/vision-test`);
    const result = await page.evaluate(async () => {
      const statuses = [];
      const api = window.MeetingLensVision;
      const capabilities = await api.init({ onStatus: s => statuses.push(s) });
      const image = new Image(); image.src = "/assets/demo/professional-portrait.webp"; await image.decode();
      const source = document.createElement("canvas"); source.width = 640; source.height = Math.round(image.naturalHeight / image.naturalWidth * 640); source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
      const analysis = await api.analyze(source, performance.now(), { force: true });
      let maskStats = null;
      if (analysis.mask) {
        const data = analysis.mask.getContext("2d").getImageData(0, 0, analysis.mask.width, analysis.mask.height).data;
        let opaque = 0, transparent = 0, partial = 0;
        for (let i = 3; i < data.length; i += 4) { if (data[i] > 220) opaque++; else if (data[i] < 30) transparent++; else partial++; }
        const pixel = (nx, ny) => data[(Math.floor(ny * analysis.mask.height) * analysis.mask.width + Math.floor(nx * analysis.mask.width)) * 4 + 3];
        const alpha = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
        let intersection = 0, union = 0;
        for (let i = 3; i < data.length; i += 4) { const predicted = data[i] > 128, expected = alpha[i] > 128; if (predicted && expected) intersection++; if (predicted || expected) union++; }
        maskStats = { opaque, transparent, partial, total: data.length / 4, center: pixel(0.5, 0.5), corner: pixel(0.02, 0.02), silhouetteIoU: intersection / union };
      }
      const output = document.createElement("canvas");
      api.process(source, output, { analysis, backgroundBlur: 16, portraitLight: .35, skinSmoothing: .3, teethWhitening: .25 });
      const before = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
      const after = output.getContext("2d").getImageData(0, 0, output.width, output.height).data;
      let sum = 0; for (let i = 0; i < before.length; i += 4) sum += Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
      const difference = sum / (before.length / 4 * 3);
      const scene = document.createElement("canvas"); scene.width = source.width; scene.height = source.height;
      const sceneCtx = scene.getContext("2d"); sceneCtx.fillStyle = "#647c93"; sceneCtx.fillRect(0, 0, scene.width, scene.height);
      for (let x = 0; x < scene.width; x += 8) { sceneCtx.fillStyle = x % 16 ? "#d6e4ef" : "#1b3549"; sceneCtx.fillRect(x, 0, 4, scene.height); }
      sceneCtx.drawImage(source, 0, 0);
      const blurred = document.createElement("canvas"); api.process(scene, blurred, { analysis, backgroundBlur: 18 });
      const regionDifference = (box) => {
        const a = sceneCtx.getImageData(...box).data, b = blurred.getContext("2d").getImageData(...box).data; let delta = 0;
        for (let i = 0; i < a.length; i += 4) delta += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        return delta / (a.length / 4 * 3);
      };
      const faceCenter = analysis.face ? [Math.round((analysis.face.x + analysis.face.width / 2) * scene.width) - 12, Math.round((analysis.face.y + analysis.face.height / 2) * scene.height) - 12, 24, 24] : [0, 0, 24, 24];
      const blurEvidence = { foregroundMAE: regionDifference(faceCenter), backgroundMAE: regionDifference([8, 8, 80, 80]) };
      // Serialization must skip overlapping inference and retain a valid result.
      const concurrent = await Promise.all(Array.from({ length: 6 }, () => api.analyze(source, performance.now(), { force: true })));
      const framing = api.autoFrameCrop(analysis, source.width, source.height);
      const summary = { capabilities, face: analysis.face, landmarks: analysis.faceLandmarks?.length, maskStats, difference, blurEvidence, inferenceMs: analysis.inferenceMs, concurrent: concurrent.length, framing, statuses };
      api.reset(); summary.resetClears = api.latest.face === null && api.latest.mask === null;
      api.dispose(); summary.disposed = !api.capabilities.face && !api.capabilities.segmentation;
      return summary;
    });
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.capabilities.face, true, "Face model loaded in the worker");
    assert.equal(result.capabilities.segmentation, true, "Person model loaded in the worker");
    assert.equal(result.capabilities.eyeContact, false, "No fake eye-contact capability");
    assert.equal(result.landmarks, 478);
    assert(result.face.width > .08 && result.face.width < .8, "Actual detected face has plausible width");
    assert(result.face.height > .08 && result.face.height < .9, "Actual detected face has plausible height");
    assert(result.maskStats.opaque > result.maskStats.total * .08, "Substantial foreground exists");
    assert(result.maskStats.transparent > result.maskStats.total * .08, "Substantial background exists");
    assert(result.maskStats.center > result.maskStats.corner, "Person center is more foreground than outer corner");
    assert(result.maskStats.silhouetteIoU > .75, "AI segmentation overlaps the actual portrait alpha silhouette");
    assert(result.difference > .2, "Rendering changes actual pixels");
    assert(result.blurEvidence.foregroundMAE < 1, "Measured face remains sharp under background blur");
    assert(result.blurEvidence.backgroundMAE > 5, "Actual background detail is blurred");
    assert(result.resetClears && result.disposed);
    assert.deepEqual(errors, []);
    assert(requests.every(url => url.startsWith("http://127.0.0.1:")), "No third-party network requests");
    fs.writeFileSync(path.join(__dirname, "VALIDATION.json"), JSON.stringify({ testedAt: new Date().toISOString(), ...result, requests: requests.map(u => new URL(u).pathname), errors }, null, 2));
    console.log("PASS: real local face + person inference, restrained effects, reset, disposal, and local-only requests");
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
