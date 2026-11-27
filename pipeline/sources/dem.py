"""Copernicus DEM GLO-90 (ESA / AWS Open Data) → per-hex elevation statistics.

Tiles are cloud-optimised GeoTIFFs read in place with HTTP range requests (no bulk download). Each 1°×1° tile
(1200×1200 px, 3 arc-sec ≈ 90 m) is aggregated straight onto the living pakistan hex grid, and a ~1 km mosaic is kept for
other builders (coast/lake detection, rivers). Ocean tiles do not exist in the collection: their cells stay empty.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import math

import numpy as np

from pipeline.common import INTERIM, BBOX, raw_dir, world_grid, record

INFO = {
    "id": "copernicus_dem",
    "title": "Copernicus DEM GLO-90 (digital surface model)",
    "publisher": "European Space Agency / Copernicus, via AWS Open Data Registry",
    "vintage": "GLO-90 2021 release (TanDEM-X acquisitions 2011–2015)",
    "url": "https://registry.opendata.aws/copernicus-dem/",
    "files_urls": ["https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt"],
    "license": "Copernicus DEM licence (free use with attribution) © DLR e.V. 2010-2014 and © Airbus 2014-2018",
    "used_for": ["Hex elevation (mean / max)", "Relief classes (flat, hills, mountains, peaks)",
                 "3D tile heights", "Coast / sea mask"],
    "caveats": "A surface model: heights include buildings and canopy. 90 m pixels slightly under-read the "
               "sharpest summits; the hex 'max' is the highest 90 m pixel in the hex.",
}

BUCKET = "https://copernicus-dem-90m.s3.amazonaws.com"
MOSAIC_PPD = 120  # mosaic pixels per degree (30 arc-sec ≈ 0.9 km)


def tiles():
    import urllib.request
    lst = urllib.request.urlopen(f"{BUCKET}/tileList.txt", timeout=60).read().decode().split()
    w, s, e, n = BBOX
    out = []
    for t in lst:
        # Copernicus_DSM_COG_30_N35_00_E076_00_DEM
        p = t.split("_")
        lat = int(p[4][1:]) * (1 if p[4][0] == "N" else -1)
        lon = int(p[6][1:]) * (1 if p[6][0] == "E" else -1)
        if s - 1 < lat < n and w - 1 < lon < e:
            out.append((t, lat, lon))
    return out


def _read(t):
    import rasterio
    name, lat, lon = t
    url = f"/vsicurl/{BUCKET}/{name}/{name}.tif"
    for attempt in range(4):
        try:
            with rasterio.open(url) as src:
                a = src.read(1)
                tr = src.transform
            return name, lat, lon, a, tr
        except Exception as e:  # pragma: no cover - network
            err = e
    raise RuntimeError(f"{name}: {err}")


def process():
    import os
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    proj, grid = world_grid()
    n = grid.size
    s_sum = np.zeros(n); s_sq = np.zeros(n); s_cnt = np.zeros(n); s_max = np.full(n, -1e9); s_min = np.full(n, 1e9)
    s_low = np.zeros(n)  # pixels below 5 m (coastal flats / delta)
    w, s, e, nn = BBOX
    mw, mh = int((e - w) * MOSAIC_PPD), int((nn - s) * MOSAIC_PPD)
    mosaic = np.full((mh, mw), np.nan, dtype=np.float32)
    ts = tiles()
    print(f"{len(ts)} tiles")
    done = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for name, lat, lon, a, tr in ex.map(_read, ts):
            h, wd = a.shape
            # Tiles above 50° are narrower; all ours are 1200 wide. Pixel centres in lon/lat:
            cols = tr.c + tr.a * (np.arange(wd) + 0.5)
            rows = tr.f + tr.e * (np.arange(h) + 0.5)
            # Sub-sample by 2 for the hex statistics (≈180 m) but use full res for the maxima.
            lon2, lat2 = np.meshgrid(cols[::2], rows[::2])
            mx, my = proj.to_map(lon2.ravel(), lat2.ravel())
            idx = grid.cells_at(np.asarray(mx), np.asarray(my))
            v = a[::2, ::2].ravel().astype(np.float64)
            ok = (idx >= 0) & np.isfinite(v) & (v > -500)
            idx, v = idx[ok], v[ok]
            np.add.at(s_sum, idx, v); np.add.at(s_sq, idx, v * v); np.add.at(s_cnt, idx, 1)
            np.minimum.at(s_min, idx, v); np.add.at(s_low, idx, (v < 5).astype(float))
            # Max from full resolution, block-max 2×2 then mapped with the same cell index.
            am = a[: h // 2 * 2, : wd // 2 * 2].reshape(h // 2, 2, wd // 2, 2).max(axis=(1, 3)).ravel()
            np.maximum.at(s_max, idx, am[ok].astype(np.float64))
            # Mosaic at 30 arc-sec (block mean of 10×10).
            f = h // (MOSAIC_PPD)
            if f >= 1 and h % f == 0:
                b = a.reshape(h // f, f, wd // f, f).mean(axis=(1, 3))
                r0 = int(round((nn - (lat + 1)) * MOSAIC_PPD)); c0 = int(round((lon - w) * MOSAIC_PPD))
                r1, c1 = r0 + b.shape[0], c0 + b.shape[1]
                rr0, cc0 = max(r0, 0), max(c0, 0)
                rr1, cc1 = min(r1, mh), min(c1, mw)
                if rr1 > rr0 and cc1 > cc0:
                    mosaic[rr0:rr1, cc0:cc1] = b[rr0 - r0: rr1 - r0, cc0 - c0: cc1 - c0]
            done += 1
            if done % 40 == 0:
                print(done, "tiles")
    cnt = np.maximum(s_cnt, 1)
    mean = np.where(s_cnt > 0, s_sum / cnt, np.nan)
    std = np.where(s_cnt > 0, np.sqrt(np.maximum(s_sq / cnt - mean ** 2, 0)), np.nan)
    np.savez_compressed(INTERIM / "dem_hex.npz", mean=mean.astype(np.float32), std=std.astype(np.float32),
                        max=np.where(s_cnt > 0, s_max, np.nan).astype(np.float32),
                        min=np.where(s_cnt > 0, s_min, np.nan).astype(np.float32),
                        count=s_cnt.astype(np.int32), low=(s_low / cnt).astype(np.float32))
    np.savez_compressed(INTERIM / "dem_mosaic.npz", z=mosaic, west=w, north=nn, ppd=MOSAIC_PPD)
    (raw_dir("copernicus_dem") / "tiles_used.json").write_text(json.dumps([t[0] for t in ts]))
    record("copernicus_dem", "tiles_used.json", f"{BUCKET}/tileList.txt")
    print("max elevation", np.nanmax(s_max), "cells with data", int((s_cnt > 0).sum()))


if __name__ == "__main__":
    INTERIM.mkdir(parents=True, exist_ok=True)
    process()
