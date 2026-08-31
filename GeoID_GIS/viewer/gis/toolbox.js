import { CRS_OPTIONS, transform } from "./projection.js?v=20260831-d888e00";
import { currentBody } from "./bodies.js?v=20260831-d888e00";
import { rowsToCsv, downloadText } from "./extraction.js?v=20260831-d888e00";

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
  if (!home?.parent) return;
  // The recorded sibling may have been moved somewhere else since -- on a
  // planet page the shell is injected between these elements and orderTabs
  // then rearranges them, so a node recorded as "next" can end up in the
  // toolbox. insertBefore throws when that happens, and the throw reached the
  // viewer's boot handler and took the whole page down on the way to Research.
  // Falling back to the right container is the honest reading of "put it back".
  const next = home.next && home.next.parentNode === home.parent ? home.next : null;
  home.parent.insertBefore(element, next);
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
    // `import-data-section` is no longer a panel -- it is a hidden box holding
    // the file inputs and the layer list, and must not be collected as one.
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
  { id: "gis-analysis-section", host: "analysis-tools-host" },
  { id: "import-layer-list", host: "layers-tools-host" },
  // Straight into the tab bar, not into shells of their own: each already has
  // its own header, so wrapping it in another section showed the title twice
  // and buried the controls a level deeper than they belong.
  { id: "basemap-relief-section", host: "gis-toolbox-panels", promote: true },
  { id: "geology-section", host: "gis-toolbox-panels", promote: true },
  { id: "modelled-data-section", host: "gis-toolbox-panels", promote: true },
  /**
   * The two-tier bar: Hydrology and Satellites nest under Earth System
   * Observation (the tracker observes the system it orbits), and the
   * myGeoID mode bar under Hazards — the Factor-of-Safety pipeline IS the
   * landslide hazard product, so its doorway leads that tab. Nested, not
   * promoted, so they wear the level-2 styling.
   *
   * `unlessDropped`: on a body whose registry drops the would-be parent
   * (planets drop the Earth Engine group), the section is NOT nested into a
   * hidden tab — it stays a top tab of its own, which is how Mars keeps its
   * sea level reachable. `tabsForBody` makes the matching call on the other
   * side, re-listing the section as a tab exactly when the nest is skipped —
   * unless the section is itself dropped on that body, as the myGeoID bar
   * is off Earth.
   */
  { id: "sea-level-section", host: "earth-system-water-host", unlessDropped: "gis-group-modelled" },
  { id: "satellites-section", host: "earth-system-satellites-host", unlessDropped: "gis-group-modelled" },
  { id: "gis-group-geoid", host: "hazards-mygeoid-host", unlessDropped: "modelled-data-section" },
  // Sources and metadata belong with the layer provenance they sit beside.
  { id: "metadata-section", host: "geoid-metadata-host" },
];

// The tab bar, in the order it reads. Every tab is gathered into one parent so
// the sequence is this list and the spacing is one rule, rather than an
// accident of which container each panel happened to be moved into.
/**
 * Pre-processing, Extraction & Analysis, Export and Settings are NOT here.
 *
 * They live on the tool rail as workbenches (`gis/side-panels.js`), which moves
 * their groups out of this column. Leaving them in this list would append them
 * straight back on the next `orderTabs`, which runs on every mode change.
 */
const TAB_ORDER = [
  /**
   * Workspace is NOT a tab — it is the always-visible corner box
   * (`#layer-dock`, see dockLayers), which holds the add-data doorways and
   * the layer hierarchy. The bar reads: Live (what is happening), Explorer
   * (the globe itself), Basemaps (what dresses the sphere), Geology, Earth
   * System Observation, Hazards. Hydrology, Satellites and the myGeoID bar
   * are NOT entries either: they nest inside Earth System Observation and
   * Hazards (see MOVES), except on a body where the parent is dropped —
   * `tabsForBody` re-lists them there.
   */
  "gis-group-events",
  "geoid-controls-group",
  "basemap-relief-section",
  "geology-section",
  "gis-group-modelled",
  "modelled-data-section",
  // Meshes are a Model concern rather than a GIS layer, so they sit after the
  // data tabs and before the outputs. Built by add-data.js, not by the shared
  // markup -- see that module for why.
  "gis-group-mesh",
  // Metadata stays ONE tab: provenance is a property of a layer, not of a
  // subject, and each layer's own row and card already carry its source
  // line — splitting this per tab would be seven filtered copies of one
  // registry, the two-lists-for-one-dataset trap with a new face.
  "gis-group-metadata",
  // Export and Settings used to close this list; both are rail workbenches
  // now (see the note above the list). The trap their absence leaves behind:
  // a group in the markup that is neither listed here nor moved by
  // side-panels.js stays behind in `gis-panel-host`, the toolbox's FIRST
  // child, and reads as pinned to the top of the column — which is exactly
  // how Settings once earned its entry.
];

/**
 * The tabs this world actually gets.
 *
 * Off Earth, some panels have nothing behind them: the Analysis Hub models an
 * Earth hazard, the Events feed is NASA EONET, and Earth Engine is Earth's.
 * Those are dropped by the body registry rather than by a check here, so a new
 * world is a record rather than another branch. Panels that simply do not
 * exist in a viewer -- most planets have no basemap or sea-level section --
 * need no entry at all: the loop below already skips what it cannot find,
 * which is why Mars keeps its sea level and the gas giants silently do not.
 */
function tabsForBody() {
  const drop = new Set(currentBody()?.tabs?.drop || []);
  const tabs = TAB_ORDER.filter((id) => !drop.has(id));
  /**
   * A section whose parent tab is dropped on this body un-nests back into
   * the bar, at the position its parent would have held — the other half of
   * MOVES' `unlessDropped`. Without this, Mars's sea level would sit inside
   * a hidden Earth System tab, reachable by nobody.
   */
  MOVES.forEach((move) => {
    if (!move.unlessDropped || !drop.has(move.unlessDropped)) return;
    // A section this body drops in its own right stays dropped — the myGeoID
    // bar's parent (Hazards) is dropped off Earth AND so is the bar itself,
    // and re-listing it here would resurrect an Earth-only tab on Mars.
    if (drop.has(move.id)) return;
    const at = TAB_ORDER.indexOf(move.unlessDropped);
    const before = TAB_ORDER.slice(at + 1).find((id) => tabs.includes(id));
    tabs.splice(before ? tabs.indexOf(before) : tabs.length, 0, move.id);
  });
  return tabs;
}

function orderTabs(toolbox) {
  const drop = new Set(currentBody()?.tabs?.drop || []);
  tabsForBody().forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    rememberHome(node);
    toolbox.appendChild(node);
  });
  // A dropped panel is hidden rather than left loose in the sidebar, where it
  // would still be reachable and still be empty.
  drop.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.hidden = true;
  });
}

/**
 * The layer hierarchy is not a step in the workflow, it is a view of what is
 * loaded -- so it sits in its own box in the corner rather than at the bottom
 * of a list that has to be scrolled past.
 */
/**
 * The corner box IS the Workspace — always on screen while the nav bar is,
 * which is the whole point of it: the working set and its controls never
 * fold away behind a tab. The merger ran the other way around first (the
 * hierarchy nested into a Workspace TAB) and was rejected in one look:
 * the box, not the tab, is the thing that must stay visible. So the tab
 * is GONE from TAB_ORDER, its add-data machinery (+ Data / + GEE /
 * Custom, status, notes) moves into the box above the layer hierarchy
 * (add-data.js targets `#workspace-add-host`, first in the dock body),
 * and the old import cards stay dead — the hierarchy rows carry strictly
 * more, without the "1 polygon" count text. The emptied
 * `gis-group-polygons` shell hides, or it would sit pinned at the top of
 * the column (the trap the TAB_ORDER note documents).
 */
function dockLayers(enabled) {
  const dock = document.getElementById("layer-dock-body");
  const panel = document.getElementById("gis-group-layers");
  const box = document.getElementById("layer-dock");
  const workspace = document.getElementById("gis-group-polygons");
  const stack = workspace?.querySelector(".control-stack");
  if (!dock || !panel || !box) return;
  if (enabled) {
    if (stack) {
      rememberHome(stack);
      dock.appendChild(stack);
    }
    rememberHome(panel);
    panel.open = true;
    dock.appendChild(panel);
  } else {
    restoreHome(panel);
    if (stack) restoreHome(stack);
  }
  if (workspace) workspace.hidden = enabled;
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
    const dropped = new Set(currentBody()?.tabs?.drop || []);
    MOVES.forEach((move) => {
      const { id, host } = move;
      // A nest whose parent tab this body drops is skipped — tabsForBody
      // re-lists the section as a top tab instead, promoted below.
      if (move.unlessDropped && dropped.has(move.unlessDropped)) {
        const element = document.getElementById(id);
        if (element) {
          rememberHome(element);
          element.classList.add("toolbox-group");
        }
        return;
      }
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
