// Render quality tiers, how a device is placed in one, and the governor that moves it when the
// frame rate says the guess was wrong.
//
//   high    exactly what the site has always drawn: 4096² sun shadows, bloom, every shader effect,
//           ambient motion at full frame rate, up to 2× pixel ratio.
//   medium  the same picture with a 2048² shadow map, pixel ratio capped at 1.5 (and ~2 MP),
//           ambient motion (water, rivers, pulses) at 30 fps instead of every frame.
//   low     for TVs, cheap phones and software GL: no shadows, no bloom, simplified water / fog /
//           tile shaders, ambient motion still, ~0.9 MP render target (text stays sharp: it's DOM).
//
// The choice is ?quality=low|auto|high, else what the user picked (localStorage), else auto.

export const TIERS = {
  high: { name: 'high', pixelRatioCap: 2, maxPixels: Infinity, shadows: true, shadowSize: 4096, bloom: true, ambientFps: Infinity, cheap: false },
  medium: { name: 'medium', pixelRatioCap: 1.5, maxPixels: 1920 * 1080, shadows: true, shadowSize: 2048, bloom: true, ambientFps: 30, cheap: false },
  low: { name: 'low', pixelRatioCap: 1, maxPixels: 1280 * 720, shadows: false, shadowSize: 0, bloom: false, ambientFps: 0, cheap: true },
};
const ORDER = ['low', 'medium', 'high'];
const KEY = 'livingpakistan.quality';
export const MODES = ['low', 'auto', 'high'];

/** The mode asked for: URL beats the saved choice beats auto. */
export function requestedMode() {
  const q = new URLSearchParams(location.search).get('quality');
  if (MODES.includes(q)) return { mode: q, fromUrl: true };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  return { mode: MODES.includes(saved) ? saved : 'auto', fromUrl: false };
}

export function saveMode(mode) { try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch {} }

/** What the device says about itself, without drawing anything. */
export function probeDevice(gl) {
  const nav = navigator, ua = nav.userAgent || '';
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {}
  return {
    ua, gpu,
    memory: nav.deviceMemory ?? null, // GB, Chromium only; rounded down to 0.25 / 0.5 / 1 / 2 / 4 / 8
    cores: nav.hardwareConcurrency ?? null,
    tv: /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|HbbTV|CrKey|\bAFT[A-Z]|Android TV|GoogleTV|AppleTV|Roku|VIDAA|Hisense|PhilipsTV|Opera TV|Viera|NETTV|Xbox|PlayStation|SamsungBrowser\/.*TV/i.test(ua),
    touch: matchMedia('(pointer: coarse)').matches,
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
}

/** Place a device in a tier from what it reports. The governor corrects the guess afterwards. */
export function guessTier(d) {
  const g = d.gpu;
  const software = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/i.test(g);
  // GPUs common in TVs, set-top boxes and entry phones
  const weak = /Mali-(400|450|T\d|G31|G51|G52|G57)|PowerVR|SGX|Adreno \(TM\) [2-5]\d\d|VideoCore|Vivante|GC\d{3,4}|Tegra 3|Tegra 4|Intel.*GMA|Mesa DRI Intel\(R\) HD/i.test(g);
  const integrated = /Intel\(R\) (HD|UHD) Graphics|Intel HD|Intel UHD|Mali-G(68|7[0-8])|Adreno \(TM\) 6[0-4]\d/i.test(g);
  const reasons = [];
  let tier = 'high';
  const down = (t, why) => { if (ORDER.indexOf(t) < ORDER.indexOf(tier)) tier = t; reasons.push(why); };
  if (software) down('low', 'software GL');
  if (d.tv) down('low', 'TV browser');
  if (weak) down('low', 'entry-level GPU');
  if (d.memory != null && d.memory <= 2) down('low', `${d.memory} GB RAM`);
  if (d.maxTexture && d.maxTexture < 4096) down('low', 'small max texture');
  if (d.memory != null && d.memory <= 4) down('medium', `${d.memory} GB RAM`);
  if (d.cores != null && d.cores <= 4) down('medium', `${d.cores} cores`);
  if (integrated) down('medium', 'integrated GPU');
  return { tier, reasons };
}

/**
 * Watches the frame rate while frames are being drawn back to back (camera moving, ambient
 * motion) and steps the tier down when it can't keep up, or back up when it clearly can.
 * Hysteresis: a tier it had to leave for being slow is never auto-retried this session.
 */
export class Governor {
  constructor({ start, onChange }) {
    this.tier = start; this.onChange = onChange;
    this.samples = []; this.failed = new Set();
    this.scale = 1; // extra render scale below the low tier, 1 → 0.6
    this.holdUntil = performance.now() + 2500; // skip shader-compile hitches at boot
    this.enabled = true;
  }

  hold(ms = 2000) { this.holdUntil = performance.now() + ms; this.samples.length = 0; }

  /** One drawn frame, `ms` after the previous drawn frame. */
  sample(ms) {
    if (!this.enabled || document.hidden) return;
    const now = performance.now();
    if (now < this.holdUntil) return;
    if (ms > 400) { this.samples.length = 0; return; } // a gap (tab switch, idle), not a slow frame
    this.samples.push(ms);
    if (this.samples.length < 45) return;
    const s = [...this.samples].sort((a, b) => a - b), med = s[s.length >> 1];
    const slow = med > 1000 / 24, fast = med < 1000 / 52;
    if (slow) {
      const i = ORDER.indexOf(this.tier);
      if (i > 0) { this.failed.add(this.tier); this._set(ORDER[i - 1], 1, `median ${med.toFixed(0)} ms`); }
      else if (this.scale > 0.6) this._set('low', Math.max(0.6, this.scale - 0.2), `median ${med.toFixed(0)} ms`);
      else this.samples.length = 0;
      return;
    }
    if (this.samples.length < 240) return; // ~4 s of smooth frames before stepping up
    if (fast) {
      if (this.scale < 1) this._set(this.tier, Math.min(1, this.scale + 0.2), 'headroom');
      else {
        const up = ORDER[ORDER.indexOf(this.tier) + 1];
        if (up && !this.failed.has(up)) this._set(up, 1, 'headroom');
      }
    }
    this.samples.length = 0;
  }

  _set(tier, scale, why) {
    this.tier = tier; this.scale = scale; this.hold(2500);
    this.onChange(tier, scale, why);
  }
}

/**
 * Owns the mode (low / auto / high), applies tiers to the stage and runs the governor in auto.
 * Listeners get (tierName, mode) whenever either changes, for the HUD control.
 */
export class QualityController {
  constructor(stage) {
    this.stage = stage;
    this.device = probeDevice(stage.renderer.getContext());
    this.guess = guessTier(this.device);
    const r = requestedMode();
    this.mode = stage.capture ? 'high' : r.mode;
    this.fromUrl = r.fromUrl;
    this.listeners = [];
    this.log = [];
    stage.onFrame = (ms) => { if (this.mode === 'auto') this.governor?.sample(ms); };
  }

  get tier() { return this.stage.tier.name; }

  onChange(fn) { this.listeners.push(fn); }

  /** Apply the requested mode. Called once at boot, then by the HUD control. */
  setMode(mode, { persist = true } = {}) {
    if (!MODES.includes(mode)) mode = 'auto';
    this.mode = mode;
    if (persist) saveMode(mode);
    const tier = mode === 'auto' ? this.guess.tier : mode;
    this.governor = mode === 'auto' ? new Governor({ start: tier, onChange: (t, scale, why) => this._apply(t, scale, why) }) : null;
    this._apply(tier, 1, mode === 'auto' ? `auto: ${this.guess.reasons.join(', ') || 'capable device'}` : 'chosen');
  }

  _apply(tier, scale, why) {
    this.log.push({ at: Math.round(performance.now()), tier, scale, why });
    this.stage.setQuality(tier, scale);
    for (const fn of this.listeners) fn(this.tier, this.mode);
  }
}
