// Renderer, camera, controls, post-processing and the frame loop.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export class Stage {
  constructor(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 2, 20000);
    this.camera.position.set(0, 1500, 1350);
    const controls = new MapControls(this.camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 40; controls.maxDistance = 3200;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    this.controls = controls;
    this.labels = new CSS2DRenderer();
    this.labels.setSize(container.clientWidth, container.clientHeight);
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.3, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    this.tickers = [];
    this.flight = null;
    this.container = container;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.labels.setSize(w, h);
  }

  onTick(fn) { this.tickers.push(fn); }

  /** Smoothly fly the camera to look at `target` from `distance` at polar `tilt` and azimuth `azimuth` (radians). */
  flyTo(target, { distance = 380, tilt = 0.85, azimuth = null, duration = 2.4 } = {}) {
    const c = this.controls, cam = this.camera;
    const fromPos = cam.position.clone(), fromTgt = c.target.clone();
    const tgt = new THREE.Vector3(...target);
    const az = azimuth ?? Math.atan2(cam.position.x - c.target.x, cam.position.z - c.target.z);
    const toPos = new THREE.Vector3(
      tgt.x + distance * Math.sin(tilt) * Math.sin(az), tgt.y + distance * Math.cos(tilt),
      tgt.z + distance * Math.sin(tilt) * Math.cos(az));
    // arc up mid-flight for a cinematic hop
    const lift = Math.min(fromPos.distanceTo(toPos) * 0.35, 900);
    return new Promise((resolve) => {
      this.flight = { t: 0, duration, fromPos, fromTgt, toPos, tgt, lift, resolve };
    });
  }

  start(render) {
    const loop = () => {
      this.timer.update(); const dt = Math.min(this.timer.getDelta(), 0.5);
      const t = this.timer.getElapsed();
      if (this.flight) {
        const f = this.flight; f.t += dt / f.duration;
        const k = f.t >= 1 ? 1 : f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
        this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
        this.camera.position.y += Math.sin(Math.PI * k) * f.lift;
        this.controls.target.lerpVectors(f.fromTgt, f.tgt, k);
        if (f.t >= 1) { this.flight = null; f.resolve(); }
      }
      this.controls.update();
      for (const fn of this.tickers) fn(t, dt);
      this.composer.render();
      this.labels.render(this.scene, this.camera);
      render?.(t, dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
