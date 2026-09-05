/**
 * WHAT A MODELLED LAYER IS, WRITTEN OUT.
 *
 * A slope map is not a measurement. It is Horn's estimator run over a
 * resampled grid at whatever cell size the current view happens to give, and
 * every one of those choices moves the number: the same hillside is 21° on a
 * 30 m grid and 14° on a 90 m one, and neither is wrong. A reader who cannot
 * see the arithmetic cannot tell which they are holding, and a screening model
 * whose method is a secret is not a screening model -- it is a picture with
 * authority it has not earned.
 *
 * So every layer this app COMPUTES states its equations in full on its ⓘ card:
 * the expression, every symbol in it, and the assumptions that make it apply.
 * Layers modelled elsewhere say so instead, name the model and cite it, and
 * state whatever arithmetic our own bake did on top -- which is a different
 * claim and must not read as ours.
 *
 * ONE REGISTRY, and the test executes what it prints. `equations.test.mjs`
 * evaluates these expressions against `raster-analysis.js` on a synthetic
 * surface and fails if the card and the code disagree: a comment can drift
 * from its function silently, and this is the version that cannot.
 */

/** A layer computed in the browser, from the grid the view is looking at. */
const COMPUTED = "computed here";
/** A published model. Ours is the reading, not the modelling. */
const PUBLISHED = "modelled elsewhere";

/**
 * The gradient every surface reading here is built on: Horn's 3x3, the same
 * estimator QGIS and ArcGIS use, so a number from this app is comparable with
 * one from those.
 */
const HORN = {
  lines: [
    { expr: "∂z/∂x = [(z₃ + 2z₆ + z₉) − (z₁ + 2z₄ + z₇)] / (8·Δx)" },
    { expr: "∂z/∂y = [(z₇ + 2z₈ + z₉) − (z₁ + 2z₂ + z₃)] / (8·Δy)" },
  ],
  terms: [
    ["z₁…z₉", "the 3×3 window of heights, read left to right and top to bottom"],
    ["Δx, Δy", "the cell size on the ground, in metres (below)"],
  ],
  note: "A cell whose window touches the grid edge or any no-data cell returns "
    + "no answer rather than a one-sided estimate.",
};

/** Degrees are not metres, and the conversion is latitude's business. */
const CELL = {
  lines: [
    { expr: "Δx = |(lon_max − lon_min)| · 111320 · cos(φ) / width" },
    { expr: "Δy = |(lat_max − lat_min)| · 110574 / height" },
  ],
  terms: [
    ["φ", "the latitude of the middle of the grid"],
    ["111320 m", "one degree of longitude at the equator"],
    ["110574 m", "one degree of latitude"],
  ],
  note: "One cell size for the whole grid, taken at its middle latitude. Over "
    + "a view a few degrees across that is a fraction of a percent; over a "
    + "hemisphere it is not, and a slope read at world zoom is a slope of the "
    + "resampled picture rather than of the ground.",
};

const EQUATIONS = {
  "dem-elevation": {
    kind: COMPUTED,
    intro: "The tiles are PNGs, and the height is packed into the colour. "
      + "Nothing is modelled: this is the decode, and the sheet is the numbers "
      + "it returns.",
    lines: [
      { expr: "h = (R·256 + G + B/256) − 32768",
        note: "metres above the EGM96 geoid, from the Terrarium encoding" },
    ],
    terms: [
      ["R, G, B", "the tile pixel's three channels, 0–255"],
      ["32768", "the offset that lets the encoding carry ocean depths"],
    ],
    note: "A single-pixel spike whose neighbours disagree with it by more than "
      + "300 m in the same direction on both sides is replaced by their mean — "
      + "tile-edge artefacts, not terrain.",
  },

  "dem-slope": {
    kind: COMPUTED,
    intro: "Steepness of the streamed heights, by Horn's 3×3 estimator.",
    lines: [
      ...HORN.lines,
      { expr: "slope = arctan( √( (∂z/∂x)² + (∂z/∂y)² ) )",
        note: "in degrees; as a percentage it is 100·√(…) instead" },
      ...CELL.lines,
    ],
    terms: [
      HORN.terms[0],
      ["∂z/∂x, ∂z/∂y", "the surface's gradient in each direction, in metres "
        + "per metre — so their root sum of squares is the rise of the "
        + "steepest line through the cell"],
      ...CELL.terms,
    ],
    note: `${HORN.note} ${CELL.note}`,
  },

  "dem-hillshade": {
    kind: COMPUTED,
    intro: "Lambertian shading of the same gradient — a picture of the surface, "
      + "not a quantity. Nothing downstream should read values off it.",
    lines: [
      { expr: "zenith = (90° − altitude)" },
      { expr: "azimuth* = (360° − azimuth + 90°)",
        note: "compass bearing to the mathematical convention the shading uses" },
      { expr: "slope = arctan( √( (∂z/∂x)² + (∂z/∂y)² ) )" },
      { expr: "aspect = atan2( ∂z/∂y, −∂z/∂x )", note: "wrapped into 0…2π" },
      { expr: "shade = 255 · [ cos(zenith)·cos(slope) "
        + "+ sin(zenith)·sin(slope)·cos(azimuth* − aspect) ]",
        note: "clamped to 0…255" },
    ],
    terms: [
      ["altitude", "the sun's height above the horizon, from the panel's control (default 45°)"],
      ["azimuth", "the compass bearing it shines from (default 315°, the north-west)"],
      ["∂z/∂x, ∂z/∂y", "Horn's gradient, as for slope"],
    ],
    note: "The lighting is a convention, not a time of day: relief lit from the "
      + "north-west reads as relief, and lit from the south-east reads inside out.",
  },

  "soil-thickness": {
    kind: PUBLISHED,
    intro: "The thickness itself is Pelletier et al.'s model, not ours — a "
      + "mosaic of their upland-hillslope and lowland-valley grids, weighted by "
      + "area and by topographic wetness index, calibrated against measured "
      + "soil thickness in the US and Europe and against depth-to-bedrock from "
      + "US groundwater wells. Read the paper for its equations; ours is only "
      + "what the bake did to the numbers it publishes.",
    lines: [
      { expr: "band = round( thickness in metres )",
        note: "8-bit, so the sheet is metre-resolution by construction" },
      { expr: "−1  →  255 (no data)",
        note: "sea, and everything the model excludes, kept apart from a real 0" },
    ],
    terms: [
      ["0 m", "a modelled reading: bedrock at the surface, not an absence"],
      ["255", "no reading: the model does not apply here"],
    ],
    note: "Clipped at 60°S. Values are a model's, for a whole 1 km cell.",
  },

  /**
   * Not on a catalogue row -- GeoID mode builds it -- but the registry is the
   * place the app's maths lives, and a panel that wants to show its working
   * should read it from here rather than write it out a second time.
   */
  "geoid-fos": {
    kind: COMPUTED,
    intro: "The infinite-slope model: the standard screening equation for "
      + "shallow translational failures, which assumes the failure plane is "
      + "parallel to the ground and long compared with its depth. True of the "
      + "soil-slip case; false for deep rotational failures.",
    lines: [
      { expr: "FoS = [ c′ + (γ − m·γw)·z·cos²β·tanφ′ ] / [ γ·z·sinβ·cosβ ]" },
    ],
    terms: [
      ["c′", "effective cohesion (kPa)"],
      ["φ′", "effective friction angle (°)"],
      ["γ", "unit weight of the soil (kN/m³)"],
      ["γw", "unit weight of water, 9.81 kN/m³"],
      ["z", "depth to the failure plane (m) — the modelled soil thickness at "
        + "this cell, capped at 3 m, because an infinite-slope model describes "
        + "a shallow plane and not the base of a sediment basin; the "
        + "lithology's own default stands where the model has no reading"],
      ["β", "slope angle, from the slope reading above"],
      ["m", "the wet fraction of that depth, 0–1 — the only term the weather moves"],
      ["FoS", "reported to four decimal places, which is far finer than the "
        + "parameters justify — it is a screening number, not a design one"],
    ],
    note: "Every term is a property of the place except m, which is a property "
      + "of a place AND a moment: c′, φ′ and γ from the mapped lithology, β "
      + "from the DEM, z from the thickness model, and m from the weather. "
      + "FoS > 1 is stable and < 1 is failure, with the interesting band "
      + "1.0–1.3. Ground below 5° returns no answer rather than infinity — "
      + "sinβ → 0 makes the driving stress vanish, which is arithmetic rather "
      + "than insight — and m is capped at 1: rain past saturation does not "
      + "keep raising pore pressure in this model. The strength parameters are "
      + "standard engineering-geology ranges by lithology, not site "
      + "investigation values.",
  },
};

/**
 * The maths for a dataset id, or null where there is none to state.
 *
 * Null is the honest answer for an observed dataset — a soil map is a survey,
 * and giving it a "How it is calculated" fold with nothing in it would suggest
 * every layer is a model.
 */
export function mathsFor(id) {
  return EQUATIONS[id] || null;
}

/** Every id that has working to show — for the test, and for anything listing. */
export function modelledIds() {
  return Object.keys(EQUATIONS);
}

export { COMPUTED, PUBLISHED };
