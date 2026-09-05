/**
 * WHAT A CLICK ON THE SOIL-THICKNESS SHEET RESOLVES TO.
 *
 * The geology polygons have answered a click since the beginning: a unit is
 * not a colour, it is a name, an age and a lithology, and the card says so.
 * A raster has the same claim on a click and none of the machinery — it has
 * no features to hit-test, so `feature-popup.js` found nothing under the
 * pointer and dismissed the card. The sheet was a picture with a legend.
 *
 * Two halves, and this is the pure one: WHICH CELL a point falls in, and WHAT
 * THE CARD SAYS about the value that comes back. The read itself is in
 * `soil-thickness.js` beside the COG it reads from. Splitting them is what
 * lets the arithmetic be checked without a browser — and the arithmetic is
 * the part that goes wrong silently, because an index off by one still
 * returns a plausible number for the wrong kilometre.
 *
 * THE VALUE IS READ FROM THE SOURCE CELL, NOT OFF THE PICTURE. The drawn
 * sheet is resampled to at most 1,600 px across the view, so at a wide view
 * one drawn pixel is many source cells and its colour is a blend of them.
 * Sampling the texture would answer with an average that exists nowhere in
 * the data. A click asks the file.
 */

/** One degree of latitude, near enough for a cell that is under a kilometre. */
const KM_PER_DEGREE = 111.32;

/**
 * The cell a point falls in.
 *
 * `floor`, not `round`: a grid cell is the ground from its own edge to the
 * next one, and rounding would answer with the NEAREST cell centre — which
 * for a point in the eastern half of a cell is the cell next door.
 *
 * Longitude is normalised first. This viewer hands out −180..180 and the Mars
 * side of the same codebase works in 0..360; a 350° that was never wrapped
 * indexes off the end of the grid and clamps to the last column, which draws
 * the Bering Strait's answer for a click on Ireland.
 */
export function cellAt(lat, lon, info) {
  if (!info || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const b = info.bounds;
  const [gw, gh] = info.grid;
  const degrees = (b.east - b.west) / gw;
  const wrapped = ((((lon - b.west) % 360) + 360) % 360) + b.west;
  if (lat > b.north || lat < b.south) {
    return { outside: true, lat, lon: wrapped, degrees };
  }
  const x = Math.min(gw - 1, Math.max(0, Math.floor((wrapped - b.west) / degrees)));
  const y = Math.min(gh - 1, Math.max(0, Math.floor((b.north - lat) / degrees)));
  return {
    outside: false,
    lat,
    lon: wrapped,
    degrees,
    x,
    y,
    west: b.west + x * degrees,
    north: b.north - y * degrees,
  };
}

/** How big that cell is on the ground here — a 30" cell is not square. */
export function cellSizeKm(lat, degrees) {
  const height = degrees * KM_PER_DEGREE;
  return { height, width: height * Math.cos((lat * Math.PI) / 180) };
}

function metres(value) {
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? `${value} m` : `${value.toFixed(1)} m`;
}

function coordinate(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
}

/**
 * The card's own lines, in the shape `ice-card.js` and `soil-card.js` return.
 *
 * THE TITLE IS THE NUMBER, because the number is the whole answer — the
 * kicker already says what quantity it is. Two readings are not numbers and
 * say so instead of showing one:
 *
 *   * NODATA inside the grid, which over the sea and over the ice sheets means
 *     the model does not apply — not that there is nothing there. Zero would
 *     be a claim: `bake` keeps the file's own 255 precisely so the two stay
 *     apart, and a card that printed "0 m" for the Atlantic would throw that
 *     distinction away at the last step.
 *   * OUTSIDE THE GRID, which here is one place: south of 60°S, where
 *     Pelletier's model stops.
 *
 * A ZERO IS A REAL READING and keeps its number. Over the Southern Alps 16%
 * of the modelled cells are exactly 0 — bare rock, and the ground a landslide
 * study is most interested in — so it gets the line under it that says what
 * the model means by it, not a different title.
 */
export function thicknessCard(sample = {}, info = {}) {
  const kicker = "Soil and sediment thickness";
  const known = !sample.outside && Number.isFinite(sample.metres);
  const size = Number.isFinite(sample.degrees)
    ? cellSizeKm(sample.lat, sample.degrees) : null;

  const title = sample.outside ? "Outside the model"
    : known ? metres(sample.metres) : "Not modelled here";

  const meta = sample.outside
    ? "The model stops at 60°S"
    : known
      ? (sample.metres === 0
        ? "Bedrock at the surface in this model"
        : "Above bedrock: soil, regolith and sedimentary deposits")
      : "No value in this cell — sea, or ground the model excludes";

  const headline = [];
  if (Number.isFinite(sample.lat) && Number.isFinite(sample.lon)) {
    headline.push(["Sampled at", coordinate(sample.lat, sample.lon)]);
  }
  if (size) {
    headline.push(["Grid cell",
      `${(info.resolutionArcsec ?? 30)}″ · ${size.width.toFixed(2)} × ${size.height.toFixed(2)} km here`]);
  }

  const rows = [];
  if (known) rows.push(["Modelled thickness", metres(sample.metres)]);
  if (Array.isArray(info.range)) {
    rows.push(["Model range", `${info.range[0]} to ${info.range[1]} m`]);
  }
  /**
   * SAID ON THE CARD, not left to be discovered. The reader is looking at one
   * pinned point and a number to two significant figures; nothing about that
   * says the number is a model's value for a square kilometre. `soil-card.js`
   * carries the same line for the same reason, and the rock database refuses
   * to invent a number rather than print one that reads as a measurement.
   */
  rows.push(["Basis", "A modelled value for the whole 1 km cell, not a "
    + "measurement of this hillside"]);

  return {
    kicker,
    title,
    meta,
    headline: headline.length ? headline : null,
    rows,
    source: info.credit || null,
    note: info.doi ? `doi:${info.doi}` : null,
  };
}
