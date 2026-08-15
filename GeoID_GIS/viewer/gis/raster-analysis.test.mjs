/**
 * The raster tools, against surfaces whose answers are known analytically.
 *
 * A plane of known gradient has one slope and one aspect everywhere, so a
 * terrain kernel that is wrong by a factor, a sign or a 90° rotation shows up
 * immediately — where real DEM data would just look plausible. Contours get a
 * cone, because a cone's contours are circles: closed rings, one per level,
 * with a known radius.
 *
 * Run: node GeoID_GIS/viewer/gis/raster-analysis.test.mjs
 */

import {
  makeRaster, cellSizeMetres, slope, aspect, hillshade, reclassify,
  rasterCalculator, zonalStatistics, contours, rasterToPoints,
  clipRasterByPolygon, rasterStatistics,
  resampleToGrid, parseReclassifyRules, distanceRaster,
  rasterizeByAttribute, weightedOverlay, sampleAtPoints,
} from "./raster-analysis.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── fixtures ── */

const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** width×height raster from f(col, row). Row 0 is the NORTH edge. */
function build(width, height, f, noData = null) {
  const band = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) band[y * width + x] = f(x, y);
  }
  return makeRaster(band, width, height, bounds, noData);
}

const flat = build(8, 8, () => 100);
// Rises 10 per cell toward the EAST. Row 0 is north, so this has no
// north-south component at all.
const eastward = build(8, 8, (x) => x * 10);
// Rises 10 per cell toward the NORTH. Row 0 is north and holds the HIGHEST
// values, so value decreases with row index.
const northward = build(8, 8, (_x, y) => (7 - y) * 10);

/* ── cell size ── */

{
  // Returns {x, y}: a degree of longitude and a degree of latitude are not the
  // same length, and the terrain kernels divide by each axis separately.
  const size = cellSizeMetres(flat);
  check("cell size is a real ground distance on both axes",
    size.x > 10000 && size.x < 16000 && size.y > 10000 && size.y < 16000,
    `got ${JSON.stringify(size)}`);
  check("the two axes differ, as the metre-per-degree constants do",
    Math.abs(size.x - size.y) > 1);
}

/* ── slope ── */

{
  const s = slope(flat, { degrees: true });
  const values = [...s.band].filter(Number.isFinite);
  check("a flat surface has zero slope everywhere",
    values.every((v) => Math.abs(v) < 1e-6));
}
{
  // Interior cells only: the border uses clamped neighbours and is not the
  // measurement. Gradient is 10 per cell over ~13.9 km.
  const s = slope(eastward, { degrees: true });
  const interior = [];
  for (let y = 1; y < 7; y += 1) for (let x = 1; x < 7; x += 1) interior.push(s.band[y * 8 + x]);
  const first = interior[0];
  check("a constant-gradient plane has one slope everywhere",
    interior.every((v) => Math.abs(v - first) < 1e-6), `spread around ${first}`);
  // atan(rise / run) in degrees, run being the EAST-WEST cell size — small,
  // and it must be neither zero nor 90.
  const expect = (Math.atan(10 / cellSizeMetres(eastward).x) * 180) / Math.PI;
  near("and it is the arctangent of rise over run", first, expect, 1e-6);
}
{
  // The same plane turned 90° gives a slightly DIFFERENT slope, and that is
  // correct: the cell is 13.9 km across in longitude and 13.8 km in latitude,
  // so the same rise per cell is a slightly different gradient. What must hold
  // is that each matches its own axis — a kernel with its axes crossed passes
  // the "one slope everywhere" test above and fails here.
  const east = slope(eastward, { degrees: true }).band[3 * 8 + 3];
  const north = slope(northward, { degrees: true }).band[3 * 8 + 3];
  const cell = cellSizeMetres(eastward);
  near("an eastward plane uses the longitude cell size",
    east, (Math.atan(10 / cell.x) * 180) / Math.PI, 1e-6);
  near("a northward plane uses the latitude cell size",
    north, (Math.atan(10 / cell.y) * 180) / Math.PI, 1e-6);
  check("and the two differ only as the cell does", Math.abs(north - east) < 0.001);
}

/* ── aspect ── */

{
  // Aspect points DOWNHILL. Ground falling to the west (rising east) → 270°.
  const a = aspect(eastward).band[3 * 8 + 3];
  check("a plane rising eastward faces west", Math.abs(a - 270) < 1e-6, `got ${a}`);
}
{
  // Rising north → downhill is south → 180°.
  const a = aspect(northward).band[3 * 8 + 3];
  check("a plane rising northward faces south", Math.abs(a - 180) < 1e-6, `got ${a}`);
}

/* ── hillshade ── */

{
  const h = hillshade(flat).band;
  const values = [...h].filter(Number.isFinite);
  check("hillshade stays inside 0..255", values.every((v) => v >= 0 && v <= 255));
  const first = values[0];
  check("a flat surface shades evenly", values.every((v) => Math.abs(v - first) < 1e-6));
}
{
  // A slope lit from the north-west is brighter facing the light than away.
  const h = hillshade(eastward, { azimuth: 270, altitude: 45 }).band;
  const hAway = hillshade(eastward, { azimuth: 90, altitude: 45 }).band;
  check("lighting from the downhill side is brighter than from behind",
    h[3 * 8 + 3] > hAway[3 * 8 + 3]);
}

/* ── reclassify ── */

{
  const r = reclassify(eastward, [[0, 25, 1], [25, 100, 2]]);
  check("values map into their range's class",
    r.band[0] === 1 && r.band[7] === 2);
}
{
  // Outside every rule → no data, not silently zero.
  const r = reclassify(eastward, [[0, 5, 1]]);
  check("an unmatched value becomes no-data", Number.isNaN(r.band[7]) || r.band[7] === null);
}

/* ── raster calculator ── */

{
  const sum = rasterCalculator(eastward, eastward, "a + b");
  check("a + b doubles the band", sum.ok && sum.raster.band[5] === eastward.band[5] * 2);
}
{
  const ndvi = rasterCalculator(
    build(2, 2, () => 0.5), build(2, 2, () => 0.1), "(a - b) / (a + b)",
  );
  // Float32Array, so the tolerance is float32 epsilon rather than double.
  near("an NDVI-shaped expression computes", ndvi.raster.band[0], (0.5 - 0.1) / 0.6, 1e-7);
}
{
  // A malformed expression must be reported, not thrown from inside a loop.
  const bad = rasterCalculator(eastward, null, "a +* b");
  check("a broken expression is reported, not thrown", bad.ok === false && !!bad.message);
}

/* ── zonal statistics ── */

{
  const zones = { type: "FeatureCollection", features: [{
    type: "Feature", properties: { name: "west" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]] },
  }] };
  const rows = zonalStatistics(eastward, zones);
  check("one row per zone", rows.length === 1);
  check("the west half sees only the low values", rows[0].max < 40, `max ${rows[0].max}`);
  check("and reports a count of cells", rows[0].count > 0);
}
{
  // A zone smaller than one cell contains no cell centre. Reporting nothing is
  // the trap; the fallback reads the centroid and says that it did.
  const tiny = { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[
      [0.50, 0.50], [0.501, 0.50], [0.501, 0.501], [0.50, 0.501], [0.50, 0.50],
    ]] },
  }] };
  const rows = zonalStatistics(eastward, tiny);
  check("a sub-cell zone still returns a value", rows.length === 1 && rows[0].mean !== null);
  check("and flags that it fell back to the centroid", rows[0].centroidFallback === true);
}

/* ── contours: stitched, not one segment per cell ── */

{
  // A cone: value falls with distance from the middle, so each level is a
  // closed circle. Before stitching this returned hundreds of 2-point
  // LineStrings that could not be labelled, measured or exported as contours.
  const cone = build(40, 40, (x, y) => {
    const dx = x - 19.5;
    const dy = y - 19.5;
    return 100 - Math.hypot(dx, dy);
  });
  const out = contours(cone, [90]);
  check("one contour per level, not one per cell", out.features.length === 1,
    `got ${out.features.length}`);
  const line = out.features[0].geometry.coordinates;
  check("with many points chained together", line.length > 20, `got ${line.length}`);
  check("tagged with its level", out.features[0].properties.level === 90);
  // Closed: a contour that does not reach the raster edge is a loop.
  const [first] = line;
  const last = line[line.length - 1];
  check("and closed, because the level does not reach the edge",
    Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9);
}
{
  // Two levels → two separate contours, each its own feature.
  const cone = build(40, 40, (x, y) => 100 - Math.hypot(x - 19.5, y - 19.5));
  const out = contours(cone, [90, 95]);
  check("each level gets its own line", out.features.length === 2);
  check("and they carry different levels",
    out.features[0].properties.level !== out.features[1].properties.level);
}
{
  // The inner contour of a cone is the shorter one — a sanity check that the
  // chaining did not join two levels together.
  const cone = build(40, 40, (x, y) => 100 - Math.hypot(x - 19.5, y - 19.5));
  const out = contours(cone, [90, 95]);
  const byLevel = Object.fromEntries(out.features.map((f) =>
    [f.properties.level, f.geometry.coordinates.length]));
  check("the higher level makes the smaller ring", byLevel[95] < byLevel[90],
    `95→${byLevel[95]} points, 90→${byLevel[90]}`);
}
{
  check("a level outside the data yields nothing",
    contours(flat, [500]).features.length === 0);
}

/* ── raster to points ── */

{
  const pts = rasterToPoints(eastward, { step: 4 });
  check("stepping thins the output", pts.features.length === 4, `got ${pts.features.length}`);
  check("each carries its value", Number.isFinite(pts.features[0].properties.value));
}

/* ── clip raster by polygon ── */

{
  const zones = { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]] },
  }] };
  const clipped = clipRasterByPolygon(eastward, zones);
  const inside = clipped.band[4 * 8 + 1];
  const outside = clipped.band[4 * 8 + 7];
  check("cells inside the polygon keep their value", Number.isFinite(inside));
  check("cells outside become no-data", Number.isNaN(outside));
  check("the raster keeps its shape",
    clipped.width === eastward.width && clipped.height === eastward.height);
}

/* ── statistics ── */

{
  const stats = rasterStatistics(eastward);
  check("min and max span the data", stats.min === 0 && stats.max === 70);
  near("mean of a linear ramp is its midpoint", stats.mean, 35, 1e-6);
}
{
  // No-data must be excluded from statistics, not counted as a value.
  const holed = build(4, 4, (x) => (x === 0 ? -9999 : 10), -9999);
  const stats = rasterStatistics(holed);
  check("no-data is excluded from the count", stats.count === 12, `got ${stats.count}`);
  check("and from the range", stats.min === 10);
}

/* ── resample to grid ── */

{
  // A 2×2 quadrant raster resampled onto 8×8: each quadrant's value must fill
  // its own quarter of the finer grid exactly — nearest-neighbour invents
  // nothing and misplaces nothing.
  const quads = makeRaster(new Float32Array([1, 2, 3, 4]), 2, 2, bounds, null);
  const fine = resampleToGrid(quads, flat);
  check("NW quadrant lands north-west", fine.band[1 * 8 + 1] === 1);
  check("NE quadrant lands north-east", fine.band[1 * 8 + 6] === 2);
  check("SW quadrant lands south-west", fine.band[6 * 8 + 1] === 3);
  check("SE quadrant lands south-east", fine.band[6 * 8 + 6] === 4);
}
{
  // A source that covers only part of the template leaves the rest no-data.
  const half = makeRaster(new Float32Array([9]), 1, 1,
    { minX: 0, minY: 0.5, maxX: 1, maxY: 1 }, null);
  const out = resampleToGrid(half, flat);
  check("covered rows take the source value", out.band[0] === 9);
  check("uncovered rows stay no-data", Number.isNaN(out.band[7 * 8]));
}

/* ── reclassify rules text ── */

{
  const r = parseReclassifyRules("0..5:1, 5..12:2, 30..90:5");
  check("three pieces parse to three rules", r.ok && r.rules.length === 3);
  check("bounds and class survive verbatim",
    r.ok && r.rules[2][0] === 30 && r.rules[2][1] === 90 && r.rules[2][2] === 5);
}
{
  const r = parseReclassifyRules("-10..10:4");
  check("negative bounds parse", r.ok && r.rules[0][0] === -10);
}
{
  check("hyphen ranges are refused with the piece named",
    !parseReclassifyRules("5-10:1").ok
    && parseReclassifyRules("5-10:1").message.includes("5-10:1"));
  check("inverted bounds are refused", !parseReclassifyRules("10..5:1").ok);
  check("empty text is refused", !parseReclassifyRules("").ok);
}
{
  // The parsed rules must drive the existing reclassify unchanged.
  const parsed = parseReclassifyRules("0..30:1, 31..80:2");
  const r = reclassify(eastward, parsed.rules);
  check("parsed rules classify low values", r.band[0] === 1);
  check("and high values", r.band[6] === 2);
}

/* ── distance raster ── */

{
  // Seed the whole west edge with a meridian line: distance must then grow
  // purely eastward, one longitude-cell-width per column — an analytic answer
  // the chamfer meets exactly, because the path is axis-aligned.
  const line = { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: [[0.01, 0], [0.01, 1]] },
  }] };
  const d = distanceRaster(line, flat);
  const cell = cellSizeMetres(flat);
  check("seeded column reads zero", d.band[0] === 0);
  near("one column east is one cell-width away", d.band[1], cell.x, 1e-3);
  near("the far column is seven cell-widths away", d.band[7], 7 * cell.x, 1e-2);
  check("distance is uniform down a column",
    Math.abs(d.band[7] - d.band[7 * 8 + 7]) < 1e-6);
}
{
  // A polygon seeds its BOUNDARY, not its interior — distance inside the
  // polygon is distance to its edge.
  const poly = { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "Polygon",
      coordinates: [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]] },
  }] };
  const d = distanceRaster(poly, flat);
  const centre = d.band[4 * 8 + 4];
  check("the polygon interior is not zero", centre > 0, `got ${centre}`);
}

/* ── rasterize by attribute ── */

{
  const zones = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { score: 5 },
      geometry: { type: "Polygon",
        coordinates: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]] } },
    { type: "Feature", properties: { score: 2 },
      geometry: { type: "Polygon",
        coordinates: [[[0.5, 0], [1, 0], [1, 1], [0.5, 1], [0.5, 0]]] } },
  ] };
  const r = rasterizeByAttribute(zones, "score", flat);
  check("west polygon burns its value", r.band[4 * 8 + 1] === 5);
  check("east polygon burns its value", r.band[4 * 8 + 6] === 2);
}
{
  // Overlap: the later feature wins, matching gdal_rasterize.
  const zones = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { v: 1 },
      geometry: { type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    { type: "Feature", properties: { v: 9 },
      geometry: { type: "Polygon",
        coordinates: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]] } },
  ] };
  const r = rasterizeByAttribute(zones, "v", flat);
  check("later feature wins where they overlap", r.band[4 * 8 + 4] === 9);
  check("first feature keeps the rest", r.band[0] === 1);
}
{
  // A non-numeric attribute cannot be burned; those features are skipped, not
  // written as NaN-that-looks-deliberate or a made-up code.
  const zones = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { v: "basalt" },
      geometry: { type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
  ] };
  const r = rasterizeByAttribute(zones, "v", flat);
  check("text attributes leave no-data", Number.isNaN(r.band[30]));
}

/* ── weighted overlay ── */

{
  const fives = build(8, 8, () => 5);
  const ones = build(8, 8, () => 1);
  // 0.75×5 + 0.25×1 = 4, everywhere. Weights given as 75/25 to prove the
  // normalisation — QGIS-style percentages must mean the same as fractions.
  const wo = weightedOverlay([{ raster: fives, weight: 75 }, { raster: ones, weight: 25 }]);
  check("weighted sum is exact", wo.ok && wo.raster.band[0] === 4, `got ${wo.raster?.band[0]}`);
  check("nothing needed resampling", wo.resampled === 0);
}
{
  // A cell missing ANY factor is unscored — never defaulted to zero.
  const holed = build(8, 8, (x, y) => (x === 3 && y === 3 ? NaN : 2));
  const full = build(8, 8, () => 4);
  const wo = weightedOverlay([{ raster: holed, weight: 1 }, { raster: full, weight: 1 }]);
  check("a hole in one factor holes the result", Number.isNaN(wo.raster.band[3 * 8 + 3]));
  check("elsewhere both factors score", wo.raster.band[0] === 3);
}
{
  // A coarser factor is resampled onto the reference grid, and says so.
  const coarse = makeRaster(new Float32Array([10, 10, 10, 10]), 2, 2, bounds, null);
  const fine = build(8, 8, () => 2);
  const wo = weightedOverlay([{ raster: fine, weight: 1 }, { raster: coarse, weight: 1 }]);
  check("mixed grids still score", wo.ok && wo.raster.band[0] === 6);
  check("and the resample is reported", wo.resampled === 1);
}
{
  check("zero total weight is refused", !weightedOverlay([{ raster: flat, weight: 0 }]).ok);
  check("no layers is refused", !weightedOverlay([]).ok);
}

/* ── sample at points ── */

{
  const pts = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "in" },
      geometry: { type: "Point", coordinates: [0.3, 0.7] } },
    { type: "Feature", properties: { name: "out" },
      geometry: { type: "Point", coordinates: [5, 5] } },
  ] };
  const out = sampleAtPoints(eastward, pts, "elev");
  const inside = out.features.find((f) => f.properties.name === "in");
  const outside = out.features.find((f) => f.properties.name === "out");
  // x=0.3 of an 8-wide raster is column 2, and eastward's value is 10x.
  check("a point reads the cell under it", inside.properties.elev === 20,
    `got ${inside.properties.elev}`);
  check("a point off the raster reads null, not zero", outside.properties.elev === null);
  check("existing attributes survive", inside.properties.name === "in");
  check("the hit count is honest", out.sampled === 1);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
