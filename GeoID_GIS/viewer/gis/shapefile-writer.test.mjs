/**
 * The shapefile writer, checked by reading its own bytes back.
 *
 * A shapefile is binary, multi-file and cross-referenced, so "it produced
 * output" says nothing: the failures that matter here are the ones that yield
 * a file which opens in QGIS and is wrong. A reader is written below rather
 * than asserting on byte offsets, because a test that only restates the
 * writer's arithmetic passes when both are wrong in the same way.
 *
 * The four specifically guarded against:
 *
 *   1. Ring winding. GeoJSON says outer rings are counter-clockwise; a
 *      shapefile says clockwise. Copy them across unchanged and every polygon
 *      is read inside out -- valid file, draws fine, holes where the land is.
 *   2. Mixed endianness. Lengths and record numbers big-endian, coordinates
 *      and type codes little-endian, in the same header.
 *   3. Lengths in 16-bit words, not bytes.
 *   4. The .shx offsets agreeing with where records actually start in .shp.
 *
 * Run: node GeoID_GIS/viewer/gis/shapefile-writer.test.mjs
 */

import {
  shapeTypeFor, ringArea, orientRing, partsOf,
  writeShpAndShx, dbfFields, writeDbf, crc32, zipStore, buildShapefileZip,
  PRJ_WGS84, POINT, POLYLINE, POLYGON, MULTIPOINT,
} from "./shapefile-writer.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
const near = (name, got, want, tol = 1e-9) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}`);

const feature = (geometry, properties = {}) => ({ type: "Feature", properties, geometry });
const fc = (...features) => ({ type: "FeatureCollection", features });

/* ─────────────────────────── a reader, for the test ───────────────────── */

/** Walk a .shp the way a reader does, from its own header and record lengths. */
function readShp(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {
    fileCode: view.getInt32(0),
    version: view.getInt32(28, true),
    shapeType: view.getInt32(32, true),
    lengthWords: view.getInt32(24),
    box: [view.getFloat64(36, true), view.getFloat64(44, true),
      view.getFloat64(52, true), view.getFloat64(60, true)],
    records: [],
  };
  let offset = 100;
  while (offset < bytes.length) {
    const number = view.getInt32(offset);
    const words = view.getInt32(offset + 4);
    const type = view.getInt32(offset + 8, true);
    const record = { number, byteOffset: offset, type, points: [], parts: [] };
    if (type === POINT) {
      record.points.push([view.getFloat64(offset + 12, true), view.getFloat64(offset + 20, true)]);
    } else if (type === MULTIPOINT) {
      const n = view.getInt32(offset + 44, true);
      for (let i = 0; i < n; i += 1) {
        record.points.push([view.getFloat64(offset + 48 + i * 16, true),
          view.getFloat64(offset + 56 + i * 16, true)]);
      }
    } else if (type === POLYLINE || type === POLYGON) {
      const numParts = view.getInt32(offset + 44, true);
      const numPoints = view.getInt32(offset + 48, true);
      for (let i = 0; i < numParts; i += 1) record.parts.push(view.getInt32(offset + 52 + i * 4, true));
      const base = offset + 52 + numParts * 4;
      for (let i = 0; i < numPoints; i += 1) {
        record.points.push([view.getFloat64(base + i * 16, true),
          view.getFloat64(base + 8 + i * 16, true)]);
      }
    }
    out.records.push(record);
    offset += 8 + words * 2;
  }
  return out;
}

function readShx(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let offset = 100; offset < bytes.length; offset += 8) {
    entries.push({ offsetWords: view.getInt32(offset), lengthWords: view.getInt32(offset + 4) });
  }
  return entries;
}

function readDbf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields = [];
  for (let at = 32; bytes[at] !== 0x0D && at < headerLength; at += 32) {
    let name = "";
    for (let i = 0; i < 11 && bytes[at + i]; i += 1) name += String.fromCharCode(bytes[at + i]);
    fields.push({ name, type: String.fromCharCode(bytes[at + 11]), width: bytes[at + 16] });
  }
  const rows = [];
  for (let r = 0; r < recordCount; r += 1) {
    const start = headerLength + r * recordLength;
    const row = { deleted: bytes[start] !== 0x20, values: {} };
    let at = start + 1;
    for (const field of fields) {
      let text = "";
      for (let i = 0; i < field.width; i += 1) text += String.fromCharCode(bytes[at + i]);
      row.values[field.name] = text;
      at += field.width;
    }
    rows.push(row);
  }
  return { recordCount, headerLength, recordLength, fields, rows, eof: bytes[bytes.length - 1] };
}

/* ────────────────────────────── geometry type ─────────────────────────── */

eq("points make a Point shapefile",
  shapeTypeFor(fc(feature({ type: "Point", coordinates: [1, 2] }))), POINT);
eq("lines make a PolyLine",
  shapeTypeFor(fc(feature({ type: "LineString", coordinates: [[0, 0], [1, 1]] }))), POLYLINE);
eq("multi-lines are the same type as lines",
  shapeTypeFor(fc(feature({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] }))), POLYLINE);
eq("polygons and multipolygons are one type",
  shapeTypeFor(fc(
    feature({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
    feature({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }),
  )), POLYGON);

// The reason the whole thing can refuse: one file, one type.
eq("a mixed collection has no single type",
  shapeTypeFor(fc(
    feature({ type: "Point", coordinates: [1, 2] }),
    feature({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
  )), null);
eq("points and multipoints are different types, so they clash too",
  shapeTypeFor(fc(
    feature({ type: "Point", coordinates: [1, 2] }),
    feature({ type: "MultiPoint", coordinates: [[1, 2], [3, 4]] }),
  )), null);
eq("an empty collection has no type", shapeTypeFor(fc()), null);
eq("nothing at all does not throw", shapeTypeFor(null), null);

/* ──────────────────────────────── winding ─────────────────────────────── */

const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const cw = [...ccw].reverse();

check("counter-clockwise measures positive", ringArea(ccw) > 0);
check("clockwise measures negative", ringArea(cw) < 0);

// The headline bug: a GeoJSON outer ring is counter-clockwise, and a shapefile
// wants it clockwise. If this is a no-op the export is inside out.
check("a GeoJSON outer ring is turned around for the shapefile",
  ringArea(orientRing(ccw, true)) < 0);
check("one already clockwise is left alone", orientRing(cw, true) === cw);
check("holes are wound the other way", ringArea(orientRing(cw, false)) > 0);

const polygon = { type: "Polygon", coordinates: [ccw, [[0.2, 0.2], [0.2, 0.8], [0.8, 0.8], [0.2, 0.2]]] };
const rings = partsOf(polygon);
check("the outer ring comes out clockwise", ringArea(rings[0]) < 0);
check("and the hole counter-clockwise", ringArea(rings[1]) > 0);
eq("both rings survive as parts", rings.length, 2);

/* ─────────────────────────── .shp and .shx ────────────────────────────── */

const points = [
  feature({ type: "Point", coordinates: [10, 20] }, { name: "A", depth: 5 }),
  feature({ type: "Point", coordinates: [-30, 40] }, { name: "B", depth: 12.5 }),
];
const { shp, shx } = writeShpAndShx(points, POINT);
const parsed = readShp(shp);

eq("the file code is the format's magic, big-endian", parsed.fileCode, 9994);
eq("the version is 1000, little-endian", parsed.version, 1000);
eq("the shape type is in the header", parsed.shapeType, POINT);
eq("the declared length is the real length, in words", parsed.lengthWords * 2, shp.length);
eq("every feature became a record", parsed.records.length, 2);
eq("record numbers are one-based", parsed.records.map((r) => r.number), [1, 2]);
eq("coordinates survive the round trip",
  parsed.records.map((r) => r.points[0]), [[10, 20], [-30, 40]]);
eq("the header bounding box covers them all", parsed.box, [-30, 20, 10, 40]);

// The index is only useful if it points at the records: an .shx out by one is
// a file that opens on the wrong geometry.
const index = readShx(shx);
eq("the index has one entry per record", index.length, 2);
eq("and each entry points at where the record really starts",
  index.map((e) => e.offsetWords * 2), parsed.records.map((r) => r.byteOffset));
eq("the index declares its own length correctly",
  new DataView(shx.buffer).getInt32(24) * 2, shx.length);

const poly = writeShpAndShx([feature(polygon)], POLYGON);
const polyParsed = readShp(poly.shp);
eq("a polygon writes one record", polyParsed.records.length, 1);
eq("with both rings as parts", polyParsed.records[0].parts.length, 2);
// Parts hold the start index of each ring, so the second begins where the
// first ends -- a length here instead would silently corrupt the geometry.
eq("parts are start indices, not lengths", polyParsed.records[0].parts, [0, 5]);
eq("all points from both rings are present", polyParsed.records[0].points.length, 9);
check("the first ring comes back clockwise",
  ringArea(polyParsed.records[0].points.slice(0, 5)) < 0);

const lines = writeShpAndShx([feature({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })], POLYLINE);
eq("a multi-line keeps its parts separate", readShp(lines.shp).records[0].parts, [0, 2]);

eq("no features still writes a valid header", readShp(writeShpAndShx([], POINT).shp).records.length, 0);

/* ──────────────────────────────── .dbf ────────────────────────────────── */

const fields = dbfFields(points);
eq("a column per property", fields.map((f) => f.name), ["NAME", "DEPTH"]);
eq("text and numbers are told apart", fields.map((f) => f.type), ["C", "N"]);

const dbf = readDbf(writeDbf(points, fields));
eq("one row per feature", dbf.recordCount, 2);
eq("no row is marked deleted", dbf.rows.filter((r) => r.deleted).length, 0);
eq("text values come back", dbf.rows.map((r) => r.values.NAME.trim()), ["A", "B"]);
eq("numbers come back", dbf.rows.map((r) => Number(r.values.DEPTH)), [5, 12.5]);
// Numbers are right-aligned in dBASE; left-aligned some readers misparse them.
check("numbers are right-aligned in their column", dbf.rows[0].values.DEPTH.startsWith(" "));
eq("the record length matches what the header claims",
  dbf.recordLength, 1 + fields.reduce((s, f) => s + f.width, 0));
eq("the file ends with the end-of-file marker", dbf.eof, 0x1A);

// Field names are capped at ten characters, so two long ones can collide --
// and a collision would otherwise mean one column silently overwriting another.
const longNames = [feature({ type: "Point", coordinates: [0, 0] },
  { measurement_alpha: 1, measurement_beta: 2 })];
const longFields = dbfFields(longNames);
eq("names are cut to ten characters", longFields.map((f) => f.name.length), [10, 10]);
check("and a collision is resolved rather than duplicated",
  longFields[0].name !== longFields[1].name);

// A numeric column must fit the text actually written into it, decimals and
// all. Sized from the value as JavaScript prints it, 5 became a one-character
// column and 12.5 was truncated to "1" -- a file that opens with wrong numbers.
const widths = dbfFields([feature({ type: "Point", coordinates: [0, 0] },
  { count: 1250, ratio: 0.5 })]);
eq("a whole-number column has no decimal places",
  widths.find((f) => f.name === "COUNT").decimals, 0);
eq("and is wide enough for its digits",
  widths.find((f) => f.name === "COUNT").width, 4);
eq("a fractional column carries decimals",
  widths.find((f) => f.name === "RATIO").decimals, 6);
eq("and is wide enough for the point and all of them",
  widths.find((f) => f.name === "RATIO").width, 8);
eq("a big number is not truncated on the way out",
  Number(readDbf(writeDbf([feature({ type: "Point", coordinates: [0, 0] }, { count: 1250, ratio: 0.5 })], widths))
    .rows[0].values.COUNT), 1250);
eq("nor is a fractional one",
  Number(readDbf(writeDbf([feature({ type: "Point", coordinates: [0, 0] }, { count: 1250, ratio: 0.5 })], widths))
    .rows[0].values.RATIO), 0.5);
eq("a negative number keeps its sign",
  Number(readDbf(writeDbf([feature({ type: "Point", coordinates: [0, 0] }, { v: -42 })],
    dbfFields([feature({ type: "Point", coordinates: [0, 0] }, { v: -42 })]))).rows[0].values.V), -42);

eq("a missing property writes blank, not the string undefined",
  readDbf(writeDbf([feature({ type: "Point", coordinates: [0, 0] }, {})], fields))
    .rows[0].values.NAME.trim(), "");

/* ──────────────────────────────── zip ─────────────────────────────────── */

// The check value from the CRC-32 specification.
eq("crc32 matches the standard's check value",
  crc32(new TextEncoder().encode("123456789")), 0xCBF43926);

const zip = zipStore([
  { name: "a.txt", data: new TextEncoder().encode("hello") },
  { name: "b.txt", data: new TextEncoder().encode("world") },
]);
const zipView = new DataView(zip.buffer);
eq("it starts with a local file header", zipView.getUint32(0, true), 0x04034b50);
eq("and ends with the end-of-central-directory record",
  zipView.getUint32(zip.length - 22, true), 0x06054b50);
eq("which counts both entries", zipView.getUint16(zip.length - 22 + 10, true), 2);
eq("the first entry stores its own CRC",
  zipView.getUint32(14, true), crc32(new TextEncoder().encode("hello")));
eq("stored, not deflated", zipView.getUint16(8, true), 0);
eq("with the size written twice, both matching",
  [zipView.getUint32(18, true), zipView.getUint32(22, true)], [5, 5]);

/* ─────────────────────────────── the set ──────────────────────────────── */

const bundle = buildShapefileZip(fc(...points), "sites");
check("a single-type collection produces an archive", bundle instanceof Uint8Array);

// All four files, because three of them is a shapefile that fails somewhere.
const names = [];
{
  const view = new DataView(bundle.buffer);
  let at = 0;
  while (at < bundle.length && view.getUint32(at, true) === 0x04034b50) {
    const nameLength = view.getUint16(at + 26, true);
    const dataLength = view.getUint32(at + 18, true);
    names.push(new TextDecoder().decode(bundle.subarray(at + 30, at + 30 + nameLength)));
    at += 30 + nameLength + dataLength;
  }
}
eq("the archive holds all four files", names, ["sites.shp", "sites.shx", "sites.dbf", "sites.prj"]);

check("the projection file names WGS84", PRJ_WGS84.includes("WGS_1984"));

eq("a mixed collection produces nothing rather than a partial file",
  buildShapefileZip(fc(
    feature({ type: "Point", coordinates: [1, 2] }),
    feature({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
  ), "mixed"), null);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
