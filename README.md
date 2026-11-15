# Crop Rotation Crash Test

**NASA Space Apps Challenge 2026 · Challenge: “Field Shift: Adapting Farms with NASA Data”**
Team of 9th-grade students from Astana, Kazakhstan

> Enter your rotation. We drive it through every real season on your field since 1982, using NASA weather, and show which years would have broken it, why, and the smallest change that makes it hold.

*Русская версия ниже ↓*

![Crash-test report for a fallow–wheat–wheat–barley plan near Astana](docs/screenshot.png)

## What it does

Car makers crash-test a car before anyone drives it. We do the same for a farmer's crop rotation.

1. **Your farm.** Click your field on the map. The app downloads 45 years (1981–2025) of daily NASA POWER weather for that exact point. It also downloads the soil (texture, organic carbon) from ISRIC SoilGrids, and you can replace that with your own soil test. You can also mark the field as irrigated, set a water quota, and say whether straw is left on the field.
2. **Your plan.** Enter your rotation: 1–4 crops, repeated in a loop. There are 15 options, including spring and winter wheat, barley, pulses, oilseeds, black fallow and green manure.
3. **Your priorities.** Set sliders for income, reliability, soil health and water saving. Pick a climate (real weather, +1.5 °C, or +2.5 °C with −10 % rain) and tick the crops you can actually grow and sell.
4. **Crash test.** The app drives the plan, day by day, through every real season at your field. It starts the plan from every position, so every crop meets every year. You get:
   - a **verdict** (PASSED / DAMAGED / CRASHED) with star ratings for income, reliability, soil and water;
   - a **crash map** showing every crop × every year, with the cause of each failure (drought, heat at flowering, frost, winter-kill, not ripening, too-short rotation);
   - **“Why did this year fail?”**: click any year to see how much water the crop needed and how much the weather gave (for example, “1998: spring wheat needed 385 mm, rain gave 81 mm, the soil held 144 mm, the crop got 168 mm”), with a day-by-day water chart and a button that shows that year's MODIS greenness on the map;
   - the **smallest change** to your plan that helps the most, for your priorities;
   - the **best rotations** out of ~800 tested automatically;
   - a **climate stress test**: how your plan and the best plan behave in a warmer and drier future;
   - **Is the risk growing?**: loss-making years in 1982–2002 compared with 2003–2025;
   - **What if prices change?**: a ±20 % price slider that re-ranks every tested rotation and shows whether the recommendation still holds;
   - a **NASA MODIS NDVI layer** (NASA GIBS) on the map for any year since 2000, and a before/after comparison of the **Aral Sea in 2000 and 2014** (MODIS Terra true colour) linked to an irrigated Kyzylorda farm;
   - charts of income, the soil-carbon trend, the farm's climate fingerprint, and a check of our model against NASA's own soil-moisture product;
   - **Next season outlook**: this year's NASA POWER data (the latest available day) show how much water the field holds now compared with every past autumn; the five most similar autumns point to the crop that did best in the following season;
   - **When to sow**: each crop sown 1–2 weeks earlier or later, with income and crash rate for each choice;
   - **How much irrigation water pays off**: income and crashes for seasonal quotas from 0 to 800 mm;
   - **Side-by-side comparison** of your rotation with any alternative;
   - **Your whole farm**: totals for the farm area and the soil-carbon difference in tonnes of CO₂ and dollars at a chosen carbon price;
   - **Climate 2050**: the same seasons +2 °C and −10 % rain, loss years now vs 2050 and a 2050 crash map (a simplified scenario, not a forecast);
   - an absolute **soil health index** (0–100) with its components;
   - a **crop insurance calculator**: loss risk and a fair premium in tenge;
   - **worst case in a row**: a drought year repeated 2–4 times;
   - **water per kilogram** of grain for each crop;
   - **wind erosion and the Virgin Lands**: windy spring days from NASA POWER WS2M;
   - a **game**: beat the AI optimiser in five tries;
   - a **voice summary** (browser speech) and a printable **field risk passport** for a bank or insurer;
   - a **money race**: animated cumulative income of your rotation against the AI's best rotation over 44 real years;
   - the **chance of losing money over the next 10 years** from 5,000 bootstrapped futures (real climate and Climate 2050);
   - **where in Kazakhstan your rotation works**: the same plan crash-tested on every example farm, on a map;
   - a **living field** on the home screen: a wheat field that replays every real year of NASA weather;
   - the interface in **English, Russian and Kazakh** (the Kazakh text was machine-assisted and should be checked by a native speaker);
   - a **link** that reopens the same test (location, rotation, priorities) on another computer;
   - a printable report and a downloadable season-by-season calculation (CSV with weather, water need and use, yield and profit, plus all inputs).

## NASA data

| Data | What we use it for |
|---|---|
| **NASA POWER** daily point API (Agroclimatology), 1981–2025: `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`, `RH2M`, `WS2M` (from MERRA-2, CERES/GEWEX) | Drives everything: Penman-Monteith evapotranspiration, the soil water balance, snow, crop development, heat/frost events, and erosion-risk days (strong wind, downpours) |
| **MERRA-2 root-zone soil wetness** `GWETROOT` (via POWER) | Independent validation of our soil-water model (spring wheat every year, like the fixed vegetation in MERRA-2). Monthly growing-season anomaly correlation r = 0.67–0.83 at six of the seven example farms; only 0.18 in the Kyzylorda desert, and the app says so there |
| **MODIS Terra** via **NASA GIBS**: `MODIS_Terra_L3_NDVI_16Day` (WMTS) and `MODIS_Terra_CorrectedReflectance_TrueColor` (WMS) | NDVI greenness layer on the map for any year since 2000; Aral Sea images of 21 Aug 2000 and 19 Aug 2014 (`assets/sat/`). Counting water-coloured pixels gives roughly 21,200 km² → 6,300 km² of open water (≈ −70 %, rough estimate) |
| ISRIC **SoilGrids 2.0** (non-NASA, open) | Clay, sand, organic carbon and bulk density at 0–30 cm. These give plant-available water and the starting soil carbon |

## How the model works (short)

A transparent, daily, process-light model in plain JavaScript (`js/model.js`):

- **ET₀:** FAO-56 Penman-Monteith from the POWER variables (solar radiation before 1984 is estimated with the FAO-56 Hargreaves formula, because POWER radiation starts in 1984).
- **Soil water:** a two-layer bucket 1.8 m deep. Available water comes from Saxton & Rawls (2006) pedotransfer functions. Runoff uses the SCS curve number, bare-soil evaporation follows FAO-56 (two stages), and snow is trapped by stubble and melted by degree-days.
- **Crops:** climate-driven sowing windows (they work anywhere, including the southern hemisphere), growing-degree-day phenology, and FAO-56 Kc and Ks. Yield follows the FAO-33 response to water (Ky) and is reduced for heat at flowering, frost, winter-kill under thin snow, not ripening before the autumn frost, and disease when a crop returns too soon.
- **Rotation effects:** nitrogen credit from legumes, green manure and fallow; a break-crop bonus; a cereal-after-cereal penalty.
- **Soil carbon:** a simplified ICBM-type balance. Humified residues and roots are weighed against decomposition driven by temperature and moisture.
- **Soil health score:** the carbon trend plus the 4 USDA-NRCS soil health principles (keep soil covered, keep living roots, maximise diversity, minimise disturbance).
- **Crash** = a season that loses more than half of the money put into the field. **Dent** = a loss-making season.
- **Optimiser:** all distinct cyclic rotations of 1–4 crops from the farmer's crop list, plus every one-edit variant of the farmer's plan. They are scored by min-max-normalised pillars weighted by the farmer's sliders.

Full description: open “How it works and where the data comes from” at the bottom of the app.

## Run it

It is a static site with no build step and no server code.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly also works.

- The seven example farms (`data/presets/*.js`) contain real NASA POWER and SoilGrids data, so the demo works offline. To regenerate them, run `python3 tools/build_presets.py`.
- Any other location is downloaded live from NASA POWER in the browser (CORS is open), which takes about 5–10 s.
- Tests: `npm test` (Node ≥ 18, no dependencies).

## Project structure

```
index.html            UI (English / Russian)
css/style.css
js/model.js           simulation, crash test, scoring, optimiser, validation
js/crops.js           crop parameter database (FAO-56 / FAO-33 based, editable prices)
js/app.js             UI controller, NASA POWER & SoilGrids loading, rendering
js/charts.js          tiny SVG charts
js/i18n.js            EN / RU strings
data/presets/         real NASA POWER + SoilGrids data for 7 example farms
assets/sat/           MODIS Terra images of the Aral Sea from NASA GIBS
tools/build_presets.py
tests/                Node tests (FAO-56 ET0 example, yield sanity, NASA GWETROOT agreement…)
vendor/leaflet/       map library (BSD-2-Clause)
```

## Assumptions to know

- Yield potentials, prices and costs are editable starting values (table in the app) and should be replaced with the farm's own numbers.
- POWER weather is a ~0.5° grid average; local showers and hail can differ.
- Pests, weeds and fertiliser enter through rotation rules.
- A lab soil test is better than SoilGrids, which often reads high for organic carbon in steppe soils.

## Use of AI

AI assistance (Claude by Anthropic) was used to help write and debug the code and the texts. The idea, the choice of crops and the priorities came from the team, and the team checked the results against published Kazakhstan yields and agronomy rules. No AI-generated images, video or audio are presented as NASA data.

## Credits & licence

- Weather: NASA POWER Project, NASA Langley Research Center (power.larc.nasa.gov). NASA does not endorse this project.
- Soil: ISRIC SoilGrids 2.0 (CC-BY 4.0).
- Map: Leaflet, © OpenStreetMap contributors.
- Methods: FAO Irrigation & Drainage Papers 33 & 56; Saxton & Rawls (2006); Andrén & Kätterer (1997) ICBM; USDA-NRCS soil health principles.
- Code: MIT licence (see `LICENSE`).

---

# Краш-тест севооборота (RU)

**NASA Space Apps Challenge 2026 · челлендж «Field Shift: Adapting Farms with NASA Data»** · команда девятиклассников из Астаны.

Автопроизводители проводят краш-тест машины до того, как на ней кто-то поедет. Мы делаем то же самое с севооборотом фермера.

1. **Хозяйство.** Кликаете своё поле на карте. Сервис скачивает 45 лет (1981–2025) ежедневной погоды NASA POWER для этой точки и почву из SoilGrids (её можно заменить своим анализом). Можно также указать орошение с лимитом воды и оставляете ли вы солому на поле.
2. **План.** Вводите свой севооборот из 1–4 культур, он повторяется по кругу.
3. **Приоритеты.** Выставляете ползунки: доход, надёжность, почва, вода. Выбираете климатический сценарий и отмечаете культуры, которые реально можете выращивать и продавать.
4. **Краш-тест.** План день за днём прогоняется через каждый реальный сезон на вашем поле. Результат:
   - вердикт (ПРОЙДЕН / ЕСТЬ ПОВРЕЖДЕНИЯ / АВАРИЯ) со звёздами;
   - карта аварий «культура × год» с причинами;
   - **самое маленькое изменение плана**, которое даёт наибольшую пользу;
   - лучшие севообороты из ~800 проверенных;
   - «Почему год провалился?»: клик по году показывает, сколько воды нужно было культуре и сколько дала погода;
   - «Риск растёт?»: убыточные годы 1982–2002 против 2003–2025;
   - «А если цены изменятся?»: ползунок цен ±20 %;
   - слой зелёности MODIS NDVI (NASA GIBS) на карте и снимки Арала 2000 и 2014 годов;
   - климатический стресс-тест;
   - проверка модели по спутниковой влажности почвы NASA (GWETROOT);
   - отчёт для печати и CSV.

**Запуск:** выполните `python3 -m http.server 8000` и откройте http://localhost:8000, либо просто откройте `index.html`. Тесты: `npm test`.
