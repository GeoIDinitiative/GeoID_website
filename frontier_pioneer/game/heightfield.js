/**
 * The measured ground: the site's height pyramid held on the CPU, and the one
 * function everything else asks.
 *
 *     field.height(x, z, cell = 0)   world Y of the DATA surface, in metres
 *
 * The renderer's clipmap, the rover's wheels, the rocks, the shadows and (to
 * come) the base builder all call this. It is the measured surface only: the
 * procedural detail below the data's resolution is added on top by
 * surface.js, which is the function physics and placement should use.
 *
 * LEVELS. The coarsest level (16 m, CTX with HiRISE averaged in) covers the
 * whole site and is loaded whole at boot, so there is always an answer. Finer
 * levels (4 m, 1 m HiRISE) stream as 256-sample tiles around the rover. A
 * query takes the finest level that has the four samples it needs and falls
 * through to the next when a tile is absent. The pipeline feathers every fine
 * level onto the upsampled coarser one along the edge of its coverage, so
 * falling through at a coverage edge is continuous by construction; falling
 * through because a tile has not arrived yet is a small step that heals when
 * it lands (`version` bumps and the clipmap resamples).
 *
 * `cell` is the spacing the caller will sample at. A caller on a coarse grid
 * is given a correspondingly coarse level (the levels are block means, so
 * that IS the low-pass), and beyond 32 m a 3 x 3 box over the base. The rule
 * is a pure function of `cell`, which is what lets a clipmap level compute
 * exactly what its parent draws (terrain.js).
 */
import { CLIPMAP, HEIGHT_RADIUS } from "./config.js?v=6d37c9c-9b39e129";
import { fetchTile, pixels } from "./tiles.js?v=6d37c9c-9b39e129";

export const PROV = { none: 0, interpolated: 1, ctx: 2, hirise: 3 };

export class Heightfield {
  constructor(site) {
    this.site = site;
    this.version = 0;
    const H = site.manifest.height;
    this.offset = H.offset - H.ref;      // decode straight to world Y
    this.scale = H.scale;
    this.levels = site.heightLevels.map((L) => ({
      L, mpp: L.mpp, tile: L.tile,
      across: L.tiles_across, down: L.tiles_down,
      slots: new Array(L.tiles_across * L.tiles_down).fill(null),
      wanted: new Set(), loading: new Set(),
      radius: HEIGHT_RADIUS[L.mpp] || L.mpp * 420,
    }));
    this.base = this.levels[0];                         // coarsest
    this.fine = this.levels.slice(1).reverse();         // finest first
    this.baseH = null; this.baseP = null;
    this.bw = 0; this.bh = 0;
    this.gen = 0;
  }

  /** Load the whole base level. `onProgress(done, total)`. */
  async loadBase(onProgress) {
    const b = this.base, L = b.L, T = b.tile;
    this.bw = b.across * T; this.bh = b.down * T;
    this.baseH = new Float32Array(this.bw * this.bh);
    this.baseP = new Uint8Array(this.bw * this.bh);
    let done = 0;
    await Promise.all(L.tiles.map(async ([tx, ty]) => {
      const img = await fetchTile(this.site.tileUrl(L, tx, ty), 0);
      const d = pixels(img, T);
      for (let j = 0; j < T; j++) {
        const row = (ty * T + j) * this.bw + tx * T;
        for (let i = 0; i < T; i++) {
          const k = (j * T + i) * 4;
          this.baseH[row + i] = this.offset + (d[k] * 256 + d[k + 1]) * this.scale;
          this.baseP[row + i] = d[k + 2];
        }
      }
      onProgress && onProgress(++done, L.tiles.length);
    }));
    this.version++;
  }

  /** Stream the fine tiles around a focus point. Cheap to call every frame. */
  update(fx, fz) {
    const site = this.site;
    for (const lv of this.fine) {
      const L = lv.L, T = lv.tile;
      const span = T * lv.mpp;                              // projected metres per tile
      const px = fx / site.cos + site.projW / 2, pz = fz + site.projH / 2;
      const r = lv.radius;
      const tx0 = Math.floor((px - r / site.cos) / span), tx1 = Math.floor((px + r / site.cos) / span);
      const ty0 = Math.floor((pz - r) / span), ty1 = Math.floor((pz + r) / span);
      const key = tx0 + "," + ty0 + "," + tx1 + "," + ty1;
      if (key === lv.key) continue;
      lv.key = key;
      lv.wanted.clear();
      const gen = ++this.gen;
      lv.gen = gen;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!L.has.has(tx + "_" + ty)) continue;
        const id = ty * lv.across + tx;
        lv.wanted.add(id);
        if (lv.slots[id] || lv.loading.has(id)) continue;
        lv.loading.add(id);
        const d2 = Math.hypot((tx + 0.5) * span - px, (ty + 0.5) * span - pz);
        fetchTile(site.tileUrl(L, tx, ty), 1 + d2 / 1000, () => !lv.wanted.has(id))
          .then((img) => { this._store(lv, id, img); })
          .catch(() => {})
          .finally(() => lv.loading.delete(id));
      }
      // Evict what is well outside the wanted window.
      const m = 2;
      for (let id = 0; id < lv.slots.length; id++) {
        if (!lv.slots[id]) continue;
        const tx = id % lv.across, ty = (id / lv.across) | 0;
        if (tx < tx0 - m || tx > tx1 + m || ty < ty0 - m || ty > ty1 + m) { lv.slots[id] = null; }
      }
    }
  }

  _store(lv, id, img) {
    const T = lv.tile, d = pixels(img, T);
    const h = new Float32Array(T * T), p = new Uint8Array(T * T);
    for (let k = 0, n = T * T; k < n; k++) {
      h[k] = this.offset + (d[k * 4] * 256 + d[k * 4 + 1]) * this.scale;
      p[k] = d[k * 4 + 2];
    }
    lv.slots[id] = { h, p };
    this.version++;
    this.lastTileAt = performance.now();
  }

  /** Are all the fine tiles wanted around the last focus in memory? */
  get settled() {
    for (const lv of this.fine) if (lv.loading.size) return false;
    return true;
  }

  /* ── sampling ─────────────────────────────────────────────────────────*/

  _base(x, z) {
    const s = this.site, b = this.base;
    let u = (x / s.cos + s.projW / 2) / b.mpp - 0.5, v = (z + s.projH / 2) / b.mpp - 0.5;
    const w = this.bw, h = this.bh;
    if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001;
    if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * w + i, H = this.baseH;
    return (H[k] * (1 - fu) + H[k + 1] * fu) * (1 - fv) + (H[k + w] * (1 - fu) + H[k + w + 1] * fu) * fv;
  }

  /** Bilinear sample of a streamed level, or NaN if a sample it needs is absent. */
  _fine(lv, x, z) {
    const s = this.site, T = lv.tile;
    const u = (x / s.cos + s.projW / 2) / lv.mpp - 0.5, v = (z + s.projH / 2) / lv.mpp - 0.5;
    const i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0) return NaN;
    const fu = u - i, fv = v - j;
    const tx = (i / T) | 0, ty = (j / T) | 0, li = i - tx * T, lj = j - ty * T;
    if (tx >= lv.across || ty >= lv.down) return NaN;
    const t = lv.slots[ty * lv.across + tx];
    if (!t) return NaN;
    if (li < T - 1 && lj < T - 1) {
      const k = lj * T + li, H = t.h;
      return (H[k] * (1 - fu) + H[k + 1] * fu) * (1 - fv) + (H[k + T] * (1 - fu) + H[k + T + 1] * fu) * fv;
    }
    const a = t.h[lj * T + li];
    const b = this._at(lv, i + 1, j), c = this._at(lv, i, j + 1), d = this._at(lv, i + 1, j + 1);
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;      // NaN propagates
  }
  _at(lv, i, j) {
    const T = lv.tile, tx = (i / T) | 0, ty = (j / T) | 0;
    if (tx >= lv.across || ty >= lv.down) return NaN;
    const t = lv.slots[ty * lv.across + tx];
    return t ? t.h[(j - ty * T) * T + (i - tx * T)] : NaN;
  }

  /**
   * World Y of the measured surface. `cell` = the caller's sample spacing in
   * metres (0 = "the best there is", which is what physics asks for).
   */
  height(x, z, cell = 0) {
    const s = this.site;
    if (x < -s.halfX) x = -s.halfX; else if (x > s.halfX) x = s.halfX;
    if (z < -s.halfZ) z = -s.halfZ; else if (z > s.halfZ) z = s.halfZ;
    if (cell >= CLIPMAP.filterCell) {
      const q = cell / 3;
      let acc = 0;
      for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) acc += this._base(x + oi * q, z + oj * q);
      return acc / 9;
    }
    const need = cell * 0.5;
    for (const lv of this.fine) {
      if (lv.mpp < need) continue;
      const v = this._fine(lv, x, z);
      if (v === v) return v;
    }
    return this._base(x, z);
  }

  /** Gradient (dY/dX, dY/dZ) of the measured surface at step `e` metres. */
  gradient(x, z, e = 2, out = { dx: 0, dz: 0 }) {
    out.dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    out.dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return out;
  }

  /**
   * What the height under (x, z) IS. Returns {cat, mpp, level, text}: cat is a
   * PROV code, mpp the ground sample distance of the level that answered.
   */
  provenance(x, z, cell = 0) {
    const s = this.site;
    const need = cell * 0.5;
    for (const lv of this.fine) {
      if (lv.mpp < need) continue;
      const i = Math.round((x / s.cos + s.projW / 2) / lv.mpp - 0.5), j = Math.round((z + s.projH / 2) / lv.mpp - 0.5);
      if (i < 0 || j < 0) continue;
      const T = lv.tile, tx = (i / T) | 0, ty = (j / T) | 0;
      if (tx >= lv.across || ty >= lv.down) continue;
      const t = lv.slots[ty * lv.across + tx];
      if (!t) continue;
      const b = t.p[(j - ty * T) * T + (i - tx * T)];
      if (b === 255) return { cat: PROV.hirise, mpp: lv.mpp, level: lv.L.id };
      if (b > 64) return { cat: PROV.interpolated, mpp: lv.mpp, level: lv.L.id };
      // 64 or less: this level adds nothing here; the answer is in a coarser one
    }
    const b = this.base;
    let i = Math.round((x / s.cos + s.projW / 2) / b.mpp - 0.5), j = Math.round((z + s.projH / 2) / b.mpp - 0.5);
    i = Math.max(0, Math.min(this.bw - 1, i)); j = Math.max(0, Math.min(this.bh - 1, j));
    const p = this.baseP[j * this.bw + i];
    // A finer level exists for this site but not at this point: if the base is
    // HiRISE-derived the fine tile is simply not loaded (or the caller is on a
    // coarse grid), which is still a measured value, at the base's spacing.
    if (p === 255) return { cat: PROV.hirise, mpp: b.mpp, level: b.L.id };
    if (p > 64) return { cat: PROV.interpolated, mpp: b.mpp, level: b.L.id };
    if (p === 64) return { cat: PROV.ctx, mpp: this._native("64", 20), level: b.L.id };
    return { cat: PROV.none, mpp: b.mpp, level: b.L.id };
  }

  /** A regional site's words for its provenance bytes (manifest height.labels, tools/build_regional.py). */
  _label(byte) { const L = this.site.manifest.height.labels; return L ? L[byte] : null; }
  _native(byte, dflt) { const l = this._label(byte); return l && l.native_m ? l.native_m : dflt; }

  /** provenance() as a bare PROV code, without allocating: the clipmap calls this per vertex. */
  category(x, z, cell = 0) {
    const s = this.site;
    if (x < -s.halfX || x > s.halfX || z < -s.halfZ || z > s.halfZ) return PROV.none;
    const need = cell * 0.5;
    const px = x / s.cos + s.projW / 2, pz = z + s.projH / 2;
    for (const lv of this.fine) {
      if (lv.mpp < need) continue;
      const i = Math.round(px / lv.mpp - 0.5), j = Math.round(pz / lv.mpp - 0.5);
      if (i < 0 || j < 0) continue;
      const T = lv.tile, tx = (i / T) | 0, ty = (j / T) | 0;
      if (tx >= lv.across || ty >= lv.down) continue;
      const t = lv.slots[ty * lv.across + tx];
      if (!t) continue;
      const b = t.p[(j - ty * T) * T + (i - tx * T)];
      if (b === 255) return PROV.hirise;
      if (b > 64) return PROV.interpolated;
    }
    const b = this.base;
    let i = Math.round(px / b.mpp - 0.5), j = Math.round(pz / b.mpp - 0.5);
    i = Math.max(0, Math.min(this.bw - 1, i)); j = Math.max(0, Math.min(this.bh - 1, j));
    const p = this.baseP[j * this.bw + i];
    return p === 255 ? PROV.hirise : p > 64 ? PROV.interpolated : p === 64 ? PROV.ctx : PROV.none;
  }

  /** Human text for the HUD. */
  describe(x, z) {
    const p = this.provenance(x, z);
    if (this.site.manifest.height.labels) {
      // Regional site: the DTM's own name and post spacing; finer levels are interpolation and say so.
      const key = p.cat === PROV.hirise ? "255" : p.cat === PROV.ctx ? "64" : p.cat === PROV.interpolated ? "blend" : "0";
      const l = this._label(key);
      if (!l) return "no data (filled)";
      if (typeof l === "string") return l;
      const lv = this.fine.find((f) => { const v = this._fine(f, x, z); return v === v; });
      const mpp = lv ? lv.mpp : this.base.mpp;
      return `${l.text}, ${l.native_m} m posts` + (l.native_m > mpp ? `, interpolated to ${mpp} m` : "");
    }
    if (p.cat === PROV.hirise) return p.mpp <= 1 ? "HiRISE DTM, 1 m posts" : `HiRISE DTM averaged to ${p.mpp} m`;
    if (p.cat === PROV.ctx) return "CTX DTM, 20 m posts";
    if (p.cat === PROV.interpolated) return "blend of HiRISE and CTX DTMs (interpolated)";
    return "no data (filled)";
  }
}
