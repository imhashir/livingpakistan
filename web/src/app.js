// Application controller: wires the 3D scene, data and every HUD panel together.
import * as THREE from 'three';
import { el, fmt } from './ui/dom.js';
import { Borders } from './scene/borders.js';
import { Lines } from './scene/lines.js';
import { Sites, KIND_META } from './scene/sites.js';
import { LensEngine, LABELS } from './ui/lenses.js';
import { Inspector } from './ui/inspector.js';
import { Search } from './ui/search.js';
import { Almanac } from './ui/almanac.js';
import { Explorer } from './ui/explorer.js';
import { Duel } from './ui/duel.js';
import { Tours } from './ui/tours.js';
import { EraMachine } from './ui/eras.js';
import { FloodPlayer } from './ui/flood.js';
import { Surprise } from './ui/surprise.js';
import { Guide } from './ui/guide.js';

const LAYER_TOGGLES = [
  ['rivers', '〰️ Rivers', 'lines'], ['canals', '💧 Canals', 'lines'], ['corridors', '🐪 Caravans & Corridors', 'lines'],
  ['roads', '🛣️ Roads & rail', 'lines'], ['faults', '⚠️ Active faults', 'lines'],
  ['city', '🏙️ Cities', 'sites'], ['wonder', '✨ Wonders', 'sites'], ['unesco', '🏛️ UNESCO (tentative)', 'sites'],
  ['era', '⏳ Ancient sites', 'sites'], ['water', '💧 Dams & barrages', 'sites'], ['power', '⚡ Power plants', 'sites'],
  ['airport', '✈️ Airports', 'sites'], ['port', '⚓ Ports', 'sites'], ['university', '🎓 Universities', 'sites'],
  ['shrine', '🕌 Sufi shrines', 'sites'], ['craft', '🏺 Crafts', 'sites'], ['cricket', '🏏 Cricket', 'sites'],
  ['park', '🌲 Parks', 'sites'], ['quake', '🌋 Quakes', 'sites'], ['heat', '🔥 Heat', 'sites'], ['glof', '🧊 GLOF', 'sites'],
  ['district', '▦ District borders', 'borders'],
];

export class App {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.mood = 'day';
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.atlas = ctx.data.atlas;
    this.districts = this.atlas.districts;
    this.hud = document.getElementById('hud');
    this.ui = {};
    this.sources = new Map((ctx.data.sources?.sources || []).map((s) => [s.id, s]));
  }

  sourceTitle(id) { const s = this.sources.get(id); return s ? s.title.split(' (')[0] : id; }

  async init() {
    const { board, stage, data } = this;
    this.borders = new Borders(board, this.districts, stage.scene);
    this.lines = new Lines(board, data.layers, stage.scene);
    this.sites = new Sites(board, data.layers, this.atlas, stage.scene);
    this.sites.onSelect = (s) => this.select({ site: s });
    board.onExaggeration = () => { this.borders.build(); this.lines.rebuild(); this.sites.build(); this.flood?.rebuild(); };
    // night glow from population density (log)
    const dens = data.cells.density;
    board.setGlow((c) => { const v = dens[c]; return v == null ? 0 : Math.max(0, Math.min(1.6, (Math.log10(Math.max(v, 1)) - 2.0) / 1.4)) ** 1.6; });
    this.lens = new LensEngine(this);
    const rg = new THREE.RingGeometry(8.6, 10.2, 6, 1, Math.PI / 2); rg.rotateX(-Math.PI / 2);
    this.hoverRing = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.9), toneMapped: false, transparent: true, depthWrite: false }));
    this.hoverRing.renderOrder = 14; this.hoverRing.visible = false; stage.scene.add(this.hoverRing);
    this.buildHud();
    this.inspector = new Inspector(this);
    this.search = new Search(this);
    this.ui.almanac = new Almanac(this);
    this.explorer = new Explorer(this);
    this.duel = new Duel(this);
    this.tours = new Tours(this);
    this.eras = new EraMachine(this);
    this.flood = new FloodPlayer(this);
    this.surprise = new Surprise(this);
    this.guide = new Guide(this);
    this.setMood('day');
    this.home(true);
    this._bindPointer();
    this._bindKeys();
    stage.onTick((t) => {
      this.lines.uTime.value = t; this.sites.uTime.value = t;
      this.sites.updateLabels(stage.camera, stage.controls.target);
      this.flood?.tick(t);
      this.eras?.tick(t);
    });
    if (location.hash.length > 1) this._restoreHash(); else this.intro();
  }

  intro() {
    const N = this.atlas.nation;
    const k2 = this.sites.sites.find((s) => s.name === 'K2');
    const card = el('div', { class: 'intro' }, [
      el('div', { class: 'intro-kicker', text: 'A strategy-map atlas built from real public data' }),
      el('div', { class: 'intro-title', text: 'PAKCIV' }),
      el('div', { class: 'intro-stats' }, [
        el('span', {}, [el('b', { text: fmt.big(N.pop_census2023) }), ' people · Census 2023']),
        el('span', {}, [el('b', { text: String(N.district_count) }), ' districts']),
        el('span', {}, [el('b', { text: fmt.int(N.hex_count) }), ' hexes']),
        el('span', {}, [el('b', { text: `0 → ${fmt.int(k2?.facts?.elevation_m)} m` }), ' sea to K2']),
      ]),
      el('div', { class: 'intro-hint', text: 'Drag to pan · right-drag to orbit · scroll to zoom · T for guided tours · / to search' }),
    ]);
    this.hud.append(card);
    document.body.classList.add('intro-on');
    if (k2) {
      const p = this.sites.worldPos(k2);
      this.stage.controls.target.set(p.x, p.y, p.z);
      this.stage.camera.position.set(p.x + 120, p.y + 260, p.z + 420);
    }
    this.setMood('golden');
    setTimeout(() => { this.home(); this.stage.flight && (this.stage.flight.duration = 4.5); }, 900);
    setTimeout(() => { this.setMood('day'); }, 4200);
    setTimeout(() => { card.classList.add('gone'); document.body.classList.remove('intro-on'); }, 5200);
    setTimeout(() => { card.remove(); if (this.guide.shouldAutoShow()) this.guide.openWelcome(); }, 6500);
    card.addEventListener('click', () => { card.classList.add('gone'); document.body.classList.remove('intro-on'); });
  }

  home(instant = false) {
    const [cx, cz] = this.board.mapToWorld(990, 980);
    const tgt = [cx, 0, cz];
    const dist = 2350, tilt = 0.62, az = -0.12;
    if (instant) {
      this.stage.controls.target.set(...tgt);
      this.stage.camera.position.set(cx + dist * Math.sin(tilt) * Math.sin(az), dist * Math.cos(tilt), cz + dist * Math.sin(tilt) * Math.cos(az));
    } else this.stage.flyTo(tgt, { distance: dist, tilt, azimuth: az });
  }

  // ------------------------------------------------------------------ mood / lens / layers
  setMood(name) {
    this.mood = name;
    const m = this.lighting.apply(name, { water: this.water, sky: this.sky, board: this.board, bloom: this.stage.bloom, voidPlane: this.voidPlane });
    this.lines.uNight.value = m.night; this.sites.uNight.value = m.night;
    document.body.dataset.mood = name;
    this.hud.querySelectorAll('[data-mood]').forEach((b) => b.classList.toggle('on', b.dataset.mood === name));
    this._saveHash();
  }

  setLens(id) {
    const lens = this.lens.apply(id);
    this.hud.querySelectorAll('[data-lens]').forEach((b) => b.classList.toggle('on', b.dataset.lens === lens.id));
    if (lens.id === 'flood') this.flood.show(); else this.flood.hide();
    this._saveHash();
    return lens;
  }

  setLayer(key, on) {
    const t = LAYER_TOGGLES.find((x) => x[0] === key);
    if (!t) return;
    if (t[2] === 'lines') this.lines.setVisible(key, on);
    else if (t[2] === 'sites') this.sites.setKind(key, on);
    else if (t[2] === 'borders') this.borders.setVisible('district', on);
    const b = this.hud.querySelector(`[data-layer="${key}"]`); if (b) b.classList.toggle('on', on);
  }
  layerOn(key) {
    const t = LAYER_TOGGLES.find((x) => x[0] === key);
    if (t[2] === 'lines') return this.lines.visible[key];
    if (t[2] === 'sites') return this.sites.visibleKinds.has(key);
    return this.borders.visible.district;
  }

  highlightWhere(pred, label = null, quiet = false) {
    if (!pred) { this.board.setHighlight(null); return; }
    const set = [];
    const w = this.data.world;
    for (let c = 0; c < w.owner.length; c++) if (w.owner[c] >= 0 && pred(c)) set.push(c);
    this.board.setHighlight(set);
    if (label && !quiet) this.toast(`${label}: ${set.length} hexes highlighted`);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const N = this.atlas.nation, Y = this.atlas.yields;
    const yieldEls = Object.entries(Y).map(([k, y]) => el('div', { class: 'yield', title: y.def, onclick: () => this.explorer.open({ sortBy: `yields.${k}` }) }, [
      el('span', { class: 'ico', text: y.icon }),
      el('div', {}, [el('div', { class: 'v', 'data-count': N.yields[k] || 0, 'data-money': k === 'gold' ? '1' : null, text: '0' }), el('div', { class: 'k', text: y.label })]),
    ]));
    yieldEls.push(el('div', { class: 'yield', title: 'Census 2023 population (PBS), plus WorldPop 2025 for AJK & GB', onclick: () => this.setLens('density') }, [
      el('span', { class: 'ico', text: '👥' }),
      el('div', {}, [el('div', { class: 'v', 'data-count': N.pop_all_districts, text: '0' }), el('div', { class: 'k', text: 'Citizens' })]),
    ]));
    const btn = (label, kbd, fn, title) => el('button', { class: 'tb-btn', title, onclick: fn }, [label, kbd ? el('kbd', { text: kbd }) : '']);
    const top = el('div', { class: 'topbar glass' }, [
      el('div', { class: 'brand', title: 'Home view (H)', onclick: () => this.home() }, [el('span', { class: 'brand-hex' }), el('span', { class: 'brand-name', text: 'PakCiv' })]),
      el('div', { class: 'yields' }, yieldEls),
      el('div', { class: 'spacer' }),
      btn('🔎', '/', () => this.search.open(), 'Search districts, cities, wonders, dams, peaks (/)'),
      btn('🎬 Tours', 'T', () => this.tours.openMenu(), 'Guided story tours'),
      btn('⏳ Eras', 'Y', () => this.eras.toggle(), 'Era Time-Machine: 9,000 years on the same hexes'),
      btn('⚔️ Duel', 'D', () => this.duel.open(), 'District Duel: compare two districts'),
      btn('📊 Explorer', 'E', () => this.explorer.open(), 'Sortable table + scatter of all 160 districts'),
      btn('🎲 Surprise', 'S', () => this.surprise.go(), 'Fly to a remarkable outlier'),
      btn('📜', 'A', () => this.ui.almanac.open(), 'Almanac: every source, vintage and caveat (A)'),
      Object.assign(btn('❔ Guide', '?', () => this.guide.openWelcome(), 'Welcome guide & interactive walkthrough (?)'), { className: 'tb-btn guide-btn' }),
    ]);
    // lens dock
    const groups = {};
    for (const l of this.atlas.lenses) (groups[l.group] ||= []).push(l);
    const dock = el('div', { class: 'dock glass' }, [
      el('div', { class: 'dock-title', text: 'Lenses' }),
      ...Object.entries(groups).map(([g, ls]) => el('div', { class: 'dock-group' }, [
        el('div', { class: 'dock-gtitle', text: g }),
        el('div', { class: 'dock-items' }, ls.map((l) => el('button', { class: 'lens-btn', 'data-lens': l.id, title: l.desc, onclick: () => this.setLens(l.id) }, [l.label]))),
      ])),
      el('div', { class: 'dock-title', text: 'Map layers' }),
      el('div', { class: 'dock-items layers' }, LAYER_TOGGLES.map(([k, label]) => el('button', {
        class: 'layer-btn', 'data-layer': k, onclick: () => { this.setLayer(k, !this.layerOn(k)); },
      }, [label]))),
      el('label', { class: 'treaty' }, [el('input', { type: 'checkbox', onchange: (e) => { this.lines.setTreatyView(e.target.checked); if (e.target.checked) { this.setLayer('rivers', true); this.toast('Indus Waters Treaty (1960): western rivers → Pakistan (green), eastern rivers → India (orange)'); } } }), ' Indus Waters Treaty view']),
    ]);
    const dockToggle = el('button', { class: 'dock-toggle glass', title: 'Show/hide lenses', onclick: () => dock.classList.toggle('collapsed') }, ['☰']);
    this.ui.legend = el('div', { class: 'legend glass hidden' });
    const moods = el('div', { class: 'moods glass' }, ['day', 'golden', 'night'].map((m) =>
      el('button', { 'data-mood': m, class: 'chip', title: 'Lighting (L cycles)', onclick: () => this.setMood(m) },
        [{ day: '☀️ Day', golden: '🌇 Golden hour', night: '🌙 Nightlights' }[m]])));
    const relief = el('label', { class: 'relief glass', title: 'Vertical exaggeration ([ and ])' }, [
      el('span', { text: '⛰ Relief ×' }),
      el('input', { type: 'range', min: 1, max: 30, step: 0.5, value: this.board.exaggeration,
        onchange: (e) => { this.board.setExaggeration(+e.target.value); },
        oninput: (e) => { relief.querySelector('b').textContent = e.target.value; } }),
      el('b', { text: String(this.board.exaggeration) }),
    ]);
    this.reliefEl = relief;
    this.tip = el('div', { class: 'tip glass hidden' });
    this.toastEl = el('div', { class: 'toast hidden' });
    this.hud.append(top, dock, dockToggle, this.ui.legend, moods, relief, this.tip, this.toastEl);
    this.ui.dock = dock;
    for (const [k] of LAYER_TOGGLES) this.hud.querySelector(`[data-layer="${k}"]`)?.classList.toggle('on', this.layerOn(k));
    this.hud.querySelector('[data-lens="terrain"]')?.classList.add('on');
    this.animateCounters(top);
  }

  animateCounters(root) {
    const els = [...root.querySelectorAll('[data-count]')];
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1800), e = 1 - (1 - k) ** 3;
      for (const n of els) n.textContent = (n.dataset.money ? '$' : '') + fmt.big(+n.dataset.count * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setRelief(v) { this.board.setExaggeration(v); this.reliefEl.querySelector('input').value = v; this.reliefEl.querySelector('b').textContent = v; }

  toast(msg, ms = 3600) {
    this.toastEl.textContent = msg; this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  // ------------------------------------------------------------------ picking & selection
  cellWorld(cell) { const [x, z] = this.board.worldXZ(cell); return [x, this.board.topY(cell), z]; }

  flyToCell(cell, opts = {}) { const [x, y, z] = this.cellWorld(cell); return this.stage.flyTo([x, Math.max(y, 0), z], opts); }

  flyToSite(s, opts = {}) {
    const p = this.sites.worldPos(s);
    return this.stage.flyTo([p.x, p.y, p.z], { distance: 260, tilt: 0.95, ...opts });
  }

  flyToDistrict(i, opts = {}) {
    const d = this.districts[i];
    const [x, z] = this.board.mapToWorld(d.x, d.y);
    const span = Math.sqrt(d.area_km2 || 1000);
    return this.stage.flyTo([x, this.board.heightAt(x, z), z], { distance: Math.max(260, span * 4.2), tilt: 0.85, ...opts });
  }

  select(sel) {
    this.selection = sel;
    if (sel?.district != null) this.board.setHighlight(this.districts[sel.district].cells);
    else if (sel?.cell != null) this.board.setHighlight([sel.cell]);
    else if (sel?.site?.kind === 'city') {
      const pcs = new Set(sel.site.pcodes || []);
      this.board.setHighlight(this.districts.filter((d) => pcs.has(d.pcode)).flatMap((d) => d.cells));
    } else this.board.setHighlight(null);
    this.inspector.show(sel);
    this._saveHash();
  }

  districtIndex(pcode) { return this.districts.findIndex((d) => d.pcode === pcode); }

  _bindPointer() {
    const dom = this.stage.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    dom.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / dom.clientWidth) * 2 - 1, -(e.clientY / dom.clientHeight) * 2 + 1);
      this._pendingPick = [e.clientX, e.clientY];
    });
    dom.addEventListener('pointerleave', () => { this.tip.classList.add('hidden'); this.hoverRing.visible = false; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.pointer.set((e.clientX / dom.clientWidth) * 2 - 1, -(e.clientY / dom.clientHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.stage.camera);
      const hit = this.board.pick(this.raycaster);
      if (this.duel.picking && hit && this.data.world.owner[hit.cell] >= 0) { this.duel.pickDistrict(this.data.world.owner[hit.cell]); return; }
      const site = this.sites.pick(this.raycaster);
      if (site) { this.select({ site }); return; }
      if (hit && this.data.world.owner[hit.cell] >= 0) this.select(e.shiftKey ? { district: this.data.world.owner[hit.cell] } : { cell: hit.cell });
      else this.select(null);
    });
    dom.addEventListener('dblclick', () => {
      if (this.selection?.cell != null) this.flyToCell(this.selection.cell, { distance: 260, tilt: 0.95 });
    });
    this.stage.onTick(() => {
      if (!this._pendingPick) return;
      const [x, y] = this._pendingPick; this._pendingPick = null;
      this.raycaster.setFromCamera(this.pointer, this.stage.camera);
      const site = this.sites.pick(this.raycaster);
      if (site) { this.showSiteTip(site, x, y); dom.style.cursor = 'pointer'; return; }
      const hit = this.board.pick(this.raycaster);
      const own = hit && this.data.world.owner[hit.cell] >= 0;
      dom.style.cursor = own ? 'pointer' : '';
      this.hoverRing.visible = !!own;
      if (own) { const [hx, hy, hz] = this.cellWorld(hit.cell); this.hoverRing.position.set(hx, hy + 0.5, hz); }
      if (!hit) { this.tip.classList.add('hidden'); return; }
      this.showTip(hit.cell, x, y);
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === '/') { e.preventDefault(); this.search.open(); }
      else if (k === 'Escape') { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); this.tours.stop(); this.select(null); }
      else if (k === 't' || k === 'T') this.tours.openMenu();
      else if (k === 'd' || k === 'D') this.duel.open();
      else if (k === 'e' || k === 'E') this.explorer.open();
      else if (k === 's' || k === 'S') this.surprise.go();
      else if (k === '?' || k === 'g' || k === 'G') this.guide.openWelcome();
      else if (k === 'a' || k === 'A') this.ui.almanac.open();
      else if (k === 'h' || k === 'H') this.home();
      else if (k === 'l' || k === 'L') this.setMood({ day: 'golden', golden: 'night', night: 'day' }[this.mood]);
      else if (k === 'y' || k === 'Y') this.eras.toggle();
      else if (k === '[' || k === ']') this.setRelief(Math.min(30, Math.max(1, this.board.exaggeration + (k === ']' ? 2 : -2))));
      else if (/^[1-9]$/.test(k)) { const l = this.atlas.lenses[+k - 1]; if (l) this.setLens(l.id); }
    });
  }

  cellInfo(cell) {
    const w = this.data.world, o = w.owner[cell];
    return {
      cell, owner: o, district: o >= 0 ? this.districts[o] : null,
      country: o === -2 ? w.countries[w.country[cell]] : null,
      terrain: w.terrain_names[w.terrain[cell]], elev: w.elev[cell], elevMax: w.elev_max[cell], flood: w.flood_pct[cell],
      pop: this.data.cells.pop[cell], gdp: this.data.cells.gdp[cell], density: this.data.cells.density[cell],
    };
  }

  showTip(cell, x, y) {
    const i = this.cellInfo(cell), w = this.data.world;
    if (w.water[cell] === 1 || w.water[cell] === 2) { this.tip.classList.add('hidden'); return; }
    const rows = [];
    const lens = this.atlas.lenses.find((l) => l.id === this.lens.current);
    if (lens && lens.level !== 'none' && i.district) rows.push(el('div', { class: 'tip-row lens' }, [el('span', { text: lens.label }), el('b', { text: this.lens.format(lens, this.lens.valueAt(lens, cell)) })]));
    rows.push(el('div', { class: 'tip-row' }, [el('span', { text: 'Terrain' }), el('b', { text: i.terrain.replace('_', ' ') })]));
    rows.push(el('div', { class: 'tip-row' }, [el('span', { text: 'Elevation' }), el('b', { text: `${fmt.int(i.elev)} m · peak ${fmt.int(i.elevMax)} m` })]));
    if (i.district) rows.push(el('div', { class: 'tip-row' }, [el('span', { text: 'People in hex' }), el('b', { text: fmt.big(i.pop) })]));
    if (i.flood > 0.5) rows.push(el('div', { class: 'tip-row flood' }, [el('span', { text: '2022 flood' }), el('b', { text: `${i.flood.toFixed(0)}% under water` })]));
    this.tip.replaceChildren(
      el('div', { class: 'tip-title', text: i.district ? i.district.name : i.country || 'Lake' }),
      el('div', { class: 'tip-sub', text: i.district ? i.district.province : 'beyond Pakistan · fog of war' }), ...rows);
    this._placeTip(x, y);
  }

  showSiteTip(s, x, y) {
    const meta = KIND_META[s.kind] || {};
    const sub = s.kind === 'power' ? `${s.fuel || ''} · ${s.mw ? fmt.int(s.mw) + ' MW' : ''}` : s.kind === 'city' ? `${fmt.big(s.pop)} people (Census 2023)` : meta.label;
    this.tip.replaceChildren(el('div', { class: 'tip-title', text: `${meta.icon || ''} ${s.name}` }), el('div', { class: 'tip-sub', text: sub || '' }),
      s.blurb ? el('div', { class: 'tip-blurb', text: s.blurb.length > 150 ? s.blurb.slice(0, 147) + '…' : s.blurb }) : '');
    this._placeTip(x, y);
  }

  _placeTip(x, y) {
    const w = 300, h = this.tip.offsetHeight || 120;
    const px = x + 18 + w > innerWidth ? x - w - 12 : x + 18, py = y + 18 + h > innerHeight ? y - h - 12 : y + 18;
    this.tip.style.transform = `translate(${px}px, ${py}px)`;
    this.tip.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ URL state (shareable views)
  _saveHash() {
    clearTimeout(this._hashT);
    this._hashT = setTimeout(() => {
      const p = new URLSearchParams();
      if (this.lens.current !== 'terrain') p.set('lens', this.lens.current);
      if (this.mood !== 'day') p.set('mood', this.mood);
      const s = this.selection;
      if (s?.district != null) p.set('d', this.districts[s.district].pcode);
      else if (s?.site) p.set('site', s.site.id);
      history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname + location.search);
    }, 200);
  }

  _restoreHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('lens')) this.setLens(p.get('lens'));
    if (p.get('mood')) this.setMood(p.get('mood'));
    if (p.get('d')) { const i = this.districtIndex(p.get('d')); if (i >= 0) { this.select({ district: i }); this.flyToDistrict(i); } }
    if (p.get('site')) { const s = this.sites.byId.get(p.get('site')); if (s) { this.select({ site: s }); this.flyToSite(s); } }
  }
}

export { LABELS };
