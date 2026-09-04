/**
 * Which band a layer draws in — the pure half of the draw order.
 *
 * Its own module because it is a CLASSIFICATION and nothing else: no DOM, no
 * scene, no state. layer-hierarchy.js applies it (`applyStack` turns a band
 * and a hand order into renderOrder); this decides what the band is, and
 * draw-order.test.mjs can therefore check the rule without booting a panel.
 */
const IMAGERY_EXT = new Set(["tiles", "gee"]);

/**
 * A fourth band, for things that are being READ rather than mapped — and it is
 * a DEFAULT, not a rule.
 *
 * Event markers are the case: they are what you switched the feed on to look
 * at, so a geological map loaded afterwards must not bury them, and a layer
 * that has to be dug out from under something is not "visible when active".
 * But pinning them there for good takes the layer box's one job away from the
 * user, who asked to be able to swap them.
 *
 * **So every band is a default, and dragging a row overrides it.** That had to
 * be true of all four, not just this one: the first attempt marked the layer
 * as hand-moved and let it fall back to the ordinary band, which was still
 * band 2 — above geology's band 1 — so pressing Down on the events row with
 * only a geological map beneath it moved nothing and looked broken. A layer
 * that is dragged past another one **takes that one's band**, so it lands
 * exactly where it was dropped and stays there. Nothing is unreachable and
 * nothing has to be dragged twice.
 */
const ON_TOP_EXT = new Set(["events"]);

/**
 * A FIFTH band, above even the feeds: the shapes the user drew.
 *
 * A study area is not a dataset, it is the QUESTION being asked of the
 * datasets — the boundary every extraction, clip and zonal statistic in this
 * app is scoped to. It sat in band 2 with every ordinary import, so it was
 * above whatever had been loaded before it and under everything loaded after:
 * measured, a captured study area at renderOrder 54 and a DEM mapped a moment
 * later at 55, and because a drape does not depth-test it paints straight over
 * the outline rather than fighting it. Drawing a boundary and then mapping the
 * data inside it is the ordinary order of work, so the ordinary order of work
 * was hiding the boundary every time.
 *
 * It stays a DEFAULT, like the other four: `bandOverride` still wins, so a row
 * dragged below something lands where it was dropped. Nothing is unreachable
 * and nothing has to be dragged twice.
 */
const DRAWN_EXT = new Set(["drawn"]);

/**
 * A MARK DRAWS ABOVE AN AREA, and that is what a half band is for.
 *
 * Reported as points failing the depth test against buffer polygons, and it is
 * not a depth test at all: measured, both the point cloud and the buffer fill
 * carry `depthTest: false, depthWrite: false`, so the buffer is never consulted
 * and paint ORDER decides. The rings were made FROM the points, so they arrive
 * later and take the higher stack position — 52 against 51 — and a translucent
 * fill then covers the very points it was drawn around.
 *
 * A polygon is an area and a point is a place, and an area painted over a place
 * hides the thing the area is about. Buffers are the everyday case (you buffer
 * points), and so are convex hulls, voronoi cells and zonal outputs.
 *
 * Half a band rather than a new one, because this is a tie-break WITHIN the
 * data band: marks still sit under the event feed and under drawn shapes, where
 * they belong, and `bandOverride` still wins — so a row dragged under its
 * buffer stays there. Every band here is a default.
 */
const marksCache = new WeakMap();
function marksOnly(layer) {
  const collection = layer?.collection;
  const features = collection?.features;
  if (!Array.isArray(features) || !features.length) return false;
  // Memoised on the collection: this is called from a sort comparator, and a
  // ninety-thousand-point catalogue must not be walked once per comparison.
  if (marksCache.has(collection)) return marksCache.get(collection);
  let only = true;
  for (const feature of features) {
    const type = feature?.geometry?.type;
    if (type !== "Point" && type !== "MultiPoint") { only = false; break; }
  }
  marksCache.set(collection, only);
  return only;
}

export function bandOf(layer) {
  // Put there by hand, and a hand beats a default.
  if (Number.isFinite(layer?.bandOverride)) return layer.bandOverride;
  if (DRAWN_EXT.has(layer?.ext)) return 4;
  if (ON_TOP_EXT.has(layer?.ext)) return 3;
  if (IMAGERY_EXT.has(layer?.ext)) return 0;
  if (layer?.geologyDataset || layer?.role === "geology") return 1;
  return marksOnly(layer) ? 2.5 : 2;
}
