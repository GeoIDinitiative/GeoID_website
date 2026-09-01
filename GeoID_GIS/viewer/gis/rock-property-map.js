/**
 * THE GEOLOGICAL MAP PAINTED BY A GEOTECHNICAL PROPERTY.
 *
 * The world geology streams from tiles and refines as you fly in, and every
 * polygon it draws carries a `lith` string. `rock-properties.js` turns that
 * string into cited property ranges, so a map of "what is the rock here"
 * becomes a map of "how strong is it here", "how permeable", "what does it do
 * after it fails" -- at every zoom, over the whole planet, off the same tiles.
 *
 * This is the piece that makes the database a MAP rather than a lookup. It
 * paints through the layer's own `repaint`, so it inherits the streaming, the
 * refine, the clipping, the contacts and the export unchanged; nothing here
 * knows about tiles.
 *
 * =========================================================================
 * WHAT A MAP LIKE THIS CAN AND CANNOT SAY
 * =========================================================================
 *
 * It is a map of the PUBLISHED RANGE FOR A ROCK NAME, resampled onto the
 * geology. It is not a map of measurements: nobody has tested the ground under
 * most of these polygons, and two units painted the same colour are two units
 * whose literature ranges overlap, not two places known to behave alike.
 *
 * So the legend says what the class means, the card says what the value was
 * derived from, and the scale is the parameter's own -- a permeability map is
 * drawn in log space because the quantity spans ten orders of magnitude and a
 * linear ramp would paint every rock on Earth the same colour except gravel.
 *
 * A UNIT WITH NO ANSWER IS LEFT UNPAINTED, never given the middle of the
 * range. Ice, open water and landslide debris resolve to no lithology on
 * purpose; a soil has no uniaxial compressive strength; and a `lith` string
 * naming two classes at equal weight is refused rather than averaged. Painting
 * those a plausible colour is the one failure this map must not have, because
 * a coloured polygon reads as a measurement and a blank one reads as a gap.
 */

import { loadRockProperties, parameterState }
  from "./rock-properties.js?v=20260901-d87db3d";
/**
 * `rampColour` answers [r, g, b], not a string -- the raster repaint contract.
 * A VECTOR repaint wants a CSS string, and handing it the array is not an
 * error: `THREE.Color.set` swallows it and every polygon comes out white under
 * a perfectly correct legend. `hex` is the conversion, and this module is a
 * vector painter, so it converts once at the boundary.
 */
import { rampColour, hex } from "./symbology.js?v=20260901-d87db3d";

/**
 * THREE ANSWERS, THREE COLOURS, and the last two are not the same thing.
 *
 * `NOT_APPLICABLE` is a hatched slate: the quantity does not exist for this
 * material — a soil has no Hoek-Brown mi — and the map should say so rather
 * than leave a hole a reader reads as missing data.
 *
 * `UNKNOWN` is the honest gap that remains: a lithology string this database
 * does not recognise. After the alias table that is a handful of polygons in
 * eleven thousand, and it is worth keeping a colour for them precisely because
 * it is now rare enough to be interesting when it appears.
 */
export const NOT_APPLICABLE_COLOUR = "#4a4a58";
/**
 * The no-information prior gets a colour of its own — a flat slate — because
 * the whole point of having it is that a model gets a number there while a
 * READER can still see that nobody mapped a rock. Blending it into the numeric
 * classes would hide exactly the thing worth knowing.
 */
export const PRIOR_COLOUR = "#5a5560";
export const UNKNOWN_COLOUR = "#2a2a30";
/** Kept for callers that predate the split. */
export const NO_VALUE_COLOUR = UNKNOWN_COLOUR;

/**
 * The ramp each KIND of parameter is read with.
 *
 * Strength and stiffness run cool-to-hot because "more" is the reading, and
 * hydraulic properties run on viridis because a permeability map is read for
 * where the water goes rather than for a maximum. Residual strength gets its
 * own reversed ramp: on that map LOW is the dangerous end, and a reader who
 * has just looked at a peak-strength map must not carry the same colour sense
 * across to it.
 */
const RAMP_FOR_KIND = {
  strength: "magma",
  deformation: "magma",
  hydraulic: "viridis",
  physical: "viridis",
  rockmass: "magma",
  // `risk` runs green to red, so REVERSED puts red at the low end -- which is
  // where the danger is for both of these: a low residual angle is a slope
  // that has already lost most of its strength, and a low slake durability is
  // a mudrock that will lose the rest of it over the next few winters.
  residual: "risk-reversed",
  durability: "risk-reversed",
};

const CLASS_COUNT = 7;

/**
 * The class breaks for a parameter, over THE WHOLE DATABASE rather than over
 * what happens to be on screen.
 *
 * A view-relative stretch would recolour the same rock as you fly, so a granite
 * would be "strong" over a shale basin and "weak" beside a quartzite -- the map
 * would be about the neighbours rather than the ground. Fixed breaks mean one
 * colour means one thing everywhere, which is what lets a global view and a
 * local one be read against each other at all.
 */
export function breaksFor(parameter, data) {
  const values = [];
  for (const ref of Object.values(data.references)) {
    const row = ref.properties?.[parameter];
    /**
     * A NOT-APPLICABLE CELL CARRIES NO NUMBERS, and feeding one to the breaks
     * poisons the whole scale: `row.typical ?? (row.min + row.max) / 2` is NaN,
     * `Math.min` over it is NaN, `hi > lo` is false and the parameter silently
     * has no paint at all. Measured as `propertyPaint` returning null for every
     * parameter a soil refuses — which after the completion pass is three of
     * the sixteen.
     */
    if (!row || row.basis === "not_applicable") continue;
    const typical = row.typical ?? (row.min + row.max) / 2;
    if (Number.isFinite(typical)) values.push(typical);
  }
  if (values.length < 2) return null;
  const meta = data.parameters[parameter];
  const log = meta.scale === "log" && values.every((v) => v > 0);
  const t = (v) => (log ? Math.log10(v) : v);
  const inv = (v) => (log ? 10 ** v : v);
  const lo = Math.min(...values.map(t));
  const hi = Math.max(...values.map(t));
  /**
   * A parameter every material agrees on has one class, not none. Residual
   * cohesion is very nearly that — it is zero on almost every slip surface —
   * and returning null there would leave the one map a slope-stability reader
   * most wants to check unavailable.
   */
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return null;
  if (hi === lo) {
    return { edges: Array.from({ length: CLASS_COUNT + 1 }, () => inv(lo)),
      log, meta, single: true };
  }
  const edges = [];
  for (let i = 0; i <= CLASS_COUNT; i += 1) {
    edges.push(inv(lo + ((hi - lo) * i) / CLASS_COUNT));
  }
  return { edges, log, meta };
}

/** How a number reads in a legend: 3 significant figures, or an exponent. */
export function formatValue(value, meta) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1e5)) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = value / 10 ** exponent;
    return `${mantissa.toFixed(1)}e${exponent}`;
  }
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/**
 * A colour function and its legend, for one parameter.
 *
 * The colour function is what `layer.repaint` takes, so this is the whole
 * bridge between the database and the renderer.
 */
export function propertyPaint(parameter, data) {
  const breaks = breaksFor(parameter, data);
  if (!breaks) return null;
  const { edges, log, meta } = breaks;
  const ramp = RAMP_FOR_KIND[meta.kind] || "viridis";
  const reversed = ramp.endsWith("-reversed");
  const rampName = reversed ? ramp.replace("-reversed", "") : ramp;

  const classOf = (value) => {
    for (let i = 0; i < CLASS_COUNT; i += 1) {
      if (value <= edges[i + 1] || i === CLASS_COUNT - 1) return i;
    }
    return CLASS_COUNT - 1;
  };
  const colourOfClass = (i) => {
    const t = CLASS_COUNT === 1 ? 0.5 : i / (CLASS_COUNT - 1);
    return hex(rampColour(rampName, reversed ? 1 - t : t));
  };

  // Resolving a lithology string walks the whole vocabulary, and a world view
  // draws thousands of polygons -- but a compilation reuses its unit names, so
  // the same handful of strings recur. Cached by string, cleared with the paint.
  const cache = new Map();
  const stateOf = (feature) => {
    const lith = String(feature?.properties?.lith
      ?? feature?.properties?.LITH ?? "").trim();
    /**
     * A BLANK `lith` IS THE PRIOR'S WHOLE PURPOSE, so it must not short-circuit
     * here. It did, and the prior was never reached: 521 polygons in one live
     * view read "unknown" while the database had an answer waiting for exactly
     * that case. The empty string goes through to `parameterState`, which
     * resolves nothing and falls to the no-information prior.
     */
    if (cache.has(lith)) return cache.get(lith);
    const answer = parameterState(lith, parameter, data);
    cache.set(lith, answer);
    return answer;
  };
  const valueOf = (feature) => {
    const answer = stateOf(feature);
    return answer.state === "value" ? answer.value : null;
  };

  const colourOf = (feature) => {
    const answer = stateOf(feature);
    if (answer.state === "value") return colourOfClass(classOf(answer.value));
    if (answer.state === "prior") return PRIOR_COLOUR;
    if (answer.state === "not_applicable") return NOT_APPLICABLE_COLOUR;
    return UNKNOWN_COLOUR;
  };

  const labels = [];
  const palette = [];
  if (breaks.single) {
    labels.push(`${formatValue(edges[0], meta)} everywhere`);
    palette.push(colourOfClass(CLASS_COUNT - 1).replace("#", ""));
  } else {
    for (let i = 0; i < CLASS_COUNT; i += 1) {
      labels.push(`${formatValue(edges[i], meta)} – ${formatValue(edges[i + 1], meta)}`);
      palette.push(colourOfClass(i).replace("#", ""));
    }
  }
  /**
   * The two non-numeric answers are LEGEND ROWS, not omissions. A reader
   * looking at a map with grey in it has to be told which grey they are
   * looking at: a material the question does not apply to, or ground this
   * database could not name.
   */
  labels.push("Not applicable to this material");
  palette.push(NOT_APPLICABLE_COLOUR.replace("#", ""));
  labels.push("No lithology stated — prior");
  palette.push(PRIOR_COLOUR.replace("#", ""));
  labels.push("Lithology not recognised");
  palette.push(UNKNOWN_COLOUR.replace("#", ""));

  return {
    parameter,
    meta,
    colourOf,
    valueOf,
    stateOf,
    breaks: edges,
    log,
    legendInfo: {
      palette,
      labels,
      values: labels,
      categorical: true,
      classed: true,
      field: `${meta.label} (${meta.unit})`,
    },
  };
}

/**
 * Paint a loaded geology layer by a property, or put its own colours back.
 *
 * `parameter` of null restores the source colouring through the layer's own
 * `sourceSymbology`, which is the closure that painted it at build time -- so
 * this is a round trip rather than a re-derivation, the same rule the symbology
 * dialog's "Source colours" mode follows.
 */
export async function paintByProperty(layer, parameter) {
  if (!layer?.repaint) return { ok: false, message: "That layer cannot be repainted." };
  if (!parameter) {
    const source = layer.sourceSymbology;
    if (!source?.apply) return { ok: false, message: "This layer publishes no colours of its own." };
    source.apply();
    if (source.rows?.length) {
      layer.legendInfo = {
        palette: source.rows.map((r) => String(r.colour).replace("#", "")),
        labels: source.rows.map((r) => String(r.value)),
        values: source.rows.map((r) => String(r.value)),
        counts: source.rows.map((r) => r.count),
        categorical: true, classed: true, field: source.field || null,
      };
    }
    layer.rockProperty = null;
    layer.symbologySource = true;
    announce();
    return { ok: true, restored: true };
  }

  const data = await loadRockProperties();
  const paint = propertyPaint(parameter, data);
  if (!paint) return { ok: false, message: `No range is published for ${parameter}.` };

  layer.repaint(paint.colourOf);
  layer.legendInfo = paint.legendInfo;
  layer.legendIsSummary = null;
  layer.rockProperty = parameter;
  layer.symbologySource = false;
  // The tiled controller rebuilds tiles as the view settles, and a tile built
  // after the paint must arrive in the same colours -- the layer's own repaint
  // memory does that, and this is the flag that says which paint it is.
  layer.rockPropertyPaint = paint;
  announce();

  return { ok: true, parameter, label: paint.meta.label, unit: paint.meta.unit,
    ...countPainted(layer, paint) };
}

/**
 * How much of what is drawn actually got a value.
 *
 * Reported rather than hidden: a strength map over an alluvial basin is mostly
 * blank by construction (a soil has no UCS), and a reader must be able to tell
 * that from a map that failed to resolve its lithologies.
 */
export function countPainted(layer, paint) {
  const features = layer?.features || [];
  let painted = 0;
  let prior = 0;
  let notApplicable = 0;
  let unknown = 0;
  for (const feature of features) {
    const answer = paint.stateOf(feature);
    if (answer.state === "value") painted += 1;
    else if (answer.state === "prior") prior += 1;
    else if (answer.state === "not_applicable") notApplicable += 1;
    else unknown += 1;
  }
  return { painted, prior, notApplicable, unknown, total: features.length };
}

function announce() {
  if (typeof window === "undefined") return;
  window.GeoIDLayerHierarchy?.render?.();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed",
    { detail: { reason: "symbology" } }));
}

if (typeof window !== "undefined") {
  window.GeoIDRockPropertyMap = { paintByProperty, propertyPaint, breaksFor };
}
