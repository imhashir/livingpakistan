// Design preview, behind ?tourchip=A|B|C|D: on a phone, the tour narration
// shrinks to a small chip in the top-right corner so the map stays clear.
// Press and hold the chip to peek at the full card (it grows out of the
// chip's corner, and shrinks back on release); a quick tap pins it open.
// Four concepts share that behaviour and differ in what the chip shows and
// which controls stay on it:
//   A  pill: progress ring (tap = pause), "1 / 5", next
//   B  stop chip: "K2 · 8,611 m" and next; swipe it sideways for next/prev
//   C  round badge: the tour's icon in a ring of step segments, with a small
//      next button beside it; the card blooms out of the circle
//   D  ticker strip: prev, the stop name (scrolling if long), next; the card
//      unrolls beneath it
// Without the flag nothing here runs. With it, everything is scoped to
// body.mobile.tc in tourchip.css, so the desktop card is unchanged.
import './tourchip.css';
import { el } from './dom.js';

const HOLD_MS = 300;   // press longer than this to peek
const SLOP = 10;       // px of travel that turns a press into a swipe (B) or nothing
const SWIPE = 36;      // px of sideways travel that counts as a swipe

const svg = (inner, cls = '') => el('span', { class: `tc-svg ${cls}`, 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${inner}</svg>` });
const GLYPH = {
  next: '<path d="m9 6 6 6-6 6"/>',
  prev: '<path d="m15 6-6 6 6 6"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11"/>',
  play: '<path d="M8.5 6v12l9.5-6-9.5-6Z"/>',
  min: '<path d="M20 10h-6V4M14 10l6.5-6.5M4 14h6v6M10 14l-6.5 6.5"/>',
};

export function tourChipVariant() {
  const m = /[?&]tourchip=([abcd])\b/i.exec(location.search);
  return m ? m[1].toUpperCase() : null;
}

export class TourChip {
  constructor(tours, variant) {
    this.tours = tours;
    this.v = variant;
    this.state = 'closed'; // closed | peek | pinned
    document.body.classList.add('tc', `tc-${variant}`);
    this._build();
    this._bind();
  }

  _btn(cls, glyph, label, fn) {
    const b = el('button', { class: `tc-btn ${cls}`, title: label, 'aria-label': label }, [svg(GLYPH[glyph])]);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    // a press on a control is not the start of a hold on the chip
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  _build() {
    const T = this.tours, v = this.v;
    this.count = el('span', { class: 'tc-count' });
    this.label = el('span', { class: 'tc-label' });
    this.hold = el('div', { class: 'tc-hold', role: 'button', tabindex: '0', 'aria-expanded': 'false',
      'aria-label': 'Tour narration. Tap to open, press and hold to peek.' });
    const next = this._btn('tc-next', 'next', 'Next stop', () => T.next());
    this.pauseBtn = null;

    if (v === 'A') {
      // the ring doubles as the play/pause button
      this.ring = el('span', { class: 'tc-ring', html: '<svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="15" pathLength="100"/><circle class="val" cx="18" cy="18" r="15" pathLength="100"/></svg>' });
      this.pauseBtn = el('button', { class: 'tc-btn tc-pause', title: 'Pause / resume', 'aria-label': 'Pause / resume' }, [this.ring, svg(GLYPH.pause, 'tc-pp')]);
      this.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); T.togglePause(); });
      this.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.hold.append(this.count);
      this.root = el('div', { class: 'tc-chip glass' }, [this.pauseBtn, this.hold, next]);
    } else if (v === 'B') {
      this.dashes = el('span', { class: 'tc-dashes' });
      this.hold.append(this.label, this.dashes);
      this.root = el('div', { class: 'tc-chip glass' }, [this.hold, next]);
    } else if (v === 'C') {
      this.icon = el('span', { class: 'tc-icon' });
      this.ring = el('span', { class: 'tc-segs' });
      this.hold.append(this.ring, this.icon);
      this.root = el('div', { class: 'tc-chip' }, [this.hold, next]);
    } else {
      this.track = el('span', { class: 'tc-ticker' }, [this.label]);
      this.hold.append(this.count, this.track);
      this.bar = el('i', { class: 'tc-bar' });
      this.root = el('div', { class: 'tc-chip glass' }, [this._btn('tc-prev', 'prev', 'Previous stop', () => T.prev()), this.hold, next, this.bar]);
    }
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
      timer = setTimeout(() => {
        if (!down || down.moved) return;
        down.held = true;
        // a hold on a pinned card leaves it pinned
        if (this.state === 'closed') { this.open('peek'); navigator.vibrate?.(8); }
      }, HOLD_MS);
    });
    h.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > SLOP && !down.held) { down.moved = true; clear(); }
      // B: a sideways swipe on the chip steps the tour
      if (this.v === 'B' && down.moved && !down.swiped && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) {
        down.swiped = true;
        this.root.dataset.swipe = dx < 0 ? 'next' : 'prev';
        if (dx < 0) this.tours.next(); else this.tours.prev();
        setTimeout(() => delete this.root.dataset.swipe, 260);
      }
    });
    const up = (e, cancelled) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down; down = null; clear();
      // judged by the events' own timestamps: on a busy main thread the hold
      // timer can fire before a quick tap's pointerup is handled
      const tap = !cancelled && !d.moved && e.timeStamp - d.t < HOLD_MS;
      if (d.held && !tap) { if (this.state === 'peek') this.close(); return; }
      if (d.held) { this.open('pinned'); return; }
      if (cancelled || d.moved) return;
      // a tap: pin open, or put a pinned card away
      if (this.state === 'closed') this.open('pinned'); else this.close();
    };
    // the tap that opens the card must not also click whatever on the card
    // now sits under the finger (the shrink and end-tour buttons are right there)
    h.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    this.tours.narr.addEventListener('click', (e) => {
      if (performance.now() - this._openedAt < 400) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    h.addEventListener('pointerup', (e) => up(e, false));
    h.addEventListener('pointercancel', (e) => up(e, true));
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (this.state === 'closed') this.open('pinned'); else this.close(); }
    });
    // rotating to a desktop-width layout must not leave the card inert
    window.addEventListener('resize', () => { if (this.tours.active) this._apply(); });
    // a pinned card goes away when the map is touched; the touch still reaches the map
    document.addEventListener('pointerdown', (e) => {
      if (this.state !== 'pinned') return;
      if (this.root.contains(e.target) || this.tours.narr.contains(e.target)) return;
      this.close();
    }, true);
  }

  get on() { return document.body.classList.contains('mobile'); }

  open(state) {
    if (this.state === 'closed') this._openedAt = performance.now();
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

  /** Measure the chip, so the card's collapsed shape is exactly the chip. */
  _measure() {
    const r = this.root.getBoundingClientRect();
    if (!r.width) return;
    const n = this.tours.narr.style;
    n.setProperty('--tc-w', `${Math.round(r.width)}px`);
    n.setProperty('--tc-h', this.v === 'D' ? '0px' : `${Math.round(r.height)}px`);
    if (this.v === 'D') n.setProperty('--tc-top', `${Math.round(r.bottom + 6)}px`);
  }

  /** Called by Tours each time a stop is shown, after the card is rebuilt. */
  update({ tour, i, steps, st }) {
    const n = steps.length;
    this.n = n; this.i = i;
    this.count.textContent = this.v === 'D' ? `${i + 1}/${n}` : `${i + 1} / ${n}`;
    const name = st.title.split(' · ')[0];
    this.label.textContent = this.v === 'B' ? (st.stat ? `${name} · ${st.stat}` : name) : this.v === 'D' ? name : st.title;
    this.hold.setAttribute('aria-label', `${tour.title}, stop ${i + 1} of ${n}: ${st.title}. Tap to open, press and hold to peek.`);
    if (this.dashes) this.dashes.replaceChildren(...steps.map((_, j) => el('i', { class: j < i ? 'done' : j === i ? 'on' : '' })));
    if (this.icon) this.icon.textContent = tour.icon;
    if (this.v === 'C') this._segments();
    this._pp();
    // the card's own way back to the chip, beside its end-tour ✕
    const head = this.tours.narr.querySelector('.narr-head');
    if (head && this.v !== 'D') head.querySelector('.narr-x')?.before(this._btn('tc-min', 'min', 'Shrink to the corner', () => this.close()));
    this.root.classList.remove('hidden');
    this.progress(0);
    requestAnimationFrame(() => {
      this._measure();
      // D: the name scrolls only when it does not fit
      if (this.track) this.track.classList.toggle('scroll', this.label.scrollWidth > this.track.clientWidth + 1);
    });
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
    if (this.n == null) return;
    if (this.v === 'A') this.ring.querySelector('.val').style.strokeDashoffset = String(100 - (100 * (this.i + f)) / this.n);
    else if (this.v === 'C') this.segVal?.setAttribute('stroke-dasharray', `${this.segLen * f} 100`);
    else if (this.v === 'D') this.bar.style.width = `${(100 * (this.i + f)) / this.n}%`;
  }

  /** Reflect pause state on the chip. */
  _pp() {
    this.root.classList.toggle('paused', !!this.tours.paused);
    if (this.pauseBtn) this.pauseBtn.querySelector('.tc-pp').innerHTML = `<svg viewBox="0 0 24 24">${GLYPH[this.tours.paused ? 'play' : 'pause']}</svg>`;
  }

  syncPause() { this._pp(); }

  hide() {
    this.state = 'closed';
    this._apply();
    this.tours.narr.removeAttribute('inert');
    this.root.classList.add('hidden');
  }
}
