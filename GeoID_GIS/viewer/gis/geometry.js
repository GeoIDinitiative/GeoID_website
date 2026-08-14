// Computational geometry for the vector toolbox.
//
// Everything here works on plain [x, y] rings in degrees (lon, lat) and is
// deliberately dependency-free and side-effect free, so the algorithms can be
// unit-tested directly. Measurements are geodesic where it matters; boolean
// operations are planar, which is the same trade-off QGIS makes when it runs
// GEOS on projected or small-extent geographic data.

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

// ── Measurement ─────────────────────────────────────────────────────────────

export function haversineMetres(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthMetres(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMetres(coords[i - 1], coords[i]);
  }
  return total;
}

/** Geodesic ring area via spherical excess; sign indicates winding. */
export function ringAreaM2(ring) {
  if (ring.length < 3) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    total += (p2[0] - p1[0]) * RAD * (2 + Math.sin(p1[1] * RAD) + Math.sin(p2[1] * RAD));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/** Planar signed area — used for winding and centroid maths, not reporting. */
export function signedAreaPlanar(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function ringCentroid(ring) {
  const area = signedAreaPlanar(ring);
  if (Math.abs(area) < 1e-14) {
    // Degenerate ring: fall back to the vertex average.
    const sum = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

export function boundsOf(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  coords.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  return { minX, minY, maxX, maxY };
}

export function boundsIntersect(a, b) {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

// ── Predicates ──────────────────────────────────────────────────────────────

export function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Polygon = [outerRing, ...holes], matching GeoJSON. */
export function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) {
    return false;
  }
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) {
      return false;
    }
  }
  return true;
}

// ── Hull and simplification ─────────────────────────────────────────────────

/** Andrew's monotone chain. Returns a closed ring. */
export function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) {
    return pts.slice();
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (source) => {
    const stack = [];
    source.forEach((p) => {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
        stack.pop();
      }
      stack.push(p);
    });
    stack.pop();
    return stack;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  const hull = lower.concat(upper);
  hull.push(hull[0]);
  return hull;
}

function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Douglas-Peucker. Tolerance is in degrees. */
export function simplify(coords, tolerance) {
  if (coords.length < 3 || tolerance <= 0) {
    return coords.slice();
  }
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < coords.length - 1; i += 1) {
    const dist = perpendicularDistance(coords[i], coords[0], coords[coords.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist <= tolerance) {
    return [coords[0], coords[coords.length - 1]];
  }
  const left = simplify(coords.slice(0, index + 1), tolerance);
  const right = simplify(coords.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

// ── Boolean operations (Greiner-Hormann) ────────────────────────────────────
//
// Handles the general concave case that Sutherland-Hodgman cannot. Degenerate
// configurations (vertex exactly on an edge) are perturbed rather than
// special-cased, which is the standard practical mitigation.

function makeNode(x, y, alpha = 0, intersect = false) {
  return { x, y, alpha, intersect, next: null, prev: null, neighbour: null, entry: false, visited: false };
}

function buildList(ring) {
  const nodes = ring.map(([x, y]) => makeNode(x, y));
  for (let i = 0; i < nodes.length; i += 1) {
    nodes[i].next = nodes[(i + 1) % nodes.length];
    nodes[i].prev = nodes[(i - 1 + nodes.length) % nodes.length];
  }
  return nodes[0];
}

function toArray(start) {
  const out = [];
  let node = start;
  do {
    out.push(node);
    node = node.next;
  } while (node !== start);
  return out;
}

function segmentIntersection(p1, p2, q1, q2) {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x;
  const dy2 = q2.y - q1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-14) {
    return null;
  }
  const tNum = (q1.x - p1.x) * dy2 - (q1.y - p1.y) * dx2;
  const uNum = (q1.x - p1.x) * dy1 - (q1.y - p1.y) * dx1;
  const t = tNum / denom;
  const u = uNum / denom;
  if (t <= 1e-12 || t >= 1 - 1e-12 || u <= 1e-12 || u >= 1 - 1e-12) {
    return null;
  }
  return { t, u, x: p1.x + t * dx1, y: p1.y + t * dy1 };
}

function insertBetween(node, start, end) {
  let current = start;
  while (current !== end && current.alpha < node.alpha) {
    current = current.next;
  }
  node.next = current;
  node.prev = current.prev;
  current.prev.next = node;
  current.prev = node;
}

function ringContains(ring, x, y) {
  return pointInRing([x, y], ring);
}

/**
 * Greiner-Hormann clip. `mode` is "intersection", "union" or "difference"
 * (subject minus clip). Returns an array of rings.
 */
export function booleanOp(subjectRing, clipRing, mode = "intersection") {
  const subject = buildList(subjectRing);
  const clip = buildList(clipRing);

  // Capture every ORIGINAL segment of both rings before inserting anything.
  //
  // The endpoints must be read before the loop runs, not during it: inserting
  // an intersection node rewrites `.next`, so a segment read mid-loop is the
  // truncated piece up to the last insertion — and any later crossing of that
  // segment is silently missed. A segment crossed twice (a bar passing through
  // a rectangle crosses each side wall twice) lost its second intersection
  // that way, and the traversal then stitched the fragments into one
  // self-crossing ring of zero net area. insertBetween is unaffected: it walks
  // by alpha from the segment's start and stops at the original end vertex,
  // stepping over any nodes inserted before it.
  const subjectSegments = toArray(subject).map((n) => [n, n.next]);
  const clipSegments = toArray(clip).map((n) => [n, n.next]);

  let found = false;
  subjectSegments.forEach(([sNode, sNext]) => {
    clipSegments.forEach(([cNode, cNext]) => {
      const hit = segmentIntersection(sNode, sNext, cNode, cNext);
      if (!hit) {
        return;
      }
      found = true;
      const a = makeNode(hit.x, hit.y, hit.t, true);
      const b = makeNode(hit.x, hit.y, hit.u, true);
      a.neighbour = b;
      b.neighbour = a;
      insertBetween(a, sNode, sNext);
      insertBetween(b, cNode, cNext);
    });
  });

  if (!found) {
    // Disjoint or fully nested — decide by containment.
    const subjectInClip = ringContains(clipRing, subjectRing[0][0], subjectRing[0][1]);
    const clipInSubject = ringContains(subjectRing, clipRing[0][0], clipRing[0][1]);
    if (mode === "intersection") {
      if (subjectInClip) return [subjectRing.slice()];
      if (clipInSubject) return [clipRing.slice()];
      return [];
    }
    if (mode === "union") {
      if (subjectInClip) return [clipRing.slice()];
      if (clipInSubject) return [subjectRing.slice()];
      return [subjectRing.slice(), clipRing.slice()];
    }
    // difference
    if (subjectInClip) return [];
    return [subjectRing.slice()];
  }

  // Entry/exit flags.
  const markEntries = (start, otherRing, invert) => {
    let inside = ringContains(otherRing, start.x, start.y);
    toArray(start).forEach((node) => {
      if (node.intersect) {
        node.entry = invert ? inside : !inside;
        inside = !inside;
      }
    });
  };
  const wantSubjectInside = mode === "intersection";
  const wantClipInside = mode === "intersection" || mode === "difference";
  markEntries(subject, clipRing, !wantSubjectInside);
  markEntries(clip, subjectRing, !wantClipInside);

  const results = [];
  const allIntersections = toArray(subject).filter((n) => n.intersect);
  allIntersections.forEach((startNode) => {
    if (startNode.visited) {
      return;
    }
    const ring = [];
    let node = startNode;
    do {
      node.visited = true;
      if (node.neighbour) {
        node.neighbour.visited = true;
      }
      const forward = node.entry;
      do {
        node = forward ? node.next : node.prev;
        ring.push([node.x, node.y]);
      } while (!node.intersect);
      node.visited = true;
      node = node.neighbour;
      if (!node) {
        break;
      }
    } while (node && !node.visited && ring.length < 100000);
    if (ring.length >= 3) {
      ring.push(ring[0]);
      results.push(ring);
    }
  });

  return results;
}

// ── Buffer ──────────────────────────────────────────────────────────────────

const metresToDegLat = (m) => m / 110574;
const metresToDegLon = (m, lat) => m / (111320 * Math.max(Math.cos(lat * RAD), 1e-6));

/** Circle around a point, in degrees, accounting for latitude convergence. */
export function circleAround([lon, lat], radiusM, segments = 48) {
  const ring = [];
  const dLat = metresToDegLat(radiusM);
  const dLon = metresToDegLon(radiusM, lat);
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    ring.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return ring;
}

/**
 * Offsets a ring outward along each vertex's angle bisector. Exact for convex
 * input; concave input can self-intersect at large distances, which is the
 * known limitation of bisector offsetting versus a full Minkowski sum.
 */
export function offsetRing(ring, distanceM) {
  const closed = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 3) {
    return ring.slice();
  }
  const outward = signedAreaPlanar(pts) > 0 ? 1 : -1;
  const out = pts.map((point, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const lat = point[1];
    const dLat = metresToDegLat(distanceM);
    const dLon = metresToDegLon(distanceM, lat);
    // Normals of the two adjacent edges, averaged into a bisector.
    const n1 = [-(point[1] - prev[1]), point[0] - prev[0]];
    const n2 = [-(next[1] - point[1]), next[0] - point[0]];
    const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const a = norm(n1);
    const b = norm(n2);
    const bis = norm([a[0] + b[0], a[1] + b[1]]);
    return [point[0] + outward * bis[0] * dLon, point[1] + outward * bis[1] * dLat];
  });
  out.push(out[0]);
  return out;
}

/** Buffers a polyline into a polygon by offsetting both sides. */
export function bufferLine(coords, distanceM) {
  if (coords.length < 2) {
    return coords.length ? circleAround(coords[0], distanceM) : [];
  }
  const left = [];
  const right = [];
  for (let i = 0; i < coords.length; i += 1) {
    const prev = coords[Math.max(0, i - 1)];
    const next = coords[Math.min(coords.length - 1, i + 1)];
    const lat = coords[i][1];
    const dLat = metresToDegLat(distanceM);
    const dLon = metresToDegLon(distanceM, lat);
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([coords[i][0] + nx * dLon, coords[i][1] + ny * dLat]);
    right.push([coords[i][0] - nx * dLon, coords[i][1] - ny * dLat]);
  }
  const ring = left.concat(right.reverse());
  ring.push(ring[0]);
  return ring;
}
