// "You are here": a soft pulse on the viewer's own approximate position.
//
// Deliberately not the tour outline. A tour points at a thing with a known
// footprint, so it traces a boundary; this marks a point we only know roughly,
// so it reads as a glow rather than a claim about which hex you are standing
// in. Rings travel outward on a loop, which is legible at any zoom without
// competing with the amber of anything you can actually click.
import * as THREE from 'three';

const COLOR = new THREE.Color(0x7fe7ff); // ice, as elsewhere in the chrome
const PERIOD = 2.8;                      // seconds for one ring to travel out

export class HereMarker {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.frustumCulled = false;
    this.radius = 26;
    this.t0 = 0;

    const ringGeo = new THREE.RingGeometry(0.84, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const mat = (opacity) => new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity, side: THREE.DoubleSide,
      // sits on top of the terrain rather than sinking into a slope
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });

    this.rings = [0, 1].map((i) => {
      const m = new THREE.Mesh(ringGeo, mat(0));
      m.renderOrder = 25; m.frustumCulled = false; m.userData.phase = i / 2;
      this.group.add(m);
      return m;
    });

    const dotGeo = new THREE.CircleGeometry(1, 36);
    dotGeo.rotateX(-Math.PI / 2);
    this.dot = new THREE.Mesh(dotGeo, mat(0.85));
    this.dot.renderOrder = 26; this.dot.frustumCulled = false;
    this.group.add(this.dot);

    scene.add(this.group);
  }

  show(position, radius = 26, now = 0) {
    this.group.position.copy(position);
    this.radius = radius;
    this.t0 = now;
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }

  tick(t) {
    if (!this.group.visible) return;
    const age = t - this.t0;
    for (const m of this.rings) {
      const p = ((age / PERIOD) + m.userData.phase) % 1;
      const s = this.radius * (0.3 + p * 1.8);
      m.scale.set(s, 1, s);
      m.material.opacity = (1 - p) ** 1.7 * 0.75;
    }
    const breathe = 0.26 + 0.04 * Math.sin(age * 2.4);
    this.dot.scale.setScalar(this.radius * breathe);
    this.dot.material.opacity = 0.6 + 0.2 * Math.sin(age * 2.4);
  }
}
