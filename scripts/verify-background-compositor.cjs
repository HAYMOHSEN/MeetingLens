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
const checkFilter = process.env.COMPOSITOR_CHECK ? new RegExp(process.env.COMPOSITOR_CHECK, "i") : null;
const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".webp": "image/webp", ".png": "image/png" };
let server, browser, page;
async function check(name, fn) {
  if(checkFilter && !checkFilter.test(name)) return;
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
    // Version 3.1.0's local-minimum matte and final Canvas feather form the
    // comparison baseline. Keep this independent of the production helper so
    // a regression cannot silently move both sides of the edge-width check.
    window.legacyReplace = (source, mask, scene) => {
      const w = source.width, h = source.height, matte = makeCanvas(mask.width, mask.height);
      const mctx = matte.getContext("2d", { willReadFrequently: true }); mctx.drawImage(mask, 0, 0);
      const image = mctx.getImageData(0, 0, matte.width, matte.height), before = new Uint8ClampedArray(image.data);
      for (let y=1; y<matte.height-1; y++) for (let x=1; x<matte.width-1; x++) {
        const i=(y*matte.width+x)*4+3; let minimum=before[i];
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) minimum=Math.min(minimum,before[i+(dy*matte.width+dx)*4]);
        image.data[i]=Math.round(before[i]*0.55+minimum*0.45);
      }
      mctx.putImageData(image,0,0);
      const fg=makeCanvas(w,h), ctx=fg.getContext("2d"); ctx.drawImage(source,0,0);
      ctx.globalCompositeOperation="destination-in";ctx.filter=`blur(${Math.max(0.4,w/1800)}px)`;
      ctx.drawImage(matte,0,0,w,h);ctx.filter="none";
      const out=makeCanvas(w,h);out.getContext("2d").drawImage(scene,0,0,w,h);out.getContext("2d").drawImage(fg,0,0);return out;
    };
    window.rampFixture = () => {
      const source=makeCanvas(640,360,"white"), scene=makeCanvas(640,360,"black"), target=makeCanvas(),mask=makeCanvas(160,90);
      const ctx=mask.getContext("2d"), image=ctx.createImageData(160,90);
      for(let y=0;y<90;y++)for(let x=0;x<160;x++){
        const i=(y*160+x)*4,alpha=Math.round(Math.max(0,Math.min(1,(x-58)/24))*255);
        image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=alpha;
      }
      ctx.putImageData(image,0,0);return{source,scene,target,mask};
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
  await check("Wide confidence ramps become clear edges while keeping a partial transition", async () => {
    const r=await page.evaluate(()=>{
      const f=rampFixture(),before=legacyReplace(f.source,f.mask,f.scene);
      MeetingLensVision.process(f.source,f.target,{analysis:{mask:f.mask,timestamp:11},backgroundImage:f.scene});
      const row=c=>Array.from({length:640},(_,x)=>pixel(c,x,180)[0]);
      const a=row(before),b=row(f.target),width=values=>values.filter(v=>v>25&&v<230).length;
      return{beforeWidth:width(a),afterWidth:width(b),partialPixels:b.filter(v=>v>0&&v<255).length,
        midpoint:b.find(v=>v>=115&&v<=140),monotonic:b.every((v,i)=>!i||v>=b[i-1]-1),
        background:b[150],foreground:b[450],opaque:pixel(f.target,280,180)[3]};
    });
    assert(r.afterWidth<=r.beforeWidth*0.65,`Foggy transition shrinks meaningfully: ${JSON.stringify(r)}`);
    assert(r.afterWidth>=2&&r.partialPixels>=2,"Anti-aliasing remains instead of a binary cutout");
    assert(r.midpoint!==undefined&&r.monotonic,"The edge remains ordered through partial coverage");
    assert.equal(r.background,0);assert.equal(r.foreground,255);assert.equal(r.opaque,255);return r;
  });
  await check("High-confidence clothing detail stays exact and fine partial hair survives", async () => {
    const r=await page.evaluate(()=>{
      const source=makeCanvas(640,360,"white"),scene=makeCanvas(640,360,"black"),target=makeCanvas(),mask=makeCanvas(160,90);
      const sctx=source.getContext("2d"),mctx=mask.getContext("2d");
      mctx.fillStyle="white";mctx.fillRect(50,40,60,50);
      mctx.fillStyle="rgba(255,255,255,0.5)";
      for(const x of[57,62,67,72])mctx.fillRect(x,20,2,22);
      // One-pixel garment texture reveals accidental subject blur immediately.
      for(let y=200;y<320;y++)for(let x=240;x<400;x++){
        sctx.fillStyle=(x+y)%2?"rgb(35,65,100)":"rgb(200,175,145)";sctx.fillRect(x,y,1,1);
      }
      MeetingLensVision.process(source,target,{analysis:{mask,timestamp:12},backgroundImage:scene});
      const a=sctx.getImageData(250,210,140,100).data,b=target.getContext("2d").getImageData(250,210,140,100).data;
      let changed=0,maxError=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;maxError=Math.max(maxError,d);}
      return{changed,maxError,hair:[57,62,67,72].map(x=>pixel(target,x*4+3,120)[0]),gap:pixel(target,240,120)[0]};
    });
    assert.equal(r.changed,0,`Every clothing texture byte stays intact: ${JSON.stringify(r)}`);
    assert(r.hair.every(v=>v>8&&v<247),`Partially covered hair strands retain visible partial coverage: ${JSON.stringify(r)}`);
    assert(r.gap<8,"Gaps between strands still show the selected background");return r;
  });
  await check("Low-resolution diagonal mattes upscale smoothly without staircase jumps", async () => {
    const r=await page.evaluate(()=>{
      const source=makeCanvas(640,360,"white"),scene=makeCanvas(640,360,"black"),target=makeCanvas(),mask=makeCanvas(80,45);
      const mctx=mask.getContext("2d"),image=mctx.createImageData(80,45);
      for(let y=0;y<45;y++)for(let x=0;x<80;x++){
        const i=(y*80+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;
        // The measured confidence is the area coverage of an oblique boundary.
        image.data[i+3]=Math.round(Math.max(0,Math.min(1,(x-y*0.8-18)+0.5))*255);
      }
      mctx.putImageData(image,0,0);
      MeetingLensVision.process(source,target,{analysis:{mask,timestamp:13},backgroundImage:scene});
      const pixels=target.getContext("2d").getImageData(0,0,640,360).data,crossings=[],partials=[];
      let reversals=0;
      for(let y=40;y<320;y++){
        let crossing=-1,partial=0,previous=0;
        for(let x=100;x<550;x++){const v=pixels[(y*640+x)*4];if(v>=128&&crossing<0)crossing=x;if(v>0&&v<255)partial++;if(v<previous-1)reversals++;previous=v;}
        crossings.push(crossing);partials.push(partial);
      }
      return{maxStep:Math.max(...crossings.slice(1).map((x,i)=>Math.abs(x-crossings[i]))),
        rowsWithPartialCoverage:partials.filter(n=>n>=1).length,rows:partials.length,reversals,
        minTransition:Math.min(...partials),maxTransition:Math.max(...partials)};
    });
    assert(r.maxStep<=2,`Subpixel diagonal moves smoothly across adjacent output rows: ${JSON.stringify(r)}`);
    assert.equal(r.rowsWithPartialCoverage,r.rows,"Every interior diagonal row retains anti-aliasing");
    assert.equal(r.reversals,0,"No bright/dark ringing or isolated edge fragments");return r;
  });
  await check("Scene softness never widens or blurs the subject contour", async () => {
    const r=await page.evaluate(()=>{
      const f=rampFixture(),crisp=makeCanvas();
      MeetingLensVision.process(f.source,crisp,{analysis:{mask:f.mask,timestamp:14},backgroundImage:f.scene,backgroundSoftness:0});
      MeetingLensVision.process(f.source,f.target,{analysis:{mask:f.mask,timestamp:14},backgroundImage:f.scene,backgroundSoftness:30});
      const a=crisp.getContext("2d").getImageData(160,80,320,200).data,b=f.target.getContext("2d").getImageData(160,80,320,200).data;
      let changed=0,maxError=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;maxError=Math.max(maxError,d);}
      return{changed,maxError};
    });
    assert.equal(r.changed,0,`Background softness leaves person edge pixels unchanged: ${JSON.stringify(r)}`);return r;
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
      const before=legacyReplace(source,analysis.mask,scene),collage=makeCanvas(1260,780,"#101725"),out=collage.getContext("2d");
      out.fillStyle="#f3f6ff";out.font="bold 26px sans-serif";out.fillText("MeetingLens · person-edge comparison",24,42);
      out.fillStyle="#abb9cf";out.font="16px sans-serif";out.fillText("Controlled camera fixture · generated portrait · same bundled model matte and blue scene",24,70);
      const row=260;let edgeX=440;
      for(let x=638;x>320;x--)if(m[(row*640+x)*4+3]>128){edgeX=x;break;}
      const crop={x:Math.max(0,Math.min(540,edgeX-50)),y:220,width:100,height:100};
      for(const [index,[label,c]]of[["Camera fixture",source],["Before · 3.1.0 matte",before],["After · clearer body edge",target]].entries()){
        const x=20+index*415;
        out.fillStyle="#f3f6ff";out.font="bold 18px sans-serif";out.fillText(label,x,105);
        out.drawImage(c,x,120,400,225);out.strokeStyle="#97d5ff";out.lineWidth=1;
        out.strokeRect(x+crop.x/640*400,120+crop.y/360*225,crop.width/640*400,crop.height/360*225);
        out.drawImage(c,crop.x,crop.y,crop.width,crop.height,x+35,385,330,330);
        out.fillStyle="#abb9cf";out.font="15px sans-serif";out.fillText("Shoulder contour · 3.3× magnification",x+28,745);
      }
      const comparisonPng=collage.toDataURL("image/png").split(",")[1];
      // Report actual renderer cost without imposing a hardware-dependent gate.
      // The first pass allocates buffers; measurements then compare a newly
      // received mask against repeated display frames reusing that same matte.
      const hdSource=makeCanvas(1280,720),hdScene=makeCanvas(1280,720,"rgb(25,60,220)"),hdTarget=makeCanvas(1280,720);
      hdSource.getContext("2d").drawImage(source,0,0,1280,720);
      const render=timestamp=>MeetingLensVision.process(hdSource,hdTarget,{analysis:{...analysis,timestamp},backgroundImage:hdScene});
      render(900);const fresh=[];let stamp=901;
      for(let n=0;n<6;n++,stamp++){const start=performance.now();render(stamp);fresh.push(performance.now()-start);}
      const cached=[];for(let n=0;n<12;n++){const start=performance.now();render(stamp-1);cached.push(performance.now()-start);}
      const summarize=values=>({mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values),runs:values.length});
      const timing1280={newMatteMs:summarize(fresh),cachedMatteMs:summarize(cached)};
      MeetingLensVision.dispose(); return {caps,foreground,background,personError:personError/(foreground*3),sceneError:sceneError/(background*3),timing1280,comparisonPng};
    });
    const comparisonPng=r.comparisonPng;delete r.comparisonPng;
    assert(r.caps.segmentation, "Bundled segmentation initializes"); assert(!r.missingMask); assert(r.foreground>1000 && r.background>1000,JSON.stringify(r)); assert(r.personError<1,JSON.stringify(r)); assert(r.sceneError<1,JSON.stringify(r));
    fs.mkdirSync(path.join(root,".qa"),{recursive:true});
    fs.writeFileSync(path.join(root,".qa/body-edge-comparison.png"),Buffer.from(comparisonPng,"base64"));
    return {...r,comparisonImage:".qa/body-edge-comparison.png"};
  });
  await check("Compositor produces no uncaught browser errors", async () => { assert.deepEqual(errors,[]); });
}
run().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  fs.mkdirSync(path.join(root,".qa"),{recursive:true});
  const reportName=checkFilter?"background-compositor-verification-filtered.json":"background-compositor-verification.json";
  fs.writeFileSync(path.join(root,".qa",reportName),JSON.stringify({at:new Date().toISOString(),checks:reports},null,2));
  console.log(`${reports.filter(r=>r.pass).length}/${reports.length} compositor checks passed.`);
  if(reports.some(r=>!r.pass)) process.exitCode=1;
});
