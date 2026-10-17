"use strict";
const BASE = self.registration.scope;
const CACHE_PREFIX = `meetinglens-shell-${BASE}-`;
const CACHE_NAME = `${CACHE_PREFIX}v3.2.2`;
const url = path => new URL(path, BASE).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./privacy.html",
  "./terms.html",
  "./photo-workbench.html",
  "./native-capabilities.html",
  "./manifest.webmanifest",
  "./assets/styles/app.css",
  "./assets/styles/photo-workbench.css",
  "./assets/styles/session-tools.css",
  "./assets/js/app.js",
  "./assets/js/vision-effects.js",
  "./assets/js/session-tools.js",
  "./assets/js/photo-workbench.js",
  "./assets/js/native-capabilities.js",
  "./assets/vendor/jsqr/jsQR.js",
  "./assets/demo/professional-portrait.webp",
  "./assets/demo/professional-portrait.png",
  "./assets/demo/whiteboard-meeting.webp",
  "./assets/demo/backgrounds/executive-office.webp",
  "./assets/demo/backgrounds/scandinavian-office.webp",
  "./assets/demo/backgrounds/architect-studio.webp",
  "./assets/demo/backgrounds/city-lounge.webp",
  "./assets/demo/backgrounds/warm-library.webp",
  "./assets/demo/backgrounds/minimal-gallery.webp",
  "./assets/icons/meetinglens-192.png",
  "./assets/icons/meetinglens-512.png",
  "./assets/icons/meetinglens-maskable-512.png",
  "./assets/icons/meetinglens-icon.svg"
].map(url);
const MODEL_FILES = [
  "./assets/vendor/vision/meetinglens-worker.js", "./assets/vendor/vision/vision_bundle.js",
  "./assets/vendor/vision/wasm/vision_wasm_internal.js", "./assets/vendor/vision/wasm/vision_wasm_internal.wasm",
  "./assets/vendor/vision/wasm/vision_wasm_nosimd_internal.js", "./assets/vendor/vision/wasm/vision_wasm_nosimd_internal.wasm",
  "./assets/models/face_landmarker.task", "./assets/models/person_segmenter_multiclass.tflite"
].map(url);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await cache.addAll(APP_SHELL);
    // The manual studio remains installable if model storage is unavailable.
    // Successful model downloads are available offline; inference still needs
    // a camera session with saved effects or the Load local AI models action.
    await Promise.allSettled(MODEL_FILES.map(file => cache.add(file)));
  }));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin || !request.url.startsWith(BASE)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === "navigate") {
      // A versioned shell keeps HTML and JS from different releases from mixing.
      // Panel shortcuts share this shell and continue to work offline.
      if (requestUrl.pathname === new URL(BASE).pathname || requestUrl.pathname === new URL("index.html", BASE).pathname) {
        const shell = await cache.match(url("index.html"));
        if (shell) return shell;
      }
      const exact = await cache.match(request, { ignoreSearch: true });
      if (exact) return exact;
      try { return await fetch(request); }
      catch { return (await cache.match(url("offline.html"))) || Response.error(); }
    }
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Only the known app shell is retained. No camera frames or downloads.
    try {
      const response = await fetch(request);
      if (response.status === 200 && MODEL_FILES.includes(requestUrl.href)) {
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      return response;
    } catch { return Response.error(); }
  })());
});
