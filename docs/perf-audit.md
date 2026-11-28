# Performance audit: low-RAM devices, TVs and weak GPUs

Branch `perf/low-end-devices` · baseline `main` @ `3a67605` (production) · November 2026

**Goal:** make living pakistan render fast on smart TVs, cheap phones and old laptops (1–2 GB RAM,
Mali/PowerVR-class GPUs, TV browsers), with **no change** to what capable desktops and the mobile
layout show today.

**Outcome:** a quality system (High / Medium / Low, picked automatically and corrected by a live FPS
governor, with a user-facing Low/Auto/High switch), plus fixes that make every tier cheaper. On the
high tier those fixes change nothing on screen. On the weak-GPU proxy, the orbit frame rate rises
2.5–5.6× with auto quality. A still map now costs no GPU at all (before, it re-rendered
continuously), and estimated GPU memory falls 81–94%. The high tier is pixel-identical in the WebGL
render to production (checked by a deterministic pixel diff, see *Verification*) and still gets
faster (desktop orbit 1.6 → 4.4 fps on the proxy), because the static shadow map is no longer
redrawn every frame.

---

## 1. How it was measured

`npm run perf` (`scripts/perf-bench.mjs`) builds the site, serves it with `vite preview` and drives
headless Chromium with **SwiftShader** software GL. This box has no GPU, so SwiftShader is the
weak-GPU proxy for every scenario. Like a TV GPU, it is limited by fill rate and vertex throughput.

| Scenario | Viewport | CPU (CDP `Emulation.setCPUThrottlingRate`) |
|---|---|---|
| `desktop-1440` | 1440×900 @1× | unthrottled |
| `tv-1080p` | 1920×1080 @1× | 4× slower |
| `tv-720p` | 1280×720 @1× | 6× slower |
| `phone-390` | 390×844 @2×, touch | 4× slower |

Each scenario records the following:

- **Load:** time until the map is visible and until `__livingpakistan_ready`, long tasks
  (`PerformanceObserver('longtask')`), script time, data fetch timings, and the JSON parse cost of
  each data file.
- **Orbit:** a deterministic 12 s camera path, a wide orbit of the country followed by a close orbit
  over Lahore. The path depends on wall-clock fraction, so it is identical however slow the frames
  are. It records avg / p5 / p1 FPS, the frame-time distribution, draw calls and triangles per
  rendered frame (`renderer.info` summed over every pass), main-thread busy % (CDP
  `Performance.getMetrics`), heap allocation rate and GC events from a V8 trace.
- **Hover:** a 4 s mouse sweep over a still map, which exercises raycasting.
- **Idle:** 5 s with nothing happening: frames rendered per second and main-thread busy %.
- **Memory:** JS heap (`performance.memory`, after a forced GC), plus a GPU memory estimate covering
  the drawing buffer (and MSAA), render targets, shadow maps, textures and vertex buffers.
- **CPU profile** (`--profile`): CDP profiles of load, orbit and hover against an unminified build,
  so function names are readable.

Raw numbers are in `docs/perf-baseline.json` (production) and `docs/perf-after.json` /
`docs/perf-after-high.json` (this branch). `node scripts/perf-compare.mjs A.json B.json` prints the
tables below.

Frame cost was also attributed **per feature** by toggling each one in isolation on the production
build. Each toggle timed `composer.render()` and then a 1-px `readPixels` sync, taking the median of
9 frames. That is more stable than frame cadence on a shared machine.

## 2. Findings, ranked by impact

Times are SwiftShader milliseconds per frame at 1440×900 on production. A full frame was about
404 ms.

| # | Finding | Root cause | Measured cost | Fix |
|---|---|---|---|---|
| 1 | **The map never stops rendering.** A still map redraws the full scene, bloom included, as fast as the GPU allows, so a TV GPU sits at 100% forever. | Unconditional `requestAnimationFrame` loop that always calls `composer.render()` and `labels.render()`: `web/src/scene/stage.js:87-88, 96-101` (main) | Idle: 1.4–2.6 full renders/s (GPU-bound at 100%) | On-demand rendering (`stage.js` `start()`): draw only when the camera moved, a flight or animation runs, or a module called `requestRender()`. Ambient motion runs at full rate on high, 30 fps on medium and is frozen on low. On low the loop also rests at 5 Hz. |
| 2 | **4096² PCF shadow map redrawn every frame**, although the sun and every shadow caster are static | `renderer.shadowMap` with auto-update: `stage.js:15-16`; `sun.shadow.mapSize.set(4096, 4096)`: `environment.js:145` | ≈140 ms of 404 (35%); ~128 MB GPU estimate | `shadowMap.autoUpdate = false`, redrawn only when a caster or the sun changes (`stage.js:30`, `renderNow()`). Medium tier uses 2048², low has no shadows. |
| 3 | **Too many pixels**: pixel ratio up to 2 and no budget, so a 4K TV shades 8.3 MP per frame | `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`: `stage.js:13` | Pixel ratio 0.75 saved ≈145 ms (~25%) | Per-tier pixel budget: high = production, medium ≤1.5× and ~2 MP, low ≤1× and ~0.9 MP (`quality.js` `TIERS`). The governor can shrink a further 0.8 → 0.6×. HUD and labels are DOM, so text stays sharp. |
| 4 | **Board shading**: PBR + 2 noise octaves per pixel on 6,695 hex prisms, plus 3,195 cones; 476k triangles per frame including the shadow pass | `board.js:137, 174` (main); `CylinderGeometry` with a never-visible bottom cap: `board.js:99` | Board ≈115 ms, peaks ≈64 ms | Low tier: one noise octave and no glow flicker (`LP_LOW` define). All tiers: drop the hex bottom cap (hidden under the floor; pixel-identical). Triangles per frame −54% on low. |
| 5 | **Bloom** (UnrealBloomPass, 5-mip HalfFloat chain) | `stage.js:37` | ≈57 ms | Kept on high and medium; switched off and freed on low. RenderPass → OutputPass stays, so tone mapping and colours match. |
| 6 | **Water, sky and fog shaders** | water 3 noise octaves + glints: `environment.js:44, 53`; fog-of-war void 2× 5-octave fbm (10 noise taps per pixel): `environment.js:79-81` | water ≈67 ms, sky ≈23 ms, void ≈11 ms | Low: water uses one octave and no glints; void uses 3 octaves and no domain warp. |
| 7 | **Canvas MSAA and preserved drawing buffer bought nothing.** The scene renders into the composer's non-multisampled target, and the canvas only ever receives OutputPass's full-screen triangle. `preserveDrawingBuffer` forces a copy each frame on tiled mobile/TV GPUs. | `new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })`: `stage.js:12` | ~54 MB GPU estimate at 1440×900 | `antialias: false`; preserve only in `?capture=1` (the video recorder). Pixel-identical. |
| 8 | **Label DOM re-placed every frame**: ~90 CSS2D banners rewrite `transform` even when the camera is still | `this.labels.render(...)` every frame: `stage.js:88`; declutter every 160 ms: `sites.js:278-280` | Main-thread style/composite work each frame | Labels re-render only when the camera moved or the declutter changed something; the declutter skips when camera, viewport and label set are unchanged. |
| 9 | **Leaks on every relief change** (the `[` / `]` keys and the slider): pin sprites are duplicated and old buffers are never freed | `Sites.build()` cleared the group but kept the old `pinGroups`: `sites.js:121`; `Lines.rebuild()`: `lines.js:104`; `Borders.build()`: `borders.js:28`; flood material: `flood.js:34` | Three relief changes: **322 → 1,288 pin sprites**, GPU geometries 44 → 81 | Dispose geometry and materials on rebuild and reset `pinGroups`. After the same three changes: 322 sprites, 44 geometries. |
| 10 | **Load blocked by shader compilation** | 27 programs compiled synchronously on the first frames | Load profile: 67% native `(program)` + three's `onFirstUse` 391 ms (`getProgramParameter` blocking on link) | `renderer.compileAsync()` before the first frame where `KHR_parallel_shader_compile` exists (most real GPUs; not SwiftShader). The low tier also compiles fewer programs (no shadow-depth or bloom shaders). |

### Checked and not a problem (no change made)

- **Data JSON**: 1.9 MB raw / 369 KB gzipped, fetched in parallel. Parsing all of it takes **4.7 ms**
  unthrottled. A Web Worker would cost more than it saves.
- **Per-frame JS**: during the orbit the main thread is **92–96% idle** (CPU profile). The heap grows
  ~0.15 MB/s and the V8 trace shows **no GC** in a 12 s orbit. Frames are GPU-bound.
- **Raycasting**: pointermove is already coalesced to one pick per frame. `raycast` is under 1% of
  the hover profile.
- **Code splitting**: the bundle is 770 KB / 206 KB gzipped, mostly three.js (already tree-shaken).
  The UI panels are small, and the mobile layout needs their DOM at startup. Splitting them would
  save little and risk the mobile sheets.
- **Draw calls**: 87 per frame on production, of which ~20 are the shadow pass. Instancing the
  ~30 visible pin sprites further was not worth the risk at this count. Fixing the duplication bug
  (#9) was the real draw-call issue.

## 3. What changed

- **`web/src/quality.js` (new): tiers, detection, governor, controller**
  - `TIERS`: high = production exactly; medium = 2048² shadows, ≤1.5× pixel ratio / ~2 MP, ambient
    motion at 30 fps; low = no shadows or bloom, cheap shaders, ~0.9 MP, ambient motion frozen.
  - Detection (`guessTier`) uses the GPU renderer string (`WEBGL_debug_renderer_info`):
    software GL, or Mali-4xx/T/G31–G57, PowerVR, Adreno ≤5xx, VideoCore or Vivante → low; Intel
    HD/UHD → medium. A TV user agent (Tizen, webOS, BRAVIA, Android TV, Fire TV, HbbTV…) → low.
    `navigator.deviceMemory` ≤2 GB → low, ≤4 GB → medium. `hardwareConcurrency` ≤4 → medium.
  - `Governor`: watches back-to-back rendered frames. A median over 24 fps-time across 45 frames
    steps down. Four seconds under 52 fps-time steps up. It never re-tries a tier it had to leave
    (hysteresis), ignores the first 2.5 s and any frame gap over 400 ms (tab switches), and below
    low it shrinks the render scale to 0.6.
  - Mode precedence: `?quality=low|auto|high` beats the `localStorage` choice
    (`livingpakistan.quality`), which beats auto. `?capture=1` (the video recorder) always runs high.
- **`web/src/scene/stage.js`: on-demand loop and tier application.** `invalidate()`, `wake()`,
  camera-change detection with a sub-pixel tolerance (MapControls damping otherwise moves the camera
  by ~1e-9 forever), the shadow map redrawn only on demand, and the pixel budget. An input safety
  net redraws after any pointer, key or input event.
- **`web/src/scene/frame.js` (new):** `requestRender()` / `requestLabels()`. Board, Lines, Sites,
  Borders, Outline, Flood, Eras, Lighting and the hover ring call them when they change something
  drawn.
- **HUD:** desktop gets a compact **⚙ Auto** chip left of the relief slider that cycles
  Low → Auto → High (tooltip shows the running tier). Mobile gets a **Graphics: Low / Auto / High**
  row in the existing *Light & relief* sheet. If auto has to lighten things mid-session, a one-time
  toast says so.
- **Leak fixes** in `sites.js`, `lines.js`, `borders.js` and `flood.js`; hex bottom caps removed in
  `board.js`.
- **Tooling:** `scripts/perf-bench.mjs` (`npm run perf`) and `scripts/perf-compare.mjs`.
  `scripts/verify-prod.mjs` now also checks:
  - the high-tier sweep really runs shadows and bloom;
  - a full low-tier sweep at 1920×1080 loads clean;
  - a still low-tier map draws ≤2 frames in 2 s;
  - the quality chip cycles and persists;
  - the mobile Graphics row switches tiers;
  - the script exits non-zero on any error.

## 4. Before / after

### Summary: production vs this branch with default (auto) quality

Auto picks **low** for every scenario here, because SwiftShader is software GL. That is what a TV
or weak phone gets.

| Scenario | Orbit avg FPS | Orbit p5 FPS | Ready (ms) | Idle renders/s | GPU mem est. (MB) | Tris/frame |
|---|---:|---:|---:|---:|---:|---:|
| desktop-1440 | 1.6 → **6.8** (4.3×) | 0.8 → **3** | 960 → 586 | 2.2 → **0** | 225.8 → **42.8** | 475,798 → 217,741 |
| tv-1080p | 1.5 → **6.3** (4.2×) | 0.8 → **2.6** | 2453 → 1831 | 1.4 → **0** | 281.7 → **42.8** | 475,867 → 217,854 |
| tv-720p | 2.8 → **6.9** (2.5×) | 1.4 → **3** | 2696 → 2442 | 2.6 → **0** | 198.9 → **29.1** | 475,948 → 217,673 |
| phone-390 | 1.6 → **8.9** (5.6×) | 0.9 → **3.5** | 2285 → 1736 | 2.3 → **0** | 227.3 → **13.4** | 475,090 → 216,902 |

### Full tables: auto quality


**desktop-1440** — 1440x900@1x, unthrottled CPU, SwiftShader GL

| Metric | production | this branch (auto) |
|---|---:|---:|
| Map visible (ms) | 324 | 234 (−28%) |
| Ready (ms) | 960 | 586 (−39%) |
| Load long tasks (n / total ms) | 3 / 798 | 2 / 444 |
| Orbit avg FPS | 1.6 | 6.8 (4.3×) |
| Orbit p5 FPS | 0.8 | 3 (3.8×) |
| Orbit median frame (ms) | 483.3 | 166.7 (−66%) |
| Orbit p95 frame (ms) | 1,283 | 333.3 (−74%) |
| Draw calls / frame | 87 | 69 (−21%) |
| Triangles / frame | 475,798 | 217,741 (−54%) |
| Hover avg FPS | 2.2 | 9.7 (4.4×) |
| Idle renders / s | 2.2 | 0 (−100%) |
| Idle main-thread busy % | 1.3 | 2.4 (+85%) |
| JS heap after load (MB) | 16.4 | 16.2 (−1%) |
| GPU memory estimate (MB) | 225.8 | 42.8 (−81%) |
| Render pixel ratio | 1 | 0.84 |
| Tier | n/a | low |
| Console errors | 0 | 0 |

**tv-1080p** — 1920x1080@1x, 4x CPU throttle, SwiftShader GL

| Metric | production | this branch (auto) |
|---|---:|---:|
| Map visible (ms) | 1,021 | 984 (−4%) |
| Ready (ms) | 2,453 | 1,831 (−25%) |
| Load long tasks (n / total ms) | 5 / 1317 | 5 / 1191 |
| Orbit avg FPS | 1.5 | 6.3 (4.2×) |
| Orbit p5 FPS | 0.8 | 2.6 (3.3×) |
| Orbit median frame (ms) | 583.4 | 183.4 (−69%) |
| Orbit p95 frame (ms) | 1,250 | 383.3 (−69%) |
| Draw calls / frame | 87 | 70 (−20%) |
| Triangles / frame | 475,867 | 217,854 (−54%) |
| Hover avg FPS | 1.6 | 8.6 (5.4×) |
| Idle renders / s | 1.4 | 0 (−100%) |
| Idle main-thread busy % | 3.4 | 9.2 (+171%) |
| JS heap after load (MB) | 16.4 | 16.2 (−1%) |
| GPU memory estimate (MB) | 281.7 | 42.8 (−85%) |
| Render pixel ratio | 1 | 0.67 |
| Tier | n/a | low |
| Console errors | 0 | 0 |

**tv-720p** — 1280x720@1x, 6x CPU throttle, SwiftShader GL

| Metric | production | this branch (auto) |
|---|---:|---:|
| Map visible (ms) | 1,397 | 1,534 (+10%) |
| Ready (ms) | 2,696 | 2,442 (−9%) |
| Load long tasks (n / total ms) | 6 / 1796 | 5 / 1750 |
| Orbit avg FPS | 2.8 | 6.9 (2.5×) |
| Orbit p5 FPS | 1.4 | 3 (2.1×) |
| Orbit median frame (ms) | 383.3 | 183.2 (−52%) |
| Orbit p95 frame (ms) | 699.9 | 333.3 (−52%) |
| Draw calls / frame | 89 | 67 (−25%) |
| Triangles / frame | 475,948 | 217,673 (−54%) |
| Hover avg FPS | 1.9 | 9.8 (5.2×) |
| Idle renders / s | 2.6 | 0 (−100%) |
| Idle main-thread busy % | 6.4 | 12.6 (+97%) |
| JS heap after load (MB) | 16.5 | 16.2 (−2%) |
| GPU memory estimate (MB) | 198.9 | 29.1 (−85%) |
| Render pixel ratio | 1 | 0.8 |
| Tier | n/a | low |
| Console errors | 0 | 0 |

**phone-390** — 390x844@2x, 4x CPU throttle, DPR 2, touch

| Metric | production | this branch (auto) |
|---|---:|---:|
| Map visible (ms) | 1,056 | 1,071 (+1%) |
| Ready (ms) | 2,285 | 1,736 (−24%) |
| Load long tasks (n / total ms) | 6 / 1245 | 5 / 1222 |
| Orbit avg FPS | 1.6 | 8.9 (5.6×) |
| Orbit p5 FPS | 0.9 | 3.5 (3.9×) |
| Orbit median frame (ms) | 483.4 | 133.3 (−72%) |
| Orbit p95 frame (ms) | 1,067 | 283.3 (−73%) |
| Draw calls / frame | 77 | 58 (−25%) |
| Triangles / frame | 475,090 | 216,902 (−54%) |
| Hover avg FPS | 2.1 | 60 (28.6×) |
| Idle renders / s | 2.3 | 0 (−100%) |
| Idle main-thread busy % | 3.9 | 7.4 (+90%) |
| JS heap after load (MB) | 16.4 | 16 (−2%) |
| GPU memory estimate (MB) | 227.3 | 13.4 (−94%) |
| Render pixel ratio | 2 | 0.8 |
| Tier | n/a | low |
| Console errors | 0 | 0 |

**Bundle** — JS 760 KB (202 KB gz) → 770 KB (206 KB gz); data 1855 KB (369 KB gz) → 1855 KB


### High tier, forced with `?quality=high` (what capable desktops get)

The picture is identical to production; the gains come from the cached shadow map, no wasted MSAA
or preserved buffer, and the leak fixes. Note that *idle renders/s* is **higher** here: the high
tier keeps production's every-frame ambient motion, and each of those frames is now cheaper. The
`tv-1080p` ready time (+18%) is run-to-run noise on this shared machine. In the same run,
map-visible time and load long tasks both went down.


**desktop-1440** — 1440x900@1x, unthrottled CPU, SwiftShader GL (after: ?quality=high)

| Metric | production | this branch (?quality=high) |
|---|---:|---:|
| Map visible (ms) | 324 | 274 (−15%) |
| Ready (ms) | 960 | 721 (−25%) |
| Load long tasks (n / total ms) | 3 / 798 | 2 / 582 |
| Orbit avg FPS | 1.6 | 4.4 (2.8×) |
| Orbit p5 FPS | 0.8 | 1.8 (2.3×) |
| Orbit median frame (ms) | 483.3 | 283.3 (−41%) |
| Orbit p95 frame (ms) | 1,283 | 566.6 (−56%) |
| Draw calls / frame | 87 | 82 (−6%) |
| Triangles / frame | 475,798 | 217,747 (−54%) |
| Hover avg FPS | 2.2 | 2.7 (1.2×) |
| Idle renders / s | 2.2 | 3.5 (+59%) |
| Idle main-thread busy % | 1.3 | 1.6 (+23%) |
| JS heap after load (MB) | 16.4 | 16.4 (−0%) |
| GPU memory estimate (MB) | 225.8 | 186.3 (−17%) |
| Render pixel ratio | 1 | 1 |
| Tier | n/a | high |
| Console errors | 0 | 0 |

**tv-1080p** — 1920x1080@1x, 4x CPU throttle, SwiftShader GL (after: ?quality=high)

| Metric | production | this branch (?quality=high) |
|---|---:|---:|
| Map visible (ms) | 1,021 | 971 (−5%) |
| Ready (ms) | 2,453 | 2,894 (+18%) |
| Load long tasks (n / total ms) | 5 / 1317 | 5 / 1227 |
| Orbit avg FPS | 1.5 | 2 (1.3×) |
| Orbit p5 FPS | 0.8 | 1.2 (1.5×) |
| Orbit median frame (ms) | 583.4 | 433.3 (−26%) |
| Orbit p95 frame (ms) | 1,250 | 816.7 (−35%) |
| Draw calls / frame | 87 | 76 (−13%) |
| Triangles / frame | 475,867 | 217,477 (−54%) |
| Hover avg FPS | 1.6 | 2 (1.3×) |
| Idle renders / s | 1.4 | 2.1 (+50%) |
| Idle main-thread busy % | 3.4 | 3.5 (+3%) |
| JS heap after load (MB) | 16.4 | 16.3 (−1%) |
| GPU memory estimate (MB) | 281.7 | 218.4 (−22%) |
| Render pixel ratio | 1 | 1 |
| Tier | n/a | high |
| Console errors | 0 | 0 |

**Bundle** — JS 760 KB (202 KB gz) → 770 KB (206 KB gz); data 1855 KB (369 KB gz) → 1855 KB


## 5. Low-tier visual tradeoffs

Only devices that auto-detect as low (or that the governor steps down), and anyone who picks
**Low**, see these:

- **No sun shadows.** Mountains and skylines read through shading and the cones' snow line instead
  of cast shadows, so relief looks flatter at golden hour.
- **No bloom.** Nightlights, corridor pulses, wonder halos and the national border glow show their
  colour without the soft halo. They are still clearly lit, but less "glowing".
- **Still ambient motion.** Water shimmer, river flow streaks, corridor pulses, glacier sparkle,
  era-beam bands and the outline "breath" are frozen in place. Anything functional still animates:
  camera flights, flood surge playback, the outline fade-in and hover feedback.
- **Simpler surfaces.** Tile texture uses one noise octave (slightly less mottled); water has one
  swell octave and no sun glints; the fog-of-war clouds are simpler.
- **Lower 3D resolution** (~0.9 MP, so 0.67× on a 1080p TV), upscaled by the browser. 3D edges are
  softer; all text, banners and panels stay full-resolution because they are DOM.

**Medium** (auto only) looks like high, with 2048² shadows (slightly softer shadow edges), at most
1.5× pixel ratio, and ambient motion at 30 fps.

**High** is unchanged from production.

## 6. Verification

- `npm run build`: passes. `npm run verify`: **0 errors** (desktop high-tier sweep, low-tier
  sweep, idle check, quality chip, mobile flow including the Graphics row).
- **Pixel identity at high tier:** the same five views (day, night, golden-hour Lahore, K2
  close-up, density lens with corridors and power plants) were rendered from production and this
  branch in `?capture=1` mode (deterministic virtual clock) and diffed. The WebGL render is
  identical. The only differing pixels are the HUD's CSS-animated flag and Guide button, plus the
  new ⚙ chip.
- Previews (not committed): `previews/perf-01-desktop-high.png`, `perf-02-tv-1080p-auto.png`,
  `perf-03-low-tier.png`, `perf-04-mobile.png`.

## 7. Caveats and next steps

- Every number above is from SwiftShader on a shared 8-core box. Absolute FPS on real hardware will
  be far higher. The ratios, the idle behaviour and the memory figures are what carry over. Running
  the site on one physical Android TV / Tizen set with `?quality=auto` would calibrate the detection
  thresholds.
- On the low tier the remaining cost is vertex work for 6.7k prisms + 3.2k cones. Chunking the board
  into spatial `InstancedMesh` tiles would let frustum culling skip most of it when zoomed in. It was
  left out here because it touches picking, painting and highlight indexing.
- On the high tier, ambient motion still redraws the scene every frame. That is the production look,
  kept on purpose.
