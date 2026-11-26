"""Universities & tech hubs: OpenAlex institutions (country PK, type education) ranked by research output.

Rule (published in INFO.caveats): top 15 by OpenAlex works_count, max 2 per city (city = OpenAlex geo.city). A fixed
list of engineering / computing institutions is additionally tagged tech_hub and kept even outside the top 15.
Campus coordinates come from Wikidata P625 (via the OpenAlex Wikidata link); OpenAlex geo is a city centroid and is
only used as a flagged fallback.
"""
from __future__ import annotations

import json

from pipeline.common import fetch, write_json, interim
from pipeline.sources.unesco import sparql, _val, _qid, parse_point, point, wp_summaries, blurb_for

ID = "universities"
URL = ("https://api.openalex.org/institutions?filter=country_code:PK,type:education&sort=works_count:desc"
       "&per-page=100")
TOP_N, PER_CITY = 15, 2

# OpenAlex display names (exact) of institutions tagged as tech hubs: national engineering / CS flagships.
TECH_HUBS = {
    "National University of Sciences and Technology": "NUST",
    "Lahore University of Management Sciences": "LUMS",
    "National University of Computer and Emerging Sciences": "FAST-NUCES",
    "Ghulam Ishaq Khan Institute of Engineering Sciences and Technology": "GIKI",
    "COMSATS University Islamabad": "COMSATS",
    "Pakistan Institute of Engineering and Applied Sciences": "PIEAS",
    "University of Engineering and Technology Lahore": "UET Lahore",
    "NED University of Engineering and Technology": "NED",
    "Information Technology University": "ITU",
    "Mehran University of Engineering and Technology": "MUET",
    "University of Engineering and Technology Peshawar": "UET Peshawar",
    "Air University": "Air University",
}

INFO = {
    "id": ID,
    "title": "Universities and tech hubs (OpenAlex research output)",
    "publisher": "OpenAlex (OurResearch); coordinates from Wikidata",
    "vintage": "OpenAlex snapshot as retrieved 2026-11",
    "url": "https://openalex.org/",
    "files_urls": [URL, "https://query.wikidata.org/sparql"],
    "license": "OpenAlex CC0; Wikidata CC0",
    "used_for": ["University wonders / Science yield badges", "Tech-hub cluster pins"],
    "caveats": (f"RULE: the top {TOP_N} Pakistani education institutions by OpenAlex works_count (all-time indexed "
                f"publications), taking at most {PER_CITY} per city (OpenAlex geo.city); lower-ranked ones in a full "
                "city are skipped. Research output is a proxy for prominence, not enrolment, quality or R&D spend; "
                "medical colleges and multi-campus systems are counted as OpenAlex groups them. Tech-hub tag is a "
                "curated list of engineering/computing flagships (NUST, LUMS, FAST-NUCES, GIKI, COMSATS, PIEAS, UET, "
                "NED, ITU, MUET, Air University) shown even outside the top 15. Coordinates are Wikidata P625 campus "
                "points; where missing or more than 25 km from the OpenAlex city, the Wikipedia coordinate, else the OpenAlex city centroid (facts.coord_src); if that centroid is itself >25 km from the COD-AB centroid of the same-named district, the district centroid is used."),
}


def wikidata(qids):
    vals = " ".join("wd:" + q for q in qids)
    q = f"""SELECT ?item ?coord ?inception ?desc WHERE {{
  VALUES ?item {{ {vals} }}
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item schema:description ?desc . FILTER(lang(?desc) = "en") }}
}}"""
    out = {}
    for b in sparql(ID, "wikidata_universities.json", q)["results"]["bindings"]:
        r = out.setdefault(_qid(_val(b, "item")), {"coord": None, "inception": None, "desc": _val(b, "desc")})
        if r["coord"] is None:
            r["coord"] = parse_point(_val(b, "coord"))
        inc = _val(b, "inception")
        if inc and r["inception"] is None:
            r["inception"] = int(inc.lstrip("+")[:4]) if inc[0] != "-" else None
    return out


MAX_KM_FROM_CITY = 25.0  # Wikidata points farther than this from the OpenAlex city are treated as errors


def _km(a, b):
    import math
    dy = (a[0] - b[0]) * 111.0
    dx = (a[1] - b[1]) * 111.0 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def process():
    rows = json.loads(fetch(ID, URL, "openalex_pk_education.json").read_text())["results"]
    rank = {r["id"]: i + 1 for i, r in enumerate(rows)}
    chosen, per_city = [], {}
    for r in rows:
        c = r["geo"]["city"]
        if len(chosen) < TOP_N and per_city.get(c, 0) < PER_CITY:
            chosen.append(r)
            per_city[c] = per_city.get(c, 0) + 1
    hubs = [r for r in rows if r["display_name"] in TECH_HUBS and r not in chosen]
    sel = chosen + hubs
    qids = {r["id"]: _qid((r.get("ids") or {}).get("wikidata")) for r in sel}
    wd = wikidata(sorted(q for q in qids.values() if q))
    titles = {}
    for r in sel:
        w = (r.get("ids") or {}).get("wikipedia")
        if w:
            titles[r["id"]] = w.rsplit("/wiki/", 1)[-1].replace("_", " ")
    summ = wp_summaries(ID, sorted(set(titles.values())))
    from pipeline.common import read_json
    dists = {d["name"]: d for d in read_json(interim("districts"))["districts"]}
    out = []
    for r in sel:
        q = qids[r["id"]]
        w = wd.get(q, {})
        glat, glon = r["geo"]["latitude"], r["geo"]["longitude"]
        wpc = (summ.get(titles.get(r["id"]), {}) or {}).get("coordinates")
        wpc = (wpc["lat"], wpc["lon"]) if wpc else None
        dist = dists.get(r["geo"]["city"])
        if w.get("coord") and _km(w["coord"], (glat, glon)) <= MAX_KM_FROM_CITY:
            (lat, lon), csrc = w["coord"], "wikidata"
        elif wpc and _km(wpc, (glat, glon)) <= MAX_KM_FROM_CITY:
            (lat, lon), csrc = wpc, "wikipedia"
        elif dist and _km((glat, glon), (dist["lat"], dist["lon"])) > MAX_KM_FROM_CITY:
            # OpenAlex city point itself is inconsistent with the named city's district -> district centroid
            lat, lon, csrc = dist["lat"], dist["lon"], "codab_district_centroid"
        else:
            lat, lon, csrc = glat, glon, "openalex_city"
        oid = r["id"].rsplit("/", 1)[-1]
        out.append(point(
            id=f"uni-{oid}", name=r["display_name"], lat=round(lat, 5), lon=round(lon, 5),
            blurb=blurb_for(summ.get(titles.get(r["id"]), {}), w.get("desc")),
            facts={"works_count": r["works_count"], "cited_by_count": r["cited_by_count"],
                   "openalex_rank_pk": rank[r["id"]], "city": r["geo"]["city"], "founded": w.get("inception"),
                   "in_top15_rule": r in chosen, "tech_hub": r["display_name"] in TECH_HUBS,
                   "short": TECH_HUBS.get(r["display_name"]), "coord_src": csrc},
            src=ID, ref=f"https://api.openalex.org/institutions/{oid}", wikidata=q, snap_km=2))
    write_json(interim(ID), {"info": INFO, "rule": INFO["caveats"].split(" Research")[0],
                             "universities": out}, compact=False)
    return out


if __name__ == "__main__":
    u = process()
    print(len(u), "records;", sum(x["facts"]["in_top15_rule"] for x in u), "by rule;",
          sum(x["facts"]["tech_hub"] for x in u), "tech hubs;", sum(x["facts"]["coord_src"] != "wikidata" for x in u),
          "city-centroid coords")
