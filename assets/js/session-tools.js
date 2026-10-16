/* MeetingLens local session utilities. No microphone, recording, QR scan or backup starts automatically. */
(() => {
  'use strict';
  const scriptURL = document.currentScript?.src || new URL('./assets/js/session-tools.js', location.href).href;
  const QR_FALLBACK_URL = new URL('../vendor/jsqr/jsQR.js', scriptURL).href;
  const MAX_BACKUPS = 50;
  const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
  let qrLoader;

  function stopTracks(stream) { stream?.getTracks().forEach(track => { try { track.stop(); } catch (_) {} }); }
  function errorText(error, kind) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return `${kind} permission was not granted. Check your browser permissions and try again.`;
    if (error?.name === 'NotFoundError') return `${kind} is not available on this device.`;
    if (error?.name === 'NotReadableError') return `${kind} is busy or could not be read. Close other apps using it and try again.`;
    if (error?.name === 'QuotaExceededError') return 'Browser storage is full. Download or delete older backups, then try again.';
    return `${kind} could not be used. ${error?.message || 'Please try again.'}`;
  }
  function safeName(filename) {
    const name = String(filename || `meetinglens-${Date.now()}.png`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').slice(0, 150);
    return name || `meetinglens-${Date.now()}.png`;
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = safeName(filename); link.hidden = true;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Storage operation was interrupted.')); }); }
  function loadQrFallback() {
    if (typeof window.jsQR === 'function') return Promise.resolve(window.jsQR);
    if (!qrLoader) qrLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script'); let settled = false;
      const finish = (err) => { if (settled) return; settled = true; clearTimeout(timer); script.onload = script.onerror = null; if (err) { script.remove(); qrLoader = null; reject(err); } else resolve(window.jsQR); };
      const timer = setTimeout(() => finish(new Error('The local QR reader did not load. Reload the app and try again.')), 15000);
      script.src = QR_FALLBACK_URL; script.async = true;
      script.onload = () => finish(typeof window.jsQR === 'function' ? null : new Error('The local QR reader is unavailable.'));
      script.onerror = () => finish(new Error('The local QR reader is unavailable. Reload the app and try again.'));
      document.head.append(script);
    });
    return qrLoader;
  }

  class SessionTools {
    constructor(options = {}) {
      this.getCanvas = typeof options.getCanvas === 'function' ? options.getCanvas : () => document.getElementById('previewCanvas');
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
      this.listeners = []; this.micStream = null; this.micToken = 0; this.micPending = false; this.micMuted = false;
      this.audioContext = null; this.meterFrame = 0; this.recorder = null; this.recordingSession = 0; this.recordingTimer = 0;
      this.clipUrl = ''; this.backupMode = 'off'; this.directory = null; this.backupUrls = []; this.backupQueue = Promise.resolve(); this.backupGeneration = 0; this.backupPending = '';
      this.qrValue = ''; this.lastCopiedQR = ''; this.qrToken = 0; this.scanning = false; this.shield = false; this.destroyed = false; this.dbPromise = null;
      this.bind(); this.render();
    }
    element(id) { return document.getElementById(id); }
    listen(target, event, fn) { if (!target) return; target.addEventListener(event, fn); this.listeners.push([target, event, fn]); }
    status(id, message, level = 'info', notify = false) {
      const element = this.element(id); if (element) { element.textContent = message; element.dataset.level = level; }
      if (notify) { try { this.onStatus(message, level); } catch (_) {} }
    }
    bind() {
      const click = (id, action) => this.listen(this.element(id), 'click', () => { Promise.resolve().then(action).catch(error => this.status('voiceStatus', errorText(error, 'The operation'), 'error')); });
      click('voiceStartButton', () => this.startMic()); click('voiceStopButton', () => this.stopMic());
      click('voiceMuteButton', () => this.toggleMute()); click('voiceRecordButton', () => this.startRecording());
      click('voiceRecordStopButton', () => this.stopRecording()); click('voiceDiscardButton', () => this.clearClip());
      click('qrScanButton', () => this.scanQR()); click('qrCopyButton', () => this.copyQR(false));
      click('backupFolderButton', () => this.chooseFolder()); click('backupOffButton', () => this.turnBackupOff());
      click('backupRefreshButton', () => this.refreshBackups()); click('backupClearButton', () => this.clearBackups());
      this.listen(this.element('backupLocalSwitch'), 'change', event => this.enableBrowserBackup(event.target.checked));
      this.listen(document, 'visibilitychange', () => { if (document.hidden) this.stopPrivateResources('Microphone stopped because the app was hidden.'); });
      this.listen(window, 'pagehide', () => this.stopPrivateResources('Microphone stopped.'));
    }
    render() {
      const active = !!this.micStream?.getAudioTracks().some(track => track.readyState === 'live');
      const recording = this.recorder?.state === 'recording';
      const setDisabled = (id, disabled) => { const element = this.element(id); if (element) element.disabled = disabled; };
      setDisabled('voiceStartButton', this.shield || this.micPending || active);
      setDisabled('voiceStopButton', !active && !this.micPending);
      setDisabled('voiceMuteButton', !active); setDisabled('voiceRecordButton', !active || recording || typeof MediaRecorder === 'undefined');
      setDisabled('voiceRecordStopButton', !recording);
      const start = this.element('voiceStartButton'); if (start) start.textContent = this.micPending ? 'Waiting for permission…' : 'Start mic';
      const mute = this.element('voiceMuteButton'); if (mute) { mute.textContent = this.micMuted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed', String(this.micMuted)); }
      setDisabled('qrScanButton', this.scanning || this.shield); setDisabled('qrCopyButton', !this.qrValue || this.shield);
      setDisabled('backupOffButton', this.backupMode === 'off' && !this.backupPending);
      const local = this.element('backupLocalSwitch'); if (local) local.checked = this.backupMode === 'browser' || this.backupPending === 'browser';
      const tag = this.element('backupModeTag'); if (tag) tag.textContent = this.backupMode === 'folder' ? 'FOLDER' : this.backupMode === 'browser' ? 'BROWSER' : 'OFF';
      const folder = this.element('backupFolderButton'); if (folder) { folder.disabled = !window.isSecureContext || typeof window.showDirectoryPicker !== 'function'; folder.title = folder.disabled ? 'Folder backup requires a supported browser such as Edge and a secure HTTPS connection. Browser backups are available below.' : ''; }
      if (!active) { const meter = this.element('voiceMeter'); if (meter) meter.value = 0; const level = this.element('voiceLevelLabel'); if (level) level.textContent = 'Mic off'; }
    }
    async startMic() {
      if (this.destroyed || this.shield || this.micPending || this.micStream) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.status('voiceStatus', 'Microphone access needs HTTPS and a supported browser.', 'error'); return; }
      const token = ++this.micToken; this.micPending = true; this.render();
      this.status('voiceStatus', 'Waiting for your microphone permission. You can cancel with Stop mic.');
      try {
        const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
        const audio = { ...(supported.noiseSuppression ? { noiseSuppression: true } : {}), ...(supported.echoCancellation ? { echoCancellation: true } : {}), ...(supported.autoGainControl ? { autoGainControl: true } : {}) };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(audio).length ? audio : true, video: false });
        if (token !== this.micToken || this.destroyed || this.shield || document.hidden) { stopTracks(stream); return; }
        this.micStream = stream; this.micMuted = false; this.micPending = false;
        const track = stream.getAudioTracks()[0];
        if (!track) { stopTracks(stream); throw new Error('No audio track was returned.'); }
        track.addEventListener('ended', () => { if (this.micStream === stream) this.stopMic('Microphone disconnected. Choose Start mic to reconnect.'); }, { once: true });
        const settings = track.getSettings?.() || {};
        const effects = [['noise suppression', settings.noiseSuppression], ['echo cancellation', settings.echoCancellation], ['automatic gain', settings.autoGainControl]].filter(([, enabled]) => enabled === true).map(([name]) => name);
        this.status('voiceStatus', effects.length ? `Microphone ready · ${effects.join(' · ')}. Speak to check the level, or record a short test.` : 'Microphone ready. This browser does not confirm voice processing support. Speak to check the level or record a short test.', 'success');
        await this.startMeter(stream, token); this.render();
      } catch (error) {
        if (token === this.micToken && !this.destroyed) { this.micPending = false; this.stopMic(); this.status('voiceStatus', errorText(error, 'Microphone'), 'error'); }
      } finally { if (token === this.micToken) { this.micPending = false; this.render(); } }
    }
    async startMeter(stream, token) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        const context = new AudioContextClass(); this.audioContext = context;
        const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 512;
        source.connect(analyser); // Deliberately no connection to speakers: avoid feedback.
        await context.resume();
        if (token !== this.micToken || this.audioContext !== context) { await context.close().catch(() => {}); return; }
        const samples = new Float32Array(analyser.fftSize);
        const update = () => {
          if (!this.micStream || token !== this.micToken || this.destroyed) return;
          analyser.getFloatTimeDomainData(samples); let total = 0; for (const value of samples) total += value * value;
          const rms = this.micMuted ? 0 : Math.sqrt(total / samples.length); const value = Math.min(1, rms * 4);
          const meter = this.element('voiceMeter'); if (meter) meter.value = value;
          const label = this.element('voiceLevelLabel'); if (label) label.textContent = this.micMuted ? 'Muted' : `${Math.round(value * 100)}%`;
          this.meterFrame = requestAnimationFrame(update);
        }; update();
      } catch (_) { /* Recording still works when audio metering is unavailable. */ }
    }
    toggleMute() {
      if (!this.micStream) return; this.micMuted = !this.micMuted;
      this.micStream.getAudioTracks().forEach(track => { track.enabled = !this.micMuted; }); this.render();
      this.status('voiceStatus', this.micMuted ? 'Microphone muted. The device remains active until you choose Stop mic.' : 'Microphone unmuted. Audio stays in this local test.');
    }
    stopMic(message = 'Microphone off. No audio is being captured.') {
      ++this.micToken; this.micPending = false; this.stopRecording(); stopTracks(this.micStream); this.micStream = null; this.micMuted = false;
      cancelAnimationFrame(this.meterFrame); this.meterFrame = 0;
      const context = this.audioContext; this.audioContext = null; if (context) context.close().catch(() => {});
      this.status('voiceStatus', message); this.render();
    }
    startRecording() {
      if (!this.micStream || this.shield || document.hidden || this.recorder?.state === 'recording') return;
      if (typeof MediaRecorder === 'undefined') { this.status('voiceStatus', 'Recording is not supported by this browser. The microphone level test is still available.', 'error'); return; }
      const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const session = ++this.recordingSession; const chunks = []; let bytes = 0;
      try {
        const recorder = new MediaRecorder(this.micStream, options ? { mimeType: options } : undefined); this.recorder = recorder; this.clearClip();
        recorder.addEventListener('dataavailable', event => { if (event.data.size > 0 && session === this.recordingSession) { chunks.push(event.data); bytes += event.data.size; if (bytes > 20 * 1024 * 1024) this.stopRecording(); } });
        recorder.addEventListener('error', () => { if (session !== this.recordingSession || this.recorder !== recorder || this.destroyed) return; this.status('voiceStatus', 'The microphone recording was interrupted. Start a new test when ready.', 'error'); this.stopRecording(true); });
        recorder.addEventListener('stop', () => {
          if (session !== this.recordingSession || this.destroyed) return;
          clearInterval(this.recordingTimer); this.recordingTimer = 0; this.recorder = null;
          if (chunks.length) {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); this.clipUrl = URL.createObjectURL(blob);
            const audio = this.element('voicePlayback'); if (audio) audio.src = this.clipUrl;
            const link = this.element('voiceDownloadLink'); if (link) { link.href = this.clipUrl; link.download = `meetinglens-voice-test-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`; }
            const wrap = this.element('voicePlaybackWrap'); if (wrap) wrap.hidden = false;
            this.status('voiceStatus', 'Test recorded locally. Press Play to listen or download it.');
          } else this.status('voiceStatus', 'The test was too short. Record for a few seconds and try again.');
          const duration = this.element('voiceDuration'); if (duration) duration.textContent = 'Up to 60 seconds'; this.render();
        });
        recorder.start(250); const started = Date.now();
        this.recordingTimer = setInterval(() => { const seconds = Math.floor((Date.now() - started) / 1000); const duration = this.element('voiceDuration'); if (duration) duration.textContent = `${seconds} / 60 sec`; if (seconds >= 60) this.stopRecording(); }, 250);
        this.status('voiceStatus', 'Recording this microphone test locally. It will stop after 60 seconds.'); this.render();
      } catch (error) { this.recorder = null; this.status('voiceStatus', errorText(error, 'Recording'), 'error'); this.render(); }
    }
    stopRecording(discard = false) {
      clearInterval(this.recordingTimer); this.recordingTimer = 0;
      if (discard) ++this.recordingSession;
      const recorder = this.recorder;
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      if (discard) { this.recorder = null; this.clearClip(); const duration = this.element('voiceDuration'); if (duration) duration.textContent = 'Up to 60 seconds'; }
      this.render();
    }
    clearClip() {
      const audio = this.element('voicePlayback'); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      if (this.clipUrl) URL.revokeObjectURL(this.clipUrl); this.clipUrl = '';
      const wrap = this.element('voicePlaybackWrap'); if (wrap) wrap.hidden = true;
      const link = this.element('voiceDownloadLink'); if (link) link.removeAttribute('href');
    }
    async scanQR() {
      if (this.scanning || this.shield || this.destroyed) return;
      const canvas = this.getCanvas(); if (!canvas || !canvas.width || !canvas.height) { this.status('qrStatus', 'The preview is not ready. Start the camera or load an image first.', 'error'); return; }
      const token = ++this.qrToken; this.scanning = true; this.render(); this.status('qrStatus', 'Scanning this preview locally…');
      try {
        const scan = document.createElement('canvas'); const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height)); scan.width = Math.max(1, Math.round(canvas.width * scale)); scan.height = Math.max(1, Math.round(canvas.height * scale));
        const context = scan.getContext('2d', { willReadFrequently: true }); context.drawImage(canvas, 0, 0, scan.width, scan.height);
        let value = '';
        if (typeof window.BarcodeDetector === 'function') {
          try { const formats = await BarcodeDetector.getSupportedFormats?.(); if (!formats || formats.includes('qr_code')) { const results = await new BarcodeDetector({ formats: ['qr_code'] }).detect(scan); value = results.find(result => result.rawValue)?.rawValue || ''; } } catch (_) {}
        }
        if (!value) { const decoder = await loadQrFallback(); if (token !== this.qrToken || this.shield || this.destroyed) return; const pixels = context.getImageData(0, 0, scan.width, scan.height); value = decoder(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })?.data || ''; }
        if (token !== this.qrToken || this.shield || this.destroyed) return;
        this.qrValue = value; const field = this.element('qrValue'); if (field) field.value = value;
        this.status('qrStatus', value ? 'QR content found. Review it before copying or opening it elsewhere.' : 'No QR code found. Bring the code closer, keep it sharp, and try again.', value ? 'success' : 'info');
        if (value && this.element('qrAutoCopySwitch')?.checked && /^[a-z][a-z\d+.-]*:/i.test(value.trim()) && value !== this.lastCopiedQR) await this.copyQR(true);
      } catch (error) { if (token === this.qrToken) this.status('qrStatus', errorText(error, 'QR scanning'), 'error'); }
      finally { if (token === this.qrToken) { this.scanning = false; this.render(); } }
    }
    async copyQR(automatic = false) {
      if (!this.qrValue || this.shield || this.destroyed) return;
      const value = this.qrValue;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
        await navigator.clipboard.writeText(value); this.lastCopiedQR = value;
        this.status('qrStatus', automatic ? 'New QR link copied to the clipboard. No link was opened.' : 'QR content copied to the clipboard.', 'success');
      } catch (_) {
        if (!automatic) { const field = this.element('qrValue'); if (field) { field.focus(); field.select(); } }
        this.status('qrStatus', 'Clipboard access was blocked. Select the decoded content and press Ctrl+C to copy it.', 'error');
      }
    }
    async chooseFolder() {
      if (this.destroyed) return;
      if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') { this.status('backupStatus', 'Folder backup is unavailable here. Enable browser backups instead.', 'error'); return; }
      const generation = ++this.backupGeneration; this.backupPending = 'folder'; this.render();
      try { const directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'meetinglens-snapshots' }); if (this.destroyed || generation !== this.backupGeneration) return; this.directory = directory; this.backupMode = 'folder'; this.status('backupStatus', `Snapshot backups will be saved to “${directory.name}” during this session.`, 'success'); }
      catch (error) { if (generation === this.backupGeneration && !this.destroyed && error.name !== 'AbortError') this.status('backupStatus', errorText(error, 'Backup folder'), 'error'); }
      finally { if (generation === this.backupGeneration) { this.backupPending = ''; this.render(); } }
    }
    async enableBrowserBackup(enabled) {
      if (this.destroyed) return;
      if (!enabled) { this.turnBackupOff(); return; }
      const generation = ++this.backupGeneration; this.backupPending = 'browser'; this.render();
      try { await this.openDatabase(); if (this.destroyed || generation !== this.backupGeneration) return; this.directory = null; this.backupMode = 'browser'; this.status('backupStatus', 'Browser backups on for this session. Each snapshot saves an extra copy here; the latest 50 are kept.', 'success'); await this.refreshBackups(); }
      catch (error) { if (generation === this.backupGeneration && !this.destroyed) { this.backupMode = 'off'; this.directory = null; this.status('backupStatus', errorText(error, 'Browser backup'), 'error'); } }
      finally { if (generation === this.backupGeneration) { this.backupPending = ''; this.render(); } }
    }
    turnBackupOff() { ++this.backupGeneration; this.backupPending = ''; this.backupMode = 'off'; this.directory = null; this.status('backupStatus', 'Automatic snapshot backup is off. Previously saved images are kept until you delete them.'); this.render(); }
    async openDatabase() {
      if (!window.indexedDB) throw new Error('Browser image storage is unavailable.');
      if (this.destroyed) throw new Error('This session has ended.');
      if (!this.dbPromise) {
        let settled = false;
        const pending = new Promise((resolve, reject) => {
        const request = indexedDB.open('meetinglens-snapshot-backups', 1);
        request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' }); };
        const fail = error => { if (settled) return; settled = true; if (this.dbPromise === pending) this.dbPromise = null; reject(error); };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('Close older MeetingLens tabs to enable browser backups.'));
        request.onsuccess = () => { const db = request.result; if (settled || this.destroyed) { db.close(); if (!settled) fail(new Error('This session has ended.')); return; } settled = true; db.onversionchange = () => { db.close(); if (this.dbPromise === pending) this.dbPromise = null; }; resolve(db); };
        });
        this.dbPromise = pending;
        // indexedDB.open may throw synchronously when storage permission is
        // temporarily denied; clear that rejected promise so Retry can reopen.
        pending.catch(() => { if (this.dbPromise === pending) this.dbPromise = null; });
      }
      return this.dbPromise;
    }
    backupSnapshot(blob, filename) {
      if (!(blob instanceof Blob) || !blob.size || this.backupMode === 'off' || this.destroyed) return Promise.resolve({ saved: false, reason: 'off' });
      if (blob.size > MAX_BACKUP_BYTES) { this.status('backupStatus', 'This image is too large for automatic backup (50 MB maximum). The normal snapshot download is unaffected.', 'error'); return Promise.resolve({ saved: false, reason: 'size' }); }
      const mode = this.backupMode; const directory = this.directory; const generation = this.backupGeneration;
      const changed = () => this.destroyed || generation !== this.backupGeneration || mode !== this.backupMode || directory !== this.directory;
      const job = this.backupQueue.catch(() => {}).then(async () => {
        if (changed()) return { saved: false, reason: 'changed' };
        try {
          const name = safeName(filename);
          if (mode === 'folder' && directory) {
            if (typeof directory.queryPermission === 'function' && await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new DOMException('Choose the backup folder again to renew permission.', 'NotAllowedError');
            if (changed()) return { saved: false, reason: 'changed' };
            let unique = name;
            try { await directory.getFileHandle(name); const point = name.lastIndexOf('.'); unique = point > 0 ? `${name.slice(0, point)}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}${name.slice(point)}` : `${name}-${Date.now()}`; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
            if (changed()) return { saved: false, reason: 'changed' };
            const handle = await directory.getFileHandle(unique, { create: true }); const writer = await handle.createWritable();
            try { if (changed()) { await writer.abort(); return { saved: false, reason: 'changed' }; } await writer.write(blob); if (changed()) { await writer.abort(); return { saved: false, reason: 'changed' }; } await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
            if (!changed()) this.status('backupStatus', `Backup saved to “${directory.name}”: ${unique}`, 'success'); return { saved: true, mode, filename: unique };
          }
          if (mode === 'browser') {
            const db = await this.openDatabase(); if (changed()) return { saved: false, reason: 'changed' }; const transaction = db.transaction('images', 'readwrite'); const done = transactionDone(transaction); const store = transaction.objectStore('images');
            const id = `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
            // Allocate a monotonic save order inside this read/write transaction.
            // Random ID ordering can otherwise immediately evict the newest copy
            // when several captures share a timestamp or the system clock moves.
            const request = store.getAll(); request.onsuccess = () => {
              const images = request.result.sort((a, b) => (a.order ?? a.created ?? 0) - (b.order ?? b.created ?? 0));
              const order = Math.max(0, ...images.map(image => image.order ?? image.created ?? 0)) + 1;
              store.put({ id, filename: name, created: Date.now(), order, blob });
              for (const image of images.slice(0, Math.max(0, images.length + 1 - MAX_BACKUPS))) store.delete(image.id);
            };
            await done; if (!changed()) this.status('backupStatus', `Browser backup saved: ${name}`, 'success'); await this.refreshBackups(); return { saved: true, mode, filename: name };
          }
          return { saved: false, reason: 'off' };
        } catch (error) { if (!changed()) { if (mode === 'folder' || error.name === 'QuotaExceededError') { ++this.backupGeneration; this.backupMode = 'off'; this.backupPending = ''; this.directory = null; this.render(); } this.status('backupStatus', `${errorText(error, 'Snapshot backup')} The normal snapshot download is unaffected.`, 'error', true); } return { saved: false, error: error.message }; }
      }); this.backupQueue = job; return job;
    }
    async refreshBackups() {
      const list = this.element('backupList'); if (!list || this.destroyed) return;
      try {
        const db = await this.openDatabase(); const images = await requestResult(db.transaction('images', 'readonly').objectStore('images').getAll());
        if (this.destroyed) return;
        this.backupUrls.forEach(url => URL.revokeObjectURL(url)); this.backupUrls = []; list.replaceChildren();
        images.sort((a, b) => (b.order ?? b.created ?? 0) - (a.order ?? a.created ?? 0)).forEach(image => {
          const li = document.createElement('li'); li.className = 'session-backup-item'; const thumbnail = document.createElement('img'); const url = URL.createObjectURL(image.blob); this.backupUrls.push(url); thumbnail.src = url; thumbnail.alt = ''; thumbnail.loading = 'lazy';
          const name = document.createElement('b'); name.textContent = image.filename; name.title = new Date(image.created).toLocaleString();
          const actions = document.createElement('div'); const save = document.createElement('button'); save.type = 'button'; save.className = 'session-text-link'; save.textContent = 'Download'; save.addEventListener('click', () => download(image.blob, image.filename));
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'session-text-link'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${image.filename}`); remove.addEventListener('click', () => this.deleteBackup(image.id));
          actions.append(save, remove); li.append(thumbnail, name, actions); list.append(li);
        });
        if (!images.length) { const empty = document.createElement('li'); empty.className = 'session-backup-empty'; empty.textContent = 'No saved browser backups yet.'; list.append(empty); }
      } catch (error) { this.status('backupStatus', errorText(error, 'Browser backup list'), 'error'); }
    }
    async deleteBackup(id) { try { const db = await this.openDatabase(); const transaction = db.transaction('images', 'readwrite'); const done = transactionDone(transaction); transaction.objectStore('images').delete(id); await done; await this.refreshBackups(); } catch (error) { this.status('backupStatus', errorText(error, 'Delete backup'), 'error'); } }
    async clearBackups() {
      const button = this.element('backupClearButton');
      if (button && button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm: delete all browser backups'; setTimeout(() => { if (button.isConnected) { delete button.dataset.confirm; button.textContent = 'Delete all browser backups'; } }, 7000); return; }
      // Invalidate queued captures before waiting for the current write, so deleted
      // images cannot reappear when a previously captured snapshot reaches the queue.
      ++this.backupGeneration; this.backupPending = '';
      const job = this.backupQueue.catch(() => {}).then(async () => {
        try { const db = await this.openDatabase(); const transaction = db.transaction('images', 'readwrite'); const done = transactionDone(transaction); transaction.objectStore('images').clear(); await done; this.status('backupStatus', 'All browser backups deleted. Folder copies are unchanged.'); await this.refreshBackups(); }
        catch (error) { if (!this.destroyed) this.status('backupStatus', errorText(error, 'Delete backups'), 'error'); }
        if (button) { delete button.dataset.confirm; button.textContent = 'Delete all browser backups'; }
        this.render();
      });
      this.backupQueue = job; return job;
    }
    stopPrivateResources(reason = 'Microphone and recording stopped for privacy.') {
      this.stopRecording(true); this.stopMic(reason); ++this.qrToken; this.scanning = false; this.qrValue = ''; this.lastCopiedQR = '';
      const field = this.element('qrValue'); if (field) field.value = ''; this.status('qrStatus', 'Scanning stopped. Start a new scan when you are ready.'); this.render();
    }
    setPrivacyShield(active) { this.shield = !!active; if (this.shield) this.stopPrivateResources('Privacy Shield is on. Microphone and recording are off.'); this.render(); }
    getState() { return { micActive: !!this.micStream?.getAudioTracks().some(track => track.readyState === 'live'), micPending: this.micPending, micMuted: this.micMuted, recording: this.recorder?.state === 'recording', backupMode: this.backupMode, backupFolder: this.directory?.name || '', qrScanning: this.scanning, privacyShield: this.shield }; }
    destroy() { this.destroyed = true; ++this.backupGeneration; this.backupPending = ''; this.stopPrivateResources(); this.listeners.forEach(([target, event, listener]) => target.removeEventListener(event, listener)); this.listeners = []; this.backupUrls.forEach(url => URL.revokeObjectURL(url)); this.backupUrls = []; this.directory = null; this.dbPromise?.then(db => db.close()).catch(() => {}); }
  }
  let activeInstance;
  window.MeetingLensSessionTools = { init(options) { activeInstance?.destroy(); activeInstance = new SessionTools(options); return activeInstance; } };
})();
