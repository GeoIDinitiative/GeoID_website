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

const SINK = 4;

/* Facade palette: stone, render, brick, concrete, sandstone. Picked by a hash
   of the outline so a building keeps its colour when its tile reloads. */
const PALETTE = [
  [0.80, 0.77, 0.71], [0.86, 0.84, 0.80], [0.66, 0.48, 0.40], [0.72, 0.72, 0.72],
  [0.84, 0.76, 0.62], [0.76, 0.70, 0.64], [0.62, 0.62, 0.65], [0.90, 0.88, 0.84],
];

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
 */
export function extrudeTile(layer, dem, demSize, sizeLocal, triangulate) {
  const ext = layer.extent || 4096;
  const s = sizeLocal / ext;
  const pos = [], nrm = [], uv = [], col = [], roofIdx = [], wallIdx = [];
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
  const vert = (u, y, v, nx, ny, nz, r, g, b, fu, fv) => {
    pos.push(u * s, y, v * s);
    nrm.push(nx * 127, ny * 127, nz * 127);
    if (fu === undefined) uv.push(u / ext, 1 - v / ext);
    else uv.push(fu, fv);
    col.push(r * 255, g * 255, b * 255);
    return count++;
  };

  for (const f of layer.features) {
    if (f.type !== 3) continue;
    const p = f.props;
    if (p.hide_3d) continue;
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

      // Roof: earcut over the outline and its courtyards.
      const contour = outer.map(([x, y]) => ({ x, y }));
      const holesV = holes.map((h) => h.map(([x, y]) => ({ x, y })));
      const tris = triangulate(contour, holesV);
      const all = contour.concat(...holesV);
      const first = count;
      for (const q of all) vert(q.x, top, q.y, 0, 1, 0, 1, 1, 1);
      for (const t of tris) {
        // Earcut's winding follows the input's; force the face to point up.
        const a = all[t[0]], b = all[t[1]], c = all[t[2]];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        // In (x east, z south) a face points +y when the screen-space cross is negative.
        if (cross < 0) roofIdx.push(first + t[0], first + t[1], first + t[2]);
        else roofIdx.push(first + t[0], first + t[2], first + t[1]);
      }

      // Walls. Facade colour from OSM if tagged, else the palette; the foot of
      // every wall is darkened to 60 % as a cheap stand-in for occlusion.
      const ox = outer[0][0], oy = outer[0][1];
      const c = parseColour(p.colour) || PALETTE[((ox * 7349 + oy * 3121 + (height | 0)) >>> 0) % PALETTE.length];
      const ao = 0.6;
      const wall = (ring, isOuter) => {
        // Exteriors run one way and holes the other; fix both so that the
        // outward face of every wall is on the left of travel (y down).
        const sgn = ringSign(ring);
        const pts = (isOuter ? sgn > 0 : sgn < 0) ? ring : ring.slice().reverse();
        let run = 0;
        const yb = bottom - base, yt = top - base;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          const nx = dz / len, nz = -dx / len;
          const r0 = run, r1 = run + len * s;
          run = r1;
          const i0 = vert(a[0], bottom, a[1], nx, 0, nz, c[0] * ao, c[1] * ao, c[2] * ao, r0, yb);
          const i1 = vert(a[0], top, a[1], nx, 0, nz, c[0], c[1], c[2], r0, yt);
          const i2 = vert(b[0], top, b[1], nx, 0, nz, c[0], c[1], c[2], r1, yt);
          const i3 = vert(b[0], bottom, b[1], nx, 0, nz, c[0] * ao, c[1] * ao, c[2] * ao, r1, yb);
          wallIdx.push(i0, i1, i2, i0, i2, i3);
        }
      };
      wall(outer, true);
      for (const h of holes) wall(h, false);
    }
  }

  const index = new Uint32Array(roofIdx.length + wallIdx.length);
  index.set(roofIdx, 0);
  index.set(wallIdx, roofIdx.length);
  return {
    position: new Float32Array(pos),
    normal: new Int8Array(nrm),
    uv: new Float32Array(uv),
    color: new Uint8Array(col),
    index,
    polygons: nPoly,
    roofCount: roofIdx.length,
    wallCount: wallIdx.length,
  };
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
