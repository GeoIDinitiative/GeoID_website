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

import { latLonToVector3, drapedRadius } from "./geo-utils.js?v=20260809l";

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
  const choice = byId("gee-extent")?.value || "global";
  // The default. A climate product is global by nature, and a whole-earth
  // drape cannot be misplaced by a view calculation -- there is no wrong
  // subset of everywhere. 85 rather than 90 keeps the poles off the request,
  // where most of these products have no data and the projection degenerates.
  if (choice === "global") {
    return { minX: -180, minY: -85, maxX: 180, maxY: 85 };
  }
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
  if (!camera || !THREE) return null;
  const radius = viewer.GLOBE_RADIUS || 3.2;
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  // Read back through the globe's own frame with the same half turn the drape
  // bakes in. The old box was computed in the unrotated frame, so it sat east
  // of the view by however far the planet had spun -- which is why the imagery
  // covered half the picture and the wrong half.
  viewer.globe?.updateMatrixWorld(true);
  const toGlobe = viewer.globe
    ? new THREE.Matrix4().copy(viewer.globe.matrixWorld).invert()
    : null;
  const lats = [];
  const lons = [];
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      ray.setFromCamera(new THREE.Vector2((i / steps) * 2 - 1, (j / steps) * 2 - 1), camera);
      if (!ray.ray.intersectSphere(sphere, hit)) continue;
      const local = toGlobe ? hit.clone().applyMatrix4(toGlobe) : hit.clone();
      local.set(-local.x, local.y, -local.z);
      const r = local.length() || 1;
      lats.push(Math.asin(Math.max(-1, Math.min(1, local.y / r))) * (180 / Math.PI));
      lons.push(Math.atan2(local.z, -local.x) * (180 / Math.PI));
    }
  }
  if (lats.length < 3) return null;
  let minX = Math.min(...lons);
  let maxX = Math.max(...lons);
  if (maxX - minX > 180) {
    // Spanning the antimeridian: treat the widest gap between samples as the
    // part not being looked at, rather than asking for the whole world.
    const sorted = [...lons].sort((a, b) => a - b);
    let gap = 0;
    let at = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > gap) { gap = sorted[i] - sorted[i - 1]; at = i; }
    }
    if (gap > 60) { minX = sorted[at]; maxX = sorted[at - 1] + 360; }
  }
  const pad = Math.min(2, (maxX - minX) * 0.05);
  return {
    minX: Math.max(-180, minX - pad), maxX: Math.min(180, maxX + pad),
    minY: Math.max(-85, Math.min(...lats) - pad),
    maxY: Math.min(85, Math.max(...lats) + pad),
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
  const segments = 96;
  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position;
  // On the terrain, not floating over it. Each vertex sits on the globe's own
  // displaced surface plus a hair of clearance, so the imagery hugs the relief
  // and follows the terrain-relief slider the way the basemap does. The flat
  // 4.5 percent lift this replaces cleared the mountains by standing 290 km
  // off the ground, which read as a shell around the planet rather than an
  // overlay on it.
  const viewer = window.GeoIDViewer;
  const LIFT = 0.005;
  const vertex = new THREE.Vector3();
  for (let y = 0; y <= segments; y += 1) {
    const lat = bounds.maxY - (bounds.maxY - bounds.minY) * (y / segments);
    for (let x = 0; x <= segments; x += 1) {
      const lon = bounds.minX + (bounds.maxX - bounds.minX) * (x / segments);
      vertex.copy(viewer?.surfacePoint
        ? viewer.surfacePoint(lat, lon, LIFT)
        : latLonToVector3(lat, lon, 3.2 + LIFT));
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

  // Which way the patch faces, measured rather than assumed: the vertices were
  // walked lat-descending and lon-ascending onto a sphere, and whether that
  // leaves the outside facing out depends on details it is not worth reasoning
  // about. Taken from a vertex in the middle of the grid, where the normal is
  // well defined -- at a pole or an edge it need not be.
  const probe = Math.floor(segments / 2) * (segments + 1) + Math.floor(segments / 2);
  const normals = geometry.attributes.normal;
  const outward = new THREE.Vector3(
    position.getX(probe), position.getY(probe), position.getZ(probe),
  ).normalize();
  const facing = new THREE.Vector3(
    normals.getX(probe), normals.getY(probe), normals.getZ(probe),
  ).dot(outward);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Single-sided, so the half of the patch on the far side of the planet is
    // culled. That is what makes turning the depth test off safe below.
    side: facing >= 0 ? THREE.FrontSide : THREE.BackSide,
    depthWrite: false,
    // The overlay wins over the basemap outright instead of competing with it.
    // Competing was the bug: the patch is a grid of flat facets while the
    // basemap is displaced terrain, so between vertices the ground rose
    // through the imagery and punched holes in it. Measured, the terrain
    // stands 0.0267 above a facet centre where the clearance was 0.005 -- five
    // times too little, and raising it enough to cover the worst case would
    // have lifted the imagery off the ground everywhere else. Tessellating
    // finer does not help either: 96 to 384 segments only takes the gap from
    // 0.0267 to 0.0234, because the relief has detail below any grid.
    depthTest: false,
  }));
  // A patch can span a hemisphere, where its bounding sphere reaches well past
  // the camera even when most of it is in view.
  mesh.frustumCulled = false;
  // Drawn after the globe, which is what puts it over the basemap now that it
  // no longer depth-tests against it. Still below the event markers at 20.
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
      object3D.userData.geoidLayer = true;
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
      // The symbology, for the legend: the ramp the image was rendered with
      // and what its ends mean.
      if (data.legend || data.palette) {
        layer.legendInfo = {
          label: data.legend?.label || data.name,
          min: data.legend?.min,
          max: data.legend?.max,
          unit: data.legend?.unit || "",
          palette: data.palette,
        };
      }
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
  // Choosing a dataset fetches what it actually holds, states it, and fills the
  // boxes with the last sixty days of availability -- so the offered dates are
  // real ones rather than guesses to be refused later.
  byId("gee-dataset")?.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) return;
    status("Checking availability…");
    try {
      const r = await fetch(`${endpoint()}?dates&dataset=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.static) {
        // No time dimension, so the dates are not part of this request.
        status("Static dataset — the date range is ignored.");
        return;
      }
      status(`Published ${d.first} to ${d.last}.`);
      const to = d.last;
      const from = new Date(Math.max(Date.parse(d.first),
        Date.parse(to) - 60 * 86400000)).toISOString().slice(0, 10);
      const ff = byId("gee-date-from"); const tf = byId("gee-date-to");
      if (ff) ff.value = from;
      if (tf) tf.value = to;
      if (ff) { ff.min = d.first; ff.max = d.last; }
      if (tf) { tf.min = d.first; tf.max = d.last; }
    } catch (error) {
      status(`Availability unknown: ${error.message}`);
    }
  });
  // A click on a date opens its picker, rather than dropping a text caret into
  // the field and highlighting part of the date.
  ["gee-date-from", "gee-date-to"].forEach((id) => {
    byId(id)?.addEventListener("click", (e) => {
      try { e.target.showPicker(); } catch (err) { /* unsupported, caret is fine */ }
    });
  });

  loadCatalogue();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDEarthEngine = { request, setEndpoint, getEndpoint: endpoint };
