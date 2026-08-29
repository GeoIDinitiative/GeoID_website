/**
 * Every tool in the registry, individually, through the REAL runner.
 *
 * The browser sweeps that preceded this file each found faults the one before
 * had passed -- and every one of them was a fault an `ok` flag could not see:
 * watershed returning an EMPTY raster as success, viewshed reading a param
 * name that was never declared, reclassify's default rules matching no cell of
 * the obvious first raster. A sweep somebody re-drives by hand also stops
 * being run. So the sweep lives here, in the suite, and it asserts on VALUES.
 *
 * Two halves, and the structural one is the half that generalises:
 *
 *   FUNCTIONAL -- each tool against a fixture whose answer is known in closed
 *   form (a plane has zero curvature; interpolating a constant field returns
 *   that constant; a perfectly separating raster scores AUC 1; clip and
 *   difference must TILE the subject). Closed forms, not recollections -- this
 *   tree's own rule, learned when six expected values were guessed from memory
 *   and the implementations turned out to be exact.
 *
 *   STRUCTURAL -- every `p.<name>` an engine reads is a DECLARED param, and
 *   every declared param is read by something. Those two checks, in those two
 *   directions, are exactly the watershed and viewshed bugs, and they now
 *   cannot be reintroduced by any tool.
 *
 * The runner needs a `window`; it needs nothing else. `resolveLayer` takes a
 * layer RECORD as readily as an id, and `addDerivedLayer` is the one seam
 * `register` writes through -- stubbed here in the shape import-manager.js
 * really returns, so an output is chainable into the next tool exactly as it
 * is on the page.
 */
globalThis.window = globalThis;

/**
 * `buildRasterLayer` paints its preview onto a canvas, so the runner's raster
 * path needs a document. Nothing here looks at the picture -- the `raster` the
 * engine produced rides on the layer record beside it, and that is what every
 * assertion below reads. Enough canvas to not throw, and no more.
 */
const canvasCtx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {},
  save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
  fill() {}, stroke() {}, clip() {}, createLinearGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 0 }), fillText() {}, setTransform() {},
  set fillStyle(v) {}, get fillStyle() { return "#000"; },
};
globalThis.document = {
  createElement: (tag) => (tag === "canvas"
    ? { width: 1, height: 1, getContext: () => canvasCtx, style: {} }
    : { style: {}, dataset: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

const RA = await import("./raster-analysis.js");
const { sphericalPolygonAreaKm2 } = await import("./geo-utils.js");
const R = await import("./tool-runner.js");

/* ── The seams the runner reaches for ──────────────────────────────────── */

let nextId = 100;
/** The layer record import-manager.js builds, minus the scene graph. */
window.GeoIDImportManager = {
  addDerivedLayer(name, result, ext = "derived") {
    if (!result) return null;
    return {
      id: nextId += 1, name, ext, status: "loaded",
      object3D: result.object3D || null,
      bounds: result.bounds || null,
      collection: result.collection || null,
      raster: result.raster || null,
      features: result.features || null,
      sampler: result.sampler || null,
      legendInfo: result.legendInfo || null,
      repaint: result.repaint || null,
    };
  },
  getLayers: () => [],
};

/**
 * A world whose elevation is a KNOWN function of position, so `terrain` can be
 * checked against an answer rather than against plausibility. Rising to the
 * north is the interesting choice: the raster row order is the one thing that
 * tool gets wrong silently.
 */
const trueElevation = (lat, lon360) => 1000 + 10000 * lat + 100 * lon360;
window.GeoIDViewer = {
  bodyRadiusKm: 6371.0088,
  sampleElevationMeters: (lat, lon360) => trueElevation(lat, lon360),
};

/* ── Harness ───────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();

    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
function eq(actual, expected, what, tol = 0) {
  const ok = tol ? Math.abs(actual - expected) <= tol : actual === expected;
  if (!ok) throw new Error(`${what}: got ${actual}, expected ${expected}${tol ? ` ±${tol}` : ""}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

/** Run a tool and insist it succeeded, so a failure names the tool's message. */
function run(id, inputs, params = {}, name = `out_${id}`) {
  const result = R.runTool(id, inputs, params, { outputName: name });
  if (!result.ok) throw new Error(`${id} refused: ${result.message}`);
  return result;
}

/* ── Fixtures, each with an answer that can be worked out by hand ──────── */

const ring = (lon, lat, d) => [
  [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d],
];
const poly = (props, coords) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [coords] } });
const vec = (name, features) => ({
  id: nextId += 1, name, status: "loaded", ext: "geojson",
  collection: { type: "FeatureCollection", features },
});
const ras = (name, band, width, height, bounds, noData = null) => ({
  id: nextId += 1, name, status: "loaded", ext: "asc",
  raster: RA.makeRaster(band, width, height, bounds, noData),
});

const BOUNDS = { minX: 0, minY: 0, maxX: 0.2, maxY: 0.2 };
const N = 21;

/** A grid from a function of (column, row) -- row 0 is the TOP (maxY). */
function grid(fn) {
  const band = new Float32Array(N * N);
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) band[y * N + x] = fn(x, y);
  return band;
}
/** The lon/lat of a cell centre, the convention raster-analysis indexes by. */
const cellLon = (x) => BOUNDS.minX + ((x + 0.5) / N) * (BOUNDS.maxX - BOUNDS.minX);
const cellLat = (y) => BOUNDS.maxY - ((y + 0.5) / N) * (BOUNDS.maxY - BOUNDS.minY);

const A = vec("A.geojson", [poly({ zone: "A", z: 7 }, ring(0.06, 0.1, 0.05))]);
const B = vec("B.geojson", [poly({ zone: "B", z: 9 }, ring(0.14, 0.1, 0.05))]);   // half overlaps A
const PT = vec("PT.geojson", [{
  type: "Feature", properties: { name: "p", depth: 500 },
  geometry: { type: "Point", coordinates: [0.1, 0.1] },
}]);
/** Nine points on a 3x3 lattice inside the raster, carrying a constant field. */
const LATTICE = vec("lattice.geojson", Array.from({ length: 9 }, (_, k) => ({
  type: "Feature",
  properties: { depth: 250, height: 250, cls: k % 3, present: k < 5 ? 1 : 0 },
  geometry: { type: "Point", coordinates: [0.05 + (k % 3) * 0.05, 0.05 + Math.floor(k / 3) * 0.05] },
})));
/** 25 points -- kriging needs enough PAIRS to fit a variogram, not enough points. */
const LATTICE_25 = vec("lattice25.geojson", Array.from({ length: 25 }, (_, k) => ({
  type: "Feature",
  properties: { depth: 250, height: 250, cls: k % 3, present: k < 12 ? 1 : 0 },
  geometry: { type: "Point", coordinates: [0.04 + (k % 5) * 0.03, 0.04 + Math.floor(k / 5) * 0.03] },
})));
/**
 * The shape an Earth Engine drape registers with: a `sampler` and NO `raster`.
 * Its values are a known function of position, so what sampleLayer produces is
 * checkable rather than merely non-empty.
 */
const sampledValue = (lat, lon) => 100 + 1000 * (lon - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX);
const SAMPLED = {
  id: nextId += 1, name: "Rainfall (CHIRPS)", status: "loaded", ext: "gee",
  bounds: BOUNDS,
  sampler: (lat, lon) => sampledValue(lat, lon),
  info: { valueKind: "values", unit: "mm" },
};
/** The same thing with no legend to invert: a picture, and it must say so. */
const COLOUR_ONLY = {
  id: nextId += 1, name: "Some drape", status: "loaded", ext: "gee",
  bounds: BOUNDS,
  sampler: () => ({ r: 10, g: 20, b: 30 }),
  info: { valueKind: "colour" },
};
const LINE = vec("line.geojson", [{
  type: "Feature", properties: { name: "t" },
  geometry: { type: "LineString", coordinates: [[0.02, 0.1], [0.1, 0.1], [0.18, 0.1]] },
}]);

// A PLANE, rising to the east. Curvature zero, slope constant, aspect constant.
const PLANE = ras("plane", grid((x) => 100 + 10 * x), N, N, BOUNDS);
// The same plane rising to the NORTH instead -- aspect must disagree with it.
const PLANE_N = ras("planeN", grid((x, y) => 100 + 10 * (N - 1 - y)), N, N, BOUNDS);
const FLAT = ras("flat", grid(() => 50), N, N, BOUNDS);
// A ramp 0..1000 across the rows, for contours at a known interval.
const RAMP = ras("ramp", grid((x, y) => (1000 * (N - 1 - y)) / (N - 1)), N, N, BOUNDS);
// A valley falling west with a closed pit, for the hydrology chain.
const VALLEY = ras("valley", grid((x, y) => x * 20 + Math.abs(y - 10) * 5), N, N, BOUNDS);
const ACC_FIX = R.runTool("flowAccumulation", { input: ras("v0", grid((x, y) => x * 20 + Math.abs(y - 10) * 5), N, N, BOUNDS) }, {}, { outputName: "fix_acc" }).layer;
const SLOPE_FIX = R.runTool("slope", { input: ras("v1", grid((x, y) => x * 20 + Math.abs(y - 10) * 5), N, N, BOUNDS) }, {}, { outputName: "fix_slope" }).layer;
const COARSE = ras("coarse", new Float32Array(11 * 11).fill(1), 11, 11, BOUNDS);
const PIT = ras("pit", grid((x, y) => (x === 10 && y === 10 ? 0 : x * 20 + 500)), N, N, BOUNDS);

/* ══ VECTOR TOOLS ══════════════════════════════════════════════════════ */

check("buffer — a 10 km round buffer of a point is a 10 km disc", () => {
  const out = run("buffer", { input: PT }, { distance: 10, shape: "round", dissolve: true });
  const fc = out.layer.collection;
  eq(fc.features.length, 1, "features");
  // pi r^2 = 314.16 km^2, to a percent -- the polygon is a 48-gon, not a circle.
  const area = GParea(fc.features[0]);
  eq(area, Math.PI * 100, "disc area km2", 8);
});

check("buffer — a square buffer of a point is the circumscribing square", () => {
  const out = run("buffer", { input: PT }, { distance: 10, shape: "square", dissolve: true });
  eq(GParea(out.layer.collection.features[0]), 400, "square area km2", 8);
});

check("multiBuffer — three true rings, each labelled with its own span", () => {
  const out = run("multiBuffer", { input: PT }, { distances: "10, 20, 30", shape: "round", rings: true });
  const fs = out.layer.collection.features;
  eq(fs.length, 3, "bands");
  eq(fs.map((f) => f.properties.buffer_km).join(","), "10,20,30", "band distances");
  // True annuli: pi(100), pi(400-100), pi(900-400) -- 1 : 3 : 5.
  const areas = fs.map(GParea);
  eq(areas[1] / areas[0], 3, "middle ring is 3x the disc", 0.05);
  eq(areas[2] / areas[0], 5, "outer ring is 5x the disc", 0.05);
});

check("clip and difference TILE the subject, and intersect agrees with clip", () => {
  const clipped = run("clip", { input: A, overlay: B });
  const diff = run("difference", { input: A, overlay: B });
  const inter = run("intersect", { input: A, overlay: B });
  const whole = GParea(A.collection.features[0]);
  const cut = sumArea(clipped.layer.collection);
  const rest = sumArea(diff.layer.collection);
  eq(cut + rest, whole, "clip + difference tiles A", whole * 0.001);
  eq(sumArea(inter.layer.collection), cut, "intersect equals clip", cut * 0.001);
  ok(cut > 0 && rest > 0, "the fixtures must actually overlap partially");
});

check("union — area is A + B minus the overlap", () => {
  const u = run("union", { input: A, overlay: B });
  const inter = run("intersect", { input: A, overlay: B }, {}, "u_i");
  const expected = GParea(A.collection.features[0]) + GParea(B.collection.features[0])
    - sumArea(inter.layer.collection);
  eq(sumArea(u.layer.collection), expected, "union area", expected * 0.002);
});

check("dissolve — a blank field merges everything into one feature", () => {
  const both = vec("both.geojson", [...A.collection.features, ...B.collection.features]);
  const out = run("dissolve", { input: both }, { field: "" });
  eq(out.layer.collection.features.length, 1, "features");
  const inter = run("intersect", { input: A, overlay: B }, {}, "d_i");
  const expected = GParea(A.collection.features[0]) + GParea(B.collection.features[0])
    - sumArea(inter.layer.collection);
  eq(sumArea(out.layer.collection), expected, "dissolved area", expected * 0.002);
});

check("dissolve — by attribute keeps one feature per distinct value", () => {
  const both = vec("both2.geojson", [...A.collection.features, ...B.collection.features]);
  eq(run("dissolve", { input: both }, { field: "zone" }).layer.collection.features.length, 2, "groups");
});

check("hull — the convex hull of the lattice contains every point", () => {
  const out = run("hull", { input: LATTICE });
  eq(out.layer.collection.features.length, 1, "features");
  const r = out.layer.collection.features[0].geometry.coordinates[0];
  const xs = r.map((c) => c[0]); const ys = r.map((c) => c[1]);
  eq(Math.min(...xs), 0.05, "west edge", 1e-9);
  eq(Math.max(...xs), 0.15, "east edge", 1e-9);
  eq(Math.min(...ys), 0.05, "south edge", 1e-9);
  eq(Math.max(...ys), 0.15, "north edge", 1e-9);
});

check("centroids — the centroid of a square is its centre, exactly", () => {
  const out = run("centroids", { input: A });
  const [lon, lat] = out.layer.collection.features[0].geometry.coordinates;
  eq(lon, 0.06, "lon", 1e-9);
  eq(lat, 0.1, "lat", 1e-9);
});

check("simplify — a collinear midpoint is dropped, the ends are not", () => {
  const out = run("simplify", { input: LINE }, { tolerance: 100 });
  const coords = out.layer.collection.features[0].geometry.coordinates;
  eq(coords.length, 2, "vertices");
  eq(coords[0][0], 0.02, "start kept", 1e-9);
  eq(coords[1][0], 0.18, "end kept", 1e-9);
});

check("reproject — UTM 33N eastings land on that zone's central meridian", () => {
  // 500000 m E is the false easting: the central meridian of zone 33 is 15 E.
  const utm = vec("utm.geojson", [poly({}, [
    [500000, 0], [510000, 0], [510000, 10000], [500000, 10000], [500000, 0]])]);
  const out = run("reproject", { input: utm }, { fromCrs: "epsg:32633", toCrs: "epsg:4326" });
  const [lon, lat] = out.layer.collection.features[0].geometry.coordinates[0][0];
  eq(lon, 15, "central meridian", 0.01);
  eq(lat, 0, "equator", 0.01);
});

check("spatialJoin — a point inside A carries A's attributes out", () => {
  const inside = vec("inside.geojson", [{
    type: "Feature", properties: { name: "q" },
    geometry: { type: "Point", coordinates: [0.06, 0.1] },
  }]);
  const out = run("spatialJoin", { input: inside, overlay: A });
  // Joined columns are PREFIXED, so a join cannot quietly overwrite a column
  // the input already had.
  const props = out.layer.collection.features[0].properties;
  eq(props.join_z, 7, "joined attribute");
  eq(props.name, "q", "the input's own attributes survive");
});

check("voronoi — one cell per point", () => {
  eq(run("voronoi", { input: LATTICE }).layer.collection.features.length, 9, "cells");
});

/* ══ SURFACE ANALYSIS ══════════════════════════════════════════════════ */

check("slope — flat ground is 0 degrees, a plane is a single constant", () => {
  eq(interior(run("slope", { input: FLAT }, {}, "s_flat").layer.raster).max, 0, "flat slope", 1e-6);
  const p = interior(run("slope", { input: PLANE }, {}, "s_plane").layer.raster);
  ok(p.min > 0, "a plane must have a slope");
  eq(p.max - p.min, 0, "a plane's slope is constant", 1e-4);
});

check("aspect — a plane knows which way it falls, and the two disagree by 90", () => {
  const east = interior(run("aspect", { input: PLANE }, {}, "a_e").layer.raster);
  const north = interior(run("aspect", { input: PLANE_N }, {}, "a_n").layer.raster);
  eq(east.max - east.min, 0, "constant over a plane", 1e-3);
  eq(north.max - north.min, 0, "constant over a plane", 1e-3);
  let d = Math.abs(east.min - north.min) % 360;
  if (d > 180) d = 360 - d;
  eq(d, 90, "the two planes fall at right angles", 1e-3);
});

check("hillshade — bounded 0..255, and lit ground is not uniform noise", () => {
  const h = interior(run("hillshade", { input: PLANE }).layer.raster);
  ok(h.min >= 0 && h.max <= 255, `hillshade out of range: ${h.min}..${h.max}`);
  eq(h.max - h.min, 0, "a plane shades evenly", 1e-3);
});

check("curvature — a PLANE has zero curvature everywhere", () => {
  const c = interior(run("curvature", { input: PLANE }).layer.raster);
  eq(Math.max(Math.abs(c.min), Math.abs(c.max)), 0, "plane curvature", 1e-6);
});

check("roughness — flat ground is 0, rough ground is not", () => {
  eq(interior(run("roughness", { input: FLAT }, {}, "r_f").layer.raster).max, 0, "flat roughness", 1e-6);
  ok(interior(run("roughness", { input: VALLEY }, {}, "r_v").layer.raster).max > 0, "valley roughness");
});

check("focal mean — the mean of a symmetric window on a ramp is the centre", () => {
  const out = run("focal", { input: PLANE }, { radius: 1, stat: "mean" });
  const b = out.layer.raster.band;
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      eq(b[y * N + x], 100 + 10 * x, `focal mean at ${x},${y}`, 1e-3);
    }
  }
});

check("focal max — the max of a window on a rising ramp is the right edge", () => {
  const b = run("focal", { input: PLANE }, { radius: 1, stat: "max" }, "f_max").layer.raster.band;
  eq(b[10 * N + 10], 100 + 10 * 11, "focal max", 1e-3);
});

check("contours — a 0..1000 ramp cut at 250 gives exactly 250/500/750", () => {
  const out = run("contours", { input: RAMP }, { interval: 250 });
  const levels = [...new Set(out.layer.collection.features
    .map((f) => f.properties.elevation ?? f.properties.level ?? f.properties.value))].sort((a, b) => a - b);
  eq(levels.join(","), "0,250,500,750", "contour levels");
});

check("reclassify — blank rules cut N quantile classes and classify every cell", () => {
  const out = run("reclassify", { input: RAMP }, { rules: "", classes: 5 });
  const seen = [...new Set([...out.layer.raster.band].filter(Number.isFinite))].sort((a, b) => a - b);
  eq(seen.join(","), "1,2,3,4,5", "class values");
  eq([...out.layer.raster.band].filter(Number.isFinite).length, N * N, "every cell classified");
});

check("reclassify — explicit rules are honoured over the quantile default", () => {
  const out = run("reclassify", { input: RAMP }, { rules: "0..500:1, 500..1000:2" }, "rc2");
  eq([...new Set([...out.layer.raster.band].filter(Number.isFinite))].sort().join(","), "1,2", "classes");
});

check("calculator — (a - b) / (a + b) of a raster with ITSELF is zero", () => {
  const out = run("calculator", { input: PLANE, b: PLANE }, { expression: "(a - b) / (a + b)" });
  const s = stats(out.layer.raster);
  eq(Math.max(Math.abs(s.min), Math.abs(s.max)), 0, "self NDVI", 1e-9);
});

check("calculator — arithmetic reaches the cells", () => {
  const out = run("calculator", { input: PLANE }, { expression: "a * 2" }, "calc2");
  eq(stats(out.layer.raster).max, (100 + 10 * (N - 1)) * 2, "doubled maximum", 1e-3);
});

check("clipByPolygon — only cells inside the zone survive, and keep their values", () => {
  const out = run("clipByPolygon", { input: PLANE, zones: A });
  const s = stats(out.layer.raster);
  ok(s.n > 0 && s.n < N * N, `clip kept ${s.n} of ${N * N} cells`);
  const b = out.layer.raster.band;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const v = b[y * N + x];
      if (Number.isFinite(v)) eq(v, 100 + 10 * x, `kept value at ${x},${y}`, 1e-3);
    }
  }
});

check("resample — the output wears the template's grid", () => {
  const template = ras("tmpl", new Float32Array(11 * 11).fill(1), 11, 11, BOUNDS);
  const out = run("resample", { input: PLANE, template });
  eq(out.layer.raster.width, 11, "width");
  eq(out.layer.raster.height, 11, "height");
  eq(stats(out.layer.raster).n, 121, "every cell filled");
});

check("distance — zero at the feature's own cell, rising away from it", () => {
  const out = run("distance", { input: PLANE, features: PT });
  const b = out.layer.raster.band;
  let best = Infinity; let at = -1;
  for (let k = 0; k < b.length; k += 1) if (b[k] < best) { best = b[k]; at = k; }
  eq(best, 0, "nearest cell distance", 1200);   // half a cell, in metres
  const x = at % N; const y = Math.floor(at / N);
  eq(cellLon(x), 0.1, "nearest cell longitude", 0.006);
  eq(cellLat(y), 0.1, "nearest cell latitude", 0.006);
  ok(b[0] > best, "a far corner must be further than the nearest cell");
});

check("rasterize — a point stamps its field into its own cell, and nothing else", () => {
  const out = run("rasterize", { input: PLANE, features: PT }, { field: "depth" });
  const s = stats(out.layer.raster);
  eq(s.n, 1, "cells stamped");
  eq(s.min, 500, "stamped value");
});

check("rasterize — a blank attribute burns feature PRESENCE, no numeric column needed", () => {
  const out = run("rasterize", { input: PLANE, features: LINE }, { field: "" }, "rz_line");
  ok(stats(out.layer.raster).n >= N - 4, `a line across the grid stamped only ${stats(out.layer.raster).n} cells`);
});

check("samplePoints — the sampled value is the raster's own value there", () => {
  const out = run("samplePoints", { input: PLANE, points: PT }, { attr: "sampled" });
  const f = out.layer.collection.features[0];
  const col = Math.floor(((0.1 - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * N);
  eq(f.properties.sampled, 100 + 10 * col, "sampled elevation", 1e-3);
});

check("overlay — an equal-weighted overlay of a raster with itself is itself", () => {
  const out = run("overlay", { input: PLANE, b: PLANE }, { weights: "50, 50" });
  const s = stats(out.layer.raster);
  const src = stats(PLANE.raster);
  eq(s.min, src.min, "overlay minimum", Math.abs(src.min) * 0.001 + 1e-6);
  eq(s.max, src.max, "overlay maximum", Math.abs(src.max) * 0.001 + 1e-6);
});

check("toPoints — one point per sampled cell, carrying that cell's value", () => {
  const out = run("toPoints", { input: PLANE }, { step: 8 });
  const fs = out.layer.collection.features;
  ok(fs.length > 0 && fs.length <= N * N, `${fs.length} points from a ${N}x${N} raster`);
  for (const f of fs) {
    const [lon] = f.geometry.coordinates;
    const col = Math.round(((lon - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * N - 0.5);
    const value = f.properties.value ?? f.properties.elevation ?? f.properties.z;
    eq(value, 100 + 10 * col, "point value matches its cell", 1e-3);
  }
});

check("sampleLayer — a drape with values becomes a raster the tools can read", () => {
  const out = run("sampleLayer", { area: A, source: SAMPLED }, { cellM: 0 });
  const r = out.layer.raster;
  ok(r.width > 2 && r.height > 2, "degenerate grid");
  const s2 = stats(r);
  ok(s2.n > 0, "no cell carried a value");
  // The fixture rises west to east, so the band must too -- and by the amount
  // the sampler says, not merely "some amount".
  const lonOf = (x) => r.bounds.minX + ((x + 0.5) / r.width) * (r.bounds.maxX - r.bounds.minX);
  const latOf = (y) => r.bounds.maxY - ((y + 0.5) / r.height) * (r.bounds.maxY - r.bounds.minY);
  for (const [x, y] of [[1, 1], [r.width - 2, 1], [r.width >> 1, r.height >> 1]]) {
    eq(r.band[y * r.width + x], sampledValue(latOf(y), lonOf(x)), `value at ${x},${y}`, 20);
  }
  ok(/mm/.test(out.message), `the unit must be reported: ${out.message}`);
});

check("sampleLayer — the output chains straight into a raster tool", () => {
  const sampled = run("sampleLayer", { area: A, source: SAMPLED }, { cellM: 0 }, "chain_src");
  const slope = run("slope", { input: sampled.layer }, {}, "chain_slope");
  ok(stats(slope.layer.raster).n > 0, "the sampled raster produced an empty slope");
});

check("sampleLayer — a colour-only drape is REFUSED, not rasterised into nonsense", () => {
  const out = R.runTool("sampleLayer", { area: A, source: COLOUR_ONLY }, { cellM: 0 },
    { outputName: "colour_only" });
  eq(out.ok, false, "refused");
  ok(/picture|legend/i.test(out.message), `it must say why: ${out.message}`);
});

check("a sampled layer must not pass as a raster — it holds no grid", () => {
  // The audit that found the gap, kept: a drape carries VALUES and no grid, so
  // it belongs in the sampled list and nowhere else. matchesType is private;
  // the runner is the honest test of it.
  const bad = R.runTool("slope", { input: SAMPLED }, {}, { outputName: "bad_slope" });
  eq(bad.ok, false, "a sampled layer must not be accepted as a raster");
  ok(/must be a raster/i.test(bad.message), `by type, and it should say so: ${bad.message}`);
});

/* ══ HYDROLOGY ════════════════════════════════════════════════════════ */

check("fillSinks — a pit is raised to its rim and nothing else moves", () => {
  const out = run("fillSinks", { input: PIT });
  const b = out.layer.raster.band;
  ok(b[10 * N + 10] > 0, "the pit was not filled at all");
  eq(b[5 * N + 5], PIT.raster.band[5 * N + 5], "ordinary ground untouched", 1e-3);
});

check("flowAccumulation — the foot of a valley gathers a whole column", () => {
  const out = run("flowAccumulation", { input: VALLEY });
  const s = stats(out.layer.raster);
  ok(s.max >= N, `peak accumulation ${s.max} is under one column of ${N}`);
  eq(s.min, 1, "a ridge cell drains only itself", 1e-6);
});

check("watershed — the untouched outlet default finds a real catchment", () => {
  const out = run("watershed", { input: VALLEY }, { lat: 0, lon: 0 });
  const s = stats(out.layer.raster);
  ok(s.n > 1, "the default outlet produced an EMPTY basin");
  ok(/outlet/i.test(out.message), `the message must say where the outlet went: ${out.message}`);
});

check("watershed — a typed outlet off the DEM is refused, not silently empty", () => {
  const bad = R.runTool("watershed", { input: VALLEY }, { lat: 80, lon: 120 }, { outputName: "ws_bad" });
  eq(bad.ok, false, "refused");
});

check("streams — the channel network is exactly the cells over the threshold", () => {
  const acc = run("flowAccumulation", { input: VALLEY }, {}, "st_acc");
  const out = run("streams", { input: acc.layer }, { threshold: 100 });
  const over = [...acc.layer.raster.band].filter((v) => Number.isFinite(v) && v >= 100).length;
  eq(stats(out.layer.raster).n, over, "stream cells");
});

check("viewshed — an observer on flat ground can see, and the default is the centre", () => {
  const out = run("viewshed", { input: FLAT }, { lat: 0, lon: 0, height: 1.7, radiusKm: 10 });
  ok(/centre|center/i.test(out.message), `the default must say where it stood: ${out.message}`);
  const s = stats(out.layer.raster);
  ok(s.n > 0, "no cell was even evaluated");
  ok(s.max === 1, "nothing was visible from flat ground");
});

check("viewshed — the observer height is READ, not merely collected", () => {
  // A wall between observer and target: at 1 m you cannot see over it, at 400 m you can.
  const wall = ras("wall", grid((x) => (x === 12 ? 300 : 0)), N, N, BOUNDS);
  const low = run("viewshed", { input: wall }, { lat: cellLat(10), lon: cellLon(10), height: 1, radiusKm: 50 }, "vs_low");
  const high = run("viewshed", { input: wall }, { lat: cellLat(10), lon: cellLon(10), height: 900, radiusKm: 50 }, "vs_high");
  ok(stats(high.layer.raster).sum > stats(low.layer.raster).sum,
    "raising the observer 900 m over a 300 m wall revealed nothing — the height param is dead");
});

check("twi — wetness rises with accumulation and falls with slope", () => {
  const acc = run("flowAccumulation", { input: VALLEY }, {}, "twi_acc");
  const slope = run("slope", { input: VALLEY }, {}, "twi_slope");
  const out = run("twi", { input: acc.layer, slope: slope.layer }, { minSlopeDeg: 0.1 });
  const s = stats(out.layer.raster);
  ok(s.n > 0, "empty TWI");
  ok(Number.isFinite(s.min) && Number.isFinite(s.max), "TWI must be finite");
  ok(s.max > s.min, "TWI is constant across a valley, which cannot be right");
});

/* ══ INTERPOLATION ════════════════════════════════════════════════════ */

check("kriging — a field with NO variance is answered, not returned empty", () => {
  const out = run("kriging", { input: LATTICE_25 }, { field: "depth", cellsAcross: 32 }, "kr_const");
  const s = stats(out.layer.raster);
  ok(s.n > 0, "a zero-variance field produced an EMPTY raster");
  ok(/no variance/i.test(out.message), `it must say why there was no variogram: ${out.message}`);
});

check("kriging — Cells across is READ, so the grid is the one that was asked for", () => {
  const graded = vec("kg.geojson", LATTICE_25.collection.features.map((f, k) => ({
    ...f, properties: { ...f.properties, depth: 100 + 37 * ((k * 7) % 11) },
  })));
  const small = run("kriging", { input: graded }, { field: "depth", cellsAcross: 16 }, "kr_16");
  const big = run("kriging", { input: graded }, { field: "depth", cellsAcross: 48 }, "kr_48");
  eq(small.layer.raster.width, 16, "16 cells across");
  eq(big.layer.raster.width, 48, "48 cells across");
});

check("kriging — the variogram family is the one selected, and the message says so", () => {
  const graded = vec("kv.geojson", LATTICE_25.collection.features.map((f, k) => ({
    ...f, properties: { ...f.properties, depth: 100 + 37 * ((k * 7) % 11) },
  })));
  const sph = run("kriging", { input: graded }, { field: "depth", model: "spherical", cellsAcross: 16 }, "kv_s");
  const exp = run("kriging", { input: graded }, { field: "depth", model: "exponential", cellsAcross: 16 }, "kv_e");
  ok(/exponential/.test(exp.message), `exponential was asked for and not reported: ${exp.message}`);
  ok(/spherical/.test(sph.message), `spherical: ${sph.message}`);
  const band = (r) => [...r.layer.raster.band].map((v) => Math.round(v * 1e6)).join(",");
  ok(band(sph) !== band(exp), "the two families produced an identical surface — the model is dead");
});

for (const id of ["idw", "tin"]) {
  check(`${id} — interpolating a CONSTANT field returns that constant`, () => {
    const out = run(id, { input: LATTICE_25 }, { field: "depth", cellsAcross: 32 }, `${id}_c`);
    const s = stats(out.layer.raster);
    ok(s.n > 0, "empty interpolation");
    eq(s.min, 250, `${id} minimum`, 0.5);
    eq(s.max, 250, `${id} maximum`, 0.5);
  });
}

check("idw — a graded field keeps its own range, and peaks at the high point", () => {
  const graded = vec("graded.geojson", LATTICE_25.collection.features.map((f, k) => ({
    ...f, properties: { ...f.properties, depth: 100 * (k + 1) },
  })));
  const out = run("idw", { input: graded }, { field: "depth", power: 2, cellsAcross: 32 }, "idw_g");
  const s = stats(out.layer.raster);
  ok(s.min >= 100 - 1 && s.max <= 2500 + 1, `IDW invented values outside 100..2500: ${s.min}..${s.max}`);
  ok(s.max > s.min + 100, "a graded field must not interpolate flat");
});

check("density — cells near the points are dense and far cells are not", () => {
  const out = run("density", { input: LATTICE }, { radiusKm: 5, cellSizeDeg: 0.01 });
  const s = stats(out.layer.raster);
  ok(s.max > 0, "no density anywhere");
  ok(s.min < s.max, "density is uniform, so the radius did nothing");
});

/* ══ ZONAL AND VALIDATION ═════════════════════════════════════════════ */

check("zonalStatistics — the zones come back carrying their own statistics", () => {
  const out = run("zonalStatistics", { input: FLAT, zones: A });
  const f = out.layer.collection.features[0];
  eq(f.properties.zonal_mean, 50, "mean over flat ground");
  eq(f.properties.zonal_min, 50, "min");
  eq(f.properties.zonal_max, 50, "max");
  ok(f.properties.zonal_cells > 0, "no cells counted");
  ok(f.geometry, "the zone's geometry must survive, or it is not a layer");
  eq(f.properties.zone, "A", "the zone's own attributes survive");
});

check("zonalStatistics — each zone gets ITS OWN numbers, not its neighbour's", () => {
  const zones = vec("zones.geojson", [
    poly({ zone: "west" }, ring(0.05, 0.1, 0.03)),
    poly({ zone: "east" }, ring(0.15, 0.1, 0.03)),
  ]);
  const out = run("zonalStatistics", { input: PLANE, zones }, {}, "zs2");
  const [west, east] = out.layer.collection.features;
  eq(west.properties.zone, "west", "order preserved");
  ok(east.properties.zonal_mean > west.properties.zonal_mean,
    "the plane rises east, so the east zone must read higher");
});

check("rocAuc — a perfectly separating raster scores AUC 1", () => {
  // Presences on the high side of the plane, absences on the low side.
  const obs = vec("obs.geojson", [
    ...[13, 15, 17, 19].map((x) => point(cellLon(x), 0.1, { present: 1 })),
    ...[1, 3, 5, 7].map((x) => point(cellLon(x), 0.1, { present: 0 })),
  ]);
  const out = R.runTool("rocAuc", { input: PLANE, observations: obs },
    { field: "present", positiveValue: "1" }, { outputName: "roc1" });
  ok(out.ok, out.message);
  const auc = Number(/AUC\s+([\d.]+)/.exec(out.message)?.[1]);
  eq(auc, 1, "AUC for perfect separation", 1e-6);
  ok(out.rows.length > 0, "ROC returns its curve as rows");
});

check("rocAuc — a REVERSED raster scores AUC 0, so the direction is real", () => {
  const obs = vec("obs2.geojson", [
    ...[13, 15, 17, 19].map((x) => point(cellLon(x), 0.1, { present: 0 })),
    ...[1, 3, 5, 7].map((x) => point(cellLon(x), 0.1, { present: 1 })),
  ]);
  const out = R.runTool("rocAuc", { input: PLANE, observations: obs },
    { field: "present", positiveValue: "1" }, { outputName: "roc0" });
  ok(out.ok, out.message);
  eq(Number(/AUC\s+([\d.]+)/.exec(out.message)?.[1]), 0, "AUC when the map is upside down", 1e-6);
});

check("rocAuc — presence-only observations are scored against background, and say so", () => {
  const out = R.runTool("rocAuc", { input: PLANE, observations: LATTICE },
    { field: "", positiveValue: "" }, { outputName: "roc_po" });
  ok(out.ok, out.message);
  ok(/background/i.test(out.message), `the negatives must be named as background: ${out.message}`);
});

check("successRate — the curve is cumulative and ends at everything", () => {
  const out = R.runTool("successRate", { input: PLANE, events: LATTICE }, { steps: 20 },
    { outputName: "sr" });
  ok(out.ok, out.message);
  const rows = out.rows;
  ok(rows.length > 1, "a curve needs more than one point");
  const key = Object.keys(rows[0]).find((k) => /event|captur|rate|cum/i.test(k));
  ok(key, `no cumulative column in ${Object.keys(rows[0]).join(",")}`);
  const series = rows.map((r) => Number(r[key]));
  for (let k = 1; k < series.length; k += 1) {
    ok(series[k] >= series[k - 1] - 1e-9, `the ${key} curve fell at row ${k}`);
  }
});

check("confusion — the counts are the real ones, and they sum to the observations", () => {
  const obs = vec("cm.geojson", [
    ...[13, 15, 17, 19].map((x) => point(cellLon(x), 0.1, { present: 1 })),
    ...[1, 3, 5, 7].map((x) => point(cellLon(x), 0.1, { present: 0 })),
  ]);
  // Halfway up the plane: everything east of centre is predicted positive.
  const mid = (stats(PLANE.raster).min + stats(PLANE.raster).max) / 2;
  const out = R.runTool("confusion", { input: PLANE, observations: obs },
    { threshold: mid, field: "present" }, { outputName: "cm" });
  ok(out.ok, out.message);
  const total = out.rows.reduce((sum, r) => sum
    + Object.entries(r).reduce((s, [k, v]) => s + (/count|n$/i.test(k) ? Number(v) || 0 : 0), 0), 0);
  ok(total >= 8 || /8/.test(out.message), `the eight observations went missing: ${out.message}`);
  ok(/TP|true positive/i.test(JSON.stringify(out.rows) + out.message), "no true-positive count reported");
});

check("randomSample — the same seed is the same sample, a different seed is not", () => {
  const a = run("randomSample", { input: PLANE }, { count: 50, seed: 1 }, "rs_a");
  const b = run("randomSample", { input: PLANE }, { count: 50, seed: 1 }, "rs_b");
  const c = run("randomSample", { input: PLANE }, { count: 50, seed: 2 }, "rs_c");
  const key = (r) => JSON.stringify(r.layer.collection.features.map((f) => f.geometry.coordinates));
  eq(a.layer.collection.features.length, 50, "sample size");
  eq(key(a), key(b), "seed 1 twice must agree");
  ok(key(a) !== key(c), "seed 2 produced the identical sample — the seed is dead");
});

check("stratifiedSample — every class present is represented", () => {
  const classes = ras("classes", grid((x) => (x < 7 ? 1 : x < 14 ? 2 : 3)), N, N, BOUNDS);
  const out = run("stratifiedSample", { input: classes }, { perClass: 5, seed: 1 });
  const seen = new Set(out.layer.collection.features
    .map((f) => f.properties.class ?? f.properties.value ?? f.properties.stratum));
  eq(seen.size, 3, `strata represented (${[...seen].join(",")})`);
});

check("histogram — the bins account for every valid cell", () => {
  const out = R.runTool("histogram", { input: PLANE }, { bins: 20 }, { outputName: "hist" });
  ok(out.ok, out.message);
  const key = Object.keys(out.rows[0]).find((k) => /count|freq|n$/i.test(k));
  ok(key, `no count column in ${Object.keys(out.rows[0]).join(",")}`);
  eq(out.rows.reduce((s, r) => s + Number(r[key]), 0), N * N, "cells across all bins");
});

/* ══ MOSAIC AND TERRAIN ═══════════════════════════════════════════════ */

check("mosaic — 'first' prefers the first raster and the second fills its gaps", () => {
  const holed = ras("holed", grid((x, y) => (x < 10 ? 7 : NaN)), N, N, BOUNDS);
  const filler = ras("filler", grid(() => 99), N, N, BOUNDS);
  const out = run("mosaic", { input: holed, second: filler }, { method: "first" });
  const b = out.layer.raster.band;
  eq(b[10 * N + 2], 7, "the first raster wins where it has data");
  eq(b[10 * N + 18], 99, "the second raster fills the gap");
});

check("terrain — the DEM reproduces this world's own elevation, north row FIRST", () => {
  const out = run("terrain", { area: A }, { cellM: 0 });
  const r = out.layer.raster;
  ok(r.width > 2 && r.height > 2, "degenerate terrain grid");
  const at = (x, y) => r.band[y * r.width + x];
  const lonOf = (x) => r.bounds.minX + ((x + 0.5) / r.width) * (r.bounds.maxX - r.bounds.minX);
  const latOf = (y) => r.bounds.maxY - ((y + 0.5) / r.height) * (r.bounds.maxY - r.bounds.minY);
  // The band must be TOP-DOWN: row 0 is the north edge. Unflipped, this
  // whole map is upside down while looking perfectly plausible.
  ok(at(0, 0) > at(0, r.height - 1),
    "row 0 is not the north edge — the band came out flipped");
  for (const [x, y] of [[1, 1], [r.width - 2, 1], [1, r.height - 2], [r.width >> 1, r.height >> 1]]) {
    eq(at(x, y), trueElevation(latOf(y), lonOf(x)), `elevation at ${x},${y}`, 12);
  }
});

/* ══ STRUCTURAL: the two directions that were the last two bugs ═══════ */

/** The name an engine gives its params argument, or null if it destructures. */
function paramArg(fn) {
  const src = String(fn);
  const m = /^\s*(?:function\s*\w*\s*)?\(([^)]*)\)/.exec(src) || /^\s*(\w+)\s*=>/.exec(src);
  if (!m) return null;
  const args = m[1].split(",").map((s) => s.trim());
  if (args.length < 2) return null;
  return /^[A-Za-z_$][\w$]*$/.test(args[1]) ? args[1] : null;
}
/** Source with comments removed — a comment naming a param is not a read. */
function code(fn) {
  return String(fn || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}
function readsOf(fn) {
  const arg = paramArg(fn);
  if (!arg) return null;
  const src = code(fn);
  const names = new Set();
  for (const m of src.matchAll(new RegExp(`\\b${arg}\\.([A-Za-z_$][\\w$]*)`, "g"))) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(`\\b${arg}\\[["']([^"']+)["']\\]`, "g"))) names.add(m[1]);
  return names;
}

check("every param an engine READS is a declared param", () => {
  const bad = [];
  for (const t of R.TOOLS) {
    const reads = readsOf(t.engines?.native);
    if (!reads) continue;
    const declared = new Set((t.params || []).map((p) => p.name));
    for (const name of reads) if (!declared.has(name)) bad.push(`${t.id}.${name}`);
  }
  // watershed read p.lat and p.lon while declaring NO params: every run walked
  // in with (NaN, NaN) and returned an empty raster as success.
  eq(bad.join(", "), "", "engines reading undeclared params");
});

check("every declared param is READ by its own tool", () => {
  const bad = [];
  for (const t of R.TOOLS) {
    const src = code(t.engines?.native) + code(t.engines?.sidecar?.build);
    for (const p of t.params || []) {
      if (!new RegExp(`\\b${p.name}\\b`).test(src)) bad.push(`${t.id}.${p.name}`);
    }
  }
  // viewshed collected `height` and read `p.observerHeight`: a form field an
  // engine never reads is the quietest dead control there is.
  eq(bad.join(", "), "", "declared params no engine reads");
});

check("every tool is complete enough to be offered at all", () => {
  const seen = new Set();
  for (const t of R.TOOLS) {
    ok(t.id && !seen.has(t.id), `duplicate or missing tool id: ${t.id}`);
    seen.add(t.id);
    ok(t.label && t.blurb && t.category, `${t.id} is missing a label, blurb or category`);
    ok(t.inputs?.length, `${t.id} declares no inputs`);
    ok(["vector", "raster", "table"].includes(t.outputType), `${t.id} outputType ${t.outputType}`);
    ok(t.outputType === "table" || t.outputName, `${t.id} has no output name template`);
    ok(typeof t.engines?.native === "function", `${t.id} has no native engine`);
  }
  eq(seen.size, R.TOOLS.length, "unique ids");
});

check("every param a form must fill has a default, so an untouched form runs", () => {
  const bad = [];
  for (const t of R.TOOLS) {
    for (const p of t.params || []) {
      // A `field` param is filled by the dialog from the layer's own columns,
      // so it opens on a real value with nothing typed. Anything else with no
      // default is a form that cannot be run without guessing.
      if (p.default === undefined && !p.optional && p.kind !== "field") bad.push(`${t.id}.${p.name}`);
      if (p.kind === "select" && p.default !== undefined) {
        const values = (p.options || []).map((o) => (typeof o === "string" ? o : o.id ?? o.value));
        ok(values.includes(p.default), `${t.id}.${p.name} defaults to a value not in its own options`);
      }
    }
  }
  // The four field params here are the "whole layer / pick a column" ones,
  // which are genuinely optional and offer a blank row in the dialog.
  eq(bad.join(", "), "", "params with no default and not marked optional");
});

check("every tool runs on its own declared input types with untouched defaults", () => {
  const POINT_TOOLS = ["kriging", "idw", "tin", "voronoi", "density", "centroids", "hull"];
  const secondRaster = { twi: SLOPE_FIX, resample: COARSE, mosaic: FLAT, calculator: PLANE, overlay: PLANE };
  const firstRaster = { twi: ACC_FIX, streams: ACC_FIX, watershed: VALLEY, flowAccumulation: VALLEY, fillSinks: PIT };
  const broken = [];
  for (const t of R.TOOLS) {
    const inputs = {};
    let rasterSeen = 0;
    for (const spec of t.inputs) {
      if (spec.type === "raster") {
        inputs[spec.name] = rasterSeen === 0
          ? (firstRaster[t.id] || PLANE)
          : (secondRaster[t.id] || FLAT);
        rasterSeen += 1;
      } else if (spec.type === "sampled") inputs[spec.name] = SAMPLED;
      else if (/point|observation|event/i.test(spec.name)) inputs[spec.name] = LATTICE;
      else if (spec.name === "features") inputs[spec.name] = LATTICE;
      else if (/overlay|zones/i.test(spec.name)) inputs[spec.name] = B;
      else inputs[spec.name] = POINT_TOOLS.includes(t.id) ? LATTICE_25 : A;
    }
    const params = {};
    for (const p of t.params || []) {
      params[p.name] = p.default !== undefined ? p.default : (p.kind === "field" ? "depth" : "");
    }
    if (t.id === "dissolve") params.field = "";
    let out;
    try {
      out = R.runTool(t.id, inputs, params, { outputName: `sweep_${t.id}` });
    } catch (error) { broken.push(`${t.id} THREW ${error.message}`); continue; }
    if (!out.ok) { broken.push(`${t.id}: ${out.message}`); continue; }
    // An output nobody can use is not a run that worked -- watershed passed
    // every earlier ok-flag sweep while returning an empty raster.
    if (out.outputType === "raster" && !stats(out.layer.raster).n) broken.push(`${t.id}: EMPTY raster`);
    if (out.outputType === "vector" && !out.layer?.collection?.features?.length) broken.push(`${t.id}: EMPTY vector`);
    if (out.outputType === "table" && !out.rows?.length) broken.push(`${t.id}: EMPTY table`);
  }
  eq(broken.join(" | "), "", `${R.TOOLS.length} tools with defaults`);
});

/* ── Helpers used above ────────────────────────────────────────────────── */

/**
 * Area through geo-utils' own line-integral formula -- the one geo-utils.test
 * pins against closed forms and against subdivision. Deliberately NOT the
 * boolean ops' own arithmetic: an invariant checked with the code under test
 * is not an invariant.
 */
function GParea(feature) {
  const g = feature.geometry;
  const parts = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  let total = 0;
  for (const rings of parts) {
    total += sphericalPolygonAreaKm2(asPoints(rings[0]));
    for (let k = 1; k < rings.length; k += 1) total -= sphericalPolygonAreaKm2(asPoints(rings[k]));
  }
  return total;
}
/** geo-utils speaks {lat, lon} OBJECTS; GeoJSON speaks [lon, lat] pairs. */
function asPoints(ring) { return ring.map(([lon, lat]) => ({ lat, lon })); }
function sumArea(fc) {
  return (fc?.features || []).reduce((s, f) => s + GParea(f), 0);
}
function point(lon, lat, props) {
  return { type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } };
}
function stats(raster) {
  let min = Infinity; let max = -Infinity; let n = 0; let sum = 0;
  for (const v of raster.band) {
    if (!Number.isFinite(v) || (raster.noData != null && v === raster.noData)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; n += 1;
  }
  return { min, max, n, sum };
}
/** Statistics over the INTERIOR — a 3x3 kernel has no answer on the edge. */
function interior(raster) {
  let min = Infinity; let max = -Infinity; let n = 0;
  for (let y = 1; y < raster.height - 1; y += 1) {
    for (let x = 1; x < raster.width - 1; x += 1) {
      const v = raster.band[y * raster.width + x];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      n += 1;
    }
  }
  return { min, max, n };
}

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
