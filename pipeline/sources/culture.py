"""Cultural heritage pins: Sufi shrines, craft hubs and Test-cricket stadiums.

Coordinates: Wikidata P625 of the shrine/stadium item; when the article is about a saint (no shrine item), the
point of the shrine's town item is used and flagged in facts.coord_from. Craft pins sit at the craft town's Wikidata
point and are kept ONLY if the craft keyword is found in the plain text of the cited Wikipedia article (the matching
sentence is stored as facts.evidence). Stadium capacity: Wikipedia infobox, Wikidata P1083 kept alongside.
"""
from __future__ import annotations

import json
import re
import urllib.parse

from pipeline.common import fetch, write_json, interim
from pipeline.sources.unesco import sparql, _val, _qid, parse_point, point, wp_summaries, blurb_for, wiki_url

ID = "culture"

# id, article (facts/blurb/ref), coordinate items in order of preference (first with a Wikidata point wins)
SHRINES = [
    ("data-darbar", "Data Darbar", ["Data Darbar"]),
    ("lal-shahbaz", "Shrine of Lal Shahbaz Qalandar", ["Shrine of Lal Shahbaz Qalandar", "Sehwan"]),
    ("bhittai", "Shrine of Shah Abdul Latif Bhittai", ["Shrine of Shah Abdul Latif Bhittai"]),
    ("rukn-e-alam", "Tomb of Shah Rukn-e-Alam", ["Tomb of Shah Rukn-e-Alam"]),
    ("bahauddin-zakariya", "Shrine of Bahauddin Zakariya", ["Shrine of Bahauddin Zakariya"]),
    ("baba-farid", "Shrine of Baba Farid", ["Shrine of Baba Farid", "Pakpattan"]),
    ("bari-imam", "Bari Imam", ["Bari Imam", "Islamabad"]),
    ("abdullah-shah-ghazi", "Abdullah Shah Ghazi", ["Abdullah Shah Ghazi", "Clifton, Karachi"]),
    ("sachal-sarmast", "Sachal Sarmast", ["Sachal Sarmast", "Daraza"]),
    ("rahman-baba", "Rahman Baba", ["Rahman Baba", "Peshawar"]),
]
# id, label, ref article (verified text), keyword regex, coordinate item
CRAFTS = [
    ("multan-blue-pottery", "Multan blue pottery & kashi tile work", "Qashani", r"Multan", "Multan"),
    ("ajrak-hala", "Ajrak block printing (Hala)", "Ajrak", r"\bHala\b", "Hala, Sindh"),
    ("ajrak-bhit-shah", "Ajrak block printing (Bhit Shah)", "Ajrak", r"Bhit Shah", "Shrine of Shah Abdul Latif Bhittai"),
    ("hala-crafts", "Hala crafts", "Hala, Sindh", r"handicraft|crafts|pottery|tiles|ajrak", "Hala, Sindh"),
    ("sialkot-footballs", "Sialkot footballs", "Sialkot", r"football", "Sialkot"),
    ("sialkot-surgical", "Sialkot surgical instruments", "Sialkot", r"surgical", "Sialkot"),
    ("chiniot-woodwork", "Chiniot woodwork & furniture", "Chiniot", r"furniture|wood ?work|wood[- ]carv", "Chiniot"),
    ("qissa-khwani", "Qissa Khwani Bazaar, Peshawar", "Qissa Khwani Bazaar", r"bazaar", "Qissa Khwani Bazaar"),
    ("truck-art-rawalpindi", "Truck art (Rawalpindi)", "Truck art in South Asia", r"Rawalpindi", "Rawalpindi"),
    ("truck-art-karachi", "Truck art (Karachi)", "Truck art in South Asia", r"Karachi", "Karachi"),
    ("kasur-leather", "Kasur leather & textiles", "Kasur", r"leather|tanner", "Kasur"),
    ("gujrat-fans-ceramics", "Gujrat fans & ceramics", "Gujrat, Pakistan", r"fans?\b|ceramic|pottery", "Gujrat, Pakistan"),
    ("wazirabad-cutlery", "Wazirabad cutlery", "Wazirabad", r"cutlery", "Wazirabad"),
    ("hyderabad-bangles", "Hyderabad bangles", "Hyderabad, Pakistan", r"bangle", "Hyderabad, Pakistan"),
]
STADIUMS = [
    ("gaddafi", "Gaddafi Stadium"), ("national-karachi", "National Stadium, Karachi"),
    ("pindi", "Rawalpindi Cricket Stadium"), ("multan-cs", "Multan Cricket Stadium"),
    ("arbab-niaz", "Imran Khan Cricket Stadium"),  # formerly Arbab Niaz Stadium (enwiki redirect)
    ("bugti", "Bugti Stadium"), ("iqbal", "Iqbal Stadium"),
]

INFO = {
    "id": ID,
    "title": "Cultural mosaic: Sufi shrines, craft hubs and cricket grounds",
    "publisher": "Wikidata / Wikipedia (curated list)",
    "vintage": "Wikidata/Wikipedia as retrieved 2026-11",
    "url": "https://www.wikidata.org/",
    "files_urls": ["https://query.wikidata.org/sparql", "https://en.wikipedia.org/w/api.php (extracts)",
                   "https://en.wikipedia.org/api/rest_v1/page/summary/"],
    "license": "Wikidata CC0; Wikipedia text CC BY-SA 4.0",
    "used_for": ["Culture lens pins (shrine / craft / cricket)", "City View badges"],
    "caveats": ("Curated list from the PakCiv brief, not a ranking. Shrine points are the shrine's Wikidata item "
                "where one exists, otherwise the town of the shrine (facts.coord_from) and so are approximate. "
                "Craft pins mark the hub town, not a workshop, and are included only when the cited Wikipedia "
                "article mentions the craft (facts.evidence holds the sentence); unverified crafts are dropped. "
                "Stadium capacity is the current English Wikipedia infobox value (Wikidata P1083 kept alongside; the "
                "two can disagree after renovations). Arbab Niaz Stadium appears under its current enwiki title, Imran Khan Cricket Stadium."),
}


def wikidata(titles):
    vals = " ".join(f'<https://en.wikipedia.org/wiki/{urllib.parse.quote(t.replace(" ", "_"), safe=",;:@$!*()~/")}>'
                    for t in titles)
    q = f"""SELECT ?article ?item ?coord ?desc ?capacity ?inception WHERE {{
  VALUES ?article {{ {vals} }}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P1083 ?capacity . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item schema:description ?desc . FILTER(lang(?desc) = "en") }}
}}"""
    out = {}
    for b in sparql(ID, "wikidata_culture.json", q)["results"]["bindings"]:
        t = urllib.parse.unquote(_val(b, "article").rsplit("/wiki/", 1)[-1]).replace("_", " ")
        r = out.setdefault(t, {"qid": _qid(_val(b, "item")), "coord": None, "desc": _val(b, "desc"),
                               "capacity": set(), "inception": None})
        if r["coord"] is None:
            r["coord"] = parse_point(_val(b, "coord"))
        if _val(b, "capacity"):
            r["capacity"].add(int(float(_val(b, "capacity"))))
        inc = _val(b, "inception")
        if inc and r["inception"] is None and inc[0] != "-":
            r["inception"] = int(inc.lstrip("+")[:4])
    return out


def plaintext(title: str) -> str:
    u = ("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json"
         "&titles=" + urllib.parse.quote(title))
    name = "wp_text_" + re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_") + ".json"
    d = json.loads(fetch(ID, u, name).read_text())
    return " ".join(p.get("extract", "") for p in d["query"]["pages"].values())


def infobox_capacity(title: str):
    """Seating capacity from the enwiki infobox (first '| capacity = 27,000' style value), else None."""
    from pipeline.sources.unesco import wikitext
    m = re.search(r"\|\s*(?:seating_)?capacity\s*=\s*([\d][\d,]*)", wikitext(ID, title))
    return int(m.group(1).replace(",", "")) if m else None


def evidence(text: str, rx: str):
    for sent in re.split(r"(?<=[.!?])\s+", text):
        if re.search(rx, sent, re.I) and len(sent) < 400:
            return re.sub(r"\s+", " ", re.sub(r"==+[^=]+==+", " ", sent)).strip()
    return None


def _coord(wd, items):
    for t in items:
        w = wd.get(t)
        if w and w["coord"]:
            return w["coord"], ("wikidata" if t == items[0] else f"wikidata {w['qid']} ({t})")
    return None, None


def process():
    titles = sorted({t for _, a, c in SHRINES for t in [a, *c]} | {c[2] for c in CRAFTS} | {c[4] for c in CRAFTS}
                    | {s[1] for s in STADIUMS})
    wd = wikidata(titles)
    summ = wp_summaries(ID, titles)
    print("  unresolved:", [t for t in titles if t not in wd])
    out = []
    for sid, art, items in SHRINES:
        c, how = _coord(wd, items)
        if not c:
            print("  no coords, skipped:", art)
            continue
        w = wd.get(art, {})
        out.append(point(id=sid, name=summ.get(art, {}).get("title") or art, lat=round(c[0], 5), lon=round(c[1], 5),
                         blurb=blurb_for(summ.get(art), w.get("desc")), facts={"coord_from": how},
                         src=ID, ref=wiki_url(art), wikidata=w.get("qid"), category="shrine"))
    for cid, label, art, rx, at in CRAFTS:
        ev = evidence(plaintext(art), rx)
        c, _ = _coord(wd, [at])
        if not ev or not c:
            print("  craft not verified / no coords, skipped:", cid)
            continue
        blurb = ev if len(ev) <= 160 else None
        out.append(point(id=cid, name=label, lat=round(c[0], 5), lon=round(c[1], 5),
                         blurb=blurb or f"{label}: craft hub cited in the Wikipedia article '{art}'.",
                         facts={"evidence": ev, "coord_from": f"wikidata {wd[at]['qid']} ({at})"},
                         src=ID, ref=wiki_url(art), wikidata=wd.get(art, {}).get("qid"), category="craft"))
    for sid, art in STADIUMS:
        w = wd.get(art)
        if not w or not w["coord"]:
            print("  stadium unresolved / no coords, skipped:", art)
            continue
        caps = sorted(w["capacity"])
        ib = infobox_capacity(art)
        out.append(point(id=sid, name=summ.get(art, {}).get("title") or art, lat=round(w["coord"][0], 5),
                         lon=round(w["coord"][1], 5), blurb=blurb_for(summ.get(art), w.get("desc")),
                         facts={"capacity": ib if ib else (caps[-1] if caps else None),
                                "capacity_src": "Wikipedia infobox" if ib else ("Wikidata P1083" if caps else None),
                                "capacity_wikidata": caps or None, "opened": w["inception"]},
                         src=ID, ref=wiki_url(art), wikidata=w["qid"], category="cricket"))
    write_json(interim(ID), {"info": INFO, "pins": out}, compact=False)
    return out


if __name__ == "__main__":
    from collections import Counter
    p = process()
    print(len(p), "pins", dict(Counter(x["category"] for x in p)))
