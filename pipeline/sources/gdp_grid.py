"""MODELLED Gold: Kummu et al. gridded total GDP (PPP), 30 arc-second, latest year (2024).

There is no official district GDP for Pakistan. This module reads the Pakistan window of the global
rast_gdpTot_1990_2024_30arcsec.tif (Zenodo record 18429133) with HTTP range requests (no 1.4 GB download), keeps a
clipped GeoTIFF under data/raw/gdp_grid/ with provenance, and writes
  data/interim/gdp_grid.npz  (float32 grid, lon0/lat0 = top-left corner, dlon/dlat, year, units)
  data/interim/gdp_grid.json (district sums of cells whose centres fall in each COD-AB polygon + national total)
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.windows import Window, from_bounds

from pipeline.common import BBOX, INTERIM, RAW, interim, raw_dir, record, read_json, write_json

ID = "gdp_grid"
RECORD = "https://zenodo.org/records/18429133"
URL = "https://zenodo.org/api/records/18429133/files/rast_gdpTot_1990_2024_30arcsec.tif/content"
BAND_NAME = "gdp_2024"
UNITS = "USD, 2021 international dollars (PPP), total GDP per cell"

INFO = {
    "id": ID,
    "title": "Gridded GDP (PPP), MODELLED -- Kummu et al.",
    "publisher": "Kummu, Kosonen & Masoumzadeh Sayyar (Aalto University), Scientific Data 12:178 (2025); Zenodo v4",
    "vintage": "2024 band of the 1990-2024 dataset (Zenodo record 18429133, published 2026-03-13)",
    "url": RECORD,
    "files_urls": [URL],
    "license": "CC-BY-4.0",
    "used_for": ["Gold yield (modelled GDP) for hexes and districts"],
    "caveats": ("MODELLED, NOT OFFICIAL. Pakistan has no official district GDP; this grid downscales reported "
                "national/provincial GDP per capita to admin-2 units and multiplies by gridded population, so "
                "it mostly mirrors where people live, scaled by provincial income. 30 arc-second (~0.9 km) cells; "
                "district totals sum cells whose centres fall inside COD-AB 2022 polygons. Units: 2021 "
                "international dollars (PPP)."),
}


def _read_window() -> tuple[np.ndarray, rasterio.Affine, dict]:
    out = raw_dir(ID) / "gdpTot_2024_30arcsec_pak.tif"
    if not out.exists():
        with rasterio.Env(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3", CPL_VSIL_CURL_CHUNK_SIZE="4194304",
                          GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open("/vsicurl/" + URL) as src:
                band = list(src.descriptions).index(BAND_NAME) + 1
                w = from_bounds(*BBOX, transform=src.transform).round_offsets().round_lengths()
                w = Window(max(0, w.col_off), max(0, w.row_off), w.width, w.height)
                arr = src.read(band, window=w)
                tr = src.window_transform(w)
                prof = {"driver": "GTiff", "dtype": "float32", "count": 1, "width": arr.shape[1],
                        "height": arr.shape[0], "crs": src.crs, "transform": tr, "nodata": src.nodata,
                        "compress": "deflate", "predictor": 3}
        with rasterio.open(out, "w", **prof) as dst:
            dst.write(arr.astype("float32"), 1)
            dst.set_band_description(1, BAND_NAME)
        record(ID, out.name, URL + f" (band {BAND_NAME}, window {BBOX})")
    with rasterio.open(out) as src:
        return src.read(1), src.transform, {"nodata": src.nodata}


def process():
    arr, tr, _ = _read_window()
    arr = np.where(np.isfinite(arr) & (arr > 0), arr, 0).astype("float32")
    gj = json.loads((RAW / "cod_ab" / "x" / "pak_admin2.geojson").read_text())
    frame = {d["pcode"]: d for d in read_json(interim("districts"))["districts"]}
    feats = [f for f in gj["features"] if f["properties"]["adm2_pcode"] in frame]
    idx = {f["properties"]["adm2_pcode"]: i + 1 for i, f in enumerate(feats)}
    # all_touched=False burns a cell only if its centre is inside the polygon.
    lab = rasterize(((f["geometry"], idx[f["properties"]["adm2_pcode"]]) for f in feats), out_shape=arr.shape,
                    transform=tr, fill=0, dtype="int32", all_touched=False)
    sums = np.bincount(lab.ravel(), weights=arr.ravel().astype("float64"), minlength=len(feats) + 1)
    cells = np.bincount(lab.ravel(), minlength=len(feats) + 1)
    districts = {pc: {"gdp_ppp_usd": round(float(sums[i]), 0), "cells": int(cells[i])}
                 for pc, i in sorted(idx.items())}
    national = float(sums[1:].sum())
    np.savez_compressed(INTERIM / "gdp_grid.npz", gdp=arr, lon0=tr.c, lat0=tr.f, dlon=tr.a, dlat=tr.e,
                        year=2024, units=UNITS, label="MODELLED GDP (Kummu et al.), not official")
    res = {"vintage": INFO["vintage"], "modelled": True, "units": UNITS, "year": 2024,
           "grid": {"file": "data/interim/gdp_grid.npz", "shape": list(arr.shape), "lon0": tr.c, "lat0": tr.f,
                    "dlon": tr.a, "dlat": tr.e, "bbox": list(BBOX)},
           "districts": districts,
           "national": {"gdp_ppp_usd_sum_of_districts": round(national, 0),
                        "gdp_ppp_usd_bbox_total": round(float(arr.sum(dtype="float64")), 0)},
           "note": "MODELLED GDP, not official statistics (no official district GDP exists for Pakistan)."}
    write_json(interim(ID), res)
    return res


if __name__ == "__main__":
    r = process()
    print(r["grid"]["shape"], "national (districts) $%.3e" % r["national"]["gdp_ppp_usd_sum_of_districts"],
          "bbox $%.3e" % r["national"]["gdp_ppp_usd_bbox_total"])
    zero = [k for k, v in r["districts"].items() if v["gdp_ppp_usd"] <= 0]
    print(len(r["districts"]), "districts; zero:", zero)
