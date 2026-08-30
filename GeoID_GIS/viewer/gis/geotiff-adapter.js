import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic } from "./geo-utils.js?v=20260830-97628ed";

// Rasters are resampled onto a mesh grid rather than used at native size: a
// 4000x4000 DEM would otherwise mean 16M vertices. 192 keeps relief readable
// while staying cheap enough to add several layers at once.
const MAX_GRID = 192;
const TEXTURE_MAX = 1024;

function loadGeoTiffLibrary() {
  if (window.GeoTIFF) {
    return Promise.resolve(window.GeoTIFF);
  }
  if (!loadGeoTiffLibrary._promise) {
    loadGeoTiffLibrary._promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/geotiff.js";
      script.addEventListener("load", () => {
        if (window.GeoTIFF) {
          resolve(window.GeoTIFF);
        } else {
          reject(new Error("geotiff.js loaded but exposed no global."));
        }
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("Failed to load vendor/geotiff.js.")), { once: true });
      document.head.appendChild(script);
    });
  }
  return loadGeoTiffLibrary._promise;
}

function resample(values, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Float32Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    const sy = Math.min(srcHeight - 1, Math.round((y / (dstHeight - 1 || 1)) * (srcHeight - 1)));
    for (let x = 0; x < dstWidth; x += 1) {
      const sx = Math.min(srcWidth - 1, Math.round((x / (dstWidth - 1 || 1)) * (srcWidth - 1)));
      out[y * dstWidth + x] = values[sy * srcWidth + sx];
    }
  }
  return out;
}

function computeRange(values, noData) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v) || (noData !== null && v === noData)) {
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  return { min, max: max === min ? min + 1 : max };
}

// Perceptually ordered ramp so single-band rasters (DEMs, and any other
// continuous measurement) read as terrain rather than as a flat grey slab.
function elevationColor(t) {
  const stops = [
    [0.0, 15, 42, 92],
    [0.25, 26, 112, 140],
    [0.45, 62, 140, 78],
    [0.65, 176, 168, 74],
    [0.82, 140, 96, 56],
    [1.0, 245, 245, 245],
  ];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [p0, r0, g0, b0] = stops[i];
    const [p1, r1, g1, b1] = stops[i + 1];
    if (t <= p1) {
      const f = (t - p0) / ((p1 - p0) || 1);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [245, 245, 245];
}

function buildTexture(bands, width, height, range, noData, classes = null, colourOf = null) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, TEXTURE_MAX / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  const isRgb = bands.length >= 3;

  for (let y = 0; y < canvas.height; y += 1) {
    const sy = Math.min(height - 1, Math.round((y / (canvas.height - 1 || 1)) * (height - 1)));
    for (let x = 0; x < canvas.width; x += 1) {
      const sx = Math.min(width - 1, Math.round((x / (canvas.width - 1 || 1)) * (width - 1)));
      const si = sy * width + sx;
      const di = (y * canvas.width + x) * 4;
      // A chosen symbology beats every automatic rule below it. This is the
      // whole point of letting someone classify a layer: their breaks and
      // their ramp, not the adapter's guess about what the data looks like.
      if (colourOf && !isRgb) {
        const raw = bands[0][si];
        const rgb = colourOf(raw);
        if (rgb) {
          image.data[di] = rgb[0];
          image.data[di + 1] = rgb[1];
          image.data[di + 2] = rgb[2];
          image.data[di + 3] = 255;
        } else {
          image.data[di + 3] = 0;                       // no value, no pixel
        }
        continue;
      }

      if (isRgb) {
        image.data[di] = bands[0][si];
        image.data[di + 1] = bands[1][si];
        image.data[di + 2] = bands[2][si];
        image.data[di + 3] = 255;
      } else {
        const v = bands[0][si];
        if (!Number.isFinite(v) || (noData !== null && v === noData)) {
          image.data[di + 3] = 0;
          continue;
        }
        let r;
        let g;
        let b;
        if (classes) {
          const at = classes.indexOf(v);
          [r, g, b] = classColour(at < 0 ? 0 : at, classes.length);
        } else {
          const t = (v - range.min) / (range.max - range.min);
          [r, g, b] = elevationColor(Math.min(1, Math.max(0, t)));
        }
        image.data[di] = r;
        image.data[di + 1] = g;
        image.data[di + 2] = b;
        image.data[di + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Builds a curved patch that sits on the globe across the raster's geographic
 * bounds. Single-band rasters additionally displace the surface so relief is
 * visible against the basemap.
 */
/**
 * Is this band a height field, or a set of categories wearing numbers?
 *
 * The old test was the band COUNT — one band meant elevation — and that is
 * true of a DEM and false of everything else a GIS produces: a susceptibility
 * class, a land-cover code, a reclassified index are all single-band and none
 * of them is a height. Displaced anyway, a five-class map became a comb of
 * 240 km spikes, which is what "the mapping is a mess, it appears as 3D
 * fibers" looks like from the outside.
 *
 * So the test is about the values: a surface with a handful of distinct
 * heights is not a surface. Real terrain over any real extent has thousands
 * of distinct values; a classification has as many as it has classes. The
 * sample is bounded because this runs on import, and a flat raster that is
 * wrongly called categorical loses nothing — its relief was invisible anyway.
 */
function distinctValues(band, noData, limit = 40) {
  const distinct = new Set();
  const stride = Math.max(1, Math.floor(band.length / 50000));
  for (let i = 0; i < band.length; i += stride) {
    const v = band[i];
    if (!Number.isFinite(v) || (noData !== null && v === noData)) continue;
    distinct.add(v);
    if (distinct.size > limit) return null;    // continuous: stop counting
  }
  return [...distinct].sort((a, b) => a - b);
}

function looksLikeHeightField(band, noData, limit = 40) {
  return distinctValues(band, noData, limit) === null;
}

/**
 * The five-step risk ramp, green through red — ColorBrewer RdYlGn reversed,
 * and the same colours the prototype page prints.
 *
 * A classified raster was being coloured with the hypsometric ELEVATION ramp,
 * whose top stop is white: the worst class of a susceptibility map came out
 * white, and the legend showed white as the layer's colour. Classes are not
 * heights and must not borrow a height's palette. Fewer or more than five
 * classes are sampled from the same ramp, so the reading stays "green is
 * lower, red is worse" whatever the class count.
 */
const CLASS_RAMP = [
  [26, 152, 80], [166, 217, 106], [255, 255, 191], [253, 174, 97], [215, 25, 28],
];

function classColour(index, count) {
  if (count <= 1) return CLASS_RAMP[CLASS_RAMP.length - 1];
  const t = index / (count - 1);
  const at = t * (CLASS_RAMP.length - 1);
  const i = Math.min(CLASS_RAMP.length - 2, Math.floor(at));
  const f = at - i;
  const a = CLASS_RAMP[i];
  const b = CLASS_RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const hex = ([r, g, b]) => [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function buildDrapedPatch(grid, gridWidth, gridHeight, bounds, texture, range, isDem, noData) {
  const geometry = new THREE.PlaneGeometry(1, 1, gridWidth - 1, gridHeight - 1);
  const position = geometry.attributes.position;
  const baseRadius = drapedRadius(0.002);
  /**
   * Follow the relief, never a fixed radius.
   *
   * The basemap is displaced by terrain: its surface spans 3.2095-3.2989
   * against a base radius of 3.2, so a flat drape at 3.202 sits UNDERNEATH it
   * everywhere, ocean included, and the layer is invisible. That is exactly
   * what happened the moment classified rasters stopped being displaced — the
   * spikes had been the only thing poking through.
   *
   * `surfacePoint` is the viewer's own displaced surface and tracks the
   * terrain slider, so the patch hugs the ground at whatever exaggeration is
   * set. It only exists once a globe is up; the flat radius remains the
   * fallback for Model mode and for tests with no viewer.
   */
  const surfacePoint = window.GeoIDViewer?.surfacePoint;
  /**
   * Every drape sits ON the globe's terrain. None of them makes its own.
   *
   * A DEM used to displace the patch by its own values at a raw radius — not
   * following the ground, just pushed outward — which is what turned an
   * elevation layer into a firework of spikes. The globe already draws
   * terrain, and it draws it with the exaggeration the relief slider sets; a
   * raster's job is to colour that surface, not to invent a second one. So the
   * displacement is gone, the height only chooses the COLOUR ramp, and every
   * layer follows `surfacePoint`, which tracks the slider.
   *
   * The lift is per layer and tiny. Two maps drawn at the same height fight
   * for the same pixels, which is what "two or more maps cannot be mapped
   * concurrently" looks like; a few metres of separation each, in load order,
   * costs nothing and stacks them predictably.
   */
  /**
   * ZERO. A drape is painted ON the ground, and any lift at all is parallax.
   *
   * The lift existed to stop two maps fighting for the same pixels — which is
   * a DEPTH fight, and this material stopped depth-testing long ago. With
   * `depthTest: false` the depth buffer is not consulted at all, so the later
   * `renderOrder` wins outright and there is nothing to fight: the stacking
   * was already being done by the draw order the layer box controls, and the
   * lift was buying separation that was not needed at the cost of separation
   * that was not wanted. Measured at 30 m a layer, the twelfth map sat 329 m
   * off the ground it describes — which at any oblique angle is the map
   * sliding away from its own terrain.
   */
  const stackLift = 0;
  const vertex = new THREE.Vector3();

  for (let y = 0; y < gridHeight; y += 1) {
    const latT = y / (gridHeight - 1 || 1);
    const lat = bounds.maxY - (bounds.maxY - bounds.minY) * latT;
    for (let x = 0; x < gridWidth; x += 1) {
      const lonT = x / (gridWidth - 1 || 1);
      const lon = bounds.minX + (bounds.maxX - bounds.minX) * lonT;
      const index = y * gridWidth + x;
      if (surfacePoint) {
        vertex.copy(surfacePoint(lat, lon, stackLift));
      } else {
        // No globe (Model mode, tests): a plain sphere is the honest fallback.
        vertex.copy(latLonToVector3(lat, lon, baseRadius));
      }
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const builtAt = window.GeoIDViewer?.getEffectiveRelief?.();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.95,
    metalness: 0.0,
    // A tessellated patch cannot out-clearance terrain that has detail below
    // any grid, so it does not try: no depth test, and single-sided so the far
    // hemisphere is still culled. The same answer the GEE drapes arrived at.
    depthTest: false,
    side: THREE.FrontSide,
  }));
  /**
   * A drape is a STATIC mesh, and the ground under it is not.
   *
   * Descending tapers the terrain exaggeration away, so a patch built at one
   * relief is left hanging above the shrinking surface and steps each time the
   * taper moves. The Esri refine patch never shows this because it is rebuilt
   * whenever the view settles; a study-area drape is not, and neither was
   * this. So each patch keeps what it needs to rebuild — its own grid — and
   * re-lays its vertices when the relief it was built at no longer matches the
   * one being drawn.
   */
  mesh.userData.rebuildDrape = () => {
    const surface = window.GeoIDViewer?.surfacePoint;
    if (!surface) return;
    const pos = geometry.attributes.position;
    for (let y = 0; y < gridHeight; y += 1) {
      const lat = bounds.maxY - (bounds.maxY - bounds.minY) * (y / (gridHeight - 1 || 1));
      for (let x = 0; x < gridWidth; x += 1) {
        const lon = bounds.minX + (bounds.maxX - bounds.minX) * (x / (gridWidth - 1 || 1));
        const point = surface(lat, lon, stackLift);
        pos.setXYZ(y * gridWidth + x, point.x, point.y, point.z);
      }
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    mesh.userData.builtRelief = window.GeoIDViewer?.getEffectiveRelief?.();
  };
  mesh.userData.builtRelief = builtAt;
  registerDrape(mesh);
  return mesh;
}

/**
 * Every drape on the globe, re-laid when the relief the globe is drawn with
 * changes enough to see. Polled rather than hooked, because the taper is
 * driven by altitude inside the viewer's render loop and there is no event to
 * listen for; the threshold is the viewer's own (0.0004), so this runs when
 * the terrain itself is re-synced and not otherwise.
 */
const drapes = new Set();

/**
 * How far the ground may move under a drape before it is re-laid, in METRES.
 *
 * The threshold used to be 0.0004 in raw relief units, borrowed from the
 * viewer's own terrain re-sync — and nobody had converted it: relief scales a
 * normalised elevation, so 0.0004 is 0.0004/3.2 x 6371 km = **796 METRES** of
 * ground movement at a peak. A drape was therefore allowed to drift most of a
 * kilometre from the terrain it paints before anything corrected it, and it
 * did: measured on four raster layers sitting still at 95 km, every one of
 * them was 142 m BELOW the surface, and forcing the rebuild snapped all four
 * back to their intended heights to the metre. That is the whole of "the
 * rasters do not overlay closely".
 *
 * Ten metres is under a pixel at any altitude from which a drape is legible,
 * and the cost is bounded: the check is a subtraction per mesh, and only the
 * meshes that are actually stale are re-laid.
 */
const REBUILD_METRES = 10;
const RELIEF_PER_METRE = 3.2 / 6371000;

function registerDrape(mesh) {
  drapes.add(mesh);
  if (drapes.size === 1 && typeof window !== "undefined") {
    // `.unref()` exists on a Node timer and not on a browser one, so this is a
    // no-op on the page and the whole point off it: a poll that redraws drapes
    // must never be the reason a process cannot exit. Without it any headless
    // run that builds a single raster layer hangs forever, having done all its
    // work — which is exactly how the tool suite presented before this line.
    const watcher = setInterval(() => {
      const relief = window.GeoIDViewer?.getEffectiveRelief?.();
      if (typeof relief !== "number") return;
      const tolerance = REBUILD_METRES * RELIEF_PER_METRE;
      drapes.forEach((m) => {
        if (!m.parent) { drapes.delete(m); return; }   // removed layers stop costing
        // PER MESH, against the relief that mesh was built at. A single shared
        // `lastRelief` meant a drape created between two rebuilds was measured
        // against a number that was never its own, and a drape built while the
        // global sat inside its threshold was never corrected at all.
        const built = m.userData.builtRelief;
        if (typeof built === "number" && Math.abs(relief - built) <= tolerance) return;
        try { m.userData.rebuildDrape?.(); } catch { /* one bad patch is not all of them */ }
      });
    }, 250);
    watcher?.unref?.();
  }
}

/** Flat local tile used when the globe is not on screen (Model mode). */
function buildFlatTile(grid, gridWidth, gridHeight, texture, range, isDem, noData) {
  const aspect = gridWidth / gridHeight;
  const geometry = new THREE.PlaneGeometry(6 * aspect, 6, gridWidth - 1, gridHeight - 1);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  if (isDem) {
    for (let i = 0; i < position.count; i += 1) {
      const value = grid[i];
      if (!Number.isFinite(value) || (noData !== null && value === noData)) {
        continue;
      }
      const t = (value - range.min) / (range.max - range.min);
      position.setY(i, Math.min(1, Math.max(0, t)) * 1.6);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }));
}

/**
 * Bilinear sampler over the raster's first band, mirroring how the built-in
 * DEM is sampled in earth-viewer.js so imported rasters can be queried by the
 * same analysis code. Returns null outside the raster or on no-data.
 */
function createRasterSampler(band, width, height, bounds, noData) {
  return function sample(lat, lon) {
    if (!bounds) {
      return null;
    }
    // Longitudes arrive in either -180..180 or 0..360 form depending on caller.
    let x = lon;
    if (x > 180 && bounds.maxX <= 180) {
      x -= 360;
    } else if (x < 0 && bounds.minX >= 0) {
      x += 360;
    }
    if (x < bounds.minX || x > bounds.maxX || lat < bounds.minY || lat > bounds.maxY) {
      return null;
    }
    const u = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * (width - 1);
    const v = ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * (height - 1);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = u - x0;
    const fy = v - y0;
    const at = (px, py) => {
      const value = band[py * width + px];
      return Number.isFinite(value) && (noData === null || value !== noData) ? value : null;
    };
    const v00 = at(x0, y0);
    const v10 = at(x1, y0);
    const v01 = at(x0, y1);
    const v11 = at(x1, y1);
    if (v00 === null || v10 === null || v01 === null || v11 === null) {
      // Near no-data edges, fall back to nearest valid rather than smearing.
      return v00 ?? v10 ?? v01 ?? v11;
    }
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  };
}

/**
 * Shared raster-layer builder. Any raster source (GeoTIFF, ASCII grid, or a
 * layer derived by the raster toolbox) becomes a layer through this, so
 * rendering, sampling and styling stay identical across them.
 */
export function buildRasterLayer(bands, width, height, bounds, {
  name = "raster", noData = null, isDem = null,
} = {}) {
  // Not the band count: what the values actually are (see above). The same
  // scan answers both questions — is this a height field, and if not, which
  // classes does it hold — so it runs once.
  const classes = bands.length < 3 ? distinctValues(bands[0], noData) : null;
  const demLike = isDem === null ? bands.length < 3 && classes === null : isDem;
  // A raster the caller declared a DEM keeps the elevation ramp even if it
  // happens to hold few values; a classified one never borrows it.
  const classList = demLike ? null : classes;
  const gridWidth = Math.max(2, Math.min(MAX_GRID, width));
  const gridHeight = Math.max(2, Math.min(MAX_GRID, height));
  const range = computeRange(bands[0], noData);
  const texture = buildTexture(bands, width, height, range, noData, classList);
  const grid = resample(bands[0], width, height, gridWidth, gridHeight);
  const georeferenced = looksLikeGeographic(bounds);

  const object3D = georeferenced
    ? buildDrapedPatch(grid, gridWidth, gridHeight, bounds, texture, range, demLike, noData)
    : buildFlatTile(grid, gridWidth, gridHeight, texture, range, demLike, noData);
  object3D.name = name;
  if (!georeferenced) {
    object3D.userData.localModel = true;
    object3D.userData.baseScale = 1;
  }

  /**
   * Repaint with a different symbology, in place.
   *
   * The mesh, its geometry and its position on the globe are unchanged — only
   * the texture is redrawn — so re-classifying a layer costs one canvas rather
   * than a re-import, and the layer keeps its place in the stack, its opacity
   * and its visibility. Rebuilding it as a new layer instead would put a fresh
   * copy on top of the old one every time a slider moved.
   */
  const repaint = (colourOf) => {
    const next = buildTexture(bands, width, height, range, noData, classList, colourOf);
    let applied = false;
    object3D.traverse?.((node) => {
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!material || !("map" in material)) return;
      material.map?.dispose?.();
      material.map = next;
      material.needsUpdate = true;
      applied = true;
    });
    return applied;
  };

  return {
    object3D,
    repaint,
    georeferenced,
    /**
     * What the map is drawn in, so the key can be read against it.
     *
     * The legend showed one white swatch for a five-class susceptibility map,
     * because it fell back to the layer's material colour and the material is
     * textured. A classified raster now hands over its actual classes and
     * their colours; a continuous one hands over its ramp and its ends.
     */
    legendInfo: classList
      ? {
        // A ramp from the lowest class to the highest, not a row of chips: a
        // swatch labelled "Class 4" says there are five of something without
        // saying what five means. The bar carries the direction and the ends
        // carry the numbers, which is the smallest honest key for a ranked
        // surface. Sampled finely so the bar reads as a gradient rather than
        // as five blocks of colour.
        palette: Array.from({ length: 24 }, (_, i) =>
          hex(classColour((i / 23) * (classList.length - 1), classList.length))),
        // The ends are the real lowest and highest cell values, because that
        // is what the reader is matching against the map. "5 classes" said how
        // many buckets there were, which answers a question nobody asked while
        // standing in front of a susceptibility surface.
        min: classList[0],
        max: classList[classList.length - 1],
        label: "",
      }
      : {
        palette: [0, 0.25, 0.45, 0.65, 0.82, 1].map((t) => hex(elevationColor(t))),
        // Measured from the band itself, not from the class table: for a DEM
        // these are metres of real elevation.
        min: Math.round(range.min),
        max: Math.round(range.max),
        label: "",
      },
    bounds: georeferenced ? bounds : null,
    sampler: georeferenced ? createRasterSampler(bands[0], width, height, bounds, noData) : null,
    // Band 1 is what the sampler reads and what the drape colours from; the
    // rest are kept so an export can write back what was imported. Before this
    // an RGB GeoTIFF came in with three bands and could only leave with one.
    raster: { band: bands[0], bands, width, height, bounds, noData },
    info: {
      width,
      height,
      bandCount: bands.length,
      min: range.min,
      max: range.max,
      projected: Boolean(bounds) && !georeferenced,
      sampleable: georeferenced,
      valueKind: demLike ? "elevation" : "band1",
    },
  };
}

export async function loadGeoTiffFromArrayBuffer(arrayBuffer, { name = "GeoTIFF" } = {}) {
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const gridWidth = Math.max(2, Math.min(MAX_GRID, width));
  const gridHeight = Math.max(2, Math.min(MAX_GRID, height));

  const rasters = await image.readRasters();
  const bands = [];
  for (let i = 0; i < rasters.length; i += 1) {
    bands.push(rasters[i]);
  }
  if (!bands.length) {
    throw new Error("GeoTIFF contained no raster bands.");
  }

  const noDataRaw = image.getGDALNoData?.();
  const noData = Number.isFinite(noDataRaw) ? noDataRaw : null;

  let bbox = null;
  try {
    bbox = image.getBoundingBox();
  } catch (error) {
    bbox = null;
  }
  const bounds = Array.isArray(bbox) && bbox.length === 4
    ? { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3] }
    : null;

  return buildRasterLayer(bands, width, height, bounds, { name, noData });
}
