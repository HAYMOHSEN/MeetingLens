/* Local WebView2 shared-buffer output. The website alone cannot register a
 * camera. Protocol 1 uses one host-owned RGBA buffer and strictly increasing
 * pull requests; there are no frame queues, network endpoints or raw inputs. */
(() => {
  "use strict";
  const WIDTH = 1280, HEIGHT = 720, BYTES = WIDTH * HEIGHT * 4, PROTOCOL = 1;
  const HOST_TIMEOUT = 2500, MAX_FRAME_AGE = 1000;
  function init({ getFrame, onStatus = () => {}, onActiveChange = () => {} } = {}) {
    const bridge = window.chrome?.webview;
    const supported = Boolean(bridge?.postMessage && bridge?.addEventListener && bridge?.releaseBuffer);
    let buffer = null, pixels = null, sessionId = "", connected = false, enabled = false, disposed = false;
    let lastSequence = 0, lastHostAt = 0, sentState = "", lastStatusKey = "", copiedFrames = 0;
    let frameCanvas = null, frameContext = null;
    const retiredSessions = new Set();
    const now = () => performance.now();
    const element = id => document.getElementById(id);
    function post(value) {
      if (!supported || disposed) return false;
      try { bridge.postMessage({ protocol: PROTOCOL, sessionId, ...value }); return true; }
      catch { loseHost("Windows companion disconnected. Reopen it to reconnect."); return false; }
    }
    function release() {
      const previous = buffer; buffer = pixels = null;
      if (previous) { try { bridge.releaseBuffer(previous); } catch { /* Host may already have closed it. */ } }
      if (frameCanvas) { frameCanvas.width = frameCanvas.height = 1; frameCanvas = frameContext = null; }
    }
    function retireSession() {
      if (sessionId) { retiredSessions.add(sessionId); if (retiredSessions.size > 8) retiredSessions.delete(retiredSessions.values().next().value); }
    }
    let disconnectedMessage = "Open MeetingLens in the Windows companion to send video to meeting apps.";
    function sourceState(refreshFrame = false) {
      if (!enabled) return { state: "stopped", reason: "Output stopped. Select Start meeting camera when you are ready." };
      let frame;
      try { frame = getFrame?.({ refresh: refreshFrame }); } catch { return { state: "blocked", reason: "Camera output paused. Check your preview." }; }
      if (frame?.privacy) return { state: "privacy", reason: "Privacy Shield is on. Meeting camera output is black." };
      if (!frame?.ready || !frame.canvas || !Number.isFinite(frame.renderedAt) || now() - frame.renderedAt > MAX_FRAME_AGE)
        return { state: "blocked", reason: frame?.reason || "Waiting for a fresh live preview. Meeting camera output is black." };
      return { state: "live", reason: "Sending the enhanced preview. Choose MeetingLens Virtual Camera in your meeting app.", frame };
    }
    function status(current = sourceState()) {
      const state = !supported ? "unavailable" : !connected ? "disconnected" : current.state;
      const message = !supported ? "Windows companion required. A browser or PWA install alone cannot provide a virtual camera." : !connected ? disconnectedMessage : current.reason;
      const key = state + "|" + message;
      if (key !== lastStatusKey) {
        lastStatusKey = key;
        const label = element("virtualCameraStatus"); if (label) label.textContent = message;
        const tag = element("virtualCameraState"); if (tag) { tag.textContent = state === "live" ? "SENDING" : state === "privacy" ? "SHIELDED" : state === "blocked" ? "PAUSED" : connected ? "READY" : "COMPANION NEEDED"; tag.dataset.state = state; }
        onStatus({ state, message, connected, enabled, frames: copiedFrames });
      }
      const start = element("virtualCameraStartButton"), stop = element("virtualCameraStopButton");
      if (start) start.disabled = !connected || enabled;
      if (stop) stop.disabled = !connected || !enabled;
      return { state, message, connected, enabled, frames: copiedFrames };
    }
    function refresh(force = false) {
      if (disposed) return;
      const current = sourceState();
      if (connected && (force || current.state !== sentState)) {
        sentState = current.state;
        post({ type: "meetinglens.native.state", state: current.state });
      }
      return status(current);
    }
    function loseHost(message) {
      if (!connected && !buffer) return;
      retireSession(); connected = enabled = false; sentState = ""; release();
      disconnectedMessage = message; status(); onActiveChange(false);
    }
    function receiveBuffer(event) {
      let candidate;
      try { candidate = event.getBuffer(); } catch { return; }
      const metadata = event.additionalData;
      const valid = !disposed && metadata && metadata.type === "meetinglens.native.ready" && metadata.protocol === PROTOCOL &&
        typeof metadata.sessionId === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(metadata.sessionId) && !retiredSessions.has(metadata.sessionId) &&
        metadata.width === WIDTH && metadata.height === HEIGHT && metadata.fps === 30 && candidate?.byteLength === BYTES;
      if (!valid || (connected && metadata.sessionId === sessionId)) {
        // A duplicate buffer event is never allowed to reset an enabled session.
        if (candidate !== buffer) { try { bridge.releaseBuffer(candidate); } catch { /* Invalid/closed host buffer. */ } }
        return;
      }
      if (connected) { post({ type: "meetinglens.native.state", state: "stopped" }); retireSession(); }
      release(); sessionId = metadata.sessionId; buffer = candidate;
      try { pixels = new Uint8Array(buffer); pixels.fill(0); }
      catch { release(); connected = enabled = false; status(); return; }
      connected = true; enabled = false; lastSequence = 0; lastHostAt = now(); sentState = "";
      refresh(true); onActiveChange(false);
    }
    function receiveMessage(event) {
      const message = event.data;
      if (!connected || disposed || !message || typeof message !== "object" || message.protocol !== PROTOCOL || message.sessionId !== sessionId) return;
      if (message.type === "meetinglens.native.stop") { post({ type: "meetinglens.native.state", state: "stopped" }); loseHost("Windows companion stopped. Reopen it to reconnect."); return; }
      if (message.type === "meetinglens.native.heartbeat") { lastHostAt = now(); return; }
      if (message.type !== "meetinglens.native.requestFrame" || !Number.isSafeInteger(message.sequence) || message.sequence <= lastSequence || message.sequence > 2147483647) return;
      lastSequence = message.sequence; lastHostAt = now();
      const current = sourceState(true); refresh();
      if (current.state !== "live" || !connected || !pixels) return;
      try {
        if (!frameCanvas) { frameCanvas = document.createElement("canvas"); frameCanvas.width = WIDTH; frameCanvas.height = HEIGHT; frameContext = frameCanvas.getContext("2d", { alpha: false, willReadFrequently: true }); }
        if (!frameContext) throw new Error("Output canvas unavailable");
        // Source is exclusively the finished, safe studio canvas. Guides and
        // controls are DOM overlays and never enter this output.
        frameContext.drawImage(current.frame.canvas, 0, 0, WIDTH, HEIGHT);
        const rgba = frameContext.getImageData(0, 0, WIDTH, HEIGHT).data;
        pixels.set(rgba); copiedFrames++;
        post({ type: "meetinglens.native.frame", sequence: message.sequence, width: WIDTH, height: HEIGHT });
      } catch {
        enabled = false; refresh(true); onActiveChange(false);
        const label = element("virtualCameraStatus"); if (label) label.textContent = "Video output could not be copied. Restart meeting camera output.";
      }
    }
    function start() { if (!connected || disposed) return false; enabled = true; refresh(true); onActiveChange(true); return true; }
    function stop() { const wasEnabled = enabled; enabled = false; refresh(true); if (wasEnabled) onActiveChange(false); }
    function visibility() { refresh(true); }
    function dispose() {
      if (disposed) return;
      stop(); disposed = true; connected = false; retireSession(); release(); clearInterval(watchdog);
      bridge?.removeEventListener?.("sharedbufferreceived", receiveBuffer); bridge?.removeEventListener?.("message", receiveMessage);
      document.removeEventListener("visibilitychange", visibility);
      element("virtualCameraStartButton")?.removeEventListener("click", start); element("virtualCameraStopButton")?.removeEventListener("click", stop);
    }
    if (supported) { bridge.addEventListener("sharedbufferreceived", receiveBuffer); bridge.addEventListener("message", receiveMessage); }
    document.addEventListener("visibilitychange", visibility);
    element("virtualCameraStartButton")?.addEventListener("click", start); element("virtualCameraStopButton")?.addEventListener("click", stop);
    const watchdog = setInterval(() => {
      if (connected && now() - lastHostAt > HOST_TIMEOUT) { post({ type: "meetinglens.native.state", state: "stopped" }); loseHost("Windows companion is not responding. Reopen it to reconnect."); }
      else refresh();
    }, 250);
    status();
    // Hello is sent after listeners exist. The host may also send ready after
    // navigation; this request avoids a timing race on cached/local startup.
    if (supported) post({ type: "meetinglens.native.hello" });
    return { start, stop, refresh, dispose, isActive: () => connected && enabled && !disposed, getStatus: () => status() };
  }
  window.MeetingLensVirtualCamera = Object.freeze({ init });
})();
