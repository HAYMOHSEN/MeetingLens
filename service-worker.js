const CACHE_NAME = "meetinglens-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./assets/styles/app.css",
  "./assets/js/app.js",
  "./assets/icons/meetinglens-192.png",
  "./assets/icons/meetinglens-512.png",
  "./assets/icons/meetinglens-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || (acceptsHtml ? caches.match("./offline.html") : Response.error());
      })
  );
});
