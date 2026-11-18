/* Offline support for this app. When ANY app or shared file changes, increase VERSION. */
var VERSION = 'wkc2-daun-1.0.3';
var PREFIX = 'wkc2-daun-';
var FILES = [
  './', 'index.html', 'manifest.webmanifest', '../shared/worker.js',
  '../shared/config.js', '../shared/store.js', '../shared/sync.js', '../shared/core.js',
  '../shared/scanner.js', '../shared/ui.js', '../shared/qrcode.js', '../shared/style.css',
  '../icons/daun-192.png', '../icons/daun-512.png'
];
var OPTIONAL = ['../shared/jsQR.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FILES).then(function () {
      return Promise.all(OPTIONAL.map(function (u) {
        return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Never cache database traffic: only this site's files and the QR reader library.
  if (url.origin !== self.location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  // App files: get the newest version from the internet when online (so updates show at once);
  // use the saved copy when offline or when the internet is too slow (4 s).
  e.respondWith(caches.open(VERSION).then(function (c) {
    var fromCache = function () {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('index.html');
        return Response.error();
      });
    };
    var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 4000); });
    return Promise.race([net, timeout]).then(function (res) { return res || fromCache(); }, fromCache);
  }));
});
