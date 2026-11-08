/* Login + automatic sync with Supabase (uses the Supabase REST API directly).
   Upload: records waiting on this device are sent with "upsert" on their unique id,
   so sending the same record twice never creates a duplicate.
   Download: rows changed on the server since the last sync. */
var Sync = (function () {
  var cfg = window.WKC_CONFIG || {};
  var URL_ = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = cfg.SUPABASE_ANON_KEY || '';
  var configured = !!(URL_ && KEY);
  var sessionKey = 'session_staff';
  var running = false, again = false, timer = null;
  var state = { lastSync: null, error: null, syncing: false };

  function setSessionKey(k) { sessionKey = k; }
  function session() { return Store.getMeta(sessionKey, null); }

  function authFetch(path, body) {
    return fetch(URL_ + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error_description || j.msg || j.message || ('Login failed (' + r.status + ')'));
          e.status = r.status; throw e;
        }
        return j;
      });
    });
  }

  function storeSession(j) {
    var s = {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: (j.user && j.user.email) || (session() || {}).email
    };
    return Store.setMeta(sessionKey, s).then(function () { return s; });
  }

  function login(email, password) {
    return authFetch('token?grant_type=password', { email: email.trim(), password: password }).then(storeSession);
  }

  function logout() { return Store.setMeta(sessionKey, null); }

  // Make sure we have a valid access token (refresh it when it is about to expire).
  function ensureToken(force) {
    return Store.reloadMeta().then(function () {
      var s = session();
      if (!s) throw Object.assign(new Error('Not logged in'), { needLogin: true });
      if (!force && s.expires_at - 60 > Date.now() / 1000) return s;
      return authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
        .then(storeSession)
        .catch(function (e) {
          if (e.status === 400 || e.status === 401) {
            return Store.setMeta(sessionKey, null).then(function () {
              throw Object.assign(new Error('Login expired. Please log in again.'), { needLogin: true });
            });
          }
          throw e;
        });
    });
  }

  function rest(method, path, body, extraHeaders, retried) {
    return ensureToken(false).then(function (s) {
      var h = { apikey: KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' };
      Object.assign(h, extraHeaders || {});
      return fetch(URL_ + '/rest/v1/' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) {
      if (r.status === 401 && !retried) return ensureToken(true).then(function () { return rest(method, path, body, extraHeaders, true); });
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t; try { var j = JSON.parse(t); msg = j.message || j.hint || t; } catch (e) {}
          throw new Error('Server ' + r.status + ': ' + msg);
        });
      }
      return r.status === 204 || method !== 'GET' ? null : r.json();
    });
  }

  function clean(r) {
    var o = {};
    Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_' && k !== 'updated_at') o[k] = r[k]; });
    return o;
  }

  function push() {
    var chain = Promise.resolve();
    Store.TABLES.forEach(function (t) {
      chain = chain.then(function () {
        var dirty = Store.cache[t].filter(function (r) { return r._dirty; });
        if (!dirty.length) return;
        var sent = dirty.map(function (r) { return { id: r.id, _v: r._v }; });
        // group by column set so every upsert batch has the same columns
        var groups = {};
        dirty.forEach(function (r) { var c = clean(r), k = Object.keys(c).sort().join(','); (groups[k] = groups[k] || []).push(c); });
        var g = Promise.resolve();
        Object.keys(groups).forEach(function (k) {
          g = g.then(function () {
            return rest('POST', t + '?on_conflict=id', groups[k], { Prefer: 'resolution=merge-duplicates,return=minimal' });
          });
        });
        return g.then(function () { return Store.markSynced(t, sent); });
      });
    });
    return chain;
  }

  function pull() {
    var changed = false, chain = Promise.resolve();
    Store.TABLES.forEach(function (t) {
      chain = chain.then(function () {
        var since = Store.getMeta('pull_' + t, '1970-01-01T00:00:00Z');
        // look back 2 minutes to be safe; saving the same row again is harmless
        var from = new Date(Date.parse(since) - 120000).toISOString();
        var maxSeen = since;
        function page(offset) {
          var q = t + '?select=*&updated_at=gte.' + encodeURIComponent(from) + '&order=updated_at.asc,id.asc&limit=1000&offset=' + offset;
          return rest('GET', q).then(function (rows) {
            var keep = rows.filter(function (r) {
              if (Date.parse(r.updated_at) > Date.parse(maxSeen)) maxSeen = r.updated_at;
              var local = Store.byId(t, r.id);
              if (local && local._dirty) return false;                // local change not uploaded yet wins
              if (local && local.updated_at === r.updated_at) return false;  // already have it
              return true;
            });
            if (keep.length) changed = true;
            return Store.saveFromServer(t, keep).then(function () {
              if (rows.length === 1000) return page(offset + 1000);
            });
          });
        }
        return page(0).then(function () { return Store.setMeta('pull_' + t, maxSeen); });
      });
    });
    return chain.then(function () { return changed; });
  }

  function syncNow() {
    if (!configured || !session()) return Promise.resolve();
    if (!navigator.onLine) { notify(); return Promise.resolve(); }
    if (running) { again = true; return Promise.resolve(); }
    running = true; state.syncing = true; notify();
    return push().then(pull).then(function (changed) {
      state.lastSync = new Date().toISOString(); state.error = null;
      if (changed) Store.notify('server');
    }).catch(function (e) {
      console.warn('sync failed', e);
      state.error = e.message || String(e);
      if (e.needLogin) Store.notify('login');
    }).then(function () {
      running = false; state.syncing = false; notify();
      if (again) { again = false; return syncNow(); }
    });
  }

  function isAdmin() {
    if (!configured) return Promise.resolve(true);
    return rest('GET', 'app_admins?select=email').then(function (rows) { return rows.length > 0; });
  }

  var statusListeners = [];
  function onStatus(fn) { statusListeners.push(fn); }
  function notify() { statusListeners.forEach(function (fn) { fn(); }); }

  var started = false;
  function start() {
    if (started) return syncNow();
    started = true;
    Store.onChange(function (why) { if (why === 'local') setTimeout(syncNow, 300); });
    window.addEventListener('online', function () { notify(); syncNow(); });
    window.addEventListener('offline', notify);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNow(); });
    clearInterval(timer);
    timer = setInterval(syncNow, 60000);
    return syncNow();
  }

  return {
    configured: configured, state: state, setSessionKey: setSessionKey, session: session,
    login: login, logout: logout, syncNow: syncNow, start: start, isAdmin: isAdmin, onStatus: onStatus
  };
})();
