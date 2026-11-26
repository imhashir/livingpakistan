"""Natural hazards: earthquakes, notable disasters, heat records, GLOF sites, 2022 floods, EM-DAT, active faults.

Sources (all downloaded through fetch()/page_text()/wikitext() so provenance lands in data/raw/hazards/manifest.json):
* USGS ComCat FDSN event CSV, M>=4.5 since 1900 in a box around Pakistan (columnar arrays).
* Wikipedia infoboxes / article text + Wikidata for six notable deadly earthquakes, matched to ComCat ids.
* Heat records from Wikipedia climate boxes and article text, the WMO 2019 press release (Turbat 53.7 C).
* GLOF sites from the GCF FP018 (UNDP GLOF-II) funding proposal, a Heliyon 2024 paper on Shishper and Dawn.
* 2022 floods from the NDMA SITREP No 158 (18 Nov 2022) and the World Bank-hosted PDNA main report.
* EM-DAT country profile (HDX xlsx): per-year, per-disaster-type rows, summarised by type and decade.
* GEM Global Active Faults (harmonized GeoJSON), clipped to the map box and simplified.

Every hand-typed number is checked against the fetched reference text with verified(); a miss becomes null.
"""
from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict

from pipeline.common import BBOX, fetch, http_json, interim, write_json
from pipeline.sources.unesco import (blurb_for, by_enwiki, page_text, pcode_of, point, verified, wiki_url,
                                     wikitext, wp_summaries)

ID = "hazards"

USGS_BASE = ("https://earthquake.usgs.gov/fdsnws/event/1/{kind}?format={fmt}&starttime={t0}&endtime={t1}"
             "&minmagnitude=4.5&minlatitude=23&maxlatitude=37.5&minlongitude=60.5&maxlongitude=78&orderby=time-asc")
EMDAT_URL = ("https://data.humdata.org/dataset/982bb9ef-b909-4cf2-8a73-ac97b519339c/resource/"
             "5326989b-f8f7-446b-8d57-4054b6aa523e/download/emdat-country-profiles_pak_2026_11_25.xlsx")
GEM_URL = ("https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/"
           "gem_active_faults_harmonized.geojson")
NDMA_URL = ("https://web.archive.org/web/20230106162810id_/http://cms.ndma.gov.pk/storage/app/public/"
            "situation-reports/November2022/N2n1eEarMt6q6Rb8ZYwn.pdf")
NDMA_REF = "https://web.archive.org/web/20230106162810/http://cms.ndma.gov.pk/storage/app/public/situation-reports/November2022/N2n1eEarMt6q6Rb8ZYwn.pdf"
PDNA_URL = ("https://thedocs.worldbank.org/en/doc/4a0114eb7d1cecbbbf2f65c5ce0789db-0310012022/original/"
            "Pakistan-Floods-2022-PDNA-Main-Report.pdf")
WMO_URL = ("https://web.archive.org/web/20231218172054/https://public-old.wmo.int/en/media/press-release/"
           "wmo-verifies-3rd-and-4th-hottest-temperature-recorded-earth")
GCF_FP018 = "https://www.greenclimate.fund/sites/default/files/document/funding-proposal-fp018-undp-pakistan.pdf"
GCF_PAGE = "https://www.greenclimate.fund/project/fp018"
PMC_SHISHPER = "https://pmc.ncbi.nlm.nih.gov/articles/PMC11369478/"
DAWN_HASSANABAD = "https://www.dawn.com/news/1688466"

INFO = {
    "id": ID,
    "title": "Natural hazards of Pakistan: earthquakes, faults, heat, glacial floods, 2022 floods, EM-DAT",
    "publisher": "USGS ComCat; GEM Foundation; CRED EM-DAT via HDX; NDMA Pakistan; World Bank/GoP PDNA; WMO; "
                 "UNDP/GCF; Wikipedia/Wikidata",
    "vintage": "ComCat 1900-2026-11; EM-DAT profile 2026-11-25; NDMA SITREP 158 (18 Nov 2022); PDNA Oct 2022",
    "url": "https://earthquake.usgs.gov/earthquakes/search/",
    "files_urls": [USGS_BASE.format(kind="query", fmt="csv", t0="1900-01-01", t1="now"), GEM_URL, EMDAT_URL,
                   NDMA_REF, PDNA_URL, WMO_URL, GCF_FP018, GCF_PAGE, PMC_SHISHPER, DAWN_HASSANABAD,
                   "https://query.wikidata.org/sparql", "https://en.wikipedia.org/"],
    "license": "USGS public domain; GEM GAF CC BY-SA 4.0; EM-DAT (CRED/UCLouvain) non-commercial with attribution; "
               "NDMA/PDNA/GCF public reports; Wikipedia CC BY-SA; Wikidata CC0",
    "used_for": ["Hazards layer: earthquake dots and fault lines", "Disaster Almanac (notable quakes, 2022 floods)",
                 "Surprise Me: heat records (Jacobabad, Turbat, Mohenjo-daro)", "GLOF sites in GB/KP",
                 "EM-DAT summary charts"],
    "caveats": ("ComCat completeness varies hugely over time (pre-1973 entries are mostly ISC-GEM M~5.5+); the box "
                "includes Afghanistan, Iran, India and Tajikistan, pcode is set only for points inside Pakistan. "
                "Death tolls of historic quakes are ranges from Wikipedia infoboxes and differ between sources "
                "(Wikidata values are given separately). Heat records mix WMO-verified (Turbat) and PMD/Wikipedia "
                "station values; Wikipedia climate boxes give monthly extremes without dates. The EM-DAT HDX "
                "profile only covers 2000 onwards; damage is as published (USD, original and CPI-adjusted). GLOF "
                "sites are a short, referenced list, not an inventory (ICIMOD inventory not openly downloadable). "
                "Faults are simplified at ~0.01 deg and are not suitable for site hazard assessment."),
}


# ============================================================================================ (a) ComCat quakes

def _usgs_rows():
    windows = [("1900-01-01", "now")]
    try:
        n = http_json(USGS_BASE.format(kind="count", fmt="geojson", t0="1900-01-01", t1="now"))["count"]
    except Exception:  # pragma: no cover - network
        n = 0
    if n > 19000:  # stay below the 20000-row service limit
        windows = [("1900-01-01", "1990-01-01"), ("1990-01-01", "2005-01-01"), ("2005-01-01", "2015-01-01"),
                   ("2015-01-01", "now")]
    rows = []
    for t0, t1 in windows:
        name = f"usgs_comcat_m45_{t0[:4]}_{t1[:4]}.csv"
        p = fetch(ID, USGS_BASE.format(kind="query", fmt="csv", t0=t0, t1=t1), name)
        rows += list(csv.DictReader(io.StringIO(p.read_text())))
    return rows


def quakes():
    rows = _usgs_rows()
    cols = {k: [] for k in ("id", "time", "lat", "lon", "depth", "mag", "magtype", "place", "pcode")}
    other = []
    seen = set()
    for r in sorted(rows, key=lambda r: r["time"]):
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        lat, lon = float(r["latitude"]), float(r["longitude"])
        if r.get("type", "earthquake") != "earthquake":
            other.append({"id": r["id"], "time": r["time"][:19] + "Z", "lat": round(lat, 3), "lon": round(lon, 3),
                          "mag": float(r["mag"]) if r["mag"] else None, "type": r["type"], "place": r["place"]})
            continue
        cols["id"].append(r["id"])
        cols["time"].append(r["time"][:16] + "Z")
        cols["lat"].append(round(lat, 3))
        cols["lon"].append(round(lon, 3))
        cols["depth"].append(round(float(r["depth"]), 1) if r["depth"] else None)
        cols["mag"].append(round(float(r["mag"]), 1) if r["mag"] else None)
        cols["magtype"].append(r["magType"] or None)
        cols["place"].append(r["place"] or None)
        cols["pcode"].append(pcode_of(lat, lon))
    cols["n"] = len(cols["id"])
    cols["non_earthquake_events"] = other
    cols["ref"] = "https://earthquake.usgs.gov/earthquakes/search/"
    cols["note"] = "time = UTC to the minute; depth km; pcode = COD-AB district for epicentres inside Pakistan"
    return cols


# ============================================================================================ (b) notable quakes

QUAKES = [  # (id, enwiki title, short name)
    ("quetta-1935", "1935 Quetta earthquake", "1935 Quetta earthquake"),
    ("makran-1945", "1945 Balochistan earthquake", "1945 Balochistan (Makran) earthquake and tsunami"),
    ("pattan-1974", "1974 Pattan earthquake", "1974 Pattan (Hunza/Swat/Hazara) earthquake"),
    ("kashmir-2005", "2005 Kashmir earthquake", "2005 Kashmir earthquake"),
    ("awaran-2013", "2013 Balochistan earthquakes", "2013 Awaran (Balochistan) earthquake"),
    ("hindukush-2015", "October 2015 Hindu Kush earthquake", "2015 Hindu Kush earthquake"),
]


def _ibox(w, field):
    m = re.search(r"\n\s*\|\s*" + field + r"\s*=([^\n]*)", w)
    if not m:
        return None
    v = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>|<ref[^>]*>.*$", "", m.group(1)).strip()
    return v or None


def _num(s):
    return float(s.replace(",", "")) if s else None


def _coord(s):
    if not s:
        return None, None
    m = re.search(r"\{\{coord\|([^}]*)\}\}", s, re.I)
    if not m:
        return None, None
    parts = [p.strip() for p in m.group(1).split("|")]
    nums, hemi = [], []
    for p in parts:
        if re.fullmatch(r"-?\d+(\.\d+)?", p):
            nums.append(float(p))
        elif p in ("N", "S", "E", "W"):
            hemi.append(p)
            nums.append(p)
        else:
            break
    # forms: lat|lon  or  lat|N|lon|E  (degree-only; d|m|s forms are not used by these articles)
    if len(nums) >= 4 and nums[1] in ("N", "S") and nums[3] in ("E", "W"):
        lat, lon = nums[0] * (1 if nums[1] == "N" else -1), nums[2] * (1 if nums[3] == "E" else -1)
    elif len(nums) >= 2 and all(isinstance(x, float) for x in nums[:2]):
        lat, lon = nums[0], nums[1]
    else:
        return None, None
    return round(lat, 4), round(lon, 4)


def _casualties(s):
    out = {}
    if not s:
        return out
    m = re.search(r"(\d[\d,]*)(?:\s*(?:–|-|&ndash;)\s*(\d[\d,]*))?\s*(?:dead|deaths|fatalities|killed)", s)
    if m:
        if m.group(2):
            out["deaths_min"], out["deaths_max"] = int(_num(m.group(1))), int(_num(m.group(2)))
        else:
            out["deaths"] = int(_num(m.group(1)))
    m = re.search(r"(\d[\d,]*)\s*(?:injured|injuries)", s)
    if m:
        out["injured"] = int(_num(m.group(1)))
    return out


def _match_usgs(q, anss, t, lat, lon):
    """ComCat event id for a notable quake: infobox ANSS id if present in the catalogue, else nearest in time
    (<= 3 min) and space (<= 1.5 deg)."""
    ids = q["id"]
    if anss and anss in ids:
        return anss, ids.index(anss)
    if not t or lat is None:
        return None, None
    best = None
    for i, (tt, la, lo) in enumerate(zip(q["time"], q["lat"], q["lon"])):
        if tt[:10] != t[:10]:
            continue
        dmin = abs(int(tt[11:13]) * 60 + int(tt[14:16]) - (int(t[11:13]) * 60 + int(t[14:16])))
        dd = abs(la - lat) + abs(lo - lon)
        if dmin <= 3 and dd <= 1.5 and (best is None or dd < best[0]):
            best = (dd, i)
    return (ids[best[1]], best[1]) if best else (None, None)


def notable_quakes(q):
    titles = [t for _, t, _ in QUAKES]
    wd = by_enwiki(ID, "wikidata_notable_quakes.json", titles,
                   {"deaths": "P1120", "mag": "P2528", "date": "P585", "injured": "P1339"})
    summ = wp_summaries(ID, titles)
    out = []
    for qid_, title, name in QUAKES:
        w = wikitext(ID, title)
        ts = _ibox(w, "timestamp")
        mag_s = _ibox(w, "magnitude") or ""
        mm = re.search(r"(\d\.\d)", mag_s)
        sc = re.search(r"\{\{M\|(w|s|b|L)", mag_s)
        dep = re.search(r"(\d+(?:\.\d+)?)", _ibox(w, "depth") or "")
        tsu = re.search(r"(\d+(?:\.\d+)?)\|m", _ibox(w, "tsunami") or "")
        anss = _ibox(w, "anss_url") or _ibox(w, "anss-url")
        lat, lon = _coord(_ibox(w, "coordinates"))
        d = wd.get(title, {})
        if lat is None and d.get("lat") is not None:
            lat, lon = d["lat"], d["lon"]
        t_iso = (ts.replace(" ", "T") + "Z") if ts and re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", ts) else None
        usgs_id, ui = _match_usgs(q, anss, t_iso, lat, lon)
        facts = {"time_utc": t_iso, "magnitude": float(mm.group(1)) if mm else None,
                 "mag_scale": ("M" + sc.group(1)) if sc else None,
                 "depth_km": float(dep.group(1)) if dep else None,
                 "tsunami_m": float(tsu.group(1)) if tsu else None,
                 **_casualties(_ibox(w, "casualties")),
                 "casualties_text": re.sub(r"\[\[|\]\]|\{\{[^}]*\}\}", "", _ibox(w, "casualties") or "") or None,
                 "deaths_wikidata": int(float(d["deaths"])) if d.get("deaths") else None,
                 "usgs_id": usgs_id, "usgs_mag": q["mag"][ui] if ui is not None else None,
                 "usgs_url": f"https://earthquake.usgs.gov/earthquakes/eventpage/{usgs_id}" if usgs_id else None}
        fb = None
        if facts["magnitude"] and t_iso:
            fb = f"{facts['mag_scale'] or 'M'} {facts['magnitude']:g} earthquake on {t_iso[:10]} (UTC)" + (
                f"; {facts['casualties_text']}." if facts["casualties_text"] else ".")
        out.append(point(id=qid_, name=name, lat=lat, lon=lon, blurb=blurb_for(summ.get(title), None, fb),
                         facts=facts, src=ID, ref=wiki_url(title), wikidata=d.get("qid"), snap_km=60))
    return out


# ============================================================================================ (c) heat records

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _weather_box(w):
    i = w.find("Weather box")
    if i < 0:
        return None
    b = w[i:i + 8000]

    def row(kind):
        vals = {}
        for mo in MONTHS:
            m = re.search(r"\|\s*" + mo + r" " + kind + r" C\s*=\s*([-−\d.]+)", b)
            if m:
                vals[mo] = float(m.group(1).replace("−", "-"))
        return vals
    rec, hi = row("record high"), row("high")
    loc = re.search(r"location\s*=\s*([^\n|]*)", b)
    out = {"box_location": loc.group(1).strip() if loc else None}
    if rec:
        mo = max(rec, key=rec.get)
        out.update(box_record_high_c=rec[mo], box_record_high_month=mo)
    if hi:
        mo = max(hi, key=hi.get)
        out.update(hottest_month=mo, hottest_month_mean_max_c=hi[mo])
    return out


def heat():
    lst = wikitext(ID, "List of extreme weather records in Pakistan")
    wmo = page_text(ID, WMO_URL, "wmo_press_2019.html")
    cities = ["Jacobabad", "Sibi", "Turbat", "Mohenjo-daro", "Dadu, Sindh", "Larkana"]
    wd = by_enwiki(ID, "wikidata_heat_cities.json", cities)
    summ = wp_summaries(ID, cities)
    out = []

    def add(key, title, name, facts, ref):
        d = wd.get(title, {})
        box = _weather_box(wikitext(ID, title)) or {}
        facts = {**facts, **box}
        out.append(point(id=f"heat-{key}", name=name, lat=d.get("lat"), lon=d.get("lon"),
                         blurb=None, facts=facts, src=ID, ref=ref, wikidata=d.get("qid"),
                         wiki=wiki_url(title)))
        return out[-1]

    w = wikitext(ID, "Jacobabad")
    add("jacobabad", "Jacobabad", "Jacobabad", {
        "record_high_c": verified(w, 52.8, r"highest recorded temperature is \{\{convert\|52\.8\|"),
        "record_date": verified(lst, "1919-06-12", r"12 June 1919 \|\| \{\{convert\|52\.8\|C\|F\}\} \|\| \[\[Jacobabad"),
        "may_2022_mean_c": verified(w, 43.0, r"mean temperature for the month of May broke the all-time record with "
                                             r"\{\{convert\|43\|"),
        "wet_bulb_35c_exceeded": verified(w, True, r"exceeded a \[\[wet-bulb temperature\]\] of \{\{cvt\|35\|C"),
        "superlative": verified(w, "one of the hottest places on earth", r"one of the hottest places on earth"),
    }, wiki_url("Jacobabad"))
    w = wikitext(ID, "Sibi")
    add("sibi", "Sibi", "Sibi", {
        "record_high_c": verified(w, 53.0, r"May record high C\s*=\s*53\.0"), "record_date": None,
        "earlier_record_c": verified(lst, 52.6, r"\{\{convert\|52\.6\|C\|F\}\} was recorded on June 5, 2003"),
        "earlier_record_date": verified(lst, "2003-06-05", r"52\.6\|C\|F\}\} was recorded on June 5, 2003"),
    }, wiki_url("Sibi"))
    add("turbat", "Turbat", "Turbat", {
        "record_high_c": verified(wmo, 53.7, r"Turbat one as 53\.7 °C"),
        "record_date": verified(wmo, "2017-05-28", r"Turbat, Pakistan, on 28 May 2017"),
        "uncertainty_c": verified(wmo, 0.4, r"53\.7 °C \(± 0\.4 °C\)"),
        "wmo_verified": verified(wmo, True, r"WMO verifies 3rd and 4th hottest temperature", r"Turbat"),
        "superlative": verified(lst, "highest temperature ever recorded in Pakistan (WMO-evaluated)",
                                r"officially evaluated temperature record extremes of \{\{convert\|53\.7\|C\|F\}\} "
                                r"in \[\[Turbat"),
    }, WMO_URL)
    w = wikitext(ID, "Mohenjo-daro")
    add("mohenjodaro", "Mohenjo-daro", "Mohenjo-daro", {
        "record_high_c": verified(w, 53.5, r"highest recorded temperature is \{\{convert\|53\.5\|°C\|°F\}\}, recorded in May 2010"),
        "record_date": verified(w, "2010-05", r"53\.5\|°C\|°F\}\}, recorded in May 2010"),
        "claim_note": "Some sources cite 54 C; the Wikipedia/PMD value used here is 53.5 C.",
    }, wiki_url("Mohenjo-daro"))
    w = wikitext(ID, "Dadu, Sindh")
    add("dadu", "Dadu, Sindh", "Dadu", {
        "record_high_c": verified(w, 51.5, r"highest recorded temperature in Dadu is 51\.5°C"), "record_date": None,
        "may_2010_c": verified(lst, 51.0, r"28 May 2010 \|\| rowspan=\"3\" \| \{\{convert\|51\|C\|F\}\}.{0,60}\[\[Dadu"),
    }, wiki_url("Dadu, Sindh"))
    w = wikitext(ID, "Larkana")
    add("larkana", "Larkana", "Larkana", {
        "record_high_c": verified(w, 53.0, r"highest recorded temperature is \{\{convert\|53\.0\|°C\|°F\|1\}\}, recorded On 26 May 2010"),
        "record_date": verified(w, "2010-05-26", r"53\.0\|°C\|°F\|1\}\}, recorded On 26 May 2010"),
    }, wiki_url("Larkana"))

    # blurbs: factual, built only from verified facts
    for p in out:
        f = p["facts"]
        bits = []
        if f.get("record_high_c") is not None:
            bits.append(f"record high {f['record_high_c']:g} °C" + (f" ({f['record_date']})" if f.get("record_date") else ""))
        if f.get("hottest_month_mean_max_c") is not None:
            bits.append(f"{f['hottest_month']} mean max {f['hottest_month_mean_max_c']:g} °C")
        p["blurb"] = (f"{p['name']}: " + "; ".join(bits) + ".")[:160] if bits else blurb_for(summ.get(p["name"]), None)
    ranked = sorted([p for p in out if p["facts"].get("record_high_c") is not None],
                    key=lambda p: -p["facts"]["record_high_c"])
    for i, p in enumerate(ranked, 1):
        p["facts"]["rank_record_high"] = i
    ranked = sorted([p for p in out if p["facts"].get("hottest_month_mean_max_c") is not None],
                    key=lambda p: -p["facts"]["hottest_month_mean_max_c"])
    for i, p in enumerate(ranked, 1):
        p["facts"]["rank_mean_max"] = i
    return out


# ============================================================================================ (d) GLOF

def glof():
    fp = page_text(ID, GCF_FP018, "gcf_fp018_funding_proposal.pdf")
    gcf = page_text(ID, GCF_PAGE, "gcf_fp018.html")
    pmc = page_text(ID, PMC_SHISHPER, "pmc_shishper_heliyon_2024.html")
    dawn = page_text(ID, DAWN_HASSANABAD, "dawn_1688466_hassanabad_bridge.html")
    titles = ["Hassanabad, Hunza", "Bagrot Valley", "Buni", "Attabad Lake", "Chitral"]
    wd = by_enwiki(ID, "wikidata_glof_places.json", titles)
    pts = []

    def add(key, title, name, blurb, facts, ref):
        d = wd.get(title, {})
        if d.get("lat") is None:
            print(f"  [glof] no coordinates for {title}; skipped")
            return
        pts.append(point(id=f"glof-{key}", name=name, lat=d["lat"], lon=d["lon"], blurb=blurb,
                         facts={**facts, "coord_src": "wikidata", "coord_of": title}, src=ID, ref=ref,
                         wikidata=d.get("qid")))

    add("shishper", "Hassanabad, Hunza", "Shishper Glacier lake / Hassanabad (Hunza)",
        "An ice-dammed lake from the surging Shishper Glacier burst on 7 May 2022, sweeping away the Hassanabad "
        "bridge on the Karakoram Highway." if verified(dawn, 1, r"Hassanabad bridge on the Karakoram Highway was on "
                                                             r"Saturday destroyed") else None,
        {"hazard": "ice-dammed glacial lake (surging glacier)",
         "lake_formed": verified(pmc, "2018-11", r"initiation in November 2018"),
         "outbursts": [x for x in (verified(pmc, "2019-06-22", r"June 22, 2019"),
                                   verified(pmc, "2020-05-29", r"May 29, 2020"),
                                   verified(pmc, "2022-05-07", r"GLOF on May 7th, 2022")) if x],
         "lake_max_area_km2_2022": verified(pmc, 0.33, r"lake area to 0\.33 km 2"),
         "impacts_2022": verified(dawn, "Hassanabad KKH bridge and two power plants swept away",
                                  r"Hassanabad bridge", r"two power plants of Hassanabad were also swept away"),
         "refs": [PMC_SHISHPER, DAWN_HASSANABAD]},
        PMC_SHISHPER)

    add("bagrot", "Bagrot Valley", "Bagrot Valley (Gilgit)",
        "Pilot valley of the first UNDP/Adaptation Fund GLOF risk-reduction project in Gilgit-Baltistan.",
        {"hazard": "GLOF-prone valley",
         "glof1_pilot_valley": verified(fp, True, r"vulnerability of communities in Bagrot and Bindogol valleys"),
         "people_protected_chira": verified(fp, 1350, r"orchards of 1,350 people in Chira village in Bagrote"),
         "refs": [GCF_FP018]}, GCF_FP018)
    add("booni", "Buni", "Booni Gol (Upper Chitral)",
        "Booni Gol glacier near Chitral produced an outburst flood in July 2010 that caused heavy erosion damage.",
        {"hazard": "glacier outburst flood",
         "event": verified(fp, "2010-07", r"Booni Gole Glacier located near Chitral that generated an outburst flood "
                                          r"in July 2010"),
         "refs": [GCF_FP018]}, GCF_FP018)
    add("chitral2015", "Chitral", "Chitral District GLOF 2015",
        "A July 2015 GLOF and monsoon flooding in Chitral District cost an estimated US$100 million to recover from.",
        {"hazard": "GLOF + monsoon flood", "event": verified(fp, "2015-07", r"July 2015 GLOF and monsoon flooding from "
                                                                            r"Chitral District"),
         "recovery_cost_usd": verified(fp, 100_000_000, r"Chitral\s+district after the GLOF event in 2015 is "
                                                        r"estimated to have cost US\$ 100 million"),
         "pinned_at": "Chitral town (district-level event)", "refs": [GCF_FP018]}, GCF_FP018)
    add("attabad", "Attabad Lake", "Attabad Lake (Hunza)",
        "A January 2010 landslide blocked the Hunza River at Attabad, impounding the lake and flooding upstream.",
        {"hazard": "landslide-dammed lake (not a GLOF)",
         "event": verified(fp, "2010-01", r"Attabad Lake in Hunza District, GB, in January 2010"),
         "refs": [GCF_FP018]}, GCF_FP018)

    context = {
        "glacial_lakes_gb_kp": verified(fp, 3044, r"3,044 glacial lakes"),
        "hazardous_lakes": verified(fp, 33, r"33 of these glacial lakes are hazardous"),
        "glof2_total_value_usd_m": verified(gcf, 37.5, r"Total project value \$ 37\.5 M"),
        "glof2_approved": verified(gcf, "2016-10-14", r"Date approved 14 Oct 2016"),
        "glof1_valleys": verified(fp, ["Bagrot (GB)", "Bindo Gol (KP)"], r"Bagrot and Bindogol valleys"),
        "ref": GCF_FP018, "ref_page": GCF_PAGE,
        "note": "Bindo Gol (Chitral; 2010 outburst) has no open coordinates, so it is listed here but not mapped. "
                "ICIMOD glacial lake inventory (rds.icimod.org) was not openly downloadable.",
    }
    return pts, context


# ============================================================================================ (e) 2022 floods

def flood2022():
    nd = page_text(ID, NDMA_URL, "ndma_sitrep158_2022-11-18.pdf")
    pd = page_text(ID, PDNA_URL, "pdna_2022_main_report.pdf")
    out = {}

    def fact(key, value, text, ref, *rx):
        v = verified(text, value, *rx)
        out[key] = {"value": v, "ref": ref if v is not None else None}

    # NDMA SITREP 158 totals rows are parsed, then the parsed strings are re-verified in place.
    m = re.search(r"Total\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", nd)
    if m:
        g = [int(x) for x in m.groups()]
        fact("deaths", g[3], nd, NDMA_REF, rf"Total\s+{g[0]}\s+{g[1]}\s+{g[2]}\s+{g[3]}\s")
        fact("deaths_children", g[2], nd, NDMA_REF, rf"Total\s+{g[0]}\s+{g[1]}\s+{g[2]}\s+{g[3]}\s")
        fact("injured", g[7], nd, NDMA_REF, rf"{g[4]}\s+{g[5]}\s+{g[6]}\s+{g[7]}")
    m = re.search(r"TOTAL\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)", nd)
    if m:
        g = m.groups()
        fact("roads_damaged_km", int(_num(g[0])), nd, NDMA_REF, re.escape(g[0]))
        fact("bridges_damaged", int(_num(g[1])), nd, NDMA_REF, re.escape(g[1]))
        fact("houses_damaged", int(_num(g[4])), nd, NDMA_REF, re.escape(g[4]))
        fact("livestock_lost", int(_num(g[5])), nd, NDMA_REF, re.escape(g[5]))
    m = re.search(r"Total\s+(\d+)\s+([\d,]{9,})", nd)
    if m:
        fact("calamity_districts_ndma", int(m.group(1)), nd, NDMA_REF, rf"Total\s+{m.group(1)}\s+{m.group(2)}")
        fact("people_affected", int(_num(m.group(2))), nd, NDMA_REF, re.escape(m.group(2)))
    # per-province deaths / affected from the same SITREP
    prov = {}
    for name in ("AJ&K", "Balochistan", "GB", "ICT", "KP", "Punjab", "Sindh"):
        m = re.search(re.escape(name) + r"\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", nd)
        a = re.search(r"\n\s*" + re.escape(name) + r"\s+(\d+)\s+([\d,]+)\s*\n", nd)
        prov[name] = {"deaths": int(m.group(4)) if m else None, "injured": int(m.group(8)) if m else None,
                      "calamity_districts": int(a.group(1)) if a else None,
                      "affected": int(_num(a.group(2))) if a else None}
    out["by_province_ndma"] = {"value": prov, "ref": NDMA_REF}
    out["ndma_as_of"] = {"value": verified(nd, "2022-11-18", r"SITREP No 158 Dated 18th November, 2022"),
                         "ref": NDMA_REF}
    # PDNA headline numbers
    fact("damage_usd_bn", 14.9, pd, PDNA_URL, r"total damage is estimated at PKR 3\.2 trillion \(US\$14\.9 billion\)")
    fact("losses_usd_bn", 15.2, pd, PDNA_URL, r"total loss at PKR 3\.3 trillion \(US\$15\.2\s+billion\)")
    fact("needs_usd_bn", 16.3, pd, PDNA_URL, r"total needs at PKR 3\.5 trillion \(US\$16\.3 billion\)")
    fact("damage_pkr_trn", 3.2, pd, PDNA_URL, r"PKR 3\.2 trillion \(US\$14\.9 billion\)")
    fact("losses_pkr_trn", 3.3, pd, PDNA_URL, r"PKR 3\.3 trillion \(US\$15\.2")
    fact("needs_pkr_trn", 3.5, pd, PDNA_URL, r"PKR 3\.5 trillion \(US\$16\.3")
    fact("damage_pct_gdp_fy22", 4.8, pd, PDNA_URL, r"US\$14\.9 billion\), equivalent to 4\.8 percent of")
    fact("people_affected_pdna_m", 33, pd, PDNA_URL, r"33 million people have been affected")
    fact("displaced_pdna_m", 8, pd, PDNA_URL, r"Nearly 8 million\s+people are reportedly displaced")
    fact("calamity_districts_pdna", 94, pd, PDNA_URL, r"As of October 11, 94 districts were declared")
    fact("deaths_pdna_text", "more than 1,700", pd, PDNA_URL, r"taken the lives of more than 1,700 people")
    out["note"] = {"value": "NDMA counts run 14 June to 18 Nov 2022; the PDNA (Oct 2022) used 94 calamity-hit "
                            "districts as of 11 Oct, the NDMA SITREP table lists 90 notified districts.", "ref": None}
    return out


# ============================================================================================ (f) EM-DAT

def emdat():
    import openpyxl
    p = fetch(ID, EMDAT_URL, "emdat-country-profiles_pak_2026_11_25.xlsx")
    ws = openpyxl.load_workbook(p, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hdr = list(rows[0])
    data = [dict(zip(hdr, r)) for r in rows[1:] if isinstance(r[0], (int, float))]  # skip HXL tag row

    def n(v):
        return v if isinstance(v, (int, float)) else None

    def agg(keyf):
        acc = defaultdict(lambda: {"events": 0, "deaths": 0, "affected": 0, "damage_usd_adj": 0})
        for r in data:
            a = acc[keyf(r)]
            a["events"] += n(r["Total Events"]) or 0
            a["deaths"] += n(r["Total Deaths"]) or 0
            a["affected"] += n(r["Total Affected"]) or 0
            a["damage_usd_adj"] += n(r["Total Damage (USD, adjusted)"]) or 0
        return {k: {kk: int(vv) for kk, vv in v.items()} for k, v in sorted(acc.items())}

    years = [int(r["Year"]) for r in data]
    by_year = agg(lambda r: int(r["Year"]))
    top = sorted(((y, v["deaths"]) for y, v in by_year.items()), key=lambda x: -x[1])[:5]
    return {
        "coverage": [min(years), max(years)] if years else None, "rows": len(data),
        "by_type": agg(lambda r: r["Disaster Type"]),
        "by_subtype": agg(lambda r: f"{r['Disaster Type']} / {r['Disaster Subtype']}"),
        "by_decade": agg(lambda r: f"{int(r['Year']) // 10 * 10}s"),
        "by_year": by_year, "deadliest_years": [{"year": y, "deaths": d} for y, d in top],
        "units": "events = count; deaths/affected = people; damage_usd_adj = sum of the 'Total Damage (USD, adjusted)' "
                 "column as published (CPI-adjusted USD); blank cells count as 0, so totals are lower bounds",
        "ref": "https://data.humdata.org/dataset/982bb9ef-b909-4cf2-8a73-ac97b519339c",
    }


# ============================================================================================ (g) faults

def faults():
    from shapely.geometry import box, mapping, shape
    p = fetch(ID, GEM_URL, "gem_active_faults_harmonized.geojson")
    gj = json.loads(p.read_text())
    clip = box(*BBOX)
    feats = []

    def rnd(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 3), round(c[1], 3)]
        return [rnd(x) for x in c]

    def best(s):
        m = re.match(r"\(\s*([-\d.]+)", s or "")
        return float(m.group(1)) if m else None

    for f in gj["features"]:
        g = shape(f["geometry"])
        if not g.intersects(clip):
            continue
        g = g.intersection(clip).simplify(0.01, preserve_topology=False)
        if g.is_empty or g.length < 0.005:
            continue
        geo = mapping(g)
        if geo["type"] not in ("LineString", "MultiLineString"):
            continue
        pr = f["properties"]
        feats.append({"type": "Feature", "geometry": {"type": geo["type"], "coordinates": rnd(geo["coordinates"])},
                      "properties": {"name": pr.get("name") or None, "slip_type": pr.get("slip_type") or None,
                                     "net_slip_rate": best(pr.get("net_slip_rate")),
                                     "catalog": pr.get("catalog_name") or None}})
    return {"type": "FeatureCollection", "features": feats,
            "ref": "https://github.com/GEMScienceTools/gem-global-active-faults",
            "note": "net_slip_rate = preferred value in mm/yr where given; clipped to map bbox, simplified 0.01 deg"}


# ============================================================================================ main

def process():
    q = quakes()
    notable = notable_quakes(q)
    hot = heat()
    gl, glctx = glof()
    out = {"info": INFO, "quakes": q, "notable_quakes": notable, "heat": hot, "glof": gl, "glof_context": glctx,
           "flood2022": flood2022(), "emdat": emdat(), "faults": faults()}
    p = write_json(interim(ID), out)
    return out, p


if __name__ == "__main__":
    o, p = process()
    print(p, round(p.stat().st_size / 1e6, 2), "MB")
    print("quakes", o["quakes"]["n"], "non-eq", len(o["quakes"]["non_earthquake_events"]),
          "| notable", len(o["notable_quakes"]), "| heat", len(o["heat"]), "| glof", len(o["glof"]),
          "| faults", len(o["faults"]["features"]), "| emdat rows", o["emdat"]["rows"], o["emdat"]["coverage"])
