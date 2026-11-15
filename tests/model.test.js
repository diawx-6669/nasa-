// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const M = require('../js/model.js');
const DB = require('../js/crops.js');
const load = require('./load.js');

const P = load('akmola');
const W = M.prepareWeather(P.weather, P.lat);

test('NASA POWER preset is complete (1981-2025, no gaps)', () => {
  assert.strictEqual(W.firstYear, 1981);
  assert.strictEqual(W.lastYear, 2025);
  assert.strictEqual(W.n, 16436);
});

test('FAO-56 example: ET0 ~ 3.9 mm/day (Allen et al. 1998, Example 18)', () => {
  // Brussels, 6 July: Tmax 21.5, Tmin 12.3, RH ~ 63 %, u2 2.078 m/s, Rs 22.07 MJ/m2, lat 50.8, z 100 m
  const et0 = M.et0PM(21.5, 12.3, 63, 2.078, 22.07, 50.8, 187, 100);
  assert.ok(et0 > 3.4 && et0 < 4.3, 'ET0 = ' + et0);
});

test('Saxton-Rawls available water is in a realistic range', () => {
  const h = M.soilHydraulics({ clay: 27, sand: 45, socGkg: 20, bd: 1.3 });
  assert.ok(h.awcMm > 100 && h.awcMm < 220, 'AWC ' + h.awcMm);
});

test('continuous spring wheat in Akmola yields 1-2 t/ha on average (regional statistics ~1.0-1.4)', () => {
  const r = M.crashTest(W, P.soil, ['wheat'], {});
  const y = r.byPos[0].meanYield;
  assert.ok(y > 0.9 && y < 2.2, 'mean yield ' + y);
});

test('wheat after black fallow out-yields wheat after wheat', () => {
  const r = M.crashTest(W, P.soil, ['fallow', 'wheat', 'wheat'], {});
  assert.ok(r.byPos[1].meanYield > r.byPos[2].meanYield);
});

test('grain maize cannot ripen in the short northern season', () => {
  const r = M.crashTest(W, P.soil, ['maize'], {});
  assert.ok(r.crashRate > 0.8);
});

test('black fallow loses more soil carbon than continuous cropping', () => {
  const a = M.crashTest(W, P.soil, ['wheat'], {});
  const b = M.crashTest(W, P.soil, ['fallow', 'wheat'], {});
  assert.ok(b.socChangePct < a.socChangePct);
});

test('irrigation removes most of the water deficit', () => {
  const T = load('turkistan');
  const Wt = M.prepareWeather(T.weather, T.lat);
  const dry = M.crashTest(Wt, T.soil, ['wwheat'], {});
  const wet = M.crashTest(Wt, T.soil, ['wwheat'], { irrigation: true, quota: 600 });
  assert.ok(wet.deficit < dry.deficit * 0.3);
  assert.ok(wet.irrigation > 100);
});

test('hotter & drier scenario increases crash rate', () => {
  const hot = M.prepareWeather(P.weather, P.lat, { dT: 2.5, pFactor: 0.9 });
  const a = M.crashTest(W, P.soil, ['fallow', 'wheat', 'wheat', 'barley'], {});
  const b = M.crashTest(hot, P.soil, ['fallow', 'wheat', 'wheat', 'barley'], {});
  assert.ok(b.crashRate > a.crashRate);
});

test('modelled soil wetness agrees with NASA MERRA-2 GWETROOT (anomaly r > 0.5)', () => {
  const run = M.simulate(W, P.soil, ['wheat'], { detail: true });
  const v = M.validateWetness(W, run.dailyWet);
  assert.ok(v.rAnom > 0.5, 'r = ' + v.rAnom);
});

test('plan enumeration has no duplicates and no repeated plans', () => {
  const plans = M.enumeratePlans(['wheat', 'barley', 'pea'], 4);
  const keys = new Set(plans.map(p => p.join(',')));
  assert.strictEqual(keys.size, plans.length);
  assert.ok(!plans.some(p => p.join(',') === 'wheat,wheat'));
});

test('every crop in the database can be simulated', () => {
  DB.CROPS.forEach(c => {
    if (c.fallow) return;
    const r = M.crashTest(W, P.soil, [c.id, 'wheat'], {});
    assert.ok(r.byPos[0].n > 10, c.id);
  });
});

test('sowing-date shift moves sowing by the requested number of days', () => {
  const a = M.simulate(W, P.soil, ['wheat'], {});
  const b = M.simulate(W, P.soil, ['wheat'], { sowShiftByCrop: { wheat: 7 } });
  const sa = a.seasons.find(s => s.year === 2010), sb = b.seasons.find(s => s.year === 2010);
  assert.ok(sb.sowDay - sa.sowDay >= 7, 'sow ' + sa.sowDay + ' -> ' + sb.sowDay);
});

test('autumn analog years: picks past years only and ranks the current autumn', () => {
  // pretend the record ends on 12 Nov 2025 (a partial current year)
  const n = M.dayIndex(W, 2025, 316) + 1;
  const raw = { start: P.weather.start, elev: P.weather.elev, n };
  ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M', 'GWETROOT'].forEach(k => { raw[k] = P.weather[k].slice(0, n); });
  const W2 = M.prepareWeather(raw, P.lat);
  const run = M.simulate(W2, P.soil, ['wheat'], { detail: true, includePartial: true });
  const a = M.analogYears(W2, run.dailyWet, 5);
  assert.strictEqual(a.year, 2025);
  assert.strictEqual(a.analogs.length, 5);
  assert.ok(a.analogs.every(h => h.year < 2024));
  assert.ok(a.wetPct >= 0 && a.wetPct <= 100);
});

test('soil health index: pulses beat monoculture, black fallow scores lowest', () => {
  const idx = plan => M.soilHealthIndex(M.crashTest(W, P.soil, plan, {})).value;
  const pulses = idx(['pea', 'wheat', 'chickpea', 'barley']), mono = idx(['wheat']), fallow = idx(['fallow', 'wheat', 'wheat', 'barley']);
  assert.ok(pulses > mono && mono > fallow, pulses + ' ' + mono + ' ' + fallow);
});

test('repeating a drought year three times makes those years worse', () => {
  const plan = ['fallow', 'wheat', 'wheat', 'barley'];
  const farm = (Wx, y) => { const r = M.crashTest(Wx, P.soil, plan, {}); const m = []; r.runs.forEach(run => run.seasons.forEach(s => { if (s.year === y) m.push(s.margin); })); return m.reduce((a, b) => a + b) / m.length; };
  const W2 = M.repeatYear(W, 1998, 1998, 3);
  assert.ok(farm(W2, 2000) < farm(W, 2000));
});
