"""Writes web/public/data/manifest.json: the list of data files the browser should load (avoids 404 probing)."""
from pipeline.common import WEB_DATA, write_json


def build():
    files = sorted(p.stem for p in WEB_DATA.glob("*.json") if p.stem != "manifest")
    write_json(WEB_DATA / "manifest.json", {"files": files})
    print("manifest:", files)


if __name__ == "__main__":
    build()
