// Screenshots and an interaction check of the phone tour badge (tourchip.js):
// collapsed on the K2 stop, mid-peek (a real touch press-and-hold), pinned
// open on stop 3, and the desktop card for comparison. Needs a running app:
// `npm run preview` (or `npm run dev`).
// Usage: node scripts/tour-radial-shots.mjs [baseUrl] [outDir]
// Software GL at 3x is slow: expect a few minutes.
import { chromium } from 'playwright';
import { join, resolve } from 'node:path';

const [base = 'http://127.0.0.1:4173/', outDir = 'previews'] = process.argv.slice(2);
const OUT = resolve(outDir);
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
let browser = await chromium.launch({ args: GL });
const shot = (page, f) => page.screenshot({ path: join(OUT, f), timeout: 180000 });
const report = {};

async function open(ctx, extra = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = new URL(base); url.searchParams.set('guide', '0');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 180000 });
  // the app flies home ~900 ms after start, which would take over a tour's first flight: let it land first
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 90000 });
  return { page, errors };
}
// show stop i of tour 0 and wait for the camera to land on it
// (the dwell bar only starts moving once the camera has arrived; the stage is
// also not in flight before the flight begins, so that alone is not enough)
async function land(page, i, dwellPct = 1) {
  await page.evaluate((i) => { const t = window.__livingpakistan.tours; if (!t.active) t.run(0); if (t.active.i !== i) t.show(i); }, i);
  await page.waitForFunction((i) => { const a = window.__livingpakistan; return a.tours.active?.i === i && !a.stage.flight; }, i, { timeout: 90000 });
  if (dwellPct) await page.waitForFunction((p) => parseFloat(document.querySelector('.narr .prog')?.style.width) >= p, dwellPct, { timeout: 120000, polling: 200 });
  // hold the tour on this stop without touching its controls, so the badge still shows "playing"
  await page.evaluate(() => { window.__livingpakistan.tours.paused = true; });
  await page.waitForTimeout(600);
}
const settled = (page, cls) => page.waitForFunction((cls) => {
  const n = document.querySelector('.narr'), kid = n.querySelector('.narr-body');
  return document.body.classList.contains(cls) && kid && getComputedStyle(kid).opacity === '1'
    && !n.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
}, cls, { timeout: 30000, polling: 100 });

// ---------- phone
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const { page, errors } = await open(ctx);
  const cdp = await ctx.newCDPSession(page);
  const state = () => page.evaluate(() => ['tc-peek', 'tc-pinned'].find((c) => document.body.classList.contains(c)) || 'closed');
  const ev = (type, pts, timestamp) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, ...(timestamp ? { timestamp } : {}) });
  // A quick tap. The events carry their own timestamps, as on a phone: under
  // software GL the page can stall for seconds, which would otherwise turn any
  // scripted tap into a hold.
  const tap = async (x, y) => { const ts = Date.now() / 1000; await Promise.all([ev('touchStart', [{ x, y }], ts), ev('touchEnd', [], ts + 0.08)]); await page.waitForTimeout(700); };
  const mouse = (type, x, y, timestamp) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, timestamp });
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

  await land(page, 0, 40);
  const geo = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && [b.left, b.top, b.right, b.bottom].map(Math.round); };
    return { badge: r('.tc-hold'), next: r('.tc-next'), pause: r('.tc-pause'), brand: r('.m-brand') };
  });
  await shot(page, 'tour-radial-collapsed.png');
  const [x, y] = await center('.tc-hold');

  // press and hold: peek
  await ev('touchStart', [{ x, y }]);
  await settled(page, 'tc-peek');
  await page.waitForTimeout(300);
  const held = await state();
  const cardBox = await page.evaluate(() => { const b = document.querySelector('.narr').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); });
  await shot(page, 'tour-radial-expanded.png');
  await ev('touchEnd', []);
  await page.waitForTimeout(600);
  const released = await state();

  const r = { geo, cardBox, held, released };
  await tap(x, y); r.tapPins = await state();
  r.stillTouring = await page.evaluate(() => !!window.__livingpakistan.tours.active);
  await tap(195, 600); r.mapTapCloses = await state();
  // that tap reached the map and may have selected a site: clear it so it does not ghost into later shots
  await page.evaluate(() => window.__livingpakistan.select(null));
  await tap(x, y); await page.locator('.narr .tc-min').click(); await page.waitForTimeout(500); r.shrinkCloses = await state();
  r.touringAfterShrink = await page.evaluate(() => !!window.__livingpakistan.tours.active);
  // mouse: hold to peek, release, then a click pins
  let ts = Date.now() / 1000;
  await mouse('mouseMoved', x, y, ts); await mouse('mousePressed', x, y, ts);
  await page.waitForFunction(() => document.body.classList.contains('tc-peek'), null, { timeout: 30000 });
  r.mouseHold = await state();
  await mouse('mouseReleased', x, y, Date.now() / 1000); await page.waitForTimeout(500); r.mouseRelease = await state();
  ts = Date.now() / 1000;
  await Promise.all([mouse('mousePressed', x, y, ts), mouse('mouseReleased', x, y, ts + 0.08)]); await page.waitForTimeout(600);
  r.mouseClickPins = await state();
  await page.locator('.narr .tc-min').click(); await page.waitForTimeout(500);
  // satellites work while collapsed
  const [nx, ny] = await center('.tc-next');
  await tap(nx, ny); r.nextStep = await page.evaluate(() => window.__livingpakistan.tours.active?.i);
  await page.evaluate(() => { window.__livingpakistan.tours.paused = false; });
  const [px, py] = await center('.tc-pause');
  await tap(px, py); r.pauseOn = await page.evaluate(() => window.__livingpakistan.tours.paused);
  await tap(px, py); r.pauseOff = await page.evaluate(() => window.__livingpakistan.tours.paused);

  // pinned on stop 3
  await land(page, 2);
  await tap(x, y);
  await settled(page, 'tc-pinned');
  await page.waitForTimeout(300);
  r.stop3 = await state();
  r.stop3Count = await page.evaluate(() => document.querySelector('.narr .count')?.textContent);
  await shot(page, 'tour-radial-pinned-stop3.png');
  // the card's ✕ ends the tour and hides the badge
  await page.locator('.narr .narr-x').click(); await page.waitForTimeout(600);
  r.xEnds = await page.evaluate(() => !window.__livingpakistan.tours.active && getComputedStyle(document.querySelector('.tc-chip')).display === 'none');
  r.errors = errors;
  report.phone = r;
  await ctx.close();
}

// ---------- desktop, with a stale ?tourchip param: the original card, no badge
{
  // a fresh browser: after the 3x phone run, software GL can leave it too slow to keep time
  await browser.close();
  browser = await chromium.launch({ args: GL });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, errors } = await open(ctx, { tourchip: 'C' });
  await land(page, 0);
  report.desktop = await page.evaluate(() => ({
    badgeShown: getComputedStyle(document.querySelector('.tc-chip')).display !== 'none',
    cardVisible: getComputedStyle(document.querySelector('.narr')).visibility === 'visible',
    inert: document.querySelector('.narr').hasAttribute('inert'),
    errors: [],
  }));
  report.desktop.errors = errors;
  await shot(page, 'tour-radial-desktop.png');
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
