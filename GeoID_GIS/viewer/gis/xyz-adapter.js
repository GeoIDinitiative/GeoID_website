import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic, computeBounds2D } from "./geo-utils.js?v=20260816-8d6c798";

const MAX_POINTS = 2000000;

// Header names used by the common exporters, so a CSV with labelled columns is
// mapped correctly instead of relying on column order.
const LON_KEYS = ["lon", "long", "longitude", "x", "easting"];
const LAT_KEYS = ["lat", "latitude", "y", "northing"];
const ELEV_KEYS = ["z", "elev", "elevation", "height", "alt", "altitude", "depth", "value"];

function splitFields(line) {
  return line.trim().split(/[\s,;]+/);
}

function detectHeader(line) {
  const fields = splitFields(line).map((f) => f.toLowerCase().replace(/^["']|["']$/g, ""));
  if (!fields.length || fields.every((f) => Number.isFinite(Number(f)))) {
    return null;
  }
  const lonIndex = fields.findIndex((f) => LON_KEYS.includes(f));
  const latIndex = fields.findIndex((f) => LAT_KEYS.includes(f));
  const elevIndex = fields.findIndex((f) => ELEV_KEYS.includes(f));
  if (lonIndex === -1 || latIndex === -1) {
    // Unrecognised header row; skip it and fall back to positional columns.
    return { skip: true, lonIndex: 0, latIndex: 1, elevIndex: 2 };
  }
  return { skip: true, lonIndex, latIndex, elevIndex: elevIndex === -1 ? 2 : elevIndex };
}

function colorForHeight(t) {
  const color = new THREE.Color();
  color.setHSL(0.62 - 0.62 * Math.min(1, Math.max(0, t)), 0.75, 0.55);
  return color;
}

export async function loadXyzPoints(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/);

  let layout = { skip: false, lonIndex: 0, latIndex: 1, elevIndex: 2 };
  let startLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }
    const detected = detectHeader(line);
    if (detected) {
      layout = detected;
      startLine = i + 1;
    } else {
      startLine = i;
    }
    break;
  }

  const rawX = [];
  const rawY = [];
  const rawZ = [];
  let skipped = 0;

  for (let i = startLine; i < lines.length && rawX.length < MAX_POINTS; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const fields = splitFields(trimmed);
    const x = Number(fields[layout.lonIndex]);
    const y = Number(fields[layout.latIndex]);
    const z = layout.elevIndex < fields.length ? Number(fields[layout.elevIndex]) : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      skipped += 1;
      continue;
    }
    rawX.push(x);
    rawY.push(y);
    rawZ.push(Number.isFinite(z) ? z : 0);
  }

  if (!rawX.length) {
    throw new Error("No numeric coordinate rows were found.");
  }

  const flat = new Float64Array(rawX.length * 2);
  for (let i = 0; i < rawX.length; i += 1) {
    flat[i * 2] = rawX[i];
    flat[i * 2 + 1] = rawY[i];
  }
  const bounds = computeBounds2D(flat);
  const georeferenced = looksLikeGeographic(bounds);

  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < rawZ.length; i += 1) {
    if (rawZ[i] < zMin) zMin = rawZ[i];
    if (rawZ[i] > zMax) zMax = rawZ[i];
  }
  const zRange = zMax - zMin || 1;

  const positions = new Float32Array(rawX.length * 3);
  const colors = new Float32Array(rawX.length * 3);
  const baseRadius = drapedRadius(0.005);
  const vertex = new THREE.Vector3();

  // Projected data keeps its own units, recentred and normalised so it is
  // visible at the scene's scale instead of being kilometres off-screen.
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const localScale = 6 / Math.max(spanX, spanY);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;

  for (let i = 0; i < rawX.length; i += 1) {
    const t = (rawZ[i] - zMin) / zRange;
    if (georeferenced) {
      // Elevation is exaggerated the same way as raster DEMs so point clouds
      // and GeoTIFF terrain read consistently against the globe.
      vertex.copy(latLonToVector3(rawY[i], rawX[i], baseRadius + t * 0.12));
    } else {
      vertex.set((rawX[i] - midX) * localScale, t * 1.6, -(rawY[i] - midY) * localScale);
    }
    positions[i * 3] = vertex.x;
    positions[i * 3 + 1] = vertex.y;
    positions[i * 3 + 2] = vertex.z;
    const color = colorForHeight(t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: georeferenced ? 0.012 : 0.05,
    sizeAttenuation: true,
    vertexColors: true,
  }));
  points.name = file.name;
  if (!georeferenced) {
    // Projected clouds are built in local scene units, so they need the same
    // mode-aware placement as imported meshes.
    points.userData.localModel = true;
    points.userData.baseScale = 1;
  }

  return {
    object3D: points,
    georeferenced,
    bounds: georeferenced ? bounds : null,
    boundingSphere: geometry.boundingSphere?.clone() || null,
    info: {
      pointCount: rawX.length,
      min: zMin,
      max: zMax,
      projected: !georeferenced,
      skippedRows: skipped,
      truncated: rawX.length >= MAX_POINTS,
    },
  };
}
