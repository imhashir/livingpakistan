// Almanac: every public source behind living pakistan, with vintage, licence, caveats and file provenance.
import './panels.css';
import { el } from './dom.js';
import { panel, norm, fmtNum } from './panelkit.js';

const REPO = 'https://github.com/imhashir/livingpakistan';

export class Almanac {
  constructor(app) {
    this.app = app;
    this.picking = false;
    this.sources = app.data.sources?.sources || [];
    const p = panel(app, { cls: 'alm', title: '📜 Almanac', sub: `${this.sources.length} public sources` });
    this.root = p.root;
    this.filter = el('input', { class: 'pc-input', type: 'search', placeholder: 'Filter sources — title, publisher, use, caveat…', oninput: () => this.applyFilter() });
    this.count = el('span', { class: 'alm-count' });
    this.list = el('div', { class: 'alm-list' });
    p.body.append(
      el('p', { class: 'alm-blurb' }, [
        'Every number in living pakistan traces back to one of these public sources. Modelled values (Economy) are labelled as models. ',
        el('a', { href: REPO, target: '_blank', rel: 'noopener', text: 'Code & pipeline on GitHub ↗' }),
      ]),
      el('div', { class: 'alm-tools' }, [this.filter, this.count]),
      this.list,
    );
    this.cards = this.sources.map((s) => ({ s, node: this._card(s), key: norm([s.id, s.title, s.publisher, s.vintage, s.license, ...(s.used_for || []), s.caveats].join(' ')) }));
    this.list.append(...this.cards.map((c) => c.node));
    this.applyFilter();
  }

  _card(s) {
    const files = s.files || [];
    const row = (k, v) => (v ? el('div', { class: 'alm-row' }, [el('span', { text: k }), el('div', { text: v })]) : '');
    return el('article', { class: 'alm-card', id: `alm-${s.id}` }, [
      el('header', {}, [
        el('h3', {}, [s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title }) : s.title]),
        el('code', { class: 'alm-id', text: s.id }),
      ]),
      row('Publisher', s.publisher),
      row('Vintage', s.vintage),
      row('Licence', s.license),
      s.used_for?.length ? el('div', { class: 'alm-row' }, [el('span', { text: 'Used for' }), el('div', { class: 'alm-tags' }, s.used_for.map((u) => el('em', { text: u })))]) : '',
      s.caveats ? el('div', { class: 'alm-caveat' }, [el('b', { text: '⚠ Caveats ' }), s.caveats]) : '',
      files.length ? el('details', { class: 'alm-files' }, [
        el('summary', { text: `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtNum.bytes(files.reduce((a, f) => a + (f.bytes || 0), 0))}` }),
        el('table', {}, [
          el('thead', {}, [el('tr', {}, ['File', 'Size', 'SHA-256', 'Retrieved'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, files.map((f) => el('tr', {}, [
            el('td', {}, [f.url ? el('a', { href: f.url, target: '_blank', rel: 'noopener', text: f.name || f.url, title: f.url }) : (f.name || '—')]),
            el('td', { text: fmtNum.bytes(f.bytes) }),
            el('td', {}, [f.sha256 ? el('code', { title: f.sha256, text: f.sha256.slice(0, 12) + '…' }) : '—']),
            el('td', { text: f.retrieved || '—' }),
          ]))),
        ]),
      ]) : '',
    ]);
  }

  applyFilter() {
    const q = norm(this.filter.value);
    const terms = q ? q.split(' ') : [];
    let n = 0;
    for (const c of this.cards) {
      const on = terms.every((t) => c.key.includes(t));
      c.node.classList.toggle('hidden', !on); n += on;
    }
    this.count.textContent = terms.length ? `${n} of ${this.cards.length}` : `${this.cards.length} sources`;
  }

  open(sourceId) {
    this.root.classList.remove('hidden');
    if (typeof sourceId !== 'string') return;
    const c = this.cards.find((x) => x.s.id === sourceId);
    if (!c) return;
    if (c.node.classList.contains('hidden')) { this.filter.value = ''; this.applyFilter(); }
    requestAnimationFrame(() => {
      c.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      c.node.classList.remove('flash'); void c.node.offsetWidth; c.node.classList.add('flash');
    });
  }

  go() {}
  pickDistrict() {}
}
