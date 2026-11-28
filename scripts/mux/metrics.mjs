// In-page metrics for the mobile audit: tap-target sizes, text sizes and
// text contrast against the effective background. collect(page) returns
// plain JSON. Contrast is approximate: the background is the first opaque-ish
// colour found walking up the ancestors (solid colour or the first colour stop
// of a gradient, alpha-blended over #07090d, the page colour). Text whose
// ancestors have no background sits on the WebGL map and is reported as
// "over map" without a ratio.
export async function collect(page) {
  return page.evaluate(() => {
    const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const PAGE = { r: 7, g: 9, b: 13, a: 1 };
    const visible = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
      for (let p = n; p && p.nodeType === 1; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
      }
      return r;
    };
    const bgOf = (n) => {
      const layers = [];
      for (let p = n; p && p.nodeType === 1; p = p.parentElement) {
        const cs = getComputedStyle(p);
        let c = parse(cs.backgroundColor);
        if ((!c || c.a === 0) && cs.backgroundImage && cs.backgroundImage !== 'none') c = parse(cs.backgroundImage);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 0.85) break; }
        if (p.id === 'hud' || p.classList.contains('labels-layer')) break;
      }
      if (!layers.length) return null;
      let col = PAGE;
      for (const l of layers.reverse()) col = blend(l, col);
      return col;
    };
    const desc = (n) => {
      const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const name = n.getAttribute('aria-label') || n.getAttribute('title') || (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${n.tagName.toLowerCase()}${cls} "${name}"`;
    };
    // ---- tap targets
    const targets = [];
    const sel = 'button, a[href], input, select, summary, [role=button], [onclick], .banner, .wlabel, .gd-dots i, .exp-table th, .exp-table tbody tr, .lg-cat, .srch-row, .duel-ac div, .duel-chip, .alm-files summary';
    for (const n of document.querySelectorAll(sel)) {
      const r = visible(n); if (!r) continue;
      const cs = getComputedStyle(n);
      if (cs.pointerEvents === 'none') continue;
      // is it actually on top at its centre?
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      const covered = top && !(n === top || n.contains(top) || top.contains(n));
      const t = { el: desc(n), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), covered: !!covered };
      if (n.type === 'range') t.note = 'range: thumb size is UA default (~16px in Chromium)';
      targets.push(t);
    }
    // ---- text
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t; (t = walker.nextNode());) {
      if (!t.textContent.trim()) continue;
      const n = t.parentElement; if (!n || seen.has(n)) continue; seen.add(n);
      if (n.closest('#mux-ann, script, style, #loader')) continue;
      const r = visible(n); if (!r) continue;
      const cs = getComputedStyle(n);
      const fs = parseFloat(cs.fontSize);
      let fg = parse(cs.color);
      const clipText = (cs.webkitBackgroundClip || cs.backgroundClip) === 'text';
      const bg = bgOf(n);
      let cr = null;
      if (fg && bg && !clipText) { fg = blend(fg, bg); cr = +ratio(fg, bg).toFixed(2); }
      texts.push({ el: desc(n), text: t.textContent.trim().slice(0, 40), fs, cr, overMap: !bg, weight: cs.fontWeight, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), offscreen: r.left < 0 || r.right > innerWidth });
    }
    return { vw: innerWidth, vh: innerHeight, targets, texts };
  });
}

export function summarize(m) {
  const small = m.targets.filter((t) => !t.covered && (t.w < 44 || t.h < 44));
  return {
    targets: m.targets.length,
    under44: small.length,
    under32: small.filter((t) => t.w < 32 || t.h < 32).length,
    textUnder12: m.texts.filter((t) => t.fs < 12).length,
    lowContrast: m.texts.filter((t) => t.cr != null && t.cr < 4.5).length,
  };
}
