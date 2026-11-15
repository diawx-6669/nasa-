/*
 * Crop Rotation Crash Test — simulation model.
 *
 * Daily, process-light model driven by NASA POWER daily weather:
 *  - Reference evapotranspiration ET0: FAO-56 Penman-Monteith (Allen et al. 1998).
 *  - Two-layer soil water balance (root zone + subsoil, profile 1.8 m) with SCS curve-number runoff,
 *    FAO-56 water-stress coefficient Ks and two-stage bare-soil evaporation.
 *  - Snow pack (degree-day melt) with stubble-dependent snow trapping — important in the steppe.
 *  - Crop phenology by growing degree days; FAO-33 yield response to water (Ky);
 *    heat-at-flowering, frost, winter-kill and "did not mature" penalties.
 *  - Rotation effects: legume / fallow nitrogen credit, disease penalty when a crop returns too soon.
 *  - Soil organic carbon: simplified ICBM-type one-pool balance (humified residue inputs vs.
 *    climate-driven decomposition).
 *
 * Everything is deliberately simple and transparent. It is a decision-support "stress test",
 * not a calibrated crop model — see docs/METHODOLOGY.md.
 */
(function (root) {
  'use strict';

  var CropDB = (typeof module !== 'undefined' && module.exports) ? require('./crops.js') : root.CropDB;

  var ZP = 1.8;      // soil profile depth considered (m)
  var ZTOP = 0.3;    // minimum "active" (root / evaporation) layer (m)
  var REW = 9, TEW = 25; // readily / total evaporable water of the surface layer (mm)

  /* ------------------------------------------------------------------ */
  /* Weather preparation                                                  */
  /* ------------------------------------------------------------------ */

  function satVP(t) { return 0.6108 * Math.exp(17.27 * t / (t + 237.3)); }

  function et0PM(tmax, tmin, rh, u2, rs, lat, doy, z) {
    var t = (tmax + tmin) / 2;
    var delta = 4098 * satVP(t) / Math.pow(t + 237.3, 2);
    var P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
    var gamma = 0.000665 * P;
    var es = (satVP(tmax) + satVP(tmin)) / 2;
    var ea = es * Math.max(5, Math.min(100, rh)) / 100;
    var phi = lat * Math.PI / 180;
    var dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
    var dec = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
    var x = -Math.tan(phi) * Math.tan(dec);
    var ws = Math.acos(Math.max(-1, Math.min(1, x)));
    var Ra = 24 * 60 / Math.PI * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
    var Rso = Math.max(0.1, (0.75 + 2e-5 * z) * Ra);
    var Rns = 0.77 * rs;
    var ratio = Math.max(0.3, Math.min(1, rs / Rso));
    var Rnl = 4.903e-9 * (Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2 *
      (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * ratio - 0.35);
    var Rn = Rns - Rnl;
    var et0 = (0.408 * delta * Rn + gamma * 900 / (t + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2));
    return Math.max(0, et0);
  }

  function extraterrestrial(lat, doy) {
    var phi = lat * Math.PI / 180;
    var dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
    var dec = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
    var ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
    return 24 * 60 / Math.PI * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
  }
  function hargreavesRs(tx, tn, lat, doy) { return 0.16 * Math.sqrt(Math.max(0, tx - tn)) * extraterrestrial(lat, doy); }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  /**
   * raw: {start:'YYYYMMDD', n, elev, T2M_MAX:[], T2M_MIN:[], PRECTOTCORR:[], ALLSKY_SFC_SW_DWN:[], RH2M:[], WS2M:[], GWETROOT:[]}
   * scenario: {dT: °C added to temperatures, pFactor: multiplier for precipitation}
   */
  function prepareWeather(raw, lat, scenario) {
    scenario = scenario || { dT: 0, pFactor: 1 };
    var n = raw.n || raw.T2M_MAX.length;
    var y = +raw.start.slice(0, 4), m = +raw.start.slice(4, 6), d = +raw.start.slice(6, 8);
    var mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var doy0 = d; for (var i = 0; i < m - 1; i++) doy0 += mdays[i] + (i === 1 && isLeap(y) ? 1 : 0);
    var W = {
      n: n, lat: lat, elev: raw.elev || 0,
      year: new Int16Array(n), doy: new Int16Array(n),
      tmax: new Float32Array(n), tmin: new Float32Array(n), tmean: new Float32Array(n),
      prec: new Float32Array(n), et0: new Float32Array(n), ws: new Float32Array(n),
      gwr: new Float32Array(n), rad: new Float32Array(n), rh: new Float32Array(n), fT: new Float32Array(n), t10: new Float32Array(n)
    };
    var yy = y, dd = doy0;
    var last = { tmax: 10, tmin: 0, p: 0, rs: 10, rh: 60, ws: 2, g: NaN };
    function val(arr, i, key) {
      var v = arr ? arr[i] : null;
      if (v === null || v === undefined || v === -999 || isNaN(v)) return last[key];
      last[key] = v; return v;
    }
    for (var k = 0; k < n; k++) {
      W.year[k] = yy; W.doy[k] = dd;
      var tx = val(raw.T2M_MAX, k, 'tmax') + scenario.dT;
      var tn = val(raw.T2M_MIN, k, 'tmin') + scenario.dT;
      if (tn > tx) { var tt = tn; tn = tx; tx = tt; }
      var p = Math.max(0, val(raw.PRECTOTCORR, k, 'p')) * scenario.pFactor;
      // POWER solar radiation starts in 1984: before that use the FAO-56 Hargreaves estimate (eq. 50)
      var rsRaw = raw.ALLSKY_SFC_SW_DWN ? raw.ALLSKY_SFC_SW_DWN[k] : null;
      var rs = (rsRaw === null || rsRaw === undefined || rsRaw === -999) ? hargreavesRs(tx, tn, lat, dd) : Math.max(0, rsRaw);
      var rh = val(raw.RH2M, k, 'rh');
      var u2 = Math.max(0.3, val(raw.WS2M, k, 'ws'));
      var g = raw.GWETROOT ? raw.GWETROOT[k] : null;
      W.tmax[k] = tx; W.tmin[k] = tn; W.tmean[k] = (tx + tn) / 2; W.prec[k] = p;
      W.rad[k] = rs; W.rh[k] = rh; W.ws[k] = u2;
      W.gwr[k] = (g === null || g === undefined || g === -999) ? NaN : g;
      W.et0[k] = et0PM(tx, tn, rh, u2, rs, lat, dd, W.elev);
      var tm = W.tmean[k];
      W.fT[k] = tm > -3.8 ? Math.min(1.6, (tm + 3.8) * (tm + 3.8) / 1142.44) : 0;
      dd++;
      if (dd > (isLeap(yy) ? 366 : 365)) { dd = 1; yy++; }
    }
    // 10-day running mean temperature (sowing triggers)
    var run = 0;
    for (k = 0; k < n; k++) {
      run += W.tmean[k];
      if (k >= 10) run -= W.tmean[k - 10];
      W.t10[k] = run / Math.min(10, k + 1);
    }
    W.firstYear = W.year[0];
    W.lastYear = W.year[n - 1];
    // index of Jan 1 for every year (and day index lookup)
    W.yearStart = {};
    for (k = 0; k < n; k++) if (W.doy[k] === 1 || k === 0) W.yearStart[W.year[k]] = k - (W.doy[k] - 1);
    // only treat a year as complete if the data reaches Dec 31
    if (W.doy[n - 1] < 365) W.lastYear--;
    return W;
  }

  function dayIndex(W, year, doy) {
    var s = W.yearStart[year];
    if (s === undefined) return -1;
    return s + doy - 1;
  }

  /* ------------------------------------------------------------------ */
  /* Soil                                                                 */
  /* ------------------------------------------------------------------ */

  /** Saxton & Rawls (2006) pedotransfer: field capacity / wilting point from sand, clay, OM. */
  function soilHydraulics(soil) {
    var S = Math.max(0.02, Math.min(0.95, soil.sand / 100));
    var C = Math.max(0.02, Math.min(0.6, soil.clay / 100));
    var OM = Math.max(0.2, Math.min(8, soil.socGkg / 10 * 1.724)); // % organic matter, capped (equation validity)
    var t1500t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
    var wp = t1500t + (0.14 * t1500t - 0.02);
    var t33t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
    var fc = t33t + (1.283 * t33t * t33t - 0.374 * t33t - 0.015);
    var awc = Math.max(0.06, Math.min(0.25, fc - wp)); // m3/m3
    var cnBare = S > 0.6 ? 72 : (C > 0.4 ? 86 : 80);
    var bd = soil.bd || 1.3;
    var socStock = soil.socGkg / 1000 * bd * 1000 * 0.3 * 10; // t C/ha in 0-30 cm
    return { fc: fc, wp: wp, awc: awc, awcMm: awc * 1000, cnBare: cnBare, socStock: socStock };
  }

  /* ------------------------------------------------------------------ */
  /* Rotation effects derived from the plan structure                     */
  /* ------------------------------------------------------------------ */

  function rotationEffects(plan) {
    var L = plan.length;
    return plan.map(function (id, i) {
      var c = CropDB.BY_ID[id];
      var prev = CropDB.BY_ID[plan[(i - 1 + L) % L]];
      var eff = { factor: 1, disease: 0, nCredit: 0, notes: [] };
      if (c.fallow) return eff;
      // distance (years) to the previous occurrence of the same crop in the repeating cycle
      var dist = L;
      for (var k = 1; k <= L; k++) if (plan[(i - k + L) % L] === id) { dist = k; break; }
      if (c.minReturn > 1 && dist < c.minReturn) {
        var pen = c.group === 'cereal' ? 0.10 : 0.25;
        eff.disease += pen; eff.notes.push('return');
      } else if (c.group === 'cereal' && dist === 1) {
        eff.disease += 0.10; eff.notes.push('mono');   // e.g. wheat after wheat: root rots, weeds
      } else if (c.group === 'cereal' && prev.group === 'cereal' && !c.fallow) {
        eff.disease += 0.05; eff.notes.push('cereal-cereal');
      }
      if (prev.id !== id && prev.breakBonus) { eff.factor += prev.breakBonus; eff.notes.push('break'); }
      if (prev.id !== id) eff.nCredit = prev.nCredit || 0;
      return eff;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Core simulation                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Simulate one rotation plan through the weather record.
   * plan: array of crop ids (1-4), repeated cyclically. phase: which plan position is grown in the first year.
   * opts: {irrigation: bool, quota: mm per season (net), straw: bool (straw left on field), crops: overrides}
   */
  function simulate(W, soilIn, plan, opts) {
    opts = opts || {};
    var phase = opts.phase || 0;
    var crops = opts.crops || CropDB.BY_ID;
    var econ = opts.econ || CropDB.ECON;
    var detail = !!opts.detail;
    var hyd = soilHydraulics(soilIn);
    var AWC = hyd.awcMm;              // mm per m
    var south = W.lat < 0;
    var shift = south ? 182 : 0;
    var L = plan.length;
    var rot = rotationEffects(plan);
    var strawFrac = opts.straw === false ? 0.3 : 0.85;

    // --- state
    var za = ZTOP;                     // depth of upper (active / root) layer (m)
    var WA = 0.6 * AWC * za;           // available water upper layer (mm)
    var WB = 0.6 * AWC * (ZP - za);    // available water lower layer (mm)
    var snow = 0, De = 0;
    var cover = 0.5, snowTrap = 0.7, tilledBare = false;
    var soc = hyd.socStock;
    var socTrack = [];

    // first simulated slot year is firstYear+1 (first year = spin-up of soil water)
    var Y0 = W.firstYear + 1;
    var nSlots = W.lastYear - Y0 + 1;
    var seasons = [];
    var fieldFree = 0;      // day index when the field becomes free
    var day = 0;
    var dailyWet = detail ? new Float32Array(W.n) : null;

    var yearAgg = {};       // per calendar year: decomposition factor, erosion days, cover days, C input
    function ya(y) {
      var a = yearAgg[y];
      if (!a) a = yearAgg[y] = { dec: 0, nd: 0, eros: 0, bareDays: 0, cIn: 0, live: 0 };
      return a;
    }

    function waterBalanceDay(k, crop, s) {
      var tmean = W.tmean[k], p = W.prec[k], et0 = W.et0[k];
      var Y = W.year[k];
      var A = ya(Y);
      var TAWA = AWC * za, TAWB = AWC * (ZP - za);
      // --- snow
      var rain = 0, melt = 0;
      if (tmean <= 0.5) snow += p * snowTrap; else rain = p;
      if (snow > 0 && tmean > 0) {
        melt = Math.min(snow, 3.5 * tmean);
        snow -= melt;
      }
      // frozen-ground melt runoff: 35 % of meltwater lost
      var infil = melt * 0.65;
      // rain runoff (SCS curve number), canopy/residue lowers CN
      var canopy = s && s.sown ? Math.min(1, s.f / 0.45) : 0;
      var cv = Math.max(cover, canopy);
      var CN = hyd.cnBare - 8 * cv;
      var Ss = 25400 / CN - 254;
      var Q = rain > 0.2 * Ss ? Math.pow(rain - 0.2 * Ss, 2) / (rain + 0.8 * Ss) : 0;
      infil += rain - Q;
      // fill upper layer, overflow to lower, then deep drainage
      WA += infil;
      if (rain > 3 || melt > 3) De = Math.max(0, De - rain - melt);
      if (WA > TAWA) { WB += WA - TAWA; WA = TAWA; }
      if (WB > TAWB) { WB = TAWB; }

      // --- evapotranspiration
      var ETc = 0, ETa = 0, irr = 0;
      var snowCovered = snow > 5;
      if (s && s.sown && !s.done && !crop.fallow) {
        var c = crop;
        var f = s.f;
        var Kc;
        if (f < 0.15) Kc = c.KcIni;
        else if (f < 0.45) Kc = c.KcIni + (c.KcMid - c.KcIni) * (f - 0.15) / 0.3;
        else if (f < 0.8) Kc = c.KcMid;
        else Kc = c.KcMid + (c.KcEnd - c.KcMid) * Math.min(1, (f - 0.8) / 0.2);
        var dormant = c.winter && tmean < 3;
        if (dormant) Kc = 0.2;
        ETc = snowCovered ? 0 : Kc * et0;
        var pAdj = Math.max(0.1, Math.min(0.8, c.p + 0.04 * (5 - ETc)));
        var thr = (1 - pAdj) * TAWA;
        // irrigation: refill upper layer when readily available water is used up
        if (opts.irrigation && !dormant && f < 0.95 && WA < thr && s.irr < (opts.quota || 0)) {
          irr = Math.min(TAWA - WA, (opts.quota || 0) - s.irr);
          WA += irr; s.irr += irr;
        }
        var Ks = WA >= thr ? 1 : Math.max(0, WA / thr);
        ETa = Math.min(WA, Ks * ETc);
        WA -= ETa;
        s.rain += p; s.et0s += et0; s.irrD += irr;
        if (s.trace) { s.trace.etc.push(ETc); s.trace.eta.push(ETa); s.trace.rain.push(p); s.trace.irr.push(irr); }
        if (!dormant) {
          A.live++;
          s.etc += ETc; s.eta += ETa;
          if (f >= 0.45 && f <= 0.65) { s.etcF += ETc; s.etaF += ETa; }
        }
        // early stage: soil mostly bare
        if (f < 0.15 && cover < 0.3 && !snowCovered && (W.ws[k] >= 6 || p >= 20)) A.eros++;
      } else if (!snowCovered) {
        // bare / stubble soil evaporation (two-stage, FAO-56 style)
        var Kr = De <= REW ? 1 : Math.max(0, (TEW - De) / (TEW - REW));
        var Es = Math.min(WA, Kr * 1.05 * et0 * (1 - 0.5 * cover));
        WA -= Es; De = Math.min(TEW, De + Es);
        if (cover < 0.3 && tmean > 0) {
          A.bareDays++;
          if (W.ws[k] >= 6 || p >= 20) A.eros++;
        }
      }
      // --- soil carbon decomposition climate factor (ICBM-type: Ågren & Bosatta temperature response)
      var fT = W.fT[k];
      var fW = 0.2 + 0.8 * Math.min(1, (WA + WB) / (AWC * ZP));
      A.dec += fT * fW * (tilledBare ? 1.25 : 1); A.nd++;
      if (dailyWet) dailyWet[k] = (WA + WB) / (AWC * ZP);
      return { etc: ETc, eta: ETa, irr: irr };
    }

    function setRootDepth(newZ) {
      newZ = Math.max(ZTOP, Math.min(ZP - 0.05, newZ));
      if (newZ > za) { // roots grow into lower layer: take its water proportionally
        var moved = WB * (newZ - za) / (ZP - za);
        WB -= moved; WA += moved;
      } else if (newZ < za) {
        var back = WA * (za - newZ) / za;
        WA -= back; WB += back;
      }
      za = newZ;
    }

    // Build the season list lazily as we walk through time
    var slot = 0;
    var cur = null;   // active season
    var nextSeason = makeSeason(0);

    /** Day the sowing window opens: thermal trigger (10-day mean temperature) + crop-specific delay. */
    function windowOpen(c, year) {
      var k, s;
      if (c.winter) {
        // autumn sowing once the 10-day mean temperature falls below 15 °C (searched from 1 Aug)
        s = dayIndex(W, year - 1, 213);
        if (s < 0) return -1;
        s += shift;
        for (k = Math.max(10, s); k < Math.min(W.n, s + 150); k++) if (W.t10[k] <= 15) return k + (c.sowDelay || 0);
        return -1;
      }
      s = dayIndex(W, year, 32);
      if (s < 0) return -1;
      s += shift;
      for (k = Math.max(10, s); k < Math.min(W.n, s + 250); k++) if (W.t10[k] >= c.sowT) return k + (c.sowDelay || 0);
      return -1;
    }

    function makeSeason(i) {
      if (i >= nSlots) return null;
      var pos = (i + phase) % L;
      var c = crops[plan[pos]];
      var year = Y0 + i;
      var open = windowOpen(c, year);
      var never = open < 0;
      if (never) open = Math.max(0, dayIndex(W, c.winter ? year - 1 : year, c.winter ? 260 : 130) + shift);
      var win = c.sowWindow || 0;
      var maxLen = c.winter ? 345 : (c.fallow ? 150 : 170);
      return {
        slot: i, pos: pos, crop: c.id, year: year, start: open, sowEnd: open + win, harvestBy: open + win + maxLen,
        never: never,
        sown: false, done: false, f: 0, gdd: 0, etc: 0, eta: 0, etcF: 0, etaF: 0, irr: 0,
        rain: 0, et0s: 0, irrD: 0, store: 0, trace: null,
        heatDeg: 0, heatDays: 0, frostSeed: false, frostFlower: 0, winterKill: 0, immature: false,
        killedAt: null, sowDay: -1, harvestDay: -1, lateDays: 0, notSown: false, rot: rot[pos]
      };
    }

    function finishSeason(s, k, reason) {
      var c = crops[s.crop];
      s.done = true; s.harvestDay = k;
      fieldFree = k + 1;
      var res = { water: 1, heat: 1, frost: 1, immature: 1, disease: 1 };
      if (c.fallow) {
        s.yield = 0; s.rel = 1; s.biomass = 0;
      } else if (s.notSown) {
        s.yield = 0; s.rel = 0; s.biomass = 0; res.immature = 0;
      } else {
        var rS = s.etc > 0 ? s.eta / s.etc : 1;
        var rF = s.etcF > 0 ? s.etaF / s.etcF : rS;
        var fw = 1 - c.Ky * (1 - rS);
        fw -= 0.5 * c.Ky * Math.max(0, rS - rF);      // extra sensitivity at flowering
        res.water = Math.max(0.03, Math.min(1, fw));
        res.heat = Math.max(0.2, 1 - 0.015 * s.heatDeg);
        var fr = 1;
        if (s.frostSeed) fr *= 0.45;
        fr *= Math.pow(0.85, Math.min(4, s.frostFlower));
        fr *= Math.max(0.05, 1 - s.winterKill);
        if (s.lateDays > 0) fr *= Math.max(0.6, 1 - 0.01 * s.lateDays);
        res.frost = fr;
        if (reason !== 'mature') {
          var frac = s.f < 0.65 ? 0.1 : 0.3 + 0.7 * (s.f - 0.65) / 0.35;
          res.immature = Math.max(0.05, Math.min(1, frac));
        }
        res.disease = Math.max(0.3, 1 - s.rot.disease) * s.rot.factor;
        var maxB = c.greenManure ? c.biomassMax : c.Ym / c.HI;
        s.biomass = maxB * res.water * Math.min(1, Math.max(0.15, s.f));
        if (c.greenManure) {
          s.yield = 0;
          s.rel = Math.min(1, res.water * res.heat * res.frost);
        } else {
          s.rel = Math.min(1.15, res.water * res.heat * res.frost * res.immature * res.disease);
          s.yield = c.Ym * s.rel;
        }
      }
      s.factors = res;
      // cause of the biggest loss
      var worst = null, wl = 0;
      ['water', 'heat', 'frost', 'immature', 'disease'].forEach(function (key) {
        var l = -Math.log(Math.max(0.001, Math.min(1, res[key])));
        if (l > wl) { wl = l; worst = key; }
      });
      if (s.frostSeed || s.winterKill > 0.2) { if (worst === 'frost') worst = s.winterKill > 0.2 ? 'winterkill' : 'frost'; }
      if (s.notSown) worst = 'notsown';
      s.cause = worst;
      // economics
      var nCredit = s.rot.nCredit || 0;
      var cost = c.cost - nCredit * econ.nPrice;
      if (s.notSown) cost = c.cost * 0.25;
      var gross = s.irr / econ.irrigEfficiency;
      s.irrGross = gross;
      cost += gross * econ.waterCostPerMm;
      s.revenue = s.yield * c.price;
      s.cost = cost;
      s.margin = s.revenue - cost;
      // outcome class
      // crash = lost more than half of the money put into the field; dent = a loss-making year
      if (c.fallow || c.greenManure) s.outcome = 'rest';
      else if (s.notSown || s.revenue < 0.5 * s.cost || s.rel < 0.2) s.outcome = 'crash';
      else if (s.margin < 0) s.outcome = 'dent';
      else s.outcome = 'ok';
      // residues: soil cover & snow trapping for the off-season; carbon input
      var sf = c.fallow ? 1 : strawFrac;
      cover = c.fallow ? c.cover : Math.max(0.05, c.cover * (0.4 + 0.6 * Math.min(1, s.rel + 0.2)) * (opts.straw === false ? 0.45 : 1));
      snowTrap = c.fallow ? c.snowTrap : Math.max(0.4, c.snowTrap * (opts.straw === false ? 0.75 : 1));
      tilledBare = !!c.fallow;
      var cAbove, cRoot;
      if (c.greenManure) { cAbove = s.biomass * 0.45; cRoot = s.biomass * 0.3 * 0.45; }
      else if (c.fallow || s.notSown) { cAbove = 0; cRoot = 0; }
      else {
        cAbove = Math.max(0, s.biomass - s.yield) * 0.45 * sf;
        cRoot = s.biomass * c.rootShoot * 0.45;
      }
      s.cAbove = cAbove; s.cRoot = cRoot;
      ya(W.year[k]).cIn += 0.13 * cAbove + 0.30 * cRoot;
      setRootDepth(ZTOP);
      seasons.push(s);
      return s;
    }

    var lastYearClosed = W.firstYear;
    for (day = 0; day < W.n; day++) {
      var k = day;
      // activate next season
      if (!cur && nextSeason && k >= nextSeason.start) {
        cur = nextSeason; slot++;
        nextSeason = makeSeason(slot);
      }
      var s = cur;
      var c = s ? crops[s.crop] : null;
      if (s && !s.sown && !s.done) {
        if (c.fallow) {
          // fallow: spring tillage, kept bare until autumn
          s.sown = true; s.sowDay = k; cover = c.cover; snowTrap = c.snowTrap; tilledBare = true;
        } else if (k >= fieldFree) {
          var ok;
          if (c.winter) ok = W.tmean[k] < 20;
          else {
            var m5 = 0; for (var q = Math.max(0, k - 4); q <= k; q++) m5 += W.tmean[q];
            m5 /= Math.min(5, k + 1);
            ok = m5 >= c.sowT - 2 && (WA + WB) > 0.1 * AWC * ZP;
          }
          if (ok || k >= s.sowEnd) {
            if (s.never || k > s.sowEnd + 20) { s.notSown = true; }
            else {
              s.sown = true; s.sowDay = k; s.lateDays = Math.max(0, k - s.sowEnd);
              s.store = WA + WB;
              if (opts.traceYear === s.year) s.trace = { day0: k, etc: [], eta: [], rain: [], irr: [] };
              cover = Math.min(cover, 0.3); tilledBare = false;
            }
          }
        }
        if (s.notSown) { finishSeason(s, k, 'notsown'); cur = null; s = null; c = null; }
      }

      if (s && s.sown && !s.done && !c.fallow) {
        var tm = W.tmean[k];
        s.gdd += Math.max(0, Math.min(tm, c.Tcap) - c.Tb);
        s.f = s.gdd / c.gdd;
        setRootDepth(ZTOP + (c.Zr - ZTOP) * Math.min(1, s.f / 0.55));
        // frost & heat events
        var tn = W.tmin[k], tx = W.tmax[k];
        if (c.winter) {
          // crown temperature insulated by snow (snow depth cm ~ SWE mm / 2.5)
          var depth = snow / 2.5;
          var crown = tn * Math.max(0.15, 1 - depth / 25);
          if (crown < c.frostKill) s.winterKill = Math.min(1, s.winterKill + 0.06 * (c.frostKill - crown));
          if (W.doy[k] > 60 + shift && W.doy[k] < 160 + shift && s.f > 0.3 && s.f < 0.65 && tn < -2) s.frostFlower++;
        } else {
          if (s.f < 0.25 && tn < c.frostKill) s.frostSeed = true;
          if (s.f >= 0.45 && s.f <= 0.65 && tn < -1.5) s.frostFlower++;
        }
        // irrigated canopies transpire freely and stay ~3 °C cooler (transpirational cooling)
        var th = c.Theat + (opts.irrigation && (opts.quota || 0) > 0 ? 3 : 0);
        if (s.f >= 0.4 && s.f <= 0.7 && tx > th) { s.heatDeg += Math.min(6, tx - th); s.heatDays++; }
      }

      waterBalanceDay(k, c, s);

      if (s && s.sown && !s.done) {
        if (c.fallow) {
          if (k >= s.harvestBy) { finishSeason(s, k, 'mature'); cur = null; }
        } else if (c.greenManure) {
          if (s.f >= 0.6 || k >= s.harvestBy) { s.f = Math.min(1, s.f); finishSeason(s, k, 'mature'); cur = null; }
        } else if (s.f >= 1) {
          finishSeason(s, k, 'mature'); cur = null;
        } else {
          var killing = !c.winter && s.f > 0.3 && W.tmin[k] <= -3 && k - s.sowDay > 60;
          if (killing || k >= s.harvestBy) { s.immature = true; finishSeason(s, k, 'immature'); cur = null; }
        }
      }

      // close calendar year: soil carbon update
      if (k === W.n - 1 || W.year[k + 1] !== W.year[k]) {
        var Yc = W.year[k];
        var A = ya(Yc);
        var re = A.nd ? A.dec / A.nd : 0;
        var decomp = 0.05 * re * soc; // k=0.05/yr at reference climate factor 1
        soc = soc + A.cIn - decomp;
        if (Yc >= Y0) socTrack.push({ year: Yc, soc: soc, cIn: A.cIn, decomp: decomp, eros: A.eros, bareDays: A.bareDays, live: A.live });
        lastYearClosed = Yc;
      }
    }

    // keep only finished seasons inside the evaluated window
    seasons = seasons.filter(function (s) { return s.done && s.year >= Y0 && s.year <= W.lastYear; });
    var out = { plan: plan.slice(), phase: phase, seasons: seasons, soc: socTrack, soc0: hyd.socStock, hyd: hyd, Y0: Y0 };
    if (detail) out.dailyWet = dailyWet;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Crash test: run every phase and aggregate                            */
  /* ------------------------------------------------------------------ */

  function percentile(arr, q) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  function crashTest(W, soil, plan, opts) {
    opts = opts || {};
    var runs = [];
    var phases = opts.phases || plan.map(function (x, i) { return i; });
    for (var pi = 0; pi < phases.length; pi++) {
      var ph = phases[pi];
      var o = {}; for (var key in opts) o[key] = opts[key];
      o.phase = ph; o.detail = !!opts.detail && ph === 0;
      runs.push(simulate(W, soil, plan, o));
    }
    return summarize(W, plan, runs, opts);
  }

  function summarize(W, plan, runs, opts) {
    var crops = (opts && opts.crops) || CropDB.BY_ID;
    var all = [];
    runs.forEach(function (r) { all = all.concat(r.seasons); });
    var crop = all.filter(function (s) { return crops[s.crop].harvestable; });
    var nYears = runs[0].seasons.length;
    var Y0 = runs[0].Y0, Y1 = W.lastYear;
    // fixed split for the "is risk growing?" comparison (1981-2002 vs 2003-2025)
    var split = (opts && opts.splitYear) || 2002;
    var mid = (split > Y0 + 4 && split < Y1 - 4) ? split : Math.floor((Y0 + Y1) / 2);
    var margins = all.map(function (s) { return s.margin; });
    // margin per calendar year averaged over phases -> how volatile is the farm income?
    var perYear = {};
    all.forEach(function (s) { (perYear[s.year] = perYear[s.year] || []).push(s.margin); });
    var crashes = crop.filter(function (s) { return s.outcome === 'crash'; });
    var dents = crop.filter(function (s) { return s.outcome === 'dent'; });
    var causes = {};
    crashes.concat(dents).forEach(function (s) { causes[s.cause] = (causes[s.cause] || 0) + 1; });
    var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
    // soil carbon: average over phases of total change
    var socChg = mean(runs.map(function (r) {
      var last = r.soc[r.soc.length - 1];
      return last ? (last.soc - r.soc0) / r.soc0 * 100 : 0;
    }));
    var socRate = mean(runs.map(function (r) {
      var last = r.soc[r.soc.length - 1];
      return last ? (last.soc - r.soc0) / r.soc.length : 0;
    }));
    var eros = mean(runs.map(function (r) { return mean(r.soc.map(function (y) { return y.eros; })); }));
    var bare = mean(runs.map(function (r) { return mean(r.soc.map(function (y) { return y.bareDays; })); }));
    var live = mean(runs.map(function (r) { return mean(r.soc.map(function (y) { return y.live; })); }));
    // NRCS soil-health principles that depend on the plan structure itself
    var fam = {}, distinct = {}, legumes = 0, tilled = 0;
    plan.forEach(function (id) {
      var c = crops[id];
      distinct[id] = 1;
      if (!c.fallow) fam[c.group] = 1;
      if (c.group === 'legume') legumes++;
      if (c.fallow) tilled++;
    });
    var deficit = mean(all.map(function (s) { return Math.max(0, s.etc - s.eta); }));
    var irr = mean(all.map(function (s) { return s.irrGross || 0; }));
    var eta = mean(all.map(function (s) { return s.eta; }));
    // per plan position
    var byPos = plan.map(function (id, pos) {
      var ss = all.filter(function (s) { return s.pos === pos; });
      var cr = ss.filter(function (s) { return s.outcome === 'crash'; }).length;
      var dn = ss.filter(function (s) { return s.outcome === 'dent'; }).length;
      var cc = {};
      ss.forEach(function (s) { if (s.outcome === 'crash' || s.outcome === 'dent') cc[s.cause] = (cc[s.cause] || 0) + 1; });
      var mainCause = null, mc = 0;
      for (var k in cc) if (cc[k] > mc) { mc = cc[k]; mainCause = k; }
      return {
        pos: pos, crop: id, n: ss.length, crash: cr, dent: dn,
        crashRate: ss.length ? cr / ss.length : 0,
        meanYield: mean(ss.map(function (s) { return s.yield; })),
        meanRel: mean(ss.map(function (s) { return s.rel; })),
        meanMargin: mean(ss.map(function (s) { return s.margin; })),
        mainCause: mainCause, seasons: ss
      };
    });
    function periodStats(a, b) {
      var ss = crop.filter(function (s) { return s.year >= a && s.year <= b; });
      var ys = Object.keys(perYear).filter(function (y) { return y >= a && y <= b; });
      return {
        from: a, to: b, years: ys.length,
        lossYears: ys.filter(function (y) { return mean(perYear[y]) < 0; }).length,
        crashRate: ss.length ? ss.filter(function (s) { return s.outcome === 'crash'; }).length / ss.length : 0,
        meanMargin: mean(all.filter(function (s) { return s.year >= a && s.year <= b; }).map(function (s) { return s.margin; }))
      };
    }
    var yearMargins = Object.keys(perYear).map(function (y) { return mean(perYear[y]); });
    return {
      plan: plan.slice(),
      runs: runs,
      nYears: nYears, Y0: Y0, Y1: Y1,
      meanMargin: mean(margins),
      p10Margin: percentile(yearMargins, 0.1),
      crashRate: crop.length ? crashes.length / crop.length : 0,
      dentRate: crop.length ? dents.length / crop.length : 0,
      cropYears: crop.length,
      causes: causes,
      socChangePct: socChg,
      socRate: socRate,
      erosionDays: eros,
      bareDays: bare,
      liveRootDays: live,
      families: Object.keys(fam).length,
      distinctCrops: Object.keys(distinct).length,
      legumeShare: legumes / plan.length,
      fallowShare: tilled / plan.length,
      deficit: deficit,
      irrigation: irr,
      eta: eta,
      byPos: byPos,
      early: periodStats(Y0, mid),
      late: periodStats(mid + 1, Y1)
    };
  }

  /**
   * Re-price a crash-test result without re-simulating: all crop prices multiplied by f.
   * Returns a shallow copy with income / reliability metrics recomputed from the stored seasons.
   */
  function reprice(r, f, crops) {
    crops = crops || CropDB.BY_ID;
    var o = {}; for (var k in r) o[k] = r[k];
    var n = 0, sum = 0, nc = 0, cr = 0, dn = 0, perYear = {};
    r.runs.forEach(function (run) {
      run.seasons.forEach(function (s) {
        var rev = s.revenue * f, m = rev - s.cost;
        n++; sum += m;
        (perYear[s.year] = perYear[s.year] || []).push(m);
        if (crops[s.crop].harvestable) {
          nc++;
          if (s.notSown || rev < 0.5 * s.cost || s.rel < 0.2) cr++;
          else if (m < 0) dn++;
        }
      });
    });
    o.meanMargin = n ? sum / n : 0;
    o.crashRate = nc ? cr / nc : 0;
    o.dentRate = nc ? dn / nc : 0;
    o.p10Margin = percentile(Object.keys(perYear).map(function (y) {
      var a = perYear[y]; return a.reduce(function (x, z) { return x + z; }, 0) / a.length;
    }), 0.1);
    o.base = r;
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Scoring & optimisation                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Pillar raw values (higher is better).
   * Soil health follows the four USDA-NRCS soil health principles + the carbon trend:
   *   keep the soil covered (erosion-exposure & bare days), keep living roots (days with a growing crop),
   *   maximise diversity (crop families, legumes), minimise disturbance (tilled black fallow).
   */
  function pillars(r, irrigated) {
    return {
      profit: r.meanMargin,
      reliability: -r.crashRate * 100 - r.dentRate * 30 + r.p10Margin / 20,
      soil: r.socRate * 10 - 0.3 * r.erosionDays - 0.03 * r.bareDays + 0.02 * r.liveRootDays +
        1.5 * r.families + 0.5 * r.distinctCrops + 5 * r.legumeShare - 4 * r.fallowShare,
      water: irrigated ? -r.irrigation : -r.deficit
    };
  }

  function scoreAll(results, weights, irrigated) {
    var keys = ['profit', 'reliability', 'soil', 'water'];
    var raw = results.map(function (r) { return pillars(r, irrigated); });
    var lo = {}, hi = {};
    keys.forEach(function (k) {
      lo[k] = Math.min.apply(null, raw.map(function (p) { return p[k]; }));
      hi[k] = Math.max.apply(null, raw.map(function (p) { return p[k]; }));
    });
    var wsum = keys.reduce(function (a, k) { return a + (weights[k] || 0); }, 0) || 1;
    results.forEach(function (r, i) {
      r.pillar = {};
      keys.forEach(function (k) {
        r.pillar[k] = hi[k] - lo[k] > 1e-9 ? (raw[i][k] - lo[k]) / (hi[k] - lo[k]) * 100 : 50;
      });
      r.score = keys.reduce(function (a, k) { return a + r.pillar[k] * (weights[k] || 0); }, 0) / wsum;
    });
    return results;
  }

  /** All distinct cyclic rotations (necklaces) of length 1..maxLen from candidate crops. */
  function enumeratePlans(cands, maxLen) {
    var out = [], seen = {};
    function canon(p) {
      var best = null;
      for (var i = 0; i < p.length; i++) {
        var r = p.slice(i).concat(p.slice(0, i)).join(',');
        if (best === null || r < best) best = r;
      }
      return best;
    }
    function rec(p) {
      if (p.length) {
        var ok = true;
        var rest = 0;
        for (var i = 0; i < p.length; i++) {
          var c = CropDB.BY_ID[p[i]];
          if (c.fallow || c.greenManure) rest++;
          var nx = p[(i + 1) % p.length];
          // the same non-cereal crop in two consecutive years is never sensible
          if (p.length > 1 && nx === p[i] && c.group !== 'cereal') ok = false;
        }
        if (rest > 1 || (p.length === 1 && rest === 1)) ok = false;
        // skip plans that are just a shorter plan repeated (wheat-wheat == wheat)
        for (var per = 1; per < p.length && ok; per++) {
          if (p.length % per) continue;
          var rep = true;
          for (var j = per; j < p.length; j++) if (p[j] !== p[j - per]) { rep = false; break; }
          if (rep) ok = false;
        }
        if (ok) {
          var key = canon(p);
          if (!seen[key]) { seen[key] = 1; out.push(key.split(',')); }
        }
      }
      if (p.length >= maxLen) return;
      cands.forEach(function (c) { rec(p.concat([c])); });
    }
    rec([]);
    return out;
  }

  /** Plans that differ from `plan` by exactly one edit (replace / insert / delete). */
  function neighbourPlans(plan, cands) {
    var out = [];
    var i, c;
    for (i = 0; i < plan.length; i++) {
      for (var j = 0; j < cands.length; j++) {
        c = cands[j];
        if (c === plan[i]) continue;
        var p = plan.slice(); p[i] = c;
        out.push({ plan: p, edit: { type: 'replace', pos: i, from: plan[i], to: c } });
      }
    }
    if (plan.length < 4) {
      for (i = 0; i <= plan.length; i++) {
        for (j = 0; j < cands.length; j++) {
          var q = plan.slice(); q.splice(i, 0, cands[j]);
          out.push({ plan: q, edit: { type: 'insert', pos: i, to: cands[j] } });
        }
      }
    }
    if (plan.length > 1) {
      for (i = 0; i < plan.length; i++) {
        var r = plan.slice(); r.splice(i, 1);
        out.push({ plan: r, edit: { type: 'delete', pos: i, from: plan[i] } });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Climate fingerprint & validation                                    */
  /* ------------------------------------------------------------------ */

  function linSlope(xs, ys) {
    var n = xs.length, mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var num = 0, den = 0;
    for (i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    return den ? num / den : 0;
  }

  /** Per-year climate indicators for the main growing season (May-Aug in the north). */
  function climateFingerprint(W) {
    var shift = W.lat < 0 ? 182 : 0;
    var years = [];
    for (var y = W.firstYear; y <= W.lastYear; y++) {
      var s = dayIndex(W, y, 121 + shift > 365 ? 121 + shift - 365 : 121 + shift);
      var yy = 121 + shift > 365 ? y + 1 : y;
      if (W.lat < 0) s = dayIndex(W, y, 121 + shift - (121 + shift > 365 ? 365 : 0));
      if (s < 0 || s + 123 > W.n) continue;
      var p = 0, hot = 0, et = 0, t = 0, frost = 0;
      for (var k = s; k < s + 123; k++) { // 1 May - 31 Aug (or Nov-Feb in the south)
        p += W.prec[k]; et += W.et0[k]; t += W.tmean[k];
        if (W.tmax[k] >= 30) hot++;
      }
      // late spring frosts: days with Tmin < -2 between 15 May and 15 June
      for (k = s + 14; k < s + 45; k++) if (W.tmin[k] < -2) frost++;
      years.push({ year: y, prec: p, hot: hot, et0: et, tmean: t / 123, deficit: et - p, frost: frost });
      void yy;
    }
    var xs = years.map(function (r) { return r.year; });
    var trend = {};
    ['prec', 'hot', 'et0', 'tmean', 'deficit'].forEach(function (key) {
      trend[key] = linSlope(xs, years.map(function (r) { return r[key]; })) * 10; // per decade
    });
    return { years: years, trend: trend };
  }

  /** Compare modelled profile wetness with NASA MERRA-2 GWETROOT (monthly anomalies, snow-free months). */
  function validateWetness(W, dailyWet) {
    if (!dailyWet) return null;
    var months = {};
    for (var k = 0; k < W.n; k++) {
      var g = W.gwr[k];
      if (isNaN(g)) continue;
      var m = Math.floor((W.doy[k] - 1) / 30.5);
      if (W.lat >= 0 ? (m < 4 || m > 9) : (m > 3 && m < 10)) continue; // growing-season months only
      var key = W.year[k] * 100 + m;
      var o = months[key] || (months[key] = { m: 0, g: 0, n: 0, mo: m, y: W.year[k] });
      o.m += dailyWet[k]; o.g += g; o.n++;
    }
    var rows = Object.keys(months).sort().map(function (key) { var o = months[key]; return { y: o.y, mo: o.mo, m: o.m / o.n, g: o.g / o.n }; });
    rows = rows.filter(function (r) { return r.y > W.firstYear; });
    // remove the mean seasonal cycle -> anomalies
    var clim = {};
    rows.forEach(function (r) { var c = clim[r.mo] || (clim[r.mo] = { m: 0, g: 0, n: 0 }); c.m += r.m; c.g += r.g; c.n++; });
    rows.forEach(function (r) { var c = clim[r.mo]; r.am = r.m - c.m / c.n; r.ag = r.g - c.g / c.n; });
    function corr(a, b) {
      var n = a.length, ma = 0, mb = 0;
      for (var i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n;
      var sab = 0, saa = 0, sbb = 0;
      for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
      return sab / Math.sqrt(saa * sbb || 1);
    }
    return {
      rows: rows,
      rRaw: corr(rows.map(function (r) { return r.m; }), rows.map(function (r) { return r.g; })),
      rAnom: corr(rows.map(function (r) { return r.am; }), rows.map(function (r) { return r.ag; })),
      n: rows.length
    };
  }

  var api = {
    prepareWeather: prepareWeather, et0PM: et0PM, soilHydraulics: soilHydraulics,
    rotationEffects: rotationEffects, simulate: simulate, crashTest: crashTest, reprice: reprice,
    pillars: pillars, scoreAll: scoreAll, enumeratePlans: enumeratePlans, neighbourPlans: neighbourPlans,
    climateFingerprint: climateFingerprint, validateWetness: validateWetness, dayIndex: dayIndex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;
})(this);
