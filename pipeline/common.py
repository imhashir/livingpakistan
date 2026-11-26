"""Shared plumbing for the PakCiv pipeline.

* paths: data/raw/<source_id>/ (downloads, git-ignored), data/interim/<id>.json (tidy per-source output),
  web/data/*.json (what the browser loads).
* fetch(): cached HTTP download that records provenance (url, bytes, sha256, retrieved) in
  data/raw/<id>/manifest.json — the Almanac cites these.
* Projection: Albers equal-area tuned for Pakistan, map units are km, origin top-left, y down.
* HexGrid: pointy-top hexes in odd-r offset layout (odd rows shifted right). web/js/hex.js mirrors this exactly.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
WEB_DATA = ROOT / "web" / "public" / "data"

UA = "Mozilla/5.0 (X11; Linux x86_64) PakCiv-pipeline/1.0 (+https://github.com/imhashir/pakciv)"


# --------------------------------------------------------------------------------------------- downloads

def raw_dir(source_id: str) -> Path:
    d = RAW / source_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _manifest_path(source_id: str) -> Path:
    return raw_dir(source_id) / "manifest.json"


def load_manifest(source_id: str) -> dict:
    p = _manifest_path(source_id)
    return json.loads(p.read_text()) if p.exists() else {}


def fetch(source_id: str, url: str, name: str | None = None, *, retries: int = 3, timeout: int = 300,
          headers: dict | None = None) -> Path:
    """Download url into data/raw/<source_id>/<name> once; return the local path."""
    name = name or url.split("?")[0].rstrip("/").split("/")[-1]
    out = raw_dir(source_id) / name
    man = load_manifest(source_id)
    if out.exists() and out.stat().st_size > 0 and name in man:
        return out
    tmp = out.with_suffix(out.suffix + ".part")
    last = None
    for attempt in range(retries):
        try:
            # curl copes better than urllib with flaky TLS and redirects on government portals.
            cmd = ["curl", "-sSL", "--fail", "-m", str(timeout), "-A", UA, "-o", str(tmp), url]
            for k, v in (headers or {}).items():
                cmd[1:1] = ["-H", f"{k}: {v}"]
            subprocess.run(cmd, check=True)
            break
        except subprocess.CalledProcessError as e:  # pragma: no cover - network
            last = e
            time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(f"download failed: {url}: {last}")
    tmp.replace(out)
    h = hashlib.sha256(out.read_bytes()).hexdigest()
    man[name] = {"url": url, "bytes": out.stat().st_size, "sha256": h,
                 "retrieved": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")}
    _manifest_path(source_id).write_text(json.dumps(man, indent=1))
    return out


def record(source_id: str, name: str, url: str) -> None:
    """Record provenance for a file produced by other means (e.g. a ranged COG read or an API query)."""
    out = raw_dir(source_id) / name
    man = load_manifest(source_id)
    man[name] = {"url": url, "bytes": out.stat().st_size if out.exists() else None,
                 "sha256": hashlib.sha256(out.read_bytes()).hexdigest() if out.exists() else None,
                 "retrieved": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")}
    _manifest_path(source_id).write_text(json.dumps(man, indent=1))


def http_json(url: str, timeout: int = 120):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


# --------------------------------------------------------------------------------------------- JSON IO

def write_json(path: Path, obj, *, compact: bool = True) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        else:
            json.dump(obj, f, indent=1, ensure_ascii=False, allow_nan=False)
    os.replace(tmp, path)
    return path


def read_json(path: Path):
    with open(path) as f:
        return json.load(f)


def interim(name: str) -> Path:
    return INTERIM / f"{name}.json"


# --------------------------------------------------------------------------------------------- projection

# Albers equal-area conic centred on Pakistan. Standard parallels chosen to bracket the country (24-37 N).
PROJ = "+proj=aea +lat_0=30 +lon_0=69.5 +lat_1=26 +lat_2=35 +x_0=0 +y_0=0 +ellps=WGS84 +units=km +no_defs"

# Map extent in lon/lat (Pakistan incl. AJK and Gilgit-Baltistan, plus a margin of neighbours / Arabian Sea).
BBOX = (60.0, 23.0, 78.6, 38.2)  # W S E N
MARGIN_KM = 40.0


class Projection:
    def __init__(self):
        from pyproj import Transformer
        self._fwd = Transformer.from_crs("EPSG:4326", PROJ, always_xy=True)
        self._inv = Transformer.from_crs(PROJ, "EPSG:4326", always_xy=True)
        # Find the projected extent of the bbox outline.
        w, s, e, n = BBOX
        xs, ys = [], []
        for i in range(101):
            t = i / 100
            for lon, lat in ((w + (e - w) * t, s), (w + (e - w) * t, n), (w, s + (n - s) * t), (e, s + (n - s) * t)):
                x, y = self._fwd.transform(lon, lat)
                xs.append(x); ys.append(y)
        self.x0 = min(xs) - MARGIN_KM
        self.y1 = max(ys) + MARGIN_KM  # northing at the top edge
        self.width = max(xs) + MARGIN_KM - self.x0
        self.height = self.y1 - (min(ys) - MARGIN_KM)

    def to_map(self, lon, lat):
        """lon/lat (scalars or numpy arrays) -> map km (x right, y down)."""
        x, y = self._fwd.transform(lon, lat)
        return x - self.x0, self.y1 - y

    def to_lonlat(self, mx, my):
        return self._inv.transform(mx + self.x0, self.y1 - my)

    def to_dict(self) -> dict:
        return {"proj4": PROJ, "x0": round(self.x0, 4), "y1": round(self.y1, 4),
                "width": round(self.width, 3), "height": round(self.height, 3)}


# --------------------------------------------------------------------------------------------- hex grid

SQRT3 = math.sqrt(3)
HEX_RADIUS_KM = 10.0  # centre-to-corner: hexes are 20 km corner-to-corner, 17.3 km across the flats

_NEIGHBOURS = (
    ((1, 0), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1)),  # even rows: E, SE, SW, W, NW, NE
    ((1, 0), (1, 1), (0, 1), (-1, 0), (0, -1), (1, -1)),  # odd rows
)


@dataclass(frozen=True)
class HexGrid:
    radius: float
    cols: int
    rows: int

    @classmethod
    def covering(cls, width: float, height: float, radius: float = HEX_RADIUS_KM) -> "HexGrid":
        return cls(radius, math.ceil(width / (SQRT3 * radius)) + 1, math.ceil(height / (1.5 * radius)) + 1)

    @property
    def size(self) -> int:
        return self.cols * self.rows

    def index(self, col: int, row: int) -> int:
        return row * self.cols + col

    def col_row(self, i: int) -> tuple[int, int]:
        return i % self.cols, i // self.cols

    def center(self, col: int, row: int) -> tuple[float, float]:
        return SQRT3 * self.radius * (col + 0.5 * (row & 1)), 1.5 * self.radius * row

    def center_of(self, i: int) -> tuple[float, float]:
        return self.center(*self.col_row(i))

    def cell_at(self, x: float, y: float) -> int:
        q = (SQRT3 / 3 * x - y / 3) / self.radius
        r = (2 / 3 * y) / self.radius
        cx, cz = q, r
        cy = -cx - cz
        rx, ry, rz = math.floor(cx + 0.5), math.floor(cy + 0.5), math.floor(cz + 0.5)
        dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
        if dx > dy and dx > dz:
            rx = -ry - rz
        elif dy <= dz:
            rz = -rx - ry
        row = rz
        col = rx + (row - (row & 1)) // 2
        if 0 <= col < self.cols and 0 <= row < self.rows:
            return self.index(col, row)
        return -1

    def cells_at(self, xs, ys):
        """Vectorised cell_at for numpy arrays; -1 outside."""
        import numpy as np
        q = (SQRT3 / 3 * xs - ys / 3) / self.radius
        r = (2 / 3 * ys) / self.radius
        cx, cz = q, r
        cy = -cx - cz
        rx, ry, rz = np.floor(cx + 0.5), np.floor(cy + 0.5), np.floor(cz + 0.5)
        dx, dy, dz = np.abs(rx - cx), np.abs(ry - cy), np.abs(rz - cz)
        a = (dx > dy) & (dx > dz)
        b = ~a & (dy <= dz)
        rx = np.where(a, -ry - rz, rx)
        rz = np.where(b, -rx - ry, rz)
        row = rz.astype(np.int64)
        col = (rx.astype(np.int64) + (row - (row & 1)) // 2)
        ok = (col >= 0) & (col < self.cols) & (row >= 0) & (row < self.rows)
        return np.where(ok, row * self.cols + col, -1)

    def neighbours(self, i: int) -> list[int]:
        col, row = self.col_row(i)
        out = []
        for dc, dr in _NEIGHBOURS[row & 1]:
            c, r = col + dc, row + dr
            if 0 <= c < self.cols and 0 <= r < self.rows:
                out.append(self.index(c, r))
        return out

    def to_dict(self) -> dict:
        return {"radius": self.radius, "cols": self.cols, "rows": self.rows}


def world_grid() -> tuple[Projection, HexGrid]:
    p = Projection()
    return p, HexGrid.covering(p.width, p.height)


if __name__ == "__main__":
    p, g = world_grid()
    print(p.to_dict(), g.to_dict(), g.size)
