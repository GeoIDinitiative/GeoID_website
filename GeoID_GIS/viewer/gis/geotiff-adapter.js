import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic } from "./geo-utils.js?v=20260808-4df5909";

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

function buildTexture(bands, width, height, range, noData) {
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
        const t = (v - range.min) / (range.max - range.min);
        const [r, g, b] = elevationColor(Math.min(1, Math.max(0, t)));
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
function buildDrapedPatch(grid, gridWidth, gridHeight, bounds, texture, range, isDem, noData) {
  const geometry = new THREE.PlaneGeometry(1, 1, gridWidth - 1, gridHeight - 1);
  const position = geometry.attributes.position;
  const baseRadius = drapedRadius(0.002);
  // Exaggerated so continental-scale relief stays legible at globe radius 3.2.
  const reliefScale = isDem ? 0.12 : 0;
  const vertex = new THREE.Vector3();

  for (let y = 0; y < gridHeight; y += 1) {
    const latT = y / (gridHeight - 1 || 1);
    const lat = bounds.maxY - (bounds.maxY - bounds.minY) * latT;
    for (let x = 0; x < gridWidth; x += 1) {
      const lonT = x / (gridWidth - 1 || 1);
      const lon = bounds.minX + (bounds.maxX - bounds.minX) * lonT;
      const index = y * gridWidth + x;
      const value = grid[index];
      let radius = baseRadius;
      if (isDem && Number.isFinite(value) && (noData === null || value !== noData)) {
        const t = (value - range.min) / (range.max - range.min);
        radius += reliefScale * Math.min(1, Math.max(0, t));
      }
      vertex.copy(latLonToVector3(lat, lon, radius));
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }));
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
  const demLike = isDem === null ? bands.length < 3 : isDem;
  const gridWidth = Math.max(2, Math.min(MAX_GRID, width));
  const gridHeight = Math.max(2, Math.min(MAX_GRID, height));
  const range = computeRange(bands[0], noData);
  const texture = buildTexture(bands, width, height, range, noData);
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

  return {
    object3D,
    georeferenced,
    bounds: georeferenced ? bounds : null,
    sampler: georeferenced ? createRasterSampler(bands[0], width, height, bounds, noData) : null,
    raster: { band: bands[0], width, height, bounds, noData },
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
