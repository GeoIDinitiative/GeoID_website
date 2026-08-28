import {
  extractPolygonSamples,
  rowsToCsv,
  rowsToGeoJson,
  downloadText,
  ringsFromCollection,
  maskFromRings,
  extractVectorWithin,
  vectorRows,
  extractDelimitedWithin,
  delimitedColumns,
} from "./extraction.js?v=20260828-63ee33e";
import { rectangleVertices } from "./draw-area.js?v=20260828-63ee33e";

let lastResult = null;
// The whole extraction as one object -- bounds, grid, vectors, clouds. This is
// the Model Builder's consumption point: a study area plus every dataset the
// user ticked, already cut to it.
let lastPackage = null;

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

/** Loaded layers, whatever their kind. */
function loadedLayers() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => layer.status === "loaded");
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
 * The bounds the whole extraction runs within: the drawn or boxed area, or
 * ANY loaded polygon layer — which is what lets a shapefile somebody
 * imported, or a buffer a tool produced, define the study area directly.
 */
function resolveBounds() {
  const value = document.getElementById("gis-extract-within")?.value || "drawn";
  if (value.startsWith("layer:")) {
    const id = value.slice(6);
    const layer = loadedLayers().find((l) => String(l.id) === id);
    if (!layer?.collection) {
      return { error: "That bounds layer is no longer loaded — pick another." };
    }
    const rings = ringsFromCollection(layer.collection);
    if (!rings.length) {
      return { error: "That layer holds no polygons to bound with." };
    }
    // The layer's own collection is the mask, holes and all — rebuilding it
    // from the rings would be a second copy of the same polygons.
    return { label: layer.name, rings, maskFc: layer.collection, layerId: String(layer.id) };
  }
  const viewer = window.GeoIDViewer;
  // Whatever the Draw tool currently holds -- clicked out, or a preset box --
  // or a buffer. There is deliberately no second polygon workflow here.
  const geometry = viewer?.getExtractionGeometry?.("study")
    || viewer?.getExtractionGeometry?.("buffer");
  if (!geometry) {
    return { error: "Mark out an area first — the Draw tool, the box above, or pick a polygon layer." };
  }
  const rings = [{ vertices: geometry.vertices, holes: [], center: geometry.center }];
  return { label: "the drawn area", rings, maskFc: maskFromRings(rings), layerId: null };
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

/** The bounds select: the drawn area, plus every loaded polygon layer. */
function renderWithin() {
  const select = document.getElementById("gis-extract-within");
  if (!select) return;
  const previous = select.value;
  [...select.querySelectorAll("option")].slice(1).forEach((option) => option.remove());
  loadedLayers()
    .filter((layer) => (layer.collection?.features || []).some((f) =>
      f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"))
    .forEach((layer) => {
      const option = document.createElement("option");
      option.value = `layer:${layer.id}`;
      option.textContent = `▱ ${layer.name}`;
      select.appendChild(option);
    });
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

const FIELD_CAP = 60;

/** Union of attribute keys across a vector layer's features, capped. */
function vectorFieldsOf(layer) {
  const seen = new Set();
  const fields = [];
  (layer.collection?.features || []).some((f) => {
    Object.keys(f?.properties || {}).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(key);
      }
    });
    return fields.length >= FIELD_CAP;
  });
  return fields;
}

/**
 * One tick list of layers, each with a fold of its own column ticks. State
 * survives the rebuild the same way renderSources' does — read the old
 * checkboxes before wiping.
 */
function renderLayerTicks(host, title, entries, role) {
  const previous = new Map(
    [...host.querySelectorAll("input[type=checkbox]")]
      .map((input) => [input.dataset.key, input.checked]),
  );
  const openFolds = new Set(
    [...host.querySelectorAll("details[open]")].map((d) => d.dataset.layer),
  );
  host.innerHTML = "";
  if (!entries.length) return;
  const heading = document.createElement("div");
  heading.className = "gis-extract-group-title";
  heading.textContent = title;
  host.appendChild(heading);
  entries.forEach((entry) => {
    const layerKey = `${role} ${entry.id}`;
    const row = document.createElement("label");
    row.className = "gis-extract-source";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.key = layerKey;
    box.dataset.role = `${role}-layer`;
    box.dataset.layer = String(entry.id);
    box.checked = previous.has(layerKey) ? previous.get(layerKey) : true;
    const text = document.createElement("span");
    text.textContent = entry.label;
    row.appendChild(box);
    row.appendChild(text);
    host.appendChild(row);
    if (!entry.columns.length) return;
    const fold = document.createElement("details");
    fold.className = "gis-extract-fields";
    fold.dataset.layer = String(entry.id);
    if (openFolds.has(String(entry.id))) fold.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `Columns (${entry.columns.length})`;
    fold.appendChild(summary);
    entry.columns.forEach((column) => {
      const key = `${layerKey} ${column}`;
      const colRow = document.createElement("label");
      colRow.className = "gis-extract-source";
      const colBox = document.createElement("input");
      colBox.type = "checkbox";
      colBox.dataset.key = key;
      colBox.dataset.role = `${role}-col`;
      colBox.dataset.layer = String(entry.id);
      colBox.dataset.column = column;
      colBox.checked = previous.has(key) ? previous.get(key) : true;
      const colText = document.createElement("span");
      colText.textContent = column;
      colRow.appendChild(colBox);
      colRow.appendChild(colText);
      fold.appendChild(colRow);
    });
    host.appendChild(fold);
  });
}

function renderVectors() {
  const host = document.getElementById("gis-extract-vectors");
  if (!host) return;
  renderLayerTicks(host, "Vector layers — clipped to the bounds",
    loadedLayers()
      .filter((layer) => layer.collection?.features?.length)
      .map((layer) => ({
        id: layer.id,
        label: `${layer.name} (${layer.collection.features.length.toLocaleString()} features)`,
        columns: vectorFieldsOf(layer),
      })),
    "vector");
}

function renderClouds() {
  const host = document.getElementById("gis-extract-clouds");
  if (!host) return;
  renderLayerTicks(host, "Point clouds — rows inside the bounds",
    loadedLayers()
      .filter((layer) => layer.source?.text)
      .map((layer) => ({
        id: layer.id,
        label: layer.name,
        columns: delimitedColumns(layer.source),
      })),
    "cloud");
}

function renderAll() {
  renderSources();
  renderWithin();
  renderVectors();
  renderClouds();
}

function tickedLayerIds(role) {
  const hostId = role === "vector" ? "gis-extract-vectors" : "gis-extract-clouds";
  return [...document.querySelectorAll(
    `#${hostId} input[data-role="${role}-layer"]:checked`,
  )].map((input) => input.dataset.layer);
}

/** The ticked columns for one layer — null when ALL are ticked (keep everything). */
function tickedColumns(role, layerId) {
  const hostId = role === "vector" ? "gis-extract-vectors" : "gis-extract-clouds";
  const all = [...document.querySelectorAll(
    `#${hostId} input[data-role="${role}-col"]`,
  )].filter((input) => input.dataset.layer === String(layerId));
  const ticked = all.filter((input) => input.checked);
  if (!all.length || ticked.length === all.length) return null;
  return ticked.map((input) => input.dataset.column);
}

function runExtraction() {
  const bounds = resolveBounds();
  if (bounds.error) {
    setStatus(bounds.error);
    setExportsEnabled(false);
    return;
  }

  const stepKm = Number(document.getElementById("gis-extract-step")?.value) || 1;
  setStatus("Sampling...");
  setExportsEnabled(false);

  // Yield once so the status paints before a potentially long synchronous pass.
  window.requestAnimationFrame(() => {
    const result = extractPolygonSamples({
      rings: bounds.rings,
      stepKm,
      includeBuiltIn: builtInChecked("gis-extract-builtin"),
      includeGeology: builtInChecked("gis-extract-geology"),
      includeClimate: builtInChecked("gis-extract-climate"),
      layers: selectedLayers(),
    });
    lastResult = result.ok ? result : null;

    // Every ticked vector layer, truly clipped. The bounds layer itself is
    // skipped -- clipping a polygon by itself returns itself, which is not an
    // extract, it is a copy.
    const vectors = tickedLayerIds("vector")
      .filter((id) => id !== bounds.layerId)
      .map((id) => loadedLayers().find((l) => String(l.id) === id))
      .filter((layer) => layer?.collection)
      .map((layer) => ({
        layer: layer.name,
        ...extractVectorWithin(layer.collection, bounds.maskFc,
          { fields: tickedColumns("vector", layer.id) }),
      }));

    // Every ticked point cloud, read from the FILE it kept -- all its columns,
    // not the x/y/z/magnitude the renderer holds.
    const clouds = tickedLayerIds("cloud")
      .map((id) => loadedLayers().find((l) => String(l.id) === id))
      .filter((layer) => layer?.source?.text)
      .map((layer) => ({
        layer: layer.name,
        ...extractDelimitedWithin(layer.source, bounds.rings,
          { columns: tickedColumns("cloud", layer.id) }),
      }));

    lastPackage = { bounds: bounds.label, grid: lastResult, vectors, clouds };

    const parts = [];
    if (result.ok && result.rows.length) {
      const area = result.areaKm2
        ? ` over ${result.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km2`
        : "";
      parts.push(`${result.message}${area}`);
    } else if (!result.ok) {
      parts.push(result.message);
    }
    if (vectors.length) {
      const kept = vectors.reduce((s, v) => s + v.kept, 0);
      const total = vectors.reduce((s, v) => s + v.total, 0);
      parts.push(`${vectors.length} vector layer${vectors.length === 1 ? "" : "s"}: `
        + `${kept.toLocaleString()} of ${total.toLocaleString()} features within`);
    }
    clouds.forEach((cloud) => {
      parts.push(`${cloud.layer}: ${cloud.message}`);
    });
    setStatus(`Within ${bounds.label} — ${parts.join(" · ")}.`);
    setExportsEnabled(Boolean(lastResult?.rows?.length
      || vectors.some((v) => v.kept)
      || clouds.some((c) => c.rows?.length)));
  });
}

function slugName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "layer";
}

/**
 * Exports the whole package in the pressed format: the grid as before, plus
 * one file per extracted vector layer and point cloud. Everything goes
 * through downloadText, which also files each into the open project.
 */
function exportAs(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (lastResult?.rows?.length) {
    if (kind === "csv") {
      downloadText(`geoid_extract_${stamp}.csv`, rowsToCsv(lastResult.rows), "text/csv");
    } else {
      downloadText(`geoid_extract_${stamp}.geojson`, rowsToGeoJson(lastResult.rows), "application/geo+json");
    }
  }
  (lastPackage?.vectors || []).forEach((v) => {
    if (!v.kept) return;
    const base = `geoid_extract_${slugName(v.layer)}_${stamp}`;
    if (kind === "csv") {
      downloadText(`${base}.csv`, rowsToCsv(vectorRows(v.collection)), "text/csv");
    } else {
      downloadText(`${base}.geojson`, JSON.stringify(v.collection), "application/geo+json");
    }
  });
  (lastPackage?.clouds || []).forEach((c) => {
    if (!c.rows?.length) return;
    const base = `geoid_extract_${slugName(c.layer)}_${stamp}`;
    if (kind === "csv") {
      downloadText(`${base}.csv`, rowsToCsv(c.rows), "text/csv");
    } else {
      const features = c.rows.map((row) => ({
        type: "Feature",
        properties: row,
        geometry: {
          type: "Point",
          coordinates: [Number(row[c.lonName]), Number(row[c.latName])],
        },
      }));
      downloadText(`${base}.geojson`,
        JSON.stringify({ type: "FeatureCollection", features }), "application/geo+json");
    }
  });
}

const STYLE = [
  ".gis-extract-group-title { font: 600 0.6rem 'Exo 2','Segoe UI',sans-serif;",
  "  letter-spacing: 0.07em; text-transform: uppercase;",
  "  color: var(--skin-data, #52e4e8); margin: 0.45rem 0 0.15rem; }",
  ".gis-extract-fields { margin: 0.1rem 0 0.35rem 1.55rem; }",
  ".gis-extract-fields summary { cursor: pointer; font-size: 0.62rem;",
  "  letter-spacing: 0.07em; text-transform: uppercase;",
  "  color: var(--skin-data, #52e4e8); opacity: 0.85; }",
].join("\n");

function init() {
  if (!document.getElementById("gis-extract-style")) {
    const style = document.createElement("style");
    style.id = "gis-extract-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

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
  renderAll();
  window.GeoIDImportManager?.onChange?.(renderAll);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDAnalysis = {
  runExtraction,
  getLastResult: () => lastResult,
  renderSources: renderAll,
};

// The Model Builder's seam: run the extraction and read the whole package.
window.GeoIDExtraction = {
  run: runExtraction,
  getLastPackage: () => lastPackage,
};
