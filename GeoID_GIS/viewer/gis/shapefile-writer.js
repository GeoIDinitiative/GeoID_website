/**
 * Writing a shapefile: .shp, .shx, .dbf and .prj, zipped.
 *
 * A shapefile is not one file, which is why exporting one is more than a
 * serialiser. The geometry lives in .shp, an index of record offsets in .shx,
 * the attribute table in a dBASE III .dbf, and the coordinate system in a .prj
 * holding a WKT string. Miss any of them and the result opens somewhere and
 * fails somewhere else: without .shx many readers refuse the file outright,
 * without .prj it loads at the right numbers in an unknown system, and a .dbf
 * whose record count disagrees with the .shp gives you geometry with the wrong
 * rows attached.
 *
 * Three details in here are the ones that produce a file which opens and is
 * quietly wrong, which is the failure mode worth the most care:
 *
 *   1. Ring winding is the opposite of GeoJSON's. RFC 7946 says an outer ring
 *      is counter-clockwise; a shapefile says clockwise, with holes the other
 *      way. Copy the coordinates across unchanged and every polygon's outer
 *      ring is read as a hole -- the file is valid, draws, and is inside out.
 *   2. Two byte orders in the same header. The file code and all the lengths
 *      are big-endian; the version, shape type and every coordinate are
 *      little-endian. There is no flag saying which -- it is per field.
 *   3. Lengths are counted in 16-bit words, not bytes.
 *
 * One shapefile holds one geometry type. A collection mixing points and
 * polygons cannot become one, and this says so rather than dropping what does
 * not fit.
 */

/* ───────────────────────────── shape types ────────────────────────────── */

export const NULL_SHAPE = 0;
export const POINT = 1;
export const POLYLINE = 3;
export const POLYGON = 5;
export const MULTIPOINT = 8;

const GEOMETRY_TO_SHAPE = {
  Point: POINT,
  MultiPoint: MULTIPOINT,
  LineString: POLYLINE,
  MultiLineString: POLYLINE,
  Polygon: POLYGON,
  MultiPolygon: POLYGON,
};

export const SHAPE_NAMES = {
  [POINT]: "Point", [POLYLINE]: "PolyLine", [POLYGON]: "Polygon",
  [MULTIPOINT]: "MultiPoint", [NULL_SHAPE]: "Null",
};

/**
 * The one shape type a collection can be written as, or null if it holds more
 * than one. Points and multipoints are different types in a shapefile, as are
 * lines and polygons, so there is no widening that would rescue a mixed set.
 */
export function shapeTypeFor(collection) {
  const types = new Set();
  for (const feature of collection?.features || []) {
    const geometryType = feature?.geometry?.type;
    if (!geometryType) continue;
    const shape = GEOMETRY_TO_SHAPE[geometryType];
    if (!shape) return null;
    types.add(shape);
  }
  if (types.size === 0) return null;
  return types.size === 1 ? [...types][0] : null;
}

/* ────────────────────────────── geometry ──────────────────────────────── */

/** Twice the signed area. Positive is counter-clockwise. */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return sum;
}

/**
 * A ring wound the way a shapefile wants it.
 *
 * Outer rings clockwise, holes counter-clockwise -- the reverse of GeoJSON in
 * both cases, so this is not a no-op for well-formed input. It is also not
 * trusting the input's declared order: a GeoJSON in the wild is often wound
 * either way, and the winding is the only thing that says hole or not.
 */
export function orientRing(ring, wantClockwise) {
  const isClockwise = ringArea(ring) < 0;
  return isClockwise === wantClockwise ? ring : [...ring].reverse();
}

/** Every part of a geometry, as flat rings, wound for a shapefile. */
export function partsOf(geometry) {
  const type = geometry?.type;
  const coords = geometry?.coordinates || [];
  if (type === "Point") return [[coords]];
  if (type === "MultiPoint") return [coords];
  if (type === "LineString") return [coords];
  if (type === "MultiLineString") return coords;
  if (type === "Polygon") {
    return coords.map((ring, index) => orientRing(ring, index === 0));
  }
  if (type === "MultiPolygon") {
    return coords.flatMap((polygon) => polygon.map((ring, index) => orientRing(ring, index === 0)));
  }
  return [];
}

function boundsOf(parts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of parts) {
    for (const [x, y] of part) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/* ──────────────────────────────── .shp ────────────────────────────────── */

/** One record's geometry payload, without its record header. */
function recordContent(shapeType, geometry) {
  const parts = partsOf(geometry);
  if (shapeType === POINT) {
    const [x, y] = parts[0]?.[0] || [0, 0];
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setInt32(0, POINT, true);
    view.setFloat64(4, x, true);
    view.setFloat64(12, y, true);
    return new Uint8Array(buffer);
  }

  const points = parts.flat();
  const box = boundsOf(parts);

  if (shapeType === MULTIPOINT) {
    const buffer = new ArrayBuffer(40 + points.length * 16);
    const view = new DataView(buffer);
    view.setInt32(0, MULTIPOINT, true);
    view.setFloat64(4, box.minX, true);
    view.setFloat64(12, box.minY, true);
    view.setFloat64(20, box.maxX, true);
    view.setFloat64(28, box.maxY, true);
    view.setInt32(36, points.length, true);
    points.forEach(([x, y], i) => {
      view.setFloat64(40 + i * 16, x, true);
      view.setFloat64(48 + i * 16, y, true);
    });
    return new Uint8Array(buffer);
  }

  // PolyLine and Polygon share a layout; only the type code differs.
  const buffer = new ArrayBuffer(44 + parts.length * 4 + points.length * 16);
  const view = new DataView(buffer);
  view.setInt32(0, shapeType, true);
  view.setFloat64(4, box.minX, true);
  view.setFloat64(12, box.minY, true);
  view.setFloat64(20, box.maxX, true);
  view.setFloat64(28, box.maxY, true);
  view.setInt32(36, parts.length, true);
  view.setInt32(40, points.length, true);
  let offset = 44;
  let start = 0;
  for (const part of parts) {
    // The parts array holds the index of each part's first point, not its
    // length -- a reader takes the difference between neighbours.
    view.setInt32(offset, start, true);
    offset += 4;
    start += part.length;
  }
  points.forEach(([x, y], i) => {
    view.setFloat64(offset + i * 16, x, true);
    view.setFloat64(offset + 8 + i * 16, y, true);
  });
  return new Uint8Array(buffer);
}

function fileHeader(byteLength, shapeType, box) {
  const buffer = new ArrayBuffer(100);
  const view = new DataView(buffer);
  view.setInt32(0, 9994);              // big-endian file code, the format's magic
  view.setInt32(24, byteLength / 2);   // big-endian, in 16-bit words
  view.setInt32(28, 1000, true);       // little-endian version
  view.setInt32(32, shapeType, true);
  view.setFloat64(36, box.minX, true);
  view.setFloat64(44, box.minY, true);
  view.setFloat64(52, box.maxX, true);
  view.setFloat64(60, box.maxY, true);
  return new Uint8Array(buffer);
}

/**
 * The geometry file and its index, built together.
 *
 * Together because the index is a list of where each record starts in the
 * other file: built separately they can disagree, and a shapefile whose .shx
 * is out by one record is a shapefile that opens on the wrong geometry.
 */
export function writeShpAndShx(features, shapeType) {
  const contents = features.map((feature) => recordContent(shapeType, feature.geometry));
  const shpLength = 100 + contents.reduce((sum, content) => sum + 8 + content.length, 0);
  const shxLength = 100 + contents.length * 8;

  const allParts = features.flatMap((feature) => partsOf(feature.geometry));
  const box = boundsOf(allParts);

  const shp = new Uint8Array(shpLength);
  const shx = new Uint8Array(shxLength);
  shp.set(fileHeader(shpLength, shapeType, box), 0);
  shx.set(fileHeader(shxLength, shapeType, box), 0);

  const shpView = new DataView(shp.buffer);
  const shxView = new DataView(shx.buffer);
  let offset = 100;
  contents.forEach((content, i) => {
    const words = content.length / 2;
    shpView.setInt32(offset, i + 1);        // record numbers are one-based
    shpView.setInt32(offset + 4, words);    // both big-endian
    shp.set(content, offset + 8);
    shxView.setInt32(100 + i * 8, offset / 2);
    shxView.setInt32(104 + i * 8, words);
    offset += 8 + content.length;
  });
  return { shp, shx };
}

/* ──────────────────────────────── .dbf ────────────────────────────────── */

const DBF_MAX_TEXT = 254;

/**
 * The attribute table's columns, inferred from the values present.
 *
 * dBASE fields are fixed width and typed, so the whole column has to be sized
 * before a single row is written -- and names are capped at ten characters,
 * which can collide. Collisions are resolved rather than left to overwrite
 * each other silently.
 */
export function dbfFields(features) {
  const seen = new Map();
  for (const feature of features) {
    for (const [key, value] of Object.entries(feature?.properties || {})) {
      const field = seen.get(key)
        || { key, numeric: true, text: 1, intDigits: 1, fractional: false };
      if (value === null || value === undefined) {
        seen.set(key, field);
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) field.numeric = false;
      field.text = Math.max(field.text, byteLength(String(value)));
      if (typeof value === "number" && Number.isFinite(value)) {
        // The column has to fit the text that will be written into it, which
        // for a number is its whole part plus the decimals this writer emits --
        // not the length of the value as JavaScript prints it. Sized from the
        // latter, 5 became a one-character column and 12.5 was written as "1".
        field.intDigits = Math.max(field.intDigits, String(Math.trunc(value)).length);
        if (!Number.isInteger(value)) field.fractional = true;
      }
      seen.set(key, field);
    }
  }
  const names = new Set();
  return [...seen.values()].map((field) => {
    // Column names stay ASCII on purpose: readers are far less forgiving about
    // them than about values, and a name is ours to sanitise where a value is
    // the user's data.
    let name = field.key.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 10).toUpperCase() || "FIELD";
    if (names.has(name)) {
      // Ten characters is the hard limit, so the counter has to eat into the
      // name rather than extend past it.
      let n = 1;
      let candidate = name;
      while (names.has(candidate)) {
        const suffix = String(n);
        candidate = `${name.slice(0, 10 - suffix.length)}${suffix}`;
        n += 1;
      }
      name = candidate;
    }
    names.add(name);
    if (!field.numeric) {
      return {
        key: field.key, name, type: "C",
        width: Math.min(Math.max(field.text, 1), DBF_MAX_TEXT), decimals: 0,
      };
    }
    // Whole numbers get no decimal places at all, rather than six zeros after
    // every count and every id.
    const decimals = field.fractional ? 6 : 0;
    const width = Math.min(field.intDigits + (decimals ? decimals + 1 : 0), 18);
    return { key: field.key, name, type: "N", width, decimals };
  });
}

const UTF8 = new TextEncoder();

/**
 * How many bytes a value occupies in the table, which is not how many
 * characters it has.
 *
 * dBASE columns are sized in bytes. Sizing them in characters and then writing
 * UTF-8 truncates every accented name at the column edge -- and an earlier
 * version avoided that by replacing anything non-ASCII with a question mark,
 * so Krakow lost its o and every CJK label became a row of them.
 */
function byteLength(text) {
  return UTF8.encode(text).length;
}

/**
 * Text into a fixed-width column, space padded.
 *
 * Truncation walks back off a partial character: cutting UTF-8 mid-sequence
 * leaves bytes no decoder can read, which is a worse failure than a shortened
 * name because it can make a reader reject the whole record.
 */
function writeText(target, offset, text, width) {
  let bytes = UTF8.encode(text);
  if (bytes.length > width) {
    let end = width;
    while (end > 0 && (bytes[end] & 0xC0) === 0x80) end -= 1;  // continuation byte
    bytes = bytes.subarray(0, end);
  }
  for (let i = 0; i < width; i += 1) {
    target[offset + i] = i < bytes.length ? bytes[i] : 32;
  }
}

export function writeDbf(features, fields, { date = new Date(2000, 0, 1) } = {}) {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.width, 0);
  const total = headerLength + features.length * recordLength + 1;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out[0] = 0x03;                       // dBASE III, no memo
  out[1] = date.getFullYear() - 1900;  // the format's own epoch
  out[2] = date.getMonth() + 1;
  out[3] = date.getDate();
  view.setUint32(4, features.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, i) => {
    const at = 32 + i * 32;
    // The name field is eleven bytes zero-filled, not space-padded like every
    // value in the table below it. Space-padding leaves a reader with a column
    // called "NAME      ", which then does not match the field the caller asks
    // for -- the file opens and the attributes appear to be missing.
    for (let c = 0; c < 11; c += 1) {
      out[at + c] = c < field.name.length ? field.name.charCodeAt(c) : 0;
    }
    out[at + 11] = field.type.charCodeAt(0);
    out[at + 16] = field.width;
    out[at + 17] = field.decimals;
  });
  out[32 + fields.length * 32] = 0x0D; // the field descriptors end here

  let offset = headerLength;
  for (const feature of features) {
    out[offset] = 0x20;                // a space means "not deleted"
    let at = offset + 1;
    for (const field of fields) {
      const value = feature?.properties?.[field.key];
      let text;
      if (value === null || value === undefined) {
        text = "";
      } else if (field.type === "N") {
        const rounded = Number(value).toFixed(field.decimals);
        // Numbers are right-aligned in their column; left-aligned they read as
        // a different number in some readers.
        text = rounded.length > field.width ? rounded.slice(0, field.width) : rounded.padStart(field.width);
      } else {
        text = String(value).slice(0, field.width);
      }
      writeText(out, at, text, field.width);
      at += field.width;
    }
    offset += recordLength;
  }
  out[total - 1] = 0x1A;               // end-of-file marker
  return out;
}

/* ──────────────────────────────── .prj ────────────────────────────────── */

/**
 * WGS84 in the exact wording ESRI writes, which is what readers match against.
 * Everything on the globe is in this system, so it is not a parameter.
 */
export const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
  + 'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
  + 'UNIT["Degree",0.0174532925199433]]';

/* ──────────────────────────────── zip ─────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * A zip with everything stored rather than deflated.
 *
 * Stored because deflate would mean shipping a compressor for a handful of
 * files the user is about to unzip anyway, and every zip reader handles
 * method 0. The four files must travel together -- that is the whole reason a
 * shapefile export is an archive and not a download.
 */
export function zipStore(files) {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({
    nameBytes: encoder.encode(file.name),
    data: file.data,
    crc: crc32(file.data),
  }));

  const localSize = entries.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  entries.forEach((entry) => {
    entry.offset = offset;
    view.setUint32(offset, 0x04034b50, true);      // local file header
    view.setUint16(offset + 4, 20, true);          // version needed
    view.setUint16(offset + 8, 0, true);           // method 0: stored
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    out.set(entry.nameBytes, offset + 30);
    out.set(entry.data, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + entry.data.length;
  });

  const centralStart = offset;
  entries.forEach((entry) => {
    view.setUint32(offset, 0x02014b50, true);      // central directory header
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint32(offset + 42, entry.offset, true);
    out.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  });

  view.setUint32(offset, 0x06054b50, true);        // end of central directory
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}

/* ─────────────────────────────── the set ──────────────────────────────── */

/**
 * The four files, zipped, or null when the collection cannot be one shapefile.
 *
 * Null rather than a best effort: dropping the features that do not fit the
 * chosen type would hand back a file that looks complete and is missing rows.
 */
export function buildShapefileZip(collection, name = "layer", options = {}) {
  const shapeType = shapeTypeFor(collection);
  if (!shapeType) return null;
  const features = (collection.features || []).filter((f) => f?.geometry);
  const { shp, shx } = writeShpAndShx(features, shapeType);
  const fields = dbfFields(features);
  const dbf = writeDbf(features, fields, options);
  return zipStore([
    { name: `${name}.shp`, data: shp },
    { name: `${name}.shx`, data: shx },
    { name: `${name}.dbf`, data: dbf },
    { name: `${name}.prj`, data: UTF8.encode(PRJ_WGS84) },
    // A .dbf carries no encoding of its own, so a reader guesses -- usually at
    // some 1990s code page. This is the file that tells it, and it is why the
    // values above can be UTF-8 at all.
    { name: `${name}.cpg`, data: UTF8.encode("UTF-8") },
  ]);
}
