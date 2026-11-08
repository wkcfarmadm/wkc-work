/* WKC Admin Dashboard – management view and setup. */
var adminTab = 'overview';
var isAdminUser = true;
var ADMIN_TABS = [['overview', 'Overview'], ['records', 'Records'], ['stock', 'Plant stock'], ['workers', 'Workers'],
  ['plots', 'Plots & tables'], ['varieties', 'Varieties'], ['qr', 'QR stickers'], ['account', 'Account']];

function adminHeader() {
  return (isAdminUser ? '' : '<div class="warn">⚠ This account is not an admin. You can look, but changes will be refused by the database. Log out and use the admin account.</div>') +
    '<div class="tabs">' + ADMIN_TABS.map(function (t) {
      return '<button class="tab' + (adminTab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
}
function wireTabs() {
  appEl.querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () { adminTab = b.getAttribute('data-tab'); go(screenAdmin); };
  });
}
function screenAdmin() {
  var f = { overview: tabOverview, records: tabRecords, stock: tabStock, workers: tabWorkers, plots: tabPlots, varieties: tabVarieties, qr: tabQR, account: tabAccount }[adminTab];
  f(); wireTabs();
}
screenAdmin.refreshable = true;

function nextSort(t) { return Store.cache[t].reduce(function (m, r) { return Math.max(m, r.sort || 0); }, 0) + 1; }
function saveRec(t, r) { var m = {}; m[t] = Array.isArray(r) ? r : [r]; return Store.save(m); }
function savedToast() { toast(Sync.configured ? 'Saved – syncing' : 'Saved (demo mode)'); }
function inRangeFn(from, to) {
  var a = new Date(from + 'T00:00:00').getTime(), b = new Date(to + 'T23:59:59.999').getTime();
  return function (v) { var t = ts(v); return t >= a && t <= b; };
}
function bar(now, cap) {
  if (!cap) return '';
  var pct = Math.round(now / cap * 100);
  return '<div class="bar' + (now > cap ? ' over' : '') + '"><span style="width:' + Math.min(100, Math.max(0, pct)) + '%"></span></div><span class="muted">' + pct + '%</span>';
}
function varietyBreakdown(stock) {
  return Object.keys(stock).filter(function (k) { return stock[k]; })
    .sort(function (a, b) { return varietyName(a).localeCompare(varietyName(b)); })
    .map(function (k) { return esc(varietyName(k)) + ' ' + fmtNum(stock[k]); }).join(' · ') || '<span class="muted">–</span>';
}

/* =================== OVERVIEW =================== */
var ovDate = null;
function tabOverview() {
  ovDate = ovDate || dateKey(Date.now());
  var isDay = function (v) { return dateKey(v) === ovDate; };
  var open = openSessions();
  var running = open.filter(function (s) { return runningInterval(s.id); });
  var paused = open.filter(function (s) { return !runningInterval(s.id); });
  var dayIvs = rows('work_intervals').filter(function (i) { return i.end_at && isDay(i.start_at); });
  var dayMs = dayIvs.reduce(function (s, i) { return s + intervalMs(i) * Math.max(1, (i.worker_ids || []).length); }, 0);
  var anakDay = rows('plantings').filter(function (p) { return p.work_type === WORK.ANAK && isDay(p.at); });
  var pokokDay = rows('plantings').filter(function (p) { return p.work_type === WORK.POKOK && isDay(p.at); });
  var sumQ = function (l) { return l.reduce(function (s, p) { return s + (Number(p.quantity) || 0); }, 0); };
  var smap = stockMap();

  // per worker for the day
  var per = {};
  dayIvs.forEach(function (i) { (i.worker_ids || []).forEach(function (w) {
    var o = per[w] = per[w] || { ms: 0, t: {}, q: {} }; o.ms += intervalMs(i); o.t[i.work_type] = (o.t[i.work_type] || 0) + intervalMs(i);
  }); });
  anakDay.concat(pokokDay).forEach(function (p) { (p.worker_ids || []).forEach(function (w) {
    var o = per[w] = per[w] || { ms: 0, t: {}, q: {} }; o.q[p.work_type] = (o.q[p.work_type] || 0) + p.quantity;
  }); });

  render(adminHeader() +
    '<div class="row"><label>Day <input type="date" id="ovd" value="' + ovDate + '"></label>' +
    '<button class="btn btn-light btn-small" id="today">Today</button><button class="btn btn-light btn-small" id="syncnow">↻ Sync now</button></div>' +
    '<div class="stat-grid">' +
    '<div class="stat">Working now<b>' + running.length + '</b><span class="muted">jobs</span></div>' +
    '<div class="stat">Unfinished (stopped)<b>' + paused.length + '</b><span class="muted">jobs</span></div>' +
    '<div class="stat">Worker time<b>' + fmtDur(dayMs) + '</b><span class="muted">all workers, finished periods</span></div>' +
    '<div class="stat">' + esc(WORK.ANAK) + '<b>' + fmtNum(sumQ(anakDay)) + '</b><span class="muted">planted</span></div>' +
    '<div class="stat">' + esc(WORK.POKOK) + '<b>' + fmtNum(sumQ(pokokDay)) + '</b><span class="muted">moved out of nursery</span></div>' +
    '</div>' +

    '<h2>Jobs now</h2>' +
    (open.length ? '<table class="list"><tr><th>Work</th><th>Status</th><th>Started</th><th>Now / last place</th><th>Job time</th><th>Workers so far</th></tr>' +
      running.concat(paused).map(function (s) {
        var run = runningInterval(s.id), ivs = intervalsOf(s.id), last = ivs[ivs.length - 1];
        var old = run && dateKey(run.start_at) !== dateKey(Date.now());
        return '<tr><td>' + WORK_ICON[s.work_type] + ' ' + esc(s.work_type) + '</td><td>' +
          (run ? '<span class="pill pill-warn">working since ' + fmtTime(run.start_at) + '</span>' + (old ? ' <span class="warn">not stopped since ' + fmtDate(run.start_at) + '</span>' : '') : '<span class="pill pill-local">stopped</span>') +
          '</td><td>' + fmtDateTime(s.created_at) + '<br><span class="muted">' + esc(s.start_loc_label) + '</span></td><td>' +
          esc(run ? run.start_loc_label : (last ? last.end_loc_label : '')) + '</td><td>' + fmtDur(sessionTotalMs(s.id)) + '</td><td>' +
          esc(workerNames(sessionWorkerIds(s.id)) || '–') + '</td></tr>';
      }).join('') + '</table>' : '<p class="empty">No unfinished jobs.</p>') +

    nurseryPlots().map(function (n) {
      var st = plotStock(n.id, smap);
      var inD = sumByVariety(plantingsOnDay(WORK.ANAK, ovDate, 'to_plot_id', n.id));
      var outD = sumByVariety(plantingsOnDay(WORK.POKOK, ovDate, 'from_plot_id', n.id));
      var vids = activeVarieties().map(function (v) { return v.id; });
      Object.keys(st).concat(Object.keys(inD), Object.keys(outD)).forEach(function (k) { if (vids.indexOf(k) < 0) vids.push(k); });
      var tot = { st: 0, i: 0, o: 0 };
      return '<h2>🌱 Nursery: ' + esc(n.name) + '</h2><table class="list"><tr><th>Variety</th><th class="num-right">Planted (' + fmtDateKey(ovDate) + ')</th><th class="num-right">Moved out (' + fmtDateKey(ovDate) + ')</th><th class="num-right">Remaining now</th></tr>' +
        vids.map(function (v) {
          tot.st += st[v] || 0; tot.i += inD[v] || 0; tot.o += outD[v] || 0;
          return '<tr><td>' + esc(varietyName(v)) + '</td><td class="num-right">' + fmtNum(inD[v] || 0) + '</td><td class="num-right">' + fmtNum(outD[v] || 0) +
            '</td><td class="num-right"><b>' + fmtNum(st[v] || 0) + '</b></td></tr>';
        }).join('') +
        '<tr><th>Total</th><th class="num-right">' + fmtNum(tot.i) + '</th><th class="num-right">' + fmtNum(tot.o) + '</th><th class="num-right">' + fmtNum(tot.st) + '</th></tr></table>';
    }).join('') +

    '<h2>Plots</h2><table class="list"><tr><th>Plot</th><th class="num-right">Full (capacity)</th><th class="num-right">Now</th><th class="num-right">Space left</th><th>Fill</th><th>By variety</th></tr>' +
    activePlots().filter(function (p) { return !p.is_nursery; }).map(function (p) {
      var now = plotTotal(p.id, smap);
      return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num-right">' + (p.capacity ? fmtNum(p.capacity) : '<span class="muted">not set</span>') +
        '</td><td class="num-right"><b>' + fmtNum(now) + '</b></td><td class="num-right">' + (p.capacity ? fmtNum(p.capacity - now) : '') +
        '</td><td>' + bar(now, p.capacity) + '</td><td>' + varietyBreakdown(plotStock(p.id, smap)) + '</td></tr>';
    }).join('') + '</table>' +

    '<h2>Workers on ' + fmtDateKey(ovDate) + '</h2>' +
    (Object.keys(per).length ? '<table class="list"><tr><th>Worker</th><th>Time</th><th>By work</th><th>Plants</th></tr>' +
      Object.keys(per).sort(function (a, b) { return workerName(a).localeCompare(workerName(b), undefined, { numeric: true }); }).map(function (w) {
        var o = per[w];
        return '<tr><td>' + esc(workerName(w)) + '</td><td><b>' + fmtDur(o.ms) + '</b></td><td>' +
          Object.keys(o.t).map(function (t) { return esc(t) + ' ' + fmtDur(o.t[t]); }).join('<br>') + '</td><td>' +
          Object.keys(o.q).map(function (t) { return esc(t) + ' ' + fmtNum(o.q[t]); }).join('<br>') + '</td></tr>';
      }).join('') + '</table>' : '<p class="empty">No finished work periods on this day.</p>') +
    '<p class="muted">Stock numbers include every record synced to this computer' + (Sync.state.lastSync ? ' (last sync ' + fmtTime(Sync.state.lastSync) + ')' : '') + '.</p>'
  );
  document.getElementById('ovd').onchange = function (e) { ovDate = e.target.value || ovDate; go(screenAdmin); };
  document.getElementById('today').onclick = function () { ovDate = dateKey(Date.now()); go(screenAdmin); };
  document.getElementById('syncnow').onclick = function () { Sync.syncNow(); };
}

/* =================== RECORDS =================== */
var recFrom = null, recTo = null;
function tabRecords() {
  if (!recFrom) { recTo = dateKey(Date.now()); recFrom = dateKey(Date.now() - 6 * 86400000); }
  var inR = inRangeFn(recFrom, recTo);
  var ivs = rows('work_intervals').filter(function (i) { return inR(i.start_at); }).sort(function (a, b) { return ts(a.start_at) - ts(b.start_at); });
  var sids = []; ivs.forEach(function (i) { if (sids.indexOf(i.session_id) < 0) sids.push(i.session_id); });
  var sessions = sids.map(function (id) { return byId('work_sessions', id); }).filter(Boolean).sort(function (a, b) { return ts(b.created_at) - ts(a.created_at); });
  var pls = rows('plantings').filter(function (p) { return inR(p.at); }).sort(function (a, b) { return ts(b.at) - ts(a.at); });

  var sum = {};
  ivs.forEach(function (i) { if (!i.end_at) return; (i.worker_ids || []).forEach(function (w) {
    var o = sum[w] = sum[w] || { ms: 0, t: {}, q: {} }; o.ms += intervalMs(i); o.t[i.work_type] = (o.t[i.work_type] || 0) + intervalMs(i);
  }); });
  pls.forEach(function (p) { (p.worker_ids || []).forEach(function (w) {
    var o = sum[w] = sum[w] || { ms: 0, t: {}, q: {} }; o.q[p.work_type] = (o.q[p.work_type] || 0) + p.quantity;
  }); });
  var pt = {};
  pls.forEach(function (p) { var k = p.work_type + '|' + p.variety_name; pt[k] = (pt[k] || 0) + p.quantity; });

  render(adminHeader() +
    '<div class="row"><label>From <input type="date" id="rf" value="' + recFrom + '"></label><label>To <input type="date" id="rt" value="' + recTo + '"></label></div>' +
    '<div class="row"><button class="btn btn-secondary btn-small" id="c1">⬇ Worker hours CSV</button><button class="btn btn-secondary btn-small" id="c2">⬇ Jobs CSV</button>' +
    '<button class="btn btn-secondary btn-small" id="c3">⬇ Anak tanam / pokok masuk CSV</button><button class="btn btn-secondary btn-small" id="c4">⬇ Plant stock CSV</button></div>' +

    '<h2>Worker summary</h2>' + (Object.keys(sum).length ? '<table class="list"><tr><th>Worker</th><th>Time</th><th>By work</th><th>Plants</th></tr>' +
      Object.keys(sum).sort(function (a, b) { return workerName(a).localeCompare(workerName(b), undefined, { numeric: true }); }).map(function (w) {
        var o = sum[w];
        return '<tr><td>' + esc(workerName(w)) + '</td><td><b>' + fmtDur(o.ms) + '</b></td><td>' + Object.keys(o.t).map(function (t) { return esc(t) + ' ' + fmtDur(o.t[t]); }).join('<br>') +
          '</td><td>' + Object.keys(o.q).map(function (t) { return esc(t) + ' ' + fmtNum(o.q[t]); }).join('<br>') + '</td></tr>';
      }).join('') + '</table>' : '<p class="empty">No records in this date range.</p>') +

    '<h2>Jobs (daun buang / buah batang buang)</h2>' +
    sessions.map(function (s) {
      return '<div class="card"><div class="card-title">' + WORK_ICON[s.work_type] + ' <b>' + esc(s.work_type) + '</b> · ' +
        (s.status === 'finished' ? '<span class="pill pill-ok">finished</span>' : '<span class="pill pill-warn">open</span>') + ' ' + syncBadge('work_sessions', s.id) + '</div>' +
        '<div>' + esc(s.start_loc_label) + ' → ' + esc(s.end_loc_label || '…') + ' · total job time <b>' + fmtDur(sessionTotalMs(s.id)) + '</b></div>' +
        '<div class="muted">Each worker: ' + (sessionWorkerIds(s.id).map(function (w) { return esc(workerName(w)) + ' ' + fmtDur(workerSessionMs(s.id, w)); }).join(' · ') || '–') + '</div>' +
        '<table class="list"><tr><th>Period</th><th>Time</th><th>Place</th><th>Workers</th></tr>' + intervalsOf(s.id).map(function (i) {
          return '<tr><td>' + fmtDateTime(i.start_at) + ' – ' + (i.end_at ? fmtTime(i.end_at) : '<b>running</b>') + '</td><td>' + fmtDur(intervalMs(i)) +
            '</td><td>' + esc(i.start_loc_label) + ' → ' + esc(i.end_loc_label || '…') + (i.end_action ? ' (' + i.end_action + ')' : '') + '</td><td>' + esc(workerNames(i.worker_ids) || '–') + '</td></tr>';
        }).join('') + '</table></div>';
    }).join('') + (sessions.length ? '' : '<p class="empty">None.</p>') +

    '<h2>Anak tanam / pokok masuk</h2><table class="list"><tr><th>Work</th><th>Variety</th><th class="num-right">Quantity</th></tr>' +
    Object.keys(pt).sort().map(function (k) { var p = k.split('|'); return '<tr><td>' + esc(p[0]) + '</td><td>' + esc(p[1]) + '</td><td class="num-right">' + fmtNum(pt[k]) + '</td></tr>'; }).join('') + '</table>' +
    '<table class="list"><tr><th>Date</th><th>Work</th><th>Variety</th><th class="num-right">Qty</th><th>From → To</th><th>Workers</th><th></th></tr>' +
    pls.map(function (p) {
      return '<tr><td>' + fmtDateTime(p.at) + '</td><td>' + esc(p.work_type) + '</td><td>' + esc(p.variety_name) + '</td><td class="num-right">' + fmtNum(p.quantity) +
        '</td><td>' + (p.from_plot_id ? esc(plotName(p.from_plot_id)) + ' → ' : '') + esc(p.to_loc_label) + '</td><td>' + esc(workerNames(p.worker_ids)) + '</td><td>' + syncBadge('plantings', p.id) + '</td></tr>';
    }).join('') + '</table>'
  );
  document.getElementById('rf').onchange = function (e) { recFrom = e.target.value || recFrom; go(screenAdmin); };
  document.getElementById('rt').onchange = function (e) { recTo = e.target.value || recTo; go(screenAdmin); };
  var tag = recFrom + '_' + recTo;
  document.getElementById('c1').onclick = function () {
    var out = [];
    ivs.forEach(function (i) { if (!i.end_at) return; (i.worker_ids || []).forEach(function (w) {
      out.push([dateKey(i.start_at), workerName(w), i.work_type, fmtTime(i.start_at), fmtTime(i.end_at), Math.round(intervalMs(i) / 60000),
        i.start_loc_label, i.end_loc_label, i.end_action, (i.worker_ids || []).length, i.session_id]);
    }); });
    downloadCsv('worker-hours_' + tag + '.csv', ['Date', 'Worker', 'Work', 'Start', 'End', 'Minutes', 'Start place', 'End place', 'End action', 'Workers in period', 'Job ID'], out);
  };
  document.getElementById('c2').onclick = function () {
    downloadCsv('jobs_' + tag + '.csv', ['Job ID', 'Work', 'Status', 'Started', 'Start place', 'Finished', 'End place', 'Total job minutes', 'Each worker (minutes)'],
      sessions.map(function (s) {
        return [s.id, s.work_type, s.status, fmtDateTime(s.created_at), s.start_loc_label, s.finished_at ? fmtDateTime(s.finished_at) : '', s.end_loc_label || '',
          Math.round(sessionTotalMs(s.id) / 60000), sessionWorkerIds(s.id).map(function (w) { return workerName(w) + ' (' + Math.round(workerSessionMs(s.id, w) / 60000) + ')'; }).join('; ')];
      }));
  };
  document.getElementById('c3').onclick = function () {
    downloadCsv('planting-moving_' + tag + '.csv', ['Record ID', 'Date', 'Time', 'Work', 'Variety', 'Quantity', 'From', 'To', 'Workers'],
      pls.map(function (p) { return [p.id, dateKey(p.at), fmtTime(p.at), p.work_type, p.variety_name, p.quantity, p.from_plot_id ? plotName(p.from_plot_id) : '', p.to_loc_label, workerNames(p.worker_ids)]; }));
  };
  document.getElementById('c4').onclick = function () {
    var smap = stockMap(), out = [];
    activePlots().forEach(function (p) { var st = plotStock(p.id, smap); Object.keys(st).forEach(function (v) { if (st[v]) out.push([p.name, p.capacity || '', varietyName(v), st[v]]); }); });
    downloadCsv('plant-stock_' + dateKey(Date.now()) + '.csv', ['Plot', 'Plot capacity (full)', 'Variety', 'Plants now'], out);
  };
}

function downloadCsv(name, header, data) {
  var csv = [header].concat(data).map(function (r) {
    return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\r\n');
  downloadFile(name, '﻿' + csv, 'text/csv');
}
function downloadFile(name, text, type) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* =================== PLANT STOCK =================== */
var stockPlotId = null;
function tabStock() {
  var plots = activePlots();
  if (!stockPlotId || !byId('plots', stockPlotId)) stockPlotId = plots.length ? plots[0].id : null;
  var p = byId('plots', stockPlotId);
  var smap = stockMap(), st = p ? plotStock(p.id, smap) : {};
  var adj = rows('stock_adjustments').filter(function (a) { return a.plot_id === stockPlotId; }).sort(function (a, b) { return ts(b.at) - ts(a.at); });
  var moves = rows('plantings').filter(function (x) { return x.to_plot_id === stockPlotId || x.from_plot_id === stockPlotId; })
    .sort(function (a, b) { return ts(b.at) - ts(a.at); }).slice(0, 50);
  var total = p ? plotTotal(p.id, smap) : 0;
  render(adminHeader() +
    '<p class="muted">Plant numbers are calculated automatically: <b>starting count</b> (entered here once) + <b>Anak tanam</b> + <b>pokok masuk</b> in − <b>pokok masuk</b> out. ' +
    'Use "Set count" only for the starting count or after a real recount.</p>' +
    '<label>Plot <select id="sp">' + plots.map(function (x) { return '<option value="' + x.id + '"' + (x.id === stockPlotId ? ' selected' : '') + '>' + esc(x.name) + (x.is_nursery ? ' (nursery)' : '') + '</option>'; }).join('') + '</select></label>' +
    (p ? '<div class="stat-grid"><div class="stat">Plants now<b>' + fmtNum(total) + '</b></div><div class="stat">Full (capacity)<b>' + (p.capacity ? fmtNum(p.capacity) : '–') + '</b></div>' +
      (p.capacity ? '<div class="stat">Space left<b>' + fmtNum(p.capacity - total) + '</b>' + bar(total, p.capacity) + '</div>' : '') + '</div>' +
      '<h2>Count per variety</h2><table class="list"><tr><th>Variety</th><th class="num-right">Now</th><th>Set count (after recount)</th></tr>' +
      activeVarieties().map(function (v) {
        return '<tr><td>' + esc(v.name) + '</td><td class="num-right"><b>' + fmtNum(st[v.id] || 0) + '</b></td><td><input class="num" type="number" inputmode="numeric" min="0" data-setv="' + v.id + '" placeholder="new count"></td></tr>';
      }).join('') + '</table>' +
      '<label>Note (optional)<input id="snote" placeholder="e.g. starting count, recount 8 Nov"></label>' +
      '<button class="btn btn-primary btn-small" id="sset">Save counts</button>' +
      '<h2>Count history (starting counts / recounts)</h2>' + (adj.length ? '<table class="list"><tr><th>Date</th><th>Variety</th><th class="num-right">Change</th><th>Note</th><th></th></tr>' +
        adj.map(function (a) {
          return '<tr><td>' + fmtDateTime(a.at) + '</td><td>' + esc(varietyName(a.variety_id)) + '</td><td class="num-right">' + (a.quantity > 0 ? '+' : '') + fmtNum(a.quantity) +
            '</td><td>' + esc(a.note || '') + '</td><td><button class="btn btn-light btn-small" data-undo="' + a.id + '">Remove</button> ' + syncBadge('stock_adjustments', a.id) + '</td></tr>';
        }).join('') + '</table>' : '<p class="empty">No counts entered yet.</p>') +
      '<h2>Latest movements</h2>' + (moves.length ? '<table class="list"><tr><th>Date</th><th>Work</th><th>Variety</th><th class="num-right">In/Out</th><th>Place</th></tr>' +
        moves.map(function (m) {
          var out = m.from_plot_id === stockPlotId;
          return '<tr><td>' + fmtDateTime(m.at) + '</td><td>' + esc(m.work_type) + '</td><td>' + esc(m.variety_name) + '</td><td class="num-right">' + (out ? '−' : '+') + fmtNum(m.quantity) +
            '</td><td>' + (out ? 'to ' + esc(m.to_loc_label) : esc(m.to_loc_label)) + '</td></tr>';
        }).join('') + '</table>' : '<p class="empty">No movements yet.</p>') : '<p class="empty">No plots.</p>')
  );
  var sp = document.getElementById('sp');
  if (sp) sp.onchange = function () { stockPlotId = sp.value; go(screenAdmin); };
  var ss = document.getElementById('sset');
  if (ss) ss.onclick = function () {
    var note = document.getElementById('snote').value.trim(), recs = [], now = nowIso(), who = (Sync.session() || {}).email || 'demo';
    appEl.querySelectorAll('[data-setv]').forEach(function (inp) {
      if (inp.value === '') return;
      var want = parseInt(inp.value, 10), vid = inp.getAttribute('data-setv');
      if (isNaN(want) || want < 0) return;
      var diff = want - (st[vid] || 0);
      if (diff) recs.push({ id: Store.uid(), plot_id: stockPlotId, variety_id: vid, quantity: diff, note: note || 'Set count to ' + want, at: now, created_by: who, deleted: false });
    });
    if (!recs.length) return toast('Nothing changed');
    saveRec('stock_adjustments', recs).then(function () { savedToast(); go(screenAdmin); });
  };
  appEl.querySelectorAll('[data-undo]').forEach(function (b) {
    b.onclick = function () {
      if (!confirm('Remove this count change? Plant numbers will be recalculated.')) return;
      var a = byId('stock_adjustments', b.getAttribute('data-undo'));
      saveRec('stock_adjustments', Object.assign({}, a, { deleted: true })).then(function () { savedToast(); go(screenAdmin); });
    };
  });
}

/* =================== WORKERS / VARIETIES =================== */
function nameList(t, label, help) {
  var list = Store.cache[t].slice().sort(sortBy);
  render(adminHeader() + '<p class="muted">' + help + '</p>' +
    '<div class="add-row"><input id="nn" placeholder="New ' + label + ' name"><button class="btn btn-primary btn-small" id="add">+ Add</button></div>' +
    '<table class="list"><tr><th>Name</th><th>Status</th><th></th></tr>' + list.map(function (r) {
      return '<tr class="' + (r.active ? '' : 'inactive') + '"><td><input data-name="' + r.id + '" value="' + esc(r.name) + '"></td>' +
        '<td><button class="btn btn-small ' + (r.active ? 'btn-light' : 'btn-secondary') + '" data-tog="' + r.id + '">' + (r.active ? 'Active – deactivate' : 'Inactive – activate') + '</button></td><td>' + syncBadge(t, r.id) + '</td></tr>';
    }).join('') + '</table>');
  document.getElementById('add').onclick = function () {
    var n = document.getElementById('nn').value.trim();
    if (!n) return toast('Type a name first');
    if (Store.cache[t].some(function (r) { return r.name.toLowerCase() === n.toLowerCase(); })) return toast('That name already exists');
    saveRec(t, { id: Store.uid(), name: n, active: true, sort: nextSort(t), created_at: nowIso() }).then(function () { savedToast(); go(screenAdmin); });
  };
  appEl.querySelectorAll('[data-name]').forEach(function (inp) {
    inp.onchange = function () {
      var r = byId(t, inp.getAttribute('data-name')), n = inp.value.trim();
      if (!n) { inp.value = r.name; return toast('Name cannot be empty'); }
      saveRec(t, Object.assign({}, r, { name: n })).then(savedToast);
    };
  });
  appEl.querySelectorAll('[data-tog]').forEach(function (b) {
    b.onclick = function () { var r = byId(t, b.getAttribute('data-tog')); saveRec(t, Object.assign({}, r, { active: !r.active })).then(function () { go(screenAdmin); }); };
  });
}
function tabWorkers() { nameList('workers', 'worker', 'Edit a name and tap outside the box to save. Deactivated workers disappear from the name lists in the worker apps; their records are kept.'); }
function tabVarieties() { nameList('varieties', 'variety', 'Seedling varieties for Anak tanam and pokok masuk. Deactivate instead of renaming an old variety, so old records stay correct.'); }

/* =================== PLOTS & TABLES =================== */
var editPlotId = null;
function tabPlots() {
  if (editPlotId && byId('plots', editPlotId)) return plotEditor(editPlotId);
  var plots = Store.cache.plots.slice().sort(sortBy), smap = stockMap();
  render(adminHeader() +
    '<p class="muted"><b>Plot capacity</b> = plants when the plot is full (e.g. 6,000). <b>Plants now</b> is calculated automatically (see Plant stock). <b>Table capacity</b> = plants that fit on one table (set inside each plot).</p>' +
    '<div class="card"><div class="card-title">Add a plot</div><div class="form-grid">' +
    '<label>Name<input id="pn" placeholder="e.g. B5-1"></label>' +
    '<label>Layout<select id="pl"><option value="tables">Numbered tables (3 gutters = 1 table)</option><option value="tabletops">Table tops</option></select></label>' +
    '<label>Plot capacity (plants when full)<input id="pc" type="number" inputmode="numeric" min="0" value="0"></label>' +
    '<label class="check"><input type="checkbox" id="pnur"> This is a nursery (苗房)</label></div>' +
    '<button class="btn btn-primary btn-small" id="addp">+ Add plot</button></div>' +
    '<table class="list"><tr><th>Plot</th><th class="num-right">Capacity (full)</th><th class="num-right">Plants now</th><th>Tables</th><th></th></tr>' +
    plots.map(function (p) {
      var tl = tablesOf(p.id);
      return '<tr class="' + (p.active ? '' : 'inactive') + '"><td><b>' + esc(p.name) + '</b><br><span class="muted">' + (p.is_nursery ? 'nursery · ' : '') + (p.layout === 'tabletops' ? 'table tops' : 'numbered tables') + (p.active ? '' : ' · inactive') + '</span></td>' +
        '<td class="num-right">' + (p.capacity ? fmtNum(p.capacity) : '–') + '</td><td class="num-right">' + fmtNum(plotTotal(p.id, smap)) + '</td><td>' + tl.length + '</td>' +
        '<td><button class="btn btn-secondary btn-small" data-open="' + p.id + '">Edit</button></td></tr>';
    }).join('') + '</table>');
  document.getElementById('addp').onclick = function () {
    var n = document.getElementById('pn').value.trim();
    if (!n) return toast('Type the plot name');
    if (Store.cache.plots.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) return toast('That plot already exists');
    saveRec('plots', { id: Store.uid(), name: n, layout: document.getElementById('pl').value, is_nursery: document.getElementById('pnur').checked,
      capacity: Math.max(0, parseInt(document.getElementById('pc').value, 10) || 0), active: true, sort: nextSort('plots'), created_at: nowIso() })
      .then(function () { savedToast(); go(screenAdmin); });
  };
  appEl.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { editPlotId = b.getAttribute('data-open'); go(screenAdmin); }; });
}

function plotEditor(plotId) {
  var p = byId('plots', plotId), tops = p.layout === 'tabletops', tl = tablesOf(plotId, true);
  var capSum = tl.filter(function (t) { return t.active; }).reduce(function (s, t) { return s + (Number(t.capacity) || 0); }, 0);
  render(adminHeader() +
    '<button class="btn btn-light btn-small" id="back">← All plots</button>' +
    '<div class="card"><div class="card-title">Plot settings ' + syncBadge('plots', p.id) + '</div><div class="form-grid">' +
    '<label>Name<input id="pn" value="' + esc(p.name) + '"></label>' +
    '<label>Layout<select id="pl"><option value="tables"' + (tops ? '' : ' selected') + '>Numbered tables (3 gutters = 1 table)</option><option value="tabletops"' + (tops ? ' selected' : '') + '>Table tops</option></select></label>' +
    '<label>Plot capacity (plants when full)<input id="pc" type="number" inputmode="numeric" min="0" value="' + (p.capacity || 0) + '"></label>' +
    '<label class="check"><input type="checkbox" id="pnur"' + (p.is_nursery ? ' checked' : '') + '> This is a nursery (苗房)</label></div>' +
    '<div class="row"><button class="btn btn-primary btn-small" id="savep">Save plot</button><button class="btn btn-light btn-small" id="togp">' + (p.active ? 'Deactivate plot' : 'Activate plot') + '</button></div>' +
    '<p class="muted">Sum of table capacities: <b>' + fmtNum(capSum) + '</b> · Plot capacity: <b>' + fmtNum(p.capacity || 0) + '</b> · Plants now: <b>' + fmtNum(plotTotal(p.id)) + '</b></p></div>' +
    '<div class="card"><div class="card-title">Add ' + (tops ? 'table tops' : 'tables') + ' quickly</div><div class="form-grid">' +
    '<label>Name prefix<input id="tp" value="' + (tops ? 'Top ' : 'T') + '"></label>' +
    '<label>From number<input id="tf" type="number" inputmode="numeric" value="' + (tl.length + 1) + '"></label>' +
    '<label>To number<input id="tt" type="number" inputmode="numeric" value="' + (tl.length + 10) + '"></label>' +
    '<label>Table capacity (plants per table)<input id="tc" type="number" inputmode="numeric" min="0" value="0"></label>' +
    (tops ? '' : '<label>White gutters (喉) per table<input id="tg" type="number" inputmode="numeric" min="1" value="3"></label>') +
    '</div><button class="btn btn-primary btn-small" id="addt">+ Add these</button></div>' +
    '<h2>' + (tops ? 'Table tops' : 'Tables') + ' (' + tl.length + ')</h2>' +
    '<table class="list"><tr><th>Name</th><th>Table capacity</th>' + (tops ? '' : '<th>Gutters</th>') + '<th>Status</th></tr>' +
    tl.map(function (t) {
      return '<tr class="' + (t.active ? '' : 'inactive') + '"><td><input data-tn="' + t.id + '" value="' + esc(t.name) + '"></td>' +
        '<td><input class="num" type="number" inputmode="numeric" min="0" data-tc="' + t.id + '" value="' + (t.capacity || 0) + '"></td>' +
        (tops ? '' : '<td><input class="num" type="number" inputmode="numeric" min="1" data-tg="' + t.id + '" value="' + (t.gutters || 3) + '"></td>') +
        '<td><button class="btn btn-small btn-light" data-tt="' + t.id + '">' + (t.active ? 'Active' : 'Inactive') + '</button></td></tr>';
    }).join('') + '</table>');
  wireTabs();
  document.getElementById('back').onclick = function () { editPlotId = null; go(screenAdmin); };
  document.getElementById('savep').onclick = function () {
    var n = document.getElementById('pn').value.trim();
    if (!n) return toast('Name cannot be empty');
    saveRec('plots', Object.assign({}, p, { name: n, layout: document.getElementById('pl').value, is_nursery: document.getElementById('pnur').checked,
      capacity: Math.max(0, parseInt(document.getElementById('pc').value, 10) || 0) })).then(function () { savedToast(); go(screenAdmin); });
  };
  document.getElementById('togp').onclick = function () { saveRec('plots', Object.assign({}, p, { active: !p.active })).then(function () { go(screenAdmin); }); };
  document.getElementById('addt').onclick = function () {
    var prefix = document.getElementById('tp').value, from = parseInt(document.getElementById('tf').value, 10), to = parseInt(document.getElementById('tt').value, 10);
    var cap = Math.max(0, parseInt(document.getElementById('tc').value, 10) || 0);
    var gut = tops ? null : Math.max(1, parseInt(document.getElementById('tg').value, 10) || 3);
    if (isNaN(from) || isNaN(to) || to < from) return toast('Check the From/To numbers');
    if (to - from > 500) return toast('Max 500 at once');
    var names = tl.map(function (t) { return t.name.toLowerCase(); }), sort = tl.reduce(function (m, t) { return Math.max(m, t.sort || 0); }, 0), add = [], skip = 0;
    for (var i = from; i <= to; i++) {
      var nm = prefix + i;
      if (names.indexOf(nm.toLowerCase()) >= 0) { skip++; continue; }
      add.push({ id: Store.uid(), plot_id: plotId, name: nm, capacity: cap, gutters: gut, active: true, sort: ++sort, created_at: nowIso() });
    }
    if (!add.length) return toast('All of these already exist');
    saveRec('plot_tables', add).then(function () { toast('Added ' + add.length + (skip ? ' (skipped ' + skip + ' existing)' : '')); go(screenAdmin); });
  };
  function bind(attr, field, parse) {
    appEl.querySelectorAll('[' + attr + ']').forEach(function (inp) {
      inp.onchange = function () {
        var t = byId('plot_tables', inp.getAttribute(attr)), v = parse(inp.value);
        if (v === null) return toast('Invalid value');
        var o = {}; o[field] = v;
        saveRec('plot_tables', Object.assign({}, t, o)).then(savedToast);
      };
    });
  }
  bind('data-tn', 'name', function (v) { v = v.trim(); return v || null; });
  bind('data-tc', 'capacity', function (v) { var n = parseInt(v, 10); return isNaN(n) || n < 0 ? null : n; });
  bind('data-tg', 'gutters', function (v) { var n = parseInt(v, 10); return isNaN(n) || n < 1 ? null : n; });
  appEl.querySelectorAll('[data-tt]').forEach(function (b) {
    b.onclick = function () { var t = byId('plot_tables', b.getAttribute('data-tt')); saveRec('plot_tables', Object.assign({}, t, { active: !t.active })).then(function () { go(screenAdmin); }); };
  });
}
plotEditor.refreshable = false;

/* =================== QR STICKERS =================== */
function qrSvg(text) {
  var m = window.WKCQR(text), n = m.length, q = 4, size = n + q * 2, d = '';
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
  return '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
function stickerHtml(kind, o) {
  if (kind === 'plot') {
    return '<div class="sticker">' + qrSvg(qrTextForPlot(o)) + '<div class="st-text"><div class="st-plot">' + esc(o.name) + '</div><div class="st-table">Whole plot</div>' +
      '<div class="st-brand">WKC strawberry farm</div></div></div>';
  }
  return '<div class="sticker">' + qrSvg(qrTextForTable(o)) + '<div class="st-text"><div class="st-plot">' + esc(plotName(o.plot_id)) + '</div><div class="st-table">' + esc(o.name) + '</div>' +
    '<div class="st-line">Table capacity: <b>' + fmtNum(o.capacity || 0) + '</b> plants</div><div class="st-brand">WKC strawberry farm</div></div></div>';
}
var qrPlotId = null;
function tabQR() {
  var plots = activePlots();
  if (!qrPlotId || !byId('plots', qrPlotId)) qrPlotId = plots.length ? plots[0].id : null;
  var tl = qrPlotId ? tablesOf(qrPlotId) : [];
  var unsynced = tl.some(function (t) { return t._dirty; });
  render(adminHeader() +
    '<p class="muted">Choose a plot, tick the stickers you need, then Print. Each table sticker shows the plot, table and table capacity.</p>' +
    (unsynced ? '<p class="warn">Some tables are not synced yet. Stickers still work, but phones only recognise new tables after this computer syncs and the phones sync.</p>' : '') +
    '<label>Plot <select id="qp">' + plots.map(function (p) { return '<option value="' + p.id + '"' + (p.id === qrPlotId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
    '<div class="row"><button class="btn btn-light btn-small" id="all">Tick all</button><button class="btn btn-light btn-small" id="none">Untick all</button></div>' +
    '<div class="checks"><label class="check"><input type="checkbox" id="ps"> Whole-plot sticker</label>' +
    tl.map(function (t) { return '<label class="check"><input type="checkbox" data-qt="' + t.id + '" checked> ' + esc(t.name) + '</label>'; }).join('') + '</div>' +
    (tl.length ? '' : '<p class="empty">This plot has no tables yet. Add them in "Plots & tables".</p>') +
    '<button class="btn btn-primary btn-xl" id="print">🖨 Print selected stickers</button><h2>Preview</h2><div class="sheet" id="preview"></div>');
  var qp = document.getElementById('qp');
  if (qp) qp.onchange = function () { qrPlotId = qp.value; go(screenAdmin); };
  function selected() {
    var out = [];
    if (document.getElementById('ps').checked) out.push(stickerHtml('plot', byId('plots', qrPlotId)));
    appEl.querySelectorAll('[data-qt]').forEach(function (c) { if (c.checked) out.push(stickerHtml('table', byId('plot_tables', c.getAttribute('data-qt')))); });
    return out;
  }
  function preview() { document.getElementById('preview').innerHTML = selected().slice(0, 12).join('') || '<p class="empty">Nothing selected.</p>'; }
  appEl.querySelectorAll('.checks input').forEach(function (c) { c.onchange = preview; });
  document.getElementById('all').onclick = function () { appEl.querySelectorAll('.checks input').forEach(function (c) { c.checked = true; }); preview(); };
  document.getElementById('none').onclick = function () { appEl.querySelectorAll('.checks input').forEach(function (c) { c.checked = false; }); preview(); };
  document.getElementById('print').onclick = function () {
    var s = selected(); if (!s.length) return toast('Nothing selected');
    document.getElementById('print-area').innerHTML = '<div class="sheet">' + s.join('') + '</div>';
    setTimeout(function () { window.print(); }, 100);
  };
  preview();
}
tabQR.refreshable = false;

/* =================== ACCOUNT =================== */
function tabAccount() {
  var s = Sync.session(), n = Store.pending();
  render(adminHeader() +
    '<div class="card"><div class="card-title">Database</div>' +
    (Sync.configured ? '<p>Logged in as <b>' + esc(s ? s.email : '–') + '</b> · ' + (isAdminUser ? 'admin' : '<b>not an admin</b>') + '</p>' :
      '<p class="warn">DEMO MODE: shared/config.js has no Supabase address. Nothing is shared with other devices.</p>') +
    '<p>Waiting to sync on this computer: <b>' + n + '</b>' + (Sync.state.lastSync ? ' · last sync ' + fmtDateTime(Sync.state.lastSync) : '') + '</p>' +
    (Sync.state.error ? '<p class="warn">Last sync problem: ' + esc(Sync.state.error) + '</p>' : '') +
    '<div class="row"><button class="btn btn-secondary btn-small" id="sn">↻ Sync now</button>' + (Sync.configured ? '<button class="btn btn-light btn-small" id="lo">Log out</button>' : '') + '</div></div>' +
    '<div class="card"><div class="card-title">Backup</div><p class="muted">Download everything this computer has as one file (keep it somewhere safe).</p>' +
    '<button class="btn btn-secondary btn-small" id="bk">⬇ Download backup</button></div>');
  document.getElementById('sn').onclick = function () { Sync.syncNow().then(function () { go(screenAdmin); }); };
  var lo = document.getElementById('lo');
  if (lo) lo.onclick = function () {
    if (n && !confirm(n + ' changes are not synced yet. Log out anyway? (They stay on this computer.)')) return;
    Sync.logout().then(function () { location.reload(); });
  };
  document.getElementById('bk').onclick = function () {
    var data = { app: 'wkc-work-tracker', version: 2, exportedAt: nowIso(), tables: {} };
    Store.TABLES.forEach(function (t) { data.tables[t] = Store.cache[t]; });
    downloadFile('wkc-backup_' + dateKey(Date.now()) + '.json', JSON.stringify(data), 'application/json');
  };
}

function startAdminApp() {
  bootApp({
    home: screenAdmin, sessionKey: 'session_admin', who: 'admin',
    afterLogin: function () {
      if (!Sync.configured) return Promise.resolve();
      isAdminUser = Store.getMeta('is_admin', true);
      if (!navigator.onLine) return Promise.resolve();
      return Sync.isAdmin().then(function (a) { isAdminUser = a; return Store.setMeta('is_admin', a); }).catch(function () {});
    }
  });
}
// Only redraw automatically on read-only tabs, so setup forms are never reset while editing.
window.canRefresh = function () { return ['overview', 'records', 'account'].indexOf(adminTab) >= 0; };
