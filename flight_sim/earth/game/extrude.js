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

import { rings, polygons, clipRing, ringArea, splitPolygons } from "./mvt.js?v=2";
import { bridgeOutlines, drawBridges, latticeClusters, drawWheel, inPolys } from "./structures.js?v=4";

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
/* Landmarks (see `landmarks` below) wear their own materials: castles,
   palaces and churches dressed stone, stadiums pale concrete and cladding. */
const STONE = [[0.72, 0.69, 0.62], [0.66, 0.63, 0.57], [0.78, 0.73, 0.62], [0.60, 0.58, 0.55],
               [0.80, 0.76, 0.66], [0.70, 0.64, 0.54], [0.63, 0.62, 0.60], [0.75, 0.70, 0.60]];
const STADIUM = [[0.86, 0.87, 0.88], [0.80, 0.82, 0.84], [0.90, 0.90, 0.88], [0.74, 0.76, 0.80]];
/* Facade style bytes (facade.js): masonry 0, stone 0.375, plain 0.5,
   church 0.625, curtain 1. */
export const STYLE_STONE = 0.375;
const STYLE_PLAIN = 0.5;
export const STYLE_CHURCH = 0.625;
/* A church's bays are its window rhythm, wider than a house's. */
const CHURCH_BAY_M = 5.0;

/* ── Coincident walls ────────────────────────────────────────────────────
   OSM maps landmarks as overlapping parts -- Elizabeth Tower is eight
   footprints stacked 0-51, 48-61, 60-82 m...; Westminster Abbey a 51 m nave
   over an 8 m outline; Edinburgh's Royal Palace a 13 m block on a 5 m slab.
   Where two of them share an outer edge, two outward walls of different
   colours lie in ONE plane and the depth test settles it differently every
   frame the camera moves: the continuous flicker. So every footprint is
   grown outward by a few centimetres to a metre, more the taller it is (and
   a hash apart for equal heights): of two coincident walls the taller part's
   now stands proud and always wins, by more than the depth buffer resolves
   at the distances a wall is big enough to see. Roofs grow with their walls.
   Vertices on the tile's edge stay put, or the two halves of a building cut
   by the edge would overlap there. */
export function inflateBy(height, hh) {
  // Steep while buildings are low (5 cm per metre to 16 m), where most
  // overlapping parts differ by a storey or two; gentle above (4 mm per
  // metre), so a tower is not visibly fattened. The hash only splits equal
  // heights (OSM's 5 m default makes many): five steps to 11 cm, under the 15 cm
  // that one 3 m storey of difference already gives.
  const h = Math.max(0, height);
  return 0.10 + 0.05 * Math.min(h, 16) + 0.004 * Math.max(0, Math.min(h, 150) - 16) + (hh % 5) * 0.028;
}
export function inflateRing(ring, d, ext, isOuter) {
  const n = ring.length;
  if (n < 3 || !(d > 0)) return ring;
  // Orient as wall() does, so each edge's (dz, -dx) normal points out of the solid.
  const sgn = ringSign(ring);
  const pts = (isOuter ? sgn > 0 : sgn < 0) ? ring : ring.slice().reverse();
  const nrm = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    return [dz / len, -dx / len];
  });
  const onEdge = (q) => q[0] <= 1e-6 || q[1] <= 1e-6 || q[0] >= ext - 1e-6 || q[1] >= ext - 1e-6;
  return pts.map((q, i) => {
    if (onEdge(q)) return q;
    const n1 = nrm[(i + n - 1) % n], n2 = nrm[i];
    const mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (k < 1e-3) return q;                         // a spike doubling back: leave it
    // Miter, capped at 2.5x so a sharp corner cannot shoot out.
    const scale = Math.min(d / k, 2.5 * d / (Math.hypot(mx, mz) / 2 || 1));
    return [q[0] + mx * scale, q[1] + mz * scale];
  });
}

/* ── Landmarks, from the same tile ───────────────────────────────────────
   The building layer says nothing about what a building is, but the tile's
   other layers do: `landuse` carries stadium and pitch polygons, and `poi`
   names castles (OpenMapTiles puts palaces in that class too), churches and
   stadiums. A building is
     stadium  if its centre lies in a landuse=stadium polygon: the stands;
     castle   if it holds a castle POI, or stands within CASTLE_REACH_M of one
              and is no taller than 25 m, so the walls and towers round the
              named keep come too (the reach was 160 m and 40 m: at the Tower
              of London that took in Tower Hill's offices, battlements and all);
     palace   if it holds a castle-class POI named as a palace, house or hall;
     worship  if it holds a place of worship.
   Stadium > castle > palace > worship. */
const CASTLE_REACH_M = 110;
export function landmarks(extra, ext, s) {
  const out = { stadiums: [], castles: [], palaces: [], worship: [], monuments: [] };
  const centroid = (r) => [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length];
  if (extra.landuse) {
    const pitches = [];
    for (const f of extra.landuse.features) {
      if (f.type !== 3) continue;
      const cls = f.props.class;
      if (cls !== "stadium" && cls !== "pitch") continue;
      for (const pl of polygons(rings(f.geometry))) {
        if (pl.outer.length < 3) continue;
        if (cls === "stadium") out.stadiums.push({ ring: pl.outer, centre: centroid(pl.outer), pitchArea: 0 });
        else pitches.push({ c: centroid(pl.outer), area: Math.abs(ringArea(pl.outer)) });
      }
    }
    // Each stadium faces its largest pitch; without one, its own middle.
    for (const st of out.stadiums)
      for (const pt of pitches)
        if (pt.area > st.pitchArea && pointIn(pt.c, st.ring)) { st.centre = pt.c; st.pitchArea = pt.area; }
  }
  if (extra.poi) {
    for (const f of extra.poi.features) {
      const p = rings(f.geometry)[0]?.[0];
      if (!p) continue;
      const cls = f.props.class, name = String(f.props.name || f.props["name:en"] || "");
      if (cls === "castle") {
        if (/palace|house|hall|court/i.test(name) && !/castle|tower|fort|keep/i.test(name)) out.palaces.push(p);
        else out.castles.push(p);
      } else if (cls === "place_of_worship") out.worship.push(p);
      else {
        const form = monumentForm(cls, name);
        if (form) out.monuments.push({ p, form, name });
      }
    }
  }
  out.castleReach = CASTLE_REACH_M / s;
  return out;
}
/* What a monument POI is drawn as, from its class and name -- the tiles
   carry no height or form for them. Columns and needles are named as such;
   everything else that is a monument, statue or memorial gets a figure on a
   plinth. Plaques, shafts, burial grounds and street furniture tagged as
   monuments are left alone. */
export function monumentForm(cls, name) {
  if (/plaque|shaft|burial|ground|field|street|house|clearing|board|garden|park|trust/i.test(name)) return null;
  if (/column/i.test(name) && (cls === "monument" || cls === "art_gallery" || cls === "attraction")) return "column";
  if (/needle|obelisk/i.test(name) && (cls === "monument" || cls === "attraction" || cls === "art_gallery")) return "obelisk";
  if (cls === "monument") return "statue";
  if (cls === "art_gallery" && /statue|memorial|cenotaph/i.test(name)) return "statue";
  return null;
}
function pointIn(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function classify(marks, polys, centre, height) {
  if (!marks) return null;
  const holds = (pts) => pts.some((q) => polys.some((pl) => pointIn(q, pl.outer) && !pl.holes.some((h) => pointIn(q, h))));
  // Any part of the stadium, not only the stands: a building whose centre OR
  // any corner is inside the stadium polygon. At Old Trafford a 5 m
  // concourse ring round the stands (centre inside, under the old 6 m
  // floor) was drawn as an office block with a band of lit windows round
  // the whole bowl (owner, 2026-10-25: "stadiums still treated as
  // buildings"). Only parts 8 m and up are raked (see standTop).
  const st = marks.stadiums.find((x) => pointIn(centre, x.ring)
    || polys.some((pl) => pl.outer.some((q) => pointIn(q, x.ring))));
  if (st) return { kind: "stadium", centre: st.centre };
  if (holds(marks.castles)) return { kind: "castle" };
  if (height <= 25 && marks.castles.some((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1]) < marks.castleReach)) return { kind: "castle" };
  if (holds(marks.palaces)) return { kind: "palace" };
  if (holds(marks.worship)) return { kind: "worship" };
  if (holds(marks.monuments.map((m) => m.p))) return { kind: "monument" };
  return null;
}

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
  // Every decision below is per feature, so first one feature per building
  // (mvt.js splitPolygons: OpenFreeMap packs many into one).
  layer = { ...layer, features: splitPolygons(layer.features) };
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
  // `shift` [du, dv] (tile units) moves where a roof-group face reads the
  // tile's imagery from: a patch under a bridge shows the ground beside it.
  const flatTri = (P, want, colour, group, shift = null) => {
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
        ? (shift
          ? vert(u, y, v, n[0] / l, n[1] / l, n[2] / l, colour[0], colour[1], colour[2],
            Math.min(1, Math.max(0, (u + shift[0]) / ext)), Math.min(1, Math.max(0, 1 - (v + shift[1]) / ext)))
          : vert(u, y, v, n[0] / l, n[1] / l, n[2] / l, colour[0], colour[1], colour[2]))
        : vert(u, y, v, n[0] / l, n[1] / l, n[2] / l, colour[0], colour[1], colour[2], 0, 0));
    }
  };
  const api = {
    s, ext, triangulate,
    ground,
    tri: (P, n, colour, group) => { const keep = style; style = group === "roof" ? 0 : 0.5; flatTri(P, n, colour, group); style = keep; },
    quad: (P, n, colour, group, shift = null) => {
      const keep = style; style = group === "roof" ? 0 : 0.5;
      flatTri([P[0], P[1], P[2]], n, colour, group, shift); flatTri([P[0], P[2], P[3]], n, colour, group, shift);
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
  const marks = landmarks(extra, ext, s);
  /** A closed frustum about a point: `n` sides from radius r0 (metres) at y0
   *  to r1 at y1, rotated by `rot`, with a top cap; walls in the wall group. */
  const solid = (p, r0, r1, y0, y1, n, colour, rot = 0) => {
    const ring = (r, y) => Array.from({ length: n }, (_, k) => {
      const a = rot + (k / n) * Math.PI * 2;
      return [p[0] + Math.cos(a) * r / s, y, p[1] + Math.sin(a) * r / s];
    });
    const lo = ring(r0, y0), hi = ring(r1, y1);
    const vs = (y1 - y0) / 3.2;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      face([lo[k], lo[j], hi[j]], wallIdx, colour, [[0, 0], [0.4, 0], [0.4, vs]], p);
      face([lo[k], hi[j], hi[k]], wallIdx, colour, [[0, 0], [0.4, vs], [0, vs]], p);
    }
    for (let k = 1; k < n - 1; k++) face([hi[0], hi[k], hi[k + 1]], wallIdx, colour, [[0, vs], [0, vs], [0, vs]]);
  };
  const inflate = extra.inflate !== false;
  let landmarkCount = 0;

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

    const featPolys = polygons(rings(f.geometry));
    const fc = cq ? [cq.cu, cq.cv] : null;
    const mark = fc ? classify(marks, featPolys, fc, height) : null;
    if (mark) landmarkCount++;
    const fkey = f.id != null ? f.id : 0;
    const grow = inflate ? inflateBy(height, hash32(fkey)) / s : 0;

    for (const poly of featPolys) {
      let outer = dedupe(clipRing(poly.outer, ext));
      if (outer.length < 3) continue;
      let holes = poly.holes.map((h) => dedupe(clipRing(h, ext))).filter((h) => h.length >= 3);
      if (grow) {
        outer = inflateRing(outer, grow, ext, true);
        holes = holes.map((h) => inflateRing(h, grow, ext, false));
      }

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
      const kind = mark?.kind;
      const palette = kind === "stadium" ? STADIUM : (kind ? STONE : PALETTES[cls]);
      const c = parseColour(p.colour) || palette[hh % palette.length];
      style = kind === "castle" ? STYLE_STONE : kind === "worship" ? STYLE_CHURCH
        : (kind === "stadium" || kind === "monument") ? STYLE_PLAIN : height >= TOWER_M ? 1 : 0;

      // A pitched roof where the outline is a small rectangle -- see pitched().
      // Never on a stadium stand or a castle: those have their own tops.
      // A church's nave gets a steep gable whatever its size; its towers stay
      // flat for the parapet and pinnacles below.
      const towerLike = kind === "worship" && height >= 15 && towerish(outer, s, height);
      const rect = minH === 0 && !holes.length && kind !== "stadium" && kind !== "castle" && kind !== "monument" && !towerLike
        ? pitched(outer, s, height, hh, kind === "worship" ? CHURCH_ROOF : undefined) : null;
      const eave = rect ? top - rect.rise : top;
      const storeys = Math.max(1, Math.round((eave - base) / STOREY_M));
      const storeyH = (eave - base) / storeys;
      let bay = 0;

      // A stand's top at a point: full height away from the pitch, a low
      // pitch-side wall nearest it. `onHole`: the point is on a courtyard.
      let standTop = () => eave;
      if (kind === "stadium" && height >= 8) {
        const lo = base + Math.max(3, Math.min(height * 0.18, 10));
        const cIn = holes.some((h) => pointIn(mark.centre, h));
        if (cIn) standTop = (_q, onHole) => (onHole ? lo : top);
        else {
          const ds = outer.concat(...holes).map((q) => Math.hypot(q[0] - mark.centre[0], q[1] - mark.centre[1]));
          const dmin = Math.min(...ds), dmax = Math.max(...ds);
          standTop = (q) => {
            const d = Math.hypot(q[0] - mark.centre[0], q[1] - mark.centre[1]);
            const t = dmax - dmin > 1e-9 ? Math.min(1, Math.max(0, (d - dmin) / (dmax - dmin))) : 1;
            return lo + (top - lo) * t;
          };
        }
      }

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
      } else if (kind === "stadium" && height >= 8) {
        // RAKED STANDS. The seating falls toward the pitch: the roof surface
        // runs from the full height on the side away from it down to a low
        // pitch-side wall. A bowl mapped as one outline with the pitch as its
        // hole (Wembley) is high round the outside and low round the hole;
        // separate stands (Old Trafford) slope by distance from the pitch.
        const contour = outer.map(([x, y]) => ({ x, y }));
        const holesV = holes.map((h) => h.map(([x, y]) => ({ x, y })));
        const tris = triangulate(contour, holesV);
        const all = contour.concat(...holesV);
        const ring = new Array(all.length).fill(0);
        let o = contour.length;
        holes.forEach((h, hi) => { for (let k = 0; k < h.length; k++) ring[o + k] = hi + 1; o += h.length; });
        const ys = all.map((q, i) => standTop([q.x, q.y], ring[i] > 0));
        for (const t of tris) {
          face(t.map((ix) => [all[ix].x, ys[ix], all[ix].y]), roofIdx, [1, 1, 1]);
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
        // A church's facade v runs 0..1 foot to eave (one tall window per
        // bay, not a window per storey); everything else counts storeys.
        const church = kind === "worship";
        const vScale = church ? (eave - base) : storeyH;
        const yb = (bottom - base) / vScale;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const ta = standTop(a, !isOuter);
          const tb = standTop(b, !isOuter);
          const yta = kind === "stadium" ? (ta - base) / storeyH : church ? 1 : storeys;
          const ytb = kind === "stadium" ? (tb - base) / storeyH : church ? 1 : storeys;
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          const nx = dz / len, nz = -dx / len;
          const bays = Math.max(church ? 1 : 0, Math.round(len * s / (church ? CHURCH_BAY_M : BAY_M)));
          const r0 = bay, r1 = bay + bays;
          bay = r1 + 1;
          const i0 = vert(a[0], bottom, a[1], nx, 0, nz, c[0], c[1], c[2], r0, yb);
          const i1 = vert(a[0], ta, a[1], nx, 0, nz, c[0], c[1], c[2], r0, yta);
          const i2 = vert(b[0], tb, b[1], nx, 0, nz, c[0], c[1], c[2], r1, ytb);
          const i3 = vert(b[0], bottom, b[1], nx, 0, nz, c[0], c[1], c[2], r1, yb);
          wallIdx.push(i0, i1, i2, i0, i2, i3);
          if (isOuter && ((kind === "castle" && crenellate) || towerLike)) battlements(a, b, nx, nz, top, c, church ? 1 : storeys, len * s);
        }
      };
      // Not on a castle "building" that is really a whole precinct (Edinburgh's
      // is one 5 m feature of 1,244 rings): only on walls and towers.
      const crenellate = featPolys.length <= 40;
      // BATTLEMENTS along every outer wall top of a castle: merlons about
      // 1.4 m wide and 1.1 m tall with 1 m gaps, flush with the wall face and
      // 0.6 m thick, in the wall's stone.
      const battlements = (a, b, nx, nz, y0, colour, storeysUV, lenM) => {
        if (lenM < 3) return;
        const MW = 1.4, GAP = 1.0, MH = 1.1, DEP = 0.6;
        // Unit direction along the wall, then everything below in metres / s.
        const ex = (b[0] - a[0]) / (lenM / s), ez = (b[1] - a[1]) / (lenM / s);
        const along = (q, m) => [q[0] + ex * m / s, q[1] + ez * m / s];
        const inward = (q) => [q[0] - nx * DEP / s, q[1] - nz * DEP / s];
        const n = Math.floor((lenM + GAP) / (MW + GAP));
        const lead = (lenM - (n * MW + (n - 1) * GAP)) / 2;
        const y1 = y0 + MH;
        // Facade v just above the eave's storey, below where facade.js cuts slits.
        const v0 = storeysUV, v1 = storeysUV + 0.3;
        for (let k = 0; k < n; k++) {
          const t0 = lead + k * (MW + GAP);
          const p0 = along(a, t0), p1 = along(a, t0 + MW), q1 = inward(p1), q0 = inward(p0);
          const mid = [(p0[0] + p1[0] + q0[0] + q1[0]) / 4, (p0[1] + p1[1] + q0[1] + q1[1]) / 4];
          // Four sides (outer face, end, inner face, end), each wound out of the merlon.
          for (const [u, w] of [[p0, p1], [p1, q1], [q1, q0], [q0, p0]]) {
            face([[u[0], y0, u[1]], [w[0], y0, w[1]], [w[0], y1, w[1]]], wallIdx, colour, [[0, v0], [0.4, v0], [0.4, v1]], mid);
            face([[u[0], y0, u[1]], [w[0], y1, w[1]], [u[0], y1, u[1]]], wallIdx, colour, [[0, v0], [0.4, v1], [0, v1]], mid);
          }
          face([[p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [q1[0], y1, q1[1]]], wallIdx, colour, [[0, v1], [0.4, v1], [0.4, v1]]);
          face([[p0[0], y1, p0[1]], [q1[0], y1, q1[1]], [q0[0], y1, q0[1]]], wallIdx, colour, [[0, v1], [0.4, v1], [0, v1]]);
        }
      };
      wall(outer, true);
      for (const h of holes) wall(h, false);
      // A church tower's corners carry pinnacles over the parapet.
      if (towerLike) for (const q of corners(outer)) {
        const cx = outer.reduce((a, r) => a + r[0], 0) / outer.length, cz = outer.reduce((a, r) => a + r[1], 0) / outer.length;
        const k = Math.hypot(cx - q[0], cz - q[1]) || 1;
        const at = [q[0] + (cx - q[0]) / k * (0.5 / s), q[1] + (cz - q[1]) / k * (0.5 / s)];
        solid(at, 0.45, 0.02, top, top + Math.min(6, height * 0.12), 4, c, Math.PI / 4);
      }
    }
  }

  // MONUMENTS that are points, not buildings: a stylised stone form at the
  // POI (monumentForm), standing on the ground there. Drawn in the plain
  // style; a column or needle in OSM is almost never a footprint.
  const MON = [0.80, 0.77, 0.70], BRONZE = [0.36, 0.33, 0.28];
  let monumentCount = 0;
  const footprints = layer.features.filter((f) => f.type === 3 && !f.props.hide_3d);
  for (const m of marks.monuments) {
    const [u, v] = m.p;
    if (u < 0 || v < 0 || u > ext || v > ext) continue;
    if (footprints.some((f) => polygons(rings(f.geometry)).some((pl) => pointIn(m.p, pl.outer)))) continue;   // a building: dressed above
    const g = ground(u, v);
    style = STYLE_PLAIN;
    if (m.form === "column") {
      solid(m.p, 4.2, 4.2, g, g + 5, 4, MON, Math.PI / 4);          // pedestal
      solid(m.p, 1.6, 1.4, g + 5, g + 38, 12, MON);                  // shaft
      solid(m.p, 2.2, 2.2, g + 38, g + 40, 4, MON, Math.PI / 4);     // capital
      solid(m.p, 0.6, 0.3, g + 40, g + 44, 6, BRONZE);               // figure
    } else if (m.form === "obelisk") {
      solid(m.p, 2.8, 2.8, g, g + 1.5, 4, MON, Math.PI / 4);         // base
      solid(m.p, 1.4, 0.9, g + 1.5, g + 19, 4, MON, Math.PI / 4);    // shaft, tapering
      solid(m.p, 0.9, 0.02, g + 19, g + 21, 4, MON, Math.PI / 4);    // pyramidion
    } else {
      solid(m.p, 1.8, 1.8, g, g + 3, 4, MON, Math.PI / 4);           // plinth
      solid(m.p, 0.45, 0.3, g + 3, g + 5.4, 6, BRONZE);              // figure
    }
    monumentCount++;
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
    landmarks: landmarkCount,
    monuments: monumentCount,
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
/* A church nave: steeper (50 degrees), any size, never left flat, and
   gabled down its length -- the hip is for houses. */
const CHURCH_ROOF = { maxHeight: 45, minArea: 30, maxArea: 4000, angle: 50, maxRise: 16, flat: false, gableRatio: 1.15 };
export function pitched(ring, s, height, hh, o = {}) {
  const maxHeight = o.maxHeight ?? 15, minArea = o.minArea ?? 30, maxArea = o.maxArea ?? 450;
  const angle = o.angle ?? 35, maxRise = o.maxRise ?? 5, gableRatio = o.gableRatio ?? 1.6;
  if (height > maxHeight || (o.flat !== false && hh % 6 === 0)) return null;
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
  if (area < minArea || area > maxArea) return null;
  const rise = Math.min(maxRise, height / 3, (W / 2) * Math.tan(angle * Math.PI / 180));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m03 = mid(p3, p0), m12 = mid(p1, p2);
  const centre = mid(m03, m12);
  if (L / W > gableRatio) return { kind: "gable", corners: [p0, p1, p2, p3], ridge: [m03, m12], rise, centre };
  // Hip: the ridge is the long axis shortened by half the width at each end.
  const k = Math.min(0.5, (W / 2) / L);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { kind: "hip", corners: [p0, p1, p2, p3], ridge: [lerp(m03, m12, k), lerp(m03, m12, 1 - k)], rise, centre };
}

/** A church tower rather than a nave: compact (under 400 m^2) and at least
 *  1.4 times as tall as it is wide. */
export function towerish(ring, s, height) {
  let a2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a2 += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const area = Math.abs(a2 / 2) * s * s;
  return area > 4 && area <= 400 && height >= 1.4 * Math.sqrt(area);
}
/** The outline's real corners: vertices where it turns by more than 45 degrees. */
function corners(ring) {
  const n = ring.length;
  return ring.filter((q, i) => {
    const a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
    const v1 = [q[0] - a[0], q[1] - a[1]], v2 = [b[0] - q[0], b[1] - q[1]];
    const c = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
    return c < Math.cos(45 * Math.PI / 180);
  }).slice(0, 8);
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
