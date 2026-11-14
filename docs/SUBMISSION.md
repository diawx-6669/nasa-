# Space Apps 2026 submission: draft texts

Copy these into the project page on spaceappschallenge.org and edit them in your own words. Judges value an authentic team voice.

## Project name
Crop Rotation Crash Test

## Challenge
Field Shift: Adapting Farms with NASA Data

## High-level summary (≈ 150 words)
Advice to farmers about crop rotation is usually abstract. Our tool is concrete: it crash-tests the farmer's **own** rotation. The farmer clicks the field on a map, enters a rotation of 1–4 crops and sets sliders for income, reliability, soil health and water saving. The app downloads 35 years of daily NASA POWER weather and the soil for that exact point. It then drives the rotation through every real season since 1991 with a transparent soil-water, crop and soil-carbon model. The result shows which years would have wrecked the plan and why (drought, heat at flowering, frost, winter-kill, too-short rotation). It also searches ~800 alternative rotations and suggests the **smallest change** that helps most for the farmer's priorities, and it repeats the test for a +1.5 °C and a +2.5 °C / −10 % rain climate. For a typical North-Kazakhstan plan (fallow–wheat–wheat–barley), replacing the second wheat with chickpea cuts crash seasons from 7 % to 3 % and raises the average margin from ~$60 to ~$100 per hectare per year. These numbers use our illustrative prices.

## Project details
- **What it does:** see README “What it does”.
- **How it works:** a daily model written in plain JavaScript. It computes FAO-56 Penman-Monteith ET₀, a two-layer soil water balance with snow and stubble snow-trapping, GDD phenology and FAO-33 yield response to water. Penalties cover heat, frost, winter-kill and immaturity. Rotation effects include legume N credit and disease from short return intervals. Soil carbon uses an ICBM-type balance. The soil-health score follows the 4 USDA-NRCS principles. The optimiser enumerates every distinct cyclic rotation of the farmer's crops plus every one-edit variant of the farmer's own plan, and scores them with the farmer's weights.
- **Benefits:** the farmer sees the risk on **their** field, in **their** years, in money and soil terms, and gets one concrete, small change instead of a lecture. Everything runs in the browser, works offline for the example farms, and is bilingual (English/Russian).
- **Tools:** HTML/CSS/JavaScript (no framework), Leaflet + OpenStreetMap, Python (to pre-download the example data), Node test runner.
- **Creativity:** the “crash test” framing; testing a plan from every starting position, so each crop meets every year; the “smallest fix” search; and validating our soil-water model against NASA's independent GWETROOT product.
- **Factors considered:** honesty about uncertainty (illustrative prices that can be edited, a limitations section); a sowing calendar that works anywhere; snow, which matters a lot in Kazakhstan; irrigation quotas for the south; and soil carbon, not only yield.

## NASA data
- NASA POWER daily point API, Agroclimatology community, 1991-01-01 to 2025-12-31: T2M_MAX, T2M_MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, RH2M, WS2M (MERRA-2 meteorology, CERES/GEWEX solar). https://power.larc.nasa.gov/
- NASA MERRA-2 root-zone soil wetness (GWETROOT) via POWER: used to validate the model. At the Kazakhstan example farms the monthly anomaly correlation is about 0.6–0.8.

## Space agency partner & other data
- ISRIC SoilGrids 2.0 (soil texture, organic carbon, bulk density, 0–30 cm), CC-BY 4.0.
- FAO Irrigation & Drainage Papers 33 and 56 (crop coefficients), Saxton & Rawls 2006, the ICBM soil-carbon model, USDA-NRCS soil health principles.

## Use of artificial intelligence
We used an AI assistant (Claude by Anthropic) to help write and debug the code and draft the texts. The team chose the idea, the crops and the scenarios, and checked the results against known yields and agronomy rules. No AI-generated images, audio or video are used. All weather and soil numbers come from NASA POWER and ISRIC SoilGrids, not from AI.
