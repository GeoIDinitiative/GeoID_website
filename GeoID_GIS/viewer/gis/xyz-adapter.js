import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic, computeBounds2D } from "./geo-utils.js?v=20260818-58fd334";
import { readHead, parseRows, validateMapping } from "./delimited.js?v=20260818-58fd334";
import { rampColour } from "./symbology.js?v=20260818-58fd334";

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

/**
 * A point's colour.
 *
 * Points are coloured HERE rather than by `applyImportSymbology`, and that is not
 * a duplicate path: that helper works through `layer.repaint`, which needs either
 * a raster band or per-feature attributes, and a point cloud has neither. So a
 * ramp chosen in the Add-data dialog has to be honoured at build time or it
 * silently does nothing -- which is exactly what it did until this.
 *
 * The old built-in was a hard-coded HSL sweep unrelated to any ramp the
 * symbology panel offers; going through `rampColour` means "Magma" here and
 * "Magma" there are the same seven stops.
 */
function colorForHeight(t, ramp) {
  const color = new THREE.Color();
  if (ramp) {
    const [r, g, b] = rampColour(ramp, t);
    color.setRGB(r / 255, g / 255, b / 255);
    return color;
  }
  color.setHSL(0.62 - 0.62 * Math.min(1, Math.max(0, t)), 0.75, 0.55);
  return color;
}

/** Does this mapping give the points a value worth grading? */
function isGradedMapping(mapping) {
  return Boolean(mapping) && (mapping.elev >= 0 || mapping.magnitude >= 0);
}

/**
 * A point cloud or a CSV of readings.
 *
 * `options.columns` is the mapping the Add-data dialog collected — which column
 * is X, which is Y, which is Z, which is magnitude. Without it the file is read
 * exactly as before, by `readHead`'s proposal: names first, position as a last
 * resort. The difference is that the guess is now visible before the import
 * rather than discovered afterwards from a layer in the wrong ocean.
 */
export async function loadXyzPoints(file, options = {}) {
  const text = await file.text();
  const head = readHead(text);
  if (!head.mapping) throw new Error("No readable rows were found in this file.");

  const mapping = options.columns || head.mapping;
  const symbology = options.symbology || {};
  // A flat colour only means something when there is nothing to grade; with a Z
  // or a magnitude the ramp wins, which is what the dialog says it will do.
  const graded = isGradedMapping(mapping);
  const ramp = graded ? (symbology.ramp || null) : null;
  const flatColour = !graded && symbology.colour ? new THREE.Color(symbology.colour) : null;
  const valid = validateMapping(mapping, head.columns.length);
  if (!valid.ok) throw new Error(valid.problems.join(" "));

  const { points: parsed, skipped } = parseRows(text, mapping, {
    delimiter: head.delimiter, hasHeader: head.hasHeader, limit: MAX_POINTS,
  });

  const rawX = [];
  const rawY = [];
  const rawZ = [];
  // Magnitude is kept alongside Z rather than replacing it: a survey point has
  // an elevation AND a reading, and colouring by one must not lose the other.
  const rawMag = [];
  let hasMagnitude = false;
  parsed.forEach((point) => {
    rawX.push(point.x);
    rawY.push(point.y);
    rawZ.push(point.z);
    if (point.magnitude !== undefined) {
      rawMag.push(point.magnitude);
      if (point.magnitude !== null) hasMagnitude = true;
    }
  });

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

  // What the ramp is drawn through. Magnitude is the reason someone chose a
  // magnitude column, so it wins the colour when it is present.
  let mMin = Infinity;
  let mMax = -Infinity;
  if (hasMagnitude) {
    rawMag.forEach((m) => {
      if (m === null) return;
      if (m < mMin) mMin = m;
      if (m > mMax) mMax = m;
    });
  }
  const mRange = (mMax - mMin) || 1;

  for (let i = 0; i < rawX.length; i += 1) {
    const height = (rawZ[i] - zMin) / zRange;
    const t = hasMagnitude && rawMag[i] !== null ? (rawMag[i] - mMin) / mRange : height;
    if (georeferenced) {
      // Elevation is exaggerated the same way as raster DEMs so point clouds
      // and GeoTIFF terrain read consistently against the globe.
      vertex.copy(latLonToVector3(rawY[i], rawX[i], baseRadius + height * 0.12));
    } else {
      vertex.set((rawX[i] - midX) * localScale, height * 1.6, -(rawY[i] - midY) * localScale);
    }
    positions[i * 3] = vertex.x;
    positions[i * 3 + 1] = vertex.y;
    positions[i * 3 + 2] = vertex.z;
    const color = flatColour || colorForHeight(t, ramp);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const opacity = Number.isFinite(symbology.opacity) ? symbology.opacity : 1;
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: georeferenced ? 0.012 : 0.05,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
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
      colouredBy: flatColour ? "single colour" : (hasMagnitude ? "magnitude" : "elevation"),
      ramp: ramp || null,
      magnitudeRange: hasMagnitude ? { min: mMin, max: mMax } : null,
      skippedRows: skipped,
      truncated: rawX.length >= MAX_POINTS,
    },
  };
}
