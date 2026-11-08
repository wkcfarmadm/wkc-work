/* Shared helpers: work names, formatting, locations/QR, time and stock calculations. */
var WORK = { DAUN: 'daun buang', BUAH: 'buah batang buang', ANAK: 'Anak tanam', POKOK: 'pokok masuk' };
var SCAN_TYPES = [WORK.DAUN, WORK.BUAH];
var WORK_ICON = {};
WORK_ICON[WORK.DAUN] = '🍃'; WORK_ICON[WORK.BUAH] = '🍓'; WORK_ICON[WORK.ANAK] = '🌱'; WORK_ICON[WORK.POKOK] = '🚚';

/* ---------- formatting ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ts(v) { return typeof v === 'number' ? v : Date.parse(v); }
function nowIso() { return new Date().toISOString(); }
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtTime(v) { var d = new Date(ts(v)); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function fmtDate(v) { var d = new Date(ts(v)); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtDateTime(v) { return fmtDate(v) + ' ' + fmtTime(v); }
function dateKey(v) { var d = new Date(ts(v)); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDateKey(k) { var p = k.split('-'); return fmtDate(new Date(+p[0], +p[1] - 1, +p[2]).getTime()); }
function fmtDur(ms) { if (ms < 0) ms = 0; var m = Math.floor(ms / 60000); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; }
function fmtNum(n) { return (Number(n) || 0).toLocaleString('en-US'); }
function sortBy(a, b) { return (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); }

/* ---------- lookups ---------- */
function byId(t, id) { return Store.byId(t, id); }
function rows(t) { return Store.cache[t].filter(function (r) { return !r.deleted; }); }
function activeWorkers() { return Store.cache.workers.filter(function (w) { return w.active; }).sort(sortBy); }
function activePlots() { return Store.cache.plots.filter(function (p) { return p.active; }).sort(sortBy); }
function activeVarieties() { return Store.cache.varieties.filter(function (v) { return v.active; }).sort(sortBy); }
function nurseryPlots() { return activePlots().filter(function (p) { return p.is_nursery; }); }
function tablesOf(plotId, all) {
  return Store.cache.plot_tables.filter(function (t) { return t.plot_id === plotId && (all || t.active); }).sort(sortBy);
}
function workerName(id) { var w = byId('workers', id); return w ? w.name : '(unknown)'; }
function workerNames(ids) { return (ids || []).map(workerName).join(', '); }
function varietyName(id) { var v = byId('varieties', id); return v ? v.name : '(unknown)'; }
function plotName(id) { var p = byId('plots', id); return p ? p.name : '(unknown plot)'; }

/* ---------- locations & QR codes ---------- */
// A location is { id, plotId, label }. id = table id, or "plot:<plotId>" for a whole plot.
function locForTable(t) { return { id: t.id, plotId: t.plot_id, label: plotName(t.plot_id) + ' / ' + t.name }; }
function locForPlot(p) { return { id: 'plot:' + p.id, plotId: p.id, label: p.name + ' (whole plot)' }; }
function qrSafe(s) { return String(s).replace(/\|/g, '/').replace(/[^\x20-\x7E]/g, '?'); }
function qrTextForTable(t) { return 'WKC|T|' + t.id + '|' + qrSafe(plotName(t.plot_id)) + '|' + qrSafe(t.name); }
function qrTextForPlot(p) { return 'WKC|P|' + p.id + '|' + qrSafe(p.name); }
function plotByName(name) { return Store.cache.plots.find(function (p) { return p.name === name; }); }

function parseLocationQR(text) {
  if (!text || text.indexOf('WKC|') !== 0) return null;
  var parts = text.split('|');
  if (parts[1] === 'T' && parts.length >= 5) {
    var t = byId('plot_tables', parts[2]);
    if (t) return locForTable(t);
    var p1 = plotByName(parts[3]);
    return { id: parts[2], plotId: p1 ? p1.id : null, label: parts[3] + ' / ' + parts[4] };
  }
  if (parts[1] === 'P' && parts.length >= 4) {
    var p = byId('plots', parts[2]) || plotByName(parts[3]);
    if (p) return locForPlot(p);
    return { id: 'plot:' + parts[2], plotId: null, label: parts[3] + ' (whole plot)' };
  }
  return null;
}

/* ---------- work time ---------- */
// A job (work_session) has working periods (work_intervals). A period runs from the
// start/continue scan to the stop/finish scan. The workers chosen at the stop/finish
// scan are credited with that whole period.
function intervalsOf(sid) {
  return rows('work_intervals').filter(function (i) { return i.session_id === sid; })
    .sort(function (a, b) { return ts(a.start_at) - ts(b.start_at); });
}
function intervalMs(iv, now) { return (iv.end_at ? ts(iv.end_at) : (now || Date.now())) - ts(iv.start_at); }
function runningInterval(sid) { return intervalsOf(sid).find(function (i) { return !i.end_at; }); }
function sessionTotalMs(sid, now) {
  now = now || Date.now();
  var spans = intervalsOf(sid).map(function (i) { return [ts(i.start_at), i.end_at ? ts(i.end_at) : now]; });
  var total = 0, cs = null, ce = null;
  spans.forEach(function (s) {
    if (cs === null) { cs = s[0]; ce = s[1]; }
    else if (s[0] <= ce) ce = Math.max(ce, s[1]);
    else { total += ce - cs; cs = s[0]; ce = s[1]; }
  });
  if (cs !== null) total += ce - cs;
  return total;
}
function sessionWorkerIds(sid) {
  var ids = [];
  intervalsOf(sid).forEach(function (i) { (i.worker_ids || []).forEach(function (w) { if (ids.indexOf(w) < 0) ids.push(w); }); });
  return ids;
}
function workerSessionMs(sid, wid) {
  return intervalsOf(sid).filter(function (i) { return i.end_at && (i.worker_ids || []).indexOf(wid) >= 0; })
    .reduce(function (s, i) { return s + intervalMs(i); }, 0);
}
function openSessions(type) {
  return rows('work_sessions').filter(function (s) { return s.status === 'open' && (!type || s.work_type === type); })
    .sort(function (a, b) { return ts(b.created_at) - ts(a.created_at); });
}

/* ---------- plant stock (automatic) ----------
   Plants in a plot, per variety =
     starting counts / corrections entered by Admin (stock_adjustments)
   + Anak tanam planted into it
   + pokok masuk moved into it
   - pokok masuk moved out of it (from the nursery) */
function stockMap(untilTs) {
  var m = {};
  function add(plot, variety, q) {
    if (!plot || !variety) return;
    m[plot] = m[plot] || {};
    m[plot][variety] = (m[plot][variety] || 0) + q;
  }
  rows('stock_adjustments').forEach(function (a) { if (!untilTs || ts(a.at) <= untilTs) add(a.plot_id, a.variety_id, Number(a.quantity) || 0); });
  rows('plantings').forEach(function (p) {
    if (untilTs && ts(p.at) > untilTs) return;
    var q = Number(p.quantity) || 0;
    if (p.work_type === WORK.ANAK) add(p.to_plot_id, p.variety_id, q);
    if (p.work_type === WORK.POKOK) { add(p.from_plot_id, p.variety_id, -q); add(p.to_plot_id, p.variety_id, q); }
  });
  return m;
}
function plotStock(plotId, map) { return (map || stockMap())[plotId] || {}; }
function plotTotal(plotId, map) {
  var s = plotStock(plotId, map);
  return Object.keys(s).reduce(function (n, k) { return n + s[k]; }, 0);
}
function plantingsOnDay(type, day, plotField, plotId) {
  return rows('plantings').filter(function (p) {
    return p.work_type === type && dateKey(p.at) === day && (!plotField || p[plotField] === plotId);
  });
}
function sumByVariety(list) {
  var o = {};
  list.forEach(function (p) { o[p.variety_id] = (o[p.variety_id] || 0) + (Number(p.quantity) || 0); });
  return o;
}
