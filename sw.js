/* Service worker: keeps the app working with no internet.
   When you change any app file, increase VERSION so phones download the new files. */
var VERSION = 'wkc-v1.0.0';
var APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/db.js', 'js/scanner.js', 'js/app.js', 'js/admin.js', 'lib/qrcode.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];
// QR reader for phones without a built-in one (iPhone). Cached if reachable; app still works without it.
var OPTIONAL_FILES = ['lib/jsQR.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (cache) {
    return cache.addAll(APP_FILES).then(function () {
      return Promise.all(OPTIONAL_FILES.map(function (u) {
        return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return cache.put(u, r); }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Cache first (fast + offline), then network; new successful responses are stored.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(event.request).then(function (res) {
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(event.request, copy); });
      }
      return res;
    }).catch(function () {
      if (event.request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    });
  }));
});
