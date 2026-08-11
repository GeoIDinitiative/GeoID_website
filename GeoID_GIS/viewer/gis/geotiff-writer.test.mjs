/**
 * The GeoTIFF writer, checked by parsing its own bytes as a TIFF reader would.
 *
 * Verified against GDAL and tifffile once by hand -- both open the output,
 * report EPSG:4326, Float32, the right origin and the right values -- but that
 * needs a Python environment with GDAL in it, so what runs here is a reader
 * written against the specification.
 *
 * The three failures that produce a file which opens and is wrong:
 *
 *   1. Directory entries out of ascending tag order. Readers binary search
 *      them, so an unsorted tag is simply not found -- no error, just a file
 *      that has apparently lost its georeferencing.
 *   2. A tiepoint at the wrong corner. Raster (0,0) is the north-west corner;
 *      give it the south-west and the map is upside down, and both are legal
 *      files so nothing can warn you.
 *   3. Values over four bytes must live outside their entry with the entry
 *      holding an offset -- and whether that applies depends on the value's
 *      size, not on which tag it is.
 *
 * Run: node GeoID_GIS/viewer/gis/geotiff-writer.test.mjs
 */

import { writeGeoTiff } from "./geotiff-writer.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/* ─────────────────────────── a reader, for the test ───────────────────── */

const SIZE = { 2: 1, 3: 2, 4: 4, 5: 8, 12: 8 };

function readTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {
    byteOrder: String.fromCharCode(bytes[0], bytes[1]),
    magic: view.getUint16(2, true),
    tags: new Map(),
    tagOrder: [],
  };
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, true);
    const type = view.getUint16(at + 2, true);
    const n = view.getUint32(at + 4, true);
    const bytesNeeded = n * SIZE[type];
    const from = bytesNeeded <= 4 ? at + 8 : view.getUint32(at + 8, true);
    const values = [];
    for (let k = 0; k < n; k += 1) {
      if (type === 3) values.push(view.getUint16(from + k * 2, true));
      else if (type === 4) values.push(view.getUint32(from + k * 4, true));
      else if (type === 12) values.push(view.getFloat64(from + k * 8, true));
      else values.push(bytes[from + k]);
    }
    out.tagOrder.push(tag);
    out.tags.set(tag, { type, count: n, values, inline: bytesNeeded <= 4 });
  }
  out.nextIfd = view.getUint32(ifd + 2 + count * 12, true);
  // The samples, read through the offset the file itself declares.
  const stripAt = out.tags.get(273).values[0];
  const pixels = out.tags.get(256).values[0] * out.tags.get(257).values[0];
  out.samples = [];
  for (let i = 0; i < pixels; i += 1) out.samples.push(view.getFloat32(stripAt + i * 4, true));
  return out;
}

/* ──────────────────────────────── a raster ────────────────────────────── */

// 3 wide, 2 tall. Row 0 is the north row, which is how this viewer stores a
// band: geotiff-adapter.js resolves a latitude to a row as (maxY - lat).
const raster = {
  band: [10, 20, 30, 40, -999, 60],
  width: 3, height: 2,
  bounds: { minX: 10, minY: 50, maxX: 13, maxY: 52 },
  noData: -999,
};
const tiff = readTiff(writeGeoTiff(raster));

/* ───────────────────────────── a valid TIFF ───────────────────────────── */

eq("it says which byte order it is in", tiff.byteOrder, "II");
eq("and carries TIFF's magic number", tiff.magic, 42);
eq("there is exactly one image in it", tiff.nextIfd, 0);

// Readers binary search the directory. Unsorted, a tag is not found at all.
eq("directory entries are in ascending tag order",
  tiff.tagOrder, [...tiff.tagOrder].sort((a, b) => a - b));

eq("the image is the size of the band", [tiff.tags.get(256).values[0], tiff.tags.get(257).values[0]], [3, 2]);
eq("one sample per pixel", tiff.tags.get(277).values[0], 1);
eq("at 32 bits", tiff.tags.get(258).values[0], 32);
// Without this a reader takes the bits as a 32-bit integer, and every
// elevation comes back as a vast meaningless number.
eq("declared as IEEE floating point", tiff.tags.get(339).values[0], 3);
eq("uncompressed", tiff.tags.get(259).values[0], 1);
eq("in a single strip", tiff.tags.get(278).values[0], 2);
eq("whose byte count matches the pixels", tiff.tags.get(279).values[0], 3 * 2 * 4);

/* ────────────────────────── georeferencing ────────────────────────────── */

// The whole point of the format: an image with no tiepoint is just an image.
eq("the tiepoint puts raster 0,0 at the north-west corner",
  tiff.tags.get(33922).values, [0, 0, 0, 10, 52, 0]);
eq("the pixel scale comes from the bounds",
  tiff.tags.get(33550).values, [1, 1, 0]);

const keys = tiff.tags.get(34735).values;
eq("the key directory declares its version and count", keys.slice(0, 4), [1, 1, 0, 4]);
eq("the model is geographic", keys.slice(4, 8), [1024, 0, 1, 2]);
eq("pixels are areas, not points", keys.slice(8, 12), [1025, 0, 1, 1]);
eq("the datum is WGS84 by its EPSG code", keys.slice(12, 16), [2048, 0, 1, 4326]);
// A key whose value is text points at the ASCII tag rather than holding it.
eq("the citation is delegated to the ASCII tag", keys[13 + 4], 34737);

check("a no-data value is recorded for readers to honour",
  String.fromCharCode(...tiff.tags.get(42113).values).replace(/\0/g, "") === "-9999");

/* ──────────────────────────── inline or not ───────────────────────────── */

// Four bytes or fewer live in the entry; more live elsewhere in the file. Get
// this backwards either way and the reader takes an offset for a value.
check("a small value sits inside its entry", tiff.tags.get(256).inline);
check("and a large one is stored out of line", !tiff.tags.get(33922).inline);
check("including the key directory", !tiff.tags.get(34735).inline);

/* ──────────────────────────────── pixels ──────────────────────────────── */

eq("the north row is written first, unflipped", tiff.samples.slice(0, 3), [10, 20, 30]);
eq("and the south row second", tiff.samples.slice(3), [40, -9999, 60]);
eq("no-data cells become the declared no-data value", tiff.samples[4], -9999);

eq("NaN is treated as no-data even when none was declared",
  readTiff(writeGeoTiff({ ...raster, band: [1, 2, 3, 4, NaN, 6], noData: null })).samples[4],
  -9999);

/* ───────────────────────────── odd shapes ─────────────────────────────── */

const single = readTiff(writeGeoTiff({
  band: [42], width: 1, height: 1,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, noData: null,
}));
eq("a one-cell raster is still a valid TIFF", single.magic, 42);
eq("with its one value", single.samples, [42]);

// A raster with no bounds should not be offered as a GeoTIFF at all, but if it
// arrives here it must still produce a readable file rather than throw.
const unbounded = readTiff(writeGeoTiff({
  band: [1, 2, 3, 4], width: 2, height: 2, bounds: null, noData: null,
}));
eq("no bounds still writes a file", unbounded.samples, [1, 2, 3, 4]);
eq("with a unit scale rather than a broken one", unbounded.tags.get(33550).values, [1, 1, 0]);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
