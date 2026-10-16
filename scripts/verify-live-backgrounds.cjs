#!/usr/bin/env node
/* Live-background regressions. A real canvas.captureStream() supplies a stable
 * fictional portrait over a distinctive green room to the app's camera path.
 * Normal tests run the actual bundled MediaPipe worker/models; only explicit
 * loading/inference fault tests delay real operations for repeatable races. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), reports = [], contexts = new Set();
let sceneMeasurements = [];
const scenes = ["room", "soft", "studio", "night", "dawn", "slate"];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
let server, browser, base;
async function check(name, fn) {
  if (process.env.LIVE_BACKGROUND_CHECK && !name.toLowerCase().includes(process.env.LIVE_BACKGROUND_CHECK.toLowerCase())) return;
  const started = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
  finally {
    for (const context of contexts) {
      context.__releaseModels?.(); context.__releaseScenes?.(); await context.close().catch(() => {}); contexts.delete(context);
    }
  }
}
async function open({ missingModels = false, delayModels = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", permissions: ["camera"], acceptDownloads: true });
  contexts.add(context);
  let releaseModels;
  const modelGate = new Promise(resolve => { releaseModels = resolve; });
  context.__releaseModels = releaseModels;
  if (missingModels || delayModels) await context.route(/\/assets\/models\//, async route => {
    if (missingModels) return route.fulfill({ status: 503, body: "Unavailable in deliberate model-failure regression" });
    await modelGate; return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem("meetinglens-settings", JSON.stringify({ look: "natural", brightness: 50, contrast: 50, saturation: 50,
      enhancement: 100, softness: false, temperature: 0, vignette: 0, scene: "room", sceneStrength: 0,
      zoom: 100, mirror: false, split: false, autoFrame: false, backgroundReplace: false, backgroundBlur: false,
      portraitLight: false, refinement: false, teeth: false, browserBasic: false, autoPause: false, requestedFps: 15 }));
    window.__liveQA = { calls: [], streams: [], errors: [], background: "#08a84c" };
    const camera = document.createElement("canvas"); camera.width = 640; camera.height = 360;
    const ctx = camera.getContext("2d", { alpha: false });
    const portrait = new Image();
    const ready = new Promise((resolve, reject) => { portrait.onload = resolve; portrait.onerror = () => reject(new Error("Camera test portrait failed to load")); });
    portrait.src = "/assets/demo/professional-portrait.webp";
    let painting = false;
    function paint() {
      ctx.fillStyle = window.__liveQA.background; ctx.fillRect(0, 0, 640, 360);
      const height = 360 * .985, width = portrait.naturalWidth * height / portrait.naturalHeight;
      ctx.drawImage(portrait, (640 - width) / 2, 360 - height, width, height);
      requestAnimationFrame(paint);
    }
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__liveQA.calls.push(JSON.parse(JSON.stringify(constraints)));
      if (!constraints.video) return original(constraints);
      await ready;
      if (!painting) { painting = true; paint(); }
      const stream = camera.captureStream(30);
      for (const track of stream.getVideoTracks()) Object.defineProperty(track, "label", { value: "Controlled camera demo · generated portrait" });
      window.__liveQA.streams.push(stream); window.__liveQA.source = camera;
      return stream;
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.__errors = []; page.__requests = [];
  page.on("pageerror", error => page.__errors.push(error.message));
  page.on("request", request => page.__requests.push(request.url()));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.MeetingLensStudio && document.querySelector("#previewCanvas")?.width > 0);
  return { page, context, releaseModels };
}
async function close(context, page) {
  assert.deepEqual(page.__errors, [], "No uncaught page errors");
  context.__releaseModels?.();
  context.__releaseScenes?.();
  await context.close(); contexts.delete(context);
}
async function panel(page, name) { await page.locator(`[data-panel="${name}"]`).click(); }
async function scene(page, value) {
  await panel(page, "background");
  await page.locator(`#background-panel .scene-button[data-scene="${value}"]`).click();
}
async function start(page) {
  await page.locator("#startCameraButton").click();
  await page.waitForFunction(() => window.MeetingLensStudio.getState().phase === "live" && document.querySelector("#cameraVideo").readyState >= 2);
  await page.waitForTimeout(200);
}
async function waitMask(page) {
  await page.waitForFunction(() => {
    const a = window.MeetingLensStudio.getAnalysis();
    return window.MeetingLensStudio.getState().visionReady && !!a?.mask && performance.now() - a.timestamp < 1500;
  }, null, { timeout: 100000 });
  await page.waitForTimeout(200);
}
async function settleFrame(page) {
  // Settings commit synchronously; canvas output is deliberately rendered on
  // the next animation frame. Wait on that contract, not a wall-clock guess.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function pixels(page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360;
    const x = c.getContext("2d"); x.drawImage(document.querySelector("#previewCanvas"), 0, 0, 640, 360);
    return [...x.getImageData(0, 0, 640, 360).data];
  });
}
async function alpha(page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360;
    const x = c.getContext("2d"); x.drawImage(window.MeetingLensStudio.getAnalysis().mask, 0, 0, 640, 360);
    const data = x.getImageData(0, 0, 640, 360).data, out = [];
    for (let i = 3; i < data.length; i += 4) out.push(data[i]);
    return out;
  });
}
function difference(a, b, predicate = () => true) {
  assert.equal(a.length, b.length); let sum = 0, count = 0;
  for (let i = 0; i < a.length; i += 4) if (predicate(i / 4)) for (let k = 0; k < 3; k++) { sum += Math.abs(a[i + k] - b[i + k]); count++; }
  assert(count > 0, "Pixel comparison has a nonempty region"); return sum / count;
}
async function rawRoom(page) {
  await panel(page, "background"); await page.locator("#useRealBackgroundButton").click();
  await page.waitForFunction(() => !window.MeetingLensStudio.getState().backgroundReplace && !window.MeetingLensStudio.getState().backgroundBlur);
  await page.waitForTimeout(120); return pixels(page);
}
async function run() {
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Choosing a background arms replacement without camera permission; Start loads real local models automatically", async () => {
    const { page, context } = await open();
    await scene(page, "studio");
    const state = await page.evaluate(() => window.MeetingLensStudio.getState());
    assert.equal(state.backgroundReplace, true); assert.equal(state.scene, "studio"); assert.equal(state.phase, "demo");
    assert.equal(await page.evaluate(() => window.__liveQA.calls.length), 0, "Choosing a scene never opens the camera");
    assert(await page.locator("#replaceBackgroundSwitch").isEnabled(), "Replacement switch remains an available user action");
    assert(await page.locator("#liveBackgroundStatus").isVisible(), "Live background status is visible");
    await start(page); await waitMask(page);
    assert(await page.evaluate(() => window.MeetingLensVision.lastBackgroundApplied), "Starting the camera automatically enables real model-based replacement");
    // A neutral room is appropriate for the shareable proof image. The six-
    // scene pixel test below deliberately keeps its vivid green discriminator.
    const changed = await page.evaluate(() => { window.__liveQA.background = "#72777b"; return performance.now(); });
    await page.waitForFunction(timestamp => window.MeetingLensStudio.getAnalysis()?.timestamp > timestamp + 150, changed);
    await settleFrame(page);
    await page.waitForFunction(() => !document.querySelector("#toast")?.classList.contains("show"));
    await page.evaluate(() => {
      const label = document.createElement("span"); label.id = "qaCameraDisclosure"; label.textContent = "AI-generated camera demo";
      label.style.cssText = "position:absolute;left:16px;bottom:48px;z-index:12;padding:6px 10px;border-radius:7px;background:rgba(16,24,37,.82);color:white;font:500 12px system-ui;pointer-events:none";
      document.querySelector("#previewWrap").append(label);
    });
    fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".qa/live-background-proof.png") });
    await page.locator("#qaCameraDisclosure").evaluate(el => el.remove());
    assert(page.__requests.every(url => url.startsWith(base) || url.startsWith("data:") || url.startsWith("blob:")), "All model and scene requests remain same-origin");
    await close(context, page);
  });

  await check("All six scenes replace an actual MediaStream room while preserving measured foreground pixels", async () => {
    const { page, context } = await open(); await start(page);
    const raw = await pixels(page), scenePixels = [];
    for (const value of scenes) {
      await scene(page, value); await waitMask(page);
      await page.waitForFunction(() => /ready/i.test(document.querySelector("#backgroundLoadStatus").textContent));
      await page.waitForTimeout(150);
      const frame = await pixels(page), mask = await alpha(page);
      assert(mask.filter(v => v > 250).length > 1500, "Real local mask finds the person");
      assert(mask.filter(v => v < 5).length > 1500, "Real local mask finds the surrounding room");
      const foreground = difference(raw, frame, i => mask[i] > 250), background = difference(raw, frame, i => mask[i] < 5);
      assert(background > 20, `${value}: selected room visibly replaces green camera pixels (MAE ${background.toFixed(2)})`);
      assert(foreground < 3, `${value}: opaque person pixels stay intact (MAE ${foreground.toFixed(2)})`);
      for (const previous of scenePixels) assert(difference(previous.frame, frame, i => mask[i] < 5) > 2, `${value} differs visibly from ${previous.value}`);
      scenePixels.push({ value, frame, foregroundMAE: foreground, backgroundMAE: background });
    }
    fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".qa/live-background-stream.png") });
    const downloadReady = page.waitForEvent("download"); await page.locator("#captureButton").click();
    const download = await downloadReady, filename = path.join(root, ".qa/live-background-snapshot.png"); await download.saveAs(filename);
    const saved = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const c = document.createElement("canvas"); c.width = 640; c.height = 360; const x = c.getContext("2d");
      x.drawImage(image, 0, 0, 640, 360); return [...x.getImageData(0, 0, 640, 360).data];
    }, fs.readFileSync(filename).toString("base64"));
    assert(difference(saved, scenePixels.at(-1).frame) < .1, "The exported PNG includes the actual live composition, without UI overlays");
    sceneMeasurements = scenePixels.map(({ frame, ...entry }) => entry);
    await close(context, page);
  });

  await check("Use real background restores camera pixels and turns both replacement and blur off", async () => {
    const { page, context } = await open(); await start(page);
    const before = await pixels(page); await scene(page, "night"); await waitMask(page);
    assert(difference(before, await pixels(page)) > 5);
    await panel(page, "effects");
    const blur = page.locator("#backgroundBlurSwitch"); if (await blur.getAttribute("aria-checked") !== "true") await blur.click();
    const restored = await rawRoom(page);
    assert(difference(before, restored) < .1, "Restoring the actual room restores original neutral camera pixels");
    assert.equal(await page.locator("#replaceBackgroundSwitch").getAttribute("aria-checked"), "false");
    await close(context, page);
  });

  await check("Delayed local model loading keeps the live room usable and applies only the latest selected scene", async () => {
    const { page, context, releaseModels } = await open({ delayModels: true }); await start(page);
    const raw = await pixels(page);
    await scene(page, "room"); await scene(page, "night"); await scene(page, "slate");
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().backgroundReplace), true);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().visionReady), false);
    assert(difference(raw, await pixels(page)) < .1, "Pending loading never paints a fake sample over the real camera");
    releaseModels(); await waitMask(page);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().scene), "slate");
    assert(difference(raw, await pixels(page)) > 5, "Latest selection becomes active when the real person model is ready");
    await close(context, page);
  });

  await check("Missing local models preserve the real camera and expose a retryable background failure", async () => {
    const { page, context } = await open({ missingModels: true }); await start(page);
    const raw = await pixels(page); await scene(page, "dawn");
    await page.waitForFunction(() => /unavailable|could not|cannot run|failed/i.test(document.querySelector("#visionStatus").textContent), null, { timeout: 100000 });
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().phase), "live");
    assert(difference(raw, await pixels(page)) < .1, "Failed segmentation leaves live room pixels intact");
    assert(await page.locator("#replaceBackgroundSwitch").isEnabled(), "User can cancel replacement despite failed models");
    await panel(page, "effects"); assert(await page.locator("#enableVisionButton").isEnabled(), "Failed models offer an explicit retry");
    await close(context, page);
  });

  await check("Late scene image responses cannot overwrite the latest live background selection", async () => {
    const { page, context } = await open(); await start(page); await scene(page, "room"); await waitMask(page);
    const images = await page.evaluate(() => ["#eb1828", "#1844eb", "#f0f0f0"].map(color => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 36;
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 64, 36); return c.toDataURL("image/png").split(",")[1];
    }));
    let release; const gate = new Promise(resolve => { release = resolve; }); context.__releaseScenes = release;
    await context.route(/\/assets\/demo\/backgrounds\/(?:scandinavian-office|city-lounge|minimal-gallery)\.webp/, async route => {
      const file = new URL(route.request().url()).pathname;
      const index = file.includes("scandinavian") ? 0 : file.includes("city-lounge") ? 1 : 2;
      if (index < 2) await gate;
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(images[index], "base64") });
    });
    await scene(page, "soft"); await scene(page, "night"); await scene(page, "slate"); await waitMask(page);
    await page.waitForFunction(() => {
      const c = document.querySelector("#previewCanvas"), d = c.getContext("2d").getImageData(10, 10, 1, 1).data;
      return d[0] > 225 && d[1] > 225 && d[2] > 225;
    });
    release(); await page.waitForTimeout(400);
    const frame = await pixels(page), i = (10 * 640 + 10) * 4;
    assert(frame[i] > 225 && frame[i + 1] > 225 && frame[i + 2] > 225, "Late red/blue image responses cannot replace the chosen light room");
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().scene), "slate");
    await close(context, page);
  });

  await check("Basic preview and Hold original bypass the live background compositor", async () => {
    const { page, context } = await open(); await start(page);
    const raw = await pixels(page); await scene(page, "soft"); await waitMask(page);
    assert(difference(raw, await pixels(page)) > 5);
    await page.keyboard.down("c");
    await page.waitForTimeout(120); assert(difference(raw, await pixels(page)) < .1, "Holding original reveals the actual camera room");
    await page.keyboard.up("c");
    await page.waitForTimeout(150); assert(difference(raw, await pixels(page)) > 5, "Releasing original restores replacement");
    await panel(page, "device"); await page.locator("#browserBasicSwitch").click();
    await settleFrame(page);
    const basicDelta = difference(raw, await pixels(page)); assert(basicDelta < .1, `Basic preview reveals the raw app input (MAE ${basicDelta.toFixed(3)})`);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().backgroundReplace), true, "Basic mode retains the saved preference");
    await page.locator("#browserBasicSwitch").click(); await waitMask(page);
    assert(difference(raw, await pixels(page)) > 5, "Exiting Basic restores replacement");
    await close(context, page);
  });

  await check("Stalled live inference drops expired segmentation instead of freezing an old cutout", async () => {
    const { page, context } = await open(); await start(page);
    const raw = await pixels(page); await scene(page, "studio"); await waitMask(page);
    await page.evaluate(() => {
      window.MeetingLensVision.analyze = () => new Promise(resolve => { window.__releaseStalled = () => resolve({ timestamp: performance.now(), mask: null, face: null }); });
    });
    await page.waitForFunction(() => !!window.__releaseStalled && window.MeetingLensStudio.getState().visionPending);
    await page.waitForTimeout(1900);
    assert(difference(raw, await pixels(page)) < .1, "Expired person mask falls back to a complete current camera frame");
    await page.locator("#stopCameraButton").click(); await page.evaluate(() => window.__releaseStalled());
    await close(context, page);
  });

  await check("Privacy Shield rejects pending masks, stops real tracks and safely restores replacement after restart", async () => {
    const { page, context } = await open(); await start(page); await scene(page, "dawn"); await waitMask(page);
    await page.evaluate(() => {
      const actual = window.MeetingLensVision.analyze;
      window.__restoreAnalysis = () => { window.MeetingLensVision.analyze = actual; };
      window.MeetingLensVision.analyze = async (...args) => {
        const result = await actual(...args);
        return new Promise(resolve => { window.__releasePrivate = () => resolve(result); });
      };
    });
    await page.waitForFunction(() => !!window.__releasePrivate && window.MeetingLensStudio.getState().visionPending);
    await page.locator("#shieldQuickButton").click();
    assert(await page.evaluate(() => window.__liveQA.streams.every(s => s.getTracks().every(t => t.readyState === "ended"))), "Shield ends each actual canvas media track");
    assert.equal(await page.evaluate(() => document.querySelector("#cameraVideo").srcObject), null);
    await page.evaluate(() => window.__releasePrivate()); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getAnalysis()), null, "Late mask never re-enters private app state");
    assert(await page.locator("#captureButton").isDisabled());
    const shieldPixels = await pixels(page); assert.equal(new Set(shieldPixels.filter((_, i) => i % 4 === 0)).size, 1, "Shield displays a cleared, uniform canvas");
    await page.evaluate(() => window.__restoreAnalysis()); await page.locator("#shieldQuickButton").click(); await start(page); await waitMask(page);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().backgroundReplace), true);
    assert(await page.evaluate(() => window.__liveQA.streams.length >= 2 && window.__liveQA.streams.at(-1).getVideoTracks()[0].readyState === "live"));
    await page.locator("#stopCameraButton").click();
    assert(await page.evaluate(() => window.__liveQA.streams.every(s => s.getTracks().every(t => t.readyState === "ended"))), "Normal stop ends restarted camera tracks too");
    await close(context, page);
  });
}
run().catch(error => { reports.push({ name: "Live-background test harness", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  for (const context of contexts) { context.__releaseModels?.(); context.__releaseScenes?.(); await context.close().catch(() => {}); }
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  const output = path.join(root, ".qa"); fs.mkdirSync(output, { recursive: true });
  const reportName = process.env.LIVE_BACKGROUND_CHECK ? "live-background-verification-filtered.json" : "live-background-verification.json";
  fs.writeFileSync(path.join(output, reportName), JSON.stringify({ checkedAt: new Date().toISOString(), realBundledModelInference: true,
    cameraInput: "Actual browser MediaStream from canvas.captureStream, not a physical webcam", physicalWindowsHardwareTested: false, reports, sceneMeasurements }, null, 2));
  const failed = reports.filter(item => !item.pass).length;
  console.log(`${reports.length - failed}/${reports.length} live-background regression checks passed`); process.exitCode = failed ? 1 : 0;
});
