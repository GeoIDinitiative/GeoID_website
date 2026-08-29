import * as G from "./geometry.js?v=20260829-4030884";
import { transform } from "./projection.js?v=20260829-4030884";

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
/**
 * Buffer every feature by a distance, with a SHAPE the caller chooses.
 *
 * `shape` is one word doing the honest thing each geometry allows:
 *  - "round"  — circles for points; a corridor with semicircular END CAPS for
 *    lines, built by unioning end circles onto the flat corridor rather than
 *    stitching arcs into the ring by hand (seam arithmetic is what the
 *    boolean ops exist to avoid);
 *  - "square" — axis-aligned squares for points; a corridor extended one
 *    distance past each endpoint for lines (ArcGIS's SQUARE end type);
 *  - "flat"   — the corridor ends at the line's endpoints; for a point,
 *    which has no ends to cut flat, it means round.
 * Polygon outlines are offset along their own boundary whichever shape is
 * asked for — the outline is the shape, and joins are mitred by the bisector
 * offset. Said here rather than discovered: a polygon fed to "square" does
 * not become a bounding box.
 */
export function buffer(fc, distanceM, { segments = 32, dissolve: merge = true, shape = "round" } = {}) {
  const out = [];
  const pointRing = (c) => (shape === "square"
    ? G.squareAround(c, distanceM)
    : G.circleAround(c, distanceM, segments));
  fc.features.forEach((f) => {
    const props = { ...f.properties, buffer_m: distanceM };
    const geometry = f.geometry;
    if (!geometry) return;
    if (geometry.type === "Point") {
      out.push(feature({ type: "Polygon", coordinates: [pointRing(geometry.coordinates)] }, props));
    } else if (geometry.type === "MultiPoint") {
      geometry.coordinates.forEach((c) => {
        out.push(feature({ type: "Polygon", coordinates: [pointRing(c)] }, props));
      });
    } else if (linesOf(geometry).length) {
      linesOf(geometry).forEach((line) => {
        const corridor = G.bufferLine(line, distanceM, shape === "square" ? "square" : "flat");
        if (shape !== "round" || line.length < 2) {
          out.push(feature({ type: "Polygon", coordinates: [corridor] }, props));
          return;
        }
        // Round end caps: the flat corridor unioned with a circle at each
        // end, through the same checked union everything else uses.
        const capped = unionAll(featureCollection([
          feature({ type: "Polygon", coordinates: [corridor] }, {}),
          feature({ type: "Polygon", coordinates: [G.circleAround(line[0], distanceM, segments)] }, {}),
          feature({ type: "Polygon", coordinates: [G.circleAround(line[line.length - 1], distanceM, segments)] }, {}),
        ]), props);
        capped.features.forEach((piece) => out.push(feature(piece.geometry, props)));
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
 * Nested buffers in one pass: 10 km, 20 km, 30 km around the same features.
 *
 * Each band carries `buffer_m` (its outer edge) and `buffer_min_m` (its
 * inner), which is what makes the result colour-code without another step —
 * the symbology dialog grades `buffer_m` and every band takes its own class.
 *
 * `rings: true` (the default) makes the bands TRUE RINGS — each one is the
 * next disk minus the previous, so the bands tile the ground and a graded
 * fill reads correctly. Solid nested disks stack: at 30 km three translucent
 * fills lie on top of each other and the innermost zone renders as the sum
 * of three colours, which is a picture of the drawing order rather than of
 * distance. `rings: false` keeps the solid disks for whoever wants them.
 *
 * Distances are cleaned rather than trusted: sorted ascending, deduplicated,
 * non-positive entries dropped — "20, 10, 10, 0" means the two bands it can
 * honestly mean.
 */
export function multiRingBuffer(fc, distancesM, { segments = 32, shape = "round", rings = true } = {}) {
  const distances = [...new Set((distancesM || [])
    .map(Number).filter((d) => Number.isFinite(d) && d > 0))]
    .sort((a, b) => a - b);
  if (!distances.length) return featureCollection([]);
  const disks = distances.map((d) => buffer(fc, d, { segments, shape, dissolve: true }));
  const out = [];
  distances.forEach((d, i) => {
    const inner = i > 0 ? distances[i - 1] : 0;
    const band = (rings && i > 0) ? difference(disks[i], disks[i - 1]) : disks[i];
    band.features.forEach((f) => {
      out.push(feature(f.geometry, {
        ...f.properties,
        buffer_m: d,
        buffer_min_m: rings ? inner : 0,
        // The same numbers in km, because these are what the LEGEND grades:
        // a band labelled "10–20" reads, "10000–20000" is an axis label.
        buffer_km: d / 1000,
        buffer_min_km: (rings ? inner : 0) / 1000,
      }));
    });
  });
  return featureCollection(out);
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
/** Planar area of a ring, for checking a union against its own inputs. */
function ringArea(ring) {
  return Math.abs(G.signedAreaPlanar(ring));
}

/**
 * Union two rings, CHECKED — because the primitive has a degenerate case and
 * fails silently on it.
 *
 * Greiner-Hormann does not handle collinear overlapping edges, and two
 * rectangles sharing a y-range exactly is the commonest shape in this app: a
 * box drawn beside another box, or a buffer aligned to a graticule. Measured,
 * two 1° squares overlapping by half returned a single ring with the area of
 * ONE square — the union silently lost a third of itself, and nothing about
 * the result said so.
 *
 * A union cannot be smaller than its largest input. Where that is violated
 * the ring is retried against a copy nudged by a hundredth of a millimetre,
 * which is enough to break the collinearity and far below the precision of
 * anything drawn on a globe; if it still fails the two are left UNMERGED,
 * because two correct shapes are better than one wrong one.
 */
const UNION_NUDGE = 1e-9;            // degrees; about 0.1 mm at the equator

function nudgeRing(ring) {
  return ring.map(([x, y]) => [x + UNION_NUDGE, y + UNION_NUDGE]);
}

/**
 * Intersection of two outer rings, CHECKED the way `unionRings` is.
 *
 * The same degeneracy, caught in the other two ops by the area audit below:
 * collinear overlapping edges defeat `segmentIntersection` (its denominator
 * is zero), which can leave ONE crossing where the traversal needs pairs —
 * and the result is the subject returned whole. Measured from the tools
 * dialog: a square sharing its right edge with the clip mask came through
 * clip UNCUT, and clip + difference of one 0.16°² square summed to 0.32°².
 *
 * The check is op-specific because a shared invariant misfires on the
 * containment fallbacks: an intersection may never leave the overlap of the
 * two bounding boxes, so any piece outside it is the degeneracy talking.
 * Retried against a mask nudged ~0.1 mm — far below the precision of
 * anything drawn on a globe — and still-invalid pieces are dropped rather
 * than shipped.
 */
function intersectRings(subject, mask) {
  const bs = G.boundsOf(subject);
  const bm = G.boundsOf(mask);
  const eps = 1e-9;
  const within = (ring) => {
    const b = G.boundsOf(ring);
    return b.minX >= Math.max(bs.minX, bm.minX) - eps
      && b.maxX <= Math.min(bs.maxX, bm.maxX) + eps
      && b.minY >= Math.max(bs.minY, bm.minY) - eps
      && b.maxY <= Math.min(bs.maxY, bm.maxY) + eps;
  };
  let out = G.booleanOp(subject, mask, "intersection").filter(validRing);
  if (out.every(within)) return out;
  out = G.booleanOp(subject, nudgeRing(mask), "intersection").filter(validRing);
  return out.filter(within);
}

/**
 * Subject ring minus mask ring, audited by TILING: what the mask cuts away
 * plus what survives must equal the subject. The remainder's target area is
 * the subject's minus the CHECKED intersection's, so this leans on
 * `intersectRings` rather than on a second raw call that could be wrong in
 * the same way at the same place.
 */
function subtractRings(subject, mask) {
  const aSubject = ringArea(subject);
  const aInter = intersectRings(subject, mask)
    .reduce((sum, ring) => sum + ringArea(ring), 0);
  const good = (rings) => Math.abs(
    rings.reduce((sum, ring) => sum + ringArea(ring), 0) - (aSubject - aInter),
  ) <= aSubject * 1e-6 + 1e-12;
  let out = G.booleanOp(subject, mask, "difference").filter(validRing);
  if (good(out)) return out;
  out = G.booleanOp(subject, nudgeRing(mask), "difference").filter(validRing);
  if (good(out)) return out;
  // Nothing valid either way: when the mask demonstrably takes no area, the
  // honest answer is the untouched subject; otherwise the nudged attempt is
  // the least wrong thing available.
  return aInter <= aSubject * 1e-6 ? [subject] : out;
}

function unionRings(a, b) {
  /**
   * A union answer is VALID in exactly two shapes, and anything else is the
   * degeneracy talking: one ring that spans both inputs (a real merge), or
   * the two inputs handed back with their area intact (no overlap). The
   * first guard tested only the one-ring case — and the collinear failure
   * can just as well SHRED into several near-zero fragments, which read as
   * "two rings, so they did not overlap" and skipped the retry entirely.
   * Measured from the dialog: the dissolved L-shape unioned with a mask
   * sharing its right edge came back as rings of 0.02 and 0.0002 area, and
   * the two stayed separate while the nudged retry gives the exact 0.39.
   */
  const areaIn = ringArea(a) + ringArea(b);
  const valid = (rings) => {
    if (rings.length === 1) return coversBoth(rings[0], a, b);
    const total = rings.reduce((sum, ring) => sum + ringArea(ring), 0);
    return rings.length >= 2
      && Math.abs(total - areaIn) <= areaIn * 1e-6 + 1e-12;
  };
  const joined = G.booleanOp(a, b, "union").filter(validRing);
  if (valid(joined)) return joined;
  const retry = G.booleanOp(a, nudgeRing(b), "union").filter(validRing);
  if (valid(retry)) return retry;
  return [a, b];                     // honestly separate rather than wrongly one
}

/**
 * Does this ring reach every corner both inputs reach?
 *
 * An AREA floor cannot catch the degenerate case: the wrong answer there is
 * exactly one of the inputs, so its area equals the largest input's and any
 * floor passes. Bounds do catch it — a union that does not span both inputs
 * has lost part of one of them — and they cost four comparisons.
 */
function coversBoth(ring, a, b) {
  const u = G.boundsOf(ring);
  const want = [G.boundsOf(a), G.boundsOf(b)];
  const eps = 1e-9;
  return want.every((w) => u.minX <= w.minX + eps && u.minY <= w.minY + eps
    && u.maxX >= w.maxX - eps && u.maxY >= w.maxY - eps);
}

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
        const joined = unionRings(current, merged[i]);
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
/**
 * Do these two rings' boundaries CROSS — one passing both inside and outside
 * the other? This gate decides whether `punchHoles` calls the audited
 * `subtractRings` at all, so a false answer here bypasses the retry, the
 * tiling audit and the honest fallback in one step.
 *
 * IT WAS ANSWERING FALSE ON THE COMMONEST OVERLAP THERE IS. The test was a
 * proper crossing and only that: `Math.abs(d) < 1e-18` skips parallel edges,
 * and the `t`/`u` bounds exclude a crossing at an endpoint. Two rectangles
 * sharing a y-range exactly — a box drawn beside another box, a buffer
 * aligned to a graticule, the extent of one study area against another —
 * meet ONLY at vertices, so every candidate crossing was excluded and the
 * rings read as disjoint. `punchHoles` then returned the subject untouched
 * and `difference` handed back the whole feature, silently, as its answer.
 * Measured: A minus B over exactly that pair returned 123.643 km² of a
 * 123.643 km² subject, with clip on the SAME pair correctly returning 24.7.
 *
 * That degeneracy is the one this file already documents at length and
 * defends against inside `unionRings`, `intersectRings` and `subtractRings`.
 * The defence was simply never reached, because the gate above it was written
 * on the same primitive the defence exists to work around.
 *
 * So the crossing test is a SAMPLING one where the algebraic one is blind:
 * a boundary that has points strictly inside the other ring and points
 * strictly outside it crosses it, whatever its edges do at the vertices. That
 * characterisation is also what keeps the other two branches of `punchHoles`
 * intact — a wholly contained ring has no outside point and is still a HOLE,
 * a disjoint one has no inside point and still removes nothing.
 */
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
  // The sampling pass runs only when the algebraic one found nothing, and
  // never for rings whose bounds miss — which is the overwhelmingly common
  // case on a map of thousands of polygons, and the reason this stays cheap.
  if (!G.boundsIntersect(G.boundsOf(a), G.boundsOf(b))) return false;
  return boundaryCrosses(b, a) || boundaryCrosses(a, b);
}

/**
 * Does `ring`'s boundary have points strictly inside AND strictly outside
 * `other`? Sampled at three points per edge rather than at the vertices: a
 * vertex of a degenerate pair usually lies exactly ON the other boundary,
 * where a point-in-ring test is a coin toss, and three interior samples make
 * every edge of a shared boundary land on the same wrong answer at once
 * vanishingly unlikely.
 */
function boundaryCrosses(ring, other) {
  let inside = false;
  let outside = false;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    for (const t of [0.25, 0.5, 0.75]) {
      if (G.pointInRing([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], other)) inside = true;
      else outside = true;
      if (inside && outside) return true;
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
      const fragments = subtractRings(outer, hole);
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
  const outers = intersectRings(subject[0], mask[0]);
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
    const restored = intersectRings(subject[0], maskHole);
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
/**
 * Clip a polyline against a set of mask polygons, keeping either the inside
 * or the outside pieces.
 *
 * `clip` used to keep a LINE only when one of its VERTICES fell inside a mask
 * — so a transect drawn straight across a study area, both endpoints outside,
 * vanished entirely, and a river was kept or dropped whole. Lines are cut at
 * the boundary now, the way the polygons always were: every segment collects
 * its crossing parameters against every mask edge (holes included), each
 * sub-interval is classified by its midpoint with holes honoured, and
 * consecutive kept pieces are stitched back into runs.
 */
function clipLineToMasks(coords, masks, keepInside) {
  const eps = 1e-12;
  const inside = (pt) => masks.some((m) => G.pointInPolygon(pt, m.polygon));
  const pieces = [];
  let run = [];
  const flush = () => { if (run.length > 1) pieces.push(run); run = []; };
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const ts = [0, 1];
    masks.forEach((m) => m.polygon.forEach((ring) => {
      for (let j = 0; j < ring.length - 1; j += 1) {
        const [ex, ey] = ring[j];
        const [fx2, fy2] = ring[j + 1];
        const rdx = fx2 - ex;
        const rdy = fy2 - ey;
        const denom = dx * rdy - dy * rdx;
        if (Math.abs(denom) < 1e-15) continue;
        const t = ((ex - a[0]) * rdy - (ey - a[1]) * rdx) / denom;
        const u = ((ex - a[0]) * dy - (ey - a[1]) * dx) / denom;
        if (t > eps && t < 1 - eps && u >= -eps && u <= 1 + eps) ts.push(t);
      }
    }));
    ts.sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k += 1) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < eps) continue;
      const tm = (t0 + t1) / 2;
      const keep = inside([a[0] + dx * tm, a[1] + dy * tm]) === keepInside;
      if (!keep) { flush(); continue; }
      const p0 = [a[0] + dx * t0, a[1] + dy * t0];
      const p1 = [a[0] + dx * t1, a[1] + dy * t1];
      if (run.length && Math.abs(run[run.length - 1][0] - p0[0]) < eps
        && Math.abs(run[run.length - 1][1] - p0[1]) < eps) {
        run.push(p1);
      } else {
        flush();
        run = [p0, p1];
      }
    }
  }
  flush();
  return pieces;
}

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
    // LINES are cut at the boundary, in both modes — see clipLineToMasks.
    const lineParts = polygonsOf(f.geometry).length ? [] : linesOf(f.geometry);
    if (lineParts.length) {
      const kept = lineParts.flatMap((line) =>
        clipLineToMasks(line, masks, mode === "intersection"));
      if (kept.length) {
        out.push(feature(kept.length === 1
          ? { type: "LineString", coordinates: kept[0] }
          : { type: "MultiLineString", coordinates: kept }, propsFrom(f)));
      }
    }
    // POINTS are kept or dropped by containment, holes honoured — in BOTH
    // modes: difference used to drop every point regardless, because only
    // intersection had a branch here at all.
    if (!polygonsOf(f.geometry).length && !lineParts.length) {
      const coords = geometryCoords(f.geometry);
      const inside = coords.some((c) => masks.some((m) => G.pointInPolygon(c, m.polygon)));
      if (inside === (mode === "intersection")) {
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
  let holesDropped = 0;
  groups.forEach((group, key) => {
    if (!group.polygons.length) return;
    const properties = field
      ? { [field]: key, dissolved_count: group.count }
      : { dissolved_count: group.count };
    /**
     * DISSOLVE REMOVES THE SHARED BOUNDARY. It used to collect the group's
     * polygons into one MultiPolygon and stop — which is ArcGIS's MERGE, not
     * its Dissolve: the features became one row while the shapes stayed
     * separate, so two squares overlapping by half reported the area of two
     * whole squares. Measured before this: 24,727 km² for a pair whose union
     * is 18,545.
     *
     * `unionAll` is the same pass the buffer's own dissolve uses, so the two
     * cannot disagree; it merges what overlaps and leaves what does not, and
     * a group that dissolves to several disjoint pieces comes back as one
     * MultiPolygon feature — one row, as a dissolve should be.
     */
    const pieces = unionAll(
      featureCollection(group.polygons.map((polygon) => feature(
        { type: "Polygon", coordinates: polygon }, {},
      ))), properties,
    );
    holesDropped += group.polygons.filter((polygon) => polygon.length > 1).length;
    if (!pieces.features.length) return;
    out.push(feature({
      type: "MultiPolygon",
      coordinates: pieces.features.map((f) => f.geometry.coordinates),
    }, properties));
  });
  const result = featureCollection(out);
  // The merge works on OUTER rings, the limit `union` already states. Say so
  // rather than letting a donut quietly become solid.
  if (holesDropped) result.holesDropped = holesDropped;
  return result;
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
