import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(`[${m.type()}] ${m.text()}`); });
p.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
p.on('requestfailed', (r) => errs.push(`[requestfailed] ${r.url()}`));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 120000 });
const steps = [
  "const a=window.__livingpakistan; for (const l of a.atlas.lenses) a.setLens(l.id); a.setLens('terrain');",
  "const a=window.__livingpakistan; for (const m of ['golden','night','day']) a.setMood(m);",
  "const a=window.__livingpakistan; for (const b of document.querySelectorAll('[data-layer]')) { b.click(); b.click(); }",
  "const a=window.__livingpakistan; a.setRelief(20); a.setRelief(12);",
  "const a=window.__livingpakistan; a.select({district: 10}); a.select({cell: a.districts[20].cells[0]}); a.select({site: a.sites.sites.find(s=>s.kind==='city')}); a.select({site: a.sites.sites.find(s=>s.kind==='power')}); a.select(null);",
  "const a=window.__livingpakistan; a.setLens('flood'); a.flood.toggle();",
  "const a=window.__livingpakistan; a.flood.toggle(); a.eras.show(); for (let k=0;k<a.eras.eras.length;k++) a.eras.setEra(k); a.eras.hide();",
  "const a=window.__livingpakistan; a.explorer.open(); document.querySelector('.modal:not(.hidden) th')?.click();",
  "const a=window.__livingpakistan; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.duel.open(); a.duel.set(5, 40);",
  "const a=window.__livingpakistan; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.search.open();",
  "const a=window.__livingpakistan; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.ui.almanac.open('census2023');",
  "const a=window.__livingpakistan; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.surprise.go(); a.surprise.go();",
  "const a=window.__livingpakistan; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); for (let k=0;k<a.tours.tours.length;k++){ a.tours.run(k); for (let s=0;s<a.tours.tours[k].steps.length;s++) a.tours.next(); } a.tours.stop();",
  "const a=window.__livingpakistan; a.lines.setTreatyView(true); a.lines.setTreatyView(false); a.home();",
  "const a=window.__livingpakistan; localStorage.removeItem('livingpakistan.welcome.v1'); if (!a.guide.shouldAutoShow()) throw new Error('welcome should show on a first visit'); a.guide.openWelcome(); a.guide.closeWelcome(); if (a.guide.shouldAutoShow()) throw new Error('welcome should not auto-show again'); localStorage.removeItem('livingpakistan.welcome.v1');",
  "const a=window.__livingpakistan; a.guide.start(); window.__steps = a.guide.steps.length;",
  ...Array.from({ length: 19 }, () => "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));"),
  "const a=window.__livingpakistan; if (a.guide.running) throw new Error('guide did not finish'); a.guide.start(); a.guide.go(5); a.guide.back(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); if (a.guide.running) throw new Error('Esc did not exit');",
];
for (const s of steps) { await p.evaluate(s).catch((e) => errs.push('[step] ' + s.slice(0, 60) + ' → ' + e.message)); await p.waitForTimeout(700); }
// real mouse interactions on the canvas
await p.mouse.move(720, 450); await p.waitForTimeout(400); await p.mouse.click(760, 480); await p.waitForTimeout(600);
await p.mouse.move(700, 400); await p.mouse.down(); await p.mouse.move(600, 380, { steps: 8 }); await p.mouse.up();
await p.mouse.wheel(0, -600); await p.waitForTimeout(800);
await p.keyboard.press('l'); await p.keyboard.press('h'); await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/sweep.png' });
await p.close(); // two software-rendered WebGL pages at once starve each other

// Phone: a first visit opens on the bare map (no welcome, no panels), and the
// dock opens one sheet at a time, which a tap on the map puts away.
const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = await mctx.newPage();
m.on('console', (x) => { if (['error', 'warning'].includes(x.type())) errs.push(`[mobile ${x.type()}] ${x.text()}`); });
m.on('pageerror', (e) => errs.push(`[mobile pageerror] ${e.message}`));
await m.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await m.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 120000 });
await m.waitForTimeout(8000); // longer than the desktop intro takes to bring up the welcome
const openSheets = () => m.evaluate(() => window.__livingpakistan.mobile.sheets.filter((s) => !s.node.classList.contains('hidden')).map((s) => s.key));
const expect = async (label, want) => { const got = await openSheets(); if (got.join() !== want.join()) errs.push(`[mobile] ${label}: open sheets ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };
const layout = await m.evaluate(() => ({ mobile: document.body.classList.contains('mobile'), topbar: getComputedStyle(document.querySelector('.topbar')).display, dock: getComputedStyle(document.querySelector('.m-dock')).display }));
if (!layout.mobile || layout.topbar !== 'none' || layout.dock === 'none') errs.push(`[mobile] layout ${JSON.stringify(layout)}`);
await expect('first visit', []);
await m.tap('[data-sheet=lenses]'); await m.waitForTimeout(500); await expect('lenses', ['lenses']);
await m.tap('[data-sheet=tours]'); await m.waitForTimeout(500); await expect('tours replaces lenses', ['tours']);
await m.tap('.m-guide'); await m.waitForTimeout(500); await expect('guide replaces tours', ['guide']);
// the strip of map between the top buttons and the sheet
const stripY = await m.evaluate(() => (document.querySelector('.m-top').getBoundingClientRect().bottom + document.querySelector('.guide-welcome').getBoundingClientRect().top) / 2);
await m.touchscreen.tap(195, stripY); await m.waitForTimeout(500);
await expect('tap on the map dismisses', []);
await m.tap('[data-sheet=more]'); await m.waitForTimeout(400); await m.keyboard.press('Escape'); await m.waitForTimeout(400); await expect('Esc dismisses', []);
await mctx.close();
console.log(JSON.stringify({ errors: errs }, null, 1));
await b.close();
