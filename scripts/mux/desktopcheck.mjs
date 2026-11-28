// Desktop regression check for the mobile fixes: the same five states at
// 1440x900 (mouse, no touch) on any build, for comparing against main.
//   MUX_BASE=http://127.0.0.1:4410/ node scripts/mux/desktopcheck.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { GL, BASE, log } from './lib.mjs';

const [outDir = '/tmp/muxfix-desk'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const STATES = {
  home: () => {},
  lens: (A) => A.setLens('literacy'),
  inspector: (A) => { const k = A.sites.sites.find((s) => s.name === 'Lahore' && s.kind === 'city'); A.select({ site: k }); },
  tour: (A) => { A.tours.run(0); },
  explorer: (A) => A.explorer.open(),
};
const browser = await chromium.launch({ args: GL });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}?guide=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 150000 });
// let the desktop intro (title card, flight home) finish
await page.waitForTimeout(8000);
await page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 });
const out = { mobileLayout: await page.evaluate(() => document.body.classList.contains('mobile')), states: {} };
for (const [name, fn] of Object.entries(STATES)) {
  await page.evaluate(() => { const A = window.__livingpakistan; A.tours.stop(false); A.hud.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); A.select(null); A.focusOn(null); A.setLens('elevation'); A.setMood('day'); A.stage.flight = null; A.home(true); });
  await page.evaluate(`(${fn.toString()})(window.__livingpakistan)`);
  await page.waitForTimeout(name === 'tour' ? 3000 : 1500);
  if (name === 'tour') await page.evaluate(() => { window.__livingpakistan.tours.paused = true; });
  await page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 30000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(600);
  out.states[name] = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('#hud button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return `${b.className.split(' ')[0]}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`; }),
    labels: [...document.querySelectorAll('.banner, .wlabel')].filter((n) => n.style.display !== 'none').length,
    view: !!window.__livingpakistan.stage.camera.view?.enabled,
  }));
  await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 240000 });
  log(name, out.states[name].buttons.length, 'buttons', out.states[name].labels, 'labels');
}
out.errors = errors;
writeFileSync(join(outDir, 'desktop.json'), JSON.stringify(out, null, 1));
await browser.close();
