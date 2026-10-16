/* Integration check for the real service worker, offline shortcuts and updates. */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".webmanifest":"application/manifest+json", ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml" };
let revision = 1;
let server, browser;
(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const filename = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      let data = await fs.readFile(filename);
      if (filename.endsWith("service-worker.js") && revision === 2) data = Buffer.from(data.toString().replaceAll("v2.0.0", "v2.0.0-test-update"));
      res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ["--disable-dev-shm-usage", "--disable-gpu"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async () => {
    await caches.open("unrelated-app-kept");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`${base}/?screen=looks`);
  await page.locator("#looks-panel.active").waitFor();
  assert.ok(await page.locator("#offlineLabel").isVisible(), "Offline state must be visible");
  const portrait = await page.evaluate(async () => {
    const image = new Image(); image.src="./assets/demo/professional-portrait.webp";
    await image.decode(); return image.naturalWidth;
  });
  assert.equal(portrait, 1536, "Portrait must be available offline");
  console.log("PASS offline shell, query shortcut and portrait");
  await context.setOffline(false);
  revision = 2;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.locator("#updateNotice").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  await page.locator("#updateNotice").click();
  await page.waitForFunction(async () => {
    const keys = await caches.keys(); return keys.some(key => key.endsWith("v2.0.0-test-update")) && !keys.some(key => key.endsWith("-v2.0.0"));
  }, null, { timeout: 15000 });
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes("unrelated-app-kept")), "Update must preserve unrelated caches");
  assert.deepEqual(errors, []);
  console.log("PASS user-applied update, old release cleanup and unrelated cache preservation");
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  await browser?.close(); if (server) await new Promise(done => server.close(done));
});
