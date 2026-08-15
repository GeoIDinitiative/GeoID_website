/**
 * The polygon extraction sampler and its export encoders, under node.
 *
 * Why each class of case exists:
 *
 * - GRID SPACING. The sampler converts a km step to degrees once for latitude
 *   and per-row for longitude, dividing by cos(latitude) — that division is the
 *   whole difference between even ground spacing and a grid that bunches toward
 *   the poles. Measured at 60°N (cos = 0.5) against the equator: the emitted
 *   longitude spacing must double while the latitude spacing stays put.
 *
 * - CONTAINMENT. The grid walks the bounding box and filters with
 *   point-in-polygon. An L-shaped (concave) fixture pins the filter: a bbox
 *   scan without it would happily sample the notch. (The function takes one
 *   flat ring of {lat, lon} vertices, so a donut cannot be expressed — the
 *   concave L is the strongest shape the signature admits.)
 *
 * - THE CAP. MAX_SAMPLES (250,000) must stop the scan AT the cap and say so
 *   via truncated — an uncapped scan on a fine step is an out-of-memory, and a
 *   cap that lies about truncation is a silently incomplete export.
 *
 * - COLUMNS AND VALUES. Every mocked source is a known function of (lat, lon),
 *   so the suite asserts the VALUES that land in the rows, not just the row
 *   shape: the viewer's DEM/slope/geology/climate mocks, and imported layers
 *   through layer.sampler with layer.info.column naming (a GEE drape names its
 *   own column; a file-named layer is slugged from its filename).
 *
 * - CONVENTIONS. The viewer hands vertices in east-positive 0–360; rows must
 *   carry signed lon_deg, the DEM mock must be asked in 0–360, and a layer
 *   sampler must be asked in signed degrees. Getting any of these wrong puts
 *   the table on the far side of the planet (see the Sicily-at-315° note in
 *   GeoID_GIS/CLAUDE.md).
 *
 * - CSV ESCAPING. One unescaped comma shifts every later column of that row;
 *   an unescaped quote or newline corrupts the file structurally. Null and
 *   undefined must become empty cells, and 0 must NOT.
 *
 * - GEOJSON. Coordinates are [lon, lat] — reversed, every point reflects
 *   across the diagonal and lands in the wrong hemisphere.
 *
 * Node harness: extraction.js reads browser globals only at CALL time, so a
 * minimal `globalThis.window` stands in, reassigned per case. Two exports are
 * private to the module and pinned through their only caller: rowsToCsv's
 * header line IS collectColumns (union over ragged rows, first-seen order) and
 * its cells ARE escapeCsv.
 *
 * downloadText is exported but not covered here: its entire body is DOM side
 * effects — Blob, URL.createObjectURL, document.createElement("a"), a
 * synthetic click — with no return value. There is no pure surface to assert
 * under node without faking the whole DOM, which would test the fakes.
 *
 * Run: node GeoID_GIS/viewer/gis/extraction.test.mjs
 */

import { extractPolygonSamples, rowsToCsv, rowsToGeoJson } from "./extraction.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── harness: the smallest window the module can be called under ── */

globalThis.window = {};

/** A square in {lat, lon} vertices, the shape the draw tool emits. */
const square = (minLat, minLon, maxLat, maxLon) => [
  { lat: minLat, lon: minLon }, { lat: minLat, lon: maxLon },
  { lat: maxLat, lon: maxLon }, { lat: maxLat, lon: minLon },
];

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a - b);
/** Consecutive diffs of the sorted longitudes in one grid row. */
function rowLonDiffs(rows, latDeg) {
  const lons = uniqueSorted(rows.filter((r) => r.lat_deg === latDeg).map((r) => r.lon_deg));
  const diffs = [];
  for (let i = 1; i < lons.length; i += 1) diffs.push(lons[i] - lons[i - 1]);
  return diffs;
}
const maxAbsDev = (diffs, want) =>
  diffs.reduce((worst, d) => Math.max(worst, Math.abs(d - want)), 0);

// The module's own constant, stepKm = 1 → degrees of latitude:
// python3 -c "print(repr(1/111.32))" → 0.008983111749910169
const STEP_DEG = 0.008983111749910169;
// The same step in longitude at the 60°N row:
// python3 -c "import math; print(repr((1/111.32)/math.cos(math.radians(60.0))))"
//   → 0.017966223499820334
const STEP_DEG_AT_60 = 0.017966223499820334;
// lat_deg/lon_deg are rounded to 6 dp, so a diff of two of them carries ≤1e-6
// of rounding; 2e-6 clears that without hiding a wrong cos.
const ROUND_TOL = 2e-6;

/* ── guard rails: refusal paths return ok:false, never throw ── */

{
  const noArgs = extractPolygonSamples();
  check("no arguments refuses politely", noArgs.ok === false
    && noArgs.message === "Draw an area polygon first." && noArgs.rows.length === 0);
  const twoVerts = extractPolygonSamples({ vertices: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] });
  check("two vertices are not a polygon", twoVerts.ok === false && twoVerts.rows.length === 0);
}

{
  // A sliver triangle whose bbox grid points all miss it at a 50 km step: the
  // only row is lat 0, where the triangle is the single point (0, 0.5), and
  // the three grid lons are 0, 0.4491…, 0.8983…. Verified independently:
  // python3 -c "
  // from shapely.geometry import Point, Polygon
  // sliver = Polygon([(0.5, 0.0), (0.0, 0.1), (1.0, 0.1)])  # (x=lon, y=lat)
  // step = 50/111.32
  // print([sliver.covers(Point(lon, 0.0)) for lon in (0.0, step, 2*step)])"
  //   → [False, False, False]
  const sliver = [{ lat: 0, lon: 0.5 }, { lat: 0.1, lon: 0 }, { lat: 0.1, lon: 1 }];
  const out = extractPolygonSamples({ vertices: sliver, stepKm: 50, includeBuiltIn: false });
  check("a polygon the grid misses reports it", out.ok === false
    && out.message === "No sample points fell inside the polygon. Try a finer spacing.");
}

/* ── the grid honours cos(latitude), on the longitude axis only ── */

{
  const atEquator = extractPolygonSamples({
    vertices: square(0, 0, 0.2, 0.2), stepKm: 1, includeBuiltIn: false,
  });
  const at60 = extractPolygonSamples({
    vertices: square(60, 0, 60.2, 0.2), stepKm: 1, includeBuiltIn: false,
  });
  check("both spacing fixtures sample", atEquator.ok && at60.ok);

  const eqDiffs = rowLonDiffs(atEquator.rows, 0);      // first row starts at bounds.minY exactly
  const northDiffs = rowLonDiffs(at60.rows, 60);
  check("the equator row has many points", eqDiffs.length >= 10);
  check("the 60°N row has points too", northDiffs.length >= 5);
  near("equator lon spacing is the latitude step", maxAbsDev(eqDiffs, STEP_DEG), 0, ROUND_TOL);
  near("60°N lon spacing is the step over cos(60°)", maxAbsDev(northDiffs, STEP_DEG_AT_60), 0, ROUND_TOL);
  near("the spacing ratio is 1/cos(60°)", northDiffs[0] / eqDiffs[0], 2, 1e-3);

  const eqLats = uniqueSorted(atEquator.rows.map((r) => r.lat_deg));
  const northLats = uniqueSorted(at60.rows.map((r) => r.lat_deg));
  const latDiffs = (lats) => lats.slice(1).map((v, i) => v - lats[i]);
  near("equator lat spacing is the step", maxAbsDev(latDiffs(eqLats), STEP_DEG), 0, ROUND_TOL);
  near("60°N lat spacing is STILL the step — only the lon axis scales",
    maxAbsDev(latDiffs(northLats), STEP_DEG), 0, ROUND_TOL);
}

/* ── every emitted point lies inside a concave polygon ── */

{
  // The L: [0,2]²  minus the (lat>1 ∧ lon>1) quadrant. Probes verified:
  // python3 -c "
  // from shapely.geometry import Point, Polygon
  // L = Polygon([(0,0),(2,0),(2,1),(1,1),(1,2),(0,2)])  # (x=lon, y=lat)
  // print(L.area, L.covers(Point(1.5,1.5)), L.covers(Point(1.5,0.5)), L.covers(Point(0.5,1.5)))"
  //   → 3.0 False True True
  // Grid coordinates are k·(5/111.32)° from 0, which never lands exactly on the
  // notch lines lat=1 / lon=1, so the closed-region check below is unambiguous.
  const L = [
    { lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 1, lon: 2 },
    { lat: 1, lon: 1 }, { lat: 2, lon: 1 }, { lat: 2, lon: 0 },
  ];
  const out = extractPolygonSamples({ vertices: L, stepKm: 5, includeBuiltIn: false });
  check("the L-shape samples", out.ok === true && out.rows.length > 500);

  const eps = 1e-9;
  const insideClosedL = ({ lat_deg: lat, lon_deg: lon }) =>
    lat >= -eps && lat <= 2 + eps && lon >= -eps && lon <= 2 + eps
    && !(lat > 1 + eps && lon > 1 + eps);
  const escapees = out.rows.filter((r) => !insideClosedL(r)).length;
  check("no emitted point escapes the polygon", escapees === 0, `${escapees} outside`);
  const inNotch = out.rows.filter((r) => r.lat_deg > 1 + eps && r.lon_deg > 1 + eps).length;
  check("the concave notch is empty — bbox scan is filtered", inNotch === 0, `${inNotch} in notch`);
  check("the high-lat arm is covered", out.rows.some((r) => r.lat_deg > 1.5 && r.lon_deg < 1));
  check("the high-lon arm is covered", out.rows.some((r) => r.lon_deg > 1.5 && r.lat_deg < 1));
}

/* ── the MAX_SAMPLES cap: stop at the cap and admit it ── */

{
  // 1°×1° at a 0.2 km step is a ~557×557 grid ≈ 310k candidates > 250,000.
  const out = extractPolygonSamples({
    vertices: square(0, 0, 1, 1), stepKm: 0.2, includeBuiltIn: false,
  });
  check("capped extraction still reports ok", out.ok === true);
  check("rows stop exactly at the cap", out.rows.length === 250000, `${out.rows.length}`);
  check("and truncated says so", out.truncated === true);
  check("the message admits truncation", out.message.includes("(truncated)"));
}

{
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.05), stepKm: 1, includeBuiltIn: false,
  });
  check("an uncapped extraction is not marked truncated",
    out.ok && out.truncated === false && !out.message.includes("(truncated)"));
}

/* ── built-in viewer columns carry the mocked values ── */

{
  window.GeoIDViewer = {
    // Known linear fields, so every row's value is checkable from its own lat/lon.
    sampleElevationMeters: (lat, lon) => 1000 + 100 * lat - 2 * lon,
    estimateSurfaceSlopeDegrees: (lat) => 5 + lat,
    getGeologyFeatureAtLatLon: (lat, lon) =>
      (lon < 0.1 ? { rock_type: "basalt" } : { name: "tuff" }),
    sphericalPolygonAreaKm2: () => 123.456,
  };
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.1, 0.2), stepKm: 2, includeGeology: true,
  });
  check("built-in sampling runs", out.ok === true && out.rows.length > 20);

  // lat/lon rounding (≤5e-7 × slope 100) plus toFixed(2)/(3) on the value.
  const elevDev = maxAbsDev(
    out.rows.map((r) => r.geoid_elevation_m - (1000 + 100 * r.lat_deg - 2 * r.lon_deg)), 0);
  near("geoid_elevation_m is the mocked DEM at each point", elevDev, 0, 0.02);
  const slopeDev = maxAbsDev(out.rows.map((r) => r.geoid_slope_deg - (5 + r.lat_deg)), 0);
  near("geoid_slope_deg is the mocked slope", slopeDev, 0, 0.002);

  // Grid lons fall at k·0.01797°, none within 1e-3 of the 0.1 boundary.
  const geologyWrong = out.rows.filter((r) => (r.lon_deg < 0.1 - 1e-3
    ? r.geoid_geology !== "basalt" : r.geoid_geology !== "tuff")).length;
  check("geoid_geology takes rock_type, then falls back to name", geologyWrong === 0);
  check("areaKm2 comes from the viewer's own area", out.areaKm2 === 123.456);
}

{
  // Non-finite readings and absent methods must yield "" — never NaN in a CSV.
  window.GeoIDViewer = {
    sampleElevationMeters: () => NaN,
    getGeologyFeatureAtLatLon: () => null,
    // estimateSurfaceSlopeDegrees deliberately absent
  };
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.05), stepKm: 2, includeGeology: true,
  });
  check("a NaN elevation lands as an empty cell",
    out.rows.every((r) => r.geoid_elevation_m === ""));
  check("an absent slope method lands as an empty cell",
    out.rows.every((r) => r.geoid_slope_deg === ""));
  check("a null geology feature lands as an empty cell",
    out.rows.every((r) => r.geoid_geology === ""));
  check("no viewer area method means areaKm2 null", out.areaKm2 === null);
}

{
  window.GeoIDViewer = { sampleElevationMeters: () => 99 };
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.05), stepKm: 2, includeBuiltIn: false,
  });
  check("includeBuiltIn:false emits no geoid_ columns even with a viewer up",
    out.rows.every((r) => Object.keys(r).every((k) => !k.startsWith("geoid_"))));
}

/* ── climate group: keys prefixed, values verbatim ── */

{
  window.GeoIDViewer = {
    sampleEnvironment: () => ({ model_air_temp_c: -3.25, model_pressure_hpa: 850 }),
  };
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.05), stepKm: 2, includeClimate: true,
  });
  check("climate keys arrive geoid_-prefixed with values untouched",
    out.rows.every((r) => r.geoid_model_air_temp_c === -3.25
      && r.geoid_model_pressure_hpa === 850));
  const off = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.05), stepKm: 2, includeClimate: false,
  });
  check("climate stays out unless asked for",
    off.rows.every((r) => !("geoid_model_air_temp_c" in r)));
}

/* ── imported layers: sampler values, column naming, object flattening ── */

{
  window.GeoIDViewer = undefined;
  const layers = [
    // A GEE drape names its own column (the Rainfall_CHIRPS_mm convention).
    { name: "chirps.tif", info: { column: "Rainfall_CHIRPS_mm" }, sampler: (lat, lon) => 100 + 7 * lon },
    // A plain file: extension stripped, non-alphanumerics collapsed to _.
    { name: "gee cache.v2.png", sampler: (lat) => 2 * lat },
    // An attribute sampler flattens under the column prefix; null attr → "".
    { name: "zones.geojson", sampler: () => ({ mean: 3.5, label: "ok", gap: null }) },
    // No sampler → no column at all.
    { name: "dead.tif" },
    // Non-finite scalar → empty cell.
    { name: "void.bin", sampler: () => undefined },
  ];
  const out = extractPolygonSamples({
    vertices: square(0, 0, 0.05, 0.1), stepKm: 2, includeBuiltIn: false, layers,
  });
  check("layer sampling runs", out.ok === true && out.rows.length > 10);

  const rainDev = maxAbsDev(
    out.rows.map((r) => r.Rainfall_CHIRPS_mm - (100 + 7 * r.lon_deg)), 0);
  near("info.column names the column and carries the sampled value", rainDev, 0, 0.002);
  const slugDev = maxAbsDev(out.rows.map((r) => r.gee_cache_v2 - 2 * r.lat_deg), 0);
  near("a filename becomes a slug column (extension off, punctuation to _)",
    slugDev, 0, 0.002);
  check("object values flatten to <column>_<attr>, verbatim",
    out.rows.every((r) => r.zones_mean === 3.5 && r.zones_label === "ok"));
  check("a null attribute flattens to an empty cell",
    out.rows.every((r) => r.zones_gap === ""));
  check("a layer without a sampler contributes nothing",
    out.rows.every((r) => Object.keys(r).every((k) => !k.includes("dead"))));
  check("a non-finite layer value is an empty cell",
    out.rows.every((r) => r.void === ""));
}

/* ── longitude conventions: 0–360 in, signed rows, each sampler in its frame ── */

{
  const demLons = [];
  const layerLons = [];
  window.GeoIDViewer = {
    sampleElevationMeters: (lat, lon) => { demLons.push(lon); return 7; },
  };
  // Vertices as the viewer hands them: east-positive 0–360, just west of Greenwich.
  const out = extractPolygonSamples({
    vertices: square(0, 359.8, 0.1, 359.9),
    stepKm: 2,
    layers: [{ name: "probe.bin", sampler: (lat, lon) => { layerLons.push(lon); return 1; } }],
  });
  check("0–360 vertices sample", out.ok === true && out.rows.length > 10);
  check("rows carry signed lon_deg",
    out.rows.every((r) => r.lon_deg >= -0.2 - 1e-6 && r.lon_deg <= -0.1 + 1e-6));
  check("the DEM is asked in the viewer's 0–360 frame",
    demLons.length > 0 && demLons.every((lon) => lon >= 359.8 - 1e-6 && lon < 360));
  check("a layer sampler is asked in signed degrees",
    layerLons.length > 0 && layerLons.every((lon) => lon >= -0.2 - 1e-6 && lon <= -0.1 + 1e-6));
}

/* ── the viewer's own point-in-polygon wins, but only with a center ── */

{
  let viewerAsked = 0;
  window.GeoIDViewer = {
    pointInProjectedPolygon: (point) => { viewerAsked += 1; return point.lat <= 0.05; },
  };
  const withCenter = extractPolygonSamples({
    vertices: square(0, 0, 0.2, 0.2), center: { lat: 0.1, lon: 0.1 },
    stepKm: 1, includeBuiltIn: false,
  });
  check("with a center the viewer's test is authoritative", viewerAsked > 0
    && withCenter.rows.every((r) => r.lat_deg <= 0.05 + 1e-9));

  viewerAsked = 0;
  const noCenter = extractPolygonSamples({
    vertices: square(0, 0, 0.2, 0.2), stepKm: 1, includeBuiltIn: false,
  });
  check("without a center the module's ray-caster runs instead", viewerAsked === 0
    && noCenter.rows.some((r) => r.lat_deg > 0.15));
  window.GeoIDViewer = undefined;
}

/* ── rowsToCsv: collectColumns is the header, escapeCsv is every cell ── */

{
  // The quoting convention is RFC 4180 as python's csv module writes it:
  // python3 -c "
  // import csv, io
  // buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n')
  // w.writerow(['x','a,b','say \"hi\"','line1\nline2','0',''])
  // print(repr(buf.getvalue()))"
  //   → 'x,"a,b","say ""hi""","line1\nline2",0,\n'
  const rows = [
    { plain: "x", comma: "a,b", quote: 'say "hi"', newline: "line1\nline2", zero: 0 },
    { plain: null, extra: 5 },
  ];
  const want = 'plain,comma,quote,newline,zero,extra\n'
    + 'x,"a,b","say ""hi""","line1\nline2",0,\n'
    + ',,,,,5';
  check("commas, quotes, newlines, null, undefined, 0 and a ragged column",
    rowsToCsv(rows) === want, JSON.stringify(rowsToCsv(rows)));
}

{
  // Union over ragged rows in first-seen order: b, then a and c, then d.
  const header = rowsToCsv([{ b: 1 }, { a: 2, b: 3, c: 4 }, { c: 5, d: 6 }]).split("\n")[0];
  check("column order is first-seen across ragged rows", header === "b,a,c,d", header);
  check("no rows means an empty document", rowsToCsv([]) === "");
}

/* ── rowsToGeoJson: a valid FeatureCollection in [lon, lat] order ── */

{
  const rows = [
    { lat_deg: 10, lon_deg: 20, geoid_elevation_m: 55.5, note: "a" },
    { lat_deg: -45.5, lon_deg: -170.25 },
  ];
  const parsed = JSON.parse(rowsToGeoJson(rows));  // throws → the check fails loudly
  check("it is a FeatureCollection", parsed.type === "FeatureCollection"
    && Array.isArray(parsed.features) && parsed.features.length === 2);
  const [first, second] = parsed.features;
  check("features are Point features", first.type === "Feature"
    && first.geometry.type === "Point" && second.geometry.type === "Point");
  check("coordinates are [lon, lat]",
    first.geometry.coordinates[0] === 20 && first.geometry.coordinates[1] === 10
    && second.geometry.coordinates[0] === -170.25 && second.geometry.coordinates[1] === -45.5);
  check("properties keep the data columns and drop the coordinate pair",
    first.properties.geoid_elevation_m === 55.5 && first.properties.note === "a"
    && !("lat_deg" in first.properties) && !("lon_deg" in first.properties));
  check("no rows is an empty collection",
    JSON.parse(rowsToGeoJson([])).features.length === 0);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
