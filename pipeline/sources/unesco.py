"""UNESCO World Heritage: Pakistan's inscribed properties + Tentative List.

Primary source: the UNESCO WHC machine-readable list (https://whc.unesco.org/en/list/xml/) for inscribed sites
(name, year, category, criteria, coordinates) and the Pakistan Tentative List page for tentative sites.
Wikidata (P757 World Heritage Site ID / P1435 heritage designation) supplies QIDs and fallback coordinates.

This module also hosts the small shared helpers (Wikidata SPARQL, Wikipedia summaries, point-in-polygon to COD-AB
districts, reference-text verification) used by the other heritage/hazard source modules.
"""
from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from functools import lru_cache

from pipeline.common import RAW, UA, fetch, raw_dir, record, write_json, interim

ID = "unesco"
WHC_XML = "https://whc.unesco.org/en/list/xml/"
WHC_PK = "https://whc.unesco.org/en/statesparties/pk"
WHC_TENTATIVE = "https://whc.unesco.org/en/tentativelists/?action=listtentative&state=pk&order=states"

INFO = {
    "id": ID,
    "title": "UNESCO World Heritage Sites and Tentative List: Pakistan",
    "publisher": "UNESCO World Heritage Centre",
    "vintage": "WHC list as retrieved 2026-11",
    "url": WHC_PK,
    "files_urls": [WHC_XML, WHC_TENTATIVE, "https://query.wikidata.org/sparql"],
    "license": "UNESCO WHC data (c) UNESCO, reuse with attribution; Wikidata CC0",
    "used_for": ["Wonders layer: World Heritage badges", "Almanac heritage entries"],
    "caveats": ("Inscribed sites and criteria come from the WHC XML list. Tentative-list entries carry the year of "
                "submission, not inscription; their coordinates come from the WHC tentative-list page or Wikidata "
                "and may be null when neither gives a point. Serial properties are pinned at one representative "
                "point."),
}

# ============================================================================================ shared helpers

WD_SPARQL = "https://query.wikidata.org/sparql"


def sparql(source_id: str, name: str, query: str) -> dict:
    """Run a Wikidata SPARQL query once; raw JSON cached in data/raw/<source_id>/<name> with provenance."""
    out = raw_dir(source_id) / name
    if out.exists() and out.stat().st_size > 0:
        return json.loads(out.read_text())
    url = WD_SPARQL + "?format=json&query=" + urllib.parse.quote(query)
    req = urllib.request.Request(WD_SPARQL, data=urllib.parse.urlencode({"query": query, "format": "json"}).encode(),
                                 headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    out.write_bytes(data)
    record(source_id, name, url)
    return json.loads(data)


def _val(b, k):
    v = b.get(k)
    return v["value"] if v else None


def _qid(uri):
    return uri.rsplit("/", 1)[-1] if uri else None


def parse_point(wkt):
    """'Point(lon lat)' -> (lat, lon)."""
    if not wkt:
        return None
    m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", wkt)
    return (float(m.group(2)), float(m.group(1))) if m else None


def by_enwiki(source_id: str, name: str, titles: list[str], props: dict[str, str] | None = None) -> dict:
    """Resolve English Wikipedia titles to Wikidata items with coords (P625), description and optional numeric
    properties {key: 'P2044'}. Returns {title: {qid, lat, lon, desc, <key>: value|None}}. Multiple values of a
    property -> the max (e.g. elevation) is NOT assumed; the first returned is kept and all are listed in <key>_all."""
    props = props or {}
    vals = " ".join(f'<https://en.wikipedia.org/wiki/{urllib.parse.quote(t.replace(" ", "_"), safe=",;:@$!*()~/")}>'
                    for t in titles)
    opt = "\n".join(f"OPTIONAL {{ ?item wdt:{p} ?{k} . }}" for k, p in props.items())
    q = f"""SELECT ?article ?item ?coord ?desc {' '.join('?' + k for k in props)} WHERE {{
  VALUES ?article {{ {vals} }}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item schema:description ?desc . FILTER(lang(?desc) = "en") }}
  {opt}
}}"""
    res = sparql(source_id, name, q)
    out: dict = {}
    for b in res["results"]["bindings"]:
        t = urllib.parse.unquote(_val(b, "article").rsplit("/wiki/", 1)[-1]).replace("_", " ")
        r = out.setdefault(t, {"qid": _qid(_val(b, "item")), "lat": None, "lon": None, "desc": _val(b, "desc")})
        pt = parse_point(_val(b, "coord"))
        if pt and r["lat"] is None:
            r["lat"], r["lon"] = round(pt[0], 5), round(pt[1], 5)
        for k in props:
            v = _val(b, k)
            if v is None:
                continue
            lst = r.setdefault(k + "_all", [])
            if v not in lst:
                lst.append(v)
            r.setdefault(k, v)
    # resolve title normalisation (Wikidata returns canonical titles; we query with canonical ones)
    return out


def wiki_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="(),'")


def wp_summaries(source_id: str, titles: list[str], name: str = "wikipedia_summaries.json") -> dict:
    """Fetch Wikipedia REST summaries (cached together in one raw file). Returns {title: summary-json}."""
    out = raw_dir(source_id) / name
    have = json.loads(out.read_text()) if out.exists() else {}
    changed = False
    for t in titles:
        if t in have:
            continue
        u = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(t.replace(" ", "_"), safe="")
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
            have[t] = {k: j.get(k) for k in ("title", "description", "extract", "coordinates", "wikibase_item")}
        except Exception as e:  # pragma: no cover - network
            have[t] = {"error": str(e)}
        changed = True
    if changed:
        out.write_text(json.dumps(have, ensure_ascii=False, indent=0))
        record(source_id, name, "https://en.wikipedia.org/api/rest_v1/page/summary/{title}")
    return have


def first_sentence(text: str | None, limit: int = 160) -> str | None:
    """First sentence of a Wikipedia extract, with parentheticals (pronunciations, native names) removed;
    None when it does not fit in `limit` characters."""
    if not text:
        return None
    t = text
    for _ in range(3):
        t = re.sub(r"\s*\([^()]*\)", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;])", r"\1", t)
    m = re.match(r"(.+?[a-z0-9\)\]\"'][.!?])(\s+[A-Z]|$)", t)
    s = m.group(1) if m else t
    return s if len(s) <= limit else None


def blurb_for(summary: dict | None, desc: str | None, fallback: str | None = None, limit: int = 160) -> str | None:
    s = first_sentence((summary or {}).get("extract"), limit)
    if s:
        return s
    if fallback:
        return fallback[:limit]
    if desc:
        d = desc[0].upper() + desc[1:]
        return (d if d.endswith(".") else d + ".")[:limit]
    return None


@lru_cache(maxsize=1)
def _districts():
    from shapely.geometry import shape
    from shapely.strtree import STRtree
    gj = json.loads((RAW / "cod_ab" / "x" / "pak_admin2.geojson").read_text())
    geoms = [shape(f["geometry"]) for f in gj["features"]]
    codes = [f["properties"]["adm2_pcode"] for f in gj["features"]]
    return STRtree(geoms), geoms, codes


def pcode_of(lat, lon, snap_km: float = 0.0):
    """COD-AB district P-code containing (lat, lon); optional snap to the nearest district within snap_km
    (for coastal points such as islands or offshore coordinates). None outside Pakistan."""
    if lat is None or lon is None:
        return None
    from shapely.geometry import Point
    tree, geoms, codes = _districts()
    p = Point(lon, lat)
    for i in tree.query(p):
        if geoms[i].covers(p):
            return codes[i]
    if snap_km > 0:
        i = tree.nearest(p)
        if geoms[i].distance(p) * 111.0 <= snap_km:
            return codes[i]
    return None


def page_text(source_id: str, url: str, name: str) -> str:
    """Fetch a reference page (cached + provenance) and return plain text (HTML stripped / PDF text)."""
    p = fetch(source_id, url, name)
    raw = p.read_bytes()
    if raw[:4] == b"%PDF":
        import subprocess
        return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True).stdout
    t = raw.decode("utf-8", "replace")
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t)


def wikitext(source_id: str, title: str) -> str:
    """Raw wikitext of an English Wikipedia article (cached + provenance)."""
    u = ("https://en.wikipedia.org/w/index.php?action=raw&title="
         + urllib.parse.quote(title.replace(" ", "_"), safe=""))
    name = "wp_" + re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_") + ".wikitext"
    return fetch(source_id, u, name).read_text(errors="replace")


def verified(text: str, value, *needles: str):
    """Return value only if every needle (regex) is found in the reference text; else None (and warn)."""
    for n in needles:
        if not re.search(n, text, flags=re.I | re.S):
            print(f"  [unverified] {n!r} not found in reference -> null")
            return None
    return value


def point(*, id, name, lat, lon, blurb, facts, src, ref, wikidata=None, snap_km=0.0, **extra):
    rec = {"id": id, "name": name, "lat": lat, "lon": lon, "pcode": pcode_of(lat, lon, snap_km),
           "blurb": (blurb[:160] if blurb else None), "facts": facts, "src": src, "ref": ref,
           "wikidata": wikidata}
    rec.update(extra)
    return rec


# ============================================================================================ UNESCO


def _text(el, tag):
    x = el.find(tag)
    return (x.text or "").strip() if x is not None and x.text else None


def inscribed():
    p = fetch(ID, WHC_XML, "whc-sites.xml")
    root = ET.parse(p).getroot()
    out = []
    for row in root.iter("row"):
        if "pk" not in (_text(row, "iso_code") or "").split(","):
            continue
        r = {k: _text(row, k) for k in ("id_number", "site", "date_inscribed", "category", "criteria_txt",
                                        "short_description", "http_url", "danger", "secondary_dates", "iso_code",
                                        "states")}
        pois = [(_text(q, "latitude"), _text(q, "longitude")) for q in row.iter("poi")]
        r["latitude"], r["longitude"] = pois[0] if pois else (None, None)  # first component = representative
        r["n_components"] = len(pois)
        out.append(r)
    return out


def _strip(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def tentative():
    """Parse the Pakistan Tentative List page: entries are links /en/tentativelists/<id>/ with a title; each detail
    page carries the submission date, category and (often) coordinates."""
    p = fetch(ID, WHC_TENTATIVE, "tentative_pk.html")
    t = p.read_text(errors="replace")
    items = {}
    for m in re.finditer(r'href="/en/tentativelists/(\d+)/?"[^>]*>(.*?)<span[^>]*Submission date">([\d/]+)</span>',
                         t, re.S):
        tid, title = m.group(1), _strip(m.group(2))
        if title and tid not in items:
            items[tid] = (title, m.group(3))
    out = []
    for tid, (title, subdate) in items.items():
        d = fetch(ID, f"https://whc.unesco.org/en/tentativelists/{tid}/", f"tentative_{tid}.html").read_text(errors="replace")
        txt = _strip(d)
        sub = re.match(r"(\d{2}/\d{2}/(\d{4}))", subdate)
        cat = re.search(r"Category\s*:?\s*(Cultural|Natural|Mixed)", txt)
        crit = re.search(r"Criteria\s*:?\s*((?:\(\s*[ivx]+\s*\)\s*)+)", txt)
        lat, lon = _dms(txt)
        out.append({"tid": tid, "name": title, "submitted": sub.group(1) if sub else None,
                    "year": int(sub.group(2)) if sub else None, "category": cat.group(1) if cat else None,
                    "criteria": re.sub(r"\s+", "", crit.group(1)) if crit else None, "lat": lat, "lon": lon,
                    "url": f"https://whc.unesco.org/en/tentativelists/{tid}/"})
    return out


def _dms(txt):
    """First coordinate pair on a WHC tentative page, e.g. "29° 12’ 45” N 67° 40’ 15” E" or "N29 12 45 E67 40 15"."""
    i = txt.find("Coordinates")
    seg = txt[i:i + 400] if i >= 0 else ""
    num = r"(\d{1,3})\s*[°º]?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['’′]?\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*[\"”″'’]{0,2}\s*)?"
    m = re.search(num + r"N[\s,;-]*" + num + r"E", seg)
    if m:
        g = m.groups()
    else:
        m = re.search(r"N\s*" + num + r"[\s,;-]*E\s*" + num, seg)
        if not m:
            return None, None
        g = m.groups()
    f = [float(x.replace(",", ".")) if x else 0.0 for x in g]
    lat = f[0] + f[1] / 60 + f[2] / 3600
    lon = f[3] + f[4] / 60 + f[5] / 3600
    if not (23 <= lat <= 37.5 and 60 <= lon <= 78):
        return None, None
    return round(lat, 5), round(lon, 5)


def wikidata_whs():
    q = """SELECT ?item ?itemLabel ?whs ?coord WHERE {
  ?item wdt:P757 ?whs ; wdt:P17 wd:Q843 .
  OPTIONAL { ?item wdt:P625 ?coord . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}"""
    res = sparql(ID, "wikidata_whs_pk.json", q)
    out = {}
    for b in res["results"]["bindings"]:
        whs = _val(b, "whs")
        out.setdefault(whs.split("-")[0], {"qid": _qid(_val(b, "item")), "label": _val(b, "itemLabel"),
                                           "coord": parse_point(_val(b, "coord"))})
    return out


def _first_sentence_plain(s, limit=160):
    s = _strip(s)
    m = re.match(r"(.+?[.!?])(\s|$)", s)
    s = m.group(1) if m else s
    return s if len(s) <= limit else None


# Tentative-list id -> English Wikipedia article, used only to attach a Wikidata QID and, when the WHC page gives
# no coordinates, the Wikidata P625 point (flagged facts.coord_src = "wikidata").
TENTATIVE_ENWIKI = {
    "1876": "Mehrgarh", "1877": "Rehman Dheri", "1878": "Harappa", "1879": "Ranigat", "1880": "Shahbaz Garhi",
    "1881": "Mansehra Rock Edicts", "1882": "Baltit Fort", "1884": "Tomb of Shah Rukn-e-Alam",
    "1885": "Banbhore", "1277": "Badshahi Mosque", "1278": "Wazir Khan Mosque", "1279": "Tomb of Jahangir",
    "1281": "Hiran Minar", "1284": "Ranikot Fort", "1286": "Shah Jahan Mosque", "1287": "Chaukhandi tombs",
    "6108": "Derawar Fort", "6109": "Hingol National Park", "6111": "Nagarparkar", "6112":
    "Central Karakoram National Park", "6115": "Deosai National Park", "6116": "Ziarat",
    "6118": "Khewra Salt Mine", "6965": "Kalash Valleys", "6968": "Kot Diji", "6970": "Umarkot Fort",
    "7035": "Gor Khatri", "7036": "Sethi House", "7037": "Bhamala Stupa", "7025": "Rawat Fort",
}


def process():
    wd = wikidata_whs()
    en = by_enwiki(ID, "wikidata_tentative_enwiki.json", sorted(set(TENTATIVE_ENWIKI.values())))
    sites = []
    for r in inscribed():
        idn = r["id_number"]
        lat = round(float(r["latitude"]), 5) if r["latitude"] else None
        lon = round(float(r["longitude"]), 5) if r["longitude"] else None
        w = wd.get(idn, {})
        crit = r["criteria_txt"]
        sites.append(point(
            id=f"whs-{idn}", name=_strip(r["site"]), lat=lat, lon=lon,
            blurb=_first_sentence_plain(r["short_description"]) or
            f"UNESCO {r['category']} World Heritage Site inscribed in {r['date_inscribed']} under criteria {crit}.",
            facts={"status": "inscribed", "components": r["n_components"], "year_inscribed": int(r["date_inscribed"]) if r["date_inscribed"] else None,
                   "category": r["category"], "criteria": crit, "whc_id": int(idn),
                   "in_danger": r.get("danger") not in (None, "", "0")},
            src=ID, ref=f"https://whc.unesco.org/en/list/{idn}", wikidata=w.get("qid")))
    for t in tentative():
        lat, lon = t["lat"], t["lon"]
        w = en.get(TENTATIVE_ENWIKI.get(t["tid"], ""), {})
        coord_src = "whc" if lat is not None else None
        if lat is None and w.get("lat") is not None:
            lat, lon, coord_src = w["lat"], w["lon"], "wikidata"
        # 'Ziarat' is the town article: only its QID-free coordinate fallback would be misleading, so skip it.
        if TENTATIVE_ENWIKI.get(t["tid"]) == "Ziarat":
            w = {}
        sites.append(point(
            id=f"tent-{t['tid']}", name=t["name"], lat=lat, lon=lon,
            blurb=f"On Pakistan's UNESCO World Heritage Tentative List (submitted {t['year']})." if t["year"]
            else "On Pakistan's UNESCO World Heritage Tentative List.",
            facts={"status": "tentative", "year_submitted": t["year"], "category": t["category"],
                   "criteria": t["criteria"], "whc_tentative_id": int(t["tid"]), "coord_src": coord_src},
            src=ID, ref=t["url"], wikidata=w.get("qid"), snap_km=3))
    sites.sort(key=lambda s: (s["facts"]["status"] != "inscribed", s["name"]))
    write_json(interim(ID), {"info": INFO, "sites": sites}, compact=False)
    return sites


if __name__ == "__main__":
    s = process()
    print(len(s), "sites;", sum(x["facts"]["status"] == "inscribed" for x in s), "inscribed;",
          sum(x["lat"] is None for x in s), "without coords")
