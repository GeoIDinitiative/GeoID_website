/**
 * Rocks: generated, instanced, and felt by the wheels.
 *
 * NOT DATA. HiRISE resolves boulders of a metre or more as a pixel or two;
 * nothing says where a 30 cm rock is. These are placed by a hash of the
 * ground cell (so the same rock is in the same place on every visit, and the
 * wheels and the picture agree about it), with a density taken from the
 * detail provider's "rock" heuristic and a power-law size distribution: many
 * cobbles, few boulders. In the data-honesty view they are drawn magenta.
 *
 * One rock at most per 2 m cell. `at(ci, cj)` is the single definition; the
 * renderer instances what it returns and `bump()` turns the same rocks into
 * height for the physics.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const CELL = 2;
const MIN_FELT = 0.3;          // rocks smaller than this are scenery only

export class Rocks {
  constructor(detail, quality) {
    this.detail = detail;
    this.group = new THREE.Group();
    this.group.name = "rocks";
    this.variants = [];
    this.material = new THREE.MeshLambertMaterial({ color: 0xa27b60 });
    this.honesty = false;
    for (let v = 0; v < 3; v++) this.variants.push(makeRock(v));
    this._r = {}; this._g = {};
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.builtAt = { x: NaN, z: NaN };
    this.count = 0;
    this.setQuality(quality);
  }

  setQuality(q) {
    for (const m of this.meshes || []) { this.group.remove(m); m.dispose(); }
    this.max = q.rocks; this.range = q.rockRange;
    this.meshes = this.variants.map((g, i) => {
      const m = new THREE.InstancedMesh(g, this.material, Math.ceil(this.max / 3) + 8);
      m.name = "rocks-" + i; m.frustumCulled = false; m.count = 0;
      this.group.add(m);
      return m;
    });
    this.builtAt.x = NaN;
  }

  setHonesty(on) {
    this.honesty = on;
    this.material.color.set(on ? 0xff33cc : 0xa27b60);
    this.material.emissive.set(on ? 0x66104f : 0x000000);
  }

  /** The rock in cell (ci, cj), or null. Deterministic. */
  at(ci, cj, out = this._r) {
    const d = this.detail;
    const g = d.regolith((ci + 0.5) * CELL, (cj + 0.5) * CELL, this._g);
    // (a styled site's regolith also says where the ground is ice or a cleared site: few rocks there; detailstyle.js)
    const density = Math.min(0.8, 0.10 + 0.55 * Math.pow(g.rock, 1.2)) * (1 - 0.55 * g.sand) * (1 - 0.85 * (g.ice || 0)) * (1 - 0.8 * (g.calm || 0));
    if (d._lat(ci + 17, cj + 101, 1) >= density) return null;
    const u = d._lat(ci + 53, cj + 7, 2);
    out.size = Math.min(1.6, 0.12 * Math.pow(1 - u * 0.992, -0.5));
    out.x = (ci + 0.15 + 0.7 * d._lat(ci + 5, cj + 77, 3)) * CELL;
    out.z = (cj + 0.15 + 0.7 * d._lat(ci + 131, cj + 19, 2)) * CELL;
    out.yaw = d._lat(ci + 211, cj + 43, 1) * Math.PI * 2;
    out.variant = (d._lat(ci + 3, cj + 3, 3) * 3) | 0;
    out.squash = 0.5 + 0.35 * d._lat(ci + 9, cj + 61, 1);
    return out;
  }

  /** Height a wheel feels from rocks at (x, z): a paraboloid cap per rock big enough to matter. */
  bump(x, z) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let h = 0;
    for (let b = cj - 1; b <= cj + 1; b++) for (let a = ci - 1; a <= ci + 1; a++) {
      const r = this.at(a, b);
      if (!r || r.size < MIN_FELT) continue;
      const hw = r.size * 0.7, dx = x - r.x, dz = z - r.z, d2 = (dx * dx + dz * dz) / (hw * hw);
      if (d2 < 1) h = Math.max(h, r.size * r.squash * 0.75 * (1 - d2));
    }
    return h;
  }

  /** Rebuild the instances around the focus when it has moved far enough. */
  update(fx, fz, surface) {
    if (Math.hypot(fx - this.builtAt.x, fz - this.builtAt.z) < 9) return;
    this.builtAt.x = fx; this.builtAt.z = fz;
    const R = this.range, n = Math.ceil(R / CELL);
    const c0 = Math.floor(fx / CELL), c1 = Math.floor(fz / CELL);
    const counts = [0, 0, 0], cap = this.meshes[0].instanceMatrix.count;
    let total = 0;
    for (let b = -n; b <= n; b++) for (let a = -n; a <= n; a++) {
      if (a * a + b * b > n * n) continue;
      const r = this.at(c0 + a, c1 + b);
      if (!r) continue;
      // Far away, only the rocks big enough to see.
      const dist = Math.hypot(a, b) * CELL;
      if (r.size < 0.12 + dist * 0.004) continue;
      const v = r.variant % 3;
      if (counts[v] >= cap || total >= this.max) continue;
      const y = surface.height(r.x, r.z);
      const sy = r.size * r.squash;
      this._e.set(0, r.yaw, 0);
      this._q.setFromEuler(this._e);
      this._s.set(r.size * 0.72, sy, r.size * 0.72);
      this._p.set(r.x, y + sy * 0.28, r.z);
      this._m.compose(this._p, this._q, this._s);
      this.meshes[v].setMatrixAt(counts[v]++, this._m);
      total++;
    }
    for (let v = 0; v < 3; v++) { this.meshes[v].count = counts[v]; this.meshes[v].instanceMatrix.needsUpdate = true; }
    this.count = total;
  }
}

function makeRock(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = 1234 + seed * 977;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Displace along the normal by a value keyed on the vertex position, so
  // duplicated vertices of the non-indexed icosahedron stay welded.
  const key = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(3) + "," + p.getY(i).toFixed(3) + "," + p.getZ(i).toFixed(3);
    if (!key.has(k)) key.set(k, 0.72 + rnd() * 0.5);
    const f = key.get(k);
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * (p.getY(i) < 0 ? 0.6 : 1), p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}
