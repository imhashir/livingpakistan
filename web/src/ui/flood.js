// 2022 mega-flood surge playback: UNOSAT's weekly district flood extents (Aug → Dec 2022) animate translucent water
// caps over each district's mapped flood footprint hexes.
import * as THREE from 'three';
import { el, fmt } from './dom.js';

export class FloodPlayer {
  constructor(app) {
    this.app = app;
    this.periods = app.atlas.flood_periods || [];
    this.t = 0; this.playing = false; this.visible = false; this.speed = 0.9; // periods per second
    this._buildUI();
    this._prepare();
  }

  _prepare() {
    const app = this.app, w = app.data.world;
    this.cells = []; this.level = [];
    // per-cell series = footprint share × district (week extent / district max extent)
    for (let c = 0; c < w.owner.length; c++) {
      const o = w.owner[c], f = w.flood_pct[c];
      if (o < 0 || !(f > 1)) continue;
      const s = app.districts[o].flood_series;
      if (!s) continue;
      const mx = Math.max(...s) || 1;
      this.cells.push(c); this.level.push(s.map((v) => (f / 100) * (v / mx)));
    }
    this.national = app.atlas.nation.flood_national_km2 || [];
    this.exposed = app.atlas.nation.flood_national_exposed || [];
    this.rebuild();
  }

  rebuild() {
    const app = this.app, board = app.board;
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); }
    const geo = new THREE.CylinderGeometry(9.9, 9.9, 1, 6, 1); geo.translate(0, 0.5, 0);
    this.aLevel = new Float32Array(this.cells.length);
    geo.setAttribute('aLevel', new THREE.InstancedBufferAttribute(this.aLevel, 1));
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute float aLevel; varying float vL; varying vec3 vWP; varying float vTop;
        void main(){ vL = aLevel; vTop = step(0.5, position.y); vec3 p = position; p.y *= 0.4 + aLevel * 3.2;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; varying float vL; varying vec3 vWP; varying float vTop;
        void main(){ if (vL < 0.01) discard;
          float r = 0.5 + 0.5 * sin(vWP.x * 0.6 + uTime * 2.0) * cos(vWP.z * 0.5 - uTime * 1.6);
          vec3 deep = vec3(0.10, 0.36, 0.62), lite = vec3(0.45, 0.85, 1.0);
          vec3 c = mix(deep, lite, 0.35 + 0.4 * r * vTop);
          float a = clamp(0.25 + vL * 1.2, 0.0, 0.85) * (0.7 + 0.3 * vTop);
          gl_FragColor = vec4(c * (1.0 + vTop * 0.3), a); }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.cells.length));
    const m = new THREE.Matrix4();
    this.cells.forEach((c, k) => {
      const [x, z] = board.worldXZ(c); m.makeTranslation(x, board.topY(c) + 0.05, z); mesh.setMatrixAt(k, m);
    });
    mesh.renderOrder = 11; mesh.visible = this.visible; mesh.frustumCulled = false;
    this.mesh = mesh; app.stage.scene.add(mesh);
    this._apply(this.t);
  }

  _buildUI() {
    const P = this.periods;
    this.slider = el('input', { type: 'range', min: 0, max: Math.max(0, P.length - 1), step: 0.01, value: 0,
      oninput: (e) => { this.playing = false; this.playBtn.textContent = '▶'; this.t = +e.target.value; this._apply(this.t); } });
    this.playBtn = el('button', { class: 'play', text: '▶', title: 'Play the surge', onclick: () => this.toggle() });
    this.stats = el('div', { class: 'flood-stats' });
    this.root = el('div', { class: 'timebar glass hidden' }, [
      el('h5', {}, [el('span', { text: '🌊 2022 MEGA-FLOOD · surge playback' }), el('small', { text: 'UNOSAT weekly satellite extents' })]),
      el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [this.playBtn, this.slider]),
      el('div', { class: 'ticks' }, P.map((p, k) => el('button', { text: p.replace(' 2022', '').replace('. ', ' '), onclick: () => { this.t = k; this.slider.value = k; this._apply(k); } }))),
      this.stats,
    ]);
    this.app.hud.append(this.root);
  }

  toggle() {
    this.playing = !this.playing; this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    if (this.playing && this.t >= this.periods.length - 1.01) this.t = 0;
  }

  _apply(t) {
    const k = Math.floor(t), f = t - k, k2 = Math.min(k + 1, this.periods.length - 1);
    for (let i = 0; i < this.cells.length; i++) {
      const s = this.level[i]; this.aLevel[i] = s[k] * (1 - f) + s[k2] * f;
    }
    this.mesh.geometry.attributes.aLevel.needsUpdate = true;
    const lerp = (a) => (a.length ? a[k] * (1 - f) + a[k2] * f : null);
    const km2 = lerp(this.national), ex = lerp(this.exposed);
    const fl = this.app.atlas.nation.flood2022 || {};
    this.stats.replaceChildren(
      el('div', {}, [el('b', { text: `${fmt.int(km2)} km²` }), el('span', { text: `under water · ${this.periods[Math.round(t)] || ''}` })]),
      el('div', {}, [el('b', { text: fmt.big(ex) }), el('span', { text: 'people potentially exposed' })]),
      fl.deaths ? el('div', {}, [el('b', { text: fmt.int(fl.deaths.value) }), el('span', { text: `deaths (NDMA, ${fl.ndma_as_of?.value || fl.ndma_as_of || 'Nov 2022'})` })]) : '',
      fl.damage_usd_bn ? el('div', {}, [el('b', { text: `$${fl.damage_usd_bn.value}bn` }), el('span', { text: 'damage (PDNA)' })]) : '',
    );
  }

  tick(time, dt = 1 / 60) {
    this.uniforms.uTime.value = time;
    if (!this.playing || !this.visible) return;
    this.t = Math.min(this.periods.length - 1, this.t + dt * this.speed);
    this.slider.value = this.t; this._apply(this.t);
    if (this.t >= this.periods.length - 1) { this.playing = false; this.playBtn.textContent = '▶'; }
  }

  show() { this.visible = true; this.mesh.visible = true; this.root.classList.remove('hidden'); this.app.eras?.hide?.(); }
  hide() { this.visible = false; this.playing = false; this.playBtn.textContent = '▶'; if (this.mesh) this.mesh.visible = false; this.root.classList.add('hidden'); }
}
