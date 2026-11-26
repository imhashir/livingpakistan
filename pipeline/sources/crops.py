"""District crop areas from the PBS Agricultural Census 2024, district Table 5
("Share of major crops area in total cropped area by size of farm").

The table gives, per district, total cropped area (acres, private farms, both seasons) and each major crop's
percentage share. We take the "PRIVATE-FARMS TOTAL" row of each district block and derive
    area_ha = total_cropped_acres * share_pct / 100 * 0.40468564224
Production is NOT published at district level in the census tables, so prod_t is null.
Output: data/interim/crops.json
"""
from __future__ import annotations

import re

import xlrd

from pipeline.common import fetch, interim, read_json, write_json

ID = "crops"
URL = "https://www.pbs.gov.pk/wp-content/uploads/2020/07/Table_5_District.xls"
ACRE_HA = 0.40468564224

INFO = {
    "id": ID,
    "title": "Agricultural Census 2024: crop area by district (Table 5)",
    "publisher": "Pakistan Bureau of Statistics (PBS)",
    "vintage": "Agricultural Census 2024 (district tables released 2025)",
    "url": "https://www.pbs.gov.pk/agriculture-census/",
    "files_urls": [URL, "https://www.pbs.gov.pk/wp-content/uploads/2020/07/Table_5_District-1.pdf"],
    "license": "PBS public release (cite Pakistan Bureau of Statistics)",
    "used_for": ["Food yield (crop area)", "dominant crop per district"],
    "caveats": ("Private farms only; total cropped area counts both Rabi and Kharif seasons. Crop areas are derived "
                "from PBS's published percentage shares (1 decimal) x total cropped area, so each is accurate to "
                "about +/-0.05% of the district's cropped area. 'Other' includes jowar, barley, tobacco, oilseeds, "
                "pulses, vegetables and orchards, yet published shares often sum to <100% (e.g. Ziarat 29.8%, "
                "Killa Abdullah 38.3%); the gap is reported as unlisted_area_ha. Census-reported areas are well "
                "above Crop Reporting Service / Agricultural Statistics estimates (national cropped area sums to "
                "~33.5 Mha, wheat ~14.5 Mha), so use them for relative crop mix, not as official crop-area "
                "statistics. Because Rabi wheat is counted, wheat is the 'dominant' crop almost everywhere. "
                "No production figures (prod_t null). PBS reports 'Cholistan "
                "Area' as a separate unit (desert tracts of Bahawalpur/Bahawalnagar/Rahim Yar Khan); it is kept "
                "unassigned. Keamari is summed into West Karachi, Surab = Shaheed Sikandarabad. No AJK/GB tables."),
}

COLS = ["total", "wheat", "rice", "maize", "cotton", "sugarcane", "fodder", "other"]
CROPS = COLS[1:]
NAMED = ["wheat", "rice", "maize", "cotton", "sugarcane", "fodder"]  # candidates for "dominant"

PROVINCES = {"KHYBER PAKHTUNKHWA": "Khyber Pakhtunkhwa", "PUNJAB": "Punjab", "SINDH": "Sindh",
             "BALOCHISTAN": "Balochistan", "ISLAMABAD CAPITAL TERRITORY": "Islamabad"}

# Agri Census unit name (without " DISTRICT") -> COD-AB 2022 district name; identity matches are automatic.
CROSSWALK = {
    "DERA ISMAIL KHAN": "D. I. Khan",
    "TORGHAR": "Tor Ghar",
    "UPPER KOHISTAN": "Kohistan Upper", "LOWER KOHISTAN": "Kohistan Lower",
    "LOWER CHITRAL": "Chitral Lower", "UPPER CHITRAL": "Chitral Upper",
    "MALAKAND PROTECTED AREA": "Malakand",
    "LAYYAH": "Leiah",
    "KARACHI EAST": "East Karachi", "KARACHI WEST": "West Karachi", "KARACHI CENTRAL": "Central Karachi",
    "KARACHI SOUTH": "South Karachi", "MALIR": "Malir Karachi", "KORANGI": "Korangi Karachi",
    "KEAMARI": "West Karachi",  # carved from Karachi West in 2020; COD-AB 2022 keeps it inside West Karachi
    "SHAHEED BENAZIRABAD": "Shaheed Benazir Abad",
    "SURAB": "Shaheed Sikandarabad",  # district HQ Surab
    "ISLAMABAD": "Islamabad",
}
UNASSIGNED = {"CHOLISTAN AREA"}  # spans three COD districts; not split


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def parse(path) -> tuple[list[dict], dict]:
    sh = xlrd.open_workbook(str(path)).sheet_by_index(0)
    units, provinces, cur, prov = [], {}, None, None
    for i in range(sh.nrows):
        row = sh.row_values(i)
        lab = row[0].strip() if isinstance(row[0], str) else ""
        if lab in PROVINCES:
            prov = PROVINCES[lab]
            cur = {"kind": "province", "name": lab, "province": prov}
        elif lab.endswith(" DISTRICT") or lab in UNASSIGNED or lab == "MALAKAND PROTECTED AREA":
            cur = {"kind": "district", "name": lab.removesuffix(" DISTRICT"), "province": prov}
        elif lab.endswith(" DIVISION") or lab == "FEDERAL CAPITAL AREA":
            cur = {"kind": "division", "name": lab, "province": prov}
        elif lab == "PRIVATE-FARMS TOTAL" and cur is not None and "values" not in cur:
            vals = [float(v) if v != "" else 0.0 for v in row[1:9]]
            cur["values"] = dict(zip(COLS, vals))
            if cur["kind"] == "district":
                units.append(cur)
            elif cur["kind"] == "province":
                provinces[cur["province"]] = cur["values"]
    return units, provinces


def process():
    frame = read_json(interim("districts"))["districts"]
    by_name = {(d["province"], _norm(d["name"])): d["pcode"] for d in frame}
    units, provinces = parse(fetch(ID, URL, "Table_5_District.xls"))
    problems = []

    acc, unassigned = {}, {}
    for u in units:
        v = u["values"]
        s = sum(v[c] for c in CROPS)
        # PBS's published shares often sum to < 100% (e.g. Ziarat 29.8%: orchard-dominated districts), so the
        # residual is kept as "unlisted_pct" rather than forced into a crop. Sums > 100% would be a parse error.
        if s > 100.6:
            problems.append(f"{u['name']}: crop shares sum to {s:.1f}%")
        if u["name"] in UNASSIGNED:
            unassigned[u["name"].title()] = {"province": u["province"], "cropped_area_ha": round(v["total"] * ACRE_HA),
                                             "share_pct": {c: v[c] for c in CROPS}}
            continue
        target = CROSSWALK.get(u["name"], u["name"])
        pc = by_name.get((u["province"], _norm(target)))
        if pc is None:
            raise KeyError(f"unmapped Agri Census unit {u['province']}/{u['name']}")
        a = acc.setdefault(pc, {"cropped_acres": 0.0, "crop_acres": {c: 0.0 for c in CROPS}, "units": [],
                                "unlisted_acres": 0.0})
        a["unlisted_acres"] += v["total"] * max(0.0, 100 - s) / 100
        a["cropped_acres"] += v["total"]
        for c in CROPS:
            a["crop_acres"][c] += v["total"] * v[c] / 100
        a["units"].append(u["name"].title())

    # Provincial check: sum of units (incl. unassigned) vs provincial total cropped area.
    checks = {}
    for prov, pv in provinces.items():
        tot = sum(u["values"]["total"] for u in units if u["province"] == prov)
        checks[prov] = {"province_table_acres": round(pv["total"]), "sum_of_units_acres": round(tot)}
        if pv["total"] and abs(tot - pv["total"]) / pv["total"] > 0.001:
            problems.append(f"{prov}: units sum {tot:.0f} != province {pv['total']:.0f}")
    if problems:
        raise ValueError("Agri Census checks failed:\n" + "\n".join(problems))

    districts = {}
    for pc, a in sorted(acc.items()):
        rec = {c: {"area_ha": round(a["crop_acres"][c] * ACRE_HA), "prod_t": None} for c in CROPS}
        rec["cropped_area_ha"] = round(a["cropped_acres"] * ACRE_HA)
        rec["unlisted_area_ha"] = round(a["unlisted_acres"] * ACRE_HA)  # cropped area not covered by PBS shares
        named = {c: a["crop_acres"][c] for c in NAMED}
        rec["dominant"] = max(named, key=named.get) if a["cropped_acres"] > 0 else None
        rec["ac_units"] = a["units"]
        districts[pc] = rec

    nat_total = sum(p["total"] for p in provinces.values())
    national = {"cropped_area_ha": round(nat_total * ACRE_HA),
                **{c: {"area_ha": round(sum(p["total"] * p[c] / 100 for p in provinces.values()) * ACRE_HA)}
                   for c in CROPS},
                "note": "sum of the four provinces + ICT (private farms); excludes AJK/GB"}
    missing = [{"pcode": d["pcode"], "name": d["name"], "province": d["province"]} for d in frame
               if d["pcode"] not in districts]
    res = {"vintage": INFO["vintage"], "crops": CROPS, "units": {"area": "ha", "prod": "t (not available)"},
           "districts": districts, "national": national, "unassigned": unassigned,
           "provincial_checks": checks, "missing": missing}
    write_json(interim(ID), res)
    return res


if __name__ == "__main__":
    r = process()
    print(len(r["districts"]), "districts; missing:", [m["name"] for m in r["missing"]])
    n = r["national"]
    print("national cropped %.2f Mha; wheat %.2f Mha; rice %.2f; cotton %.2f; sugarcane %.2f; maize %.2f" % tuple(
        x / 1e6 for x in (n["cropped_area_ha"], n["wheat"]["area_ha"], n["rice"]["area_ha"], n["cotton"]["area_ha"],
                          n["sugarcane"]["area_ha"], n["maize"]["area_ha"])))
    from collections import Counter
    print(Counter(v["dominant"] for v in r["districts"].values()))
    print(r["provincial_checks"], r["unassigned"])
