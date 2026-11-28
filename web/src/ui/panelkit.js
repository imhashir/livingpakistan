// Shared helpers for the HUD panels (search, almanac, explorer, duel, surprise).
import { el, fmt } from './dom.js';

export const NO_DATA = 'no data published';

/** Dotted-path getter: get(d, 'yields.gold'). */
export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/** Render a value; null/undefined/NaN → "—" with a "no data published" tooltip (never 0). */
export function val(v, f = fmt.int, tag = 'span') {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return el(tag, { class: 'nd', title: NO_DATA, text: '—' });
  return el(tag, { text: f(v) });
}

export const fmtNum = {
  int: fmt.int,
  big: fmt.big,
  pct: (v) => fmt.pct(v, 1),
  pct0: (v) => fmt.pct(v, 0),
  dec1: (v) => (+v).toFixed(1),
  dec2: (v) => (+v).toFixed(2),
  dec3: (v) => (+v).toFixed(3),
  usd: (v) => `$${fmt.int(v)}`,
  usdBig: (v) => `$${fmt.big(v)}`,
  m: (v) => `${fmt.int(v)} m`,
  bytes: (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`),
};

// Province colours (dataviz reference palette, dark-surface steps; green slot skipped — too dark on obsidian).
export const PROVINCE_COLORS = {
  Punjab: '#3987e5', Sindh: '#d95926', 'Khyber Pakhtunkhwa': '#199e70', Balochistan: '#c98500',
  Islamabad: '#d55181', 'Gilgit Baltistan': '#9085e9', 'Azad Kashmir': '#e66767',
};

// ------------------------------------------------------------------ fuzzy search
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Score `q` (normalised) against `text` (normalised). -1 = no match. Higher is better. */
export function fuzzyScore(q, text) {
  if (!q) return 0;
  if (text === q) return 2000;
  if (text.startsWith(q)) return 1500 - text.length;
  const words = text.split(' ');
  if (words.some((w) => w.startsWith(q))) return 1200 - text.length;
  const idx = text.indexOf(q);
  if (idx >= 0) return 900 - idx - text.length * 0.5;
  // initials ("dik" → "D. I. Khan")
  const initials = words.map((w) => w[0]).join('');
  if (initials.startsWith(q.replace(/ /g, ''))) return 800 - text.length;
  // subsequence with gap penalty and word-boundary bonus
  const qq = q.replace(/ /g, '');
  let ti = 0, score = 500, last = -1;
  for (const ch of qq) {
    const j = text.indexOf(ch, ti);
    if (j < 0) return -1;
    if (last >= 0) score -= Math.min(12, j - last - 1) * 4;
    if (j === 0 || text[j - 1] === ' ') score += 10;
    last = j; ti = j + 1;
  }
  return score - text.length * 0.5;
}

/** Rank items ({key: normalised search text}) by query; returns [{item, score}] best first. */
export function fuzzyRank(items, query, limit = 40, keyFn = (x) => x.key, boostFn = () => 0) {
  const q = norm(query);
  const out = [];
  for (const it of items) {
    const s = fuzzyScore(q, keyFn(it));
    if (s >= 0) out.push({ item: it, score: s + boostFn(it) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ------------------------------------------------------------------ stats
/** Percentile rank (0..1) of v among sorted finite values. */
export function percentile(sorted, v) {
  if (v == null || !sorted.length) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return sorted.length === 1 ? 1 : ((lo + eq - 1) / 2) / (sorted.length - 1);
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// ------------------------------------------------------------------ panel frame
/** Calls fn() whenever `node` gains the .hidden class (e.g. app-wide Escape). */
export function onHidden(node, fn) {
  let was = node.classList.contains('hidden');
  new MutationObserver(() => {
    const now = node.classList.contains('hidden');
    if (now && !was) fn();
    was = now;
  }).observe(node, { attributes: true, attributeFilter: ['class'] });
}

/** Build a panel shell: { root, body, head }. */
export function panel(app, { cls, title, sub = null, actions = [], onClose = null }) {
  const root = el('div', { class: `modal pc-panel glass hidden ${cls}` });
  const close = el('button', { class: 'pc-x', title: 'Close (Esc)', 'aria-label': 'Close', text: '✕', onclick: () => { root.classList.add('hidden'); } });
  const head = el('div', { class: 'pc-head' }, [
    el('div', { class: 'pc-titles' }, [el('h2', { class: 'pc-title', text: title }), sub ? el('div', { class: 'pc-sub', text: sub }) : '']),
    el('div', { class: 'pc-actions' }, [...actions, close]),
  ]);
  const body = el('div', { class: 'pc-body' });
  root.append(head, body);
  app.hud.append(root);
  if (onClose) onHidden(root, onClose);
  return { root, head, body };
}

export function svgEl(tag, attrs = {}, children = []) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}
