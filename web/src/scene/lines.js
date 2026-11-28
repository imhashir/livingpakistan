// Terrain-draped animated ribbons: flowing rivers, glowing trade corridors with travelling pulses, canals, faults.
import * as THREE from 'three';
import { requestRender } from './frame.js';

/** Free the GPU buffers and programs of everything under `root`. */
export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [o.material].flat()) m?.dispose();
  });
}

const RIVER_VS = `
  attribute float aDist; attribute float aSide; varying float vDist; varying float vSide; varying vec3 vWP;
  void main(){ vDist = aDist; vSide = aSide; vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w; }`;

const RIVER_FS = `
  uniform float uTime; uniform vec3 uColor; uniform vec3 uFoam; uniform float uNight; uniform float uSpeed; uniform float uOpacity;
  varying float vDist; varying float vSide; varying vec3 vWP;
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  void main(){
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float flow = fract(vDist * 0.08 - uTime * uSpeed);
    float streak = smoothstep(0.0, 0.08, flow) * (1.0 - smoothstep(0.08, 0.45, flow));
    float ripple = 0.5 + 0.5 * sin(vDist * 0.9 - uTime * uSpeed * 25.0 + vSide * 3.0);
    vec3 c = mix(uColor, uFoam, streak * 0.75 + ripple * 0.12 * (1.0 - abs(vSide)));
    c += uColor * uNight * 0.9;
    gl_FragColor = vec4(c, edge * uOpacity);
    #include <colorspace_fragment>
  }`;

const CORRIDOR_FS = `
  uniform float uTime; uniform vec3 uColor; uniform float uSpeed; uniform float uOpacity; uniform float uDash;
  varying float vDist; varying float vSide; varying vec3 vWP;
  void main(){
    float core = 1.0 - smoothstep(0.15, 1.0, abs(vSide));
    float pulse = fract(vDist * 0.012 - uTime * uSpeed);
    float head = smoothstep(0.86, 0.995, pulse) * (1.0 - step(0.995, pulse));
    float dash = uDash > 0.5 ? step(0.5, fract(vDist * 0.25)) * 0.5 + 0.5 : 1.0;
    vec3 c = uColor * (0.55 + 0.45 * core) * dash + uColor * head * 3.5 + vec3(1.0) * head * core * 1.2;
    gl_FragColor = vec4(c, (core * 0.75 + head) * uOpacity);
  }`;

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

/** Build one merged ribbon geometry for many polylines (map km). */
function ribbonGeometry(board, polylines, width, lift, step = 2.5) {
  const pos = [], dist = [], side = [], idx = [];
  let base = 0;
  for (const pl of polylines) {
    if (pl.length < 2) continue;
    const pts = resample(pl, step).map(([x, y]) => {
      const [wx, wz] = board.mapToWorld(x, y);
      return [wx, board.heightAt(wx, wz) + lift, wz];
    });
    let d = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      let tx = b[0] - a[0], tz = b[2] - a[2]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const nx = -tz * width / 2, nz = tx * width / 2;
      if (i > 0) d += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
      pos.push(p[0] - nx, p[1], p[2] - nz, p[0] + nx, p[1], p[2] + nz);
      dist.push(d, d); side.push(-1, 1);
      if (i > 0) { const k = base + (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    base += pts.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

export class Lines {
  constructor(board, layers, scene) {
    this.board = board; this.layers = layers; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.uTime = { value: 0 }; this.uNight = { value: 0 };
    this.groups = {};
    this.rebuild();
  }

  _riverMat(color, foam, speed, opacity = 0.95) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uNight: this.uNight, uColor: { value: new THREE.Color(color) },
        uFoam: { value: new THREE.Color(foam) }, uSpeed: { value: speed }, uOpacity: { value: opacity } },
      vertexShader: RIVER_VS, fragmentShader: RIVER_FS, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
  }

  _corridorMat(color, speed, dash = 0) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uColor: { value: new THREE.Color(color).multiplyScalar(1.4) }, uSpeed: { value: speed },
        uOpacity: { value: 1 }, uDash: { value: dash } },
      vertexShader: RIVER_VS, fragmentShader: CORRIDOR_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }

  rebuild() {
    // a relief change rebuilds every ribbon: free the old buffers instead of leaking them
    for (const g of Object.values(this.groups)) { g.removeFromParent(); disposeTree(g); }
    this.groups = {};
    const L = this.layers.lines, b = this.board;
    // rivers — coloured by the Indus Waters Treaty allocation when that view is on
    const rivers = new THREE.Group(); rivers.name = 'rivers';
    this.riverMeshes = [];
    for (const r of L.rivers) {
      const m = new THREE.Mesh(ribbonGeometry(b, r.lines, r.w * 1.6, 0.45), this._riverMat(0x2f8fd6, 0xd8f6ff, 0.35 + r.w * 0.05));
      m.renderOrder = 8; m.userData = r; rivers.add(m); this.riverMeshes.push(m);
    }
    this.groups.rivers = rivers;
    const canals = new THREE.Group(); canals.name = 'canals';
    canals.add(Object.assign(new THREE.Mesh(ribbonGeometry(b, L.canals.flatMap((c) => c.lines), 0.8, 0.4, 3),
      this._riverMat(0x58b8e8, 0xe6fbff, 0.25, 0.8)), { renderOrder: 8 }));
    this.groups.canals = canals;
    // corridors
    const cor = new THREE.Group(); cor.name = 'corridors';
    this.corridorMeshes = {};
    for (const c of L.corridors) {
      const m = new THREE.Mesh(ribbonGeometry(b, c.lines, c.rail ? 1.6 : 2.4, 1.1, 3), this._corridorMat(c.color, c.rail ? 0.22 : 0.16, c.rail ? 1 : 0));
      m.renderOrder = 9; m.userData = c; cor.add(m); this.corridorMeshes[c.id] = m;
    }
    this.groups.corridors = cor;
    // roads & rail (quiet base network)
    const roads = new THREE.Group(); roads.name = 'roads';
    const mw = L.roads.filter((r) => r.cls === 'motorway').flatMap((r) => r.lines);
    const nh = L.roads.filter((r) => r.cls !== 'motorway').flatMap((r) => r.lines);
    const roadMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    roads.add(Object.assign(new THREE.Mesh(ribbonGeometry(b, mw, 1.1, 0.55, 3), roadMat(0xf3e2b8, 0.9)), { renderOrder: 7 }));
    roads.add(Object.assign(new THREE.Mesh(ribbonGeometry(b, nh, 0.7, 0.5, 3), roadMat(0xc8b48a, 0.75)), { renderOrder: 7 }));
    const rail = L.rail.filter((r) => !/untagged/.test(r.name || '')).flatMap((r) => r.lines);
    roads.add(Object.assign(new THREE.Mesh(ribbonGeometry(b, rail, 0.6, 0.6, 3), roadMat(0x3a3530, 0.85)), { renderOrder: 7 }));
    this.groups.roads = roads;
    // faults
    const faults = new THREE.Group(); faults.name = 'faults';
    faults.add(Object.assign(new THREE.Mesh(ribbonGeometry(b, L.faults.flatMap((f) => f.lines), 1.4, 0.8, 4),
      this._corridorMat(0xff3b2f, 0.05, 1)), { renderOrder: 9 }));
    this.groups.faults = faults;
    const vis = this.visible || { rivers: true, canals: false, corridors: false, roads: true, faults: false };
    this.visible = vis;
    for (const [k, g] of Object.entries(this.groups)) { g.visible = !!vis[k]; this.group.add(g); }
    requestRender();
  }

  setVisible(k, on) { this.visible[k] = on; if (this.groups[k]) this.groups[k].visible = on; requestRender({ shadows: false }); }

  /** Highlight one corridor (others dim) or null for all. */
  focusCorridor(id) {
    for (const [cid, m] of Object.entries(this.corridorMeshes)) m.material.uniforms.uOpacity.value = !id || id === cid ? 1 : 0.18;
    requestRender({ shadows: false });
  }

  /** Colour rivers by Indus Waters Treaty allocation (western → Pakistan, eastern → India) or plain blue. */
  setTreatyView(on) {
    for (const m of this.riverMeshes) {
      const iwt = m.userData.iwt;
      const col = !on ? 0x2f8fd6 : iwt === 'western' ? 0x1fd6a0 : iwt === 'eastern' ? 0xff8a3d : 0x6a8fb0;
      m.material.uniforms.uColor.value.setHex(col);
    }
    requestRender({ shadows: false });
  }
}
