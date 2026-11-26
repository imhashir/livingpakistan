"""Airports: OurAirports (iso_country=PK; large + medium airports, plus small airports with scheduled service),
with annual passengers / aircraft movements / cargo from the PCAA Statistics Branch table "Major traffic flows
by airports during the year" (FY July 2024 - June 2025). Output: data/interim/airports.json."""
from __future__ import annotations

import csv
import re

from pipeline.common import fetch, write_json, interim

SRC = "airports"
OA_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
PCAA_URL = ("https://pcaawebadmin.pcaa.gov.pk/media/xaehjqwn/"
            "major-traffic-flows-by-airports-during-the-year-2024-25.pdf")
PCAA_FY = "2024-25"

INFO = {
    "id": SRC,
    "title": "Airports (OurAirports) with PCAA annual traffic",
    "publisher": "OurAirports (public domain); Pakistan Civil Aviation Authority, Statistics Branch",
    "vintage": f"OurAirports snapshot at retrieval; PCAA FY {PCAA_FY} (July 2024 - June 2025)",
    "url": "https://ourairports.com/data/",
    "files_urls": [OA_URL, PCAA_URL],
    "license": "OurAirports: public domain; PCAA statistics: published government data (cite PCAA)",
    "used_for": ["airport points", "airport icon size by annual passengers"],
    "caveats": ("Selection = OurAirports large_airport + medium_airport + small_airport with scheduled_service=yes; "
                "medium_airport includes PAF air bases (flag military=true by name), which carry no civil traffic. "
                "Traffic joined by ICAO code (then IATA) to the PCAA FY 2024-25 table; airports absent from the PCAA "
                "table have null traffic (not zero). PCAA counts are for airports it operates; ISB 'BBIAP Chaklala' "
                "(old Islamabad airport / Nur Khan) is listed separately from Islamabad International (OPIS)."),
}

_ROW = re.compile(r"^(?P<iata>[A-Z0-9]{3}) - (?P<icao>[A-Z0-9]{3,4}) - (?P<name>.+?)\s+(?P<nums>(?:[\d,]+\s+){13}[\d,]+)$")
_COLS = ["mov_com_dom", "mov_com_intl", "mov_com_total", "mov_noncom", "movements",
         "pax_dom", "pax_intl", "pax", "cargo_dom_t", "cargo_intl_t", "cargo_t",
         "mail_dom_t", "mail_intl_t", "mail_t"]


def pcaa_table() -> list[dict]:
    import pdfplumber
    rows = []
    total = None
    with pdfplumber.open(fetch(SRC, PCAA_URL)) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                line = line.strip()
                m = _ROW.match(line)
                if m:
                    nums = [int(x.replace(",", "")) for x in m.group("nums").split()]
                    rows.append({"iata": m.group("iata"), "icao": m.group("icao"), "pcaa_name": m.group("name"),
                                 **dict(zip(_COLS, nums))})
                elif line.startswith("Grand Totals"):
                    total = [int(x.replace(",", "")) for x in line.split()[2:]]
    # integrity: count columns must sum exactly to the PDF's Grand Totals line; tonnage columns are rounded in
    # the PDF, so allow a few tonnes of rounding drift there.
    if total is None or len(total) != len(_COLS):
        raise ValueError("PCAA Grand Totals line not found")
    for c, tot in zip(_COLS, total):
        s = sum(r[c] for r in rows)
        if (s != tot) if not c.endswith("_t") else abs(s - tot) > 3:
            raise ValueError(f"PCAA parse: column {c} sums to {s}, Grand Totals says {tot}")
    return rows


def process():
    from pipeline.sources.cod_ab import pcode_at

    pcaa = pcaa_table()
    by_icao = {r["icao"]: r for r in pcaa}
    by_iata = {r["iata"]: r for r in pcaa}

    out, used = [], set()
    with open(fetch(SRC, OA_URL), newline="", encoding="utf-8") as f:
        for a in csv.DictReader(f):
            if a["iso_country"] != "PK":
                continue
            keep = a["type"] in ("large_airport", "medium_airport") or (
                a["type"] == "small_airport" and a["scheduled_service"] == "yes")
            if not keep:
                continue
            t = None
            for code in (a["ident"], a["icao_code"], a["gps_code"]):
                if code and code in by_icao:
                    t = by_icao[code]; break
            if t is None and a["iata_code"] in by_iata:
                t = by_iata[a["iata_code"]]
            if t is None:  # PCAA codes some new airports with placeholder ICAO ids; unique municipality match only
                cands = [r for r in pcaa if a["municipality"] and a["municipality"].upper() in r["pcaa_name"]]
                if len(cands) == 1 and cands[0]["icao"] not in used:
                    t = cands[0]
            if t is not None:
                used.add(t["icao"])
            lat, lon = float(a["latitude_deg"]), float(a["longitude_deg"])
            out.append({
                "id": a["ident"], "name": a["name"], "lat": round(lat, 5), "lon": round(lon, 5),
                "iata": a["iata_code"] or None, "icao": a["icao_code"] or a["gps_code"] or None,
                "type": a["type"], "scheduled_service": a["scheduled_service"] == "yes",
                "municipality": a["municipality"] or None, "elevation_ft": int(a["elevation_ft"]) if a["elevation_ft"] else None,
                "military": bool(re.search(r"air base|PAF base", a["name"], re.I)),
                "pax": t["pax"] if t else None, "pax_dom": t["pax_dom"] if t else None,
                "pax_intl": t["pax_intl"] if t else None, "movements": t["movements"] if t else None,
                "cargo_t": t["cargo_t"] if t else None, "traffic_fy": PCAA_FY if t else None,
                "pcaa_name": t["pcaa_name"] if t else None,
                "pcode": pcode_at(lon, lat), "src": SRC,
                "ref": f"https://ourairports.com/airports/{a['ident']}/",
            })
    unmatched = [r for r in pcaa if r["icao"] not in used and r["pax"] > 0]
    out.sort(key=lambda r: -(r["pax"] or -1))
    write_json(interim(SRC), {"info": INFO, "airports": out,
                              "pcaa_unmatched": [{k: r[k] for k in ("iata", "icao", "pcaa_name", "pax", "movements")}
                                                 for r in unmatched]})
    return out, unmatched


if __name__ == "__main__":
    rows, um = process()
    print(len(rows), "airports;", sum(r["pax"] is not None for r in rows), "with PCAA traffic;",
          sum(r["pcode"] is None for r in rows), "without pcode")
    for r in rows[:12]:
        print(f"  {r['iata']} {r['name']}: {r['pax']} pax {r['pcode']}")
    print("PCAA rows with passengers not matched:", [(r["icao"], r["pcaa_name"], r["pax"]) for r in um])
