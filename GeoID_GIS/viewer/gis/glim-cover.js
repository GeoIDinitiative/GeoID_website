/**
 * GLiM — what rock is actually at the surface.
 *
 * The third global polygon map on this globe, and the three answer different
 * questions rather than competing:
 *
 *   Macrostrat   the BEDROCK — the formation, named and dated
 *   FAO DSMW     the SOIL that formed on it
 *   GLiM         the ROCK AT THE SURFACE — what is exposed, by lithology
 *
 * 1,235,259 polygons, about a hundred times the detail of previous global
 * lithological maps, and roughly thirty-six times the FAO soil map's polygon
 * count. `services/bake-glim.py` bakes it into this site's own pyramid and
 * `loadDerivedGeologyMap` streams it, exactly as the soil map and the glacier
 * inventory are streamed. There is no remote behind it.
 *
 * A GLiM UNIT IS A ROCK, and that is why this module is so much shorter than
 * `soil-cover.js`. The soil map needed a card of its own because rock-mechanics
 * properties do not apply to a Podzol; these polygons ARE rock, so they go
 * through the ordinary geology card, `rock-class.js` and the rock-property
 * database like any other lithology. The bake writes each polygon's class name
 * into `lith`, which is the column all three of those read.
 */

import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260904-36feba6";

const STAMP = new URL(import.meta.url).search || "";
const LAYER_ID = "glim-lithology";
// Absolute, not module-relative: `import.meta.url` here is `…/viewer/gis/`, so
// a relative "data/global/…" resolves inside `gis/` and 404s.
// No ${STAMP} here: `bakedTiles` in geology-panel.js appends the module
// stamp itself (deliberately — a re-bake is invisible to a browser holding
// the old manifest). Appending it here too produced
// `manifest.json?v=X?v=X`, which this server tolerates and a stricter one
// need not. The sidecar tables below DO carry it: nothing else stamps them.
const MANIFEST = "/data/global/glim/manifest.json";
const CLASSES = `/data/global/glim/classes.json${STAMP}`;

const FALLBACK_COLOUR = "#bdbdbd";

let classesPromise = null;

/**
 * The class table the bake writes beside the tiles: code → name, colour, count
 * and the order a legend should read them in.
 *
 * Fetched rather than restated. The palette AND its order live in
 * `bake-glim.py`; a second copy here would be the polygon-area formula in ten
 * files again, and the first correction to either would leave a key that does
 * not match the map beside it.
 */
function classes() {
  if (!classesPromise) {
    classesPromise = fetch(CLASSES)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return classesPromise;
}

/**
 * SIXTEEN CLASSES, ALL OF THEM SHOWN, in the order a geological key reads.
 *
 * Unlike the soil map there is no grouping to collapse into: GLiM's level 1 IS
 * sixteen classes, which is inside what a key can separate, so every one gets
 * its own row. The order is the bake's `order` field — sediments, volcanics,
 * plutonics, metamorphics, then the three that are not lithologies — because a
 * key sorted by frequency puts water between two sedimentary classes.
 */
function legendFromClasses(table) {
  const entries = Object.values(table || {})
    .filter((c) => c && c.name)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return {
    palette: entries.map((c) => String(c.colour || FALLBACK_COLOUR).replace("#", "")),
    labels: entries.map((c) => c.name),
    values: entries.map((c) => c.name),
    categorical: true,
    classed: true,
    field: "Surface lithology (GLiM)",
  };
}

function say(message) {
  const node = document.getElementById("soil-status");
  if (node) node.textContent = message || "";
}

async function loadGlim() {
  // Started first and awaited after the layer, so the fetch overlaps the build
  // rather than delaying it.
  const table = classes();
  const layer = await loadDerivedGeologyMap({
    id: LAYER_ID,
    label: "Surface lithology (GLiM)",
    tiles: { manifest: MANIFEST, kind: "glim" },
    // Nothing to filter: these tiles are GLiM and only GLiM, and the geology's
    // own ice predicate reads a `lith` column that here means something else —
    // GLiM's "Ice and Glaciers" is a mapped class of the lithological map, not
    // a stray ice polygon in a rock map, and removing it would put a hole in
    // Greenland.
    featureFilter: null,
    /**
     * The bake's own colour per class, for the reason Macrostrat's
     * `properties.color` gets the same treatment: `categoricalSymbology` ranks
     * by how many POLYGONS each class has and keeps twelve, which here would
     * fold evaporites, pyroclastics, ice and no-data into one grey "(other)"
     * while ranking unconsolidated sediments — 290,440 polygons — first.
     */
    colourFor: (f) => f?.properties?.colour || FALLBACK_COLOUR,
    contacts: { mode: "shade", shade: 0.62, opacity: 0.55 },
    credit: "GLiM — Global Lithological Map v1.1 (Hartmann & Moosdorf 2012), "
      + "doi:10.1029/2012GC004370.",
    metadata: {
      source: "GLiM — Global Lithological Map database v1.1, about 1:3,750,000",
      citation: "Hartmann, J. & Moosdorf, N. (2012). The new global "
        + "lithological map database GLiM: A representation of rock properties "
        + "at the Earth surface. Geochemistry, Geophysics, Geosystems 13, "
        + "Q12004. doi:10.1029/2012GC004370. Class names are GLiM's own; the "
        + "colours are this app's, one per level-1 class.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site from the authors' "
        + "geodatabase (World Eckert IV, reprojected)",
    },
    legendInfo: legendFromClasses(await table),
  });
  if (!layer) return null;

  /**
   * COUNT AFTER THE TILES LAND, AND OFF THE LAYER THE MANAGER HOLDS NOW — the
   * two traps the glacier and soil panels both record: the load resolves
   * before the tiles arrive, and a tiled layer rebuilds itself into a NEW
   * record whenever the view settles.
   */
  await new Promise((done) => window.setTimeout(done, 1500));
  const live = layerOf() || layer;
  /**
   * COUNT WHAT IS DRAWN, and the controller is the only thing that knows.
   *
   * `layer.features` is a SNAPSHOT the tiled layer keeps for the pickers, and
   * on a dense pyramid it can be empty while the map is fully painted —
   * measured on GLiM, 0 in `features` against 541,082 held by the controller
   * and sixteen tile objects visible on the globe. Reading the snapshot made
   * the status line announce "0 in view" over a drawn map, which reads as the
   * layer having failed to load. This file's own rule, from the other
   * direction: count the things drawn, do not ask the drawing what it holds.
   */
  const drawn = live.tiled?.featureCount?.()
    ?? (live.features || []).length;
  /**
   * COUNTED FROM THE TABLE THE BAKE WROTE, never typed in.
   *
   * This line read "1,235,259 polygons over 16 classes" as a literal, which is
   * a claim about the source printed whether or not anything loaded — and with
   * the pyramid missing it appeared verbatim over a map drawing nothing. The
   * panel refuses that case out loud now, and this says only what the file it
   * actually read contains, so the two can never disagree.
   */
  const counts = await table;
  const total = Object.values(counts).reduce((n, c) => n + (c.count || 0), 0);
  const named = Object.keys(counts).length;
  say(total
    ? `GLiM surface lithology — ${total.toLocaleString()} polygons over `
      + `${named} classes, about 1:3,750,000. ${drawn.toLocaleString()} in `
      + "view; it sharpens as you fly in."
    : `GLiM surface lithology — ${drawn.toLocaleString()} polygons in view.`);
  return layer;
}

function layerOf() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.geologyDataset === LAYER_ID) || null;
}

if (typeof window !== "undefined") {
  window.GeoIDGlimCover = {
    load: loadGlim,
    remove: () => removeDerivedGeologyMap(LAYER_ID),
    layerOf,
    say,
  };
}

export { loadGlim, layerOf, legendFromClasses };
