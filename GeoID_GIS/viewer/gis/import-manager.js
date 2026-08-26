import * as THREE from "../vendor/three.module.js";
import { loadStlFromArrayBuffer } from "./stl-loader-adapter.js?v=20260826-820cd84";
import { loadGeoTiffFromArrayBuffer, buildRasterLayer } from "./geotiff-adapter.js?v=20260826-820cd84";
import { loadObj, loadPly, parseAsciiGrid } from "./mesh-formats.js?v=20260826-820cd84";
import { parseGeoJson, parseKml, parseGpx, parseWkt } from "./vector-formats.js?v=20260826-820cd84";
import {
  buildVectorLayerResult, setRenderRelief, setLineDrapeFromAltitude,
  setMarkerSizeFromAltitude,
} from "./vector-render.js?v=20260826-820cd84";
import { loadShapefile } from "./shapefile-adapter.js?v=20260826-820cd84";
import { loadXyzPoints } from "./xyz-adapter.js?v=20260826-820cd84";
import { loadMshFile } from "./msh-adapter.js?v=20260826-820cd84";
import { frameGlobeBounds, placeLocalModel } from "./geo-utils.js?v=20260826-820cd84";

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
  // ctx carries the Add-data dialog's answers -- dropping it, as this line did,
  // silently discarded the chosen column mapping and re-guessed.
  //
  // csv/pts/txt were never registered at all, while the import panel's accept
  // list advertised .csv -- so choosing one landed a layer marked "unsupported"
  // and the format was offered but not read. Same reader for all four.
  xyz: async (file, ctx) => loadXyzPoints(file, ctx),
  csv: async (file, ctx) => loadXyzPoints(file, ctx),
  pts: async (file, ctx) => loadXyzPoints(file, ctx),
  txt: async (file, ctx) => loadXyzPoints(file, ctx),
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
 * further as the day went on.
 *
 * **This is synced from the renderer's own frame, not from a rAF of our own,
 * and the difference is not academic.** The simulation runs a 16-day cycle, so
 * the globe turns at **3 degrees a second** -- 193 km of ground a second at
 * Northern Ireland's latitude. A callback in a separate rAF cannot be ordered
 * against the viewer's render loop, so it copied the rotation the globe had on
 * the PREVIOUS frame: measured, that is 0.05 degrees at 60 fps and 0.2 degrees
 * at 15 fps, which is **3.2 to 12.9 km** of ground. The geology was painted
 * that far from where the pick believed it was, the median BGS polygon is
 * 1.4 km2, and the error changed from frame to frame -- so a polygon could be
 * clickable, unclickable, or answer as its neighbour on consecutive clicks.
 *
 * `scene.onBeforeRender` is called by WebGLRenderer.render at the top of the
 * frame being drawn, so the group is placed with the same rotation the globe
 * is about to be drawn with. Zero lag by construction rather than by tolerance.
 * Any handler already on the scene is kept and called.
 */
function syncSpin(scene) {
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
    // The globe's terrain exaggeration eases off as the camera lands, so a
    // layer built at the slider's value would hang above a planet that has
    // shrunk under it -- 219 km of it at the default. The vertices carry their
    // displacement and this is the exaggeration they are drawn at, so every
    // imported layer follows the ground down in the same frame the ground moves.
    setRenderRelief(viewer?.getEffectiveRelief?.() ?? 0);
    // A line needs clearance the way a fill does not, and a fixed clearance is
    // an altitude you fly under. Given the distance to the surface, so a fault
    // trace is 11.9 km up from orbit and a couple of metres up on the ground.
    const zoom = viewer?.getZoomAltitudeMetres?.();
    if (zoom) {
      const units = (zoom.metres / 6371000) * 3.2;
      setLineDrapeFromAltitude(units);
      // Marker sprites grow a little as the ground comes up to meet them: a
      // 7 px triangle is right from orbit and lost against full-resolution
      // imagery on the ground.
      setMarkerSizeFromAltitude(units);
    }
  };
  if (scene && typeof scene.onBeforeRender === "function") {
    const previous = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = function chained(...args) {
      step();
      previous(...args);
    };
    return;
  }
  if (scene) {
    scene.onBeforeRender = step;
    return;
  }
  // No scene to hang it on: keep the old behaviour rather than no behaviour.
  const loop = () => { step(); window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
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
    syncSpin(viewer.scene);
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

/**
 * Data arriving stops the planet.
 *
 * The globe turns off simulated UTC, which is the right idle behaviour and the
 * wrong one the moment something lands on it: you add a shapefile in order to
 * LOOK at it, and it immediately walks off the limb. Every world already owns
 * a pause — it is the toggle in the corner and the space bar — so this asks
 * the viewer rather than turning the globe from outside, and the toggle stays
 * truthful because `pauseSpin` syncs it.
 *
 * It is not a one-shot: resuming the spin and then adding another layer means
 * wanting to see that one too. It never fails an import — a viewer that has
 * not finished booting simply has no seam yet.
 */
function holdTheGlobe() {
  try {
    const viewer = window.GeoIDViewer;
    if (viewer?.isSpinPaused?.()) return;
    viewer?.setSpinPaused?.(true);
  } catch (error) {
    console.warn("[GeoID GIS] could not pause the globe:", error.message);
  }
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
    // A layer that loaded has a row of its own in the hierarchy above, with its
    // actions in that row's drop-down. Listing it again here put the same layer
    // on the screen twice -- once as a row you could reorder and fade, once as
    // a strip of buttons -- so what is left in this list is the states the row
    // cannot show: still loading, failed, or a format not read yet.
    if (layer.status === "loaded" && layer.object3D) return;

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

    // The properties panel moved to the layer hierarchy's own row drawer, which
    // is where the layer it belongs to is. Nothing left in this list opens it.
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
  /**
   * An ADOPTED layer's geometry is not ours to destroy.
   *
   * It was built and is owned by whoever adopted it out — the events feed
   * rebuilds its markers on every refresh — so removing the row hands the
   * decision back rather than disposing a group its owner still holds a
   * reference to. Without this, taking Events off the layer list left the feed
   * pushing points into a disposed buffer.
   */
  if (layer.adopted) {
    try { layer.onRemove?.(layer); } catch (error) {
      console.warn("[GeoID GIS] adopted layer could not be released:", error.message);
    }
    renderLayerList();
    return;
  }
  if (layer.object3D) {
    layer.object3D.parent?.remove(layer.object3D);
    disposeObject(layer.object3D);
  }
  renderLayerList();
}

/**
 * Take an object ALREADY IN THE SCENE into the layer list.
 *
 * `addDerivedLayer` reparents what it is given into the imported group, which
 * is right for something built to be a layer and wrong for something that is
 * already somewhere specific. The events feed is the case: its markers hang in
 * `eonet-spin-frame`, which carries the spin its own way, and moving them into
 * the imported group — which carries it differently — would slide every marker
 * off its ground. So this records the layer and touches the scene graph not at
 * all.
 *
 * Re-adopting the same name replaces the object rather than adding a second
 * row, because the owner may rebuild it: the feed refreshes and hands over a
 * new group, and the row, its place in the stack and its visibility survive.
 */
export function adoptLayer(name, object3D, options = {}) {
  if (!object3D || !name) return null;
  const existing = layers.find((layer) => layer.adopted && layer.name === name);
  if (existing) {
    existing.object3D = object3D;
    if (existing.visible === false) object3D.visible = false;
    renderLayerList();
    return existing;
  }
  const layer = {
    id: nextLayerId++,
    name,
    ext: options.ext || "adopted",
    role: options.role || null,
    status: "loaded",
    object3D,
    bounds: options.bounds || null,
    georeferenced: true,
    info: options.info || null,
    legendInfo: options.legendInfo || null,
    adopted: true,
    onRemove: options.onRemove || null,
    // Straight to the top of the stack, above everything currently loaded. See
    // the note on `bandOf` for why it STAYS there until somebody moves it.
    stackIndex: layers.reduce((n, l) => Math.max(n, l.stackIndex ?? 0), 0) + 1,
  };
  layers.push(layer);
  renderLayerList();
  return layer;
}

/** Drop an adopted layer's row without touching its geometry. */
export function releaseLayer(name) {
  const index = layers.findIndex((layer) => layer.adopted && layer.name === name);
  if (index === -1) return false;
  layers.splice(index, 1);
  renderLayerList();
  return true;
}

/**
 * One logical dataset: a primary file plus any sidecars sharing its base name
 * (shapefiles being the main case).
 */
async function importDataset(primaryFile, sidecars, options = {}) {
  const ext = getExtension(primaryFile.name);
  const layer = {
    id: nextLayerId++,
    name: options.name || primaryFile.name,
    // Which panel asked for this -- vector, basemap, geology, mesh. Null for a
    // dropped file, which is still a first-class way in.
    role: options.role || null,
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
    // The Add-data dialog's answers -- CRS, column mapping, symbology -- reach
    // the adapter here. An import with none of them behaves exactly as before,
    // which is what keeps drag-and-drop and the project's restoreLayers working.
    const result = await parser(primaryFile, { sidecars, onProgress, ...options });
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
    // The key has to say what the map is drawn in; without this it fell back
    // to the material's colour, and a textured drape has none worth reading.
    layer.legendInfo = result.legendInfo || null;
    layer.repaint = result.repaint || null;
    // Symbology chosen in the Add-data dialog, applied through the SAME path the
    // symbology panel's Apply uses -- so a layer looks the same when it lands as
    // it does the moment somebody opens that panel. Imported lazily because the
    // panel is a module that may load after this one, and never allowed to fail
    // the import it is only decorating.
    //
    // BEFORE `status = "loaded"`, and that ordering is the point: this step
    // awaits a dynamic import, so with it afterwards the layer was observably
    // "loaded" and unstyled for as long as that fetch took. Anything watching
    // for loaded -- the layer list, the hierarchy, a test -- could act on the
    // adapter's own colours and see the chosen ramp arrive a moment later.
    if (options.symbology) {
      try {
        const { applyImportSymbology } =
          await import(`./symbology-panel.js${new URL(import.meta.url).search}`);
        layer.symbologyApplied = applyImportSymbology(layer, options.symbology);
      } catch (error) {
        console.warn("[GeoID GIS] symbology could not be applied on import:", error.message);
      }
    }
    layer.status = "loaded";
    (layer.georeferenced ? groups.geoGroup : groups.localGroup).add(result.object3D);
    placeLocalModel(result.object3D, window.GeoIDModeManager?.getMode?.());
    /**
     * An import moves the camera to what arrived — EXCEPT when the caller says
     * not to, and that exception is load-bearing.
     *
     * Framing is right for a file somebody dropped: they want to see it. It is
     * wrong for a layer that rebuilds itself. The tiled world geology refetches
     * when the view settles, and each rebuild framed its bounds — the whole
     * planet — so the camera was thrown back out to a global view, which
     * changed the view, which settled, which triggered another rebuild. A
     * feedback loop wearing the clothes of a rendering bug: "mapping is super
     * unstable, jumps back zoom views".
     */
    if (options.frame !== false) frameResult(layer);
    holdTheGlobe();
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

async function importFileList(fileList, options = {}) {
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
    await importDataset(file, sidecarsByBase.get(getBaseName(file.name)) || [], options);
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
    legendInfo: result.legendInfo || null,
    // Carried so a layer can be re-classified without re-importing it.
    repaint: result.repaint || null,
    derived: true,
  };
  layers.push(layer);
  (layer.georeferenced ? groups.geoGroup : groups.localGroup).add(result.object3D);
  placeLocalModel(result.object3D, window.GeoIDModeManager?.getMode?.());
  // A derived layer is data arriving too — a drawn area, a tool result, an
  // Earth Engine drape — so it holds the globe exactly as a dropped file does.
  holdTheGlobe();
  renderLayerList();
  return layer;
}

/**
 * Rename a layer, everywhere it is named.
 *
 * A layer's name is in three places that must not drift: the record the list
 * draws, the GeoJSON feature's own `name` property (which is what leaves for a
 * file and what the desktop app reads), and the project's data registry. A
 * rename that touched only the first looked right until the layer was exported
 * or the project reopened, and then it was "Drawn area 3" again.
 *
 * Returns the applied name, which is not always the one asked for: blank is
 * refused rather than allowed to erase the only handle the layer has.
 */
function renameLayer(target, name) {
  const layer = typeof target === "object" && target
    ? target
    : layers.find((l) => String(l.id) === String(target));
  const wanted = String(name ?? "").trim();
  if (!layer || !wanted) return null;
  layer.name = wanted;
  // A drawn shape carries its name in the feature, and that is the copy that
  // survives an export.
  const feature = layer.collection?.features?.[0];
  if (feature?.properties) feature.properties.name = wanted;
  if (layer.object3D) layer.object3D.name = wanted;
  renderLayerList();
  window.GeoIDLayerHierarchy?.render?.();
  notifyLayerChange();
  return wanted;
}

/**
 * Free-form metadata on a layer, kept where an export will carry it.
 *
 * Written onto the feature's properties for a drawn layer -- so "surveyed by",
 * "confidence", whatever the work needs, travels with the geometry -- and onto
 * the layer record otherwise, where nothing downstream would lose it.
 */
function setLayerMetadata(target, entries) {
  const layer = typeof target === "object" && target
    ? target
    : layers.find((l) => String(l.id) === String(target));
  if (!layer || !entries || typeof entries !== "object") return null;
  const feature = layer.collection?.features?.[0];
  const sink = feature?.properties || (layer.meta = layer.meta || {});
  Object.entries(entries).forEach(([key, value]) => {
    const k = String(key).trim();
    if (!k) return;
    if (value === null || value === "") delete sink[k];
    else sink[k] = value;
  });
  renderLayerList();
  window.GeoIDLayerHierarchy?.render?.();
  notifyLayerChange();
  return sink;
}

window.GeoIDImportManager = {
  importFileList,
  renameLayer,
  setLayerMetadata,
  removeLayer,
  registerParser,
  addDerivedLayer,
  adoptLayer,
  releaseLayer,
  getLayers: () => layers,
  /** Frame a layer in the view, and say what it is -- both moved to the
      hierarchy row's drop-down, which is where a layer's actions live now. */
  frameLayer: frameResult,
  describeLayer,
  /** Loaded layers that can be queried at a lat/lon (imported rasters). */
  getSampleableLayers: () => layers.filter((layer) => layer.status === "loaded" && layer.sampler),
  /** Loaded vector layers carrying per-feature attributes. */
  getVectorLayers: () => layers.filter((layer) => layer.status === "loaded" && layer.features?.length),
  onChange: (fn) => layerListeners.push(fn),
};
