// Tiny DOM + formatting helpers.
export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const nf = new Intl.NumberFormat('en-US');
export const fmt = {
  int: (v) => (v == null || Number.isNaN(v) ? '—' : nf.format(Math.round(v))),
  pct: (v, d = 1) => (v == null ? '—' : `${(+v).toFixed(d)}%`),
  big: (v) => {
    if (v == null) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
    return nf.format(Math.round(v));
  },
};
