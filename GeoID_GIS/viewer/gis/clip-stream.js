/**
 * A CLIPPED geology layer that streams and refines like the map it came from.
 *
 * The clip tool used to hand back a SNAPSHOT: whatever features were in hand
 * when it ran, triangulated once and never touched again. The world geology
 * beside it refines on every settle, so flying in left the two disagreeing —
 * the source sharpening while the clip of it stayed at the level it was born
 * at, which is exactly the report: "it fails to refine itself as we zoom in".
 *
 * The fix is not a second refresh path. It is to give the clip its OWN tiled
 * controller, pointed at the SAME tile service, carrying the study area as a
 * mask — so the tile cache, the zoom choice, the feature budget, the contacts,
 * the seam clipping and the refine are all one implementation used twice. A
 * second implementation drifts from the first the day either is fixed, which
 * this tree has paid for in the label engine and the polygon-area formula.
 *
 * What is deliberately NOT shared is the world layer's own watcher: that one
 * refreshes by dataset id through `loadTiled`, which would rebuild a clip as a
 * world map. This module keeps its own settle watcher over its own layers.
 */

const stamp = new URL(import.meta.url).search;

/** Layers this module is refining, by layer id. */
const live = new Map();
let watchStop = null;
let lastBounds = null;

const boundsOfCollection = (fc) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      if (coords[0] < west) west = coords[0];
      if (coords[0] > east) east = coords[0];
      if (coords[1] < south) south = coords[1];
      if (coords[1] > north) north = coords[1];
      return;
    }
    coords.forEach(walk);
  };
  (fc?.features || []).forEach((f) => { if (f?.geometry?.coordinates) walk(f.geometry.coordinates); });
  return Number.isFinite(west) ? { west, south, east, north } : null;
};

/**
 * The ground a refine should cover: the view, cut to the study area.
 *
 * Never the view alone — a clip is ABOUT its study area, and streaming tiles
 * for ground outside it would fetch what the mask is about to throw away. And
 * never the study area alone either, or flying into one corner of a large area
 * would ask for the whole thing at the corner's zoom.
 */
function refineBox(view, mask) {
  if (!view) return mask;
  const west = Math.max(view.west, mask.west);
  const east = Math.min(view.east, mask.east);
  const south = Math.max(view.south, mask.south);
  const north = Math.min(view.north, mask.north);
  // The view has left the study area entirely: keep whatever is drawn rather
  // than fetching an empty box.
  if (!(east > west && north > south)) return null;
  return { west, south, east, north };
}

async function watch() {
  if (watchStop || typeof window === "undefined") return;
  const [view, macro] = await Promise.all([
    import(`./view-extent.js${stamp}`),
    import(`./macrostrat.js${stamp}`),
  ]);
  watchStop = view.onViewSettled(window.GeoIDViewer, () => {
    if (!live.size) { stopWatching(); return; }
    const seen = window.GeoIDImportManager?.getLayers?.() || [];
    // A layer somebody removed stops being refined, and when the last one goes
    // so does the watcher -- the same self-ending rule the world layer's own
    // watcher follows.
    for (const id of [...live.keys()]) {
      if (!seen.some((l) => l.id === id)) live.delete(id);
    }
    if (!live.size) { stopWatching(); return; }
    const box = macro.viewBounds();
    if (!box) return;
    const asBounds = { minLon: box.west, maxLon: box.east, minLat: box.south, maxLat: box.north };
    let moved = view.viewChangedEnough(lastBounds, asBounds);
    for (const entry of live.values()) {
      const wanted = macro.zoomForBounds(refineBox(box, entry.mask) || entry.mask);
      if (wanted !== entry.zoom) moved = true;
    }
    if (!moved) return;
    lastBounds = asBounds;
    for (const entry of live.values()) void refine(entry, box, macro);
    // Same 400 ms the world layer settles on: long enough that a drag issues
    // one round of tiles at the end rather than thousands on the way.
  }, { settleMs: 400 });
}

function stopWatching() {
  if (!watchStop) return;
  watchStop();
  watchStop = null;
  lastBounds = null;
}

async function refine(entry, viewBox, macro) {
  if (entry.busy) return;
  const box = refineBox(viewBox, entry.mask);
  if (!box) return;
  const zoom = macro.zoomForBounds(box);
  if (zoom === entry.zoom) return;
  entry.busy = true;
  try {
    const got = await entry.controller.update({ bounds: box, zoom });
    // The ACHIEVED level, not the asked one: `chooseZoom` walks down for the
    // feature budget and the tile cap, and recording the ask would make the
    // next settle believe it had already arrived there and skip the work.
    entry.zoom = Number.isFinite(got?.zoom) ? got.zoom : zoom;
    // The layer's own record has to follow, or everything downstream -- the
    // click picker, an extraction, the legend count -- is reading the level
    // this layer was BORN at rather than the one it is drawing.
    const fc = { type: "FeatureCollection", features: entry.controller.features() };
    entry.layer.features = fc.features;
    entry.layer.collection = fc;
    entry.layer.dynamicZoom = entry.zoom;
    window.GeoIDLayerHierarchy?.render?.();
  } catch (error) {
    // A refine that fails leaves the layer exactly as it was drawn.
  } finally {
    entry.busy = false;
  }
}

/**
 * Build a clipped layer that streams from `source`'s own tile service.
 *
 * Returns null when the source is not a tiled layer or the mask is not
 * polygons — the caller then takes the ordinary static path, which is the
 * right answer for clipping a shapefile by a box.
 */
export async function createStreamingClip({ source, mask, name, contacts = null }) {
  const controllerOf = source?.tiled;
  if (!controllerOf?.sources || typeof controllerOf.update !== "function") return null;
  const maskFc = mask?.collection || mask;
  const bounds = boundsOfCollection(maskFc);
  if (!bounds) return null;

  const tiles = await import(`./vector-tiles.js${stamp}`);
  const controller = tiles.createTiledVectorLayer({
    name,
    kind: source.geologyDataset ? "units" : "units",
    sources: controllerOf.sources,
    // The source's own paint, so a clip of a source-coloured map is
    // source-coloured from its first frame rather than after a repaint.
    colourFor: source.sourceColourField
      ? (f) => f?.properties?.[source.sourceColourField] || null
      : null,
    contacts: contacts || controllerOf.getContacts?.() || null,
    clipTo: maskFc,
  });

  const macro = await import(`./macrostrat.js${stamp}`);
  const zoom = macro.zoomForBounds(bounds);
  /**
   * PIN the study area, exactly as the world layer pins the world.
   *
   * `features()` and the drawn set are the FINEST zoom on screen, so a refine
   * that only fetched the view would leave the rest of the study area with
   * nothing drawn — zoom into one corner and the other three empty out.
   * Measured before this: refining a 1.0 x 0.6 degree clip at 60 km took it
   * from 229 features to 127, and the 127 were the corner in shot.
   *
   * The world layer's own note says it in one line: the world is PINNED under
   * the view, or the planet has an empty half. For a clip the study area is
   * the world. The pinned level stays drawn and the view's own tiles draw half
   * a renderOrder above it, which is machinery this controller already has.
   */
  await controller.pin({ bounds, zoom });

  const fc = { type: "FeatureCollection", features: controller.features() };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, {
    object3D: controller.group,
    features: fc.features,
    collection: fc,
    bounds: { minX: bounds.west, minY: bounds.south, maxX: bounds.east, maxY: bounds.north },
    georeferenced: true,
    repaint: (fn) => controller.repaint(fn),
  }, "geology");
  if (!layer) { controller.dispose(); return null; }

  layer.tiled = controller;
  layer.clipMask = maskFc;
  layer.streamingClip = true;
  layer.dynamicZoom = zoom;
  layer.credit = source.credit || null;
  // Carried so the derived layer keeps the source's own colours and so a clip
  // OF this clip inherits them again.
  layer.sourceColourField = source.sourceColourField || null;
  layer.sourceLabelField = source.sourceLabelField || null;
  // The seam every consumer that asks about GROUND uses. A clipped stream can
  // answer it exactly as the world layer does, and the mask rides along.
  layer.featuresIn = async (box, opts = {}) => {
    const b = box?.west !== undefined ? box : {
      west: box.minX, south: box.minY, east: box.maxX, north: box.maxY,
    };
    const got = await controller.featuresIn(refineBox(b, bounds) || bounds, opts);
    const out = { type: "FeatureCollection", features: got.features };
    layer.collection = out;
    layer.features = got.features;
    layer.lastFetch = { zoom: got.zoom, tiles: got.tiles, features: got.features.length };
    return out;
  };
  layer.liveCollection = () => ({ type: "FeatureCollection", features: controller.features() });
  layer.restoreLive = () => {
    const out = layer.liveCollection();
    layer.collection = out;
    layer.features = out.features;
    return out;
  };
  layer.onRemove = () => { live.delete(layer.id); controller.dispose(); };

  live.set(layer.id, { layer, controller, mask: bounds, zoom, busy: false });
  void watch();
  return { layer, zoom, features: fc.features.length };
}

/** Exported for the tests: the box a refine would ask for. */
export const __refineBox = refineBox;
export const __boundsOfCollection = boundsOfCollection;
