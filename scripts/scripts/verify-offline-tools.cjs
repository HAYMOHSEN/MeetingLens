#!/usr/bin/env node
/* First-install offline integration for the v3 optional workspaces and models.
 * The HTTP server is closed after the real service worker finishes installing.
 * Playwright + Chromium with working WebGL2 are required (SwiftShader works). */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), reports = [], errors = [], evidence = {};
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
const modelFiles = ["assets/vendor/vision/meetinglens-worker.js", "assets/vendor/vision/vision_bundle.js", "assets/vendor/vision/wasm/vision_wasm_internal.js", "assets/vendor/vision/wasm/vision_wasm_internal.wasm", "assets/vendor/vision/wasm/vision_wasm_nosimd_internal.js", "assets/vendor/vision/wasm/vision_wasm_nosimd_internal.wasm", "assets/models/face_landmarker.task", "assets/models/selfie_segmenter.tflite"];
// A deterministic 37-module QR fixture for https://meetinglens.example/qr-test.
// Keeping modules as data avoids runtime QR generation dependencies.
const qrRows = `0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000111111101000011010100011111110000
0000100000101001111100111010000010000
0000101110101100101001100010111010000
0000101110101110100010111010111010000
0000101110100110100001100010111010000
0000100000101110000000010010000010000
0000111111101010101010101011111110000
0000000000000011010101101000000000000
0000110011100010110011011001011110000
0000100101011000011110000011111110000
0000011111110110000101000101000010000
0000110111010100101011011010010110000
0000001001100001011011001101000100000
0000010011011010100111101011111110000
0000100110110011111101101000011010000
0000110001011011010101010100000110000
0000000110110100110001010100000100000
0000111010001100011110100011110110000
0000001111101010000111100010001010000
0000001101001100101101111000000110000
0000110110101111011011101111110010000
0000000000001110100111111000100010000
0000111111100011111100111010111010000
0000100000101001010101111000100000000
0000101110101010110101011111110000000
0000101110100110011100001100000010000
0000101110100010000111010100011110000
0000100000101010101011101000010110000
0000111111101101011011001001010100000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000`.split("\n");
let server, browser, page, context, base, servedRequests = 0;
async function check(name, action) {
  const start = Date.now();
  try { await action(); reports.push({ name, passed: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function navigate(filename) {
  const response = await page.goto(new URL(filename, base).href, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200, `${filename} resolves offline`);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), "Navigation remains controlled by the installed worker");
}
async function run() {
  server = http.createServer((req, res) => {
    servedRequests++;
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));

  await check("Real service worker installs every v3 tool and all eight local AI runtime files", async () => {
    await page.goto(base);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const files = ["photo-workbench.html", "native-capabilities.html", "assets/js/photo-workbench.js", "assets/js/native-capabilities.js", "assets/js/session-tools.js", "assets/js/vision-effects.js", "assets/vendor/jsqr/jsQR.js", "assets/demo/whiteboard-meeting.webp", ...modelFiles];
    evidence.cached = await page.evaluate(async files => {
      const result = [];
      for (const file of files) { const response = await caches.match(new URL(file, location.href).href); result.push({ file, cached: !!response, bytes: response ? (await response.blob()).size : 0 }); }
      return result;
    }, files);
    assert(evidence.cached.every(item => item.cached && item.bytes > 0), JSON.stringify(evidence.cached));
    evidence.modelBytes = evidence.cached.filter(item => modelFiles.includes(item.file)).reduce((n, item) => n + item.bytes, 0);
    evidence.serverRequestsBeforeOffline = servedRequests;
    await context.setOffline(true);
    await new Promise(resolve => server.close(resolve));
    evidence.httpServerClosed = true;
  });
  // If warm installation failed, later checks must not run against a live server.
  if (!evidence.httpServerClosed) throw new Error("Offline tools cannot be validated because the service worker did not install fully.");

  await check("Offline Photo Lab loads its real whiteboard sample and suggests physical board corners", async () => {
    await navigate("photo-workbench.html");
    await page.waitForFunction(() => window.MeetingLensPhoto?.getState().photos === 1 && !window.MeetingLensPhoto.getState().busy);
    assert.equal(await page.locator("#photoName").textContent(), "Professional sample");
    await page.locator('[data-tool="board"]').click();
    await page.locator("#loadBoardSampleButton").click();
    await page.waitForFunction(() => !window.MeetingLensPhoto.getState().busy && document.querySelector("#photoName").textContent === "Whiteboard sample");
    const loaded = await page.evaluate(() => window.MeetingLensPhoto.getState());
    assert(loaded.width >= 1000 && loaded.height >= 700, "Cached photographic sample decodes at full working size");
    assert.equal(loaded.photos, 2, "Existing portrait is retained");
    await page.locator("#suggestBoardButton").click();
    await page.waitForFunction(() => !window.MeetingLensPhoto.getState().busy);
    evidence.board = await page.evaluate(() => { const state = window.MeetingLensPhoto.getState(); window.MeetingLensPhoto.validateCorners(state.corners, state.width, state.height); return state; });
    const expected = [{ x: 239, y: 45 }, { x: 1383, y: 178 }, { x: 1383, y: 709 }, { x: 239, y: 800 }];
    evidence.board.corners.forEach((p, i) => assert(Math.hypot(p.x - expected[i].x, p.y - expected[i].y) < 25, `Corner ${i + 1} follows the sample's board edge`));
    assert.match(await page.locator("#boardDetectionStatus").textContent(), /bright region found/i);
    await page.locator("#rectifyButton").click(); await page.waitForFunction(() => !window.MeetingLensPhoto.getState().busy);
    const downloadPromise = page.waitForEvent("download"); await page.locator("#exportPhotoButton").click();
    const bytes = fs.readFileSync(await (await downloadPromise).path());
    assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8"); assert(bytes.length > 10000, "Offline rectification produces a real JPEG");
    evidence.board.jpegBytes = bytes.length;
  });

  await check("Offline Windows capability viewer imports a local report without probing hardware", async () => {
    await navigate("native-capabilities.html");
    assert.match(await page.locator("#nativeReportStatus").textContent(), /does not probe or control your camera/i);
    const report = { schema: "meetinglens.windows.capabilities.v1", source: "Offline regression fixture", platform: "Windows", device: { name: "Offline test webcam" }, effects: [], formats: [{ width: 1920, height: 1080, numerator: 30, denominator: 1, subtype: "MJPG" }] };
    await page.locator("#nativeReportInput").setInputFiles({ name: "offline-camera.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)) });
    await page.locator("#nativeReport").waitFor({ state: "visible" });
    assert.equal(await page.locator("#nativeDeviceName").textContent(), "Offline test webcam");
    assert.match(await page.locator("#nativeReportStatus").textContent(), /imported locally/i);
    assert.match(await page.locator("#nativeFormatsList").textContent(), /1920 × 1080.*30 fps/);
    evidence.nativeViewer = { reportImportedOffline: true, physicalHardwareProbed: false };
  });

  await check("Cached jsQR decoder loads offline and decodes a real QR fixture", async () => {
    await navigate("?screen=session");
    evidence.qr = await page.evaluate(async rows => {
      await new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "./assets/vendor/jsqr/jsQR.js"; script.onload = resolve; script.onerror = reject; document.head.append(script); });
      const c = document.createElement("canvas"), moduleSize = 8; c.width = c.height = rows.length * moduleSize;
      const ctx = c.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = "black";
      rows.forEach((row, y) => [...row].forEach((value, x) => { if (value === "1") ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize); }));
      const result = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      return { decoded: result?.data || null, width: c.width, height: c.height };
    }, qrRows);
    assert.equal(evidence.qr.decoded, "https://meetinglens.example/qr-test");
  });

  await check("Offline studio initializes actual cached AI models and detects face and person matte", async () => {
    await navigate("?screen=effects");
    await page.locator("#effects-panel.active").waitFor();
    await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady || /unavailable|could not|cannot run/i.test(document.querySelector("#visionStatus").textContent), null, { timeout: 100000 });
    const capabilities = await page.evaluate(() => window.MeetingLensVision.capabilities);
    assert(capabilities.face && capabilities.segmentation, `Both models initialize offline: ${JSON.stringify(capabilities)}; ${await page.locator("#visionStatus").textContent()}`);
    await page.locator("#autoFrameSwitch").click(); await page.locator("#backgroundBlurSwitch").click();
    await page.waitForFunction(() => !!window.MeetingLensStudio.getAnalysis()?.face && !!window.MeetingLensStudio.getAnalysis()?.mask, null, { timeout: 30000 });
    evidence.vision = await page.evaluate(() => {
      const a = window.MeetingLensStudio.getAnalysis(), mask = a.mask, data = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data;
      let foreground = 0, background = 0;
      for (let i = 3; i < data.length; i += 4) { if (data[i] > 250) foreground++; if (data[i] < 5) background++; }
      return { capabilities: window.MeetingLensVision.capabilities, face: a.face, landmarks: a.faceLandmarks?.length, mask: { width: mask.width, height: mask.height, foreground, background }, inferenceMs: a.inferenceMs };
    });
    assert.equal(evidence.vision.landmarks, 478);
    assert(evidence.vision.face.width > .04 && evidence.vision.face.height > .05);
    assert(evidence.vision.mask.foreground > 1000 && evidence.vision.mask.background > 1000);
    assert.equal(evidence.vision.capabilities.backend, "CPU/WASM worker"); assert.equal(evidence.vision.capabilities.eyeContact, false);
    assert.deepEqual(errors, [], "No unhandled browser exceptions across offline workspaces");
    assert.equal(servedRequests, evidence.serverRequestsBeforeOffline, "No HTTP request reaches a server after offline transition");
  });
}
run().catch(error => { reports.push({ name: "Offline tools harness", passed: false, error: error.stack }); console.error(error); }).finally(async () => {
  await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  const output = path.join(root, ".qa"); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "offline-tools-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), environment: "Headless Chromium/Linux, SwiftShader WebGL2", offlineAfterSuccessfulFirstInstall: true, physicalWindowsHardwareTested: false, reports, evidence, errors }, null, 2));
  const failed = reports.filter(r => !r.passed).length; console.log(`${reports.length - failed}/${reports.length} offline tools checks passed`); process.exitCode = failed ? 1 : 0;
});
