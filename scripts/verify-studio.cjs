#!/usr/bin/env node
/* Browser regression checks for meaningful studio behavior.
 * Run: node scripts/verify-studio.cjs
 * Uses an isolated temporary HTTP server and Chromium's fake camera only.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const reports = [];
const errors = new Map();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
let browser, server, base;

async function open(options = {}, initializer) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", acceptDownloads: true, ...options });
  if (initializer) await context.addInitScript(initializer.fn || initializer, initializer.arg);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(10000);
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page).push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const c = document.querySelector("#previewCanvas");
    if (!c || !c.width || !c.height) return false;
    const d = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return d[0] + d[1] + d[2] > 10;
  });
  return { context, page };
}

async function cleanClose(context, page) {
  assert.deepEqual(errors.get(page), [], "No uncaught browser errors");
  await context.close();
}

async function panel(page, name) {
  await page.locator(`[data-panel="${name}"]`).click();
  await page.locator(`#${name}-panel`).waitFor({ state: "visible" });
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(100);
}

async function pixels(page) {
  return page.locator("#previewCanvas").evaluate(canvas => {
    const reduced = document.createElement("canvas");
    reduced.width = 96; reduced.height = 54;
    const c = reduced.getContext("2d");
    c.drawImage(canvas, 0, 0, 96, 54);
    const data = [...c.getImageData(0, 0, 96, 54).data];
    const rgb = data.filter((_, i) => i % 4 !== 3);
    const mean = rgb.reduce((sum, v) => sum + v, 0) / rgb.length;
    const variance = rgb.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rgb.length;
    return { data, mean, variance };
  });
}

function difference(a, b) {
  assert.equal(a.data.length, b.data.length);
  return a.data.reduce((sum, v, i) => sum + Math.abs(v - b.data[i]), 0) / a.data.length;
}

function sideDifference(a, b, side) {
  let sum = 0, count = 0;
  for (let y = 0; y < 54; y++) for (let x = side === "left" ? 0 : 48; x < (side === "left" ? 48 : 96); x++) {
    for (let c = 0; c < 3; c++) { const i = (y * 96 + x) * 4 + c; sum += Math.abs(a.data[i] - b.data[i]); count++; }
  }
  return sum / count;
}

async function check(name, fn) {
  const start = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}

async function run() {
  server = http.createServer((req, res) => {
    let location;
    try { location = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch { res.writeHead(400).end(); return; }
    const file = path.resolve(root, `.${location === "/" ? "/index.html" : location}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("Professional demo loads and every desktop panel is reachable", async () => {
    const { context, page } = await open();
    await page.waitForFunction(() => [...document.images].some(img => img.complete && img.naturalWidth >= 1000 && /professional-portrait/.test(img.src)) || performance.getEntriesByType("resource").some(r => /professional-portrait/.test(r.name) && r.responseEnd > 0));
    const p = await pixels(page);
    assert(p.variance > 500, `Portrait has meaningful detail (${p.variance.toFixed(1)})`);
    for (const name of await page.locator("[data-panel]").evaluateAll(elements => elements.map(el => el.dataset.panel))) {
      await panel(page, name);
      assert(await page.locator(`#${name}-panel button, #${name}-panel input, #${name}-panel select, #${name}-panel a`).count() > 0);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Desktop has no horizontal overflow");
    await cleanClose(context, page);
  });

  await check("390px mobile layout has no overflow and all controls stay reachable", async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } });
    for (const name of await page.locator("[data-panel]").evaluateAll(elements => elements.map(el => el.dataset.panel))) {
      await panel(page, name);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has no horizontal overflow`);
      const visible = page.locator(`#${name}-panel button:visible, #${name}-panel input:visible, #${name}-panel select:visible`);
      for (let i = 0; i < await visible.count(); i++) {
        await visible.nth(i).scrollIntoViewIfNeeded();
        const box = await visible.nth(i).boundingBox();
        assert(box && box.x >= -1 && box.x + box.width <= 391, `${name} control ${i} fits width`);
      }
    }
    await cleanClose(context, page);
  });

  await check("Light and look controls change pixels; enhancement zero matches original", async () => {
    const { context, page } = await open();
    await page.locator("#resetButton").click();
    await panel(page, "looks");
    await range(page, "enhancementRange", 100);
    await range(page, "brightnessRange", 20);
    const dark = await pixels(page);
    await range(page, "brightnessRange", 80);
    const bright = await pixels(page);
    assert(bright.mean > dark.mean + 5, `Light control visibly lifts image (${dark.mean.toFixed(1)} to ${bright.mean.toFixed(1)})`);
    await page.locator('[data-look="mono"]').click();
    await page.waitForTimeout(100);
    const mono = await pixels(page);
    assert(difference(bright, mono) > 3, "Monochrome changes image");
    await range(page, "enhancementRange", 0);
    const neutral = await pixels(page);
    const box = await page.locator("#holdOriginalButton").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(100);
    const original = await pixels(page);
    await page.mouse.up();
    assert(difference(neutral, original) < 0.1, `Enhancement0 + mono is true identity (${difference(neutral, original).toFixed(4)})`);
    await cleanClose(context, page);
  });

  await check("Side-by-side comparison preserves original left and enhanced right", async () => {
    const { context, page } = await open();
    await panel(page, "looks");
    await range(page, "enhancementRange", 100);
    await range(page, "brightnessRange", 80);
    await page.locator('[data-look="warm"]').click();
    await page.keyboard.down("c");
    await page.waitForTimeout(100);
    const original = await pixels(page);
    await page.keyboard.up("c");
    await panel(page, "studio");
    await page.locator("#splitSwitch").click();
    await page.waitForTimeout(100);
    const split = await pixels(page);
    assert(sideDifference(original, split, "left") < 0.2, "Left half exactly preserves original");
    assert(sideDifference(original, split, "right") > 3, "Right half displays enhanced result");
    await cleanClose(context, page);
  });

  await check("Presets save, restore, export and reject invalid imports safely", async () => {
    const { context, page } = await open();
    await panel(page, "looks");
    await range(page, "brightnessRange", 77);
    const presetPanel = await page.locator("#savePresetButton").evaluate(el => el.closest(".control-panel")?.id?.replace(/-panel$/, ""));
    if (presetPanel) await panel(page, presetPanel);
    await page.locator("#presetName").fill("QA meeting profile");
    await page.locator("#savePresetButton").click();
    await page.locator("#presetList .preset-load").filter({ hasText: "QA meeting profile" }).waitFor();
    await panel(page, "looks");
    await range(page, "brightnessRange", 30);
    if (presetPanel) await panel(page, presetPanel);
    await page.locator("#presetList .preset-load").filter({ hasText: "QA meeting profile" }).click();
    assert.equal(await page.locator("#brightnessRange").inputValue(), "77", "Saved preset restores adjustment");
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#exportPresetButton").click();
    const exported = await downloadEvent;
    const exportedData = JSON.parse(fs.readFileSync(await exported.path(), "utf8"));
    assert.equal(exportedData.schema, "meetinglens.presets");
    assert(exportedData.presets.some(preset => preset.name === "QA meeting profile"));
    for (const content of ["{broken", JSON.stringify({ schema: "wrong", presets: [] }), JSON.stringify({ schema: "meetinglens.presets", version: 1, presets: [{ id: "evil", name: "invalid", settings: { brightness: "NaN", look: "oops" } }] })]) {
      await page.locator("#importPresetInput").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(content) });
      await page.waitForTimeout(150);
      assert.deepEqual(errors.get(page), [], "Invalid import causes no uncaught errors");
      const value = Number(await page.locator("#brightnessRange").inputValue());
      assert(Number.isFinite(value) && value >= 0 && value <= 100, "Invalid imported number never poisons settings");
    }
    const imported = { schema: "meetinglens.presets", version: 1, presets: [{ id: "qa-imported-profile", name: "QA imported profile", settings: { ...exportedData.presets[0].settings, brightness: 88 } }] };
    await page.locator("#importPresetInput").setInputFiles({ name: "imported.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
    await page.locator("#presetList .preset-load").filter({ hasText: "QA imported profile" }).click();
    assert.equal(await page.locator("#brightnessRange").inputValue(), "88", "Valid imported preset restores its settings");
    await cleanClose(context, page);
  });

  await check("Corrupt, hostile and blocked browser storage do not break startup", async () => {
    for (const payload of ["{invalid", "null", "[]", JSON.stringify({ brightness: "bad", contrast: -999, saturation: 9999999, enhancement: null, zoom: {}, look: "__proto__", scene: "toString", frame: "<img>" })]) {
      const { context, page } = await open({}, { fn: ({ payload }) => localStorage.setItem("meetinglens-settings", payload), arg: { payload } });
      await page.locator("#resetButton").click();
      await panel(page, "looks");
      await range(page, "brightnessRange", 70);
      await cleanClose(context, page);
    }
    const { context, page } = await open({}, () => {
      Object.defineProperty(Storage.prototype, "getItem", { value() { throw new DOMException("Storage disabled", "SecurityError"); } });
      Object.defineProperty(Storage.prototype, "setItem", { value() { throw new DOMException("Storage disabled", "SecurityError"); } });
    });
    await panel(page, "looks");
    await range(page, "brightnessRange", 71);
    await page.locator("#resetButton").click();
    await cleanClose(context, page);
  });

  await check("Snapshots download real PNG/JPEG and Privacy Shield cancels timer", async () => {
    const { context, page } = await open();
    const capturePanel = await page.locator("#snapshotFormat").evaluate(el => el.closest(".control-panel")?.id?.replace(/-panel$/, ""));
    if (capturePanel) await panel(page, capturePanel);
    await page.locator("#timerSelect").selectOption("0");
    for (const [format, signature] of [["png", "89504e47"], ["jpeg", "ffd8"]]) {
      await page.locator("#snapshotFormat").selectOption(format);
      const event = page.waitForEvent("download");
      await page.locator("#captureButton").click();
      const download = await event;
      const data = fs.readFileSync(await download.path());
      assert(data.subarray(0, signature.length / 2).toString("hex") === signature, `${format} content has correct signature`);
      assert(data.length > 10000, "Snapshot contains image data");
    }
    await page.locator("#timerSelect").selectOption("3");
    let unexpectedDownloads = 0;
    page.on("download", () => unexpectedDownloads++);
    await page.locator("#captureButton").click();
    await panel(page, "privacy");
    await page.locator("#privacyButton").click();
    await page.waitForTimeout(3400);
    assert.equal(unexpectedDownloads, 0, "Shield prevents countdown snapshot download");
    await cleanClose(context, page);
  });

  await check("Fake camera starts, stops all tracks and Privacy Shield releases camera", async () => {
    const { context, page } = await open({ permissions: ["camera"] }, () => {
      window.__qaStreams = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints); window.__qaStreams.push(stream); return stream;
      };
    });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#stopCameraButton").click();
    assert(await page.evaluate(() => window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))), "Stop ends every camera track");
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await panel(page, "privacy");
    await page.locator("#privacyButton").click();
    assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject && window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))), "Shield releases video and every track");
    await cleanClose(context, page);
  });

  await check("Camera quality changes render size, restart cleanly and never request audio", async () => {
    const { context, page } = await open({ permissions: ["camera"] }, () => {
      window.__qaStreams = []; window.__qaConstraints = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.__qaConstraints.push(constraints);
        const stream = await original(constraints); window.__qaStreams.push(stream); return stream;
      };
    });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await panel(page, "device");
    for (const [quality, width, height, count] of [["high", 1920, 1080, 2], ["efficient", 640, 360, 3]]) {
      await page.locator("#qualitySelect").selectOption(quality);
      await page.waitForFunction(({ width, height, count }) => {
        const canvas = document.querySelector("#previewCanvas"), video = document.querySelector("#cameraVideo");
        return window.__qaStreams.length >= count && canvas.width === width && canvas.height === height && video.srcObject && video.readyState >= 2 && window.__qaStreams.slice(0, -1).every(s => s.getTracks().every(t => t.readyState === "ended"));
      }, { width, height, count });
    }
    assert(await page.evaluate(() => window.__qaConstraints.every(c => c.audio === false)), "All camera requests explicitly disable audio");
    await page.locator("#stopCameraButton").click();
    await cleanClose(context, page);
  });

  await check("Stop and Privacy Shield cancel a delayed camera permission response", async () => {
    for (const cancel of ["stop", "shield"]) {
      const { context, page } = await open({ permissions: ["camera"] }, () => {
        window.__qaStreams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
          const stream = await original(constraints); window.__qaStreams.push(stream);
          await new Promise(resolve => setTimeout(resolve, 1200)); return stream;
        };
      });
      await page.locator("#startCameraButton").click();
      await page.waitForFunction(() => window.__qaStreams.length > 0);
      if (cancel === "stop") await page.locator("#stopCameraButton").click();
      else { await panel(page, "privacy"); await page.locator("#privacyButton").click(); }
      await page.waitForTimeout(1600);
      assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject && window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))), `${cancel} discards late stream and stops all tracks`);
      await cleanClose(context, page);
    }
  });

  await check("Hidden tab stops camera, stays stopped on return and allows explicit restart", async () => {
    const { context, page } = await open({ permissions: ["camera"] }, () => {
      window.__qaStreams = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); window.__qaStreams.push(stream); return stream; };
    });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject && window.__qaStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))), "Hidden document releases camera");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(100);
    assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject), "Returning does not restart camera automatically");
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#stopCameraButton").click();
    await cleanClose(context, page);
  });

  await check("Camera disconnect clears preview, reports the problem and allows retry", async () => {
    const { context, page } = await open({ permissions: ["camera"] });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.evaluate(() => { const track = document.querySelector("#cameraVideo").srcObject.getVideoTracks()[0]; track.stop(); track.dispatchEvent(new Event("ended")); });
    assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject), "Disconnect detaches video");
    assert.match(await page.locator("#cameraErrorText").textContent(), /disconnect|stop|reconnect/i);
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#stopCameraButton").click();
    await cleanClose(context, page);
  });

  await check("Denied camera gives useful feedback and can recover on retry", async () => {
    const { context, page } = await open({ permissions: ["camera"] }, () => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let first = true;
      navigator.mediaDevices.getUserMedia = constraints => {
        if (first) { first = false; return Promise.reject(new DOMException("Denied for test", "NotAllowedError")); }
        return original(constraints);
      };
    });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => /permission|allow|denied|blocked/i.test([document.querySelector("#toastText")?.textContent, document.querySelector("#cameraErrorText")?.textContent].join(" ")));
    assert(await page.locator("#startCameraButton").isEnabled(), "Camera retry remains available");
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator("#stopCameraButton").click();
    await cleanClose(context, page);
  });
}

run().catch(error => { reports.push({ name: "Test harness", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const output = path.join(root, ".qa"); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "studio-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
  const failed = reports.filter(item => !item.pass).length;
  console.log(`${reports.length - failed}/${reports.length} browser checks passed`);
  process.exitCode = failed ? 1 : 0;
});
