// Screenshots of the ?tourchip=A|B|C|D mobile tour-chip concepts, collapsed
// and mid-peek (a real touch press-and-hold on the chip), plus an overview
// sheet. Needs a running app: `npm run dev` (or `npm run preview`).
// Usage: node scripts/tourchip-shots.mjs [baseUrl] [outDir] [concepts, e.g. ABCD]
// Software GL at 3x is slow: each concept takes a minute or two.
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [base = 'http://127.0.0.1:5173/', outDir = 'previews', only = 'ABCD'] = process.argv.slice(2);
const OUT = resolve(outDir);
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
const CONCEPTS = {
  A: ['Progress pill', 'Ring = tour progress, tap it to pause. Tap pill to pin, hold to peek, › next.'],
  B: ['Stop chip', 'Stop name + key stat. Tap to pin, hold to peek, › next; swipe ← → to step.'],
  C: ['Radial badge', 'Tour icon in a ring of step segments; the card blooms from the circle.'],
  D: ['Ticker strip', '‹ stop › always on top; the card unrolls beneath the strip.'],
};

const browser = await chromium.launch({ args: GL });
const shot = (page, f) => page.screenshot({ path: join(OUT, f), timeout: 180000 });
const report = {};
for (const v of Object.keys(CONCEPTS).filter((k) => only.toUpperCase().includes(k))) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = new URL(base); url.searchParams.set('guide', '0'); url.searchParams.set('tourchip', v);
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 180000 });
  // tour 1, stop 1 (K2); wait for the camera to land and the dwell to run a little
  await page.evaluate(() => window.__livingpakistan.tours.run(0));
  await page.waitForFunction(() => { const a = window.__livingpakistan; return a.tours.active?.i === 0 && !a.stage.flight; }, null, { timeout: 60000 });
  // let the stop's dwell run to ~40%, so the chip's progress is visible
  await page.waitForFunction(() => parseFloat(document.querySelector('.narr .prog')?.style.width) >= 40, null, { timeout: 120000, polling: 200 });
  // hold the tour on this stop without touching its controls, so the chip still shows "playing"
  await page.evaluate(() => { window.__livingpakistan.tours.paused = true; });
  await page.waitForTimeout(500);
  await shot(page, `tourchip-${v}-collapsed.png`);

  const box = await page.locator('.tc-chip .tc-hold').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const state = () => page.evaluate(() => ['tc-open', 'tc-peek', 'tc-pinned'].filter((c) => document.body.classList.contains(c)).join(' ') || 'closed');
  await touch('touchStart', [{ x, y }]);
  // software GL keeps the main thread busy, so wait for the card to finish opening, not a fixed time
  await page.waitForFunction(() => {
    const n = document.querySelector('.narr'), kid = n.querySelector('.narr-body');
    return document.body.classList.contains('tc-peek') && kid && getComputedStyle(kid).opacity === '1'
      && !n.getAnimations({ subtree: true }).some((a) => a.playState === 'running' && a.transitionProperty);
  }, null, { timeout: 30000, polling: 100 });
  await page.waitForTimeout(300);
  const held = await state();
  await shot(page, `tourchip-${v}-expanded.png`);
  await touch('touchEnd', []);
  await page.waitForTimeout(450);
  const released = await state();
  // A quick tap pins it open. The events carry their own hardware timestamps,
  // as on a phone: under software GL the page can stall for seconds, which
  // would otherwise turn any scripted tap into a hold.
  const quickTap = async (px, py) => {
    const ts = Date.now() / 1000;
    const a = cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }], timestamp: ts });
    const b = cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts + 0.08 });
    await a; await b; await page.waitForTimeout(600);
  };
  await quickTap(x, y);
  const tapped = await state();
  // touching the map puts a pinned card away
  await quickTap(195, 560);
  const afterMapTap = await state();
  // and so does the card's shrink button (D: a second tap on the strip)
  await quickTap(x, y);
  if (!await page.evaluate(() => { const b = document.querySelector('.tc-min'); b?.click(); return !!b; })) await quickTap(x, y);
  await page.waitForTimeout(300);
  const afterShrink = await state();
  report[v] = { held, released, tapped, afterMapTap, afterShrink, errors };
  await ctx.close();
}

// overview sheet: four columns, collapsed over expanded
const dir = mkdtempSync(join(tmpdir(), 'tourchip-'));
const img = (f) => pathToFileURL(join(OUT, f)).href;
const col = (v) => `<div class="col"><h2><b>${v}</b> ${CONCEPTS[v][0]}</h2><p>${CONCEPTS[v][1]}</p>
  <figure><img src="${img(`tourchip-${v}-collapsed.png`)}"><figcaption>collapsed</figcaption></figure>
  <figure><img src="${img(`tourchip-${v}-expanded.png`)}"><figcaption>press &amp; hold: peek</figcaption></figure></div>`;
writeFileSync(join(dir, 'overview.html'), `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; padding: 28px 28px 30px; background: #05090c; color: #e8f4f8; font: 14px/1.4 Inter, system-ui, sans-serif; }
  header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 20px; }
  header h1 { margin: 0; font-size: 22px; color: #ffb627; } header span { color: #6f8d99; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 300px); gap: 24px; }
  h2 { margin: 0; font-size: 17px; font-weight: 600; } h2 b { color: #7fe7ff; margin-right: 4px; }
  p { margin: 4px 0 10px; color: #8fb0bc; font-size: 12.5px; min-height: 36px; }
  figure { margin: 0 0 14px; } img { display: block; width: 300px; border: 1px solid rgba(127,231,255,.3); }
  figcaption { font: 10.5px ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #6f8d99; margin-top: 5px; }
</style><header><h1>Mobile tour chip — concepts A–D</h1><span>390×844 @3x · K2 stop, tour 1 of 5 · ?tourchip=A|B|C|D</span></header>
<div class="grid">${Object.keys(CONCEPTS).map(col).join('')}</div>`);
const sheet = await browser.newPage({ viewport: { width: 4 * 300 + 3 * 24 + 56, height: 600 }, deviceScaleFactor: 2 });
await sheet.goto(pathToFileURL(join(dir, 'overview.html')).href);
await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
await sheet.screenshot({ path: join(OUT, 'tourchip-overview.png'), fullPage: true });
await browser.close();
console.log(JSON.stringify(report, null, 1));
