const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const checks = [];
const html = '<!doctype html><html><body>' + fs.readFileSync(path.join(root, 'docs/SESSION_TOOLS_MARKUP.html'), 'utf8') + '<canvas id="previewCanvas" width="16" height="16"></canvas><script src="/assets/js/session-tools.js"></script><script>window.sessionTest=MeetingLensSessionTools.init({getCanvas:()=>document.getElementById("previewCanvas")});</script></body></html>';
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = path.join(root, req.url);
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/plain'); res.end(data); });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const errors = [];
  async function check(name, run) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    try { await run(page); checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { checks.push({ name, pass: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
    await page.close();
  }

  await check('pending browser backup enable respects a later Off choice', async page => {
    const state = await page.evaluate(async () => {
      const open = sessionTest.openDatabase.bind(sessionTest); let release;
      sessionTest.openDatabase = () => { sessionTest.openDatabase = open; return new Promise(resolve => { release = () => open().then(resolve); }); };
      const pending = sessionTest.enableBrowserBackup(true); sessionTest.turnBackupOff(); release(); await pending;
      return sessionTest.getState().backupMode;
    }); assert.equal(state, 'off');
  });
  await check('pending folder picker respects a later Off choice', async page => {
    const state = await page.evaluate(async () => {
      let release; window.showDirectoryPicker = () => new Promise(resolve => { release = resolve; });
      const pending = sessionTest.chooseFolder(); sessionTest.turnBackupOff(); release({ name: 'Late folder' }); await pending;
      return sessionTest.getState().backupMode;
    }); assert.equal(state, 'off');
  });
  await check('Off then On does not revive snapshots queued before Off', async page => {
    const result = await page.evaluate(async () => {
      await sessionTest.enableBrowserBackup(true); let release;
      sessionTest.backupQueue = new Promise(resolve => { release = resolve; });
      const pending = sessionTest.backupSnapshot(new Blob(['old']), 'cancelled.png');
      sessionTest.turnBackupOff(); await sessionTest.enableBrowserBackup(true); release(); return pending;
    }); assert.equal(result.saved, false);
  });
  await check('delete all cancels queued browser writes before clearing storage', async page => {
    const count = await page.evaluate(async () => {
      await sessionTest.enableBrowserBackup(true); let release;
      sessionTest.backupQueue = new Promise(resolve => { release = resolve; });
      const backup = sessionTest.backupSnapshot(new Blob(['old']), 'queued-before-delete.png');
      await sessionTest.clearBackups(); const clear = sessionTest.clearBackups(); release(); await Promise.all([backup, clear]);
      const db = await sessionTest.openDatabase(); return new Promise(resolve => { const request = db.transaction('images').objectStore('images').count(); request.onsuccess = () => resolve(request.result); });
    }); assert.equal(count, 0);
  });
  await check('old folder failure cannot disable a newly selected browser mode', async page => {
    const state = await page.evaluate(async () => {
      let release; const permission = new Promise(resolve => { release = resolve; });
      sessionTest.backupMode = 'folder'; sessionTest.directory = { name: 'old', queryPermission: () => permission };
      const backup = sessionTest.backupSnapshot(new Blob(['x']), 'old.png'); await Promise.resolve(); await Promise.resolve();
      await sessionTest.enableBrowserBackup(true); release('denied'); await backup; return sessionTest.getState().backupMode;
    }); assert.equal(state, 'browser');
  });
  await check('late errors from an older recording cannot discard the current test', async page => {
    const state = await page.evaluate(() => {
      window.recorders = [];
      window.MediaRecorder = class extends EventTarget { static isTypeSupported() { return true; } constructor() { super(); this.state = 'inactive'; recorders.push(this); } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; } };
      sessionTest.micStream = { getAudioTracks: () => [{ readyState: 'live' }], getTracks: () => [] };
      sessionTest.startRecording(); sessionTest.stopRecording(); sessionTest.startRecording(); recorders[0].dispatchEvent(new Event('error'));
      return sessionTest.getState().recording;
    }); assert.equal(state, true);
  });
  await check('latest fifty retention follows save order when timestamps are identical', async page => {
    const names = await page.evaluate(async () => {
      await sessionTest.enableBrowserBackup(true);
      const db = await sessionTest.openDatabase(); await new Promise((resolve, reject) => { const transaction = db.transaction('images', 'readwrite'); transaction.objectStore('images').clear(); transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      Date.now = () => 1750000000000; let serial = 1000; Object.defineProperty(crypto, 'randomUUID', { value: () => String(serial--).padStart(6, '0') });
      for (let index = 0; index < 52; index++) await sessionTest.backupSnapshot(new Blob(['x']), 'same-time-' + index + '.png');
      return new Promise(resolve => { const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result.map(image => image.filename).sort()); });
    }); assert.deepEqual(names, Array.from({ length: 50 }, (_, index) => 'same-time-' + (index + 2) + '.png').sort());
  });
  await check('a blocked database open closes any connection delivered after rejection', async page => {
    const state = await page.evaluate(async () => {
      let request; window.closes = 0; Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: () => { request = {}; return request; } } });
      const pending = sessionTest.openDatabase().catch(error => error.message); request.onblocked(); await pending;
      request.result = { close: () => closes++ }; request.onsuccess(); return { closes, pending: !!sessionTest.dbPromise };
    }); assert.deepEqual(state, { closes: 1, pending: false });
  });
  await check('database access can retry after a synchronous permissions failure', async page => {
    const state = await page.evaluate(async () => {
      const native = window.indexedDB; let calls = 0;
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: (...args) => { calls++; if (calls === 1) throw new DOMException('blocked', 'SecurityError'); return native.open(...args); } } });
      await sessionTest.openDatabase().catch(() => {}); const success = await sessionTest.openDatabase().then(() => true, () => false);
      return { calls, success };
    }); assert.deepEqual(state, { calls: 2, success: true });
  });
  await check('storage quota failures disable automatic backup and report no saved copy', async page => {
    const state = await page.evaluate(async () => {
      sessionTest.backupMode = 'browser';
      sessionTest.openDatabase = async () => ({ transaction: () => { const transaction = { objectStore: () => ({ getAll: () => ({}), put: () => {}, getAllKeys: () => ({}) }) }; queueMicrotask(() => { transaction.error = new DOMException('full', 'QuotaExceededError'); transaction.onabort(); }); return transaction; } });
      const result = await sessionTest.backupSnapshot(new Blob(['x']), 'quota.png');
      return { saved: result.saved, mode: sessionTest.getState().backupMode, status: document.getElementById('backupStatus').textContent };
    }); assert.equal(state.saved, false); assert.equal(state.mode, 'off'); assert.match(state.status, /storage is full/);
  });
  await check('failed folder writes abort without reporting a saved copy', async page => {
    const state = await page.evaluate(async () => {
      window.aborts = 0; window.closes = 0; sessionTest.backupMode = 'folder';
      sessionTest.directory = { name: 'disk', queryPermission: async () => 'granted', getFileHandle: async (name, options) => { if (!options?.create) throw new DOMException('missing', 'NotFoundError'); return { createWritable: async () => ({ write: async () => { throw new DOMException('full', 'QuotaExceededError'); }, close: async () => closes++, abort: async () => aborts++ }) }; } };
      const result = await sessionTest.backupSnapshot(new Blob(['x']), 'partial.png'); return { saved: result.saved, aborts, closes, mode: sessionTest.getState().backupMode };
    }); assert.deepEqual(state, { saved: false, aborts: 1, closes: 0, mode: 'off' });
  });
  await check('turning Off during a pending folder write aborts before commit', async page => {
    const state = await page.evaluate(async () => {
      let release; window.writeStarted = false; window.aborts = 0; window.closes = 0; sessionTest.backupMode = 'folder';
      sessionTest.directory = { name: 'disk', queryPermission: async () => 'granted', getFileHandle: async (name, options) => { if (!options?.create) throw new DOMException('missing', 'NotFoundError'); return { createWritable: async () => ({ write: () => new Promise(resolve => { window.writeStarted = true; release = resolve; }), close: async () => closes++, abort: async () => aborts++ }) }; } };
      const pending = sessionTest.backupSnapshot(new Blob(['x']), 'interrupted.png'); while (!writeStarted) await new Promise(resolve => setTimeout(resolve, 0));
      sessionTest.turnBackupOff(); release(); const result = await pending; return { saved: result.saved, aborts, closes, mode: sessionTest.getState().backupMode };
    }); assert.deepEqual(state, { saved: false, aborts: 1, closes: 0, mode: 'off' });
  });
  await check('privacy shield prevents pending QR decode and automatic clipboard writes', async page => {
    const state = await page.evaluate(async () => {
      window.copies = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copies.push(text) } });
      let release; window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } detect() { return new Promise(resolve => { release = resolve; }); } };
      document.getElementById('qrAutoCopySwitch').checked = true; const pending = sessionTest.scanQR(); await Promise.resolve(); await Promise.resolve();
      sessionTest.setPrivacyShield(true); release([{ rawValue: 'https://example.test/private' }]); await pending;
      return { copies, value: document.getElementById('qrValue').value, scanning: sessionTest.getState().qrScanning };
    }); assert.deepEqual(state, { copies: [], value: '', scanning: false });
  });
  await check('unsupported QR schemes are copied as text without navigation or execution', async page => {
    const state = await page.evaluate(async () => {
      window.copies = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copies.push(text) } });
      window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return [{ rawValue: 'javascript:window.unexpectedExecution=true' }]; } };
      document.getElementById('qrAutoCopySwitch').checked = true; await sessionTest.scanQR();
      return { copies, executed: !!window.unexpectedExecution, url: location.pathname };
    }); assert.deepEqual(state, { copies: ['javascript:window.unexpectedExecution=true'], executed: false, url: '/' });
  });
  await check('late microphone tracks are stopped after instance destruction', async page => {
    const state = await page.evaluate(async () => {
      let release; window.stops = 0; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
      const pending = sessionTest.startMic(); sessionTest.destroy(); release({ getTracks: () => [{ stop: () => stops++ }] }); await pending;
      return { stops, active: sessionTest.getState().micActive };
    }); assert.deepEqual(state, { stops: 1, active: false });
  });
  checks.push({ name: 'no uncaught browser errors', pass: errors.length === 0, errors });
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true }); fs.writeFileSync(path.join(root, '.qa/shipping-session-checks.json'), JSON.stringify({ testedAt: new Date().toISOString(), environment: 'Headless Chromium; deterministic deferred permissions, recorder callbacks and backup writes; real IndexedDB', checks }, null, 2));
  await context.close(); await browser.close(); server.close();
  if (checks.some(check => !check.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); server.close(); process.exit(1); });
