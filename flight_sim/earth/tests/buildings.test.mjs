/**
 * Earth flight: the vector-tile decoder and the building extruder, against a
 * tile encoded here by hand so every number in it is known.
 *
 *   node flight_sim/earth/tests/buildings.test.mjs
 *
 * Picked up by GeoID_GIS/tests/run.mjs as well.
 */

import { decodeLayer, rings, polygons, clipRing, ringArea } from "../game/mvt.js?v=1";
import { extrudeTile, pitched } from "../game/extrude.js?v=1";
import { clipLine, pointInRing, fitWheel } from "../game/structures.js?v=1";
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

/* ── Inferred roofs ───────────────────────────────────────────────────── */
// pitched(ring in tile units, metres per unit, height, hash). hash % 6 === 0
// is the "leave it flat" draw, so tests use hash 1.
const rect = (w, l) => [[0, 0], [l, 0], [l, w], [0, w]];
const g = pitched(rect(8, 20), 1, 8, 1);
check("a 20 x 8 m house gets a gable along its length", g && g.kind === "gable"
  && Math.abs(Math.hypot(g.ridge[1][0] - g.ridge[0][0], g.ridge[1][1] - g.ridge[0][1]) - 20) < 1e-9);
check("rise is about 35 degrees, capped", g && Math.abs(g.rise - Math.min(5, 8 / 3, 4 * Math.tan(35 * Math.PI / 180))) < 1e-9);
const h = pitched(rect(12, 14), 1, 9, 1);
check("a squarer 14 x 12 m one gets a hip with a shortened ridge", h && h.kind === "hip"
  && Math.abs(Math.hypot(h.ridge[1][0] - h.ridge[0][0], h.ridge[1][1] - h.ridge[0][1]) - 2) < 1e-9);
check("towers keep flat roofs", pitched(rect(8, 20), 1, 30, 1) === null);
check("large footprints keep flat roofs", pitched(rect(30, 40), 1, 8, 1) === null);
check("an L-shape is not a rectangle", pitched([[0, 0], [20, 0], [20, 8], [10, 8], [10, 16], [0, 16]], 1, 8, 1) === null);
check("one in six is left flat", pitched(rect(8, 20), 1, 8, 6) === null);
check("a near-collinear extra vertex is ignored", pitched([[0, 0], [10, 0.05], [20, 0], [20, 8], [0, 8]], 1, 8, 1)?.kind === "gable");

// A one-house tile end to end: roof faces up, walls stop at the eave.
const houseTile = { extent: 4096, features: [{ id: 42, type: 3, props: { render_height: 8 },
  geometry: geom([[[100, 100], [100 + 82, 100], [100 + 82, 100 + 33], [100, 100 + 33]]]) }] };
const hm = extrudeTile(houseTile, null, 256, 1000, tri);
let roofUp = true, maxWall = -Infinity;
for (let t = 0; t < hm.roofCount; t += 3) {
  const [a, b, c] = [0, 1, 2].map((k) => [hm.position[hm.index[t + k] * 3], hm.position[hm.index[t + k] * 3 + 1], hm.position[hm.index[t + k] * 3 + 2]]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny <= 0) roofUp = false;
}
for (let t = hm.roofCount; t < hm.roofCount + hm.wallCount; t++) maxWall = Math.max(maxWall, hm.position[hm.index[t] * 3 + 1]);
check("the house's pitched roof faces up", hm.roofCount === 12 && roofUp, String(hm.roofCount));
check("its ridge reaches the full height and its gables reach the ridge", Math.abs(maxWall - 8) < 1e-6, String(maxWall));
check("a style byte per vertex (masonry here)", hm.style.length === hm.position.length / 3 && hm.style.every((v) => v === 0));

/* ── Bridges and lattice structures ──────────────────────────────────── */
check("clipLine keeps the inside", JSON.stringify(clipLine([[-100, 100], [200, 100]], 4096)) === JSON.stringify([[[0, 100], [200, 100]]]));
check("clipLine splits a line that leaves and re-enters",
  clipLine([[100, 100], [100, -100], [200, -100], [200, 100]], 4096).length === 2);
check("pointInRing", pointInRing([5, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]) && !pointInRing([15, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]));

// A ring of floating parts in a vertical plane is a wheel; a straight mast is not.
const ring = [], mast = [];
for (let k = 0; k < 60; k++) {
  const t = k / 60 * Math.PI * 2;
  ring.push({ cx: 500 + Math.cos(t) * 60 * 0.6, cz: 500 + Math.cos(t) * 60 * 0.8, lo: 65 + Math.sin(t) * 60 - 1, hi: 65 + Math.sin(t) * 60 + 1 });
  mast.push({ cx: 500 + k * 0.1, cz: 500, lo: 5 + k * 2, hi: 7 + k * 2 });
}
const w = fitWheel(ring);
check("a ring of parts is recognised as a wheel", w && Math.abs(w.r - 61) < 2 && Math.abs(w.cy - 65) < 2, JSON.stringify(w));
check("a straight mast is not", fitWheel(mast) === null);

// A tile with a river, a bridge line across it and a building sitting in a
// bridge outline: the deck rises above the banks, the building is dropped.
const river = { extent: 4096, features: [{ id: 1, type: 3, props: { class: "river" },
  geometry: geom([[[0, 1500], [4096, 1500], [4096, 2500], [0, 2500]]]) }] };
const roads = { extent: 4096, features: [
  { id: 2, type: 2, props: { class: "primary", brunnel: "bridge", layer: 1 }, geometry: [9, zz(2000), zz(1000), 10, zz(0), zz(2000)] },
  { id: 3, type: 3, props: { class: "bridge" }, geometry: geom([[[3000, 1400], [3100, 1400], [3100, 2600], [3000, 2600]]]) },
] };
const onBridge = { extent: 4096, features: [{ id: 9, type: 3, props: { render_height: 12 },
  geometry: geom([[[3020, 1900], [3080, 1900], [3080, 1960], [3020, 1960]]]) }] };
const bankDem = new Float32Array(256 * 256);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) bankDem[y * 256 + x] = (y < 94 || y > 156) ? 6 : 0;
const bm = extrudeTile(onBridge, bankDem, 256, 1000, tri, { transport: roads, water: river });
let deckTop = -Infinity;
for (let k = 0; k < bm.position.length; k += 3) deckTop = Math.max(deckTop, bm.position[k + 1]);
check("two bridges drawn (one line, one outline)", bm.bridges === 2, String(bm.bridges));
check("the building inside the bridge outline is not extruded", bm.polygons === 0, String(bm.polygons));
check("decks stand above the 6 m banks", deckTop >= 9.9 && deckTop < 12, String(deckTop));
let piers = 0, patch = 0;
for (let k = 0; k < bm.position.length; k += 3) { if (bm.position[k + 1] < -1.9) piers++; if (Math.abs(bm.position[k + 1] - 0.15) < 1e-4) patch++; }
check("piers reach down into the river", piers > 0, String(piers));
check("a water patch hides the photo's bridge under the deck", patch > 0, String(patch));

process.exit(failed ? 1 : 0);
