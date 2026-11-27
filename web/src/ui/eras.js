// Era Time-Machine: scrub 9,000 years; each era lights its real sites with beams of light, re-tints the sky and
// switches the layers that tell its story (canals for the Raj canal colonies, corridors & cities for modern Pakistan).
import * as THREE from 'three';
import { el } from './dom.js';

const ERA_STYLE = {
  mehrgarh: { color: 0xc98b4a, mood: 'golden', layers: [] },
  indus: { color: 0xe0a458, mood: 'golden', layers: ['rivers'] },
  gandhara: { color: 0xb8a6ff, mood: 'golden', layers: ['rivers'] },
  arab: { color: 0x6fe0b0, mood: 'golden', layers: ['rivers'] },
  sultanate: { color: 0x7fd1ff, mood: 'golden', layers: ['rivers'] },
  mughal: { color: 0xff7b5a, mood: 'golden', layers: ['rivers'] },
  raj: { color: 0x9fd3ff, mood: 'day', layers: ['rivers', 'canals', 'roads'] },
  modern: { color: 0x5effa1, mood: 'night', layers: ['rivers', 'corridors', 'city'] },
};
const fmtYear = (y) => (y < 0 ? `${-y} BCE` : `${y} CE`);

export class EraMachine {
  constructor(app) {
    this.app = app;
    this.eras = app.data.layers.eras || [];
    this.sites = app.sites.sites.filter((s) => s.kind === 'era');
    this.open = false;
    this.idx = 0;
    this._buildBeams();
    this._buildUI();
  }

  _buildBeams() {
    const g = new THREE.CylinderGeometry(2.4, 4.5, 190, 14, 1, true); g.translate(0, 95, 0);
    this.uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffd27a) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float fade = pow(1.0 - vUv.y, 1.6); float band = 0.65 + 0.35 * sin(vUv.y * 40.0 - uTime * 4.0);
          gl_FragColor = vec4(uColor * 3.2 * fade * band, fade); }`,
    });
    this.beams = new THREE.InstancedMesh(g, mat, Math.max(1, this.sites.length));
    this.beams.count = 0; this.beams.visible = false; this.beams.renderOrder = 13; this.beams.frustumCulled = false;
    this.app.stage.scene.add(this.beams);
  }

  _buildUI() {
    const E = this.eras;
    this.slider = el('input', { type: 'range', min: 0, max: E.length - 1, step: 1, value: 0, oninput: (e) => this.setEra(+e.target.value) });
    this.ticks = el('div', { class: 'ticks' }, E.map((e, k) => el('button', { text: e.name.split(' (')[0].replace('Civilisation', '').replace(' and early Islamic', ''), title: `${e.start_label} – ${e.end_label || 'today'}`, onclick: () => this.setEra(k) })));
    this.card = el('div', { class: 'era-card' });
    this.playBtn = el('button', { class: 'play', text: '▶', title: 'Play through history', onclick: () => this.play() });
    this.root = el('div', { class: 'timebar glass hidden' }, [
      el('h5', {}, [el('span', { text: '⏳ ERA TIME-MACHINE · 9,000 years on the same hexes' }), el('small', { text: 'Y to close' })]),
      el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [this.playBtn, this.slider]), this.ticks, this.card,
    ]);
    this.app.hud.append(this.root);
  }

  toggle() { this.open ? this.hide() : this.show(); }

  show() {
    this.open = true; this.root.classList.remove('hidden');
    if (this.app.lens.current === 'flood') this.app.setLens('terrain');
    this.app.flood?.hide();
    this._saved = { mood: this.app.mood, kinds: new Set(this.app.sites.visibleKinds), lines: { ...this.app.lines.visible } };
    this.setEra(this.idx);
  }

  hide() {
    if (!this.open) return;
    this.open = false; this.playing = false; this.root.classList.add('hidden'); this.beams.visible = false;
    if (this._saved) {
      this.app.setMood(this._saved.mood);
      for (const k of ['era', 'city', 'unesco', 'wonder']) this.app.setLayer(k, this._saved.kinds.has(k));
      for (const [k, v] of Object.entries(this._saved.lines)) this.app.setLayer(k, v);
    }
    this.app.board.setHighlight(null);
  }

  setEra(k) {
    this.idx = k; this.slider.value = k;
    const e = this.eras[k], st = ERA_STYLE[e.id] || { color: 0xffd27a, mood: 'golden', layers: [] };
    this.ticks.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === k));
    const sites = this.sites.filter((s) => s.era === e.id);
    // beams
    const m = new THREE.Matrix4();
    sites.forEach((s, j) => { const p = this.app.sites.worldPos(s); m.makeTranslation(p.x, p.y, p.z); this.beams.setMatrixAt(j, m); });
    this.beams.count = sites.length; this.beams.instanceMatrix.needsUpdate = true; this.beams.visible = true;
    this.uniforms.uColor.value.setHex(st.color);
    // mood + layers
    this.app.setMood(st.mood);
    for (const l of ['rivers', 'canals', 'roads', 'corridors']) this.app.setLayer(l, st.layers.includes(l));
    this.app.setLayer('city', st.layers.includes('city'));
    this.app.setLayer('era', true);
    this.app.setLayer('wonder', false); this.app.setLayer('unesco', false);
    // highlight hexes of the era's sites
    this.app.board.setHighlight(sites.map((s) => s.cell).filter((c) => c >= 0));
    const span = `${e.start_label} – ${e.end_label || 'today'}`;
    this.card.replaceChildren(
      el('div', { class: 'big', text: e.start_year < 0 ? fmtYear(e.start_year) : String(e.start_year) }),
      el('div', {}, [el('b', { text: e.name, style: { color: '#fff1c8' } }), el('div', { style: { fontSize: '11px', color: 'var(--ink-dim)' }, text: span }),
        el('p', { text: e.blurb }),
        el('p', { style: { marginTop: '4px', color: 'var(--ink-dim)', fontSize: '11px' }, text: `${sites.length} site${sites.length === 1 ? '' : 's'} lit: ${sites.map((s) => s.name + (s.year != null ? ` (${fmtYear(s.year)})` : '')).join(' · ')}` }),
        e.ref ? el('a', { href: e.ref, target: '_blank', rel: 'noopener', text: 'Reference ↗' }) : '']),
    );
    // frame the era's sites
    if (sites.length) {
      const xs = sites.map((s) => s.xy[0]), ys = sites.map((s) => s.xy[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const span2 = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 150);
      const [wx, wz] = this.app.board.mapToWorld(cx, cy);
      this.app.stage.flyTo([wx, 0, wz], { distance: Math.min(2000, 380 + span2 * 1.6), tilt: 0.8, duration: 2.2 });
    }
  }

  async play() {
    if (this.playing) { this.playing = false; this.playBtn.textContent = '▶'; return; }
    this.playing = true; this.playBtn.textContent = '❚❚';
    for (let k = 0; k < this.eras.length && this.playing && this.open; k++) {
      this.setEra(k);
      await new Promise((r) => setTimeout(r, 5200));
    }
    this.playing = false; this.playBtn.textContent = '▶';
  }

  tick(t) { this.uniforms.uTime.value = t; }
}
