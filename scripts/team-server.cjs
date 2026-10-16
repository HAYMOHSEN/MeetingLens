'use strict';
// Optional private team service. Store its data directory on durable storage when hosting.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const LIMIT=30*1024*1024;
function createTeamServer({token=randomBytes(24).toString('base64url'),origin='http://127.0.0.1:8787',dataDir=path.join(__dirname,'team-data')}={}){
 if(token.length<24||token.length>256)throw Error('Use a separate team token of 24–256 characters.');
 if(new URL(origin).origin!==origin)throw Error('Use one exact allowed origin.');
 const locks=new Map();const fault=(code,message)=>Object.assign(Error(message),{code});
 async function read(room){try{return JSON.parse(await fs.readFile(path.join(dataDir,room+'.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return {revision:0,project:null,comments:[],updated:null};throw e}}
 async function update(room,fn){const previous=locks.get(room)||Promise.resolve();let release;const lock=new Promise(r=>release=r);locks.set(room,lock);await previous;try{const data=await read(room),result=await fn(data);await fs.mkdir(dataDir,{recursive:true,mode:0o700});const target=path.join(dataDir,room+'.json'),tmp=target+'.'+randomBytes(8).toString('hex')+'.tmp';await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600});await fs.rename(tmp,target);return result}finally{release();if(locks.get(room)===lock)locks.delete(room)}}
 const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  try{const providedOrigin=req.headers.origin;if(providedOrigin&&providedOrigin!==origin)throw fault(403,'Origin not allowed.');if(providedOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type'});res.end();return}
   const incoming=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);if(incoming.length!==expected.length||!timingSafeEqual(incoming,expected))throw fault(401,'Invalid team access token.');
   const url=new URL(req.url,'http://localhost'),match=url.pathname.match(/^\/api\/rooms\/([a-zA-Z0-9_-]{1,48})$/);if(!match)throw fault(404,'Unknown room endpoint.');const room=match[1];
   if(req.method==='GET'){const data=await read(room);if(url.searchParams.has('metadata'))delete data.project;send(200,data);return}
   if(req.method!=='POST')throw fault(405,'Use GET or POST.');if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fault(415,'Use JSON.');let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>LIMIT)throw fault(413,'Shared project limit is 30 MB. Save larger projects locally.');chunks.push(chunk)}let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fault(400,'Invalid JSON.')}if(!body||typeof body!=='object')throw fault(400,'Invalid request.');
   const result=await update(room,data=>{
    if(body.action==='join')return {revision:data.revision};
    if(body.action==='save'){if(!Number.isInteger(body.baseRevision)||body.baseRevision!==data.revision)throw fault(409,'Revision conflict. Save a local backup, then open the latest shared revision before publishing.');const p=body.project;if(!p||!['Rasmora Studio','ArtProof Studio'].includes(p.app)||p.version!==4||p.width!==1200||p.height!==900||!Array.isArray(p.frames)||p.frames.length<1||p.frames.length>48)throw fault(400,'Invalid Rasmora project.');data.project=p;data.revision++;data.updated=new Date().toISOString();return {revision:data.revision}}
    if(body.action==='comment'){if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)throw fault(400,'Feedback must contain 1–2000 characters.');if(data.comments.length>=500)throw fault(409,'This room has reached its 500-comment limit. Start a new room.');data.comments.push({id:randomBytes(10).toString('hex'),author:String(body.author||'Artist').slice(0,60),text:body.text.trim(),revision:data.revision,resolved:false,created:new Date().toISOString()});return {ok:true}}
    if(body.action==='resolve'){const comment=data.comments.find(c=>c.id===body.id);if(!comment)throw fault(404,'Comment not found.');comment.resolved=true;return {ok:true}}
    throw fault(400,'Unknown team action.');
   });send(200,result);
  }catch(e){send(typeof e.code==='number'?e.code:500,{error:typeof e.code==='number'?e.message:'Team storage is unavailable. The shared revision was not changed.'})}
 });server.requestTimeout=30000;server.headersTimeout=15000;return {server,token};
}
if(require.main===module){const port=Number((process.env.RASMORA_TEAM_PORT||process.env.ARTPROOF_TEAM_PORT)||8790),host=(process.env.RASMORA_TEAM_HOST||process.env.ARTPROOF_TEAM_HOST)||'127.0.0.1';if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Use a port between 1024 and 65535.');const service=createTeamServer({token:(process.env.RASMORA_TEAM_TOKEN||process.env.ARTPROOF_TEAM_TOKEN),origin:(process.env.RASMORA_ALLOWED_ORIGIN||process.env.ARTPROOF_ALLOWED_ORIGIN)||'http://127.0.0.1:8787',dataDir:(process.env.RASMORA_TEAM_DATA_DIR||process.env.ARTPROOF_TEAM_DATA_DIR)});service.server.listen(port,host,()=>console.log(`Rasmora Team: http://${host}:${port}\nTeam access token: ${service.token}\nShare the token only with trusted team members. Configure HTTPS and durable storage before remote use.`))}
module.exports={createTeamServer};
