import * as store from "./project-store.js?v=20260816-f3d9a1a";

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

/**
 * The same, for an export that is not text.
 *
 * A GeoTIFF or a zipped shapefile cannot go through the call above -- it would
 * be stringified, and what landed in the project would be the word "[object
 * Object]" or a corrupted transcoding. Handed to the adapter as a Blob, which
 * is what the bytes read path on the other side already expects. Without this
 * the binary exports were the only ones that downloaded but never joined the
 * project they were exported from.
 */
export async function saveExportBytes(filename, bytes, mime = "application/octet-stream", kind = "export") {
  if (!activeProject()) return null;
  const path = `exports/${filename}`;
  await store.writeProjectFile(path, new Blob([bytes], { type: mime }));
  await store.registerData({ name: filename, kind, path, source: "GIS export" });
  return path;
}

/**
 * A tool's output, filed as a dataset of the project.
 *
 * Analysis used to be a one-way street: `addDerivedLayer` puts a result on the
 * globe with no backing file, so `registerImportedLayer`/`restoreLayers` skip
 * it and every buffer, slope and susceptibility index evaporates when the page
 * reloads. This writes the result into `data/processed/` and registers it, so
 * a derived layer restores exactly like an imported one and the Repository
 * page lists it beside its inputs.
 *
 * The provenance travels with it — which tool, which parameters, which input
 * datasets, which engine — because a susceptibility raster nobody can trace is
 * a picture, not a result. `registerData` flattens `extra` onto the record, so
 * these arrive top-level where the lineage walk can read them.
 */
export async function saveProcessed(filename, contents, { mime, provenance = {} } = {}) {
  if (!activeProject()) return null;
  const path = `data/processed/${filename}`;
  await store.writeProjectFile(path,
    typeof contents === "string" ? contents : new Blob([contents], { type: mime || "application/octet-stream" }));
  await store.registerData({
    name: filename,
    // The kind the import path understands, so restoreLayers re-drapes it;
    // `stage: "processed"` is what marks it as derived rather than ingested.
    kind: provenance.outputType === "raster" ? "raster" : "vector",
    path,
    source: provenance.tool ? `Tool: ${provenance.label || provenance.tool}` : "GIS tool",
    extra: { stage: "processed", ...provenance },
  });
  return path;
}

/**
 * The study area becomes the ground the model stands on.
 *
 * `sendToGlobe`'s mirror, and the step that made the georeferencing API real:
 * `setStudioOrigin`, `wgs84ToEnu` and `getGroundInfo` were all built and had
 * zero callers, so a model was geometry floating in a scene rather than a
 * thing at a place. This anchors the studio at the study area's centre and
 * displaces its ground with the viewer's own elevation sampler — the same
 * terrain the globe draws.
 *
 * The area may be given explicitly, otherwise it is the open project's, and
 * failing that whatever is drawn on the globe right now. Longitude is signed
 * (-180..180) throughout here, as everywhere outside the viewer.
 */
export async function sendToStudio(area = null) {
  const bounds = area || activeProject()?.meta?.study_area || (() => {
    const drawn = window.GeoIDViewer?.getExtractionGeometry?.("area");
    if (!drawn?.vertices?.length) return null;
    const lats = drawn.vertices.map((v) => v.lat);
    const lons = drawn.vertices.map((v) => signedLon(v.lon));
    return {
      min_lat: Math.min(...lats), max_lat: Math.max(...lats),
      min_lon: Math.min(...lons), max_lon: Math.max(...lons),
    };
  })();
  if (!bounds) {
    throw new Error("Draw a study area on the GIS page first, or open a project that has one.");
  }
  const minLat = Number(bounds.min_lat);
  const maxLat = Number(bounds.max_lat);
  const minLon = Number(bounds.min_lon);
  const maxLon = Number(bounds.max_lon);
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  // Half the diagonal in metres: the ground must reach past the corner of the
  // area, not just to the middle of its edge.
  const radiusM = Math.hypot(
    (maxLat - minLat) * 110574,
    (maxLon - minLon) * 111320 * Math.cos(lat * Math.PI / 180),
  ) / 2;

  goToPage("model");
  // Model mode swaps the panels in; the studio's seam may be a tick behind it.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (window.GeoIDMeshStudio?.adoptStudyArea) {
      return window.GeoIDMeshStudio.adoptStudyArea({ lat, lon, radiusM });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The Meshing Studio did not come up.");
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
/**
 * Fly the globe to the open project's study area.
 *
 * Aimed by FEEDBACK rather than by a forward transform, and deliberately so.
 * A coordinate becomes a camera position through three frames — the baseline
 * one `latLonToVector3` answers in, the day's spin about Y, and the 23.44°
 * axial tilt about Z — and only the first two are exposed here. Placing a
 * point with the spin alone put the camera over the North Sea when the area
 * was in Ireland; adding the tilt fixed the latitude exactly and left the
 * longitude 25° out, because the remaining step is inside the viewer.
 *
 * So this asks the viewer where it is actually looking — `getViewCentreLatLon`
 * is the same function the on-screen readout uses, and therefore the authority
 * — and corrects by the residual. Two or three passes land inside a tenth of a
 * degree, and it stays correct if the frame chain ever changes, which a
 * hard-coded transform would not.
 */
export function frameStudyArea() {
  const project = activeProject();
  const area = project?.meta?.study_area;
  const viewer = window.GeoIDViewer;
  if (!area || !viewer?.latLonToVector3) return false;
  const nums = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => Number(area[k]));
  if (nums.some((n) => !Number.isFinite(n))) return false;
  const [minLat, maxLat, minLon, maxLon] = nums;
  const wantLat = (minLat + maxLat) / 2;
  // The viewer reads longitude east-positive 0..360; a study area is signed.
  const wantLon = ((((minLon + maxLon) / 2) % 360) + 360) % 360;

  // Pull back far enough to hold the whole extent, with a floor so a tiny area
  // does not put the camera inside the planet.
  const span = Math.max(maxLat - minLat, (maxLon - minLon) * Math.cos(wantLat * Math.PI / 180));
  const distance = viewer.GLOBE_RADIUS * Math.max(1.35, Math.min(4, 1.2 + span / 18));

  const place = (lat, lon) => {
    const point = viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS);
    const spin = viewer.getSpinDeltaRadians?.() || 0;
    const tilt = viewer.getAxialTiltRadians?.() || 0;
    // Vector3s borrowed from the camera rather than importing three.js here:
    // a second copy of the library breaks class identity across the viewer.
    const yAxis = viewer.camera.position.clone().set(0, 1, 0);
    const zAxis = viewer.camera.position.clone().set(0, 0, 1);
    point.applyAxisAngle(yAxis, spin);
    point.applyAxisAngle(zAxis, tilt);
    viewer.camera.position.copy(point).setLength(distance);
    viewer.controls?.target.set(0, 0, 0);
    viewer.controls?.update();
  };

  /** Shortest signed way round the circle, so 359 -> 1 is +2 and not -358. */
  const wrap = (d) => ((d + 540) % 360) - 180;

  let aimLat = wantLat;
  let aimLon = wantLon;
  place(aimLat, aimLon);
  for (let pass = 0; pass < 4; pass += 1) {
    const at = viewer.getViewCentreLatLon?.();
    if (!at || !Number.isFinite(at.lat)) break;      // no readout: one shot is all we have
    const dLat = wantLat - at.lat;
    const dLon = wrap(wantLon - at.lon);
    if (Math.abs(dLat) < 0.1 && Math.abs(dLon) < 0.1) break;
    aimLat = Math.max(-89, Math.min(89, aimLat + dLat));
    aimLon = ((aimLon + dLon) % 360 + 360) % 360;
    place(aimLat, aimLon);
  }
  return true;
}


// ── Research result → GIS globe ───────────────────────────────────────────────

/** Extensions the GIS import pipeline can place on the globe. */
const GEO_EXTENSIONS = new Set([
  "tif", "tiff", "geotiff", "geojson", "json", "shp", "gpkg", "kml", "kmz",
  "gpx", "wkt", "csv", "xyz", "asc", "stl", "obj", "ply", "msh",
]);

/** Whether a path is something the globe can show — for gating a "Show on globe" button. */
export function isGeoFile(path) {
  const ext = String(path || "").split(".").pop().toLowerCase();
  return GEO_EXTENSIONS.has(ext);
}

/** Read a project file and wrap it as a File the import pipeline accepts. */
async function projectFileAsFile(path) {
  const raw = await store.readProjectFileBytes(path);
  const blob = raw instanceof Blob ? raw
    : raw instanceof ArrayBuffer ? new Blob([raw])
    : new Blob([typeof raw === "string" ? raw : new Uint8Array(raw)]);
  const name = path.split("/").pop();
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/** The registry kinds that were globe layers, as `registerImportedLayer` tags them. */
const LAYER_KINDS = new Set(["raster", "vector", "layer"]);

/**
 * Re-drape the open project's layers onto the globe.
 *
 * The other half of the round trip: `registerImportedLayer` copies every
 * imported layer into the project and records its path, so on reopening a
 * project those files can be read back and run through the import pipeline
 * again — the globe comes back with the same overlays instead of bare. Only
 * file-backed spatial layers are restored (a derived layer with no file cannot
 * be), and anything already on the globe is skipped, so calling it twice is
 * safe. Never throws: a project that will not fully restore should still open.
 */
let restoreInFlight = null;

export async function restoreLayers() {
  // Opening a project announces, and more than one thing listens — project.js
  // restores on the change, and a page or a script may ask directly. Each call
  // used to snapshot "what is already on the globe" BEFORE importing anything,
  // so two overlapping calls both decided every layer was missing and imported
  // the lot twice. Sharing one in-flight promise makes the second caller wait
  // for the first rather than race it.
  if (restoreInFlight) return restoreInFlight;
  restoreInFlight = (async () => {
    if (!activeProject()) return 0;
    const manager = window.GeoIDImportManager;
    if (!manager?.importFileList) return 0;
    let entries = [];
    try { entries = await store.listData(); } catch (error) { return 0; }
    const restorable = entries.filter((e) =>
      LAYER_KINDS.has(e.kind) && e.path && isGeoFile(e.path));
    let restored = 0;
    for (const entry of restorable) {
      // Re-read the layer list each time rather than trusting a snapshot: the
      // loop awaits, and anything at all may have added a layer meanwhile.
      const present = new Set((manager.getLayers?.() || []).map((l) => l.name));
      if (present.has(entry.name)) continue;
      try {
        await manager.importFileList([await projectFileAsFile(entry.path)]);
        restored += 1;
      } catch (error) {
        // A layer whose file has moved or won't parse must not stop the rest.
        console.warn(`[GeoID] could not restore layer ${entry.name}:`, error.message);
      }
    }
    return restored;
  })();
  try {
    return await restoreInFlight;
  } finally {
    restoreInFlight = null;
  }
}

/**
 * Send a project file back onto the globe.
 *
 * The return path the workspace was missing: an analysis result — a classified
 * raster, an extracted vector, a mesh — reappears on the planet it came from
 * instead of dead-ending in `exports/`. Rather than a second georeferencing
 * path, it reads the file out of the project and hands it to the *same* import
 * pipeline the GIS page uses for a dropped file, so a GeoTIFF drapes and a
 * GeoJSON draws exactly as they would on import.
 *
 * `target` is a registry entry or a project-relative path. Bytes, not text, so
 * a binary raster survives the trip.
 */
export async function sendToGlobe(target) {
  if (!activeProject()) throw new Error("Open a project first.");
  const path = typeof target === "string" ? target : (target?.path || "");
  if (!path) throw new Error("That result has no file to show.");
  if (!isGeoFile(path)) {
    throw new Error(`${path.split("/").pop()} is not a spatial file the globe can place.`);
  }
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    throw new Error("The GIS viewer is not ready yet.");
  }

  const file = await projectFileAsFile(path);
  // Show the globe, then import — the layer is meaningless behind the Research
  // page it was launched from.
  window.GeoIDModeManager?.setMode?.("gis");
  await manager.importFileList([file]);
  return true;
}

/**
 * Fill a coordinate by clicking the globe instead of typing it.
 *
 * FEM probe locations, station coordinates and study bounds are all typed by
 * hand today; this lets a Research form ask the globe. Switches to GIS so there
 * is a globe to click, then resolves the picked point. Returns the viewer's
 * east-positive 0..360 longitude *and* the signed -180..180 the project schema
 * and any file want, so the caller uses whichever it needs. Rejects if the
 * viewer has no picker or the user presses Escape.
 */
export async function pickOnGlobe() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.pickOnGlobe) throw new Error("The globe is not ready to pick from.");
  window.GeoIDModeManager?.setMode?.("gis");
  const { lat, lon } = await viewer.pickOnGlobe();
  return { lat, lon, lonSigned: signedLon(lon) };
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
