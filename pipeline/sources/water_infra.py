"""Indus Basin dams, barrages and headworks (curated list) with facts pulled from references at build time:
coordinates from Wikidata P625 (cross-checked against the OSM point in transport.json), and river / year /
hydropower MW / storage / spillway discharge parsed from the English Wikipedia infobox of each structure (raw
wikitext cached in data/raw/water_infra/). Plus the Indus Waters Treaty river assignment, verified against the
cached Wikipedia article text. Output: data/interim/water_infra.json."""
from __future__ import annotations

import json
import math
import re
from urllib.parse import quote

from pipeline.common import fetch, write_json, interim, read_json

SRC = "water_infra"
WD = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
WP = "https://en.wikipedia.org/w/index.php?title={}&action=raw"
M3_PER_ACRE_FT = 1233.48184
CUSEC_PER_M3S = 35.3146667

INFO = {
    "id": SRC,
    "title": "Indus Basin dams, barrages and headworks",
    "publisher": "Wikidata; English Wikipedia (infoboxes citing WAPDA / Punjab & Sindh Irrigation Depts); "
                 "OpenStreetMap (location cross-check)",
    "vintage": "references retrieved 2026-11",
    "url": "https://www.wikidata.org/",
    "files_urls": [WD.format("<QID>"), WP.format("<article>")],
    "license": "Wikidata: CC0; Wikipedia: CC BY-SA 4.0; OSM: ODbL",
    "used_for": ["dam / barrage / headworks points", "irrigation (aqueduct) and hydropower yields",
                 "Indus Waters Treaty western/eastern river lens"],
    "caveats": ("The list of structures is curated; every numeric fact is parsed from the cited Wikipedia infobox "
                "(or Wikidata) and is null when the reference doesn't give it. design_discharge_cusecs is the "
                "spillway / flood design discharge given in the infobox, not canal command capacity. Storage "
                "values are the infobox's design figures (often original, before sedimentation). Year = infobox "
                "'opening' (null for structures under construction). Where the Wikidata point is more than 5 km from "
                "the named OSM structure (or missing), the OSM point is used (coord_src)."),
}

# name, kind, Wikidata QID, Wikipedia title override (None = use the item's enwiki sitelink),
# fallback river (used only if neither Wikidata nor the infobox names one; must appear in the article text),
# OSM name to cross-check against transport.json barrages_osm.
STRUCTURES = [
    ("Tarbela Dam", "dam", "Q1551258", None, "Indus", "Tarbela"),
    ("Mangla Dam", "dam", "Q1286541", None, "Jhelum", "Mangla"),
    ("Diamer-Bhasha Dam", "dam", "Q1140572", None, "Indus", "Bhasha"),
    ("Mohmand Dam", "dam", "Q6935710", None, "Swat", "Mohmand"),
    ("Warsak Dam", "dam", "Q7970870", None, "Kabul", "Warsak"),
    ("Ghazi-Barotha Hydropower Project", "barrage", "Q3445691", None, "Indus", "Ghazi"),
    ("Chashma Barrage", "barrage", "Q5087276", None, "Indus", "Chashma"),
    ("Jinnah Barrage", "barrage", "Q15229594", None, "Indus", "Jinnah"),
    ("Taunsa Barrage", "barrage", "Q7492805", None, "Indus", "Taunsa"),
    ("Guddu Barrage", "barrage", "Q5614557", None, "Indus", "Guddu"),
    ("Sukkur Barrage (Lloyd Barrage)", "barrage", "Q7635874", None, "Indus", "Sukkur"),
    ("Kotri Barrage (Ghulam Muhammad Barrage)", "barrage", "Q6434241", None, "Indus", "Kotri"),
    ("Rasul Barrage", "barrage", "Q7295323", None, "Jhelum", "Rasul"),
    ("Marala Headworks", "headworks", "Q6754700", None, "Chenab", "Marala"),
    ("Trimmu Barrage", "barrage", "Q889382", None, "Chenab", "Trimmu"),
    ("Panjnad Headworks", "headworks", "Q15265320", None, "Panjnad", "Panjnad"),
    ("Islam Headworks", "headworks", "Q6081656", None, "Sutlej", "Islam"),
    ("Sulemanki Headworks", "headworks", "Q7636149", None, "Sutlej", "Sulemanki"),
    ("Balloki Headworks", "headworks", "Q4851833", None, "Ravi", "Balloki"),
    ("Qadirabad Barrage", "barrage", "Q7265774", None, None, "Qadirabad"),
    ("Khanki Headworks", "headworks", "Q6400350", None, "Chenab", "Khanki"),
    ("Neelum-Jhelum Hydropower Plant", "dam", "Q14326986", None, "Neelum", None),
    ("Mirani Dam", "dam", "Q6872871", None, "Dasht", "Mirani"),
    ("Sabakzai Dam", "dam", "Q7395853", None, "Zhob", "Sabakzai"),
    ("Hub Dam", "dam", "Q5268427", "Hub Dam Reservoir", "Hub", "Hub Dam"),
    ("Khanpur Dam", "dam", "Q5257957", None, "Haro", "Khanpur"),
    ("Rawal Dam", "dam", "Q5268374", "Rawal Lake", "Korang", "Rawal"),
    ("Simly Dam", "dam", "Q7517934", None, "Soan", "Simly"),
]

# Reference values judged implausible on review (kept out of the output, reason recorded in the row's note).
REJECT_DISCHARGE = {
    "Simly Dam": "implausible for a 0.03 MAF water-supply reservoir (comparable to Tarbela's total spillway capacity)",
}

IWT_TITLE = "Indus_Waters_Treaty"
IWT_EVIDENCE = ("three western rivers – the Indus, the Jhelum and Chenab – and three eastern rivers – the Sutlej, "
                "the Beas and the Ravi")


# --------------------------------------------------------------------------------------------- references

def _wikidata(qid):
    return json.loads(fetch(SRC, WD.format(qid), f"wd_{qid}.json").read_text())["entities"][qid]


def _wikitext(title):
    title = title.replace(" ", "_")
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", title)
    t = fetch(SRC, WP.format(quote(title, safe="_")), f"wp_{safe}.wikitext").read_text()
    m = re.match(r"\s*#REDIRECT\s*\[\[([^\]#|]+)", t, re.I)
    return (_wikitext(m.group(1)) if m else (t, title))


def _claims(ent, prop):
    cl = [c for c in ent.get("claims", {}).get(prop, []) if c["rank"] != "deprecated" and "datavalue" in c["mainsnak"]]
    return [c for c in cl if c["rank"] == "preferred"] or cl


def _label(qid):
    e = _wikidata(qid)
    return e.get("labels", {}).get("en", {}).get("value")


def infobox(wt: str) -> dict:
    """Top-level '| key = value' lines of the article (first occurrence wins); refs and comments stripped."""
    out = {}
    for line in wt.splitlines():
        # some infoboxes pack two fields per line ("| a = x | b = y"); template params ("{{convert|abbr=on|..")
        # have no whitespace before the pipe, so only split on " |"
        for part in re.split(r"(?:^|\s)\|(?=\s*[a-z_]+\s*=)", line):
            m = re.match(r"\s*([a-z_]+)\s*=\s*(.*)$", part)
            if m and m.group(1) not in out:
                v = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->", "", m.group(2)).strip()
                if v:
                    out[m.group(1)] = v
    return out


def _clean(v):
    v = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", v)
    return re.sub(r"<[^>]+>|'''?", " ", v).strip()


def _number(s):
    return float(s.replace(",", "").strip())


def parse_volume(v):
    """Infobox storage -> (MAF, km3) or None. Accepts {{convert|N|acre.ft|..}}, {{convert|N|m3|..}}, km3."""
    if not v or "cusec" in v.lower():
        return None
    m = re.search(r"\{\{\s*convert\s*\|(?:abbr=on\|)?\s*([\d,.]+)\s*\|\s*(acre\.?ft|m3|km3|e9m3)", v, re.I)
    if not m:
        return None
    n, unit = _number(m.group(1)), m.group(2).lower().replace(".", "")
    m3 = {"acreft": n * M3_PER_ACRE_FT, "m3": n, "km3": n * 1e9, "e9m3": n * 1e9}[unit]
    return round(m3 / M3_PER_ACRE_FT / 1e6, 4), round(m3 / 1e9, 4)


def parse_discharge(v):
    """Infobox spillway/discharge -> cusecs (sum of components if several are listed), or None."""
    if not v:
        return None
    m = re.search(r"\{\{\s*convert\s*\|\s*([\d,.]+)\s*\|\s*(m3/s|ft3/s|cuft/s)", v, re.I)
    if m:
        n = _number(m.group(1))
        return round(n * CUSEC_PER_M3S) if m.group(2).lower() == "m3/s" else round(n)
    vals = []
    for num, mill in re.findall(r"([\d][\d,.]*)\s*(million)?\s*\[*cusecs?", v, re.I):
        vals.append(_number(num) * (1e6 if mill else 1))
    return round(sum(vals)) if vals else None


def parse_mw(v):
    m = re.search(r"([\d][\d,.]*)\s*(?:&nbsp;|\s)*\[*(?:Megawatt\|)?MW", v or "")
    return _number(m.group(1)) if m else None


def parse_year(v):
    if not v or re.search(r"est|planned|proposed", v, re.I):
        return None
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", v)
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------------------------- build

def _km(a, b):
    return math.hypot((a[0] - b[0]) * math.cos(math.radians(a[1])), a[1] - b[1]) * 111.2


def process():
    from pipeline.sources.cod_ab import pcode_at

    osm = read_json(interim("transport")).get("barrages_osm", []) if interim("transport").exists() else []
    rows = []
    for name, kind, qid, title, river_fb, osm_name in STRUCTURES:
        ent = _wikidata(qid)
        refs = [f"https://www.wikidata.org/wiki/{qid}"]
        title = title or ent.get("sitelinks", {}).get("enwiki", {}).get("title")
        ib, wt = {}, ""
        if title:
            wt, title = _wikitext(title)
            ib = infobox(wt)
            refs.append("https://en.wikipedia.org/wiki/" + title)

        # location
        c = _claims(ent, "P625")
        wd_pt = (c[0]["mainsnak"]["datavalue"]["value"]["longitude"],
                 c[0]["mainsnak"]["datavalue"]["value"]["latitude"]) if c else None
        o = next((b for b in osm if osm_name and osm_name.lower() in b["name"].lower()
                  and (wd_pt is None or _km(wd_pt, (b["lon"], b["lat"])) < 100)), None)
        if wd_pt and not (o and _km(wd_pt, (o["lon"], o["lat"])) > 5):
            lon, lat, coord_src = wd_pt[0], wd_pt[1], f"wikidata:{qid}"
        elif o:
            lon, lat, coord_src = o["lon"], o["lat"], f"osm:{o['osm_id']}"
            osm_kind = {"w": "way", "n": "node", "r": "relation"}[o["osm_id"][0]]
            refs.append(f"https://www.openstreetmap.org/{osm_kind}/{o['osm_id'][1:]}")
        else:
            lon = lat = coord_src = None

        # river
        river = None
        for p in ("P4792", "P206", "P469"):
            for cl in _claims(ent, p):
                river = _label(cl["mainsnak"]["datavalue"]["value"]["id"])
                if river:
                    break
            if river:
                break
        river = re.sub(r"\s+[Rr]iver$", "", river) if river else None
        river_src = "wikidata" if river else None
        if not river and ib.get("dam_crosses"):
            river = re.sub(r"\s+[Rr]iver$", "", _clean(ib["dam_crosses"]).split("  ")[0].strip())
            river_src = "wikipedia infobox"
        if not river and river_fb and river_fb in wt:
            river, river_src = river_fb, "wikipedia text"

        # facts
        status = _clean(ib.get("status", "")) or None
        status = {"O": "Operational", "o": "Operational"}.get(status, status)
        year = parse_year(ib.get("opening"))
        mw = parse_mw(ib.get("plant_capacity")) or parse_mw(ib.get("ps_installed_capacity"))
        mw_src = "wikipedia infobox" if mw else None
        if mw is None:
            for cl in _claims(ent, "P2109"):
                v = cl["mainsnak"]["datavalue"]["value"]
                if v["unit"].endswith("/Q6982035"):
                    mw, mw_src = float(v["amount"]), "wikidata P2109"
                    break
        live = parse_volume(ib.get("res_capacity_active"))
        gross = parse_volume(ib.get("res_capacity_total"))
        dis_field = next((k for k in ("spillway_capacity", "design_discharge", "discharge", "res_capacity_total")
                          if parse_discharge(ib.get(k))), None)
        discharge = parse_discharge(ib.get(dis_field)) if dis_field else None
        note = None
        if name in REJECT_DISCHARGE and discharge is not None:
            note = f"infobox discharge ({discharge:,} cusecs) rejected: {REJECT_DISCHARGE[name]}"
            discharge = None

        rows.append({
            "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"), "name": name, "kind": kind,
            "lat": round(lat, 5) if lat is not None else None, "lon": round(lon, 5) if lon is not None else None,
            "coord_src": coord_src, "river": river, "river_src": river_src, "status": status,
            "year_completed": year, "capacity_mw": mw, "capacity_src": mw_src,
            "live_storage_maf": live[0] if live else None, "live_storage_km3": live[1] if live else None,
            "gross_storage_maf": gross[0] if gross else None, "gross_storage_km3": gross[1] if gross else None,
            "design_discharge_cusecs": discharge,
            "discharge_text": _clean(ib[dis_field])[:120] if dis_field else None,
            "note": note, "pcode": pcode_at(lon, lat) if lon is not None else None, "src": SRC,
            "ref": refs[-1] if len(refs) > 1 else refs[0], "refs": refs,
        })

    iwt_text, _ = _wikitext(IWT_TITLE)
    if IWT_EVIDENCE not in iwt_text:
        raise ValueError("Indus Waters Treaty evidence sentence not found in cached article")
    iwt = {"western": ["Indus", "Jhelum", "Chenab"], "eastern": ["Ravi", "Beas", "Sutlej"],
           "western_use": "Pakistan (exclusive use, subject to permitted Indian uses)",
           "eastern_use": "India (exclusive use, subject to permitted Pakistani uses)",
           "signed": 1960, "ref": "https://en.wikipedia.org/wiki/Indus_Waters_Treaty", "evidence": IWT_EVIDENCE}
    write_json(interim(SRC), {"info": INFO, "structures": rows, "indus_waters_treaty": iwt})
    return rows


if __name__ == "__main__":
    for r in process():
        print(f"{r['name'][:34]:34} {r['kind']:9} {r['river']!s:14} {r['year_completed']!s:5} "
              f"MW={r['capacity_mw']} live={r['live_storage_maf']} gross={r['gross_storage_maf']} "
              f"Q={r['design_discharge_cusecs']} {r['coord_src']} {r['pcode']} [{r['status']}]")
