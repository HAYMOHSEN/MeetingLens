#!/usr/bin/env node
/* Shipping smoke test: actual repository-subpath deployment, offline shell,
 * local links/manifest and compact layouts. Does not emulate native hardware. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), prefix = "/MeetingLens/";
const pages = ["index.html", "photo-workbench.html", "native-capabilities.html", "privacy.html", "terms.html", "offline.html"];
const reports = [], errors = [], failedRequests = [], unexpectedRequests = [], evidence = {};
const mime = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css", ".json":"application/json", ".webmanifest":"application/manifest+json", ".wasm":"application/wasm", ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml" };
let browser, server, base, context, page, workerRevision = 1;
async function check(name, action) {
  try { await action(); reports.push({ name, passed: true }); console.log("PASS " + name); }
  catch (error) { reports.push({ name, passed: false, error: error.stack }); console.error("FAIL " + name + "\n" + error.stack); }
}
async function assertLayout(label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(result.scroll <= result.width + 1 && result.body <= result.width + 1, `${label}: ${JSON.stringify(result)}`);
}
async function main() {
  await check("Every local HTML/CSS asset and hyperlink target exists", async () => {
    let checked = 0;
    for (const filename of pages) {
      const source = fs.readFileSync(path.join(root, filename), "utf8");
      const ids = [...source.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${filename} has unique IDs`);
      for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
        const value = match[1];
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) continue;
        if (value.startsWith("#")) { assert(ids.includes(value.slice(1)), `${filename}: ${value} resolves`); continue; }
        const target = value.split(/[?#]/)[0] || ".";
        const resolved = path.resolve(path.dirname(path.join(root, filename)), target);
        assert(resolved === root || resolved.startsWith(root + path.sep), `${filename}: ${value} remains within app`);
        assert(fs.existsSync(resolved), `${filename}: ${value} exists`); checked++;
      }
    }
    for (const filename of ["app.css", "photo-workbench.css", "session-tools.css"]) {
      const folder = path.join(root, "assets/styles"), source = fs.readFileSync(path.join(folder, filename), "utf8");
      for (const match of source.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        if (/^(?:data:|https?:|#)/.test(match[1])) continue;
        assert(fs.existsSync(path.resolve(folder, match[1])), `${filename}: ${match[1]} exists`); checked++;
      }
    }
    evidence.localTargets = checked;
  });
  await check("Manifest, icons, screenshots and shortcuts remain scoped to a repository path", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(manifest.display_override || ["standalone"], ["standalone"], "Window controls overlay is not advertised without a titlebar layout");
    const manifestUrl = "https://example.invalid" + prefix + "manifest.webmanifest";
    for (const relative of [manifest.id, manifest.start_url, manifest.scope, ...manifest.shortcuts.map(s => s.url)]) assert(new URL(relative, manifestUrl).pathname.startsWith(prefix), relative);
    for (const asset of [...manifest.icons, ...manifest.screenshots, ...manifest.shortcuts.flatMap(s => s.icons || [])]) {
      assert(asset.src.startsWith("./"), "Manifest asset is relative");
      const buffer = fs.readFileSync(path.join(root, asset.src));
      assert.equal(buffer.subarray(1, 4).toString(), "PNG");
      assert.equal(`${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`, asset.sizes, asset.src);
    }
    assert(manifest.icons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"));
    assert(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"));
    evidence.screenshots = manifest.screenshots.length;
  });
  server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
    if (!pathname.startsWith(prefix)) { unexpectedRequests.push(pathname); res.writeHead(404).end(); return; }
    const suffix = pathname.slice(prefix.length) || "index.html", filename = path.resolve(root, suffix);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, bytes) => {
      if (error) { failedRequests.push(pathname); res.writeHead(404).end(); return; }
      if (suffix === "service-worker.js" && workerRevision === 2) bytes = Buffer.from(bytes.toString().replace(/v\d+\.\d+\.\d+/, "$&-shipping-check"));
      res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    window.shippingCaptureRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { shippingCaptureRequests++; throw new Error("Capture requires explicit user action in this test"); };
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(base) && !/^(blob:|data:)/.test(request.url())) unexpectedRequests.push(request.url()); });
  await check("Real service worker installs at /MeetingLens/ and preserves other app caches", async () => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await caches.open(`meetinglens-shell-${location.origin}/OtherApp/-v2.0.0`);
      await caches.open(`meetinglens-shell-${location.origin}/-v2.0.0`);
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const state = await page.evaluate(async () => ({ scope: (await navigator.serviceWorker.getRegistration()).scope, keys: await caches.keys(), controller: navigator.serviceWorker.controller.scriptURL }));
    assert.equal(state.scope, base);
    assert.equal(state.controller, base + "service-worker.js");
    assert(state.keys.includes(`meetinglens-shell-${new URL(base).origin}/OtherApp/-v2.0.0`));
    assert(state.keys.includes(`meetinglens-shell-${new URL(base).origin}/-v2.0.0`));
    evidence.worker = state;
  });
  await check("All workspaces have named controls and fit 320, 768, and 1366 px viewports", async () => {
    for (const width of [320, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const filename of pages) {
        await page.goto(base + filename, { waitUntil: "networkidle" });
        await assertLayout(`${filename} ${width}`);
        if (filename === "index.html") {
          for (const panel of ["studio", "looks", "effects", "background", "frame", "presets", "device", "session", "privacy"]) {
            await page.locator(`[data-panel="${panel}"]`).click();
            await page.locator(`#${panel}-panel.active`).waitFor(); await assertLayout(`${panel} ${width}`);
          }
        }
        if (filename === "photo-workbench.html") {
          await page.waitForFunction(() => !!window.MeetingLensPhoto && !window.MeetingLensPhoto.getState().busy);
          for (const tool of ["enhance", "match", "remove", "retouch", "board"]) { await page.locator(`[data-tool="${tool}"]`).click(); await assertLayout(`${tool} ${width}`); }
        }
        const unnamed = await page.locator("button").evaluateAll(buttons => buttons.filter(b => !b.disabled && b.offsetWidth && ![b.getAttribute("aria-label"), b.getAttribute("title"), b.textContent].some(s => s?.trim())).map(b => b.id || b.outerHTML));
        assert.deepEqual(unnamed, [], `${filename} visible buttons have names`);
        assert.equal(await page.evaluate(() => shippingCaptureRequests), 0, "Browsing settings does not request camera/microphone");
      }
    }
  });
  await check("Subpath worker update removes only this app's older release caches", async () => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(async () => { await caches.open(`meetinglens-shell-${location.href}-v1.0.0`); });
    workerRevision = 2;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.locator("#updateNotice").waitFor({ state: "visible" });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await Promise.all([page.waitForEvent("load"), page.locator("#updateNotice").click()]);
    await page.waitForFunction(async () => (await caches.keys()).some(key => key.endsWith("-shipping-check")));
    const keys = await page.evaluate(() => caches.keys());
    const current = keys.filter(key => key.startsWith(`meetinglens-shell-${base}-`));
    assert.equal(current.length, 1, "Only updated current-scope cache remains");
    assert(current[0].endsWith("-shipping-check"));
    assert(keys.includes(`meetinglens-shell-${new URL(base).origin}/OtherApp/-v2.0.0`));
    assert(keys.includes(`meetinglens-shell-${new URL(base).origin}/-v2.0.0`));
    evidence.updatedCacheKeys = keys;
  });
  await check("Every app page and query shortcut navigates offline from the repository path", async () => {
    await context.setOffline(true);
    for (const filename of [...pages, "?screen=effects", "?screen=session", "?screen=privacy"]) {
      const response = await page.goto(base + filename, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, filename);
      assert(await page.evaluate(() => !!navigator.serviceWorker.controller));
      assert.equal(await page.evaluate(() => navigator.onLine), false);
      if (filename.includes("screen=")) await page.locator(`#${filename.split("=")[1]}-panel.active`).waitFor();
      if (filename === "photo-workbench.html") await page.waitForFunction(() => window.MeetingLensPhoto?.getState().photos === 1 && !window.MeetingLensPhoto.getState().busy);
    }
    assert.deepEqual(errors, [], "No unhandled browser errors");
    assert.deepEqual(failedRequests, [], "No missing files");
    assert.deepEqual(unexpectedRequests, [], "All resources stay under the repository path");
  });
}
main().catch(error => { reports.push({ name: "Shipping harness", passed: false, error: error.stack }); console.error(error); }).finally(async () => {
  await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
  fs.writeFileSync(path.join(root, ".qa/shipping-shell-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), environment: "Headless Chromium/Linux; real service worker at a repository subpath", reports, evidence, errors, failedRequests, unexpectedRequests }, null, 2));
  const failed = reports.filter(r => !r.passed).length; console.log(`${reports.length - failed}/${reports.length} shipping-shell checks passed`); process.exitCode = failed ? 1 : 0;
});
