// A glowing boundary traced around a set of hexes — the footprint of a city,
// a district or a peak — so a tour can show which one it means.
//
// Framing a subject with the camera is not enough: cities sit close enough
// together that a move between two of them reads as a drift, and a peak is
// easy to lose among its neighbours. Outlining the ground it stands on says
// "this one" without covering the landscape the tour flew there to show.
import * as THREE from 'three';

// Corner angles (degrees, y-down map space) of the edge shared with neighbour
// direction E, SE, SW, W, NW, NE — the same convention as scene/borders.js.
const EDGE = [[-30, 30], [30, 90], [90, 150], [150, 210], [210, 270], [270, 330]];
const WIDTH = 2.6;

export class Outline {
  constructor(board, scene) {
    this.board = board;
    this.uniforms = { uTime: { value: 0 }, uFade: { value: 0 } };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform float uFade;
        void main(){
          // a slow breath so the edge reads as live rather than painted on
          float pulse = 0.72 + 0.28 * sin(uTime * 2.6);
          vec3 mint = vec3(0.49, 1.0, 0.77);
          gl_FragColor = vec4(mint * 2.5 * pulse * uFade, pulse * uFade);
        }`,
    }));
    this.mesh.visible = false;
    this.mesh.renderOrder = 24;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  _neighbourInDir(cell, dir) {
    const g = this.board.grid; const [c, r] = g.colRow(cell);
    const off = (r & 1) ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    const cc = c + off[dir][0], rr = r + off[dir][1];
    return cc >= 0 && cc < g.cols && rr >= 0 && rr < g.rows ? g.index(cc, rr) : -1;
  }

  /** The cell nearest a world point. Called once per tour step, so a scan is fine. */
  cellAt(wx, wz) {
    let best = -1, bd = Infinity;
    for (const c of this.board.cells) {
      const [x, z] = this.board.worldXZ(c);
      const d = (x - wx) ** 2 + (z - wz) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** A cell and its ring of neighbours — the footprint used for a point subject. */
  rosette(cell) {
    const out = [cell];
    for (let d = 0; d < 6; d++) {
      const n = this._neighbourInDir(cell, d);
      if (n >= 0) out.push(n);
    }
    return out;
  }

  /** Trace the perimeter of `cells`: every edge whose neighbour is outside the set. */
  show(cells) {
    const set = cells instanceof Set ? cells : new Set(cells);
    if (!set.size) return this.hide();
    const b = this.board, R = b.grid.radius * 0.985;
    const segs = [];
    for (const c of set) {
      const [x, z] = b.worldXZ(c);
      for (let d = 0; d < 6; d++) {
        const nb = this._neighbourInDir(c, d);
        if (nb >= 0 && set.has(nb)) continue; // interior edge
        const y = b.topY(c) + 0.9;
        const [a0, a1] = EDGE[d];
        segs.push([
          [x + R * Math.cos(a0 * Math.PI / 180), z + R * Math.sin(a0 * Math.PI / 180)],
          [x + R * Math.cos(a1 * Math.PI / 180), z + R * Math.sin(a1 * Math.PI / 180)],
          y,
        ]);
      }
    }
    const pos = new Float32Array(segs.length * 18);
    let k = 0;
    for (const [[x0, z0], [x1, z1], y] of segs) {
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * WIDTH / 2, nz = (dx / L) * WIDTH / 2;
      const v = [[x0 - nx, y, z0 - nz], [x1 - nx, y, z1 - nz], [x1 + nx, y, z1 + nz],
        [x0 - nx, y, z0 - nz], [x1 + nx, y, z1 + nz], [x0 + nx, y, z0 + nz]];
      for (const p of v) { pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.mesh.visible = true;
    this._shownAt = null; // faded in on the next tick
  }

  hide() { this.mesh.visible = false; this.uniforms.uFade.value = 0; }

  tick(t) {
    if (!this.mesh.visible) return;
    if (this._shownAt == null) this._shownAt = t;
    this.uniforms.uTime.value = t;
    this.uniforms.uFade.value = Math.min(1, (t - this._shownAt) / 0.45);
  }
}
