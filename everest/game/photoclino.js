/**
 * Photoclinometry — getting geometry back out of the picture.
 *
 * The measurement in `tools/dem_information.mjs` settles what this game is
 * actually short of. The elevation model carries real information down to
 * about 17 metres and not one metre further; everything below that is the
 * publisher's interpolation of 30 m SRTM. The imagery, meanwhile, is real at
 * 0.53 m per pixel — `tools/imagery_information` territory, confirmed against
 * Esri directly: z18 is genuine, z19 is an upsample.
 *
 * So there is a factor of thirty between what we can *see* and what we can
 * *stand on*, and that gap is the whole reason this mountain renders as a
 * smooth blob with a photograph painted over it. No shader fixes that. A
 * shader can only shade the surface it is given.
 *
 * But the photograph is not decoration — it is a measurement of how a real
 * surface reflected real sunlight, and the surface it measured had all the
 * detail the elevation model is missing. Recovering shape from that is
 * photoclinometry, and it is how planetary scientists have made 100 m/px
 * elevation models render believably against 0.25 m imagery for forty years.
 *
 * ── The physics ──────────────────────────────────────────────────────────
 * For a surface z = h(x, y) with normal N ∝ (−hx, 1, −hz) lit by unit vector
 * L, a Lambertian reflector returns I = a·(N·L). For small slopes,
 *
 *     N·L ≈ Ly − (Lx·hx + Lz·hz)
 *
 * so, writing Lh = (Lx, Lz) for the sun's horizontal part and B for the local
 * mean brightness,
 *
 *     (I − B) / B  ≈  −(Lh · ∇h) / Ly
 *
 * The left side is something we can measure per pixel. The right side is the
 * slope **along the sun azimuth**. That asymmetry is the important part and it
 * is what the old micro-relief code got wrong: it treated the luminance
 * gradient as slope in both axes, but brightness carries almost no information
 * across the sun direction. Half of what it was amplifying was noise.
 *
 * ── Why integrate rather than differentiate ──────────────────────────────
 * Perturbing the normal by the brightness gradient shades a surface that is
 * still geometrically flat: the silhouette stays smooth, nothing occludes
 * anything, and at a grazing angle the illusion collapses. Integrating the
 * slope gives a *height*, and a height can displace vertices, break a skyline,
 * and be walked on. That is the difference between a texture trick and terrain.
 *
 * The integration is a single sweep along the sun azimuth with a leaky
 * accumulator. The leak length is set to the elevation model's real resolution,
 * which makes this a high-pass by construction: detail finer than 17 m comes
 * from the imagery, everything coarser stays the DEM's business. The two never
 * argue, and drift — the classic failure of shape-from-shading, where a slow
 * bias integrates into a continent-sized ramp — cannot accumulate past one
 * leak length.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 * It is not a substitute for a real 1 m DSM, and it should not be described as
 * one. Albedo and shape are genuinely confounded in a single image: a dark
 * rock on flat ground and a shadowed slope of clean snow can produce the same
 * pixel, and nothing in one image separates them. What keeps that honest here
 * is the leak (a mistake cannot propagate far), the amplitude clamp, and
 * dropping the gain where the surface is not snow — snow is close to
 * Lambertian and fairly uniform in albedo, which is exactly when this works.
 * On mixed rock the recovered relief is plausible rather than surveyed, and
 * the code says so where it applies it.
 */

import * as THREE from "../vendor/three.module.js?v=9dab064-9baec5c2";

/** The elevation model's true resolution, in metres — measured, not assumed.
 *  Detail is only invented below this; above it the DEM keeps authority. */
export const DEM_TRUE_M = 17;

/** Metres of relief the field is allowed to carry, either way. The recovered
 *  band is 4–17 m wavelength; real snow and rock relief at that wavelength is
 *  a couple of metres, and anything much larger is the integrator drifting
 *  rather than the mountain doing something. Also the range the 16-bit
 *  encoding is spread over, so it sets the quantisation: ±3 m in 65536 steps
 *  is 0.09 mm, which is not the limiting error by a very long way. */
export const RANGE_M = 3.0;

/** Ground resolution the field is built at: half the clipmap's shortest
 *  representable wavelength (2 x 2 m cells), so it resolves everything the
 *  geometry can express and nothing it cannot. It also now matches the near
 *  imagery tier's own 2.1 m/px almost exactly, which means the field is built
 *  from the source at full rate rather than throwing three quarters of it away
 *  on the way in. */
export const TARGET_PX_M = 2.0;

/** Three box passes approximate a Gaussian well enough for a low-pass whose
 *  cutoff is already a judgement call. Separable, in place, O(n) per pass. */
function boxBlur(src, dst, w, h, r) {
  const tmp = new Float32Array(w * h);
  const pass = (a, b, W, H, stride, step) => {
    const inv = 1 / (2 * r + 1);
    for (let j = 0; j < H; j++) {
      const base = j * stride;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[base + Math.min(W - 1, Math.max(0, k)) * step];
      for (let i = 0; i < W; i++) {
        b[base + i * step] = acc * inv;
        const out = base + Math.min(W - 1, Math.max(0, i - r)) * step;
        const inn = base + Math.min(W - 1, Math.max(0, i + r + 1)) * step;
        acc += a[inn] - a[out];
      }
    }
  };
  // horizontal then vertical, twice over, then once more horizontally
  pass(src, tmp, w, h, w, 1);
  pass(tmp, dst, h, w, 1, w);
  pass(dst, tmp, w, h, w, 1);
  pass(tmp, dst, h, w, 1, w);
  pass(dst, tmp, w, h, w, 1);
  dst.set(tmp);
}

/**
 * Build a height-detail field from one imagery tier.
 *
 * @param canvas      the tier's composited canvas
 * @param metresWide  ground width the canvas covers
 * @param sun         unit THREE.Vector3, the sun the imagery was captured under
 * @returns {{data: Uint8Array, w: number, h: number, peak: number, rms: number}}
 *          RGBA8; R and G carry a 16-bit fixed-point height over ±RANGE_M,
 *          B carries a confidence (how snow-like, so how trustworthy).
 */
export function buildField(canvas, metresWide, sun) {
  const cw = canvas.width, ch = canvas.height;
  const srcPx = metresWide / cw;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, cw, ch).data;

  /* Build at the resolution the geometry can actually carry, not the
     resolution the imagery happens to have. The clipmap's finest cell is 4 m,
     so nothing shorter than an 8 m wavelength can be displaced no matter how
     fine this field is — and the near tier is 2.1 m/px, four times finer than
     that. Averaging down to ~4 m/px first costs nothing real and makes every
     pass below it a quarter of the work, which is the difference between a
     rebuild you notice and one you do not. */
  const stride = Math.max(1, Math.round(TARGET_PX_M / srcPx));
  const w = Math.floor(cw / stride), h = Math.floor(ch / stride);
  const px = srcPx * stride;
  if (w < 32 || h < 32) return null;

  const L = new Float32Array(w * h);
  const inv = 1 / (stride * stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < stride; j++) {
        const row = ((y * stride + j) * cw + x * stride) * 4;
        for (let i = 0; i < stride; i++) {
          const o = row + i * 4;
          s += 0.2126 * img[o] + 0.7152 * img[o + 1] + 0.0722 * img[o + 2];
        }
      }
      L[y * w + x] = s * inv / 255;
    }
  }

  /* Local mean brightness. The radius is the DEM's real resolution, so what
     survives the subtraction is exactly the band the DEM cannot describe —
     and, usefully, the large-scale albedo differences (rock band vs snow
     field) go with it, since those are broad. */
  const B = new Float32Array(w * h);
  boxBlur(L, B, w, h, Math.max(1, Math.round(DEM_TRUE_M / px)));

  /* Sun geometry. Ly is the vertical part; |Lh| the horizontal. A sun near
     the zenith carries almost no shape information (nothing casts a gradient),
     and a sun near the horizon carries too much to trust — the small-slope
     approximation fails and the real surface is half in shadow. Both ends are
     damped rather than cut off, so the field degrades instead of flickering. */
  const Ly = Math.max(0.12, sun.y);
  const lhx = sun.x, lhz = sun.z;
  const lh = Math.hypot(lhx, lhz);
  if (lh < 1e-3) return null;                    // sun straight up: no signal
  const dx = lhx / lh, dz = lhz / lh;            // unit horizontal sun direction
  // Confidence in the inversion itself, by sun elevation.
  const geom = Math.min(1, lh / 0.35) * Math.min(1, Ly / 0.30);

  /* ∂h/∂s along the sun direction, from the brightness residual. The sign is
     negative because a slope tilted *towards* the sun is brighter, and s runs
     towards the sun. */
  const g = new Float32Array(w * h);
  for (let i = 0, n = w * h; i < n; i++) {
    const b = Math.max(0.04, B[i]);
    let r = (L[i] - b) / b;
    // A residual beyond ±0.5 is a shadow edge, a cloud or a crevasse, not a
    // gentle slope. Clamping keeps one bad pixel from launching the integrator.
    r = Math.max(-0.5, Math.min(0.5, r));
    g[i] = -r * Ly / lh;
  }

  /* ── The sweep ──
     Walk the grid along the dominant axis of the sun direction. Each step
     reads the previous point *on the same ray* — which lies in the previous
     column (or row), already written — with a linear interpolation across the
     minor axis. One pass, no iteration, exact coverage.

        h[p] = h[p − step] · leak + slope · ds

     `leak` is the high-pass: after one DEM resolution's worth of ground, a
     contribution has decayed by 1/e, so nothing the imagery says can outvote
     the elevation model at the scales the model actually knows about. */
  const H = new Float32Array(w * h);
  const major = Math.abs(dx) >= Math.abs(dz);
  const ds = px / Math.max(Math.abs(dx), Math.abs(dz));   // metres per step
  const leak = Math.exp(-ds / DEM_TRUE_M);

  if (major) {
    const slope = dz / dx;                       // rows crossed per column
    const step = dx > 0 ? -1 : 1;                // walk from upwind
    const x0 = dx > 0 ? 0 : w - 1;
    for (let x = x0; x >= 0 && x < w; x -= step) {
      const xp = x + step;
      const back = -step * slope;                // row offset of the previous point
      for (let y = 0; y < h; y++) {
        let prev = 0;
        if (xp >= 0 && xp < w) {
          const yf = y + back;
          const y0 = Math.floor(yf), t = yf - y0;
          const ya = Math.min(h - 1, Math.max(0, y0));
          const yb = Math.min(h - 1, Math.max(0, y0 + 1));
          prev = H[ya * w + xp] * (1 - t) + H[yb * w + xp] * t;
        }
        H[y * w + x] = prev * leak + g[y * w + x] * ds;
      }
    }
  } else {
    const slope = dx / dz;
    const step = dz > 0 ? -1 : 1;
    const y0s = dz > 0 ? 0 : h - 1;
    for (let y = y0s; y >= 0 && y < h; y -= step) {
      const yp = y + step;
      const back = -step * slope;
      for (let x = 0; x < w; x++) {
        let prev = 0;
        if (yp >= 0 && yp < h) {
          const xf = x + back;
          const x0 = Math.floor(xf), t = xf - x0;
          const xa = Math.min(w - 1, Math.max(0, x0));
          const xb = Math.min(w - 1, Math.max(0, x0 + 1));
          prev = H[yp * w + xa] * (1 - t) + H[yp * w + xb] * t;
        }
        H[y * w + x] = prev * leak + g[y * w + x] * ds;
      }
    }
  }

  /* The sweep is one-sided: a ray only knows what it has already passed over,
     so relief comes out with a slight bias downwind. A short blur across the
     sun direction costs nothing and takes the streaking out. */
  const S = new Float32Array(w * h);
  boxBlur(H, S, w, h, 1);

  /* Encode. Confidence rides in B: snow is close to Lambertian and close to
     uniform in albedo, which is when the inversion above is trustworthy. On
     dark rock, albedo and shape are confounded and the recovered relief is a
     guess, so it is faded down rather than shown at full strength. */
  const out = new Uint8Array(w * h * 4);
  let peak = 0, sum = 0;
  for (let i = 0, n = w * h; i < n; i++) {
    const v = Math.max(-RANGE_M, Math.min(RANGE_M, S[i]));
    const u = Math.round(((v / RANGE_M) * 0.5 + 0.5) * 65535);
    const o = i * 4;
    out[o] = (u >> 8) & 255;
    out[o + 1] = u & 255;
    const snowish = Math.min(1, Math.max(0, (B[i] - 0.34) / 0.26));
    out[o + 2] = Math.round(255 * geom * (0.30 + 0.70 * snowish));
    out[o + 3] = 255;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { data: out, w, h, peak, rms: Math.sqrt(sum / (w * h)), geom };
}

/**
 * Owns the detail texture and keeps it in step with an imagery tier.
 *
 * Rebuilt when the tier it reads has been rebuilt — the field is only
 * meaningful over the ground its source canvas covers, so its bounds are that
 * canvas's bounds and nothing else.
 */
export class Photoclinometry {
  /** @param tierKey which imagery tier to read. The near tier is the right
   *   one: at ~2 m per pixel it resolves the 4–17 m band this is trying to
   *   recover with several samples to spare, and it covers enough ground to
   *   reach the horizon a walker actually cares about. The ultra tier is finer
   *   but only 220 m across, and the mid tier is 8 m/px — too coarse to say
   *   anything the DEM has not already said. */
  constructor(tierKey = "near") {
    this.tierKey = tierKey;
    this.bounds = new THREE.Vector4(0, 0, 1, 1);
    this.texture = null;
    this.field = null;                 // kept on the CPU so the ground can be queried
    this.stamp = -1;
    this.stats = null;
    this.strength = 0;                 // 0 until a sun estimate has landed
  }

  /** @param sun  the capture sun from `estimateCaptureSun`, or null if the
   *   estimate has not landed. Without it there is no inversion to do: the
   *   whole method turns on knowing which way the light came from. */
  update(imagery, sun) {
    if (!sun) return false;
    const tier = imagery.byKey[this.tierKey];
    if (!tier || !tier.canvas || tier.canvas.width < 64) return false;
    // `bounds.z` is the ground width; a rebuild moves it or the canvas size.
    const stamp = tier.bounds.x * 31 + tier.bounds.y * 7 + tier.canvas.width;
    if (stamp === this.stamp) return false;

    const built = buildField(tier.canvas, tier.bounds.z, sun);
    if (!built) return false;
    this.stamp = stamp;
    this.stats = { peak: built.peak, rms: built.rms, geom: built.geom, px: built.w };
    this.field = built;
    this.bounds.copy(tier.bounds);

    if (this.texture) this.texture.dispose();
    this.texture = new THREE.DataTexture(built.data, built.w, built.h,
      THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.strength = 1;
    return true;
  }

  /**
   * Height offset in metres at a world position, bilinear, 0 outside.
   *
   * The ground has to agree with the picture of it. If the shader displaces a
   * ridge by two metres and the collision model does not, the player walks
   * through it — so `Heightfield.height` adds this, and everything that stands
   * on the ground (the player, the camps, the other climbers) inherits it from
   * there rather than each having to remember.
   */
  sample(x, z) {
    const f = this.field;
    if (!f || !this.strength) return 0;
    const b = this.bounds;
    const u = (x - b.x) / b.z, v = (z - b.y) / b.w;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const fx = u * (f.w - 1), fy = v * (f.h - 1);
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const jx = Math.min(f.w - 1, ix + 1), jy = Math.min(f.h - 1, iy + 1);
    const at = (px, py) => {
      const o = (py * f.w + px) * 4;
      const u16 = (f.data[o] << 8) | f.data[o + 1];
      const conf = f.data[o + 2] / 255;
      return ((u16 / 65535) * 2 - 1) * RANGE_M * conf;
    };
    return (at(ix, iy) * (1 - tx) + at(jx, iy) * tx) * (1 - ty)
         + (at(ix, jy) * (1 - tx) + at(jx, jy) * tx) * ty;
  }

  bind(u) {
    u.detailMap.value = this.texture;
    u.detailBounds.value = this.bounds;
    u.detailRange.value = RANGE_M;
    u.detailOn.value = this.texture ? this.strength : 0;
  }
}
