"""PBS Economic Census 2023: establishments and workforce by PSIC major section, per district.

Inputs (official PBS xlsx, "Table 1" per province, one block per district) plus EC_data_in_excel-1.xlsx for the
national / provincial / ICT tables. EC district names are crosswalked onto the frozen COD-AB 2022 district frame
(data/interim/districts.json) by summing where several EC districts fall inside one COD district.
Output: data/interim/econ_census.json
"""
from __future__ import annotations

import re

import openpyxl

from pipeline.common import fetch, interim, read_json, write_json

ID = "econ_census"
BASE = "https://www.pbs.gov.pk/wp-content/uploads/2020/07/"
FILES = {
    "Punjab": "PUNJAB-DISTRICTS-PSIC-wise-1.xlsx",
    "Sindh": "SINDH-DISTRICTS-PSIC-WISE.xlsx",
    "Khyber Pakhtunkhwa": "KPK-DISTRICTPSIC-WISE.xlsx",
    "Balochistan": "BALOCHISTAN-DISTRICTPSIC-WISE.xlsx",
}
NATIONAL_FILE = "EC_data_in_excel-1.xlsx"  # sheets "Table 1".."Table 6" = Pakistan, Punjab, KPK, Sindh, Balochistan, ICT

INFO = {
    "id": ID,
    "title": "Economic Census 2023: establishments and workforce by PSIC section",
    "publisher": "Pakistan Bureau of Statistics (PBS)",
    "vintage": "Economic Census of Pakistan 2023 (results released 2024-25)",
    "url": "https://www.pbs.gov.pk/pakistan-bureau-of-statistics-economic-statistics-production/",
    "files_urls": [BASE + f for f in FILES.values()] + [BASE + NATIONAL_FILE],
    "license": "PBS public release (cite Pakistan Bureau of Statistics)",
    "used_for": ["Jobs / workforce lens", "industry-district specialisation (PSIC section shares)", "Food (farm workforce)"],
    "caveats": ("Workplace-based count of establishments (shops, offices, factories, schools, mosques, cattle farms) "
                "and persons working in them; major PSIC sections only. Section 'X' is PBS's unclassified 'Others'. "
                "No district tables for Azad Kashmir or Gilgit-Baltistan. EC districts are summed onto COD-AB 2022 "
                "districts (e.g. Keamari into West Karachi, Surab = Shaheed Sikandarabad). Lehri has no separate EC "
                "table. A few Punjab district blocks omit sections that are zero."),
}

# PSIC 2010 (ISIC rev.4) sections. The EC tables list 20 sections plus an unclassified "Others" row (here "X");
# section T (households as employers) is not enumerated.
SECTIONS = {
    "A": "Agriculture, forestry and fishing",
    "B": "Mining and quarrying",
    "C": "Manufacturing",
    "D": "Electricity, gas, steam and air conditioning supply",
    "E": "Water supply; sewerage, waste management and remediation activities",
    "F": "Construction",
    "G": "Wholesale and retail trade; repair of motor vehicles and motorcycles",
    "H": "Transportation and storage",
    "I": "Accommodation and food service activities",
    "J": "Information and communication",
    "K": "Financial and insurance activities",
    "L": "Real estate activities",
    "M": "Professional, scientific and technical activities",
    "N": "Administrative and support service activities",
    "O": "Public administration and defence; compulsory social security",
    "P": "Education",
    "Q": "Human health and social work activities",
    "R": "Arts, entertainment and recreation",
    "S": "Other service activities",
    "U": "Activities of extraterritorial organizations and bodies",
    "X": "Others (unclassified)",
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", str(s).lower())


_DESC2SEC = {_norm(v): k for k, v in SECTIONS.items() if k != "X"}
_DESC2SEC[_norm("Others")] = "X"
_DESC2SEC[_norm("Other")] = "X"

# EC 2023 district name (normalised, upper-case as printed by PBS) -> COD-AB 2022 district name.
# Identity matches are resolved automatically (after normalisation); only spelling variants, renames and
# merges are listed here.
CROSSWALK = {
    # Punjab: spelling variants
    "JHUNG": "Jhang",
    "JEHLUM": "Jhelum",
    "LAYYAH": "Leiah",
    # Sindh: EC uses "Karachi X"; COD-AB 2022 has 6 Karachi districts (no Keamari)
    "KARACHI EAST": "East Karachi",
    "KARACHI WEST": "West Karachi",
    "KARACHI CENTRAL": "Central Karachi",
    "KARACHI SOUTH": "South Karachi",
    "MALIR": "Malir Karachi",
    "KORANGI": "Korangi Karachi",
    "KEAMARI": "West Karachi",  # Keamari district was carved out of Karachi West in 2020; COD-AB keeps it in West
    "SHAHEED BENAZIRABAD": "Shaheed Benazir Abad",
    "UMER KOT": "Umer Kot",
    # KP: spelling variants / Upper-Lower naming
    "ABBOTABAD": "Abbottabad",
    "BATGRAM": "Batagram",
    "DERA ISMAIL KHAN": "D. I. Khan",
    "LOWER CHITRAL": "Chitral Lower",
    "UPPER CHITRAL": "Chitral Upper",
    "LOWER KOHISTAN": "Kohistan Lower",
    "UPPER KOHISTAN": "Kohistan Upper",
    "NORTH WAZIRSTAN": "North Waziristan",
    "SOUTH WAZIRSTAN": "South Waziristan",
    "NOWSHEHRA": "Nowshera",
    "SAWABI": "Swabi",
    "SAWAT": "Swat",
    "TORGHAR": "Tor Ghar",
    # Balochistan
    "GAWADAR": "Gwadar",
    "SOHBATOUR": "Sohbatpur",
    "ZOHB": "Zhob",
    "SURAB": "Shaheed Sikandarabad",  # district created 2017 with HQ at Surab; COD-AB uses the official name
}


def _num(v) -> int:
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = re.sub(r"[^0-9]", "", str(v))
    return int(s) if s else 0


def _ints(row) -> list[int]:
    return [int(c) for c in row if isinstance(c, (int, float)) and not isinstance(c, bool)]


def parse_district_file(path) -> list[dict]:
    """Return [{name, total:(est,wf), sections:{sec:(est,wf)}}] for each district block in a provincial file."""
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    blocks, cur = [], None
    for row in ws.iter_rows(values_only=True):
        cells = [c for c in row if c is not None and str(c).strip() != ""]
        if not cells:
            continue
        strs = [c for c in cells if isinstance(c, str)]
        if len(cells) == 1 and isinstance(cells[0], str):
            t = cells[0].strip()
            if t.lower().startswith("table"):
                continue
            cur = {"name": t.upper(), "total": None, "sections": {}}
            blocks.append(cur)
            continue
        if cur is None or any(s.strip().lower().startswith("sr") for s in strs):
            continue
        desc = next((s for s in strs if _norm(s) in _DESC2SEC), None)
        if desc is None:
            if not strs and cur["total"] is None:
                nums = _ints(cells)
                if len(nums) == 2:
                    cur["total"] = tuple(nums)
            continue
        sec = _DESC2SEC[_norm(desc)]
        # Fixed layout: col0 Sr.No, col1 description, col2 PSIC code, col3 establishments, col4 workforce.
        # A blank count cell means zero (confirmed against the block total, e.g. Panjgur construction workforce).
        if row[1] != desc:
            raise ValueError(f"{path.name}: unexpected layout for {cur['name']}: {row}")
        est, wf = _num(row[3]), _num(row[4])
        if sec in cur["sections"]:
            raise ValueError(f"{path.name}: duplicate {sec} in {cur['name']}")
        cur["sections"][sec] = (est, wf)
    return blocks


def parse_national(path) -> dict:
    """Sheets Table 1..6 -> {"Pakistan"|"Punjab"|...|"ICT": block}."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    for i in range(1, 7):
        ws = wb[f"Table {i}"]
        blk = {"total": None, "sections": {}}
        name = None
        for row in ws.iter_rows(values_only=True):
            cells = [c for c in row if c is not None and str(c).strip() != ""]
            if not cells:
                continue
            strs = [c for c in cells if isinstance(c, str)]
            desc = next((s for s in strs if _norm(s) in _DESC2SEC), None)
            if desc is not None:
                # PSIC code cell may have been mangled into a date by Excel; take the last two cells.
                blk["sections"][_DESC2SEC[_norm(desc)]] = (_num(cells[-2]), _num(cells[-1]))
            elif len(cells) == 3 and isinstance(cells[0], str) and _ints(cells[1:]) and len(_ints(cells[1:])) == 2:
                name = cells[0].strip()
                blk["total"] = tuple(_ints(cells[1:]))
        out[name] = blk
    return out


def _check(blk, label) -> list[str]:
    errs = []
    if blk["total"] is None:
        return [f"{label}: no total row"]
    se = sum(v[0] for v in blk["sections"].values())
    sw = sum(v[1] for v in blk["sections"].values())
    if (se, sw) != tuple(blk["total"]):
        errs.append(f"{label}: sections sum {se}/{sw} != total {blk['total'][0]}/{blk['total'][1]}")
    return errs


def _as_dict(blk, idx) -> dict:
    d = {s: blk["sections"].get(s, (0, 0))[idx] for s in SECTIONS}
    d["total"] = blk["total"][idx]
    return d


def process():
    frame = read_json(interim("districts"))["districts"]
    by_name = {}
    for d in frame:
        by_name[(d["province"], _norm(d["name"]))] = d["pcode"]
    nat = parse_national(fetch(ID, BASE + NATIONAL_FILE, NATIONAL_FILE))

    errors, out = [], {}
    for prov, fname in FILES.items():
        blocks = parse_district_file(fetch(ID, BASE + fname, fname))
        pe = pw = 0
        for b in blocks:
            errors += _check(b, f"{prov}/{b['name']}")
            target = CROSSWALK.get(b["name"], b["name"])
            pc = by_name.get((prov, _norm(target)))
            if pc is None:
                raise KeyError(f"unmapped EC district {prov}/{b['name']}")
            rec = out.setdefault(pc, {"establishments": {s: 0 for s in [*SECTIONS, "total"]},
                                      "workforce": {s: 0 for s in [*SECTIONS, "total"]}, "ec_districts": []})
            for k, idx in (("establishments", 0), ("workforce", 1)):
                for s, v in _as_dict(b, idx).items():
                    rec[k][s] += v
            rec["ec_districts"].append(b["name"].title())
            pe += b["total"][0]; pw += b["total"][1]
        key = {"Khyber Pakhtunkhwa": "KPK"}.get(prov, prov)
        if (pe, pw) != tuple(nat[key]["total"]):
            errors.append(f"{prov}: district sum {pe}/{pw} != provincial table {nat[key]['total']}")
    # ICT is a single district, published only in the national workbook (Table 6).
    ict = nat["ICT"]
    errors += _check(ict, "ICT")
    out["PK401"] = {"establishments": _as_dict(ict, 0), "workforce": _as_dict(ict, 1), "ec_districts": ["ICT"]}
    # Published provincial/national tables are checked too, but PBS's own Balochistan table has sections summing
    # 2 establishments short of its total; we record such discrepancies instead of failing on them.
    warnings = []
    for k in nat:
        warnings += _check(nat[k], f"PBS table {k}")
    if errors:
        raise ValueError("Economic Census consistency failures:\n" + "\n".join(errors))

    pk = nat["Pakistan"]
    missing = [{"pcode": d["pcode"], "name": d["name"], "province": d["province"],
                "reason": ("no district tables published for AJK/GB" if d["province"] in ("Azad Kashmir", "Gilgit Baltistan")
                           else "no separate EC 2023 table (likely enumerated within a parent district)")}
               for d in frame if d["pcode"] not in out]
    res = {
        "vintage": INFO["vintage"],
        "sections": SECTIONS,
        "districts": dict(sorted(out.items())),
        "national": {"establishments": _as_dict(pk, 0), "workforce": _as_dict(pk, 1),
                     "provinces": {k: {"establishments": nat[k]["total"][0], "workforce": nat[k]["total"][1]}
                                   for k in nat if k != "Pakistan"}},
        "missing": missing,
        "checks": {"district_section_sums": "exact for all EC districts; district sums equal provincial totals",
                   "published_table_discrepancies": warnings},
    }
    write_json(interim(ID), res)
    return res


if __name__ == "__main__":
    r = process()
    print(len(r["districts"]), "districts;", "missing:", [m["name"] for m in r["missing"]])
    print("national", r["national"]["establishments"]["total"], r["national"]["workforce"]["total"])
