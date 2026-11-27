// Surprise: fly to a remarkable outlier computed live from the loaded data.
import './panels.css';
import { el, fmt } from './dom.js';
import { get } from './panelkit.js';

export class Surprise {
  constructor(app) {
    this.app = app;
    this.picking = false;
    this.recent = [];
    this.card = el('div', { class: 'modal surp glass hidden', role: 'dialog', 'aria-live': 'polite' });
    app.hud.append(this.card);
  }

  // ------------------------------------------------------------------ candidate outliers
  _extreme(rows, f, dir = 1) {
    let best = null, bv = null;
    rows.forEach((r, i) => { const v = f(r); if (v == null || !Number.isFinite(v)) return; if (bv == null || v * dir > bv * dir) { bv = v; best = i; } });
    return best == null ? null : { i: best, v: bv };
  }

  candidates() {
    const { app } = this, ds = app.districts, { world, cells } = app.data, sites = app.sites?.sites || [];
    const out = [];
    const dist = (key, f, dir, emoji, title, caption, src) => {
      const r = this._extreme(ds, f, dir);
      if (r) out.push({ id: key, emoji, title: title(ds[r.i]), caption: caption(ds[r.i], r.v), src, go: () => { app.select({ district: r.i }); app.flyToDistrict(r.i); } });
    };
    const cell = (key, arr, emoji, title, caption, src) => {
      let bc = -1;
      for (let c = 0; c < world.owner.length; c++) if (world.owner[c] >= 0 && arr[c] != null && (bc < 0 || arr[c] > arr[bc])) bc = c;
      if (bc < 0) return;
      const d = ds[world.owner[bc]];
      out.push({ id: key, emoji, title: title(d), caption: caption(arr[bc], d), src, go: () => { app.select({ cell: bc }); app.flyToCell(bc, { distance: 300, tilt: 0.9 }); } });
    };
    const site = (key, s, emoji, title, caption, src) => {
      if (!s) return;
      out.push({ id: key, emoji, title: title(s), caption: caption(s), src: src || s.src, go: () => { app.select({ site: s }); app.flyToSite(s); } });
    };
    const maxSite = (pred, f) => { const xs = sites.filter(pred); const r = this._extreme(xs, f); return r ? xs[r.i] : null; };
    const hexKm2 = app.atlas.nation?.hex_km2;

    cell('top-hex', world.elev_max, '🏔️', (d) => `The roof of Pakistan · ${d.name}`, (v) => `Highest point on the board: ${fmt.int(v)} m above sea level inside a single hex${hexKm2 ? ` (~${fmt.int(hexKm2)} km²)` : ''}.`, 'copernicus_dem');
    cell('dense-hex', cells.density, '🏙️', (d) => `The most crowded hex · ${d.name}`, (v) => `${fmt.int(v)} people per km² — the densest hex in the country.`, 'worldpop');
    site('hottest', sites.find((s) => s.kind === 'heat' && s.facts?.rank_mean_max === 1), '🔥', (s) => `${s.name}: the furnace`,
      (s) => `${s.facts.hottest_month ? `${s.facts.hottest_month} mean max ${s.facts.hottest_month_mean_max_c} °C` : ''}${s.facts.record_high_c ? `; record ${s.facts.record_high_c} °C${s.facts.record_date ? ` (${s.facts.record_date.slice(0, 4)})` : ''}` : ''} — hottest average summer of any listed station.`);
    dist('lit-max', (d) => d.literacy, 1, '📚', (d) => `Most literate: ${d.name}`, (d, v) => `${v.toFixed(1)}% of people aged 10+ can read and write.`, 'census2023');
    dist('lit-min', (d) => d.literacy, -1, '📖', (d) => `Least literate: ${d.name}`, (d, v) => `Only ${v.toFixed(1)}% literacy — the lowest of any district with census data.`, 'census2023');
    dist('mpi', (d) => d.mpi_h, 1, '🪫', (d) => `Deepest poverty: ${d.name}`, (d, v) => `${v.toFixed(1)}% of people are multidimensionally poor (MPI headcount).`, 'mpi');
    dist('langdiv', (d) => d.lang_diversity, 1, '🗣️', (d) => `Tower of Babel: ${d.name}`, (d, v) => `Linguistic diversity index ${v.toFixed(2)} — the most mixed mother tongues of any district.`, 'census2023');
    dist('nonmuslim', (d) => d.non_muslim_pct, 1, '🛕', (d) => `Most religiously diverse: ${d.name}`, (d, v) => `${v.toFixed(1)}% non-Muslim — the highest share in Pakistan.`, 'census2023');
    dist('flood', (d) => d.flood_pct, 1, '🌊', (d) => `Drowned in 2022: ${d.name}`, (d, v) => `${v.toFixed(1)}% of the district was under water at the 2022 flood peak.`, 'unosat_flood');
    dist('mfg', (d) => get(d, 'lq.C'), 1, '🏭', (d) => `Workshop of Pakistan: ${d.name}`, (d, v) => `Manufacturing location quotient ${v.toFixed(2)} — ${v.toFixed(1)}× the national share of manufacturing workers.`, 'econ_census');
    dist('growth', (d) => d.growth, 1, '🚀', (d) => `Fastest growing: ${d.name}`, (d, v) => `Population growing ${v.toFixed(2)}% a year (2017–2023).`, 'census2023');
    dist('crop', (d) => d.cropped_ha, 1, '🌾', (d) => `Breadbasket: ${d.name}`, (d, v) => `${fmt.int(v)} hectares cropped — the largest farmed area of any district.`, 'crops');
    site('power', maxSite((s) => s.kind === 'power', (s) => s.mw), '⚡', (s) => `Biggest power plant: ${s.name}`, (s) => `${fmt.int(s.mw)} MW${s.fuel ? ` of ${s.fuel.toLowerCase()} power` : ''} — the largest installed capacity in the country.`);
    site('solar', maxSite((s) => s.kind === 'power' && s.fuel === 'Solar', (s) => s.mw), '☀️', (s) => `Biggest solar plant: ${s.name}`, (s) => `${fmt.int(s.mw)} MW of photovoltaics — the largest solar plant on the map.`);
    site('airport', maxSite((s) => s.kind === 'airport', (s) => s.pax), '✈️', (s) => `Busiest airport: ${s.name}`, (s) => `${fmt.int(s.pax)} passengers in FY ${s.fy || ''} — more than any other airport.`);
    const eras = sites.filter((s) => s.kind === 'era' && s.year != null);
    const oldest = this._extreme(eras, (s) => s.year, -1);
    if (oldest) site('oldest', eras[oldest.i], '⏳', (s) => `Oldest of all: ${s.name}`, (s) => `c. ${fmt.int(Math.abs(s.year))} ${s.year < 0 ? 'BCE' : 'CE'}${s.facts?.year_note ? ` — ${s.facts.year_note}` : ''}.`);
    site('k2', sites.find((s) => s.id === 'wonder:k2') || sites.find((s) => s.kind === 'wonder' && s.name === 'K2'), '🗻', () => 'K2, the Savage Mountain',
      (s) => `${s.facts?.elevation_m ? `${fmt.int(s.facts.elevation_m)} m` : ''} — the second-highest mountain on Earth${s.facts?.prominence_m ? `, ${fmt.int(s.facts.prominence_m)} m prominence` : ''}.`);
    return out;
  }

  // ------------------------------------------------------------------ show
  go() {
    const all = this.candidates();
    if (!all.length) return;
    let pool = all.filter((c) => !this.recent.includes(c.id));
    if (!pool.length) pool = all;
    const c = pool[Math.floor(Math.random() * pool.length)];
    this.recent.push(c.id); if (this.recent.length > 5) this.recent.shift();
    this.show(c);
    c.go();
  }

  show(c) {
    const { app } = this;
    this.card.replaceChildren(
      el('div', { class: 'surp-emoji', text: c.emoji }),
      el('div', { class: 'surp-kicker', text: 'Remarkable outlier' }),
      el('h3', { class: 'surp-title', text: c.title }),
      el('p', { class: 'surp-cap', text: c.caption }),
      el('div', { class: 'surp-src' }, ['Source: ', el('a', { href: '#', text: app.sourceTitle(c.src), onclick: (e) => { e.preventDefault(); app.ui.almanac?.open(c.src); } })]),
      el('div', { class: 'surp-btns' }, [
        el('button', { class: 'pc-btn gold', text: '🎲 Another!', onclick: () => this.go() }),
        el('button', { class: 'pc-btn', text: 'Close', onclick: () => this.card.classList.add('hidden') }),
      ]),
    );
    this.card.classList.remove('hidden', 'pop'); void this.card.offsetWidth; this.card.classList.add('pop');
  }

  open() { this.go(); }
  pickDistrict() {}
}
