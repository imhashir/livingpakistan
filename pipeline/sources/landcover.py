"""ESA WorldCover 2021 v200 (10 m) → per-hex land-cover shares.

The 3°×3° cloud-optimised GeoTIFFs are read in place at their 1/16 overview (~160 m), so no multi-GB download.
Output: data/interim/landcover_hex.npz with `share` (cells × classes, 0..1) and `count`.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os

import numpy as np

from pipeline.common import INTERIM, BBOX, raw_dir, world_grid, record

INFO = {
    "id": "esa_worldcover",
    "title": "ESA WorldCover 10 m 2021 v200",
    "publisher": "European Space Agency (ESA WorldCover consortium), AWS Open Data",
    "vintage": "2021 (v200)",
    "url": "https://esa-worldcover.org/en",
    "files_urls": ["https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"],
    "license": "CC BY 4.0 — © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)",
    "used_for": ["Terrain type per hex", "Farmland / Forest / Desert / Glacier / Built-up lenses"],
    "caveats": "Read from the COG 1/16 overview (~160 m), then aggregated to 20 km hexes: small orchards, "
               "villages and narrow canals are blurred into their surroundings.",
}

URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
CLASSES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
NAMES = ["tree", "shrub", "grass", "crop", "built", "bare", "snow", "water", "wetland", "mangrove", "moss"]
OUT_PX = 2250  # 36000 / 16


def tile_names():
    w, s, e, n = BBOX
    out = []
    for lat in range(int(s // 3 * 3), int(n) + 1, 3):
        for lon in range(int(w // 3 * 3), int(e) + 1, 3):
            out.append((f"N{lat:02d}E{lon:03d}", lat, lon))
    return out


def _read(t):
    import rasterio
    name, lat, lon = t
    try:
        with rasterio.open("/vsicurl/" + URL.format(t=name)) as src:
            return t, src.read(1, out_shape=(OUT_PX, OUT_PX))
    except Exception:
        return t, None  # tile absent (open sea)


def process():
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    proj, grid = world_grid()
    n = grid.size
    counts = np.zeros((n, len(CLASSES)), dtype=np.float64)
    lut = np.full(256, -1, dtype=np.int64)
    for i, c in enumerate(CLASSES):
        lut[c] = i
    used = []
    step = 3.0 / OUT_PX
    with cf.ThreadPoolExecutor(12) as ex:
        for (name, lat, lon), a in ex.map(_read, tile_names()):
            if a is None:
                continue
            used.append(name)
            a = a[::2, ::2]  # ~320 m sampling is plenty for 20 km hexes
            lons = lon + step * 2 * (np.arange(a.shape[1]) + 0.5)
            lats = lat + 3 - step * 2 * (np.arange(a.shape[0]) + 0.5)
            LO, LA = np.meshgrid(lons, lats)
            mx, my = proj.to_map(LO.ravel(), LA.ravel())
            idx = grid.cells_at(np.asarray(mx), np.asarray(my))
            k = lut[a.ravel()]
            ok = (idx >= 0) & (k >= 0)
            np.add.at(counts, (idx[ok], k[ok]), 1)
            print("tile", name)
    tot = counts.sum(axis=1)
    share = np.where(tot[:, None] > 0, counts / np.maximum(tot, 1)[:, None], 0)
    np.savez_compressed(INTERIM / "landcover_hex.npz", share=share.astype(np.float32), count=tot.astype(np.int32),
                        names=np.array(NAMES))
    (raw_dir("esa_worldcover") / "tiles_used.json").write_text(json.dumps(sorted(used)))
    record("esa_worldcover", "tiles_used.json", URL.format(t="{tile}"))
    print(len(used), "tiles; cells with data", int((tot > 0).sum()))


if __name__ == "__main__":
    process()
