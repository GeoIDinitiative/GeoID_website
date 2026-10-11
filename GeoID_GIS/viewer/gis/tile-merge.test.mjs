/**
 * Tile seams dissolved, and the streamed DEM read as one mosaic.
 *
 * A vector tile cuts every polygon at its edge, so a unit spanning tiles
 * reaches an extraction as several pieces with straight artificial edges along
 * the tile grid; a DEM read tile by tile steps at every boundary. Both are
 * checked here against answers that are known: a rectangle split in two must
 * come back as the rectangle, a linear height field must be read exactly
 * linear across a boundary.
 *
 * Run: node GeoID_GIS/viewer/gis/tile-merge.test.mjs
 */

import { mergeTileFragments, tileBoundsOf, unitKeyOf } from "./tile-merge.js";
import { decodeTile, mercatorTile } from "./mvt.js";
import * as dem from "./dem-tiles.js";

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message}`); }
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ±${tol}`);

const shoelace = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return s / 2;
};
const open = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
  ? r.slice(0, -1) : r);
const polygonsOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
/** Net area: outers minus holes. */
const netArea = (g) => polygonsOf(g).reduce((sum, rings) => sum
  + Math.abs(shoelace(open(rings[0])))
  - rings.slice(1).reduce((h, r) => h + Math.abs(shoelace(open(r))), 0), 0);
/** Every edge with both ends on the vertical line lon = L. */
const edgesOnMeridian = (g, L) => {
  let n = 0;
  polygonsOf(g).forEach((rings) => rings.forEach((raw) => {
    const r = open(raw);
    for (let i = 0; i < r.length; i += 1) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if (Math.abs(a[0] - L) < 1e-9 && Math.abs(b[0] - L) < 1e-9) n += 1;
    }
  }));
  return n;
};
const verticesOnMeridian = (g, L) => polygonsOf(g).flat().map(open).flat()
  .filter((p) => Math.abs(p[0] - L) < 1e-9).length;

/* ── Synthetic pieces on two adjacent zoom-2 tiles ───────────────────────── */

// z2 tile x=1 spans -90..0 and x=2 spans 0..90, both at y=1 (66.5N..0), so
// the seam is the prime meridian, exactly.
const W = tileBoundsOf(2, 1, 1);
const E = tileBoundsOf(2, 2, 1);
const SEAM = W.east;
const unit = (id, coordinates, extra = {}) => ({
  type: "Feature",
  properties: { map_id: id, name: `Unit ${id}`, ...extra },
  geometry: { type: "Polygon", coordinates },
});
const ring = (pts) => [...pts, pts[0]];

check("the seam between the two test tiles is one exact meridian", () => {
  ok(W.east === E.west, `${W.east} vs ${E.west}`);
  ok(SEAM === 0, `seam at ${SEAM}`);
});

check("a rectangle split across a tile edge merges back into one with no seam vertex", () => {
  const left = unit(1, [ring([[-10, 10], [0, 10], [0, 20], [-10, 20]])]);
  const right = unit(1, [ring([[0, 10], [10, 10], [10, 20], [0, 20]])]);
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: [left] },
    { z: 2, x: 2, y: 1, features: [right] },
  ]);
  ok(out.length === 1, `${out.length} features`);
  const g = out[0].geometry;
  ok(g.type === "Polygon", g.type);
  ok(open(g.coordinates[0]).length === 4, `${open(g.coordinates[0]).length} vertices — the seam crossings must be gone`);
  ok(edgesOnMeridian(g, SEAM) === 0, "an edge still runs along the seam");
  ok(verticesOnMeridian(g, SEAM) === 0, "a vertex is still sitting on the seam");
  near(netArea(g), 200, 1e-9, "area");
  ok(out[0].properties.map_id === 1 && out[0].properties.name === "Unit 1", "the unit keeps its attributes");
});

check("a hole crossing the seam comes back as a hole, and a hole inside one piece survives", () => {
  // The hole [-3,3]x[13,17] straddles the seam, so each tile's piece is a C
  // with a notch and NO hole of its own; a second hole sits wholly in the
  // left piece and must pass through untouched.
  const leftHole = [[-8, 12], [-8, 14], [-6, 14], [-6, 12]]; // clockwise
  const left = unit(7, [
    ring([[-10, 10], [0, 10], [0, 13], [-3, 13], [-3, 17], [0, 17], [0, 20], [-10, 20]]),
    ring(leftHole),
  ]);
  const right = unit(7, [ring([[0, 10], [10, 10], [10, 20], [0, 20], [0, 17], [3, 17], [3, 13], [0, 13]])]);
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: [left] },
    { z: 2, x: 2, y: 1, features: [right] },
  ]);
  ok(out.length === 1, `${out.length} features`);
  const g = out[0].geometry;
  ok(g.type === "Polygon", g.type);
  ok(g.coordinates.length === 3, `${g.coordinates.length} rings — expected an outer and two holes`);
  near(netArea(g), 200 - 24 - 4, 1e-9, "net area");
  ok(edgesOnMeridian(g, SEAM) === 0, "the seam still runs through the merged unit");
  const outer = open(g.coordinates[0]);
  ok(shoelace(outer) > 0 && g.coordinates.slice(1).every((h) => shoelace(open(h)) < 0),
    "outer counter-clockwise and holes clockwise");
});

check("different units are never merged, even where they share the seam", () => {
  const left = unit(1, [ring([[-10, 10], [0, 10], [0, 20], [-10, 20]])]);
  const right = unit(2, [ring([[0, 10], [10, 10], [10, 20], [0, 20]])]);
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: [left] },
    { z: 2, x: 2, y: 1, features: [right] },
  ]);
  ok(out.length === 2, `${out.length} features`);
  ok(out[0] === left && out[1] === right, "each arrives exactly as it came");
});

check("without a map_id, identical attributes are one unit and different ones are not", () => {
  const a = { type: "Feature", properties: { name: "Sand", color: "#fc0" }, geometry: { type: "Polygon", coordinates: [ring([[-10, 10], [0, 10], [0, 20], [-10, 20]])] } };
  const b = { type: "Feature", properties: { color: "#fc0", name: "Sand" }, geometry: { type: "Polygon", coordinates: [ring([[0, 10], [10, 10], [10, 20], [0, 20]])] } };
  const c = { type: "Feature", properties: { name: "Clay", color: "#fc0" }, geometry: { type: "Polygon", coordinates: [ring([[0, 10], [10, 10], [10, 20], [0, 20]])] } };
  ok(unitKeyOf(a) === unitKeyOf(b), "key ignores property order");
  ok(mergeTileFragments([{ z: 2, x: 1, y: 1, features: [a] }, { z: 2, x: 2, y: 1, features: [b] }]).length === 1, "same attributes merge");
  ok(mergeTileFragments([{ z: 2, x: 1, y: 1, features: [a] }, { z: 2, x: 2, y: 1, features: [c] }]).length === 2, "different attributes do not");
});

check("pieces that only touch end to end at a corner stay two parts of one unit, each simple", () => {
  // Two squares meeting at one point on the seam: nothing to cancel, so the
  // unit comes back as it arrived rather than as a figure-of-eight.
  const left = unit(3, [ring([[-10, 10], [0, 10], [0, 20], [-10, 20]])]);
  const right = unit(3, [ring([[0, 20], [10, 20], [10, 30], [0, 30]])]);
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: [left] },
    { z: 2, x: 2, y: 1, features: [right] },
  ]);
  ok(out.length === 2 && out[0] === left && out[1] === right, `${out.length} features`);
});

check("fragments at two different zooms are never merged across them", () => {
  const a = unit(1, [ring([[-10, 10], [0, 10], [0, 20], [-10, 20]])]);
  const b = unit(1, [ring([[0, 10], [10, 10], [10, 20], [0, 20]])]);
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: [a] },
    { z: 3, x: 4, y: 2, features: [b] },
  ]);
  ok(out.length === 2, `${out.length} features`);
});

check("four pieces around a tile corner merge into one", () => {
  // z2 tiles (1,1) (2,1) (1,2) (2,2) meet at 0°N 0°E.
  const pieces = [
    { z: 2, x: 1, y: 1, features: [unit(9, [ring([[-5, 0], [0, 0], [0, 5], [-5, 5]])])] },
    { z: 2, x: 2, y: 1, features: [unit(9, [ring([[0, 0], [5, 0], [5, 5], [0, 5]])])] },
    { z: 2, x: 1, y: 2, features: [unit(9, [ring([[-5, -5], [0, -5], [0, 0], [-5, 0]])])] },
    { z: 2, x: 2, y: 2, features: [unit(9, [ring([[0, -5], [5, -5], [5, 0], [0, 0]])])] },
  ];
  const out = mergeTileFragments(pieces);
  ok(out.length === 1, `${out.length} features`);
  const g = out[0].geometry;
  ok(g.type === "Polygon" && open(g.coordinates[0]).length === 4, `${JSON.stringify(g.coordinates[0])}`);
  near(netArea(g), 100, 1e-9, "area");
});

/* ── End to end: real MVT tiles with a buffer, decoded and clipped ───────── */

// The encoder mvt.test.mjs uses, so these are tiles built to the spec rather
// than objects shaped like the decoder's output.
const varint = (n) => { const out = []; let v = n; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); return out; };
const zigzag = (n) => (n < 0 ? -n * 2 - 1 : n * 2);
const key = (tag, wire) => varint((tag << 3) | wire);
const bytes = (tag, payload) => [...key(tag, 2), ...varint(payload.length), ...payload];
const string = (tag, s) => bytes(tag, [...new TextEncoder().encode(s)]);
const uint = (tag, n) => [...key(tag, 0), ...varint(n)];
function geometry(commands) {
  const out = []; let cx = 0; let cy = 0;
  commands.forEach((cmd) => {
    if (cmd[0] === "move") {
      out.push(...varint((1 << 3) | 1), ...varint(zigzag(cmd[1] - cx)), ...varint(zigzag(cmd[2] - cy)));
      cx = cmd[1]; cy = cmd[2];
    } else if (cmd[0] === "line") {
      const points = cmd.slice(1);
      out.push(...varint((points.length << 3) | 2));
      points.forEach(([x, y]) => { out.push(...varint(zigzag(x - cx)), ...varint(zigzag(y - cy))); cx = x; cy = y; });
    } else out.push(...varint((1 << 3) | 7));
  });
  return out;
}
function tile(features, keys = ["map_id", "name"], values = [4242, "Armagh Group"]) {
  const body = [...uint(15, 2), ...string(1, "units"), ...uint(5, 4096)];
  keys.forEach((k) => body.push(...string(3, k)));
  values.forEach((v) => body.push(...bytes(4, typeof v === "string" ? string(1, v) : uint(5, v))));
  features.forEach((f) => {
    body.push(...bytes(2, [...uint(1, f.id || 0), ...bytes(2, f.tags.flatMap((t) => varint(t))),
      ...uint(3, 3), ...bytes(4, geometry(f.geometry))]));
  });
  return new Uint8Array(bytes(3, body));
}
// A unit running from the middle of tile (1,1) to the middle of (2,1), each
// tile carrying 200 units of BUFFER past the seam, as a real tiler does.
// Clockwise in tile coordinates (y down) is what MVT calls an exterior ring.
const westTile = tile([{ tags: [0, 0, 1, 1], geometry: [["move", 2048, 1000], ["line", [4296, 1000], [4296, 3000], [2048, 3000]], ["close"]] }]);
const eastTile = tile([{ tags: [0, 0, 1, 1], geometry: [["move", -200, 1000], ["line", [2048, 1000], [2048, 3000], [-200, 3000]], ["close"]] }]);

check("real tiles: the buffer is clipped and the two pieces come back as one unit", () => {
  const w = decodeTile(westTile, { z: 2, x: 1, y: 1 }).units;
  const e = decodeTile(eastTile, { z: 2, x: 2, y: 1 }).units;
  ok(w.length === 1 && e.length === 1, "one piece per tile");
  // The decoder has clipped each piece to its own tile: it ends exactly ON
  // the seam, which is the artificial edge this whole module exists to remove.
  ok(edgesOnMeridian(w[0].geometry, SEAM) === 1 && edgesOnMeridian(e[0].geometry, SEAM) === 1,
    "each decoded piece runs along the seam");
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: w },
    { z: 2, x: 2, y: 1, features: e },
  ]);
  ok(out.length === 1, `${out.length} features`);
  const g = out[0].geometry;
  ok(edgesOnMeridian(g, SEAM) === 0, "the seam edge survived the merge");
  ok(verticesOnMeridian(g, SEAM) === 0, "a seam vertex survived the merge");
  const r = open(g.coordinates[0]);
  ok(r.length === 4, `${r.length} vertices`);
  const lons = r.map((p) => p[0]);
  near(Math.min(...lons), -45, 1e-6, "west edge");
  near(Math.max(...lons), 45, 1e-6, "east edge");
  ok(out[0].properties.name === "Armagh Group", "attributes kept");
});

check("real tiles: crossing points a tile unit apart are snapped together, not left as a notch", () => {
  // The east tile simplified its copy differently: its edges cross the seam
  // one tile unit lower than the west tile's (a common case at a coarse level).
  const eastOff = tile([{ tags: [0, 0, 1, 1], geometry: [["move", -200, 1001], ["line", [2048, 1001], [2048, 3001], [-200, 3001]], ["close"]] }]);
  const w = decodeTile(westTile, { z: 2, x: 1, y: 1 }).units;
  const e = decodeTile(eastOff, { z: 2, x: 2, y: 1 }).units;
  const out = mergeTileFragments([
    { z: 2, x: 1, y: 1, features: w },
    { z: 2, x: 2, y: 1, features: e },
  ]);
  ok(out.length === 1, `${out.length} features`);
  ok(edgesOnMeridian(out[0].geometry, SEAM) === 0, "a step was left along the seam");
});

check("real tiles: two units meeting at the seam stay two, each still whole", () => {
  const w = decodeTile(tile([{ tags: [0, 0, 1, 1], geometry: [["move", 2048, 1000], ["line", [4296, 1000], [4296, 3000], [2048, 3000]], ["close"]] }]), { z: 2, x: 1, y: 1 }).units;
  const e = decodeTile(tile([{ tags: [0, 0, 1, 1], geometry: [["move", -200, 1000], ["line", [2048, 1000], [2048, 3000], [-200, 3000]], ["close"]] }],
    ["map_id", "name"], [9999, "Tyrone Group"]), { z: 2, x: 2, y: 1 }).units;
  const out = mergeTileFragments([{ z: 2, x: 1, y: 1, features: w }, { z: 2, x: 2, y: 1, features: e }]);
  ok(out.length === 2, `${out.length} features`);
});

/* ── The DEM is one surface across its tiles ─────────────────────────────── */

// A height field linear in the GLOBAL post-centre coordinate. If the tiles are
// read as one mosaic, heightAt must reproduce it exactly everywhere — across
// boundaries, at corners, and half a post from an edge — so any step, terrace
// or half-post offset shows as a number rather than as a picture.
const Z = 10;
const SIZE = 256;
const planeTile = (x, y) => {
  const h = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) h[(j * SIZE) + i] = ((x * SIZE) + i + 0.5) * 2 + ((y * SIZE) + j + 0.5) * 3;
  }
  return { z: Z, x, y, size: SIZE, heights: h };
};
const planeAt = (lat, lon) => { const { x, y } = mercatorTile(lat, lon, Z); return (x * SIZE * 2) + (y * SIZE * 3); };
const latOfRow = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;
const lonOfCol = (x) => (x / 2 ** Z) * 360 - 180;

check("DEM sampling is continuous and exact across a tile boundary", () => {
  dem.reset();
  [[500, 300], [501, 300], [500, 301], [501, 301]].forEach(([x, y]) => dem.holdTile(planeTile(x, y)));
  const lonB = lonOfCol(501);
  const latB = latOfRow(301);
  let worst = 0;
  for (let k = -300; k <= 300; k += 1) {
    const lon = lonB + k * 2e-5;   // across the vertical seam
    const lat = latB + k * 1e-5;   // and the horizontal one, through the corner
    for (const [la, lo] of [[latOfRow(300.5), lon], [lat, lonOfCol(500.5)], [lat, lon]]) {
      worst = Math.max(worst, Math.abs(dem.heightAt(la, lo) - planeAt(la, lo)));
    }
  }
  ok(worst < 1e-6, `worst disagreement with the plane ${worst}`);
});

check("DEM: the step either side of a boundary is the slope's own, not a jump", () => {
  // One post east of the seam minus one post west of it, against the same
  // pair a hundred posts inside the tile: equal on a plane. The old clamp
  // read the whole last half post flat and then jumped.
  const lonB = lonOfCol(501);
  const lat = latOfRow(300.5);
  const post = 360 / (2 ** Z * SIZE);
  const across = dem.heightAt(lat, lonB + post / 2) - dem.heightAt(lat, lonB - post / 2);
  const inside = dem.heightAt(lat, lonB - 100 * post + post / 2) - dem.heightAt(lat, lonB - 100 * post - post / 2);
  near(across, inside, 1e-6, "step across the seam");
  near(across, 2, 1e-6, "one post of the plane");
});

check("DEM: a value belongs to its post's CENTRE, not its corner", () => {
  const { x: tx, y: ty } = { x: 500 + 10.5 / SIZE, y: 300 + 20.5 / SIZE };
  const lon = (tx / 2 ** Z) * 360 - 180;
  const lat = latOfRow(ty);
  const want = planeTile(500, 300).heights[(20 * SIZE) + 10];
  near(dem.heightAt(lat, lon), want, 1e-6, "post (10, 20) read at its own centre");
});

check("DEM: across the antimeridian the mosaic wraps to tile 0", () => {
  dem.reset();
  const last = 2 ** Z - 1;
  const h = new Float32Array(SIZE * SIZE).fill(100);
  const g = new Float32Array(SIZE * SIZE).fill(300);
  dem.holdTile({ z: Z, x: last, y: 300, size: SIZE, heights: h });
  dem.holdTile({ z: Z, x: 0, y: 300, size: SIZE, heights: g });
  const lat = latOfRow(300.5);
  // Exactly on 180°: halfway between the last post of the east-most tile and
  // the first of tile 0, so the mean of the two.
  near(dem.heightAt(lat, 179.9999999999), 200, 1e-3, "at the seam");
});

check("DEM: where a neighbour is not held, the coarser level carries the edge", () => {
  dem.reset();
  // A fine tile at z10 and the z9 tile under its whole neighbourhood, both on
  // the same plane, scaled for their own zoom. The fine tile's neighbour to
  // the east is NOT held, so the last half post must read the coarse level
  // rather than clamp to its own edge.
  const coarse = (x, y, z, size) => {
    const hh = new Float32Array(size * size);
    const f = 2 ** (Z - z);
    for (let j = 0; j < size; j += 1) for (let i = 0; i < size; i += 1) {
      hh[(j * size) + i] = (((x * size) + i + 0.5) * f) * 2 + (((y * size) + j + 0.5) * f) * 3;
    }
    return { z, x, y, size, heights: hh };
  };
  dem.holdTile(planeTile(500, 300));
  dem.holdTile(coarse(250, 150, 9, SIZE), { pin: true });
  const lonB = lonOfCol(501);
  const lat = latOfRow(300.5);
  const post = 360 / (2 ** Z * SIZE);
  const v = dem.heightAt(lat, lonB - post / 4);
  near(v, planeAt(lat, lonB - post / 4), 2.5, "the edge reads the plane through the coarse level");
  dem.reset();
});
