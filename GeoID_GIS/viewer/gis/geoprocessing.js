import * as G from "./geometry.js?v=20260825-17061aa";
import { transform } from "./projection.js?v=20260825-17061aa";

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

/**
 * Buffer: points become circles, lines become corridors, polygons dilate.
 *
 * Overlapping buffers are merged by default, which is what a buffer is for —
 * "within 5 km of any river" is one region, and every GIS dissolves it. Left
 * un-merged the overlaps double-count on any area figure taken from the
 * result, and the seams show through as darker bands wherever two buffers
 * cross. Pass `{ dissolve: false }` to keep one buffer per input feature,
 * which is what you want when the buffer is an attribute of its feature.
 */
export function buffer(fc, distanceM, { segments = 32, dissolve: merge = true } = {}) {
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
  const result = featureCollection(out);
  return merge ? unionAll(result, { buffer_m: distanceM }) : result;
}

/**
 * Union every polygon in a collection into as few as possible.
 *
 * Pairwise against an accumulating set, which is the honest use of a
 * ring-versus-ring primitive: rings that do not touch stay separate, and each
 * merge feeds back in so a chain of overlapping buffers collapses to one.
 * Attributes cannot survive a merge — the output is one shape made of many
 * inputs — so the caller says what the result should carry.
 */
function unionAll(fc, properties = {}) {
  const rings = fc.features
    .flatMap((f) => polygonsOf(f.geometry))
    .map((polygon) => polygon[0])
    .filter(validRing);
  if (rings.length < 2) {
    return rings.length
      ? featureCollection([feature({ type: "Polygon", coordinates: [rings[0]] }, properties)])
      : featureCollection([]);
  }
  const merged = [];
  rings.forEach((ring) => {
    let current = ring;
    let touched = true;
    // Re-scan after every merge: joining A to B can bring the result into
    // contact with C, which an single pass would leave separate.
    while (touched) {
      touched = false;
      for (let i = 0; i < merged.length; i += 1) {
        if (!G.boundsIntersect(G.boundsOf(current), G.boundsOf(merged[i]))) continue;
        const joined = G.booleanOp(current, merged[i], "union").filter(validRing);
        // A union that comes back as two rings means they did not overlap
        // after all -- the primitive returns both inputs. Only a single ring
        // is a real merge.
        if (joined.length === 1) {
          current = joined[0];
          merged.splice(i, 1);
          touched = true;
          break;
        }
      }
    }
    merged.push(current);
  });
  return featureCollection(merged.map((ring) => feature(
    { type: "Polygon", coordinates: [ring] }, properties,
  )));
}

/**
 * Union of two layers: one collection of merged outer boundaries.
 *
 * This is the dissolve-style union — "these two footprints as one region" —
 * not QGIS's planar Union, which keeps every intersected piece with both
 * sides' attributes. The dissolve reading is what a buffer/clip workflow
 * reaches for, and it is what the ring primitive can do honestly.
 *
 * Honest limit, reported rather than hidden: the merge works on OUTER rings,
 * so interior rings do not survive it. The result carries `holesDropped` when
 * an input had any, and the toolbox surfaces that in the status line instead
 * of letting a donut quietly become solid.
 */
export function union(fcA, fcB) {
  const merged = featureCollection([...fcA.features, ...fcB.features]);
  const hadHoles = merged.features.some(
    (f) => polygonsOf(f.geometry).some((polygon) => polygon.length > 1),
  );
  const out = unionAll(merged, {
    union_inputs: fcA.features.length + fcB.features.length,
  });
  out.holesDropped = hadHoles;
  return out;
}

// ── Multi-ring overlay ──────────────────────────────────────────────────────
//
// The primitive (geometry.js booleanOp) is ring-versus-ring: it knows nothing
// of holes and returns bare rings. An earlier overlay fed it `polygon[0]` from
// each side, which silently dropped every interior ring — clip a donut and the
// hole filled in; clip BY a donut and the mask's hole was treated as solid.
// The result was always a single-ring Polygon, never a MultiPolygon, and no
// error anywhere: the output looked plausible and was wrong.
//
// So the composition happens here, in polygon-with-holes terms. A "polygon" in
// this section is GeoJSON's [outer, ...holes] coordinate array.

/** Do any two edges of the rings cross? O(n·m), fine at toolbox sizes. */
function ringEdgesIntersect(a, b) {
  for (let i = 0; i < a.length - 1; i += 1) {
    const [x1, y1] = a[i];
    const [x2, y2] = a[i + 1];
    for (let j = 0; j < b.length - 1; j += 1) {
      const [x3, y3] = b[j];
      const [x4, y4] = b[j + 1];
      const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
      if (Math.abs(d) < 1e-18) continue;
      const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
      const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      if (t > 1e-12 && t < 1 - 1e-12 && u > 1e-12 && u < 1 - 1e-12) return true;
    }
  }
  return false;
}

/** Is ring `inner` wholly inside ring `outer`? Assumes no edge crossings. */
function ringInRing(inner, outer) {
  return inner.length > 0 && G.pointInRing(inner[0], outer);
}

const validRing = (ring) => ring.length >= 4;

/**
 * Punch a set of hole rings out of a set of polygons.
 *
 * Three cases per (polygon, hole) pair, and each needs different machinery:
 * a hole floating wholly inside the outer attaches as an interior ring — the
 * one case the ring primitive cannot express, and the reason the old overlay
 * lost holes; a hole crossing the outer edge is a genuine difference, which
 * may fragment the polygon (each fragment keeps whichever existing holes still
 * fall inside it); a hole outside contributes nothing.
 *
 * Even-odd within reason: holes are assumed disjoint from each other, which
 * they are in valid GeoJSON. Overlapping holes in malformed input will not
 * cancel each other pairwise.
 */
function punchHoles(polygons, holes) {
  let out = polygons;
  holes.forEach((hole) => {
    if (!validRing(hole)) return;
    out = out.flatMap((polygon) => {
      const [outer, ...existing] = polygon;
      if (!ringEdgesIntersect(outer, hole)) {
        if (ringInRing(hole, outer)) {
          // Inside an existing hole already? Then it removes nothing.
          if (existing.some((h) => ringInRing(hole, h))) return [polygon];
          return [[outer, ...existing, hole]];
        }
        if (ringInRing(outer, hole)) return []; // swallowed whole
        return [polygon]; // disjoint
      }
      const fragments = G.booleanOp(outer, hole, "difference").filter(validRing);
      return fragments.map((fragment) => [
        fragment,
        ...existing.filter((h) => ringInRing(h, fragment)),
      ]);
    });
  });
  return out;
}

/** Subject polygon ∩ mask polygon → array of polygons. */
function intersectPolygons(subject, mask) {
  const outers = G.booleanOp(subject[0], mask[0], "intersection").filter(validRing);
  if (!outers.length) return [];
  // A hole in either input is a hole in the intersection.
  return punchHoles(outers.map((o) => [o]), [...subject.slice(1), ...mask.slice(1)]);
}

/**
 * Subject polygon minus mask polygon → array of polygons.
 *
 * The mask's outer is punched out of the subject — punchHoles handles both the
 * crossing case and the floating-island case, the latter being exactly where
 * the ring primitive returns the subject unchanged and loses the subtraction.
 * Then the parts of the subject inside the MASK's holes come back: a hole in
 * the mask is ground the mask does not cover. Those restored parts are
 * disjoint from the punched remainder by construction, so no union is needed.
 * The subject's own holes apply to everything at the end.
 */
function subtractPolygons(subject, mask) {
  let out = punchHoles([[subject[0]]], [mask[0]]);
  mask.slice(1).forEach((maskHole) => {
    if (!validRing(maskHole)) return;
    const restored = G.booleanOp(subject[0], maskHole, "intersection").filter(validRing);
    out = out.concat(restored.map((r) => [r]));
  });
  return punchHoles(out, subject.slice(1));
}

/** Orient for GeoJSON: outers counter-clockwise, holes clockwise. */
function orientPolygon(polygon) {
  return polygon.map((ring, index) => {
    const ccw = G.signedAreaPlanar(ring) > 0;
    const wantCcw = index === 0;
    return ccw === wantCcw ? ring : [...ring].reverse();
  });
}

/** Applies a boolean op between every feature and every mask polygon. */
function overlay(fc, maskFc, mode, propsFrom) {
  const masks = maskFc.features
    .flatMap((f) => polygonsOf(f.geometry))
    .filter((polygon) => polygon.length && validRing(polygon[0]))
    .map((polygon) => ({ polygon, bounds: G.boundsOf(polygon[0]) }));
  const out = [];
  fc.features.forEach((f) => {
    const fb = featureBounds(f);
    const resultPolygons = [];
    polygonsOf(f.geometry).forEach((polygon) => {
      if (!polygon.length || !validRing(polygon[0])) return;
      if (mode === "intersection") {
        // Clip keeps what falls in ANY mask polygon, so each mask contributes
        // its own pieces. The old sequential form computed subject ∩ A ∩ B —
        // a feature spanning two disjoint mask polygons came back empty.
        // Overlapping mask polygons will cover shared ground twice; masks are
        // usually disjoint (they tile), and double cover is the honest reading
        // of overlap without a full union pass.
        masks.forEach((mask) => {
          if (fb && !G.boundsIntersect(fb, mask.bounds)) return;
          resultPolygons.push(...intersectPolygons(polygon, mask.polygon));
        });
      } else {
        // Difference is sequential by nature: subject minus A minus B.
        let pieces = [polygon];
        masks.forEach((mask) => {
          if (!pieces.length) return;
          if (fb && !G.boundsIntersect(fb, mask.bounds)) return;
          pieces = pieces.flatMap((piece) => subtractPolygons(piece, mask.polygon));
        });
        resultPolygons.push(...pieces);
      }
    });
    if (resultPolygons.length) {
      const oriented = resultPolygons.map(orientPolygon);
      // One feature in, one feature out: fragments of the same input feature
      // stay together as a MultiPolygon rather than multiplying its attributes
      // across separate rows.
      const geometry = oriented.length === 1
        ? { type: "Polygon", coordinates: oriented[0] }
        : { type: "MultiPolygon", coordinates: oriented };
      out.push(feature(geometry, propsFrom(f)));
    }
    // Points and lines are kept or dropped by containment rather than clipped.
    // Containment now honours holes: a point inside a mask's hole is outside
    // the mask.
    if (!polygonsOf(f.geometry).length && mode === "intersection") {
      const coords = geometryCoords(f.geometry);
      const inside = coords.some((c) => masks.some((m) => G.pointInPolygon(c, m.polygon)));
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

/**
 * Douglas-Peucker simplify, tolerance in METRES.
 *
 * The underlying primitive works in degrees, which is not a distance: a degree
 * of longitude is 111 km at the equator and 20 km at 80° north, so one
 * tolerance applied to a dataset spanning latitudes simplified the north far
 * harder than the south — and nobody can say what "0.001" should be anyway.
 * The conversion is per feature at its own centroid latitude, which is the
 * same approximation the draw-a-box tool documents: exact at the centre and
 * close enough across any one feature.
 */
export function simplifyCollection(fc, toleranceM) {
  const DEG_M = 111320; // one degree of latitude, near enough anywhere
  return featureCollection(fc.features.map((f) => {
    const geometry = f.geometry;
    if (!geometry) return f;
    const coords = geometryCoords(f.geometry);
    if (!coords.length) return f;
    // Degrees of longitude shrink with latitude; a tolerance has to be a
    // circle on the ground, so take the harsher (longitude) axis at this
    // feature's latitude rather than simplifying more in x than in y.
    const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
    const metresPerDegLon = DEG_M * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
    const toleranceDeg = toleranceM / Math.max(metresPerDegLon, 1e-6);
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
