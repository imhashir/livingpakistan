// Lens engine: resolves a lens field per hex, builds a colour scale, paints the board, draws the legend.
import * as THREE from 'three';
import { el, fmt } from './dom.js';

const RAMPS = {
  elev: ['#0d6b5a', '#5f9e4c', '#c9c06d', '#c99a58', '#9b6b4b', '#8a7f78', '#ffffff'],
  green: ['#2b2a1e', '#4d5a24', '#7d9a2f', '#b5d046', '#e8ff7a'],
  forest: ['#2a2a24', '#284d2b', '#2f7a3a', '#4fb35a', '#a6f08a'],
  sand: ['#2e2a26', '#6b5434', '#b78c4d', '#e7c27c', '#fff0c8'],
  ice: ['#22303a', '#3c6a8a', '#7fb2d6', '#cfe9fb', '#ffffff'],
  urban: ['#1f2228', '#4a3f5c', '#8a5a8a', '#d98a7a', '#ffd9a0'],
  magma: ['#140b2e', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  purple: ['#1c1830', '#3e2d6b', '#7046a8', '#b06fd8', '#f0c4ff'],
  blue: ['#2a1a14', '#7a3b22', '#c9853a', '#9fc7a0', '#3fa7d6', '#1d5fb8'],
  red: ['#1e3b2a', '#a4b35a', '#f0c35a', '#e2703a', '#b8242a', '#5a0f1a'],
  gold: ['#1b1609', '#4d3a0d', '#9c7414', '#e0ad2e', '#ffe48a', '#fffbe0'],
  warm: ['#203040', '#4c6a7a', '#c9b07a', '#e88a4a', '#c0392b'],
  flood: ['#3a3226', '#2a5d7a', '#1f8fd0', '#4fd4ff', '#d8fbff'],
  quake: ['#22201c', '#5a2a1a', '#a8361e', '#f05a28', '#ffd23f', '#ffffd0'],
  div: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
};
const CATS = {
  lang: { punjabi: '#f2b134', pashto: '#2a9d8f', sindhi: '#e76f51', saraiki: '#c77dff', urdu: '#48cae4', balochi: '#90be6d',
    brahui: '#6a994e', hindko: '#ff8fab', kashmiri: '#a0c4ff', kohistani: '#bdb2ff', shina: '#ffd6a5', balti: '#caffbf',
    mewati: '#ffc6ff', kalasha: '#fdffb6', others: '#9a9a9a' },
  faith: { christian: '#5aa9e6', hindu: '#ff9f1c', ahmadi: '#2ec4b6', scheduled_castes: '#e71d36', sikh: '#ffbf69', parsi: '#cbf3f0', others: '#a0a0a0' },
  crop: { wheat: '#e9c46a', rice: '#9ad1d4', cotton: '#f1faee', sugarcane: '#80b918', maize: '#f4a261', fodder: '#588157', other: '#999999' },
};
export const LABELS = {
  punjabi: 'Punjabi', pashto: 'Pashto', sindhi: 'Sindhi', saraiki: 'Saraiki', urdu: 'Urdu', balochi: 'Balochi', brahui: 'Brahui',
  hindko: 'Hindko', kashmiri: 'Kashmiri', kohistani: 'Kohistani', shina: 'Shina', balti: 'Balti', mewati: 'Mewati', kalasha: 'Kalasha',
  others: 'Others', christian: 'Christian', hindu: 'Hindu', ahmadi: 'Ahmadi', scheduled_castes: 'Scheduled Castes', sikh: 'Sikh',
  parsi: 'Parsi', wheat: 'Wheat', rice: 'Rice', cotton: 'Cotton', sugarcane: 'Sugarcane', maize: 'Maize', fodder: 'Fodder', other: 'Other',
};

function rampColor(stops, t) {
  t = Math.min(1, Math.max(0, t));
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  return new THREE.Color(stops[i]).lerp(new THREE.Color(stops[i + 1]), f);
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

export class LensEngine {
  constructor(app) {
    this.app = app;
    this.lenses = app.data.atlas.lenses;
    this.current = 'terrain';
  }

  /** Value of the lens at a hex (number | string | null). */
  valueAt(lens, cell) {
    const { world, cells, atlas } = this.app.data;
    const o = world.owner[cell];
    if (o < 0) return null;
    if (lens.level === 'hex') {
      if (lens.field.startsWith('cells.')) return cells[lens.field.slice(6)][cell];
      return get(world, lens.field)?.[cell] ?? null;
    }
    if (lens.level === 'district') return get(atlas.districts[o], lens.field) ?? null;
    return null;
  }

  scaleFor(lens) {
    const vals = [];
    const { world } = this.app.data;
    if (lens.scale === 'cat') {
      const counts = {};
      for (let c = 0; c < world.owner.length; c++) {
        const v = this.valueAt(lens, c); if (v != null) counts[v] = (counts[v] || 0) + 1;
      }
      const pal = CATS[lens.palette] || {};
      return { cat: true, counts, color: (v) => new THREE.Color(pal[v] || '#888888'), pal };
    }
    for (let c = 0; c < world.owner.length; c++) {
      const v = this.valueAt(lens, c); if (v != null && Number.isFinite(v)) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
    const log = lens.scale === 'log';
    const tf = (v) => (log ? Math.log10(Math.max(v, 1e-3)) : v);
    let lo = tf(q(0.02)), hi = tf(q(0.98));
    if (lens.id === 'elevation') { lo = 0; hi = 6000; }
    if (lens.field?.startsWith('pct.') || lens.id === 'flood') { lo = 0; hi = lens.id === 'flood' ? 60 : 100; }
    let norm = (v) => (tf(v) - lo) / (hi - lo || 1);
    if (lens.scale === 'div') {
      const mid = lens.mid ?? (lo + hi) / 2, span = Math.max(hi - mid, mid - lo) || 1;
      norm = (v) => 0.5 + (v - mid) / (2 * span);
    }
    const stops = RAMPS[lens.palette] || RAMPS.viridis;
    return { cat: false, vals, lo, hi, log, norm, color: (v) => rampColor(stops, norm(v)), stops };
  }

  apply(id) {
    const lens = this.lenses.find((l) => l.id === id) || this.lenses[0];
    this.current = lens.id;
    const board = this.app.board;
    if (lens.level === 'none') { board.paintTerrain(); this.scale = null; }
    else {
      const sc = this.scaleFor(lens); this.scale = sc;
      board.paintLens((c) => { const v = this.valueAt(lens, c); return v == null ? null : sc.color(v); });
    }
    this.renderLegend(lens);
    this.app.onLens?.(lens);
    return lens;
  }

  format(lens, v) {
    if (v == null) return 'no data';
    if (lens.scale === 'cat') return LABELS[v] || v;
    if (lens.unit?.startsWith('%') || lens.unit?.includes('% ')) return `${(+v).toFixed(1)}%`;
    if (lens.id === 'gold' || lens.id === 'gdppc') return `$${fmt.big(v)}`;
    if (Math.abs(v) >= 1000) return fmt.big(v);
    return (+v).toFixed(Math.abs(v) < 10 ? 2 : 1);
  }

  renderLegend(lens) {
    const box = this.app.ui.legend;
    if (!box) return;
    if (lens.level === 'none') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const sc = this.scale;
    const head = el('div', { class: 'lg-head' }, [el('b', { text: lens.label }), el('span', { text: lens.unit || '' })]);
    let body;
    if (sc.cat) {
      const items = Object.entries(sc.counts).sort((a, b) => b[1] - a[1]);
      body = el('div', { class: 'lg-cats' }, items.map(([k, n]) => el('button', {
        class: 'lg-cat', onclick: () => this.app.highlightWhere((c) => this.valueAt(lens, c) === k, LABELS[k] || k),
      }, [el('i', { style: { background: sc.pal[k] || '#888' } }), el('span', { text: LABELS[k] || k }), el('em', { text: `${n}` })])));
    } else {
      const cv = el('canvas', { width: 260, height: 54, class: 'lg-hist' });
      const g = cv.getContext('2d');
      const bins = new Array(40).fill(0);
      for (const v of sc.vals) { const t = sc.norm(v); bins[Math.min(39, Math.max(0, Math.floor(t * 40)))]++; }
      const mx = Math.max(...bins);
      bins.forEach((b, i) => {
        const h = (b / mx) * 40; g.fillStyle = '#' + rampColor(sc.stops, (i + 0.5) / 40).getHexString();
        g.fillRect(i * 6.5, 42 - h, 5.5, h);
      });
      const grad = g.createLinearGradient(0, 0, 260, 0);
      sc.stops.forEach((s, i) => grad.addColorStop(i / (sc.stops.length - 1), s));
      g.fillStyle = grad; g.fillRect(0, 46, 260, 8);
      const inv = (t) => { const x = sc.lo + t * (sc.hi - sc.lo); return sc.log ? 10 ** x : x; };
      const lo = lens.scale === 'div' ? null : inv(0), hi = lens.scale === 'div' ? null : inv(1);
      body = el('div', {}, [cv, el('div', { class: 'lg-ends' }, [
        el('span', { text: lo == null ? 'below' : this.format(lens, lo) }),
        el('span', { text: lens.scale === 'div' ? `${lens.mid} = Pakistan` : '' }),
        el('span', { text: hi == null ? 'above' : this.format(lens, hi) + '+' })])]);
      cv.addEventListener('mousemove', (e) => {
        const t = e.offsetX / 260;
        const a = inv(Math.max(0, t - 0.04)), b = inv(Math.min(1, t + 0.04));
        this.app.highlightWhere((c) => { const v = this.valueAt(lens, c); return v != null && v >= a && v <= b; }, null, true);
      });
      cv.addEventListener('mouseleave', () => this.app.highlightWhere(null));
    }
    const srcs = (lens.src || []).map((s) => this.app.sourceTitle(s)).join(' · ');
    box.replaceChildren(head, body, el('p', { class: 'lg-desc', text: lens.desc }),
      el('p', { class: 'lg-src' }, [el('span', { text: 'Source: ' }), el('a', { href: '#', text: srcs, onclick: (e) => { e.preventDefault(); this.app.ui.almanac?.open(lens.src?.[0]); } })]));
  }
}
