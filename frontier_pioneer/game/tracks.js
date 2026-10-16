/**
 * Wheel tracks: two rut ribbons the rover leaves in loose regolith.
 *
 * A ring buffer of cross-sections, one ribbon per side (the three wheels of a
 * side roll in the same rut, so the rear wheel's contact line is the track),
 * both ribbons in ONE mesh and one draw call. A cross-section is stamped every
 * half metre travelled; when the ring wraps, the oldest is overwritten.
 *
 * AGREEING WITH THE GROUND. A ribbon vertex stores the MEASURED height at its
 * own x, z and its vertex shader adds the detail provider's displacement with
 * the same GLSL, the same focus and the same distance fade as the terrain's:
 * near the rover the ribbon is on the drawn surface to float precision. It is
 * then lifted 1.5 cm plus a little per metre of camera distance, because the
 * renderer's depth buffer is logarithmic (written per fragment), which makes
 * polygonOffset a no-op. Far from the rover the terrain rings draw coarser
 * data than the ribbon was stamped on, so the ribbon fades out with distance
 * from the rover before that can show.
 *
 * WHAT IT DRAWS. Nothing is lit: the ribbon only darkens what is under it
 * (compacted, disturbed soil is darker), with a cleat pattern along it and
 * soft edges. Strength follows the regolith (none on rock) and the wheel's
 * sinkage (deeper ruts are darker). It fades with distance driven and with
 * time. Tracks are not saved.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";

const STEP = 0.5;            // metres between cross-sections

export class Tracks {
  constructor(game, samples) {
    this.game = game;
    this.N = samples;
    const detail = game.detail, TU = game.terrain.uniforms;
    const n = this.N * 2 * 2;                         // sides x samples x 2 edge vertices
    this.pos = new Float32Array(n * 3);
    this.info = new Float32Array(n * 4);              // u (-1 / +1), odometer, strength, break
    this.born = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aInfo", new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aBorn", new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(2 * this.N * 6);
    let k = 0;
    for (let s = 0; s < 2; s++) for (let i = 0; i < this.N; i++) {
      const a = (s * this.N + i) * 2, b = (s * this.N + (i + 1) % this.N) * 2;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b + 1;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    // every vertex starts as a break, so nothing is drawn until it has been stamped
    for (let i = 0; i < n; i++) this.info[i * 4 + 3] = 1;
    this.uniforms = Object.assign({
      uOdo: { value: 0 }, uNow: { value: 0 }, uLength: { value: samples * STEP * 0.92 }, uLife: { value: 420 },
      uFocus: TU.uFocus, uCamPos: TU.uCamPos, uOn: { value: 1 },
    }, detail.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 aInfo;
        attribute float aBorn;
        uniform vec2 uFocus;
        uniform vec3 uCamPos;
        varying vec4 vInfo;
        varying float vBorn;
        varying float vFar;
        ${detail.glslVertex}
        void main() {
          vec3 p = position;
          float dist = length(p.xz - uFocus);
          p.y += detailHeight(p.xz, dist);
          float dc = length(p - uCamPos);
          p.y += 0.015 + dc * 0.0012;
          vInfo = aInfo; vBorn = aBorn; vFar = dist;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uOdo, uNow, uLength, uLife, uOn;
        varying vec4 vInfo;
        varying float vBorn;
        varying float vFar;
        void main() {
          #include <logdepthbuf_fragment>
          if (vInfo.w > 0.002 || uOn < 0.5) discard;
          float u = abs(vInfo.x);
          float edge = 1.0 - smoothstep(0.62, 1.0, u);
          // cleats: chevrons along the rut
          float cleat = 0.72 + 0.28 * smoothstep(0.35, 0.5, abs(fract(vInfo.y * 2.6 + u * 0.45) - 0.5) * 2.0);
          float old = 1.0 - smoothstep(0.55 * uLength, uLength, uOdo - vInfo.y);
          float age = 1.0 - smoothstep(0.6 * uLife, uLife, uNow - vBorn);
          float far = 1.0 - smoothstep(140.0, 260.0, vFar);
          float a = vInfo.z * edge * cleat * old * age * far;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.012, 0.007, 0.004), a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = "wheel-tracks";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.head = [0, 0];
    this.last = [null, null];
    this.stamped = 0;
    this.visibleStamps = 0;
    this._dirty = false;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }

  /** Lift the pen on one side (wheel in the air, teleport): the next stamp starts a new stroke. */
  lift(side) { this.last[side] = null; }

  /**
   * One side's rear wheel is at (x, z) on the ground. Stamps a cross-section when it has moved STEP.
   * @param strength 0..1 how visible the rut is here   @param halfWidth metres
   */
  roll(side, x, z, odo, now, strength, halfWidth) {
    const L = this.last[side];
    if (L) {
      const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
      if (d < STEP) return;
      if (d > 4) { this.last[side] = null; return this.roll(side, x, z, odo, now, strength, halfWidth); }
      this._stamp(side, x, z, -dz / d, dx / d, odo, now, strength, halfWidth, 0);
      L.x = x; L.z = z;
    } else {
      // first cross-section of a stroke: a break, so the segment from the previous stroke is not drawn
      const v = this.game.vehicle;
      // the direction of travel is not known yet: lay it across the rover's right
      const q = v.q, rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
      const m = Math.hypot(rx, rz) || 1;
      this._stamp(side, x, z, rx / m, rz / m, odo, now, 0, halfWidth, 1);
      this.last[side] = { x, z };
    }
  }

  _stamp(side, x, z, nx, nz, odo, now, strength, hw, brk) {
    const i = this.head[side], field = this.game.field;
    const base = (side * this.N + i) * 2;
    for (let e = 0; e < 2; e++) {
      const s = e ? 1 : -1, px = x + nx * hw * s, pz = z + nz * hw * s, k = base + e;
      this.pos[k * 3] = px; this.pos[k * 3 + 1] = field.height(px, pz); this.pos[k * 3 + 2] = pz;
      this.info[k * 4] = s; this.info[k * 4 + 1] = odo; this.info[k * 4 + 2] = strength; this.info[k * 4 + 3] = brk;
      this.born[k] = now;
    }
    // the cross-section after the head is the oldest: break it so the wrap is never drawn
    const nb = (side * this.N + (i + 1) % this.N) * 2;
    // (and collapse it onto this one: a broken segment is discarded where its break flag interpolates above zero,
    // which leaves a sliver at this end, and a sliver of a segment that runs to an unwritten vertex is metres long)
    for (let e = 0; e < 2; e++) {
      for (let c = 0; c < 3; c++) this.pos[(nb + e) * 3 + c] = this.pos[(base + e) * 3 + c];
      this.info[(nb + e) * 4 + 3] = 1;
    }
    this.head[side] = (i + 1) % this.N;
    this.stamped++;
    if (strength > 0.03 && !brk) this.visibleStamps++;
    this._dirty = true;
  }

  frame(odo, now, on) {
    this.uniforms.uOdo.value = odo; this.uniforms.uNow.value = now; this.uniforms.uOn.value = on ? 1 : 0;
    if (this._dirty) {
      const a = this.mesh.geometry.attributes;
      a.position.needsUpdate = true; a.aInfo.needsUpdate = true; a.aBorn.needsUpdate = true;
      this._dirty = false;
    }
  }

  clear() {
    for (let i = 0; i < this.info.length / 4; i++) this.info[i * 4 + 3] = 1;
    this.last = [null, null]; this._dirty = true; this.visibleStamps = 0;
  }
}
