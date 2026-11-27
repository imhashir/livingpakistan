# PakCiv — build progress log

Newest entries at the top. Screenshots live in `previews/`.

## 04 · Showcase README + end-to-end product demo video (2026-11-27)
**Built**
- **README.md rewritten as a showcase**: pitch & stats strip, motivation, illustrated feature tour, yields → real
  measures, Three.js static architecture & data contracts, a table of all 23 data sources generated from `sources.json`,
  honest caveats, run / build / verify / rebuild-the-data instructions, repo layout. (Lens count corrected to **24** —
  earlier entries said 25.)
- **Optimized screenshots** in `docs/images/`: 16 WebP images at 1200×750, 108–204 KB each (vs 1–1.5 MB PNGs);
  every image link in the README verified to exist.
- **96-second product demo video** (`previews/pakciv-demo.mp4`, git-ignored to keep the repo lean — regenerate with
  `npm run video:record && npm run video:compose`). Chapters: Arabian Sea → K2 flight, relief sweep + Day/Golden/Night,
  rivers & glowing corridors, tile card & Lahore City View, lenses (mother tongue, literacy, density, modelled GDP) with
  legend brushing, 2022 flood surge playback, Era Time-Machine, District Duel, Explorer brushing, Search + Surprise me,
  Almanac, outro. No welcome/walkthrough (bypassed via localStorage).
- **How it's made** (`scripts/video/`): the production build runs in a new `?capture=1` mode where a virtual clock
  advances exactly 1/30 s per frame (camera flights, shaders, flood playback are deterministic — zero jank even under
  software WebGL). `record.mjs` drives real mouse/keyboard input with eased cursor paths and logs cursor, clicks, zoom
  keyframes and chapters; `compose.py` adds cosine-eased zoom/pan highlights, an anti-aliased cursor with click ripples,
  minimal Cinzel/Inter chapter labels and title/outro cards, then two-pass H.264.
- **Verified**: ffprobe → H.264 High, 1280×720, yuv420p (TV range), 30 fps, 2,883 frames, 96.1 s, 11.4 MB (951 kb/s),
  `moov` before `mdat` (+faststart); check frames at 0:14 / 0:30 / 0:47 / 1:20 inspected; 0 console errors during capture;
  `npm run verify` on the rebuilt production bundle → 0 errors / warnings / failed requests.

**Screenshots** — `docs/images/*.webp` (README); video: `previews/pakciv-demo.mp4` (local only)

## 03 · First-time Welcome & interactive walkthrough (2026-11-27)
**Built**
- **Welcome / Getting Started modal** — appears after the opening fly-in on a first visit (skipped for shared deep links).
  Explains the hex-board idea in two plain sentences, then shows every capability as a clickable card with counts read
  from the data: 24 lenses, 47 cities, 46 wonders, 7 story tours, 8 eras, 2022 flood replay (10 satellite snapshots),
  District Explorer (160 districts), District Duel, Surprise me, light & relief, Search (418 places), Almanac (23 sources).
  Actions: **Start interactive walkthrough** or **Jump right in**; "Don't show this again" persists in localStorage; a
  highlighted **❔ Guide** button (and `?` / `G`) reopens it any time. Almanac moved to `A`.
- **19-step spotlight walkthrough** on the real UI — each step spotlights the actual control and runs a live demo:
  camera orbit, relief slider sweep, Day→Golden→Night cycle, clicking a tile, City View (Karachi), yields bar, lens switch
  (Mother tongue → Literacy), legend brushing, layers (corridors at night), flood surge playback, Era Time-Machine,
  tour menu, District Explorer, District Duel (Lahore vs South Karachi), Search (types "tarbela"), Surprise me, Almanac,
  and a finale offering the K2 tour. Step counter `n / 19`, progress dots, Back / Next / Skip, ← → Enter / Esc.
- `npm run verify` now also exercises the guide end to end (welcome, don't-show persistence, all 19 steps, Back, Esc) —
  production build: **0 console errors / warnings / failed requests**.

**Screenshots** — `previews/13-welcome.png`, `14-walkthrough-lenses.png`, `15-walkthrough-city-tile.png`,
`16-walkthrough-flood.png`, `17-walkthrough-duel.png`, `18-walkthrough-finish.png`

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
