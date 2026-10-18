/**
 * THE TERRAIN QUERY API. One object that answers "what is the ground here?"
 * for everything that is not the renderer: the vehicle's wheels, the rocks,
 * entity placement, and (next) the base builder and the astronaut.
 *
 *   surface.height(x, z)        ground Y: measured surface + generated detail
 *   surface.contact(x, z)       ground Y including rocks big enough to feel
 *   surface.normal(x, z, e)     unit normal of height() at footprint e metres
 *   surface.slopeDeg(x, z, e)   slope of height() in degrees
 *   surface.regolith(x, z)      {sand, rock, res, rough} 0..1 (detail provider's heuristic)
 *   surface.describe(x, z)      {height, image, detail} text for the HUD
 *   surface.measured(x, z)      the DATA surface alone (what the DEM says)
 *   surface.flatness(x, z, r)   max |height - best plane| over radius r: is this a place to build?
 *
 * World frame: X east, Z south, Y up, metres, origin at the site centre.
 * height() is deterministic per position ONCE the fine tiles around the point
 * are in memory; while they stream, the answer comes from the next coarser
 * level. `field.settled` says whether that is still happening.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

export class Surface {
  constructor(site, field, imagery, detail, rocks = null) {
    this.site = site; this.field = field; this.imagery = imagery; this.detail = detail; this.rocks = rocks;
    this._g = {};
    this.detailOn = true;
  }
  measured(x, z) { return this.field.height(x, z); }
  height(x, z) {
    return this.field.height(x, z) + (this.detailOn ? this.detail.height(x, z) : 0);
  }
  contact(x, z) {
    const h = this.height(x, z);
    return this.rocks && this.detailOn ? h + this.rocks.bump(x, z) : h;
  }
  normal(x, z, e = 0.5, out = new THREE.Vector3()) {
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }
  slopeDeg(x, z, e = 1.5) {
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  }
  regolith(x, z, out = this._g) { return this.detail.regolith(x, z, out); }
  flatness(x, z, r = 4) {
    const n = this.normal(x, z, r), h0 = this.height(x, z);
    let worst = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const plane = h0 - (n.x * (px - x) + n.z * (pz - z)) / n.y;
      worst = Math.max(worst, Math.abs(this.height(px, pz) - plane));
    }
    return worst;
  }
  describe(x, z) {
    const img = this.imagery.describe(x, z);
    return {
      height: this.field.describe(x, z),
      image: img.text,
      detail: this.detailOn ? "below that: " + this.detail.label : "generated detail off",
      prov: this.field.provenance(x, z),
    };
  }
}
