/**
 * 3D buildings: OpenStreetMap footprints and heights, extruded, roofed with
 * the same Esri imagery the ground uses, casting and receiving sun shadows.
 *
 * ── Source, and the ones that were tried ─────────────────────────────────
 * OpenFreeMap (tiles.openfreemap.org) serves the OpenMapTiles schema as
 * vector tiles with no key, no account and `Access-Control-Allow-Origin: *`.
 * Its `building` layer at z14 carries `render_height` / `render_min_height`.
 * Checked from here, not assumed:
 *   - OSM Buildings' public tile endpoint (data.osmbuildings.org): 403.
 *   - Overture buildings: published as GeoParquet; the PMTiles builds are
 *     unversioned betas on S3 — fine for an experiment, not to ship against.
 *   - Google Photorealistic 3D Tiles: the real thing, but it needs an API key
 *     and its terms forbid caching and require Google's logo on screen. Left
 *     as an opt-in idea in the README; no key is in this repository.
 *
 * The tile URL carries a dated build path, so it is read from the TileJSON
 * at start rather than written down here.
 *
 * ── Roofs ────────────────────────────────────────────────────────────────
 * Each building tile gets a 1024² canvas of z16 imagery (4 × 4 tiles, about
 * 1.5 m a pixel over London) and every roof vertex is UV-mapped into it by
 * position. So a roof shows its own photographed roof — the look of Google
 * Earth before photogrammetry — and a building with no imagery yet is grey
 * rather than missing. Satellite imagery is not true-ortho: a tall tower's
 * roof is photographed displaced from its footprint, so towers can wear a
 * little street on one edge. That is the data, not a bug here.
 */

import * as THREE from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { templateUrl } from "../../../everest/game/tiles.js?v=84ebb99-a7f30c15";
import { tileLocal, tileNWLocal, localToTile } from "./geo.js?v=1";
import { curve, getDem, sharedFetch, IMAGERY } from "./terrain.js?v=1";
import { facade, roof } from "./facade.js?v=1";

export const BUILDINGS = {
  tilejson: "https://tiles.openfreemap.org/planet",
  zoom: 14,
  credit: "Buildings: © OpenStreetMap contributors (ODbL), via OpenMapTiles schema, served by OpenFreeMap",
};
/* Roof imagery: z17 (8 × 8 tiles, 2048²) for the tiles nearest the eye when
   they are requested, z16 (4 × 4, 1024²) for the rest. z17 is what the ground
   under them is drawn at from rooftop height, so a near roof matches the
   street beside it; further out the difference is below a pixel. */
const ROOF_NEAR = 900;
const MAX_TILES = 24;
const FETCH_BUDGET = 3;

export class Buildings {
  constructor(anisotropy) {
    this.group = new THREE.Group();
    this.group.name = "buildings";
    this.tiles = new Map();     // "x/y" -> tile record
    this.template = null;
    this.enabled = true;
    this.anisotropy = anisotropy;
    this.active = 0;
    this.queue = [];
    this.jobs = new Map();
    this.jobSeq = 0;
    this.stats = { tiles: 0, buildings: 0, verts: 0, failed: 0 };
    this.radius = 2400;
    this.wallMat = facade(curve(new THREE.MeshLambertMaterial({ vertexColors: true }), "walls"));
    this.worker = new Worker(new URL("./buildings-worker.js?v=1", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => {
      const job = this.jobs.get(e.data.id);
      if (!job) return;
      this.jobs.delete(e.data.id);
      job(e.data);
    };
    this.ready = fetch(BUILDINGS.tilejson)
      .then((r) => r.json())
      .then((tj) => { this.template = tj.tiles[0]; })
      .catch(() => { this.template = null; });
  }

  setEnabled(on) { this.enabled = on; this.group.visible = on; }

  update(eye, agl) {
    if (!this.template || !this.enabled) return;
    const z = BUILDINGS.zoom, size = tileLocal(z);
    // Above ~5 km the buildings are a texture's worth of pixels; stop adding.
    const r = agl > 5000 ? 0 : this.radius;
    const { tx, ty } = localToTile(eye.x, eye.z, z);
    const span = Math.ceil(r / size) + 1;
    const want = [];
    for (let y = Math.floor(ty) - span; y <= Math.floor(ty) + span; y++)
      for (let x = Math.floor(tx) - span; x <= Math.floor(tx) + span; x++) {
        const d = boxDistance(eye, x, y, z, size);
        if (d <= r) want.push({ x, y, d });
      }
    want.sort((a, b) => a.d - b.d);
    want.length = Math.min(want.length, MAX_TILES);
    const keep = new Set(want.map((w) => w.x + "/" + w.y));
    for (const w of want) {
      const key = w.x + "/" + w.y;
      if (!this.tiles.has(key)) this.tiles.set(key, this.request(w.x, w.y, w.d));
    }
    // Hysteresis: a tile is let go 1.5 km past the radius it was wanted in,
    // so circling a block does not reload it every lap.
    for (const [key, t] of this.tiles) {
      if (keep.has(key)) continue;
      if (boxDistance(eye, t.x, t.y, z, size) > r + 1500 || this.tiles.size > MAX_TILES + 8) this.drop(key);
    }
  }

  request(x, y, d) {
    const t = { x, y, dead: false, mesh: null, roof: null, d };
    this.queue.push(t);
    this.pump();
    return t;
  }

  pump() {
    this.queue.sort((a, b) => a.d - b.d);
    while (this.active < FETCH_BUDGET && this.queue.length) {
      const t = this.queue.shift();
      if (t.dead) continue;
      this.active++;
      this.loadTile(t).finally(() => { this.active--; this.pump(); });
    }
  }

  async loadTile(t) {
    const z = BUILDINGS.zoom;
    const url = templateUrl(this.template, z, t.x, t.y);
    let buf, dem;
    try {
      [buf, dem] = await Promise.all([
        fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)),
        getDem(z, t.x, t.y, 1, () => t.dead),
      ]);
    } catch (e) { if (!t.dead) this.stats.failed++; return; }
    if (t.dead || !buf) return;
    const id = ++this.jobSeq;
    const res = await new Promise((resolve) => {
      this.jobs.set(id, resolve);
      const demCopy = dem ? dem.slice() : null;     // the cache keeps its own
      this.worker.postMessage({ id, buf, dem: demCopy, demSize: 256, sizeLocal: tileLocal(z) },
        demCopy ? [buf, demCopy.buffer] : [buf]);
    });
    if (t.dead) return;
    if (res.error) { this.stats.failed++; console.warn("buildings", t.x, t.y, res.error); return; }
    if (res.empty) { t.mesh = null; return; }
    this.build(t, res.mesh, res.buildings);
  }

  build(t, m, count) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    geo.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3, true));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(m.color, 3, true));
    geo.setAttribute("aStyle", new THREE.BufferAttribute(m.style, 1, true));
    geo.addGroup(0, m.roofCount, 0);
    geo.addGroup(m.roofCount, m.wallCount, 1);
    geo.computeBoundingSphere();

    t.roof = this.roofTexture(t);
    const roofMat = roof(curve(new THREE.MeshLambertMaterial({ map: t.roof.tex }), "roofs"));
    const mesh = new THREE.Mesh(geo, [roofMat, this.wallMat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    t.mesh = mesh;
    this.place(t);
    this.group.add(mesh);
    this.stats.tiles++;
    this.stats.buildings += count;
    this.stats.verts += m.position.length / 3;
    t.count = count; t.verts = m.position.length / 3;
  }

  roofTexture(t) {
    const ROOF_Z = t.d < ROOF_NEAR ? 17 : 16;
    const px = 256 << (ROOF_Z - BUILDINGS.zoom);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    // Left transparent: the roof shader paints a dark neutral roof tone
    // where no imagery has landed yet (a light grey read as a floating slab).
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    const k = 1 << (ROOF_Z - BUILDINGS.zoom);
    for (let j = 0; j < k; j++)
      for (let i = 0; i < k; i++) {
        const url = templateUrl(IMAGERY.url, ROOF_Z, t.x * k + i, t.y * k + j);
        sharedFetch(url, ROOF_Z + (i + j) * 0.01, () => t.dead).then((img) => {
          if (t.dead) return;
          ctx.drawImage(img, i * 256, j * 256);
          tex.needsUpdate = true;
        }).catch(() => {});
      }
    return { canvas, tex };
  }

  place(t) {
    if (!t.mesh) return;
    const nw = tileNWLocal(BUILDINGS.zoom, t.x, t.y);
    t.mesh.position.set(nw.x, 0, nw.z);
  }

  rebase() { for (const t of this.tiles.values()) this.place(t); }

  drop(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    t.dead = true;
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material[0].dispose();
      this.stats.tiles--; this.stats.buildings -= t.count; this.stats.verts -= t.verts;
    }
    if (t.roof) t.roof.tex.dispose();
    this.tiles.delete(key);
  }

  /** Requests still outstanding (tile fetches and worker jobs). */
  pending() { return this.active + this.queue.filter((t) => !t.dead).length + this.jobs.size; }
}

function boxDistance(eye, x, y, z, size) {
  const nw = tileNWLocal(z, x, y);
  const dx = Math.max(nw.x - eye.x, 0, eye.x - (nw.x + size));
  const dz = Math.max(nw.z - eye.z, 0, eye.z - (nw.z + size));
  return Math.hypot(dx, dz);
}
