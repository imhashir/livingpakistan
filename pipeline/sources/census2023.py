"""PBS Population & Housing Census 2023: district tables 1, 5, 9, 11, 12 -> COD-AB 2022 districts.

Inputs: the official PBS per-province district PDFs (census_tables/tables/table_<n>_<province>_districts.pdf, Islamabad
as table_<n>_islamabad.pdf) plus table_<n>_national.pdf for cross-checks.
  * Table 1  : area, population (total / rural / urban), 2017 population, annual growth 2017-23, avg household size
  * Table 5  : selected age groups (under 15, 60+)                                   [detailed-characteristics basis]
  * Table 9  : religion                                                               [detailed-characteristics basis]
  * Table 11 : mother tongue                                                          [detailed-characteristics basis]
  * Table 12 : population 10+, literate 10+, by sex                                  [detailed-characteristics basis]
PBS note on Table 1: it includes head-count-only population from restricted areas; Tables 4+ cover only the population
with full questionnaires, so religion/language/age/literacy totals are ~0.4 % below Table 1 nationally. We keep the
Table 4+ total as `pop_detailed` so shares can use a consistent denominator.

Census districts are summed into the frozen COD-AB 2022 district frame (data/interim/districts.json); ratios are
recomputed from summed counts. Where a COD district corresponds to census sub-divisions (Lehri = Lehri SD of Sibi +
Bhag SD of Kachhi) we use the published sub-division rows and derive the remainder by exact subtraction of counts.
Output: data/interim/census2023.json
"""
from __future__ import annotations

import re
import sys

from pipeline.common import fetch, interim, read_json, write_json

ID = "census2023"
BASE = "https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/"
PROVINCES = {  # file stem -> province name in the COD frame
    "punjab_districts": "Punjab",
    "sindh_districts": "Sindh",
    "kp_districts": "Khyber Pakhtunkhwa",
    "balochistan_districts": "Balochistan",
    "islamabad": "Islamabad",
}
TABLES = (1, 5, 9, 11, 12)
LANDING = "https://www.pbs.gov.pk/census/"  # PBS census landing page (Census 2023 results and tables)
LIST_URL = ("https://www.pbs.gov.pk/wp-content/uploads/2020/07/"
            "LIST-OF-STATICTICAL-TABLES-OF-POPULATION-AND-HOUSEING-CENSUS-2023.pdf")
VINTAGE = "Census 2023 (reference date 1 Mar 2023)"


def _files() -> list[str]:
    return [f"table_{t}_{p}.pdf" for t in TABLES for p in list(PROVINCES) + ["national"]]


INFO = {
    "id": ID,
    "title": "7th Population & Housing Census 2023: district population, growth, religion, mother tongue, literacy",
    "publisher": "Pakistan Bureau of Statistics",
    "vintage": VINTAGE,
    "url": LANDING,
    "files_urls": [BASE + f for f in _files()] + [LIST_URL],
    "license": "Public government statistics",
    "used_for": ["Population / density / urbanisation lens", "Population growth 2017-2023",
                 "Religion and mother-tongue composition", "Literacy (10+) by sex", "Age structure (under 15, 60+)"],
    "caveats": ("First digital census (field work Mar-May 2023, reference date 1 Mar 2023). Table 1 population "
                "includes head-count-only restricted areas; religion, language, age and literacy (Tables 5-12) cover "
                "only fully enumerated population, ~0.4% less nationally, so their totals differ slightly from Table 1. "
                "Census 2023 districts are summed onto the COD-AB 2022 frame: Keamari is merged into West Karachi "
                "(Karachi district boundaries were redrawn after 2018, so the Karachi split is approximate); "
                "Surab = Shaheed Sikandarabad; Lehri = Lehri sub-division (Sibi) + Bhag sub-division (Kachhi), with "
                "Sibi and Kachhi reduced accordingly. Growth for merged/derived districts is recomputed from summed "
                "2017 and 2023 counts. Household counts are not published in these tables (only average size). "
                "No PBS Census 2023 district tables for Azad Kashmir or Gilgit-Baltistan (left null)."),
}

# ----------------------------------------------------------------------------------------------- crosswalk
# Census 2023 district name (letters only, upper-case, without the trailing "DISTRICT") -> COD-AB pcode, for names
# that do not match the COD name after the same normalisation. Everything else is matched by normalised name.
NAME_XWALK = {
    # Punjab
    "LAYYAH": "PK618",              # COD spelling "Leiah"
    # Khyber Pakhtunkhwa
    "DERAISMAILKHAN": "PK509",      # COD "D. I. Khan"
    "LOWERCHITRAL": "PK507",        # COD "Chitral Lower"
    "UPPERCHITRAL": "PK508",        # COD "Chitral Upper"
    "LOWERKOHISTAN": "PK515",       # COD "Kohistan Lower"
    "UPPERKOHISTAN": "PK516",       # COD "Kohistan Upper"
    # Sindh (Karachi districts are named "Karachi X" by PBS, "X Karachi" by COD)
    "KARACHICENTRAL": "PK702",
    "KARACHIEAST": "PK704",
    "KARACHISOUTH": "PK721",
    "KARACHIWEST": "PK729",
    "KEAMARI": "PK729",             # split from West Karachi in 2020; COD 2022 frame still has it inside West Karachi
    "KORANGI": "PK712",
    "MALIR": "PK714",
    # Balochistan
    "SURAB": "PK233",               # COD "Shaheed Sikandarabad" (district HQ / sole tehsil: Surab)
    "SIBI": "PK228",                # minus Lehri sub-division, see SUB_MOVES
    "KACHHI": "PK209",              # minus Bhag sub-division, see SUB_MOVES
    # Islamabad
    "ISLAMABAD": "PK401",
    "ISLAMABADCAPITALTERRITORY": "PK401",
}
# Spelling / labelling differences between PBS tables of the same province (normalised entity name -> district key).
DISTRICT_ALIASES = {
    "MALAKANDPROTECTEDAREA": "MALAKAND",   # Tables 5-12 label Malakand district as "MALAKAND PROTECTED AREA"
    "TANDOAHYAR": "TANDOALLAHYAR",         # PBS typo in Sindh Table 1
}
# (census district, census sub-division) moved wholesale to another COD district. COD-AB admin3 puts tehsils Bhag
# and Lehri in Lehri district (PK218); PBS lists Lehri under Sibi and Bhag under Kachhi. Counts are moved exactly
# (sub-division rows are published in every table used here), never estimated.
SUB_MOVES = [
    ("SIBI", "LEHRISUBDIVISION", "PK218"),
    ("KACHHI", "BHAGSUBDIVISION", "PK218"),
]
CROSSWALK_NOTES = [
    "Keamari (Census 2023 district, carved from West Karachi in 2020) is summed into COD West Karachi (PK729). "
    "Karachi district boundaries in Census 2023 (e.g. Manghopir in Karachi West, Gadap in Malir) do not match the "
    "2018-era COD towns exactly; Karachi district values are best read together.",
    "Surab district (Census 2023) = Shaheed Sikandarabad (PK233) in COD.",
    "Lehri (PK218) = Lehri sub-division (published under Sibi) + Bhag sub-division (published under Kachhi); "
    "Sibi (PK228) and Kachhi (PK209) are the census districts minus those sub-divisions (exact count subtraction).",
    "Lasbela includes Hub sub-division and Jaffarabad includes Usta Muhammad, matching the COD 2022 frame.",
    "Tando Allahyar appears as 'TANDO AHYAR' in the PBS Sindh tables.",
    "Azad Kashmir and Gilgit-Baltistan are not covered by PBS Census 2023 district tables (left null).",
]

# ----------------------------------------------------------------------------------------------- column layouts
T1_DIST = ["area", "pop", "male", "female", "trans", "sex_ratio", "density", "urban_pct", "hh_size", "pop_2017",
           "growth"]
T1_RU = ["pop", "male", "female", "trans", "sex_ratio", "hh_size", "pop_2017", "growth"]
RELIGION = ["total", "muslim", "christian", "hindu", "ahmadi", "scheduled_castes", "sikh", "parsi", "others"]
RELIGION_HDR = ["MUSLIM", "CHRISTIAN", "HINDU", "QADIANI", "SCHEDULED", "SIKH", "PARSI", "OTHERS"]
LANG_HDR = ["TOTAL", "URDU", "PUNJABI", "SINDHI", "PUSHTO", "BALOCHI", "KASHMIRI", "SARAIKI", "HINDKO", "BRAHVI",
            "SHINA", "BALTI", "MEWATI", "KALASHA", "KOHIOSTANI", "OTHERS"]
LANG_KEYS = {"PUSHTO": "pashto", "BRAHVI": "brahui", "KOHIOSTANI": "kohistani"}
T12 = ["total", "male", "female", "trans"]  # first block (all areas) of 12 columns
T5 = ["total", "male", "female", "trans"]

NUM_RE = re.compile(r"^-?\d[\d,]*(\.\d+)?$")
SECTIONS = {"ALLLOCALITIES", "RURAL", "URBAN"}
SUFFIXES = {"DISTRICT", "TEHSIL", "TALUKA", "SUBDIVISION", "DIVISION"}
PROVINCE_ROWS = {"PAKISTAN", "PUNJAB", "SINDH", "KHYBERPAKHTUNKHWA", "BALOCHISTAN", "ISLAMABAD"}


def pretty(raw: str) -> str:
    """'KARACHI WEST DISTRICT' -> 'Karachi West'; 'LEHRI SUB-DIVISION' -> 'Lehri sub-division'."""
    s = re.sub(r"\s+", " ", raw).strip()
    s = re.sub(r"\s*DISTRICT$", "", s, flags=re.I)
    s = s.title().replace("Sub-Division", "sub-division")
    return s


def norm(s: str) -> str:
    return re.sub(r"[^A-Z]", "", s.upper())


def lnorm(s: str) -> str:
    """Row-label normalisation (keeps digits and comparison signs: 'UNDER 15', 'Population >=10')."""
    return re.sub(r"[^A-Z0-9>=%]", "", s.upper())


def is_num(t: str) -> bool:
    return t == "-" or bool(NUM_RE.match(t))


def num(t: str):
    if t == "-":
        return None
    return float(t.replace(",", "")) if "." in t else int(t.replace(",", ""))


def count(t: str) -> int:
    v = num(t)
    return 0 if v is None else int(v)  # PBS prints "-" for nil counts


# ----------------------------------------------------------------------------------------------- PDF -> lines

def pdf_lines(path) -> list[tuple[int, list[str]]]:
    """Words grouped into lines; words that touch (PBS PDFs split digits into separate text runs) are merged."""
    import pdfplumber
    out = []
    with pdfplumber.open(path) as pdf:
        for pi, pg in enumerate(pdf.pages):
            ws = pg.extract_words(x_tolerance=1.5, y_tolerance=2)
            ws.sort(key=lambda w: (round(w["top"]), w["x0"]))
            lines: list[list[dict]] = []
            for w in ws:
                if lines and abs(lines[-1][0]["top"] - w["top"]) < 2.5:
                    lines[-1].append(w)
                else:
                    lines.append([w])
            for ln in lines:
                ln.sort(key=lambda w: w["x0"])
                toks: list[list] = []
                for w in ln:
                    gap = w["x0"] - toks[-1][1] if toks else 99
                    if gap < 1.5:
                        # keep a space between words of a name; digits split into runs are glued back together
                        glue = " " if gap > 0.3 and not (toks[-1][0][-1:].isdigit() or w["text"][:1] in "0123456789,.") \
                            else ""
                        toks[-1][0] += glue + w["text"]
                        toks[-1][1] = w["x1"]
                    else:
                        toks.append([w["text"], w["x1"]])
                out.append((pi, [t[0] for t in toks]))
    return out


def _is_colnum_line(toks: list[str]) -> bool:
    return len(toks) >= 8 and all(t.isdigit() for t in toks) and [int(t) for t in toks[:3]] == [1, 2, 3]


def _split(toks: list[str]) -> tuple[list[str], list[str]]:
    k = 0
    while k < len(toks) and is_num(toks[-1 - k]):
        k += 1
    return toks[: len(toks) - k], toks[len(toks) - k:]


class Entity:
    def __init__(self, name: str):
        self.raw = name
        self.name = norm(name)
        self.rows: dict[str, list[str]] = {}
        self.kind = ("district" if self.name.endswith("DISTRICT") else
                     "province" if self.name in PROVINCE_ROWS or self.name == "ISLAMABADCAPITALTERRITORY" else "sub")
        self.base = self.name[:-8] if self.kind == "district" else self.name
        if self.name in DISTRICT_ALIASES:
            self.kind, self.base = "district", DISTRICT_ALIASES[self.name]
        elif self.base in DISTRICT_ALIASES and self.kind == "district":
            self.base = DISTRICT_ALIASES[self.base]
        self.parent: str | None = None

    def __repr__(self):
        return f"<{self.kind} {self.name} {list(self.rows)}>"


def parse(path, ncols: int, min_cols: int | None = None, header_check=None) -> list[Entity]:
    """Table 1 style parser: each area is one line (name + `ncols` numbers) followed by RURAL / URBAN lines with
    `min_cols` numbers. Long names wrap: text line above a nameless number line, suffix ("DISTRICT") below."""
    min_cols = min_cols or ncols
    lines = pdf_lines(path)
    ents: list[Entity] = []
    cur: Entity | None = None
    district: str | None = None
    buf: list[str] = []
    section = ""
    in_body = False
    page = -1
    header_seen: list[list[str]] = []
    i = 0
    while i < len(lines):
        pi, toks = lines[i]
        i += 1
        if pi != page:
            page, in_body = pi, False
            header_seen = []
        if not in_body:
            if _is_colnum_line(toks):
                in_body = True
                if header_check:
                    header_check(header_seen, path)
                continue
            if not (_split(toks)[0] and len(_split(toks)[1]) >= min_cols):  # pages without a column-number line
                header_seen.append(toks)
                continue
            in_body = True
        if toks and toks[0].startswith("*"):
            continue
        label, nums = _split(toks)
        if len(nums) < min_cols:  # text-only line (numbers inside names like "UNDER 15" are rare; see below)
            t = norm(" ".join(toks))
            if t in SECTIONS:
                section = t
            elif t:
                buf.append(" ".join(toks))
            continue
        if len(nums) > ncols:
            label, nums = label + nums[: len(nums) - ncols], nums[len(nums) - ncols:]
        lab = norm(" ".join(label))
        new_name = None
        # entity rows carry ncols numbers, RURAL/URBAN rows carry min_cols
        if lab in ("RURAL", "URBAN") and len(nums) == min_cols:
            if cur is not None and lab not in cur.rows:
                cur.rows[lab] = nums
            buf = []
            continue
        if len(nums) != ncols:
            raise ValueError(f"{path.name}: unexpected row {toks}")
        if lab:
            new_name = " ".join(label)
        else:  # wrapped name: text line(s) above + suffix line below
            new_name = " ".join(buf)
            if i < len(lines) and lines[i][0] == pi:
                nl, nn = _split(lines[i][1])
                if not nn and norm(" ".join(nl)) in SUFFIXES or (nl and new_name.endswith("-")):
                    new_name += " " + " ".join(nl)
                    i += 1
        buf = []
        cur = Entity(new_name)
        cur.rows["_"] = nums
        if cur.kind == "district":
            district = cur.base
        elif cur.kind == "sub":
            cur.parent = district
        ents.append(cur)
    return ents


def parse_blocks(path, ncols: int, header_check=None) -> list[Entity]:
    """Block-style tables (5, 9, 11, 12): returns entities in order, with sub-units linked to their district."""
    lines = pdf_lines(path)
    ents: list[Entity] = []
    cur: Entity | None = None
    district = None
    buf: list[str] = []
    section = "ALLLOCALITIES"
    in_body, page, hdr = False, -1, []
    for pi, toks in lines:
        if pi != page:
            page, in_body, hdr = pi, False, []
        if not in_body:
            if _is_colnum_line(toks):
                in_body = True
                if header_check:
                    header_check(hdr, path)
            else:
                hdr.append(toks)
            continue
        if not toks or toks[0].startswith("*"):
            continue
        label, nums = _split(toks)
        if len(nums) < ncols:
            t = norm(" ".join(toks))
            if t in SECTIONS:
                section = t
            elif t:
                buf.append(" ".join(toks))
            continue
        if len(nums) > ncols:
            label, nums = label + nums[: len(nums) - ncols], nums[len(nums) - ncols:]
        if buf:
            cur = Entity(" ".join(buf))
            buf, section = [], "ALLLOCALITIES"
            if cur.kind == "district":
                district = cur.base
            elif cur.kind == "sub":
                cur.parent = district
            ents.append(cur)
        if cur is None:
            raise ValueError(f"{path.name}: data before any area name: {toks}")
        cur.rows.setdefault(section + ":" + lnorm(" ".join(label)), nums)
    return ents


def parse_t1(path) -> list[Entity]:
    ents = parse(path, ncols=len(T1_DIST), min_cols=len(T1_RU))
    return ents


# ----------------------------------------------------------------------------------------------- header checks

def _hdr_words(hdr) -> list[str]:
    return [norm(t) for toks in hdr for t in toks if norm(t)]


def check_religion_hdr(hdr, path):
    w = _hdr_words(hdr)
    for h in RELIGION_HDR:  # presence only (multi-line header); column order is sanity-checked numerically
        if not any(x.startswith(h) for x in w):
            raise ValueError(f"{path.name}: religion header {h} missing: {w}")


def check_lang_hdr(hdr, path):
    w = _hdr_words(hdr)
    seq = [x for x in w if x in LANG_HDR]
    if seq[: len(LANG_HDR)] != LANG_HDR:
        raise ValueError(f"{path.name}: unexpected mother-tongue header {seq}")


# ----------------------------------------------------------------------------------------------- per-table extraction

def by_district(ents: list[Entity]) -> tuple[dict, dict, dict]:
    """-> (districts{base: Entity}, subs{(district, subname): Entity}, provinces{name: Entity})"""
    d, s, p = {}, {}, {}
    for e in ents:
        if e.kind == "district":
            if e.base in d:
                raise ValueError(f"duplicate district {e.name}")
            d[e.base] = e
        elif e.kind == "sub":
            s.setdefault((e.parent, e.name), e)
        else:
            p.setdefault("ISLAMABAD" if e.name.startswith("ISLAMABAD") else e.name, e)
    return d, s, p


def t1_values(e: Entity) -> dict:
    r = dict(zip(T1_DIST, e.rows["_"]))
    rur = dict(zip(T1_RU, e.rows["RURAL"])) if "RURAL" in e.rows else {"pop": "-"}
    urb = dict(zip(T1_RU, e.rows["URBAN"])) if "URBAN" in e.rows else {"pop": "-"}
    v = {"pop": count(r["pop"]), "pop_male": count(r["male"]), "pop_female": count(r["female"]),
         "pop_trans": count(r["trans"]), "pop_rural": count(rur["pop"]), "pop_urban": count(urb["pop"]),
         "pop_2017": count(r["pop_2017"]), "area_km2_pbs": num(r["area"]),
         "_growth": num(r["growth"]), "_hh_size": num(r["hh_size"]), "_density": num(r["density"])}
    if "RURAL" not in e.rows and "URBAN" not in e.rows:
        raise ValueError(f"no rural/urban rows for {e.name}")
    return v


def block_row(e: Entity, *labels) -> list[str]:
    for lab in labels:
        if lab in e.rows:
            return e.rows[lab]
    raise KeyError(f"{e.name}: none of {labels} in {list(e.rows)[:8]}")


def t9_values(e: Entity) -> dict:
    row = dict(zip(RELIGION, block_row(e, "ALLLOCALITIES:ALLSEXES")))
    return {"pop_detailed": count(row["total"]), "religion": {k: count(row[k]) for k in RELIGION[1:]}}


def t11_values(e: Entity) -> dict:
    row = dict(zip(LANG_HDR, block_row(e, "ALLLOCALITIES:ALLSEXES")))
    return {"_lang_total": count(row["TOTAL"]),
            "language": {LANG_KEYS.get(k, k.lower()): count(row[k]) for k in LANG_HDR[1:]}}


def t12_values(e: Entity) -> dict:
    p10 = dict(zip(T12, block_row(e, "ALLLOCALITIES:POPULATION>=10")))
    lit = dict(zip(T12, block_row(e, "ALLLOCALITIES:LITERATE>=10")))
    return {"pop10": count(p10["total"]), "pop10_male": count(p10["male"]), "pop10_female": count(p10["female"]),
            "literate": count(lit["total"]), "literate_male": count(lit["male"]),
            "literate_female": count(lit["female"]), "_lit_pct": num(block_row(e, "ALLLOCALITIES:LITERATE%")[0])}


def t5_values(e: Entity) -> dict:
    allr = dict(zip(T5, block_row(e, "ALLLOCALITIES:ALLAGES")))
    u15 = dict(zip(T5, block_row(e, "ALLLOCALITIES:UNDER15")))
    s60 = dict(zip(T5, block_row(e, "ALLLOCALITIES:60ABOVE")))
    return {"_age_total": count(allr["total"]), "pop_under15": count(u15["total"]), "pop_60plus": count(s60["total"])}


# ----------------------------------------------------------------------------------------------- aggregation

def add(a: dict, b: dict, sign: int = 1) -> dict:
    out = dict(a)
    for k, v in b.items():
        if k.startswith("_") or v is None:
            continue
        if isinstance(v, dict):
            out[k] = add(out.get(k, {}), v, sign)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = out.get(k, 0) + sign * v
    return out


def growth_rate(p23: int, p17: int, years: float) -> float | None:
    if not p17 or not p23:
        return None
    return 100.0 * ((p23 / p17) ** (1.0 / years) - 1.0)


def finish(v: dict, years: float) -> dict:
    """Ratios from counts."""
    r = lambda a, b, nd=2: round(100.0 * a / b, nd) if b else None  # noqa: E731
    out = {
        "pop": v.get("pop"), "pop_urban": v.get("pop_urban"), "pop_rural": v.get("pop_rural"),
        "pop_male": v.get("pop_male"), "pop_female": v.get("pop_female"), "pop_trans": v.get("pop_trans"),
        "households": None, "hh_size": v.get("hh_size"),
        "pop_2017": v.get("pop_2017"),
        "growth": v.get("growth") if "growth" in v else (
            round(growth_rate(v["pop"], v["pop_2017"], years), 2) if v.get("pop_2017") else None),
        "urban_pct": r(v.get("pop_urban", 0), v.get("pop")),
        "area_km2_pbs": v.get("area_km2_pbs"),
        "pop_detailed": v.get("pop_detailed"),
        "religion": v.get("religion"),
        "language": v.get("language"),
        "pop10": v.get("pop10"), "literate": v.get("literate"),
        "literacy": r(v.get("literate", 0), v.get("pop10")),
        "literacy_male": r(v.get("literate_male", 0), v.get("pop10_male")),
        "literacy_female": r(v.get("literate_female", 0), v.get("pop10_female")),
        "pop_under15": v.get("pop_under15"), "pop_60plus": v.get("pop_60plus"),
        "under15_pct": r(v.get("pop_under15", 0), v.get("_age_total") or v.get("age_total")),
    }
    if v.get("area_km2_pbs") and v.get("pop"):
        out["density"] = round(v["pop"] / v["area_km2_pbs"], 2)
    return out


# ----------------------------------------------------------------------------------------------- main

def main() -> dict:
    raw = {f: fetch(ID, BASE + f, f) for f in _files()}
    frame = read_json(interim("districts"))
    cod = {d["pcode"]: d for d in frame["districts"]}
    cod_by_name = {norm(d["name"]): d["pcode"] for d in frame["districts"]}

    def pcode_for(base: str) -> str:
        pc = NAME_XWALK.get(base) or cod_by_name.get(base)
        if not pc:
            raise ValueError(f"census district {base!r} not in crosswalk")
        return pc

    checks: list[tuple[str, bool, str]] = []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    # ---- parse every province file of every table into {census district base: values}
    extract = {1: (parse_t1, t1_values), 5: (lambda p: parse_blocks(p, 12), t5_values),
               9: (lambda p: parse_blocks(p, len(RELIGION), check_religion_hdr), t9_values),
               11: (lambda p: parse_blocks(p, len(LANG_HDR), check_lang_hdr), t11_values),
               12: (lambda p: parse_blocks(p, 12), t12_values)}
    census: dict[str, dict] = {}       # base -> merged values from all tables
    census_prov: dict[str, str] = {}
    subs: dict[tuple[str, str], dict] = {}
    prov_tot: dict[tuple[int, str], dict] = {}
    census_raw: dict = {}
    for t, (parser, getv) in extract.items():
        for stem, prov in PROVINCES.items():
            ents = parser(raw[f"table_{t}_{stem}.pdf"])
            d, s, p = by_district(ents)
            if stem == "islamabad" and not d:  # Table 5 labels the single ICT block "ISLAMABAD CAPITAL TERRITORY"
                d = {"ISLAMABAD": p.pop("ISLAMABAD")}
            for base, e in d.items():
                census.setdefault(base, {}).update(getv(e))
                census_prov[base] = prov
                if t == 1:
                    census_raw[base] = pretty(e.raw)
            for (par, sname), e in s.items():
                if any(par == a and sname == b for a, b, _ in SUB_MOVES):
                    subs.setdefault((par, sname), {}).update(getv(e))
                    if t == 1:
                        census_raw[(par, sname)] = pretty(e.raw)
            for pname, e in p.items():
                if stem != "islamabad":
                    prov_tot[(t, pname)] = getv(e)
            check(f"T{t} {prov}: districts parsed", len(d) > 0, f"{len(d)}")
        nat = by_district(parser(raw[f"table_{t}_national.pdf"]))[2]
        for pname, e in nat.items():
            prov_tot[(t, "NAT:" + pname)] = getv(e)

    # ---- every census district must have all tables
    need = {"pop", "pop_detailed", "language", "pop10", "pop_under15"}
    for base, v in census.items():
        miss = need - set(v)
        check(f"{base}: present in all tables", not miss, ",".join(sorted(miss)))

    # ---- province sums vs the province rows printed in the same files / national file
    def psum(key_fn, prov):
        return sum(key_fn(v) for b, v in census.items() if census_prov[b] == prov)

    prov_norm = {"Punjab": "PUNJAB", "Sindh": "SINDH", "Khyber Pakhtunkhwa": "KHYBERPAKHTUNKHWA",
                 "Balochistan": "BALOCHISTAN", "Islamabad": "ISLAMABAD"}
    for prov, pn in prov_norm.items():
        for t, fn, key in ((1, lambda v: v["pop"], "pop"), (9, lambda v: v["pop_detailed"], "pop_detailed"),
                           (11, lambda v: v["_lang_total"], "_lang_total"), (12, lambda v: v["pop10"], "pop10"),
                           (5, lambda v: v["pop_under15"], "pop_under15")):
            ref = prov_tot.get((t, "NAT:" + pn)) or prov_tot.get((t, pn))
            if ref is None:  # Table 5 national file only prints Pakistan; checked at national level below
                check(f"T{t} {prov}: province total available", t == 5)
                continue
            got = psum(fn, prov)
            check(f"T{t} {prov}: sum of districts == PBS province total ({key})", got == ref[key],
                  f"{got:,} vs {ref[key]:,}")

    # ---- growth formula. PBS does not state the exact intercensal period it uses; the compound-rate period is
    # fitted to the published district rates (all 1:1 districts) and only used for merged / derived districts.
    gv = [(v["pop"], v["pop_2017"], v["_growth"]) for v in census.values()
          if v.get("_growth") is not None and v["pop_2017"]]

    def max_err(y):
        return max(abs(round(growth_rate(p, p17, y), 2) - g) for p, p17, g in gv)

    years = min((5.9 + i / 1000 for i in range(201)), key=lambda y: (round(max_err(y), 4), abs(y - 6.0)))
    check(f"growth formula (compound, {years:.3f} yr) reproduces PBS district rates within 0.01 pp",
          max_err(years) <= 0.0101, f"max err {max_err(years):.3f} over {len(gv)} districts")

    # ---- religion / language column order sanity: Muslim is the largest religion everywhere
    check("religion: column parse sane (muslim largest in every district)",
          all(max(v["religion"], key=v["religion"].get) == "muslim" for v in census.values()))
    for base, v in census.items():
        rs, ls = sum(v["religion"].values()), sum(v["language"].values())
        if rs != v["pop_detailed"] or ls != v["_lang_total"] or v["_lang_total"] != v["pop_detailed"]:
            check(f"{base}: religion/language columns sum to table total", False,
                  f"rel {rs:,} lang {ls:,} total {v['pop_detailed']:,}/{v['_lang_total']:,}")

    # ---- assemble COD districts
    acc: dict[str, dict] = {}
    members: dict[str, list[str]] = {}
    for base, v in census.items():
        pc = pcode_for(base)
        if cod[pc]["province"] != census_prov[base]:
            raise ValueError(f"{base} -> {pc} crosses provinces")
        acc[pc] = add(acc.get(pc, {}), v)
        acc[pc]["age_total"] = acc[pc].get("age_total", 0) + v["_age_total"]
        members.setdefault(pc, []).append(census_raw[base])
        if len([b for b in census if pcode_for(b) == pc]) == 1:  # 1:1 -> keep PBS-published rates as-is
            acc[pc]["growth"] = v["_growth"]
            acc[pc]["hh_size"] = v["_hh_size"]
    for par, sname, dest in SUB_MOVES:
        sv = subs.get((par, sname))
        if not sv or not need <= set(sv):
            raise ValueError(f"sub-division {sname} of {par} missing in some table: {sv and list(sv)}")
        src = pcode_for(par)
        acc[src] = add(acc[src], sv, -1)
        acc[src]["age_total"] -= sv["_age_total"]
        acc[dest] = add(acc.get(dest, {}), sv)
        acc[dest]["age_total"] = acc[dest].get("age_total", 0) + sv["_age_total"]
        for pc in (src, dest):
            acc[pc].pop("growth", None)
            acc[pc].pop("hh_size", None)
        members[src] = [m if m != census_raw[par] else f"{m} (excl. {census_raw[(par, sname)]})" for m in members[src]]
        members.setdefault(dest, []).append(f"{census_raw[(par, sname)]} (of {census_raw[par]})")
    for pc, v in acc.items():
        if len(members[pc]) > 1:
            v.pop("growth", None)
            v.pop("hh_size", None)

    districts = {}
    for pc in sorted(acc):
        out = finish(acc[pc], years)
        out["census_districts"] = members[pc]
        districts[pc] = out
    covered_prov = set(PROVINCES.values())
    missing = sorted(pc for pc, d in cod.items() if pc not in districts)
    missing_unexpected = [pc for pc in missing if cod[pc]["province"] in covered_prov]
    check("every COD district in PBS-covered provinces has data", not missing_unexpected, ",".join(missing_unexpected))

    # ---- national
    nat_acc: dict = {}
    for v in acc.values():
        nat_acc = add(nat_acc, {k: x for k, x in v.items() if k not in ("growth", "hh_size")})
    national = finish(nat_acc, years)
    n1 = prov_tot[(1, "NAT:PAKISTAN")]
    check("national pop == PBS 241,499,431", national["pop"] == 241_499_431, f"{national['pop']:,}")
    check("national pop == table_1_national PAKISTAN row", national["pop"] == n1["pop"], f"{n1['pop']:,}")
    check("national urban+rural == pop", national["pop_urban"] + national["pop_rural"] == national["pop"])
    for t, key in ((9, "pop_detailed"), (11, "_lang_total"), (12, "pop10"), (12, "literate"), (5, "pop_under15")):
        ref = prov_tot.get((t, "NAT:PAKISTAN"))
        got = sum(national["language"].values()) if key == "_lang_total" else national.get(key)
        check(f"T{t} national {key} == PBS national row", ref and got == ref[key],
              f"{got:,} vs {ref[key]:,}" if ref else "no national row")
    national["growth_pbs"] = n1["_growth"]
    rel, lang = sum(national["religion"].values()), sum(national["language"].values())
    check("religion sum within 0.5% of pop", abs(rel - national["pop"]) / national["pop"] < 0.005,
          f"{rel:,} = {100 * rel / national['pop']:.2f}% of pop")
    check("language sum within 0.5% of pop", abs(lang - national["pop"]) / national["pop"] < 0.005,
          f"{lang:,} = {100 * lang / national['pop']:.2f}% of pop")
    worst = max(districts.items(), key=lambda kv: abs(sum(kv[1]["religion"].values()) - kv[1]["pop"]) / kv[1]["pop"])
    w = worst[1]
    check("(info) district with largest Table1 vs detailed-tables gap", True,
          f"{worst[0]} {cod[worst[0]]['name']}: detailed {w['pop_detailed']:,} vs pop {w['pop']:,} "
          f"({100 * (w['pop_detailed'] - w['pop']) / w['pop']:+.1f}%)")
    for pc, d in districts.items():
        for k in ("pop", "pop_urban", "pop_rural", "pop_detailed", "pop10", "literate"):
            if d[k] is None or d[k] < 0:
                check(f"{pc}: {k} non-negative", False, str(d[k]))
        if d["pop_urban"] + d["pop_rural"] != d["pop"]:
            check(f"{pc}: urban+rural == pop", False, f"{d['pop_urban']}+{d['pop_rural']} vs {d['pop']}")

    out = {
        "vintage": VINTAGE,
        "files": sorted(raw),
        "notes": ("pop/pop_urban/pop_rural/pop_2017/growth from Table 1 (all population incl. head-count-only areas). "
                  "religion, language, literacy, pop10, age from Tables 5/9/11/12, whose total is pop_detailed "
                  "(fully enumerated population); use pop_detailed as the denominator for religion/language shares. "
                  "growth = PBS published % per year for 1:1 districts, else recomputed as compound annual rate over "
                  f"{years:.4f} years (15 Mar 2017 -> 1 Mar 2023), which reproduces PBS rates. households: not "
                  "published in these tables (null); hh_size = PBS average household size for 1:1 districts."),
        "districts": districts,
        "national": national,
        "crosswalk_notes": CROSSWALK_NOTES,
        "missing": missing,
    }
    write_json(interim(ID), out)

    # ---- report
    bad = [c for c in checks if not c[1]]
    print(f"census2023: {len(districts)} COD districts with data, {len(missing)} without ({', '.join(missing)})")
    for name, ok, det in checks:
        if not ok or name.startswith(("national", "religion", "language", "growth", "(info)", "every", "T1 ")):
            print(f"  [{'ok' if ok else 'FAIL'}] {name} {det}")
    print(f"  national: pop {national['pop']:,}  urban {national['urban_pct']}%  literacy {national['literacy']}% "
          f"(M {national['literacy_male']} / F {national['literacy_female']})  growth(recomputed) {national['growth']} "
          f"PBS {national['growth_pbs']}")
    print(f"  merged: {[(pc, m) for pc, m in members.items() if len(m) > 1 or '(' in m[0]]}")
    print(f"  {len(checks) - len(bad)}/{len(checks)} checks passed")
    if bad:
        print("  FAILED:", *[f"{n} {d}" for n, _, d in bad], sep="\n    ")
        sys.exit(1)
    return out


if __name__ == "__main__":
    main()
