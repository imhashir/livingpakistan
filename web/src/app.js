// Application controller: wires the 3D scene to the HUD.
import * as THREE from 'three';
import { el, fmt } from './ui/dom.js';
import { Borders } from './scene/borders.js';

export class App {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.mood = 'day';
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverCell = -1;
    this.districts = ctx.data.districts.districts;
    this.hud = document.getElementById('hud');
  }

  async init() {
    const { board, stage } = this;
    this.borders = new Borders(board, this.districts, stage.scene);
    board.onExaggeration = () => this.borders.build();
    this.setMood('day');
    this.buildHud();
    // default camera: whole country from the south-south-west, tilted
    const [cx, cz] = board.mapToWorld(1010, 880);
    stage.controls.target.set(cx, 0, cz);
    stage.camera.position.set(cx - 220, 1450, cz + 1250);
    this._bindPointer();
  }

  setMood(name) {
    this.mood = name;
    this.lighting.apply(name, { water: this.water, sky: this.sky, board: this.board, bloom: this.stage.bloom, voidPlane: this.voidPlane });
    document.body.dataset.mood = name;
    this.hud.querySelectorAll('[data-mood]').forEach((b) => b.classList.toggle('on', b.dataset.mood === name));
  }

  buildHud() {
    const top = el('div', { class: 'topbar glass' }, [
      el('div', { class: 'brand' }, [el('span', { class: 'brand-hex' }), el('span', { class: 'brand-name', text: 'PakCiv' })]),
    ]);
    const moods = el('div', { class: 'moods glass' }, ['day', 'golden', 'night'].map((m) =>
      el('button', { 'data-mood': m, class: 'chip', title: `Lighting: ${m}`, onclick: () => this.setMood(m) },
        [{ day: '☀ Day', golden: '🌇 Golden hour', night: '🌙 Nightlights' }[m]])));
    const relief = el('label', { class: 'relief glass' }, [
      el('span', { text: 'Relief ×' }),
      el('input', { type: 'range', min: 1, max: 25, step: 0.5, value: this.board.exaggeration,
        oninput: (e) => { this.board.setExaggeration(+e.target.value); relief.querySelector('b').textContent = e.target.value; } }),
      el('b', { text: String(this.board.exaggeration) }),
    ]);
    this.tip = el('div', { class: 'tip glass hidden' });
    this.hud.append(top, moods, relief, this.tip);
    this.setMood(this.mood);
  }

  cellInfo(cell) {
    const w = this.data.world;
    const o = w.owner[cell];
    const terr = w.terrain_names[w.terrain[cell]];
    return {
      cell, owner: o, district: o >= 0 ? this.districts[o] : null,
      country: o === -2 ? w.countries[w.country[cell]] : null,
      terrain: terr, elev: w.elev[cell], elevMax: w.elev_max[cell], flood: w.flood_pct[cell],
    };
  }

  _bindPointer() {
    const dom = this.stage.renderer.domElement;
    dom.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / dom.clientWidth) * 2 - 1, -(e.clientY / dom.clientHeight) * 2 + 1);
      this._pendingPick = [e.clientX, e.clientY];
    });
    dom.addEventListener('pointerleave', () => { this.tip.classList.add('hidden'); });
    this.stage.onTick(() => {
      if (!this._pendingPick) return;
      const [x, y] = this._pendingPick; this._pendingPick = null;
      this.raycaster.setFromCamera(this.pointer, this.stage.camera);
      const hit = this.board.pick(this.raycaster);
      if (!hit) { this.tip.classList.add('hidden'); return; }
      this.showTip(hit.cell, x, y);
    });
  }

  showTip(cell, x, y) {
    const i = this.cellInfo(cell);
    const w = this.data.world;
    if (w.water[cell] === 1 || w.water[cell] === 2) { this.tip.classList.add('hidden'); return; }
    const title = i.district ? `${i.district.name}` : i.country || 'Lake';
    const sub = i.district ? i.district.province : 'beyond Pakistan';
    this.tip.replaceChildren(
      el('div', { class: 'tip-title', text: title }), el('div', { class: 'tip-sub', text: sub }),
      el('div', { class: 'tip-row' }, [el('span', { text: 'Terrain' }), el('b', { text: i.terrain.replace('_', ' ') })]),
      el('div', { class: 'tip-row' }, [el('span', { text: 'Elevation' }), el('b', { text: `${fmt.int(i.elev)} m (peak ${fmt.int(i.elevMax)} m)` })]),
      i.flood > 0.5 ? el('div', { class: 'tip-row flood' }, [el('span', { text: '2022 flood' }), el('b', { text: `${i.flood.toFixed(0)}% of land under water` })]) : '',
    );
    this.tip.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
    this.tip.classList.remove('hidden');
  }
}
