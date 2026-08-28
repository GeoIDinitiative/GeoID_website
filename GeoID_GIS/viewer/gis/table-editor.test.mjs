/**
 * The table round trip, which is where an attribute editor silently loses
 * data: a deleted row taking the next row's geometry, a coordinate typed
 * wrong becoming 0°N 0°E, or the part of a big layer the grid never drew
 * being dropped by a save.
 */
import {
  tableFrom, collectionFrom, isEditable, gridFrom, textFrom,
} from "./table-editor.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (ok, detail) => { if (!ok) throw new Error(detail || "assertion failed"); };

const points = (n) => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [10 + i, 50 + i] },
    properties: { name: `Site ${i + 1}`, depth: 100 + i },
  })),
});

const lines = () => ({
  type: "FeatureCollection",
  features: ["a", "b", "c"].map((tag, i) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[i, i], [i + 1, i + 1]] },
    properties: { name: tag },
  })),
});

test("a point layer offers lat and lon as columns", () => {
  const t = tableFrom(points(3));
  assert(t.geo === true, "not recognised as a point layer");
  assert(t.rows[0].lat === 50 && t.rows[0].lon === 10, JSON.stringify(t.rows[0]));
  assert(t.columns.join() === "name,depth", t.columns.join());
});

test("a line layer does not, and carries its geometry per row", () => {
  const t = tableFrom(lines());
  assert(t.geo === false, "lines offered as editable points");
  assert(t.rows[0].geometry.type === "LineString", "geometry not carried");
});

test("the round trip is lossless", () => {
  const original = points(3);
  const { collection } = collectionFrom(tableFrom(original));
  assert(JSON.stringify(collection) === JSON.stringify(original),
    JSON.stringify(collection));
});

test("deleting a row keeps every OTHER row's geometry", () => {
  // The fault this guards: geometry looked up by index hands row 3's shape
  // to row 2 the moment a row above them goes.
  const t = tableFrom(lines());
  t.rows.splice(0, 1);                       // drop "a"
  const { collection } = collectionFrom(t);
  assert(collection.features.length === 2, String(collection.features.length));
  assert(collection.features[0].properties.name === "b", "wrong row survived");
  assert(collection.features[0].geometry.coordinates[0][0] === 1,
    JSON.stringify(collection.features[0].geometry));
  assert(collection.features[1].geometry.coordinates[0][0] === 2,
    JSON.stringify(collection.features[1].geometry));
});

test("an edited coordinate is written, as a number", () => {
  const t = tableFrom(points(1));
  t.rows[0].lat = "51.5";
  t.rows[0].lon = "-0.12";
  const { collection } = collectionFrom(t);
  assert(collection.features[0].geometry.coordinates[0] === -0.12,
    JSON.stringify(collection.features[0].geometry));
  assert(collection.features[0].geometry.coordinates[1] === 51.5, "lat lost");
});

test("a row with no coordinate is DROPPED, not placed at 0,0", () => {
  const t = tableFrom(points(2));
  t.rows[0].lat = "";
  const { collection, dropped } = collectionFrom(t);
  assert(dropped === 1, `dropped ${dropped}`);
  assert(collection.features.length === 1, String(collection.features.length));
  assert(!collection.features.some((f) => f.geometry.coordinates[0] === 0
    && f.geometry.coordinates[1] === 0), "a point landed at 0,0");
});

test("a numeric column stays numeric, and text stays text", () => {
  const t = tableFrom(points(1));
  t.rows[0].props.depth = "250";
  const { collection } = collectionFrom(t);
  assert(collection.features[0].properties.depth === 250, "number became text");
  assert(collection.features[0].properties.name === "Site 1", "text mangled");
});

test("rows past the cap are kept, not silently deleted", () => {
  const big = points(2100);
  const t = tableFrom(big);
  assert(t.rows.length === 2000, String(t.rows.length));
  assert(t.truncated === 100, String(t.truncated));
  const { collection } = collectionFrom(t);
  assert(collection.features.length === 2100, String(collection.features.length));
  assert(collection.features[2099].properties.name === "Site 2100", "the tail changed");
});

test("a new column reaches every row", () => {
  const t = tableFrom(points(2));
  t.columns.push("note");
  t.rows.forEach((r) => { r.props.note = ""; });
  t.rows[0].props.note = "checked";
  const { collection } = collectionFrom(t);
  assert(collection.features[0].properties.note === "checked", "not written");
  assert("note" in collection.features[1].properties, "column missing on row 2");
});

test("the app's own bookkeeping is hidden but survives a save", () => {
  const fc = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [1, 2] },
      properties: { name: "A", data_type: "study-area", data_note: "kept" },
    }],
  };
  const t = tableFrom(fc);
  assert(!t.columns.includes("data_type"), "data_type was offered as a column");
  assert(!t.columns.includes("data_note"), "data_note was offered as a column");
  const { collection } = collectionFrom(t);
  assert(collection.features[0].properties.data_type === "study-area", "tag lost");
  assert(collection.features[0].properties.data_note === "kept", "note lost");
  assert(collection.features[0].properties.name === "A", "real column lost");
});

test("rasters and tile layers are refused", () => {
  assert(!isEditable({ status: "loaded", raster: true, collection: points(1) }), "raster");
  assert(!isEditable({ status: "loaded", ext: "tiles", collection: points(1) }), "tiles");
  assert(!isEditable({ status: "loaded", ext: "gee", collection: points(1) }), "gee");
  assert(isEditable({ status: "loaded", ext: "csv", collection: points(1) }), "csv refused");
});

/* ── The delimited half: a CSV edited as the grid it already is ─────────── */

const csvSource = (text, extra = {}) => ({
  text, delimiter: ",", hasHeader: true, mapping: { lonIndex: 3, latIndex: 2 }, ...extra,
});
const SITES = "name,depth,lat,lon\nAlpha,120,51.5,-0.12\nBravo,340,48.85,2.35\n";

test("a CSV keeps EVERY column, not just the coordinates", () => {
  const g = gridFrom(csvSource(SITES));
  assert(g.columns.join() === "name,depth,lat,lon", g.columns.join());
  assert(g.rows.length === 2, String(g.rows.length));
  assert(g.rows[0][0] === "Alpha", JSON.stringify(g.rows[0]));
});

test("a CSV round trip is byte-identical", () => {
  assert(textFrom(gridFrom(csvSource(SITES))) === SITES, JSON.stringify(textFrom(gridFrom(csvSource(SITES)))));
});

test("an edited cell is written back", () => {
  const g = gridFrom(csvSource(SITES));
  g.rows[0][1] = "999";
  assert(textFrom(g).includes("Alpha,999,51.5,-0.12"), textFrom(g));
});

test("only values that NEED quoting get it", () => {
  const g = gridFrom(csvSource(SITES));
  g.rows[0][0] = "Alpha, west";
  const out = textFrom(g);
  assert(out.includes('"Alpha, west"'), out);
  assert(out.includes("Bravo,340"), "an untouched row was requoted");
});

test("a header-less file is not robbed of its first row", () => {
  const g = gridFrom(csvSource("1,2,3\n4,5,6\n", { hasHeader: false }));
  assert(g.rows.length === 2, String(g.rows.length));
  assert(g.rows[0][0] === "1", JSON.stringify(g.rows[0]));
  assert(!textFrom(g).startsWith("column"), textFrom(g));
});

test("a layer that kept its source is editable even with no features", () => {
  assert(isEditable({ status: "loaded", ext: "csv", source: { text: SITES } }),
    "a CSV point cloud was refused");
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓  ${name}`); }
  catch (error) { failed += 1; console.log(`✗  ${name} — ${error.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
