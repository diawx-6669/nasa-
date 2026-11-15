#!/usr/bin/env python3
"""Download real NASA POWER daily data + ISRIC SoilGrids soil data for the
preset locations and store them as small JS files in data/presets/.

The web app works without these files (it fetches the same APIs live in the
browser); presets just make the demo instant and usable offline.

Usage:  python3 tools/build_presets.py
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "presets")

START, END = "19810101", "20251231"
PARAMS = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M", "GWETROOT"]
# decimals kept per parameter (keeps files small, far below data accuracy anyway)
DEC = {"T2M_MAX": 1, "T2M_MIN": 1, "PRECTOTCORR": 1, "ALLSKY_SFC_SW_DWN": 1,
       "RH2M": 0, "WS2M": 1, "GWETROOT": 2}

PRESETS = [
    # id, name_en, name_ru, lat, lon
    ("akmola", "Akmola region (near Astana), KZ", "Акмолинская обл. (у Астаны), КЗ", 51.35, 71.00),
    ("kostanay", "Kostanay region, KZ", "Костанайская обл., КЗ", 53.00, 63.30),
    ("nko", "North Kazakhstan (Petropavl), KZ", "Северо-Казахстанская обл., КЗ", 54.70, 69.50),
    ("pavlodar", "Pavlodar region, KZ", "Павлодарская обл., КЗ", 52.00, 76.50),
    ("turkistan", "Turkistan region (irrigated south), KZ", "Туркестанская обл. (орошаемый юг), КЗ", 43.30, 68.30),
    ("kyzylorda", "Kyzylorda region (Syr Darya, irrigated), KZ", "Кызылординская обл. (Сырдарья, орошение), КЗ", 44.80, 65.40),
    ("kansas", "Kansas, USA (for comparison)", "Канзас, США (для сравнения)", 38.50, -98.50),
]


def get_json(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # network hiccup / rate limit
            print("  retry", i + 1, e, file=sys.stderr)
            time.sleep(15 * (i + 1))
    raise RuntimeError("failed: " + url)


def power(lat, lon):
    url = ("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=" + ",".join(PARAMS) +
           f"&community=AG&longitude={lon}&latitude={lat}&start={START}&end={END}&format=JSON")
    d = get_json(url)
    p = d["properties"]["parameter"]
    dates = sorted(p[PARAMS[0]].keys())
    out = {"start": dates[0], "n": len(dates), "elev": d["geometry"]["coordinates"][2]}
    for k in PARAMS:
        vals = [p[k][t] for t in dates]
        out[k] = [None if v == -999 else round(v, DEC[k]) for v in vals]
        # compact ints where possible
        out[k] = [int(v) if (v is not None and float(v).is_integer()) else v for v in out[k]]
    return out


def soil_once(lat, lon):
    url = ("https://rest.isric.org/soilgrids/v2.0/properties/query?"
           f"lon={lon}&lat={lat}&property=soc&property=clay&property=sand&property=bdod"
           "&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean")
    d = get_json(url)
    res = {}
    w = [5, 10, 15]
    for layer in d["properties"]["layers"]:
        vals = [x["values"]["mean"] for x in layer["depths"]]
        if any(v is None for v in vals):
            return None
        f = layer["unit_measure"]["d_factor"]
        res[layer["name"]] = sum(v / f * wi for v, wi in zip(vals, w)) / 30.0
    # units: soc g/kg, clay %, sand %, bdod kg/dm3
    return {"socGkg": round(res["soc"], 1), "clay": round(res["clay"], 1),
            "sand": round(res["sand"], 1), "bd": round(res["bdod"], 2), "src": "SoilGrids 2.0 (0-30 cm)"}


def soil(lat, lon):
    offs = [(0, 0), (0.03, 0), (-0.03, 0), (0, 0.04), (0, -0.04), (0.06, 0.06), (-0.06, -0.06),
            (0.1, 0), (-0.1, 0), (0, 0.12), (0, -0.12)]
    for dy, dx in offs:
        s = soil_once(round(lat + dy, 3), round(lon + dx, 3))
        time.sleep(13)  # SoilGrids fair-use: max 5 requests/minute
        if s:
            s["lat"], s["lon"] = round(lat + dy, 3), round(lon + dx, 3)
            return s
    return None


KK_NAMES = {"akmola": "Ақмола облысы (Астана маңы), ҚЗ", "kostanay": "Қостанай облысы, ҚЗ", "nko": "Солтүстік Қазақстан облысы (Петропавл), ҚЗ", "pavlodar": "Павлодар облысы, ҚЗ", "turkistan": "Түркістан облысы (суармалы оңтүстік), ҚЗ", "kyzylorda": "Қызылорда облысы (Сырдария, суару), ҚЗ", "kansas": "Канзас, АҚШ (салыстыру үшін)"}


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    only = set(sys.argv[1:])
    for pid, en, ru, lat, lon in PRESETS:
        if only and pid not in only:
            continue
        print("==", pid)
        w = power(lat, lon)
        s = soil(lat, lon)
        print("  soil:", s)
        obj = {"id": pid, "lat": lat, "lon": lon, "name": {"en": en, "ru": ru},
               "weather": w, "soil": s,
               "source": "NASA POWER daily API v2 (community=AG), downloaded " + time.strftime("%Y-%m-%d")}
        with open(os.path.join(OUT, pid + ".js"), "w") as f:
            f.write("window.PRESET_DATA=window.PRESET_DATA||{};window.PRESET_DATA[" + json.dumps(pid) + "]=")
            json.dump(obj, f, separators=(",", ":"))
            f.write(";\n")
        index.append({"id": pid, "lat": lat, "lon": lon, "name": {"en": en, "ru": ru, "kk": KK_NAMES.get(pid, en)}})
    if not only:
        with open(os.path.join(OUT, "index.js"), "w") as f:
            f.write("window.PRESETS=")
            json.dump(index, f, ensure_ascii=False, indent=1)
            f.write(";\n")


if __name__ == "__main__":
    main()
