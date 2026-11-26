"""District Multidimensional Poverty Index (MPI value, headcount H %, intensity A %).

Primary: Ministry of Planning, Development & Special Initiatives / UNICEF / OPHI, "Multidimensional Poverty Index
Report 2019-20" (PSLM 2019-20), Appendix D "Multidimensional Poverty by District" (126 districts incl. Islamabad,
with the ex-FATA districts and the Karachi districts separately).
Fallback (flagged with year "2014-15"): Planning Commission / UNDP / OPHI "Multidimensional Poverty in Pakistan"
(2016), Statistical Annex district table (PSLM 2014-15) -- used only for COD districts absent from the 2019-20
table. COD districts split from a reported parent get the parent's value with "inherited_from" set.
Output: data/interim/mpi.json
"""
from __future__ import annotations

import os
import re
import subprocess

import pdfplumber

from pipeline.common import fetch, interim, raw_dir, read_json, write_json

ID = "mpi"
URL_2020 = "https://ophi.org.uk/sites/default/files/2025-01/Pakistan_MPI_2019%E2%80%9320_%282024%29.pdf"
URL_2015 = "https://pc.gov.pk/uploads/report/Multidimensional-Poverty-in-Pakistan.pdf"
# pc.gov.pk serves an incomplete TLS chain; we fetch the issuing intermediate from the certificate's AIA URL and
# add it to the system CA bundle so curl can still verify the chain to a trusted root.
AIA_URL = "http://crt.sectigo.com/GoGetSSLRSADVSSLCA2.crt"

INFO = {
    "id": ID,
    "title": "Multidimensional Poverty Index (MPI) by district",
    "publisher": "Ministry of Planning, Development & Special Initiatives (Planning Commission), with UNICEF/UNDP and OPHI",
    "vintage": "PSLM 2019-20 (MPI Report 2019-20, published 2024); fallback PSLM 2014-15 (report 2016)",
    "url": "https://ophi.org.uk/Publications/National-MPI/Pakistan-MPI-2019%E2%80%9320",
    "files_urls": [URL_2020, URL_2015],
    "license": "Government of Pakistan publication (cite MoPD&SI / OPHI)",
    "used_for": ["Poverty lens (MPI, headcount H, intensity A)", "City View prosperity row"],
    "caveats": ("Official national MPI (15 indicators; poor if deprived in >=1/3 weighted indicators). District "
                "estimates from PSLM samples have wide confidence intervals (e.g. Kohlu, Sherani). 2019-20 does not "
                "cover AJK, Gilgit-Baltistan or a few Balochistan districts; four of those use 2014-15 values "
                "(field year='2014-15') and are not strictly comparable. Districts split after the survey inherit "
                "the parent's value (inherited_from). H and A are percentages."),
}

# Name in the report -> COD-AB 2022 name. Identity matches (after normalisation) are automatic.
NAME_MAP = {
    # 2019-20 spellings
    "Bunair": "Buner", "Charsada": "Charsadda", "Tor Garh": "Tor Ghar",
    "Bhakhar": "Bhakkar", "D. G. Khan": "Dera Ghazi Khan", "Jehlum": "Jhelum", "Layyah": "Leiah",
    "Muzaffar Garh": "Muzaffargarh", "T.T. Singh": "Toba Tek Singh",
    "Karachi Central": "Central Karachi", "Karachi East": "East Karachi", "Karachi Malir": "Malir Karachi",
    "Karachi South": "South Karachi", "Karachi West": "West Karachi", "Korangi": "Korangi Karachi",
    "Mir Pur Khas": "Mirpur Khas", "Nowshero Feroze": "Naushahro Feroze", "Shahdadkot": "Kambar Shahdad Kot",
    "Shaheed Benazir Abad": "Shaheed Benazir Abad", "Tando Allah Yar": "Tando Allahyar",
    "Kachhi/ Bolan": "Kachhi", "Kech/Turbat": "Kech", "Nasirabad/ Tamboo": "Nasirabad",
    "Qilla Abdullah": "Killa Abdullah", "Qilla Saifullah": "Killa Saifullah", "Sibbi": "Sibi",
    "Shaheed Sikandar Abad": "Shaheed Sikandarabad",
}

# COD district -> reported parent it was split from after the survey (value copied, flagged).
INHERIT = {
    "Chitral Lower": "Chitral",          # Chitral split into Upper/Lower in 2018
    "Chitral Upper": "Chitral",
    "Kohistan Lower": "Kohistan",        # Kohistan split into Upper/Lower/Kolai-Palas in 2014-17
    "Kohistan Upper": "Kohistan",
    "Kolai Palas Kohistan": "Kohistan",
    "Chaman": "Qilla Abdullah",          # Chaman carved out of Killa Abdullah in 2021
    "Lehri": "Sibbi",                    # Lehri carved out of Sibi
}

# COD districts missing from 2019-20 for which the 2014-15 annex has an estimate.
FALLBACK_2015 = {"Chagai": "Chagai", "Jhal Magsi": "Jhal Magsi", "Musakhel": "Musakhel", "Zhob": "Zhob"}

PROV_HEADERS = {"KHYBER PAKHTUNKHWA": "Khyber Pakhtunkhwa", "PUNJAB": "Punjab", "SINDH": "Sindh",
                "BALOCHISTAN": "Balochistan"}
NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _pc_ca_bundle() -> str:
    der = fetch(ID, AIA_URL, "GoGetSSLRSADVSSLCA2.crt")
    out = raw_dir(ID) / "ca_bundle.pem"
    if not out.exists():
        pem = subprocess.run(["openssl", "x509", "-inform", "DER", "-in", str(der)], check=True,
                             capture_output=True, text=True).stdout
        system = next(p for p in ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt",
                                  "/etc/ssl/cert.pem") if os.path.exists(p))
        out.write_text(open(system).read() + "\n" + pem)
    return str(out)


def parse_2020(path) -> tuple[dict, dict]:
    """Appendix D (pdf pages 75-82, rotated). Returns ({name: row}, national_row)."""
    txt = subprocess.run(["pdftotext", "-layout", "-f", "75", "-l", "82", str(path), "-"], check=True,
                         capture_output=True, text=True).stdout
    rows, national, prov, pending = {}, None, None, None
    lines = txt.split("\n")
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            continue
        if s in PROV_HEADERS:
            prov = PROV_HEADERS[s]
            continue
        m = re.match(r"^([A-Za-z][A-Za-z.\-/ ]*?)\s{2,}(\d.*)$", s)
        nums_only = re.fullmatch(r"[\d.,\s]+", s)
        if m or nums_only:
            name = m.group(1).strip() if m else pending
            nums = [float(x.replace(",", "")) for x in NUM.findall(m.group(2) if m else s)]
            if len(nums) != 11 or name is None:
                continue
            if nums_only:  # wrapped name: "Shaheed Benazir" / numbers / "Abad"
                nxt = next((l.strip() for l in lines[i + 1:] if l.strip()), "")
                if re.fullmatch(r"[A-Za-z]+", nxt):
                    name = f"{name} {nxt}"
            pending = None
            rec = {"mpi": nums[0], "mpi_ci": [nums[1], nums[2]], "h": nums[3], "a": nums[6],
                   "pop_share_pct": nums[9], "poor_thousands": nums[10], "province": prov}
            if name == "National":
                national = rec
            else:
                rows[name] = rec
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z ]+", s) and prov and s not in ("Abad", "Khan"):
            pending = s
    return rows, national


def parse_2015(path) -> dict:
    """Statistical annex district table (pdf pages 44-45): MPI, H, A for 2004/05..2014/15. Each page is a
    two-page spread; the left half has name + 6 MPI + 2 H values, the right half the remaining 10 values."""
    out = {}
    with pdfplumber.open(path) as pdf:
        # National MPI / H / A (k=33%) table on pdf page 43: rows "2014/15 <value> <upper> <lower> <se>".
        vals = [l.split()[1] for l in pdf.pages[42].extract_text().split("\n") if l.startswith("2014/15")]
        if len(vals) == 3:
            out["__national__"] = {"mpi": float(vals[0]), "h": float(vals[1].rstrip("%")),
                                   "a": float(vals[2].rstrip("%"))}
        for pno in (43, 44):
            p = pdf.pages[pno]
            w, h = p.width, p.height
            left = [l for l in p.crop((0, 0, w / 2, h)).extract_text().split("\n") if re.match(r"^[A-Z].*\d", l)
                    and not l.startswith("Districts")]
            right = [l for l in p.crop((w / 2, 0, w, h)).extract_text().split("\n") if re.match(r"^[\d*-]", l)
                     and "/" not in l]
            right = [l for l in right if len(l.split()) == 10]
            left = [l for l in left if len(re.findall(r"\d\.\d{3}|\*|\d+\.\d%", l)) >= 8]
            if len(left) != len(right):
                raise ValueError(f"2014-15 annex page {pno}: {len(left)} names vs {len(right)} value rows")
            for l, r in zip(left, right):
                m = re.match(r"^(.*?)\s+((?:[\d.]+%?|\*)(?:\s+(?:[\d.]+%?|\*)){7})$", l)
                name, vals = m.group(1), m.group(2).split() + r.split()
                if len(vals) != 18:
                    raise ValueError(f"bad 2014-15 row {name}: {vals}")
                v = lambda x: None if x == "*" else float(x.rstrip("%"))
                out[name] = {"mpi": v(vals[5]), "h": v(vals[11]), "a": v(vals[17])}
    return out


def _check(name, r, tol=0.006):
    if r["mpi"] is not None and abs(r["mpi"] - r["h"] * r["a"] / 1e4) > tol:
        raise ValueError(f"MPI != H*A for {name}: {r}")


def process():
    frame = read_json(interim("districts"))["districts"]
    p20 = fetch(ID, URL_2020, "Pakistan_MPI_2019-20_2024.pdf")
    os.environ["CURL_CA_BUNDLE"] = _pc_ca_bundle()
    p15 = fetch(ID, URL_2015, "Multidimensional-Poverty-in-Pakistan.pdf")
    rows, national = parse_2020(p20)
    old = parse_2015(p15)
    for k, r in rows.items():
        _check(k, r)
    for k, r in old.items():
        _check(k, r)
    if national:
        _check("National", national)

    by_cod = {}
    for name, r in rows.items():
        cod = NAME_MAP.get(name, name)
        prov = "Islamabad" if name == "Islamabad" else r["province"]
        hit = [d for d in frame if _norm(d["name"]) == _norm(cod) and d["province"] == prov]
        if len(hit) == 1:
            by_cod[hit[0]["pcode"]] = (name, r)
        elif name not in ("Chitral", "Kohistan"):  # parents of split districts, used via INHERIT
            raise KeyError(f"unmapped MPI district {name} ({prov})")

    out = {}
    for d in frame:
        pc, nm = d["pcode"], d["name"]
        src = inh = None
        year = "2019-20"
        if pc in by_cod:
            src, r = by_cod[pc]
        elif nm in INHERIT and INHERIT[nm] in rows:
            src = inh = INHERIT[nm]
            r = rows[src]
        elif nm in FALLBACK_2015 and old.get(FALLBACK_2015[nm], {}).get("mpi") is not None:
            src, r, year = FALLBACK_2015[nm], old[FALLBACK_2015[nm]], "2014-15"
        else:
            continue
        out[pc] = {"mpi": r["mpi"], "h": round(r["h"], 2), "a": round(r["a"], 2), "source_name": src,
                   "inherited_from": inh, "year": year}
        if "mpi_ci" in r:
            out[pc]["mpi_ci"] = r["mpi_ci"]

    missing = [{"pcode": d["pcode"], "name": d["name"], "province": d["province"]} for d in frame
               if d["pcode"] not in out]
    res = {"vintage": INFO["vintage"], "districts": out,
           "national": {"mpi": national["mpi"], "h": national["h"], "a": national["a"],
                        "poor_thousands": national["poor_thousands"], "year": "2019-20",
                        "estimate_2014_15": old.get("__national__")}
           if national else None,
           "missing": missing}
    write_json(interim(ID), res)
    return res


if __name__ == "__main__":
    r = process()
    print(len(r["districts"]), "districts; national", r["national"])
    print("inherited:", {k: v["inherited_from"] for k, v in r["districts"].items() if v["inherited_from"]})
    print("2014-15 fallback:", [v["source_name"] for v in r["districts"].values() if v["year"] == "2014-15"])
    print("missing:", [m["name"] for m in r["missing"]])
