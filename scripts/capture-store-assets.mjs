/*
  Development-only helper used to create genuine Store screenshots from this app.
  Run after `npm install` and `npx playwright install chromium`:
  node scripts/capture-store-assets.mjs
*/
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "4175";
const server = spawn("python3", ["-m", "http.server", port, "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
const url = `http://127.0.0.1:${port}`;
const captures = [
  ["studio", "01-studio-1920x1080.png"],
  ["looks", "02-looks-1920x1080.png"],
  ["background", "03-background-1920x1080.png"],
  ["privacy", "04-privacy-1920x1080.png"],
  ["device", "05-camera-1920x1080.png"],
  ["presets", "06-presets-1920x1080.png"],
  ["effects", "07-effects-1920x1080.png"],
  ["photo", "08-photo-lab-1920x1080.png"],
  ["whiteboard", "09-whiteboard-1920x1080.png"],
  ["session", "10-session-1920x1080.png"]
];

try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Server is starting. */ }
    if (attempt === 39) throw new Error("Screenshot server did not become ready.");
    await new Promise(done => setTimeout(done, 100));
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [screen, filename] of captures) {
    const photoPage = screen === "photo" || screen === "whiteboard";
    await page.goto(photoPage ? `${url}/photo-workbench.html` : `${url}/?screen=${screen}`, { waitUntil: "networkidle" });
    if (photoPage) {
      await page.waitForFunction(() => window.MeetingLensPhoto?.getState().photos > 0 && !window.MeetingLensPhoto.getState().busy);
      if (screen === "photo") {
        await page.locator("#enhanceButton").click();
      } else {
        await page.locator('[data-tool="board"]').click();
        await page.locator("#loadBoardSampleButton").click();
        await page.waitForFunction(() => window.MeetingLensPhoto.getState().photos === 2 && !window.MeetingLensPhoto.getState().busy);
        await page.locator("#suggestBoardButton").click();
      }
      await page.waitForFunction(() => !window.MeetingLensPhoto.getState().busy);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(root, "assets/store-assets/screenshots", filename) });
      continue;
    }
    await page.locator("#resetButton").click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => {
      const image = [...document.images].find(img => img.src.includes("professional-portrait"));
      return !image || image.complete;
    });
    if (screen === "privacy") await page.locator("#privacyButton").click();
    if (screen === "looks") {
      await page.locator('.look-button[data-look="warm"]').click();
      await page.locator('.nav-button[data-panel="studio"]').click();
      await page.locator("#splitSwitch").click();
      await page.locator('.nav-button[data-panel="looks"]').click();
    }
    if (screen === "background") await page.locator('#background-panel .scene-button[data-scene="studio"]').click();
    if (screen === "presets") {
      await page.locator("#presetName").fill("Morning meetings");
      await page.locator("#savePresetButton").click();
      await page.locator("#presetName").fill("Teaching session");
      await page.locator("#savePresetButton").click();
    }
    if (screen === "effects") {
      await page.locator("#enableVisionButton").click();
      await page.waitForFunction(() => window.MeetingLensStudio?.getState().visionReady, null, { timeout: 60000 });
      await page.locator("#autoFrameSwitch").click();
      await page.locator("#backgroundBlurSwitch").click();
      await page.locator("#portraitLightSwitch").click();
      await page.waitForFunction(() => window.MeetingLensStudio.getAnalysis()?.face && window.MeetingLensStudio.getAnalysis()?.mask && !window.MeetingLensStudio.getState().visionPending, null, { timeout: 60000 });
    }
    await page.waitForTimeout(3000); // Allow transient toasts to leave the capture.
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(root, "assets/store-assets/screenshots", filename) });
  }
  await browser.close();
  if (errors.length) throw new Error(errors.join("\n"));
  // Capture the live renderer with a controlled MediaStream and a visible
  // fictional-person disclosure. This never opens the author's real webcam.
  const proof = spawn(process.execPath, [resolve(root, "scripts/verify-live-backgrounds.cjs")], {
    cwd: root, env: { ...process.env, LIVE_BACKGROUND_CHECK: "Choosing a background arms" }, stdio: "inherit"
  });
  const [proofExitCode] = await once(proof, "close");
  if (proofExitCode !== 0) throw new Error("Live background screenshot capture failed.");
  await copyFile(resolve(root, ".qa/live-background-proof.png"), resolve(root, "assets/store-assets/screenshots/03-background-1920x1080.png"));
  console.log("Captured ten 1920 x 1080 screenshots from the running MeetingLens app.");
} finally {
  server.kill("SIGTERM");
}
