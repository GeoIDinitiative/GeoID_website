import * as THREE from "../vendor/three.module.js";
import { loadStlFromArrayBuffer } from "./stl-loader-adapter.js?v=20260808-61e2197";
import { loadGeoTiffFromArrayBuffer, buildRasterLayer } from "./geotiff-adapter.js?v=20260808-61e2197";
import { loadObj, loadPly, parseAsciiGrid } from "./mesh-formats.js?v=20260808-61e2197";
import { parseGeoJson, parseKml, parseGpx, parseWkt } from "./vector-formats.js?v=20260808-61e2197";
import { buildVectorLayerResult } from "./vector-render.js?v=20260808-61e2197";
import { loadShapefile } from "./shapefile-adapter.js?v=20260808-61e2197";
import { loadXyzPoints } from "./xyz-adapter.js?v=20260808-61e2197";
import { loadMshFile } from "./msh-adapter.js?v=20260808-61e2197";
import { frameGlobeBounds, placeLocalModel } from "./geo-utils.js?v=20260808-61e2197";
import { buildLayerProperties } from "./layer-properties.js?v=20260808-61e2197";

// Sidecars are consumed by the parser of their primary file, so they must not
// each spawn their own layer row.
const SIDECAR_EXTENSIONS = new Set(["dbf", "shx", "prj", "cpg", "sbn", "sbx", "qix", "aux"]);

const RECOGNIZED_EXTENSIONS = new Set([
  "stl", "tif", "tiff", "msh", "xyz", "csv", "pts", "shp", "geojson", "json",
  "kml", "gpx", "wkt", "asc", "obj", "ply",
]);

const PARSERS = {
  stl: async (file) => {
    const result = await loadStlFromArrayBuffer(await file.arrayBuffer(), { name: file.name });
    return { ...result, georeferenced: false };
  },
  tif: async (file) => loadGeoTiffFromArrayBuffer(await file.arrayBuffer(), { name: file.name }),
  shp: async (file, ctx) => loadShapefile(file, ctx),
  xyz: async (file) => loadXyzPoints(file),
  msh: async (file, ctx) => loadMshFile(file, ctx),
  obj: async (file) => loadObj(file),
  ply: async (file) => loadPly(file),
  geojson: async (file) => buildVectorLayerResult(
    parseGeoJson(await file.text()), { name: file.name },
  ),
  kml: async (file) => buildVectorLayerResult(parseKml(await file.text()), { name: file.name }),
  gpx: async (file) => buildVectorLayerResult(parseGpx(await file.text()), { name: file.name }),
  wkt: async (file) => buildVectorLayerResult(parseWkt(await file.text()), { name: file.name }),
  asc: async (file) => {
    const grid = await parseAsciiGrid(file);
    return buildRasterLayer([grid.band], grid.width, grid.height, grid.bounds, {
      name: file.name, noData: NaN,
    });
  },
};
PARSERS.tiff = PARSERS.tif;
PARSERS.pts = PARSERS.xyz;
// .json is ambiguous, but GeoJSON is by far the most likely GIS payload; the
// parser reports a clear error if it is something else.
PARSERS.json = PARSERS.geojson;

// Georeferenced layers must live inside the globe's own group: that group
// carries Earth's axial tilt and spin, so anything parented to the scene root
// instead would sit ~23 degrees off the geography it describes. Models with no
// geography stay in world space.
let geoGroup = null;
let localGroup = null;
let nextLayerId = 1;
const layers = [];
const layerListeners = [];

function notifyLayerChange() {
  layerListeners.forEach((fn) => {
    try { fn(layers); } catch (error) { console.error("[GeoID GIS] layer listener failed", error); }
  });
}

function getViewer() {
  return window.GeoIDViewer || null;
}

function getExtension(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function getBaseName(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

/**
 * Georeferenced imports carry the globe's spin.
 *
 * Coordinates convert into the globe's baseline frame -- where the texture is
 * laid out -- while the globe turns with simulated UTC. The scene group these
 * layers hang from applies no spin, so a coastline placed from its own
 * coordinates sat however far the planet had turned since midnight, drifting
 * further as the day went on. Held every frame rather than set once, because
 * the globe keeps turning while a layer is loaded.
 */
function holdSpin() {
  const step = () => {
    const viewer = getViewer();
    // Taken from the globe's own rotation rather than recomputed from the
    // clock: the globe carries a half-turn on top of the spin, and two
    // parallel derivations of the same angle are two things that can drift
    // apart. This way the layers use whatever the planet is actually at.
    const globeY = viewer?.globe?.rotation?.y;
    if (geoGroup && Number.isFinite(globeY)) {
      geoGroup.rotation.y = globeY - Math.PI;
    }
    window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function ensureGroups() {
  const viewer = getViewer();
  if (!viewer || !viewer.scene) {
    return null;
  }
  if (!geoGroup) {
    geoGroup = new THREE.Group();
    geoGroup.name = "GeoID-ImportedGeoLayers";
    (viewer.earthSceneGroup || viewer.scene).add(geoGroup);
    holdSpin();
  }
  if (!localGroup) {
    localGroup = new THREE.Group();
    localGroup.name = "GeoID-ImportedLocalModels";
    // Also parented to the globe group: once a model is georeferenced it must
    // rotate with the planet, and an ungeoreferenced model parked on the
    // surface should stay put rather than sliding as the globe turns.
    (viewer.earthSceneGroup || viewer.scene).add(localGroup);
  }
  return { geoGroup, localGroup };
}

function frameLocalObject(object3D, boundingSphere) {
  const viewer = getViewer();
  if (!viewer?.camera || !viewer?.controls) {
    return;
  }
  const sphere = boundingSphere && Number.isFinite(boundingSphere.radius) && boundingSphere.radius > 0
    ? boundingSphere
    : new THREE.Box3().setFromObject(object3D).getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const distance = radius * 2.6;
  viewer.controls.target.set(0, 0, 0);
  viewer.camera.position.set(distance * 0.6, distance * 0.45, distance * 0.6);
  viewer.camera.updateProjectionMatrix();
  viewer.controls.update();
}

/** Re-places every non-georeferenced layer after a mode change. */
function reapplyPlacement(mode) {
  layers.forEach((layer) => {
    if (layer.object3D) {
      placeLocalModel(layer.object3D, mode);
    }
  });
}

function frameResult(result) {
  const mode = window.GeoIDModeManager?.getMode?.();
  if (result.georeferenced && result.bounds) {
    if (mode === "gis" || mode === "geoid") {
      frameGlobeBounds(result.bounds);
    }
    return;
  }
  if (mode === "model") {
    frameLocalObject(result.object3D, result.boundingSphere);
  }
}

function setStatus(message) {
  const node = document.getElementById("import-status");
  if (node) {
    node.textContent = message;
  }
}

function describeLayer(layer) {
  if (layer.status !== "loaded") {
    return "";
  }
  const info = layer.info || {};
  const parts = [];
  if (info.width && info.height) {
    parts.push(`${info.width}x${info.height}`);
  }
  if (Number.isFinite(info.min) && Number.isFinite(info.max)) {
    parts.push(`${Math.round(info.min)} to ${Math.round(info.max)}`);
  }
  if (Number.isFinite(info.featureCount)) {
    parts.push(`${info.featureCount} features`);
  }
  if (Number.isFinite(info.pointCount)) {
    parts.push(`${info.pointCount.toLocaleString()} points`);
  }
  if (Number.isFinite(info.triangleCount)) {
    parts.push(`${info.triangleCount.toLocaleString()} triangles`);
  }
  if (info.projected) {
    parts.push("projected CRS - shown locally");
  }
  if (info.truncated) {
    parts.push("truncated - too many vertices");
  }
  return parts.join(" | ");
}

function renderLayerList() {
  notifyLayerChange();
  const listNode = document.getElementById("import-layer-list");
  if (!listNode) {
    return;
  }
  listNode.innerHTML = "";
  // Nothing loaded needs no sentence about it: in the dock the basemap row is
  // already there, and in the import panel the buttons above say what to do.
  if (!layers.length) return;
  layers.forEach((layer) => {
    const item = document.createElement("div");
    item.className = "import-layer-item";

    const info = document.createElement("div");
    info.className = "import-layer-info";

    const textWrap = document.createElement("div");
    textWrap.className = "import-layer-text";
    const nameEl = document.createElement("span");
    nameEl.className = "import-layer-name";
    nameEl.textContent = layer.name;
    textWrap.appendChild(nameEl);
    const detail = describeLayer(layer);
    if (detail) {
      const detailEl = document.createElement("span");
      detailEl.className = "import-layer-detail";
      detailEl.textContent = detail;
      textWrap.appendChild(detailEl);
    }

    const badge = document.createElement("span");
    const badgeStatus = layer.status === "loaded" ? "loaded" : layer.status;
    badge.className = `import-layer-badge import-layer-badge-${badgeStatus}`;
    badge.textContent = layer.status === "loaded"
      ? layer.ext.toUpperCase()
      : layer.status === "error"
        ? "Error"
        : layer.status === "loading"
          ? "Loading"
          : "Coming soon";
    info.appendChild(textWrap);
    info.appendChild(badge);

    const actions = document.createElement("div");
    actions.className = "import-layer-actions";

    if (layer.status === "loaded" && layer.object3D) {
      const visibilityBtn = document.createElement("button");
      visibilityBtn.type = "button";
      visibilityBtn.className = "button secondary import-layer-btn";
      visibilityBtn.textContent = layer.object3D.visible ? "Hide" : "Show";
      visibilityBtn.addEventListener("click", () => {
        layer.object3D.visible = !layer.object3D.visible;
        renderLayerList();
      });
      actions.appendChild(visibilityBtn);

      const focusBtn = document.createElement("button");
      focusBtn.type = "button";
      focusBtn.className = "button secondary import-layer-btn";
      focusBtn.textContent = "Focus";
      focusBtn.addEventListener("click", () => frameResult(layer));
      actions.appendChild(focusBtn);

      const propsBtn = document.createElement("button");
      propsBtn.type = "button";
      propsBtn.className = "button secondary import-layer-btn";
      propsBtn.textContent = layer.propsOpen ? "Close" : "Style";
      propsBtn.addEventListener("click", () => {
        layer.propsOpen = !layer.propsOpen;
        renderLayerList();
      });
      actions.appendChild(propsBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button secondary import-layer-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeLayer(layer.id));
    actions.appendChild(removeBtn);

    item.appendChild(info);
    item.appendChild(actions);
    listNode.appendChild(item);

    if (layer.propsOpen && layer.status === "loaded" && layer.object3D) {
      listNode.appendChild(buildLayerProperties(layer));
    }
  });
}

function disposeObject(object3D) {
  object3D.traverse?.((child) => {
    child.geometry?.dispose?.();
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        entry?.map?.dispose?.();
        entry?.dispose?.();
      });
    } else if (material) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  });
}

function removeLayer(id) {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index === -1) {
    return;
  }
  const [layer] = layers.splice(index, 1);
  if (layer.object3D) {
    layer.object3D.parent?.remove(layer.object3D);
    disposeObject(layer.object3D);
  }
  renderLayerList();
}

/**
 * One logical dataset: a primary file plus any sidecars sharing its base name
 * (shapefiles being the main case).
 */
async function importDataset(primaryFile, sidecars) {
  const ext = getExtension(primaryFile.name);
  const layer = {
    id: nextLayerId++,
    name: primaryFile.name,
    ext,
    status: "loading",
    object3D: null,
    bounds: null,
    georeferenced: false,
    info: null,
  };
  layers.push(layer);
  renderLayerList();

  const parser = PARSERS[ext];
  if (!parser) {
    layer.status = "unsupported";
    setStatus(RECOGNIZED_EXTENSIONS.has(ext)
      ? `${primaryFile.name} is recognized (.${ext}) but this format isn't parsed yet.`
      : `${primaryFile.name} has an unrecognized format.`);
    renderLayerList();
    return;
  }

  const groups = ensureGroups();
  if (!groups) {
    layer.status = "error";
    setStatus("Viewer is not ready yet.");
    renderLayerList();
    return;
  }

  setStatus(`Reading ${primaryFile.name}...`);
  try {
    // Large meshes take seconds to stream, so progress is surfaced rather than
    // leaving the panel looking frozen.
    const totalBytes = primaryFile.size || 0;
    let lastReport = 0;
    const onProgress = (bytesSeen) => {
      const now = performance.now();
      if (now - lastReport < 250) {
        return;
      }
      lastReport = now;
      const pct = totalBytes ? Math.min(99, Math.round((bytesSeen / totalBytes) * 100)) : null;
      setStatus(pct === null
        ? `Reading ${primaryFile.name}...`
        : `Reading ${primaryFile.name}... ${pct}%`);
    };
    const result = await parser(primaryFile, { sidecars, onProgress });
    layer.object3D = result.object3D;
    layer.bounds = result.bounds || null;
    layer.georeferenced = Boolean(result.georeferenced);
    layer.boundingSphere = result.boundingSphere || null;
    layer.info = result.info || null;
    layer.sampler = result.sampler || null;
    layer.features = result.features || null;
    // Retained so the geoprocessing and raster toolboxes can operate on this
    // layer without re-parsing the source file.
    layer.collection = result.collection || null;
    layer.raster = result.raster || null;
    layer.status = "loaded";
    (layer.georeferenced ? groups.geoGroup : groups.localGroup).add(result.object3D);
    placeLocalModel(result.object3D, window.GeoIDModeManager?.getMode?.());
    frameResult(layer);
    setStatus(`Loaded ${primaryFile.name}.`);
    // An import belongs to whatever project is open, so the Research page's
    // repository and the Qt app both see it. Silent when none is open, and
    // never allowed to fail the import it is only annotating.
    try {
      await window.GeoIDResearch?.bridge?.registerImportedLayer?.(layer, primaryFile);
    } catch (error) {
      console.warn("[GeoID GIS] could not record the import on the project:", error.message);
    }
  } catch (error) {
    console.error("[GeoID GIS] import failed", error);
    layer.status = "error";
    setStatus(`Failed to load ${primaryFile.name}: ${error.message}`);
  }
  renderLayerList();
}

async function importFileList(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    return;
  }
  const sidecarsByBase = new Map();
  const primaries = [];
  files.forEach((file) => {
    if (SIDECAR_EXTENSIONS.has(getExtension(file.name))) {
      const base = getBaseName(file.name);
      if (!sidecarsByBase.has(base)) {
        sidecarsByBase.set(base, []);
      }
      sidecarsByBase.get(base).push(file);
    } else {
      primaries.push(file);
    }
  });

  if (!primaries.length) {
    setStatus("Only sidecar files were selected. Include the main .shp/.tif/.stl file too.");
    return;
  }

  for (const file of primaries) {
    await importDataset(file, sidecarsByBase.get(getBaseName(file.name)) || []);
  }
}

async function walkDirectoryHandle(dirHandle, files) {
  for await (const [, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      files.push(await handle.getFile());
    } else if (handle.kind === "directory") {
      await walkDirectoryHandle(handle, files);
    }
  }
}

async function browseFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      await importFileList(files);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setStatus(`File selection failed: ${error.message}`);
      }
    }
    return;
  }
  document.getElementById("import-file-input")?.click();
}

async function browseFolder() {
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const files = [];
      await walkDirectoryHandle(dirHandle, files);
      await importFileList(files);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setStatus(`Folder selection failed: ${error.message}`);
      }
    }
    return;
  }
  document.getElementById("import-folder-input")?.click();
}

function init() {
  document.getElementById("import-browse-files")?.addEventListener("click", browseFiles);
  document.getElementById("import-browse-folder")?.addEventListener("click", browseFolder);
  document.getElementById("import-file-input")?.addEventListener("change", (event) => {
    importFileList(event.target.files);
    event.target.value = "";
  });
  document.getElementById("import-folder-input")?.addEventListener("change", (event) => {
    importFileList(event.target.files);
    event.target.value = "";
  });
  renderLayerList();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.addEventListener("geoid-gis:mode-change", (event) => {
  reapplyPlacement(event.detail?.mode);
});

export function registerParser(ext, parser) {
  PARSERS[ext] = parser;
}

/**
 * Registers a layer produced by a tool rather than a file. Processing output
 * becomes a first-class layer so it can be styled, re-processed and exported
 * exactly like imported data.
 */
export function addDerivedLayer(name, result, ext = "derived") {
  const groups = ensureGroups();
  if (!groups || !result?.object3D) {
    return null;
  }
  const layer = {
    id: nextLayerId++,
    name,
    ext,
    status: "loaded",
    object3D: result.object3D,
    bounds: result.bounds || null,
    georeferenced: Boolean(result.georeferenced),
    boundingSphere: result.boundingSphere || null,
    info: result.info || null,
    sampler: result.sampler || null,
    features: result.features || null,
    collection: result.collection || null,
    raster: result.raster || null,
    derived: true,
  };
  layers.push(layer);
  (layer.georeferenced ? groups.geoGroup : groups.localGroup).add(result.object3D);
  placeLocalModel(result.object3D, window.GeoIDModeManager?.getMode?.());
  renderLayerList();
  return layer;
}

window.GeoIDImportManager = {
  importFileList,
  removeLayer,
  registerParser,
  addDerivedLayer,
  getLayers: () => layers,
  /** Loaded layers that can be queried at a lat/lon (imported rasters). */
  getSampleableLayers: () => layers.filter((layer) => layer.status === "loaded" && layer.sampler),
  /** Loaded vector layers carrying per-feature attributes. */
  getVectorLayers: () => layers.filter((layer) => layer.status === "loaded" && layer.features?.length),
  onChange: (fn) => layerListeners.push(fn),
};
