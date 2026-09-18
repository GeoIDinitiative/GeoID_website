/**
 * FAULT PLANES from lines: a drawn line or a polyline shapefile becomes a
 * surface in the solid domain, with its own physical flag.
 *
 * A fault in a finite-element model of the ground is a SURFACE the mesh must
 * conform to -- a set of faces inside the volume that a solver can address by
 * their flag (nodes held, a contact, a slip). The Model Builder had no way to
 * put one in: the domain was a block whose only internal geometry was the
 * embedded points. This module is the geometry half, pure and tested against
 * closed forms; `model-pipeline.js` reads the lines and draws the controls,
 * `model-build.js` embeds what this emits into the gmsh script.
 *
 * WHAT A FAULT IS HERE. Its TRACE is the line on the ground -- every vertex
 * at the surface's own interpolated height. Its STRIKE is the trace's own
 * bearing, so it is computed rather than typed: a line has a direction. Its
 * DIP is the angle below horizontal the plane descends at, to the RIGHT or
 * the LEFT of the trace walked from its first vertex to its last (the
 * right-hand rule, said in the card as a compass direction). Its DEPTH is
 * the vertical extent below the trace's lowest point, so the bottom edge is
 * one elevation and the plane through a straight trace is a true plane.
 *
 * WHY THE TOP EDGE SITS A LITTLE UNDER THE GROUND. gmsh embeds a surface in
 * a volume on the condition that it lies inside it and does not touch its
 * boundary; a plane whose top edge IS the terrain is on the boundary, and
 * the built-in kernel refuses it. The top edge is therefore the trace
 * dropped by `topOffsetM` -- a few metres, the card says how many -- and the
 * plane is kept a margin clear of the walls and the base for the same reason:
 * a depth that would reach the base is CAPPED and reported, a trace that
 * leaves the footprint is CLIPPED to it, and a bottom edge that would run out
 * through a wall shortens the plane until it does not. A fault that reaches
 * the surface exactly would need the terrain triangulated along its trace,
 * which the STL path does not do; the offset is stated rather than hidden.
 *
 * WHY TRIANGLES, NOT ONE PLANE. A polyline's bends make a folded surface,
 * and its down-dip edges at a bend are MITRED -- the bottom vertex of a bend
 * sits along the bisector of the two segments' dip directions, scaled so the
 * plane keeps its horizontal reach on both sides -- so adjacent panels share
 * an edge and the surface is continuous. Each panel is two triangles, and a
 * triangle is planar by definition, which is what `addPlaneSurface` needs;
 * a bent quad is not.
 */

/** Below this dip a "fault" is a bedding plane, and a plane that flat is a layer. */
export const MIN_DIP_DEG = 5;
/** Where the flags for faults start when nobody chose one: 30, 31, 32 ... */
export const FAULT_FLAG_BASE = 30;

export const DEFAULT_FAULT = Object.freeze({
  dipDeg: 60,
  side: "right",     // "right" | "left" of the trace, walked first vertex to last
  depthM: 2000,      // vertical extent below the trace's lowest point
  topOffsetM: null,  // null: a fraction of the element size, never zero
  sizeM: null,       // element size at the plane; null: half the coarse size
  flag: null,        // null: FAULT_FLAG_BASE + the fault's index
  on: true,
});

/**
 * The lines of a feature collection, one entry per LineString and one per
 * PART of a MultiLineString (a fault with two strands is two faults).
 * Coordinates are [lon, lat] as the file has them.
 */
export function linesFromCollection(fc) {
  const out = [];
  (fc?.features || []).forEach((f, index) => {
    const g = f?.geometry;
    if (!g) return;
    // GEM's catalogue names few of its faults and numbers all of them
    // (catalog_id "ME_TRCS009"); a catalogue's own id beats "line 8842".
    const base = String(f.properties?.name || f.properties?.NAME || f.properties?.Name || f.properties?.fs_name || f.properties?.fault
      || f.properties?.catalog_id || f.properties?.id || `line ${index + 1}`);
    const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    parts.forEach((coords, part) => {
      const clean = (coords || []).filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
        .map((c) => [Number(c[0]), Number(c[1])]);
      if (clean.length < 2) return;
      out.push({
        key: `${index}:${part}`,
        index, part,
        name: parts.length > 1 ? `${base} (part ${part + 1})` : base,
        coords: clean,
        properties: f.properties || {},
      });
    });
  });
  return out;
}

/** Whether a layer holds any line at all, which is what makes the role worth offering. */
export function hasLines(fc) {
  return (fc?.features || []).some((f) => f?.geometry?.type === "LineString" || f?.geometry?.type === "MultiLineString");
}

/** The bearing of a→b in local east/north metres: degrees clockwise from north, 0..360. */
export function bearingDeg(a, b) {
  const d = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** A polyline's length in the plane, metres. */
export function traceLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/**
 * Douglas–Peucker in the plane. A digitised fault trace can carry a vertex
 * every few metres, and each one becomes an edge the mesh must honour;
 * simplified to a fraction of the element size the surface keeps its shape
 * and loses the noise. The first and last vertices always survive.
 */
export function simplifyTrace(pts, tolM) {
  if (!(tolM > 0) || pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    const a = pts[i0]; const b = pts[i1];
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let worst = -1; let at = -1;
    for (let i = i0 + 1; i < i1; i += 1) {
      const p = pts[i];
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolM) { keep[at] = 1; stack.push([i0, at], [at, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * The parts of a polyline inside a box (Liang–Barsky per segment, pieces
 * joined where consecutive). A trace that leaves the footprint and comes
 * back is two faults; the caller names them.
 */
export function clipTraceToBox(pts, box) {
  const pieces = [];
  let current = null;
  const inside = (p) => p[0] >= box.xMin - 1e-9 && p[0] <= box.xMax + 1e-9 && p[1] >= box.yMin - 1e-9 && p[1] <= box.yMax + 1e-9;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]; const b = pts[i];
    const seg = clipSegment(a, b, box);
    if (!seg) { current = null; continue; }
    const [p, q] = seg;
    const startsFresh = !current || !inside(a) || Math.hypot(p[0] - current[current.length - 1][0], p[1] - current[current.length - 1][1]) > 1e-6;
    if (startsFresh) { current = [p]; pieces.push(current); }
    current.push(q);
    if (!inside(b)) current = null;
  }
  return pieces.filter((piece) => traceLength(piece) > 1e-6);
}

function clipSegment(a, b, box) {
  let t0 = 0; let t1 = 1;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const tests = [[-dx, a[0] - box.xMin], [dx, box.xMax - a[0]], [-dy, a[1] - box.yMin], [dy, box.yMax - a[1]]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/** Unit perpendicular to a→b on the dip side: right of travel is (dy, −dx). */
function sideNormal(a, b, side) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const r = [dy / len, -dx / len];
  return side === "left" ? [-r[0], -r[1]] : r;
}

/**
 * The dip-side direction at every vertex: the segment's own normal at the
 * ends, the MITRE of the two neighbours at a bend, scaled by 1/cos(θ/2) so
 * the bottom edge stays the plane's horizontal reach from each segment.
 * Capped at twice the reach, or a hairpin throws its corner to infinity.
 */
export function mitreNormals(pts, side) {
  const n = pts.length;
  const segs = [];
  for (let i = 1; i < n; i += 1) segs.push(sideNormal(pts[i - 1], pts[i], side));
  return pts.map((_, i) => {
    if (i === 0) return segs[0];
    if (i === n - 1) return segs[n - 2];
    const p = segs[i - 1]; const q = segs[i];
    const sx = p[0] + q[0]; const sy = p[1] + q[1];
    const len = Math.hypot(sx, sy);
    if (len < 1e-9) return q;
    const bis = [sx / len, sy / len];
    const cosHalf = bis[0] * q[0] + bis[1] * q[1];
    const scale = Math.min(2, 1 / Math.max(cosHalf, 0.5));
    return [bis[0] * scale, bis[1] * scale];
  });
}

/**
 * THE PLANE. `trace` is the line in local metres, `groundAt(x, y)` the
 * surface's height there (null off the surface). Returns the points, the
 * triangles over them, the edges for a preview, the two polylines, and what
 * was done to keep the plane inside the domain: `box` is the footprint the
 * plane must stay `marginM` clear of, `baseZ` the elevation of the domain's
 * base it must stay `marginM` above.
 */
export function faultPlane({
  trace, groundAt, dipDeg = 60, side = "right", depthM = 2000, topOffsetM = 5,
  box = null, baseZ = null, marginM = 10, simplifyM = 0,
} = {}) {
  const notes = [];
  const dip = Math.max(MIN_DIP_DEG, Math.min(90, Number(dipDeg) || 60));
  if (Number(dipDeg) < MIN_DIP_DEG) notes.push(`dip raised to ${MIN_DIP_DEG}°: a plane that flat is a layer, not a fault`);
  const offset = Math.max(0.5, Number(topOffsetM) || 0.5);
  const inner = box ? { xMin: box.xMin + marginM, xMax: box.xMax - marginM, yMin: box.yMin + marginM, yMax: box.yMax - marginM } : null;
  let pts = (trace || []).map((p) => [Number(p[0]), Number(p[1])]);
  if (simplifyM > 0) pts = simplifyTrace(pts, simplifyM);
  let clipped = false;
  if (inner) {
    const pieces = clipTraceToBox(pts, inner);
    if (!pieces.length) return { ok: false, message: "the whole trace lies outside the domain", notes };
    if (pieces.length > 1 || pieces[0].length !== pts.length || pieces[0].some((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) > 1e-6)) clipped = true;
    // The longest piece is the fault; the rest is what left the footprint.
    pts = pieces.reduce((best, piece) => (traceLength(piece) > traceLength(best) ? piece : best), pieces[0]);
    if (pieces.length > 1) notes.push(`the trace leaves the footprint and returns: only its longest piece inside is used`);
    else if (clipped) notes.push("the trace is clipped to the footprint");
  }
  if (pts.length < 2) return { ok: false, message: "the trace has fewer than two points inside the domain", notes };
  const top = [];
  for (const [x, y] of pts) {
    const g = groundAt(x, y);
    if (!Number.isFinite(g)) return { ok: false, message: "the surface has no height under part of the trace", notes };
    top.push([x, y, g - offset]);
  }
  const zTopMin = Math.min(...top.map((p) => p[2]));
  let zBottom = zTopMin - Math.max(1, Number(depthM) || 1);
  let capped = null;
  if (Number.isFinite(baseZ) && zBottom < baseZ + marginM) {
    zBottom = baseZ + marginM;
    capped = zTopMin - zBottom;
    notes.push(`depth capped at ${Math.round(capped)} m so the plane stays above the base`);
  }
  const vertical = dip >= 89.999;
  const reachPerMetre = vertical ? 0 : 1 / Math.tan((dip * Math.PI) / 180);
  const normals = mitreNormals(pts, side);
  // A bottom corner that would leave the footprint shortens the plane: raise
  // the bottom to where every corner's reach stays inside.
  if (inner && !vertical) {
    for (let i = 0; i < top.length; i += 1) {
      const [nx, ny] = normals[i];
      const drop = top[i][2] - zBottom;
      const reach = drop * reachPerMetre;
      const bx = top[i][0] + nx * reach; const by = top[i][1] + ny * reach;
      if (bx < inner.xMin || bx > inner.xMax || by < inner.yMin || by > inner.yMax) {
        // The largest t in [0, 1] with the corner still inside: a ray against the box.
        let tMax = 1;
        if (nx > 0) tMax = Math.min(tMax, (inner.xMax - top[i][0]) / (nx * reach));
        if (nx < 0) tMax = Math.min(tMax, (inner.xMin - top[i][0]) / (nx * reach));
        if (ny > 0) tMax = Math.min(tMax, (inner.yMax - top[i][1]) / (ny * reach));
        if (ny < 0) tMax = Math.min(tMax, (inner.yMin - top[i][1]) / (ny * reach));
        tMax = Math.max(0, Math.min(1, tMax));
        const allowed = drop * tMax;
        const newBottom = top[i][2] - allowed;
        if (newBottom > zBottom) { zBottom = newBottom; capped = zTopMin - zBottom; }
      }
    }
    if (capped !== null && !notes.some((n) => /above the base/.test(n))) notes.push(`depth capped at ${Math.round(capped)} m so the plane stays inside the footprint`);
  }
  if (zTopMin - zBottom < 1) return { ok: false, message: "no room for the plane between the trace and the domain's edge", notes };
  const bottom = top.map((p, i) => {
    const drop = p[2] - zBottom;
    const reach = drop * reachPerMetre;
    return [p[0] + normals[i][0] * reach, p[1] + normals[i][1] * reach, zBottom];
  });
  const n = top.length;
  const points = [...top, ...bottom];
  const tris = [];
  for (let i = 0; i < n - 1; i += 1) {
    // Wound so the normal points to the dip side, consistently.
    tris.push([i, i + 1, n + i + 1], [i, n + i + 1, n + i]);
  }
  const edges = [];
  for (let i = 0; i < n - 1; i += 1) { edges.push([i, i + 1]); edges.push([n + i, n + i + 1]); }
  for (let i = 0; i < n; i += 1) edges.push([i, n + i]);
  const strike = bearingDeg(pts[0], pts[pts.length - 1]);
  const dipDirection = dipAzimuthDeg(strike, side);
  /**
   * THE DIP IS MEASURED ACROSS THE TRACE, and a trace that climbs makes the
   * plane steeper than that. The reach is set in the vertical section
   * perpendicular to each segment; where the trace itself rises at β along
   * the segment, the panel's true dip is atan(sqrt(tan²dip + tan²β)) -- at a
   * 60° dip and a 5° climb, 60.04°; at 45° and 45°, 54.7°. Reported beside
   * the dip asked for, so nobody reads a steep valley-side fault as 60°.
   */
  const trueDip = tris.reduce((worst, [a, b, c]) => Math.max(worst, triangleDipDeg(points[a], points[b], points[c])), 0);
  return {
    ok: true,
    points, tris, edges, top, bottom,
    dipDeg: dip, trueDipDeg: trueDip, side, dipDirectionDeg: dipDirection, compass: compassOf(dipDirection),
    strikeDeg: strike, lengthM: traceLength(pts), vertices: n,
    zTopMin, zBottom, depthM: zTopMin - zBottom, topOffsetM: offset,
    areaM2: tris.reduce((s, t) => s + triangleArea(points[t[0]], points[t[1]], points[t[2]]), 0),
    capped, clipped, notes,
  };
}

/** The azimuth the plane dips towards: 90° right of the strike, or left. */
export function dipAzimuthDeg(strikeDeg, side) {
  const a = side === "left" ? strikeDeg - 90 : strikeDeg + 90;
  return ((a % 360) + 360) % 360;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function compassOf(azimuthDeg) {
  return POINTS[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];
}

function triangleArea(a, b, c) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** The dip a triangle actually has, for checking a built plane against what was asked. */
export function triangleDipDeg(a, b, c) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return (Math.acos(Math.min(1, Math.abs(nz) / len)) * 180) / Math.PI;
}

/**
 * WHAT A CATALOGUE ALREADY SAYS ABOUT A FAULT. GEM's Global Active Faults
 * carry a dip, the compass direction it dips towards and the depth the
 * seismicity reaches, as "(preferred,min,max)" tuples; a fault read from that
 * layer should open on the catalogue's own geometry rather than on 60 degrees
 * to the right, and the card says which it is. The SIDE is decided by which of
 * the two perpendiculars to the strike the stated dip direction lies nearer.
 */
const COMPASS_AZIMUTH = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

/** The preferred number out of "(40,30,50)", "40", 40 or "(,30,50)"; null where there is none. */
export function tupleFirst(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parts = String(value).replace(/[()\[\]]/g, "").split(",").map((t) => t.trim());
  for (const t of parts) { if (t !== "" && Number.isFinite(Number(t))) return Number(t); }
  return null;
}

export function faultDefaultsFrom(properties, strikeDeg) {
  const p = properties || {};
  const out = { from: [] };
  const dip = tupleFirst(p.average_dip ?? p.dip ?? p.DIP ?? p.Dip);
  if (dip !== null && dip > 0 && dip <= 90) { out.dipDeg = Math.max(MIN_DIP_DEG, dip); out.from.push("dip"); }
  const dir = String(p.dip_dir ?? p.dip_direction ?? p.DIP_DIR ?? "").trim().toUpperCase();
  const az = dir in COMPASS_AZIMUTH ? COMPASS_AZIMUTH[dir] : (dir !== "" && Number.isFinite(Number(dir)) ? Number(dir) : null);
  if (az !== null && Number.isFinite(strikeDeg)) {
    const off = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };
    out.side = off(az, strikeDeg + 90) <= off(az, strikeDeg - 90) ? "right" : "left";
    out.from.push("dip direction");
  }
  const lower = tupleFirst(p.lower_seis_depth ?? p.lower_depth);
  if (lower !== null && lower > 0) { out.depthM = lower * 1000; out.from.push("depth"); }
  return out;
}

/**
 * DO TWO FAULT SURFACES CROSS? gmsh refuses intersecting embedded surfaces --
 * not with a message about faults, but by failing to recover the boundary --
 * so the pair is found here and the second is left out BY NAME. An edge of
 * one triangle piercing the other (either way round) is a crossing; two
 * planes that merely share a vertex or an edge are touching, which is also
 * refused, so the test is inclusive of the boundary to a small tolerance.
 */
function segmentHitsTriangle(p, q, a, b, c, eps = 1e-9) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < eps) return false; // parallel to the plane: not a piercing
  const f = 1 / det;
  const s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < -1e-9 || u > 1 + 1e-9) return false;
  const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = f * (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]);
  if (v < -1e-9 || u + v > 1 + 1e-9) return false;
  const t = f * (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]);
  return t >= -1e-9 && t <= 1 + 1e-9;
}

function boxOf(points) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  points.forEach((p) => { for (let k = 0; k < 3; k += 1) { if (p[k] < b[k]) b[k] = p[k]; if (p[k] > b[k + 3]) b[k + 3] = p[k]; } });
  return b;
}

export function planesCross(a, b, clearM = 0) {
  const A = boxOf(a.points); const B = boxOf(b.points);
  for (let k = 0; k < 3; k += 1) { if (A[k] - clearM > B[k + 3] || B[k] - clearM > A[k + 3]) return false; }
  const edgesOf = (f) => f.tris.flatMap(([i, j, k]) => [[i, j], [j, k], [k, i]]);
  const pierces = (from, into) => edgesOf(from).some(([i, j]) => into.tris.some(([x, y, z]) =>
    segmentHitsTriangle(from.points[i], from.points[j], into.points[x], into.points[y], into.points[z])));
  return pierces(a, b) || pierces(b, a);
}

/**
 * Of a list of built planes, the ones that can all be embedded together: in
 * order, each kept unless it crosses one already kept. The caller's order is
 * the precedence (longest first is the sensible one), and `dropped` names the
 * fault left out and the one it crossed.
 */
export function nonCrossing(planes) {
  const kept = []; const dropped = [];
  planes.forEach((plane) => {
    const hit = kept.find((k) => planesCross(k, plane));
    if (hit) dropped.push({ name: plane.name, crosses: hit.name }); else kept.push(plane);
  });
  return { kept, dropped };
}

/** A multi-solid STL, one named solid per fault, in the model's own frame. */
export function faultsStl(faults, name = "geoid_faults") {
  const out = [];
  faults.forEach((fault) => {
    const solid = `${name}_${slug(fault.name)}`;
    out.push(`solid ${solid}`);
    fault.tris.forEach(([a, b, c]) => {
      const [p, q, r] = [fault.points[a], fault.points[b], fault.points[c]];
      const ux = q[0] - p[0]; const uy = q[1] - p[1]; const uz = q[2] - p[2];
      const vx = r[0] - p[0]; const vy = r[1] - p[1]; const vz = r[2] - p[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const len = Math.hypot(...n) || 1;
      out.push(`  facet normal ${(n[0] / len).toExponential(6)} ${(n[1] / len).toExponential(6)} ${(n[2] / len).toExponential(6)}`, "    outer loop");
      [p, q, r].forEach((v) => out.push(`      vertex ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`));
      out.push("    endloop", "  endfacet");
    });
    out.push(`endsolid ${solid}`);
  });
  return `${out.join("\n")}\n`;
}

export function slug(name) {
  return String(name || "fault").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "fault";
}

const PY = (v) => JSON.stringify(v).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");

/**
 * The gmsh half: every fault as points, lines and planar triangles in the
 * built-in kernel, EMBEDDED in the volume so the mesh conforms to it, and
 * filed under `groups` with its own flag so the script's own physical-group
 * pass makes the group and tags the fault's edges and corners with the same
 * number -- an untagged point is what stops GALES reading the mesh.
 *
 * Emitted after the volume and `groups` exist and before the groups are
 * turned into physical groups. `flags` must already carry `fault:<name>`.
 */
export function faultScriptLines(faults, { volumeVar = "volume" } = {}) {
  if (!faults?.length) return [];
  const data = faults.map((f) => ({
    name: `fault:${f.name}`,
    flag: Math.round(Number(f.flag)),
    size: Number(f.sizeM) > 0 ? Number(f.sizeM) : 100,
    points: f.points.map((p) => [round(p[0]), round(p[1]), round(p[2])]),
    tris: f.tris,
  }));
  return [
    "",
    "# FAULT PLANES: internal surfaces the mesh must conform to. Each is planar",
    "# triangles in the built-in kernel, embedded in the volume; its top edge",
    "# sits a little under the ground and the plane stays clear of the walls",
    "# and the base, because an embedded surface may not touch the boundary.",
    "# Two faults must not cross each other: gmsh refuses intersecting embedded",
    "# surfaces. The flag is the fault's own; its edges and corners take it",
    "# in the pass below, so every entity of the fault is tagged.",
    `FAULTS = ${PY(data)}`,
    "for fault in FAULTS:",
    "    ptags = [gmsh.model.geo.addPoint(x, y, z, fault[\"size\"]) for (x, y, z) in fault[\"points\"]]",
    "    lines = {}",
    "    def line(a, b):",
    "        key = (min(a, b), max(a, b))",
    "        if key not in lines:",
    "            lines[key] = gmsh.model.geo.addLine(ptags[key[0]], ptags[key[1]])",
    "        return lines[key] if a < b else -lines[key]",
    "    stags = []",
    "    for (a, b, c) in fault[\"tris\"]:",
    "        loop = gmsh.model.geo.addCurveLoop([line(a, b), line(b, c), line(c, a)])",
    "        stags.append(gmsh.model.geo.addPlaneSurface([loop]))",
    "    gmsh.model.geo.synchronize()",
    `    gmsh.model.mesh.embed(2, stags, 3, ${volumeVar})`,
    "    groups[fault[\"name\"]] = stags",
    "# HXT does not honour embedded surfaces; the Delaunay algorithm does, and",
    "# it is set here unless the study chose its own below.",
    "gmsh.option.setNumber(\"Mesh.Algorithm3D\", 1)",
  ];
}

function round(v) { return Math.round(Number(v) * 1000) / 1000; }
