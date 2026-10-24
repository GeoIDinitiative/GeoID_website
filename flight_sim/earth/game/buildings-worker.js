/**
 * Off the main thread: decode a vector tile's building layer and extrude it.
 * A dense z14 tile in central London is ~6,000 outlines and takes 40-90 ms
 * to triangulate, which on the render thread is a visible hitch every time a
 * tile lands.
 */

import { ShapeUtils, Vector2 } from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { decodeLayer } from "./mvt.js?v=1";
import { extrudeTile } from "./extrude.js?v=1";

// three's earcut wrapper wants Vector2s (it calls .equals on them).
const v2 = (pts) => pts.map((p) => new Vector2(p.x, p.y));
const triangulate = (c, h) => ShapeUtils.triangulateShape(v2(c), h.map(v2));

self.onmessage = (e) => {
  const { id, buf, dem, demSize, sizeLocal } = e.data;
  try {
    const layer = decodeLayer(buf, "building");
    if (!layer || !layer.features.length) { self.postMessage({ id, empty: true }); return; }
    const m = extrudeTile(layer, dem, demSize, sizeLocal, triangulate);
    self.postMessage({ id, mesh: m, buildings: m.polygons },
      [m.position.buffer, m.normal.buffer, m.uv.buffer, m.color.buffer, m.style.buffer, m.index.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
