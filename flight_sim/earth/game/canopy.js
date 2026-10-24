/**
 * Woods as a raised canopy, not a scatter of tree models.
 *
 * A wood seen from a few hundred metres up is a rolling roof of crowns with a
 * dark wall of foliage at its edge -- not ten thousand separate cones. So each
 * wood (and scrub) polygon in the tile's landcover becomes one volume: a top
 * surface lifted to crown height, with lumps the size of tree crowns and of
 * stands of trees so it catches the sun the way a canopy does, and walls down
 * to the ground round its outline. The top carries the tile's own aerial
 * imagery through the same UVs the roofs use (u/ext, 1 - v/ext), so the
 * canopy is the photographed forest, raised; the walls carry foliage-texture
 * coordinates in metres for the renderer's foliage texture.
 *
 * THE TOP IS A GRID, not a subdivided triangulation. Splitting the long edges
 * of an earcut triangulation leaves T-junctions -- cracks -- between
 * neighbours. Instead a regular grid of points inside the polygon is handed to
 * earcut as Steiner points (single-point holes) together with the outline, so
 * every triangle shares its vertices with its neighbours and the surface is
 * watertight however it is lifted.
 *
 * Seamless across tiles: the lumps are a function of WORLD metres (the tile's
 * origin is passed in), the rim is lowered only on real wood edges, never on
 * the tile's own boundary, and no wall is built along the tile boundary. A
 * wood that spans four tiles reads as one.
 *
 * Pure and deterministic, so it is tested without a GPU
 * (flight_sim/earth/tests/buildings.test.mjs).
 */

export const CANOPY_KINDS = {
  wood:  { h0: 15, h1: 23, lump: 5.0 },   // crowns +-2.5 m: visible from a few hundred metres
  scrub: { h0: 2.0, h1: 4.0, lump: 0.8 },
};
/** Grid spacing of the canopy top, metres (coarsened when a tile is dense). */
export const CANOPY_CELL_M = 28;
/** Most top vertices one tile may carry; above it the grid coarsens (an
 *  all-wood equatorial tile, 2.4 km across, to ~41 m cells). */
export const MAX_CANOPY_POINTS = 3500;   // earcut with Steiner points grows ~quadratically: ~0.3 s a tile here
/** The rim stands this fraction of the crown height: a rounded edge. */
const RIM = 0.7;
/** Walls start this far below ground so a slope never shows a gap. */
const SINK = 2;

export function canopyKind(props) {
  if (props.class === "wood") return CANOPY_KINDS.wood;
  if (props.subclass === "scrub") return CANOPY_KINDS.scrub;
  return null;
}

function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1] over a grid of `cell` metres. */
export function valueNoise(x, z, cell) {
  const gx = x / cell, gz = z / cell;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}
/** Crown height above ground at world metres (wx, wz): stands, then crowns. */
export function crownHeight(kind, wx, wz) {
  const stand = valueNoise(wx, wz, 90);
  const crowns = valueNoise(wx, wz, 9) - 0.5;
  return kind.h0 + (kind.h1 - kind.h0) * stand + kind.lump * crowns;
}

function signedArea(ring) {
  let a2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a2 / 2;
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Distance in tile units from p to the nearest edge of the ring. */
function distToRing(p, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}

/**
 * @param api        extrudeTile's api: { s, ext, ground, triangulate, polygonsOf }
 * @param landcover  the tile's decoded landcover layer
 * @param origin     [tileX, tileY]: the tile's place, for world-continuous lumps
 * @returns { position, normal, uv, index, topCount, polygons }  -- top
 *          triangles first (indices [0, topCount)), walls after.
 */
export function extrudeCanopy(api, landcover, origin = [0, 0]) {
  const empty = { position: new Float32Array(0), normal: new Float32Array(0), uv: new Float32Array(0),
    index: new Uint32Array(0), topCount: 0, polygons: 0 };
  if (!landcover) return empty;
  const { s, ext, ground, triangulate } = api;
  const woods = [];
  let area = 0;
  for (const f of landcover.features) {
    if (f.type !== 3) continue;
    const kind = canopyKind(f.props);
    if (!kind) continue;
    for (const poly of api.polygonsOf(f)) {
      const m2 = Math.abs(signedArea(poly.outer)) * s * s;
      if (m2 < 400) continue;                       // a copse smaller than 20 x 20 m
      woods.push({ poly, kind });
      area += m2;
    }
  }
  if (!woods.length) return empty;
  // Coarsen the grid until the tile fits the budget.
  const cellM = Math.max(CANOPY_CELL_M, Math.sqrt(area / MAX_CANOPY_POINTS));
  const step = cellM / s;                           // tile units
  const wx0 = origin[0] * ext * s, wz0 = origin[1] * ext * s;
  const onTileEdge = (u, v) => u <= 0.5 || v <= 0.5 || u >= ext - 0.5 || v >= ext - 0.5;

  const pos = [], uv = [], topIdx = [], wallIdx = [];
  let count = 0;
  const vert = (u, y, v, fu, fv) => {
    pos.push(u * s, y, v * s);
    uv.push(fu, fv);
    return count++;
  };
  const crownAt = (kind, u, v) => crownHeight(kind, wx0 + u * s, wz0 + v * s);

  for (const { poly, kind } of woods) {
    const { outer, holes } = poly;
    // Grid points strictly inside (not within a third of a cell of an edge,
    // which would make sliver triangles).
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of outer) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const steiner = [];
    const all = [outer, ...holes];
    for (let gv = Math.ceil(minV / step); gv * step < maxV; gv++) {
      for (let gu = Math.ceil(minU / step); gu * step < maxU; gu++) {
        // Jittered off the lattice, deterministically by world cell: points
        // on a regular grid are collinear by the row, and ear clipping then
        // leaves a point lying ON a neighbouring triangle's edge -- a
        // T-junction, which opens as a crack once the top is lifted.
        const wgu = gu + Math.round(wx0 / cellM), wgv = gv + Math.round(wz0 / cellM);
        const p = [(gu + 0.3 * (hash2(wgu, wgv) - 0.5)) * step, (gv + 0.3 * (hash2(wgv + 7, wgu + 3) - 0.5)) * step];
        if (!pointInRing(p, outer) || holes.some((h) => pointInRing(p, h))) continue;
        if (all.some((r) => distToRing(p, r) < step / 3)) continue;
        steiner.push(p);
      }
    }
    const contour = outer.map(([x, y]) => ({ x, y }));
    const holesV = holes.map((h) => h.map(([x, y]) => ({ x, y })))
      .concat(steiner.map(([x, y]) => [{ x, y }]));
    let tris;
    try { tris = triangulate(contour, holesV); } catch (e) { continue; }
    const pts = contour.concat(...holesV);
    const first = count;
    // Rim vertices are those of the real outline and holes; one on the tile's
    // own boundary is the middle of a wood that carries on next door.
    const nRing = outer.length + holes.reduce((n, h) => n + h.length, 0);
    const rimY = [];
    pts.forEach((q, k) => {
      const crown = crownAt(kind, q.x, q.y);
      const rim = k < nRing && !onTileEdge(q.x, q.y);
      const y = ground(q.x, q.y) + crown * (rim ? RIM : 1);
      if (k < nRing) rimY.push(y);
      vert(q.x, y, q.y, q.x / ext, 1 - q.y / ext);
    });
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // As the flat roofs (extrude.js): in (x east, z south) a face points +y
      // when the screen-space cross is negative.
      if (cross < 0) topIdx.push(first + t[0], first + t[1], first + t[2]);
      else topIdx.push(first + t[0], first + t[2], first + t[1]);
    }

    // Walls of foliage round each ring, outward face on the left of travel,
    // skipping edges that lie along the tile boundary.
    let ringStart = 0;
    for (const [ri, ring] of all.entries()) {
      const sgn = signedArea(ring);
      const forward = ri === 0 ? sgn > 0 : sgn < 0;
      const order = ring.map((_, k) => (forward ? k : ring.length - 1 - k));
      let run = 0;
      for (let k = 0; k < order.length; k++) {
        const ia = order[k], ib = order[(k + 1) % order.length];
        const a = ring[ia], b = ring[ib];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * s;
        if (len < 1e-3) continue;
        if (onTileEdge(a[0], a[1]) && onTileEdge(b[0], b[1])
          && (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5)) { run += len; continue; }
        const ya = rimY[ringStart + ia], yb = rimY[ringStart + ib];
        const ga = ground(a[0], a[1]) - SINK, gb = ground(b[0], b[1]) - SINK;
        const i0 = vert(a[0], ga, a[1], run / 8, 0);
        const i1 = vert(a[0], ya, a[1], run / 8, (ya - ga) / 8);
        const i2 = vert(b[0], yb, b[1], (run + len) / 8, (yb - gb) / 8);
        const i3 = vert(b[0], gb, b[1], (run + len) / 8, 0);
        wallIdx.push(i0, i1, i2, i0, i2, i3);
        run += len;
      }
      ringStart += ring.length;
    }
  }

  const position = new Float32Array(pos);
  const index = new Uint32Array(topIdx.length + wallIdx.length);
  index.set(topIdx, 0);
  index.set(wallIdx, topIdx.length);
  return { position, normal: smoothNormals(position, index), uv: new Float32Array(uv),
    index, topCount: topIdx.length, polygons: woods.length };
}

/**
 * Normals: smooth across the top (so the lumps shade as rounded crowns),
 * flat per face on the walls. Wall vertices are never shared with the top.
 */
function smoothNormals(position, index) {
  const n = new Float32Array(position.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const e1x = position[b] - position[a], e1y = position[b + 1] - position[a + 1], e1z = position[b + 2] - position[a + 2];
    const e2x = position[c] - position[a], e2y = position[c + 1] - position[a + 1], e2z = position[c + 2] - position[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
  }
  return n;
}
