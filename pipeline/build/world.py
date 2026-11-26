"""World builder: puts the base geography onto the hex grid → web/data/world.json (+ data/interim/_world.npz).

Everything is rasterised to one 0.01° lon/lat lattice first (≈1 km), each lattice pixel is mapped to its hex once,
and per-hex values are pixel shares. Inputs: COD-AB districts, Natural Earth land/lakes/countries, ESA WorldCover
shares, Copernicus DEM stats, WorldPop 2025, UNOSAT/VIIRS 2022 flood extent.
"""
from __future__ import annotations

import json
import zipfile

import numpy as np

from pipeline.common import BBOX, INTERIM, RAW, WEB_DATA, raw_dir, read_json, world_grid, write_json, interim
from pipeline.sources.cod_ab import geojson

RES = 0.01
COVER_NAMES = ["tree", "shrub", "grass", "crop", "built", "bare", "snow", "water", "wetland", "mangrove", "moss"]


PAD = 2.0  # degrees beyond BBOX so every hex of the projected (conic) frame is covered


def lattice_bounds():
    w, s, e, n = BBOX
    return w - PAD, s - PAD, e + PAD, n + PAD


def lattice():
    w, s, e, n = lattice_bounds()
    W, H = int(round((e - w) / RES)), int(round((n - s) / RES))
    from rasterio.transform import from_origin
    return W, H, from_origin(w, n, RES, RES)


def rasterize(shapes, W, H, tr, dtype="int32", fill=0):
    from rasterio.features import rasterize as rz
    return rz(shapes, out_shape=(H, W), transform=tr, fill=fill, dtype=dtype, all_touched=False)


def read_shp_zip(source_id, zname, member_stem):
    import shapefile
    z = raw_dir(source_id) / zname
    out = raw_dir(source_id) / "x"
    if not list(out.glob(member_stem + ".shp")):
        zipfile.ZipFile(z).extractall(out)
    return shapefile.Reader(str(next(out.glob(member_stem + ".shp"))))


def build():
    from shapely.geometry import shape, box, mapping
    proj, grid = world_grid()
    W, H, tr = lattice()
    w, s, e, n = lattice_bounds()
    lons = w + RES * (np.arange(W) + 0.5)
    lats = n - RES * (np.arange(H) + 0.5)
    LO, LA = np.meshgrid(lons, lats)
    mx, my = proj.to_map(LO.ravel(), LA.ravel())
    pix_cell = grid.cells_at(np.asarray(mx), np.asarray(my)).reshape(H, W)
    # Pixel area varies with latitude (cos φ); weight shares by it.
    parea = (np.cos(np.radians(LA)) * (111.32 * RES) ** 2).astype(np.float64)
    ncell = grid.size
    valid = pix_cell >= 0
    pc = pix_cell[valid]
    pa = parea[valid]
    cell_area = np.bincount(pc, weights=pa, minlength=ncell)

    # ---- districts
    dist = read_json(interim("districts"))["districts"]
    pidx = {d["pcode"]: i for i, d in enumerate(dist)}
    feats = geojson(2)["features"]
    shapes = [(f["geometry"], pidx[f["properties"]["adm2_pcode"]] + 1) for f in feats]
    dras = rasterize(shapes, W, H, tr) - 1  # -1 = not Pakistan
    nd = len(dist)
    dshare = np.zeros((ncell, nd))
    m = valid & (dras >= 0)
    np.add.at(dshare, (pix_cell[m], dras[m]), parea[m])
    pak_area = dshare.sum(axis=1)

    # ---- land (Natural Earth) & foreign countries
    rl = read_shp_zip("natural_earth", "ne_10m_land.zip", "ne_10m_land")
    clip = box(w - 0.5, s - 0.5, e + 0.5, n + 0.5)
    land_shapes = []
    for sh in rl.shapes():
        g = shape(sh.__geo_interface__)
        if g.intersects(clip):
            land_shapes.append((mapping(g.intersection(clip)), 1))
    land = rasterize(land_shapes, W, H, tr, dtype="uint8")
    rc = read_shp_zip("natural_earth", "ne_10m_admin_0_countries.zip", "ne_10m_admin_0_countries")
    fields = [f[0] for f in rc.fields[1:]]
    countries = []
    cshapes = []
    for sr in rc.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        g = shape(sr.shape.__geo_interface__)
        if not g.intersects(clip) or rec["ADM0_A3"] == "PAK":
            continue
        countries.append(rec["NAME_EN"] if "NAME_EN" in rec else rec["NAME"])
        cshapes.append((mapping(g.intersection(clip)), len(countries)))
    cras = rasterize(cshapes, W, H, tr, dtype="int32")
    rk = read_shp_zip("natural_earth", "ne_10m_lakes.zip", "ne_10m_lakes")
    lake_shapes = [(mapping(shape(sh.__geo_interface__)), 1) for sh in rk.shapes()
                   if shape(sh.__geo_interface__).intersects(clip)]
    lakes = rasterize(lake_shapes, W, H, tr, dtype="uint8") if lake_shapes else np.zeros((H, W), np.uint8)

    landlike = (land == 1) | (dras >= 0)
    land_area = np.bincount(pc, weights=pa * landlike[valid], minlength=ncell)
    lake_area = np.bincount(pc, weights=pa * (lakes[valid] == 1), minlength=ncell)
    country_votes = np.zeros((ncell, len(countries) + 1))
    np.add.at(country_votes, (pc, cras[valid]), pa)

    # ---- flood 2022 (UNOSAT VIIRS 1 Jul – 31 Aug 2022 cumulative extent)
    rf = read_shp_zip("unosat_flood", "viirs_20220701_20220831_floodextent_pak.zip",
                      "VIIRS_20220701_20220831_FloodExtent_PAK")
    fshapes = [(sh.__geo_interface__, 1) for sh in rf.shapes()]
    flood = rasterize(fshapes, W, H, tr, dtype="uint8")
    flood_area = np.bincount(pc, weights=pa * (flood[valid] == 1), minlength=ncell)

    # ---- WorldPop 2025 constrained 1 km → hexes (pixel centres)
    import rasterio
    with rasterio.open(raw_dir("worldpop") / "pak_pop_2025_CN_1km_R2025A_UA_v1.tif") as src:
        a = src.read(1).astype(np.float64)
        nod = src.nodata
        t2 = src.transform
    a[(a < 0) | (a == nod) | ~np.isfinite(a)] = 0
    rr, cc = np.nonzero(a > 0)
    plon = t2.c + t2.a * (cc + 0.5); plat = t2.f + t2.e * (rr + 0.5)
    qx, qy = proj.to_map(plon, plat)
    pcell = grid.cells_at(np.asarray(qx), np.asarray(qy))
    ok = pcell >= 0
    wp = np.bincount(pcell[ok], weights=a[rr, cc][ok], minlength=ncell)
    # district of each population pixel (for reconciling to Census totals later)
    pr = ((n - plat) / RES).astype(int); pcl = ((plon - w) / RES).astype(int)
    inb = (pr >= 0) & (pr < H) & (pcl >= 0) & (pcl < W)
    pdist = np.full(len(plat), -1); pdist[inb] = dras[pr[inb], pcl[inb]]
    wp_cd = {}  # (cell, district) -> worldpop
    sel = ok & (pdist >= 0)
    key = pcell[sel] * 1000 + pdist[sel]
    uk, inv = np.unique(key, return_inverse=True)
    sums = np.bincount(inv, weights=a[rr, cc][sel])

    # ---- DEM + land cover
    dem = np.load(INTERIM / "dem_hex.npz")
    lc = np.load(INTERIM / "landcover_hex.npz")
    share = lc["share"]

    # ---- classify cells
    owner = np.full(ncell, -1, dtype=np.int64)  # -1 sea, -2 foreign land, -3 lake, >=0 district index
    frac_pak = pak_area / np.maximum(cell_area, 1e-9)
    frac_land = land_area / np.maximum(cell_area, 1e-9)
    frac_lake = lake_area / np.maximum(cell_area, 1e-9)
    is_pak = frac_pak >= 0.4
    owner[is_pak] = dshare[is_pak].argmax(axis=1)
    foreign = (~is_pak) & (frac_land >= 0.5)
    owner[foreign] = -2
    owner[(owner >= -2) & (owner < 0) & (frac_lake > 0.5)] = -3
    # Make sure every district owns at least its centroid cell (tiny Karachi districts).
    for i, d in enumerate(dist):
        if not (owner == i).any():
            x, y = proj.to_map(d["lon"], d["lat"])
            c = grid.cell_at(float(x), float(y))
            # take the cell only if the current owner keeps at least one other cell
            if c >= 0:
                prev = owner[c]
                if prev < 0 or (owner == prev).sum() > 1:
                    owner[c] = i
    country = np.where(owner == -2, country_votes[:, 1:].argmax(axis=1), -1)

    # water class: 0 land, 1 deep sea, 2 coastal sea, 3 lake
    water = np.zeros(ncell, dtype=np.int64)
    sea = owner == -1
    water[sea] = 1
    nb = [grid.neighbours(i) for i in range(ncell)]
    for i in np.nonzero(sea)[0]:
        if any(owner[j] != -1 for j in nb[i]):
            water[i] = 2
    water[owner == -3] = 3

    elev = np.nan_to_num(dem["mean"], nan=0.0)
    emax = np.nan_to_num(dem["max"], nan=0.0)
    estd = np.nan_to_num(dem["std"], nan=0.0)
    elev[sea] = np.minimum(elev[sea], 0)
    # sea depth isn't in GLO-90 (ocean = 0); shade by distance from coast instead (rings), purely cosmetic
    relief = np.zeros(ncell, dtype=np.int64)
    rng = emax - np.nan_to_num(dem["min"], nan=0.0)
    relief[(estd > 60) | (rng > 300)] = 1
    relief[(estd > 250) | (rng > 1200)] = 2
    relief[(emax > 5000) & (estd > 400)] = 3
    relief[water > 0] = 0

    # dominant cover & terrain
    land_cell = owner >= -2
    pct = {nm: np.round(share[:, k] * 100).astype(int) for k, nm in enumerate(COVER_NAMES)}

    def terr(i):
        if water[i] == 1 or water[i] == 2:
            return "sea"
        if water[i] == 3:
            return "lake"
        sh = share[i]
        snow, crop, tree, bare, built, wet, mang, grass, shrub = (sh[6], sh[3], sh[0], sh[5], sh[4], sh[8],
                                                                   sh[9], sh[2], sh[1])
        if snow > 0.30 or (emax[i] > 6000 and snow > 0.12):
            return "glacier"
        if built > 0.22:
            return "urban"
        if mang > 0.05 or wet > 0.25:
            return "marsh"
        if relief[i] >= 2 and tree > 0.25:
            return "forest_mtn"
        if relief[i] >= 2:
            return "mountain"
        if crop > 0.40:
            return "farmland"
        if tree > 0.30:
            return "forest"
        if crop > 0.18:
            return "farm_mixed"
        if relief[i] == 1:
            return "hills"
        if bare > 0.6:
            return "desert"
        if grass + shrub > 0.45:
            return "steppe"
        return "scrub"

    terrain = [terr(i) if (land_cell[i] or water[i]) else "sea" for i in range(ncell)]
    terrain_names = ["sea", "lake", "glacier", "urban", "marsh", "forest_mtn", "mountain", "farmland", "forest",
                     "farm_mixed", "hills", "desert", "steppe", "scrub"]
    tid = np.array([terrain_names.index(t) for t in terrain])

    # ---- crop the grid to the useful window (drop all-sea rows/cols beyond 2 cells)
    keep = (owner >= 0)
    cols_used = sorted({grid.col_row(i)[0] for i in np.nonzero(keep)[0]})
    rows_used = sorted({grid.col_row(i)[1] for i in np.nonzero(keep)[0]})
    print("Pakistan cells", int(keep.sum()), "cols", cols_used[0], cols_used[-1], "rows", rows_used[0], rows_used[-1])

    # flood share of land area
    flood_pct = np.where(land_area > 0, flood_area / np.maximum(land_area, 1e-9) * 100, 0)

    # district-level aggregates from the grid
    dcells = {i: [] for i in range(nd)}
    for c in np.nonzero(owner >= 0)[0]:
        dcells[int(owner[c])].append(int(c))

    np.savez_compressed(INTERIM / "_world.npz", owner=owner, water=water, elev=elev, emax=emax, relief=relief,
                        terrain=tid, wp=wp, flood_pct=flood_pct, land_area=land_area, pak_area=pak_area,
                        dshare=dshare.astype(np.float32), share=share, wp_keys=uk, wp_sums=sums,
                        country=country)

    out = {
        "version": 1,
        "grid": grid.to_dict(),
        "projection": proj.to_dict(),
        "bbox": list(BBOX),
        "terrain_names": terrain_names,
        "countries": countries,
        "owner": owner.tolist(),
        "country": country.tolist(),
        "water": water.tolist(),
        "elev": np.round(elev).astype(int).tolist(),
        "elev_max": np.round(emax).astype(int).tolist(),
        "relief": relief.tolist(),
        "terrain": tid.tolist(),
        "pct": {k: v.tolist() for k, v in pct.items() if k in ("tree", "crop", "built", "bare", "snow", "water",
                                                                 "wetland", "mangrove", "grass", "shrub")},
        "flood_pct": np.round(flood_pct, 1).tolist(),
    }
    write_json(WEB_DATA / "world.json", out)
    print("max elev", emax.max(), "flooded cells >10%", int((flood_pct > 10).sum()))
    return out


if __name__ == "__main__":
    build()
