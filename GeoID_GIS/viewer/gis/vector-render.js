import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic } from "./geo-utils.js?v=20260808-6f3e709";
import { collectionBounds, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260808-6f3e709";

// Single renderer for every vector source. Each parser produces a GeoJSON
// FeatureCollection and this turns it into draped globe geometry, so shapefile,
// GeoJSON, KML, GPX, WKT and any derived analysis layer look and behave alike.

const MAX_LINE_VERTICES = 6000000;

/**
 * A point on the globe's own displaced surface, plus clearance.
 *
 * Not radius + offset: the basemap is displaced by the relief, and at the
 * default setting its surface spans 3.2095 to 3.2989 while a flat 3.2 + 0.006
 * sits at 3.206 -- under the terrain everywhere, ocean included. Draped that
 * way a coastline was in the scene, visible, correctly georeferenced, and
 * drawing exactly nothing, because the planet was in front of it.
 */
function surfaceAt(lat, lon, drape) {
  const surfacePoint = window.GeoIDViewer?.surfacePoint;
  return surfacePoint
    ? surfacePoint(lat, lon, drape)
    : latLonToVector3(lat, lon, drapedRadius(drape));
}

// A straight line between two points on a sphere is a chord, and a chord sags
// below the surface. Across 12 degrees of arc -- ordinary for a coarse boundary
// polygon -- it sags 0.0175, nearly three times the clearance the geometry is
// lifted by, so the segment dives through the planet and is hidden for most of
// its length. Splitting long spans keeps the sag far under the clearance: at
// one degree it is 0.0001 against 0.006.
//
// The split is linear in longitude and latitude, which is also what a shapefile
// edge means -- straight in the coordinate space it was authored in, not a
// great circle -- so densifying draws the geometry more correctly, not less.
const MAX_SEGMENT_DEG = 1;
const MAX_SEGMENT_SPLITS = 512;

function pushSegment(target, a, b, drape) {
  const steps = Math.min(
    MAX_SEGMENT_SPLITS,
    Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / MAX_SEGMENT_DEG)),
  );
  let previous = surfaceAt(a[1], a[0], drape);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const next = surfaceAt(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t, drape);
    target.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
    previous = next;
  }
}

export function renderFeatureCollection(fc, {
  name = "vector",
  lineColor = 0x8ef6c4,
  pointColor = 0xffd166,
  drape = 0.006,
  pointSize = 0.018,
} = {}) {
  const linePositions = [];
  const pointPositions = [];
  let truncated = false;

  fc.features.forEach((feature) => {
    if (linePositions.length >= MAX_LINE_VERTICES) {
      truncated = true;
      return;
    }
    const geometry = feature.geometry;
    if (!geometry) {
      return;
    }
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      geometryCoords(geometry).forEach((c) => {
        const v = surfaceAt(c[1], c[0], drape);
        pointPositions.push(v.x, v.y, v.z);
      });
      return;
    }
    // Polygon rings are drawn as closed boundaries; lines as-is.
    const rings = polygonsOf(geometry).flat();
    const lines = linesOf(geometry);
    [...rings, ...lines].forEach((coords) => {
      for (let i = 0; i + 1 < coords.length; i += 1) {
        pushSegment(linePositions, coords[i], coords[i + 1], drape);
      }
    });
  });

  const group = new THREE.Group();
  group.name = name;

  if (linePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: lineColor, transparent: true, opacity: 0.9, depthWrite: false,
    })));
  }
  if (pointPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
    group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      color: pointColor, size: pointSize, sizeAttenuation: true, depthWrite: false,
    })));
  }

  return { object3D: group, truncated };
}

/** Counts geometry kinds, for the layer list summary. */
export function describeCollection(fc) {
  const counts = { point: 0, line: 0, polygon: 0 };
  fc.features.forEach((f) => {
    const type = f.geometry?.type || "";
    if (type.includes("Point")) counts.point += 1;
    else if (type.includes("LineString")) counts.line += 1;
    else if (type.includes("Polygon")) counts.polygon += 1;
  });
  return counts;
}

/**
 * Wraps a FeatureCollection into the shape the import manager expects,
 * including an attribute sampler so it can take part in extraction.
 */
export function buildVectorLayerResult(fc, { name, fields = [], drape = 0.006 } = {}) {
  const bounds = collectionBounds(fc);
  const georeferenced = looksLikeGeographic(bounds);
  const { object3D, truncated } = renderFeatureCollection(fc, { name, drape });
  const counts = describeCollection(fc);

  const polygonIndex = fc.features
    .map((f) => ({ polygons: polygonsOf(f.geometry), properties: f.properties }))
    .filter((entry) => entry.polygons.length)
    .map((entry) => {
      const coords = entry.polygons.flat().flat();
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      coords.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      return { ...entry, bbox: { minX, minY, maxX, maxY } };
    });

  return {
    object3D,
    georeferenced,
    bounds: georeferenced ? bounds : null,
    collection: fc,
    features: fc.features,
    sampler: polygonIndex.length
      ? (lat, lon) => {
        const x = lon > 180 ? lon - 360 : lon;
        for (let i = 0; i < polygonIndex.length; i += 1) {
          const entry = polygonIndex[i];
          const b = entry.bbox;
          if (x < b.minX || x > b.maxX || lat < b.minY || lat > b.maxY) continue;
          const inside = entry.polygons.some((polygon) => {
            const ring = polygon[0];
            let hit = false;
            for (let a = 0, c = ring.length - 1; a < ring.length; c = a, a += 1) {
              const [xi, yi] = ring[a];
              const [xj, yj] = ring[c];
              if (((yi > lat) !== (yj > lat))
                && (x < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-15) + xi)) {
                hit = !hit;
              }
            }
            return hit;
          });
          if (inside) return entry.properties;
        }
        return null;
      }
      : null,
    info: {
      featureCount: fc.features.length,
      points: counts.point,
      lines: counts.line,
      polygons: counts.polygon,
      fields: fields.length
        ? fields
        : [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))],
      sampleable: polygonIndex.length > 0,
      valueKind: "attributes",
      truncated,
    },
  };
}
