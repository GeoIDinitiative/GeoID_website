/**
 * The Geology tab, as a geology tab rather than a pair of checkboxes.
 *
 * What it replaced: two toggles labelled "NI bedrock geology" and "NI
 * superficial geology" that loaded a file each. Everything a geological map is
 * actually for was missing — you could not choose what to colour by, see what
 * the attributes were, read a legend, or ask a polygon what it was. The BGS
 * bedrock sheet carries **fifty-seven** columns and the toggle picked none of
 * them, so the map arrived in one flat colour.
 *
 * So: a catalogue you choose from, opacity per layer, and a symbology dialog
 * that shows the attribute table's head and lets you colour by any column.
 *
 * Three things it deliberately does NOT reimplement, because they already work
 * for every vector layer and a second copy would drift:
 *
 * - **Click a polygon and it tells you what it is.** `feature-popup.js` already
 *   does this, and its `PREFERRED` field order was already tuned for BGS data —
 *   it leads with `lex_d`, `rcs_d`, `bgstype` and the age columns. This is the
 *   same pattern the Mars and Moon viewers use for their geology, arrived at
 *   from the other end: they carry a features JSON beside a raster, and here the
 *   vector layer IS the features.
 * - **The legend.** `categoricalSymbology` writes `legendInfo` and the layer
 *   card draws one row per class with its name and colour. Colouring by a column
 *   is what makes the legend, rather than something to be kept in step with it.
 * - **Opacity, visibility, order and removal.** A geology layer is an ordinary
 *   layer, so the layer list already owns those; the slider here is a shortcut
 *   to the one the list has, not a second source of truth.
 */

import { QUALITATIVE_RAMP } from "./symbology.js?v=20260827-10c08b6";
import { currentBodyId } from "./bodies.js?v=20260827-10c08b6";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260827-10c08b6";
import { openSymbologyDialog } from "./symbology-dialog.js?v=20260827-10c08b6";

/* ── The catalogue ───────────────────────────────────────────────────────────
 *
 * A record per dataset rather than a checkbox per dataset: adding the BGS
 * 1:50k sheets, or another country's survey, is a row here and nothing else.
 * `colourBy` is the column that makes the map read as a geological map — the
 * ranking in `delimited.js` would find something reasonable, but the lithology
 * column is a fact about BGS data and worth stating.
 */
const CATALOGUE = [
  {
    id: "ni-bedrock",
    // Which WORLD this belongs to. The panel loads from boot.js on all ten, so
    // without it Northern Ireland's bedrock was offered on Mars and drawn on
    // it -- a BGS sheet pinned to Martian coordinates, in full colour.
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — bedrock",
    path: "/ni-prototype/data/ni_bedrock.geojson",
    name: "NI bedrock geology (BGS 625k).geojson",
    colourBy: "lex_d",
    credit: "BGS 1:625 000 bedrock geology, © UKRI.",
    /**
     * HIDDEN, because the world map is this sheet.
     *
     * Macrostrat's compilation carries BGS DiGMapGB-625 over Northern Ireland
     * — a click there answers with `source_id` 23 and names the survey — so
     * offering the same polygons a second time was two rows in the dropdown,
     * two entries in the legend and two answers to a click, all from one
     * survey. The record stays: it is still reachable through
     * `GeoIDGeology.load("ni-bedrock")`, and un-hiding it is one word if a
     * region ever needs its national sheet above the global one.
     */
    hidden: true,
    default: false,
  },
  {
    id: "ni-faults",
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — faults",
    path: "/ni-prototype/data/ni_faults.geojson",
    name: "NI bedrock faults (BGS 625k).geojson",
    // The only column that distinguishes one line from another: 279 faults at
    // rockhead and 2 thrusts. Every fault in this sheet is unnamed
    // (`fltname_d` is blank on all 281), so colouring by name would paint one
    // class and call it a legend.
    colourBy: "feature_d",
    credit: "BGS 1:625 000 bedrock faults, © UKRI.",
    // Hidden with the sheets it belongs to: the world contacts and faults layer
    // covers the same ground from the same compilation.
    hidden: true,
    default: false,
  },
  {
    id: "macrostrat-lines",
    body: "earth",
    scope: "global",
    label: "World contacts and faults (Macrostrat)",
    name: "World contacts and faults (Macrostrat).geojson",
    // The tiles' other layer: the lines the source maps draw between units —
    // contacts, thrusts, normal faults, each with the kind it is.
    dynamic: "lines",
    colourBy: "type",
    credit: "Macrostrat Burwell compilation, CC BY 4.0.",
    default: false,
  },
  {
    id: "ni-superficial",
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — superficial",
    path: "/ni-prototype/data/ni_superficial.geojson",
    name: "NI superficial geology (BGS 625k).geojson",
    colourBy: "lex_d",
    credit: "BGS 1:625 000 superficial deposits, © UKRI.",
    hidden: true,
    default: false,
  },
];

/**
 * The global base.
 *
 * The shape this tab was built for: a world geology underneath, and regional
 * surveys added from the dropdown on top of it — a national sheet is better
 * than the global compilation over the same ground, and the two stack rather
 * than being alternatives.
 *
 * It is `dynamic` because there is no global geological map you can download:
 * the compilation is served as vector tiles, so what loads is the geology of
 * the view at the resolution that view deserves — the whole world when you are
 * looking at the whole world, one survey's detail when you are not. `macrostrat.js`
 * does the fetching and `mvt.js` the decoding; everything after that is an
 * ordinary vector layer.
 *
 * `sourceColours` says the data brings its own palette: Macrostrat ships the
 * colour each polygon is drawn in, and repainting it from a ramp of ours would
 * throw away the one thing that makes a geological map readable at a glance.
 */
const GLOBAL_BASE = {
  id: "macrostrat-units",
  body: "earth",
  scope: "global",
  label: "World geology (Macrostrat)",
  name: "World geology (Macrostrat).geojson",
  dynamic: "units",
  sourceColours: true,
  colourBy: "name",
  credit: "Macrostrat Burwell compilation, CC BY 4.0 — each polygon carries the "
    + "survey that mapped it.",
};

/** This world's datasets. A body with none gets a panel that says so. */
const forThisBody = () => [GLOBAL_BASE, ...CATALOGUE]
  .filter((d) => (d.body || "earth") === currentBodyId());
/**
 * What the dropdown offers: this world's datasets, minus the hidden ones.
 *
 * Hiding rather than deleting keeps `load()` working for anything that asks by
 * id — the NI prototype's own tab, a saved project, a link — and makes turning
 * a sheet back on a one-word change.
 */
const offered = () => forThisBody().filter((d) => !d.hidden);

const entryById = (id) => [GLOBAL_BASE, ...CATALOGUE].find((d) => d && d.id === id) || null;

/* ── Style ───────────────────────────────────────────────────────────────── */

const STYLE = `
/* NEVER a backtick in this block -- it is a template literal and one ends it.
   module-css.test.mjs catches that; a browser does not. */
#gis-geology-panel { display: flex; flex-direction: column; gap: 0.4rem; }
#gis-geology-panel .row { margin: 0; }
#gis-geology-loaded {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.2rem;
}
.gis-geo-layer {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.35rem;
  padding: 0.35rem 0.4rem;
}
.gis-geo-layer-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.gis-geo-layer-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 0.66rem/1.3 'Exo 2', sans-serif;
}
.gis-geo-layer-by {
  font: 400 0.58rem/1.3 'Exo 2', sans-serif;
  opacity: 0.7;
}
.gis-geo-opacity { width: 100%; }
#gis-geology-status {
  font: 400 0.62rem/1.35 'Exo 2', sans-serif;
  opacity: 0.8;
}
#gis-geology-status:empty { display: none; }
.gis-geo-base {
  font: 400 0.6rem/1.35 'Exo 2', sans-serif;
  opacity: 0.7;
  padding: 0.25rem 0.35rem;
  border-left: 2px solid rgba(var(--nav-accent-rgb), 0.5);
}
`;

// The dialog this tab used to carry now lives in symbology-dialog.js, with its
// own styling -- so nothing above dresses it.

function installStyle() {
  if (document.getElementById("gis-geology-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-geology-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

let panel = null;
let nodes = null;

const say = (message) => { if (nodes?.status) nodes.status.textContent = message || ""; };

/** Datasets already downloaded this session, by path. */
const fetched = new Map();

/**
 * A symbology somebody CHOSE, kept against the dataset rather than the layer.
 *
 * A tiled layer is rebuilt whenever the view settles, and a rebuild is a new
 * layer object — so without this, colouring the world geology by age and then
 * flying anywhere put it back to the source's own colours. Losing a choice
 * because the map refreshed is the same class of fault as the camera jumping:
 * the app undoing something the user did.
 */
const styleChoice = new Map();

const loadedLayers = () => (window.GeoIDImportManager?.getLayers?.() || [])
  .filter((l) => l.status === "loaded" && l.geologyDataset);

/**
 * The baked tile index, asked for once.
 *
 * The site carries the world's geology to zoom 5 (`data/global/geology`,
 * ~46 MB, made by `services/bake-geology.py`), so the view everybody opens on
 * is served from disk: offline, instant, and immune to somebody else's CDN
 * having cached a tile without its CORS header. Deeper zooms come live from
 * the source, which is the right way round — the coarse levels are asked for
 * constantly and never change, the fine ones are asked for rarely and are
 * where the compilation's own updates land.
 */
let manifestOnce = null;
function bakedTiles() {
  if (!manifestOnce) {
    manifestOnce = import(`./vector-tiles.js${new URL(import.meta.url).search}`)
      .then((m) => m.loadManifest("/data/global/geology/manifest.json"))
      .catch(() => null);
  }
  return manifestOnce;
}

/**
 * A tiled dataset, created once and then KEPT.
 *
 * This is the whole difference from what it replaced. There is one layer
 * record and one object3D for the life of the layer; a view change asks the
 * controller for the tiles that view needs, and the controller already holds
 * most of them. Nothing is re-imported, so nothing that belongs to the layer —
 * the symbology somebody chose, the opacity they set, its place in the stack,
 * its row in the legend — is lost because the camera moved.
 */
async function loadTiled(entry, { toView = false, quiet = false } = {}) {
  const manager = window.GeoIDImportManager;
  const search = new URL(import.meta.url).search;
  const [tilesModule, macro, manifest] = await Promise.all([
    import(`./vector-tiles.js${search}`),
    import(`./macrostrat.js${search}`),
    bakedTiles(),
  ]);
  const existing = loadedLayers().find((l) => l.geologyDataset === entry.id);
  const controller = existing?.tiled || tilesModule.createTiledVectorLayer({
    name: entry.name,
    kind: entry.dynamic,
    // Local first, then the source. `has` keeps the client from asking for the
    // thousands of ocean tiles that were never baked because they are empty.
    sources: {
      local: manifest?.base || null,
      has: manifest?.has || (() => false),
      size: manifest?.size || null,
      maxZoom: manifest?.maxZoom ?? null,
      remote: "https://tiles.macrostrat.org/carto",
    },
    // Macrostrat ships the colour each polygon is drawn in, so a source-coloured
    // layer is painted as its tiles are built rather than repainted afterwards.
    colourFor: entry.sourceColours ? (f) => f?.properties?.color || null : null,
  });

  const box = toView ? (macro.viewBounds() || macro.WORLD) : macro.WORLD;
  const zoom = toView ? macro.zoomForBounds(box) : macro.WORLD_ZOOM;
  if (!quiet) say(`${entry.label}: reading tiles…`);
  /**
   * The world goes on FIRST and stays on.
   *
   * A view is a hemisphere at best, so a layer that only ever holds the view's
   * tiles has no geology on the far side of the planet: turn the globe and
   * half of it is empty until it settles and fetches — "it maps in two halves
   * with a huge latency between them". Pinning the world at zoom 1 (four
   * tiles, already on disk) means the far side is always mapped, and the view
   * only ever adds detail on top.
   */
  if (!existing?.tiled) {
    await controller.pin({
      bounds: macro.WORLD,
      zoom: macro.WORLD_ZOOM,
      onProgress: (done, total) => {
        if (!quiet) say(`${entry.label}: world tile ${done} of ${total}…`);
      },
    });
  }
  const stats = await controller.update({
    bounds: box,
    zoom,
    // Never coarser than the backdrop: below it there is nothing to gain, and
    // the world underneath is already at that level.
    minZoom: macro.WORLD_ZOOM,
    onProgress: (done, total) => {
      if (!quiet && done < total) say(`${entry.label}: tile ${done} of ${total}…`);
    },
  });
  // Null means a newer view asked while this one was loading; its tiles are in
  // the cache for whoever wants them, but it must not become the picture.
  if (!stats) return;

  let layer = existing;
  if (!layer) {
    layer = manager.addDerivedLayer(entry.label, {
      object3D: controller.group,
      georeferenced: true,
      bounds: { minX: box.west, maxX: box.east, minY: box.south, maxY: box.north },
      features: controller.features(),
      collection: { type: "FeatureCollection", features: controller.features() },
      repaint: (colourFn) => controller.repaint(colourFn),
    }, "geology");
    if (!layer) { say(`${entry.label} could not be added.`); return; }
    layer.geologyDataset = entry.id;
    layer.credit = entry.credit;
    layer.dynamicGeology = entry.dynamic;
    layer.tiled = controller;
  }
  // The features a tiled layer HAS are the ones in view — which is what makes
  // extraction, clipping and export mean something when they run on it.
  layer.features = controller.features();
  layer.collection = { type: "FeatureCollection", features: layer.features };
  layer.dynamicZoom = stats.zoom;
  layer.dynamicBounds = box;
  // Tiles that arrived just now are new children: the stack has to be applied
  // again or they draw at order zero, under the basemap. The controller keeps
  // the opacity so the next tile matches the ones already on screen.
  controller.setOpacity?.(layer.opacity ?? 1);
  window.GeoIDLayerHierarchy?.render?.();

  const chosen = styleChoice.get(entry.id);
  if (chosen) {
    await applyField(layer, chosen.field,
      { ramp: chosen.ramp, overrides: chosen.overrides, labels: chosen.labels });
  } else if (entry.sourceColours) {
    // The tiles were built in the source's colours already, so this only draws
    // the key — repainting would rebuild every tile in view for nothing.
    await paintFromSource(layer, entry, { repaint: false });
  } else {
    await applyField(layer, entry.colourBy);
  }
  publishInteractive();
  watchView();
  const where = stats.cached === stats.tiles ? "from cache"
    : `${stats.fetched} fetched, ${stats.cached} cached`;
  say(`${entry.label} — ${layer.features.length.toLocaleString()} features at zoom `
    + `${stats.zoom} (${stats.tiles} tiles, ${where}`
    + `${stats.failed ? `, ${stats.failed} unavailable` : ""}). ${entry.credit}`);
  render();
}

/**
 * `toView` is what tells a tiled dataset to follow the camera.
 *
 * The first load of a world layer must be the WORLD — the tab calls it world
 * geology, and loading only the hemisphere in shot would make that a lie the
 * first time anyone looked. Measured before this existed: with the camera over
 * the Atlantic, points in Northern Ireland and Colorado had no geology under
 * them at all, because those tiles were never asked for. Refreshing is what
 * narrows it to the view, and that is a press somebody makes.
 */
async function loadDataset(entry, { toView = false, replace = false, quiet = false } = {}) {
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    say("The globe is still starting — try again in a moment.");
    return;
  }
  // A tiled dataset has no file to import: it is a controller over tiles, and
  // it updates itself in place rather than being loaded again.
  if (entry.dynamic) return loadTiled(entry, { toView, quiet });
  const existing = (manager.getLayers?.() || []).find((l) => l.geologyDataset === entry.id);
  if (existing && !replace) {
    say(`${entry.label} is already loaded.`);
    return;
  }
  /**
   * Replacing keeps the OLD layer on the globe until the new one has arrived.
   *
   * Removing first leaves a second or two with no geology at all, which on a
   * refine reads as the map breaking rather than sharpening -- and if the
   * fetch then fails, it has taken the map away and put nothing back.
   */
  if (!quiet) say(`Loading ${entry.label}…`);
  try {
    let blob;
    let note = "";
    let loadedFor = null;
    if (entry.dynamic) {
      /**
       * A tiled dataset has no file to fetch: what it holds depends on where
       * you are looking, so the layer is built from the tiles covering the
       * view. Nothing is cached here on purpose — the whole point is that
       * asking again from somewhere else gives a different, better map.
       */
      const { fetchGeology } = await import(`./macrostrat.js${new URL(import.meta.url).search}`);
      const { WORLD, WORLD_ZOOM } = await import(`./macrostrat.js${new URL(import.meta.url).search}`);
      const result = await fetchGeology({
        kind: entry.dynamic,
        bounds: toView ? null : WORLD,
        zoom: toView ? null : WORLD_ZOOM,
        onProgress: (done, total) => {
          if (!quiet) say(`${entry.label}: tile ${done} of ${total}…`);
        },
      });
      if (!result.collection.features.length) {
        throw new Error("the tiles came back empty for this view");
      }
      blob = new Blob([JSON.stringify(result.collection)], { type: "application/geo+json" });
      note = ` Zoom ${result.zoom}, ${result.tiles} tile${result.tiles === 1 ? "" : "s"}`
        + `, ${Math.round(result.bytes / 1024)} KB`
        + (result.failed ? `, ${result.failed} unavailable` : "") + ".";
      loadedFor = { zoom: result.zoom, bounds: result.bounds };
    } else {
      // Kept from the first load, because unticking the tab now REMOVES these
      // layers and ticking it again rebuilds them. The parse and the triangulation
      // have to happen again either way; the download does not.
      blob = fetched.get(entry.path);
      if (!blob) {
        const response = await fetch(entry.path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        blob = await response.blob();
        fetched.set(entry.path, blob);
      }
    }
    const prior = existing
      ? { opacity: existing.opacity ?? 1, visible: existing.visible !== false }
      : null;
    const before = new Set((manager.getLayers?.() || []).map((l) => l.id));
    await manager.importFileList(
      [new File([blob], entry.name, { type: "application/geo+json" })],
      {
        role: "geology",
        name: entry.label,
        /**
         * The geology tab never moves the camera, and that is a rule rather
         * than a default.
         *
         * A dropped file is framed because somebody just chose it and wants to
         * see it. Ticking a tab is not that: it added the geology of wherever
         * you already were, and flying to Northern Ireland because a Northern
         * Irish sheet happens to be one of the defaults is the app deciding
         * where you are looking. The layer row's focus button is how you go to
         * a layer, on purpose, when you want to.
         */
        frame: false,
      },
    );
    const layer = (manager.getLayers?.() || []).find((l) => !before.has(l.id));
    if (!layer) throw new Error("the layer did not arrive");
    // Tagged so this panel can find its own layers again without matching on a
    // name somebody is free to change -- which they now are, from the list.
    layer.geologyDataset = entry.id;
    layer.credit = entry.credit;
    layer.dynamicGeology = entry.dynamic || null;
    // What this layer is a picture OF: the zoom it was built at and the ground
    // it covers. The watcher compares the view against these rather than
    // rebuilding whenever the camera twitches.
    layer.dynamicZoom = loadedFor?.zoom ?? null;
    layer.dynamicBounds = loadedFor?.bounds || null;
    if (existing) manager.removeLayer?.(existing.id);
    if (layer.dynamicGeology) watchView();
    const chosen = styleChoice.get(entry.id);
    if (chosen) {
      await applyField(layer, chosen.field,
        { ramp: chosen.ramp, overrides: chosen.overrides, labels: chosen.labels });
    } else if (entry.sourceColours) {
      await paintFromSource(layer, entry);
    } else {
      applyField(layer, entry.colourBy);
    }
    // Opacity and visibility belong to the layer somebody set them on, and a
    // rebuild replaces that object -- so they are carried across, or every
    // refine quietly turned a half-faded sheet back to solid and a switched-off
    // one back on.
    if (prior) {
      if (Number.isFinite(prior.opacity) && prior.opacity < 1) {
        window.GeoIDLayerHierarchy?.setOpacity?.(layer, prior.opacity);
        layer.opacity = prior.opacity;
      }
      if (prior.visible === false) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);
    }
    publishInteractive();
    say(`${entry.label} — ${(layer.features?.length || 0).toLocaleString()} features.${note} `
      + `${entry.credit}`);
  } catch (error) {
    say(`${entry.label} did not load: ${error.message}`);
  }
  render();
}

/**
 * Paint a layer in the colours its own source chose.
 *
 * A geological map's colours are not decoration and not ours to pick: they
 * encode lithology and age, and every survey in the compilation has already
 * made that decision. Macrostrat ships the colour per polygon, so the layer is
 * painted from `properties.color` and the legend is built by counting which
 * units are actually on screen.
 *
 * That is also why `categoricalSymbology` cannot be used here: it ASSIGNS
 * colours from a ramp and folds everything past twelve classes into one grey
 * "other" — which over a global map is most of the world, painted a colour
 * that means nothing, with a legend that looks right.
 */
async function paintFromSource(layer, entry, { repaint = true } = {}) {
  const { legendFrom } = await import(`./macrostrat.js${new URL(import.meta.url).search}`);
  if (repaint) layer.repaint?.((feature) => feature?.properties?.color || null);
  const field = entry.colourBy || "name";
  const legend = legendFrom(layer.features, { field });
  layer.legendInfo = legend;
  layer.geologyField = field;
  // Marked so the card can say the key is a summary rather than the whole map.
  layer.legendIsSummary = legend.total > legend.shown
    ? `${legend.shown} of ${legend.total} units` : null;
  window.GeoIDLayerHierarchy?.render?.();
  return legend;
}

/**
 * Rebuild the tiled layers for wherever the camera is now.
 *
 * Deliberately a press rather than something that happens as you fly: a
 * rebuild re-triangulates thousands of polygons, and doing that on every
 * settle would stutter the flight it was meant to serve. The imagery refine
 * can be automatic because a texture upload is cheap; this is not.
 */
let refreshing = false;

async function refreshDynamic({ quiet = false } = {}) {
  const live = loadedLayers().filter((l) => l.dynamicGeology);
  if (!live.length) {
    if (!quiet) say("Nothing tiled is loaded — add the world geology first.");
    return;
  }
  if (refreshing) return;
  refreshing = true;
  try {
    for (const layer of live) {
      const entry = entryById(layer.geologyDataset);
      // In place: the same controller, the same layer record, the same object
      // in the scene. Only the tiles in view change.
      if (entry) await loadTiled(entry, { toView: true, quiet });
    }
  } finally {
    refreshing = false;
  }
}

/**
 * A tiled map must follow the view, or it is a world map being read as a local
 * one.
 *
 * This is the fault that made the geology look "jagged and abstract" close in,
 * and it was not the drawing: at zoom 1 the compilation's own generalisation
 * puts a **median 27.6 km between vertices** — a third of the screen at a
 * 100 km scale bar — so units arrive as shards with black ground between them.
 * The same place at zoom 8 has 0.70 km between vertices. Nothing is wrong with
 * the polygons; they are simply the wrong zoom's polygons.
 *
 * So the layer refines the way the imagery does: on REST, never per frame, and
 * only when the view has genuinely changed (`viewChangedEnough`) or the zoom it
 * deserves has. The check is deliberately in that order — a pan inside the
 * loaded ground at the same zoom is not a reason to re-triangulate thousands of
 * polygons, and a rebuild while one is running is refused outright.
 */
let watchStop = null;

function watchView() {
  if (watchStop || typeof window === "undefined") return;
  let lastBounds = null;
  Promise.all([
    import(`./view-extent.js${new URL(import.meta.url).search}`),
    import(`./macrostrat.js${new URL(import.meta.url).search}`),
  ]).then(([view, macro]) => {
    watchStop = view.onViewSettled(window.GeoIDViewer, () => {
      const live = loadedLayers().filter((l) => l.dynamicGeology);
      if (!live.length) {
        stopWatchingView();
        return;
      }
      if (refreshing) return;
      const box = macro.viewBounds();
      if (!box) return;
      const asBounds = {
        minLon: box.west, maxLon: box.east, minLat: box.south, maxLat: box.north,
      };
      const wanted = macro.zoomForBounds(box);
      const built = live[0].dynamicZoom;
      const zoomMoved = built == null || wanted !== built;
      if (!zoomMoved && !view.viewChangedEnough(lastBounds, asBounds)) return;
      lastBounds = asBounds;
      // `loadTiled` reports what it did, including how much came from cache,
      // so the watcher does not write a second line over the top of it.
      void refreshDynamic({ quiet: true });
      // 400 ms: long enough that a drag issues one round of tiles at the end
      // rather than thousands on the way, short enough that letting go and
      // looking does not feel like waiting for permission.
    }, { settleMs: 400 });
  });
}

function stopWatchingView() {
  if (!watchStop) return;
  watchStop();
  watchStop = null;
}

/**
 * Colour a layer by one of its columns.
 *
 * The painting itself now lives in `symbology-dialog.js`, because the dialog's
 * Apply and this auto-paint-on-load were the same twenty lines twice — with the
 * string-versus-[r,g,b] trap in both. What is left here is what is particular
 * to this tab: the status line, and republishing the interactive catalogue,
 * since the card and the legend name the unit the map is coloured by.
 */
async function applyField(layer, field, { ramp = QUALITATIVE_RAMP, overrides = null, labels = null } = {}) {
  if (!layer?.features?.length || !field) return null;
  const { paintByField } = await import(`./symbology-dialog.js${new URL(import.meta.url).search}`);
  const sym = paintByField(layer, field, { ramp, overrides, labels });
  if (!sym.ok) { say(sym.message); return null; }
  publishInteractive();
  return sym;
}


/* ── Into the viewer's own interactive-geology catalogue ─────────────────────
 *
 * Mars and Moon get the whole behaviour -- click a unit, it outlines, a card
 * rises from a pin and tracks the point as the globe turns, the legend lists
 * the units -- from ONE thing: a catalogue at
 * `manifest.geology_interactive.feature_path`. Earth's manifest says
 * `feature_count: 0`, so that machinery has always been on this page and never
 * had anything to read.
 *
 * So rather than reimplementing any of it, the mapped geology is converted into
 * exactly that shape and handed over. Earth then runs the same code path as the
 * other worlds, and a fix to it fixes all eleven.
 *
 * The shape is not guessed: `pointInPolygonFeature` wants
 * `polygons: [{ outer, holes }]` with rings as [lon, lat];
 * `pointWithinFeatureBounds` wants `selection_bounds` with a longitude CENTRE
 * and offsets, because a unit crossing the antimeridian cannot be described by
 * a min and a max; and the popup reads name, rock_type, description and
 * mapped_area_km2.
 */

/** Longitude difference wrapped to -180..180, so an offset is the short way. */
function wrapLon(delta) {
  let d = Number(delta);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function boundsOfRings(rings) {
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonRef = null;
  let offMin = Infinity;
  let offMax = -Infinity;
  rings.forEach((ring) => ring.forEach(([lon, lat]) => {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lonRef === null) lonRef = lon;
    const off = wrapLon(lon - lonRef);
    if (off < offMin) offMin = off;
    if (off > offMax) offMax = off;
  }));
  if (lonRef === null) return null;
  // Re-centre so the offsets straddle the middle rather than the first vertex.
  const centre = lonRef + (offMin + offMax) / 2;
  const half = (offMax - offMin) / 2;
  return {
    lat_min: latMin, lat_max: latMax,
    lon_center: centre, lon_min_offset: -half, lon_max_offset: half,
  };
}

/**
 * A dataset's short name: whatever follows the last dash in its title.
 *
 * The catalogue's labels are "<region> — <part of the record>", so the tail is
 * the part that distinguishes one sheet from another over the same ground —
 * bedrock from superficial — which is exactly what a card listing both needs to
 * key its rows on. A name with no dash keeps its own name.
 */
function datasetLabel(name) {
  const text = String(name || "").trim();
  const tail = text.split(/\s[—–-]\s/).pop().trim() || text;
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "Dataset";
}

/**
 * One layer's features as the viewer's catalogue.
 *
 * `field` is whatever the layer is coloured by, so the unit named in the card
 * is the unit named in the legend -- if they were chosen separately they would
 * disagree the first time somebody recoloured the map.
 */
function toInteractiveCatalogue(layers) {
  const features = {};
  const unitSeen = new Map();
  let n = 0;
  layers.forEach((layer) => {
    const field = layer.geologyField || "lex_d";
    // The colour a unit is PAINTED in, looked up by the value it was painted
    // from. Taking `palette[unitSeen.size]` instead paired the nth unit the
    // scan happened to meet with the nth colour of a palette ordered by feature
    // count -- a key that disagrees with the map it is a key to.
    const paint = new Map((layer.legendInfo?.values || [])
      .map((value, i) => [String(value), `#${String(layer.legendInfo.palette?.[i] || "8a8a8a").replace("#", "")}`]));
    const made = [];
    (layer.features || []).forEach((f) => {
      const geometry = f?.geometry;
      const polys = geometry?.type === "Polygon" ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
      if (!polys.length) return;
      const polygons = polys
        .map((poly) => ({ outer: poly[0], holes: poly.slice(1) }))
        .filter((p) => Array.isArray(p.outer) && p.outer.length >= 3);
      if (!polygons.length) return;
      const props = f.properties || {};
      /**
       * A field of WHITESPACE is a field with nothing in it.
       *
       * `props.rcs_d || props.rock_d` looks like it handles a missing value and
       * does not: **200 of the 801 superficial polygons carry rcs_d as a single
       * space**, and a space is truthy. Those became a card whose title, meta
       * and copy were all one space -- an empty box, which is indistinguishable
       * from a click that did nothing. ALLUVIUM is the biggest group of them, so
       * every river valley on the sheet opened blank.
       *
       * Everything read off a feature goes through here, and `null` means the
       * card falls back to the next thing it knows: the unit name.
       */
      const val = (...candidates) => {
        for (const c of candidates) {
          const text = String(c ?? "").trim();
          if (text) return text;
        }
        return null;
      };
      const name = val(props[field], props.lex_d, props.rcs_d) || "Unit";
      let km2 = 0;
      polygons.forEach((p) => {
        km2 += sphericalPolygonAreaKm2(p.outer.map(([lon, lat]) => ({ lat, lon })));
      });
      n += 1;
      made.push({
        id: `geo-${layer.id}-${n}`,
        name,
        type: "Geologic unit polygon",
        unit: val(props.lex, props.map_code),
        // The card's meta line is "description · name", and with the lithology
        // blank both halves came from the same column: "ALLUVIUM  ·  ALLUVIUM".
        unit_description: val(props.lex_d) === name ? null : val(props.lex_d),
        rock_type: val(props.rcs_d, props.rock_d),
        rock_type_detail: val(props.lex_rcs_d),
        description: val(props.rcs_d, props.bgstype),
        origin: val(layer.credit, layer.name),
        dimension: val(props.max_period) && val(props.min_period)
          ? (props.max_period === props.min_period ? val(props.max_period)
            : `${val(props.min_period)} – ${val(props.max_period)}`)
          : null,
        mapped_area_km2: km2 > 0 ? Number(km2.toFixed(1)) : null,
        polygons,
        selection_bounds: boundsOfRings(polygons.map((p) => p.outer)),
        source_layer: layer.name,
        // What to CALL this dataset in a card that names several of them.
        // "Northern Ireland — superficial" is the layer's name and too long to
        // be a key beside a rock type; "Superficial" is what the row is about.
        dataset_label: datasetLabel(layer.name),
      });
      if (!unitSeen.has(name)) {
        unitSeen.set(name, paint.get(String(props[field])) || "#8a8a8a");
      }
    });
    // Smallest first WITHIN the layer, so a polygon lying inside a larger one
    // is still reachable: the pick takes the first feature that contains the
    // point, and a big unit listed ahead of an inlier answers for it forever.
    made.sort((a, b) => (a.mapped_area_km2 || 0) - (b.mapped_area_km2 || 0));
    made.forEach((feature) => { features[feature.id] = feature; });
  });
  return {
    features,
    featureList: Object.values(features),
    unit_legend: [...unitSeen.entries()].map(([label, colour]) => ({ label, colour })),
    rock_legend: [],
  };
}

/**
 * Visibility goes through the layer hierarchy, never straight onto the layer.
 *
 * It is the single writer: it sets the flag and the object, redraws the rows
 * and the legend, and announces the change so this panel and the clickable
 * geology follow. The direct write is only for a page where the hierarchy has
 * not loaded, so a tick box still does something.
 */
function setLayerVisible(layer, visible) {
  const hierarchy = window.GeoIDLayerHierarchy;
  if (hierarchy?.setVisible) { hierarchy.setVisible(layer, visible); return; }
  layer.visible = visible;
  if (layer.object3D) layer.object3D.visible = visible;
  render();
  publishInteractive();
}

/**
 * Push whatever mapped geology is loaded into the viewer's own click path.
 *
 * **Order is the whole behaviour.** `getGeologyFeatureAtLatLon` takes the FIRST
 * feature in the list that contains the point, so the list decides which unit a
 * click reports and, for anything underneath it, whether it can be clicked at
 * all. Handed over in layer order, bedrock (id 1) came before superficial
 * (id 2) and won every click -- measured: **793 of 1,559 features, the entire
 * superficial sheet, could not be reached by any click**, and every click over
 * superficial cover named the bedrock beneath it instead of the unit painted on
 * screen.
 *
 * So the list is built top of the draw stack first, which is the layer you are
 * looking at. `renderOrder` is what `applyStack` writes, so this follows the
 * layer list rather than keeping a second idea of which layer is on top.
 * Hiding the top layer both un-draws it and takes it out of here, so the one
 * underneath answers again -- switching superficial off is how you click
 * bedrock everywhere, exactly as in any GIS.
 */
function publishInteractive() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.setGeologyInteractive) return false;
  const layers = loadedLayers().filter((l) => l.visible !== false && l.features?.length)
    .sort((a, b) => (b.object3D?.renderOrder || 0) - (a.object3D?.renderOrder || 0));
  if (!layers.length) return viewer.setGeologyInteractive(null);
  return viewer.setGeologyInteractive(toInteractiveCatalogue(layers));
}

/* ── The symbology dialog ────────────────────────────────────────────────── */

/**
 * Open the shared symbology window on a geology layer.
 *
 * This dialog started here and has moved to `symbology-dialog.js`, unchanged in
 * shape and now open to every layer on the page rather than to the ones this
 * tab loaded. What stays behind is the part that is only true here: a tiled
 * geology layer is REBUILT whenever the view settles, and a rebuild is a new
 * layer object, so the choice is remembered against the dataset id and reapplied
 * to whatever object comes back.
 */
function openSymbology(layer) {
  return openSymbologyDialog(layer, {
    status: say,
    onApplied: (painted, result) => {
      // Only a CLASSED result is a style choice to remember; one flat colour
      // has no field to reapply to the layer a rebuild puts in its place.
      if (painted.geologyDataset && result.kind === "vector" && result.field) {
        styleChoice.set(painted.geologyDataset, {
          field: result.field,
          ramp: result.ramp,
          overrides: result.overrides,
          labels: result.labels,
        });
      }
      publishInteractive();
      render();
    },
  });
}

/* ── Rendering the panel ─────────────────────────────────────────────────── */

function render() {
  if (!nodes?.loaded) return;
  const layers = loadedLayers();
  nodes.loaded.replaceChildren();
  layers.forEach((layer) => {
    const box = document.createElement("div");
    box.className = "gis-geo-layer";
    const row = document.createElement("div");
    row.className = "gis-geo-layer-head";
    const eye = document.createElement("input");
    eye.type = "checkbox";
    eye.checked = layer.visible !== false;
    eye.title = "Visible";
    // Through the hierarchy, which is the one writer -- it sets the state,
    // redraws the rows and the legend, and announces the change, which brings
    // this list and the clickable geology back in step. Writing the flag here
    // as well is what let the surfaces drift apart.
    eye.addEventListener("change", () => { setLayerVisible(layer, eye.checked); });
    const name = document.createElement("span");
    name.className = "gis-geo-layer-name";
    name.textContent = layer.name;
    name.title = layer.credit || layer.name;
    const sym = document.createElement("button");
    sym.type = "button";
    sym.className = "button secondary";
    sym.textContent = "Symbology…";
    sym.style.fontSize = "0.6rem";
    sym.addEventListener("click", () => openSymbology(layer));
    row.append(eye, name, sym);

    const by = document.createElement("div");
    by.className = "gis-geo-layer-by";
    // A source-coloured layer's key lists the commonest units rather than all
    // of them, so the card says which it is: "12 of 91" is a summary, and
    // reading it as the whole map is how a global sheet gets misread.
    by.textContent = layer.geologyField
      ? `Coloured by ${layer.geologyField} · `
        + (layer.legendIsSummary || `${layer.legendInfo?.labels?.length || 0} units`)
      : "Not coloured yet — open Symbology.";

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.className = "gis-geo-opacity";
    opacity.min = "0";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(layer.opacity ?? 1);
    opacity.title = "Opacity";
    opacity.addEventListener("input", () => {
      const value = Number(opacity.value);
      layer.opacity = value;
      // Through the hierarchy where it exists, so the list's own slider and
      // this one cannot disagree; the direct traverse is the fallback.
      if (window.GeoIDLayerHierarchy?.setOpacity) {
        window.GeoIDLayerHierarchy.setOpacity(layer, value);
        return;
      }
      layer.object3D?.traverse?.((n) => {
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        materials.forEach((m) => {
          if (!m) return;
          // Switched on when needed and never off again -- see setOpacity in
          // layer-hierarchy.js. Turning blending off at full opacity moves the
          // layer into the opaque pass, which is drawn before every transparent
          // layer whatever the stack says, so the sheet underneath paints over
          // it and the layer looks like it vanished.
          if (value < 1) m.transparent = true;
          m.opacity = value;
          m.needsUpdate = true;
        });
      });
    });

    box.append(row, by, opacity);
    nodes.loaded.appendChild(box);
  });
}

/**
 * The datasets a fresh page opens with.
 *
 * Sequential rather than parallel, and each one skipped if it is already there,
 * so this is safe to call again and cannot double-load on a re-init.
 */
async function loadDefaults() {
  if (GLOBAL_BASE) await loadDataset(GLOBAL_BASE);
  for (const entry of forThisBody().filter((d) => d.default)) {
    if (!window.GeoIDViewer) return;
    await loadDataset(entry);
  }
}

/** Is any mapped-geology layer loaded and showing? The tab's tick box asks. */
export function isActive() {
  return loadedLayers().some((l) => l.visible !== false);
}

/**
 * Turn the mapped geology on or off.
 *
 * Loading is done once and then kept: unticking hides rather than removes, so
 * re-ticking does not re-fetch and re-parse 2.8 MB, and any symbology, renamed
 * units and hand-picked colours survive being switched off.
 */
/**
 * Did WE stop the globe, or was it already stopped?
 *
 * Only what this tab paused may this tab restart. Someone who froze the planet
 * with the corner button or the space bar, then looked at the geology, would
 * otherwise have it start turning again when they put the geology away.
 */
let pausedSpinForGeology = false;

/**
 * Reading a map is not something you do on a moving planet.
 *
 * The globe turns at 3 degrees a second -- 193 km of ground a second at
 * Northern Ireland's latitude -- so a unit you are looking at crosses the
 * screen while you read its card, and a polygon you meant to click has moved by
 * the time you click it. Switching the geology on is a statement that the map
 * is the thing being used, so the spin stops; switching it off gives it back.
 *
 * Through the viewer's own `setSpinPaused`, which is the one thing that stops
 * the rotation and which keeps the corner button in step -- rather than
 * freezing the globe here and leaving that button claiming it still turns.
 */
function holdGlobeStill(on) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.setSpinPaused) return;
  if (on) {
    if (viewer.isSpinPaused?.()) return;      // already still, and not ours to resume
    viewer.setSpinPaused(true);
    pausedSpinForGeology = true;
    return;
  }
  if (!pausedSpinForGeology) return;
  pausedSpinForGeology = false;
  viewer.setSpinPaused(false);
}

/**
 * Turning the tab off REMOVES its layers, rather than leaving them unticked.
 *
 * Hiding them was the cheaper answer -- the parse is paid once and the second
 * tick is instant -- but it left the sheets sitting in the layer list, in the
 * metadata and in the stack, belonging to a tab that says it is off. The list
 * is what is on the globe; a row for something the tab has put away is a claim
 * nobody made.
 *
 * The download is still paid once (see `fetched`), so ticking it again is a
 * rebuild rather than a round trip.
 */
async function setActive(on) {
  if (on) {
    if (!loadedLayers().length) {
      say("Loading mapped geology…");
      await loadDefaults();
    } else {
      loadedLayers().forEach((layer) => { setLayerVisible(layer, true); });
    }
  } else {
    const manager = window.GeoIDImportManager;
    loadedLayers().forEach((layer) => {
      // A tiled layer holds GPU buffers for every tile it has built, and
      // removing the record does not free them.
      layer.tiled?.dispose?.();
      manager?.removeLayer?.(layer.id);
    });
    stopWatchingView();
  }
  holdGlobeStill(on);
  render();
  publishInteractive();
  if (!on) say("Mapped geology put away — tick the box to bring it back.");
}

export function init() {
  /**
   * One tick, in the tab's own "Geology" subsection.
   *
   * The panel used to be a dropdown, an "Add to globe" button and a manual
   * "Refresh for this view" — three controls for a layer whose whole design
   * is that it needs none of them: the Macrostrat base is TILED, so it loads
   * whole on tick, refines itself when the view settles, and unloads on
   * untick. The dropdown's other entries have their own homes now (the
   * Macrostrat contacts-and-faults line layer is a row in the Tectonics
   * subsection; the NI sheets load by id from the NI prototype tab), so what
   * remained here was a list of one — and a list of one is a tick box.
   */
  const host = document.getElementById("geology-world-body");
  if (!host || document.getElementById("gis-geology-panel")) return false;
  installStyle();

  panel = document.createElement("div");
  panel.id = "gis-geology-panel";

  const row = document.createElement("div");
  row.className = "gis-catalogue-row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.id = "gis-cat-macrostrat-units";
  const name = document.createElement("label");
  name.className = "gis-catalogue-name";
  name.htmlFor = tick.id;
  name.textContent = GLOBAL_BASE?.label || "World geology";
  if (GLOBAL_BASE?.credit) name.title = GLOBAL_BASE.credit;
  row.append(tick, name);

  const base = document.createElement("div");
  base.className = "gis-geo-base";
  base.textContent = GLOBAL_BASE
    ? "Tiled, so it follows the view by itself: the world when you are looking "
      + "at the world, one survey's detail when you fly in. Click a polygon to "
      + "read what it is."
    : `No mapped geology for ${currentBodyId()} yet.`;

  const loaded = document.createElement("div");
  loaded.id = "gis-geology-loaded";
  const status = document.createElement("div");
  status.id = "gis-geology-status";

  panel.append(row, base, loaded, status);
  host.appendChild(panel);
  nodes = { loaded, status };

  window.GeoIDImportManager?.onChange?.(render);
  render();

  /**
   * Whoever switched a layer, this panel follows it.
   *
   * The clickable catalogue is filtered by visibility, so a sheet switched off
   * in the layer list went on answering clicks until something else happened to
   * republish it -- the map said one thing and the popup another. Both tick
   * boxes — the tab header's and the subsection's — are the same state:
   * `isActive()` is "any mapped geology still showing", so switching the last
   * sheet off anywhere clears them.
   */
  const master = document.getElementById("geology-master-toggle");
  /**
   * The two boxes answer two different questions.
   *
   * The subsection tick is "is the WORLD GEOLOGY on the globe" — it loads and
   * unloads only the Macrostrat units layer, because unticking it must not
   * take the contacts-and-faults layer out of the Tectonics list where
   * somebody else put it on. The header box is the tab's master switch and
   * keeps its all-mapped-geology meaning.
   */
  const unitsLayer = () => loadedLayers().find((l) => l.geologyDataset === GLOBAL_BASE?.id);
  const syncTicks = () => {
    const units = unitsLayer();
    tick.checked = Boolean(units && units.visible !== false);
    if (master) master.checked = isActive();
  };
  window.addEventListener("geoid-gis:layers-changed", (event) => {
    if (event.detail?.reason !== "visibility") return;
    render();
    publishInteractive();
    syncTicks();
  });

  tick.addEventListener("change", async () => {
    if (tick.checked) {
      if (!GLOBAL_BASE) return;
      say("Loading mapped geology…");
      await loadDataset(GLOBAL_BASE);
      holdGlobeStill(true);
    } else {
      const layer = unitsLayer();
      // A tiled layer holds GPU buffers for every tile it has built, and
      // removing the record does not free them.
      layer?.tiled?.dispose?.();
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
      if (!loadedLayers().length) stopWatchingView();
      say("World geology put away — tick the box to bring it back.");
    }
    render();
    publishInteractive();
    syncTicks();
  });
  master?.addEventListener("change", async () => {
    await setActive(master.checked);
    syncTicks();
  });
  if (master?.checked) void setActive(true).then(syncTicks);
  return true;
}

if (typeof document !== "undefined") {
  // The section arrives with the markup on Earth and with the shell on a planet
  // page, and toolbox.js moves it afterwards -- so this retries rather than
  // assuming a moment, the same shape side-panels.js uses.
  let tries = 0;
  const attempt = () => {
    if (init() || (tries += 1) > 60) return;
    setTimeout(attempt, 400);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}

if (typeof window !== "undefined") {
  window.GeoIDGeology = {
    init, render, openSymbology, applyField,
    catalogue: () => CATALOGUE.map((c) => c.id),
    publishInteractive,
    toInteractiveCatalogue,
    loadDefaults,
    isActive,
    setActive,
    globalBase: () => GLOBAL_BASE,
    load: (id) => { const e = entryById(id); return e ? loadDataset(e) : null; },
  };
}
