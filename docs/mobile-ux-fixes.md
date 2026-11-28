# Mobile UX fixes: all 25 audit findings

Branch `fix/mobile-ux-all`, off `main` @ `d2d02f7` (which has PR #2's on-demand rendering and quality tiers, and PR #3's tour badge). November 2026.
This answers [`docs/mobile-ux-audit.md`](mobile-ux-audit.md) (M-01 … M-25) item by item.

## Summary

- **Status:** all 25 findings are addressed. 24 are fixed. M-13 (battery) was already fixed by PR #2; it was re-verified here and needed no change.
- **The two P0s are gone:**
  - A pinch that starts on the dock or on a city banner no longer zooms the page. `visualViewport.scale` stays 1, and the banner pinch now zooms the map.
  - During a tour, a map tap no longer leaves a ghost inspector. The lower half of the screen belongs to the map again.
- **Selections stay visible.** What you select now lands in the visible map above its card (y ≈ 230 instead of 422, 3 of 3 cases). The browser's Back button closes sheets, tours and the walkthrough before it leaves the site.
- **Inputs and the Explorer:**
  - The Duel and Search fit above the iOS keyboard.
  - The Explorer plot scrolls with the panel, and brushing needs a press and hold.
  - Picking a row folds the Explorer to a bar instead of losing it.
  - Phones get a three-column table.
- **Onboarding:** phones get touch wording, a first-visit coach mark and their own walkthrough. Its card overlaps its target on 0 of 19 steps (5 before).
- **Tablets:** touch tablets up to 1100 px (iPad portrait) now get the phone layout.
- **Polish, iPhone 14, distinct elements across 17 UI states:**
  - tap targets under 32 px: 36 → 5;
  - text below 4.5:1 contrast: 8 → 0;
  - text styles under 11 px: 21 → 11.
- **Desktop at 1440×900 is unchanged.** Home, a lens, the inspector, the tour card and the Explorer give identical button sets and label counts. The pixel difference is ≤ 0.18 %, coming from the flag animation, scatter-point anti-aliasing and the intended M-24 banner change.
- **Build and verify:** `npm run build` and `npm run verify` pass (`{"errors": []}`).

## How it was checked

- **Build under test:**
  - The branch build was served by `npx vite preview --port 4410 --strictPort --bypass-lock`.
  - A copy of `main`'s build was served on 4411 as the "before".
  - Vite 8's preview lock needs `--bypass-lock` for a second server.
- **Browser:** Playwright Chromium with SwiftShader GL. Phones used `isMobile`, `hasTouch`, DPR 2 and real CDP touch events (harness `scripts/mux/lib.mjs`). One browser ran at a time, and GA requests were aborted.
- **Scripts:**
  - **New: `scripts/mux/fixshots.mjs`.** One measurement (plus screenshot) per issue, run unchanged against both builds. Results are in `/tmp/muxfix-before/results.json` and `/tmp/muxfix-after/results.json`.
  - **Re-run from the audit:**
    - `matrix.mjs` on the iPhone 14 profile (all 17 states) and the 820 tablet (9 states), for both builds;
    - `flows.mjs` (`gestures, back, inputs, explorer, ghost, covered, labels, walk, motion, tablet`) against the branch.
  - **New: `scripts/mux/desktopcheck.mjs`.** Five desktop states at 1440×900 on both builds.
- **Screenshots:** `scripts/mux/pairs.py` builds the before/after images.

## Fixes

| M-ID | Title | Fix (what changed, files) | Verification (how, result) | Status |
|---|---|---|---|---|
| M-01 | Pinch on HUD/banner zooms the page | `#hud` is `touch-action: pan-x pan-y`. Bars, sheet heads, badge and narration head are `none`. iOS `gesturestart/change` are prevented while phone layout is on. Banners and wonder labels are `pointer-events: none` on phones, and a tap is matched to the nearest label (12 px slop) in the canvas `pointerup` (`Sites.labelAt`). Viewport stays zoomable. `mobile.css`, `mobile.js`, `app.js`, `sites.js` | fixshots m01: pinch on dock → `visualViewport.scale` **5 → 1**. Pinch from the Karachi banner → scale **5 → 1**, and the camera now zooms (distance 3096 → 399). flows `gestures`: map pinch, sheet scroll and double taps all keep scale 1. `previews/muxfix-01-m-01.png` | Fixed |
| M-02 | Ghost inspector eats taps during a tour | A specificity fix: `body.touring #hud > :is(.dock, .legend, .inspector, .timebar) { pointer-events: none }`. On phones a map tap during a tour selects nothing, and `body.mobile.touring .inspector { display: none !important }`. `style.css`, `mobile.css`, `app.js` | fixshots m02 and flows `ghost`: after a tap at (200, 620) mid-tour, `elementFromPoint(195, 600)` is **span → canvas**, no selection, no `m-sheet-open`. `previews/muxfix-02-m-02.png` | Fixed |
| M-03 | Selection flown under its sheet | While the inspector or Surprise card is up on a phone, `camera.setViewOffset` moves the projection centre to the middle of the visible map. In portrait that is between the top bar and the card; in landscape it is left of a side card. A stage ticker eases the offset in, which keeps the on-demand loop awake (`requestRender` when the aim changes). `homePose` clears it on its probe, and the label declutter key includes it. `mobile.js` | fixshots m03 and flows `covered`: target y for Badshahi / Karachi / Quetta goes **422/422/422 (under the card) → 238/224/226 (visible)**. Surprise is 293, above its card at 516. `previews/muxfix-03-m-03.png` | Fixed |
| M-04 | Back leaves the site | The first sheet, tour or walkthrough `pushState`s one entry, and switching sheets reuses it. `popstate` ends the walkthrough or tour (camera kept), closes sheets and clears the selection. Closing everything by hand pops the entry. `_saveHash` keeps `history.state`. `mobile.js`, `app.js` | fixshots m04, coming from a "previous site" page: Back from the inspector, from a sheet and from a tour each **stayed on the site** with it closed. The next Back left to "previous site". flows `back`: still on the site after Back. | Fixed |
| M-05 | Cinema badge under the exit | `body.mobile.touring.cinema .tc-chip:not(.hidden) { top: calc(var(--m-top) + 52px) }`. `tourchip.css` | fixshots m05: the badge moves from y 8 to **60**, and `elementFromPoint` at its centre is **`.cinema-exit` → `.tc-chip`**. `previews/muxfix-05-m-05.png` | Fixed |
| M-06 | Duel inputs under the keyboard | `--vvh` follows `visualViewport.height`. While typing, the Duel is pinned to the top and ends at the keyboard. Inputs are stacked one per line at 44 px. The suggestion list sizes itself to the space below, or opens upwards (`duel.js`). The viewport meta has `interactive-widget=resizes-content`. Rehoming is skipped while an input has focus. `mobile.css`, `duel.js`, `panels.css`, `index.html` | fixshots m06 (keyboard = visual viewport shrunk to 508 px): input bottom **699 → 130**, list bottom **1025 → 496**. Rows above the keyboard **0/8 → 8/8**. Inputs are 340 px wide, so names are no longer cut off. `previews/muxfix-06-m-06.png` | Fixed |
| M-07 | Explorer plot is a scroll trap | Phones: the plot is `touch-action: pan-y` and 200 px tall. A brush starts only after a 300 ms hold (then `touchmove` is prevented, so the drag draws). A box that catches nothing clears the brush, and a quick tap clears it. The phone subtitle says so. `explorer.js`, `mobile.css` | fixshots m07: a swipe on the plot scrolls the panel (scrollTop 346 → 141) and makes no brush. Hold + drag → **112 districts brushed**. An empty-area hold-brush → brush **cleared**, 160 rows. `previews/muxfix-07-m-07-after.png` | Fixed |
| M-08 | Row tap closes the Explorer | On phones `_choose()` folds the Explorer to its bar (`.min`). The one-sheet rule and map-tap dismissal leave the bar alone when the inspector opens, and the inspector stacks above it. Tapping the bar restores the Explorer, and restoring counts as opening. Also fixed a specificity bug that kept `.min` from folding on phones. `explorer.js`, `mobile.js`, `mobile.css` | fixshots m08: after tapping row 12 → Explorer open and folded, inspector "Bahawalpur" open, **stacked** (card bottom 700 < bar top 706). Tapping the bar → Explorer restored with table scroll **200 kept**, inspector closed. `previews/muxfix-08-m-08-after.png` | Fixed |
| M-09 | No phone onboarding, mouse wording | The welcome, Explorer subtitle and tours note carry touch variants (`.only-touch` / `.only-desk`, switched by `body.mobile`). The phone hint lists the gestures. A first phone visit (`guide.shouldAutoShow()`) shows a one-time coach mark: "Drag to move · pinch to zoom / two fingers to tilt and turn · tap anything". It goes on first touch or after 9 s, and the Tours dock icon pulses twice. `guide.js`, `tours.js`, `explorer.js`, `app.js`, `mobile.js`, `mobile.css`, `style.css` | fixshots m09: first visit → coach mark shown. Mouse words visible in the welcome **["click","Click","keystroke","( / )","? key"] → []**. The tours note ends "tap the badge…; ✕ on the card ends the tour". `previews/muxfix-09-m-09.png`, `previews/muxfix-09-m-09-welcome.png` | Fixed |
| M-10 | Desktop walkthrough on a phone | `Guide._phoneSteps()` has 19 steps with touch copy. It drops hover, shift-click and key shortcuts. Targets are the dock buttons, the legend key (`.m-peek`), "Pakistan at a glance" (More) and `.m-guide`, and the "map" spotlight is the free map area. Card placement: at the top, with sheets capped below it via `--gd-ch`; at the bottom when the target is in the top half (search, ❔). `guide.js`, `mobile.css` | fixshots m10 and flows `walk`: 19/19 steps have a spotlight. The card overlaps its target on **0/19** steps (before: 5, up to 65,263 px²). No mouse or keyboard wording; the only regex hit is "key" in "The legend key". `previews/muxfix-10-m-10-after.png` | Fixed |
| M-11 | iPad portrait gets desktop UI | `MOBILE_QUERY` adds `(pointer: coarse) and (max-width: 1100px)`. Coarse pointers on the remaining desktop layout (iPad landscape) get 40 px buttons and chips and 44 px ✕s. A "📊 Explore" top-bar button shows only under `(pointer: coarse), (max-width: 900px)`, so the 1440 px desktop has no new button. `mobile.js`, `style.css`, `app.js` | fixshots m11 (820×1180): phone layout **false → true**, Explorer reachable from the dock. Home: targets < 44 px **40 → 0**. Matrix (9 states), distinct elements: < 44 px 80 → 49, < 32 px **67 → 2**, contrast < 4.5 11 → 0. flows `tablet`: a tap opens the inspector with no stuck tooltip. `previews/muxfix-11-m-11.png` | Fixed |
| M-12 | Labels clipped at the edge / under the HUD | On phones the declutter rejects boxes outside `[4, W-4]×[4, H-4]`. It seeds the boxes with the HUD's rects: top bar, dock, legend key, badge and its buttons, the open card, cinema exit, time bar, walkthrough card and open sheets. Those are read once per pass via `sites.labelZone`. The focused (tour) label is nudged back on screen with `translate`. Every HUD change calls `Sites.refreshLabels()` → `requestLabels()`, and `invalidateLabels()` now wakes a resting loop. Desktop declutter is unchanged. `sites.js`, `mobile.js`, `stage.js`, `frame.js` | fixshots m12 and flows `labels`, K2 tour: clipped labels per stop **2/4/4/0/1 → 0/0/0/0/0**, under the HUD **0/0/0/0/1 → 0**. Labels under the open Lenses sheet at home **2 → 0**. `previews/muxfix-12-m-12.png` | Fixed |
| M-13 | Battery: continuous rendering | No change: PR #2's on-demand loop. I checked that the new view-offset ticker returns `true` only while easing. | fixshots m13: a still phone map drew **0 frames in 5 s**, and **0** with the inspector open (auto tier `low` on SwiftShader). | Fixed (by PR #2; verified) |
| M-14 | Tap targets under 44 px | Phone sizes: every ✕ (`.m-x`, `.pc-x`, `.insp-close`, `.gw-x`, `.narr-x`), badge next/pause (44 px hit, 26 px disc, repositioned), `.tc-min`, card controls, era/flood play and the Explorer minimise are 44 px. Lens/layer buttons, era ticks, axis selects, Explorer rows and log checkboxes are 40 px; duel chips 36 px. Walkthrough ticks are `content-box` with 10 px padding. Skip is 44 px tall. Inline source links get `padding-block: 14px`, which leaves the layout alone. City banners and labels get the 12 px tap slop (M-01). `mobile.css`, `tourchip.css` | matrix i14 (17 states), distinct elements: < 44 px **72 → 49**, < 32 px **36 → 5**. The remaining under-44s are the 40 px controls the audit specified, and text inputs inside 54 px bars. | Fixed |
| M-15 | Small text, low contrast | Phones: `--ink-dim` is #8eaab5. An 11 px floor applies to `.m-dlabel, .m-peek-more, .narr .k, .narr-step, .narr .src, .yield .k, .m-sub, .insp-kicker, .dock-gtitle`, the sort arrow, `.banner-pop`, `.ycard .k/.rank` and `.badge em`. The inspector hero kicker, sub and ✕ use 80 % ink. `.banner-pop` uses light text. `mobile.css` | matrix i14: texts below 4.5:1 **8 → 0** (search sub-lines, inspector hero, banner population). Distinct text styles < 11 px **21 → 11**. Tablet contrast < 4.5 **11 → 0**. | Fixed |
| M-16 | Tour card: ◀ ▶ ▶ when paused; shrink next to end | On phones the card's controls are drawn glyphs (previous ⏮, play/pause, next ⏭), with aria-labels. Desktop keeps its text glyphs. 16 px separate shrink from ✕, both 44 px. On a phone the card's ✕ (and Back) end the tour **without flying home** (`stop(true, { keepCamera })` → `resetView({ keepCamera })`). `tours.js`, `tourchip.css`, `app.js` | fixshots misc.m16 while paused: the controls read Previous / **Resume** / **Next stop** with three distinct glyphs. The gap between shrink and ✕ is **24 px** (was 6). After ✕: tour ended, no flight, camera unmoved. `previews/muxfix-16-m-16-after.png` | Fixed |
| M-17 | Reduced motion ignored by flights/tours | `Stage.flyTo`: under `prefers-reduced-motion`, duration ≤ 0.35 s and no arc. Tours start paused; Play all still auto-advances (cinema hides the controls) but plays the list once instead of looping. `stage.js`, `tours.js` | fixshots misc.m17 (reduced motion emulated): the Surprise flight is **{duration 0.35, lift 0}** (was 2.4 s, 900 arc). The tour starts **paused**. flows `motion`: `tourAutoAdvances: false`. | Fixed |
| M-18 | Legend histogram not scrubbable | Pointer events instead of `mousemove`. A finger uses `setPointerCapture`, scrubs, and clears on lift or cancel; the mouse keeps its hover behaviour. `.lg-hist` is `touch-action: pan-y` in the sheet. `lenses.js`, `mobile.css` | fixshots misc.m18: a 10-step finger drag along the histogram → **10 highlight updates** (was 1), cleared on lift. | Fixed |
| M-19 | No swipe-down-to-close, no handle | A 36×4 grab handle on the Lenses/Light/More sheets, panels, inspector and tours menu. Dragging the head down follows the finger; more than 80 px, or a flick, closes the sheet (the inspector clears the selection); otherwise it springs back. A click within 350 ms of a drag is swallowed. `mobile.js`, `mobile.css` | fixshots misc.m19 and flows `gestures`: a 240 px drag on the Lenses head → **closed** (was `stillOpen: true`). A drag on the inspector hero → closed. | Fixed |
| M-20 | Explorer cramped in landscape / at 360 px | Phones show three columns (District, the sort, one chosen column), with "Sort" (plus a direction toggle) and "Also" selects above the table. Every other figure is in the row's card. In landscape the table and plot sit side by side (`minmax(0,1fr)` halves, each scrolling), and the subtitle and row count are hidden. `explorer.js`, `mobile.css` | fixshots m08: phone header **13 columns → "#, District, Pop."**. Landscape 844×390: grid is 360 px + 360 px, plot top at y 263 (on screen; was below the fold). Only 3 full table rows show, since rows are now 40 px. `previews/muxfix-20-m-20-landscape-after.png` | Fixed |
| M-21 | Search results under the keyboard | `.srch` `max-height` also caps at `var(--vvh) - var(--m-top) - 8px`. `mobile.css` | fixshots m06.search with the keyboard up: sheet bottom **548 → 500** (keyboard top 508). | Fixed |
| M-22 | No pressed states; sticky hover | Every `:hover` rule (29) now sits in `@media (hover: hover)`, with mixed selector lists split and order kept. `@media (hover: none)` gives the common controls `:active { filter: brightness(1.25) }`. A passive `touchstart` listener enables `:active` on iOS. `style.css`, `panels.css`, `mobile.js` | fixshots misc.m22 (CSSOM walk): `:hover` rules outside a hover media query **29 → 0**. Desktop screenshots are unchanged. | Fixed |
| M-23 | Accessible names, focus | `aria-label`s on `.insp-close`, `.gw-x`, `.pc-x`, `.narr-x` ("End tour"), the cinema exit, the Explorer minimise, `.dock-collapse`, era/flood play, and the narration controls. City banners and wonder labels are `role="button" tabindex="0"`, with an aria-label (name and population) and Enter/Space handling. `inspector.js`, `guide.js`, `panelkit.js`, `tours.js`, `explorer.js`, `eras.js`, `flood.js`, `app.js`, `sites.js` | fixshots misc.m23: glyph-only HUD buttons without a label **→ 0**. Labels that are focusable buttons: **82/82**. | Fixed |
| M-24 | AJK/GB banners show "—" | **Data:** the repo has no city figure for Muzaffarabad, Mirpur, Gilgit or Skardu (`layers.json` `pop: null`). The only figures are district totals from the WorldPop 2025 model (for example Muzaffarabad district 813,744), which would overstate a town several times over. **Change:** the population pill is dropped when the figure is unknown, and the banner's aria-label and the desktop tooltip say "Population not covered by Census 2023". The inspector already said so. Applies on desktop too. `sites.js`, `app.js` | fixshots misc.m24: banners read **"Muzaffarabad", "Gilgit", "Skardu", "Mirpur"** (was "—Muzaffarabad" …). Visible in `previews/muxfix-12-m-12.png` (Gilgit, Skardu). | Fixed (no figure rendered: the data doesn't exist) |
| M-25 | Theme colour, app metadata, pull-to-refresh | `<meta name="theme-color" content="#07090d">`, `manifest.webmanifest` (standalone, 192/512 icons) and `apple-touch-icon` (180). The icons are rendered from the favicon flag by `scripts/mux/icons.mjs`. `html:has(body.mobile) { overscroll-behavior: none }` (phones only, so desktop trackpad swipe-back still works). `index.html`, `web/public/*`, `mobile.css` | fixshots misc.m25: theme-color `#07090d`, the manifest loads with both icons OK, the touch icon is OK, and the root's `overscroll-behavior-y` is `none`. | Fixed |

## Screenshots

All shots are 390×844 at DPR 2 unless noted. The left half is `main` and the right half is this branch.

- **M-01** (pinch on dock): `previews/muxfix-01-m-01.png`
- **M-02** (map tap during tour): `previews/muxfix-02-m-02.png`
- **M-03** (Badshahi Mosque selected): `previews/muxfix-03-m-03.png`
- **M-05** (Play all): `previews/muxfix-05-m-05.png`
- **M-06** (Duel with the keyboard up): `previews/muxfix-06-m-06.png`
- **M-09** (first visit, welcome wording): `previews/muxfix-09-m-09.png`, `previews/muxfix-09-m-09-welcome.png`
- **M-11** (820×1180 tablet, halved): `previews/muxfix-11-m-11.png`
- **M-12** (K2 tour stop 2): `previews/muxfix-12-m-12.png`
- **After only:**
  - `previews/muxfix-07-m-07-after.png` (hold-brush)
  - `previews/muxfix-08-m-08-after.png` (card above the folded Explorer)
  - `previews/muxfix-10-m-10-after.png` (walkthrough, tours step)
  - `previews/muxfix-16-m-16-after.png` (paused tour card)
  - `previews/muxfix-20-m-20-landscape-after.png`
- **Desktop regression** (1440×900; home, lens, inspector, tour card, Explorer; main vs branch): `previews/muxfix-90-desktop-check.png`

## Judgement calls

- **M-03:**
  - The offset applies only while the **inspector or Surprise card** is up. Those are the cards that open for a selection.
  - It does not apply to the Lenses, Light and More sheets, so the country's home framing doesn't jump every time one opens.
  - It does not apply to tall panels, which leave only a strip of map.
  - I used `setViewOffset` rather than offsetting `flyTo`, so taps, orbit and zoom-to-cursor stay consistent while the card is up.
- **M-02:** I took the audit's recommended option: a map tap during a phone tour does nothing beyond putting the card away. I didn't pause the tour and show the inspector.
- **M-16:** I put 16 px between shrink and ✕ instead of moving shrink to the top-left, which keeps it next to the badge it folds into.
  - Only the phone ✕ (and Back) keep the camera.
  - Finishing a tour, Esc and desktop ✕ still go home.
- **M-17:** Under reduced motion, Play all still advances on its own, because cinema has no step controls on desktop. It plays the list once instead of looping.
- **M-07 / M-14 / M-15:** the "empty brush clears", banner text colour, 11 px floor and lighter dim ink are scoped to the phone layout (`body.mobile`), so desktop looks and behaves as before.
  - **Recommendation:** apply the `.banner-pop` colour on desktop too; it has the same 3.2:1 contrast there.
- **M-18:** the highlight clears when the finger lifts. A scrub is a look, not a selection; category legends still select by tap.
- **M-19:** the search palette (top-anchored), Welcome and Surprise card have no swipe handle. Each has its own ✕ and is dismissed by a map tap.
- **Desktop changes, all deliberate:**
  - **M-02:** dimmed panels during a desktop tour are now actually inert, as the original rule intended.
  - **M-23:** banners are focusable, so they join the keyboard Tab order.
  - **M-24:** banners without a figure have no "—" pill.
  - **M-22:** hover rules are wrapped in `@media (hover: hover)`, which is a no-op on desktop.
  - **M-11:** the Explore top-bar button exists in the DOM but shows only for coarse pointers or windows under 900 px.

## Caveats

- **No real devices.** As in the audit, everything ran in Chromium with touch emulation and an iOS user agent, on SwiftShader. The following were not observed on hardware:
  - iOS `gesturestart` handling;
  - the keyboard's real effect on `visualViewport` (the tests shrink `visualViewport.height` to 508 px and fire `resize`);
  - `interactive-widget` on Android;
  - pull-to-refresh;
  - `:active` on iOS;
  - the home-screen icon.
- **Matrix numbers count distinct elements across all states.** "< 44 px" still includes the 40 px controls the audit itself specified.
- **The landscape Explorer (M-20) fits 3 table rows** beside the plot, now that rows are 40 px tall for touch. It scrolls.
- **M-11:** touch tablets from 769 to 1100 px now use the phone dock and sheets, which are designed for narrow screens: the dock is capped at 480 px and sheets are full-width. It works and is finger-sized, but it is not a dedicated tablet layout.
- **The audit's own `flows.mjs explorer` check** swipes up on a plot already scrolled to the bottom of its panel, so it reports no scroll either way. `fixshots m07` swipes the other direction and shows the panel scrolling.
- **`npm run verify` (the project's own script) doesn't block GA.** Running it may have sent a few headless page views from 127.0.0.1 to the GA4 property. All the `scripts/mux` runs blocked GA.
- **Port 4173:** a `vite preview` server already running there (started 05:37, not mine) served the freshly built `dist/` for `npm run verify`. My own 4173 server failed to bind and exited. I left the pre-existing one running. My servers on 4410 and 4411 were stopped by PID.
- **PR #2 follow-up from the audit** ("start `(pointer: coarse)` devices on medium") is not one of the 25 findings and was not changed.
