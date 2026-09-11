/**
 * Variable-resolution surface sampling for the Model Builder.
 *
 * A uniform grid spends the same nodes on the plateau as on the scarp somebody
 * is modelling. Here the study area is sampled at a SPACING THAT VARIES BY
 * PLACE: a base step everywhere, and inside buffers the reader draws — a square
 * or a circle about a point — the DEM's own native step or a coarser one of
 * their choosing, GRADED between the two over a distance so the triangles grow
 * rather than jump. The lattice is a quadtree (a cell splits until it is no
 * larger than the spacing at its centre), its corners are Delaunay-triangulated
 * in the local metric frame, and every node takes the DEM's height at its own
 * lat/lon. The result is a TIN: an irregular surface that is still a single
 * closed loop at its rim, so the same skirt-and-base recipe the grid uses can
 * close it into a subsurface or an atmosphere shell.
 *
 * Pure on purpose: the height reader is passed in, and every function here is
 * checked in Node against a plane (which a TIN must reproduce exactly) and
 * against the closed-surface invariant (no open edges).
 */
import { delaunay } from "./interpolation.js?v=20260911-230d669";
import { makeLocalFrame, triangleWriter, sizeField } from "./model-build.js?v=20260911-230d669";

/* ── The spacing function ────────────────────────────────────────────────── */

/**
 * A buffer as the reader states it — a place, a shape, a size in km and a
 * resolution — into the local frame's metres. `stepM` null means "native",
 * which the caller resolves to the DEM's own post spacing.
 */
export function bufferLocal(buffer, frame, nativeM) {
  const c = frame.toLocal(Number(buffer.lat), Number(buffer.lon));
  const sizeM = Math.max(1, Number(buffer.sizeKm) * 1000);
  const step = Number(buffer.stepM) > 0 ? Number(buffer.stepM) : Number(nativeM) || 30;
  return {
    name: String(buffer.name || buffer.shape || "buffer"),
    shape: buffer.shape === "circle" ? "circle" : "square",
    cx: c.x,
    cy: c.y,
    // A square's size is its SIDE, a circle's its DIAMETER: both are "how big
    // is it across", which is what somebody types.
    halfM: sizeM / 2,
    stepM: step,
    gradeM: Number(buffer.gradeM) >= 0 ? Number(buffer.gradeM) : null,
  };
}

/** Signed distance from a point to a buffer's edge: negative inside. */
export function bufferDistance(b, x, y) {
  if (b.shape === "circle") return Math.hypot(x - b.cx, y - b.cy) - b.halfM;
  return Math.max(Math.abs(x - b.cx), Math.abs(y - b.cy)) - b.halfM;
}

/**
 * The spacing at a point: the base step, or a buffer's own step inside it,
 * graded linearly back to the base over `gradeM` outside its edge. Several
 * buffers: the FINEST wins, so a fine circle inside a coarser square refines
 * it and a coarse buffer cannot undo a fine one.
 */
export function spacingFn({ baseM, buffers = [], gradeM = 0 }) {
  const base = Math.max(1, Number(baseM) || 1);
  const list = buffers.filter((b) => b && Number.isFinite(b.cx) && Number.isFinite(b.cy) && b.halfM > 0);
  return (x, y) => {
    let s = base;
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      const step = Math.min(base, b.stepM);
      const grade = b.gradeM !== null && b.gradeM !== undefined ? b.gradeM : gradeM;
      const d = bufferDistance(b, x, y);
      let v;
      if (d <= 0) v = step;
      else if (grade > 0 && d < grade) v = step + (base - step) * (d / grade);
      else v = base;
      if (v < s) s = v;
    }
    return s;
  };
}

/* ── The lattice ─────────────────────────────────────────────────────────── */

/**
 * Quadtree corners over the box. A cell splits while it is larger than the
 * spacing at its centre; the corners of the leaves are the nodes. Corners are
 * shared by key, so a node on a coarse cell's edge that a finer neighbour also
 * touches exists once.
 *
 * The node budget is honoured by COARSENING everything together, never by
 * truncating: a lattice cut short is a different study, and one scaled up
 * keeps the buffers' ratios to the base.
 */
export function quadtreeLattice({
  x0, y0, widthM, heightM, spacing, maxNodes = 40000, minStepM = 1, maxDepth = 14,
}) {
  const W = Math.max(1, widthM);
  const H = Math.max(1, heightM);
  let factor = 1;
  let result = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const s = (x, y) => spacing(x, y) * factor;
    // Root cells sized by the COARSEST spacing anywhere in the box — sampled
    // on a 9 x 9 lattice rather than read at the centre, because the centre
    // is exactly where a reader puts a fine buffer, and a root sized by it
    // would make every cell fine and leave nothing to split.
    let coarsest = minStepM;
    for (let j = 0; j <= 8; j += 1) {
      for (let i = 0; i <= 8; i += 1) {
        const v = s(x0 + (W * i) / 8, y0 + (H * j) / 8);
        if (v > coarsest) coarsest = v;
      }
    }
    const rootTarget = coarsest;
    const nx = Math.max(1, Math.ceil(W / rootTarget));
    const ny = Math.max(1, Math.ceil(H / rootTarget));
    const cw = W / nx;
    const ch = H / ny;
    const keyOf = (x, y) => `${Math.round(x * 1000)}|${Math.round(y * 1000)}`;
    const index = new Map();
    const points = [];
    const nodeSpacing = [];
    let leaves = 0;
    let deepest = 0;
    const corner = (x, y, size) => {
      const k = keyOf(x, y);
      let i = index.get(k);
      if (i === undefined) {
        i = points.length;
        index.set(k, i);
        points.push([x, y]);
        nodeSpacing.push(size);
      } else if (size < nodeSpacing[i]) {
        nodeSpacing[i] = size;
      }
    };
    const split = (x, y, w, h, depth) => {
      const size = Math.max(w, h);
      const target = s(x + w / 2, y + h / 2);
      if (size > target && size / 2 >= minStepM && depth < maxDepth) {
        const hw = w / 2;
        const hh = h / 2;
        split(x, y, hw, hh, depth + 1);
        split(x + hw, y, hw, hh, depth + 1);
        split(x, y + hh, hw, hh, depth + 1);
        split(x + hw, y + hh, hw, hh, depth + 1);
        return;
      }
      leaves += 1;
      if (depth > deepest) deepest = depth;
      corner(x, y, size);
      corner(x + w, y, size);
      corner(x, y + h, size);
      corner(x + w, y + h, size);
    };
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        split(x0 + i * cw, y0 + j * ch, cw, ch, 0);
      }
    }
    result = { points, nodeSpacing, leaves, deepest, factor, root: { nx, ny, cw, ch } };
    if (points.length <= maxNodes) break;
    factor *= Math.sqrt(points.length / maxNodes) * 1.05;
  }
  result.capped = result.factor > 1;
  return result;
}

/* ── Topology ────────────────────────────────────────────────────────────── */

/**
 * The rim of a triangulation as one counter-clockwise loop of node indices:
 * the edges used by exactly one triangle, chained end to end. A convex box with
 * nodes along its sides is one loop; anything else is a fault upstream and is
 * reported as such rather than guessed at.
 */
export function boundaryLoop(points, tris) {
  const count = new Map();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  tris.forEach(([a, b, c]) => {
    [[a, b], [b, c], [c, a]].forEach(([p, q]) => {
      const k = key(p, q);
      const e = count.get(k);
      if (e) e.n += 1; else count.set(k, { a: p, b: q, n: 1 });
    });
  });
  const next = new Map();
  count.forEach((e) => {
    if (e.n !== 1) return;
    if (!next.has(e.a)) next.set(e.a, []);
    if (!next.has(e.b)) next.set(e.b, []);
    next.get(e.a).push(e.b);
    next.get(e.b).push(e.a);
  });
  if (!next.size) return { loop: [], loops: 0 };
  const start = next.keys().next().value;
  const loop = [start];
  const seen = new Set([start]);
  let prev = -1;
  let cur = start;
  for (let guard = 0; guard < next.size + 1; guard += 1) {
    const nb = next.get(cur) || [];
    const to = nb.find((v) => v !== prev && !seen.has(v));
    if (to === undefined) break;
    loop.push(to);
    seen.add(to);
    prev = cur;
    cur = to;
  }
  // Orientation by the shoelace sign: counter-clockwise seen from above.
  let area = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const [x1, y1] = points[loop[i]];
    const [x2, y2] = points[loop[(i + 1) % loop.length]];
    area += x1 * y2 - x2 * y1;
  }
  if (area < 0) loop.reverse();
  const loops = Math.round(next.size / Math.max(1, loop.length));
  return { loop, loops, closed: loop.length === next.size };
}

function neighbourhood(n, tris) {
  const nb = Array.from({ length: n }, () => new Set());
  tris.forEach(([a, b, c]) => {
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  });
  return nb;
}

/**
 * A hole in the source is not a landform — the grid's rule, on a TIN: a node
 * that stands off the median of its neighbours by more than an 80° wall over
 * its own spacing (and at least 300 m) is a void and takes that median.
 */
export function despikeTin(points, z, tris) {
  const nb = neighbourhood(points.length, tris);
  const out = z.slice();
  let repaired = 0;
  let worst = 0;
  const wall = Math.tan((80 * Math.PI) / 180);
  for (let i = 0; i < points.length; i += 1) {
    const ids = [...nb[i]];
    if (ids.length < 3) continue;
    const vals = ids.map((j) => z[j]).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const dist = ids.map((j) => Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]))
      .sort((a, b) => a - b);
    const spacing = dist[Math.floor(dist.length / 2)] || 1;
    const tol = Math.max(300, wall * spacing);
    const off = Math.abs(z[i] - median);
    if (off > tol) {
      out[i] = median;
      repaired += 1;
      if (off > worst) worst = off;
    }
  }
  return { z: out, repaired, worst };
}

/* ── The TIN ─────────────────────────────────────────────────────────────── */

/**
 * The surface: lattice → Delaunay → heights, in the study's own local frame.
 * `heightAt(lat, lon)` is the DEM; `spacing` is either a function of local
 * (x, y) or the `{ baseM, buffers, gradeM }` it is made from.
 */
export function buildTin({
  bounds, radiusKm = 6371.0088, spacing, heightAt, maxNodes = 40000, minStepM = 1, nativeM = null,
}) {
  const lat0 = (bounds.south + bounds.north) / 2;
  const lon0 = (bounds.west + bounds.east) / 2;
  const frame = makeLocalFrame({ lat: lat0, lon: lon0, radiusKm });
  const sw = frame.toLocal(bounds.south, bounds.west);
  const ne = frame.toLocal(bounds.north, bounds.east);
  const widthM = ne.x - sw.x;
  const heightM = ne.y - sw.y;
  if (!(widthM > 0 && heightM > 0)) return { ok: false, message: "The study area has no extent." };
  const localBuffers = (spacing?.buffers || []).map((b) => (Number.isFinite(b.cx) ? b : bufferLocal(b, frame, nativeM)));
  const spacingOf = typeof spacing === "function" ? spacing
    : spacingFn({ baseM: spacing?.baseM, buffers: localBuffers, gradeM: spacing?.gradeM });
  const lattice = quadtreeLattice({
    x0: sw.x, y0: sw.y, widthM, heightM, spacing: spacingOf, maxNodes, minStepM,
  });
  const { points } = lattice;
  if (points.length < 4) return { ok: false, message: "Too few nodes to make a surface." };
  const tris = delaunay(points);
  if (!tris.length) return { ok: false, message: "The lattice could not be triangulated." };

  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  let z = new Float64Array(n);
  const filled = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    xs[i] = points[i][0];
    ys[i] = points[i][1];
    const ll = frame.fromLocal(xs[i], ys[i]);
    lats[i] = ll.lat;
    lons[i] = ll.lon;
    const v = heightAt(ll.lat, ll.lon);
    if (Number.isFinite(v)) { z[i] = v; sum += v; count += 1; } else { z[i] = NaN; filled.push(i); }
  }
  if (!count) return { ok: false, message: "No elevation could be read anywhere in this area." };
  const mean = sum / count;
  filled.forEach((i) => { z[i] = mean; });
  const spikes = despikeTin(points, z, tris);
  z = Float64Array.from(spikes.z);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i += 1) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  const rim = boundaryLoop(points, tris);
  let sMin = Infinity;
  let sMax = -Infinity;
  lattice.nodeSpacing.forEach((s) => { if (s < sMin) sMin = s; if (s > sMax) sMax = s; });
  return {
    ok: true,
    kind: "tin",
    xs, ys, z, lats, lons, tris,
    loop: rim.loop,
    loops: rim.loops,
    nodeSpacing: lattice.nodeSpacing,
    frame,
    origin: { lat: lat0, lon: lon0 },
    bounds,
    widthM, heightM,
    x0: sw.x, y0: sw.y,
    nodes: n,
    triangles: tris.length,
    leaves: lattice.leaves,
    deepest: lattice.deepest,
    factor: lattice.factor,
    capped: lattice.capped,
    spacingMinM: sMin,
    spacingMaxM: sMax,
    zMin, zMax, reliefM: zMax - zMin,
    filledNodes: filled.length,
    repairedNodes: spikes.repaired,
    repairWorstM: spikes.worst,
    buffers: localBuffers,
    spacingOf,
  };
}

/* ── Reading the TIN ─────────────────────────────────────────────────────── */

/** Buckets of triangles by plan bbox, built once per TIN and kept on it. */
export function tinIndex(tin, across = 64) {
  if (tin._index) return tin._index;
  const { xs, ys, tris } = tin;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  const w = (maxX - minX) || 1;
  const h = (maxY - minY) || 1;
  const buckets = Array.from({ length: across * across }, () => []);
  const cellOf = (x, y) => [
    Math.min(across - 1, Math.max(0, Math.floor(((x - minX) / w) * across))),
    Math.min(across - 1, Math.max(0, Math.floor(((y - minY) / h) * across))),
  ];
  tris.forEach((t, k) => {
    const [a, b, c] = t;
    const tx0 = Math.min(xs[a], xs[b], xs[c]); const tx1 = Math.max(xs[a], xs[b], xs[c]);
    const ty0 = Math.min(ys[a], ys[b], ys[c]); const ty1 = Math.max(ys[a], ys[b], ys[c]);
    const [i0, j0] = cellOf(tx0, ty0);
    const [i1, j1] = cellOf(tx1, ty1);
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) buckets[j * across + i].push(k);
  });
  tin._index = { across, minX, minY, w, h, buckets, cellOf };
  return tin._index;
}

/** The surface height at a local (x, y): barycentric on its triangle, or null off the TIN. */
export function tinHeightAt(tin, x, y) {
  const idx = tinIndex(tin);
  const [ci, cj] = idx.cellOf(x, y);
  const list = idx.buckets[cj * idx.across + ci];
  const { xs, ys, z, tris } = tin;
  const eps = 1e-9;
  for (let k = 0; k < list.length; k += 1) {
    const [a, b, c] = tris[list[k]];
    const d = (ys[b] - ys[c]) * (xs[a] - xs[c]) + (xs[c] - xs[b]) * (ys[a] - ys[c]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((ys[b] - ys[c]) * (x - xs[c]) + (xs[c] - xs[b]) * (y - ys[c])) / d;
    const l2 = ((ys[c] - ys[a]) * (x - xs[c]) + (xs[a] - xs[c]) * (y - ys[c])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 >= -eps && l2 >= -eps && l3 >= -eps) return l1 * z[a] + l2 * z[b] + l3 * z[c];
  }
  return null;
}

/* ── STL ─────────────────────────────────────────────────────────────────── */

function nodeOf(tin, i) {
  return [tin.xs[i], tin.ys[i], tin.z[i]];
}

/** The terrain skin alone. */
export function tinSurfaceStl(tin, name = "geoid_surface") {
  const out = [`solid ${name}`];
  const tri = triangleWriter(out, [0, 0, 1]);
  tin.tris.forEach(([a, b, c]) => tri(nodeOf(tin, a), nodeOf(tin, b), nodeOf(tin, c)));
  out.push(`endsolid ${name}`);
  return `${out.join("\n")}\n`;
}

/**
 * A closed shell from the TIN: the ground, skirt walls along its rim, and a
 * flat lid — a BASE below it (`belowM` down from the lowest node) or a SKY
 * above it (`aboveM` up from the highest). The lid is a fan from its own
 * centre to the rim nodes, so every lid edge matches exactly one wall edge:
 * the grid shell's own rule against T-junctions.
 */
/**
 * The facets of a closed shell — ground, skirt walls along the rim, a flat
 * lid — as triangles with the outward hint each was written with. One
 * generator feeds both the STL writer and the Meshing Studio's display, so the
 * shell a reader meshes is the shell they looked at.
 */
export function shellFacets(tin, { belowM = null, aboveM = null } = {}) {
  const up = aboveM !== null && aboveM !== undefined;
  const lidZ = up ? tin.zMax + Math.max(Number(aboveM), 1) : tin.zMin - Math.max(Number(belowM), 1);
  const facets = [];
  const groundHint = up ? [0, 0, -1] : [0, 0, 1];
  tin.tris.forEach(([a, b, c]) => facets.push({ a: nodeOf(tin, a), b: nodeOf(tin, b), c: nodeOf(tin, c), hint: groundHint, face: "ground" }));
  const loop = tin.loop;
  let cx = 0; let cy = 0;
  loop.forEach((i) => { cx += tin.xs[i]; cy += tin.ys[i]; });
  cx /= loop.length; cy /= loop.length;
  const centre = [cx, cy, lidZ];
  const lidHint = up ? [0, 0, 1] : [0, 0, -1];
  for (let k = 0; k < loop.length; k += 1) {
    const i0 = loop[k];
    const i1 = loop[(k + 1) % loop.length];
    const p = [tin.xs[i0], tin.ys[i0], lidZ];
    const q = [tin.xs[i1], tin.ys[i1], lidZ];
    // The lid is a FAN from its own centre, so every lid edge on the rim
    // matches exactly one wall edge -- no T-junction for a mesher to trip on.
    facets.push({ a: centre, b: p, c: q, hint: lidHint, face: "lid" });
    const t0 = nodeOf(tin, i0);
    const t1 = nodeOf(tin, i1);
    const wallHint = [q[1] - p[1], -(q[0] - p[0]), 0];
    facets.push({ a: p, b: q, c: t1, hint: wallHint, face: "wall" });
    facets.push({ a: p, b: t1, c: t0, hint: wallHint, face: "wall" });
  }
  return { facets, lidZ, up };
}

/**
 * A closed shell from the TIN as STL: a BASE below it (`belowM` down from
 * the lowest node) or a SKY above it (`aboveM` up from the highest).
 */
export function tinShellStl(tin, { belowM = null, aboveM = null, name = "geoid_domain" } = {}) {
  const { facets, lidZ, up } = shellFacets(tin, { belowM, aboveM });
  const out = [`solid ${name}`];
  facets.forEach((fct) => triangleWriter(out, fct.hint)(fct.a, fct.b, fct.c));
  out.push(`endsolid ${name}`);
  return up ? { text: `${out.join("\n")}\n`, skyZ: lidZ } : { text: `${out.join("\n")}\n`, baseZ: lidZ };
}

/** The ground alone -- the surface STL's own triangles -- as xyz triples. */
export function surfacePositions(tin, scale = 1) {
  const out = new Float32Array(tin.tris.length * 9);
  tin.tris.forEach(([a, b, c], k) => {
    [a, b, c].forEach((i, m) => {
      out[k * 9 + m * 3] = tin.xs[i] * scale;
      out[k * 9 + m * 3 + 1] = tin.ys[i] * scale;
      out[k * 9 + m * 3 + 2] = tin.z[i] * scale;
    });
  });
  return out;
}

/** The shell's facets flattened to xyz triples, in the units asked for. */
export function shellPositions(tin, opts, scale = 1, keep = null) {
  const all = shellFacets(tin, opts).facets;
  const facets = keep ? all.filter(keep) : all;
  const out = new Float32Array(facets.length * 9);
  facets.forEach((fct, k) => {
    [fct.a, fct.b, fct.c].forEach((v, m) => {
      out[k * 9 + m * 3] = v[0] * scale;
      out[k * 9 + m * 3 + 1] = v[1] * scale;
      out[k * 9 + m * 3 + 2] = v[2] * scale;
    });
  });
  return out;
}

/**
 * A regular grid in the TIN's shape, so the extend-boundary preview, the
 * studio hand-off and the point interpolation read one kind of surface:
 * per-node arrays, the perimeter as a counter-clockwise loop, and the two
 * triangles per cell.
 */
export function gridAsTin(grid) {
  const { nx, ny } = grid;
  const n = nx * ny;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      xs[j * nx + i] = grid.xs[i];
      ys[j * nx + i] = grid.ys[j];
      lats[j * nx + i] = grid.lats[j];
      lons[j * nx + i] = grid.lons[i];
    }
  }
  const tris = [];
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i; const b = a + 1; const c = a + nx + 1; const d = a + nx;
      tris.push([a, b, c], [a, c, d]);
    }
  }
  const loop = [];
  for (let i = 0; i < nx; i += 1) loop.push(i);
  for (let j = 1; j < ny; j += 1) loop.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i -= 1) loop.push((ny - 1) * nx + i);
  for (let j = ny - 2; j >= 1; j -= 1) loop.push(j * nx);
  return {
    kind: "grid", ok: true, xs, ys, z: grid.z, lats, lons, tris, loop, loops: 1,
    frame: grid.frame, origin: grid.origin, bounds: grid.bounds,
    x0: grid.xs[0], y0: grid.ys[0], widthM: grid.widthM, heightM: grid.heightM,
    nodes: n, triangles: tris.length, zMin: grid.zMin, zMax: grid.zMax, reliefM: grid.reliefM,
    spacingMinM: Math.min(grid.stepXm, grid.stepYm), spacingMaxM: Math.max(grid.stepXm, grid.stepYm),
    spacingOf: null,
  };
}

/* ── The size field over a TIN ───────────────────────────────────────────── */

/**
 * The slope-graded field on a lattice laid over the TIN, taken to the MINIMUM
 * with the sampling spacing: a buffer the reader drew fine stays fine in the
 * volume mesh, and a slope the DEM shows steep is refined whether or not it
 * is in a buffer.
 */
export function samplingSizeField(tin, {
  coarseM, fineM, slopeRefDeg = 30, nx = 96, ny = 96,
} = {}) {
  const grid = tinToGrid(tin, { nx, ny });
  const field = sizeField(grid, { coarseM, fineM, slopeRefDeg });
  if (!field) return null;
  let min = Infinity; let max = -Infinity;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const s = tin.spacingOf ? tin.spacingOf(grid.xs[i], grid.ys[j]) : Infinity;
      const v = Math.min(field.values[j * nx + i], s);
      field.values[j * nx + i] = v;
      if (v < min) min = v; if (v > max) max = v;
    }
  }
  field.minM = min; field.maxM = max;
  return field;
}

/** The TIN resampled onto a lattice, in the shape `sizeField` reads. */
export function tinToGrid(tin, { nx = 96, ny = 96 } = {}) {
  const xs = new Float64Array(nx);
  const ys = new Float64Array(ny);
  for (let i = 0; i < nx; i += 1) xs[i] = tin.x0 + (tin.widthM * i) / (nx - 1);
  for (let j = 0; j < ny; j += 1) ys[j] = tin.y0 + (tin.heightM * j) / (ny - 1);
  const z = new Float64Array(nx * ny);
  const mean = (tin.zMin + tin.zMax) / 2;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const v = tinHeightAt(tin, xs[i], ys[j]);
      z[j * nx + i] = Number.isFinite(v) ? v : mean;
    }
  }
  // Enough of a grid for `gridAsTin` to read it back as a surface: a coarse
  // stand-in for DISPLAY, where the studio draws a 95,000-triangle TIN three
  // times over and a software renderer pays for every one.
  const lats = new Float64Array(ny);
  const lons = new Float64Array(nx);
  if (tin.frame) {
    for (let j = 0; j < ny; j += 1) lats[j] = tin.frame.fromLocal(0, ys[j]).lat;
    for (let i = 0; i < nx; i += 1) lons[i] = tin.frame.fromLocal(xs[i], 0).lon;
  }
  return {
    ok: true, nx, ny, xs, ys, z, lats, lons, zMin: tin.zMin, zMax: tin.zMax, reliefM: tin.zMax - tin.zMin,
    frame: tin.frame, origin: tin.origin, bounds: tin.bounds, widthM: tin.widthM, heightM: tin.heightM,
    stepM: Math.max(tin.widthM / (nx - 1), tin.heightM / (ny - 1)),
    stepXm: tin.widthM / (nx - 1), stepYm: tin.heightM / (ny - 1),
  };
}

/* ── Extending the boundary ──────────────────────────────────────────────── */

/**
 * etna.py's `outer_box`, as a decision rather than as geometry: the rim's four
 * corner points carried DOWN to a base and UP to a sky. What comes back is the
 * two z levels and the corners, which is what the preview draws, what the
 * shells are closed at, and what the gmsh script's own `outer_box(z_bd, h)`
 * is handed.
 */
export function extendBoundary(tin, { belowM = 0, aboveM = 0 } = {}) {
  const loop = tin.loop || [];
  if (!loop.length) return null;
  const pick = (score) => loop.reduce((best, i) => (score(i) > score(best) ? i : best), loop[0]);
  const corners = [
    pick((i) => -tin.xs[i] - tin.ys[i]), // SW
    pick((i) => tin.xs[i] - tin.ys[i]),  // SE
    pick((i) => tin.xs[i] + tin.ys[i]),  // NE
    pick((i) => -tin.xs[i] + tin.ys[i]), // NW
  ].map((i) => ({ i, x: tin.xs[i], y: tin.ys[i], z: tin.z[i], lat: tin.lats[i], lon: tin.lons[i] }));
  const baseZ = Number(belowM) > 0 ? tin.zMin - Number(belowM) : null;
  const skyZ = Number(aboveM) > 0 ? tin.zMax + Number(aboveM) : null;
  return { corners, baseZ, skyZ, belowM: Number(belowM) || 0, aboveM: Number(aboveM) || 0 };
}

/**
 * The extended boundary as line segments in local metres, for a preview: the
 * rim at the lid level, and the four corner verticals — the same points and
 * lines etna's `outer_box` adds.
 */
export function extendedBoundaryLines(tin, ext) {
  const out = [];
  if (!ext) return out;
  const levels = [];
  if (ext.baseZ !== null) levels.push(ext.baseZ);
  if (ext.skyZ !== null) levels.push(ext.skyZ);
  levels.forEach((zl) => {
    ext.corners.forEach((c, k) => {
      const d = ext.corners[(k + 1) % 4];
      out.push([[c.x, c.y, zl], [d.x, d.y, zl]]);
      out.push([[c.x, c.y, c.z], [c.x, c.y, zl]]);
    });
  });
  return out;
}
