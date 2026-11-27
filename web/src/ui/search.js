// Command palette: instant fuzzy search over districts, sites and lenses.
import './panels.css';
import { el, fmt } from './dom.js';
import { KIND_META } from '../scene/sites.js';
import { norm, fuzzyRank } from './panelkit.js';

const KIND_BOOST = { district: 60, city: 70, wonder: 40, lens: 20 };

export class Search {
  constructor(app) {
    this.app = app;
    this.picking = false;
    this.active = 0;
    this.results = [];
    this.items = this._index();
    this.input = el('input', { class: 'srch-input', type: 'text', placeholder: 'Search districts, cities, wonders, dams, peaks, lenses…', spellcheck: 'false', autocomplete: 'off',
      oninput: () => { this.active = 0; this.render(); }, onkeydown: (e) => this._key(e) });
    this.list = el('div', { class: 'srch-list', role: 'listbox' });
    this.root = el('div', { class: 'modal srch glass hidden', role: 'dialog', 'aria-label': 'Search' }, [
      el('div', { class: 'srch-bar' }, [el('span', { class: 'srch-ico', text: '🔎' }), this.input, el('kbd', { class: 'srch-kbd', text: 'Esc' })]),
      this.list,
      el('div', { class: 'srch-foot' }, [el('span', { html: '<kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>Enter</kbd> fly there · <kbd>Esc</kbd> close' }), el('span', { class: 'srch-count' })]),
    ]);
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.close(); });
    app.hud.append(this.root);
  }

  _index() {
    const { app } = this;
    const dname = new Map(app.districts.map((d) => [d.pcode, d.name]));
    const items = app.districts.map((d, i) => ({ type: 'district', i, icon: '▦', label: d.name, sub: `District · ${d.province}`, extra: d.pop != null ? `${fmt.big(d.pop)} people` : '', key: norm(d.name) }));
    for (const s of app.sites?.sites || []) {
      const meta = KIND_META[s.kind] || {};
      let extra = '';
      if (s.kind === 'city' && s.pop) extra = `${fmt.big(s.pop)} people`;
      else if (s.kind === 'power' && s.mw) extra = `${s.fuel || ''} · ${fmt.int(s.mw)} MW`;
      else if (s.kind === 'airport' && s.pax) extra = `${fmt.big(s.pax)} passengers`;
      else if (s.facts?.elevation_m) extra = `${fmt.int(s.facts.elevation_m)} m`;
      items.push({ type: s.kind, site: s, icon: meta.icon || '•', label: s.name, sub: [meta.label || s.kind, dname.get(s.pcode)].filter(Boolean).join(' · '), extra, key: norm(`${s.name} ${s.iata || ''}`) });
    }
    for (const l of app.atlas.lenses || []) items.push({ type: 'lens', lens: l, icon: '🔭', label: `${l.label} lens`, sub: `Lens · ${l.group}`, extra: '', key: norm(`${l.label} lens ${l.group}`) });
    return items;
  }

  open() {
    this.root.classList.remove('hidden');
    this.input.value = '';
    this.active = 0;
    this.render();
    requestAnimationFrame(() => this.input.focus());
  }

  close() { this.root.classList.add('hidden'); this.input.blur(); }

  render() {
    const q = this.input.value.trim();
    if (!q) {
      // default suggestions: biggest cities + headline wonders + a few lenses
      const cities = this.items.filter((x) => x.type === 'city').sort((a, b) => (b.site.pop || 0) - (a.site.pop || 0)).slice(0, 6);
      const wonders = this.items.filter((x) => x.type === 'wonder').slice(0, 4);
      const lenses = this.items.filter((x) => x.type === 'lens').slice(1, 4);
      this.results = [...cities, ...wonders, ...lenses];
    } else {
      this.results = fuzzyRank(this.items, q, 40, (x) => x.key, (x) => KIND_BOOST[x.type] || 0).map((r) => r.item);
    }
    this.active = Math.min(this.active, Math.max(0, this.results.length - 1));
    const rows = this.results.map((r, k) => el('div', {
      class: `srch-row${k === this.active ? ' on' : ''}`, role: 'option', 'data-k': k,
      onpointermove: () => { if (this.active !== k) { this.active = k; this._paintActive(); } },
      onclick: () => this.choose(r),
    }, [
      el('span', { class: 'srch-ri', text: r.icon }),
      el('span', { class: 'srch-rl' }, [el('b', { text: r.label }), el('small', { text: r.sub })]),
      el('span', { class: 'srch-rx', text: r.extra || '' }),
    ]));
    this.list.replaceChildren(...(rows.length ? rows : [el('div', { class: 'srch-empty', text: `Nothing matches “${q}”.` })]));
    this.root.querySelector('.srch-count').textContent = q ? `${this.results.length}${this.results.length === 40 ? '+' : ''} matches` : 'Suggestions';
  }

  _paintActive() {
    this.list.querySelectorAll('.srch-row').forEach((n) => n.classList.toggle('on', +n.dataset.k === this.active));
    this.list.querySelector('.srch-row.on')?.scrollIntoView({ block: 'nearest' });
  }

  _key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active = Math.min(this.results.length - 1, this.active + 1); this._paintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active = Math.max(0, this.active - 1); this._paintActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.results[this.active]; if (r) this.choose(r); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
  }

  choose(r) {
    const { app } = this;
    this.close();
    if (r.type === 'district') { app.select({ district: r.i }); app.flyToDistrict(r.i); }
    else if (r.type === 'lens') app.setLens(r.lens.id);
    else { app.select({ site: r.site }); app.flyToSite(r.site); }
  }

  go() {}
  pickDistrict() {}
}
