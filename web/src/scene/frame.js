// Tells the stage the picture is stale. Scene modules call this after changing anything that is
// drawn (colours, visibility, geometry, lighting), so the stage can sit idle the rest of the time.
let stage = null;

export function bindStage(s) { stage = s; }

/** `{ shadows: true }` (the default) also re-renders the sun's shadow map; camera-only changes don't need it. */
export function requestRender(opts) { stage?.invalidate(opts); }

/** Only the DOM labels need re-placing (a declutter pass changed which are shown). Wakes a resting loop. */
export function requestLabels() { stage?.invalidateLabels(); }
