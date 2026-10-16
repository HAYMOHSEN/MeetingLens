#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, ".qa"), checks = [];
let browser, server;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
  server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://local").pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => { if (error) res.writeHead(404).end(); else { res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); res.end(data); } });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true, serviceWorkers: "block" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.MeetingLensPhoto && !MeetingLensPhoto.getState().busy);
  const reset = async () => { await page.goto(`http://127.0.0.1:${server.address().port}/photo-workbench.html`); await ready(); };
  const fixture = async (width, height, color = "#886543", transparent = false) => Buffer.from(await page.evaluate(({ width, height, color, transparent }) => { const c = document.createElement("canvas"); c.width = width; c.height = height; const ctx = c.getContext("2d"); if (!transparent) { ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); } ctx.fillStyle = "#ba9650"; ctx.fillRect(width / 4, height / 4, Math.max(1, width / 2), Math.max(1, height / 2)); return c.toDataURL("image/png").split(",")[1]; }, { width, height, color, transparent }), "base64");
  const upload = async (files) => { await page.locator("#photoInput").setInputFiles(files); await ready(); };
  const image = () => page.locator("#photoCanvas").evaluate(c => c.toDataURL());
  const snapshot = () => page.evaluate(() => ({ state: MeetingLensPhoto.getState(), image: document.getElementById("photoCanvas").toDataURL(), mask: document.getElementById("maskCanvas").toDataURL(), undo: document.getElementById("undoButton").disabled, name: document.getElementById("photoName").textContent }));
  async function check(name, action) { try { await reset(); await action(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }

  await check("A rejected import retains the edited sample, original and Undo", async () => {
    await page.locator("#enhanceButton").click(); await ready(); const before = await snapshot();
    assert.equal(before.undo, false);
    await upload({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("invalid") });
    const after = await snapshot(); assert.ok(after.image === before.image, "Edited pixels changed"); assert.equal(after.undo, before.undo); assert.equal(after.name, before.name);
    await page.locator("#undoButton").click(); assert.ok(await image() !== before.image, "Undo did not restore previous pixels");
  });
  await check("A rejected import preserves active selection, painted mask and edit history", async () => {
    const buffer = await fixture(240, 180);
    await upload([{ name: "one.png", mimeType: "image/png", buffer }, { name: "two.png", mimeType: "image/png", buffer }]);
    await page.locator(".film-select").first().click(); await page.locator("#enhanceButton").click(); await ready();
    await page.locator('[data-tool="remove"]').click(); const bounds = await page.locator("#maskCanvas").boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down(); await page.mouse.up();
    const before = await snapshot();
    await upload({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("broken") });
    const after = await snapshot(); assert.equal(after.state.active, before.state.active); assert.ok(after.image === before.image, "Edited pixels changed"); assert.ok(after.mask === before.mask, "Painted mask changed"); assert.equal(after.undo, before.undo);
  });
  await check("Extreme portrait import produces a bounded decodable thumbnail", async () => {
    await upload({ name: "thin.png", mimeType: "image/png", buffer: await fixture(1, 2048) });
    const thumb = await page.locator(".film-select img").evaluate(async img => { await img.decode().catch(() => {}); return { width: img.naturalWidth, height: img.naturalHeight, src: img.src.slice(0, 30) }; });
    assert.ok(thumb.width > 0 && thumb.height > 0, JSON.stringify(thumb)); assert.ok(Math.max(thumb.width, thumb.height) <= 180, JSON.stringify(thumb));
  });
  await check("Imports count enlarged whiteboard outputs toward the working set limit", async () => {
    const small = await fixture(200, 200);
    await upload({ name: "first.png", mimeType: "image/png", buffer: small });
    await page.locator('[data-tool="board"]').click(); await page.locator("#boardSize").selectOption("2048");
    await page.locator("#rectifyButton").click(); await ready(); assert.equal((await snapshot()).state.width, 2048);
    await upload({ name: "second.png", mimeType: "image/png", buffer: small });
    await page.locator("#rectifyButton").click(); await ready(); assert.equal((await snapshot()).state.width, 2048);
    const before = await snapshot();
    await upload({ name: "third.png", mimeType: "image/png", buffer: await fixture(2048, 2048) });
    const after = await snapshot(); assert.equal(after.state.photos, 2); assert.ok(after.image === before.image, "Edited pixels changed"); assert.match(await page.locator("#status").innerText(), /memory limit/i);
  });
  await check("Transparent PNG imports flatten onto white and preserve the imported original", async () => {
    await upload({ name: "alpha.png", mimeType: "image/png", buffer: await fixture(100, 80, "#000", true) });
    const before = await image(), pixel = await page.locator("#photoCanvas").evaluate(c => [...c.getContext("2d").getImageData(0, 0, 1, 1).data]);
    assert.deepEqual(pixel, [255, 255, 255, 255]); await page.locator("#enhanceButton").click(); await ready();
    await page.locator("#resetPhotoButton").click(); await ready(); assert.ok(await image() === before, "Reset did not restore imported pixels");
  });
  await check("JPEG EXIF orientation is applied before editing and JPEG export", async () => {
    const buffer = execFileSync("python3", ["-c", "from PIL import Image; import io,sys; im=Image.new('RGB',(80,40),'red'); im.paste('blue',(40,0,80,40)); exif=Image.Exif(); exif[274]=6; b=io.BytesIO(); im.save(b,format='JPEG',exif=exif); sys.stdout.buffer.write(b.getvalue())"]);
    await upload({ name: "oriented.jpg", mimeType: "image/jpeg", buffer }); const s = await snapshot(); assert.equal(s.state.width, 40); assert.equal(s.state.height, 80);
    const pixels = await page.locator("#photoCanvas").evaluate(c => ({ top: [...c.getContext("2d").getImageData(20, 10, 1, 1).data], bottom: [...c.getContext("2d").getImageData(20, 70, 1, 1).data] }));
    assert.ok(pixels.top[0] > 220 && pixels.top[2] < 30); assert.ok(pixels.bottom[2] > 220 && pixels.bottom[0] < 30);
    const event = page.waitForEvent("download"); await page.locator("#exportPhotoButton").click(); const target = path.join(output, "shipping-oriented.jpg"); await (await event).saveAs(target);
    const size = execFileSync("python3", ["-c", "from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(im.size)", target], { encoding: "utf8" }); assert.match(size, /40, 80/);
  });
  assert.deepEqual(errors, []); checks.push({ name: "No unhandled browser errors", passed: true });
  fs.writeFileSync(path.join(output, "shipping-photo-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
  assert.ok(checks.every(item => item.passed), `${checks.filter(item => !item.passed).length} Photo Lab shipping regressions failed.`);
  console.log(`${checks.length}/${checks.length} Photo Lab shipping checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) server.close(); });
