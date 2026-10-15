(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const defaults = {
    look: "natural",
    brightness: 56,
    contrast: 54,
    saturation: 53,
    enhancement: 65,
    softness: false,
    scene: "room",
    sceneStrength: 45,
    frame: "conversation",
    zoom: 100,
    showFrame: true,
    eyeLine: true
  };

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("meetinglens-settings") || "{}"); } catch { saved = {}; }
  const state = { ...defaults, ...saved, originalHeld: false, privacy: false };

  const video = $("#cameraVideo");
  const canvas = $("#previewCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const cameraDot = $("#cameraDot");
  const cameraStatus = $("#cameraStatus");
  const startCameraButton = $("#startCameraButton");
  const stopCameraButton = $("#stopCameraButton");
  const privacyCurtain = $("#privacyCurtain");
  const liveChip = $("#liveChip");
  const liveLabel = $("#liveLabel");
  const effectLabel = $("#effectLabel");
  const resolutionLabel = $("#resolutionLabel");
  const qualityLabel = $("#qualityLabel");
  const frameGuide = $("#frameGuide");
  const toast = $("#toast");
  const toastText = $("#toastText");
  const installButton = $("#installButton");
  let stream = null;
  let isLive = false;
  let deferredInstallPrompt = null;
  let toastTimeout = null;

  const panelText = {
    studio: ["Meeting readiness", "Home profile"],
    looks: ["Natural enhancement", "Camera adjustments"],
    background: ["Background preview", "Scene tools"],
    frame: ["Framing guide", "Composition"],
    privacy: ["Privacy & trust", "Your camera, your control"]
  };

  function saveSettings() {
    const { originalHeld, privacy, ...persisted } = state;
    localStorage.setItem("meetinglens-settings", JSON.stringify(persisted));
  }

  function showToast(message) {
    toastText.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setPanel(name) {
    $$(".control-panel").forEach(panel => panel.classList.toggle("active", panel.id === `${name}-panel`));
    $$(".nav-button[data-panel]").forEach(button => button.classList.toggle("active", button.dataset.panel === name));
    $("#panelTitle").textContent = panelText[name][0];
    $("#panelEyebrow").textContent = panelText[name][1];
  }

  function updateControls() {
    $("#brightnessRange").value = state.brightness;
    $("#contrastRange").value = state.contrast;
    $("#saturationRange").value = state.saturation;
    $("#enhancementRange").value = state.enhancement;
    $("#sceneStrengthRange").value = state.sceneStrength;
    $("#zoomRange").value = state.zoom;
    $("#brightnessOutput").textContent = `${state.brightness}%`;
    $("#contrastOutput").textContent = `${state.contrast}%`;
    $("#saturationOutput").textContent = `${state.saturation}%`;
    $("#enhancementOutput").textContent = `${state.enhancement}%`;
    $("#sceneStrengthOutput").textContent = `${state.sceneStrength}%`;
    $("#zoomOutput").textContent = `${state.zoom}%`;
    $("#softnessSwitch").classList.toggle("on", state.softness);
    $("#frameSwitch").classList.toggle("on", state.showFrame);
    $("#eyeLineSwitch").classList.toggle("on", state.eyeLine);
    frameGuide.classList.toggle("hidden", !state.showFrame);
    $$(".look-button").forEach(button => button.classList.toggle("active", button.dataset.look === state.look));
    $$(".scene-button").forEach(button => button.classList.toggle("active", button.dataset.scene === state.scene));
    $$(".profile-button").forEach(button => button.classList.toggle("active", button.dataset.profile === currentProfile()));
    $$(".segment").forEach(button => button.classList.toggle("active", button.dataset.frame === state.frame));
  }

  function currentProfile() {
    if (state.look === "natural" && state.brightness === 56 && state.contrast === 54 && state.saturation === 53 && state.frame === "conversation") return "natural";
    if (state.brightness >= 64 && state.look === "warm") return "lowlight";
    if (state.frame === "teaching") return "teaching";
    if (state.frame === "wide" && state.look === "clear") return "presentation";
    return "";
  }

  function mix(base, target) {
    const strength = state.originalHeld ? 0 : state.enhancement / 100;
    return base + (target - base) * strength;
  }

  function filterString() {
    let brightness = mix(100, 75 + state.brightness * .55);
    let contrast = mix(100, 80 + state.contrast * .42);
    let saturation = mix(100, 78 + state.saturation * .45);
    let hue = 0;
    let sepia = 0;
    if (state.look === "clear") { contrast += 8; saturation += 5; }
    if (state.look === "warm") { sepia = 14; saturation += 5; brightness += 2; }
    if (state.look === "studio") { contrast += 10; saturation += 9; brightness += 4; hue = -3; }
    if (state.look === "mono") { saturation = 0; contrast += 8; }
    if (state.look === "brand") { saturation += 15; hue = -7; }
    const blur = state.softness && !state.originalHeld ? 0.55 : 0;
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) sepia(${sepia}%) hue-rotate(${hue}deg) blur(${blur}px)`;
  }

  function updateLabels() {
    const lookNames = { natural: "Natural color", clear: "Clear look", warm: "Warm look", studio: "Studio look", mono: "Monochrome", brand: "Brand color" };
    const sceneNames = { room: "Keep my room", soft: "Soft focus preview", studio: "Studio blue preview", night: "Dark neutral preview" };
    effectLabel.textContent = `${lookNames[state.look]} · ${sceneNames[state.scene]}`;
    $("#lightSummary").textContent = `${lookNames[state.look]} applied`;
    $("#frameSummary").textContent = `${state.frame.charAt(0).toUpperCase() + state.frame.slice(1)} guide shown`;
    $("#lightState").textContent = state.enhancement >= 55 ? "Balanced" : "Adjust";
    $("#lightState").className = state.enhancement >= 55 ? "state-good" : "state-warn";
    qualityLabel.textContent = state.enhancement >= 55 ? "Balanced for a meeting" : "Original camera view";
  }

  function drawRoundRect(context, x, y, width, height, radius, fill) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  }

  function drawDemoScene(time) {
    const w = canvas.width;
    const h = canvas.height;
    const scenePalettes = {
      room: ["#7694a8", "#475d73", "#22303f"],
      soft: ["#8897a5", "#5c7080", "#283644"],
      studio: ["#3a6a89", "#183250", "#0d1628"],
      night: ["#34435a", "#1e2d40", "#0a111d"]
    };
    const [top, mid, bottom] = scenePalettes[state.scene];
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, top);
    gradient.addColorStop(.56, mid);
    gradient.addColorStop(.565, bottom);
    gradient.addColorStop(1, "#101721");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    if (state.scene === "soft") ctx.filter = "blur(3.5px) saturate(.8)";
    if (state.scene === "night") ctx.filter = "brightness(.72) saturate(.72)";

    if (state.scene === "studio") {
      const aura = ctx.createRadialGradient(w * .62, h * .31, 20, w * .62, h * .31, 570);
      aura.addColorStop(0, "rgba(137,239,221,.56)");
      aura.addColorStop(.35, "rgba(67,146,235,.31)");
      aura.addColorStop(1, "rgba(4,12,30,0)");
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(196,242,255,.25)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(w * .74, h * .42, 270, -1.25, 1.25); ctx.stroke();
      ctx.beginPath(); ctx.arc(w * .14, h * .8, 190, -1.25, 1.25); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(61,77,88,.79)";
      ctx.fillRect(w * .69, -12, w * .28, h * .55);
      ctx.fillStyle = "rgba(226,246,250,.24)";
      ctx.fillRect(w * .715, 0, w * .095, h * .47);
      ctx.fillRect(w * .824, 0, w * .095, h * .47);
      ctx.fillStyle = "rgba(40,56,70,.64)";
      ctx.fillRect(w * .808, 0, 11, h * .53);
      ctx.fillRect(w * .69, h * .25, w * .28, 11);

      ctx.fillStyle = "#443b39";
      ctx.fillRect(w * .055, h * .08, w * .19, h * .49);
      for (let y = 0; y < 3; y++) {
        ctx.fillStyle = "#2a292a";
        ctx.fillRect(w * .055, h * (.22 + y * .14), w * .19, 10);
        const bookColors = ["#dbab5d", "#315b78", "#c55f5e", "#e6d9b7", "#406047", "#b98278"];
        let x = w * .073;
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = bookColors[(i + y) % bookColors.length];
          const bookWidth = 18 + (i % 3) * 7;
          ctx.fillRect(x, h * (.105 + y * .14), bookWidth, h * .105);
          x += bookWidth + 4;
        }
      }
      ctx.fillStyle = "#1d272d";
      ctx.fillRect(w * .475, h * .45, w * .17, h * .16);
      ctx.fillStyle = "#285e70";
      ctx.fillRect(w * .49, h * .465, w * .14, h * .12);
      ctx.fillStyle = "#1d272d";
      ctx.fillRect(w * .545, h * .61, w * .03, h * .05);
    }

    ctx.fillStyle = "rgba(67,45,38,.6)";
    ctx.beginPath();
    ctx.moveTo(-30, h * .79); ctx.lineTo(w + 30, h * .69); ctx.lineTo(w + 30, h + 30); ctx.lineTo(-30, h + 30); ctx.closePath(); ctx.fill();

    // Person — intentionally a neutral demo illustration used when no camera is granted.
    const cx = w * .52;
    const bob = Math.sin(time / 1800) * 2;
    ctx.fillStyle = "#273e61";
    ctx.beginPath(); ctx.ellipse(cx, h * .88 + bob, w * .205, h * .32, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#1b2f4c";
    ctx.beginPath(); ctx.moveTo(cx - w * .205, h); ctx.lineTo(cx - w * .11, h * .69); ctx.lineTo(cx + w * .10, h * .69); ctx.lineTo(cx + w * .21, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e1ecf2";
    ctx.beginPath(); ctx.moveTo(cx - 28, h * .68); ctx.lineTo(cx + 28, h * .68); ctx.lineTo(cx, h * .83); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#bb735d";
    drawRoundRect(ctx, cx - 31, h * .53, 62, 85, 18, "#bb735d");
    ctx.fillStyle = "#dba083";
    ctx.beginPath(); ctx.ellipse(cx - 8, h * .48 + bob, 72, 95, .05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#272933";
    ctx.beginPath(); ctx.ellipse(cx - 14, h * .40 + bob, 77, 44, -.1, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.20)";
    ctx.beginPath(); ctx.ellipse(cx - 30, h * .43 + bob, 22, 39, .1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#29303a";
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.roundRect(cx - 51, h * .48 + bob, 38, 28, 8); ctx.roundRect(cx + 13, h * .48 + bob, 38, 28, 8); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx - 13, h * .495 + bob); ctx.lineTo(cx + 13, h * .495 + bob); ctx.stroke();
    ctx.restore();

    const overlay = ctx.createLinearGradient(0, 0, w, h);
    overlay.addColorStop(0, "rgba(255,255,255,.05)");
    overlay.addColorStop(1, "rgba(5,9,15,.2)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, w, h);
  }

  function drawLiveFrame() {
    const w = canvas.width;
    const h = canvas.height;
    const zoom = state.originalHeld ? 1 : state.zoom / 100;
    const sourceWidth = video.videoWidth || w;
    const sourceHeight = video.videoHeight || h;
    const targetAspect = w / h;
    const sourceAspect = sourceWidth / sourceHeight;
    let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
    if (sourceAspect > targetAspect) { sw = sourceHeight * targetAspect; sx = (sourceWidth - sw) / 2; }
    else { sh = sourceWidth / targetAspect; sy = (sourceHeight - sh) / 2; }
    sw /= zoom; sh /= zoom; sx += (sourceWidth - sw) / 2; sy += (sourceHeight - sh) / 2;
    ctx.save();
    ctx.fillStyle = "#0c111b";
    ctx.fillRect(0, 0, w, h);
    ctx.filter = filterString();
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    if (!state.originalHeld && state.look === "studio") {
      const wash = ctx.createLinearGradient(0, 0, w, h);
      wash.addColorStop(0, "rgba(73,221,205,.08)");
      wash.addColorStop(.55, "rgba(64,105,235,.03)");
      wash.addColorStop(1, "rgba(137,96,255,.10)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function render(time = 0) {
    if (isLive && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !state.privacy) drawLiveFrame();
    else if (!state.privacy) drawDemoScene(time);
    requestAnimationFrame(render);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Camera preview needs a modern browser and a secure HTTPS page.");
      return;
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
      showToast("Camera access needs HTTPS after you publish this app.");
      return;
    }
    try {
      stopCamera(false);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      isLive = true;
      state.privacy = false;
      privacyCurtain.classList.remove("visible");
      cameraDot.classList.add("live");
      cameraStatus.textContent = "Live camera preview · local processing";
      liveChip.classList.add("live");
      liveLabel.textContent = "LIVE CAMERA";
      resolutionLabel.textContent = `${video.videoWidth || 1280} × ${video.videoHeight || 720} preview`;
      startCameraButton.innerHTML = '<span class="camera-icon" aria-hidden="true"></span>Camera preview on';
      stopCameraButton.disabled = false;
      showToast("Camera preview started. Video remains in this browser.");
    } catch (error) {
      const explanation = error.name === "NotAllowedError" ? "Camera permission was not granted." : error.name === "NotFoundError" ? "No camera was found on this device." : "The camera could not be started.";
      showToast(explanation);
      console.warn("Camera error:", error);
    }
  }

  function stopCamera(showMessage = true) {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    video.srcObject = null;
    isLive = false;
    cameraDot.classList.remove("live");
    cameraStatus.textContent = state.privacy ? "Privacy Shield active · preview hidden" : "Demo preview · no camera access";
    liveChip.classList.remove("live");
    liveLabel.textContent = "DEMO PREVIEW";
    resolutionLabel.textContent = "1280 × 720 preview";
    startCameraButton.innerHTML = '<span class="camera-icon" aria-hidden="true"></span>Start camera preview';
    stopCameraButton.disabled = true;
    if (showMessage) showToast("Camera preview stopped.");
  }

  function activatePrivacyShield() {
    state.privacy = !state.privacy;
    if (state.privacy) {
      stopCamera(false);
      privacyCurtain.classList.add("visible");
      $("#privacyButton").textContent = "Deactivate shield";
      $("#privacySummary").textContent = "Preview paused on this device";
      showToast("Privacy Shield activated. Camera preview is paused.");
    } else {
      privacyCurtain.classList.remove("visible");
      $("#privacyButton").textContent = "Activate shield";
      $("#privacySummary").textContent = "Camera stays on this device";
      showToast("Privacy Shield deactivated. Start the camera when ready.");
    }
  }

  function captureSnapshot() {
    if (state.privacy) { showToast("Deactivate Privacy Shield before saving a snapshot."); return; }
    canvas.toBlob(blob => {
      if (!blob) { showToast("Snapshot could not be created."); return; }
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = URL.createObjectURL(blob);
      link.download = `meetinglens-snapshot-${stamp}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      showToast("Snapshot saved locally.");
    }, "image/png");
  }

  function applyProfile(profile) {
    if (profile === "natural") Object.assign(state, { look: "natural", brightness: 56, contrast: 54, saturation: 53, frame: "conversation", zoom: 100, softness: false });
    if (profile === "lowlight") Object.assign(state, { look: "warm", brightness: 68, contrast: 50, saturation: 52, frame: "conversation", zoom: 100, softness: true });
    if (profile === "teaching") Object.assign(state, { look: "natural", brightness: 58, contrast: 56, saturation: 52, frame: "teaching", zoom: 91, softness: false });
    if (profile === "presentation") Object.assign(state, { look: "clear", brightness: 56, contrast: 65, saturation: 48, frame: "wide", zoom: 92, softness: false });
    updateControls(); updateLabels(); saveSettings();
    showToast(`${profile.charAt(0).toUpperCase() + profile.slice(1)} profile applied.`);
  }

  function resetSettings() {
    Object.assign(state, defaults, { originalHeld: false, privacy: false });
    privacyCurtain.classList.remove("visible");
    $("#privacyButton").textContent = "Activate shield";
    $("#privacySummary").textContent = "Camera stays on this device";
    updateControls(); updateLabels(); saveSettings();
    showToast("Default MeetingLens settings restored.");
  }

  function fixNaturally() {
    Object.assign(state, { look: "natural", brightness: 60, contrast: 57, saturation: 52, enhancement: 68, softness: false, scene: "room", frame: "conversation", zoom: 100 });
    $("#readinessTitle").textContent = "Your preview is meeting-ready";
    $("#readinessText").textContent = "Light and color have been adjusted gently. Your natural appearance is preserved.";
    updateControls(); updateLabels(); saveSettings();
    showToast("Natural camera correction applied.");
  }

  function registerEvents() {
    $$(".nav-button[data-panel]").forEach(button => button.addEventListener("click", () => setPanel(button.dataset.panel)));
    $$(".profile-button").forEach(button => button.addEventListener("click", () => applyProfile(button.dataset.profile)));
    $$(".look-button").forEach(button => button.addEventListener("click", () => {
      state.look = button.dataset.look; updateControls(); updateLabels(); saveSettings(); showToast(`${button.textContent.trim()} look selected.`);
    }));
    $$(".scene-button").forEach(button => button.addEventListener("click", () => {
      state.scene = button.dataset.scene; updateControls(); updateLabels(); saveSettings(); showToast(`${button.querySelector("b").textContent} selected for the demo preview.`);
    }));
    $$(".segment").forEach(button => button.addEventListener("click", () => {
      state.frame = button.dataset.frame; updateControls(); updateLabels(); saveSettings(); showToast(`${button.textContent} framing guide selected.`);
    }));

    const sliderSettings = [
      ["brightnessRange", "brightness"], ["contrastRange", "contrast"], ["saturationRange", "saturation"],
      ["enhancementRange", "enhancement"], ["sceneStrengthRange", "sceneStrength"], ["zoomRange", "zoom"]
    ];
    sliderSettings.forEach(([id, key]) => $("#" + id).addEventListener("input", event => {
      state[key] = Number(event.target.value); updateControls(); updateLabels(); saveSettings();
    }));

    $("#softnessSwitch").addEventListener("click", () => { state.softness = !state.softness; updateControls(); saveSettings(); showToast(state.softness ? "Subtle softness enabled." : "Subtle softness disabled."); });
    $("#frameSwitch").addEventListener("click", () => { state.showFrame = !state.showFrame; updateControls(); saveSettings(); });
    $("#eyeLineSwitch").addEventListener("click", () => { state.eyeLine = !state.eyeLine; updateControls(); saveSettings(); });
    $("#privacyButton").addEventListener("click", activatePrivacyShield);
    $("#startCameraButton").addEventListener("click", startCamera);
    $("#stopCameraButton").addEventListener("click", () => stopCamera(true));
    $("#captureButton").addEventListener("click", captureSnapshot);
    $("#fixNaturallyButton").addEventListener("click", fixNaturally);
    $("#resetButton").addEventListener("click", resetSettings);

    const originalDown = () => { state.originalHeld = true; updateLabels(); };
    const originalUp = () => { state.originalHeld = false; updateLabels(); };
    const originalButton = $("#holdOriginalButton");
    ["pointerdown", "touchstart"].forEach(type => originalButton.addEventListener(type, originalDown));
    ["pointerup", "pointerleave", "touchend", "touchcancel"].forEach(type => originalButton.addEventListener(type, originalUp));

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false;
    });
    installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null; installButton.hidden = true;
    });
    window.addEventListener("appinstalled", () => { installButton.hidden = true; showToast("MeetingLens was installed."); });
    window.addEventListener("pagehide", () => stopCamera(false));
    document.addEventListener("visibilitychange", () => { if (document.hidden && isLive) video.pause(); else if (!document.hidden && isLive) video.play().catch(() => {}); });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(error => console.warn("Service worker error:", error));
  }

  function init() {
    updateControls(); updateLabels(); registerEvents(); registerServiceWorker(); render();
    const params = new URLSearchParams(location.search);
    const wantedPanel = params.get("screen");
    if (wantedPanel && panelText[wantedPanel]) setPanel(wantedPanel);
    if (params.get("action") === "camera") showToast("Select Start camera preview when you are ready to grant permission.");
  }

  init();
})();
