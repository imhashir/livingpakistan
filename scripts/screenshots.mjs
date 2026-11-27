// Headless Chromium screenshots of the running app (WebGL via SwiftShader/ANGLE).
// Usage: node scripts/screenshots.mjs <url> <out.png> [width] [height] [waitMs] [jsToRunBeforeShot]
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:5173/', out = 'previews/shot.png', w = '1440', h = '900', wait = '6000', js = ''] =
  process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
         '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 120000 }).catch(() => {});
if (js) { await page.evaluate(js); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 1));
await browser.close();
