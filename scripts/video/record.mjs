// living pakistan demo-video director: drives the production build frame-by-frame (deterministic virtual clock, ?capture=1),
// performs real mouse/keyboard input, and writes one JPEG per frame + a timeline log (cursor, clicks, zoom keyframes,
// chapter labels) for scripts/video/compose.py.
//   npm run build && npx vite preview --port 4173 &
//   node scripts/video/record.mjs [outDir=/tmp/livingpakistan-video/raw]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/tmp/livingpakistan-video/raw';
const URL = process.env.LIVINGPAKISTAN_URL || 'http://127.0.0.1:4173/?capture=1';
const W = 1600, H = 900, FPS = 30;
const DRY = !!process.env.DRY;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
// no welcome modal / walkthrough in the video
await ctx.addInitScript(() => { try { localStorage.setItem('livingpakistan.welcome.v1', 'hide'); } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 180000 });
await page.waitForTimeout(1200); // fonts + loader fade

// ------------------------------------------------------------------ timeline state
let frame = 0;
let cursor = [W * 0.62, H * 0.55];
const log = { fps: FPS, width: W, height: H, frames: [], zooms: [{ f: 0, cx: W / 2, cy: H / 2, s: 1 }], chapters: [], clicks: [] };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const js = (fnOrStr, arg) => page.evaluate(fnOrStr, arg);

async function step(n = 1) {
  for (let i = 0; i < n; i++) {
    await js((d) => window.__livingpakistan_step(1 / 30, d), !DRY);
    if (!DRY) await page.screenshot({ path: path.join(OUT, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    log.frames.push({ c: [Math.round(cursor[0]), Math.round(cursor[1])] });
    frame++;
    if (frame % 150 === 0) console.log(`frame ${frame} (${(frame / FPS).toFixed(1)} s)`);
  }
}
const hold = (sec) => step(Math.round(sec * FPS));

async function rect(selector, text) {
  return js(([sel, txt]) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => !txt || e.textContent.includes(txt));
    const e = els.find((n) => n.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, [selector, text]);
}
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

/** Glide the cursor (eased) to a point / selector over `sec`, sending real mouse moves (hover effects). */
async function moveTo(target, sec = 0.7, text) {
  let p = target;
  if (typeof target === 'string') { const r = await rect(target, text); if (!r) throw new Error(`no element ${target} ${text || ''}`); p = centre(r); }
  const from = [...cursor], n = Math.max(1, Math.round(sec * FPS));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n), arc = Math.sin(Math.PI * (i / n)) * 18;
    cursor = [from[0] + (p[0] - from[0]) * k, from[1] + (p[1] - from[1]) * k - arc];
    await page.mouse.move(cursor[0], cursor[1]);
    await step(1);
  }
  return p;
}
async function click(target, text, sec = 0.6) {
  if (target) await moveTo(target, sec, text);
  log.clicks.push(frame);
  await page.mouse.click(cursor[0], cursor[1]);
  await step(1);
}
async function drag(to, sec = 1.2) {
  await page.mouse.down(); log.clicks.push(frame);
  await moveTo(to, sec);
  await page.mouse.up();
}
const zoom = (cx, cy, s) => log.zooms.push({ f: frame, cx, cy, s });
async function zoomOn(selector, s = 1.5, text, dx = 0, dy = 0) { const r = await rect(selector, text); if (r) zoom(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy, s); }
const unzoom = () => zoom(W / 2, H / 2, 1);
const chapter = (title, sub, sec = 3.4) => log.chapters.push({ f: frame, n: Math.round(sec * FPS), title, sub });
/** Screen position of a map cell (projected through the live camera). */
const cellScreen = (cell) => js((c) => {
  const a = window.__livingpakistan; const [x, y, z] = a.cellWorld(c);
  const v = a.sites.worldPos({ xy: a.board.grid.center(c) }); v.y = Math.max(y, 0) + 0.6;
  v.project(a.stage.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
}, cell);
const siteScreen = (name) => js((n) => {
  const a = window.__livingpakistan; const s = a.sites.sites.find((q) => q.name === n); const v = a.sites.worldPos(s, 1);
  v.project(a.stage.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
}, name);

// ------------------------------------------------------------------ the film
console.log('recording…');
// 1 · Arabian Sea → K2 → home -------------------------------------------------------------------------------------
await js(() => {
  const a = window.__livingpakistan; a.ui.dock.classList.add('collapsed'); a.setMood('golden'); a.setLayer('roads', false);
  const [x, z] = a.board.mapToWorld(770, 1530); // off the Karachi coast
  a.stage.controls.target.set(x, 0, z); a.stage.camera.position.set(x - 60, 70, z + 260);
  const k2 = a.sites.sites.find((s) => s.name === 'K2'); const p = a.sites.worldPos(k2);
  a.stage.flyTo([p.x, p.y, p.z], { distance: 520, tilt: 1.02, azimuth: 0.25, duration: 6.5 });
});
log.title = { f: 0, n: 110 };
await hold(6.8);
chapter('From the Arabian Sea to K2', 'Copernicus DEM · 0 m to 8,611 m · 3,409 hexes');
await js(() => { const a = window.__livingpakistan; const k2 = a.sites.sites.find((s) => s.name === 'K2'); const p = a.sites.worldPos(k2);
  a.stage.flyTo([p.x, p.y, p.z], { distance: 500, tilt: 1.0, azimuth: -0.6, duration: 2.2 }); });
await hold(2.2);
await js(() => { window.__livingpakistan.home(); window.__livingpakistan.stage.flight.duration = 2.3; });
await hold(2.3);

// 2 · relief + lighting -------------------------------------------------------------------------------------------
chapter('Stretch the relief · change the light', 'Relief ×1–30 · Day, Golden hour, Nightlights');
await moveTo('.relief input', 0.9);
zoom(W * 0.62, H * 0.7, 1.35);
await js(() => { const a = window.__livingpakistan; a.lines.group.visible = false; a.sites.group.visible = false; a.borders.group.visible = false; });
const relief = await rect('.relief input');
const sweep = [12, 28, 30, 16];
for (let s = 1; s < sweep.length; s++) {
  const n = 22;
  for (let i = 1; i <= n; i++) {
    const v = sweep[s - 1] + (sweep[s] - sweep[s - 1]) * ease(i / n);
    const x = relief.x + relief.w * (v - 1) / 29;
    cursor = [x, relief.y + relief.h / 2]; await page.mouse.move(cursor[0], cursor[1]);
    await js((val) => { const a = window.__livingpakistan; const cb = a.board.onExaggeration; a.board.onExaggeration = null; a.board.setExaggeration(val);
      a.board.onExaggeration = cb; a.reliefEl.querySelector('input').value = val; a.reliefEl.querySelector('b').textContent = val.toFixed(0); }, v);
    await step(1);
  }
}
await js(() => { const a = window.__livingpakistan; a.setRelief(16); a.lines.group.visible = true; a.sites.group.visible = true; a.borders.group.visible = true; });
await click('[data-mood="day"]', null, 0.5);
await zoomOn('.moods', 1.25, null, -150, -170);
await hold(0.8);
await click('[data-mood="golden"]', null, 0.4);
await hold(1.3);
await click('[data-mood="night"]', null, 0.5);
unzoom();
await hold(1.8);

// 3 · rivers & corridors -----------------------------------------------------------------------------------------
chapter('Indus rivers & caravan corridors', 'GT Road · Karakoram Highway · CPEC · ML-1 railway');
await click('.dock-toggle', null, 0.8);
await hold(0.3);
await zoomOn('[data-layer="corridors"]', 1.7, null, 120, -60);
await click('[data-layer="corridors"]', null, 0.9);
await hold(0.7);
unzoom();
await js(() => { const a = window.__livingpakistan; const [x, z] = a.board.mapToWorld(1250, 520);
  a.stage.flyTo([x, 0, z], { distance: 980, tilt: 0.9, azimuth: -0.35, duration: 3.6 }); });
await moveTo([W * 0.7, H * 0.4], 1.2);
await hold(2.4);
await js(() => { window.__livingpakistan.lines.focusCorridor('kkh'); });
await hold(1.4);
await js(() => { window.__livingpakistan.lines.focusCorridor(null); window.__livingpakistan.setLayer('corridors', false); });

// 4 · tiles & City View --------------------------------------------------------------------------------------------
chapter('Click any tile · City View', 'Census 2023 · Economic Census 2023 · modelled GDP');
await click('[data-mood="day"]', null, 0.7);
await js(() => { const a = window.__livingpakistan; const i = a.districts.findIndex((d) => d.name === 'Faisalabad'); a.flyToDistrict(i, { distance: 560, tilt: 0.86, azimuth: -0.1 }); a.stage.flight.duration = 1.8; });
await hold(1.9);
const fsd = await js(() => { const a = window.__livingpakistan; const d = a.districts.find((q) => q.name === 'Faisalabad'); return d.cells[Math.floor(d.cells.length * 0.35)]; });
await moveTo(await cellScreen(fsd), 0.9);
await hold(0.8);
await click(null);
await hold(0.4);
await zoomOn('.inspector', 1.45, null, 0, -60);
await hold(1.9);
unzoom();
if (await rect('.banner[data-id="lahore"]')) await click('.banner[data-id="lahore"]', null, 1.0);
else { await moveTo(await siteScreen('Lahore'), 1.0); log.clicks.push(frame);
  await js(() => { const a = window.__livingpakistan; a.select({ site: a.sites.sites.find((s) => s.kind === 'city' && s.name === 'Lahore') }); }); await step(1); }
await hold(0.4);
await zoomOn('.inspector', 1.4, null, 0, 40);
await page.mouse.move(W - 200, 500); cursor = [W - 200, 500];
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 40); await step(2); }
await hold(1.2);
unzoom();

// 5 · lenses -------------------------------------------------------------------------------------------------------
chapter('24 lenses on one board', 'Mother tongue · literacy · density · modelled GDP');
await page.keyboard.press('Escape'); await step(1);
await js(() => { window.__livingpakistan.home(); window.__livingpakistan.stage.flight.duration = 1.6; });
await zoomOn('[data-lens="language"]', 1.6, null, 140, 80);
await click('[data-lens="language"]', null, 0.8);
await hold(0.6);
unzoom();
await hold(1.2);
await click('[data-lens="literacy"]', null, 0.7);
await hold(1.2);
await click('[data-lens="density"]', null, 0.7);
await click('[data-mood="night"]', null, 0.6);
await hold(1.4);
await click('[data-lens="gold"]', null, 0.8);
await click('[data-mood="day"]', null, 0.6);
await hold(0.6);
const hist = await rect('.legend .lg-hist');
if (hist) {
  zoom(hist.x + hist.w / 2 + 120, hist.y - 60, 1.55);
  await moveTo([hist.x + 10, hist.y + hist.h / 2], 0.8);
  await moveTo([hist.x + hist.w - 10, hist.y + hist.h / 2], 2.2);
  unzoom();
  await moveTo([W * 0.6, H * 0.5], 0.6);
}

// 6 · 2022 flood ----------------------------------------------------------------------------------------------------
chapter('Replay the 2022 mega-flood', 'UNOSAT satellite extents · Aug → Dec 2022');
await click('[data-lens="flood"]', null, 0.8);
await js(() => { const a = window.__livingpakistan; a.ui.dock.classList.add('collapsed'); const [x, z] = a.board.mapToWorld(880, 1180);
  a.stage.flyTo([x, 0, z], { distance: 1050, tilt: 0.8, azimuth: 0.05, duration: 1.8 }); a.flood.speed = 1.35; });
await hold(1.6);
await click('.timebar:not(.hidden) .play', null, 0.8);
await zoomOn('.timebar:not(.hidden)', 1.3, null, 0, -120);
await moveTo([W * 0.55, H * 0.45], 1.2);
await hold(5.0);
unzoom();
await hold(0.6);

// 7 · eras ----------------------------------------------------------------------------------------------------------
chapter('9,000 years on the same hexes', 'Era Time-Machine · 42 dated sites');
await click('.tb-btn', 'Eras', 0.9);
await hold(0.4);
for (const k of [0, 1, 2, 5, 7]) {
  await click(`.timebar:not(.hidden) .ticks button:nth-child(${k + 1})`, null, 0.45);
  await js(() => { const f = window.__livingpakistan.stage.flight; if (f) f.duration = 1.2; });
  await hold(1.0);
}
await click('.tb-btn', 'Eras', 0.6);
await hold(0.4);

// 8 · duel ----------------------------------------------------------------------------------------------------------
chapter('District Duel', 'Any two districts, head to head');
await click('.tb-btn', 'Duel', 0.8);
await hold(0.3);
await click('.duel-chip', 'Faisalabad', 0.8);
await js(() => { const f = window.__livingpakistan.stage.flight; if (f) f.duration = 1.4; });
await zoomOn(`.duel-chips`, 1.35, null, -40, 260);
await moveTo([W - 260, 640], 1.2);
await hold(2.0);
unzoom();
await page.keyboard.press('Escape'); await step(1);

// 9 · explorer ------------------------------------------------------------------------------------------------------
chapter('District Explorer · all 160 districts', 'Sort, plot, brush — linked to the 3D map');
await click('.tb-btn', 'Explorer', 0.8);
await hold(0.5);
const svg = await rect('.exp-svg');
if (svg) {
  zoom(svg.x + svg.w / 2, svg.y + svg.h / 2, 1.3);
  await moveTo([svg.x + svg.w * 0.55, svg.y + svg.h * 0.2], 0.9);
  await hold(0.4);
  await drag([svg.x + svg.w * 0.95, svg.y + svg.h * 0.55], 1.3);
  await hold(1.2);
  unzoom();
}
await hold(0.6);
await page.keyboard.press('Escape'); await step(1);

// 10 · search & surprise --------------------------------------------------------------------------------------------
chapter('Search anything · Surprise me', '160 districts and 418 places');
await page.keyboard.press('/'); await step(2);
zoom(W / 2, 260, 1.35);
for (const ch of 'Mohenjo') { await page.keyboard.type(ch); await step(3); }
await hold(0.5);
await page.keyboard.press('Enter'); await step(1);
unzoom();
await js(() => { const f = window.__livingpakistan.stage.flight; if (f) f.duration = 1.8; });
await hold(2.0);
await click('.tb-btn', 'Surprise', 0.9);
await js(() => { const f = window.__livingpakistan.stage.flight; if (f) f.duration = 1.6; });
await zoomOn('.surp', 1.3);
await hold(2.2);
unzoom();
await page.keyboard.press('Escape'); await step(1);

// 11 · almanac ------------------------------------------------------------------------------------------------------
chapter('The Almanac · 23 public sources', 'Every number traces to a publisher, vintage and caveat');
await page.keyboard.press('a'); await step(2);
await zoom(W / 2, H * 0.45, 1.25);
await moveTo([W / 2, H * 0.55], 0.8);
for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 110); await step(2); }
await hold(0.8);
unzoom();
await page.keyboard.press('Escape'); await step(1);

// 12 · outro --------------------------------------------------------------------------------------------------------
await js(() => { const a = window.__livingpakistan; a.setLens('terrain'); a.setMood('night'); a.setLayer('corridors', true); a.home(); a.stage.flight.duration = 2.4; });
await moveTo([W - 40, H - 40], 1.0);
log.outro = { f: frame, n: Math.round(4.2 * FPS) };
await hold(4.4);

log.errors = errors;
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(log));
console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, errors }, null, 1));
await browser.close();
