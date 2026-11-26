"""Power plants: WRI Global Power Plant Database (Pakistan rows) + a short curated supplement of major plants
commissioned since ~2018 that GPPD (last updated 2021, Pakistan coverage frozen earlier) misses.

Supplement rules: capacity comes from a cited reference (CPEC Authority energy-project table, Wikidata P2109
preferred value, or a verbatim sentence in the cached Wikipedia wikitext — the evidence string is checked
against the downloaded file at build time); coordinates come from the OpenStreetMap power=plant feature
(Geofabrik extract cached by the transport source) or Wikidata P625. Output: data/interim/power_plants.json."""
from __future__ import annotations

import csv
import html
import json
import re

from pipeline.common import fetch, raw_dir, record, write_json, interim, load_manifest

SRC = "power_plants"
GPPD_URL = ("https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/"
            "global_power_plant_database.csv")
CPEC_URL = "https://cpec.gov.pk/energy"
PBF_URL = "https://download.geofabrik.de/asia/pakistan-latest.osm.pbf"
WD = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
WP = "https://en.wikipedia.org/w/index.php?title={}&action=raw"

INFO = {
    "id": SRC,
    "title": "Power plants (WRI Global Power Plant Database + curated post-2018 supplement)",
    "publisher": "World Resources Institute et al. (GPPD v1.3.0); supplement: CPEC Authority, Wikidata, Wikipedia, "
                 "OpenStreetMap",
    "vintage": "GPPD v1.3.0 (2021); supplement checked 2026-11",
    "url": "https://datasets.wri.org/dataset/globalpowerplantdatabase",
    "files_urls": [GPPD_URL, CPEC_URL, PBF_URL],
    "license": "GPPD: CC BY 4.0; Wikidata: CC0; Wikipedia: CC BY-SA 4.0; OSM: ODbL",
    "used_for": ["power plant points sized by capacity and coloured by fuel", "district generation capacity"],
    "caveats": ("GPPD lists only 62 Pakistani plants and is stale (no Thar coal, Neelum-Jhelum, Karot, K-2/K-3, "
                "RLNG plants). A short supplement (rows with src_detail='supplement') adds major plants "
                "commissioned since ~2018, each with a reference URL; Tarbela 4th/5th extensions are listed as "
                "separate rows on top of GPPD's 3,478 MW Tarbela figure. GPPD coordinates for some IPPs are "
                "approximate (several share one point). Small wind/solar IPPs after 2018 are not added. "
                "Capacity is nameplate MW as stated by the reference, not NEPRA dependable capacity."),
}

# Curated supplement. cap = ("cpec", <row-name substring>) | ("wikidata", None) | ("wikipedia", <title>, <verbatim
# evidence>, <MW stated in evidence>); year likewise from Wikidata P729/P1619 or a Wikipedia evidence string.
SUPPLEMENT = [
    dict(name="Neelum-Jhelum Hydropower Plant", fuel="Hydro", qid="Q14326986", osm="w851934292",
         cap=("wikidata", None), status="operating"),
    dict(name="Karot Hydropower Project", fuel="Hydro", qid="Q24947737", osm="w1019215981",
         cap=("cpec", "720MW Karot Hydropower Project"), status="operating"),
    dict(name="Suki Kinari Hydropower Project", fuel="Hydro", qid="Q24947725", osm="w1548663888",
         cap=("cpec", "884MW Suki Kinari Hydropower Project"), status="operating"),
    dict(name="China Power Hub coal power plant", fuel="Coal", qid="Q104854929", osm="w859896499",
         cap=("cpec", "1320MW China Hub Coal Power Project"), status="operating"),
    dict(name="Engro Thar coal power plant (Thar Block-II)", fuel="Coal", qid="Q7710720", osm="w690319732",
         cap=("cpec", "660MW Engro Thar Coal Power Project"), status="operating"),
    dict(name="Shanghai Electric Thar Coal Block-I power plant", fuel="Coal", qid=None, osm="w859911854",
         cap=("cpec", "1320MW SSRL Thar Coal Block-I"), status="operating"),
    dict(name="Thar Energy Limited (HUBCO)", fuel="Coal", qid=None, osm="w859927477",
         cap=("cpec", "330MW HUBCO Thar Coal Power Project (Thar Energy)"), status="operating"),
    dict(name="ThalNova Power Thar (HUBCO)", fuel="Coal", qid=None, osm="w859927478",
         cap=("cpec", "330MW HUBCO ThalNova Thar Coal Power Project"), status="operating"),
    dict(name="Karachi Nuclear Power Plant units K-2 and K-3", fuel="Nuclear", qid="Q1274134", osm="w403601261",
         cap=("wikipedia", "Karachi_Nuclear_Power_Complex", "*2 x 1,014 [[watt|MW<sub>e</sub>]]", 2 * 1014),
         year=("wikipedia", "Karachi_Nuclear_Power_Complex", "*K2: {{start date|df=yes|2021|03|18}}", 2021),
         status="operating", note="2 x 1,014 MWe (Hualong One). GPPD's 137 MW 'Kanupp' is unit K-1 (retired 2021)."),
    dict(name="Tarbela 4th Extension", fuel="Hydro", qid="Q1551258", osm=None,
         cap=("wikipedia", "Tarbela_Dam", "the 1,410 MW Tarbela-IV Extension Project", 1410),
         year=("wikipedia", "Tarbela_Dam", "and was completed in February 2018", 2018),
         status="operating", note="Extension at Tarbela Dam; adds to GPPD's 3,478 MW Tarbela row (4,888 MW total)."),
    dict(name="Tarbela 5th Extension", fuel="Hydro", qid="Q1551258", osm=None,
         cap=("wikipedia", "Tarbela_Dam", "by adding 1,530 megawatts to the existing tunnel 5", 1530),
         year=None, status="under construction", note="Under construction at Tarbela Dam (tunnel 5)."),
    dict(name="Bhikki Power Plant (RLNG)", fuel="Gas", qid="Q113484892", osm="w1018681707",
         cap=("wikidata", None), status="operating"),
    dict(name="Haveli Bahadur Shah Power Plant (RLNG)", fuel="Gas", qid="Q48732158", osm="w863128989",
         cap=("wikidata", None), status="operating"),
    dict(name="Balloki Power Plant (RLNG)", fuel="Gas", qid="Q11960095", osm="w864698074",
         cap=("wikidata", None), status="operating"),
    dict(name="Punjab Thermal Power Plant, Trimmu (RLNG)", fuel="Gas", qid="Q113484907", osm="w863128990",
         cap=("wikidata", None), status="operating"),
]


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# --------------------------------------------------------------------------------------------- references

def _wikidata(qid):
    return json.loads(fetch(SRC, WD.format(qid), f"wd_{qid}.json").read_text())["entities"][qid]


def _claims(ent, prop):
    cl = [c for c in ent.get("claims", {}).get(prop, []) if c["rank"] != "deprecated"
          and "datavalue" in c["mainsnak"]]
    pref = [c for c in cl if c["rank"] == "preferred"]
    return pref or cl


def wd_coord(ent):
    c = _claims(ent, "P625")
    if not c:
        return None
    v = c[0]["mainsnak"]["datavalue"]["value"]
    return v["longitude"], v["latitude"]


def wd_capacity_mw(ent):
    for c in _claims(ent, "P2109"):
        v = c["mainsnak"]["datavalue"]["value"]
        unit = v["unit"].rsplit("/", 1)[-1]
        amt = float(v["amount"])
        scale = {"Q6982035": 1.0, "Q3332099": 0.001, "Q25236": 1e-6, "Q1458426": 1000.0}.get(unit)  # MW, kW, W, GW
        if scale is not None:
            return round(amt * scale, 3)
    return None


def wd_year(ent):
    for p in ("P729", "P1619"):  # service entry, date of official opening
        c = _claims(ent, p)
        if c:
            t = c[0]["mainsnak"]["datavalue"]["value"]["time"]
            return int(t[1:5])
    return None


def _wikitext(title):
    from urllib.parse import quote
    title = title.replace(" ", "_")
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", title)
    return fetch(SRC, WP.format(quote(title, safe="_")), f"wp_{safe}.wikitext").read_text()


def _evidence(title, text):
    wt = _wikitext(title)
    if text not in wt:
        raise ValueError(f"evidence not found in Wikipedia {title}: {text!r}")


def wp_infobox_year(ent):
    """First year in the enwiki infobox 'commissioned'/'opening' field of a Wikidata item's article."""
    title = ent.get("sitelinks", {}).get("enwiki", {}).get("title")
    if not title:
        return None, None
    m = re.search(r"\|\s*(?:commissioned|opening)\s*=\s*([^\n]*)", _wikitext(title))
    y = re.search(r"\b(19|20)\d\d\b", m.group(1)) if m else None
    if not y:
        return None, None
    return int(y.group(0)), "https://en.wikipedia.org/wiki/" + title.replace(" ", "_")


def cpec_table():
    """{project name: MW string} from the CPEC Authority energy-projects table."""
    t = fetch(SRC, CPEC_URL, "cpec_energy.html").read_text(errors="ignore")
    out = {}
    for r in re.findall(r"<tr.*?</tr>", t, flags=re.S):
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
                 for c in re.findall(r"<td.*?</td>", r, flags=re.S)]
        if len(cells) >= 3 and cells[0].isdigit():
            out[cells[1]] = cells[2]
    return out


def osm_plants():
    """power=plant features from the cached Geofabrik PBF (transport source), as {osm id: record}."""
    name = "osm_power_plants.json"
    p = raw_dir(SRC) / name
    if not (p.exists() and name in load_manifest(SRC)):
        import osmium
        pbf = fetch("transport", PBF_URL)
        out = {}

        class H(osmium.SimpleHandler):
            def node(self, n):
                if n.tags.get("power") == "plant":
                    out[f"n{n.id}"] = self._rec(n.tags, n.location.lon, n.location.lat)

            def area(self, a):
                if a.tags.get("power") != "plant":
                    return
                xs, ys = [], []
                try:
                    for ring in a.outer_rings():
                        for nd in ring:
                            xs.append(nd.lon); ys.append(nd.lat)
                except Exception:  # broken multipolygon
                    return
                if xs:
                    key = ("w" if a.from_way() else "r") + str(a.orig_id())
                    out[key] = self._rec(a.tags, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)

            @staticmethod
            def _rec(t, lon, lat):
                return {"name": t.get("name:en") or t.get("name"), "source": t.get("plant:source"),
                        "output": t.get("plant:output:electricity"), "operator": t.get("operator"),
                        "lon": round(lon, 5), "lat": round(lat, 5)}

        H().apply_file(str(pbf), locations=True)
        p.write_text(json.dumps(out, indent=0, ensure_ascii=False))
        record(SRC, name, PBF_URL + " (power=plant features, bbox-centre of area)")
    return json.loads(p.read_text())


# --------------------------------------------------------------------------------------------- build

def process():
    from pipeline.sources.cod_ab import pcode_at

    rows = []
    with open(fetch(SRC, GPPD_URL), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["country"] != "PAK":
                continue
            lat, lon = float(r["latitude"]), float(r["longitude"])
            yr = _num(r["commissioning_year"])
            rows.append({"id": r["gppd_idnr"], "name": r["name"].strip(), "lat": lat, "lon": lon,
                         "capacity_mw": _num(r["capacity_mw"]), "primary_fuel": r["primary_fuel"] or None,
                         "commissioning_year": int(yr) if yr else None, "owner": r["owner"].strip() or None,
                         "status": None, "src_detail": "gppd", "pcode": pcode_at(lon, lat), "src": SRC,
                         "ref": r["url"] or None})

    cpec = cpec_table()
    osm = osm_plants()
    for s in SUPPLEMENT:
        ent = _wikidata(s["qid"]) if s.get("qid") else None
        refs = []
        # capacity
        kind = s["cap"][0]
        if kind == "cpec":
            key = next(k for k in cpec if k.startswith(s["cap"][1]))
            cap = float(cpec[key].replace(",", ""))
            refs.append(CPEC_URL)
        elif kind == "wikidata":
            cap = wd_capacity_mw(ent)
            refs.append(f"https://www.wikidata.org/wiki/{s['qid']}")
        else:
            _, title, ev, cap = s["cap"]
            _evidence(title, ev)
            refs.append(f"https://en.wikipedia.org/wiki/{title}")
        # year
        year = None
        if s.get("year"):
            _, title, ev, year = s["year"]
            _evidence(title, ev)
            refs.append(f"https://en.wikipedia.org/wiki/{title}")
        elif ent is not None and "year" not in s:
            year = wd_year(ent)
            if year is None:
                year, wp_ref = wp_infobox_year(ent)
                if wp_ref:
                    refs.append(wp_ref)
        # location + owner
        owner = None
        if s.get("osm"):
            o = osm[s["osm"]]
            lon, lat, owner = o["lon"], o["lat"], o["operator"]
            kind_osm = {"w": "way", "n": "node", "r": "relation"}[s["osm"][0]]
            refs.append(f"https://www.openstreetmap.org/{kind_osm}/{s['osm'][1:]}")
        else:
            lon, lat = wd_coord(ent)
            refs.append(f"https://www.wikidata.org/wiki/{s['qid']}")
        if ent is not None and f"https://www.wikidata.org/wiki/{s['qid']}" not in refs:
            refs.append(f"https://www.wikidata.org/wiki/{s['qid']}")
        refs = list(dict.fromkeys(refs))
        rows.append({"id": "sup-" + _slug(s["name"]), "name": s["name"], "lat": round(lat, 5), "lon": round(lon, 5),
                     "capacity_mw": cap, "primary_fuel": s["fuel"], "commissioning_year": year, "owner": owner,
                     "status": s["status"], "src_detail": "supplement", "note": s.get("note"),
                     "pcode": pcode_at(lon, lat), "src": SRC, "ref": refs[0], "refs": refs})

    # guard: supplement must not duplicate a GPPD plant of the same fuel within 3 km (extensions are deliberate)
    import math
    g = [r for r in rows if r["src_detail"] == "gppd"]
    for r in rows:
        if r["src_detail"] != "supplement" or "Extension" in r["name"] or "K-2" in r["name"]:
            continue
        for q in g:
            d = math.hypot((r["lon"] - q["lon"]) * math.cos(math.radians(r["lat"])), r["lat"] - q["lat"]) * 111
            if d < 3 and q["primary_fuel"] == r["primary_fuel"]:
                raise ValueError(f"supplement {r['name']} duplicates GPPD {q['name']} ({d:.1f} km)")

    rows.sort(key=lambda r: -(r["capacity_mw"] or 0))
    write_json(interim(SRC), {"info": INFO, "plants": rows})
    return rows


if __name__ == "__main__":
    rs = process()
    sup = [r for r in rs if r["src_detail"] == "supplement"]
    print(len(rs), "plants;", len(sup), "supplement;", round(sum(r["capacity_mw"] or 0 for r in rs)), "MW total;",
          sum(r["pcode"] is None for r in rs), "without pcode")
    for r in sup:
        print(f"  {r['name']}: {r['capacity_mw']} MW {r['commissioning_year']} {r['pcode']}")
