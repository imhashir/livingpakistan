# PakCiv — End-to-End Build Brief for Claude Code

## Mission
Build **PakCiv**: a Civilization-style interactive hex-grid data atlas of Pakistan, inspired by Andrej Karpathy's [usaciv](https://karpathy.ai/usaciv/) (from [this X post](https://x.com/karpathy/status/2125779541952246039)).

You own this **end to end**: deep research, downloading and parsing real public datasets, designing creative Pakistan-specific capabilities that go beyond a plain clone, building the full data pipeline + interactive web app, verifying everything visually with headless browser screenshots, and committing & pushing your progress continuously to `origin main` (`https://github.com/imhashir/pakciv`).

## Reference Material Already on Disk
- `docs/pakciv-data-sources.md` — a verified audit of all 31 sources in `usaciv` (`https://karpathy.ai/usaciv/data/sources.json` & `https://karpathy.ai/usaciv/usaciv-source.zip`) mapped to Pakistan and global datasets, with URLs, formats, gaps, and v1 recommendations.
- Feel free to inspect `https://karpathy.ai/usaciv/` and `https://karpathy.ai/usaciv/usaciv-source.zip` directly for architectural inspiration, UX polish, Almanac/source-attribution standards, and Canvas 2D hex rendering patterns.

## Core Design Principles
1. **Real data only — never fabricate numbers.** Every metric, yield, lens, city stat, and wonder must trace back to a real downloaded dataset with source name, vintage, URL, and honest caveats in an in-app Almanac (`sources.json`). Where a metric is modelled (e.g., district-level Gold/GDP via VIIRS nightlights + Kummu gridded GDP reconciled with provincial/national accounts), label it clearly as modelled.
2. **Make it unmistakably Pakistani, not just a reskinned US map.** Lean into what makes Pakistan's geography, economy, and civilization extraordinary:
   - **15–20 km hex grid** covering Pakistan (including AJK & Gilgit-Baltistan, with clean handling of disputed/boundary conventions as standard in open datasets).
   - **Indus Basin & Irrigation ("Food" & Rivers):** Rivers, barrages, dams (Tarbela, Mangla, Diamer-Bhasha, Sukkur, Guddu, Taunsa, etc.), canal command areas, and agricultural crop dominance (wheat, rice, cotton, sugarcane).
   - **City Districts / Specializations:** Real economic clusters from the 2023 Economic Census (PSIC) & known industrial hubs — e.g. Faisalabad (Textiles), Sialkot (Surgical/Sports/Leather), Karachi (Port/Finance/Manufacturing), Lahore (Tech/Culture/Services), Islamabad/Rawalpindi (Capital/Campus), Gujranwala (Light Engineering), Multan (Agri/Cotton), Peshawar (Trade/Frontier), Quetta (Minerals/Trade), Gwadar (Deep-Sea Port).
   - **Energy & Strategic Resources:** Power plants (hydro, nuclear, coal/Thar, RLNG, wind/Jhimpir-Gharo, solar/Quaid-e-Azam Solar Park), mines & minerals (Thar coal, Reko Diq, Saindak, Khewra Salt Mine, marble/chromite).
   - **Wonders (Natural & Cultural):** K2 / Karakoram, Nanga Parbat, Mohenjo-daro, Taxila, Lahore Fort & Shalimar Gardens, Badshahi Mosque, Makli Necropolis, Rohtas Fort, Faisal Mosque, Hingol National Park, Deosai Plains, Karakoram Highway, top universities (NUST, LUMS, GIKI, Aga Khan, etc.).
   - **Pakistan-native Lenses:** Population density, Literacy, Multidimensional Poverty (MPI), Urban share, Mother Tongue / Languages, Religion / Faith, Elevation & Terrain, Land Cover (Farmland / Forest / Desert / Glacier / Built-up), Nightlights / Modelled GDP (Gold), Energy & Grid, 2022 Mega-Floods & Seismic Hazard (USGS Earthquakes).
   - **City View, Advisors & District Explorer:** Click any major city for its City View (yields, districts, workforce/citizens, local wonders, nearby resources); Advisors panel (Land & Water, Energy & Resources, People, Prosperity/MPI, Knowledge, Commerce, Culture); District Explorer (sortable table + interactive scatter plot linked to the hex map across all ~160 districts).
   - **Go further creatively:** Add thoughtful extra capabilities that elevate the experience — e.g., CPEC / motorway & railway trade-route overlay, seasonal flood/monsoon risk toggle, district comparison mode, search/jump-to-district or city, or interactive yield/lens storytelling.

## Workflow, Git & Visual Progress Requirements
1. **Commit & push frequently** to `origin main` (`git add`, `git commit`, `git push`) at every meaningful milestone (data pipeline setup, dataset downloads/cleaning, hex grid builder, core map render, lenses, City View, Explorer, polish, etc.). Keep large raw rasters/downloads out of git via `.gitignore` (commit scripts, processed compact JSON/topojson/hex data, and docs).
2. **Capture visual progress screenshots** in `previews/` (e.g., `previews/01-hex-terrain.png`, `previews/02-cities-lenses.png`, `previews/03-city-view-explorer.png`, `previews/04-final-polish.png`) using Playwright/Chromium or a headless browser against the running local dev server at 1280×800 or 1440×900.
3. **Write a short `PROGRESS.md` log** whenever you hit a major milestone or save a new screenshot in `previews/`, noting what was built, which datasets were integrated, and which screenshot to inspect — so the PakCiv coordinator bot can immediately share visual updates with Hashir.
4. **Verify before finishing:** Make sure the production build / static bundle runs cleanly with zero console errors, all lenses and panels work, and every source is cited in the in-app Almanac.
