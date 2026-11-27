// The hex board: one InstancedMesh of extruded hex prisms (land, sea floor, lakes) + instanced low-poly peaks.
import * as THREE from 'three';
import { HexGrid } from '../hex.js';

export const TERRAIN_COLORS = {
  sea: 0x1d4f73, lake: 0x2f7fa8, glacier: 0xeef3f7, urban: 0xb8a48c, marsh: 0x5d8a6e, forest_mtn: 0x45683f,
  mountain: 0x9a7a55, farmland: 0x93ae45, forest: 0x3d6a35, farm_mixed: 0xa7a659, hills: 0xa99566,
  desert: 0xe2c588, steppe: 0xb7aa76, scrub: 0xc6ac7a,
};
// Pattern ids drawn procedurally on the top faces: 0 none, 1 crop rows, 2 dunes, 3 tree dots, 4 snow sparkle, 5 city grid
const TERRAIN_PATTERN = { farmland: 1, farm_mixed: 1, desert: 2, forest: 3, forest_mtn: 3, glacier: 4, urban: 5, marsh: 3 };

const HEX_R = 10;
const FLOOR = -8;

export class Board {
  constructor(world, scene) {
    this.world = world;
    this.grid = new HexGrid(world.grid);
    this.scene = scene;
    this.W = world.projection.width; this.H = world.projection.height;
    this.ox = -this.W / 2; this.oz = -this.H / 2;
    this.exaggeration = 12;
    const n = this.grid.size;
    // Which cells get a prism: everything except open sea far from any land.
    // true ocean = sea cells connected to the Arabian Sea (bottom-left corner); inland "sea" slivers become void
    this.ocean = new Uint8Array(world.owner.length);
    { const q = [this.grid.index(0, this.grid.rows - 1)]; this.ocean[q[0]] = 1;
      for (let h = 0; h < q.length; h++) for (const j of this.grid.neighbours(q[h])) if (!this.ocean[j] && world.owner[j] === -1) { this.ocean[j] = 1; q.push(j); } }
    const dist = this._coastDistance();
    this.coastDist = dist;
    this.cells = [];
    // Foreign land fades into a fog of war a few hexes beyond the border.
    this.foreignDist = this._foreignDistance();
    this.FOG_HEX = 7;
    for (let i = 0; i < n; i++) {
      if (world.owner[i] === -1) { if (dist[i] <= 14 && this.ocean[i]) this.cells.push(i); }
      else if (world.owner[i] >= 0 || (this.foreignDist[i] <= this.FOG_HEX && !(world.owner[i] === -3 && this.foreignDist[i] > 2))) this.cells.push(i);
    }
    this.instanceOf = new Int32Array(n).fill(-1);
    this.cells.forEach((c, k) => { this.instanceOf[c] = k; });
    this._buildPrisms();
    this._buildPeaks();
    this.setExaggeration(this.exaggeration);
    this.paintTerrain();
  }

  // ---- geometry helpers
  worldXZ(cell) { const [x, y] = this.grid.center(cell); return [x + this.ox, y + this.oz]; }
  mapToWorld(x, y) { return [x + this.ox, y + this.oz]; }
  isPak(cell) { return this.world.owner[cell] >= 0; }
  topY(cell) {
    const w = this.world;
    if (w.water[cell] === 1 || w.water[cell] === 2) return -0.6 - Math.min(this.coastDist[cell], 10) * 0.55;
    const e = Math.max(w.elev[cell], 0);
    const base = w.water[cell] === 3 ? -0.3 : 0.6;
    // foreign land sinks gradually into the fog of war
    const foreign = w.owner[cell] === -2 || (w.owner[cell] === -3 && this.foreignDist[cell] > 0);
    const sink = foreign ? Math.max(0.0, 1 - this.foreignDist[cell] / (this.FOG_HEX + 1)) : 1;
    return foreign ? -7 + (base + 7 + (e / 1000) * this.exaggeration) * sink : base + (e / 1000) * this.exaggeration;
  }
  heightAt(x, z) { // world coords → top of the hex below
    const c = this.grid.cellAt(x - this.ox, z - this.oz);
    return c < 0 ? 0 : Math.max(this.topY(c), 0);
  }

  _foreignDistance() {
    const n = this.grid.size, w = this.world, d = new Int16Array(n).fill(99), q = [];
    for (let i = 0; i < n; i++) if (w.owner[i] >= 0) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of this.grid.neighbours(i)) if (w.owner[j] !== -1 && d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
    }
    return d;
  }

  /** Texture over the grid: R = 1 where the sea surface should be drawn. */
  waterMask() {
    const g = this.grid, w = this.world, data = new Uint8Array(g.size * 4);
    for (let i = 0; i < g.size; i++) {
      const sea = (w.owner[i] === -1 && this.ocean[i]) || (w.owner[i] === -3 && this.foreignDist[i] <= 2);
      data[i * 4] = sea ? 255 : 0; data[i * 4 + 3] = 255;
    }
    return data;
  }

  _coastDistance() {
    const n = this.grid.size, w = this.world, d = new Int16Array(n).fill(99);
    const q = [];
    for (let i = 0; i < n; i++) if (w.water[i] === 0 || w.water[i] === 3) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of this.grid.neighbours(i)) if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
    }
    return d;
  }

  _buildPrisms() {
    const geo = new THREE.CylinderGeometry(HEX_R * 0.965, HEX_R * 0.985, 1, 6, 1, false);
    geo.translate(0, 0.5, 0);
    // Normal-up flag per vertex for the shader (1 on the top cap).
    const up = new Float32Array(geo.attributes.position.count);
    for (let v = 0; v < up.length; v++) up[v] = geo.attributes.normal.getY(v) > 0.9 ? 1 : 0;
    geo.setAttribute('aUp', new THREE.BufferAttribute(up, 1));
    const N = this.cells.length;
    this.glow = new Float32Array(N);
    this.pattern = new Float32Array(N);
    this.dim = new Float32Array(N); // 1 = foreign / fog-of-war
    this.highlight = new Float32Array(N);
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.glow, 1));
    geo.setAttribute('aPattern', new THREE.InstancedBufferAttribute(this.pattern, 1));
    geo.setAttribute('aDim', new THREE.InstancedBufferAttribute(this.dim, 1));
    geo.setAttribute('aHi', new THREE.InstancedBufferAttribute(this.highlight, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.0, flatShading: false });
    this.uniforms = {
      uNight: { value: 0 }, uTime: { value: 0 }, uLens: { value: 0 }, uGlowColor: { value: new THREE.Color(0xffb24a) },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aUp; attribute float aGlow; attribute float aPattern; attribute float aDim; attribute float aHi;
          varying float vUp; varying float vGlow; varying float vPattern; varying float vDim; varying float vHi; varying vec3 vWP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vUp = aUp; vGlow = aGlow; vPattern = aPattern; vDim = aDim; vHi = aHi;
          vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; uniform float uTime; uniform float uLens; uniform vec3 uGlowColor;
          varying float vUp; varying float vGlow; varying float vPattern; varying float vDim; varying float vHi; varying vec3 vWP;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 p = vWP.xz;
            float n = vnoise(p * 0.35) * 0.6 + vnoise(p * 1.3) * 0.4;
            float pat = vPattern;
            float top = step(0.5, vUp);
            float lensOn = uLens;
            vec3 c = diffuseColor.rgb;
            if (lensOn < 0.5) {
              c *= 0.9 + 0.2 * n;
              if (abs(pat - 1.0) < 0.1) { // crop rows in rotated patches
                float a = floor(vnoise(p * 0.18) * 4.0) * 0.785;
                vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
                float rows = smoothstep(0.35, 0.5, abs(fract(q.x * 0.9) - 0.5));
                float pch = step(0.5, vnoise(p * 0.45));
                c = mix(c, c * vec3(1.12, 1.08, 0.78), top * pch * 0.55);
                c *= 1.0 - top * rows * 0.12;
              } else if (abs(pat - 2.0) < 0.1) { // dunes
                float d = sin(p.x * 0.55 + vnoise(p * 0.2) * 6.0 + p.y * 0.18);
                c *= 1.0 + top * 0.09 * d;
              } else if (abs(pat - 3.0) < 0.1) { // canopy dots
                float t = smoothstep(0.55, 0.75, vnoise(p * 2.2));
                c = mix(c, c * 0.62, top * t);
              } else if (abs(pat - 4.0) < 0.1) { // glacier sparkle + crevasses
                float s = step(0.985, h21(floor(p * 3.0) + floor(uTime * 2.0)));
                c += top * s * 0.35; c *= 1.0 - top * 0.08 * smoothstep(0.48, 0.5, abs(fract(p.x*0.4 + n) - 0.5));
              } else if (abs(pat - 5.0) < 0.1) { // street grid
                vec2 g = abs(fract(p * 0.7) - 0.5);
                float street = smoothstep(0.42, 0.5, max(g.x, g.y));
                c = mix(c, c * 0.72, top * street);
              }
            }
            c *= mix(0.58, 1.0, top);            // sides darker → crisp extruded tiles
            c = mix(c, vec3(dot(c, vec3(0.33))) * vec3(0.85, 0.84, 0.82), vDim * 0.72); // foreign land: muted
            c *= 1.0 - vDim * 0.18;
            c = mix(c, vec3(1.0, 0.86, 0.35), vHi * 0.55 * (0.75 + 0.25 * sin(uTime * 5.0)));
            diffuseColor.rgb = c;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += uGlowColor * vGlow * uNight * (0.75 + 0.5 * vUp)
            * (0.85 + 0.3 * vnoise(vWP.xz * 1.7 + uTime * 0.2));
          totalEmissiveRadiance += vec3(1.0, 0.8, 0.3) * vHi * 0.25;`);
    };
    this.material = mat;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh;
    this.scene.add(mesh);
    for (let k = 0; k < N; k++) {
      const c = this.cells[k];
      this.dim[k] = this.world.owner[c] === -2 ? Math.min(1, 0.55 + 0.45 * this.foreignDist[c] / this.FOG_HEX) : 0;
      const t = this.world.terrain_names[this.world.terrain[c]];
      this.pattern[k] = this.world.owner[c] >= -3 && this.world.water[c] === 0 ? (TERRAIN_PATTERN[t] || 0) : 0;
    }
  }

  _buildPeaks() {
    // Low-poly mountain cones on rugged land hexes; their tips reach the hex's highest DEM pixel.
    const w = this.world, list = [];
    for (const c of this.cells) {
      if (w.water[c] !== 0 || w.relief[c] < 1) continue;
      const rise = (w.elev_max[c] - Math.max(w.elev[c], 0)) * (w.owner[c] === -2 ? Math.max(0, 1 - this.foreignDist[c] / 5) : 1);
      if (rise < 400) continue;
      const k = w.relief[c] >= 3 ? 3 : w.relief[c] >= 2 ? 2 : 1;
      for (let j = 0; j < k; j++) list.push([c, j, rise]);
    }
    this.peakList = list;
    const geo = new THREE.ConeGeometry(1, 1, 5, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true });
    this.peakUniforms = { uSnowY: { value: 40 }, uRockY: { value: 15 }, uDim: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.peakUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP2;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vWP2 = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uSnowY; uniform float uRockY; uniform float uDim; varying vec3 vWP2;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          { float y = vWP2.y;
            vec3 rock = mix(diffuseColor.rgb, vec3(0.47, 0.43, 0.40), smoothstep(uRockY * 0.6, uRockY, y));
            float sn = smoothstep(uSnowY - 2.5, uSnowY + 1.5, y + 2.0 * sin(vWP2.x * 0.7) * cos(vWP2.z * 0.6));
            diffuseColor.rgb = uDim > 0.5 ? diffuseColor.rgb : mix(rock, vec3(0.96, 0.97, 1.0), sn); }`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.count = list.length;
    this.peaks = mesh;
    this.scene.add(mesh);
    const col = new THREE.Color();
    this.peakBase = [];
    list.forEach(([c], k) => {
      const t = w.terrain_names[w.terrain[c]];
      col.setHex(t === 'forest_mtn' ? 0x56704a : w.owner[c] === -2 ? 0x8f8a82 : 0x8b7458);
      mesh.setColorAt(k, col); this.peakBase.push(col.getHex());
    });
  }

  _rand(i, j) { const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s); }

  setExaggeration(ex) {
    this.exaggeration = ex;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.cells.forEach((c, k) => {
      const [x, z] = this.worldXZ(c);
      const top = this.topY(c);
      p.set(x, FLOOR, z); s.set(1, top - FLOOR, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(k, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    const w = this.world;
    const up = new THREE.Vector3(0, 1, 0);
    this.peakList.forEach(([c, j, rise], k) => {
      const [x, z] = this.worldXZ(c);
      const top = this.topY(c);
      const main = j === 0;
      const hgt = (rise / 1000) * ex * (main ? 0.85 : 0.45 + 0.25 * this._rand(c, j));
      const rad = main ? 9 + this._rand(c, 9) * 2.5 : 5.5 + this._rand(c, j) * 2.5;
      const a = this._rand(c, j + 3) * Math.PI * 2, d = main ? 0 : 4.5 + this._rand(c, j + 5) * 2;
      p.set(x + Math.cos(a) * d, top - 0.2, z + Math.sin(a) * d);
      q.setFromAxisAngle(up, this._rand(c, j + 7) * 6.28);
      s.set(rad, Math.max(hgt, 0.5), rad);
      m.compose(p, q, s);
      this.peaks.setMatrixAt(k, m);
    });
    q.identity();
    this.peaks.instanceMatrix.needsUpdate = true;
    this.peaks.computeBoundingSphere();
    // snowline ≈ 4,800 m in the Karakoram; rock above ~3,000 m
    this.peakUniforms.uSnowY.value = 0.6 + 4.8 * ex;
    this.peakUniforms.uRockY.value = 0.6 + 3.0 * ex;
    this.onExaggeration?.(ex);
  }

  paintTerrain() {
    const col = new THREE.Color(), w = this.world;
    this.uniforms.uLens.value = 0;
    this.cells.forEach((c, k) => {
      const t = w.terrain_names[w.terrain[c]];
      if (w.water[c] === 1 || w.water[c] === 2) {
        const d = Math.min(this.coastDist[c], 10) / 10;
        col.setHex(0x3aa7b5).lerp(new THREE.Color(0x0f2f4f), Math.pow(d, 0.6));
      } else {
        col.setHex(TERRAIN_COLORS[t] ?? 0xaaaaaa);
        // elevation tint: high plateaus go cooler & paler
        const e = w.elev[c];
        if (e > 3200 && t !== 'glacier') col.lerp(new THREE.Color(0x9c9488), Math.min((e - 3200) / 2500, 0.55));
        const j = (this._rand(c, 1) - 0.5) * 0.08;
        col.offsetHSL(0, 0, j);
      }
      this.mesh.setColorAt(k, col);
    });
    this.mesh.instanceColor.needsUpdate = true;
    this._tintPeaks(null);
  }

  _tintPeaks(colorOf) {
    if (!this.peaks.instanceColor) return;
    const col = new THREE.Color();
    this.peakUniforms.uDim.value = colorOf ? 1 : 0;
    this.peakList.forEach(([c], k) => {
      const v = colorOf ? colorOf(c) : null;
      if (v) col.copy(v).multiplyScalar(0.9); else col.setHex(colorOf && this.world.owner[c] >= -2 ? 0x55575c : this.peakBase[k]);
      this.peaks.setColorAt(k, col);
    });
    this.peaks.instanceColor.needsUpdate = true;
  }

  paintLens(colorFn) {
    // colorFn(cell) → THREE.Color | null. Null keeps a muted terrain colour.
    const col = new THREE.Color(), w = this.world;
    this.uniforms.uLens.value = 1;
    this.cells.forEach((c, k) => {
      const v = w.owner[c] >= 0 ? colorFn(c) : null;
      if (v) col.copy(v);
      else if (w.water[c] === 1 || w.water[c] === 2) col.setHex(0x163a57);
      else col.setHex(w.owner[c] >= 0 ? 0x3b3f45 : 0x6b6a66);
      this.mesh.setColorAt(k, col);
    });
    this.mesh.instanceColor.needsUpdate = true;
    this._tintPeaks((c) => (w.owner[c] >= 0 ? colorFn(c) : null));
  }

  setGlow(fn) {
    this.cells.forEach((c, k) => { this.glow[k] = fn(c); });
    this.mesh.geometry.attributes.aGlow.needsUpdate = true;
  }

  setHighlight(cellSet) {
    this.highlight.fill(0);
    if (cellSet) for (const c of cellSet) { const k = this.instanceOf[c]; if (k >= 0) this.highlight[k] = 1; }
    this.mesh.geometry.attributes.aHi.needsUpdate = true;
  }

  pick(raycaster) {
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || hit.instanceId == null) return null;
    return { cell: this.cells[hit.instanceId], point: hit.point };
  }
}
