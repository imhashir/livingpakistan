"""Major urban agglomerations of Pakistan (incl. AJK and Gilgit-Baltistan): point locations, Census 2023 population,
COD-AB district(s).

Inputs
* Coordinates: Wikidata P625 from Special:EntityData/<QID>.json (one cached file per city). Each QID was found via
  wbsearchentities and is checked at run time: P17 = Pakistan (Q843) and P31 includes a settlement class.
* Population: PBS Census 2023 "TABLE 2: URBAN LOCALITIES BY POPULATION SIZE ..." (national edition), which lists every
  urban locality (Metropolitan/Municipal Corporation, MC, Town Committee, Cantonment), split by tehsil where a
  corporation spans several. A city's pop_2023 is the explicit sum of the named localities in `pop_components`.
  The parsed table sums to exactly the PBS national urban total (93,884,702), which is asserted.
* District: pipeline.sources.cod_ab.pcode_at on the Wikidata point; `pcodes` lists every COD-AB district the city
  spans (only Karachi spans more than one).
Output: data/interim/cities.json
"""
from __future__ import annotations

import json
import re

from pipeline.common import fetch, interim, read_json, write_json

ID = "cities"
PBS_T2 = "https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_2_national.pdf"
PBS_T2_TABLE = ("Census 2023, TABLE 2: Urban localities by population size and their population by sex, "
                "annual growth rate and household size (Pakistan)")
WD = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
WD_PAGE = "https://www.wikidata.org/wiki/{}"
NATIONAL_URBAN_2023 = 93_884_702  # PBS Census 2023 Table 1 (national): Pakistan urban population

KARACHI_DISTRICTS = ["KARACHI CENTRAL", "KARACHI EAST", "KARACHI SOUTH", "KARACHI WEST", "KORANGI", "MALIR", "KEAMARI"]

# (id, name, Wikidata QID, capital, PBS components, extra COD-AB districts spanned)
# PBS components: list of (locality-name regex matched against the full row name with re.fullmatch, PBS district).
# A regex ending in r"( \(Part of .*)?" collects every tehsil part of a corporation. "*" district = Karachi rule.
# None = not enumerated by PBS (AJK / GB).
MC = r"( \(Part of .*)?"
CITIES = [
    ("karachi", "Karachi", "Q8660", "provincial", "*KARACHI", ["PK702", "PK704", "PK712", "PK714", "PK721", "PK729"]),
    ("lahore", "Lahore", "Q11739", "provincial",
     [(r"LAHORE METROPOLITAN CORPORATION" + MC, "LAHORE"), ("LAHORE CANTONMENT", "LAHORE"),
      ("WALTON CANTONMENT", "LAHORE")], None),
    ("faisalabad", "Faisalabad", "Q173985", None, [("FAISALABAD MUNICIPAL CORPORATION", "FAISALABAD")], None),
    ("rawalpindi", "Rawalpindi", "Q93230", None,
     [("RAWALPINDI METROPOLITAN CORPORATION", "RAWALPINDI"), ("RAWALPINDI CANTONMENT", "RAWALPINDI"),
      ("CHAKLALA CANTONMENT", "RAWALPINDI")], None),
    ("gujranwala", "Gujranwala", "Q243322", None,
     [("GUJRANWALA METROPOLITAN CORPORATION", "GUJRANWALA"), ("GUJRANWALA CANTONMENT", "GUJRANWALA")], None),
    ("multan", "Multan", "Q185453", None,
     [("MULTAN MUNICIPAL CORPORATION", "MULTAN"), ("MULTAN CANTONMENT", "MULTAN")], None),
    ("hyderabad", "Hyderabad", "Q1640079", None,
     [(r"HYDERABAD MUNICIPAL CORPORATION" + MC, "HYDERABAD"), ("QASIMABAD MC", "HYDERABAD"),
      (r"HYDERABAD CANTONMENT" + MC, "HYDERABAD")], None),
    ("peshawar", "Peshawar", "Q1113311", "provincial",
     [("PESHAWAR MUNICIPAL CORPORATION", "PESHAWAR"), ("PESHAWAR CANTONMENT", "PESHAWAR")], None),
    ("quetta", "Quetta", "Q185458", "provincial",
     [(r"QUETTA METROPOLITAN CORPORATION" + MC, "QUETTA"), ("QUETTA CANTONMENT", "QUETTA")], None),
    ("islamabad", "Islamabad", "Q1362", "national", [("ISLAMABAD METROPOLITAN CORPORATION", "ISLAMABAD")], None),
    ("sargodha", "Sargodha", "Q855997", None,
     [("SARGODHA MUNICIPAL CORPORATION", "SARGODHA"), ("SARGODHA CANTONMENT", "SARGODHA")], None),
    ("sialkot", "Sialkot", "Q643883", None,
     [("SIALKOT MUNICIPAL CORPORATION", "SIALKOT"), ("SIALKOT CANTONMENT", "SIALKOT")], None),
    ("bahawalpur", "Bahawalpur", "Q318156", None,
     [("BAHAWALPUR METROPOLITAN CORPORATION", "BAHAWALPUR"), ("BAHAWALPUR CANTONMENT", "BAHAWALPUR")], None),
    ("sukkur", "Sukkur", "Q868631", None, [(r"SUKKUR MUNICIPAL CORPORATION" + MC, "SUKKUR")], None),
    ("larkana", "Larkana", "Q696605", None, [("LARKANA MUNICIPAL CORPORATION", "LARKANA")], None),
    ("sheikhupura", "Sheikhupura", "Q972756", None, [("SHEIKHUPURA MC", "SHEIKHUPURA")], None),
    ("rahim_yar_khan", "Rahim Yar Khan", "Q989297", None,
     [("RAHIM YAR KHAN MUNICIPAL CORPORATION", "RAHIM YAR KHAN")], None),
    ("jhang", "Jhang", "Q1026616", None, [("JHANG MC", "JHANG")], None),
    ("dera_ghazi_khan", "Dera Ghazi Khan", "Q999076", None,
     [("DERA GHAZI KHAN MUNICIPAL CORPORATION", "DERA GHAZI KHAN")], None),
    ("gujrat", "Gujrat", "Q929062", None, [("GUJRAT METROPOLITAN CORPORATION", "GUJRAT")], None),
    ("sahiwal", "Sahiwal", "Q523778", None, [("SAHIWAL METROPOLITAN CORPORATION", "SAHIWAL")], None),
    ("wah_cantt", "Wah Cantonment", "Q1251261", None, [("WAH CANTONMENT", "RAWALPINDI")], None),
    ("mardan", "Mardan", "Q993859", None, [("MARDAN MC", "MARDAN"), ("MARDAN CANTONMENT", "MARDAN")], None),
    ("kasur", "Kasur", "Q989283", None, [("KASUR MC", "KASUR")], None),
    ("okara", "Okara", "Q968211", None,
     [("OKARA MUNICIPAL CORPORATION", "OKARA"), ("OKARA CANTONMENT", "OKARA")], None),
    ("mingora", "Mingora", "Q31356", None, [("MINGORA MC", "SWAT")], None),
    ("nawabshah", "Nawabshah", "Q1017637", None, [("NAWABSHAH MC", "SHAHEED BENAZIRABAD")], None),
    ("chiniot", "Chiniot", "Q1017651", None, [("CHINIOT MC", "CHINIOT")], None),
    ("kotri", "Kotri", "Q2657702", None, [("KOTRI MC", "JAMSHORO")], None),
    ("kamoke", "Kamoke", "Q1260929", None, [("KAMOKE MUNICIPAL CORPORATION", "GUJRANWALA")], None),
    ("hafizabad", "Hafizabad", "Q1253663", None, [("HAFIZABAD MC", "HAFIZABAD")], None),
    ("sadiqabad", "Sadiqabad", "Q1251234", None, [("SADIQABAD MUNICIPAL CORPORATION", "RAHIM YAR KHAN")], None),
    ("mirpur_khas", "Mirpur Khas", "Q1020490", None, [("MIRPUR KHAS MC", "MIRPUR KHAS")], None),
    ("burewala", "Burewala", "Q1250083", None, [("BUREWALA MC", "VEHARI")], None),
    ("kohat", "Kohat", "Q1195983", None, [("KOHAT MC", "KOHAT"), ("KOHAT CANTONMENT", "KOHAT")], None),
    ("khanewal", "Khanewal", "Q1253395", None, [("KHANEWAL MC", "KHANEWAL")], None),
    ("dera_ismail_khan", "Dera Ismail Khan", "Q1249888", None,
     [("DERA ISMAIL KHAN MC", "DERA ISMAIL KHAN"), ("DERA ISMAIL KHAN CANTONMENT", "DERA ISMAIL KHAN")], None),
    ("turbat", "Turbat", "Q2977093", None, [("TURBAT MUNICIPAL CORPORATION", "KECH")], None),
    ("muzaffargarh", "Muzaffargarh", "Q301627", None, [("MUZAFFARGARH MC", "MUZAFFARGARH")], None),
    ("abbottabad", "Abbottabad", "Q170315", None,
     [("ABBOTTABAD MC", "ABBOTTABAD"), ("ABBOTTABAD CANTONMENT", "ABBOTTABAD")], None),
    ("mandi_bahauddin", "Mandi Bahauddin", "Q1252806", None, [("MANDI BAHAUDDIN MC", "MANDI BAHAUDDIN")], None),
    ("gwadar", "Gwadar", "Q580533", None, [("GWADAR MC", "GWADAR")], None),
    ("muzaffarabad", "Muzaffarabad", "Q461307", "territorial", None, None),
    ("gilgit", "Gilgit", "Q609024", "territorial", None, None),
    ("skardu", "Skardu", "Q976955", None, None, None),
    ("mirpur_ajk", "Mirpur", "Q2579925", None, None, None),
    ("jacobabad", "Jacobabad", "Q1017696", None, [("JACOBABAD MC", "JACOBABAD")], None),
]

CAPITAL_OF = {"karachi": "Sindh", "lahore": "Punjab", "peshawar": "Khyber Pakhtunkhwa", "quetta": "Balochistan",
              "islamabad": "Pakistan", "muzaffarabad": "Azad Jammu and Kashmir", "gilgit": "Gilgit-Baltistan"}

INFO = {
    "id": ID,
    "title": "Major cities: location, Census 2023 urban-locality population, district",
    "publisher": "Pakistan Bureau of Statistics (population); Wikidata contributors (coordinates); OCHA COD-AB (districts)",
    "vintage": "7th Population and Housing Census 2023 (PBS); Wikidata P625 retrieved at build time",
    "url": "https://www.pbs.gov.pk/digital-census/detailed-results",
    "files_urls": [PBS_T2] + [WD.format(c[2]) for c in CITIES],
    "license": "PBS public release (cite Pakistan Bureau of Statistics); Wikidata CC0",
    "used_for": ["city markers and labels", "city population ranking", "capital symbols", "city -> district join"],
    "caveats": ("pop_2023 sums PBS urban localities listed in pop_components: the city's Metropolitan/Municipal "
                "Corporation (all tehsil parts) plus named adjoining cantonments where they exist (Lahore, Rawalpindi, "
                "Gujranwala, Multan, Hyderabad incl. Qasimabad MC, Peshawar, Quetta, Sargodha, Sialkot, Bahawalpur, "
                "Mardan, Okara, Kohat, D.I. Khan, Abbottabad). Karachi = all 42 urban localities of the 7 Karachi "
                "Division census districts. Suburban towns with their own MC/TC (e.g. Rohri, Muridke, Taxila, Kotri for "
                "Hyderabad) are not added; Wah Cantonment is its own city, separate from Rawalpindi. AJK and GB are not "
                "covered by PBS Census 2023 locality tables, so Muzaffarabad, Mirpur, Gilgit and Skardu have null "
                "pop_2023 (AJK P&DD publishes only district-level projections). Coordinates are Wikidata's city point "
                "(often the historic centre), not a centroid. pcodes uses the COD-AB 2022 frame, in which Keamari is "
                "part of West Karachi. Kotri's Wikidata point falls inside COD-AB Hyderabad (PK706) although PBS "
                "places Kotri MC in Jamshoro district (Indus-bank boundary edge case)."),
}


# --------------------------------------------------------------------------------------------- PBS Table 2 parser

def parse_table2(path) -> list[dict]:
    """Rows of PBS Census 2023 Table 2 by word geometry: anchor on the ALL SEXES column, gather name/district words."""
    import pdfplumber
    rows = []
    with pdfplumber.open(path) as pdf:
        for pi, pg in enumerate(pdf.pages):
            ws = pg.extract_words()
            # The column-number header row ("1 2 ... 9") ends the page header.
            hb = [w["top"] for w in ws if w["text"] == "9" and 540 < w["x0"] < 550][0] + 4
            words = []
            for w in ws:
                if w["top"] <= hb:
                    continue
                # A name ending in ")" can be fused with the district ("Sub-Division)MALIR"); split it.
                m = re.fullmatch(r"(.*\))([A-Z].*)", w["text"])
                if w["x0"] < 238 < w["x1"] and m:
                    words.append({**w, "text": m.group(1), "x1": 237})
                    words.append({**w, "text": m.group(2), "x0": 239})
                else:
                    words.append(w)
            anchors = sorted((w for w in words if w["x0"] > 300 and w["x1"] < 358
                              and re.fullmatch(r"[\d,]+", w["text"])), key=lambda w: w["top"])
            recs = [{"top": a["top"], "n": [], "d": [], "v": []} for a in anchors]
            for w in words:
                if not recs:
                    break
                r = min(recs, key=lambda r: abs(r["top"] - w["top"]))
                if abs(r["top"] - w["top"]) > 12:
                    continue
                (r["n"] if w["x1"] < 238 else r["d"] if w["x1"] < 320 else r["v"]).append(w)
            for r in recs:
                txt = lambda L: " ".join(x["text"] for x in sorted(L, key=lambda x: (round(x["top"]), x["x0"])))
                name = re.sub(r"^(500,000 AND ABOVE|BELOW 5,000|[\d,]+ - [\d,]+)\s*", "", txt(r["n"]))
                nums = [x["text"] for x in sorted(r["v"], key=lambda x: x["x0"])]
                n = [0 if s == "-" else int(s.replace(",", "")) for s in nums[:4]]
                assert len(nums) == 7 and n[0] == n[1] + n[2] + n[3], (pi + 1, name, nums)
                rows.append({"page": pi + 1, "name": name, "district": re.sub(r" DISTRICT$", "", txt(r["d"])),
                             "pop": n[0]})
    total = sum(r["pop"] for r in rows)
    assert total == NATIONAL_URBAN_2023, total
    return rows


# --------------------------------------------------------------------------------------------- Wikidata

def wikidata(qid: str) -> dict:
    p = fetch(ID, WD.format(qid), f"wikidata_{qid}.json")
    ents = json.loads(p.read_text())["entities"]
    return ents.get(qid) or next(iter(ents.values()))


def _claim_ids(ent, prop):
    return [c["mainsnak"]["datavalue"]["value"]["id"] for c in ent.get("claims", {}).get(prop, [])
            if c["mainsnak"].get("datavalue")]


# P31 classes accepted as "this item is the settlement" (labels verified via wbgetentities): city, big city,
# city or town, town, human settlement, metropolis, megacity, federal capital, cantonment.
SETTLEMENT_CLASSES = {"Q515", "Q1549591", "Q7930989", "Q3957", "Q486972", "Q200250", "Q174844", "Q257391", "Q5034013"}


def process():
    from pipeline.sources.cod_ab import pcode_at

    t2 = parse_table2(fetch(ID, PBS_T2))
    dists = {d["pcode"]: d for d in read_json(interim("districts"))["districts"]}
    out, used = [], set()
    for cid, name, qid, cap, comps, spans in CITIES:
        ent = wikidata(qid)
        assert "Q843" in _claim_ids(ent, "P17"), (name, qid, "country is not Pakistan")
        p31 = _claim_ids(ent, "P31")
        assert set(p31) & SETTLEMENT_CLASSES, (name, qid, "P31 is not a settlement class", p31)
        cc = ent["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
        lat, lon = round(cc["latitude"], 5), round(cc["longitude"], 5)
        pc = pcode_at(lon, lat)

        pop = basis = None
        parts = []
        if comps == "*KARACHI":
            parts = [r for r in t2 if r["district"] in KARACHI_DISTRICTS]
            basis = "all urban localities of the 7 Karachi Division census districts"
        elif comps:
            for rx, dist in comps:
                hit = [r for r in t2 if r["district"] == dist and re.fullmatch(rx, r["name"])]
                assert hit, (name, rx, dist)
                parts += hit
            kinds = "corporation + cantonment(s)" if any("CANTONMENT" in r["name"] for r in parts) \
                and len(comps) > 1 else "single urban locality"
            basis = f"city (urban localities: {kinds})"
        if parts:
            ids = {(r["page"], r["name"], r["district"]) for r in parts}
            assert not (ids & used), (name, "locality counted twice")
            used |= ids
            pop = sum(r["pop"] for r in parts)
        out.append({
            "id": cid, "name": name, "lat": lat, "lon": lon,
            "pop_2023": pop,
            "pop_basis": basis,
            "pop_components": [{"locality": r["name"], "district": r["district"], "pop": r["pop"]} for r in parts],
            "pop_source": f"{PBS_T2} ({PBS_T2_TABLE})" if pop is not None else None,
            "pcode": pc,
            "pcodes": spans or ([pc] if pc else []),
            "province": dists[pc]["province"] if pc else None,
            "is_capital": cap,
            "capital_of": CAPITAL_OF.get(cid),
            "wikidata_p31": p31,
            "src": ID,
            "ref": WD_PAGE.format(qid),
        })
    out.sort(key=lambda r: -(r["pop_2023"] or 0))
    write_json(interim(ID), {"source": INFO, "cities": out}, compact=False)
    return out


if __name__ == "__main__":
    rows = process()
    print(len(rows), "cities;", sum(r["pop_2023"] is not None for r in rows), "with pop_2023")
    for r in rows:
        print(f"{r['name']:18s} {r['lat']:8.4f} {r['lon']:8.4f} {str(r['pop_2023']):>10s} {r['pcode']} "
              f"{r['province']} {r['is_capital'] or ''}")
