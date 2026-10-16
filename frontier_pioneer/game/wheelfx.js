/**
 * Wheel effects: the dust the wheels throw, and the tracks they leave.
 * System "wheelfx" (order 35): after weather (it reads game.env.wind), before the HUD.
 *
 * DUST ON MARS IS NOT SMOKE. The air is about 1% as dense as Earth's and
 * gravity is 0.38 g, so two things come off a wheel and behave differently,
 * and both are drawn:
 *   - FINE DUST (micron-sized): stops within a metre of where it was thrown
 *     (it has no inertia against even thin air), billows slowly, drifts with
 *     the wind, and takes many seconds to thin out. It hangs; it does not
 *     rise like a hot plume.
 *   - SAND GRAINS: too heavy to be carried. They fly a ballistic arc under
 *     3.71 m/s2 (long and lazy by Earth standards) and drop.
 * How much is thrown follows the physics the vehicle already computes per
 * wheel (contact, slip against the traction limit, sinkage, load, the wheel's
 * speed over the ground) and the ground under that wheel
 * (surface.regolith: loose sand throws a lot, firm ground almost nothing):
 *   rolling skirt   a low sheet off every wheel, in proportion to speed
 *   rooster tail    behind a wheel that is asking for more than the ground can give (wheel-spin)
 *   scrub           a wheel sliding sideways, or braking hard
 *   landing         a ring when a wheel comes back down
 *   haze            a few large, faint, long-lived puffs on loose ground: the trail that lingers
 * None of this is data: in the data-honesty view the dust is magenta.
 *
 * TECHNIQUE. One instanced quad mesh, ONE draw call, for every wheel. The CPU
 * only writes spawn records (position, time, velocity, life, size, colour)
 * into a ring buffer; the vertex shader animates each particle analytically
 * from its spawn record and the clock, so nothing is integrated per frame on
 * the CPU and an old particle costs nothing to keep. Draw order is spawn
 * order, which never changes from frame to frame, so the blend cannot pop
 * (it is not depth-sorted; for thin, like-coloured dust the difference is
 * not visible).
 * SOFT PARTICLES are not done against scene depth: the post chain's depth is
 * a renderbuffer, logarithmic, and still being written when the dust is
 * drawn; sampling it would need a second depth pass. Instead every particle
 * knows the ground height it was thrown from and fades out toward it, which
 * removes the hard line where a quad meets the ground, and fades when it is
 * very close to the camera.
 * LIGHT. Colour is the ground's own (the CTX brightness under the wheel,
 * through the terrain's tint ramp, lightened as fines are). Each sprite is
 * shaded as a soft sphere: the side toward the Sun takes the Sun's colour,
 * the far side the sky's; looking toward the Sun adds a forward-scattering
 * term, which is what makes back-lit dust glow at sunset. The headlights
 * light whatever is inside their cone.
 *
 * BUDGET (default tier): 2,500 particle slots, i.e. at most 2,500 live quads
 * (5,000 triangles) in one draw call, plus the tracks' one call and 4,796
 * triangles. Steady driving on sand keeps about 600 to 800 alive. Slots scale
 * with the quality tier (600 / 1,400 / 2,500 / 4,000) and so do the rates.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { Tracks } from "./tracks.js?v=b8cfe8e-efa5b7b7";

const SLOTS = { low: 600, medium: 1400, high: 2500, ultra: 4000 };
const TRACK_SAMPLES = { low: 400, medium: 800, high: 1200, ultra: 1600 };
const DEFAULT_WIND = [0.9, 0.35];          // m/s toward east-south-east when no weather system is running
const G = 3.71;

const VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aP0;       // spawn position, spawn time
  attribute vec4 aV0;       // initial velocity, life (s)
  attribute vec4 aParm;     // size at birth (m), growth (m per sqrt s), kind (0 fine, 1 grain), seed
  attribute vec4 aCol;      // ground colour, opacity
  uniform float uTime;
  uniform vec3  uWind;
  uniform vec3  uCamPos, uSunDir;
  uniform vec3  uLampPos, uLampDir;
  uniform float uLampOn;
  varying vec2  vUv;
  varying vec4  vCol;
  varying vec3  vSunV;      // Sun direction in the sprite's frame (right, up, toward the camera)
  varying vec3  vMisc;      // height above the launch ground, size, seed
  varying vec2  vGlow;      // forward scatter, headlight

  void main() {
    float age = uTime - aP0.w, life = aV0.w;
    if (age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
    float seed = aParm.w;
    vec3 c;
    float size, alpha;
    if (aParm.z < 0.5) {
      // fine dust: drag stops it in about a metre, then it belongs to the wind
      const float k = 1.7;
      float e = (1.0 - exp(-k * age)) / k;
      c = aP0.xyz + aV0.xyz * e + uWind * (age - e);
      // slow billow, and it settles (slowly: thin air, low gravity)
      c.x += 0.26 * age * sin(seed * 41.0 + age * 0.9);
      c.z += 0.26 * age * cos(seed * 23.0 + age * 0.7);
      c.y += 0.34 * sqrt(age) - 0.035 * age;
      size = aParm.x + aParm.y * sqrt(age);
      c.y = max(c.y, aP0.y + 0.22 * size);
      float t = age / life;
      alpha = aCol.a * smoothstep(0.0, 0.15, age) * pow(1.0 - t, 1.4) * min(1.0, aParm.x * 1.6 / size + 0.2);
    } else {
      // a sand grain: ballistic, and gone when it lands
      c = aP0.xyz + aV0.xyz * age + vec3(0.0, -0.5 * ${G.toFixed(2)} * age * age, 0.0);
      size = aParm.x;
      alpha = aCol.a * smoothstep(0.0, 0.05, age) * step(aP0.y - 0.02, c.y) * (1.0 - smoothstep(0.75, 1.0, age / life));
    }
    vec3 toCam = uCamPos - c;
    float dc = length(toCam);
    alpha *= smoothstep(0.35, 1.6, dc);
    if (alpha < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
    vec3 fw = toCam / max(dc, 1e-4);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, right);
    float rot = seed * 6.2831853 + age * (seed - 0.5) * 0.35;
    vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
    vec3 wp = c + (right * q.x + up * q.y) * size;
    vUv = position.xy * 2.0;
    vCol = vec4(aCol.rgb, alpha);
    // the sprite's own axes are rotated by rot: express the Sun in them so the lit side stays toward the Sun
    vec3 sv = vec3(dot(uSunDir, right), dot(uSunDir, up), dot(uSunDir, fw));
    vSunV = vec3(sv.x * cos(rot) + sv.y * sin(rot), -sv.x * sin(rot) + sv.y * cos(rot), sv.z);
    vMisc = vec3(wp.y - aP0.y, size, seed);
    float fwd = max(dot(-fw, uSunDir), 0.0);                      // looking toward the Sun through the dust
    vec3 toP = c - uLampPos;
    float dl = length(toP);
    float lamp = uLampOn * smoothstep(0.78, 0.95, dot(toP / max(dl, 1e-3), uLampDir)) * 6.5 / (1.0 + dl * dl * 0.30);
    vGlow = vec2(pow(fwd, 5.0) * 1.9 + pow(fwd, 40.0) * 3.0, lamp);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3  uSunColor, uAmbSky;
  uniform float uHonesty, uSunEl;
  varying vec2  vUv;
  varying vec4  vCol;
  varying vec3  vSunV;
  varying vec3  vMisc;
  varying vec2  vGlow;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    if (r2 >= 1.0 || vCol.a <= 0.0) discard;
    float seed = vMisc.z;
    // a ragged, wispy outline instead of a disc
    float wob = sin(vUv.x * 5.3 + seed * 37.0) * sin(vUv.y * 4.7 + seed * 19.0) + 0.5 * sin((vUv.x + vUv.y) * 9.1 + seed * 53.0);
    float body = 1.0 - smoothstep(0.10, 1.0, sqrt(r2) + 0.17 * wob);
    body = pow(body, 1.35);
    // fade into the ground it was thrown from (this stands in for depth-buffer soft particles)
    float ground = smoothstep(-0.02, 0.10 + 0.30 * vMisc.y, vMisc.x + 0.02);
    float a = vCol.a * body * ground;
    if (a < 0.002) discard;
    // shaded as a soft sphere: Sun side takes the Sun, far side the sky
    vec3 n = vec3(vUv, sqrt(max(1.0 - r2, 0.0)));
    float wrap = clamp(dot(n, vSunV) * 0.5 + 0.5, 0.0, 1.0);
    vec3 light = uSunColor * (0.10 + 0.90 * wrap * wrap) + uAmbSky * (0.75 + 0.25 * n.y);
    // forward scattering: brightest where the dust is thin, i.e. toward the edge of a puff
    light += uSunColor * vGlow.x * (0.35 + 0.65 * (1.0 - body));
    // Near sunset the direct beam is almost gone but the aureole is not: dust between the eye and the Sun
    // scatters forward exactly as the sky's dust does, in the sky's own colours (sky.js: warm by day, blue when low).
    float low = 1.0 - smoothstep(0.02, 0.38, uSunEl);
    light += mix(vec3(1.0, 0.93, 0.80), vec3(0.36, 0.55, 0.95), low) * vGlow.x * smoothstep(-0.10, 0.03, uSunEl) * mix(0.25, 0.75, low) * (0.4 + 0.6 * (1.0 - body));
    light += vec3(1.0, 0.96, 0.88) * vGlow.y;
    vec3 col = vCol.rgb * light;
    if (uHonesty > 0.5) col = vec3(1.0, 0.2, 0.8) * (0.35 + 0.65 * wrap);
    gl_FragColor = vec4(col, a);
  }
`;

const _a = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const _r = new THREE.Vector3(), _vel = new THREE.Vector3(), _reg = {};

function rnd() { return Math.random(); }

class WheelFX {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.on = game.settings.dust !== false;
    this.spawned = { fine: 0, grain: 0, haze: 0, total: 0 };
    this.wind = new THREE.Vector3(DEFAULT_WIND[0], 0, DEFAULT_WIND[1]);
    const TU = game.terrain.uniforms, sky = game.sky;
    this.uniforms = {
      uTime: { value: 0 }, uWind: { value: this.wind },
      uCamPos: TU.uCamPos, uSunDir: sky.uniforms.uSunDir, uSunColor: { value: sky.sunColor }, uAmbSky: { value: sky.ambSky },
      uLampPos: TU.uLampPos, uLampDir: TU.uLampDir, uLampOn: TU.uLampOn, uHonesty: TU.uHonesty, uSunEl: sky.uniforms.uSunEl,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.material.name = "wheel-dust";
    this.build();
    this.wheels = game.vehicle.wheels.map(() => ({ acc: 0, accSpin: 0, accScrub: 0, accHaze: 0, contact: true, vy: 0 }));
    this.lastP = game.vehicle.p.clone();
  }

  /** (Re)build the buffers for the current quality tier. */
  build() {
    const g = this.game, q = g.quality.name;
    if (this.mesh) { g.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.tracks) { g.scene.remove(this.tracks.mesh); this.tracks.dispose(); }
    this.tier = q;
    const n = this.N = SLOTS[q] || SLOTS.high;
    this.scale = n / SLOTS.high;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.p0 = new Float32Array(n * 4); this.v0 = new Float32Array(n * 4); this.parm = new Float32Array(n * 4); this.col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.p0[i * 4 + 3] = -1e6;          // born long ago: dead
    const A = (arr, name) => { const a = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    this.attrs = [A(this.p0, "aP0"), A(this.v0, "aV0"), A(this.parm, "aParm"), A(this.col, "aCol")];
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = "wheel-dust";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.head = 0; this.dirty = false;
    this.tracks = new Tracks(g, TRACK_SAMPLES[q] || TRACK_SAMPLES.high);
    g.scene.add(this.tracks.mesh, this.mesh);
  }

  /** One spawn record. kind 0 fine dust, 1 sand grain. */
  emit(x, y, z, vx, vy, vz, life, size, grow, kind, colour, alpha) {
    const i = this.head, k = i * 4;
    this.p0[k] = x; this.p0[k + 1] = y; this.p0[k + 2] = z; this.p0[k + 3] = this.time;
    this.v0[k] = vx; this.v0[k + 1] = vy; this.v0[k + 2] = vz; this.v0[k + 3] = life;
    this.parm[k] = size; this.parm[k + 1] = grow; this.parm[k + 2] = kind; this.parm[k + 3] = rnd();
    this.col[k] = colour[0]; this.col[k + 1] = colour[1]; this.col[k + 2] = colour[2]; this.col[k + 3] = alpha;
    this.head = (i + 1) % this.N;
    this.dirty = true;
    this.spawned.total++;
  }

  /** The colour of fines lifted from the ground at (x, z): the picture under the wheel, through the terrain's tint. */
  groundColour(x, z, out) {
    const g = this.game, s = g.site, b = g.imagery.base;
    let lum = 0.5;
    if (b) {
      const i = Math.max(0, Math.min(b.width - 1, Math.floor((x / s.cos + s.projW / 2) / s.projW * b.width)));
      const j = Math.max(0, Math.min(b.height - 1, Math.floor((z + s.projH / 2) / s.projH * b.height)));
      lum = b.data[j * b.width + i] / 255;
    }
    const l = Math.max(0, Math.min(1, (lum - 0.30) * 2.3));
    const D = [0.105, 0.060, 0.042], M = [0.34, 0.195, 0.115], B = [0.60, 0.42, 0.28], F = [0.66, 0.47, 0.32];
    for (let c = 0; c < 3; c++) {
      const t = l < 0.5 ? D[c] + (M[c] - D[c]) * l * 2 : M[c] + (B[c] - M[c]) * (l * 2 - 1);
      out[c] = (t * 0.50 + F[c] * 0.50) * 1.0;           // fines are paler and more uniform than the surface they came from
    }
    return out;
  }

  /** Simulation step: decide what each wheel throws. Only writes spawn records. */
  tick(dt, ctl) {
    const g = this.game, v = g.vehicle, S = g.surface;
    this.time += dt;
    // wind: the weather system's if it is there, a light breeze if not; eased so a gust cannot teleport old dust
    const w = g.env && g.env.wind && g.env.wind.vec;
    const wx = w && isFinite(w[0]) ? w[0] : DEFAULT_WIND[0], wz = w && isFinite(w[1]) ? w[1] : DEFAULT_WIND[1];
    const m = Math.hypot(wx, wz), cap = m > 9 ? 9 / m : 1, e = Math.min(1, dt * 0.25);
    this.wind.x += (wx * cap * 0.55 - this.wind.x) * e; this.wind.z += (wz * cap * 0.55 - this.wind.z) * e;      // near the ground the wind is slower

    const moved = v.p.distanceTo(this.lastP);
    this.lastP.copy(v.p);
    if (moved > 6) { this.tracks.lift(0); this.tracks.lift(1); for (const s of this.wheels) s.contact = true; return; }     // a teleport, not a drive
    if (!g.driving || !this.on) { this.tracks.lift(0); this.tracks.lift(1); return; }

    _up.set(0, 1, 0).applyQuaternion(v.q); _fw.set(0, 0, -1).applyQuaternion(v.q); _rt.set(1, 0, 0).applyQuaternion(v.q);
    const speed = v.v.dot(_fw), aspeed = Math.abs(speed), R = v.def.wheelRadius, K = this.scale;
    const throttle = Math.max(ctl.throttle || 0, speed < 0.4 ? (ctl.brake || 0) : 0);
    const braking = (speed > 0.4 ? (ctl.brake || 0) : 0) + (ctl.handbrake ? 1 : 0);
    const dir = speed < -0.2 || ((ctl.brake || 0) > 0 && speed < 0.4 && !(ctl.throttle > 0)) ? -1 : 1;
    const colour = this._c || (this._c = [0, 0, 0]);

    for (let i = 0; i < v.wheels.length; i++) {
      const pw = v.wheels[i], st = this.wheels[i];
      _a.copy(pw.attach).applyQuaternion(v.q).add(v.p).addScaledVector(_up, -(pw.len + R));
      const x = _a.x, z = _a.z;
      const rear = pw.def.name[0] === "r", side = pw.def.name[1] === "l" ? 0 : 1;
      if (!pw.contact) {
        st.contact = false; st.vy = v.v.y; st.air = (st.air || 0) + dt;
        if (rear && st.air > 0.3) this.tracks.lift(side);          // a hop over a bump does not break the rut; a flight does
        continue;
      }
      st.air = 0;
      const y = S.height(x, z) + 0.03;
      const reg = S.regolith(x, z, _reg);
      const loose = Math.pow(reg.sand, 0.8);
      const dusty = 0.025 + 0.975 * loose;                       // firm ground still sheds a trace
      this.groundColour(x, z, colour);
      _r.set(x - v.p.x, y - v.p.y, z - v.p.z);
      _vel.copy(v.w).cross(_r).add(v.v);
      const lat = _vel.dot(_rt), out = pw.attach.x < 0 ? -1 : 1;

      // tracks: the rear wheel of each side draws the rut
      if (rear) this.tracks.roll(side, x, z, v.odometer, this.time, Math.min(0.62, THREE.MathUtils.smoothstep(reg.sand, 0.12, 0.5) * (0.30 + 2.2 * pw.sink + 0.10 * Math.min(1, pw.load / 2500))), v.def.wheelWidth * 0.5);     // nothing on firm ground

      // landing: a ring of dust
      if (!st.contact) {
        const hit = Math.max(0, -st.vy - 0.6);
        const n = Math.min(26, Math.round(hit * 12 * dusty * K));
        for (let k = 0; k < n; k++) {
          const a = rnd() * 6.283, s = 0.8 + rnd() * 1.8;
          this.emit(x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, Math.cos(a) * s + _vel.x * 0.3, 0.3 + rnd() * 0.6, Math.sin(a) * s + _vel.z * 0.3,
            2.8 + rnd() * 2.6, 0.32 + rnd() * 0.25, 0.30 + rnd() * 0.18, 0, colour, 0.45 + 0.2 * rnd());
          this.spawned.fine++;
        }
        st.contact = true;
      }

      // rolling skirt: low, close to the wheel, more with speed
      st.acc += dt * dusty * Math.min(1.3, aspeed / 6) * 10 * K;
      while (st.acc >= 1) {
        st.acc -= 1;
        const back = -(0.25 + rnd() * 0.9) * Math.sign(speed || 1) * Math.min(1, aspeed / 4);
        this.emit(x + (rnd() - 0.5) * 0.3, y, z + (rnd() - 0.5) * 0.3,
          _vel.x * 0.22 + _fw.x * back + _rt.x * out * (0.15 + rnd() * 0.5), 0.15 + rnd() * 0.55, _vel.z * 0.22 + _fw.z * back + _rt.z * out * (0.15 + rnd() * 0.5),
          2.4 + rnd() * 2.8, 0.26 + rnd() * 0.2, 0.26 + rnd() * 0.18, 0, colour, (0.24 + 0.16 * rnd()) * (0.55 + 0.45 * loose));
        this.spawned.fine++;
      }

      // rooster tail: the wheel asks for more than the ground can give
      // (a wheel at the traction limit while the rover is still slow is spinning; at speed the same number is just hard driving)
      const spin = throttle > 0.3 ? Math.max(0, Math.min(1, (pw.slip - 1.0) / 0.5)) * (1 - THREE.MathUtils.smoothstep(aspeed, 2.0, 4.5)) + Math.min(1, pw.sink * 6) * throttle : 0;
      st.accSpin += dt * dusty * Math.min(1.4, spin) * throttle * 85 * K;
      while (st.accSpin >= 1) {
        st.accSpin -= 1;
        const grain = rnd() < 0.38;
        const sp = grain ? 3.5 + rnd() * 4.5 : 1.8 + rnd() * 3.2, upv = grain ? 1.6 + rnd() * 2.6 : 0.8 + rnd() * 1.6, sd = (rnd() - 0.5) * (grain ? 1.4 : 1.0);
        const vx = -_fw.x * dir * sp + _rt.x * sd, vz = -_fw.z * dir * sp + _rt.z * sd;
        if (grain) { this.emit(x, y + 0.05, z, vx, upv, vz, 0.9 + rnd() * 1.3, 0.035 + rnd() * 0.05, 0, 1, colour, 0.85); this.spawned.grain++; }
        else { this.emit(x, y + 0.1, z, vx, upv, vz, 3.2 + rnd() * 3, 0.3 + rnd() * 0.26, 0.30 + rnd() * 0.2, 0, colour, 0.5 + 0.22 * rnd()); this.spawned.fine++; }
      }

      // scrub: sliding sideways, or braking hard
      const scrub = Math.min(1.5, Math.max(0, Math.abs(lat) - 0.35) / 1.6 + (pw.slip > 0.9 ? braking * Math.min(1, aspeed / 4) : 0));
      st.accScrub += dt * dusty * scrub * 50 * K;
      while (st.accScrub >= 1) {
        st.accScrub -= 1;
        const grain = rnd() < 0.2;
        const vx = _vel.x * (0.45 + rnd() * 0.4) + (rnd() - 0.5) * 0.8, vz = _vel.z * (0.45 + rnd() * 0.4) + (rnd() - 0.5) * 0.8;
        if (grain) { this.emit(x, y + 0.04, z, vx * 1.3, 1.0 + rnd() * 1.6, vz * 1.3, 0.8 + rnd() * 0.8, 0.03 + rnd() * 0.04, 0, 1, colour, 0.8); this.spawned.grain++; }
        else { this.emit(x, y + 0.05, z, vx, 0.3 + rnd() * 0.7, vz, 2.6 + rnd() * 2.8, 0.3 + rnd() * 0.22, 0.28 + rnd() * 0.18, 0, colour, 0.42 + 0.2 * rnd()); this.spawned.fine++; }
      }

      // haze: what is still hanging there after the rover has gone (rear wheels, loose ground only)
      if (rear && loose > 0.2) {
        st.accHaze += dt * loose * Math.min(1, aspeed / 3) * 2.2 * K;
        while (st.accHaze >= 1) {
          st.accHaze -= 1;
          this.emit(x, y + 0.3, z, _vel.x * 0.12, 0.1 + rnd() * 0.2, _vel.z * 0.12, 9 + rnd() * 7, 0.8 + rnd() * 0.4, 0.42 + rnd() * 0.2, 0, colour, 0.16 + 0.08 * rnd());
          this.spawned.haze++;
        }
      }
    }
  }

  /** Every rendered frame: clocks and buffers. */
  frame() {
    const g = this.game;
    if (g.quality.name !== this.tier) this.build();
    this.on = g.settings.dust !== false;
    this.mesh.visible = this.on; this.tracks.mesh.visible = this.on;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uSunColor.value = g.sky.sunColor; this.uniforms.uAmbSky.value = g.sky.ambSky;
    if (this.dirty) { for (const a of this.attrs) a.needsUpdate = true; this.dirty = false; }
    this.tracks.frame(g.vehicle.odometer, this.time, this.on);
  }

  /** Counts for the tests and the report. `screens` = summed sprite area over the screen area (overdraw, in screen-fulls). */
  stats() {
    const cam = this.game.camera, t = this.time, h = this.game.renderer.domElement.height || 720;
    const focal = h / (2 * Math.tan(cam.fov * Math.PI / 360)), area = (this.game.renderer.domElement.width || 1280) * h;
    let live = 0, fine = 0, grain = 0, px = 0;
    for (let i = 0; i < this.N; i++) {
      const age = t - this.p0[i * 4 + 3], life = this.v0[i * 4 + 3];
      if (age < 0 || age >= life) continue;
      live++;
      if (this.parm[i * 4 + 2] > 0.5) { grain++; continue; }
      fine++;
      const size = this.parm[i * 4] + this.parm[i * 4 + 1] * Math.sqrt(age);
      const d = Math.max(1.6, Math.hypot(this.p0[i * 4] - cam.position.x, this.p0[i * 4 + 1] - cam.position.y, this.p0[i * 4 + 2] - cam.position.z));
      const s = Math.min(size * focal / d, h * 1.5);
      px += 0.6 * s * s;                                      // the sprite's body covers about 60% of its quad
    }
    return { on: this.on, slots: this.N, live, fine, grain, spawned: Object.assign({}, this.spawned), screens: px / area,
      trackStamps: this.tracks.stamped, trackVisible: this.tracks.visibleStamps, trackSamples: this.tracks.N,
      wind: [this.wind.x, this.wind.z], time: t };
  }

  clear() {
    for (let i = 0; i < this.N; i++) this.p0[i * 4 + 3] = -1e6;
    this.dirty = true; this.tracks.clear();
    this.spawned = { fine: 0, grain: 0, haze: 0, total: 0 };
  }
}

/** The "Dust effects" switch, added to the Settings screen beside the others. */
function addSetting(game, fx) {
  const done = document.getElementById("btn-settings-close");
  if (!done || document.getElementById("set-dust")) return;
  const lab = document.createElement("label");
  lab.className = "field";
  lab.innerHTML = `Dust effects (wheel dust and tracks)<select id="set-dust"><option value="on">On</option><option value="off">Off</option></select>`;
  done.before(lab);
  const sel = lab.querySelector("select");
  sel.value = game.settings.dust === false ? "off" : "on";
  sel.addEventListener("change", () => { game.settings.dust = sel.value !== "off"; game.applySettings(); if (!game.settings.dust) fx.clear(); if (game.ready) game.tick(0); });
}

registerSystem({
  id: "wheelfx",
  order: 35,
  fx: null,
  init(game) { this.fx = new WheelFX(game); game.wheelfx = this.fx; addSetting(game, this.fx); },
  load(game) { if (this.fx) this.fx.clear(); },                 // a new game or a restart: no dust or tracks from the last one
  tick(game, dt, ctx) { if (this.fx) this.fx.tick(dt, (ctx && ctx.ctl) || game.input.ctl); },
  frame(game) { if (this.fx) this.fx.frame(); },
  dispose(game) { if (this.fx) { game.scene.remove(this.fx.mesh, this.fx.tracks.mesh); this.fx = null; } },
});
