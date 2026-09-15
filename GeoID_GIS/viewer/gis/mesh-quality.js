/**
 * MESH QUALITY, element by element — the checks a solver's convergence
 * depends on, so they are read before a solve rather than diagnosed after one.
 *
 * Pure: coordinates and connectivity in, typed arrays out. It serves both
 * meshes the Model page holds: the studio's own tetrahedra, and a GALES mesh
 * opened in Results (tetrahedra in 3D, triangles in 2D).
 *
 * Every metric is one of the standard, citable ones (gmsh's `Plugin(AnalyseMesh)`,
 * ANSYS and COMSOL quality reports use the same families), normalised so that
 * the regular element scores its ideal value, and each carries the direction
 * in which it gets worse and a threshold with the reason for it. Nothing here
 * decides a mesh is "good": it counts what falls past a threshold the reader
 * can move, and says where the worst elements are.
 */

const RAD = 180 / Math.PI;

/**
 * The metrics, with what a reader needs to act on them. `worse` is the
 * direction of trouble; `poor` the default threshold past which an element is
 * counted; `range` the axis the histogram is drawn on.
 */
export const METRICS = {
  gamma: {
    label: "Shape quality (γ)", dims: [2, 3], ideal: 1, worse: "low", poor: 0.2, range: [0, 1],
    says: "Normalised volume over the cube of the RMS edge (triangles: 4√3·area / Σ edge²). 1 is a regular element, 0 a flat one. Below about 0.2 the stiffness matrix degrades and iterative solvers slow down.",
  },
  radiusRatio: {
    label: "Radius ratio", dims: [2, 3], ideal: 1, worse: "low", poor: 0.1, range: [0, 1],
    says: "Inscribed over circumscribed radius, scaled so a regular element is 1 (3r/R for a tetrahedron, 2r/R for a triangle). Catches slivers that γ can miss.",
  },
  aspect: {
    label: "Edge aspect ratio", dims: [2, 3], ideal: 1, worse: "high", poor: 10, range: [1, 50], log: true,
    says: "Longest edge over shortest. Stretched elements are fine along a boundary layer that is meant to be stretched and trouble anywhere else; past about 10 check where they are.",
  },
  minAngle: {
    label: "Minimum angle", dims: [2, 3], ideal: 70.53, worse: "low", poor: 10, range: [0, 90], unit: "°",
    says: "Smallest dihedral angle of a tetrahedron (70.53° when regular), or smallest corner angle of a triangle (60°). Very small angles make ill-conditioned element matrices; under 10° is a common rejection limit.",
  },
  maxAngle: {
    label: "Maximum angle", dims: [2, 3], ideal: 70.53, worse: "high", poor: 160, range: [0, 180], unit: "°",
    says: "Largest dihedral (triangles: corner) angle. Angles near 180° flatten the element and spoil gradient accuracy more than small angles do.",
  },
  size: {
    label: "Element size", dims: [2, 3], ideal: null, worse: "high", poor: null, range: null, log: true, unit: "m",
    says: "Mean edge length. Not a quality — a map of where the mesh is fine and coarse, so a refinement can be checked against where it was asked for.",
  },
};

const sub = (c, i, j) => [c[j * 3] - c[i * 3], c[j * 3 + 1] - c[i * 3 + 1], c[j * 3 + 2] - c[i * 3 + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));

/**
 * The elements of a mesh as flat connectivity and a node count per element.
 * Accepts the studio's { nodes, tets } or a GALES mesh { coords, cells,
 * cellOffsets, dim }; mixed cells are kept only where they match the
 * dimension (a 3D GALES mesh's triangles are its boundary, not elements).
 */
export function elementsOf(mesh) {
  if (!mesh) return null;
  if (mesh.tets && mesh.nodes) {
    return { coords: mesh.nodes, conn: mesh.tets instanceof Uint32Array ? mesh.tets : Uint32Array.from(mesh.tets), per: 4, dim: 3 };
  }
  if (mesh.cells && mesh.cellOffsets && mesh.coords) {
    const dim = mesh.dim === 2 ? 2 : 3;
    const per = dim === 3 ? 4 : 3;
    const count = mesh.cellOffsets.length - 1;
    let n = 0;
    for (let c = 0; c < count; c += 1) if (mesh.cellOffsets[c + 1] - mesh.cellOffsets[c] === per) n += 1;
    const conn = new Uint32Array(n * per);
    const source = new Uint32Array(n);
    let k = 0;
    for (let c = 0; c < count; c += 1) {
      const s = mesh.cellOffsets[c];
      if (mesh.cellOffsets[c + 1] - s !== per) continue;
      for (let j = 0; j < per; j += 1) conn[k * per + j] = mesh.cells[s + j];
      source[k] = c;
      k += 1;
    }
    let coords = mesh.coords;
    if (dim === 2 && coords.length === mesh.nodeCount * 2) {
      coords = new Float64Array(mesh.nodeCount * 3);
      for (let i = 0; i < mesh.nodeCount; i += 1) { coords[i * 3] = mesh.coords[i * 2]; coords[i * 3 + 1] = mesh.coords[i * 2 + 1]; }
    }
    return { coords, conn, per, dim, source };
  }
  return null;
}

/** One tetrahedron's metrics. Exported for the tests. */
export function tetMetrics(c, a, b, cc, d) {
  const u = sub(c, a, b), v = sub(c, a, cc), w = sub(c, a, d);
  const triple = dot(u, cross(v, w));
  const volume = triple / 6;
  const edges = [u, v, w, sub(c, b, cc), sub(c, b, d), sub(c, cc, d)].map(len);
  let sumSq = 0; let lo = Infinity; let hi = 0; let sum = 0;
  for (const e of edges) { sumSq += e * e; if (e < lo) lo = e; if (e > hi) hi = e; sum += e; }
  const rms = Math.sqrt(sumSq / 6);
  const gamma = rms > 0 ? Math.min(1, (6 * Math.SQRT2 * Math.abs(volume)) / rms ** 3) : 0;
  // Faces, outward: opposite each vertex.
  const P = [a, b, cc, d];
  const faces = [[1, 2, 3, 0], [0, 3, 2, 1], [0, 1, 3, 2], [0, 2, 1, 3]];
  const normals = [];
  let area = 0;
  for (const [i, j, k, opp] of faces) {
    let n = cross(sub(c, P[i], P[j]), sub(c, P[i], P[k]));
    const l = len(n);
    area += l / 2;
    if (l > 0) {
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (dot(n, sub(c, P[i], P[opp])) > 0) n = [-n[0], -n[1], -n[2]];
    }
    normals.push(n);
  }
  let minA = 180; let maxA = 0;
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const cos = Math.max(-1, Math.min(1, dot(normals[i], normals[j])));
      const dihedral = 180 - Math.acos(cos) * RAD;
      if (dihedral < minA) minA = dihedral;
      if (dihedral > maxA) maxA = dihedral;
    }
  }
  // The circumcentre offset: (|u|²(v×w) + |v|²(w×u) + |w|²(u×v)) / (2 u·(v×w)).
  const vw = cross(v, w), wu = cross(w, u), uv = cross(u, v);
  const uu = dot(u, u), vv = dot(v, v), ww = dot(w, w);
  const circum = [0, 1, 2].map((i) => uu * vw[i] + vv * wu[i] + ww * uv[i]);
  const R = Math.abs(triple) > 0 ? len(circum) / (2 * Math.abs(triple)) : Infinity;
  const r = area > 0 ? (3 * Math.abs(volume)) / area : 0;
  const radiusRatio = Number.isFinite(R) && R > 0 ? Math.min(1, (3 * r) / R) : 0;
  return { gamma, radiusRatio, aspect: lo > 0 ? hi / lo : Infinity, minAngle: minA, maxAngle: maxA, size: sum / 6, volume };
}

/** One triangle's metrics (2D elements, in the xy plane or anywhere). */
export function triMetrics(c, a, b, cc) {
  const u = sub(c, a, b), v = sub(c, a, cc), w = sub(c, b, cc);
  const n = cross(u, v);
  const area = len(n) / 2;
  const signed = n[2] / 2;
  const la = len(u), lb = len(v), lc = len(w);
  const sumSq = la * la + lb * lb + lc * lc;
  const gamma = sumSq > 0 ? Math.min(1, (4 * Math.sqrt(3) * area) / sumSq) : 0;
  const R = area > 0 ? (la * lb * lc) / (4 * area) : Infinity;
  const r = area > 0 ? (2 * area) / (la + lb + lc) : 0;
  const angle = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - z * z) / (2 * x * y || 1)))) * RAD;
  const angles = [angle(la, lb, lc), angle(la, lc, lb), angle(lb, lc, la)];
  const lo = Math.min(la, lb, lc); const hi = Math.max(la, lb, lc);
  return { gamma, radiusRatio: Number.isFinite(R) && R > 0 ? Math.min(1, (2 * r) / R) : 0, aspect: lo > 0 ? hi / lo : Infinity, minAngle: Math.min(...angles), maxAngle: Math.max(...angles), size: (la + lb + lc) / 3, volume: signed || area };
}

/**
 * EVERY ELEMENT'S METRICS, as typed arrays, plus how many are inverted.
 * A tetrahedron is inverted when its signed volume is negative relative to
 * the mesh's dominant orientation — a mesher writes one orientation, so the
 * minority sign is the fault, whichever sign the file uses.
 */
export function analyseMesh(mesh) {
  const E = elementsOf(mesh);
  if (!E || !E.conn.length) return null;
  const n = E.conn.length / E.per;
  const out = {};
  for (const key of Object.keys(METRICS)) out[key] = new Float32Array(n);
  const signs = new Int8Array(n);
  let positive = 0;
  for (let e = 0; e < n; e += 1) {
    const i = e * E.per;
    const m = E.per === 4
      ? tetMetrics(E.coords, E.conn[i], E.conn[i + 1], E.conn[i + 2], E.conn[i + 3])
      : triMetrics(E.coords, E.conn[i], E.conn[i + 1], E.conn[i + 2]);
    for (const key of Object.keys(METRICS)) out[key][e] = m[key];
    signs[e] = m.volume > 0 ? 1 : m.volume < 0 ? -1 : 0;
    if (signs[e] > 0) positive += 1;
  }
  const dominant = positive >= n / 2 ? 1 : -1;
  let inverted = 0; let degenerate = 0;
  for (let e = 0; e < n; e += 1) { if (signs[e] === 0) degenerate += 1; else if (signs[e] !== dominant) inverted += 1; }
  return { count: n, dim: E.dim, per: E.per, metrics: out, inverted, degenerate, elements: E };
}

/**
 * A metric summarised against a threshold: the statistics, how many elements
 * are past it, a histogram on the metric's own axis, and the worst elements
 * (index into the analysed elements) in order.
 */
export function summarise(analysis, key, { threshold = METRICS[key]?.poor, bins = 24, worst = 12 } = {}) {
  const spec = METRICS[key];
  const values = analysis.metrics[key];
  const n = values.length;
  const finite = [];
  for (let e = 0; e < n; e += 1) if (Number.isFinite(values[e])) finite.push(values[e]);
  const sorted = Float32Array.from(finite).sort();
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : NaN);
  let sum = 0;
  for (const v of sorted) sum += v;
  let lo = spec.range ? spec.range[0] : sorted[0];
  let hi = spec.range ? spec.range[1] : sorted[sorted.length - 1];
  if (spec.log && !(lo > 0)) lo = Math.max(1e-9, sorted[0] || 1e-9);
  if (!(hi > lo)) hi = lo + 1;
  const toBin = spec.log
    ? (v) => Math.floor(((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * bins)
    : (v) => Math.floor(((v - lo) / (hi - lo)) * bins);
  const histogram = new Array(bins).fill(0);
  for (let e = 0; e < n; e += 1) {
    const v = values[e];
    const b = Number.isFinite(v) ? Math.max(0, Math.min(bins - 1, toBin(v))) : (spec.worse === "high" ? bins - 1 : 0);
    histogram[b] += 1;
  }
  const past = (v) => Number.isFinite(threshold) && (spec.worse === "low" ? !(v >= threshold) : !(v <= threshold));
  let poor = 0;
  const bad = [];
  for (let e = 0; e < n; e += 1) if (past(values[e])) { poor += 1; bad.push(e); }
  const rank = (e) => (Number.isFinite(values[e]) ? values[e] : spec.worse === "low" ? -Infinity : Infinity);
  const order = [...(bad.length ? bad : Array.from({ length: n }, (_, i) => i))];
  order.sort((x, y) => (spec.worse === "low" ? rank(x) - rank(y) : rank(y) - rank(x)));
  return {
    key, label: spec.label, unit: spec.unit || "", threshold, count: n, poor,
    min: sorted[0], max: sorted[sorted.length - 1], mean: sorted.length ? sum / sorted.length : NaN,
    median: at(0.5), p5: at(0.05), p95: at(0.95),
    histogram, axis: { lo, hi, log: Boolean(spec.log) },
    worst: order.slice(0, worst),
    past,
  };
}

/** The one-line verdict a reader acts on, per metric, and for the whole mesh. */
export function verdict(analysis, summaries) {
  const lines = [];
  if (analysis.inverted) lines.push({ level: "error", text: `${analysis.inverted.toLocaleString()} inverted element${analysis.inverted === 1 ? "" : "s"}: the solver will fail or return nonsense. Remesh.` });
  if (analysis.degenerate) lines.push({ level: "error", text: `${analysis.degenerate.toLocaleString()} element${analysis.degenerate === 1 ? " has" : "s have"} zero volume.` });
  for (const s of summaries) {
    if (!Number.isFinite(s.threshold) || !s.poor) continue;
    const share = s.poor / s.count;
    lines.push({ level: share > 0.01 ? "warning" : "note", text: `${s.poor.toLocaleString()} element${s.poor === 1 ? "" : "s"} (${(share * 100).toFixed(share < 0.001 ? 3 : 1)}%) past ${s.label.toLowerCase()} ${s.threshold}${s.unit}.` });
  }
  if (!lines.length) lines.push({ level: "ok", text: "No element is past any threshold." });
  return lines;
}

/**
 * The faces of chosen elements, as triangle positions in the mesh's own
 * coordinates — what the page draws to show where they are.
 */
export function elementFaces(elements, which) {
  const { coords, conn, per } = elements;
  const faces = per === 4 ? [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] : [[0, 1, 2]];
  const out = new Float32Array(which.length * faces.length * 9);
  let k = 0;
  for (const e of which) {
    const base = e * per;
    for (const f of faces) {
      for (const v of f) {
        const node = conn[base + v];
        out[k] = coords[node * 3]; out[k + 1] = coords[node * 3 + 1]; out[k + 2] = coords[node * 3 + 2];
        k += 3;
      }
    }
  }
  return out;
}

/** The centroid of one element. */
export function elementCentroid(elements, e) {
  const { coords, conn, per } = elements;
  const p = [0, 0, 0];
  for (let j = 0; j < per; j += 1) {
    const node = conn[e * per + j];
    p[0] += coords[node * 3] / per; p[1] += coords[node * 3 + 1] / per; p[2] += coords[node * 3 + 2] / per;
  }
  return p;
}
