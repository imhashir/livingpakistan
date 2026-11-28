// Device matrix: for each device, put the app into each UI state (through the
// app's own API, so it is fast and deterministic), then screenshot and collect
// tap-target / text-size / contrast metrics.
// Usage: node scripts/mux/matrix.mjs <deviceKey,...> [outDir]
// Writes <outDir>/<dev>-<state>.png and <outDir>/<dev>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, context, DEVICES, open, log } from './lib.mjs';
import { collect, summarize } from './metrics.mjs';

const [keys = 'i14', outDir = '/tmp/mux-matrix'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const STATES = {
  home: () => {},
  lenses: (A) => A.mobile.on ? A.mobile.open('lenses') : A.showDock(true),
  light: (A) => A.mobile.on && A.mobile.open('light'),
  more: (A) => A.mobile.on && A.mobile.open('more'),
  tours: (A) => A.mobile.on ? A.mobile.open('tours') : A.tours.openMenu(),
  search: (A) => { A.search.open(); A.search.input.value = 'kar'; A.search.input.dispatchEvent(new Event('input')); },
  explore: (A) => A.explorer.open(),
  duel: (A) => { A.duel.open(); const d = (n) => A.districts.findIndex((x) => x.name === n); A.duel.set(d('Lahore'), d('South Karachi')); },
  guide: (A) => A.guide.openWelcome(),
  inspCell: (A) => { const i = A.districts.findIndex((d) => d.name === 'Faisalabad'); A.select({ cell: A.districts[i].cells[5] }); },
  inspCity: (A) => { const k = A.sites.sites.find((s) => s.name === 'Karachi' && s.kind === 'city'); A.select({ site: k }); },
  almanac: (A) => A.ui.almanac.open(),
  surprise: (A) => A.surprise.go(),
  eras: (A) => { A.eras.show(); A.eras.setEra(1); },
  walk: (A) => A.guide.start(),
  tour: (A) => { A.tours.run(0); },
  tourOpen: (A) => { A.tours.run(0); A.tours.chip.open('pinned'); },
};
const only = process.env.MUX_STATES?.split(',');

// Resilient: a fresh browser per device, results saved after every state,
// states already captured are skipped, and a crashed browser is relaunched.
import { existsSync, readFileSync } from 'node:fs';
for (const key of keys.split(',')) {
  const dev = DEVICES[key];
  const file = join(outDir, `${key}.json`);
  const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { device: dev, states: {}, errors: [] };
  const todo = () => Object.keys(STATES).filter((n) => (!only || only.includes(n)) && !(out.states[n] && !out.states[n].error));
  for (let attempt = 0; attempt < 3 && todo().length; attempt++) {
    const browser = await launch();
    try {
      const ctx = await context(browser, dev);
      const { page, errors, readyMs } = await open(ctx);
      out.readyMs ??= readyMs;
      log(key, 'ready', readyMs);
      for (const name of todo()) {
        const fn = STATES[name];
        try {
          await page.evaluate(() => { const A = window.__livingpakistan; A.guide.end(); A.tours.stop(false); A.eras.hide(); A.flood.hide(); A.mobile.closeAll(); A.hud.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); A.select(null); A.focusOn(null); A.setLens('elevation'); A.setMood('day'); A.stage.flight = null; A.home(true); });
          await page.evaluate(`(${fn.toString()})(window.__livingpakistan)`);
          await page.waitForTimeout(name.startsWith('tour') ? 2500 : 1200);
          if (name.startsWith('tour')) await page.evaluate(() => { window.__livingpakistan.tours.paused = true; });
          await page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 }).catch(() => {});
          await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 30000, polling: 200 }).catch(() => {});
          await page.waitForTimeout(400);
          const m = await collect(page);
          await page.screenshot({ path: join(outDir, `${key}-${name}.png`), timeout: 240000 });
          out.states[name] = { summary: summarize(m), ...m };
          log(key, name, JSON.stringify(summarize(m)));
        } catch (e) { log(key, name, 'FAILED', e.message.split('\n')[0]); out.states[name] = { error: e.message }; if (/closed/.test(e.message)) break; }
        out.errors = errors;
        writeFileSync(file, JSON.stringify(out, null, 1));
      }
    } catch (e) { log(key, 'attempt', attempt, 'FAILED', e.message.split('\n')[0]); }
    await browser.close().catch(() => {});
  }
}
