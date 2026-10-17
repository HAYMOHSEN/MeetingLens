#!/usr/bin/env node
/* AI startup diagnostics and restoration of saved effects. Models are mocked
 * deliberately; these checks exercise the real vision bridge and studio UI. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), reports = [], contexts = new Set();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
const ready = { face: true, segmentation: true, backend: "controlled test worker", eyeContact: false };
let server, browser, base;
async function check(name, action) {
  if (process.env.AI_STARTUP_CHECK && !name.toLowerCase().includes(process.env.AI_STARTUP_CHECK.toLowerCase())) return;
  try { await action(); reports.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function open(settings = {}, responses = [{ capabilities: ready }]) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: "block", permissions: ["camera"] }); contexts.add(context);
  await context.addInitScript(({ settings, responses }) => {
    localStorage.setItem("meetinglens-settings", JSON.stringify(settings));
    window.__startupWorkers = [];
    window.Worker = class {
      constructor() { this.index = window.__startupWorkers.length; this.terminated = false; window.__startupWorkers.push(this); }
      terminate() { this.terminated = true; }
      postMessage(message) {
        if (message.type === "init") {
          const response = responses[Math.min(this.index, responses.length - 1)];
          queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...response } }));
        } else if (message.type === "analyze") {
          message.bitmap?.close();
          const response = responses[Math.min(this.index, responses.length - 1)];
          window.__startupAnalysisOptions = message.options;
          if (response.analyzeError && !window.__startupFramesReleased) {
            if (!this.analysisFailed) { this.analysisFailed = true; queueMicrotask(() => this.onmessage?.({ data: { id: message.id, error: response.analyzeError } })); }
            else window.__startupReleaseFrame = () => { window.__startupFramesReleased = true; this.onmessage?.({ data: { id: message.id, result: { timestamp: message.timestamp, face: null, mask: null } } }); };
            return;
          }
          queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: { timestamp: message.timestamp, face: response.analysisFace || null, mask: null } } }));
        }
      }
    };
  }, { settings, responses });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.__errors = [];
  page.on("pageerror", error => page.__errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.MeetingLensStudio));
  return { context, page };
}
async function close(context, page) { assert.deepEqual(page.__errors, []); await context.close(); contexts.delete(context); }
async function panel(page, name) { await page.locator(`[data-panel="${name}"]`).click(); }
async function start(page) { await page.locator("#startCameraButton").click(); await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live"); }
async function workerCount(page, count) { await page.waitForFunction(expected => window.__startupWorkers.length === expected, count); }
async function load(page) { await panel(page, "effects"); await page.locator("#enableVisionButton").click(); }
async function noWorker(page) { await page.waitForTimeout(180); assert.equal(await page.evaluate(() => window.__startupWorkers.length), 0); }
async function run() {
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) res.writeHead(404).end(); else res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }).end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Startup errors appear in AI details and the Background panel", async () => {
    const cause = "WebGL2 is disabled or unavailable for local vision processing.";
    const { context, page } = await open({ backgroundReplace: true }, [{ error: cause }]);
    await start(page); await workerCount(page, 1);
    await page.waitForFunction(text => document.getElementById("visionDiagnosticText").textContent.includes(text), cause);
    await panel(page, "background"); assert.match(await page.locator("#liveBackgroundStatus").textContent(), /Cause: WebGL2/);
    assert(await page.locator("#retryBackgroundButton").isVisible());
    await panel(page, "effects"); assert(await page.locator("#visionDiagnostics").isVisible()); assert(await page.locator("#enableVisionButton").isEnabled());
    await close(context, page);
  });
  await check("A face-only startup preserves face controls and explains missing background detection", async () => {
    const cause = "Failed to fetch person model: HTTP 404";
    const { context, page } = await open({}, [{ capabilities: { ...ready, segmentation: false, errors: { segmentation: cause } } }, { capabilities: ready }]);
    await load(page); await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    assert.match(await page.locator("#visionStatus").textContent(), /Face tracking ready\. Background detection is unavailable/);
    assert(await page.locator("#autoFrameSwitch").isEnabled()); assert(await page.locator("#backgroundBlurSwitch").isDisabled());
    assert((await page.locator("#visionDiagnosticText").textContent()).includes(cause)); assert(await page.locator("#enableVisionButton").isEnabled());
    await page.locator("#enableVisionButton").click(); await page.waitForFunction(() => document.getElementById("backgroundBlurSwitch").disabled === false);
    assert(await page.locator("#visionDiagnostics").isHidden());
    await close(context, page);
  });
  await check("A segmentation-only startup preserves background controls and explains missing face tracking", async () => {
    const { context, page } = await open({}, [{ capabilities: { ...ready, face: false, errors: { face: "Face model download failed" } } }]);
    await load(page); await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    assert.match(await page.locator("#visionStatus").textContent(), /Background detection ready.*Face tracking is unavailable/);
    assert(await page.locator("#autoFrameSwitch").isDisabled()); assert(await page.locator("#backgroundBlurSwitch").isEnabled());
    assert.match(await page.locator("#visionDiagnosticText").textContent(), /Face model download failed/);
    await close(context, page);
  });
  await check("Diagnostic error strings render literally and a successful retry clears them", async () => {
    const hostile = '<img src=x onerror="window.__diagnosticInjected=true"> Model failed';
    const { context, page } = await open({}, [{ error: hostile }, { capabilities: ready }]);
    await load(page); await page.waitForFunction(() => !document.getElementById("visionDiagnostics").hidden);
    assert((await page.locator("#visionDiagnosticText").textContent()).includes(hostile));
    assert.equal(await page.locator("#visionDiagnosticText img").count(), 0); assert.equal(await page.evaluate(() => window.__diagnosticInjected), undefined);
    await page.locator("#enableVisionButton").click(); await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    assert(await page.locator("#visionDiagnostics").isHidden()); assert.equal(await page.locator("#visionDiagnosticText").textContent(), "");
    await close(context, page);
  });
  await check("A recoverable frame error is readable without disabling models and clears after progress", async () => {
    const cause = "Frame texture temporarily unavailable";
    const { context, page } = await open({ backgroundBlur: true }, [{ capabilities: ready, analyzeError: cause }]);
    await start(page); await page.waitForFunction(text => document.getElementById("visionDiagnosticText").textContent.includes(text), cause);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().visionReady), true);
    await page.waitForFunction(() => typeof window.__startupReleaseFrame === "function");
    await page.evaluate(() => window.__startupReleaseFrame()); await page.waitForFunction(() => document.getElementById("visionDiagnostics").hidden);
    await close(context, page);
  });
  await check("Unrelated adjustments preserve a healthy partial worker until explicit retry", async () => {
    const { context, page } = await open({ backgroundBlur: true }, [
      { capabilities: { ...ready, segmentation: false, errors: { segmentation: "Person model unavailable" } } },
      { capabilities: ready }
    ]);
    await start(page); await workerCount(page, 1); await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    await panel(page, "looks");
    for (const value of [57, 61, 54]) await page.locator("#brightnessRange").fill(String(value));
    await panel(page, "frame");
    for (const value of [105, 110, 100]) await page.locator("#zoomRange").fill(String(value));
    for (const value of [66, 75, 50]) await page.locator("#enhancementRange").fill(String(value));
    await panel(page, "effects");
    assert.equal(await page.evaluate(() => window.__startupWorkers.length), 1);
    assert.equal(await page.evaluate(() => window.__startupWorkers[0].terminated), false);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().visionReady), true);
    assert(await page.locator("#autoFrameSwitch").isEnabled()); assert(await page.locator("#backgroundBlurSwitch").isDisabled());
    await page.locator("#enableVisionButton").click(); await workerCount(page, 2);
    await page.waitForFunction(() => document.getElementById("backgroundBlurSwitch").disabled === false);
    assert.equal(await page.evaluate(() => window.__startupWorkers[0].terminated), true);
    await close(context, page);
  });
  await check("A saved blur with missing segmentation reports its cause without claiming active blur", async () => {
    const cause = "Person segmentation model could not load";
    const { context, page } = await open({ backgroundBlur: true }, [
      { capabilities: { ...ready, segmentation: false, errors: { segmentation: cause } } },
      { capabilities: ready }
    ]);
    await start(page); await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady);
    await panel(page, "background");
    const message = await page.locator("#liveBackgroundStatus").textContent();
    assert(message.includes(cause)); assert.match(message, /unavailable/); assert.doesNotMatch(message, /selected with blur|Live background blur/);
    assert.doesNotMatch(await page.locator("#effectLabel").textContent(), /background blur/i);
    assert(await page.locator("#retryBackgroundButton").isVisible());
    await panel(page, "effects"); assert(await page.locator("#autoFrameSwitch").isEnabled()); assert(await page.locator("#backgroundBlurSwitch").isDisabled());
    await panel(page, "background"); await page.locator("#retryBackgroundButton").click(); await workerCount(page, 2);
    await page.waitForFunction(() => document.getElementById("backgroundBlurSwitch").disabled === false);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().backgroundReplace), false);
    assert.doesNotMatch(await page.locator("#effectLabel").textContent(), /background blur/i);
    assert.match(await page.locator("#liveBackgroundStatus").textContent(), /Finding you|tracking is delayed/);
    await close(context, page);
  });
  await check("Available face effects keep processing when saved background effects are unavailable", async () => {
    const { context, page } = await open({ autoFrame: true, refinement: true, teeth: true, backgroundBlur: true, portraitLight: true, backgroundReplace: true }, [{
      capabilities: { ...ready, segmentation: false, errors: { segmentation: "Person model unavailable" } },
      analysisFace: { x: .3, y: .2, width: .2, height: .25, eyes: [{ x: .36, y: .3 }, { x: .44, y: .3 }] }
    }]);
    await page.evaluate(() => {
      window.__startupFaceProcessing = [];
      const process = window.MeetingLensVision.process;
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
        if (this.canvas.id === "previewCanvas" && args.length === 8) window.__startupFaceCrop = { sourceWidth: source.videoWidth || source.width, cropWidth: args[2] };
        return drawImage.call(this, source, ...args);
      };
      window.MeetingLensVision.process = (source, target, options) => {
        window.__startupFaceProcessing.push({ backgroundImage: Boolean(options.backgroundImage), backgroundBlur: options.backgroundBlur,
          portraitLight: options.portraitLight, skinSmoothing: options.skinSmoothing, teethWhitening: options.teethWhitening });
        return process(source, target, options);
      };
    });
    await start(page); await page.waitForFunction(() => window.__startupFaceProcessing.length > 0);
    const result = await page.evaluate(() => ({ calls: window.__startupFaceProcessing, options: window.__startupAnalysisOptions,
      state: window.MeetingLensStudio.getState(), pair: window.MeetingLensStudio.getFramePair(), face: window.MeetingLensStudio.getAnalysis()?.face, crop: window.__startupFaceCrop }));
    assert.deepEqual(result.options, { face: true, segmentation: false });
    assert(result.calls.every(item => !item.backgroundImage && item.backgroundBlur === 0 && item.portraitLight === 0 && item.skinSmoothing > 0 && item.teethWhitening > 0));
    assert.equal(result.pair, null); assert(result.face); assert(result.state.autoFrame && result.state.refinement && result.state.backgroundBlur && result.state.backgroundReplace);
    assert(result.crop.cropWidth < result.crop.sourceWidth, "Available face tracking still drives auto framing");
    await panel(page, "effects"); assert(await page.locator("#autoFrameSwitch").isEnabled()); assert(await page.locator("#refinementSwitch").isEnabled());
    await panel(page, "background"); assert.match(await page.locator("#liveBackgroundStatus").textContent(), /Person model unavailable/);
    assert.doesNotMatch(await page.locator("#fpsLabel").textContent(), /Processing background|fps · effects/);
    await close(context, page);
  });
  for (const setting of ["backgroundReplace", "backgroundBlur", "portraitLight", "autoFrame", "refinement", "teeth"]) {
    await check(`Saved ${setting} automatically loads local models after camera start`, async () => {
      const { context, page } = await open({ [setting]: true }); await noWorker(page); await start(page); await workerCount(page, 1);
      await page.waitForFunction(() => window.MeetingLensStudio.getState().visionReady); assert.equal(await page.evaluate(key => window.MeetingLensStudio.getState()[key], setting), true);
      await close(context, page);
    });
  }
  await check("Basic preview defers saved effects until Basic is disabled", async () => {
    const { context, page } = await open({ backgroundBlur: true, browserBasic: true }); await start(page); await noWorker(page);
    await panel(page, "device"); await page.locator("#browserBasicSwitch").click(); await workerCount(page, 1);
    await close(context, page);
  });
  await check("Zero intensity defers saved effects until intensity increases", async () => {
    const { context, page } = await open({ portraitLight: true, enhancement: 0 }); await start(page); await noWorker(page);
    await page.locator("#enhancementRange").fill("65"); await workerCount(page, 1);
    await close(context, page);
  });
  await check("Original held defers loading and releasing Original restores saved effects", async () => {
    const { context, page } = await open({ backgroundBlur: true, enhancement: 0 }); await start(page); await noWorker(page);
    await page.keyboard.down("c");
    await page.locator("#enhancementRange").fill("65"); await noWorker(page);
    await page.keyboard.up("c"); await workerCount(page, 1);
    await close(context, page);
  });
  await check("All effects off and Privacy Shield do not start local models", async () => {
    const { context, page } = await open(); await start(page); await noWorker(page);
    await page.locator("#shieldQuickButton").click(); assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().privacy), true);
    assert(await page.locator("#startCameraButton").isDisabled()); await noWorker(page);
    await close(context, page);
  });
}
run().catch(error => { reports.push({ name: "runner", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  for (const context of contexts) await context.close(); if (browser) await browser.close(); if (server) server.close();
  fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
  const failed = reports.filter(item => !item.pass).length;
  fs.writeFileSync(path.join(root, ".qa", "ai-startup-verification.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scope: "Controlled worker responses; real studio and vision bridge, Chromium fake camera. No physical Windows webcam or real model execution.", passed: reports.length - failed, failed, reports }, null, 2) + "\n");
  if (failed) process.exitCode = 1;
});
