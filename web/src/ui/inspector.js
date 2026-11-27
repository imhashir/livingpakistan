// Right-hand inspector: hex "micro-civilisation" card, district dossier, City View and site cards.
import { el, fmt } from './dom.js';
import { LABELS } from './lenses.js';
import { KIND_META } from '../scene/sites.js';

const SECTION_ICON = { A: '🧑‍🌾', B: '⛏️', C: '🏭', D: '⚡', E: '🚰', F: '👷', G: '🛒', H: '🚚', I: '🍽️', J: '💻', K: '🏦', L: '🏠',
  M: '🔬', N: '🗂️', O: '🏛️', P: '🧑‍🏫', Q: '🩺', R: '🎭', S: '✂️' };
const TERRAIN_NAME = { farmland: 'Irrigated farmland', farm_mixed: 'Mixed farmland', forest: 'Forest', forest_mtn: 'Forested mountains',
  mountain: 'Mountains', glacier: 'Glacier & snowfield', urban: 'City', marsh: 'Wetland & mangrove', hills: 'Hills', desert: 'Desert',
  steppe: 'Steppe & grassland', scrub: 'Scrubland', lake: 'Lake', sea: 'Sea' };

export class Inspector {
  constructor(app) {
    this.app = app;
    this.root = el('div', { class: 'inspector glass hidden' });
    app.hud.append(this.root);
    // national ranks for yields
    this.ranks = {};
    for (const k of Object.keys(app.atlas.yields)) {
      const sorted = app.districts.map((d, i) => [i, d.yields?.[k]]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
      this.ranks[k] = new Map(sorted.map(([i], r) => [i, r + 1]));
    }
  }

  hide() { this.root.classList.add('hidden'); }

  show(sel) {
    if (!sel) return this.hide();
    let parts;
    if (sel.site?.kind === 'city') parts = this.cityView(sel.site);
    else if (sel.site) parts = this.siteCard(sel.site);
    else if (sel.district != null) parts = this.districtCard(sel.district);
    else if (sel.cell != null) parts = this.hexCard(sel.cell);
    if (!parts) return this.hide();
    this.root.replaceChildren(...parts);
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    // retrigger slide-in
    this.root.style.animation = 'none'; void this.root.offsetWidth; this.root.style.animation = '';
  }

  // ---------------------------------------------------------------- helpers
  hero(kicker, title, sub) {
    return el('div', { class: 'insp-hero' }, [el('div', { class: 'insp-kicker', text: kicker }), el('div', { class: 'insp-title', text: title }),
      sub ? el('div', { class: 'insp-sub', text: sub }) : '', el('button', { class: 'insp-close', title: 'Close (Esc)', text: '✕', onclick: () => this.app.select(null) })]);
  }
  sec(title, ...kids) { return el('div', { class: 'insp-sec' }, [el('h4', { text: title }), ...kids]); }
  kv(rows) {
    return el('div', { class: 'kv' }, rows.filter(Boolean).flatMap(([k, v, title]) => [el('span', { text: k }),
      v == null || v === '—' ? el('b', { class: 'nd', text: '—', title: title || 'no data published for this area' }) : el('b', { text: v, title: title || '' })]));
  }
  bars(items, fmtv = (v) => fmt.pct(v, 1)) {
    const mx = Math.max(...items.map((x) => x[1]), 1e-9);
    return el('div', { class: 'bars' }, items.map(([k, v, raw]) => el('div', { class: 'bar' }, [
      el('span', { text: k }), el('div', { class: 't' }, [el('i', { style: { width: `${(100 * v) / mx}%` } })]), el('span', { class: 'n', text: fmtv(v, raw) })])));
  }
  src(...ids) {
    return el('div', { class: 'src-note' }, ['Source: ', ...ids.flatMap((id, k) => [k ? ' · ' : '', el('a', { href: '#', text: this.app.sourceTitle(id), onclick: (e) => { e.preventDefault(); this.app.ui.almanac.open(id); } })])]);
  }
  actions(btns) { return el('div', { class: 'insp-actions' }, btns.map(([label, fn]) => el('button', { class: 'tb-btn', onclick: fn }, [label]))); }

  yieldCards(d, i) {
    const Y = this.app.atlas.yields;
    return el('div', { class: 'yrow' }, Object.entries(Y).map(([k, y]) => {
      const v = d.yields?.[k], r = this.ranks[k].get(i);
      return el('div', { class: 'ycard', title: y.def }, [el('div', { class: 'i', text: y.icon }),
        el('div', { class: 'v', text: v == null ? '—' : (k === 'gold' ? '$' : '') + fmt.big(v) }), el('div', { class: 'k', text: y.label }),
        r ? el('div', { class: 'rank', text: `#${r} of ${this.ranks[k].size}` }) : '']);
    }));
  }

  citizens(wf) {
    // 40 little figures, one per 2.5% of the district's Economic Census workforce
    if (!wf?.total) return el('div', { class: 'src-note', text: 'No Economic Census tables for this area.' });
    const secs = Object.entries(wf).filter(([s]) => s !== 'total' && s !== 'U' && s !== 'X').sort((a, b) => b[1] - a[1]);
    const out = []; let acc = 0;
    for (const [s, v] of secs) {
      const n = Math.round(((acc + v) / wf.total) * 40) - Math.round((acc / wf.total) * 40); acc += v;
      for (let k = 0; k < n; k++) out.push(el('span', { title: `${this.app.atlas.sections[s]}: ${fmt.int(v)} workers`, text: SECTION_ICON[s] || '🧍' }));
    }
    return el('div', {}, [el('div', { class: 'citizens' }, out),
      el('div', { class: 'src-note', text: `Each figure ≈ 2.5% of ${fmt.int(wf.total)} workers counted in establishments (Economic Census 2023; excludes farms & households).` })]);
  }

  sparkline(series, labels) {
    const w = 320, h = 46, mx = Math.max(...series, 1e-9);
    const pts = series.map((v, k) => [8 + (k * (w - 16)) / (series.length - 1), h - 6 - (v / mx) * (h - 14)]);
    const svg = `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="M${pts.map((p) => p.join(',')).join('L')}L${w - 8},${h - 4}L8,${h - 4}Z" fill="rgba(79,195,224,0.18)"/>
      <path d="M${pts.map((p) => p.join(',')).join('L')}" fill="none" stroke="#4fc3e0" stroke-width="2"/>
      ${pts.map((p, k) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#bff3ff"><title>${labels[k]}: ${fmt.int(series[k])} km²</title></circle>`).join('')}</svg>`;
    return el('div', { html: svg });
  }

  nearest(xy, kinds, n = 1, maxKm = 1e9) {
    return this.app.sites.sites.filter((s) => kinds.includes(s.kind))
      .map((s) => [s, Math.hypot(s.xy[0] - xy[0], s.xy[1] - xy[1])]).filter(([, d]) => d <= maxKm)
      .sort((a, b) => a[1] - b[1]).slice(0, n);
  }

  // ---------------------------------------------------------------- hex card
  hexCard(cell) {
    const app = this.app, i = app.cellInfo(cell);
    if (!i.district) return null;
    const di = i.owner, xy = app.board.grid.center(cell);
    const [city, cd] = this.nearest(xy, ['city'])[0] || [];
    const [won, wd] = this.nearest(xy, ['wonder', 'unesco'])[0] || [];
    const lensRows = app.atlas.lenses.filter((l) => l.level === 'hex').map((l) => [l.label, app.lens.format(l, app.lens.valueAt(l, cell))]);
    const pct = app.data.world.pct;
    const cover = ['crop', 'tree', 'bare', 'snow', 'built', 'grass', 'shrub', 'water'].map((k) => [k, pct[k]?.[cell] || 0]).filter(([, v]) => v > 2).sort((a, b) => b[1] - a[1]);
    const qn = app.data.cells.quake_n[cell];
    return [
      this.hero(`Hex #${cell} · 260 km²`, TERRAIN_NAME[i.terrain] || i.terrain, `${i.district.name}, ${i.district.province}`),
      this.sec('Micro-civilisation', this.kv([
        ['Elevation (mean)', `${fmt.int(i.elev)} m`], ['Highest point', `${fmt.int(i.elevMax)} m`],
        ['People', fmt.int(i.pop), i.district.pop_basis === 'census2023' ? 'WorldPop 2025 grid scaled to Census 2023' : 'WorldPop 2025 (no census tables here)'],
        ['Density', i.density == null ? null : `${fmt.int(i.density)} / km²`],
        ['Gold (modelled GDP)', i.gdp ? `$${fmt.big(i.gdp)}` : null, 'Kummu et al. gridded GDP 2024 (PPP) — a model'],
        ['2022 flood', i.flood > 0 ? `${i.flood.toFixed(1)}% of land under water` : 'not flooded'],
        ['Quakes M4.5+ (since 1902)', qn ? `${qn} epicentres` : 'none recorded'],
        city ? ['Nearest city', `${city.name} · ${fmt.int(cd)} km`] : null,
        won ? ['Nearest wonder', `${won.name} · ${fmt.int(wd)} km`] : null,
      ])),
      cover.length ? this.sec('Land cover', this.bars(cover.map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]), (v) => `${v}%`)) : '',
      this.sec('Lens readings', this.kv(lensRows)),
      this.src('copernicus_dem', 'esa_worldcover', 'worldpop', 'gdp_grid', 'unosat_flood'),
      this.actions([['📍 District dossier', () => app.select({ district: di })], ['🎯 Zoom here', () => app.flyToCell(cell, { distance: 240, tilt: 0.95 })]]),
    ];
  }

  // ---------------------------------------------------------------- district card
  districtCard(di) {
    const app = this.app, d = app.districts[di];
    const lang = d.language ? Object.entries(d.language).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
    const ltot = lang.reduce((s, [, v]) => s + v, 0) || 1;
    const rel = d.religion ? Object.entries(d.religion).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
    const rtot = rel.reduce((s, [, v]) => s + v, 0) || 1;
    const crops = d.crops ? Object.entries(d.crops).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    const ctot = d.cropped_ha || 1;
    const periods = app.atlas.flood_periods || [];
    return [
      this.hero(`District · ${d.province}`, d.name, `${fmt.int(d.area_km2)} km² · ${d.cells.length} hexes · P-code ${d.pcode}`),
      d.specials?.length ? this.sec('Specialisations', el('div', { class: 'badges' }, d.specials.map((s) => el('span', { class: 'badge', title: `Location quotient ${s.lq} · ${fmt.int(s.workers)} workers` }, [s.icon, s.label, el('em', { text: `×${s.lq}` })]))),
        el('div', { class: 'src-note', text: 'Rule: workforce location quotient ≥ 1.4 with ≥ 2,000 workers (or ≥ 3 with ≥ 300), Economic Census 2023.' })) : '',
      this.sec('Yields', this.yieldCards(d, di)),
      this.sec('People', this.kv([
        ['Population', d.pop == null ? null : fmt.int(d.pop), d.pop_basis === 'census2023' ? 'Census 2023 (PBS)' : 'WorldPop 2025 model — no census tables for AJK/GB'],
        ['Density', d.density == null ? null : `${fmt.int(d.density)} / km²`], ['Urban', d.urban_pct == null ? null : fmt.pct(d.urban_pct)],
        ['Growth 2017→23', d.growth == null ? null : `${d.growth.toFixed(2)}% / yr`], ['Household size', d.hh_size == null ? null : d.hh_size.toFixed(1)],
        ['Literacy (10+)', d.literacy == null ? null : fmt.pct(d.literacy)],
        ['  ♂ / ♀', d.literacy_male == null ? null : `${d.literacy_male.toFixed(1)}% / ${d.literacy_female.toFixed(1)}%`],
        ['Poverty (MPI headcount)', d.mpi_h == null ? null : `${d.mpi_h.toFixed(1)}%${d.mpi_note ? ' *' : ''}`, d.mpi_note || 'MPI 2019-20'],
        ['Gold per person', d.gdp_pc ? `$${fmt.int(d.gdp_pc)}` : null, 'Modelled GDP (PPP) ÷ population'],
      ]), this.src('census2023', 'mpi', 'gdp_grid')),
      lang.length ? this.sec('Mother tongues', this.bars(lang.slice(0, 6).map(([k, v]) => [LABELS[k] || k, (100 * v) / ltot]))) : '',
      rel.length ? this.sec('Faith', this.bars(rel.slice(0, 5).map(([k, v]) => [LABELS[k] || (k === 'muslim' ? 'Muslim' : k), (100 * v) / rtot]), (v) => (v < 1 ? v.toFixed(2) + '%' : v.toFixed(1) + '%'))) : '',
      this.sec('Citizens at work', this.citizens(d.workforce)),
      crops.length ? this.sec('Fields (Agricultural Census 2024)', this.bars(crops.map(([k, v]) => [LABELS[k] || k, (100 * v) / ctot])), this.src('crops')) : '',
      d.flood_series ? this.sec('2022 mega-flood', this.kv([['Max flooded (Aug)', `${fmt.int(d.flood_series[0])} km²`], ['Share of district', d.flood_pct == null ? null : fmt.pct(d.flood_pct)],
        ['People potentially exposed', fmt.int(d.flood_exposed)]]), this.sparkline(d.flood_series, periods), this.src('unosat_flood')) : '',
      this.sec('Terrain', this.kv([['Mean elevation', d.elev_mean == null ? null : `${fmt.int(d.elev_mean)} m`], ['Highest hex peak', d.elev_max == null ? null : `${fmt.int(d.elev_max)} m`], ['Quakes M4.5+ since 1902', String(d.quakes)]])),
      this.actions([['🎯 Fly here', () => app.flyToDistrict(di)], ['⚔️ Duel', () => app.duel.open?.(di)], ['📊 Explorer', () => app.explorer.open()]]),
    ];
  }

  // ---------------------------------------------------------------- City View
  cityView(c) {
    const app = this.app;
    const idx = (c.pcodes || []).map((p) => app.districtIndex(p)).filter((i) => i >= 0);
    const ds = idx.map((i) => app.districts[i]);
    const wf = {};
    for (const d of ds) if (d.workforce) for (const [k, v] of Object.entries(d.workforce)) wf[k] = (wf[k] || 0) + v;
    const specials = new Map();
    for (const d of ds) for (const s of d.specials || []) if (!specials.has(s.id) || specials.get(s.id).lq < s.lq) specials.set(s.id, s);
    const sum = (k) => ds.reduce((a, d) => a + (d.yields?.[k] || 0), 0);
    const near = this.nearest(c.xy, ['wonder', 'unesco', 'university', 'shrine', 'craft', 'cricket', 'water', 'power', 'airport', 'port', 'era'], 9, 60);
    const peers = app.sites.sites.filter((s) => s.kind === 'city' && s !== c && s.pop).sort((a, b) => Math.abs(Math.log(a.pop / (c.pop || 1))) - Math.abs(Math.log(b.pop / (c.pop || 1)))).slice(0, 4);
    const rank = c.pop ? app.sites.cities.filter((s) => (s.pop || 0) > c.pop).length + 1 : null;
    const badge = [...specials.values()].sort((a, b) => b.lq - a.lq)[0];
    return [
      this.hero(`City View${rank ? ` · #${rank} by population` : ''}${c.capital ? ' · capital' : ''}`, c.name,
        `${c.pop ? fmt.int(c.pop) + ' people (Census 2023 urban localities)' : 'Population not covered by Census 2023'}${badge ? ` · ${badge.icon} ${badge.label} city` : ''}`),
      this.sec('Metro yields (its districts)', el('div', { class: 'yrow' }, Object.entries(app.atlas.yields).map(([k, y]) => el('div', { class: 'ycard', title: y.def }, [
        el('div', { class: 'i', text: y.icon }), el('div', { class: 'v', text: ds.length ? (k === 'gold' ? '$' : '') + fmt.big(sum(k)) : '—' }), el('div', { class: 'k', text: y.label })])))),
      specials.size ? this.sec('City districts', el('div', { class: 'badges' }, [...specials.values()].map((s) => el('span', { class: 'badge', title: `LQ ${s.lq}` }, [s.icon, s.label, el('em', { text: `×${s.lq}` })])))) : '',
      this.sec('Citizens', this.citizens(wf.total ? wf : null)),
      near.length ? this.sec('Within 60 km', el('div', { class: 'kv' }, near.flatMap(([s, d]) => [
        el('span', { text: `${KIND_META[s.kind]?.icon || '•'} ${s.name}` }), el('b', { text: `${fmt.int(d)} km` })]))) : '',
      peers.length ? this.sec('Peer cities', el('div', { class: 'badges' }, peers.map((p) => el('button', { class: 'badge', onclick: () => { app.select({ site: p }); app.flyToSite(p, { distance: 420 }); } }, [p.name, el('em', { text: fmt.big(p.pop) })])))) : '',
      el('div', { class: 'insp-sec' }, [el('div', { class: 'src-note', html: `Districts: ${ds.map((d) => d.name).join(', ') || '—'}.` }), this.src('cities', 'econ_census', 'census2023')]),
      this.actions([['🎯 Fly in', () => app.flyToSite(c, { distance: 300, tilt: 1.0 })], ...idx.slice(0, 1).map((i) => ['📍 District', () => app.select({ district: i })])]),
    ];
  }

  // ---------------------------------------------------------------- generic site
  siteCard(s) {
    const app = this.app, meta = KIND_META[s.kind] || { icon: '•', label: s.kind };
    const f = s.facts || {};
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '' && typeof v !== 'object') rows.push([k, String(v)]); };
    if (s.kind === 'power') { add('Fuel', s.fuel); add('Capacity', s.mw ? `${fmt.int(s.mw)} MW` : null); add('Commissioned', s.year); add('Owner', s.owner); }
    if (s.kind === 'airport') { add('IATA', s.iata); add('Passengers', s.pax ? `${fmt.int(s.pax)} (FY${s.fy})` : null); add('Cargo', s.cargo_t ? `${fmt.int(s.cargo_t)} t` : null); }
    if (s.kind === 'port') { add('Cargo handled', s.cargo_t ? `${fmt.big(s.cargo_t)} t (FY2023-24)` : null); add('Channel depth', s.depth ? `${s.depth} m` : null); }
    if (s.kind === 'water') { add('Type', s.sub); add('River', s.river); add('Completed', s.year); add('Hydropower', s.mw ? `${fmt.int(s.mw)} MW` : null); add('Live storage', s.storage_maf ? `${s.storage_maf} MAF` : null); add('Status', s.status); }
    if (s.kind === 'unesco') { add('Status', s.status); add('Inscribed', s.year); add('Category', s.category); }
    if (s.kind === 'park') { add('Area', s.area_km2 ? `${fmt.int(s.area_km2)} km²` : null); add('Designated', s.year); }
    if (s.kind === 'era') { add('Era', s.era); add('Date', s.year); }
    const skip = new Set(['coord_from', 'coord_src', 'group', 'kind', 'wikidata_year', 'superlative', 'box_location', 'usgs_id', 'usgs_url', 'mag_scale', 'river_src', 'capacity_src', 'openalex_rank_pk', 'in_top15_rule', 'in_danger', 'components', 'whc_id']);
    for (const [k, v] of Object.entries(f)) {
      if (skip.has(k) || rows.length > 12 || k.endsWith('_src') || k.endsWith('_ref')) continue;
      if (typeof v === 'number' || (typeof v === 'string' && v.length < 60)) add(k.replace(/_/g, ' ').replace(/\b\w/, (m) => m.toUpperCase()), typeof v === 'number' ? (/year|date|founded|inscribed/.test(k) || (Number.isInteger(v) && v > -9000 && v < 2100 && /year/.test(k)) ? String(v) : Math.abs(v) < 100 && !Number.isInteger(v) ? String(v) : fmt.int(v)) : v);
    }
    const d = s.pcode ? app.districts[app.districtIndex(s.pcode)] : null;
    return [
      this.hero(`${meta.icon} ${meta.label}`, s.name, d ? `${d.name}, ${d.province}` : ''),
      s.blurb ? el('div', { class: 'insp-sec' }, [el('div', { class: 'tip-blurb', text: s.blurb })]) : '',
      rows.length ? this.sec('Facts', this.kv(rows)) : '',
      el('div', { class: 'insp-sec' }, [s.ref ? el('div', { class: 'src-note' }, ['Reference: ', el('a', { href: s.ref, target: '_blank', rel: 'noopener', text: s.ref.replace(/^https?:\/\//, '').slice(0, 48) })]) : '', s.src ? this.src(s.src) : '']),
      this.actions([['🎯 Fly here', () => app.flyToSite(s)], ...(d ? [['📍 District', () => app.select({ district: app.districtIndex(s.pcode) })]] : [])]),
    ];
  }
}
