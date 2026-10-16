#!/usr/bin/env node
/* Focused regression checks for photographic sample scenes.
 * Run: node scripts/verify-backgrounds.cjs
 * Requires Playwright/Chromium. Uses a temporary local server and fake camera.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const scenes = {
  room: ["executive-office", "Executive office"], soft: ["scandinavian-office", "Scandinavian office"],
  studio: ["architect-studio", "Architect studio"], night: ["city-lounge", "City lounge"],
  dawn: ["warm-library", "Warm library"], slate: ["minimal-gallery", "Minimal gallery"]
};
const reports = [], contexts = new Set(), errors = new WeakMap();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
let browser, server, base;

async function open({ initializer, route, ...options } = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", ...options });
  contexts.add(context);
  await context.addInitScript(() => {
    localStorage.setItem("meetinglens-settings", JSON.stringify({ enhancement: 0, mirror: false, sceneStrength: 0, softness: false }));
  });
  if (initializer) await context.addInitScript(initializer);
  if (route) await route(context);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  errors.set(page, []); page.on("pageerror", error => errors.get(page).push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(resource => /professional-portrait\.webp/.test(resource.name) && resource.responseEnd > 0));
  await ready(page, "room");
  return { context, page };
}

async function paint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function ready(page, scene) {
  const name = scenes[scene][1];
  await page.waitForFunction(name => document.querySelector("#backgroundLoadStatus")?.textContent === `${name} · ready on this device`, name);
  await paint(page);
}

async function choose(page, scene) {
  await page.locator(`.scene-tile[data-scene="${scene}"]`).click();
  await ready(page, scene);
}

async function region(page, box) {
  return page.locator("#previewCanvas").evaluate((canvas, box) => {
    const x = Math.round(canvas.width * box[0]), y = Math.round(canvas.height * box[1]);
    const w = Math.round(canvas.width * box[2]), h = Math.round(canvas.height * box[3]);
    return [...canvas.getContext("2d").getImageData(x, y, w, h).data];
  }, box);
}

function difference(a, b) {
  assert.equal(a.length, b.length); let sum = 0, count = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { sum += Math.abs(a[i] - b[i]); count++; }
  return sum / count;
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, value) => {
    element.value = String(value); element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await paint(page);
}

async function close(context, page) {
  assert.deepEqual(errors.get(page), [], "No uncaught browser errors");
  await context.close(); contexts.delete(context);
}

async function check(name, fn) {
  const started = Date.now();
  try { const measurements = await fn(); reports.push({ name, pass: true, ms: Date.now() - started, ...measurements }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
  finally { for (const context of contexts) await context.close(); contexts.clear(); }
}

async function run() {
  server = http.createServer((request, response) => {
    let location;
    try { location = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400).end(); return; }
    const file = path.resolve(root, `.${location === "/" ? "/index.html" : location}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });

  await check("All six photographic scenes decode and both thumbnail sets use their matching photograph", async () => {
    const { context, page } = await open();
    for (const [scene, [filename]] of Object.entries(scenes)) {
      await choose(page, scene);
      const checks = await page.locator(`.scene-button[data-scene="${scene}"] .scene-thumbnail`).evaluateAll(async (elements, filename) => {
        return Promise.all(elements.map(async element => {
          const value = getComputedStyle(element).backgroundImage;
          const match = value.match(/url\(["']?(.*?)["']?\)/);
          if (!match) return { match: false, value };
          const image = new Image(); image.src = match[1]; await image.decode();
          return { match: new URL(image.src).pathname.endsWith(`/assets/demo/backgrounds/${filename}.webp`), width: image.naturalWidth, height: image.naturalHeight };
        }));
      }, filename);
      assert.equal(checks.length, 2, `${scene} has shortcut and inspector thumbnail`);
      assert(checks.every(result => result.match && result.width >= 1280 && result.height >= 720), `${scene} thumbnails use the full photographic scene: ${JSON.stringify(checks)}`);
      assert.equal(await page.locator(`.scene-button[data-scene="${scene}"][aria-pressed="true"]`).count(), 2, `${scene} selection remains synchronized`);
    }
    await close(context, page);
  });

  await check("Scene switches visibly replace surroundings and preserve the centered portrait", async () => {
    const { context, page } = await open();
    const backgroundBox = [.01, .05, .10, .60], faceBox = [.477, .20, .046, .20];
    const baselineFace = await region(page, faceBox), backgrounds = [], portraitDifference = [];
    for (const scene of Object.keys(scenes)) {
      await choose(page, scene);
      backgrounds.push({ scene, pixels: await region(page, backgroundBox) });
      const delta = difference(baselineFace, await region(page, faceBox));
      assert(delta < 2, `${scene} leaves face position and detail intact (${delta.toFixed(3)} mean channel difference)`);
      portraitDifference.push({ scene, meanChannelDifference: delta });
    }
    let minimumBackgroundDifference = Infinity;
    for (let i = 0; i < backgrounds.length; i++) for (let j = i + 1; j < backgrounds.length; j++) {
      const delta = difference(backgrounds[i].pixels, backgrounds[j].pixels);
      assert(delta > 4, `${backgrounds[i].scene} and ${backgrounds[j].scene} show distinct surroundings (${delta.toFixed(3)})`);
      minimumBackgroundDifference = Math.min(minimumBackgroundDifference, delta);
    }
    await close(context, page); return { minimumBackgroundDifference, portraitDifference };
  });

  await check("Background softness changes surroundings without blurring the portrait face", async () => {
    const { context, page } = await open();
    await page.locator('[data-panel="background"]').click();
    await range(page, "sceneStrengthRange", 0);
    const clearBackground = await region(page, [.01, .05, .18, .70]), clearFace = await region(page, [.477, .20, .046, .20]);
    await range(page, "sceneStrengthRange", 100);
    const backgroundDelta = difference(clearBackground, await region(page, [.01, .05, .18, .70]));
    const faceDelta = difference(clearFace, await region(page, [.477, .20, .046, .20]));
    assert(backgroundDelta > 1, `Softness visibly changes background (${backgroundDelta.toFixed(3)})`);
    assert(faceDelta < .4, `Face detail is preserved (${faceDelta.toFixed(3)})`);
    await close(context, page); return { backgroundMeanChannelDifference: backgroundDelta, faceMeanChannelDifference: faceDelta };
  });

  await check("A slow old image cannot overwrite the last selected scene after rapid clicks", async () => {
    let releaseOld; const gate = new Promise(resolve => { releaseOld = resolve; });
    const { context, page } = await open({ route: context => context.route("**/assets/demo/backgrounds/architect-studio.webp", async route => { await gate; await route.continue(); }) });
    await page.locator('.scene-tile[data-scene="studio"]').click();
    await page.locator('.scene-tile[data-scene="soft"]').click();
    await choose(page, "night");
    const selectedImage = await region(page, [0, 0, 1, 1]);
    const oldResponse = page.waitForResponse(response => response.url().endsWith("/architect-studio.webp"));
    releaseOld(); await oldResponse; await paint(page); await page.waitForTimeout(100);
    assert.match(await page.locator("#backgroundLoadStatus").textContent(), /^City lounge · ready/);
    assert.equal(await page.locator('.scene-tile[data-scene="night"]').getAttribute("aria-pressed"), "true");
    assert.equal(difference(selectedImage, await region(page, [0, 0, 1, 1])), 0, "Late old image does not alter the chosen canvas");
    await close(context, page);
  });

  await check("A missing background shows a usable neutral fallback and recovers on another scene", async () => {
    const { context, page } = await open({ route: context => context.route("**/assets/demo/backgrounds/minimal-gallery.webp", route => route.fulfill({ status: 404, contentType: "text/plain", body: "Missing background for regression check" })) });
    await page.locator('.scene-tile[data-scene="slate"]').click();
    await page.waitForFunction(() => /unavailable.*neutral/i.test(document.querySelector("#backgroundLoadStatus")?.textContent));
    await paint(page);
    assert(await page.locator("#backgroundNotice").isVisible(), "Fallback message is visible");
    const fallbackFace = await region(page, [.477, .20, .046, .20]);
    assert(new Set(fallbackFace.filter((_, index) => index % 4 !== 3)).size > 100, "Portrait detail remains visible over neutral fallback");
    await choose(page, "room");
    assert(await page.locator("#backgroundNotice").isHidden(), "Successful scene clears fallback message");
    await close(context, page);
  });

  await check("Zero intensity bypasses selected live backgrounds and Privacy Shield clears the camera", async () => {
    const { context, page } = await open({ permissions: ["camera"], initializer: () => {
      window.__qaStreams = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); window.__qaStreams.push(stream); return stream; };
    } });
    await page.locator("#startCameraButton").click();
    await page.waitForFunction(() => document.querySelector("#cameraVideo").srcObject && document.querySelector("#cameraVideo").readyState >= 2);
    await page.locator('.scene-tile[data-scene="dawn"]').click();
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().enhancement), 0);
    assert.equal(await page.evaluate(() => window.MeetingLensStudio.getState().backgroundReplace), true);
    assert.match(await page.locator("#effectLabel").textContent(), /Original.*bypassed/);
    assert(await page.evaluate(() => document.querySelector("#cameraVideo").srcObject.getTracks().every(track => track.readyState === "live")), "Scene change preserves the live camera stream");
    await page.locator("#shieldQuickButton").click();
    await paint(page);
    assert(await page.evaluate(() => !document.querySelector("#cameraVideo").srcObject && window.__qaStreams.every(stream => stream.getTracks().every(track => track.readyState === "ended"))), "Shield ends every track and detaches video");
    const cleared = await region(page, [0, 0, 1, 1]);
    assert(cleared.every((value, index) => value === [16, 24, 37, 255][index % 4]), "Shield removes every camera pixel from the canvas");
    await close(context, page);
  });
}

run().catch(error => { reports.push({ name: "Test harness", pass: false, error: error.stack }); console.error(error); }).finally(async () => {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  const directory = path.join(root, ".qa"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "background-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
  const failed = reports.filter(report => !report.pass).length;
  console.log(`${reports.length - failed}/${reports.length} photographic background checks passed`); process.exitCode = failed ? 1 : 0;
});
