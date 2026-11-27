"""Atlas builder: joins every district table and hex raster into the browser bundle.

Outputs (web/public/data):
  cells.json     per-hex values (arrays over the full grid, null outside Pakistan)
  atlas.json     districts (all joined fields + yields + specialisations), provinces, nation, lens catalogue,
                 flood playback series
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from pipeline.common import INTERIM, WEB_DATA, interim, read_json, world_grid, write_json


def _load(name):
    p = interim(name)
    return read_json(p) if p.exists() else None


SECTION_NAMES = {
    "A": "Agriculture", "B": "Mining", "C": "Manufacturing", "D": "Electricity & gas", "E": "Water & waste",
    "F": "Construction", "G": "Wholesale & retail", "H": "Transport & storage", "I": "Hotels & food",
    "J": "Information & communication", "K": "Finance & insurance", "L": "Real estate", "M": "Professional & scientific",
    "N": "Administrative services", "O": "Public administration & defence", "P": "Education", "Q": "Health & social work",
    "R": "Arts & recreation", "S": "Other services",
}

YIELDS = {
    "food": {"label": "Food", "icon": "🌾", "unit": "ha cropped",
             "def": "Cropped area (Agricultural Census 2024, PBS)", "src": ["crops"]},
    "production": {"label": "Production", "icon": "⚒️", "unit": "workers",
                   "def": "Workforce in mining, manufacturing, utilities & construction (Economic Census 2023, PSIC B–F)",
                   "src": ["econ_census"], "sections": ["B", "C", "D", "E", "F"]},
    "gold": {"label": "Gold", "icon": "🪙", "unit": "Int$ (PPP)",
             "def": "MODELLED GDP, PPP, 2024 (Kummu et al. gridded GDP) — not official district accounts",
             "src": ["gdp_grid"]},
    "trade": {"label": "Trade", "icon": "🐪", "unit": "workers",
              "def": "Workforce in wholesale & retail, transport, hotels (Economic Census 2023, PSIC G–I)",
              "src": ["econ_census"], "sections": ["G", "H", "I"]},
    "science": {"label": "Science", "icon": "🔬", "unit": "workers",
                "def": "Workforce in ICT, finance, professional/scientific services & education (Economic Census 2023, PSIC J, K, M, P)",
                "src": ["econ_census"], "sections": ["J", "K", "M", "P"]},
    "culture": {"label": "Culture", "icon": "🎭", "unit": "workers",
                "def": "Workforce in arts, entertainment & recreation (Economic Census 2023, PSIC R)",
                "src": ["econ_census"], "sections": ["R"]},
}

# District specialisations from Economic Census location quotients (share of district workforce in a section ÷ the
# national share). Rule: LQ ≥ 1.4 and ≥ 2,000 workers in the section (or LQ ≥ 3 with ≥ 300 workers).
SPECIALS = [
    ("industrial", "Industrial zone", "🏭", ["C"]),
    ("commercial", "Commercial hub", "🏪", ["G", "K"]),
    ("campus", "Campus", "🎓", ["P", "J", "M"]),
    ("harbor", "Harbor & logistics", "⚓", ["H"]),
    ("government", "Government plaza", "🏛️", ["O"]),
    ("theater", "Theater square", "🎭", ["R"]),
    ("hospital", "Healing quarter", "⚕️", ["Q"]),
    ("mine", "Mine", "⛏️", ["B"]),
    ("farmstead", "Farmstead", "🌾", ["A"]),
    ("caravanserai", "Caravanserai", "🏨", ["I"]),
    ("powerhouse", "Powerhouse", "⚡", ["D", "E"]),
]


def build():
    proj, grid = world_grid()
    W = np.load(INTERIM / "_world.npz")
    owner = W["owner"]
    n = grid.size
    dref = read_json(interim("districts"))
    dist = dref["districts"]
    nd = len(dist)
    pcodes = [d["pcode"] for d in dist]
    census = _load("census2023") or {"districts": {}}
    econ = _load("econ_census") or {"districts": {}}
    mpi = _load("mpi") or {"districts": {}}
    crops = _load("crops") or {"districts": {}}
    gdp = _load("gdp_grid") or {"districts": {}}
    flood = _load("flood_evolution") or {"districts": {}, "periods": []}
    hz = _load("hazards") or {}

    # ---------------------------------------------------------------- hex population (WorldPop → Census 2023)
    keys, sums = W["wp_keys"], W["wp_sums"]
    kc, kd = keys // 1000, keys % 1000
    wp_d = np.bincount(kd, weights=sums, minlength=nd)
    scale = np.ones(nd)
    pop_basis = []
    for i, p in enumerate(pcodes):
        c = census["districts"].get(p)
        if c and c.get("pop") and wp_d[i] > 0:
            scale[i] = c["pop"] / wp_d[i]; pop_basis.append("census2023")
        else:
            pop_basis.append("worldpop2025")
    hexpop = np.bincount(kc, weights=sums * scale[kd], minlength=n)
    # people living in a hex that the grid assigns to sea/foreign (coastal slivers) are folded into the nearest owner
    hex_area = 2.598076 * grid.radius ** 2
    land_area = np.maximum(W["land_area"], 1)

    # ---------------------------------------------------------------- hex modelled GDP (Kummu)
    hexgdp = np.zeros(n)
    gz = INTERIM / "gdp_grid.npz"
    if gz.exists():
        z = np.load(gz)
        g = z["gdp"].astype(np.float64)
        g[~np.isfinite(g) | (g < 0)] = 0
        rr, cc = np.nonzero(g > 0)
        lon = float(z["lon0"]) + float(z["dlon"]) * (cc + 0.5)
        lat = float(z["lat0"]) + float(z["dlat"]) * (rr + 0.5)
        mx, my = proj.to_map(lon, lat)
        idx = grid.cells_at(np.asarray(mx), np.asarray(my))
        ok = idx >= 0
        hexgdp = np.bincount(idx[ok], weights=g[rr, cc][ok], minlength=n)

    # ---------------------------------------------------------------- seismicity: quakes per hex, energy-weighted
    quake_e = np.zeros(n); quake_n = np.zeros(n); quake_max = np.zeros(n)
    q = hz.get("quakes")
    if q:
        lat = np.array(q["lat"]); lon = np.array(q["lon"]); mag = np.array(q["mag"], dtype=float)
        mx, my = proj.to_map(lon, lat)
        idx = grid.cells_at(np.asarray(mx), np.asarray(my))
        ok = idx >= 0
        np.add.at(quake_n, idx[ok], 1)
        np.add.at(quake_e, idx[ok], 10 ** (1.5 * mag[ok]))
        np.maximum.at(quake_max, idx[ok], mag[ok])
        # smooth with neighbours so the lens reads as zones rather than dots
        nb = [grid.neighbours(i) for i in range(n)]
        sm = quake_e.copy()
        for i in np.nonzero(quake_e > 0)[0]:
            for j in nb[i]:
                sm[j] += quake_e[i] * 0.5
        quake_e = sm

    # ---------------------------------------------------------------- district joins
    dcells = defaultdict(list)
    for c in np.nonzero(owner >= 0)[0]:
        dcells[int(owner[c])].append(int(c))
    # nat shares for LQs
    nat_wf = defaultdict(float)
    for p, e in econ["districts"].items():
        for s, v in e["workforce"].items():
            nat_wf[s] += v or 0
    nat_total = nat_wf.get("total", 0) or 1

    floods_d = flood["districts"]
    rows = []
    for i, d in enumerate(dist):
        p = d["pcode"]
        c = census["districts"].get(p) or {}
        e = econ["districts"].get(p)
        m = mpi["districts"].get(p)
        cr = crops["districts"].get(p)
        gd = gdp["districts"].get(p)
        fl = floods_d.get(p)
        cells = dcells.get(i, [])
        r = {"pcode": p, "name": d["name"], "province": d["province"], "area_km2": d["area_km2"],
             "lat": d["lat"], "lon": d["lon"], "cells": cells}
        x, y = proj.to_map(d["lon"], d["lat"]); r["x"], r["y"] = round(float(x), 2), round(float(y), 2)
        # people
        pop = c.get("pop")
        r["pop"] = pop if pop is not None else (round(float(wp_d[i])) if wp_d[i] > 0 else None)
        r["pop_basis"] = pop_basis[i]
        r["density"] = round(r["pop"] / d["area_km2"], 1) if r["pop"] and d["area_km2"] else None
        for k in ("pop_urban", "pop_rural", "households", "pop_2017", "growth", "literacy", "literacy_male",
                  "literacy_female", "median_age", "hh_size"):
            r[k] = c.get(k)
        r["urban_pct"] = round(100 * c["pop_urban"] / c["pop"], 1) if c.get("pop_urban") is not None and c.get("pop") else None
        if r.get("hh_size") is None and c.get("households") and c.get("pop"):
            r["hh_size"] = round(c["pop"] / c["households"], 2)
        r["gender_gap"] = (round(c["literacy_male"] - c["literacy_female"], 1)
                           if c.get("literacy_male") is not None and c.get("literacy_female") is not None else None)
        rel = c.get("religion") or None
        r["religion"] = rel
        if rel and c.get("pop"):
            tot = sum(v for v in rel.values() if isinstance(v, (int, float))) or c["pop"]
            r["non_muslim_pct"] = round(100 * (tot - rel.get("muslim", 0)) / tot, 2)
            mins = {k: v for k, v in rel.items() if k != "muslim" and isinstance(v, (int, float))}
            r["largest_minority"] = max(mins, key=mins.get) if mins and max(mins.values()) > 0 else None
        else:
            r["non_muslim_pct"] = None; r["largest_minority"] = None
        lang = c.get("language") or None
        r["language"] = lang
        if lang:
            tot = sum(v for v in lang.values() if isinstance(v, (int, float))) or 1
            top = sorted(((k, v) for k, v in lang.items() if isinstance(v, (int, float))), key=lambda kv: -kv[1])
            r["top_language"] = top[0][0] if top and top[0][1] > 0 else None
            r["top_language_pct"] = round(100 * top[0][1] / tot, 1) if top else None
            # linguistic diversity: 1 - Herfindahl
            r["lang_diversity"] = round(1 - sum((v / tot) ** 2 for _, v in top), 3)
        else:
            r["top_language"] = r["top_language_pct"] = r["lang_diversity"] = None
        # poverty
        r["mpi"] = m.get("mpi") if m else None
        r["mpi_h"] = m.get("h") if m else None
        r["mpi_a"] = m.get("a") if m else None
        r["mpi_note"] = ((f"inherited from {m['inherited_from']}" if m.get("inherited_from") else "")
                         + (f" ({m.get('year')})" if m.get("year") and m.get("year") != "2019-20" else "")).strip() if m else None
        # economy
        if e:
            wf = e["workforce"]; es = e["establishments"]
            r["workforce"] = {s: wf.get(s, 0) for s in list(SECTION_NAMES) + ["total"]}
            r["establishments"] = es.get("total")
            lq = {}
            for s in SECTION_NAMES:
                share = (wf.get(s, 0) or 0) / (wf.get("total") or 1)
                nshare = nat_wf.get(s, 0) / nat_total
                lq[s] = round(share / nshare, 2) if nshare > 0 else None
            r["lq"] = lq
            specs = []
            for sid, label, icon, secs in SPECIALS:
                w_ = sum(wf.get(s, 0) or 0 for s in secs)
                nsh = sum(nat_wf.get(s, 0) for s in secs) / nat_total
                l = (w_ / (wf.get("total") or 1)) / nsh if nsh else 0
                if (l >= 1.4 and w_ >= 2000) or (l >= 3 and w_ >= 300):
                    specs.append({"id": sid, "label": label, "icon": icon, "lq": round(l, 2), "workers": w_})
            specs.sort(key=lambda s: -s["lq"])
            r["specials"] = specs
        else:
            r["workforce"] = None; r["establishments"] = None; r["lq"] = None; r["specials"] = []
        # crops
        if cr:
            r["crops"] = {k: v["area_ha"] for k, v in cr.items() if isinstance(v, dict) and "area_ha" in v}
            r["cropped_ha"] = cr.get("cropped_area_ha")
            r["top_crop"] = cr.get("dominant")
        else:
            r["crops"] = None; r["cropped_ha"] = None; r["top_crop"] = None
        # gold
        r["gdp"] = gd.get("gdp_ppp_usd") if gd else None
        r["gdp_pc"] = round(r["gdp"] / r["pop"]) if r["gdp"] and r["pop"] else None
        # flood
        if fl:
            r["flood_series"] = fl["ext_km2"]
            r["flood_exposed_series"] = fl["exposed"]
            r["flood_max_km2"] = max(fl["ext_km2"]) if fl["ext_km2"] else None
            r["flood_pct"] = round(100 * fl["ext_km2"][0] / fl["area_km2"], 2) if fl["area_km2"] else None
            r["flood_exposed"] = fl["exposed"][0] if fl["exposed"] else None
        else:
            r["flood_series"] = None; r["flood_exposed_series"] = None; r["flood_max_km2"] = None
            r["flood_pct"] = None; r["flood_exposed"] = None
        # terrain from the grid
        if cells:
            ev = W["elev"][cells]; em = W["emax"][cells]
            r["elev_mean"] = round(float(ev.mean())); r["elev_max"] = round(float(em.max()))
        else:
            r["elev_mean"] = r["elev_max"] = None
        r["quakes"] = int(quake_n[cells].sum()) if cells else 0
        # yields
        y = {}
        y["food"] = r["cropped_ha"]
        y["gold"] = r["gdp"]
        for k, spec in YIELDS.items():
            if "sections" in spec:
                y[k] = sum(r["workforce"].get(s, 0) for s in spec["sections"]) if r["workforce"] else None
        r["yields"] = y
        rows.append(r)

    # badge per district: the most specialised, with a few curated names from real clusters as titles? — no:
    # titles come only from LQs so they're reproducible.
    # ---------------------------------------------------------------- provinces + nation
    provs = {}
    for r in rows:
        pr = provs.setdefault(r["province"], {"name": r["province"], "pop": 0, "area_km2": 0, "gdp": 0, "districts": 0,
                                              "yields": defaultdict(float), "has_census": False})
        pr["districts"] += 1; pr["area_km2"] += r["area_km2"] or 0
        pr["pop"] += r["pop"] or 0; pr["gdp"] += r["gdp"] or 0
        pr["has_census"] |= r["pop_basis"] == "census2023"
        for k, v in r["yields"].items():
            if v: pr["yields"][k] += v
    for pr in provs.values():
        pr["yields"] = dict(pr["yields"])
    nation = {"pop_census2023": census.get("national", {}).get("pop"),
              "pop_all_districts": sum(r["pop"] or 0 for r in rows),
              "area_km2": round(sum(r["area_km2"] for r in rows)),
              "gdp_modelled": sum(r["gdp"] or 0 for r in rows),
              "yields": {k: sum((r["yields"].get(k) or 0) for r in rows) for k in YIELDS},
              "literacy": census.get("national", {}).get("literacy"),
              "mpi": mpi.get("national", {}).get("mpi"), "mpi_h": mpi.get("national", {}).get("h"),
              "econ": {"workforce": econ.get("national", {}).get("workforce", {}).get("total")
                       if isinstance(econ.get("national", {}).get("workforce"), dict) else None},
              "flood_periods": flood.get("periods"), "flood_national_km2": flood.get("national", {}).get("ext_km2"),
              "flood_national_exposed": flood.get("national", {}).get("exposed"),
              "flood2022": {k: v for k, v in (hz.get("flood2022") or {}).items()},
              "emdat": hz.get("emdat"),
              "district_count": nd, "hex_count": int((owner >= 0).sum()), "hex_km2": round(hex_area, 1)}

    # ---------------------------------------------------------------- per-hex payload
    pak = owner >= 0

    def arr(a, nd_=1, mask=pak):
        out = []
        for i in range(n):
            out.append(round(float(a[i]), nd_) if mask[i] else None)
        return out

    dens = hexpop / np.minimum(land_area, hex_area)
    cells_out = {
        "pop": [int(round(v)) if pak[i] else None for i, v in enumerate(hexpop)],
        "density": arr(dens, 1),
        "gdp": [int(round(v)) if pak[i] else None for i, v in enumerate(hexgdp)],
        "quake_n": [int(v) if pak[i] or v else 0 for i, v in enumerate(quake_n)],
        "quake_log": arr(np.log10(np.maximum(quake_e, 1)), 2, np.ones(n, bool)),
        "quake_max": arr(quake_max, 1, np.ones(n, bool)),
    }
    write_json(WEB_DATA / "cells.json", cells_out)

    lenses = lens_catalogue()
    write_json(WEB_DATA / "atlas.json", {"districts": rows, "provinces": list(provs.values()), "nation": nation,
                                          "yields": YIELDS, "sections": SECTION_NAMES,
                                          "specials": [{"id": s, "label": l, "icon": ic, "sections": secs}
                                                       for s, l, ic, secs in SPECIALS],
                                          "lenses": lenses, "flood_periods": flood.get("periods")})
    print("districts", len(rows), "with census", sum(r["pop_basis"] == "census2023" for r in rows),
          "with econ", sum(r["workforce"] is not None for r in rows))
    print("hex pop total", int(hexpop[pak].sum()), "nation pop", nation["pop_all_districts"],
          "gdp", f"{nation['gdp_modelled']:.3e}")


def lens_catalogue():
    """Lens definitions. level: 'hex' (from cells.json) or 'district' (from atlas districts). scale: seq|div|cat."""
    L = []

    def add(**k):
        L.append(k)
    add(id="terrain", group="Land", label="Terrain", level="none", desc="Painted terrain from elevation + land cover.",
        src=["copernicus_dem", "esa_worldcover"])
    add(id="elevation", group="Land", label="Elevation", level="hex", field="elev", unit="m", scale="seq", palette="elev",
        desc="Mean elevation of each hex, Arabian Sea coast to the Karakoram.", src=["copernicus_dem"])
    add(id="farmland", group="Land", label="Farmland", level="hex", field="pct.crop", unit="% cropland", scale="seq",
        palette="green", desc="Share of each hex mapped as cropland (ESA WorldCover 2021).", src=["esa_worldcover"])
    add(id="forest", group="Land", label="Forest", level="hex", field="pct.tree", unit="% tree cover", scale="seq",
        palette="forest", desc="Share of tree cover (ESA WorldCover 2021). Pakistan is ~5% forested.", src=["esa_worldcover"])
    add(id="desert", group="Land", label="Desert & bare", level="hex", field="pct.bare", unit="% bare", scale="seq",
        palette="sand", desc="Share of bare / sparse ground (ESA WorldCover 2021).", src=["esa_worldcover"])
    add(id="glacier", group="Land", label="Snow & glacier", level="hex", field="pct.snow", unit="% snow/ice", scale="seq",
        palette="ice", desc="Permanent snow & ice (ESA WorldCover 2021) — the Indus water towers.", src=["esa_worldcover"])
    add(id="builtup", group="Land", label="Built-up", level="hex", field="pct.built", unit="% built-up", scale="seq",
        palette="urban", desc="Share of built-up land (ESA WorldCover 2021).", src=["esa_worldcover"])
    add(id="density", group="People", label="Population density", level="hex", field="cells.density", unit="people / km²",
        scale="log", palette="magma", desc="WorldPop 2025 grid rescaled to each district's Census 2023 total (AJK & GB: WorldPop only).",
        src=["worldpop", "census2023"])
    add(id="growth", group="People", label="Growth 2017→23", level="district", field="growth", unit="% / year", scale="div",
        palette="div", mid=2.0, desc="Average annual population growth between the 2017 and 2023 censuses.", src=["census2023"])
    add(id="urban", group="People", label="Urban share", level="district", field="urban_pct", unit="% urban", scale="seq",
        palette="urban", desc="Share of residents in urban areas (Census 2023).", src=["census2023"])
    add(id="hhsize", group="People", label="Household size", level="district", field="hh_size", unit="persons", scale="seq",
        palette="warm", desc="Average persons per household (Census 2023).", src=["census2023"])
    add(id="language", group="Culture", label="Mother tongue", level="district", field="top_language", scale="cat",
        palette="lang", desc="Most common mother tongue in each district (Census 2023, Table 11).", src=["census2023"])
    add(id="langdiv", group="Culture", label="Linguistic diversity", level="district", field="lang_diversity",
        unit="0–1", scale="seq", palette="viridis",
        desc="Chance two random residents have different mother tongues (1 − Herfindahl of Table 11 shares).", src=["census2023"])
    add(id="faith", group="Culture", label="Religious minorities", level="district", field="non_muslim_pct",
        unit="% non-Muslim", scale="log", palette="purple",
        desc="Share of residents who are not Muslim (Census 2023, Table 9): Hindus in Tharparkar & Umerkot, Christians in Punjab.",
        src=["census2023"])
    add(id="minority", group="Culture", label="Largest minority", level="district", field="largest_minority", scale="cat",
        palette="faith", desc="The largest non-Muslim community in each district (Census 2023, Table 9).", src=["census2023"])
    add(id="literacy", group="Knowledge", label="Literacy", level="district", field="literacy", unit="% of 10+",
        scale="seq", palette="blue", desc="Literacy rate, population aged 10+ (Census 2023, Table 12).", src=["census2023"])
    add(id="gendergap", group="Knowledge", label="Literacy gender gap", level="district", field="gender_gap",
        unit="pp (male − female)", scale="seq", palette="red",
        desc="Male minus female literacy, percentage points (Census 2023).", src=["census2023"])
    add(id="mpi", group="Prosperity", label="Poverty (MPI)", level="district", field="mpi_h", unit="% poor",
        scale="seq", palette="red", desc="Multidimensional poverty headcount (PSLM 2019-20; MPI report, UNDP/OPHI/Planning Commission).",
        src=["mpi"])
    add(id="gold", group="Prosperity", label="Gold (modelled GDP)", level="hex", field="cells.gdp", unit="Int$ PPP",
        scale="log", palette="gold", desc="MODELLED GDP 2024 (Kummu et al., gridded) — a model, not official district accounts.",
        src=["gdp_grid"])
    add(id="gdppc", group="Prosperity", label="GDP per person (modelled)", level="district", field="gdp_pc",
        unit="Int$ PPP", scale="log", palette="gold", desc="Modelled GDP ÷ population. Indicative only.", src=["gdp_grid", "census2023"])
    add(id="industry", group="Economy", label="Manufacturing jobs", level="district", field="lq.C", unit="LQ", scale="div",
        palette="div", mid=1.0, desc="Location quotient of manufacturing workforce (Economic Census 2023). >1 = more specialised than Pakistan.",
        src=["econ_census"])
    add(id="crop", group="Economy", label="Dominant crop", level="district", field="top_crop", scale="cat", palette="crop",
        desc="Crop with the largest cropped area (Agricultural Census 2024).", src=["crops"])
    add(id="flood", group="Hazards", label="2022 mega-flood", level="hex", field="flood_pct", unit="% of land",
        scale="seq", palette="flood", desc="Share of each hex under water in UNOSAT's VIIRS extent, 1 Jul – 31 Aug 2022.",
        src=["unosat_flood"])
    add(id="seismic", group="Hazards", label="Seismicity", level="hex", field="cells.quake_log", unit="log₁₀ energy",
        scale="seq", palette="quake", desc="Energy released by M4.5+ earthquakes since 1902 (USGS ComCat), smoothed over neighbouring hexes.",
        src=["hazards"])
    return L


if __name__ == "__main__":
    build()
