'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp,ctx,pixel,rect,event}=require('./studio-harness.cjs');
const app=createApp(),s=app.state,studio=app.studio;
const clickNew=()=>app.document.getElementById('newBtn').click();
const allWhite=()=>assert.ok(ctx(app.compose()).getImageData(0,0,1200,900).data.every(v=>v===255),'Every artwork pixel must be opaque white');

test('New replaces a populated project with white paper, empty paint and a fresh timeline',async()=>{
  rect(app.activePaint().canvas,20,20,100,100,'red');
  app.addTextObject('Previous artwork','ltr',40,'Arial');
  studio.saveFrame();await studio.addFrame(false);
  app.createRectangleSelection({x:10,y:10},{x:80,y:80},false);
  app.document.getElementById('projectName').value='Previous project';
  s.color.bg='#ab1234';
  clickNew();
  assert.equal(s.root.length,2);
  assert.equal(s.root.some(l=>l.role==='sample'),false);
  const paper=s.root.find(l=>l.role==='background');
  assert.equal(paper.lockedPixels,true);assert.equal(paper.lockedPosition,true);
  assert.equal(app.activePaint().name,'Layer 1');assert.equal(app.activePaint().lockedPixels,false);
  assert.ok(ctx(app.activePaint().canvas).getImageData(0,0,1200,900).data.every(v=>v===0));
  allWhite();assert.equal(s.color.bg,'#ffffff');
  assert.equal(s.vector.objects.length,0);assert.equal(s.selection.active,false);
  assert.equal(studio.animation.frames.length,0);assert.equal(studio.process.recording,true);
  assert.equal(studio.process.shots.length,1);assert.equal(s.redo.length,0);
  assert.equal(app.document.getElementById('projectName').value,'Untitled Artwork');
  const project=studio.projectData();assert.equal(project.frames.length,1);
  assert.equal(project.frames[0].document.root.length,2);
});

test('Cancelling New preserves artwork, layers, title, frames and capture history',()=>{
  rect(app.activePaint().canvas,70,70,30,30,'blue');
  app.document.getElementById('projectName').value='Keep this project';
  studio.saveFrame();
  const before=JSON.stringify({document:app.capture(),frames:studio.animation.frames,shots:studio.process.shots,title:app.document.getElementById('projectName').value});
  app.context.confirm=()=>false;
  try{clickNew()}finally{app.context.confirm=()=>true}
  const after=JSON.stringify({document:app.capture(),frames:studio.animation.frames,shots:studio.process.shots,title:app.document.getElementById('projectName').value});
  assert.equal(after,before);
});

test('Drawing and undo work on the new empty layer without restoring the old document',async()=>{
  clickNew();app.setTool('brush');
  app.handlePointerDown(event(200,200));app.handlePointerMove(event(280,200));app.handlePointerUp(event(280,200));
  assert.ok(pixel(app.activePaint().canvas,240,200)[3]>0);
  await app.undo();allWhite();assert.equal(s.root.length,2);
  await app.redo();assert.ok(pixel(app.activePaint().canvas,240,200)[3]>0);
  clickNew();allWhite();await app.undo();allWhite();
});
