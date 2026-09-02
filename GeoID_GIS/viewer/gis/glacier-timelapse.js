/**
 * GLACIER TIME-LAPSE — the archive's own dates, stepped through.
 *
 * A change map answers "how much" in one number. A reader looking at a
 * retreating tongue wants to SEE it, and the archive has what that needs: not
 * two outlines but every outline anybody submitted, each with the date of the
 * image it was drawn from. This plays them in order, with imagery from the
 * same date underneath, so the outline and the ground move together.
 *
 * WHAT IS HERE, AND WHAT IS NOT. The bar, the slider, the play loop, the scene
 * cache and the GEE→GIBS→none fallback are `timelapse-player.js`, shared with
 * the imagery animator — there is one player over this globe and two drivers
 * for it. What is this file's own is the half that is about ICE: which dates
 * the archive holds, what the ice looked like on each of them, and which
 * satellite was overhead in that year.
 *
 * `glims-outlines` fetches the outlines (`all: true`, which keeps the older
 * ones the change layer deliberately drops) and `renderFeatureCollection`
 * builds each frame's geometry once.
 *
 * EVERY SCENE IS A REQUEST, and Earth Engine's are billed, so nothing is
 * fetched until the timeline reaches it, everything is cached, and the panel
 * says how many frames it is about to step through before it starts.
 */

const search = new URL(import.meta.url).search;

import { startPlayer, stopPlayer, datasetForYear, seasonFor, IMAGERY_SOURCES }
  from "./timelapse-player.js?v=20260902-84811cf";

// Re-exported rather than re-implemented: the panel, the tests and this file
// must be talking about the SAME rule for which satellite covers which year.
export { datasetForYear, seasonFor, IMAGERY_SOURCES };

/**
 * The dates worth stepping through.
 *
 * One epoch per distinct date the archive holds here. Where there are more
 * than the bar can be scrubbed through usefully, the fullest dates win — an
 * epoch holding three outlines of a valley is a frame nobody can read, and
 * dropping it is better than a slider with two hundred stops. What was dropped
 * is RETURNED rather than swallowed, so the panel can say so.
 */
export function epochsFrom(features, { max = 24 } = {}) {
  const byDate = new Map();
  for (const feature of features || []) {
    const date = String(feature?.properties?.outline_date
      || feature?.properties?.src_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(feature);
  }
  const all = [...byDate.entries()].map(([date, list]) => ({ date, features: list }));
  all.sort((a, b) => b.features.length - a.features.length);
  const kept = all.slice(0, max).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { epochs: kept, dropped: Math.max(0, all.length - kept.length) };
}

/**
 * THE STATE OF THE ICE AS OF EACH DATE, not the outlines filed on it.
 *
 * The archive is a record of SUBMISSIONS, and they are wildly uneven: measured
 * over one Valais box, 410 outlines were filed on 2003-08-13 and 8 on
 * 2018-09-01. Drawing each date's own filings made whole glaciers appear and
 * vanish between frames — reported as the fills jumping around, and they were.
 *
 * A frame should say what the ice WAS on that date: for every glacier, the most
 * recent outline up to and including it. A glacier nobody remapped simply keeps
 * the outline it had, which is exactly what a reader means by "then", and what
 * moves between frames is only the ice that was actually remapped.
 *
 * Nothing is invented: every polygon drawn is a real outline with a real date,
 * and the card still names the date THAT outline was taken from.
 */
export function stateAsOf(features, epochs) {
  const held = new Map();
  const byDate = new Map();
  for (const feature of features || []) {
    const date = String(feature?.properties?.outline_date
      || feature?.properties?.src_date || "").slice(0, 10);
    const id = feature?.properties?.glac_id;
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ id, feature });
  }
  const dates = [...byDate.keys()].sort();
  let next = 0;
  return epochs.map((epoch) => {
    // Everything filed at or before this epoch has already been folded in, so
    // each step only applies what is NEW — the cursor never walks back, and
    // the sequence is built once, in order, rather than re-scanned per frame.
    const fresh = new Set();
    while (next < dates.length && dates[next] <= epoch.date) {
      for (const { id, feature } of byDate.get(dates[next])) {
        held.set(id, feature);
        if (dates[next] === epoch.date) fresh.add(id);
      }
      next += 1;
    }
    return { features: [...held.values()], fresh };
  });
}

/**
 * WHAT THE COLOUR MEANS, AND IN WHAT UNIT.
 *
 * The first version painted an outline one of two colours — bright if it was
 * remapped on this date, pale if it was carried forward — and reported that as
 * a legend nobody could read, correctly: two hues with no scale and no unit
 * say only "these are different", which the dates in the bar already said.
 *
 * Both measures below are computed from the outlines themselves, at build
 * time, and both are stated in the legend with their unit:
 *
 * - **AGE** — how old the outline being drawn is, in years, at this frame's
 *   date. It is defined for every polygon in every frame, which is why it is
 *   the default, and it is the honest reading of a carried-forward map: where
 *   the colour darkens, the archive has not looked recently and the ice may
 *   have moved without the map moving.
 * - **CHANGE** — how much area a glacier has gained or lost since its FIRST
 *   outline in this fetch, as a percentage. This is the subject itself, and it
 *   is only defined where the archive holds a glacier more than once; the rest
 *   are drawn in this app's own no-value grey with a row of their own, never
 *   filled in from a neighbour.
 *
 * A rebuild is what changes it — the colours are baked into each frame's
 * vertices — so it is chosen before the sequence is built rather than being a
 * control on the bar that would silently re-triangulate 24 frames.
 */
const NO_VALUE = "#8a8a8a";
const GHOST_COLOUR = "#4d7f96";

const AGE_CLASSES = [
  { max: 0.5, colour: "#ffffff", label: "Surveyed on this date" },
  { max: 5, colour: "#cfe8f7", label: "Up to 5 years old" },
  { max: 10, colour: "#8fd3f4", label: "5 to 10 years old" },
  { max: 20, colour: "#4f9fd0", label: "10 to 20 years old" },
  { max: 40, colour: "#2f6ba3", label: "20 to 40 years old" },
  { max: Infinity, colour: "#1b3f6b", label: "Over 40 years old" },
];

/**
 * DIVERGING, because zero means something here. A sequential ramp would put
 * "lost a fifth of itself" and "gained a fifth" at two ends of one scale with
 * no mark where the ice held its ground. Loss reads warm and gain cool, which
 * is the convention every published glacier-change map uses.
 */
const CHANGE_CLASSES = [
  { max: -50, colour: "#b2182b", label: "Lost over 50% of its area" },
  { max: -20, colour: "#ef8a62", label: "Lost 20 to 50%" },
  { max: -5, colour: "#fddbc7", label: "Lost 5 to 20%" },
  { max: 5, colour: "#f7f7f7", label: "Within 5% of its first outline" },
  { max: 20, colour: "#9ecae1", label: "Gained 5 to 20%" },
  { max: Infinity, colour: "#2166ac", label: "Gained over 20%" },
];

const YEAR = 365.2425 * 86400000;

/** The colour a class list gives a number, or the no-value grey for null. */
function classColour(classes, value) {
  if (!Number.isFinite(value)) return NO_VALUE;
  for (const band of classes) if (value <= band.max) return band.colour;
  return classes[classes.length - 1].colour;
}

/** The date an outline was surveyed, however the archive spelt it. */
export function outlineDate(feature) {
  const date = String(feature?.properties?.outline_date
    || feature?.properties?.src_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Its mapped area in km2, from the archive's own column. */
function outlineArea(feature) {
  const area = Number(feature?.properties?.area_km2 ?? feature?.properties?.db_area);
  return Number.isFinite(area) && area > 0 ? area : null;
}

/**
 * Each glacier's FIRST mapped area in this fetch, which is what a change is
 * measured against. First by DATE, never by arrival order: the archive returns
 * submissions in whatever order the server holds them.
 */
export function firstAreas(features) {
  const first = new Map();
  for (const feature of features || []) {
    const id = feature?.properties?.glac_id;
    const date = outlineDate(feature);
    const area = outlineArea(feature);
    if (!id || !date || area === null) continue;
    const held = first.get(id);
    if (!held) first.set(id, { date, area, outlines: 1 });
    else {
      held.outlines += 1;
      if (date < held.date) { held.date = date; held.area = area; }
    }
  }
  return first;
}

/**
 * The colouring for one frame: a pure function of the feature, plus the legend
 * that explains it. `kind` is "age", "change" or "flat".
 */
export function colouringFor(kind, { date, firstArea = new Map() } = {}) {
  if (kind === "change") {
    return {
      colourFor: (feature) => {
        const id = feature?.properties?.glac_id;
        const now = outlineArea(feature);
        const held = firstArea.get(id);
        /**
         * A GLACIER MAPPED ONCE HAS NO CHANGE, and it is its own baseline —
         * so measuring it against itself would paint it "within 5% of its
         * first outline", which says the ice held its ground where nothing
         * was measured at all. The archive has to hold it twice.
         */
        if (!id || now === null || !held || held.outlines < 2
          || !Number.isFinite(held.area) || held.area <= 0) return NO_VALUE;
        return classColour(CHANGE_CLASSES, ((now - held.area) / held.area) * 100);
      },
      legend: legendOf(CHANGE_CLASSES,
        [[NO_VALUE, "Mapped once — no change to show"]]),
      measure: "area change since first mapped (%)",
    };
  }
  if (kind === "flat") {
    return {
      colourFor: () => "#8fd3f4",
      legend: legendOf([{ colour: "#8fd3f4", label: "Glacier, as last mapped" }]),
      measure: null,
    };
  }
  const at = Date.parse(`${date}T00:00:00Z`);
  return {
    colourFor: (feature) => {
      const own = outlineDate(feature);
      if (!own || !Number.isFinite(at)) return NO_VALUE;
      return classColour(AGE_CLASSES, (at - Date.parse(`${own}T00:00:00Z`)) / YEAR);
    },
    legend: legendOf(AGE_CLASSES),
    measure: "outline age (years)",
  };
}

/**
 * The legend in the dock's own classed shape — and the GHOST gets a row of its
 * own, because it is drawn in every frame and a thin outline nothing explains
 * reads as a fault in the map.
 *
 * `categorical: true` with the unit written into each label, rather than the
 * dock's `unit` suffix: these lists mix a measured band ("Lost 20 to 50%")
 * with a stated absence ("Mapped once"), and a suffix appended to both would
 * put a percent sign after the absence.
 */
function legendOf(classes, extra = []) {
  const rows = [...classes.map((c) => [c.colour, c.label]), ...extra,
    [GHOST_COLOUR, "Not yet mapped at this date (outline only)"]];
  return {
    palette: rows.map(([colour]) => String(colour).replace("#", "")),
    labels: rows.map(([, label]) => label),
    values: rows.map(([, label]) => label),
    categorical: true,
    classed: true,
    field: "outline",
    shown: rows.length,
    total: rows.length,
  };
}

/**
 * What the bar says under the date: what is DRAWN, and what changed to make
 * this frame — because "620 glaciers" and "8 remapped on this date" are two
 * different facts and the second is the one that explains the first.
 */
function frameNote(epoch, tail) {
  const shown = epoch.shown ?? epoch.features.length;
  return `${shown.toLocaleString()} glaciers · `
    + `${epoch.features.length} remapped on this date · ${tail}`;
}

/** Take the whole thing off the globe. */
export function stopTimelapse() {
  stopPlayer();
}

/**
 * Build the sequence for one box and one window of time.
 *
 * Returns what it found so the panel can say it — including what it had to
 * drop, because a slider that quietly holds a quarter of the dates is the
 * same silent cap this file's neighbours keep paying for.
 */
export async function startTimelapse({ bounds, from = null, to = null,
  source = "auto", colourBy = "age", outlines = true, onStatus = () => {} }) {
  stopTimelapse();
  const [{ runConnector }, render] = await Promise.all([
    import(`./research/connectors.js${search}`),
    import(`./vector-render.js${search}`),
  ]);
  onStatus("Reading every outline the archive holds here…");
  const result = await runConnector("glims-outlines", {
    bbox: {
      minLon: bounds.west, minLat: bounds.south,
      maxLon: bounds.east, maxLat: bounds.north,
    },
    from, to, all: true, limit: 8000,
  });
  const { epochs, dropped } = epochsFrom(result.geojson.features);
  if (epochs.length < 2) {
    onStatus("Fewer than two dates here — nothing to play. Try a wider area or window.");
    return { epochs: 0 };
  }

  /**
   * WHICH SATELLITE, AND OVER WHICH WEEKS — this driver's own decision, and
   * the reason the player takes a window rather than working one out. A
   * glacier frame composites that year's MELT SEASON, hemisphere-aware,
   * because one satellite over one glacier in six weeks is mostly cloud.
   */
  const middle = (bounds.north + bounds.south) / 2;
  for (const epoch of epochs) {
    const season = seasonFor(epoch.date, middle);
    epoch.dataset = datasetForYear(epoch.date.slice(0, 4));
    epoch.from = season?.from || epoch.date;
    epoch.to = season?.to || epoch.date;
  }

  const THREE = await import("../vendor/three.module.js");
  const group = new THREE.Group();
  group.name = "Glacier time-lapse";
  /**
   * A GHOST OF EVERY GLACIER, under the sequence and never hidden.
   *
   * It marks where the ice is in the whole window, so a reader can see what
   * the earliest frames do not yet hold. It is outline-only and therefore
   * holds no FILL, which is why it could never have answered the frames
   * jumping — that is what `stateAsOf` is for.
   */
  const seen = new Set();
  const ghostFeatures = [];
  for (const feature of result.geojson.features) {
    const id = feature?.properties?.glac_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ghostFeatures.push(feature);
  }
  const ghost = render.renderFeatureCollection(
    { type: "FeatureCollection", features: ghostFeatures },
    { colourFor: () => GHOST_COLOUR, outlineOnly: true },
  );
  const ghostNode = ghost?.object3D || ghost;
  group.add(ghostNode);

  /**
   * Each frame is the ice as it stood, so a glacier nobody remapped keeps its
   * last outline instead of blinking out. Built once, in order; a step is then
   * a visibility flip rather than a rebuild.
   */
  const frames = stateAsOf(result.geojson.features, epochs);
  epochs.forEach((epoch, i) => { epoch.shown = frames[i].features.length; });
  /**
   * ONE SCALE ACROSS EVERY FRAME. The classes are fixed for the whole
   * sequence, so a colour means the same thing in frame 1 and frame 24 — a
   * legend recomputed per frame would make the map about the frame rather
   * than about the ice.
   */
  const firstArea = firstAreas(result.geojson.features);
  const colouring = colouringFor(colourBy, { date: epochs[0].date, firstArea });
  const groups = epochs.map((epoch, i) => {
    const { features } = frames[i];
    const paint = colouringFor(colourBy, { date: epoch.date, firstArea });
    const built = render.renderFeatureCollection(
      { type: "FeatureCollection", features },
      { colourFor: paint.colourFor, outlineOnly: false },
    );
    const node = built?.object3D || built;
    node.visible = false;
    group.add(node);
    return node;
  });

  /**
   * The layer is NAMED for what its colour measures, because the legend card's
   * heading is the layer's name and a key of six blues over "Glacier
   * time-lapse" leaves the unit nowhere to be said.
   */
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(
    colouring.measure ? `Glacier time-lapse — ${colouring.measure}` : "Glacier time-lapse", {
      object3D: group,
      georeferenced: true,
      bounds: { minX: bounds.west, maxX: bounds.east, minY: bounds.south, maxY: bounds.north },
      features: frames[0].features,
      collection: { type: "FeatureCollection", features: frames[0].features },
      legendInfo: colouring.legend,
    }, "glims");

  const layerNow = () => (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.id === layer?.id);

  /**
   * The outlines are BUILT either way and hidden if they were not asked for.
   * Building is the slow half and it costs the same fetch, so hiding rather
   * than skipping is what makes the tick box, the bar's toggle and the eye
   * instant — a toggle that had to re-triangulate 24 frames would not be one.
   * Somebody who wants no outlines at all wants Basemaps · Imagery over time,
   * which draws no polygons by construction.
   */
  if (!outlines && layer) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);

  await startPlayer({
    bounds, epochs, source, frames: groups, noteFor: frameNote, onStatus,
    /**
     * THE FEATURE LIST FOLLOWS THE FRAME. `featuresAt` — the click picker —
     * walks `layer.features`, so a list left on the whole fetch answers with
     * whichever of a glacier's outlines came first in the array: an 1850 one
     * under a 2016 frame, with a card that is right about the archive and
     * wrong about what is on screen.
     */
    onShow: (index) => {
      const held = layerNow();
      if (!held) return;
      held.features = frames[index].features;
      held.collection = { type: "FeatureCollection", features: frames[index].features };
    },
    /**
     * ONE STATE, SEEN TWICE. The bar's toggle drives the layer through the
     * hierarchy's own `setVisible`, so the eye in Workspace shows it and moves
     * it — never a second switch for one thing.
     */
    overlayToggle: {
      isOn: () => layerNow()?.visible !== false,
      setOn: (on) => {
        const held = layerNow();
        if (held) window.GeoIDLayerHierarchy?.setVisible?.(held, on);
      },
    },
    // The player owns the bar and the scenes; the outlines are this driver's,
    // so closing the bar has to take them with it.
    onStop: () => {
      const held = layerNow();
      if (held) window.GeoIDImportManager?.removeLayer?.(held.id);
    },
  });
  onStatus(`${epochs.length} dates from ${epochs[0].date} to ${epochs[epochs.length - 1].date}`
    + `, ${result.geojson.features.length.toLocaleString()} outlines`
    + (dropped ? `, ${dropped} sparser dates left out` : "")
    + ". Press play, or drag the bar.");
  return { epochs: epochs.length, dropped };
}

if (typeof window !== "undefined") {
  window.GeoIDGlacierTimelapse = { startTimelapse, stopTimelapse, datasetForYear, epochsFrom };
}
