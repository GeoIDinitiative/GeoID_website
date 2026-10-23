/**
 * Earth flight: the vector-tile decoder and the building extruder, against a
 * tile encoded here by hand so every number in it is known.
 *
 *   node flight_sim/earth/tests/buildings.test.mjs
 *
 * Picked up by GeoID_GIS/tests/run.mjs as well.
 */

import { decodeLayer, rings, polygons, clipRing, ringArea } from "../game/mvt.js?v=1";
import { extrudeTile } from "../game/extrude.js?v=1";
import { ShapeUtils, Vector2 } from "../../../everest/vendor/three.module.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (!ok) failed++;
};

/* ── A minimal protobuf / MVT encoder ─────────────────────────────────── */
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const field = (f, w) => varint((f << 3) | w);
const bytes = (f, b) => [...field(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...new TextEncoder().encode(s)]);
const packed = (f, arr) => bytes(f, arr.flatMap(varint));
const zz = (n) => (n << 1) ^ (n >> 31);
function geom(ringsIn) {
  const out = []; let x = 0, y = 0;
  for (const r of ringsIn) {
    out.push((1 & 7) | (1 << 3), zz(r[0][0] - x), zz(r[0][1] - y)); x = r[0][0]; y = r[0][1];
    out.push((2 & 7) | ((r.length - 1) << 3));
    for (const p of r.slice(1)) { out.push(zz(p[0] - x), zz(p[1] - y)); x = p[0]; y = p[1]; }
    out.push(7 | (1 << 3));
  }
  return out;
}
const valueNum = (n) => [...field(5, 0), ...varint(n)];       // uint_value
const valueStr = (s) => str(1, s);
function layer(name, feats, keys, values) {
  return [
    ...field(15, 0), ...varint(2), ...str(1, name),
    ...feats.flatMap((f) => bytes(2, [...packed(2, f.tags), ...field(3, 0), ...varint(3), ...packed(4, f.geometry)])),
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytes(4, v)),
    ...field(5, 0), ...varint(4096),
  ];
}

// Spec 2.x winding (y down): exterior positive area = clockwise on screen.
const outer = [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]];
const hole = [[1500, 1500], [1500, 2500], [2500, 2500], [2500, 1500]];
// A second building straddling the east edge: half of it is outside the tile.
const straddle = [[3800, 200], [4400, 200], [4400, 600], [3800, 600]];
const keys = ["render_height", "render_min_height", "colour"];
const values = [valueNum(30), valueNum(0), valueStr("#ff0000"), valueNum(12)];
const tile = new Uint8Array([
  ...bytes(3, layer("water", [{ tags: [], geometry: geom([outer]) }], [], [])),
  ...bytes(3, layer("building", [
    { tags: [0, 0, 1, 1, 2, 2], geometry: geom([outer, hole]) },
    { tags: [0, 3, 1, 1], geometry: geom([straddle]) },
  ], keys, values)),
]);

/* ── Decoding ─────────────────────────────────────────────────────────── */
const L = decodeLayer(tile, "building");
check("finds the named layer past another one", L && L.name === "building");
check("two features", L.features.length === 2, String(L.features.length));
check("properties decoded", L.features[0].props.render_height === 30 && L.features[0].props.colour === "#ff0000",
  JSON.stringify(L.features[0].props));
check("missing layer is null", decodeLayer(tile, "nope") === null);
const rs = rings(L.features[0].geometry);
check("rings decoded exactly", JSON.stringify(rs) === JSON.stringify([outer, hole]), JSON.stringify(rs));
check("exterior positive, hole negative", ringArea(outer) > 0 && ringArea(hole) < 0);
const polys = polygons(rs);
check("hole grouped under its exterior", polys.length === 1 && polys[0].holes.length === 1);
const clipped = clipRing(straddle, 4096);
check("clip to the tile edge", clipped.every(([x]) => x <= 4096) && Math.abs(ringArea(clipped) - 296 * 400) < 1e-6,
  JSON.stringify(clipped));

/* ── Extrusion ────────────────────────────────────────────────────────── */
const v2 = (pts) => pts.map((p) => new Vector2(p.x, p.y));
const tri = (c, h) => ShapeUtils.triangulateShape(v2(c), h.map(v2));
const dem = new Float32Array(256 * 256).fill(50);
const S = 1000;                                    // tile = 1 km
const m = extrudeTile(L, dem, 256, S, tri);
const P = m.position, I = m.index;

check("two buildings extruded", m.polygons === 2, String(m.polygons));
let topOk = true, lowest = Infinity;
for (let i = 1; i < P.length; i += 3) lowest = Math.min(lowest, P[i]);
for (let k = 0; k < m.roofCount; k++) if (Math.abs(P[I[k] * 3 + 1] - 80) > 1e-3 && Math.abs(P[I[k] * 3 + 1] - 62) > 1e-3) topOk = false;
check("roofs at ground + render_height (50+30, 50+12)", topOk);
check("walls sunk 4 m below the ground", Math.abs(lowest - 46) < 1e-3, String(lowest));

// Roof area with the courtyard removed: (2000² − 1000²) tile units² → m².
const k = S / 4096;
let roofArea = 0, up = true;
const vtx = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
for (let t = 0; t < m.roofCount; t += 3) {
  const a = vtx(I[t]), b = vtx(I[t + 1]), c = vtx(I[t + 2]);
  const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
  const ny = uz * wx - ux * wz;            // y of (b−a) × (c−a)
  if (ny <= 0) up = false;
  if (a[1] > 70) roofArea += Math.abs(ny) / 2;
}
check("every roof triangle faces up", up);
const want = (2000 * 2000 - 1000 * 1000) * k * k;
check("roof area excludes the courtyard", Math.abs(roofArea - want) / want < 1e-6, `${roofArea} vs ${want}`);

// Walls face away from the solid: the outer wall on the west side of the
// block points west (−x), the courtyard wall on its west side points east.
let wallsOk = true;
const N = m.normal;
for (let t = m.roofCount; t < m.roofCount + m.wallCount; t += 3) {
  const a = vtx(I[t]), b = vtx(I[t + 1]), c = vtx(I[t + 2]);
  const ex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], fx = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ex[1] * fx[2] - ex[2] * fx[1], ex[2] * fx[0] - ex[0] * fx[2], ex[0] * fx[1] - ex[1] * fx[0]];
  const stored = [N[I[t] * 3], N[I[t] * 3 + 1], N[I[t] * 3 + 2]];
  if (n[0] * stored[0] + n[1] * stored[1] + n[2] * stored[2] <= 0) wallsOk = false;    // winding agrees with normal
  const on = (x0) => [a, b, c].every((v) => Math.abs(v[0] / k - x0) < 1e-3);   // whole triangle in that wall
  if (on(1000) && stored[0] >= 0) wallsOk = false;
  if (on(1500) && stored[0] <= 0) wallsOk = false;
}
check("wall winding matches its normal, outward and into the courtyard", wallsOk);
check("facade UVs are metres up the wall", (() => {
  let maxV = 0; for (let t = m.roofCount; t < m.roofCount + m.wallCount; t++) maxV = Math.max(maxV, m.uv[I[t] * 2 + 1]);
  return Math.abs(maxV - 30) < 1e-3;
})());

process.exit(failed ? 1 : 0);
