/**
 * Terrain self-shadowing by horizon mapping, ported from the Everest game.
 *
 * For the Sun's current azimuth, every point of a grid over the whole site
 * stores the sine of the elevation angle of the highest ground along that
 * bearing. A fragment is in shadow exactly when the Sun is below its horizon:
 * one fetch, no cascades, correct across the 20 km of the site. This is what
 * puts the delta scarp and the crater rim in shade at sunrise and sunset.
 *
 * Everest switched this off because its stored map had 8-bit steps and a
 * penumbra narrower than the difference between neighbouring texels, which
 * drew needles along the terminator. Here the map is half-float and the
 * shader's penumbra (0.05 in sine) is several texels wide.
 *
 * Built from the 16 m base level only, spread over frames, redone when the
 * Sun has moved 3 degrees in azimuth. It does not shadow the rover or the
 * rocks (the rover has its own analytic shadow in the terrain shader).
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";

const STEPS = 36, GROWTH = 1.16, REDO_DEG = 3;

export class TerrainShadows {
  constructor(field, res = 512) {
    this.field = field;
    this.res = res;
    const site = field.site;
    this.data = new Uint16Array(res * res);
    this.scratch = new Float32Array(res * res);
    this.texture = new THREE.DataTexture(this.data, res, res, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.rect = new THREE.Vector4(-site.halfX, -site.halfZ, 1 / (2 * site.halfX), 1 / (2 * site.halfZ));
    this.cellX = 2 * site.halfX / res; this.cellZ = 2 * site.halfZ / res;
    this.builtAz = NaN; this.row = res; this.pending = null; this.ready = false;
  }

  update(sun, budgetMs = 3) {
    if (this.row >= this.res) {
      const dAz = Math.abs(((sun.azimuth - this.builtAz + 540) % 360) - 180);
      if (!(dAz < REDO_DEG)) {
        const a = sun.azimuth * Math.PI / 180;
        this.pending = { dx: Math.sin(a), dz: -Math.cos(a), az: sun.azimuth };
        this.row = 0;
      }
    }
    if (this.row >= this.res || !this.pending) return;
    const t0 = performance.now(), f = this.field, R = this.res, site = f.site;
    const { dx, dz } = this.pending, s = this.scratch, cell = Math.max(this.cellX, this.cellZ);
    while (this.row < R) {
      const j = this.row, wz = -site.halfZ + (j + 0.5) * this.cellZ;
      for (let i = 0; i < R; i++) {
        const wx = -site.halfX + (i + 0.5) * this.cellX;
        const h0 = f._base(wx, wz);
        let best = 0, dist = cell, step = cell;
        for (let k = 0; k < STEPS; k++) {
          const t = (f._base(wx + dx * dist, wz + dz * dist) - h0) / dist;
          if (t > best) best = t;
          step *= GROWTH; dist += step;
        }
        s[j * R + i] = best <= 0 ? 0 : best / Math.sqrt(1 + best * best);
      }
      this.row++;
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.row >= R) {
      for (let k = 0; k < s.length; k++) this.data[k] = THREE.DataUtils.toHalfFloat(s[k]);
      this.texture.needsUpdate = true;
      this.builtAz = this.pending.az; this.pending = null; this.ready = true;
    }
  }

  bind(u, on) {
    u.uHorizon.value = this.texture;
    u.uHorizonRect.value.copy(this.rect);
    u.uHorizonOn.value = on && this.ready ? 1 : 0;
  }
}
