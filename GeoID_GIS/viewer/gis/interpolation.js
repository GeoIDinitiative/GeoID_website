import { makeRaster } from "./raster-analysis.js?v=20260823-feb0f36";
import { featureCollection, feature } from "./geoprocessing.js?v=20260823-feb0f36";

// Interpolation: scattered observations to a continuous surface.
//
// The QGIS Interpolation plugin / ArcGIS "Spatial Analyst > Interpolation"
// corner of a GIS. Boreholes, rain gauges, soil samples and spot heights all
// arrive as points; flood, susceptibility and terrain models want a field.
// Three ways to cross that gap, plus the Voronoi partition that underlies the
// nearest-neighbour answer.
//
// COORDINATES. Geometry here is plain lon/lat degrees, as everywhere else in
// the viewer: the Delaunay triangulation, the TIN and the Voronoi cells are
// computed in degree space, and their vertices come back as degrees.
//
// The one exception is the IDW weighting. A degree of longitude is shorter
// than a degree of latitude everywhere but the equator, so a distance measured
// in degrees is not a distance: at 55 N (Northern Ireland) a degree of
// longitude is ~64 km against ~111 km for a degree of latitude. Weighting by
// degree distance would pull each cell towards whatever samples happen to lie
// east and west of it — an anisotropy with no physical cause. So IDW converts
// both the samples and the cell centre to metres with an equirectangular
// scaling taken at the AOI's centre latitude before it forms 1/d^p. The
// scaling is a constant per raster, so it is exact for the aspect ratio and
// cheap; over an AOI spanning many degrees of latitude it is an approximation,
// as an equirectangular projection always is.
//
// The same caveat applies in reverse to Delaunay/Voronoi: in degree space the
// "nearest" generator at high latitude is not always the nearest on the
// ground. For a study-area-sized AOI the two agree; for a continental one,
// reproject the points first.

const METRES_PER_DEG_LAT = 110574;
const METRES_PER_DEG_LON_EQ = 111320;

/** Squared metre distance below which a cell counts as sitting on a sample. */
const ZERO_DISTANCE_M2 = 1e-9;

/* ─────────────────────────── shared plumbing ─────────────────────────── */

function numericValue(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  // Shapefile and CSV imports often carry numbers as text; a blank or a
  // "no data" string is not a zero and must not become one.
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pointCoords(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint") return geometry.coordinates;
  return null;
}

/** Every Point/MultiPoint position carrying a numeric `field`. */
function collectSamples(fc, field) {
  const out = [];
  const features = Array.isArray(fc?.features) ? fc.features : [];
  features.forEach((f) => {
    const coords = pointCoords(f?.geometry);
    if (!coords) return;
    const v = numericValue(f?.properties?.[field]);
    if (v === null) return;
    coords.forEach((c) => {
      const x = Number(c?.[0]);
      const y = Number(c?.[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, v });
    });
  });
  return out;
}

/** Every Point/MultiPoint position with the properties of its feature. */
function collectGenerators(fc) {
  const out = [];
  const features = Array.isArray(fc?.features) ? fc.features : [];
  features.forEach((f) => {
    const coords = pointCoords(f?.geometry);
    if (!coords) return;
    coords.forEach((c) => {
      const x = Number(c?.[0]);
      const y = Number(c?.[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push({ x, y, properties: f?.properties || {} });
      }
    });
  });
  return out;
}

function normaliseBounds(bounds) {
  const minX = Number(bounds?.minX);
  const minY = Number(bounds?.minY);
  const maxX = Number(bounds?.maxX);
  const maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Cell counts for an AOI, matching samplerToRaster: `cellsAcross` sets the
 * width, the height follows the AOI's aspect, and maxCells is the ceiling that
 * keeps a careless "10000 across" from allocating gigabytes.
 */
function gridShape(bounds, cellsAcross, maxCells) {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  let width = Math.max(2, Math.round(Number(cellsAcross) || 0));
  let height = Math.max(2, Math.round(width * (spanY / spanX)));
  if (width * height > maxCells) {
    const shrink = Math.sqrt(maxCells / (width * height));
    width = Math.max(2, Math.floor(width * shrink));
    height = Math.max(2, Math.floor(height * shrink));
  }
  return { width, height, spanX, spanY };
}

/** Metres per degree on each axis at the AOI's centre latitude. */
function metreScale(bounds) {
  const lat0 = (bounds.minY + bounds.maxY) / 2;
  const sx = Math.abs(METRES_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180));
  return { sx: sx > 1 ? sx : 1, sy: METRES_PER_DEG_LAT };
}

/* ──────────────────────────────── IDW ────────────────────────────────── */

/**
 * Inverse distance weighting.
 *
 * value(cell) = Σ wᵢ vᵢ / Σ wᵢ with wᵢ = 1 / dᵢ^power, distances in metres.
 * Every cell is a convex combination of the samples, so the surface never
 * leaves the observed range — IDW cannot invent a peak the data does not have,
 * which is exactly why it is the safe default for sparse gauge networks and
 * exactly why it flat-spots around each sample.
 *
 * IDW is an *exact* interpolator: at a sample the surface equals the sample.
 * Evaluating at cell centres would blur that, because a sample almost never
 * sits on a centre, so after the sweep each sample's own cell is set to the
 * sample value (their mean where several samples share one cell). The
 * zero-distance singularity in 1/d^p is guarded by the same rule.
 *
 * @param {object} fc GeoJSON FeatureCollection; Point/MultiPoint are read
 * @param {string} field property holding the numeric observation
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} bounds AOI
 * @param {{cellsAcross?:number, power?:number, maxCells?:number}} [opts]
 * @returns {object|null} raster {band,width,height,bounds,noData}, or null
 */
export function idwRaster(fc, field, bounds, opts = {}) {
  const { cellsAcross = 256, power = 2, maxCells = 4000000 } = opts;
  const pts = collectSamples(fc, field);
  if (!pts.length) return null;
  const box = normaliseBounds(bounds);
  if (!box) return null;

  const { width, height, spanX, spanY } = gridShape(box, cellsAcross, maxCells);
  const { sx, sy } = metreScale(box);
  const n = pts.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pv = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    px[i] = pts[i].x * sx;
    py[i] = pts[i].y * sy;
    pv[i] = pts[i].v;
  }

  // w = d^-power = (d²)^(-power/2), so the square root is never taken.
  const halfPower = (Number.isFinite(power) ? power : 2) / 2;
  const band = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const lat = box.maxY - ((y + 0.5) / height) * spanY; // row 0 is north
    const qy = lat * sy;
    for (let x = 0; x < width; x += 1) {
      const lon = box.minX + ((x + 0.5) / width) * spanX;
      const qx = lon * sx;
      let num = 0;
      let den = 0;
      let exact = null;
      let nearest = 0;
      let nearestD2 = Infinity;
      for (let i = 0; i < n; i += 1) {
        const dx = qx - px[i];
        const dy = qy - py[i];
        const d2 = dx * dx + dy * dy;
        if (d2 <= ZERO_DISTANCE_M2) { exact = pv[i]; break; }
        if (d2 < nearestD2) { nearestD2 = d2; nearest = pv[i]; }
        const w = Math.pow(d2, -halfPower);
        num += w * pv[i];
        den += w;
      }
      let out;
      if (exact !== null) {
        out = exact;
      } else {
        out = num / den;
        // A huge power makes every weight overflow or underflow together; the
        // limit of IDW as p→∞ is the nearest sample, so say that rather than NaN.
        if (!Number.isFinite(out)) out = nearest;
      }
      band[y * width + x] = out;
    }
  }

  // Exactness pass: stamp each sample into the cell that contains it.
  const stamped = new Map();
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue;
    const col = Math.min(width - 1, Math.floor(((p.x - box.minX) / spanX) * width));
    const row = Math.min(height - 1, Math.floor(((box.maxY - p.y) / spanY) * height));
    const idx = row * width + col;
    const acc = stamped.get(idx);
    if (acc) { acc.sum += p.v; acc.count += 1; } else { stamped.set(idx, { sum: p.v, count: 1 }); }
  }
  stamped.forEach((acc, idx) => { band[idx] = acc.sum / acc.count; });

  const raster = makeRaster(band, width, height, box, NaN);
  raster.pointCount = n;
  return raster;
}

/* ───────────────────────── Delaunay (Bowyer–Watson) ───────────────────── */

function circumcircle(ax, ay, bx, by, cx, cy) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-18) return null; // collinear
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const dx = ax - ux;
  const dy = ay - uy;
  return { x: ux, y: uy, r2: dx * dx + dy * dy };
}

/**
 * Delaunay triangulation by incremental Bowyer–Watson insertion.
 *
 * Each point is inserted into a super-triangle that encloses the whole set:
 * every triangle whose circumcircle swallows the new point is deleted, and the
 * cavity that leaves is re-fanned from the new point. Triangles still touching
 * a super-triangle vertex are dropped at the end, leaving the triangulation of
 * the convex hull.
 *
 * Points are worked on in a translated and scaled frame (the set fits a unit
 * box at the origin) so the circumcircle determinant is evaluated on O(1)
 * numbers rather than on lon/lat magnitudes squared.
 *
 * Duplicate positions are removed first — a repeated point has no circumcircle
 * to break and would spin a degenerate cavity — and the returned indices point
 * at the FIRST occurrence of each position in the input array.
 *
 * @param {Array<[number,number]|{x:number,y:number}>} points
 * @returns {Array<[number,number,number]>} index triplets, wound CCW
 */
export function delaunay(points) {
  const list = Array.isArray(points) ? points : [];
  const uniq = [];
  const seen = new Map();
  list.forEach((p, i) => {
    const x = Array.isArray(p) ? Number(p[0]) : Number(p?.x);
    const y = Array.isArray(p) ? Number(p[1]) : Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = `${x}|${y}`;
    if (seen.has(key)) return;
    seen.set(key, uniq.length);
    uniq.push({ x, y, index: i });
  });
  const n = uniq.length;
  if (n < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  uniq.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx0 = (minX + maxX) / 2;
  const cy0 = (minY + maxY) / 2;
  const xs = new Float64Array(n + 3);
  const ys = new Float64Array(n + 3);
  for (let i = 0; i < n; i += 1) {
    xs[i] = (uniq[i].x - cx0) / span;
    ys[i] = (uniq[i].y - cy0) / span;
  }
  // Super-triangle, comfortably around the unit box the points now live in.
  xs[n] = -20; ys[n] = -20;
  xs[n + 1] = 20; ys[n + 1] = -20;
  xs[n + 2] = 0; ys[n + 2] = 20;

  const tris = [];
  const addTriangle = (a, b, c) => {
    const cc = circumcircle(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
    if (cc) tris.push({ a, b, c, cx: cc.x, cy: cc.y, r2: cc.r2 });
  };
  addTriangle(n, n + 1, n + 2);

  for (let i = 0; i < n; i += 1) {
    const px = xs[i];
    const py = ys[i];
    const edges = [];
    for (let t = tris.length - 1; t >= 0; t -= 1) {
      const T = tris[t];
      const dx = px - T.cx;
      const dy = py - T.cy;
      // Cocircular points count as inside: resolving the tie one way for every
      // triangle keeps the cavity a single star-shaped hole.
      if (dx * dx + dy * dy <= T.r2 * (1 + 1e-12)) {
        edges.push([T.a, T.b], [T.b, T.c], [T.c, T.a]);
        tris.splice(t, 1);
      }
    }
    // The cavity boundary is the edges used once; shared edges are interior.
    for (let e = 0; e < edges.length; e += 1) {
      const [a, b] = edges[e];
      let shared = false;
      for (let o = 0; o < edges.length; o += 1) {
        if (o === e) continue;
        const [c, d] = edges[o];
        if ((a === c && b === d) || (a === d && b === c)) { shared = true; break; }
      }
      if (!shared) addTriangle(a, b, i);
    }
  }

  const out = [];
  tris.forEach((T) => {
    if (T.a >= n || T.b >= n || T.c >= n) return; // touches the super-triangle
    const cross = (xs[T.b] - xs[T.a]) * (ys[T.c] - ys[T.a])
      - (xs[T.c] - xs[T.a]) * (ys[T.b] - ys[T.a]);
    if (Math.abs(cross) < 1e-18) return; // zero-area sliver
    const tri = cross > 0
      ? [uniq[T.a].index, uniq[T.b].index, uniq[T.c].index]
      : [uniq[T.a].index, uniq[T.c].index, uniq[T.b].index]; // wind CCW
    out.push(tri);
  });
  return out;
}

/* ──────────────────────────────── TIN ─────────────────────────────────── */

/**
 * Triangulated irregular network: linear interpolation over the Delaunay
 * triangles of the samples.
 *
 * Where IDW flat-spots, a TIN is planar between the three surrounding
 * observations — the classic surface for spot heights, and the honest one for
 * a hull, because it says nothing at all outside it. Cells beyond the convex
 * hull are NaN (the raster's noData), not an extrapolated guess.
 *
 * Filling runs per triangle rather than per cell: each triangle touches only
 * the cells in its own bounding box, so the whole sweep costs one pass over
 * the grid instead of cells × triangles.
 *
 * @returns {object|null} raster, or null if fewer than 3 samples / no triangles
 */
export function tinRaster(fc, field, bounds, opts = {}) {
  const { cellsAcross = 256, maxCells = 4000000 } = opts;
  const pts = collectSamples(fc, field);
  if (pts.length < 3) return null;
  const box = normaliseBounds(bounds);
  if (!box) return null;
  const tris = delaunay(pts.map((p) => [p.x, p.y]));
  if (!tris.length) return null;

  const { width, height, spanX, spanY } = gridShape(box, cellsAcross, maxCells);
  const band = new Float32Array(width * height).fill(NaN);

  // lon = minX + (col + 0.5)/width * spanX  →  col = (lon - minX)/spanX*width - 0.5
  // lat = maxY - (row + 0.5)/height * spanY →  row = (maxY - lat)/spanY*height - 0.5
  const colOf = (lon) => ((lon - box.minX) / spanX) * width - 0.5;
  const rowOf = (lat) => ((box.maxY - lat) / spanY) * height - 0.5;

  tris.forEach(([ia, ib, ic]) => {
    const A = pts[ia];
    const B = pts[ib];
    const C = pts[ic];
    const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (!Number.isFinite(det) || det === 0) return;
    const loX = Math.max(0, Math.ceil(colOf(Math.min(A.x, B.x, C.x))));
    const hiX = Math.min(width - 1, Math.floor(colOf(Math.max(A.x, B.x, C.x))));
    const loY = Math.max(0, Math.ceil(rowOf(Math.max(A.y, B.y, C.y))));
    const hiY = Math.min(height - 1, Math.floor(rowOf(Math.min(A.y, B.y, C.y))));
    for (let row = loY; row <= hiY; row += 1) {
      const lat = box.maxY - ((row + 0.5) / height) * spanY;
      for (let col = loX; col <= hiX; col += 1) {
        const lon = box.minX + ((col + 0.5) / width) * spanX;
        const l1 = ((B.y - C.y) * (lon - C.x) + (C.x - B.x) * (lat - C.y)) / det;
        const l2 = ((C.y - A.y) * (lon - C.x) + (A.x - C.x) * (lat - C.y)) / det;
        const l3 = 1 - l1 - l2;
        // A shared edge is written twice with the same value — harmless.
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        band[row * width + col] = l1 * A.v + l2 * B.v + l3 * C.v;
      }
    }
  });

  const raster = makeRaster(band, width, height, box, NaN);
  raster.pointCount = pts.length;
  raster.triangleCount = tris.length;
  return raster;
}

/* ────────────────────────────── Voronoi ───────────────────────────────── */

/**
 * Clip a convex ring to the half-plane n·p ≤ c (Sutherland–Hodgman).
 * `n` is a unit vector, so the test value is a signed distance in degrees and
 * one epsilon works for every edge.
 */
function clipHalfPlane(ring, nx, ny, c, eps) {
  const out = [];
  const len = ring.length;
  for (let i = 0; i < len; i += 1) {
    const A = ring[i];
    const B = ring[(i + 1) % len];
    const sa = nx * A[0] + ny * A[1] - c;
    const sb = nx * B[0] + ny * B[1] - c;
    const inA = sa <= eps;
    const inB = sb <= eps;
    if (inA) out.push(A);
    if (inA !== inB) {
      const t = sa / (sa - sb);
      if (Number.isFinite(t)) out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const A = ring[i];
    const B = ring[(i + 1) % ring.length];
    sum += A[0] * B[1] - B[0] * A[1];
  }
  return sum / 2;
}

/**
 * Voronoi (Thiessen) polygons, clipped to the AOI.
 *
 * METHOD: half-plane clipping, not the Delaunay dual. Each cell starts as the
 * AOI rectangle and is clipped by the perpendicular bisector against every
 * other generator, which is O(n²) — slower than walking the dual, but it needs
 * no hull bookkeeping to close the unbounded cells at the AOI edge, and it is
 * correct by construction: the survivor set is exactly "points closer to this
 * generator than to any other, inside the box". At a few thousand rain gauges
 * or boreholes the quadratic term is not what anyone waits for.
 *
 * The rainfall-averaging classic (Thiessen weights) and the nearest-neighbour
 * partition behind "which gauge governs this catchment". Each polygon carries
 * its generator's properties. Repeated positions collapse to the first
 * occurrence — coincident generators have no cell to divide.
 *
 * @returns {object} FeatureCollection of Polygon features (CCW exterior rings)
 */
export function voronoiPolygons(fc, bounds) {
  const box = normaliseBounds(bounds);
  if (!box) return featureCollection([]);
  const all = collectGenerators(fc);
  const gens = [];
  const seen = new Set();
  all.forEach((p) => {
    const key = `${p.x}|${p.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    gens.push(p);
  });
  if (!gens.length) return featureCollection([]);

  const rect = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const eps = diag * 1e-12;
  const features = [];

  gens.forEach((p, i) => {
    let ring = rect;
    for (let j = 0; j < gens.length && ring.length >= 3; j += 1) {
      if (j === i) continue;
      const q = gens[j];
      let nx = q.x - p.x;
      let ny = q.y - p.y;
      const len = Math.hypot(nx, ny);
      if (!(len > 0)) continue;
      nx /= len;
      ny /= len;
      // Bisector: n·p = n·midpoint. Keep the side holding this generator.
      const c = (nx * (p.x + q.x) + ny * (p.y + q.y)) / 2;
      ring = clipHalfPlane(ring, nx, ny, c, eps);
    }
    if (ring.length < 3) return;
    // Drop vertices the clipping duplicated to numerical dust.
    const clean = ring.filter((v, k) => {
      const prev = ring[(k + ring.length - 1) % ring.length];
      return Math.hypot(v[0] - prev[0], v[1] - prev[1]) > eps;
    });
    if (clean.length < 3) return;
    if (Math.abs(ringArea(clean)) <= 0) return;
    const closed = [...clean.map((v) => [v[0], v[1]]), [clean[0][0], clean[0][1]]];
    features.push(feature({ type: "Polygon", coordinates: [closed] }, p.properties));
  });

  return featureCollection(features);
}
