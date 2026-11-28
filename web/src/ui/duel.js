// District Duel: head-to-head comparison of two districts, with radar, bars, crowns and a data-driven verdict.
import './panels.css';
import { el, fmt } from './dom.js';
import { LABELS } from './lenses.js';
import { panel, get, val, fmtNum, norm, fuzzyRank, percentile, svgEl, NO_DATA } from './panelkit.js';

const lab = (v) => (v == null ? null : LABELS[v] || String(v).replace(/_/g, ' '));

const MATCHUPS = [['Lahore', 'South Karachi'], ['Faisalabad', 'Sialkot'], ['Skardu', 'Gwadar'], ['Peshawar', 'Quetta'], ['Tharparkar', 'Islamabad']];

// Radar axes: each normalised to the district's percentile among all districts with data.
const RADAR = [
  { label: 'Literacy', get: (d) => d.literacy },
  { label: 'Urban %', get: (d) => d.urban_pct },
  { label: 'GDP/person', get: (d) => d.gdp_pc },
  { label: 'Low poverty', get: (d) => (d.mpi_h == null ? null : 100 - d.mpi_h) },
  { label: 'Density', get: (d) => d.density },
  { label: 'Manufacturing LQ', get: (d) => d.lq?.C },
  { label: 'Ling. diversity', get: (d) => d.lang_diversity },
];

const VERB = { food: 'out-farms', production: 'out-produces', gold: 'out-earns', trade: 'out-trades', science: 'out-researches', culture: 'out-entertains' };

export class Duel {
  constructor(app) {
    this.app = app;
    this.picking = false;
    this.pickSlot = 0;
    this.sel = [null, null];
    this.radarSorted = RADAR.map((ax) => app.districts.map(ax.get).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b));
    this.index = app.districts.map((d, i) => ({ i, key: norm(d.name), d }));
    const p = panel(app, { cls: 'duel', title: 'District Duel ⚔️', sub: 'Pick two districts — type, or click them on the map', onClose: () => this._closed() });
    this.root = p.root;
    this.slots = [0, 1].map((k) => this._slot(k));
    this.pickBtn = el('button', { class: 'pc-btn', title: 'Click districts on the 3D map to fill A, then B', onclick: () => this.startPicking(this.sel[0] == null ? 0 : this.sel[1] == null ? 1 : 0) }, ['📍 Pick on map']);
    this.chips = el('div', { class: 'duel-chips' }, MATCHUPS.map(([a, b]) => {
      const ia = this._find(a), ib = this._find(b);
      if (ia < 0 || ib < 0) return '';
      return el('button', { class: 'duel-chip', onclick: () => this.set(ia, ib), text: `${app.districts[ia].name} vs ${app.districts[ib].name}` });
    }));
    this.out = el('div', { class: 'duel-out' });
    p.body.append(
      el('div', { class: 'duel-pick' }, [this.slots[0].wrap, el('span', { class: 'duel-vs', text: 'vs' }), this.slots[1].wrap]),
      el('div', { class: 'duel-tools' }, [this.pickBtn, el('button', { class: 'pc-btn', text: '⇄ Swap', onclick: () => this.set(this.sel[1], this.sel[0]) })]),
      this.chips, this.out,
    );
    this.render();
  }

  _find(name) { return this.app.districts.findIndex((d) => d.name === name); }

  _slot(k) {
    const input = el('input', { class: 'pc-input', type: 'search', placeholder: k ? 'District B…' : 'District A…', autocomplete: 'off', spellcheck: 'false' });
    const list = el('div', { class: 'duel-ac hidden' });
    let res = [], act = 0;
    const paint = () => list.querySelectorAll('div').forEach((n, j) => n.classList.toggle('on', j === act));
    const choose = (i) => { list.classList.add('hidden'); input.blur(); const s = [...this.sel]; s[k] = i; this.set(s[0], s[1]); };
    const refresh = () => {
      const q = input.value.trim();
      res = q ? fuzzyRank(this.index, q, 8).map((r) => r.item) : [];
      act = 0;
      list.replaceChildren(...res.map((r, j) => el('div', { class: j === 0 ? 'on' : null, onpointerdown: (e) => { e.preventDefault(); choose(r.i); } }, [el('b', { text: r.d.name }), el('small', { text: r.d.province })])));
      list.classList.toggle('hidden', !res.length);
      fit();
    };
    // keep the suggestions inside what the keyboard leaves of the screen:
    // below the input if there is room, else above it
    const fit = () => {
      if (list.classList.contains('hidden')) return;
      const vv = window.visualViewport, top = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight;
      const r = input.getBoundingClientRect();
      const below = top + h - r.bottom - 8, above = r.top - top - 8;
      const up = below < 160 && above > below;
      list.classList.toggle('above', up);
      list.style.maxHeight = `${Math.max(96, Math.floor(up ? above : below) - 4)}px`;
    };
    window.visualViewport?.addEventListener('resize', fit);
    input.addEventListener('input', refresh);
    input.addEventListener('focus', () => { input.select(); });
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(res.length - 1, act + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (res[act]) choose(res[act].i); }
    });
    const wrap = el('div', { class: `duel-slot s${k}` }, [el('span', { class: 'duel-badge', text: k ? 'B' : 'A' }), input, list]);
    return { input, list, wrap };
  }

  open(seed) {
    this.root.classList.remove('hidden');
    this.app.inspector?.hide();
    if (Number.isInteger(seed) && seed >= 0) { this.set(seed, null, true); this.startPicking(1); return; }
    if (this.sel[0] == null && this.sel[1] == null) this.startPicking(0);
    else this._mapSync();
  }

  _closed() { this.picking = false; this.pickBtn.classList.remove('on'); }

  startPicking(slot = 0) {
    this.picking = true; this.pickSlot = slot;
    this.pickBtn.classList.add('on');
    this.pickBtn.lastChild.textContent = ` Click district ${slot ? 'B' : 'A'} on the map…`;
  }

  stopPicking() { this.picking = false; this.pickBtn.classList.remove('on'); this.pickBtn.lastChild.textContent = '📍 Pick on map'; }

  pickDistrict(i) {
    if (i == null || i < 0) return;
    const s = [...this.sel]; s[this.pickSlot] = i;
    const other = 1 - this.pickSlot;
    this.set(s[0], s[1], s[other] == null);
    if (s[other] == null) this.startPicking(other); else this.stopPicking();
  }

  set(a, b, noFly = false) {
    this.sel = [a ?? null, b ?? null];
    if (this.sel[0] != null && this.sel[1] != null) this.stopPicking();
    this.slots.forEach((s, k) => { s.input.value = this.sel[k] != null ? this.app.districts[this.sel[k]].name : ''; });
    this.root.classList.remove('hidden');
    this.render();
    this._mapSync(!noFly);
  }

  _mapSync(fly = false) {
    const { app } = this, ds = app.districts;
    const chosen = this.sel.filter((x) => x != null);
    if (!chosen.length) return;
    app.board.setHighlight(chosen.flatMap((i) => ds[i].cells));
    if (!fly) return;
    if (chosen.length === 1) { app.flyToDistrict(chosen[0]); return; }
    const [A, B] = chosen.map((i) => app.board.mapToWorld(ds[i].x, ds[i].y));
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    const span = Math.hypot(A[0] - B[0], A[1] - B[1]) + Math.sqrt(Math.max(ds[chosen[0]].area_km2 || 0, ds[chosen[1]].area_km2 || 0)) * 2;
    app.stage.flyTo([mx, app.board.heightAt(mx, mz), mz], { distance: Math.max(380, span * 1.6), tilt: 0.75 });
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const [a, b] = this.sel.map((i) => (i == null ? null : this.app.districts[i]));
    if (!a || !b) {
      this.out.replaceChildren(el('div', { class: 'duel-empty' }, [
        el('div', { class: 'duel-empty-ico', text: '⚔️' }),
        el('p', { text: a || b ? `Now choose a rival for ${(a || b).name}.` : 'Choose two districts above, click them on the map, or try a classic match-up.' }),
      ]));
      return;
    }
    const rows = this._rows(a, b);
    const crowns = [0, 0];
    rows.forEach((r) => { if (r.win != null) crowns[r.win]++; });
    this.out.replaceChildren(
      el('div', { class: 'duel-names' }, [
        el('div', { class: 'duel-n s0' }, [el('b', { text: a.name }), el('small', { text: a.province }), el('span', { class: 'duel-cr', text: `👑 ${crowns[0]}` })]),
        el('div', { class: 'duel-n s1' }, [el('b', { text: b.name }), el('small', { text: b.province }), el('span', { class: 'duel-cr', text: `👑 ${crowns[1]}` })]),
      ]),
      el('div', { class: 'duel-verdict' }, this._verdict(a, b, crowns)),
      this._radar(a, b),
      el('h4', { class: 'duel-h', text: 'Head to head' }),
      el('div', { class: 'duel-rows' }, rows.map((r) => this._row(r))),
      el('h4', { class: 'duel-h', text: 'Character' }),
      el('div', { class: 'duel-text' }, [
        ['Top language', (d) => lab(d.top_language) && `${lab(d.top_language)}${d.top_language_pct != null ? ` (${d.top_language_pct.toFixed(0)}%)` : ''}`],
        ['Top crop', (d) => lab(d.top_crop)], ['Largest minority', (d) => lab(d.largest_minority)],
      ].map(([k, f]) => el('div', { class: 'duel-trow' }, [val(f(a), String, 'div'), el('span', { text: k }), val(f(b), String, 'div')]))),
      el('h4', { class: 'duel-h', text: 'Specialisations', title: 'Sectors with location quotient ≥ 1.5 (Economic Census 2023)' }),
      el('div', { class: 'duel-spec' }, [a, b].map((d) => el('div', {}, d.specials?.length
        ? d.specials.map((s) => el('span', { class: 'duel-badge2', title: `Location quotient ${s.lq} · ${fmt.int(s.workers)} workers`, text: `${s.icon} ${s.label}` }))
        : [el('span', { class: 'nd', title: d.lq ? 'no sector stands out (LQ ≥ 1.5)' : NO_DATA, text: d.lq ? 'None stand out' : '—' })]))),
      el('p', { class: 'duel-note', text: 'Economy is MODELLED GDP (Kummu et al.), not official accounts. “—” = no data published (AJK & GB lack census and economic-census tables).' }),
    );
  }

  _rows(a, b) {
    const Y = this.app.atlas.yields;
    const rows = Object.entries(Y).map(([k, y]) => ({ label: `${y.icon} ${y.label}`, title: y.def, va: a.yields?.[k], vb: b.yields?.[k], f: k === 'gold' ? fmtNum.usdBig : fmt.big, better: 1 }));
    rows.push(
      { label: '👥 Population', va: a.pop, vb: b.pop, f: fmt.big, better: 1 },
      { label: '📈 Growth %/yr', title: 'Annual population growth 2017–2023', va: a.growth, vb: b.growth, f: fmtNum.dec2, better: 1 },
      { label: '📖 Literacy', va: a.literacy, vb: b.literacy, f: fmtNum.pct, better: 1 },
      { label: '👨 Male literacy', va: a.literacy_male, vb: b.literacy_male, f: fmtNum.pct, better: 1 },
      { label: '👩 Female literacy', va: a.literacy_female, vb: b.literacy_female, f: fmtNum.pct, better: 1 },
      { label: '💵 GDP/person', title: 'MODELLED, PPP Int$', va: a.gdp_pc, vb: b.gdp_pc, f: fmtNum.usd, better: 1 },
      { label: '🪫 MPI headcount', title: 'Share of people multidimensionally poor — lower wins', va: a.mpi_h, vb: b.mpi_h, f: fmtNum.pct, better: -1 },
      { label: '⛰️ Mean elevation', va: a.elev_mean, vb: b.elev_mean, f: fmtNum.m, better: 0 },
      { label: '🌊 Flooded 2022', title: 'Share of area flooded at the 2022 peak — lower wins', va: a.flood_pct, vb: b.flood_pct, f: fmtNum.pct, better: -1 },
    );
    for (const r of rows) {
      const ok = (v) => v != null && Number.isFinite(v);
      r.win = r.better && ok(r.va) && ok(r.vb) && r.va !== r.vb ? ((r.va > r.vb) === (r.better > 0) ? 0 : 1) : null;
    }
    return rows;
  }

  _row(r) {
    const mx = Math.max(Math.abs(r.va || 0), Math.abs(r.vb || 0)) || 1;
    const bar = (v, k) => el('div', { class: `duel-bar s${k}` }, [
      el('i', { style: { width: v == null ? '0' : `${Math.max(2, (Math.abs(v) / mx) * 100)}%` } }),
      el('span', {}, [r.win === k ? el('em', { class: 'crown', title: 'Winner', text: '👑' }) : '', val(v, r.f)]),
    ]);
    return el('div', { class: 'duel-row', title: r.title || null }, [bar(r.va, 0), el('div', { class: 'duel-lbl', text: r.label }), bar(r.vb, 1)]);
  }

  _verdict(a, b, crowns) {
    // biggest yield ratio where both have positive data
    let best = null;
    for (const [k, y] of Object.entries(this.app.atlas.yields)) {
      const va = a.yields?.[k], vb = b.yields?.[k];
      if (!(va > 0 && vb > 0)) continue;
      const [w, l, ratio] = va >= vb ? [a, b, va / vb] : [b, a, vb / va];
      if (!best || ratio > best.ratio) best = { k, y, w, l, ratio };
    }
    const lines = [];
    if (best && best.ratio >= 1.05) {
      const r = best.ratio >= 10 ? best.ratio.toFixed(0) : best.ratio.toFixed(1);
      lines.push(el('div', {}, [el('b', { text: best.w.name }), ` ${VERB[best.k] || 'outpaces'} `, el('b', { text: best.l.name }), ` ${r}× in ${best.y.label}${best.k === 'gold' ? ' (modelled)' : ''}.`]));
    } else if (!best) lines.push(el('div', { text: 'Too little published data to compare yields head-to-head.' }));
    else lines.push(el('div', { text: `${a.name} and ${b.name} are neck and neck across the yields.` }));
    if (a.literacy != null && b.literacy != null && Math.abs(a.literacy - b.literacy) >= 5) {
      const [w, l] = a.literacy > b.literacy ? [a, b] : [b, a];
      lines.push(el('small', { text: `${w.name} is ${(w.literacy - l.literacy).toFixed(0)} literacy points ahead of ${l.name}.` }));
    }
    const total = crowns[0] + crowns[1];
    if (total) lines.push(el('small', { text: crowns[0] === crowns[1] ? `Honours even: ${crowns[0]}–${crowns[1]} on comparable rows.` : `${crowns[0] > crowns[1] ? a.name : b.name} takes ${Math.max(...crowns)} of ${total} crowns.` }));
    return lines;
  }

  _radar(a, b) {
    const S = 300, cx = S / 2, cy = S / 2 + 4, R = 102, n = RADAR.length;
    const ang = (k) => -Math.PI / 2 + (k * 2 * Math.PI) / n;
    const pt = (k, t) => [cx + Math.cos(ang(k)) * R * t, cy + Math.sin(ang(k)) * R * t];
    const parts = [];
    for (const t of [0.25, 0.5, 0.75, 1]) parts.push(svgEl('polygon', { class: 'rd-ring', points: RADAR.map((_, k) => pt(k, t).join(',')).join(' ') }));
    RADAR.forEach((ax, k) => {
      const [x, y] = pt(k, 1), [lx, ly] = pt(k, 1.2);
      parts.push(svgEl('line', { class: 'rd-spoke', x1: cx, y1: cy, x2: x, y2: y }));
      parts.push(svgEl('text', { class: 'rd-lbl', x: lx, y: ly + 4, 'text-anchor': Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end', text: ax.label }));
    });
    [a, b].forEach((d, s) => {
      const ps = RADAR.map((ax, k) => percentile(this.radarSorted[k], ax.get(d)));
      parts.push(svgEl('polygon', { class: `rd-poly s${s}`, points: ps.map((p, k) => pt(k, p ?? 0).join(',')).join(' ') }));
      ps.forEach((p, k) => {
        const [x, y] = pt(k, p ?? 0);
        const v = RADAR[k].get(d);
        parts.push(svgEl('circle', { class: `rd-dot s${s}${p == null ? ' nd' : ''}`, cx: x, cy: y, r: p == null ? 0 : 3.5 }, [
          svgEl('title', { text: `${d.name} · ${RADAR[k].label}: ${p == null ? '— (no data published)' : `${(p * 100).toFixed(0)}th percentile (${v.toFixed(v < 10 ? 2 : 0)})`}` }),
        ]));
      });
    });
    const missing = RADAR.filter((ax) => ax.get(a) == null || ax.get(b) == null).map((ax) => ax.label);
    return el('div', { class: 'duel-radar' }, [
      svgEl('svg', { viewBox: `-46 -2 ${S + 92} ${S - 4}`, class: 'rd' }, parts),
      el('div', { class: 'rd-legend' }, [
        el('span', { class: 's0' }, [el('i'), a.name]), el('span', { class: 's1' }, [el('i'), b.name]),
        el('small', { text: 'Percentile among all districts' + (missing.length ? ` · no data: ${missing.join(', ')}` : '') }),
      ]),
    ]);
  }

  go() {}
}
