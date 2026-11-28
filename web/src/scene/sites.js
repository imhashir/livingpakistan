// Cities (instanced skylines + banners), Wonders (miniature 3D silhouettes) and icon pins for every other site.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { el, fmt } from '../ui/dom.js';
import { requestRender, requestLabels } from './frame.js';
import { disposeTree } from './lines.js';

export const KIND_META = {
  city: { icon: '🏙️', label: 'City' }, wonder: { icon: '✨', label: 'Wonder' }, unesco: { icon: '🏛️', label: 'UNESCO site' },
  park: { icon: '🌲', label: 'Protected area' }, university: { icon: '🎓', label: 'University' }, shrine: { icon: '🕌', label: 'Sufi shrine' },
  craft: { icon: '🏺', label: 'Craft heritage' }, cricket: { icon: '🏏', label: 'Cricket ground' }, era: { icon: '⏳', label: 'Historic site' },
  power: { icon: '⚡', label: 'Power plant' }, airport: { icon: '✈️', label: 'Airport' }, port: { icon: '⚓', label: 'Seaport' },
  water: { icon: '💧', label: 'Dam / barrage' }, quake: { icon: '🌋', label: 'Historic earthquake' }, heat: { icon: '🔥', label: 'Heat extreme' },
  glof: { icon: '🧊', label: 'Glacial-lake hazard' },
};
const FUEL_ICON = { Hydro: '💧', Nuclear: '☢️', Coal: '⚫', Gas: '🔥', Oil: '🛢️', Solar: '☀️', Wind: '🌬️', Biomass: '🌿' };

// ---------------------------------------------------------------- wonder silhouettes (built from primitives)
function silhouette(type) {
  const parts = [];
  const add = (g, x = 0, y = 0, z = 0) => { g.translate(x, y, z); parts.push(g); };
  const box = (w, h, d, x, y, z) => add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z);
  const cyl = (r0, r1, h, x, y, z, s = 12) => add(new THREE.CylinderGeometry(r0, r1, h, s), x, y + h / 2, z);
  const dome = (r, x, y, z) => { const g = new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); add(g, x, y, z); };
  switch (type) {
    case 'mosque': // Badshahi-style: plinth, prayer hall, three domes, four corner minarets
      box(16, 1.2, 12, 0, 0, 0); box(10, 3.5, 5, 0, 1.2, -1);
      dome(2.4, 0, 4.7, -1); dome(1.6, -3.4, 4.7, -1); dome(1.6, 3.4, 4.7, -1);
      for (const [x, z] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) { cyl(0.55, 0.7, 9, x, 1.2, z, 8); dome(0.75, x, 10.2, z); }
      break;
    case 'faisal': // tent-like prayer hall + four needle minarets
      add(new THREE.ConeGeometry(5.5, 6, 4).rotateY(Math.PI / 4), 0, 4, 0);
      box(9, 1, 9, 0, 0, 0);
      for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) { cyl(0.35, 0.5, 12, x, 0, z, 8); add(new THREE.ConeGeometry(0.45, 1.6, 8), x, 12.8, z); }
      break;
    case 'minar': // Minar-e-Pakistan: four-stage tapering tower on a star base
      cyl(4.2, 4.6, 1.2, 0, 0, 0, 5); cyl(1.6, 2.2, 6, 0, 1.2, 0, 10); cyl(1.3, 1.6, 5, 0, 7.2, 0, 10);
      cyl(1.0, 1.3, 4, 0, 12.2, 0, 10); dome(1.1, 0, 16.2, 0); add(new THREE.ConeGeometry(0.2, 1.6, 6), 0, 18, 0);
      break;
    case 'stupa': // Gandhara / Indus ruins: stepped terraces + stupa dome + harmika
      box(14, 1.2, 14, 0, 0, 0); box(10, 1.2, 10, 0, 1.2, 0); box(7, 1.2, 7, 0, 2.4, 0);
      dome(3.4, 0, 3.6, 0); box(1.6, 1.2, 1.6, 0, 6.9, 0); cyl(0.25, 0.25, 2.5, 0, 8, 0, 6);
      break;
    case 'fort': // walls + bastions + gate
      for (const [w, d, x, z] of [[16, 1.2, 0, -7], [16, 1.2, 0, 7], [1.2, 14, -7.5, 0], [1.2, 14, 7.5, 0]]) box(w, 3.2, d, x, 0, z);
      for (const [x, z] of [[-7.5, -7], [7.5, -7], [-7.5, 7], [7.5, 7]]) { cyl(1.5, 1.7, 4.4, x, 0, z, 10); }
      box(4, 5, 2.2, 0, 0, 7); dome(1.2, 0, 5, 7);
      break;
    case 'tomb': // Mazar-e-Quaid / Makli: square chamber + big dome
      box(10, 1, 10, 0, 0, 0); box(7, 5, 7, 0, 1, 0); dome(3.6, 0, 6, 0); add(new THREE.ConeGeometry(0.25, 1.6, 6), 0, 9.9, 0);
      break;
    case 'dam': { // curved embankment wall with spillway
      const g = new THREE.CylinderGeometry(12, 12, 6, 24, 1, true, -0.6, 1.2); g.rotateY(Math.PI); add(g, 0, 3, 10);
      box(3, 6.5, 2, -4, 0, -1.5); box(3, 6.5, 2, 4, 0, -1.5);
      break; }
    case 'port': // gantry crane + container stacks
      box(1, 10, 1, -3, 0, 0); box(1, 10, 1, 3, 0, 0); box(14, 1, 1.4, 2, 10, 0); box(1, 3, 1, 8, 7, 0);
      for (let i = 0; i < 4; i++) box(2.4, 1.2 + (i % 2), 1.2, -6 + i * 2.6, 0, 4, 0);
      break;
    case 'peak': // summit beacon: obelisk + star
      add(new THREE.ConeGeometry(1.4, 7, 4), 0, 3.5, 0); add(new THREE.OctahedronGeometry(1.4), 0, 8.5, 0);
      break;
    case 'campus': // dome + columns
      box(12, 4, 7, 0, 0, 0); dome(2.6, 0, 4, 0);
      for (let i = -2; i <= 2; i++) cyl(0.35, 0.35, 4, i * 2.3, 0, 4, 6);
      break;
    default: // natural wonder crystal
      add(new THREE.OctahedronGeometry(3.2, 0), 0, 4.2, 0); add(new THREE.OctahedronGeometry(1.6, 0), 2.6, 2, 1.5);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

function wonderType(s) {
  const n = (s.name || '').toLowerCase();
  if (s.sub === 'peak' || /\bk2\b|nanga|gasherbrum|broad peak|rakaposhi|tirich/.test(n)) return 'peak';
  if (/faisal mosque/.test(n)) return 'faisal';
  if (/mosque|masjid/.test(n)) return 'mosque';
  if (/minar|tower/.test(n)) return 'minar';
  if (/fort|qila|derawar|ranikot|altit|baltit|rohtas/.test(n)) return 'fort';
  if (/mazar|tomb|makli|necropolis|mausoleum|noor mahal|residency/.test(n)) return 'tomb';
  if (/moenjodaro|mohenjo|harappa|taxila|takht|bahi|mehrgarh|stupa|katas|ruins|archaeolog|sirkap|jaulian/.test(n)) return 'stupa';
  if (/dam\b|barrage/.test(n)) return 'dam';
  if (/port\b|harbour|harbor/.test(n)) return 'port';
  return 'natural';
}

// ---------------------------------------------------------------- emoji textures for sprite pins
const texCache = new Map();
function emojiTexture(emoji, ring = '#d9ad4a') {
  const key = emoji + ring;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
  const grd = g.createRadialGradient(64, 50, 10, 64, 64, 58); grd.addColorStop(0, '#2b2f37'); grd.addColorStop(1, '#0e1014');
  g.fillStyle = grd; g.fill(); g.lineWidth = 7; g.strokeStyle = ring; g.stroke();
  g.font = '62px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

export class Sites {
  constructor(board, layers, atlas, scene) {
    this.board = board; this.layers = layers; this.atlas = atlas; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.sites = layers.sites;
    this.byId = new Map(this.sites.map((s) => [s.id, s]));
    this.uNight = { value: 0 }; this.uTime = { value: 0 };
    this.pinGroups = {};
    this.visibleKinds = new Set(['city', 'wonder', 'unesco']);
    this.build();
  }

  worldPos(s, lift = 0) {
    const [x, z] = this.board.mapToWorld(s.xy[0], s.xy[1]);
    return new THREE.Vector3(x, this.board.heightAt(x, z) + lift, z);
  }

  build() {
    // a relief change rebuilds every marker: free the old buffers instead of leaking them
    for (const o of [...this.group.children]) { o.removeFromParent(); disposeTree(o); }
    this.pinGroups = {};
    this._buildCities();
    this._buildWonders();
    this._buildPins();
    this.applyVisibility();
  }

  _buildCities() {
    const cities = this.sites.filter((s) => s.kind === 'city');
    this.cities = cities;
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe9dcc4, roughness: 0.65, metalness: 0.1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.uNight;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = (instanceMatrix * vec4(position,1.0)).xyz; vN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uNight; varying vec3 vLP; varying vec3 vN;
          float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float side = 1.0 - step(0.9, abs(vN.y));
            vec2 win = vec2(floor((vLP.x + vLP.z) * 2.2), floor(vLP.y * 2.4));
            float lit = step(0.45, hh(win)) * side * step(0.25, fract(vLP.y * 2.4));
            totalEmissiveRadiance += vec3(1.0, 0.72, 0.35) * lit * uNight * 2.2; }`);
    };
    // buildings per city: count & height scale with population (√pop), placed in a disc around the centre
    const list = [];
    const wxy = this.sites.filter((s) => s.kind === 'wonder' || s.kind === 'unesco').map((s) => s.xy);
    for (const c of cities) {
      const pop = c.pop || 150000;
      const n = Math.round(Math.min(90, 10 + Math.sqrt(pop) / 55));
      const R = Math.min(17, 4 + Math.sqrt(pop) / 380);
      let seed = c.xy[0] * 13.1 + c.xy[1] * 7.7;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let k = 0; k < n; k++) {
        const r = R * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
        const bx = c.xy[0] + Math.cos(a) * r, by = c.xy[1] + Math.sin(a) * r;
        if (wxy.some(([x, y]) => Math.hypot(x - bx, y - by) < 5)) continue; // leave room around wonders
        const centre = 1 - r / R;
        const h = (0.8 + rnd() * 1.6) * (1 + centre * 2.2) * (0.6 + Math.log10(pop) / 7) * 1.4;
        list.push([c, Math.cos(a) * r, Math.sin(a) * r, 0.9 + rnd() * 1.4, h, rnd() * Math.PI]);
      }
    }
    const mesh = new THREE.InstancedMesh(g, mat, list.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    list.forEach(([c, dx, dz, w, h, rot], k) => {
      const base = this.worldPos(c);
      const [x, z] = [base.x + dx, base.z + dz];
      p.set(x, this.board.heightAt(x, z) - 0.1, z); s.set(w, h, w); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      m.compose(p, q, s); mesh.setMatrixAt(k, m);
      col.setHSL(0.09 + (k % 7) * 0.008, 0.25, 0.72 + (k % 5) * 0.04); mesh.setColorAt(k, col);
    });
    this.skyline = mesh; this.group.add(mesh);
    // banners
    this.banners = [];
    const ranked = [...cities].sort((a, b) => (b.pop || 0) - (a.pop || 0));
    ranked.forEach((c, rank) => {
      // AJK and GB towns are not in the Census 2023 urban tables: rather than a
      // bare "—" that reads as a glitch, those banners carry the name alone
      const div = el('div', { class: `banner ${c.capital ? 'capital' : ''}`, 'data-id': c.id, role: 'button', tabindex: '0',
        'aria-label': c.pop ? `${c.name}, ${fmt.big(c.pop)} people` : `${c.name}, population not covered by Census 2023` }, [
        c.pop ? el('span', { class: 'banner-pop', text: fmt.big(c.pop) }) : '',
        el('span', { class: 'banner-name', text: c.name }),
      ]);
      if (!c.pop) div.classList.add('no-pop');
      this._activate(div, c);
      const o = new CSS2DObject(div);
      o.position.copy(this.worldPos(c, 14 + Math.min(10, Math.sqrt(c.pop || 1e5) / 500)));
      o.userData = { site: c, rank, minDist: rank < 6 ? 99999 : rank < 15 ? 1700 : rank < 30 ? 1000 : 650 };
      this.group.add(o); this.banners.push(o);
    });
  }

  _buildWonders() {
    const ws = this.sites.filter((s) => s.kind === 'wonder' || (s.kind === 'unesco' && s.status === 'inscribed'));
    // de-duplicate UNESCO entries that coincide with a curated wonder (within 3 km)
    const kept = [];
    for (const s of ws) if (!kept.some((k) => Math.hypot(k.xy[0] - s.xy[0], k.xy[1] - s.xy[1]) < 3)) kept.push(s);
    this.wonders = kept;
    const byType = {};
    for (const s of kept) (byType[wonderType(s)] ||= []).push(s);
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c25a, metalness: 0.75, roughness: 0.28, emissive: 0x3a2a00 });
    const marble = new THREE.MeshStandardMaterial({ color: 0xf4efe6, metalness: 0.05, roughness: 0.45 });
    const redstone = new THREE.MeshStandardMaterial({ color: 0xb4553c, roughness: 0.7 });
    const matFor = { mosque: redstone, fort: redstone, faisal: marble, minar: marble, tomb: marble, stupa: gold, dam: marble, port: gold, peak: gold, campus: marble, natural: gold };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.wonderMeshes = [];
    for (const [type, list] of Object.entries(byType)) {
      const geo = silhouette(type);
      const mesh = new THREE.InstancedMesh(geo, matFor[type], list.length);
      mesh.castShadow = true;
      list.forEach((w, k) => {
        const p = this.worldPos(w, type === 'peak' ? 1.5 : 0.2);
        const sc = type === 'peak' ? 1.7 : 1.15;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k * 0.7) % 6.28); s.setScalar(sc);
        m.compose(p, q, s); mesh.setMatrixAt(k, m);
      });
      mesh.userData = { list, type };
      this.group.add(mesh); this.wonderMeshes.push(mesh);
    }
    // glowing halo rings under each wonder
    const ring = new THREE.RingGeometry(7, 9, 40); ring.rotateX(-Math.PI / 2);
    const rmat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float a = 0.55 + 0.45 * sin(uTime * 2.0 + vUv.x * 6.28); gl_FragColor = vec4(vec3(1.6, 1.15, 0.4) * a, a); }',
    });
    const rings = new THREE.InstancedMesh(ring, rmat, kept.length);
    kept.forEach((w, k) => { m.compose(this.worldPos(w, 0.4), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); rings.setMatrixAt(k, m); });
    rings.renderOrder = 10; this.wonderRings = rings; this.group.add(rings);
    // labels
    this.wonderLabels = kept.map((w) => {
      const d = el('div', { class: 'wlabel', role: 'button', tabindex: '0', 'aria-label': w.name }, [el('span', { text: '✦ ' + w.name })]);
      this._activate(d, w);
      const o = new CSS2DObject(d); o.position.copy(this.worldPos(w, 16)); o.userData = { site: w, minDist: 700 };
      this.group.add(o); return o;
    });
  }

  /** A label is a button: click, or Enter / Space when it has focus. */
  _activate(node, site) {
    node.addEventListener('click', (e) => { e.stopPropagation(); this.onSelect?.(site); });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation(); this.onSelect?.(site);
    });
  }

  /**
   * On touch screens the labels let touches through to the map (so a pan or a
   * pinch that starts on one still moves the map), and a tap is matched to a
   * label here instead, with `slop` px of grace around its box.
   */
  labelAt(x, y, slop = 0) {
    let best = null, bestD = Infinity;
    for (const o of [...this.banners, ...this.wonderLabels]) {
      if (!o.visible) continue;
      const r = o.element.getBoundingClientRect();
      if (!r.width) continue;
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      if (dx > slop || dy > slop) continue;
      // inside beats near, and a banner (drawn on top) beats a wonder label
      const d = Math.hypot(dx, dy) - (this.banners.includes(o) ? 0.5 : 0);
      if (d < bestD) { bestD = d; best = o.userData.site; }
    }
    return best;
  }

  /** Re-run the declutter on the next tick (the HUD moved, so the free space changed). */
  refreshLabels() { this._labelKey = null; this._lastDeclutter = 0; requestLabels(); }

  _buildPins() {
    this.pins = [];
    const skip = new Set(['city', 'wonder']);
    for (const s of this.sites) {
      if (skip.has(s.kind) || (s.kind === 'unesco' && s.status === 'inscribed')) continue;
      const icon = s.kind === 'power' ? (FUEL_ICON[s.fuel] || '⚡') : KIND_META[s.kind]?.icon || '•';
      const ringC = { quake: '#ff5a4a', heat: '#ff8a3d', glof: '#7fe0ff', power: '#ffd34a', water: '#4fc3e0', era: '#c9a7ff' }[s.kind] || '#d9ad4a';
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(icon, ringC), depthWrite: false, transparent: true }));
      const size = s.kind === 'power' ? 5 + Math.min(9, Math.sqrt(s.mw || 50) / 6) : s.kind === 'airport' ? 6 + Math.min(8, Math.sqrt((s.pax || 1e4) / 1e5) * 2) : 8;
      sp.scale.setScalar(size);
      sp.position.copy(this.worldPos(s, size * 0.6 + 2.5));
      sp.userData = { site: s };
      sp.renderOrder = 12;
      (this.pinGroups[s.kind] ||= new THREE.Group()).add(sp);
      this.pins.push(sp);
    }
    for (const g of Object.values(this.pinGroups)) this.group.add(g);
  }

  applyVisibility() {
    for (const [k, g] of Object.entries(this.pinGroups)) g.visible = this.visibleKinds.has(k);
    const showW = this.visibleKinds.has('wonder');
    this.wonderMeshes?.forEach((m) => { m.visible = showW; });
    if (this.wonderRings) this.wonderRings.visible = showW;
    this.wonderLabels?.forEach((o) => { o.userData.hidden = !showW; });
    const showC = this.visibleKinds.has('city');
    if (this.skyline) this.skyline.visible = showC;
    this.banners?.forEach((o) => { o.userData.hidden = !showC; });
    this._labelKey = null; // re-run the declutter
    requestRender();
  }

  setKind(kind, on) { on ? this.visibleKinds.add(kind) : this.visibleKinds.delete(kind); this.applyVisibility(); }

  /** Single one site's label out (tours). It is drawn first and never decluttered away. */
  setFocus(site) {
    this.focusSite = site || null;
    for (const o of [...this.banners, ...this.wonderLabels]) {
      o.element.classList.toggle('focused', !!site && o.userData.site === site);
    }
    this._labelKey = null;
  }

  /** Declutter labels: distance gates + greedy screen-space collision (big cities first). Runs ~6×/s. */
  updateLabels(camera, target) {
    const now = performance.now();
    if (this._lastDeclutter && now - this._lastDeclutter < 160) return;
    this._lastDeclutter = now;
    // nothing to redo while the camera, the viewport and the label set are unchanged
    const W = innerWidth, H = innerHeight, cp = camera.position, vo = camera.view?.enabled ? camera.view : null;
    const key = `${cp.x},${cp.y},${cp.z},${target.x},${target.y},${target.z},${camera.fov},${W},${H},${vo ? `${vo.offsetX},${vo.offsetY}` : ''}`;
    if (key === this._labelKey) return;
    this._labelKey = key;
    // ticks run before the render that would refresh these, so bring them up to date first
    camera.updateMatrixWorld();
    const d = camera.position.distanceTo(target);
    // Phones (see MobileUI): labels stay whole on screen and off the HUD. The
    // HUD's boxes are read once per pass and seeded as already taken.
    const zone = this.labelZone?.() || null;
    const edge = zone ? zone.margin : -Infinity;
    const boxes = zone ? zone.rects.map((r) => [r.left, r.top, r.right, r.bottom]) : [];
    const v = this._v || (this._v = new THREE.Vector3());
    let at = null; // where the last place() put its box
    const place = (o, w, h) => {
      v.copy(o.position).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return false;
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      const b = at = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (b[0] < edge || b[1] < edge || b[2] > W - edge || b[3] > H - edge) return false;
      if (boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) return false;
      boxes.push(b); return true;
    };
    const all = [...this.banners, ...this.wonderLabels];
    // the focused label is placed first, so a neighbour cannot take its box
    if (this.focusSite) all.sort((a, b) => (b.userData.site === this.focusSite) - (a.userData.site === this.focusSite));
    const isBanner = new Set(this.banners);
    let changed = false;
    for (const o of all) {
      const was = o.visible;
      const focused = !!this.focusSite && o.userData.site === this.focusSite;
      const banner = isBanner.has(o);
      const want = banner
        ? !o.userData.hidden && (d < o.userData.minDist || o.userData.rank < 6)
        : !o.userData.hidden && o.position.distanceTo(camera.position) < 900;
      const w = banner ? 26 + o.userData.site.name.length * 9 : 20 + o.userData.site.name.length * 7;
      const h = banner ? 26 : 18;
      // a tour's subject stays legible whatever the distance gates say
      at = null;
      o.visible = (want || focused) && place(o, w, h);
      if (focused) o.visible = true;
      if (o.visible !== was) changed = true;
      // ...and on a phone it is nudged back inside the screen rather than cut off
      let nudge = '';
      if (focused && zone && at && v.z <= 1) {
        const nx = Math.round(Math.max(edge - at[0], Math.min(0, W - edge - at[2]))), ny = Math.round(Math.max(edge - at[1], Math.min(0, H - edge - at[3])));
        if (nx || ny) nudge = `${nx}px ${ny}px`;
      }
      if ((o.userData.nudge || '') !== nudge) { o.userData.nudge = nudge; o.element.style.translate = nudge; changed = true; }
    }
    if (changed) requestLabels();
  }

  pick(raycaster) {
    const vis = this.pins.filter((p) => p.parent.visible);
    const hit = raycaster.intersectObjects(vis, false)[0];
    if (hit) return hit.object.userData.site;
    for (const m of this.wonderMeshes) {
      if (!m.visible) continue;
      const h = raycaster.intersectObject(m, false)[0];
      if (h) return m.userData.list[h.instanceId];
    }
    return null;
  }
}
