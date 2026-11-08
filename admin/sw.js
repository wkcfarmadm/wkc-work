/* Offline support for this app. When ANY app or shared file changes, increase VERSION. */
var VERSION = 'wkc2-admin-1.0.0';
var PREFIX = 'wkc2-admin-';
var FILES = [
  './', 'index.html', 'manifest.webmanifest', 'admin.js',
  '../shared/config.js', '../shared/store.js', '../shared/sync.js', '../shared/core.js',
  '../shared/scanner.js', '../shared/ui.js', '../shared/qrcode.js', '../shared/style.css',
  '../icons/admin-192.png', '../icons/admin-512.png'
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
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return c.match('index.html');
        return Response.error();
      });
    });
  }));
});
