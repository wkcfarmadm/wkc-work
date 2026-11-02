/* WKC Work Tracker – staff screens and shared helpers. */

// Work names – keep exactly as the farm uses them.
var WORK = {
  DAUN: 'daun buang',
  BUAH: 'buah batang buang',
  ANAK: 'Anak tanam',
  POKOK: 'pokok masuk'
};
var WORK_TYPES = [WORK.DAUN, WORK.BUAH, WORK.ANAK, WORK.POKOK];
var SCAN_TYPES = [WORK.DAUN, WORK.BUAH];
var WORK_ICON = {};
WORK_ICON[WORK.DAUN] = '🍃'; WORK_ICON[WORK.BUAH] = '🍓'; WORK_ICON[WORK.ANAK] = '🌱'; WORK_ICON[WORK.POKOK] = '🚚';

var appEl = document.getElementById('app');
var busy = false;            // blocks double taps while saving
var liveTimer = null;        // refreshes running clocks
var autoHomeTimer = null;
var currentScreen = null;    // function that re-draws the current screen

/* ---------- small helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtTime(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(ts) { var d = new Date(ts); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtDateTime(ts) { return fmtDate(ts) + ' ' + fmtTime(ts); }
function dateKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDateKey(k) { var p = k.split('-'); return fmtDate(new Date(+p[0], +p[1] - 1, +p[2]).getTime()); }
function fmtDur(ms) {
  if (ms < 0) ms = 0;
  var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h + 'h ' + pad(m % 60) + 'm';
}
function sortByName(a, b) { return (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name); }

function byId(store, id) { return DB.cache[store].find(function (r) { return r.id === id; }); }
function activeWorkers() { return DB.cache.workers.filter(function (w) { return w.active; }).sort(sortByName); }
function activePlots() { return DB.cache.plots.filter(function (p) { return p.active; }).sort(sortByName); }
function activeVarieties() { return DB.cache.varieties.filter(function (v) { return v.active; }).sort(sortByName); }
function tablesOf(plotId, includeInactive) {
  return DB.cache.tables.filter(function (t) { return t.plotId === plotId && (includeInactive || t.active); })
    .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }); });
}
function workerName(id) { var w = byId('workers', id); return w ? w.name : '(unknown worker)'; }

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show';
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast'; }, 3000);
}

function render(html) {
  appEl.innerHTML = html;
  window.scrollTo(0, 0);
  updateStatusBar();
}

function go(screenFn) {
  var args = Array.prototype.slice.call(arguments, 1);
  Scanner.stop();
  clearInterval(liveTimer); liveTimer = null;
  clearTimeout(autoHomeTimer); autoHomeTimer = null;
  currentScreen = function () { screenFn.apply(null, args); };
  currentScreen();
}

/* ---------- locations & QR content ---------- */
// A location is { id, plotId, label }. id is a table id, or "plot:<plotId>" for a whole plot.
function locForTable(t) {
  var p = byId('plots', t.plotId);
  return { id: t.id, plotId: t.plotId, label: (p ? p.name : '?') + ' / ' + t.name };
}
function locForPlot(p) { return { id: 'plot:' + p.id, plotId: p.id, label: p.name + ' (whole plot)' }; }
function qrSafe(s) { return String(s).replace(/\|/g, '/').replace(/[^\x20-\x7E]/g, '?'); }
function qrTextForTable(t) { var p = byId('plots', t.plotId); return 'WKC|T|' + t.id + '|' + qrSafe(p ? p.name : '') + '|' + qrSafe(t.name); }
function qrTextForPlot(p) { return 'WKC|P|' + p.id + '|' + qrSafe(p.name); }

// Turn scanned text into a location. Works even if this device does not have the table yet
// (it then uses the names printed inside the QR code).
function parseLocationQR(text) {
  if (!text || text.indexOf('WKC|') !== 0) return null;
  var parts = text.split('|');
  if (parts[1] === 'T' && parts.length >= 5) {
    var t = byId('tables', parts[2]);
    if (t) return locForTable(t);
    return { id: parts[2], plotId: null, label: parts[3] + ' / ' + parts[4] };
  }
  if (parts[1] === 'P' && parts.length >= 4) {
    var p = byId('plots', parts[2]);
    if (p) return locForPlot(p);
    return { id: 'plot:' + parts[2], plotId: parts[2], label: parts[3] + ' (whole plot)' };
  }
  return null;
}

/* ---------- work time calculations ---------- */
function intervalMs(iv, now) { return (iv.end || now || Date.now()) - iv.start; }
function intervalsOfSession(sid) { return DB.cache.intervals.filter(function (i) { return i.sessionId === sid; }); }
function activeIntervalOf(wid) { return DB.cache.intervals.find(function (i) { return i.workerId === wid && !i.end; }); }

// Session time = time when at least one worker was working (overlaps counted once).
function sessionTotalMs(sid, now) {
  now = now || Date.now();
  var spans = intervalsOfSession(sid).map(function (i) { return [i.start, i.end || now]; })
    .sort(function (a, b) { return a[0] - b[0]; });
  var total = 0, cs = null, ce = null;
  spans.forEach(function (s) {
    if (cs === null) { cs = s[0]; ce = s[1]; }
    else if (s[0] <= ce) { ce = Math.max(ce, s[1]); }
    else { total += ce - cs; cs = s[0]; ce = s[1]; }
  });
  if (cs !== null) total += ce - cs;
  return total;
}
function workerSessionMs(sid, wid, now) {
  return intervalsOfSession(sid).filter(function (i) { return i.workerId === wid; })
    .reduce(function (sum, i) { return sum + intervalMs(i, now); }, 0);
}
function sessionWorkerIds(sid) {
  var ids = [];
  intervalsOfSession(sid).forEach(function (i) { if (ids.indexOf(i.workerId) < 0) ids.push(i.workerId); });
  return ids;
}

/* ---------- status bar ---------- */
function updateStatusBar() {
  var net = document.getElementById('net');
  net.textContent = navigator.onLine ? '● Online' : '● Offline';
  net.className = 'pill ' + (navigator.onLine ? 'pill-ok' : 'pill-warn');
  var n = DB.cache.intervals.length + DB.cache.plantings.length;
  document.getElementById('saved').textContent = n + ' records saved on this device · not synced';
}
window.addEventListener('online', updateStatusBar);
window.addEventListener('offline', updateStatusBar);

/* =================== STAFF SCREENS =================== */

function screenHome() {
  var ws = activeWorkers();
  render(
    '<h1>Who is working?</h1>' +
    '<p class="muted">' + fmtDate(Date.now()) + ' · Tap your name</p>' +
    '<div class="grid grid-names">' +
    ws.map(function (w) {
      var act = activeIntervalOf(w.id);
      return '<button class="btn btn-name" data-w="' + w.id + '">' + esc(w.name) +
        (act ? '<span class="badge-working">working</span>' : '') + '</button>';
    }).join('') +
    '</div>' +
    (ws.length ? '' : '<p class="empty">No active workers. Ask Admin to add workers.</p>')
  );
  appEl.querySelectorAll('[data-w]').forEach(function (b) {
    b.onclick = function () { go(screenWorker, b.getAttribute('data-w')); };
  });
}

function activeJobCard(iv, wid) {
  var s = byId('sessions', iv.sessionId) || {};
  var now = Date.now();
  var oldDay = dateKey(iv.start) !== dateKey(now);
  var finishedByOther = s.status === 'finished';
  return '<div class="card card-active">' +
    '<div class="card-title">' + (WORK_ICON[s.workType] || '') + ' Working now: <b>' + esc(s.workType) + '</b></div>' +
    '<div>Started ' + fmtDateTime(iv.start) + ' at <b>' + esc(iv.startLocLabel) + '</b></div>' +
    '<div class="big-clock" data-live-start="' + iv.start + '">' + fmtDur(now - iv.start) + '</div>' +
    (oldDay ? '<div class="warn">⚠ This was started on an earlier day and never stopped. The night is being counted. Scan Stop now and tell Admin to correct the time.</div>' : '') +
    (finishedByOther ? '<div class="warn">This job was already finished by another worker. Scan to record your stop.</div>' : '') +
    '<div class="row">' +
    '<button class="btn btn-stop" data-act="stop">⏸ Stop for today<br><small>job not finished · scan table</small></button>' +
    (finishedByOther ? '' : '<button class="btn btn-finish" data-act="finish">✔ Finish job<br><small>scan end table</small></button>') +
    '</div></div>';
}

function screenWorker(wid) {
  var w = byId('workers', wid);
  if (!w) return go(screenHome);
  var act = activeIntervalOf(wid);
  render(
    '<div class="who">👤 ' + esc(w.name) + '</div>' +
    (act ? activeJobCard(act, wid) : '') +
    '<h2>Choose work type</h2>' +
    '<div class="grid grid-work">' +
    WORK_TYPES.map(function (t) {
      var isScan = SCAN_TYPES.indexOf(t) >= 0;
      return '<button class="btn btn-work' + (isScan && act ? ' btn-dim' : '') + '" data-type="' + esc(t) + '">' +
        '<span class="icon">' + WORK_ICON[t] + '</span>' + esc(t) +
        '<small>' + (isScan ? 'scan start & end table' : 'variety · quantity · location') + '</small></button>';
    }).join('') +
    '</div>' +
    '<div class="row"><button class="btn btn-light" id="hist">📋 My history & hours</button>' +
    '<button class="btn btn-light" id="back">← Not me</button></div>'
  );
  appEl.querySelectorAll('[data-type]').forEach(function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-type');
      if (SCAN_TYPES.indexOf(t) >= 0) {
        if (activeIntervalOf(wid)) return toast('Stop or finish your current job first.');
        go(screenScanJob, wid, t);
      } else {
        plantForm = null;
        go(screenPlanting, wid, t);
      }
    };
  });
  if (act) {
    appEl.querySelector('[data-act="stop"]').onclick = function () { go(screenScan, scanOptsStop(wid, act.id, false)); };
    var fb = appEl.querySelector('[data-act="finish"]');
    if (fb) fb.onclick = function () { go(screenScan, scanOptsStop(wid, act.id, true)); };
    startLiveClocks();
  }
  document.getElementById('hist').onclick = function () { go(screenHistory, wid); };
  document.getElementById('back').onclick = function () { go(screenHome); };
}

function startLiveClocks() {
  liveTimer = setInterval(function () {
    appEl.querySelectorAll('[data-live-start]').forEach(function (el) {
      el.textContent = fmtDur(Date.now() - Number(el.getAttribute('data-live-start')));
    });
  }, 15000);
}

// Choose: start a new job, or continue/join an unfinished one.
function screenScanJob(wid, type) {
  var open = DB.cache.sessions.filter(function (s) { return s.workType === type && s.status === 'open'; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });
  render(
    '<div class="who">👤 ' + esc(workerName(wid)) + ' · ' + WORK_ICON[type] + ' <b>' + esc(type) + '</b></div>' +
    '<button class="btn btn-primary btn-xl" id="new">▶ Start NEW job<br><small>scan the QR at your starting table</small></button>' +
    (open.length ? '<h2>Or continue / join an unfinished job</h2>' : '<p class="muted">No unfinished ' + esc(type) + ' jobs.</p>') +
    open.map(function (s) {
      var ids = sessionWorkerIds(s.id);
      var names = ids.map(function (id) {
        var on = DB.cache.intervals.some(function (i) { return i.sessionId === s.id && i.workerId === id && !i.end; });
        return esc(workerName(id)) + (on ? ' <span class="dot-on">●</span>' : '');
      }).join(', ');
      var last = intervalsOfSession(s.id).reduce(function (m, i) { return Math.max(m, i.end || Date.now()); }, s.createdAt);
      return '<div class="card">' +
        '<div><b>Started ' + fmtDateTime(s.createdAt) + '</b> at ' + esc(s.startLocLabel) + '</div>' +
        '<div class="muted">Workers: ' + names + '</div>' +
        '<div class="muted">Job time so far: ' + fmtDur(sessionTotalMs(s.id)) + ' · last activity ' + fmtDateTime(last) + '</div>' +
        '<button class="btn btn-secondary" data-s="' + s.id + '">↻ Continue / join this job</button></div>';
    }).join('') +
    '<button class="btn btn-light" id="back">← Back</button>'
  );
  document.getElementById('new').onclick = function () {
    go(screenScan, {
      title: 'Start ' + type, instruction: 'Scan the QR code at your STARTING table.',
      onLocation: function (loc) { saveStartJob(wid, type, loc); },
      onCancel: function () { go(screenScanJob, wid, type); }
    });
  };
  appEl.querySelectorAll('[data-s]').forEach(function (b) {
    b.onclick = function () {
      var sid = b.getAttribute('data-s');
      go(screenScan, {
        title: 'Continue ' + type, instruction: 'Scan the QR code at the table where you start working now.',
        onLocation: function (loc) { saveResumeJob(wid, sid, loc); },
        onCancel: function () { go(screenScanJob, wid, type); }
      });
    };
  });
  document.getElementById('back').onclick = function () { go(screenWorker, wid); };
}

function scanOptsStop(wid, ivId, finish) {
  return {
    title: finish ? 'Finish job' : 'Stop for today',
    instruction: finish ? 'Scan the QR code at the ENDING table (where the job is complete).'
      : 'Scan the QR code at the table where you stopped. The job stays open for next time.',
    onLocation: function (loc) { saveStop(wid, ivId, loc, finish); },
    onCancel: function () { go(screenWorker, wid); }
  };
}

/* ---------- scanner screen ---------- */
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
  function begin() {
    msg.textContent = 'Point the camera at the QR sticker.';
    msg.className = 'muted center';
    Scanner.start(video, function (text) {
      var loc = parseLocationQR(text);
      if (!loc) {
        msg.textContent = 'This is not a WKC location sticker. Try again.';
        msg.className = 'warn center';
        setTimeout(begin, 1500);
        return;
      }
      if (navigator.vibrate) navigator.vibrate(80);
      opts.onLocation(loc);
    }, function (err) { msg.textContent = err; msg.className = 'warn center'; });
  }
  begin();
  document.getElementById('pick').onclick = function () { go(screenPickLocation, opts, null); };
  document.getElementById('cancel').onclick = function () { opts.onCancel(); };
}

// Manual location choice (when there is no camera, or a sticker is damaged).
function screenPickLocation(opts, plotId) {
  if (!plotId) {
    render(
      '<h1>' + esc(opts.title) + '</h1><p class="instruction">Choose the plot</p>' +
      '<div class="grid grid-names">' + activePlots().map(function (p) {
        return '<button class="btn btn-name" data-p="' + p.id + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="row"><button class="btn btn-light" id="scan">📷 Scan instead</button><button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
    );
    appEl.querySelectorAll('[data-p]').forEach(function (b) {
      b.onclick = function () { go(screenPickLocation, opts, b.getAttribute('data-p')); };
    });
  } else {
    var p = byId('plots', plotId), ts = tablesOf(plotId);
    render(
      '<h1>' + esc(opts.title) + '</h1><p class="instruction">' + esc(p.name) + ' – choose the ' + (p.layout === 'tabletops' ? 'table top' : 'table') + '</p>' +
      '<div class="grid grid-tables">' + ts.map(function (t) {
        return '<button class="btn btn-table" data-t="' + t.id + '">' + esc(t.name) + '</button>';
      }).join('') + '</div>' +
      (ts.length ? '' : '<p class="empty">No tables set up for this plot yet.</p>') +
      '<button class="btn btn-secondary" id="whole">Whole plot (no specific table)</button>' +
      '<div class="row"><button class="btn btn-light" id="plots">← Plots</button><button class="btn btn-light" id="cancel">✕ Cancel</button></div>'
    );
    appEl.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () { opts.onLocation(locForTable(byId('tables', b.getAttribute('data-t')))); };
    });
    document.getElementById('whole').onclick = function () { opts.onLocation(locForPlot(p)); };
    document.getElementById('plots').onclick = function () { go(screenPickLocation, opts, null); };
  }
  var sc = document.getElementById('scan');
  if (sc) sc.onclick = function () { go(screenScan, opts); };
  document.getElementById('cancel').onclick = function () { opts.onCancel(); };
}

/* ---------- saving work sessions ---------- */
function guard(fn) {
  if (busy) return;
  busy = true;
  Promise.resolve().then(fn).catch(function (e) {
    console.error(e);
    alertBox('Could not save: ' + (e && e.message ? e.message : e));
  }).then(function () { busy = false; });
}

function alertBox(msg) {
  render('<div class="card card-error"><h2>Problem</h2><p>' + esc(msg) + '</p></div><button class="btn btn-light" id="home">Home</button>');
  document.getElementById('home').onclick = function () { go(screenHome); };
}

function saveStartJob(wid, type, loc) {
  guard(function () {
    if (activeIntervalOf(wid)) throw new Error('You already have a job running.');
    var now = Date.now();
    var s = {
      id: DB.uid(), workType: type, status: 'open', createdAt: now, createdBy: wid,
      startLocId: loc.id, startLocLabel: loc.label, startPlotId: loc.plotId,
      endLocId: null, endLocLabel: null, finishedAt: null, finishedBy: null, sync: 'local'
    };
    var iv = {
      id: DB.uid(), sessionId: s.id, workerId: wid, workType: type, start: now, end: null,
      startLocId: loc.id, startLocLabel: loc.label, endLocId: null, endLocLabel: null, sync: 'local'
    };
    return DB.putMany({ sessions: [s], intervals: [iv] }).then(function () {
      go(screenConfirm, {
        title: 'Job started', icon: WORK_ICON[type],
        lines: [['Worker', workerName(wid)], ['Work', type], ['Start table', loc.label], ['Time', fmtDateTime(now)]],
        wid: wid
      });
    });
  });
}

function saveResumeJob(wid, sid, loc) {
  guard(function () {
    if (activeIntervalOf(wid)) throw new Error('You already have a job running.');
    var s = byId('sessions', sid);
    if (!s || s.status !== 'open') throw new Error('This job is already finished.');
    var now = Date.now();
    var iv = {
      id: DB.uid(), sessionId: sid, workerId: wid, workType: s.workType, start: now, end: null,
      startLocId: loc.id, startLocLabel: loc.label, endLocId: null, endLocLabel: null, sync: 'local'
    };
    return DB.put('intervals', iv).then(function () {
      go(screenConfirm, {
        title: 'Job continued', icon: WORK_ICON[s.workType],
        lines: [['Worker', workerName(wid)], ['Work', s.workType], ['Job started', fmtDateTime(s.createdAt) + ' at ' + s.startLocLabel],
          ['Now at', loc.label], ['Time', fmtDateTime(now)], ['Your time on this job so far', fmtDur(workerSessionMs(sid, wid))]],
        wid: wid
      });
    });
  });
}

function saveStop(wid, ivId, loc, finish) {
  guard(function () {
    var iv = byId('intervals', ivId);
    if (!iv || iv.end) throw new Error('This work period was already stopped.');
    var s = byId('sessions', iv.sessionId);
    var now = Date.now();
    var iv2 = Object.assign({}, iv, { end: now, endLocId: loc.id, endLocLabel: loc.label, endAction: finish ? 'finish' : 'stop' });
    var map = { intervals: [iv2] };
    var s2 = s;
    if (finish && s.status === 'open') {
      s2 = Object.assign({}, s, { status: 'finished', finishedAt: now, finishedBy: wid, endLocId: loc.id, endLocLabel: loc.label });
      map.sessions = [s2];
    }
    return DB.putMany(map).then(function () {
      var others = DB.cache.intervals.filter(function (i) { return i.sessionId === s.id && !i.end; })
        .map(function (i) { return workerName(i.workerId); });
      var lines = [['Worker', workerName(wid)], ['Work', s.workType], ['Stopped at', loc.label],
        ['This work period', fmtTime(iv.start) + ' – ' + fmtTime(now) + ' (' + fmtDur(now - iv.start) + ')'],
        ['Your total on this job', fmtDur(workerSessionMs(s.id, wid))]];
      if (finish) {
        lines.push(['Job', s.startLocLabel + ' → ' + loc.label]);
        lines.push(['Total job time (all workers)', fmtDur(sessionTotalMs(s.id))]);
      }
      go(screenConfirm, {
        title: finish ? 'Job finished' : 'Stopped for today', icon: finish ? '✔' : '⏸',
        note: finish ? (others.length ? 'Still working on this job: ' + others.join(', ') + '. They should scan Stop when done.' : '')
          : 'The job stays open. Next time, choose "' + s.workType + '" and tap "Continue".',
        lines: lines, wid: wid
      });
    });
  });
}

/* ---------- Anak tanam / pokok masuk ---------- */
var plantForm = null;

function nowDateInput() { return dateKey(Date.now()); }
function nowTimeInput() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function screenPlanting(wid, type) {
  if (!plantForm || plantForm.wid !== wid || plantForm.type !== type) {
    plantForm = { wid: wid, type: type, varietyId: null, qty: '', date: nowDateInput(), time: nowTimeInput(), loc: null };
  }
  var f = plantForm;
  var isMove = type === WORK.POKOK;
  var nursery = DB.cache.plots.find(function (p) { return p.layout === 'tabletops' && p.active; });
  render(
    '<div class="who">👤 ' + esc(workerName(wid)) + ' · ' + WORK_ICON[type] + ' <b>' + esc(type) + '</b></div>' +
    '<h2>1. Variety</h2><div class="grid grid-chips">' +
    activeVarieties().map(function (v) {
      return '<button class="btn btn-chip' + (f.varietyId === v.id ? ' selected' : '') + '" data-v="' + v.id + '">' + esc(v.name) + '</button>';
    }).join('') + '</div>' +
    '<h2>2. Quantity (plants)</h2>' +
    '<div class="qty-row"><button class="btn btn-qty" data-q="-10">−10</button><button class="btn btn-qty" data-q="-1">−1</button>' +
    '<input id="qty" class="qty" type="number" inputmode="numeric" min="1" value="' + esc(f.qty) + '" placeholder="0">' +
    '<button class="btn btn-qty" data-q="1">+1</button><button class="btn btn-qty" data-q="10">+10</button></div>' +
    '<div class="row"><button class="btn btn-qty" data-q="50">+50</button><button class="btn btn-qty" data-q="100">+100</button><button class="btn btn-qty" data-q="500">+500</button><button class="btn btn-qty" data-q="0">Clear</button></div>' +
    '<h2>3. ' + (isMove ? 'Destination (where the plants went)' : 'Location') + '</h2>' +
    (isMove ? '<p class="muted">From: ' + esc(nursery ? nursery.name : 'nursery') + '</p>' : '') +
    '<div class="loc-box">' + (f.loc ? '📍 <b>' + esc(f.loc.label) + '</b>' : '<span class="muted">Not selected yet</span>') + '</div>' +
    '<div class="row"><button class="btn btn-secondary" id="scanloc">📷 Scan QR</button><button class="btn btn-secondary" id="pickloc">☰ Choose from list</button></div>' +
    '<h2>4. Date & time</h2>' +
    '<div class="row"><input id="date" type="date" value="' + esc(f.date) + '"><input id="time" type="time" value="' + esc(f.time) + '"></div>' +
    '<button class="btn btn-primary btn-xl" id="save">✔ Save ' + esc(type) + '</button>' +
    '<button class="btn btn-light" id="back">← Back</button>'
  );
  var qty = document.getElementById('qty');
  qty.oninput = function () { f.qty = qty.value; };
  appEl.querySelectorAll('[data-v]').forEach(function (b) {
    b.onclick = function () {
      f.varietyId = b.getAttribute('data-v');
      appEl.querySelectorAll('[data-v]').forEach(function (x) { x.classList.toggle('selected', x === b); });
    };
  });
  appEl.querySelectorAll('[data-q]').forEach(function (b) {
    b.onclick = function () {
      var d = Number(b.getAttribute('data-q'));
      var v = d === 0 ? 0 : Math.max(0, (parseInt(qty.value, 10) || 0) + d);
      qty.value = v || ''; f.qty = qty.value;
    };
  });
  document.getElementById('date').onchange = function (e) { f.date = e.target.value; };
  document.getElementById('time').onchange = function (e) { f.time = e.target.value; };
  var locOpts = {
    title: isMove ? 'Destination' : 'Location',
    instruction: 'Scan the QR code at the ' + (isMove ? 'destination' : 'planting') + ' table.',
    onLocation: function (loc) { f.loc = loc; go(screenPlanting, wid, type); },
    onCancel: function () { go(screenPlanting, wid, type); }
  };
  document.getElementById('scanloc').onclick = function () { go(screenScan, locOpts); };
  document.getElementById('pickloc').onclick = function () { go(screenPickLocation, locOpts, null); };
  document.getElementById('back').onclick = function () { plantForm = null; go(screenWorker, wid); };
  document.getElementById('save').onclick = function () { savePlanting(nursery); };
}

function savePlanting(nursery) {
  var f = plantForm;
  var q = parseInt(f.qty, 10);
  if (!f.varietyId) return toast('Choose a variety.');
  if (!q || q < 1) return toast('Enter the quantity.');
  if (!f.loc) return toast(f.type === WORK.POKOK ? 'Choose the destination.' : 'Choose the location.');
  if (!f.date || !f.time) return toast('Enter date and time.');
  guard(function () {
    var v = byId('varieties', f.varietyId);
    var p = f.date.split('-'), t = f.time.split(':');
    var at = new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]).getTime();
    var rec = {
      id: DB.uid(), workType: f.type, workerId: f.wid, varietyId: v.id, varietyName: v.name, quantity: q,
      at: at, date: f.date, time: f.time, locId: f.loc.id, locLabel: f.loc.label, plotId: f.loc.plotId,
      fromPlotId: f.type === WORK.POKOK && nursery ? nursery.id : null,
      fromLabel: f.type === WORK.POKOK && nursery ? nursery.name : null,
      createdAt: Date.now(), sync: 'local'
    };
    return DB.put('plantings', rec).then(function () {
      var lines = [['Worker', workerName(f.wid)], ['Work', f.type], ['Variety', v.name], ['Quantity', q + ' plants']];
      if (rec.fromLabel) lines.push(['From', rec.fromLabel]);
      lines.push([f.type === WORK.POKOK ? 'Destination' : 'Location', f.loc.label]);
      lines.push(['Date & time', fmtDateTime(at)]);
      var wid = f.wid, type = f.type;
      plantForm = null;
      go(screenConfirm, { title: 'Saved', icon: WORK_ICON[type], lines: lines, wid: wid, again: type });
    });
  });
}

/* ---------- confirmation ---------- */
function screenConfirm(c) {
  render(
    '<div class="confirm">' +
    '<div class="confirm-icon">✅</div>' +
    '<h1>' + (c.icon ? c.icon + ' ' : '') + esc(c.title) + '</h1>' +
    '<table class="kv">' + c.lines.map(function (l) { return '<tr><th>' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>'; }).join('') + '</table>' +
    (c.note ? '<p class="note">' + esc(c.note) + '</p>' : '') +
    '<p class="pill pill-local">💾 Saved on this device · not synced</p>' +
    '</div>' +
    (c.again ? '<button class="btn btn-secondary" id="again">+ Add another ' + esc(c.again) + '</button>' : '') +
    '<button class="btn btn-primary btn-xl" id="done">Done</button>' +
    '<p class="muted center" id="autohome">Returning to the name list in 20 s</p>'
  );
  document.getElementById('done').onclick = function () { go(screenHome); };
  var ag = document.getElementById('again');
  if (ag) ag.onclick = function () { go(screenPlanting, c.wid, c.again); };
  autoHomeTimer = setTimeout(function () { go(screenHome); }, 20000);
}

/* ---------- worker history ---------- */
function screenHistory(wid) {
  var since = Date.now() - 14 * 86400000;
  var ivs = DB.cache.intervals.filter(function (i) { return i.workerId === wid && (i.end || Date.now()) >= since; });
  var pls = DB.cache.plantings.filter(function (p) { return p.workerId === wid && p.at >= since; });
  var days = {};
  ivs.forEach(function (i) { var k = dateKey(i.start); (days[k] = days[k] || { iv: [], pl: [] }).iv.push(i); });
  pls.forEach(function (p) { var k = dateKey(p.at); (days[k] = days[k] || { iv: [], pl: [] }).pl.push(p); });
  var keys = Object.keys(days).sort().reverse();
  render(
    '<div class="who">👤 ' + esc(workerName(wid)) + ' · last 14 days</div>' +
    (keys.length ? '' : '<p class="empty">No records yet.</p>') +
    keys.map(function (k) {
      var d = days[k];
      var total = d.iv.reduce(function (s, i) { return s + intervalMs(i); }, 0);
      d.iv.sort(function (a, b) { return a.start - b.start; });
      return '<div class="card"><div class="card-title">' + fmtDateKey(k) + ' · worked <b>' + fmtDur(total) + '</b></div>' +
        d.iv.map(function (i) {
          return '<div class="hist-row">' + WORK_ICON[i.workType] + ' ' + esc(i.workType) + ' · ' + fmtTime(i.start) + '–' + (i.end ? fmtTime(i.end) : '<b>running</b>') +
            ' · <b>' + fmtDur(intervalMs(i)) + '</b><br><span class="muted">' + esc(i.startLocLabel) + ' → ' + esc(i.endLocLabel || '…') +
            (i.endAction === 'finish' ? ' (finished job)' : !i.end ? '' :
              ((byId('sessions', i.sessionId) || {}).status === 'finished' ? ' (stopped · job now finished)' : ' (stopped · job still open)')) + '</span></div>';
        }).join('') +
        d.pl.map(function (p) {
          return '<div class="hist-row">' + WORK_ICON[p.workType] + ' ' + esc(p.workType) + ' · ' + fmtTime(p.at) + ' · <b>' + p.quantity + '</b> ' + esc(p.varietyName) +
            '<br><span class="muted">' + esc(p.locLabel) + '</span></div>';
        }).join('') +
        '</div>';
    }).join('') +
    '<button class="btn btn-light" id="back">← Back</button>'
  );
  document.getElementById('back').onclick = function () { go(screenWorker, wid); };
}

/* ---------- start-up ---------- */
function boot() {
  DB.open()
    .then(DB.loadAll)
    .then(DB.seedIfEmpty)
    .then(function () {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      document.getElementById('homeBtn').onclick = function () { go(screenHome); };
      document.getElementById('adminBtn').onclick = function () { go(screenAdminLogin); };
      go(screenHome);
    })
    .catch(function (e) {
      appEl.innerHTML = '<div class="card card-error"><h2>Cannot open the local database</h2><p>' + esc(e && e.message ? e.message : e) +
        '</p><p>Private/incognito mode may block storage. Open the app in a normal browser window.</p></div>';
    });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('Service worker not registered', e); });
  }
}
document.addEventListener('DOMContentLoaded', boot);
