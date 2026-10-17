(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);
  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const hide = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
  const defaults = Object.freeze({ look: "natural", brightness: 56, contrast: 54, saturation: 53, enhancement: 65,
    softness: false, scene: "room", sceneStrength: 25, frame: "conversation", zoom: 100, showFrame: true,
    eyeLine: true, mirror: true, grid: false, temperature: 0, vignette: 8, split: false,
    quality: "balanced", timer: 0, snapshotFormat: "png", autoPause: true,
    autoFrame: false, backgroundBlur: false, backgroundReplace: false, headDetail: true, blurAmount: 12, portraitLight: false, portraitLightAmount: 50,
    refinement: false, teeth: false, browserBasic: false, requestedResolution: "auto", requestedFps: 30 });
  const limits = { brightness: [0, 100], contrast: [0, 100], saturation: [0, 100], enhancement: [0, 100],
    sceneStrength: [0, 100], zoom: [100, 200], temperature: [-50, 50], vignette: [0, 60], blurAmount: [0, 30], portraitLightAmount: [0, 100] };
  const enums = { look: ["natural", "clear", "warm", "studio", "mono", "brand"],
    scene: ["room", "soft", "studio", "night", "dawn", "slate"], frame: ["conversation", "teaching", "wide"],
    quality: ["balanced", "high", "efficient"], timer: [0, 3, 5], snapshotFormat: ["png", "jpeg"],
    requestedResolution: ["auto", "640x480", "1280x720", "1920x1080", "2560x1440", "3840x2160"], requestedFps: [15, 24, 30, 60] };
  const SETTINGS_KEY = "meetinglens-settings", PRESETS_KEY = "meetinglens-presets-v1", MAX_PRESETS = 20;
  let storageProblem = false;

  // Only known keys with the expected type enter the state, including imported JSON.
  function sanitize(input) {
    const clean = { ...defaults };
    if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
    for (const key of Object.keys(defaults)) {
      const value = Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined;
      if (limits[key] && typeof value === "number" && Number.isFinite(value)) { const v = Math.min(limits[key][1], Math.max(limits[key][0], value)); clean[key] = key === "zoom" ? Math.round(v * 10) / 10 : Math.round(v); }
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
  const sceneNames = { room: "Executive office", soft: "Scandinavian office", studio: "Architect studio", night: "City lounge", dawn: "Warm library", slate: "Minimal gallery" };
  const sceneFiles = { room: "executive-office", soft: "scandinavian-office", studio: "architect-studio", night: "city-lounge", dawn: "warm-library", slate: "minimal-gallery" };
  const sceneImages = new Map();
  const rawEffectCanvas = document.createElement("canvas"), processedEffectCanvas = document.createElement("canvas");
  // Keep only the completed frame and one frame being analyzed. A person mask
  // must cut out the same pixels that produced it, rather than a newer pose.
  const liveAnalysisFrames = [document.createElement("canvas"), document.createElement("canvas")];
  let pairedVisionFrame = null, pendingVisionFrame = null, pairedVisionTimestamp = 0, comparisonSource = null;
  let effectSampleStart = 0, effectSampleFrames = 0, lastEffectFrameAt = 0, measuredEffectFps = null;
  let visionReady = false, visionLoading = false, visionCapabilities = {}, analysis = null, analysisCompletedAt = 0, analysisValidForMs = 1500, visionPending = false, visionGeneration = 0;
  let lastVisionAt = -Infinity, demoRevision = 0, analyzedDemoRevision = -1, trackingCenter = null, visionRetryTimer = null, replacementRendered = false, blurRendered = false;
  let visionStartupError = "", visionFrameError = "", visionModelErrors = {};
  let sessionTools = null;
  const LIVE_ANALYSIS_MAX_AGE = 1500;
  const panelText = { studio: ["Your studio", "SESSION OVERVIEW"], looks: ["Light & color", "NATURAL ENHANCEMENT"],
    background: ["Camera backgrounds", "SCENE EXPLORER"], frame: ["Framing & capture", "COMPOSITION"],
    device: ["Camera & capture", "DEVICE SETUP"], presets: ["My presets", "SAVED SETUPS"], privacy: ["Privacy & settings", "ON YOUR DEVICE"],
    effects: ["Live effects", "LOCAL CAMERA INTELLIGENCE"], session: ["Voice, QR & backup", "SESSION TOOLS"] };

  function resetVision() {
    visionGeneration++; analysis = null; analysisCompletedAt = 0; analysisValidForMs = LIVE_ANALYSIS_MAX_AGE; trackingCenter = null; lastVisionAt = -Infinity; analyzedDemoRevision = -1; replacementRendered = blurRendered = false;
    pairedVisionFrame = pendingVisionFrame = comparisonSource = null; pairedVisionTimestamp = 0;
    resetEffectFrameRate();
    for (const frame of [...liveAnalysisFrames, rawEffectCanvas, processedEffectCanvas]) clearAnalysisFrame(frame);
    clearTimeout(visionRetryTimer); visionRetryTimer = null;
    window.MeetingLensVision?.reset();
  }
  function clearAnalysisFrame(frame) { if (frame) { frame.width = 1; frame.height = 1; } }
  function resetEffectFrameRate() { effectSampleStart = effectSampleFrames = lastEffectFrameAt = 0; measuredEffectFps = null; }
  function recordEffectFrame() {
    const now = performance.now();
    if (!effectSampleStart) {
      effectSampleStart = now; effectSampleFrames = 0; measuredEffectFps = null;
    } else {
      effectSampleFrames++;
      if (now - effectSampleStart >= 1200) {
        measuredEffectFps = Math.round(effectSampleFrames * 10000 / (now - effectSampleStart)) / 10;
        effectSampleStart = now; effectSampleFrames = 0;
      }
    }
    lastEffectFrameAt = now; updateFrameRateLabel();
  }
  function updateFrameRateLabel() {
    if (phase !== "live") { text("fpsLabel", "Sample · still image"); return; }
    if (cameraMuted) { text("fpsLabel", "Signal paused"); return; }
    const personEffects = visionCapabilities.segmentation && effectsActive() && (state.backgroundBlur || state.portraitLight ||
      (state.backgroundReplace && sceneImages.get(state.scene)?.status === "ready"));
    if (personEffects) {
      const paired = pairedVisionFrame && currentAnalysis()?.timestamp === pairedVisionTimestamp;
      const rate = measuredEffectFps === null ? null : measuredEffectFps < 10 ? measuredEffectFps.toFixed(1) : Math.round(measuredEffectFps);
      text("fpsLabel", !paired ? "Processing background…" : rate === null ? "Measuring effects…" : `${rate} fps · effects`);
    } else text("fpsLabel", measuredFps === null ? "Measuring preview refresh…" : `${measuredFps} fps · preview refresh`);
  }
  function freezeAnalysisFrame(source) {
    const frame = liveAnalysisFrames.find(candidate => candidate !== pairedVisionFrame && candidate !== pendingVisionFrame);
    const sw = source?.videoWidth || source?.naturalWidth || source?.width || 0, sh = source?.videoHeight || source?.naturalHeight || source?.height || 0;
    if (!frame || !sw || !sh) return null;
    const scale = Math.min(1, (state.quality === "efficient" ? 640 : 1280) / Math.max(sw, sh));
    frame.width = Math.max(1, Math.round(sw * scale)); frame.height = Math.max(1, Math.round(sh * scale));
    try { frame.getContext("2d", { alpha: false }).drawImage(source, 0, 0, frame.width, frame.height); return frame; }
    catch { clearAnalysisFrame(frame); return null; }
  }
  function effectsActive() { return visionReady && !state.browserBasic && !state.originalHeld && state.enhancement > 0 &&
    ((visionCapabilities.face && (state.autoFrame || state.refinement || state.teeth)) ||
      (visionCapabilities.segmentation && (state.backgroundBlur || state.portraitLight || (state.backgroundReplace && phase === "live")))); }
  function backgroundBlurApplied() {
    const fresh = currentAnalysis();
    return Boolean(blurRendered && state.backgroundBlur && effectsActive() && visionCapabilities.segmentation && fresh?.mask &&
      (phase !== "live" || (pairedVisionFrame && pairedVisionTimestamp === fresh.timestamp)));
  }
  function currentAnalysis() {
    // A completed person mask uses its retained camera frame, so its lifetime
    // starts on completion. Face-only tracking still follows capture age.
    // Both paths expire if the worker stops returning fresh results.
    const paired = analysis?.mask && pairedVisionFrame && pairedVisionTimestamp === analysis.timestamp;
    const freshnessAt = paired ? analysisCompletedAt : analysis?.timestamp;
    const validForMs = paired ? analysisValidForMs : LIVE_ANALYSIS_MAX_AGE;
    if (phase === "live" && analysis && (!Number.isFinite(freshnessAt) || performance.now() - freshnessAt > validForMs)) return null;
    return analysis;
  }
  function visionErrorText(value) {
    return String(value?.message || value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  }
  function renderVisionDiagnostics() {
    const lines = [];
    if (visionStartupError) lines.push(`Local AI: ${visionStartupError}`);
    if (visionModelErrors.segmentation) lines.push(`Background detection: ${visionModelErrors.segmentation}`);
    if (visionModelErrors.face) lines.push(`Face tracking: ${visionModelErrors.face}`);
    if (visionFrameError) lines.push(`Frame processing: ${visionFrameError}`);
    text("visionDiagnosticText", lines.join("\n")); hide("visionDiagnostics", lines.length === 0);
  }
  function recordVisionStatus(status) {
    if (status.state === "loading") { visionStartupError = visionFrameError = ""; visionModelErrors = {}; }
    const capabilities = status.capabilities;
    if (capabilities) {
      for (const name of ["face", "segmentation"]) {
        if (capabilities[name]) delete visionModelErrors[name];
        else if (capabilities.errors?.[name]) visionModelErrors[name] = visionErrorText(capabilities.errors[name]);
      }
    }
    if (status.error) {
      if (status.state === "recovering") visionFrameError = visionErrorText(status.error);
      else visionStartupError = visionErrorText(status.error);
    } else if (status.state === "ready") { visionStartupError = visionFrameError = ""; }
    renderVisionDiagnostics();
  }
  function loadRequiredVision() {
    if (phase !== "live" || visionLoading || disposed || state.privacy || state.browserBasic || state.originalHeld || state.enhancement <= 0 || document.hidden || cameraMuted) return;
    const face = state.autoFrame || state.refinement || state.teeth;
    const segmentation = state.backgroundBlur || state.portraitLight || state.backgroundReplace;
    if ((face || segmentation) && (!visionReady || (face && !visionCapabilities.face) || (segmentation && !visionCapabilities.segmentation))) enableVision();
  }
  async function enableVision() {
    if (visionLoading || (visionReady && visionCapabilities.face && visionCapabilities.segmentation)) return;
    if (!window.MeetingLensVision) { text("visionStatus", "Local vision files are unavailable. Manual controls still work."); recordVisionStatus({ state: "error", error: "The local vision script did not load. Check assets/js/vision-effects.js in this deployment." }); updateLiveBackgroundStatus(); return; }
    visionLoading = true; visionReady = false; resetVision(); updateControls();
    try {
      visionCapabilities = await window.MeetingLensVision.init({ onStatus: status => {
        recordVisionStatus(status);
        text("visionStatus", status.message || "Checking local models…");
        if (status.capabilities) visionCapabilities = { ...status.capabilities };
        if (status.capabilities && status.state === "ready") {
          visionReady = Boolean(visionCapabilities.face || visionCapabilities.segmentation);
          updateControls();
        }
        if (status.state === "error" || status.state === "unavailable") { visionReady = false; updateControls(); }
      } });
      visionReady = Boolean(visionCapabilities.face || visionCapabilities.segmentation);
      if (visionReady) { resetVision(); requestRender(); }
    } catch (error) { text("visionStatus", "Local AI could not start. Check AI diagnostic details below."); recordVisionStatus({ state: "error", error }); }
    finally { visionLoading = false; updateControls(); }
  }
  function scheduleAnalysis(source) {
    if (!effectsActive() || visionPending || disposed || state.privacy || document.hidden || cameraMuted) return;
    const now = performance.now();
    const live = phase === "live", face = Boolean(visionCapabilities.face && (state.autoFrame || state.refinement || state.teeth));
    const segmentation = Boolean(visionCapabilities.segmentation && (state.backgroundBlur || state.portraitLight || (state.backgroundReplace && live)));
    const interval = segmentation ? Math.max(face ? 125 : 33, Number(visionCapabilities.analysisIntervalMs) || 125) : 200;
    if (live ? now - lastVisionAt < interval : analyzedDemoRevision === demoRevision) return;
    const requestFrame = live && segmentation ? freezeAnalysisFrame(source) : null;
    if (live && segmentation && !requestFrame) return;
    pendingVisionFrame = requestFrame;
    lastVisionAt = now; analyzedDemoRevision = demoRevision; visionPending = true;
    const generation = visionGeneration;
    window.MeetingLensVision.analyze(requestFrame || source, now, { face, segmentation, headDetail: Boolean(state.headDetail && segmentation && (state.backgroundBlur || state.backgroundReplace)) }).then(result => {
      if (generation !== visionGeneration || disposed || state.privacy || cameraMuted) return;
      if (document.hidden) { analyzedDemoRevision = -1; return; }
      // analyze() can return its previous cache after a recoverable frame error.
      // Never associate those old mask pixels with this request's new frame.
      if (!Number.isFinite(result?.timestamp) || result.timestamp < now) {
        if (!live) { analyzedDemoRevision = -1; clearTimeout(visionRetryTimer); visionRetryTimer = setTimeout(requestRender, 250); }
        return;
      }
      if (requestFrame) {
        const previous = pairedVisionFrame;
        pairedVisionFrame = result.mask ? requestFrame : null; pairedVisionTimestamp = result.mask ? result.timestamp : 0;
        if (previous && previous !== pairedVisionFrame) clearAnalysisFrame(previous);
      }
      analysis = result; analysisCompletedAt = performance.now();
      if (visionFrameError) { visionFrameError = ""; renderVisionDiagnostics(); }
      analysisValidForMs = Math.max(LIVE_ANALYSIS_MAX_AGE, Math.min(5000, (analysisCompletedAt - result.timestamp) * 2.5));
      if (requestFrame) { if (result.mask && !state.originalHeld) recordEffectFrame(); else resetEffectFrameRate(); }
      const slow = result.mask && analysisCompletedAt - result.timestamp > LIVE_ANALYSIS_MAX_AGE;
      text("trackingStatus", (result.face ? "Face located · local tracking active" : state.autoFrame ? "No face located · using the wider frame" : "Local person effects active") + (slow ? " · slower processing on this device" : ""));
      requestRender();
    }).catch(error => { if (generation === visionGeneration && !state.privacy && !document.hidden && !disposed) { text("trackingStatus", "Frame analysis paused. Manual preview remains available."); recordVisionStatus({ state: "recovering", error }); } }).finally(() => {
      if (requestFrame && requestFrame !== pairedVisionFrame) clearAnalysisFrame(requestFrame);
      if (pendingVisionFrame === requestFrame) pendingVisionFrame = null;
      visionPending = false; if (generation !== visionGeneration) requestRender();
    });
  }
  function prepareEffects(source) {
    replacementRendered = blurRendered = false; comparisonSource = source;
    scheduleAnalysis(source);
    const freshAnalysis = currentAnalysis();
    if (!effectsActive() || !freshAnalysis) {
      if (effectsActive() && analysis && phase === "live") { trackingCenter = null; text("trackingStatus", "Live analysis delayed · using the wider frame and manual preview"); }
      return source;
    }
    const scene = sceneImages.get(state.scene);
    const backgroundImage = visionCapabilities.segmentation && phase === "live" && state.backgroundReplace && scene?.status === "ready" ? scene.image : null;
    const backgroundBlur = visionCapabilities.segmentation && state.backgroundBlur;
    const portraitLight = visionCapabilities.segmentation && state.portraitLight;
    if (phase === "live" && (backgroundImage || backgroundBlur || portraitLight)) {
      if (!freshAnalysis.mask || !pairedVisionFrame || pairedVisionTimestamp !== freshAnalysis.timestamp) return source;
      // Hold this complete frame until the next matching result arrives. This
      // adds inference latency, but cannot erase a newly moved arm with an old
      // silhouette. Original/Basic paths bypass effects and stay current.
      source = comparisonSource = pairedVisionFrame;
    }
    const sw = source === video ? video.videoWidth : source.width, sh = source === video ? video.videoHeight : source.height;
    const scale = Math.min(1, (state.quality === "efficient" ? 640 : 1280) / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    if (rawEffectCanvas.width !== w || rawEffectCanvas.height !== h) { rawEffectCanvas.width = w; rawEffectCanvas.height = h; }
    rawEffectCanvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, w, h);
    try {
      const strength = state.enhancement / 100;
      window.MeetingLensVision.process(rawEffectCanvas, processedEffectCanvas, { analysis: freshAnalysis,
        backgroundImage, backgroundSoftness: backgroundImage ? state.sceneStrength / 100 * 8 * strength : 0,
        backgroundBlur: backgroundBlur ? state.blurAmount * strength : 0,
        portraitLight: portraitLight ? state.portraitLightAmount / 100 * strength : 0,
        skinSmoothing: visionCapabilities.face && state.refinement ? .35 * strength : 0, teethWhitening: visionCapabilities.face && state.teeth ? .35 * strength : 0 });
      replacementRendered = Boolean(backgroundImage && window.MeetingLensVision.lastBackgroundApplied);
      blurRendered = Boolean(!backgroundImage && backgroundBlur && state.blurAmount > 0 && freshAnalysis.mask);
      return processedEffectCanvas;
    } catch { return source; }
  }
  function updateDeviceCapabilities() {
    const track = activeStream?.getVideoTracks()[0], caps = track?.getCapabilities?.() || {}, actual = track?.getSettings?.() || {};
    text("cameraCapabilitiesText", track ? "Actual input: " + (actual.width || "—") + " × " + (actual.height || "—") + " at " + Math.round(actual.frameRate || 0) + " fps. Driver ranges are hints; unsupported requests fall back safely." : "Start a camera to inspect the modes its driver exposes. Requested modes are not guaranteed.");
    const select = $("#deviceResolutionSelect");
    if (select) [...select.options].forEach(option => {
      if (option.value === "auto") return;
      const [w, h] = option.value.split("x").map(Number);
      option.disabled = Boolean(caps.width?.max && (w > caps.width.max || h > (caps.height?.max || Infinity)));
    });
  }

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
    const lightRange = $("#portraitLightRange"); if (lightRange) lightRange.value = state.portraitLightAmount;
    text("portraitLightOutput", state.portraitLightAmount + "%"); text("blurAmountOutput", state.blurAmount + " px");
    for (const [id, key] of Object.entries({ autoFrameSwitch: "autoFrame", backgroundBlurSwitch: "backgroundBlur", headDetailSwitch: "headDetail", portraitLightSwitch: "portraitLight", refinementSwitch: "refinement", teethSwitch: "teeth", browserBasicSwitch: "browserBasic" })) setSwitch(id, state[key]);
    setSwitch("replaceBackgroundSwitch", state.backgroundReplace);
    const replaceSwitch = $("#replaceBackgroundSwitch"); if (replaceSwitch) replaceSwitch.disabled = state.browserBasic;
    const headDetailSwitch = $("#headDetailSwitch"); if (headDetailSwitch) headDetailSwitch.disabled = state.browserBasic;
    for (const id of ["autoFrameSwitch", "backgroundBlurSwitch", "portraitLightSwitch", "refinementSwitch", "teethSwitch"]) {
      const el = document.getElementById(id); if (el) el.disabled = !visionReady || state.browserBasic || (id === "backgroundBlurSwitch" || id === "portraitLightSwitch" ? !visionCapabilities.segmentation : !visionCapabilities.face);
    }
    const resolution = $("#deviceResolutionSelect"); if (resolution) resolution.value = state.requestedResolution;
    const fps = $("#deviceFpsSelect"); if (fps) fps.value = String(state.requestedFps);
    const allModelsReady = visionReady && visionCapabilities.face && visionCapabilities.segmentation;
    const aiButton = $("#enableVisionButton"); if (aiButton) { aiButton.disabled = visionLoading || allModelsReady; aiButton.textContent = visionLoading ? "Loading local models…" : allModelsReady ? "Local models ready" : visionReady ? "Retry unavailable model" : "Load local AI models"; }
    const guide = $("#frameGuide"); if (guide) { guide.classList.toggle("hidden", !state.showFrame); guide.hidden = !state.showFrame; guide.dataset.frame = state.frame; }
    hide("eyeLineGuide", !state.eyeLine); hide("thirdsGrid", !state.grid); hide("splitLine", !state.split || state.originalHeld || state.privacy);
    for (const [selector, key] of [[".look-button", "look"], [".scene-button", "scene"], [".segment[data-frame]", "frame"]]) $$(selector).forEach(button => { const active = button.dataset[key] === state[key]; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $$(".profile-button").forEach(button => { const active = button.dataset.profile === currentProfile(); button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#holdOriginalButton")?.setAttribute("aria-pressed", String(state.originalHeld)); updateLabels(); updateCameraUI();
  }
  function updateLabels() {
    const live = phase === "live";
    text("effectLabel", state.browserBasic ? "Basic preview · app effects bypassed" : state.originalHeld || state.enhancement === 0 ? "Original · effects bypassed" : `${lookNames[state.look]}${backgroundBlurApplied() ? " · background blur" : ""} · ${live ? replacementRendered ? sceneNames[state.scene] : "Your camera background" : sceneNames[state.scene]}`);
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
    text("cameraSetupState", live ? "Connected · camera stream is video only" : starting ? "Permission request pending" : "Optional · camera permission required");
    const start = $("#startCameraButton"); if (start) { start.disabled = starting || live || state.privacy; start.setAttribute("aria-busy", String(starting)); start.innerHTML = `<span class="camera-icon" aria-hidden="true"></span>${starting ? "Connecting…" : live ? "Camera is on" : "Start camera"}`; }
    const stop = $("#stopCameraButton"); if (stop) stop.disabled = !starting && !activeStream;
    const capture = $("#captureButton"); if (capture) capture.disabled = state.privacy || starting || countdownActive || cameraMuted;
    const original = $("#holdOriginalButton"); if (original) original.disabled = state.privacy || starting;
    for (const id of ["cameraSelect", "qualitySelect", "deviceResolutionSelect", "deviceFpsSelect"]) { const el = document.getElementById(id); if (el) el.disabled = starting; }
    $("#privacyCurtain")?.classList.toggle("visible", state.privacy); $("#privacyCurtain")?.setAttribute("aria-hidden", String(!state.privacy));
    for (const id of ["privacyButton", "shieldQuickButton"]) { const el = document.getElementById(id); if (el) { el.setAttribute("aria-pressed", String(state.privacy)); el.classList.toggle("active", state.privacy); } }
    text("privacyButton", state.privacy ? "Deactivate Privacy Shield" : "Activate Privacy Shield");
    $("#shieldQuickButton")?.setAttribute("aria-label", state.privacy ? "Deactivate Privacy Shield" : "Activate Privacy Shield");
    if (!live) { text("resolutionLabel", `${canvas.width} × ${canvas.height} sample`); text("deviceLabel", "Camera is off"); }
    else { const track = activeStream?.getVideoTracks()[0]; text("deviceLabel", track?.label || "Connected camera"); text("resolutionLabel", `${canvas.width} × ${canvas.height} output`); text("cameraSetupState", `${video.videoWidth || track?.getSettings?.().width || "—"} × ${video.videoHeight || track?.getSettings?.().height || "—"} input · camera stream is video only`); }
    updateFrameRateLabel();
    updateBackgroundNotice();
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

  function updateBackgroundNotice() {
    const scene = sceneImages.get(state.scene), failed = scene?.status === "failed";
    text("backgroundNotice", phase === "live" ? "The selected background image is unavailable. Your camera background is shown. Choose another scene or retry." : "This sample background is unavailable. A neutral studio is shown. Choose another space, or reload when online.");
    hide("backgroundNotice", !failed || state.privacy || (phase === "live" && !state.backgroundReplace));
    text("backgroundLoadStatus", failed ? phase === "live" ? "Background unavailable · camera background shown" : "Background unavailable · neutral studio shown" : scene?.status === "ready" ? `${sceneNames[state.scene]} · ready on this device` : `Loading ${sceneNames[state.scene].toLowerCase()}…`);
    updateLiveBackgroundStatus();
  }
  function updateLiveBackgroundStatus() {
    const scene = sceneImages.get(state.scene), live = phase === "live", requested = state.backgroundReplace || state.backgroundBlur;
    let message, error = false;
    if (state.privacy) message = "Background effects stopped · Privacy Shield is active.";
    else if (state.browserBasic) message = "Basic preview is on. Turn it off in Camera & capture to use background effects.";
    else if (state.originalHeld) message = "Showing your original camera background while Original is held.";
    else if (state.enhancement === 0 && live && requested) message = "Intensity is 0%. Increase the preview intensity to apply background effects.";
    else if (!live) message = state.backgroundReplace ? `${sceneNames[state.scene]} selected. Start your camera to apply it behind you.` : state.backgroundBlur ? "Background blur selected. Start your camera to apply it." : "Choose a scene, then start your camera. Background detection loads locally when needed.";
    else if (!requested) message = "Your real camera background is shown. Click any scene below to replace it.";
    else if (visionLoading) message = "Loading local background detection… Your camera room is visible until it is ready.";
    else if (!visionReady || !visionCapabilities.segmentation) { const cause = visionModelErrors.segmentation || visionStartupError; message = "Background detection is unavailable. Your camera room is shown. " + (cause ? `Cause: ${cause} ` : "") + "Select Retry background to try again."; error = true; }
    else if (!state.backgroundReplace) {
      if (state.blurAmount === 0) message = "Blur depth is 0. Increase blur depth in Live effects to soften your camera background.";
      else if (backgroundBlurApplied()) message = "Live background blur · processed on this device";
      else if (!currentAnalysis()?.mask) message = analysis ? "Background tracking is delayed. Your camera room is shown until detection recovers." : "Finding you in the camera… Your camera room is shown until detection is ready.";
      else { message = "Background blur could not render. Your camera room is shown. Select Retry background to try again."; error = true; }
    }
    else if (scene?.status === "failed") { message = "This background image could not load. Choose another scene or select Retry background."; error = true; }
    else if (scene?.status !== "ready") message = `Loading ${sceneNames[state.scene]}… Your camera room is shown until it is ready.`;
    else if (!currentAnalysis()?.mask) message = analysis ? "Background tracking is delayed. Your camera room is shown until detection recovers." : "Finding you in the camera… Your camera room is shown until detection is ready.";
    else if (replacementRendered) message = `Live background: ${sceneNames[state.scene]} · processed on this device`;
    else { message = "Background replacement could not render. Your camera room is shown. Try another scene or retry."; error = true; }
    const status = $("#liveBackgroundStatus"); if (status) { if (status.textContent !== message) status.textContent = message; status.dataset.level = error ? "error" : "info"; }
    hide("retryBackgroundButton", !live || !requested || visionLoading || !error || state.browserBasic || state.privacy);
    if (live) {
      const label = state.browserBasic ? "Basic preview · app effects bypassed" : state.originalHeld || state.enhancement === 0 ? "Original · effects bypassed" : `${lookNames[state.look]} · ${replacementRendered ? sceneNames[state.scene] : backgroundBlurApplied() ? "background blur" : "Your camera background"}`;
      const element = $("#effectLabel"); if (element && element.textContent !== label) element.textContent = label;
    }
  }
  function selectBackground(scene) {
    if (!Object.hasOwn(sceneNames, scene)) return;
    if (sceneImages.get(scene)?.status === "failed") sceneImages.delete(scene);
    applyChanges({ scene, backgroundReplace: true }, phase === "live" ? "Applying your selected camera background…" : "Background selected. It will apply when you start your camera.");
    loadScene(scene);
    loadRequiredVision();
    updateLiveBackgroundStatus();
  }
  function loadScene(scene) {
    if (sceneImages.has(scene)) return;
    const image = new Image(), entry = { image, status: "loading" };
    sceneImages.set(scene, entry); image.decoding = "async";
    const finish = status => {
      entry.status = status;
      // Each scene keeps its own image. A late response can never replace the
      // selected scene or trigger a redundant render after the user moves on.
      if (state.scene !== scene || disposed) return;
      demoDirty = true; updateBackgroundNotice(); requestRender();
    };
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? "ready" : "failed");
    image.onerror = () => finish("failed");
    image.src = `./assets/demo/backgrounds/${sceneFiles[scene]}.webp`;
    if (state.scene === scene) updateBackgroundNotice();
  }
  function drawDemoSource() {
    if (!demoDirty || !demoCtx) return; demoDirty = false; demoRevision++;
    const w = demoCanvas.width, h = demoCanvas.height;
    // A quiet studio gradient stays usable while an image loads or is missing.
    const neutral = demoCtx.createRadialGradient(w * .4, h * .35, 0, w * .5, h * .5, w * .8);
    neutral.addColorStop(0, "#d0d3d3"); neutral.addColorStop(1, "#7b878c");
    demoCtx.fillStyle = neutral; demoCtx.fillRect(0, 0, w, h);
    const background = sceneImages.get(state.scene);
    if (background?.status === "ready") {
      const image = background.image, blur = state.sceneStrength / 100 * 8 * h / 720;
      const padding = Math.ceil(blur * 3 + 2), dw = w + padding * 2, dh = h + padding * 2;
      const scale = Math.max(dw / image.naturalWidth, dh / image.naturalHeight);
      const sw = dw / scale, sh = dh / scale;
      demoCtx.save(); demoCtx.filter = blur > 0 ? `blur(${blur}px)` : "none";
      // Overscan keeps the blurred image edge outside the visible canvas.
      demoCtx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, -padding, -padding, dw, dh);
      demoCtx.restore();
    }
    if (portraitReady) { const height = h * .985, width = portrait.naturalWidth * height / portrait.naturalHeight; demoCtx.drawImage(portrait, (w - width) / 2, h - height, width, height); }
    else { demoCtx.fillStyle = "rgba(14,27,40,.65)"; demoCtx.beginPath(); demoCtx.arc(w / 2, h * .45, 68, 0, Math.PI * 2); demoCtx.fill(); demoCtx.fillStyle = "#e6edf1"; demoCtx.font = "500 35px system-ui"; demoCtx.textAlign = "center"; demoCtx.fillText("ML", w / 2, h * .45 + 12); demoCtx.font = "20px system-ui"; demoCtx.fillText(portraitFailed ? "Sample portrait unavailable · start your camera" : "Loading professional sample…", w / 2, h * .66); }
  }
  function filterString(original = false) {
    const strength = original || state.browserBasic ? 0 : state.enhancement / 100; if (strength === 0) return "none";
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
    let zoom = state.browserBasic ? 1 : Math.max(1, state.zoom / 100), centerX = .5, centerY = .5;
    const freshAnalysis = currentAnalysis();
    if (!original && effectsActive() && state.autoFrame && freshAnalysis?.face) {
      const face = freshAnalysis.face, target = { x: Math.max(0, Math.min(1, face.x + face.width / 2)), y: Math.max(0, Math.min(1, face.y + face.height / 2)), zoom: Math.max(zoom, Math.min(2, .32 / Math.max(.05, face.height))) };
      if (!trackingCenter) trackingCenter = target;
      else for (const key of ["x", "y", "zoom"]) trackingCenter[key] += (target[key] - trackingCenter[key]) * .18;
      zoom = trackingCenter.zoom; centerX = trackingCenter.x; centerY = trackingCenter.y;
    }
    cropWidth /= zoom; cropHeight /= zoom;
    if (!original && effectsActive() && state.autoFrame && freshAnalysis?.face) centerY += .12 * cropHeight / sh;
    const sx = Math.max(0, Math.min(sw - cropWidth, centerX * sw - cropWidth / 2)), sy = Math.max(0, Math.min(sh - cropHeight, centerY * sh - cropHeight / 2));
    ctx.save(); ctx.filter = filterString(original); if (state.mirror && !state.browserBasic) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, w, h); ctx.restore();
    const strength = original || state.browserBasic ? 0 : state.enhancement / 100;
    if (strength && state.temperature) { const alpha = Math.abs(state.temperature) / 50 * .13 * strength; ctx.fillStyle = state.temperature > 0 ? `rgba(255,161,62,${alpha})` : `rgba(58,139,255,${alpha})`; ctx.fillRect(0, 0, w, h); }
    if (strength && state.vignette) { const vignette = ctx.createRadialGradient(w / 2, h * .46, h * .30, w / 2, h / 2, w * .68); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, `rgba(3,9,18,${state.vignette / 100 * strength})`); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h); }
  }
  function drawFrame() {
    if (state.privacy || document.hidden || disposed) return;
    if (phase === "starting" || cameraMuted) { replacementRendered = blurRendered = false; clearPreview(); updateLiveBackgroundStatus(); return; }
    let source; if (phase === "live") { if (video.readyState < 2) return; source = video; } else { drawDemoSource(); source = demoCanvas; }
    source = prepareEffects(source);
    updateLiveBackgroundStatus();
    updateFrameRateLabel();
    ctx.save(); ctx.filter = "none"; ctx.fillStyle = "#101825"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); drawView(source, state.originalHeld);
    if (state.split && !state.originalHeld) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width / 2, canvas.height); ctx.clip(); drawView(comparisonSource, true); ctx.restore(); }
  }
  function requestRender() { dirty = true; if (!rafId && !document.hidden && !state.privacy && !disposed) rafId = requestAnimationFrame(render); }
  function render(time) {
    rafId = 0; if (document.hidden || state.privacy || disposed) return;
    const live = phase === "live", targetFps = state.quality === "efficient" ? Math.min(20, state.requestedFps) : state.requestedFps;
    const newFrame = live && !cameraMuted && video.readyState >= 2 && video.currentTime !== lastVideoTime;
    if (dirty || (newFrame && time - lastRender >= 1000 / targetFps - 1)) {
      drawFrame(); dirty = false; lastRender = time;
      if (newFrame) { lastVideoTime = video.currentTime; if (!sampleStart) sampleStart = time; sampleFrames++; if (time - sampleStart >= 1200) { measuredFps = Math.round(sampleFrames * 1000 / (time - sampleStart)); sampleFrames = 0; sampleStart = time; updateCameraUI(); } }
    }
    if (live) rafId = requestAnimationFrame(render);
  }

  function stopTracks(stream) { stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* Already disconnected. */ } }); }
  function releaseCamera() {
    resetVision();
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
    const size = state.quality === "high" ? [1920, 1080] : state.quality === "efficient" ? [640, 360] : [1280, 720];
    const explicit = state.requestedResolution !== "auto", requested = explicit ? state.requestedResolution.split("x").map(Number) : size;
    return { video: { ...device, width: { [explicit ? "exact" : "ideal"]: requested[0] }, height: { [explicit ? "exact" : "ideal"]: requested[1] }, frameRate: { ideal: state.requestedFps, max: state.requestedFps }, ...(selectedCameraId ? {} : { facingMode: "user" }) }, audio: false };
  }
  async function startCamera() {
    if (disposed || phase === "starting") return;
    if (state.privacy) { showToast("Deactivate Privacy Shield before starting the camera."); return; }
    if (document.hidden) { showToast("Return to the studio before starting the camera."); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { phase = "error"; cameraError("Camera access needs a secure HTTPS page and a supported browser. Publish the app, or use localhost for development."); updateCameraUI(); return; }
    const id = ++requestId; cancelCapture(); releaseCamera(); phase = "starting"; clearCameraError(); updateControls(); requestRender(); let acquired = null, usedFallback = false;
    try {
      try { acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints()); }
      catch (error) { if (error?.name !== "OverconstrainedError" || !requestIsCurrent(id)) throw error; usedFallback = true; acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints(true)); }
      if (!requestIsCurrent(id)) { stopTracks(acquired); return; }
      const track = acquired.getVideoTracks()[0]; if (!track || track.readyState === "ended") throw new Error("No active video track");
      activeStream = acquired; video.srcObject = acquired;
      track.addEventListener("ended", () => { if (activeStream !== acquired) return; stopCamera(false, "error"); cameraError("The camera disconnected or stopped. Reconnect it and select Retry."); refreshDevices(); });
      track.addEventListener("mute", () => { if (activeStream !== acquired || phase !== "live") return; cameraMuted = true; cancelCapture(); resetVision(); clearPreview(); updateCameraUI(); requestRender(); });
      track.addEventListener("unmute", () => { if (activeStream === acquired) { cameraMuted = false; updateCameraUI(); requestRender(); loadRequiredVision(); } });
      let playTimeout;
      try {
        await Promise.race([video.play(), new Promise((_, reject) => {
          playTimeout = setTimeout(() => { const error = new Error("Camera playback timed out"); error.name = "NotReadableError"; reject(error); }, 10000);
        })]);
      } finally { clearTimeout(playTimeout); }
      if (!requestIsCurrent(id) || activeStream !== acquired) { stopTracks(acquired); if (video.srcObject === acquired) video.srcObject = null; if (activeStream === acquired) activeStream = null; return; }
      phase = "live"; cameraMuted = Boolean(track.muted); updateControls(); updateDeviceCapabilities(); requestRender();
      loadRequiredVision();
      await refreshDevices();
      if (requestIsCurrent(id)) showToast(usedFallback ? "Requested camera mode was unavailable. The driver default is shown instead." : "Camera connected. The microphone stays off until you start it separately.");
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
  function activatePrivacyShield() { state.privacy = !state.privacy; sessionTools?.setPrivacyShield(state.privacy); stopCamera(false); updateControls(); showToast(state.privacy ? "Privacy Shield on. Camera and microphone stopped; preview cleared." : "Privacy Shield off. Start the camera when ready."); }

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
        const stamp = new Date().toISOString().replace(/[:.]/g, "-"), filename = `meetinglens-${phase === "live" ? "camera" : "sample"}-${stamp}.${format === "jpeg" ? "jpg" : "png"}`;
        downloadBlob(blob, filename); sessionTools?.backupSnapshot(blob, filename).catch(() => showToast("Snapshot downloaded. Its backup could not be completed.")); showToast("Snapshot downloaded. Framing guides are excluded.");
      }, format === "jpeg" ? "image/jpeg" : "image/png", .92); } catch { showToast("This browser could not create the snapshot. Try PNG format."); }
    };
    if (!state.timer) { finish(); return; }
    countdownActive = true; updateCameraUI(); let remaining = state.timer;
    const tick = () => { if (token !== captureToken || state.privacy || document.hidden || disposed) return; if (!remaining) { finish(); return; } text("countdown", String(remaining--)); hide("countdown", false); captureTimer = setTimeout(tick, 1000); }; tick();
  }
  function applyChanges(changes, message) {
    const visionChanged = ["autoFrame", "backgroundBlur", "backgroundReplace", "headDetail", "portraitLight", "refinement", "teeth", "browserBasic"].some(key => Object.hasOwn(changes, key) && changes[key] !== state[key]);
    const requestModels = ["autoFrame", "backgroundBlur", "backgroundReplace", "portraitLight", "refinement", "teeth"].some(key => changes[key] === true && !state[key]) ||
      (state.browserBasic && changes.browserBasic === false) || (state.enhancement <= 0 && changes.enhancement > 0);
    const oldScene = state.scene, oldStrength = state.sceneStrength, oldQuality = state.quality, oldResolution = state.requestedResolution, oldFps = state.requestedFps; Object.assign(state, sanitize({ ...state, ...changes }));
    if (visionChanged) resetVision();
    if (oldScene !== state.scene || oldStrength !== state.sceneStrength) demoDirty = true;
    if (oldScene !== state.scene) loadScene(state.scene);
    const qualityChanged = oldQuality !== state.quality;
    const restart = (qualityChanged || oldResolution !== state.requestedResolution || oldFps !== state.requestedFps) && (phase === "live" || phase === "starting");
    if (qualityChanged) { cancelCapture(); resizeOutput(); }
    updateControls(); saveSettings(); requestRender(); if (message) showToast(message);
    if (restart) { stopCamera(false); startCamera(); }
    else if (requestModels) loadRequiredVision();
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
  function setOriginal(held) { if (state.originalHeld === held || state.privacy) return; state.originalHeld = held; resetEffectFrameRate(); updateControls(); requestRender(); if (!held) loadRequiredVision(); }
  function isEditing(event) { return Boolean(event.target?.closest?.("input,select,textarea,[contenteditable='true']")); }
  function updateConnection() { text("offlineLabel", navigator.onLine ? "On-device processing" : "Offline · cached studio"); $("#offlineLabel")?.classList.toggle("offline", !navigator.onLine); hide("offlineLabel", navigator.onLine); }
  function registerEvents() {
    $$(".nav-button[data-panel]").forEach(button => button.addEventListener("click", () => setPanel(button.dataset.panel)));
    $$(".profile-button").forEach(button => button.addEventListener("click", () => applyProfile(button.dataset.profile)));
    $$(".look-button").forEach(button => button.addEventListener("click", () => applyChanges({ look: button.dataset.look })));
    $$(".scene-button").forEach(button => button.addEventListener("click", () => selectBackground(button.dataset.scene)));
    on("replaceBackgroundSwitch", "click", () => { if (state.backgroundReplace) applyChanges({ backgroundReplace: false }, "Selected scene disabled. Your camera room is shown."); else selectBackground(state.scene); });
    on("useRealBackgroundButton", "click", () => applyChanges({ backgroundReplace: false, backgroundBlur: false }, "Your real camera background is selected."));
    on("retryBackgroundButton", "click", () => state.backgroundReplace ? selectBackground(state.scene) : enableVision());
    $$(".segment[data-frame]").forEach(button => button.addEventListener("click", () => applyChanges({ frame: button.dataset.frame })));
    for (const key of Object.keys(limits)) on(`${key}Range`, "input", event => applyChanges({ [key]: Number(event.target.value) }));
    for (const [id, key] of Object.entries({ softnessSwitch: "softness", frameSwitch: "showFrame", eyeLineSwitch: "eyeLine", mirrorSwitch: "mirror", gridSwitch: "grid", splitSwitch: "split", autoPauseSwitch: "autoPause" })) on(id, "click", () => applyChanges({ [key]: !state[key] }));
    on("timerSelect", "change", event => { cancelCapture(); applyChanges({ timer: Number(event.target.value) }); });
    on("snapshotFormat", "change", event => applyChanges({ snapshotFormat: event.target.value }));
    on("qualitySelect", "change", event => applyChanges({ quality: event.target.value }));
    on("deviceResolutionSelect", "change", event => applyChanges({ requestedResolution: event.target.value }));
    on("deviceFpsSelect", "change", event => applyChanges({ requestedFps: Number(event.target.value) }));
    on("portraitLightRange", "input", event => applyChanges({ portraitLightAmount: Number(event.target.value) }));
    on("enableVisionButton", "click", enableVision);
    for (const [id, key] of Object.entries({ autoFrameSwitch: "autoFrame", backgroundBlurSwitch: "backgroundBlur", headDetailSwitch: "headDetail", portraitLightSwitch: "portraitLight", refinementSwitch: "refinement", teethSwitch: "teeth", browserBasicSwitch: "browserBasic" })) on(id, "click", () => applyChanges({ [key]: !state[key] }));
    on("openWindowsCameraSettings", "click", () => { if (/Windows/i.test(navigator.userAgent)) location.href = "ms-settings:camera"; else showToast("Open Windows Settings → Bluetooth & devices → Cameras on your Windows PC."); });
    on("cameraSelect", "change", event => { selectedCameraId = event.target.value; if (phase === "live") { stopCamera(false); startCamera(); } });
    on("privacyButton", "click", activatePrivacyShield); on("shieldQuickButton", "click", activatePrivacyShield); on("startCameraButton", "click", startCamera); on("retryCameraButton", "click", startCamera);
    on("stopCameraButton", "click", () => { sessionTools?.stopPrivateResources("Camera session stopped"); stopCamera(); }); on("captureButton", "click", captureSnapshot);
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
    document.addEventListener("visibilitychange", () => { setOriginal(false); cancelCapture(); if (document.hidden) { if (phase === "starting" || (phase === "live" && state.autoPause)) stopCamera(false, "paused"); else { resetVision(); clearPreview(); if (rafId) cancelAnimationFrame(rafId); rafId = 0; sampleStart = 0; sampleFrames = 0; measuredFps = null; } } else { updateCameraUI(); requestRender(); loadRequiredVision(); } });
    window.addEventListener("pagehide", () => { sessionTools?.stopPrivateResources("App closed"); stopCamera(false); disposed = true; clearTimeout(deviceRefreshTimer); for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); });
    window.addEventListener("pageshow", event => { if (event.persisted) { disposed = false; phase = "demo"; updateControls(); requestRender(); } });
    window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; hide("installButton", false); });
    on("installButton", "click", async () => { if (!deferredInstallPrompt) return; try { await deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; } catch { showToast("Use your browser’s Install app option to install MeetingLens."); } deferredInstallPrompt = null; hide("installButton", true); });
    window.addEventListener("appinstalled", () => { hide("installButton", true); showToast("MeetingLens installed."); }); window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
    on("updateNotice", "click", () => { if (!swRegistration?.waiting) return; updateRequested = true; sessionTools?.stopPrivateResources("Studio restarting for update"); stopCamera(false); swRegistration.waiting.postMessage({ type: "SKIP_WAITING" }); });
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
  loadScene(state.scene);
  portrait.src = "./assets/demo/professional-portrait.webp";
  sessionTools = window.MeetingLensSessionTools?.init({ getCanvas: () => canvas, onStatus: (message, level) => { if (level === "error") showToast(message); } }) || null;
  resizeOutput(); registerEvents(); updateControls(); renderPresets(); storageNotice(); updateConnection(); refreshDevices(); registerServiceWorker(); requestRender();
  window.MeetingLensStudio = { getState: () => ({ ...sanitize(state), phase, privacy: state.privacy, visionReady, visionPending }), getAnalysis: () => analysis,
    getFramePair: () => pairedVisionFrame && currentAnalysis()?.timestamp === pairedVisionTimestamp ? { timestamp: pairedVisionTimestamp, width: pairedVisionFrame.width, height: pairedVisionFrame.height } : null,
    loadAI: enableVision, stop: () => { sessionTools?.stopPrivateResources("Session stopped"); stopCamera(false); } };
  const params = new URLSearchParams(location.search); if (Object.prototype.hasOwnProperty.call(panelText, params.get("screen"))) setPanel(params.get("screen"));
  if (params.get("action") === "camera") showToast("Select Start camera when you are ready to grant permission.");
})();
