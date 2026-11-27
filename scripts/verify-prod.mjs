import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(`[${m.type()}] ${m.text()}`); });
p.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
p.on('requestfailed', (r) => errs.push(`[requestfailed] ${r.url()}`));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__pakciv_ready === true, null, { timeout: 120000 });
const steps = [
  "const a=window.__pakciv; for (const l of a.atlas.lenses) a.setLens(l.id); a.setLens('terrain');",
  "const a=window.__pakciv; for (const m of ['golden','night','day']) a.setMood(m);",
  "const a=window.__pakciv; for (const b of document.querySelectorAll('[data-layer]')) { b.click(); b.click(); }",
  "const a=window.__pakciv; a.setRelief(20); a.setRelief(12);",
  "const a=window.__pakciv; a.select({district: 10}); a.select({cell: a.districts[20].cells[0]}); a.select({site: a.sites.sites.find(s=>s.kind==='city')}); a.select({site: a.sites.sites.find(s=>s.kind==='power')}); a.select(null);",
  "const a=window.__pakciv; a.setLens('flood'); a.flood.toggle();",
  "const a=window.__pakciv; a.flood.toggle(); a.eras.show(); for (let k=0;k<a.eras.eras.length;k++) a.eras.setEra(k); a.eras.hide();",
  "const a=window.__pakciv; a.explorer.open(); document.querySelector('.modal:not(.hidden) th')?.click();",
  "const a=window.__pakciv; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.duel.open(); a.duel.set(5, 40);",
  "const a=window.__pakciv; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.search.open();",
  "const a=window.__pakciv; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.ui.almanac.open('census2023');",
  "const a=window.__pakciv; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); a.surprise.go(); a.surprise.go();",
  "const a=window.__pakciv; window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); for (let k=0;k<a.tours.tours.length;k++){ a.tours.run(k); for (let s=0;s<a.tours.tours[k].steps.length;s++) a.tours.next(); } a.tours.stop();",
  "const a=window.__pakciv; a.lines.setTreatyView(true); a.lines.setTreatyView(false); a.home();",
  "const a=window.__pakciv; localStorage.removeItem('pakciv.welcome.v1'); if (!a.guide.shouldAutoShow()) throw new Error('welcome should show on a first visit'); a.guide.openWelcome(); a.guide.closeWelcome(); if (a.guide.shouldAutoShow()) throw new Error('welcome should not auto-show again'); localStorage.removeItem('pakciv.welcome.v1');",
  "const a=window.__pakciv; a.guide.start(); window.__steps = a.guide.steps.length;",
  ...Array.from({ length: 19 }, () => "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));"),
  "const a=window.__pakciv; if (a.guide.running) throw new Error('guide did not finish'); a.guide.start(); a.guide.go(5); a.guide.back(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); if (a.guide.running) throw new Error('Esc did not exit');",
];
for (const s of steps) { await p.evaluate(s).catch((e) => errs.push('[step] ' + s.slice(0, 60) + ' → ' + e.message)); await p.waitForTimeout(700); }
// real mouse interactions on the canvas
await p.mouse.move(720, 450); await p.waitForTimeout(400); await p.mouse.click(760, 480); await p.waitForTimeout(600);
await p.mouse.move(700, 400); await p.mouse.down(); await p.mouse.move(600, 380, { steps: 8 }); await p.mouse.up();
await p.mouse.wheel(0, -600); await p.waitForTimeout(800);
await p.keyboard.press('l'); await p.keyboard.press('h'); await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/sweep.png' });
console.log(JSON.stringify({ errors: errs }, null, 1));
await b.close();
