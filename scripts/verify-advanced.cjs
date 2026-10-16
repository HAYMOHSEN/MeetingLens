#!/usr/bin/env node
/* Integration checks for the v3 studio. Real bundled MediaPipe models run in a
 * worker; fake camera tests exercise browser lifecycle without physical hardware.
 * Run with Playwright available and CHROMIUM_PATH set when required. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const reports = [], contexts = new Set();
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
let server, browser, base;
async function check(name, fn) {
  if (process.env.ADVANCED_CHECK && !name.toLowerCase().includes(process.env.ADVANCED_CHECK.toLowerCase())) return;
  const start = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function open({ viewport = { width: 1920, height: 1080 }, initializer, missingModels = false } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block", permissions: ["camera"], acceptDownloads: true });
  contexts.add(context);
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  page.__errors = []; page.__requests = [];
  page.on("pageerror", error => page.__errors.push(error.message));
  page.on("request", req => page.__requests.push(req.url()));
  await page.addInitScript(() => {
    window.__qaDraws = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      if (this.canvas.id === "previewCanvas") {
        const m = this.getTransform();
        window.__qaDraws.push({ args, width: source.videoWidth || source.naturalWidth || source.width, height: source.videoHeight || source.naturalHeight || source.height, filter: this.filter, matrix: [m.a, m.b, m.c, m.d, m.e, m.f] });
        if (window.__qaDraws.length > 20) window.__qaDraws.shift();
      }
      return draw.call(this, source, ...args);
    };
    window.__qaStreams = []; window.__qaConstraints = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__qaConstraints.push(JSON.parse(JSON.stringify(constraints)));
      const stream = await getUserMedia(constraints); window.__qaStreams.push(stream); return stream;
    };
  });
  if (initializer) await page.addInitScript(initializer);
  if (missingModels) await page.route(/\/(?:assets\/models\/|.*\.task(?:\?|$)|.*\.tflite(?:\?|$))/, route => route.fulfill({ status: 503, body: "Model unavailable for regression check" }));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const c = document.querySelector("#previewCanvas"); if (!c?.width || !c.height) return false;
    const p = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return p[0] + p[1] + p[2] > 20;
  });
  return { context, page };
}
async function close(context, page) {
  assert.deepEqual(page.__errors, [], "No uncaught page errors");
  await context.close(); contexts.delete(context);
}
async function panel(page, name) {
  await page.locator(`[data-panel="${name}"]`).click();
  await page.locator(`#${name}-panel.active`).waitFor();
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
  await page.waitForTimeout(150);
}
async function pixels(page) {
  return page.locator("#previewCanvas").evaluate(source => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    canvas.getContext("2d").drawImage(source, 0, 0, 640, 360);
    return [...canvas.getContext("2d").getImageData(0, 0, 640, 360).data];
  });
}
function meanDifference(a, b, predicate = () => true) {
  assert.equal(a.length, b.length); let total = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) if (predicate(i / 4)) for (let c = 0; c < 3; c++) { total += Math.abs(a[i + c] - b[i + c]); n++; }
  return n ? total / n : 0;
}
async function loadVision(page) {
  await panel(page, "effects");
  await page.locator("#enableVisionButton").click();
  await page.waitForFunction(() => /ready|could not|unavailable|cannot run/i.test(document.querySelector("#visionStatus").textContent), null, { timeout: 100000 });
  const caps = await page.evaluate(() => window.MeetingLensVision.capabilities);
  assert(caps.face && caps.segmentation, `Bundled face and segmentation initialize: ${JSON.stringify(caps)}; ${await page.locator("#visionStatus").textContent()}`);
  assert.equal(caps.eyeContact, false, "Browser API never claims gaze correction");
  return caps;
}
async function run() {
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Studio modules, every panel and linked workspaces load without errors", async () => {
    const { context, page } = await open();
    assert(await page.evaluate(() => !!window.MeetingLensVision && !!window.MeetingLensSessionTools), "Vision and session modules are available");
    const panels = await page.locator("[data-panel]").evaluateAll(els => els.map(el => el.dataset.panel));
    assert(panels.includes("effects") && panels.includes("session"));
    for (const name of panels) { await panel(page, name); assert(await page.locator(`#${name}-panel input, #${name}-panel button, #${name}-panel a, #${name}-panel select`).count() > 0); }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const target of ["photo-workbench.html", "native-capabilities.html"]) {
      const response = await page.goto(new URL(target, base).href); assert.equal(response.status(), 200);
      assert((await page.locator("body").textContent()).trim().length > 100);
    }
    await close(context, page);
  });

  await check("Fine zoom keeps 0.1 percent precision in stored state and rendered crop", async () => {
    const { context, page } = await open();
    await panel(page, "frame");
    await range(page, "zoomRange", 100);
    const standard = await page.evaluate(() => window.__qaDraws.at(-1));
    await range(page, "zoomRange", 100.1);
    const fine = await page.evaluate(() => ({ draw: window.__qaDraws.at(-1), saved: JSON.parse(localStorage.getItem("meetinglens-settings")).zoom }));
    assert.equal(fine.saved, 100.1); assert.equal(await page.locator("#zoomOutput").textContent(), "100.1%");
    assert(fine.draw.args[2] < standard.args[2], "Actual source crop becomes narrower at 100.1%");
    assert(Math.abs(fine.draw.args[2] / standard.args[2] - 1 / 1.001) < 0.00001, "Canvas geometry uses the decimal zoom");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#zoomRange").inputValue(), "100.1");
    await close(context, page);
  });

  await check("Requested camera resolution and FPS recover safely from unsupported constraints", async () => {
    const { context, page } = await open({ initializer: () => {
      const original = navigator.mediaDevices.getUserMedia;
      window.__qaAttemptConstraints = []; let rejected = false;
      navigator.mediaDevices.getUserMedia = constraints => {
        window.__qaAttemptConstraints.push(JSON.parse(JSON.stringify(constraints)));
        if (!rejected) { rejected = true; return Promise.reject(new DOMException("Unsupported mode for regression test", "OverconstrainedError")); }
        return original(constraints);
      };
    } });
    await panel(page, "device");
    await page.locator("#deviceResolutionSelect").selectOption("1920x1080");
    await page.locator("#deviceFpsSelect").selectOption("24");
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    const calls = await page.evaluate(() => window.__qaAttemptConstraints);
    assert(calls.length >= 2, "A fallback acquisition is attempted");
    assert.equal(calls[0].video.width.ideal ?? calls[0].video.width.exact, 1920);
    assert.equal(calls[0].video.height.ideal ?? calls[0].video.height.exact, 1080);
    assert.equal(calls[0].video.frameRate.ideal, 24);
    assert(!calls[1].video.width && !calls[1].video.frameRate, "Safe fallback drops mode constraints");
    assert(calls.every(c => c.audio === false));
    assert.match(await page.locator("#cameraCapabilitiesText").textContent(), /actual|input|driver/i);
    await page.locator("#stopCameraButton").click();
    assert(await page.evaluate(() => window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))));
    await close(context, page);
  });

  await check("Real local models detect the portrait; UI blur changes the background while preserving the face", async () => {
    const { context, page } = await open();
    const caps = await loadVision(page);
    await panel(page, "looks"); await range(page, "enhancementRange", 100);
    await panel(page, "background"); await range(page, "sceneStrengthRange", 0);
    const before = await pixels(page);
    await panel(page, "effects"); await range(page, "blurAmountRange", 30);
    await page.locator("#backgroundBlurSwitch").click();
    await page.waitForFunction(() => !!window.MeetingLensStudio.getAnalysis()?.mask, null, { timeout: 30000 });
    await page.waitForTimeout(350);
    const blurred = await pixels(page);
    const stats = await page.evaluate(() => {
      const a = window.MeetingLensStudio.getAnalysis(), mask = a.mask, c = document.createElement("canvas"); c.width = 640; c.height = 360;
      const ctx = c.getContext("2d");
      if (window.MeetingLensStudio.getState().mirror) { ctx.translate(640, 0); ctx.scale(-1, 1); }
      ctx.drawImage(mask, 0, 0, 640, 360); const d = ctx.getImageData(0, 0, 640, 360).data;
      let foreground = 0, background = 0; const alpha = [];
      for (let i = 3; i < d.length; i += 4) { alpha.push(d[i]); if (d[i] > 250) foreground++; if (d[i] < 5) background++; }
      return { foreground, background, alpha, backend: window.MeetingLensVision.capabilities.backend };
    });
    assert(stats.foreground > 1000 && stats.background > 1000, "Real matte separates the person from the room");
    const fgDiff = meanDifference(before, blurred, i => stats.alpha[i] > 250);
    const bgDiff = meanDifference(before, blurred, i => stats.alpha[i] < 5);
    assert(bgDiff > .3, `Blur visibly changes the background (${bgDiff.toFixed(3)})`);
    assert(bgDiff > fgDiff * 1.8, `Foreground stays sharper: background Δ${bgDiff.toFixed(3)} vs foreground Δ${fgDiff.toFixed(3)}`);
    assert(caps.backend.includes("WASM"), "CPU/WASM backend is reported truthfully");
    assert(page.__requests.every(url => url.startsWith(base) || url.startsWith("data:") || url.startsWith("blob:")), "AI uses only bundled same-origin resources");
    await close(context, page);
  });

  await check("Auto Framing uses a real face box and changes the preview crop", async () => {
    const { context, page } = await open();
    await loadVision(page);
    const before = await pixels(page);
    const initialDraw = await page.evaluate(() => window.__qaDraws.at(-1));
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => !!window.MeetingLensStudio.getAnalysis()?.face, null, { timeout: 30000 });
    await page.waitForTimeout(700);
    const face = await page.evaluate(() => window.MeetingLensStudio.getAnalysis().face);
    assert(face.x >= 0 && face.y >= 0 && face.width > .04 && face.height > .05 && face.width < .7 && face.height < .9, `Plausible real face: ${JSON.stringify(face)}`);
    const framed = await pixels(page), framedDraw = await page.evaluate(() => window.__qaDraws.at(-1));
    assert(framedDraw.args[2] < initialDraw.args[2] * .98, "Auto Framing performs a real crop");
    assert(meanDifference(before, framed) > 1, "Auto Framing changes actual rendered pixels");
    assert.match(await page.locator("#trackingStatus").textContent(), /face located/i);
    await close(context, page);
  });

  await check("Basic preview bypasses app filters, mirror, zoom and AI without claiming raw Windows access", async () => {
    const { context, page } = await open();
    await panel(page, "device"); await page.locator("#browserBasicSwitch").click();
    await page.waitForFunction(() => window.__qaDraws.at(-1)?.filter === "none" && window.__qaDraws.at(-1)?.matrix[0] === 1);
    const baseline = await pixels(page);
    await panel(page, "looks"); await range(page, "brightnessRange", 95); await range(page, "temperatureRange", 45);
    await page.locator('[data-look="mono"]').click();
    await panel(page, "frame"); await range(page, "zoomRange", 160); await page.locator("#mirrorSwitch").click();
    const adjusted = await pixels(page), draw = await page.evaluate(() => window.__qaDraws.at(-1));
    assert(meanDifference(baseline, adjusted) < .05, "App adjustments do not alter Basic preview");
    assert.equal(draw.filter, "none"); assert.equal(draw.matrix[0], 1, "Basic preview does not mirror");
    await panel(page, "device");
    assert.match(await page.locator("#device-panel").textContent(), /does not bypass Windows effects or camera drivers/i);
    await page.locator("#browserBasicSwitch").click();
    await page.waitForFunction(() => window.__qaDraws.at(-1)?.filter !== "none");
    assert(meanDifference(adjusted, await pixels(page)) > 3, "Leaving Basic preview restores stored effects");
    await close(context, page);
  });

  await check("Missing AI models leave camera and manual preview usable", async () => {
    const { context, page } = await open({ missingModels: true });
    await panel(page, "effects"); await page.locator("#enableVisionButton").click();
    await page.waitForFunction(() => /unavailable|could not|cannot run/i.test(document.querySelector("#visionStatus").textContent), null, { timeout: 100000 });
    assert(await page.locator("#autoFrameSwitch").isDisabled(), "Unavailable effects are disabled");
    const before = await pixels(page);
    await panel(page, "looks"); await range(page, "brightnessRange", 90);
    assert(meanDifference(before, await pixels(page)) > 2, "Manual preview still renders");
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#stopCameraButton").click();
    await close(context, page);
  });

  await check("Privacy Shield rejects pending inference results and ends all camera tracks", async () => {
    const { context, page } = await open();
    await loadVision(page);
    await page.evaluate(() => {
      const original = window.MeetingLensVision.analyze;
      window.MeetingLensVision.analyze = async (...args) => {
        const result = await original(...args);
        return new Promise(resolve => { window.__qaReleaseInference = () => resolve(result); });
      };
    });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => !!document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => typeof window.__qaReleaseInference === "function", null, { timeout: 30000 });
    await panel(page, "privacy"); await page.locator("#privacyButton").click();
    await page.evaluate(() => window.__qaReleaseInference());
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => ({ detached: !document.querySelector("#cameraVideo").srcObject,
      ended: window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended")),
      mask: !!window.MeetingLensVision.latest.mask, face: !!window.MeetingLensVision.latest.face,
      appAnalysis: window.MeetingLensStudio?.getAnalysis?.() ?? null,
      app: window.MeetingLensStudio?.getState?.() || null }));
    assert(result.detached && result.ended, "Shield detaches camera and stops every track");
    assert(!result.mask && !result.face, "Local captured frame metadata is cleared");
    assert.equal(result.appAnalysis, null, "Late inference does not re-enter app state");
    assert.equal(await page.locator("#captureButton").isDisabled(), true);
    await close(context, page);
  });

  await check("Changing sample effects during pending inference schedules the current configuration", async () => {
    const { context, page } = await open();
    await loadVision(page);
    await page.evaluate(() => {
      const original = window.MeetingLensVision.analyze; let first = true;
      window.MeetingLensVision.analyze = async (...args) => {
        const result = await original(...args);
        if (!first) return result;
        first = false;
        return new Promise(resolve => { window.__qaReleaseChangedInference = () => resolve(result); });
      };
    });
    await page.locator("#autoFrameSwitch").click();
    await page.waitForFunction(() => typeof window.__qaReleaseChangedInference === "function", null, { timeout: 30000 });
    await page.locator("#backgroundBlurSwitch").click();
    await page.evaluate(() => window.__qaReleaseChangedInference());
    await page.waitForFunction(() => !!window.MeetingLensStudio.getAnalysis()?.face && !!window.MeetingLensStudio.getAnalysis()?.mask, null, { timeout: 15000 });
    assert.equal(await page.locator("#autoFrameSwitch").getAttribute("aria-checked"), "true");
    assert.equal(await page.locator("#backgroundBlurSwitch").getAttribute("aria-checked"), "true");
    await close(context, page);
  });
}
run().catch(error => { reports.push({ name: "Advanced test harness", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  const output = path.join(root, ".qa"); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "advanced-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), physicalWindowsHardwareTested: false, reports }, null, 2));
  const failed = reports.filter(item => !item.pass).length;
  console.log(`${reports.length - failed}/${reports.length} advanced integration checks passed`); process.exitCode = failed ? 1 : 0;
});
