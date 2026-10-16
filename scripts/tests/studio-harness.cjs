'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas,Path2D,Image}=require('@napi-rs/canvas');
const {parseHTML,DOMParser}=require('linkedom');
function createApp(){
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),{window,document}=parseHTML(html),canvases=new WeakMap(),contexts=new WeakMap(),downloads=[],messages=[],raf=new Map();let rafId=0;
  const backing=element=>{if(!element||element.localName!=='canvas')return element;let c=canvases.get(element);const w=Number(element.getAttribute('width'))||300,h=Number(element.getAttribute('height'))||150;if(!c){c=createCanvas(w,h);canvases.set(element,c)}if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;return c};
  const proto=window.HTMLCanvasElement.prototype;
  for(const prop of ['width','height'])Object.defineProperty(proto,prop,{configurable:true,get(){return Number(this.getAttribute(prop))||(prop==='width'?300:150)},set(v){this.setAttribute(prop,String(v))}});
  proto.getContext=function(){const canvas=backing(this);if(!contexts.has(canvas)){const ctx=canvas.getContext('2d');contexts.set(canvas,new Proxy(ctx,{get(target,key){if(key==='drawImage')return (source,...args)=>target.drawImage(backing(source),...args);const v=target[key];return typeof v==='function'?v.bind(target):v},set(target,key,v){target[key]=v;return true}}))}return contexts.get(canvas)};
  proto.toDataURL=function(...args){return backing(this).toDataURL(...args)};
  proto.toBlob=function(fn,type){const uri=this.toDataURL(type);fn(new Blob([Buffer.from(uri.split(',')[1],'base64')],{type:type||'image/png'}))};
  proto.getBoundingClientRect=function(){return {left:0,top:0,width:this.width,height:this.height}};
  proto.setPointerCapture=function(){};proto.hasPointerCapture=function(){return false};proto.releasePointerCapture=function(){};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return Array.from(this.options).find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||''},set(value){for(const o of this.options){if(o.value===String(value))o.setAttribute('selected','');else o.removeAttribute('selected')}}});
  class LocalImage extends Image{set src(value){super.src=String(value).startsWith('assets/')?path.join(__dirname,'..',value):value}get src(){return super.src}}
  const context={window,document,DOMParser,navigator:{},Path2D,Image:LocalImage,console,performance,Blob,URL,TextEncoder,Uint8Array,Uint8ClampedArray,ArrayBuffer,DataView,Buffer,atob,AbortController,location:new URL('http://127.0.0.1:8787/'),confirm:()=>true,fetch:()=>{throw new Error('Unexpected network call')},setTimeout(){return 1},clearTimeout(){},requestAnimationFrame(fn){const id=++rafId;raf.set(id,fn);return id},cancelAnimationFrame(id){raf.delete(id)}};
  window.URL=URL;
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','creative-studio.js'),'utf8'),context);
  let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];const exposure=['state','studio','newPaint','newAdjustment','activeLayer','makeCanvas','canvasCtx','capture','restoreSnapshot','pushHistory','undo','redo','activePaint','compose','render','createRectangleSelection','clearSelection','handlePointerDown','handlePointerMove','handlePointerUp','cancelPointer','setTool','drawVectors','drawOverlay','baseStroke','exportSvg','finishPath','addTextObject','updateTextObject'];
  script=script.replace('  init();updateBrushControls();',"  downloadBlob=function(name,blob){globalThis.downloads.push({name,blob})};\n  init();updateBrushControls();");script=script.replace(/\n\}\)\(\);\s*$/,`\n globalThis.app={${exposure.join(',')}};\n})();`);context.downloads=downloads;vm.runInContext(script,context);
  const app=context.app;return {...app,context,document,window,downloads,messages,backing,raf};
}
const ctx=c=>c.getContext('2d');
const pixel=(c,x,y)=>Array.from(ctx(c).getImageData(x,y,1,1).data);
const rect=(canvas,x,y,w,h,color)=>{ctx(canvas).fillStyle=color;ctx(canvas).fillRect(x,y,w,h)};
const event=(x,y,extra={})=>({clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,pressure:.5,detail:1,altKey:false,...extra});
function clean(app){app.studio.resetDocument();app.state.root=[app.newPaint('Test artwork')];app.state.activeId=app.state.root[0].id;app.clearSelection(true);app.state.history=[];app.state.redo=[];app.render();return app.state.root[0]}
module.exports={createApp,ctx,pixel,rect,event,clean};
