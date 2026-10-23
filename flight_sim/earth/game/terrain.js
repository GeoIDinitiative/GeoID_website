/**
 * The ground: Esri World Imagery draped on Terrarium elevation, as a
 * chunked-LOD quadtree on the Web Mercator tile grid.
 *
 * ── Why a quadtree here and a clipmap on Everest ────────────────────────
 * Everest's terrain (everest/game/terrain.js) is a geometry clipmap with the
 * imagery composited into four nested canvases. That is right for a walker:
 * the area is fixed, the eye is two metres off the ground, and the canvases
 * re-centre rarely. A plane breaks both assumptions — it covers a tier's
 * whole canvas in seconds and climbs from 50 m to 10 km in a minute, so the
 * composites would re-centre constantly, each time re-drawing up to 16 384²
 * of pixels.
 *
 * A quadtree keyed on the tile grid sidesteps all of that: every node IS one
 * 256 px imagery tile and one 33² height grid, so a tile that lands is one
 * texture upload and never a canvas repaint, and LOD follows the camera in
 * three dimensions for free. What IS reused from Everest is the request
 * machinery (everest/game/tiles.js: one budget, coalescing, retire-don't-
 * abort, a decoded-image LRU) and the same two services, measured there.
 *
 * ── No holes, no pops ────────────────────────────────────────────────────
 * A node splits only when ALL FOUR children have both their imagery and
 * their heights; until then the parent keeps drawing. Coarse levels are
 * requested at higher priority, so the screen is always covered by something
 * and sharpens in place.
 *
 * ── Cracks ───────────────────────────────────────────────────────────────
 * Neighbours at different levels do not share edge vertices, so every chunk
 * carries a skirt: its rim duplicated and dropped. Cheap, and invisible from
 * anywhere a plane can be.
 */

import * as THREE from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { fetchTile, templateUrl } from "../../../everest/game/tiles.js?v=84ebb99-a7f30c15";
import { tileLocal, tileNWLocal, localToTile, R_MEAN } from "./geo.js?v=1";

export const IMAGERY = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  // 18 is ~0.6 m/px at the equator and ~0.37 m over London. Esri serves 19
  // over most cities, but it is upsampled from the same capture in most of
  // them and costs four times the requests.
  maxZoom: 18,
  credit: "Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
};
export const ELEVATION = {
  url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  maxZoom: 15,     // measured on Everest: 200 through z15, 404 at z16
  credit: "Elevation: Mapzen Terrain Tiles on AWS Open Data (SRTM, ASTER, national sources)",
};

const N = 32;                 // cells per chunk edge
const V = N + 1;
const ROOT_Z = 8;
/** Split when the eye is closer than SPLIT × the chunk's edge. 3.7 would be
 *  one texel per pixel on a 1080p screen at 60°; 2.4 is a little sharper. */
let SPLIT = 2.4;

/* ── Curvature ───────────────────────────────────────────────────────────
   The world is a plane (Mercator, scaled). Dropping every vertex by d²/2R
   relative to the eye gives the horizon back: 785 m at 100 km. Only the
   screen position is bent — `worldpos_vertex`, which feeds the shadow-map
   lookup, still sees the flat world, and so does the shadow pass, so casters
   and receivers agree exactly. */
const CURVE = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  vec4 curvedW = modelMatrix * mvPosition;
  vec2 curvedD = curvedW.xz - cameraPosition.xz;
  curvedW.y -= dot( curvedD, curvedD ) * ${(0.5 / R_MEAN).toExponential(8)};
  mvPosition = viewMatrix * curvedW;
  gl_Position = projectionMatrix * mvPosition;
`;
export function curve(material, key) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", CURVE);
  };
  material.customProgramCacheKey = () => "earth-curve-" + key;
  return material;
}

/* ── Shared fetches ───────────────────────────────────────────────────────
   tiles.js coalesces two requests for one URL into one fetch, and that fetch
   is retired by the predicate of whoever asked FIRST. On Everest that is
   harmless; here, four sibling chunks share one z15 elevation tile, and when
   the first of them was dropped mid-flight the other three were handed "no
   data" and built flat at sea level — kilometre-long walls along the
   horizon and holes after a fast pass. So every URL is requested from
   tiles.js exactly once, with a predicate that is true only when ALL of its
   current waiters are retired, and a retirement rejects (retry later) rather
   than resolving to a missing tile. */

const RETIRED = "retired";
const shared = new Map();        // url -> { p, waiters: Set<() => boolean> }

export function sharedFetch(url, priority, retired) {
  let e = shared.get(url);
  if (e) { e.waiters.add(retired); return e.p; }
  e = { waiters: new Set([retired]) };
  const allRetired = () => { for (const w of e.waiters) if (!w()) return false; return true; };
  e.p = fetchTile(url, priority, allRetired)
    .catch((err) => { throw (allRetired() ? new Error(RETIRED) : err); })
    .finally(() => shared.delete(url));
  shared.set(url, e);
  return e.p;
}
export const isRetired = (err) => !!err && err.message === RETIRED;

/* ── Elevation tiles ──────────────────────────────────────────────────── */

const demCache = new Map();     // "z/x/y" -> Float32Array(256²)
const demPending = new Map();
const DEM_CACHE = 160;
const scratch = document.createElement("canvas");
scratch.width = scratch.height = 256;
const sctx = scratch.getContext("2d", { willReadFrequently: true });

/** Below this is not bathymetry (the Mariana Trench is -10,994 m) but the
 *  format's no-data value, -32768: pure black pixels. */
const NODATA = -12000;

/** Decode to heights; no-data pixels come back as NaN for the caller to fill. */
function decodeTerrarium(img) {
  sctx.clearRect(0, 0, 256, 256);
  sctx.drawImage(img, 0, 0);
  const d = sctx.getImageData(0, 0, 256, 256).data;
  const h = new Float32Array(256 * 256);
  let holes = 0;
  for (let i = 0, p = 0; i < h.length; i++, p += 4) {
    const v = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
    if (v < NODATA) { h[i] = NaN; holes++; continue; }
    // Terrarium carries bathymetry; the imagery shows the sea surface. Below
    // zero is drawn AT zero (a polder or the Dead Sea shore comes out flat,
    // which is the lesser error than every coast becoming a cliff).
    h[i] = v > 0 ? v : 0;
  }
  return { h, holes };
}

/* ── Holes in the published DEM ───────────────────────────────────────────
   Found by flying, not by reading: on Etna's western flank whole Terrarium
   tiles at z14 and z15 (e.g. 14/8873/6336 and 14/8875/*) are solid black —
   every pixel the no-data value — while their neighbours and their parents
   are fine. Clamped like bathymetry they became 2 km-deep square pits with
   the skirts of their neighbours standing round them as walls. Any no-data
   pixel is now filled from the parent tile, recursively, so a hole costs a
   little resolution instead of the ground. */
async function fillHoles(z, x, y, h, priority, retired) {
  if (z === 0) { h.forEach((v, i) => { if (Number.isNaN(v)) h[i] = 0; }); return h; }
  const parent = await getDem(z - 1, x >> 1, y >> 1, priority - 0.5, retired);
  const ox = (x & 1) * 0.5, oy = (y & 1) * 0.5;
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++) {
      const k = j * 256 + i;
      if (!Number.isNaN(h[k])) continue;
      h[k] = parent ? sampleDem(parent, ox + (i + 0.5) / 512, oy + (j + 0.5) / 512) : 0;
    }
  return h;
}

/** Heights for one Terrarium tile. Resolves null if the tile does not exist;
 *  REJECTS (isRetired) if every caller waiting on it was retired. */
export function getDem(z, x, y, priority = 2, retired = () => false) {
  const key = z + "/" + x + "/" + y;
  const hit = demCache.get(key);
  if (hit) { demCache.delete(key); demCache.set(key, hit); return Promise.resolve(hit); }
  const url = templateUrl(ELEVATION.url, z, x, y);
  let p = demPending.get(key);
  if (p) { sharedFetch(url, priority, retired); return p; }   // adds this waiter
  p = sharedFetch(url, priority, retired)
    .then((img) => {
      const { h, holes } = decodeTerrarium(img);
      return holes ? fillHoles(z, x, y, h, priority, retired) : h;
    })
    .then((h) => {
      demCache.set(key, h);
      while (demCache.size > DEM_CACHE) demCache.delete(demCache.keys().next().value);
      return h;
    }, (err) => { if (isRetired(err)) throw err; return null; })
    .finally(() => demPending.delete(key));
  demPending.set(key, p);
  return p;
}

function sampleDem(h, u, v) {
  const fx = Math.min(Math.max(u * 256 - 0.5, 0), 255);
  const fy = Math.min(Math.max(v * 256 - 0.5, 0), 255);
  const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(x0 + 1, 255), y1 = Math.min(y0 + 1, 255);
  const tx = fx - x0, ty = fy - y0;
  return (h[y0 * 256 + x0] * (1 - tx) + h[y0 * 256 + x1] * tx) * (1 - ty)
       + (h[y1 * 256 + x0] * (1 - tx) + h[y1 * 256 + x1] * tx) * ty;
}

/* ── Shared buffers: every chunk has the same topology and the same UVs ── */

const SKIRT_V = 4 * V;
const VERTS = V * V + SKIRT_V;
const sharedIndex = (() => {
  const idx = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  // Skirt: rim vertex k (in walk order) pairs with skirt vertex V*V + k.
  const rim = rimOrder();
  for (let side = 0; side < 4; side++)
    for (let k = 0; k < N; k++) {
      const s0 = side * V + k, s1 = s0 + 1;
      const a = rim[s0], b = rim[s1], A = V * V + s0, B = V * V + s1;
      idx.push(a, b, A, b, B, A);
    }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
})();

/** Rim vertices walked so that the skirt faces outward: north edge west→east,
 *  east edge north→south, south edge east→west, west edge south→north. */
function rimOrder() {
  const r = [];
  for (let i = 0; i < V; i++) r.push(i);                         // north
  for (let j = 0; j < V; j++) r.push(j * V + N);                 // east
  for (let i = N; i >= 0; i--) r.push(N * V + i);                // south
  for (let j = N; j >= 0; j--) r.push(j * V);                    // west
  return r;
}
const RIM = rimOrder();

const sharedUV = (() => {
  const uv = new Float32Array(VERTS * 2);
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) { uv[(j * V + i) * 2] = i / N; uv[(j * V + i) * 2 + 1] = 1 - j / N; }
  for (let k = 0; k < SKIRT_V; k++) {
    const r = RIM[k];
    uv[(V * V + k) * 2] = uv[r * 2]; uv[(V * V + k) * 2 + 1] = uv[r * 2 + 1];
  }
  return new THREE.BufferAttribute(uv, 2);
})();

const _box = new THREE.Box3();

/* ── Nodes ────────────────────────────────────────────────────────────── */

class Node {
  constructor(t, z, x, y, parent) {
    this.t = t; this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.heights = null;     // Float32Array(V²) — the grid, for queries
    this.hmin = 0; this.hmax = 0;
    this.size = tileLocal(z);
    this.dead = false;
    this.img = null; this.dem = null;
    this.loading = false;
  }

  get ready() { return !!this.mesh; }

  load(priority) {
    if (this.loading || this.mesh) return;
    this.loading = true;
    const retired = () => this.dead;
    const dz = Math.min(this.z, ELEVATION.maxZoom), sh = this.z - dz;
    const imgP = sharedFetch(templateUrl(IMAGERY.url, this.z, this.x, this.y), priority, retired)
      .catch((err) => { if (isRetired(err)) throw err; return null; });
    const demP = getDem(dz, this.x >> sh, this.y >> sh, priority - 0.5, retired);
    Promise.all([imgP, demP]).then(([img, dem]) => {
      if (this.dead) return;
      // A missing imagery tile (deep zoom over open sea) still gets a mesh:
      // a node that can never become ready would pin its parent forever.
      this.build(img, dem);
    }, () => {
      // Retired under us (can only happen if this node died too, but be
      // safe): allow the next frame to ask again.
      this.loading = false;
    });
  }

  build(img, dem) {
    const t = this.t;
    const dz = Math.min(this.z, ELEVATION.maxZoom), sh = this.z - dz, sub = 1 << sh;
    const ox = this.x - ((this.x >> sh) << sh), oy = this.y - ((this.y >> sh) << sh);
    const hs = new Float32Array(V * V);
    // Box-filter each sample over its own cell rather than point-sampling:
    // a 33² grid reads one DEM pixel in eight (or in sixteen for the level
    // above), and point samples of a ridge disagree between levels by tens
    // of metres. Averages of the same ground agree.
    const step = 1 / (N * sub);
    for (let j = 0; j < V; j++)
      for (let i = 0; i < V; i++) {
        if (!dem) { hs[j * V + i] = 0; continue; }
        const u = (ox + i / N) / sub, v = (oy + j / N) / sub;
        let acc = 0;
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) acc += sampleDem(dem, u + a * step * 0.33, v + b * step * 0.33);
        hs[j * V + i] = acc / 9;
      }
    // Edges at half resolution: every odd rim vertex is put on the line
    // between its neighbours, which is exactly what the next-coarser level
    // draws along the same edge. Across a one-level LOD seam the two surfaces
    // then meet, and the skirt is not seen.
    for (let k = 1; k < N; k += 2) {
      hs[k] = (hs[k - 1] + hs[k + 1]) / 2;                                   // north
      hs[N * V + k] = (hs[N * V + k - 1] + hs[N * V + k + 1]) / 2;           // south
      hs[k * V] = (hs[(k - 1) * V] + hs[(k + 1) * V]) / 2;                   // west
      hs[k * V + N] = (hs[(k - 1) * V + N] + hs[(k + 1) * V + N]) / 2;       // east
    }
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < hs.length; k++) { if (hs[k] < lo) lo = hs[k]; if (hs[k] > hi) hi = hs[k]; }
    this.heights = hs; this.hmin = lo; this.hmax = hi;

    const cell = this.size / N;
    const pos = new Float32Array(VERTS * 3), nrm = new Float32Array(VERTS * 3);
    for (let j = 0; j < V; j++)
      for (let i = 0; i < V; i++) {
        const k = j * V + i;
        pos[k * 3] = i * cell; pos[k * 3 + 1] = hs[k]; pos[k * 3 + 2] = j * cell;
        const hl = hs[j * V + Math.max(i - 1, 0)], hr = hs[j * V + Math.min(i + 1, N)];
        const hu = hs[Math.max(j - 1, 0) * V + i], hd = hs[Math.min(j + 1, N) * V + i];
        const sx = (i > 0 && i < N) ? 2 : 1, sz = (j > 0 && j < N) ? 2 : 1;
        let nx = -(hr - hl) / (sx * cell), nz = -(hd - hu) / (sz * cell), ny = 1;
        const l = Math.hypot(nx, ny, nz); nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
      }
    const drop = Math.max(8, this.size * 0.03);
    for (let k = 0; k < SKIRT_V; k++) {
      const r = RIM[k], d = (V * V + k) * 3;
      pos[d] = pos[r * 3]; pos[d + 1] = pos[r * 3 + 1] - drop; pos[d + 2] = pos[r * 3 + 2];
      nrm[d] = nrm[r * 3]; nrm[d + 1] = nrm[r * 3 + 1]; nrm[d + 2] = nrm[r * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(sharedIndex);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", sharedUV);
    geo.computeBoundingSphere();

    let tex = null;
    if (img) {
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = t.anisotropy;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
    const mat = curve(new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x2a4a66 }), "terrain");
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = this.z >= 14;    // hills shade the city; a 100 km chunk never matters
    mesh.matrixAutoUpdate = true;
    mesh.visible = false;
    this.mesh = mesh;
    this.place();
    t.group.add(mesh);
    this.loading = false;
    t.stats.built++;
  }

  place() {
    if (!this.mesh) return;
    const nw = tileNWLocal(this.z, this.x, this.y);
    this.mesh.position.set(nw.x, 0, nw.z);
  }

  /** Distance from a point to this chunk's box. */
  distance(p) {
    const nw = tileNWLocal(this.z, this.x, this.y);
    const dx = Math.max(nw.x - p.x, 0, p.x - (nw.x + this.size));
    const dz = Math.max(nw.z - p.z, 0, p.z - (nw.z + this.size));
    const dy = Math.max(this.hmin - p.y, 0, p.y - this.hmax);
    return Math.hypot(dx, dy, dz);
  }

  ensureChildren() {
    if (this.children) return;
    const z = this.z + 1, x = this.x * 2, y = this.y * 2;
    this.children = [
      new Node(this.t, z, x, y, this), new Node(this.t, z, x + 1, y, this),
      new Node(this.t, z, x, y + 1, this), new Node(this.t, z, x + 1, y + 1, this),
    ];
  }

  dropChildren() {
    if (!this.children) return;
    for (const c of this.children) c.dispose();
    this.children = null;
  }

  dispose() {
    this.dead = true;
    this.dropChildren();
    if (this.mesh) {
      this.t.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material.map) this.mesh.material.map.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }

  /** Decide this frame: draw myself, or hand the area to my children. */
  /** Is the chunk's box (padded, since curvature lowers it) in the view? */
  inView() {
    const nw = tileNWLocal(this.z, this.x, this.y);
    _box.min.set(nw.x, this.hmin - this.size * 0.1 - 50, nw.z);
    _box.max.set(nw.x + this.size, this.hmax + 50, nw.z + this.size);
    return this.t.frustum.intersectsBox(_box);
  }

  update(eye) {
    const t = this.t;
    const d = this.distance(eye);
    // Behind the camera, detail is only needed for shadows and for turning
    // round: a third of the split distance keeps a cheap skirt of it.
    const vis = this.inView();
    const want = this.z < IMAGERY.maxZoom && d < this.size * SPLIT * (vis ? 1 : 0.35);
    if (!this.mesh) this.load(this.z + d / this.size * 0.2 + (vis ? 0 : 3));
    if (want) {
      this.ensureChildren();
      let all = true;
      for (const c of this.children) {
        if (!c.mesh) { c.load(c.z + c.distance(eye) / c.size * 0.2 + (vis ? 0 : 3)); all = false; }
      }
      if (all) {
        if (this.mesh) this.mesh.visible = false;
        for (const c of this.children) c.update(eye);
        return;
      }
      // Children still arriving: keep drawing this level over the whole area,
      // and make sure none of them is drawn on top of it.
      for (const c of this.children) c.hide();
    } else if (this.children) {
      this.dropChildren();
    }
    if (this.mesh) { this.mesh.visible = true; t.stats.drawn++; }
  }

  hide() {
    if (this.mesh) this.mesh.visible = false;
    if (this.children) for (const c of this.children) c.hide();
  }

  /** The deepest built node under a local point. */
  deepest(tx, ty, z) {
    if (!this.children) return this.mesh ? this : null;
    const s = 1 << (z - this.z - 1);
    const cx = Math.floor(tx / s) - this.x * 2, cy = Math.floor(ty / s) - this.y * 2;
    const c = this.children[(cy & 1) * 2 + (cx & 1)];
    const r = c && c.deepest(tx, ty, z);
    return r || (this.mesh ? this : null);
  }
}

/* ── The terrain ──────────────────────────────────────────────────────── */

const _pv = new THREE.Matrix4();

export class Terrain {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.group.name = "terrain";
    this.roots = new Map();
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.stats = { built: 0, drawn: 0 };
    this.frustum = new THREE.Frustum();
  }

  setDetail(k) { SPLIT = k; }

  update(eye, camera) {
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_pv);
    // Roots: every z8 tile within ~250 km of the eye. With the curvature drop
    // the horizon from 10 km up is ~360 km away, and fog closes most of that.
    const { tx, ty } = localToTile(eye.x, eye.z, ROOT_Z);
    const n = 1 << ROOT_Z, want = new Set();
    for (let y = Math.floor(ty) - 2; y <= Math.floor(ty) + 2; y++)
      for (let x = Math.floor(tx) - 3; x <= Math.floor(tx) + 3; x++) {
        if (y < 0 || y >= n) continue;
        const xx = ((x % n) + n) % n;
        const key = xx + "/" + y;
        want.add(key);
        if (!this.roots.has(key)) this.roots.set(key, new Node(this, ROOT_Z, xx, y, null));
      }
    for (const [key, node] of this.roots) {
      if (!want.has(key)) { node.dispose(); this.roots.delete(key); }
      else if (node.distance(eye) > 260e3) node.hide();
      else node.update(eye);
    }
  }

  /** Re-place every chunk after the origin moved. */
  rebase() {
    const walk = (n) => { n.place(); if (n.children) n.children.forEach(walk); };
    for (const n of this.roots.values()) walk(n);
  }

  nodeAt(tx, ty) {
    const zoom = IMAGERY.maxZoom, s = 1 << (zoom - ROOT_Z);
    const root = this.roots.get(Math.floor(tx / s) + "/" + Math.floor(ty / s));
    return root ? root.deepest(tx, ty, zoom) : null;
  }

  /** Zoom of the finest chunk built under a local point (0 if none). */
  detailAt(x, z) {
    const { tx, ty } = localToTile(x, z, IMAGERY.maxZoom);
    const node = this.nodeAt(tx, ty);
    return node ? node.z : 0;
  }

  /** Ground height under a local point, from the finest chunk built there. */
  heightAt(x, z) {
    const zoom = IMAGERY.maxZoom;
    const { tx, ty } = localToTile(x, z, zoom);
    const node = this.nodeAt(tx, ty);
    if (!node || !node.heights) return 0;
    const k = 1 << (zoom - node.z);
    const fx = (tx / k - node.x) * N, fy = (ty / k - node.y) * N;
    const i = Math.min(Math.max(Math.floor(fx), 0), N - 1), j = Math.min(Math.max(Math.floor(fy), 0), N - 1);
    const u = fx - i, v = fy - j, h = node.heights;
    return (h[j * V + i] * (1 - u) + h[j * V + i + 1] * u) * (1 - v)
         + (h[(j + 1) * V + i] * (1 - u) + h[(j + 1) * V + i + 1] * u) * v;
  }

  dispose() {
    for (const n of this.roots.values()) n.dispose();
    this.roots.clear();
  }
}
