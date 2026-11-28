# Mobile UX audit: living pakistan on phones and tablets

Branch `audit/mobile-ux`, cut from `feat/mobile-tour-radial-badge` @ `b899406` (PR #3, which is on top of PR #1's phone layout). November 2026.
This is an audit only. No product code was changed. Scripts are in `scripts/mux/` and screenshots in `previews/mux-NN-*.png`.

## Executive summary

| Priority | Count | Meaning |
|---|---:|---|
| **P0** | 2 | Breaks core use: the map or the whole page stops responding as expected |
| **P1** | 11 | Major annoyance, or hit often |
| **P2** | 12 | Polish |

**Verdict**

1. The phone layout from PR #1 holds up structurally. Safe-area insets, `dvh` sizing, landscape, the 768 px tablet, rotation mid-flow and one-sheet-at-a-time all work (see "Verified OK").
2. Gestures and layering are what make it feel broken. A pinch that starts on the dock or on a city banner zooms the **whole page** to 5×, with every control off-screen (M-01). During a tour, tapping the map leaves an invisible inspector that swallows taps on the bottom half of the screen (M-02).
3. Selecting something flies it to the middle of the screen, which is right under the bottom sheet (M-03). The browser back button leaves the site from any state (M-04).
4. Phones get no onboarding, and every bit of help text is written for a mouse and keyboard (M-09, M-10). iPads in portrait (820/834 px) get the desktop UI, with 13–33 px targets and no way to reach the Explorer (M-11).
5. Most of the top issues are small CSS/JS fixes. Ten of them are under an hour each (see "Quick wins"). PR #2 already solves the battery problem (M-13).

## Methodology and device matrix

- **Build under test:** `npm run build` of `b899406`, served by `npx vite preview --port 4391 --strictPort`. PR #2 was built in a separate worktree (`/tmp/mux-perf`, `origin/perf/low-end-devices` @ `43f00a7`) and served on port 4392 for comparison.
- **Browser:** Playwright Chromium (headless shell 1255) with `isMobile`, `hasTouch`, an iOS/Android/iPadOS user agent, DPR 2, and SwiftShader software GL (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader …`). Touches are real CDP `Input.dispatchTouchEvent` sequences, so pinches go through Chromium's own gesture pipeline. GA requests were blocked for the bulk runs.
- **Metrics** (`scripts/mux/metrics.mjs`): for every UI state on every device, the collector records:
  - every visible button, link, input, banner, label and table header, with its bounding box (elements covered by something else are skipped);
  - every visible text node's computed `font-size`;
  - a WCAG contrast ratio against the effective background (the first opaque ancestor background, blended). Text drawn straight over the WebGL map has no computable background and is excluded.
- **Simulations:**
  - Safe areas: CDP `Emulation.setSafeAreaInsetsOverride` with 47/34 px in portrait. In landscape the inset variables were set directly.
  - Safari bars: a 375×553 viewport (iPhone SE with both bars showing).
  - iOS keyboard: drawn as a 336 px overlay, because iOS overlays the keyboard on the layout viewport rather than resizing it.
  - Slow device: 4× CPU throttle with ~9 Mbps / 60 ms network.
  - Reduced motion and WebGL context loss: emulated, using `WEBGL_lose_context` for the context loss.

| Device | Viewport | Layout it gets | States captured | Distinct targets < 44 px | Text < 12 px (distinct styles) |
|---|---|---|---:|---:|---:|
| iPhone SE | 375×667 @2 | phone | 14 | 60 | 45 |
| iPhone 14 | 390×844 @2 | phone | 17 | 73 | 49 |
| iPhone Pro Max | 430×932 @2 | phone | 4 | 30 | 16 |
| small Android | 360×740 @2 | phone | 14 | 58 | 44 |
| landscape phone | 844×390 @2 | phone, dock as a right rail | 17 | 81 | 45 |
| tablet 768 | 768×1024 @2 | phone (`max-width: 768px`) | 9 | 84 | 39 |
| tablet 820 | 820×1180 @2 | **desktop** (touch, no hover) | 9 | 79 | 47 |

The 17 states are: home, lenses, light, more, tours, search, explore, duel, guide (welcome), hex inspector, city inspector, almanac, surprise, eras, walkthrough, tour (badge) and tour (card pinned).
Raw JSON is in `/tmp/mux-matrix/*.json`; `node scripts/mux/report.mjs` re-summarises it. The flows are in `scripts/mux/flows.mjs`:

> gestures, back, inputs, explorer, hover, tourz, ghost, covered, safearea, short, rotate, labels, walk, deeplink, tablet, motion, load

`bash scripts/mux/run-all.sh` runs everything, one browser at a time: at DPR 2, parallel SwiftShader browsers get OOM-killed on this box.

**Grep results for the checklist**

- **Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover` (`web/index.html:5`). There is no `user-scalable`/`maximum-scale`, which is right for accessibility, but nothing else stops page zoom either (M-01). There is no `interactive-widget`.
- **Safe areas:** `env(safe-area-inset-*)` appears only in `web/src/ui/mobile.css:10-14` (`--m-l/--m-r/--m-top/--m-dock-b`). Everything on phones uses those variables, which works. The desktop layout (tablet 820) uses none.
- **vh vs dvh:** the phone layout uses `dvh` throughout (`mobile.css:17, 81, 143, 152, 157, 169, 189, 202, 225, 230`; `tourchip.css:56`). `100vh`/`vh` remain only in desktop rules (`style.css:113, 205, 271, 347, 378, 380`; `panels.css:38`). Those apply to the 820 px tablet and are overridden on phones.
- **`touch-action`:**
  - `none` on the canvas (set by `MapControls`), `.tc-hold` (`tourchip.css:22`) and `.exp-svg` (`panels.css:117`);
  - `manipulation` on HUD buttons/inputs (`mobile.css:20`) and `.tc-btn` (`tourchip.css:36`);
  - **nothing** on banners/labels, sheets or bars.
- **`overscroll-behavior`:** `none` on `body.mobile` (`mobile.css:18`) and `contain` on the sheet scrollers (`mobile.css:92, 135, 155, 169, 176`). Nothing on `html`.
- **`user-select` / `-webkit-touch-callout`:** only on the tour badge (`tourchip.css:19`) and on Explorer/Almanac headers.
- **Input font size:** `mobile.css:22` forces 16 px on text/search inputs and selects. All 7 inputs measured 16 px, so iOS will not zoom on focus.
- **History API:** only `history.replaceState` (`app.js:479`). There is no `pushState`/`popstate`.
- **Reduced motion:** CSS only (`style.css:67, 194`, `mobile.css:86`, `tourchip.css:87`). JS camera flights ignore it.

---

## P0: breaks core use

### M-01 Pinching on the dock, top bar, a sheet or a city banner zooms the whole page to 5×
- **Severity:** P0. **Devices:** all phones and tablets (verified on iPhone 14 emulation; same CSS on all).
- **Repro:** put two fingers on the dock (or on the "Karachi" banner) and spread them, as anyone does when trying to zoom the map near the bottom of the screen.
- **Evidence:**
  - `previews/mux-03-pinch-on-dock-zooms-page.png`
  - `previews/mux-04-pinch-on-banner-zooms-page.png`
  - `visualViewport.scale` goes from 1 to **5** in both cases. The same pinch on bare map zooms the map correctly (camera distance 2,900 → 1,000, page scale stays 1).
  - At 5× every control is off-screen, and further pinches on the map no longer reach it. In Chromium the zoom **survived a reload** (scale was still 5 after `page.reload()`).
  - Cause:
    - The canvas gets `touch-action: none` from MapControls.
    - City banners and wonder labels are `pointer-events: auto` with no `touch-action` (`style.css:170, 195`).
    - The HUD bars only have `touch-action: manipulation`, which still allows pinch-zoom (`mobile.css:20`).
- **Proposed fix:**
  1. `body.mobile :is(.m-top, .m-dock, .m-peek, .m-sheet-head, .pc-head, .tc-chip, .narr-head) { touch-action: none; }`.
  2. Let scroll bodies keep vertical panning: `body.mobile :is(.m-sheet-body, .pc-body, .inspector, .srch-list, .tour-menu, .gw-panel, .narr-body, .exp-table) { touch-action: pan-x pan-y; }`.
  3. Banners: give `body.mobile :is(.banner, .wlabel) { touch-action: none; }`. Better, make them `pointer-events: none` on touch and hit-test them in the canvas `pointerup` handler (`app.js:375`) with `document.elementsFromPoint`. Then a pan or pinch that starts on a label moves the map.
  4. iOS Safari also fires `gesturestart`. Add `document.addEventListener('gesturestart', e => e.preventDefault())` while `body.mobile`, because Safari ignores `user-scalable=no`.

  Keep the viewport meta zoomable for accessibility. `touch-action` is the targeted fix.
- **Effort:** S (CSS) + S (banner hit-testing).

### M-02 During a tour, tapping the map leaves an invisible inspector that eats every tap and drag on the bottom half
- **Severity:** P0. **Devices:** all phones (by the same CSS, the dimmed desktop panels also stay clickable during tours). **Interacts with PR #3.**
- **Repro:** start any tour → tap a hex on the map → try to tap or pan anywhere in the lower ~45% of the screen.
- **Evidence:**
  - `previews/mux-05-ghost-inspector-eats-taps-in-tour.png`
  - `previews/mux-06-tour-card-over-ghost-inspector.png` (this is the "inspector ghosting behind the tour card" Hashir saw)
  - The inspector computes `opacity: 0.15` and `pointer-events: auto`, at `z-index: 24` over 374×388 px. `document.elementFromPoint` at its centre returns `.insp-title`, and tapping there does nothing visible.
  - Cause: `body.touring .inspector { opacity: .15; pointer-events: none }` (`style.css:294`, specificity 0-2-1) loses to `#hud > * { pointer-events: auto }` (`style.css:21`, specificity 1-0-0). It also leaves `m-sheet-open` set on `body` (seen in `body.className`), which hides the lens key and time bars.
- **Proposed fix:**
  - Specificity: `body.touring #hud > :is(.dock, .legend, .inspector, .timebar) { pointer-events: none; }`.
  - On phones, decide what a map tap during a tour means. Recommended: `app.select()` does nothing while `body.mobile.touring` (MapControls panning still works). The alternative is to pause the tour and show the inspector at full opacity, with the badge staying visible.
  - Either way, add `body.mobile.touring .inspector { display: none !important; }` so a stale selection cannot ghost.
- **Effort:** S.

---

## P1: major annoyance or frequent

### M-03 Whatever you select is flown to the centre of the screen, under the bottom sheet that opens for it
- **Devices:** all phones in portrait.
- **Repro:** search "Badshahi Mosque" and pick it; or tap the Karachi banner; or select a district (Quetta). Do the same with a `#site=` deep link.
- **Evidence:**
  - `previews/mux-10-flyto-target-under-sheet.png`
  - For iPhone 14 the camera target projects to (195, 422) in all three cases, and the inspector spans y = 382…770 (or 408…770). The selected place is behind the card 3 of 3 times.
  - Surprise is the exception: its card starts at y = 505, so the target stays visible.
- **Proposed fix:** while a bottom sheet is open on `body.mobile`, shift the projection centre up by half the sheet's height using `camera.setViewOffset(w, h, 0, sheetH / 2, w, h)`. Update it on sheet open/close and resize, and call `clearViewOffset()` when the sheet closes. This keeps orbit/zoom-to-cursor maths intact. A cheaper alternative is to pass a screen-space offset into `stage.flyTo`, as `MobileUI.homePose()` already does for home. With PR #2, call `requestRender()` after changing the offset.
- **Effort:** M.

### M-04 The browser back button leaves the site from any state
- **Devices:** all; Android's system back gesture makes this very frequent.
- **Repro:** arrive from another page → select Lahore → open the Lenses sheet → press Back.
- **Evidence:** `/tmp/mux-flows/back.json`: `history.length` stays at 3 after opening things, and Back lands on the previous site. The only history call is `replaceState` (`app.js:479`).
- **Proposed fix:**
  - In `MobileUI.open()`, `history.pushState({ sheet: key }, '')` when nothing is open yet. Use `history.replaceState` when switching between sheets, so there is only ever one entry.
  - On `popstate`, `closeAll()` (and `tours.stop()` / `guide.end()` if active).
  - When a sheet is closed by ✕ or a map tap, call `history.back()` if `history.state?.sheet`.
  - Keep `_saveHash` on `replaceState`, but write the hash into the current entry so it survives.
- **Effort:** M.

### M-05 Play all (cinema): the tour badge is hidden under the cinema ✕
- **Devices:** all phones. **PR #3.**
- **Repro:** Tours → ▶ Play all.
- **Evidence:**
  - `previews/mux-07-cinema-badge-under-exit.png`
  - The exit is at (338, 8, 44×44) and the badge at (334, 8, 48×48). `elementFromPoint` at the badge centre returns `.cinema-exit`, and the badge computes `top: 8px`.
  - Cause: `body.mobile.cinema .tc-chip { top: calc(var(--m-top) + 52px) }` (`tourchip.css:16`, 0-3-1) loses to `body.mobile.touring .tc-chip:not(.hidden) { top: var(--m-top) }` (`tourchip.css:9`, 0-4-1). The card rule at `tourchip.css:63` works only because it comes later.
  - Only next/pause poke out beside the ✕, so in cinema the card cannot be opened and the ✕ is the badge's neighbour.
- **Proposed fix:** `body.mobile.touring.cinema .tc-chip:not(.hidden) { top: calc(var(--m-top) + 52px); }`.
- **Effort:** S (one selector).

### M-06 Duel: the district inputs sit under the keyboard and the suggestions run off the screen
- **Devices:** all phones (keyboard simulated).
- **Repro:** Duel (empty) → tap "District A…" → type "Kar".
- **Evidence:**
  - `previews/mux-12-duel-input-under-keyboard.png`
  - With no districts picked, the Duel sheet is short and bottom-anchored. The focused input sits at y = 667 and the iOS keyboard starts at y ≈ 508. The autocomplete list (`.duel-ac`, `panels.css:147`) is 322 px tall from y = 703, so it ends at 1,025 on an 844 px screen even with no keyboard.
  - Also: names are clipped in the 154 px inputs ("South Karac…", `mux-18-tap-targets-duel.png`).
- **Proposed fix:**
  - Pin the Duel sheet to the top while picking: `body.mobile .duel:focus-within { top: var(--m-top); bottom: auto; }`.
  - Open the list above or below depending on space, with `max-height: calc(var(--vvh, 100dvh) - <input bottom> - 8px)`, where `--vvh` is set from `visualViewport.height` on `visualViewport` resize.
  - Add `interactive-widget=resizes-content` to the viewport meta for Android Chrome.
  - Stack the two inputs vertically on phones (`.duel-pick { grid-template-columns: 1fr }`).
- **Effort:** M.

### M-07 Explorer: the scatter plot is a scroll trap, and a swipe on it can empty the table
- **Devices:** all phones.
- **Repro:** Explore → scroll down to the plot → swipe up on the plot to keep scrolling.
- **Evidence:**
  - `previews/mux-13-explorer-plot-scroll-trap.png`
  - `.exp-svg` is `touch-action: none` (`panels.css:117`) and 348×250 px, which is almost half the panel. The swipe did not scroll (scrollTop 273 → 0, a jump back to the top). Instead it drew a brush that caught **0 districts**, so the table read "Brushed: 0 districts" and showed no rows.
  - Dragging on the table itself scrolls normally (0 → 311).
- **Proposed fix:**
  - On touch, use `touch-action: pan-y` on the plot and brush only after a long-press (~300 ms), or behind a "Brush" toggle button.
  - In the `pointerup` handler (`explorer.js:244`), treat a brush that selects nothing as `clearBrush()`.
  - Give the plot a fixed 200 px on phones, so there is always panel to grab beside it.
- **Effort:** M.

### M-08 Tapping a row or point in the Explorer closes the Explorer
- **Devices:** all phones.
- **Repro:** Explore → sort by any column → scroll → tap a district.
- **Evidence:**
  - `previews/mux-11-explorer-row-tap-loses-table.png`
  - `_choose()` (`explorer.js:299`) calls `select()`, which opens the inspector. The one-sheet rule (`mobile.js:166`) then closes the Explorer. `expOpen: false` after the tap, so sort, scroll and brush are lost, and comparing districts means reopening it every time.
  - The minimised state (`.exp.min`, styled for phones at `mobile.css:159`) exists but is never used here.
- **Proposed fix:**
  - On phones, `_choose()` should add `.min` to the Explorer (a 52 px bar above the dock) instead of letting it close.
  - Exempt a minimised Explorer from the one-sheet rule, and stack the inspector above it.
  - Tapping the bar restores the full panel with its state.
- **Effort:** M.

### M-09 No onboarding on phones, and all the help text assumes a mouse and keyboard
- **Devices:** all phones.
- **Repro:** first visit on a phone; then open the ❔ Welcome; then open Tours.
- **Evidence:**
  - `previews/mux-01-first-load-phone.png`: `intro()` returns early on phones (`app.js:94`), and the welcome never auto-opens. A first-time visitor gets the map with no hint that it pans, pinches, twists or taps.
  - `previews/mux-02-welcome-desktop-copy.png`: the welcome says "click anything", "Click a city banner", "Find … in a keystroke ( / )", and "Reopen … with the ❔ Guide button or the ? key" (`guide.js:52-71`).
  - The Tours sheet ends with "Esc to stop · → / ← to step" (`tours.js:26`).
- **Proposed fix:**
  - Phone copy variants (tap / pinch / two-finger twist), chosen with `this.app.mobile.on`. Drop the key hints with `body.mobile .gw-hint { display: none }`, or rewrite them.
  - On a first phone visit (`guide.shouldAutoShow()`), show a one-off toast or coach mark: "Drag to move · pinch to zoom · twist to turn · tap anything". Pulse the Tours dock button once.
- **Effort:** S.

### M-10 The walkthrough is the desktop walkthrough on a phone
- **Devices:** all phones and landscape.
- **Repro:** More → Walkthrough, then step through all 19 steps.
- **Evidence:**
  - `previews/mux-14-walkthrough-desktop-steps.png` and `previews/mux-15-walkthrough-card-covers-target.png`; `/tmp/mux-flows/walk.json`.
  - Step 2 says "right-drag … scroll to zoom … double-click … press H". Step 5 says "Hovering shows a quick card … Shift-click". Step 8 says "Number keys 1–9". Steps 13–18 each end in a keyboard shortcut.
  - The "map centre" spotlight is a desktop rectangle (`guide.js:136`): a 180 px column on a phone.
  - The card (top, 193 px) overlaps the spotlighted target on 5 of 19 steps: 10,310–65,263 px² of overlap, and it covers the Explorer header and the Duel/Search panels.
  - The last step targets `.guide-btn`, which is hidden on phones, so it has no spotlight.
- **Proposed fix:**
  - A phone step list, using `this.app.mobile.on` in `_steps()`: drop the hover and keyboard steps, point at `.m-dbtn[data-sheet=…]` dock buttons instead of desktop panels, and finish on `.m-guide`.
  - When the target is a bottom sheet, place the card at the top and cap the sheet's height so they don't meet. When the card would cover the target, put the card at the bottom.
- **Effort:** M.

### M-11 iPad portrait (769–1100 px) gets the desktop UI under a finger, and has no route to the Explorer
- **Devices:** tablet 820×1180 (also 810/834; iPad landscape 1024–1366 by the same rule; 820 was the one verified).
- **Repro:** open on an iPad Air or 10th-gen iPad in portrait.
- **Evidence:**
  - `previews/mux-19-tablet-820-desktop-layout.png`: 39 targets under 44 px and 31 under 32 px on the home screen. Lens buttons are 24 px tall, the top bar 33×34, the dock-collapse 24×22, the relief slider 120×16, the inspector/welcome ✕ 27×23.
  - `previews/mux-20-tablet-820-tour-end-13px.png`: the end-tour ✕ is **13×13**, and step controls are 31×27.
  - The yields bar, which is the desktop's way into the Explorer, is `display: none` at ≤900 px (`style.css:379`), and there is no Explorer button in the top bar (`app.js:217-229`). The Explorer is reachable only via the welcome card, a district inspector's "📊" action, or the E key.
  - `MOBILE_QUERY` (`mobile.js:10`) only adds coarse pointers when they are ≤520 px tall.
- **Proposed fix:**
  - Extend the query to `(max-width: 768px), (pointer: coarse) and (max-width: 1100px), (pointer: coarse) and (max-height: 520px)`, so touch tablets get the dock layout. The 768 px tablet already shows it works (`mux-27-ok-tablet-768-phone-layout.png`).
  - Add `@media (pointer: coarse)` minimums for the remaining desktop chrome: `.tb-btn, .lens-btn, .layer-btn, .chip { min-height: 40px }`, `.narr-x, .insp-close, .gw-x { min-width: 44px; min-height: 44px }`.
  - Add an "📊 Explore" top-bar button.
- **Effort:** S for the query and Explorer button, M for the coarse-pointer pass.

### M-12 Map labels are cut off at the screen edge and can sit under the HUD
- **Devices:** all; worst during tours and Surprise.
- **Repro:** run "From K2 to the Arabian Sea", or press Surprise until it lands on Punjab.
- **Evidence:**
  - `previews/mux-08-labels-clipped-at-edge.png` and `previews/mux-09-labels-clipped-landscape.png`.
  - The label audit over the K2 tour (`/tmp/mux-flows/labels.json`) found edge-clipped labels on **4 of 5 stops**: 2, 4, 4, 0 and 2 labels. Examples: "Batura Glacier", "Muzaffarabad", "Rawalpindi", "Hyderabad". Gwadar sat under the brand chip on stop 5.
  - In the landscape tour, "Lake Saiful Muluk" starts at x = −34. Surprise put "Faisalabad" at x = −49. Clipped labels stay tappable off-screen.
  - Cause: `place()` in `Sites.updateLabels` (`sites.js:287`) accepts anything within ±1.1 NDC (5% beyond each edge) and checks labels only against each other, not the HUD.
- **Proposed fix:**
  - In `place()`, reject a box that leaves `[4, W-4] × [4, H-4]`.
  - Seed `boxes` with the HUD's rects (`.m-top > *`, `.m-dock`, `.tc-chip`, `.m-peek`, open sheet), read once per declutter pass, so labels never land under chrome.
  - Keep the focused label, but clamp it to the viewport (translate the element) instead of hiding it.
  - With PR #2's on-demand loop, call `requestLabels()` when a sheet opens or closes, since the declutter now skips unchanged frames.
- **Effort:** S.

### M-13 Battery and heat: a still map renders continuously at DPR 2 with 4096² shadows and bloom
- **Devices:** all phones. **Fixed by PR #2.**
- **Evidence:**
  - On this branch a still map rendered **29 frames in 5 s** under SwiftShader (`/tmp/mux-flows/perf-mobile.json`). That is the unconditional `requestAnimationFrame` loop (`stage.js:96-101`), which on a phone GPU means 60–120 full renders per second while the user just reads a sheet.
  - The setup also includes `setPixelRatio(min(dpr, 2))` (`stage.js:13`), `PCFShadowMap` at 4096² and UnrealBloom (`stage.js:15-16, 37`).
  - PR #2 measured **0** idle renders (`/tmp/mux-flows/perf-perf.json`) and picked the low tier at pixel ratio 1 for this software-GL phone (`mux-28-light-sheet-this-branch.png` vs `mux-29-light-sheet-perf-branch.png`).
- **Proposed fix:** merge PR #2; see "Interaction with PR #2" for the mobile follow-ups.
- **Effort:** done in PR #2.

---

## P2: polish

### M-14 Tap targets under 44 px
- **Devices:** all phones. Distinct elements under 44 px: 73 on iPhone 14, 58 on the 360 px Android.
- **Evidence:**
  - `previews/mux-16-tap-targets-tour-card.png`, `previews/mux-17-tap-targets-eras.png`, `previews/mux-18-tap-targets-duel.png` (amber < 44, red < 32).
  - Worst, on iPhone 14:

    | Element | Size (px) | Where |
    |---|---|---|
    | walkthrough dots `.gd-dots i` | 10×3 | tappable |
    | lens-legend source link | 127×13 | |
    | almanac/surprise/era source links | 14–17 tall | |
    | wonder labels `.wlabel` | 14 tall | |
    | "Skip tour ✕" `.gd-skip` | 73×16 | |
    | city banners | 20 tall | |
    | duel preset chips | 24 tall | |
    | era ticks | 26 tall | |
    | explorer column headers | 29 tall | |
    | explorer log checkboxes | 13×13 | |
    | duel inputs | 32 tall | |
    | tour badge next/pause `.tc-btn` | 36×36 | drawn as 26 px discs |
    | `.tc-min` | 36 | |
    | lens/layer buttons | 36 tall | |
    | Explorer minimise | 34×36 | |
    | narration ◀ ❚❚ ▶ | 42×38 | |
    | era ▶ | 38 | |
    | every ✕ (`.m-x`, `.pc-x`, `.insp-close`, `.gw-x`, `.narr-x`) | 40×40 | |
  - Raw lists: `node scripts/mux/report.mjs /tmp/mux-matrix i14`.
- **Proposed fix:**
  - Raise the ✕ buttons to 44×44 (`mobile.css:69, 73`; `tourchip.css:81`).
  - `.tc-btn` to 44×44, keeping the 26 px disc as the visual (the hit area can overlap the badge rim). The next/pause positions at `tourchip.css:44-45` need +4 px.
  - On phones: lens and layer buttons `min-height: 40px`, duel chips `min-height: 36px`, era ticks `min-height: 40px`, and `.gd-dots i { padding: 10px 2px; background-clip: content-box }`.
  - Give inline source links a 44 px line box via `padding-block`.
- **Effort:** S–M.

### M-15 Small text and low contrast
- **Evidence:**
  - Smallest text on phones is 9–9.5 px:
    - dock labels `.m-dlabel` (`mobile.css:50`);
    - narration eyebrow, step and source `.narr .k/.narr-step/.narr .src` (`style.css:274, 279, 283`);
    - the glance yields `.yield .k` (`mobile.css:131`);
    - the explorer sort arrow.
  - 10 px: banner population `.banner-pop` (`mobile.css:219`), `.m-sub`, `.insp-kicker`, `.dock-gtitle`, duel radar labels (`.rd-lbl`).
  - 49 distinct sub-12 px text styles on iPhone 14.
  - Contrast below 4.5:1:

    | Text | Ratio | Notes |
    |---|---|---|
    | `.banner-pop` | **3.21:1** | dark text on the teal gradient, on every city banner |
    | search result sub-lines `.srch-rl small` / `.srch-rx` | 3.41:1 | |
    | inspector kicker, subtitle and ✕ | 3.59–3.71:1 | |
    | on the 820 tablet: City View badge | 1.52:1 | |
  - See `previews/mux-01-first-load-phone.png` and `previews/mux-22-city-view-small-text.png`.
- **Proposed fix:**
  - A phone floor of 11 px for mono micro-labels: `body.mobile :is(.m-dlabel, .narr .k, .narr-step, .narr .src, .yield .k, .m-sub, .insp-kicker, .dock-gtitle) { font-size: 11px }`. Use 10.5 px only where letter-spacing is ≥0.1em and the text is uppercase.
  - `.banner-pop { color: #e8f4f8 }` (or a darker teal stop), which gives ≥7:1.
  - On the inspector hero, use `--ink` at 80% instead of `--ink-dim` for the kicker, subtitle and ✕.
- **Effort:** S.

### M-16 Tour card controls: when paused, it shows ◀ ▶ ▶; "shrink" sits 6 px from "end tour"
- **PR #3.**
- **Evidence:**
  - `previews/mux-21-tour-controls-paused.png`: `togglePause()` writes `▶` into the pause button (`tours.js:236, 263`), right beside the `▶` next button.
  - The PR #3 shrink button `.tc-min` (36 px) and the end-tour `.narr-x` (40 px) are at x = 263–299 and 305–345. A slip ends the tour and resets the view (`tours.stop()` → `resetView()`).
- **Proposed fix:**
  - Use the badge's SVG glyphs (play/pause) on the card too, and give "next" a distinct glyph (⏭ or "Next").
  - Move `.tc-min` to the card's top-left, or put ≥16 px between them.
  - Make ✕ during a tour ask nothing, but don't `resetView()` on phones: leave the camera where it is.
- **Effort:** S.

### M-17 `prefers-reduced-motion` is ignored by camera flights and tours
- **Evidence:** with `reducedMotion: 'reduce'` emulated, Surprise still starts a 2.4 s flight with a 900-unit arc (`/tmp/mux-flows/motion.json`), and tours auto-advance. `Stage.flyTo` (`stage.js:57`) has no check.
- **Proposed fix:**
  - In `flyTo`, `if (matchMedia('(prefers-reduced-motion: reduce)').matches) { duration = Math.min(duration, 0.35); lift = 0; }`.
  - Start tours paused (or with no arc) under reduced motion, and disable Play all's loop.
- **Effort:** S.

### M-18 The legend histogram can't be scrubbed with a finger, and its highlight sticks
- **Evidence:**
  - The histogram listens only for `mousemove`/`mouseleave` (`lenses.js:150-155`).
  - A tap fires one emulated mousemove (one bar, 290 hexes highlighted). A finger drag along it produced no further calls.
  - The highlight stays until the sheet closes (`/tmp/mux-flows/hover.json`).
- **Proposed fix:** use `pointerdown` / `pointermove` / `pointerup` with `setPointerCapture`, plus `touch-action: pan-y` on `.lg-hist`. Clear on `pointerup` or a second tap.
- **Effort:** S.

### M-19 Sheets can't be swiped down to close, and have no grab handle
- **Evidence:** dragging the Lenses sheet header down 240 px left it open (`swipeDownHeader.stillOpen: true`). Closing needs the 40 px ✕ or a tap on the map, which for the inspector instead selects a new tile.
- **Proposed fix:** a 36×4 px handle in `.m-sheet-head` / `.pc-head` / `.insp-hero`, plus a `pointer`-driven drag-to-dismiss (>80 px or a fast flick closes). This needs `touch-action: none` on the head, which M-01 adds anyway.
- **Effort:** M.

### M-20 Explorer is cramped in landscape and at 360 px
- **Evidence:**
  - `previews/mux-23-landscape-explorer.png`: in landscape the panel is ~240 px tall, showing 5 rows, with the plot below the fold.
  - `previews/mux-24-android-explorer-table.png`: at 360 px only District and Province fit. The 13-column table scrolls sideways with no affordance, and the province colour key is far below.
- **Proposed fix:**
  - On phones, show 3 columns (District, sorted metric, one chosen metric) and move the rest into the tapped row's inspector.
  - In landscape, put table and plot side by side (`.exp-grid { grid-template-columns: 1fr 1fr }` under `(orientation: landscape) and (max-height: 520px)`).
- **Effort:** M.

### M-21 Search results under the keyboard
- **Evidence:** with "a" typed, the search sheet ends at y = 548 against a keyboard top of ≈508 (iPhone 14). 8 of 40 results are above the keyboard and the last 40 px of the list are always hidden, because `max-height: min(64dvh, …)` (`mobile.css:143`) ignores the keyboard on iOS.
- **Proposed fix:** set `--vvh` from `visualViewport.height` on its `resize` event and use `max-height: calc(var(--vvh) - var(--m-top) - 8px)` for `.srch` (shared with M-06).
- **Effort:** S.

### M-22 Few pressed states, and sticky hover on touch
- **Evidence (code reading):** only `.m-dbtn`, `.m-x`, `.m-tile` and `.tc-btn` have `:active` styles (`mobile.css:56, 72, 128`; `tourchip.css:37`). Lens and layer buttons, chips, tour cards, `.pc-btn`, duel chips and banners only have `:hover`, which on iOS sticks after a tap. Tap feedback on the 3D map is the outline/highlight only, and arrives after the raycast.
- **Proposed fix:** wrap hover rules in `@media (hover: hover)`, and add `:active { filter: brightness(1.25) }` (or a 1 px amber inset) to `.lens-btn, .layer-btn, .chip, .tour-card, .pc-btn, .duel-chip, .gw-card, .srch-row`.
- **Effort:** S.

### M-23 Accessible names and focus basics
- **Evidence (code reading plus the metrics names):**
  - `.insp-close`, `.gw-x`, `.narr-x` and `.pc-x` are text "✕" buttons with only a `title`. Their accessible name is the glyph, which VoiceOver reads as "multiplication x". Narration controls are "◀", "❚❚" and "▶".
  - City banners and wonder labels are `div`s with click handlers (`sites.js:179-183, 230-231`): not focusable and without a role.
  - The phone dock, top icons and tour badge are labelled correctly (`mobile.js:50, 63`; `tourchip.js:31, 43`).
- **Proposed fix:** add `aria-label="Close"` (or "End tour") to those buttons, and `aria-label`s to the narration controls. Make banners `<button>`s, or give them `role="button" tabindex="0"` with a keydown handler.
- **Effort:** S.

### M-24 AJK and Gilgit-Baltistan city banners show "—" for population
- **Evidence:** Muzaffarabad, Gilgit and Skardu render `— | name` (`mux-08`, `mux-09`). The banner prints `'—'` when `c.pop` is null (`sites.js:180`). This is honest, but on a phone it reads as a rendering glitch next to "13.0M".
- **Proposed fix:** drop the population cell when it is unknown, or use the WorldPop-based district figure the app already uses for AJK and GB (`app.js:212`).
- **Effort:** S.

### M-25 Browser-chrome polish: no theme colour, no app metadata, and pull-to-refresh is guarded only on `body`
- **Evidence (code reading, not verifiable headless):**
  - `index.html` has no `<meta name="theme-color">` (Android's toolbar and iOS 15+'s tab bar stay white or grey over a black app), no `apple-touch-icon` and no manifest.
  - `overscroll-behavior: none` is on `body.mobile` only (`mobile.css:18`), not on `html`. That is the element Chrome uses for the viewport's pull-to-refresh. A downward drag that starts on a non-scrolling HUD element (brand chip, sheet header) may trigger a reload on Android.
- **Proposed fix:**
  - `<meta name="theme-color" content="#07090d">`, an `apple-touch-icon` and a minimal `manifest.webmanifest` (also lets "Add to Home Screen" run full-screen).
  - `html { overscroll-behavior: none; }`.
- **Effort:** S.

---

## Interaction with PR #2 (perf/low-end-devices)

- **Checked:** `docs/perf-audit.md`, `web/src/quality.js` and `web/src/scene/frame.js` on `origin/perf/low-end-devices` @ `43f00a7`. Built and served from `/tmp/mux-perf`.
- **Merge:** `git merge-tree` of PR #2 with PR #3 is clean. PR #2 is based on `3a67605`, so it has no tour badge. The badge's progress ring is DOM-driven and tour flights `wake()` the loop, so nothing in the badge depends on continuous rendering. This is code reading; it was not run merged.
- **Fixes M-13:**
  - A still phone map drew **0** frames in 5 s on PR #2, against **29** here.
  - Auto picked `low` for the software-GL phone (reason: "software GL") at pixel ratio 1.
  - Ready time on the iPhone 14 profile was 2.1 s on PR #2 vs 5.9 s here (SwiftShader).
- **Which tier real phones will get (code reading, not verified on hardware):**
  - iPhones report `Apple GPU`. Safari exposes no `deviceMemory`, and its `hardwareConcurrency` value is not reliable enough to trust here, so `guessTier` will mostly start them on **high**: DPR 2, 4096² shadows, bloom. The FPS governor then steps down if the median frame time is above 41 ms. That is the right default for recent iPhones, but older ones (A12/A13) will run hot until the governor reacts. Consider starting `(pointer: coarse)` devices on **medium**.
  - Mid-range Android (Adreno 6xx, Mali-G68/G7x) → medium. Entry-level Android (Mali-G52/G57, PowerVR, ≤2 GB) → low, at DPR ≤1 and ~0.9 MP. On a 3× phone that looks soft; compare `previews/mux-29-light-sheet-perf-branch.png` with `previews/mux-28-light-sheet-this-branch.png`. The DOM HUD and labels stay sharp.
- **The ⚙ quality control exists only on PR #2.** On phones it is a "Graphics: Low / Auto / High" row at the bottom of the Light & relief sheet (`mux-29`). Its chips are 40 px tall (under 44) and its note is 11.5 px. When auto steps down, the one-time toast uses `.toast`, which on phones sits below the top bar (`mobile.css:215`). It does not collide with the badge.
- **Follow-ups needed after both PRs merge:**
  - M-12's HUD-aware declutter must call `requestLabels()` when sheets open or close, since PR #2 skips the declutter when nothing changed.
  - M-03's `setViewOffset` must call `requestRender()`.
  - M-01, M-02, M-05 and M-09 are unaffected by PR #2.

## Interaction with PR #3 (tour radial badge)

- **Works (verified here):** the badge shows over the tour, and tapping it pins the card open (`body.tc-pinned`). The card's ✕ ends the tour. The card survives rotation in both directions with its pinned state (`rot-tour-land`/`portrait`). Peek and hold were covered by the PR's own `scripts/tour-radial-shots.mjs`; this audit did not re-test them.
- **Broken or rough:**
  - **M-05** (badge hidden under the cinema ✕ by specificity).
  - **M-16** (shrink button 6 px from end-tour; ◀ ▶ ▶ when paused).
  - Badge next and pause are 36 px hit areas drawn as 26 px discs (M-14).
- **Not caused by PR #3, but now more visible:** M-02's ghost inspector shows through the bottom half under the pinned card (`mux-06`). Labels can sit under the badge (M-12).
- **Reachability:** during a tour the dock and the top-right icons are hidden (`mobile.css:204`), so the only exits are badge → card → ✕ (two taps) or the brand chip. On a phone the brand tap did not stop the tour (`touring: true` afterwards). Consider making the brand chip end the tour, or adding a ✕ beside the badge.

## Quick wins (each under about an hour)

1. **M-02:** `body.touring #hud > :is(.dock, .legend, .inspector, .timebar) { pointer-events: none }`, plus `body.mobile.touring .inspector { display: none !important }`.
2. **M-05:** `body.mobile.touring.cinema .tc-chip:not(.hidden) { top: calc(var(--m-top) + 52px) }`.
3. **M-01 (most of it):** `touch-action: none` on `.m-top, .m-dock, .m-peek, sheet heads, .tc-chip` and on `.banner, .wlabel`; `touch-action: pan-x pan-y` on the scroll bodies; a `gesturestart` `preventDefault` for iOS.
4. **M-12:** in `sites.js:287`, reject label boxes that leave the viewport and seed `boxes` with the HUD rects.
5. **M-11 (part):** extend `MOBILE_QUERY` to coarse-pointer tablets up to 1100 px, and add an Explore button to the top bar.
6. **M-09:** phone wording in the welcome, tour note and hint; a one-time "drag · pinch · twist · tap" toast on first phone visit.
7. **M-15:** `.banner-pop` text colour, and an 11 px floor for mono micro-labels on phones.
8. **M-16:** distinct play/next glyphs; move `.tc-min` away from `.narr-x`.
9. **M-17:** shorten flights and drop the arc under reduced motion.
10. **M-25:** `theme-color`, `html { overscroll-behavior: none }`, and `aria-label`s on the ✕ buttons (M-23).

## Verified OK

- **Safe areas:** with 47 px top and 34 px bottom insets (CDP override, portrait) and 47 px side insets (landscape), no control, toast, walkthrough card, cinema exit or badge falls inside an unsafe zone (`mux-25-ok-safe-area-insets.png`). `viewport-fit=cover` is set.
- **Short viewport and 100vh:** at 375×553 (iPhone SE with both Safari bars) every sheet, the inspector, the welcome, the tour card and the era bar fit between the top bar and the dock. The phone layout uses `dvh` everywhere (`mux-26-ok-short-viewport-se.png`).
- **iOS focus zoom:** all 7 text inputs and selects compute to 16 px on phones (`mobile.css:22`).
- **Map gestures:**
  - Drag pans the map. Pinch on bare map zooms the map, not the page.
  - Double-tap on the map does not zoom the page (it fires `dblclick`, which only flies when a cell is selected).
  - Long-press on the map or a banner produced no context menu and no text selection.
- **Sheets:** scrolling inside a sheet scrolls it (scrollTop 0 → 392) without moving the map, and overscroll is contained. Tapping the map closes the open sheet. Only one sheet is ever open.
- **Landscape 844×390:** the dock becomes a right rail, sheets sit beside it, and the country fits the free area (`mux-30-ok-landscape-rail.png`). Every state was captured without overlap of the chrome itself. Explorer is cramped (M-20), but the layout is not broken.
- **Tablet 768:** gets the phone layout, which works by touch (`mux-27-ok-tablet-768-phone-layout.png`).
- **Rotation mid-flow:** inspector, pinned tour card and home view all survive portrait ↔ landscape, and home re-fits to the new shape.
- **Deep links:** `#site=…` opens the inspector and flies there (but see M-03). `#lens=literacy&mood=night` restores the lens, the light and the legend peek.
- **Load:** with 4× CPU throttle and ~9 Mbps, the loader shows progress text ("Loading atlas… 3/6"), the map is visible at ~1.9 s, and `__livingpakistan_ready` fires at 7.4 s in SwiftShader. The first sheet opens 0.5 s after that.
- **WebGL context loss:** `loseContext()` then `restoreContext()` re-rendered the scene in Chromium.
- **Hover-only tooltips** are correctly suppressed for touch on phones and the 820 tablet: tapping shows the inspector, not a stuck tooltip.
- **Phone dock and top bar:** all six dock buttons and the search and guide icons are ≥44 px, with `aria-label`s and `aria-expanded`.

## Caveats

- **No real iOS Safari or Android hardware.** Everything ran in Chromium with touch emulation and an iOS user agent. Safari-specific behaviour is inferred, not observed:
  - the collapsing bottom bar and its `resize` events;
  - `gesturestart`, and the keyboard's effect on the visual viewport;
  - double-tap zoom on non-`manipulation` elements;
  - long-press callouts on `div` banners (`-webkit-touch-callout` is unsupported in Chromium);
  - rubber-banding.

  M-01's page zoom is a Chromium measurement. iOS Safari also zooms the page on a pinch over an element without `touch-action: none`, but its persistence across reload was only observed in Chromium.
- **Software GL (SwiftShader)** makes absolute timings pessimistic and keeps PR #2 on its low tier. Frame rate and thermal behaviour on real phone GPUs were not measured, and the iPhone tier assignment is code reading.
- **Keyboard** effects are a 336 px overlay drawn over the layout viewport (iOS-style), not a real keyboard.
- **Pull-to-refresh** (M-25) cannot be triggered in headless Chromium, so it is code reading only.
- **Contrast** is computed against the first opaque background. Text drawn straight over the 3D map (wonder labels, `.wlabel`) is not scored.
- **Language and long strings:** the app ships English only. Long names truncate with an ellipsis in sheets (search, inspector, duel inputs), and banners grow with the name (the widest measured was 137 px). No RTL or Urdu layout exists to test.
- **GA requests:** the first bulk run loaded the site's GA tag before blocking was added to the harness. A handful of headless page views may have been sent to the GA4 property on 2026-11-28 (from 127.0.0.1 origins).
- **Reproducing:** raw shots and JSON live in `/tmp/mux-matrix` and `/tmp/mux-flows` and are not committed. `scripts/mux/annotate.py scripts/mux/annotate-spec.json` re-draws the annotated files from them.
