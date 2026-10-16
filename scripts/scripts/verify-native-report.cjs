const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const reports = [];
const pass = name => { reports.push({ name, passed: true }); console.log('PASS ' + name); };
const report = {
  schema: 'meetinglens.windows.capabilities.v1', generatedAt: '2026-10-16T12:00:00Z', platform: 'Windows', source: 'MeetingLens.Windows', osVersion: 'Windows 11', device: { name: 'USB Camera', idHash: 'ABCDEF0123456789' },
  effects: [
    { id: 'backgroundBlur', label: 'Background blur', supported: true, flags: 1, capabilities: 5, modes: ['Off', 'Standard blur', 'Portrait blur'], error: null },
    { id: 'eyeContact', label: 'Eye contact', supported: false, flags: null, capabilities: null, modes: [], error: 'NotSupported' }
  ],
  autoFraming: { supported: true, currentMode: 'Auto' }, voiceFocus: { status: 'windows-settings', controlledByCompanion: false }, npu: { status: 'managed-by-windows', appSelectsExecutionProvider: false }, virtualCamera: { status: 'source-reference-not-integrated', routesPwaCanvas: false },
  formats: [{ width: 1920, height: 1080, numerator: 30000, denominator: 1001, subtype: 'NV12' }], notes: ['Snapshot only, not live control.']
};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } const ext = path.extname(file); res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[ext] || 'text/plain'); res.end(data); });
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(); const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.reportCameraRequests = 0; navigator.mediaDevices.getUserMedia = async () => { window.reportCameraRequests++; throw new Error('Unexpected capture request'); }; window.reportInjected = false; });
  await page.goto('http://127.0.0.1:' + server.address().port + '/native-capabilities.html');
  assert.equal(await page.locator('#nativeReport').isHidden(), true); assert.equal(await page.evaluate(() => reportCameraRequests), 0); pass('report viewer starts without camera/microphone access or imported data');
  const upload = async (value, name = 'capabilities.json') => { await page.locator('#nativeReportInput').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) }); };
  await upload(report); await page.waitForFunction(() => !document.getElementById('nativeReport').hidden); assert.equal(await page.locator('#nativeDeviceName').textContent(), 'USB Camera'); assert.equal(await page.locator('.native-effect').count(), 6); assert.match(await page.locator('#nativeFormatsList').textContent(), /29\.97 fps/); assert.match(await page.locator('#nativeReportMetadata').textContent(), /snapshot, not a live connection/); pass('real native v1 schema renders capabilities, rational FPS, and snapshot scope');
  assert.equal(await page.locator('#nativeDuplicateWarning').isHidden(), false); assert.match(await page.locator('#nativeDuplicateWarning').textContent(), /Windows background blur was active/); pass('active system blur snapshot shows duplicate-effect guidance');
  const wideFlags = structuredClone(report); wideFlags.device.name = 'Exact 64-bit fixture'; wideFlags.effects[0].flags = '9223372036854775809'; wideFlags.effects[0].capabilities = '18446744073709551615';
  await upload(wideFlags); await page.waitForFunction(() => document.getElementById('nativeDeviceName').textContent === 'Exact 64-bit fixture');
  assert.match(await page.locator('#nativeEffects').textContent(), /9223372036854775809/); assert.match(await page.locator('#nativeEffects').textContent(), /18446744073709551615/); assert.equal(await page.locator('#nativeDuplicateWarning').isHidden(), false); pass('native decimal-string 64-bit flags remain exact and preserve the blur warning');
  const hostile = structuredClone(report); hostile.device.name = '<img src=x onerror="window.reportInjected=true">'; hostile.effects[0].label = '<script>window.reportInjected=true</script>'; hostile.notes.push('<svg onload="window.reportInjected=true"></svg>');
  await upload(hostile); await page.waitForFunction(() => document.getElementById('nativeDeviceName').textContent.startsWith('<img')); assert.equal(await page.locator('#nativeReport img,#nativeReport script,#nativeReport svg').count(), 0); assert.equal(await page.evaluate(() => reportInjected), false); pass('untrusted report strings render as text without HTML execution');
  await upload('{'); await page.waitForFunction(() => document.getElementById('nativeReportStatus').classList.contains('error')); assert.equal(await page.locator('#nativeReport').isHidden(), false); assert.match(await page.locator('#nativeReportStatus').textContent(), /not valid JSON/); pass('malformed JSON reports a useful error and preserves the previous report');
  await upload(' '.repeat(1024 * 1024 + 1)); await page.waitForFunction(() => document.getElementById('nativeReportStatus').textContent.includes('1 MB')); pass('files over 1 MB are rejected before parsing');
  await upload({ schema: 'other', effects: [] }); await page.waitForFunction(() => document.getElementById('nativeReportStatus').textContent.includes('supported v1 schema')); const invalid = structuredClone(report); invalid.effects[0].supported = 'yes'; await upload(invalid); await page.waitForFunction(() => document.getElementById('nativeReportStatus').textContent.includes('invalid effect')); pass('unsupported schemas and malformed effect records are rejected');
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); await page.click('#nativeClearReport'); assert.equal(await page.locator('#nativeReport').isHidden(), true); assert.equal(await page.locator('.native-effect').count(), 0); assert.equal(await page.evaluate(() => reportCameraRequests), 0); assert.deepEqual(errors, []); pass('narrow layout, explicit clearing, and no unhandled browser or capture requests');
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true }); fs.writeFileSync(path.join(root, '.qa/native-report-verification.json'), JSON.stringify({ testedAt: new Date().toISOString(), environment: 'Headless Chromium; local fixture reports; no physical Windows devices', checks: reports }, null, 2));
  console.log(`${reports.length}/${reports.length} native-report checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
