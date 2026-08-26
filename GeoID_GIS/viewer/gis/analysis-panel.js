import {
  extractPolygonSamples,
  rowsToCsv,
  rowsToGeoJson,
  downloadText,
} from "./extraction.js?v=20260826-71c164f";
import { rectangleVertices } from "./draw-area.js?v=20260826-71c164f";

let lastResult = null;

/**
 * The preset box: a size rather than a shape.
 *
 * It hands the polygon to the viewer's own Draw tool rather than keeping a
 * second geometry of its own, so from here on a box and a hand-drawn area are
 * the same thing — same overlay, same area readout, same extraction. A second
 * geometry would have to be taught every one of those separately, and would
 * disagree with the drawn one the first time either changed.
 */
function drawBox() {
  const viewer = window.GeoIDViewer;
  const say = (message) => {
    const node = document.getElementById("gis-box-status");
    if (node) node.textContent = message;
  };
  if (!viewer?.setStudyAreaPolygon) {
    say("Viewer is not ready yet.");
    return;
  }
  const mode = document.getElementById("gis-box-centre")?.value || "view";
  let centre = null;
  if (mode === "manual") {
    const lat = Number(document.getElementById("gis-box-lat")?.value);
    const lon = Number(document.getElementById("gis-box-lon")?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || document.getElementById("gis-box-lat")?.value === ""
      || document.getElementById("gis-box-lon")?.value === "") {
      say("Enter a latitude and a longitude, or centre the box on the view.");
      return;
    }
    centre = { lat, lon };
  } else {
    centre = viewer.getViewCentreLatLon?.() || null;
    if (!centre) {
      // The middle of the screen is off the globe. Asking is the honest answer;
      // guessing a centre would put the box somewhere never looked at.
      say("The middle of the view is not on the globe — turn to it, or enter coordinates.");
      return;
    }
  }

  // A square is one number, which is what most study areas actually are.
  const square = document.getElementById("gis-box-shape")?.value !== "rectangle";
  const widthKm = Number(document.getElementById("gis-box-width")?.value);
  const box = rectangleVertices({
    lat: centre.lat,
    lon: centre.lon,
    widthKm,
    heightKm: square ? widthKm : Number(document.getElementById("gis-box-height")?.value),
    // Sized on whichever world this is. Without it a 200 km box on Mars came
    // out 106 km across, because a degree there is 59 km and not 111.
    radiusKm: viewer.bodyRadiusKm || undefined,
  });
  if (!box) {
    say("Give the box a width and a height in kilometres.");
    return;
  }
  // The shape joins the layer list as well as becoming the study area. An
  // area is both a place you are working and a polygon you can operate on,
  // and the user should not have to capture it twice.
  const alsoALayer = () => {
    const out = window.GeoIDDrawnLayers?.captureDrawn?.();
    if (out?.ok) setStatus(`${out.message}`);
  };
  if (!viewer.setStudyAreaPolygon(box.vertices)) {
    say("The viewer would not take that box.");
    return;
  }
  alsoALayer();
  const east = ((centre.lon % 360) + 360) % 360;
  say(`${box.areaHintKm2.toLocaleString()} km² box at `
    + `${centre.lat.toFixed(3)}°, ${east.toFixed(3)}°E. Run the extraction below.`);
}

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
    // What the column will actually hold, said plainly. A GEE drape's value is
    // read back out of the rendered palette, which is a few percent off the
    // source band — the list says so rather than letting a column of
    // millimetres imply it came from the archive.
    const info = layer.info || {};
    let kind = "values";
    if (info.valueKind === "attributes") kind = "attributes";
    else if (info.valueKind === "colour") kind = "colour only";
    else if (info.recoveredFromPalette) kind = `${info.unit || "values"}, read from the palette`;
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
  // Whatever the Draw tool currently holds -- clicked out, or a preset box --
  // or a buffer. There is deliberately no second polygon workflow here.
  const geometry = viewer.getExtractionGeometry("study") || viewer.getExtractionGeometry("buffer");
  if (!geometry) {
    setStatus("Mark out an area first — the Draw tool, or the box above.");
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
      includeClimate: builtInChecked("gis-extract-climate"),
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
  document.getElementById("gis-box-draw")?.addEventListener("click", drawBox);

  const shape = document.getElementById("gis-box-shape");
  const heightRow = document.getElementById("gis-box-height-row");
  const widthLabel = document.getElementById("gis-box-width-label");
  const syncShape = () => {
    const square = shape?.value !== "rectangle";
    if (heightRow) heightRow.hidden = square;
    if (widthLabel) widthLabel.textContent = square ? "Side (km)" : "Width (km)";
  };
  shape?.addEventListener("change", syncShape);
  syncShape();

  const centreMode = document.getElementById("gis-box-centre");
  const manualRow = document.getElementById("gis-box-manual");
  const syncCentreMode = () => {
    if (manualRow) manualRow.hidden = centreMode?.value !== "manual";
  };
  centreMode?.addEventListener("change", syncCentreMode);
  syncCentreMode();

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
