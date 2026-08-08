import * as store from "./project-store.js?v=20260808-402e82b";

/**
 * What makes the three pages one workspace.
 *
 * Without this the Research page is a third tab: a layer imported on the GIS
 * page belongs to nothing, a mesh built in the studio is saved nowhere in
 * particular, and a project is a folder no other page has heard of. The bridge
 * gives every page the same answer to "what am I working on".
 *
 * Deliberately one-way per concern, so there is no loop to chase: the GIS and
 * Model pages *report* into the project, and the project *offers* context back
 * when it is opened. Nothing here writes to a page's own state behind its back.
 */

function activeProject() {
  return store.getActive();
}

/** East-positive 0..360 (what the viewer carries) to signed -180..180. */
function signedLon(lon) {
  const wrapped = ((Number(lon) % 360) + 540) % 360 - 180;
  return wrapped;
}

/** True when there is somewhere to record things. */
export function isArmed() {
  return Boolean(activeProject());
}

// ── GIS → project ─────────────────────────────────────────────────────────────

/**
 * The Area tool's polygon becomes the project's study area.
 *
 * Bounds rather than the ring itself, because that is the shape the Qt schema
 * carries and what every consumer of it expects. The ring is kept alongside in
 * the project folder so nothing is thrown away.
 */
export async function captureStudyArea() {
  const project = activeProject();
  if (!project) throw new Error("Open a project first.");
  const geometry = window.GeoIDViewer?.getExtractionGeometry?.("area");
  if (!geometry?.vertices?.length) {
    throw new Error("Draw an area on the GIS page first (Area tool).");
  }
  const lats = geometry.vertices.map((v) => v.lat);
  // The viewer works in east-positive 0..360; EPSG:4326, GeoJSON and the Qt
  // app all mean signed -180..180. Written out unconverted, a study area over
  // Sicily was recorded at longitude 315 and would have been read as the
  // mid-Atlantic by anything downstream.
  const lons = geometry.vertices.map((v) => signedLon(v.lon));
  const bounds = {
    min_lat: String(Math.min(...lats).toFixed(6)),
    max_lat: String(Math.max(...lats).toFixed(6)),
    min_lon: String(Math.min(...lons).toFixed(6)),
    max_lon: String(Math.max(...lons).toFixed(6)),
    crs: "EPSG:4326",
  };
  if (Number(bounds.max_lon) - Number(bounds.min_lon) > 180) {
    // Signed min/max cannot describe a box that wraps past 180; saying so beats
    // silently recording its complement.
    throw new Error("That area crosses the antimeridian; bounds cannot be recorded as min/max longitude.");
  }
  await store.updateMetadata({ study_area: bounds });
  // The drawn ring, as GeoJSON, so the exact shape survives the reduction to a
  // box and can be re-used for clipping later.
  const ring = geometry.vertices.map((v) => [signedLon(v.lon), v.lat]);
  ring.push(ring[0]);
  await store.writeJson("metadata/study_area.geojson", {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: geometry.name || "study-area" },
      geometry: { type: "Polygon", coordinates: [ring] },
    }],
  });
  return bounds;
}

/**
 * Record an imported layer against the project.
 *
 * The file itself is copied into data/raw when it came from disk, so the
 * project is self-contained rather than a set of paths into someone's
 * Downloads folder. Layers built by a tool have no file to copy and are
 * recorded by reference.
 */
export async function registerImportedLayer(layer, file) {
  if (!activeProject()) return null;
  let path = "";
  if (file) {
    try {
      const buffer = await file.arrayBuffer();
      path = `data/raw/${file.name}`;
      await store.writeProjectFile(path, new Blob([buffer]));
    } catch (error) {
      // A failed copy must not lose the record of the layer.
      path = "";
    }
  }
  return store.registerData({
    name: layer.name,
    kind: layer.raster ? "raster" : layer.collection ? "vector" : layer.kind || "layer",
    path,
    source: layer.metadata?.source || "",
    crs: layer.metadata?.crs || "",
    bounds: layer.bounds || null,
  });
}

/** Extraction output goes to the project rather than the downloads folder. */
export async function saveExport(filename, text, kind = "export") {
  if (!activeProject()) return null;
  const path = `exports/${filename}`;
  await store.writeProjectFile(path, text);
  await store.registerData({ name: filename, kind, path, source: "GIS extraction" });
  return path;
}

// ── Model → project ───────────────────────────────────────────────────────────

/** A mesh built or imported in the studio belongs in the project's meshes/. */
export async function saveMesh(filename, contents, extra = {}) {
  if (!activeProject()) throw new Error("Open a project first.");
  const path = `meshes/${filename}`;
  await store.writeProjectFile(path, contents);
  await store.registerData({ name: filename, kind: "mesh", path, source: "Meshing Studio", extra });
  return path;
}

// ── project → GIS ─────────────────────────────────────────────────────────────

/** Frame the globe on the open project's study area. */
export function frameStudyArea() {
  const project = activeProject();
  const area = project?.meta?.study_area;
  const viewer = window.GeoIDViewer;
  if (!area || !viewer?.latLonToVector3) return false;
  const nums = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => Number(area[k]));
  if (nums.some((n) => !Number.isFinite(n))) return false;
  const [minLat, maxLat, minLon, maxLon] = nums;
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;

  const point = viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS);
  // Same frame correction every pinned thing needs: coordinates answer in the
  // globe's baseline frame while the globe itself has spun on.
  const spin = viewer.getSpinDeltaRadians?.() || 0;
  const axis = viewer.camera.position.clone().set(0, 1, 0);
  point.applyAxisAngle(axis, spin);

  // Pull back far enough to hold the whole extent, with a floor so a tiny area
  // does not put the camera inside the planet.
  const span = Math.max(maxLat - minLat, (maxLon - minLon) * Math.cos(lat * Math.PI / 180));
  const distance = viewer.GLOBE_RADIUS * Math.max(1.35, Math.min(4, 1.2 + span / 18));
  viewer.camera.position.copy(point).setLength(distance);
  viewer.controls?.target.set(0, 0, 0);
  viewer.controls?.update();
  return true;
}

// ── Cross-page navigation ─────────────────────────────────────────────────────

/**
 * Hand off to a page that already exists rather than rebuilding it here.
 * The Research stages for GIS, Preprocessing and Mesh are entry points, not
 * second copies of tools that took a fortnight to get right.
 */
export function goToPage(mode, options = {}) {
  const manager = window.GeoIDModeManager;
  if (!manager?.setMode) return false;
  manager.setMode(mode);
  if (options.openSection) {
    const node = document.getElementById(options.openSection);
    if (node) {
      node.open = true;
      node.scrollIntoView({ block: "nearest" });
    }
  }
  return true;
}

export function summary() {
  const project = activeProject();
  if (!project) return { open: false };
  const area = project.meta.study_area || {};
  const hasArea = ["min_lat", "max_lat", "min_lon", "max_lon"]
    .every((k) => String(area[k] || "").trim() !== "");
  return {
    open: true,
    name: project.name,
    dir: project.dir,
    phase: project.meta.phase,
    priority: project.meta.priority,
    // Which world the project is about, so pages can say so without reaching
    // past the bridge into the store.
    body: project.meta.body || "earth",
    meta: project.meta,
    hasStudyArea: hasArea,
    studyArea: hasArea ? area : null,
  };
}
