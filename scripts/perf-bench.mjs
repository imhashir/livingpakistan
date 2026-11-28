// Performance benchmark: loads the production build under `vite preview` in headless Chromium
// (SwiftShader software GL, a weak-GPU proxy) and measures load, frame rate over a fixed camera
// orbit, hover picking, idle cost, memory and draw stats per scenario.
//
//   npm run perf                                   # all scenarios → logs/perf-latest.json
//   npm run perf -- --out docs/perf-after.json     # save somewhere else
//   npm run perf -- --only tv-1080p --query quality=low
//   npm run perf -- --profile                      # also take a CPU profile of an unminified build
//
// Every scenario uses the same deterministic orbit (driven by wall-clock fraction, so the camera
// path is identical however fast frames come) and the same hover sweep.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const OUT = opt('out', 'logs/perf-latest.json');
const ONLY = opt('only', null);
const QUERY = opt('query', '');
const LABEL = opt('label', path.basename(OUT, '.json'));
const PORT = +opt('port', 4199);
const ORBIT_MS = +opt('orbit', 12000);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// --only none skips the scenarios (e.g. with --profile)

const SCENARIOS = [
  { id: 'desktop-1440', w: 1440, h: 900, dpr: 1, cpu: 1, note: 'unthrottled CPU, SwiftShader GL' },
  { id: 'tv-1080p', w: 1920, h: 1080, dpr: 1, cpu: 4, note: '4x CPU throttle, SwiftShader GL' },
  { id: 'tv-720p', w: 1280, h: 720, dpr: 1, cpu: 6, note: '6x CPU throttle, SwiftShader GL' },
  { id: 'phone-390', w: 390, h: 844, dpr: 2, cpu: 4, mobile: true, note: '4x CPU throttle, DPR 2, touch' },
];

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'];

// ---------------------------------------------------------------- server
async function serve(outDir) {
  try { await fetch(`http://127.0.0.1:${PORT}/`); throw new Error(`port ${PORT} is already serving something; stop it or pass --port`); } catch (e) { if (/already serving/.test(e.message)) throw e; }
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort',
    '--host', '127.0.0.1', ...(outDir ? ['--outDir', outDir] : [])], { cwd: ROOT, stdio: 'ignore' });
  let exited = false; p.once('exit', () => { exited = true; });
  // stop() waits for the port to be released, so a second server can't be confused with this one
  p.stop = () => new Promise((r) => { if (exited) r(); else { p.once('exit', r); p.kill(); } });
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`vite preview exited (port ${PORT} busy?)`);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return p; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  await p.stop(); throw new Error('vite preview did not start');
}

// ---------------------------------------------------------------- static analysis of the build
function bundleStats(dir) {
  const assets = path.join(dir, 'assets');
  const out = { js: [], css: [], data: [] };
  for (const f of fs.readdirSync(assets)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const buf = fs.readFileSync(path.join(assets, f));
    out[f.endsWith('.js') ? 'js' : 'css'].push({ file: f, bytes: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length });
  }
  const dd = path.join(dir, 'data');
  for (const f of fs.readdirSync(dd)) {
    const buf = fs.readFileSync(path.join(dd, f));
    out.data.push({ file: f, bytes: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length });
  }
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  out.totals = { js: sum(out.js, 'bytes'), jsGzip: sum(out.js, 'gzip'), css: sum(out.css, 'bytes'), data: sum(out.data, 'bytes'), dataGzip: sum(out.data, 'gzip') };
  out.entryJs = out.js.filter((x) => /^index-/.test(x.file)).reduce((s, x) => s + x.bytes, 0);
  return out;
}

// ---------------------------------------------------------------- in-page instrumentation
const INIT = () => {
  window.__bench = { lt: [], t: {}, renders: 0, frameRendered: false, calls: 0, tris: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bench.lt.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
  // loader hidden = first map on screen
  const mo = new MutationObserver(() => {
    const l = document.getElementById('loader');
    if (l && l.classList.contains('gone') && !window.__bench.t.mapVisible) window.__bench.t.mapVisible = performance.now();
  });
  document.addEventListener('DOMContentLoaded', () => {
    window.__bench.t.dcl = performance.now();
    const l = document.getElementById('loader'); if (l) mo.observe(l, { attributes: true });
  });
  const poll = () => { if (window.__livingpakistan_ready) window.__bench.t.ready = performance.now(); else requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
  // count frames that actually drew something, and accumulate renderer.info across every pass of a frame
  const hook = () => {
    const a = window.__livingpakistan;
    if (!a) return requestAnimationFrame(hook);
    const r = a.stage.renderer, orig = r.render.bind(r);
    r.info.autoReset = false;
    r.render = (s, c) => {
      if (!window.__bench.frameRendered) { window.__bench.frameRendered = true; window.__bench.renders++; }
      return orig(s, c);
    };
    const tick = () => { window.__bench.frameRendered = false; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(hook);
};

// estimate of GPU-resident memory (bytes): drawing buffer, render targets, shadow map, textures, vertex buffers
const GPU_ESTIMATE = () => {
  const a = window.__livingpakistan, st = a.stage, r = st.renderer, gl = r.getContext();
  const attrs = gl.getContextAttributes();
  const db = { x: gl.drawingBufferWidth, y: gl.drawingBufferHeight };
  const px = db.x * db.y;
  const out = {};
  // front + back colour, depth/stencil, and MSAA copies when antialias is on
  out.drawingBuffer = px * 4 * 2 + px * 4 + (attrs.antialias ? px * 4 * 4 * 2 : 0);
  const bpp = (t) => (t?.type === 1016 || t?.type === 1015 ? (t.type === 1016 ? 8 : 16) : 4); // HalfFloat / Float / ubyte RGBA
  const rtBytes = (rt) => (rt ? rt.width * rt.height * (bpp(rt.texture) + (rt.depthBuffer ? 4 : 0)) * Math.max(1, rt.samples || 1) : 0);
  let rts = 0;
  const c = st.composer;
  if (c) {
    rts += rtBytes(c.renderTarget1) + rtBytes(c.renderTarget2);
    for (const p of c.passes) {
      for (const k of Object.keys(p)) {
        const v = p[k];
        if (v?.isWebGLRenderTarget) rts += rtBytes(v);
        if (Array.isArray(v)) for (const x of v) if (x?.isWebGLRenderTarget) rts += rtBytes(x);
      }
    }
  }
  out.renderTargets = rts;
  let shadow = 0;
  a.stage.scene.traverse((o) => { if (o.isLight && o.castShadow && r.shadowMap.enabled) shadow += o.shadow.mapSize.x * o.shadow.mapSize.y * 4 * 2; });
  out.shadowMaps = shadow;
  const texs = new Set(), geos = new Set();
  a.stage.scene.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      for (const v of Object.values(m)) if (v?.isTexture) texs.add(v);
      for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) texs.add(u.value);
    }
  });
  let tb = 0;
  for (const t of texs) { const im = t.image; if (im?.width) tb += im.width * im.height * 4 * (t.generateMipmaps !== false && !t.isDataTexture ? 1.33 : 1); }
  out.textures = Math.round(tb);
  let vb = 0;
  for (const g of geos) {
    for (const at of Object.values(g.attributes)) vb += at.array?.byteLength || 0;
    if (g.index) vb += g.index.array.byteLength;
  }
  a.stage.scene.traverse((o) => { if (o.isInstancedMesh) { vb += o.instanceMatrix.array.byteLength; if (o.instanceColor) vb += o.instanceColor.array.byteLength; } });
  out.vertexBuffers = vb;
  out.total = Object.values(out).reduce((s, v) => s + v, 0);
  out.drawingBufferSize = [db.x, db.y];
  out.antialias = attrs.antialias; out.preserveDrawingBuffer = attrs.preserveDrawingBuffer;
  out.shadowMapEnabled = r.shadowMap.enabled; out.pixelRatio = r.getPixelRatio();
  out.textureCount = texs.size; out.geometryCount = geos.size;
  let objects = 0, visible = 0; a.stage.scene.traverse((o) => { objects++; if (o.visible) visible++; });
  out.sceneObjects = objects;
  out.labels = document.querySelectorAll('.labels-layer > *').length;
  out.quality = a.quality?.tier || 'n/a';
  out.renderer = (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })();
  return out;
};

// deterministic orbit: wide orbit of the whole country, then a close orbit over Lahore (labels, skyline, pins)
const ORBIT = (ms) => new Promise((resolve) => {
  const a = window.__livingpakistan, st = a.stage, cam = st.camera, ctl = st.controls, B = window.__bench;
  const [cx, cz] = a.board.mapToWorld(990, 980);
  const lhr = a.sites.sites.find((s) => s.name === 'Lahore');
  const lp = a.sites.worldPos(lhr);
  const r = st.renderer;
  r.info.reset(); const r0 = B.renders;
  const frames = []; const heap = []; let last = null;
  const t0 = performance.now();
  const step = (now) => {
    const k = (now - t0) / ms;
    if (last != null) frames.push(now - last);
    last = now;
    if (performance.memory) heap.push(performance.memory.usedJSHeapSize);
    if (k >= 1) {
      const n = Math.max(1, B.renders - r0);
      resolve({ frames, heap, renders: B.renders - r0, calls: r.info.render.calls / n, triangles: r.info.render.triangles / n,
        points: r.info.render.points / n, lines: r.info.render.lines / n, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
        programs: r.info.programs?.length ?? null });
      return;
    }
    const wide = k < 0.5, kk = wide ? k / 0.5 : (k - 0.5) / 0.5;
    const tx = wide ? cx : lp.x, tz = wide ? cz : lp.z;
    const dist = wide ? 2350 : 520, tilt = wide ? 0.62 : 0.95, az = -0.12 + kk * Math.PI * 2;
    ctl.target.set(tx, 0, tz);
    cam.position.set(tx + dist * Math.sin(tilt) * Math.sin(az), dist * Math.cos(tilt), tz + dist * Math.sin(tilt) * Math.cos(az));
    st.invalidate?.({ shadows: false }); // camera moves never need the static shadow map redrawn
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

// collect rAF intervals for `ms` without touching anything
const WATCH = (ms) => new Promise((resolve) => {
  const B = window.__bench, r0 = B.renders, frames = []; let last = null; const t0 = performance.now();
  const step = (now) => { if (last != null) frames.push(now - last); last = now; if (now - t0 >= ms) resolve({ frames, renders: B.renders - r0, ms: now - t0 }); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
});

function frameStats(frames) {
  if (!frames.length) return null;
  const s = [...frames].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const total = frames.reduce((a, b) => a + b, 0);
  const bucket = (lo, hi) => frames.filter((f) => f >= lo && f < hi).length / frames.length;
  return {
    frames: frames.length, avgFps: +(1000 * frames.length / total).toFixed(1),
    p5Fps: +(1000 / pct(0.95)).toFixed(1), p1Fps: +(1000 / pct(0.99)).toFixed(1),
    medianMs: +pct(0.5).toFixed(1), p95Ms: +pct(0.95).toFixed(1), p99Ms: +pct(0.99).toFixed(1), maxMs: +s[s.length - 1].toFixed(1),
    dist: { '<17ms': +bucket(0, 17.5).toFixed(3), '17-33ms': +bucket(17.5, 34).toFixed(3), '33-50ms': +bucket(34, 50).toFixed(3), '50-100ms': +bucket(50, 100).toFixed(3), '>100ms': +bucket(100, 1e9).toFixed(3) },
  };
}

function heapStats(heap, ms) {
  if (heap.length < 2) return null;
  let alloc = 0, gcs = 0, freed = 0;
  for (let i = 1; i < heap.length; i++) { const d = heap[i] - heap[i - 1]; if (d > 0) alloc += d; else if (d < -64 * 1024) { gcs++; freed -= d; } }
  return { allocMBperSec: +(alloc / 1048576 / (ms / 1000)).toFixed(2), gcDrops: gcs, freedMB: +(freed / 1048576).toFixed(1) };
}

const metric = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

function gcFromTrace(buf) {
  let events = [];
  try { const j = JSON.parse(buf.toString()); events = j.traceEvents || j; } catch { return null; }
  const total = events.length;
  const gc = events.filter((e) => e.ph === 'X' && /^(MinorGC|MajorGC|V8\.GCScavenger|V8\.GCFinalizeMC|V8\.GC_MARK_COMPACTOR|V8\.GCIncrementalMarking)$/.test(e.name));
  const by = {};
  for (const e of gc) { const b = (by[e.name] ||= { n: 0, ms: 0, maxMs: 0 }); b.n++; b.ms += e.dur / 1000; b.maxMs = Math.max(b.maxMs, e.dur / 1000); }
  for (const b of Object.values(by)) { b.ms = +b.ms.toFixed(1); b.maxMs = +b.maxMs.toFixed(1); }
  return { traceEvents: total, events: by };
}

// ---------------------------------------------------------------- one scenario
async function runScenario(browser, sc, url) {
  const ctx = await browser.newContext({ viewport: { width: sc.w, height: sc.h }, deviceScaleFactor: sc.dpr, isMobile: !!sc.mobile, hasTouch: !!sc.mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('livingpakistan.welcome.v1', '1'); } catch {} });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (sc.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
  const tNav = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__bench?.t.ready, null, { timeout: 240000, polling: 100 });
  const wallReady = Date.now() - tNav;
  const mLoad = await metric(cdp);
  const load = await page.evaluate(() => {
    const B = window.__bench, nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const data = res.filter((r) => /\/data\/.*\.json/.test(r.name)).map((r) => ({ file: r.name.split('/').pop(), ms: +r.duration.toFixed(1), bytes: r.transferSize || r.encodedBodySize }));
    const js = res.filter((r) => /assets\/.*\.js/.test(r.name)).map((r) => ({ file: r.name.split('/').pop(), ms: +r.duration.toFixed(1), bytes: r.transferSize || r.encodedBodySize }));
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    return { fcpMs: fcp ? +fcp.toFixed(0) : null, dclMs: +(B.t.dcl || nav.domContentLoadedEventEnd).toFixed(0), mapVisibleMs: B.t.mapVisible ? +B.t.mapVisible.toFixed(0) : null,
      readyMs: +B.t.ready.toFixed(0), dataFetch: data, jsFetch: js,
      longTasks: { n: B.lt.length, totalMs: +B.lt.reduce((s, x) => s + x[1], 0).toFixed(0), maxMs: +Math.max(0, ...B.lt.map((x) => x[1])).toFixed(0) } };
  });
  load.scriptDurationMs = +(mLoad.ScriptDuration * 1000).toFixed(0);
  load.taskDurationMs = +(mLoad.TaskDuration * 1000).toFixed(0);
  load.layoutMs = +(mLoad.LayoutDuration * 1000).toFixed(0);
  load.wallReadyMs = wallReady;
  // JSON parse cost of the data bundle, re-measured in isolation (throttled CPU applies)
  load.jsonParse = await page.evaluate(async () => {
    const m = await (await fetch('data/manifest.json')).json();
    const out = {}; let total = 0;
    for (const f of m.files) { const t = await (await fetch(`data/${f}.json`)).text(); const t0 = performance.now(); JSON.parse(t); const d = performance.now() - t0; out[f] = +d.toFixed(1); total += d; }
    out.total = +total.toFixed(1); return out;
  });
  // let the boot settle (counters, label declutter, first lens paint)
  await page.waitForTimeout(3000);
  await page.evaluate(() => { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); });
  const heapAfterLoad = await page.evaluate(() => { window.gc?.(); return performance.memory ? performance.memory.usedJSHeapSize : null; });
  // ---- orbit
  const ltBefore = await page.evaluate(() => window.__bench.lt.length);
  const mo0 = await metric(cdp);
  await browser.startTracing(page, { categories: ['disabled-by-default-v8.gc', 'v8', 'devtools.timeline'] });
  const orbit = await page.evaluate(ORBIT, ORBIT_MS);
  const trace = await browser.stopTracing();
  const mo1 = await metric(cdp);
  const orbitLT = await page.evaluate((n) => window.__bench.lt.slice(n), ltBefore);
  const gpu = await page.evaluate(GPU_ESTIMATE);
  // ---- hover sweep with a still camera: raycast cost
  await page.evaluate(() => { const a = window.__livingpakistan; a.home(true); a.stage.invalidate?.({ shadows: false }); });
  await page.waitForTimeout(800);
  const mh0 = await metric(cdp);
  const hoverP = page.evaluate(WATCH, 4000);
  if (!sc.mobile) {
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 3800) { const k = (i++ % 120) / 120; await page.mouse.move(sc.w * (0.25 + 0.5 * k), sc.h * (0.35 + 0.3 * Math.sin(k * 6.28))); }
  }
  const hover = await hoverP;
  const mh1 = await metric(cdp);
  // ---- idle: nothing changes for 5s
  await page.mouse.move(2, 2).catch(() => {});
  await page.waitForTimeout(1500);
  const mi0 = await metric(cdp);
  const idle = await page.evaluate(WATCH, 5000);
  const mi1 = await metric(cdp);
  const heapEnd = await page.evaluate(() => { window.gc?.(); return performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null; });
  const cdpHeap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  await ctx.close();
  const busy = (a, b, ms) => +(((b.TaskDuration - a.TaskDuration) * 1000) / ms * 100).toFixed(1);
  return {
    id: sc.id, viewport: `${sc.w}x${sc.h}@${sc.dpr}x`, cpuThrottle: sc.cpu, note: sc.note, url, errors,
    load,
    orbit: { ...frameStats(orbit.frames), renders: orbit.renders, mainThreadBusyPct: busy(mo0, mo1, ORBIT_MS),
      drawCallsPerFrame: +orbit.calls.toFixed(0), trianglesPerFrame: Math.round(orbit.triangles), geometries: orbit.geometries, textures: orbit.textures, programs: orbit.programs,
      longTasks: { n: orbitLT.length, totalMs: +orbitLT.reduce((s, x) => s + x[1], 0).toFixed(0) }, heap: heapStats(orbit.heap, ORBIT_MS), gc: gcFromTrace(trace) },
    hover: { ...frameStats(hover.frames), renders: hover.renders, mainThreadBusyPct: busy(mh0, mh1, hover.ms) },
    idle: { rendersPerSec: +(idle.renders / (idle.ms / 1000)).toFixed(1), mainThreadBusyPct: busy(mi0, mi1, idle.ms), rafFps: +(1000 * idle.frames.length / idle.ms).toFixed(1) },
    memory: { jsHeapAfterLoadMB: heapAfterLoad ? +(heapAfterLoad / 1048576).toFixed(1) : null, jsHeapEndMB: heapEnd ? +(heapEnd.used / 1048576).toFixed(1) : null,
      jsHeapTotalMB: heapEnd ? +(heapEnd.total / 1048576).toFixed(1) : null, cdpUsedMB: cdpHeap ? +(cdpHeap.usedSize / 1048576).toFixed(1) : null,
      gpuEstimateMB: +(gpu.total / 1048576).toFixed(1), gpu: Object.fromEntries(Object.entries(gpu).map(([k, v]) => [k, typeof v === 'number' && v > 4096 ? +(v / 1048576).toFixed(2) : v])) },
  };
}

// ---------------------------------------------------------------- CPU profile (unminified build, so names are readable)
function summariseProfile(prof, top = 30) {
  const self = new Map(), byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const dt = prof.timeDeltas; let total = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const n = byId.get(prof.samples[i]); const d = (dt[i] || 0) / 1000; total += d;
    const cf = n.callFrame; const file = cf.url.split('/').pop().replace(/\?.*/, '');
    const key = `${cf.functionName || '(anonymous)'} ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + d);
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, ms]) => ({ fn: k, selfMs: +ms.toFixed(1), pct: +((ms / total) * 100).toFixed(1) }));
  return { totalMs: +total.toFixed(0), top: rows };
}

async function profileRun(browser, url) {
  const sc = SCENARIOS.find((s) => s.id === 'tv-1080p');
  const ctx = await browser.newContext({ viewport: { width: sc.w, height: sc.h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('livingpakistan.welcome.v1', '1'); } catch {} });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
  await cdp.send('Profiler.start');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bench?.t.ready, null, { timeout: 240000, polling: 100 });
  const loadProf = (await cdp.send('Profiler.stop')).profile;
  await page.waitForTimeout(3000);
  await cdp.send('Profiler.start');
  await page.evaluate(ORBIT, 8000);
  const orbitProf = (await cdp.send('Profiler.stop')).profile;
  await cdp.send('Profiler.start');
  await page.evaluate(() => { const a = window.__livingpakistan; a.home(true); a.stage.invalidate?.({ shadows: false }); });
  const t0 = Date.now(); let i = 0;
  while (Date.now() - t0 < 3000) { const k = (i++ % 120) / 120; await page.mouse.move(sc.w * (0.25 + 0.5 * k), sc.h * (0.35 + 0.3 * Math.sin(k * 6.28))); }
  const hoverProf = (await cdp.send('Profiler.stop')).profile;
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  for (const [n, p] of [['load', loadProf], ['orbit', orbitProf], ['hover', hoverProf]]) fs.writeFileSync(path.join(ROOT, `logs/${LABEL}-${n}.cpuprofile`), JSON.stringify(p));
  await ctx.close();
  return { scenario: sc.id, load: summariseProfile(loadProf), orbit: summariseProfile(orbitProf), hover: summariseProfile(hoverProf) };
}

// ---------------------------------------------------------------- main
const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html')) || flag('build')) execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
const result = { label: LABEL, date: new Date().toISOString(), git: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
  dirty: !!execSync('git status --porcelain -- web', { cwd: ROOT }).toString().trim(), query: QUERY, orbitMs: ORBIT_MS,
  machine: { cpus: (await import('node:os')).cpus().length, gl: 'SwiftShader (ANGLE) — no hardware GPU in this environment' },
  bundle: bundleStats(dist), scenarios: [] };
const server = await serve();
const browser = await chromium.launch({ args: GL_ARGS });
try {
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.split(',').includes(sc.id)) continue;
    const url = `http://127.0.0.1:${PORT}/${QUERY ? '?' + QUERY : ''}#bench`;
    process.stderr.write(`· ${sc.id} … `);
    const r = await runScenario(browser, sc, url);
    process.stderr.write(`ready ${r.load.readyMs} ms, orbit ${r.orbit.avgFps} fps (p5 ${r.orbit.p5Fps}), idle ${r.idle.rendersPerSec} renders/s\n`);
    result.scenarios.push(r);
  }
} finally { await browser.close(); await server.stop(); }
if (flag('profile')) {
  const tmp = '/tmp/livingpakistan-prof';
  execSync(`npx vite build --minify false --outDir ${tmp} --emptyOutDir`, { cwd: ROOT, stdio: 'ignore' });
  const s2 = await serve(tmp);
  const b2 = await chromium.launch({ args: GL_ARGS });
  try { result.profile = await profileRun(b2, `http://127.0.0.1:${PORT}/${QUERY ? '?' + QUERY : ''}#bench`); } finally { await b2.close(); await s2.stop(); }
}
fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(result, null, 1));
console.log(`wrote ${OUT}`);
