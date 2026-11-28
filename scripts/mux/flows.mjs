// Interaction flows for the mobile audit. Each flow is independent:
//   node scripts/mux/flows.mjs <flow,...>
// Results go to /tmp/mux-flows/<flow>.json, screenshots to previews/mux-*.png
// (names given per flow) or /tmp/mux-flows/*.png for scratch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, context, DEVICES, open, shot, touch, annotate, clearAnn, boxOf, log } from './lib.mjs';

const TMP = '/tmp/mux-flows';
mkdirSync(TMP, { recursive: true });
const flows = {};
const A = (page, fn, arg) => page.evaluate(`(${fn.toString()})(window.__livingpakistan, ${JSON.stringify(arg ?? null)})`);
const landed = (page) => page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 });
const animsDone = (page) => page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 30000, polling: 200 }).catch(() => {});
const cam = (page) => page.evaluate(() => { const s = window.__livingpakistan.stage; return { t: s.controls.target.toArray().map((v) => +v.toFixed(1)), p: s.camera.position.toArray().map((v) => +v.toFixed(1)) }; });
const vv = (page) => page.evaluate(() => ({ scale: +visualViewport.scale.toFixed(3), ox: Math.round(visualViewport.offsetLeft), oy: Math.round(visualViewport.offsetTop), w: Math.round(visualViewport.width), h: Math.round(visualViewport.height) }));
const banner = (page, name) => page.evaluate((name) => {
  const b = [...document.querySelectorAll('.banner')].find((n) => n.querySelector('.banner-name')?.textContent === name && n.offsetParent !== null && getComputedStyle(n.parentElement || n).display !== 'none');
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
}, name);

// ---------------------------------------------------------------- gestures
flows.gestures = async (browser) => {
  // every sub-test gets a fresh context: a page zoom survives a reload
  const fresh = async () => { const ctx = await context(browser, DEVICES.i14); const { page } = await open(ctx); return { ctx, page, ...(await touch(ctx, page)) }; };
  const res = {};
  let S = await fresh();
  let { page, ev, drag } = S;
  // 1. one-finger drag on the bare map pans
  let c0 = await cam(page);
  await drag([[200, 700]], [[200, 560]]); await page.waitForTimeout(1500);
  res.dragMap = { before: c0, after: await cam(page) };
  // 2. pinch on the bare map: the map should zoom, the page should not
  await A(page, (A) => A.home(true)); await page.waitForTimeout(800);
  c0 = await cam(page);
  await drag([[180, 700], [220, 740]], [[110, 630], [290, 810]], 10); await page.waitForTimeout(1500);
  res.pinchMap = { before: c0, after: await cam(page), vv: await vv(page) };
  // 3. double tap on the map
  await A(page, (A) => { A.home(true); window.__dbl = 0; A.stage.renderer.domElement.addEventListener('dblclick', () => window.__dbl++); });
  await page.waitForTimeout(800);
  let ts = Date.now() / 1000;
  await ev('touchStart', [{ x: 230, y: 640 }], ts); await ev('touchEnd', [], ts + 0.05);
  await ev('touchStart', [{ x: 230, y: 640 }], ts + 0.15); await ev('touchEnd', [], ts + 0.2);
  await page.waitForTimeout(2500);
  res.doubleTapMap = { dblclickEvents: await page.evaluate(() => window.__dbl), vv: await vv(page), selection: await A(page, (A) => A.selection ? Object.keys(A.selection) : null), flight: await page.evaluate(() => !!window.__livingpakistan.stage.flight) };
  // 4. long press on a city banner and on the bare map
  await A(page, (A) => { A.select(null); A.home(true); }); await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__ctx = 0; document.addEventListener('contextmenu', () => window.__ctx++, true); });
  const b3 = await banner(page, 'Lahore') || await banner(page, 'Multan');
  await ev('touchStart', [{ x: b3.x + b3.w * 0.7, y: b3.y + b3.h / 2 }]); await page.waitForTimeout(1200); await ev('touchEnd', []);
  await page.waitForTimeout(800);
  res.longPressBanner = { contextmenu: await page.evaluate(() => window.__ctx), selection: await page.evaluate(() => String(getSelection())), userSelect: await page.evaluate(() => getComputedStyle(document.querySelector('.banner-name')).userSelect), callout: await page.evaluate(() => getComputedStyle(document.querySelector('.banner')).webkitTouchCallout ?? 'n/a') };
  await page.evaluate(() => getSelection().removeAllRanges());
  await ev('touchStart', [{ x: 120, y: 450 }]); await page.waitForTimeout(1200); await ev('touchEnd', []);
  await page.waitForTimeout(600);
  res.longPressMap = { contextmenu: await page.evaluate(() => window.__ctx) - res.longPressBanner.contextmenu, selection: await page.evaluate(() => String(getSelection())) };
  // 5. drag inside a scrolling sheet; swipe down on its header
  await A(page, (A) => A.mobile.open('lenses')); await page.waitForTimeout(1500); await animsDone(page);
  const sb = await page.locator('.m-sheet-lenses .m-sheet-body').boundingBox();
  c0 = await cam(page);
  await drag([[sb.x + 150, sb.y + sb.height - 30]], [[sb.x + 150, sb.y + 30]], 10); await page.waitForTimeout(1200);
  res.sheetScroll = { scrollAfter: await page.evaluate(() => document.querySelector('.m-sheet-lenses .m-sheet-body').scrollTop), camMoved: JSON.stringify(c0) !== JSON.stringify(await cam(page)), vv: await vv(page) };
  const hd = await page.locator('.m-sheet-lenses .m-sheet-head').boundingBox();
  await drag([[hd.x + 150, hd.y + 20]], [[hd.x + 150, hd.y + 260]], 10); await page.waitForTimeout(1200);
  res.swipeDownHeader = { stillOpen: await A(page, (A) => A.mobile.isOpen('lenses')), vv: await vv(page) };
  // 6. double tap on sheet text (not a button)
  await A(page, (A) => { A.mobile.open('more'); }); await page.waitForTimeout(1500); await animsDone(page);
  const g = await page.locator('.m-sub').boundingBox();
  ts = Date.now() / 1000;
  await ev('touchStart', [{ x: g.x + 20, y: g.y + 5 }], ts); await ev('touchEnd', [], ts + 0.05);
  await ev('touchStart', [{ x: g.x + 20, y: g.y + 5 }], ts + 0.15); await ev('touchEnd', [], ts + 0.2);
  await page.waitForTimeout(1500);
  res.doubleTapSheetText = { vv: await vv(page) };
  await S.ctx.close();
  // 7. two-finger pinch that starts on a city banner
  S = await fresh(); ({ page, drag } = S);
  const b2 = await banner(page, 'Karachi');
  const cx = b2.x + b2.w / 2, cy = b2.y + b2.h / 2;
  c0 = await cam(page);
  await drag([[cx - 20, cy], [cx + 20, cy]], [[cx - 120, cy - 60], [cx + 120, cy + 60]], 10); await page.waitForTimeout(1500);
  res.pinchFromBanner = { before: c0, after: await cam(page), vv: await vv(page) };
  if (res.pinchFromBanner.vv.scale > 1) await shot(page, '/tmp/mux-flows/raw-pinch-banner.png');
  await S.ctx.close();
  // 8. two-finger pinch on the dock (any HUD chrome)
  S = await fresh(); ({ page, drag } = S);
  const dock = await page.locator('.m-dock').boundingBox();
  const dy = dock.y + dock.height / 2;
  await drag([[170, dy], [220, dy]], [[60, dy - 200], [330, dy - 120]], 10); await page.waitForTimeout(1500);
  res.pinchOnDock = { vv: await vv(page) };
  await shot(page, '/tmp/mux-flows/raw-pinch-dock.png');
  // does the zoom survive a reload?
  await page.reload(); await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 150000 }); await page.waitForTimeout(1500);
  res.pinchOnDock.afterReload = await vv(page);
  await S.ctx.close();
  writeFileSync(join(TMP, 'gestures.json'), JSON.stringify(res, null, 1));
  log('gestures', JSON.stringify(res));
};

// ---------------------------------------------------------------- browser back
flows.back = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const page0 = await ctx.newPage();
  await page0.goto('data:text/html,<title>previous site</title><h1>previous site</h1>');
  const url = new URL((await import('./lib.mjs')).BASE); url.searchParams.set('guide', '0');
  await page0.goto(url.href, { waitUntil: 'load' });
  await page0.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 240000 }); await page0.waitForTimeout(2000);
  const res = { historyLength: await page0.evaluate(() => history.length) };
  await A(page0, (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); A.flyToSite(k); });
  await page0.waitForTimeout(3000);
  await A(page0, (A) => A.mobile.open('lenses')); await page0.waitForTimeout(800);
  res.afterOpening = { url: page0.url(), historyLength: await page0.evaluate(() => history.length) };
  await page0.goBack({ timeout: 30000 }).catch((e) => { res.err = e.message; });
  await page0.waitForTimeout(1500);
  res.afterBack = { url: page0.url(), title: await page0.title() };
  writeFileSync(join(TMP, 'back.json'), JSON.stringify(res, null, 1));
  log('back', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- inputs: iOS focus zoom + keyboard
flows.inputs = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const res = {};
  const inputs = async () => page.evaluate(() => [...document.querySelectorAll('#hud input, #hud select, #hud textarea')].filter((n) => n.offsetParent || getComputedStyle(n).position === 'fixed')
    .map((n) => ({ el: `${n.tagName.toLowerCase()}[type=${n.type}].${n.className}`, placeholder: n.placeholder || '', fs: parseFloat(getComputedStyle(n).fontSize), w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height) })));
  for (const [k, fn] of Object.entries({ search: (A) => A.search.open(), duel: (A) => A.duel.open(), almanac: (A) => A.ui.almanac.open(), explore: (A) => A.explorer.open(), light: (A) => A.mobile.open('light'), lenses: (A) => A.mobile.open('lenses') })) {
    await A(page, (A) => A.mobile.closeAll()); await A(page, fn); await page.waitForTimeout(1200);
    res[k] = await inputs();
  }
  // keyboard: iOS keeps the layout viewport and lays the keyboard over the
  // bottom ~336px (iPhone 14, with the suggestions bar). Draw it, with the
  // duel's first input focused, to see what it hides.
  await A(page, (A) => { A.mobile.closeAll(); A.duel.open(); }); await page.waitForTimeout(1500); await animsDone(page);
  await page.locator('.duel-slot input').first().focus();
  await page.keyboard.type('Kar'); await page.waitForTimeout(800);
  const kbTop = 844 - 336;
  const boxes = [await boxOf(page, '.duel-slot input', 'focused input', '#ff9f0a'), await boxOf(page, '.duel-ac', 'autocomplete list', '#ff2d55')].filter(Boolean);
  res.duelKeyboard = { kbTop, boxes };
  await annotate(page, [...boxes, { x: 0, y: kbTop, w: 390, h: 336, label: 'simulated iOS keyboard (336px)', color: '#5856d6' }]);
  await page.evaluate((kbTop) => { const d = document.createElement('div'); d.id = 'mux-kb'; d.style.cssText = `position:fixed;left:0;right:0;top:${kbTop}px;bottom:0;background:rgba(60,60,70,.92);z-index:99998;color:#fff;font:600 15px system-ui;display:grid;place-items:center`; d.textContent = 'keyboard'; document.body.append(d); }, kbTop);
  await shot(page, 'mux-12-duel-input-under-keyboard.png');
  await page.evaluate(() => document.getElementById('mux-kb')?.remove()); await clearAnn(page);
  // search with keyboard
  await A(page, (A) => { A.mobile.closeAll(); A.search.open(); }); await page.waitForTimeout(1200);
  await page.keyboard.type('a'); await page.waitForTimeout(800);
  res.searchRows = await page.evaluate((kbTop) => { const rows = [...document.querySelectorAll('.srch-row')]; return { total: rows.length, aboveKeyboard: rows.filter((r) => r.getBoundingClientRect().bottom <= kbTop).length, listBottom: Math.round(document.querySelector('.srch').getBoundingClientRect().bottom) }; }, kbTop);
  writeFileSync(join(TMP, 'inputs.json'), JSON.stringify(res, null, 1));
  log('inputs', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- explorer scatter plot scroll trap
flows.explorer = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { drag } = await touch(ctx, page);
  await A(page, (A) => A.explorer.open()); await page.waitForTimeout(1500); await animsDone(page);
  const res = {};
  const body = '.exp .pc-body';
  // scroll so the plot is in view
  await page.evaluate((b) => { const n = document.querySelector(b); n.scrollTop = 0; }, body);
  const svg = await page.locator('.exp-svg').boundingBox();
  const bodyBox = await page.locator(body).boundingBox();
  res.svg = svg; res.body = bodyBox;
  res.scrollHeight = await page.evaluate((b) => { const n = document.querySelector(b); return [n.scrollHeight, n.clientHeight]; }, body);
  // drag on the table: does it scroll the panel/table?
  const tb = await page.locator('.exp-table').boundingBox();
  const s0 = await page.evaluate((b) => [document.querySelector(b).scrollTop, document.querySelector('.exp-table').scrollTop], body);
  await drag([[tb.x + 100, tb.y + tb.height - 20]], [[tb.x + 100, tb.y + 20]], 10); await page.waitForTimeout(1000);
  res.dragTable = { before: s0, after: await page.evaluate((b) => [document.querySelector(b).scrollTop, document.querySelector('.exp-table').scrollTop], body) };
  await page.evaluate((b) => { document.querySelector(b).scrollTop = 0; }, body);
  // bring the plot into the visible part of the panel
  await page.evaluate(() => document.querySelector('.exp-svg').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  const svg2 = await page.locator('.exp-svg').boundingBox();
  const s1 = await page.evaluate((b) => document.querySelector(b).scrollTop, body);
  await drag([[svg2.x + svg2.width / 2, svg2.y + svg2.height - 30]], [[svg2.x + svg2.width / 2, svg2.y + 10]], 10); await page.waitForTimeout(1000);
  res.dragPlot = { before: s1, after: await page.evaluate((b) => document.querySelector(b).scrollTop, body), touchAction: await page.evaluate(() => getComputedStyle(document.querySelector('.exp-svg')).touchAction) };
  await annotate(page, [{ x: svg2.x, y: svg2.y, w: svg2.width, h: svg2.height, label: 'touch-action:none — vertical swipe here cannot scroll the panel', color: '#ff2d55' }]);
  await shot(page, 'mux-13-explorer-plot-scroll-trap.png');
  writeFileSync(join(TMP, 'explorer.json'), JSON.stringify(res, null, 1));
  log('explorer', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- safe areas (notch, home indicator)
flows.safearea = async (browser) => {
  const res = {};
  for (const [key, inset] of [['i14', { top: 47, bottom: 34, left: 0, right: 0 }], ['land', { top: 0, bottom: 21, left: 47, right: 47 }]]) {
    const dev = DEVICES[key];
    const ctx = await context(browser, dev);
    const { page } = await open(ctx);
    const cdp = await ctx.newCDPSession(page);
    let how = 'cdp';
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: inset.top, topMax: inset.top, bottom: inset.bottom, bottomMax: inset.bottom, left: inset.left, leftMax: inset.left, right: inset.right, rightMax: inset.right } });
    } catch (e) { how = 'css-vars'; }
    const probe = await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0'; document.body.append(d); const y = d.getBoundingClientRect().top; d.remove(); return y; });
    if (!probe) {
      how = 'css-vars';
      // fallback: set the mobile layout's own inset variables, as env() would
      await page.addStyleTag({ content: `body.mobile{--m-l:${inset.left + 8}px;--m-r:${inset.right + 8}px;--m-top:${inset.top + 8}px;--m-dock-b:${inset.bottom + 8}px}` });
    }
    await A(page, (A) => A.home(true)); await page.waitForTimeout(1500);
    // draw the unsafe zones
    const zones = [];
    if (inset.top) zones.push({ x: 0, y: 0, w: dev.width, h: inset.top, label: 'status bar / Dynamic Island', color: '#5856d6' });
    if (inset.bottom) zones.push({ x: 0, y: dev.height - inset.bottom, w: dev.width, h: inset.bottom, label: 'home indicator', color: '#5856d6' });
    if (inset.left) zones.push({ x: 0, y: 0, w: inset.left, h: dev.height, label: 'notch', color: '#5856d6' });
    if (inset.right) zones.push({ x: dev.width - inset.right, y: 0, w: inset.right, h: dev.height, label: '', color: '#5856d6' });
    // which HUD things sit inside them?
    const hits = async () => page.evaluate((z) => [...document.querySelectorAll('#hud *')].filter((n) => { const r = n.getBoundingClientRect(); if (!r.width || getComputedStyle(n).visibility === 'hidden' || n.closest('.hidden')) return false; return z.some((q) => r.left < q.x + q.w && r.right > q.x && r.top < q.y + q.h && r.bottom > q.y); }).filter((n) => n.matches('button, input, [role=button], .toast, .narr, .gd-card')).map((n) => n.className + ' ' + (n.getAttribute('aria-label') || n.textContent.trim().slice(0, 20))), zones);
    res[key] = { how, probe, home: await hits() };
    await annotate(page, zones);
    await shot(page, `/tmp/mux-flows/safe-${key}-home.png`);
    await clearAnn(page);
    // walkthrough card, toast and tour in the unsafe zones
    await A(page, (A) => A.toast('Indus Waters Treaty (1960): western rivers → Pakistan')); await page.waitForTimeout(300);
    res[key].toast = await hits();
    await A(page, (A) => { A.tours.playAll(); }); await page.waitForTimeout(3000); await A(page, (A) => { A.tours.paused = true; });
    res[key].cinema = await hits();
    await annotate(page, zones);
    await shot(page, `/tmp/mux-flows/safe-${key}-cinema.png`);
    await clearAnn(page);
    await A(page, (A) => A.tours.stop(false)); await page.waitForTimeout(500);
    await A(page, (A) => A.guide.start()); await page.waitForTimeout(2500);
    res[key].walk = await hits();
    await annotate(page, zones);
    await shot(page, `/tmp/mux-flows/safe-${key}-walk.png`);
    await ctx.close();
  }
  writeFileSync(join(TMP, 'safearea.json'), JSON.stringify(res, null, 1));
  log('safearea', JSON.stringify(res));
};

// ---------------------------------------------------------------- short viewport (Safari bars, 100vh)
flows.short = async (browser) => {
  // iPhone SE in Safari with both bars showing leaves ~553px of the 667px screen
  const dev = { ...DEVICES.se, height: 553 };
  const ctx = await context(browser, dev);
  const { page } = await open(ctx);
  const res = {};
  for (const [k, fn] of Object.entries({ lenses: (A) => A.mobile.open('lenses'), guide: (A) => A.guide.openWelcome(), inspCity: (A) => { const k = A.sites.sites.find((s) => s.name === 'Karachi' && s.kind === 'city'); A.select({ site: k }); }, tourOpen: (A) => { A.tours.run(0); A.tours.chip.open('pinned'); }, eras: (A) => { A.eras.show(); A.eras.setEra(1); } })) {
    await A(page, (A) => { A.tours.stop(false); A.mobile.closeAll(); A.select(null); A.eras.hide(); });
    await A(page, fn); await page.waitForTimeout(k.startsWith('tour') ? 3000 : 1500); await animsDone(page);
    if (k.startsWith('tour')) await A(page, (A) => { A.tours.paused = true; });
    res[k] = await page.evaluate(() => {
      const r = (s) => { const n = document.querySelector(s); if (!n || n.classList.contains('hidden')) return null; const b = n.getBoundingClientRect(); return b.width ? [Math.round(b.top), Math.round(b.bottom), Math.round(b.height)] : null; };
      return { sheet: r('.m-sheet:not(.hidden)'), insp: r('.inspector'), guide: r('.guide-welcome'), narr: r('.narr'), timebar: r('.timebar:not(.hidden)'), dockTop: Math.round(document.querySelector('.m-dock').getBoundingClientRect().top), mapStripPx: null };
    });
    await shot(page, `/tmp/mux-flows/short-${k}.png`);
  }
  writeFileSync(join(TMP, 'short.json'), JSON.stringify(res, null, 1));
  log('short', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- load under CPU throttling
flows.load = async (browser) => {
  const ctx = await context(browser, DEVICES.android);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  // "Fast 4G"-ish: 9 Mbps down, 1.5 up, 60 ms RTT
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  const url = new URL((await import('./lib.mjs')).BASE); url.searchParams.set('guide', '0');
  const t0 = Date.now(); const marks = [];
  page.on('console', () => {});
  await page.goto(url.href, { waitUntil: 'commit' });
  let shotN = 0; const subs = [];
  while (Date.now() - t0 < 180000) {
    const s = await page.evaluate(() => ({ sub: document.getElementById('loader-sub')?.textContent, gone: document.getElementById('loader')?.classList.contains('gone'), ready: window.__livingpakistan_ready === true })).catch(() => null);
    if (s) { if (subs.at(-1)?.sub !== s.sub) subs.push({ t: Date.now() - t0, sub: s.sub }); if (s.gone && !marks.find((m) => m.k === 'loaderGone')) marks.push({ k: 'loaderGone', t: Date.now() - t0 }); if (s.ready) { marks.push({ k: 'ready', t: Date.now() - t0 }); break; } }
    if (shotN === 0 && Date.now() - t0 > 1500) { await shot(page, '/tmp/mux-flows/load-1500ms.png'); shotN++; }
    await page.waitForTimeout(250);
  }
  // first tap that works
  const tA = Date.now();
  await page.waitForTimeout(500);
  const ok = await A(page, (A) => { A.mobile.open('lenses'); return A.mobile.isOpen('lenses'); });
  marks.push({ k: 'sheetOpens', t: Date.now() - t0, ok });
  const res = { marks, subs, note: 'SwiftShader software GL + 4x CPU throttle + ~9 Mbps/60 ms network; absolute times are pessimistic vs a real phone GPU' };
  writeFileSync(join(TMP, 'load.json'), JSON.stringify(res, null, 1));
  log('load', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- rotation mid-flow
flows.rotate = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const res = {};
  // inspector open, then rotate
  await A(page, (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); A.flyToSite(k, { distance: 420 }); });
  await page.waitForTimeout(1500); await landed(page);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(2500); await animsDone(page);
  res.inspLandscape = await page.evaluate(() => { const b = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && [r.left, r.top, r.right, r.bottom].map(Math.round); }; return { insp: b('.inspector'), dock: b('.m-dock'), top: b('.m-top'), mobile: document.body.classList.contains('mobile') }; });
  await shot(page, '/tmp/mux-flows/rot-insp-land.png');
  // tour pinned, rotate back to portrait and to landscape
  await A(page, (A) => { A.select(null); A.tours.run(1); }); await page.waitForTimeout(3000);
  await A(page, (A) => { A.tours.paused = true; A.tours.chip.open('pinned'); }); await page.waitForTimeout(1200); await animsDone(page);
  res.tourLandscape = await page.evaluate(() => { const b = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && [r.left, r.top, r.right, r.bottom].map(Math.round); }; return { narr: b('.narr'), chip: b('.tc-chip'), body: document.body.className }; });
  await shot(page, '/tmp/mux-flows/rot-tour-land.png');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(2500); await animsDone(page);
  res.tourPortrait = await page.evaluate(() => ({ body: document.body.className }));
  await shot(page, '/tmp/mux-flows/rot-tour-portrait.png');
  // home view in landscape, then rotate: does home re-fit?
  await A(page, (A) => { A.tours.stop(false); A.home(true); }); await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(2500);
  await shot(page, '/tmp/mux-flows/rot-home-land.png');
  writeFileSync(join(TMP, 'rotate.json'), JSON.stringify(res, null, 1));
  log('rotate', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- labels vs edges and HUD, through a tour
flows.labels = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const res = { stops: [] };
  const measure = () => page.evaluate(() => {
    const hud = ['.m-top .m-brand', '.m-top-right', '.m-dock', '.tc-chip:not(.hidden) .tc-hold', '.m-peek:not(.hidden)', '.cinema-exit', '.inspector:not(.hidden)', '.m-sheet:not(.hidden)', '.timebar:not(.hidden)']
      .flatMap((s) => [...document.querySelectorAll(s)]).filter((n) => { const cs = getComputedStyle(n); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; }).map((n) => ({ n: n.className.split(' ')[0], r: n.getBoundingClientRect() }));
    const out = [];
    for (const l of document.querySelectorAll('.banner, .wlabel')) {
      const o = l.closest('.labels-layer > div') || l;
      if (getComputedStyle(o).display === 'none' || l.offsetParent === null) continue;
      const r = l.getBoundingClientRect(); if (!r.width) continue;
      const clipped = r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight;
      const under = hud.filter((h) => r.left < h.r.right && r.right > h.r.left && r.top < h.r.bottom && r.bottom > h.r.top).map((h) => h.n);
      if (clipped || under.length) out.push({ text: l.textContent.trim(), box: [r.left, r.top, r.width, r.height].map(Math.round), clipped, under });
    }
    return out;
  });
  res.home = await measure();
  await A(page, (A) => A.tours.run(0)); 
  const n = await page.evaluate(() => window.__livingpakistan.tours.active.tour.steps.length);
  for (let i = 0; i < n; i++) {
    await A(page, (A, i) => { const t = A.tours; t.paused = true; t.show(i); }, i);
    await page.waitForTimeout(1200); await landed(page); await page.waitForTimeout(900);
    const bad = await measure();
    res.stops.push({ i, title: await page.evaluate(() => document.querySelector('.narr h3')?.textContent), bad });
    if (bad.some((b) => b.clipped) && !res.shotClip) {
      res.shotClip = i;
      await annotate(page, bad.map((b) => ({ x: b.box[0], y: b.box[1], w: b.box[2], h: b.box[3], label: b.clipped ? 'clipped at edge' : 'under ' + b.under.join('+'), color: b.clipped ? '#ff2d55' : '#ff9f0a' })));
      await shot(page, 'mux-08-labels-clipped-at-edge.png');
      await clearAnn(page);
    } else if (bad.some((b) => !b.clipped && b.under.length) && !res.shotUnder) {
      res.shotUnder = i;
      await annotate(page, bad.map((b) => ({ x: b.box[0], y: b.box[1], w: b.box[2], h: b.box[3], label: b.clipped ? 'clipped at edge' : 'under ' + b.under.join('+'), color: b.clipped ? '#ff2d55' : '#ff9f0a' })));
      await shot(page, '/tmp/mux-flows/labels-under-hud.png');
      await clearAnn(page);
    }
  }
  writeFileSync(join(TMP, 'labels.json'), JSON.stringify(res, null, 1));
  log('labels', JSON.stringify({ home: res.home.length, stops: res.stops.map((s) => s.bad.length) }));
  await ctx.close();
};


// ---------------------------------------------------------------- touch-only hover features
flows.hover = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tap, drag } = await touch(ctx, page);
  const res = {};
  // legend histogram: brushing is mousemove/mouseleave only
  await A(page, (A) => { A.setLens('literacy'); A.mobile.open('lenses'); }); await page.waitForTimeout(1500); await animsDone(page);
  const h = await page.locator('.m-sheet .lg-hist').boundingBox();
  await tap(h.x + h.width * 0.8, h.y + h.height / 2, 1200);
  res.histTap = await A(page, (A) => ({ highlighted: A.board._highlight?.length ?? A.board.highlightCount ?? null, sheetOpen: A.mobile.isOpen('lenses') }));
  // compare the map highlight via a pixel-free proxy: board.setHighlight was called?
  await page.evaluate(() => { const B = window.__livingpakistan.board; window.__hl = []; const o = B.setHighlight.bind(B); B.setHighlight = (s) => { window.__hl.push(s ? s.length : null); return o(s); }; });
  await tap(h.x + h.width * 0.3, h.y + h.height / 2, 1200);
  await drag([[h.x + 20, h.y + h.height / 2]], [[h.x + h.width - 20, h.y + h.height / 2]], 8); await page.waitForTimeout(800);
  res.histCalls = await page.evaluate(() => window.__hl);
  await A(page, (A) => A.mobile.closeAll()); await page.waitForTimeout(800);
  res.highlightAfterClose = await page.evaluate(() => window.__hl);
  await shot(page, '/tmp/mux-flows/hover-hist-after.png');
  // explorer row tap: tooltip that never goes away?
  await A(page, (A) => { A.setLens('elevation'); A.explorer.open(); }); await page.waitForTimeout(1500); await animsDone(page);
  const row = await page.locator('.exp-table tbody tr').nth(2).boundingBox();
  await tap(row.x + 60, row.y + row.height / 2, 2000);
  res.rowTap = await page.evaluate(() => ({ tipVisible: !!document.querySelector('.pc-tip:not(.hidden)'), expOpen: !document.querySelector('.exp').classList.contains('hidden'), expMin: document.querySelector('.exp').classList.contains('min'), insp: !document.querySelector('.inspector').classList.contains('hidden') }));
  await shot(page, '/tmp/mux-flows/hover-exp-rowtap.png');
  writeFileSync(join(TMP, 'hover.json'), JSON.stringify(res, null, 1));
  log('hover', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- tour badge + inspector + sheets (z-order)
flows.tourz = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tap, tapSel } = await touch(ctx, page);
  const res = {};
  await A(page, (A) => A.tours.run(0)); await page.waitForTimeout(2500); await landed(page);
  await A(page, (A) => { A.tours.paused = true; });
  // tap a hex during the tour
  await tap(200, 620, 2000);
  res.tapHexDuringTour = await page.evaluate(() => { const i = document.querySelector('.inspector'); const cs = getComputedStyle(i); return { inspHidden: i.classList.contains('hidden'), opacity: cs.opacity, pe: cs.pointerEvents, z: cs.zIndex, sel: !!window.__livingpakistan.selection, touring: document.body.classList.contains('touring') }; });
  await shot(page, '/tmp/mux-flows/tourz-hex.png');
  // pin the card open over it
  await tapSel('.tc-hold', 1500); await animsDone(page);
  res.pinned = await page.evaluate(() => document.body.className);
  await shot(page, '/tmp/mux-flows/raw-tourcard-ghost.png');
  // open the Tours dock? dock is hidden during tour. Open search from... top-right hidden too. Try the brand.
  res.chrome = await page.evaluate(() => ['.m-dock', '.m-top-right', '.m-brand', '.tc-chip'].map((s) => [s, getComputedStyle(document.querySelector(s)).display]));
  // tap the brand during a tour (fly home?) 
  await tapSel('.m-brand', 2500);
  res.afterBrand = await page.evaluate(() => ({ touring: document.body.classList.contains('touring'), flight: !!window.__livingpakistan.stage.flight, tour: !!window.__livingpakistan.tours.active }));
  // cinema
  await A(page, (A) => { A.tours.stop(false); A.select(null); A.tours.playAll(); }); await page.waitForTimeout(3000); await A(page, (A) => { A.tours.paused = true; });
  await animsDone(page);
  res.cinema = await page.evaluate(() => { const b = (s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), getComputedStyle(n).display]; }; return { exit: b('.cinema-exit'), chip: b('.tc-hold'), next: b('.tc-next'), pause: b('.tc-pause'), brand: b('.m-top') }; });
  await shot(page, '/tmp/mux-flows/raw-cinema.png');
  writeFileSync(join(TMP, 'tourz.json'), JSON.stringify(res, null, 1));
  log('tourz', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- walkthrough on a phone
flows.walk = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const res = [];
  await A(page, (A) => A.guide.start());
  const n = await page.evaluate(() => window.__livingpakistan.guide.steps.length);
  for (let i = 0; i < n; i++) {
    await A(page, (A, i) => A.guide.go(i), i);
    await page.waitForTimeout(2500); await landed(page).catch(() => {}); await page.waitForTimeout(1500); await animsDone(page);
    const r = await page.evaluate(() => {
      const g = window.__livingpakistan.guide; const sp = document.querySelector('.gd-spot'); const card = document.querySelector('.gd-card').getBoundingClientRect();
      const s = sp.classList.contains('hidden') ? null : sp.getBoundingClientRect();
      const overlap = s && card ? Math.max(0, Math.min(card.bottom, s.bottom) - Math.max(card.top, s.top)) * Math.max(0, Math.min(card.right, s.right) - Math.max(card.left, s.left)) : 0;
      return { title: g.current.title, spot: s && [s.left, s.top, s.width, s.height].map(Math.round), card: [card.left, card.top, card.width, card.height].map(Math.round), overlap: Math.round(overlap), body: g.current.body.slice(0, 80), openSheet: [...document.querySelectorAll('.m-sheet:not(.hidden), .pc-panel:not(.hidden), .tour-menu:not(.hidden), .srch:not(.hidden), .surp:not(.hidden), .inspector:not(.hidden), .timebar:not(.hidden)')].map((n) => n.className.split(' ').slice(0, 2).join('.')) };
    });
    res.push({ i, ...r });
    if ([1, 4, 7, 13, 18].includes(i)) await shot(page, `/tmp/mux-flows/walk-${String(i).padStart(2, '0')}.png`);
  }
  writeFileSync(join(TMP, 'walk.json'), JSON.stringify(res, null, 1));
  log('walk', JSON.stringify(res.map((r) => [r.i, !!r.spot, r.overlap])));
  await ctx.close();
};

// ---------------------------------------------------------------- deep links
flows.deeplink = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const res = {};
  for (const [k, hash] of [['site', '#site=' ], ['lens', '#lens=literacy&mood=night']]) {
    let h = hash;
    if (k === 'site') {
      const { page } = await open(ctx);
      h += await page.evaluate(() => window.__livingpakistan.sites.sites.find((s) => s.name === 'Badshahi Mosque').id);
      await page.close();
    }
    const { page } = await open(ctx, { hash: h });
    await page.waitForTimeout(2500); await landed(page); await animsDone(page);
    res[k] = await page.evaluate(() => ({ hash: location.hash, insp: !document.querySelector('.inspector').classList.contains('hidden'), peek: !document.querySelector('.m-peek').classList.contains('hidden') }));
    await shot(page, `/tmp/mux-flows/deeplink-${k}.png`);
    await page.close();
  }
  writeFileSync(join(TMP, 'deeplink.json'), JSON.stringify(res, null, 1));
  log('deeplink', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- tablet 820 (desktop layout under touch)
flows.tablet = async (browser) => {
  const ctx = await context(browser, DEVICES.tab820);
  const { page } = await open(ctx);
  const { tap } = await touch(ctx, page);
  const res = {};
  res.layout = await page.evaluate(() => ({ mobile: document.body.classList.contains('mobile'), coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches }));
  // tap a hex: does a hover tooltip appear with the inspector?
  await tap(430, 700, 2500);
  res.tapHex = await page.evaluate(() => ({ tip: !document.querySelector('.tip').classList.contains('hidden'), insp: !document.querySelector('.inspector').classList.contains('hidden') }));
  await shot(page, '/tmp/mux-flows/tab820-taphex.png');
  writeFileSync(join(TMP, 'tablet.json'), JSON.stringify(res, null, 1));
  log('tablet', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- reduced motion + WebGL context loss
flows.motion = async (browser) => {
  const ctx = await context(browser, DEVICES.i14, { reducedMotion: 'reduce' });
  const { page } = await open(ctx);
  const res = {};
  res.mq = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await A(page, (A) => A.surprise.go()); await page.waitForTimeout(300);
  res.flightOnSurprise = await page.evaluate(() => { const f = window.__livingpakistan.stage.flight; return f ? { duration: f.duration, lift: Math.round(f.lift) } : null; });
  await landed(page);
  await A(page, (A) => { A.mobile.closeAll(); A.tours.run(0); }); await page.waitForTimeout(500);
  res.tourAutoAdvances = await page.evaluate(() => !!window.__livingpakistan.tours.active && !window.__livingpakistan.tours.paused);
  await A(page, (A) => A.tours.stop(false));
  // simulate iOS dropping the WebGL context (backgrounded tab / memory pressure)
  await landed(page);
  res.ctx = await page.evaluate(async () => {
    const gl = window.__livingpakistan.stage.renderer.getContext(); const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no WEBGL_lose_context';
    ext.loseContext(); await new Promise((r) => setTimeout(r, 1500));
    ext.restoreContext(); await new Promise((r) => setTimeout(r, 4000));
    return { lost: gl.isContextLost() };
  });
  await page.waitForTimeout(2000);
  await shot(page, '/tmp/mux-flows/ctx-restored.png');
  writeFileSync(join(TMP, 'motion.json'), JSON.stringify(res, null, 1));
  log('motion', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- ghost inspector during a tour, cinema badge overlap
flows.ghost = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const { tap } = await touch(ctx, page);
  const res = {};
  await A(page, (A) => A.tours.run(0)); await page.waitForTimeout(2500); await landed(page);
  await A(page, (A) => { A.tours.paused = true; });
  await tap(200, 620, 2000); await animsDone(page);
  res.insp = await page.evaluate(() => {
    const i = document.querySelector('.inspector'), cs = getComputedStyle(i), r = i.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
    return { hidden: i.classList.contains('hidden'), opacity: cs.opacity, pointerEvents: cs.pointerEvents, box: [r.left, r.top, r.width, r.height].map(Math.round), hitAtCentre: hit?.className || hit?.tagName, sel: !!window.__livingpakistan.selection, bodyClass: document.body.className };
  });
  // does a tap on the ghost's close button do anything / does a tap there select a new hex?
  const b = res.insp.box;
  await tap(b[0] + b[2] / 2, b[1] + b[3] / 2, 1500);
  res.afterTapOnGhost = await page.evaluate(() => ({ hidden: document.querySelector('.inspector').classList.contains('hidden'), title: document.querySelector('.insp-title')?.textContent }));
  await page.evaluate((b) => {}, b);
  await shot(page, '/tmp/mux-flows/ghost.png');
  // cinema: badge vs exit
  await A(page, (A) => { A.tours.stop(false); A.select(null); A.tours.playAll(); }); await page.waitForTimeout(3000); await A(page, (A) => { A.tours.paused = true; }); await animsDone(page);
  res.cinema = await page.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; const e = r('.cinema-exit'), c = r('.tc-hold'); const top = document.elementFromPoint(c.x + c.w / 2, c.y + c.h / 2); return { exit: e, chip: r('.tc-chip'), hold: c, next: r('.tc-next'), pause: r('.tc-pause'), topAtBadgeCentre: top?.className, chipTopCss: getComputedStyle(document.querySelector('.tc-chip')).top }; });
  writeFileSync(join(TMP, 'ghost.json'), JSON.stringify(res, null, 1));
  log('ghost', JSON.stringify(res));
  await ctx.close();
};

// ---------------------------------------------------------------- does the thing you selected end up under the sheet?
flows.covered = async (browser) => {
  const ctx = await context(browser, DEVICES.i14);
  const { page } = await open(ctx);
  const res = [];
  const cases = {
    'search: Badshahi Mosque': (A) => { const s = A.sites.sites.find((x) => x.name === 'Badshahi Mosque'); A.select({ site: s }); A.flyToSite(s); return { site: s.id }; },
    'tap city: Karachi': (A) => { const s = A.sites.sites.find((x) => x.name === 'Karachi' && x.kind === 'city'); A.select({ site: s }); A.flyToSite(s, { distance: 420 }); return { site: s.id }; },
    'district: Quetta': (A) => { const i = A.districts.findIndex((d) => d.name === 'Quetta'); A.select({ district: i }); A.flyToDistrict(i); return { district: i }; },
    'surprise': (A) => { A.surprise.go(); return null; },
  };
  for (const [name, fn] of Object.entries(cases)) {
    await A(page, (A) => { A.mobile.closeAll(); A.select(null); A.home(true); });
    await page.waitForTimeout(600);
    await A(page, fn); await page.waitForTimeout(1500); await landed(page); await animsDone(page);
    const r = await page.evaluate(() => {
      const A = window.__livingpakistan, cam = A.stage.camera, t = A.stage.controls.target.clone().project(cam);
      const x = (t.x + 1) / 2 * innerWidth, y = (1 - t.y) / 2 * innerHeight;
      const sheet = [...document.querySelectorAll('.inspector, .surp, .m-sheet')].find((n) => !n.classList.contains('hidden'));
      const b = sheet?.getBoundingClientRect();
      return { target: [Math.round(x), Math.round(y)], sheet: sheet && { cls: sheet.className.split(' ')[0], top: Math.round(b.top), bottom: Math.round(b.bottom) }, underSheet: !!(b && y >= b.top && y <= b.bottom && x >= b.left && x <= b.right) };
    });
    res.push({ name, ...r });
    if (name.startsWith('search')) {
      await annotate(page, [{ x: r.target[0] - 14, y: r.target[1] - 14, w: 28, h: 28, label: 'flown-to target (Badshahi Mosque)', color: '#ff2d55' }]);
      await shot(page, 'mux-10-flyto-target-under-sheet.png');
      await clearAnn(page);
    }
  }
  writeFileSync(join(TMP, 'covered.json'), JSON.stringify(res, null, 1));
  log('covered', JSON.stringify(res));
  await ctx.close();
};

const browser = await launch();
for (const f of (process.argv[2] || Object.keys(flows).join(',')).split(',')) {
  try { log('flow', f); await flows[f](browser); } catch (e) { log('flow', f, 'FAILED', e.stack); }
}
await browser.close();
