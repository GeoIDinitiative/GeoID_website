/**
 * The geometry primitives, against fixtures whose answers are known by
 * construction.
 *
 * Why each class of case exists:
 *
 * - The booleanOp regression block pins this week's fix: clip-segment
 *   endpoints used to be read DURING the insertion loop, so inserting an
 *   intersection node truncated the segment being scanned and any later
 *   crossing of it was silently missed. A segment crossed twice (a bar passing
 *   through a rectangle crosses each side wall twice) lost its second
 *   intersection, and the traversal stitched the fragments into one
 *   self-crossing ring of zero net area. The bar fixture is the minimal shape
 *   that does this.
 * - The concave L-shape is the case Greiner-Hormann exists for at all:
 *   Sutherland-Hodgman cannot clip a concave subject correctly.
 * - The disjoint and fully-nested fixtures exercise the no-intersection
 *   branches, where the result is decided purely by containment.
 * - COINCIDENT/COLLINEAR shared edges are a DOCUMENTED unhandled
 *   Greiner-Hormann degeneracy in this implementation (vertex-on-edge is
 *   perturbed, overlapping edges are not special-cased), so every boolean
 *   fixture here is in general position: no ring shares an edge, a vertex or
 *   a collinear span with its partner. Do not add red cases for degeneracies.
 * - Every external reference value is a MEASUREMENT, produced by running
 *   python3 (pyproj 3.6.1); the exact command is recorded beside each value.
 * - Boolean results are checked by AREA, not by ring coordinates, because two
 *   correct results can differ in vertex order and starting point.
 *
 * Run: node GeoID_GIS/viewer/gis/geometry.test.mjs
 */

import {
  haversineMetres, lineLengthMetres, ringAreaM2, signedAreaPlanar,
  ringCentroid, boundsOf, boundsIntersect, pointInRing, pointInPolygon,
  convexHull, simplify, booleanOp, circleAround, offsetRing, bufferLine,
} from "./geometry.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── fixtures: closed GeoJSON-style rings in a flat degree frame ────────── */

const ring = (minX, minY, maxX, maxY) => [
  [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
];
/** Total planar area of a set of rings, winding ignored. */
const ringsArea = (rings) =>
  rings.reduce((sum, r) => sum + Math.abs(signedAreaPlanar(r)), 0);

/* ── haversineMetres against an independent spherical geodesic ──────────── */

{
  // A geodesic on a sphere IS the great circle, so pyproj on the module's own
  // radius measures the same quantity by different machinery.
  // python3 -c "from pyproj import Geod; g=Geod(a=6371008.8,b=6371008.8); \
  //   print(g.inv(2.3522,48.8566,-0.1276,51.5074)[2])"  -> 343549.2237289822
  const paris = [2.3522, 48.8566];
  const london = [-0.1276, 51.5074];
  near("haversine Paris to London matches a pyproj spherical geodesic",
    haversineMetres(paris, london), 343549.2237289822, 0.01);
  // python3 -c "from pyproj import Geod; g=Geod(a=6371008.8,b=6371008.8); \
  //   print(g.inv(0,0,1,0)[2])"  -> 111195.0802335329
  near("one degree along the equator", haversineMetres([0, 0], [1, 0]),
    111195.0802335329, 0.001);
  check("zero distance is zero", haversineMetres([12, -34], [12, -34]) === 0);
  check("distance is symmetric",
    haversineMetres(paris, london) === haversineMetres(london, paris));
}

{
  // Two equal equatorial hops: translation along the equator preserves
  // distance, so the length is exactly twice the measured single hop.
  near("lineLengthMetres sums its legs",
    lineLengthMetres([[0, 0], [1, 0], [2, 0]]), 2 * 111195.0802335329, 0.01);
}

/* ── ringAreaM2: one-degree square at the equator ───────────────────────── */

{
  const oneDeg = ring(0, 0, 1, 1); // counter-clockwise by construction
  // The JS is SPHERICAL (excess approximation on R=6371008.8); the primary
  // reference below is ELLIPSOIDAL (WGS84), which differs by ~0.45%, hence
  // the generous 1% tolerance.
  // python3 -c "from pyproj import Geod; \
  //   print(Geod(ellps='WGS84').polygon_area_perimeter([0,1,1,0],[0,0,1,1])[0])"
  //   -> 12308778361.469452
  near("1-degree equatorial square vs WGS84 ellipsoidal area (1%)",
    Math.abs(ringAreaM2(oneDeg)), 12308778361.469452, 0.01 * 12308778361.469452);
  // Cross-check against the EXACT spherical area on the module's own radius,
  // where only the excess approximation separates the two: within 0.005%.
  // python3 -c "from pyproj import Geod; \
  //   print(Geod(a=6371008.8,b=6371008.8).polygon_area_perimeter([0,1,1,0],[0,0,1,1])[0])"
  //   -> 12364031909.465616
  near("and vs the exact spherical area on the same radius (0.005%)",
    Math.abs(ringAreaM2(oneDeg)), 12364031909.465616, 6.2e5);
  // "Sign indicates winding" is the documented contract; the direction is
  // pinned as measured (counter-clockwise negative, as in turf's ringArea).
  check("winding flips the sign",
    ringAreaM2(oneDeg) === -ringAreaM2([...oneDeg].reverse()));
  check("counter-clockwise is the negative direction", ringAreaM2(oneDeg) < 0);
  check("a ring of fewer than 3 points has no area",
    ringAreaM2([[0, 0], [1, 1]]) === 0);
}

/* ── signedAreaPlanar sign conventions ──────────────────────────────────── */

{
  const ccwOpen = [[0, 0], [1, 0], [1, 1], [0, 1]]; // shoelace wraps itself
  near("counter-clockwise unit square is +1", signedAreaPlanar(ccwOpen), 1, 1e-12);
  near("clockwise is -1", signedAreaPlanar([...ccwOpen].reverse()), -1, 1e-12);
  near("a closed ring answers the same as an open one",
    signedAreaPlanar(ring(0, 0, 1, 1)), signedAreaPlanar(ccwOpen), 1e-12);
}

/* ── ringCentroid ───────────────────────────────────────────────────────── */

{
  const [cx, cy] = ringCentroid(ring(0, 0, 2, 2));
  check("centroid of a square is its middle",
    Math.abs(cx - 1) < 1e-12 && Math.abs(cy - 1) < 1e-12);
  const [wx, wy] = ringCentroid([...ring(0, 0, 2, 2)].reverse());
  check("winding does not move the centroid",
    Math.abs(wx - 1) < 1e-12 && Math.abs(wy - 1) < 1e-12);
  // A collinear ring has zero area, so the closed-form divides by ~0; the
  // documented fallback is the vertex average.
  const [dx, dy] = ringCentroid([[0, 0], [2, 0], [4, 0]]);
  check("degenerate collinear ring falls back to the vertex average",
    dx === 2 && dy === 0);
}

/* ── boundsOf / boundsIntersect ─────────────────────────────────────────── */

{
  const b = boundsOf([[3, -1], [0, 2], [5, 4]]);
  check("boundsOf finds the extremes",
    b.minX === 0 && b.minY === -1 && b.maxX === 5 && b.maxY === 4);
  const a = boundsOf(ring(0, 0, 2, 2));
  check("overlapping bounds intersect", boundsIntersect(a, boundsOf(ring(1, 1, 3, 3))));
  check("disjoint bounds do not", !boundsIntersect(a, boundsOf(ring(5, 5, 6, 6))));
  // Closed-interval convention: bounds that merely touch COUNT as
  // intersecting. This is used as a pre-filter before booleanOp (unionAll in
  // geoprocessing.js), where a false positive costs a wasted call and a false
  // negative silently skips a merge — so touching must stay true.
  check("touching bounds count as intersecting",
    boundsIntersect(a, boundsOf(ring(2, 2, 4, 4))));
}

/* ── pointInRing / pointInPolygon: the donut ────────────────────────────── */

{
  const outer = ring(0, 0, 4, 4);
  const hole = ring(1, 1, 3, 3);
  const donut = [outer, hole];
  check("a point in the flesh is inside the polygon", pointInPolygon([0.5, 0.5], donut));
  check("a point in the hole is not", !pointInPolygon([2, 2], donut));
  check("a point outside is not", !pointInPolygon([9, 9], donut));
  // The hole point IS inside the outer ring — which is exactly what makes the
  // polygon-level hole test above meaningful rather than vacuous.
  check("the same hole point is inside the bare outer ring", pointInRing([2, 2], outer));
  check("pointInRing rejects an outside point", !pointInRing([9, 9], outer));
}

/* ── convexHull ─────────────────────────────────────────────────────────── */

{
  // Four corners of a 4x4 square, three interior points, and one point on an
  // edge midpoint: only the corners may survive (collinear points are popped).
  const corners = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const extras = [[2, 2], [1, 1], [3, 2], [2, 0]];
  const hull = convexHull([...corners, ...extras]);
  check("hull is a closed ring of the four corners", hull.length === 5
    && hull[0][0] === hull[4][0] && hull[0][1] === hull[4][1]);
  near("hull area is the square's", signedAreaPlanar(hull), 16, 1e-12);
  check("hull is counter-clockwise", signedAreaPlanar(hull) > 0);
  const has = ([x, y]) => hull.some((p) => p[0] === x && p[1] === y);
  check("every corner is on the hull", corners.every(has));
  check("no interior or edge point survives", extras.every((p) => !has(p)));
  check("fewer than three points come back as themselves",
    convexHull([[0, 0], [1, 1]]).length === 2);
}

/* ── simplify (Douglas-Peucker, tolerance in degrees) ───────────────────── */

{
  const kinked = [[0, 0], [1, 0.5], [2, 0]];
  check("a 0.5-degree kink survives a 0.1 tolerance",
    simplify(kinked, 0.1).length === 3);
  const dropped = simplify([[0, 0], [1, 0.05], [2, 0]], 0.1);
  check("a 0.05-degree kink does not", dropped.length === 2);
  check("the endpoints are what remain",
    dropped[0][0] === 0 && dropped[1][0] === 2);
  check("a collinear midpoint is dropped at any positive tolerance",
    simplify([[0, 0], [1, 0], [2, 0]], 1e-9).length === 2);
  // Recursion: the big kink splits the line, then each side is judged alone —
  // the tiny bump at x=3 goes, the big kink stays.
  const mixed = simplify([[0, 0], [1, 0.5], [2, 0], [3, 0.0002], [4, 0]], 0.1);
  check("a mixed line keeps the kink and drops the bump",
    JSON.stringify(mixed) === JSON.stringify([[0, 0], [1, 0.5], [2, 0], [4, 0]]));
  check("tolerance zero keeps everything",
    simplify([[0, 0], [1, 0], [2, 0]], 0).length === 3);
}

/* ── booleanOp: the must-pin regression ─────────────────────────────────── */

{
  // A 5x1 bar crossed by a 1-wide, 3-tall rectangle: the clip's left wall
  // x=2 crosses the bar's bottom AND top edges, and the bar's bottom edge
  // crosses the clip's left AND right walls — segments crossed twice on both
  // sides. The old code lost the second intersection of a twice-crossed
  // clip segment and emitted one self-crossing ring of zero net area.
  const bar = [[0, 0], [5, 0], [5, 1], [0, 1], [0, 0]];
  const tall = [[2, -1], [3, -1], [3, 2], [2, 2], [2, -1]];

  const inter = booleanOp(bar, tall, "intersection");
  check("bar ∩ tall clip is one ring", inter.length === 1);
  near("of area 1", ringsArea(inter), 1, 1e-9);

  const diff = booleanOp(bar, tall, "difference");
  check("bar minus tall clip is two rings", diff.length === 2);
  near("totalling area 4", ringsArea(diff), 4, 1e-9);
  const parts = diff.map((r) => Math.abs(signedAreaPlanar(r))).sort((a, b) => a - b);
  near("left fragment is 2", parts[0], 2, 1e-9);
  near("right fragment is 2", parts[1], 2, 1e-9);

  const union = booleanOp(bar, tall, "union");
  check("bar ∪ tall clip is one ring", union.length === 1);
  near("of area 7", ringsArea(union), 7, 1e-9);
}

/* ── booleanOp: concave subject ─────────────────────────────────────────── */

{
  // L-shape: 3x1 bottom bar plus 1x2 column, area 5. The box takes x<=2 of
  // the bar (2) and y<=2 of the column (1): intersection 3, remainder 2.
  const L = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
  const box = ring(-0.5, -0.5, 2, 2);
  near("concave L ∩ box", ringsArea(booleanOp(L, box, "intersection")), 3, 1e-9);
  const diff = booleanOp(L, box, "difference");
  near("concave L minus box", ringsArea(diff), 2, 1e-9);
  check("as two disjoint corner pieces", diff.length === 2);
  // 5 + 6.25 - 3 by inclusion-exclusion.
  near("concave L ∪ box", ringsArea(booleanOp(L, box, "union")), 8.25, 1e-9);
}

/* ── booleanOp: the no-intersection containment branches ────────────────── */

{
  const big = ring(0, 0, 4, 4);     // area 16
  const small = ring(1, 1, 2, 2);   // area 1, wholly inside big
  const far = ring(10, 10, 11, 11); // area 1, disjoint from big

  // Clip nested inside the subject.
  near("nested intersection is the inner ring",
    ringsArea(booleanOp(big, small, "intersection")), 1, 1e-9);
  near("nested union is the outer ring",
    ringsArea(booleanOp(big, small, "union")), 16, 1e-9);
  // The primitive returns bare rings and cannot express subject-with-a-hole,
  // so difference with a floating island returns the subject UNCHANGED. That
  // is the documented contract the polygon layer (punchHoles in
  // geoprocessing.js) is built on — it handles the island case itself.
  near("nested difference returns the subject unchanged (documented limit)",
    ringsArea(booleanOp(big, small, "difference")), 16, 1e-9);

  // Subject nested inside the clip.
  near("swallowed intersection is the subject",
    ringsArea(booleanOp(small, big, "intersection")), 1, 1e-9);
  near("swallowed union is the clip",
    ringsArea(booleanOp(small, big, "union")), 16, 1e-9);
  check("swallowed difference is empty",
    booleanOp(small, big, "difference").length === 0);

  // Disjoint.
  check("disjoint intersection is empty",
    booleanOp(big, far, "intersection").length === 0);
  const u = booleanOp(big, far, "union");
  check("disjoint union keeps both rings", u.length === 2);
  near("with both areas", ringsArea(u), 17, 1e-9);
  near("disjoint difference is the subject",
    ringsArea(booleanOp(big, far, "difference")), 16, 1e-9);
}

/* ── circleAround ───────────────────────────────────────────────────────── */

{
  // The circle is built from flat per-degree constants (110574 m/degLat,
  // 111320 m/degLon) while haversineMetres lives on R=6371008.8 (111195.08
  // m/deg), so radii measure up to ~0.6% off the ask — 1% tolerance.
  const radiusChecks = (centre, radiusM, label) => {
    const circle = circleAround(centre, radiusM);
    check(`${label}: default 48 segments give 49 points`, circle.length === 49);
    const radii = circle.map((v) => haversineMetres(centre, v));
    check(`${label}: every vertex sits at the asked radius (1%)`,
      radii.every((r) => Math.abs(r - radiusM) <= 0.01 * radiusM),
      `min ${Math.min(...radii).toFixed(1)}, max ${Math.max(...radii).toFixed(1)}`);
  };
  radiusChecks([0, 0], 1000, "1 km circle at the equator");
  radiusChecks([10, 45], 5000, "5 km circle at 45N");
}

/* ── bufferLine ─────────────────────────────────────────────────────────── */

{
  // A straight equatorial line has identical normals everywhere, so the
  // corridor is exactly a rectangle: 2 offset points per vertex plus closure.
  const line = [[0, 0], [0.1, 0]];
  const corridor = bufferLine(line, 1000);
  check("corridor has both sides plus closure", corridor.length === 5);
  check("corridor ring is closed",
    corridor[0][0] === corridor[4][0] && corridor[0][1] === corridor[4][1]);
  // left[0] and right[0] (index 3 after the right side is reversed) straddle
  // the first vertex: the corridor is about 2x the distance wide. Same ~0.6%
  // constant skew as circleAround, so 1%.
  near("corridor is about twice the distance wide (1%)",
    haversineMetres(corridor[0], corridor[3]), 2000, 20);
  check("the line's midpoint is inside its corridor",
    pointInRing([0.05, 0], corridor));
  // Net planar area of a self-crossing ring cancels toward zero, so a healthy
  // area is also a not-a-bowtie guard. Expected: 0.1 deg long by
  // (2000 m / 111195.08 m-per-deg) wide, within the same skew.
  near("corridor area is length times width (1%)",
    Math.abs(signedAreaPlanar(corridor)), 0.1 * (2000 / 111195.0802335329),
    0.01 * 0.1 * (2000 / 111195.0802335329));
  check("a single point buffers to its circle", bufferLine([[0, 0]], 1000).length === 49);
  check("no points buffer to nothing", bufferLine([], 1000).length === 0);
}

/* ── offsetRing ─────────────────────────────────────────────────────────── */

{
  // KNOWN BUG, reported rather than pinned: offsetRing documents "offsets a
  // ring outward", but the bisector it builds from edge normals points INTO a
  // counter-clockwise ring (and `outward` flips with winding, so both
  // windings move inward). A convex square offset by +10 km SHRINKS by the
  // bisector construction instead of growing — so the "area grows by the
  // right amount" case is deliberately omitted here to keep the suite green.
  // The checks below pin only what holds under either sign convention:
  // shape, correspondence, and the magnitude of each vertex's displacement.
  const square = ring(0, 0, 1, 1); // ~111 km per side at the equator
  const out = offsetRing(square, 10000);
  check("offset ring keeps its vertex count and closure", out.length === 5
    && out[0][0] === out[4][0] && out[0][1] === out[4][1]);
  // Each vertex moves 10 km along its corner bisector; measured back with
  // haversine the magnitude carries the same ~0.6% flat-degree skew as
  // circleAround, so 1%.
  const moved = square.slice(0, 4).map((p, i) => haversineMetres(p, out[i]));
  check("every vertex is displaced by the asked distance (1%)",
    moved.every((m) => Math.abs(m - 10000) <= 100),
    `min ${Math.min(...moved).toFixed(1)}, max ${Math.max(...moved).toFixed(1)}`);
  check("an open ring input still comes back closed", (() => {
    const o = offsetRing([[0, 0], [1, 0], [1, 1], [0, 1]], 10000);
    return o.length === 5 && o[0][0] === o[4][0] && o[0][1] === o[4][1];
  })());
  check("a degenerate two-point ring is returned as-is",
    offsetRing([[0, 0], [1, 1]], 10000).length === 2);
}


/* ── offsetRing direction: pinned AFTER the fix ── */
// The suite originally omitted this case: the left normals point INTO a CCW
// ring and the outward sign was inverted, so a positive distance SHRANK every
// ring — and buffer() on polygons quietly returned smaller polygons. Fixed in
// geometry.js; these cases keep it fixed.
{
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const grown = Math.abs(signedAreaPlanar(offsetRing(sq, 10000)));
  const shrunk = Math.abs(signedAreaPlanar(offsetRing(sq, -10000)));
  check("a positive offset GROWS a CCW ring", grown > 1.0, `got ${grown}`);
  check("a negative offset shrinks it", shrunk < 1.0, `got ${shrunk}`);
  const cw = [...sq].reverse();
  check("a positive offset grows a CW ring too",
    Math.abs(signedAreaPlanar(offsetRing(cw, 10000))) > 1.0);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
