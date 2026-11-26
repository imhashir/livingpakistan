"""Natural and cultural wonders (curated, published rule) + WDPA national parks.

Coordinates, elevations (P2044), lengths (P2043), areas (P2046), prominence (P2660), inception (P571) and nominal
power (P2109) come from Wikidata (unit-normalised values, raw SPARQL JSON in data/raw/wonders/). Blurbs are the first
sentence of the English Wikipedia summary (or the Wikidata description). "Superlative" facts for the Surprise-Me
button are kept only when the phrase is found verbatim in the Wikipedia summary text, and that sentence is stored.
National parks come from the UNEP-WCMC WDPCA (Protected Planet) Pakistan extract via HDX / ArcGIS.
"""
from __future__ import annotations

import json
import re
import urllib.parse

from pipeline.common import fetch, write_json, interim
from pipeline.sources.unesco import (sparql, _val, _qid, parse_point, point, wp_summaries, blurb_for, wiki_url,
                                     pcode_of)

ID = "wonders"

# (id, kind, category, enwiki title, superlative regex searched in the Wikipedia summary or None)
NATURAL = [
    ("k2", "peak", "eight-thousander", "K2", r"second[- ]highest mountain"),
    ("nanga-parbat", "peak", "eight-thousander", "Nanga Parbat", r"ninth[- ]highest|killer mountain"),
    ("gasherbrum-1", "peak", "eight-thousander", "Gasherbrum I", r"11th[- ]highest"),
    ("broad-peak", "peak", "eight-thousander", "Broad Peak", r"12th[- ]highest"),
    ("gasherbrum-2", "peak", "eight-thousander", "Gasherbrum II", r"13th[- ]highest"),
    ("rakaposhi", "peak", "peak", "Rakaposhi", r"27th[- ]highest|only mountain in the world that rises directly"),
    ("tirich-mir", "peak", "peak", "Terich Mir", r"highest mountain in the Hindu Kush"),
    ("siachen", "glacier", "glacier", "Siachen Glacier", r"longest glacier[^.]*"),
    ("baltoro", "glacier", "glacier", "Baltoro Glacier", r"longest glaciers?[^.]*"),
    ("biafo", "glacier", "glacier", "Biafo Glacier", r"longest glacier[^.]*"),
    ("batura", "glacier", "glacier", "Batura Glacier", r"longest glacier[^.]*"),
    ("deosai", "plateau", "landscape", "Deosai National Park", r"second[- ]highest (alpine )?plateau|highest plateau"),
    ("hingol", "park", "landscape", "Hingol National Park", r"largest national park"),
    ("princess-of-hope", "rock", "landscape", "Princess of Hope", None),
    ("kund-malir", "beach", "landscape", "Kund Malir", None),
    ("khunjerab-pass", "pass", "landscape", "Khunjerab Pass", r"highest paved (international )?border crossing"),
    ("attabad-lake", "lake", "landscape", "Attabad Lake", None),
    ("saiful-muluk", "lake", "landscape", "Lake Saiful Muluk", None),
    ("shandur", "pass", "landscape", "Shandur Pass", r"highest polo ground"),
    ("indus-delta", "delta", "landscape", "Indus River Delta", r"largest[^.]*mangrove|largest[^.]*delta"),
    ("thar", "desert", "landscape", "Thar Desert", None),
    ("cholistan", "desert", "landscape", "Cholistan Desert", None),
    ("khewra", "mine", "landscape", "Khewra Salt Mine", r"(second|2nd)[- ]largest salt mine|oldest salt mine"),
    ("fairy-meadows", "meadow", "landscape", "Fairy Meadows", None),
    ("kalash-valleys", "valley", "landscape", "Kalasha Valleys", None),
    ("astola", "island", "landscape", "Astola Island", r"largest island"),
]
CULTURAL = [
    ("badshahi", "mosque", "monument", "Badshahi Mosque", r"largest mosque[^.]*"),
    ("faisal-mosque", "mosque", "monument", "Faisal Mosque", r"largest mosque[^.]*"),
    ("minar-e-pakistan", "tower", "monument", "Minar-e-Pakistan", None),
    ("wazir-khan", "mosque", "monument", "Wazir Khan Mosque", r"most ornately decorated"),
    ("mazar-e-quaid", "mausoleum", "monument", "Mazar-e-Quaid", None),
    ("shah-jahan-mosque", "mosque", "monument", "Shah Jahan Mosque, Thatta", r"most elaborate"),
    ("derawar", "fort", "monument", "Derawar Fort", None),
    ("ranikot", "fort", "monument", "Ranikot Fort", r"(world's )?largest fort"),
    ("altit", "fort", "monument", "Altit Fort", r"oldest monument"),
    ("baltit", "fort", "monument", "Baltit Fort", None),
    ("hiran-minar", "tower", "monument", "Hiran Minar", None),
    ("katas-raj", "temple", "monument", "Katas Raj Temples", None),
    ("noor-mahal", "palace", "monument", "Noor Mahal", None),
    ("ziarat-residency", "residence", "monument", "Quaid-e-Azam Residency", None),
    ("harappa", "archaeological", "archaeology", "Harappa", None),
    ("mehrgarh", "archaeological", "archaeology", "Mehrgarh", r"earliest[^.]*"),
    ("qa-solar-park", "solar", "modern", "Quaid-e-Azam Solar Park", r"largest[^.]*solar[^.]*"),
]
ALL = NATURAL + CULTURAL

# Region-scale items whose Wikidata point lies outside Pakistan: pin at the Pakistani portion's Wikidata item
# instead (recorded in facts.coord_from).
COORD_FROM = {"Thar Desert": "Tharparkar"}
# Extra facts parsed from the article's own wikitext (infobox / body) when Wikidata lacks them: id -> [(key, regex
# with one numeric group)], plus wikitext superlatives (sentence kept verbatim).
WIKITEXT_FACTS = {"qa-solar-park": [("power_mw_operational", r"ps_electrical_capacity\s*=\s*([\d,]+)\s*MW")]}
WIKITEXT_SUPERLATIVE = {"qa-solar-park": r"largest solar plant in Pakistan"}
# Wikidata inception statements contradicted by the item's own Wikipedia summary are dropped, not shown.
DROP_INCEPTION = {"Ranikot Fort"}  # Wikidata: 450 BCE vs Wikipedia summary "Gupta-era"/later fort

PROPS = {"elevation_m": "P2044", "length_m": "P2043", "area_m2": "P2046", "prominence_m": "P2660",
         "power_w": "P2109"}

WDPCA_POLY = ("https://hub.arcgis.com/api/download/v1/items/8664a0d82205448e942c1189775846be/geojson?layers=1"
              "&where=ISO3+%3D+%27PAK%27&redirect=true&spatialRefId=4326")
WDPCA_PTS_Q = ("https://services5.arcgis.com/Mj0hjvkNtV7NRhA7/arcgis/rest/services/WDPCA_v5/FeatureServer/0/query?"
               + urllib.parse.urlencode({"where": "iso3='PAK' AND desig_eng LIKE 'National Park%'",
                                         "outFields": "site_id,name_eng,desig_eng,iucn_cat,rep_area,status_yr,realm",
                                         "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "4",
                                         "f": "geojson"}))

INFO = {
    "id": ID,
    "title": "Natural & cultural wonders and national parks",
    "publisher": "Wikidata / Wikipedia (curated list); UNEP-WCMC & IUCN Protected Planet (WDPCA)",
    "vintage": "Wikidata/Wikipedia as retrieved 2026-11; WDPCA v5 (HDX unep_wdpca_pak)",
    "url": "https://www.protectedplanet.net/en/country/PAK",
    "files_urls": ["https://query.wikidata.org/sparql", "https://en.wikipedia.org/api/rest_v1/page/summary/",
                   WDPCA_POLY, WDPCA_PTS_Q],
    "license": "Wikidata CC0; Wikipedia text CC BY-SA 4.0; WDPCA (c) UNEP-WCMC & IUCN, non-commercial terms",
    "used_for": ["Wonders layer (natural & cultural)", "Surprise-Me outliers", "National parks list"],
    "caveats": ("PUBLISHED RULE: wonders are a curated, editorial list, not a ranking. Natural: all five "
                "8,000 m peaks in Pakistan-administered territory (K2, Nanga Parbat, Gasherbrum I, Broad Peak, "
                "Gasherbrum II), plus Rakaposhi and Tirich Mir (highest of the Hindu Kush); four major Karakoram "
                "glaciers (Siachen, Baltoro, Biafo, Batura); and 19 signature landscapes (Deosai, Hingol incl. "
                "Princess of Hope & Kund Malir, Khunjerab Pass, Attabad, Saiful Muluk, Shandur, Indus Delta, Thar, "
                "Cholistan, Khewra, Fairy Meadows, Kalash valleys, Astola). Cultural: national symbols and "
                "Mughal/Sikh/colonial/princely monuments (most on UNESCO's Tentative List) plus Harappa and "
                "Mehrgarh, and Quaid-e-Azam Solar Park as a modern outlier. The six UNESCO World Heritage "
                "properties are in the unesco layer, not repeated here. Numeric facts are Wikidata values "
                "(units normalised); null when Wikidata has none. Siachen lies in a disputed area; Thar, Cholistan "
                "and the Indus Delta are extensive regions pinned at one Wikidata point (pcode may be null if that "
                "point is outside Pakistan). National parks: every WDPCA record designated 'National Park' "
                "(polygon or point layer) with reported area; WDPCA areas are as reported by the government "
                "and may differ from GIS areas."),
}


def wikidata(titles):
    vals = " ".join(f'<https://en.wikipedia.org/wiki/{urllib.parse.quote(t.replace(" ", "_"), safe=",;:@$!*()~/")}>'
                    for t in titles)
    opts = "\n".join(f"OPTIONAL {{ ?item p:{p}/psn:{p}/wikibase:quantityAmount ?{k} . }}"
                     for k, p in PROPS.items())
    q = f"""SELECT ?article ?item ?coord ?desc ?inception {' '.join('?' + k for k in PROPS)} WHERE {{
  VALUES ?article {{ {vals} }}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item schema:description ?desc . FILTER(lang(?desc) = "en") }}
  {opts}
}}"""
    res = sparql(ID, "wikidata_wonders.json", q)
    out = {}
    for b in res["results"]["bindings"]:
        t = urllib.parse.unquote(_val(b, "article").rsplit("/wiki/", 1)[-1]).replace("_", " ")
        r = out.setdefault(t, {"qid": _qid(_val(b, "item")), "coord": None, "desc": _val(b, "desc"),
                               "inception": None, **{k: set() for k in PROPS}})
        if r["coord"] is None:
            r["coord"] = parse_point(_val(b, "coord"))
        inc = _val(b, "inception")
        if inc and r["inception"] is None:
            # SPARQL xsd:dateTime uses astronomical numbering (year 0 = 1 BCE); convert to BCE-negative w/o 0
            r["inception"] = int(inc[:inc.index("-", 1)]) - 1 if inc[0] == "-" else int(inc.lstrip("+")[:4])
        for k in PROPS:
            v = _val(b, k)
            if v is not None:
                r[k].add(float(v))
    return out


def _one(vals: set, how: str = "max"):
    """Wikidata may list several statements (e.g. old and new surveys); report the max and keep all."""
    if not vals:
        return None, []
    s = sorted(vals)
    return (s[-1] if how == "max" else s[0]), s


def superlative(extract: str | None, rx: str | None):
    if not (extract and rx):
        return None
    for sent in re.split(r"(?<=[.!?])\s+", extract):
        if re.search(rx, sent, re.I):
            return sent.strip()[:240]
    return None


def parks():
    from shapely.geometry import shape
    out = []
    g = json.loads(fetch(ID, WDPCA_POLY, "wdpca_pak_layer1.geojson").read_text())
    for f in g["features"]:
        p = f["properties"]
        if not str(p.get("desig_eng", "")).startswith("National Park"):
            continue
        rp = shape(f["geometry"]).representative_point()
        out.append({"wdpa_id": p["site_id"], "name": p["name_eng"], "iucn_cat": p.get("iucn_cat"),
                    "status_year": p.get("status_yr"), "reported_area_km2": p.get("rep_area"),
                    "gis_area_km2": round(p["gis_area"], 1) if p.get("gis_area") else None,
                    "lat": round(rp.y, 4), "lon": round(rp.x, 4), "geom": "polygon"})
    g = json.loads(fetch(ID, WDPCA_PTS_Q, "wdpca_pak_np_layer0.geojson").read_text())
    for f in g["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][0]
        out.append({"wdpa_id": p["site_id"], "name": p["name_eng"], "iucn_cat": p.get("iucn_cat"),
                    "status_year": p.get("status_yr"), "reported_area_km2": p.get("rep_area"),
                    "gis_area_km2": None, "lat": round(lat, 4), "lon": round(lon, 4), "geom": "point"})
    for r in out:
        r["pcode"] = pcode_of(r["lat"], r["lon"], 5)
        r["ref"] = f"https://www.protectedplanet.net/{r['wdpa_id']}"
        r["src"] = ID
    out.sort(key=lambda r: -(r["reported_area_km2"] or 0))
    return out


def process():
    titles = [e[3] for e in ALL]
    wd = wikidata(titles + sorted(set(COORD_FROM.values())))
    summ = wp_summaries(ID, titles)
    missing = [t for t in titles if t not in wd]
    if missing:
        print("  unresolved enwiki titles:", missing)
    out = []
    for wid, kind, cat, title, rx in ALL:
        w = wd.get(title)
        if not w:
            continue
        s = summ.get(title, {})
        lat, lon = w["coord"] if w["coord"] else (None, None)
        coord_from = "wikidata"
        if lat is None and s.get("coordinates"):
            lat, lon, coord_from = s["coordinates"]["lat"], s["coordinates"]["lon"], "wikipedia"
        if title in COORD_FROM and wd.get(COORD_FROM[title], {}).get("coord"):
            alt = COORD_FROM[title]
            lat, lon = wd[alt]["coord"]
            coord_from = f"wikidata {wd[alt]['qid']} ({alt})"
        natural = (wid, kind, cat, title, rx) in NATURAL
        facts = {"kind": kind, "category": cat, "group": "natural" if natural else "cultural",
                 "coord_from": coord_from}
        for k, how in (("elevation_m", "max"), ("prominence_m", "max"), ("length_m", "max"),
                       ("area_m2", "max"), ("power_w", "max")):
            v, allv = _one(w[k], how)
            if v is None or (k in ("length_m", "area_m2") and not natural):
                continue  # building footprints/lengths are not meaningful at map scale
            if k == "length_m":
                facts["length_km"] = round(v / 1000, 1)
            elif k == "area_m2":
                facts["area_km2"] = round(v / 1e6, 1)
            elif k == "power_w":
                facts["power_mw"] = round(v / 1e6, 1)
            else:
                facts[k] = round(v)
            if len(allv) > 1:
                facts[k + "_wikidata_values"] = allv
        if w["inception"] is not None and title not in DROP_INCEPTION:
            facts["inception_year"] = w["inception"]  # negative = BCE (no year 0)
            facts["inception_src"] = "Wikidata P571"
        if wid in WIKITEXT_FACTS or wid in WIKITEXT_SUPERLATIVE:
            from pipeline.sources.unesco import wikitext
            wt = wikitext(ID, title)
            for key, frx in WIKITEXT_FACTS.get(wid, []):
                m = re.search(frx, wt)
                if m:
                    facts[key] = float(m.group(1).replace(",", ""))
            m = re.search(r"[^.\n>]*" + WIKITEXT_SUPERLATIVE.get(wid, "$^") + r"[^.\n<]*", wt)
            if m:
                facts["superlative"] = m.group(0).strip()
        sup = facts.get("superlative") or superlative(s.get("extract"), rx)
        if sup:
            facts["superlative"] = sup
        out.append(point(id=wid, name=s.get("title") or title, lat=round(lat, 5) if lat is not None else None,
                         lon=round(lon, 5) if lon is not None else None, blurb=blurb_for(s, w["desc"]),
                         facts=facts, src=ID, ref=wiki_url(title), wikidata=w["qid"], snap_km=5))
    pk = parks()
    write_json(interim(ID), {"info": INFO, "wonders": out, "parks": pk}, compact=False)
    return out, pk


if __name__ == "__main__":
    w, p = process()
    print(len(w), "wonders;", sum(x["lat"] is None for x in w), "without coords;",
          sum(x["pcode"] is None for x in w), "outside COD-AB;", len(p), "national parks")
