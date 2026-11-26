"""Minimal district table for the browser (names, provinces, centroid map coordinates). Extended by later builders."""
from pipeline.common import WEB_DATA, interim, read_json, world_grid, write_json


def build():
    proj, _ = world_grid()
    d = read_json(interim("districts"))
    rows = []
    for r in d["districts"]:
        x, y = proj.to_map(r["lon"], r["lat"])
        rows.append({"pcode": r["pcode"], "name": r["name"], "province": r["province"], "area_km2": r["area_km2"],
                     "x": round(float(x), 2), "y": round(float(y), 2)})
    write_json(WEB_DATA / "districts.json", {"vintage": d["vintage"], "provinces": d["provinces"], "districts": rows})


if __name__ == "__main__":
    build()
