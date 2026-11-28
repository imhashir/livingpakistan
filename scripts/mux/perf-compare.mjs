// Mobile view of PR #2 (perf/low-end-devices): which tier a phone gets, how the
// Graphics row looks in the Light sheet, and whether a still map keeps drawing.
// Usage: MUX_BASE=http://127.0.0.1:<perf port>/ node scripts/mux/perf-compare.mjs <label>
import { writeFileSync } from 'node:fs';
import { launch, context, DEVICES, open, shot, log } from './lib.mjs';

const label = process.argv[2] || 'perf';
const browser = await launch();
const ctx = await context(browser, DEVICES.i14);
const { page, readyMs } = await open(ctx);
const res = { label, readyMs };
res.quality = await page.evaluate(() => { const q = window.__livingpakistan.quality; return q ? { mode: q.mode, tier: q.tier, guess: q.guess, pr: window.__livingpakistan.stage.renderer.getPixelRatio() } : { none: true, pr: window.__livingpakistan.stage.renderer.getPixelRatio() }; });
// count rAF-driven renders over 5 s of a still map
res.idle = await page.evaluate(async () => {
  const s = window.__livingpakistan.stage; let n = 0; const orig = s.composer.render.bind(s.composer);
  s.composer.render = (...a) => { n++; return orig(...a); };
  await new Promise((r) => setTimeout(r, 5000));
  s.composer.render = orig; return { rendersIn5s: n };
});
await page.evaluate(() => window.__livingpakistan.mobile.open('light'));
await page.waitForTimeout(1500);
await shot(page, `mux-${label === 'perf' ? '29' : '28'}-light-sheet-${label === 'perf' ? 'perf-branch' : 'this-branch'}.png`);
writeFileSync(`/tmp/mux-flows/perf-${label}.json`, JSON.stringify(res, null, 1));
log(JSON.stringify(res));
await browser.close();
