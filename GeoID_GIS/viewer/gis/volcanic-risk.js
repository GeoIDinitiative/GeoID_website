/**
 * HOW OFTEN ASH REACHES A POINT — the volcanic risk map, from the eruption
 * record.
 *
 * The hazard BUFFERS in this subtab are schematic: five fixed rings round
 * every Holocene volcano whatever it has done. This is the other product, and
 * the twin of the cyclone risk map: every confirmed, dated eruption in the
 * Smithsonian catalogue, each given a REACH that grows with its VEI, counted
 * at every lattice point it reaches and divided by the length of record over
 * which eruptions of its size are actually recorded. `bake-volcanic-risk.py`
 * carries the windows, the radii and the measurements behind both, and the
 * layer's own ⓘ prints them.
 *
 * THE VALUE IS AT A POINT, WITHIN A REACH -- never per cell -- for the reason
 * the cyclone map records: cells of different sizes are only comparable when
 * each is a sampling location and its size is display resolution.
 *
 * THREE READINGS OF ONE FILE, all repaints of the layer already loaded. The
 * cells carry the rate for any eruption, the rate for large ones (VEI >= 4)
 * and the largest VEI on record reaching them, so "magnitude" and
 * "frequency" are two colourings of one grid rather than two files fetched
 * and triangulated for columns already in memory.
 */

import { buildSymbology, colourOf, legendInfoFrom } from "./symbology.js?v=20260909-75336d3";

/**
 * THE CLASSES ARE RETURN PERIODS, not quantiles of this file -- the cyclone
 * map's argument, at a volcano's timescales. A quantile would put a boundary
 * wherever the file's values happen to fall; "once a century" means something
 * before anybody looks at the data. Converted to the annual chance the map
 * carries, so the edges and the field are one quantity: P = 1 - exp(-1/T).
 */
export const RETURN_PERIODS_YEARS = [10000, 1000, 250, 100, 25, 5];

export function riskEdges(periods = RETURN_PERIODS_YEARS) {
  return periods.map((t) => 1 - Math.exp(-1 / t));
}

/** One MORE than the edges, as classes are. */
export const RISK_LABELS = [
  "rarer than 1 in 10,000 years",
  "about 1 in 10,000 years",
  "about 1 in 1,000 years",
  "about 1 in 250 years",
  "about 1 in 100 years",
  "about 1 in 25 years",
  "more often than 1 in 5 years",
];

/**
 * WHAT AN UNREACHED CELL IS PAINTED. A cell that returns no colour is drawn in
 * the app's no-value grey, which everywhere else means NOT MEASURED and here
 * means measured, and never: every cell in the file was reached by some
 * eruption, or the bake would not have drawn it, so on the large-eruption view
 * a grey cell is ground a small eruption's ash reaches and no large one's has.
 * The key names it, or half the map is a colour the key does not mention.
 */
const NONE_COLOUR = "8a8a8a";

/**
 * The VEI palette: one colour per index, fixed across every map that draws
 * it. A magnitude is an ORDINAL class, not a measurement to cut -- VEI 5 is
 * ten times VEI 4 by volume and the scale is logarithmic -- so it is painted
 * as a category with a sequential ramp that reads in order.
 */
export const VEI_COLOURS = {
  0: "c7d6b4", 1: "a6c48a", 2: "e4d64f", 3: "f5a742", 4: "ee6d2b",
  5: "d63b1f", 6: "9e1a2b", 7: "5c0b3c", 8: "23041f",
};

/**
 * MAGNITUDE x FREQUENCY, as tephra per year reaching the point: each eruption's
 * VEI mapped to a tephra volume (a decade per VEI step, Newhall & Self) and
 * summed at its rate. Cut on orders of magnitude, because that is the scale
 * the quantity lives on.
 */
export const TEPHRA_EDGES = [1e4, 1e5, 1e6, 1e7, 1e8];
export const TEPHRA_LABELS = [
  "under 10,000 m³ a year",
  "10,000 – 100,000 m³ a year",
  "100,000 – 1 million m³ a year",
  "1 – 10 million m³ a year",
  "10 – 100 million m³ a year",
  "over 100 million m³ a year",
];

export const VIEWS = {
  tephra: {
    field: "tephra_m3_yr",
    label: "Magnitude × frequency — tephra reaching here, m³ a year",
    noneLabel: "no eruption's tephra on record",
    edges: TEPHRA_EDGES,
    labels: TEPHRA_LABELS,
  },
  ashfall: {
    field: "p_yr",
    rate: "rate_yr",
    label: "Chance of ashfall from any eruption, per year",
    noneLabel: "no eruption's ash on record",
  },
  large: {
    field: "p_large_yr",
    rate: "rate_large_yr",
    label: "Chance of ashfall from a LARGE eruption (VEI 4+), per year",
    noneLabel: "no large eruption's ash on record",
  },
  magnitude: {
    field: "vei_max",
    label: "Largest eruption on record reaching here (VEI)",
    categorical: true,
  },
};

/**
 * The frequency paints: annual chance on the return-period edges, classed on
 * the values actually drawn (the zeros are a row of their own, or they are
 * counted twice -- the cyclone map's own key summed to 120,294 over 91,156
 * cells before it learnt this).
 */
export function frequencyPaint(features, { view = "ashfall" } = {}) {
  const spec = VIEWS[view];
  if (!spec || spec.categorical) return null;
  const field = spec.field;
  const values = features
    .map((f) => Number(f?.properties?.[field]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sym = buildSymbology(values, { edges: spec.edges || riskEdges(), ramp: "risk" });
  if (!sym.ok) return null;
  const labels = spec.labels || RISK_LABELS;
  sym.rows.forEach((row, i) => { if (labels[i]) row.label = labels[i]; });
  const colourFor = (feature) => {
    const n = Number(feature?.properties?.[field]);
    return Number.isFinite(n) && n > 0 ? colourOf(n, sym) : null;
  };
  const legend = legendInfoFrom(sym, { label: spec.label });
  const none = features.filter((f) => !(Number(f?.properties?.[field]) > 0)).length;
  if (none) {
    legend.palette = [NONE_COLOUR, ...legend.palette];
    legend.labels = [spec.noneLabel, ...legend.labels];
    legend.bounds = [["0", "0"], ...legend.bounds];
    legend.counts = [none, ...legend.counts];
  }
  return { colourFor, legend: { ...legend, field, categorical: false } };
}

/**
 * The magnitude paint: one class per VEI present, in VEI order, never by
 * frequency -- `categoricalSymbology` ranks classes by how common they are and
 * folds the rest into "(other)", and an ordinal scale ranked by count is a
 * scale that has lost its order.
 */
export function magnitudePaint(features) {
  const counts = new Map();
  features.forEach((f) => {
    const v = Number(f?.properties?.vei_max);
    if (Number.isFinite(v)) counts.set(v, (counts.get(v) || 0) + 1);
  });
  const veis = [...counts.keys()].sort((a, b) => a - b);
  if (!veis.length) return null;
  const colourFor = (feature) => {
    const v = Number(feature?.properties?.vei_max);
    return Number.isFinite(v) && VEI_COLOURS[v] ? `#${VEI_COLOURS[v]}` : null;
  };
  return {
    colourFor,
    legend: {
      classed: true,
      categorical: true,
      field: "vei_max",
      label: VIEWS.magnitude.label,
      palette: veis.map((v) => VEI_COLOURS[v] || NONE_COLOUR),
      labels: veis.map((v) => `VEI ${v}`),
      bounds: veis.map((v) => [String(v), String(v)]),
      counts: veis.map((v) => counts.get(v)),
      min: veis[0],
      max: veis[veis.length - 1],
    },
  };
}

export function paintFor(features, view) {
  return view === "magnitude" ? magnitudePaint(features) : frequencyPaint(features, { view });
}

/* ── driving the layer on the globe ─────────────────────────────────────── */

/**
 * TWO LAYERS, ONE MODULE. The windowed map and the full-record map are two
 * files from one bake, and each is found by its dataset's own name so that a
 * view set on one cannot repaint the other.
 */
export const LAYER_NAMES = {
  "volcanic-risk": /volcanic risk \(Smithsonian GVP eruption record\)/i,
  "volcanic-risk-holocene": /volcanic risk \(full Holocene record/i,
};

export function riskLayer(layers, id = "volcanic-risk") {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  const pattern = LAYER_NAMES[id] || LAYER_NAMES["volcanic-risk"];
  return held.find((l) => l.name && pattern.test(l.name)) || null;
}

function announce() {
  window.GeoIDLayerHierarchy?.render?.();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", {
    detail: { reason: "symbology" },
  }));
}

/** Repaint the layer as one of its three readings, and re-key it. */
export function setView(view = "ashfall", { layers = null, id = "volcanic-risk" } = {}) {
  const layer = riskLayer(layers, id);
  if (!layer?.features?.length) return null;
  const wanted = VIEWS[view] ? view : "ashfall";
  const paint = paintFor(layer.features, wanted);
  if (!paint) return null;
  layer.repaint?.(paint.colourFor);
  layer.legendInfo = paint.legend;
  layer.legendSummary = null;
  layer.volcanicView = wanted;
  // The dialog must not reopen proposing to undo this.
  layer.rangeSpec = null;
  layer.symbologySingle = null;
  announce();
  const drawn = layer.features.filter((f) => paint.colourFor(f)).length;
  return { view: wanted, cells: layer.features.length, drawn };
}

/** Which reading the layer is showing, for a control that has to say so. */
export function currentView(layers = null, id = "volcanic-risk") {
  return riskLayer(layers, id)?.volcanicView || (id === "volcanic-risk-holocene" ? "tephra" : "ashfall");
}

/** Which of the two grids a feature came from, for the card. */
export function viewOf(props = {}) {
  const held = window.GeoIDImportManager?.getLayers?.() || [];
  const id = Object.keys(LAYER_NAMES).find((k) => {
    const l = riskLayer(held, k);
    return l?.features?.some?.((f) => f?.properties === props);
  }) || "volcanic-risk";
  return { id, view: currentView(held, id) };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRisk = {
    VIEWS, VEI_COLOURS, RETURN_PERIODS_YEARS, RISK_LABELS, riskEdges,
    frequencyPaint, magnitudePaint, paintFor, riskLayer, setView, currentView, viewOf,
    LAYER_NAMES, TEPHRA_EDGES, TEPHRA_LABELS,
  };
}
