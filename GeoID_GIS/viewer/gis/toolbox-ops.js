import * as GP from "./geoprocessing.js?v=20260902-792d638";
import * as RA from "./raster-analysis.js?v=20260902-792d638";
import * as VF from "./vector-formats.js?v=20260902-792d638";
import { buildVectorLayerResult } from "./vector-render.js?v=20260902-792d638";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260902-792d638";
import { downloadText } from "./extraction.js?v=20260902-792d638";
import { CRS_OPTIONS } from "./projection.js?v=20260902-792d638";
import { runQuery, QUERY_HELP } from "./query.js?v=20260902-792d638";
import { selection } from "./selection.js?v=20260902-792d638";

// Wiring between the toolbox UI and the geoprocessing / raster engines. Every
// operation produces a new layer rather than mutating its input, which is how
// QGIS and ArcGIS model processing output and keeps results reversible.

function layers() {
  return window.GeoIDImportManager?.getLayers?.() || [];
}

function vectorLayers() {
  return layers().filter((layer) => layer.status === "loaded" && layer.collection);
}

function rasterLayers() {
  return layers().filter((layer) => layer.status === "loaded" && layer.raster);
}

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const node = byId(id);
  if (node) {
    node.textContent = text;
  }
}

// Note: these option accessors must not be named `valueOf`/`toString` — those
// are inherited from Object.prototype, so a destructuring default would never
// apply and the inherited method would be called unbound instead.
function fillSelect(select, items, { getValue = (i) => i.id, getLabel = (i) => i.name } = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  if (!items.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None available";
    select.appendChild(opt);
    return;
  }
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = getLabel(item);
    select.appendChild(opt);
  });
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

function selectedLayer(selectId, pool) {
  const id = byId(selectId)?.value;
  return pool.find((layer) => String(layer.id) === id) || null;
}

/** Adds a derived FeatureCollection to the scene as a new layer. */
function publishVector(fc, name, { drape = 0.008 } = {}) {
  if (!fc.features.length) {
    return { ok: false, message: "Operation produced no features." };
  }
  const result = buildVectorLayerResult(fc, { name, drape });
  window.GeoIDImportManager.addDerivedLayer(name, result, "derived");
  return { ok: true, message: `${name}: ${fc.features.length} features.` };
}

/** Same shape AND same bounds — equal dimensions over different ground is
 *  still a mismatch, and the silent kind. */
function gridsMatch(a, b) {
  return a.width === b.width && a.height === b.height
    && a.bounds.minX === b.bounds.minX && a.bounds.maxX === b.bounds.maxX
    && a.bounds.minY === b.bounds.minY && a.bounds.maxY === b.bounds.maxY;
}

function publishRaster(raster, name, { elevation = false } = {}) {
  const result = buildRasterLayer([raster.band], raster.width, raster.height, raster.bounds, {
    // Flat unless the caller says the values ARE heights: an index or a class
    // map displaced by its own value reads as a field of spikes rather than a
    // map (see geotiff-adapter's looksLikeHeightField).
    name, noData: raster.noData, isDem: elevation,
  });
  window.GeoIDImportManager.addDerivedLayer(name, result, "derived");
  return { ok: true, message: `${name} created.` };
}

// ── Vector operations ───────────────────────────────────────────────────────

/**
 * THE GEOPROCESSING PANEL RUNS THE SAME TOOLS THE TOOLS WINDOW DOES.
 *
 * These operations and `tool-runner.js`'s registry are the same work under the
 * same ids — `clip`, `difference`, `intersect`, `union`, `buffer`, `dissolve`
 * — and `clip` is even labelled "Clip by layer" in both. Two implementations
 * of one operation, and they drifted exactly as this file's history predicts:
 * every fix to the tool-runner clip over the last stretch (asking a streaming
 * layer about GROUND rather than reading its snapshot, inheriting the source's
 * own colours and legend, the Detail level, the self-refining output) went to
 * the tools window while the panel went on calling `GP.clip(a.collection, ...)`
 * directly. Reported as fix after fix making no difference — and it made none,
 * because this button never ran any of it.
 *
 * So the ops that CAN delegate, do. The panel keeps its own front end; only
 * the work moves. `runToolAuto` is dynamically imported because this module
 * loads on every world at boot and the runner drags in the whole tool set.
 *
 * Audited in full: **26 of 26** panel ops exist in the runner and NONE is
 * panel-only, so the runner is a strict superset — 22 further tools, sidecar
 * engines, more params, and the structural tests that pin them. Where the
 * panel looked richer it was not: `spatialJoin`'s "N matched", `reproject`'s
 * same-CRS refusal and `contours` deriving its levels from the raster's own
 * statistics are all in the runner too. So 25 of the 26 delegate.
 *
 * Two do NOT, each for a stated reason rather than by omission:
 *   `union`   adds a sentence when a ring-level merge fills an interior ring,
 *             which the runner does not say.
 *   `overlay` builds its weight entries from SEVERAL layers by name out of one
 *             text field; the tool takes a weights string against its declared
 *             inputs, and the two are not the same control.
 * Those two still read `.collection`, so they still see a streaming layer's
 * snapshot. That is the remaining duplication, and it is written down rather
 * than left to be rediscovered.
 *
 * The one conversion worth naming: `buffer` asks METRES here and KILOMETRES in
 * the tool, so it is delegated with `param / 1000`. Handing it over unconverted
 * would turn a 1 km buffer into 1,000 km.
 */
const DELEGATED = new Set([
  "buffer", "clip", "difference", "intersect", "dissolve", "hull", "centroids",
  "simplify", "reproject", "spatialJoin",
  "slope", "aspect", "hillshade", "curvature", "roughness", "resample",
  "distance", "clipByPolygon", "contours", "focal", "reclassify", "calculator",
  "rasterize", "samplePoints", "toPoints",
]);

async function runThroughRunner(toolId, a, b, params = {}) {
  const runner = await import(`./tool-runner.js${new URL(import.meta.url).search}`);
  const desc = runner.toolById(toolId);
  const names = (desc.inputs || []).map((i) => i.name);
  const inputs = {};
  if (names[0]) inputs[names[0]] = a;
  if (names[1] && b) inputs[names[1]] = b;
  return (runner.runToolAuto || runner.runTool)(toolId, inputs, params, {});
}

/**
 * The raster panel offers TWO kinds of second input — another raster
 * (`ras-op-b`) and a vector layer of zones (`ras-op-zones`) — in two different
 * controls, while the runner declares which kind each tool wants. Reading that
 * declaration is what stops a zones tool being handed a raster: picking by the
 * op's name would be a third list to keep in step with the other two.
 */
async function runRasterThroughRunner(toolId, layer, extras, params = {}) {
  const runner = await import(`./tool-runner.js${new URL(import.meta.url).search}`);
  const second = runner.toolById(toolId)?.inputs?.[1];
  const other = !second ? null
    : (second.type === "vector" || second.type === "sampled" ? extras.zones : extras.b);
  return runThroughRunner(toolId, layer, other, params);
}

const VECTOR_OPS = {
  buffer: {
    label: "Buffer",
    needsSecond: false,
    param: { label: "Distance (m)", value: 1000, step: 100 },
    // Merging is the right default (QGIS's too), but per-feature rings are a
    // real product — service areas around individual sites — so it is a choice.
    check: { label: "Merge overlapping buffers", value: true },
    // metres HERE, kilometres in the tool -- the conversion is the whole
    // reason this one could not simply be pointed at the runner.
    run: (a, _b, param, _field, extras) => runThroughRunner("buffer", a, null, {
      distance: param / 1000, dissolve: extras.check !== false,
    }),
  },
  clip: {
    label: "Clip by layer",
    needsSecond: true,
    run: (a, b) => runThroughRunner("clip", a, b),
  },
  difference: {
    label: "Difference",
    needsSecond: true,
    run: (a, b) => runThroughRunner("difference", a, b),
  },
  intersect: {
    label: "Intersect",
    needsSecond: true,
    run: (a, b) => runThroughRunner("intersect", a, b),
  },
  dissolve: {
    label: "Dissolve by field",
    needsSecond: false,
    usesField: true,
    run: (a, _b, _param, field) => runThroughRunner("dissolve", a, null, { field }),
  },
  hull: {
    label: "Convex hull",
    needsSecond: false,
    run: (a) => runThroughRunner("hull", a),
  },
  centroids: {
    label: "Centroids",
    needsSecond: false,
    run: (a) => runThroughRunner("centroids", a),
  },
  simplify: {
    label: "Simplify",
    needsSecond: false,
    // Metres, not degrees: a degree is 111 km at the equator and 20 km at 80°
    // north, so the old unit simplified a dataset harder at one end than the
    // other and had no meaning anyone could reason about. 100 m is a sane
    // default for coastline-scale data.
    param: { label: "Tolerance (m)", value: 100, step: 10 },
    run: (a, _b, param) => runThroughRunner("simplify", a, null, { tolerance: param }),
  },
  union: {
    label: "Union (merge layers)",
    needsSecond: true,
    run: (a, b) => {
      const merged = GP.union(a.collection, b.collection);
      const result = publishVector(merged, `union_${a.name}`);
      // A donut input cannot keep its hole through a ring-level merge; saying
      // so beats a quietly solid result.
      if (result.ok && merged.holesDropped) {
        return { ...result, message: `${result.message} Interior rings were filled by the merge.` };
      }
      return result;
    },
  },
  reproject: {
    label: "Reproject (CRS)",
    needsSecond: false,
    crs: true,
    run: (a, _b, _param, _field, extras) => {
      // The empty-select guard stays here: the runner cannot know that this
      // panel has two dropdowns one of which nobody has touched.
      if (!extras.fromCrs || !extras.toCrs) {
        return { ok: false, message: "Pick both coordinate systems." };
      }
      return runThroughRunner("reproject", a, null,
        { fromCrs: extras.fromCrs, toCrs: extras.toCrs });
    },
  },
  spatialJoin: {
    label: "Spatial join",
    needsSecond: true,
    run: (a, b) => runThroughRunner("spatialJoin", a, b),
  },
};

function currentVectorOp() {
  return VECTOR_OPS[byId("vec-op")?.value] || VECTOR_OPS.buffer;
}

function syncVectorOpInputs() {
  const op = currentVectorOp();
  const secondRow = byId("vec-op-second-row");
  const paramRow = byId("vec-op-param-row");
  const fieldRow = byId("vec-op-field-row");
  const crsRow = byId("vec-op-crs-row");
  const checkRow = byId("vec-op-check-row");
  if (secondRow) secondRow.hidden = !op.needsSecond;
  if (fieldRow) fieldRow.hidden = !op.usesField;
  if (checkRow) {
    checkRow.hidden = !op.check;
    if (op.check) {
      byId("vec-op-check-label").textContent = op.check.label;
      const box = byId("vec-op-check");
      if (box && !box.dataset.touched) box.checked = op.check.value;
    }
  }
  if (crsRow) {
    crsRow.hidden = !op.crs;
    // Filled here rather than in refreshToolboxSelects: the CRS list is
    // static, so filling it once when first shown is enough, and the "none"
    // entry (not georeferenced) is not a thing a reprojection can mean.
    const from = byId("vec-op-crs-from");
    if (op.crs && from && !from.options.length) {
      const options = CRS_OPTIONS.filter((c) => c.id !== "none");
      fillSelect(from, options, { getLabel: (c) => c.name });
      fillSelect(byId("vec-op-crs-to"), options, { getLabel: (c) => c.name });
    }
  }
  if (paramRow) {
    paramRow.hidden = !op.param;
    if (op.param) {
      byId("vec-op-param-label").textContent = op.param.label;
      const input = byId("vec-op-param");
      input.step = String(op.param.step);
      if (!input.dataset.touched) {
        input.value = String(op.param.value);
      }
    }
  }
  const layer = selectedLayer("vec-op-a", vectorLayers());
  fillSelect(byId("vec-op-field"), (layer?.info?.fields || []).map((f) => ({ id: f, name: f })));
}

function runVectorOp() {
  const op = currentVectorOp();
  const a = selectedLayer("vec-op-a", vectorLayers());
  const b = op.needsSecond ? selectedLayer("vec-op-b", vectorLayers()) : null;
  if (!a) {
    setText("vec-op-status", "Select an input layer.");
    return;
  }
  if (op.needsSecond && !b) {
    setText("vec-op-status", "This tool needs a second layer.");
    return;
  }
  const param = Number(byId("vec-op-param")?.value);
  const field = byId("vec-op-field")?.value;
  const extras = {
    fromCrs: byId("vec-op-crs-from")?.value,
    toCrs: byId("vec-op-crs-to")?.value,
    check: byId("vec-op-check")?.checked,
  };
  setText("vec-op-status", `Running ${op.label}...`);
  window.requestAnimationFrame(() => {
    // An op may answer with a result or with a PROMISE of one: the delegated
    // ones go through `runToolAuto`, which is async because a streaming input
    // is asked about this run's ground before any engine sees it. Resolving
    // either shape here is what lets the two kinds sit in one registry.
    try {
      Promise.resolve(op.run(a, b, param, field, extras)).then((result) => {
        setText("vec-op-status", result?.message || "Done.");
      }).catch((error) => {
        console.error("[GeoID GIS] vector op failed", error);
        setText("vec-op-status", `Failed: ${error.message}`);
      });
    } catch (error) {
      console.error("[GeoID GIS] vector op failed", error);
      setText("vec-op-status", `Failed: ${error.message}`);
    }
  });
}

// ── Raster operations ───────────────────────────────────────────────────────

const RASTER_OPS = {
  slope: { label: "Slope (degrees)", run: (r) => runThroughRunner("slope", r) },
  aspect: { label: "Aspect", run: (r) => runThroughRunner("aspect", r) },
  hillshade: { label: "Hillshade", run: (r) => runThroughRunner("hillshade", r) },
  curvature: {
    label: "Curvature",
    run: (r) => runThroughRunner("curvature", r),
  },
  roughness: {
    label: "Roughness",
    run: (r) => runThroughRunner("roughness", r),
  },
  focal: {
    label: "Focal statistics",
    param: { label: "Radius (cells)", value: 1, step: 1 },
    text: { label: "Statistic (mean/min/max/sum/range/std)", value: "mean" },
    run: (r, _n, param, extras) => runThroughRunner("focal", r, null,
      { radius: param, stat: extras.text || "mean" }),
  },
  contours: {
    label: "Contours",
    param: { label: "Interval", value: 250, step: 50 },
    run: (r, _n, param) => runThroughRunner("contours", r, null, { interval: param }),
  },
  reclassify: {
    label: "Reclassify (rules)",
    // The default rules are the NI methodology's slope classes — a working
    // example that teaches the syntax at the same time.
    text: { label: "Rules (min..max:class)", value: "0..2:1, 2..5:2, 5..15:3, 15..35:4, 35..90:5" },
    run: (r, _n, _param, extras) => runRasterThroughRunner("reclassify", r, extras,
      { rules: extras.text }),
  },
  calculator: {
    label: "Raster calculator",
    needsSecond: true,
    text: { label: "Expression", value: "(a - b) / (a + b)" },
    run: (r, _n, _param, extras) => runRasterThroughRunner("calculator", r, extras,
      { expression: extras.text || "a" }),
  },
  resample: {
    label: "Resample to grid",
    needsSecond: true,
    run: (r, _n, _param, extras) => runRasterThroughRunner("resample", r, extras),
  },
  distance: {
    label: "Distance to features (m)",
    zones: true,
    zonesLabel: "Features",
    run: (r, _n, _param, extras) => runRasterThroughRunner("distance", r, extras),
  },
  rasterize: {
    label: "Rasterize (vector → raster)",
    zones: true,
    zonesLabel: "Vector layer",
    usesField: true,
    run: (r, _n, _param, extras) => runRasterThroughRunner("rasterize", r, extras,
      { field: extras.field }),
  },
  samplePoints: {
    label: "Sample raster at points",
    zones: true,
    zonesLabel: "Points",
    text: { label: "New attribute name", value: "sampled" },
    run: (r, _n, _param, extras) => runRasterThroughRunner("samplePoints", r, extras,
      { attr: extras.text || "sampled" }),
  },
  overlay: {
    label: "Weighted overlay",
    needsSecond: true,
    text: { label: "Weights (A, B — or name:weight, …)", value: "50, 50" },
    run: (r, n, _param, extras) => {
      const text = (extras.text || "").trim();
      let entries;
      if (text.includes(":")) {
        // name:weight pairs reach past the two dropdowns to every loaded
        // raster — the NI susceptibility recipe is five factors, not two.
        const pool = rasterLayers();
        entries = [];
        for (const piece of text.split(",")) {
          const at = piece.lastIndexOf(":");
          const name = piece.slice(0, at).trim();
          const weight = Number(piece.slice(at + 1));
          const layer = pool.find((l) => l.name === name
            || l.name.replace(/\.[^.]+$/, "") === name);
          if (!layer) return { ok: false, message: `No raster layer called "${name}".` };
          if (!Number.isFinite(weight) || weight < 0) {
            return { ok: false, message: `"${name}" needs a non-negative weight.` };
          }
          entries.push({ raster: layer.raster, weight });
        }
      } else {
        if (!extras.b) {
          return { ok: false, message: "Pick the second raster (B), or list name:weight pairs." };
        }
        const weights = text.split(",").map((w) => Number(w.trim()));
        if (weights.length !== 2 || weights.some((w) => !Number.isFinite(w))) {
          return { ok: false, message: 'Give two weights, e.g. "60, 40".' };
        }
        entries = [
          { raster: r.raster, weight: weights[0] },
          { raster: extras.b.raster, weight: weights[1] },
        ];
      }
      const res = RA.weightedOverlay(entries);
      if (!res.ok) return res;
      const result = publishRaster(res.raster, `overlay_${n}`);
      return {
        ...result,
        message: `${result.message} ${entries.length} factors, weights normalised.`
          + (res.resampled ? ` ${res.resampled} resampled onto the first grid.` : ""),
      };
    },
  },
  clipByPolygon: {
    label: "Clip by polygon",
    zones: true,
    run: (r, _n, _param, extras) => runRasterThroughRunner("clipByPolygon", r, extras),
  },
  toPoints: {
    label: "Raster to points",
    param: { label: "Sample every N cells", value: 8, step: 1 },
    run: (r, _n, param) => runThroughRunner("toPoints", r, null, { step: param }),
  },
};

function currentRasterOp() {
  return RASTER_OPS[byId("ras-op")?.value] || RASTER_OPS.slope;
}

function syncRasterOpInputs() {
  const op = currentRasterOp();
  const paramRow = byId("ras-op-param-row");
  const secondRow = byId("ras-op-second-row");
  const zonesRow = byId("ras-op-zones-row");
  const textRow = byId("ras-op-text-row");
  const fieldRow = byId("ras-op-field-row");
  if (secondRow) secondRow.hidden = !op.needsSecond;
  if (zonesRow) {
    zonesRow.hidden = !op.zones;
    // "Polygons" is a lie for distance (lines count) and sampling (points);
    // the label states what THIS op wants.
    const label = byId("ras-op-zones-label");
    if (op.zones && label) label.textContent = op.zonesLabel || "Polygons";
  }
  if (fieldRow) {
    fieldRow.hidden = !op.usesField;
    if (op.usesField) {
      // The field list belongs to whichever vector layer the zones select
      // names right now, so it refreshes with that select, not the layer list.
      const zones = selectedLayer("ras-op-zones", vectorLayers());
      fillSelect(byId("ras-op-field"),
        (zones?.info?.fields || []).map((f) => ({ id: f, name: f })));
    }
  }
  if (textRow) {
    textRow.hidden = !op.text;
    if (op.text) {
      byId("ras-op-text-label").textContent = op.text.label;
      const input = byId("ras-op-text");
      if (!input.dataset.touched) {
        input.value = op.text.value;
      }
    }
  }
  if (paramRow) {
    paramRow.hidden = !op.param;
    if (op.param) {
      byId("ras-op-param-label").textContent = op.param.label;
      const input = byId("ras-op-param");
      input.step = String(op.param.step);
      if (!input.dataset.touched) {
        input.value = String(op.param.value);
      }
    }
  }
}

function runRasterOp() {
  const op = currentRasterOp();
  const layer = selectedLayer("ras-op-a", rasterLayers());
  if (!layer) {
    setText("ras-op-status", "Import a GeoTIFF or ASCII grid first.");
    return;
  }
  const param = Number(byId("ras-op-param")?.value);
  const extras = {
    b: selectedLayer("ras-op-b", rasterLayers()),
    zones: selectedLayer("ras-op-zones", vectorLayers()),
    text: byId("ras-op-text")?.value?.trim(),
    field: byId("ras-op-field")?.value,
  };
  setText("ras-op-status", `Running ${op.label}...`);
  window.requestAnimationFrame(() => {
    try {
      const result = op.run(layer, layer.name.replace(/\.[^.]+$/, ""), param, extras);
      setText("ras-op-status", result.message);
    } catch (error) {
      console.error("[GeoID GIS] raster op failed", error);
      setText("ras-op-status", `Failed: ${error.message}`);
    }
  });
}

function runZonalStats() {
  const raster = selectedLayer("zonal-raster", rasterLayers());
  const zones = selectedLayer("zonal-zones", vectorLayers());
  if (!raster || !zones) {
    setText("zonal-status", "Pick a raster and a polygon layer.");
    return;
  }
  setText("zonal-status", "Computing zonal statistics...");
  window.requestAnimationFrame(() => {
    const results = RA.zonalStatistics(raster.raster, zones.collection);
    const withData = results.filter((r) => r.count > 0);
    if (!withData.length) {
      setText("zonal-status", "No raster cells fell inside those zones.");
      return;
    }
    zonalRows = withData.map((r) => ({
      ...r.properties, cells: r.count, min: r.min, max: r.max,
      mean: Number(r.mean.toFixed(3)), sum: Number(r.sum.toFixed(3)),
      std_dev: Number(r.stdDev.toFixed(3)),
      centroid_fallback: r.centroidFallback ? "yes" : "",
    }));
    const fallbacks = withData.filter((r) => r.centroidFallback).length;
    const first = withData[0];
    setText("zonal-status",
      `${withData.length} zones. First: ${first.count} cells, mean ${first.mean.toFixed(1)}.`
      + (fallbacks ? ` ${fallbacks} zones smaller than a cell used centroid sampling.` : ""));
    const button = byId("zonal-export");
    if (button) button.disabled = false;
  });
}

let zonalRows = [];

// ── Attribute table, statistics and export ──────────────────────────────────

function renderAttributeTable() {
  const layer = selectedLayer("attr-layer", vectorLayers());
  const host = byId("attr-table-host");
  if (!host) return;
  host.innerHTML = "";
  if (!layer) {
    host.innerHTML = '<p class="tool-copy import-empty-note">No vector layer selected.</p>';
    return;
  }
  const fields = layer.info?.fields || [];
  const rows = layer.collection.features.slice(0, 100);
  const table = document.createElement("table");
  table.className = "attr-table";
  const head = document.createElement("tr");
  fields.slice(0, 8).forEach((field) => {
    const th = document.createElement("th");
    th.textContent = field;
    head.appendChild(th);
  });
  table.appendChild(head);
  rows.forEach((f) => {
    const tr = document.createElement("tr");
    fields.slice(0, 8).forEach((field) => {
      const td = document.createElement("td");
      const value = f.properties?.[field];
      td.textContent = value === null || value === undefined ? "" : String(value);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  host.appendChild(table);
  const note = document.createElement("p");
  note.className = "tool-copy";
  note.textContent = `Showing ${rows.length} of ${layer.collection.features.length} features`
    + `${fields.length > 8 ? `, first 8 of ${fields.length} fields` : ""}.`;
  host.appendChild(note);
  fillSelect(byId("attr-field"), fields.map((f) => ({ id: f, name: f })));
}

function runFieldStatistics() {
  const layer = selectedLayer("attr-layer", vectorLayers());
  const field = byId("attr-field")?.value;
  if (!layer || !field) {
    setText("attr-stats", "Select a layer and field.");
    return;
  }
  const stats = GP.fieldStatistics(layer.collection, field);
  const parts = [`${stats.count} values`, `${stats.unique} unique`];
  if (stats.numericCount) {
    parts.push(`min ${stats.min}`, `max ${stats.max}`,
      `mean ${stats.mean.toFixed(3)}`, `sd ${stats.stdDev.toFixed(3)}`);
  }
  setText("attr-stats", parts.join(" | "));
}

function runFieldCalculator() {
  const layer = selectedLayer("attr-layer", vectorLayers());
  const name = byId("calc-field")?.value.trim();
  const expr = byId("calc-expr")?.value.trim();
  if (!layer || !name || !expr) {
    setText("attr-stats", "Give a new field name and an expression.");
    return;
  }
  const result = GP.fieldCalculator(layer.collection, name, expr);
  if (!result.ok) {
    setText("attr-stats", result.message);
    return;
  }
  const published = publishVector(result.collection, `calc_${layer.name}`);
  setText("attr-stats", `${published.message}${result.failures ? ` ${result.failures} rows failed.` : ""}`);
}

/**
 * Every tool, listed where the panels are.
 *
 * The palette answers "/" and the dialog runs anything, but a keystroke is not
 * an interface: a tool nobody can SEE is a tool nobody has. This builds the
 * catalogue from the same registry the palette searches — one source, so a new
 * descriptor appears here without anyone editing markup — grouped by category
 * into the folding sections the rest of the sidebar uses.
 *
 * A row states what the tool does, because a list of 37 verbs is a glossary
 * rather than a toolbox; and a tool that cannot run here (sidecar-only, no
 * connection) says so on the row instead of failing when pressed.
 */
async function buildToolCatalogue() {
  const host = byId("gis-tool-catalogue");
  if (!host || host.childElementCount) return;
  let runner;
  try {
    runner = await import("./tool-runner.js?v=20260902-792d638");
  } catch {
    host.textContent = "The toolbox is still loading.";
    return;
  }
  const groups = new Map();
  (runner.TOOLS || []).forEach((tool) => {
    const key = tool.category || "Tools";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tool);
  });
  groups.forEach((tools, category) => {
    const section = document.createElement("details");
    section.className = "gis-tool-section";
    const summary = document.createElement("summary");
    summary.textContent = `${category} (${tools.length})`;
    section.appendChild(summary);
    const body = document.createElement("div");
    body.className = "gis-tool-body gis-tool-catalogue-body";
    tools.slice().sort((a, b) => (a.label || "").localeCompare(b.label || ""))
      .forEach((tool) => {
        // ONE element per tool, not a button in a row followed by a paragraph.
        // The old shape gave every tool a boxed button sized to its longest
        // word and a full-width block of prose underneath, so five tools
        // filled the panel and the name wrapped inside its own border.
        const item = document.createElement("button");
        item.type = "button";
        item.className = "gis-tool-item";
        const name = document.createElement("b");
        name.textContent = tool.label || tool.id;
        const blurb = document.createElement("span");
        blurb.textContent = tool.blurb || "";
        item.append(name, blurb);
        item.title = tool.blurb || "";
        item.addEventListener("click", () => {
          const seam = window.GeoIDToolSearch;
          if (seam?.openTool) void seam.openTool(tool.id);
          else setText("explore-status", "The tool dialog is still loading.");
        });
        body.appendChild(item);
      });
    section.appendChild(body);
    host.appendChild(section);
  });
}

/**
 * The four workbench tools that are not descriptors.
 *
 * Charts, the time slider and the editor own their own panels, and the WFS
 * importer needs a URL rather than a layer — none of them fits the one-input
 * one-output shape the tool dialog renders, so they get buttons instead of
 * registry rows. Each reports honestly when its module is missing rather than
 * failing silently, which is what a dead button looks like from outside.
 */
function openWorkbench(seamName, label, call) {
  const seam = window[seamName];
  if (!seam) {
    setText("explore-status", `${label} is still loading — try again in a moment.`);
    return;
  }
  try {
    const layer = selectedLayer("attr-layer", vectorLayers()) || vectorLayers()[0];
    call(seam, layer);
  } catch (error) {
    console.error(`[GeoID GIS] ${label} failed`, error);
    setText("explore-status", `${label}: ${error.message}`);
  }
}

/**
 * Fetch a layer from a WFS / OGC API Features service.
 *
 * A prompt rather than a panel: the importer needs one URL and one collection
 * name, and a two-field form is not worth a workbench of its own. The study
 * area becomes the bbox when there is one, because pulling a national dataset
 * to look at one county is the mistake this makes easy to avoid.
 */
async function importFromService() {
  const seam = window.GeoIDWfsImport;
  if (!seam) {
    setText("explore-status", "The WFS importer is still loading.");
    return;
  }
  const base = window.prompt(
    "Service URL (OGC API landing page or WFS endpoint):",
    "https://ogcapi.bgs.ac.uk",
  );
  if (!base) return;
  const collection = window.prompt(
    "Layer to fetch (collection id, or typeNames for WFS):",
    "bgsgeology625kbedrock",
  );
  if (!collection) return;
  const area = window.GeoIDResearch?.store?.getActive?.()?.meta?.study_area;
  const bbox = area ? {
    minLon: Number(area.min_lon), minLat: Number(area.min_lat),
    maxLon: Number(area.max_lon), maxLat: Number(area.max_lat),
  } : undefined;
  setText("explore-status", `Fetching ${collection}…`);
  try {
    const result = await seam.importFromWfs(base, { collection, bbox }, {
      onProgress: (info) => setText("explore-status",
        `Fetching ${collection}: ${info.fetched || 0} features…`),
    });
    setText("explore-status", result?.truncated
      ? `${collection}: ${result.fetched} features (capped — narrow the area for the rest).`
      : `${collection}: ${result?.fetched ?? "?"} features imported.`);
  } catch (error) {
    setText("explore-status", `Could not fetch ${collection}: ${error.message}`);
  }
}

/**
 * Select by query — the whole query engine on the attribute panel.
 *
 * This replaces a substring match on one field, which was the entire query
 * capability: attributes, geometry and dates in one grammar, with the other
 * layers reachable by name so "within('Study area')" and
 * "distance('Rivers') < 500" are ordinary predicates rather than separate
 * tools. The result goes into the shared selection store, so anything else
 * watching it (charts, the map) sees the same rows.
 */
function runAttributeQuery() {
  const layer = selectedLayer("attr-layer", vectorLayers());
  const text = byId("attr-query")?.value?.trim();
  if (!layer) {
    setText("attr-stats", "Select a layer to query.");
    return;
  }
  if (!text) {
    setText("attr-stats", "Type a query, e.g. rock contains 'mudstone'.");
    return;
  }
  // Spatial predicates name another layer; resolving by NAME is what lets a
  // query read like a sentence rather than an id.
  const resolveLayer = (name) => {
    const other = vectorLayers().find((l) => l.name === name
      || l.name.replace(/\.[^.]+$/, "") === name);
    return other?.collection || null;
  };
  const result = runQuery(layer.collection, text, { resolveLayer });
  if (!result.ok) {
    setText("attr-stats", result.message);
    return;
  }
  selection.set(layer.id, result.indices);
  const total = layer.collection.features.length;
  setText("attr-stats",
    `${result.indices.length} of ${total} features selected`
    + `${result.indices.length ? " — \"Selection to layer\" makes them a layer." : "."}`);
}

/** The selection becomes a layer, so every tool can take it as an input. */
function selectionToLayer() {
  const layer = selectedLayer("attr-layer", vectorLayers());
  if (!layer) {
    setText("attr-stats", "Select a layer first.");
    return;
  }
  const indices = [...selection.get(layer.id)];
  if (!indices.length) {
    setText("attr-stats", "Nothing selected yet — run a query first.");
    return;
  }
  const fc = {
    type: "FeatureCollection",
    features: indices.map((i) => layer.collection.features[i]).filter(Boolean),
  };
  const base = layer.name.replace(/\.[^.]+$/, "");
  setText("attr-stats", publishVector(fc, `selected_${base}`).message);
}

/** The syntax card — a query language nobody can see is a query language
 *  nobody uses, so the examples live beside the box. */
function renderQueryHelp() {
  const host = byId("attr-query-help");
  if (!host || host.childElementCount) return;
  QUERY_HELP.forEach((entry) => {
    const row = document.createElement("p");
    row.className = "tool-copy";
    const code = document.createElement("code");
    code.textContent = entry.example;
    row.appendChild(code);
    row.appendChild(document.createTextNode(` — ${entry.means}`));
    host.appendChild(row);
  });
}

function exportLayer(format) {
  const layer = selectedLayer("attr-layer", vectorLayers());
  if (!layer) {
    setText("attr-stats", "Select a layer to export.");
    return;
  }
  const base = layer.name.replace(/\.[^.]+$/, "");
  const writers = {
    geojson: () => [VF.toGeoJson(layer.collection), "geojson", "application/geo+json"],
    csv: () => [VF.toCsv(layer.collection), "csv", "text/csv"],
    wkt: () => [VF.toWkt(layer.collection), "wkt", "text/plain"],
    kml: () => [VF.toKml(layer.collection, { name: base }), "kml", "application/vnd.google-earth.kml+xml"],
  };
  const [text, ext, mime] = writers[format]();
  downloadText(`${base}.${ext}`, text, mime);
  setText("attr-stats", `Exported ${layer.collection.features.length} features as ${ext.toUpperCase()}.`);
}

// ── Refresh + wiring ────────────────────────────────────────────────────────

export function refreshToolboxSelects() {
  const vectors = vectorLayers();
  const rasters = rasterLayers();
  fillSelect(byId("vec-op-a"), vectors);
  fillSelect(byId("vec-op-b"), vectors);
  fillSelect(byId("ras-op-a"), rasters);
  fillSelect(byId("ras-op-b"), rasters);
  fillSelect(byId("ras-op-zones"), vectors);
  fillSelect(byId("zonal-raster"), rasters);
  fillSelect(byId("zonal-zones"), vectors);
  fillSelect(byId("attr-layer"), vectors);
  syncVectorOpInputs();
  syncRasterOpInputs();
  renderAttributeTable();
}

function init() {
  fillSelect(byId("vec-op"), Object.entries(VECTOR_OPS).map(([id, op]) => ({ id, name: op.label })));
  fillSelect(byId("ras-op"), Object.entries(RASTER_OPS).map(([id, op]) => ({ id, name: op.label })));

  byId("vec-op")?.addEventListener("change", syncVectorOpInputs);
  byId("vec-op-a")?.addEventListener("change", syncVectorOpInputs);
  byId("vec-op-run")?.addEventListener("click", runVectorOp);
  byId("vec-op-param")?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });

  byId("ras-op")?.addEventListener("change", syncRasterOpInputs);
  byId("ras-op-run")?.addEventListener("click", runRasterOp);
  byId("ras-op-param")?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
  // Without the touched flag, the zones-change resync below would clobber
  // typed rules or a typed expression with the op's default text.
  byId("ras-op-text")?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
  byId("ras-op-zones")?.addEventListener("change", syncRasterOpInputs);
  byId("vec-op-check")?.addEventListener("change", (e) => { e.target.dataset.touched = "1"; });

  byId("zonal-run")?.addEventListener("click", runZonalStats);
  byId("zonal-export")?.addEventListener("click", () => {
    if (!zonalRows.length) return;
    const headers = [...new Set(zonalRows.flatMap((r) => Object.keys(r)))];
    const escape = (v) => {
      const t = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [headers.join(","), ...zonalRows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
    downloadText("zonal_statistics.csv", csv, "text/csv");
  });

  byId("attr-layer")?.addEventListener("change", renderAttributeTable);
  byId("attr-query-run")?.addEventListener("click", runAttributeQuery);
  byId("attr-query-layer")?.addEventListener("click", selectionToLayer);
  byId("attr-query-clear")?.addEventListener("click", () => {
    selection.clear();
    setText("attr-stats", "Selection cleared.");
  });
  byId("attr-query")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runAttributeQuery();
  });
  renderQueryHelp();
  void buildToolCatalogue();

  byId("open-charts")?.addEventListener("click", () => openWorkbench(
    "GeoIDCharts", "Charts", (seam, layer) => seam.open(layer?.id)));
  byId("open-time")?.addEventListener("click", () => openWorkbench(
    "GeoIDTime", "The time slider", (seam, layer) => seam.open(layer?.id)));
  byId("open-edit")?.addEventListener("click", () => openWorkbench(
    "GeoIDEditTools", "The editor", (seam, layer) => {
      if (!layer) {
        setText("explore-status", "Import or select a vector layer to edit.");
        return;
      }
      seam.start(layer.id);
    }));
  byId("open-wfs")?.addEventListener("click", () => { void importFromService(); });
  // Modelled data: one tick box per shipped dataset. Served with the site, so
  // no sidecar, no project and no token — reading a file is not one of the
  // things a browser cannot do.
  document.querySelectorAll("[data-demo]").forEach((box) => {
    box.addEventListener("change", () => {
      const demo = window.GeoIDDemo;
      if (!demo?.toggle) {
        setText("demo-status", "The dataset loader is still starting — try again in a moment.");
        box.checked = !box.checked;
        return;
      }
      const wanted = box.checked;
      box.disabled = true;
      Promise.resolve(demo.toggle(box.dataset.demo, Number(box.dataset.demoFile), wanted))
        .then((now) => { box.checked = Boolean(now); })
        .finally(() => { box.disabled = false; });
    });
  });
  byId("attr-stats-run")?.addEventListener("click", runFieldStatistics);
  byId("calc-run")?.addEventListener("click", runFieldCalculator);
  ["geojson", "csv", "wkt", "kml"].forEach((format) => {
    byId(`export-${format}`)?.addEventListener("click", () => exportLayer(format));
  });

  window.GeoIDImportManager?.onChange?.(refreshToolboxSelects);
  refreshToolboxSelects();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDToolboxOps = { refreshToolboxSelects, VECTOR_OPS, RASTER_OPS, CRS_OPTIONS };
