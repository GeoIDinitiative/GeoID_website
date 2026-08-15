/**
 * Interpolation, against surfaces and partitions whose answers are known
 * before the code runs.
 *
 * Every expected value here is either a planted construction or arithmetic on
 * one: a plane the TIN must reproduce, a square whose triangulation must cover
 * exactly its own area, a perpendicular bisector at a lon anyone can name, and
 * a three-point IDW case whose weights are 4 : 16 : 64 by construction. The
 * IDW cases are laid out along a SINGLE LATITUDE, so the equirectangular
 * metre scaling multiplies every distance by the same constant and cancels out
 * of the normalised weighted mean — the expected numbers are then pure
 * arithmetic and do not restate the implementation's projection.
 *
 * Run: node GeoID_GIS/viewer/gis/interpolation.test.mjs
 */

import { idwRaster, delaunay, tinRaster, voronoiPolygons } from "./interpolation.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
const exact = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`);

/* ── fixtures and independent geometry ── */

const unitBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

function pointFc(list) {
  return {
    type: "FeatureCollection",
    features: list.map(([x, y, props]) => ({
      type: "Feature",
      properties: props,
      geometry: { type: "Point", coordinates: [x, y] },
    })),
  };
}

const valued = (list, field = "v") =>
  pointFc(list.map(([x, y, v]) => [x, y, { [field]: v }]));

const at = (r, col, row) => r.band[row * r.width + col];
const centreLon = (r, col) => r.bounds.minX + ((col + 0.5) / r.width) * (r.bounds.maxX - r.bounds.minX);
const centreLat = (r, row) => r.bounds.maxY - ((row + 0.5) / r.height) * (r.bounds.maxY - r.bounds.minY);

/** Shoelace area of a ring; positive when counter-clockwise. */
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  // Tolerate an unclosed ring by wrapping the last segment explicitly.
  const last = ring[ring.length - 1];
  const first = ring[0];
  if (last[0] !== first[0] || last[1] !== first[1]) s += last[0] * first[1] - first[0] * last[1];
  return s / 2;
}

function triArea(a, b, c) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

/** Ray-casting point in ring; written here rather than imported, on purpose. */
function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > y) !== (yj > y)) {
      const xc = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xc) inside = !inside;
    }
  }
  return inside;
}

/** Independent circumcircle, for testing the Delaunay empty-circle property. */
function circum(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-18) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x: ux, y: uy, r2: (a[0] - ux) ** 2 + (a[1] - uy) ** 2 };
}

/** Deterministic pseudo-random: a "random" sample that is the same every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ════════════════════════════ IDW ════════════════════════════ */

{
  // Neither sample sits on a cell centre, which is the point: the cell that
  // CONTAINS an observation must still report the observation.
  const r = idwRaster(valued([[0.20, 0.80, 10], [0.90, 0.10, 20]]), "v", unitBox,
    { cellsAcross: 4 });
  check("idw returns a raster for two samples", !!r);
  exact("idw grid is 4 wide", r.width, 4);
  exact("idw grid is 4 high (square AOI)", r.height, 4);
  check("idw carries the AOI bounds",
    r.bounds.minX === 0 && r.bounds.minY === 0 && r.bounds.maxX === 1 && r.bounds.maxY === 1);
  check("idw marks NaN as noData", Number.isNaN(r.noData));
  exact("idw counts its samples", r.pointCount, 2);
  exact("the cell holding the first sample IS the sample", at(r, 0, 0), 10);
  exact("the cell holding the second sample IS the sample", at(r, 3, 3), 20);
  const values = [...r.band];
  check("no cell is left unfilled", values.every(Number.isFinite));
  check("every cell is a convex combination of the samples",
    values.every((v) => v >= 10 - 1e-6 && v <= 20 + 1e-6),
    `range ${Math.min(...values)}..${Math.max(...values)}`);
}

{
  // Several samples in one cell: the cell reports their mean, not a coin toss.
  const r = idwRaster(valued([[0.10, 0.90, 10], [0.15, 0.95, 20]]), "v", unitBox,
    { cellsAcross: 4 });
  exact("two samples in one cell average", at(r, 0, 0), 15);
}

{
  // All samples equal: IDW is a weighted MEAN, so the surface is that value
  // everywhere, and the cell equidistant from both is the plainest case of it.
  const r = idwRaster(valued([[1 / 6, 0.5, 7], [5 / 6, 0.5, 7]]), "v", unitBox,
    { cellsAcross: 3 });
  exact("the midpoint of two equal samples is that value", at(r, 1, 1), 7);
  check("equal samples give a constant surface", [...r.band].every((v) => v === 7),
    `got ${[...r.band].join(",")}`);
}

{
  // Hand-computed three-point case. Grid is 8x8 over the unit box, so cell
  // centres are (i+0.5)/8. Every sample and the query cell sit on row 4
  // (lat 0.4375), so all four points share a latitude and the metre scaling
  // is a common factor: only the lon offsets 0.5, 0.25, 0.125 matter.
  const lat = 0.4375;
  const samples = valued([
    [0.0625, lat, 3],  // col 0, 0.5 away from the query cell
    [0.3125, lat, 6],  // col 2, 0.25 away
    [0.4375, lat, 9],  // col 3, 0.125 away
  ]);
  const w2 = [1 / 0.5 ** 2, 1 / 0.25 ** 2, 1 / 0.125 ** 2];     // 4, 16, 64
  const w1 = [1 / 0.5, 1 / 0.25, 1 / 0.125];                    // 2, 4, 8
  const w4 = [1 / 0.5 ** 4, 1 / 0.25 ** 4, 1 / 0.125 ** 4];     // 16, 256, 4096
  const blend = (w) => (w[0] * 3 + w[1] * 6 + w[2] * 9) / (w[0] + w[1] + w[2]);

  const p2 = idwRaster(samples, "v", unitBox, { cellsAcross: 8, power: 2 });
  near("idw power 2 matches the hand-computed blend", at(p2, 4, 4), blend(w2), 1e-6);
  exact("sample cell 1 is exact under power 2", at(p2, 0, 4), 3);
  exact("sample cell 2 is exact under power 2", at(p2, 2, 4), 6);
  exact("sample cell 3 is exact under power 2", at(p2, 3, 4), 9);

  const p1 = idwRaster(samples, "v", unitBox, { cellsAcross: 8, power: 1 });
  near("idw power 1 matches the hand-computed blend", at(p1, 4, 4), blend(w1), 1e-6);

  const p4 = idwRaster(samples, "v", unitBox, { cellsAcross: 8, power: 4 });
  near("idw power 4 matches the hand-computed blend", at(p4, 4, 4), blend(w4), 1e-6);

  check("a higher power leans harder on the nearest sample",
    Math.abs(at(p4, 4, 4) - 9) < Math.abs(at(p2, 4, 4) - 9)
    && Math.abs(at(p2, 4, 4) - 9) < Math.abs(at(p1, 4, 4) - 9),
    `p1 ${at(p1, 4, 4)}, p2 ${at(p2, 4, 4)}, p4 ${at(p4, 4, 4)}`);

  // The query cell is between samples 2 and 3, so a plain mean (6) is not the
  // answer — this is what a broken distance term would produce.
  check("the blend is not the unweighted mean", Math.abs(at(p2, 4, 4) - 6) > 1,
    `got ${at(p2, 4, 4)}`);
}

{
  const r = idwRaster(valued([[0.5, 0.5, 4]]), "v", unitBox, { cellsAcross: 5 });
  check("one sample gives a constant surface", [...r.band].every((v) => v === 4));
}

{
  const multi = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { v: 5 },
      geometry: { type: "MultiPoint", coordinates: [[0.1, 0.9], [0.9, 0.1]] },
    }],
  };
  const r = idwRaster(multi, "v", unitBox, { cellsAcross: 4 });
  exact("a MultiPoint contributes every position", r.pointCount, 2);
  exact("MultiPoint position 1 is exact", at(r, 0, 0), 5);
  exact("MultiPoint position 2 is exact", at(r, 3, 3), 5);
}

{
  const r = idwRaster(valued([[0.5, 0.5, "12.5"]]), "v", unitBox, { cellsAcross: 4 });
  check("a numeric string counts as an observation", !!r && at(r, 2, 1) === 12.5,
    r ? `got ${at(r, 2, 1)}` : "got null");
}

{
  check("no features means no raster",
    idwRaster({ type: "FeatureCollection", features: [] }, "v", unitBox) === null);
  check("a non-numeric field means no raster",
    idwRaster(valued([[0.5, 0.5, "n/a"]]), "v", unitBox) === null);
  check("a missing field means no raster",
    idwRaster(valued([[0.5, 0.5, 3]]), "other", unitBox) === null);
  const lines = { type: "FeatureCollection", features: [{
    type: "Feature", properties: { v: 1 },
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }] };
  check("lines are not samples", idwRaster(lines, "v", unitBox) === null);
  check("a collapsed AOI means no raster",
    idwRaster(valued([[0.5, 0.5, 3]]), "v", { minX: 1, minY: 0, maxX: 1, maxY: 1 }) === null);
}

{
  const withNull = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { v: 8 }, geometry: null },
    { type: "Feature", properties: { v: 8 }, geometry: { type: "Point", coordinates: [0.5, 0.5] } },
  ] };
  const r = idwRaster(withNull, "v", unitBox, { cellsAcross: 4 });
  check("a feature with no geometry is skipped, not fatal", !!r && r.pointCount === 1);
}

{
  // A 2:1 AOI must come out 2:1 in cells, or every downstream metre-per-pixel
  // is wrong on one axis.
  const wide = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
  const r = idwRaster(valued([[0.5, 0.5, 1], [1.5, 0.5, 2]]), "v", wide, { cellsAcross: 10 });
  exact("a 2:1 AOI is 10 cells wide", r.width, 10);
  exact("a 2:1 AOI is 5 cells high", r.height, 5);
}

{
  const r = idwRaster(valued([[0.5, 0.5, 1]]), "v", unitBox, { cellsAcross: 1000, maxCells: 100 });
  check("maxCells caps the allocation", r.width * r.height <= 100,
    `got ${r.width}x${r.height}`);
  exact("the capped grid keeps the AOI aspect", r.width, r.height);
}

/* ══════════════════════════ Delaunay ══════════════════════════ */

const square = [[0, 0], [1, 0], [1, 1], [0, 1]];

{
  const tris = delaunay(square);
  exact("a square triangulates into 2 triangles", tris.length, 2);
  const area = tris.reduce((s, [a, b, c]) => s + triArea(square[a], square[b], square[c]), 0);
  near("the 2 triangles cover the square's area exactly", area, 1, 1e-12);
  check("every index is in range",
    tris.every((t) => t.every((i) => Number.isInteger(i) && i >= 0 && i < square.length)));
  check("no triangle repeats a vertex",
    tris.every(([a, b, c]) => a !== b && b !== c && a !== c));
  check("triangles are wound counter-clockwise",
    tris.every(([a, b, c]) => (square[b][0] - square[a][0]) * (square[c][1] - square[a][1])
      - (square[c][0] - square[a][0]) * (square[b][1] - square[a][1]) > 0));
}

{
  // The 5th point is strictly inside, so it must break the square's two
  // triangles into four — this is the insertion the empty-circle rule forces.
  const pts = [...square, [0.5, 0.5]];
  const tris = delaunay(pts);
  exact("a square plus an interior point gives 4 triangles", tris.length, 4);
  const area = tris.reduce((s, [a, b, c]) => s + triArea(pts[a], pts[b], pts[c]), 0);
  near("the 4 triangles still cover exactly area 1", area, 1, 1e-12);
  check("the interior point is used by the triangulation",
    tris.some((t) => t.includes(4)));

  let violations = 0;
  tris.forEach(([a, b, c]) => {
    const cc = circum(pts[a], pts[b], pts[c]);
    if (!cc) { violations += 1; return; }
    pts.forEach((p, i) => {
      if (i === a || i === b || i === c) return;
      const d2 = (p[0] - cc.x) ** 2 + (p[1] - cc.y) ** 2;
      if (d2 < cc.r2 * (1 - 1e-9)) violations += 1;
    });
  });
  exact("no circumcircle swallows a 5th point (empty-circle property)", violations, 0);
}

{
  const dupes = [[0, 0], [1, 0], [1, 1], [0, 1], [1, 1]];
  const tris = delaunay(dupes);
  exact("a duplicated point does not add triangles", tris.length, 2);
  const area = tris.reduce((s, [a, b, c]) => s + triArea(dupes[a], dupes[b], dupes[c]), 0);
  near("a duplicated point does not change the covered area", area, 1, 1e-12);
  check("indices point at the first occurrence, never the duplicate",
    tris.every((t) => !t.includes(4)));
}

{
  check("fewer than 3 points cannot be triangulated", delaunay([[0, 0], [1, 1]]).length === 0);
  check("an empty list gives no triangles", delaunay([]).length === 0);
  check("a non-array gives no triangles", delaunay(null).length === 0);
  check("collinear points give no triangles",
    delaunay([[0, 0], [1, 1], [2, 2], [3, 3]]).length === 0);
  check("three coincident points give no triangles",
    delaunay([[1, 1], [1, 1], [1, 1]]).length === 0);
}

{
  // 6 points in convex position: a convex polygon of n vertices triangulates
  // into exactly n-2 triangles, whatever the diagonals chosen. An ellipse
  // rather than a circle, so no four of them are cocircular.
  const hex = [];
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3;
    hex.push([2 * Math.cos(a), Math.sin(a)]);
  }
  const tris = delaunay(hex);
  exact("a convex hexagon gives n-2 triangles", tris.length, 4);
  const area = tris.reduce((s, [a, b, c]) => s + triArea(hex[a], hex[b], hex[c]), 0);
  near("the triangles cover the hexagon exactly", area, Math.abs(ringArea(hex)), 1e-12);
}

{
  // Corners fixed, so the hull is the 2x2 square and its area is 4 by
  // construction; the interior points are nudged off the lattice to keep any
  // four of them from being cocircular.
  const grid = [
    [0, 0], [2, 0], [2, 2], [0, 2],
    [1, 0.07], [1.93, 1], [1, 1.94], [0.06, 1],
    [1.02, 0.98],
  ];
  const tris = delaunay(grid);
  const area = tris.reduce((s, [a, b, c]) => s + triArea(grid[a], grid[b], grid[c]), 0);
  near("a 9-point set covers its hull exactly", area, 4, 1e-9);
  // Euler: a triangulation of n points with h on the hull has 2n-2-h triangles.
  exact("the triangle count is 2n-2-h", tris.length, 2 * 9 - 2 - 4);
  check("no triangle is degenerate",
    tris.every(([a, b, c]) => triArea(grid[a], grid[b], grid[c]) > 1e-9));

  let violations = 0;
  tris.forEach(([a, b, c]) => {
    const cc = circum(grid[a], grid[b], grid[c]);
    if (!cc) { violations += 1; return; }
    grid.forEach((p, i) => {
      if (i === a || i === b || i === c) return;
      const d2 = (p[0] - cc.x) ** 2 + (p[1] - cc.y) ** 2;
      if (d2 < cc.r2 * (1 - 1e-9)) violations += 1;
    });
  });
  exact("the 9-point triangulation is empty-circle clean", violations, 0);
}

/* ═════════════════════════════ TIN ═════════════════════════════ */

// Planted plane: three samples on it define it, so linear interpolation over
// their triangle must reproduce it to floating point everywhere inside.
const plane = (x, y) => 2 * x + 3 * y + 1;

{
  const corners = [[0.15, 0.20], [0.85, 0.25], [0.45, 0.90]];
  const fc = valued(corners.map(([x, y]) => [x, y, plane(x, y)]));
  const r = tinRaster(fc, "v", unitBox, { cellsAcross: 16 });
  check("tin returns a raster for three samples", !!r);
  exact("tin grid is 16 wide", r.width, 16);
  exact("tin triangulates into one triangle", r.triangleCount, 1);
  check("tin marks NaN as noData", Number.isNaN(r.noData));

  const inside = [];
  for (let row = 0; row < r.height; row += 1) {
    for (let col = 0; col < r.width; col += 1) {
      if (Number.isFinite(at(r, col, row))) inside.push([col, row]);
    }
  }
  check("the hull covers some cells", inside.length > 10, `got ${inside.length}`);
  check("the hull is not the whole AOI", inside.length < r.width * r.height,
    `got ${inside.length} of ${r.width * r.height}`);

  const rand = lcg(20260816);
  const picked = [];
  while (picked.length < 10 && inside.length) {
    picked.push(inside[Math.floor(rand() * inside.length)]);
  }
  let worst = 0;
  picked.forEach(([col, row]) => {
    const want = plane(centreLon(r, col), centreLat(r, row));
    worst = Math.max(worst, Math.abs(at(r, col, row) - want));
  });
  check("the TIN reproduces the planted plane at 10 sampled cells", worst <= 1e-5,
    `worst error ${worst}`);
  picked.slice(0, 3).forEach(([col, row], k) => {
    near(`  plane cell ${k + 1} (col ${col}, row ${row})`, at(r, col, row),
      plane(centreLon(r, col), centreLat(r, row)), 1e-5);
  });

  // Corner cell (0,0) is at (0.03125, 0.96875): outside the triangle by
  // inspection, and a TIN must not extrapolate there.
  check("outside the hull is NaN, not an extrapolation", Number.isNaN(at(r, 0, 0)),
    `got ${at(r, 0, 0)}`);
}

{
  // A fourth on-plane sample splits the hull into more triangles; a plane is
  // still a plane, so the same cells must read the same values.
  const corners = [[0.10, 0.10], [0.90, 0.15], [0.85, 0.90], [0.15, 0.85]];
  const fc = valued(corners.map(([x, y]) => [x, y, plane(x, y)]));
  const r = tinRaster(fc, "v", unitBox, { cellsAcross: 16 });
  check("four samples give more than one triangle", r.triangleCount >= 2,
    `got ${r.triangleCount}`);
  let worst = 0;
  let counted = 0;
  for (let row = 0; row < r.height; row += 1) {
    for (let col = 0; col < r.width; col += 1) {
      const v = at(r, col, row);
      if (!Number.isFinite(v)) continue;
      counted += 1;
      worst = Math.max(worst, Math.abs(v - plane(centreLon(r, col), centreLat(r, row))));
    }
  }
  check("a plane stays planar across a shared triangle edge", worst <= 1e-5,
    `worst ${worst} over ${counted} cells`);
  check("both triangles were filled", counted > 60, `got ${counted}`);
}

{
  check("fewer than 3 samples give no TIN",
    tinRaster(valued([[0.2, 0.2, 1], [0.8, 0.8, 2]]), "v", unitBox) === null);
  check("no samples give no TIN",
    tinRaster({ type: "FeatureCollection", features: [] }, "v", unitBox) === null);
  check("collinear samples give no TIN",
    tinRaster(valued([[0.1, 0.1, 1], [0.4, 0.4, 2], [0.8, 0.8, 3]]), "v", unitBox) === null);
  check("a collapsed AOI gives no TIN",
    tinRaster(valued([[0.2, 0.2, 1], [0.8, 0.3, 2], [0.5, 0.9, 3]]), "v",
      { minX: 0, minY: 1, maxX: 1, maxY: 1 }) === null);
}

/* ═══════════════════════════ Voronoi ═══════════════════════════ */

{
  // Two generators on the same latitude: the bisector is the meridian half way
  // between them, x = 0.5, whatever scaling is applied to either axis.
  const fc = pointFc([[0.25, 0.5, { name: "A" }], [0.75, 0.5, { name: "B" }]]);
  const out = voronoiPolygons(fc, unitBox);
  exact("two generators give two cells", out.features.length, 2);
  check("cells are Polygons", out.features.every((f) => f.geometry.type === "Polygon"));
  check("rings are closed", out.features.every((f) => {
    const ring = f.geometry.coordinates[0];
    return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  }));
  check("cells carry the source properties",
    out.features.map((f) => f.properties.name).sort().join("") === "AB");
  check("exterior rings are counter-clockwise",
    out.features.every((f) => ringArea(f.geometry.coordinates[0]) > 0));

  const cellOf = (name) => out.features.find((f) => f.properties.name === name)
    .geometry.coordinates[0];
  const A = cellOf("A");
  const B = cellOf("B");
  check("a cell west of the bisector belongs to A", pointInRing(A, 0.3, 0.5));
  check("a cell east of the bisector does not belong to A", !pointInRing(A, 0.7, 0.5));
  check("a cell east of the bisector belongs to B", pointInRing(B, 0.7, 0.5));
  check("a cell west of the bisector does not belong to B", !pointInRing(B, 0.3, 0.5));
  near("A's cell stops exactly at the perpendicular bisector",
    Math.max(...A.map((p) => p[0])), 0.5, 1e-12);
  near("B's cell starts exactly at the perpendicular bisector",
    Math.min(...B.map((p) => p[0])), 0.5, 1e-12);
  near("A takes half the box", Math.abs(ringArea(A)), 0.5, 0.005);
  near("B takes half the box", Math.abs(ringArea(B)), 0.5, 0.005);
  const total = out.features.reduce((s, f) => s + Math.abs(ringArea(f.geometry.coordinates[0])), 0);
  near("the cells tile the box (areas sum to its area)", total, 1, 0.01);
}

{
  const gens = [[0.25, 0.25, { name: "sw" }], [0.75, 0.25, { name: "se" }],
    [0.25, 0.75, { name: "nw" }], [0.75, 0.75, { name: "ne" }]];
  const out = voronoiPolygons(pointFc(gens), unitBox);
  exact("four generators give four cells", out.features.length, 4);
  const areas = out.features.map((f) => Math.abs(ringArea(f.geometry.coordinates[0])));
  const total = areas.reduce((s, a) => s + a, 0);
  near("four cells tile the box", total, 1, 0.01);
  check("each of the four cells is a quarter",
    areas.every((a) => Math.abs(a - 0.25) <= 0.0025), `got ${areas.join(", ")}`);
  check("every cell contains its own generator", out.features.every((f) => {
    const g = gens.find((p) => p[2].name === f.properties.name);
    return pointInRing(f.geometry.coordinates[0], g[0], g[1]);
  }));

  // The defining property: the cell a location falls in belongs to the
  // generator nearest that location. Probes avoid the bisectors x=0.5, y=0.5.
  let wrong = 0;
  const axis = [0.1, 0.3, 0.7, 0.9];
  axis.forEach((x) => axis.forEach((y) => {
    let best = null;
    let bestD = Infinity;
    gens.forEach((g) => {
      const d = (g[0] - x) ** 2 + (g[1] - y) ** 2;
      if (d < bestD) { bestD = d; best = g[2].name; }
    });
    const holder = out.features.find((f) => pointInRing(f.geometry.coordinates[0], x, y));
    if (!holder || holder.properties.name !== best) wrong += 1;
  }));
  exact("16 probes each land in their nearest generator's cell", wrong, 0);
}

{
  const out = voronoiPolygons(pointFc([[0.4, 0.6, { name: "only" }]]), unitBox);
  exact("a single generator gives one cell", out.features.length, 1);
  near("a single cell is the whole box", Math.abs(ringArea(out.features[0].geometry.coordinates[0])),
    1, 1e-12);
}

{
  const out = voronoiPolygons(pointFc([
    [0.25, 0.5, { name: "A" }], [0.75, 0.5, { name: "B" }], [0.25, 0.5, { name: "dup" }],
  ]), unitBox);
  exact("a coincident generator collapses onto the first", out.features.length, 2);
  check("the surviving cell keeps the first occurrence's properties",
    out.features.some((f) => f.properties.name === "A")
    && !out.features.some((f) => f.properties.name === "dup"));
}

{
  check("no generators gives an empty collection",
    voronoiPolygons({ type: "FeatureCollection", features: [] }, unitBox).features.length === 0);
  check("a collapsed AOI gives an empty collection",
    voronoiPolygons(pointFc([[0.5, 0.5, {}]]),
      { minX: 0, minY: 0, maxX: 0, maxY: 1 }).features.length === 0);
  const out = voronoiPolygons(pointFc([[0.5, 0.5, { name: "in" }], [9, 9, { name: "far" }]]), unitBox);
  check("a generator outside the AOI cannot claim it",
    out.features.length === 1 && out.features[0].properties.name === "in",
    `got ${out.features.map((f) => f.properties.name).join(",")}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
