const CACHE_NAME = 'rasmora-studio-v12';
const ASSETS = ['./', './index.html', './privacy.html', './creative-studio.js', './creative-studio.css', './extended-studio.js', './extended-studio.css', './studio3d.bundle.js', './assets/xatlas-web.wasm', './manifest.webmanifest', './sw.js', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png', './assets/aurelia-editorial-sample.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME && (key.startsWith('rasmora-studio-') || key.startsWith('artproof-studio-'))).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin!==self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(response.ok){const copy=response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy));} return response;
  }).catch(() => event.request.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
