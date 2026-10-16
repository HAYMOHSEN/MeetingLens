const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const reports = [];
const pass = name => { reports.push({ name, pass: true }); console.log('PASS ' + name); };
// Deterministic QR fixture for https://meetinglens.example/qr-test, with no network dependency.
const qrFixtureRows = ["11111110100001101010001111111","10000010100111110011101000001","10111010110010100110001011101","10111010111010001011101011101","10111010011010000110001011101","10000010111000000001001000001","11111110101010101010101111111","00000000001101010110100000000","11001110001011001101100101111","10010101100001111000001111111","01111111011000010100010100001","11011101010010101101101001011","00100110000101101100110100010","01001101101010011110101111111","10011011001111110110100001101","11000101101101010101010000011","00011011010011000101010000010","11101000110001111010001111011","00111110101000011110001000101","00110100110010110111100000011","11011010111101101110111111001","00000000111010011111100010001","11111110001111110011101011101","10000010100101010111100010000","10111010101011010101111111000","10111010011001110000110000001","10111010001000011101010001111","10000010101010101110100001011","11111110110101101100100101010"];
const html = '<!doctype html><html><body>'+fs.readFileSync(root+'/docs/SESSION_TOOLS_MARKUP.html','utf8')+'<canvas id="previewCanvas" width="400" height="400"></canvas><script src="/assets/js/session-tools.js"></script><script>window.sessionTest=MeetingLensSessionTools.init({getCanvas:()=>document.getElementById("previewCanvas")});</script></body></html>';
const server = http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file = path.join(root,req.url);
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/plain');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({permissions:['microphone','clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.gumCalls=0;const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...args)=>{window.gumCalls++;return native(...args);};});
 await page.goto(base);assert.equal(await page.evaluate(()=>gumCalls),0);pass('no microphone request before explicit start');
 await page.click('#voiceStartButton');await page.waitForFunction(()=>sessionTest.getState().micActive);assert.equal(await page.evaluate(()=>gumCalls),1);pass('explicit microphone activation');
 await page.click('#voiceMuteButton');assert.equal(await page.evaluate(()=>sessionTest.getState().micMuted),true);await page.click('#voiceMuteButton');
 await page.click('#voiceRecordButton');await page.waitForTimeout(900);await page.click('#voiceRecordStopButton');await page.waitForFunction(()=>!document.getElementById('voicePlaybackWrap').hidden);assert.match(await page.locator('#voiceDownloadLink').getAttribute('href'),/^blob:/);pass('real local recording produces playable/downloadable blob');
 await page.evaluate(()=>sessionTest.setPrivacyShield(true));assert.equal(await page.evaluate(()=>sessionTest.getState().micActive),false);assert.equal(await page.locator('#voicePlaybackWrap').isHidden(),true);assert.equal(await page.locator('#voiceStartButton').isDisabled(),true);pass('privacy shield releases mic and discards test');
 await page.evaluate(()=>sessionTest.setPrivacyShield(false));
 await page.evaluate(()=>{window.resolveMic=null;window.fakeStopped=0;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.resolveMic=r);});
 await page.click('#voiceStartButton');await page.waitForFunction(()=>sessionTest.getState().micPending);await page.click('#voiceStopButton');await page.evaluate(()=>resolveMic({getTracks:()=>[{stop:()=>window.fakeStopped++}]}));await page.waitForFunction(()=>fakeStopped===1);assert.equal(await page.evaluate(()=>sessionTest.getState().micActive),false);pass('cancelled permission race stops late microphone track');
 await page.check('#backupLocalSwitch');await page.waitForFunction(()=>sessionTest.getState().backupMode==='browser');
 await page.evaluate(async()=>{const c=document.getElementById('previewCanvas');const g=c.getContext('2d');g.fillStyle='#b8a5d2';g.fillRect(0,0,400,400);const blob=await new Promise(r=>c.toBlob(r));window.backupResults=[];for(let i=0;i<52;i++)backupResults.push(await sessionTest.backupSnapshot(blob,'still-'+i+'.png'));});
 assert.equal(await page.locator('.session-backup-item').count(),50);assert.equal(await page.evaluate(()=>backupResults.every(x=>x.saved)),true);pass('opted-in snapshot backup and latest 50 retention');
 await page.locator('.session-backup-item .session-text-link').last().click();await page.waitForFunction(()=>document.querySelectorAll('.session-backup-item').length===49);pass('single stored backup deletion');
 await page.click('#backupClearButton');assert.equal(await page.locator('.session-backup-item').count(),49);await page.click('#backupClearButton');await page.waitForFunction(()=>document.querySelectorAll('.session-backup-item').length===0);pass('delete-all requires explicit confirmation');
 await page.evaluate(rows=>{const canvas=document.getElementById('previewCanvas');canvas.width=370;canvas.height=370;const g=canvas.getContext('2d');g.fillStyle='white';g.fillRect(0,0,370,370);g.fillStyle='black';rows.forEach((row,y)=>[...row].forEach((on,x)=>{if(on==='1')g.fillRect((x+4)*10,(y+4)*10,10,10);}));window.BarcodeDetector=undefined;},qrFixtureRows);await page.click('#qrScanButton');await page.waitForFunction(()=>document.getElementById('qrValue').value==='https://meetinglens.example/qr-test');pass('actual QR image decodes with local jsQR fallback');
 await page.click('#qrCopyButton');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://meetinglens.example/qr-test');pass('decoded QR copies only on explicit copy');
 await page.evaluate(async()=>{window.folderWrites=0;sessionTest.backupMode='folder';sessionTest.directory={name:'test-folder',queryPermission:async()=> 'granted',getFileHandle:async(name,options)=>{if(!options?.create)throw new DOMException('missing','NotFoundError');return{createWritable:async()=>({write:async blob=>{if(blob.size)folderWrites++;},close:async()=>{},abort:async()=>{}})}}};window.folderResult=await sessionTest.backupSnapshot(new Blob(['test'],{type:'image/png'}),'test.png');});assert.equal(await page.evaluate(()=>folderWrites),1);assert.equal(await page.evaluate(()=>folderResult.saved),true);pass('folder backup writes and confirms success through simulated directory API');
 await page.evaluate(async()=>{sessionTest.directory={name:'revoked',queryPermission:async()=> 'denied'};window.revokedResult=await sessionTest.backupSnapshot(new Blob(['test'],{type:'image/png'}),'test.png');});assert.equal(await page.evaluate(()=>revokedResult.saved),false);assert.equal(await page.evaluate(()=>sessionTest.getState().backupMode),'off');pass('revoked folder permission turns backup off safely');
 assert.deepEqual(errors,[]);pass('no unhandled browser errors');
 fs.mkdirSync(path.join(root,'.qa'),{recursive:true});fs.writeFileSync(path.join(root,'.qa','session-checks.json'),JSON.stringify({testedAt:new Date().toISOString(),environment:'Headless Chromium with synthetic microphone; simulated folder API; real IndexedDB and jsQR fixture decoding',checks:reports},null,2));
 await context.close();await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1);});
