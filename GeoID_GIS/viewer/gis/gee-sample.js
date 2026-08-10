/**
 * Reading a value back out of a GEE drape.
 *
 * A drape is a **picture of** data, not the data: Earth Engine renders one band
 * through a palette and sends a PNG. So extraction over a rainfall layer has a
 * choice — report the colour, which is useless in a spreadsheet, or invert the
 * visualisation back to millimetres.
 *
 * Inverting is possible because the cache manifest records exactly how the
 * picture was made: `palette` (the colour stops) and `legend` (`min`, `max`,
 * `unit`). Earth Engine ramps a single band linearly between those stops across
 * that range, so a pixel's position along the ramp is its value.
 *
 * **What this is not.** It is an inverse of the *rendering*, not the source
 * data, and it is quantised by it: 8 bits per channel over the ramp, plus PNG
 * colour handling. CHIRPS at 0–300 mm through four stops resolves to a few mm at
 * best. It is the right number to a few percent and must never be presented as
 * the raw band — the column carries the unit and the layer records that the
 * value was recovered from the palette. Where there is no legend there is no
 * inverse, and the sampler says so rather than inventing one.
 */

/** "ff6f31" or "#ff6f31" to {r, g, b}. */
export function parseHex(hex) {
  const text = String(hex || "").replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  };
}

/**
 * The palette expanded into a lookup along its ramp, each entry carrying the
 * position `t` (0..1) that produced it.
 *
 * Linear in RGB between consecutive stops, which is what Earth Engine's own
 * `palette` visualisation does. Interpolating in some perceptual space would be
 * prettier and would not match the picture we are reading.
 */
export function paletteRamp(palette, steps = 256) {
  const stops = (palette || []).map(parseHex).filter(Boolean);
  if (stops.length < 2) return null;
  const ramp = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const span = t * (stops.length - 1);
    const low = Math.min(stops.length - 2, Math.floor(span));
    const f = span - low;
    ramp.push({
      t,
      r: stops[low].r + (stops[low + 1].r - stops[low].r) * f,
      g: stops[low].g + (stops[low + 1].g - stops[low].g) * f,
      b: stops[low].b + (stops[low + 1].b - stops[low].b) * f,
    });
  }
  return ramp;
}

/**
 * How far a colour may sit from the ramp and still be read as a value.
 *
 * This is the guard that stops the whole thing lying. A drape covers its
 * bounding box, but the *data* often does not — ocean under a rainfall layer,
 * unburnt ground under a burn-date layer — and those pixels are background, not
 * zero. Without a distance test the nearest ramp colour is always *some*
 * colour, so every one of them would come back as a confident number. 60 out of
 * a possible 441 (the RGB diagonal) admits PNG and sRGB drift while rejecting
 * anything that is not on the ramp.
 */
export const MAX_RAMP_DISTANCE = 60;

/**
 * The value a pixel represents, or null when it does not represent one.
 *
 * Null for transparent pixels (outside the data) and for colours too far from
 * the ramp to be a rendering of it.
 */
export function valueFromColour(pixel, ramp, legend, maxDistance = MAX_RAMP_DISTANCE) {
  if (!pixel || !ramp || !legend) return null;
  if (Number.isFinite(pixel.a) && pixel.a < 24) return null;
  // `Number(null)` is 0 and `Number("")` is 0, so a legend missing a bound
  // would otherwise pass as a perfectly good range starting at zero — and every
  // pixel would come back as a number derived from a bound nobody supplied.
  const bound = (value) => (value === null || value === undefined || value === ""
    ? NaN : Number(value));
  const min = bound(legend.min);
  const max = bound(legend.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const entry of ramp) {
    const distance = Math.hypot(entry.r - pixel.r, entry.g - pixel.g, entry.b - pixel.b);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  if (!best || bestDistance > maxDistance) return null;
  return min + best.t * (max - min);
}

/** Where a coordinate falls in an equirectangular image over `bounds`. */
export function pixelFor(lat, lon, bounds, width, height) {
  const { minX, minY, maxX, maxY } = bounds || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  // The viewer carries east-positive 0-360 in places and signed elsewhere; the
  // bounds decide which one this image is in, so meet them there.
  let x = lon;
  if (x > maxX && x - 360 >= minX) x -= 360;
  if (x < minX && x + 360 <= maxX) x += 360;
  if (lat < minY || lat > maxY || x < minX || x > maxX) return null;
  return {
    px: Math.min(width - 1, Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * width))),
    py: Math.min(height - 1, Math.max(0, Math.floor(((maxY - lat) / (maxY - minY)) * height))),
  };
}

/**
 * A column name that cannot be mistaken for the raw band.
 *
 * "Rainfall_CHIRPS_mm" is a measurement; "Rainfall_CHIRPS_rgb" is a colour.
 * Which one a reader gets is decided here, once, by whether the value could be
 * recovered at all.
 */
export function columnName(name, legend) {
  const base = String(name || "layer")
    .replace(/\s*·.*$/, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const unit = legend?.unit ? String(legend.unit).replace(/[^A-Za-z0-9]+/g, "") : "";
  return unit ? `${base}_${unit}` : base;
}

/**
 * Build a `(lat, lon) => value` sampler over a drawn image.
 *
 * `read` is injected so the arithmetic above can be tested without a canvas;
 * `geeSamplerFromImage` below supplies the real one.
 */
export function makeSampler({ read, bounds, width, height, palette, legend }) {
  const ramp = paletteRamp(palette);
  return (lat, lon) => {
    const at = pixelFor(lat, lon, bounds, width, height);
    if (!at) return null;
    const pixel = read(at.px, at.py);
    if (!pixel) return null;
    if (Number.isFinite(pixel.a) && pixel.a < 24) return null;
    const value = valueFromColour(pixel, ramp, legend);
    if (value !== null) return value;
    // No legend, or a colour off the ramp. Returning the colour is honest and
    // occasionally useful; returning a number here would not be either.
    return ramp && legend
      ? null
      : { r: pixel.r, g: pixel.g, b: pixel.b };
  };
}

/**
 * The browser half: draw the drape once into a canvas and read pixels from it.
 *
 * Once, because `getImageData` per sample would be a readback per point and an
 * extraction is tens of thousands of points.
 */
export function geeSamplerFromImage(image, { bounds, palette, legend } = {}) {
  if (!image || typeof document === "undefined") return null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch (error) {
    // A cross-origin image without CORS taints the canvas. The drape still
    // shows; it simply cannot be read back.
    return null;
  }
  const read = (px, py) => {
    const at = (py * width + px) * 4;
    return { r: data[at], g: data[at + 1], b: data[at + 2], a: data[at + 3] };
  };
  return makeSampler({ read, bounds, width, height, palette, legend });
}
