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

import { latLonToVector3, drapedRadius } from "./geo-utils.js?v=20260808c";

/**
 * The deployed service. Shipped with the app rather than configured per browser:
 * it is a public URL guarding nothing, and requiring every visitor to paste it
 * in meant the panel opened unconfigured for everyone but whoever set it.
 *
 * What protects it is ALLOWED_ORIGINS on the deployment, not obscurity here.
 */
const DEFAULT_ENDPOINT = "https://europe-west2-geoid-504623.cloudfunctions.net/geeImage";
const ENDPOINT_KEY = "geoid-gis:gee-endpoint";
const byId = (id) => document.getElementById(id);

let THREE = null;

/**
 * Where the service lives. Held in storage rather than compiled in, so the
 * endpoint can be pointed at a local deployment while testing without editing
 * and redeploying the site.
 */
/** The override if one is set, otherwise the deployed service. */
function endpoint() {
  try {
    return window.localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
  } catch (error) {
    return DEFAULT_ENDPOINT;
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
    // The viewer returns "vertices"; reading "points" found nothing, so the
    // polygon option always reported that no shape had been drawn.
    const geometry = window.GeoIDViewer?.getExtractionGeometry?.("polygon");
    const vertices = geometry?.vertices;
    if (Array.isArray(vertices) && vertices.length >= 3) {
      const lons = vertices.map((v) => v.lon);
      const lats = vertices.map((v) => v.lat);
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

/**
 * The window to ask for. Defaults to the last sixty days, which is wide enough
 * for the eight- and sixteen-day composites to contain something, and puts the
 * fields in step with what was actually requested.
 */
function dateRange() {
  const fromField = byId("gee-date-from");
  const toField = byId("gee-date-to");
  const iso = (d) => d.toISOString().slice(0, 10);
  let to = toField?.value || iso(new Date());
  let from = fromField?.value || iso(new Date(Date.parse(to) - 60 * 86400000));
  if (Date.parse(from) >= Date.parse(to)) {
    // Rather than refuse, widen backwards from the end: a single date is a
    // reasonable thing to type and an unreasonable thing to be told off for.
    from = iso(new Date(Date.parse(to) - 60 * 86400000));
  }
  if (fromField) fromField.value = from;
  if (toField) toField.value = to;
  return { from, to };
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
  // Above the displaced terrain, not just above sea level. The basemap is
  // relief-displaced, so a drape 0.6% up was buried under every landmass --
  // which is precisely where a land product draws. The event markers needed the
  // same clearance for the same reason. Kept just under their 1.05, so a pin
  // still reads over the imagery.
  const radius = (window.GeoIDViewer?.GLOBE_RADIUS || 3.2) * 1.045;
  const vertex = new THREE.Vector3();
  for (let y = 0; y <= segments; y += 1) {
    const lat = bounds.maxY - (bounds.maxY - bounds.minY) * (y / segments);
    for (let x = 0; x <= segments; x += 1) {
      const lon = bounds.minX + (bounds.maxX - bounds.minX) * (x / segments);
      vertex.copy(latLonToVector3(lat, lon, radius));
      // Half a turn into the globe's own frame: the viewer reads lat/lon from
      // the globe by undoing its rotation less pi, so content that is to ride
      // the globe must bake that pi back in.
      vertex.set(-vertex.x, vertex.y, -vertex.z);
      position.setXYZ(y * (segments + 1) + x, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  // The vertices have been moved from a flat 1x1 plane onto the globe, so the
  // bounds computed at construction describe something that is no longer there.
  // Left stale, three.js culls the patch against a half-metre sphere at the
  // origin and it is simply never drawn -- which looks exactly like a failed
  // request, but with the layer sitting in the list.
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  // A patch can span a hemisphere, where its bounding sphere reaches well past
  // the camera even when most of it is in view.
  mesh.frustumCulled = false;
  // Above the basemap and the shells over it, the same clearance the event
  // markers need to survive the depth test.
  mesh.renderOrder = 6;
  return mesh;
}

async function request() {
  const url = endpoint();
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
        // Named so it is clear which tool draws it: the shape comes from the
      // viewer's Area measurement, not from a drawing mode of this panel.
      status("No polygon drawn. Use the Area tool, or switch to Current view.");
      return;
    }
    const params = new URLSearchParams({
      dataset,
      bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
        .map((n) => n.toFixed(4)).join(","),
    });
    // Both dates are always sent, filled from a sensible window when blank.
    // Sending only one left the service to default the other, which could land
    // on or before the date given and ask for a range of no length.
    const { from, to } = dateRange();
    params.set("from", from);
    params.set("to", to);

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
      // Onto the globe itself, so the imagery turns with the texture it
      // annotates. In the group beside it, the patch held still while the
      // planet rotated underneath, drifting a degree every four minutes.
      window.GeoIDViewer?.globe?.add?.(object3D);
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
    // "Failed to fetch" is what a browser reports for a blocked cross-origin
    // request, and it says nothing about the cause. The page's own origin is
    // named here because that is the thing that has to be on the service's
    // allowlist, and reading it back is usually enough to spot the mismatch.
    const blocked = /failed to fetch|networkerror|load failed/i.test(error.message || "");
    status(blocked
      ? `Could not reach the service from ${window.location.origin}. `
        + "That origin is probably not on the service's allowed list, "
        + "or the service is down."
      : `Request failed: ${error.message}`);
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
  if (field) {
    field.value = endpoint();
    // Named so it is clear whether the field is showing the shipped service or
    // an override someone has set.
    field.placeholder = DEFAULT_ENDPOINT;
  }
  byId("gee-endpoint-save")?.addEventListener("click", () => {
    setEndpoint(byId("gee-endpoint")?.value.trim() || "");
    loadCatalogue();
  });
  byId("gee-request")?.addEventListener("click", request);

  loadCatalogue();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDEarthEngine = { request, setEndpoint, getEndpoint: endpoint };
