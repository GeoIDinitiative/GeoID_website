import { CRS_OPTIONS, transform } from "./projection.js?v=20260809n";
import { rowsToCsv, downloadText } from "./extraction.js?v=20260809n";

// GIS mode presents a toolbox rather than a control centre: the whole GeoID
// control set folds into one group, and the tool groups stack beneath it.
// Panels are moved rather than duplicated so their existing listeners and state
// survive, and their original position is recorded so GeoID mode can be
// restored exactly.
const homes = new Map();

function rememberHome(element) {
  if (element && !homes.has(element)) {
    homes.set(element, { parent: element.parentNode, next: element.nextSibling });
  }
}

function restoreHome(element) {
  const home = homes.get(element);
  if (home?.parent) {
    home.parent.insertBefore(element, home.next);
  }
}

/**
 * The GeoID control set is not a flat list: Tour Mode sits directly in the
 * scroll body while the rest live inside a `.controls` wrapper. Both are moved
 * so the group keeps the original ordering and nesting intact.
 */
function geoidPanels() {
  const host = document.getElementById("ui-scroll-body");
  if (!host) {
    return [];
  }
  const ours = new Set([
    "geoid-controls-group", "import-data-section", "gis-analysis-section",
    "gis-toolbox-panels", "gis-group-geoid", "gis-group-events",
  ]);
  return [...host.children].filter((child) => {
    if (ours.has(child.id) || child.classList?.contains("toolbox-group")) {
      return false;
    }
    return child.classList?.contains("control-section") || child.classList?.contains("controls");
  });
}

// Panels lifted out of Explorer into sections of their own. Explorer collects
// every globe control first, and these are pulled back out afterwards, so the
// promotion is expressed here rather than by teaching the collector exceptions.
const MOVES = [
  { id: "import-data-section", host: "import-tools-host" },
  { id: "gis-analysis-section", host: "analysis-tools-host" },
  { id: "import-layer-list", host: "layers-tools-host" },
  // Straight into the tab bar, not into shells of their own: each already has
  // its own header, so wrapping it in another section showed the title twice
  // and buried the controls a level deeper than they belong.
  { id: "basemap-relief-section", host: "gis-toolbox-panels", promote: true },
  { id: "geology-section", host: "gis-toolbox-panels", promote: true },
  { id: "sea-level-section", host: "gis-toolbox-panels", promote: true },
  { id: "modelled-data-section", host: "gis-toolbox-panels", promote: true },
  // Sources and metadata belong with the layer provenance they sit beside.
  { id: "metadata-section", host: "geoid-metadata-host" },
];

// The tab bar, in the order it reads. Every tab is gathered into one parent so
// the sequence is this list and the spacing is one rule, rather than an
// accident of which container each panel happened to be moved into.
const TAB_ORDER = [
  "gis-group-geoid",
  "gis-group-import",
  "gis-group-polygons",
  "gis-group-preprocess",
  "gis-group-events",
  "geoid-controls-group",
  "basemap-relief-section",
  "geology-section",
  "gis-group-modelled",
  "sea-level-section",
  "modelled-data-section",
  "gis-group-analysis",
  "gis-group-export",
  "gis-group-metadata",
];

function orderTabs(toolbox) {
  TAB_ORDER.forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    rememberHome(node);
    toolbox.appendChild(node);
  });
}

/**
 * The layer hierarchy is not a step in the workflow, it is a view of what is
 * loaded -- so it sits in its own box in the corner rather than at the bottom
 * of a list that has to be scrolled past.
 */
function dockLayers(enabled) {
  const dock = document.getElementById("layer-dock-body");
  const panel = document.getElementById("gis-group-layers");
  const box = document.getElementById("layer-dock");
  if (!dock || !panel || !box) return;
  if (enabled) {
    rememberHome(panel);
    panel.open = true;
    dock.appendChild(panel);
  } else {
    restoreHome(panel);
  }
  box.hidden = !enabled;
}

export function applyToolboxLayout(enabled) {
  const group = document.getElementById("geoid-controls-group");
  const panelsHost = document.getElementById("geoid-controls-host");
  const toolbox = document.getElementById("gis-toolbox-panels");
  if (!group || !panelsHost || !toolbox) {
    return;
  }

  if (enabled) {
    geoidPanels().forEach((panel) => {
      rememberHome(panel);
      panelsHost.appendChild(panel);
    });
    MOVES.forEach((move) => {
      const { id, host } = move;
      const element = document.getElementById(id);
      const target = document.getElementById(host);
      if (element && target) {
        rememberHome(element);
        // Promoted panels sit in the tab bar as peers, so they keep the group
        // styling rather than the nested styling.
        element.classList.add(move.promote ? "toolbox-group" : "toolbox-nested");
        target.appendChild(element);
      }
    });
    // Weather is no longer offered as a tab. Hidden rather than deleted, so the
    // viewer's own code can still reach its controls.
    const weather = document.getElementById("weather-section");
    if (weather) weather.hidden = true;

    orderTabs(toolbox);
    group.hidden = false;
    toolbox.hidden = false;
    dockLayers(true);
  } else {
    dockLayers(false);
    const weather = document.getElementById("weather-section");
    if (weather) weather.hidden = false;
    [...panelsHost.children].forEach(restoreHome);
    MOVES.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        element.classList.remove("toolbox-nested", "toolbox-group");
        restoreHome(element);
      }
    });
    group.hidden = true;
    toolbox.hidden = true;
  }
}

// ── Coordinate transformer ──────────────────────────────────────────────────

function fillCrsSelect(select, selected) {
  CRS_OPTIONS.filter((option) => option.id !== "none").forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.textContent = option.label;
    if (option.id === selected) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function runCrsConversion() {
  const from = document.getElementById("crs-from")?.value;
  const to = document.getElementById("crs-to")?.value;
  const x = Number(document.getElementById("crs-in-x")?.value);
  const y = Number(document.getElementById("crs-in-y")?.value);
  const result = document.getElementById("crs-result");
  if (!result) {
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    result.textContent = "Enter both coordinates.";
    return;
  }
  const out = transform(x, y, from, to);
  if (!out) {
    result.textContent = "That conversion is not supported.";
    return;
  }
  const decimals = to === "epsg:4326" ? 6 : 2;
  const labels = to === "epsg:4326" ? ["lon", "lat"] : ["X", "Y"];
  result.textContent = `${labels[0]} ${out.x.toFixed(decimals)}  |  ${labels[1]} ${out.y.toFixed(decimals)}`;
}

/** Seeds the transformer from wherever the camera is currently looking. */
function useViewCentre() {
  const viewer = window.GeoIDViewer;
  const result = document.getElementById("crs-result");
  if (!viewer?.camera || !viewer.earthSceneGroup) {
    return;
  }
  const group = viewer.earthSceneGroup;
  group.updateMatrixWorld();
  const local = viewer.camera.position.clone()
    .applyMatrix4(group.matrixWorld.clone().invert())
    .normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, local.y))) * (180 / Math.PI);
  // Inverse of latLonToVector3's x/z construction.
  const lon = Math.atan2(local.z, -local.x) * (180 / Math.PI);
  const fromSelect = document.getElementById("crs-from");
  if (fromSelect) {
    fromSelect.value = "epsg:4326";
  }
  document.getElementById("crs-in-x").value = lon.toFixed(6);
  document.getElementById("crs-in-y").value = lat.toFixed(6);
  if (result) {
    result.textContent = `View centre ${lat.toFixed(4)}, ${lon.toFixed(4)} - press Convert.`;
  }
}

// ── Project summary ─────────────────────────────────────────────────────────

function refreshProjectSummary() {
  const node = document.getElementById("project-summary");
  if (!node) {
    return;
  }
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  const loaded = layers.filter((layer) => layer.status === "loaded");
  if (!loaded.length) {
    node.textContent = "No layers loaded.";
    return;
  }
  const georeferenced = loaded.filter((layer) => layer.georeferenced || layer.georef).length;
  const sampleable = (window.GeoIDImportManager?.getSampleableLayers?.() || []).length;
  const byKind = {};
  loaded.forEach((layer) => { byKind[layer.ext] = (byKind[layer.ext] || 0) + 1; });
  const kinds = Object.entries(byKind).map(([ext, n]) => `${n} ${ext.toUpperCase()}`).join(", ");
  node.innerHTML = `<strong>${loaded.length}</strong> layers (${kinds})<br>`
    + `${georeferenced} georeferenced, ${sampleable} sampleable`;
}

// ── Raster sampling ─────────────────────────────────────────────────────────

function sampleRasters() {
  const lat = Number(document.getElementById("raster-lat")?.value);
  const lon = Number(document.getElementById("raster-lon")?.value);
  const out = document.getElementById("raster-sample-result");
  if (!out) {
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    out.textContent = "Enter a latitude and longitude.";
    return;
  }
  const lines = [];
  const viewer = window.GeoIDViewer;
  if (viewer?.sampleElevationMeters) {
    const lon360 = ((lon % 360) + 360) % 360;
    const elevation = viewer.sampleElevationMeters(lat, lon360);
    const slope = viewer.estimateSurfaceSlopeDegrees?.(lat, lon360);
    lines.push(`<strong>GeoID DEM</strong> ${Number.isFinite(elevation) ? `${elevation.toFixed(1)} m` : "-"}`
      + `${Number.isFinite(slope) ? `, slope ${slope.toFixed(2)}deg` : ""}`);
  }
  (window.GeoIDImportManager?.getSampleableLayers?.() || []).forEach((layer) => {
    const value = layer.sampler(lat, lon);
    if (value === null || value === undefined) {
      lines.push(`<strong>${layer.name}</strong> outside layer`);
    } else if (typeof value === "object") {
      const summary = Object.entries(value)
        .filter(([, v]) => v !== null && v !== "")
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      lines.push(`<strong>${layer.name}</strong> ${summary || "no attributes"}`);
    } else {
      lines.push(`<strong>${layer.name}</strong> ${value.toFixed(2)}`);
    }
  });
  out.innerHTML = lines.length ? lines.join("<br>") : "No raster layers to sample.";
}

// ── Attribute query ─────────────────────────────────────────────────────────

let queryMatches = [];

function vectorLayers() {
  return window.GeoIDImportManager?.getVectorLayers?.() || [];
}

function refreshVectorLayerSelect() {
  const select = document.getElementById("vector-layer");
  if (!select) {
    return;
  }
  const previous = select.value;
  select.innerHTML = "";
  const layers = vectorLayers();
  if (!layers.length) {
    const opt = document.createElement("option");
    opt.textContent = "No vector layers";
    opt.value = "";
    select.appendChild(opt);
    refreshVectorFieldSelect();
    return;
  }
  layers.forEach((layer) => {
    const opt = document.createElement("option");
    opt.value = String(layer.id);
    opt.textContent = layer.name;
    select.appendChild(opt);
  });
  if (previous) {
    select.value = previous;
  }
  refreshVectorFieldSelect();
}

function selectedVectorLayer() {
  const id = document.getElementById("vector-layer")?.value;
  return vectorLayers().find((layer) => String(layer.id) === id) || null;
}

function refreshVectorFieldSelect() {
  const select = document.getElementById("vector-field");
  if (!select) {
    return;
  }
  select.innerHTML = "";
  const layer = selectedVectorLayer();
  const fields = layer?.info?.fields || [];
  if (!fields.length) {
    const opt = document.createElement("option");
    opt.textContent = "No fields";
    opt.value = "";
    select.appendChild(opt);
    return;
  }
  fields.forEach((field) => {
    const opt = document.createElement("option");
    opt.value = field;
    opt.textContent = field;
    select.appendChild(opt);
  });
}

function runVectorQuery() {
  const out = document.getElementById("vector-query-result");
  const exportBtn = document.getElementById("vector-query-export");
  if (!out) {
    return;
  }
  const layer = selectedVectorLayer();
  if (!layer) {
    out.textContent = "Import a shapefile first.";
    return;
  }
  const field = document.getElementById("vector-field")?.value;
  const needle = (document.getElementById("vector-value")?.value || "").trim().toLowerCase();

  const seen = new Set();
  queryMatches = [];
  layer.features.forEach((feature) => {
    const attributes = feature.attributes;
    if (!attributes || seen.has(feature.recordIndex)) {
      return;
    }
    const value = attributes[field];
    const text = value === null || value === undefined ? "" : String(value).toLowerCase();
    if (needle && !text.includes(needle)) {
      return;
    }
    seen.add(feature.recordIndex);
    queryMatches.push(attributes);
  });

  if (!queryMatches.length) {
    out.textContent = "No features matched.";
    if (exportBtn) exportBtn.disabled = true;
    return;
  }
  // Show the most common values so the result is readable rather than a dump.
  const counts = new Map();
  queryMatches.forEach((row) => {
    const key = row[field] === null || row[field] === undefined || row[field] === ""
      ? "(blank)" : String(row[field]);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([value, count]) => `${value} (${count})`).join("<br>");
  out.innerHTML = `<strong>${queryMatches.length}</strong> features matched<br>${top}`;
  if (exportBtn) exportBtn.disabled = false;
}

function exportQueryMatches() {
  if (!queryMatches.length) {
    return;
  }
  downloadText(
    `geoid_query_${new Date().toISOString().slice(0, 10)}.csv`,
    rowsToCsv(queryMatches),
    "text/csv",
  );
}

function init() {
  const from = document.getElementById("crs-from");
  const to = document.getElementById("crs-to");
  if (from && to) {
    fillCrsSelect(from, "epsg:4326");
    fillCrsSelect(to, "epsg:32633");
  }
  document.getElementById("crs-convert")?.addEventListener("click", runCrsConversion);
  document.getElementById("crs-use-view")?.addEventListener("click", useViewCentre);
  document.getElementById("project-refresh")?.addEventListener("click", refreshProjectSummary);
  document.getElementById("raster-sample")?.addEventListener("click", sampleRasters);
  document.getElementById("vector-layer")?.addEventListener("change", refreshVectorFieldSelect);
  document.getElementById("vector-query")?.addEventListener("click", runVectorQuery);
  document.getElementById("vector-query-export")?.addEventListener("click", exportQueryMatches);

  window.GeoIDImportManager?.onChange?.(() => {
    refreshProjectSummary();
    refreshVectorLayerSelect();
  });
  refreshVectorLayerSelect();
  refreshProjectSummary();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDToolbox = { applyToolboxLayout, refreshProjectSummary, refreshVectorLayerSelect };
