// Real map imagery on the globe: OpenStreetMap streets, Esri satellite, either
// over the whole planet or over the project's study area.
//
// The shipped basemap is a single equirectangular texture at roughly 8 km per
// pixel with no zoom pyramid, so past a certain altitude there is no more
// detail to show whatever the camera does, and it is a fixed composite rather
// than anything current. This fetches XYZ tiles for an extent, composites them
// into one canvas and drapes it on the terrain as an ordinary layer.
//
// Two extents, because they answer different questions:
//
//   * **Whole globe** -- the tile budget tops out at zoom 4, which is 4096 px
//     across the world, about 9.8 km/px. That is comparable to the 7.4 km/px
//     Blue Marble already on the globe, so this is a genuine alternative
//     basemap rather than a compromise: streets, or imagery from this year.
//   * **Study area** -- the same machinery over a small box reaches metres per
//     pixel (measured over Etna: 90 tiles at zoom 13, 15.1 m/px).
//
// Deliberately NOT a globe-wide tile streamer. That is a real project (the
// design is written up in flight_sim/mars/viewer/STREAMING-DESIGN.md) and it
// would be the wrong first move: both extents here are bounded, so one
// composite at a fixed zoom answers the question with no scheduler, no cache
// eviction and no per-frame budget.
//
// Mercator and the globe disagree about latitude, and the two paths answer that
// differently -- which is the main thing to understand here:
//
//   * A **drape** avoids reprojection entirely. Its mesh rows are spaced evenly
//     in Mercator y with latitudes from the inverse projection, so the default
//     plane UVs line up and not one pixel is resampled.
//   * A **basemap** has no such freedom: it becomes the sphere's own texture and
//     the sphere's UVs are linear in latitude, so it must be reprojected row by
//     row (`toEquirectangular`). Skip that and every coastline slides polewards.
//
// And: **the geo group already holds the spin.** `GeoID-ImportedGeoLayers` turns
// with the globe, so drape vertices go in the baseline frame that `surfacePoint`
// answers in -- no half-turn to bake in, unlike the Earth Engine drapes which
// parent to the globe mesh itself.

import { TILE_SOURCES, DEFAULT_SOURCE, tileUrl } from "./tile-sources.js?v=20260828-53769a0";
import { attachReliefAttributes, followRelief } from "./vector-render.js?v=20260828-53769a0";
import { isEarth } from "./bodies.js?v=20260828-53769a0";
import { streamRings, cacheStats } from "./tile-streamer.js?v=20260828-53769a0";
import { visibleBounds, altitudeUnits, viewChangedEnough, onViewSettled }
  from "./view-extent.js?v=20260828-53769a0";

const TILE = 256;
// Web Mercator cannot express the poles; this is where the projection is
// conventionally cut, and it is what makes the world square.
export const MAX_LAT = 85.0511287798;

// A ceiling on the composite, so a study area the size of a continent asks for
// a sane number of tiles rather than tens of thousands. 4096 is the texture
// size the flight sim settled on for the same reason.
const MAX_CANVAS_PX = 4096;
const MAX_TILES = 256;
// Six at a time: the same ceiling HTTP/1.1 imposes per host anyway, and it
// keeps this from behaving like a bulk downloader against a free service.
const CONCURRENCY = 6;

let THREE = null;

// ── The projection, as pure functions ────────────────────────────────────────

export const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** Longitude to absolute pixel x at a zoom whose world is `worldSize` px. */
export function lonToPixelX(lon, worldSize) {
  return ((lon + 180) / 360) * worldSize;
}

/** Latitude to absolute pixel y. Down is south, as every tile scheme has it. */
export function latToPixelY(lat, worldSize) {
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI;
  return ((1 - y) / 2) * worldSize;
}

/** The inverse — what turns an evenly spaced row of pixels back into latitudes. */
export function pixelYToLat(py, worldSize) {
  const y = 1 - (2 * py) / worldSize;
  return (Math.atan(Math.sinh(y * Math.PI)) * 180) / Math.PI;
}

/**
 * The deepest zoom whose composite still fits the budget.
 *
 * Counting tiles rather than guessing from the span: a box near the pole covers
 * far more Mercator height than the same degree span at the equator, so a
 * latitude-blind estimate over-fetches badly up there.
 */
export function chooseZoom(bbox, { maxCanvasPx = MAX_CANVAS_PX, maxTiles = MAX_TILES, maxZoom = 19 } = {}) {
  for (let z = maxZoom; z >= 0; z -= 1) {
    const grid = tileGrid(bbox, z);
    if (grid.width <= maxCanvasPx && grid.height <= maxCanvasPx
      && grid.tilesX * grid.tilesY <= maxTiles) {
      return z;
    }
  }
  return 0;
}

/**
 * Which tiles cover the box at this zoom, and where the box sits inside them.
 *
 * The canvas is sized to the box exactly, not to whole tiles, so its edges are
 * the box's edges. That is what lets the mesh use the box's own bounds without
 * a margin of somebody else's map hanging off the side.
 */
export function tileGrid(bbox, z) {
  const worldSize = TILE * 2 ** z;
  const pxMin = lonToPixelX(bbox.minLon, worldSize);
  const pxMax = lonToPixelX(bbox.maxLon, worldSize);
  const pyMin = latToPixelY(bbox.maxLat, worldSize);   // north edge, smaller y
  const pyMax = latToPixelY(bbox.minLat, worldSize);
  const x0 = Math.floor(pxMin / TILE);
  const x1 = Math.ceil(pxMax / TILE) - 1;
  const y0 = Math.floor(pyMin / TILE);
  const y1 = Math.ceil(pyMax / TILE) - 1;
  return {
    z,
    worldSize,
    x0, x1, y0, y1,
    tilesX: x1 - x0 + 1,
    tilesY: y1 - y0 + 1,
    pxMin, pyMin,
    width: Math.max(1, Math.round(pxMax - pxMin)),
    height: Math.max(1, Math.round(pyMax - pyMin)),
  };
}

/** Ground resolution at the centre of the box, for saying what was fetched. */
export function metresPerPixel(bbox, z) {
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** A study area as stored in project metadata, normalised and checked. */
export function normaliseBbox(area) {
  // `Number("")` is 0, not NaN -- and `defaultMetadata` writes the study area as
  // four empty strings, so a project that has never had one parsed cleanly as a
  // box at 0,0 and was then rejected for "having no area". Wrong message for by
  // far the most common case: the area is missing, not degenerate.
  const raw = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => area?.[k]);
  const nums = raw.map((v) => (v === "" || v == null ? NaN : Number(v)));
  if (!nums.every(Number.isFinite)) {
    throw new Error("This project has no study area yet — draw one on the globe first.");
  }
  const [minLat, maxLat, minLon, maxLon] = nums;
  const bbox = {
    minLat: clampLat(Math.min(minLat, maxLat)),
    maxLat: clampLat(Math.max(minLat, maxLat)),
    minLon: Math.min(minLon, maxLon),
    maxLon: Math.max(minLon, maxLon),
  };
  if (bbox.maxLat - bbox.minLat < 1e-6 || bbox.maxLon - bbox.minLon < 1e-6) {
    throw new Error("The study area has no area — draw a box rather than a point.");
  }
  return bbox;
}

// ── Fetching and compositing ─────────────────────────────────────────────────

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // Without this the first tile taints the canvas and the texture upload --
    // and any later export of it -- throws instead of drawing.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // One missing tile is a hole, not a failure: services have gaps, and a
    // partial composite is far more useful than an error.
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Run `jobs` a few at a time rather than all at once. */
async function pool(jobs, limit = CONCURRENCY) {
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await job();
    }
  });
  await Promise.all(workers);
}

/**
 * Every tile covering the box, drawn into one canvas the exact size of the box.
 *
 * The credit is painted into the image itself. On a globe there is no corner to
 * put it in and no guarantee any panel is open, so burning it into the texture
 * is the only way it travels with the imagery — including into a screenshot.
 */
export async function composite(bbox, sourceName = DEFAULT_SOURCE, { onProgress, credit = true } = {}) {
  const source = TILE_SOURCES[sourceName];
  if (!source) throw new Error(`No tile source named "${sourceName}".`);
  const z = chooseZoom(bbox, { maxZoom: source.maxZoom });
  const grid = tileGrid(bbox, z);

  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext("2d");
  // Deliberately NOT filled. An unfetched tile leaves transparent pixels, so the
  // globe underneath shows through instead of a dark hole -- which is what lets
  // the patch be shown while it is still arriving, and what makes a missing tile
  // a gap in detail rather than a black square.

  let done = 0;
  let drawn = 0;
  const total = grid.tilesX * grid.tilesY;
  const jobs = [];
  for (let ty = grid.y0; ty <= grid.y1; ty += 1) {
    for (let tx = grid.x0; tx <= grid.x1; tx += 1) {
      // Longitude wraps; latitude does not, so a row off the top or bottom of
      // the world simply has no tile.
      const wrapped = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
      if (ty < 0 || ty >= 2 ** z) { done += 1; continue; }
      jobs.push(async () => {
        const img = await loadImage(tileUrl(sourceName, z, wrapped, ty));
        if (img) {
          ctx.drawImage(img, tx * TILE - grid.pxMin, ty * TILE - grid.pyMin, TILE, TILE);
          drawn += 1;
        }
        done += 1;
        onProgress?.(done, total, canvas);
      });
    }
  }
  await pool(jobs);
  if (!drawn) {
    throw new Error(`${sourceName} returned no tiles for this area.`);
  }
  // Burnt in for a drape, where there is no corner to put it in. Not for a
  // basemap: reprojected to equirectangular the bottom of the image is the
  // south pole, so a credit there would be hidden exactly where it must not be.
  // That path shows it in the panel instead, the way every web map does.
  if (credit) paintCredit(ctx, canvas.width, canvas.height, source.credit);
  return { canvas, zoom: z, tiles: total, drawn, metresPerPixel: metresPerPixel(bbox, z), source: sourceName };
}

/** The licence line, wrapped so a fifteen-agency credit stays on the image. */
function paintCredit(ctx, width, height, credit) {
  const size = Math.max(11, Math.round(width / 90));
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = "right";
  const words = String(credit).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width - size * 2) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const pad = Math.round(size * 0.5);
  const boxH = lines.length * (size + 2) + pad;
  ctx.fillStyle = "rgba(6,8,18,0.55)";
  ctx.fillRect(0, height - boxH, width, boxH);
  ctx.fillStyle = "rgba(232,238,255,0.92)";
  lines.forEach((text, i) => {
    ctx.fillText(text, width - pad, height - boxH + pad + (i + 1) * size - 2);
  });
}

// ── Reprojection, for the basemap path ───────────────────────────────────────

/**
 * A Mercator composite turned into the equirectangular image a globe wants.
 *
 * The drape avoids this entirely by spacing its mesh rows in Mercator, so the
 * default UVs line up and no pixel is touched. A *basemap* has no such freedom:
 * it becomes the sphere's own texture, and the sphere's UVs are linear in
 * latitude. Hand it Mercator and every coastline slides polewards — Greenland
 * ends up over the pole and the tropics are squeezed into a band.
 *
 * Row by row, because that is all the distortion is: longitude maps linearly in
 * both projections, so only the vertical sampling changes. Each output row asks
 * which source row holds its latitude and copies it.
 *
 * Beyond ±85.05° Mercator has nothing, so those rows repeat the last real one.
 * A stretched ice cap is the conventional answer and reads as a pole; leaving
 * them transparent would show the sphere's fallback colour as a bright ring.
 */
export function equirectRowToSourceY(j, height, bbox, srcH) {
  const worldSize = TILE * 1024;                       // any zoom; only ratios matter
  const pyTop = latToPixelY(bbox.maxLat, worldSize);
  const pyBottom = latToPixelY(bbox.minLat, worldSize);
  const lat = 90 - ((j + 0.5) / height) * 180;
  const t = (latToPixelY(clampLat(lat), worldSize) - pyTop) / (pyBottom - pyTop);
  return Math.min(srcH - 1, Math.max(0, t * srcH));
}

export function toEquirectangular(mercCanvas, bbox, { width = 4096, height = 2048 } = {}) {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");

  const srcH = mercCanvas.height;
  const srcW = mercCanvas.width;

  for (let j = 0; j < height; j += 1) {
    const srcY = equirectRowToSourceY(j, height, bbox, srcH);
    ctx.drawImage(mercCanvas, 0, srcY, srcW, 1, 0, j, width, 1);
  }
  return out;
}

/**
 * Install a live tile service as the globe's basemap.
 *
 * This is the difference between a layer and a basemap: the texture goes onto
 * the sphere itself, so it takes the relief, the terrain slider and the
 * lighting like Blue Marble does, and it appears in the Basemap dropdown rather
 * than floating above everything in Active Layers.
 */
export async function installBaseLayer(sourceName = DEFAULT_SOURCE, { onProgress } = {}) {
  if (!isEarth()) throw new Error("These tile services only cover Earth.");
  if (!THREE) THREE = await import("../vendor/three.module.js");
  const viewer = window.GeoIDViewer;
  if (!viewer?.registerBaseLayer) {
    throw new Error("This viewer does not accept extra basemaps.");
  }
  const bbox = wholeGlobe();
  const result = await composite(bbox, sourceName, { onProgress, credit: false });
  const equirect = toEquirectangular(result.canvas, bbox);

  const texture = new THREE.CanvasTexture(equirect);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The seam at the antimeridian is a real edge of the image, so let it wrap
  // rather than clamp -- clamped, the last column smears around the join.
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;

  const id = baseLayerIdFor(sourceName);
  viewer.registerBaseLayer({ id, label: sourceName, texture });
  return { id, ...result, equirect };
}

// ── The mesh ─────────────────────────────────────────────────────────────────

/**
 * A grid over the box, sitting on the displaced terrain.
 *
 * Every constraint here was learnt the hard way on the Earth Engine drapes and
 * is recorded in GeoID_GIS/CLAUDE.md:
 *
 *   * vertices come from `surfacePoint`, never `radius + offset` — the basemap
 *     is displaced by the relief and a flat shell sits under the terrain;
 *   * segments are dense enough that the chord between two of them does not sag
 *     below the ground;
 *   * the material does not depth-test, because a grid of flat facets cannot
 *     win against relief that has detail below any grid, and the ground would
 *     otherwise rise through the imagery between vertices;
 *   * being single-sided is what makes that safe — the half of the patch on the
 *     far side of the planet is culled rather than showing through;
 *   * and the bounding sphere is recomputed, because the vertices have moved
 *     off the flat plane they were built as and a stale one gets the whole
 *     patch culled, which looks exactly like a failed request.
 */
export function buildMesh(canvas, bbox, { frame = "geo" } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // A degree of arc sags 0.0001 below the surface, which is well inside the
  // clearance; a study area is rarely more than a few tens of degrees, so this
  // keeps the step at or under a degree without an unreasonable vertex count.
  const span = Math.max(bbox.maxLat - bbox.minLat, bbox.maxLon - bbox.minLon);
  const segments = Math.max(24, Math.min(160, Math.ceil(span)));

  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position;
  const viewer = window.GeoIDViewer;
  // ZERO, where the Earth Engine drapes use 10 km and this used 1.2 km. Their
  // lift exists to clear the terrain at a glance from orbit; this imagery is
  // meant to be flown down to, and a lift IS a floor -- the camera cannot get
  // under its own basemap, so 1.2 km of clearance is 1.2 km you cannot descend
  // through. Safe at zero because the material does not depth test, so it
  // cannot lose to the relief between vertices however close it is; the lift
  // was buying nothing and costing the last kilometre of the approach.
  const LIFT = 0;

  // Rows evenly spaced in Mercator, latitudes from the inverse projection. This
  // is the whole reprojection: the plane's own UVs are linear, the canvas is
  // linear in Mercator, so spacing the rows this way makes them agree exactly
  // and not one pixel is resampled.
  const worldSize = TILE * 1024;
  const pyTop = latToPixelY(bbox.maxLat, worldSize);
  const pyBottom = latToPixelY(bbox.minLat, worldSize);

  const vertex = new THREE.Vector3();
  for (let y = 0; y <= segments; y += 1) {
    const lat = pixelYToLat(pyTop + (pyBottom - pyTop) * (y / segments), worldSize);
    for (let x = 0; x <= segments; x += 1) {
      const lon = bbox.minLon + (bbox.maxLon - bbox.minLon) * (x / segments);
      const point = viewer?.surfacePoint?.(lat, lon, LIFT);
      if (!point) throw new Error("The globe is not ready to be draped on yet.");
      vertex.copy(point);
      // `surfacePoint` answers in the baseline frame, which is what the geo
      // group wants. Parenting to the globe mesh instead means carrying its
      // half turn, exactly as the Earth Engine drapes do.
      if (frame === "globe") vertex.set(-vertex.x, vertex.y, -vertex.z);
      position.setXYZ(y * (segments + 1) + x, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  // Which way the patch ended up facing, measured at a vertex in the middle of
  // the grid where the normal is well defined, rather than reasoned about.
  const probe = Math.floor(segments / 2) * (segments + 1) + Math.floor(segments / 2);
  const normals = geometry.attributes.normal;
  const outward = new THREE.Vector3(
    position.getX(probe), position.getY(probe), position.getZ(probe),
  ).normalize();
  const facing = new THREE.Vector3(
    normals.getX(probe), normals.getY(probe), normals.getZ(probe),
  ).dot(outward);

  // The globe's terrain exaggeration eases off as the camera lands, and a mesh
  // built at one exaggeration hangs above a planet that has shrunk under it --
  // 219 km of it at the slider's default, which is the drift this file's own
  // note predicted ("a static mesh built at one relief does not shrink with the
  // terrain"). Same treatment as the vector layers: every vertex carries its
  // direction and its displacement, and one uniform places the patch at
  // whatever relief the globe is being drawn at, in the same frame.
  attachReliefAttributes(geometry, LIFT, Number(viewer?.getEffectiveRelief?.() ?? 0));
  const mesh = new THREE.Mesh(geometry, followRelief(new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: facing >= 0 ? THREE.FrontSide : THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  }), LIFT));
  mesh.frustumCulled = false;
  mesh.name = "GeoID-BasemapDrape";
  return mesh;
}

// ── The action ───────────────────────────────────────────────────────────────

function studyArea() {
  const active = window.GeoIDResearch?.store?.getActive?.();
  if (!active) throw new Error("Open a project first — the drape follows its study area.");
  return normaliseBbox(active.meta?.study_area);
}

/**
 * The whole planet, as a drape.
 *
 * Worth having as well as the study area, because "basemap" is what most people
 * come looking for and a study-area patch is not one. It fits: the tile budget
 * tops out at zoom 4, which is 4096 px across the world — about 9.8 km/px,
 * comparable to the 7.4 km/px Blue Marble the globe already ships. So this is a
 * real global basemap rather than a compromise, and it is street maps and
 * current satellite imagery where the shipped texture is a fixed composite.
 *
 * 85 rather than 90 because Mercator cannot express the poles; the same cut the
 * Earth Engine panel makes for the same reason.
 */
export function wholeGlobe() {
  return { minLat: -MAX_LAT, maxLat: MAX_LAT, minLon: -180, maxLon: 180 };
}

/**
 * Fetch, composite and drape, registering the result as an ordinary layer.
 *
 * Going in through `addDerivedLayer` rather than adding to the scene directly is
 * what gives it the layer list, its own opacity and visibility, removal, and the
 * draw-order stack — all of which already exist and none of which this has to
 * know about.
 */
export async function drapeStudyArea({ source = DEFAULT_SOURCE, extent = "study", onProgress } = {}) {
  if (!isEarth()) {
    throw new Error("These tile services only cover Earth.");
  }
  if (!THREE) THREE = await import("../vendor/three.module.js");
  const global = extent === "globe";
  const bbox = global ? wholeGlobe() : studyArea();
  const result = await composite(bbox, source, { onProgress });
  const mesh = buildMesh(result.canvas, bbox);

  const name = `${source} — ${global ? "whole globe" : "study area"}`;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, {
    object3D: mesh,
    georeferenced: true,
    bounds: { minX: bbox.minLon, minY: bbox.minLat, maxX: bbox.maxLon, maxY: bbox.maxLat },
    info: {
      source,
      credit: TILE_SOURCES[source].credit,
      zoom: result.zoom,
      resolution_m_per_px: Number(result.metresPerPixel.toFixed(2)),
      tiles: `${result.drawn}/${result.tiles}`,
    },
  }, "tiles");
  if (!layer) throw new Error("The layer list is not ready yet.");
  return { ...result, layer, bbox };
}

/**
 * Is there a drape on the globe right now?
 *
 * **Nothing consumes this yet, and that is a deliberate, recorded state.** The
 * drape is imagery at metres per pixel and the viewer pins the camera to a
 * floor of 3.7 — about 1000 km up — which is right for an 8 km/px basemap and
 * leaves this imagery correct but never viewable near its own resolution.
 *
 * The obvious fix is the one the viewer already makes for Mars's CTX tiles:
 * lower the floor when close-range imagery is present. That was tried and
 * reverted, because it only half worked — `controls.minDistance` did drop to
 * 3.316 (about 230 km) and the camera still stopped dead at 3.7, so a third
 * clamp is involved that was not isolated. Shipping it would have looked like a
 * fix while changing nothing a user can see.
 *
 * Two things were learnt and are worth keeping for whoever finishes it: this
 * must NOT be conditioned on layer visibility (keying it on `visible` meant
 * switching the layer off moved the camera, measured at 71% of the frame's
 * pixels), and the remaining clamp is somewhere other than the two
 * `setLength(_safeMin)` calls and `controls.minDistance` in earth-viewer.js.
 */
export function hasDrape() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  if (layers.some((l) => l.ext === "tiles" && l.status === "loaded")) return true;
  /**
   * An imported georeferenced raster is close-range imagery too.
   *
   * A 100 m susceptibility map over one country is exactly the case this floor
   * exists to allow: measured with the NI prototype loaded, the camera stopped
   * at 995 km — the floor for an 8 km/px basemap — so a map with detail at
   * 100 m could never be seen anywhere near its own resolution. The extent is
   * what qualifies it: a raster covering a few degrees is a local dataset,
   * while a global one says nothing about how close anybody should get.
   *
   * The test is the EXTENT, not the type. Qualifying only rasters meant the NI
   * susceptibility map reached 1.8 km while the NI geology polygons — the same
   * country, the same scale, drawn from the same survey — stopped at 995 km.
   * Two layers over one place behaved differently because of how they happened
   * to be stored, which is exactly what a user cannot be expected to model.
   *
   * NOT conditioned on visibility, for the reason recorded below: keying this
   * on `visible` made switching a layer off move the camera.
   */
  const local = layers.some((l) => l.status === "loaded" && l.bounds
    && (l.raster || l.features?.length)
    && Math.max(l.bounds.maxX - l.bounds.minX, l.bounds.maxY - l.bounds.minY) < 20);
  if (local) return true;
  // A tile BASEMAP counts too, and so does a refine patch. Only counting
  // registered layers meant flying in with OpenStreetMap as the basemap stopped
  // dead at 995 km — the floor stayed where it is for an 8 km/px texture, so the
  // refinement fetched detail nobody could get close enough to see.
  const id = window.GeoIDViewer?.getBaseLayerId?.() || "";
  if (id.startsWith("tiles-")) return true;
  return Boolean(window.GeoIDViewer?.globe?.getObjectByName?.("GeoID-BasemapRefine"));
}

// Guarded so the projection maths can be imported and tested under Node, where
// there is no window and an unguarded assignment would throw at import.
if (typeof window !== "undefined") {
  window.GeoIDBasemapDrape = {
    drapeStudyArea, composite, chooseZoom, tileGrid, normaliseBbox, hasDrape,
    installBaseLayer, toEquirectangular, wholeGlobe,
    startRefining, stopRefining, isRefining, tileBasemapSource,
    listBaseLayerOptions, watchBaseLayerSelection, baseLayerIdFor,
    // The layer list and the legend name the basemap that is actually drawn,
    // and its licence line travels with it -- these tile sources are free ON
    // CONDITION of that credit, so whatever shows the map has to be able to
    // show the condition.
    TILE_SOURCES,
  };
}

// ── The panel ────────────────────────────────────────────────────────────────

/**
 * Built here rather than in the markup.
 *
 * The Earth page and the nine planet pages get their GIS panels from two
 * different places, so anything added as HTML has to be added twice and stays
 * in step only by luck. Injecting it keeps one copy, and lets the panel simply
 * not appear on the worlds where these services have no data.
 */
function buildPanel() {
  // Into Basemap & Relief, not Add / Import Data.
  //
  // It sat under imports first, which is where a developer files "fetches tiles
  // from a service" and nowhere near where anyone looks for a basemap: the
  // report was simply "there's no option in basemaps for them", and that was
  // fair -- it was two closed disclosure triangles deep in a different tab.
  // Falls back to the import group on a page that has no basemap panel.
  const host = document.querySelector("#basemap-relief-section .section-body .control-stack")
    || document.querySelector("#basemap-relief-section .section-body")
    || document.querySelector("#gis-group-import .section-body");
  if (!host || document.getElementById("basemap-attribution")) return;
  if (!isEarth()) return;

  // The dropdown gets its entries here, not on first use -- that is the whole
  // point of them being basemaps.
  listBaseLayerOptions();

  /**
   * The source line, back UNDER the Basemaps box — reinstated by request
   * after a spell in the map corner. One compact credit line and a
   * short-form licence tag (full text in the tooltip), tracking
   * `base-layer-select` — what is actually on the sphere — both ways; the
   * NonCommercial warning survives as an amber tint. The attribution
   * itself is non-negotiable: EOX and Esri license on condition of being
   * named.
   *
   * Refinement has no toggle: sharpening on zoom IS the point of a tile
   * basemap, so it simply runs whenever one is selected.
   */
  const box = document.createElement("div");
  box.id = "basemap-attribution";
  box.innerHTML = `
      <div id="basemap-drape-credit" class="gis-metric" hidden
        style="font-size:0.56rem;opacity:0.7;line-height:1.35;"></div>
      <div id="basemap-drape-licence" class="gis-metric" hidden
        style="font-size:0.56rem;opacity:0.7;"></div>`;
  // Directly under the catalogue whose choice it credits.
  const catalogueStatus = document.getElementById("basemap-catalogue-status");
  if (catalogueStatus) catalogueStatus.after(box);
  else host.appendChild(box);

  const credit = box.querySelector("#basemap-drape-credit");
  const licence = box.querySelector("#basemap-drape-licence");

  const showCredit = (text) => {
    credit.textContent = text || "";
    credit.hidden = !text;
  };
  const showLicence = (sourceName) => {
    const src = TILE_SOURCES[sourceName];
    const full = src?.licence || "";
    // The short form: up to the first dash or SENTENCE-ending stop — a bare
    // [.] split cut "CC BY-NC-SA 4.0" at its own decimal point. The whole
    // licence paragraph read as a wall; the wall survives in the tooltip.
    licence.textContent = full.split(/—|\.\s/)[0].trim();
    licence.title = full;
    licence.hidden = !full;
    licence.style.color = (src && src.freeToStream === false)
      ? "rgba(255, 205, 130, 0.75)" : "";
  };

  const sourceForId = (id) => Object.entries(TILE_SOURCES)
    .find(([name]) => baseLayerIdFor(name) === id)?.[0] || "";
  document.getElementById("base-layer-select")?.addEventListener("change", (event) => {
    const id = event.target.value || "";
    const name = sourceForId(id);
    showCredit(name ? TILE_SOURCES[name].credit : "");
    showLicence(name);
    // Refinement belongs to the tile basemap. Left running under Blue Marble
    // it would keep fetching tiles for a basemap nobody is looking at.
    if (id.startsWith("tiles-")) startRefining({});
    else stopRefining();
  });
}

/**
 * Two things have to be ready, and neither is ready when this module loads: the
 * GIS panels (injected into the page) and the viewer itself (booted async, and
 * the owner of the dropdown). Retrying the panel alone was enough while the
 * entries were created on first use; now that the dropdown must list the
 * services up front, missing the viewer means they never appear at all — which
 * is precisely the failure this replaced.
 *
 * So: keep trying until both have happened, then stop.
 */
let selectionWatched = false;
let defaultApplied = false;

/**
 * The basemap the globe settles on, once it can.
 *
 * `blue-marble` still paints the FIRST frame and that is deliberate: it ships
 * with the site, so it is on the sphere before any network call, and a globe
 * that is bare or sandy for the two seconds a tile fetch takes is a worse
 * first impression than one that improves. So the shipped texture opens and
 * this swaps to the streamed imagery the moment the option exists and the
 * watcher is listening — the watcher does the fetching, holding the old map up
 * until the tiles are there, which is the whole reason it exists.
 *
 * Once only. `initWhenReady` retries up to forty times, and re-selecting on
 * every attempt would fight a user who changed the basemap in the first
 * twenty seconds.
 *
 * LICENCE, because a default is not the same decision as an option. What every
 * visitor to a public page is handed without choosing it should be the source
 * with the fewest strings, so this is **Sentinel-2 Cloudless** rather than
 * Esri's World Imagery: Esri's is free of charge on that endpoint and is NOT
 * licensed for unrestricted or commercial embedding, and Esri's own FAQ
 * conditions every permission on holding an ArcGIS subscription. Esri stays in
 * the list, one click away, where picking it is a choice somebody made.
 *
 * Sentinel-2 Cloudless is not unconditional either and the file says so —
 * EOX releases it CC BY-NC-SA, so **NonCommercial**, with commercial use sold
 * separately. That judgement belongs to whoever runs the deployment, which is
 * why the licence rides beside the picker rather than being decided here.
 * `NASA VIIRS Daily` is the only imagery in the list with no condition at all,
 * and is the right default for anyone who would rather not make the call.
 *
 * THE COST, stated because it is visible: Sentinel-2 caps at zoom 14 — the
 * sensor's own 10 m — where Esri reaches 19. Full zoom is therefore about
 * 7.5 m/px rather than 0.3 m/px. Against the 8 km/px shipped texture this is
 * still three orders of magnitude better, and the study-area drape and the
 * refine path both read `source.maxZoom`, so neither asks EOX for the
 * interpolated tiles it would happily serve above 14.
 */
const DEFAULT_TILE_SOURCE = "Sentinel-2 Cloudless";

function applyDefaultBasemap() {
  if (defaultApplied) return;
  const select = document.getElementById("base-layer-select");
  const id = baseLayerIdFor(DEFAULT_TILE_SOURCE);
  if (!select || !select.querySelector(`option[value="${id}"]`)) return;
  // Only from the shipped default. If the value is anything else the user has
  // already chosen, and a default must not overrule a choice.
  if (select.value !== "blue-marble") { defaultApplied = true; return; }
  defaultApplied = true;
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function initWhenReady() {
  let tries = 0;
  const attempt = () => {
    buildPanel();
    // Listing and watching are retried HERE, not inside buildPanel: that runs
    // its body once and returns early ever after, so anything needing the
    // viewer got one attempt at whatever moment the panels happened to appear.
    // The options came back on a later try and the selection watcher did not,
    // which is why choosing a service left the planet bare.
    listBaseLayerOptions();
    if (!selectionWatched && window.GeoIDViewer && document.getElementById("base-layer-select")) {
      const status = document.getElementById("basemap-drape-status");
      watchBaseLayerSelection({
        onStatus: (m) => { if (status) status.textContent = m; },
      });
      selectionWatched = true;
    }
    // After the watcher, never before: selecting a tile layer nothing is
    // listening for is how the planet goes bare.
    if (selectionWatched) applyDefaultBasemap();
    const inDropdown = document.querySelector('#base-layer-select option[value^="tiles-"]');
    if ((selectionWatched && inDropdown) || (tries += 1) > 40) return;
    setTimeout(attempt, 500);
  };
  attempt();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhenReady);
  } else {
    initWhenReady();
  }
  window.addEventListener("geoid-gis:shell-ready", initWhenReady);
}

// ── Refining with zoom ───────────────────────────────────────────────────────

/**
 * Detail for whatever is on screen, refreshed when the camera comes to rest.
 *
 * A basemap texture is one image at one resolution: the global composite is
 * 9.8 km/px and no amount of flying in gives it more. This is the second tier —
 * a patch covering just the visible extent, fetched at the zoom that extent
 * deserves, replaced each time the view settles somewhere new.
 *
 * Two tiers rather than a streamer, deliberately. A streamer keeps a quadtree of
 * tiles alive with a scheduler, an eviction policy and a per-frame budget; this
 * keeps exactly one patch and rebuilds it, which is a few hundred lines less and
 * enough for a globe someone is reading rather than flying.
 *
 * What makes it safe to leave running:
 *
 *   * it fires only on rest, never per frame — a drag issues one round of tiles
 *     at the end, not thousands on the way;
 *   * it only acts when the view has genuinely changed (`viewChangedEnough`);
 *   * it does nothing at all above `MIN_REFINE_ALTITUDE`, where the global
 *     texture is already as good as the screen can show;
 *   * and it never asks for a zoom the base texture already covers, so sitting
 *     still costs nothing.
 */

// Above this the whole-globe basemap out-resolves the screen and a patch would
// be identical to what is already there. Roughly 2000 km up.
const MIN_REFINE_ALTITUDE = 1.0;
// The base global composite is zoom 4; below that there is nothing to add.
const BASE_GLOBE_ZOOM = 4;

let refineState = null;

/**
 * Where the detail patch hangs.
 *
 * NOT the imported-layers group: `import-manager` creates that lazily on the
 * first import, so in a session with no imports it does not exist and the patch
 * had nowhere to go — `refineOnce` returned null without a word and the status
 * sat on "Refining to zoom 7…" forever while the tiles had actually arrived in
 * 243 ms. The globe mesh is always there, and is where the Earth Engine drapes
 * already parent; the cost is carrying its half turn, which `buildMesh` does
 * when asked for the "globe" frame.
 */
/**
 * The streamed detail patch is IMAGERY, so it draws under the data.
 *
 * It used to sit at 60 — inside the imported band, which starts at 50 — so as
 * soon as the imagery refined for the view it painted over every imported
 * layer: fly in over Northern Ireland with a tile basemap on and the geology
 * simply disappeared under the map. Measured: refine patch renderOrder 60
 * against the geology's 51.
 *
 * 40 is the streamed-tile band in the draw-order table: above the basemap
 * shells (0-7), below anything anybody imported or derived (50+).
 */
const REFINE_ORDER = 40;

function refineParent() {
  return window.GeoIDViewer?.globe || null;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.map?.dispose?.();
  mesh.material?.dispose?.();
}

/** Is a tile basemap the one currently showing? */
export function tileBasemapSource() {
  const id = window.GeoIDViewer?.getBaseLayerId?.() || "";
  if (!id.startsWith("tiles-")) return null;
  return Object.keys(TILE_SOURCES).find((name) => baseLayerIdFor(name) === id) || null;
}

/** One refinement pass: fetch the visible extent and swap the detail patch in. */
async function refineOnce({ onStatus } = {}) {
  const viewer = window.GeoIDViewer;
  const source = tileBasemapSource();
  if (!viewer || !source) return null;
  if (altitudeUnits(viewer) > MIN_REFINE_ALTITUDE) return null;

  if (!THREE) THREE = await import("../vendor/three.module.js");
  const bbox = visibleBounds(viewer, THREE);
  if (!bbox) return null;
  if (!viewChangedEnough(refineState?.bbox, bbox)) return null;

  const zoom = chooseZoom(bbox, { maxZoom: TILE_SOURCES[source].maxZoom });
  if (zoom <= BASE_GLOBE_ZOOM) return null;

  // Claim the request before awaiting, so a second settle while this one is in
  // flight is measured against where we are going rather than where we were.
  refineState = { ...(refineState || {}), bbox, zoom, source, busy: true };
  onStatus?.(`Refining to zoom ${zoom}…`);

  /**
   * Show it while it is still arriving, rather than after.
   *
   * Measured on a 90-tile patch: the first tile lands at 122 ms and the last at
   * 1524 ms, and nothing at all was drawn until the last one — so the imagery
   * existed for 1.4 seconds before anyone could see it, then appeared all at
   * once. That pop is most of what "not seamless" meant.
   *
   * The canvas is no longer given a backdrop, so the parts that have not
   * arrived are transparent and the globe shows through them. That is what
   * makes it safe to hang the mesh up front and let it fill in: at worst the
   * patch is invisible, never a dark rectangle over the map.
   */
  let live = null;
  const showEarly = (done, total, canvas, level) => {
    if (!refineState || refineState.bbox !== bbox) return;
    if (!live) {
      const group = refineParent();
      if (!group) return;
      const mesh = buildMesh(canvas, bbox, { frame: "globe" });
      mesh.renderOrder = REFINE_ORDER;
      mesh.name = "GeoID-BasemapRefinePending";
      group.add(mesh);
      live = mesh;
    }
    // A CanvasTexture re-uploads on demand; this is the whole progressive path.
    live.material.map.needsUpdate = true;
    if (done % 8 === 0 || done === total) {
      onStatus?.(`Sharpening: level ${level} — ${done}/${total} tiles…`);
    }
  };

  try {
    // Rings, coarsest first, into one canvas -- the streamer rather than a
    // single-level composite. The coarsest ring is a tile or two and lands
    // almost at once, so the ground is plausible immediately and sharpens,
    // instead of arriving perfect and late.
    const grid = tileGrid(bbox, zoom);
    const canvas = document.createElement("canvas");
    canvas.width = grid.width;
    canvas.height = grid.height;
    const streamed = await streamRings(canvas, bbox, source, {
      targetZoom: zoom,
      grid,
      tileGridAt: tileGrid,
      onPaint: showEarly,
      // Retire: a newer view supersedes this pass. Requests already made are
      // left to finish into the cache rather than aborted.
      shouldContinue: () => Boolean(refineState) && refineState.bbox === bbox,
    });
    const result = {
      canvas, zoom, source,
      tiles: streamed.queued, drawn: streamed.painted,
      metresPerPixel: metresPerPixel(bbox, zoom),
      streamed,
    };
    // Switched off, or the basemap changed, while these tiles were in flight.
    // `stopRefining` nulls the state, so reading it unguarded here crashed on
    // the one interaction most likely to happen during a slow fetch: giving up
    // and unticking the box.
    if (!refineState) { disposeMesh(live); return null; }
    // Another pass overtook this one; its patch is the current view, not ours.
    if (refineState.bbox !== bbox) { disposeMesh(live); return null; }
    // `live` is already on the globe and already carries every tile that
    // arrived — it only has to be promoted. Building a second mesh here would
    // re-upload the same canvas and flicker between the two.
    if (!live) {
      const group = refineParent();
      if (!group) {
        onStatus?.("The globe is not ready for detail yet.");
        return null;
      }
      live = buildMesh(result.canvas, bbox, { frame: "globe" });
      live.renderOrder = REFINE_ORDER;
      group.add(live);
    }
    live.name = "GeoID-BasemapRefine";
    live.material.map.needsUpdate = true;
    // The previous patch is only dropped now, so there is never a moment with no
    // detail on screen: the old one stays until the new one is complete.
    if (refineState.mesh !== live) disposeMesh(refineState.mesh);
    refineState.mesh = live;
    const reused = streamed.fromCache ? `, ${streamed.fromCache} from cache` : "";
    onStatus?.(`Detail at zoom ${result.zoom} (${Math.round(result.metresPerPixel)} m/px) `
      + `over ${streamed.levels.length} levels${reused}.`);
    return { ...result, bbox };
  } catch (error) {
    disposeMesh(live);
    throw error;
  } finally {
    if (refineState) refineState.busy = false;
  }
}

/**
 * Start refining, and keep doing it until told to stop.
 *
 * Idempotent: calling it twice does not stack two watchers, which matters
 * because the panel wires it to a checkbox and the basemap can be reselected.
 */
export function startRefining({ onStatus } = {}) {
  if (refineState?.stop) return refineState.stop;
  const viewer = window.GeoIDViewer;
  if (!viewer) return null;
  refineState = { ...(refineState || {}) };
  refineState.stop = onViewSettled(viewer, () => {
    if (!refineState || refineState.busy) return;
    void refineOnce({ onStatus });
    // 250 ms rather than the 500 ms default. Half a second of stillness before
    // anything begins is itself most of a second added to every move, and the
    // first tiles now appear about 150 ms after the request rather than at the
    // end -- so the wait is what dominates. 250 ms is still unambiguously
    // "stopped" and does not fire during a drag.
  }, { settleMs: 250, pollMs: 100 });
  return refineState.stop;
}

export function stopRefining() {
  refineState?.stop?.();
  disposeMesh(refineState?.mesh);
  refineState = null;
}

export function isRefining() {
  return Boolean(refineState?.stop);
}

// ── Listing the services in the Basemap dropdown ─────────────────────────────

/**
 * Put every tile service in the Basemap dropdown, before any of them is used.
 *
 * The entries used to be created by `installBaseLayer`, i.e. on first use — so
 * the dropdown offered them only *after* someone had found the panel and
 * pressed a button, and the honest report was "no sign of street view in the
 * basemap dropdown". A picker has to list what it can show; choosing one is
 * what loads it, not the other way round.
 *
 * Listed with no texture, fetched on selection.
 */
export function listBaseLayerOptions() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.registerBaseLayer || !isEarth()) return 0;
  let added = 0;
  for (const name of Object.keys(TILE_SOURCES)) {
    if (viewer.registerBaseLayer({ id: baseLayerIdFor(name), label: name })) added += 1;
  }
  return added;
}

export function baseLayerIdFor(sourceName) {
  return `tiles-${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Load a listed service when it is chosen, and keep the old map up meanwhile.
 *
 * The globe's material falls back to a flat sandy colour when a layer has no
 * texture, so selecting an unfetched service would blank the planet for the
 * seconds the tiles take. Instead the selection is put back to whatever was
 * showing, the tiles are fetched, and the switch happens once there is
 * something to switch to.
 */
export function watchBaseLayerSelection({ onStatus } = {}) {
  const select = document.getElementById("base-layer-select");
  const viewer = window.GeoIDViewer;
  if (!select || !viewer) return null;

  const loaded = new Set();
  let showing = select.value;
  let loading = false;

  const handler = async () => {
    const id = select.value;
    if (!id.startsWith("tiles-") || loaded.has(id)) { showing = id; return; }
    if (loading) return;
    const source = Object.keys(TILE_SOURCES).find((n) => baseLayerIdFor(n) === id);
    if (!source) { showing = id; return; }

    loading = true;
    // Hold the current map on screen. Setting `.value` is not enough: the
    // viewer's own change listener is registered first and has already run,
    // seen a layer with no texture, and set the sphere's map to null -- so the
    // planet is bare ground by the time we get here. Re-dispatching is what
    // puts the previous texture back while the tiles are on their way.
    select.value = showing;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    onStatus?.(`Loading ${source}…`);
    try {
      const out = await installBaseLayer(source, {
        onProgress: (done, total) => onStatus?.(`${source}: ${done}/${total} tiles…`),
      });
      loaded.add(id);
      showing = id;
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      onStatus?.(`${source} — ${out.drawn}/${out.tiles} tiles at zoom ${out.zoom} `
        + `(${Math.round(out.metresPerPixel / 1000)} km/px).`);
    } catch (error) {
      select.value = showing;
      onStatus?.(`${source} could not be loaded: ${error.message}`);
    } finally {
      loading = false;
    }
  };

  select.addEventListener("change", handler);
  return () => select.removeEventListener("change", handler);
}
