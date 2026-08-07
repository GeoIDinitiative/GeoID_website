// Modelled Data: basemaps from Google Earth Engine.
//
// Earth Engine cannot be called from a static site -- doing so needs a
// credential, and anything the browser holds is public. A small service holds
// the credential instead and returns a rendered PNG with its bounds; see
// services/gee-tiles. This module knows only that endpoint's shape, so nothing
// here has to change if the service moves or its internals do.
//
// What comes back becomes an ordinary layer: it appears in the hierarchy, keeps
// its own opacity and draw order, is listed in the legend, and carries its
// source and licence into the metadata panel like anything else imported.

import { latLonToVector3, drapedRadius } from "./geo-utils.js?v=20260807q";

const ENDPOINT_KEY = "geoid-gis:gee-endpoint";
const byId = (id) => document.getElementById(id);

let THREE = null;

/**
 * Where the service lives. Held in storage rather than compiled in, so the
 * endpoint can be pointed at a local deployment while testing without editing
 * and redeploying the site.
 */
function endpoint() {
  try {
    return window.localStorage.getItem(ENDPOINT_KEY) || "";
  } catch (error) {
    return "";
  }
}

function setEndpoint(url) {
  try {
    if (url) window.localStorage.setItem(ENDPOINT_KEY, url);
    else window.localStorage.removeItem(ENDPOINT_KEY);
  } catch (error) { /* storage unavailable, ignore */ }
}

function status(message) {
  const node = byId("gee-status");
  if (node) node.textContent = message || "";
}

/** The extent to ask for: what is on screen, or a drawn polygon. */
function requestBounds() {
  const choice = byId("gee-extent")?.value || "view";
  if (choice === "polygon") {
    const geometry = window.GeoIDViewer?.getExtractionGeometry?.("polygon");
    const points = geometry?.points || geometry;
    if (Array.isArray(points) && points.length >= 3) {
      const lons = points.map((p) => p.lon ?? p[0]);
      const lats = points.map((p) => p.lat ?? p[1]);
      return {
        minX: Math.min(...lons), maxX: Math.max(...lons),
        minY: Math.min(...lats), maxY: Math.max(...lats),
      };
    }
    return null;
  }
  return viewBounds();
}

/**
 * Roughly what the camera is looking at, as a lat/lon box.
 *
 * Taken from the point the camera faces and how much of the globe is in shot,
 * rather than by projecting the sphere exactly: the request only needs to be
 * about right, and a box that is a little generous costs nothing but a slightly
 * larger picture.
 */
function viewBounds() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!camera) return null;
  const group = viewer.earthSceneGroup;
  const dir = camera.position.clone().normalize();
  if (group) {
    group.updateMatrixWorld(true);
    dir.applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert()).normalize();
  }
  // Inverse of the viewer's own lat/lon placement.
  const lat = Math.asin(Math.max(-1, Math.min(1, dir.y))) * (180 / Math.PI);
  const lon = Math.atan2(dir.z, -dir.x) * (180 / Math.PI);

  const radius = viewer.GLOBE_RADIUS || 3.2;
  const altitude = Math.max(camera.position.length() - radius, radius * 0.01);
  // Half-angle of the visible cap, widened a little so the edges are covered.
  const halfDeg = Math.min(60, (Math.acos(radius / (radius + altitude)) * (180 / Math.PI)) * 1.3);
  const latPad = halfDeg;
  // Longitude spans more degrees per kilometre towards the poles.
  const lonPad = Math.min(80, halfDeg / Math.max(Math.cos(lat * Math.PI / 180), 0.2));
  return {
    minX: Math.max(-180, lon - lonPad), maxX: Math.min(180, lon + lonPad),
    minY: Math.max(-85, lat - latPad), maxY: Math.min(85, lat + latPad),
  };
}

/** Loads the returned PNG and drapes it across its bounds on the globe. */
async function drape(imageUrl, bounds) {
  const texture = await new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(imageUrl, resolve, undefined, () => reject(
      new Error("the image could not be loaded (cross-origin or expired URL)"),
    ));
  });
  texture.colorSpace = THREE.SRGBColorSpace;

  // Enough segments to follow the curve without being costly; the patch can
  // span a hemisphere, where a flat quad would cut through the planet.
  const segments = 48;
  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position;
  // Just above the basemap, and below imported rasters, so it reads as a
  // backdrop rather than covering work laid on top of it.
  const radius = drapedRadius(0.0015);
  const vertex = new THREE.Vector3();
  for (let y = 0; y <= segments; y += 1) {
    const lat = bounds.maxY - (bounds.maxY - bounds.minY) * (y / segments);
    for (let x = 0; x <= segments; x += 1) {
      const lon = bounds.minX + (bounds.maxX - bounds.minX) * (x / segments);
      vertex.copy(latLonToVector3(lat, lon, radius));
      position.setXYZ(y * (segments + 1) + x, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
}

async function request() {
  const url = endpoint();
  if (!url) {
    status("No service configured. Set the endpoint below.");
    return;
  }
  const dataset = byId("gee-dataset")?.value;
  if (!dataset) {
    status("Choose a dataset first.");
    return;
  }
  status("Requesting…");
  byId("gee-request")?.setAttribute("disabled", "");
  try {
    // Loaded before the extent is worked out, not after: viewBounds needs it,
    // and being outside the try meant a failure there threw past the reporting
    // and left the panel showing whatever it last said.
    if (!THREE) THREE = await import("../vendor/three.module.js");

    const bounds = requestBounds();
    if (!bounds) {
      status("No extent: draw a polygon, or switch to the current view.");
      return;
    }
    const params = new URLSearchParams({
      dataset,
      bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
        .map((n) => n.toFixed(4)).join(","),
    });
    if (byId("gee-date-from")?.value) params.set("from", byId("gee-date-from").value);
    if (byId("gee-date-to")?.value) params.set("to", byId("gee-date-to").value);

    const response = await fetch(`${url}?${params}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    const object3D = await drape(data.imageUrl, data.bounds);
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      `${data.name} · ${data.from}–${data.to}`,
      { object3D, bounds: data.bounds, georeferenced: true },
      "gee",
    );
    if (layer) {
      // Recorded so the metadata panel can account for it like any import.
      layer.metadata = {
        source: `Google Earth Engine · ${data.dataset}`,
        format: "PNG composite",
        crs: data.crs || "EPSG:4326",
        citation: data.attribution,
        importedAt: new Date().toISOString(),
      };
      layer.colour = "#4fd1a5";
    }
    window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed"));
    status(`Added "${data.name}" at ${data.scale} m.`);
  } catch (error) {
    // An error is said plainly: nothing appearing because the request failed is
    // not the same as nothing being there.
    status(`Request failed: ${error.message}`);
  } finally {
    byId("gee-request")?.removeAttribute("disabled");
  }
}

/** Fills the dataset list from the service, so the two cannot drift apart. */
async function loadCatalogue() {
  const url = endpoint();
  const select = byId("gee-dataset");
  if (!url || !select) return;
  try {
    const response = await fetch(`${url}?list`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.datasets) || !data.datasets.length) return;
    select.innerHTML = '<option value="">Select a collection…</option>'
      + data.datasets.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
    status(`Service connected · ${data.datasets.length} collections.`);
  } catch (error) {
    status(`Service unreachable: ${error.message}`);
  }
}

function init() {
  const field = byId("gee-endpoint");
  if (field) field.value = endpoint();
  byId("gee-endpoint-save")?.addEventListener("click", () => {
    setEndpoint(byId("gee-endpoint")?.value.trim() || "");
    loadCatalogue();
  });
  byId("gee-request")?.addEventListener("click", request);

  if (endpoint()) loadCatalogue();
  else status("No service configured. Set the endpoint below.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDEarthEngine = { request, setEndpoint, getEndpoint: endpoint };
