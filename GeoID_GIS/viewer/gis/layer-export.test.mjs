/**
 * What a layer can be written as, and whether the bytes are right.
 *
 * The format offer is guessed from the layer's contents rather than its file
 * name, so the cases that matter are the ones where those two disagree: a
 * shapefile that cannot be written back, a .json that is really GeoJSON, a
 * derived layer with no extension at all.
 *
 * The writers are checked against the parts of each format that silently ruin
 * a file if you get them wrong -- the grid's row order and its header, OBJ's
 * one-based indices, STL's per-facet normal.
 *
 * Run: node GeoID_GIS/viewer/gis/layer-export.test.mjs
 */

import {
  layerKind, suggestedFormat, formatsFor, baseName, collectionOf, hasUsableBounds,
  toAsciiGrid, toRasterCsv, toStl, toObj,
} from "./layer-export.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/* ── what a layer is ── */

const vector = { name: "sites.shp", ext: "shp", collection: { features: [{}, {}] } };
const raster = { name: "dem.tif", ext: "tif", raster: { band: [1], width: 1, height: 1 } };
const mesh = { name: "part.stl", ext: "stl", object3D: {} };

eq("features make it a vector layer", layerKind(vector), "vector");
eq("a band makes it a raster", layerKind(raster), "raster");
eq("geometry alone makes it a mesh", layerKind(mesh), "mesh");
eq("nothing at all is unknown", layerKind({ name: "x" }), "unknown");
eq("an empty collection is not a vector layer",
  layerKind({ collection: { features: [] }, object3D: {} }), "mesh");
eq("a null layer does not throw", layerKind(null), "unknown");

/* ── the suggestion ── */

// The case the whole guess exists for: a shapefile cannot be written back, so
// the suggestion is the format that keeps everything it held.
eq("a shapefile is suggested out as GeoJSON", suggestedFormat(vector), "geojson");
eq("KML round-trips to KML", suggestedFormat({ ...vector, ext: "kml" }), "kml");
eq("WKT round-trips to WKT", suggestedFormat({ ...vector, ext: "wkt" }), "wkt");
eq("a point CSV stays a CSV", suggestedFormat({ ...vector, ext: "csv" }), "csv");
eq("an XYZ cloud is a CSV too", suggestedFormat({ ...vector, ext: "xyz" }), "csv");
eq("a derived layer with no extension still gets a suggestion",
  suggestedFormat({ collection: { features: [{}] } }), "geojson");
// A GeoTIFF is an image plus its coordinates, so a raster without bounds has
// nothing to put in one and falls back to the format that writes values alone.
eq("a raster with no georeferencing falls back to a grid", suggestedFormat(raster), "asc");
const geoRaster = { name: "dem.tif", ext: "tif", raster: {
  band: [1, 2, 3, 4], width: 2, height: 2,
  bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 }, noData: null } };
eq("a georeferenced one round-trips to GeoTIFF", suggestedFormat(geoRaster), "tif");
check("and GeoTIFF is usable for it",
  formatsFor(geoRaster).find((f) => f.id === "tif").disabled === undefined);
check("while an ungeoreferenced raster has it listed with the reason",
  formatsFor(raster).find((f) => f.id === "tif").disabled === true
  && /georeferencing/.test(formatsFor(raster).find((f) => f.id === "tif").reason));
eq("an STL round-trips to STL", suggestedFormat(mesh), "stl");
eq("an OBJ round-trips to OBJ", suggestedFormat({ ...mesh, ext: "obj" }), "obj");
eq("nothing writable has no suggestion", suggestedFormat({ name: "x" }), null);

/* ── the offer ── */

check("a raster is never offered vector formats",
  formatsFor(raster).every((f) => ["tif", "asc", "csv"].includes(f.id)));
check("a vector layer is never offered a mesh format",
  formatsFor(vector).every((f) => ["shp", "geojson", "kml", "wkt", "csv"].includes(f.id)));
eq("exactly one format is marked as the suggestion",
  formatsFor(vector).filter((f) => f.suggested).length, 1);
eq("and it is the right one",
  formatsFor(vector).find((f) => f.suggested).id, "geojson");
eq("a layer with nothing in it is offered nothing", formatsFor({ name: "x" }), []);
check("every offered format explains itself",
  formatsFor(vector).every((f) => f.note && f.label && f.ext && f.mime));

// Shapefile is a vector format and only a vector format.
check("shapefile is offered to a vector layer",
  formatsFor(vector).some((f) => f.id === "shp"));
check("and never to a raster or a mesh",
  [raster, mesh].every((l) => formatsFor(l).every((f) => f.id !== "shp")));

const pointLayer = { name: "sites.shp", ext: "shp", collection: { features: [
  { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } }] } };
const mixedLayer = { name: "mixed.shp", ext: "shp", collection: { features: [
  { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } },
  { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] } };

eq("a single-type shapefile round-trips back to a shapefile",
  suggestedFormat(pointLayer), "shp");
check("and it is offered as usable",
  formatsFor(pointLayer).find((f) => f.id === "shp").disabled === undefined);

// A shapefile holds one geometry type, so a mixed collection cannot be one.
// It stays listed with the reason: vanishing would read as a missing feature.
check("a mixed collection cannot be a shapefile",
  formatsFor(mixedLayer).find((f) => f.id === "shp").disabled === true);
check("and the reason names the types that clash",
  /Point/.test(formatsFor(mixedLayer).find((f) => f.id === "shp").reason)
  && /Polygon/.test(formatsFor(mixedLayer).find((f) => f.id === "shp").reason));
eq("a mixed collection falls back to GeoJSON as the suggestion",
  suggestedFormat(mixedLayer), "geojson");
check("shapefile is still listed for it, not dropped",
  formatsFor(mixedLayer).some((f) => f.id === "shp"));

// A vector layer that carries only its feature array, with no collection
// beside it. Not reachable today -- every adapter goes through
// buildVectorLayerResult, which sets both -- but the layer record declares them
// independently, and read wrongly this is a road network offered as STL.
const featuresOnly = { name: "roads.shp", ext: "shp", object3D: {}, collection: null,
  features: [{ type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }] };
eq("features without a collection is still a vector layer", layerKind(featuresOnly), "vector");
check("and is offered vector formats, not mesh ones",
  formatsFor(featuresOnly).every((f) => ["shp", "geojson", "kml", "wkt", "csv"].includes(f.id)));
eq("a collection is built from them to write", collectionOf(featuresOnly).features.length, 1);
eq("a real collection is used as it stands",
  collectionOf(pointLayer), pointLayer.collection);
eq("nothing at all yields no collection", collectionOf({ name: "x" }), null);

/* ── bounds that cannot georeference ── */

// looksLikeGeographic (geo-utils.js:41) never compares minX with maxX, so a
// raster crossing the antimeridian passes as geographic with an inverted span
// and would be written with a negative pixel scale -- mirrored, in the wrong
// hemisphere, and legal enough that no reader complains.
const antimeridian = { name: "strip.tif", ext: "tif", raster: {
  band: [1, 2, 3, 4], width: 2, height: 2,
  bounds: { minX: 170, minY: -10, maxX: -170, maxY: 10 }, noData: null } };
check("an inverted span is not usable bounds", !hasUsableBounds(antimeridian.raster));
check("a normal span is", hasUsableBounds(geoRaster.raster));
check("bounds of zero width are not", !hasUsableBounds({ bounds: { minX: 1, minY: 0, maxX: 1, maxY: 1 } }));
check("nor are missing ones", !hasUsableBounds({ bounds: null }));
check("GeoTIFF is declined for it, with the antimeridian named",
  formatsFor(antimeridian).find((f) => f.id === "tif").disabled === true
  && /antimeridian/.test(formatsFor(antimeridian).find((f) => f.id === "tif").reason));
eq("and the suggestion falls to the grid", suggestedFormat(antimeridian), "asc");

// The grid must not inherit the bad numbers either: no header beats a
// confidently wrong one.
{
  const header = toAsciiGrid({ ...antimeridian.raster, bounds: null }).split("\n");
  eq("with no bounds the grid writes a unit cell at the origin",
    [header[2], header[3], header[4]], ["xllcorner 0", "yllcorner 0", "cellsize 1"]);
}

/* ── the name ── */

eq("the source extension is dropped", baseName({ name: "sites.shp" }), "sites");
eq("only the last one", baseName({ name: "sites.v2.geojson" }), "sites.v2");
eq("a name with no extension survives", baseName({ name: "catchment" }), "catchment");
eq("an unnamed layer still gets a filename", baseName({}), "layer");

/* ── ASCII grid ── */

// Both the band and the file start at the north edge, so rows go out in stored
// order. This was wrong once in the other direction, and the symptom is a grid
// that loads, georeferences, and is upside down -- so it is pinned here against
// the convention geotiff-adapter.js:213 actually uses.
const grid = {
  band: [1, 2, 3, 4, 5, 6],
  width: 3, height: 2,
  bounds: { minX: 10, minY: 50, maxX: 13, maxY: 52 },
  noData: null,
};
const asc = toAsciiGrid(grid).trim().split("\n");
eq("the header names the column count", asc[0], "ncols 3");
eq("and the row count", asc[1], "nrows 2");
eq("the corner is the south-west one", [asc[2], asc[3]], ["xllcorner 10", "yllcorner 50"]);
eq("cell size comes from the span, not a guess", asc[4], "cellsize 1");
eq("the northmost stored row is written first", asc[6], "1 2 3");
eq("and the southmost last", asc[7], "4 5 6");

eq("no-data cells are written as the no-data value",
  toAsciiGrid({ ...grid, band: [1, 2, 3, 4, 5, -999], noData: -999 })
    .trim().split("\n")[7].split(" ")[2],
  "-9999");
eq("NaN counts as no-data even when none was declared",
  toAsciiGrid({ ...grid, band: [1, 2, 3, 4, 5, NaN] }).trim().split("\n")[7].split(" ")[2],
  "-9999");

// The grid and the per-cell CSV must agree about which row is north: they read
// the same band, and disagreeing means one of the two exports is flipped.
{
  const gridNorth = toAsciiGrid(grid).trim().split("\n")[6].split(" ")[0];
  const csvFirst = toRasterCsv(grid).trim().split("\n")[1].split(",");
  eq("the grid's first row and the CSV's first cell are the same value",
    [gridNorth, csvFirst[2]], ["1", "1"]);
  eq("and that cell is at the northern latitude", csvFirst[1], "51.5");
}

/* ── raster CSV ── */

const csv = toRasterCsv(grid).trim().split("\n");
eq("the CSV names its columns", csv[0], "longitude,latitude,value");
eq("one row per cell, and a header", csv.length, 7);
// Cell centres, not corners: a value belongs to the middle of its cell, and
// writing corners shifts the whole grid by half a cell.
eq("the first cell is at its own centre", csv[1], "10.5,51.5,1");
eq("the last cell too", csv[6], "12.5,50.5,6");
eq("no-data cells are left out rather than written as a number",
  toRasterCsv({ ...grid, band: [1, 2, 3, 4, 5, -999], noData: -999 }).trim().split("\n").length, 6);

/* ── STL ── */

// A right triangle in the z=0 plane: its facet normal must be the plane's, +z.
const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const stl = toStl(tri, "part").trim().split("\n");
eq("the solid carries the layer's name", stl[0], "solid part");
eq("and closes with it", stl[stl.length - 1], "endsolid part");
eq("the facet normal is the facet's own plane", stl[1], "facet normal 0 0 1");
eq("three vertices per facet", stl.filter((l) => l.trim().startsWith("vertex")).length, 3);
eq("a degenerate triangle writes a zero normal rather than NaN",
  toStl([0, 0, 0, 0, 0, 0, 0, 0, 0]).trim().split("\n")[1], "facet normal 0 0 0");
eq("an empty mesh is still a valid solid",
  toStl([], "empty").trim().split("\n"), ["solid empty", "endsolid empty"]);
// A trailing partial triangle must be dropped, not read past the end.
eq("a truncated triangle is ignored", toStl([0, 0, 0, 1, 0, 0]).trim().split("\n").length, 2);

/* ── OBJ ── */

const obj = toObj(tri, "part").trim().split("\n");
eq("three corners, three vertices", obj.filter((l) => l.startsWith("v ")).length, 3);
// One-based indexing is the classic mistake here: zero-based writes a file
// that most readers reject and some silently drop a triangle from.
eq("faces are one-based", obj.find((l) => l.startsWith("f ")), "f 1 2 3");

// Two triangles sharing an edge: four distinct corners, not six.
const quad = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const welded = toObj(quad).trim().split("\n");
eq("shared corners are written once", welded.filter((l) => l.startsWith("v ")).length, 4);
eq("and both faces still reference them", welded.filter((l) => l.startsWith("f ")).length, 2);
eq("the second face reuses the first face's vertices",
  welded.filter((l) => l.startsWith("f "))[1], "f 2 4 3");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
