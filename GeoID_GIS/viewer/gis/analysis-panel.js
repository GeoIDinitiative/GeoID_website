import {
  extractPolygonSamples,
  rowsToCsv,
  rowsToGeoJson,
  downloadText,
} from "./extraction.js?v=20260808-5386e14";

let lastResult = null;

function setStatus(message) {
  const node = document.getElementById("gis-extract-status");
  if (node) {
    node.textContent = message;
  }
}

function setExportsEnabled(enabled) {
  ["gis-extract-csv", "gis-extract-geojson"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = !enabled;
    }
  });
}

/** Layers the user ticked in the source list. */
function selectedLayers() {
  const checked = new Set(
    [...document.querySelectorAll("#gis-extract-sources input[type=checkbox]:checked")]
      .map((input) => input.value),
  );
  return (window.GeoIDImportManager?.getLayers() || [])
    .filter((layer) => layer.sampler && checked.has(String(layer.id)));
}

function builtInChecked(id) {
  const node = document.getElementById(id);
  return node ? node.checked : false;
}

/**
 * Rebuilds the source checkbox list from the sampleable imported layers, so the
 * panel always reflects what is currently loaded.
 */
function renderSources() {
  const host = document.getElementById("gis-extract-sources");
  if (!host) {
    return;
  }
  const previous = new Map(
    [...host.querySelectorAll("input[type=checkbox]")].map((input) => [input.value, input.checked]),
  );
  host.innerHTML = "";
  const layers = window.GeoIDImportManager?.getSampleableLayers?.() || [];
  if (!layers.length) {
    const note = document.createElement("p");
    note.className = "tool-copy import-empty-note";
    note.textContent = "No sampleable imported layers. Import a GeoTIFF or shapefile to add sources.";
    host.appendChild(note);
    return;
  }
  layers.forEach((layer) => {
    const id = `gis-extract-src-${layer.id}`;
    const row = document.createElement("label");
    row.className = "gis-extract-source";
    row.htmlFor = id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.value = String(layer.id);
    input.checked = previous.has(String(layer.id)) ? previous.get(String(layer.id)) : true;
    const text = document.createElement("span");
    const kind = layer.info?.valueKind === "attributes" ? "attributes" : "values";
    text.textContent = `${layer.name} (${kind})`;
    row.appendChild(input);
    row.appendChild(text);
    host.appendChild(row);
  });
}

function runExtraction() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.getExtractionGeometry) {
    setStatus("Viewer is not ready yet.");
    return;
  }
  // Reuses whatever the user drew with the existing Area tool (or a buffer),
  // rather than introducing a second polygon-drawing workflow.
  const geometry = viewer.getExtractionGeometry("study") || viewer.getExtractionGeometry("buffer");
  if (!geometry) {
    setStatus("Draw a polygon with the Area tool first, then run extraction.");
    setExportsEnabled(false);
    return;
  }

  const stepKm = Number(document.getElementById("gis-extract-step")?.value) || 1;
  setStatus("Sampling...");
  setExportsEnabled(false);

  // Yield once so the status paints before a potentially long synchronous pass.
  window.requestAnimationFrame(() => {
    const result = extractPolygonSamples({
      vertices: geometry.vertices,
      center: geometry.center,
      stepKm,
      includeBuiltIn: builtInChecked("gis-extract-builtin"),
      includeGeology: builtInChecked("gis-extract-geology"),
      layers: selectedLayers(),
    });
    lastResult = result.ok ? result : null;
    const area = result.areaKm2
      ? ` over ${result.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km2`
      : "";
    setStatus(result.ok ? `${result.message}${area}.` : result.message);
    setExportsEnabled(result.ok);
  });
}

function exportAs(kind) {
  if (!lastResult?.rows?.length) {
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "csv") {
    downloadText(`geoid_extract_${stamp}.csv`, rowsToCsv(lastResult.rows), "text/csv");
  } else {
    downloadText(`geoid_extract_${stamp}.geojson`, rowsToGeoJson(lastResult.rows), "application/geo+json");
  }
}

function init() {
  document.getElementById("gis-extract-run")?.addEventListener("click", runExtraction);
  document.getElementById("gis-extract-csv")?.addEventListener("click", () => exportAs("csv"));
  document.getElementById("gis-extract-geojson")?.addEventListener("click", () => exportAs("geojson"));
  setExportsEnabled(false);
  renderSources();
  window.GeoIDImportManager?.onChange?.(renderSources);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDAnalysis = {
  runExtraction,
  getLastResult: () => lastResult,
  renderSources,
};
