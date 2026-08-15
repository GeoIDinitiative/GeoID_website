import * as GP from "./geoprocessing.js?v=20260815-cb9ed4b";
import * as RA from "./raster-analysis.js?v=20260815-cb9ed4b";
import { buildVectorLayerResult } from "./vector-render.js?v=20260815-cb9ed4b";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260815-cb9ed4b";
import { CRS_OPTIONS } from "./projection.js?v=20260815-cb9ed4b";

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
    ],
    outputType: "vector",
    outputName: "buffer_{input}",
    engines: { native: (i, p) => GP.buffer(i.input.collection, p.distance) },
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
    engines: { native: (i) => RA.slope(i.input.raster) },
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
    engines: { native: (i) => RA.aspect(i.input.raster) },
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
    engines: { native: (i) => RA.hillshade(i.input.raster) },
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
    label: "Reclassify (above/below)",
    category: "Surface analysis",
    blurb: "Split a raster at a threshold: cells become 0 below it and 1 at or above it.",
    keywords: ["threshold", "binary", "classify", "split"],
    inputs: [{ name: "input", label: "Input", type: "raster" }],
    params: [
      { name: "threshold", label: "Threshold", kind: "number", default: 1000, step: 100 },
    ],
    outputType: "raster",
    outputName: "reclass_{input}",
    engines: {
      native: (i, p) => RA.reclassify(i.input.raster,
        [[-Infinity, p.threshold, 0], [p.threshold + 1e-9, Infinity, 1]]),
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
        if (other && (other.raster.width !== i.input.raster.width
          || other.raster.height !== i.input.raster.height)) {
          return {
            ok: false,
            message: `Rasters differ in shape (${i.input.raster.width}x${i.input.raster.height} vs `
              + `${other.raster.width}x${other.raster.height}) — resample first.`,
          };
        }
        const res = RA.rasterCalculator(i.input.raster, other?.raster || null, p.expression || "a");
        if (!res.ok) return res;
        return { raster: res.raster };
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
  const name = String(desc.outputName)
    .replaceAll("{input}", base)
    .replaceAll("{tool}", desc.id || "tool");
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
      name, noData: raster.noData, isDem: true,
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
      const host = resolvedInputs[desc.inputs[0]?.name];
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

  return out;
}
