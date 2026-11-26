"""Seaports: NGA World Port Index (Pub 150) Pakistan entries (Karachi, Port Qasim, Gwadar) + Natural Earth 10m ports
for cross-check, + a few minor harbours located via Wikidata P625 (Pasni, Ormara, Keti Bandar, Gadani).
Cargo throughput (FY 2023-24, the latest full fiscal year) from the Pakistan Economic Survey 2024-25, chapter 13
(Table 13.4 for Karachi Port; Fig-13.2 data labels for Port Qasim). Output: data/interim/ports.json."""
from __future__ import annotations

import csv
import json
import re
import zipfile

from pipeline.common import fetch, raw_dir, write_json, interim

SRC = "ports"
# msi.nga.mil returned HTTP 503 at build time; the RIMES CKAN portal hosts a copy of UpdatedPub150.csv.
WPI_URL = ("https://ckan.rimes.int/dataset/ef461b79-7a50-4ffc-8327-31d71a690c6b/resource/"
           "23538e38-830f-4df1-b69d-4469fa6ee7af/download/updatedpub150.csv")
WPI_OFFICIAL = "https://msi.nga.mil/Publications/WPI"
NE_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_ports.zip"
PES_URL = "https://finance.gov.pk/survey/chapter_25/13_Transport_and_Communication.pdf"
WD = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
CARGO_FY = "2023-24"

INFO = {
    "id": SRC,
    "title": "Seaports and harbours",
    "publisher": "US NGA (World Port Index, Pub 150); Natural Earth; Finance Division, Govt of Pakistan "
                 "(Pakistan Economic Survey 2024-25); Wikidata",
    "vintage": "WPI copy of 2024-05 (RIMES mirror); cargo FY 2023-24 (PES 2024-25)",
    "url": WPI_OFFICIAL,
    "files_urls": [WPI_URL, NE_URL, PES_URL],
    "license": "WPI: US Government work (public domain); Natural Earth: public domain; PES: government "
               "publication (cite); Wikidata: CC0",
    "used_for": ["port points", "port icon size by cargo tonnage"],
    "caveats": ("WPI lists only three Pakistani ports (Karachi, Muhammad Bin Qasim, Gwadar). The official NGA "
                "server returned 503, so the CSV is a 2024-05 copy hosted by RIMES CKAN. Minor harbours (Pasni "
                "fish harbour — placed at the Pasni town point because the harbour item has no coordinates, Ormara naval base, Keti Bandar, Gadani ship-breaking) are placed from Wikidata "
                "coordinates and have no tonnage. Cargo is total imports+exports for FY 2023-24 (July-June) from "
                "the Pakistan Economic Survey 2024-25; Gwadar's figure appears only as an unreadable chart in "
                "that PDF and is left null. Port points lie on water, so pcode falls back to the nearest district "
                "within ~10 km (pcode_method='nearest')."),
}

WPI_QID = {"PKKHI": "Q1842361", "PKBQM": "Q2977064"}  # Wikidata port items, used only to pick the district

MINOR = [  # (qid, name, kind)
    # Pasni Fish Harbour (Q7142246) has no coordinates on Wikidata or Wikipedia; use the town point.
    ("Q715199", "Pasni (fish harbour)", "fishing harbour (town point)"),
    ("Q4160323", "Jinnah Naval Base, Ormara", "naval base"),
    ("Q6395400", "Keti Bandar", "minor harbour (town)"),
    ("Q336325", "Gadani ship-breaking yard", "ship-breaking yard"),
]


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def pes_cargo() -> dict:
    """{'KHI': tonnes, 'BQM': tonnes} for FY CARGO_FY from PES 2024-25 chapter 13 text."""
    import pdfplumber
    with pdfplumber.open(fetch(SRC, PES_URL, "PES_2024-25_ch13_Transport_and_Communication.pdf")) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    out = {}
    # Table 13.4 (000 tonnes): "2023-24 32,854 18,800 51,654 13 47 23" (the July-March row is starred)
    i = text.index("Table 13.4: Cargo & Container Handling at Karachi Port 000 tonnes")
    m = re.search(rf"^{CARGO_FY} ([\d,]+) ([\d,]+) ([\d,]+) ", text[i:], re.M)
    imp, exp, tot = (int(v.replace(",", "")) for v in m.groups())
    assert imp + exp == tot
    out["KHI"] = {"cargo_t": tot * 1000, "imports_t": imp * 1000, "exports_t": exp * 1000,
                  "cargo_source": "PES 2024-25 Table 13.4 (source: Karachi Port Trust)"}
    # Fig-13.2 (million tonnes) data rows: header years then "Total ..", "Import ..", "Export .."
    k = text.index("Fig-13.2: Year-wise Trade Activity of Port Qasim Authority")
    fig = text[text.rindex("13.2-c Port Qasim Authority", 0, k):k]
    years = re.search(r"^(2017-18(?: 20\d\d-\d\d)+)$", fig, re.M).group(1).split()  # 2017-18 .. 2023-24
    rows = {k: [float(v) for v in re.search(rf"^{k} ((?:[\d.]+ ?)+)$", fig, re.M).group(1).split()]
            for k in ("Total", "Import", "Export")}
    # the last value is the 2024-25 July-March column (its label sits on a separate line)
    assert all(len(v) == len(years) + 1 for v in rows.values())
    j = years.index(CARGO_FY)
    tot, imp, exp = rows["Total"][j], rows["Import"][j], rows["Export"][j]
    assert abs(imp + exp - tot) < 0.002
    out["BQM"] = {"cargo_t": round(tot * 1e6), "imports_t": round(imp * 1e6), "exports_t": round(exp * 1e6),
                  "cargo_source": "PES 2024-25 Fig-13.2 data labels (source: Port Qasim Authority)"}
    return out


def ne_ports() -> list[dict]:
    import shapefile
    z = fetch(SRC, NE_URL)
    d = raw_dir(SRC) / "ne_x"
    if not (d / "ne_10m_ports.shp").exists():
        zipfile.ZipFile(z).extractall(d)
    r = shapefile.Reader(str(d / "ne_10m_ports.shp"))
    out = []
    for s, rec in zip(r.shapes(), r.records()):
        x, y = s.points[0]
        if 60.5 < x < 68.8 and 23.5 < y < 26.0:
            out.append({"name": rec["name"], "lon": x, "lat": y, "scalerank": rec["scalerank"]})
    return out


def _wd_coord(qid):
    ent = json.loads(fetch(SRC, WD.format(qid), f"wd_{qid}.json").read_text())["entities"][qid]
    cl = [c for c in ent["claims"].get("P625", []) if c["rank"] != "deprecated" and "datavalue" in c["mainsnak"]]
    if not cl:
        return None
    v = cl[0]["mainsnak"]["datavalue"]["value"]
    return v["longitude"], v["latitude"]


def _pcode(lon, lat):
    """District containing the point; ports sit on water, so fall back to the nearest district within ~10 km."""
    from pipeline.sources.cod_ab import pcode_at, geojson
    from shapely.geometry import Point, shape
    pc = pcode_at(lon, lat)
    if pc:
        return pc, "contains"
    global _DIST
    if "_DIST" not in globals():
        _DIST = [(f["properties"]["adm2_pcode"], shape(f["geometry"])) for f in geojson(2)["features"]]
    p = Point(lon, lat)
    d, pc = min((g.distance(p), c) for c, g in _DIST)
    return (pc, "nearest") if d < 0.1 else (None, None)


def _wpi_pcode(loc, lon, lat):
    """WPI coordinates are rounded to 1 arc-minute and fall in the water; prefer the district containing the
    port's Wikidata point (Karachi, Port Qasim), else the nearest district."""
    from pipeline.sources.cod_ab import pcode_at
    qid = WPI_QID.get(loc)
    c = _wd_coord(qid) if qid else None
    if c and pcode_at(*c):
        return {"pcode": pcode_at(*c), "pcode_method": f"wikidata:{qid}"}
    return dict(zip(("pcode", "pcode_method"), _pcode(lon, lat)))


def process():

    cargo = pes_cargo()
    ne = ne_ports()
    rows = []
    with open(fetch(SRC, WPI_URL, "UpdatedPub150.csv"), newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if "Pakistan" not in r["Country Code"]:
                continue
            lat, lon = float(r["Latitude"]), float(r["Longitude"])
            loc = r["UN/LOCODE"].replace(" ", "").strip() or None
            alt = r["Alternate Port Name"].strip()
            name = {"PKBQM": "Port Qasim (Muhammad Bin Qasim)"}.get(loc, r["Main Port Name"].strip())
            c = cargo.get(loc[2:] if loc else "", {})
            near_ne = [n["name"] for n in ne if abs(n["lon"] - lon) < 0.3 and abs(n["lat"] - lat) < 0.3]
            rows.append({"id": f"wpi-{int(float(r['World Port Index Number']))}", "name": name, "lat": lat, "lon": lon,
                         "kind": "commercial port", "unlocode": loc, "wpi_name": r["Main Port Name"].strip(),
                         "wpi_alt_name": alt or None, "harbor_size": r["Harbor Size"].strip() or None,
                         "harbor_type": r["Harbor Type"].strip() or None,
                         "channel_depth_m": _f(r["Channel Depth (m)"]),
                         "max_vessel_length_m": _f(r["Maximum Vessel Length (m)"]),
                         "natural_earth": near_ne[0] if near_ne else None,
                         "cargo_t": c.get("cargo_t"), "imports_t": c.get("imports_t"), "exports_t": c.get("exports_t"),
                         "cargo_fy": CARGO_FY if c else None, "cargo_source": c.get("cargo_source"),
                         **_wpi_pcode(loc, lon, lat), "src": SRC, "ref": WPI_OFFICIAL})
    for qid, name, kind in MINOR:
        c = _wd_coord(qid)
        if not c:
            continue
        lon, lat = c
        rows.append({"id": f"wd-{qid}", "name": name, "lat": round(lat, 5), "lon": round(lon, 5), "kind": kind,
                     "unlocode": None, "harbor_size": None, "cargo_t": None, "cargo_fy": None,
                     **dict(zip(("pcode", "pcode_method"), _pcode(lon, lat))), "src": SRC,
                     "ref": f"https://www.wikidata.org/wiki/{qid}"})
    write_json(interim(SRC), {"info": INFO, "ports": rows})
    return rows


if __name__ == "__main__":
    for r in process():
        print(f"{r['name']}: {r['kind']} {r['lat']:.3f},{r['lon']:.3f} cargo={r['cargo_t']} {r['pcode']}")
