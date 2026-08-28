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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
