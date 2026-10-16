// Run: node --test tests/selection-transform.test.cjs
// Development dependency: npm install --no-save @napi-rs/canvas
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, Path2D, Image } = require('@napi-rs/canvas');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const classList = () => ({add(){},remove(){},toggle(){}});
function stub() {
  return { style:{setProperty(){}},classList:classList(),value:'',checked:false,
    innerHTML:'',textContent:'',dataset:{},listeners:{},children:[],
    addEventListener(type,fn){this.listeners[type]=fn},append(...nodes){this.children.push(...nodes)},
    appendChild(node){this.children.push(node)},remove(){},setAttribute(){},focus(){},click(){},matches(){return false} };
}
function canvas(w=1200,h=900) {
  return Object.assign(createCanvas(w,h),stub(),{
    getBoundingClientRect(){return {left:0,top:0,width:w,height:h}},
    setPointerCapture(){},hasPointerCapture(){return false},releasePointerCapture(){}
  });
}
const nodes=new Map();
for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
  const [,tag,attrs,id]=match;
  const node=tag==='canvas'?canvas(id==='colorWheel'?280:1200,id==='colorWheel'?280:900):stub();
  node.id=id;node.checked=/\bchecked\b/.test(attrs);node.value=(attrs.match(/\bvalue="([^"]*)"/)||[])[1]||'';
  nodes.set(id,node);
}
const documentListeners={};
const document={querySelector:s=>nodes.get(s.slice(1))||null,querySelectorAll:()=>[],
  createElement:tag=>tag==='canvas'?canvas():stub(),addEventListener(type,fn){documentListeners[type]=fn},body:stub()};
const exposedFunctions=['state','newPaint','makeCanvas','canvasCtx','point','capture','pushHistory','undo','redo','activePaint','compose','render',
  'createRectangleSelection','createLassoSelection','magicSelection','clearSelection','invertSelection','featherSelection','refreshSelection',
  'startQuickSelection','quickSelectionMove','copySelectionToLayer','selectionOperation','startTransform','transformResult',
  'transformPoint','transformHandles','handleTransformPointer','moveTransformPointer','commitTransform','cancelTransform','resetTransform','syncTransformUI',
  'liquify','directToolStart','directToolMove','directToolEnd','cancelPointer','handlePointerDown','handlePointerMove','handlePointerUp',
  'brushPresetIds','baseStroke','rgbToHsv','hsvToRgb','mixerColour','wetMix'];
let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
script=script.replace('  init();updateBrushControls();updateColourUI();renderCustomBrushes();syncTransformUI();',
  '  globalThis.app={'+exposedFunctions.join(',')+'};');
const context={document,navigator:{},Path2D,Image,console,performance,setTimeout(){return 1},clearTimeout(){},URL,Blob};
vm.runInNewContext(script,context);
const app=context.app, W=1200,H=900;
const ctx=c=>c.getContext('2d');
const pixel=(c,x,y)=>Array.from(ctx(c).getImageData(x,y,1,1).data);
const bytes=c=>require('node:crypto').createHash('sha256').update(ctx(c).getImageData(0,0,c.width,c.height).data).digest('hex');
function reset() {
  const s=app.state;s.transform=null;s.pointer=null;s.stroke=null;s.cursor=null;s.inputPointerId=null;
  s.root=[app.newPaint('Test artwork')];s.activeId=s.root[0].id;s.vector.objects=[];s.history=[];s.redo=[];
  s.selection.operation='replace';s.selection.sampleMerged=false;s.selection.tolerance=32;s.selection.quickSize=80;
  app.clearSelection(true);s.history=[];s.liquify={mode:'push',size:120,strength:.8};return s.root[0];
}
function rect(canvas,x,y,w,h,colour){const c=ctx(canvas);c.fillStyle=colour;c.fillRect(x,y,w,h)}
function mask(x,y){return pixel(app.state.selection.canvas,x,y)[3]}
function event(x,y,extra={}){return {clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,pressure:.5,...extra}}

test('marquee operations: replace, add, subtract, intersect; actual bounds',()=>{
  reset();app.createRectangleSelection({x:10,y:10},{x:30,y:30},false);
  assert.equal(mask(15,15),255);assert.equal(mask(35,15),0);
  app.createRectangleSelection({x:25,y:10},{x:45,y:30},false,'add');assert.equal(mask(40,15),255);
  app.createRectangleSelection({x:15,y:15},{x:20,y:20},false,'subtract');assert.equal(mask(17,17),0);
  app.createRectangleSelection({x:35,y:0},{x:50,y:50},false,'intersect');
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.selection.bounds)),{x:35,y:10,w:10,h:20});
});
test('lasso and elliptical marquee isolate their actual shapes',()=>{
  reset();app.createLassoSelection([{x:100,y:100},{x:200,y:100},{x:100,y:200}]);
  assert.equal(mask(110,110),255);assert.equal(mask(190,190),0);
  app.createRectangleSelection({x:100,y:100},{x:200,y:200},true,'replace');
  assert.equal(mask(150,150),255);assert.equal(mask(101,101),0);assert.ok(app.state.selection.edge);
});
test('magic wand covers a full million-pixel region, clamps edge clicks, and separates disconnected colours',()=>{
  const l=reset();rect(l.canvas,0,0,W,H,'#ff0000');app.magicSelection({x:W,y:H},false);
  assert.equal(app.state.selection.count,W*H);
  rect(l.canvas,400,0,20,H,'#0000ff');app.magicSelection({x:20,y:20},false);
  assert.equal(mask(200,400),255);assert.equal(mask(500,400),0);assert.equal(mask(410,400),0);
  app.magicSelection({x:20,y:20},true);assert.equal(mask(500,400),255);assert.equal(mask(410,400),0);
});
test('magic wand distinguishes transparent pixels from opaque black; sampling can use visible layers',()=>{
  const l=reset();rect(l.canvas,20,20,30,30,'black');app.magicSelection({x:25,y:25},false);
  assert.equal(app.state.selection.count,900);assert.equal(mask(10,10),0);
  const top=app.newPaint('Empty top');app.state.root.unshift(top);app.state.activeId=top.id;app.state.selection.sampleMerged=true;
  app.magicSelection({x:25,y:25},false);assert.equal(app.state.selection.count,900);
});
test('Quick Selection follows colour edges, interpolates strokes, and supports subtract/cancel',()=>{
  const l=reset();rect(l.canvas,0,0,200,H,'red');rect(l.canvas,200,0,1000,H,'blue');
  app.startQuickSelection({x:185,y:150,pointerType:'mouse'},{});assert.equal(mask(195,150),255);assert.equal(mask(205,150),0);
  app.quickSelectionMove({x:185,y:260});assert.equal(mask(185,205),255);assert.equal(mask(210,205),0);app.state.pointer=null;
  app.startQuickSelection({x:185,y:150,pointerType:'mouse'},{altKey:true});assert.equal(mask(185,150),0);
  app.cancelPointer();assert.equal(mask(185,150),255);
});
test('pointer drag captures marquee modifier and avoids accidental commit on cancellation',()=>{
  reset();app.state.tool='selectRect';app.handlePointerDown(event(50,50));app.handlePointerMove(event(90,90));app.handlePointerUp(event(90,90));
  assert.equal(mask(70,70),255);app.handlePointerDown(event(100,50,{shiftKey:true}));app.handlePointerUp(event(130,90,{shiftKey:true}));assert.equal(mask(110,70),255);
  app.handlePointerDown(event(10,10));app.handlePointerMove(event(30,30));app.cancelPointer();assert.equal(mask(110,70),255);assert.equal(mask(20,20),0);
});
test('selected-pixel transform preserves unselected pixels, preview is non-destructive, cancel is exact',()=>{
  const l=reset();rect(l.canvas,100,100,100,100,'red');rect(l.canvas,400,100,100,100,'blue');
  app.createRectangleSelection({x:100,y:100},{x:200,y:200},false);const before=bytes(l.canvas);
  app.startTransform('free');const t=app.state.transform;assert.equal(t.bounds.w,100);
  t.dx=150;t.dirty=true;const preview=app.transformResult(t);assert.equal(pixel(preview,120,120)[3],0);assert.equal(pixel(preview,270,120)[0],255);assert.equal(pixel(preview,420,120)[2],255);
  assert.deepEqual(bytes(l.canvas),before);app.cancelTransform();assert.deepEqual(bytes(l.canvas),before);assert.equal(mask(120,120),255);
});
test('transform apply, selection movement, undo, and redo round-trip exactly',async()=>{
  const l=reset();rect(l.canvas,100,100,100,100,'red');rect(l.canvas,400,100,100,100,'blue');
  app.createRectangleSelection({x:100,y:100},{x:200,y:200},false);const before=bytes(l.canvas);
  app.startTransform('free');app.state.transform.dx=150;app.state.transform.dirty=true;app.commitTransform();
  const after=bytes(app.activePaint().canvas);assert.notDeepEqual(after,before);assert.equal(mask(270,120),255);assert.equal(mask(120,120),0);
  await app.undo();assert.deepEqual(bytes(app.activePaint().canvas),before);assert.equal(mask(120,120),255);
  await app.redo();assert.deepEqual(bytes(app.activePaint().canvas),after);assert.equal(mask(270,120),255);
});
test('free transform has anchored corner scale, rotation, drag-to-move, skew, and nine working warp nodes',()=>{
  const l=reset();rect(l.canvas,100,100,200,200,'#fa4300');app.startTransform('free');let t=app.state.transform;
  app.handleTransformPointer({x:300,y:300},{});app.moveTransformPointer({x:400,y:400},{});t.drag=null;
  assert.equal(t.scaleX,1.5);assert.equal(t.scaleY,1.5);assert.deepEqual(JSON.parse(JSON.stringify(app.transformPoint(t,0,0))),{x:100,y:100});
  app.resetTransform();app.handleTransformPointer({x:200,y:200},{});app.moveTransformPointer({x:230,y:250},{});t.drag=null;assert.equal(t.dx,30);assert.equal(t.dy,50);
  app.resetTransform();const handle=app.transformHandles(t).find(h=>h.kind==='rotate');app.handleTransformPointer(handle.p,{});app.moveTransformPointer({x:350,y:200},{});t.drag=null;assert.ok(Math.abs(t.angle-90)<.001);
  app.resetTransform();app.startTransform('skew');app.handleTransformPointer({x:200,y:100},{});app.moveTransformPointer({x:230,y:100},{});t.drag=null;assert.notEqual(t.skewX,0);
  app.resetTransform();app.startTransform('warp');assert.equal(app.transformHandles(t).filter(h=>h.kind==='node').length,9);
  app.handleTransformPointer({x:200,y:200},{});app.moveTransformPointer({x:220,y:225},{});t.drag=null;assert.equal(t.nodes[4].x,20);assert.equal(t.nodes[4].y,25);assert.deepEqual(JSON.parse(JSON.stringify(app.transformPoint(t,.5,.5))),{x:220,y:225});
  assert.ok(pixel(app.transformResult(t),220,225)[3]>0);
});
test('transform respects layer stacking and opacity, empty layers and locks fail safely',()=>{
  const l=reset();app.startTransform('free');assert.equal(app.state.transform,null);
  rect(l.canvas,0,0,W,H,'red');l.lockedPosition=true;app.startTransform('free');assert.equal(app.state.transform,null);l.lockedPosition=false;
  const top=app.newPaint('Top');rect(top.canvas,0,0,W,H,'blue');app.state.root.unshift(top);app.state.activeId=l.id;
  app.startTransform('free');app.state.transform.dx=30;app.state.transform.dirty=true;assert.deepEqual(pixel(app.compose({previewTransform:true}),500,500),[0,0,255,255]);app.cancelTransform();
  app.state.root=[l];l.opacity=.5;app.startTransform('free');assert.ok(Math.abs(pixel(app.compose({previewTransform:true}),500,500)[3]-128)<=1);
});
test('warp grid has no transparent seams through opaque artwork; reset is pixel-exact',()=>{
  const l=reset();rect(l.canvas,100,100,200,200,'red');const before=bytes(l.canvas);app.startTransform('warp');
  const t=app.state.transform;t.nodes[4]={x:20,y:25};t.dirty=true;const d=ctx(app.transformResult(t)).getImageData(110,110,180,180).data;
  for(let i=3;i<d.length;i+=4)assert.equal(d[i],255);
  app.resetTransform();assert.equal(bytes(app.transformResult(t)),before);
});
test('selection feather, invert and no-op transform retain usable masks',async()=>{
  const l=reset();rect(l.canvas,100,100,100,100,'red');app.createRectangleSelection({x:110,y:110},{x:190,y:190},false);app.state.selection.feather=4;app.featherSelection(false);
  assert.ok(mask(109,150)>0&&mask(109,150)<255);const original=bytes(l.canvas);app.startTransform('free');app.commitTransform();assert.equal(bytes(l.canvas),original);
  const selected=mask(150,150);app.invertSelection();assert.equal(mask(150,150),255-selected);await app.undo();assert.equal(mask(150,150),selected);
});
test('liquify changes selected pixels only and handles all four modes at canvas borders',()=>{
  const l=reset(),c=ctx(l.canvas);for(let x=0;x<W;x++){c.fillStyle=`rgb(${x%256},${(x*3)%256},${(x*7)%256})`;c.fillRect(x,0,1,H)}
  app.createRectangleSelection({x:100,y:100},{x:180,y:200},false);const before=ctx(l.canvas).getImageData(0,0,W,H).data;
  app.liquify(l,{x:160,y:150},{x:175,y:150,pointerType:'mouse'});const after=ctx(l.canvas).getImageData(0,0,W,H).data;let changed=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(x>=100&&x<180&&y>=100&&y<200){if(after[i]!==before[i])changed++}else assert.equal(after[i],before[i])}assert.ok(changed>0);
  app.clearSelection(true);for(const mode of ['push','expand','pinch','twirl']){const prior=bytes(l.canvas);app.state.liquify.mode=mode;app.liquify(l,{x:0,y:0},{x:4,y:4,pointerType:'mouse'});app.liquify(l,{x:W-2,y:H-2},{x:W,y:H,pointerType:'mouse'});assert.notEqual(bytes(l.canvas),prior,mode+' must deform pixels')}
});
test('one liquify stroke undoes/redoes and pointer cancellation restores pixels',async()=>{
  const l=reset();rect(l.canvas,100,100,30,100,'red');const before=bytes(l.canvas);
  app.directToolStart('liquify',{x:120,y:150,pointerType:'mouse'},{});app.directToolMove({x:145,y:150,pointerType:'mouse'});app.directToolEnd();const after=bytes(l.canvas);assert.notDeepEqual(before,after);
  await app.undo();assert.deepEqual(bytes(app.activePaint().canvas),before);await app.redo();assert.deepEqual(bytes(app.activePaint().canvas),after);
  app.directToolStart('liquify',{x:120,y:150,pointerType:'mouse'},{});app.directToolMove({x:150,y:170,pointerType:'mouse'});app.cancelPointer();assert.deepEqual(bytes(app.activePaint().canvas),after);
});
test('copy selection isolates pixels onto a new layer without changing the source',()=>{
  const l=reset();rect(l.canvas,50,50,150,100,'red');app.createRectangleSelection({x:60,y:60},{x:100,y:100},false);const original=bytes(l.canvas);
  app.copySelectionToLayer();assert.equal(app.state.root.length,2);assert.equal(pixel(app.activePaint().canvas,70,70)[3],255);assert.equal(pixel(app.activePaint().canvas,150,70)[3],0);assert.deepEqual(bytes(l.canvas),original);
});
test('transform sliders work on empty and painted layers; Escape cancels without clearing the selection',()=>{
  const l=reset(),input=nodes.get('rotateAngle');input.value='25';assert.doesNotThrow(()=>input.listeners.input.call(input));assert.equal(app.state.transform,null);
  rect(l.canvas,50,50,200,200,'red');app.createRectangleSelection({x:80,y:80},{x:180,y:180},false);input.value='25';input.listeners.input.call(input);assert.equal(app.state.transform.angle,25);assert.equal(nodes.get('rotateOut').textContent,'25°');
  const skew=nodes.get('skewX');skew.value='15';skew.listeners.input.call(skew);assert.equal(app.state.transform.skewX,15);
  const warp=nodes.get('warpAmount');warp.value='35';warp.listeners.input.call(warp);assert.equal(app.state.transform.warp,35);assert.equal(nodes.get('warpOut').textContent,'35 px');
  documentListeners.keydown({key:'Escape',target:stub(),preventDefault(){}});assert.equal(app.state.transform,null);assert.equal(mask(100,100),255);
});
test('existing Brush Studio and Colour Studio still produce paint and colour conversions',()=>{
  const l=reset();assert.equal(app.brushPresetIds.length,16);for(const preset of app.brushPresetIds){app.state.brush.preset=preset;app.baseStroke(ctx(l.canvas),{x:100,y:100},{x:150,y:140},{pressure:.7,tiltX:15,tiltY:10,twist:20,velocity:.5},false)}
  assert.ok(ctx(l.canvas).getImageData(75,75,120,120).data.some((v,i)=>i%4===3&&v>0));
  assert.equal(app.rgbToHsv(255,0,0).h,0);assert.equal(app.hsvToRgb(120,100,100).g,255);assert.match(app.mixerColour(),/^#[\da-f]{6}$/i);
  app.wetMix(l,{x:200,y:200},{x:220,y:220,pressure:.7},{});assert.ok(pixel(l.canvas,215,215)[3]>0);
});
test('full application script initializes with the bundled professional sample',async()=>{
  const startup=html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace("sampleImage.src='assets/aurelia-editorial-sample.png';",'sampleImage.src='+JSON.stringify(path.join(__dirname,'..','assets','aurelia-editorial-sample.png'))+';')
    .replace('  init();updateBrushControls();updateColourUI();renderCustomBrushes();syncTransformUI();','  globalThis.startupState=state;init();updateBrushControls();updateColourUI();renderCustomBrushes();syncTransformUI();');
  const startupContext={...context};assert.doesNotThrow(()=>vm.runInNewContext(startup,startupContext));
  for(let i=0;i<100&&!startupContext.startupState.activity.some(a=>a.label==='Editorial starter sample loaded');i++)await new Promise(resolve=>setTimeout(resolve,20));
  const s=startupContext.startupState;assert.equal(s.root.length,3);assert.ok(s.activity.some(a=>a.label==='Editorial starter sample loaded'));assert.equal(pixel(s.root[1].canvas,600,450)[3],255);
});
