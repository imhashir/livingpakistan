// Google Analytics 4 instrumentation.
//
// Every tracking call in the app lives in this file. The app's own modules are
// left clean: instrument() wraps their public methods, so analytics is additive
// and can be removed by deleting this file and its one import in main.js.
//
// Event names are a fixed, small set (GA4 caps a property at 500 distinct
// names). Anything high-cardinality — district names, site names, lens ids —
// is a *parameter*, never part of the name.

const DEBUG = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

function gtag(...args) {
  if (typeof window.gtag === 'function') window.gtag(...args);
}

let app = null;

// The app drives its own public API during the opening fly-in, guided
// walkthrough, story tours and "surprise me" — one tour can fire dozens of
// setLayer/setMood calls. Those are the app moving, not a person clicking, so
// the events they*cause* are suppressed while `programmatic` is raised. The
// deliberate events (tour_start, guide_step…) are reported either way.
let programmatic = 0;
const CAUSED_BY_APP = new Set([
  'lens_change', 'mood_change', 'layer_toggle', 'relief_change',
  'select_district', 'select_site', 'select_cell', 'home_view', 'treaty_view',
]);

/** Run fn with derived events suppressed, for sync and async fns alike. */
function selfDriven(fn) {
  programmatic++;
  let done = false;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      done = true;
      return r.finally(() => { programmatic--; });
    }
    return r;
  } finally {
    if (!done) programmatic--;
  }
}

/** Send one event. Never throws, never blocks the UI. */
export function track(name, params = {}) {
  // Screenshot and video runs drive the whole app through its public API;
  // those are robots, not users, and must not land in the reports.
  if (app?.stage?.capture) return;
  if (programmatic > 0 && CAUSED_BY_APP.has(name)) return;
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 100) : v;
  }
  if (DEBUG) clean.debug_mode = true;
  gtag('event', name, clean);
}

/**
 * Replace obj[method] with a version that reports first, then does the work.
 * With silences=true the original call also runs as self-driven, so the
 * setLens/setLayer/… it triggers internally are not counted as user actions.
 */
function wrap(obj, method, report, silences = false) {
  if (!obj || typeof obj[method] !== 'function') return;
  const original = obj[method].bind(obj);
  obj[method] = (...args) => {
    try { report(...args); } catch { /* analytics must never break a feature */ }
    // returns the original's promise for async methods, so awaits still work
    return silences ? selfDriven(() => original(...args)) : original(...args);
  };
}

/** Collapse rapid repeats (a dragged slider) into one event. */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function instrument(instance) {
  app = instance;
  const A = instance;
  const lens = (id) => A.atlas?.lenses?.find((l) => l.id === id) || {};
  const district = (i) => A.districts?.[i] || {};

  // The opening fly-in moves the camera and switches mood on a timer. It is
  // running right now, so hold derived events until it has finished.
  if (document.querySelector('.intro')) {
    programmatic++;
    setTimeout(() => { programmatic--; }, 7000);
  }

  // ---- map controls ------------------------------------------------------
  wrap(A, 'setLens', (id) => {
    const l = lens(id);
    track('lens_change', { lens_id: id, lens_label: l.label, lens_group: l.group });
  });
  wrap(A, 'setMood', (mood) => track('mood_change', { mood }));
  wrap(A, 'setLayer', (key, on) => track('layer_toggle', { layer_key: key, enabled: !!on }));
  wrap(A, 'setRelief', debounce((v) => track('relief_change', { relief: Number(v) }), 700));
  wrap(A, 'home', () => track('home_view'));

  // ---- selection ---------------------------------------------------------
  wrap(A, 'select', (sel) => {
    if (!sel) return; // deselect is noise
    if (sel.district != null) {
      const d = district(sel.district);
      track('select_district', { district: d.name, province: d.province });
    } else if (sel.site) {
      track('select_site', { site_kind: sel.site.kind, site_name: sel.site.name });
    } else if (sel.cell != null) {
      track('select_cell', { cell: sel.cell });
    }
  });

  // ---- feature panels ----------------------------------------------------
  // `silences` is set where opening the feature also moves the map itself.
  const panel = (obj, method, feature, { extra = () => ({}), silences = false } = {}) =>
    wrap(obj, method, (...a) => track('feature_open', { feature, ...extra(...a) }), silences);

  panel(A.explorer, 'open', 'district_explorer');
  panel(A.duel, 'open', 'district_duel');
  panel(A.search, 'open', 'search');
  panel(A.surprise, 'go', 'surprise_me', { silences: true });
  panel(A.eras, 'show', 'eras', { silences: true });
  panel(A.tours, 'openMenu', 'tour_menu');
  panel(A.ui?.almanac, 'open', 'almanac', { extra: (id) => ({ source_id: id }) });
  panel(A.guide, 'openWelcome', 'welcome');

  // ---- feature depth: what people actually do once a panel is open -------
  wrap(A.duel, 'set', (a, b) => track('duel_compare', {
    district_a: district(a).name, district_b: district(b).name,
  }));
  wrap(A.search, 'choose', (r) => track('search_result_open', {
    result_kind: r?.kind, result_name: r?.name,
  }));
  wrap(A.eras, 'setEra', (k) => track('era_change', {
    era_index: k, era_name: A.eras?.eras?.[k]?.name,
  }), true);
  wrap(A.flood, 'toggle', () => track('flood_playback', {
    // reports the state being entered, not the one being left
    playing: !A.flood.playing,
  }));
  wrap(A.lines, 'setTreatyView', (on) => track('treaty_view', { enabled: !!on }));

  // ---- guided walkthrough and tours: the funnels worth measuring ---------
  // Each of these replays scripted camera and lens moves, so they silence the
  // events they cause while still reporting the step the person reached.
  wrap(A.guide, 'start', () => track('guide_start', { steps: A.guide?.steps?.length }), true);
  wrap(A.guide, 'go', (k) => {
    const total = A.guide?.steps?.length || 0;
    track('guide_step', { step_index: k, step_title: A.guide?.steps?.[k]?.title, steps: total });
    if (total && k >= total - 1) track('guide_complete', { steps: total });
  }, true);
  wrap(A.tours, 'run', (k) => track('tour_start', { tour_name: A.tours?.tours?.[k]?.title }), true);
  wrap(A.tours, 'show', (i) => {
    const t = A.tours?.active;
    if (t && i >= (t.steps?.length ?? 0) - 1) track('tour_complete', { tour_name: t.title });
  }, true);
}
