/*
  Development-only helper used to create genuine Store screenshots from this app.
  Run after `npm install` and `npx playwright install chromium`:
  node scripts/capture-store-assets.mjs
*/
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = spawn("python3", ["-m", "http.server", "4173", "--directory", root], { stdio: "ignore" });
const url = "http://127.0.0.1:4173";
const captures = [
  ["studio", "01-studio-1920x1080.png"],
  ["looks", "02-looks-1920x1080.png"],
  ["background", "03-background-1920x1080.png"],
  ["privacy", "04-privacy-1920x1080.png"]
];

try {
  await new Promise(resolveReady => setTimeout(resolveReady, 600));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [screen, filename] of captures) {
    await page.goto(`${url}/?screen=${screen}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(root, "assets/store-assets/screenshots", filename) });
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
