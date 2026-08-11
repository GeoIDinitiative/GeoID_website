/**
 * Writing a layer back out.
 *
 * Importing was always one-way: data came in, was reprojected, clipped,
 * sampled and drawn, and the only way out was the extraction table, which
 * exports what a polygon sampled rather than the layer itself. So a shapefile
 * you brought in, buffered and simplified could not leave.
 *
 * What a layer can be written as is a property of what it actually carries,
 * not of what its file was called: a .shp and a .geojson both arrive as a
 * feature collection and can go out as either, while a GeoTIFF arrives as a
 * band and cannot become a polygon. So the offer is built from the layer's
 * contents, with the format closest to what came in marked as the suggestion.
 *
 * Shapefile is written properly or not offered. It is four binary files --
 * .shp, .shx, .dbf and .prj -- that have to agree with each other, and a
 * half-written one is worse than none because it opens and is quietly wrong.
 * shapefile-writer.js does the work; the one case it cannot serve is a
 * collection mixing points and polygons, since a shapefile holds a single
 * geometry type, and there the option is offered greyed with the reason on it
 * rather than silently dropping whatever does not fit.
 */

import * as VF from "./vector-formats.js?v=20260811-657ef02";
import { downloadText } from "./extraction.js?v=20260811-657ef02";
import { buildShapefileZip, shapeTypeFor, SHAPE_NAMES } from "./shapefile-writer.js?v=20260811-657ef02";

/** What a layer is, read from its contents rather than its name. */
export function layerKind(layer) {
  if (layer?.collection?.features?.length) return "vector";
  if (layer?.raster?.band) return "raster";
  if (layer?.object3D) return "mesh";
  return "unknown";
}

const VECTOR_FORMATS = [
  { id: "shp", label: "Shapefile", ext: "zip", mime: "application/zip", binary: true,
    note: "A zip of .shp, .shx, .dbf and .prj. One geometry type per file." },
  { id: "geojson", label: "GeoJSON", ext: "geojson", mime: "application/geo+json",
    note: "Geometry and attributes together, nothing lost." },
  { id: "kml", label: "KML", ext: "kml", mime: "application/vnd.google-earth.kml+xml",
    note: "For Google Earth. Attributes become description text." },
  { id: "wkt", label: "WKT", ext: "wkt", mime: "text/plain",
    note: "Geometry only, one shape per line. No attributes." },
  { id: "csv", label: "CSV", ext: "csv", mime: "text/csv",
    note: "Attribute table, with geometry as a WKT column." },
];

const RASTER_FORMATS = [
  { id: "asc", label: "ASCII Grid", ext: "asc", mime: "text/plain",
    note: "ESRI .asc. Cell values with their georeferencing header." },
  { id: "csv", label: "CSV", ext: "csv", mime: "text/csv",
    note: "One row per cell: longitude, latitude, value." },
];

const MESH_FORMATS = [
  { id: "stl", label: "STL", ext: "stl", mime: "model/stl",
    note: "Triangles only. What most meshers and printers read." },
  { id: "obj", label: "OBJ", ext: "obj", mime: "text/plain",
    note: "Triangles with shared vertices, so a smaller file." },
];

const BY_KIND = { vector: VECTOR_FORMATS, raster: RASTER_FORMATS, mesh: MESH_FORMATS };

/**
 * Which offered format is closest to what was imported.
 *
 * Not always the same extension: a shapefile cannot be written back, so the
 * suggestion for one is the format that keeps everything it held.
 */
export function suggestedFormat(layer) {
  const kind = layerKind(layer);
  const ext = String(layer?.ext || "").toLowerCase();
  if (kind === "vector") {
    // Back to what it came from, when the collection can still be one file.
    if (ext === "shp" && shapeTypeFor(layer.collection)) return "shp";
    if (ext === "kml") return "kml";
    if (ext === "wkt") return "wkt";
    if (ext === "csv" || ext === "xyz" || ext === "pts") return "csv";
    return "geojson";
  }
  if (kind === "raster") return "asc";
  if (kind === "mesh") return ext === "obj" || ext === "ply" ? "obj" : "stl";
  return null;
}

/**
 * Everything this layer can be written as, the suggestion marked and anything
 * unavailable carrying the reason why.
 *
 * Unavailable rather than absent: a shapefile export that vanishes for some
 * layers looks like a bug, where one that says "this collection mixes Point
 * and Polygon" tells you what to do about it.
 */
export function formatsFor(layer) {
  const suggestion = suggestedFormat(layer);
  const kind = layerKind(layer);
  return (BY_KIND[kind] || []).map((format) => {
    const entry = { ...format, suggested: format.id === suggestion };
    if (format.id === "shp" && !shapeTypeFor(layer.collection)) {
      entry.disabled = true;
      entry.reason = mixedGeometryReason(layer.collection);
    }
    return entry;
  });
}

/** Which types are in there, so the message names them. */
function mixedGeometryReason(collection) {
  const names = [...new Set((collection?.features || [])
    .map((f) => f?.geometry?.type).filter(Boolean))];
  if (!names.length) return "This layer has no geometry to write.";
  return `A shapefile holds one geometry type, and this layer mixes ${names.join(", ")}.`
    + " GeoJSON keeps them together.";
}

/** The name to offer, without the extension it arrived with. */
export function baseName(layer) {
  return String(layer?.name || "layer").replace(/\.[^.]+$/, "").trim() || "layer";
}

/* ─────────────────────────────── writers ──────────────────────────────── */

/**
 * ESRI ASCII grid.
 *
 * The header is the georeferencing: without it the file is a block of numbers
 * that lands at the origin. Rows run north to south, which is the opposite of
 * the row order a raster is stored in, so the band is walked backwards.
 */
export function toAsciiGrid(raster, { noDataOut = -9999, decimals = 4 } = {}) {
  const { band, width, height, bounds, noData } = raster;
  const cellSize = bounds && Number.isFinite(bounds.maxX)
    ? (bounds.maxX - bounds.minX) / width
    : 1;
  const lines = [
    `ncols ${width}`,
    `nrows ${height}`,
    `xllcorner ${bounds ? bounds.minX : 0}`,
    `yllcorner ${bounds ? bounds.minY : 0}`,
    `cellsize ${cellSize}`,
    `NODATA_value ${noDataOut}`,
  ];
  const blank = (value) => value === null || value === undefined
    || Number.isNaN(value) || (noData !== null && noData !== undefined && value === noData);
  for (let row = height - 1; row >= 0; row -= 1) {
    const cells = [];
    for (let col = 0; col < width; col += 1) {
      const value = band[row * width + col];
      cells.push(blank(value) ? String(noDataOut) : trimNumber(value, decimals));
    }
    lines.push(cells.join(" "));
  }
  return `${lines.join("\n")}\n`;
}

/** One row per cell, at cell centres rather than corners. */
export function toRasterCsv(raster, { decimals = 6 } = {}) {
  const { band, width, height, bounds, noData } = raster;
  const spanX = bounds ? bounds.maxX - bounds.minX : width;
  const spanY = bounds ? bounds.maxY - bounds.minY : height;
  const rows = ["longitude,latitude,value"];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = band[row * width + col];
      if (value === null || value === undefined || Number.isNaN(value)) continue;
      if (noData !== null && noData !== undefined && value === noData) continue;
      const x = (bounds ? bounds.minX : 0) + ((col + 0.5) / width) * spanX;
      // Row 0 is the north edge, so latitude counts down from maxY.
      const y = (bounds ? bounds.maxY : height) - ((row + 0.5) / height) * spanY;
      rows.push(`${trimNumber(x, decimals)},${trimNumber(y, decimals)},${trimNumber(value, decimals)}`);
    }
  }
  return `${rows.join("\n")}\n`;
}

/**
 * ASCII STL from flat triangle coordinates -- nine numbers per triangle.
 *
 * The facet normal is computed rather than taken from the geometry: STL stores
 * one normal per facet and a vertex-normal attribute is per corner, so reusing
 * the first corner's normal would write a smooth-shading value into a field
 * that means the facet's own plane.
 */
export function toStl(positions, name = "geoid") {
  const out = [`solid ${name}`];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) { nx /= length; ny /= length; nz /= length; }
    out.push(`facet normal ${trimNumber(nx, 6)} ${trimNumber(ny, 6)} ${trimNumber(nz, 6)}`);
    out.push("  outer loop");
    out.push(`    vertex ${trimNumber(ax, 6)} ${trimNumber(ay, 6)} ${trimNumber(az, 6)}`);
    out.push(`    vertex ${trimNumber(bx, 6)} ${trimNumber(by, 6)} ${trimNumber(bz, 6)}`);
    out.push(`    vertex ${trimNumber(cx, 6)} ${trimNumber(cy, 6)} ${trimNumber(cz, 6)}`);
    out.push("  endloop");
    out.push("endfacet");
  }
  out.push(`endsolid ${name}`);
  return `${out.join("\n")}\n`;
}

/**
 * OBJ, with duplicate corners merged.
 *
 * A triangle soup writes every corner three times over; welding on exact
 * coordinates typically cuts an imported mesh to under half its vertices, and
 * OBJ indices are one-based, which is the classic off-by-one here.
 */
export function toObj(positions, name = "geoid") {
  const index = new Map();
  const vertices = [];
  const faces = [];
  const idFor = (x, y, z) => {
    const key = `${x},${y},${z}`;
    let id = index.get(key);
    if (id === undefined) {
      vertices.push(`v ${trimNumber(x, 6)} ${trimNumber(y, 6)} ${trimNumber(z, 6)}`);
      id = vertices.length; // one-based, as OBJ counts
      index.set(key, id);
    }
    return id;
  };
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = idFor(positions[i], positions[i + 1], positions[i + 2]);
    const b = idFor(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = idFor(positions[i + 6], positions[i + 7], positions[i + 8]);
    faces.push(`f ${a} ${b} ${c}`);
  }
  return `# ${name}\n${vertices.join("\n")}\n${faces.join("\n")}\n`;
}

/** Short numbers without exponent notation or a tail of zeros. */
function trimNumber(value, decimals) {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/* ──────────────────────────── scene extraction ────────────────────────── */

/**
 * Every triangle under an object, in the object's own frame.
 *
 * Its own frame, not the world's: these meshes hang off the globe group, which
 * carries the planet's tilt and its current spin, so world coordinates would
 * bake whatever time it happened to be into the exported geometry.
 */
export function collectTriangles(root) {
  const out = [];
  if (!root) return out;
  root.updateMatrixWorld?.(true);
  const inverse = root.matrixWorld?.clone?.().invert?.();
  root.traverse?.((node) => {
    const geometry = node.geometry;
    const position = geometry?.attributes?.position;
    if (!node.isMesh || !position) return;
    const matrix = inverse && node.matrixWorld
      ? inverse.clone().multiply(node.matrixWorld)
      : null;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 1) {
      const at = index ? index.getX(i) : i;
      let x = position.getX(at);
      let y = position.getY(at);
      let z = position.getZ(at);
      if (matrix) {
        const e = matrix.elements;
        const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
        const tx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
        const ty = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
        const tz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
        x = tx; y = ty; z = tz;
      }
      out.push(x, y, z);
    }
  });
  return out;
}

/* ───────────────────────────────  export  ─────────────────────────────── */

/** The bytes for one layer in one format, without touching the page. */
export function renderExport(layer, formatId) {
  const kind = layerKind(layer);
  const format = (BY_KIND[kind] || []).find((f) => f.id === formatId);
  if (!format) return null;
  const base = baseName(layer);
  let text = "";
  if (kind === "vector" && formatId === "shp") {
    const bytes = buildShapefileZip(layer.collection, base);
    if (!bytes) return null;
    return {
      filename: `${base}_shapefile.zip`,
      mime: format.mime,
      bytes,
      shapeType: SHAPE_NAMES[shapeTypeFor(layer.collection)],
    };
  }
  if (kind === "vector") {
    if (formatId === "geojson") text = VF.toGeoJson(layer.collection);
    else if (formatId === "kml") text = VF.toKml(layer.collection, { name: base });
    else if (formatId === "wkt") text = VF.toWkt(layer.collection);
    else text = VF.toCsv(layer.collection);
  } else if (kind === "raster") {
    text = formatId === "asc" ? toAsciiGrid(layer.raster) : toRasterCsv(layer.raster);
  } else if (kind === "mesh") {
    const positions = collectTriangles(layer.object3D);
    text = formatId === "obj" ? toObj(positions, base) : toStl(positions, base);
  }
  return { filename: `${base}.${format.ext}`, mime: format.mime, text };
}

/**
 * Write it out. Text goes through the same path every other export here uses,
 * which also files it against the open project when there is one; the zip
 * cannot take that path, because the project bridge stores text.
 */
export function exportLayer(layer, formatId) {
  const result = renderExport(layer, formatId);
  if (!result) return null;
  if (result.bytes) downloadBytes(result.filename, result.bytes, result.mime);
  else downloadText(result.filename, result.text, result.mime);
  return result;
}

function downloadBytes(filename, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
