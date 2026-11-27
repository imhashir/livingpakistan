"""UNOSAT 2022 Pakistan floods: cumulative VIIRS flood extent (1 Jul – 31 Aug 2022, polygons, used by world.py)
and the 'Preliminary Satellite Derived Flood Evolution Assessment' workbook (as of 31 Dec 2022): flood-water extent
and population potentially exposed, by district, for each weekly period Aug → Dec 2022.
Output: data/interim/flood_evolution.json
"""
from __future__ import annotations

import re
import shutil
import unicodedata

from pipeline.common import fetch, interim, read_json, raw_dir, write_json

FOOTPRINT_URL = ("https://data.humdata.org/dataset/f685e623-a539-4af0-92ff-19b737ec95b3/resource/"
                 "fa89ec39-8dd0-4abe-b97e-0a3d9e9627a5/download/viirs_20220701_20220831_floodextent_pak.zip")
EVOLUTION_URL = ("https://unosat.org/static/unosat_filesystem/3470/Preliminary%20Satellite%20Derived%20Flood%20"
                 "Evolution%20Assessment%2C%20Islamic%20Republic%20of%20Pakistan-31Dec2022.csv")

INFO = {
    "id": "unosat_flood",
    "title": "UNOSAT satellite-detected flood water, Pakistan 2022 (VIIRS extent + weekly flood evolution by district)",
    "publisher": "UNITAR-UNOSAT (via HDX)",
    "vintage": "Cumulative extent 1 Jul – 31 Aug 2022; weekly evolution Aug – Dec 2022 (release 3 Jan 2023)",
    "url": "https://data.humdata.org/dataset/satellite-detected-water-extents-between-01-and-29-august-2022-over-pakistan",
    "files_urls": [FOOTPRINT_URL, EVOLUTION_URL],
    "license": "UNOSAT products: free for humanitarian and non-commercial use with attribution",
    "used_for": ["2022 Mega-Flood lens (share of each hex's land under water)", "Flood-surge playback (weekly)",
                 "District flood exposure"],
    "caveats": "Satellite analysis, not field validated. Cloud cover hides some water in some weeks. The playback "
               "spreads each district's weekly flooded area over that district's cumulative footprint hexes — the "
               "weekly *district totals* are UNOSAT's; their placement inside a district is approximate. "
               "The 1 Jul – 31 Aug VIIRS composite also picks up flooded rice paddies (Punjab rice belt, e.g. Sialkot); living pakistan district headlines therefore use the peak of the cloud-free weekly windows (from 25 Aug), with the monthly maximum shown separately.",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = s.replace("district", "").replace("&", "and")
    return re.sub(r"[^a-z]", "", s)


# UNOSAT spelling → COD-AB name, where they differ.
ALIASES = {
    "dikhan": "D. I. Khan", "dikhan": "D. I. Khan", "deraismailkhan": "D. I. Khan", "deraghazikhan": "Dera Ghazi Khan",
    "kambarshahdadkot": "Kambar Shahdad Kot", "qambarshahdadkot": "Kambar Shahdad Kot",
    "shaheedbenazirabad": "Shaheed Benazir Abad", "shaheedbenazirabadnawabshah": "Shaheed Benazir Abad",
    "umerkot": "Umer Kot", "umarkot": "Umer Kot", "nausheroferoze": "Naushahro Feroze", "naushahroferoze": "Naushahro Feroze",
    "tandomuhammadkhan": "Tando Muhammad Khan", "tandoallahyar": "Tando Allahyar", "mirpurkhas": "Mirpur Khas",
    "killaabdullah": "Killa Abdullah", "qillaabdullah": "Killa Abdullah", "killasaifullah": "Killa Saifullah",
    "qillasaifullah": "Killa Saifullah", "jaffarabad": "Jaffarabad", "jafarabad": "Jaffarabad",
    "lasbela": "Lasbela", "kachhibolan": "Kachhi", "kachhi": "Kachhi", "sohbatpur": "Sohbatpur",
    "karachicentral": "Central Karachi", "karachieast": "East Karachi", "karachisouth": "South Karachi",
    "karachiwest": "West Karachi", "korangi": "Korangi Karachi", "malir": "Malir Karachi", "keamari": "West Karachi",
    "kemari": "West Karachi", "chitral": "Chitral Lower", "dir": "Lower Dir", "lowerdir": "Lower Dir", "upperdir": "Upper Dir",
    "kohistan": "Kohistan Upper", "torghar": "Tor Ghar", "shaheedsikandarabad": "Shaheed Sikandarabad", "surab": "Shaheed Sikandarabad",
    "nankanasahib": "Nankana Sahib", "mandibahauddin": "Mandi Bahauddin", "tobateksingh": "Toba Tek Singh",
    "rahimyarkhan": "Rahim Yar Khan", "dgkhan": "Dera Ghazi Khan", "hattian": "Jhelum Valley", "hattianbala": "Jhelum Valley",
    "diamer": "Diamir", "ghizer": "Ghizer", "skardu": "Skardu", "islamabadcapitalterritory": "Islamabad", "ict": "Islamabad",
}
PERIOD_RE = re.compile(r"\[(.+?)\]")


def process():
    fetch("unosat_flood", FOOTPRINT_URL)
    src = fetch("unosat_flood", EVOLUTION_URL, "flood_evolution_31Dec2022.csv")  # an .xlsx despite the name
    x = raw_dir("unosat_flood") / "flood_evolution_31Dec2022.xlsx"
    shutil.copyfile(src, x)
    import openpyxl
    wb = openpyxl.load_workbook(x, read_only=True, data_only=True)
    ws = next(w for w in wb.worksheets if "district" in w.title.lower())
    rows = list(ws.iter_rows(values_only=True))
    head = [str(h or "") for h in rows[0]]
    ext_cols, pop_cols, periods = [], [], []
    for j, h in enumerate(head):
        m = PERIOD_RE.search(h)
        if not m:
            continue
        if h.startswith("Maximum flood water extent"):
            ext_cols.append(j); periods.append(" ".join(m.group(1).split()))
        elif h.startswith("Population potentially exposed") and "%" not in h:
            pop_cols.append(j)
    # UNOSAT's last column header reads '25 - 31 Oct. 2022' but its own data note lists '25-31 Dec. 2022' and the
    # columns are chronological after 14-20 Nov — so it is December. Corrected here, and recorded in the output.
    corrections = []
    for k, p in enumerate(periods):
        if p.startswith("25 - 31 Oct") and k == len(periods) - 1:
            periods[k] = "25 - 31 Dec. 2022"; corrections.append("last period header '25 - 31 Oct. 2022' read as Dec (per UNOSAT data note)")
    # first period is the 01–31 Aug monthly summary; the rest are weekly
    dist = read_json(interim("districts"))["districts"]
    by_norm = {_norm(d["name"]): d for d in dist}
    provinces = {_norm(p) for p in ["Pakistan", "Azad Kashmir", "Balochistan", "Gilgit Baltistan", "Islamabad Capital Territory",
                                   "Khyber Pakhtunkhwa", "Punjab", "Sindh"]}
    out, unmatched = {}, []
    cur_prov = None

    def num(v):
        return float(v) if isinstance(v, (int, float)) else 0.0

    for r in rows[1:]:
        if not r or r[0] is None:
            continue
        name = str(r[0]).strip()
        nn = _norm(name)
        if nn in provinces and nn not in ("islamabadcapitalterritory",):
            cur_prov = nn
            continue
        d = by_norm.get(nn) or (by_norm.get(_norm(ALIASES[nn])) if nn in ALIASES else None)
        if d is None:
            unmatched.append(name); continue
        rec = out.setdefault(d["pcode"], {"ext_km2": [0.0] * len(ext_cols), "exposed": [0.0] * len(pop_cols),
                                          "area_km2": 0.0, "pop": 0.0, "unosat_names": []})
        rec["ext_km2"] = [a + num(r[j]) for a, j in zip(rec["ext_km2"], ext_cols)]
        rec["exposed"] = [a + num(r[j]) for a, j in zip(rec["exposed"], pop_cols)]
        rec["area_km2"] += num(r[1]); rec["pop"] += num(r[2])
        rec["unosat_names"].append(name)
    for rec in out.values():
        rec["ext_km2"] = [round(v, 2) for v in rec["ext_km2"]]
        rec["exposed"] = [round(v) for v in rec["exposed"]]
        rec["area_km2"] = round(rec["area_km2"], 1); rec["pop"] = round(rec["pop"])
    nat = rows[1]
    national = {"ext_km2": [round(num(nat[j]), 1) for j in ext_cols], "exposed": [round(num(nat[j])) for j in pop_cols]}
    write_json(interim("flood_evolution"), {
        "vintage": INFO["vintage"], "periods": periods, "districts": out, "national": national,
        "unmatched": [u for u in unmatched if len(u) < 40], "corrections": corrections, "note": "periods[0] is the 1–31 Aug 2022 maximum; the rest are weekly windows",
    }, compact=False)
    print(len(out), "districts matched; unmatched:", unmatched)
    print("periods:", periods)
    print("national flooded km2:", national["ext_km2"])


if __name__ == "__main__":
    process()
