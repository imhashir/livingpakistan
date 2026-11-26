# PakCiv — build progress log

Newest entries at the top. Screenshots live in `previews/`.

## 00 · Pipeline skeleton (2026-11-27)
- Python pipeline core: `pipeline/common.py` — cached downloads with a provenance manifest (url, bytes, sha256,
  date) per source, Albers equal-area projection tuned for Pakistan (km, y-down), pointy-top odd-r hex grid
  (radius 10 km → 20 km corner-to-corner, 112 × 114 cells).
- District frame frozen: **OCHA COD-AB Pakistan** (HDX, revision 2026-08-14; 2022 frame) — 160 districts across
  Punjab, Sindh, KP, Balochistan, GB, AJK and ICT, with P-codes. Every district table joins to these P-codes.
- Architecture decision (per updated brief): fully static site, **Three.js/WebGL** 2.5D hex renderer.
- Screenshot: none yet.
