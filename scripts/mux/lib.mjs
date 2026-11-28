// Shared harness for the mobile UX audit (docs/mobile-ux-audit.md).
// Playwright Chromium with touch emulation and SwiftShader software GL.
import { chromium } from 'playwright';
import { join, resolve } from 'node:path';

export const BASE = process.env.MUX_BASE || 'http://127.0.0.1:4391/';
export const OUT = resolve(process.env.MUX_OUT || 'previews');
export const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const DEVICES = {
  se: { name: 'iPhone SE', width: 375, height: 667, dpr: 2, ua: IOS_UA },
  i14: { name: 'iPhone 14', width: 390, height: 844, dpr: 2, ua: IOS_UA },
  max: { name: 'iPhone Pro Max', width: 430, height: 932, dpr: 2, ua: IOS_UA },
  android: { name: 'small Android', width: 360, height: 740, dpr: 2, ua: ANDROID_UA },
  land: { name: 'landscape phone', width: 844, height: 390, dpr: 2, ua: IOS_UA },
  tab768: { name: 'tablet 768', width: 768, height: 1024, dpr: 2, ua: IPAD_UA },
  tab820: { name: 'tablet 820', width: 820, height: 1180, dpr: 2, ua: IPAD_UA },
};

export async function launch() { return chromium.launch({ args: GL }); }

export async function context(browser, dev, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: dev.dpr,
    isMobile: true, hasTouch: true, userAgent: dev.ua, ...extra,
  });
  // never report audit traffic to the site's GA4 property (and a hanging
  // third-party script must not hold up the load event)
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort());
  return ctx;
}

/** Open the app and wait until it is ready and the camera has landed. */
export async function open(ctx, { params = { guide: '0' }, hash = '', init = null, wait = true } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (init) await page.addInitScript(init);
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const t0 = Date.now();
  await page.goto(url.href + hash, { waitUntil: 'load', timeout: 180000 });
  if (wait) {
    await page.waitForFunction(() => window.__livingpakistan_ready === true, null, { timeout: 150000 }).catch(async (e) => {
      const why = await page.evaluate(() => document.getElementById('loader-sub')?.textContent).catch(() => '?');
      throw new Error(`not ready after 150 s (loader says: ${why}; errors: ${errors.join(' | ')})`);
    });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !window.__livingpakistan.stage.flight, null, { timeout: 120000 });
  }
  return { page, errors, readyMs: Date.now() - t0 };
}

export const shot = (page, f, opts = {}) => page.screenshot({ path: resolve(OUT, f), timeout: 240000, ...opts });

/** CDP touch helpers: real touch events, with their own timestamps (software GL stalls). */
export async function touch(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const ev = (type, pts, timestamp) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, ...(timestamp ? { timestamp } : {}) });
  const tap = async (x, y, settle = 700) => { const ts = Date.now() / 1000; await ev('touchStart', [{ x, y }], ts); await ev('touchEnd', [], ts + 0.08); await page.waitForTimeout(settle); };
  const drag = async (pts0, pts1, steps = 8) => {
    await ev('touchStart', pts0.map(([x, y], id) => ({ x, y, id })));
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      await ev('touchMove', pts0.map(([x, y], id) => ({ x: x + (pts1[id][0] - x) * k, y: y + (pts1[id][1] - y) * k, id })));
    }
    await ev('touchEnd', []);
  };
  const tapSel = async (sel, settle) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error('no box for ' + sel);
    await tap(b.x + b.width / 2, b.y + b.height / 2, settle);
  };
  return { cdp, ev, tap, drag, tapSel };
}

/** Draw labelled boxes over the page (screen coords) for annotated screenshots. */
export async function annotate(page, boxes) {
  await page.evaluate((boxes) => {
    let layer = document.getElementById('mux-ann');
    if (!layer) { layer = document.createElement('div'); layer.id = 'mux-ann'; document.body.append(layer); }
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
    layer.innerHTML = '';
    for (const b of boxes) {
      const c = b.color || '#ff2d55';
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:2px solid ${c};box-shadow:0 0 0 1px #000`;
      layer.append(d);
      if (b.label) {
        const t = document.createElement('div');
        const below = b.y < 24;
        t.textContent = b.label;
        t.style.cssText = `position:fixed;left:${Math.max(2, Math.min(innerWidth - 220, b.x))}px;top:${below ? b.y + b.h + 2 : b.y - 20}px;max-width:220px;background:${c};color:#fff;font:700 11px/1.3 system-ui;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
        layer.append(t);
      }
    }
  }, boxes);
}
export const clearAnn = (page) => page.evaluate(() => document.getElementById('mux-ann')?.remove());

/** Bounding box of the first match, in a form annotate() takes. */
export async function boxOf(page, sel, label, color) {
  const b = await page.locator(sel).first().boundingBox().catch(() => null);
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height, label, color } : null;
}

export function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }
