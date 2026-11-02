/* Local database (IndexedDB). All data stays on this device in version 1. */
var DB = (function () {
  var DB_NAME = 'wkc-work-tracker';
  var DB_VERSION = 1;
  var STORES = ['workers', 'plots', 'tables', 'varieties', 'sessions', 'intervals', 'plantings', 'settings'];
  var db = null;

  // In-memory copy of every store, so screens can render instantly.
  var cache = {};
  STORES.forEach(function (s) { cache[s] = []; });

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        STORES.forEach(function (s) {
          if (!d.objectStoreNames.contains(s)) {
            d.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
          }
        });
      };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getAll(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function loadAll() {
    return Promise.all(STORES.map(function (s) {
      return getAll(s).then(function (rows) { cache[s] = rows; });
    }));
  }

  // Save (insert or update) one or more records in a single transaction.
  function put(store, records) {
    if (!Array.isArray(records)) records = [records];
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      var os = tx.objectStore(store);
      records.forEach(function (r) { os.put(r); });
      tx.oncomplete = function () {
        records.forEach(function (r) {
          var key = store === 'settings' ? 'key' : 'id';
          var i = cache[store].findIndex(function (x) { return x[key] === r[key]; });
          if (i >= 0) cache[store][i] = r; else cache[store].push(r);
        });
        resolve();
      };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  // Save to several stores in one atomic transaction: {store: [records]}
  function putMany(map) {
    var stores = Object.keys(map);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(stores, 'readwrite');
      stores.forEach(function (s) {
        map[s].forEach(function (r) { tx.objectStore(s).put(r); });
      });
      tx.oncomplete = function () {
        stores.forEach(function (s) {
          map[s].forEach(function (r) {
            var i = cache[s].findIndex(function (x) { return x.id === r.id; });
            if (i >= 0) cache[s][i] = r; else cache[s].push(r);
          });
        });
        resolve();
      };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  function clearStores(stores) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(stores, 'readwrite');
      stores.forEach(function (s) { tx.objectStore(s).clear(); });
      tx.oncomplete = function () { stores.forEach(function (s) { cache[s] = []; }); resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function getSetting(key, fallback) {
    var row = cache.settings.find(function (r) { return r.key === key; });
    return row ? row.value : fallback;
  }
  function setSetting(key, value) { return put('settings', { key: key, value: value }); }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // First run: create the farm's starting data.
  function seedIfEmpty() {
    if (getSetting('seeded', false)) return Promise.resolve();
    var now = Date.now();
    var workers = [];
    for (var i = 1; i <= 10; i++) workers.push({ id: uid(), name: 'Worker ' + i, active: true, sort: i, createdAt: now });
    var plotNames = ['B4 nursery', 'B4 runner', 'B4-1', 'B4-2', 'B4-3', 'B4-4', 'B4-5', 'B4-6', 'B4-7', 'B4-8'];
    var plots = plotNames.map(function (n, idx) {
      return { id: uid(), name: n, layout: n === 'B4 nursery' ? 'tabletops' : 'tables', totalPlants: 0, active: true, sort: idx + 1, createdAt: now };
    });
    var varieties = ['festival', 'montery', 'white', 'T3', 'T15', 'kimura'].map(function (n, idx) {
      return { id: uid(), name: n, active: true, sort: idx + 1, createdAt: now };
    });
    return putMany({ workers: workers, plots: plots, varieties: varieties })
      .then(function () { return setSetting('adminPin', '1234'); })
      .then(function () { return setSetting('seeded', true); });
  }

  return {
    open: open, loadAll: loadAll, put: put, putMany: putMany, clearStores: clearStores,
    getSetting: getSetting, setSetting: setSetting, uid: uid, seedIfEmpty: seedIfEmpty,
    cache: cache, STORES: STORES
  };
})();
