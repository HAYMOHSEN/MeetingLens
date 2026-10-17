#!/usr/bin/env node
/* A moving rectangle in a real canvas MediaStream makes delayed mask/frame
 * errors measurable. Model responses are controlled; the real compositor,
 * preview, comparison and PNG capture paths are exercised. No user photos. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), reports = [], contexts = new Set();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
let server, browser, base;
async function check(name, fn) {
  if (process.env.FRAME_PAIRING_CHECK && !name.toLowerCase().includes(process.env.FRAME_PAIRING_CHECK.toLowerCase())) return;
  const started = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
  finally { for (const context of contexts) { await context.close().catch(() => {}); contexts.delete(context); } }
}
async function open({ realBridge = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", permissions: ["camera"], acceptDownloads: true });
  contexts.add(context);
  await context.addInitScript(({ realBridge }) => {
    localStorage.setItem("meetinglens-settings", JSON.stringify({ look: "natural", brightness: 50, contrast: 50, saturation: 50,
      enhancement: 100, softness: false, temperature: 0, vignette: 0, scene: "room", sceneStrength: 0,
      zoom: 100, mirror: false, split: false, autoFrame: false, backgroundReplace: false, backgroundBlur: false,
      portraitLight: false, refinement: false, teeth: false, browserBasic: false, autoPause: false, requestedFps: 30 }));
    const source = document.createElement("canvas"); source.width = 640; source.height = 360;
    const ctx = source.getContext("2d", { alpha: false });
    window.__pairQA = { source, x: 70, width: 100, calls: [], streams: [], saved: null };
    function paint() {
      ctx.fillStyle = "#162a3d"; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "#e44b44"; ctx.fillRect(window.__pairQA.x, 80, window.__pairQA.width, 240);
      requestAnimationFrame(paint);
    }
    paint();
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = source.captureStream(30); window.__pairQA.streams.push(stream); return stream;
    };
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    window.__pairQA.setHidden = value => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
    // Exercise the actual vision bridge separately from the direct API double.
    // Only worker inference is replaced; capture, mask conversion, result age,
    // paired rendering, comparison and export remain production code.
    if (realBridge) window.Worker = class {
      constructor() { this.closed = false; }
      postMessage(message) {
        if (message.type === "init") {
          queueMicrotask(() => this.onmessage?.({ data: { id: message.id, capabilities: {
            face: true, segmentation: true, backend: "controlled CPU worker", eyeContact: false,
            segmentationDelegate: "CPU", analysisIntervalMs: 125 } } }));
          return;
        }
        if (message.type !== "analyze") return;
        const input = document.createElement("canvas"); input.width = message.bitmap.width; input.height = message.bitmap.height;
        const ctx = input.getContext("2d"); ctx.drawImage(message.bitmap, 0, 0); message.bitmap.close();
        const row = ctx.getImageData(0, Math.round(input.height / 2), input.width, 1).data;
        let left = input.width, right = 0;
        for (let x = 0; x < input.width; x++) if (row[x * 4] > 150 && row[x * 4 + 1] < 130) { left = Math.min(left, x); right = x + 1; }
        const mask = document.createElement("canvas"); mask.width = input.width; mask.height = input.height;
        mask.getContext("2d").fillRect(left, Math.round(80 * input.height / 360), right - left, Math.round(240 * input.height / 360));
        const result = { timestamp: message.timestamp, face: null, faceLandmarks: null,
          mask: { width: mask.width, height: mask.height, pixels: mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data } };
        window.__pairQA.calls.push({ timestamp: message.timestamp, left: left / input.width * 640, right: right / input.width * 640,
          inputWasVideo: false, release: (mode = "success") => {
            if (this.closed) return;
            if (mode === "error") return this.onmessage?.({ data: { id: message.id, error: "Deliberate worker inference error" } });
            if (mode === "cache") return this.onmessage?.({ data: { id: message.id, result: window.__pairQA.saved } });
            result.inferenceMs = performance.now() - message.timestamp;
            window.__pairQA.saved = result;
            this.onmessage?.({ data: { id: message.id, result } });
          } });
      }
      terminate() { this.closed = true; }
    };
  }, { realBridge });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.__errors = [];
  page.on("pageerror", error => page.__errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.MeetingLensStudio?.getFramePair);
  if (!realBridge) await page.evaluate(() => {
    window.MeetingLensVision.init = async () => ({ face: true, segmentation: true, backend: "controlled protocol", eyeContact: false });
    window.MeetingLensVision.analyze = (source, timestamp) => {
      const frozen = document.createElement("canvas"); frozen.width = source.videoWidth || source.width; frozen.height = source.videoHeight || source.height;
      const ctx = frozen.getContext("2d"); ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, Math.round(frozen.height / 2), frozen.width, 1).data;
      let left = frozen.width, right = 0;
      for (let x = 0; x < frozen.width; x++) if (pixels[x * 4] > 150 && pixels[x * 4 + 1] < 130) { left = Math.min(left, x); right = x + 1; }
      const mask = document.createElement("canvas"); mask.width = frozen.width; mask.height = frozen.height;
      mask.getContext("2d").fillRect(left, Math.round(80 * frozen.height / 360), right - left, Math.round(240 * frozen.height / 360));
      const result = { timestamp, face: null, faceLandmarks: null, mask };
      return new Promise((resolve, reject) => {
        window.__pairQA.calls.push({ timestamp, left: left / frozen.width * 640, right: right / frozen.width * 640,
          inputWasVideo: source instanceof HTMLVideoElement,
          release(mode = "success") {
            if (mode === "error") return reject(new Error("Deliberate frame inference error"));
            if (mode === "cache") return resolve(window.__pairQA.saved);
            window.__pairQA.saved = result; resolve(result);
          } });
      });
    };
  });
  await page.locator("#startCameraButton").click();
  await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live" && document.querySelector("#cameraVideo").readyState >= 2);
  return { page, context };
}
async function panel(page, name) { await page.locator(`[data-panel="${name}"]`).click(); }
async function arm(page) {
  await panel(page, "background"); await page.locator('#background-panel .scene-button[data-scene="studio"]').click();
  await page.waitForFunction(() => window.__pairQA.calls.length > 0);
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function pose(page, x, width = 100) {
  await page.evaluate(({ x, width }) => { window.__pairQA.x = x; window.__pairQA.width = width; }, { x, width });
  await page.waitForFunction(x => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360; const ctx = c.getContext("2d");
    ctx.drawImage(document.querySelector("#cameraVideo"), 0, 0, 640, 360);
    const pixel = ctx.getImageData(x + 10, 170, 1, 1).data; return pixel[0] > 150 && pixel[1] < 130;
  }, x); await settle(page);
}
async function release(page, index, mode = "success") {
  const timestamp = await page.evaluate(({ index, mode }) => { const c = window.__pairQA.calls[index]; c.release(mode); return c.timestamp; }, { index, mode });
  await settle(page); return timestamp;
}
async function waitNext(page, index) { await page.waitForFunction(i => window.__pairQA.calls.length > i, index); }
async function pair(page) { return page.evaluate(() => window.MeetingLensStudio.getFramePair()); }
async function preview(page) {
  return page.evaluate(() => {
    // A small thumbnail measures the 100px rectangle precisely without a
    // multi-megabyte CDP transfer consuming the pair's freshness interval.
    const c = document.createElement("canvas"); c.width = 160; c.height = 90; const ctx = c.getContext("2d");
    ctx.drawImage(document.querySelector("#previewCanvas"), 0, 0, 160, 90); return [...ctx.getImageData(0, 0, 160, 90).data];
  });
}
function redAt(pixels, x, y = 170) { const p = (Math.floor(y / 4) * 160 + Math.floor(x / 4)) * 4; return pixels[p] > 150 && pixels[p + 1] < 130 && pixels[p + 2] < 130; }
function difference(a, b) { assert.equal(a.length, b.length); let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; }
async function close(context, page) { assert.deepEqual(page.__errors, [], "No uncaught browser errors"); await context.close(); contexts.delete(context); }
async function readyPair(page) { await arm(page); const timestamp = await release(page, 0); await page.waitForFunction(t => window.MeetingLensStudio.getFramePair()?.timestamp === t, timestamp); return timestamp; }
async function run() {
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Delayed person masks cut out their own captured pose while the actual camera has moved", async () => {
    const { page, context } = await open(); await arm(page);
    assert.equal(await pair(page), null, "No completed mask means no pretend frame pair");
    await pose(page, 430); const timestamp = await release(page, 0);
    await page.waitForFunction(t => window.MeetingLensStudio.getFramePair()?.timestamp === t, timestamp);
    const meta = await pair(page), pixels = await preview(page);
    assert(redAt(pixels, 120), "Completed older pose remains opaque at its original position");
    assert(!redAt(pixels, 480), "A newer camera pose is never cut out with the older mask");
    assert.deepEqual(Object.keys(meta).sort(), ["height", "timestamp", "width"]);
    assert.equal(meta.width, 640); assert.equal(meta.height, 360);
    assert.equal(await page.evaluate(() => window.__pairQA.calls[0].inputWasVideo), false, "The inference input is a frozen frame");
    await close(context, page);
  });

  await check("Slow successful worker results apply their matching frame and expire from completion rather than capture time", async () => {
    const { page, context } = await open({ realBridge: true }); await arm(page);
    await pose(page, 430);
    await page.waitForFunction(() => performance.now() - window.__pairQA.calls[0].timestamp > 1800);
    const firstTimestamp = await release(page, 0);
    await page.waitForFunction(t => window.MeetingLensStudio.getFramePair()?.timestamp === t, firstTimestamp);
    const first = await page.evaluate(() => ({
      age: performance.now() - window.MeetingLensStudio.getAnalysis().timestamp,
      completedAt: window.MeetingLensStudio.getAnalysis().completedAt,
      bridgeHasMask: Boolean(window.MeetingLensVision.latest.mask),
      completedAge: performance.now() - window.MeetingLensStudio.getAnalysis().completedAt
    }));
    assert(first.age > 1800, "A successful inference older than the old capture-age cutoff is deliberately tested");
    assert(first.bridgeHasMask, "The real vision bridge keeps a newly completed slow mask");
    assert(Number.isFinite(first.completedAt) && first.completedAge < 500, "Completion freshness is recorded after inference finishes");
    let pixels = await preview(page);
    assert(redAt(pixels, 120) && !redAt(pixels, 480), "The late mask uses its own older pose, without erasing the current pose");
    await waitNext(page, 1);
    await page.waitForFunction(t => performance.now() - t > 1700, first.completedAt);
    assert.equal((await pair(page))?.timestamp, firstTimestamp, "A healthy slow result remains visible while the next comparable inference is pending");
    await page.waitForFunction(t => performance.now() - t > 5200, first.completedAt);
    await settle(page);
    assert.equal(await pair(page), null, "A subsequent stalled worker expires the displayed completed pair");
    assert.equal(await page.evaluate(() => Boolean(window.MeetingLensVision.latest.mask)), false, "The real bridge also expires an idle completed mask");
    pixels = await preview(page); assert(redAt(pixels, 480) && !redAt(pixels, 120), "A genuine stall returns to the current camera pixels");
    const secondTimestamp = await release(page, 1);
    await page.waitForFunction(t => window.MeetingLensStudio.getFramePair()?.timestamp === t, secondTimestamp);
    pixels = await preview(page); assert(redAt(pixels, 480) && !redAt(pixels, 120), "The next slow success recovers a new matching pair");
    assert.match(await page.locator("#fpsLabel").innerText(), /fps · effects$/, "Slow successful effects report their measured rate after another completed result");
    const completedAt = await page.evaluate(() => window.MeetingLensStudio.getAnalysis().completedAt);
    await waitNext(page, 2); await release(page, 2, "cache");
    assert.equal((await pair(page)).timestamp, secondTimestamp, "A cached old result cannot attach to a newer requested frame");
    assert.equal(await page.evaluate(() => window.MeetingLensVision.latest.completedAt), completedAt, "A cached response cannot renew the old mask's completion time");
    await close(context, page);
  });

  await check("Cached or failed inference cannot attach an old mask to a new pose; the next success recovers", async () => {
    const { page, context } = await open(); const firstTimestamp = await readyPair(page);
    await pose(page, 430); await waitNext(page, 1); await release(page, 1, "cache");
    assert.equal((await pair(page)).timestamp, firstTimestamp); assert(redAt(await preview(page), 120));
    await waitNext(page, 2); await release(page, 2, "error");
    assert.equal((await pair(page)).timestamp, firstTimestamp);
    await waitNext(page, 3); const timestamp = await release(page, 3);
    await page.waitForFunction(t => window.MeetingLensStudio.getFramePair()?.timestamp === t, timestamp);
    const pixels = await preview(page); assert(redAt(pixels, 480)); assert(!redAt(pixels, 120));
    await close(context, page);
  });

  await check("Hold original and Basic preview show the current camera without waiting for a person mask", async () => {
    const { page, context } = await open(); await readyPair(page); await pose(page, 430);
    await page.keyboard.down("c"); await settle(page);
    const original = await preview(page); assert(redAt(original, 480)); assert(!redAt(original, 120));
    await page.keyboard.up("c"); await settle(page); assert(redAt(await preview(page), 120));
    await panel(page, "device"); await page.locator("#browserBasicSwitch").click(); await settle(page);
    assert.equal(await pair(page), null); assert(redAt(await preview(page), 480));
    await pose(page, 270); assert(redAt(await preview(page), 320), "Basic follows subsequent camera movement while inference remains pending");
    await close(context, page);
  });

  await check("Split comparison and downloaded PNG use the same captured pose as the completed mask", async () => {
    const { page, context } = await open(); await pose(page, 100, 440); await readyPair(page); await pose(page, 550, 80);
    await panel(page, "studio"); await page.locator("#splitSwitch").click(); await settle(page);
    const ready = page.waitForEvent("download");
    // Read and request capture in the same browser task. CDP thumbnail delivery
    // must not consume the intended stale-frame cutoff before the click.
    const captured = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 160; c.height = 90; const ctx = c.getContext("2d");
      ctx.drawImage(document.querySelector("#previewCanvas"), 0, 0, 160, 90);
      const before = [...ctx.getImageData(0, 0, 160, 90).data], beforePair = window.MeetingLensStudio.getFramePair();
      document.querySelector("#captureButton").click();
      // Retain the exact full-resolution output in this browser, avoiding
      // differences between thumbnail downsampling of HTMLImage and canvas.
      const output = document.querySelector("#previewCanvas");
      window.__pairQA.capturePixels = output.getContext("2d").getImageData(0, 0, output.width, output.height);
      return { before, beforePair, afterPair: window.MeetingLensStudio.getFramePair() };
    });
    assert(redAt(captured.before, 150), "Original half comes from the matched raw pose");
    assert(redAt(captured.before, 450), "Enhanced half comes from that same matched pose");
    assert.deepEqual(captured.beforePair, captured.afterPair, "Capture retains the same completed camera/mask pair");
    const download = await ready;
    const filename = path.join(root, ".qa/frame-pairing-snapshot.png"); fs.mkdirSync(path.dirname(filename), { recursive: true }); await download.saveAs(filename);
    const saved = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const c = document.createElement("canvas"); c.width = image.naturalWidth; c.height = image.naturalHeight; const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      const expected = window.__pairQA.capturePixels, dimensionsMatch = expected.width === c.width && expected.height === c.height;
      let difference = 0; for (let i = 0; i < pixels.length; i++) difference += Math.abs(pixels[i] - expected.data[i]);
      const red = x => { const p = (Math.floor(c.height * 170 / 360) * c.width + Math.floor(c.width * x / 640)) * 4; return pixels[p] > 150 && pixels[p + 1] < 130 && pixels[p + 2] < 130; };
      return { dimensionsMatch, difference: difference / pixels.length, left: red(150), right: red(450) };
    }, fs.readFileSync(filename).toString("base64"));
    assert(saved.left && saved.right, "Both halves of the PNG preserve the paired pose");
    assert(saved.dimensionsMatch);
    assert(saved.difference < .1, `PNG contains the actual paired comparison without newer unmasked camera pixels (MAE ${saved.difference.toFixed(3)})`);
    await close(context, page);
  });

  await check("Shield, stop, camera mute and a hidden tab clear retained pairs and reject late inference", async () => {
    for (const action of ["shield", "stop", "mute", "hidden"]) {
      const { page, context } = await open(); await readyPair(page); await waitNext(page, 1);
      await page.evaluate(action => {
        if (action === "shield") document.querySelector("#shieldQuickButton").click();
        else if (action === "stop") window.MeetingLensStudio.stop();
        else if (action === "mute") window.__pairQA.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event("mute"));
        else window.__pairQA.setHidden(true);
      }, action);
      assert.equal(await pair(page), null, `${action}: retained camera frame is cleared immediately`);
      await release(page, 1); assert.equal(await pair(page), null, `${action}: late response cannot recreate the pair`);
      assert.equal(await page.evaluate(() => window.MeetingLensStudio.getAnalysis()), null, `${action}: discarded analysis stays cleared`);
      if (action === "shield" || action === "stop") {
        const stopped = await page.evaluate(() => {
          return window.__pairQA.streams.every(s => s.getTracks().every(t => t.readyState === "ended"));
        });
        assert(stopped);
      }
      await close(context, page);
    }
  });
}
run().catch(error => { reports.push({ name: "runner", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await new Promise(resolve => server?.close(resolve) || resolve());
  const reportPath = process.env.FRAME_PAIRING_REPORT || path.join(root, ".qa/frame-pairing-verification.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: "Moving synthetic rectangle in real canvas MediaStream; controlled inference timing", checks: reports }, null, 2));
  const failed = reports.filter(item => !item.pass); console.log(`${reports.length - failed.length}/${reports.length} frame pairing checks passed`); process.exitCode = failed.length ? 1 : 0;
});
