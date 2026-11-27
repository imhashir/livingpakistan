# PakCiv — build progress log

Newest entries at the top. Screenshots live in `previews/`.

## 02 · Explore & Discover suite + production verification (2026-11-27)
**Built**
- **Chronicles of Pakistan** — 7 cinematic tours (K2 → Arabian Sea, Indus Food Machine, Industrial Belt, 5,000 Years of
  Wonders, The 2022 Deluge, Tongues of the Indus, Caravans & Corridors); every caption number is computed from the data.
- **2022 flood-surge playback** — UNOSAT weekly district extents (Aug → Dec 2022) animate rising water caps; live km²,
  exposed people, NDMA deaths, PDNA damage. District headlines use the cloud-free weekly peak (the VIIRS monthly composite
  also catches flooded rice paddies — documented in the Almanac). Worst hit: Jacobabad, Larkana, Jaffarabad, Shikarpur.
- **Era Time-Machine** — 8 eras / 42 dated sites with light beams, era lighting and era-specific layers.
- **District Duel** (radar of percentiles, crowns, data-derived verdict), **Explorer** (sortable table + scatter, log axes,
  Pearson r, brushing linked to the 3D map), **Surprise me** (17 live-computed outliers), fuzzy **Search**, **Almanac**
  (23 sources with file-level provenance: url, bytes, sha256, retrieval date).
- Cinematic opening fly-in from K2, hover ring, lens-tinted mountains, label decluttering, shareable URL hash.
- **Production build verified**: `npm run build && npm run verify` drives every lens, mood, layer, panel, era and tour
  plus real mouse input against `vite preview` → **0 console errors, 0 warnings, 0 failed requests**.

**Screenshots** — `previews/00-intro.png`, `04-lahore-wonders-closeup.png`, `05-flood-surge-playback.png`,
`06-era-time-machine.png`, `07-district-duel.png`, `08-explorer.png`, `09-surprise-me.png`, `10-almanac.png`,
`11-mother-tongue-lens.png`, `12-prod-build-after-sweep.png` (01–03 refreshed).

## 01 · 3D board, real data, lenses & lighting moods (2026-11-27)
**Built**
- Three.js/WebGL renderer (Vite static app): 3,409 Pakistan hexes (20 km corner-to-corner) as one `InstancedMesh` of
  extruded prisms with procedural crop-row / dune / canopy / glacier / street-grid shaders; instanced low-poly peaks with a
  world-height snowline; animated sea shader masked to the real coastline; fog-of-war cloud void where neighbouring
  countries sink away; glowing gold national frontier + province/district edges; bloom post-processing.
- Lighting moods: Day / Golden hour / **Nightlights** (hexes glow by Census-scaled population density); relief slider ×1–30.
- Animated rivers (OSM, flow-direction currents; Indus Waters Treaty colouring), canals, roads/rail, faults; 6 named
  corridors + ML-1 with travelling caravan pulses (GT Road, KKH, CPEC East/West, Makran Coastal, Indus Highway).
- 47 cities as instanced skylines (lit windows at night) + Civ banners; wonders as 3D silhouettes (mosque, minar, stupa,
  fort, tomb, dam, port crane, summit beacon); 380+ sites as icon pins; screen-space label decluttering.
- 25 lenses (hex + district level), histogram legends with hover-brushing; hover tooltips; inspector panel (hex
  micro-civilisation card, district dossier, City View, site cards); shareable URL hash; keyboard shortcuts.

**Datasets integrated** — Copernicus DEM GLO-90, ESA WorldCover 2021, WorldPop 2025, PBS Census 2023 (Tables 1,5,9,11,12 —
national total 241,499,431 matches exactly), PBS Economic Census 2023, MPI 2019-20, Agricultural Census 2024, Kummu modelled
GDP (labelled as a model), UNOSAT 2022 flood extent + weekly district evolution, USGS ComCat, GEM active faults, EM-DAT,
NDMA/PDNA flood facts, WRI GPPD (+cited supplement), OurAirports + PCAA traffic, World Port Index, OSM (Geofabrik),
water infrastructure (Wikidata/Wikipedia), UNESCO, WDPA, OpenAlex universities, eras & culture pins. 23 sources in `sources.json`.

**Screenshots** — `previews/01-hex-terrain-day.png`, `previews/02-nightlights.png`, `previews/03-karakoram-golden-hour.png`


## 00 · Pipeline skeleton (2026-11-27)
- Python pipeline core: `pipeline/common.py` — cached downloads with a provenance manifest (url, bytes, sha256,
  date) per source, Albers equal-area projection tuned for Pakistan (km, y-down), pointy-top odd-r hex grid
  (radius 10 km → 20 km corner-to-corner, 112 × 114 cells).
- District frame frozen: **OCHA COD-AB Pakistan** (HDX, revision 2026-08-14; 2022 frame) — 160 districts across
  Punjab, Sindh, KP, Balochistan, GB, AJK and ICT, with P-codes. Every district table joins to these P-codes.
- Architecture decision (per updated brief): fully static site, **Three.js/WebGL** 2.5D hex renderer.
- Screenshot: none yet.
