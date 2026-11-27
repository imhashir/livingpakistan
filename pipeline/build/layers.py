"""Layers builder: lines (rivers, canals, roads, rail, corridors, faults) and sites (cities, wonders, energy, water,
transport, culture, eras, hazards) projected to map km → web/public/data/layers.json."""
from __future__ import annotations

import math

import numpy as np

from pipeline.common import WEB_DATA, interim, read_json, world_grid, write_json


def _j(name):
    p = interim(name)
    return read_json(p) if p.exists() else None


# Corridors drawn from OSM geometry of the listed highway refs (route membership per the cited sources).
CORRIDORS = [
    {"id": "gt", "name": "Grand Trunk Road (N-5)", "color": "#ffcf5a", "refs": ["N-5"],
     "blurb": "Sher Shah Suri's 16th-century trunk road; in Pakistan the N-5 carries it from Lahore to Peshawar and the "
              "Khyber, and the national highway continues south to Karachi.",
     "ref": "https://en.wikipedia.org/wiki/Grand_Trunk_Road"},
    {"id": "kkh", "name": "Karakoram Highway (N-35)", "color": "#7ff0ff", "refs": ["N-35"],
     "blurb": "The Silk Road reborn: Hasan Abdal to the 4,693 m Khunjerab Pass on the China border.",
     "ref": "https://en.wikipedia.org/wiki/Karakoram_Highway"},
    {"id": "cpec_east", "name": "CPEC Eastern alignment (motorways)", "color": "#ff7a59",
     "refs": ["M-9", "M-5", "M-4", "M-3", "M-2", "M-1", "M-15", "M-11"],
     "blurb": "Karachi → Hyderabad → Sukkur → Multan → Lahore/Islamabad → Hazara, on the motorway spine.",
     "ref": "https://cpec.gov.pk/infrastructure"},
    {"id": "cpec_west", "name": "CPEC Western alignment", "color": "#ff4fa3", "refs": ["M-8", "N-85", "N-25", "N-50", "M-14"],
     "blurb": "Gwadar → Hoshab → Surab/Quetta → Zhob → D.I. Khan → Hakla: the western route linking Gwadar to the north.",
     "ref": "https://cpec.gov.pk/infrastructure"},
    {"id": "coastal", "name": "Makran Coastal Highway (N-10)", "color": "#5fd3a5", "refs": ["N-10"],
     "blurb": "Karachi to Gwadar along the Arabian Sea, through Hingol National Park.",
     "ref": "https://en.wikipedia.org/wiki/Makran_Coastal_Highway"},
    {"id": "indus_hwy", "name": "Indus Highway (N-55)", "color": "#9fb7ff", "refs": ["N-55"],
     "blurb": "Karachi to Peshawar on the west bank of the Indus.", "ref": "https://en.wikipedia.org/wiki/Indus_Highway"},
]
ML1_STATIONS = [("Karachi", 67.03, 24.85), ("Hyderabad", 68.37, 25.39), ("Nawabshah", 68.41, 26.24),
                ("Rohri", 68.90, 27.69), ("Rahim Yar Khan", 70.30, 28.42), ("Bahawalpur", 71.68, 29.39),
                ("Khanewal", 71.93, 30.30), ("Sahiwal", 73.10, 30.67), ("Lahore", 74.33, 31.58),
                ("Gujranwala", 74.19, 32.16), ("Jhelum", 73.73, 32.94), ("Rawalpindi", 73.05, 33.60),
                ("Attock", 72.36, 33.77), ("Nowshera", 71.97, 34.01), ("Peshawar", 71.58, 34.01)]
RIVER_WIDTH = {"Indus": 3.2, "Jhelum": 2.0, "Chenab": 2.2, "Sutlej": 1.8, "Ravi": 1.4, "Beas": 1.2, "Kabul": 2.0,
               "Swat": 1.2, "Gilgit": 1.3, "Hunza": 1.1, "Shyok": 1.5, "Kunhar": 1.0, "Neelum": 1.2}
IWT = {"Indus": "western", "Jhelum": "western", "Chenab": "western", "Ravi": "eastern", "Beas": "eastern", "Sutlej": "eastern"}


def build():
    proj, grid = world_grid()

    def P(lon, lat):
        x, y = proj.to_map(lon, lat)
        return [round(float(x), 2), round(float(y), 2)]

    def line(pts):
        a = np.asarray(pts, dtype=float)
        x, y = proj.to_map(a[:, 0], a[:, 1])
        return [[round(float(u), 2), round(float(v), 2)] for u, v in zip(x, y)]

    def cell(lon, lat):
        x, y = proj.to_map(lon, lat)
        return grid.cell_at(float(x), float(y))

    t = _j("transport") or {}
    lines = {"rivers": [], "canals": [], "roads": [], "rail": [], "corridors": [], "faults": []}
    for r in t.get("rivers", []):
        lines["rivers"].append({"name": r["name"], "iwt": IWT.get(r["name"], "other"), "w": RIVER_WIDTH.get(r["name"], 1.0),
                                "lines": [line(l) for l in r["lines"] if len(l) > 1]})
    for c in t.get("canals", []):
        lines["canals"].append({"name": c.get("name"), "link": c.get("link"), "km": c.get("length_km"),
                                "lines": [line(l) for l in c["lines"] if len(l) > 1]})
    roads_by_ref = {}
    for r in t.get("roads", []):
        rec = {"ref": r.get("ref"), "name": r.get("name"), "cls": r.get("class"),
               "lines": [line(l) for l in r["lines"] if len(l) > 1]}
        lines["roads"].append(rec)
        if r.get("ref"):
            roads_by_ref.setdefault(r["ref"], []).extend(rec["lines"])
    for r in t.get("rail", []):
        lines["rail"].append({"name": r.get("name"), "lines": [line(l) for l in r["lines"] if len(l) > 1]})
    for c in CORRIDORS:
        ls = [l for ref in c["refs"] for l in roads_by_ref.get(ref, [])]
        missing = [ref for ref in c["refs"] if ref not in roads_by_ref]
        lines["corridors"].append({**{k: v for k, v in c.items() if k != "refs"}, "refs": c["refs"], "missing": missing,
                                   "lines": ls, "src": "transport"})
    # ML-1: OSM main-line segments within 12 km of the Karachi–Peshawar station path
    st = [P(lon, lat) for _, lon, lat in ML1_STATIONS]

    def dist_to_path(p):
        best = 1e9
        for a, b in zip(st[:-1], st[1:]):
            ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay
            L = dx * dx + dy * dy
            u = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
            best = min(best, math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy))
        return best
    main = next((r for r in lines["rail"] if r["name"] and r["name"].startswith("Main")), None)
    ml1 = []
    if main:
        for l in main["lines"]:
            seg = []
            for p in l:
                if dist_to_path(p) < 12:
                    seg.append(p)
                elif len(seg) > 1:
                    ml1.append(seg); seg = []
                else:
                    seg = []
            if len(seg) > 1:
                ml1.append(seg)
    lines["corridors"].append({"id": "ml1", "name": "ML-1 Main Line railway", "color": "#e8e8ff", "rail": True,
                               "blurb": "Pakistan Railways' 1,687 km spine, Karachi → Lahore → Rawalpindi → Peshawar. "
                                        "Drawn from OSM main-line track within 12 km of the ML-1 station path.",
                               "ref": "https://en.wikipedia.org/wiki/Karachi%E2%80%93Peshawar_Railway_Line",
                               "lines": ml1, "src": "transport", "stations": [{"name": n, "xy": P(lo, la)} for n, lo, la in ML1_STATIONS]})
    hz = _j("hazards") or {}
    for f in (hz.get("faults") or {}).get("features", []):
        g = f["geometry"]
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        lines["faults"].append({"name": f["properties"].get("name"), "slip": f["properties"].get("slip_type"),
                                "lines": [line(p) for p in parts if len(p) > 1]})

    # ---------------------------------------------------------------- sites
    sites = []

    def add(kind, rec, **extra):
        lon, lat = rec.get("lon"), rec.get("lat")
        if lon is None or lat is None:
            return
        xy = P(lon, lat)
        s = {"id": f"{kind}:{rec.get('id', rec.get('name'))}", "kind": kind, "name": rec.get("name"), "xy": xy,
             "cell": cell(lon, lat), "lat": lat, "lon": lon, "pcode": rec.get("pcode"), "blurb": rec.get("blurb"),
             "ref": rec.get("ref") or rec.get("wiki"), "src": rec.get("src")}
        s.update(extra)
        sites.append(s)

    for c in (_j("cities") or {}).get("cities", []):
        add("city", c, pop=c.get("pop_2023"), province=c.get("province"), capital=c.get("is_capital"),
            pcodes=c.get("pcodes") or ([c["pcode"]] if c.get("pcode") else []), src="cities")
    W = _j("wonders") or {}
    for w in W.get("wonders", []):
        f = w.get("facts", {})
        add("wonder", w, group=f.get("group"), sub=f.get("kind"), facts=f)
    for p in W.get("parks", []):
        add("park", {**p, "id": p.get("wdpa_id")}, area_km2=p.get("reported_area_km2"), year=p.get("status_year"),
            iucn=p.get("iucn_cat"))
    for u in (_j("unesco") or {}).get("sites", []):
        f = u.get("facts", {})
        add("unesco", u, status=f.get("status"), year=f.get("year_inscribed"), category=f.get("category"), facts=f)
    for u in (_j("universities") or {}).get("universities", []):
        f = u.get("facts", {})
        if f.get("in_top15_rule"):
            add("university", u, facts=f)
    for c in (_j("culture") or {}).get("pins", []):
        add(c.get("category", "culture"), c, facts=c.get("facts"))
    E = _j("eras") or {}
    for s_ in E.get("sites", []):
        add("era", s_, era=s_.get("era"), year=s_.get("year"), facts=s_.get("facts"))
    for p in (_j("power_plants") or {}).get("plants", []):
        add("power", p, mw=p.get("capacity_mw"), fuel=p.get("primary_fuel"), year=p.get("commissioning_year"),
            owner=p.get("owner"), status=p.get("status"))
    for a in (_j("airports") or {}).get("airports", []):
        if a.get("military"):
            continue
        add("airport", a, iata=a.get("iata"), pax=a.get("pax"), cargo_t=a.get("cargo_t"), fy=a.get("traffic_fy"))
    for p in (_j("ports") or {}).get("ports", []):
        add("port", p, cargo_t=p.get("cargo_t"), depth=p.get("channel_depth_m"), sub=p.get("kind"))
    WI = _j("water_infra") or {}
    for s_ in WI.get("structures", []):
        add("water", s_, sub=s_.get("kind"), river=s_.get("river"), year=s_.get("year_completed"),
            mw=s_.get("capacity_mw"), storage_maf=s_.get("live_storage_maf"), status=s_.get("status"),
            facts={k: v for k, v in s_.items() if k not in ("lat", "lon", "name", "id")})
    for q in hz.get("notable_quakes", []):
        add("quake", q, facts=q.get("facts"))
    for h in hz.get("heat", []):
        add("heat", h, facts=h.get("facts"))
    for g in hz.get("glof", []):
        add("glof", g, facts=g.get("facts"))

    eras = E.get("eras", [])
    out = {"lines": lines, "sites": sites, "eras": eras, "iwt": WI.get("indus_waters_treaty"),
           "quake_points": _quake_points(hz, proj)}
    write_json(WEB_DATA / "layers.json", out)
    from collections import Counter
    print("sites", Counter(s["kind"] for s in sites))
    print("corridors", [(c["id"], len(c["lines"]), c.get("missing")) for c in lines["corridors"]])


def _quake_points(hz, proj):
    q = hz.get("quakes")
    if not q:
        return None
    lat = np.array(q["lat"]); lon = np.array(q["lon"]); mag = np.array(q["mag"], dtype=float)
    keep = mag >= 5.0
    x, y = proj.to_map(lon[keep], lat[keep])
    years = [int(t[:4]) for t, k in zip(q["time"], keep) if k]
    return {"x": [round(float(v), 1) for v in x], "y": [round(float(v), 1) for v in y],
            "mag": [float(m) for m in mag[keep]], "year": years}


if __name__ == "__main__":
    build()
