"""Almanac catalogue: every source module's INFO + the provenance of the raw files actually downloaded
(data/raw/<id>/manifest.json: url, bytes, sha256, retrieval date) → web/public/data/sources.json."""
from __future__ import annotations

import importlib
import pkgutil

import pipeline.sources as S
from pipeline.common import RAW, WEB_DATA, read_json, write_json

# raw-dir ids that differ from INFO ids
RAW_ALIASES = {"copernicus_dem": "copernicus_dem", "esa_worldcover": "esa_worldcover"}

EXTRA = [
    {"id": "worldpop", "title": "WorldPop Global2 population 2025, Pakistan, constrained 1 km (R2025A v1)",
     "publisher": "WorldPop, University of Southampton", "vintage": "2025 (R2025A, alpha release)",
     "url": "https://hub.worldpop.org/", "license": "CC BY 4.0",
     "used_for": ["Spreading each district's Census 2023 population across its hexes", "AJK & GB population (no census tables)"],
     "caveats": "Modelled gridded population. For the 136 districts with Census 2023 tables, hex values are rescaled so each "
                "district sums to its census total; AJK and Gilgit-Baltistan show WorldPop 2025 directly."},
    {"id": "natural_earth", "title": "Natural Earth 1:10m land, lakes and countries (v5.1)", "publisher": "Natural Earth",
     "vintage": "v5.1.x", "url": "https://www.naturalearthdata.com/", "license": "Public domain",
     "used_for": ["Coastline / sea mask", "Neighbouring countries (fog of war)", "Lakes"],
     "caveats": "1:10m generalisation; Pakistan's own outline comes from COD-AB."},
    {"id": "cod_ab", "title": "Pakistan subnational administrative boundaries (COD-AB)", "publisher": "OCHA / HDX",
     "vintage": "2022 frame (valid 2022-09-09), HDX revision 2026-08-14", "url": "https://data.humdata.org/dataset/cod-ab-pak",
     "license": "CC BY-IGO (HDX)", "used_for": ["District & province borders", "The 160-district frame every table joins to"],
     "caveats": "Boundaries follow the UN/OCHA convention and are not an endorsement of any boundary claim. Post-2022 district "
                "splits are folded into their 2022 parents."},
]


def build():
    out = {}
    for m in pkgutil.iter_modules(S.__path__):
        mod = importlib.import_module(f"pipeline.sources.{m.name}")
        info = getattr(mod, "INFO", None)
        if isinstance(info, dict) and info.get("id"):
            out[info["id"]] = dict(info)
            out[info["id"]]["module"] = m.name
    for e in EXTRA:
        out.setdefault(e["id"], e)
    # attach provenance from manifests
    for sid, info in out.items():
        files = []
        for rid in {sid, info.get("module"), RAW_ALIASES.get(sid)} - {None}:
            mp = RAW / rid / "manifest.json"
            if mp.exists():
                for name, rec in read_json(mp).items():
                    files.append({"name": name, **rec})
        info["files"] = sorted(files, key=lambda f: f["name"])
        info.pop("module", None)
    write_json(WEB_DATA / "sources.json", {"sources": sorted(out.values(), key=lambda s: s["id"])}, compact=False)
    print(len(out), "sources:", sorted(out))


if __name__ == "__main__":
    build()
