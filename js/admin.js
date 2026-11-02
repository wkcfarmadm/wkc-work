/* WKC Work Tracker – Admin screens. */
var adminTab = 'workers';
var adminUnlocked = false;

function screenAdminLogin() {
  if (adminUnlocked) return go(screenAdmin);
  render(
    '<h1>Admin</h1><p class="muted">Enter the admin PIN</p>' +
    '<input id="pin" class="pin" type="password" inputmode="numeric" autocomplete="off">' +
    '<button class="btn btn-primary btn-xl" id="ok">Open Admin</button>' +
    '<button class="btn btn-light" id="back">← Back</button>'
  );
  var pin = document.getElementById('pin');
  pin.focus();
  function tryPin() {
    if (pin.value === String(DB.getSetting('adminPin', '1234'))) { adminUnlocked = true; go(screenAdmin); }
    else { toast('Wrong PIN'); pin.value = ''; }
  }
  document.getElementById('ok').onclick = tryPin;
  pin.onkeydown = function (e) { if (e.key === 'Enter') tryPin(); };
  document.getElementById('back').onclick = function () { go(screenHome); };
}

var ADMIN_TABS = [['workers', 'Workers'], ['plots', 'Plots & tables'], ['varieties', 'Varieties'], ['qr', 'QR stickers'], ['records', 'Records'], ['settings', 'Backup & PIN']];

function adminHeader() {
  return '<div class="admin-head"><h1>Admin</h1><button class="btn btn-light btn-small" id="lock">🔒 Lock</button></div>' +
    '<div class="tabs">' + ADMIN_TABS.map(function (t) {
      return '<button class="tab' + (adminTab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
}
function wireAdminHeader() {
  appEl.querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () { adminTab = b.getAttribute('data-tab'); go(screenAdmin); };
  });
  document.getElementById('lock').onclick = function () { adminUnlocked = false; go(screenHome); };
}

function screenAdmin() {
  if (!adminUnlocked) return go(screenAdminLogin);
  ({ workers: adminWorkers, plots: adminPlots, varieties: adminVarieties, qr: adminQR, records: adminRecords, settings: adminSettings })[adminTab]();
  wireAdminHeader();
}

function nextSort(store) { return DB.cache[store].reduce(function (m, r) { return Math.max(m, r.sort || 0); }, 0) + 1; }
function saved() { toast('Saved'); }

/* ---------- simple name lists (workers, varieties) ---------- */
function nameListTab(store, label, help) {
  var rows = DB.cache[store].slice().sort(sortByName);
  render(
    adminHeader() + '<p class="muted">' + help + '</p>' +
    '<div class="add-row"><input id="newname" placeholder="New ' + label + ' name"><button class="btn btn-primary btn-small" id="add">+ Add</button></div>' +
    '<table class="list"><tr><th>Name</th><th>Status</th></tr>' +
    rows.map(function (r) {
      return '<tr class="' + (r.active ? '' : 'inactive') + '"><td><input data-name="' + r.id + '" value="' + esc(r.name) + '"></td>' +
        '<td><button class="btn btn-small ' + (r.active ? 'btn-light' : 'btn-secondary') + '" data-toggle="' + r.id + '">' +
        (r.active ? 'Active – deactivate' : 'Inactive – activate') + '</button></td></tr>';
    }).join('') + '</table>'
  );
  document.getElementById('add').onclick = function () {
    var n = document.getElementById('newname').value.trim();
    if (!n) return toast('Type a name first');
    if (DB.cache[store].some(function (r) { return r.name.toLowerCase() === n.toLowerCase(); })) return toast('That name already exists');
    DB.put(store, { id: DB.uid(), name: n, active: true, sort: nextSort(store), createdAt: Date.now() }).then(function () { saved(); go(screenAdmin); });
  };
  appEl.querySelectorAll('[data-name]').forEach(function (inp) {
    inp.onchange = function () {
      var r = byId(store, inp.getAttribute('data-name')), n = inp.value.trim();
      if (!n) { inp.value = r.name; return toast('Name cannot be empty'); }
      DB.put(store, Object.assign({}, r, { name: n })).then(saved);
    };
  });
  appEl.querySelectorAll('[data-toggle]').forEach(function (b) {
    b.onclick = function () {
      var r = byId(store, b.getAttribute('data-toggle'));
      DB.put(store, Object.assign({}, r, { active: !r.active })).then(function () { go(screenAdmin); });
    };
  });
}
function adminWorkers() { nameListTab('workers', 'worker', 'Edit a name and tap outside the box to save. Deactivated workers are hidden from the name list but their records are kept.'); }
function adminVarieties() { nameListTab('varieties', 'variety', 'Seedling varieties used for Anak tanam and pokok masuk. Deactivate instead of deleting so old records stay correct.'); }

/* ---------- plots & tables ---------- */
function adminPlots() {
  var plots = DB.cache.plots.slice().sort(sortByName);
  render(
    adminHeader() +
    '<p class="muted"><b>Plot total plants</b> = all strawberry plants in the whole plot. <b>Table capacity</b> = plants that fit on one table (set inside each plot).</p>' +
    '<div class="card"><div class="card-title">Add a plot</div>' +
    '<div class="form-grid"><label>Name<input id="pname" placeholder="e.g. B5-1"></label>' +
    '<label>Layout<select id="playout"><option value="tables">Numbered tables (3 gutters = 1 table)</option><option value="tabletops">Table tops (nursery)</option></select></label>' +
    '<label>Plot total plants<input id="ptotal" type="number" inputmode="numeric" min="0" value="0"></label></div>' +
    '<button class="btn btn-primary btn-small" id="addplot">+ Add plot</button></div>' +
    '<table class="list"><tr><th>Plot</th><th>Plot total plants</th><th>Tables</th><th></th></tr>' +
    plots.map(function (p) {
      var ts = tablesOf(p.id);
      var cap = ts.reduce(function (s, t) { return s + (Number(t.capacity) || 0); }, 0);
      return '<tr class="' + (p.active ? '' : 'inactive') + '"><td><b>' + esc(p.name) + '</b><br><span class="muted">' + (p.layout === 'tabletops' ? 'table tops' : 'numbered tables') + (p.active ? '' : ' · inactive') + '</span></td>' +
        '<td>' + (p.totalPlants || 0).toLocaleString() + '</td>' +
        '<td>' + ts.length + '<br><span class="muted">capacity sum ' + cap.toLocaleString() + '</span></td>' +
        '<td><button class="btn btn-secondary btn-small" data-open="' + p.id + '">Edit</button></td></tr>';
    }).join('') + '</table>'
  );
  document.getElementById('addplot').onclick = function () {
    var n = document.getElementById('pname').value.trim();
    if (!n) return toast('Type the plot name');
    if (DB.cache.plots.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) return toast('That plot already exists');
    DB.put('plots', {
      id: DB.uid(), name: n, layout: document.getElementById('playout').value,
      totalPlants: Math.max(0, parseInt(document.getElementById('ptotal').value, 10) || 0),
      active: true, sort: nextSort('plots'), createdAt: Date.now()
    }).then(function () { saved(); go(screenAdmin); });
  };
  appEl.querySelectorAll('[data-open]').forEach(function (b) {
    b.onclick = function () { go(screenAdminPlot, b.getAttribute('data-open')); };
  });
}

function screenAdminPlot(plotId) {
  var p = byId('plots', plotId);
  var isTops = p.layout === 'tabletops';
  var ts = tablesOf(plotId, true);
  var cap = ts.filter(function (t) { return t.active; }).reduce(function (s, t) { return s + (Number(t.capacity) || 0); }, 0);
  render(
    adminHeader() +
    '<button class="btn btn-light btn-small" id="back">← All plots</button>' +
    '<div class="card"><div class="card-title">Plot settings</div><div class="form-grid">' +
    '<label>Name<input id="pname" value="' + esc(p.name) + '"></label>' +
    '<label>Layout<select id="playout"><option value="tables"' + (isTops ? '' : ' selected') + '>Numbered tables (3 gutters = 1 table)</option><option value="tabletops"' + (isTops ? ' selected' : '') + '>Table tops (nursery)</option></select></label>' +
    '<label>Plot total plants (whole plot)<input id="ptotal" type="number" inputmode="numeric" min="0" value="' + (p.totalPlants || 0) + '"></label>' +
    '</div><div class="row"><button class="btn btn-primary btn-small" id="saveplot">Save plot</button>' +
    '<button class="btn btn-light btn-small" id="toggleplot">' + (p.active ? 'Deactivate plot' : 'Activate plot') + '</button></div>' +
    '<p class="muted">Sum of active table capacities: <b>' + cap.toLocaleString() + '</b> · Plot total plants: <b>' + (p.totalPlants || 0).toLocaleString() + '</b></p></div>' +

    '<div class="card"><div class="card-title">Add ' + (isTops ? 'table tops' : 'tables') + ' quickly</div><div class="form-grid">' +
    '<label>Name prefix<input id="tprefix" value="' + (isTops ? 'Top ' : 'T') + '"></label>' +
    '<label>From number<input id="tfrom" type="number" inputmode="numeric" value="' + (ts.length + 1) + '"></label>' +
    '<label>To number<input id="tto" type="number" inputmode="numeric" value="' + (ts.length + 10) + '"></label>' +
    '<label>Table capacity (plants per table)<input id="tcap" type="number" inputmode="numeric" min="0" value="0"></label>' +
    (isTops ? '' : '<label>White gutters (喉) per table<input id="tgut" type="number" inputmode="numeric" min="1" value="3"></label>') +
    '</div><button class="btn btn-primary btn-small" id="addtables">+ Add these</button>' +
    '<p class="muted">Example: prefix "T", from 1 to 20 creates T1 … T20.</p></div>' +

    '<h2>' + (isTops ? 'Table tops' : 'Tables') + ' in ' + esc(p.name) + ' (' + ts.length + ')</h2>' +
    (ts.length ? '' : '<p class="empty">None yet.</p>') +
    '<table class="list"><tr><th>Name</th><th>Table capacity</th>' + (isTops ? '' : '<th>Gutters</th>') + '<th>Status</th></tr>' +
    ts.map(function (t) {
      return '<tr class="' + (t.active ? '' : 'inactive') + '"><td><input data-tname="' + t.id + '" value="' + esc(t.name) + '"></td>' +
        '<td><input class="num" type="number" inputmode="numeric" min="0" data-tcap="' + t.id + '" value="' + (t.capacity || 0) + '"></td>' +
        (isTops ? '' : '<td><input class="num" type="number" inputmode="numeric" min="1" data-tgut="' + t.id + '" value="' + (t.gutters || 3) + '"></td>') +
        '<td><button class="btn btn-small btn-light" data-ttoggle="' + t.id + '">' + (t.active ? 'Active' : 'Inactive') + '</button></td></tr>';
    }).join('') + '</table>'
  );
  wireAdminHeader();
  document.getElementById('back').onclick = function () { go(screenAdmin); };
  document.getElementById('saveplot').onclick = function () {
    var n = document.getElementById('pname').value.trim();
    if (!n) return toast('Name cannot be empty');
    DB.put('plots', Object.assign({}, p, {
      name: n, layout: document.getElementById('playout').value,
      totalPlants: Math.max(0, parseInt(document.getElementById('ptotal').value, 10) || 0)
    })).then(function () { saved(); go(screenAdminPlot, plotId); });
  };
  document.getElementById('toggleplot').onclick = function () {
    DB.put('plots', Object.assign({}, p, { active: !p.active })).then(function () { go(screenAdminPlot, plotId); });
  };
  document.getElementById('addtables').onclick = function () {
    var prefix = document.getElementById('tprefix').value;
    var from = parseInt(document.getElementById('tfrom').value, 10), to = parseInt(document.getElementById('tto').value, 10);
    var capv = Math.max(0, parseInt(document.getElementById('tcap').value, 10) || 0);
    var gut = isTops ? null : Math.max(1, parseInt(document.getElementById('tgut').value, 10) || 3);
    if (isNaN(from) || isNaN(to) || to < from) return toast('Check the From/To numbers');
    if (to - from > 500) return toast('Max 500 at once');
    var existing = ts.map(function (t) { return t.name.toLowerCase(); });
    var sort = ts.reduce(function (m, t) { return Math.max(m, t.sort || 0); }, 0);
    var add = [], skipped = 0;
    for (var i = from; i <= to; i++) {
      var name = prefix + i;
      if (existing.indexOf(name.toLowerCase()) >= 0) { skipped++; continue; }
      add.push({ id: DB.uid(), plotId: plotId, name: name, capacity: capv, gutters: gut, active: true, sort: ++sort, createdAt: Date.now() });
    }
    DB.put('tables', add).then(function () {
      toast('Added ' + add.length + (skipped ? ' (skipped ' + skipped + ' existing)' : ''));
      go(screenAdminPlot, plotId);
    });
  };
  function bind(attr, field, parse) {
    appEl.querySelectorAll('[' + attr + ']').forEach(function (inp) {
      inp.onchange = function () {
        var t = byId('tables', inp.getAttribute(attr));
        var v = parse(inp.value);
        if (v === null) { toast('Invalid value'); return; }
        var o = {}; o[field] = v;
        DB.put('tables', Object.assign({}, t, o)).then(saved);
      };
    });
  }
  bind('data-tname', 'name', function (v) { v = v.trim(); return v ? v : null; });
  bind('data-tcap', 'capacity', function (v) { var n = parseInt(v, 10); return isNaN(n) || n < 0 ? null : n; });
  bind('data-tgut', 'gutters', function (v) { var n = parseInt(v, 10); return isNaN(n) || n < 1 ? null : n; });
  appEl.querySelectorAll('[data-ttoggle]').forEach(function (b) {
    b.onclick = function () {
      var t = byId('tables', b.getAttribute('data-ttoggle'));
      DB.put('tables', Object.assign({}, t, { active: !t.active })).then(function () { go(screenAdminPlot, plotId); });
    };
  });
}

/* ---------- QR stickers ---------- */
function qrSvg(text) {
  var m = window.WKCQR(text), n = m.length, q = 4, size = n + q * 2, d = '';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
  return '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">' +
    '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}

function stickerHtml(kind, obj) {
  if (kind === 'plot') {
    return '<div class="sticker">' + qrSvg(qrTextForPlot(obj)) + '<div class="st-text">' +
      '<div class="st-plot">' + esc(obj.name) + '</div><div class="st-table">Whole plot</div>' +
      '<div class="st-line">Plot total: <b>' + (obj.totalPlants || 0).toLocaleString() + '</b> plants</div>' +
      '<div class="st-brand">WKC strawberry farm</div></div></div>';
  }
  var p = byId('plots', obj.plotId);
  return '<div class="sticker">' + qrSvg(qrTextForTable(obj)) + '<div class="st-text">' +
    '<div class="st-plot">' + esc(p.name) + '</div><div class="st-table">' + esc(obj.name) + '</div>' +
    '<div class="st-line">Table capacity: <b>' + (obj.capacity || 0).toLocaleString() + '</b> plants</div>' +
    (p.totalPlants ? '<div class="st-line">Plot total: <b>' + p.totalPlants.toLocaleString() + '</b> plants</div>' : '') +
    '<div class="st-brand">WKC strawberry farm</div></div></div>';
}

var qrPlotId = null;
function adminQR() {
  var plots = activePlots();
  if (!qrPlotId || !byId('plots', qrPlotId)) qrPlotId = plots.length ? plots[0].id : null;
  var ts = qrPlotId ? tablesOf(qrPlotId) : [];
  render(
    adminHeader() +
    '<p class="muted">Choose a plot, tick the stickers you need, then Print. Use sticker paper or print on paper and laminate. Each table QR shows the plot, table, table capacity and plot total.</p>' +
    '<label>Plot <select id="qrplot">' + plots.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === qrPlotId ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('') + '</select></label>' +
    '<div class="row"><button class="btn btn-light btn-small" id="all">Tick all</button><button class="btn btn-light btn-small" id="none">Untick all</button></div>' +
    '<div class="checks"><label class="check"><input type="checkbox" id="plotsticker"> Whole-plot sticker</label>' +
    ts.map(function (t) { return '<label class="check"><input type="checkbox" data-qt="' + t.id + '" checked> ' + esc(t.name) + '</label>'; }).join('') + '</div>' +
    (ts.length ? '' : '<p class="empty">This plot has no tables yet. Add them in "Plots & tables".</p>') +
    '<button class="btn btn-primary btn-xl" id="print">🖨 Print selected stickers</button>' +
    '<h2>Preview</h2><div class="sheet" id="preview"></div>'
  );
  var plotSel = document.getElementById('qrplot');
  if (plotSel) plotSel.onchange = function () { qrPlotId = plotSel.value; go(screenAdmin); };
  function selected() {
    var out = [];
    if (document.getElementById('plotsticker').checked) out.push(stickerHtml('plot', byId('plots', qrPlotId)));
    appEl.querySelectorAll('[data-qt]').forEach(function (c) { if (c.checked) out.push(stickerHtml('table', byId('tables', c.getAttribute('data-qt')))); });
    return out;
  }
  function preview() { document.getElementById('preview').innerHTML = selected().slice(0, 12).join('') || '<p class="empty">Nothing selected.</p>'; }
  appEl.querySelectorAll('.checks input').forEach(function (c) { c.onchange = preview; });
  document.getElementById('all').onclick = function () { appEl.querySelectorAll('.checks input').forEach(function (c) { c.checked = true; }); preview(); };
  document.getElementById('none').onclick = function () { appEl.querySelectorAll('.checks input').forEach(function (c) { c.checked = false; }); preview(); };
  document.getElementById('print').onclick = function () {
    var s = selected();
    if (!s.length) return toast('Nothing selected');
    document.getElementById('print-area').innerHTML = '<div class="sheet">' + s.join('') + '</div>';
    setTimeout(function () { window.print(); }, 100);
  };
  preview();
}

/* ---------- records & reports ---------- */
var recFrom = null, recTo = null;
function inRange(ts) {
  var a = new Date(recFrom + 'T00:00:00').getTime(), b = new Date(recTo + 'T23:59:59').getTime();
  return ts >= a && ts <= b;
}
function adminRecords() {
  if (!recFrom) { recTo = dateKey(Date.now()); recFrom = dateKey(Date.now() - 6 * 86400000); }
  var ivs = DB.cache.intervals.filter(function (i) { return inRange(i.start); });
  var sids = [];
  ivs.forEach(function (i) { if (sids.indexOf(i.sessionId) < 0) sids.push(i.sessionId); });
  var sessions = sids.map(function (id) { return byId('sessions', id); }).filter(Boolean).sort(function (a, b) { return b.createdAt - a.createdAt; });
  var pls = DB.cache.plantings.filter(function (p) { return inRange(p.at); }).sort(function (a, b) { return b.at - a.at; });

  // Worker summary
  var sum = {};
  ivs.forEach(function (i) {
    var s = sum[i.workerId] = sum[i.workerId] || { ms: 0, byType: {}, qty: {} };
    var ms = intervalMs(i); s.ms += ms; s.byType[i.workType] = (s.byType[i.workType] || 0) + ms;
  });
  pls.forEach(function (p) {
    var s = sum[p.workerId] = sum[p.workerId] || { ms: 0, byType: {}, qty: {} };
    s.qty[p.workType] = (s.qty[p.workType] || 0) + p.quantity;
  });
  var running = ivs.filter(function (i) { return !i.end; }).length;

  // Planting totals by type + variety
  var pt = {};
  pls.forEach(function (p) { var k = p.workType + '|' + p.varietyName; pt[k] = (pt[k] || 0) + p.quantity; });

  render(
    adminHeader() +
    '<div class="row"><label>From <input type="date" id="rf" value="' + recFrom + '"></label><label>To <input type="date" id="rt" value="' + recTo + '"></label></div>' +
    '<div class="row"><button class="btn btn-secondary btn-small" id="csv1">⬇ Work periods CSV</button><button class="btn btn-secondary btn-small" id="csv2">⬇ Job sessions CSV</button><button class="btn btn-secondary btn-small" id="csv3">⬇ Anak tanam / pokok masuk CSV</button></div>' +
    (running ? '<p class="warn">' + running + ' work period(s) still running – their time keeps growing until the worker scans Stop.</p>' : '') +

    '<h2>Worker summary</h2><table class="list"><tr><th>Worker</th><th>Recorded time</th><th>By work type</th><th>Plants</th></tr>' +
    Object.keys(sum).map(function (wid) {
      var s = sum[wid];
      return '<tr><td>' + esc(workerName(wid)) + '</td><td><b>' + fmtDur(s.ms) + '</b></td><td>' +
        Object.keys(s.byType).map(function (t) { return esc(t) + ': ' + fmtDur(s.byType[t]); }).join('<br>') + '</td><td>' +
        Object.keys(s.qty).map(function (t) { return esc(t) + ': ' + s.qty[t]; }).join('<br>') + '</td></tr>';
    }).join('') + '</table>' + (Object.keys(sum).length ? '' : '<p class="empty">No records in this date range.</p>') +

    '<h2>Job sessions (daun buang / buah batang buang)</h2>' +
    sessions.map(function (s) {
      var wids = sessionWorkerIds(s.id);
      return '<div class="card"><div class="card-title">' + WORK_ICON[s.workType] + ' ' + esc(s.workType) + ' · ' +
        (s.status === 'finished' ? '<span class="pill pill-ok">finished</span>' : '<span class="pill pill-warn">open</span>') + '</div>' +
        '<div>' + esc(s.startLocLabel) + ' → ' + esc(s.endLocLabel || '…') + '</div>' +
        '<div class="muted">Started ' + fmtDateTime(s.createdAt) + (s.finishedAt ? ' · finished ' + fmtDateTime(s.finishedAt) : '') + '</div>' +
        '<div>Total job time: <b>' + fmtDur(sessionTotalMs(s.id)) + '</b></div>' +
        '<div class="muted">Per worker: ' + wids.map(function (w) { return esc(workerName(w)) + ' ' + fmtDur(workerSessionMs(s.id, w)); }).join(' · ') + '</div></div>';
    }).join('') + (sessions.length ? '' : '<p class="empty">None.</p>') +

    '<h2>Anak tanam / pokok masuk totals</h2><table class="list"><tr><th>Work</th><th>Variety</th><th>Quantity</th></tr>' +
    Object.keys(pt).sort().map(function (k) { var p = k.split('|'); return '<tr><td>' + esc(p[0]) + '</td><td>' + esc(p[1]) + '</td><td>' + pt[k] + '</td></tr>'; }).join('') + '</table>' +
    '<table class="list"><tr><th>Date</th><th>Worker</th><th>Work</th><th>Variety</th><th>Qty</th><th>Location</th></tr>' +
    pls.map(function (p) {
      return '<tr><td>' + fmtDateTime(p.at) + '</td><td>' + esc(workerName(p.workerId)) + '</td><td>' + esc(p.workType) + '</td><td>' + esc(p.varietyName) +
        '</td><td>' + p.quantity + '</td><td>' + esc(p.locLabel) + '</td></tr>';
    }).join('') + '</table>'
  );
  document.getElementById('rf').onchange = function (e) { recFrom = e.target.value || recFrom; go(screenAdmin); };
  document.getElementById('rt').onchange = function (e) { recTo = e.target.value || recTo; go(screenAdmin); };
  document.getElementById('csv1').onclick = function () {
    downloadCsv('work-periods_' + recFrom + '_' + recTo + '.csv',
      ['Work period ID', 'Job session ID', 'Worker', 'Work', 'Start date', 'Start time', 'End date', 'End time', 'Minutes', 'Start location', 'End location', 'End action', 'Sync'],
      ivs.sort(function (a, b) { return a.start - b.start; }).map(function (i) {
        return [i.id, i.sessionId, workerName(i.workerId), i.workType, dateKey(i.start), fmtTime(i.start), i.end ? dateKey(i.end) : '', i.end ? fmtTime(i.end) : 'running',
          Math.round(intervalMs(i) / 60000), i.startLocLabel, i.endLocLabel || '', i.endAction || '', i.sync];
      }));
  };
  document.getElementById('csv2').onclick = function () {
    downloadCsv('job-sessions_' + recFrom + '_' + recTo + '.csv',
      ['Job session ID', 'Work', 'Status', 'Started', 'Start location', 'Finished', 'End location', 'Total job minutes', 'Workers (minutes each)'],
      sessions.map(function (s) {
        return [s.id, s.workType, s.status, fmtDateTime(s.createdAt), s.startLocLabel, s.finishedAt ? fmtDateTime(s.finishedAt) : '', s.endLocLabel || '',
          Math.round(sessionTotalMs(s.id) / 60000),
          sessionWorkerIds(s.id).map(function (w) { return workerName(w) + ' (' + Math.round(workerSessionMs(s.id, w) / 60000) + ')'; }).join('; ')];
      }));
  };
  document.getElementById('csv3').onclick = function () {
    downloadCsv('planting-moving_' + recFrom + '_' + recTo + '.csv',
      ['Record ID', 'Date', 'Time', 'Worker', 'Work', 'Variety', 'Quantity', 'From', 'Location / destination', 'Sync'],
      pls.map(function (p) { return [p.id, p.date, p.time, workerName(p.workerId), p.workType, p.varietyName, p.quantity, p.fromLabel || '', p.locLabel, p.sync]; }));
  };
}

function downloadCsv(name, header, rows) {
  var csv = [header].concat(rows).map(function (r) {
    return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\r\n');
  downloadFile(name, '﻿' + csv, 'text/csv');
}
function downloadFile(name, text, type) {
  var blob = new Blob([text], { type: type });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- backup, setup transfer, PIN ---------- */
var SETUP_STORES = ['workers', 'plots', 'tables', 'varieties'];
function adminSettings() {
  render(
    adminHeader() +
    '<div class="card"><div class="card-title">Copy setup to another phone/tablet</div>' +
    '<p class="muted">Version 1 has no server. To give other devices the same workers, plots, tables and varieties: Export setup here, send the file (WhatsApp/USB), then on the other device open Admin → Backup & PIN → Import.</p>' +
    '<div class="row"><button class="btn btn-secondary btn-small" id="expsetup">⬇ Export setup</button>' +
    '<button class="btn btn-secondary btn-small" id="expall">⬇ Full backup (setup + all records)</button></div>' +
    '<label class="file-label">Import a setup or backup file <input type="file" id="imp" accept=".json,application/json"></label>' +
    '<p class="muted">Import adds and updates; it never deletes anything on this device. Records with the same ID are not duplicated.</p></div>' +
    '<div class="card"><div class="card-title">Admin PIN</div>' +
    '<div class="add-row"><input id="newpin" type="password" inputmode="numeric" placeholder="New PIN (4+ digits)"><button class="btn btn-primary btn-small" id="setpin">Change PIN</button></div></div>' +
    '<div class="card"><div class="card-title">About this device</div><p class="muted" id="about">Checking storage…</p></div>'
  );
  document.getElementById('expsetup').onclick = function () { exportStores(SETUP_STORES, 'wkc-setup_'); };
  document.getElementById('expall').onclick = function () { exportStores(['workers', 'plots', 'tables', 'varieties', 'sessions', 'intervals', 'plantings'], 'wkc-full-backup_'); };
  document.getElementById('imp').onchange = function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (err) { return toast('Not a valid file'); }
      if (!data || data.app !== 'wkc-work-tracker') return toast('This is not a WKC Work Tracker file');
      var map = {}, count = 0;
      Object.keys(data.stores || {}).forEach(function (s) {
        if (DB.STORES.indexOf(s) >= 0 && s !== 'settings' && Array.isArray(data.stores[s])) { map[s] = data.stores[s]; count += data.stores[s].length; }
      });
      if (!count) return toast('File is empty');
      DB.putMany(map).then(function () { toast('Imported ' + count + ' items'); go(screenAdmin); });
    };
    reader.readAsText(file);
  };
  document.getElementById('setpin').onclick = function () {
    var v = document.getElementById('newpin').value.trim();
    if (!/^\d{4,}$/.test(v)) return toast('Use at least 4 digits');
    DB.setSetting('adminPin', v).then(function () { toast('PIN changed'); document.getElementById('newpin').value = ''; });
  };
  var about = document.getElementById('about');
  var info = 'Records on this device: ' + DB.cache.intervals.length + ' work periods, ' + DB.cache.plantings.length + ' planting/moving records. ';
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(function (p) {
      about.textContent = info + (p ? 'Storage is protected from automatic clearing.' : 'Storage is not marked persistent – install the app to the home screen and avoid clearing browser data.');
    });
  } else about.textContent = info;
}

function exportStores(stores, prefix) {
  var data = { app: 'wkc-work-tracker', version: 1, exportedAt: new Date().toISOString(), stores: {} };
  stores.forEach(function (s) { data.stores[s] = DB.cache[s]; });
  downloadFile(prefix + dateKey(Date.now()) + '.json', JSON.stringify(data, null, 1), 'application/json');
}
