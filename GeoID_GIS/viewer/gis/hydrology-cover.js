/**
 * The world's water as streamed maps: lakes, rivers and the sea.
 *
 * Three pyramids baked by `services/bake-hydrology.py` from the source
 * archives mirrored under `shapefiles/` in the bucket, each streamed through
 * `loadDerivedGeologyMap` exactly as the soil map, GLiM and the glacier
 * inventory are — so each refines on settle, clips, picks and exports like
 * every other tiled layer, and there is one controller rather than a second.
 *
 *   HydroLAKES   1.4 M shorelines of lakes and reservoirs ≥ 10 ha, CC BY 4.0
 *   GRWL         river centrelines ≥ 30 m wide, with widths, CC BY 4.0
 *   the sea      Natural Earth 1:10m from orbit, OpenStreetMap's
 *                coastline-exact water polygons from zoom 4 (ODbL)
 *
 * WHY GRWL AND NOT HYDRORIVERS, stated where somebody will look for it:
 * HydroRIVERS is the fuller network and its licence forbids distributing it
 * as a stand-alone product, which a public tile pyramid of it would be. GRWL
 * is CC BY 4.0 and carries the one number a river map most wants — its width.
 *
 * One module for three layers because they differ only in what is written
 * below — a manifest, a tile layer name, a paint and a credit — and three
 * copies of the same eighty lines are what drift.
 */

import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260912-d4224ad";

const STAMP = new URL(import.meta.url).search || "";
const FALLBACK_COLOUR = "#3d8fd1";

/**
 * What each layer is. Manifests are absolute paths with no stamp — `bakedTiles`
 * appends the module stamp itself, and appending it here as well produced
 * `manifest.json?v=X?v=X` for GLiM. The class tables DO carry it: nothing else
 * stamps them.
 */
const LAYERS = {
  "hydro-lakes": {
    label: "Lakes and reservoirs (HydroLAKES)",
    dir: "hydrolakes",
    kind: "lakes",
    field: "Water body (HydroLAKES)",
    opacity: 0.85,
    credit: "HydroLAKES v1.0 (Messager et al. 2016), CC BY 4.0 — "
      + "doi:10.1038/ncomms13603.",
    metadata: {
      source: "HydroLAKES v1.0 — shorelines of every lake and reservoir of "
        + "10 ha or more",
      citation: "Messager, M.L., Lehner, B., Grill, G., Nedeva, I., Schmitt, O. "
        + "(2016). Estimating the volume and age of water stored in global "
        + "lakes using a geo-statistical approach. Nature Communications 7: "
        + "13603. doi:10.1038/ncomms13603. CC BY 4.0.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site from the published "
        + "shapefile",
    },
  },
  "hydro-rivers": {
    label: "Rivers by width (GRWL)",
    dir: "grwl",
    kind: "rivers",
    field: "Median river width (GRWL)",
    // A LINE layer: fading it only makes it harder to see, and there is no
    // fill underneath to read through it.
    opacity: 1,
    lines: true,
    credit: "GRWL v01.01 (Allen & Pavelsky 2018), CC BY 4.0 — "
      + "doi:10.1126/science.aat0636.",
    metadata: {
      source: "GRWL — Global River Widths from Landsat v01.01, centrelines of "
        + "rivers and streams at least 30 m wide at mean discharge",
      citation: "Allen, G.H., Pavelsky, T.M. (2018). Global extent of rivers "
        + "and streams. Science 361(6402): 585-588. doi:10.1126/science.aat0636. "
        + "Data: doi:10.5281/zenodo.1297434, CC BY 4.0.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site from the simplified "
        + "summary-statistics product",
    },
  },
  "hydro-ocean": {
    label: "Ocean and seas (OpenStreetMap, Natural Earth)",
    dir: "ocean",
    kind: "ocean",
    field: "Ocean",
    opacity: 0.6,
    credit: "© OpenStreetMap contributors (ODbL 1.0) from zoom 4; Natural "
      + "Earth 1:10m, public domain, below.",
    metadata: {
      source: "Natural Earth 1:10m ocean (zooms 0-3); OpenStreetMap water "
        + "polygons, 2026-09-10 (zooms 4-6)",
      citation: "© OpenStreetMap contributors, Open Database Licence (ODbL) "
        + "1.0 — https://www.openstreetmap.org/copyright. Natural Earth, "
        + "public domain.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site",
    },
  },
};

const tables = new Map();

/** The class table the bake writes beside the tiles, fetched rather than
 * restated — the palette and its order live in `bake-hydrology.py`. */
function classes(id) {
  if (!tables.has(id)) {
    const url = `/data/global/${LAYERS[id].dir}/classes.json${STAMP}`;
    tables.set(id, fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return tables.get(id);
}

function legendFromClasses(table, field) {
  const entries = Object.values(table || {})
    .filter((c) => c && c.name)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return {
    palette: entries.map((c) => String(c.colour || FALLBACK_COLOUR).replace("#", "")),
    labels: entries.map((c) => c.name),
    values: entries.map((c) => c.name),
    categorical: true,
    classed: true,
    field,
  };
}

function say(message) {
  const node = document.getElementById("hydrology-status");
  if (node) node.textContent = message || "";
}

function layerOf(id) {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.geologyDataset === id) || null;
}

async function load(id) {
  const spec = LAYERS[id];
  if (!spec) throw new Error(`no such water layer: ${id}`);
  const table = classes(id);
  const layer = await loadDerivedGeologyMap({
    id,
    label: spec.label,
    tiles: { manifest: `/data/global/${spec.dir}/manifest.json`, kind: spec.kind },
    // These tiles hold water and only water. The geology's own ice predicate
    // reads a `lith` column none of them has.
    featureFilter: null,
    // The bake's colour per class, painted at build: the class IS the legend.
    colourFor: (f) => f?.properties?.colour || FALLBACK_COLOUR,
    /**
     * NO CONTACTS. A shoreline is not a unit boundary: two lakes do not share
     * an edge the way two formations do, the sea's split polygons meet along
     * cuts that are pure bookkeeping, and a river is a line with nothing to
     * seal. "match" keeps the seal invisible, which is what it is for here —
     * closing sub-pixel gaps — rather than drawing a contact that is not there.
     */
    contacts: { mode: "match" },
    credit: spec.credit,
    metadata: spec.metadata,
    initialOpacity: spec.opacity,
    legendInfo: legendFromClasses(await table, spec.field),
  });
  if (!layer) return null;
  /**
   * Counted after the tiles land and off the layer the manager holds NOW —
   * the load resolves before the tiles arrive, and a tiled layer rebuilds
   * itself into a new record when the view settles. And from the table the
   * bake wrote, never typed in: a literal total prints whether or not
   * anything loaded.
   */
  await new Promise((done) => window.setTimeout(done, 1500));
  const live = layerOf(id) || layer;
  const drawn = live.tiled?.featureCount?.() ?? (live.features || []).length;
  const counts = await table;
  const total = Object.values(counts).reduce((n, c) => n + (c.count || 0), 0);
  const noun = spec.lines ? "river segments" : spec.kind === "ocean"
    ? "water polygons" : "lakes and reservoirs";
  say(total
    ? `${spec.label} — ${total.toLocaleString()} ${noun}; `
      + `${drawn.toLocaleString()} in view, sharpening as you fly in.`
    : `${spec.label} — ${drawn.toLocaleString()} in view.`);
  return layer;
}

function remove(id) {
  const layer = layerOf(id);
  // A tiled layer holds GPU buffers for every tile it has built, and removing
  // the record does not free them.
  layer?.tiled?.dispose?.();
  removeDerivedGeologyMap(id);
}

if (typeof window !== "undefined") {
  window.GeoIDHydroCover = { load, remove, layerOf, say, LAYERS };
}

export { load, remove, layerOf, legendFromClasses, LAYERS };
