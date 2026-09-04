/**
 * The world's soils, as a map you can interrogate.
 *
 * This replaced a card that sampled SoilGrids at ONE POINT — press a button,
 * get numbers for the middle of the view. Useful, and not a map: you could not
 * see where a soil began or ended, could not clip to it, could not extract by
 * it, and could not lay it beside the geology it sits on. The layer here is an
 * ordinary tiled vector layer, so all of that works with nothing added, exactly
 * as it does for the world geology and the glacier inventory.
 *
 * `services/bake-soil.py` bakes the FAO/UNESCO Soil Map of the World into this
 * site's own pyramid — 34,112 polygons, 123 dominant soil units — and
 * `loadDerivedGeologyMap` streams it. There is no remote behind it.
 *
 * A NOTE ON RESOLUTION, because it is the first thing anybody asks. This is a
 * 1:5,000,000 map, and finer soil data exists: SoilGrids is 250 m. It is also
 * a RASTER — measured, its WMS hands back 0 bytes when asked for vector tiles
 * — so it is a different product rather than a better version of this one, and
 * it belongs on the drape path. A polygon map at 1:5M and a raster at 250 m
 * answer different questions; pretending one is the other is how a map comes
 * to claim a precision its source never had.
 */

import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260904-8512f2d";

const STAMP = new URL(import.meta.url).search || "";
const LAYER_ID = "soil-dsmw";
// Absolute, not module-relative: `import.meta.url` here is `…/viewer/gis/`, so
// a relative "data/global/…" resolves inside `gis/` and 404s — the trap
// map-layers.js documents from one side and the GEE cache from the other.
// No ${STAMP} here: `bakedTiles` in geology-panel.js appends the module
// stamp itself (deliberately — a re-bake is invisible to a browser holding
// the old manifest). Appending it here too produced
// `manifest.json?v=X?v=X`, which this server tolerates and a stricter one
// need not. The sidecar tables below DO carry it: nothing else stamps them.
const MANIFEST = "/data/global/soil/manifest.json";
const UNITS = `/data/global/soil/units.json${STAMP}`;

/** The soil the sphere shows where the source mapped nothing it could name. */
const FALLBACK_COLOUR = "#bdbdbd";

let unitsPromise = null;

/**
 * The legend table the bake writes beside the tiles: code → name, grouping and
 * colour, for every one of the 123 units the polygons carry.
 *
 * Fetched rather than restated. The palette lives in `bake-soil.py`, and a
 * second copy here would be the polygon-area formula in ten files all over
 * again — the first time either was corrected they would disagree, and the
 * disagreement would be a legend that does not match the map beside it.
 */
function units() {
  if (!unitsPromise) {
    unitsPromise = fetch(UNITS)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return unitsPromise;
}

/**
 * ONE SWATCH PER MAJOR GROUPING, not per unit.
 *
 * 123 units is far past what a key can separate, and the FAO legend already
 * groups them: `Af` and `Ao` are both Acrisols and are drawn as such, while
 * each keeps its own full name on its own card. The five miscellaneous land
 * units — water, ice, rock debris, salt flats, dunes — are collected under one
 * honest heading rather than being given soil-like classes, because they are
 * not soils and a reader counting classes by area would otherwise be told
 * that a tenth of the world's soil is lake.
 */
function legendFromUnits(table) {
  const groups = new Map();
  Object.values(table || {}).forEach((unit) => {
    const name = unit.group || "Not a soil";
    if (!groups.has(name)) groups.set(name, unit.colour || FALLBACK_COLOUR);
  });
  const entries = [...groups.entries()]
    // Alphabetical, with the not-a-soil bucket last: it is the one row that is
    // not a soil grouping and it should not sit in the middle of them.
    .sort((a, b) => (a[0] === "Not a soil") - (b[0] === "Not a soil")
      || a[0].localeCompare(b[0]));
  return {
    palette: entries.map(([, colour]) => colour.replace("#", "")),
    labels: entries.map(([name]) => titleCase(name)),
    values: entries.map(([name]) => name),
    categorical: true,
    classed: true,
    field: "Soil grouping (FAO)",
  };
}

/** "ACRISOLS" is the legend's own spelling; a key does not need to shout. */
function titleCase(name) {
  return String(name).replace(/\b[A-Z]{2,}\b/g,
    (word) => word[0] + word.slice(1).toLowerCase());
}

function say(message) {
  const node = document.getElementById("soil-status");
  if (node) node.textContent = message || "";
}

async function loadSoil() {
  // Started first and awaited after the layer, so the fetch overlaps the build
  // rather than delaying it — the arrangement the glacier names already use.
  const table = units();
  const layer = await loadDerivedGeologyMap({
    id: LAYER_ID,
    label: "Soils of the world (FAO/UNESCO)",
    /** Its own pyramid; `kind` is the layer name the bake writes inside. */
    tiles: { manifest: MANIFEST, kind: "soil" },
    // Nothing to filter: these tiles are soil and only soil, and the geology's
    // own ice predicate reads a `lith` column this source does not have.
    featureFilter: null,
    /**
     * THE SOURCE'S OWN COLOUR, carried on every polygon by the bake — the same
     * arrangement Macrostrat's `properties.color` gets, and for the same
     * reason: `categoricalSymbology` would otherwise rank by how many POLYGONS
     * each unit has, keep twelve and fold the rest into one grey. On this map
     * that would put Lithosols (4,266 polygons of thin mountain soil) at rank
     * one and drop whole soil groupings into "(other)".
     */
    colourFor: (f) => f?.properties?.colour || FALLBACK_COLOUR,
    contacts: { mode: "shade", shade: 0.62, opacity: 0.55 },
    credit: "FAO/UNESCO Digital Soil Map of the World, 1:5,000,000 — FAO, "
      + "CC BY 4.0.",
    metadata: {
      source: "FAO/UNESCO Digital Soil Map of the World (DSMW), 1:5,000,000",
      citation: "FAO/UNESCO (2007). Digital Soil Map of the World, version 3.6. "
        + "FAO, Rome. CC BY 4.0. Unit names and soil properties are FAO's own; "
        + "the colours are this app's, one per major grouping.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site",
    },
    legendInfo: legendFromUnits(await table),
  });
  if (!layer) return null;

  /**
   * COUNT AFTER THE TILES LAND, AND OFF THE LAYER THE MANAGER HOLDS NOW.
   *
   * `loadDerivedGeologyMap` resolves when the layer exists and its tiles
   * arrive a beat later, so an immediate read says "0 in view" over a map that
   * is plainly drawing. And a tiled layer REBUILDS ITSELF into a new record
   * whenever the view settles, so the handle returned a moment ago is a
   * snapshot — the count has to be looked up again rather than read off it.
   * Both traps are the glacier panel's, met again unchanged.
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
  const named = Object.keys(await table).length;
  say(`FAO/UNESCO Soil Map of the World — ${named} dominant soil units at `
    + `1:5,000,000. ${drawn.toLocaleString()} polygons in view; it sharpens as `
    + "you fly in.");
  return layer;
}

function layerOf() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.geologyDataset === LAYER_ID) || null;
}

/**
 * The row is drawn by `catalogue-panels.js`, not here.
 *
 * A tiled layer is one `global-data.js` cannot describe — it is not a file —
 * so it is merged in from that module's own TILED registry and wears the same
 * row, group heading and ⓘ as everything beside it. The ice inventory learned
 * this the expensive way: a panel that draws its own tick above a catalogue is
 * two kinds of control for one kind of thing.
 */
if (typeof window !== "undefined") {
  window.GeoIDSoilCover = {
    load: loadSoil,
    remove: () => removeDerivedGeologyMap(LAYER_ID),
    layerOf,
    say,
  };
}

export { loadSoil, layerOf, legendFromUnits, titleCase };
