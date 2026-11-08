/* Shared screens and screen helpers used by all three apps. */
var appEl = null;
var busy = false, liveTimer = null, autoHomeTimer = null;
var currentScreen = null, currentRefreshable = false;
var HOME = null;   // set by each app: function that draws its home screen

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show';
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast'; }, 3200);
}

function render(html) {
  appEl.innerHTML = html;
  updateStatusBar();
  updateSyncBadges();
}

// Show a screen. Screens marked .refreshable are redrawn when new data arrives from the server.
function go(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (typeof Scanner !== 'undefined') Scanner.stop();
  clearInterval(liveTimer); liveTimer = null;
  clearTimeout(autoHomeTimer); autoHomeTimer = null;
  currentRefreshable = !!fn.refreshable;
  currentScreen = function () { fn.apply(null, args); };
  currentScreen();
  window.scrollTo(0, 0);
}

function refreshIfIdle() {
  var ae = document.activeElement;
  if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;     // never disturb typing
  if (window.canRefresh && !window.canRefresh()) return;
  if (currentRefreshable && currentScreen) {
    var y = window.scrollY;
    currentScreen();
    window.scrollTo(0, y);
  }
}

function guard(fn) {
  if (busy) return;
  busy = true;
  Promise.resolve().then(fn).catch(function (e) {
    console.error(e);
    render('<div class="card card-error"><h2>Problem</h2><p>' + esc(e && e.message ? e.message : e) + '</p></div>' +
      '<button class="btn btn-light" id="home">Home</button>');
    document.getElementById('home').onclick = function () { go(HOME); };
  }).then(function () { busy = false; });
}

function startLiveClocks() {
  clearInterval(liveTimer);
  liveTimer = setInterval(function () {
    appEl.querySelectorAll('[data-live-start]').forEach(function (el) {
      el.textContent = fmtDur(Date.now() - Number(el.getAttribute('data-live-start')) + Number(el.getAttribute('data-live-base') || 0));
    });
  }, 15000);
}

/* ---------- status bar + sync badges ---------- */
function updateStatusBar() {
  var net = document.getElementById('net'), sy = document.getElementById('syncstate');
  if (!net || !sy) return;
  var n = Store.pending();
  net.textContent = navigator.onLine ? '● Online' : '● Offline';
  net.className = 'pill ' + (navigator.onLine ? 'pill-on' : 'pill-off');
  var txt, cls = 'savedbar';
  if (!Sync.configured) { txt = 'DEMO MODE – not connected to the database. Everything stays only on this device.'; cls += ' warnbar'; }
  else if (!Sync.session()) { txt = 'Not logged in – tap here to log in. ' + n + ' records waiting on this device'; cls += ' warnbar'; }
  else if (Sync.state.syncing) txt = 'Syncing…';
  else if (Sync.state.error && navigator.onLine) { txt = '⚠ Sync problem: ' + Sync.state.error + (n ? ' · ' + n + ' waiting' : ''); cls += ' warnbar'; }
  else if (n) txt = '⏳ ' + n + ' record' + (n > 1 ? 's' : '') + ' waiting to sync' + (navigator.onLine ? '' : ' (will send when online)');
  else txt = '✓ All records synced' + (Sync.state.lastSync ? ' · ' + fmtTime(Sync.state.lastSync) : '');
  sy.textContent = txt; sy.className = cls;
}

function syncBadge(table, id) {
  return '<span class="sync-badge" data-st="' + table + '" data-sid="' + id + '"></span>';
}
function updateSyncBadges() {
  if (!appEl) return;
  appEl.querySelectorAll('[data-st]').forEach(function (el) {
    var r = Store.byId(el.getAttribute('data-st'), el.getAttribute('data-sid'));
    var pend = !r || r._dirty;
    el.textContent = pend ? '⏳ Waiting to sync' : '✓ Synced';
    el.className = 'sync-badge ' + (pend ? 'pend' : 'done');
  });
}

/* ---------- login ---------- */
function screenLogin(who, onDone) {
  render(
    '<h1>Log in</h1>' +
    '<p class="muted">' + (who === 'admin' ? 'Use the <b>admin</b> account.' : 'Use the <b>staff</b> account. You only need to do this once on each phone or tablet.') + '</p>' +
    '<label>Email<input id="em" type="email" autocomplete="username" autocapitalize="off"></label>' +
    '<label>Password<input id="pw" type="password" autocomplete="current-password"></label>' +
    '<button class="btn btn-primary btn-xl" id="login">Log in</button>' +
    '<p class="muted">' + (navigator.onLine ? '' : '⚠ You are offline. Logging in needs internet.') + '</p>'
  );
  function doLogin() {
    var em = document.getElementById('em').value, pw = document.getElementById('pw').value;
    if (!em || !pw) return toast('Enter email and password');
    var b = document.getElementById('login'); b.disabled = true; b.textContent = 'Logging in…';
    Sync.login(em, pw).then(function () { onDone(); }).catch(function (e) {
      b.disabled = false; b.textContent = 'Log in';
      toast(/invalid/i.test(e.message) ? 'Wrong email or password' : e.message);
    });
  }
  document.getElementById('login').onclick = doLogin;
  document.getElementById('pw').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
}

/* ---------- QR scan ---------- */
// opts: { title, instruction, filter(loc) -> error text or '', onLocation(loc), onCancel() , plots (optional list for manual pick) }
function screenScan(opts) {
  render(
    '<h1>' + esc(opts.title) + '</h1>' +
    '<p class="instruction">' + esc(opts.instruction) + '</p>' +
    '<div class="video-wrap"><video id="cam" playsinline muted></video><div class="aim"></div></div>' +
    '<p id="scanmsg" class="muted center">Starting camera…</p>' +
    '<div class="row"><button class="btn btn-secondary" id="pick">☰ Choose from list</button>' +
    '<button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
  );
  var video = document.getElementById('cam'), msg = document.getElementById('scanmsg');
  function fail(t) { msg.textContent = t; msg.className = 'warn center'; setTimeout(begin, 2200); }
  function begin() {
    if (!document.getElementById('cam')) return;
    msg.textContent = 'Point the camera at the QR sticker.'; msg.className = 'muted center';
    Scanner.start(video, function (text) {
      var loc = parseLocationQR(text);
      if (!loc) return fail('This is not a WKC location sticker. Try again.');
      var err = opts.filter ? opts.filter(loc) : '';
      if (err) return fail(err);
      if (navigator.vibrate) navigator.vibrate(80);
      opts.onLocation(loc);
    }, function (err) { msg.textContent = err; msg.className = 'warn center'; });
  }
  begin();
  document.getElementById('pick').onclick = function () { go(screenPickLocation, opts, null); };
  document.getElementById('cancel').onclick = function () { opts.onCancel(); };
}

function screenPickLocation(opts, plotId) {
  var plots = (opts.plots ? opts.plots() : activePlots());
  if (!plotId && plots.length === 1) plotId = plots[0].id;
  if (!plotId) {
    render(
      '<h1>' + esc(opts.title) + '</h1><p class="instruction">Choose the plot</p>' +
      '<div class="grid grid-names">' + plots.map(function (p) {
        return '<button class="btn btn-name" data-p="' + p.id + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' + (plots.length ? '' : '<p class="empty">No plots available.</p>') +
      '<div class="row"><button class="btn btn-light" id="scan">📷 Scan instead</button><button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
    );
    appEl.querySelectorAll('[data-p]').forEach(function (b) {
      b.onclick = function () { go(screenPickLocation, opts, b.getAttribute('data-p')); };
    });
  } else {
    var p = byId('plots', plotId), tl = tablesOf(plotId);
    render(
      '<h1>' + esc(opts.title) + '</h1><p class="instruction">' + esc(p.name) + ' – choose the ' + (p.layout === 'tabletops' ? 'table top' : 'table') + '</p>' +
      '<div class="grid grid-tables">' + tl.map(function (t) {
        return '<button class="btn btn-table" data-t="' + t.id + '">' + esc(t.name) + '</button>';
      }).join('') + '</div>' +
      (tl.length ? '' : '<p class="empty">No tables set up for this plot yet.</p>') +
      '<button class="btn btn-secondary" id="whole">Whole plot (no specific table)</button>' +
      '<div class="row">' + (plots.length > 1 ? '<button class="btn btn-light" id="plots">← Plots</button>' : '<button class="btn btn-light" id="scan">📷 Scan instead</button>') +
      '<button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
    );
    appEl.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () { opts.onLocation(locForTable(byId('plot_tables', b.getAttribute('data-t')))); };
    });
    document.getElementById('whole').onclick = function () { opts.onLocation(locForPlot(p)); };
    var pb = document.getElementById('plots');
    if (pb) pb.onclick = function () { go(screenPickLocation, opts, null); };
  }
  var sc = document.getElementById('scan');
  if (sc) sc.onclick = function () { go(screenScan, opts); };
  document.getElementById('cancel').onclick = function () { opts.onCancel(); };
}

/* ---------- choose workers (more than one allowed) ---------- */
// opts: { title, summary (html), preselect [ids], confirmText, onConfirm(ids), onCancel() }
function screenNames(opts) {
  var sel = (opts.preselect || []).slice();
  render(
    '<h1>' + esc(opts.title) + '</h1>' + (opts.summary || '') +
    '<p class="instruction">Who did this work? Tap every name.</p>' +
    '<div class="grid grid-names">' + activeWorkers().map(function (w) {
      return '<button class="btn btn-name btn-pick' + (sel.indexOf(w.id) >= 0 ? ' selected' : '') + '" data-w="' + w.id + '">' + esc(w.name) + '</button>';
    }).join('') + '</div>' +
    '<div class="sticky-bottom"><button class="btn btn-primary btn-xl" id="ok"></button>' +
    '<button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
  );
  var ok = document.getElementById('ok');
  function label() {
    ok.textContent = sel.length ? '✔ ' + (opts.confirmText || 'Save') + ' (' + sel.length + ' worker' + (sel.length > 1 ? 's' : '') + ')' : 'Select at least one name';
    ok.disabled = !sel.length;
  }
  appEl.querySelectorAll('[data-w]').forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-w'), i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1); else sel.push(id);
      b.classList.toggle('selected', i < 0);
      label();
    };
  });
  label();
  ok.onclick = function () { if (sel.length) opts.onConfirm(sel.slice()); };
  document.getElementById('cancel').onclick = function () { opts.onCancel(); };
}

/* ---------- confirmation ---------- */
// c: { title, icon, lines [[label, value]], note, badge: [table, id], again: {text, fn} }
function screenConfirm(c) {
  render(
    '<div class="confirm"><div class="confirm-icon">✅</div>' +
    '<h1>' + (c.icon ? c.icon + ' ' : '') + esc(c.title) + '</h1>' +
    '<table class="kv">' + c.lines.map(function (l) { return '<tr><th>' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>'; }).join('') + '</table>' +
    (c.note ? '<p class="note">' + esc(c.note) + '</p>' : '') +
    '<p>💾 Saved on this device · ' + (c.badge ? syncBadge(c.badge[0], c.badge[1]) : '') + '</p></div>' +
    (c.again ? '<button class="btn btn-secondary" id="again">' + esc(c.again.text) + '</button>' : '') +
    '<button class="btn btn-primary btn-xl" id="done">Done</button>' +
    '<p class="muted center">Returning to the start screen in 20 s</p>'
  );
  document.getElementById('done').onclick = function () { go(HOME); };
  var ag = document.getElementById('again');
  if (ag) ag.onclick = c.again.fn;
  autoHomeTimer = setTimeout(function () { go(HOME); }, 20000);
}

/* ---------- worker hours (staff can see their own) ---------- */
function screenHoursPick() {
  render(
    '<h1>My hours</h1><p class="instruction">Tap your name</p>' +
    '<div class="grid grid-names">' + activeWorkers().map(function (w) {
      return '<button class="btn btn-name" data-w="' + w.id + '">' + esc(w.name) + '</button>';
    }).join('') + '</div><button class="btn btn-light" id="back">← Back</button>'
  );
  appEl.querySelectorAll('[data-w]').forEach(function (b) { b.onclick = function () { go(screenHours, b.getAttribute('data-w')); }; });
  document.getElementById('back').onclick = function () { go(HOME); };
}

function workerDays(wid, sinceTs, untilTs) {
  var days = {};
  rows('work_intervals').forEach(function (i) {
    if (!i.end_at || (i.worker_ids || []).indexOf(wid) < 0) return;
    var t = ts(i.start_at); if (t < sinceTs || (untilTs && t > untilTs)) return;
    var k = dateKey(t); (days[k] = days[k] || { iv: [], pl: [] }).iv.push(i);
  });
  rows('plantings').forEach(function (p) {
    if ((p.worker_ids || []).indexOf(wid) < 0) return;
    var t = ts(p.at); if (t < sinceTs || (untilTs && t > untilTs)) return;
    var k = dateKey(t); (days[k] = days[k] || { iv: [], pl: [] }).pl.push(p);
  });
  return days;
}

function screenHours(wid) {
  var days = workerDays(wid, Date.now() - 14 * 86400000);
  var keys = Object.keys(days).sort().reverse();
  render(
    '<div class="who">👤 ' + esc(workerName(wid)) + ' · last 14 days</div>' +
    (keys.length ? '' : '<p class="empty">No records yet.</p>') +
    keys.map(function (k) {
      var d = days[k];
      var total = d.iv.reduce(function (s, i) { return s + intervalMs(i); }, 0);
      d.iv.sort(function (a, b) { return ts(a.start_at) - ts(b.start_at); });
      return '<div class="card"><div class="card-title">' + fmtDateKey(k) + ' · worked <b>' + fmtDur(total) + '</b></div>' +
        d.iv.map(function (i) {
          return '<div class="hist-row">' + WORK_ICON[i.work_type] + ' ' + esc(i.work_type) + ' · ' + fmtTime(i.start_at) + '–' + fmtTime(i.end_at) +
            ' · <b>' + fmtDur(intervalMs(i)) + '</b> ' + syncBadge('work_intervals', i.id) +
            '<br><span class="muted">' + esc(i.start_loc_label) + ' → ' + esc(i.end_loc_label) +
            ((i.worker_ids || []).length > 1 ? ' · with ' + esc(workerNames(i.worker_ids.filter(function (x) { return x !== wid; }))) : '') + '</span></div>';
        }).join('') +
        d.pl.map(function (p) {
          return '<div class="hist-row">' + WORK_ICON[p.work_type] + ' ' + esc(p.work_type) + ' · ' + fmtTime(p.at) + ' · <b>' + fmtNum(p.quantity) + '</b> ' + esc(p.variety_name) +
            ' ' + syncBadge('plantings', p.id) + '<br><span class="muted">' + esc(p.to_loc_label) + '</span></div>';
        }).join('') + '</div>';
    }).join('') +
    '<button class="btn btn-light" id="back">← Back</button>'
  );
  document.getElementById('back').onclick = function () { go(HOME); };
}
screenHours.refreshable = true;

/* ---------- app start-up shared by all apps ---------- */
function bootApp(options) {
  appEl = document.getElementById('app');
  HOME = options.home;
  Sync.setSessionKey(options.sessionKey);
  Store.open().then(Store.loadAll).then(function () {
    if (!Sync.configured) return Store.seedDemo();
  }).then(function () {
    Store.deviceId();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    Sync.onStatus(function () { updateStatusBar(); updateSyncBadges(); });
    Store.onChange(function (why) {
      updateStatusBar();
      if (why === 'server') refreshIfIdle();
      if (why === 'login') toast('Login expired – tap the yellow bar to log in again. Records are kept.');
    });
    // Tapping the status bar when logged out opens the login screen (work can continue meanwhile).
    document.getElementById('syncstate').onclick = function () {
      if (Sync.configured && !Sync.session()) go(screenLogin, options.who, function () { afterLogin(); });
      else Sync.syncNow();
    };
    window.addEventListener('online', updateStatusBar);
    window.addEventListener('offline', updateStatusBar);
    var hb = document.getElementById('homeBtn');
    if (hb) hb.onclick = function () { go(HOME); };
    function afterLogin() {
      Sync.start();
      (options.afterLogin ? options.afterLogin() : Promise.resolve()).then(function () { go(HOME); });
    }
    if (Sync.configured && !Sync.session()) go(screenLogin, options.who, afterLogin);
    else afterLogin();
  }).catch(function (e) {
    appEl.innerHTML = '<div class="card card-error"><h2>Cannot open the local database</h2><p>' + esc(e && e.message ? e.message : e) +
      '</p><p>Private/incognito mode may block storage. Open the app in a normal browser window.</p></div>';
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('Service worker not registered', e); });
  }
}
