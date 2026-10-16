"use strict";
const BASE = self.registration.scope;
const CACHE_PREFIX = `meetinglens-shell-${BASE}-`;
const CACHE_NAME = `${CACHE_PREFIX}v2.0.0`;
const url = path => new URL(path, BASE).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./privacy.html",
  "./terms.html",
  "./manifest.webmanifest",
  "./assets/styles/app.css",
  "./assets/js/app.js",
  "./assets/demo/professional-portrait.webp",
  "./assets/demo/professional-portrait.png",
  "./assets/icons/meetinglens-192.png",
  "./assets/icons/meetinglens-512.png",
  "./assets/icons/meetinglens-maskable-512.png"
].map(url);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
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
    try { return await fetch(request); } catch { return Response.error(); }
  })());
});
