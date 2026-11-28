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

// M-04: the browser back button closes what is open before it leaves the site
cases.m04 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const page = await ctx.newPage();
  await page.goto('data:text/html,<title>previous site</title><h1>previous site</h1>');
  const url = new URL((await import('./lib.mjs')).BASE); url.searchParams.set('guide', '0');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 240000 }); await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => { const A = window.__livingpakistan; return { onSite: !!A, insp: A && !A.inspector.root.classList.contains('hidden'), lenses: A && A.mobile.isOpen('lenses'), touring: A && !!A.tours.active, histLen: history.length }; }).catch(() => ({ onSite: false }));
  const back = async () => { await page.goBack({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1200); return { title: await page.title().catch(() => '?'), ...(await state()) }; };
  const r = {};
  await A(page, (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); A.flyToSite(k); }); await page.waitForTimeout(1500);
  r.inspectorOpen = await state();
  r.backFromInspector = await back();
  await A(page, (A) => A.mobile.open('lenses')); await page.waitForTimeout(900);
  await A(page, (A) => A.mobile.open('light')); await page.waitForTimeout(900);
  r.switchedSheets = await state();
  r.backFromSheet = await back();
  await A(page, (A) => A.tours.run(0)); await page.waitForTimeout(1500);
  r.backFromTour = await back();
  await A(page, (A) => { A.mobile.open('more'); }); await page.waitForTimeout(800);
  await A(page, (A) => { A.mobile.close('more'); }); await page.waitForTimeout(1200);
  r.closedByHand = await state();
  r.finalBack = await back();
  await ctx.close();
  return r;
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
    return { exit: box('.cinema-exit'), badge: box('.tc-hold'), topAtBadgeCentre: top?.closest('.tc-chip, .cinema-exit')?.className || top?.tagName };
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

// ---------------------------------------------------------------- checks without a pair of screenshots
const tourState = (page) => page.evaluate(() => window.__livingpakistan.tours.active?.i ?? null);

// M-07: the scatter plot scrolls with the panel; a hold then drag brushes; an empty brush clears
cases.m07 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { ev, drag } = await touch(ctx, page);
  await A(page, (A) => A.explorer.open()); await settle(page, 900);
  await page.evaluate(() => document.querySelector('.exp-svg').scrollIntoView({ block: 'center' })); await page.waitForTimeout(400);
  const body = () => page.evaluate(() => document.querySelector('.exp .pc-body').scrollTop);
  const box = await page.locator('.exp-svg').boundingBox();
  const r = { svgH: Math.round(box.height), touchAction: await page.evaluate(() => getComputedStyle(document.querySelector('.exp-svg')).touchAction) };
  const s0 = await body();
  await drag([[box.x + box.width / 2, box.y + box.height - 20]], [[box.x + box.width / 2, box.y + 10]], 10); await page.waitForTimeout(900);
  r.swipe = { scrollBefore: s0, scrollAfter: await body(), brush: await A(page, (A) => A.explorer.brush ? A.explorer.brush.size : null), info: await page.evaluate(() => document.querySelector('.exp-info').textContent) };
  // hold 450 ms, then drag a box over the left half of the plot
  await page.evaluate(() => document.querySelector('.exp-svg').scrollIntoView({ block: 'center' })); await page.waitForTimeout(400);
  const b2 = await page.locator('.exp-svg').boundingBox();
  const p0 = { x: b2.x + 70, y: b2.y + 15 }, p1 = { x: b2.x + b2.width * 0.7, y: b2.y + b2.height - 45 };
  await ev('touchStart', [{ x: p0.x, y: p0.y, id: 0 }]); await page.waitForTimeout(450);
  for (let k = 1; k <= 8; k++) await ev('touchMove', [{ x: p0.x + (p1.x - p0.x) * k / 8, y: p0.y + (p1.y - p0.y) * k / 8, id: 0 }]);
  await ev('touchEnd', []); await page.waitForTimeout(900);
  r.holdDrag = { brush: await A(page, (A) => A.explorer.brush ? A.explorer.brush.size : null), info: await page.evaluate(() => document.querySelector('.exp-info').textContent) };
  await annotate(page, [{ x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y, label: `hold + drag → ${r.holdDrag.brush} districts`, color: '#30d158' }]);
  await shotTo(page, 'm07.png'); await clearAnn(page);
  // a held brush over empty space
  await ev('touchStart', [{ x: b2.x + b2.width - 30, y: b2.y + 18, id: 0 }]); await page.waitForTimeout(450);
  for (let k = 1; k <= 4; k++) await ev('touchMove', [{ x: b2.x + b2.width - 30 + k * 4, y: b2.y + 18 + k * 2, id: 0 }]);
  await ev('touchEnd', []); await page.waitForTimeout(900);
  r.emptyBrush = { brush: await A(page, (A) => A.explorer.brush ? A.explorer.brush.size : null), rows: await page.evaluate(() => document.querySelectorAll('.exp-table tbody tr').length) };
  await ctx.close();
  return r;
};

// M-08 + M-20: picking a row keeps the Explorer (folded); phones show three columns
cases.m08 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tapSel } = await touch(ctx, page);
  await A(page, (A) => A.explorer.open()); await settle(page, 900);
  const r = { cols: await page.evaluate(() => [...document.querySelectorAll('.exp-table thead th')].map((t) => t.textContent.trim())) };
  await page.evaluate(() => { document.querySelector('.exp-table').scrollTop = 200; });
  await tapSel('.exp-table tbody tr:nth-child(12)', 2500); await landed(page); await animsDone(page);
  r.afterRowTap = await page.evaluate(() => {
    const e = document.querySelector('.exp'), i = document.querySelector('.inspector'), eb = e.getBoundingClientRect(), ib = i.getBoundingClientRect();
    return { expOpen: !e.classList.contains('hidden'), expMin: e.classList.contains('min'), insp: !i.classList.contains('hidden'), title: document.querySelector('.insp-title')?.textContent, inspBottom: Math.round(ib.bottom), barTop: Math.round(eb.top), stacked: ib.bottom <= eb.top + 1, tableScroll: document.querySelector('.exp-table').scrollTop };
  });
  await shotTo(page, 'm08.png');
  await tapSel('.exp.min .pc-title', 1500);
  r.afterBarTap = await page.evaluate(() => ({ expMin: document.querySelector('.exp').classList.contains('min'), insp: !document.querySelector('.inspector').classList.contains('hidden'), tableScroll: document.querySelector('.exp-table').scrollTop }));
  await ctx.close();
  const c2 = await context(browser, DEVICES.land);
  const { page: p2 } = await open(c2);
  await A(p2, (A) => A.explorer.open()); await settle(p2, 900);
  r.landscape = await p2.evaluate(() => ({ grid: getComputedStyle(document.querySelector('.exp-grid')).gridTemplateColumns, rowsVisible: [...document.querySelectorAll('.exp-table tbody tr')].filter((t) => { const b = t.getBoundingClientRect(), p = document.querySelector('.exp-table').getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }).length, svgTop: Math.round(document.querySelector('.exp-svg').getBoundingClientRect().top), vh: innerHeight }));
  await shotTo(p2, 'm20-landscape.png');
  await c2.close();
  return r;
};

// M-10: walkthrough on a phone: wording, and the card never on its target
cases.m10 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  await A(page, (A) => A.guide.start());
  const n = await page.evaluate(() => window.__livingpakistan.guide.steps.length);
  const steps = [];
  for (let i = 0; i < n; i++) {
    await A(page, (A, i) => A.guide.go(i), i);
    await page.waitForTimeout(2200); await landed(page); await page.waitForTimeout(900); await animsDone(page);
    steps.push(await page.evaluate(() => {
      const g = window.__livingpakistan.guide, sp = document.querySelector('.gd-spot'), card = document.querySelector('.gd-card').getBoundingClientRect();
      const s = sp.classList.contains('hidden') ? null : sp.getBoundingClientRect();
      const overlap = s ? Math.max(0, Math.min(card.bottom, s.bottom) - Math.max(card.top, s.top)) * Math.max(0, Math.min(card.right, s.right) - Math.max(card.left, s.left)) : 0;
      return { title: g.current.title, spot: !!s, overlap: Math.round(overlap), mouseWords: (g.current.body.match(/\b(click|hover|right-drag|scroll to zoom|shift|press [A-Z/?\[]|shortcut|keys?)\b/gi) || []) };
    }));
    if (i === 12) await shotTo(page, 'm10.png');
  }
  await ctx.close();
  return { n, withSpot: steps.filter((s) => s.spot).length, overlapping: steps.filter((s) => s.overlap > 0).length, mouseWordSteps: steps.filter((s) => s.mouseWords.length).length, steps };
};

// M-13: a still phone map draws nothing
cases.m13 = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  await page.waitForTimeout(3000);
  const d0 = await A(page, (A) => A.stage.drawn);
  await page.waitForTimeout(5000);
  const idle = (await A(page, (A) => A.stage.drawn)) - d0;
  await A(page, (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); }); await settle(page, 1500);
  const d1 = await A(page, (A) => A.stage.drawn); await page.waitForTimeout(5000);
  const idleWithSheet = (await A(page, (A) => A.stage.drawn)) - d1;
  const tier = await A(page, (A) => A.quality ? { mode: A.quality.mode, tier: A.quality.tier } : null);
  await ctx.close();
  return { idleFrames5s: idle, idleFramesWithInspector5s: idleWithSheet, tier };
};

// M-16, M-17, M-18, M-19, M-22, M-23, M-24, M-25: behaviour and markup
cases.misc = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tap, tapSel, drag, ev } = await touch(ctx, page);
  const r = {};
  // M-16: the card's controls when paused, and what its ✕ does to the camera
  await A(page, (A) => A.tours.run(0)); await page.waitForTimeout(2500); await landed(page);
  await A(page, (A) => { A.tours.togglePause(); A.tours.chip.open('pinned'); }); await page.waitForTimeout(1200); await animsDone(page);
  r.m16 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.narr-ctl .tb-btn')].map((n) => ({ label: n.getAttribute('aria-label') || n.title, glyph: n.querySelector('svg') ? n.querySelector('svg').innerHTML.slice(0, 40) : n.textContent }));
    const m = document.querySelector('.narr-head .tc-min').getBoundingClientRect(), x = document.querySelector('.narr-head .narr-x').getBoundingClientRect();
    return { controls: b, gapMinToX: Math.round(x.left - m.right), min: [Math.round(m.width), Math.round(m.height)], x: [Math.round(x.width), Math.round(x.height)] };
  });
  await shotTo(page, 'm16.png');
  const camBefore = await A(page, (A) => A.stage.camera.position.toArray().map(Math.round));
  await tapSel('.narr-head .narr-x', 2500);
  r.m16.afterX = { touring: await A(page, (A) => !!A.tours.active), flight: await A(page, (A) => !!A.stage.flight), camMoved: JSON.stringify(camBefore) !== JSON.stringify(await A(page, (A) => A.stage.camera.position.toArray().map(Math.round))) };
  await landed(page);
  // M-18: scrub the histogram with a finger
  await A(page, (A) => { A.setLens('literacy'); A.mobile.open('lenses'); }); await settle(page, 900);
  await page.evaluate(() => { const A = window.__livingpakistan, f = A.highlightWhere.bind(A); window.__hl = []; A.highlightWhere = (p, ...a) => { window.__hl.push(!!p); return f(p, ...a); }; });
  const h = await page.locator('.m-sheet .lg-hist').boundingBox();
  await ev('touchStart', [{ x: h.x + 10, y: h.y + 20, id: 0 }]);
  for (let k = 1; k <= 10; k++) await ev('touchMove', [{ x: h.x + 10 + (h.width - 20) * k / 10, y: h.y + 22, id: 0 }]);
  const during = await page.evaluate(() => window.__hl.filter(Boolean).length);
  await ev('touchEnd', []); await page.waitForTimeout(500);
  r.m18 = { highlightCallsWhileScrubbing: during, clearedOnLift: await page.evaluate(() => window.__hl[window.__hl.length - 1] === false), touchAction: await page.evaluate(() => getComputedStyle(document.querySelector('.m-sheet .lg-hist')).touchAction) };
  // M-19: swipe the sheet's head down
  const hd = await page.locator('.m-sheet-lenses .m-sheet-head').boundingBox();
  await drag([[hd.x + 150, hd.y + 16]], [[hd.x + 150, hd.y + 250]], 10); await page.waitForTimeout(1200);
  r.m19 = { lensesStillOpen: await A(page, (A) => A.mobile.isOpen('lenses')), handle: await page.evaluate(() => getComputedStyle(document.querySelector('.m-sheet-lenses .m-sheet-head'), '::before').content) };
  await A(page, (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); }); await settle(page, 900);
  const ih = await page.locator('.insp-hero').boundingBox();
  await drag([[ih.x + 120, ih.y + 20]], [[ih.x + 120, ih.y + 200]], 6); await page.waitForTimeout(1200);
  r.m19.inspectorStillOpen = await page.evaluate(() => !document.querySelector('.inspector').classList.contains('hidden'));
  // M-22: hover styles only where there is hover
  r.m22 = await page.evaluate(() => {
    let outside = 0, inside = 0;
    const walk = (rules, inHover) => { for (const rule of rules) {
      if (rule.media) walk(rule.cssRules, inHover || /hover:\s*hover/.test(rule.media.mediaText));
      else if (rule.selectorText && /:hover/.test(rule.selectorText)) { if (inHover) inside++; else outside++; }
    } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, false); } catch { /* cross-origin */ } }
    return { hoverRulesOutsideHoverMedia: outside, hoverRulesInside: inside, hoverNone: matchMedia('(hover: none)').matches };
  });
  // M-23: accessible names
  r.m23 = await page.evaluate(() => {
    const unnamed = [...document.querySelectorAll('#hud button')].filter((b) => !b.getAttribute('aria-label') && /^[\s✕◀▶❚⏭⏮▁❮❯⇄]*$/.test(b.textContent)).map((b) => b.className);
    const banners = [...document.querySelectorAll('.banner, .wlabel')];
    return { glyphOnlyButtonsWithoutLabel: unnamed, labelsAsButtons: banners.filter((b) => b.getAttribute('role') === 'button' && b.tabIndex === 0).length, labels: banners.length };
  });
  // M-24: towns without a census figure
  r.m24 = await page.evaluate(() => [...document.querySelectorAll('.banner')].filter((b) => /Muzaffarabad|Gilgit|Skardu|Mirpur/.test(b.textContent)).map((b) => b.textContent));
  // M-25: browser chrome
  r.m25 = await page.evaluate(() => ({ themeColor: document.querySelector('meta[name=theme-color]')?.content || null, manifest: document.querySelector('link[rel=manifest]')?.href || null, touchIcon: document.querySelector('link[rel=apple-touch-icon]')?.href || null, htmlOverscroll: getComputedStyle(document.documentElement).overscrollBehaviorY }));
  if (r.m25.manifest) r.m25.manifestOk = await page.evaluate(async (u) => { const m = await (await fetch(u)).json(); const ic = await Promise.all((m.icons || []).map(async (i) => (await fetch(new URL(i.src, u))).ok)); return { name: m.name, icons: ic }; }, r.m25.manifest);
  if (r.m25.touchIcon) r.m25.touchIconOk = await page.evaluate(async (u) => (await fetch(u)).ok, r.m25.touchIcon);
  await ctx.close();
  // M-17: reduced motion
  const c3 = await context(browser, DEVICES.i14, { reducedMotion: 'reduce' });
  const { page: p3 } = await open(c3);
  await A(p3, (A) => A.surprise.go()); await p3.waitForTimeout(200);
  r.m17 = { flight: await p3.evaluate(() => { const f = window.__livingpakistan.stage.flight; return f ? { duration: f.duration, lift: Math.round(f.lift) } : 'landed already'; }) };
  await landed(p3);
  await A(p3, (A) => { A.mobile.closeAll(); A.tours.run(0); }); await p3.waitForTimeout(600);
  r.m17.tourStartsPaused = await p3.evaluate(() => !!window.__livingpakistan.tours.paused);
  await c3.close();
  return r;
};

const browser = await launch();
for (const k of (only || Object.keys(cases).join(',')).split(',')) {
  try { log('case', k); results[k] = await cases[k](browser); save(); log(k, JSON.stringify(results[k]).slice(0, 600)); }
  catch (e) { log('case', k, 'FAILED', e.stack); results[k] = { error: e.message }; save(); }
}
await browser.close();
