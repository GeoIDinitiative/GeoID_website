/**
 * What the weather looks like. Driven by game.env (weather.js); owns no state
 * that matters to the simulation.
 *
 *   streamers   blowing dust near the ground in strong wind: ONE draped grid
 *               (48 m around the focus, heights from surface.height) with a
 *               scrolling, wind-aligned noise in its fragment shader. Not
 *               particles: saltation reads as sinuous sheets, and a layer
 *               costs one draw call whatever the wind.
 *   dust devils one instanced funnel mesh (a swirling, bending column) and
 *               one instanced quad for their faint shadows.
 *   storm wall  one arc of a cylinder on the horizon, in the direction a
 *               regional or global storm is coming from, closing in as its
 *               ETA runs down, gone once the dust is on top of you.
 *   the air     scene fog for everything that is not the terrain (rocks, the
 *               rover, base modules, beacons), so they sink into the same
 *               dust the terrain shader's haze uses; the Sun's disc reddens
 *               and dims in heavy dust; a small wind-driven camera shake.
 *
 * COST, at the default tier: at most 4 draw calls and about 7,300 triangles
 * when everything is on screen at once (streamers 4,608, eight devils 2,240,
 * their shadows 16, the wall 400); nothing when the air is still. Each piece
 * is skipped entirely (not drawn transparent) when it has nothing to show.
 * Tiers scale the grid, the devil count and the wall's segments (TIERS).
 *
 * All of it is GENERATED: no dataset says where a dust devil is.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const TIERS = {
  low:    { grid: 24, devils: 4,  radial: 8,  rows: 8,  shadows: false, wall: 24, shake: 0.6 },
  medium: { grid: 32, devils: 6,  radial: 10, rows: 8,  shadows: true,  wall: 32, shake: 1 },
  high:   { grid: 48, devils: 8,  radial: 14, rows: 10, shadows: true,  wall: 40, shake: 1 },
  ultra:  { grid: 64, devils: 10, radial: 16, rows: 12, shadows: true,  wall: 64, shake: 1 },
};
const REACH = 48;                    // metres of streamer layer either side of the focus
const DUST = new THREE.Color(0.60, 0.42, 0.28);     // the terrain shader's brightest tint: airborne dust is the fine, bright fraction
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A tileable three-octave value noise, RGBA (four independent fields), for every shader here. */
function noiseTexture(size = 128) {
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const acc = new Float32Array(size * size);
    let amp = 0.5, tot = 0;
    for (const n of [8, 16, 32]) {
      const lat = new Float32Array(n * n);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = x / size * n, fy = y / size * n, i = Math.floor(fx), j = Math.floor(fy);
        let u = fx - i, v = fy - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
        const a = lat[(j % n) * n + (i % n)], b = lat[(j % n) * n + ((i + 1) % n)], c = lat[((j + 1) % n) * n + (i % n)], d = lat[((j + 1) % n) * n + ((i + 1) % n)];
        acc[y * size + x] += amp * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v);
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round(acc[i] / tot * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

const HAZE_GLSL = /* glsl */`
  uniform vec3  uCamPos;
  uniform float uHazeK;
  uniform vec3  uHazeCol;
  vec3 hazed(vec3 col, vec3 world) { float T = exp(-distance(world, uCamPos) * uHazeK); return col * T + uHazeCol * (1.0 - T); }
`;

/* ── streamers ──────────────────────────────────────────────────────────── */

const STREAM_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += 0.22;
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;
const STREAM_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vWorld;
  uniform sampler2D uNoise;
  uniform vec2  uFocus;
  uniform vec2  uAxis;        // unit vector the air moves along (x, z)
  uniform vec2  uAnchor;      // noise coordinates of the focus: along, across the wind (advected on the CPU)
  uniform float uStrength;    // 0 still air .. 1 a gale
  uniform vec3  uDust;        // lit dust colour, scene units
  ${HAZE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = vWorld.xz - uFocus;
    // wind-aligned coordinates, continuous at the focus however the wind veers
    float along = dot(d, uAxis) + uAnchor.x, across = dot(d, vec2(-uAxis.y, uAxis.x)) + uAnchor.y;
    // long sinuous streaks: stretched forty to one along the wind, two scales
    // (every scale is a whole number of periods in 4096 m, so the CPU can wrap the anchor there without a seam)
    float n1 = texture2D(uNoise, vec2(across * 0.044921875, along * 0.006103515625)).r;
    float n2 = texture2D(uNoise, vec2(across * 0.1298828125 + 0.37, along * 0.01708984375)).g;
    // broad sheets, so it arrives in gusts and not as a carpet
    float sheet = texture2D(uNoise, vec2(across * 0.00390625, along * 0.001953125)).b;
    float streak = smoothstep(0.50, 0.74, n1 * 0.62 + n2 * 0.38);
    float gate = smoothstep(0.62 - 0.55 * uStrength, 0.80 - 0.45 * uStrength, sheet);
    float r = length(d) / ${REACH.toFixed(1)};
    float a = streak * gate * uStrength * (1.0 - smoothstep(0.70, 0.98, r)) * 0.62;
    if (a < 0.004) discard;
    gl_FragColor = vec4(hazed(uDust, vWorld), a);
  }
`;

class Streamers {
  constructor(noise, G, shared) {
    this.G = G; this.cell = 2 * REACH / G;
    const n = G + 1, pos = new Float32Array(n * n * 3), idx = new Uint16Array(G * G * 6);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; pos[k] = (i - G / 2) * this.cell; pos[k + 2] = (j - G / 2) * this.cell; }
    let q = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = j * n + i; idx[q++] = a; idx[q++] = a + n; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = a + n; idx[q++] = a + n + 1; }
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.H = new Float32Array(n * n); this.tmp = new Float32Array(n * n);
    this.uniforms = Object.assign({
      uNoise: { value: noise }, uFocus: { value: new THREE.Vector2() }, uAxis: { value: new THREE.Vector2(1, 0) },
      uAnchor: { value: new THREE.Vector2() }, uStrength: { value: 0 }, uDust: { value: new THREE.Color() },
    }, shared);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: STREAM_VERT, fragmentShader: STREAM_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.name = "weather-streamers"; this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5;
    this.oi = NaN; this.oj = NaN; this.theta = 0;
  }
  /** Keep the grid under the focus: shift what is already sampled, sample only the newly exposed rows. */
  follow(surface, fx, fz) {
    const G = this.G, n = G + 1, c = this.cell, oi = Math.round(fx / c), oj = Math.round(fz / c);
    if (oi === this.oi && oj === this.oj) return;
    const di = oi - this.oi, dj = oj - this.oj, H = this.H, T = this.tmp, all = !(Math.abs(di) < n && Math.abs(dj) < n);
    T.set(H);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const si = i + di, sj = j + dj;
      H[j * n + i] = !all && si >= 0 && si < n && sj >= 0 && sj < n ? T[sj * n + si] : surface.height((oi + i - G / 2) * c, (oj + j - G / 2) * c);
    }
    const p = this.geometry.attributes.position;
    for (let k = 0; k < n * n; k++) p.array[k * 3 + 1] = H[k];
    p.needsUpdate = true;
    this.mesh.position.set(oi * c, 0, oj * c);
    this.oi = oi; this.oj = oj;
  }
  dispose() { this.geometry.dispose(); this.mesh.material.dispose(); }
}

/* ── dust devils ────────────────────────────────────────────────────────── */

const DEVIL_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iPos;        // base: world x, ground y, world z
  attribute vec4 iParam;      // core radius m, height m, phase, opacity
  uniform float uTime;
  uniform vec2  uAxis;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec4 vParam;
  varying float vRim;
  uniform vec3 uCamPos2;
  void main() {
    float y = position.y;
    // a narrow core that flares toward the top, and a skirt of dust at its foot
    float r = iParam.x * (0.50 + 0.30 * y + 0.9 * y * y * y + 1.6 * exp(-y * 26.0));
    // it leans downwind and writhes
    vec2 bend = uAxis * (y * y) * iParam.y * 0.22
      + vec2(sin(y * 5.0 + uTime * 0.9 + iParam.z), cos(y * 4.0 + uTime * 0.7 + iParam.z)) * iParam.x * 0.7 * y;
    vec3 wp = vec3(iPos.x + position.x * r + bend.x, iPos.y + y * iParam.y, iPos.z + position.z * r + bend.y);
    vWorld = wp; vUv = uv; vParam = iParam;
    vec2 toCam = normalize(uCamPos2.xz - wp.xz);
    vRim = abs(dot(toCam, normalize(position.xz)));        // 1 facing the camera, 0 at the silhouette
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const DEVIL_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vWorld;
  varying vec2 vUv;
  varying vec4 vParam;
  varying float vRim;
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform vec3  uDust;
  ${HAZE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    float y = vUv.y;
    // dust wound round the column and carried up it
    float n = texture2D(uNoise, vec2(vUv.x * 2.0 + uTime * 0.21 - y * 1.6 + vParam.z, y * vParam.y / 70.0 - uTime * 0.09)).r;
    float m = texture2D(uNoise, vec2(vUv.x * 5.0 - uTime * 0.33, y * vParam.y / 28.0 - uTime * 0.16)).g;
    float body = 0.45 + 0.55 * smoothstep(0.25, 0.75, n * 0.7 + m * 0.3);
    float a = vParam.w * body * pow(vRim, 1.1) * (1.0 - smoothstep(0.50, 1.0, y)) * smoothstep(0.0, 0.015, y);
    if (a < 0.004) discard;
    gl_FragColor = vec4(hazed(uDust * (0.62 + 0.36 * n), vWorld), min(a, 0.92));
  }
`;

/* ── the storm wall ─────────────────────────────────────────────────────── */

const WALL_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;
const WALL_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vWorld;
  varying vec2 vUv;
  uniform sampler2D uNoise;
  uniform float uTime, uOpacity;
  uniform vec3  uWall;
  ${HAZE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    // billows: big slow ones and smaller ones riding on them
    float n = texture2D(uNoise, vec2(vUv.x * 3.0 + uTime * 0.004, vUv.y * 0.9 - uTime * 0.006)).r;
    float m = texture2D(uNoise, vec2(vUv.x * 11.0 - uTime * 0.007, vUv.y * 3.1 - uTime * 0.012)).g;
    float b = n * 0.68 + m * 0.32;
    // a ragged top, solid toward the ground
    float top = 0.46 + 0.50 * b;
    float a = (1.0 - smoothstep(top - 0.07, top, vUv.y)) * smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);
    if (a * uOpacity < 0.004) discard;
    // Darker and redder than the sky behind it: no light comes through a wall of dust. The billows shade each
    // other, and only their tops catch the Sun.
    float lit = smoothstep(top - 0.14, top, vUv.y);
    vec3 col = uWall * (0.34 + 0.26 * m + 0.60 * lit * b) * mix(0.72, 1.0, smoothstep(0.0, 0.35, vUv.y));
    gl_FragColor = vec4(hazed(col, vWorld), a * uOpacity);
  }
`;

export class WeatherFx {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = "weather";
    game.scene.add(this.group);
    this.noise = noiseTexture();
    this.shared = { uCamPos: { value: new THREE.Vector3() }, uHazeK: { value: 0 }, uHazeCol: { value: new THREE.Color() } };
    this.dust = new THREE.Color();
    this.time = 0; this.anchor = new THREE.Vector2(); this.theta = null; this.joltT = 0;
    this.maxDevils = 6;
    this.stats = { calls: 0, triangles: 0, streamers: 0, devils: 0, wall: 0 };
    // the same dust for everything three's own materials draw (the terrain shader has its own haze)
    this.fog = new THREE.FogExp2(0x000000, 0);
    game.scene.fog = this.fog;
    this._build(game.quality);
  }

  _build(q) {
    const T = this.tier = TIERS[q.name] || TIERS.high;
    this._q = q;
    this._clear();
    this.maxDevils = T.devils;
    this.streamers = new Streamers(this.noise, T.grid, this.shared);
    this.group.add(this.streamers.mesh);

    // devils: an open cylinder, y 0..1, instanced
    const cyl = new THREE.CylinderGeometry(1, 1, 1, T.radial, T.rows, true);
    cyl.translate(0, 0.5, 0);
    const g = this.devilGeo = new THREE.InstancedBufferGeometry();
    g.index = cyl.index; g.setAttribute("position", cyl.attributes.position); g.setAttribute("uv", cyl.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(T.devils * 3), 3);
    this.iParam = new THREE.InstancedBufferAttribute(new Float32Array(T.devils * 4), 4);
    g.setAttribute("iPos", this.iPos); g.setAttribute("iParam", this.iParam);
    g.instanceCount = 0;
    this.devilU = Object.assign({ uNoise: { value: this.noise }, uTime: { value: 0 }, uAxis: { value: new THREE.Vector2(1, 0) }, uDust: { value: new THREE.Color() }, uCamPos2: this.shared.uCamPos }, this.shared);
    this.devils = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.devilU, vertexShader: DEVIL_VERT, fragmentShader: DEVIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.devils.name = "weather-devils"; this.devils.frustumCulled = false; this.devils.visible = false; this.devils.renderOrder = 6;
    this.devilTris = T.radial * T.rows * 2;
    this.group.add(this.devils);

    if (T.shadows) {
      const blob = new Uint8Array(32 * 32 * 4);
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
        const u = (i + 0.5) / 32, v = (j + 0.5) / 32 * 2 - 1;
        const a = Math.max(0, 1 - v * v) * smooth(0, 0.08, u) * (1 - smooth(0.25, 1, u));       // soft sides, fading along its length
        blob.set([0, 0, 0, Math.round(a * 255)], (j * 32 + i) * 4);
      }
      const tex = new THREE.DataTexture(blob, 32, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
      const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2); plane.translate(0.5, 0, 0);      // x 0..1 along the shadow, z across
      this.shadowTex = tex;
      this.shadows = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, fog: false }), T.devils);
      this.shadows.name = "weather-devil-shadows"; this.shadows.frustumCulled = false; this.shadows.count = 0; this.shadows.visible = false; this.shadows.renderOrder = 4;
      this.group.add(this.shadows);
    } else this.shadows = null;

    // the wall: an arc 150 degrees wide, unit radius and height, facing -Z
    const seg = T.wall, rows = 5, wp = [], wu = [], wi = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= seg; i++) {
      const a = (i / seg - 0.5) * 150 * Math.PI / 180;
      wp.push(Math.sin(a), j / rows, -Math.cos(a)); wu.push(i / seg, j / rows);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i; wi.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1); }
    const wg = this.wallGeo = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute("uv", new THREE.Float32BufferAttribute(wu, 2)); wg.setIndex(wi);
    this.wallU = Object.assign({ uNoise: { value: this.noise }, uTime: { value: 0 }, uOpacity: { value: 0 }, uWall: { value: new THREE.Color() } }, this.shared);
    this.wall = new THREE.Mesh(wg, new THREE.ShaderMaterial({ uniforms: this.wallU, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.wall.name = "weather-wall"; this.wall.frustumCulled = false; this.wall.visible = false; this.wall.renderOrder = 3;
    this.wallTris = seg * rows * 2;
    this.group.add(this.wall);
  }
  _clear() {
    if (!this.streamers) return;
    this.group.clear();
    this.streamers.dispose(); this.devilGeo.dispose(); this.devils.material.dispose(); this.wallGeo.dispose(); this.wall.material.dispose();
    if (this.shadows) { this.shadows.geometry.dispose(); this.shadows.material.dispose(); this.shadowTex.dispose(); this.shadows.dispose(); }
  }
  dispose(game) { this._clear(); this.noise.dispose(); game.scene.remove(this.group); if (game.scene.fog === this.fog) game.scene.fog = null; }

  /** A knock to the camera (a dust devil passing over). */
  jolt(k) { this.joltT = Math.max(this.joltT, k); }

  update(game, dt, env, S) {
    if (game.quality !== this._q) this._build(game.quality);
    const sky = game.sky, cam = game.camera, v = game.vehicle, T = this.tier;
    const fx = game.focus ? game.focus.x : v.p.x, fz = game.focus ? game.focus.z : v.p.z;
    if (game.live) this.time += dt;
    const tau = env.tau, sinEl = sky.sun.sinEl, U = sky.uniforms;

    /* the air: horizon colour (the sky model's own numbers, restated on the CPU), fog, the Sun's disc */
    const dustK = Math.min(1, Math.max(0.25, tau / 1.2)), low = 1 - smooth(0.02, 0.38, sinEl), day = U.uDay.value;
    const dark = smooth(1.0, 5.0, tau);
    const hz = this.shared.uHazeCol.value;
    hz.setRGB(0.86, 0.66, 0.44).multiplyScalar(0.62 + 0.38 * dustK).lerp(_c.setRGB(0.30, 0.215, 0.16), low).multiplyScalar(day);
    hz.r *= 1 - 0.58 * dark; hz.g *= 1 - 0.71 * dark; hz.b *= 1 - 0.81 * dark;
    hz.r += 0.006 * (1 - day); hz.g += 0.007 * (1 - day); hz.b += 0.011 * (1 - day);
    this.shared.uHazeK.value = env.hazeK;
    this.shared.uCamPos.value.copy(cam.position);
    this.fog.color.copy(hz);
    this.fog.density = 0.506 * env.hazeK;            // exp(-(d x)^2) reaching 2% where exp(-k x) does
    // heavy dust: the disc goes from white to a dull orange (the beam's strength already follows Beer-Lambert in sky.js)
    const red = smooth(1.2, 5.0, tau);
    U.uSunTint.value.g *= 1 - 0.42 * red; U.uSunTint.value.b *= 1 - 0.68 * red;
    // lit dust: what the Sun and the sky put on a bright, diffuse surface
    this.dust.copy(sky.sunColor).multiplyScalar(0.30 + 0.25 * Math.max(0, sinEl)).add(sky.ambSky).multiply(DUST);

    let calls = 0, tris = 0;
    const th = Math.atan2(env.wind.vec[0], env.wind.vec[1]);         // heading the air moves along
    const ax = Math.sin(th), az = Math.cos(th);

    /* streamers */
    const wind = env.wind.now_ms + (env.dust.storm && env.dust.storm.phase === "peak" ? 3 : 0);
    const strength = smooth(8.5, 19, wind);
    const st = this.streamers;
    if (strength > 0.015) {
      st.follow(game.surface, fx, fz);
      // keep the pattern continuous at the focus while the wind veers, then carry it downwind (real seconds)
      if (this.theta === null) this.theta = th;
      const ox = Math.sin(this.theta), oz = Math.cos(this.theta);
      const along0 = fx * ox + fz * oz - this.anchor.x, across0 = -fx * oz + fz * ox - this.anchor.y;
      this.theta = th;
      this.anchor.x = fx * ax + fz * az - along0; this.anchor.y = -fx * az + fz * ax - across0;
      if (game.live) this.anchor.x += dt * (4 + wind * 0.9);
      const su = st.uniforms;
      su.uFocus.value.set(fx, fz); su.uAxis.value.set(ax, az);
      su.uAnchor.value.set(((fx * ax + fz * az - this.anchor.x) % 4096 + 4096) % 4096, ((-fx * az + fz * ax - this.anchor.y) % 4096 + 4096) % 4096);
      su.uStrength.value = strength; su.uDust.value.copy(this.dust);
      st.mesh.visible = true; calls++; tris += T.grid * T.grid * 2;
    } else st.mesh.visible = false;
    this.stats.streamers = strength;

    /* dust devils */
    let n = 0;
    const list = S.devils || [];
    for (let i = 0; i < list.length && n < T.devils; i++) {
      const d = list[i];
      if (d.y === undefined || Math.abs(d._yx - d.x) + Math.abs(d._yz - d.z) > 4) { d.y = game.surface.measured(d.x, d.z); d._yx = d.x; d._yz = d.z; }
      const fade = Math.min(1, d.age / 6) * Math.min(1, Math.max(0, d.life - d.age) / 10);
      this.iPos.setXYZ(n, d.x, d.y - 0.3, d.z);
      this.iParam.setXYZW(n, d.r, d.h, d.ph, fade * (0.80 + 0.03 * d.r));
      if (this.shadows && sinEl > 0.08) {
        // a streak on the ground, away from the Sun, as long as the column is tall
        const sd = sky.sunDir, len = Math.min(260, d.h * 0.6 / Math.max(0.15, sinEl / Math.hypot(sd.x, sd.z) || 0.15));
        _q.setFromAxisAngle(_up, Math.atan2(sd.z, -sd.x));
        _m.compose(_p.set(d.x, d.y + 0.8, d.z), _q, _s.set(len, 1, d.r * 3.6));
        this.shadows.setMatrixAt(n, _m);
      }
      n++;
    }
    this.devilGeo.instanceCount = n;
    this.devils.visible = n > 0;
    if (n > 0) {
      this.iPos.needsUpdate = true; this.iParam.needsUpdate = true;
      this.devilU.uTime.value = this.time; this.devilU.uAxis.value.set(ax, az); this.devilU.uDust.value.copy(this.dust);
      calls++; tris += n * this.devilTris;
    }
    if (this.shadows) {
      const on = n > 0 && sinEl > 0.08;
      this.shadows.visible = on; this.shadows.count = on ? n : 0;
      if (on) { this.shadows.instanceMatrix.needsUpdate = true; this.shadows.material.opacity = 0.34 * Math.exp(-0.7 * Math.max(0, tau - 0.4)); calls++; tris += n * 2; }
    }
    this.stats.devils = n;

    /* the storm wall: on the horizon three Mars-hours out, on top of you at the ETA */
    const storm = env.dust.storm;
    let wallOn = 0;
    if (storm && storm.kind !== "local" && storm.phase === "approaching" && storm.eta_s < 3 * 3699) {
      const dist = Math.max(350, storm.eta_s * 1.3);
      wallOn = smooth(3 * 3699, 2.6 * 3699, storm.eta_s) * smooth(350, 1400, dist);
      const a = storm.from_deg * Math.PI / 180, height = 380 + 900 * smooth(14000, 1500, dist) + (storm.kind === "global" ? 600 : 0);
      this.wall.position.set(cam.position.x, cam.position.y - 90, cam.position.z);
      this.wall.rotation.y = -a;
      this.wall.scale.set(dist, height, dist);
      this.wallU.uOpacity.value = wallOn; this.wallU.uTime.value = this.time;
      this.wallU.uWall.value.copy(hz).multiply(_c.setRGB(0.80, 0.56, 0.38));          // the horizon's own colour, darkened and reddened
    }
    this.wall.visible = wallOn > 0.01;
    if (this.wall.visible) { calls++; tris += this.wallTris; }
    this.stats.wall = wallOn;
    this.stats.calls = calls; this.stats.triangles = tris;

    /* the wind on the camera: a few millimetres, a fraction of a degree */
    if (game.live && dt > 0) {
      this.joltT = Math.max(0, this.joltT - dt * 0.8);
      const k = (smooth(9, 26, env.wind.now_ms) * 0.6 + this.joltT) * T.shake;
      if (k > 0.002) {
        const t = this.time;
        cam.position.x += k * 0.035 * Math.sin(t * 17.3 + 1.1) * Math.sin(t * 5.1);
        cam.position.y += k * 0.022 * Math.sin(t * 21.7 + 0.4) * Math.sin(t * 6.3 + 2.0);
        cam.rotateZ(k * 0.0035 * Math.sin(t * 13.1) * Math.sin(t * 3.7 + 0.9));
      }
    }
  }
}

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
