/**
 * The live thread between what the user DRAWS and what the pipeline KNOWS.
 *
 * The bridge could always record a study area into the open project — but
 * only when a Research Hub button asked it to, so the project's
 * `study_area` lagged whatever was actually on the globe. This module
 * makes the sync automatic: every time the drawn area changes — a box
 * dragged out, a corner resized, a preset placed, a weather-card box —
 * the viewer announces `geoid-study-area-edited`, and this listener
 * writes the project's study_area bounds and `metadata/study_area.geojson`
 * a debounce later.
 *
 * Silent by design when it cannot act: no open project is the ordinary
 * state on a fresh page, and a sync layer that nags is a sync layer that
 * gets turned off. Antimeridian-crossing areas are the one loud case the
 * bridge itself refuses (min/max longitude cannot describe them), and its
 * error stays quiet here too — the drawn area itself is unaffected.
 */

let timer = 0;

async function syncStudyArea() {
  const drawn = window.GeoIDViewer?.getExtractionGeometry?.();
  if (!drawn?.vertices?.length) return;
  try {
    const bridge = await import(`./research/bridge.js${new URL(import.meta.url).search}`);
    if (!bridge.isArmed?.()) return;
    await bridge.captureStudyArea();
  } catch (error) {
    /* no project open, or a wrap-around area the bridge refuses — quiet */
  }
}

function scheduleSync() {
  window.clearTimeout(timer);
  // A drag rebuilds many times a second; the project wants the settled
  // shape, not every frame of the gesture.
  timer = window.setTimeout(syncStudyArea, 900);
}

if (typeof document !== "undefined") {
  document.addEventListener("geoid-study-area-edited", scheduleSync);
}

export { syncStudyArea };
