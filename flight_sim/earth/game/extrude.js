/**
 * OSM building footprints → one indexed mesh per tile: flat roofs first,
 * walls second, so the material can be split by two draw groups.
 *
 * Pure: no DOM, no three.js. The triangulator is passed in (three's earcut,
 * ShapeUtils.triangulateShape, in the worker; the same in the node test).
 *
 * Heights come from OpenMapTiles' `render_height` / `render_min_height`,
 * which are OSM `height` / `building:levels × 3 m` where tagged and a 5 m
 * default where not. So a city where mappers have tagged heights (central
 * London, Manhattan, most of Germany) gets its real skyline, and one where
 * they have not gets a believable low town of uniform blocks.
 *
 * The ground under a building is read from the Terrarium tile for the SAME
 * z/x/y (OpenFreeMap's buildings and Terrarium are both cut on the z14
 * Mercator grid, so the two line up pixel for pixel with no resampling).
 * Each building stands on the LOWEST ground under its outline, and its walls
 * run four metres further down: the terrain mesh beneath is a 32-cell grid
 * over interpolated SRTM and can sit a few metres off the true ground at any
 * one footprint. A sunk wall is invisible; a floating one is not.
 */

import { rings, polygons, clipRing } from "./mvt.js?v=1";
import { bridgeOutlines, drawBridges, latticeClusters, drawWheel, inPolys } from "./structures.js?v=2";

const SINK = 4;
// Facade grid (facade.js): every wall segment carries a WHOLE number of bays
// of about BAY_M, starting at its corner, and the height a whole number of
// equal storeys of about STOREY_M ending at the eave. Windows are then all
// one size and none is cut by a corner or the roof (owner, 2026-10-24: "the
// windows are all different sizes, first window is too high up").
export const BAY_M = 3.0;
export const STOREY_M = 3.2;

/* ── Facades, when OSM does not say ──────────────────────────────────────
   OpenFreeMap's building layer carries `colour` (OSM building:colour) and the
   two heights, and nothing else: no building type, material, levels or roof
   tags. So the palette is chosen by what the HEIGHT says the building
   probably is -- low: brick, stock brick and render; mid-rise: stone,
   render and brick; towers: glass, steel and pale concrete -- and within a
   class by a hash of the OSM id, so a building keeps its colour across
   reloads and neighbours differ. */
const PALETTES = {
  low: [[0.62, 0.40, 0.33], [0.70, 0.52, 0.42], [0.78, 0.70, 0.58], [0.88, 0.85, 0.78],
        [0.66, 0.60, 0.52], [0.56, 0.36, 0.30], [0.83, 0.78, 0.68], [0.74, 0.66, 0.56]],
  mid: [[0.86, 0.82, 0.73], [0.80, 0.76, 0.68], [0.90, 0.88, 0.83], [0.70, 0.66, 0.60],
        [0.64, 0.44, 0.36], [0.76, 0.74, 0.72], [0.84, 0.78, 0.64], [0.68, 0.70, 0.72]],
  tall: [[0.55, 0.63, 0.70], [0.62, 0.68, 0.72], [0.48, 0.55, 0.60], [0.78, 0.79, 0.80],
         [0.70, 0.74, 0.76], [0.45, 0.52, 0.56], [0.84, 0.84, 0.82], [0.58, 0.66, 0.66]],
};
/* Above this a building is drawn as a curtain wall (style 1: glass bays,
   mullions, a sky sheen); below it as masonry with punched windows (0). */
const TOWER_M = 40;

function hash32(n) {
  let h = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/* OSM `building:colour` is a hex triple or a CSS name; mappers use a short
   list of names in practice. Values are softened toward facade tones — a
   literal "red" building reads as a rendering error. */
const NAMED = {
  white: [0.92, 0.91, 0.88], grey: [0.66, 0.66, 0.66], gray: [0.66, 0.66, 0.66],
  silver: [0.76, 0.77, 0.78], beige: [0.86, 0.80, 0.68], brown: [0.55, 0.42, 0.33],
  red: [0.66, 0.38, 0.32], yellow: [0.88, 0.80, 0.55], black: [0.25, 0.25, 0.26],
  blue: [0.50, 0.58, 0.68], green: [0.52, 0.62, 0.50], orange: [0.82, 0.60, 0.42],
  pink: [0.86, 0.70, 0.70], tan: [0.80, 0.70, 0.55], cream: [0.92, 0.88, 0.76],
};

function parseColour(c) {
  if (typeof c !== "string") return null;
  const named = NAMED[c.trim().toLowerCase()];
  if (named) return named;
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/**
 * @param layer       decoded MVT layer (mvt.decodeLayer)
 * @param dem         Float32Array of heights, demSize² row-major, north row first
 * @param sizeLocal   tile edge length in local metres
 * @param triangulate (contour[{x,y}], holes[[{x,y}]]) => [[a,b,c], ...]
 * @param extra       { transport, water, landcover }: the same tile's decoded
 *                    layers, for bridges, keeping bridge outlines out, and trees
 *                    (structures.js)
 */
export function extrudeTile(layer, dem, demSize, sizeLocal, triangulate, extra = {}) {
  const ext = layer.extent || 4096;
  const s = sizeLocal / ext;
  const pos = [], nrm = [], uv = [], col = [], sty = [], roofIdx = [], wallIdx = [];
  let count = 0, nPoly = 0;

  const ground = (u, v) => {
    if (!dem) return 0;
    const fx = Math.min(Math.max(u / ext * demSize - 0.5, 0), demSize - 1);
    const fy = Math.min(Math.max(v / ext * demSize - 0.5, 0), demSize - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, demSize - 1), y1 = Math.min(y0 + 1, demSize - 1);
    const tx = fx - x0, ty = fy - y0;
    const h = (dem[y0 * demSize + x0] * (1 - tx) + dem[y0 * demSize + x1] * tx) * (1 - ty)
            + (dem[y1 * demSize + x0] * (1 - tx) + dem[y1 * demSize + x1] * tx) * ty;
    return Math.max(h, 0);
  };

  // `fu, fv` override the UV: roofs map into the tile's imagery (the
  // default), walls carry facade metres instead — along the wall, and up
  // from the building's foot — which the wall shader turns into windows.
  // `st` is the facade style the shader reads (0 masonry, 1 curtain wall).
  let style = 0;
  const vert = (u, y, v, nx, ny, nz, r, g, b, fu, fv) => {
    pos.push(u * s, y, v * s);
    nrm.push(nx * 127, ny * 127, nz * 127);
    if (fu === undefined) uv.push(u / ext, 1 - v / ext);
    else uv.push(fu, fv);
    col.push(r * 255, g * 255, b * 255);
    sty.push(style * 255);
    return count++;
  };
  /** One flat triangle with its own normal, wound to face `up` (roofs) or
   *  outward from `centre` (gable walls). Points are [u, y, v]. */
  const face = (pts, into, colour, facadeUV, outFrom) => {
    const P = pts.map(([u, y, v]) => [u * s, y, v * s]);
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
    const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const want = outFrom
      ? [P[0][0] - outFrom[0] * s, 0, P[0][2] - outFrom[1] * s]
      : [0, 1, 0];
    let order = [0, 1, 2];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { order = [0, 2, 1]; n = n.map((x) => -x); }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const ids = order.map((k) => vert(pts[k][0], pts[k][1], pts[k][2], n[0] / l, n[1] / l, n[2] / l,
      colour[0], colour[1], colour[2], facadeUV ? facadeUV[k][0] : undefined, facadeUV ? facadeUV[k][1] : undefined));
    into.push(...ids);
  };

  /* ── Generic drawing for structures.js, in metres ─────────────────── */
  const toTile = (P) => [P[0] / s, P[1], P[2] / s];
  const flatTri = (P, want, colour, group) => {
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
    const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let order = [0, 1, 2];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { order = [0, 2, 1]; n = n.map((x) => -x); }
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) return;
    const into = group === "roof" ? roofIdx : wallIdx;
    for (const k of order) {
      const [u, y, v] = toTile(P[k]);
      into.push(group === "roof"
        ? vert(u, y, v, n[0] / l, n[1] / l, n[2] / l, colour[0], colour[1], colour[2])
        : vert(u, y, v, n[0] / l, n[1] / l, n[2] / l, colour[0], colour[1], colour[2], 0, 0));
    }
  };
  const api = {
    s, ext, triangulate,
    ground,
    tri: (P, n, colour, group) => { const keep = style; style = group === "roof" ? 0 : 0.5; flatTri(P, n, colour, group); style = keep; },
    quad: (P, n, colour, group) => {
      const keep = style; style = group === "roof" ? 0 : 0.5;
      flatTri([P[0], P[1], P[2]], n, colour, group); flatTri([P[0], P[2], P[3]], n, colour, group);
      style = keep;
    },
    box: (c, a, b, d, colour) => {
      const P = (sa, sb, sd) => [c[0] + a[0] * sa + b[0] * sb + d[0] * sd, c[1] + a[1] * sa + b[1] * sb + d[1] * sd, c[2] + a[2] * sa + b[2] * sb + d[2] * sd];
      for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
        const m = [a, b, d][ax];
        const corner = (s1, s2) => { const f = [0, 0, 0]; f[ax] = sgn; f[(ax + 1) % 3] = s1; f[(ax + 2) % 3] = s2; return P(f[0], f[1], f[2]); };
        api.quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], [m[0] * sgn, m[1] * sgn, m[2] * sgn], colour, "wall");
      }
    },
    polygonsOf: (f) => polygons(rings(f.geometry)).map((p) => ({
      outer: dedupe(clipRing(p.outer, ext)),
      holes: p.holes.map((h) => dedupe(clipRing(h, ext))).filter((h) => h.length >= 3),
    })).filter((p) => p.outer.length >= 3),
    linesOf: (f) => rings(f.geometry),
  };
  const outlines = bridgeOutlines(extra.transport, api.polygonsOf);

  // Lattice structures (the London Eye's ~150 parts): measured once, so the
  // loop below can leave their parts out.
  const parts = [];
  layer.features.forEach((f, i) => {
    if (f.type !== 3 || f.props.hide_3d) return;
    const r = rings(f.geometry)[0];
    if (!r || r.length < 3) return;
    const cu = r.reduce((a, q) => a + q[0], 0) / r.length, cv = r.reduce((a, q) => a + q[1], 0) / r.length;
    let a2 = 0;
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) a2 += r[j][0] * r[k][1] - r[k][0] * r[j][1];
    parts.push({ i, cx: cu * s, cz: cv * s, cu, cv, lo: +f.props.render_min_height || 0,
      hi: +f.props.render_height || 5, area: Math.abs(a2 / 2) * s * s });
  });
  const lattice = latticeClusters(parts);
  const centreOf = new Map(parts.map((q) => [q.i, q]));

  for (const [fi, f] of layer.features.entries()) {
    if (f.type !== 3) continue;
    const p = f.props;
    if (p.hide_3d) continue;
    if (lattice.skip.has(fi)) continue;
    // A footprint inside a bridge outline is part of the bridge, not a building.
    const cq = centreOf.get(fi);
    if (cq && outlines.length && inPolys([cq.cu, cq.cv], outlines)) continue;
    const height = +p.render_height || 5;
    const minH = +p.render_min_height || 0;
    if (height <= minH) continue;

    for (const poly of polygons(rings(f.geometry))) {
      const outer = dedupe(clipRing(poly.outer, ext));
      if (outer.length < 3) continue;
      const holes = poly.holes.map((h) => dedupe(clipRing(h, ext))).filter((h) => h.length >= 3);

      nPoly++;
      let base = Infinity;
      for (const [u, v] of outer) base = Math.min(base, ground(u, v));
      const top = base + height;
      const bottom = minH > 0 ? base + minH : base - SINK;

      // Colour and style. OSM's building:colour wins; otherwise the height
      // class's palette, picked by the OSM id (or the outline, if a tile
      // carries no ids) so a building keeps its colour across reloads.
      const key = f.id != null ? f.id : (outer[0][0] * 7349 + outer[0][1] * 3121 + (height | 0));
      const hh = hash32(key);
      const cls = height >= TOWER_M ? "tall" : height >= 12 ? "mid" : "low";
      const c = parseColour(p.colour) || PALETTES[cls][hh % 8];
      style = height >= TOWER_M ? 1 : 0;

      // A pitched roof where the outline is a small rectangle -- see pitched().
      const rect = minH === 0 && !holes.length ? pitched(outer, s, height, hh) : null;
      const eave = rect ? top - rect.rise : top;
      const storeys = Math.max(1, Math.round((eave - base) / STOREY_M));
      const storeyH = (eave - base) / storeys;
      let bay = 0;

      if (rect) {
        // Roof planes in the roof group (imagery), gable ends in the walls.
        const R = rect;
        const at = (q, y) => [q[0], y, q[1]];
        const centre = R.centre;
        if (R.kind === "gable") {
          const [p0, p1, p2, p3] = R.corners, m03 = R.ridge[0], m12 = R.ridge[1];
          for (const quad of [[p0, p1, m12, m03], [p2, p3, m03, m12]]) {
            face([at(quad[0], eave), at(quad[1], eave), at(quad[2], top)], roofIdx, [1, 1, 1]);
            face([at(quad[0], eave), at(quad[2], top), at(quad[3], top)], roofIdx, [1, 1, 1]);
          }
          // The gable ends are plain attic wall: no bays, half a storey up.
          const gable = (a, b, m) => {
            const attic = [0, storeys + 0.5];
            face([at(a, eave), at(b, eave), at(m, top)], wallIdx, c, [attic, attic, attic], centre);
          };
          gable(p1, p2, m12);
          gable(p3, p0, m03);
        } else {
          const [p0, p1, p2, p3] = R.corners, r0 = R.ridge[0], r1 = R.ridge[1];
          face([at(p0, eave), at(p1, eave), at(r1, top)], roofIdx, [1, 1, 1]);
          face([at(p0, eave), at(r1, top), at(r0, top)], roofIdx, [1, 1, 1]);
          face([at(p2, eave), at(p3, eave), at(r0, top)], roofIdx, [1, 1, 1]);
          face([at(p2, eave), at(r0, top), at(r1, top)], roofIdx, [1, 1, 1]);
          face([at(p1, eave), at(p2, eave), at(r1, top)], roofIdx, [1, 1, 1]);
          face([at(p3, eave), at(p0, eave), at(r0, top)], roofIdx, [1, 1, 1]);
        }
      } else {
        // Flat roof: earcut over the outline and its courtyards.
        const contour = outer.map(([x, y]) => ({ x, y }));
        const holesV = holes.map((h) => h.map(([x, y]) => ({ x, y })));
        const tris = triangulate(contour, holesV);
        const all = contour.concat(...holesV);
        const first = count;
        for (const q of all) vert(q.x, top, q.y, 0, 1, 0, 1, 1, 1);
        for (const t of tris) {
          // Earcut's winding follows the input's; force the face to point up.
          const a = all[t[0]], b = all[t[1]], cc = all[t[2]];
          const cross = (b.x - a.x) * (cc.y - a.y) - (b.y - a.y) * (cc.x - a.x);
          // In (x east, z south) a face points +y when the screen-space cross is negative.
          if (cross < 0) roofIdx.push(first + t[0], first + t[1], first + t[2]);
          else roofIdx.push(first + t[0], first + t[2], first + t[1]);
        }
      }

      // Walls, up to the eave. Occlusion at the foot is the shader's (from
      // the facade height in `uv`), so the vertex colour is the facade's own.
      const wall = (ring, isOuter) => {
        // Exteriors run one way and holes the other; fix both so that the
        // outward face of every wall is on the left of travel (y down).
        const sgn = ringSign(ring);
        const pts = (isOuter ? sgn > 0 : sgn < 0) ? ring : ring.slice().reverse();
        // Facade UV in bays (u) and storeys (v): see BAY_M. `bay` runs on
        // round the building so neighbouring walls light different windows.
        const yb = (bottom - base) / storeyH, yt = storeys;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          const nx = dz / len, nz = -dx / len;
          const bays = Math.round(len * s / BAY_M);
          const r0 = bay, r1 = bay + bays;
          bay = r1 + 1;
          const i0 = vert(a[0], bottom, a[1], nx, 0, nz, c[0], c[1], c[2], r0, yb);
          const i1 = vert(a[0], eave, a[1], nx, 0, nz, c[0], c[1], c[2], r0, yt);
          const i2 = vert(b[0], eave, b[1], nx, 0, nz, c[0], c[1], c[2], r1, yt);
          const i3 = vert(b[0], bottom, b[1], nx, 0, nz, c[0], c[1], c[2], r1, yb);
          wallIdx.push(i0, i1, i2, i0, i2, i3);
        }
      };
      wall(outer, true);
      for (const h of holes) wall(h, false);
    }
  }

  // Bridges, then any wheels the lattice pass recognised.
  const bridges = drawBridges(api, extra.transport, extra.water, outlines);
  for (const w of lattice.wheels) {
    const g = ground(w.cx / s, w.cz / s);
    if (w.cx < 0 || w.cz < 0 || w.cx > ext * s || w.cz > ext * s) continue;   // drawn by its own tile
    drawWheel(api, { ...w, cy: w.cy + g });
  }

  // No woods geometry. The extruded canopy (canopy.js) -- 15-23 m slabs on the
  // OSM wood outlines -- did not match the trees in the photograph and read as
  // blocks (owner, 2026-10-24: "a disaster"); the cones before it as glyphs.
  // The vegetation now rises out of the ground imagery itself, from the photo
  // (osm-buildings.js, vegetationRelief). canopy.js and scatterTrees stay,
  // tested and unused.
  const canopy = { position: new Float32Array(0), normal: new Float32Array(0), uv: new Float32Array(0),
    index: new Uint32Array(0), topCount: 0, polygons: 0 };
  const trees = new Float32Array(0);

  const index = new Uint32Array(roofIdx.length + wallIdx.length);
  index.set(roofIdx, 0);
  index.set(wallIdx, roofIdx.length);
  return {
    position: new Float32Array(pos),
    normal: new Int8Array(nrm),
    uv: new Float32Array(uv),
    color: new Uint8Array(col),
    style: new Uint8Array(sty),
    index,
    polygons: nPoly,
    bridges,
    trees,
    canopy,
    wheels: lattice.wheels.length,
    latticeParts: lattice.skip.size,
    roofCount: roofIdx.length,
    wallCount: wallIdx.length,
  };
}

/* ── Pitched roofs, inferred ─────────────────────────────────────────────
   OSM's roof:shape is not in the vector tiles this reads, so roofs are
   INFERRED, and only where the inference is safe: an outline that is a
   rectangle (four corners within 15 degrees of square, after dropping
   near-collinear points), 30–450 m^2, no taller than 15 m and with no
   courtyard -- a house, a terrace block, a garage, a church hall. Elongated
   ones (long side over 1.6 times the short) get a gable along their length,
   squarer ones a hip; one in six is left flat, because plenty are. The roof
   rises about 35 degrees, capped at 5 m and at a third of the building.
   Everything else keeps the flat roof the data implies. */
export function pitched(ring, s, height, hh) {
  if (height > 15 || hh % 6 === 0) return null;
  // Drop points where the outline barely turns.
  let pts = ring.slice();
  for (let pass = 0; pass < 2 && pts.length > 4; pass++) {
    pts = pts.filter((q, i) => {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
      const v1 = [q[0] - a[0], q[1] - a[1]], v2 = [b[0] - q[0], b[1] - q[1]];
      const c = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
      return c < Math.cos(10 * Math.PI / 180);
    });
  }
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[(i + 3) % 4], q = pts[i], b = pts[(i + 1) % 4];
    const v1 = [a[0] - q[0], a[1] - q[1]], v2 = [b[0] - q[0], b[1] - q[1]];
    const c = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
    if (Math.abs(c) > Math.sin(15 * Math.PI / 180)) return null;
  }
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Order so that p0->p1 is a LONG side.
  let [p0, p1, p2, p3] = pts;
  if (len(p0, p1) < len(p1, p2)) [p0, p1, p2, p3] = [p1, p2, p3, p0];
  const L = len(p0, p1) * s, W = len(p1, p2) * s, area = L * W;
  if (area < 30 || area > 450) return null;
  const rise = Math.min(5, height / 3, (W / 2) * Math.tan(35 * Math.PI / 180));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m03 = mid(p3, p0), m12 = mid(p1, p2);
  const centre = mid(m03, m12);
  if (L / W > 1.6) return { kind: "gable", corners: [p0, p1, p2, p3], ridge: [m03, m12], rise, centre };
  // Hip: the ridge is the long axis shortened by half the width at each end.
  const k = Math.min(0.5, (W / 2) / L);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { kind: "hip", corners: [p0, p1, p2, p3], ridge: [lerp(m03, m12, k), lerp(m03, m12, 1 - k)], rise, centre };
}

/** Drop repeated points, including a closing copy of the first. Earcut's
 *  wrapper in three pops a closing duplicate IN PLACE, which would shift
 *  every hole's indices by one against the vertex list built here. */
function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= 1e-6
         && Math.abs(out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out;
}

function ringSign(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++)
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return Math.sign(a);
}
