/**
 * Off the main thread: decode a vector tile's building layer and extrude it.
 * A dense z14 tile in central London is ~6,000 outlines and takes 40-90 ms
 * to triangulate, which on the render thread is a visible hitch every time a
 * tile lands.
 */

import { ShapeUtils, Vector2 } from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { decodeLayer } from "./mvt.js?v=1";
import { extrudeTile } from "./extrude.js?v=10";
import { overtureTile, gapFill } from "./overture.js?v=1";

// three's earcut wrapper wants Vector2s (it calls .equals on them).
const v2 = (pts) => pts.map((p) => new Vector2(p.x, p.y));
const triangulate = (c, h) => ShapeUtils.triangulateShape(v2(c), h.map(v2));

// The Overture gap-fill waits at most this long; past it the tile is drawn
// from OSM alone rather than held back.
const GAP_FILL_MS = 4000;
// Started by a `prefetch` message as the page begins fetching the OSM tile,
// so the two downloads overlap instead of queueing.
const early = new Map();
function overtureFor(x, y) {
  const k = x + "/" + y;
  let p = early.get(k);
  if (!p) {
    p = overtureTile(14, x, y).catch(() => null);
    early.set(k, p);
    if (early.size > 96) early.delete(early.keys().next().value);
  }
  return p;
}
async function machineTraced(origin) {
  const [x, y] = origin || [];
  if (!Number.isFinite(x)) return null;
  const tile = overtureFor(x, y);
  const late = new Promise((r) => setTimeout(() => r(null), GAP_FILL_MS));
  const bytes = await Promise.race([tile, late]);
  early.delete(x + "/" + y);
  return bytes ? decodeLayer(bytes, "building") : null;
}

self.onmessage = async (e) => {
  if (e.data.prefetch) { overtureFor(...e.data.prefetch); return; }
  const { id, buf, dem, demSize, sizeLocal, origin } = e.data;
  try {
    const layer = decodeLayer(buf, "building") || { extent: 4096, features: [] };
    // Buildings OSM has not traced, from Microsoft's footprints (overture.js).
    const ml = gapFill(layer, await machineTraced(origin), sizeLocal / (layer.extent || 4096));
    if (ml.length) layer.features = layer.features.concat(ml);
    // Bridges and the water they cross come from the same tile (structures.js).
    const transport = decodeLayer(buf, "transportation");
    const water = decodeLayer(buf, "water");
    const landcover = decodeLayer(buf, "landcover");
    // Landmarks (extrude.js `landmarks`): stadium and pitch polygons, and the
    // named castles, churches and monuments.
    const landuse = decodeLayer(buf, "landuse");
    const poi = decodeLayer(buf, "poi");
    if (!layer.features.length && !transport && !landcover) { self.postMessage({ id, empty: true }); return; }
    const m = extrudeTile(layer, dem, demSize, sizeLocal, triangulate, { transport, water, landcover, landuse, poi, origin });
    if (!m.index.length && !m.trees.length && !m.canopy.index.length) { self.postMessage({ id, empty: true }); return; }
    self.postMessage({ id, mesh: m, buildings: m.polygons },
      [m.position.buffer, m.normal.buffer, m.uv.buffer, m.color.buffer, m.style.buffer, m.index.buffer, m.trees.buffer,
       m.canopy.position.buffer, m.canopy.normal.buffer, m.canopy.uv.buffer, m.canopy.index.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
