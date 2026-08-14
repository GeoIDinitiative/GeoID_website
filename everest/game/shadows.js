/**
 * Terrain self-shadowing, by horizon mapping.
 *
 * The mountain had no shadows at all, and on snow the shadow *is* the form —
 * it is why every screenshot read as flat in the mid-distance. The obvious
 * answer is a cascaded shadow map, and for this scene it is the wrong one:
 *
 *  - The thing that matters here is enormous. Nuptse throws a shadow four
 *    kilometres across the Western Cwm; the Lhotse Face is in shade until
 *    ten in the morning. A cascade set that covers 20 km at a useful
 *    resolution is several 2048² depth passes, re-rendered every frame, on
 *    an integrated GPU that is already fill-rate bound.
 *  - The caster and the receiver are the same surface — a heightfield. That
 *    is a much easier problem than the general one, and it has an exact
 *    answer that a shadow map only approximates.
 *
 * So instead: for the sun's current azimuth, precompute for every point the
 * elevation angle of the highest terrain along that bearing — the *horizon
 * angle*. A point is in shadow exactly when the sun is below its horizon.
 * One texture fetch and one comparison per fragment, no cascades, no depth
 * bias, no peter-panning, and it is correct out to twenty-eight kilometres.
 *
 * The cost moves to precomputation, which is why it is amortised across
 * frames and only redone when the sun has moved a few degrees.
 *
 * What this does NOT do is shadow the props — tents, seracs, the climber —
 * because they are not in the heightfield. They get an ordinary shadow map
 * from three.js, which is cheap because it only has to cover a few hundred
 * metres.
 */

import * as THREE from "../vendor/three.module.js?v=07181a5-177e95b0";

/** 512 over the mid tier's ~17 km is 34 m a texel. A mountain's shadow is a
 *  kilometre-scale object; resolving it finer buys nothing and costs the
 *  precompute time squared. */
const RES = 512;
/** Geometric march: 32 steps at 1.2× reaches ~1,700 cells ≈ 28 km, which is
 *  past anything that can shade you, while spending most of the samples in
 *  the first few hundred metres where the angle changes fastest. */
const STEPS = 32;
const GROWTH = 1.2;
/** Recompute when the sun has moved this far in azimuth or altitude. At 8×
 *  time the sun moves about 2° a minute, so this is every ~90 seconds. */
const REDO_DEG = 3;

export class TerrainShadows {
  constructor(field, halfExtent = 8600) {
    this.field = field;
    this.half = halfExtent;
    this.data = new Uint8Array(RES * RES * 4);
    this.texture = new THREE.DataTexture(this.data, RES, RES, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.bounds = new THREE.Vector4(-halfExtent, -halfExtent, halfExtent * 2, halfExtent * 2);
    this.centre = { x: 0, z: 0 };
    this.builtAz = NaN;
    this.builtCentre = { x: NaN, z: NaN };
    this.row = RES;                 // RES = finished
    this.pending = null;
    this.cell = (halfExtent * 2) / RES;
  }

  /** Does the map need rebuilding for this sun and this position? */
  needsRebuild(azimuth, cx, cz) {
    if (this.row < RES) return false;                       // already working
    const moved = Math.hypot(cx - this.builtCentre.x, cz - this.builtCentre.z);
    let dAz = Math.abs(((azimuth - this.builtAz + 540) % 360) - 180);
    return !(dAz < REDO_DEG) || !(moved < this.half * 0.25) || Number.isNaN(this.builtAz);
  }

  begin(azimuth, cx, cz) {
    // Direction the sun lies in, on the ground: azimuth 0 = north = -z.
    const a = azimuth * Math.PI / 180;
    this.pending = {
      dx: Math.sin(a), dz: -Math.cos(a),
      cx, cz, az: azimuth,
      minX: cx - this.half, minZ: cz - this.half,
    };
    this.row = 0;
    this.scratch = this.scratch || new Uint8Array(RES * RES * 4);
  }

  /**
   * Compute some rows. Returns true when the map is finished.
   *
   * Amortised because a full pass is about eight million heightfield lookups
   * — a third of a second in one go, which is a visible stall every ninety
   * seconds. Spread over ~40 frames nobody sees it, and the old map stays on
   * screen until the new one is complete.
   */
  work(budgetMs = 3.5) {
    if (this.row >= RES || !this.pending) return true;
    const t0 = performance.now();
    const { dx, dz, minX, minZ } = this.pending;
    const f = this.field;
    const cell = this.cell;
    const s = this.scratch;

    while (this.row < RES) {
      const j = this.row;
      const wz = minZ + (j + 0.5) * cell;
      for (let i = 0; i < RES; i++) {
        const wx = minX + (i + 0.5) * cell;
        const h0 = f.height(wx, wz);
        let best = 0;                       // tan of the horizon angle
        let dist = cell;
        let step = cell;
        for (let k = 0; k < STEPS; k++) {
          const h = f.height(wx + dx * dist, wz + dz * dist);
          const t = (h - h0) / dist;
          if (t > best) best = t;
          step *= GROWTH;
          dist += step;
        }
        // Store sin(angle) rather than tan: bounded 0..1, and it is what the
        // shader compares against sin(sun altitude).
        const sin = best <= 0 ? 0 : best / Math.sqrt(1 + best * best);
        const p = (j * RES + i) * 4;
        s[p] = Math.min(255, (sin * 255) | 0);
        s[p + 1] = s[p]; s[p + 2] = s[p]; s[p + 3] = 255;
      }
      this.row++;
      if (performance.now() - t0 > budgetMs) break;
    }

    if (this.row >= RES) {
      this.data.set(s);
      this.texture.needsUpdate = true;
      this.bounds.set(this.pending.minX, this.pending.minZ, this.half * 2, this.half * 2);
      this.builtAz = this.pending.az;
      this.builtCentre = { x: this.pending.cx, z: this.pending.cz };
      this.pending = null;
      return true;
    }
    return false;
  }

  /** @param sun  {altitude, azimuth} in degrees */
  update(sun, cx, cz, budgetMs) {
    if (this.needsRebuild(sun.azimuth, cx, cz)) this.begin(sun.azimuth, cx, cz);
    this.work(budgetMs);
  }

  bind(uniforms, sunAltitudeDeg) {
    uniforms.horizonMap.value = this.texture;
    uniforms.horizonBounds.value = this.bounds;
    uniforms.sunSin.value = Math.sin(sunAltitudeDeg * Math.PI / 180);
  }
}
