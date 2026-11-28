// Phone layout. The map is the whole screen; everything else waits behind a
// row of icon buttons and opens as one bottom sheet at a time. Desktop never
// sees any of this: it only acts while MOBILE_QUERY matches, and all of its
// styling is scoped under body.mobile.
import './mobile.css';
import * as THREE from 'three';
import { el } from './dom.js';

// Phones in portrait, plus phones held sideways (short and touch-driven).
export const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse) and (max-height: 520px)';

// 24px line icons, drawn in currentColor so they take the HUD's amber/ice.
const ICON = {
  lenses: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5" opacity=".55"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  tours: '<path d="M3.5 5.5h17v13h-17z"/><path d="m10 9 5 3-5 3V9Z"/>',
  explore: '<path d="M4 3.5v16.5h16.5"/><circle cx="8.5" cy="14.5" r="1.3"/><circle cx="12.5" cy="10.5" r="1.3"/><circle cx="17" cy="6.5" r="1.3"/><circle cx="15.5" cy="14" r="1.3"/>',
  duel: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4M7 17l-3 3M3 19l2 2"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  guide: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.8"/><path d="M12 16.9v.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  eras: '<path d="M5.5 3h13M5.5 21h13"/><path d="M7 3v3.5c0 2 5 4 5 5.5s-5 3.5-5 5.5V21M17 3v3.5c0 2-5 4-5 5.5s5 3.5 5 5.5V21"/>',
  surprise: '<path d="M4 4h16v16H4z"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/>',
  almanac: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2V4.5Z"/><path d="M5 18a2 2 0 0 1 2-2h11.5M9 8.5h6M9 11.5h4"/>',
  walk: '<path d="M5 5.5 12 3l7 2.5v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9v-6Z"/><path d="m10 9.5 4 2.5-4 2.5v-5Z"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/>',
};
const icon = (k) => el('span', { class: 'm-ico', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${ICON[k]}</svg>` });

export class MobileUI {
  constructor(app, { defaultLens }) {
    this.app = app;
    this.defaultLens = defaultLens;
    this.mq = matchMedia(MOBILE_QUERY);
    this.on = false;
    this._moved = [];
    this._build();
    this._watch();
    this.mq.addEventListener('change', () => this._apply(true));
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this._resized(), 120); });
    app.onLens = (lens) => this._peek(lens);
    this._apply(false);
  }

  // ------------------------------------------------------------------ chrome
  _build() {
    const A = this.app;
    const ibtn = (k, label, fn) => el('button', { class: `m-ibtn glass m-${k}`, title: label, 'aria-label': label, onclick: fn }, [icon(k)]);
    this.top = el('div', { class: 'm-top' }, [
      el('button', { class: 'm-brand glass', title: 'Fly back to the whole country', 'aria-label': 'living pakistan: fly back to the whole country', onclick: () => A.home() }, [
        el('span', { class: 'flag m-flag' }), el('span', { class: 'm-brand-name', text: 'living pakistan' })]),
      el('div', { class: 'm-top-right' }, [
        ibtn('search', 'Search places, districts and lenses', () => this.toggle('search')),
        ibtn('guide', 'Guide & walkthrough', () => this.toggle('guide')),
      ]),
    ]);

    // the dock: one button per sheet, the one that is open lit in amber
    const DOCK = [['lenses', 'Lenses'], ['light', 'Light'], ['tours', 'Tours'], ['explore', 'Explore'], ['duel', 'Duel'], ['more', 'More']];
    this.dock = el('nav', { class: 'm-dock glass', 'aria-label': 'Map tools' }, DOCK.map(([k, label]) =>
      el('button', { class: 'm-dbtn', 'data-sheet': k, title: label, 'aria-label': label, 'aria-expanded': 'false', onclick: () => this.toggle(k) }, [icon(k), el('span', { class: 'm-dlabel', text: label })])));

    // the current lens, when it is not the default, as a small key above the dock
    this.peekSwatch = el('i', { class: 'm-peek-sw' });
    this.peekLabel = el('span', { class: 'm-peek-label' });
    this.peek = el('button', { class: 'm-peek glass hidden', title: 'Legend and lenses', 'aria-label': 'Show the legend and lenses', onclick: () => this.open('lenses') },
      [this.peekSwatch, this.peekLabel, el('span', { class: 'm-peek-more', text: 'Key' })]);

    this.lensBody = el('div', { class: 'm-sheet-body' });
    this.lightBody = el('div', { class: 'm-sheet-body' });
    this.qualityRow = this._qualityRow();
    const tile = (k, title, sub, fn) => el('button', { class: 'm-tile', onclick: fn }, [icon(k), el('b', { text: title }), el('small', { text: sub })]);
    this.glance = el('div', { class: 'm-glance' });
    this.moreBody = el('div', { class: 'm-sheet-body' }, [
      el('div', { class: 'm-tiles' }, [
        tile('eras', 'Eras', '9,000 years', () => { this.close('more'); A.eras.show(); }),
        tile('surprise', 'Surprise', 'An outlier', () => A.surprise.go()),
        tile('almanac', 'Almanac', 'Every source', () => A.ui.almanac.open()),
        tile('guide', 'Welcome', 'What is here', () => A.guide.openWelcome()),
        tile('walk', 'Walkthrough', 'Two minutes', () => { this.close('more'); A.guide.start(); }),
        tile('home', 'Reset view', 'Start over', () => A.resetView()),
      ]),
      el('div', { class: 'm-sub', text: 'Pakistan at a glance' }), this.glance,
    ]);
    const sheet = (k, title, body) => el('section', { class: `modal m-sheet m-sheet-${k} glass hidden`, role: 'dialog', 'aria-label': title }, [
      el('header', { class: 'm-sheet-head' }, [el('h2', { class: 'm-sheet-title', text: title }), this._x(() => this.close(k))]), body]);
    this.own = {
      lenses: sheet('lenses', 'Lenses & layers', this.lensBody),
      light: sheet('light', 'Light & relief', this.lightBody),
      more: sheet('more', 'More', this.moreBody),
    };
    A.hud.append(this.top, this.peek, this.dock, ...Object.values(this.own));

    // panels that have no close button of their own get one, shown on phones only
    A.tours.menu.querySelector('.tour-head')?.append(this._x(() => A.tours.menu.classList.add('hidden')));
    A.search.root.querySelector('.srch-bar')?.append(this._x(() => A.search.close()));
    A.eras.root.querySelector('h5')?.append(this._x(() => A.eras.hide()));
    A.flood.root.querySelector('h5')?.append(this._x(() => A.setLens(this.defaultLens)));

    // Every panel that can open, and how to put it away. Only one is ever on
    // screen; the time bars and tour narration are not in this list, and step
    // aside while a sheet is up instead (see mobile.css).
    this.sheets = [
      ...Object.entries(this.own).map(([key, node]) => ({ key, node })),
      { key: 'tours', node: A.tours.menu, open: () => { A.tours.stop(false); A.tours.menu.classList.remove('hidden'); } },
      { key: 'search', node: A.search.root, close: () => A.search.close(), open: () => A.search.open() },
      { key: 'explore', node: A.explorer.root, open: () => A.explorer.open() },
      { key: 'duel', node: A.duel.root, open: () => A.duel.open() },
      { key: 'guide', node: A.guide.welcome, close: () => A.guide.closeWelcome(), open: () => A.guide.openWelcome() },
      { key: 'almanac', node: A.ui.almanac.root },
      { key: 'surprise', node: A.surprise.card },
      // hiding the card keeps the selection lit on the map
      { key: 'inspector', node: A.inspector.root },
    ];
    this.byKey = Object.fromEntries(this.sheets.map((s) => [s.key, s]));
  }

  /** Graphics quality as three chips in the Light sheet (desktop has a cycling chip instead). */
  _qualityRow() {
    const q = this.app.quality;
    if (!q) return null;
    const chips = ['low', 'auto', 'high'].map((m) => el('button', { class: 'chip', 'data-quality': m, onclick: () => q.setMode(m) },
      [{ low: 'Low', auto: 'Auto', high: 'High' }[m]]));
    const note = el('small', { class: 'm-quality-note' });
    const sync = () => {
      for (const c of chips) c.classList.toggle('on', c.dataset.quality === q.mode);
      note.textContent = q.mode === 'auto' ? `Running ${q.tier}` : q.mode === 'low' ? 'Lightest, for older phones' : 'Full detail';
    };
    q.onChange(sync); sync();
    return el('div', { class: 'm-quality' }, [el('div', { class: 'm-quality-head' }, [el('span', { text: 'Graphics' }), note]), el('div', { class: 'm-quality-chips' }, chips)]);
  }

  _x(fn) { return el('button', { class: 'm-x', title: 'Close', 'aria-label': 'Close', onclick: fn }, [icon('close')]); }

  // ------------------------------------------------------------------ one sheet at a time
  _visible(n) { return !n.classList.contains('hidden'); }

  isOpen(key) { const s = this.byKey[key]; return !!s && this._visible(s.node); }

  open(key) {
    const s = this.byKey[key];
    if (!s) return;
    if (s.open) s.open(); else s.node.classList.remove('hidden');
  }

  close(key) {
    const s = this.byKey[key];
    if (s && this._visible(s.node)) { if (s.close) s.close(); else s.node.classList.add('hidden'); }
  }

  toggle(key) { if (this.isOpen(key)) this.close(key); else this.open(key); }

  /** Close whatever is open. Returns true if anything was. */
  closeAll({ keepInspector = false } = {}) {
    let any = false;
    for (const s of this.sheets) {
      if (keepInspector && s.key === 'inspector') continue;
      if (this._visible(s.node)) { this.close(s.key); any = true; }
    }
    return any;
  }

  /**
   * A tap on the map while a sheet is up puts the sheet away rather than
   * picking a tile underneath it. The inspector is the exception: tapping
   * another tile is how you move it along, so that tap goes through.
   */
  dismissOnTap() {
    if (!this.on) return false;
    if (!this.closeAll({ keepInspector: true })) return false;
    if (!this.isOpen('inspector') && this.app.selection) this.app.select(null);
    return true;
  }

  _watch() {
    const mo = new MutationObserver((records) => {
      if (this.on) {
        // the first panel to open in a batch wins: Surprise shows its card and
        // then selects its place, and the card is what was asked for
        const opened = records.find((r) => this._visible(r.target) && /(^|\s)hidden(\s|$)/.test(r.oldValue || ''))?.target;
        if (opened) for (const s of this.sheets) if (s.node !== opened && this._visible(s.node)) this.close(s.key);
      }
      this._sync();
    });
    for (const s of this.sheets) mo.observe(s.node, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }

  _sync() {
    const open = this.sheets.find((s) => this._visible(s.node));
    document.body.classList.toggle('m-sheet-open', !!(this.on && open));
    for (const b of this.dock.querySelectorAll('[data-sheet]')) {
      const on = !!open && open.key === b.dataset.sheet;
      b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on));
    }
    for (const k of ['search', 'guide']) this.top.querySelector(`.m-${k}`).classList.toggle('on', !!open && open.key === k);
  }

  _peek(lens) {
    const sc = this.app.lens.scale;
    const show = lens.id !== this.defaultLens && lens.level !== 'none' && sc;
    this.peek.classList.toggle('hidden', !show);
    if (!show) return;
    const cols = sc.cat ? Object.entries(sc.counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => sc.pal[k] || '#888') : sc.stops;
    this.peekSwatch.style.background = sc.cat
      ? `linear-gradient(90deg, ${cols.map((c, i) => `${c} ${(i * 100) / cols.length}% ${((i + 1) * 100) / cols.length}%`).join(', ')})`
      : `linear-gradient(90deg, ${cols.join(', ')})`;
    this.peekLabel.textContent = lens.label;
  }

  // ------------------------------------------------------------------ switching layouts
  /** Lift a desktop panel into a sheet, leaving a marker where it came from. */
  _move(node, into) {
    if (!node) return;
    const mark = document.createComment('mobile');
    node.replaceWith(mark); into.append(node);
    this._moved.push([node, mark]);
  }

  _apply(rehome) {
    const on = this.mq.matches;
    if (on === this.on) return;
    this.on = on;
    const A = this.app;
    document.body.classList.toggle('mobile', on);
    if (on) {
      this._move(A.ui.legend, this.lensBody);
      this._move(A.ui.dock, this.lensBody);
      this._move(A.hud.querySelector('.moods'), this.lightBody);
      this._move(A.reliefEl, this.lightBody);
      if (this.qualityRow) this.lightBody.append(this.qualityRow);
      this._move(A.hud.querySelector('.topbar .yields'), this.glance);
      A.tip.classList.add('hidden');
    } else {
      for (const [node, mark] of this._moved.splice(0)) mark.replaceWith(node);
      this.closeAll();
    }
    this._sync();
    this._camera();
    if (rehome) A.home(true);
  }

  _resized() {
    const wasHome = this._atHome();
    this._camera();
    if (this.on && wasHome) this.app.home(true);
  }

  // ------------------------------------------------------------------ camera
  _camera() {
    const { camera, controls } = this.app.stage;
    // a portrait screen is narrow across, so it gets a wider lens; the country
    // then fits without pulling the camera so far back that the relief flattens
    camera.fov = this.on && camera.aspect < 1 ? 50 : 38;
    camera.updateProjectionMatrix();
    if (!this.on) controls.maxDistance = 3200;
  }

  _atHome() {
    const { camera, flight } = this.app.stage;
    return !flight && !!this._homePos && camera.position.distanceTo(this._homePos) < 3;
  }

  /** Points that outline the country, at the height they are drawn. */
  _country() {
    const A = this.app, own = A.data.world.owner, pts = [];
    for (let c = 0; c < own.length; c++) if (own[c] >= 0) { const [x, y, z] = A.cellWorld(c); pts.push(new THREE.Vector3(x, Math.max(y, 0), z)); }
    return pts;
  }

  /**
   * Where the camera should sit so the whole country fills the clear space
   * between the top buttons and the dock, centred in it. Found numerically,
   * so it holds for any screen shape: pick a distance that fits the
   * country's on-screen extent, then slide the target until it is centred.
   */
  homePose() {
    const A = this.app, cam = A.stage.camera;
    const W = innerWidth, H = innerHeight;
    const key = `${W}x${H}:${A.board.exaggeration}:${cam.fov}`;
    if (this._pose?.key === key) return this._pose;
    const pts = this._country();
    const tilt = cam.aspect < 1 ? 0.5 : 0.58, az = -0.55;
    // the clear space: below the top buttons, and clear of the dock, which
    // runs along the bottom, or down the right side on a phone held sideways
    const dock = this.dock.getBoundingClientRect(), rail = dock.height > dock.width;
    const topPx = this.top.getBoundingClientRect().bottom + 10;
    const botPx = rail ? 16 : H - dock.top + 12;
    const left = 16, right = rail ? W - dock.left + 12 : 16;
    const ndc = { x0: -1 + (2 * left) / W, x1: 1 - (2 * right) / W, y0: -1 + (2 * botPx) / H, y1: 1 - (2 * topPx) / H };
    const probe = cam.clone(); probe.aspect = W / H; probe.updateProjectionMatrix();
    const v = new THREE.Vector3(), t = new THREE.Vector3();
    const box = new THREE.Box3().setFromPoints(pts); box.getCenter(t); t.y = 0;
    const place = (d) => {
      probe.position.set(t.x + d * Math.sin(tilt) * Math.sin(az), t.y + d * Math.cos(tilt), t.z + d * Math.sin(tilt) * Math.cos(az));
      probe.lookAt(t); probe.updateMatrixWorld();
    };
    const extent = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) { v.copy(p).project(probe); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      return { x0, x1, y0, y1 };
    };
    const ground = (x, y) => {
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(x, y), probe);
      return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    };
    let d = 2400;
    for (let it = 0; it < 4; it++) {
      let lo = 300, hi = 12000;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2; place(mid); const e = extent();
        if (e.x1 - e.x0 <= ndc.x1 - ndc.x0 && e.y1 - e.y0 <= ndc.y1 - ndc.y0) hi = mid; else lo = mid;
      }
      d = hi; place(d);
      const e = extent();
      const a = ground((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2), b = ground((ndc.x0 + ndc.x1) / 2, (ndc.y0 + ndc.y1) / 2);
      if (!a || !b) break;
      t.x += a.x - b.x; t.z += a.z - b.z;
    }
    A.stage.controls.maxDistance = Math.max(3200, d * 1.4);
    this._pose = { key, x: t.x, z: t.z, dist: d, tilt, az };
    return this._pose;
  }

  /** Walkthrough: open the sheet that holds what a step is pointing at. */
  reveal(target) {
    if (!this.on || typeof target !== 'string') return;
    document.querySelector(target)?.closest('.m-sheet')?.classList.remove('hidden');
  }

  /** Remember where home() is sending the camera, so a rotation can re-fit it. */
  homed(pos) { this._homePos = pos; }
}
