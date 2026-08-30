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
      const asked = macro.zoomForBounds(refineBox(box, entry.mask) || entry.mask);
      const wanted = Number.isFinite(entry.ceiling) ? Math.min(asked, entry.ceiling) : asked;
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
  /**
   * THE REFINE MAY NOT GO DEEPER THAN THE LEVEL THE CLIMB VETTED.
   *
   * `featuresIn` gates its climb on coverage and refuses a level that has lost
   * a survey. `refine` did neither — it asked `zoomForBounds` and called
   * `update` — so a clip pinned at the vetted zoom 7 was walked to zoom 11 by
   * the first settle, and at 11 the offshore survey does not exist. Measured
   * on a 34 km study area: the strip north of the coast is covered 100% at
   * zooms 4 to 8 and **0% at 9 and deeper**, and the layer arrived pinned at 7
   * and refined itself to 11, which is why the picture went bare again after
   * it had been right.
   *
   * `ceiling` is the level the climb chose, coverage gate and all. Refining
   * within it is free; past it is the map losing datasets to buy detail it was
   * never asked for.
   */
  const wanted = macro.zoomForBounds(box);
  const zoom = Number.isFinite(entry.ceiling) ? Math.min(wanted, entry.ceiling) : wanted;
  if (zoom === entry.zoom) return;
  entry.busy = true;
  try {
    /**
     * The feature budget is the WORLD layer's protection, and it is wrong here.
     *
     * `chooseZoom` extrapolates the feature count 2x per level past the baked
     * ceiling. Over a whole hemisphere that is the difference between a refine
     * and a frozen second — measured in this file's history at 49,150 features
     * and twenty seconds. Over a STUDY AREA it is nonsense: measured on a
     * 1.0 x 0.6 degree clip, `update` was asked for zoom 12, walked itself down
     * to **9**, and the ground it was refusing holds **277 features**. A
     * hundredfold over-prediction, and the reason a clip would not sharpen.
     *
     * What actually bounds the work is the TILE CAP, which still applies: at
     * most `maxTiles` tiles, which is exactly what the world layer triangulates
     * on any refine. A clip cannot run away because its mask does not let it —
     * that is the whole difference between the two, and it is why the estimate
     * built for one is not owed to the other.
     *
     * `minZoom` is the pinned base, so a refine can only ever sharpen. Without
     * it the same walk-down took a clip pinned at 10 down to 9 — coarser than
     * the sheet it was drawn on.
     */
    const got = await entry.controller.update({
      bounds: box, zoom, featureBudget: Infinity, minZoom: entry.baseZoom,
    });
    // The ACHIEVED level, not the asked one: `chooseZoom` walks down for the
    // feature budget and the tile cap, and recording the ask would make the
    // next settle believe it had already arrived there and skip the work.
    entry.zoom = Number.isFinite(got?.zoom) ? got.zoom : zoom;
    /**
     * The DRAWN map refines; the layer's FEATURE LIST does not shrink to the
     * view, and the difference matters.
     *
     * `features()` answers the finest zoom on screen, which is right for the
     * world layer — an extraction must never count the same ground twice. For
     * a clip it is wrong in a way that loses data silently: measured, flying
     * to 12 km took the layer's list from 277 features to **39**, the 39 being
     * the corner in shot, and the legend said "39 polygons". Exporting at that
     * moment would have written a study area with most of itself missing.
     *
     * A clip IS its study area. The list stays the complete area at the pinned
     * level, and anything that wants finer data for a particular box asks
     * `featuresIn`, which is the seam every tool already uses for exactly this.
     */
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
/**
 * The surveys the pinned level does NOT carry.
 *
 * `featuresIn` merges each survey from its own deepest level, so the merged
 * list spans levels by construction while the controller only ever draws one
 * level's tiles. Everything the tiles will not draw is returned here, to be
 * drawn once as a static mesh underneath them.
 */
function fillInSurveys(merged, own, keyOf) {
  const drawn = new Set((own || []).map(keyOf));
  return (merged || []).filter((f) => !drawn.has(keyOf(f)));
}

export async function createStreamingClip({ source, mask, name, contacts = null }) {
  const controllerOf = source?.tiled;
  if (!controllerOf?.sources || typeof controllerOf.update !== "function") return null;
  const maskFc = mask?.collection || mask;
  const bounds = boundsOfCollection(maskFc);
  if (!bounds) return null;

  /**
   * The clip wears the SOURCE'S contacts, resolved once.
   *
   * `controllerOf.getContacts?.()` used to be silently undefined — the
   * controller never published it — so every clipped layer fell back to the
   * invisible "match" seal. The world geology drew its unit boundaries and the
   * clip of it drew none, which is exactly the difference reported: the clip
   * should behave like the layer it came from.
   */
  const contactStyle = contacts || controllerOf.getContacts?.() || null;

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
    contacts: contactStyle,
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
  const probe = await controller.featuresIn(bounds);
  /**
   * PIN THE DEEP LEVEL. Detail is not the thing to trade away.
   *
   * A previous version pinned the fullest-COVERING level and capped the refine
   * there, so a clip that had been drawing zoom 11 polygons fell back to zoom
   * 8 — flat blocks with straight edges where there had been real boundaries.
   * That bought coverage with detail, and the whole point of the fill-in mesh
   * below is that neither has to be bought with the other: the TILES carry the
   * finest level, and the surveys that level does not have are drawn beneath
   * it from their own best level.
   */
  const baseZoom = Number.isFinite(probe.zoom) ? probe.zoom : zoom;
  await controller.pin({ bounds, zoom: baseZoom });

  /**
   * DRAW THE FILLED-IN SURVEYS. The merge is a LIST; the controller draws
   * TILES.
   *
   * `featuresIn` fills each survey from its own deepest level and concatenates
   * the result — but those features belong to another level's tiles, and the
   * controller only ever shows one level's. So the merged surveys were in the
   * layer's feature list, in its legend and in every extraction, and were
   * NEVER RENDERED. Measured by reading the framebuffer over a 34 km study
   * area: the geometry said 100% coverage and the PIXELS said **41.2%**, with
   * the northern 40% of the box bare — while 13 of the layer's features
   * touched exactly that ground.
   *
   * No amount of choosing a better single level can fix that, because the
   * merged set spans levels by construction. What the tiles cannot draw is
   * drawn here instead: one static mesh for the surveys the pinned level does
   * not carry, under the tiles, refined by nothing because a coarse survey has
   * nothing finer to refine to.
   */
  const own = await controller.featuresIn(bounds, { zoom: baseZoom });
  const fillIn = fillInSurveys(probe.features, own.features, tiles.sourceKey);
  if (fillIn.length) {
    const render = await import(`./vector-render.js${stamp}`);
    const built = render.renderFeatureCollection(
      { type: "FeatureCollection", features: fillIn },
      {
        name: `${name} — other surveys`,
        colourFor: source.sourceColourField
          ? (f) => f?.properties?.[source.sourceColourField] || null
          : null,
        contacts: contactStyle,
      },
    );
    if (built?.object3D) {
      // Under the tiles: where a tiled survey has this ground, its own finer
      // polygons should be what shows.
      built.object3D.renderOrder = -1;
      built.object3D.userData.geoidFillIn = true;
      controller.group.add(built.object3D);
    }
  }

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

  /**
   * The clip wears the SOURCE'S OWN key, or it is a different map of the same
   * ground.
   *
   * `colourFor` at construction paints the tiles, and that is not enough on its
   * own: a derived layer arriving in the workspace is given the default
   * `categoricalSymbology` — twelve classes by feature count and one grey
   * "(other)" for the rest — which overwrites the source colours and answers
   * with a legend of its own. Reported with the two cards side by side: the
   * world layer keyed by name with its published swatches, and the clip of it
   * showing a bare gradient bar over a sheet gone grey.
   *
   * The static clip path in `tool-runner` already does this through
   * `inheritSourceColours`; the streaming path was built without it. Same
   * `legendFrom`, same colour column, so the two cards are the same key by
   * construction rather than by two functions agreeing.
   */
  /**
   * The marker is the FIRST answer, not the only one.
   *
   * `sourceColourField` is set by `paintFromSource`, and a source that was
   * last painted some other way — a field chosen in the symbology dialog, a
   * catalogue palette, a rebuild that ran `applyField` because `styleChoice`
   * remembered a hand-picked column — carries no marker at all. The clip then
   * inherited nothing, got no `legendInfo`, and the dock drew the bare
   * gradient bar that stands in for a layer with no symbology.
   *
   * So the column is PROBED when the marker is missing: if every feature
   * carries a `color`, that is the source's own key whether or not anything
   * wrote the marker down. Failing open into "no legend" is the wrong
   * direction for a card whose whole job is to say what the colours mean.
   */
  const colourField = source.sourceColourField
    || (fc.features.length && fc.features.every((f) => f?.properties?.color) ? "color" : null);
  if (colourField) {
    const labelField = source.sourceLabelField || source.geologyField || "name";
    controller.repaint((f) => f?.properties?.[colourField] || null);
    const legend = macro.legendFrom(fc.features, { field: labelField, colourField });
    if (legend.shown) {
      layer.legendInfo = legend;
      layer.geologyField = labelField;
      layer.legendIsSummary = legend.total > legend.shown
        ? `${legend.shown} of ${legend.total} units` : null;
    }
  }

  layer.tiled = controller;
  layer.clipMask = maskFc;
  layer.streamingClip = true;
  layer.dynamicZoom = baseZoom;
  layer.credit = source.credit || null;
  // Carried so the derived layer keeps the source's own colours and so a clip
  // OF this clip inherits them again.
  layer.sourceColourField = colourField;
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

  live.set(layer.id, { layer, controller, mask: bounds, zoom: baseZoom, baseZoom,
    /**
     * The climb's own choice, coverage gate and all. NOT the deepest
     * fully-covering level: capping there cost the map its detail, and the
     * fill-in mesh is what keeps the coverage instead.
     */
    ceiling: baseZoom, busy: false });
  void watch();
  return { layer, zoom: baseZoom, features: fc.features.length };
}

/** Exported for the tests: the box a refine would ask for. */
export const __fillInSurveys = fillInSurveys;
export const __refineBox = refineBox;
export const __boundsOfCollection = boundsOfCollection;
