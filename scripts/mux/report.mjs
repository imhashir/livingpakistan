// Summarise matrix JSON: worst tap targets and smallest / lowest-contrast text
// per device, de-duplicated by element description.
// Usage: node scripts/mux/report.mjs [/tmp/mux-matrix] [device,...]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [dir = '/tmp/mux-matrix', only] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && (!only || only.split(',').includes(f.replace('.json', ''))));
for (const f of files) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  console.log(`\n### ${j.device.name} ${j.device.width}x${j.device.height} (ready ${j.readyMs} ms)`);
  console.log('state | targets | <44 | <32 | text<12px | contrast<4.5');
  for (const [s, v] of Object.entries(j.states)) if (v.summary) console.log(`${s} | ${v.summary.targets} | ${v.summary.under44} | ${v.summary.under32} | ${v.summary.textUnder12} | ${v.summary.lowContrast}`);
  const tg = new Map(), tx = new Map(), lc = new Map();
  for (const [s, v] of Object.entries(j.states)) {
    for (const t of v.targets || []) if (!t.covered && (t.w < 44 || t.h < 44)) { const k = t.el; const o = tg.get(k); if (!o || Math.min(t.w, t.h) < Math.min(o.w, o.h)) tg.set(k, { ...t, state: s }); }
    for (const t of v.texts || []) {
      if (t.fs < 12) { const k = t.el.replace(/"[^"]*"/, '') + ' ' + t.fs; if (!tx.has(k)) tx.set(k, { ...t, state: s }); }
      if (t.cr != null && t.cr < 4.5) { const k = t.el.replace(/"[^"]*"/, ''); const o = lc.get(k); if (!o || t.cr < o.cr) lc.set(k, { ...t, state: s }); }
    }
  }
  console.log(`\nTap targets under 44px (${tg.size} distinct):`);
  for (const t of [...tg.values()].sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))) console.log(`  ${t.w}x${t.h}  ${t.el}  [${t.state}]${t.note ? ' ' + t.note : ''}`);
  console.log(`\nText under 12px (${tx.size} distinct):`);
  for (const t of [...tx.values()].sort((a, b) => a.fs - b.fs)) console.log(`  ${t.fs}px  ${t.el} "${t.text}" [${t.state}]`);
  console.log(`\nContrast under 4.5:1 (${lc.size} distinct):`);
  for (const t of [...lc.values()].sort((a, b) => a.cr - b.cr)) console.log(`  ${t.cr}:1 ${t.fs}px ${t.el} "${t.text}" [${t.state}]`);
}
