import * as G from "./geometry.js?v=20260810-f2e4741";
import { transform } from "./projection.js?v=20260810-f2e4741";

// Vector geoprocessing on GeoJSON FeatureCollections.
//
// GeoJSON is used as the internal model so that every parser, every tool and
// every export speaks the same structure — the same reason QGIS and ArcGIS
// normalise to a single feature model internally.

export function featureCollection(features = []) {
  return { type: "FeatureCollection", features };
}

export function feature(geometry, properties = {}) {
  return { type: "Feature", geometry, properties: { ...properties } };
}

/** All positions in a geometry, flattened — for bounds and hulls. */
export function geometryCoords(geometry) {
  if (!geometry) {
    return [];
  }
  const { type, coordinates } = geometry;
  switch (type) {
    case "Point": return [coordinates];
    case "MultiPoint":
    case "LineString": return coordinates;
    case "MultiLineString":
    case "Polygon": return coordinates.flat();
    case "MultiPolygon": return coordinates.flat(2);
    case "GeometryCollection": return (geometry.geometries || []).flatMap(geometryCoords);
    default: return [];
  }
}

/** Every polygon ([outer, ...holes]) in a geometry. */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

export function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

export function collectionBounds(fc) {
  const coords = fc.features.flatMap((f) => geometryCoords(f.geometry));
  return coords.length ? G.boundsOf(coords) : null;
}

function featureBounds(f) {
  const coords = geometryCoords(f.geometry);
  return coords.length ? G.boundsOf(coords) : null;
}

// ── Measurement ─────────────────────────────────────────────────────────────

export function featureAreaM2(f) {
  return polygonsOf(f.geometry).reduce((total, polygon) => {
    const outer = Math.abs(G.ringAreaM2(polygon[0]));
    const holes = polygon.slice(1).reduce((h, ring) => h + Math.abs(G.ringAreaM2(ring)), 0);
    return total + outer - holes;
  }, 0);
}

export function featureLengthM(f) {
  const lines = linesOf(f.geometry).reduce((t, line) => t + G.lineLengthMetres(line), 0);
  const rings = polygonsOf(f.geometry)
    .flat()
    .reduce((t, ring) => t + G.lineLengthMetres(ring), 0);
  return lines + rings;
}

// ── Tools ───────────────────────────────────────────────────────────────────

/** Buffer: points become circles, lines become corridors, polygons dilate. */
export function buffer(fc, distanceM, { segments = 32 } = {}) {
  const out = [];
  fc.features.forEach((f) => {
    const props = { ...f.properties, buffer_m: distanceM };
    const geometry = f.geometry;
    if (!geometry) return;
    if (geometry.type === "Point") {
      out.push(feature({ type: "Polygon", coordinates: [G.circleAround(geometry.coordinates, distanceM, segments)] }, props));
    } else if (geometry.type === "MultiPoint") {
      geometry.coordinates.forEach((c) => {
        out.push(feature({ type: "Polygon", coordinates: [G.circleAround(c, distanceM, segments)] }, props));
      });
    } else if (linesOf(geometry).length) {
      linesOf(geometry).forEach((line) => {
        out.push(feature({ type: "Polygon", coordinates: [G.bufferLine(line, distanceM)] }, props));
      });
    } else {
      polygonsOf(geometry).forEach((polygon) => {
        out.push(feature({ type: "Polygon", coordinates: [G.offsetRing(polygon[0], distanceM)] }, props));
      });
    }
  });
  return featureCollection(out);
}

function ringsFromMask(maskFc) {
  return maskFc.features.flatMap((f) => polygonsOf(f.geometry).map((p) => p[0]));
}

/** Applies a boolean op between every feature and every mask ring. */
function overlay(fc, maskFc, mode, propsFrom) {
  const masks = ringsFromMask(maskFc).map((ring) => ({ ring, bounds: G.boundsOf(ring) }));
  const out = [];
  fc.features.forEach((f) => {
    const fb = featureBounds(f);
    polygonsOf(f.geometry).forEach((polygon) => {
      let pieces = [polygon[0]];
      masks.forEach((mask) => {
        if (!pieces.length) return;
        if (mode !== "union" && fb && !G.boundsIntersect(fb, mask.bounds)) {
          if (mode === "intersection") pieces = [];
          return;
        }
        pieces = pieces.flatMap((ring) => G.booleanOp(ring, mask.ring, mode));
      });
      pieces.forEach((ring) => {
        if (ring.length >= 4) {
          out.push(feature({ type: "Polygon", coordinates: [ring] }, propsFrom(f)));
        }
      });
    });
    // Points and lines are kept or dropped by containment rather than clipped.
    if (!polygonsOf(f.geometry).length && mode === "intersection") {
      const coords = geometryCoords(f.geometry);
      const inside = coords.some((c) => masks.some((m) => G.pointInRing(c, m.ring)));
      if (inside) {
        out.push(feature(f.geometry, propsFrom(f)));
      }
    }
  });
  return featureCollection(out);
}

export function clip(fc, maskFc) {
  return overlay(fc, maskFc, "intersection", (f) => ({ ...f.properties }));
}

export function difference(fc, maskFc) {
  return overlay(fc, maskFc, "difference", (f) => ({ ...f.properties }));
}

export function intersect(fcA, fcB) {
  return overlay(fcA, fcB, "intersection", (f) => ({ ...f.properties }));
}

/** Dissolve: merges features sharing a field value into one multipolygon. */
export function dissolve(fc, field) {
  const groups = new Map();
  fc.features.forEach((f) => {
    const key = field ? String(f.properties?.[field] ?? "") : "__all__";
    if (!groups.has(key)) {
      groups.set(key, { polygons: [], properties: { ...f.properties }, count: 0 });
    }
    const group = groups.get(key);
    polygonsOf(f.geometry).forEach((polygon) => group.polygons.push(polygon));
    group.count += 1;
  });
  const out = [];
  groups.forEach((group, key) => {
    if (!group.polygons.length) return;
    const properties = field
      ? { [field]: key, dissolved_count: group.count }
      : { dissolved_count: group.count };
    out.push(feature({ type: "MultiPolygon", coordinates: group.polygons }, properties));
  });
  return featureCollection(out);
}

export function convexHull(fc, { byFeature = false } = {}) {
  if (byFeature) {
    return featureCollection(fc.features.map((f) => feature(
      { type: "Polygon", coordinates: [G.convexHull(geometryCoords(f.geometry))] },
      { ...f.properties },
    )));
  }
  const all = fc.features.flatMap((f) => geometryCoords(f.geometry));
  return featureCollection([feature(
    { type: "Polygon", coordinates: [G.convexHull(all)] },
    { source_features: fc.features.length },
  )]);
}

export function centroids(fc) {
  return featureCollection(fc.features.map((f) => {
    const polygons = polygonsOf(f.geometry);
    const point = polygons.length
      ? G.ringCentroid(polygons[0][0])
      : (() => {
        const coords = geometryCoords(f.geometry);
        const sum = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
        return [sum[0] / coords.length, sum[1] / coords.length];
      })();
    return feature({ type: "Point", coordinates: point }, { ...f.properties });
  }));
}

export function simplifyCollection(fc, toleranceDeg) {
  return featureCollection(fc.features.map((f) => {
    const geometry = f.geometry;
    if (!geometry) return f;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      const mapPolygon = (polygon) => polygon
        .map((ring) => {
          const simplified = G.simplify(ring, toleranceDeg);
          return simplified.length >= 4 ? simplified : ring;
        });
      const coordinates = geometry.type === "Polygon"
        ? mapPolygon(geometry.coordinates)
        : geometry.coordinates.map(mapPolygon);
      return feature({ type: geometry.type, coordinates }, f.properties);
    }
    if (geometry.type === "LineString") {
      return feature({ type: "LineString", coordinates: G.simplify(geometry.coordinates, toleranceDeg) }, f.properties);
    }
    return f;
  }));
}

/**
 * Spatial join: copies attributes from the first joining polygon that contains
 * each target feature's representative point.
 */
export function spatialJoin(targetFc, joinFc, { prefix = "join_" } = {}) {
  const joins = joinFc.features.flatMap((jf) => polygonsOf(jf.geometry)
    .map((polygon) => ({ polygon, bounds: G.boundsOf(polygon[0]), properties: jf.properties })));
  let matched = 0;
  const features = targetFc.features.map((f) => {
    const coords = geometryCoords(f.geometry);
    if (!coords.length) return f;
    const polygons = polygonsOf(f.geometry);
    const point = polygons.length ? G.ringCentroid(polygons[0][0]) : coords[0];
    const hit = joins.find((j) => point[0] >= j.bounds.minX && point[0] <= j.bounds.maxX
      && point[1] >= j.bounds.minY && point[1] <= j.bounds.maxY
      && G.pointInPolygon(point, j.polygon));
    if (!hit) {
      return f;
    }
    matched += 1;
    const merged = { ...f.properties };
    Object.entries(hit.properties || {}).forEach(([k, v]) => { merged[`${prefix}${k}`] = v; });
    return feature(f.geometry, merged);
  });
  const result = featureCollection(features);
  result.matched = matched;
  return result;
}

/** Reprojects every coordinate between two CRSs. */
export function reproject(fc, fromCrs, toCrs) {
  const convert = ([x, y]) => {
    const out = transform(x, y, fromCrs, toCrs);
    return out ? [out.x, out.y] : [x, y];
  };
  const mapGeometry = (geometry) => {
    if (!geometry) return geometry;
    const { type, coordinates } = geometry;
    switch (type) {
      case "Point": return { type, coordinates: convert(coordinates) };
      case "MultiPoint":
      case "LineString": return { type, coordinates: coordinates.map(convert) };
      case "MultiLineString":
      case "Polygon": return { type, coordinates: coordinates.map((r) => r.map(convert)) };
      case "MultiPolygon": return { type, coordinates: coordinates.map((p) => p.map((r) => r.map(convert))) };
      default: return geometry;
    }
  };
  return featureCollection(fc.features.map((f) => feature(mapGeometry(f.geometry), f.properties)));
}

// ── Attribute statistics ────────────────────────────────────────────────────

export function fieldStatistics(fc, field) {
  const values = fc.features
    .map((f) => f.properties?.[field])
    .filter((v) => v !== null && v !== undefined && v !== "");
  const numeric = values.map(Number).filter((v) => Number.isFinite(v));
  const stats = { count: values.length, numericCount: numeric.length, unique: new Set(values.map(String)).size };
  if (numeric.length) {
    const sorted = [...numeric].sort((a, b) => a - b);
    const sum = numeric.reduce((a, b) => a + b, 0);
    const mean = sum / numeric.length;
    stats.min = sorted[0];
    stats.max = sorted[sorted.length - 1];
    stats.sum = sum;
    stats.mean = mean;
    stats.median = sorted[Math.floor(sorted.length / 2)];
    stats.stdDev = Math.sqrt(numeric.reduce((a, v) => a + (v - mean) ** 2, 0) / numeric.length);
  }
  return stats;
}

/** Adds a derived field. `expr` is evaluated per feature with its properties. */
export function fieldCalculator(fc, fieldName, expr) {
  // Field names are bound as explicit parameters rather than using `with`
  // (illegal in strict mode) or eval, so the expression can only reach the
  // attributes and Math — never the surrounding scope.
  const fieldNames = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))]
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
  let fn;
  try {
    fn = new Function(...fieldNames, "Math", `"use strict"; return (${expr});`);
  } catch (error) {
    return { ok: false, message: `Invalid expression: ${error.message}` };
  }
  let failures = 0;
  const features = fc.features.map((f) => {
    let value = null;
    try {
      const props = f.properties || {};
      value = fn(...fieldNames.map((name) => props[name]), Math);
    } catch (error) {
      failures += 1;
    }
    return feature(f.geometry, { ...f.properties, [fieldName]: value });
  });
  return { ok: true, collection: featureCollection(features), failures };
}
