// Before/after table from two perf-bench.mjs result files (markdown on stdout).
//   node scripts/perf-compare.mjs docs/perf-baseline.json docs/perf-after.json [label-before] [label-after]
import fs from 'node:fs';

const [a, b, la = 'before', lb = 'after'] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a)), B = JSON.parse(fs.readFileSync(b));
const ROWS = [
  ['Map visible (ms)', (s) => s.load.mapVisibleMs, 'lower'],
  ['Ready (ms)', (s) => s.load.readyMs, 'lower'],
  ['Load long tasks (n / total ms)', (s) => `${s.load.longTasks.n} / ${s.load.longTasks.totalMs}`, null],
  ['Orbit avg FPS', (s) => s.orbit.avgFps, 'higher'],
  ['Orbit p5 FPS', (s) => s.orbit.p5Fps, 'higher'],
  ['Orbit median frame (ms)', (s) => s.orbit.medianMs, 'lower'],
  ['Orbit p95 frame (ms)', (s) => s.orbit.p95Ms, 'lower'],
  ['Draw calls / frame', (s) => s.orbit.drawCallsPerFrame, 'lower'],
  ['Triangles / frame', (s) => s.orbit.trianglesPerFrame, 'lower'],
  ['Hover avg FPS', (s) => s.hover.avgFps, 'higher'],
  ['Idle renders / s', (s) => s.idle.rendersPerSec, 'lower'],
  ['Idle main-thread busy %', (s) => s.idle.mainThreadBusyPct, 'lower'],
  ['JS heap after load (MB)', (s) => s.memory.jsHeapEndMB, 'lower'],
  ['GPU memory estimate (MB)', (s) => s.memory.gpuEstimateMB, 'lower'],
  ['Render pixel ratio', (s) => +(+s.memory.gpu.pixelRatio).toFixed(2), null],
  ['Tier', (s) => s.memory.gpu.quality, null],
  ['Console errors', (s) => s.errors.length, 'lower'],
];
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(v)) : String(v));
const delta = (x, y, dir) => {
  if (typeof x !== 'number' || typeof y !== 'number' || !dir) return '';
  if (x === 0 && y === 0) return '';
  if (dir === 'higher' && x > 0) return ` (${(y / x).toFixed(1)}×)`;
  if (dir === 'lower' && x > 0) return ` (${y <= x ? '−' : '+'}${Math.abs(Math.round((1 - y / x) * 100))}%)`;
  return '';
};
for (const sa of A.scenarios) {
  const sb = B.scenarios.find((s) => s.id === sa.id);
  if (!sb) continue;
  console.log(`\n**${sa.id}** — ${sa.viewport}, ${sa.note}${B.query ? ` (after: ?${B.query})` : ''}\n`);
  console.log(`| Metric | ${la} | ${lb} |`);
  console.log('|---|---:|---:|');
  for (const [name, f, dir] of ROWS) {
    const x = f(sa), y = f(sb);
    console.log(`| ${name} | ${fmt(x)} | ${fmt(y)}${delta(x, y, dir)} |`);
  }
}
const ba = A.bundle.totals, bb = B.bundle.totals;
console.log(`\n**Bundle** — JS ${(ba.js / 1024).toFixed(0)} KB (${(ba.jsGzip / 1024).toFixed(0)} KB gz) → ${(bb.js / 1024).toFixed(0)} KB (${(bb.jsGzip / 1024).toFixed(0)} KB gz); data ${(ba.data / 1024).toFixed(0)} KB (${(ba.dataGzip / 1024).toFixed(0)} KB gz) → ${(bb.data / 1024).toFixed(0)} KB`);
