#!/usr/bin/env node
/* Pixel regressions for real-camera scene replacement. Uses the bundled
 * compositor and a real local person-segmentation model; no physical webcam. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const reports = [];
const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".webp": "image/webp", ".png": "image/png" };
let server, browser, page;
async function check(name, fn) {
  const started = Date.now();
  try { const measurements = await fn(); reports.push({ name, pass: true, ms: Date.now() - started, ...measurements }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function run() {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/compositor-test.html") { res.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><title>Compositor regression</title><script src="/assets/js/vision-effects.js"></script>'); return; }
    let filename; try { filename = path.resolve(root, `.${decodeURIComponent(pathname)}`); } catch { res.writeHead(400).end(); return; }
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" }).end(data); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  page = await browser.newPage({ serviceWorkers: "block" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/compositor-test.html`);
  await page.evaluate(() => {
    window.makeCanvas = (w = 640, h = 360, fill) => { const c = document.createElement("canvas"); c.width = w; c.height = h; if (fill) { c.getContext("2d").fillStyle = fill; c.getContext("2d").fillRect(0, 0, w, h); } return c; };
    window.pixel = (c, x, y) => [...c.getContext("2d").getImageData(x, y, 1, 1).data];
    window.fixture = () => {
      const source = makeCanvas(640, 360, "rgb(190,20,30)"), mask = makeCanvas(), target = makeCanvas();
      source.getContext("2d").fillStyle = "rgb(30,210,80)"; source.getContext("2d").fillRect(240, 70, 160, 290);
      mask.getContext("2d").fillStyle = "white"; mask.getContext("2d").fillRect(240, 70, 160, 290);
      const scene = makeCanvas(640, 360, "rgb(25,60,220)");
      return { source, mask, target, scene };
    };
  });
  await check("No replacement retains existing camera rendering", async () => {
    const r = await page.evaluate(() => { const f = fixture(); MeetingLensVision.process(f.source, f.target, { analysis: { mask: f.mask } }); return { room: pixel(f.target, 20, 20), person: pixel(f.target, 320, 180) }; });
    assert.deepEqual(r.room, [190, 20, 30, 255]); assert.deepEqual(r.person, [30, 210, 80, 255]);
  });
  await check("Scene replaces actual room while keeping foreground pixels intact", async () => {
    const r = await page.evaluate(() => { const f = fixture(); MeetingLensVision.process(f.source, f.target, { analysis: { mask: f.mask }, backgroundImage: f.scene }); return { room: pixel(f.target, 20, 20), person: pixel(f.target, 320, 180), state: MeetingLensVision.lastComposition }; });
    assert.deepEqual(r.room, [25, 60, 220, 255]); assert.deepEqual(r.person, [30, 210, 80, 255]); assert.equal(r.state.mode, "replacement");
  });
  await check("Portrait scenes cover wide camera frames without borders or stretching", async () => {
    const r = await page.evaluate(() => { const f = fixture(); const scene = makeCanvas(200, 600, "rgb(25,60,220)"); scene.getContext("2d").fillStyle = "yellow"; scene.getContext("2d").fillRect(0, 0, 200, 120); MeetingLensVision.compositeBackgroundReplace(f.source, f.mask, f.target, scene); return [[0,0], [639,0], [0,359], [639,359]].map(([x,y]) => pixel(f.target,x,y)); });
    for (const p of r) assert.deepEqual(p, [25, 60, 220, 255], "Center crop covers every frame corner");
  });
  await check("Wide scenes use centered aspect-cover cropping", async () => {
    const r = await page.evaluate(() => { const f = fixture(), scene = makeCanvas(1600, 360, "yellow"), ctx = scene.getContext("2d"); ctx.fillStyle = "rgb(25,60,220)"; ctx.fillRect(480,0,640,360); MeetingLensVision.process(f.source, f.target, { analysis: { mask: f.mask }, backgroundImage: scene }); return [pixel(f.target,0,20), pixel(f.target,639,20)]; });
    for (const p of r) assert.deepEqual(p, [25,60,220,255]);
  });
  await check("Background softness blurs scene texture while leaving person sharp", async () => {
    const r = await page.evaluate(() => {
      const f = fixture(), ctx = f.scene.getContext("2d");
      for (let x=0; x<640; x++) { ctx.fillStyle = x%2 ? "white" : "black"; ctx.fillRect(x,0,1,360); }
      MeetingLensVision.process(f.source, f.target, { analysis: { mask: f.mask }, backgroundImage: f.scene, backgroundBlur: 30 });
      const room = pixel(f.target, 50, 100), person = pixel(f.target, 320, 180);
      const corners = [[0,0], [639,0], [0,359], [639,359]].map(([x,y]) => pixel(f.target,x,y));
      return { room, person, corners };
    });
    assert(r.room[0] > 90 && r.room[0] < 165, "Alternating scene pixels become soft gray"); assert.deepEqual(r.person, [30,210,80,255]);
    assert(r.corners.every(p => p[3] === 255 && p[0] > 50), "Blur extends past all frame edges"); return { background: r.room };
  });
  await check("Person confidence alpha blends edges with the selected scene", async () => {
    const r = await page.evaluate(() => { const f = fixture(), ctx = f.mask.getContext("2d"); ctx.clearRect(0,0,640,360); ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(0,0,640,360); MeetingLensVision.process(f.source, f.target, { analysis: { mask: f.mask }, backgroundImage: f.scene }); return pixel(f.target,320,180); });
    for (const [i,expected] of [[0,28],[1,135],[2,150]]) assert(Math.abs(r[i]-expected) <= 2, `Channel ${i} follows mask confidence: ${r}`); assert.equal(r[3],255);
  });
  await check("Conservative matte cleanup reduces room fringe without changing foreground core", async () => {
    const r = await page.evaluate(() => {
      const source=makeCanvas(640,360,"rgb(0,220,0)"), mask=makeCanvas(160,90), target=makeCanvas(), before=makeCanvas();
      const scene=makeCanvas(640,360,"rgb(25,60,220)"), ctx=source.getContext("2d");
      // A deliberately over-wide measured silhouette contains a few room pixels,
      // as happens around hair and shoulders in a low-resolution person matte.
      ctx.fillStyle="rgb(120,90,75)";ctx.fillRect(244,74,152,286);
      mask.getContext("2d").fillStyle="white";mask.getContext("2d").fillRect(60,18,40,72);
      const fg=makeCanvas(), fctx=fg.getContext("2d");fctx.drawImage(source,0,0);fctx.globalCompositeOperation="destination-in";fctx.filter="blur(0.4px)";fctx.drawImage(mask,0,0,640,360);
      before.getContext("2d").drawImage(scene,0,0);before.getContext("2d").drawImage(fg,0,0);
      MeetingLensVision.process(source,target,{analysis:{mask,timestamp:1},backgroundImage:scene});
      const baseline=pixel(before,241,180), cleaned=pixel(target,241,180), core=pixel(target,320,180);
      // Reuse one model canvas with new pixels and a newer timestamp, as the
      // real worker does; cached edge cleanup must not hold an old silhouette.
      mask.getContext("2d").clearRect(0,0,160,90);
      MeetingLensVision.process(source,target,{analysis:{mask,timestamp:2},backgroundImage:scene});
      return {baseline,cleaned,core,afterMaskUpdate:pixel(target,320,180)};
    });
    const baselineLeak=r.baseline[1]-60,cleanedLeak=r.cleaned[1]-60;
    assert(cleanedLeak<baselineLeak*0.7,`Room fringe is reduced: ${JSON.stringify(r)}`);
    assert.deepEqual(r.core,[120,90,75,255],"Foreground core stays byte-for-byte identical");
    assert.deepEqual(r.afterMaskUpdate,[25,60,220,255],"New mask timestamp invalidates derived matte");
    return {fringeReduction:1-cleanedLeak/baselineLeak};
  });
  await check("Unready and malformed scenes safely retain camera output", async () => {
    const r = await page.evaluate(() => {
      const results = [];
      for (const image of [new Image(), { width: 100, height: 100 }, makeCanvas(0,0)]) {
        const f=fixture(); MeetingLensVision.process(f.source,f.target,{analysis:{mask:f.mask},backgroundImage:image}); results.push({room:pixel(f.target,20,20),state:MeetingLensVision.lastComposition});
      }
      return results;
    });
    for (const item of r) { assert.deepEqual(item.room,[190,20,30,255]); assert.equal(item.state.mode,"source"); assert(item.state.reason); }
  });
  await check("Missing person mask safely leaves the real camera image visible", async () => {
    const r = await page.evaluate(() => { const f=fixture(); MeetingLensVision.process(f.source,f.target,{analysis:{},backgroundImage:f.scene}); return {room:pixel(f.target,20,20),state:MeetingLensVision.lastComposition}; });
    assert.deepEqual(r.room,[190,20,30,255]); assert.equal(r.state.reason,"person-mask-not-ready");
  });
  await check("Real bundled model matte replaces background and preserves detected person", async () => {
    const r = await page.evaluate(async () => {
      const portrait=new Image(); portrait.src="/assets/demo/professional-portrait.webp"; await portrait.decode();
      const source=makeCanvas(640,360,"rgb(190,20,30)"); const ctx=source.getContext("2d");
      const scale=Math.min(500/portrait.naturalWidth,360/portrait.naturalHeight); ctx.drawImage(portrait,(640-portrait.naturalWidth*scale)/2,360-portrait.naturalHeight*scale,portrait.naturalWidth*scale,portrait.naturalHeight*scale);
      const caps=await MeetingLensVision.init();
      const analysis=await MeetingLensVision.analyze(source,performance.now(),{face:true,segmentation:true,force:true});
      if (!analysis.mask) return {caps,missingMask:true};
      const target=makeCanvas(), scene=makeCanvas(640,360,"rgb(25,60,220)");
      MeetingLensVision.process(source,target,{analysis,backgroundImage:scene});
      const scaledMask=makeCanvas(); scaledMask.getContext("2d").drawImage(analysis.mask,0,0,640,360);
      const m=scaledMask.getContext("2d").getImageData(0,0,640,360).data;
      const a=source.getContext("2d").getImageData(0,0,640,360).data,b=target.getContext("2d").getImageData(0,0,640,360).data;
      let foreground=0,background=0,personError=0,sceneError=0;
      for (let y=4;y<356;y++) for(let x=4;x<636;x++) {
        const i=(y*640+x)*4;
        if(m[i+3]===255 && [-2,-1,1,2].every(d=>m[i+d*4+3]===255 && m[i+d*640*4+3]===255)) { foreground++; for(let c=0;c<3;c++) personError+=Math.abs(a[i+c]-b[i+c]); }
        if(m[i+3]===0 && [-2,-1,1,2].every(d=>m[i+d*4+3]===0 && m[i+d*640*4+3]===0)) { background++; sceneError+=Math.abs(b[i]-25)+Math.abs(b[i+1]-60)+Math.abs(b[i+2]-220); }
      }
      MeetingLensVision.dispose(); return {caps,foreground,background,personError:personError/(foreground*3),sceneError:sceneError/(background*3)};
    });
    assert(r.caps.segmentation, "Bundled segmentation initializes"); assert(!r.missingMask); assert(r.foreground>1000 && r.background>1000,JSON.stringify(r)); assert(r.personError<1,JSON.stringify(r)); assert(r.sceneError<1,JSON.stringify(r)); return r;
  });
  await check("Compositor produces no uncaught browser errors", async () => { assert.deepEqual(errors,[]); });
}
run().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  fs.mkdirSync(path.join(root,".qa"),{recursive:true});
  fs.writeFileSync(path.join(root,".qa/background-compositor-verification.json"),JSON.stringify({at:new Date().toISOString(),checks:reports},null,2));
  console.log(`${reports.filter(r=>r.pass).length}/${reports.length} compositor checks passed.`);
  if(reports.some(r=>!r.pass)) process.exitCode=1;
});
