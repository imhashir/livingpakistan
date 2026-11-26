"""Civilisation eras of the land that is now Pakistan, for the timeline scrubber, plus ~40 era-defining sites.

Eras: name + start/end year, each year checked (verified()) against the raw wikitext + REST summary of the era's
English Wikipedia reference article(s). Sites: Wikidata P625 coordinates (Wikipedia summary coordinates as a
flagged fallback), year from the site's Wikipedia article text (regex-verified; Wikidata P571/P1619 is recorded
alongside for cross-checking), blurb = first sentence of the Wikipedia summary or the Wikidata description.

Years are integers, negative = BCE (no year 0). Century-only dates ("2nd century CE") are placed at the century's
midpoint for sorting and flagged year_approx with the century kept in year_label.
"""
from __future__ import annotations

import hashlib
import re

from pipeline.common import BBOX, write_json, interim
from pipeline.sources.unesco import (sparql, by_enwiki, wp_summaries, first_sentence, blurb_for, pcode_of,  # noqa: F401
                                     page_text, wikitext, verified, point, wiki_url)

ID = "eras"

INFO = {
    "id": ID,
    "title": "Civilisation eras and era-defining sites of Pakistan",
    "publisher": "Wikipedia (English) and Wikidata contributors",
    "vintage": "Wikipedia/Wikidata as retrieved 2026-11",
    "url": "https://en.wikipedia.org/wiki/History_of_Pakistan",
    "files_urls": ["https://query.wikidata.org/sparql",
                   "https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
                   "https://en.wikipedia.org/w/index.php?action=raw&title={title}"],
    "license": "Wikipedia text CC BY-SA 4.0; Wikidata CC0",
    "used_for": ["timeline scrubber eras", "era site markers (Wonders/Almanac)"],
    "caveats": ("Era boundaries are conventional and overlap (e.g. Mehrgarh runs into the Early Harappan; Mughal "
                "rule's nominal end in 1857 postdates the Sikh/British takeover of Punjab and Sindh). Each era "
                "boundary year was checked against the cited Wikipedia article text; 'Sikh & British' starts with "
                "the Sikh Empire (1799). Archaeological dates are approximate and contested (Mehrgarh's earliest "
                "occupation is given as 7000 BCE or 5250 BCE). A site's year is its founding/construction/"
                "completion/event year as described in facts.year_note; century-only dates are placed at the "
                "century midpoint. Sites with no verifiable year have year null. Coordinates are Wikidata P625 "
                "(one representative point; facts.coord_src says otherwise)."),
}

# --------------------------------------------------------------------------------------------- eras
# (id, name, [ref titles; first = primary], start, start_regexes, end, end_regexes, start_label, end_label)
ERAS = [
    ("mehrgarh", "Mehrgarh Neolithic", ["Mehrgarh"],
     -7000, [r"7000\s*BCE"], -2600, [r"2600(&nbsp;|\s)*BCE"], "c. 7000 BCE", "c. 2600 BCE"),
    ("indus", "Indus Valley (Harappan) Civilisation", ["Indus Valley Civilisation"],
     -3300, [r"3300(&nbsp;|\s)*(\[\[Common Era\|)?BCE"], -1300, [r"1300(&nbsp;|\s)*BCE"], "c. 3300 BCE", "c. 1300 BCE"),
    ("gandhara", "Gandhara (Achaemenid, Mauryan, Indo-Greek, Kushan, Shahi)", ["Gandhara"],
     -600, [r"6th century BCE"], 1001, [r"964\s*–\s*1001", r"Ghaznavid conquest\]\] in 11th century"],
     "6th century BCE", "1001 CE (Ghaznavid conquest)"),
    ("arab", "Arab Sindh and early Islamic", ["Arab conquest of Sindh", "Habbari Emirate"],
     711, [r"711–713"], 1011, [r"854–1011"], "711 CE", "1011 CE"),
    ("sultanate", "Ghaznavids and Delhi Sultanate", ["Ghaznavid Empire", "Delhi Sultanate"],
     977, [r"\(977–1186\)"], 1526, [r"\(1206–1526\)"], "977 CE", "1526 CE"),
    ("mughal", "Mughal Empire", ["Mughal Empire"],
     1526, [r"1526–1857"], 1857, [r"1526–1857"], "1526 CE", "1857 CE"),
    ("raj", "Sikh Empire and British Raj (incl. canal colonies)", ["Sikh Empire", "Punjab Province (British India)"],
     1799, [r"1799–1849"], 1947, [r"\(1921–1947\)"], "1799 CE", "1947 CE"),
    ("modern", "Modern Pakistan", ["Pakistan"],
     1947, [r"established on \[\[Independence Day \(Pakistan\)\|14 August 1947\]\]"], None, [], "1947 CE", None),
]

# --------------------------------------------------------------------------------------------- sites
# (id, enwiki title, era, year, approx, year_label, [regexes that must all be found in the article], year_note)
# year None -> no verifiable year.
SITES = [
    ("mehrgarh", "Mehrgarh", "mehrgarh", -7000, True, "c. 7000 BCE",
     [r"dated from 7000 BCE or 5250 BCE"], "earliest farming village (alternative dating 5250 BCE)"),
    ("mohenjo-daro", "Mohenjo-daro", "indus", -2500, True, "c. 2500 BCE", [r"\{\{circa\|2500 BCE\}\}"], "built"),
    ("harappa", "Harappa", "indus", -3300, True, "c. 3300 BCE", [r"built = \{\{circa\|3300 BC\}\}"], "built"),
    ("kot-diji", "Kot Diji", "indus", -3300, True, "c. 3300 BCE", [r"occupied around 3300 BCE"], "first occupation"),
    ("rehman-dheri", "Rehman Dheri", "indus", -3300, True, "c. 3300 BCE", [r"built = \{\{circa\|3300 BC\}\}"], "built"),
    ("amri", "Amri, Sindh", "indus", -3600, False, "3600 BCE", [r"goes back to 3600 BCE"], "earliest phase"),
    ("chanhudaro", "Chanhudaro", "indus", -4000, True, "c. 4000–1700 BCE",
     [r"inhabited between 4000 and 1700(&nbsp;|\s)BCE"], "first inhabited"),
    ("ganweriwal", "Ganweriwal", "indus", -2500, True, "c. 2500 BCE", [r"built\s*=\s*c\. 2500 BC"], "built"),
    ("bhir-mound", "Bhir Mound", "gandhara", -800, True, "c. 800–525 BCE", [r"built\s*=\s*c\. 800–525 BC"],
     "built (earliest city of Taxila)"),
    ("sirkap", "Sirkap", "gandhara", -180, True, "c. 180 BCE", [r"Demetrius.{0,200}around 180 BC"],
     "built by Demetrius (Indo-Greek)"),
    ("jaulian", "Jaulian", "gandhara", 150, True, "2nd century CE", [r"built\s*=\s*2nd century \[\[Common era\|CE\]\]"],
     "Buddhist monastery built"),
    ("takht-i-bahi", "Takht-i-Bahi", "gandhara", 50, True, "1st century CE",
     [r"monastery was founded in the 1st century CE"], "monastery founded"),
    ("pushkalavati", "Pushkalavati", "gandhara", -520, True, "c. 520 BCE",
     [r"Achaemenid.{0,80}regional settlement around 520 BCE"], "incorporated as an Achaemenid settlement"),
    ("butkara", "Butkara Stupa", "gandhara", -150, True, "2nd century BCE",
     [r"generally dated slightly later to the 2nd century BCE"], "stupa built"),
    ("shahbaz-garhi", "Shahbaz Garhi", "gandhara", -272, True, "c. 272–231 BCE",
     [r"3rd Century BC \(272-231 BC\)", r"Ashoka"], "Ashokan rock edicts carved"),
    ("banbhore", "Banbhore", "arab", 711, False, "711–712 CE",
     [r"Debal\]\], which the Arab general \[\[Muhammad bin Qasim\]\] conquered in 711–712"],
     "Arab conquest of Debal (city dates to the 1st century BCE)"),
    ("multan", "Multan", "arab", 712, False, "712 CE", [r"Muhammad bin Qasim\]\] in 712 CE"],
     "conquered by Muhammad bin Qasim"),
    ("mansura", "Mansura, Sindh", "arab", None, False, None, [], "8th-century capital of caliphal Sindh"),
    ("rukn-e-alam", "Tomb of Shah Rukn-e-Alam", "sultanate", 1324, False, "1320–1324 CE",
     [r"built between 1320 and 1324 CE"], "built by Ghiyath al-Din Tughluq"),
    ("makli", "Makli Necropolis", "sultanate", 1350, True, "14th–18th century CE",
     [r"between the 14th and 18th centuries"], "funerary monuments span the 14th–18th centuries"),
    ("rohtas-fort", "Rohtas Fort", "mughal", 1541, False, "1541 CE", [r"construction of Rohtas Fort started in 1541"],
     "construction started under Sher Shah Suri (Sur interregnum)"),
    ("lahore-fort", "Lahore Fort", "mughal", 1566, False, "1566 CE",
     [r"foundations of the present fort was laid in 1566"], "present fort founded under Akbar"),
    ("hiran-minar", "Hiran Minar", "mughal", 1606, False, "1606 CE", [r"built in 1606 C\.E\."], "minaret built"),
    ("tomb-of-jahangir", "Tomb of Jahangir", "mughal", 1637, False, "1637 CE", [r"mausoleum\]\] dating from 1637"],
     "completed"),
    ("wazir-khan-mosque", "Wazir Khan Mosque", "mughal", 1641, False, "1634–1641 CE",
     [r"began in 1634, and was completed in 1641"], "completed"),
    ("shalamar-gardens", "Shalamar Gardens, Lahore", "mughal", 1642, False, "1641–1642 CE",
     [r"began in 1641", r"completed in 1642"], "completed"),
    ("badshahi-mosque", "Badshahi Mosque", "mughal", 1673, False, "1671–1673 CE",
     [r"constructed between 1671 and 1673"], "completed"),
    ("samadhi-ranjit-singh", "Samadhi of Ranjit Singh", "raj", 1848, False, "1848 CE", [r"complete\s*=\s*1848"],
     "completed (Sikh Empire)"),
    ("frere-hall", "Frere Hall", "raj", 1865, False, "1865 CE", [r"Completed in 1865"], "completed"),
    ("faisalabad", "Faisalabad", "raj", 1890, False, "1890 CE", [r"When founded in 1890, it was named after"],
     "Lyallpur founded (Chenab canal colony)"),
    ("lower-chenab-canal", "Lower Chenab Canal", "raj", 1892, False, "1892 CE", [r"It was dug in 1892"],
     "canal dug; point at Khanki Headworks"),
    ("sargodha", "Sargodha", "raj", 1903, False, "1903 CE", [r"Start date and age\|22 February 1903"],
     "founded (Lower Jhelum canal colony)"),
    ("clock-tower-faisalabad", "Clock Tower, Faisalabad", "raj", 1905, False, "1905 CE",
     [r"foundation of the majestic Clock Tower was laid on 14 November 1905"], "foundation laid"),
    ("sukkur-barrage", "Sukkur Barrage", "raj", 1932, False, "1923–1932 CE", [r"from 1923 to 1932"], "completed"),
    ("kotri-barrage", "Kotri Barrage", "modern", 1955, False, "1955 CE", [r"barrage was completed in 1955"],
     "completed"),
    ("islamabad", "Islamabad", "modern", 1960, False, "1960 CE", [r"Name approved\s*\|\s*established_date1\s*=\s*"
     r"\{\{Start date and age\|1960"], "capital name approved (construction 1961, inaugurated 1967)"),
    ("guddu-barrage", "Guddu Barrage", "modern", 1962, False, "1962 CE", [r"barrage was completed in 1962"],
     "completed"),
    ("mangla-dam", "Mangla Dam", "modern", 1967, False, "1967 CE", [r"opening = 1967"], "opened"),
    ("minar-e-pakistan", "Minar-e-Pakistan", "modern", 1968, False, "1960–1968 CE", [r"built during 1960–1968"],
     "completed"),
    ("tarbela-dam", "Tarbela Dam", "modern", 1976, False, "1976 CE", [r"dam was completed in 1976"], "completed"),
    ("faisal-mosque", "Faisal Mosque", "modern", 1986, False, "1986 CE", [r"established\s*=\s*1986"], "established"),
    ("gwadar-port", "Gwadar Port", "modern", 2007, False, "2007 CE",
     [r"until 2007, when the port was inaugurated"], "inaugurated (CPEC-era operations from 2016)"),
]

SNAP_KM = {"gwadar-port": 3}


def _wd_by_qid(qids: list[str]) -> dict:
    """Coordinates / description / inception for QIDs (fallback for enwiki titles with commas, which by_enwiki's
    percent-encoded sitelink URIs do not match)."""
    if not qids:
        return {}
    q = f"""SELECT ?item ?coord ?desc ?inception ?opening WHERE {{
  VALUES ?item {{ {' '.join('wd:' + x for x in qids)} }}
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item schema:description ?desc . FILTER(lang(?desc) = "en") }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item wdt:P1619 ?opening . }}
}}"""
    tag = hashlib.sha1(" ".join(sorted(qids)).encode()).hexdigest()[:8]
    res = sparql(ID, f"wikidata_by_qid_{tag}.json", q)
    out = {}
    for b in res["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        r = out.setdefault(qid, {"qid": qid, "lat": None, "lon": None, "desc": None})
        if "coord" in b and r["lat"] is None:
            m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", b["coord"]["value"])
            if m:
                r["lat"], r["lon"] = round(float(m.group(2)), 5), round(float(m.group(1)), 5)
        if "desc" in b:
            r["desc"] = b["desc"]["value"]
        for k in ("inception", "opening"):
            if k in b:
                r.setdefault(k, b[k]["value"])
    return out


def _ref_text(title: str, summaries: dict) -> str:
    return wikitext(ID, title) + "\n" + ((summaries.get(title) or {}).get("extract") or "")


def _wd_year(v: str | None) -> int | None:
    """Wikidata RDF dateTime -> CE year (only CE years are used; BCE values in the RDF use astronomical numbering)."""
    if not v:
        return None
    m = re.match(r"(-?)(\d+)-", v)
    y = int(m.group(2)) * (-1 if m.group(1) else 1)
    return y if y > 0 else None


def build_eras(summaries: dict) -> list[dict]:
    out = []
    for eid, name, refs, start, s_re, end, e_re, s_lab, e_lab in ERAS:
        text = "\n".join(_ref_text(t, summaries) for t in refs)
        print(f"era {eid}")
        s = verified(text, start, *s_re)
        e = verified(text, end, *e_re) if end is not None else None
        prim = summaries.get(refs[0]) or {}
        out.append({"id": eid, "name": name, "start_year": s, "end_year": e,
                    "start_label": s_lab if s is not None else None, "end_label": e_lab if e is not None else None,
                    "blurb": first_sentence(prim.get("extract")) or (prim.get("description") or None),
                    "ref": wiki_url(refs[0]), "refs": [wiki_url(t) for t in refs]})
    return out


def build_sites(summaries: dict) -> list[dict]:
    titles = [s[1] for s in SITES]
    tag = hashlib.sha1("|".join(sorted(titles)).encode()).hexdigest()[:8]
    wd = by_enwiki(ID, f"wikidata_sites_{tag}.json", titles, {"inception": "P571", "opening": "P1619"})
    missing = [t for t in titles if t not in wd]
    byq = _wd_by_qid([summaries[t]["wikibase_item"] for t in missing if (summaries.get(t) or {}).get("wikibase_item")])
    for t in missing:
        q = (summaries.get(t) or {}).get("wikibase_item")
        if q in byq:
            wd[t] = byq[q]
    unresolved = [t for t in titles if t not in wd]
    if unresolved:
        print("UNRESOLVED titles:", unresolved)
    eras = {e[0] for e in ERAS}
    out = []
    for sid, title, era, year, approx, label, regs, note in SITES:
        assert era in eras, era
        w = wd.get(title, {})
        sm = summaries.get(title) or {}
        text = _ref_text(title, summaries)
        print(f"site {sid}")
        y = verified(text, year, *regs) if year is not None else None
        lat, lon, csrc = w.get("lat"), w.get("lon"), "wikidata" if w.get("lat") is not None else None
        if lat is None and sm.get("coordinates"):
            lat, lon, csrc = round(sm["coordinates"]["lat"], 5), round(sm["coordinates"]["lon"], 5), "wikipedia"
        wd_y = _wd_year(w.get("opening")) or _wd_year(w.get("inception"))
        if y is not None and wd_y is not None and abs(wd_y - y) > 10:
            print(f"  note: {sid} wikidata year {wd_y} vs text {y}")
        out.append(point(
            id=sid, name=sm.get("title") or title, lat=lat, lon=lon,
            blurb=blurb_for(sm, w.get("desc")), src=ID, ref=wiki_url(title), wikidata=w.get("qid"),
            snap_km=SNAP_KM.get(sid, 0.0), era=era, year=y, year_approx=bool(approx) if y is not None else False,
            year_label=label if y is not None else None,
            facts={"year_note": note, "coord_src": csrc, "wikidata_year": wd_y}))
    return out


def process():
    titles = sorted({t for e in ERAS for t in e[2]} | {s[1] for s in SITES})
    summaries = wp_summaries(ID, titles)
    bad = [t for t in titles if "error" in (summaries.get(t) or {"error": 1})]
    if bad:
        print("UNRESOLVED Wikipedia summaries:", bad)
    eras = build_eras(summaries)
    sites = build_sites(summaries)
    w, s, e, n = BBOX
    for x in sites:
        if x["lat"] is not None and not (s <= x["lat"] <= n and w <= x["lon"] <= e):
            print(f"  outside bbox -> coords nulled: {x['id']} {x['lat']},{x['lon']}")
            x["lat"] = x["lon"] = x["pcode"] = None
    sites.sort(key=lambda x: (x["year"] is None, x["year"] if x["year"] is not None else 0, x["id"]))
    write_json(interim(ID), {"info": INFO, "eras": eras, "sites": sites}, compact=False)
    return eras, sites


if __name__ == "__main__":
    eras, sites = process()
    print(len(eras), "eras;", len(sites), "sites")
    for e in eras:
        print(f"  {e['id']:10s} {e['start_year']} .. {e['end_year']}")
    print("sites without year:", [x["id"] for x in sites if x["year"] is None])
    print("sites without coords:", [x["id"] for x in sites if x["lat"] is None])
    print("sites without pcode:", [x["id"] for x in sites if x["pcode"] is None])
    print("sites without blurb:", [x["id"] for x in sites if not x["blurb"]])
