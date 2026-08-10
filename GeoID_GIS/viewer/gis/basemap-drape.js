// Real map imagery, draped over the project's study area on the globe.
//
// The globe's basemap is a single equirectangular texture at roughly 8 km per
// pixel, so it has no zoom pyramid: past a certain altitude there is simply no
// more detail to show, whatever the camera does. That is fine for a planet and
// useless for a site. This module fills the gap where it actually matters --
// over the study area -- by fetching XYZ tiles for that box, compositing them
// into one canvas and draping it on the terrain as an ordinary layer.
//
// Deliberately NOT a globe-wide tile streamer. That is a real project (the
// design is written up in flight_sim/mars/viewer/STREAMING-DESIGN.md) and it
// would be the wrong first move: a study area is bounded, so one composite at a
// fixed zoom answers the question "what is actually on the ground here?" with
// no scheduler, no cache eviction and no per-frame budget.
//
// Two things make this cheap that would not be obvious:
//
//   * **No reprojection.** Web Mercator and the globe disagree about latitude,
//     which normally means resampling every pixel. Instead the mesh's rows are
//     spaced evenly in Mercator y and their latitudes come from the inverse
//     projection, so the default plane UVs land exactly right and the tile
//     pixels are used untouched.
//   * **The geo group already holds the spin.** `GeoID-ImportedGeoLayers` turns
//     with the globe, so vertices go in the baseline frame that `surfacePoint`
//     answers in -- no half-turn to bake in, unlike the Earth Engine drapes
//     which parent to the globe mesh itself.

import { TILE_SOURCES, DEFAULT_SOURCE, tileUrl } from "./tile-sources.js?v=20260810-c6df62d";
import { isEarth } from "./bodies.js?v=20260810-c6df62d";

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
export async function composite(bbox, sourceName = DEFAULT_SOURCE, { onProgress } = {}) {
  const source = TILE_SOURCES[sourceName];
  if (!source) throw new Error(`No tile source named "${sourceName}".`);
  const z = chooseZoom(bbox, { maxZoom: source.maxZoom });
  const grid = tileGrid(bbox, z);

  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0d18";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
        onProgress?.(done, total);
      });
    }
  }
  await pool(jobs);
  if (!drawn) {
    throw new Error(`${sourceName} returned no tiles for this area.`);
  }
  paintCredit(ctx, canvas.width, canvas.height, source.credit);
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
export function buildMesh(canvas, bbox) {
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
  const LIFT = 0.005;

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

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: facing >= 0 ? THREE.FrontSide : THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  }));
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
 * Fetch, composite and drape, registering the result as an ordinary layer.
 *
 * Going in through `addDerivedLayer` rather than adding to the scene directly is
 * what gives it the layer list, its own opacity and visibility, removal, and the
 * draw-order stack — all of which already exist and none of which this has to
 * know about.
 */
export async function drapeStudyArea({ source = DEFAULT_SOURCE, onProgress } = {}) {
  if (!isEarth()) {
    throw new Error("These tile services only cover Earth.");
  }
  if (!THREE) THREE = await import("../vendor/three.module.js");
  const bbox = studyArea();
  const result = await composite(bbox, source, { onProgress });
  const mesh = buildMesh(result.canvas, bbox);

  const name = `${source} — study area`;
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
  return layers.some((l) => l.ext === "tiles" && l.status === "loaded");
}

// Guarded so the projection maths can be imported and tested under Node, where
// there is no window and an unguarded assignment would throw at import.
if (typeof window !== "undefined") {
  window.GeoIDBasemapDrape = {
    drapeStudyArea, composite, chooseZoom, tileGrid, normaliseBbox, hasDrape,
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
  const host = document.querySelector("#gis-group-import .section-body");
  if (!host || document.getElementById("basemap-drape-tool")) return;
  if (!isEarth()) return;

  const box = document.createElement("details");
  box.id = "basemap-drape-tool";
  box.className = "gis-tool-section";
  box.innerHTML = `
    <summary>Map imagery over the study area</summary>
    <div class="gis-tool-body">
      <p class="tool-copy">The globe's basemap is one texture at about 8&nbsp;km per pixel.
        This fetches real map tiles for the project's study area and drapes them on the
        terrain, down to sub-metre where the service has it.</p>
      <div class="row">
        <label for="basemap-drape-source">Source</label>
        <select id="basemap-drape-source" class="mini-select"></select>
      </div>
      <button id="basemap-drape-run" class="tool-button" type="button">Drape over study area</button>
      <div id="basemap-drape-status" class="gis-metric">Uses the study area from the open project.</div>
    </div>`;
  host.appendChild(box);

  const select = box.querySelector("#basemap-drape-source");
  Object.keys(TILE_SOURCES).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = DEFAULT_SOURCE;

  const status = box.querySelector("#basemap-drape-status");
  const run = box.querySelector("#basemap-drape-run");
  run.addEventListener("click", async () => {
    run.disabled = true;
    status.textContent = "Working out the zoom…";
    try {
      const out = await drapeStudyArea({
        source: select.value,
        onProgress: (done, total) => { status.textContent = `Fetching tiles ${done}/${total}…`; },
      });
      status.textContent = `Draped ${out.drawn}/${out.tiles} tiles at zoom ${out.zoom} `
        + `(${out.metresPerPixel < 1 ? out.metresPerPixel.toFixed(2) : Math.round(out.metresPerPixel)} m/px). `
        + `It is in Active Layers.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      run.disabled = false;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildPanel);
  } else {
    buildPanel();
  }
  // The planet pages inject their panels after this module loads, so the host
  // may not exist yet on the first try.
  window.addEventListener("geoid-gis:shell-ready", buildPanel);
  setTimeout(buildPanel, 1500);
}
