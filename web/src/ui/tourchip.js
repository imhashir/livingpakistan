// On a phone, the tour narration folds into a round badge in the top-right
// corner so the map stays clear: the tour's icon in a ring of step segments,
// with small next and pause/play buttons hanging off it.
// Press and hold the badge to peek at the full card, which blooms out of the
// circle; let go and it folds back. A quick tap pins it open; touching the map
// or the card's shrink button puts it away, and the card's ✕ still ends the tour.
// Everything is scoped to body.mobile in tourchip.css, so desktop keeps its card.
import './tourchip.css';
import { el } from './dom.js';

const HOLD_MS = 300;   // press longer than this to peek
const SLOP = 10;       // px of travel that turns a press into nothing

const svg = (inner) => el('span', { class: 'tc-svg', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${inner}</svg>` });
const GLYPH = {
  next: '<path d="m9 6 6 6-6 6"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11"/>',
  play: '<path d="M8.5 6v12l9.5-6-9.5-6Z"/>',
  min: '<path d="M20 10h-6V4M14 10l6.5-6.5M4 14h6v6M10 14l-6.5 6.5"/>',
};

export class TourChip {
  constructor(tours) {
    this.tours = tours;
    this.state = 'closed'; // closed | peek | pinned
    this._build();
    this._bind();
  }

  _btn(cls, glyph, label, fn) {
    const b = el('button', { class: `tc-btn ${cls}`, title: label, 'aria-label': label }, [svg(GLYPH[glyph])]);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    // a press on a control is not the start of a hold on the badge
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  _build() {
    const T = this.tours;
    this.icon = el('span', { class: 'tc-icon' });
    this.ring = el('span', { class: 'tc-segs' });
    this.hold = el('div', { class: 'tc-hold', role: 'button', tabindex: '0', 'aria-expanded': 'false',
      'aria-label': 'Tour narration. Tap to open, press and hold to peek.' }, [this.ring, this.icon]);
    this.pauseBtn = this._btn('tc-pause', 'pause', 'Pause tour', () => T.togglePause());
    this.root = el('div', { class: 'tc-chip hidden' }, [
      this.hold, this._btn('tc-next', 'next', 'Next stop', () => T.next()), this.pauseBtn]);
    T.app.hud.append(this.root);
  }

  _bind() {
    const h = this.hold;
    let down = null, timer = 0;
    const clear = () => { clearTimeout(timer); timer = 0; };
    // iOS: no callout, no text selection, no magnifier on a long press
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    h.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      h.setPointerCapture?.(e.pointerId);
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, moved: false, held: false };
      clear();
      // the timer only shows the peek while the finger is still down; whether
      // the press was a tap or a hold is judged on release, by timestamps
      timer = setTimeout(() => {
        if (!down || down.moved) return;
        down.held = true;
        if (this.state === 'closed') { this.open('peek'); navigator.vibrate?.(8); }
      }, HOLD_MS);
    });
    h.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id || down.moved || down.held) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > SLOP) { down.moved = true; clear(); }
    });
    const up = (e, cancelled) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down; down = null; clear();
      // judged by the events' own timestamps: on a busy main thread the hold
      // timer can fire before a quick tap's pointerup is handled
      const tap = !cancelled && !d.moved && e.timeStamp - d.t < HOLD_MS;
      if (tap) { if (this.state === 'pinned') this.close(); else this.open('pinned'); return; }
      if (this.state === 'peek') this.close();
    };
    h.addEventListener('pointerup', (e) => up(e, false));
    h.addEventListener('pointercancel', (e) => up(e, true));
    // the tap that pins the card must not also click whatever on the card now
    // sits under the finger (shrink and end-tour are right there): no
    // compatibility click from the badge, and any stray click on the card is
    // dropped until the next real press
    h.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    this.tours.narr.addEventListener('click', (e) => {
      if (this._swallow) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (this.state === 'pinned') this.close(); else this.open('pinned'); }
    });
    // rotating to a desktop-width layout must not leave the card inert or folded
    window.addEventListener('resize', () => requestAnimationFrame(() => {
      if (!this.tours.active) return;
      if (!this.on) this.state = 'closed';
      this._apply();
    }));
    // a pinned card goes away when the map is touched; the touch still reaches the map
    document.addEventListener('pointerdown', (e) => {
      this._swallow = false;
      if (this.state !== 'pinned') return;
      if (this.root.contains(e.target) || this.tours.narr.contains(e.target)) return;
      this.close();
    }, true);
  }

  get on() { return document.body.classList.contains('mobile'); }

  open(state) {
    if (state === 'pinned') {
      this._swallow = true;
      clearTimeout(this._swallowT);
      this._swallowT = setTimeout(() => { this._swallow = false; }, 800);
    }
    this.state = state;
    this._apply();
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this._apply();
  }

  _apply() {
    const open = this.state !== 'closed';
    const b = document.body.classList;
    b.toggle('tc-open', open); b.toggle('tc-peek', this.state === 'peek'); b.toggle('tc-pinned', this.state === 'pinned');
    this.hold.setAttribute('aria-expanded', String(open));
    this.tours.narr.toggleAttribute('inert', !open && this.on);
  }

  /** Called by Tours each time a stop is shown, after the card is rebuilt. */
  update({ tour, i, steps, st }) {
    this.n = steps.length; this.i = i;
    this.hold.setAttribute('aria-label', `${tour.title}, stop ${i + 1} of ${this.n}: ${st.title}. Tap to open, press and hold to peek.`);
    this.icon.textContent = tour.icon;
    this._segments();
    this.syncPause();
    // the card's own way back to the badge, beside its end-tour ✕
    this.tours.narr.querySelector('.narr-head .narr-x')?.before(this._btn('tc-min', 'min', 'Shrink to the corner', () => this.close()));
    this.root.classList.remove('hidden');
    this.progress(0);
    this._apply();
  }

  _segments() {
    const n = this.n, gap = n > 1 ? 4 : 0, seg = 100 / n;
    const arc = (k, len, cls) => `<circle class="${cls}" cx="22" cy="22" r="19.5" pathLength="100" stroke-dasharray="${Math.max(0, len)} 100" stroke-dashoffset="${-(k * seg + gap / 2)}"/>`;
    let s = '';
    for (let k = 0; k < n; k++) s += arc(k, seg - gap, k < this.i ? 'done' : 'trk');
    s += arc(this.i, 0, 'val');
    this.ring.innerHTML = `<svg viewBox="0 0 44 44">${s}</svg>`;
    this.segVal = this.ring.querySelector('.val');
    this.segLen = seg - gap;
  }

  /** Fraction of the current stop's dwell that has passed. */
  progress(f) {
    this.segVal?.setAttribute('stroke-dasharray', `${this.segLen * f} 100`);
  }

  /** Reflect pause state on the badge and its pause button. */
  syncPause() {
    const p = !!this.tours.paused;
    this.root.classList.toggle('paused', p);
    const label = p ? 'Resume tour' : 'Pause tour';
    this.pauseBtn.title = label; this.pauseBtn.setAttribute('aria-label', label);
    this.pauseBtn.querySelector('svg').innerHTML = GLYPH[p ? 'play' : 'pause'];
  }

  hide() {
    this.state = 'closed';
    this._apply();
    this.tours.narr.removeAttribute('inert');
    this.root.classList.add('hidden');
  }
}
