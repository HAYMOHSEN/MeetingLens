(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);
  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const hide = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
  const defaults = Object.freeze({ look: "natural", brightness: 56, contrast: 54, saturation: 53, enhancement: 65,
    softness: false, scene: "room", sceneStrength: 45, frame: "conversation", zoom: 100, showFrame: true,
    eyeLine: true, mirror: true, grid: false, temperature: 0, vignette: 8, split: false,
    quality: "balanced", timer: 0, snapshotFormat: "png", autoPause: true });
  const limits = { brightness: [0, 100], contrast: [0, 100], saturation: [0, 100], enhancement: [0, 100],
    sceneStrength: [0, 100], zoom: [100, 160], temperature: [-50, 50], vignette: [0, 60] };
  const enums = { look: ["natural", "clear", "warm", "studio", "mono", "brand"],
    scene: ["room", "soft", "studio", "night", "dawn", "slate"], frame: ["conversation", "teaching", "wide"],
    quality: ["balanced", "high", "efficient"], timer: [0, 3, 5], snapshotFormat: ["png", "jpeg"] };
  const SETTINGS_KEY = "meetinglens-settings", PRESETS_KEY = "meetinglens-presets-v1", MAX_PRESETS = 20;
  let storageProblem = false;

  // Only known keys with the expected type enter the state, including imported JSON.
  function sanitize(input) {
    const clean = { ...defaults };
    if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
    for (const key of Object.keys(defaults)) {
      const value = Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined;
      if (limits[key] && typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(Math.min(limits[key][1], Math.max(limits[key][0], value)));
      else if (enums[key]?.includes(value)) clean[key] = value;
      else if (typeof defaults[key] === "boolean" && typeof value === "boolean") clean[key] = value;
    }
    return clean;
  }
  function readStorage(key, fallback) {
    try { const raw = localStorage.getItem(key); if (raw === null) return fallback; if (raw.length > 100000) throw new Error(); return JSON.parse(raw); }
    catch { storageProblem = true; return fallback; }
  }
  function storageNotice() {
    if (storageProblem) { text("storageNotice", "Browser storage is unavailable or contained invalid data. The studio still works; changes may last only for this session."); hide("storageNotice", false); text("settingsSaveStatus", "Session only · check browser storage"); }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { storageProblem = true; storageNotice(); }
  }
  const state = { ...sanitize(readStorage(SETTINGS_KEY, {})), originalHeld: false, privacy: false };
  const video = $("#cameraVideo"), canvas = $("#previewCanvas");
  const ctx = canvas?.getContext("2d", { alpha: false });
  if (!video || !canvas || !ctx) return;
  const demoCanvas = document.createElement("canvas");
  demoCanvas.width = canvas.width; demoCanvas.height = canvas.height;
  const demoCtx = demoCanvas.getContext("2d", { alpha: false });
  const portrait = new Image();
  let portraitReady = false, portraitFailed = false, demoDirty = true, dirty = true, rafId = 0;
  let activeStream = null, requestId = 0, phase = "demo", cameraMuted = false, selectedCameraId = "";
  let deviceRefreshTimer = null, lastRender = -Infinity, lastVideoTime = -1, sampleStart = 0, sampleFrames = 0, measuredFps = null;
  let toastTimeout = null, captureTimer = null, captureToken = 0, countdownActive = false, disposed = false;
  let deferredInstallPrompt = null, swRegistration = null, updateRequested = false;
  const objectUrls = new Set();
  const lookNames = { natural: "Natural", clear: "Clear", warm: "Warm", studio: "Studio", mono: "Monochrome", brand: "Vivid" };
  const sceneNames = { room: "Modern office", soft: "Soft daylight", studio: "Blue studio", night: "Evening office", dawn: "Golden hour", slate: "Slate studio" };
  const panelText = { studio: ["Your studio", "SESSION OVERVIEW"], looks: ["Light & color", "NATURAL ENHANCEMENT"],
    background: ["Sample backgrounds", "SCENE EXPLORER"], frame: ["Framing & capture", "COMPOSITION"],
    device: ["Camera & capture", "DEVICE SETUP"], presets: ["My presets", "SAVED SETUPS"], privacy: ["Privacy & settings", "ON YOUR DEVICE"] };

  function makeId() { return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  function normalizePresets(input) {
    if (!Array.isArray(input)) return [];
    const ids = new Set();
    return input.slice(0, MAX_PRESETS).flatMap(item => {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !item.name.trim() || !item.settings || typeof item.settings !== "object" || Array.isArray(item.settings)) return [];
      let id = typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : makeId();
      if (ids.has(id)) id = makeId(); ids.add(id);
      return [{ id, name: item.name.trim().slice(0, 40), settings: sanitize(item.settings) }];
    });
  }
  const storedPresets = readStorage(PRESETS_KEY, []);
  let presets = normalizePresets(storedPresets);
  if (!Array.isArray(storedPresets) || presets.length !== storedPresets.length) storageProblem = true;
  function saveSettings() { writeStorage(SETTINGS_KEY, sanitize(state)); }
  function showToast(message) {
    text("toastText", message); $("#toast")?.classList.add("show"); clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $("#toast")?.classList.remove("show"), 3300);
  }
  function setPanel(name) {
    if (!Object.prototype.hasOwnProperty.call(panelText, name)) return;
    $$(".control-panel").forEach(panel => panel.classList.toggle("active", panel.id === `${name}-panel`));
    $$(".nav-button[data-panel]").forEach(button => { const active = button.dataset.panel === name; button.classList.toggle("active", active); button.setAttribute("aria-current", active ? "page" : "false"); button.setAttribute("aria-pressed", String(active)); });
    text("panelTitle", panelText[name][0]); text("panelEyebrow", panelText[name][1]);
  }
  function setSwitch(id, checked) { const el = document.getElementById(id); if (el) { el.classList.toggle("on", checked); el.setAttribute("role", "switch"); el.setAttribute("aria-checked", String(checked)); } }
  function currentProfile() {
    if (state.look === "natural" && state.brightness === 56 && state.contrast === 54 && state.saturation === 53 && state.frame === "conversation") return "natural";
    if (state.brightness === 68 && state.look === "warm") return "lowlight";
    if (state.frame === "teaching") return "teaching";
    if (state.frame === "wide" && state.look === "clear") return "presentation";
    return "";
  }
  function updateControls() {
    for (const key of Object.keys(limits)) {
      const range = document.getElementById(`${key}Range`); if (range) range.value = state[key];
      text(`${key}Output`, key === "temperature" ? `${state[key] > 0 ? "+" : ""}${state[key]}` : `${state[key]}%`);
    }
    for (const [id, key] of Object.entries({ softnessSwitch: "softness", frameSwitch: "showFrame", eyeLineSwitch: "eyeLine", mirrorSwitch: "mirror", gridSwitch: "grid", splitSwitch: "split", autoPauseSwitch: "autoPause" })) setSwitch(id, state[key]);
    for (const [id, key] of Object.entries({ qualitySelect: "quality", timerSelect: "timer", snapshotFormat: "snapshotFormat" })) { const el = document.getElementById(id); if (el) el.value = String(state[key]); }
    const guide = $("#frameGuide"); if (guide) { guide.classList.toggle("hidden", !state.showFrame); guide.hidden = !state.showFrame; guide.dataset.frame = state.frame; }
    hide("eyeLineGuide", !state.eyeLine); hide("thirdsGrid", !state.grid); hide("splitLine", !state.split || state.originalHeld || state.privacy);
    for (const [selector, key] of [[".look-button", "look"], [".scene-button", "scene"], [".segment[data-frame]", "frame"]]) $$(selector).forEach(button => { const active = button.dataset[key] === state[key]; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $$(".profile-button").forEach(button => { const active = button.dataset.profile === currentProfile(); button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#holdOriginalButton")?.setAttribute("aria-pressed", String(state.originalHeld)); updateLabels(); updateCameraUI();
  }
  function updateLabels() {
    const live = phase === "live";
    text("effectLabel", state.originalHeld ? "Original · effects bypassed" : `${lookNames[state.look]} · ${live ? "Your camera background" : sceneNames[state.scene]}`);
    text("lightSummary", state.enhancement === 0 ? "Effects bypassed" : `${lookNames[state.look]} · ${state.enhancement}% intensity`);
    text("frameSummary", `${state.frame[0].toUpperCase() + state.frame.slice(1)} · ${state.zoom}% crop`);
    text("lightState", state.enhancement === 0 ? "Original" : "Custom");
    text("qualityLabel", `${state.quality === "high" ? "High detail" : state.quality === "efficient" ? "Efficient" : "Balanced"} processing`);
    text("privacySummary", state.privacy ? "Shield active · camera stopped" : "Processed on your device"); hide("demoNotice", live || state.privacy);
  }
  function updateCameraUI() {
    const live = phase === "live", starting = phase === "starting";
    $("#cameraDot")?.classList.toggle("live", live && !cameraMuted); $("#liveChip")?.classList.toggle("live", live && !cameraMuted);
    text("cameraStatus", state.privacy ? "Privacy Shield active · camera stopped" : starting ? "Waiting for camera permission…" : live ? cameraMuted ? "Camera signal paused · check your camera" : "Live camera · processed on this device" : phase === "paused" ? "Camera stopped while away · restart when ready" : phase === "error" ? "Camera unavailable · see details below" : "Professional sample · camera is off");
    text("liveLabel", state.privacy ? "SHIELD ACTIVE" : starting ? "CONNECTING" : live ? cameraMuted ? "SIGNAL PAUSED" : "LIVE CAMERA" : "SAMPLE PREVIEW");
    text("sessionState", state.privacy ? "Shield active" : starting ? "Connecting" : live ? cameraMuted ? "Signal paused" : "Camera live" : phase === "paused" ? "Paused while away" : "Sample mode");
    text("cameraSetupState", live ? "Connected · audio never requested" : starting ? "Permission request pending" : "Optional · camera permission required");
    const start = $("#startCameraButton"); if (start) { start.disabled = starting || live || state.privacy; start.setAttribute("aria-busy", String(starting)); start.innerHTML = `<span class="camera-icon" aria-hidden="true"></span>${starting ? "Connecting…" : live ? "Camera is on" : "Start camera"}`; }
    const stop = $("#stopCameraButton"); if (stop) stop.disabled = !starting && !activeStream;
    const capture = $("#captureButton"); if (capture) capture.disabled = state.privacy || starting || countdownActive || cameraMuted;
    const original = $("#holdOriginalButton"); if (original) original.disabled = state.privacy || starting;
    for (const id of ["cameraSelect", "qualitySelect"]) { const el = document.getElementById(id); if (el) el.disabled = starting; }
    $("#privacyCurtain")?.classList.toggle("visible", state.privacy); $("#privacyCurtain")?.setAttribute("aria-hidden", String(!state.privacy));
    for (const id of ["privacyButton", "shieldQuickButton"]) { const el = document.getElementById(id); if (el) { el.setAttribute("aria-pressed", String(state.privacy)); el.classList.toggle("active", state.privacy); } }
    text("privacyButton", state.privacy ? "Deactivate Privacy Shield" : "Activate Privacy Shield");
    $("#shieldQuickButton")?.setAttribute("aria-label", state.privacy ? "Deactivate Privacy Shield" : "Activate Privacy Shield");
    if (!live) { text("resolutionLabel", `${canvas.width} × ${canvas.height} sample`); text("deviceLabel", "Camera is off"); text("fpsLabel", "Sample · still image"); }
    else { const track = activeStream?.getVideoTracks()[0]; text("deviceLabel", track?.label || "Connected camera"); text("resolutionLabel", `${canvas.width} × ${canvas.height} output`); text("cameraSetupState", `${video.videoWidth || track?.getSettings?.().width || "—"} × ${video.videoHeight || track?.getSettings?.().height || "—"} input · no audio`); text("fpsLabel", cameraMuted ? "Signal paused" : measuredFps === null ? "Measuring frames…" : `${measuredFps} fps · preview`); }
  }
  function clearCameraError() { hide("cameraError", true); text("cameraErrorText", ""); }
  function cameraError(message) { text("cameraErrorText", message); hide("cameraError", false); }
  function errorMessage(error) {
    const messages = { NotAllowedError: "Camera access was denied. Allow the camera in your browser or Windows privacy settings, then select Retry.", SecurityError: "Camera access is blocked. Open MeetingLens over HTTPS and check your browser camera permissions.", NotFoundError: "No available camera was found. Connect a camera, select it below, then select Retry.", NotReadableError: "The camera could not be opened. Close another app using it, check its connection, then select Retry.", OverconstrainedError: "This camera could not use the selected settings. Choose another camera or a lower quality, then retry.", AbortError: "Camera startup was interrupted. Check the camera, then select Retry." };
    return messages[error?.name] || "The camera could not start. Check its connection and permissions, then select Retry.";
  }
  function clearPreview() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = "none"; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#101825"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  function resizeOutput() {
    const size = state.quality === "high" ? [1920, 1080] : state.quality === "efficient" ? [640, 360] : [1280, 720];
    if (canvas.width === size[0] && canvas.height === size[1]) return;
    canvas.width = demoCanvas.width = size[0]; canvas.height = demoCanvas.height = size[1];
    demoDirty = true; dirty = true; lastRender = -Infinity; clearPreview();
  }

  function drawDemoSource() {
    if (!demoDirty || !demoCtx) return; demoDirty = false;
    const w = demoCanvas.width, h = demoCanvas.height;
    const palettes = { room: ["#d7dcd9", "#a8b7b3", "#485a60"], soft: ["#e2e7e6", "#b4c4c4", "#637775"], studio: ["#294c69", "#183149", "#0c1728"], night: ["#384253", "#202c3d", "#0e1726"], dawn: ["#e8d6ba", "#bb9b81", "#665d5a"], slate: ["#9aa5af", "#6a7785", "#344455"] };
    const [a, b, c] = palettes[state.scene], gradient = demoCtx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, a); gradient.addColorStop(.55, b); gradient.addColorStop(1, c); demoCtx.fillStyle = gradient; demoCtx.fillRect(0, 0, w, h);
    demoCtx.save(); demoCtx.filter = `blur(${state.scene === "soft" ? 13 : 5}px)`;
    if (["room", "soft", "night", "dawn"].includes(state.scene)) {
      demoCtx.fillStyle = state.scene === "night" ? "#192838" : "#edf1eb"; demoCtx.fillRect(w * .03, -20, w * .25, h * .71);
      demoCtx.fillStyle = state.scene === "night" ? "#36536c" : "#bacbca"; demoCtx.fillRect(w * .043, 0, w * .10, h * .67); demoCtx.fillRect(w * .157, 0, w * .105, h * .67);
      demoCtx.fillStyle = "rgba(20,39,47,.18)"; demoCtx.fillRect(0, h * .70, w * .36, h * .025);
      demoCtx.fillStyle = state.scene === "night" ? "#192330" : "#75766e"; demoCtx.fillRect(w * .81, h * .10, w * .16, h * .55);
      demoCtx.fillStyle = "rgba(21,31,37,.40)";
      for (let row = 0; row < 3; row++) {
        demoCtx.fillRect(w * .81, h * (.26 + row * .16), w * .16, 9);
        for (let book = 0; book < 5; book++) { demoCtx.fillStyle = ["#b8c6c1", "#465865", "#b59671", "#86948a", "#d3cdbb"][book]; demoCtx.fillRect(w * (.824 + book * .025), h * (.13 + row * .16), w * .018, h * .12); }
        demoCtx.fillStyle = "rgba(21,31,37,.40)";
      }
      demoCtx.fillStyle = "#3a5144";
      for (let i = 0; i < 5; i++) { demoCtx.beginPath(); demoCtx.ellipse(w * (.73 + i * .012), h * (.61 - (i % 3) * .04), w * .025, h * .11, (i - 2) * .3, 0, Math.PI * 2); demoCtx.fill(); }
      demoCtx.fillStyle = "#9b8d7b"; demoCtx.fillRect(w * .725, h * .69, w * .07, h * .11);
    } else {
      const glow = demoCtx.createRadialGradient(w * .23, h * .25, 0, w * .23, h * .25, w * .66);
      glow.addColorStop(0, state.scene === "studio" ? "rgba(127,198,212,.31)" : "rgba(220,231,240,.24)"); glow.addColorStop(1, "rgba(20,30,48,0)"); demoCtx.fillStyle = glow; demoCtx.fillRect(0, 0, w, h);
      demoCtx.fillStyle = "rgba(255,255,255,.035)"; demoCtx.fillRect(w * .79, 0, w * .012, h);
    }
    demoCtx.restore(); demoCtx.fillStyle = `rgba(13,25,37,${state.sceneStrength / 100 * .11})`; demoCtx.fillRect(0, 0, w, h);
    if (portraitReady) { const height = h * .985, width = portrait.naturalWidth * height / portrait.naturalHeight; demoCtx.drawImage(portrait, (w - width) / 2, h - height, width, height); }
    else { demoCtx.fillStyle = "rgba(14,27,40,.65)"; demoCtx.beginPath(); demoCtx.arc(w / 2, h * .45, 68, 0, Math.PI * 2); demoCtx.fill(); demoCtx.fillStyle = "#e6edf1"; demoCtx.font = "500 35px system-ui"; demoCtx.textAlign = "center"; demoCtx.fillText("ML", w / 2, h * .45 + 12); demoCtx.font = "20px system-ui"; demoCtx.fillText(portraitFailed ? "Sample portrait unavailable · start your camera" : "Loading professional sample…", w / 2, h * .66); }
  }
  function filterString(original = false) {
    const strength = original ? 0 : state.enhancement / 100; if (strength === 0) return "none";
    let brightness = 100 + (state.brightness - 50) * 1.2, contrast = 100 + (state.contrast - 50), saturation = 100 + (state.saturation - 50) * 1.2, sepia = 0, hue = 0, grayscale = 0;
    if (state.look === "clear") { contrast += 9; saturation += 5; }
    if (state.look === "warm") { sepia = 13; saturation += 4; brightness += 2; }
    if (state.look === "studio") { contrast += 10; saturation += 7; brightness += 3; hue = -3; }
    if (state.look === "mono") { grayscale = 100; contrast += 7; }
    if (state.look === "brand") { saturation += 20; contrast += 3; hue = -4; }
    const mix = target => 100 + (target - 100) * strength;
    return `brightness(${mix(brightness)}%) contrast(${mix(contrast)}%) saturate(${mix(saturation)}%) sepia(${sepia * strength}%) hue-rotate(${hue * strength}deg) grayscale(${grayscale * strength}%) blur(${state.softness ? .5 * strength : 0}px)`;
  }
  function drawView(source, original) {
    const w = canvas.width, h = canvas.height, sw = source === video ? video.videoWidth : source.width, sh = source === video ? video.videoHeight : source.height;
    if (!sw || !sh) return;
    const aspect = w / h; let cropWidth = sw, cropHeight = sh;
    if (sw / sh > aspect) cropWidth = sh * aspect; else cropHeight = sw / aspect;
    const zoom = Math.max(1, state.zoom / 100); cropWidth /= zoom; cropHeight /= zoom;
    const sx = (sw - cropWidth) / 2, sy = (sh - cropHeight) / 2;
    ctx.save(); ctx.filter = filterString(original); if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, w, h); ctx.restore();
    const strength = original ? 0 : state.enhancement / 100;
    if (strength && state.temperature) { const alpha = Math.abs(state.temperature) / 50 * .13 * strength; ctx.fillStyle = state.temperature > 0 ? `rgba(255,161,62,${alpha})` : `rgba(58,139,255,${alpha})`; ctx.fillRect(0, 0, w, h); }
    if (strength && state.vignette) { const vignette = ctx.createRadialGradient(w / 2, h * .46, h * .30, w / 2, h / 2, w * .68); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, `rgba(3,9,18,${state.vignette / 100 * strength})`); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h); }
  }
  function drawFrame() {
    if (state.privacy || document.hidden || disposed) return;
    if (phase === "starting" || cameraMuted) { clearPreview(); return; }
    let source; if (phase === "live") { if (video.readyState < 2) return; source = video; } else { drawDemoSource(); source = demoCanvas; }
    ctx.save(); ctx.filter = "none"; ctx.fillStyle = "#101825"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); drawView(source, state.originalHeld);
    if (state.split && !state.originalHeld) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width / 2, canvas.height); ctx.clip(); drawView(source, true); ctx.restore(); }
  }
  function requestRender() { dirty = true; if (!rafId && !document.hidden && !state.privacy && !disposed) rafId = requestAnimationFrame(render); }
  function render(time) {
    rafId = 0; if (document.hidden || state.privacy || disposed) return;
    const live = phase === "live", targetFps = state.quality === "efficient" ? 20 : 30;
    const newFrame = live && !cameraMuted && video.readyState >= 2 && video.currentTime !== lastVideoTime;
    if (dirty || (newFrame && time - lastRender >= 1000 / targetFps - 1)) {
      drawFrame(); dirty = false; lastRender = time;
      if (newFrame) { lastVideoTime = video.currentTime; if (!sampleStart) sampleStart = time; sampleFrames++; if (time - sampleStart >= 1200) { measuredFps = Math.round(sampleFrames * 1000 / (time - sampleStart)); sampleFrames = 0; sampleStart = time; updateCameraUI(); } }
    }
    if (live) rafId = requestAnimationFrame(render);
  }

  function stopTracks(stream) { stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* Already disconnected. */ } }); }
  function releaseCamera() {
    const previous = activeStream; activeStream = null; try { video.pause(); } catch { /* Can reject during startup. */ }
    video.srcObject = null; stopTracks(previous); cameraMuted = false; measuredFps = null; sampleStart = 0; sampleFrames = 0; lastVideoTime = -1;
    if (rafId) cancelAnimationFrame(rafId); rafId = 0; clearPreview();
  }
  function cancelCapture(message) { captureToken++; clearTimeout(captureTimer); captureTimer = null; const wasActive = countdownActive; countdownActive = false; hide("countdown", true); updateCameraUI(); if (message && wasActive) showToast(message); }
  function stopCamera(showMessage = true, nextPhase = "demo") {
    requestId++; cancelCapture(); releaseCamera(); phase = nextPhase; state.originalHeld = false; updateControls(); requestRender();
    if (showMessage) showToast("Camera stopped. Start it again when you are ready.");
  }
  function requestIsCurrent(id) { return id === requestId && !state.privacy && !document.hidden && !disposed; }
  function cameraConstraints(fallback = false) {
    const device = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {};
    if (fallback) return { video: Object.keys(device).length ? device : true, audio: false };
    const size = state.quality === "high" ? [1920, 1080, 30] : state.quality === "efficient" ? [640, 360, 20] : [1280, 720, 30];
    return { video: { ...device, width: { ideal: size[0] }, height: { ideal: size[1] }, frameRate: { ideal: size[2], max: size[2] }, ...(selectedCameraId ? {} : { facingMode: "user" }) }, audio: false };
  }
  async function startCamera() {
    if (disposed || phase === "starting") return;
    if (state.privacy) { showToast("Deactivate Privacy Shield before starting the camera."); return; }
    if (document.hidden) { showToast("Return to the studio before starting the camera."); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { phase = "error"; cameraError("Camera access needs a secure HTTPS page and a supported browser. Publish the app, or use localhost for development."); updateCameraUI(); return; }
    const id = ++requestId; cancelCapture(); releaseCamera(); phase = "starting"; clearCameraError(); updateControls(); requestRender(); let acquired = null;
    try {
      try { acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints()); }
      catch (error) { if (error?.name !== "OverconstrainedError" || !requestIsCurrent(id)) throw error; acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints(true)); }
      if (!requestIsCurrent(id)) { stopTracks(acquired); return; }
      const track = acquired.getVideoTracks()[0]; if (!track || track.readyState === "ended") throw new Error("No active video track");
      activeStream = acquired; video.srcObject = acquired;
      track.addEventListener("ended", () => { if (activeStream !== acquired) return; stopCamera(false, "error"); cameraError("The camera disconnected or stopped. Reconnect it and select Retry."); refreshDevices(); });
      track.addEventListener("mute", () => { if (activeStream !== acquired || phase !== "live") return; cameraMuted = true; cancelCapture(); clearPreview(); updateCameraUI(); requestRender(); });
      track.addEventListener("unmute", () => { if (activeStream === acquired) { cameraMuted = false; updateCameraUI(); requestRender(); } });
      let playTimeout;
      try {
        await Promise.race([video.play(), new Promise((_, reject) => {
          playTimeout = setTimeout(() => { const error = new Error("Camera playback timed out"); error.name = "NotReadableError"; reject(error); }, 10000);
        })]);
      } finally { clearTimeout(playTimeout); }
      if (!requestIsCurrent(id) || activeStream !== acquired) { stopTracks(acquired); if (video.srcObject === acquired) video.srcObject = null; if (activeStream === acquired) activeStream = null; return; }
      phase = "live"; cameraMuted = Boolean(track.muted); updateControls(); requestRender(); await refreshDevices();
      if (requestIsCurrent(id)) showToast("Camera connected. Audio is never requested; video stays on your device.");
    } catch (error) { stopTracks(acquired); if (id !== requestId) return; releaseCamera(); phase = "error"; cameraError(errorMessage(error)); updateControls(); requestRender(); }
  }
  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput"); if (disposed) return;
      const select = $("#cameraSelect"); if (!select) return; const wanted = selectedCameraId; select.replaceChildren();
      const option = document.createElement("option"); option.value = ""; option.textContent = "System default camera"; select.append(option);
      devices.forEach((device, index) => { const opt = document.createElement("option"); opt.value = device.deviceId; opt.textContent = (device.label || `Camera ${index + 1}`).slice(0, 100); select.append(opt); });
      selectedCameraId = devices.some(device => device.deviceId === wanted) ? wanted : ""; select.value = selectedCameraId;
    } catch { /* Enumeration can be blocked while permission is undecided. */ }
  }
  async function handleDeviceChange() {
    const previous = activeStream?.getVideoTracks()[0]?.getSettings?.().deviceId; await refreshDevices();
    if (previous && activeStream && navigator.mediaDevices?.enumerateDevices) try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (activeStream?.getVideoTracks()[0]?.getSettings?.().deviceId === previous && !devices.some(device => device.kind === "videoinput" && device.deviceId === previous)) { stopCamera(false, "error"); cameraError("Your camera was disconnected. Connect it or choose another camera, then select Retry."); }
    } catch { /* Track ended remains the primary disconnect signal. */ }
  }
  function activatePrivacyShield() { state.privacy = !state.privacy; stopCamera(false); updateControls(); showToast(state.privacy ? "Privacy Shield on. Camera tracks stopped and the preview cleared." : "Privacy Shield off. Start the camera when ready."); }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob); objectUrls.add(url); const link = document.createElement("a"); link.href = url; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); }, 1500);
  }
  function captureSnapshot() {
    if (state.privacy || document.hidden || phase === "starting" || cameraMuted || countdownActive) return;
    const token = ++captureToken;
    const finish = () => {
      if (token !== captureToken || state.privacy || document.hidden || disposed) return;
      countdownActive = false; hide("countdown", true); updateCameraUI(); drawFrame(); const format = state.snapshotFormat;
      try { canvas.toBlob(blob => {
        if (token !== captureToken || state.privacy || document.hidden || disposed) return;
        if (!blob) { showToast("The snapshot could not be saved. Try again."); return; }
        const stamp = new Date().toISOString().replace(/[:.]/g, "-"); downloadBlob(blob, `meetinglens-${phase === "live" ? "camera" : "sample"}-${stamp}.${format === "jpeg" ? "jpg" : "png"}`); showToast("Snapshot downloaded. Framing guides are excluded.");
      }, format === "jpeg" ? "image/jpeg" : "image/png", .92); } catch { showToast("This browser could not create the snapshot. Try PNG format."); }
    };
    if (!state.timer) { finish(); return; }
    countdownActive = true; updateCameraUI(); let remaining = state.timer;
    const tick = () => { if (token !== captureToken || state.privacy || document.hidden || disposed) return; if (!remaining) { finish(); return; } text("countdown", String(remaining--)); hide("countdown", false); captureTimer = setTimeout(tick, 1000); }; tick();
  }
  function applyChanges(changes, message) {
    const oldScene = state.scene, oldStrength = state.sceneStrength, oldQuality = state.quality; Object.assign(state, sanitize({ ...state, ...changes }));
    if (oldScene !== state.scene || oldStrength !== state.sceneStrength) demoDirty = true;
    const qualityChanged = oldQuality !== state.quality;
    const restart = qualityChanged && (phase === "live" || phase === "starting");
    if (qualityChanged) { cancelCapture(); resizeOutput(); }
    updateControls(); saveSettings(); requestRender(); if (message) showToast(message);
    if (restart) { stopCamera(false); startCamera(); }
  }
  function applyProfile(name) {
    const profiles = { natural: { look: "natural", brightness: 56, contrast: 54, saturation: 53, temperature: 0, vignette: 8, enhancement: 65, frame: "conversation", zoom: 100, softness: false }, lowlight: { look: "warm", brightness: 68, contrast: 50, saturation: 52, temperature: 3, vignette: 0, enhancement: 65, frame: "conversation", zoom: 100, softness: true }, teaching: { look: "natural", brightness: 58, contrast: 56, saturation: 52, temperature: 0, vignette: 0, enhancement: 65, frame: "teaching", zoom: 100, softness: false }, presentation: { look: "clear", brightness: 56, contrast: 62, saturation: 48, temperature: 0, vignette: 6, enhancement: 65, frame: "wide", zoom: 100, softness: false } };
    if (Object.prototype.hasOwnProperty.call(profiles, name)) applyChanges(profiles[name], "Profile applied. Adjust the sliders to suit your lighting.");
  }
  function resetSettings() { cancelCapture(); applyChanges(defaults, "Studio settings restored."); }
  function renderPresets() {
    const list = $("#presetList"); if (!list) return; list.replaceChildren();
    if (!presets.length) { const empty = document.createElement("p"); empty.className = "preset-empty"; empty.textContent = "Save a setup for your next meeting."; list.append(empty); }
    for (const preset of presets) {
      const row = document.createElement("div"); row.className = "preset-item";
      const load = document.createElement("button"); load.type = "button"; load.className = "preset-load"; load.dataset.presetId = preset.id; load.textContent = preset.name; load.title = `Apply ${preset.name}`;
      load.addEventListener("click", () => applyChanges(preset.settings, `“${preset.name}” setup applied.`));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "preset-delete"; remove.dataset.presetId = preset.id; remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete ${preset.name}`);
      remove.addEventListener("click", () => { presets = presets.filter(item => item.id !== preset.id); writeStorage(PRESETS_KEY, presets); renderPresets(); showToast("Saved setup deleted."); }); row.append(load, remove); list.append(row);
    }
    const exportButton = $("#exportPresetButton"); if (exportButton) exportButton.disabled = !presets.length;
    const clearButton = $("#clearPresetsButton"); if (clearButton) clearButton.disabled = !presets.length;
  }
  function savePreset() {
    const field = $("#presetName"), name = field?.value.trim().slice(0, 40);
    if (!name) { showToast("Enter a name for this setup."); field?.focus(); return; }
    if (presets.length >= MAX_PRESETS) { showToast("You can save 20 setups. Delete one before adding another."); return; }
    presets.push({ id: makeId(), name, settings: sanitize(state) }); writeStorage(PRESETS_KEY, presets); renderPresets(); if (field) field.value = ""; showToast("Setup saved in this browser.");
  }
  async function importPresets(event) {
    const input = event.target, file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 100000) throw new Error("Choose a MeetingLens setup file smaller than 100 KB.");
      const data = JSON.parse(await file.text());
      if (!data || data.schema !== "meetinglens.presets" || data.version !== 1 || !Array.isArray(data.presets) || !data.presets.length || data.presets.length > MAX_PRESETS) throw new Error("This is not a supported MeetingLens setup file.");
      const imported = normalizePresets(data.presets); if (imported.length !== data.presets.length) throw new Error("The file contains an invalid setup. No setups were imported.");
      if (presets.length + imported.length > MAX_PRESETS) throw new Error("There is space for 20 setups. Delete some saved setups before importing this file.");
      presets.push(...imported.map(item => ({ ...item, id: makeId() }))); writeStorage(PRESETS_KEY, presets); renderPresets(); showToast(`${imported.length} setup${imported.length === 1 ? "" : "s"} imported.`);
    } catch (error) { showToast(error instanceof SyntaxError ? "This file is not valid JSON. Choose an exported MeetingLens setup file." : error.message || "The setup file could not be read."); } finally { input.value = ""; }
  }
  function setOriginal(held) { if (state.originalHeld === held || state.privacy) return; state.originalHeld = held; updateControls(); requestRender(); }
  function isEditing(event) { return Boolean(event.target?.closest?.("input,select,textarea,[contenteditable='true']")); }
  function updateConnection() { text("offlineLabel", navigator.onLine ? "On-device processing" : "Offline · cached studio"); $("#offlineLabel")?.classList.toggle("offline", !navigator.onLine); hide("offlineLabel", navigator.onLine); }
  function registerEvents() {
    $$(".nav-button[data-panel]").forEach(button => button.addEventListener("click", () => setPanel(button.dataset.panel)));
    $$(".profile-button").forEach(button => button.addEventListener("click", () => applyProfile(button.dataset.profile)));
    $$(".look-button").forEach(button => button.addEventListener("click", () => applyChanges({ look: button.dataset.look })));
    $$(".scene-button").forEach(button => button.addEventListener("click", () => applyChanges({ scene: button.dataset.scene }, phase === "live" ? "Sample scene saved. Live video keeps your real background." : "Sample background updated.")));
    $$(".segment[data-frame]").forEach(button => button.addEventListener("click", () => applyChanges({ frame: button.dataset.frame })));
    for (const key of Object.keys(limits)) on(`${key}Range`, "input", event => applyChanges({ [key]: Number(event.target.value) }));
    for (const [id, key] of Object.entries({ softnessSwitch: "softness", frameSwitch: "showFrame", eyeLineSwitch: "eyeLine", mirrorSwitch: "mirror", gridSwitch: "grid", splitSwitch: "split", autoPauseSwitch: "autoPause" })) on(id, "click", () => applyChanges({ [key]: !state[key] }));
    on("timerSelect", "change", event => { cancelCapture(); applyChanges({ timer: Number(event.target.value) }); });
    on("snapshotFormat", "change", event => applyChanges({ snapshotFormat: event.target.value }));
    on("qualitySelect", "change", event => applyChanges({ quality: event.target.value }));
    on("cameraSelect", "change", event => { selectedCameraId = event.target.value; if (phase === "live") { stopCamera(false); startCamera(); } });
    on("privacyButton", "click", activatePrivacyShield); on("shieldQuickButton", "click", activatePrivacyShield); on("startCameraButton", "click", startCamera); on("retryCameraButton", "click", startCamera);
    on("stopCameraButton", "click", () => stopCamera()); on("captureButton", "click", captureSnapshot);
    on("fixNaturallyButton", "click", () => { applyProfile("natural"); text("readinessTitle", "A natural starting point"); text("readinessText", "A gentle light and color preset is applied. Check the preview and adjust it for your room."); }); on("resetButton", "click", resetSettings);
    on("savePresetButton", "click", savePreset); on("presetName", "keydown", event => { if (event.key === "Enter") { event.preventDefault(); savePreset(); } }); on("importPresetInput", "change", importPresets);
    on("exportPresetButton", "click", () => { if (presets.length) downloadBlob(new Blob([JSON.stringify({ schema: "meetinglens.presets", version: 1, presets }, null, 2)], { type: "application/json" }), "meetinglens-setups.json"); });
    on("clearPresetsButton", "click", () => { presets = []; writeStorage(PRESETS_KEY, presets); renderPresets(); showToast("Saved setups cleared. Your current adjustments remain."); });
    on("fullscreenButton", "click", async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else { const target = canvas.closest(".preview-shell, .preview-stage, .canvas-wrap") || canvas.parentElement; if (target?.requestFullscreen) await target.requestFullscreen(); else showToast("Fullscreen is unavailable in this browser."); } } catch { showToast("Fullscreen could not open. You can maximize the app window instead."); } });
    on("holdOriginalButton", "pointerdown", event => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); setOriginal(true); });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) on("holdOriginalButton", event, () => setOriginal(false));
    on("holdOriginalButton", "keydown", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setOriginal(true); } });
    on("holdOriginalButton", "keyup", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setOriginal(false); } });
    document.addEventListener("keydown", event => { if (isEditing(event) || event.repeat) return; if (event.altKey && event.key.toLowerCase() === "p") { event.preventDefault(); activatePrivacyShield(); } else if (event.altKey && event.key.toLowerCase() === "s") { event.preventDefault(); captureSnapshot(); } else if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "c") { event.preventDefault(); setOriginal(true); } });
    document.addEventListener("keyup", event => { if (event.key.toLowerCase() === "c") setOriginal(false); }); window.addEventListener("blur", () => setOriginal(false)); on("cameraVideo", "loadedmetadata", updateCameraUI);
    navigator.mediaDevices?.addEventListener?.("devicechange", () => { clearTimeout(deviceRefreshTimer); deviceRefreshTimer = setTimeout(handleDeviceChange, 250); });
    document.addEventListener("visibilitychange", () => { setOriginal(false); cancelCapture(); if (document.hidden) { if (phase === "starting" || (phase === "live" && state.autoPause)) stopCamera(false, "paused"); else { if (rafId) cancelAnimationFrame(rafId); rafId = 0; sampleStart = 0; sampleFrames = 0; measuredFps = null; } } else { updateCameraUI(); requestRender(); } });
    window.addEventListener("pagehide", () => { stopCamera(false); disposed = true; clearTimeout(deviceRefreshTimer); for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); });
    window.addEventListener("pageshow", event => { if (event.persisted) { disposed = false; phase = "demo"; updateControls(); requestRender(); } });
    window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; hide("installButton", false); });
    on("installButton", "click", async () => { if (!deferredInstallPrompt) return; try { await deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; } catch { showToast("Use your browser’s Install app option to install MeetingLens."); } deferredInstallPrompt = null; hide("installButton", true); });
    window.addEventListener("appinstalled", () => { hide("installButton", true); showToast("MeetingLens installed."); }); window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
    on("updateNotice", "click", () => { if (!swRegistration?.waiting) return; updateRequested = true; stopCamera(false); swRegistration.waiting.postMessage({ type: "SKIP_WAITING" }); });
  }
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    try {
      swRegistration = await navigator.serviceWorker.register("./service-worker.js");
      const notify = () => { if (swRegistration.waiting) { text("updateNotice", "Update ready · restart studio"); hide("updateNotice", false); } }; notify();
      swRegistration.addEventListener("updatefound", () => { const worker = swRegistration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed") notify(); }); });
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (updateRequested) location.reload(); });
    } catch { /* Editing works when offline caching is unavailable. */ }
  }
  portrait.onload = () => { portraitReady = true; demoDirty = true; requestRender(); };
  let triedPng = false; portrait.onerror = () => { if (!triedPng) { triedPng = true; portrait.src = "./assets/demo/professional-portrait.png"; } else { portraitFailed = true; demoDirty = true; requestRender(); } };
  portrait.src = "./assets/demo/professional-portrait.webp";
  resizeOutput(); registerEvents(); updateControls(); renderPresets(); storageNotice(); updateConnection(); refreshDevices(); registerServiceWorker(); requestRender();
  const params = new URLSearchParams(location.search); if (Object.prototype.hasOwnProperty.call(panelText, params.get("screen"))) setPanel(params.get("screen"));
  if (params.get("action") === "camera") showToast("Select Start camera when you are ready to grant permission.");
})();
