/**
 * The ground, as a geometry clipmap: nested square rings centred on the
 * rover, each twice the cell size and twice the reach of the one inside it.
 * 12.5 cm under the wheels, 256 m at the horizon.
 *
 * Forked from the Everest game's terrain.js: the rings-with-holes layout, the
 * two-cell apron for normals, "fill every vertex, even inside the hole", and
 * the rule that a level's morph target must be computed with the PARENT's own
 * sampling are all its lessons. Three things are different here.
 *
 * 1. THE MORPH IS IN THE VERTEX SHADER. Every vertex carries its own height
 *    and the height its parent level draws at that point (exact, by parity:
 *    on a parent vertex, on the middle of a parent edge, or in the middle of a
 *    parent cell). The blend between them is a function of distance from the
 *    FOCUS, not of where the level happens to be snapped, so a level can
 *    re-snap under the rover without the ground moving at all, and need only
 *    re-snap every N/8 cells instead of every two.
 *
 * 2. DETAIL BELOW THE DATA IS DISPLACED ON THE GPU. The CPU samples only the
 *    measured surface (heightfield.js). The vertex shader adds the detail
 *    provider's height (detail.js), which is the same function the physics
 *    evaluates on the CPU. Because that displacement is not linear across a
 *    cell, it is morphed toward the parent too: in the blend band a vertex
 *    evaluates the detail at its parent-lattice neighbours and takes what the
 *    parent's triangle edge would have there. Without that the rings crack by
 *    a fraction of the detail's amplitude.
 *
 * 3. EVERY VERTEX KNOWS ITS PROVENANCE, for the data-honesty view.
 *
 * Why the holes line up: level i snaps its centre to a multiple of `snap`
 * cells (N/8, a multiple of 2), so its centre is always on its parent's
 * vertex lattice and the parent's hole is a whole number of parent cells.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { CLIPMAP, PROVENANCE_COLOURS } from "./config.js?v=6d37c9c-9b39e129";
import { PROV } from "./heightfield.js?v=6d37c9c-9b39e129";
import { IMAGERY_GLSL } from "./imagery.js?v=6d37c9c-9b39e129";
import { SKY_GLSL } from "./sky.js?v=6d37c9c-9b39e129";

const AP = 2;        // apron cells sampled around every level

function vertexShader(detail) {
  return /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aSurf;       // x: parent's height here, y: provenance, z/w: parity (1 = odd) along x and z
  attribute vec4 aGrad;       // own dY/dX, dY/dZ, then the parent's
  uniform vec2  uFocus;       // world x, z the rings are centred on
  uniform vec4  uLevel;       // cell size, morph start radius, morph end radius, 1 if this level evaluates detail
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDisp;
  flat varying float vProv;
  ${detail.glslVertex}

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 xz = wp.xz;
    vec2 d = abs(xz - uFocus);
    float a = smoothstep(uLevel.y, uLevel.z, max(d.x, d.y));
    float h = mix(position.y, aSurf.x, a);
    vec2 g = mix(aGrad.xy, aGrad.zw, a);

    float disp = 0.0;
    vec2 dg = vec2(0.0);
    if (uLevel.w > 0.5 && uDetailOn > 0.0) {
      float dist = length(xz - uFocus);
      vec4 c = dCond(xz);
      float c0 = detailHeightC(xz, dist, c);
      float e = uLevel.x;
      float cx = detailHeightC(xz + vec2(e, 0.0), dist, c);
      float cz = detailHeightC(xz + vec2(0.0, e), dist, c);
      dg = vec2(cx - c0, cz - c0) / e;
      disp = c0;
      if (a > 0.0) {
        // What the parent's surface carries at this point.
        float p;
        bool ox = aSurf.z > 0.5, oz = aSurf.w > 0.5;
        if (!ox && !oz) p = c0;
        else if (ox && !oz) p = 0.5 * (detailHeightC(xz - vec2(e, 0.0), dist, c) + cx);
        else if (!ox && oz) p = 0.5 * (detailHeightC(xz - vec2(0.0, e), dist, c) + cz);
        else p = 0.25 * (detailHeightC(xz + vec2(-e, -e), dist, c) + detailHeightC(xz + vec2(e, -e), dist, c)
                       + detailHeightC(xz + vec2(-e, e), dist, c) + detailHeightC(xz + vec2(e, e), dist, c));
        disp = mix(c0, p, a);
      }
    }
    wp.y = h + disp;
    vWorld = wp.xyz;
    vDisp = disp;
    vProv = aSurf.y;
    vNormal = normalize(vec3(-(g.x + dg.x), 1.0, -(g.y + dg.y)));
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;
}

function fragmentShader(detail) {
  const P = PROVENANCE_COLOURS, v3 = (c) => `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;
  return /* glsl */`
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDisp;
  flat varying float vProv;

  uniform vec3  uSunColor, uAmbSky, uAmbGround;
  uniform vec3  uCamPos;
  uniform vec2  uFocus;
  uniform float uHazeK;          // extinction per metre = tau / dust scale height
  uniform float uHonesty;        // 1 = tint the ground by where each value came from
  uniform vec4  uSiteRect;       // half extents x, z; fade width
  uniform sampler2D uHorizon;    // sine of the horizon angle toward the Sun
  uniform vec4  uHorizonRect;
  uniform float uHorizonOn;
  // The rover's shadow: two oriented boxes (body, undercarriage).
  uniform mat4  uBoxInv[2];
  uniform vec3  uBoxHalf[2];
  uniform float uBoxOn;
  // Headlights
  uniform vec3  uLampPos, uLampDir;
  uniform float uLampOn;
  // Optional ground overlay (the hazard map; anything a system wants draped on the terrain): rgb linear, a = strength.
  uniform sampler2D uOverlay;
  uniform vec4  uOverlayRect;    // world x, z of the texture's first corner; 1 / its width, 1 / its depth in metres
  uniform float uOverlayOn;

  ${SKY_GLSL}
  ${IMAGERY_GLSL}
  ${detail.glslFragment}

  float boxShadow(mat4 inv, vec3 halfSize, vec3 P, vec3 L) {
    vec3 o = (inv * vec4(P, 1.0)).xyz, dd = mat3(inv) * L;
    vec3 t1 = (-halfSize - o) / dd, t2 = (halfSize - o) / dd;
    vec3 tn = min(t1, t2), tf = max(t1, t2);
    float t0 = max(max(tn.x, tn.y), tn.z), t1m = min(min(tf.x, tf.y), tf.z);
    if (t1m <= 0.0) return 1.0;
    return 1.0 - smoothstep(0.0, 0.22, t1m - max(t0, 0.0));
  }

  vec3 tintMars(float lum) {
    // Single-band imagery, tinted. The ramp is a choice, not a measurement.
    float l = clamp((lum - 0.30) * 2.3, 0.0, 1.0);
    vec3 dark = vec3(0.105, 0.060, 0.042), mid = vec3(0.34, 0.195, 0.115), bright = vec3(0.60, 0.42, 0.28);
    return l < 0.5 ? mix(dark, mid, l * 2.0) : mix(mid, bright, l * 2.0 - 1.0);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 V = vWorld - uCamPos;
    float dist = length(V);
    float fine;
    float lum = groundImage(vWorld.xz, fine);
    vec3 N = normalize(vNormal);
    float grain = 1.0;
    detailShade(vWorld, dist, N, grain);
    vec3 albedo = tintMars(lum * grain);
    detailTint(vWorld, dist, N, lum * grain, albedo);      // a site's own ramp, ice and frost (detailstyle.js); a no-op at Jezero and Gale

    float sunVis = 1.0;
    if (uHorizonOn > 0.5) {
      vec2 hu = (vWorld.xz - uHorizonRect.xy) * uHorizonRect.zw;
      if (hu.x > 0.0 && hu.x < 1.0 && hu.y > 0.0 && hu.y < 1.0) {
        float hz = texture2D(uHorizon, hu).r;
        sunVis = smoothstep(hz - 0.02, hz + 0.03, uSunEl);
      }
    }
    if (uBoxOn > 0.5 && uSunDir.y > 0.02) {
      vec2 fd = vWorld.xz - uFocus;
      if (dot(fd, fd) < 3600.0) {
        sunVis *= min(boxShadow(uBoxInv[0], uBoxHalf[0], vWorld, uSunDir), boxShadow(uBoxInv[1], uBoxHalf[1], vWorld, uSunDir));
      }
    }
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 light = uSunColor * ndl * sunVis + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
    if (uLampOn > 0.0) {
      vec3 toP = vWorld - uLampPos;
      float dl = length(toP);
      vec3 ld = toP / max(dl, 0.001);
      float cone = smoothstep(0.80, 0.96, dot(ld, uLampDir));
      light += vec3(1.0, 0.96, 0.88) * uLampOn * cone * max(dot(N, -ld), 0.0) * 55.0 / (1.0 + dl * dl * 0.35);
    }
    vec3 col = albedo * light;

    if (uHonesty > 0.5) {
      vec3 pc = vProv > 2.5 ? ${v3(P.hirise)} : vProv > 1.5 ? ${v3(P.ctx)} : vProv > 0.5 ? ${v3(P.interpolated)} : vec3(0.35);
      float shade = 0.25 + 0.75 * clamp(ndl * sunVis * 0.8 + 0.35, 0.0, 1.0);
      col = pc * (0.30 + 0.9 * lum) * shade;
      // Generated relief: magenta hatching, as strong as the displacement is large.
      float m = clamp(abs(vDisp) / 0.10, 0.0, 1.0) * (1.0 - smoothstep(60.0, 160.0, dist));
      float hatch = step(0.5, fract((vWorld.x + vWorld.z) * 1.6));
      col = mix(col, ${v3(P.procedural)}, 0.92 * m * hatch);
      // Imagery: a faint dot screen wherever the picture is CTX only.
      float dots = step(0.82, fract(vWorld.x * 0.25)) * step(0.82, fract(vWorld.z * 0.25));
      col = mix(col, vec3(0.02), 0.5 * dots * (1.0 - clamp(fine, 0.0, 1.0)) * (1.0 - smoothstep(100.0, 400.0, dist)));
    }

    if (uOverlayOn > 0.0) {
      vec4 ov = texture2D(uOverlay, (vWorld.xz - uOverlayRect.xy) * uOverlayRect.zw);
      col = mix(col, ov.rgb * (0.22 + 0.55 * clamp(ndl * sunVis + 0.35, 0.0, 1.0)), ov.a * uOverlayOn);
    }

    // Beyond the mapped area there is no data: fade to the haze so it reads as "not here".
    vec2 edge = (abs(vWorld.xz) - uSiteRect.xy) / uSiteRect.z;
    float outside = clamp(max(edge.x, edge.y), 0.0, 1.0);
    // Dust haze: Beer-Lambert along the view ray, in-scattering toward the sky's own horizon colour.
    float T = exp(-dist * uHazeK * (1.0 - 0.6 * uHonesty)) * (1.0 - outside);
    vec3 hdir = normalize(vec3(V.x, max(V.y, 0.0) + 0.02 * dist, V.z));
    col = col * T + marsSky(hdir) * (1.0 - T);
    gl_FragColor = vec4(col, 1.0);
  }
`;
}

class Level {
  constructor(index, cell, N, material, count) {
    this.index = index; this.cell = cell; this.N = N;
    this.half = N * cell / 2;
    const V = N + 1;
    this.V = V;
    const n = V * V;
    const pos = new Float32Array(n * 3), surf = new Float32Array(n * 4), grad = new Float32Array(n * 4);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      pos[k * 3] = (i - N / 2) * cell;
      pos[k * 3 + 2] = (j - N / 2) * cell;
      surf[k * 4 + 2] = i & 1; surf[k * 4 + 3] = j & 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSurf", new THREE.BufferAttribute(surf, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aGrad", new THREE.BufferAttribute(grad, 4).setUsage(THREE.DynamicDrawUsage));
    this.indices = new Uint32Array(N * N * 6);
    g.setIndex(new THREE.BufferAttribute(this.indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.half * 3);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = "terrain-L" + index;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = index - count;       // finest first: early-z does the rest
    this.mesh.matrixAutoUpdate = false;
    this.centre = { x: NaN, z: NaN };
    this.hole = null;
    this.dirty = true; this.holeDirty = true; this.everBuilt = false;
    const HW = V + 2 * AP;
    this.HW = HW;
    this._h = new Float32Array(HW * HW);
    this._hp = new Float32Array(HW * HW);
    this.triangles = 0;
  }

  setHole(child) {
    let hole = null;
    if (child) {
      // One cell smaller than the child all round. Where they overlap the child has morphed onto this
      // level's surface exactly, so the two are coincident: no T-junction at the rim can open a pixel
      // of sky (it showed as white sparks on dark ground at sunset).
      const i0 = Math.round((child.centre.x - child.half - (this.centre.x - this.half)) / this.cell) + 1;
      const j0 = Math.round((child.centre.z - child.half - (this.centre.z - this.half)) / this.cell) + 1;
      const n = Math.round(child.half * 2 / this.cell) - 2;
      hole = { i0, j0, i1: i0 + n, j1: j0 + n };
    }
    const N = this.N, V = this.V, idx = this.indices;
    let n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (hole && i >= hole.i0 && i < hole.i1 && j >= hole.j0 && j < hole.j1) continue;
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
    this.geometry.index.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.triangles = n / 3;
    this.hole = hole;
    this.holeDirty = false;
  }

  /** Sample the measured surface over the whole level (hole included: the hole moves). */
  resample(field, hasParent) {
    const { N, V, HW, cell: s } = this;
    const H = this._h, HP = this._hp;
    const cx = this.centre.x, cz = this.centre.z, half = N / 2;
    for (let jj = 0; jj < HW; jj++) {
      const wz = cz + (jj - AP - half) * s;
      for (let ii = 0; ii < HW; ii++) H[jj * HW + ii] = field.height(cx + (ii - AP - half) * s, wz, s);
    }
    if (hasParent) {
      // The parent's surface on this lattice. Even-even points are parent
      // vertices and are sampled with the PARENT's cell size, i.e. exactly as
      // the parent samples them; the rest lie on its edges and cell centres.
      const ps = s * 2;
      for (let jj = 0; jj < HW; jj += 2) {
        const wz = cz + (jj - AP - half) * s;
        for (let ii = 0; ii < HW; ii += 2) HP[jj * HW + ii] = field.height(cx + (ii - AP - half) * s, wz, ps);
      }
      for (let jj = 0; jj < HW; jj += 2) for (let ii = 1; ii < HW; ii += 2) HP[jj * HW + ii] = 0.5 * (HP[jj * HW + ii - 1] + HP[jj * HW + ii + 1]);
      for (let jj = 1; jj < HW; jj += 2) for (let ii = 0; ii < HW; ii++) HP[jj * HW + ii] = 0.5 * (HP[(jj - 1) * HW + ii] + HP[(jj + 1) * HW + ii]);
    } else HP.set(H);

    const pos = this.geometry.attributes.position.array;
    const surf = this.geometry.attributes.aSurf.array;
    const grad = this.geometry.attributes.aGrad.array;
    for (let j = 0; j < V; j++) {
      const wz = cz + (j - half) * s;
      for (let i = 0; i < V; i++) {
        const k = j * V + i, hk = (j + AP) * HW + (i + AP);
        pos[k * 3 + 1] = H[hk];
        surf[k * 4] = HP[hk];
        surf[k * 4 + 1] = field.category(cx + (i - half) * s, wz, s);
        grad[k * 4] = (H[hk + 1] - H[hk - 1]) / (2 * s);
        grad[k * 4 + 1] = (H[hk + HW] - H[hk - HW]) / (2 * s);
        grad[k * 4 + 2] = (HP[hk + 2] - HP[hk - 2]) / (4 * s);
        grad[k * 4 + 3] = (HP[hk + 2 * HW] - HP[hk - 2 * HW]) / (4 * s);
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSurf.needsUpdate = true;
    this.geometry.attributes.aGrad.needsUpdate = true;
    this.mesh.position.set(cx, 0, cz);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
    this.dirty = false; this.everBuilt = true;
  }
}

export class Terrain {
  /**
   * @param field    Heightfield (measured surface)
   * @param imagery  Imagery
   * @param detail   a detail provider (detail.js)
   * @param sky      Sky (its uniforms are shared so the haze matches)
   * @param quality  a QUALITY tier
   */
  constructor(field, imagery, detail, sky, quality) {
    this.field = field; this.imagery = imagery; this.detail = detail;
    const site = field.site;
    this.uniforms = Object.assign({
      uFocus: { value: new THREE.Vector2() },
      uSunColor: { value: sky.sunColor }, uAmbSky: { value: sky.ambSky }, uAmbGround: { value: sky.ambGround },
      uCamPos: { value: new THREE.Vector3() },
      uHazeK: { value: 1 / 20000 },
      uHonesty: { value: 0 },
      uSiteRect: { value: new THREE.Vector4(site.halfX, site.halfZ, 600, 0) },
      uHorizon: { value: null }, uHorizonRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uHorizonOn: { value: 0 },
      uBoxInv: { value: [new THREE.Matrix4(), new THREE.Matrix4()] },
      uBoxHalf: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)] },
      uBoxOn: { value: 0 },
      uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uLampOn: { value: 0 },
      uOverlay: { value: null }, uOverlayRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uOverlayOn: { value: 0 },
    }, sky.uniforms, imagery.uniforms, detail.uniforms);
    this.group = new THREE.Group();
    this.group.name = "terrain";
    this.levels = [];
    this.vs = vertexShader(detail); this.fs = fragmentShader(detail);
    this.setQuality(quality);
  }

  setQuality(q) {
    for (const lv of this.levels) { this.group.remove(lv.mesh); lv.geometry.dispose(); lv.mesh.material.dispose(); }
    this.levels = [];
    const N = q.cells;
    if (N % 16) throw new Error("clipmap cells must be a multiple of 16");
    this.N = N;
    this.snapCells = N / 8;
    let count = 1;
    // A site may want a longer view than the default (Olympus, Coprates: manifest render.maxCell).
    const maxCell = Math.max(CLIPMAP.maxCell, (this.field.site.manifest.render || {}).maxCell || 0);
    while (q.baseCell * Math.pow(2, count - 1) < maxCell) count++;
    this.detail.uniforms.uFadeK.value = N * 0.075;
    // The reach of the longest-wavelength octave: levels wholly beyond it skip the detail.
    const reach = Math.max(6, (this.detail.maxLambda || 24) * N * 0.075);
    for (let i = 0; i < count; i++) {
      const cell = q.baseCell * Math.pow(2, i);
      const half = N * cell / 2, snap = this.snapCells * cell;
      // the blend is complete two cells inside the nearest the edge can ever be, because the parent
      // also draws one of its own cells under this level's rim (see setHole)
      const end = half - snap / 2 - 2 * cell;
      const inner = i === 0 ? 0 : half / 2 - snap;
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, this.uniforms, {
          uLevel: { value: new THREE.Vector4(cell, i === count - 1 ? 1e9 : end * CLIPMAP.morphStart, i === count - 1 ? 2e9 : end, inner < reach ? 1 : 0) },
        }),
        vertexShader: this.vs, fragmentShader: this.fs,
      });
      mat.name = "terrain";
      const lv = new Level(i, cell, N, mat, count);
      this.levels.push(lv);
      this.group.add(lv.mesh);
    }
    this._primed = false;
    this._fieldVersion = -1;
  }

  /** Snap every level to the focus and resample what moved. */
  update(fx, fz, budgetMs = 4) {
    this.uniforms.uFocus.value.set(fx, fz);
    const L = this.levels, n = L.length;
    const v = this.field.version;
    if (v !== this._fieldVersion) {
      // New tiles: coalesce (they land in bursts), then rebuild every level in
      // one pass so no two levels are ever built from different ground.
      const now = performance.now();
      if (!this._primed || this._force) {
        this._fieldVersion = v; this._fullPass = true; this._force = false;
        for (const lv of L) lv.dirty = true;
      } else if (v !== this._pendingV) { this._pendingV = v; this._seenAt = now; }
      else if (now - this._seenAt > 300) {
        this._fieldVersion = v; this._fullPass = true;
        for (const lv of L) lv.dirty = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const lv = L[i], step = lv.cell * this.snapCells;
      const cx = Math.round(fx / step) * step, cz = Math.round(fz / step) * step;
      if (cx !== lv.centre.x || cz !== lv.centre.z) {
        lv.centre.x = cx; lv.centre.z = cz;
        lv.dirty = true; lv.holeDirty = true;
        if (i + 1 < n) L[i + 1].holeDirty = true;
      }
    }
    const t0 = performance.now();
    const full = this._fullPass || !this._primed;
    // Coarse to fine is wrong for the eye; fine to coarse leaves a parent
    // stale for a frame. Resample dirty levels finest first within the budget,
    // then refill every hole that moved (cheap, and must not lag its child).
    for (let i = 0; i < n; i++) {
      const lv = L[i];
      if (!lv.dirty) continue;
      lv.resample(this.field, i < n - 1);
      if (!full && performance.now() - t0 > budgetMs) break;
    }
    for (let i = 0; i < n; i++) {
      const lv = L[i];
      // A hole may only follow a child that has actually moved its vertices.
      if (lv.holeDirty && !lv.dirty && (i === 0 || !L[i - 1].dirty)) lv.setHole(i > 0 ? L[i - 1] : null);
    }
    this._fullPass = false;
    if (!this._primed) this._primed = L.every((l) => l.everBuilt);
  }

  /** Everything must be rebuilt on the next update (teleport, quality change). */
  invalidate() { this._force = true; this._fieldVersion = -1; }

  get triangles() { let t = 0; for (const l of this.levels) t += l.triangles; return t; }
}

export { PROV };
