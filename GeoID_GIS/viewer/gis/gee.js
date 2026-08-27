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

import { attachReliefAttributes, followRelief } from "./vector-render.js?v=20260828-bd15287";
import { latLonToVector3, drapedRadius } from "./geo-utils.js?v=20260828-bd15287";
import { geeSamplerFromImage, columnName } from "./gee-sample.js?v=20260828-bd15287";
import { visibleBounds, viewChangedEnough, onViewSettled }
  from "./view-extent.js?v=20260828-bd15287";
import {
  resolvePolygonExtent, refreshPolygonOptions, promptDrawTool, drawnOverlayBounds,
  persistExtent,
} from "./extent-picker.js?v=20260828-bd15287";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260828-bd15287";

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

// The two sources the dataset list is built from. Cached snapshots ship with
// the app and always work, offline and with no credential; the live service
// fills in anything the cache does not hold, when it is reachable.
let cacheEntries = [];   // from assets/gee-cache/manifest.json
let liveDatasets = [];   // from the service's ?list, when up

// Anchored to this module, not the document: `fetch` and TextureLoader resolve
// against the page's base URL (the viewer index one directory up), so a
// document-relative "../assets/…" would miss. `import.meta.url` gives the module
// its own base, the same way the dynamic `import()` of three.js already does.
const CACHE_BASE = new URL("../assets/gee-cache/", import.meta.url);
const cacheUrl = (file) => new URL(file, CACHE_BASE).href;

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

/**
 * The extent to ask for: everywhere, what is on screen, or a polygon.
 *
 * The polygon half is `extent-picker.js`, shared with the weather card, so a
 * drawn area means the same thing to both and there is one fallback chain
 * rather than two that drift. What it adds over the old branch is everything
 * that made that branch a dead end: a named polygon still on the globe can be
 * CHOSEN (`layer:<id>`), an area captured by an earlier fetch is found when no
 * live overlay is up, and with neither the Draw tool arms itself and says so
 * instead of returning null into a status line reading "no extent".
 *
 * It also fixes a real longitude bug that was here: the viewer answers in
 * 0–360 east and this passed those numbers straight through, so a polygon over
 * the Atlantic asked Earth Engine for a bbox at longitude 315 — the middle of
 * Asia. `signedLon` is applied inside the picker now.
 */
function requestBounds() {
  const choice = byId("gee-extent")?.value || "global";
  // The default. A climate product is global by nature, and a whole-earth
  // drape cannot be misplaced by a view calculation -- there is no wrong
  // subset of everywhere. 85 rather than 90 keeps the poles off the request,
  // where most of these products have no data and the projection degenerates.
  if (choice === "global") {
    return { minX: -180, minY: -85, maxX: 180, maxY: 85 };
  }
  if (choice === "view") return viewBounds();
  const picked = resolvePolygonExtent(choice);
  if (!picked) return viewBounds();
  if (picked.error) {
    status(picked.error);
    return null;
  }
  return {
    minX: picked.west, maxX: picked.east,
    minY: picked.south, maxY: picked.north,
  };
}

/**
 * The camera's extent in this panel's own {minX,minY,maxX,maxY} shape.
 *
 * The sampling and the antimeridian handling now live in `view-extent.js`,
 * shared with the tile basemaps, which need exactly the same answer. This was a
 * second copy of it.
 */
function viewBounds() {
  const b = visibleBounds(window.GeoIDViewer, THREE);
  if (!b) return null;
  return { minX: b.minLon, maxX: b.maxLon, minY: b.minLat, maxY: b.maxLat };
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

/**
 * The ground sample of the image that actually arrived.
 *
 * `scale` in the response and the cache manifest is the DATASET's native
 * resolution — what the instrument records — not the resolution of the PNG the
 * service rendered, and the panel reported it as though it were the latter.
 * Measured across the shipped cache, every snapshot is 1024 px wide covering
 * the whole world, so the delivered sample is 39 km per pixel while the panel
 * said "at 30 m" for NASADEM: an over-claim of 1305x. Both numbers are worth
 * having and only one of them describes what is on screen.
 */
export function deliveredMetresPerPixel(bounds, image) {
  const width = image?.naturalWidth || image?.width || 0;
  if (!width || !bounds) return null;
  const spanDeg = Math.abs(Number(bounds.maxX) - Number(bounds.minX));
  const midLat = (Number(bounds.minY) + Number(bounds.maxY)) / 2;
  if (!Number.isFinite(spanDeg) || !Number.isFinite(midLat)) return null;
  // Equatorial circumference narrowed by latitude, the same convergence the
  // tile drape uses, so the two surfaces quote resolution the same way.
  const spanMetres = (spanDeg / 360) * 40075017 * Math.cos((midLat * Math.PI) / 180);
  return spanMetres / width;
}

/** A ground sample a person can read: metres up close, km once it is coarse. */
export function formatResolution(metres) {
  if (!Number.isFinite(metres) || metres <= 0) return "unknown resolution";
  if (metres >= 10000) return `${Math.round(metres / 1000)} km/px`;
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km/px`;
  if (metres >= 10) return `${Math.round(metres)} m/px`;
  return `${metres.toFixed(1)} m/px`;
}

/**
 * What to say about resolution: what arrived, and what the dataset can do.
 *
 * Naming the native scale alongside is the useful part — it is the difference
 * between "this is as good as this dataset gets" and "the service down-sampled
 * this by three orders of magnitude", and those call for different actions.
 */
function resolutionNote(bounds, image, nativeScale) {
  const delivered = deliveredMetresPerPixel(bounds, image);
  if (delivered == null) return nativeScale ? ` (dataset native ${nativeScale} m)` : "";
  const native = Number(nativeScale);
  const shortfall = Number.isFinite(native) && native > 0 ? delivered / native : null;
  return ` — ${formatResolution(delivered)}`
    + (shortfall && shortfall >= 2
      ? `, ${shortfall >= 10 ? Math.round(shortfall) : shortfall.toFixed(1)}× coarser than `
        + `this dataset's native ${native} m`
      : Number.isFinite(native) ? ` (native ${native} m)` : "");
}

/**
 * Loads a PNG and drapes it across its bounds on the globe.
 *
 * Exported because it is the ONE place the traps of draping an image on a
 * displaced sphere are answered — the relief attributes, the single-sided
 * culling that makes turning the depth test off safe, the frustum-culling
 * exemption for a patch that spans a hemisphere. `map-layers.js` drapes global
 * rasters through it rather than keeping a second copy that would drift from
 * this one the first time either was fixed.
 *
 * `segments` is the grid the patch is built on: 96 is right for an Earth
 * Engine snapshot over a study area and too coarse for a shell wrapped round
 * the whole planet, where each segment is nearly four degrees.
 */
export async function drape(imageUrl, bounds, { segments = 96 } = {}) {
  // Loaded here rather than assumed: this module fetches three.js lazily when
  // its own flow first runs, and a caller from outside — the map-overlay
  // catalogue — arrives before any of that has happened. Without this the
  // first overlay somebody ticks fails on `THREE is null`, which reads as the
  // image being broken rather than as the module not being warmed up.
  if (!THREE) THREE = await import("../vendor/three.module.js");
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
  /**
   * The bounds, in whichever of the two shapes the caller has.
   *
   * Earth Engine answers `{minX, minY, maxX, maxY}` and the rest of this app
   * says `{west, south, east, north}`. Handed the wrong one, every lat and lon
   * below came out `undefined`, every vertex came out NaN, and the result was
   * a layer that registered, drew its legend, took its place in the layer box
   * and painted absolutely nothing — which looks like a missing image rather
   * than a missing property. Refused loudly instead.
   */
  const box = {
    minX: Number(bounds?.minX ?? bounds?.west),
    maxX: Number(bounds?.maxX ?? bounds?.east),
    minY: Number(bounds?.minY ?? bounds?.south),
    maxY: Number(bounds?.maxY ?? bounds?.north),
  };
  if (!Object.values(box).every(Number.isFinite)) {
    throw new Error("bounds need minX/minY/maxX/maxY (or west/south/east/north)");
  }

  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position;
  // On the terrain, not floating over it. Each vertex sits on the globe's own
  // displaced surface plus a hair of clearance, so the imagery hugs the relief
  // and follows the terrain-relief slider the way the basemap does. The flat
  // 4.5 percent lift this replaces cleared the mountains by standing 290 km
  // off the ground, which read as a shell around the planet rather than an
  // overlay on it.
  const viewer = window.GeoIDViewer;
  // ZERO clearance. 0.005 of a 3.2 radius is 10 km, and a lift IS a floor: the
  // camera cannot descend through its own overlay, so imagery meant to be flown
  // down to stopped the approach 10 km up. Nothing is lost by dropping it,
  // because the material below refuses the depth test outright -- which is the
  // real answer to the facet-versus-relief problem the clearance never solved.
  const LIFT = 0;
  const vertex = new THREE.Vector3();
  for (let y = 0; y <= segments; y += 1) {
    const lat = box.maxY - (box.maxY - box.minY) * (y / segments);
    for (let x = 0; x <= segments; x += 1) {
      const lon = box.minX + (box.maxX - box.minX) * (x / segments);
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

  // The exaggeration eases off as the camera lands, so a patch built at the
  // slider's value would hang above a planet that has shrunk under it. Each
  // vertex carries its direction and displacement instead, and one uniform
  // places every draped layer at the relief the globe is drawn at.
  attachReliefAttributes(geometry, LIFT, Number(viewer?.getEffectiveRelief?.() ?? 0));
  const mesh = new THREE.Mesh(geometry, followRelief(new THREE.MeshBasicMaterial({
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
  }), LIFT));
  // A patch can span a hemisphere, where its bounding sphere reaches well past
  // the camera even when most of it is in view.
  mesh.frustumCulled = false;
  // Drawn after the globe, which is what puts it over the basemap now that it
  // no longer depth-tests against it. Still below the event markers at 20.
  mesh.renderOrder = 6;
  // The decoded image travels with the patch so the layer can be sampled later.
  // A drape is a picture of data; without this the picture is all there is, and
  // extraction over a rainfall layer has nothing to report.
  mesh.userData.geeImage = texture.image || null;
  return mesh;
}

/**
 * Make a drape sampleable, so extraction can put it in a column.
 *
 * The value is recovered from the rendered palette (see gee-sample.js) — a
 * reading of the picture, not the source band — so `info` records that and the
 * column carries the unit. Where the manifest has no legend there is no
 * inverse; the layer is still registered, and reports colour rather than a
 * number that could not be checked.
 */
function samplerFor(object3D, entry) {
  const image = object3D?.userData?.geeImage;
  const sampler = geeSamplerFromImage(image, {
    bounds: entry?.bounds,
    palette: entry?.palette,
    legend: entry?.legend,
  });
  if (!sampler) return {};
  const invertible = Boolean(entry?.palette && entry?.legend);
  return {
    sampler,
    info: {
      valueKind: invertible ? "values" : "colour",
      column: columnName(entry?.name, entry?.legend),
      unit: entry?.legend?.unit || "",
      recoveredFromPalette: invertible,
    },
  };
}

/**
 * Pixel budget for the request's long side. "Auto" scales with the extent —
 * a small study area deserves the detail a global request would waste — and
 * the explicit choices exist because detail is a cost the user may be paying
 * for on their own Earth Engine quota.
 */
function requestDimensions(bounds) {
  const chosen = byId("gee-res")?.value || "auto";
  if (chosen !== "auto") return Number(chosen) || 1024;
  const spanDeg = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 0.01);
  // Aim near 150 m/px, clamped to sane thumbnail sizes.
  const px = Math.round((spanDeg * 111320) / 150);
  return Math.max(256, Math.min(2048, px));
}

async function request() {
  const url = endpoint();
  const select = byId("gee-dataset");
  const dataset = select?.value;
  if (!dataset) {
    status("Choose a dataset first.");
    return;
  }
  // A cached snapshot drapes from disk; only a live dataset goes to the service.
  if (select?.selectedOptions?.[0]?.dataset.source === "cache") {
    return requestFromCache(dataset);
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
    // The service previously chose the pixel budget itself, so a study-area
    // request got the same 1024 px a global one did — over NI that is the
    // difference between ~190 m/px and ~39 km/px. Asked for explicitly now,
    // sized to the extent; the status line still reports the DELIVERED
    // resolution measured from what actually arrived, so a service that
    // ignores the parameter cannot over-claim.
    params.set("dimensions", String(requestDimensions(bounds)));

    const response = await fetch(`${url}?${params}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    const object3D = await drape(data.imageUrl, data.bounds);
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      `${data.name} · ${data.from}–${data.to}`,
      {
        object3D,
        bounds: data.bounds,
        georeferenced: true,
        ...samplerFor(object3D, data),
      },
      "gee",
    );
    if (layer) {
      /**
       * The fetch KEEPS its ground — the weather card's rule, applied to
       * every GEE pull. A shape still standing as the live drawing overlay
       * is captured into Workspace the moment data has been pulled over it,
       * so the extent is a named, project-registered layer the next fetch
       * (or the extent selects, which list Workspace layers) can reuse.
       * Guarded on the overlay standing: an extent chosen from a NAMED
       * layer has no overlay, and `captureDrawn` underneath is idempotent
       * by shape, so nothing double-captures.
       */
      const extentChoice = byId("gee-extent")?.value || "global";
      if ((extentChoice === "drawn" || extentChoice === "polygon") && drawnOverlayBounds()) {
        persistExtent({
          west: bounds.minX, south: bounds.minY,
          east: bounds.maxX, north: bounds.maxY,
        }, { mark: "fetchExtent" });
        refreshPolygonOptions(byId("gee-extent"), "global", { allLayers: true });
      }
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
    status(`Added "${data.name}"`
      + resolutionNote(bounds, object3D?.material?.map?.image, data.scale) + ".");
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

/**
 * Build the dataset dropdown from both sources: the cached snapshots first,
 * because they always work, then anything the live service adds that the cache
 * does not already hold. Rebuilt whenever either source changes.
 */
/**
 * The layer a catalogue entry is on the globe as, or null.
 *
 * Named by what it is and when: "NASADEM elevation · 2000-02-11–2000-02-22
 * (cached)". The prefix is the dataset, which is what a tick box is about.
 */
function layerForDataset(name) {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.ext === "gee" && layer.status === "loaded"
      && layer.name.startsWith(`${name} ·`)) || null;
}

/**
 * The catalogue as tick boxes rather than a dropdown.
 *
 * Rainfall beside elevation beside land surface temperature is the ordinary
 * way to look at these, and a `<select>` could only ever hold one of them —
 * with no sight of what was already draped and no way to take one off. The
 * select is still there, hidden, because it carries the state the live request
 * path reads (availability, dates, extent); the ticks drive it.
 */
/**
 * Where a dataset is OFFERED — the tab whose subject it is, never the
 * service it comes from. The Atmosphere tab (this catalogue's old home,
 * back when it was "Data · Earth Engine") keeps only the atmospheric
 * datasets; imagery and elevation belong to Basemap and Relief; burned
 * area and vegetation condition to Geohazards. Anything unmapped defaults
 * to atmosphere, so a new live dataset is never invisible.
 */
const GEE_HOMES = {
  "COPERNICUS/S2_SR_HARMONIZED": "basemap",
  "LANDSAT/LC09/C02/T1_L2": "basemap",
  "COPERNICUS/S1_GRD": "basemap",
  "NASA/NASADEM_HGT/001": "basemap",
  "COPERNICUS/DEM/GLO30": "basemap",
  "MODIS/061/MCD64A1": "geohazards",
  "MODIS/061/MOD13A2": "basemap",
  "NASA/SMAP/SPL4SMGP/007": "hydrology",
};
function geeHomeOf(id) { return GEE_HOMES[id] || "atmosphere"; }

function catalogueEntries() {
  const select = byId("gee-dataset");
  if (!select) return [];
  return [...select.options]
    .filter((option) => option.value)
    .map((option) => ({
      id: option.value,
      label: option.textContent,
      group: option.parentElement?.tagName === "OPTGROUP"
        ? option.parentElement.label : "Catalogue",
      title: option.dataset.source === "cache"
        ? "A shipped snapshot: drapes from disk, no key needed"
        : "Live service: needs a Client ID and a project in Settings",
      source: option.dataset.source,
      name: option.textContent,
      info: {
        summary: option.dataset.source === "cache"
          ? "A rendered snapshot shipped with the site — drapes from disk, no key needed. The live service refines it when connected."
          : "Requested from the live Earth Engine service — needs a Client ID and a project in Settings.",
        citation: `Google Earth Engine · ${option.value}`,
      },
    }));
}

function catalogueHooks(entries) {
  const select = byId("gee-dataset");
  return {
    layerFor: (id) => {
      const entry = entries.find((e) => e.id === id);
      return entry ? layerForDataset(entry.name) : null;
    },
    add: async (id) => {
      select.value = id;
      // The live path reads availability and dates off the select, so it has to
      // hear the change before the request is made.
      select.dispatchEvent(new Event("change"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await request();
    },
    remove: (id) => {
      const entry = entries.find((e) => e.id === id);
      const layer = entry && layerForDataset(entry.name);
      if (!layer) return;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      status(`${entry.label} taken off the globe.`);
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) status("This layer cannot be recoloured.");
    },
  };
}

/**
 * NOT one list per service. The themed tabs merge these entries into their
 * OWN catalogues (a separate "Earth Engine" dropdown per tab was reported
 * as exactly that and removed) — this seam is what they merge from, and
 * the rows cite Google Earth Engine in their tooltip while the layer's
 * metadata records the service as the source on import. gee.js itself
 * draws only the two lists that ARE their tab's catalogue: Atmosphere
 * (this catalogue's home) and Geohazards (which had no list of its own).
 */
function geeCatalogueSeam() {
  return {
    entriesFor(homeName) {
      return catalogueEntries()
        .filter((entry) => geeHomeOf(entry.id) === homeName)
        .map((entry) => ({
          ...entry,
          group: "Earth Engine",
          title: `${entry.title} — via Google Earth Engine`,
        }));
    },
    owns(id) {
      return catalogueEntries().some((entry) => entry.id === id);
    },
    // A LAYER name back to its home tab — layers are named "<dataset> · <dates>".
    homeOfLayerName(name) {
      const entry = catalogueEntries().find((e) => String(name).startsWith(`${e.name} ·`));
      return entry ? geeHomeOf(entry.id) : null;
    },
    layerFor(id) {
      const entry = catalogueEntries().find((e) => e.id === id);
      return entry ? layerForDataset(entry.name) : null;
    },
    add(id) { return catalogueHooks(catalogueEntries()).add(id); },
    remove(id) { return catalogueHooks(catalogueEntries()).remove(id); },
    symbology(layer) {
      if (!openSymbologyFor(layer)) status("This layer cannot be recoloured.");
    },
  };
}

function drawCatalogue() {
  const entries = catalogueEntries();
  const hooks = catalogueHooks(entries);
  const atmosphereHost = byId("gee-catalogue");
  if (atmosphereHost) {
    renderCatalogue(atmosphereHost,
      entries.filter((entry) => geeHomeOf(entry.id) === "atmosphere"), hooks);
  }
  const hazardsHost = byId("gee-home-geohazards");
  if (hazardsHost) {
    const subset = entries
      .filter((entry) => geeHomeOf(entry.id) === "geohazards")
      .map((entry) => ({ ...entry, group: "Hazard indicators (Earth Engine)" }));
    if (subset.length) renderCatalogue(hazardsHost, subset, hooks);
    else hazardsHost.textContent = "";
  }
  // The basemap and hydrology tabs merge their share into their own lists.
  if (typeof document !== "undefined") {
    document.dispatchEvent(new Event("geoid-gee:catalogue"));
  }
}

if (typeof window !== "undefined") {
  window.GeoIDGeeCatalogue = geeCatalogueSeam();
}

/* ── "Add data via GEE": one dialog, opened from every themed tab ─────────
   The tick lists above cover the shipped snapshots; this is the CONFIGURED
   path — pick any dataset of the tab's subject, a date range and an extent,
   and it drives the same hidden form and the same request() the Atmosphere
   tab's own controls do. One implementation, many doorways. */
function ensureGeeDialog() {
  if (byId("gee-add-backdrop")) return;
  const style = document.createElement("style");
  style.id = "gee-add-style";
  style.textContent = [
    "#gee-add-backdrop { position: fixed; inset: 0; z-index: 80; display: flex;",
    "  align-items: center; justify-content: center;",
    "  background: rgba(4, 2, 12, 0.6); backdrop-filter: blur(2px); }",
    "#gee-add-backdrop[hidden] { display: none !important; }",
    "#gee-add-card { width: min(24rem, 92vw); padding: 0.9rem 1rem 0.85rem;",
    "  border-radius: 0.7rem; border: 1px solid rgba(82, 228, 232, 0.35);",
    "  background: rgba(8, 13, 20, 0.98); box-shadow: 0 18px 44px rgba(0,0,0,0.5);",
    "  display: flex; flex-direction: column; gap: 0.5rem; color: #dcebf2; }",
    "#gee-add-card h3 { margin: 0; font-size: 0.8rem; letter-spacing: 0.1em;",
    "  text-transform: uppercase; color: #bdf3f5; }",
    "#gee-add-card label { display: flex; flex-direction: column; gap: 0.18rem;",
    "  font-size: 0.66rem; letter-spacing: 0.06em; }",
    "#gee-add-card select, #gee-add-card input { background: rgba(16,24,34,0.98);",
    "  border: 1px solid rgba(255,255,255,0.18); border-radius: 0.4rem;",
    "  color: #eaf6fb; font-family: inherit; font-size: 0.74rem;",
    "  padding: 0.3rem 0.4rem; color-scheme: dark; }",
    "#gee-add-dates { display: flex; gap: 0.45rem; }",
    "#gee-add-dates label { flex: 1; }",
    "#gee-add-actions { display: flex; gap: 0.45rem; margin-top: 0.15rem; }",
    "#gee-add-actions button { flex: 1; }",
    "#gee-add-status { font-size: 0.66rem; opacity: 0.8; min-height: 1em; }",
  ].join("\n");
  document.head.appendChild(style);
  const backdrop = document.createElement("div");
  backdrop.id = "gee-add-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = [
    '<div id="gee-add-card" role="dialog" aria-label="Add data via Google Earth Engine">',
    "<h3>Add data via Earth Engine</h3>",
    '<label>Dataset<select id="gee-add-dataset"></select></label>',
    '<div id="gee-add-dates">',
    '<label>From<input id="gee-add-from" type="date"></label>',
    '<label>To<input id="gee-add-to" type="date"></label>',
    "</div>",
    '<label>Extent<select id="gee-add-extent">',
    '<option value="global">Global</option>',
    '<option value="view">Current view</option>',
    '<option value="drawn">An area drawn by hand</option>',
    "</select></label>",
    // The button the extent select could not be: a modal covers the globe,
    // so "draw an area" cannot be a thing you do WITH the dialog open. It
    // arms the tool, stands the dialog down, and remembers the dataset and
    // dates so coming back is not starting again.
    '<button id="gee-add-draw" class="button secondary" type="button">✏ Draw a new area on the globe</button>',
    '<div id="gee-add-status"></div>',
    '<div id="gee-add-actions">',
    '<button id="gee-add-request" class="button primary" type="button">Request</button>',
    '<button id="gee-add-close" class="button secondary" type="button">Close</button>',
    "</div></div>",
  ].join("");
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeGeeDialog(); });
  byId("gee-add-close").addEventListener("click", closeGeeDialog);
  /**
   * Draw, then come back to a dialog that remembers where you were.
   *
   * `pendingDialog` holds the dataset and dates across the round trip, so the
   * flow is one gesture with an interruption rather than two separate visits
   * — losing a chosen dataset because somebody drew a box is exactly the
   * "side quest to another tool" the weather card was built to avoid.
   */
  byId("gee-add-draw").addEventListener("click", () => {
    pendingDialog = {
      home: dialogHome,
      dataset: byId("gee-add-dataset")?.value || "",
      from: byId("gee-add-from")?.value || "",
      to: byId("gee-add-to")?.value || "",
    };
    closeGeeDialog();
    promptDrawTool();
    status("Draw the area on the globe, then press “+ GEE” again — your dataset is remembered.");
  });
  // The named polygons are rebuilt on every layer change, exactly as the
  // weather card's are: a captured extent should be offerable the moment it
  // exists, without reopening anything.
  window.GeoIDImportManager?.onChange?.(() => {
    if (!byId("gee-add-backdrop")?.hidden) {
      refreshPolygonOptions(byId("gee-add-extent"), "drawn", { allLayers: true });
    }
  });
  byId("gee-add-request").addEventListener("click", async () => {
    const dataset = byId("gee-add-dataset").value;
    if (!dataset) return;
    const select = byId("gee-dataset");
    select.value = dataset;
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const from = byId("gee-add-from").value;
    const to = byId("gee-add-to").value;
    if (from && byId("gee-date-from")) byId("gee-date-from").value = from;
    if (to && byId("gee-date-to")) byId("gee-date-to").value = to;
    const extent = byId("gee-add-extent").value;
    if (byId("gee-extent")) byId("gee-extent").value = extent;
    await request();
  });
  // The dialog reports through the same status line the form writes; a
  // mirror keeps one source of truth for what the request is doing.
  const mirror = new MutationObserver(() => {
    const node = byId("gee-add-status");
    if (node && !backdrop.hidden) node.textContent = byId("gee-status")?.textContent || "";
  });
  const source = byId("gee-status");
  if (source) mirror.observe(source, { childList: true, characterData: true, subtree: true });
}

function closeGeeDialog() {
  const backdrop = byId("gee-add-backdrop");
  if (backdrop) backdrop.hidden = true;
}

/** What the dialog was showing when "draw an area" took it off screen. */
let pendingDialog = null;
let dialogHome = "";

function openGeeDialog(homeName) {
  ensureGeeDialog();
  // Reopened after a detour to the Draw tool: come back to that tab's
  // subject rather than to whichever button was pressed second.
  const resumed = pendingDialog;
  pendingDialog = null;
  dialogHome = resumed ? resumed.home : homeName;
  const entries = catalogueEntries();
  const subset = dialogHome
    ? entries.filter((entry) => geeHomeOf(entry.id) === dialogHome)
    : entries;
  const offered = subset.length ? subset : entries;
  const picker = byId("gee-add-dataset");
  picker.innerHTML = offered
    .map((entry) => `<option value="${entry.id}">${entry.label}</option>`)
    .join("");
  const ff = byId("gee-date-from");
  const tf = byId("gee-date-to");
  if (ff?.value) byId("gee-add-from").value = ff.value;
  if (tf?.value) byId("gee-add-to").value = tf.value;
  /**
   * Every drawn polygon, by name, and the shape just drawn preselected.
   *
   * Coming back from the Draw tool with an overlay standing and the extent
   * still reading "Global" would silently throw the area away — the one
   * outcome this whole round trip exists to prevent.
   */
  const extent = byId("gee-add-extent");
  // Every loaded Workspace layer is a possible extent here too — a shapefile
  // somebody brought answers "over where?" by its bounding box, exactly as
  // the Atmosphere tab's own select already offers.
  refreshPolygonOptions(extent, "drawn", { allLayers: true });
  if (resumed) {
    if (resumed.dataset && [...picker.options].some((o) => o.value === resumed.dataset)) {
      picker.value = resumed.dataset;
    }
    if (resumed.from) byId("gee-add-from").value = resumed.from;
    if (resumed.to) byId("gee-add-to").value = resumed.to;
    if (extent && drawnOverlayBounds()) extent.value = "drawn";
  }
  const node = byId("gee-add-status");
  if (node) {
    node.textContent = resumed && drawnOverlayBounds()
      ? "Using the area you just drew." : "";
  }
  byId("gee-add-backdrop").hidden = false;
}

// Every themed tab carries an "Add data via GEE…" button; they all open the
// one dialog, scoped to that tab's subject. Guarded: the tests import this
// module in Node for its pure functions, where there is no document.
if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-gee-add]");
    if (button) openGeeDialog(button.dataset.geeAdd || "");
  });
}

function populateSelect() {
  const select = byId("gee-dataset");
  if (!select) return;
  const previous = select.value;
  const options = ['<option value="">Select a dataset…</option>'];
  if (cacheEntries.length) {
    options.push('<optgroup label="Available offline">');
    cacheEntries.forEach((entry) => {
      options.push(`<option value="${entry.dataset}" data-source="cache">${entry.name}</option>`);
    });
    options.push("</optgroup>");
  }
  const cachedIds = new Set(cacheEntries.map((e) => e.dataset));
  const extra = liveDatasets.filter((d) => !cachedIds.has(d.id));
  if (extra.length) {
    options.push('<optgroup label="Live service">');
    extra.forEach((d) => {
      options.push(`<option value="${d.id}" data-source="live">${d.name}</option>`);
    });
    options.push("</optgroup>");
  }
  select.innerHTML = options.join("");
  if (previous) select.value = previous;
  drawCatalogue();
}

/** The shipped snapshots, read from disk — no network, no credential. */
async function loadCache() {
  try {
    const response = await fetch(cacheUrl("manifest.json"), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    cacheEntries = Array.isArray(data) ? data.filter((e) => e && e.dataset && e.file) : [];
    populateSelect();
    if (cacheEntries.length) {
      status(`${cacheEntries.length} snapshot${cacheEntries.length === 1 ? "" : "s"} available offline.`);
    }
  } catch (error) {
    /* no cache on disk; the live service, if any, still works */
  }
}

/**
 * Re-request as you zoom, so an import sharpens instead of staying global.
 *
 * The service renders a fixed pixel budget over whatever extent it is given, so
 * asking for a smaller box IS the refinement -- the same 1024 px spread over a
 * tenth of the ground is ten times the detail. No scale parameter needed, which
 * is fortunate because the endpoint does not take one.
 *
 * **Off by default, unlike the tile basemaps.** Those pull from free tile
 * services; this invokes a billed Cloud Function on every settle. Turning that
 * on is a spending decision and belongs to whoever owns the project, so it is
 * one click away and never assumed.
 */
let refineStop = null;
let lastRefineBounds = null;

export function setRefineOnZoom(on) {
  if (refineStop) { refineStop(); refineStop = null; }
  lastRefineBounds = null;
  if (!on) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) return;
  refineStop = onViewSettled(viewer, () => {
    const select = byId("gee-dataset");
    if (!select?.value || !THREE) return;
    // A cached snapshot is one global PNG on disk; there is nothing finer to ask
    // for, and re-draping it every time the camera stops would be pure churn.
    if (select.selectedOptions?.[0]?.dataset.source === "cache") return;
    if (byId("gee-extent")?.value !== "view") return;
    const bounds = visibleBounds(viewer, THREE);
    if (!viewChangedEnough(lastRefineBounds, bounds)) return;
    lastRefineBounds = bounds;
    void request();
  });
}

/** Drape a cached snapshot straight from disk — the offline path. */
async function requestFromCache(datasetId) {
  const entry = cacheEntries.find((e) => e.dataset === datasetId);
  if (!entry) { status("That snapshot is not in the cache."); return; }
  status("Draping cached snapshot…");
  byId("gee-request")?.setAttribute("disabled", "");
  try {
    if (!THREE) THREE = await import("../vendor/three.module.js");
    const object3D = await drape(cacheUrl(entry.file), entry.bounds);
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      `${entry.name} · ${entry.from}–${entry.to} (cached)`,
      {
        object3D,
        bounds: entry.bounds,
        georeferenced: true,
        ...samplerFor(object3D, entry),
      },
      "gee",
    );
    if (layer) {
      object3D.userData.geoidLayer = true;
      window.GeoIDViewer?.globe?.add?.(object3D);
      layer.metadata = {
        source: `Google Earth Engine · ${entry.dataset} (cached)`,
        format: "PNG composite",
        crs: entry.crs || "EPSG:4326",
        citation: entry.attribution,
        importedAt: new Date().toISOString(),
      };
      layer.colour = "#4fd1a5";
      if (entry.legend || entry.palette) {
        layer.legendInfo = {
          label: entry.legend?.label || entry.name,
          min: entry.legend?.min,
          max: entry.legend?.max,
          unit: entry.legend?.unit || "",
          palette: entry.palette,
        };
      }
    }
    window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed"));
    status(`Added "${entry.name}" from cache`
      + resolutionNote(entry.bounds, object3D?.material?.map?.image, entry.scale) + ".");
  } catch (error) {
    status(`Could not drape the cached snapshot: ${error.message}`);
  } finally {
    byId("gee-request")?.removeAttribute("disabled");
  }
}

/** Fills the dataset list from the service, merged with the cache. */
async function loadCatalogue() {
  const url = endpoint();
  if (!url) return;
  try {
    const response = await fetch(`${url}?list`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.datasets) || !data.datasets.length) return;
    liveDatasets = data.datasets;
    populateSelect();
    status(`Service connected · ${data.datasets.length} live collection(s), `
      + `${cacheEntries.length} cached.`);
  } catch (error) {
    // The live service is optional. Say nothing over the cache's own message —
    // an unreachable service is the normal offline case, not an error.
    if (!cacheEntries.length) status(`Service unreachable: ${error.message}`);
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
  // The Service card lives in Settings now and ships HIDDEN: this module is
  // the only thing that wires it, and it only runs on Earth — un-hiding it
  // here is what keeps a dead endpoint form off the nine planet pages.
  const serviceSection = byId("gee-service-section");
  if (serviceSection) serviceSection.hidden = false;
  byId("gee-endpoint-save")?.addEventListener("click", () => {
    setEndpoint(byId("gee-endpoint")?.value.trim() || "");
    loadCatalogue();
  });
  byId("gee-request")?.addEventListener("click", request);
  /**
   * The tab's own extent control gets the same picker the dialog has.
   *
   * "any GEE pull" means this one too — it is the control the Atmosphere tab
   * has always shown, and it offered one drawn polygon: whatever happened to
   * be on the globe. Every captured area is now listed by name beside it, so
   * re-running a dataset over the SAME box a week later is a choice rather
   * than a redraw.
   */
  const extentSelect = byId("gee-extent");
  if (extentSelect) {
    refreshPolygonOptions(extentSelect, "global", { allLayers: true });
    extentSelect.addEventListener("change", () => {
      // Choosing "an area drawn by hand" with nothing drawn is a dead end
      // unless the drawer comes to you — the weather card's rule.
      if (extentSelect.value === "drawn" && !drawnOverlayBounds()) {
        promptDrawTool();
        status("Draw the area on the globe — the Draw tool is active — then press Request.");
      }
    });
  }
  /**
   * The BUTTON form of the same gesture — one press instead of knowing the
   * select's "drawn" option is the way in. It replaces the GFS forecast
   * subsection's own draw button, which was the only reason that card was
   * missed when it went: arm the tool, point the extent at the drawing, and
   * the next Request uses whatever lands on the globe.
   */
  byId("gee-draw-area")?.addEventListener("click", () => {
    /**
     * Two presses, the GFS card's own gesture kept exactly.
     *
     * First press with nothing drawn: arm the tool and say what to do.
     * Press again with a shape on the globe: CLAIM it — captured as a real
     * layer named "Earth Engine fetch area" (so it lands in Vectors &
     * Shapes, restores with the project, and can be clipped or exported
     * like any drawn shape), the extent select pointed at that layer by
     * name, and the bounds reported to the same status line the request
     * writes. `captureDrawn` is idempotent by shape, so pressing twice on
     * one box never stacks a duplicate.
     */
    const drawn = drawnOverlayBounds();
    if (!drawn) {
      if (extentSelect) extentSelect.value = "drawn";
      promptDrawTool();
      status("Draw the area on the globe — box, circle or polygon — then press this again to claim it.");
      return;
    }
    const captured = window.GeoIDDrawnLayers?.captureDrawn?.({ name: "Earth Engine fetch area" });
    if (extentSelect) {
      refreshPolygonOptions(extentSelect, "drawn", { allLayers: true });
      if (captured?.ok && captured.layer) extentSelect.value = `layer:${captured.layer.id}`;
      else extentSelect.value = "drawn";
    }
    status(`Fetch area set: ${drawn.south.toFixed(2)}–${drawn.north.toFixed(2)}°N, `
      + `${drawn.west.toFixed(2)}–${drawn.east.toFixed(2)}°E.`
      + (captured?.ok ? " Listed in Workspace." : ""));
  });
  // The ticks follow the layers, whoever removed one: this list, the layer box,
  // or a tab being switched off. The named extents follow them for the same
  // reason: a polygon captured by any fetch should be offerable at once.
  window.GeoIDImportManager?.onChange?.(() => {
    drawCatalogue();
    refreshPolygonOptions(byId("gee-extent"), "global", { allLayers: true });
  });
  drawCatalogue();
  // Choosing a dataset fetches what it actually holds, states it, and fills the
  // boxes with the last sixty days of availability -- so the offered dates are
  // real ones rather than guesses to be refused later.
  byId("gee-dataset")?.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) return;
    // A cached snapshot carries its own fixed window; no availability call.
    if (e.target.selectedOptions?.[0]?.dataset.source === "cache") {
      const entry = cacheEntries.find((c) => c.dataset === id);
      status(entry ? `Cached snapshot · ${entry.from} to ${entry.to}. Draped from disk.`
        : "Cached snapshot.");
      return;
    }
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

  // Injected rather than written into the markup, which exists twice -- once in
  // the Earth page and once in the shared planet shell -- and drifts.
  const extentRow = byId("gee-extent")?.closest(".row") || byId("gee-extent")?.parentElement;
  if (extentRow && !byId("gee-refine")) {
    const label = document.createElement("label");
    label.className = "row";
    label.style.gap = "0.4rem";
    label.htmlFor = "gee-refine";
    label.innerHTML = '<input id="gee-refine" type="checkbox">'
      + '<span>Re-request as I zoom (uses the live service)</span>';
    extentRow.insertAdjacentElement("afterend", label);
    byId("gee-refine").addEventListener("change", (event) => {
      setRefineOnZoom(event.target.checked);
      status(event.target.checked
        ? "Will re-request for the visible extent when the view settles."
        : "Zoom re-requesting off.");
    });
  }

  // The cache first, so the panel is useful the moment it opens even with no
  // service and no network; the live catalogue merges in if it answers.
  loadCache();
  loadCatalogue();
}

// Guarded so the resolution maths can be imported and tested under Node, where
// there is no document and this file would throw at import.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  // Merged for the same reason `gee-live.js` merges: two modules share this
  // name and load order must not decide which one's functions survive.
  window.GeoIDEarthEngine = Object.assign(window.GeoIDEarthEngine || {},
    { request, setEndpoint, getEndpoint: endpoint, setRefineOnZoom });
}
