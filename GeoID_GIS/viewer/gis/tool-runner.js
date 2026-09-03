import * as GP from "./geoprocessing.js?v=20260903-2983b5d";
import * as RA from "./raster-analysis.js?v=20260903-2983b5d";
import { buildVectorLayerResult } from "./vector-render.js?v=20260903-2983b5d";
// eslint-disable-next-line no-unused-vars
import { pointInPolygon } from "./geometry.js?v=20260903-2983b5d";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260903-2983b5d";
// Pure and DOM-free, so a static import keeps this module Node-clean AND keeps
// the terrain engine SYNCHRONOUS -- runTool calls engines.native WITHOUT
// awaiting it, so an async engine hands register() a Promise and the raster
// comes out undefined. Measured as: "Cannot read properties of undefined".
import { buildSurface, nativeStepM } from "./model-build.js?v=20260903-2983b5d";
import { nativeGridOf } from "./extraction.js?v=20260903-2983b5d";
import { CRS_OPTIONS } from "./projection.js?v=20260903-2983b5d";
import * as IN from "./interpolation.js?v=20260903-2983b5d";
import * as VAL from "./validation.js?v=20260903-2983b5d";
import * as EX from "./analysis-extra.js?v=20260903-2983b5d";
import * as HY from "./hydrology.js?v=20260903-2983b5d";
import * as KR from "./kriging.js?v=20260903-2983b5d";

// The descriptor registry and run pipeline (tool-ux-spec.md section 1). One
// table holds every tool the toolbox knows; one pipeline runs any of them. The
// search palette, the shared dialog, chaining and prefs all READ this table,
// so adding a tool is a row here, never a new UI. The legacy tiles in
// toolbox-ops.js stay untouched: these descriptors call the same GP/RA
// functions directly, and both paths publish through the same
// buildVectorLayerResult / buildRasterLayer + addDerivedLayer seam, so a
// descriptor-run layer and a tile-run layer are indistinguishable downstream.
//
// An engine returns its PRODUCT, not a layer: a FeatureCollection (vector), a
// { band, width, height, bounds, noData } raster, or { rows } for a table --
// optionally wrapped as { collection|raster|rows, note } when it has a caveat
// to attach, or { ok: false, message } for a domain failure the tool itself
// detected. runTool owns registration and history, so every caller (dialog,
// palette, legacy tiles once they migrate) gets both for free.
//
// Param kinds: "number" (default/step, optional min/max range),
// "select" (options: [{ id, name }]), "field" (a field of the first input
// layer), "text", "checkbox". Inputs may carry `optional: true` -- only the
// raster calculator's second raster uses it, mirroring the legacy run path
// which tolerated a missing `b` for single-raster expressions.

const CRS_CHOICES = CRS_OPTIONS.filter((c) => c.id !== "none")
  .map((c) => ({ id: c.id, name: c.label }));

/**
 * One raster cell at a coordinate. `raster-analysis` samples whole point
 * collections but exports nothing for a single lat/lon, and the validation
 * tools need exactly that — once per observation, thousands of times.
 * Nearest-cell rather than interpolated: a classified surface has no meaningful
 * value between its classes, and validation runs on classified surfaces.
 */
function sampleRaster(raster, lat, lon) {
  if (!raster?.band) return NaN;
  const { bounds, width, height } = raster;
  if (lat < bounds.minY || lat > bounds.maxY || lon < bounds.minX || lon > bounds.maxX) return NaN;
  const x = Math.min(width - 1, Math.max(0, Math.floor(
    ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(
    ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * height)));
  const v = raster.band[y * width + x];
  if (!Number.isFinite(v)) return NaN;
  if (raster.noData != null && Number.isFinite(raster.noData) && v === raster.noData) return NaN;
  return v;
}

/**
 * WHICH RESOLUTION TO SHIP, for an input that streams its own features.
 *
 * The world geology is not one map, it is a pyramid of them: each level is
 * generalised on its own, and that generalisation is what opens the gaps at
 * contacts — 280 dark holes measured at zoom 4, none at zoom 9, because at
 * native scale neighbouring polygons still share their boundaries. So the
 * level a clip runs at IS the answer's resolution, and it was chosen silently
 * by a drawing budget that had nothing to do with the question.
 *
 * The choice is named by what it spends rather than by a zoom, because the
 * levels a source can serve depend on the size of the box: measured over
 * Northern Ireland, zoom 11 costs 30 tiles for a 0.6 degree study area and 238
 * for a 2.8 degree one. A fixed zoom would mean something different for each.
 * The runner reports the level it actually reached either way, and names the
 * next one and its cost when a budget is what stopped it.
 *
 * "Balanced" is the default because it reaches the compilation's own detail
 * peak (zoom 11) for an ordinary study area, which is the case this is for.
 */
const DETAIL_PARAM = {
  name: "detail",
  label: "Detail to ship",
  kind: "select",
  default: "balanced",
  blurb: "How deep to stream a tiled input before clipping. Deeper is finer at "
    + "contacts and costs more tile requests; the result says which level it used.",
  options: [
    { id: "fast", label: "Fast — fewest tiles, coarsest polygons" },
    { id: "balanced", label: "Balanced — full detail for a study area" },
    { id: "full", label: "Full — full detail for a large region" },
    { id: "maximum", label: "Maximum — the source's own ceiling" },
  ],
};

export const TOOLS = [
  // ── Vector geoprocessing (the legacy VECTOR_OPS table, one row each) ──────
  {
    id: "buffer",
    label: "Buffer",
    category: "Vector geoprocessing",
    blurb: "Grow each feature outward by a distance in kilometres; overlaps dissolve.",
    keywords: ["distance", "offset", "grow", "ring", "zone"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [
      // Kilometres, because that is the scale a globe is worked at: a metre
      // field defaulting to 1000 made every distance a count-the-zeroes check.
      { name: "distance", label: "Distance (km)", kind: "number", default: 10, step: 1, min: 0.000001 },
      // What each geometry honestly allows: circles or squares for points,
      // end caps for lines. A polygon outline is offset along its own
      // boundary whichever is chosen -- the outline IS the shape.
      { name: "shape", label: "Shape", kind: "select", default: "round", options: [
        { id: "round", name: "Round (circles, round line ends)" },
        { id: "square", name: "Square (squares, extended line ends)" },
        { id: "flat", name: "Flat line ends" },
      ] },
      { name: "dissolve", label: "Merge overlapping buffers", kind: "checkbox", default: true },
    ],
    outputType: "vector",
    outputName: "buffer_{input}",
    engines: {
      native: (i, p) => GP.buffer(i.input.collection, p.distance * 1000,
        { dissolve: p.dissolve !== false, shape: p.shape || "round" }),
    },
  },
  {
    id: "multiBuffer",
    label: "Multi-ring buffer",
    category: "Vector geoprocessing",
    blurb: "Nested distance bands around the features — 10 km, 20 km, 30 km — "
      + "as true rings that tile the ground and colour-code by distance.",
    keywords: ["nested", "concentric", "rings", "zones", "distance", "bands", "multiple"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [
      { name: "distances", label: "Distances (km, comma-separated)", kind: "text",
        default: "10, 20, 30" },
      { name: "shape", label: "Shape", kind: "select", default: "round", options: [
        { id: "round", name: "Round" },
        { id: "square", name: "Square" },
      ] },
      // Rings by default: solid nested disks STACK, and three translucent
      // fills over one centre render the drawing order, not the distance.
      { name: "rings", label: "Bands as rings (recommended)", kind: "checkbox", default: true },
    ],
    outputType: "vector",
    outputName: "rings_{input}",
    // Graded on arrival: every band carries buffer_m, and one class per band
    // is the whole reason the bands exist.
    // Graded on buffer_km, not buffer_m: the legend these classes become is
    // read by a person, and "10–20" is a distance where "10000–20000" is an
    // axis label. Discrete: one class per band, whatever the spacing.
    paint: { field: "buffer_km", minField: "buffer_min_km", unit: "km",
      ramp: "viridis", discrete: true },
    engines: {
      native: (i, p) => {
        const distances = String(p.distances || "")
          .split(/[\s,;]+/).map(Number).filter((d) => Number.isFinite(d) && d > 0);
        if (!distances.length) {
          return { ok: false, message: "Give at least one distance in km, e.g. 10, 20, 30." };
        }
        return GP.multiRingBuffer(i.input.collection, distances.map((d) => d * 1000),
          { shape: p.shape || "round", rings: p.rings !== false });
      },
    },
  },
  {
    id: "clip",
    label: "Clip by layer",
    category: "Vector geoprocessing",
    blurb: "Keep only the parts of the input that fall inside the overlay's polygons.",
    keywords: ["mask", "cut", "extract", "cookie", "overlay"],
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      { name: "overlay", label: "Overlay", type: "vector" },
    ],
    params: [DETAIL_PARAM],
    outputType: "vector",
    outputName: "clip_{input}",
    engines: { native: (i) => GP.clip(i.input.collection, i.overlay.collection) },
  },
  {
    id: "difference",
    label: "Difference",
    category: "Vector geoprocessing",
    blurb: "Remove the overlay's area from the input; what survives lies outside it.",
    keywords: ["erase", "subtract", "minus", "remove", "overlay"],
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      { name: "overlay", label: "Overlay", type: "vector" },
    ],
    params: [],
    outputType: "vector",
    outputName: "diff_{input}",
    engines: { native: (i) => GP.difference(i.input.collection, i.overlay.collection) },
  },
  {
    id: "intersect",
    label: "Intersect",
    category: "Vector geoprocessing",
    blurb: "Keep the area common to both layers.",
    keywords: ["overlap", "common", "shared", "and"],
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      { name: "overlay", label: "Overlay", type: "vector" },
    ],
    params: [],
    outputType: "vector",
    outputName: "intersect_{input}",
    engines: { native: (i) => GP.intersect(i.input.collection, i.overlay.collection) },
  },
  {
    id: "dissolve",
    label: "Dissolve / merge",
    category: "Vector geoprocessing",
    blurb: "Merge everything into one shape, or one shape per value of a field; "
      + "shared boundaries and overlaps are removed.",
    keywords: ["merge", "aggregate", "group", "combine", "union", "one"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    // Optional: blank means the WHOLE LAYER becomes one feature, which is the
    // commonest reason anyone opens this. The dialog could not ask for it
    // while the field was required — merge-into-one simply had no door.
    params: [{ name: "field", label: "Group by (blank = merge all)", kind: "field", optional: true }],
    outputType: "vector",
    outputName: "dissolve_{input}",
    engines: { native: (i, p) => GP.dissolve(i.input.collection, p.field || undefined) },
  },
  {
    id: "hull",
    label: "Convex hull",
    category: "Vector geoprocessing",
    blurb: "The smallest convex polygon that encloses all features.",
    keywords: ["convex", "envelope", "outline", "extent"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [],
    outputType: "vector",
    outputName: "hull_{input}",
    engines: { native: (i) => GP.convexHull(i.input.collection) },
  },
  {
    id: "centroids",
    label: "Centroids",
    category: "Vector geoprocessing",
    blurb: "One point at the geometric centre of each feature.",
    keywords: ["centre", "center", "point", "middle"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [],
    outputType: "vector",
    outputName: "centroids_{input}",
    engines: { native: (i) => GP.centroids(i.input.collection) },
  },
  {
    id: "simplify",
    label: "Simplify",
    category: "Vector geoprocessing",
    blurb: "Drop vertices within a tolerance in metres while keeping the overall shape.",
    keywords: ["generalise", "generalize", "tolerance", "smooth", "reduce"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [
      { name: "tolerance", label: "Tolerance (m)", kind: "number", default: 100, step: 10, min: 0 },
    ],
    outputType: "vector",
    outputName: "simplify_{input}",
    engines: { native: (i, p) => GP.simplifyCollection(i.input.collection, p.tolerance) },
  },
  {
    id: "union",
    label: "Union (merge layers)",
    category: "Vector geoprocessing",
    blurb: "Merge two polygon layers into one; overlapping shapes fuse together.",
    keywords: ["merge", "combine", "fuse", "join"],
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      { name: "overlay", label: "Overlay", type: "vector" },
    ],
    params: [],
    outputType: "vector",
    outputName: "union_{input}",
    engines: {
      native: (i) => {
        const merged = GP.union(i.input.collection, i.overlay.collection);
        // A donut input cannot keep its hole through a ring-level merge;
        // saying so beats a quietly solid result (toolbox-ops.js kept this
        // exact caveat and so does the descriptor).
        return {
          collection: merged,
          note: merged.holesDropped ? "Interior rings were filled by the merge." : "",
        };
      },
    },
  },
  {
    id: "reproject",
    label: "Reproject (CRS)",
    category: "Vector geoprocessing",
    blurb: "Transform feature coordinates from one coordinate reference system to another.",
    keywords: ["crs", "projection", "utm", "transform", "coordinates"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [
      { name: "fromCrs", label: "From CRS", kind: "select", options: CRS_CHOICES, default: "epsg:32633" },
      { name: "toCrs", label: "To CRS", kind: "select", options: CRS_CHOICES, default: "epsg:4326" },
    ],
    outputType: "vector",
    outputName: "reproject_{input}",
    engines: {
      native: (i, p) => {
        if (p.fromCrs === p.toCrs) {
          return { ok: false, message: "Source and target CRS are the same." };
        }
        return GP.reproject(i.input.collection, p.fromCrs, p.toCrs);
      },
    },
  },
  {
    id: "spatialJoin",
    label: "Spatial join",
    category: "Vector geoprocessing",
    blurb: "Copy attributes onto input features from overlay features that intersect them.",
    keywords: ["attributes", "join", "copy", "overlay"],
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      { name: "overlay", label: "Overlay", type: "vector" },
    ],
    params: [],
    outputType: "vector",
    outputName: "join_{input}",
    engines: {
      native: (i) => {
        const joined = GP.spatialJoin(i.input.collection, i.overlay.collection);
        return { collection: joined, note: `${joined.matched} matched.` };
      },
    },
  },

  // ── Surface analysis (the legacy RASTER_OPS table, one row each) ──────────
  {
    id: "slope",
    label: "Slope (degrees)",
    category: "Surface analysis",
    blurb: "Terrain steepness in degrees from a DEM, by Horn's method.",
    keywords: ["gradient", "steepness", "terrain", "dem"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "slope_{input}",
    engines: {
      native: (i) => RA.slope(i.input.raster),
      // gdaldem computes Horn's method over the whole file without holding it
      // in a JS array — the same estimator, no cell budget.
      sidecar: {
        requires: ["gdaldem"],
        build: ({ inputs, outputName }) => ({
          program: "gdaldem",
          args: ["slope", "$IN0", "$OUT", "-compute_edges"],
          inputs: [inputs.input],
          output: `data/processed/${outputName}.tif`,
        }),
      },
    },
  },
  {
    id: "aspect",
    label: "Aspect",
    category: "Surface analysis",
    blurb: "The compass direction each cell faces, in degrees clockwise from north.",
    keywords: ["direction", "orientation", "facing", "exposure"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "aspect_{input}",
    engines: {
      native: (i) => RA.aspect(i.input.raster),
      sidecar: {
        requires: ["gdaldem"],
        build: ({ inputs, outputName }) => ({
          program: "gdaldem",
          args: ["aspect", "$IN0", "$OUT", "-compute_edges"],
          inputs: [inputs.input],
          output: `data/processed/${outputName}.tif`,
        }),
      },
    },
  },
  {
    id: "hillshade",
    label: "Hillshade",
    category: "Surface analysis",
    blurb: "Shaded relief lit from the north-west, for reading landforms.",
    keywords: ["shade", "relief", "shadow", "terrain", "light"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "hillshade_{input}",
    engines: {
      native: (i) => RA.hillshade(i.input.raster),
      sidecar: {
        requires: ["gdaldem"],
        build: ({ inputs, outputName }) => ({
          program: "gdaldem",
          args: ["hillshade", "$IN0", "$OUT", "-compute_edges"],
          inputs: [inputs.input],
          output: `data/processed/${outputName}.tif`,
        }),
      },
    },
  },
  {
    id: "curvature",
    label: "Curvature",
    category: "Surface analysis",
    blurb: "Convexity of the surface — positive on ridges and noses, negative in hollows where water and debris converge.",
    keywords: ["convex", "concave", "profile", "plan", "ridge", "hollow"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "curv_{input}",
    engines: { native: (i) => RA.curvature(i.input.raster) },
  },
  {
    id: "roughness",
    label: "Roughness",
    category: "Surface analysis",
    blurb: "Largest height difference between a cell and its neighbours — smooth till against broken scarp.",
    keywords: ["terrain", "rugged", "texture", "relief", "variability"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "rough_{input}",
    engines: {
      native: (i) => RA.roughness(i.input.raster),
      sidecar: {
        requires: ["gdaldem"],
        build: ({ inputs, outputName }) => ({
          program: "gdaldem",
          args: ["roughness", "$IN0", "$OUT", "-compute_edges"],
          inputs: [inputs.input],
          output: `data/processed/${outputName}.tif`,
        }),
      },
    },
  },
  {
    id: "focal",
    label: "Focal statistics",
    category: "Surface analysis",
    blurb: "Summarise a moving window over the raster — smooth noise, find local extremes, measure local spread.",
    keywords: ["window", "neighbourhood", "smooth", "filter", "moving", "kernel"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [
      { name: "radius", label: "Radius (cells)", kind: "number", default: 1, step: 1, min: 1 },
      { name: "stat", label: "Statistic", kind: "select", default: "mean", options: [
        { id: "mean", name: "Mean" }, { id: "min", name: "Minimum" },
        { id: "max", name: "Maximum" }, { id: "sum", name: "Sum" },
        { id: "range", name: "Range" }, { id: "std", name: "Standard deviation" },
      ] },
    ],
    outputType: "raster",
    outputName: "focal_{input}",
    engines: {
      native: (i, p) => RA.focalStatistics(i.input.raster, {
        radius: Math.max(1, Math.round(p.radius)), stat: p.stat,
      }),
    },
  },
  {
    id: "contours",
    label: "Contours",
    category: "Surface analysis",
    blurb: "Trace lines of constant value at a fixed interval — contour lines from a DEM.",
    keywords: ["isoline", "interval", "elevation", "lines", "level"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [
      { name: "interval", label: "Interval", kind: "number", default: 250, step: 50, min: 0.001 },
    ],
    outputType: "vector",
    outputName: "contours_{input}",
    engines: {
      native: (i, p) => {
        const stats = RA.rasterStatistics(i.input.raster);
        const levels = [];
        for (let v = Math.ceil(stats.min / p.interval) * p.interval; v < stats.max; v += p.interval) {
          levels.push(v);
        }
        if (!levels.length) {
          return { ok: false, message: "Interval is larger than the value range." };
        }
        return RA.contours(i.input.raster, levels);
      },
    },
  },
  {
    id: "reclassify",
    label: "Reclassify (rules)",
    category: "Surface analysis",
    blurb: "Map value ranges to classes with min..max:class rules — the risk-scoring step of every susceptibility recipe.",
    keywords: ["threshold", "classify", "rules", "classes", "score", "bands"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [
      /**
       * The default used to be the NI methodology's slope classes -- a worked
       * example that taught the syntax and silently assumed the input was a
       * slope map in degrees. Fed the obvious first raster (a DEM in metres)
       * it matched not one cell: a default that only works on one kind of
       * input is a trap wearing a tutorial's clothes. Blank now means "cut
       * this raster into quantile classes", which works on ANY raster with
       * zero typing; the rules stay for anyone who has real thresholds.
       */
      { name: "rules", label: "Rules (min..max:class — blank = quantile classes)",
        kind: "text", default: "" },
      { name: "classes", label: "Classes (when rules are blank)", kind: "number",
        default: 5, min: 2, max: 12, step: 1 },
    ],
    outputType: "raster",
    outputName: "reclass_{input}",
    engines: {
      native: (i, p) => {
        let rules;
        let how = "";
        if (!String(p.rules || "").trim()) {
          const q = quantileRules(i.input.raster, Number(p.classes) || 5);
          if (!q.ok) return q;
          rules = q.rules;
          how = ` Cut into ${q.rules.length} quantile classes over `
            + `${q.lo.toFixed(1)}–${q.hi.toFixed(1)}.`;
        } else {
          const parsed = RA.parseReclassifyRules(p.rules);
          if (!parsed.ok) return parsed;
          rules = parsed.rules;
        }
        const out = RA.reclassify(i.input.raster, rules);
        const stats = RA.rasterStatistics(out);
        if (!stats.count) {
          const inStats = RA.rasterStatistics(i.input.raster);
          return { ok: false,
            message: "No cell matched any rule — this raster spans "
              + `${inStats.min?.toFixed?.(1)} to ${inStats.max?.toFixed?.(1)}.` };
        }
        return { raster: out,
          note: `${rules.length} rules, ${stats.count} cells classified.${how}` };
      },
    },
  },
  {
    id: "calculator",
    label: "Raster calculator",
    category: "Surface analysis",
    blurb: "Evaluate a cell-by-cell expression over one or two rasters — a is the input, b the second.",
    keywords: ["expression", "algebra", "math", "ndvi", "formula"],
    inputs: [
      { name: "input", label: "Input (a)", type: "raster" },
      { name: "b", label: "Second raster (b)", type: "raster", optional: true },
    ],
    params: [
      { name: "expression", label: "Expression", kind: "text", default: "(a - b) / (a + b)" },
    ],
    outputType: "raster",
    outputName: "calc_{input}",
    engines: {
      native: (i, p) => {
        const other = i.b || null;
        let b = other?.raster || null;
        let note = "";
        // Mismatched grids are resampled rather than refused: "resample
        // first" was a correct answer that made the user do the tool's job.
        if (b && !sameGrid(b, i.input.raster)) {
          b = RA.resampleToGrid(b, i.input.raster);
          note = `${other.name} was resampled onto the first raster's grid (nearest).`;
        }
        const res = RA.rasterCalculator(i.input.raster, b, p.expression || "a");
        if (!res.ok) return res;
        return { raster: res.raster, note };
      },
    },
  },
  {
    id: "clipByPolygon",
    label: "Clip by polygon",
    category: "Surface analysis",
    blurb: "Blank raster cells outside a polygon layer; inside is kept unchanged.",
    keywords: ["mask", "crop", "extract", "cutout"],
    inputs: [
      { name: "input", label: "Input", type: "raster" },
      { name: "zones", label: "Polygons", type: "vector" },
    ],
    params: [],
    outputType: "raster",
    outputName: "clip_{input}",
    engines: { native: (i) => RA.clipRasterByPolygon(i.input.raster, i.zones.collection) },
  },
  {
    id: "resample",
    elevationOutput: true,   // a filled/resampled DEM is still a DEM
    label: "Resample to grid",
    category: "Surface analysis",
    blurb: "Put a raster onto another raster's grid (nearest neighbour), so cell-by-cell tools can pair them.",
    keywords: ["align", "grid", "nearest", "snap", "match"],
    inputs: [
      { name: "input", label: "Input", type: "raster" },
      { name: "template", label: "Template grid", type: "raster" },
    ],
    params: [],
    outputType: "raster",
    outputName: "resample_{input}",
    engines: {
      native: (i) => {
        if (i.input.id === i.template.id) {
          return { ok: false, message: "A raster is already on its own grid." };
        }
        return RA.resampleToGrid(i.input.raster, i.template.raster);
      },
    },
  },
  {
    id: "distance",
    label: "Distance to features",
    category: "Surface analysis",
    blurb: "Metres from every cell to the nearest feature — rivers, faults, roads — on the input raster's grid.",
    keywords: ["proximity", "near", "metres", "euclidean", "rivers", "drainage"],
    inputs: [
      { name: "input", label: "Grid to fill", type: "raster" },
      { name: "features", label: "Features", type: "vector" },
    ],
    params: [],
    outputType: "raster",
    outputName: "dist_{features}",
    engines: { native: (i) => RA.distanceRaster(i.features.collection, i.input.raster) },
  },
  {
    id: "rasterize",
    label: "Rasterize (vector → raster)",
    category: "Surface analysis",
    blurb: "Burn a numeric attribute into a raster grid — polygons, lines and points all stamp their cells.",
    keywords: ["burn", "vector", "convert", "attribute", "geology"],
    inputs: [
      { name: "input", label: "Grid to match", type: "raster" },
      { name: "features", label: "Vector layer", type: "vector" },
    ],
    params: [
      /**
       * Optional, and blank means PRESENCE. Rasterizing a fault trace, a road
       * network or a landslide inventory to a 1/no-data mask is the commonest
       * rasterize in a susceptibility workflow and there was no door to it:
       * the field was required, so a layer with no numeric column — which a
       * line network usually has none of — could not be rasterized at all.
       */
      { name: "field", label: "Attribute (blank = presence)", kind: "field",
        of: "features", optional: true },
    ],
    outputType: "raster",
    outputName: "rasterize_{features}",
    engines: {
      native: (i, p) => {
        const field = String(p.field || "").trim();
        const source = field ? i.features.collection : {
          type: "FeatureCollection",
          features: (i.features.collection?.features || []).map((f) => ({
            ...f, properties: { ...f.properties, __presence: 1 },
          })),
        };
        const out = RA.rasterizeByAttribute(source, field || "__presence", i.input.raster);
        const stats = RA.rasterStatistics(out);
        if (!stats.count) {
          return {
            ok: false,
            message: field
              ? `No cell took a value — is "${field}" numeric where the features overlap this raster?`
              : "No feature fell inside this raster's extent.",
          };
        }
        return { raster: out,
          note: `${stats.count} cells burned from ${field ? `"${field}"` : "feature presence"}.` };
      },
      // gdal_rasterize burns straight into a grid matched to the template's
      // size and extent, which is the whole job — no per-feature scan here.
      sidecar: {
        requires: ["gdal_rasterize"],
        build: ({ inputs, params, outputName }) => ({
          program: "gdal_rasterize",
          args: ["-a", String(params.field), "-of", "GTiff", "$IN0", "$OUT"],
          inputs: [inputs.features],
          output: `data/processed/${outputName}.tif`,
        }),
      },
    },
  },
  {
    id: "samplePoints",
    label: "Sample raster at points",
    category: "Surface analysis",
    blurb: "Read the raster value under each point into a new attribute — risk scores at schools, gauges, sites.",
    keywords: ["extract", "read", "probe", "values", "join"],
    inputs: [
      { name: "input", label: "Raster", type: "raster" },
      { name: "points", label: "Points", type: "vector" },
    ],
    params: [
      { name: "attr", label: "New attribute name", kind: "text", default: "sampled" },
    ],
    outputType: "vector",
    outputName: "sampled_{points}",
    engines: {
      native: (i, p) => {
        const attr = (p.attr || "sampled").trim().replace(/[^\w]/g, "_") || "sampled";
        const fc = RA.sampleAtPoints(i.input.raster, i.points.collection, attr);
        if (!fc.features.length) {
          return { ok: false, message: "That layer has no point features." };
        }
        return {
          collection: fc,
          note: `${fc.sampled} of ${fc.features.length} points read a value into "${attr}".`,
        };
      },
    },
  },
  {
    id: "overlay",
    label: "Weighted overlay",
    category: "Surface analysis",
    blurb: "Sum weighted factor rasters into one score — the multi-criteria core of every susceptibility map.",
    keywords: ["weights", "susceptibility", "risk", "combine", "multicriteria", "score"],
    inputs: [
      { name: "input", label: "Factor A", type: "raster" },
      { name: "b", label: "Factor B", type: "raster", optional: true },
    ],
    params: [
      { name: "weights", label: "Weights (A, B — or name:weight, …)", kind: "text", default: "50, 50" },
    ],
    outputType: "raster",
    outputName: "overlay_{input}",
    engines: {
      native: (i, p) => {
        const text = (p.weights || "").trim();
        let entries;
        if (text.includes(":")) {
          // name:weight pairs reach past the two dropdowns to every loaded
          // raster — the NI susceptibility recipe is five factors, not two.
          const pool = layersByType("raster");
          entries = [];
          for (const piece of text.split(",")) {
            const at = piece.lastIndexOf(":");
            const layerName = piece.slice(0, at).trim();
            const weight = Number(piece.slice(at + 1));
            const layer = pool.find((l) => l.name === layerName
              || l.name.replace(/\.[^.]+$/, "") === layerName);
            if (!layer) return { ok: false, message: `No raster layer called "${layerName}".` };
            if (!Number.isFinite(weight) || weight < 0) {
              return { ok: false, message: `"${layerName}" needs a non-negative weight.` };
            }
            entries.push({ raster: layer.raster, weight });
          }
        } else {
          if (!i.b) {
            return { ok: false, message: "Pick Factor B, or list name:weight pairs." };
          }
          const weights = text.split(",").map((w) => Number(w.trim()));
          if (weights.length !== 2 || weights.some((w) => !Number.isFinite(w))) {
            return { ok: false, message: 'Give two weights, e.g. "60, 40".' };
          }
          entries = [
            { raster: i.input.raster, weight: weights[0] },
            { raster: i.b.raster, weight: weights[1] },
          ];
        }
        const res = RA.weightedOverlay(entries);
        if (!res.ok) return res;
        return {
          raster: res.raster,
          note: `${entries.length} factors, weights normalised.`
            + (res.resampled ? ` ${res.resampled} resampled onto the first grid.` : ""),
        };
      },
    },
  },
  {
    id: "toPoints",
    label: "Raster to points",
    category: "Surface analysis",
    blurb: "Sample the raster into a point layer, one point every N cells, values as attributes.",
    keywords: ["sample", "points", "convert", "extract"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [
      { name: "step", label: "Sample every N cells", kind: "number", default: 8, step: 1, min: 1 },
    ],
    outputType: "vector",
    outputName: "points_{input}",
    engines: {
      native: (i, p) => RA.rasterToPoints(i.input.raster, { step: Math.max(1, Math.round(p.step)) }),
    },
  },

  // ── Zonal statistics — its own toolbox tile, so its own category. Joins the
  //    registry per spec 1.1; outputType "table" returns rows, registers no
  //    layer. ─────────────────────────────────────────────────────────────────
  // ── Hydrology and visibility (sidecar only: the browser cannot do these) ──
  // Each names its own tool script and reads the DEM from inputs[0], per the
  // /jobs/tool contract. No native engine, so the dialog reports honestly
  // when the sidecar is absent rather than offering a button that cannot work.
  {
    id: "fillSinks",
    elevationOutput: true,   // a filled/resampled DEM is still a DEM
    label: "Fill sinks",
    category: "Hydrology",
    blurb: "Raise closed depressions until water can leave — the step every flow calculation needs first.",
    keywords: ["pit", "depression", "hydrology", "priority flood", "drain", "sink"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "filled_{input}",
    engines: {
      native: (i) => HY.fillSinks(i.input.raster),
      sidecar: {
        requires: ["numpy"],
        build: ({ inputs, outputName }) => ({
          tool: "hydrology",
          params: { operation: "fill" },
          inputs: [inputs.input],
          output: `data/processed/${outputName}.asc`,
        }),
      },
    },
  },
  {
    id: "flowAccumulation",
    label: "Flow accumulation",
    category: "Hydrology",
    blurb: "How many cells drain through each cell — the river network falls out of it, and it is the top factor in flood susceptibility.",
    keywords: ["drainage", "d8", "upstream", "catchment", "river", "flow", "hydrology"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "flowacc_{input}",
    engines: {
      native: (i) => HY.flowAccumulation(i.input.raster),
      sidecar: {
        requires: ["numpy"],
        build: ({ inputs, outputName }) => ({
          tool: "hydrology",
          // "all" fills, computes D8 and writes accumulation in one pass —
          // three jobs' worth of round trip saved, and the fill is mandatory
          // anyway.
          params: { operation: "all" },
          inputs: [inputs.input],
          output: `data/processed/${outputName}.asc`,
        }),
      },
    },
  },
  {
    id: "watershed",
    label: "Watersheds",
    category: "Hydrology",
    blurb: "The catchment draining to an outlet point — blank outlet = the main river's exit.",
    keywords: ["catchment", "basin", "divide", "drainage", "hydrology", "outlet"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [
      { name: "lat", label: "Outlet latitude (blank = auto)", kind: "number", default: 0, step: 0.001 },
      { name: "lon", label: "Outlet longitude (blank = auto)", kind: "number", default: 0, step: 0.001 },
    ],
    outputType: "raster",
    outputName: "basins_{input}",
    engines: {
      native: (i, p) => {
        /**
         * The engine read p.lat and p.lon, and the tool DECLARED NO PARAMS --
         * so every run since it shipped walked in with (NaN, NaN). The bounds
         * check passes vacuously (NaN compares false), `out[NaN] = 1` seeds
         * nothing, and an EMPTY raster returned as success: the quietest kind
         * of broken, only caught by checking outputs rather than ok flags.
         *
         * The untouched default now means "the main river's exit": the DEM is
         * filled once, flow accumulation found, and the outlet is the
         * highest-accumulation cell -- which is where the biggest catchment
         * in the view actually drains. A typed outlet is honoured, and one
         * off the DEM gets the honest error.
         */
        const filled = HY.fillSinks(i.input.raster);
        let lat = Number(p.lat);
        let lon = Number(p.lon);
        const b = i.input.raster.bounds;
        /**
         * (0, 0) is the UNTOUCHED FORM, and that has to be true even for a DEM
         * that happens to contain the origin -- otherwise a study area over
         * the Gulf of Guinea is the one place where the default silently means
         * "the corner" instead of "auto", which is the least predictable
         * behaviour available. Anyone who genuinely wants the origin can ask
         * for 0.0001; the auto outlet is the better answer there anyway.
         */
        const untouched = (lat === 0 && lon === 0) || !Number.isFinite(lat) || !Number.isFinite(lon);
        let placed = "";
        if (untouched) {
          const acc = HY.flowAccumulation(filled);
          const accR = acc.raster || acc;
          let best = -Infinity; let at = 0;
          for (let k = 0; k < accR.band.length; k += 1) {
            if (Number.isFinite(accR.band[k]) && accR.band[k] > best) { best = accR.band[k]; at = k; }
          }
          const y = Math.floor(at / accR.width);
          const x = at % accR.width;
          lat = b.maxY - ((y + 0.5) / accR.height) * (b.maxY - b.minY);
          lon = b.minX + ((x + 0.5) / accR.width) * (b.maxX - b.minX);
          placed = ` Outlet defaulted to the highest-accumulation cell (${lat.toFixed(3)}, ${lon.toFixed(3)}).`;
        }
        const out = HY.watershed(i.input.raster, lat, lon, { filled });
        if (!out.ok) return { ok: false, message: out.message };
        out.raster.note = `Catchment ${out.areaKm2} km² (${out.cells} cells).${placed}`;
        return out.raster;
      },
      sidecar: {
        requires: ["numpy"],
        build: ({ inputs, outputName }) => ({
          tool: "hydrology",
          params: { operation: "watershed" },
          inputs: [inputs.input],
          output: `data/processed/${outputName}.asc`,
        }),
      },
    },
  },
  {
    id: "streams",
    label: "Stream network",
    category: "Hydrology",
    blurb: "Cells with more than a threshold of upstream area — a drainage network derived from the terrain itself.",
    keywords: ["river", "channel", "drainage", "network", "threshold", "hydrology"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [
      { name: "threshold", label: "Upstream cells", kind: "number", default: 100, step: 50, min: 1 },
    ],
    outputType: "raster",
    outputName: "streams_{input}",
    engines: {
      native: (i, p) => {
        const out = HY.streams(i.input.raster, { threshold: Number(p.threshold) || 500 });
        if (!out.count) return { ok: false, message: "no cell reached that threshold" };
        return out.raster;
      },
      sidecar: {
        requires: ["numpy"],
        build: ({ inputs, params, outputName }) => ({
          tool: "hydrology",
          params: { operation: "streams", threshold: params.threshold },
          inputs: [inputs.input],
          output: `data/processed/${outputName}.asc`,
        }),
      },
    },
  },
  {
    id: "viewshed",
    label: "Viewshed",
    category: "Hydrology",
    blurb: "What can be seen from a point — line of sight over the terrain, cell by cell.",
    keywords: ["visibility", "line of sight", "observer", "seen", "intervisibility"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [
      { name: "lat", label: "Observer latitude", kind: "number", default: 0, step: 0.001 },
      { name: "lon", label: "Observer longitude", kind: "number", default: 0, step: 0.001 },
      { name: "height", label: "Observer height (m)", kind: "number", default: 1.7, step: 0.5, min: 0 },
      { name: "radiusKm", label: "Radius (km)", kind: "number", default: 10, step: 1, min: 0.1 },
    ],
    outputType: "raster",
    outputName: "viewshed_{input}",
    engines: {
      native: (i, p) => {
        /**
         * Two faults the sweep caught here, one silent and one loud.
         *
         * The engine read `p.observerHeight` and `p.radiusKm` while the params
         * were named `height` and -- nothing: a typed observer height was
         * silently ignored (always 1.7 m) and the radius was always 10 km with
         * no control offering it. A param a form collects and an engine never
         * reads is the quietest kind of dead control.
         *
         * And the observer DEFAULTED to (0, 0) -- the Gulf of Guinea -- so the
         * untouched form always answered "the observer is outside the DEM".
         * The untouched default now means "the middle of this DEM", and says
         * so; a point somebody actually typed that misses the DEM still gets
         * the honest error.
         */
        let lat = Number(p.lat);
        let lon = Number(p.lon);
        let placed = "";
        const b = i.input.raster.bounds;
        // (0, 0) is the untouched form even where the DEM contains the origin
        // — the same rule watershed's outlet states at length.
        if (lat === 0 && lon === 0) {
          lat = (b.minY + b.maxY) / 2;
          lon = (b.minX + b.maxX) / 2;
          placed = ` Observer defaulted to the DEM centre (${lat.toFixed(3)}, ${lon.toFixed(3)}).`;
        }
        const out = HY.viewshed(i.input.raster, lat, lon, {
          observerHeight: Number(p.height) || 1.7,
          radiusKm: Number(p.radiusKm) || 10,
        });
        if (!out.ok) return { ok: false, message: out.message };
        if (placed) out.raster.note = placed;
        return out.raster;
      },
      sidecar: {
        requires: ["numpy"],
        build: ({ inputs, params, outputName }) => ({
          tool: "viewshed",
          params: { observer: [params.lon, params.lat], observer_height: params.height },
          inputs: [inputs.input],
          output: `data/processed/${outputName}.asc`,
        }),
      },
    },
  },
  {
    id: "kriging",
    label: "Kriging",
    category: "Interpolation",
    blurb: "Geostatistical interpolation with a fitted variogram, and a variance surface saying how far to trust it.",
    keywords: ["geostatistics", "variogram", "ordinary", "interpolate", "surface", "scipy"],
    inputs: [{ name: "input", label: "Points", type: "vector" }],
    params: [
      { name: "field", label: "Value field", kind: "field" },
      { name: "model", label: "Variogram", kind: "select", default: "spherical", options: [
        { id: "spherical", name: "Spherical" }, { id: "exponential", name: "Exponential" },
      ] },
      { name: "cellsAcross", label: "Cells across", kind: "number", default: 256, step: 32, min: 8 },
    ],
    outputType: "raster",
    outputName: "kriging_{input}",
    engines: {
      native: (i, p) => {
        const points = (i.input.collection?.features || []).map((f) => ({
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0],
          value: Number(f.properties?.[p.field]),
        })).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.value));
        if (points.length < 4) return { ok: false, message: "kriging needs at least four samples" };
        const pad = 0.02;
        const bounds = points.reduce((acc, q) => ({
          minX: Math.min(acc.minX, q.lon - pad), minY: Math.min(acc.minY, q.lat - pad),
          maxX: Math.max(acc.maxX, q.lon + pad), maxY: Math.max(acc.maxY, q.lat + pad),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        /**
         * BOTH of this tool's own controls used to be dead here. The engine
         * read `p.cellSizeDeg`, which no param declares, so the grid was
         * always 0.01 degrees whatever "Cells across" said -- and the model
         * select never reached krigeGrid at all, which hardcoded the
         * spherical family and then reported "spherical variogram" in the
         * message however Exponential had been set. The sidecar honoured
         * both, so the same form gave different answers depending on which
         * engine happened to run.
         */
        const across = Math.max(8, Math.round(Number(p.cellsAcross) || 256));
        const out = KR.krigeGrid(points, bounds, {
          cellSizeDeg: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / across,
          model: p.model,
        });
        if (!out.ok) return { ok: false, message: out.message };
        // krigeGrid's message carries the FITTED VARIOGRAM — nugget, sill,
        // range and family — which is the only way to judge whether the
        // surface is worth believing. It was computed and thrown away.
        return { raster: RA.makeRaster(out.values, out.width, out.height, out.bounds, NaN),
          note: out.message };
      },
      sidecar: {
        requires: ["numpy", "scipy"],
        // kriging.py carries its samples INLINE (params.points), not as a
        // file — so the points are read out of the layer here rather than
        // staged. Its 2000-point cap is the tool's, and it says so itself.
        build: ({ layers, params, outputName }) => {
          const points = [];
          (layers.input.collection?.features || []).forEach((f) => {
            const value = Number(f.properties?.[params.field]);
            if (!Number.isFinite(value)) return;
            const g = f.geometry;
            const coords = g?.type === "Point" ? [g.coordinates]
              : g?.type === "MultiPoint" ? g.coordinates : [];
            coords.forEach((c) => points.push([c[0], c[1], value]));
          });
          const bounds = boundsOfCollection(layers.input);
          return {
            tool: "kriging",
            params: {
              points, model: params.model,
              cells_across: Math.round(params.cellsAcross),
              bounds: bounds ? [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY] : undefined,
            },
            inputs: [],
            output: `data/processed/${outputName}.asc`,
          };
        },
      },
    },
  },
  // ── Interpolation (points to a continuous surface) ───────────────────────
  {
    id: "idw",
    label: "IDW interpolation",
    category: "Interpolation",
    blurb: "Turn scattered measurements into a surface — nearer samples count for more. Exact at every sample.",
    keywords: ["interpolate", "surface", "kriging", "points", "grid", "distance", "weighted"],
    inputs: [{ name: "input", label: "Points", type: "vector" }],
    params: [
      { name: "field", label: "Value field", kind: "field" },
      { name: "power", label: "Power", kind: "number", default: 2, step: 0.5, min: 0.1 },
      { name: "cellsAcross", label: "Cells across", kind: "number", default: 256, step: 32, min: 8 },
    ],
    outputType: "raster",
    outputName: "idw_{input}",
    engines: {
      native: (i, p) => {
        const bounds = boundsOfCollection(i.input);
        if (!bounds) return { ok: false, message: "That layer has no usable extent." };
        const raster = IN.idwRaster(i.input.collection, p.field, bounds,
          { power: p.power, cellsAcross: Math.round(p.cellsAcross) });
        if (!raster) return { ok: false, message: `No numeric "${p.field}" values to interpolate.` };
        return { raster };
      },
    },
  },
  {
    id: "tin",
    label: "TIN surface",
    category: "Interpolation",
    blurb: "Triangulate the points and interpolate across each triangle — linear between samples, blank outside their hull.",
    keywords: ["triangulate", "delaunay", "surface", "linear", "mesh", "interpolate"],
    inputs: [{ name: "input", label: "Points", type: "vector" }],
    params: [
      { name: "field", label: "Value field", kind: "field" },
      { name: "cellsAcross", label: "Cells across", kind: "number", default: 256, step: 32, min: 8 },
    ],
    outputType: "raster",
    outputName: "tin_{input}",
    engines: {
      native: (i, p) => {
        const bounds = boundsOfCollection(i.input);
        if (!bounds) return { ok: false, message: "That layer has no usable extent." };
        const raster = IN.tinRaster(i.input.collection, p.field, bounds,
          { cellsAcross: Math.round(p.cellsAcross) });
        if (!raster) return { ok: false, message: "Not enough points with values to triangulate (three minimum)." };
        return { raster };
      },
    },
  },
  {
    id: "voronoi",
    label: "Voronoi polygons",
    category: "Interpolation",
    blurb: "One polygon per point, covering everywhere closer to it than to any other — catchments, service areas, nearest-station zones.",
    keywords: ["thiessen", "proximity", "nearest", "catchment", "tessellation", "polygons"],
    inputs: [{ name: "input", label: "Points", type: "vector" }],
    params: [],
    outputType: "vector",
    outputName: "voronoi_{input}",
    engines: {
      native: (i) => {
        const bounds = boundsOfCollection(i.input);
        if (!bounds) return { ok: false, message: "That layer has no usable extent." };
        return IN.voronoiPolygons(i.input.collection, bounds);
      },
    },
  },
  {
    id: "zonalStatistics",
    label: "Zonal statistics",
    category: "Zonal statistics",
    blurb: "Min, max, mean, sum and spread of raster values inside each polygon zone.",
    keywords: ["statistics", "zones", "mean", "summary", "aggregate"],
    inputs: [
      { name: "input", label: "Raster", type: "raster" },
      { name: "zones", label: "Zones", type: "vector" },
    ],
    params: [],
    /**
     * A VECTOR output now, and that is the whole point of the change.
     *
     * As a table the answer was computed and then DISCARDED: the dialog reads
     * result.message and result.layer only, nothing anywhere consumed
     * result.rows, so the tool printed one status line and threw its numbers
     * away — no layer, no export, no project file. Zonal statistics is keyed
     * BY POLYGON, so the honest output is the zones themselves with the
     * statistics written back as attributes: it draws, symbolises (painted by
     * mean on arrival), exports, opens in the Table window and chains into
     * the next tool like any other layer.
     */
    outputType: "vector",
    outputName: "zonal_{input}",
    paint: { field: "zonal_mean", ramp: "viridis" },
    engines: {
      native: (i) => {
        const results = RA.zonalStatistics(i.input.raster, i.zones.collection);
        // Results skip zones with no polygons, so order is not 1:1 with the
        // features — but each result carries the zone's OWN properties object,
        // and identity is the join key.
        const byProps = new Map(results.map((r) => [r.properties, r]));
        const features = [];
        i.zones.collection.features.forEach((zone) => {
          const r = byProps.get(zone.properties);
          if (!r || !(r.count > 0)) return;
          features.push({
            type: "Feature",
            geometry: zone.geometry,
            properties: {
              ...zone.properties,
              zonal_cells: r.count,
              zonal_min: r.min, zonal_max: r.max,
              zonal_mean: Number(r.mean.toFixed(3)),
              zonal_sum: Number(r.sum.toFixed(3)),
              zonal_std: Number(r.stdDev.toFixed(3)),
              ...(r.centroidFallback ? { zonal_note: "centroid sample (zone under one cell)" } : {}),
            },
          });
        });
        if (!features.length) {
          return { ok: false, message: "No raster cells fell inside those zones." };
        }
        const fallbacks = features.filter((f) => f.properties.zonal_note).length;
        const first = features[0].properties;
        return {
          collection: { type: "FeatureCollection", features },
          note: `${features.length} zones — mean written to zonal_mean `
            + `(first: ${first.zonal_cells} cells, mean ${first.zonal_mean}).`
            + (fallbacks ? ` ${fallbacks} zones under one cell used centroid sampling.` : ""),
        };
      },
    },
  },
  /* ── Validation (Is the model any good?) ─────────────────────────────────
     Every tool above makes a map; these say whether to believe it. */
  {
    id: "rocAuc",
    label: "ROC / AUC",
    category: "Validation",
    blurb: "How well a surface separates observed occurrences from non-occurrences.",
    keywords: ["validate", "accuracy", "auc", "roc", "skill", "performance"],
    inputs: [
      { name: "input", label: "Model raster", type: "raster" },
      { name: "observations", label: "Observations", type: "vector" },
    ],
    params: [
      // `of` points the field list at the OBSERVATIONS layer — without it the
      // dialog listed the raster's fields, of which there are none, so the
      // select was empty and the run refused. And optional, because the
      // engine already treats blank as "every row is an occurrence", which
      // is what the label had promised all along.
      { name: "field", label: "Outcome field (blank = all are occurrences)", kind: "field",
        of: "observations", optional: true },
      { name: "positiveValue", label: "Value meaning \u201cit happened\u201d", kind: "text", default: "" },
    ],
    outputType: "table",
    outputName: "roc_{input}",
    engines: {
      native: (i, p) => {
        const sample = (lat, lon) => sampleRaster(i.input.raster, lat, lon);
        const pairs = VAL.pairsFromFeatures(i.observations.collection.features, sample, {
          field: p.field || null,
          positiveValue: p.positiveValue === "" ? null : p.positiveValue,
        });
        /**
         * Presence-only observations are the ordinary case -- a landslide
         * inventory records where slides HAPPENED, never where they did not --
         * and the old answer was a refusal ("ROC needs both outcomes") that
         * left the tool unusable on exactly the data it exists for. Standard
         * practice is pseudo-absences: random background cells stand in for
         * non-occurrences (the South Wales validation did precisely this).
         * Seeded, so the same inputs give the same AUC on every run, and the
         * message SAYS the negatives are background rather than observed.
         */
        let bg = 0;
        if (pairs.length && pairs.every((pr) => pr.positive)) {
          const r = i.input.raster;
          const want = Math.min(1000, Math.max(200, pairs.length * 10));
          let seed = 42 >>> 0;
          const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          for (let tries = 0; tries < want * 20 && bg < want; tries += 1) {
            const v = r.band[Math.floor(rand() * r.band.length)];
            if (Number.isFinite(v) && (r.noData == null || v !== r.noData)) {
              pairs.push({ score: v, positive: false });
              bg += 1;
            }
          }
          if (!bg) return { ok: false, message: "No background cells to stand in for absences." };
        }
        const roc = VAL.rocCurve(pairs);
        if (!roc.ok) return { ok: false, message: roc.message };
        const best = VAL.bestThreshold(pairs);
        return {
          rows: roc.points.map((pt) => ({
            threshold: Number.isFinite(pt.score) ? Number(pt.score.toFixed(4)) : "",
            false_positive_rate: pt.fpr, true_positive_rate: pt.tpr,
          })),
          message: `AUC ${roc.auc} over ${roc.positives} occurrences and ${roc.negatives} `
            + (bg ? `random background cells (presence-only observations). ` : `non-occurrences. `)
            + `Best split at ${Number(best.threshold).toFixed(3)} `
            + `(catches ${(best.tpr * 100).toFixed(0)}% for ${(best.fpr * 100).toFixed(0)}% false alarms).`,
        };
      },
    },
  },
  {
    id: "successRate",
    label: "Success-rate curve",
    category: "Validation",
    blurb: "What share of recorded events falls in the highest-ranked share of the area.",
    keywords: ["validate", "success", "rate", "curve", "landslide", "auc", "inventory"],
    inputs: [
      { name: "input", label: "Susceptibility raster", type: "raster" },
      { name: "events", label: "Event inventory", type: "vector" },
    ],
    params: [{ name: "steps", label: "Steps", kind: "number", default: 100, min: 10, step: 10 }],
    outputType: "table",
    outputName: "success_{input}",
    engines: {
      native: (i, p) => {
        const sample = (lat, lon) => sampleRaster(i.input.raster, lat, lon);
        const eventScores = EX.pointsOf(i.events.collection)
          .map((pt) => sample(pt.lat, pt.lon)).filter(Number.isFinite);
        const out = VAL.successRate(VAL.rasterValues(i.input.raster), eventScores, p.steps || 100);
        if (!out.ok) return { ok: false, message: out.message };
        const at = (f) => out.points.find((q) => Math.abs(q.areaFraction - f) < 1e-9);
        return {
          rows: out.points.map((q) => ({
            area_fraction: q.areaFraction, event_fraction: q.eventFraction, threshold: q.threshold,
          })),
          message: `AUC ${out.auc}. The top 10% of the area holds `
            + `${((at(0.1)?.eventFraction || 0) * 100).toFixed(1)}% of ${out.events} events; `
            + `the top 25% holds ${((at(0.25)?.eventFraction || 0) * 100).toFixed(1)}%.`,
        };
      },
    },
  },
  {
    id: "confusion",
    label: "Confusion matrix",
    category: "Validation",
    blurb: "True and false positives at a threshold, with precision, recall and kappa.",
    keywords: ["validate", "accuracy", "kappa", "precision", "recall", "matrix", "error"],
    inputs: [
      { name: "input", label: "Model raster", type: "raster" },
      { name: "observations", label: "Observations", type: "vector" },
    ],
    params: [
      { name: "threshold", label: "Threshold", kind: "number", default: 0.5, step: 0.1 },
      { name: "field", label: "Outcome field (blank = all are occurrences)", kind: "field",
        of: "observations", optional: true },
    ],
    outputType: "table",
    outputName: "confusion_{input}",
    engines: {
      native: (i, p) => {
        const sample = (lat, lon) => sampleRaster(i.input.raster, lat, lon);
        const pairs = VAL.pairsFromFeatures(i.observations.collection.features, sample,
          { field: p.field || null });
        const m = VAL.confusionMatrix(pairs, Number(p.threshold));
        if (!m.ok) return { ok: false, message: m.message };
        return {
          rows: [
            { measure: "true positives", value: m.tp },
            { measure: "false positives", value: m.fp },
            { measure: "false negatives", value: m.fn },
            { measure: "true negatives", value: m.tn },
            { measure: "accuracy", value: m.accuracy },
            { measure: "precision", value: m.precision },
            { measure: "recall (sensitivity)", value: m.recall },
            { measure: "specificity", value: m.specificity },
            { measure: "F1", value: m.f1 },
            { measure: "Cohen's kappa", value: m.kappa },
          ],
          message: `At ${m.threshold}: accuracy ${m.accuracy}, kappa ${m.kappa} over ${m.n} observations.`
            + (m.kappa != null && m.kappa < 0.2
              ? " Kappa this low means the accuracy is mostly the base rate, not skill." : ""),
        };
      },
    },
  },
  {
    id: "randomSample",
    label: "Random sample points",
    category: "Validation",
    blurb: "Reproducible points spread evenly over a raster's extent, for validation.",
    keywords: ["sample", "random", "validation", "points", "training", "seed"],
    inputs: [{ name: "input", label: "Extent from raster", type: "raster" }],
    params: [
      { name: "count", label: "Points", kind: "number", default: 200, min: 1, step: 50 },
      { name: "seed", label: "Seed (same seed, same points)", kind: "number", default: 1, min: 1 },
    ],
    outputType: "vector",
    outputName: "sample_{input}",
    engines: {
      native: (i, p) => {
        const raster = i.input.raster;
        const points = VAL.randomPoints(raster.bounds, Number(p.count) || 200, {
          seed: Number(p.seed) || 1,
          sampler: (lat, lon) => sampleRaster(raster, lat, lon),
        });
        if (!points.length) return { ok: false, message: "no sample point fell on data" };
        return {
          type: "FeatureCollection",
          features: points.map((pt, n) => ({
            type: "Feature",
            properties: { point: n + 1, value: pt.value, seed: Number(p.seed) || 1 },
            geometry: { type: "Point", coordinates: [pt.lon, pt.lat] },
          })),
        };
      },
    },
  },
  {
    id: "stratifiedSample",
    label: "Stratified sample points",
    category: "Validation",
    blurb: "Equal numbers from each class, so the rare high class is not missed.",
    keywords: ["sample", "stratified", "class", "validation", "balanced"],
    inputs: [{ name: "input", label: "Classified raster", type: "raster" }],
    params: [
      { name: "perClass", label: "Points per class", kind: "number", default: 50, min: 1, step: 10 },
      { name: "seed", label: "Seed", kind: "number", default: 1, min: 1 },
    ],
    outputType: "vector",
    outputName: "strata_{input}",
    engines: {
      native: (i, p) => {
        const raster = i.input.raster;
        const seen = new Set();
        VAL.rasterValues(raster).forEach((v) => { if (seen.size < 40) seen.add(Math.round(v)); });
        const points = VAL.stratifiedPoints(raster.bounds,
          (lat, lon) => sampleRaster(raster, lat, lon),
          { perClass: Number(p.perClass) || 50, seed: Number(p.seed) || 1, classes: [...seen] });
        if (!points.length) return { ok: false, message: "no class could be sampled" };
        return {
          type: "FeatureCollection",
          features: points.map((pt, n) => ({
            type: "Feature",
            properties: { point: n + 1, class: Number(pt.class), value: pt.value },
            geometry: { type: "Point", coordinates: [pt.lon, pt.lat] },
          })),
        };
      },
    },
  },
  /* ── The four raster functions the hazard work needed ───────────────────── */
  {
    id: "twi",
    label: "Topographic wetness index",
    category: "Surface analysis",
    blurb: "ln(upslope area / tan slope) — where water gathers. Needs flow accumulation and slope.",
    keywords: ["twi", "wetness", "saturation", "flood", "hydrology", "index"],
    inputs: [
      { name: "input", label: "Flow accumulation", type: "raster" },
      { name: "slope", label: "Slope (degrees)", type: "raster" },
    ],
    params: [{ name: "minSlopeDeg", label: "Flat-ground floor (deg)", kind: "number", default: 0.1, step: 0.05, min: 0.001 }],
    outputType: "raster",
    outputName: "twi_{input}",
    engines: {
      native: (i, p) => {
        const out = EX.topographicWetness(i.input.raster, i.slope.raster,
          { minSlopeDeg: Number(p.minSlopeDeg) || 0.1 });
        return out.ok ? out.raster : { ok: false, message: out.message };
      },
    },
  },
  {
    id: "mosaic",
    label: "Mosaic rasters",
    category: "Surface analysis",
    blurb: "Merge tiles into one grid at the finest input resolution.",
    keywords: ["merge", "mosaic", "tiles", "combine", "join", "dem"],
    inputs: [
      { name: "input", label: "First raster", type: "raster" },
      { name: "second", label: "Second raster", type: "raster" },
    ],
    params: [{
      name: "method", label: "Where they overlap", kind: "select", default: "first",
      options: [
        { value: "first", label: "Keep the first" }, { value: "last", label: "Keep the last" },
        { value: "mean", label: "Average" }, { value: "max", label: "Highest" },
        { value: "min", label: "Lowest" },
      ],
    }],
    outputType: "raster",
    outputName: "mosaic_{input}",
    engines: {
      native: (i, p) => {
        const out = EX.mosaic([i.input.raster, i.second.raster], { method: p.method || "first" });
        return out.ok ? out.raster : { ok: false, message: out.message };
      },
    },
  },
  {
    /**
     * The tool that makes the other thirty usable.
     *
     * Measured across the registry: **30 of the 47 tools need a raster** —
     * every terrain, hydrology, zonal and validation tool — and a layer only
     * counts as one if it carries `layer.raster`, which until now arrived by
     * exactly one route: the user importing a GeoTIFF or .asc themselves. So
     * on a fresh page, or on any planet, Slope / Hillshade / Contours /
     * Watershed — the obvious first things anyone tries — could not run at
     * all, and the tool palette read as mostly broken.
     *
     * Meanwhile every world already HAS elevation: it is what the globe is
     * displaced by, what the cursor readout quotes and what the extraction
     * panel samples. It simply was not offered as a layer. This hands it over
     * for a drawn area, so the first tool a reader opens produces the input
     * every other one was waiting for.
     *
     * `buildSurface` is the Model Builder's own sampler, reused rather than
     * rewritten — it already carries the body-radius conversion, the node cap
     * that holds, and the fill-and-count for nodes the DEM cannot answer.
     */
    /**
     * The bridge from a PICTURE on the globe to a raster the tools can read.
     *
     * Audited by asking each seam what it could see: an Earth Engine layer
     * carries a `sampler` -- gee-sample recovers real numbers from the palette
     * it was painted with -- so extraction and the Model Builder have always
     * read it. But it carries no `raster`, and `layersByType("raster")` admits
     * a layer only if it does, so a rainfall map, an NDVI map or a GEE DEM was
     * invisible to all thirty raster tools. Measured with a CHIRPS layer and a
     * GEBCO overlay loaded: `layersByType("raster")` returned an EMPTY LIST.
     * Slope on a GEE elevation map, reclassify on rainfall, zonal statistics
     * over NDVI -- none of them could see the layer they were for.
     *
     * So the same shape as `terrain`, over a different reader: the area says
     * where, the layer says what, and the answer is an ordinary raster that
     * chains into everything. A layer whose sampler only knows COLOUR (no
     * legend to invert) is refused by name rather than rasterised into
     * numbers that mean nothing.
     */
    id: "sampleLayer",
    label: "Layer to raster (sample)",
    category: "Surface analysis",
    blurb: "Sample a draped layer (Earth Engine, and anything else with values) over a polygon into a raster the other tools can read.",
    keywords: ["gee", "earth engine", "drape", "sample", "raster", "convert", "source", "rainfall", "ndvi"],
    inputs: [
      { name: "area", label: "Area (a polygon layer)", type: "vector" },
      { name: "source", label: "Layer to sample", type: "sampled" },
    ],
    params: [
      { name: "cellM", label: "Cell size (m, 0 = the layer's NATIVE cell)", kind: "number",
        default: 0, min: 0, step: 10 },
    ],
    outputType: "raster",
    outputName: "sampled_{source}",
    engines: {
      native: (i, p) => {
        const viewer = typeof window !== "undefined" ? window.GeoIDViewer : null;
        const read = i.source.sampler;
        if (typeof read !== "function") {
          return { ok: false, message: "that layer cannot be asked for a value" };
        }
        const kind = i.source.info?.valueKind;
        if (kind === "colour") {
          return { ok: false, message: `"${i.source.name}" is a picture — it carries no legend `
            + "to read numbers back through, so there is nothing to rasterise." };
        }
        const rings = ringsOfCollection(i.area.collection);
        if (!rings.length) return { ok: false, message: "that layer holds no polygons" };
        const bbox = ringsBounds(rings);
        const radiusKm = viewer?.bodyRadiusKm || 6371.0088;
        const span = Math.max(
          (bbox.east - bbox.west) * Math.cos((bbox.south + bbox.north) / 2 * Math.PI / 180),
          bbox.north - bbox.south) * (Math.PI * radiusKm * 1000) / 180;
        /**
         * ZERO MEANS NATIVE, not "a hundred and twenty across".
         *
         * A grid somebody typed is the one thing this must not invent: read a
         * 30 m GeoTIFF at 500 m and 99.6% of it is thrown away; read a global
         * Earth Engine snapshot at 500 m and one pixel is spread across six
         * thousand samples that all say the same thing. The layer's own grid
         * is knowable — `nativeGridOf` measures it from the raster or from
         * the delivered image, never from a declared scale — so that is the
         * default, and the note says which cell size was used and why.
         */
        const native = nativeGridOf(i.source);
        const cell = Number(p.cellM) > 0 ? Number(p.cellM)
          : (native?.metresPerPixel && native.metresPerPixel > 0
            ? native.metresPerPixel : Math.max(span / 120, 1));
        const cellWhy = Number(p.cellM) > 0 ? "as asked"
          : (native?.metresPerPixel ? "the layer's own cell" : "fitted to the area");
        let numbers = 0;
        const grid = buildSurface({
          bounds: { west: bbox.west, east: bbox.east, south: bbox.south, north: bbox.north },
          stepM: cell,
          radiusKm,
          sampleElevation: (lat, lon) => {
            const value = read(lat, lon);
            // null is outside or off-ramp; an {r,g,b} is a colour, not a value.
            if (!Number.isFinite(value)) return NaN;
            numbers += 1;
            return value;
          },
        });
        if (!grid.ok) return { ok: false, message: grid.message };
        if (!numbers) {
          return { ok: false, message: `"${i.source.name}" answered no values over that area — `
            + "it may not cover this ground, or it may be a colour-only drape." };
        }
        // buildSurface indexes south-to-north; a raster band runs top-down.
        const band = new Float32Array(grid.nx * grid.ny);
        for (let j = 0; j < grid.ny; j += 1) {
          const src = (grid.ny - 1 - j) * grid.nx;
          band.set(grid.z.subarray(src, src + grid.nx), j * grid.nx);
        }
        const unit = i.source.info?.unit ? ` ${i.source.info.unit}` : "";
        return {
          note: `${Math.round(cell)} m cells (${cellWhy}), ${grid.nx}x${grid.ny}, `
            + `${numbers} of ${grid.nx * grid.ny} cells carried a value${unit}.`,
          raster: {
            band,
            width: grid.nx,
            height: grid.ny,
            bounds: { minX: bbox.west, maxX: bbox.east, minY: bbox.south, maxY: bbox.north },
            noData: null,
          },
        };
      },
    },
  },
  {
    id: "terrain",
    label: "Terrain to raster (DEM)",
    category: "Surface analysis",
    blurb: "Sample this world's elevation over a polygon into a DEM — the raster every terrain tool needs.",
    keywords: ["dem", "elevation", "terrain", "height", "surface", "raster", "source"],
    inputs: [{ name: "area", label: "Area (a polygon layer)", type: "vector" }],
    params: [
      { name: "cellM", label: "Cell size (m, 0 = fit the area)", kind: "number",
        default: 0, min: 0, step: 10 },
    ],
    outputType: "raster",
    outputName: "dem_{area}",
    // It IS a height field, so it may displace the surface and wear the
    // elevation ramp; see buildRasterLayer's isDem.
    elevationOutput: true,
    engines: {
      native: (i, p) => {
        const viewer = typeof window !== "undefined" ? window.GeoIDViewer : null;
        if (!viewer?.sampleElevationMeters) {
          return { ok: false, message: "this world exposes no elevation to sample" };
        }
        const rings = ringsOfCollection(i.area.collection);
        if (!rings.length) return { ok: false, message: "that layer holds no polygons" };
        const bbox = ringsBounds(rings);
        const radiusKm = viewer.bodyRadiusKm || 6371.0088;
        // 0 means "fit the area": ~120 cells across, the same working default
        // the Model Builder uses when nothing finer is asked for.
        const span = Math.max(
          (bbox.east - bbox.west) * Math.cos((bbox.south + bbox.north) / 2 * Math.PI / 180),
          bbox.north - bbox.south) * (Math.PI * radiusKm * 1000) / 180;
        const cell = Number(p.cellM) > 0 ? Number(p.cellM) : Math.max(span / 120, 1);
        const grid = buildSurface({
          bounds: { west: bbox.west, east: bbox.east, south: bbox.south, north: bbox.north },
          stepM: cell,
          radiusKm,
          // The viewer's DEM is indexed 0-360 east; the trap every sampler here
          // has to answer for.
          sampleElevation: (lat, lon) => {
            const lon360 = ((lon % 360) + 360) % 360;
            const v = viewer.sampleElevationMeters(lat, lon360);
            return Number.isFinite(v) ? v : NaN;
          },
        });
        if (!grid.ok) return { ok: false, message: grid.message };
        // buildSurface indexes south-to-north; a raster band runs top-down, so
        // the rows are flipped rather than left to read upside down.
        const band = new Float32Array(grid.nx * grid.ny);
        for (let j = 0; j < grid.ny; j += 1) {
          const src = (grid.ny - 1 - j) * grid.nx;
          band.set(grid.z.subarray(src, src + grid.nx), j * grid.nx);
        }
        /**
         * SAY WHICH IT IS: measured ground, or arithmetic between two pixels.
         *
         * The sampler will answer at any spacing asked of it, so this tool
         * will happily return a 92 m grid from a source whose own sampling is
         * 19.6 km — and everything downstream (slope, aspect, hillshade,
         * contours) then inherits a precision nobody measured. That is not a
         * fault to fix, it is the honest limit of a global DEM over a small
         * study, and it looks exactly like a rendering bug: a smooth colour
         * ramp with a hard straight seam through it, which is one source pixel
         * boundary. Reported as "the mapping doesn't overlay closely", and
         * half of what was meant by it.
         *
         * The Model Builder's Surface step already measures this; the SAME
         * function answers here, so the two cannot quote different numbers.
         */
        const native = nativeStepM({
          read: (la, lo) => viewer.sampleElevationMeters(la, ((lo % 360) + 360) % 360),
          lat: (bbox.south + bbox.north) / 2,
          lon: (bbox.west + bbox.east) / 2,
          radiusKm,
        });
        const cellText = `${Math.round(cell)} m cells, ${grid.nx}x${grid.ny}.`;
        const note = native && native > cell * 1.5
          ? `${cellText} The source's own sampling here is about `
            + `${Math.round(native).toLocaleString()} m, so this grid is INTERPOLATED between `
            + "its pixels — smooth, and not new ground detail."
          : `${cellText}${native ? ` Source sampling about ${Math.round(native)} m.` : ""}`;
        return {
          note,
          raster: {
            band,
            width: grid.nx,
            height: grid.ny,
            bounds: { minX: bbox.west, maxX: bbox.east, minY: bbox.south, maxY: bbox.north },
            noData: null,
          },
        };
      },
    },
  },
  {
    id: "density",
    label: "Point density (KDE)",
    category: "Surface analysis",
    blurb: "Turn a scatter of events into a surface, per square kilometre.",
    keywords: ["density", "kde", "kernel", "heatmap", "inventory", "hotspot"],
    inputs: [{ name: "input", label: "Points", type: "vector" }],
    params: [
      { name: "radiusKm", label: "Search radius (km)", kind: "number", default: 5, min: 0.1, step: 1 },
      { name: "cellSizeDeg", label: "Cell size (deg)", kind: "number", default: 0.005, min: 0.0001, step: 0.001 },
    ],
    outputType: "raster",
    outputName: "density_{input}",
    engines: {
      native: (i, p) => {
        const points = EX.pointsOf(i.input.collection);
        if (!points.length) return { ok: false, message: "that layer holds no points" };
        const pad = (Number(p.radiusKm) || 5) / 100;
        const bounds = points.reduce((acc, pt) => ({
          minX: Math.min(acc.minX, pt.lon - pad), minY: Math.min(acc.minY, pt.lat - pad),
          maxX: Math.max(acc.maxX, pt.lon + pad), maxY: Math.max(acc.maxY, pt.lat + pad),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const out = EX.kernelDensity(points, bounds, {
          radiusKm: Number(p.radiusKm) || 5,
          cellSizeDeg: Number(p.cellSizeDeg) || 0.005,
        });
        return out.ok ? out.raster : { ok: false, message: out.message };
      },
    },
  },
  {
    id: "histogram",
    label: "Histogram & statistics",
    category: "Zonal statistics",
    blurb: "What is actually in this raster: counts per bin, mean, median and spread.",
    keywords: ["histogram", "statistics", "distribution", "summary", "mean", "median"],
    inputs: [{ name: "input", label: "Raster", type: "raster" }],
    params: [{ name: "bins", label: "Bins", kind: "number", default: 20, min: 2, step: 1 }],
    outputType: "table",
    outputName: "histogram_{input}",
    engines: {
      native: (i, p) => {
        const out = EX.histogram(VAL.rasterValues(i.input.raster), { bins: Number(p.bins) || 20 });
        if (!out.ok) return { ok: false, message: out.message };
        return {
          rows: out.bins.map((b) => ({
            from: b.from, to: b.to, count: b.count, fraction: b.fraction,
          })),
          message: `${out.count.toLocaleString()} cells, ${out.min} to ${out.max}, `
            + `mean ${out.mean}, median ${out.median}, sd ${out.stdDev}.`,
        };
      },
    },
  },
];
export const toolById = (id) => TOOLS.find((t) => t.id === id);

/**
 * The single source of truth for "which layers can this input take" (spec 1.1,
 * closing gap D): toolbox-ops.js requires `.collection` where import-manager's
 * getVectorLayers requires `.features?.length` — consistent today, one adapter
 * away from a layer appearing in half the selects. Both the dialog and, during
 * migration, refreshToolboxSelects call this instead.
 */
/**
 * Quantile class rules for a raster: N classes with (near) equal cell counts.
 * The reclassify tool's blank-rules mode -- equal-count rather than
 * equal-interval, because most rasters here are skewed (the FRP lesson) and
 * equal intervals would put nearly everything in one class.
 */
function quantileRules(raster, classes) {
  const values = [];
  for (let k = 0; k < raster.band.length; k += 1) {
    const v = raster.band[k];
    if (Number.isFinite(v) && (raster.noData == null || v !== raster.noData)) values.push(v);
  }
  if (!values.length) return { ok: false, message: "The raster holds no values to class." };
  values.sort((a, b) => a - b);
  const n = Math.max(2, Math.min(12, Math.round(classes) || 5));
  const lo = values[0];
  const hi = values[values.length - 1];
  const rules = [];
  let prev = lo;
  for (let c = 1; c <= n; c += 1) {
    const cut = c === n ? hi : values[Math.min(values.length - 1, Math.floor((values.length * c) / n))];
    if (cut > prev || c === n) {
      // RA.reclassify destructures [min, max, class] ARRAYS -- handing it
      // objects threw "object is not iterable" in the first live run. The
      // last class closes a hair above the maximum so the top cell is caught.
      rules.push([prev, c === n ? hi + Math.abs(hi) * 1e-9 + 1e-9 : cut, rules.length + 1]);
      prev = cut;
    }
  }
  return { ok: true, rules, lo, hi };
}

/** Polygon rings of a collection, as {lat, lon} vertex lists. */
function ringsOfCollection(collection) {
  const rings = [];
  (collection?.features || []).forEach((f) => {
    const g = f?.geometry;
    if (!g) return;
    const polys = g.type === "Polygon" ? [g.coordinates]
      : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach((poly) => {
      if (poly?.[0]?.length) rings.push(poly[0].map(([lon, lat]) => ({ lat, lon })));
    });
  });
  return rings;
}

/** Signed-longitude bounding box of those rings. */
function ringsBounds(rings) {
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  rings.forEach((ring) => ring.forEach((v) => {
    const lon = v.lon > 180 ? v.lon - 360 : v.lon;
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, v.lat); north = Math.max(north, v.lat);
  }));
  return { west, east, south, north };
}

export function layersByType(type) {
  const all = window.GeoIDImportManager?.getLayers?.() || [];
  const loaded = all.filter((l) => l.status === "loaded");
  if (type === "vector") return loaded.filter((l) => l.collection);
  if (type === "raster") return loaded.filter((l) => l.raster);
  if (type === "sampled") return loaded.filter((l) => typeof l.sampler === "function");
  return loaded;
}

/** Same shape AND same bounds — equal dimensions over different ground is
 *  still a mismatch, and the silent kind. */
function sameGrid(a, b) {
  return a.width === b.width && a.height === b.height
    && a.bounds.minX === b.bounds.minX && a.bounds.maxX === b.bounds.maxX
    && a.bounds.minY === b.bounds.minY && a.bounds.maxY === b.bounds.maxY;
}

/**
 * The extent to interpolate over: the layer's own, padded by 2% so the
 * outermost samples are inside the grid rather than on its edge. A study area
 * would be the other candidate, but a surface should not silently extend
 * beyond the data that supports it.
 */
function boundsOfCollection(layer) {
  const coords = [];
  (layer.collection?.features || []).forEach((f) => {
    const g = f.geometry;
    if (g?.type === "Point") coords.push(g.coordinates);
    else if (g?.type === "MultiPoint") coords.push(...g.coordinates);
  });
  if (!coords.length) return layer.bounds || null;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.02 || 0.01;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.02 || 0.01;
  return {
    minX: Math.min(...xs) - padX, maxX: Math.max(...xs) + padX,
    minY: Math.min(...ys) - padY, maxY: Math.max(...ys) + padY,
  };
}

function matchesType(layer, type) {
  if (type === "vector") return Boolean(layer.collection);
  if (type === "raster") return Boolean(layer.raster);
  // A layer that can be ASKED for a value at a coordinate but holds no grid of
  // its own: an Earth Engine drape, whose numbers gee-sample recovers from the
  // palette it was painted with. Extraction has always read these; until
  // sampleLayer there was no way to get one into a raster tool.
  if (type === "sampled") return typeof layer.sampler === "function";
  return true;
}

/** An input given as a layer id (what a <select> holds) or as the record itself. */
function resolveLayer(ref) {
  if (ref === null || ref === undefined || ref === "") return null;
  if (typeof ref === "object") return ref;
  const all = window.GeoIDImportManager?.getLayers?.() || [];
  return all.find((l) => String(l.id) === String(ref)) || null;
}

/**
 * Resolves a descriptor's outputName template: {input} is the first input's
 * basename (extension stripped — "sites.geojson" buffers to "buffer_sites",
 * the way the raster tiles already named things), {tool} the tool id, {n} the
 * smallest integer making the name unique. A resolved name colliding with an
 * existing layer name appends _2 (then _3, ...), so re-running a tool never
 * silently shadows its previous output in the layer list.
 */
export function resolveOutputName(desc, inputs = {}) {
  const first = desc.inputs?.length ? inputs[desc.inputs[0].name] : null;
  const base = first?.name ? String(first.name).replace(/\.[^.]+$/, "") : "layer";
  let name = String(desc.outputName)
    .replaceAll("{input}", base)
    .replaceAll("{tool}", desc.id || "tool");
  // Any input's own name is a token too, so "dist_{features}" names the
  // output after the layer it measures to, not the grid it fills.
  for (const spec of desc.inputs || []) {
    const layer = inputs[spec.name];
    if (layer?.name) {
      name = name.replaceAll(`{${spec.name}}`,
        String(layer.name).replace(/\.[^.]+$/, ""));
    }
  }
  const existing = new Set(
    (window.GeoIDImportManager?.getLayers?.() || []).map((l) => l.name),
  );
  if (name.includes("{n}")) {
    let n = 1;
    while (existing.has(name.replaceAll("{n}", String(n)))) n += 1;
    return name.replaceAll("{n}", String(n));
  }
  if (!existing.has(name)) return name;
  let n = 2;
  while (existing.has(`${name}_${n}`)) n += 1;
  return `${name}_${n}`;
}

// ── History (spec 1.3) ────────────────────────────────────────────────────────

const HISTORY_FILE = "metadata/tool_history.json";
const HISTORY_KEY = "geoid-gis:tool-history";
// The localStorage ring is capped at 50 per spec. The project file is the
// durable record so it keeps more, but bounded — a busy session must not grow
// a metadata file without limit (the atlas-watch rule).
const LOCAL_CAP = 50;
const STORE_CAP = 200;

/**
 * Appends one run record. Project open → metadata/tool_history.json via the
 * store; no project (or a store that fails) → the localStorage ring. Entirely
 * best-effort: history must NEVER fail the run it records (the bridge rule),
 * so every path is caught and the return value only says where it landed
 * ("project" | "local" | null).
 */
/**
 * Run a tool, choosing the engine.
 *
 * The rule, in order: a tool with no sidecar engine runs natively, full stop.
 * A tool that HAS one runs there only when the sidecar is connected, a project
 * is open, the binaries it names are installed, and the input is big enough to
 * be worth the round trip — otherwise native, with the reason appended when
 * the input was big enough that the user would otherwise wonder why it took a
 * minute. A sidecar run that fails falls back to native rather than failing
 * the tool: the browser toolset is the promise, and the sidecar is an upgrade.
 *
 * Async, unlike runTool — the dialog already awaits its result, so this is a
 * drop-in for it.
 */
/**
 * The bounds a tool is really ABOUT.
 *
 * A self-rebuilding layer's own bounds are the world, so they say nothing —
 * the useful extent is the one the OTHER inputs have. Clipping geology by a
 * drawn box is about the box; zonal statistics of a raster over geological
 * zones is about the raster. Where every input rebuilds itself there is no
 * such extent and nothing is fetched, which leaves the tool exactly where it
 * was rather than guessing.
 */
function areaOfInterest(resolved, live) {
  const fixed = resolved.filter((l) => l && !live.includes(l));
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  fixed.forEach((l) => {
    // A layer's declared bounds, else the coordinates it actually holds: a
    // derived or hand-built vector layer need not carry `bounds`, and falling
    // through on that would silently skip the fetch and leave the tool reading
    // whatever snapshot it had — the exact fault this exists to close.
    let b = l.bounds || l.raster?.bounds;
    if ((!b || !Number.isFinite(Number(b.minX))) && l.collection?.features?.length) {
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      const walk = (coords) => {
        if (typeof coords[0] === "number") {
          if (coords[0] < x0) x0 = coords[0];
          if (coords[0] > x1) x1 = coords[0];
          if (coords[1] < y0) y0 = coords[1];
          if (coords[1] > y1) y1 = coords[1];
          return;
        }
        coords.forEach(walk);
      };
      l.collection.features.forEach((f) => { if (f?.geometry?.coordinates) walk(f.geometry.coordinates); });
      if (Number.isFinite(x0)) b = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
    }
    if (!b || !Number.isFinite(Number(b.minX))) return;
    minX = Math.min(minX, Number(b.minX));
    minY = Math.min(minY, Number(b.minY));
    maxX = Math.max(maxX, Number(b.maxX));
    maxY = Math.max(maxY, Number(b.maxY));
  });
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Ask every self-rebuilding input about the ground this run is about, BEFORE
 * any engine sees it.
 *
 * `runTool` calls `engines.native(...)` without awaiting, so an engine must be
 * synchronous and cannot fetch anything — which is why this is here and not
 * there. The tiled geology's `collection` is a snapshot of whatever was on
 * screen when it last rebuilt itself, so clipping it by a drawn box returned
 * whatever the camera happened to be showing, and over a study area that is
 * routinely nothing. Same fault the extraction panel had, one layer down.
 */
/**
 * Params the RUNNER reads rather than an engine.
 *
 * `tool-runner.test.mjs` requires every declared param to be read by its own
 * tool, because a form field an engine never reads is the quietest dead
 * control there is (viewshed collected `height` and read `p.observerHeight`).
 * A param the runner acts on is not dead — it is simply read one level up —
 * so it is named here rather than exempted by a rule nobody can see.
 */
export const RUNNER_PARAMS = new Set(["detail"]);

/**
 * How much of somebody else's tile server one run may spend, by name.
 *
 * Mirrors `TILE_BUDGETS` in vector-tiles.js. Kept as plain numbers rather than
 * imported, because this module is imported in Node by the test suite and
 * vector-tiles pulls in three.js.
 */
const DETAIL_BUDGETS = { fast: 16, balanced: 96, full: 320, maximum: 1200 };

/**
 * What a streaming layer should be asked for, and it is REPORTED afterwards.
 *
 * A tiled source is generalised per level, and it is that generalisation which
 * opens the gaps at contacts — measured in this file's own history, 280 dark
 * holes at zoom 4 and none at zoom 9, because at native scale the polygons
 * still share their boundaries. So which level a clip shipped is not a detail
 * of the plumbing; it is the difference between two different maps, and it was
 * silent.
 */
async function refreshLiveInputs(desc, inputs, params = {}) {
  const resolved = (desc.inputs || []).map((spec) => resolveLayer(inputs[spec.name])).filter(Boolean);
  const live = resolved.filter((l) => typeof l.featuresIn === "function");
  if (!live.length) return { borrowed: [], box: null, note: "" };
  const box = areaOfInterest(resolved, live);
  if (!box) return { borrowed: [], box: null, note: "" };
  const choice = String(params.detail || "balanced");
  const tileBudget = DETAIL_BUDGETS[choice] || DETAIL_BUDGETS.balanced;
  const borrowed = [];
  const notes = [];
  for (const layer of live) {
    // A layer that cannot fetch keeps whatever it had: a failed refresh must
    // never fail the run.
    try {
      await layer.featuresIn(box, { tileBudget });
      borrowed.push(layer);
      const f = layer.lastFetch;
      if (f && Number.isFinite(f.zoom)) {
        // Named so a coarse answer cannot pass as a full one. When the climb
        // stopped on the BUDGET rather than on the source, the next level is
        // offered by name: the reader can spend more deliberately.
        const deeper = (f.levels || []).find((l) => l.overBudget);
        notes.push(`${layer.name} at source zoom ${f.zoom}`
          + ` (${f.tiles} tiles, ${f.features.toLocaleString()} features)`
          + (f.stoppedFor === "budget" && deeper
            ? `; zoom ${deeper.zoom} needs ${deeper.tiles} tiles — raise Detail to go deeper.`
            : "."));
      }
    } catch (error) { /* keep the snapshot */ }
  }
  return { borrowed, box, note: notes.length ? ` ${notes.join(" ")}` : "" };
}

/**
 * Does any part of this feature reach into the box?
 *
 * Both vocabularies are accepted on purpose. `areaOfInterest` answers in
 * `minX/minY/maxX/maxY` and the tile side speaks `west/south/east/north`;
 * reading the wrong one gives `undefined`, every comparison is false, no unit
 * is ever near, and the fetch is skipped in silence — which is exactly how
 * this shipped once already, the clip quietly falling back to tile pieces with
 * nothing in the message to say so.
 */
function touches(feature, box) {
  const west = box.west ?? box.minX;
  const east = box.east ?? box.maxX;
  const south = box.south ?? box.minY;
  const north = box.north ?? box.maxY;
  if (![west, east, south, north].every(Number.isFinite)) return true;
  const g = feature?.geometry;
  if (!g) return false;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(walk);
  };
  walk(g.coordinates || []);
  return maxX >= west && minX <= east && maxY >= south && minY <= north;
}

/**
 * EVERY INPUT BRINGS ITS BEST DATA FOR THIS RUN'S GROUND.
 *
 * `refreshLiveInputs` above does this for layers that stream FEATURES, which
 * for a long time meant geology and nothing else. The same question applies to
 * every kind of source, and the answer differs by kind rather than by tool:
 *
 *   - an Earth Engine layer renders a fixed pixel budget over whatever extent
 *     it is asked for, so a study area is a sharper picture of the same data —
 *     the difference between 39 km/px on a global snapshot and metres over a
 *     county, and cropping the global one can never recover it;
 *   - a WFS layer is fetched under a feature COUNT limit, so a study area is
 *     the part of the answer that was truncated away;
 *   - a GeoTIFF is already its own native grid and a shapefile is already exact
 *     geometry: there is nothing finer to ask for, and saying so is the honest
 *     answer rather than a silent no-op.
 *
 * A layer answers by SWAPPING IN its better data and leaving `restoreLive`
 * behind, exactly as the live-feature path does — so `giveBack` puts the map
 * back the way the reader had it, and a clip does not shrink the layer it was
 * cut from.
 */
async function refineInputsForArea(resolved, box, params, refined = []) {
  if (!box) return "";
  const notes = [];
  for (const layer of Object.values(resolved || {})) {
    if (typeof layer?.refineFor !== "function") continue;
    try {
      const note = await layer.refineFor(box, { detail: params?.detail });
      // Whatever it swapped in has to be given back, so it joins the list
      // `giveBack` walks — a layer left holding one study area's data is the
      // same lie as a layer left holding one study area's features.
      if (typeof layer.restoreLive === "function") refined.push(layer);
      if (typeof note === "string" && note.trim()) notes.push(note.trim());
    } catch (error) {
      // A source that cannot sharpen keeps what it had. Never fail the run for
      // it: the coarse answer is still an answer.
    }
  }
  return notes.length ? ` ${notes.join(" ")}` : "";
}

/**
 * HOW FINELY EACH SURVEY MAPS THE GROUND, measured from the features it sent.
 *
 * Macrostrat's tiles hide this: `carto` picks ONE survey per scale, so a tile
 * carries a single survey's polygons over any given ground. Fetching whole
 * units from the API brings every survey back, and they overlap — measured on
 * a 45 km clip, 80% of it is covered by more than one survey and 2,888 of
 * 4,900 sample points by all three. Drawn flat, a regional survey's boundaries
 * are ruled straight across the detailed survey's geology.
 *
 * `/defs/sources` answers empty for these ids, so the rank is taken from the
 * geometry itself: VERTICES PER UNIT AREA, which is what "more finely mapped"
 * means — boundary detail per unit of ground. On that same clip it separates
 * them cleanly: survey 23 at 14,624 with 51 units averaging 0.0031 deg2, and
 * 154 and 147 at 1,549 and 1,008 with 4 and 15 much larger units. Deriving it
 * from the data rather than a table means any source with overlapping surveys
 * is ranked without a list to maintain.
 */
function surveyRanks(features, publishedScales = null) {
  /**
   * THE PUBLISHER'S OWN ANSWER FIRST, when there is one.
   *
   * Macrostrat composites several surveys and switches between them BY SCALE,
   * so the deepest zoom a survey is served at IS its scale, and the tile
   * reader already learns it while climbing. Preferring it matters because the
   * geometric proxy below is not merely imprecise, it INVERTS: measured over
   * Inishowen it ranked source 154 above source 147 (1,157 to 797), because
   * 147's units had been swapped for smooth verbatim API shapes while 154 was
   * still ragged tile pieces. Vertex density then described how the geometry
   * had been DELIVERED rather than how finely the ground was mapped, the
   * regional map outranked the national one and cut it away, and the study
   * area filled with a coarse blanket over ground a better survey had mapped.
   *
   * Only used when it separates the surveys present. A map with one zoom for
   * everything says nothing, and falls through to the measurement.
   */
  const present = new Set((features || [])
    .map((f) => String(f?.properties?.source_id ?? "")).filter(Boolean));
  if (publishedScales && present.size > 1) {
    const zooms = new Map();
    for (const key of present) {
      const z = Number(publishedScales[key]);
      if (Number.isFinite(z)) zooms.set(key, z);
    }
    // Every survey has to be placed, or a survey with no answer would rank 0
    // and be cut by everything.
    if (zooms.size === present.size && new Set(zooms.values()).size > 1) return zooms;
  }
  const stats = new Map();
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return Math.abs(a / 2);
  };
  for (const f of features || []) {
    const key = String(f?.properties?.source_id ?? "");
    if (!key) continue;
    const g = f.geometry;
    if (!g) continue;
    const rings = g.type === "Polygon" ? g.coordinates
      : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
    if (!rings.length) continue;
    const e = stats.get(key) || { verts: 0, area: 0 };
    rings.forEach((r) => { e.verts += r.length; e.area += ringArea(r); });
    stats.set(key, e);
  }
  const rank = new Map();
  for (const [key, e] of stats) rank.set(key, e.area > 0 ? e.verts / e.area : 0);
  return rank;
}

/**
 * TAKE THE COARSE SURVEY'S GROUND AWAY WHERE A FINER ONE MAPS IT.
 *
 * Drawing the finer survey on top is not enough. The coarse polygon is still
 * THERE — in the picker, the attribute table, an export, the area sums — and
 * it lingers wherever the fine fill does not exactly cover it. Measured before
 * this: of 3,156 sample points on ground the detailed survey maps, 3,155 still
 * had a regional polygon underneath, because a coarse unit that runs offshore
 * is only PARTLY covered and so cannot simply be dropped.
 *
 * `geoprocessing.difference` is the engine the Difference tool uses, and it is
 * the one to use here. Its raw counterpart in `geometry.js` is not: measured
 * against a coarse 2x2 square with a finer square in its CORNER, sharing two
 * edges, `booleanOp` returned EMPTY and deleted the whole polygon — three
 * units of real ground lost — and with the finer square strictly INSIDE it cut
 * nothing at all, a hole being inexpressible as one ring.
 *
 * `difference` gets both right (3.75 for the hole case, 0 when wholly covered,
 * 4 when disjoint). It does NOT cut when the two share an edge exactly, which
 * is a no-op that keeps the ground — the safe direction to fail, and rare
 * between two independent surveys.
 *
 * Cutters are the ORIGINAL finer shapes, never the cut ones, or a tier three
 * deep would be subtracted with geometry that has already lost its middle.
 */
/**
 * Points spread through a feature's own ground, for checking a cut against.
 *
 * A grid over the bounding box, keeping what lands inside the polygon and its
 * holes honoured. Deterministic, because a verification that samples different
 * points each run reports a different map each run. The grid tightens once for
 * a thin or small shape rather than giving up on it: a coastal strip has very
 * little of its bounding box inside it, and those are exactly the features a
 * bad cut eats.
 */
function samplePointsInside(feature, wanted = 120) {
  const polygons = GP.polygonsOf(feature?.geometry);
  if (!polygons.length) return [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const rings of polygons) {
    for (const [x, y] of rings[0] || []) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return [];
  const inside = (p) => polygons.some((rings) => pointInPolygon(p, rings));
  for (const n of [16, 48]) {
    const out = [];
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const p = [minX + ((i + 0.5) * (maxX - minX)) / n, minY + ((j + 0.5) * (maxY - minY)) / n];
        if (inside(p)) out.push(p);
      }
    }
    if (out.length >= 8) {
      if (out.length <= wanted) return out;
      const step = out.length / wanted;
      const thinned = [];
      for (let k = 0; k < wanted; k += 1) thinned.push(out[Math.floor(k * step)]);
      return thinned;
    }
  }
  return [];
}

/**
 * A CUT IS NOT TRUSTED UNTIL IT IS CHECKED AGAINST THE GROUND IT OWED.
 *
 * `geoprocessing.difference` subtracts each mask polygon in turn with a
 * Sutherland-Hodgman routine, which is exact only for a CONVEX clipper. A
 * geological survey's units are not convex, and eighty of them subtracted one
 * after another compound the error: measured on a 47 km clip over Inishowen,
 * subtracting a fine survey that covers 1.5% of the north-west quadrant took
 * 15% of the coarse survey's ground there, and 44% of it across the whole
 * study area. That missing ground was reported three times as "missing
 * polygons", and each time it was this.
 *
 * So the cut is verified rather than believed. Every sampled point that was
 * inside the original and is NOT inside any finer survey is ground the cut
 * OWES back; if the result does not still hold it, the cut is wrong and the
 * feature is kept whole. An exact cut passes and is used, so the convex cases
 * that work keep working -- this only refuses the ones that lose ground.
 *
 * Keeping a feature whole leaves it overlapping the finer survey it should
 * have yielded to, which double-counts that ground in a table or an area sum.
 * That is the lesser fault by a distance: an overlap is visible, listed and
 * argued with, and a hole in a geological map is read as "no data here".
 */
/**
 * A BOUNDARY THAT SEPARATES NOTHING, drawn straight across the map.
 *
 * `subtractPolygons` walks a ring and joins what survives, so where a concave
 * subject is cut into disjoint lobes the pieces are handed back joined by a
 * CHORD — a straight edge through ground that is all one unit. Measured on the
 * 47 km Inishowen clip: unit 3146589, "Proterozoic III quartzite", is a single
 * part of 29 vertices after clipping and comes out of the precedence step as
 * 12 parts and 1,673 vertices carrying a 25.66 km straight edge. Reported as
 * "what's with the strange diagonal line?", and it is also where the export's
 * self-touching rings come from.
 *
 * A real cut boundary SEPARATES COVERED GROUND FROM UNCOVERED: the finer
 * survey lies along one side of it and not the other. A chord separates
 * nothing — step 22 m off it either way and the two sides answer the same,
 * both inside the original and both telling the same story about the finer
 * survey. 22 m clears coordinate noise and stays well inside any unit an edge
 * of this length belongs to.
 *
 * Both directions of "the same" count. A chord through ground no finer survey
 * maps is the obvious one; a chord through ground the finer survey covers on
 * BOTH sides is just as false, and checking only the first left three of them
 * behind in one feature — "Palaeocene undifferentiated", 6 parts and edges of
 * 23.64, 22.17 and 19.78 km, where clipping alone gives one part and 9.4.
 *
 * Only long edges are examined. A short false edge is invisible and there are
 * thousands of honest short ones; a chord is long by construction, since it
 * spans the gap between two lobes of the same polygon.
 */
function introducesFalseBoundary(before, after, finer, minKm = 2) {
  if (!after?.geometry) return false;
  const insideBefore = (p) => GP.polygonsOf(before.geometry)
    .some((rings) => pointInPolygon(p, rings));
  const coveredByFiner = (p) => finer.some((f) =>
    GP.polygonsOf(f.geometry).some((rings) => pointInPolygon(p, rings)));
  const OFFSET = 0.0002;            // about 22 m
  for (const rings of GP.polygonsOf(after.geometry)) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i += 1) {
        const a = ring[i - 1];
        const b = ring[i];
        const midLat = (a[1] + b[1]) / 2;
        const dy = (b[1] - a[1]) * 111.32;
        const dx = (b[0] - a[0]) * 111.32 * Math.cos((midLat * Math.PI) / 180);
        const len = Math.hypot(dx, dy);
        if (len < minKm) continue;
        // The edge's normal, in degrees, so the two probes straddle it.
        const nx = -(b[1] - a[1]);
        const ny = b[0] - a[0];
        const norm = Math.hypot(nx, ny) || 1;
        const mid = [(a[0] + b[0]) / 2, midLat];
        const left = [mid[0] + (nx / norm) * OFFSET, mid[1] + (ny / norm) * OFFSET];
        const right = [mid[0] - (nx / norm) * OFFSET, mid[1] - (ny / norm) * OFFSET];
        if (insideBefore(left) && insideBefore(right)
          && coveredByFiner(left) === coveredByFiner(right)) return true;
      }
    }
  }
  return false;
}

function verdictOnCut(before, after, finer, tolerance = 0.02) {
  const samples = samplePointsInside(before);
  // Nothing to check it with: a sliver too thin to sample. Believe the engine
  // when it returned something, and let it go when it did not.
  if (!samples.length) return after?.geometry ? "cut" : "drop";
  const coveredByFiner = (p) => finer.some((f) =>
    GP.polygonsOf(f.geometry).some((rings) => pointInPolygon(p, rings)));
  // The ground this feature owes nobody: inside it, and inside no finer
  // survey. Whatever the cut returns, it has to still hold all of this.
  const owed = samples.filter((p) => !coveredByFiner(p));
  if (!owed.length) return "drop";                  // mapped in full by finer
  if (!after?.geometry) return "whole";             // deleted, but it owed ground
  const held = owed.filter((p) =>
    GP.polygonsOf(after.geometry).some((rings) => pointInPolygon(p, rings)));
  if ((owed.length - held.length) / owed.length > tolerance) return "whole";
  // The ground is all there and the shape can still be wrong: a cut that draws
  // a boundary through the middle of a unit is refused for the same reason a
  // cut that eats ground is.
  return introducesFalseBoundary(before, after, finer) ? "whole" : "cut";
}

function dropOutranked(features, rankOf, differenceOf) {
  const tiers = [...new Set(features.map((f) => rankOf(f) || 0))].sort((a, b) => b - a);
  if (tiers.length < 2) return features;
  const kept = [];
  const finer = [];
  for (const tier of tiers) {
    const here = features.filter((f) => (rankOf(f) || 0) === tier);
    if (!finer.length) {
      kept.push(...here);
      finer.push(...here);
      continue;
    }
    /**
     * Cut ONE FEATURE AT A TIME, which is what makes the check possible.
     *
     * The engine already loops per feature internally, so this costs nothing
     * it was not doing; what it buys is knowing which input each output came
     * from. In a single call a feature that vanishes simply is not in the
     * result, and "correctly covered in full" and "wrongly deleted" look
     * exactly alike -- which is how a survey lost most of its ground without
     * anything registering as a failure.
     */
    for (const f of here) {
      let cut = null;
      try {
        const answer = differenceOf(
          { type: "FeatureCollection", features: [f] },
          { type: "FeatureCollection", features: finer },
        );
        // A failed or malformed answer must not silently empty the map: only
        // read it when it IS a collection.
        if (!answer || !Array.isArray(answer.features)) { kept.push(f); continue; }
        cut = answer.features.filter((x) => x?.geometry)[0] || null;
      } catch (error) {
        kept.push(f);   // keep the ground rather than lose it
        continue;
      }
      const verdict = verdictOnCut(f, cut, finer);
      if (verdict === "cut") kept.push(cut);
      else if (verdict === "whole") kept.push(f);
      // "drop": the finer surveys map this ground in full, so it goes.
    }
    finer.push(...here);
  }
  return kept;
}

/**
 * SWAP THE TILED PIECES FOR THE UNITS THEMSELVES.
 *
 * The tiles are how we learn WHICH units are on this ground, which they answer
 * cheaply and well. They are not how the units are SHAPED: a tile is a cut of
 * the map, so a unit crossing a tile boundary is delivered as two polygons
 * meeting along a straight edge. Measured on a 45 km study area at zoom 13,
 * that is 417 pieces in a visible lattice — the "one unit split into two" a
 * reader sees as grid lines ruled across the geology.
 *
 * So the ids go to the JSON API and come back as the mapped polygons. Anything
 * the API does not return keeps its tiled version: a seam is a worse answer
 * than the source, and a HOLE is worse than either.
 *
 * The layer is holding borrowed features at this point and `giveBack` puts the
 * live ones back afterwards, so this swap lasts exactly as long as the run.
 */
async function verbatimGeometry(borrowed, box) {
  const layers = (borrowed || []).filter(
    (l) => l?.geologyDataset && Array.isArray(l.features) && l.features.length,
  );
  if (!layers.length) return "";
  const macro = await import(`./macrostrat.js${new URL(import.meta.url).search}`);
  const notes = [];
  for (const layer of layers) {
    const idOf = (f) => f?.properties?.map_id;
    /**
     * Only the units this run can actually use.
     *
     * The borrowed set is the whole fetched study area, and a clip keeps what
     * falls inside one polygon: asking the API for all of it fetched 2,475
     * units to draw 71. The touch test is a bounding box, which is generous on
     * purpose — the clip engine decides what really survives, and over-asking
     * by a little is far cheaper than a missing unit.
     */
    const near = box ? layer.features.filter((f) => touches(f, box)) : layer.features;
    const ids = near.map(idOf).filter((v) => Number.isFinite(Number(v)));
    if (!ids.length) continue;
    let fc = null;
    try {
      fc = await macro.unitsByMapId(ids);
    } catch (error) {
      continue;   // the tiled pieces are still a map
    }
    if (!fc?.features?.length) continue;
    const got = new Set(fc.features.map((f) => String(idOf(f))));
    const kept = layer.features.filter((f) => !got.has(String(idOf(f))));
    const merged = fc.features.concat(kept);
    layer.collection = { type: "FeatureCollection", features: merged };
    layer.features = merged;
    notes.push(`${layer.name}: ${fc.features.length} units at source geometry`
      + (kept.length ? `, ${kept.length} tiled pieces kept.` : "."));
  }
  return notes.length ? ` ${notes.join(" ")}` : "";
}

export async function runToolAuto(toolId, inputs = {}, params = {}, opts = {}) {
  const desc = toolById(toolId);
  if (!desc) return runTool(toolId, inputs, params, opts);
  // Before ANY engine, and before the sidecar decision: a layer that fetches
  // its own features is asked about this run's ground.
  /**
   * A CLIP IS A WINDOW ONTO THE MERGE, not a second streaming map.
   *
   * `clip-stream.js` gave the clipped layer its own tile controller so it
   * would refine like the map it came from. A tile controller draws exactly
   * ONE level, and the answer this source needs is multi-level by
   * construction: `featuresIn` climbs, gates on coverage, and fills each
   * survey from ITS OWN deepest level, so the highest-resolution data over a
   * study area is routinely a mix of surveys taken from different zooms.
   *
   * One level cannot hold that, and every symptom followed from asking it to.
   * Macrostrat's `carto` also SWITCHES between surveys by scale, so the level
   * the clip picked was not merely coarser than the world layer's — it was
   * different geology over identical ground, measured at 21.6% of sampled
   * points matching the map it was cut from.
   *
   * The ordinary path below already does what was wanted: `refreshLiveInputs`
   * fetches the merged, multi-source, multi-level features for the study area,
   * the clip engine cuts them to the polygon, and `inheritedColouring` paints
   * the result from the source's own `color` column — which the streaming path
   * never reached, because it returned before it.
   */
  const { borrowed, box, note: liveNote } = await refreshLiveInputs(desc, inputs, params);
  /**
   * A clip is meant to be the source map inside a polygon, so it is cut from
   * the units themselves rather than from the tiles they were served in.
   */
  const verbatimNote = toolId === "clip" && typeof document !== "undefined"
    ? await verbatimGeometry(borrowed, box).catch(() => "")
    : "";
  /**
   * And every other kind of source is asked the same question.
   *
   * Only when the run HAS a ground to ask about — `box` is the area of
   * interest `refreshLiveInputs` worked out, and with no mask there is nothing
   * to sharpen towards.
   */
  const resolvedInputs = {};
  for (const spec of desc.inputs || []) resolvedInputs[spec.name] = resolveLayer(inputs[spec.name]);
  /**
   * The ground is worked out AGAIN here, and on purpose.
   *
   * `refreshLiveInputs` answers with a box only when some input streams
   * features — it has nothing else to do — so gating the refine on that box
   * meant a run whose only refinable input was an Earth Engine layer or a
   * feature service never got asked. Measured with a stub source through the
   * real clip: `refineFor` called zero times, and the result message silent
   * about it.
   *
   * The area is the same question either way: what do the FIXED inputs cover,
   * the mask being the fixed one in a clip.
   */
  const refinable = Object.values(resolvedInputs)
    .filter((l) => typeof l?.refineFor === "function");
  const refineBox = box
    || (refinable.length
      ? areaOfInterest(Object.values(resolvedInputs).filter(Boolean), refinable)
      : null);
  const refined = [];
  const refinedNote = typeof document !== "undefined"
    ? await refineInputsForArea(resolvedInputs, refineBox, params, refined).catch(() => "")
    : "";
  const note = `${liveNote}${verbatimNote}${refinedNote}`;
  // Whatever was borrowed for this run is given back afterwards, always: a
  // layer left holding one study area's features tells the click picker the
  // rest of the map is not there.
  const giveBack = () => [...borrowed, ...refined]
    .forEach((l) => { try { l.restoreLive?.(); } catch (e) { /* keep */ } });
  // The level shipped rides on the RESULT, or the one fact that decides which
  // map this is stays known only to the fetch that chose it.
  const withNote = (out) => (out && note ? { ...out, message: `${out.message || ""}${note}` } : out);
  if (!desc.engines?.sidecar) {
    try { return withNote(runTool(toolId, inputs, params, opts)); } finally { giveBack(); }
  }
  try {
    return withNote(await runToolAutoInner(desc, toolId, inputs, params, opts));
  } finally { giveBack(); }
}

async function runToolAutoInner(desc, toolId, inputs, params, opts) {

  const resolved = {};
  for (const spec of desc.inputs || []) resolved[spec.name] = resolveLayer(inputs[spec.name]);
  const name = (opts.outputName || "").trim() || resolveOutputName(desc, resolved);

  let why = "";
  try {
    const client = await import("./sidecar-client.js?v=20260903-2983b5d");
    await client.probe();
    const status = client.engineStatus(desc);
    // A tool with no native engine is sidecar-only: size is irrelevant, the
    // sidecar is the only way it runs at all.
    const big = !desc.engines.native || client.shouldOffload(resolved);
    if (status.ok && big) {
      const out = await client.runSidecarEngine(desc, resolved, params, name);
      if (out.ok) {
        // The sidecar builds its own layer, so the inheritance has to be
        // applied on this path too -- otherwise the same clip comes back grey
        // or coloured depending only on how big it was.
        if (out.layer?.features && !desc.paint?.field && typeof document !== "undefined") {
          const inherit = inheritedColouring(resolved, out.layer.features);
          if (inherit) {
            void inheritSourceColours(out.layer, out.layer.features,
              inherit.colourField, inherit.labelField).catch(() => {});
          }
        }
        void appendToolHistory({
          tool: desc.id, label: desc.label,
          inputs: Object.values(resolved).filter(Boolean).map((l) => ({ layerId: l.id, name: l.name })),
          params, output: { name, layerId: out.layer?.id ?? null },
          engine: "sidecar", ok: true, message: out.message, t: Date.now(),
        });
        return out;
      }
      if (!desc.engines.native) return out;   // nothing to fall back to
      why = ` ${out.message} Ran natively instead.`;
    } else if (!status.ok) {
      if (!desc.engines.native) {
        // Sidecar-only and it cannot run: the reason IS the answer.
        return { ok: false, message: status.reason, layer: null, outputType: desc.outputType };
      }
      // Otherwise only worth saying when the job was large enough to matter.
      if (big) why = ` ${status.reason}`;
    }
  } catch (error) {
    if (!desc.engines.native) {
      return { ok: false, message: `The sidecar could not be reached: ${error.message}`, layer: null, outputType: desc.outputType };
    }
    why = ` The sidecar could not be reached (${error.message}); ran natively.`;
  }

  const out = runTool(toolId, inputs, params, { ...opts, outputName: name });
  return why && out.ok ? { ...out, message: `${out.message}${why}` } : out;
}

/**
 * A tool's output, written into the open project as a real dataset.
 *
 * Without this a derived layer has no backing file, so `restoreLayers()` skips
 * it and every analysis result evaporates on reload — the one-way street the
 * plan names. Vector results go out as GeoJSON, rasters as GeoTIFF, both
 * through the SAME writers the export path uses, so a re-imported result is
 * byte-for-byte the layer that was on the globe.
 *
 * Best-effort throughout, like the history write beside it: a full disk or a
 * closed project must never fail the run that produced the layer. The writers
 * and the bridge are pulled in lazily because a page with no project open
 * should not pay for the project store at all.
 */
async function persistDerived(desc, layer, name, record) {
  if (!layer) return null;
  try {
    const bridge = await import("./research/bridge.js?v=20260903-2983b5d");
    if (!bridge.isArmed?.()) return null;
    const provenance = {
      tool: record.tool,
      label: record.label,
      params: record.params,
      inputs: record.inputs,
      engine: record.engine,
      outputType: desc.outputType,
      created_at: new Date(record.t).toISOString(),
    };
    if (desc.outputType === "raster" && layer.raster) {
      const { writeGeoTiff } = await import("./geotiff-writer.js?v=20260903-2983b5d");
      return await bridge.saveProcessed(`${name}.tif`, writeGeoTiff(layer.raster),
        { mime: "image/tiff", provenance });
    }
    if (layer.collection) {
      const { toGeoJson } = await import("./vector-formats.js?v=20260903-2983b5d");
      return await bridge.saveProcessed(`${name}.geojson`, toGeoJson(layer.collection),
        { mime: "application/geo+json", provenance });
    }
    return null;
  } catch (error) {
    console.warn("[GeoID GIS] result not filed in the project", error);
    return null;
  }
}

export async function appendToolHistory(record) {
  const store = window.GeoIDResearch?.store;
  try {
    if (store?.getActive?.()) {
      const list = (await store.readJson(HISTORY_FILE, [])) || [];
      list.push(record);
      await store.writeJson(HISTORY_FILE, list.slice(-STORE_CAP));
      return "project";
    }
  } catch (error) {
    // fall through to the local ring — the record still survives
  }
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY);
    const ring = raw ? JSON.parse(raw) : [];
    ring.push(record);
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(ring.slice(-LOCAL_CAP)));
    return "local";
  } catch (error) {
    return null;
  }
}

/** The run records, newest last — the History tile reads through this. */
export async function readToolHistory() {
  const store = window.GeoIDResearch?.store;
  try {
    if (store?.getActive?.()) {
      const list = await store.readJson(HISTORY_FILE, []);
      if (Array.isArray(list)) return list;
    }
  } catch (error) {
    // fall through to the local ring
  }
  try {
    return JSON.parse(globalThis.localStorage?.getItem(HISTORY_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

// ── The pipeline (spec 1.2): VALIDATE → PROCESS → REGISTER → HISTORY ─────────

/** Publishes an engine's product as a layer through the same path the legacy
    tiles use, so both kinds of output are identical downstream. */
/**
 * A derived layer INHERITS the symbology its input declared.
 *
 * `paintFromSource` marks a layer with the per-feature colour column it is
 * painted from (`sourceColourField`). Without this, a tool output is just a
 * new layer and takes the default `categoricalSymbology`: twelve classes
 * ranked by FEATURE COUNT, everything else one grey "(other)". A map is read
 * by AREA, and on the real Macrostrat tiles over Northern Ireland those two
 * orderings disagree by 13.8% of the mapped ground — 11 units and 572 km2 of
 * 4,146 turned grey, a 240 km2 intrusion among them because it is drawn as
 * only 6 polygons. The clip was faithful and its rendering was not.
 *
 * The features carry the colour through the geoprocessing untouched (measured:
 * 142 of 142 clip outputs keep `properties.color`, 13 distinct), so this needs
 * no lookup back to the input — only its NAME for the column.
 *
 * Best-effort and dynamically imported, for `paintOutput`'s own two reasons: a
 * failed paint must never fail the run that produced the layer, and this
 * runner must stay importable in Node.
 */
async function inheritSourceColours(layer, features, colourField, labelField) {
  const { legendFrom } = await import(`./macrostrat.js${new URL(import.meta.url).search}`);
  layer.repaint?.((feature) => feature?.properties?.[colourField] || null);
  const legend = legendFrom(features, { field: labelField, colourField });
  if (!legend.shown) return;
  layer.legendInfo = legend;
  layer.geologyField = labelField;
  // Carried on, so a clip OF a clip is painted the same way again.
  layer.sourceColourField = colourField;
  layer.sourceLabelField = labelField;
  // The key is twelve rows of however many units there are, and says so --
  // the same honesty the world layer's own card carries.
  layer.legendIsSummary = legend.total > legend.shown
    ? `${legend.shown} of ${legend.total} units` : null;
  window.GeoIDLayerHierarchy?.render?.();
}

/**
 * Which input, if any, declared a per-feature colour column the OUTPUT still
 * carries. Every feature must carry it: a partial column would paint some of
 * the map from the source and leave the rest unpainted, which is worse than
 * either answer on its own.
 */
function inheritedColouring(resolvedInputs, features) {
  for (const layer of Object.values(resolvedInputs || {})) {
    const colourField = layer?.sourceColourField;
    if (!colourField) continue;
    const labelField = layer.sourceLabelField || layer.geologyField || "name";
    if (features.every((f) => f?.properties?.[colourField])) {
      return { colourField, labelField };
    }
  }
  return null;
}

async function paintOutput(layer, paint, fc) {
  const stamp = new URL(import.meta.url).search;
  const dialog = await import(`./symbology-dialog.js${stamp}`);
  const values = [...new Set(fc.features
    .map((f) => f.properties?.[paint.field]).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  if (values.length < 2) return;
  if (!paint.discrete) {
    dialog.paintByRange(layer, paint.field, {
      method: "equal", classes: Math.min(values.length, 12), ramp: paint.ramp || "viridis",
    });
    return;
  }
  const sym = await import(`./symbology.js${stamp}`);
  const overrides = new Map();
  const labels = new Map();
  values.forEach((value, i) => {
    const t = values.length === 1 ? 1 : i / (values.length - 1);
    overrides.set(String(value), sym.hex(sym.rampColour(paint.ramp || "viridis", t)));
    // The band's own span, read off the feature that carries it: "5–15 km"
    // says what the colour means where a bare "15" says only where it ends.
    const carrier = fc.features.find((f) => f.properties?.[paint.field] === value);
    const from = paint.minField ? carrier?.properties?.[paint.minField] : undefined;
    const unit = paint.unit ? ` ${paint.unit}` : "";
    labels.set(String(value), Number.isFinite(from)
      ? `${from}–${value}${unit}` : `${value}${unit}`);
  });
  dialog.paintByField(layer, paint.field, { overrides, labels });
  // Categorical legends order by FREQUENCY; distance bands order by distance.
  const info = layer.legendInfo;
  if (info?.values?.length === values.length) {
    const order = values.map((v) => info.values.indexOf(String(v))).filter((i) => i >= 0);
    if (order.length === values.length) {
      ["palette", "labels", "values", "counts"].forEach((key) => {
        if (Array.isArray(info[key])) info[key] = order.map((i) => info[key][i]);
      });
    }
  }
  window.GeoIDLayerHierarchy?.render?.();
}

function register(desc, raw, name, resolvedInputs = {}) {
  const failShape = (message) => ({ ok: false, message, layer: null, outputType: desc.outputType });
  if (!raw) return failShape("The tool produced nothing.");
  if (raw.ok === false) return { ...raw, layer: null, outputType: desc.outputType };
  const note = raw.note ? ` ${raw.note}` : "";

  if (desc.outputType === "table") {
    const rows = raw.rows || [];
    return {
      ok: true,
      message: `${raw.message || `${rows.length} rows.`}${note}`,
      layer: null,
      outputType: "table",
      rows,
    };
  }
  if (desc.outputType === "raster") {
    const raster = raw.raster || raw;
    const result = buildRasterLayer([raster.band], raster.width, raster.height, raster.bounds, {
      name,
      noData: raster.noData,
      // Only a tool whose OUTPUT is a height may displace the surface. Slope,
      // a susceptibility index and a class map are all single-band numbers and
      // none of them is elevation; displacing them turned a five-class map
      // into a comb of spikes. Tools that do produce heights say so.
      isDem: Boolean(desc.elevationOutput),
    });
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, result, "derived") || null;
    return { ok: true, message: `${name} created.${note}`, layer, outputType: "raster" };
  }
  // vector — including the raster tools whose product is features (contours,
  // raster-to-points): registration keys on the DECLARED outputType.
  const fc = raw.collection || raw;
  if (!fc.features || !fc.features.length) {
    return failShape("Operation produced no features.");
  }
  /**
   * Overlapping surveys are ranked, so the finer one is the map.
   *
   * Only where there is more than one survey to choose between: a single-source
   * layer ranks everything equally and the renderer's ordinary path runs.
   */
  /**
   * What the INPUTS were told about their own surveys' scales, collected from
   * the fetch that produced these features. `register` already holds the
   * resolved inputs for exactly this kind of question.
   */
  const publishedScales = {};
  for (const layer of Object.values(resolvedInputs || {})) {
    const zooms = layer?.lastFetch?.sourceZooms;
    if (!zooms) continue;
    for (const [key, zoom] of Object.entries(zooms)) {
      // The deepest claim wins if two inputs disagree: a survey seen at zoom
      // 13 by one fetch is a zoom-13 survey whatever a shallower look said.
      if (!(key in publishedScales) || zoom > publishedScales[key]) publishedScales[key] = zoom;
    }
  }
  const ranks = surveyRanks(fc.features, Object.keys(publishedScales).length ? publishedScales : null);
  const rankOf = ranks.size > 1
    ? (f) => ranks.get(String(f?.properties?.source_id ?? "")) || 0
    : null;
  /**
   * A coarse polygon a finer survey maps IN FULL is dropped, not merely drawn
   * under. Left in, it stays in the picker, the table, the export and the area
   * sums, and lingers wherever the fine fill does not exactly cover it.
   */
  const shown = rankOf
    ? { ...fc, features: dropOutranked(fc.features, rankOf, GP.difference) }
    : fc;
  /**
   * THE PICKER READS THIS ARRAY IN ORDER, so the finest survey goes first.
   *
   * `featureInLayer` returns the FIRST feature whose polygon contains the
   * point, and `polygonIndex` — the sampler behind extraction and the geology
   * readout — is built from this array in the same order. Left as fetched, a
   * click on ground the fine survey holds returned a regional unit that is not
   * even the one drawn there: reported as selecting "Mesozoic sedimentary
   * rocks", 409 km2 from survey 154, over detailed geology.
   *
   * The draw order is the OPPOSITE — coarse first, so the fine fill lands on
   * top — and the renderer sorts its own iteration for that. So the array is
   * free to carry the order the pickers need, and the two no longer disagree
   * about which survey owns a piece of ground.
   */
  if (rankOf) shown.features.sort((a, b) => rankOf(b) - rankOf(a));
  /**
   * A DERIVED GEOLOGICAL MAP IS DRAWN LIKE THE ONE IT CAME FROM, contacts
   * included.
   *
   * The renderer's default is "match" — every polygon's outline in its own
   * fill colour, which is an outline nobody can see. That is the right default
   * for a catchment or a coastline, and wrong for geology, where the contact
   * IS the information. Measured on a 47 km clip: 4,286 line vertices drawn in
   * #FF9ACC on a #FF9ACC fill, while the world layer beside it inked the same
   * boundaries at #B86790. The lines had been there all along, in the one
   * colour that cannot be seen against what they bound.
   *
   * Taken from the input rather than chosen here, so the panel's contact
   * selector still governs both, the same way the colour column is inherited
   * rather than re-guessed.
   */
  let contacts = null;
  for (const layer of Object.values(resolvedInputs || {})) {
    const style = layer?.tiled?.getContacts?.() ?? layer?.getContacts?.();
    if (style) { contacts = style; break; }
  }
  const result = buildVectorLayerResult(shown, { name, drape: 0.008, rankOf, contacts });
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, result, "derived") || null;
  /**
   * A tool may declare how its output is READ (`paint`), and the multi-ring
   * buffer does. Dynamic import and best-effort, in that order of caution --
   * symbology-dialog is a UI module this runner must not drag into Node, and
   * a failed paint must never fail the run that produced the layer.
   *
   * `discrete: true` means ONE CLASS PER DISTINCT VALUE, categorically. The
   * first version graded with equal-interval classes, which is only one
   * class per band when the distances are evenly spaced: asked for
   * "5, 15, 40" km it put the 5 and 15 km bands under one colour while the
   * legend claimed three, and left a class ("16.67–28.33") that no band was
   * in at all. Bands are categories that happen to be numbers; classing them
   * as a continuum is a different statement about the data. Each band is
   * coloured by its RANK along the ramp (so near-to-far still reads as a
   * sequence), labelled with its own span ("5–15 km"), and the legend is
   * re-sorted by distance -- categorical legends order by frequency, which
   * for rings is meaningless.
   */
  if (layer && typeof document !== "undefined") {
    // A tool that declares how its own output is read wins: it is describing a
    // value it computed, where the inheritance below is carrying a value the
    // input already had.
    if (desc.paint?.field) {
      void paintOutput(layer, desc.paint, fc).catch(() => {});
    } else {
      /**
       * THE LEGEND DESCRIBES THE FEATURES THE LAYER KEPT, not the ones fetched.
       *
       * `dropOutranked` removes every coarse polygon a finer survey maps in
       * full, and this read `fc.features` — the set BEFORE that cut. So the
       * key named units the map does not contain: measured on a 52 km clip,
       * 4 of its 12 rows were regional units ("Cenozoic volcanic rocks",
       * "Mesozoic sedimentary rocks", "Paleozoic sedimentary rocks",
       * "Precambrian-Phanerozoic crystalline metamorphic rocks") that had
       * been dropped, and the summary claimed "12 of 27 units" over a layer
       * holding 23. Worse, those ghosts took four of the twelve places, so
       * four units that ARE on the map had no row.
       *
       * It presents as a round trip losing the legend — an export carries the
       * features, so a re-import's key lists the units that are really there
       * and disagrees with the source's. The source was the wrong one.
       *
       * The sidecar path above already reads `out.layer.features` for exactly
       * this reason; this is the same rule on the native path.
       */
      const inherit = inheritedColouring(resolvedInputs, shown.features);
      if (inherit) {
        void inheritSourceColours(layer, shown.features, inherit.colourField, inherit.labelField)
          .catch(() => {});
      }
    }
  }
  return { ok: true, message: `${name}: ${shown.features.length} features.${note}`, layer, outputType: "vector" };
}

/**
 * Runs a tool by id. `inputs` maps input names to layer records or layer ids;
 * `params` maps param names to values (missing ones take descriptor defaults).
 * Returns { ok, message, layer, outputType } — the layer record is what makes
 * one-click chaining possible. Synchronous, like the engines; the history
 * write behind it is async and fire-and-forget.
 *
 * A VALIDATE rejection returns before PROCESS and writes no history — a run
 * that never started is not a run. Everything that reaches the engine is
 * recorded, successes and failures alike, because `ok` is a field of the
 * record, not a precondition for one.
 */
export function runTool(toolId, inputs = {}, params = {}, { outputName } = {}) {
  const desc = toolById(toolId);
  if (!desc) {
    return { ok: false, message: `Unknown tool "${toolId}".`, layer: null, outputType: null };
  }
  const fail = (message) => ({ ok: false, message, layer: null, outputType: desc.outputType });

  // VALIDATE — every declared input present and of its declared type.
  const resolvedInputs = {};
  for (const spec of desc.inputs) {
    const layer = resolveLayer(inputs[spec.name]);
    if (!layer) {
      if (spec.optional) {
        resolvedInputs[spec.name] = null;
        continue;
      }
      return fail(`${spec.label} is required.`);
    }
    if (!matchesType(layer, spec.type)) {
      return fail(`${spec.label} must be a ${spec.type} layer.`);
    }
    /**
     * A self-rebuilding layer that currently holds NOTHING is refused here
     * rather than run.
     *
     * Its `collection` is a snapshot of what was on screen when it last
     * rebuilt itself, so an empty one means "the camera is elsewhere", not
     * "this ground has no geology" — and running anyway produces a confident
     * empty answer, which is the worst of the three possible outcomes.
     * `runToolAuto` fetches the right ground first; this is the path that did
     * not, and it says so instead of guessing.
     */
    if (typeof layer.featuresIn === "function" && !layer.collection?.features?.length) {
      return fail(`${layer.name} holds no features for this view yet — `
        + "run it from the tools window, which fetches the ground the run is about.");
    }
    resolvedInputs[spec.name] = layer;
  }

  // VALIDATE — params coerced and range-checked.
  const resolvedParams = {};
  for (const p of desc.params) {
    const given = params[p.name];
    let value = given === undefined || given === null || given === "" ? p.default : given;
    if (p.kind === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) return fail(`${p.label} must be a number.`);
      if (p.min !== undefined && value < p.min) return fail(`${p.label} must be at least ${p.min}.`);
      if (p.max !== undefined && value > p.max) return fail(`${p.label} must be at most ${p.max}.`);
    } else if (p.kind === "select") {
      /**
       * Options come in two shapes — `{ id, name }` and `{ value, label }` —
       * and the DIALOG renders both (`option.value ?? option.id`). This
       * validation accepted only `id`, so a tool declared the other way could
       * never pass it: mosaic refused every choice INCLUDING ITS OWN DEFAULT,
       * from any UI, since the day it shipped. Found by the dialog sweep;
       * the registry keeps both spellings because either alone means editing
       * tools that already work.
       */
      if (!(p.options || []).some((o) => (o.id ?? o.value) === value)) {
        return fail(`${p.label}: pick one of the listed options.`);
      }
    } else if (p.kind === "field") {
      // An OPTIONAL field left blank means "the whole layer": dissolve with
      // no group column merges everything into one, which is the commonest
      // reason anyone opens it. A required one still refuses.
      if (!value || typeof value !== "string") {
        if (p.optional) { resolvedParams[p.name] = ""; continue; }
        return fail(`${p.label} is required.`);
      }
      // When the input layer declares its fields, an unknown name is a typo,
      // not a request — GP.dissolve would otherwise group everything under
      // `undefined` and report success.
      const host = resolvedInputs[p.of || desc.inputs[0]?.name];
      const fields = host?.info?.fields;
      if (Array.isArray(fields) && fields.length && !fields.includes(value)) {
        return fail(`"${value}" is not a field of ${host.name}.`);
      }
    } else if (p.kind === "checkbox") {
      value = Boolean(value);
    } else {
      value = value === undefined || value === null ? "" : String(value);
    }
    resolvedParams[p.name] = value;
  }

  const name = (outputName || "").trim() || resolveOutputName(desc, resolvedInputs);

  // PROCESS + REGISTER. Errors keep the current contract: status text
  // "Failed: <message>", console.error("[GeoID GIS] ...").
  let out;
  try {
    out = register(desc, desc.engines.native(resolvedInputs, resolvedParams), name, resolvedInputs);
  } catch (error) {
    console.error(`[GeoID GIS] ${desc.label} failed`, error);
    out = fail(`Failed: ${error.message}`);
  }

  // HISTORY — spec 1.3 record shape, fire-and-forget.
  const record = {
    tool: desc.id,
    label: desc.label,
    inputs: desc.inputs
      .map((spec) => resolvedInputs[spec.name])
      .filter(Boolean)
      .map((l) => ({ layerId: l.id, name: l.name })),
    params: resolvedParams,
    output: { name, layerId: out.layer?.id ?? null },
    engine: "native",
    ok: out.ok,
    message: out.message,
    t: Date.now(),
  };
  void appendToolHistory(record);

  // REGISTER — the result becomes a dataset of the project, so it survives a
  // reload and carries its lineage. Fire-and-forget for the same reason as
  // history: the layer is already on the globe and must stay there whatever
  // the filesystem says.
  if (out.ok) void persistDerived(desc, out.layer, name, record);

  // Say so when the result is only in memory. A layer that will vanish on the
  // next reload must not look identical to one that was filed.
  if (out.ok && !window.GeoIDResearch?.store?.getActive?.()) {
    return { ...out, message: `${out.message} In memory — open a project to keep it.`, unsaved: true };
  }
  return out;
}

/** Exported for the tests. */
export const __surveyRanks = surveyRanks;
export const __dropOutranked = dropOutranked;
/** Exported for the tests: the box vocabularies must both work. */
export const __touches = touches;
