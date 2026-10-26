/**
 * Gap-fill for the OpenStreetMap buildings: Microsoft's machine-traced
 * footprints, read from the Overture Maps buildings archive.
 *
 * OSM misses whole estates where nobody has traced them yet -- at Ballykelly
 * (Co. Londonderry) a new estate west of the village stood flat on the photo
 * between 3D streets (reported 2026-10-26). Overture conflates OSM with
 * Microsoft ML Buildings; over that village's six z14 tiles OSM has 1,088
 * buildings and the ML set adds 375, the estate among them. Only the ML
 * footprints are taken (the OSM ones come from OpenFreeMap, which is newer
 * and carries heights and parts), and only where no OSM building already
 * stands: OSM traced since Overture's snapshot still wins.
 *
 * The archive is one PMTiles v3 file per monthly release (~180 GB, public,
 * CORS *), read by HTTP range: a 16 KB header and root directory, a leaf
 * directory per region (cached), then the tile. The release is found from
 * Overture's STAC catalog, so a new month needs no change here. Any failure
 * leaves the tile OSM-only -- this never holds the OSM buildings back.
 *
 * Plain ES module with no DOM and no three.js (worker and node test).
 */

import { rings, polygons } from "./mvt.js?v=1";

const STAC = "https://stac.overturemaps.org/catalog.json";
const BASE = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/";
const LEAF_CACHE = 48;

/** PMTiles tile id: tiles of lower zooms first, then the Hilbert index. */
export function tileId(z, x, y) {
  let acc = (4 ** z - 1) / 3;
  const t = [x, y];
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (t[0] & s) ? 1 : 0, ry = (t[1] & s) ? 1 : 0;
    acc += s * s * ((3 * rx) ^ ry);
    if (!ry) {
      if (rx) { t[0] = s - 1 - t[0]; t[1] = s - 1 - t[1]; }
      const a = t[0]; t[0] = t[1]; t[1] = a;
    }
  }
  return acc;
}

/** A PMTiles directory: varint count, then id deltas, run lengths, lengths, offsets. */
export function parseDirectory(bytes) {
  let p = 0;
  // Offsets pass 2^32 (the file is 180 GB): multiply, never shift.
  const rv = () => { let v = 0, m = 1, b; do { b = bytes[p++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  const n = rv(), e = new Array(n);
  let id = 0;
  for (let i = 0; i < n; i++) { id += rv(); e[i] = { id, run: 0, len: 0, off: 0 }; }
  for (let i = 0; i < n; i++) e[i].run = rv();
  for (let i = 0; i < n; i++) e[i].len = rv();
  for (let i = 0; i < n; i++) { const v = rv(); e[i].off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1; }
  return e;
}

async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

let archive = null;            // Promise of { url, root, leafOff, dataOff } (null result: off)
const leaves = new Map();      // leaf offset -> Promise of entries, oldest first

async function range(url, off, len) {
  const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (r.status !== 206 && r.status !== 200) throw new Error(`overture ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function open() {
  if (!archive) archive = (async () => {
    const cat = await (await fetch(STAC)).json();
    if (!cat.latest) return null;
    const url = `${BASE}${cat.latest}/buildings.pmtiles`;
    const h = await range(url, 0, 16384);
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const u64 = (o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
    if (String.fromCharCode(...h.subarray(0, 7)) !== "PMTiles" || h[7] !== 3) return null;
    // Internal and tile compression both gzip (2), tiles MVT (1), z14 the deepest.
    if (h[97] !== 2 || h[98] !== 2 || h[99] !== 1) return null;
    const rootOff = u64(8), rootLen = u64(16);
    return { url, maxZoom: h[101], root: parseDirectory(await gunzip(h.subarray(rootOff, rootOff + rootLen))),
      leafOff: u64(40), dataOff: u64(56) };
  })().catch(() => null);
  return archive;
}

function leaf(a, e) {
  let p = leaves.get(e.off);
  if (p) { leaves.delete(e.off); leaves.set(e.off, p); return p; }
  p = range(a.url, a.leafOff + e.off, e.len).then(gunzip).then(parseDirectory);
  p.catch(() => leaves.delete(e.off));
  leaves.set(e.off, p);
  if (leaves.size > LEAF_CACHE) leaves.delete(leaves.keys().next().value);
  return p;
}

/** The archive's tile at z/x/y as MVT bytes, or null (none there, or the archive is out of reach). */
export async function overtureTile(z, x, y) {
  const a = await open();
  if (!a || z > a.maxZoom) return null;
  const id = tileId(z, x, y);
  let dir = a.root;
  for (let depth = 0; depth < 4; depth++) {
    let lo = 0, hi = dir.length - 1, f = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dir[m].id <= id) { f = m; lo = m + 1; } else hi = m - 1; }
    if (f < 0) return null;
    const e = dir[f];
    if (e.run === 0) { dir = await leaf(a, e); continue; }
    if (id >= e.id + e.run) return null;
    return gunzip(await range(a.url, a.dataOff + e.off, e.len));
  }
  return null;
}

function inRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/**
 * The machine-traced footprints of an Overture building layer that no OSM
 * building already covers, as features of the OSM layer's own kind (polygon,
 * `render_height` in metres). Both layers are z14 tiles at the same extent.
 * Dropped: any whose centre is inside an OSM outline, or holds an OSM
 * outline's centre (the same building traced twice), and slivers under 12 m².
 */
export function gapFill(osmLayer, overtureLayer, metresPerUnit) {
  const ext = overtureLayer?.extent || 4096;
  if (!overtureLayer?.features?.length || ext !== (osmLayer?.extent || 4096)) return [];
  const CELL = 128, cells = new Map();
  const cellsOf = (x0, y0, x1, y1, fn) => {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) fn(cx + "," + cy);
  };
  for (const f of osmLayer?.features || []) {
    if (f.type !== 3) continue;
    for (const pl of polygons(rings(f.geometry))) {
      const o = pl.outer;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of o) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const b = { ring: o, c: centroid(o) };
      cellsOf(x0, y0, x1, y1, (k) => { const l = cells.get(k); if (l) l.push(b); else cells.set(k, [b]); });
    }
  }
  const minArea = 12 / (metresPerUnit * metresPerUnit);
  const out = [];
  for (const f of overtureLayer.features) {
    if (f.type !== 3 || f.props?.["@geometry_source"] === "OpenStreetMap" || f.props?.is_underground) continue;
    const pls = polygons(rings(f.geometry));
    const o = pls[0]?.outer;
    if (!o) continue;
    let a = 0;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) a += o[j][0] * o[i][1] - o[i][0] * o[j][1];
    if (Math.abs(a / 2) < minArea) continue;
    const [cx, cy] = centroid(o);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of o) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    let covered = false;
    cellsOf(x0, y0, x1, y1, (k) => {
      if (covered) return;
      for (const b of cells.get(k) || [])
        if (inRing(cx, cy, b.ring) || inRing(b.c[0], b.c[1], o)) { covered = true; return; }
    });
    if (covered) continue;
    const h = +f.props?.height;
    out.push({ id: 0, type: 3, geometry: f.geometry,
      props: { render_height: Number.isFinite(h) && h >= 2.5 ? Math.min(h, 60) : 5, render_min_height: 0, ml: 1 } });
  }
  return out;
}
