/*
 * Crop parameter database for the Crop Rotation Crash Test.
 *
 * Sources for the agronomic coefficients (rounded, simplified):
 *  - Crop coefficients Kc, root depth, depletion fraction p: FAO Irrigation & Drainage Paper 56
 *    (Allen et al., 1998), Tables 12 and 22.
 *  - Yield response factor Ky: FAO Irrigation & Drainage Paper 33 / 66 (Doorenbos & Kassam 1979;
 *    Steduto et al. 2012). Where FAO gives no value we used the value of a similar crop.
 *  - Base temperatures / thermal time, heat & frost thresholds: typical literature values for
 *    early/mid-season varieties grown in the Northern Kazakhstan steppe (approximate).
 *  - Yield potential, prices and costs are ROUGH ILLUSTRATIVE ESTIMATES (USD, around 2024-2025,
 *    Kazakhstan farm-gate level). They are editable in the app ("Assumptions") and a farmer
 *    should replace them with their own numbers.
 *
 * Sowing calendar is climate-driven, so it works anywhere: the sowing window of a spring crop opens
 * `sowDelay` days after the 10-day mean air temperature first reaches `sowT` (°C) and stays open
 * `sowWindow` days. Delays reproduce the recommended sowing dates of Northern Kazakhstan
 * (e.g. spring wheat 15-25 May, which avoids the June drought). Winter crops are sown when the
 * 10-day mean temperature falls below 15 °C in autumn.
 */
(function (root) {
  'use strict';

  // Helper to keep the table readable
  function crop(o) {
    var d = {
      winter: false, harvestable: true, fallow: false, greenManure: false,
      Tb: 0, Tcap: 30, sowT: 8, sowDelay: 0, sowWindow: 30,
      KcIni: 0.35, KcMid: 1.1, KcEnd: 0.3, Zr: 1.2, p: 0.55, Ky: 1.0,
      Theat: 31, frostKill: -6, Ym: 2.5, HI: 0.4, rootShoot: 0.25,
      price: 200, cost: 180, minReturn: 1, nCredit: 0, breakBonus: 0,
      cover: 0.5, snowTrap: 0.7
    };
    for (var k in o) d[k] = o[k];
    return d;
  }

  var CROPS = [
    crop({ id: 'wheat', group: 'cereal', color: '#d9a441',
      name: { en: 'Spring wheat', ru: 'Яровая пшеница' },
      Tb: 0, gdd: 1650, sowT: 9, sowDelay: 12, sowWindow: 30,
      KcIni: 0.4, KcMid: 1.15, KcEnd: 0.3, Zr: 1.3, p: 0.55, Ky: 1.15, Theat: 31, frostKill: -7,
      Ym: 3.5, HI: 0.40, price: 165, cost: 170, cover: 0.7, snowTrap: 0.85 }),

    crop({ id: 'wwheat', group: 'cereal', color: '#b8892e', winter: true,
      name: { en: 'Winter wheat', ru: 'Озимая пшеница' },
      Tb: 0, gdd: 2150, sowT: 15, sowDelay: 0, sowWindow: 35,
      KcIni: 0.4, KcMid: 1.15, KcEnd: 0.35, Zr: 1.5, p: 0.55, Ky: 1.05, Theat: 31, frostKill: -18,
      Ym: 4.5, HI: 0.42, price: 160, cost: 200, cover: 0.7, snowTrap: 0.85 }),

    crop({ id: 'barley', group: 'cereal', color: '#c9b458',
      name: { en: 'Barley', ru: 'Ячмень' },
      Tb: 0, gdd: 1420, sowT: 8, sowDelay: 18, sowWindow: 33,
      KcIni: 0.3, KcMid: 1.15, KcEnd: 0.25, Zr: 1.2, p: 0.55, Ky: 1.05, Theat: 31, frostKill: -7,
      Ym: 3.8, HI: 0.45, price: 125, cost: 160, cover: 0.65, snowTrap: 0.8 }),

    crop({ id: 'oats', group: 'cereal', color: '#a99a5b',
      name: { en: 'Oats', ru: 'Овёс' },
      Tb: 0, gdd: 1500, sowT: 8, sowDelay: 15, sowWindow: 30,
      KcIni: 0.3, KcMid: 1.15, KcEnd: 0.25, Zr: 1.1, p: 0.55, Ky: 1.05, Theat: 30, frostKill: -6,
      Ym: 3.3, HI: 0.40, price: 130, cost: 150, cover: 0.65, snowTrap: 0.8 }),

    crop({ id: 'millet', group: 'cereal', color: '#e0c060',
      name: { en: 'Proso millet', ru: 'Просо' },
      Tb: 10, gdd: 900, sowT: 13, sowDelay: 12, sowWindow: 25,
      KcIni: 0.3, KcMid: 1.0, KcEnd: 0.3, Zr: 1.1, p: 0.6, Ky: 0.9, Theat: 38, frostKill: -2,
      Ym: 2.6, HI: 0.35, price: 170, cost: 140, minReturn: 2, cover: 0.6, snowTrap: 0.75 }),

    crop({ id: 'maize', group: 'cereal', color: '#f2b705',
      name: { en: 'Grain maize', ru: 'Кукуруза на зерно' },
      Tb: 10, gdd: 1450, sowT: 12, sowDelay: 0, sowWindow: 30,
      KcIni: 0.3, KcMid: 1.2, KcEnd: 0.4, Zr: 1.5, p: 0.55, Ky: 1.25, Theat: 35, frostKill: -2,
      Ym: 8.0, HI: 0.50, rootShoot: 0.2, price: 170, cost: 380, cover: 0.6, snowTrap: 0.8 }),

    crop({ id: 'sunflower', group: 'oilseed', color: '#f5c518',
      name: { en: 'Sunflower', ru: 'Подсолнечник' },
      Tb: 6, gdd: 1500, sowT: 10, sowDelay: 4, sowWindow: 30,
      KcIni: 0.35, KcMid: 1.05, KcEnd: 0.35, Zr: 1.8, p: 0.45, Ky: 0.95, Theat: 35, frostKill: -5,
      Ym: 2.6, HI: 0.33, rootShoot: 0.2, price: 370, cost: 220, minReturn: 5, cover: 0.3, snowTrap: 0.75 }),

    crop({ id: 'rapeseed', group: 'oilseed', color: '#e8d23a',
      name: { en: 'Spring rapeseed (canola)', ru: 'Яровой рапс' },
      Tb: 5, gdd: 1100, sowT: 8, sowDelay: 10, sowWindow: 24,
      KcIni: 0.35, KcMid: 1.1, KcEnd: 0.35, Zr: 1.2, p: 0.6, Ky: 1.0, Theat: 29, frostKill: -5,
      Ym: 2.3, HI: 0.28, rootShoot: 0.2, price: 390, cost: 230, minReturn: 4, cover: 0.5, snowTrap: 0.7 }),

    crop({ id: 'flax', group: 'oilseed', color: '#6c8ebf',
      name: { en: 'Oilseed flax', ru: 'Лён масличный' },
      Tb: 5, gdd: 1050, sowT: 8, sowDelay: 18, sowWindow: 25,
      KcIni: 0.35, KcMid: 1.1, KcEnd: 0.25, Zr: 0.9, p: 0.5, Ky: 1.0, Theat: 31, frostKill: -4,
      Ym: 1.8, HI: 0.30, rootShoot: 0.2, price: 420, cost: 190, minReturn: 5, cover: 0.4, snowTrap: 0.6 }),

    crop({ id: 'pea', group: 'legume', color: '#5aa864',
      name: { en: 'Field pea', ru: 'Горох' },
      Tb: 3, gdd: 1150, sowT: 6, sowDelay: 8, sowWindow: 28,
      KcIni: 0.5, KcMid: 1.15, KcEnd: 0.3, Zr: 0.9, p: 0.35, Ky: 1.15, Theat: 30, frostKill: -6,
      Ym: 2.8, HI: 0.45, price: 220, cost: 180, minReturn: 4, nCredit: 30, breakBonus: 0.05,
      cover: 0.25, snowTrap: 0.45 }),

    crop({ id: 'lentil', group: 'legume', color: '#9b6b43',
      name: { en: 'Lentil', ru: 'Чечевица' },
      Tb: 3, gdd: 1200, sowT: 7, sowDelay: 6, sowWindow: 25,
      KcIni: 0.4, KcMid: 1.1, KcEnd: 0.3, Zr: 0.8, p: 0.5, Ky: 0.95, Theat: 32, frostKill: -6,
      Ym: 1.8, HI: 0.38, price: 420, cost: 200, minReturn: 3, nCredit: 25, breakBonus: 0.05,
      cover: 0.25, snowTrap: 0.45 }),

    crop({ id: 'chickpea', group: 'legume', color: '#c2a878',
      name: { en: 'Chickpea', ru: 'Нут' },
      Tb: 5, gdd: 1300, sowT: 9, sowDelay: 4, sowWindow: 25,
      KcIni: 0.4, KcMid: 1.0, KcEnd: 0.35, Zr: 1.0, p: 0.5, Ky: 0.9, Theat: 32, frostKill: -5,
      Ym: 2.0, HI: 0.40, price: 380, cost: 190, minReturn: 3, nCredit: 25, breakBonus: 0.05,
      cover: 0.25, snowTrap: 0.5 }),

    crop({ id: 'buckwheat', group: 'other', color: '#8d5a97',
      name: { en: 'Buckwheat', ru: 'Гречиха' },
      Tb: 7, gdd: 950, sowT: 12, sowDelay: 15, sowWindow: 25,
      KcIni: 0.35, KcMid: 1.0, KcEnd: 0.3, Zr: 0.8, p: 0.5, Ky: 1.1, Theat: 30, frostKill: -1,
      Ym: 1.6, HI: 0.30, price: 280, cost: 160, minReturn: 2, cover: 0.3, snowTrap: 0.5 }),

    crop({ id: 'greenmanure', group: 'legume', color: '#2e8b57', harvestable: false, greenManure: true,
      name: { en: 'Green manure (pea, ploughed in)', ru: 'Сидеральный пар (горох на зелёное удобрение)' },
      Tb: 3, gdd: 700, sowT: 6, sowDelay: 10, sowWindow: 25,
      KcIni: 0.5, KcMid: 1.1, KcEnd: 1.0, Zr: 0.8, p: 0.4, Ky: 1.0, Theat: 32, frostKill: -6,
      Ym: 0, biomassMax: 4.5, HI: 1, price: 0, cost: 80, minReturn: 3, nCredit: 60, breakBonus: 0.05,
      cover: 0.2, snowTrap: 0.45 }),

    crop({ id: 'fallow', group: 'fallow', color: '#6b5b4b', harvestable: false, fallow: true,
      name: { en: 'Black fallow (no crop)', ru: 'Чистый (чёрный) пар' },
      sowT: 9, sowDelay: 12, sowWindow: 0, Ym: 0, price: 0, cost: 40, nCredit: 20,
      Zr: 0.3, cover: 0.05, snowTrap: 0.4 })
  ];

  var BY_ID = {};
  CROPS.forEach(function (c) { BY_ID[c.id] = c; });

  // Economic & management constants (editable in the UI)
  var ECON = {
    nPrice: 1.1,          // USD per kg N saved thanks to legume / fallow nitrogen credit
    waterCostPerMm: 0.3,  // USD per mm per ha of irrigation water delivered (~USD 0.03 / m3)
    irrigEfficiency: 0.75 // field application efficiency (gross = net / efficiency)
  };

  var api = { CROPS: CROPS, BY_ID: BY_ID, ECON: ECON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CropDB = api;
})(this);
