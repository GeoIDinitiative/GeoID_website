/**
 * Earth flight: the vector-tile decoder and the building extruder, against a
 * tile encoded here by hand so every number in it is known.
 *
 *   node flight_sim/earth/tests/buildings.test.mjs
 *
 * Picked up by GeoID_GIS/tests/run.mjs as well.
 */

import { decodeLayer, rings, polygons, clipRing, ringArea } from "../game/mvt.js?v=1";
import { tileId, parseDirectory, gapFill } from "../game/overture.js?v=1";
import { extrudeTile, pitched, inflateBy, inflateRing, monumentForm, STYLE_STONE, STYLE_CHURCH } from "../game/extrude.js?v=9";
import { clipLine, pointInRing, fitWheel, scatterTrees } from "../game/structures.js?v=2";
import { extrudeCanopy, crownHeight, CANOPY_KINDS } from "../game/canopy.js?v=2";
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
// Exact-geometry fixtures: no inflation (see the coincident-walls tests below).
const m = extrudeTile(L, dem, 256, S, tri, { inflate: false });
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
check("facade UVs are whole storeys up the wall, ending at the eave", (() => {
  let maxV = 0; for (let t = m.roofCount; t < m.roofCount + m.wallCount; t++) maxV = Math.max(maxV, m.uv[I[t] * 2 + 1]);
  return maxV === Math.round(30 / 3.2);
})());
check("every wall segment carries a whole number of bays", (() => {
  for (let t = m.roofCount; t < m.roofCount + m.wallCount; t += 3) {
    const us = [0, 1, 2].map((k) => m.uv[I[t + k] * 2]);
    if (us.some((u) => Math.abs(u - Math.round(u)) > 1e-6)) return false;
  }
  return true;
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
const hm = extrudeTile(houseTile, null, 256, 1000, tri, { inflate: false });
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
check("decks meet the 6 m banks, not float above them", deckTop >= 6 && deckTop < 7.5, String(deckTop));
let piers = 0, patch = 0;
for (let k = 0; k < bm.position.length; k += 3) { if (bm.position[k + 1] < -1.9) piers++; if (Math.abs(bm.position[k + 1] - 0.15) < 1e-4) patch++; }
check("piers reach down into the river", piers > 0, String(piers));
check("a water patch hides the photo's bridge under the deck", patch > 0, String(patch));

// A bridge over a DRY hollow (reported at Clifford Hollow Bridge): banks at
// 60 m, the valley floor at 0, no water. The deck spans at bank height, and a
// strip on the ground under it -- textured from beside the bridge -- hides the
// aerial photo's copy of the deck draped down the hollow.
{
  const hollowDem = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) hollowDem[y * 256 + x] = Math.min(60, Math.abs(y - 128) * 1.5);
  const viaduct = { extent: 4096, features: [
    { id: 4, type: 2, props: { class: "motorway", brunnel: "bridge", layer: 1 }, geometry: [9, zz(2000), zz(400), 10, zz(0), zz(3296)] },
  ] };
  const vm = extrudeTile({ extent: 4096, features: [] }, hollowDem, 256, 1000, tri, { transport: viaduct, water: { extent: 4096, features: [] } });
  let deckLow = Infinity, patchVerts = 0, shifted = 0;
  const S = 1000 / 4096;
  for (let k = 0, j = 0; k < vm.position.length; k += 3, j += 2) {
    const x = vm.position[k], y = vm.position[k + 1], z = vm.position[k + 2];
    if (Math.abs(z - 500) < 30 && y > 30) deckLow = Math.min(deckLow, y);          // deck over mid-valley
    if (Math.abs(z - 500) < 120 && y < 20) {                                         // the strip on the floor
      patchVerts++;
      if (Math.abs(vm.uv[j] * 4096 * S - x) > 5) shifted++;
    }
  }
  check("the deck spans the hollow at bank height", deckLow > 55, String(deckLow));
  check("a strip is laid on the valley floor under the span", patchVerts > 0, String(patchVerts));
  check("textured from the photo beside the bridge, not under it", shifted > 0 && shifted === patchVerts, `${shifted}/${patchVerts}`);
}

/* ── Trees (parks only) ─────────────────────────────────────────────────── */
// A 200 x 200 m park in a 1 km tile: ~40,000 m^2 / 700 = ~57 trees, all inside.
const woodRing = [[1000, 1000], [1000 + 819, 1000], [1000 + 819, 1000 + 819], [1000, 1000 + 819]];
const lc = { extent: 4096, features: [{ id: 5, type: 3, props: { class: "grass", subclass: "park" }, geometry: geom([woodRing]) }] };
const treeApi = { s: 1000 / 4096, ext: 4096, ground: () => 7,
  polygonsOf: (f) => polygons(rings(f.geometry)) };
const T1 = scatterTrees(treeApi, lc);
const n1 = T1.length / 5;
check("a 4 ha park gets ~57 trees", n1 > 40 && n1 < 75, String(n1));
let inside = true, onGround = true;
for (let k = 0; k < T1.length; k += 5) {
  const u = T1[k] / treeApi.s, v = T1[k + 2] / treeApi.s;
  if (!pointInRing([u, v], woodRing)) inside = false;
  if (T1[k + 1] !== 7) onGround = false;
}
check("every tree is inside the park, on the ground", inside && onGround);
check("the same park grows the same trees", JSON.stringify(Array.from(scatterTrees(treeApi, lc))) === JSON.stringify(Array.from(T1)));
check("no trees on a bridge", scatterTrees(treeApi, lc, [{ outer: woodRing, holes: [] }]).length === 0);
const bigPark = { extent: 4096, features: [{ id: 6, type: 3, props: { subclass: "park" }, geometry: geom([[[0, 0], [4096, 0], [4096, 4096], [0, 4096]]]) }] };
check("a tile of park is capped at 7,000 trees", scatterTrees({ ...treeApi, s: 4000 / 4096 }, bigPark).length / 5 <= 7000);
const woodLc = { extent: 4096, features: [{ id: 7, type: 3, props: { class: "wood", subclass: "wood" }, geometry: geom([woodRing]) }] };
check("a wood grows no single trees (it is a canopy)", scatterTrees(treeApi, woodLc).length === 0);

/* ── Woods as a raised canopy ───────────────────────────────────────────── */
const canopyApi = { ...treeApi, ground: () => 7, triangulate: tri };
const C = extrudeCanopy(canopyApi, woodLc, [8186, 5448]);
const topTris = C.topCount / 3, wallTris = (C.index.length - C.topCount) / 3;
check("a 4 ha wood becomes one canopy", C.polygons === 1 && topTris > 50 && wallTris >= 8, `${C.polygons} ${topTris} ${wallTris}`);
// Watertight: every edge of the top is shared by two triangles except the outline's.
const edgeUse = new Map();
for (let i = 0; i < C.topCount; i += 3) for (let e = 0; e < 3; e++) {
  const a = C.index[i + e], b = C.index[i + (e + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`;
  edgeUse.set(k, (edgeUse.get(k) || 0) + 1);
}
const open = [...edgeUse.values()].filter((n) => n === 1).length;
check("the canopy top is watertight (no cracks when lifted)", open === 4 && ![...edgeUse.values()].some((n) => n > 2), `${open} open edges`);
let faceUp = true, crownOK = true;
for (let i = 0; i < C.topCount; i++) {
  const k = C.index[i] * 3;
  if (C.normal[k + 1] <= 0) faceUp = false;
  const h = C.position[k + 1] - 7;
  if (h < CANOPY_KINDS.wood.h0 * 0.7 - CANOPY_KINDS.wood.lump || h > CANOPY_KINDS.wood.h1 + CANOPY_KINDS.wood.lump) crownOK = false;
}
check("the canopy faces the sky, at crown height above the ground", faceUp && crownOK);
// The rim (the outline's own corners) stands lower than the crowns inside.
const cornerY = C.position[1] - 7;
check("its rim is rounded off, lower than the crowns", cornerY < crownHeight(CANOPY_KINDS.wood, 8186 * 1000 + 1000 * treeApi.s, 5448 * 1000 + 1000 * treeApi.s), String(cornerY));
let outward = true;
const cu = (1000 + 409) * treeApi.s;
for (let i = C.topCount; i < C.index.length; i++) {
  const k = C.index[i] * 3;
  if ((C.position[k] - cu) * C.normal[k] + (C.position[k + 2] - cu) * C.normal[k + 2] <= 0) outward = false;
}
check("its walls face out, down into the ground", outward && Math.min(...Array.from({ length: C.position.length / 3 }, (_, i) => C.position[i * 3 + 1])) < 7);
check("the top carries the tile's imagery UVs", Math.abs(C.uv[0] - 1000 / 4096) < 1e-6 && Math.abs(C.uv[1] - (1 - 1000 / 4096)) < 1e-6);
check("the same wood grows the same canopy", JSON.stringify(Array.from(extrudeCanopy(canopyApi, woodLc, [8186, 5448]).position)) === JSON.stringify(Array.from(C.position)));
// A wood that fills the tile: no walls along the tile's own edges, and the
// crowns either side of a tile edge are the same height (world-continuous).
const fullWood = { extent: 4096, features: [{ id: 8, type: 3, props: { class: "wood" }, geometry: geom([[[0, 0], [4096, 0], [4096, 4096], [0, 4096]]]) }] };
const F = extrudeCanopy(canopyApi, fullWood, [10, 20]);
check("no foliage wall along the tile's own edges", F.index.length === F.topCount);
const sizeM = 4096 * treeApi.s;
check("crowns meet across a tile edge", Math.abs(crownHeight(CANOPY_KINDS.wood, 11 * sizeM, 20 * sizeM + 300) - crownHeight(CANOPY_KINDS.wood, 10 * sizeM + 4096 * treeApi.s, 20 * sizeM + 300)) < 1e-9);
const scrub = extrudeCanopy(canopyApi, { extent: 4096, features: [{ id: 9, type: 3, props: { class: "scrub", subclass: "scrub" }, geometry: geom([woodRing]) }] }, [0, 0]);
let scrubMax = 0; for (let i = 1; i < scrub.position.length; i += 3) scrubMax = Math.max(scrubMax, scrub.position[i] - 7);
check("scrub is a low canopy", scrub.polygons === 1 && scrubMax <= CANOPY_KINDS.scrub.h1 + CANOPY_KINDS.scrub.lump, String(scrubMax));
check("a park is not a canopy", extrudeCanopy(canopyApi, lc, [0, 0]).polygons === 0);

/* ── Coincident walls (the flicker) ───────────────────────────────────── */
// Two overlapping parts sharing their west edge: a 12 m block and a 30 m
// tower on its corner. Before inflation their west walls lie in one plane.
const part = (ring, h, id) => ({ id, type: 3, props: { render_height: h }, geometry: geom([ring]) });
const twoParts = { extent: 4096, features: [
  part([[1000, 1000], [1400, 1000], [1400, 1400], [1000, 1400]], 12, 7),
  part([[1000, 1000], [1100, 1000], [1100, 1100], [1000, 1100]], 30, 8),
] };
const westX = (mm) => {
  const xs = new Map();
  for (let t = mm.roofCount; t < mm.roofCount + mm.wallCount; t += 3) {
    const i = mm.index[t];
    if (mm.normal[i * 3] > -120) continue;                 // west-facing walls only
    const top = Math.max(...[0, 1, 2].map((k) => mm.position[mm.index[t + k] * 3 + 1]));
    xs.set(top > 20 ? "tower" : "block", mm.position[i * 3]);
  }
  return xs;
};
const flat = westX(extrudeTile(twoParts, null, 256, 1000, tri, { inflate: false }));
check("without inflation the two west walls share a plane (the fight)", Math.abs(flat.get("tower") - flat.get("block")) < 1e-9);
const grown = westX(extrudeTile(twoParts, null, 256, 1000, tri));
check("with it the taller part stands proud, by more than 15 cm",
  flat.get("tower") - grown.get("tower") > grown.get("block") - flat.get("block") + 0.15 - 1e-9 || (flat.get("block") - grown.get("block")) + 0.15 < (flat.get("tower") - grown.get("tower")),
  JSON.stringify([...grown]));
// Above 16 m the height term is gentle and the hash can reorder two parts a
// few metres apart -- they are still separated, which is what stops the fight.
check("inflation grows with height and stays a metre or so", inflateBy(5, 0) < inflateBy(8, 0) && inflateBy(51, 0) < inflateBy(61, 0) && inflateBy(300, 4) < 1.6);
check("equal heights are split by the hash, but never past a storey's difference",
  inflateBy(5, 1) !== inflateBy(5, 2) && inflateBy(5, 4) < inflateBy(8, 0));
const edgeRing = [[0, 100], [200, 100], [200, 300], [0, 300]];
const ge = inflateRing(edgeRing, 5, 4096, true);
check("vertices on the tile edge stay put (no overlap across the seam)", ge.filter((q) => q[0] === 0).length === 2);
check("vertices inside move outward", ge.some((q) => q[0] > 200) && ge.some((q) => q[1] > 300));

/* ── Landmarks ────────────────────────────────────────────────────────── */
// A tile with a stadium (a bowl with the pitch as its hole), a castle keep,
// a church and a column, each found from the tile's landuse and poi layers.
const pt = (u, v) => [9 | (1 << 3), zz(u), zz(v)];
const enc = (name, feats, k, v) => decodeLayer(new Uint8Array(bytes(3, layer(name, feats, k, v))), name);
const lmKeys = ["class", "name", "subclass"];
const lmVals = [valueStr("stadium"), valueStr("pitch"), valueStr("castle"), valueStr("Keep Castle"),
  valueStr("place_of_worship"), valueStr("St Test"), valueStr("monument"), valueStr("Test Column"), valueStr("christian")];
const landuse = enc("landuse", [
  { tags: [0, 0], geometry: geom([[[400, 400], [1600, 400], [1600, 1600], [400, 1600]]]) },
  { tags: [0, 1], geometry: geom([[[800, 800], [1200, 800], [1200, 1200], [800, 1200]]]) },
], lmKeys, lmVals);
const poi = { extent: 4096, features: [
  { type: 1, props: { class: "castle", name: "Keep Castle" }, geometry: pt(2500, 2500) },
  { type: 1, props: { class: "place_of_worship", subclass: "christian", name: "St Test" }, geometry: pt(3300, 600) },
  { type: 1, props: { class: "monument", name: "Test Column" }, geometry: pt(3800, 3800) },
] };
const lmTile = { extent: 4096, features: [
  { id: 1, type: 3, props: { render_height: 40 }, geometry: geom([[[500, 500], [1500, 500], [1500, 1500], [500, 1500]], [[700, 700], [700, 1300], [1300, 1300], [1300, 700]]]) },
  part([[2400, 2400], [2600, 2400], [2600, 2600], [2400, 2600]], 20, 2),
  part([[3000, 500], [3600, 500], [3600, 700], [3000, 700]], 18, 3),
] };
const lm = extrudeTile(lmTile, null, 256, 1000, tri, { landuse, poi, inflate: false });
check("three landmark buildings and one point monument", lm.landmarks === 3 && lm.monuments === 1, `${lm.landmarks} / ${lm.monuments}`);
const sty = (v) => Math.trunc(v * 255);          // as the Uint8Array stores it
check("the castle is dressed stone, the church its own style", lm.style.includes(sty(STYLE_STONE)) && lm.style.includes(sty(STYLE_CHURCH)));
// The bowl: roof vertices on the pitch side are low, on the outside full height.
let lowIn = Infinity, highOut = -Infinity;
const kk = 1000 / 4096;
for (let t = 0; t < lm.roofCount; t++) {
  const i = lm.index[t], x = lm.position[i * 3] / kk, z = lm.position[i * 3 + 2] / kk, y = lm.position[i * 3 + 1];
  if (x > 1700) continue;
  if (Math.abs(x - 1000) < 310 && Math.abs(z - 1000) < 310) lowIn = Math.min(lowIn, y);
  if (Math.abs(x - 1000) > 490 || Math.abs(z - 1000) > 490) highOut = Math.max(highOut, y);
}
check("stadium stands rake down to the pitch", Math.abs(highOut - 40) < 1e-6 && lowIn < 10, `${lowIn} .. ${highOut}`);
// Battlements: castle geometry rises above its 20 m roof.
let castleTop = 0;
for (let i = 0; i < lm.position.length / 3; i++) {
  const x = lm.position[i * 3] / kk, z = lm.position[i * 3 + 2] / kk;
  if (x > 2380 && x < 2620 && z > 2380 && z < 2620) castleTop = Math.max(castleTop, lm.position[i * 3 + 1]);
}
check("the castle carries battlements above its roof", Math.abs(castleTop - 21.1) < 1e-6, String(castleTop));
check("monument forms come from the name", monumentForm("monument", "Nelson's Column") === "column"
  && monumentForm("attraction", "Cleopatra's Needle") === "obelisk" && monumentForm("monument", "George III") === "statue"
  && monumentForm("art_gallery", "Statue of Queen Anne") === "statue" && monumentForm("monument", "Lombard Street Ventilation Shaft") === null
  && monumentForm("art_gallery", "Faceted Column") === "column" && monumentForm("shop", "Cross Keys") === null);
check("a church nave gets a steep gable at any size", pitched([[0, 0], [60, 0], [60, 20], [0, 20]], 1, 25, 6,
  { maxHeight: 45, minArea: 30, maxArea: 4000, angle: 50, maxRise: 16, flat: false, gableRatio: 1.15 })?.kind === "gable");

// A low part inside a stadium (Old Trafford's 5 m concourse ring) is the
// stadium too: plain, not an office block with a band of windows, and flat.
{
  const st = enc("landuse", [{ tags: [0, 0], geometry: geom([[[400, 400], [1600, 400], [1600, 1600], [400, 1600]]]) }], lmKeys, lmVals);
  const low = { extent: 4096, features: [part([[450, 450], [1550, 450], [1550, 520], [450, 520]], 5, 9)] };
  const ml = extrudeTile(low, null, 256, 1000, tri, { landuse: st, inflate: false });
  const tops = new Set(); for (let i = 1; i < ml.position.length; i += 3) tops.add(Math.round(ml.position[i] * 100) / 100);
  check("a 5 m part inside a stadium is the stadium's, drawn plain", ml.landmarks === 1 && ml.style.every((v) => v === 127), String(ml.landmarks));
  check("...and flat-topped (only parts from 8 m are raked)", Math.max(...tops) === 5, JSON.stringify([...tops]));
}

// Overture gap-fill (overture.js). PMTiles ids from the spec's examples.
check("PMTiles tile ids", tileId(0, 0, 0) === 0 && tileId(1, 0, 0) === 1 && tileId(1, 0, 1) === 2
  && tileId(1, 1, 1) === 3 && tileId(1, 1, 0) === 4 && tileId(2, 0, 0) === 5, [tileId(1, 0, 1), tileId(1, 1, 0)].join());
{
  // Two entries: ids 3 then 7, runs 1/0 (a leaf), lengths 10/20, offsets 0 then "follows on" (0).
  const d = parseDirectory(Uint8Array.from([2, 3, 4, 1, 0, 10, 20, 1, 0]));
  check("PMTiles directory: deltas, runs, lengths, follow-on offsets",
    d.length === 2 && d[1].id === 7 && d[1].run === 0 && d[1].off === 10 && d[0].len === 10, JSON.stringify(d));
  // An offset past 2^32 (the archive is ~180 GB) survives the varint.
  const big = parseDirectory(Uint8Array.from([1, 1, 1, 5, 0x81, 0x80, 0x80, 0x80, 0x80, 0x01]));
  check("PMTiles offsets past 2^32", big[0].off === 2 ** 35, String(big[0].off));
}
{
  const sq = (x, y, w, props) => ({ id: 0, type: 3, props, geometry: geom([[[x, y], [x + w, y], [x + w, y + w], [x, y + w]]]) });
  const osm = { extent: 4096, features: [sq(100, 100, 60, { render_height: 5 })] };
  const ov = { extent: 4096, features: [
    sq(105, 105, 50, { "@geometry_source": "Microsoft ML Buildings", height: 6 }),   // the OSM house again
    sq(80, 80, 100, { "@geometry_source": "Microsoft ML Buildings" }),             // around it, its centre inside
    sq(400, 400, 40, { "@geometry_source": "Microsoft ML Buildings", height: 7.5 }), // unmapped: kept
    sq(600, 600, 40, { "@geometry_source": "OpenStreetMap", height: 9 }),           // OSM via Overture: never
    sq(800, 800, 6, { "@geometry_source": "Microsoft ML Buildings" }),              // a 2 m sliver
    sq(1000, 1000, 40, { "@geometry_source": "Microsoft ML Buildings", height: 1 }),  // implausible height
  ] };
  const got = gapFill(osm, ov, 0.37);
  check("gap-fill keeps only unmapped machine-traced buildings", got.length === 2, String(got.length));
  check("...with their own height, or 5 m where it is implausible",
    got[0].props.render_height === 7.5 && got[1].props.render_height === 5, JSON.stringify(got.map((f) => f.props)));
  check("...and nothing from a missing tile", gapFill(osm, null, 0.37).length === 0);
}

process.exit(failed ? 1 : 0);
