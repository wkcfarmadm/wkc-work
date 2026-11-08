/* Worker apps: choose work -> scan location -> work -> scan + choose names at stop/finish. */
var WorkerApp = { name: '', types: [] };

function startWorkerApp(appName, types) {
  WorkerApp.name = appName;
  WorkerApp.types = types;
  bootApp({ home: workerHome, sessionKey: 'session_staff', who: 'staff' });
}

function workerHome() {
  if (WorkerApp.types.length === 1) return screenJobs(WorkerApp.types[0]);
  render(
    '<h1>Choose work</h1><p class="muted">' + fmtDate(Date.now()) + '</p>' +
    '<div class="grid grid-work">' + WorkerApp.types.map(function (t) {
      var n = SCAN_TYPES.indexOf(t) >= 0 ? openSessions(t).length : 0;
      return '<button class="btn btn-work" data-type="' + esc(t) + '"><span class="icon">' + WORK_ICON[t] + '</span>' + esc(t) +
        '<small>' + (SCAN_TYPES.indexOf(t) >= 0 ? (n ? n + ' unfinished job' + (n > 1 ? 's' : '') : 'scan start & end table') : (t === WORK.ANAK ? 'plant seedlings in nursery' : 'move plants from nursery')) + '</small></button>';
    }).join('') + '</div>' +
    '<button class="btn btn-light" id="hours">📋 My hours</button>'
  );
  appEl.querySelectorAll('[data-type]').forEach(function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-type');
      if (SCAN_TYPES.indexOf(t) >= 0) go(screenJobs, t); else startPlanting(t);
    };
  });
  document.getElementById('hours').onclick = function () { go(screenHoursPick); };
}
workerHome.refreshable = true;

/* =================== scan jobs (daun buang / buah batang buang) =================== */
function screenJobs(type) {
  var open = openSessions(type);
  var running = open.filter(function (s) { return runningInterval(s.id); });
  var paused = open.filter(function (s) { return !runningInterval(s.id); });
  var single = WorkerApp.types.length === 1;
  render(
    '<div class="who">' + WORK_ICON[type] + ' <b>' + esc(type) + '</b></div>' +
    '<button class="btn btn-primary btn-xl" id="new">▶ Start NEW job<br><small>scan the QR at the starting table</small></button>' +
    (running.length ? '<h2>Working now</h2>' : '') +
    running.map(function (s) {
      var iv = runningInterval(s.id), base = sessionTotalMs(s.id) - intervalMs(iv);
      return '<div class="card card-active">' +
        '<div>Started now at <b>' + esc(iv.start_loc_label) + '</b> · ' + fmtTime(iv.start_at) +
        (dateKey(iv.start_at) !== dateKey(Date.now()) ? ' <b>(' + fmtDate(iv.start_at) + ')</b>' : '') + '</div>' +
        '<div class="big-clock" data-live-start="' + ts(iv.start_at) + '">' + fmtDur(intervalMs(iv)) + '</div>' +
        (dateKey(iv.start_at) !== dateKey(Date.now()) ? '<div class="warn">⚠ Started on an earlier day and never stopped. The night is being counted. Scan Stop now and tell Admin.</div>' : '') +
        '<div class="muted">Job started ' + fmtDateTime(s.created_at) + ' at ' + esc(s.start_loc_label) + (base > 0 ? ' · earlier periods ' + fmtDur(base) : '') + '</div>' +
        '<div class="row"><button class="btn btn-stop" data-stop="' + s.id + '">⏸ Stop for today<br><small>job not finished</small></button>' +
        '<button class="btn btn-finish" data-finish="' + s.id + '">✔ Finish job<br><small>job complete</small></button></div></div>';
    }).join('') +
    (paused.length ? '<h2>Unfinished jobs (stopped)</h2>' : '') +
    paused.map(function (s) {
      var ivs = intervalsOf(s.id), last = ivs[ivs.length - 1];
      return '<div class="card">' +
        '<div><b>Started ' + fmtDateTime(s.created_at) + '</b> at ' + esc(s.start_loc_label) + '</div>' +
        (last ? '<div>Last stopped at <b>' + esc(last.end_loc_label) + '</b> · ' + fmtDateTime(last.end_at) + '</div>' : '') +
        '<div class="muted">Job time so far ' + fmtDur(sessionTotalMs(s.id)) + ' · ' + esc(workerNames(sessionWorkerIds(s.id)) || 'no workers yet') + '</div>' +
        '<div class="row"><button class="btn btn-secondary" data-cont="' + s.id + '">↻ Continue this job</button>' +
        '<button class="btn btn-light" data-close="' + s.id + '">✔ Mark finished</button></div></div>';
    }).join('') +
    (open.length ? '' : '<p class="muted">No unfinished ' + esc(type) + ' jobs.</p>') +
    '<div class="row">' + (single ? '' : '<button class="btn btn-light" id="back">← Back</button>') +
    '<button class="btn btn-light" id="hours">📋 My hours</button></div>'
  );
  document.getElementById('new').onclick = function () {
    go(screenScan, {
      title: 'Start ' + type, instruction: 'Scan the QR code at the STARTING table.',
      onLocation: function (loc) { saveStartJob(type, loc); },
      onCancel: function () { go(screenJobs, type); }
    });
  };
  appEl.querySelectorAll('[data-stop],[data-finish]').forEach(function (b) {
    b.onclick = function () {
      var finish = b.hasAttribute('data-finish'), sid = b.getAttribute(finish ? 'data-finish' : 'data-stop');
      go(screenScan, {
        title: finish ? 'Finish job' : 'Stop for today',
        instruction: finish ? 'Scan the QR code at the ENDING table (where the job is complete).' : 'Scan the QR code at the table where you stopped.',
        onLocation: function (loc) { askNamesForStop(type, sid, loc, finish); },
        onCancel: function () { go(screenJobs, type); }
      });
    };
  });
  appEl.querySelectorAll('[data-cont]').forEach(function (b) {
    b.onclick = function () {
      var sid = b.getAttribute('data-cont');
      go(screenScan, {
        title: 'Continue ' + type, instruction: 'Scan the QR code at the table where you start working now.',
        onLocation: function (loc) { saveContinueJob(type, sid, loc); },
        onCancel: function () { go(screenJobs, type); }
      });
    };
  });
  appEl.querySelectorAll('[data-close]').forEach(function (b) {
    b.onclick = function () {
      var sid = b.getAttribute('data-close');
      go(screenScan, {
        title: 'Mark job finished', instruction: 'The job was already completed at the last stop. Scan the ENDING table.',
        onLocation: function (loc) { saveCloseJob(type, sid, loc); },
        onCancel: function () { go(screenJobs, type); }
      });
    };
  });
  var back = document.getElementById('back');
  if (back) back.onclick = function () { go(HOME); };
  document.getElementById('hours').onclick = function () { go(screenHoursPick); };
  if (running.length) startLiveClocks();
}
screenJobs.refreshable = true;

function saveStartJob(type, loc) {
  guard(function () {
    var now = nowIso();
    var s = {
      id: Store.uid(), work_type: type, status: 'open', start_loc_id: loc.id, start_loc_label: loc.label, start_plot_id: loc.plotId,
      end_loc_id: null, end_loc_label: null, created_at: now, finished_at: null, app: WorkerApp.name, device_id: Store.deviceId(), deleted: false
    };
    var iv = newInterval(s, loc, now);
    return Store.save({ work_sessions: [s], work_intervals: [iv] }).then(function () {
      go(screenConfirm, {
        title: 'Job started', icon: WORK_ICON[type], badge: ['work_intervals', iv.id],
        lines: [['Work', type], ['Start table', loc.label], ['Time', fmtDateTime(now)]],
        note: 'Names are chosen when you stop or finish.'
      });
    });
  });
}

function newInterval(s, loc, now) {
  return {
    id: Store.uid(), session_id: s.id, work_type: s.work_type, start_at: now, end_at: null,
    start_loc_id: loc.id, start_loc_label: loc.label, end_loc_id: null, end_loc_label: null,
    end_action: null, worker_ids: [], device_id: Store.deviceId(), deleted: false
  };
}

function saveContinueJob(type, sid, loc) {
  guard(function () {
    var s = byId('work_sessions', sid);
    if (!s || s.status !== 'open') throw new Error('This job is already finished.');
    var run = runningInterval(sid);
    if (run) throw new Error('This job is already running (started ' + fmtTime(run.start_at) + ' at ' + run.start_loc_label + '). Use Stop or Finish instead.');
    var now = nowIso(), iv = newInterval(s, loc, now);
    return Store.save({ work_intervals: [iv] }).then(function () {
      go(screenConfirm, {
        title: 'Job continued', icon: WORK_ICON[type], badge: ['work_intervals', iv.id],
        lines: [['Work', type], ['Job started', fmtDateTime(s.created_at) + ' at ' + s.start_loc_label], ['Now at', loc.label], ['Time', fmtDateTime(now)],
          ['Job time so far', fmtDur(sessionTotalMs(sid))]]
      });
    });
  });
}

function askNamesForStop(type, sid, loc, finish) {
  var iv = runningInterval(sid);
  if (!iv) { toast('This job is not running any more.'); return go(screenJobs, type); }
  var prev = intervalsOf(sid).filter(function (i) { return i.end_at; }).pop();
  var now = Date.now();
  go(screenNames, {
    title: finish ? 'Finish job' : 'Stop for today',
    summary: '<div class="card"><div>' + WORK_ICON[type] + ' <b>' + esc(type) + '</b></div><div>' + esc(iv.start_loc_label) + ' → <b>' + esc(loc.label) + '</b></div>' +
      '<div>This period: ' + fmtTime(iv.start_at) + ' – ' + fmtTime(now) + ' (<b>' + fmtDur(now - ts(iv.start_at)) + '</b>)</div></div>',
    preselect: prev ? prev.worker_ids : [],
    confirmText: finish ? 'Finish job' : 'Stop for today',
    onConfirm: function (ids) { saveStop(type, sid, iv.id, loc, finish, ids); },
    onCancel: function () { go(screenJobs, type); }
  });
}

function saveStop(type, sid, ivId, loc, finish, ids) {
  guard(function () {
    var iv = byId('work_intervals', ivId), s = byId('work_sessions', sid);
    if (!iv || iv.end_at) throw new Error('This work period was already stopped.');
    var now = nowIso();
    var iv2 = Object.assign({}, iv, { end_at: now, end_loc_id: loc.id, end_loc_label: loc.label, end_action: finish ? 'finish' : 'stop', worker_ids: ids });
    var map = { work_intervals: [iv2] };
    if (finish) map.work_sessions = [Object.assign({}, s, { status: 'finished', finished_at: now, end_loc_id: loc.id, end_loc_label: loc.label })];
    return Store.save(map).then(function () {
      var lines = [['Work', type], ['Stopped at', loc.label],
        ['This period', fmtTime(iv.start_at) + ' – ' + fmtTime(now) + ' (' + fmtDur(intervalMs(iv2)) + ')'],
        ['Workers', workerNames(ids)]];
      if (finish) {
        lines.push(['Job', s.start_loc_label + ' → ' + loc.label]);
        lines.push(['Total job time', fmtDur(sessionTotalMs(sid))]);
        lines.push(['Each worker', sessionWorkerIds(sid).map(function (w) { return workerName(w) + ' ' + fmtDur(workerSessionMs(sid, w)); }).join(', ')]);
      }
      go(screenConfirm, {
        title: finish ? 'Job finished' : 'Stopped for today', icon: finish ? '✔' : '⏸', badge: ['work_intervals', iv.id], lines: lines,
        note: finish ? '' : 'The job stays open. Next time choose "' + type + '" and tap "Continue this job".'
      });
    });
  });
}

function saveCloseJob(type, sid, loc) {
  guard(function () {
    var s = byId('work_sessions', sid);
    if (!s || s.status !== 'open') throw new Error('This job is already finished.');
    if (runningInterval(sid)) throw new Error('This job is running. Use Finish job instead.');
    var now = nowIso();
    var s2 = Object.assign({}, s, { status: 'finished', finished_at: now, end_loc_id: loc.id, end_loc_label: loc.label });
    return Store.save({ work_sessions: [s2] }).then(function () {
      go(screenConfirm, {
        title: 'Job finished', icon: '✔', badge: ['work_sessions', sid],
        lines: [['Work', type], ['Job', s.start_loc_label + ' → ' + loc.label], ['Total job time', fmtDur(sessionTotalMs(sid))],
          ['Each worker', sessionWorkerIds(sid).map(function (w) { return workerName(w) + ' ' + fmtDur(workerSessionMs(sid, w)); }).join(', ') || '-']]
      });
    });
  });
}

/* =================== Anak tanam / pokok masuk =================== */
var plantForm = null;

function startPlanting(type) {
  var isAnak = type === WORK.ANAK;
  if (!nurseryPlots().length) { toast('No nursery plot is set up. Ask Admin.'); return; }
  go(screenScan, {
    title: type,
    instruction: isAnak ? 'Scan the QR code at the nursery table top where you plant.' : 'Scan the QR code at the DESTINATION table (where the plants go).',
    plots: isAnak ? nurseryPlots : function () { return activePlots().filter(function (p) { return !p.is_nursery; }); },
    filter: function (loc) {
      var p = loc.plotId && byId('plots', loc.plotId);
      if (!p) return 'This sticker is not known on this phone yet. Connect to internet once to update, or choose from list.';
      if (isAnak && !p.is_nursery) return 'Anak tanam is only in the nursery. This sticker is ' + p.name + '.';
      if (!isAnak && p.is_nursery) return 'Scan the destination plot, not the nursery.';
      return '';
    },
    onLocation: function (loc) {
      var keep = plantForm && plantForm.type === type ? plantForm : null;
      plantForm = {
        type: type, loc: loc, varietyId: keep ? keep.varietyId : null, qty: keep ? keep.qty : '',
        date: dateKey(Date.now()), time: fmtTime(Date.now()), fromPlotId: nurseryPlots()[0].id, warned: false
      };
      go(screenPlantForm);
    },
    onCancel: function () { go(HOME); }
  });
}

function screenPlantForm() {
  var f = plantForm, isMove = f.type === WORK.POKOK;
  var smap = stockMap(), nStock = plotStock(f.fromPlotId, smap);
  var nurseries = nurseryPlots();
  render(
    '<div class="who">' + WORK_ICON[f.type] + ' <b>' + esc(f.type) + '</b></div>' +
    '<div class="loc-box">' + (isMove ? 'Destination: ' : 'Location: ') + '📍 <b>' + esc(f.loc.label) + '</b> <button class="btn btn-light btn-small" id="reloc">Change</button></div>' +
    (isMove && nurseries.length > 1 ? '<h2>From nursery</h2><div class="grid grid-chips">' + nurseries.map(function (p) {
      return '<button class="btn btn-chip' + (p.id === f.fromPlotId ? ' selected' : '') + '" data-from="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('') + '</div>' : (isMove ? '<p class="muted">From: ' + esc(plotName(f.fromPlotId)) + '</p>' : '')) +
    '<h2>1. Variety</h2><div class="grid grid-chips">' + activeVarieties().map(function (v) {
      return '<button class="btn btn-chip' + (f.varietyId === v.id ? ' selected' : '') + '" data-v="' + v.id + '">' + esc(v.name) +
        (isMove ? '<small>' + fmtNum(nStock[v.id] || 0) + ' in nursery</small>' : '') + '</button>';
    }).join('') + '</div>' +
    '<h2>2. Quantity (plants)</h2>' +
    '<div class="qty-row"><button class="btn btn-qty" data-q="-10">−10</button><button class="btn btn-qty" data-q="-1">−1</button>' +
    '<input id="qty" class="qty" type="number" inputmode="numeric" min="1" value="' + esc(f.qty) + '" placeholder="0">' +
    '<button class="btn btn-qty" data-q="1">+1</button><button class="btn btn-qty" data-q="10">+10</button></div>' +
    '<div class="row"><button class="btn btn-qty" data-q="50">+50</button><button class="btn btn-qty" data-q="100">+100</button><button class="btn btn-qty" data-q="500">+500</button><button class="btn btn-qty" data-q="0">Clear</button></div>' +
    '<h2>3. Date & time</h2><div class="row"><input id="date" type="date" value="' + esc(f.date) + '"><input id="time" type="time" value="' + esc(f.time) + '"></div>' +
    '<p id="stockwarn" class="warn" style="display:none"></p>' +
    '<button class="btn btn-primary btn-xl" id="next">Next: choose names →</button>' +
    '<button class="btn btn-light" id="back">✕ Cancel</button>'
  );
  var qty = document.getElementById('qty');
  qty.oninput = function () { f.qty = qty.value; f.warned = false; };
  appEl.querySelectorAll('[data-v]').forEach(function (b) {
    b.onclick = function () {
      f.varietyId = b.getAttribute('data-v'); f.warned = false;
      appEl.querySelectorAll('[data-v]').forEach(function (x) { x.classList.toggle('selected', x === b); });
    };
  });
  appEl.querySelectorAll('[data-from]').forEach(function (b) {
    b.onclick = function () { f.fromPlotId = b.getAttribute('data-from'); f.warned = false; go(screenPlantForm); };
  });
  appEl.querySelectorAll('[data-q]').forEach(function (b) {
    b.onclick = function () {
      var d = Number(b.getAttribute('data-q'));
      var v = d === 0 ? 0 : Math.max(0, (parseInt(qty.value, 10) || 0) + d);
      qty.value = v || ''; f.qty = qty.value; f.warned = false;
    };
  });
  document.getElementById('date').onchange = function (e) { f.date = e.target.value; };
  document.getElementById('time').onchange = function (e) { f.time = e.target.value; };
  document.getElementById('reloc').onclick = function () { startPlanting(f.type); };
  document.getElementById('back').onclick = function () { plantForm = null; go(HOME); };
  document.getElementById('next').onclick = function () {
    var q = parseInt(f.qty, 10);
    if (!f.varietyId) return toast('Choose a variety.');
    if (!q || q < 1) return toast('Enter the quantity.');
    if (!f.date || !f.time) return toast('Enter date and time.');
    if (isMove && !f.warned && q > (nStock[f.varietyId] || 0)) {
      f.warned = true;
      var w = document.getElementById('stockwarn');
      w.style.display = 'block';
      w.textContent = 'The nursery has only ' + fmtNum(nStock[f.varietyId] || 0) + ' ' + varietyName(f.varietyId) + ' on record. Check the quantity. Tap "Next" again to continue anyway.';
      return;
    }
    go(screenNames, {
      title: f.type,
      summary: '<div class="card">' + WORK_ICON[f.type] + ' <b>' + fmtNum(q) + '</b> ' + esc(varietyName(f.varietyId)) + ' → <b>' + esc(f.loc.label) + '</b></div>',
      confirmText: 'Save', preselect: f.lastNames || [],
      onConfirm: function (ids) { savePlanting(ids); },
      onCancel: function () { go(screenPlantForm); }
    });
  };
}

function savePlanting(ids) {
  var f = plantForm;
  guard(function () {
    var p = f.date.split('-'), t = f.time.split(':');
    var at = new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]).toISOString();
    var isMove = f.type === WORK.POKOK;
    var rec = {
      id: Store.uid(), work_type: f.type, variety_id: f.varietyId, variety_name: varietyName(f.varietyId), quantity: parseInt(f.qty, 10),
      at: at, from_plot_id: isMove ? f.fromPlotId : null, to_plot_id: f.loc.plotId, to_loc_id: f.loc.id, to_loc_label: f.loc.label,
      worker_ids: ids, device_id: Store.deviceId(), deleted: false
    };
    return Store.save({ plantings: [rec] }).then(function () {
      var smap = stockMap(), vname = rec.variety_name;
      var lines = [['Work', f.type], ['Variety', vname], ['Quantity', fmtNum(rec.quantity) + ' plants']];
      if (isMove) lines.push(['From', plotName(rec.from_plot_id)]);
      lines.push([isMove ? 'Destination' : 'Location', rec.to_loc_label], ['Workers', workerNames(ids)], ['Date & time', fmtDateTime(at)]);
      var note;
      if (isMove) {
        var day = dateKey(at), out = sumByVariety(plantingsOnDay(WORK.POKOK, day, 'from_plot_id', rec.from_plot_id));
        var outAll = Object.keys(out).reduce(function (s, k) { return s + out[k]; }, 0);
        var dest = byId('plots', rec.to_plot_id);
        note = 'Moved out of nursery on ' + fmtDateKey(day) + ': ' + fmtNum(out[rec.variety_id] || 0) + ' ' + vname + ' (all varieties ' + fmtNum(outAll) + '). ' +
          'Nursery now has ' + fmtNum(plotStock(rec.from_plot_id, smap)[rec.variety_id] || 0) + ' ' + vname + '. ' +
          (dest ? dest.name + ' now has ' + fmtNum(plotTotal(dest.id, smap)) + (dest.capacity ? ' of ' + fmtNum(dest.capacity) : '') + ' plants.' : '');
      } else {
        note = plotName(rec.to_plot_id) + ' now has ' + fmtNum(plotStock(rec.to_plot_id, smap)[rec.variety_id] || 0) + ' ' + vname +
          ' (all varieties ' + fmtNum(plotTotal(rec.to_plot_id, smap)) + ').';
      }
      var type = f.type, keepLoc = f.loc, names = ids;
      plantForm = null;
      go(screenConfirm, {
        title: 'Saved', icon: WORK_ICON[type], badge: ['plantings', rec.id], lines: lines, note: note,
        again: { text: '+ Add another ' + type + ' here', fn: function () {
          plantForm = { type: type, loc: keepLoc, varietyId: null, qty: '', date: dateKey(Date.now()), time: fmtTime(Date.now()),
            fromPlotId: rec.from_plot_id || nurseryPlots()[0].id, warned: false, lastNames: names };
          go(screenPlantForm);
        } }
      });
    });
  });
}
