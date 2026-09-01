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

import { loadRockProperties, propertiesFor, parameterValue }
  from "./rock-properties.js?v=20260901-bd1cc2f";
/**
 * `rampColour` answers [r, g, b], not a string -- the raster repaint contract.
 * A VECTOR repaint wants a CSS string, and handing it the array is not an
 * error: `THREE.Color.set` swallows it and every polygon comes out white under
 * a perfectly correct legend. `hex` is the conversion, and this module is a
 * vector painter, so it converts once at the boundary.
 */
import { rampColour, hex } from "./symbology.js?v=20260901-bd1cc2f";

/** Nothing to say about this ground, and the map says nothing. */
export const NO_VALUE_COLOUR = "#3a3a44";

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
    if (row) values.push(row.typical ?? (row.min + row.max) / 2);
  }
  if (values.length < 2) return null;
  const meta = data.parameters[parameter];
  const log = meta.scale === "log" && values.every((v) => v > 0);
  const t = (v) => (log ? Math.log10(v) : v);
  const inv = (v) => (log ? 10 ** v : v);
  const lo = Math.min(...values.map(t));
  const hi = Math.max(...values.map(t));
  if (!(hi > lo)) return null;
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
  const valueOf = (feature) => {
    const lith = String(feature?.properties?.lith
      ?? feature?.properties?.LITH ?? "").trim();
    if (!lith) return null;
    if (cache.has(lith)) return cache.get(lith);
    const value = parameterValue(lith, parameter, data);
    cache.set(lith, value);
    return value;
  };

  const colourOf = (feature) => {
    const value = valueOf(feature);
    if (!Number.isFinite(value)) return NO_VALUE_COLOUR;
    return colourOfClass(classOf(value));
  };

  const labels = [];
  const palette = [];
  for (let i = 0; i < CLASS_COUNT; i += 1) {
    labels.push(`${formatValue(edges[i], meta)} – ${formatValue(edges[i + 1], meta)}`);
    palette.push(colourOfClass(i).replace("#", ""));
  }
  // The unpainted class is a LEGEND ROW, not an omission. A reader looking at
  // a map with holes in it has to be told the holes are an answer.
  labels.push("No value published");
  palette.push(NO_VALUE_COLOUR.replace("#", ""));

  return {
    parameter,
    meta,
    colourOf,
    valueOf,
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

  const painted = countPainted(layer, paint);
  return {
    ok: true,
    parameter,
    label: paint.meta.label,
    unit: paint.meta.unit,
    painted: painted.painted,
    total: painted.total,
  };
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
  for (const feature of features) {
    if (Number.isFinite(paint.valueOf(feature))) painted += 1;
  }
  return { painted, total: features.length };
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
