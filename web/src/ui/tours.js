// "Chronicles of Pakistan": cinematic guided tours. Every number in a caption is read from the loaded data at runtime.
import { el, fmt } from './dom.js';
import { LABELS } from './lenses.js';

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export class Tours {
  constructor(app) {
    this.app = app;
    this.menu = el('div', { class: 'tour-menu glass modal hidden' });
    this.narr = el('div', { class: 'narr glass hidden' });
    // the one control cinema mode leaves on screen
    this.exitBtn = el('button', { class: 'cinema-exit', title: 'Exit (Esc)', onclick: () => this.stop() }, ['✕']);
    app.hud.append(this.menu, this.narr, this.exitBtn);
    this.tours = this._define();
    this.menu.append(
      el('div', { class: 'tour-head' }, [
        el('h3', { text: '🎬 Chronicles of Pakistan' }),
        el('button', { class: 'tb-btn on', title: 'Play every tour end to end, on a loop, with the interface out of the way',
          onclick: () => this.playAll() }, ['▶ Play all']),
      ]),
      el('div', { class: 'tour-grid' }, this.tours.map((t, k) => el('button', { class: 'tour-card', onclick: () => this.run(k) }, [el('b', { text: `${t.icon} ${t.title}` }), el('span', { text: t.sub })]))),
      el('div', { class: 'src-note', style: { marginTop: '10px' }, text: `Tours fly the camera, switch lenses and lighting, and narrate with numbers read from the datasets in the Almanac. Play all runs the ${this.tours.length} of them back to back on a loop with the interface hidden. Esc to stop · → / ← to step.` }));
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
    });
  }

  // ---------------------------------------------------------------- data helpers
  site(name, kinds) {
    const n = norm(name);
    const all = this.app.sites.sites.filter((s) => !kinds || kinds.includes(s.kind));
    return all.find((s) => norm(s.name) === n) || all.find((s) => norm(s.name).includes(n));
  }
  dist(name) { const n = norm(name); const i = this.app.districts.findIndex((d) => norm(d.name) === n); return i; }
  d(name) { return this.app.districts[this.dist(name)]; }
  fact(s, k) { return s?.facts?.[k]; }

  goSite(s, opts) { this._focus = s ? { site: s } : null; return s ? this.app.flyToSite(s, opts) : null; }
  goDist(name, opts) {
    const i = this.dist(name);
    this._focus = i >= 0 ? { district: i } : null;
    return i >= 0 ? this.app.flyToDistrict(i, opts) : null;
  }
  goXY(x, y, opts) {
    this._focus = { xy: [x, y] };
    const [wx, wz] = this.app.board.mapToWorld(x, y);
    return this.app.stage.flyTo([wx, this.app.board.heightAt(wx, wz), wz], opts);
  }

  layers(on) {
    const all = ['rivers', 'canals', 'corridors', 'roads', 'faults', 'city', 'wonder', 'unesco', 'era', 'water', 'power', 'airport', 'port', 'university', 'shrine', 'craft', 'cricket', 'park', 'quake', 'heat', 'glof'];
    for (const k of all) this.app.setLayer(k, on.includes(k));
  }

  _define() {
    const A = this.app, N = A.atlas.nation;
    return [
      {
        icon: '🏔️', title: 'From K2 to the Arabian Sea', sub: 'Ride the Indus 8,611 m down to the mangroves',
        steps: [
          () => { const k2 = this.site('K2', ['wonder']); A.setRelief(22); A.setMood('golden'); A.setLens('elevation'); this.layers(['rivers', 'wonder', 'city']);
            const hexMax = Math.max(...A.data.world.elev_max.filter((v, c) => A.data.world.owner[c] >= 0));
            return { go: () => this.goSite(k2, { distance: 340, tilt: 1.05, azimuth: 0.6 }), k: 'The roof of the country', title: 'K2 · Karakoram',
              stat: `${fmt.int(this.fact(k2, 'elevation_m'))} m`, text: `The world's second-highest summit. ${A.sites.sites.filter((s) => s.kind === 'wonder' && (s.facts?.elevation_m || 0) >= 8000).length} of the fourteen 8,000-metre peaks stand in Pakistan; our highest 90 m DEM pixel here reads ${fmt.int(hexMax)} m.`, src: ['wonders', 'copernicus_dem'] }; },
          () => { const s = this.site('Nanga Parbat', ['wonder']); return { go: () => this.goSite(s, { distance: 420, tilt: 1.0, azimuth: 1.4 }), k: 'The western anchor of the Himalaya', title: 'Nanga Parbat',
            stat: `${fmt.int(this.fact(s, 'elevation_m'))} m`, text: 'The "Killer Mountain" rises above the Indus gorge — where the Himalaya, Karakoram and Hindu Kush meet.', src: ['wonders'] }; },
          () => { const s = this.site('Tarbela', ['water']); A.setLens('terrain'); return { go: () => this.goSite(s, { distance: 300, tilt: 0.95 }), k: 'Hydraulic giant', title: 'Tarbela Dam',
            stat: s?.mw ? `${fmt.int(s.mw)} MW` : '', text: `Completed ${s?.year ?? '—'}, the Indus is held back in a reservoir with ${s?.storage_maf ?? '—'} million acre-feet of live storage.`, src: ['water_infra'] }; },
          () => { const s = this.site('Sukkur Barrage', ['water']) || this.site('Sukkur', ['water']); A.setMood('day'); return { go: () => this.goSite(s, { distance: 380, tilt: 0.9 }), k: 'Lifeline of Sindh', title: s?.name || 'Sukkur Barrage',
            stat: s?.year ? String(s.year) : '', text: 'Built in the Raj era, the Lloyd Barrage diverts the Indus into seven canals that water the Sindh plain.', src: ['water_infra'] }; },
          () => { const s = this.site('Indus Delta', ['wonder']) || this.site('mangrove', ['wonder']); A.setLens('elevation'); return { go: () => (s ? this.goSite(s, { distance: 520, tilt: 0.85 }) : this.goDist('Thatta', { distance: 520 })), k: 'Sea level', title: s?.name || 'The Indus Delta',
            stat: '0 m', text: s?.blurb || 'The Indus fans out into creeks and mangroves before meeting the Arabian Sea.', src: ['wonders', 'copernicus_dem'] }; },
        ],
      },
      {
        icon: '🌾', title: 'The Indus Food Machine', sub: "Barrages, canals and the world's great irrigation plain",
        steps: [
          () => { A.setRelief(10); A.setMood('day'); A.setLens('farmland'); this.layers(['rivers', 'canals', 'water']); A.lines.setTreatyView(true);
            const crop = A.data.world.pct.crop, own = A.data.world.owner; let n = 0, f = 0; for (let c = 0; c < own.length; c++) if (own[c] >= 0) { n++; if (crop[c] > 40) f++; }
            return { go: () => this.goXY(1050, 820, { distance: 1500, tilt: 0.75 }), k: 'The canal colonies', title: 'Green between deserts', stat: `${Math.round((100 * f) / n)}%`,
              text: `of Pakistan's hexes are more than 40% cropland (ESA WorldCover) — almost all of them along the Indus and its five Punjab rivers. Rivers glow green (western, Pakistan's under the 1960 Indus Waters Treaty) and orange (eastern, India's).`, src: ['esa_worldcover', 'water_infra'] }; },
          () => { A.setLens('crop'); const wheat = A.districts.filter((d) => d.top_crop === 'wheat').length;
            return { go: () => this.goXY(1150, 700, { distance: 900, tilt: 0.85 }), k: 'Wheat belt', title: 'What the fields grow', stat: `${wheat}`,
              text: `districts where wheat covers the largest cropped area (Agricultural Census 2024). Cotton and rice dominate where water and heat allow.`, src: ['crops'] }; },
          () => { const s = this.site('Guddu', ['water']); return { go: () => this.goSite(s, { distance: 420, tilt: 0.9 }), k: 'Command areas', title: s?.name || 'Guddu Barrage',
            stat: s?.year ? String(s.year) : '', text: 'Barrages lift the river into canals feeding millions of acres — the difference between farmland and desert is a canal head.', src: ['water_infra'] }; },
          () => { A.setLens('desert'); A.lines.setTreatyView(false); const th = this.d('Tharparkar');
            return { go: () => this.goDist('Tharparkar', { distance: 700 }), k: 'Beyond the canals', title: 'Thar Desert', stat: th?.literacy != null ? fmt.pct(th.literacy, 0) : '',
              text: `literacy in Tharparkar (Census 2023) — out here, beyond the canals, rain decides. Compare the green ribbon of the Indus a few hexes west.`, src: ['esa_worldcover', 'census2023'] }; },
        ],
      },
      {
        icon: '🏭', title: 'Made in Pakistan: the Industrial Belt', sub: 'Faisalabad, Sialkot, Gujranwala, Karachi',
        steps: [
          () => { A.setRelief(8); A.setMood('golden'); A.setLens('industry'); this.layers(['city', 'roads', 'corridors']); const f = this.d('Faisalabad');
            return { go: () => this.goDist('Faisalabad', { distance: 520 }), k: 'Manchester of Pakistan', title: 'Faisalabad', stat: f?.lq?.C ? `×${f.lq.C}` : '',
              text: `manufacturing specialisation (location quotient, Economic Census 2023): ${fmt.int(f?.workforce?.C)} manufacturing workers in establishments — the textile capital born as the canal-colony town of Lyallpur.`, src: ['econ_census'] }; },
          () => { const s = this.d('Sialkot'); return { go: () => this.goDist('Sialkot', { distance: 420 }), k: 'Footballs & scalpels', title: 'Sialkot', stat: s?.lq?.C ? `×${s.lq.C}` : '',
            text: `manufacturing LQ. Sialkot's workshops export surgical instruments and match footballs; ${fmt.int(s?.workforce?.C)} manufacturing workers counted.`, src: ['econ_census', 'culture'] }; },
          () => { const g = this.d('Gujranwala'); return { go: () => this.goDist('Gujranwala', { distance: 420 }), k: 'Workshop city', title: 'Gujranwala', stat: g?.yields?.production ? fmt.big(g.yields.production) : '',
            text: 'Production workers (mining, manufacturing, utilities, construction) — fans, pumps, cutlery and light engineering along the GT Road.', src: ['econ_census'] }; },
          () => { const k = this.site('Karachi', ['port']) || this.site('Karachi Port'); const q = this.site('Port Qasim'); A.setMood('night');
            return { go: () => this.goSite(this.site('Karachi', ['city']), { distance: 520, tilt: 0.9 }), k: 'Gateway to the sea', title: 'Karachi', stat: k?.cargo_t ? `${fmt.big((k.cargo_t || 0) + (q?.cargo_t || 0))} t` : '',
              text: `of cargo through Karachi Port and Port Qasim in FY2023-24 (Pakistan Economic Survey) — the commercial heart of a ${fmt.big(this.site('Karachi', ['city'])?.pop)}-person metropolis (Census 2023).`, src: ['ports', 'cities'] }; },
        ],
      },
      {
        icon: '🏛️', title: '5,000 Years of Wonders', sub: 'Mehrgarh → Mohenjo-daro → Taxila → Lahore → Islamabad',
        steps: [
          () => { A.setRelief(10); A.setMood('golden'); A.setLens('terrain'); this.layers(['era', 'wonder', 'rivers']); const s = this.site('Mehrgarh', ['era']);
            return { go: () => this.goSite(s, { distance: 300, tilt: 1.0 }), k: 'c. 7000 BCE', title: 'Mehrgarh', stat: '9,000 yrs', text: s?.blurb || '', src: ['eras'] }; },
          () => { const s = this.site('Mohenjo-daro', ['era']) || this.site('Moenjodaro'); return { go: () => this.goSite(s, { distance: 280, tilt: 1.0, azimuth: 2.2 }), k: 'c. 2500 BCE', title: 'Mohenjo-daro',
            stat: 'UNESCO 1980', text: 'One of the largest cities of the Bronze Age: grid streets, drains and the Great Bath, on the Indus floodplain.', src: ['unesco', 'eras'] }; },
          () => { const s = this.site('Sirkap', ['era']) || this.site('Taxila'); return { go: () => this.goSite(s, { distance: 280, tilt: 1.0 }), k: 'Gandhara', title: 'Taxila', stat: 'UNESCO 1980',
            text: 'Crossroads of Persian, Greek and Buddhist worlds — Bhir Mound, Sirkap and Jaulian span a thousand years.', src: ['unesco', 'eras'] }; },
          () => { const s = this.site('Badshahi Mosque', ['wonder', 'era']); return { go: () => this.goSite(s, { distance: 240, tilt: 1.05, azimuth: -0.6 }), k: 'Mughal Lahore', title: 'Badshahi Mosque & Lahore Fort',
            stat: '1673', text: 'Aurangzeb\'s red-sandstone mosque faces the Lahore Fort and Shalamar Gardens — two UNESCO-listed Mughal masterpieces nearby.', src: ['wonders', 'unesco'] }; },
          () => { const s = this.site('Faisal Mosque', ['wonder', 'era']); A.setMood('night'); return { go: () => this.goSite(s, { distance: 260, tilt: 1.0 }), k: 'Modern Pakistan', title: 'Faisal Mosque, Islamabad',
            stat: '1986', text: 'The capital, planned in the 1960s at the foot of the Margalla Hills, crowned by Vedat Dalokay\'s tent-like mosque.', src: ['wonders', 'eras'] }; },
        ],
      },
      {
        icon: '🌊', title: 'The 2022 Deluge', sub: 'Watch the mega-flood rise and recede, week by week',
        steps: [
          () => { const fl = N.flood2022 || {}; A.setRelief(8); A.setMood('day'); A.setLens('flood'); this.layers(['rivers']);
            return { go: () => this.goXY(860, 1180, { distance: 1100, tilt: 0.8 }), k: 'Monsoon 2022', title: 'A third of a country underwater?', stat: `${fmt.int(N.flood_national_km2?.[0])} km²`,
              text: `maximum flood water mapped by UNOSAT satellites in August 2022. ${fl.deaths ? fmt.int(fl.deaths.value) + ' people died (NDMA)' : ''}${fl.damage_usd_bn ? `; damage $${fl.damage_usd_bn.value}bn and losses $${fl.losses_usd_bn?.value}bn (PDNA)` : ''}.`, src: ['unosat_flood', 'hazards'] }; },
          () => { A.flood.t = 0; A.flood.toggle(); const top = [...A.districts].filter((d) => d.flood_pct != null).sort((a, b) => b.flood_pct - a.flood_pct)[0];
            return { go: () => this.goDist(top.name, { distance: 560 }), k: 'Surge playback', title: `${top.name}`, stat: fmt.pct(top.flood_pct, 0),
              text: `of the district under water at the August peak — the hardest-hit district in UNOSAT's table. Water caps now replay the weekly extents through December.`, src: ['unosat_flood'], dwell: 11000 }; },
          () => { const j = A.sites.sites.find((s) => s.kind === 'heat' && s.facts?.rank_mean_max === 1); this.layers(['rivers', 'heat']);
            return { go: () => this.goSite(j, { distance: 380 }), k: 'Heat before the water', title: j?.name || 'Jacobabad', stat: j?.facts?.hottest_month_mean_max_c ? `${j.facts.hottest_month_mean_max_c} °C` : '',
              text: `average daily maximum in ${j?.facts?.hottest_month || 'June'} — the hottest month-average of any Pakistani station in our set; its record is ${j?.facts?.record_high_c ?? '—'} °C.`, src: ['hazards'] }; },
        ],
      },
      {
        icon: '🗣️', title: 'Tongues of the Indus', sub: 'Mother tongues and faiths from the 2023 census',
        steps: [
          () => { A.setRelief(6); A.setMood('day'); A.setLens('language'); this.layers(['city']); const counts = {}; for (const d of A.districts) if (d.top_language) counts[d.top_language] = (counts[d.top_language] || 0) + 1;
            return { go: () => this.goXY(1000, 860, { distance: 1800, tilt: 0.72 }), k: 'Census 2023 · Table 11', title: 'A mosaic of mother tongues', stat: `${Object.keys(counts).length}`,
              text: `different languages are the most-spoken mother tongue in at least one district: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${LABELS[k] || k} ${n}`).join(', ')}.`, src: ['census2023'] }; },
          () => { A.setLens('langdiv'); const top = [...A.districts].filter((d) => d.lang_diversity != null).sort((a, b) => b.lang_diversity - a.lang_diversity)[0];
            return { go: () => this.goDist(top.name, { distance: 520 }), k: 'Babel on the Indus', title: top.name, stat: top.lang_diversity.toFixed(2),
              text: `chance that two random residents have different mother tongues — the most linguistically diverse district in Pakistan.`, src: ['census2023'] }; },
          () => { A.setLens('faith'); const top = [...A.districts].filter((d) => d.non_muslim_pct != null).sort((a, b) => b.non_muslim_pct - a.non_muslim_pct)[0];
            return { go: () => this.goDist(top.name, { distance: 560 }), k: 'Census 2023 · Table 9', title: top.name, stat: fmt.pct(top.non_muslim_pct, 1),
              text: `of residents are not Muslim — the largest share in Pakistan, mostly ${LABELS[top.largest_minority] || top.largest_minority} — in the Thar desert of Sindh.`, src: ['census2023'] }; },
        ],
      },
      {
        icon: '🐪', title: 'Caravans & Corridors', sub: 'GT Road, the Karakoram Highway, CPEC and ML-1',
        steps: [
          () => { A.setRelief(10); A.setMood('night'); A.setLens('terrain'); this.layers(['corridors', 'city', 'port']); A.lines.focusCorridor('kkh');
            const s = this.site('Khunjerab', ['wonder']); return { go: () => (s ? this.goSite(s, { distance: 520, tilt: 0.95 }) : this.goXY(1380, 250, { distance: 600 })), k: 'The Silk Road reborn', title: 'Karakoram Highway',
              stat: s?.facts?.elevation_m ? `${fmt.int(s.facts.elevation_m)} m` : 'N-35', text: 'From Hasan Abdal up the Indus and Hunza gorges to the Khunjerab Pass on the China border.', src: ['transport', 'wonders'] }; },
          () => { A.lines.focusCorridor('gt'); return { go: () => this.goXY(1200, 560, { distance: 820, tilt: 0.85, azimuth: -0.4 }), k: 'Sher Shah Suri, 16th century', title: 'Grand Trunk Road', stat: 'N-5',
            text: 'Lahore → Gujranwala → Jhelum → Rawalpindi → Peshawar → the Khyber: the GT Road still threads the Punjab\'s cities like beads.', src: ['transport'] }; },
          () => { A.lines.focusCorridor('ml1'); return { go: () => this.goXY(1000, 900, { distance: 1500, tilt: 0.78 }), k: 'Steel spine', title: 'ML-1 Main Line', stat: 'Karachi ⇄ Peshawar',
            text: 'Pakistan Railways\' trunk line, shown in white with moving trains of light, parallels the Indus for most of its length.', src: ['transport'] }; },
          () => { A.lines.focusCorridor('cpec_west'); const g = this.site('Gwadar', ['port']) || this.site('Gwadar');
            return { go: () => this.goSite(g, { distance: 620, tilt: 0.9 }), k: 'China–Pakistan Economic Corridor', title: 'Gwadar', stat: 'CPEC',
              text: 'The western alignment links the deep-sea port at Gwadar to the north; the eastern alignment runs the motorway spine from Karachi to Hazara.', src: ['transport', 'ports'] }; },
          () => { A.lines.focusCorridor(null); A.setMood('night'); return { go: () => A.home(), k: 'All routes', title: 'Caravans & Corridors', stat: '',
            text: 'Every glowing pulse is a caravan of light moving along a real OSM-mapped highway or railway — not freight volumes, which Pakistan does not publish as an origin–destination matrix.', src: ['transport'] }; },
        ],
      },
    ];
  }

  // ---------------------------------------------------------------- player
  openMenu() { this.stop(false); this.menu.classList.toggle('hidden'); }

  /**
   * Play every tour end to end on a loop, with the interface out of the way.
   * Nothing is left on screen but the one exit control, so this suits a
   * screen in a room, or a recording.
   */
  playAll() {
    this.menu.classList.add('hidden');
    this.loopAll = true;
    this.loopAt = 0;
    document.body.classList.add('cinema');
    this.run(0);
  }

  /** Next tour in the loop, wrapping at the end. run() leaves loopAll alone. */
  _nextInLoop() {
    this.loopAt = (this.loopAt + 1) % this.tours.length;
    this.run(this.loopAt);
  }

  async run(k) {
    this.menu.classList.add('hidden');
    this.app.eras?.hide(); this.app.select(null);
    this.active = { tour: this.tours[k], i: -1, token: Symbol() };
    document.body.classList.add('touring');
    this.next();
  }

  async show(i) {
    const a = this.active; if (!a) return;
    a.i = i;
    const steps = a.tour.steps;
    if (i < 0 || i >= steps.length) {
      // in cinema the end of a tour is the start of the next one, forever
      if (this.loopAll && i >= steps.length) return this._nextInLoop();
      return this.stop();
    }
    const token = Symbol(); a.token = token;
    let st;
    try { st = steps[i](); } catch (e) { console.warn('tour step failed', e); return this.next(); }
    const dwell = st.dwell || 7500;
    const prog = el('div', { class: 'prog', style: { width: '0%' } });
    this.narr.replaceChildren(
      el('div', { class: 'narr-head' }, [
        el('div', { class: 'k', text: `${a.tour.icon} ${a.tour.title}` }),
        el('button', { class: 'narr-x', text: '✕', title: 'End tour (Esc)', onclick: () => this.stop() }),
      ]),
      el('div', { class: 'narr-body' }, [
        el('div', { class: 'narr-step', text: st.k }),
        el('h3', { text: st.title }),
        el('p', {}, [st.stat ? el('span', { class: 'stat', text: st.stat }) : '', st.text]),
        el('div', { class: 'src', text: `Data: ${st.src.map((s) => this.app.sourceTitle(s)).join(' · ')}` }),
      ]),
      el('div', { class: 'dots' }, steps.map((_, j) => el('i', { class: j === i ? 'on' : '' }))),
      el('div', { class: 'row' }, [
        el('div', { class: 'count', text: `${i + 1} / ${steps.length}` }),
        el('div', { class: 'narr-ctl' }, [
          el('button', { class: 'tb-btn', text: '◀', title: 'Previous (←)', onclick: () => this.prev() }),
          el('button', { class: 'tb-btn', text: this.paused ? '▶' : '❚❚', title: 'Pause / resume', onclick: (e) => { this.paused = !this.paused; e.target.textContent = this.paused ? '▶' : '❚❚'; } }),
          el('button', { class: 'tb-btn', text: i === steps.length - 1 ? 'Finish' : '▶', title: i === steps.length - 1 ? 'Finish tour' : 'Next (→)', onclick: () => this.next() }),
        ]),
      ]),
      prog);
    this.narr.classList.remove('hidden');
    this.narr.style.animation = 'none'; void this.narr.offsetWidth; this.narr.style.animation = '';
    this._focus = null;
    this.app.focusOn(null);
    await st.go?.();
    if (!this.active || this.active.token !== token) return;
    this.app.focusOn(this._focus);
    // auto-advance
    let t = 0;
    while (t < dwell) {
      await new Promise((r) => setTimeout(r, 100));
      if (!this.active || this.active.token !== token) return;
      if (!this.paused) t += 100;
      prog.style.width = `${(100 * t) / dwell}%`;
    }
    if (this.active && this.active.token === token) this.next();
  }

  next() { if (this.active) this.show(this.active.i + 1); }
  prev() { if (this.active) this.show(Math.max(0, this.active.i - 1)); }

  /**
   * End the tour. A tour leaves the camera, lens and lighting wherever it
   * finished, so by default ending one returns to the home state — whether it
   * was closed, escaped, or played to the last step.
   * goHome is false for callers that are about to take over the view
   * themselves (picking another tour, starting the walkthrough, Home itself),
   * which also keeps resetView from calling back into here.
   */
  stop(goHome = true) {
    if (!this.active) return;
    this.active = null; this.paused = false;
    // whether it was ✕, Esc, or the menu, cinema ends here
    this.loopAll = false;
    document.body.classList.remove('cinema');
    this.narr.classList.add('hidden'); document.body.classList.remove('touring');
    this.app.lines.focusCorridor(null);
    this.app.focusOn(null);
    this.app.flood?.hide(); if (this.app.lens.current === 'flood') this.app.flood.show();
    if (goHome) this.app.resetView();
  }
}
