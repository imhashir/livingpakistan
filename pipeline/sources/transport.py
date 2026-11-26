"""OpenStreetMap (Geofabrik Pakistan extract): motorways, national highways, mainline railways, large named
irrigation canals and barrage/dam/headworks points. Output: data/interim/transport.json (lon/lat lines,
simplified for a 10 km hex map; parallel carriageways / double tracks are collapsed)."""
from __future__ import annotations

import collections
import re

from pipeline.common import fetch, write_json, interim

URL = "https://download.geofabrik.de/asia/pakistan-latest.osm.pbf"

INFO = {
    "id": "transport",
    "title": "OpenStreetMap Pakistan extract: roads, railways, canals, barrages",
    "publisher": "OpenStreetMap contributors (extract by Geofabrik GmbH)",
    "vintage": None,  # filled from the PBF header (osmosis_replication_timestamp) by process()
    "url": "https://download.geofabrik.de/asia/pakistan.html",
    "files_urls": [URL],
    "license": "ODbL 1.0 (Open Database License), (c) OpenStreetMap contributors",
    "used_for": ["motorway and national-highway lines", "mainline/branch railway lines",
                 "large named irrigation canals", "major rivers", "barrage / dam / headworks locations"],
    "caveats": ("Crowd-sourced; completeness and ref tagging vary. Motorways are taken from M-<n> refs on "
                "motorway/trunk/primary ways plus highway=motorway ways with other or no refs; national highways "
                "from N-<n> refs on trunk/primary ways only (untagged or differently tagged sections are missing). "
                "Lines are simplified (~0.01 deg) and dual carriageways/double tracks collapsed, so lengths are "
                "approximate. Geofabrik's extract boundary includes AJK/Gilgit-Baltistan and slivers of "
                "neighbouring countries; features there have pcode null. Barrages/dams are name-matched points. "
                "Rivers are name-matched waterway=river ways (braided channels collapsed; only the part inside the "
                "extract, so trans-boundary rivers are truncated)."),
}

SIMPLIFY_DEG = 0.01
DEDUPE_DEG = 0.004          # ~400 m: parallel carriageways / tracks closer than this are collapsed
ROUND = 3
MIN_PIECE_KM = 2.0
CANAL_MIN_KM = 20.0

_REF_RE = re.compile(r"^(NH|N|M)\s*-?\s*(\d+)$", re.I)
_DAM_RE = re.compile(r"barrage|\bdam\b|head\s*-?\s*works|\bhead\b", re.I)
RIVERS = ["Indus", "Jhelum", "Chenab", "Ravi", "Sutlej", "Beas", "Kabul", "Swat", "Gilgit", "Hunza", "Shyok",
          "Kunhar", "Neelum", "Zhob", "Hingol", "Dasht", "Porali", "Hub", "Gomal", "Kurram"]
_RIVER_ALIASES = {"sindh": "Indus", "sindhu": "Indus", "satluj": "Sutlej", "kishanganga": "Neelum"}
_RIVER_RE = re.compile(r"\b(" + "|".join([r.lower() for r in RIVERS] + list(_RIVER_ALIASES)) + r")\b", re.I)
_NOT_RIVER = re.compile(r"canal|nullah|nala\b|nallah|link|branch|drain|old |purana|khwar|wah\b", re.I)


def river_of(t) -> str | None:
    """Canonical major-river name for a waterway=river way, matched on name:en then name (Latin script)."""
    for k in ("name:en", "name"):
        v = t.get(k)
        if not v or _NOT_RIVER.search(v):
            continue
        m = _RIVER_RE.search(v)
        if m:
            w = m.group(1).lower()
            return _RIVER_ALIASES.get(w) or next(r for r in RIVERS if r.lower() == w)
    return None


# generic names that would merge unrelated channels (karez/qanat, drains) or road names mis-tagged on canals
_GENERIC_CANAL = re.compile(r"^\s*(qanat|karez|canal|nala|nullah|sem canal|drain)\s*$|road|qanat|قنات", re.I)
_BAD_RAIL_SERVICE = {"yard", "siding", "spur", "crossover"}
_BAD_RAIL_USAGE = {"industrial", "military", "tourism", "test", "freight"}


def norm_refs(ref: str | None) -> list[str]:
    out = []
    for part in re.split(r"[;,/]", ref or ""):
        m = _REF_RE.match(part.strip())
        if m:
            p = m.group(1).upper()
            out.append(f"{'N' if p == 'NH' else p}-{int(m.group(2))}")
    return out


def _name(t):
    return t.get("name:en") or t.get("name")


def _collect(path):
    import osmium

    roads = collections.defaultdict(list)       # (class, ref, name-key) -> [coords]
    road_names = collections.defaultdict(collections.Counter)
    rail = collections.defaultdict(list)
    rail_names = collections.defaultdict(collections.Counter)
    canals = collections.defaultdict(list)
    rivers = collections.defaultdict(list)
    river_names = collections.defaultdict(collections.Counter)
    dams = []

    class H(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags
            hw, rw, ww = t.get("highway"), t.get("railway"), t.get("waterway")
            dam = ww in ("dam", "weir") or t.get("man_made") == "dam"
            if not (hw in ("motorway", "trunk", "primary") or rw == "rail" or ww in ("canal", "river") or dam):
                return
            try:
                coords = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                coords = [(n.lon, n.lat) for n in w.nodes if n.location.valid()]
            if len(coords) < 2:
                return
            if hw in ("motorway", "trunk", "primary"):
                refs = norm_refs(t.get("ref"))
                keys = [("motorway" if r.startswith("M-") else "national_highway", r, None) for r in refs]
                if hw == "motorway" and not refs:
                    # non M-/N- refs (e.g. L-20 Lahore Ring Road) keep their raw ref; ref-less sections group by name
                    raw = (t.get("ref") or "").split(";")[0].strip() or None
                    keys.append(("motorway", raw, None if raw else _name(t)))
                for k in keys:
                    roads[k].append(coords)
                    if _name(t):
                        road_names[k][_name(t)] += 1
            if rw == "rail":
                if t.get("service") in _BAD_RAIL_SERVICE or t.get("usage") in _BAD_RAIL_USAGE:
                    return
                k = t.get("usage") if t.get("usage") in ("main", "branch") else "unspecified"
                rail[k].append(coords)
                if _name(t):
                    rail_names[k][_name(t)] += 1
            if ww == "river":
                rv = river_of(t)
                if rv:
                    rivers[rv].append(coords)
                    river_names[rv][_name(t)] += 1
            if ww == "canal" and _name(t) and not _GENERIC_CANAL.search(_name(t)):
                canals[_name(t).strip()].append(coords)
            if dam and _name(t) and _DAM_RE.search(_name(t)):
                dams.append(("w", w.id, _name(t).strip(), t, coords))

        def node(self, n):
            t = n.tags
            if (t.get("waterway") in ("dam", "weir") or t.get("man_made") == "dam") and _name(t) \
                    and _DAM_RE.search(_name(t)) and n.location.valid():
                dams.append(("n", n.id, _name(t).strip(), t, [(n.location.lon, n.location.lat)]))

    H().apply_file(str(path), locations=True)
    return roads, road_names, rail, rail_names, canals, rivers, river_names, dams


_GEOD = None


def length_km(geom) -> float:
    global _GEOD
    if _GEOD is None:
        from pyproj import Geod
        _GEOD = Geod(ellps="WGS84")
    return _GEOD.geometry_length(geom) / 1000.0


def _parts(g):
    if g.is_empty:
        return []
    return [g] if g.geom_type == "LineString" else [p for p in getattr(g, "geoms", []) if p.geom_type == "LineString"]


def build_lines(ways, min_piece_km=MIN_PIECE_KM):
    """Merge ways, collapse parallel duplicates, simplify. Returns (lines as lists of [lon,lat], length_km)."""
    from shapely import STRtree
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge, unary_union

    merged = _parts(linemerge(MultiLineString([LineString(c) for c in ways])))
    merged = [m.simplify(0.0005) for m in merged]
    merged.sort(key=lambda g: -g.length)
    kept, bufs = [], []
    for g in merged:
        if bufs:
            tree = STRtree(bufs)
            near = [bufs[int(i)] for i in tree.query(g)]
            if near:
                g = g.difference(unary_union(near))
        for p in _parts(g):
            if p.length > 0:
                kept.append(p)
                bufs.append(p.buffer(DEDUPE_DEG, cap_style="flat"))
    if not kept:
        return [], 0.0
    pieces = [p for p in _parts(linemerge(MultiLineString(kept))) if length_km(p) >= min_piece_km]
    total = sum(length_km(p) for p in pieces)
    out = []
    for p in pieces:
        s = p.simplify(SIMPLIFY_DEG)
        pts = []
        for x, y in s.coords:
            q = [round(x, ROUND), round(y, ROUND)]
            if not pts or pts[-1] != q:
                pts.append(q)
        if len(pts) >= 2:
            out.append(pts)
    return out, round(total, 1)


def _ref_key(r):
    m = re.match(r"([A-Z]+)-(\d+)$", r or "")
    return (m.group(1), int(m.group(2))) if m else ("~", 0)


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _dam_kind(name):
    n = name.lower()
    if "barrage" in n:
        return "barrage"
    if re.search(r"head\s*-?\s*works|\bhead\b", n):
        return "headworks"
    return "dam"


def process():
    from shapely.geometry import LineString
    import osmium

    from pipeline.sources.cod_ab import pcode_at

    pbf = fetch("transport", URL)
    hdr = osmium.io.Reader(str(pbf), osmium.osm.osm_entity_bits.NOTHING)
    vintage = hdr.header().get("osmosis_replication_timestamp") or None
    hdr.close()
    INFO["vintage"] = vintage

    roads, road_names, rail, rail_names, canals, rivers, river_names, dams = _collect(pbf)

    out_roads = []
    for (cls, ref, nm), ways in roads.items():
        lines, km = build_lines(ways)
        if not lines:
            continue
        names = road_names[(cls, ref, nm)]
        out_roads.append({"ref": ref, "name": nm or (names.most_common(1)[0][0] if names else None),
                          "class": cls, "length_km": km, "lines": lines})
    out_roads.sort(key=lambda r: (r["class"] != "motorway", r["ref"] is None, _ref_key(r["ref"]), r["name"] or ""))

    out_rail = []
    for usage, ways in rail.items():
        lines, km = build_lines(ways)
        if lines:
            out_rail.append({"ref": None, "usage": usage,
                             "name": {"main": "Main lines", "branch": "Branch lines"}.get(usage, "Other lines (usage untagged)"),
                             "operator": "Pakistan Railways",
                             "osm_names": [n for n, _ in rail_names[usage].most_common(8)],
                             "length_km": km, "lines": lines})
    out_rail.sort(key=lambda r: ["main", "branch", "unspecified"].index(r["usage"]))

    out_canals = []
    for name, ways in canals.items():
        if sum(length_km(LineString(c)) for c in ways) < CANAL_MIN_KM:
            continue
        lines, km = build_lines(ways, min_piece_km=1.0)
        if lines and km >= CANAL_MIN_KM:
            out_canals.append({"name": name, "link": "link canal" in name.lower(), "length_km": km, "lines": lines})
    out_canals.sort(key=lambda c: -c["length_km"])

    out_rivers = []
    for name in RIVERS:
        if name in rivers:
            lines, km = build_lines(rivers[name])
            if lines:
                out_rivers.append({"name": name, "osm_names": [n for n, _ in river_names[name].most_common(4)],
                                   "length_km": km, "lines": lines})

    pts = []
    dams.sort(key=lambda d: d[0] != "w")  # prefer ways over nodes when deduping
    for typ, oid, name, t, coords in dams:
        if typ == "w":
            ls = LineString(coords)
            c = ls.interpolate(0.5, normalized=True) if not ls.is_closed else ls.centroid
            lon, lat = c.x, c.y
        else:
            lon, lat = coords[0]
        key = re.sub(r"\s+", " ", name.lower())
        if any(p["_key"] == key and abs(p["lon"] - lon) < 0.05 and abs(p["lat"] - lat) < 0.05 for p in pts):
            continue
        pts.append({"_key": key, "id": _slug(name), "name": name, "lat": round(lat, 4), "lon": round(lon, 4),
                    "kind": _dam_kind(name), "osm_id": f"{typ}{oid}", "pcode": pcode_at(lon, lat), "src": "transport"})
    seen = collections.Counter()
    for p in pts:
        del p["_key"]
        seen[p["id"]] += 1
        if seen[p["id"]] > 1:
            p["id"] = f"{p['id']}-{seen[p['id']]}"
    pts.sort(key=lambda p: (p["kind"], p["name"]))

    out = {"vintage": vintage, "source": "transport", "roads": out_roads, "rail": out_rail,
           "canals": out_canals, "rivers": out_rivers, "barrages_osm": pts}
    write_json(interim("transport"), out)
    return out


if __name__ == "__main__":
    o = process()
    print("vintage", o["vintage"])
    for r in o["roads"]:
        print(f"  {r['class']:16s} {str(r['ref']):8s} {r['length_km']:8.1f} km  {len(r['lines']):3d} lines  {r['name']}")
    for r in o["rail"]:
        print(f"  rail {r['usage']:12s} {r['length_km']:8.1f} km  {len(r['lines'])} lines")
    print(f"canals {len(o['canals'])}: " + ", ".join(f"{c['name']} ({c['length_km']:.0f})" for c in o["canals"][:15]))
    print("rivers: " + ", ".join(f"{r['name']} ({r['length_km']:.0f})" for r in o["rivers"]))
    print(f"barrages_osm {len(o['barrages_osm'])}: "
          + ", ".join(p["name"] for p in o["barrages_osm"] if p["kind"] != "dam"))
    print(interim("transport").stat().st_size, "bytes")
