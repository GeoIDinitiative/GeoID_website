/**
 * Extraction within ANY polygon: the pure half, against closed-form answers.
 * This is the machinery the Model Builder packages datasets with, so the
 * failure modes pinned here are the ones that would quietly corrupt a study:
 * a hole that still samples, a line kept whole across a boundary, a point
 * cloud losing the columns its renderer never kept.
 */
import {
  ringsFromCollection, pointInAnyRing, maskFromRings,
  extractVectorWithin, extractDelimitedWithin, vectorRows,
  extractNative,
  nativeGridOf,
} from "./extraction.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const polyFc = (rings) => ({ type: "FeatureCollection", features: [
  { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } }] });

// A donut study area: 4×4 outer, 1×1 hole in the middle.
const donut = polyFc([sq(0, 0, 4, 4), sq(1.5, 1.5, 1, 1)]);
const rings = ringsFromCollection(donut);

check("a layer polygon becomes rings with its holes", rings.length === 1
  && rings[0].holes.length === 1, JSON.stringify(rings.map(r => r.holes.length)));
check("inside the outer ring is in", pointInAnyRing(0.5, 0.5, rings));
check("inside the HOLE is out", !pointInAnyRing(2, 2, rings),
  "a sample inside the hole was counted");
check("outside is out", !pointInAnyRing(5, 5, rings));

// A MultiPolygon study area: two separate squares.
const two = ringsFromCollection({ type: "FeatureCollection", features: [
  { type: "Feature", properties: {}, geometry: { type: "MultiPolygon",
    coordinates: [[sq(0, 0, 1, 1)], [sq(10, 0, 1, 1)]] } }] });
check("a MultiPolygon bounds is every part", pointInAnyRing(0.5, 0.5, two)
  && pointInAnyRing(0.5, 10.5, two) && !pointInAnyRing(0.5, 5, two));

// Vector extraction: points filtered, lines clipped, fields narrowed.
const mask = maskFromRings(ringsFromCollection(polyFc([sq(0, 0, 2, 2)])));
const layer = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { name: "in", secret: 1 },
    geometry: { type: "Point", coordinates: [1, 1] } },
  { type: "Feature", properties: { name: "out" },
    geometry: { type: "Point", coordinates: [5, 5] } },
  { type: "Feature", properties: { name: "transect" },
    geometry: { type: "LineString", coordinates: [[-1, 1], [4, 1]] } },
] };
const got = extractVectorWithin(layer, mask, { fields: ["name"] });
check("the inside point is kept, the outside dropped",
  got.kept === 2 && got.collection.features.some((f) => f.properties.name === "in")
  && !got.collection.features.some((f) => f.properties.name === "out"),
  `kept ${got.kept}`);
const line = got.collection.features.find((f) => f.properties.name === "transect");
check("the transect is CLIPPED to the boundary, not kept whole",
  line && JSON.stringify(line.geometry.coordinates) === JSON.stringify([[0, 1], [2, 1]]),
  JSON.stringify(line?.geometry));
check("unticked fields are stripped, geometry never",
  !("secret" in got.collection.features[0].properties)
  && got.collection.features.every((f) => f.geometry));

check("vector rows carry a position for every feature",
  vectorRows(got.collection).every((r) => Number.isFinite(r.lat_deg)));

// The delimited point cloud: the FILE's columns, not the renderer's.
const source = {
  text: "name,depth,temp,lat,lon\nA,10,4.1,1,1\nB,20,3.9,5,5\nC,30,3.5,1.5,0.5\n",
  delimiter: ",", hasHeader: true, mapping: { lon: 4, lat: 3 },
};
const cloud = extractDelimitedWithin(source, ringsFromCollection(polyFc([sq(0, 0, 2, 2)])),
  { columns: ["depth"] });
check("cloud rows inside the polygon only", cloud.rows.length === 2,
  `got ${cloud.rows.length}`);
check("ticked column plus the coordinates, nothing else",
  JSON.stringify(cloud.columns.sort()) === JSON.stringify(["depth", "lat", "lon"]),
  cloud.columns.join());
check("values survive", cloud.rows[0].depth === "10" && cloud.rows[1].depth === "30");

/* ── Native resolution ─────────────────────────────────────────────────────
   A dataset's own grid is the answer to "what does this layer say here". The
   uniform grid is a resampling of it, and resampling in either direction
   lies: read a 30 m raster at 1 km and almost none of it appears; read a
   global drape at 1 km and one pixel becomes thousands of identical rows. */

const boxRing = (lon, lat, d) => ({
  vertices: [
    { lon: lon - d, lat: lat - d }, { lon: lon + d, lat: lat - d },
    { lon: lon + d, lat: lat + d }, { lon: lon - d, lat: lat + d },
  ],
  holes: [],
  center: { lon, lat },
});

{
  // A 10x10 raster over 1 degree: each cell is 0.1 degrees.
  const band = new Float32Array(100).map((_, k) => k);
  const raster = { band, width: 10, height: 10,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, noData: null };
  const layer = { name: "grid.asc", raster };
  const grid = nativeGridOf(layer);
  check("a raster IS its own native grid", grid && grid.width === 10 && grid.height === 10,
    JSON.stringify(grid && { w: grid.width, h: grid.height }));
  check("its cell size is measured, not declared",
    Math.abs(grid.metresPerPixel - (40075017 / 360) * Math.cos(0.5 * Math.PI / 180) / 10) < 1,
    String(grid.metresPerPixel));

  // A polygon covering the middle four cells, centred on 0.5,0.5.
  const out = extractNative({ rings: [boxRing(0.5, 0.5, 0.1)], layer });
  check("native extraction returns the CELLS, not a typed grid", out.ok && out.rows.length === 4,
    out.message);
  check("each row carries that cell's own value",
    out.rows.every((r) => Number.isFinite(r.value)), JSON.stringify(out.rows));

  // A polygon SMALLER than one cell is one row — the honest reading.
  const tiny = extractNative({ rings: [boxRing(0.55, 0.55, 0.005)], layer });
  check("a polygon under one cell yields ONE row, not a made-up grid",
    tiny.ok && tiny.rows.length === 1, tiny.message);
}

{
  // A vector has no resolution and must say so rather than being sampled.
  const layer = { name: "coast.geojson", collection: { type: "FeatureCollection", features: [] } };
  check("a vector layer has no native grid", nativeGridOf(layer) === null);
  const out = extractNative({ rings: [boxRing(0, 0, 1)], layer });
  check("and native extraction refuses it by name",
    out.ok === false && /clipped exactly/.test(out.message), out.message);
}

{
  // A drape: no raster, a sampler, and an image whose size IS its resolution.
  const layer = {
    name: "Rainfall (CHIRPS)",
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    object3D: { userData: { geeImage: { naturalWidth: 4, naturalHeight: 4 } } },
    sampler: (lat, lon) => 100 + lon * 10,
  };
  const grid = nativeGridOf(layer);
  check("a drape's grid comes from the DELIVERED image", grid && grid.width === 4,
    JSON.stringify(grid && { w: grid.width, src: grid.source }));
  const out = extractNative({ rings: [boxRing(0.5, 0.5, 0.4)], layer });
  check("a drape extracts on its own 4x4 cells", out.ok && out.rows.length > 0 && out.rows.length <= 16,
    out.message);
  check("through its sampler, so the values are real",
    out.rows.every((r) => Number.isFinite(r.value)), JSON.stringify(out.rows.slice(0, 2)));
  // The whole point: the same polygon on a uniform 1 km grid would be
  // thousands of rows over a grid that holds sixteen.
  check("native never invents more rows than the layer has cells",
    out.rows.length <= grid.width * grid.height, `${out.rows.length} of ${grid.width * grid.height}`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
