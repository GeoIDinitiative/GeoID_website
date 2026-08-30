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

import { attachReliefAttributes, followRelief } from "./vector-render.js?v=20260831-fae74a5";
import { latLonToVector3, drapedRadius } from "./geo-utils.js?v=20260831-fae74a5";
import { geeSamplerFromImage, columnName } from "./gee-sample.js?v=20260831-fae74a5";
import { visibleBounds, viewChangedEnough, onViewSettled }
  from "./view-extent.js?v=20260831-fae74a5";
import {
  resolvePolygonExtent, refreshPolygonOptions, promptDrawTool, drawnOverlayBounds,
  persistExtent,
} from "./extent-picker.js?v=20260831-fae74a5";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260831-fae74a5";
import {
  // Aliased: this module already has a `loadCatalogue`, which fills the
  // dropdown from the SERVICE. Two catalogues, and the names have to say so.
  loadCatalogue as loadGeeCatalogue,
  catalogueReady, searchCatalogue, categories, datasetById, describeDataset,
} from "./gee-catalogue-index.js?v=20260831-fae74a5";

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
/** The in-flight dataset availability probe, so a request can wait for it. */
let datesProbe = null;

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
      /**
       * The symbology, for the legend.
       *
       * A CLASSIFICATION is a list, not a ramp — land cover has no min and
       * max to label, and drawing its eleven classes as a continuous bar
       * would invent an order between "grassland" and "built-up". The
       * service sends `classes` for those, each with the publisher's own
       * name, and the legend draws one swatch per class.
       */
      if (data.classes?.length) {
        // The dock's OWN classed shape (`classed` + `categorical` + parallel
        // palette/labels), not one of this module's: it already draws a list
        // of swatches, and a second shape would be a second renderer.
        layer.legendInfo = {
          label: data.name,
          classed: true,
          categorical: true,
          palette: data.classes.map((c) => String(c.colour).replace(/^#/, "")),
          labels: data.classes.map((c) => c.label),
        };
      } else if (data.legend || data.palette) {
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
    // The old service build's word for "not one of my thirteen" names the
    // dataset, which is the one thing that is fine.
    if (/unknown or unsupported dataset/i.test(error.message || "")) {
      status("That dataset is in Earth Engine's catalogue, but the image "
        + "service deployed for this site is an older build that serves only "
        + "its own curated list. Redeploy GeoID_GIS/services/gee-tiles to "
        + "request the rest of the catalogue.");
      return;
    }
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
    /**
     * Open the browser on a subject. A seam rather than only the document
     * click listener, because the Workspace header row deliberately swallows
     * its own clicks so a press cannot fold the box — which also swallowed
     * the one that used to reach that listener, leaving + GEE dead. The
     * buttons beside it (Export, Settings) were always wired directly; this
     * lets + GEE be wired the same way.
     */
    open(homeName) { return openGeeDialog(homeName || ""); },
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
      // The "Wildfires" subtab around this list names the subject, so the
      // group heading inside it names the SOURCE rather than repeating it.
      .map((entry) => ({ ...entry, group: "Earth Engine" }));
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
/**
 * THE EARTH ENGINE BROWSER: a catalogue you can read and an extent you can draw,
 * in one window that never has to close.
 *
 * The old dialog was three controls in a 24rem card — a dataset select, two
 * dates, an extent select — and its ✏ button had to CLOSE the whole thing to
 * let you draw, because the globe is behind the modal. That round trip is the
 * shape this replaces: the window is now large enough to hold both halves of
 * the question it asks.
 *
 *  - LEFT, the catalogue: every dataset the app knows, searchable by name or
 *    by Earth Engine id, filtered by subject, each card saying where it comes
 *    from (a shipped snapshot that drapes offline, or the live service) and
 *    what it is. Below them, a free-text id — the service accepts ANY Earth
 *    Engine dataset, and the full EE catalogue cannot be enumerated from a
 *    page without a credential, so refusing to type one would be pretending
 *    the list is complete.
 *  - RIGHT, the ground: a real slippy map (`research/map2d.js`, the Map
 *    Composer's own), where a drag draws the fetch extent in place. The box
 *    is pushed to the globe through `setStudyAreaPolygon` as it is drawn, so
 *    the planet behind the modal is showing the same extent, and the request
 *    then runs through the ORDINARY "drawn" path — which means the extent is
 *    captured into Workspace on success exactly as a hand-drawn one is. No
 *    second request path, no second notion of what an extent is.
 *
 * It stays open after a request, because browsing a catalogue means pulling
 * more than one thing.
 */

/** Subject names for the filter chips — the tabs each dataset is filed under. */
const HOME_LABELS = {
  "": "All",
  basemap: "Basemaps",
  atmosphere: "Atmosphere",
  hydrology: "Hydrology",
  geology: "Geology",
  geohazards: "Hazards",
};

/** The 2D map, built once the dialog is first shown (a hidden host has no size). */
let geeMap = null;
let mapLibrary = null;
/** The extent the map is showing, as [w, s, e, n], or null for global. */
let mapBox = null;
/** Which dataset id the browser has selected. */
let chosenDataset = "";
/** Which subject filter is applied; "" is everything. */
let homeFilter = "";
/** Why the catalogue could not be read, if it could not. */
let catalogueError = "";
/** Whether the deployed image service can render more than the curated list. */
let serviceServesCatalogue = false;

/**
 * A bounds rectangle as a ring the viewer will accept.
 *
 * Edges longer than a degree are subdivided, for the reason draw-area.js
 * records: a straight chord across 12° of arc dips below the surface, so a
 * box drawn coarsely cuts through the ground it is meant to sit on.
 */
function ringFromBounds([west, south, east, north], maxSegmentDeg = 1) {
  const corners = [
    [west, south], [east, south], [east, north], [west, north],
  ];
  const ring = [];
  corners.forEach(([lon, lat], i) => {
    const [lon2, lat2] = corners[(i + 1) % corners.length];
    const steps = Math.max(1, Math.ceil(
      Math.max(Math.abs(lon2 - lon), Math.abs(lat2 - lat)) / maxSegmentDeg));
    for (let s = 0; s < steps; s += 1) {
      ring.push({
        lat: lat + ((lat2 - lat) * s) / steps,
        lon: lon + ((lon2 - lon) * s) / steps,
      });
    }
  });
  return ring;
}

function ensureGeeDialog() {
  if (byId("gee-add-backdrop")) return;
  const style = document.createElement("style");
  style.id = "gee-add-style";
  style.textContent = [
    "#gee-add-backdrop { position: fixed; inset: 0; z-index: 80; display: flex;",
    "  align-items: center; justify-content: center; padding: 1.4rem;",
    "  background: rgba(4, 2, 12, 0.72); backdrop-filter: blur(2px); }",
    "#gee-add-backdrop[hidden] { display: none !important; }",
    "#gee-add-card { width: min(62rem, 100%); height: min(40rem, calc(100vh - 3rem));",
    "  border-radius: 12px; border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.45);",
    "  background: rgba(12, 10, 22, 0.98); box-shadow: 0 18px 60px rgba(0,0,0,0.6);",
    "  display: flex; flex-direction: column; overflow: hidden; color: var(--text, #eaf6fb); }",
    "#gee-add-card .gee-head { display: flex; align-items: baseline; gap: 0.8rem;",
    "  padding: 0.7rem 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.1); }",
    "#gee-add-card .gee-title { font: 600 0.8rem/1.2 'Exo 2', sans-serif;",
    "  letter-spacing: 0.08em; text-transform: uppercase; }",
    "#gee-add-card .gee-hint { font: 400 0.66rem/1.3 'Exo 2', sans-serif; opacity: 0.7; }",
    "#gee-add-card .gee-head .button { margin-left: auto; }",
    "#gee-add-body { flex: 1; min-height: 0; display: grid;",
    "  grid-template-columns: minmax(0, 19rem) minmax(0, 1fr); }",
    "#gee-add-left { min-height: 0; display: flex; flex-direction: column;",
    "  gap: 0.45rem; padding: 0.7rem; border-right: 1px solid rgba(255,255,255,0.1); }",
    "#gee-add-right { min-height: 0; display: flex; flex-direction: column;",
    "  gap: 0.5rem; padding: 0.7rem; }",
    "#gee-add-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }",
    "#gee-add-chips button { padding: 0.16rem 0.5rem; border-radius: 999px;",
    "  border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.05);",
    "  color: inherit; font: 600 0.58rem/1.5 'Exo 2', sans-serif; letter-spacing: 0.07em;",
    "  text-transform: uppercase; cursor: pointer; }",
    "#gee-add-chips button.is-on { background: var(--nav-accent, #ff2bd6);",
    "  border-color: var(--nav-accent, #ff2bd6); color: #12040f; }",
    "#gee-add-list { flex: 1; min-height: 0; overflow-y: auto; display: flex;",
    "  scrollbar-width: thin; scrollbar-color: rgba(82,228,232,0.38) transparent;",
    "  flex-direction: column; gap: 0.3rem; padding-right: 0.2rem; }",
    "#gee-add-list .gee-card { text-align: left; width: 100%; cursor: pointer;",
    "  border: 1px solid rgba(255,255,255,0.14); border-radius: 0.6rem;",
    "  background: rgb(24, 13, 47); color: inherit; padding: 0.4rem 0.5rem;",
    "  display: flex; flex-direction: column; gap: 0.12rem; }",
    "#gee-add-list .gee-card:hover { border-color: rgba(82,228,232,0.55); }",
    "#gee-add-list .gee-card.is-on { border-color: var(--nav-accent, #ff2bd6);",
    "  box-shadow: 0 0 0 1px var(--nav-accent, #ff2bd6) inset; }",
    "#gee-add-list .gee-card b { font: 600 0.7rem/1.3 'Exo 2', sans-serif; }",
    "#gee-add-list .gee-card code { font-size: 0.58rem; opacity: 0.72;",
    "  word-break: break-all; }",
    "#gee-add-list .gee-card .gee-badge { font: 600 0.52rem/1.5 'Exo 2', sans-serif;",
    "  letter-spacing: 0.08em; text-transform: uppercase; align-self: flex-start;",
    "  padding: 0 0.35rem; border-radius: 999px; border: 1px solid currentColor; }",
    "#gee-add-list .gee-card .gee-badge.is-cache { color: #4fd1a5; }",
    "#gee-add-list .gee-card .gee-badge.is-live { color: #52e4e8; }",
    "#gee-add-list::-webkit-scrollbar { width: 8px; }",
    "#gee-add-list::-webkit-scrollbar-thumb { background: rgba(82,228,232,0.38);",
    "  border-radius: 4px; }",
    "#gee-add-list::-webkit-scrollbar-track { background: transparent; }",
    "#gee-add-list .gee-empty { font-size: 0.64rem; line-height: 1.45; opacity: 0.72;",
    "  padding: 0.4rem 0.2rem; }",
    "#gee-add-list .gee-group { font: 600 0.55rem/1.6 'Exo 2', sans-serif;",
    "  letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.6;",
    "  padding: 0.5rem 0.2rem 0.1rem; position: sticky; top: 0;",
    "  background: rgb(16, 7, 36); z-index: 1; }",
    "#gee-add-list .gee-group:first-child { padding-top: 0; }",
    "#gee-add-list .gee-card small { font-size: 0.58rem; opacity: 0.66; }",
    "#gee-add-list .gee-card .gee-badge.is-cat { color: #9aa7ff; }",
    "#gee-add-list .gee-card .gee-badge.is-warn { color: #ffb454; }",
    "#gee-add-card .gee-tick { flex-direction: row; align-items: center;",
    "  gap: 0.35rem; text-transform: none; letter-spacing: normal;",
    "  font-weight: 400; font-size: 0.62rem; opacity: 0.8; cursor: pointer; }",
    "#gee-add-card .gee-tick input { flex: 0 0 auto; }",
    "#gee-add-map { flex: 1; min-height: 8rem; border-radius: 0.6rem; overflow: hidden;",
    "  border: 1px solid rgba(255,255,255,0.14); background: rgb(16, 7, 36); position: relative; }",
    "#gee-add-map canvas { display: block; width: 100%; height: 100%; }",
    "#gee-add-card label { display: flex; flex-direction: column; gap: 0.18rem;",
    "  font: 600 0.6rem/1.4 'Exo 2', sans-serif; letter-spacing: 0.07em;",
    "  text-transform: uppercase; opacity: 0.85; }",
    "#gee-add-card select, #gee-add-card input { background: rgba(16,24,34,0.98);",
    "  border: 1px solid rgba(255,255,255,0.18); border-radius: 0.4rem;",
    "  color: #eaf6fb; font-family: inherit; font-size: 0.72rem; text-transform: none;",
    "  letter-spacing: normal; padding: 0.3rem 0.4rem; color-scheme: dark; }",
    "#gee-add-card option, #gee-add-card optgroup { background-color: #101822; }",
    "#gee-add-row { display: flex; gap: 0.45rem; align-items: flex-end; }",
    "#gee-add-row > * { flex: 1; min-width: 0; }",
    "#gee-add-row .button { flex: 0 0 auto; }",
    "#gee-add-idrow { display: flex; gap: 0.35rem; align-items: flex-end; }",
    "#gee-add-idrow label { flex: 1; min-width: 0; }",
    "#gee-add-extent-note { font: 400 0.64rem/1.4 'Exo 2', sans-serif; opacity: 0.8; }",
    "#gee-add-status { font-size: 0.66rem; opacity: 0.85; min-height: 1em; }",
    "#gee-add-actions { display: flex; gap: 0.45rem; }",
    "#gee-add-actions .button { flex: 1; }",
    "#gee-add-draw.is-on { background: var(--nav-accent, #ff2bd6); color: #12040f; }",
  ].join("\n");
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.id = "gee-add-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = [
    '<div id="gee-add-card" role="dialog" aria-label="Browse the Earth Engine catalogue">',
    '<div class="gee-head">',
    '<span class="gee-title">Earth Engine catalogue</span>',
    '<span class="gee-hint">Pick a dataset, draw the ground, request it.</span>',
    '<button id="gee-add-close" class="button secondary" type="button">Close</button>',
    "</div>",
    '<div id="gee-add-body">',
    '<div id="gee-add-left">',
    '<label>Search<input id="gee-add-search" type="search" placeholder="rainfall, land cover, Sentinel…"></label>',
    '<label>Subject<select id="gee-add-category">',
    '<option value="">Every subject</option>',
    "</select></label>",
    '<div id="gee-add-chips"></div>',
    '<label class="gee-tick"><input id="gee-add-deprecated" type="checkbox">'
      + "<span>Include superseded datasets</span></label>",
    '<div id="gee-add-list"></div>',
    '<div id="gee-add-idrow">',
    '<label>Any Earth Engine ID<input id="gee-add-id" type="text" placeholder="e.g. ECMWF/ERA5/DAILY"></label>',
    '<button id="gee-add-id-use" class="button secondary" type="button">Use</button>',
    "</div>",
    "</div>",
    '<div id="gee-add-right">',
    '<div id="gee-add-map"></div>',
    '<div id="gee-add-row">',
    '<label>Extent<select id="gee-add-extent">',
    '<option value="global">Global</option>',
    '<option value="view">Current globe view</option>',
    // "drawn" is the LIVE overlay — the box just dragged out on the map, which
    // is pushed to the globe as a study area, or one drawn on the globe itself.
    // refreshPolygonOptions only appends the named layers; this option has to
    // be in the markup, which is how its absence left a drawn box unselectable.
    '<option value="drawn">Area drawn on the map</option>',
    "</select></label>",
    '<button id="gee-add-draw" class="button secondary" type="button">▭ Draw on map</button>',
    '<label style="flex: 0 0 9rem">Map<select id="gee-add-basemap"></select></label>',
    "</div>",
    '<div id="gee-add-extent-note"></div>',
    '<div id="gee-add-row">',
    '<label>From<input id="gee-add-from" type="date"></label>',
    '<label>To<input id="gee-add-to" type="date"></label>',
    "</div>",
    '<div id="gee-add-status"></div>',
    '<div id="gee-add-actions">',
    '<button id="gee-add-request" class="button primary" type="button">Request</button>',
    "</div></div></div></div>",
  ].join("");
  document.body.appendChild(backdrop);

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeGeeDialog(); });
  byId("gee-add-close").addEventListener("click", closeGeeDialog);
  byId("gee-add-search").addEventListener("input", renderGeeList);
  byId("gee-add-category").addEventListener("change", () => {
    // A subject of Google's and a subject of ours are different questions;
    // holding both at once returns nothing whenever they disagree.
    if (byId("gee-add-category").value) { homeFilter = ""; renderGeeChips(); }
    renderGeeList();
  });
  byId("gee-add-deprecated").addEventListener("change", renderGeeList);
  byId("gee-add-id-use").addEventListener("click", () => {
    const id = byId("gee-add-id").value.trim();
    if (!id) return;
    chosenDataset = id;
    renderGeeList();
    dialogStatus(`Will request “${id}” from the live service.`);
  });

  /**
   * Draw mode: the map's own rubber band. The box is pushed to the GLOBE as
   * it is dragged, so the planet behind the modal shows the same extent and
   * the request afterwards travels the ordinary "drawn" path — which is what
   * makes the extent land in Workspace on success without a line of code here.
   */
  byId("gee-add-draw").addEventListener("click", () => {
    const button = byId("gee-add-draw");
    const on = !button.classList.contains("is-on");
    button.classList.toggle("is-on", on);
    geeMap?.setDrawMode(on, (box, done) => {
      mapBox = box;
      paintMapBox();
      describeExtent(box);
      if (!done) return;
      button.classList.remove("is-on");
      geeMap.setDrawMode(false);
      window.GeoIDViewer?.setStudyAreaPolygon?.(ringFromBounds(box));
      const extent = byId("gee-add-extent");
      refreshPolygonOptions(extent, "drawn", { allLayers: true });
      extent.value = "drawn";
      dialogStatus("Extent drawn — it is on the globe behind this window too.");
    });
    dialogStatus(on ? "Drag a box on the map." : "");
  });

  byId("gee-add-extent").addEventListener("change", () => showChosenExtent());
  byId("gee-add-basemap").addEventListener("change", (e) => {
    geeMap?.setBasemap(e.target.value);
  });

  // The named polygons are rebuilt on every layer change, exactly as the
  // weather card's are: a captured extent should be offerable the moment it
  // exists, without reopening anything.
  window.GeoIDImportManager?.onChange?.(() => {
    if (!byId("gee-add-backdrop")?.hidden) {
      const extent = byId("gee-add-extent");
      const keep = extent.value;
      refreshPolygonOptions(extent, "drawn", { allLayers: true });
      if ([...extent.options].some((o) => o.value === keep)) extent.value = keep;
    }
  });

  byId("gee-add-request").addEventListener("click", requestFromDialog);

  // The dialog reports through the same status line the form writes; a
  // mirror keeps one source of truth for what the request is doing.
  const mirror = new MutationObserver(() => {
    const node = byId("gee-add-status");
    if (node && !backdrop.hidden) node.textContent = byId("gee-status")?.textContent || "";
  });
  const source = byId("gee-status");
  if (source) mirror.observe(source, { childList: true, characterData: true, subtree: true });
}

/**
 * Reflect the hidden form's date window into the dialog's own boxes.
 *
 * Only where the dialog's are EMPTY: the probe's sixty-day default is a
 * suggestion, and overwriting a range somebody typed with it would be the
 * app changing an answer it was given.
 */
function syncDialogDates() {
  [["gee-date-from", "gee-add-from"], ["gee-date-to", "gee-add-to"]]
    .forEach(([hiddenId, dialogId]) => {
      const hidden = byId(hiddenId);
      const shown = byId(dialogId);
      if (!hidden || !shown) return;
      if (!shown.value && hidden.value) shown.value = hidden.value;
      if (hidden.min) shown.min = hidden.min;
      if (hidden.max) shown.max = hidden.max;
    });
}

function dialogStatus(message) {
  const node = byId("gee-add-status");
  if (node) node.textContent = message;
}

/**
 * The list: this app's own datasets first, then all 1,139 of Google's.
 *
 * The curated ones lead because they are DIFFERENT in kind — a shipped
 * snapshot needs no service at all, and the tuned ones carry a legend with
 * real units rather than the catalogue's published default. Everything else
 * in Earth Engine follows, from the baked index, ranked by the search.
 *
 * Capped at 60 drawn cards with the remainder COUNTED rather than dropped
 * silently: a thousand buttons is a page nobody can scroll and a search
 * saying "1,021 more" is what tells somebody to type another word.
 */
function renderGeeList() {
  const host = byId("gee-add-list");
  if (!host) return;
  const query = (byId("gee-add-search")?.value || "").trim();
  const category = byId("gee-add-category")?.value || "";
  const deprecated = byId("gee-add-deprecated")?.checked || false;
  host.innerHTML = "";

  // The app's own, matched loosely — they are thirteen, not a thousand.
  const needle = query.toLowerCase();
  const curated = catalogueEntries().filter((entry) => {
    if (category) return false;                 // a GEE category is not ours
    if (homeFilter && geeHomeOf(entry.id) !== homeFilter) return false;
    if (!needle) return true;
    return `${entry.label} ${entry.id}`.toLowerCase().includes(needle);
  });
  if (curated.length) {
    host.appendChild(groupHeading(homeFilter
      ? `Ready in this app · ${HOME_LABELS[homeFilter]}` : "Ready in this app"));
    curated.forEach((entry) => host.appendChild(curatedCard(entry)));
  }

  if (!catalogueReady()) {
    const note = document.createElement("div");
    note.className = "gee-empty";
    note.textContent = catalogueError
      || "Loading Google's Earth Engine catalogue…";
    host.appendChild(note);
    return;
  }

  const curatedIds = new Set(curated.map((entry) => entry.id));
  const found = searchCatalogue({
    query, category, includeDeprecated: deprecated, limit: 60,
  });
  const rest = found.results.filter((entry) => !curatedIds.has(entry.id));
  host.appendChild(groupHeading(
    `Earth Engine catalogue · ${found.total.toLocaleString()} match`
    + (found.total === 1 ? "" : "es")));
  rest.forEach((entry) => host.appendChild(catalogueCard(entry)));

  const notes = [];
  if (!serviceServesCatalogue) {
    notes.push("The image service deployed for this site still serves only the "
      + "datasets above. These can be browsed now; requesting one needs the "
      + "updated service (GeoID_GIS/services/gee-tiles).");
  }
  if (found.total > found.results.length) {
    notes.push(`${(found.total - found.results.length).toLocaleString()} more match — `
      + "add a word to narrow it.");
  }
  if (found.deprecated) {
    notes.push(`${found.deprecated} superseded dataset${found.deprecated === 1 ? "" : "s"} `
      + "hidden — tick “include superseded” to see them.");
  }
  if (found.undrapeable) {
    notes.push(`${found.undrapeable} more match but cannot be draped: tables, or `
      + "rasters their publisher gives no default rendering for.");
  }
  if (!found.total && !curated.length) {
    notes.unshift("Nothing matches. Any Earth Engine dataset ID can still be typed in below.");
  }
  notes.forEach((text) => {
    const note = document.createElement("div");
    note.className = "gee-empty";
    note.textContent = text;
    host.appendChild(note);
  });
}

function groupHeading(text) {
  const head = document.createElement("div");
  head.className = "gee-group";
  head.textContent = text;
  return head;
}

/** One of this app's own: a shipped snapshot, or a tuned live product. */
function curatedCard(entry) {
  const cached = entry.source === "cache";
  const card = baseCard(entry.id, entry.label, entry.id);
  card.prepend(badge(cached ? "Offline snapshot" : "Tuned for this app",
    cached ? "is-cache" : "is-live"));
  card.title = entry.title;
  card.addEventListener("click", () => choose(entry.id, entry.info.summary));
  return card;
}

/** One of Google's: what it is, at what resolution, over what years. */
function catalogueCard(entry) {
  const card = baseCard(entry.id, entry.title, entry.id);
  card.prepend(badge(entry.status === "beta" ? "Beta"
    : entry.status === "deprecated" ? "Superseded" : "Earth Engine",
  entry.status === "ready" ? "is-cat" : "is-warn"));
  const line = document.createElement("small");
  line.textContent = describeDataset(entry);
  card.appendChild(line);
  card.title = entry.summary || entry.title;
  card.addEventListener("click", () => choose(entry.id, describeChosen(entry)));
  return card;
}

function baseCard(id, title, subtitle) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "gee-card";
  card.classList.toggle("is-on", id === chosenDataset);
  const name = document.createElement("b");
  name.textContent = title;
  const code = document.createElement("code");
  code.textContent = subtitle;
  card.append(name, code);
  return card;
}

function badge(text, kind) {
  const span = document.createElement("span");
  span.className = `gee-badge ${kind}`;
  span.textContent = text;
  return span;
}

/** What the status line says about a catalogue dataset that was just picked. */
function describeChosen(entry) {
  const bits = [entry.summary || describeDataset(entry)];
  if (entry.provider) bits.push(`Published by ${entry.provider}.`);
  if (entry.licence) bits.push(entry.licence);
  return bits.filter(Boolean).join(" ");
}

function choose(id, message) {
  chosenDataset = id;
  renderGeeList();
  dialogStatus(message || "");
  // The catalogue states each dataset's own extent, so the date boxes are
  // cleared rather than left carrying the last dataset's window — a range
  // from another archive is a range this one may not hold.
  const entry = datasetById(id);
  const from = byId("gee-add-from");
  const to = byId("gee-add-to");
  if (from && to) {
    from.value = ""; to.value = "";
    from.min = to.min = entry?.start || "";
    from.max = to.max = entry?.end || "";
  }
}

/**
 * The filter row: this app's subjects, then Google's own categories.
 *
 * Their taxonomy for their catalogue — deciding which of 1,139 datasets is
 * "geology" would be 1,139 judgements nobody here is qualified to make, and
 * every wrong one invisible. The chips stay because the button that opened
 * this window came from a tab with a subject.
 */
function renderGeeChips() {
  const host = byId("gee-add-chips");
  if (!host) return;
  const used = new Set(catalogueEntries().map((entry) => geeHomeOf(entry.id)));
  host.innerHTML = "";
  ["", ...Object.keys(HOME_LABELS).filter((h) => h && used.has(h))].forEach((home) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = HOME_LABELS[home];
    chip.classList.toggle("is-on", home === homeFilter);
    chip.addEventListener("click", () => {
      homeFilter = home;
      // A GEE category and one of ours answer different questions; holding
      // both would silently return nothing whenever they disagreed.
      const select = byId("gee-add-category");
      if (select) select.value = "";
      renderGeeChips();
      renderGeeList();
    });
    host.appendChild(chip);
  });
}

/** Google's categories, commonest first, each carrying its own count. */
function renderGeeCategories() {
  const select = byId("gee-add-category");
  if (!select || !catalogueReady()) return;
  const chosen = select.value;
  select.innerHTML = ['<option value="">Every subject</option>']
    .concat(categories().map((cat) =>
      `<option value="${cat.id}">${cat.label} (${cat.count})</option>`))
    .join("");
  select.value = chosen;
}

/** Draw the chosen extent on the map, and say how big it is in words. */
function paintMapBox() {
  // `visible` is not optional: drawLayer returns early without it, so the box
  // is computed, handed over and silently never painted.
  geeMap?.setLayers(mapBox
    ? [{ type: "bbox", bbox: mapBox, colour: "#ff2bd6", opacity: 1, visible: true }]
    : []);
}

function describeExtent(box) {
  const note = byId("gee-add-extent-note");
  if (!note) return;
  if (!box) { note.textContent = "The whole planet."; return; }
  const [w, s, e, n] = box;
  note.textContent = `${(e - w).toFixed(1)} × ${(n - s).toFixed(1)}°  ·  `
    + `W ${w.toFixed(2)}  S ${s.toFixed(2)}  E ${e.toFixed(2)}  N ${n.toFixed(2)}`;
}

/**
 * Show whatever the extent select is pointing at.
 *
 * `resolvePolygonExtent` is the one answer to "which patch of ground?", so a
 * named Workspace layer, the live drawing overlay and a captured fetch extent
 * all resolve here the same way they will when the request is made — the map
 * cannot show something different from what is about to be asked for.
 */
async function showChosenExtent() {
  const choice = byId("gee-add-extent")?.value || "global";
  if (choice === "global") {
    mapBox = null;
    paintMapBox();
    describeExtent(null);
    return;
  }
  let box = null;
  if (choice === "view") {
    // viewBounds raycasts through the camera and needs the three.js module the
    // request path loads lazily — without this it answers null on a page where
    // nothing has been requested yet, and "Current globe view" silently did
    // nothing at all.
    if (!THREE) THREE = await import("../vendor/three.module.js");
    const b = viewBounds();
    if (b) box = [b.minX, b.minY, b.maxX, b.maxY];
  } else {
    const picked = resolvePolygonExtent(choice);
    if (picked?.error) { dialogStatus(picked.error); return; }
    if (picked) box = [picked.west, picked.south, picked.east, picked.north];
  }
  if (!box) { dialogStatus("That extent could not be resolved."); return; }
  mapBox = box;
  paintMapBox();
  describeExtent(box);
  geeMap?.fit(box);
}

/**
 * One request path: the hidden form still carries the state and `request()`
 * still makes the call, so everything downstream — the cache branch, the
 * resolution note, the Workspace capture, the metadata — is untouched.
 */
async function requestFromDialog() {
  const dataset = chosenDataset;
  if (!dataset) { dialogStatus("Choose a dataset from the list, or type an ID."); return; }
  const select = byId("gee-dataset");
  if (select) {
    // A typed id is not in the hidden select, and the live path reads the
    // dataset off it — so an id nobody has listed is added as an option
    // rather than silently falling back to whatever was selected before.
    if (![...select.options].some((o) => o.value === dataset)) {
      const option = document.createElement("option");
      option.value = dataset;
      option.textContent = dataset;
      option.dataset.source = "live";
      select.appendChild(option);
    }
    select.value = dataset;
    select.dispatchEvent(new Event("change"));
    // Waited for, not slept past: the probe writes the status line and the
    // date boxes when it lands, and landing mid-request is how "Requesting…"
    // came to be replaced by an availability note for the length of the pull.
    dialogStatus("Checking what this dataset holds…");
    await datesProbe?.catch(() => {});
  }
  // What the probe learned, shown where the request is being made: the window
  // it filled in is the one this pull will use, and a pair of empty date boxes
  // above a request that silently carries dates says otherwise.
  syncDialogDates();
  const from = byId("gee-add-from").value;
  const to = byId("gee-add-to").value;
  if (from && byId("gee-date-from")) byId("gee-date-from").value = from;
  if (to && byId("gee-date-to")) byId("gee-date-to").value = to;
  const extent = byId("gee-add-extent").value;
  if (byId("gee-extent")) {
    refreshPolygonOptions(byId("gee-extent"), "global", { allLayers: true });
    byId("gee-extent").value = extent;
  }
  await request();
  // Kept open on purpose: browsing a catalogue means pulling more than one
  // thing, and a window that closes on every Request makes the second pull a
  // fresh journey through the same three controls.
}

function closeGeeDialog() {
  const backdrop = byId("gee-add-backdrop");
  if (backdrop) backdrop.hidden = true;
  geeMap?.setDrawMode(false);
  byId("gee-add-draw")?.classList.remove("is-on");
}

async function openGeeDialog(homeName) {
  ensureGeeDialog();
  // The tab that asked becomes the subject filter — the button on Hazards
  // still means "the Earth Engine data filed under Hazards" — but the chip is
  // there to be pressed, which is what "browse the catalogue freely" needs.
  homeFilter = homeName || "";
  const backdrop = byId("gee-add-backdrop");
  backdrop.hidden = false;

  renderGeeChips();
  renderGeeList();
  /**
   * The 136 KB index, on FIRST OPEN rather than at module load: most sessions
   * never open this window, and the curated list above is drawn without it —
   * so the catalogue arrives into a list that is already usable.
   */
  loadGeeCatalogue().then(() => {
    catalogueError = "";
    renderGeeCategories();
    renderGeeList();
  }).catch((error) => {
    catalogueError = `Google's catalogue index could not be read (${error.message}). `
      + "The datasets above still work, and any Earth Engine ID can be typed in below.";
    renderGeeList();
  });

  const ff = byId("gee-date-from");
  const tf = byId("gee-date-to");
  if (ff?.value) byId("gee-add-from").value = ff.value;
  if (tf?.value) byId("gee-add-to").value = tf.value;

  const extent = byId("gee-add-extent");
  // Every loaded Workspace layer is a possible extent here too — a shapefile
  // somebody brought answers "over where?" by its bounding box, exactly as
  // the Atmosphere tab's own select already offers.
  refreshPolygonOptions(extent, "drawn", { allLayers: true });
  if (!drawnOverlayBounds()) extent.value = "global";

  // The map is built on first open, never at module load: `createMap`
  // measures its host, and a host inside a hidden backdrop has no size.
  if (!geeMap) {
    mapLibrary = mapLibrary || await import("./research/map2d.js?v=20260831-fae74a5");
    const picker = byId("gee-add-basemap");
    picker.innerHTML = Object.keys(mapLibrary.BASEMAPS)
      .map((name) => `<option value="${name}">${name}</option>`).join("");
    // OpenStreetMap, not the dark one that suits the panel better: CARTO's
    // free CDN now answers 200 with an "API KEY REQUIRED" watermark rather
    // than a tile — measured, 17 distinct colours in a zoom-3 tile — so the
    // handsome default would open this window on a wall of that text.
    picker.value = "OpenStreetMap";
    geeMap = mapLibrary.createMap(byId("gee-add-map"), { basemap: "OpenStreetMap" });
  }
  showChosenExtent();
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
    /**
     * Does the deployed service understand the whole catalogue?
     *
     * The build that resolves an arbitrary dataset from Earth Engine's STAC
     * says so by naming that catalogue in its `?list` reply; the one before
     * it answers 400 "Unknown or unsupported dataset." to everything outside
     * its thirteen. That error names the DATASET, which is the one thing not
     * at fault, so the browser has to know which build it is talking to and
     * say what is actually wrong.
     */
    serviceServesCatalogue = Boolean(data.catalogue);
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
  // The probe is HELD as a promise, not just fired: it writes the status and
  // fills the date boxes when it lands, so anything that sets a dataset and
  // then requests it — the browser dialog does exactly that — must be able to
  // wait for it. Without the handle, "Requesting…" was overwritten by
  // "Static dataset — the date range is ignored." for the whole 30 seconds a
  // live pull takes, and a chosen date range could be replaced by the probe's
  // own sixty-day window a beat after it was written.
  byId("gee-dataset")?.addEventListener("change", (e) => {
    datesProbe = probeDataset(e.target);
  });
  async function probeDataset(select) {
    const id = select.value;
    if (!id) return;
    // A cached snapshot carries its own fixed window; no availability call.
    if (select.selectedOptions?.[0]?.dataset.source === "cache") {
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
  }
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
