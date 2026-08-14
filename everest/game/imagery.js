/**
 * What the mountain looks like: Esri World Imagery, four nested windows deep,
 * composited into four canvases that the terrain shader blends between.
 *
 * 67 → 17 → 4.2 → 0.53 metres per pixel. The last of those is the reason the
 * ground under your boots reads as snow with a texture rather than as a
 * coloured plane: at half a metre a pixel you can see sastrugi, the tracks of
 * the fixed line, and the shadow of a serac.
 *
 * **No backdrop is painted under a window.** Tiles that have not landed stay
 * transparent, so the coarser tier below shows through and the picture fills
 * in rather than popping. Measured on the Mars fork: first tile at 122 ms and
 * last at 1524 ms, and waiting for the last one meant the imagery existed for
 * 1.4 seconds before anyone could see it.
 *
 * **The previous window is kept until the new one is worth showing.** A tier
 * that blanks while it re-centres is a hole opening under the player.
 */

import * as THREE from "../vendor/three.module.js?v=5d280e5-e507c198";
import { IMAGERY, IMG_TIERS } from "./config.js?v=5d280e5-e507c198";
import { tileWindow } from "./geo.js?v=5d280e5-e507c198";
import { fetchWindow } from "./tiles.js?v=5d280e5-e507c198";

/* ── The next thing to do here: compressed textures ───────────────────────
   The four tiers currently hold about 410 MB of RGBA8, plus a third again for
   mipmaps. It runs at a locked 60 fps on the Intel Xe this was built against,
   but it is the ceiling of the current design and the first thing that will
   break on a weaker GPU.

   This context already exposes everything needed (probed, not assumed):

       EXT_texture_compression_bptc   BC7   -> 8 bpp   410 MB -> ~102 MB
       WEBGL_compressed_texture_s3tc  DXT1  -> 4 bpp   410 MB ->  ~51 MB
       WEBGL_compressed_texture_etc / astc  also present
       MAX_TEXTURE_SIZE 16384

   The catch is that WebGL cannot compress on the GPU: the data has to arrive
   already compressed. That means either a build step that emits KTX2 per tile,
   or vendoring the Basis transcoder WASM and decoding at load. Both are real
   work; neither changes a line of the rendering below.

   Worth stating plainly, because it was asked and the answer is easy to get
   wrong: none of this is a browser limitation. Compression, 16k textures and
   WebGL2 are all here. The things that actually bound this project's fidelity
   are the imagery ceiling (0.53 m/px — z19 measured as an upsample), the
   elevation model (~17 m real resolution), and the fact that four fixed square
   windows cannot satisfy `tier m/px <= distance / pixelsPerRadian` at every
   range at once. A desktop build fixes none of those. A frustum-driven
   quadtree fixes the third, and licensed imagery is the only thing that moves
   the first. */
const TILE_PX = 256;

/**
 * Unsharp mask, once per tier build.
 *
 * This is not an attempt to invent detail — Esri's z18 at 0.53 m/px is the
 * real ceiling and nothing recovers information that was never captured. It
 * is there to give back the sharpness the GPU takes away *after* the tiles
 * land: the canvas is uploaded as a texture and then sampled bilinearly,
 * through a mip chain, at grazing angles across a mountainside. Every one of
 * those steps is a low-pass. The source is sharper than what reaches the eye,
 * and this pre-compensates for that.
 *
 * Deliberately conservative, because the last thing done to this imagery in
 * the name of improvement was `destripe`, which wrote per-column offsets into
 * the picture and produced the vertical banding it was meant to remove. The
 * differences here are bounded: a 1-pixel radius so only the finest detail is
 * touched, a modest amount, and a hard clamp so no pixel can move more than
 * `MAX_STEP` levels. Structure is emphasised; nothing is invented, and no
 * pixel can be pushed far from what the satellite recorded.
 */
/** On. The regression it was disabled for turned out to be a broken
 *  measurement on my side, not a cost in the game: the frame loop measures a
 *  clean 16.6 ms with rAF unthrottled, render at 1.9 ms. This pass runs once
 *  per tier build and measured 3x the high-frequency energy of the raw tile
 *  with zero clipped pixels. */
const SHARPEN_ON = true;
const SHARPEN_AMOUNT = 0.55;   // strength of the high-pass added back
const SHARPEN_MAX_STEP = 26;   // no pixel may move further than this, of 255

function sharpen(ctx, w, h) {
  if (w < 8 || h < 8) return;
  let img;
  try { img = ctx.getImageData(0, 0, w, h); }
  catch (e) { return; }                       // tainted canvas — leave it alone
  const d = img.data;
  const src = new Uint8ClampedArray(d);       // blur reads the original only

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] < 250) continue;         // not yet filled — skip
      for (let c = 0; c < 3; c++) {
        const i = o + c;
        // 3x3 box mean of the original
        const m = (src[i - w * 4 - 4] + src[i - w * 4] + src[i - w * 4 + 4]
                 + src[i - 4]         + src[i]        + src[i + 4]
                 + src[i + w * 4 - 4] + src[i + w * 4] + src[i + w * 4 + 4]) / 9;
        let delta = (src[i] - m) * SHARPEN_AMOUNT;
        if (delta > SHARPEN_MAX_STEP) delta = SHARPEN_MAX_STEP;
        else if (delta < -SHARPEN_MAX_STEP) delta = -SHARPEN_MAX_STEP;
        d[i] = src[i] + delta;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Level the tiles against each other.
 *
 * **This is what the vertical lines on the mountains actually were.** Esri's
 * World Imagery is a mosaic: neighbouring tiles can come from different
 * satellite passes on different days, and each carries its own exposure. Butt
 * two of them together and there is a brightness step down the join — and
 * since every tile is 256 px, the joins are evenly spaced, which is what made
 * them read as a deliberate overlay rather than as data.
 *
 * Measured on the mid tier: the mean brightness step across a tile boundary
 * is **2.74× the step anywhere else** (3.10 against 1.13). JPEG's 8 px block
 * grid, checked at the same time, is 1.05 — not a factor.
 *
 * The fix is the standard mosaic one. Measure the step across each seam from
 * a band either side, then solve for one offset per tile row and per tile
 * column such that the steps cancel, and re-centre so the whole image does
 * not drift. Separable — columns then rows — because a full 2D solve buys
 * nothing when the error is per-strip.
 *
 * It runs on the composited canvas, once per tier build.
 */
function levelTiles(ctx, w, h) {
  const nx = Math.round(w / TILE_PX), ny = Math.round(h / TILE_PX);
  if (nx < 2 && ny < 2) return;
  let img;
  try { img = ctx.getImageData(0, 0, w, h); }
  catch (e) { return; }
  const d = img.data;
  const BAND = 4;                       // columns/rows sampled either side

  const lumAt = (x, y) => {
    const i = (y * w + x) * 4;
    return d[i + 3] < 250 ? NaN
      : 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  };

  /**
   * The step across one seam, as the MEDIAN of the local difference measured
   * independently on each line crossing it.
   *
   * Averaging whole bands does not work and the mid tier proved it: over
   * 1,792 px the band mean is dominated by real terrain — valley at one end,
   * summit at the other — so the difference between the two sides is mostly
   * scenery and the seam offset is lost in it. That tier stayed at 2.45 while
   * every other one came down to 0.9. Measured line by line, the seam offset
   * is the one thing every line agrees about, and the median ignores the
   * lines where a genuine ridge happens to run along the join.
   */
  const seamStep = (b, vertical, from = 0, to = vertical ? h : w) => {
    const step = Math.max(1, ((to - from) / 200) | 0);
    const diffs = [];
    for (let v = from; v < to; v += step) {
      let l = 0, r = 0, ln = 0, rn = 0;
      for (let k = 1; k <= BAND; k++) {
        const a = vertical ? lumAt(b - k, v) : lumAt(v, b - k);
        const c = vertical ? lumAt(b + k - 1, v) : lumAt(v, b + k - 1);
        if (!Number.isNaN(a)) { l += a; ln++; }
        if (!Number.isNaN(c)) { r += c; rn++; }
      }
      if (ln && rn) diffs.push(r / rn - l / ln);
    }
    if (diffs.length < 5) return 0;
    diffs.sort((p, q) => p - q);
    return diffs[diffs.length >> 1];
  };

  /* ── One offset per TILE, not per row and column ──────────────────────
     A row-offset plus a column-offset is a rank-1 model, and the error is
     not rank-1: every tile is potentially its own acquisition with its own
     exposure. That approximation fixed the 4×4 tiers and left the 7×7 mid
     tier at 2.49 — it simply cannot represent 49 independent offsets with 14
     numbers.

     So: measure the step across every seam *segment* (each pair of adjacent
     tiles, over their shared edge only), then relax the offsets until the
     seams agree. Gauss-Seidel, forty sweeps, forty-nine unknowns — the whole
     solve is microseconds next to reading the pixels. */
  const idx = (i, j) => j * nx + i;
  const vStep = new Float64Array(Math.max(1, (nx - 1) * ny));   // between i,i+1
  const hStep = new Float64Array(Math.max(1, nx * (ny - 1)));   // between j,j+1
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      vStep[j * (nx - 1) + i] =
        seamStep((i + 1) * TILE_PX, true, j * TILE_PX, (j + 1) * TILE_PX);
    }
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx; i++) {
      hStep[j * nx + i] =
        seamStep((j + 1) * TILE_PX, false, i * TILE_PX, (i + 1) * TILE_PX);
    }
  }

  const off = new Float64Array(nx * ny);
  for (let iter = 0; iter < 40; iter++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0, n = 0;
        if (i > 0)      { s += off[idx(i - 1, j)] - vStep[j * (nx - 1) + i - 1]; n++; }
        if (i < nx - 1) { s += off[idx(i + 1, j)] + vStep[j * (nx - 1) + i];     n++; }
        if (j > 0)      { s += off[idx(i, j - 1)] - hStep[(j - 1) * nx + i];     n++; }
        if (j < ny - 1) { s += off[idx(i, j + 1)] + hStep[j * nx + i];           n++; }
        if (n) off[idx(i, j)] = s / n;
      }
    }
  }
  let mean = 0;
  for (let k = 0; k < off.length; k++) mean += off[k];
  mean /= off.length;
  // Clamp: this corrects an exposure difference between passes, it is not
  // licensed to repaint the mosaic.
  for (let k = 0; k < off.length; k++) {
    off[k] = Math.max(-20, Math.min(20, off[k] - mean));
  }

  for (let y = 0; y < h; y++) {
    const tj = Math.min(ny - 1, (y / TILE_PX) | 0);
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const c = off[idx(Math.min(nx - 1, (x / TILE_PX) | 0), tj)];
      if (c === 0) continue;
      const i = row + x * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + c));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + c));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + c));
    }
  }
  // Same buffer, before it goes back: the fine column-mean pass mops up
  // what the per-tile offsets could not represent.
  destripe(d, w, h);
  ctx.putImageData(img, 0, 0);
}

/**
 * De-striping, by column-mean equalisation.
 *
 * The Esri mosaic over this massif carries **vertical striping**. Measured on
 * the composited tiers: the detrended variance of the column means is about
 * twice that of the row means in every fine tier (mid 5.8 against 2.8, ultra
 * 3.9 against 2.0), while the far tier — downsampled hard enough to average
 * it away — is 1.03 and shows none. That is the signature of pushbroom
 * detector-to-detector gain differences, which bright uniform targets like
 * snow show up worse than anything else.
 *
 * It is invisible in an adjacent-pixel difference (the bands are tens of
 * pixels wide, so neighbouring pixels agree) which is why an earlier check
 * measured a ratio of 0.93 and concluded the imagery was clean. Bands have to
 * be measured as bands.
 *
 * The fix is the standard one in remote sensing: take the mean of every
 * column, low-pass that profile along x, and add back the difference. Real
 * scene content survives — a ridge is not a one-pixel-wide column — while a
 * detector that reads consistently 3% hot across the whole frame does not.
 *
 * Done once per tier build on the canvas, so the cost is a read and a write
 * of one image rather than anything per frame.
 */
function destripe(d, w, h) {
  if (w < 64 || h < 64) return;

  // Column means, from every third row — a mean over hundreds of samples
  // does not need all of them, and this is the expensive half.
  const sum = new Float64Array(w), n = new Float64Array(w);
  for (let y = 0; y < h; y += 3) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (d[i + 3] < 250) continue;
      sum[x] += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n[x]++;
    }
  }
  const mean = new Float64Array(w);
  for (let x = 0; x < w; x++) mean[x] = n[x] ? sum[x] / n[x] : NaN;

  /* Low-pass the profile with a box of ±K. K must be wider than a stripe and
     narrower than real terrain: 24 px is ~400 m at the mid tier and ~13 m at
     ultra, which is on the right side of both. */
  const K = 24;
  const corr = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    if (Number.isNaN(mean[x])) continue;
    let s = 0, c = 0;
    for (let k = -K; k <= K; k++) {
      const j = x + k;
      if (j < 0 || j >= w || Number.isNaN(mean[j])) continue;
      s += mean[j]; c++;
    }
    if (!c) continue;
    // Clamped: this corrects a calibration offset, it does not get to
    // rewrite the picture.
    corr[x] = Math.max(-20, Math.min(20, s / c - mean[x]));
  }

  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const c = corr[x];
      if (c === 0) continue;
      const i = row + x * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + c));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + c));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + c));
    }
  }
}

class ImgTier {
  constructor(spec) {
    this.spec = spec;
    this.key = spec.key;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 4;
    this.ctx = this.canvas.getContext("2d");
    this.rebuildTexture();
    /** (minX, minZ, width, height) in local metres — how the shader turns a
     *  world position into a UV in this canvas. */
    this.bounds = new THREE.Vector4(0, 0, 1, 1);
    this.centre = { x: 0, z: 0 };
    this.ready = false;
    this.covered = 0; this.total = 1;
  }

  /** A fresh texture over the same canvas. The uniform holds this object, so
   *  the owner must re-point it — `Imagery.uniforms()` is read once at
   *  material construction, and `syncUniforms` is what keeps it true after. */
  rebuildTexture() {
    if (this.texture) this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    /* Anisotropy is *the* lever for how sharp the ground looks, because
       almost every pixel of it is seen at a grazing angle from eye height.
       At 8 the imagery two metres in front of your boots is being averaged
       across a dozen texels and reads as a blur; at the hardware maximum
       (16 on anything current) it stays legible right into the distance.
       It costs samples, not memory. */
    this.texture.anisotropy = Imagery.maxAnisotropy;
    this.texture.generateMipmaps = true;
  }

  async build(cx, cz, onProgress) {
    const zoom = Math.min(this.spec.zoom, IMAGERY.maxZoom);
    const win = tileWindow(cx, cz, this.spec.half, zoom);

    // Compose into a detached canvas so the live one keeps its old picture
    // right up to the moment the new one is better than nothing.
    const next = document.createElement("canvas");
    next.width = win.pxWidth; next.height = win.pxHeight;
    const nctx = next.getContext("2d");
    /* Seed the new window with the previous one's pixels first. Same zoom,
       same scale — the old canvas just slides by the recentre offset. The
       overlap (nearly all of it) starts as yesterday's sharp picture and
       each arriving tile replaces its patch; only the freshly exposed strip
       at the leading edge waits on the network. Without this, every commit
       during a walk showed the not-yet-landed HALF of the window as the
       coarse tier underneath — smeared grey-olive areas crawling across
       the mountain with the window, worst at altitude where the coarse
       tiers stretch furthest. (The flight sim's repaint-from-cache, done
       here with the previous canvas as the cache.) */
    if (this.ready && this.canvas.width > 4) {
      const mpp = win.width / win.pxWidth;
      const dx = Math.round((this.bounds.x - win.minX) / mpp);
      const dy = Math.round((this.bounds.y - win.minZ) / mpp);
      nctx.drawImage(this.canvas, dx, dy);
    }
    const me = { win, next, nctx, covered: 0, total: win.nx * win.ny };
    this.pending = me;

    await fetchWindow(win, IMAGERY.url, (img, gx, gy) => {
      if (this.pending !== me) return;
      nctx.drawImage(img, gx * 256, gy * 256, 256, 256);
      me.covered++;
      if (onProgress) onProgress(me.covered / me.total);
      if (!this.ready || me.covered >= me.total * 0.5) this.commit(me);
    }, () => this.pending !== me);

    if (this.pending === me) this.commit(me);
  }

  commit(me) {
    if (this.canvas.width !== me.next.width || this.canvas.height !== me.next.height) {
      // Resizing a canvas that already backs a texture makes three.js try a
      // partial upload against the old dimensions —
      // `glCopySubTextureCHROMIUM: Offset overflows texture dimensions`, once
      // per frame forever. The texture has to be rebuilt, not resized.
      this.canvas.width = me.next.width;
      this.canvas.height = me.next.height;
      this.rebuildTexture();
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(me.next, 0, 0);
    /* ── The tiles are drawn as they arrive. Nothing is done to them. ──────
     *
     * `levelTiles` used to run here, and inside it `destripe`. Both are now
     * off, and destripe is why.
     *
     * destripe took the mean brightness of every COLUMN of the composited
     * canvas, low-passed that profile over +/-24 px, and added the difference
     * back to every pixel in the column — clamped to +/-20 levels. That is the
     * standard correction for pushbroom sensor striping, where a per-detector
     * gain error really does put a constant offset down one column of the
     * image. Esri's mosaic is not a pushbroom strip. It is orthorectified
     * imagery of a mountain, and over a mountain the column means vary for
     * entirely real reasons: a sunlit ridge in one column, a shadowed gully in
     * the next. Subtracting that as though it were a calibration fault does
     * not remove striping, it *writes* striping — a per-column brightness
     * offset of up to 8%, straight down the frame.
     *
     * The measured banding was ~4.7 of 255, comfortably inside the +/-20 this
     * was allowed to add.
     *
     * It also explains why none of it could be found. Nine runtime candidates
     * were switched off one at a time — shadows, de-lighting, micro-relief,
     * recovered relief, snow, rock, post, mipmaps, anisotropy — and every one
     * reported 0%. They would. This happens once, at tier build, and is baked
     * into the canvas pixels; by the time any uniform is read the stripes are
     * already part of the picture. A diagnostic that can only toggle uniforms
     * is blind to the whole build stage, and that blind spot cost most of a
     * day.
     *
     * `levelTiles` (per-tile Gauss-Seidel exposure levelling) goes with it.
     * Its seams measured 1.04-1.13 against a control *with it running*, but it
     * is still the kind of manipulation being removed here, and the tiles it
     * corrects are a mosaic Esri already balanced. Map them as they are. */
    /* Only once the window is complete: sharpening a half-filled canvas would
       run the kernel across the boundary between arrived tiles and empty
       space, drawing a bright rim around whatever had landed so far. */
    if (SHARPEN_ON && me.covered >= me.total && !me.sharpened) {
      sharpen(this.ctx, this.canvas.width, this.canvas.height);
      me.sharpened = true;
    }
    this.texture.needsUpdate = true;
    this.bounds.set(me.win.minX, me.win.minZ, me.win.width, me.win.height);
    this.centre = { x: me.win.minX + me.win.width / 2, z: me.win.minZ + me.win.height / 2 };
    this.covered = me.covered; this.total = me.total;
    this.ready = true;
  }
}

export class Imagery {
  /** Set from the renderer's capabilities before any tier is built. */
  static maxAnisotropy = 8;

  constructor() {
    this.tiers = IMG_TIERS.map((s) => new ImgTier(s));
    this.byKey = Object.fromEntries(this.tiers.map((t) => [t.key, t]));
    this.rebuilding = false;
    this.progress = 0;
  }

  async boot(onProgress) {
    const fixed = this.tiers.filter((t) => !t.spec.follow);
    let done = 0;
    await Promise.all(fixed.map((t) => t.build(0, 0, (f) => {
      this.progress = (done + f) / fixed.length;
      if (onProgress) onProgress(this.progress, t.key);
    }).then(() => { done++; })));
    this.progress = 1;
  }

  /**
   * @param x,z  the player, in local metres
   *
   * Windows follow the PLAYER only. See the note in config.js IMG_TIERS: they
   * were briefly offset along the camera heading, which made the map re-centre
   * whenever you turned on the spot and slid the window off whatever you were
   * not facing.
   */
  update(x, z) {
    if (this.rebuilding) return;
    // Finest first: the half-metre window under the player matters more than
    // the four-metre one around them, and only one rebuild runs at a time so
    // that the budget is not split between two windows racing each other.
    for (let i = this.tiers.length - 1; i >= 0; i--) {
      const t = this.tiers[i];
      if (!t.spec.follow) continue;
      const moved = Math.hypot(x - t.centre.x, z - t.centre.z);
      if (t.ready && moved < t.spec.rebuildAfter) continue;
      this.rebuilding = true;
      t.build(x, z).finally(() => { this.rebuilding = false; });
      return;
    }
  }

  uniforms() {
    const u = this._u || (this._u = {});
    for (const t of this.tiers) {
      u["map_" + t.key] = { value: t.texture };
      u["bounds_" + t.key] = { value: t.bounds };
    }
    return u;
  }

  /** Re-point the map uniforms at the current textures. Cheap, and it has to
   *  run every frame because a tier that changes window size builds a new
   *  texture and the material would otherwise keep sampling the disposed one
   *  — which renders black rather than throwing. */
  syncUniforms(target) {
    for (const t of this.tiers) {
      const u = target["map_" + t.key];
      if (u && u.value !== t.texture) u.value = t.texture;
    }
  }
}
