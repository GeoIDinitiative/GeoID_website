/**
 * The picture draped on the ground.
 *
 * Two kinds of level, both from the site manifest:
 *
 *  - the BASE (CTX, 5 m grid, whole site): every tile loaded at boot into one
 *    single-channel texture. It is also kept on the CPU, because the detail
 *    provider conditions on its brightness and that must not depend on what
 *    has streamed in.
 *  - WINDOWS (HiRISE at 2 m and 0.5 m): a 4 x 4 tile texture per level that
 *    follows the rover. Channel R is the picture and G is coverage, so a tile
 *    that does not exist (outside HiRISE) or has not landed yet is simply
 *    transparent and the level below shows through. The pipeline levels
 *    HiRISE's brightness to CTX and feathers it at the coverage edge, so the
 *    cross-fade has nothing to hide.
 *
 * The sensors are single-band. The colour on screen is a tint the terrain
 * shader applies; it is not data.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { IMAGERY_WINDOW_TILES } from "./config.js?v=6d37c9c-9b39e129";
import { fetchTile, pixels } from "./tiles.js?v=6d37c9c-9b39e129";

export class Imagery {
  constructor(site, renderer) {
    this.site = site;
    this.maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    const levels = site.imageryLevels;             // coarsest first
    this.baseLevel = levels[0];
    this.base = null;                              // {data, width, height}
    this.baseTex = null;
    this.windows = levels.slice(1).map((L) => this._makeWindow(L));
    this.uniforms = {
      uImgBase: { value: null },
      uImgBaseRect: { value: new THREE.Vector4() },        // x0, z0, 1/w, 1/h in world metres
      uImgA: { value: null }, uImgARect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uImgB: { value: null }, uImgBRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uImgAOn: { value: 0 }, uImgBOn: { value: 0 },
    };
    this.lastUpload = 0;
  }

  _makeWindow(L) {
    const n = IMAGERY_WINDOW_TILES, T = L.tile, size = n * T;
    const data = new Uint8Array(size * size * 2);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, this.maxAniso);
    tex.needsUpdate = true;
    return { L, n, T, size, data, tex, tx0: NaN, ty0: NaN, dirty: false, cache: new Map(), loading: new Set(), gen: 0 };
  }

  setAnisotropy(a) {
    const v = Math.min(a, this.maxAniso);
    for (const w of this.windows) { w.tex.anisotropy = v; w.tex.needsUpdate = true; }
    if (this.baseTex) { this.baseTex.anisotropy = v; this.baseTex.needsUpdate = true; }
  }

  async loadBase(onProgress) {
    const L = this.baseLevel, T = L.tile, site = this.site;
    const w = L.tiles_across * T, h = L.tiles_down * T;
    const data = new Uint8Array(w * h);
    let done = 0;
    await Promise.all(L.tiles.map(async ([tx, ty]) => {
      const img = await fetchTile(site.tileUrl(L, tx, ty), 0);
      const d = pixels(img, T);
      for (let j = 0; j < T; j++) {
        const row = (ty * T + j) * w + tx * T;
        for (let i = 0; i < T; i++) data[row + i] = d[(j * T + i) * 4];
      }
      onProgress && onProgress(++done, L.tiles.length);
    }));
    this.base = { data, width: w, height: h };
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, this.maxAniso);
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.baseTex = tex;
    this.uniforms.uImgBase.value = tex;
    this.uniforms.uImgBaseRect.value.set(-site.halfX, -site.halfZ, 1 / (2 * site.halfX), 1 / (2 * site.halfZ));
    const U = this.uniforms;
    if (this.windows[0]) { U.uImgA.value = this.windows[0].tex; U.uImgAOn.value = 1; }
    if (this.windows[1]) { U.uImgB.value = this.windows[1].tex; U.uImgBOn.value = 1; }
  }

  /** Follow the rover. Cheap to call every frame. */
  update(fx, fz, now = performance.now()) {
    const site = this.site;
    for (let wi = 0; wi < this.windows.length; wi++) {
      const w = this.windows[wi], L = w.L;
      const span = w.T * L.mpp;                                        // projected metres per tile
      const px = fx / site.cos + site.projW / 2, pz = fz + site.projH / 2;
      // Origin such that the rover is in the middle two tiles; hysteresis of half a tile.
      const wantX = Math.round(px / span) - w.n / 2, wantY = Math.round(pz / span) - w.n / 2;
      if (wantX !== w.tx0 || wantY !== w.ty0) {
        const cx = (w.tx0 + w.n / 2) * span, cy = (w.ty0 + w.n / 2) * span;
        if (!(Math.abs(px - cx) < span * 0.75 && Math.abs(pz - cy) < span * 0.75)) this._recentre(w, wantX, wantY, px, pz);
      }
      if (w.dirty && now - this.lastUpload > 120) {
        w.tex.needsUpdate = true; w.dirty = false; this.lastUpload = now;
      }
      const rect = wi === 0 ? this.uniforms.uImgARect.value : this.uniforms.uImgBRect.value;
      const x0 = (w.tx0 * span - site.projW / 2) * site.cos, z0 = w.ty0 * span - site.projH / 2;
      const ww = w.n * span * site.cos, wh = w.n * span;
      if (Number.isFinite(x0)) rect.set(x0, z0, 1 / ww, 1 / wh);
    }
  }

  _recentre(w, tx0, ty0, px, pz) {
    w.tx0 = tx0; w.ty0 = ty0;
    const gen = ++w.gen;
    w.data.fill(0);
    w.dirty = true;
    const L = w.L, span = w.T * L.mpp;
    const want = new Set();
    for (let j = 0; j < w.n; j++) for (let i = 0; i < w.n; i++) {
      const tx = tx0 + i, ty = ty0 + j, key = tx + "_" + ty;
      if (!L.has.has(key)) continue;
      want.add(key);
      const hit = w.cache.get(key);
      if (hit) { this._blit(w, i, j, hit); continue; }
      if (w.loading.has(key)) continue;
      w.loading.add(key);
      const d = Math.hypot((tx + 0.5) * span - px, (ty + 0.5) * span - pz);
      fetchTile(this.site.tileUrl(L, tx, ty), 2 + d / 1000, () => !w.want || !w.want.has(key))
        .then((img) => {
          const d4 = pixels(img, w.T), g = new Uint8Array(w.T * w.T);
          for (let k = 0; k < g.length; k++) g[k] = d4[k * 4];
          w.cache.set(key, g);
          if (w.cache.size > 48) w.cache.delete(w.cache.keys().next().value);
          const ii = tx - w.tx0, jj = ty - w.ty0;
          if (ii >= 0 && jj >= 0 && ii < w.n && jj < w.n) this._blit(w, ii, jj, g);
        })
        .catch(() => {})
        .finally(() => w.loading.delete(key));
    }
    w.want = want;
  }

  _blit(w, i, j, g) {
    const T = w.T, S = w.size, D = w.data;
    for (let y = 0; y < T; y++) {
      let o = ((j * T + y) * S + i * T) * 2, k = y * T;
      for (let x = 0; x < T; x++, o += 2, k++) { D[o] = g[k]; D[o + 1] = 255; }
    }
    w.dirty = true;
  }

  /** Upload whatever has landed, now. */
  flush() { for (const w of this.windows) if (w.dirty) { w.tex.needsUpdate = true; w.dirty = false; } }

  get settled() {
    for (const w of this.windows) if (w.loading.size || w.dirty) return false;
    return true;
  }

  /** Text for the HUD: which imagery is under (x, z). */
  describe(x, z) {
    const s = this.site;
    for (let wi = this.windows.length - 1; wi >= 0; wi--) {
      const L = this.windows[wi].L;
      const tx = Math.floor((x / s.cos + s.projW / 2) / (L.tile * L.mpp)), ty = Math.floor((z + s.projH / 2) / (L.tile * L.mpp));
      if (L.has.has(tx + "_" + ty)) return { mpp: L.mpp, text: L.label ? `${L.label} (drawn at ${L.mpp} m)` : `HiRISE image, ${L.mpp} m` };
    }
    // A regional site's levels carry their own words (tools/build_regional.py); Jezero and Gale do not.
    const B = this.baseLevel;
    return B.label ? { mpp: B.mpp, text: `${B.label} (drawn at ${B.mpp} m)` } : { mpp: 6, text: "CTX image, 6 m" };
  }
}

/** GLSL: brightness (0..1) of the ground at a world position, finest level that covers it. */
export const IMAGERY_GLSL = /* glsl */`
  uniform sampler2D uImgBase, uImgA, uImgB;
  uniform vec4 uImgBaseRect, uImgARect, uImgBRect;
  uniform float uImgAOn, uImgBOn;

  float imgWindow(sampler2D t, vec4 rect, vec2 xz, inout float lum) {
    vec2 uv = (xz - rect.xy) * rect.zw;
    vec2 e = min(uv, 1.0 - uv);
    float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
    if (edge <= 0.0) return 0.0;
    vec2 s = texture2D(t, uv).rg;
    float w = edge * smoothstep(0.5, 1.0, s.g);
    // The coverage channel is filtered along with the picture, so un-premultiply.
    lum = mix(lum, s.r / max(s.g, 0.004), w);
    return w;
  }

  /* Returns brightness; fine comes back 0 (CTX only), 1 (HiRISE 2 m) or 2 (HiRISE 0.5 m), fractional in the fades. */
  float groundImage(vec2 xz, out float fine) {
    vec2 uv = clamp((xz - uImgBaseRect.xy) * uImgBaseRect.zw, 0.0, 1.0);
    float lum = texture2D(uImgBase, uv).r;
    fine = 0.0;
    if (uImgAOn > 0.5) fine += imgWindow(uImgA, uImgARect, xz, lum);
    if (uImgBOn > 0.5) fine += imgWindow(uImgB, uImgBRect, xz, lum);
    return lum;
  }
`;
