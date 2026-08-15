import * as GP from "./geoprocessing.js?v=20260815-dee2647";
import * as RA from "./raster-analysis.js?v=20260815-dee2647";
import * as VF from "./vector-formats.js?v=20260815-dee2647";
import { buildVectorLayerResult } from "./vector-render.js?v=20260815-dee2647";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260815-dee2647";
import { downloadText } from "./extraction.js?v=20260815-dee2647";
import { CRS_OPTIONS } from "./projection.js?v=20260815-dee2647";

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

function publishRaster(raster, name) {
  const result = buildRasterLayer([raster.band], raster.width, raster.height, raster.bounds, {
    name, noData: raster.noData, isDem: true,
  });
  window.GeoIDImportManager.addDerivedLayer(name, result, "derived");
  return { ok: true, message: `${name} created.` };
}

// ── Vector operations ───────────────────────────────────────────────────────

const VECTOR_OPS = {
  buffer: {
    label: "Buffer",
    needsSecond: false,
    param: { label: "Distance (m)", value: 1000, step: 100 },
    run: (a, _b, param) => publishVector(GP.buffer(a.collection, param), `buffer_${a.name}`),
  },
  clip: {
    label: "Clip by layer",
    needsSecond: true,
    run: (a, b) => publishVector(GP.clip(a.collection, b.collection), `clip_${a.name}`),
  },
  difference: {
    label: "Difference",
    needsSecond: true,
    run: (a, b) => publishVector(GP.difference(a.collection, b.collection), `diff_${a.name}`),
  },
  intersect: {
    label: "Intersect",
    needsSecond: true,
    run: (a, b) => publishVector(GP.intersect(a.collection, b.collection), `intersect_${a.name}`),
  },
  dissolve: {
    label: "Dissolve by field",
    needsSecond: false,
    usesField: true,
    run: (a, _b, _param, field) => publishVector(GP.dissolve(a.collection, field), `dissolve_${a.name}`),
  },
  hull: {
    label: "Convex hull",
    needsSecond: false,
    run: (a) => publishVector(GP.convexHull(a.collection), `hull_${a.name}`),
  },
  centroids: {
    label: "Centroids",
    needsSecond: false,
    run: (a) => publishVector(GP.centroids(a.collection), `centroids_${a.name}`),
  },
  simplify: {
    label: "Simplify",
    needsSecond: false,
    // Metres, not degrees: a degree is 111 km at the equator and 20 km at 80°
    // north, so the old unit simplified a dataset harder at one end than the
    // other and had no meaning anyone could reason about. 100 m is a sane
    // default for coastline-scale data.
    param: { label: "Tolerance (m)", value: 100, step: 10 },
    run: (a, _b, param) => publishVector(GP.simplifyCollection(a.collection, param), `simplify_${a.name}`),
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
      if (!extras.fromCrs || !extras.toCrs) {
        return { ok: false, message: "Pick both coordinate systems." };
      }
      if (extras.fromCrs === extras.toCrs) {
        return { ok: false, message: "Source and target CRS are the same." };
      }
      return publishVector(
        GP.reproject(a.collection, extras.fromCrs, extras.toCrs),
        `reproject_${a.name}`,
      );
    },
  },
  spatialJoin: {
    label: "Spatial join",
    needsSecond: true,
    run: (a, b) => {
      const joined = GP.spatialJoin(a.collection, b.collection);
      const result = publishVector(joined, `join_${a.name}`);
      return { ...result, message: `${result.message} ${joined.matched} matched.` };
    },
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
  if (secondRow) secondRow.hidden = !op.needsSecond;
  if (fieldRow) fieldRow.hidden = !op.usesField;
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
  };
  setText("vec-op-status", `Running ${op.label}...`);
  window.requestAnimationFrame(() => {
    try {
      const result = op.run(a, b, param, field, extras);
      setText("vec-op-status", result.message);
    } catch (error) {
      console.error("[GeoID GIS] vector op failed", error);
      setText("vec-op-status", `Failed: ${error.message}`);
    }
  });
}

// ── Raster operations ───────────────────────────────────────────────────────

const RASTER_OPS = {
  slope: { label: "Slope (degrees)", run: (r, n) => publishRaster(RA.slope(r.raster), `slope_${n}`) },
  aspect: { label: "Aspect", run: (r, n) => publishRaster(RA.aspect(r.raster), `aspect_${n}`) },
  hillshade: { label: "Hillshade", run: (r, n) => publishRaster(RA.hillshade(r.raster), `hillshade_${n}`) },
  contours: {
    label: "Contours",
    param: { label: "Interval", value: 250, step: 50 },
    run: (r, n, param) => {
      const stats = RA.rasterStatistics(r.raster);
      const levels = [];
      for (let v = Math.ceil(stats.min / param) * param; v < stats.max; v += param) {
        levels.push(v);
      }
      if (!levels.length) {
        return { ok: false, message: "Interval is larger than the value range." };
      }
      return publishVector(RA.contours(r.raster, levels), `contours_${n}`);
    },
  },
  reclassify: {
    label: "Reclassify (above/below)",
    param: { label: "Threshold", value: 1000, step: 100 },
    run: (r, n, param) => publishRaster(
      RA.reclassify(r.raster, [[-Infinity, param, 0], [param + 1e-9, Infinity, 1]]), `reclass_${n}`,
    ),
  },
  calculator: {
    label: "Raster calculator",
    needsSecond: true,
    text: { label: "Expression", value: "(a - b) / (a + b)" },
    run: (r, n, _param, extras) => {
      const other = extras.b || null;
      if (other && (other.raster.width !== r.raster.width
        || other.raster.height !== r.raster.height)) {
        return {
          ok: false,
          message: `Rasters differ in shape (${r.raster.width}x${r.raster.height} vs `
            + `${other.raster.width}x${other.raster.height}) — resample first.`,
        };
      }
      const res = RA.rasterCalculator(r.raster, other?.raster || null, extras.text || "a");
      if (!res.ok) return res;
      return publishRaster(res.raster, `calc_${n}`);
    },
  },
  clipByPolygon: {
    label: "Clip by polygon",
    zones: true,
    run: (r, n, _param, extras) => {
      if (!extras.zones) {
        return { ok: false, message: "Pick a polygon layer to clip by." };
      }
      return publishRaster(
        RA.clipRasterByPolygon(r.raster, extras.zones.collection), `clip_${n}`,
      );
    },
  },
  toPoints: {
    label: "Raster to points",
    param: { label: "Sample every N cells", value: 8, step: 1 },
    run: (r, n, param) => publishVector(
      RA.rasterToPoints(r.raster, { step: Math.max(1, Math.round(param)) }), `points_${n}`,
    ),
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
  if (secondRow) secondRow.hidden = !op.needsSecond;
  if (zonesRow) zonesRow.hidden = !op.zones;
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
