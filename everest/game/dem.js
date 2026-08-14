/**
 * The mountain itself: terrarium PNG tiles decoded into height, three nested
 * grids deep, sampled as one continuous surface.
 *
 * Three things in here are not obvious and all three were found by measuring:
 *
 *  1. **The tiles must be read back out of a canvas**, so `crossOrigin` and a
 *     service that sends `Access-Control-Allow-Origin: *` are not a nicety —
 *     without them `getImageData` throws and there is no terrain at all.
 *
 *  2. **There is a corrupt scanline at exactly 28.0000°N**, 8,150 m below its
 *     neighbours, in every tile along that parallel, and it runs straight
 *     through the Base Camp approach. It is not noise and a low-pass will not
 *     remove it; it is one row, and it is removed as one row.
 *
 *  3. **The summit is 100 m short.** Every SRTM-lineage model smooths a
 *     summit cone, and the measured maximum here is 8,749 m against a
 *     surveyed 8,848.86. The top of the mountain is corrected back with a
 *     narrow bump rather than left wrong or globally rescaled, because the
 *     error is local to the cone and so is the fix.
 */

import { ELEVATION, DEM_TIERS, DEM_DESPIKE_M, SUMMIT, ORIGIN } from "./config.js?v=ad92696-4d0aec6e";
import { tileWindow, llToLocal } from "./geo.js?v=ad92696-4d0aec6e";
import { fetchWindow } from "./tiles.js?v=ad92696-4d0aec6e";

const decode = ELEVATION.decode;

/** The parallel the corrupt scanline sits on, exactly. */
const BAD_PARALLEL_LAT = 28.0;

/* A single scratch canvas, reused. Creating one per tile is a surprising
   amount of the cost of a window. */
const scratch = document.createElement("canvas");
scratch.width = scratch.height = 256;
const sctx = scratch.getContext("2d", { willReadFrequently: true });

/** One resolution level: a Float32Array of heights over a local-metre box. */
class DemTier {
  /** Bumped on every commit, by any tier.
   *
   *  The clipmap resamples a level only when that level's CENTRE moves — which
   *  means a level built while the elevation data was still arriving keeps
   *  whatever it read then, for as long as the player stands still. Measured
   *  at boot: 3,151 of the 128 m level's 7,200 drawn vertices sat at exactly
   *  y=0 while the field returned 5,748 m at those same positions. Nearly half
   *  a ring of the massif was a flat sheet at sea level — the wedge.
   *
   *  Height data arriving is just as much a reason to rebuild as the player
   *  walking, so this counter gives the terrain something to watch. */
  static version = 0;
  constructor(spec) {
    this.spec = spec;
    this.key = spec.key;
    this.win = null;
    this.data = null;
    this.w = this.h = 0;
    this.covered = 0;
    this.total = 1;
    this.centre = { x: 0, z: 0 };
  }

  /** Build (or rebuild) this tier centred on a point. Resolves when the
   *  window is complete; the data is usable long before that. */
  async build(cx, cz, onProgress, seedFrom) {
    const win = tileWindow(cx, cz, this.spec.half, this.spec.zoom);
    const w = win.pxWidth, h = win.pxHeight;
    const data = new Float32Array(w * h);
    const rowSeen = new Uint8Array(h);

    /* ── Seed the new window with the old one ────────────────────────────
       A fresh Float32Array is all zeros, and the window is committed while
       tiles are still arriving so the player is never left standing over
       nothing. Those two facts together were the wedge: bilinear sampling
       across the boundary between arrived ground at 5,300 m and a not-yet-
       arrived hole at 0 m returns every value in between. Measured at
       (-3392, -768), 827 m from the player: the field returned 3,099.8 m
       where the truth was 5,302.3. The clipmap drew that faithfully, so a
       slab of the massif sank two kilometres — and since it re-opened on
       every rebuild, it "jumped with player movement".

       Seeding from the previous window makes the un-arrived area hold the
       last known surface instead of zero. It is the same ground, sampled a
       few hundred metres off-centre, so the error is metres rather than
       kilometres and it is gone the moment the tile lands. Costs one
       bilinear read per sample of a window that is about to cost a hundred
       network fetches. */
    /* `seedFrom` samples the COARSER tiers, which are loaded at boot and cover
       far more ground. It matters most on a tier's FIRST build: a follow tier
       is built during play, so there is no previous window of its own to copy
       and the buffer would stay zero until tiles land. Committing at 55%
       coverage over those zeros is what put a 2,700 m cliff in the massif —
       measured at (-2690, -770), where far read 5561 m, mid read 5538, and
       near read 2838, which is simply the bilinear blend between arrived
       ground and an un-arrived hole. The straight east-west line it drew was
       the boundary of what had loaded, not anything on the mountain.

       Self first (same resolution, same ground), coarser tiers otherwise, and
       only zero if nothing at all is loaded yet. Index convention matches
       `sample`: vertex-centred over w-1 intervals, not cell-centred over w. */
    if (this.data || seedFrom) {
      const mine = !!this.data;
      for (let j = 0; j < h; j++) {
        const wz = win.minZ + (j / (h - 1)) * win.height;
        for (let i = 0; i < w; i++) {
          const wx = win.minX + (i / (w - 1)) * win.width;
          data[j * w + i] = mine ? this.sample(wx, wz) : seedFrom(wx, wz);
        }
      }
    }

    this.pending = { win, data, w, h, covered: 0, total: win.nx * win.ny };
    const me = this.pending;

    await fetchWindow(win, ELEVATION.url, (img, gx, gy) => {
      if (this.pending !== me) return;                   // retired mid-flight
      sctx.clearRect(0, 0, 256, 256);
      sctx.drawImage(img, 0, 0, 256, 256);
      let px;
      try { px = sctx.getImageData(0, 0, 256, 256).data; }
      catch (e) { return; }                              // tainted — nothing to do
      const ox = gx * 256, oy = gy * 256;
      for (let j = 0; j < 256; j++) {
        const row = (oy + j) * w + ox;
        for (let i = 0; i < 256; i++) {
          const p = (j * 256 + i) * 4;
          data[row + i] = decode(px[p], px[p + 1], px[p + 2]);
        }
        rowSeen[oy + j] = 1;
      }
      me.covered++;
      if (onProgress) onProgress(me.covered / me.total);
      // Swap in as soon as there is enough to stand on, so a rebuild never
      // leaves the player hovering over nothing. Safe now that the buffer is
      // seeded with the previous surface rather than zeros — see `build`.
      if (!this.data || me.covered >= me.total * 0.55) this.commit(me, rowSeen);
    }, () => this.pending !== me);

    if (this.pending === me) this.commit(me, rowSeen, true);
  }

  commit(me, rowSeen, final = false) {
    if (final || !me.despiked) { despike(me.data, me.w, me.h, rowSeen, me.win); me.despiked = true; }
    // Anything built from this surface is now out of date. See Heightfield.version.
    DemTier.version++;
    this.win = me.win; this.data = me.data; this.w = me.w; this.h = me.h;
    this.covered = me.covered; this.total = me.total;
    this.centre = {
      x: (me.win.minX + me.win.maxX) / 2,
      z: (me.win.minZ + me.win.maxZ) / 2,
    };
  }

  get ready() { return !!this.data; }

  /** Bilinear sample in local metres. Edge-clamped — a caller that cares
   *  whether the point was inside asks `contains` first. */
  sample(x, z) {
    const win = this.win;
    let u = (x - win.minX) / win.width * (this.w - 1);
    let v = (z - win.minZ) / win.height * (this.h - 1);
    u = u < 0 ? 0 : u > this.w - 1 ? this.w - 1 : u;
    v = v < 0 ? 0 : v > this.h - 1 ? this.h - 1 : v;
    const i0 = u | 0, j0 = v | 0;
    const i1 = i0 + 1 < this.w ? i0 + 1 : i0;
    const j1 = j0 + 1 < this.h ? j0 + 1 : j0;
    const fx = u - i0, fy = v - j0;
    const d = this.data, w = this.w;
    const a = d[j0 * w + i0], b = d[j0 * w + i1];
    const c = d[j1 * w + i0], e = d[j1 * w + i1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
  }

  /** Distance in metres from (x,z) to the nearest edge of this tier. */
  inset(x, z) {
    const win = this.win;
    return Math.min(x - win.minX, win.maxX - x, z - win.minZ, win.maxZ - z);
  }
}

/**
 * The scanline killer, plus a general spike guard.
 *
 * The artifact is one row wrong by thousands of metres while its neighbours
 * are right, so it is detected per row rather than per sample: if the median
 * absolute departure of a row from the average of the rows either side is
 * larger than a cliff could be, the row is not terrain and is replaced by
 * that average. Doing it per *sample* would also work but would round the
 * shoulders off every genuine ridge crest, which is most of a mountain.
 */
function despike(data, w, h, rowSeen, win) {
  /* ── The 28.0000°N scanline, repaired by latitude ────────────────────
     The row pass below only catches this when the bad parallel lands squarely
     on one row of THIS tier's grid. At z14 it straddles two, so each row is
     half corrupt, each median departure falls under the threshold, and both
     survive — leaving a band ~2,700 m below its neighbours running dead
     east-west through the Base Camp approach. Measured at (-2690, -770):
     far 5561 m, mid 5538 m, near 2838 m. That band is the notch, and because
     it is in the elevation data every renderer drew it faithfully.

     The parallel is known, so this does not need a threshold at all. Convert
     28.0000°N into this window's fractional row, then rebuild the rows it
     touches by interpolating between the nearest clean rows either side.
     Nothing anywhere else on the map is examined, so genuine terrain — ridge
     crests included — cannot be touched. */
  if (win && win.height) {
    const badZ = llToLocal(BAD_PARALLEL_LAT, ORIGIN.lon).z;
    const jf = (badZ - win.minZ) / win.height * (h - 1);
    if (jf > 2 && jf < h - 3) {
      const j0 = Math.floor(jf) - 1, j1 = Math.ceil(jf) + 1;   // rows it can touch
      const a = j0 - 1, b = j1 + 1;                            // clean rows either side
      if (a >= 0 && b < h) {
        for (let j = j0; j <= j1; j++) {
          const t = (j - a) / (b - a);
          for (let i = 0; i < w; i++) {
            data[j * w + i] = data[a * w + i] * (1 - t) + data[b * w + i] * t;
          }
        }
      }
    }
  }

  const probe = new Float64Array(Math.min(w, 128));
  for (let j = 1; j < h - 1; j++) {
    if (rowSeen && !rowSeen[j]) continue;
    const step = Math.max(1, (w / probe.length) | 0);
    let n = 0;
    for (let i = 0; i < w && n < probe.length; i += step, n++) {
      const mid = (data[(j - 1) * w + i] + data[(j + 1) * w + i]) * 0.5;
      probe[n] = Math.abs(data[j * w + i] - mid);
    }
    if (!n) continue;
    const slice = Array.prototype.slice.call(probe, 0, n).sort((a, b) => a - b);
    if (slice[n >> 1] < DEM_DESPIKE_M) continue;
    for (let i = 0; i < w; i++) {
      data[j * w + i] = (data[(j - 1) * w + i] + data[(j + 1) * w + i]) * 0.5;
    }
  }
  // Anything outside the range the planet offers is a decode failure, not
  // terrain. The Dead Sea is -430 m and the sky starts at 8,849.
  for (let k = 0; k < data.length; k++) {
    const v = data[k];
    if (!(v > -500 && v < 9200)) {
      const j = (k / w) | 0, i = k - j * w;
      const up = j > 0 ? data[(j - 1) * w + i] : 0;
      const dn = j < h - 1 ? data[(j + 1) * w + i] : up;
      data[k] = (up + dn) * 0.5;
    }
  }
}

/* ── The summit correction ───────────────────────────────────────────────
   A Gaussian bump on the summit, amplitude = surveyed − measured, σ chosen so
   it has decayed to a metre by 900 m out — about where the DEM stops
   disagreeing with the survey. This is a documented correction to a known
   deficiency of the source, not a licence to sculpt: it is the only place any
   height in this game is not what the elevation model said. */
const SUMMIT_LOCAL = llToLocal(SUMMIT.lat, SUMMIT.lon);
const SUMMIT_LIFT = SUMMIT.surveyed - SUMMIT.dem;
const SUMMIT_SIGMA = 260;
function summitCorrection(x, z) {
  const dx = x - SUMMIT_LOCAL.x, dz = z - SUMMIT_LOCAL.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 900 * 900) return 0;
  return SUMMIT_LIFT * Math.exp(-d2 / (2 * SUMMIT_SIGMA * SUMMIT_SIGMA));
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The three tiers as one surface.
 *
 * A finer tier wins wherever it has data, faded in over a margin so the join
 * is a blend rather than a step. The tiers genuinely disagree — 67 m data and
 * 4 m data over the same ridge are different mountains by tens of metres —
 * so a hard switch is visible as a crease running across the slope.
 */
export class Heightfield {
  constructor() {
    this.tiers = DEM_TIERS.map((s) => new DemTier(s));
    this.byKey = Object.fromEntries(this.tiers.map((t) => [t.key, t]));
    /* How far inside a tier its data is faded in over. Wide on purpose: the
       tiers disagree by a few metres over the same ground (a 4 m sampling and
       a 17 m sampling of the same 30 m source are not the same surface), and
       a narrow blend turns those few metres into a crease you can see running
       across a slope for a kilometre. Spread over 420 m it is a gradient
       nothing picks out. */
    this.margin = 420;
    this.progress = 0;
    this.rebuilding = false;
  }

  /** Load the fixed tiers. The follow tiers are built by `update`. */
  async boot(onProgress) {
    const fixed = this.tiers.filter((t) => !t.spec.follow);
    let done = 0;
    await Promise.all(fixed.map((t) => t.build(0, 0, (f) => {
      this.progress = (done + f) / fixed.length;
      if (onProgress) onProgress(this.progress, t.key);
    }).then(() => { done++; })));
    this.progress = 1;
  }

  /** Re-centre the following tiers when the player has walked far enough that
   *  the window no longer has them comfortably inside it. */
  update(x, z) {
    if (this.rebuilding) return;
    for (let i = 0; i < this.tiers.length; i++) {
      const t = this.tiers[i];
      if (!t.spec.follow) continue;
      /* Measure drift against the REQUESTED centre, not the committed
         window centre. tileWindow snaps to tile boundaries, and a z14 tile
         is ~2.16 km of ground — the snapped centre can land up to ~1.1 km
         from the point that was asked for. At the summit it landed 982 m
         off, which is beyond rebuildAfter (900), so the tier rebuilt toward
         the player, snapped back out of range, and looped forever: 73 ms of
         synchronous seeding per frame, 2.5 fps, thousands of commits. The
         request point drifts only when the player actually walks, which is
         what this test was always meant to measure. */
      const ref = t.reqCentre || t.centre;
      const moved = Math.hypot(x - ref.x, z - ref.z);
      if (t.ready && moved < t.spec.rebuildAfter) continue;
      t.reqCentre = { x, z };
      this.rebuilding = true;
      // Coarser tiers only: they are already loaded and cover more ground.
      const coarser = this.tiers.slice(0, i).filter((o) => o.ready);
      const seedFrom = coarser.length
        ? (sx, sz) => coarser[coarser.length - 1].sample(sx, sz)
        : null;
      t.build(x, z, undefined, seedFrom).finally(() => { this.rebuilding = false; });
      return;                                  // one rebuild at a time
    }
  }

  /** Bumped whenever any tier commits new data — see DemTier.version. */
  get version() { return DemTier.version; }

  /**
   * Height in metres above the geoid at a local point.
   *
   * `detail` — set by the game once photoclinometry has a field — is the relief
   * recovered from the imagery below the elevation model's real 17 m
   * resolution. It is added here, at the single place height is defined, so
   * that the ground the player stands on is the same ground the vertex shader
   * draws. Anywhere else and the two drift apart and the player wades through
   * the ridges. Everything that touches the surface (the player, the camps,
   * the other climbers, the slope warning) goes through this function, so they
   * all inherit it without knowing it exists.
   */
  height(x, z) {
    let h = null;
    for (const t of this.tiers) {
      if (!t.ready) continue;
      const v = t.sample(x, z);
      if (h === null) { h = v; continue; }
      const inset = t.inset(x, z);
      if (inset <= 0) continue;
      h = h + (v - h) * smoothstep(0, this.margin, inset);
    }
    if (h === null) return 0;
    return h + summitCorrection(x, z) + (this.detail ? this.detail.sample(x, z) : 0);
  }

  /** Surface normal, from central differences at a step suited to the scale
   *  being asked about. A 4 m step gives the shape you walk on; a 60 m step
   *  gives the shape of the face, which is what a slope warning should use. */
  normal(x, z, step = 4, out = { x: 0, y: 1, z: 0 }) {
    const hx = this.height(x + step, z) - this.height(x - step, z);
    const hz = this.height(x, z + step) - this.height(x, z - step);
    const d = 2 * step;
    // Gradient (dh/dx, dh/dz) → normal (−dh/dx, 1, −dh/dz), normalised.
    let nx = -hx / d, ny = 1, nz = -hz / d;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len; out.y = ny / len; out.z = nz / len;
    return out;
  }

  /** Slope in degrees. */
  slope(x, z, step = 8) {
    const n = this.normal(x, z, step, _n);
    return Math.acos(Math.min(1, n.y)) * 180 / Math.PI;
  }

  /** Aspect — the compass direction the slope faces, degrees from north.
   *  Which way a slope points decides how much sun it gets, which decides
   *  whether its snow is a slab or a sheet of ice, so this is load-bearing
   *  for the avalanche model rather than decoration. */
  aspect(x, z, step = 20) {
    const n = this.normal(x, z, step, _n);
    return (Math.atan2(n.x, n.z) * 180 / Math.PI + 360) % 360;
  }

  /** Finest tier that actually covers this point — the terrain shader and the
   *  crevasse generator both want to know how much detail is real here. */
  detailAt(x, z) {
    for (let i = this.tiers.length - 1; i >= 0; i--) {
      const t = this.tiers[i];
      if (t.ready && t.inset(x, z) > 0) return t.spec.zoom;
    }
    return DEM_TIERS[0].zoom;
  }
}

const _n = { x: 0, y: 1, z: 0 };
