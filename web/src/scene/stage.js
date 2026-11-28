// Renderer, camera, controls, post-processing and the frame loop.
//
// The loop only draws when something changed: the camera moved, a flight or animation is running,
// a scene module called requestRender(), or the quality tier's ambient clock (water shimmer, river
// flow, pulses) is due. On the high tier that clock ticks every frame, exactly as before; medium
// ticks it at 30 fps; low freezes it, and there the loop itself rests while nothing happens.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TIERS } from '../quality.js';
import { bindStage } from './frame.js';

export class Stage {
  constructor(container) {
    this.capture = /[?&]capture=1/.test(location.search);
    // No canvas MSAA: the scene is drawn into the composer's (non-multisampled) target and the
    // canvas only ever receives OutputPass's full-screen triangle, so antialias bought nothing but
    // memory. The drawing buffer is only preserved for the frame-by-frame video recorder.
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: this.capture });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun and everything that casts shadows hold still, so the shadow map is redrawn only
    // when the scene changes (requestRender), not on camera moves or ambient frames.
    renderer.shadowMap.autoUpdate = false;
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
    this.qualityListeners = [];
    this.flight = null;
    this.container = container;
    this.tier = TIERS.high; this.renderScale = 1;
    this.at = 0; // ambient clock: what the shaders animate by
    this._lastAmbient = -1;
    this._dirty = true; this._shadowDirty = true; this._labelsDirty = true;
    this._camSig = new Float64Array(32).fill(Infinity);
    this.drawn = 0; // frames actually rendered
    bindStage(this);
    window.addEventListener('resize', () => this.resize());
    // Safety net: any input may change what is drawn, so the frame after it always renders.
    // (Everything that moves a shadow caster asks for the shadow map itself, via requestRender.)
    for (const ev of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'input', 'change', 'click', 'touchend']) {
      window.addEventListener(ev, () => this.invalidate({ shadows: false }), { capture: true, passive: true });
    }
    // hovering only needs the loop awake (to pick under the cursor), not a redraw
    window.addEventListener('pointermove', () => this.wake(), { capture: true, passive: true });
  }

  /** The picture is stale: draw on the next frame. */
  invalidate({ shadows = true } = {}) {
    this._dirty = true; this._labelsDirty = true;
    if (shadows) this._shadowDirty = true;
    this.wake();
  }

  /** Resume the full-rate loop if it is resting (low tier, nothing moving). */
  wake() {
    if (!this._sleepT) return;
    clearTimeout(this._sleepT); this._sleepT = 0;
    requestAnimationFrame(this._loop);
  }

  invalidateLabels() { this._labelsDirty = true; }

  onQuality(fn) { this.qualityListeners.push(fn); }

  /**
   * Switch quality tier. `scale` (≤ 1) shrinks the render target further, for the governor's
   * last resort below the low tier.
   */
  setQuality(name, scale = 1) {
    const q = TIERS[name] || TIERS.high, prev = this.tier;
    this.tier = q; this.renderScale = scale;
    const r = this.renderer;
    if (prev.shadows !== q.shadows) {
      r.shadowMap.enabled = q.shadows;
      // shadow receivers compile differently with and without a shadow map
      this.scene.traverse((o) => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; });
    }
    this.bloom.enabled = q.bloom;
    if (!q.bloom) {
      // free the bloom mip chain; three re-creates it if bloom comes back
      this.bloom.renderTargetBright.dispose();
      for (const rt of [...this.bloom.renderTargetsHorizontal, ...this.bloom.renderTargetsVertical]) rt.dispose();
    }
    for (const fn of this.qualityListeners) fn(q, prev);
    this._applyPixelRatio();
    this._lastAmbient = -1;
    this.invalidate();
  }

  _applyPixelRatio() {
    const q = this.tier, w = this.container.clientWidth, h = this.container.clientHeight;
    let pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
    if (w * h * pr * pr > q.maxPixels) pr = Math.sqrt(q.maxPixels / (w * h));
    pr = Math.max(0.5, pr * this.renderScale);
    if (pr === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.labels.setSize(w, h);
    this._applyPixelRatio();
    this.invalidate({ shadows: false });
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
    this.wake();
    return new Promise((resolve) => {
      this.flight = { t: 0, duration, fromPos, fromTgt, toPos, tgt, lift, resolve };
    });
  }

  /**
   * True if the camera moved or its projection changed since the last draw by more than a
   * hair. Damping leaves a residue that shrinks forever by invisible amounts; 1e-5 is a
   * fraction of a pixel in rotation, and nothing at all in world units.
   */
  _cameraChanged() {
    const c = this.camera; c.updateMatrixWorld();
    const a = c.matrixWorld.elements, b = c.projectionMatrix.elements, s = this._camSig;
    let changed = false;
    for (let i = 0; i < 16 && !changed; i++) changed = Math.abs(s[i] - a[i]) > 1e-5 || Math.abs(s[16 + i] - b[i]) > 1e-5;
    if (changed) for (let i = 0; i < 16; i++) { s[i] = a[i]; s[16 + i] = b[i]; }
    return changed;
  }

  /** Draw the scene now (shadow map first if the scene changed). */
  renderNow() {
    if (this._shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this._shadowDirty = false; }
    this.composer.render();
    this._dirty = false;
    this.drawn++;
  }

  start(render) {
    // Capture mode (?capture=1): no free-running loop; a recorder advances a virtual clock one fixed frame at a time
    // via window.__livingpakistan_step(dt), so camera moves, shaders and playback are deterministic at any render speed.
    this.vt = 0;
    let drewLast = false;
    const frame = (dt, t, draw = true) => {
      let active = false;
      if (this.flight) {
        const f = this.flight; f.t += dt / f.duration;
        const k = f.t >= 1 ? 1 : f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
        this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
        this.camera.position.y += Math.sin(Math.PI * k) * f.lift;
        this.controls.target.lerpVectors(f.fromTgt, f.tgt, k);
        if (f.t >= 1) { this.flight = null; f.resolve(); }
        active = true;
      }
      if (this.controls.update()) active = true;
      // the ambient clock: every frame on high, 30 fps on medium, frozen on low
      const fps = this.tier.ambientFps;
      let ambient = false;
      if (fps === Infinity || this.capture) { this.at = t; ambient = true; }
      else if (fps > 0) {
        this.at = t;
        if (t - this._lastAmbient >= 1 / fps - 0.004) { this._lastAmbient = t; ambient = true; }
      }
      for (const fn of this.tickers) if (fn(this.at, dt, t)) active = true;
      const moved = this._cameraChanged();
      const drew = draw && (this.capture || this._dirty || active || ambient || moved);
      if (drew) this.renderNow();
      if (drew && drewLast) this.onFrame?.(dt * 1000);
      drewLast = drew;
      this._idleFrames = drew || active ? 0 : this._idleFrames + 1;
      if (moved || this._labelsDirty || this.capture) { this.labels.render(this.scene, this.camera); this._labelsDirty = false; }
      render?.(t, dt);
    };
    if (this.capture) {
      window.__livingpakistan_step = (dt = 1 / 30, draw = true) => { this.vt += dt; frame(dt, this.vt, draw); };
      frame(0, 0);
      return;
    }
    // With nothing animating (low tier) and nothing drawn for ~0.5 s, the loop rests: it ticks at
    // 5 Hz instead of every display frame until invalidate()/wake() or input brings it back.
    this._idleFrames = 0;
    const loop = this._loop = () => {
      this.timer.update(); const dt = Math.min(this.timer.getDelta(), 0.5);
      frame(dt, this.timer.getElapsed());
      if (this.tier.ambientFps === 0 && !this.flight && this._idleFrames > 30) this._sleepT = setTimeout(() => { this._sleepT = 0; requestAnimationFrame(loop); }, 200);
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

}
