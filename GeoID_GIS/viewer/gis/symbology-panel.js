/**
 * The symbology panel: choose how a layer is coloured, and see it change.
 *
 * It repaints the layer's own texture rather than producing a classified copy.
 * A copy would be a second layer on top of the first, and after three
 * adjustments the map is four maps deep — which is what "just make a new
 * derived layer" costs in practice.
 *
 * The legend follows from the same object the renderer uses, so the two cannot
 * disagree about what a colour means. That was the fault behind both earlier
 * symbology complaints.
 */

import {
  buildSymbology, colourOf, legendInfoFrom, METHODS, RAMP_NAMES,
  categoricalSymbology, suggestCategoryField,
} from "./symbology.js?v=20260817-718e756";

const HOST_ID = "gis-symbology-host";
const state = { layerId: null, last: null };

function byId(id) { return document.getElementById(id); }

function paintable() {
  // Vector layers repaint too now, so the filter is "can this be redrawn",
  // not "is this a raster".
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.status === "loaded" && typeof l.repaint === "function"
      && (l.raster || l.features?.length));
}

function isVector(layer) { return Boolean(!layer?.raster && layer?.features?.length); }

/** Fields a vector layer could be coloured by, the likely one first. */
function fillFieldSelect(layer) {
  const select = byId("gis-sym-field");
  if (!select) return;
  const held = select.value;
  select.innerHTML = "";
  if (!isVector(layer)) return;
  const names = [...new Set(layer.features.flatMap((f) => Object.keys(f.properties || {})))];
  const suggested = suggestCategoryField(layer.features, names);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = held && names.includes(held) ? held : (suggested || names[0] || "");
}

function valuesOf(layer) {
  const band = layer.raster?.band;
  if (!band) return [];
  const noData = layer.raster.noData;
  const out = [];
  // A million-cell raster does not need every cell to find its breaks; an
  // even stride keeps the distribution's shape and keeps this instant.
  const stride = Math.max(1, Math.floor(band.length / 40000));
  for (let i = 0; i < band.length; i += stride) {
    const v = band[i];
    if (!Number.isFinite(v)) continue;
    if (noData != null && Number.isFinite(noData) && v === noData) continue;
    out.push(v);
  }
  return out;
}

function previewCategories(sym) {
  const host = byId("gis-symbology-preview");
  if (!host) return;
  host.innerHTML = "";
  const table = document.createElement("div");
  table.className = "gis-sym-rows";
  sym.rows.forEach((row) => {
    const line = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = "gis-sym-swatch";
    swatch.style.background = row.colour;
    const text = document.createElement("span");
    text.textContent = `${row.value}  (${row.count.toLocaleString()})`;
    text.title = row.value;
    line.append(swatch, text);
    table.appendChild(line);
  });
  host.appendChild(table);
}

function preview(symbology) {
  const host = byId("gis-symbology-preview");
  if (!host) return;
  host.innerHTML = "";
  if (!symbology?.ok) return;
  const bar = document.createElement("div");
  bar.className = "gis-sym-bar";
  bar.style.background = symbology.continuous
    ? `linear-gradient(to right, ${symbology.palette.join(", ")})`
    : "";
  if (!symbology.continuous) {
    symbology.rows.forEach((row) => {
      const cell = document.createElement("span");
      cell.style.background = row.colour;
      cell.title = `${row.from.toFixed(3)} to ${row.to.toFixed(3)} — ${row.count} cells`;
      bar.appendChild(cell);
    });
  }
  host.appendChild(bar);
  const table = document.createElement("div");
  table.className = "gis-sym-rows";
  symbology.rows.forEach((row) => {
    const line = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = "gis-sym-swatch";
    swatch.style.background = row.colour;
    const text = document.createElement("span");
    const fmt = (v) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)
      ? v.toPrecision(3) : String(Number(v.toPrecision(4))));
    text.textContent = `${fmt(row.from)} – ${fmt(row.to)}`
      + (symbology.continuous ? "" : `  (${row.count.toLocaleString()})`);
    line.append(swatch, text);
    table.appendChild(line);
  });
  host.appendChild(table);
}

function currentSpec() {
  return {
    method: byId("gis-sym-method")?.value || "jenks",
    classes: Number(byId("gis-sym-classes")?.value) || 5,
    ramp: byId("gis-sym-ramp")?.value || "risk",
    reverse: Boolean(byId("gis-sym-reverse")?.checked),
    continuous: byId("gis-sym-method")?.value === "continuous",
  };
}

function recompute(apply) {
  const layer = paintable().find((l) => String(l.id ?? l.name) === state.layerId);
  const status = byId("gis-symbology-status");
  if (!layer) {
    if (status) status.textContent = "Pick a layer.";
    return;
  }
  // A vector layer has categories, not classes: geology is a list of units,
  // and cutting a list of names into five quantiles is meaningless.
  const vector = isVector(layer);
  ["gis-sym-method-row", "gis-sym-classes-row"].forEach((id) => {
    const row = byId(id);
    if (row) row.hidden = vector;
  });
  const fieldRow = byId("gis-sym-field-row");
  if (fieldRow) fieldRow.hidden = !vector;
  if (vector) {
    const field = byId("gis-sym-field")?.value;
    if (!field) { if (status) status.textContent = "That layer has no attributes."; return; }
    const sym = categoricalSymbology(layer.features, field, {
      ramp: byId("gis-sym-ramp")?.value || "spectral",
    });
    if (!sym.ok) { if (status) status.textContent = sym.message; return; }
    state.last = sym;
    previewCategories(sym);
    if (!apply) { if (status) status.textContent = `${sym.message} Press Apply.`; return; }
    const painted = layer.repaint((feature) => sym.colourOf(feature));
    layer.legendInfo = {
      palette: sym.rows.map((r) => r.colour.replace("#", "")),
      labels: sym.rows.map((r) => r.value),
      categorical: true, field,
    };
    window.GeoIDLayerHierarchy?.render?.();
    if (status) {
      status.textContent = painted
        ? `${layer.name} coloured by ${field}: ${sym.rows.length} categories.`
        : "That layer could not be repainted.";
    }
    return;
  }
  const symbology = buildSymbology(valuesOf(layer), currentSpec());
  if (!symbology.ok) {
    if (status) status.textContent = symbology.message;
    return;
  }
  state.last = symbology;
  preview(symbology);
  if (!apply) {
    if (status) status.textContent = `${symbology.rows.length} classes ready — press Apply.`;
    return;
  }
  const painted = layer.repaint((value) => {
    const colour = colourOf(value, symbology);
    if (!colour) return null;
    return [
      parseInt(colour.slice(1, 3), 16),
      parseInt(colour.slice(3, 5), 16),
      parseInt(colour.slice(5, 7), 16),
    ];
  });
  layer.legendInfo = legendInfoFrom(symbology, { unit: layer.legendInfo?.unit || null });
  window.GeoIDLayerHierarchy?.render?.();
  if (status) {
    status.textContent = painted
      ? `${layer.name}: ${symbology.rows.length} classes by ${METHODS[symbology.method]?.label || symbology.method}.`
      : "That layer could not be repainted.";
  }
}

function fillLayers() {
  const select = byId("gis-sym-layer");
  if (!select) return;
  const held = select.value;
  select.innerHTML = "";
  const layers = paintable();
  if (!layers.length) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No raster layer loaded";
    select.appendChild(none);
    return;
  }
  layers.forEach((layer) => {
    const option = document.createElement("option");
    option.value = layer.id != null ? String(layer.id) : layer.name;
    option.textContent = layer.name;
    select.appendChild(option);
  });
  select.value = held && [...select.options].some((o) => o.value === held) ? held : select.options[0].value;
  state.layerId = select.value;
}

export function init() {
  const host = byId(HOST_ID);
  if (!host || host.dataset.built) return;
  host.dataset.built = "1";

  const method = byId("gis-sym-method");
  if (method) {
    Object.entries(METHODS).forEach(([id, m]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = m.label;
      method.appendChild(option);
    });
    const smooth = document.createElement("option");
    smooth.value = "continuous";
    smooth.textContent = "Continuous (no classes)";
    method.appendChild(smooth);
  }
  const ramp = byId("gis-sym-ramp");
  if (ramp) {
    RAMP_NAMES.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      ramp.appendChild(option);
    });
  }

  fillLayers();
  fillFieldSelect(paintable().find((l) => String(l.id ?? l.name) === state.layerId));
  window.GeoIDImportManager?.onChange?.(() => {
    fillLayers();
    fillFieldSelect(paintable().find((l) => String(l.id ?? l.name) === state.layerId));
  });
  byId("gis-sym-layer")?.addEventListener("change", (e) => {
    state.layerId = e.target.value;
    recompute(false);
  });
  byId("gis-sym-layer")?.addEventListener("change", () => {
    const layer = paintable().find((l) => String(l.id ?? l.name) === state.layerId);
    fillFieldSelect(layer);
    recompute(false);
  });
  ["gis-sym-method", "gis-sym-classes", "gis-sym-ramp", "gis-sym-reverse", "gis-sym-field"].forEach((id) => {
    byId(id)?.addEventListener("change", () => recompute(false));
  });
  byId("gis-sym-apply")?.addEventListener("click", () => recompute(true));
}

if (typeof window !== "undefined") {
  window.GeoIDSymbologyPanel = { init, recompute };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
