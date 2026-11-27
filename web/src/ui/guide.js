// First-time Welcome / Getting Started modal + an interactive spotlight walkthrough of every major feature.
import { el, fmt } from './dom.js';

const STORE_KEY = 'livingpakistan.welcome.v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Guide {
  constructor(app) {
    this.app = app;
    this._buildWelcome();
    this._buildCoach();
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); this.back(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.end(); }
    }, true);
    window.addEventListener('resize', () => this._position());
  }

  // ------------------------------------------------------------------ first visit
  shouldAutoShow() {
    // shown once per browser: any stored value counts as seen
    try { if (localStorage.getItem(STORE_KEY)) return false; } catch { /* private mode */ }
    if (/[?&]guide=0/.test(location.search)) return false;
    return location.hash.length <= 1; // shared deep links go straight to their view
  }

  // ------------------------------------------------------------------ welcome modal
  _counts() {
    const A = this.app, S = A.sites.sites;
    const n = (k) => S.filter((s) => s.kind === k).length;
    return {
      lenses: A.atlas.lenses.length, districts: A.districts.length, hexes: A.atlas.nation.hex_count,
      cities: n('city'), wonders: A.sites.wonders?.length || n('wonder'), sites: S.length,
      tours: A.tours.tours.length, eras: A.eras.eras.length, eraSites: n('era'),
      weeks: (A.atlas.flood_periods || []).length, sources: A.sources.size,
      corridors: A.data.layers.lines.corridors.length, rivers: A.data.layers.lines.rivers.length,
    };
  }

  _buildWelcome() {
    const c = this._counts();
    const card = (icon, title, text, onTry) => el('button', { class: 'gw-card', title: 'Try it', onclick: () => { this.closeWelcome(); onTry(); } }, [
      el('span', { class: 'gw-ico', text: icon }), el('b', { text: title }), el('span', { text })]);
    const A = this.app;
    this.welcome = el('div', { class: 'modal guide-welcome hidden', role: 'dialog', 'aria-label': 'Welcome to living pakistan' }, [
      el('div', { class: 'gw-panel glass' }, [
        el('button', { class: 'gw-x', text: '✕', title: 'Close', onclick: () => this.closeWelcome() }),
        el('div', { class: 'gw-kicker', text: 'Welcome to' }),
        el('div', { class: 'gw-title', text: 'living pakistan' }),
        el('p', { class: 'gw-lede', html: `Pakistan to explore tile by tile: the whole country is cut into <b>${fmt.int(c.hexes)} hexagon tiles</b>, each about 20 km wide, raised to its real height from the Arabian Sea to K2.<br>Tiles, cities and landmarks carry <b>real public data</b> — click anything to see what's there.` }),
        el('div', { class: 'gw-grid' }, [
          card('🗺️', `${c.lenses} lenses`, 'Re-colour the map: language, literacy, poverty, farmland, floods…', () => A.setLens('language')),
          card('🏙️', `${c.cities} cities`, 'Click a city banner for its City View: workers, districts, landmarks.', () => { const k = A.sites.sites.find((s) => s.name === 'Karachi' && s.kind === 'city'); A.select({ site: k }); A.flyToSite(k, { distance: 420 }); }),
          card('✨', `${c.wonders} wonders`, 'K2, Mohenjo-daro, Badshahi Mosque — 3D landmarks with sourced facts.', () => { const k = A.sites.sites.find((s) => s.name === 'Badshahi Mosque'); A.select({ site: k }); A.flyToSite(k, { distance: 200 }); }),
          card('🎬', `${c.tours} story tours`, 'Sit back: cinematic fly-throughs narrated with real numbers.', () => A.tours.openMenu()),
          card('⏳', `${c.eras} eras`, `9,000 years in one slider — ${c.eraSites} historic sites light up.`, () => A.eras.show()),
          card('🌊', '2022 flood replay', `Watch the mega-flood rise and recede over ${c.weeks} satellite snapshots.`, () => A.setLens('flood')),
          card('📊', 'District Explorer', `Sort & plot all ${c.districts} districts; brush the chart to light up the map.`, () => A.explorer.open()),
          card('⚔️', 'District Duel', 'Pick any two districts and compare them head-to-head.', () => A.duel.open()),
          card('🎲', 'Surprise me', 'Jump to an extreme: the highest tile, hottest city, oldest village…', () => A.surprise.go()),
          card('🌇', 'Light & relief', 'Day, golden hour or nightlights; stretch the mountains up to 30×.', () => A.setMood('golden')),
          card('🔎', 'Search', `Find any of ${c.districts} districts or ${fmt.int(c.sites)} places in a keystroke ( / ).`, () => A.search.open()),
          card('📜', 'Almanac', `All ${c.sources} public data sources, with dates and caveats.`, () => A.ui.almanac.open()),
        ]),
        el('div', { class: 'gw-actions' }, [
          el('button', { class: 'gw-primary', onclick: () => { this.closeWelcome(); this.start(); } }, ['▶ Start interactive walkthrough ', el('small', { text: '~2 min' })]),
          el('button', { class: 'gw-secondary', text: 'Jump right in', onclick: () => this.closeWelcome() }),
        ]),
        el('div', { class: 'gw-hint', text: 'Reopen any time with the ❔ Guide button or the ? key.' }),
      ]),
    ]);
    this.welcome.addEventListener('pointerdown', (e) => { if (e.target === this.welcome) this.closeWelcome(); });
    document.getElementById('hud').append(this.welcome);
  }

  openWelcome() {
    this.end();
    // marked on open, not on close, so a visitor who refreshes past it without
    // closing is not shown it again
    try { localStorage.setItem(STORE_KEY, 'seen'); } catch { /* ignore */ }
    this.welcome.classList.remove('hidden');
  }

  closeWelcome() {
    this.welcome.classList.add('hidden');
  }

  // ------------------------------------------------------------------ coachmarks
  _buildCoach() {
    this.spot = el('div', { class: 'gd-spot hidden' });
    this.pointerRing = el('div', { class: 'gd-pulse hidden' });
    this.counter = el('span', { class: 'gd-count' });
    this.titleEl = el('h3'); this.bodyEl = el('p');
    this.dots = el('div', { class: 'gd-dots' });
    this.backBtn = el('button', { class: 'tb-btn', text: '◀ Back', onclick: () => this.back() });
    this.nextBtn = el('button', { class: 'gw-primary small', text: 'Next ▶', onclick: () => this.next() });
    this.card = el('div', { class: 'gd-card glass hidden', role: 'dialog', 'aria-live': 'polite' }, [
      el('div', { class: 'gd-top' }, [this.counter, el('button', { class: 'gd-skip', text: 'Skip tour ✕', onclick: () => this.end() })]),
      this.titleEl, this.bodyEl, this.dots,
      el('div', { class: 'gd-nav' }, [el('span', { class: 'gd-keys', text: '← → to step · Esc to exit' }), this.backBtn, this.nextBtn]),
    ]);
    document.getElementById('hud').append(this.spot, this.pointerRing, this.card);
  }

  /** Screen rect for a world-space map point (projected), as a small square. */
  _worldRect(x, y, z, size = 90) {
    const v = new (this.app.stage.camera.position.constructor)(x, y, z).project(this.app.stage.camera);
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    return { left: sx - size / 2, top: sy - size / 2, width: size, height: size };
  }

  _nodeRect(n) {
    if (!n || n.classList.contains('hidden')) return null;
    // a full-screen modal backdrop: spotlight its first visible panel child instead
    const r0 = n.getBoundingClientRect();
    const inner = r0.width >= innerWidth - 2 && n.firstElementChild ? n.firstElementChild : n;
    const r = inner.getBoundingClientRect();
    return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }

  _rectOf(target) {
    if (!target) return null;
    if (typeof target === 'function') return target();
    const n = document.querySelector(target);
    if (!n || n.classList.contains('hidden') || !n.offsetParent && getComputedStyle(n).position !== 'fixed') return null;
    const r = n.getBoundingClientRect();
    return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }

  _steps() {
    const A = this.app;
    const city = (name) => A.sites.sites.find((s) => s.kind === 'city' && s.name === name);
    const dist = (name) => A.districts.findIndex((d) => d.name === name);
    const mapCentre = () => ({ left: innerWidth * 0.3, top: innerHeight * 0.18, width: innerWidth * 0.42, height: innerHeight * 0.64 });
    const c = this._counts();
    return [
      { title: 'This is Pakistan, tile by tile', body: `Every hexagon is a ~20 km tile of real land — ${fmt.int(c.hexes)} of them. Height comes from satellite elevation data, colour from satellite land cover: green irrigated plains, brown ranges, white Karakoram glaciers.`,
        target: mapCentre, demo: async () => { A.home(); } },
      { title: 'Move around', body: 'Drag to pan · right-drag (or two fingers) to tilt and rotate · scroll to zoom · double-click a tile to swoop in · press H to come home. Watch — we\'re orbiting now.',
        target: mapCentre, demo: async (tok) => { for (const az of [-0.7, 0.5, -0.12]) { if (tok !== this.token) return; await A.stage.flyTo(A.stage.controls.target.toArray(), { distance: 2100, tilt: 0.66, azimuth: az, duration: 1.6 }); } } },
      { title: 'Stretch the mountains', body: 'The Relief slider exaggerates height from ×1 (true scale) to ×30. Pakistan rises from 0 m at the coast to 8,611 m at K2. Shortcut: [ and ].',
        target: '.relief', demo: async (tok) => { for (const v of [22, 28, 12]) { if (tok !== this.token) return; A.setRelief(v); await wait(1100); } } },
      { title: 'Change the light', body: 'Day, Golden hour, or Nightlights — at night every tile glows with how many people live there, so the Indus and the big cities light up. Shortcut: L.',
        target: '.moods', demo: async (tok) => { for (const m of ['golden', 'night', 'day']) { if (tok !== this.token) return; A.setMood(m); await wait(1300); } } },
      { title: 'Hover and click any tile', body: 'Hovering shows a quick card; clicking opens the tile\'s full card on the right: elevation, people, modelled income, flood impact, the nearest city and wonder. Shift-click opens the whole district.',
        target: '.inspector', demo: async () => { const i = dist('Faisalabad'); const cell = A.districts[i].cells[Math.floor(A.districts[i].cells.length / 2)]; A.select({ cell }); await A.flyToCell(cell, { distance: 620, tilt: 0.85 }); } },
      { title: 'City View', body: 'Click a city banner (green = population, gold = name). You get the city\'s yields, specialised quarters (industrial, campus, harbour…), its working citizens, nearby landmarks and peer cities.',
        target: '.inspector', demo: async () => { const k = city('Karachi'); A.select({ site: k }); await A.flyToSite(k, { distance: 420, tilt: 0.9 }); } },
      { title: 'The summary bar', body: 'Cropland, Industry, Economy, Trade, Knowledge and Culture summarise real numbers: cropped area, workers by industry, and (modelled) GDP. Click one to rank every district.',
        target: '.yields', demo: async () => { A.select(null); A.home(); } },
      { title: `Lenses: ${c.lenses} ways to see the country`, body: 'A lens re-colours every tile by one measure. We just switched to Mother tongue (Census 2023) — then Literacy. Number keys 1–9 pick lenses too.',
        target: '.dock', demo: async (tok) => { A.ui.dock.classList.remove('collapsed'); A.setLens('language'); await wait(1600); if (tok === this.token) A.setLens('literacy'); } },
      { title: 'Read and brush the legend', body: 'Every lens has a legend with a histogram. Hover over the bars (or click a category) to light up just those tiles on the map. The source of every lens is linked underneath.',
        target: '.legend', demo: async (tok) => { const lens = A.atlas.lenses.find((l) => l.id === 'literacy'); await wait(500); if (tok !== this.token) return; A.highlightWhere((cell) => { const v = A.lens.valueAt(lens, cell); return v != null && v >= 75; }, null, true); } },
      { title: 'Map layers', body: `Switch on rivers, canals, the ${c.corridors} trade corridors (GT Road, Karakoram Highway, CPEC, ML-1 railway), dams, power plants, airports, shrines, cricket grounds and more.`,
        target: '.dock-items.layers', demo: async () => { A.board.setHighlight(null); A.setLens('terrain'); A.setLayer('corridors', true); A.setMood('night'); A.home(); } },
      { title: 'Replay the 2022 mega-flood', body: `The 2022 flood lens paints the satellite flood footprint; press ▶ to replay ${c.weeks} UNOSAT satellite snapshots from August to December as water rises and recedes.`,
        target: () => this._rectOf('.timebar:not(.hidden)'), demo: async () => { A.eras.hide(); A.setLayer('corridors', false); A.setMood('day'); A.setLens('flood'); A.flood.t = 0; if (!A.flood.playing) A.flood.toggle(); const [fx, fz] = A.board.mapToWorld(860, 1150); A.stage.flyTo([fx, 0, fz], { distance: 1250, tilt: 0.78, duration: 1.8 }); } },
      { title: '9,000 years on the same tiles', body: `The Era Time-Machine steps from Mehrgarh (c. 7000 BCE) through the Indus Valley, Gandhara and the Mughals to modern Pakistan — ${c.eraSites} dated sites light up with beams. Shortcut: Y.`,
        target: () => this._rectOf('.timebar:not(.hidden)'), demo: async () => { A.flood.hide(); A.setLens('terrain'); A.eras.show(); A.eras.setEra(1); } },
      { title: 'Sit back with a story tour', body: `${c.tours} "Chronicles of Pakistan" tours fly the camera, switch lenses and narrate with real numbers: K2 to the sea, the Indus food machine, the industrial belt, the 2022 deluge… Shortcut: T.`,
        target: '.tour-menu', demo: async () => { A.eras.hide(); A.tours.openMenu(); } },
      { title: 'District Explorer', body: `All ${c.districts} districts in one sortable table, plus a scatter plot. Pick any two measures, drag a box on the chart, and those districts light up on the 3D map. Shortcut: E.`,
        target: () => this._nodeRect(A.explorer.root), demo: async () => { A.tours.menu.classList.add('hidden'); A.explorer.open(); } },
      { title: 'District Duel', body: 'Put two districts in the ring — type their names or click them on the map — and compare yields, literacy, poverty, terrain and languages, with a radar chart and a verdict. Shortcut: D.',
        target: () => this._nodeRect(A.duel.root), demo: async () => { A.explorer.root.classList.add('hidden'); A.board.setHighlight(null); const a = dist('Lahore'), b = dist('South Karachi'); A.duel.open(); A.duel.set(a, b); } },
      { title: 'Search anything', body: `Press / and type: a district, a city, a dam, a peak, a shrine or a lens name. Arrow keys + Enter fly you there.`,
        target: () => this._nodeRect(A.search.root), demo: async (tok) => { A.duel.root.classList.add('hidden'); A.duel.stopPicking?.(); A.search.open(); const inp = A.search.input; inp.value = ''; for (const ch of 'tarbela') { if (tok !== this.token) return; inp.value += ch; inp.dispatchEvent(new Event('input')); await wait(140); } } },
      { title: 'Surprise me', body: 'Not sure where to start? 🎲 jumps to a remarkable extreme computed from the data — the highest tile, the hottest city, the most flooded district, the oldest village. Shortcut: S.',
        target: () => this._nodeRect(A.surprise.card), demo: async () => { A.search.close(); A.surprise.go(); } },
      { title: 'The Almanac: where every number comes from', body: `${c.sources} public sources — census, satellites, surveys — each with publisher, date, licence and honest caveats. Modelled numbers are labelled as models; missing data shows "—", never zero.`,
        target: () => this._nodeRect(A.ui.almanac.root), demo: async () => { A.surprise.card.classList.add('hidden'); A.ui.almanac.open(); } },
      { title: "You're ready!", body: 'That\'s everything. Reopen this guide any time with ❔ Guide (or ?). Want a first adventure? Start the "From K2 to the Arabian Sea" tour — or just start clicking.',
        target: '.guide-btn', final: true, demo: async () => { A.ui.almanac.root.classList.add('hidden'); A.select(null); A.home(); } },
    ];
  }

  start() {
    this.closeWelcome();
    this.app.tours.stop(false);
    this.steps = this._steps();
    this.running = true; this.i = -1;
    document.body.classList.add('guiding');
    this.dots.replaceChildren(...this.steps.map((_, k) => el('i', { onclick: () => this.go(k) })));
    this.next();
    clearInterval(this._iv); this._iv = setInterval(() => this._position(), 250);
  }

  _tidy() {
    const A = this.app;
    document.querySelectorAll('.modal:not(.guide-welcome)').forEach((m) => m.classList.add('hidden'));
    A.duel.stopPicking?.();
    if (A.flood.playing) A.flood.toggle();
    A.board.setHighlight(null);
  }

  async go(k) {
    if (!this.running) return;
    if (k < 0 || k >= this.steps.length) return this.end();
    this.i = k;
    const st = this.steps[k];
    const tok = Symbol(); this.token = tok;
    this._tidy();
    this.counter.textContent = `${k + 1} / ${this.steps.length}`;
    this.titleEl.textContent = st.title; this.bodyEl.textContent = st.body;
    [...this.dots.children].forEach((d, j) => d.classList.toggle('on', j === k));
    this.backBtn.disabled = k === 0;
    this.nextBtn.textContent = st.final ? 'Finish ✓' : 'Next ▶';
    if (st.final && !this._finalExtra) {
      this._finalExtra = el('button', { class: 'tb-btn gd-tour', text: '🏔️ Start the K2 tour', onclick: () => { this.end(); this.app.tours.run(0); } });
    }
    this._finalExtra?.remove();
    if (st.final) this.nextBtn.before(this._finalExtra);
    this.card.classList.remove('hidden'); this.card.classList.toggle('final', !!st.final);
    this.card.style.animation = 'none'; void this.card.offsetWidth; this.card.style.animation = '';
    this.current = st;
    this._position();
    try { await st.demo?.(tok); } catch (e) { console.warn('guide demo', e); }
    if (tok === this.token) this.app.mobile?.reveal(st.target);
    if (tok === this.token) this._position();
  }

  next() { this.go(this.i + 1); }
  back() { if (this.i > 0) this.go(this.i - 1); }

  end() {
    if (!this.running) return;
    this.running = false; this.token = null;
    clearInterval(this._iv);
    this._tidy();
    this.card.classList.add('hidden'); this.spot.classList.add('hidden'); this.pointerRing.classList.add('hidden');
    document.body.classList.remove('guiding');
    this.app.setLens('terrain'); this.app.setMood('day'); this.app.eras.hide(); this.app.flood.hide();
    this.app.setLayer('corridors', false);
  }

  _position() {
    if (!this.running || !this.current) return;
    const r = this._rectOf(this.current.target);
    const pad = 8;
    if (r) {
      Object.assign(this.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      this.spot.classList.remove('hidden');
    } else this.spot.classList.add('hidden');
    // place the card beside the target, else bottom-centre
    const cw = 400, ch = this.card.offsetHeight || 220, m = 16;
    let x, y;
    if (r) {
      const spaceR = innerWidth - (r.left + r.width), spaceL = r.left, spaceB = innerHeight - (r.top + r.height);
      if (spaceR > cw + m * 2) { x = r.left + r.width + m + pad; y = r.top; }
      else if (spaceL > cw + m * 2) { x = r.left - cw - m - pad; y = r.top; }
      else if (spaceB > ch + m * 2) { x = r.left + r.width / 2 - cw / 2; y = r.top + r.height + m + pad; }
      else { x = r.left + r.width / 2 - cw / 2; y = r.top - ch - m - pad; }
    } else { x = innerWidth / 2 - cw / 2; y = innerHeight - ch - 40; }
    x = Math.max(m, Math.min(innerWidth - cw - m, x)); y = Math.max(76, Math.min(innerHeight - ch - m, y));
    this.card.style.transform = `translate(${x}px, ${y}px)`;
  }
}
