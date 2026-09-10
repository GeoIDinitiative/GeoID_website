/**
 * THE TRACKS, READ TWO WAYS — and both are repaints of the one loaded layer.
 *
 * "By category" colours every storm on the Saffir-Simpson band its peak
 * reached. "Reached hurricane force" keeps those colours for the storms that
 * got to 64 knots and stands the rest down, so what is left is the population
 * a hurricane map is about.
 *
 * WHAT THIS IS NOT, said plainly because the difference is measurable: it is
 * not the STRETCHES at hurricane force. A Category 5 in the mid-Atlantic was a
 * depression when it left Africa — only 47% of Katrina's track and 13% of
 * Sandy's was actually at that strength — so highlighting whole storms
 * over-draws against a map counting hurricane-force passage. The stretches are
 * a separate baked file (`cyclone-tracks-hurricane.geojson`, 3,700 runs), and
 * loading a different file is not a symbology: it drops the layer, rebuilds it
 * and paints it a beat later, which is the staged repaint this control exists
 * to avoid. The option here is named for what it does.
 */

import {
  buildSymbology, colourOf, legendInfoFrom,
} from "./symbology.js?v=20260910-0014814";
import { SAFFIR_SIMPSON_KTS } from "./event-sources.js?v=20260910-0014814";

const FIELD = "peak_wind_kts";
const HURRICANE_KTS = SAFFIR_SIMPSON_KTS[0];

/** What an unhighlighted storm is drawn in -- the app's own no-value grey. */
const STOOD_DOWN = "8a8a8a";

const LABELS = ["Tropical storm or weaker", "Category 1", "Category 2",
  "Category 3", "Category 4", "Category 5"];

/**
 * `Number(null)` IS ZERO, and this file is 54% nulls.
 *
 * 7,267 of the 13,513 tracks carry no measured peak wind, and read with a bare
 * `Number()` every one of them becomes 0 — finite, so it passes an isFinite
 * guard and lands in the BOTTOM CLASS. Measured before this: every unmeasured
 * storm drawn as "tropical storm or weaker", which states a strength for a
 * storm nobody measured, over half the map. `paintByRange` has guarded exactly
 * this for as long as it has existed; this is the same guard rather than a
 * second opinion about it.
 */
function windOf(feature) {
  const raw = feature?.properties?.[FIELD];
  if (raw == null || String(raw).trim() === "") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function tracksLayer(layers) {
  return window.GeoIDGlobalData?.layerForDataset?.("cyclone-tracks")
    || (layers || window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => l.name && /cyclone tracks/i.test(l.name)) || null;
}

export function currentView(layers) {
  return tracksLayer(layers)?.trackView || "category";
}

/**
 * The paint for one view, pure so the classes and the counts can be checked
 * without a globe.
 *
 * Classed on the SCALE rather than on this file's quantiles — the same edges
 * the live markers and the risk map use, so a Category 3 is one colour
 * everywhere in the app.
 */
export function trackPaint(features, view = "category") {
  // Classed on the storms that HAVE a peak. Nulls read as zero would drag the
  // scale's own floor down to nothing and count 7,267 phantom calms.
  const values = features.map(windOf).filter((n) => Number.isFinite(n));
  const sym = buildSymbology(values, { edges: SAFFIR_SIMPSON_KTS, ramp: "risk" });
  if (!sym.ok) return null;
  sym.rows.forEach((row, i) => { if (LABELS[i]) row.label = LABELS[i]; });
  const onlyHurricanes = view === "hurricane";
  const legend = legendInfoFrom(sym, {
    label: onlyHurricanes
      ? "Storms that reached hurricane force (Saffir–Simpson)"
      : "Strongest the storm got (Saffir–Simpson)",
  });
  /**
   * THE GREY IS TWO DIFFERENT THINGS, and the row has to say so.
   *
   * Measured on this file: 13,513 tracks, of which only 6,246 carry a peak
   * wind at all. So **54% of the layer has never been measured** — most of it
   * the early record, kept where ships and coasts were — and it is drawn in
   * the no-value grey on EVERY view, including the default one.
   *
   * On the hurricane view that grey also holds the 3,316 storms that were
   * measured and stayed below 64 knots. Calling the row "never reached
   * hurricane force" would state that of 7,267 storms nobody ever measured,
   * which is the one thing this colour must not be read as. So the row names
   * both, and on the default view it names the only one that applies.
   */
  const unmeasured = features.filter((f) => !Number.isFinite(windOf(f))).length;
  if (onlyHurricanes) {
    const stood = features.filter((f) => {
      const n = windOf(f);
      return !(Number.isFinite(n) && n >= HURRICANE_KTS);
    }).length;
    // The first band IS "tropical storm or weaker", and on this view nothing
    // is drawn in it -- every storm it would hold has been stood down.
    legend.palette = [STOOD_DOWN, ...legend.palette.slice(1)];
    legend.labels = ["Below hurricane force, or never measured",
      ...legend.labels.slice(1)];
    legend.counts = [stood, ...legend.counts.slice(1)];
    legend.bounds = [["0", String(HURRICANE_KTS)], ...legend.bounds.slice(1)];
  } else if (unmeasured) {
    // The default view had no row for it at all: half the lines in a colour
    // the key did not mention, which is the legend saying nothing about the
    // largest thing on the map.
    legend.palette = [STOOD_DOWN, ...legend.palette];
    legend.labels = ["Peak never measured", ...legend.labels];
    legend.counts = [unmeasured, ...legend.counts];
    legend.bounds = [["", ""], ...legend.bounds];
  }
  return {
    sym,
    colourFor: (feature) => {
      const n = windOf(feature);
      // A storm nobody measured is not a weak storm. It keeps no colour, and
      // the key carries a row saying which of the two the grey is.
      if (!Number.isFinite(n)) return null;
      if (onlyHurricanes && n < HURRICANE_KTS) return `#${STOOD_DOWN}`;
      return colourOf(n, sym);
    },
    legend: { ...legend, field: FIELD, categorical: false },
  };
}

/** Repaint the loaded layer. Instant: the features never move. */
export function show(view = "category", { layers = null } = {}) {
  const layer = tracksLayer(layers);
  if (!layer?.features?.length) return null;
  const paint = trackPaint(layer.features, view);
  if (!paint) return null;
  layer.repaint?.(paint.colourFor);
  layer.legendInfo = paint.legend;
  layer.trackView = view;
  window.GeoIDLayerHierarchy?.render?.();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed",
    { detail: { reason: "symbology" } }));
  return { view, features: layer.features.length };
}

if (typeof window !== "undefined") {
  window.GeoIDCycloneTracks = { show, currentView, trackPaint, tracksLayer };
}
