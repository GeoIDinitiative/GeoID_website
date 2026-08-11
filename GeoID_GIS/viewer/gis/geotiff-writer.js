/**
 * Writing a GeoTIFF.
 *
 * A GeoTIFF is a TIFF whose georeferencing lives in three private tags, so
 * this is two problems: a valid TIFF, and a coordinate system expressed inside
 * it. Neither half is forgiving -- a TIFF with its directory entries out of
 * order is rejected by strict readers, and a TIFF that reads fine with no
 * ModelTiepoint is an image, not a map.
 *
 * Written as 32-bit float, uncompressed, one sample per band. Float because it
 * keeps the values exactly as sampled rather than quantising them to an
 * integer range on the way out, which for an elevation model is the whole
 * point of exporting it.
 *
 * Three things here produce a file that opens and is wrong:
 *
 *   1. IFD entries must be sorted ascending by tag number. Readers binary
 *      search them; unsorted, tags are silently not found.
 *   2. The tiepoint maps raster (0, 0) to the north-west corner. Give it the
 *      south-west and the image georeferences upside down, which no reader can
 *      detect because both are legal.
 *   3. Any value that does not fit in an entry's four bytes lives elsewhere in
 *      the file and the entry holds an offset instead -- and which of those it
 *      is depends on the value's size, not its tag.
 */

/* ─────────────────────────────── tags ─────────────────────────────────── */

const T = {
  ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
  Photometric: 262, StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278,
  StripByteCounts: 279, PlanarConfig: 284, SampleFormat: 339,
  ExtraSamples: 338, ModelPixelScale: 33550, ModelTiepoint: 33922,
  GeoKeyDirectory: 34735, GeoAsciiParams: 34737, GdalNoData: 42113,
};

const TYPE = { SHORT: 3, LONG: 4, RATIONAL: 5, ASCII: 2, DOUBLE: 12 };
const TYPE_SIZE = { [TYPE.SHORT]: 2, [TYPE.LONG]: 4, [TYPE.RATIONAL]: 8, [TYPE.ASCII]: 1, [TYPE.DOUBLE]: 8 };

/**
 * The GeoTIFF key directory: geographic WGS84, in degrees, pixel-is-area.
 *
 * Its own little format inside a TIFF tag -- four shorts per key, after a
 * four-short header of version, revision, minor revision and key count. A key
 * whose value is not a short points into another tag instead, which is what
 * the citation does.
 */
function geoKeys(citationLength) {
  return [
    1, 1, 0, 4,                                  // version 1.1.0, four keys
    1024, 0, 1, 2,                               // GTModelType: geographic
    1025, 0, 1, 1,                               // GTRasterType: pixel is area
    2048, 0, 1, 4326,                            // GeographicType: WGS 84
    2049, T.GeoAsciiParams, citationLength, 0,   // GeogCitation, in the ASCII tag
  ];
}

const CITATION = "WGS 84|";   // the bar is the separator GeoTIFF's ASCII tag uses

/* ────────────────────────────── the writer ────────────────────────────── */

/**
 * One band as a GeoTIFF.
 *
 * Rows go out in stored order: this viewer's bands start at the north edge --
 * geotiff-adapter.js resolves a latitude to a row as (maxY - lat) -- and so
 * does a TIFF, whose first row is the top of the image.
 */
export function writeGeoTiff(raster, { noDataOut = -9999, targetStripBytes = 8 << 20 } = {}) {
  const { width, height, bounds, noData } = raster;
  // Every band the layer kept. A single-band raster still has one here, so
  // there is one path rather than two.
  const bands = raster.bands?.length ? raster.bands : [raster.band];
  const samplesPerPixel = bands.length;
  const pixels = width * height;

  const blank = (value) => value === null || value === undefined || Number.isNaN(value)
    || (noData !== null && noData !== undefined && value === noData);

  /**
   * Strips, not one block.
   *
   * A single strip means a reader must have the whole image in memory to touch
   * any of it, and some refuse a strip over 4 GB outright. Rows are grouped to
   * about eight megabytes, which is what GDAL itself writes by default.
   */
  const bytesPerRow = width * samplesPerPixel * 4;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(targetStripBytes / bytesPerRow) || 1));
  const stripCount = Math.ceil(height / rowsPerStrip);
  const stripByteCounts = [];
  for (let s = 0; s < stripCount; s += 1) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    stripByteCounts.push(rows * bytesPerRow);
  }

  const scaleX = bounds ? (bounds.maxX - bounds.minX) / width : 1;
  const scaleY = bounds ? (bounds.maxY - bounds.minY) / height : 1;
  const noDataText = `${noDataOut}\0`;
  const citation = `${CITATION}\0`;
  const keys = geoKeys(citation.length);

  const entries = [
    { tag: T.ImageWidth, type: TYPE.LONG, values: [width] },
    { tag: T.ImageLength, type: TYPE.LONG, values: [height] },
    { tag: T.BitsPerSample, type: TYPE.SHORT, values: Array(samplesPerPixel).fill(32) },
    { tag: T.Compression, type: TYPE.SHORT, values: [1] },
    { tag: T.Photometric, type: TYPE.SHORT, values: [1] },      // black is zero
    { tag: T.StripOffsets, type: TYPE.LONG, values: Array(stripCount).fill(0), isStripOffsets: true },
    { tag: T.SamplesPerPixel, type: TYPE.SHORT, values: [samplesPerPixel] },
    { tag: T.RowsPerStrip, type: TYPE.LONG, values: [rowsPerStrip] },
    { tag: T.StripByteCounts, type: TYPE.LONG, values: stripByteCounts },
    { tag: T.PlanarConfig, type: TYPE.SHORT, values: [1] },     // chunky
    { tag: T.SampleFormat, type: TYPE.SHORT, values: Array(samplesPerPixel).fill(3) },
    { tag: T.ModelPixelScale, type: TYPE.DOUBLE, values: [scaleX, scaleY, 0] },
    // Raster (0,0) is the north-west corner: column 0 at minX, row 0 at maxY.
    { tag: T.ModelTiepoint, type: TYPE.DOUBLE,
      values: [0, 0, 0, bounds ? bounds.minX : 0, bounds ? bounds.maxY : 0, 0] },
    { tag: T.GeoKeyDirectory, type: TYPE.SHORT, values: keys },
    { tag: T.GeoAsciiParams, type: TYPE.ASCII, values: [...citation].map((c) => c.charCodeAt(0)) },
    { tag: T.GdalNoData, type: TYPE.ASCII, values: [...noDataText].map((c) => c.charCodeAt(0)) },
  ];
  // Bands beyond the first are data, not alpha. Without this a reader is
  // entitled to treat sample two as transparency and composite the image away.
  if (samplesPerPixel > 1) {
    entries.push({ tag: T.ExtraSamples, type: TYPE.SHORT, values: Array(samplesPerPixel - 1).fill(0) });
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdOffset + ifdSize;
  for (const entry of entries) {
    const bytes = entry.values.length * TYPE_SIZE[entry.type];
    entry.inline = bytes <= 4;
    if (!entry.inline) {
      entry.offset = extraOffset;
      // Offsets must be even -- a rule readers do rely on.
      extraOffset += bytes + (bytes % 2);
    }
  }
  const dataOffset = extraOffset;

  // Now that the layout is fixed, the strip offsets are known.
  const stripOffsets = [];
  let at = dataOffset;
  for (const count of stripByteCounts) { stripOffsets.push(at); at += count; }
  const stripEntry = entries.find((e) => e.isStripOffsets);
  stripEntry.values = stripOffsets;

  const total = dataOffset + stripByteCounts.reduce((sum, n) => sum + n, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0x4949, true);   // "II": little-endian, and said in it
  view.setUint16(2, 42, true);       // the answer, which is TIFF's magic
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, i) => {
    const head = ifdOffset + 2 + i * 12;
    view.setUint16(head, entry.tag, true);
    view.setUint16(head + 2, entry.type, true);
    view.setUint32(head + 4, entry.values.length, true);
    const write = (offset, values) => values.forEach((value, k) => {
      if (entry.type === TYPE.SHORT) view.setUint16(offset + k * 2, value, true);
      else if (entry.type === TYPE.LONG) view.setUint32(offset + k * 4, value, true);
      else if (entry.type === TYPE.DOUBLE) view.setFloat64(offset + k * 8, value, true);
      else out[offset + k] = value;    // ASCII
    });
    if (entry.inline) write(head + 8, entry.values);
    else {
      view.setUint32(head + 8, entry.offset, true);
      write(entry.offset, entry.values);
    }
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);  // no next IFD

  // Chunky: every sample of a pixel together, then the next pixel.
  let write = dataOffset;
  for (let i = 0; i < pixels; i += 1) {
    for (let b = 0; b < samplesPerPixel; b += 1) {
      const value = bands[b][i];
      view.setFloat32(write, blank(value) ? noDataOut : value, true);
      write += 4;
    }
  }
  return out;
}
