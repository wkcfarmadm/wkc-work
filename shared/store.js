/* Local copy of the database on this device (IndexedDB).
   Every record saved here first; records with _dirty = 1 are waiting to be uploaded. */
var Store = (function () {
  var DB_NAME = 'wkc2';
  var TABLES = ['workers', 'plots', 'plot_tables', 'varieties', 'stock_adjustments', 'work_sessions', 'work_intervals', 'plantings'];
  var db = null;
  var cache = {};
  var meta = {};
  TABLES.forEach(function (t) { cache[t] = []; });
  var listeners = [];

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        TABLES.forEach(function (t) { if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' }); });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function readAll(name) {
    return new Promise(function (resolve, reject) {
      var r = db.transaction(name).objectStore(name).getAll();
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function loadAll() {
    return Promise.all(TABLES.map(function (t) { return readAll(t).then(function (rows) { cache[t] = rows; }); }))
      .then(function () { return readAll('meta'); })
      .then(function (rows) { meta = {}; rows.forEach(function (r) { meta[r.key] = r.value; }); });
  }

  function writeTx(map) {
    var names = Object.keys(map);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(names, 'readwrite');
      names.forEach(function (n) { map[n].forEach(function (r) { tx.objectStore(n).put(r); }); });
      tx.oncomplete = function () {
        names.forEach(function (n) {
          if (n === 'meta') { map[n].forEach(function (r) { meta[r.key] = r.value; }); return; }
          map[n].forEach(function (r) {
            var i = cache[n].findIndex(function (x) { return x.id === r.id; });
            if (i >= 0) cache[n][i] = r; else cache[n].push(r);
          });
        });
        resolve();
      };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Save aborted')); };
    });
  }

  // Save records made on this device. They are marked as waiting to sync.
  function save(map) {
    var out = {};
    Object.keys(map).forEach(function (t) {
      out[t] = map[t].map(function (r) {
        var old = byId(t, r.id);
        return Object.assign({}, r, { _dirty: 1, _v: ((old && old._v) || 0) + 1 });
      });
    });
    return writeTx(out).then(function () { notify('local'); });
  }

  // Save records downloaded from the server (already synced).
  function saveFromServer(table, rows) {
    if (!rows.length) return Promise.resolve();
    var map = {};
    map[table] = rows.map(function (r) { return Object.assign({}, r, { _dirty: 0, _v: 0 }); });
    return writeTx(map);
  }

  // After upload: mark as synced, unless the record was changed again meanwhile.
  function markSynced(table, sent) {
    var rows = [];
    sent.forEach(function (s) {
      var cur = byId(table, s.id);
      if (cur && cur._v === s._v) rows.push(Object.assign({}, cur, { _dirty: 0 }));
    });
    if (!rows.length) return Promise.resolve();
    var map = {}; map[table] = rows;
    return writeTx(map);
  }

  function setMeta(key, value) { return writeTx({ meta: [{ key: key, value: value }] }); }
  function getMeta(key, fallback) { return meta.hasOwnProperty(key) ? meta[key] : fallback; }
  function reloadMeta() {
    return readAll('meta').then(function (rows) { rows.forEach(function (r) { meta[r.key] = r.value; }); });
  }

  function byId(t, id) { return cache[t].find(function (r) { return r.id === id; }); }
  function pending() {
    return TABLES.reduce(function (n, t) { return n + cache[t].filter(function (r) { return r._dirty; }).length; }, 0);
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function deviceId() {
    var d = getMeta('device_id');
    if (!d) { d = uid(); setMeta('device_id', d); }
    return d;
  }

  // Demo mode only: starting data, like setup.sql does on the server.
  function seedDemo() {
    if (getMeta('demo_seeded') || cache.workers.length) return Promise.resolve();
    var now = new Date().toISOString(), map = { workers: [], plots: [], varieties: [] };
    for (var i = 1; i <= 10; i++) map.workers.push({ id: uid(), name: 'Worker ' + i, active: true, sort: i, created_at: now });
    ['B4 nursery', 'B4 runner', 'B4-1', 'B4-2', 'B4-3', 'B4-4', 'B4-5', 'B4-6', 'B4-7', 'B4-8'].forEach(function (n, k) {
      map.plots.push({ id: uid(), name: n, layout: k === 0 ? 'tabletops' : 'tables', is_nursery: k === 0, capacity: 0, active: true, sort: k + 1, created_at: now });
    });
    ['festival', 'montery', 'white', 'T3', 'T15', 'kimura'].forEach(function (n, k) {
      map.varieties.push({ id: uid(), name: n, active: true, sort: k + 1, created_at: now });
    });
    return save(map).then(function () { return setMeta('demo_seeded', true); });
  }

  function onChange(fn) { listeners.push(fn); }
  function notify(why) { listeners.forEach(function (fn) { try { fn(why); } catch (e) { console.error(e); } }); }

  return {
    TABLES: TABLES, cache: cache, open: open, loadAll: loadAll, save: save, saveFromServer: saveFromServer,
    markSynced: markSynced, setMeta: setMeta, getMeta: getMeta, reloadMeta: reloadMeta, byId: byId,
    pending: pending, uid: uid, deviceId: deviceId, seedDemo: seedDemo, onChange: onChange, notify: notify
  };
})();
