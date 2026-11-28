// Explorer: sortable table of all districts + linked scatter plot with brushing, wired to the 3D map.
import './panels.css';
import { el, fmt } from './dom.js';
import { LABELS } from './lenses.js';
import { panel, get, val, fmtNum, PROVINCE_COLORS, pearson, svgEl, NO_DATA } from './panelkit.js';

const lab = (v) => LABELS[v] || (v ? String(v).replace(/_/g, ' ') : v);

const COLUMNS = [
  { key: 'name', label: 'District', str: true },
  { key: 'province', label: 'Province', str: true, f: (v) => v.replace('Khyber Pakhtunkhwa', 'KP').replace('Gilgit Baltistan', 'GB').replace('Azad Kashmir', 'AJK') },
  { key: 'pop', label: 'Pop.', f: fmt.big, title: 'Population (Census 2023; WorldPop 2025 for AJK & GB)' },
  { key: 'density', label: 'Density', f: fmt.int, title: 'People per km²' },
  { key: 'urban_pct', label: 'Urban', f: fmtNum.pct0, title: 'Urban population share (Census 2023)' },
  { key: 'literacy', label: 'Literacy', f: fmtNum.pct0, title: 'Literacy rate, age 10+ (Census 2023)' },
  { key: 'mpi_h', label: 'MPI H', f: fmtNum.pct0, title: 'Multidimensional poverty headcount (% of people poor)' },
  { key: 'gdp_pc', label: 'GDP/pers.', f: fmtNum.usd, title: 'MODELLED GDP per person, PPP Int$ (Kummu et al.)' },
  { key: 'top_language', label: 'Top language', str: true, f: lab },
  { key: 'top_crop', label: 'Top crop', str: true, f: lab },
  { key: 'flood_pct', label: 'Flood', f: fmtNum.pct, title: 'Share of district area flooded at the 2022 peak (UNOSAT)' },
  { key: 'yields.food', label: '🌾', f: fmt.big, title: 'Cropland: cropped hectares' },
  { key: 'yields.production', label: '⚒️', f: fmt.big, title: 'Industry: industry workers' },
  { key: 'yields.gold', label: '🪙', f: fmtNum.usdBig, title: 'Economy: MODELLED GDP (PPP)' },
  { key: 'yields.trade', label: '🐪', f: fmt.big, title: 'Trade: trade/transport/hotel workers' },
  { key: 'yields.science', label: '🔬', f: fmt.big, title: 'Knowledge: ICT/finance/professional/education workers' },
  { key: 'yields.culture', label: '🎭', f: fmt.big, title: 'Culture: arts & recreation workers' },
];

const FIELDS = [
  ['pop', 'Population', fmt.big], ['density', 'Density (people/km²)', fmt.int], ['area_km2', 'Area (km²)', fmt.int],
  ['urban_pct', 'Urban %', fmtNum.pct], ['growth', 'Growth 2017–23 (%/yr)', fmtNum.dec2], ['literacy', 'Literacy %', fmtNum.pct],
  ['literacy_female', 'Female literacy %', fmtNum.pct], ['literacy_male', 'Male literacy %', fmtNum.pct], ['gender_gap', 'Literacy gender gap (pts)', fmtNum.dec1],
  ['hh_size', 'Household size', fmtNum.dec2], ['non_muslim_pct', 'Non-Muslim %', fmtNum.pct], ['lang_diversity', 'Linguistic diversity', fmtNum.dec3],
  ['mpi_h', 'MPI headcount %', fmtNum.pct], ['mpi', 'MPI', fmtNum.dec3], ['gdp', 'GDP, modelled (Int$)', fmtNum.usdBig],
  ['gdp_pc', 'GDP/person, modelled (Int$)', fmtNum.usd], ['flood_pct', 'Flooded 2022 %', fmtNum.pct], ['flood_exposed', 'Flood-exposed people 2022', fmt.big],
  ['elev_mean', 'Mean elevation (m)', fmt.int], ['elev_max', 'Max elevation (m)', fmt.int], ['quakes', 'Historic quakes', fmt.int],
  ['cropped_ha', 'Cropped area (ha)', fmt.big], ['lq.C', 'Manufacturing LQ', fmtNum.dec2],
  ['yields.food', '🌾 Cropland (ha)', fmt.big], ['yields.production', '⚒️ Industry (workers)', fmt.big], ['yields.gold', '🪙 Economy (Int$, modelled)', fmtNum.usdBig],
  ['yields.trade', '🐪 Trade (workers)', fmt.big], ['yields.science', '🔬 Knowledge (workers)', fmt.big], ['yields.culture', '🎭 Culture (workers)', fmt.big],
];
const FIELD = Object.fromEntries(FIELDS.map(([k, l, f]) => [k, { key: k, label: l, f }]));

let W = 560, H = 430; const M = { l: 66, r: 14, t: 14, b: 42 };

const tickFmt = (v) => fmt.big(v).replace(/\.0+(?=[A-Za-z]|$)/, '');

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export class Explorer {
  constructor(app) {
    this.app = app;
    this.picking = false;
    this.sort = { key: 'pop', dir: -1 };
    this.ax = { x: 'gdp_pc', y: 'literacy', logX: true, logY: false };
    this.brush = null; // Set of district indices
    this.hiddenProv = new Set();
    this.hover = null;
    const minBtn = el('button', { class: 'pc-btn', title: 'Minimise / restore', 'aria-label': 'Minimise or restore', text: '▁', onclick: () => this.toggleMin() });
    const p = panel(app, {
      cls: 'exp', title: '📊 Explorer', sub: `${app.districts.length} districts · click a row or point to fly there · drag on the plot to brush`,
      actions: [minBtn], onClose: () => { this._restoreHighlight(true); this.tip.classList.add('hidden'); },
    });
    this.root = p.root;
    // a finger has no drag-to-brush without a hold first (the plot scrolls)
    p.head.querySelector('.pc-sub').replaceChildren(
      el('span', { class: 'only-desk', text: p.head.querySelector('.pc-sub').textContent }),
      el('span', { class: 'only-touch', text: `${app.districts.length} districts · tap a row or point for its card · press and hold the plot, then drag, to brush` }));
    p.head.addEventListener('dblclick', () => this.toggleMin());
    // on a phone the minimised Explorer is a bar above the dock; tapping it brings the table back
    p.head.addEventListener('click', (e) => { if (this.app.mobile?.on && this.root.classList.contains('min') && !e.target.closest('button')) this.toggleMin(); });

    // table
    this.thead = el('thead');
    this.tbody = el('tbody', { onpointerleave: () => this._hover(null) });
    this.tableInfo = el('div', { class: 'exp-info' });
    const tableWrap = el('div', { class: 'exp-table' }, [el('table', {}, [this.thead, this.tbody])]);
    // Phones show three columns: District, the one it is sorted by, and one
    // more of the reader's choosing. Every other figure is in the row's card.
    this.extra = 'pop';
    const colSel = (get, set) => el('select', { class: 'pc-select', onchange: (e) => { set(e.target.value); this.drawTable(); } },
      COLUMNS.map((c) => el('option', { value: c.key, text: c.title ? `${c.label} · ${c.title.split(' (')[0]}` : c.label, selected: get() === c.key ? true : null })));
    this.sortSel = colSel(() => this.sort.key, (k) => { const c = COLUMNS.find((x) => x.key === k); this.sort = { key: k, dir: c?.str ? 1 : -1 }; });
    this.extraSel = colSel(() => this.extra, (k) => { this.extra = k; });
    this.dirBtn = el('button', { class: 'pc-btn', title: 'Reverse the order', 'aria-label': 'Reverse the order', onclick: () => { this.sort = { ...this.sort, dir: -this.sort.dir }; this.drawTable(); } });
    const phoneCols = el('div', { class: 'exp-mcols only-touch' }, [
      el('label', {}, [el('span', { text: 'Sort' }), this.sortSel, this.dirBtn]),
      el('label', {}, [el('span', { text: 'Also' }), this.extraSel]),
    ]);

    // scatter controls
    const sel = (axis) => el('select', { class: 'pc-select', onchange: (e) => { this.ax[axis] = e.target.value; this.clearBrush(false); this.drawPlot(); } },
      FIELDS.map(([k, l]) => el('option', { value: k, text: l, selected: this.ax[axis] === k ? true : null })));
    const logT = (k) => el('label', { class: 'pc-check', title: 'Logarithmic axis (non-positive values are dropped)' }, [
      el('input', { type: 'checkbox', checked: this.ax[k] ? true : null, onchange: (e) => { this.ax[k] = e.target.checked; this.clearBrush(false); this.drawPlot(); } }), 'log']);
    this.selX = sel('x'); this.selY = sel('y');
    this.rEl = el('div', { class: 'exp-r' });
    this.svg = svgEl('svg', { class: 'exp-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMin meet' });
    this.legend = el('div', { class: 'exp-legend' });
    const plot = el('div', { class: 'exp-plot' }, [
      el('div', { class: 'exp-axes' }, [
        el('label', {}, [el('span', { text: 'Y' }), this.selY, logT('logY')]),
        el('label', {}, [el('span', { text: 'X' }), this.selX, logT('logX')]),
      ]),
      this.svg,
      el('div', { class: 'exp-under' }, [this.rEl, el('button', { class: 'pc-btn small', text: 'Clear brush', onclick: () => this.clearBrush() })]),
      this.legend,
    ]);
    p.body.append(el('div', { class: 'exp-grid' }, [el('div', { class: 'exp-left' }, [phoneCols, this.tableInfo, tableWrap]), plot]));
    this.tip = el('div', { class: 'pc-tip glass hidden' });
    app.hud.append(this.tip);
    this._bindBrush();
    let rt = null;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (!this.root.classList.contains('hidden') && !this.root.classList.contains('min')) this.drawPlot(); }, 80); }).observe(this.svg);
    this.drawLegend();
  }

  // ------------------------------------------------------------------ open / minimise
  open(opts = {}) {
    if (opts.sortBy) {
      const col = COLUMNS.find((c) => c.key === opts.sortBy);
      this.sort = { key: opts.sortBy, dir: col?.str ? 1 : -1 };
      if (FIELD[opts.sortBy]) { this.ax.y = opts.sortBy; this.selY.value = opts.sortBy; this.ax.logY = /yields|pop|gdp|density|cropped/.test(opts.sortBy); this.root.querySelectorAll('.exp-axes input')[0].checked = this.ax.logY; }
    }
    this.root.classList.remove('hidden', 'min');
    this.drawTable(); this.drawPlot();
    this.tbody.parentElement.parentElement.scrollTop = 0;
  }

  toggleMin() { this.root.classList.toggle('min'); this.tip.classList.add('hidden'); }

  // ------------------------------------------------------------------ table
  visibleRows() {
    const ds = this.app.districts;
    let idx = ds.map((_, i) => i).filter((i) => !this.hiddenProv.has(ds[i].province));
    if (this.brush) idx = idx.filter((i) => this.brush.has(i));
    const { key, dir } = this.sort, col = COLUMNS.find((c) => c.key === key);
    const v = (i) => { const x = get(ds[i], key); return col?.str && x != null ? String(col.f ? col.f(x) : x) : x; };
    idx.sort((a, b) => {
      const va = v(a), vb = v(b);
      if (va == null && vb == null) return ds[a].name.localeCompare(ds[b].name);
      if (va == null) return 1; if (vb == null) return -1; // nulls always last
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
    });
    return idx;
  }

  /** The columns on screen: all of them, or on a phone District + sort + one more. */
  _cols() {
    if (!this.app.mobile?.on) return COLUMNS;
    const keep = new Set(['name', this.sort.key, this.extra]);
    return COLUMNS.filter((c) => keep.has(c.key));
  }

  drawTable() {
    const cols = this._cols();
    if (this.sortSel) { this.sortSel.value = this.sort.key; this.extraSel.value = this.extra; this.dirBtn.textContent = this.sort.dir > 0 ? '▲' : '▼'; }
    this.thead.replaceChildren(el('tr', {}, [el('th', { class: 'rk', text: '#' }), ...cols.map((c) => el('th', {
      class: `${c.str ? 'str' : 'num'}${this.sort.key === c.key ? ' on' : ''}`, title: c.title ? `${c.title} — click to sort` : 'Click to sort',
      onclick: () => { this.sort = this.sort.key === c.key ? { key: c.key, dir: -this.sort.dir } : { key: c.key, dir: c.str ? 1 : -1 }; this.drawTable(); },
    }, [c.label, this.sort.key === c.key ? el('i', { text: this.sort.dir > 0 ? ' ▲' : ' ▼' }) : '']))]));
    const ds = this.app.districts;
    const rows = this.visibleRows();
    this.tbody.replaceChildren(...rows.map((i, r) => el('tr', {
      'data-i': i, class: this.hover === i ? 'hov' : null,
      onpointerenter: (e) => this._hover(i, e.clientX, e.clientY, 'row'),
      onclick: () => this._choose(i),
    }, [el('td', { class: 'rk', text: r + 1 }), ...cols.map((c) => {
      const v = get(ds[i], c.key);
      if (c.key === 'name') return el('td', { class: 'str nm' }, [el('i', { class: 'sw', style: { background: PROVINCE_COLORS[ds[i].province] } }), v]);
      return val(v, c.f || String, 'td');
    }).map((td, k) => { td.classList.add(cols[k].str ? 'str' : 'num'); return td; })])));
    this.tableInfo.textContent = this.brush
      ? `Brushed: ${rows.length} district${rows.length === 1 ? '' : 's'} (union highlighted on the map)`
      : `${rows.length} districts${this.hiddenProv.size ? ` · ${this.hiddenProv.size} province(s) hidden` : ''} · “—” = no data published`;
  }

  // ------------------------------------------------------------------ scatter
  _points() {
    const ds = this.app.districts, { x, y, logX, logY } = this.ax;
    const pts = [];
    ds.forEach((d, i) => {
      if (this.hiddenProv.has(d.province)) return;
      const vx = get(d, x), vy = get(d, y);
      if (vx == null || vy == null || !Number.isFinite(vx) || !Number.isFinite(vy)) return;
      if ((logX && vx <= 0) || (logY && vy <= 0)) return;
      pts.push({ i, vx, vy, tx: logX ? Math.log10(vx) : vx, ty: logY ? Math.log10(vy) : vy });
    });
    return pts;
  }

  drawPlot() {
    const box = this.svg.getBoundingClientRect();
    if (box.width > 50 && box.height > 50) { W = Math.round(box.width); H = Math.round(box.height); this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`); }
    const { x, y, logX, logY } = this.ax, fx = FIELD[x], fy = FIELD[y];
    const pts = this._points();
    this.pts = pts;
    const ext = (k) => { let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); } if (!pts.length) return [0, 1]; if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.04; return [lo - pad, hi + pad]; };
    const [x0, x1] = ext('tx'), [y0, y1] = ext('ty');
    const sx = (t) => M.l + ((t - x0) / (x1 - x0)) * (W - M.l - M.r);
    const sy = (t) => H - M.b - ((t - y0) / (y1 - y0)) * (H - M.t - M.b);
    this.scale = { sx, sy, x0, x1, y0, y1 };
    const ticks = (lo, hi, log) => {
      if (!log) return niceTicks(lo, hi).map((v) => [v, v]);
      const out = [];
      for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) for (const m of (hi - lo < 1.6 ? [1, 2, 5] : [1])) { const t = e + Math.log10(m); if (t >= lo && t <= hi) out.push([t, 10 ** t]); }
      return out;
    };
    const g = [];
    for (const [t, v] of ticks(x0, x1, logX)) g.push(svgEl('line', { class: 'grid', x1: sx(t), x2: sx(t), y1: M.t, y2: H - M.b }), svgEl('text', { class: 'tick', x: sx(t), y: H - M.b + 15, 'text-anchor': 'middle', text: tickFmt(v) }));
    for (const [t, v] of ticks(y0, y1, logY)) g.push(svgEl('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: sy(t), y2: sy(t) }), svgEl('text', { class: 'tick', x: M.l - 6, y: sy(t) + 4, 'text-anchor': 'end', text: tickFmt(v) }));
    g.push(svgEl('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }), svgEl('line', { class: 'axis', x1: M.l, x2: M.l, y1: M.t, y2: H - M.b }));
    g.push(svgEl('text', { class: 'alabel', x: (M.l + W - M.r) / 2, y: H - 6, 'text-anchor': 'middle', text: `${fx.label}${logX ? ' · log' : ''}` }));
    g.push(svgEl('text', { class: 'alabel', x: -(M.t + H - M.b) / 2, y: 14, transform: 'rotate(-90)', 'text-anchor': 'middle', text: `${fy.label}${logY ? ' · log' : ''}` }));
    this.bg = svgEl('rect', { class: 'bg', x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b });
    const ds = this.app.districts;
    this.dots = new Map();
    const dots = pts.map((p) => {
      const c = svgEl('circle', {
        class: `pt${this.brush && !this.brush.has(p.i) ? ' dim' : ''}${this.brush?.has(p.i) ? ' sel' : ''}`, cx: sx(p.tx), cy: sy(p.ty), r: 5, fill: PROVINCE_COLORS[ds[p.i].province] || '#999',
        onpointerenter: (e) => this._hover(p.i, e.clientX, e.clientY, 'pt'), onpointerleave: () => this._hover(null),
        onclick: (e) => { e.stopPropagation(); this._choose(p.i); },
      });
      this.dots.set(p.i, c);
      return c;
    });
    this.brushRect = svgEl('rect', { class: 'brush hidden' });
    this.svg.replaceChildren(...g, this.bg, ...dots, this.brushRect);
    const r = pearson(pts.map((p) => p.tx), pts.map((p) => p.ty));
    const missing = this.app.districts.length - pts.length - [...this.hiddenProv].reduce((a, pv) => a + ds.filter((d) => d.province === pv).length, 0);
    this.rEl.replaceChildren(
      el('span', { class: 'exp-rv', title: 'Pearson correlation of the plotted (log-transformed where log is on) values' }, ['Pearson r = ', r == null ? el('span', { class: 'nd', title: NO_DATA, text: '—' }) : el('b', { text: r.toFixed(2) })]),
      el('span', { class: 'exp-n', text: ` · n = ${pts.length}${missing > 0 ? ` (${missing} without data)` : ''}` }),
    );
  }

  drawLegend() {
    const ds = this.app.districts;
    this.legend.replaceChildren(...Object.entries(PROVINCE_COLORS).map(([pv, c]) => el('button', {
      class: `exp-lg${this.hiddenProv.has(pv) ? ' off' : ''}`, title: 'Click to show/hide this province',
      onclick: () => { this.hiddenProv.has(pv) ? this.hiddenProv.delete(pv) : this.hiddenProv.add(pv); this.drawLegend(); this.drawTable(); this.drawPlot(); },
    }, [el('i', { class: 'sw', style: { background: c } }), `${pv} (${ds.filter((d) => d.province === pv).length})`])));
  }

  // ------------------------------------------------------------------ brush
  _svgPoint(e) {
    const pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = this.svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: Math.max(M.l, Math.min(W - M.r, p.x)), y: Math.max(M.t, Math.min(H - M.b, p.y)) };
  }

  _bindBrush() {
    // A mouse brushes on drag. A finger scrolls the panel on drag (the plot
    // is touch-action: pan-y on phones) and brushes only after a ~300 ms hold.
    let start = null, armed = null, hold = 0;
    const HOLD_MS = 300, SLOP = 8;
    const disarm = () => { clearTimeout(hold); armed = null; };
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target.classList?.contains('pt') || e.button !== 0) return;
      if (e.pointerType === 'touch') {
        disarm();
        armed = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
        hold = setTimeout(() => {
          if (!armed) return;
          start = this._svgPoint(armed);
          try { this.svg.setPointerCapture(armed.pointerId); } catch { /* the finger already lifted */ }
          this.svg.classList.add('brushing'); navigator.vibrate?.(8);
          this.tip.classList.add('hidden');
        }, HOLD_MS);
        return;
      }
      start = this._svgPoint(e); this.svg.setPointerCapture(e.pointerId);
      this.tip.classList.add('hidden');
    });
    // once the hold has armed the brush, the finger's moves draw it instead of scrolling
    this.svg.addEventListener('touchmove', (e) => { if (start) e.preventDefault(); }, { passive: false });
    this.svg.addEventListener('pointercancel', () => {
      disarm(); this.svg.classList.remove('brushing');
      if (start) { start = null; this.brushRect.classList.add('hidden'); }
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (armed && !start && Math.hypot(e.clientX - armed.clientX, e.clientY - armed.clientY) > SLOP) disarm();
      if (!start) return;
      const p = this._svgPoint(e);
      Object.entries({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }).forEach(([k, v]) => this.brushRect.setAttribute(k, v));
      this.brushRect.classList.remove('hidden');
    });
    this.svg.addEventListener('pointerup', (e) => {
      // a quick tap on the plot clears the brush, as a click does
      if (armed && !start) { disarm(); if (this.brush) this.clearBrush(); return; }
      disarm(); this.svg.classList.remove('brushing');
      if (!start) return;
      const p = this._svgPoint(e), a = start; start = null;
      if (Math.abs(p.x - a.x) < 4 && Math.abs(p.y - a.y) < 4) { this.clearBrush(); return; }
      const [xa, xb] = [Math.min(a.x, p.x), Math.max(a.x, p.x)], [ya, yb] = [Math.min(a.y, p.y), Math.max(a.y, p.y)];
      const { sx, sy } = this.scale;
      this.brush = new Set(this.pts.filter((q) => { const X = sx(q.tx), Y = sy(q.ty); return X >= xa && X <= xb && Y >= ya && Y <= yb; }).map((q) => q.i));
      // on a phone, a box that caught nothing is a miss, not an empty table
      if (!this.brush.size && this.app.mobile?.on) { this.clearBrush(); return; }
      for (const [i, c] of this.dots) { c.classList.toggle('dim', !this.brush.has(i)); c.classList.toggle('sel', this.brush.has(i)); }
      this.drawTable();
      this._restoreHighlight();
    });
  }

  clearBrush(redraw = true) {
    this.brush = null;
    if (redraw) { this.drawTable(); this.drawPlot(); }
    this._restoreHighlight();
  }

  // ------------------------------------------------------------------ map linking
  _restoreHighlight(closing = false) {
    const { app } = this;
    if (!closing && this.brush?.size) { app.board.setHighlight([...this.brush].flatMap((i) => app.districts[i].cells)); return; }
    const s = app.selection;
    if (s?.district != null) app.board.setHighlight(app.districts[s.district].cells);
    else if (s?.cell != null) app.board.setHighlight([s.cell]);
    else if (s?.site?.kind === 'city') { const pcs = new Set(s.site.pcodes || []); app.board.setHighlight(app.districts.filter((d) => pcs.has(d.pcode)).flatMap((d) => d.cells)); }
    else app.board.setHighlight(null);
  }

  _hover(i, cx, cy, from) {
    const prev = this.hover;
    this.hover = i;
    if (prev != null) { this.dots?.get(prev)?.classList.remove('hov'); this.tbody.querySelector(`tr[data-i="${prev}"]`)?.classList.remove('hov'); }
    if (i == null) { this.tip.classList.add('hidden'); this._restoreHighlight(); return; }
    const d = this.app.districts[i];
    this.app.board.setHighlight(d.cells);
    const dot = this.dots?.get(i);
    if (dot) { dot.classList.add('hov'); dot.parentNode.appendChild(dot); }
    this.tbody.querySelector(`tr[data-i="${i}"]`)?.classList.add('hov');
    const fx = FIELD[this.ax.x], fy = FIELD[this.ax.y];
    const row = (k, v, f) => el('div', { class: 'tip-row' }, [el('span', { text: k }), val(v, f, 'b')]);
    this.tip.replaceChildren(
      el('div', { class: 'tip-title', text: d.name }), el('div', { class: 'tip-sub', text: d.province }),
      row(fx.label, get(d, fx.key), fx.f), row(fy.label, get(d, fy.key), fy.f), row('Population', d.pop, fmt.big),
    );
    let x = cx, y = cy;
    if (from === 'pt' && dot) { const b = dot.getBoundingClientRect(); x = b.right; y = b.top; }
    if (from === 'row') { const tr = this.tbody.querySelector(`tr[data-i="${i}"]`)?.getBoundingClientRect(); const pl = this.svg.getBoundingClientRect(); if (tr) { x = pl.left - 250; y = tr.top - 10; } if (dot) { const b = dot.getBoundingClientRect(); x = b.right; y = b.top; } }
    const w = 240, h = 110;
    const px = x + 14 + w > innerWidth ? x - w - 14 : x + 14, py = Math.max(8, Math.min(innerHeight - h - 8, y - 8));
    this.tip.style.transform = `translate(${px}px, ${py}px)`;
    this.tip.classList.remove('hidden');
  }

  _choose(i) {
    // on a phone the card opens over the map; the Explorer folds to a bar
    // above the dock, keeping its sort, scroll and brush for the next pick
    if (this.app.mobile?.on) { this.root.classList.add('min'); this.tip.classList.add('hidden'); }
    this.app.select({ district: i });
    this.app.flyToDistrict(i);
  }

  go() {}
  pickDistrict() {}
}
