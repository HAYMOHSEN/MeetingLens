#!/usr/bin/env node
/* Shipping regressions for retryable local vision, slow inference and explicit
 * update shutdown. Simulated worker faults make these timing paths repeatable;
 * the camera/microphone streams use Chromium's actual fake media devices. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), reports = [], contexts = new Set();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
let server, browser, base;
async function check(name, fn) {
  if (process.env.SHIPPING_CAMERA_CHECK && !name.toLowerCase().includes(process.env.SHIPPING_CAMERA_CHECK.toLowerCase())) return;
  const start = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function open(initializer) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", permissions: ["camera", "microphone"] }); contexts.add(context);
  if (initializer) await context.addInitScript(initializer);
  await context.addInitScript(() => {
    window.__qaStreams = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await gum(constraints); window.__qaStreams.push(stream); return stream; };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      if (this.canvas.id === "previewCanvas") window.__qaLatestDraw = { args, width: source.videoWidth || source.width, height: source.videoHeight || source.height };
      return draw.call(this, source, ...args);
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.__errors = []; page.on("pageerror", e => page.__errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.MeetingLensStudio);
  return { context, page };
}
async function close(context, page) { assert.deepEqual(page.__errors, [], "No uncaught browser errors"); await context.close(); contexts.delete(context); }
async function panel(page, name) { await page.locator(`[data-panel="${name}"]`).click(); }
function faultyWorker(firstCapabilities = null) {
  // This string is run in the browser before the real vision module is loaded.
  return `window.__qaWorkers = []; window.Worker = class {
    constructor() { this.index = window.__qaWorkers.length; this.terminated = false; window.__qaWorkers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message) {
      if (message.type === 'analyze') { this.pendingAnalyze = message; return; }
      if (message.type !== 'init') throw new Error('Unexpected test request');
      const data = this.index === 0 ? ${firstCapabilities ? JSON.stringify({ capabilities: firstCapabilities }) : "{ error: 'Temporary local model failure' }"} : { capabilities: { face: true, segmentation: true, backend: 'test worker', eyeContact: false } };
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...data } }));
    }
  };`;
}
async function installPredictableVision(page) {
  await page.evaluate(() => {
    window.__qaAnalysisCalls = 0; window.__qaProcessCalls = 0;
    window.MeetingLensVision.init = async () => ({ face: true, segmentation: true, backend: "test", eyeContact: false });
    window.MeetingLensVision.reset = () => {};
    window.MeetingLensVision.analyze = async (source, timestamp) => {
      window.__qaAnalysisCalls++;
      if (window.__qaAnalysisCalls > 1) return new Promise(resolve => { window.__qaReleaseAnalysis = () => resolve({ timestamp: performance.now(), face: null, mask: null }); });
      const mask = document.createElement("canvas"); mask.width = mask.height = 8; mask.getContext("2d").fillRect(0, 0, 8, 8);
      return { timestamp, face: { x: .2, y: .2, width: .1, height: .16 }, faceLandmarks: null, mask };
    };
    window.MeetingLensVision.process = (source, target) => { window.__qaProcessCalls++; target.width = source.width; target.height = source.height; target.getContext("2d").drawImage(source, 0, 0); return target; };
  });
  await panel(page, "effects"); await page.locator("#enableVisionButton").click();
  await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
}
async function run() {
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Local vision retries a transient initialization error without reloading", async () => {
    const { context, page } = await open(faultyWorker());
    await panel(page, "effects"); await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => /unavailable/i.test(document.querySelector("#visionStatus").textContent));
    assert.equal(await page.evaluate(() => window.__qaWorkers.length), 1);
    await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    assert.deepEqual(await page.evaluate(() => ({ count: window.__qaWorkers.length, oldTerminated: window.__qaWorkers[0].terminated })), { count: 2, oldTerminated: true });
    await close(context, page);
  });

  await check("A model response with no usable capabilities can be retried", async () => {
    const { context, page } = await open(faultyWorker({ face: false, segmentation: false, backend: "test", eyeContact: false }));
    const caps = await page.evaluate(async () => { const a = await window.MeetingLensVision.init(); const b = await window.MeetingLensVision.init(); return { a, b, count: window.__qaWorkers.length, terminated: window.__qaWorkers[0].terminated }; });
    assert(!caps.a.face && !caps.a.segmentation); assert(caps.b.face && caps.b.segmentation); assert.equal(caps.count, 2); assert(caps.terminated);
    await close(context, page);
  });

  await check("A stale event from a replaced worker cannot disable its replacement", async () => {
    const { context, page } = await open(faultyWorker());
    const result = await page.evaluate(async () => {
      await window.MeetingLensVision.init(); await window.MeetingLensVision.init();
      window.__qaWorkers[0].onerror({ message: "Late event from terminated worker" });
      return { caps: window.MeetingLensVision.capabilities, replacementStopped: window.__qaWorkers[1].terminated };
    });
    assert(result.caps.face && result.caps.segmentation); assert.equal(result.replacementStopped, false);
    await close(context, page);
  });

  await check("A partial model load keeps supported effects usable and offers recovery", async () => {
    const { context, page } = await open(faultyWorker({ face: true, segmentation: false, backend: "test", eyeContact: false }));
    await panel(page, "effects"); await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    assert(await page.locator("#autoFrameSwitch").isEnabled()); assert(await page.locator("#backgroundBlurSwitch").isDisabled());
    assert.match(await page.locator("#enableVisionButton").textContent(), /retry/i); assert(await page.locator("#enableVisionButton").isEnabled());
    await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady && window.MeetingLensVision.capabilities.segmentation);
    assert(await page.locator("#backgroundBlurSwitch").isEnabled()); assert(await page.locator("#enableVisionButton").isDisabled());
    assert.equal(await page.evaluate(() => window.__qaWorkers.length), 2);
    await close(context, page);
  });

  await check("Retrying a partial model load safely settles old in-flight analysis", async () => {
    const { context, page } = await open(faultyWorker({ face: true, segmentation: false, backend: "test", eyeContact: false }));
    const result = await page.evaluate(async () => {
      await window.MeetingLensVision.init();
      const source = document.createElement("canvas"); source.width = source.height = 8;
      const pending = window.MeetingLensVision.analyze(source, performance.now(), { force: true });
      while (!window.__qaWorkers[0].pendingAnalyze) await new Promise(resolve => setTimeout(resolve, 5));
      const caps = await window.MeetingLensVision.init(); await pending;
      return { caps, busy: window.MeetingLensVision.busy, oldTerminated: window.__qaWorkers[0].terminated, replacementStopped: window.__qaWorkers[1].terminated };
    });
    assert(result.caps.face && result.caps.segmentation); assert(result.oldTerminated); assert(!result.replacementStopped); assert(!result.busy);
    await close(context, page);
  });

  await check("Live preview drops stale masks and face crops while inference is stalled", async () => {
    const { context, page } = await open();
    await installPredictableVision(page);
    await page.locator("#startCameraButton").click(); await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live");
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => window.__qaProcessCalls > 0 && window.__qaLatestDraw.args[2] < window.__qaLatestDraw.width * .6);
    await page.waitForFunction(() => window.__qaAnalysisCalls > 1 && window.MeetingLensStudio.getState().visionPending);
    await page.waitForTimeout(1750);
    const before = await page.evaluate(() => ({ count: window.__qaProcessCalls, draw: window.__qaLatestDraw, state: window.MeetingLensStudio.getState() }));
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({ count: window.__qaProcessCalls, draw: window.__qaLatestDraw }));
    assert(before.state.visionPending, "Simulated inference is still pending");
    assert.equal(after.count, before.count, "An expired mask is never passed to the effect processor");
    assert(after.draw.args[2] >= after.draw.width * .99, "Live framing falls back to the wider source crop");
    assert.match(await page.locator("#trackingStatus").textContent(), /analysis delayed/i);
    await page.locator("#stopCameraButton").click(); await page.evaluate(() => window.__qaReleaseAnalysis());
    await close(context, page);
  });

  await check("Still sample effects remain available after the live freshness limit", async () => {
    const { context, page } = await open(); await installPredictableVision(page);
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => window.__qaProcessCalls > 0);
    const before = await page.evaluate(() => window.__qaProcessCalls);
    await page.waitForTimeout(1700);
    await page.locator("#blurAmountRange").evaluate(el => { el.value = "20"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForFunction(count => window.__qaProcessCalls > count, before);
    const draw = await page.evaluate(() => window.__qaLatestDraw); assert(draw.args[2] < draw.width * .6);
    await close(context, page);
  });

  await check("Still sample retries an inference result discarded while the tab was hidden", async () => {
    const { context, page } = await open(); await installPredictableVision(page);
    await page.evaluate(() => {
      let hidden = false; Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      window.__qaSetHidden = value => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
      window.MeetingLensVision.analyze = async (source, timestamp) => {
        window.__qaAnalysisCalls++;
        if (window.__qaAnalysisCalls === 1) return new Promise(resolve => { window.__qaReleaseAnalysis = () => resolve({ timestamp, face: { x: .2, y: .2, width: .1, height: .16 }, mask: null }); });
        return { timestamp, face: { x: .2, y: .2, width: .1, height: .16 }, mask: null };
      };
    });
    await page.locator("#autoFrameSwitch").click(); await page.waitForFunction(() => typeof window.__qaReleaseAnalysis === "function");
    await page.evaluate(() => { window.__qaSetHidden(true); window.__qaReleaseAnalysis(); });
    await page.waitForFunction(() => !window.MeetingLensStudio.getState().visionPending);
    assert.equal(await page.evaluate(() => window.__qaProcessCalls), 0, "Hidden inference never renders private frames");
    await page.evaluate(() => window.__qaSetHidden(false));
    await page.waitForFunction(() => window.__qaAnalysisCalls >= 2 && window.__qaProcessCalls > 0);
    assert(await page.evaluate(() => !!window.MeetingLensStudio.getAnalysis()?.face));
    await close(context, page);
  });

  await check("Still sample recovers from a transient empty-cache inference result", async () => {
    const { context, page } = await open(); await installPredictableVision(page);
    await page.evaluate(() => {
      window.MeetingLensVision.analyze = async (source, timestamp) => {
        window.__qaAnalysisCalls++;
        return window.__qaAnalysisCalls === 1 ? { timestamp: 0, face: null, mask: null } : { timestamp, face: { x: .2, y: .2, width: .1, height: .16 }, mask: null };
      };
    });
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => window.__qaAnalysisCalls >= 2 && window.__qaProcessCalls > 0);
    assert(await page.evaluate(() => !!window.MeetingLensStudio.getAnalysis()?.face));
    await close(context, page);
  });

  await check("Explicit update restart immediately stops camera, mic and private recording", async () => {
    const { context, page } = await open(() => {
      Object.defineProperty(navigator.serviceWorker, "register", { configurable: true, value: async () => ({ waiting: { postMessage(message) { window.__qaUpdateMessage = message; window.__qaUpdateStopped = window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended")); } }, addEventListener() {} }) });
    });
    await page.locator("#startCameraButton").click(); await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live");
    await panel(page, "session"); await page.locator("#voiceStartButton").click();
    await page.waitForFunction(() => window.__qaStreams.some(s => s.getAudioTracks().some(t => t.readyState === "live")));
    await page.locator("#voiceRecordButton").click(); await page.waitForFunction(() => !document.querySelector("#voiceRecordStopButton").disabled);
    await page.locator("#updateNotice").click();
    assert(await page.evaluate(() => window.__qaUpdateStopped), "All private streams end before activating the waiting worker");
    assert.deepEqual(await page.evaluate(() => window.__qaUpdateMessage), { type: "SKIP_WAITING" });
    assert.equal(await page.locator("#voicePlayback").getAttribute("src"), null, "Restart discards the private recording");
    assert(await page.locator("#voiceRecordButton").isDisabled());
    await close(context, page);
  });

  await check("Camera device copy accurately scopes video-only input while microphone is active", async () => {
    const { context, page } = await open();
    await page.locator("#startCameraButton").click(); await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live");
    await panel(page, "session"); await page.locator("#voiceStartButton").click();
    await page.waitForFunction(() => window.__qaStreams.some(s => s.getAudioTracks().some(t => t.readyState === "live")));
    await panel(page, "device");
    assert.match(await page.locator("#cameraSetupState").textContent(), /camera stream is video only/i);
    assert.doesNotMatch(await page.locator("#cameraSetupState").textContent(), /audio never requested|input · no audio/i);
    await page.evaluate(() => window.MeetingLensStudio.stop()); await close(context, page);
  });
}
run().catch(error => { reports.push({ name: "runner", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await new Promise(resolve => server?.close(resolve) || resolve());
  const reportPath = process.env.SHIPPING_CAMERA_REPORT || path.join(root, ".qa/shipping-camera-verification.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), checks: reports }, null, 2));
  const failed = reports.filter(r => !r.pass); console.log(`${reports.length - failed.length}/${reports.length} shipping camera checks passed`); process.exitCode = failed.length ? 1 : 0;
});
