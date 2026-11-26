"""OCHA COD-AB Pakistan admin boundaries (HDX). Defines the district frame (160 districts, P-codes) every
other dataset joins to. Output: data/interim/districts.json (attributes) — geometry is read directly by world.py."""
import json
import zipfile

from pipeline.common import fetch, raw_dir, write_json, interim

URL = ("https://data.humdata.org/dataset/a64d1ff2-7158-48c7-887d-6af69ce21906/resource/"
       "c6521e04-75e1-41be-8e02-0554a424d9f4/download/pak_admin_boundaries.geojson.zip")


def geojson(level: int) -> dict:
    z = fetch("cod_ab", URL)
    out = raw_dir("cod_ab") / "x"
    if not (out / f"pak_admin{level}.geojson").exists():
        zipfile.ZipFile(z).extractall(out)
    return json.loads((out / f"pak_admin{level}.geojson").read_text())


def process():
    feats = geojson(2)["features"]
    rows = []
    for f in feats:
        p = f["properties"]
        rows.append({"pcode": p["adm2_pcode"], "name": p["adm2_name"], "province": p["adm1_name"],
                     "province_pcode": p["adm1_pcode"], "area_km2": round(p["area_sqkm"], 1),
                     "lat": round(p["center_lat"], 4), "lon": round(p["center_lon"], 4)})
    rows.sort(key=lambda r: r["pcode"])
    provs = sorted({(r["province_pcode"], r["province"]) for r in rows})
    write_json(interim("districts"), {"vintage": "COD-AB 2022 frame (valid_on 2022-09-09), HDX revision 2026-08-14",
                                      "provinces": [{"pcode": a, "name": b} for a, b in provs],
                                      "districts": rows}, compact=False)
    return rows


if __name__ == "__main__":
    print(len(process()))
