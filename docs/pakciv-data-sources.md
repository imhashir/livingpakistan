# PakCiv data-source audit

**Question:** Do we have enough *real, accessible, public* data to build a Pakistan version of Andrej Karpathy’s [usaciv](https://karpathy.ai/usaciv/) (announced in [this X post](https://x.com/karpathy/status/2125779541952246039))?

**Answer in one line:** **Yes, with caveats — roughly 80% of the usaciv *map experience* can be shipped from clean machine-readable sources.** The map, terrain, cities, yields, many lenses, infrastructure, energy, wonders and a City View are feasible. The main gap is official district-level GDP and US-grade industry/workforce microdata; nightlights + gridded GDP + the 2023 Economic Census get you most of the way.

**Research date:** 27 Nov 2026 (Asia/Karachi).  
**Method:** Downloaded and parsed the official usaciv catalog at [`https://karpathy.ai/usaciv/data/sources.json`](https://karpathy.ai/usaciv/data/sources.json) (exactly 31 sources) and the MIT source zip [`https://karpathy.ai/usaciv/usaciv-source.zip`](https://karpathy.ai/usaciv/usaciv-source.zip) (README, `docs/DATA_CONTRACTS.md`, `web/data/{lenses,wonders,districts,nation}.json`). Then spot-checked Pakistan and global portals (HTTP status, format, and in key cases file bytes).

---

## 1. Executive verdict

| | |
|---|---|
| **Feasibility** | **Partial-to-yes.** A compelling PakCiv v1 is buildable without inventing numbers. |
| **Share of usaciv you can match cleanly** | **~80% of the product** (terrain, hex map, population, land cover, infrastructure, energy, ports/airports, parks, wonders, faith, literacy, poverty, disasters, city industry badges). **~50–60% of the US *official statistical richness*** (no BEA-style district GDP, no ACS commute/home-value/broadband at county quality, no FAF freight matrix, no DoD base+payroll layer). |
| **#1 difference vs the US** | The US has **official county GDP (BEA CAGDP2)** and **official county industry employment (BLS QCEW)**. Pakistan does **not** publish a nationwide official district GDP. The secret weapon for Pakistan is the opposite of what people assume: **global high-resolution geospatial layers that already cover the country cleanly**, plus **HDX admin boundaries**, **PBS Census 2023**, **Economic Census 2023 district workforce-by-PSIC (Excel, verified)**, **UNDP/Planning Commission MPI**, and **Agricultural Census 2024**. Gold (GDP) is the layer you *proxy* (VIIRS nightlights + Kummu/Wang gridded GDP + provincial accounts), not the layer you download as an official table. |

**What this is not:** a claim that Pakistan has a Census/BEA/BLS clone. It does not. It *does* have enough public geography and official district tables to make a Civ-style atlas that feels as real as usaciv — and in a few places (Indus irrigation, 2022 floods, mother-tongue, official religion counts) it can be *more* interesting than a straight clone.

---

## 2. What Karpathy’s `usaciv` actually uses

Pulled from the live site and source package; not inferred from the tweet.

### Architecture

- Visualizer, not a turn-based game. Static ES modules + Canvas 2D; Python standard-library pipeline; no API keys for the 31 federal/public downloads.
- Lower 48 only, Albers equal-area, **25 km hexes** (about 50 km corner-to-corner; 117 × 90 grid).
- Terrain from elevation samples + dominant land cover per hex.
- Cities = Census CBSA metro/micro areas (524), placed at the principal city.
- Every number traces to the in-app Almanac (`sources.json`).

### Yields (Civ language ← real measures)

| Yield | What it actually is |
|---|---|
| **Gold** | GDP from BEA CAGDP2 (workplace / where activity happens). |
| **Food** | ACS workers in agriculture, forestry, fishing & hunting (residence-based). |
| **Production** | ACS workers in manufacturing, construction and mining. |
| **Science** | ACS workers in professional, scientific & technical services + information. |
| **Culture** | ACS workers in arts, entertainment and recreation. |

GDP and jobs are deliberately different geographies (workplace vs residence). Missing/suppressed values stay `null`, never zero.

### 19 lenses (from `web/data/lenses.json`)

Groups: People, Prosperity, Knowledge, Daily life, Faith, Hazards, Land.

1. Population (density)  
2. Income  
3. Home value  
4. Poverty  
5. Median age  
6. Born abroad  
7. Degrees  
8. Broadband  
9. Commute  
10. Homeowners  
11. Uninsured  
12. Forest  
13. Farmland  
14. Built-up  
15. Faith  
16. Largest tradition  
17. Wellbeing  
18. Disasters  
19. Veterans  

### City View, districts, advisors, wonders

- **City View citizens:** occupation, age, commute, education, place of birth (ACS 1-year).
- **10 district types** from BLS QCEW location quotients (threshold rule: LQ ≥ 1.25 and ≥ 1,000 jobs or 1% of metro jobs, or a listed specialty with LQ ≥ 3): **Campus, Commercial hub, Industrial zone, Harbor, Theater square, Entertainment complex, Aerodrome, Government plaza, Encampment, Aqueduct & dam.** City badges such as “Tech city”, “Motor city”, “Finance capital”, “Port city”, “College town”, “Seat of government”.
- **9 advisors + Explorer:** Energy & Resources, Economy, People, Prosperity & Housing, Knowledge, Land, Military, Commerce, Culture. Explorer turns any column for states, metros, or 3,100+ counties into a table and scatter plot, linked to the map.
- **52 wonders, published rules:** 15 most-visited lower-48 National Parks (2025 NPS visits) + 5 most-visited other park units; 20 universities with the most NSF HERD R&D among R1 schools (max 2 per metro); 12 hand-picked National Historic Landmarks (curated, max one per metro).
- **Infrastructure:** Natural Earth roads/rail; USACE principal ports by tonnage; FAA enplanements + cargo.
- **Resources:** EIA-860M generators (by fuel, size thresholds), EIA/MSHA coal mines, EIA shale plays.
- **Trade:** 40 largest interstate FAF5 freight flows by value.
- **Military:** DoD MIRTA installations + ranges, DMDC personnel by state, OLDCC defense spending by state, ACS veterans.
- **Disasters:** OpenFEMA major-disaster declarations (county) + NOAA billion-dollar weather disasters (state).

### The exact 31 sources (`sources.json`)

| # | `id` | Title (publisher) | Vintage | Used for |
|---|---|---|---|---|
| 1 | `acs_1yr` | ACS 1-year estimates (Census) | ACS 2025 1-year | City yields & panels, state panels, national top bar, City View citizens |
| 2 | `acs_5yr` | ACS 5-year estimates, counties (Census) | ACS 2024 5-year | County lenses; veterans; metro GDP population-share splits |
| 3 | `bea_cagdp2` | GDP by county and industry (BEA) | 2024 | Gold yield, city/state/national GDP, Economy advisor |
| 4 | `bls_qcew` | QCEW annual averages by county (BLS) | 2025 | Districts, city-type badges |
| 5 | `cbsa_delineation` | CBSA delineation files (Census/OMB) | July 2023 | Metro/micro membership |
| 6 | `cdc_places` | PLACES county health (CDC) | 2025 | Wellbeing lens |
| 7 | `census_boundaries` | Cartographic boundary files (Census) | 2023 | State/county polygons on the hex grid |
| 8 | `census_gazetteer` | Gazetteer files (Census) | 2024 | Metro, county, place points |
| 9 | `dmdc` | Military & DoD civilian personnel by state (DMDC) | 30 Sep 2026 | Military advisor |
| 10 | `eia_860m` | Preliminary Monthly Electric Generator Inventory (EIA) | Oct 2026 | Power-plant resources |
| 11 | `eia_coal` | Historical detailed coal production, mine level (EIA/MSHA) | 2025 | Coal mines |
| 12 | `eia_shale_plays` | Tight oil and shale gas plays, Lower 48 (EIA) | 2015–2021 boundaries | Shale-play resources |
| 13 | `etopo` | ETOPO1 global relief (NOAA) | 1 arc-minute, ~9 km samples | Elevation / terrain |
| 14 | `transport_hubs` (FAA) | Passenger boardings and all-cargo + NASR locations (FAA) | CY2025 | Airports |
| 15 | `faf5` | Freight Analysis Framework FAF5.7.1 (FHWA/BTS) | 2024 | Trade-route arcs |
| 16 | `openfema` | OpenFEMA Disaster Declarations Summaries v2 | as of 2026-11-25 | Disasters lens |
| 17 | `nsf_herd` | Higher Education R&D Survey (NSF) | FY2025 | University wonders |
| 18 | `ipeds` | IPEDS directory + 12-month enrollment (NCES) | 2024–25 | University wonders, college-town rule |
| 19 | `mirta` | Military Installations, Ranges and Training Areas (DoD) | FY2025 | Forts / ranges on the map |
| 20 | `msha_mines` | Mines data set (MSHA) | retrieved 2026-11-25 | Mines |
| 21 | `natural_earth_50m` | Natural Earth 1:50m countries, lakes, rivers | v5.1.2 | Coasts, lakes, rivers |
| 22 | `natural_earth_10m` | Natural Earth 1:10m roads and railroads | v5.1.2 | Highways and rail |
| 23 | `nrhp_nhl` | National Historic Landmarks GIS (NPS) | — | Landmark wonder coordinates |
| 24 | `nlcd` | National Land Cover Database 2021 (USGS/MRLC) | 2021, ~2 km resample | Terrain colour; forest / farmland / built-up lenses |
| 25 | `noaa_billion` | Billion-dollar weather and climate disasters (NOAA NCEI) | 1980–2024 | Disasters advisor |
| 26 | `nps_boundaries` | NPS Land Resources Division boundaries | edited 2026-11-20 | Park wonders |
| 27 | `nps_visits` | NPS recreation visits by park unit | 2025 | Park wonder ranking |
| 28 | `oldcc` | Defense Spending by State (DoD OLDCC) | FY2024 | Military advisor dollars |
| 29 | `pep_population` | Population estimates vintage series (Census PEP) | vintage 2025 | Population growth |
| 30 | `usace_ports` | Principal Ports of the United States, tonnage (USACE) | CY2023 | Ports |
| 31 | `usrc_2020` | 2020 U.S. Religion Census, county file (ASARB/ARDA) | 2020 | Faith lenses |

Source catalog, SHA-256s and download URLs: [karpathy.ai/usaciv/data/sources.json](https://karpathy.ai/usaciv/data/sources.json).

---

## 3. Layer-by-layer Pakistan data source matrix

Granularity key: **hex/grid** = raster or points that can be aggregated to ~10–25 km hexes; **district** ≈ US county (~160 in the 2023 census frame; later notifications push the live count toward ~170+); **tehsil** = admin 3; **city** = urban district / agglomeration (Pakistan has no CBSA file).

**Directness:** API / CSV / GeoJSON / GeoTIFF / official Excel = clean. PDF or dashboard-only = friction. Login / request / sensitive = hard.

Verification notes are from 27 Nov 2026. “Verified” means this research fetched a live URL (or a documented direct file) and confirmed status/format. “Indexed / documented” means the dataset is clearly published but this environment hit a bot challenge, TLS quirk, or login wall.

### 3.1 Base map, terrain, land cover, hydrology

| usaciv layer | Pakistan source(s) | Granularity | Format & directness | Quality / caveats | URL / access |
|---|---|---|---|---|---|
| Admin polygons (states/counties) | **HDX COD-AB Pakistan** (OCHA): admin 0–3, 7 province/territory units, **160 districts, 577 tehsils** (2022 frame, reviewed Sep 2024). Edge-matched COD-EM also exists for cartography. | Province / district / tehsil | **GeoJSON, Shapefile, GDB, XLSX — direct download** | Best open gazetteer with P-codes. **Does not automatically match post-2023 district splits** (~173 districts discussed in 2025–26). PBS maintains official GIS internally but **does not publish a public shapefile** (HQ request; soft copies may be charged). Use a COD-AB ↔ Census 2023 crosswalk (Data Darbar publishes one). | [data.humdata.org/dataset/cod-ab-pak](https://data.humdata.org/dataset/cod-ab-pak) (page indexed; this fetch got HTTP 202 from a bot/WAF). GeoJSON resource id `c6521e04-…`. |
| Elevation | **Copernicus DEM GLO-30** (best); **SRTM**; or **ETOPO1** (exactly what usaciv uses — already global). | ~30 m / 90 m / 1 arc-min | **GeoTIFF on public S3 / NOAA ERDDAP — no key** for GLO-30 public tiles and ETOPO | GLO-30 is the right call for the Karakoram/Hindu Kush; ETOPO is enough for a 25 km hex (usaciv sampled ~9 km). | [registry.opendata.aws/copernicus-dem](https://registry.opendata.aws/copernicus-dem/); tile list at `copernicus-dem-30m.s3.amazonaws.com/tileList.txt`. ETOPO as in usaciv. |
| Land cover; forest / farmland / built-up lenses | **ESA WorldCover 2021** (10 m); fallback **MODIS IGBP** or **GHSL built-up**. | 10 m raster → hex shares | **GeoTIFF tiles, public S3**; or ESA download script by country | Clean global equivalent of NLCD. Classes include tree cover, cropland, grassland, shrubland, built-up, bare, snow, water, wetland. WorldCover 2021 downloader was TLS-flaky from this box; S3 URL pattern is documented: `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{TILE}_Map.tif`. | [worldcover2021.esa.int/download](https://worldcover2021.esa.int/download); [github.com/ESA-WorldCover/esa-worldcover-datasets](https://github.com/ESA-WorldCover/esa-worldcover-datasets) |
| Coasts, lakes, major rivers, generalized roads/rail | **Natural Earth** 10m/50m (same files usaciv already uses — they cover Pakistan). Sharper: **OSM / Geofabrik Pakistan** or **Overture Maps**. | National lines | **Shapefile / PBF / GeoPackage — direct** | Natural Earth 10m roads zip **verified** (HTTP 200, `application/zip`, ~9.1 MB). Geofabrik `pakistan-latest.osm.pbf` **verified live** (~158 MB, redirected to a dated file `pakistan-261125.osm.pbf`). | [naciscdn.org/naturalearth/10m/cultural/ne_10m_roads.zip](https://naciscdn.org/naturalearth/10m/cultural/ne_10m_roads.zip); [download.geofabrik.de/asia/pakistan-latest.osm.pbf](https://download.geofabrik.de/asia/pakistan-latest.osm.pbf) |
| Rivers, basins, irrigation potential | **HydroSHEDS / HydroATLAS** river network; **Global Dam Watch / GRanD** dams & reservoirs; OSM canals/barrages; NCC/WAPDA maps for named barrages (Sukkur, Guddu, Kotri, Taunsa, Chashma, Jinnah, etc.). | Grid + points | **GeoTIFF / shapefile, CC-BY** (GDW) | This is Pakistan’s *distinctive* Food/Aqueduct layer. GRanD/GDW will catch Tarbela, Mangla, Warsak, Diamer-Bhasha (as applicable) and large reservoirs; **barrages and the canal grid need OSM + a small curated list** — GRanD under-counts irrigation barrages. Global Dam Watch page **verified** HTTP 200. | [www.globaldamwatch.org/database](https://www.globaldamwatch.org/database); [www.hydrosheds.org/hydrosheds-core-downloads](https://www.hydrosheds.org/hydrosheds-core-downloads) |
| Built-up / urban extents | **GHSL** (GHS-BUILT, GHS-POP, GHS-SMOD); **WorldPop** constrained 100 m; **Meta HRSL**. | 100 m / 1 km | **GeoTIFF — direct FTP / HDX country extract** | Use for spreading district population across hexes (same trick usaciv uses with ACS). GHSL R2023A is on JRC FTP; HDX has a Pakistan GHSL extract. | [human-settlement.emergency.copernicus.eu/downloadWizard.php](https://human-settlement.emergency.copernicus.eu/downloadWizard.php); [data.humdata.org](https://data.humdata.org) Pakistan GHSL |

### 3.2 People, prosperity, knowledge, daily life (lenses + City View)

| usaciv layer | Pakistan source(s) | Granularity | Format & directness | Quality / caveats | URL / access |
|---|---|---|---|---|---|
| Population, density, urban/rural, sex, household size, 2017–2023 growth | **PBS Population & Housing Census 2023, Table 1** (and provincial district PDFs). Raster: **WorldPop R2025A 100 m / 1 km** for hex allocation. | District, tehsil (tables); 100 m (raster) | Official: **PDF verified**; PBS says Excel is also on the site, but the obvious sibling `.xlsx` URLs **404’d** in this check. Third-party tidy CSVs/Parquet exist (PPRI, Data Darbar) parsed from official Excel. WorldPop GeoTIFF is a public direct download. | National population 241.5 million (Table 1). Best official people layer. **Treat Data Darbar / PPRI as convenience extracts of PBS, not as a second official source.** WorldPop R2025A is an alpha product (CC-BY 4.0). HDX COD-PS for Pakistan is still **2017** — do not use it as the 2023 population join. | Table 1 national PDF **verified**: [table_1_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_1_national.pdf). Punjab districts PDF **verified**: [table_1_punjab_districts.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_1_punjab_districts.pdf). Table list: [LIST-OF-STATICTICAL-TABLES…2023.pdf](https://www.pbs.gov.pk/wp-content/uploads/2020/07/LIST-OF-STATICTICAL-TABLES-OF-POPULATION-AND-HOUSEING-CENSUS-2023.pdf). WorldPop: [hub.worldpop.org](https://hub.worldpop.org/geodata/summary?id=74863); e.g. `data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/PAK/…`. Convenience CSV: [ppripakistan.github.io/data/published/census_2023_districts.csv](https://ppripakistan.github.io/data/published/census_2023_districts.csv). |
| Median age, age structure | Census 2023 **Table 4 / age tables** (single-year and groups, rural/urban). | District / tehsil | PDF (Excel claimed) | Good enough for an Age lens and City View age row. Not a 1-year ACS-style update. | e.g. [Table_4_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/Table_4_national.pdf) |
| Literacy / “Degrees” | Census 2023 **Table 12** (literacy, enrolment, out-of-school). PSLM 2019–20 district survey for a slightly older but richer education set. HEC for university enrolment (not a district census). | District / tehsil | **PDF verified** for Table 12; PSLM reports + microdata on PBS | Literacy is the honest “knowledge” lens (bachelor’s-share exists in some PSLM/HIES tables but is thinner than ACS B15003). Do not fake a US-style bachelor’s map from literacy alone — label it Literacy. | [table_12_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_12_national.pdf) **verified**. PSLM: [pbs.gov.pk/pslm-3](https://www.pbs.gov.pk/pslm-3/) **verified** 200. The PSLM SDG dashboard (`pslm-sdgs.data.gov.pk/districtlevel`) returned **HTTP 500** at check time — don’t depend on it. |
| Faith / largest tradition | Census 2023 **Table 9: population by sex, religion and rural/urban**. | District / tehsil | **PDF verified** | **Better conceptual fit than the US Religion Census.** This is a full enumeration of residents’ religion (Muslim, Christian, Hindu, Ahmadi, Scheduled Castes, others), not congregation adherent counts covering ~half the population. Handle Ahmadi and minority figures carefully and cite PBS. | [table_9_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_9_national.pdf) **verified** |
| Language (PakCiv-only lens) | Census 2023 **Table 11: mother tongue**. | District / tehsil | PDF | Punjabi, Pashto, Sindhi, Saraiki, Urdu, Balochi, Brahui, Hindko, etc. One of the best “why this is not a US clone” layers. | [table_11_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_11_national.pdf) |
| Poverty / prosperity | **UNDP / OPHI / Planning Commission Multidimensional Poverty Index** (district). PSLM water, sanitation, housing, assets. | District (MPI historically ~140–141 districts, so some alignment work) | Official reports often **PDF**; tidy district MPI also in Data Darbar Parquet / older HDX “Pakistan MPI” | Use MPI (and headcount H, intensity A) as the Poverty lens — more honest than a missing official income-poverty line at district. Vintage may lag (PSLM 2014–15 classic MPI; later updates exist from 2019–20 microdata). | Report: [pc.gov.pk/uploads/report/Multidimensional-Poverty-in-Pakistan.pdf](https://pc.gov.pk/uploads/report/Multidimensional-Poverty-in-Pakistan.pdf); union-council update PDF also on pc.gov.pk. HDX: [data.humdata.org/en/dataset/pakistan-mpi](https://data.humdata.org/en/dataset/pakistan-mpi). |
| Income, home value, rent, commute, broadband, uninsured, veterans | **No clean national district equivalents.** Partial: HIES (income/expenditure, mostly **provincial**); PSLM (some ICT / housing); PTA (telecom, not district); Census housing Tables 20–25 (tenure, rooms, water, toilet, cooking fuel). | Mostly provincial, some district housing | PDF / microdata | **Drop or replace these US lenses** rather than inventing numbers. Substitutes: MPI, literacy, piped-water / sanitation, electricity-as-lighting (Table 22), urban share, nightlights per capita. “Uninsured” and “Veterans” are the wrong concepts; see gaps. | HIES / PSLM on [pbs.gov.pk](https://www.pbs.gov.pk/pslm-3/). Census housing PDFs under `/census_tables/tables/table_2x_*.pdf`. |
| Born abroad / origin | Census **Table 10: nationality**. Overseas-Pakistani / remittance story is national (SBP), not a clean district “foreign-born” map. | District (nationality); national (remittances) | PDF; SBP EasyData for remittances | Afghan / other nationality shares are real in some districts; not the same as US foreign-born. Afghan refugee data also lives on UNHCR/HDX, with quality caveats. | [table_10_national.pdf](https://www.pbs.gov.pk/wp-content/uploads/census_tables/tables/table_10_national.pdf). SBP EasyData **verified**: [easydata.sbp.org.pk](https://easydata.sbp.org.pk/) (Apex app, HTTP 200). |
| Wellbeing / health | No CDC PLACES. Use **PSLM health indicators**, **DHS** (regional), or a simple amenities index from PSLM (immunization, skilled birth, illness treatment). HDX health-facility lists (often OSM-derived) for hospital points, not a health *index*. | District (PSLM) / region (DHS) | Reports + microdata; OSM/HDX points | Build a modest index and cite it as survey-based, like usaciv cites PLACES model estimates. | PBS PSLM; HDX Pakistan health facilities / COD. |
| Labour force / unemployment | **PBS Labour Force Survey 2024–25** (annual report live). | **Provincial + urban/rural**, not district | **PDF report** (microdata may be requestable) | Good for a national/provincial top bar and advisor, **not** a district unemployment lens. | [pbs.gov.pk/labour-force-statistics](https://www.pbs.gov.pk/labour-force-statistics/) **verified**. Report: [LFS-2024-25-Annual-Report.pdf](https://www.pbs.gov.pk/wp-content/uploads/2020/07/LFS-2024-25-Annual-Report.pdf). |

### 3.3 Gold, jobs, districts (the hard economic core)

| usaciv layer | Pakistan source(s) | Granularity | Format & directness | Quality / caveats | URL / access |
|---|---|---|---|---|---|
| **Gold = GDP** | **No official nationwide district GDP.** Workarounds, in order of usefulness: (1) **Kummu et al. gridded GDP / GDP per capita (PPP), 1990–2024** (5 arc-min); (2) **VIIRS night-time lights** (EOG VNL / NASA Black Marble) allocated to districts and hexes; (3) **Wang & Sun 1 km GDP** (older vintage); (4) **DOSE** reported sub-national output where available; (5) **provincial GDP research estimates** (KP and AJK have nightlights-based district studies; these are *models*, not PBS national accounts). PBS national accounts are **national only**. | Grid / modelled district | GeoTIFF (Kummu, VIIRS); Excel models in PDFs for KP/AJK | **This is the central statistical gap.** Be explicit in the Almanac: Gold is a *modelled* yield, not BEA. EOG VNL page **verified** HTTP 200. Zenodo Kummu record `18429133` is the current documented dataset; this environment received HTTP 403 (common Zenodo bot block) — the record itself is real. | Kummu: [zenodo.org/records/18429133](https://zenodo.org/records/18429133), [github.com/mattikummu/griddedGDPpc](https://github.com/mattikummu/griddedGDPpc). VIIRS: [eogdata.mines.edu/products/vnl](https://eogdata.mines.edu/products/vnl/). PBS NA: [pbs.gov.pk/national-accounts-2](https://www.pbs.gov.pk/national-accounts-2/). |
| Jobs / yields / **industry districts** | **Economic Census 2023, district Table 1: establishments and workforce by PSIC major category** (and Tables 2–4 by unit type and employment size). This is the closest thing Pakistan has to BLS QCEW. | **District** (Punjab, Sindh, KP, Balochistan Excel files). ICT in national detailed tables. | **Official Excel — verified live xlsx** | Inspected `PUNJAB-DISTRICTS-PSIC-wise-1.xlsx` (HTTP 200, 42,417 bytes, real xlsx). Columns: district, PSIC section, establishments, workforce. Sections include agriculture, mining, manufacturing, utilities, construction, trade, transport, accommodation, **information and communication**, **finance and insurance**, professional/scientific, public administration & defence, education, health, **arts/entertainment**, etc. Workplace-based — actually closer to QCEW than ACS. Limitations: **major PSIC sections, not 4-digit specialties** (you will not automatically get “surgical instruments” or “sports goods” without unit-type + local knowledge / CMI). Almost all establishments have <10 workers. AJK/GB may be thinner. | Landing page **verified**: [pbs.gov.pk/…economic-statistics-production](https://www.pbs.gov.pk/pakistan-bureau-of-statistics-economic-statistics-production/). Example files: [PUNJAB-DISTRICTS-PSIC-wise-1.xlsx](https://www.pbs.gov.pk/wp-content/uploads/2020/07/PUNJAB-DISTRICTS-PSIC-wise-1.xlsx), [SINDH-DISTRICTS-PSIC-WISE.xlsx](https://www.pbs.gov.pk/wp-content/uploads/2020/07/SINDH-DISTRICTS-PSIC-WISE.xlsx), [KPK-DISTRICTPSIC-WISE.xlsx](https://www.pbs.gov.pk/wp-content/uploads/2020/07/KPK-DISTRICTPSIC-WISE.xlsx), [BALOCHISTAN-DISTRICTPSIC-WISE.xlsx](https://www.pbs.gov.pk/wp-content/uploads/2020/07/BALOCHISTAN-DISTRICTPSIC-WISE.xlsx), plus unit-type and employment-category workbooks on the same page; bundled [EC_data_in_excel-1.xlsx](https://www.pbs.gov.pk/wp-content/uploads/2020/07/EC_data_in_excel-1.xlsx). Dashboard: [economic.data.gov.pk](https://economic.data.gov.pk/) (HTTP 200). |
| Food yield (crops, not just farm workers) | **Agricultural Census 2024** district crop tables (wheat, rice/paddy, cotton, etc.); land-cover cropland share; GRanD irrigation. | District | Official Excel+PDF on PBS agriculture-census page; dashboard HTTP 200; tidy Parquet via Data Darbar | **Use both** Economic Census farm workforce *and* Agri Census area/yield. This is how PakCiv Food can be more real than usaciv’s “farm workers only” definition. | [pbs.gov.pk/agriculture-census](https://www.pbs.gov.pk/agriculture-census/) **verified**; dashboard [iacdashboard.pbos.gov.pk](https://iacdashboard.pbos.gov.pk/) **verified**. |
| Metro delineations | **None official like OMB CBSA.** Build a small, published rule: e.g. city districts + contiguous urban GHSL cells, or a curated list of ~30–50 agglomerations (Karachi’s many districts, Lahore, Faisalabad, Rawalpindi–Islamabad, Gujranwala, Multan, Peshawar, Quetta, Hyderabad, Sialkot, etc.). | Custom | You define it, cite GHSL + Census urban | Don’t pretend there are 524 official metros. A tight set of real cities is better. | GHSL SMOD + Census urban areas 2023 (PBS GIS page lists “Urban Areas 2023” as an internal table, not a public download). |

### 3.4 Energy, mines, transport, trade

| usaciv layer | Pakistan source(s) | Granularity | Format & directness | Quality / caveats | URL / access |
|---|---|---|---|---|---|
| Power plants | **WRI Global Power Plant Database** (CSV, country=`PAK`); **Global Energy Monitor** trackers (coal, gas, solar, wind, hydro, nuclear, coal mines); official capacity tables in **NEPRA State of Industry Report** (PDF, plant-wise MW). | Plant points | **GPPD CSV verified** (GitHub raw, HTTP 200, ~12 MB). GEM: download portals (usually free registration). NEPRA 2024 SOI PDF **verified** (HTTP 200, `application/pdf`). | GPPD is slightly stale vs NEPRA/GEM (Thar, new solar/wind). Use GPPD+GEM for coordinates, NEPRA for a capacity cross-check. Data Darbar also publishes a parsed `nepra_plants` table. | [raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv](https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv); [nepra.org.pk/…State of Industry Reports](https://nepra.org.pk/publications/State%20of%20Industry%20Reports.php); 2024 PDF: [State of Industry Report 2024.pdf](https://nepra.org.pk/publications/State%20of%20Industry%20Reports/State%20of%20Industry%20Report%202024.pdf); [globalenergymonitor.org](https://globalenergymonitor.org). |
| Mines / minerals | **GEM coal-mine tracker** (Thar blocks, Lakhra, etc.); **Global Mining Watch** polygons (Zenodo); **USGS MRDS / mineral operations** (points); OSM + a curated list for **Khewra salt, Saindak, Reko Diq, gemstone belts**. | Points / polygons | CSV / shapefile / WFS | Good enough to place resource icons. Production tonnage will be uneven (GEM better for coal than for salt or copper). | [mrdata.usgs.gov/mrds](https://mrdata.usgs.gov/mrds/); Global Mining Watch [doi.org/10.5281/zenodo.6806817](https://doi.org/10.5281/zenodo.6806817); GEM wiki/trackers. |
| Airports | **OurAirports** worldwide CSV (`iso_country=PK`); traffic from **PCAA “Major Traffic Flows by Airports”** (annual PDF). | Points + annual pax | **CSV verified** via the GitHub mirror (ourairports.com cert was expired at check; redirect target [davidmegginson.github.io/ourairports-data/airports.csv](https://davidmegginson.github.io/ourairports-data/airports.csv) is HTTP 200, `text/csv`, 12.8 MB). PCAA stats are **PDF**. | Size airport icons by PCAA passengers (Islamabad / Karachi / Lahore dominate). Open Data Pakistan also hosts an older aviation-statistics zip. | OurAirports data page: [ourairports.com/data](https://ourairports.com/data/). PCAA 2024–25 PDF is cited as `pcaawebadmin.pcaa.gov.pk/media/…/major-traffic-flows-by-airports-during-the-year-2024-25.pdf`. |
| Ports | **NGA World Port Index** (Karachi, Port Qasim, Gwadar, and smaller harbours); OSM; annual tonnage in **KPT / PQA / GPA / Gwadar** reports (PDF). | Points | WPI usually CSV/shapefile from NGA MSI; this check got **HTTP 503** on [msi.nga.mil/Publications/WPI](https://msi.nga.mil/Publications/WPI) (portal blip). FAO and other catalogs mirror WPI. | Three commercial hubs are enough for a beautiful map. Tonnage will need a small PDF scrape or a curated table, updated yearly. | NGA WPI; FAO catalog dataset “Sea ports (Global) - World Port Index”. |
| Roads, motorways, CPEC, rail | **OSM / Overture** (best geometry); **Natural Earth** (already in usaciv); **NHA maps** (interactive, **no official national shapefile** found); **Pakistan Railways** network from OSM / HDX HOTOSM extracts. | Lines | PBF / GeoJSON **direct** | Draw M-1…M-9, N-5, N-35 (KKH), CPEC alignments, and the main PR broad-gauge spine. Official NHA site **verified** HTTP 200 but is a map viewer, not a data dump. | Geofabrik (above); [nha.gov.pk/maps](https://www.nha.gov.pk/maps); HDX “Railways of Pakistan” (HOTOSM). |
| Freight / trade routes | **No FAF equivalent** (no official OD freight matrix by value between districts). Proxies: stylized **CPEC / N-5 / ML-1 corridors**; port import/export totals; PR freight tonnes (usually PDF); UN Comtrade (national). | Corridor / national | Mixed, mostly PDF or national API | Draw a *handful of named corridors* with a published rule, and say clearly they are not FAF flows. Do not invent tonne-km between Faisalabad and Karachi. | — |

### 3.5 Wonders, universities, parks, military, disasters, climate

| usaciv layer | Pakistan source(s) | Granularity | Format & directness | Quality / caveats | URL / access |
|---|---|---|---|---|---|
| Parks / natural wonders | **Protected Planet / WDPA (WDPCA)** country extract for Pakistan (national parks, wildlife sanctuaries, game reserves). OSM for named parks. | Polygons | Shapefile / GeoJSON (Protected Planet download or HDX `unep_wdpca_pak`) | Protected Planet country page **verified** HTTP 200. **No NPS-style national visitor-use table** — you cannot honestly rank parks by official recreation visits. Publish a rule: e.g. all IUCN national parks + a few high-prominence landscapes (Central Karakoram / K2, Deosai, Hingol, Khunjerab, Kirthar, Ayubia…), or rank by area / Wikipedia prominence, and label the rule. | [protectedplanet.net/en/country/PAK](https://www.protectedplanet.net/en/country/PAK); HDX WDPCA Pakistan. |
| University wonders | **HEC recognised universities and campuses** (official list, web tables — no Excel dump). Enrolment/ranking proxies: HEC data, QS/THE, OpenAlex/Scimago research output (**no NSF HERD R&D dollars**). Geocode via OSM / Wikidata. | Campus points | HTML tables (scrape or manual), then CSV you maintain | HEC pages **verified** HTTP 200. Use a published rule: e.g. “20 largest HEC universities by enrolment, max 2 per city” or “top OpenAlex research output.” Don’t imply R&D spend you don’t have. | [hec.gov.pk/…/recognised.aspx](https://www.hec.gov.pk/english/universities/Pages/recognised.aspx); campuses: [HEC-recognized-Campuses.aspx](https://www.hec.gov.pk/english/universities/Pages/DAIs/HEC-recognized-Campuses.aspx). |
| Landmarks / cultural wonders | **UNESCO World Heritage List** (6 cultural sites in Pakistan) + a curated, published set (Badshahi Mosque, Faisal Mosque, Minar-e-Pakistan, Khewra, Kalash valleys, etc.). Coordinates: UNESCO / Wikidata / OSM. | Points | Machine-readable global WH lists + Wikidata SPARQL | The six inscribed sites: Mohenjo-daro; Taxila; Takht-i-Bahi & Sahr-i-Bahlol; Fort and Shalamar Gardens, Lahore; Makli, Thatta; Rohtas Fort. | UNESCO WH list; Wikidata; e.g. draw-on-a-map style global GeoJSON, filtered to PK. |
| Military | **No public MIRTA / DMDC / OLDCC equivalent** — and you should not try to reconstruct a classified basemap. Public-known points only (if at all): OSM, Wikipedia, clearly labelled “publicly mapped, incomplete, not troop counts.” | Sparse points | OSM / curated | **Recommend a light layer or omit Encampment districts** rather than a fake General advisor. ACS-style veterans share does not exist. | — |
| Disasters | **UNOSAT / HDX 2022 flood extents** (shapefiles); **USGS earthquake catalog** (FDSN CSV API, bbox Pakistan) **verified**; **EM-DAT** (API key or HDX country profile); **GDACS**; **NDMA** situation reports (PDF; some tidy unofficial extracts); PMD / climate. | Flood polygons; quake points; district counts if you geocode EM-DAT / NDMA | Shapefile / CSV API / PDF | The 2022 floods are a once-in-a-generation layer and should be a first-class hazard lens. USGS sample query **verified** `text/csv`. EM-DAT public bulk often needs registration; HDX country profiles are a no-login fallback. NDMA is not an OpenFEMA. | UNOSAT/HDX: [satellite-detected-water-extents-between-03-and-23-august-2022-over-pakistan](https://data.humdata.org/dataset/satellite-detected-water-extents-between-03-and-23-august-2022-over-pakistan); USGS: [earthquake.usgs.gov/fdsnws/event/1](https://earthquake.usgs.gov/fdsnws/event/1/); EM-DAT HDX: [data.humdata.org/dataset/emdat-country-profiles-pak](https://data.humdata.org/dataset/emdat-country-profiles-pak). |
| Climate / solar / rainfall (optional resource lens) | **WorldClim**, **ERA5**, **NASA POWER** (solar irradiance — excellent for a “sun belt” resource), PMD CDPC (station data). | Raster / station | GeoTIFF / API | Nice extras for agriculture yields and solar-plant placement, not required for v1 terrain. PMD: [cdpc.pmd.gov.pk](https://cdpc.pmd.gov.pk/). | WorldClim; NASA POWER; Copernicus CDS (ERA5). |

### 3.6 Other national portals (useful, not always machine-readable)

| Portal | Status at check | What it’s good for |
|---|---|---|
| [pbs.gov.pk](https://www.pbs.gov.pk/) | HTTP 200 | Census, PSLM, LFS, Agri Census, Economic Census, national accounts. |
| [easydata.sbp.org.pk](https://easydata.sbp.org.pk/) | HTTP 200 (Apex) | Macro, remittances, banking, sector series. API typically needs a key (EasyDataPy). Not district GDP. |
| [opendata.com.pk](https://opendata.com.pk/dataset/district-profiles-all-districts-of-pakistan) | HTTP 200 | District profiles (SDPI) and assorted older sets; uneven quality; useful as a lead, not a system of record. |
| `data.gov.pk` root | **HTTP 404** at check | Don’t treat as a reliable national open-data bus. Some subdomain apps (`economic.data.gov.pk`) work. |
| Punjab / PITB, KP, Sindh open-data | Mixed, province-only | Nice supplements (e.g. Punjab facilities) once the national frame is solid. |
| PBS GIS page | HTTP 200, no file dump | Confirms official digital block/district/tehsil layers exist and were used in Census 2023 — they are **not** a public download. |

---

## 4. Pakistan-unique Civ twists (don’t just clone the US)

These are the layers that would make PakCiv *more* interesting than a reskin:

1. **The Indus Basin Irrigation System as Food + Aqueduct.** Barrages, link canals, and canal-colony hexes in Punjab and Sindh should raise Food yield the way US farmland does — except here the “improvement” is 19th–20th century hydraulic engineering (Sukkur, Guddu, Kotri, Taunsa, Chashma, Tarbela, Mangla). Barani (rain-fed) vs irrigated is a real, mappable distinction.
2. **CPEC and the Karakoram Highway as trade routes.** In lieu of FAF, publish a short list of named corridors (KKH / Khunjerab, Eastern Alignment, Gwadar–Ratodero, ML-1, N-5) and size them by a documented proxy (port throughput, or simply “strategic corridor” with no fake tonne-km).
3. **Resource geography that is actually distinctive:** Thar coal, Reko Diq and Saindak copper-gold, Khewra salt, Sui gas, Chagai minerals, gemstones of Gilgit-Baltistan, the Makran coast, and a dense hydropower string on the Indus and its tributaries.
4. **2022 mega-floods (and GLOF / earthquake hazard).** UNOSAT extents can paint a Disasters lens that is more visceral than FEMA declaration counts. Optional second mode: 2005 Kashmir / 2013 Awaran / 2015 Hindu Kush earthquakes from USGS.
5. **Industrial cluster badges the Economic Census *almost* gives you, and local knowledge completes:** Faisalabad (Textile city), Sialkot (Sports / Surgical city), Gujranwala (Workshop city), Karachi (Port / Finance), Lahore (Culture / Services), Islamabad–Rawalpindi (Capital / Garrison), Multan / Rahim Yar Khan (Agro-industry), Gwadar (Port town), Hub (Industrial), Peshawar (Frontier trade). Put the cluster rule in the Almanac (PSIC manufacturing LQ + a curated specialty table) so it is reproducible.
6. **Wonders with civilizational depth:** Mohenjo-daro, Taxila, Makli, Rohtas, Lahore Fort & Shalamar, Badshahi Mosque, Faisal Mosque, K2 / Central Karakoram, Deosai, Hingol’s sphinx, maybe Mohanjo’s “Great Bath” as a named improvement. Six UNESCO sites give you a clean first rule; curated landmarks fill the rest.
7. **Mother-tongue and official religion lenses** from a full census — not congregation estimates. Language is the lens usaciv simply does not have.
8. **Monsoon, glaciers, and the IBIS** as a Land / Water advisor: snowpack and glacier hexes in GB/KP, karez in Balochistan, tidal creeks in the Indus delta.

---

## 5. What’s genuinely missing or hard (and what to do instead)

| Gap | Why it hurts | Practical workaround |
|---|---|---|
| **Official district GDP** | You cannot label Gold “BEA-grade.” | Nightlights + Kummu gridded GDP, allocated to hexes; show provincial totals where official series exist; Almanac caveat in one sentence. |
| **4-digit industry / metro LQ like QCEW** | “Surgical city” won’t fall out of PSIC section 10–33 automatically. | Economic Census major sections + unit type (factories vs shops) for Campus / Industrial / Harbor / Government / Aqueduct; a *small, published* specialty table for Sialkot, Faisalabad, etc. |
| **University R&D spend (NSF HERD)** | Can’t copy the “top 20 by R&D, R1 only” rule. | HEC list + enrolment or OpenAlex/Scimago output; publish the rule. |
| **FAF freight OD flows** | No honest caravan-arc values between cities. | Named corridors (CPEC, N-5, ML-1) without fake dollars. |
| **Military bases, personnel, defense dollars** | Sensitive; no public inventory of the US quality. | Omit or a clearly incomplete public-sources layer. No troop counts. |
| **Official park visitor counts** | Can’t rank wonders like NPS. | WDPA + UNESCO + a curated, documented list (area, inscription, or prominence). |
| **ACS-style commute, home value, broadband, uninsured, veterans** | Would look empty or fake at district level. | Replace the lens set (literacy, MPI, sanitation, electricity, urban share, language, flood exposure). |
| **CBSA metro file** | 524 US metros have no Pakistan analogue. | ~30–50 agglomerations with a written rule. |
| **PBS Census Excel not at predictable URLs; official GIS not public** | PDF scrape or third-party extracts add friction and version risk. | Prefer official Excel where it *is* linked (Economic Census). For population/religion/literacy, either parse PBS PDFs once with a checksum or use a documented extract (Data Darbar / PPRI) **and** keep the PBS PDF as the cited source. Request PBS GIS; ship HDX COD-AB in v1. |
| **Admin-unit drift** | COD-AB 160 districts (2022) vs Census 2023 frame vs later ~170+ notifications. | Freeze a vintage (recommend **Census 2023 district list + HDX/Data Darbar 2023 polygons**), publish a crosswalk, and don’t silently mix 2017, 2022 and 2026 boundaries. |
| **AJK / GB coverage** | Some national tables and Economic Census files are weaker or separately reported. | Include them on the map (they matter for elevation, glaciers, wonders) and allow `null` yields where official tables stop. |
| **EM-DAT / some GEM / Earthdata logins** | A few “global” sources are not quite keyless. | Prefer UNOSAT flood shapefiles, USGS quakes, GPPD, WDPA, which are openly downloadable. |

---

## 6. Recommended MVP data stack (ship v1 without drowning in PDFs)

These are the **cleanest, mostly zero-friction** layers. About 15 datasets. Together they already support: hex terrain, cities, yields (with a modelled Gold), districts, 10+ honest lenses, infrastructure, energy, mines, parks, wonders, and a 2022-flood disaster lens.

| # | Dataset | Why it’s in v1 | Access |
|---|---|---|---|
| 1 | **HDX COD-AB** (admin 0–3) | The county/state layer. | GeoJSON / SHP from [COD-AB Pakistan](https://data.humdata.org/dataset/cod-ab-pak) |
| 2 | **Copernicus DEM GLO-30** (or ETOPO1 if you want usaciv-identical code) | Terrain, mountains, coasts. | Public S3 / NOAA |
| 3 | **ESA WorldCover 2021** | Forest, farmland, built-up, desert, snow, wetland. | Public S3 tiles |
| 4 | **WorldPop 2025 PAK** (100 m or 1 km) or **GHSL-POP** | Spread people onto hexes; urban form. | Direct GeoTIFF |
| 5 | **PBS Census 2023 district tables 1, 9, 11, 12** (and age / housing if energy remains) | Population, growth, religion, language, literacy. | Official PDFs (verified) + one tidy extract with checksums |
| 6 | **Natural Earth 10m/50m + Geofabrik Pakistan OSM** | Rivers, lakes, roads, rail, POIs, mosques, hospitals, industrial areas, campuses. | Direct zip / PBF (**verified**) |
| 7 | **HydroSHEDS + Global Dam Watch / GRanD** | Indus network, reservoirs, big dams. | Direct, CC-BY |
| 8 | **WRI Global Power Plant Database + GEM** | Power-plant icons by fuel. | GPPD CSV **verified** |
| 9 | **OurAirports + World Port Index** | Airports and ports. | OurAirports CSV **verified** (GitHub mirror) |
| 10 | **Economic Census 2023 district PSIC Excel** | Workforce yields + Campus / Industry / Commerce / Harbor / Government / Aqueduct districts. | Official xlsx **verified** |
| 11 | **Agricultural Census 2024 district crop tables** | Food yield that reflects wheat/rice/cotton, not just “farm workers.” | PBS page + Excel/PDF |
| 12 | **District MPI** (UNDP / Planning Commission, tidy table) | Poverty lens. | Report + extract / HDX |
| 13 | **VIIRS VNL (EOG) + Kummu gridded GDP** | Gold yield proxy. | EOG **verified**; Kummu on Zenodo |
| 14 | **WDPA Pakistan + UNESCO WH + HEC campuses** | Parks and wonders (with a written rule, not visitor counts / R&D $). | Protected Planet **verified**; HEC **verified** |
| 15 | **UNOSAT 2022 flood extents + USGS ComCat** | Disasters lens. | HDX shapefile; USGS CSV API **verified** |

**Optional v1.1 (still clean):** NEPRA SOI plant list as a capacity audit; PCAA traffic PDF for airport sizing; a 20-row curated “cluster badge” table; NASA POWER solar; a short barrage/canal OSM extract.

**Defer (high friction, low incremental magic):** LFS microdata, official PBS GIS request, freight matrices, military, ACS-clone prosperity lenses, scraping every PCAA/KPT annual report to the last tonne.

### Suggested product choices for v1

- **Grid:** 15 or 20 km hexes (Pakistan is ~1/10 the area of the CONUS; 25 km works but 15 km respects canals, tehsils, and the Karakoram).
- **Cities:** ~30–50 agglomerations, not 524 metros.
- **Lenses to ship:** Population, Literacy, MPI/Poverty, Median age, Urban share, Faith, Largest tradition, **Mother tongue**, Forest, Farmland, Built-up, **Flood / disaster**, (optional) Nightlights or modelled income.  
  **Lenses to skip in v1:** Home value, Commute, Broadband, Uninsured, Veterans.
- **Advisors:** Land & Water (Indus), Energy & Resources, People, Prosperity (MPI), Knowledge (literacy + universities), Commerce (clusters + ports), Culture (wonders + language), Explorer on **districts**. Military advisor only if you have a defensible public layer.
- **Almanac standard:** same as usaciv — every number has a source, vintage, URL, and a caveat; modelled Gold is never dressed up as official GDP.

---

## 7. Bottom line

You do **not** have a Pakistani BEA or BLS. You **do** have something almost as useful for a Civ-style atlas: global rasters that already fit in a hex pipeline, a decent open admin geography, a 2023 digital census with religion/language/literacy at district scale, a 2023 Economic Census with district workforce by industry in **downloadable Excel**, an agricultural census, MPI, and world-class layers for the Indus, energy, mines, ports, parks and the 2022 floods.

That is enough to build PakCiv. The work is data plumbing and honest labelling — not waiting for a government open-data miracle.

