/* Crop Rotation Crash Test — UI controller */
(function () {
  'use strict';
  var t = I18N.t, M = Model, DB = CropDB;
  var $ = function (id) { return document.getElementById(id); };

  var POWER_PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M', 'GWETROOT'];
  var SCEN = { hist: { dT: 0, pFactor: 1 }, warm: { dT: 1.5, pFactor: 1 }, hot: { dT: 2.5, pFactor: 0.9 } };
  var DEFAULT_SOIL = { clay: 25, sand: 40, socGkg: 20, bd: 1.3 };

  var state = {
    lat: 51.35, lon: 71.0, raw: null, soil: null, soilSrc: '', presetId: null,
    plan: ['fallow', 'wheat', 'wheat', 'barley'],
    cands: ['wheat', 'barley', 'pea', 'chickpea', 'flax', 'rapeseed', 'sunflower', 'fallow'],
    Wcache: {}, last: null, running: false
  };

  /* ---------------------------------------------------------------- i18n */
  function cropName(id) { return DB.BY_ID[id].name[I18N.lang] || DB.BY_ID[id].name.en; }
  function cropLabel(id) { return DB.BY_ID[id].icon + ' ' + cropName(id); }
  function planLabel(plan) { return plan.map(function (id) { return DB.BY_ID[id].icon + ' ' + cropName(id); }).join(' → '); }
  function causeName(c) { var m = t('causes'); return (m && m[c]) || c || t('none'); }

  function applyI18n() {
    document.documentElement.lang = I18N.lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    document.querySelectorAll('.lang button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === I18N.lang); });
    renderPresets(); renderPlan(); renderCands(); renderAssumptions(); showSoil();
    if (state.raw) showDataStatus();
    if (state.last) renderResults(state.last);
  }

  /* ---------------------------------------------------------------- map */
  var map = null, marker = null;
  function initMap() {
    if (typeof L === 'undefined') { $('map').style.display = 'none'; $('map-msg').textContent = t('offlineMap'); return; }
    map = L.map('map', { scrollWheelZoom: false }).setView([state.lat, state.lon], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    marker = L.marker([state.lat, state.lon]).addTo(map);
    map.on('click', function (e) {
      setLocation(e.latlng.lat, e.latlng.lng);
      state.presetId = null; renderPresets();
      loadLive();
    });
  }
  function setLocation(lat, lon, zoom) {
    state.lat = +(+lat).toFixed(3); state.lon = +(+lon).toFixed(3);
    $('lat').value = state.lat; $('lon').value = state.lon;
    if (marker) { marker.setLatLng([state.lat, state.lon]); if (zoom) map.setView([state.lat, state.lon], zoom); }
  }

  /* ---------------------------------------------------------------- data loading */
  function renderPresets() {
    var box = $('presets'); box.innerHTML = '';
    (window.PRESETS || []).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (state.presetId === p.id ? ' on' : '');
      b.textContent = p.name[I18N.lang] || p.name.en;
      b.onclick = function () { loadPreset(p.id); };
      box.appendChild(b);
    });
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); };
      document.body.appendChild(s);
    });
  }

  function loadPreset(id) {
    status(t('loading'), 'busy');
    var go = function () {
      var P = window.PRESET_DATA[id];
      state.presetId = id; renderPresets();
      setLocation(P.lat, P.lon, 6);
      useData(P.weather, P.soil ? P.soil : null, P.soil ? P.soil.src : null);
    };
    if (window.PRESET_DATA && window.PRESET_DATA[id]) return go();
    loadScript('data/presets/' + id + '.js').then(go).catch(function (e) { status(t('loadFail', { err: e.message }), 'err'); });
  }

  function fetchJSON(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 60000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchPower(lat, lon) {
    var url = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=' + POWER_PARAMS.join(',') +
      '&community=AG&longitude=' + lon + '&latitude=' + lat + '&start=19910101&end=20251231&format=JSON';
    return fetchJSON(url, 90000).then(function (d) {
      var p = d.properties.parameter;
      var dates = Object.keys(p.T2M_MAX).sort();
      var raw = { start: dates[0], n: dates.length, elev: d.geometry.coordinates[2] || 0 };
      POWER_PARAMS.forEach(function (k) {
        raw[k] = dates.map(function (dt) { var v = p[k] ? p[k][dt] : null; return v === -999 ? null : v; });
      });
      return raw;
    });
  }

  function fetchSoil(lat, lon) {
    var offs = [[0, 0], [0.03, 0], [0, 0.04]];
    var i = 0;
    function tryNext() {
      if (i >= offs.length) return Promise.resolve(null);
      var la = (lat + offs[i][0]).toFixed(3), lo = (lon + offs[i][1]).toFixed(3); i++;
      var url = 'https://rest.isric.org/soilgrids/v2.0/properties/query?lon=' + lo + '&lat=' + la +
        '&property=soc&property=clay&property=sand&property=bdod&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean';
      return fetchJSON(url, 25000).then(function (d) {
        var res = {}, w = [5, 10, 15], bad = false;
        d.properties.layers.forEach(function (layer) {
          var f = layer.unit_measure.d_factor, s = 0;
          layer.depths.forEach(function (dp, j) { if (dp.values.mean === null) bad = true; s += (dp.values.mean || 0) / f * w[j]; });
          res[layer.name] = s / 30;
        });
        if (bad) return tryNext();
        return { socGkg: +res.soc.toFixed(1), clay: +res.clay.toFixed(1), sand: +res.sand.toFixed(1), bd: +res.bdod.toFixed(2), src: 'ISRIC SoilGrids 2.0 (0–30 cm)' };
      }).catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  function loadLive() {
    var lat = +$('lat').value, lon = +$('lon').value;
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 70 || Math.abs(lon) > 180) return;
    setLocation(lat, lon);
    state.presetId = null; renderPresets();
    status(t('loading'), 'busy');
    var pw = fetchPower(state.lat, state.lon);
    var sg = fetchSoil(state.lat, state.lon);
    pw.then(function (raw) {
      status(t('loadingSoil'), 'busy');
      return sg.then(function (soil) { useData(raw, soil, soil ? soil.src : null); });
    }).catch(function (e) { status(t('loadFail', { err: e.message }), 'err'); });
  }

  function useData(raw, soil, src) {
    state.raw = raw; state.Wcache = {};
    if (soil) { state.soil = { clay: soil.clay, sand: soil.sand, socGkg: soil.socGkg, bd: soil.bd || 1.3 }; state.soilSrc = src; state.soilDefault = false; }
    else { state.soil = Object.assign({}, DEFAULT_SOIL); state.soilSrc = ''; state.soilDefault = true; }
    showSoil(); showDataStatus();
    $('results').hidden = true; state.last = null;
  }

  function showDataStatus() {
    var r = state.raw;
    status(t('loaded', {
      days: r.n.toLocaleString(), y0: r.start.slice(0, 4), y1: (+r.start.slice(0, 4) + Math.round(r.n / 365.25) - 1),
      lat: state.lat.toFixed(2), lon: state.lon.toFixed(2), elev: Math.round(r.elev)
    }), 'ok');
  }

  function status(msg, cls) { var s = $('data-status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }

  function showSoil() {
    if (!state.soil) return;
    $('clay').value = state.soil.clay; $('sand').value = state.soil.sand; $('socg').value = state.soil.socGkg;
    $('soil-src').textContent = state.soilDefault ? t('soilDefault') : t('soilSrc', { src: state.soilSrc });
    var h = M.soilHydraulics(state.soil);
    $('soil-awc').textContent = t('awc', { awc: Math.round(h.awcMm) });
  }
  function readSoil() {
    if (!state.soil) return;
    var c = +$('clay').value, s = +$('sand').value, o = +$('socg').value;
    if (c > 0) state.soil.clay = c; if (s > 0) state.soil.sand = s; if (o > 0) state.soil.socGkg = o;
    if (state.soil.clay + state.soil.sand > 98) state.soil.sand = 98 - state.soil.clay;
    var h = M.soilHydraulics(state.soil);
    $('soil-awc').textContent = t('awc', { awc: Math.round(h.awcMm) });
  }

  /* ---------------------------------------------------------------- plan editor */
  function cropOptions(sel, current) {
    DB.CROPS.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.icon + ' ' + cropName(c.id);
      if (c.id === current) o.selected = true;
      sel.appendChild(o);
    });
  }
  function renderPlan() {
    var box = $('plan'); box.innerHTML = '';
    state.plan.forEach(function (id, i) {
      var slot = document.createElement('div'); slot.className = 'slot';
      slot.style.setProperty('--c', DB.BY_ID[id].color);
      var h = document.createElement('div'); h.className = 'slot-h'; h.textContent = t('year', { n: i + 1 });
      var ic = document.createElement('div'); ic.className = 'slot-icon'; ic.textContent = DB.BY_ID[id].icon;
      var sel = document.createElement('select'); sel.setAttribute('aria-label', t('year', { n: i + 1 }));
      cropOptions(sel, id);
      sel.onchange = function () { state.plan[i] = sel.value; renderPlan(); };
      slot.appendChild(h); slot.appendChild(ic); slot.appendChild(sel);
      if (state.plan.length > 1) {
        var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'link'; rm.textContent = t('remove');
        rm.onclick = function () { state.plan.splice(i, 1); renderPlan(); };
        slot.appendChild(rm);
      }
      box.appendChild(slot);
      var ar = document.createElement('div'); ar.className = 'arrow'; ar.textContent = i === state.plan.length - 1 ? '↺' : '→';
      box.appendChild(ar);
    });
    if (state.plan.length < 4) {
      var add = document.createElement('button'); add.type = 'button'; add.className = 'btn secondary add'; add.textContent = t('addYear');
      add.onclick = function () { state.plan.push('wheat'); renderPlan(); };
      box.appendChild(add);
    }
  }

  function renderCands() {
    var box = $('cands'); box.innerHTML = '';
    DB.CROPS.forEach(function (c) {
      var lab = document.createElement('label'); lab.className = 'chip check' + (state.cands.indexOf(c.id) >= 0 ? ' on' : '');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.cands.indexOf(c.id) >= 0;
      cb.onchange = function () {
        if (cb.checked) { if (state.cands.indexOf(c.id) < 0) state.cands.push(c.id); }
        else state.cands = state.cands.filter(function (x) { return x !== c.id; });
        lab.classList.toggle('on', cb.checked);
      };
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' ' + c.icon + ' ' + cropName(c.id)));
      box.appendChild(lab);
    });
  }

  function renderAssumptions() {
    var tb = $('assump-table'); tb.innerHTML = '';
    var hr = tb.insertRow();
    ['', t('price'), t('cost'), t('ym')].forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    DB.CROPS.forEach(function (c) {
      var r = tb.insertRow();
      r.insertCell().textContent = c.icon + ' ' + cropName(c.id);
      ['price', 'cost', 'Ym'].forEach(function (key) {
        var cell = r.insertCell();
        if ((key === 'price' || key === 'Ym') && !c.harvestable) { cell.textContent = '—'; return; }
        var inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.step = key === 'Ym' ? 0.1 : 5; inp.value = c[key];
        inp.onchange = function () { var v = +inp.value; if (v >= 0) c[key] = v; };
        cell.appendChild(inp);
      });
    });
  }

  /* ---------------------------------------------------------------- running */
  function canon(p) {
    var best = null;
    for (var i = 0; i < p.length; i++) {
      var r = p.slice(i).concat(p.slice(0, i)).join(',');
      if (best === null || r < best) best = r;
    }
    // collapse repeated plans (a,b,a,b -> a,b)
    var parts = best.split(',');
    for (var per = 1; per < parts.length; per++) {
      if (parts.length % per) continue;
      var rep = true;
      for (var j = per; j < parts.length; j++) if (parts[j] !== parts[j - per]) { rep = false; break; }
      if (rep) return canon(parts.slice(0, per));
    }
    return best;
  }

  function getW(sc) {
    if (!state.Wcache[sc]) state.Wcache[sc] = M.prepareWeather(state.raw, state.lat, SCEN[sc]);
    return state.Wcache[sc];
  }

  function weights() {
    return {
      profit: +$('w-profit').value, reliability: +$('w-reliability').value,
      soil: +$('w-soil').value, water: +$('w-water').value
    };
  }

  function simOpts() {
    return { irrigation: $('irr').checked, quota: +$('quota').value || 0, straw: $('straw').checked };
  }

  function sleep0() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function progress(p, msg) {
    var pr = $('progress'); pr.hidden = p === null;
    if (p === null) return;
    pr.firstElementChild.style.width = Math.round(p * 100) + '%';
    pr.lastElementChild.textContent = msg;
  }

  async function run() {
    if (state.running) return;
    if (!state.raw) { status(t('needData'), 'err'); return; }
    readSoil();
    state.running = true; $('btn-run').disabled = true;
    try {
      var sc = document.querySelector('input[name=sc]:checked').value;
      var W = getW(sc);
      var opts = simOpts();
      var soil = state.soil;
      var plan = state.plan.slice();
      var userKey = canon(plan);
      // candidate plans
      var cands = state.cands.slice();
      if (!cands.length) cands = plan.slice();
      var plans = M.enumeratePlans(cands, 4);
      var neigh = M.neighbourPlans(plan, uniq(cands.concat(plan)));
      var map = {};
      plans.forEach(function (p) { map[canon(p)] = { plan: p }; });
      neigh.forEach(function (nb) {
        var k = canon(nb.plan);
        if (!map[k]) map[k] = { plan: nb.plan };
        // keep the farmer's own ordering for one-change suggestions
        if (!map[k].edit) { map[k].edit = nb.edit; map[k].plan = nb.plan; }
      });
      if (!map[userKey]) map[userKey] = { plan: plan };
      map[userKey].user = true; map[userKey].plan = plan;
      var keys = Object.keys(map);
      var nYears = W.lastYear - W.firstYear;
      var screen = keys.length > 1300; // too many: screen with one phase first
      var results = [];
      for (var i = 0; i < keys.length; i++) {
        var e = map[keys[i]];
        var o = Object.assign({}, opts);
        var r;
        if (screen && !e.user && !e.edit) {
          o.phases = [0]; // fast screening: one starting position only
          r = M.crashTest(W, soil, e.plan, o);
        } else {
          r = M.crashTest(W, soil, e.plan, o);
        }
        r.key = keys[i]; r.user = !!e.user; r.edit = e.edit || null; r.screened = screen && !e.user && !e.edit;
        results.push(r);
        if (i % 25 === 0) {
          progress(i / keys.length, t('running', { n: keys.length, y: nYears, p: Math.round(i / keys.length * 100) }));
          await sleep0();
        }
      }
      var w = weights();
      M.scoreAll(results, w, opts.irrigation);
      if (screen) {
        // re-run the best screened plans with the full crash test (all phases)
        results.sort(function (a, b) { return b.score - a.score; });
        for (var j = 0; j < Math.min(80, results.length); j++) {
          if (!results[j].screened) continue;
          var rr = M.crashTest(W, soil, results[j].plan, Object.assign({}, opts));
          rr.key = results[j].key; rr.user = false; rr.edit = results[j].edit;
          results[j] = rr;
        }
        M.scoreAll(results, w, opts.irrigation);
      }
      results.sort(function (a, b) { return b.score - a.score; });
      var user = results.filter(function (r) { return r.user; })[0];
      var rank = results.indexOf(user) + 1;
      var best = results[0] !== user ? results[0] : (results[1] || results[0]);
      var fix = results.filter(function (r) { return r.edit && r.score > user.score + 0.5; })[0] || null;

      progress(0.97, t('running', { n: keys.length, y: nYears, p: 97 }));
      await sleep0();
      // detailed runs for charts (phase 0 + daily wetness) on real weather
      var Wh = getW('hist');
      var userDetail = M.simulate(Wh, soil, plan, Object.assign({ detail: true, phase: 0 }, opts));
      var valid = M.validateWetness(Wh, userDetail.dailyWet);
      var clim = M.climateFingerprint(Wh);
      // climate stress table: user & best plan under the three scenarios
      var scen = ['hist', 'warm', 'hot'].map(function (s) {
        var Ws = getW(s);
        return {
          sc: s,
          user: M.crashTest(Ws, soil, plan, Object.assign({}, opts)),
          best: M.crashTest(Ws, soil, best.plan, Object.assign({}, opts))
        };
      });
      state.last = {
        W: W, sc: sc, plan: plan, user: user, best: best, rank: rank, total: results.length, fix: fix,
        top: results.slice(0, 8), all: results, valid: valid, clim: clim, scen: scen, opts: opts, Wh: Wh
      };
      renderResults(state.last);
      $('results').hidden = false;
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      status('Error: ' + err.message, 'err');
    } finally {
      progress(null); state.running = false; $('btn-run').disabled = false;
    }
  }

  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }

  /* ---------------------------------------------------------------- rendering */
  function pct(x) { return Math.round(x * 100); }
  function money(x) { return Math.round(x).toLocaleString(); }
  function signed(x, d) { var v = (+x).toFixed(d === undefined ? 1 : d); return (x > 0 ? '+' : '') + v; }
  function starsFor(score) { return Math.max(1, Math.min(5, Math.round(1 + score / 25))); }
  function starStr(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  function renderResults(R) {
    renderVerdict(R); renderFindings(R); renderCrashMap(R); renderFix(R); renderPerCrop(R);
    renderAlts(R); renderScenario(R); renderCharts(R);
  }

  function renderVerdict(R) {
    var u = R.user;
    var v = u.crashRate <= 0.10 ? 'PASS' : (u.crashRate <= 0.25 ? 'DAMAGE' : 'CRASH');
    var box = $('verdict'); box.className = 'card verdict v-' + v.toLowerCase();
    var overall = starsFor(u.score);
    var html = '<div class="v-left"><div class="v-label">' + t('resTitle') + '</div>' +
      '<div class="v-plan">' + esc(planLabel(R.plan)) + '</div>' +
      '<div class="v-word">' + t('verdict' + v) + '</div>' +
      '<div class="v-line">' + t('verdictLine', { crash: pct(u.crashRate), dent: pct(u.dentRate), rank: R.rank, total: R.total }) + '</div>' +
      (R.rank > 1 ? '<div class="v-line">' + t('betterN', { n: R.rank - 1 }) + '</div>' : '<div class="v-line">' + t('bestOfAll') + '</div>') + '</div>' +
      '<div class="v-right"><div class="v-stars" title="' + Math.round(u.score) + '/100">' + starStr(overall) + '</div><div class="pillars">';
    [['profit', 'pillarProfit'], ['reliability', 'pillarReliability'], ['soil', 'pillarSoil'], ['water', 'pillarWater']].forEach(function (p) {
      var s = starsFor(u.pillar[p[0]]);
      html += '<div class="pillar"><span>' + t(p[1]) + '</span><b>' + starStr(s) + '</b></div>';
    });
    html += '</div></div>';
    box.innerHTML = html;
  }

  function renderFindings(R) {
    var u = R.user, ul = $('findings'); ul.innerHTML = '';
    var add = function (s, cls) { var li = document.createElement('li'); li.textContent = s; if (cls) li.className = cls; ul.appendChild(li); };
    var crop = [];
    u.byPos.forEach(function (b) { crop = crop.concat(b.seasons.filter(function (s) { return DB.BY_ID[s.crop].harvestable; })); });
    var crashes = crop.filter(function (s) { return s.outcome === 'crash'; });
    // worst calendar years by number of crashed crops
    var byYear = {};
    crashes.forEach(function (s) { byYear[s.year] = (byYear[s.year] || 0) + 1; });
    var worst = Object.keys(byYear).sort(function (a, b) { return byYear[b] - byYear[a] || a - b; }).slice(0, 4).sort();
    if (crashes.length) add(t('f1', { n: crop.length, y0: u.Y0, y1: u.Y1, crash: crashes.length, pct: pct(u.crashRate), worst: worst.join(', ') }), 'bad');
    else add(t('f1none', { n: crop.length, y0: u.Y0, y1: u.Y1, dent: pct(u.dentRate) }), 'good');
    var weak = u.byPos.slice().sort(function (a, b) { return b.crashRate - a.crashRate; })[0];
    if (weak && weak.crashRate >= 0.1) add(t('f2', { crop: cropName(weak.crop), pos: weak.pos + 1, rate: pct(weak.crashRate), cause: causeName(weak.mainCause) }), 'bad');
    else add(t('f2none'), 'good');
    add(t('f3', { chg: signed(u.socChangePct) + '%', n: u.nYears, rate: signed(u.socRate, 2), eros: u.erosionDays.toFixed(1), live: Math.round(u.liveRootDays) }), u.socChangePct < -5 ? 'bad' : '');
    if (R.opts.irrigation) add(t('f4irr', { irr: Math.round(u.irrigation) }));
    else add(t('f4rain', { def: Math.round(u.deficit) }));
    add(t('f5', { late: pct(u.late.crashRate), lp: u.late.from + '–' + u.late.to, early: pct(u.early.crashRate), ep: u.early.from + '–' + u.early.to }));
    var hot = R.scen.filter(function (s) { return s.sc === 'hot'; })[0], hist = R.scen[0];
    if (hot) add(t('f6', { hot: pct(hot.user.crashRate), now: pct(hist.user.crashRate) }), hot.user.crashRate > hist.user.crashRate + 0.05 ? 'bad' : '');
  }

  var OUT_COL = { ok: 'var(--ok)', dent: 'var(--dent)', crash: 'var(--crash)', rest: 'var(--rest)' };

  function renderCrashMap(R) {
    var u = R.user, W = R.W, box = $('crashmap'); box.innerHTML = '';
    var years = []; for (var y = u.Y0; y <= u.Y1; y++) years.push(y);
    var grid = document.createElement('div'); grid.className = 'cm-grid';
    grid.style.gridTemplateColumns = 'minmax(110px, 160px) repeat(' + years.length + ', minmax(14px, 1fr))';
    grid.appendChild(cell('', 'cm-corner'));
    years.forEach(function (y, i) { grid.appendChild(cell(i % 5 === 0 || i === years.length - 1 ? String(y).slice(2) : '', 'cm-year')); });
    u.byPos.forEach(function (b) {
      var c = DB.BY_ID[b.crop];
      grid.appendChild(cell((b.pos + 1) + '. ' + c.icon + ' ' + cropName(b.crop), 'cm-crop'));
      var bySeason = {};
      b.seasons.forEach(function (s) { bySeason[s.year] = s; });
      years.forEach(function (y) {
        var s = bySeason[y];
        var d = cell(s && s.outcome === 'crash' ? '✕' : '', 'cm-cell');
        if (s) {
          d.style.background = OUT_COL[s.outcome];
          d.tabIndex = 0;
          var info = seasonInfo(s, W);
          d.title = info;
          d.onmouseenter = d.onfocus = d.onclick = function () { $('cell-info').textContent = info; };
        }
        grid.appendChild(d);
      });
    });
    box.appendChild(grid);
    var lg = $('crashmap-legend'); lg.innerHTML = '';
    ['ok', 'dent', 'crash', 'rest'].forEach(function (k) {
      var it = document.createElement('span'); var sw = document.createElement('i'); sw.style.background = OUT_COL[k];
      it.appendChild(sw); it.appendChild(document.createTextNode(t(k))); lg.appendChild(it);
    });
    $('cell-info').textContent = '';
  }
  function cell(txt, cls) { var d = document.createElement('div'); d.className = cls; d.textContent = txt; return d; }
  function dateStr(W, k) {
    if (k < 0 || k >= W.n) return '?';
    var y = W.year[k], doy = W.doy[k];
    var dt = new Date(Date.UTC(y, 0, doy));
    return dt.toISOString().slice(0, 10);
  }
  function seasonInfo(s, W) {
    var c = DB.BY_ID[s.crop];
    var parts = [s.year + ' · ' + c.icon + ' ' + cropName(s.crop)];
    if (!c.fallow && s.sowDay >= 0) parts.push(t('sow') + ' ' + dateStr(W, s.sowDay) + ', ' + t('harvest') + ' ' + dateStr(W, s.harvestDay));
    if (c.harvestable) parts.push(t('yield') + ' ' + s.yield.toFixed(2) + ' t/ha');
    parts.push(t('income') + ' ' + money(s.margin) + ' $/ha');
    if (s.outcome === 'crash' || s.outcome === 'dent') parts.push(t('cause') + ': ' + causeName(s.cause));
    return parts.join(' · ');
  }

  function renderFix(R) {
    var box = $('fix'), f = R.fix, u = R.user;
    var html = '<h3>' + t('fixTitle') + '</h3>';
    if (!f) { html += '<p>' + t('fixNone') + '</p>'; box.innerHTML = html; return; }
    var e = f.edit, txt;
    if (e.type === 'replace') txt = t('fixReplace', { pos: e.pos + 1, to: cropLabel(e.to), from: cropLabel(e.from) });
    else if (e.type === 'insert') txt = t('fixInsert', { pos: e.pos + 1, to: cropLabel(e.to), len: f.plan.length });
    else txt = t('fixDelete', { pos: e.pos + 1, from: cropLabel(e.from) });
    html += '<p class="fix-main">' + esc(txt) + '</p>';
    html += '<p class="fix-plan">' + esc(planLabel(f.plan)) + '</p>';
    html += '<p class="small">' + esc(t('fixGain', {
      c1: pct(u.crashRate), c2: pct(f.crashRate), m1: money(u.meanMargin), m2: money(f.meanMargin),
      s1: signed(u.socChangePct) + '%', s2: signed(f.socChangePct) + '%'
    })) + '</p>';
    html += '<button type="button" class="btn secondary" id="fix-test">' + t('test') + '</button>';
    box.innerHTML = html;
    $('fix-test').onclick = function () { testPlan(f.plan); };
  }

  function renderPerCrop(R) {
    var tb = $('percrop'); tb.innerHTML = '';
    head(tb, t('perCropCols'));
    R.user.byPos.forEach(function (b) {
      var c = DB.BY_ID[b.crop];
      var r = tb.insertRow();
      r.insertCell().textContent = (b.pos + 1) + '. ' + c.icon + ' ' + cropName(b.crop);
      r.insertCell().textContent = c.harvestable ? b.meanYield.toFixed(2) : '—';
      r.insertCell().textContent = money(b.meanMargin);
      var cr = r.insertCell(); cr.textContent = c.harvestable ? pct(b.crashRate) + '%' : '—';
      if (b.crashRate > 0.2) cr.className = 'neg';
      r.insertCell().textContent = c.harvestable && b.mainCause ? causeName(b.mainCause) : '—';
    });
  }

  function renderAlts(R) {
    var tb = $('alts'); tb.innerHTML = '';
    head(tb, t('altCols'));
    var rows = R.top.slice();
    if (rows.indexOf(R.user) < 0) rows.push(R.user);
    rows.forEach(function (r) {
      var tr = tb.insertRow(); if (r.user) tr.className = 'me';
      tr.insertCell().textContent = R.all.indexOf(r) + 1;
      var pc = tr.insertCell(); pc.className = 'plan-cell';
      pc.textContent = planLabel(r.plan) + (r.user ? '  (' + t('yours') + ')' : '');
      tr.insertCell().textContent = Math.round(r.score);
      tr.insertCell().textContent = money(r.meanMargin);
      tr.insertCell().textContent = pct(r.crashRate) + '%';
      tr.insertCell().textContent = money(r.p10Margin);
      tr.insertCell().textContent = signed(r.socChangePct) + '%';
      tr.insertCell().textContent = Math.round(r.deficit);
      tr.insertCell().textContent = Math.round(r.irrigation);
      var bc = tr.insertCell();
      if (!r.user) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = t('test');
        b.onclick = function () { testPlan(r.plan); };
        bc.appendChild(b);
      }
    });
  }

  function renderScenario(R) {
    var tb = $('sctable'); tb.innerHTML = '';
    head(tb, t('scCols'));
    var names = { hist: t('scHist'), warm: t('scWarm'), hot: t('scHot') };
    R.scen.forEach(function (s) {
      var tr = tb.insertRow();
      tr.insertCell().textContent = names[s.sc];
      tr.insertCell().textContent = pct(s.user.crashRate) + '%';
      tr.insertCell().textContent = money(s.user.meanMargin) + ' $/ha';
      tr.insertCell().textContent = pct(s.best.crashRate) + '%';
      tr.insertCell().textContent = money(s.best.meanMargin) + ' $/ha';
    });
    var cap = tb.createCaption(); cap.textContent = t('bestPlan') + ': ' + planLabel(R.best.plan);
  }

  function renderCharts(R) {
    var u = R.user, best = R.best;
    // income per year: average over all phases (= expected income of the whole farm if fields are staggered)
    function perYear(res) {
      var m = {};
      res.runs.forEach(function (run) { run.seasons.forEach(function (s) { (m[s.year] = m[s.year] || []).push(s.margin); }); });
      return m;
    }
    var pu = perYear(u), pb = perYear(best);
    var years = Object.keys(pu).sort();
    var avg = function (a) { return a ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    Charts.chart($('ch-income'), {
      x: years,
      series: [
        { type: 'bar', name: t('yourPlan'), values: years.map(function (y) { return avg(pu[y]); }), color: function (v) { return v < 0 ? '#d64545' : '#3c9d5d'; }, legendColor: '#3c9d5d' },
        { type: 'line', name: t('bestPlan'), values: years.map(function (y) { return avg(pb[y]); }), color: '#1f2a44', dash: '5 4' }
      ]
    });
    // soil carbon (phase-averaged)
    function socSeries(res) {
      var n = res.runs[0].soc.length, out = [];
      for (var i = 0; i < n; i++) out.push(avg(res.runs.map(function (r) { return r.soc[i] ? r.soc[i].soc : null; })));
      return out;
    }
    var sy = u.runs[0].soc.map(function (s) { return s.year; });
    Charts.chart($('ch-soil'), {
      x: sy, zero: false,
      series: [
        { type: 'line', name: t('yourPlan'), values: socSeries(u), color: '#8a5a2b', dots: false },
        { type: 'line', name: t('bestPlan'), values: socSeries(best), color: '#1f2a44', dash: '5 4', dots: false }
      ]
    });
    // climate fingerprint
    var cy = R.clim.years;
    Charts.chart($('ch-climate'), {
      x: cy.map(function (r) { return r.year; }), unitRight: I18N.lang === 'ru' ? 'дни' : 'days',
      series: [
        { type: 'bar', name: (I18N.lang === 'ru' ? 'осадки, мм' : 'rain, mm'), values: cy.map(function (r) { return r.prec; }), color: '#4a90c2' },
        { type: 'line', name: (I18N.lang === 'ru' ? 'дни ≥ 30 °C' : 'days ≥ 30 °C'), values: cy.map(function (r) { return r.hot; }), color: '#e05a2b', axis: 'right' }
      ]
    });
    var tr = R.clim.trend;
    $('ch-climate-hint').textContent = t('chClimateHint', {
      season: R.W.lat < 0 ? t('seasonSouth') : t('seasonNorth'),
      p: signed(tr.prec, 0), h: signed(tr.hot, 1), e: signed(tr.et0, 0)
    });
    // validation
    var v = R.valid;
    if (v && v.rows.length) {
      var rows = v.rows.slice(-60);
      var sd = function (a) { var m = avg(a); return Math.sqrt(avg(a.map(function (x) { return (x - m) * (x - m); }))) || 1; };
      var sm = sd(v.rows.map(function (r) { return r.am; })), sg = sd(v.rows.map(function (r) { return r.ag; }));
      Charts.chart($('ch-valid'), {
        x: rows.map(function (r) { return r.y + '-' + String(r.mo + 1).padStart(2, '0'); }),
        series: [
          { type: 'line', name: 'NASA MERRA-2 GWETROOT', values: rows.map(function (r) { return r.ag / sg; }), color: '#0b3d91' },
          { type: 'line', name: I18N.lang === 'ru' ? 'Наша модель' : 'Our model', values: rows.map(function (r) { return r.am / sm; }), color: '#e0a100', dash: '4 3' }
        ]
      });
      $('ch-valid-hint').textContent = t('chValidHint', { r: v.rAnom.toFixed(2), n: v.n });
    }
  }

  function head(tb, cols) {
    var hr = tb.insertRow();
    cols.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function testPlan(plan) {
    state.plan = plan.slice();
    renderPlan();
    $('step-plan').scrollIntoView({ behavior: 'smooth' });
    run();
  }

  /* ---------------------------------------------------------------- CSV */
  function downloadCSV() {
    var R = state.last; if (!R) return;
    var W = R.W;
    var lines = [['phase', 'year', 'plan_position', 'crop', 'sowing_date', 'harvest_date', 'yield_t_ha', 'relative_yield', 'revenue_usd_ha', 'cost_usd_ha', 'margin_usd_ha', 'outcome', 'main_cause', 'ETa_mm', 'ETc_mm', 'irrigation_gross_mm', 'heat_days'].join(',')];
    R.user.runs.forEach(function (run) {
      run.seasons.forEach(function (s) {
        lines.push([run.phase, s.year, s.pos + 1, s.crop, s.sowDay >= 0 ? dateStr(W, s.sowDay) : '', dateStr(W, s.harvestDay),
          s.yield.toFixed(2), s.rel.toFixed(2), s.revenue.toFixed(0), s.cost.toFixed(0), s.margin.toFixed(0),
          s.outcome, s.outcome === 'crash' || s.outcome === 'dent' ? s.cause : '', s.eta.toFixed(0), s.etc.toFixed(0), (s.irrGross || 0).toFixed(0), s.heatDays].join(','));
      });
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crash-test-' + R.plan.join('-') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------------------------------------------------------- wiring */
  function init() {
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.onclick = function () { I18N.set(b.getAttribute('data-lang')); applyI18n(); };
    });
    document.querySelectorAll('.sliders input').forEach(function (inp) {
      var out = inp.nextElementSibling;
      var upd = function () { out.textContent = inp.value; };
      inp.oninput = upd; upd();
    });
    $('irr').onchange = function () { $('quota-wrap').hidden = !$('irr').checked; };
    ['clay', 'sand', 'socg'].forEach(function (id) { $(id).onchange = readSoil; });
    $('btn-load').onclick = loadLive;
    $('btn-run').onclick = run;
    $('btn-print').onclick = function () { window.print(); };
    $('btn-csv').onclick = downloadCSV;
    initMap();
    applyI18n();
    loadPreset('akmola');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
