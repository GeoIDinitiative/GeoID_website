import * as GP from "./geoprocessing.js?v=20260818-d95b0ab";
import * as RA from "./raster-analysis.js?v=20260818-d95b0ab";
import { buildVectorLayerResult } from "./vector-render.js?v=20260818-d95b0ab";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260818-d95b0ab";
import { CRS_OPTIONS } from "./projection.js?v=20260818-d95b0ab";
import * as IN from "./interpolation.js?v=20260818-d95b0ab";
import * as VAL from "./validation.js?v=20260818-d95b0ab";
import * as EX from "./analysis-extra.js?v=20260818-d95b0ab";
import * as HY from "./hydrology.js?v=20260818-d95b0ab";
import * as KR from "./kriging.js?v=20260818-d95b0ab";

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

export const TOOLS = [
  // ── Vector geoprocessing (the legacy VECTOR_OPS table, one row each) ──────
  {
    id: "buffer",
    label: "Buffer",
    category: "Vector geoprocessing",
    blurb: "Grow each feature outward by a distance in metres; overlaps dissolve.",
    keywords: ["distance", "offset", "grow", "ring", "zone"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [
      { name: "distance", label: "Distance (m)", kind: "number", default: 1000, step: 100, min: 0.001 },
      { name: "dissolve", label: "Merge overlapping buffers", kind: "checkbox", default: true },
    ],
    outputType: "vector",
    outputName: "buffer_{input}",
    engines: { native: (i, p) => GP.buffer(i.input.collection, p.distance, { dissolve: p.dissolve !== false }) },
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
    params: [],
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
    label: "Dissolve by field",
    category: "Vector geoprocessing",
    blurb: "Merge features that share a value in a field into one multi-part feature.",
    keywords: ["merge", "aggregate", "group", "combine"],
    inputs: [{ name: "input", label: "Input", type: "vector" }],
    params: [{ name: "field", label: "Field", kind: "field" }],
    outputType: "vector",
    outputName: "dissolve_{input}",
    engines: { native: (i, p) => GP.dissolve(i.input.collection, p.field) },
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
      // The default is the NI methodology's slope classes — a working example
      // that teaches the syntax at the same time.
      { name: "rules", label: "Rules (min..max:class)", kind: "text",
        default: "0..2:1, 2..5:2, 5..15:3, 15..35:4, 35..90:5" },
    ],
    outputType: "raster",
    outputName: "reclass_{input}",
    engines: {
      native: (i, p) => {
        const parsed = RA.parseReclassifyRules(p.rules);
        if (!parsed.ok) return parsed;
        const out = RA.reclassify(i.input.raster, parsed.rules);
        const stats = RA.rasterStatistics(out);
        if (!stats.count) {
          return { ok: false, message: "No cell matched any rule — check the ranges against the data." };
        }
        return { raster: out, note: `${parsed.rules.length} rules, ${stats.count} cells classified.` };
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
    blurb: "Burn a numeric attribute of a vector layer into a raster grid — geology scores become cells.",
    keywords: ["burn", "vector", "convert", "attribute", "geology"],
    inputs: [
      { name: "input", label: "Grid to match", type: "raster" },
      { name: "features", label: "Vector layer", type: "vector" },
    ],
    params: [
      { name: "field", label: "Attribute", kind: "field", of: "features" },
    ],
    outputType: "raster",
    outputName: "rasterize_{features}",
    engines: {
      native: (i, p) => {
        const out = RA.rasterizeByAttribute(i.features.collection, p.field, i.input.raster);
        const stats = RA.rasterStatistics(out);
        if (!stats.count) {
          return {
            ok: false,
            message: `No cell took a value — is "${p.field}" numeric where the polygons overlap this raster?`,
          };
        }
        return { raster: out, note: `${stats.count} cells burned from "${p.field}".` };
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
    blurb: "Label every cell with the outlet it drains to — catchment boundaries without drawing one.",
    keywords: ["catchment", "basin", "divide", "drainage", "hydrology", "outlet"],
    inputs: [{ name: "input", label: "DEM", type: "raster" }],
    params: [],
    outputType: "raster",
    outputName: "basins_{input}",
    engines: {
      native: (i, p) => {
        const out = HY.watershed(i.input.raster, Number(p.lat), Number(p.lon));
        return out.ok ? out.raster : { ok: false, message: out.message };
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
    ],
    outputType: "raster",
    outputName: "viewshed_{input}",
    engines: {
      native: (i, p) => {
        const out = HY.viewshed(i.input.raster, Number(p.lat), Number(p.lon), {
          observerHeight: Number(p.observerHeight) || 1.7,
          radiusKm: Number(p.radiusKm) || 10,
        });
        return out.ok ? out.raster : { ok: false, message: out.message };
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
        const out = KR.krigeGrid(points, bounds, {
          cellSizeDeg: Number(p.cellSizeDeg) || 0.01,
        });
        if (!out.ok) return { ok: false, message: out.message };
        return RA.makeRaster(out.values, out.width, out.height, out.bounds, NaN);
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
    outputType: "table",
    outputName: "zonal_{input}",
    engines: {
      native: (i) => {
        const results = RA.zonalStatistics(i.input.raster, i.zones.collection);
        const withData = results.filter((r) => r.count > 0);
        if (!withData.length) {
          return { ok: false, message: "No raster cells fell inside those zones." };
        }
        const rows = withData.map((r) => ({
          ...r.properties, cells: r.count, min: r.min, max: r.max,
          mean: Number(r.mean.toFixed(3)), sum: Number(r.sum.toFixed(3)),
          std_dev: Number(r.stdDev.toFixed(3)),
          centroid_fallback: r.centroidFallback ? "yes" : "",
        }));
        const fallbacks = withData.filter((r) => r.centroidFallback).length;
        const first = withData[0];
        return {
          rows,
          message: `${withData.length} zones. First: ${first.count} cells, mean ${first.mean.toFixed(1)}.`
            + (fallbacks ? ` ${fallbacks} zones smaller than a cell used centroid sampling.` : ""),
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
      { name: "field", label: "Outcome field (blank = all are occurrences)", kind: "field" },
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
        const roc = VAL.rocCurve(pairs);
        if (!roc.ok) return { ok: false, message: roc.message };
        const best = VAL.bestThreshold(pairs);
        return {
          rows: roc.points.map((pt) => ({
            threshold: Number.isFinite(pt.score) ? Number(pt.score.toFixed(4)) : "",
            false_positive_rate: pt.fpr, true_positive_rate: pt.tpr,
          })),
          message: `AUC ${roc.auc} over ${roc.positives} occurrences and ${roc.negatives} `
            + `non-occurrences. Best split at ${Number(best.threshold).toFixed(3)} `
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
      { name: "field", label: "Outcome field", kind: "field" },
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
export function layersByType(type) {
  const all = window.GeoIDImportManager?.getLayers?.() || [];
  const loaded = all.filter((l) => l.status === "loaded");
  if (type === "vector") return loaded.filter((l) => l.collection);
  if (type === "raster") return loaded.filter((l) => l.raster);
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
export async function runToolAuto(toolId, inputs = {}, params = {}, opts = {}) {
  const desc = toolById(toolId);
  if (!desc?.engines?.sidecar) return runTool(toolId, inputs, params, opts);

  const resolved = {};
  for (const spec of desc.inputs || []) resolved[spec.name] = resolveLayer(inputs[spec.name]);
  const name = (opts.outputName || "").trim() || resolveOutputName(desc, resolved);

  let why = "";
  try {
    const client = await import("./sidecar-client.js?v=20260818-d95b0ab");
    await client.probe();
    const status = client.engineStatus(desc);
    // A tool with no native engine is sidecar-only: size is irrelevant, the
    // sidecar is the only way it runs at all.
    const big = !desc.engines.native || client.shouldOffload(resolved);
    if (status.ok && big) {
      const out = await client.runSidecarEngine(desc, resolved, params, name);
      if (out.ok) {
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
    const bridge = await import("./research/bridge.js?v=20260818-d95b0ab");
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
      const { writeGeoTiff } = await import("./geotiff-writer.js?v=20260818-d95b0ab");
      return await bridge.saveProcessed(`${name}.tif`, writeGeoTiff(layer.raster),
        { mime: "image/tiff", provenance });
    }
    if (layer.collection) {
      const { toGeoJson } = await import("./vector-formats.js?v=20260818-d95b0ab");
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
function register(desc, raw, name) {
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
  const result = buildVectorLayerResult(fc, { name, drape: 0.008 });
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, result, "derived") || null;
  return { ok: true, message: `${name}: ${fc.features.length} features.${note}`, layer, outputType: "vector" };
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
      if (!(p.options || []).some((o) => o.id === value)) {
        return fail(`${p.label}: pick one of the listed options.`);
      }
    } else if (p.kind === "field") {
      if (!value || typeof value !== "string") return fail(`${p.label} is required.`);
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
    out = register(desc, desc.engines.native(resolvedInputs, resolvedParams), name);
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
