/* Optional localhost image-editing bridge. No provider key is sent to the browser.
 * Run with Node.js 22+ from this folder: node ai-bridge.cjs
 * OPENAI_API_KEY belongs in the server environment, never in index.html.
 */
'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const UPSTREAM='https://api.openai.com/v1/images/edits';
const MAX_BODY=14*1024*1024,MAX_RESULT=34*1024*1024;
class BridgeError extends Error{constructor(status,message){super(message);this.status=status}}
function pngInfo(uri,maxBytes=MAX_BODY){
  if(typeof uri!=='string'||uri.length>maxBytes*1.4||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri))throw new BridgeError(400,'An embedded PNG image is required');
  const bytes=Buffer.from(uri.slice(22),'base64');
  if(bytes.length<33||bytes.length>maxBytes||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw new BridgeError(400,'Invalid PNG image');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>4096||height>4096||width*height>9000000)throw new BridgeError(400,'PNG dimensions exceed the safety limit');
  return {width,height};
}
function buildRequest(input,model){
  if(!input||!['fill','remove','upscale'].includes(input.action))throw new BridgeError(400,'Choose fill, remove or upscale');
  const dimensions=pngInfo(input.image);if(dimensions.width!==1200||dimensions.height!==900)throw new BridgeError(400,'This bridge expects a 1200 × 900 Rasmora layer');
  const prompt=typeof input.prompt==='string'?input.prompt.trim():'';if(prompt.length>4000)throw new BridgeError(400,'Prompt limit is 4000 characters');
  const body={model,images:[{image_url:input.image}],n:1,output_format:'png',quality:'medium',size:input.action==='upscale'?'2048x1536':'1536x1152'};
  if(input.action==='fill'){
    if(!prompt)throw new BridgeError(400,'Describe the selected-area edit');const mask=pngInfo(input.mask);if(mask.width!==dimensions.width||mask.height!==dimensions.height)throw new BridgeError(400,'Mask dimensions do not match');
    body.mask={image_url:input.mask};body.prompt='Edit only the transparent area of the supplied mask. Preserve the composition and all unmasked content as closely as possible. Requested edit: '+prompt;
  }else if(input.action==='remove'){
    body.background='transparent';body.prompt='Remove the background and return the foreground subject on a transparent background. Preserve the subject, identity, silhouette, clothing, details, colours, proportions and placement as closely as possible. Do not add objects.';
  }else body.prompt='Enhance this artwork at higher resolution while preserving the entire composition, aspect ratio, subject identity, shapes, lettering, colours and style. Improve clarity without introducing new objects or redesigning details.';
  return body;
}
async function readBody(request,limit){let length=0;const parts=[];for await(const chunk of request){length+=chunk.length;if(length>limit)throw new BridgeError(413,'Request is too large');parts.push(chunk)}return Buffer.concat(parts).toString('utf8')}
async function readResponse(response){const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_RESULT){await reader.cancel();throw new BridgeError(502,'Provider result is too large')}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch(_){throw new BridgeError(502,'Provider returned an invalid response')}}
function createBridge(config={}){
  const token=config.token||randomBytes(24).toString('base64url'),apiKey=config.apiKey||'',model=config.model||'gpt-image-2.5-sunburst',origin=config.origin||'http://127.0.0.1:8787',fetcher=config.fetcher||fetch;
  if(token.length<24||token.length>256||/^sk-/.test(token))throw new Error('Use a separate bridge token of 24–256 characters, never a provider API key');
  const originURL=new URL(origin);if(originURL.origin!==origin||!['http:','https:'].includes(originURL.protocol))throw new Error('RASMORA_ALLOWED_ORIGIN must be one exact HTTP(S) origin, without a trailing slash');
  let active=false,lastRequest=0;const approvedHost=originURL.host;
  const staticFiles={'/':'index.html','/index.html':'index.html','/privacy.html':'privacy.html','/creative-studio.js':'creative-studio.js','/creative-studio.css':'creative-studio.css','/extended-studio.css':'extended-studio.css','/extended-studio.js':'extended-studio.js','/studio3d.bundle.js':'studio3d.bundle.js','/assets/xatlas-web.wasm':'assets/xatlas-web.wasm','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/assets/icon.svg':'assets/icon.svg','/assets/icon-192.png':'assets/icon-192.png','/assets/icon-512.png':'assets/icon-512.png','/assets/icon-maskable-512.png':'assets/icon-maskable-512.png','/assets/aurelia-editorial-sample.png':'assets/aurelia-editorial-sample.png'};
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm'};
  const server=http.createServer(async(req,res)=>{
    const send=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
    try{
      const host=req.headers.host||'';if(![approvedHost,`127.0.0.1:${server.address()?.port}`,`localhost:${server.address()?.port}`].includes(host))throw new BridgeError(403,'Unapproved host');
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname!=='/api/image-edit'){
        if(req.method!=='GET'&&req.method!=='HEAD')throw new BridgeError(405,'Method not allowed');const name=staticFiles[url.pathname];if(!name)throw new BridgeError(404,'Not found');const bytes=await fs.readFile(path.join(__dirname,name));res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Content-Length':bytes.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'none'"});res.end(req.method==='HEAD'?undefined:bytes);return;
      }
      if(req.headers.origin!==origin)throw new BridgeError(403,'Origin not allowed; open the configured Rasmora origin');
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});res.end();return}
      if(req.method!=='POST')throw new BridgeError(405,'POST is required');
      const provided=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);if(provided.length!==expected.length||!timingSafeEqual(provided,expected))throw new BridgeError(401,'Invalid bridge session token');
      if(!apiKey)throw new BridgeError(503,'Set OPENAI_API_KEY in the bridge server environment first');
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new BridgeError(415,'Use application/json');
      if(active||Date.now()-lastRequest<1000)throw new BridgeError(429,'A request is already running, or was sent too recently');
      if(Number(req.headers['content-length'])>MAX_BODY)throw new BridgeError(413,'Request is too large');
      let input;try{input=JSON.parse(await readBody(req,MAX_BODY))}catch(e){if(e instanceof BridgeError)throw e;throw new BridgeError(400,'Invalid request JSON')}
      const body=buildRequest(input,model);if(active||Date.now()-lastRequest<1000)throw new BridgeError(429,'A request is already running, or was sent too recently');active=true;lastRequest=Date.now();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),170000),onClose=()=>{if(!res.writableEnded)controller.abort()};res.on('close',onClose);
      try{
        const response=await fetcher(UPSTREAM,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
        if(!response.ok){await response.body?.cancel();throw new BridgeError(response.status===429?429:502,`Image provider rejected the request (${response.status}). Check model access, billing, policy requirements and server configuration.`)}
        const result=await readResponse(response),encoded=result.data?.[0]?.b64_json;if(typeof encoded!=='string')throw new BridgeError(502,'Provider returned no image');const image='data:image/png;base64,'+encoded;pngInfo(image,MAX_RESULT);send(200,{image,model});
      }catch(e){if(e.name==='AbortError')throw new BridgeError(504,'Image request cancelled or timed out; provider charges may still apply');throw e}finally{clearTimeout(timeout);res.off('close',onClose);active=false}
    }catch(e){send(e instanceof BridgeError?e.status:500,{error:e instanceof BridgeError?e.message:'Bridge failed. No canvas changes were applied.'})}
  });
  server.requestTimeout=180000;server.headersTimeout=15000;return {server,token,origin};
}
if(require.main===module){
  const port=Number((process.env.RASMORA_PORT||process.env.ARTPROOF_PORT)||8787);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a port between 1024 and 65535');
  const bridge=createBridge({apiKey:process.env.OPENAI_API_KEY,token:(process.env.RASMORA_BRIDGE_TOKEN||process.env.ARTPROOF_BRIDGE_TOKEN),model:(process.env.RASMORA_IMAGE_MODEL||process.env.ARTPROOF_IMAGE_MODEL),origin:(process.env.RASMORA_ALLOWED_ORIGIN||process.env.ARTPROOF_ALLOWED_ORIGIN)||`http://127.0.0.1:${port}`});
  bridge.server.listen(port,'127.0.0.1',()=>{console.log(`Rasmora Studio: http://127.0.0.1:${port}\nAllowed browser origin: ${bridge.origin}\nBridge session token (paste in Assist; do not share): ${bridge.token}\nProvider key stays on this server. Requests can incur charges.`);if(!process.env.OPENAI_API_KEY)console.log('Offline tools are ready; AI is disabled until OPENAI_API_KEY is configured.')});
}
module.exports={createBridge,buildRequest,pngInfo};
