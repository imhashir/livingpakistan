// Before/after evidence for docs/mobile-ux-fixes.md: one screenshot and one
// measurement per audited issue, taken the same way on any build.
//   MUX_BASE=http://127.0.0.1:4410/ node scripts/mux/fixshots.mjs <outDir> [m01,m02,...]
// Writes <outDir>/<mid>.png (and a few extras) and <outDir>/results.json.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, context, DEVICES, open, touch, annotate, clearAnn, boxOf, log } from './lib.mjs';
import { collect, summarize } from './metrics.mjs';

const [outDir = '/tmp/muxfix', only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const resFile = join(outDir, 'results.json');
const results = existsSync(resFile) ? JSON.parse(readFileSync(resFile, 'utf8')) : {};
const save = () => writeFileSync(resFile, JSON.stringify(results, null, 1));
const A = (page, fn, arg) => page.evaluate(`(${fn.toString()})(window.__livingpakistan, ${JSON.stringify(arg ?? null)})`);
const landed = (page) => page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 }).catch(() => {});
const animsDone = (page) => page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 30000, polling: 200 }).catch(() => {});
const vv = (page) => page.evaluate(() => ({ scale: +visualViewport.scale.toFixed(3), w: Math.round(visualViewport.width), h: Math.round(visualViewport.height) }));
const shotTo = (page, name) => page.screenshot({ path: join(outDir, name), timeout: 240000 });
const settle = async (page, ms = 1200) => { await page.waitForTimeout(ms); await landed(page); await animsDone(page); await page.waitForTimeout(400); };

const cases = {};

// M-01: a pinch that starts on the dock must not zoom the page
cases.m01 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { drag } = await touch(ctx, page);
  const dock = await page.locator('.m-dock').boundingBox();
  const dy = dock.y + dock.height / 2;
  await drag([[170, dy], [220, dy]], [[60, dy - 200], [330, dy - 120]], 10); await page.waitForTimeout(1500);
  const onDock = await vv(page);
  // and one that starts on a city banner
  const b = await page.evaluate(() => { const n = [...document.querySelectorAll('.banner')].find((x) => x.querySelector('.banner-name')?.textContent === 'Karachi'); const r = n?.getBoundingClientRect(); return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await shotTo(page, 'm01.png');
  await ctx.close();
  const ctx2 = await context(browser, DEVICES.i14);
  const { page: p2 } = await open(ctx2);
  const t2 = await touch(ctx2, p2);
  const cam0 = await A(p2, (A) => A.stage.camera.position.distanceTo(A.stage.controls.target));
  if (b) await t2.drag([[b.x - 20, b.y], [b.x + 20, b.y]], [[b.x - 120, b.y - 60], [b.x + 120, b.y + 60]], 10);
  await p2.waitForTimeout(1500);
  const onBanner = { ...(await vv(p2)), camDistBefore: Math.round(cam0), camDistAfter: Math.round(await A(p2, (A) => A.stage.camera.position.distanceTo(A.stage.controls.target))) };
  await ctx2.close();
  return { pinchOnDock: onDock, pinchOnBanner: onBanner };
};

// M-02: tap the map during a tour, then see what owns the lower half
cases.m02 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tap } = await touch(ctx, page);
  await A(page, (A) => A.tours.run(0)); await page.waitForTimeout(2500); await landed(page);
  await A(page, (A) => { A.tours.paused = true; });
  await tap(200, 620, 2000); await animsDone(page);
  const r = await page.evaluate(() => {
    const i = document.querySelector('.inspector'), cs = getComputedStyle(i), b = i.getBoundingClientRect();
    const hit = document.elementFromPoint(195, 600);
    return { inspVisible: cs.display !== 'none' && !i.classList.contains('hidden'), opacity: cs.opacity, pointerEvents: cs.pointerEvents, box: [b.left, b.top, b.width, b.height].map(Math.round), hitAt195x600: hit?.tagName.toLowerCase() + (hit?.className ? '.' + String(hit.className).split(' ')[0] : ''), selection: !!window.__livingpakistan.selection, sheetOpenClass: document.body.classList.contains('m-sheet-open') };
  });
  const boxes = [{ x: 195 - 6, y: 600 - 6, w: 12, h: 12, label: `elementFromPoint → ${r.hitAt195x600}`, color: r.hitAt195x600.startsWith('canvas') ? '#30d158' : '#ff2d55' }];
  if (r.inspVisible) boxes.push({ x: r.box[0], y: r.box[1], w: r.box[2], h: r.box[3], label: `inspector opacity ${r.opacity}, pointer-events ${r.pointerEvents}`, color: '#ff2d55' });
  await annotate(page, boxes);
  await shotTo(page, 'm02.png');
  await ctx.close();
  return r;
};

// M-03: is what you selected visible above its sheet?
cases.m03 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const out = [];
  const run = {
    badshahi: (A) => { const s = A.sites.sites.find((x) => x.name === 'Badshahi Mosque'); A.select({ site: s }); A.flyToSite(s); },
    karachi: (A) => { const s = A.sites.sites.find((x) => x.name === 'Karachi' && x.kind === 'city'); A.select({ site: s }); A.flyToSite(s, { distance: 420 }); },
    quetta: (A) => { const i = A.districts.findIndex((d) => d.name === 'Quetta'); A.select({ district: i }); A.flyToDistrict(i); },
  };
  for (const [name, fn] of Object.entries(run)) {
    await A(page, (A) => { A.mobile.closeAll(); A.select(null); A.home(true); }); await page.waitForTimeout(600);
    await A(page, fn); await settle(page, 1500);
    const r = await page.evaluate(() => {
      const A = window.__livingpakistan, cam = A.stage.camera, t = A.stage.controls.target.clone().project(cam);
      const x = (t.x + 1) / 2 * innerWidth, y = (1 - t.y) / 2 * innerHeight;
      const b = document.querySelector('.inspector:not(.hidden)')?.getBoundingClientRect();
      return { target: [Math.round(x), Math.round(y)], sheetTop: b && Math.round(b.top), underSheet: !!(b && y >= b.top && y <= b.bottom) };
    });
    out.push({ name, ...r });
    if (name === 'badshahi') {
      await annotate(page, [{ x: r.target[0] - 14, y: r.target[1] - 14, w: 28, h: 28, label: `Badshahi Mosque ${r.underSheet ? '(under the sheet)' : '(visible)'}`, color: r.underSheet ? '#ff2d55' : '#30d158' }]);
      await shotTo(page, 'm03.png'); await clearAnn(page);
    }
  }
  await ctx.close();
  return out;
};

// M-05: Play all on a phone, who owns the badge's centre?
cases.m05 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  await A(page, (A) => A.tours.playAll()); await page.waitForTimeout(3000); await A(page, (A) => { A.tours.paused = true; }); await animsDone(page);
  const r = await page.evaluate(() => {
    const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); };
    const h = document.querySelector('.tc-hold').getBoundingClientRect();
    const top = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2);
    return { exit: box('.cinema-exit'), badge: box('.tc-hold'), topAtBadgeCentre: top?.className || top?.tagName };
  });
  await annotate(page, [{ x: r.exit[0], y: r.exit[1], w: r.exit[2], h: r.exit[3], label: 'cinema ✕', color: '#ff9f0a' },
    { x: r.badge[0], y: r.badge[1], w: r.badge[2], h: r.badge[3], label: `badge (top: ${r.topAtBadgeCentre})`, color: /tc-/.test(r.topAtBadgeCentre) ? '#30d158' : '#ff2d55' }]);
  await shotTo(page, 'm05.png');
  await ctx.close();
  return r;
};

// M-06: Duel input with a (simulated) iOS keyboard: visualViewport shrinks to 508px
cases.m06 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  await A(page, (A) => { A.mobile.closeAll(); A.duel.open(); }); await settle(page, 1200);
  const kbTop = 844 - 336;
  await page.locator('.duel-slot input').first().focus();
  // what iOS does when the keyboard comes up: the visual viewport shrinks and fires resize
  await page.evaluate((h) => { Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => h }); visualViewport.dispatchEvent(new Event('resize')); }, kbTop);
  await page.keyboard.type('Kar'); await page.waitForTimeout(900); await animsDone(page);
  const r = await page.evaluate((kbTop) => {
    const q = (s) => { const n = document.querySelector(s); if (!n || n.classList.contains('hidden')) return null; const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const inp = q('.duel-slot input'), ac = q('.duel-ac:not(.hidden)');
    const rows = [...document.querySelectorAll('.duel-ac:not(.hidden) > div')];
    return { kbTop, input: inp, list: ac, inputAboveKeyboard: !!inp && inp.bottom <= kbTop, listFitsAboveKeyboard: !!ac && ac.bottom <= kbTop, rows: rows.length, rowsAboveKeyboard: rows.filter((n) => n.getBoundingClientRect().bottom <= kbTop).length, cols: getComputedStyle(document.querySelector('.duel-pick')).gridTemplateColumns };
  }, kbTop);
  const boxes = [await boxOf(page, '.duel-slot input', 'focused input', '#ff9f0a'), await boxOf(page, '.duel-ac:not(.hidden)', 'suggestions', r.listFitsAboveKeyboard ? '#30d158' : '#ff2d55')].filter(Boolean);
  await annotate(page, [...boxes, { x: 0, y: kbTop, w: 390, h: 336, label: 'simulated iOS keyboard (336px)', color: '#5856d6' }]);
  await page.evaluate((kbTop) => { const d = document.createElement('div'); d.id = 'mux-kb'; d.style.cssText = `position:fixed;left:0;right:0;top:${kbTop}px;bottom:0;background:rgba(60,60,70,.92);z-index:99998;color:#fff;font:600 15px system-ui;display:grid;place-items:center`; d.textContent = 'keyboard'; document.body.append(d); }, kbTop);
  await shotTo(page, 'm06.png');
  // search with the keyboard up (M-21)
  await page.evaluate(() => document.getElementById('mux-kb')?.remove()); await clearAnn(page);
  await page.evaluate(() => document.activeElement?.blur());
  await A(page, (A) => { A.mobile.closeAll(); A.search.open(); }); await page.waitForTimeout(1200);
  await page.evaluate((h) => visualViewport.dispatchEvent(new Event('resize')), kbTop);
  await page.keyboard.type('a'); await page.waitForTimeout(900);
  r.search = await page.evaluate((kbTop) => { const rows = [...document.querySelectorAll('.srch-row')]; return { total: rows.length, sheetBottom: Math.round(document.querySelector('.srch').getBoundingClientRect().bottom), fitsAboveKeyboard: document.querySelector('.srch').getBoundingClientRect().bottom <= kbTop }; }, kbTop);
  await ctx.close();
  return r;
};

// M-09: a first visit on a phone (nothing stored, no ?guide=0), then the welcome's wording
cases.m09 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx, { params: {} });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    coach: (() => { const n = document.querySelector('.m-coach'); return n && getComputedStyle(n).display !== 'none' ? n.textContent : null; })(),
    welcomeOpen: !document.querySelector('.guide-welcome').classList.contains('hidden'),
  }));
  await shotTo(page, 'm09.png');
  await A(page, (A) => A.guide.openWelcome()); await settle(page, 900);
  r.welcomeText = await page.evaluate(() => document.querySelector('.gw-panel').innerText);
  r.mouseWords = (r.welcomeText.match(/\b(click|keystroke|hover|key)\b|\( \/ \)|\? key/gi) || []);
  await shotTo(page, 'm09-welcome.png');
  await A(page, (A) => { A.guide.closeWelcome(); A.mobile.open('tours'); }); await settle(page, 900);
  r.toursNote = await page.evaluate(() => document.querySelector('.tour-menu .src-note')?.textContent);
  await ctx.close();
  return r;
};

// M-11: iPad portrait (820x1180, coarse pointer)
cases.m11 = async (browser) => {
  const ctx = await context(browser, DEVICES.tab820);
  const { page } = await open(ctx);
  await settle(page, 600);
  const m = await collect(page);
  const r = { mobile: await page.evaluate(() => document.body.classList.contains('mobile')), summary: summarize(m), explore: await page.evaluate(() => { const n = document.querySelector('.m-dbtn[data-sheet=explore], .tb-btn.exp-tb'); return !!n && n.getBoundingClientRect().width > 0; }) };
  await shotTo(page, 'm11.png');
  await ctx.close();
  return r;
};

// M-12: labels over the K2 tour: clipped at the edge, or under the HUD
cases.m12 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const measure = () => page.evaluate(() => {
    const hud = ['.m-top .m-brand', '.m-top-right', '.m-dock', '.tc-chip:not(.hidden) .tc-hold', '.m-peek:not(.hidden)', '.cinema-exit', '.inspector:not(.hidden)', '.m-sheet:not(.hidden)', '.timebar:not(.hidden)']
      .flatMap((s) => [...document.querySelectorAll(s)].map((n) => [s.split(/[ :]/)[0].replace('.', ''), n])).filter(([, n]) => { const cs = getComputedStyle(n); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; }).map(([s, n]) => ({ n: s, r: n.getBoundingClientRect() }));
    const out = [];
    for (const l of document.querySelectorAll('.banner, .wlabel')) {
      if (getComputedStyle(l).display === 'none' || l.offsetParent === null) continue;
      const r = l.getBoundingClientRect(); if (!r.width) continue;
      const clipped = r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight;
      const under = hud.filter((h) => r.left < h.r.right && r.right > h.r.left && r.top < h.r.bottom && r.bottom > h.r.top).map((h) => h.n);
      if (clipped || under.length) out.push({ text: l.textContent.trim(), box: [r.left, r.top, r.width, r.height].map(Math.round), clipped, under });
    }
    return out;
  });
  const res = { home: await measure(), stops: [] };
  await A(page, (A) => A.tours.run(0));
  const n = await page.evaluate(() => window.__livingpakistan.tours.active.tour.steps.length);
  const want = +(process.env.M12_STOP ?? 1);
  for (let i = 0; i < n; i++) {
    await A(page, (A, i) => { const t = A.tours; t.paused = true; t.show(i); }, i);
    await page.waitForTimeout(1200); await landed(page); await page.waitForTimeout(1200);
    const bad = await measure();
    res.stops.push({ i, clipped: bad.filter((b) => b.clipped).length, underHud: bad.filter((b) => !b.clipped && b.under.length).length, bad });
    if (i === want) {
      await annotate(page, bad.map((b) => ({ x: b.box[0], y: b.box[1], w: b.box[2], h: b.box[3], label: b.clipped ? 'clipped at edge' : 'under ' + b.under.join('+'), color: b.clipped ? '#ff2d55' : '#ff9f0a' })));
      await shotTo(page, 'm12.png'); await clearAnn(page);
    }
  }
  // a sheet opening must re-run the declutter (on-demand rendering)
  await A(page, (A) => { A.tours.stop(false); A.select(null); A.home(true); }); await settle(page, 1200);
  await A(page, (A) => A.mobile.open('lenses')); await settle(page, 1200);
  res.withLensesSheet = (await measure()).filter((b) => b.under.includes('m-sheet')).length;
  await ctx.close();
  return res;
};

const browser = await launch();
for (const k of (only || Object.keys(cases).join(',')).split(',')) {
  try { log('case', k); results[k] = await cases[k](browser); save(); log(k, JSON.stringify(results[k]).slice(0, 600)); }
  catch (e) { log('case', k, 'FAILED', e.stack); results[k] = { error: e.message }; save(); }
}
await browser.close();
