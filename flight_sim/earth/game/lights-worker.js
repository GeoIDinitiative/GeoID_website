/**
 * Off the main thread: a vector tile's road lines, decoded; the street lamps
 * along them (lamps.js); each lit or dark against Black Marble; each stood on
 * the terrain at column height, relative to the tile's centre; and, for the
 * close ring, the pool of light each throws on the road. The main thread only
 * wraps the arrays in GPU buffers, so lamps arrive as fast as the tiles do.
 *
 * Frame: Earth Flight's globe frame, a sphere of radius R = 3.2 units where
 * a point is (R cos(lat) cos(lon), R sin(lat), -R cos(lat) sin(lon)) -- the
 * viewer's surfacePoint(lat, lon, 0) with x and z flipped, as every flight
 * layer draws in.
 */

import { decodeLayer, rings } from "./mvt.js?v=1";
import { placeLamps, litPower, radianceAboveBackground, CLASS_BY_CODE } from "./lamps.js?v=2";

const R = 3.2;
const UNITS_PER_M = R / 6371000;
const LAMP_HEIGHT_M = 9;
const DEM_N = 33;
const LED = [1.0, 0.9, 0.78], SODIUM = [1.0, 0.56, 0.2];

const bmTiles = new Map();       // "x/y" (z8) -> Uint8ClampedArray
const candidates = new Map();    // tile key -> Float32Array of [u, v, code, hash]
const CANDIDATES_KEPT = 200;

const xToLon = (x, z) => (x / 2 ** z) * 360 - 180;
const yToLat = (y, z) => Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z)) * 180 / Math.PI;
function globePoint(lat, lon, r, out) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  out[0] = r * Math.cos(la) * Math.cos(lo); out[1] = r * Math.sin(la); out[2] = -r * Math.cos(la) * Math.sin(lo);
  return out;
}
function radianceAt(lat, lon) {
  const n = 256, fx = (lon + 180) / 360 * n, r = lat * Math.PI / 180;
  const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const d = bmTiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
  if (!d) return null;
  const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
  const i = (py * 256 + px) * 4;
  return radianceAboveBackground(d[i], d[i + 1], d[i + 2]);
}
function lampColour(code, hash, power) {
  const ledShare = code <= 2 ? 0.8 : 0.6;
  const c = hash < ledShare ? LED : SODIUM;
  const k = power * (code <= 1 ? 1.15 : code >= 5 ? 0.85 : 1.0);
  return [c[0] * k, c[1] * k, c[2] * k];
}

function decode(buf, tileSizeM, classes, thin) {
  const layer = decodeLayer(buf, "transportation");
  if (!layer) return new Float32Array(0);
  const lines = [];
  for (const f of layer.features) {
    if (f.type !== 2 || f.props.brunnel === "tunnel") continue;
    const cls = String(f.props.class || "").replace(/_construction$/, "");
    for (const pts of rings(f.geometry)) lines.push({ cls, pts });
  }
  return placeLamps(lines, layer.extent || 4096, tileSizeM, classes, thin);
}

/** Stand a tile's lamps on the terrain: positions, colours, pool matrices. */
function stand(L, z, x, y, dem, pools, thin = 1) {
  const centre = globePoint(yToLat(y + 0.5, z), xToLon(x + 0.5, z), R, [0, 0, 0]);
  const pos = [], col = [], mats = [];
  const p = [0, 0, 0];
  const height = (u, v) => {
    if (!dem) return 0;
    const fx = Math.min(Math.max(u * (DEM_N - 1), 0), DEM_N - 1), fy = Math.min(Math.max(v * (DEM_N - 1), 0), DEM_N - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, DEM_N - 1), y1 = Math.min(y0 + 1, DEM_N - 1);
    const tx = fx - x0, ty = fy - y0;
    return (dem[y0 * DEM_N + x0] * (1 - tx) + dem[y0 * DEM_N + x1] * tx) * (1 - ty)
      + (dem[y1 * DEM_N + x0] * (1 - tx) + dem[y1 * DEM_N + x1] * tx) * ty;
  };
  for (let i = 0; i < L.length; i += 4) {
    const u = L[i], v = L[i + 1], code = L[i + 2], hash = L[i + 3];
    const lat = yToLat(y + v, z), lon = xToLon(x + u, z);
    const rad = radianceAt(lat, lon);
    const power = rad == null ? 0 : litPower(code, rad);
    if (power <= 0) continue;
    const ground = R + height(u, v);
    globePoint(lat, lon, ground + LAMP_HEIGHT_M * UNITS_PER_M, p);
    pos.push(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
    const [cr, cg, cb] = lampColour(code, hash, power * thin);   // a thinned lamp carries the light of those left out
    col.push(cr, cg, cb);
    if (pools) {
      // A disc on the ground under the lamp: columns east, north, up, at.
      const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      const up = [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
      const east = [-Math.sin(lo), 0, -Math.cos(lo)];
      const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
      const diam = (CLASS_BY_CODE[code].offset * 1.5 + 9) * UNITS_PER_M;
      const g = ground + 0.15 * UNITS_PER_M;
      mats.push(east[0] * diam, east[1] * diam, east[2] * diam, 0,
        north[0] * diam, north[1] * diam, north[2] * diam, 0,
        up[0], up[1], up[2], 0,
        up[0] * g - centre[0], up[1] * g - centre[1], up[2] * g - centre[2], 1);
    }
  }
  return {
    centre, positions: new Float32Array(pos), colours: new Float32Array(col),
    pools: pools ? new Float32Array(mats) : null,
  };
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.bm) { bmTiles.set(m.bmKey, m.bm); return; }
  const { id, key, buf, z, x, y, tileSizeM, classes, dem, pools, thin = 1 } = m;
  try {
    let L = candidates.get(key);
    if (!L) {
      if (!buf) { self.postMessage({ id, refetch: true }); return; }
      L = decode(buf, tileSizeM, classes, thin);
      candidates.set(key, L);
      if (candidates.size > CANDIDATES_KEPT) candidates.delete(candidates.keys().next().value);
    }
    const r = stand(L, z, x, y, dem, pools, thin);
    const transfer = [r.positions.buffer, r.colours.buffer];
    if (r.pools) transfer.push(r.pools.buffer);
    self.postMessage({ id, ...r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
