/**
 * Earth Flight's gazetteer worker: one OpenMapTiles vector tile in, the named
 * places worth a label out (gazetteer.js ranks them). Off the main thread, as
 * the lamps are (lights-worker.js): a z8 tile is ~100 KB of protobuf.
 *
 *   in:  { id, z, x, y, layers, buf }
 *   out: { id, items: [{ name, lat, lon, category, type, lod, maxAltKm, reachKm, area, ele }] }
 */
import { decodeLayer, rings } from "./mvt.js?v=1";
import { rankFeature, tilePointToLatLon } from "./gazetteer.js?v=2";

function labelPoint(f) {
  const rs = rings(f.geometry);
  if (!rs.length || !rs[0].length) return null;
  if (f.type === 1) return rs[0][0];
  // A line or an area: the middle of its first ring's extent.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rs[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

self.onmessage = (e) => {
  const { id, z, x, y, layers, buf } = e.data;
  const items = [];
  try {
    const bytes = new Uint8Array(buf);
    for (const name of layers) {
      const layer = decodeLayer(bytes, name);
      if (!layer) continue;
      const ext = layer.extent || 4096;
      for (const f of layer.features) {
        const r = rankFeature(name, f.props, z);
        if (!r) continue;
        const pt = labelPoint(f);
        if (!pt || pt[0] < 0 || pt[1] < 0 || pt[0] > ext || pt[1] > ext) continue;   // buffer copies belong to the neighbour
        const { lat, lon } = tilePointToLatLon(z, x, y, pt[0], pt[1], ext);
        items.push({ ...r, lat, lon });
      }
    }
  } catch (err) { /* a bad tile names nothing */ }
  self.postMessage({ id, items });
};
