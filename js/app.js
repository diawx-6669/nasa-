/* Crop Rotation Crash Test — UI controller */
(function () {
  'use strict';
  var t = I18N.t, M = Model, DB = CropDB;
  var $ = function (id) { return document.getElementById(id); };

  var POWER_PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M', 'GWETROOT'];
  var SCEN = { hist: { dT: 0, pFactor: 1 }, warm: { dT: 1.5, pFactor: 1 }, hot: { dT: 2.5, pFactor: 0.9 }, y2050: { dT: 2, pFactor: 0.9 } };
  var DEFAULT_SOIL = { clay: 25, sand: 40, socGkg: 20, bd: 1.3 };
  var DEFAULT_PLAN = ['fallow', 'wheat', 'wheat', 'barley'];
  var PRICE_LEVELS = [-20, -15, -10, -5, 0, 5, 10, 15, 20];
  // Aral Sea open-water estimate from the two MODIS images (pixel classification, see README)
  var ARAL = { a2000: 21200, a2014: 6300 };

  var state = {
    lat: 51.35, lon: 71.0, raw: null, soil: null, soilSrc: '', presetId: null,
    plan: DEFAULT_PLAN.slice(),
    cands: ['wheat', 'barley', 'pea', 'chickpea', 'flax', 'rapeseed', 'sunflower', 'fallow'],
    Wcache: {}, last: null, running: false, why: null, priceLevel: 0
  };

  /* ---------------------------------------------------------------- helpers */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cropName(id) { return DB.BY_ID[id].name[I18N.lang] || DB.BY_ID[id].name.en; }
  function sw(id) { return '<i class="sw" style="--c:' + DB.BY_ID[id].color + '"></i>'; }
  function cropHTML(id) { return '<span>' + sw(id) + esc(cropName(id)) + '</span>'; }
  function rotHTML(plan) { return plan.map(cropHTML).join(''); }
  function planText(plan) { return plan.map(cropName).join(', '); }
  function causeName(c) { var m = t('causes'); return (m && m[c]) || c || t('none'); }
  function pct(x) { return Math.round(x * 100); }
  /** Pick a string by interface language: Lx(en, ru, kk). (Not 'L': that is Leaflet.) */
  function Lx(en, ru, kk) { return I18N.lang === 'ru' ? ru : (I18N.lang === 'kk' ? (kk || ru) : en); }
  function money(x) { return Math.round(x).toLocaleString(I18N.lang === 'en' ? 'en-US' : 'ru-RU'); }
  function signed(x, d) { var v = (+x).toFixed(d === undefined ? 1 : d); return (x > 0 ? '+' : '') + v; }
  function mean(a) { return a && a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }
  function sleep0() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function dateOf(W, k) {
    if (k < 0 || k >= W.n) return null;
    return new Date(Date.UTC(W.year[k], 0, W.doy[k]));
  }
  function dateStr(W, k) { var d = dateOf(W, k); return d ? d.toISOString().slice(0, 10) : ''; }
  function shortDate(W, k) {
    var d = dateOf(W, k); if (!d) return '';
    return d.toLocaleDateString(I18N.lang === 'ru' ? 'ru-RU' : (I18N.lang === 'kk' ? 'kk-KZ' : 'en-GB'), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /* ---------------------------------------------------------------- i18n */
  function applyI18n() {
    document.documentElement.lang = I18N.lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    document.querySelectorAll('.lang button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === I18N.lang); });
    renderPresets(); renderTemplates(); renderPlan(); renderCands(); renderAssumptions(); showSoil();
    if (window.FX) FX.splitWords(document.querySelector('.hero h1'));
    $('sat-area').textContent = t('satArea', { a: money(ARAL.a2000), b: money(ARAL.a2014), p: Math.round((1 - ARAL.a2014 / ARAL.a2000) * 100) });
    if (state.raw) showDataStatus();
    if (state.last) renderResults(state.last);
  }

  /* ---------------------------------------------------------------- map + NASA GIBS NDVI */
  var map = null, marker = null, ndvi = null;
  function ndviDate(year) {
    // MODIS 16-day composites start on day 1, 17, 33…; day 193 = mid-July (north), day 17 = mid-January (south)
    var doy = state.lat < 0 ? 17 : 193;
    return new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
  }
  function initMap() {
    var sel = $('ndvi-year');
    for (var y = 2025; y >= 2000; y--) { var o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); }
    sel.value = 2023;
    if (typeof L === 'undefined') { $('map').style.display = 'none'; $('ndvi-ctl').style.display = 'none'; $('map-msg').textContent = t('offlineMap'); return; }
    map = L.map('map', { scrollWheelZoom: false, worldCopyJump: true }).setView([state.lat, state.lon], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    marker = L.circleMarker([state.lat, state.lon], { radius: 9, color: '#13283b', weight: 3, fillColor: '#c9922e', fillOpacity: 1 }).addTo(map);
    map.on('click', function (e) { setLocation(e.latlng.lat, e.latlng.lng); loadLive(); });
    $('ndvi-on').onchange = updateNdvi;
    sel.onchange = updateNdvi;
  }
  function updateNdvi() {
    if (!map) return;
    if (ndvi) { map.removeLayer(ndvi); ndvi = null; }
    if (!$('ndvi-on').checked) return;
    var date = ndviDate(+$('ndvi-year').value);
    ndvi = L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_NDVI_16Day/default/' + date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png', {
      maxNativeZoom: 9, maxZoom: 18, opacity: 0.75, attribution: 'NASA GIBS, MODIS Terra NDVI ' + date
    }).addTo(map);
  }
  function showNdviYear(year) {
    $('ndvi-on').checked = true; $('ndvi-year').value = year;
    updateNdvi();
    if (map) map.setView([state.lat, state.lon], 8);
    $('step-farm').scrollIntoView({ behavior: 'smooth' });
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
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('cannot load ' + src)); };
      document.body.appendChild(s);
    });
  }
  function getPreset(id) {
    if (window.PRESET_DATA && window.PRESET_DATA[id]) return Promise.resolve(window.PRESET_DATA[id]);
    return loadScript('data/presets/' + id + '.js').then(function () { return window.PRESET_DATA[id]; });
  }
  function loadPreset(id) {
    status(t('loading'), 'busy');
    return getPreset(id).then(function (P) {
      state.presetId = id; renderPresets();
      setLocation(P.lat, P.lon, 6);
      useData(P.weather, P.soil || null, P.soil ? P.soil.src : null);
      return P;
    }).catch(function (e) { status(t('loadFail', { err: e.message }), 'err'); });
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
      '&community=AG&longitude=' + lon + '&latitude=' + lat + '&start=19810101&end=20251231&format=JSON';
    return fetchJSON(url, 120000).then(function (d) {
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
    var offs = [[0, 0], [0.03, 0], [0, 0.04]], i = 0;
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
        return { socGkg: +res.soc.toFixed(1), clay: +res.clay.toFixed(1), sand: +res.sand.toFixed(1), bd: +res.bdod.toFixed(2), src: 'ISRIC SoilGrids 2.0, 0–30 cm' };
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
    var pw = fetchPower(state.lat, state.lon), sg = fetchSoil(state.lat, state.lon);
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
    if (window.FX && state.booted) FX.toast(t('toastData', { days: money(raw.n) }), 'ok');
    state.booted = true;
    $('results').hidden = true; $('nav-report').hidden = true; state.last = null;
    if (ndvi) updateNdvi();
  }
  function showDataStatus() {
    var r = state.raw, y0 = +r.start.slice(0, 4);
    status(t('loaded', { days: money(r.n), y0: y0, y1: y0 + Math.round(r.n / 365.25) - 1, lat: state.lat.toFixed(2), lon: state.lon.toFixed(2), elev: Math.round(r.elev) }), 'ok');
  }
  function status(msg, cls) { var s = $('data-status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }
  function showSoil() {
    if (!state.soil) return;
    $('clay').value = state.soil.clay; $('sand').value = state.soil.sand; $('socg').value = state.soil.socGkg;
    $('soil-src').textContent = state.soilDefault ? t('soilDefault') : t('soilSrc', { src: state.soilSrc });
    $('soil-awc').textContent = t('awc', { awc: Math.round(M.soilHydraulics(state.soil).awcMm) });
  }
  function readSoil() {
    if (!state.soil) return;
    var c = +$('clay').value, s = +$('sand').value, o = +$('socg').value;
    if (c > 0) state.soil.clay = c; if (s > 0) state.soil.sand = s; if (o > 0) state.soil.socGkg = o;
    if (state.soil.clay + state.soil.sand > 98) state.soil.sand = 98 - state.soil.clay;
    $('soil-awc').textContent = t('awc', { awc: Math.round(M.soilHydraulics(state.soil).awcMm) });
  }

  /* ---------------------------------------------------------------- hero strip */
  function renderHeroStrip() {
    getPreset('akmola').then(function (P) {
      var W = M.prepareWeather(P.weather, P.lat);
      var r = M.crashTest(W, P.soil, DEFAULT_PLAN, {});
      var per = {};
      r.runs.forEach(function (run) { run.seasons.forEach(function (s) { (per[s.year] = per[s.year] || []).push(s); }); });
      var years = Object.keys(per).sort();
      var vals = years.map(function (y) {
        var ss = per[y], m = mean(ss.map(function (s) { return s.margin; })), rev = mean(ss.map(function (s) { return s.revenue; })), cost = mean(ss.map(function (s) { return s.cost; }));
        return { y: y, m: m, cls: rev < 0.5 * cost ? 'crash' : (m < 0 ? 'dent' : 'ok') };
      });
      var mx = Math.max.apply(null, vals.map(function (v) { return Math.abs(v.m); })) || 1;
      var box = $('hero-strip'); box.innerHTML = '';
      vals.forEach(function (v, i) {
        var b = document.createElement('span');
        b.className = v.cls;
        b.style.height = Math.max(8, Math.abs(v.m) / mx * 100) + '%';
        b.style.animationDelay = (i * 18) + 'ms';
        FX.tip(b, v.y + ': ' + money(v.m) + ' $/ha');
        box.appendChild(b);
      });
      $('hero-axis').innerHTML = '<span>' + years[0] + '</span><span>' + years[Math.floor(years.length / 2)] + '</span><span>' + years[years.length - 1] + '</span>';
      // living field: every real year plays across the hero
      var bars = box.children, info = vals.map(function (v) {
        var y = +v.y, s0 = M.dayIndex(W, y, W.lat >= 0 ? 121 : 305), rain = 0, wind = 0, n = 0;
        for (var k = s0; k < s0 + 123 && k < W.n; k++) { rain += W.prec[k]; wind += W.ws[k]; n++; }
        return { year: y, cls: v.cls, rain: rain, wind: n ? wind / n : 0, m: v.m };
      });
      var mw = mean(info.map(function (x) { return x.wind; })) || 1;
      var rs = info.map(function (x) { return x.rain; }).sort(function (a, b) { return a - b; }), wet = rs[Math.floor(rs.length * 0.7)];
      info.forEach(function (x) { x.wind = x.wind / mw; x.rainy = x.rain >= wet; });
      HeroField.start($('field'), info, function (Y, i) {
        for (var b = 0; b < bars.length; b++) bars[b].classList.toggle('cur', b === i);
        var lab = Y.cls === 'crash' ? t('crashShort') : t(Y.cls);
        $('hero-year').innerHTML = '<b>' + Y.year + '</b><span class="hy-' + Y.cls + '">' + esc(lab) + '</span><em>' + Math.round(Y.rain) + ' mm · ' + money(Y.m) + ' $/ha</em>';
      });
    }).catch(function () { /* hero strip is decorative */ });
  }

  /* ---------------------------------------------------------------- plan editor */
  var TEMPLATES = {
    classic: ['fallow', 'wheat', 'wheat', 'barley'], mono: ['wheat'], pulses: ['pea', 'wheat', 'chickpea', 'barley'],
    oil: ['wheat', 'sunflower', 'barley', 'rapeseed'], soil: ['greenmanure', 'wheat', 'lentil', 'barley'], south: ['wwheat', 'maize']
  };
  function renderTemplates() {
    var box = $('tpls'); if (!box) return; box.innerHTML = '';
    var names = t('tpl');
    Object.keys(TEMPLATES).forEach(function (k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = names[k] || k;
      b.onclick = function () { state.plan = TEMPLATES[k].slice(); state.flashAll = true; renderPlan(); };
      FX.tip(b, function () { return planText(TEMPLATES[k]); });
      box.appendChild(b);
    });
  }
  function renderPlan() {
    var box = $('plan'); box.innerHTML = '';
    if ($('rb-plan')) $('rb-plan').innerHTML = rotHTML(state.plan);
    state.plan.forEach(function (id, i) {
      var li = document.createElement('li'); li.className = 'slot';
      li.style.setProperty('--c', DB.BY_ID[id].color);
      var h = document.createElement('div'); h.className = 'slot-h';
      h.innerHTML = '<span>' + esc(t('year', { n: i + 1 })) + '</span>';
      if (state.plan.length > 1) {
        var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'link'; rm.textContent = t('remove');
        rm.onclick = function () { state.plan.splice(i, 1); renderPlan(); };
        h.appendChild(rm);
      }
      var sel = document.createElement('select'); sel.setAttribute('aria-label', t('year', { n: i + 1 }));
      DB.CROPS.forEach(function (c) {
        var o = document.createElement('option'); o.value = c.id; o.textContent = cropName(c.id);
        if (c.id === id) o.selected = true; sel.appendChild(o);
      });
      sel.onchange = function () { state.plan[i] = sel.value; state.flashIdx = i; renderPlan(); };
      if (state.flashAll || state.flashIdx === i) li.classList.add('flash');
      li.appendChild(h); li.appendChild(sel);
      box.appendChild(li);
    });
    state.flashAll = false; state.flashIdx = -1;
    if (state.plan.length < 4) {
      var add = document.createElement('li');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'add-slot'; b.textContent = '+ ' + t('addYear');
      b.style.width = '100%';
      b.onclick = function () { state.plan.push('wheat'); renderPlan(); };
      add.appendChild(b); box.appendChild(add);
    }
  }
  function renderCands() {
    var box = $('cands'); box.innerHTML = '';
    DB.CROPS.forEach(function (c) {
      var on = state.cands.indexOf(c.id) >= 0;
      var lab = document.createElement('label'); lab.className = 'chip' + (on ? ' sel' : '');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
      cb.onchange = function () {
        if (cb.checked) { if (state.cands.indexOf(c.id) < 0) state.cands.push(c.id); }
        else state.cands = state.cands.filter(function (x) { return x !== c.id; });
        lab.classList.toggle('sel', cb.checked);
      };
      lab.appendChild(cb);
      lab.insertAdjacentHTML('beforeend', sw(c.id) + esc(cropName(c.id)));
      box.appendChild(lab);
    });
  }
  function renderAssumptions() {
    var tb = $('assump-table'); tb.innerHTML = '';
    head(tb, ['', t('price'), t('cost'), t('ym')]);
    DB.CROPS.forEach(function (c) {
      var r = tb.insertRow();
      r.insertCell().innerHTML = '<span class="rot">' + cropHTML(c.id) + '</span>';
      ['price', 'cost', 'Ym'].forEach(function (key) {
        var cell = r.insertCell();
        if ((key === 'price' || key === 'Ym') && !c.harvestable) { cell.textContent = t('none'); return; }
        var inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.step = key === 'Ym' ? 0.1 : 5; inp.value = c[key];
        inp.setAttribute('aria-label', cropName(c.id) + ' ' + key);
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
    return { profit: +$('w-profit').value, reliability: +$('w-reliability').value, soil: +$('w-soil').value, water: +$('w-water').value };
  }
  function simOpts() { return { irrigation: $('irr').checked, quota: +$('quota').value || 0, straw: $('straw').checked }; }
  function progress(p, msg) {
    var pr = $('progress'); pr.hidden = p === null;
    var fx = $('runfx'), info = state.runInfo;
    if (p === null) { fx.hidden = true; return; }
    if (info) {
      fx.hidden = false;
      var yr = Math.round(info.y0 + p * (info.y1 - info.y0));
      $('rf-year').textContent = yr;
      $('rf-bar').style.width = Math.round(p * 100) + '%';
      $('rf-car').style.left = 'calc(' + (p * 100).toFixed(1) + '% - ' + Math.round(p * 38) + 'px)';
      $('rf-n').textContent = t('rfN', { i: Math.round(p * info.n), n: info.n, y: yr });
    }
    pr.firstElementChild.style.width = Math.round(p * 100) + '%';
    pr.lastElementChild.textContent = msg;
  }

  async function run() {
    if (state.running) return;
    if (!state.raw) { status(t('needData'), 'err'); $('step-farm').scrollIntoView({ behavior: 'smooth' }); return; }
    readSoil();
    state.running = true; $('btn-run').disabled = true;
    try {
      var sc = document.querySelector('input[name=sc]:checked').value;
      var W = getW(sc), opts = simOpts(), soil = state.soil, plan = state.plan.slice();
      var userKey = canon(plan);
      var cands = state.cands.length ? state.cands.slice() : plan.slice();
      var table = {};
      M.enumeratePlans(cands, 4).forEach(function (p) { table[canon(p)] = { plan: p }; });
      M.neighbourPlans(plan, uniq(cands.concat(plan))).forEach(function (nb) {
        var k = canon(nb.plan);
        if (!table[k]) table[k] = { plan: nb.plan };
        if (!table[k].edit) { table[k].edit = nb.edit; table[k].plan = nb.plan; }
      });
      table[userKey] = { plan: plan, user: true };
      var keys = Object.keys(table);
      var nYears = W.lastYear - W.firstYear;
      var tStart = Date.now();
      state.runInfo = { n: keys.length, y0: W.firstYear + 1, y1: W.lastYear };
      progress(0, '');
      await sleep0();
      var screen = keys.length > 1300;
      var results = [];
      for (var i = 0; i < keys.length; i++) {
        var e = table[keys[i]], o = Object.assign({}, opts);
        if (screen && !e.user && !e.edit) o.phases = [0];
        var r = M.crashTest(W, soil, e.plan, o);
        r.key = keys[i]; r.user = !!e.user; r.edit = e.edit || null; r.screened = !!o.phases;
        results.push(r);
        if (i % 25 === 0) { progress(i / keys.length, t('running', { n: keys.length, y: nYears, p: Math.round(i / keys.length * 100) })); await sleep0(); }
      }
      var w = weights();
      M.scoreAll(results, w, opts.irrigation);
      if (screen) {
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
      var best = results[0] !== user ? results[0] : (results[1] || results[0]);
      var fix = results.filter(function (r) { return r.edit && r.score > user.score + 0.5; })[0] || null;

      progress(0.97, t('running', { n: keys.length, y: nYears, p: 97 }));
      await sleep0();
      var Wh = getW('hist');
      // validation run: spring wheat every year, rainfed, like the fixed vegetation inside NASA's MERRA-2 land model
      var validRun = M.simulate(Wh, soil, ['wheat'], { detail: true, phase: 0, straw: opts.straw });
      var scen = ['hist', 'warm', 'hot'].map(function (s) {
        var Ws = getW(s);
        return { sc: s, user: M.crashTest(Ws, soil, plan, Object.assign({}, opts)), best: M.crashTest(Ws, soil, best.plan, Object.assign({}, opts)) };
      });
      var prices = priceSweep(results, w, opts.irrigation, user, fix);
      var sowing = sowingAdvisor(W, soil, plan, opts);
      var W50 = getW('y2050');
      var y50 = { W: W50, user: M.crashTest(W50, soil, plan, Object.assign({}, opts)), best: M.crashTest(W50, soil, best.plan, Object.assign({}, opts)) };
      var water = waterCurve(W, soil, plan, opts);
      state.last = {
        W: W, sc: sc, plan: plan, user: user, best: best, rank: results.indexOf(user) + 1, total: results.length, fix: fix,
        top: results.slice(0, 8), all: results, valid: M.validateWetness(Wh, validRun.dailyWet), clim: M.climateFingerprint(Wh),
        scen: scen, opts: opts, soil: Object.assign({}, soil), prices: prices, w: w,
        sowing: sowing, water: water, raw: state.raw, lat: state.lat, lon: state.lon, y50: y50, norm: results.norm
      };
      state.compare = null;
      updateHash();
      state.why = null; state.priceLevel = 0; state.mapMode = 'real'; state.game = null;
      renderResults(state.last);
      $('results').hidden = false; $('nav-report').hidden = false;
      FX.observe($('results')); FX.refresh($('results'));
      FX.toast(t('toastDone', { n: keys.length, s: ((Date.now() - tStart) / 1000).toFixed(1) }), 'ok');
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      status('Error: ' + err.message, 'err');
    } finally {
      progress(null); state.running = false; $('btn-run').disabled = false;
    }
  }

  /** Re-rank every tested rotation with all prices scaled by −20…+20 %. */
  function priceSweep(results, w, irrigated, user, fix) {
    var out = {};
    PRICE_LEVELS.forEach(function (lv) {
      var reps = results.map(function (r) { return M.reprice(r, 1 + lv / 100); });
      M.scoreAll(reps, w, irrigated);
      reps.sort(function (a, b) { return b.score - a.score; });
      var u = null, f = null;
      reps.forEach(function (r) { if (r.base === user) u = r; if (fix && r.base === fix) f = r; });
      out[lv] = { best: reps[0].base, bestScore: reps[0].score, userRank: reps.indexOf(u) + 1, fixBetter: f ? f.score > u.score : null };
    });
    return out;
  }

  /* ---------------------------------------------------------------- rendering */
  function renderResults(R) {
    renderVerdict(R); renderFindings(R); renderCrashMap(R); renderWhy(R); renderFix(R); renderPerCrop(R);
    renderAlts(R); renderRisk(R); renderPrice(R); renderScenario(R); renderCharts(R);
    renderSowing(R); renderWater(R); renderFarm(R); renderCompare(R); renderOutlook(R);
    renderRace(R); renderMC(R); renderRegions(R);
    renderY50(R); renderSHI(R); renderInsurance(R); renderStreak(R); renderWaterKg(R); renderWind(R); renderGame(R); renderVoiceBtn(R);
    if (window.FX) { FX.observe($('results')); FX.refresh($('results')); }
  }

  function renderVerdict(R) {
    var u = R.user;
    var v = u.crashRate <= 0.10 ? 'PASS' : (u.crashRate <= 0.25 ? 'DAMAGE' : 'CRASH');
    var box = $('verdict'); box.className = 'verdict v-' + v.toLowerCase();
    var html = '<div><div class="v-kicker">' + esc(t('resTitle')) + '</div>' +
      '<div class="v-plan">' + rotHTML(R.plan) + '</div>' +
      '<div class="v-word">' + esc(t('verdict' + v)) + '</div>' +
      '<p class="v-line">' + esc(t('verdictLine', { crash: pct(u.crashRate), dent: pct(u.dentRate), rank: R.rank, total: R.total })) + ' ' +
      esc(R.rank > 1 && R.fix ? t('betterN') : (R.rank === 1 ? t('bestOfAll') : '')) + '</p></div><div class="meters">';
    [['profit', 'pillarProfit'], ['reliability', 'pillarReliability'], ['soil', 'pillarSoil'], ['water', 'pillarWater']].forEach(function (p) {
      var s = Math.round(u.pillar[p[0]]);
      html += '<div class="meter"><span>' + esc(t(p[1])) + '</span><div class="track"><div class="fill" style="width:' + s + '%"></div></div><b data-count="' + s + '">0</b></div>';
    });
    html += '<p class="small">' + esc(t('pillarHint')) + '</p></div>';
    box.innerHTML = html;
  }

  function cropSeasons(u) {
    var all = [];
    u.byPos.forEach(function (b) { all = all.concat(b.seasons); });
    return all;
  }

  function renderFindings(R) {
    var u = R.user, ul = $('findings'); ul.innerHTML = '';
    var add = function (s, cls) { var li = document.createElement('li'); li.textContent = s; if (cls) li.className = cls; ul.appendChild(li); };
    var crop = cropSeasons(u).filter(function (s) { return DB.BY_ID[s.crop].harvestable; });
    var crashes = crop.filter(function (s) { return s.outcome === 'crash'; });
    if (crashes.length) add(t('f1', { n: crop.length, y0: u.Y0, y1: u.Y1, crash: crashes.length, pct: pct(u.crashRate) }), 'bad');
    else add(t('f1none', { n: crop.length, y0: u.Y0, y1: u.Y1, dent: pct(u.dentRate) }), 'good');
    var weak = u.byPos.slice().sort(function (a, b) { return b.crashRate - a.crashRate; })[0];
    if (weak && weak.crashRate >= 0.1) add(t('f2', { crop: cropName(weak.crop), pos: weak.pos + 1, rate: pct(weak.crashRate), cause: causeName(weak.mainCause) }), 'bad');
    else add(t('f2none'), 'good');
    add(t('f3', { chg: signed(u.socChangePct) + '%', n: u.nYears, rate: signed(u.socRate, 2), eros: u.erosionDays.toFixed(1), live: Math.round(u.liveRootDays) }), u.socChangePct < -5 ? 'bad' : '');
    add(R.opts.irrigation ? t('f4irr', { irr: Math.round(u.irrigation) }) : t('f4rain', { def: Math.round(u.deficit) }));
    var hot = R.scen[2], hist = R.scen[0];
    add(t('f6', { hot: pct(hot.user.crashRate), now: pct(hist.user.crashRate) }), hot.user.crashRate > hist.user.crashRate + 0.05 ? 'bad' : '');
    // worst years: worst crop-season of each year, ranked by income
    var byYear = {};
    crop.forEach(function (s) { if (!byYear[s.year] || s.margin < byYear[s.year].margin) byYear[s.year] = s; });
    var worst = Object.keys(byYear).map(function (y) { return byYear[y]; })
      .filter(function (s) { return s.outcome === 'crash' || s.outcome === 'dent'; })
      .sort(function (a, b) { return a.margin - b.margin; }).slice(0, 5)
      .sort(function (a, b) { return a.year - b.year; });
    var wy = $('worst-years'); wy.innerHTML = '';
    if (worst.length) {
      wy.insertAdjacentHTML('beforeend', '<span class="muted">' + esc(t('worstYears')) + '</span>');
      worst.forEach(function (s) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = s.year;
        b.onclick = function () { openWhy(s, true); };
        wy.appendChild(b);
      });
    }
  }

  var OUT_COL = { ok: 'var(--ok)', dent: 'var(--dent)', crash: 'var(--crash)', rest: 'var(--rest)' };

  function renderCrashMap(R) {
    var u = mapCtx(R).user, box = $('crashmap'); box.innerHTML = '';
    if (state.mapMode === '2050') box.insertAdjacentHTML('beforeend', '<p class="map-note">' + esc(t('y50MapNote')) + '</p>');
    var years = []; for (var y = u.Y0; y <= u.Y1; y++) years.push(y);
    var grid = document.createElement('div'); grid.className = 'cm-grid';
    grid.style.gridTemplateColumns = 'minmax(120px, 170px) repeat(' + years.length + ', minmax(12px, 1fr))';
    grid.appendChild(div('', ''));
    years.forEach(function (y) { grid.appendChild(div(y % 5 === 0 ? String(y) : '', 'cm-year')); });
    u.byPos.forEach(function (b, row) {
      var lab = div('', 'cm-crop'); lab.innerHTML = (b.pos + 1) + '. ' + sw(b.crop) + esc(cropName(b.crop));
      grid.appendChild(lab);
      var by = {}; b.seasons.forEach(function (s) { by[s.year] = s; });
      years.forEach(function (y) {
        var s = by[y];
        if (!s) { grid.appendChild(div('', '')); return; }
        var c = document.createElement('button'); c.type = 'button'; c.className = 'cm-cell';
        c.style.background = OUT_COL[s.outcome];
        c.setAttribute('aria-label', y + ', ' + cropName(s.crop) + ': ' + t(s.outcome));
        c.style.setProperty('--d', ((y - u.Y0) * 14 + row * 70) + 'ms');
        FX.tip(c, y + ', ' + cropName(s.crop) + ': ' + t(s.outcome) + ', ' + money(s.margin) + ' $/ha');
        c.onclick = function () { openWhy(s, true); };
        s._cell = c;
        grid.appendChild(c);
      });
    });
    box.appendChild(grid);
    var lg = $('crashmap-legend'); lg.innerHTML = '';
    ['ok', 'dent', 'crash', 'rest'].forEach(function (k) {
      lg.insertAdjacentHTML('beforeend', '<span><i style="background:' + OUT_COL[k] + '"></i>' + esc(t(k)) + '</span>');
    });
  }
  function div(txt, cls) { var d = document.createElement('div'); if (cls) d.className = cls; d.textContent = txt; return d; }
  function head(tb, cols, numFrom) {
    var hr = tb.insertRow();
    cols.forEach(function (h, i) { var th = document.createElement('th'); th.textContent = h; if (numFrom !== undefined && i >= numFrom) th.className = 'num'; hr.appendChild(th); });
  }

  /* ---------- "why did this year fail?" ---------- */
  function phaseOf(R, season) {
    var ph = 0;
    mapCtx(R).user.runs.forEach(function (run) { if (run.seasons.indexOf(season) >= 0) ph = run.phase; });
    return ph;
  }
  function openWhy(season, scroll) {
    state.why = season;
    renderWhy(state.last);
    var wb = $('why'); wb.classList.remove('updated'); void wb.offsetWidth; wb.classList.add('updated');
    if (scroll) { wb.scrollIntoView({ behavior: 'smooth', block: 'center' }); wb.focus({ preventScroll: true }); }
  }
  function renderWhy(R) {
    var box = $('why');
    document.querySelectorAll('.cm-cell.sel').forEach(function (c) { c.classList.remove('sel'); });
    document.querySelectorAll('.worst button').forEach(function (b) { b.classList.toggle('on', state.why && +b.textContent === state.why.year); });
    var s0 = state.why;
    if (!s0) { box.innerHTML = '<h3>' + esc(t('whyHead')) + '</h3><p class="why-empty">' + esc(t('whyPick')) + '</p>'; return; }
    if (s0._cell) s0._cell.classList.add('sel');
    var W = mapCtx(R).W, c = DB.BY_ID[s0.crop];
    // re-run this starting position with a daily trace for the chosen year
    var run = M.simulate(W, R.soil, R.plan, Object.assign({}, R.opts, { phase: phaseOf(R, s0), traceYear: s0.year }));
    var s = run.seasons.filter(function (x) { return x.year === s0.year && x.pos === s0.pos; })[0] || s0;
    var html = '<h3>' + esc(t('whyTitle', { year: s.year })) + '</h3>';
    html += '<div class="v-plan" style="color:inherit">' + cropHTML(s.crop) + '<span class="muted">' + esc(t(s.outcome)) + '</span></div>';
    if (c.fallow) { box.innerHTML = html + '<p class="why-big">' + esc(t('whyFallow')) + '</p>'; return; }
    if (s.notSown) { box.innerHTML = html + '<p class="why-big">' + esc(causeName('notsown')) + '</p>'; return; }
    var need = Math.round(s.etc), rain = Math.round(s.rain), store = Math.round(s.store), irr = Math.round(s.irrD), got = Math.round(s.eta);
    var left = '<p class="why-big">' + esc(t('whyNeed', { crop: cropName(s.crop), need: need, sow: shortDate(W, s.sowDay), harv: shortDate(W, s.harvestDay) })) + ' ' +
      esc(t('whySupply', { rain: rain, store: store, irr: irr > 0 ? t('whyIrr', { irr: irr }) : '', got: got, pct: need ? Math.round(got / need * 100) : 100 })) + '</p>';
    var mx = Math.max(need, rain + store + irr, 1);
    function bar(label, parts, val) {
      var tr = parts.map(function (p) { return '<i style="width:' + (p[0] / mx * 100).toFixed(1) + '%;background:' + p[1] + '"></i>'; }).join('');
      return '<div class="wbar"><span>' + esc(label) + '</span><div class="track">' + tr + '</div><b>' + val + Lx(' mm', ' мм', ' мм') + '</b></div>';
    }
    left += '<div class="wbars">' + bar(t('barNeed'), [[need, '#13283b']], need) +
      bar(t('barRain'), [[rain, '#2e5e8c']], rain) +
      bar(t('barStore'), [[store, '#7ea3c4']], store) +
      (irr > 0 ? bar(t('barIrr'), [[irr, '#5e9fb0']], irr) : '') +
      bar(t('barGot'), [[got, got < need * 0.6 ? '#b73a2b' : '#3f7d4e']], got) + '</div>';
    var extra = [];
    if (s.heatDays > 0) extra.push(t('whyHeat', { n: s.heatDays, t: c.Theat }));
    var fr = [];
    if (s.frostSeed) fr.push(t('whyFrostSeed'));
    if (s.frostFlower > 0) fr.push(t('whyFrostFlower', { n: s.frostFlower }));
    if (s.winterKill > 0.2) fr.push(t('whyWinter'));
    if (fr.length) extra.push(t('whyFrost', { what: fr.join(', ') }));
    if (s.immature) extra.push(t('whyImm'));
    if (s.rot && s.rot.disease > 0) extra.push(t('whyDis'));
    if (store + rain + irr > got + 20) extra.unshift(t('whyNote'));
    extra.forEach(function (x) { left += '<p>' + esc(x) + '</p>'; });
    left += '<p class="why-out">' + esc(s.outcome === 'ok' ? t('whyResultOk', { y: s.yield.toFixed(2), m: money(s.margin) }) :
      t('whyResult', { y: s.yield.toFixed(2), m: money(s.margin), cause: causeName(s.cause) })) + '</p>';
    if (s.year >= 2000) left += '<button type="button" class="btn ghost" id="why-ndvi">' + esc(t('showNdvi')) + '</button>';
    html += '<div class="why-grid"><div>' + left + '</div><div><p class="small muted">' + esc(t('cumTitle')) + '</p><div id="why-chart"></div></div></div>';
    box.innerHTML = html;
    if ($('why-ndvi')) $('why-ndvi').onclick = function () { showNdviYear(s.year); };
    if (s.trace && s.trace.etc.length) {
      var cn = 0, cs = store, xs = [], need2 = [], sup = [];
      for (var i = 0; i < s.trace.etc.length; i++) {
        cn += s.trace.etc[i]; cs += s.trace.rain[i] + s.trace.irr[i];
        xs.push(shortDate(W, s.trace.day0 + i)); need2.push(cn); sup.push(cs);
      }
      Charts.chart($('why-chart'), {
        x: xs, height: 260,
        series: [
          { type: 'line', name: t('cumNeed'), values: need2, color: '#13283b', dots: false, width: 2.6 },
          { type: 'line', name: t('cumSupply'), values: sup, color: '#2e5e8c', dots: false, dash: '6 4', width: 2.6 }
        ]
      });
    }
  }

  function renderFix(R) {
    var box = $('fix'), f = R.fix, u = R.user;
    var html = '<h3>' + esc(t('fixTitle')) + '</h3>';
    if (!f) { box.innerHTML = html + '<p>' + esc(t('fixNone')) + '</p>'; return; }
    var e = f.edit, txt;
    if (e.type === 'replace') txt = t('fixReplace', { pos: e.pos + 1, to: cropName(e.to), from: cropName(e.from) });
    else if (e.type === 'insert') txt = t('fixInsert', { pos: e.pos + 1, to: cropName(e.to) });
    else txt = t('fixDelete', { pos: e.pos + 1, from: cropName(e.from) });
    html += '<p class="fix-main">' + esc(txt) + '</p><div class="fix-plan">' + rotHTML(f.plan) + '</div>';
    html += '<p class="small">' + esc(t('fixGain', { c1: pct(u.crashRate), c2: pct(f.crashRate), m1: money(u.meanMargin), m2: money(f.meanMargin), s1: signed(u.socChangePct) + '%', s2: signed(f.socChangePct) + '%' })) + '</p>';
    html += '<button type="button" class="btn primary" id="fix-test">' + esc(t('test')) + '</button>';
    box.innerHTML = html;
    $('fix-test').onclick = function () { testPlan(f.plan); };
  }

  function renderPerCrop(R) {
    var tb = $('percrop'); tb.innerHTML = '';
    head(tb, t('perCropCols'), 1);
    R.user.byPos.forEach(function (b) {
      var c = DB.BY_ID[b.crop], r = tb.insertRow();
      r.insertCell().innerHTML = '<span class="rot">' + (b.pos + 1) + '. ' + cropHTML(b.crop) + '</span>';
      cellN(r, c.harvestable ? b.meanYield.toFixed(2) : t('none'));
      cellN(r, money(b.meanMargin));
      var cr = cellN(r, c.harvestable ? pct(b.crashRate) + '%' : t('none')); if (b.crashRate > 0.2) cr.classList.add('neg');
      cellN(r, c.harvestable && b.mainCause ? causeName(b.mainCause) : t('none'));
    });
  }
  function cellN(row, txt) { var c = row.insertCell(); c.textContent = txt; c.className = 'num'; return c; }

  function renderAlts(R) {
    var tb = $('alts'); tb.innerHTML = '';
    head(tb, t('altCols'), 2);
    var rows = R.top.slice();
    if (rows.indexOf(R.user) < 0) rows.push(R.user);
    rows.forEach(function (r) {
      var tr = tb.insertRow(); if (r.user) tr.className = 'me';
      tr.insertCell().textContent = R.all.indexOf(r) + 1;
      tr.insertCell().innerHTML = '<div class="rot">' + rotHTML(r.plan) + (r.user ? '<span class="muted">(' + esc(t('yours')) + ')</span>' : '') + '</div>';
      cellN(tr, Math.round(r.score));
      cellN(tr, money(r.meanMargin));
      cellN(tr, pct(r.crashRate) + '%');
      cellN(tr, money(r.p10Margin));
      cellN(tr, signed(r.socChangePct) + '%');
      cellN(tr, Math.round(r.deficit));
      cellN(tr, Math.round(r.irrigation));
      var bc = tr.insertCell();
      if (!r.user) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = t('test');
        b.onclick = function () { testPlan(r.plan); };
        var cb = document.createElement('button'); cb.type = 'button'; cb.className = 'link'; cb.textContent = t('cmpBtn');
        cb.style.marginLeft = '12px';
        cb.onclick = function () { state.compare = r; renderCompare(state.last); $('cmp').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        bc.appendChild(b); bc.appendChild(cb);
      }
    });
  }

  function renderRisk(R) {
    var u = R.user, a = u.early, b = u.late;
    function card(p) {
      var share = p.years ? p.lossYears / p.years : 0;
      return '<div class="period"><div class="yrs">' + esc(t('riskEarly', { a: p.from, b: p.to })) + '</div>' +
        '<div class="big" data-count="' + Math.round(share * 100) + '" data-suffix="%">0%</div>' +
        '<div class="bar2"><i style="width:' + Math.round(share * 100) + '%"></i></div>' +
        '<div class="small">' + esc(t('riskLoss', { n: p.lossYears, m: p.years })) + '</div>' +
        '<div class="small muted">' + esc(t('riskCrash', { p: pct(p.crashRate) })) + '</div></div>';
    }
    var sa = a.years ? a.lossYears / a.years : 0, sb = b.years ? b.lossYears / b.years : 0;
    var verdict = sb > sa + 0.05 ? t('riskUp') : (sb < sa - 0.05 ? t('riskDown') : t('riskSame'));
    $('risk').innerHTML = '<h3>' + esc(t('riskTitle')) + '</h3><div class="periods">' + card(a) + card(b) + '</div>' +
      '<p class="risk-verdict">' + esc(verdict) + '</p><p class="small muted">' + esc(t('riskNote')) + '</p>';
  }

  function renderPrice(R) {
    var box = $('price');
    box.innerHTML = '<h3>' + esc(t('priceTitle')) + '</h3><p class="small muted">' + esc(t('priceHint')) + '</p>' +
      '<div class="price-row"><span>' + esc(t('priceLabel')) + '</span><input type="range" id="price-range" min="-20" max="20" step="5" value="' + state.priceLevel + '" aria-label="' + esc(t('priceLabel')) + '"><output id="price-out"></output></div>' +
      '<p id="price-text"></p><div class="levels" id="price-levels"></div><p class="small" id="price-robust"></p>';
    var base = R.prices[0].best;
    var keep = PRICE_LEVELS.filter(function (lv) { return R.prices[lv].best === base; }).length;
    $('price-robust').textContent = t('priceRobust', { k: keep, n: PRICE_LEVELS.length });
    function upd() {
      var lv = +$('price-range').value; state.priceLevel = lv;
      var p = R.prices[lv], lab = (lv > 0 ? '+' : '') + lv + '%';
      $('price-out').textContent = lab;
      var txt = t('priceNow', { p: lab, plan: planText(p.best.plan), rank: p.userRank, total: R.total });
      if (p.fixBetter !== null) txt += ' ' + (p.fixBetter ? t('priceFix') : t('priceFixNo'));
      $('price-text').textContent = txt;
      var lvBox = $('price-levels'); lvBox.innerHTML = '';
      PRICE_LEVELS.forEach(function (l) {
        var d = document.createElement('div');
        d.className = (R.prices[l].best === base ? 'keep' : '') + (l === lv ? ' cur' : '');
        d.textContent = (l > 0 ? '+' : '') + l + '%';
        d.title = planText(R.prices[l].best.plan);
        lvBox.appendChild(d);
      });
    }
    $('price-range').oninput = upd; upd(); paintAllRanges();
  }

  function renderScenario(R) {
    var tb = $('sctable'); tb.innerHTML = '';
    head(tb, t('scCols'), 1);
    var names = { hist: t('scHist'), warm: t('scWarm'), hot: t('scHot') };
    R.scen.forEach(function (s) {
      var tr = tb.insertRow();
      tr.insertCell().textContent = names[s.sc];
      cellN(tr, pct(s.user.crashRate) + '%'); cellN(tr, money(s.user.meanMargin) + ' $/ha');
      cellN(tr, pct(s.best.crashRate) + '%'); cellN(tr, money(s.best.meanMargin) + ' $/ha');
    });
    tb.createCaption().textContent = t('bestPlan') + ': ' + planText(R.best.plan);
  }

  function renderCharts(R) {
    var u = R.user, best = R.best;
    function perYear(res) {
      var m = {};
      res.runs.forEach(function (run) { run.seasons.forEach(function (s) { (m[s.year] = m[s.year] || []).push(s.margin); }); });
      return m;
    }
    var pu = perYear(u), pb = perYear(best), years = Object.keys(pu).sort();
    Charts.chart($('ch-income'), {
      x: years,
      series: [
        { type: 'bar', name: t('yourPlan'), values: years.map(function (y) { return mean(pu[y]); }), color: function (v) { return v < 0 ? '#b73a2b' : '#3f7d4e'; }, legendColor: '#3f7d4e' },
        { type: 'line', name: t('bestPlan'), values: years.map(function (y) { return mean(pb[y]); }), color: '#13283b', dash: '5 4' }
      ]
    });
    function socSeries(res) {
      var n = res.runs[0].soc.length, out = [];
      for (var i = 0; i < n; i++) out.push(mean(res.runs.map(function (r) { return r.soc[i] ? r.soc[i].soc : 0; })));
      return out;
    }
    Charts.chart($('ch-soil'), {
      x: u.runs[0].soc.map(function (s) { return s.year; }), zero: false,
      series: [
        { type: 'line', name: t('yourPlan'), values: socSeries(u), color: '#8a5a2b', dots: false },
        { type: 'line', name: t('bestPlan'), values: socSeries(best), color: '#13283b', dash: '5 4', dots: false }
      ]
    });
    var cy = R.clim.years, ru = I18N.lang === 'ru';
    Charts.chart($('ch-climate'), {
      x: cy.map(function (r) { return r.year; }), unitRight: Lx('days', 'дни', 'күн'),
      series: [
        { type: 'bar', name: Lx('rain, mm', 'осадки, мм', 'жауын-шашын, мм'), values: cy.map(function (r) { return r.prec; }), color: '#2e5e8c' },
        { type: 'line', name: Lx('days ≥ 30 °C', 'дни ≥ 30 °C', '≥ 30 °C күндер'), values: cy.map(function (r) { return r.hot; }), color: '#c9922e', axis: 'right' }
      ]
    });
    var tr = R.clim.trend;
    $('ch-climate-hint').textContent = t('chClimateHint', { season: R.W.lat < 0 ? t('seasonSouth') : t('seasonNorth'), p: signed(tr.prec, 0), h: signed(tr.hot, 1), e: signed(tr.et0, 0) });
    var v = R.valid;
    if (v && v.rows.length) {
      var rows = v.rows.slice(-60);
      var sd = function (a) { var m = mean(a); return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))) || 1; };
      var sm = sd(v.rows.map(function (r) { return r.am; })), sg = sd(v.rows.map(function (r) { return r.ag; }));
      Charts.chart($('ch-valid'), {
        x: rows.map(function (r) { return r.y + '-' + String(r.mo + 1).padStart(2, '0'); }),
        series: [
          { type: 'line', name: 'NASA MERRA-2 GWETROOT', values: rows.map(function (r) { return r.ag / sg; }), color: '#2e5e8c' },
          { type: 'line', name: Lx('Our model', 'Наша модель', 'Біздің модель'), values: rows.map(function (r) { return r.am / sm; }), color: '#c9922e', dash: '4 3' }
        ]
      });
      $('ch-valid-hint').textContent = t('chValidHint', { r: v.rAnom.toFixed(2), n: v.n }) + ' ' +
        t(v.rAnom >= 0.6 ? 'validGood' : (v.rAnom >= 0.4 ? 'validMid' : 'validLow'));
    }
  }

  function testPlan(plan) {
    state.plan = plan.slice();
    renderPlan();
    run();
  }


  /* ---------------------------------------------------------------- sowing-date advisor */
  var SHIFTS = [-14, -7, 0, 7, 14];
  function sowingAdvisor(W, soil, plan, opts) {
    var crops = uniq(plan).filter(function (id) { return DB.BY_ID[id].harvestable; });
    return crops.map(function (id) {
      var cells = SHIFTS.map(function (d) {
        var o = Object.assign({}, opts); o.sowShiftByCrop = {}; o.sowShiftByCrop[id] = d;
        var r = M.crashTest(W, soil, plan, o);
        var ss = [];
        r.byPos.forEach(function (b) { if (b.crop === id) ss = ss.concat(b.seasons); });
        return {
          shift: d, margin: mean(ss.map(function (x) { return x.margin; })),
          crash: ss.length ? ss.filter(function (x) { return x.outcome === 'crash'; }).length / ss.length : 0
        };
      });
      return { crop: id, cells: cells };
    });
  }
  function renderSowing(R) {
    var box = $('sowing');
    var html = '<h3>' + esc(t('sowTitle')) + '</h3><p class="small muted">' + esc(t('sowHint')) + '</p><div class="table-wrap"><table class="sowt"><tr>';
    t('sowCols').forEach(function (c, i) { html += '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; });
    html += '</tr>';
    var bestGain = null;
    R.sowing.forEach(function (row) {
      var base = row.cells[2], top = row.cells.reduce(function (a, b) { return b.margin > a.margin ? b : a; });
      html += '<tr><td><span class="rot">' + cropHTML(row.crop) + '</span></td>';
      row.cells.forEach(function (c) {
        html += '<td class="num' + (c === top ? ' best' : '') + (c.shift === 0 ? ' usual' : '') + '"><b>' + money(c.margin) + ' $/ha</b><br><span class="small muted">' + esc(t('crashShort')) + ' ' + pct(c.crash) + '%</span></td>';
      });
      html += '</tr>';
      var gain = top.margin - base.margin;
      if (top !== base && gain > 5 && (!bestGain || gain > bestGain.gain)) bestGain = { gain: gain, row: row, top: top, base: base };
    });
    html += '</table></div>';
    if (bestGain) {
      var key = { '-14': 'sowEarlier2', '-7': 'sowEarlier1', '7': 'sowLater1', '14': 'sowLater2' }[String(bestGain.top.shift)];
      html += '<p class="note-strong">' + esc(t('sowBest', { crop: cropName(bestGain.row.crop).toLowerCase(), shift: t(key), m0: money(bestGain.base.margin), m1: money(bestGain.top.margin), c0: pct(bestGain.base.crash), c1: pct(bestGain.top.crash) })) + '</p>';
    } else html += '<p class="note-strong">' + esc(t('sowKeep')) + '</p>';
    box.innerHTML = html;
  }

  /* ---------------------------------------------------------------- irrigation value */
  var QUOTAS = [0, 100, 200, 300, 400, 500, 600, 700, 800];
  function waterCurve(W, soil, plan, opts) {
    return QUOTAS.map(function (q) {
      var r = M.crashTest(W, soil, plan, { irrigation: q > 0, quota: q, straw: opts.straw });
      return { q: q, margin: r.meanMargin, crash: r.crashRate, used: r.irrigation };
    });
  }
  function renderWater(R) {
    var box = $('water'), wc = R.water;
    box.innerHTML = '<h3>' + esc(t('watTitle')) + '</h3><p class="small muted">' + esc(t('watHint')) + '</p><div id="wat-chart"></div><p class="note-strong" id="wat-text"></p>';
    Charts.chart($('wat-chart'), {
      x: wc.map(function (c) { return c.q + ' mm'; }), height: 230,
      series: [
        { type: 'bar', name: t('watIncome'), values: wc.map(function (c) { return c.margin; }), color: function (v) { return v < 0 ? '#b73a2b' : '#2e5e8c'; }, legendColor: '#2e5e8c',
          title: function (i) { return wc[i].q + ' mm: ' + money(wc[i].margin) + ' $/ha'; } },
        { type: 'line', name: t('watCrash'), values: wc.map(function (c) { return c.crash * 100; }), color: '#b73a2b', axis: 'right' }
      ]
    });
    var top = wc.reduce(function (a, b) { return b.margin > a.margin ? b : a; }), base = wc[0];
    var txt;
    if (top.q === 0 || top.margin - base.margin < 5) txt = t('watNone');
    else {
      var target = base.margin + 0.9 * (top.margin - base.margin);
      var q90 = wc.filter(function (c) { return c.margin >= target; })[0];
      txt = q90.q < top.q ? t('watBest', { m: money(top.margin), q: top.q, q90: q90.q, save: Math.round(top.used - q90.used) })
        : t('watBestOnly', { m: money(top.margin), q: top.q });
    }
    $('wat-text').textContent = txt;
  }

  /* ---------------------------------------------------------------- whole farm & carbon */
  function socEnd(r) { return mean(r.runs.map(function (run) { var l = run.soc[run.soc.length - 1]; return l ? l.soc - run.soc0 : 0; })); }
  function renderFarm(R) {
    var area = Math.max(0, +$('farm-area').value || 0), price = Math.max(0, +$('farm-carbon').value || 0);
    var u = R.user, b = R.best;
    var co2u = socEnd(u) * 3.667 * area, co2b = socEnd(b) * 3.667 * area;
    var html = '<p>' + esc(t('farmIncome', { inc: money(u.meanMargin * area), bad: money(u.p10Margin * area) })) + '</p>';
    if (b !== u && b.meanMargin > u.meanMargin) html += '<p>' + esc(t('farmSwitch', { gain: money((b.meanMargin - u.meanMargin) * area) })) + '</p>';
    var diff = co2b - co2u;
    html += '<p>' + esc(t('farmSoil', { n: u.nYears, co2: (co2u > 0 ? '+' : '') + money(co2u), diff: money(Math.max(0, diff)), val: money(Math.max(0, diff) * price) })) + '</p>';
    $('farm-out').innerHTML = html;
  }

  /* ---------------------------------------------------------------- side-by-side comparison */
  function renderCompare(R) {
    var box = $('cmp'), a = R.user, b = state.compare;
    if (!b) { box.hidden = true; return; }
    box.hidden = false;
    var rows = t('cmpRows');
    function lossRate(r) { return r.dentRate + r.crashRate; }
    var spec = [
      ['margin', function (r) { return r.meanMargin; }, function (v) { return money(v); }, 1],
      ['p10', function (r) { return r.p10Margin; }, function (v) { return money(v); }, 1],
      ['crash', function (r) { return r.crashRate * 100; }, function (v) { return Math.round(v) + '%'; }, -1],
      ['loss', function (r) { return lossRate(r) * 100; }, function (v) { return Math.round(v) + '%'; }, -1],
      ['soc', function (r) { return r.socChangePct; }, function (v) { return signed(v) + '%'; }, 1],
      ['eros', function (r) { return r.erosionDays; }, function (v) { return v.toFixed(1); }, -1],
      ['live', function (r) { return r.liveRootDays; }, function (v) { return Math.round(v); }, 1],
      ['def', function (r) { return r.deficit; }, function (v) { return Math.round(v); }, -1],
      ['irr', function (r) { return r.irrigation; }, function (v) { return Math.round(v); }, -1],
      ['score', function (r) { return r.score; }, function (v) { return Math.round(v); }, 1]
    ];
    var html = '<h3>' + esc(t('cmpTitle')) + '</h3><div class="cmp-heads"><div><span class="tag">A</span><div class="rot">' + rotHTML(a.plan) + '</div></div><div><span class="tag b">B</span><div class="rot">' + rotHTML(b.plan) + '</div></div></div>';
    html += '<div class="table-wrap"><table><tr>' + t('cmpCols').map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr>';
    spec.forEach(function (sp) {
      var va = sp[1](a), vb = sp[1](b), d = vb - va, good = d * sp[3] > 1e-9, bad = d * sp[3] < -1e-9;
      html += '<tr><td>' + esc(rows[sp[0]]) + '</td><td class="num">' + sp[2](va) + '</td><td class="num">' + sp[2](vb) + '</td><td class="num ' + (good ? 'pos' : (bad ? 'neg' : '')) + '">' +
        (sp[0] === 'crash' || sp[0] === 'loss' ? signed(d, 0) + ' pp' : (Math.abs(d) < 0.05 ? '0' : (d > 0 ? '+' : '') + String(sp[2](d)).replace(/^\+/, ''))) + '</td></tr>';
    });
    html += '</table></div><p class="small muted">' + esc(t('cmpStrip')) + '</p><div class="cmp-strips"><div id="cmp-a"></div><div id="cmp-b"></div></div>';
    html += '<button type="button" class="link" id="cmp-close">' + esc(t('cmpClose')) + '</button>';
    box.innerHTML = html;
    [['cmp-a', a], ['cmp-b', b]].forEach(function (pair) {
      var per = {};
      pair[1].runs.forEach(function (run) { run.seasons.forEach(function (x) { (per[x.year] = per[x.year] || []).push(x); }); });
      var el = $(pair[0]);
      Object.keys(per).sort().forEach(function (y) {
        var ss = per[y], m = mean(ss.map(function (x) { return x.margin; })), rev = mean(ss.map(function (x) { return x.revenue; })), cost = mean(ss.map(function (x) { return x.cost; }));
        var i = document.createElement('i');
        i.className = rev < 0.5 * cost ? 'crash' : (m < 0 ? 'dent' : 'ok');
        i.title = y + ': ' + money(m) + ' $/ha';
        el.appendChild(i);
      });
    });
    $('cmp-close').onclick = function () { state.compare = null; renderCompare(R); };
  }

  /* ---------------------------------------------------------------- next-season outlook */
  var outlookCache = {};
  function renderOutlook(R) {
    var box = $('outlook');
    var nextYear = new Date().getUTCFullYear() + 1;
    var key = R.lat + ',' + R.lon;
    box.innerHTML = '<h3>' + esc(t('olTitle', { y: nextYear })) + '</h3><div id="ol-body"><p class="muted">' + esc(t('olLoading')) + '</p><i class="skel" style="width:80%"></i><i class="skel" style="width:60%"></i><i class="skel" style="width:70%"></i></div>';
    var cached = outlookCache[key];
    var p = cached ? Promise.resolve(cached) : fetchRecentYear(R.lat, R.lon).then(function (recent) {
      var raw = combineRaw(R.raw, recent);
      var W2 = M.prepareWeather(raw, R.lat);
      var run = M.simulate(W2, R.soil, ['wheat'], { detail: true, includePartial: true, straw: R.opts.straw });
      var a = M.analogYears(W2, run.dailyWet, 5);
      a.W2 = W2;
      outlookCache[key] = a;
      return a;
    });
    p.then(function (a) { if (state.last === R) drawOutlook(R, a); })
      .catch(function (e) { if (state.last === R) $('ol-body').innerHTML = '<p class="muted">' + esc(t('olFail', { err: e.message })) + '</p>'; });
  }
  function fetchRecentYear(lat, lon) {
    var y = new Date().getUTCFullYear();
    var url = 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=' + POWER_PARAMS.join(',') +
      '&community=AG&longitude=' + lon + '&latitude=' + lat + '&start=' + y + '0101&end=' + y + '1231&format=JSON';
    return fetchJSON(url, 90000).then(function (d) {
      var p = d.properties.parameter, dates = Object.keys(p.T2M_MAX).sort();
      var last = dates.length - 1;
      while (last > 0 && (p.T2M_MAX[dates[last]] === -999 || p.PRECTOTCORR[dates[last]] === -999)) last--;
      var out = { start: dates[0], n: last + 1 };
      POWER_PARAMS.forEach(function (k) { out[k] = dates.slice(0, last + 1).map(function (dt) { var v = p[k] ? p[k][dt] : null; return v === -999 ? null : v; }); });
      return out;
    });
  }
  function combineRaw(raw, recent) {
    // historical record ends on 31 Dec of the previous year; recent starts on 1 Jan
    var out = { start: raw.start, elev: raw.elev, n: raw.n + recent.n };
    POWER_PARAMS.forEach(function (k) { out[k] = (raw[k] || []).concat(recent[k] || []); });
    return out;
  }
  function drawOutlook(R, a) {
    var W = getW('hist');
    var prevSel = state.olPrev && DB.BY_ID[state.olPrev] ? state.olPrev : R.plan[R.plan.length - 1];
    var dt = shortDate(a.W2, a.lastIdx), from = R.lat >= 0 ? Lx('1 August', '1 августа', '1 тамыздан') : Lx('1 February', '1 февраля', '1 ақпаннан');
    var html = '<p class="why-big">' + esc(t('olState', { date: dt + ' ' + a.year, wp: a.wetPct, rain: Math.round(a.cur.prec), from: from, pp: a.precPct })) + '</p>';
    html += '<div class="worst"><span class="muted">' + esc(t('olAnalogs')) + '</span>' + a.analogs.map(function (h) { return '<span class="pill">' + h.year + '</span>'; }).join('') + '</div>';
    html += '<label class="inline ol-prev"><span>' + esc(t('olPrev', { y: a.year })) + '</span><select id="ol-prev"></select></label><div id="ol-table"></div><p class="small muted">' + esc(t('olNote')) + '</p>';
    $('ol-body').innerHTML = html;
    var sel = $('ol-prev');
    DB.CROPS.forEach(function (c) { var o = document.createElement('option'); o.value = c.id; o.textContent = cropName(c.id); if (c.id === prevSel) o.selected = true; sel.appendChild(o); });
    sel.style.width = 'auto'; sel.style.maxWidth = '100%';
    function table() {
      var prev = sel.value; state.olPrev = prev;
      var years = a.analogs.map(function (h) { return h.year + 1; });
      var cands = uniq(state.cands.concat(R.plan)).filter(function (id) { return DB.BY_ID[id].harvestable; });
      var rows = cands.map(function (id) {
        var plan = id === prev ? [id] : [prev, id];
        var r = M.crashTest(W, R.soil, plan, Object.assign({}, R.opts));
        var ss = [];
        r.byPos.forEach(function (b) { if (b.crop === id) ss = ss.concat(b.seasons); });
        var an = ss.filter(function (x) { return years.indexOf(x.year) >= 0; });
        // one season per analog year (a plan of length 2 gives each year once per phase)
        var byY = {}; an.forEach(function (x) { if (!byY[x.year]) byY[x.year] = x; });
        an = Object.keys(byY).map(function (y) { return byY[y]; });
        return {
          id: id, m: mean(an.map(function (x) { return x.margin; })), n: an.length,
          c: an.filter(function (x) { return x.outcome === 'crash'; }).length,
          all: mean(ss.map(function (x) { return x.margin; })), y: mean(an.map(function (x) { return x.yield; }))
        };
      }).sort(function (x, y) { return y.m - x.m; });
      var best = rows[0];
      var h = '<p class="note-strong">' + esc(t('olBest', { y: a.year + 1, crop: cropName(best.id), m: money(best.m), c: best.c, n: best.n })) + '</p>';
      h += '<div class="table-wrap"><table><tr>' + t('olCols').map(function (c, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr>';
      rows.forEach(function (r, i) {
        h += '<tr' + (i === 0 ? ' class="me"' : '') + '><td><span class="rot">' + cropHTML(r.id) + '</span></td><td class="num">' + money(r.m) + '</td><td class="num">' + r.c + ' / ' + r.n + '</td><td class="num">' + money(r.all) + '</td><td class="num">' + r.y.toFixed(2) + '</td></tr>';
      });
      $('ol-table').innerHTML = h + '</table></div>';
    }
    sel.onchange = table; table();
    void W;
  }

  /* ---------------------------------------------------------------- shareable link */
  function updateHash() {
    var R = state.last; if (!R) return;
    var w = R.w;
    var parts = [
      'p=' + R.plan.join('.'),
      state.presetId ? 'f=' + state.presetId : 'll=' + state.lat + ',' + state.lon,
      'w=' + [w.profit, w.reliability, w.soil, w.water].join('.'),
      'sc=' + R.sc, 'c=' + state.cands.join('.')
    ];
    if (R.opts.irrigation) parts.push('irr=' + R.opts.quota);
    if (!R.opts.straw) parts.push('straw=0');
    try { history.replaceState(null, '', location.pathname + location.search + '#' + parts.join('&')); } catch (e) { /* file:// */ }
  }
  function shareLink() {
    updateHash();
    var url = location.href, btn = $('btn-share');
    var done = function () { FX.toast(t('shared'), 'ok'); btn.textContent = t('shared'); setTimeout(function () { btn.textContent = t('share'); }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('', url); });
    else window.prompt('', url);
  }
  function readHash() {
    var h = (location.hash || '').replace(/^#/, ''); if (!h) return null;
    var o = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (!o.p) return null;
    var plan = o.p.split('.').filter(function (id) { return DB.BY_ID[id]; }).slice(0, 4);
    if (!plan.length) return null;
    return o.p && { plan: plan, preset: o.f, ll: o.ll, w: o.w, sc: o.sc, c: o.c, irr: o.irr, straw: o.straw };
  }
  function applyHash(hs) {
    state.plan = hs.plan;
    if (hs.c) state.cands = hs.c.split('.').filter(function (id) { return DB.BY_ID[id]; });
    if (hs.w) {
      var ws = hs.w.split('.');
      ['w-profit', 'w-reliability', 'w-soil', 'w-water'].forEach(function (id, i) {
        if (ws[i] !== undefined) { $(id).value = ws[i]; $(id).previousElementSibling.textContent = ws[i]; }
      });
    }
    if (hs.sc && SCEN[hs.sc]) document.querySelector('input[name=sc][value=' + hs.sc + ']').checked = true;
    if (hs.irr) { $('irr').checked = true; $('quota').value = hs.irr; $('quota-wrap').hidden = false; }
    if (hs.straw === '0') $('straw').checked = false;
    renderPlan(); renderCands(); paintAllRanges();
    var after = function () { if (state.raw) run(); };
    if (hs.preset) return loadPreset(hs.preset).then(after);
    if (hs.ll) {
      var ll = hs.ll.split(','); setLocation(+ll[0], +ll[1], 6);
      status(t('loading'), 'busy');
      return Promise.all([fetchPower(state.lat, state.lon), fetchSoil(state.lat, state.lon)]).then(function (res) {
        useData(res[0], res[1], res[1] ? res[1].src : null); after();
      }).catch(function (e) { status(t('loadFail', { err: e.message }), 'err'); });
    }
  }


  /* ================================================================ round 3 features */
  function mapCtx(R) { return state.mapMode === '2050' && R.y50 ? { W: R.y50.W, user: R.y50.user } : { W: R.W, user: R.user }; }
  function lossYears(r) { return r.early.lossYears + r.late.lossYears; }
  function nYearsOf(r) { return r.early.years + r.late.years; }
  function farmYears(r) {
    var per = {};
    r.runs.forEach(function (run) { run.seasons.forEach(function (x) { (per[x.year] = per[x.year] || []).push(x); }); });
    return Object.keys(per).sort().map(function (y) {
      var ss = per[y];
      return { year: +y, m: mean(ss.map(function (x) { return x.margin; })), rev: mean(ss.map(function (x) { return x.revenue; })), cost: mean(ss.map(function (x) { return x.cost; })) };
    });
  }

  /* ---------- Climate 2050 ---------- */
  function renderY50(R) {
    var u = R.user, f = R.y50.user, n = nYearsOf(u), a = lossYears(u), b = lossYears(f);
    var html = '<div class="y50-grid"><div><h3>' + esc(t('y50Title')) + '</h3><p class="muted">' + esc(t('y50Lead')) + '</p>' +
      '<p class="y50-line">' + esc(t('y50Line', { a: a, b: b, n: n })) + '</p>' +
      '<p>' + esc(t('y50Crash', { a: pct(u.crashRate), b: pct(f.crashRate) })) + ' ' + esc(t('y50Best', { a: lossYears(R.best), b: lossYears(R.y50.best) })) + '</p>' +
      '<button type="button" class="btn ' + (state.mapMode === '2050' ? 'ghost' : 'primary') + '" id="y50-btn">' + esc(state.mapMode === '2050' ? t('y50BtnBack') : t('y50Btn')) + '</button>' +
      '<p class="small muted y50-note">' + esc(t('y50Note')) + '</p></div>' +
      '<div class="y50-dials"><div class="dial"><span>' + esc(t('y50Now')) + '</span><b data-count="' + a + '">0</b><em>' + esc(t('y50Years')) + ' / ' + n + '</em><i><s style="width:' + Math.round(a / n * 100) + '%"></s></i></div>' +
      '<div class="dial hot"><span>' + esc(t('y50Then')) + '</span><b data-count="' + b + '">0</b><em>' + esc(t('y50Years')) + ' / ' + n + '</em><i><s style="width:' + Math.round(b / n * 100) + '%"></s></i></div></div></div>';
    $('y2050').innerHTML = html;
    $('y50-btn').onclick = function () {
      state.mapMode = state.mapMode === '2050' ? 'real' : '2050';
      state.why = null;
      renderCrashMap(R); renderWhy(R); renderY50(R); FX.refresh($('y2050'));
      $('p-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  /* ---------- Soil health index ---------- */
  function renderSHI(R) {
    var h = M.soilHealthIndex(R.user), hb = M.soilHealthIndex(R.best), parts = t('shiParts');
    var col = h.value >= 60 ? 'var(--ok)' : (h.value >= 40 ? 'var(--dent)' : 'var(--crash)');
    var html = '<h3>' + esc(t('shiTitle')) + '</h3><div class="shi-top"><div class="gauge" style="--v:' + h.value + ';--c:' + col + '"><b data-count="' + h.value + '">0</b><span>/ 100</span></div>' +
      '<div class="shi-parts">';
    Object.keys(h.parts).forEach(function (k) {
      var v = h.parts[k]; if (Math.abs(v) < 0.5 && (k === 'monoculture' || k === 'fallow')) return;
      html += '<div class="sp"><span>' + esc(parts[k] || k) + '</span><i class="' + (v >= 0 ? 'up' : 'down') + '"><s style="width:' + Math.min(100, Math.abs(v) / 25 * 100) + '%"></s></i><b>' + (v > 0 ? '+' : '') + Math.round(v) + '</b></div>';
    });
    html += '</div></div><p class="small">' + esc(t('bestPlan')) + ': <b>' + hb.value + '</b> / 100</p><p class="small muted">' + esc(t('shiHint')) + '</p>';
    $('shi').innerHTML = html;
  }

  /* ---------- Insurance ---------- */
  function premium(r) {
    var ss = [];
    r.runs.forEach(function (run) { run.seasons.forEach(function (x) { if (DB.BY_ID[x.crop].harvestable) ss.push(x); }); });
    var losses = ss.map(function (x) { return Math.max(0, -x.margin); });
    var lossy = ss.filter(function (x) { return x.margin < 0; });
    return { p: ss.length ? lossy.length / ss.length : 0, el: mean(losses), cond: lossy.length ? mean(lossy.map(function (x) { return -x.margin; })) : 0 };
  }
  function renderInsurance(R) {
    var box = $('insure');
    var rate = state.kzt || 500, load = state.insLoad === undefined ? 20 : state.insLoad;
    box.innerHTML = '<h3>' + esc(t('insTitle')) + '</h3><div class="row"><label class="field"><span>' + esc(t('insRate')) + '</span><input type="number" id="ins-rate" min="1" step="5" value="' + rate + '"></label>' +
      '<label class="field"><span>' + esc(t('insLoad')) + '</span><input type="number" id="ins-load" min="0" max="100" step="5" value="' + load + '"></label></div><div id="ins-out"></div><p class="small muted">' + esc(t('insNote')) + '</p>';
    function upd() {
      state.kzt = Math.max(1, +$('ins-rate').value || 500); state.insLoad = Math.max(0, +$('ins-load').value || 0);
      var u = premium(R.user), b = premium(R.best), k = state.kzt, g = 1 + state.insLoad / 100;
      $('ins-out').innerHTML = '<p class="ins-big"><b>' + money(u.el * k) + ' ₸</b><span>/ ' + Lx('ha', 'га', 'га') + '</span></p>' +
        '<p>' + esc(t('insLine', { p: pct(u.p), l: money(u.cond * k) })) + '</p><p>' + esc(t('insFair', { f: money(u.el * k), fu: money(u.el), g: money(u.el * k * g) })) + '</p>' +
        (R.best !== R.user ? '<p>' + esc(t('insBest', { b: money(b.el * k) })) + '</p>' : '');
    }
    $('ins-rate').oninput = upd; $('ins-load').oninput = upd; upd();
  }

  /* ---------- Worst case in a row ---------- */
  function renderStreak(R) {
    var box = $('streak'), fy = farmYears(R.user);
    var worst = fy.reduce(function (a, b) { return b.m < a.m ? b : a; });
    var y0 = R.user.Y0, y1 = R.user.Y1;
    var st = state.streak && state.streak.R === R ? state.streak : { R: R, d: worst.year, from: Math.min(worst.year, y1 - 2), k: 3 };
    state.streak = st;
    var opts = function (a, b, sel) { var h = ''; for (var y = a; y <= b; y++) h += '<option' + (y === sel ? ' selected' : '') + '>' + y + '</option>'; return h; };
    box.innerHTML = '<h3>' + esc(t('stkTitle')) + '</h3><p class="muted">' + esc(t('stkLead')) + '</p>' +
      '<div class="stk-ctl"><label class="inline"><span>' + esc(t('stkYear')) + '</span><select id="stk-d">' + opts(y0, y1, st.d) + '</select></label>' +
      '<label class="inline"><span>' + esc(t('stkFrom')) + '</span><select id="stk-from">' + opts(y0, y1 - 1, st.from) + '</select></label>' +
      '<label class="inline"><select id="stk-k"><option' + (st.k === 2 ? ' selected' : '') + '>2</option><option' + (st.k === 3 ? ' selected' : '') + '>3</option><option' + (st.k === 4 ? ' selected' : '') + '>4</option></select><span>' + esc(t('stkTimes')) + '</span></label>' +
      '<button type="button" class="btn primary" id="stk-run">' + esc(t('stkRun')) + '</button></div><div id="stk-out"></div>';
    ['stk-d', 'stk-from', 'stk-k'].forEach(function (id) { $(id).style.width = 'auto'; });
    $('stk-run').onclick = function () { st.d = +$('stk-d').value; st.from = +$('stk-from').value; st.k = +$('stk-k').value; drawStreak(R, st); };
    drawStreak(R, st);
  }
  function drawStreak(R, st) {
    var k = Math.min(st.k, R.user.Y1 - st.from + 1);
    var W2 = M.repeatYear(R.W, st.d, st.from, k);
    var u2 = farmYears(M.crashTest(W2, R.soil, R.plan, Object.assign({}, R.opts)));
    var b2 = farmYears(M.crashTest(W2, R.soil, R.best.plan, Object.assign({}, R.opts)));
    var u1 = farmYears(R.user);
    function pick(arr) { return arr.filter(function (x) { return x.year >= st.from && x.year < st.from + k; }); }
    var a1 = pick(u1), a2 = pick(u2), a3 = pick(b2);
    var sum = function (arr) { return arr.reduce(function (s, x) { return s + x.m; }, 0); };
    var html = '<p class="note-strong">' + esc(t('stkLine', { d: st.d, k: k, a: st.from, b: st.from + k - 1, u: money(sum(a2)), r: money(sum(a1)), x: money(sum(a3)) })) + '</p>';
    html += '<div class="stk-bars">';
    var mx = Math.max.apply(null, a1.concat(a2, a3).map(function (x) { return Math.abs(x.m); })) || 1;
    a1.forEach(function (x, i) {
      html += '<div class="stk-year"><b>' + x.year + '</b>';
      [[x.m, 'real', t('stkCols')[1]], [a2[i] ? a2[i].m : 0, 'rep', t('stkCols')[2]], [a3[i] ? a3[i].m : 0, 'best', t('stkCols')[3]]].forEach(function (v) {
        html += '<div class="sb ' + v[1] + (v[0] < 0 ? ' neg' : '') + '"><span>' + esc(v[2]) + '</span><i><s style="width:' + (Math.abs(v[0]) / mx * 100).toFixed(1) + '%"></s></i><em>' + money(v[0]) + ' $</em></div>';
      });
      html += '</div>';
    });
    $('stk-out').innerHTML = html + '</div>';
  }

  /* ---------- Water per kilogram ---------- */
  function renderWaterKg(R) {
    var rows = [];
    var cands = uniq(R.plan.concat(state.cands)).filter(function (id) { return DB.BY_ID[id].harvestable; });
    cands.forEach(function (id) {
      var src = null;
      R.user.byPos.forEach(function (b) { if (b.crop === id) src = (src || []).concat(b.seasons); });
      if (!src) { var r = M.crashTest(R.W, R.soil, [id, 'wheat'].filter(function (x, i, a) { return a.indexOf(x) === i; }), Object.assign({}, R.opts)); src = r.byPos[0].seasons; }
      var good = src.filter(function (x) { return x.yield > 0.05; });
      var eta = mean(good.map(function (x) { return x.eta + (x.irrD || 0) * 0; })), y = mean(good.map(function (x) { return x.yield; }));
      if (y > 0) rows.push({ id: id, l: eta * 10000 / (y * 1000), eta: eta, y: y });
    });
    rows.sort(function (a, b) { return a.l - b.l; });
    var mx = rows.length ? rows[rows.length - 1].l : 1;
    var html = '<h3>' + esc(t('wfTitle')) + '</h3><p class="small muted">' + esc(t('wfLead')) + '</p><div class="wf">';
    rows.forEach(function (r) {
      html += '<div class="wf-row"><span class="rot">' + cropHTML(r.id) + '</span><i><s style="width:' + (r.l / mx * 100).toFixed(1) + '%"></s></i><b>' + money(r.l) + ' L</b></div>';
    });
    html += '</div>';
    if (rows.length > 1) html += '<p class="note-strong">' + esc(t('wfLine', { a: cropName(rows[0].id).toLowerCase(), x: money(rows[0].l), b: cropName(rows[rows.length - 1].id).toLowerCase(), y: money(rows[rows.length - 1].l) })) + '</p>';
    $('waterkg').innerHTML = html;
  }

  /* ---------- Wind erosion & Virgin Lands ---------- */
  function renderWind(R) {
    var W = R.W, years = [], vals = [];
    var from = W.lat >= 0 ? 91 : 274;
    for (var y = W.firstYear; y <= W.lastYear; y++) {
      var s0 = M.dayIndex(W, y, from); if (s0 < 0) continue;
      var c = 0; for (var k = s0; k < s0 + 91 && k < W.n; k++) if (W.ws[k] >= 6) c++;
      years.push(y); vals.push(c);
    }
    var html = '<h3>' + esc(t('wndTitle')) + '</h3><p class="small">' + esc(t('wndLead')) + '</p>' +
      '<p class="note-strong">' + esc(t('wndLine', { w: mean(vals).toFixed(0), u: R.user.erosionDays.toFixed(1), b: R.best.erosionDays.toFixed(1) })) + '</p>' +
      '<p class="small muted">' + esc(t('wndChart')) + '</p><div id="wnd-chart"></div>';
    $('wind').innerHTML = html;
    Charts.chart($('wnd-chart'), { x: years, height: 200, legend: false, series: [{ type: 'bar', name: 'days', values: vals, color: '#8a6d3b' }] });
  }

  /* ---------- Game: beat the AI ---------- */
  function renderGame(R) {
    var g = state.game && state.game.R === R ? state.game : { R: R, left: 5, best: null, plan: ['wheat', 'pea'], tries: [] };
    state.game = g;
    var ai = R.all[0];
    var html = '<div class="gm-head"><h3>' + esc(t('gmTitle')) + '</h3><span class="gm-left">' + esc(t('gmLeft', { n: g.left })) + '</span></div><p class="muted">' + esc(t('gmLead')) + '</p>';
    html += '<div class="gm-slots">';
    for (var i = 0; i < 4; i++) {
      html += '<select data-i="' + i + '"><option value="">—</option>' + DB.CROPS.map(function (c) { return '<option value="' + c.id + '"' + (g.plan[i] === c.id ? ' selected' : '') + '>' + esc(cropName(c.id)) + '</option>'; }).join('') + '</select>';
    }
    html += '<button type="button" class="btn primary" id="gm-try"' + (g.left ? '' : ' disabled') + '>' + esc(t('gmTry')) + '</button></div>';
    html += '<div class="gm-board"><div class="gm-ai"><span>AI</span><div class="rot">' + rotHTML(ai.plan) + '</div><b>' + Math.round(ai.score) + '</b></div>';
    g.tries.forEach(function (tr) {
      html += '<div class="gm-try ' + (tr.score > ai.score ? 'win' : '') + '"><span>' + esc(Lx('You', 'Вы', 'Сіз')) + '</span><div class="rot">' + rotHTML(tr.plan) + '</div><b>' + Math.round(tr.score) + '</b></div>';
    });
    html += '</div><p class="gm-msg" id="gm-msg">' + (g.msg ? esc(g.msg) : '') + '</p>';
    if (!g.left) html += '<button type="button" class="link" id="gm-again">' + esc(t('gmAgain')) + '</button>';
    $('game').innerHTML = html;
    $('game').querySelectorAll('.gm-slots select').forEach(function (sel) { sel.onchange = function () { g.plan[+sel.getAttribute('data-i')] = sel.value; }; });
    if ($('gm-again')) $('gm-again').onclick = function () { state.game = null; renderGame(R); };
    $('gm-try').onclick = function () {
      var plan = g.plan.filter(Boolean).slice(0, 4);
      if (!plan.length || !g.left) return;
      var r = M.crashTest(R.W, R.soil, plan, Object.assign({}, R.opts));
      M.scoreOne(r, R.norm);
      g.left--; g.tries.unshift({ plan: plan, score: r.score });
      var bestTry = g.tries.reduce(function (a, b) { return b.score > a.score ? b : a; });
      var s = Math.round(bestTry.score), a = Math.round(ai.score);
      if (bestTry.score > ai.score) { g.msg = t('gmWin', { s: s, a: a }); confetti($('game')); }
      else if (ai.score - bestTry.score < 3) g.msg = t('gmClose', { s: s, a: a });
      else g.msg = g.left ? t('gmScore', { s: s, a: a }) : t('gmLose', { s: s, a: a });
      renderGame(R);
    };
  }
  function confetti(host) {
    if (FX.reduce) return;
    var cols = ['#c9922e', '#3f7d4e', '#2e5e8c', '#f1c453', '#b73a2b'];
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('i'); p.className = 'confetti';
      p.style.left = (Math.random() * 100) + '%'; p.style.background = cols[i % cols.length];
      p.style.animationDelay = (Math.random() * 0.4) + 's'; p.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px'); p.style.setProperty('--r', (Math.random() * 720) + 'deg');
      host.appendChild(p);
      setTimeout(function (el) { return function () { el.remove(); }; }(p), 2600);
    }
  }

  /* ---------- Voice summary ---------- */
  function speechText(R) {
    var u = R.user, v = u.crashRate <= 0.10 ? 'PASS' : (u.crashRate <= 0.25 ? 'DAMAGE' : 'CRASH');
    var bad = farmYears(u).filter(function (x) { return x.m < 0; }).sort(function (a, b) { return a.m - b.m; }).slice(0, 3).map(function (x) { return x.year; }).sort();
    var fixTxt = t('vNoFix');
    if (R.fix) {
      var e = R.fix.edit, f;
      if (e.type === 'replace') f = t('fixReplace', { pos: e.pos + 1, to: cropName(e.to), from: cropName(e.from) });
      else if (e.type === 'insert') f = t('fixInsert', { pos: e.pos + 1, to: cropName(e.to) });
      else f = t('fixDelete', { pos: e.pos + 1, from: cropName(e.from) });
      fixTxt = t('vFix', { fix: f, n: lossYears(R.fix) });
    }
    return t('vText', { verdict: t('resTitle') + ': ' + t('verdict' + v), n: lossYears(u), m: nYearsOf(u), yrs: bad.length ? t('vYears', { list: bad.join(', ') }) : '', fix: fixTxt, y50: t('vY50', { n: lossYears(R.y50.user) }) });
  }
  function renderVoiceBtn(R) {
    if (!('speechSynthesis' in window)) return;
    var box = $('verdict'); if ($('voice-btn')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'voice'; b.id = 'voice-btn';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor"/></svg><span>' + esc(t('voice')) + '</span>';
    b.onclick = function () {
      var ss = window.speechSynthesis;
      if (ss.speaking) { ss.cancel(); b.classList.remove('on'); b.lastChild.textContent = t('voice'); return; }
      var u = new SpeechSynthesisUtterance(speechText(state.last));
      u.lang = I18N.lang === 'ru' ? 'ru-RU' : (I18N.lang === 'kk' ? 'kk-KZ' : 'en-US');
      var vs = ss.getVoices().filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf(u.lang.slice(0, 2)) === 0; });
      if (vs.length) u.voice = vs[0];
      u.rate = 1;
      u.onend = u.onerror = function () { b.classList.remove('on'); b.lastChild.textContent = t('voice'); };
      b.classList.add('on'); b.lastChild.textContent = t('voiceStop');
      ss.speak(u);
    };
    (box.firstElementChild || box).appendChild(b);
  }

  /* ---------- Field risk passport (printable page for a bank or insurer) ---------- */
  function openPassport() {
    var R = state.last; if (!R) return;
    var u = R.user, h = M.soilHealthIndex(u), pr = premium(u), k = state.kzt || 500;
    var bad = farmYears(u).filter(function (x) { return x.m < 0; }).sort(function (a, b) { return a.m - b.m; }).slice(0, 5);
    var fixTxt = t('fixNone');
    if (R.fix) {
      var e = R.fix.edit;
      fixTxt = e.type === 'replace' ? t('fixReplace', { pos: e.pos + 1, to: cropName(e.to), from: cropName(e.from) }) : (e.type === 'insert' ? t('fixInsert', { pos: e.pos + 1, to: cropName(e.to) }) : t('fixDelete', { pos: e.pos + 1, from: cropName(e.from) }));
    }
    var preset = (window.PRESETS || []).filter(function (p) { return p.id === state.presetId; })[0];
    var place = (preset ? (preset.name[I18N.lang] || preset.name.en) + ', ' : '') + state.lat.toFixed(3) + ', ' + state.lon.toFixed(3);
    var row = function (a, b) { return '<tr><th>' + esc(a) + '</th><td>' + b + '</td></tr>'; };
    var html = '<!doctype html><html lang="' + I18N.lang + '"><head><meta charset="utf-8"><title>' + esc(t('ppTitle')) + '</title><style>' +
      'body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#18222c;max-width:760px;margin:24px auto;padding:0 20px}h1{font-size:26px;margin:0}h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #c9922e;padding-bottom:4px}' +
      'table{border-collapse:collapse;width:100%}th{text-align:left;width:34%;color:#5a6670;font-weight:600;padding:6px 8px;vertical-align:top}td{padding:6px 8px}tr+tr th,tr+tr td{border-top:1px solid #e6eae5}' +
      '.k{display:flex;gap:10px;margin:14px 0}.k div{flex:1;border:1px solid #d5dbd4;border-radius:8px;padding:10px}.k b{display:block;font-size:22px}.k span{color:#5a6670;font-size:12px}.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #13283b;padding-bottom:10px}' +
      '.foot{color:#5a6670;font-size:12px;margin-top:26px}@media print{body{margin:0}}</style></head><body>' +
      '<div class="head"><div><h1>' + esc(t('ppTitle')) + '</h1><div>' + esc(t('ppFor')) + '</div></div><div>' + esc(t('title')) + '</div></div>' +
      '<div class="k"><div><span>' + esc(t('verdictPASS').length ? t('pillarReliability') : '') + '</span><b>' + pct(u.crashRate) + '%</b><span>' + esc(t('crash')) + '</span></div>' +
      '<div><span>' + esc(t('insTitle')) + '</span><b>' + money(pr.el * k) + ' ₸/' + Lx('ha', 'га', 'га') + '</b><span>' + esc(t('insLine', { p: pct(pr.p), l: money(pr.cond * k) })) + '</span></div>' +
      '<div><span>' + esc(t('shiTitle')) + '</span><b>' + h.value + ' / 100</b><span>' + esc(t('y50Title')) + ': ' + lossYears(R.y50.user) + ' / ' + nYearsOf(u) + '</span></div></div>' +
      '<h2>' + esc(t('ppField')) + '</h2><table>' + row(t('ppField'), esc(place)) + row(t('soil'), esc(t('clay')) + ' ' + R.soil.clay + ', ' + esc(t('sand')) + ' ' + R.soil.sand + ', ' + esc(t('soc')) + ' ' + R.soil.socGkg) +
      row(t('irrigation'), R.opts.irrigation ? R.opts.quota + ' mm' : '—') + '</table>' +
      '<h2>' + esc(t('ppPlan')) + '</h2><table>' + row(t('ppPlan'), esc(planText(R.plan))) + row(t('pillarProfit'), money(u.meanMargin) + ' $/ha') + row(t('altCols')[5], money(u.p10Margin) + ' $/ha') +
      row(t('y50Now'), lossYears(u) + ' / ' + nYearsOf(u) + ' ' + esc(t('y50Years'))) + row(t('y50Then'), lossYears(R.y50.user) + ' / ' + nYearsOf(u) + ' ' + esc(t('y50Years'))) + '</table>' +
      '<h2>' + esc(t('ppWorst')) + '</h2><table>' + bad.map(function (x) { return row(String(x.year), money(x.m) + ' $/ha'); }).join('') + '</table>' +
      '<h2>' + esc(t('ppRec')) + '</h2><p>' + esc(fixTxt) + (R.fix ? ' ' + esc(t('fixGain', { c1: pct(u.crashRate), c2: pct(R.fix.crashRate), m1: money(u.meanMargin), m2: money(R.fix.meanMargin), s1: signed(u.socChangePct) + '%', s2: signed(R.fix.socChangePct) + '%' })) : '') + '</p>' +
      '<p class="foot">' + esc(t('ppGenerated', { d: new Date().toISOString().slice(0, 10) })) + '</p><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) { FX.toast('Pop-up blocked'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }


  /* ================================================================ round 4: race, futures, regions */
  /* ---------- Money race ---------- */
  function renderRace(R) {
    var box = $('race'), a = farmYears(R.best), b = farmYears(R.user);
    var html = '<div class="race-head"><div><h3>' + esc(t('raceTitle')) + '</h3><p class="muted">' + esc(t('raceLead')) + '</p></div>' +
      '<button type="button" class="btn primary" id="race-play">' + esc(t('racePlay')) + '</button></div>' +
      '<div class="race-board"><div class="race-tag you"><span>' + esc(t('yourPlan')) + '</span><b id="race-you">0</b></div>' +
      '<div class="race-year" id="race-year">' + b[0].year + '</div>' +
      '<div class="race-tag ai"><span>' + esc(t('bestPlan')) + '</span><b id="race-ai">0</b></div></div>' +
      '<svg class="race-svg" id="race-svg" viewBox="0 0 900 300" preserveAspectRatio="none" role="img" aria-label="' + esc(t('raceTitle')) + '"></svg>' +
      '<p class="note-strong" id="race-end"></p>';
    box.innerHTML = html;
    var cumA = [], cumB = [], sa = 0, sb = 0;
    a.forEach(function (x, i) { sa += x.m; sb += b[i] ? b[i].m : 0; cumA.push(sa); cumB.push(sb); });
    var lo = Math.min(0, Math.min.apply(null, cumA.concat(cumB))), hi = Math.max.apply(null, cumA.concat(cumB, [1]));
    var n = cumA.length, svg = $('race-svg'), NS = 'http://www.w3.org/2000/svg';
    function X(i) { return 20 + i / (n - 1) * 860; }
    function Y(v) { return 280 - (v - lo) / (hi - lo) * 260; }
    function mk(tag, at) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); svg.appendChild(e); return e; }
    mk('line', { x1: 20, x2: 880, y1: Y(0), y2: Y(0), class: 'race-zero' });
    var pa = mk('path', { class: 'race-ai', d: '' }), pb = mk('path', { class: 'race-you', d: '' });
    var da = mk('circle', { r: 6, class: 'race-dot ai' }), db = mk('circle', { r: 6, class: 'race-dot you' });
    // red flashes for crash years of your rotation
    var marks = mk('g', { class: 'race-marks' });
    function draw(k) {
      var i = Math.floor(k), f = k - i, dA = '', dB = '';
      for (var j = 0; j <= i && j < n; j++) { dA += (j ? 'L' : 'M') + X(j).toFixed(1) + ',' + Y(cumA[j]).toFixed(1); dB += (j ? 'L' : 'M') + X(j).toFixed(1) + ',' + Y(cumB[j]).toFixed(1); }
      var vA = cumA[Math.min(i, n - 1)], vB = cumB[Math.min(i, n - 1)], xP = X(Math.min(i, n - 1));
      if (i < n - 1 && f > 0) { vA = cumA[i] + (cumA[i + 1] - cumA[i]) * f; vB = cumB[i] + (cumB[i + 1] - cumB[i]) * f; xP = X(i) + (X(i + 1) - X(i)) * f; dA += 'L' + xP.toFixed(1) + ',' + Y(vA).toFixed(1); dB += 'L' + xP.toFixed(1) + ',' + Y(vB).toFixed(1); }
      pa.setAttribute('d', dA); pb.setAttribute('d', dB);
      da.setAttribute('cx', xP); da.setAttribute('cy', Y(vA)); db.setAttribute('cx', xP); db.setAttribute('cy', Y(vB));
      $('race-ai').textContent = money(vA); $('race-you').textContent = money(vB);
      $('race-year').textContent = a[Math.min(i, n - 1)].year;
    }
    function finish() {
      var d = cumA[n - 1] - cumB[n - 1];
      $('race-end').textContent = d > 0 ? t('raceEnd', { n: n, d: money(d), a: money(cumA[n - 1]), b: money(cumB[n - 1]) }) : t('raceEndYou', { n: n, a: money(cumA[n - 1]), b: money(cumB[n - 1]) });
      $('race-play').textContent = t('raceAgain');
    }
    var anim = null;
    function play() {
      if (anim) cancelAnimationFrame(anim);
      while (marks.firstChild) marks.removeChild(marks.firstChild);
      $('race-end').textContent = '';
      if (FX.reduce) { draw(n - 1); finish(); return; }
      var t0 = null, dur = 7000, flashed = {};
      function step(ts) {
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur) * (n - 1);
        draw(k);
        var i = Math.floor(k);
        if (b[i] && b[i].rev < 0.5 * b[i].cost && !flashed[i]) {
          flashed[i] = 1;
          var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(cumB[i])); c.setAttribute('r', 5); c.setAttribute('class', 'race-crash');
          marks.appendChild(c);
        }
        if (k < n - 1) anim = requestAnimationFrame(step); else finish();
      }
      anim = requestAnimationFrame(step);
    }
    $('race-play').onclick = play;
    draw(0);
    // auto-play the first time the race scrolls into view
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); setTimeout(play, 300); } }, { threshold: 0.4 });
      io.observe(box);
    } else { draw(n - 1); finish(); }
  }

  /* ---------- 10-year futures (bootstrap of real years) ---------- */
  function futures(r, N, horizon, seed) {
    var ys = farmYears(r).map(function (x) { return x.m; });
    var s = seed || 12345;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    var out = new Float64Array(N);
    for (var i = 0; i < N; i++) { var sum = 0; for (var k = 0; k < horizon; k++) sum += ys[Math.floor(rnd() * ys.length)]; out[i] = sum; }
    var sorted = Array.prototype.slice.call(out).sort(function (a, b) { return a - b; });
    return { all: sorted, pNeg: sorted.filter(function (v) { return v < 0; }).length / N, median: sorted[Math.floor(N / 2)], q10: sorted[Math.floor(N * 0.1)] };
  }
  function renderMC(R) {
    var N = 5000, H = 10;
    var u = futures(R.user, N, H, 7), u5 = futures(R.y50.user, N, H, 7), b = futures(R.best, N, H, 7), b5 = futures(R.y50.best, N, H, 7);
    var html = '<h3>' + esc(t('mcTitle')) + '</h3><p class="small muted">' + esc(t('mcLead')) + '</p>' +
      '<div class="mc-gauges">' + gauge(t('mcYours') + ' · ' + t('mcNow'), u.pNeg) + gauge(t('mcYours') + ' · ' + t('mc50'), u5.pNeg, 'hot') +
      gauge(t('mcBest') + ' · ' + t('mcNow'), b.pNeg, 'best') + gauge(t('mcBest') + ' · ' + t('mc50'), b5.pNeg, 'best hot') + '</div>' +
      '<div id="mc-hist"></div>' +
      '<p class="note-strong">' + esc(t('mcLine', { p: pct(u.pNeg), p50: pct(u5.pNeg), b: pct(b.pNeg), b50: pct(b5.pNeg) })) + '</p>' +
      '<p class="small">' + esc(t('mcMedian', { m: money(u.median), q: money(u.q10) })) + '</p>';
    $('mc').innerHTML = html;
    // histogram of 10-year outcomes: yours vs best
    var lo = Math.min(u.all[0], b.all[0]), hi = Math.max(u.all[N - 1], b.all[N - 1]), bins = 24, w = (hi - lo) / bins || 1;
    function hist(arr) { var h = new Array(bins).fill(0); arr.forEach(function (v) { h[Math.min(bins - 1, Math.floor((v - lo) / w))]++; }); return h; }
    var hu = hist(u.all), hb = hist(b.all), xs = [];
    for (var i = 0; i < bins; i++) xs.push(Math.round(lo + (i + 0.5) * w));
    Charts.chart($('mc-hist'), { x: xs, height: 190, series: [
      { type: 'bar', name: t('mcYours'), values: hu, color: function (v, i) { return xs[i] < 0 ? '#b73a2b' : '#2e5e8c'; }, legendColor: '#2e5e8c', title: function (i) { return xs[i] + ' $/ha: ' + hu[i]; } },
      { type: 'line', name: t('mcBest'), values: hb, color: '#3f7d4e', dots: false }
    ] });
  }
  function gauge(label, p, cls) {
    return '<div class="mcg ' + (cls || '') + '"><div class="ring" style="--p:' + Math.round(p * 100) + '"><b data-count="' + Math.round(p * 100) + '" data-suffix="%">0%</b></div><span>' + esc(label) + '</span></div>';
  }

  /* ---------- Regions of Kazakhstan ---------- */
  var regionMap = null;
  function renderRegions(R) {
    var box = $('regions');
    box.innerHTML = '<h3>' + esc(t('regTitle')) + '</h3><p class="small muted">' + esc(t('regLead')) + '</p>' +
      '<button type="button" class="btn primary" id="reg-run">' + esc(t('regRun')) + '</button><div id="reg-out"></div>';
    $('reg-run').onclick = function () { runRegions(R); };
    if (state.regions && state.regions.R === R) drawRegions(R, state.regions.rows);
  }
  function runRegions(R) {
    var list = (window.PRESETS || []);
    $('reg-out').innerHTML = '<p class="muted">' + esc(t('regLoading')) + '</p><i class="skel"></i><i class="skel" style="width:70%"></i>';
    Promise.all(list.map(function (p) { return getPreset(p.id); })).then(function (all) {
      var rows = all.map(function (P, i) {
        var W = M.prepareWeather(P.weather, P.lat);
        var r = M.crashTest(W, P.soil || DEFAULT_SOIL, R.plan, Object.assign({}, R.opts));
        return { p: list[i], loss: lossYears(r), n: nYearsOf(r), crash: r.crashRate, m: r.meanMargin };
      }).sort(function (a, b) { return a.loss / a.n - b.loss / b.n; });
      state.regions = { R: R, rows: rows };
      if (state.last === R) drawRegions(R, rows);
    }).catch(function (e) { $('reg-out').textContent = e.message; });
  }
  function drawRegions(R, rows) {
    var name = function (p) { return p.name[I18N.lang] || p.name.en; };
    var html = '<div id="reg-map" class="reg-map"></div><div class="reg-list">';
    rows.forEach(function (r, i) {
      var share = r.loss / r.n, col = share < 0.2 ? 'var(--ok)' : (share < 0.4 ? 'var(--dent)' : 'var(--crash)');
      html += '<div class="reg-row" style="animation-delay:' + (i * 70) + 'ms"><span class="reg-dot" style="background:' + col + '"></span><span class="reg-name">' + esc(name(r.p)) + '</span>' +
        '<i><s style="width:' + Math.round(share * 100) + '%;background:' + col + '"></s></i><b>' + r.loss + '/' + r.n + '</b><em>' + money(r.m) + ' $</em></div>';
    });
    var kzRows = rows.filter(function (r) { return r.p.lon > 40 && r.p.lon < 90 && r.p.lat > 38; });
    if (kzRows.length > 1) html += '</div><p class="note-strong">' + esc(t('regBest', { a: name(kzRows[0].p), b: name(kzRows[kzRows.length - 1].p) })) + '</p>';
    else html += '</div>';
    $('reg-out').innerHTML = html;
    $('reg-run').hidden = true;
    if (typeof L === 'undefined') { $('reg-map').style.display = 'none'; return; }
    if (regionMap) { regionMap.remove(); regionMap = null; }
    regionMap = L.map('reg-map', { scrollWheelZoom: false, zoomControl: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 10, attribution: '&copy; OpenStreetMap' }).addTo(regionMap);
    var pts = [];
    rows.forEach(function (r) {
      var share = r.loss / r.n, col = share < 0.2 ? '#3f7d4e' : (share < 0.4 ? '#dca72a' : '#b73a2b');
      L.circleMarker([r.p.lat, r.p.lon], { radius: 9 + share * 16, color: '#13283b', weight: 2, fillColor: col, fillOpacity: 0.9 })
        .bindTooltip(name(r.p) + ': ' + r.loss + '/' + r.n).addTo(regionMap);
      pts.push([r.p.lat, r.p.lon]);
    });
    var kz = pts.filter(function (p) { return p[1] > 40; });
    regionMap.fitBounds(kz.length ? kz : pts, { padding: [30, 30] });
  }

  /* ---------------------------------------------------------------- CSV: one reproducible calculation */
  function downloadCSV() {
    var R = state.last; if (!R) return;
    var W = R.W;
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [
      '# Crop Rotation Crash Test - season-by-season calculation',
      '# Weather: NASA POWER daily API (community AG), lat ' + state.lat + ', lon ' + state.lon + ', scenario ' + R.sc,
      '# Soil: clay ' + R.soil.clay + '%, sand ' + R.soil.sand + '%, organic carbon ' + R.soil.socGkg + ' g/kg',
      '# Rotation: ' + R.plan.join(' > ') + '; irrigation ' + (R.opts.irrigation ? R.opts.quota + ' mm' : 'no') + '; straw left ' + (R.opts.straw ? 'yes' : 'no'),
      '# Prices USD/t and costs USD/ha used: ' + uniq(R.plan).map(function (id) { var c = DB.BY_ID[id]; return id + ' ' + c.price + '/' + c.cost; }).join('; '),
      '# start = which plan year was grown first (the plan is tested from every start)',
      ['start', 'year', 'plan_year', 'crop', 'sowing_date', 'harvest_date', 'season_rain_mm', 'soil_water_at_sowing_mm', 'irrigation_net_mm',
        'water_need_ETc_mm', 'water_used_ETa_mm', 'water_met_pct', 'reference_ET0_mm', 'heat_days_flowering', 'yield_t_ha', 'relative_yield',
        'revenue_usd_ha', 'cost_usd_ha', 'profit_usd_ha', 'outcome', 'main_cause'].join(',')
    ];
    R.user.runs.forEach(function (run) {
      run.seasons.forEach(function (s) {
        lines.push([run.phase + 1, s.year, s.pos + 1, s.crop, s.sowDay >= 0 ? dateStr(W, s.sowDay) : '', dateStr(W, s.harvestDay),
          s.rain.toFixed(0), s.store.toFixed(0), s.irrD.toFixed(0), s.etc.toFixed(0), s.eta.toFixed(0), s.etc > 0 ? Math.round(s.eta / s.etc * 100) : '',
          s.et0s.toFixed(0), s.heatDays, s.yield.toFixed(2), s.rel.toFixed(2), s.revenue.toFixed(0), s.cost.toFixed(0), s.margin.toFixed(0),
          s.outcome, s.outcome === 'crash' || s.outcome === 'dent' ? s.cause : ''].map(q).join(','));
      });
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crash-test-' + R.plan.join('-') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------------------------------------------------------- satellite compare */
  function initCompare() {
    var r = $('cmp-range'), top = $('cmp-top'), h = $('cmp-handle'), img = top.querySelector('img');
    function upd() { top.style.clipPath = 'inset(0 ' + (100 - r.value) + '% 0 0)'; h.style.left = r.value + '%'; }
    r.oninput = upd; upd(); void img;
    if ('IntersectionObserver' in window && !FX.reduce) {
      var once = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        once.disconnect();
        var keys = [[0, 50], [700, 14], [1500, 86], [2300, 50]], t0 = null;
        function step(ts) {
          if (t0 === null) t0 = ts;
          var el = ts - t0, i = 1;
          while (i < keys.length - 1 && el > keys[i][0]) i++;
          var a = keys[i - 1], b = keys[i], k = Math.min(1, Math.max(0, (el - a[0]) / (b[0] - a[0])));
          k = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          r.value = a[1] + (b[1] - a[1]) * k; upd();
          if (el < keys[keys.length - 1][0]) requestAnimationFrame(step);
        }
        setTimeout(function () { requestAnimationFrame(step); }, 400);
      }, { threshold: 0.5 });
      once.observe($('compare'));
    }
    $('btn-kyz').onclick = function () {
      $('irr').checked = true; $('quota-wrap').hidden = false;
      loadPreset('kyzylorda').then(function () { $('step-farm').scrollIntoView({ behavior: 'smooth' }); });
    };
  }

  /* ---------------------------------------------------------------- decoration */
  function paintRange(inp) {
    var min = +inp.min || 0, max = +inp.max || 100;
    inp.style.setProperty('--fill', ((+inp.value - min) / (max - min) * 100) + '%');
  }
  function paintAllRanges() { document.querySelectorAll('input[type=range]').forEach(paintRange); }
  function drawFurrows() {
    // field rows converging to a horizon point: the hero's background
    var g = $('furrow-lines'); if (!g) return;
    var ns = 'http://www.w3.org/2000/svg', vx = 900, vy = 40;
    for (var i = -30; i <= 30; i++) {
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', vx + i * 6); l.setAttribute('y1', vy);
      l.setAttribute('x2', vx + i * 70); l.setAttribute('y2', 600);
      g.appendChild(l);
    }
  }

  /* ---------------------------------------------------------------- wiring */
  function initRunbar() {
    var bar = $('runbar'), vis = { run: false, results: false, hero: true };
    function upd() {
      var on = !!state.raw && !vis.run && !vis.results && !vis.hero && !state.running;
      bar.classList.toggle('on', on); bar.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    $('rb-run').onclick = function () { run(); };
    if (!('IntersectionObserver' in window)) return;
    [['run', $('btn-run')], ['results', $('results')], ['hero', document.querySelector('.hero')]].forEach(function (pair) {
      new IntersectionObserver(function (es) { vis[pair[0]] = es[0].isIntersecting; upd(); }).observe(pair[1]);
    });
    setInterval(upd, 1000);
  }

  function init() {
    HeroField.intro();
    drawFurrows();
    var hero = document.querySelector('.hero');
    hero.addEventListener('mousemove', function (e) { var r = hero.getBoundingClientRect(); hero.style.setProperty('--mx', (e.clientX - r.left) + 'px'); hero.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    FX.initChrome();
    initRunbar();
    FX.spy(document.querySelectorAll('.nav a'));
    FX.spy(document.querySelectorAll('.subnav a'));
    ['lat', 'lon'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') loadLive(); }); });
    document.addEventListener('input', function (e) { if (e.target.type === 'range') paintRange(e.target); });
    document.querySelectorAll('.lang button').forEach(function (b) { b.onclick = function () { I18N.set(b.getAttribute('data-lang')); applyI18n(); }; });
    document.querySelectorAll('.sliders input').forEach(function (inp) {
      var out = inp.previousElementSibling, upd = function () { out.textContent = inp.value; };
      inp.oninput = upd; upd();
    });
    $('irr').onchange = function () { $('quota-wrap').hidden = !$('irr').checked; };
    ['clay', 'sand', 'socg'].forEach(function (id) { $(id).onchange = readSoil; });
    $('btn-load').onclick = loadLive;
    $('btn-run').onclick = run;
    $('btn-print').onclick = function () { window.print(); };
    $('btn-csv').onclick = downloadCSV;
    $('btn-share').onclick = shareLink;
    $('btn-passport').onclick = openPassport;
    ['farm-area', 'farm-carbon'].forEach(function (id) { $(id).oninput = function () { if (state.last) renderFarm(state.last); }; });
    initMap();
    initCompare();
    applyI18n();
    paintAllRanges();
    FX.observe();
    document.querySelectorAll('#ribbon [data-count]').forEach(FX.countUp);
    var hs = readHash();
    if (hs) applyHash(hs); else loadPreset('akmola');
    renderHeroStrip();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
