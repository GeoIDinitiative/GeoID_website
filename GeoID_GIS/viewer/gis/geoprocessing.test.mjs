/**
 * The overlay ops, against fixtures whose answers are known by construction.
 *
 * The bug this file exists to pin: the old overlay fed `polygon[0]` to the
 * ring primitive from both sides, so every interior ring was silently dropped
 * — clip a donut and the hole filled in, clip BY a donut and its hole was
 * treated as solid ground. The output was always a plausible single-ring
 * Polygon, which is why it survived: nothing errored, the numbers were just
 * wrong. Every case here is checked by AREA, not by ring coordinates, because
 * two correct results can differ in vertex order and starting point.
 *
 * Run: node GeoID_GIS/viewer/gis/geoprocessing.test.mjs
 */

import {
  featureCollection, feature, clip, difference, intersect, dissolve, union,
  buffer, multiRingBuffer, convexHull, centroids, simplifyCollection,
  spatialJoin, featureAreaM2, fieldStatistics, fieldCalculator,
} from "./geoprocessing.js";
import { signedAreaPlanar, pointInPolygon } from "./geometry.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── fixtures: squares and donuts in a flat degree frame near the equator ── */

const ring = (minX, minY, maxX, maxY) => [
  [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
];
const square = (minX, minY, maxX, maxY, props = {}) =>
  feature({ type: "Polygon", coordinates: [ring(minX, minY, maxX, maxY)] }, props);
/** A square with a square hole. */
const donut = (o, h, props = {}) =>
  feature({ type: "Polygon", coordinates: [ring(...o), ...(h ? [ring(...h)] : [])] }, props);
const fc = (...features) => featureCollection(features);

/** Planar area of a result FC in square degrees, holes negative — the honest
    measure of whether an overlay did the right thing. */
function areaDeg2(collection) {
  let total = 0;
  collection.features.forEach((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates]
      : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    polys.forEach((polygon) => {
      total += Math.abs(signedAreaPlanar(polygon[0]));
      polygon.slice(1).forEach((h) => { total -= Math.abs(signedAreaPlanar(h)); });
    });
  });
  return total;
}

/* ── plain clips still work ── */

{
  const out = clip(fc(square(0, 0, 2, 2)), fc(square(1, 1, 3, 3)));
  near("square ∩ square is the overlap", areaDeg2(out), 1, 1e-9);
  check("and stays a single Polygon", out.features[0].geometry.type === "Polygon");
}
{
  const out = difference(fc(square(0, 0, 2, 2)), fc(square(1, 1, 3, 3)));
  near("square minus overlapping square", areaDeg2(out), 3, 1e-9);
}
{
  const out = clip(fc(square(0, 0, 1, 1)), fc(square(5, 5, 6, 6)));
  check("disjoint clip is empty", out.features.length === 0);
}

/* ── the headline bug: subject holes survive ── */

{
  // Donut: 4×4 outer, 2×2 hole → area 12. Clipped by a big square that
  // covers it entirely: the answer is the donut itself, hole intact.
  const subject = donut([0, 0, 4, 4], [1, 1, 3, 3]);
  const out = clip(fc(subject), fc(square(-1, -1, 5, 5)));
  near("a donut clipped by a covering square keeps its hole", areaDeg2(out), 12, 1e-9);
  const polygon = out.features[0].geometry.type === "Polygon"
    ? out.features[0].geometry.coordinates : out.features[0].geometry.coordinates[0];
  check("the hole is present as an interior ring", polygon.length === 2);
  check("a point in the hole is outside the result", !pointInPolygon([2, 2], polygon));
  check("a point in the flesh is inside", pointInPolygon([0.5, 0.5], polygon));
}
{
  // Clip a donut to its left part: the hole straddles the cut, so the piece
  // keeps the hole's left half. Clip covers x −1..2, y −1..5 — in GENERAL
  // POSITION, sharing no edge with the subject: coincident edges are the
  // Greiner-Hormann degeneracy this implementation documents as unhandled,
  // and a fixture must not stand on it. Kept area: 2×4 − 2×1 = 6.
  const out = clip(fc(donut([0, 0, 4, 4], [1, 1, 3, 3])), fc(square(-1, -1, 2, 5)));
  near("a hole straddling the clip edge is halved with it", areaDeg2(out), 6, 1e-9);
}

/* ── clipping BY a donut: the mask's hole is not ground ── */

{
  // Subject sits entirely inside the mask's hole → nothing survives.
  const out = clip(fc(square(1.5, 1.5, 2.5, 2.5)), fc(donut([0, 0, 4, 4], [1, 1, 3, 3])));
  check("a subject inside the mask's hole clips to nothing", areaDeg2(out) < 1e-9);
}
{
  // Subject covers the whole donut mask → result is the donut's shape. 12.
  const out = clip(fc(square(-1, -1, 5, 5)), fc(donut([0, 0, 4, 4], [1, 1, 3, 3])));
  near("clipping by a donut yields the donut's area", areaDeg2(out), 12, 1e-9);
}

/* ── difference with donuts ── */

{
  // Subtract a small island floating wholly inside: 4×4 minus 1×1 = 15,
  // and the result must be a polygon WITH A HOLE, which the old code could
  // not express — it returned the subject unchanged.
  const out = difference(fc(square(0, 0, 4, 4)), fc(square(1.5, 1.5, 2.5, 2.5)));
  near("subtracting an island cuts a hole", areaDeg2(out), 15, 1e-9);
  check("expressed as an interior ring", out.features[0].geometry.coordinates.length === 2);
}
{
  // Subtract a donut: the mask's hole is ground the mask does NOT cover, so
  // that patch of the subject survives. 6×6 subject minus donut(12) = 24.
  const out = difference(fc(square(-1, -1, 5, 5)), fc(donut([0, 0, 4, 4], [1, 1, 3, 3])));
  near("subtracting a donut leaves the island in its hole", areaDeg2(out), 24, 1e-9);
  check("and the result is a MultiPolygon (frame + island)",
    out.features[0].geometry.type === "MultiPolygon");
}

/* ── fragmentation → MultiPolygon, attributes not multiplied ── */

{
  // A 1×5 bar minus its middle → two pieces, ONE feature.
  const out = difference(fc(square(0, 0, 5, 1, { name: "bar" })), fc(square(2, -1, 3, 2)));
  near("a bar cut in the middle keeps both ends", areaDeg2(out), 4, 1e-9);
  check("as one MultiPolygon feature", out.features.length === 1
    && out.features[0].geometry.type === "MultiPolygon"
    && out.features[0].geometry.coordinates.length === 2);
  check("with its attributes once", out.features[0].properties.name === "bar");
}

/* ── multi-polygon masks: clip means ANY, difference means ALL ── */

{
  // Feature spans two disjoint mask squares. The old sequential form computed
  // subject ∩ A ∩ B = empty. Correct: subject ∩ (A ∪ B) = 2.
  const masks = fc(square(0, 0, 1, 1), square(3, 0, 4, 1));
  const out = clip(fc(square(-1, 0, 5, 1)), masks);
  near("clip by two disjoint masks keeps both pieces", areaDeg2(out), 2, 1e-9);
}
{
  const masks = fc(square(0, 0, 1, 1), square(3, 0, 4, 1));
  const out = difference(fc(square(-1, 0, 5, 1)), masks);
  near("difference removes both masks", areaDeg2(out), 4, 1e-9);
}

/* ── orientation on emit ── */

{
  const out = clip(fc(donut([0, 0, 4, 4], [1, 1, 3, 3])), fc(square(-1, -1, 5, 5)));
  const polygon = out.features[0].geometry.type === "Polygon"
    ? out.features[0].geometry.coordinates : out.features[0].geometry.coordinates[0];
  check("outer ring is counter-clockwise", signedAreaPlanar(polygon[0]) > 0);
  check("hole is clockwise", signedAreaPlanar(polygon[1]) < 0);
}

/* ── points and lines against a donut mask ── */

{
  const pts = fc(
    feature({ type: "Point", coordinates: [0.5, 0.5] }, { where: "flesh" }),
    feature({ type: "Point", coordinates: [2, 2] }, { where: "hole" }),
    feature({ type: "Point", coordinates: [9, 9] }, { where: "outside" }),
  );
  const out = clip(pts, fc(donut([0, 0, 4, 4], [1, 1, 3, 3])));
  check("a point in the mask's flesh survives",
    out.features.some((f) => f.properties.where === "flesh"));
  check("a point in the mask's hole does not",
    !out.features.some((f) => f.properties.where === "hole"));
  check("nor one outside", !out.features.some((f) => f.properties.where === "outside"));
}

/* ── intersect() is clip with the same machinery ── */

{
  const out = intersect(fc(donut([0, 0, 4, 4], [1, 1, 3, 3])), fc(square(-1, -1, 2, 5)));
  near("intersect honours holes too", areaDeg2(out), 6, 1e-9);
}

/* ── buffer dissolves overlaps ── */

{
  // Two points 1 km apart, buffered 1 km: the circles overlap heavily, so the
  // answer is ONE shape. Un-dissolved this double-counts the lens where they
  // cross, which is what makes an area figure from a buffer wrong.
  const pts = fc(
    feature({ type: "Point", coordinates: [0, 0] }, {}),
    feature({ type: "Point", coordinates: [0.009, 0] }, {}),  // ~1 km east
  );
  const merged = buffer(pts, 1000);
  check("overlapping buffers merge to one feature", merged.features.length === 1);
  const separate = buffer(pts, 1000, { dissolve: false });
  check("and stay separate when asked", separate.features.length === 2);
  check("the merged area is less than the sum of the parts",
    areaDeg2(merged) < areaDeg2(separate) - 1e-9);
}
{
  // Far apart: nothing to merge, so both survive as their own features.
  const pts = fc(
    feature({ type: "Point", coordinates: [0, 0] }, {}),
    feature({ type: "Point", coordinates: [10, 10] }, {}),
  );
  check("disjoint buffers are not forced together", buffer(pts, 1000).features.length === 2);
}
{
  // A chain: A overlaps B, B overlaps C, A does not reach C. All one region —
  // this is what the re-scan after each merge is for.
  const pts = fc(
    feature({ type: "Point", coordinates: [0, 0] }, {}),
    feature({ type: "Point", coordinates: [0.015, 0] }, {}),
    feature({ type: "Point", coordinates: [0.030, 0] }, {}),
  );
  check("a chain of overlaps collapses to one", buffer(pts, 1000).features.length === 1);
}

/* ── simplify takes metres ── */

{
  // A line with a 50 m wiggle in the middle. A 100 m tolerance removes it; a
  // 10 m tolerance keeps it. Under the old degree-based unit both numbers
  // would have flattened the line to its endpoints.
  const wiggle = fc(feature({ type: "LineString", coordinates: [
    [0, 0], [0.01, 0.00045], [0.02, 0], // ~50 m off the straight line
  ] }, {}));
  const coarse = simplifyCollection(wiggle, 100).features[0].geometry.coordinates;
  const fine = simplifyCollection(wiggle, 10).features[0].geometry.coordinates;
  check("a 100 m tolerance drops a 50 m wiggle", coarse.length === 2);
  check("a 10 m tolerance keeps it", fine.length === 3);
}
{
  // The same shape at 60° north, where a degree of longitude is half as long.
  // In metres the outcome must not depend on latitude; in degrees it did.
  const at = (lat) => fc(feature({ type: "LineString", coordinates: [
    [0, lat], [0.01, lat + 0.00045], [0.02, lat],
  ] }, {}));
  const equator = simplifyCollection(at(0), 100).features[0].geometry.coordinates.length;
  const north = simplifyCollection(at(60), 100).features[0].geometry.coordinates.length;
  check("the same tolerance behaves the same at 60° north", equator === north);
}

/* ── the untouched ops still behave (regression floor for this module) ── */

{
  const out = dissolve(fc(square(0, 0, 1, 1, { k: "a" }), square(2, 0, 3, 1, { k: "a" })), "k");
  check("dissolve groups by field", out.features.length === 1
    && out.features[0].geometry.type === "MultiPolygon");
}
{
  const out = centroids(fc(square(0, 0, 2, 2)));
  const [x, y] = out.features[0].geometry.coordinates;
  check("centroid of a square is its middle", Math.abs(x - 1) < 1e-9 && Math.abs(y - 1) < 1e-9);
}
{
  const stats = fieldStatistics(fc(square(0, 0, 1, 1, { v: 2 }), square(0, 0, 1, 1, { v: 4 })), "v");
  check("field statistics mean", stats.mean === 3);
}
{
  const r = fieldCalculator(fc(square(0, 0, 1, 1, { a: 2, b: 3 })), "c", "a * b");
  check("field calculator computes", r.ok && r.collection.features[0].properties.c === 6);
}
{
  // featureAreaM2 already subtracted holes correctly — pin that it stays so.
  // 4°×4° minus 2°×2° at the equator; a degree is ~111.32 km.
  const area = featureAreaM2(donut([0, 0, 4, 4], [1, 1, 3, 3]));
  const deg = 111320;
  near("featureAreaM2 subtracts holes", area / (deg * deg), 12, 0.2);
}

/* ── Dissolve removes the shared boundary, and the union is CHECKED ──────── */

const ONE_SQ = featureAreaM2(square(0, 0, 1, 1));
const areaOf = (out) => out.features.reduce((sum, f) => sum + featureAreaM2(f), 0);

// Dissolve used to collect a group into one MultiPolygon WITHOUT merging it,
// which is ArcGIS's Merge and not its Dissolve: two squares overlapping by
// half reported the area of two whole squares.
near("dissolve removes the overlap, not just the row",
  +(areaOf(dissolve(fc(square(0, 0, 1, 1), square(0.5, 0.5, 1.5, 1.5)))) / ONE_SQ).toFixed(3),
  1.75, 0.02);

// The degenerate case: Greiner-Hormann does not handle collinear overlapping
// edges, and two boxes sharing a y-range exactly is the commonest shape in
// this app. It returned one ring with the area of ONE square, silently.
near("collinear overlapping edges still union correctly",
  +(areaOf(dissolve(fc(square(0, 0, 1, 1), square(0.5, 0, 1.5, 1)))) / ONE_SQ).toFixed(3),
  1.5, 0.02);

near("disjoint shapes keep both areas",
  +(areaOf(dissolve(fc(square(0, 0, 1, 1), square(5, 0, 6, 1)))) / ONE_SQ).toFixed(3),
  2, 0.02);

near("edge-touching shapes keep both areas",
  +(areaOf(dissolve(fc(square(0, 0, 1, 1), square(1, 0, 2, 1)))) / ONE_SQ).toFixed(3),
  2, 0.02);

near("a contained shape adds nothing",
  +(areaOf(dissolve(fc(square(0, 0, 2, 2), square(0.5, 0.5, 1.5, 1.5)))) / ONE_SQ).toFixed(3),
  4, 0.02);

check("dissolve returns one feature per group",
  dissolve(fc(square(0, 0, 1, 1), square(5, 0, 6, 1))).features.length === 1,
  "disjoint pieces are one MultiPolygon row");

/* ── Buffer shapes and the multi-ring buffer, against closed-form areas ──── */

{
  const pt = fc(feature({ type: "Point", coordinates: [0, 0] }));
  const lineFc = fc(feature({ type: "LineString", coordinates: [[0, 0], [0.5, 0]] }));
  const kmsq = (out) => areaOf(out) / 1e6;

  near("square point buffer is the 2d × 2d square",
    +kmsq(buffer(pt, 10000, { shape: "square" })).toFixed(0), 400, 6);
  near("round point buffer is unchanged by the option",
    +kmsq(buffer(pt, 10000, { shape: "round" })).toFixed(0), 314, 4);

  // Cap styles, each a closed-form delta on the flat corridor: square adds a
  // 2d × d rectangle at each end, round adds two semicircles (one circle).
  const flat = kmsq(buffer(lineFc, 10000, { shape: "flat" }));
  near("square caps add 2 × (2d × d)",
    +(kmsq(buffer(lineFc, 10000, { shape: "square" })) - flat).toFixed(0), 400, 8);
  near("round caps add one circle",
    +(kmsq(buffer(lineFc, 10000, { shape: "round" })) - flat).toFixed(0), 314, 8);
  check("round-capped line is one piece",
    buffer(lineFc, 10000, { shape: "round" }).features.length === 1);

  // Multi-ring: each band is the annulus between its distances.
  const rings = multiRingBuffer(pt, [10000, 20000, 30000]);
  check("multi-ring makes one feature per band", rings.features.length === 3,
    `got ${rings.features.length}`);
  rings.features.forEach((f) => {
    const d = f.properties.buffer_m / 1000;
    const inner = f.properties.buffer_min_m / 1000;
    near(`band ${inner}–${d} km is its annulus`,
      +(featureAreaM2(f) / 1e6).toFixed(0), +(Math.PI * (d * d - inner * inner)).toFixed(0), 12);
  });

  // Colliding sources: the outer ring of two near points merges, so its area
  // is LESS than two separate annuli.
  const two = fc(
    feature({ type: "Point", coordinates: [0, 0] }),
    feature({ type: "Point", coordinates: [0.25, 0] }),
  );
  const outer = multiRingBuffer(two, [10000, 20000]).features
    .filter((f) => f.properties.buffer_m === 20000)
    .reduce((sum, f) => sum + featureAreaM2(f), 0) / 1e6;
  check("colliding 20 km rings merge (area below two separate rings)",
    outer < 2 * Math.PI * (400 - 100), `got ${outer.toFixed(0)} km²`);

  // A dirty distance list means the bands it can honestly mean.
  const dirty = multiRingBuffer(pt, [20000, 10000, 10000, 0, -5]);
  check("distances are sorted, deduplicated and cleaned",
    dirty.features.map((f) => f.properties.buffer_m).join() === "10000,20000",
    dirty.features.map((f) => f.properties.buffer_m).join());
}

/* ── Collinear edges through CLIP and DIFFERENCE tile the subject ────────── */
// The exact pair the dialog sweep caught: the subject's right edge collinear
// with the mask's, one crossing where the traversal needs pairs, and the
// subject came through clip UNCUT. Clip and difference must tile the input.
{
  const subject = fc(square(10.3, 0.3, 10.7, 0.7, { id: 1 }));   // 0.16 deg²
  const mask = fc(square(10.2, 0.1, 10.7, 0.6));                  // shares x=10.7
  const clipped = areaOf(clip(subject, mask));
  const cut = areaOf(difference(subject, mask));
  const whole = areaOf(subject);
  near("collinear-edge clip keeps only the overlap",
    +(clipped / whole).toFixed(3), 0.75, 0.02);        // 0.4×0.3 of 0.4×0.4
  near("collinear-edge difference keeps only the rest",
    +(cut / whole).toFixed(3), 0.25, 0.02);
  near("clip + difference tile the subject",
    +((clipped + cut) / whole).toFixed(3), 1, 0.01);
}

/* ── The shredded-union case: an L-shape against a collinear mask ────────── */
// dissolve(PolyA) then union with a mask sharing the L's right edge: the raw
// primitive returned rings of area 0.02 and ~0, which read as "two rings, no
// overlap" and skipped the nudge. The union must be ONE ring of 0.39 deg².
{
  const lShape = dissolve(fc(
    square(10.0, 0.0, 10.4, 0.4), square(10.3, 0.3, 10.7, 0.7)));
  const mask = fc(square(10.2, 0.1, 10.7, 0.6));
  const merged = union(lShape, mask);
  near("L-shape unions across a collinear shared edge",
    +(areaOf(merged) / featureAreaM2(square(0, 0, 1, 1))).toFixed(3), 0.39, 0.01);
  check("that union is one feature", merged.features.length === 1,
    `got ${merged.features.length}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
