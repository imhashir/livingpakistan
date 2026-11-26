// Borders drawn along hex edges: a glowing gold national frontier, province lines and faint district lines.
import * as THREE from 'three';

// Corner angles (degrees, y-down map space) of the edge shared with neighbour direction E, SE, SW, W, NW, NE.
const EDGE = [[-30, 30], [30, 90], [90, 150], [150, 210], [210, 270], [270, 330]];

export class Borders {
  constructor(board, districts, scene) {
    this.board = board; this.districts = districts; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.mats = {
      nation: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.75, 0.6), toneMapped: false, side: THREE.DoubleSide }),
      province: new THREE.MeshBasicMaterial({ color: 0xf4e3b5, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      district: new THREE.MeshBasicMaterial({ color: 0x1d1a14, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    };
    this.visible = { nation: true, province: true, district: true };
    this.build();
  }

  _neighbourInDir(cell, dir) {
    const g = this.board.grid; const [c, r] = g.colRow(cell);
    const off = (r & 1) ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    const cc = c + off[dir][0], rr = r + off[dir][1];
    return cc >= 0 && cc < g.cols && rr >= 0 && rr < g.rows ? g.index(cc, rr) : -1;
  }

  build() {
    this.group.clear();
    const b = this.board, w = b.world, R = b.grid.radius * 0.985;
    const buckets = { nation: [], province: [], district: [] };
    const prov = (o) => (o >= 0 ? this.districts[o].province : null);
    for (const c of b.cells) {
      const o = w.owner[c]; if (o < 0) continue;
      const [x, z] = b.worldXZ(c);
      for (let d = 0; d < 6; d++) {
        const nb = this._neighbourInDir(c, d);
        const on = nb >= 0 ? w.owner[nb] : -2;
        let kind = null;
        if (on === -2) kind = 'nation';
        else if (on < 0) continue; // coast / lake: the water edge speaks for itself
        else if (on !== o && nb > c) kind = prov(on) !== prov(o) ? 'province' : 'district';
        if (!kind) continue;
        const y = Math.max(b.topY(c), nb >= 0 && on >= 0 ? b.topY(nb) : 0) + (kind === 'nation' ? 0.35 : 0.2);
        const [a0, a1] = EDGE[d];
        const p0 = [x + R * Math.cos(a0 * Math.PI / 180), z + R * Math.sin(a0 * Math.PI / 180)];
        const p1 = [x + R * Math.cos(a1 * Math.PI / 180), z + R * Math.sin(a1 * Math.PI / 180)];
        buckets[kind].push([p0, p1, y]);
      }
    }
    const widths = { nation: 1.5, province: 0.9, district: 0.35 };
    for (const [kind, segs] of Object.entries(buckets)) {
      const pos = new Float32Array(segs.length * 18);
      let k = 0;
      for (const [[x0, z0], [x1, z1], y] of segs) {
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * widths[kind] / 2, nz = (dx / L) * widths[kind] / 2;
        const v = [[x0 - nx, y, z0 - nz], [x1 - nx, y, z1 - nz], [x1 + nx, y, z1 + nz],
          [x0 - nx, y, z0 - nz], [x1 + nx, y, z1 + nz], [x0 + nx, y, z0 + nz]];
        for (const p of v) { pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2]; }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, this.mats[kind]);
      m.renderOrder = kind === 'nation' ? 6 : 5; m.name = kind; m.visible = this.visible[kind];
      this.group.add(m);
      if (kind === 'nation') {
        // a soft vertical curtain of light along the frontier
        const cur = new Float32Array(segs.length * 18); let j = 0;
        for (const [[x0, z0], [x1, z1], y] of segs) {
          const v = [[x0, y, z0], [x1, y, z1], [x1, y + 5, z1], [x0, y, z0], [x1, y + 5, z1], [x0, y + 5, z0]];
          for (const p of v) { cur[j++] = p[0]; cur[j++] = p[1]; cur[j++] = p[2]; }
        }
        const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cur, 3));
        const uv = new Float32Array(segs.length * 12); let u = 0;
        for (let s = 0; s < segs.length; s++) for (const t of [0, 0, 1, 0, 1, 1]) { uv[u++] = 0; uv[u++] = t; }
        cg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const cm = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vec3(1.0, 0.75, 0.3) * (1.0 - vY) * 0.35, 1.0); }',
        });
        const curtain = new THREE.Mesh(cg, cm); curtain.name = 'nation'; curtain.renderOrder = 7;
        this.group.add(curtain);
      }
    }
  }

  setVisible(kind, on) {
    this.visible[kind] = on;
    this.group.children.forEach((m) => { if (m.name === kind) m.visible = on; });
  }
}
