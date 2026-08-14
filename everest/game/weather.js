/**
 * Weather, and the reason there is a summit season at all.
 *
 * The subtropical jet stream sits on Everest for most of the year, which is
 * where the 300 km/h winds and the plume off the summit come from. For a few
 * days before the monsoon arrives and a few after it leaves, it lifts north
 * and the mountain becomes climbable. Everything about how an expedition is
 * run — two months of acclimatisation for a five-day push — follows from
 * waiting for that.
 *
 * So the jet is the spine of this model, not an afterthought: a slow signal
 * that opens and closes a window, with day-to-day weather riding on top of
 * it. A forecast is available at camps, it is only approximately right, and
 * committing to a summit push on a bad one is how the mountain kills you.
 */

import * as THREE from "../vendor/three.module.js?v=e563802-b9294f21";
import { WEATHER, PHYS } from "./config.js?v=e563802-b9294f21";

const STATE = {
  clear:      { cloud: 0.02, precip: 0.00, windMul: 0.75, vis: 60000, name: "Clear" },
  high:       { cloud: 0.18, precip: 0.00, windMul: 0.90, vis: 40000, name: "High cloud" },
  building:   { cloud: 0.45, precip: 0.08, windMul: 1.15, vis: 12000, name: "Building" },
  spindrift:  { cloud: 0.30, precip: 0.22, windMul: 1.55, vis:  6000, name: "Spindrift" },
  storm:      { cloud: 0.85, precip: 0.70, windMul: 2.10, vis:  1200, name: "Storm" },
  whiteout:   { cloud: 0.97, precip: 0.95, windMul: 1.85, vis:   140, name: "Whiteout" },
};

/** Which states can follow which. A whiteout does not arrive out of a clear
 *  sky — it builds, and the point of a forecast is that the build is
 *  visible if you are paying attention. */
const NEXT = {
  clear:     [["clear", 5], ["high", 4], ["building", 1]],
  high:      [["clear", 3], ["high", 4], ["building", 3]],
  building:  [["high", 3], ["building", 3], ["spindrift", 2], ["storm", 2]],
  spindrift: [["building", 3], ["spindrift", 3], ["storm", 3], ["clear", 1]],
  storm:     [["storm", 4], ["whiteout", 2], ["building", 3]],
  whiteout:  [["storm", 4], ["whiteout", 2], ["building", 2]],
};

/** Deterministic PRNG so a seed gives the same season twice — which is what
 *  makes "the forecast was wrong" a fact about the forecast rather than
 *  about the random number generator. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Weather {
  constructor(seed = 20260520) {
    this.rand = mulberry32(seed);
    this.state = "clear";
    this.blend = { ...STATE.clear };
    this.target = { ...STATE.clear };
    this.mix = 1;
    this.hoursInState = 0;
    /* Two to seven hours per spell. A full ascent is somewhere near sixteen
       simulated hours, so this gives it four or five distinct changes of
       weather — enough that the forecast is worth reading, and few enough
       that it does not read as flickering. */
    this.stateHours = 2 + this.rand() * 5;

    /** Day of the season, 0.. — the jet's position is a function of it. */
    this.day = 0;
    /** Bearing the wind comes FROM, degrees. Above 7,000 m on Everest that
     *  is nearly always west or west-north-west. */
    this.windFrom = 285;
    this.windGust = 0;
    this.elapsed = 0;

    this.snowFall = 0.12;       // how much fresh snow is lying, 0..1
    this.forecast = [];
    this.rebuildForecast();
  }

  /**
   * How far the jet has lifted off the summit, 0 (sitting on it) to 1 (gone).
   * A single window opens near the middle of the season and closes again,
   * with enough noise that its exact edges are not knowable in advance.
   */
  jetLift(day = this.day) {
    /* Two windows, and their timing is set by how long an ascent actually
       takes in this game rather than by the calendar. A push from Base Camp
       to the summit is roughly sixteen simulated hours of walking plus eight
       hours at each of five camps — about two and a third days. So the first
       window opens at 2.3 days: you set off under a forecast that says no,
       and it becomes a yes at about the time you reach the South Col, which
       is exactly the shape of the decision a summit push is.
       The second, weaker window four days later is the recovery chance for
       anyone who was slow or who turned round — real seasons have more than
       one, and a game with a single unrepeatable window is a game where the
       correct move is to reload. */
    const bell = (c, w) => Math.exp(-(((day - c) / w) ** 2) / 2);
    const core = bell(2.3, 0.85) + 0.62 * bell(6.4, 0.75);
    const wobble = 0.18 * Math.sin(day * 1.7 + 2.1) + 0.10 * Math.sin(day * 0.6);
    return Math.max(0, Math.min(1, core + wobble * core));
  }

  /** Wind speed in m/s at an altitude, before gusts. */
  windAt(altitude) {
    const lift = this.jetLift();
    const summit = WEATHER.jetOffSummit + (WEATHER.jetOnSummit - WEATHER.jetOffSummit) * (1 - lift);
    // Wind grows with height above the valley floor; the Cwm is famously
    // still while the summit ridge is being scoured.
    const t = Math.max(0, (altitude - WEATHER.windRefAlt) / (8850 - WEATHER.windRefAlt));
    const shape = 0.16 + 0.84 * t * t;
    const v = summit * shape * this.blend.windMul * (1 + this.windGust);
    /* The jet on the summit in a storm multiplies out to 130 m/s, which is
       470 km/h and roughly twice anything ever measured up there. The
       highest recorded gust on Everest is about 280 km/h, so that is the
       ceiling — a number the model is not entitled to exceed just because
       two of its multipliers happened to line up. */
    return Math.min(v, 78);
  }

  /** Air temperature in °C at an altitude. */
  tempAt(altitude, hourLocal = 12) {
    const diurnal = -6 * Math.cos((hourLocal - 14) / 24 * 2 * Math.PI);
    const base = WEATHER.baseTempC + diurnal - this.blend.cloud * 3;
    return base - (altitude - 5364) * WEATHER.lapseC;
  }

  /**
   * Wind chill, °C — the 2001 JAG/TI formula, which is defined for
   * temperatures at or below 10 °C and winds above 1.3 m/s. That covers
   * everything above Base Camp.
   */
  windChill(tempC, windMs) {
    const v = Math.max(1.34, windMs) * 3.6;          // km/h
    const p = Math.pow(v, 0.16);
    return 13.12 + 0.6215 * tempC - 11.37 * p + 0.3965 * tempC * p;
  }

  /** Metres you can see. */
  get visibility() { return this.blend.vis; }
  /** 0..1, how much the world has gone featureless white. */
  get whiteout() { return Math.max(0, Math.min(1, (900 - this.blend.vis) / 900)) * 0.92; }
  get cloud() { return this.blend.cloud; }
  get precip() { return this.blend.precip; }
  get label() { return STATE[this.state].name; }

  rebuildForecast() {
    // A forecast is a projection from the current state, and the further out
    // it goes the less it means. The player is shown the confidence.
    let s = this.state;
    const r = mulberry32(Math.floor(this.day) * 7919 + 13);
    this.forecast = [];
    for (let d = 1; d <= 5; d++) {
      s = pick(NEXT[s], r);
      const lift = this.jetLift(this.day + d);
      this.forecast.push({
        day: d,
        state: s,
        name: STATE[s].name,
        summitWind: Math.round((WEATHER.jetOffSummit + (WEATHER.jetOnSummit - WEATHER.jetOffSummit) * (1 - lift)) * STATE[s].windMul * 3.6),
        confidence: Math.max(0.2, 1 - d * 0.16),
      });
    }
  }

  /** @param dtHours  simulated hours elapsed since the last call */
  update(dtHours, dtSeconds) {
    this.elapsed += dtSeconds;
    this.day += dtHours / 24;
    this.hoursInState += dtHours;

    if (this.hoursInState >= this.stateHours) {
      this.hoursInState = 0;
      this.stateHours = 2 + this.rand() * 5;
      // The jet biases the transition: with it sitting on the mountain a
      // clear spell is unlikely to survive, and with it lifted a storm has
      // less to feed on.
      const lift = this.jetLift();
      const opts = NEXT[this.state].map(([s, w]) => {
        const severity = ["clear", "high", "building", "spindrift", "storm", "whiteout"].indexOf(s);
        const bias = lift > 0.5 ? Math.max(0.15, 1 - severity * 0.22 * (lift - 0.5) * 2)
                                : 1 + severity * 0.30 * (0.5 - lift) * 2;
        return [s, w * bias];
      });
      this.state = pick(opts, this.rand);
      this.target = STATE[this.state];
      this.mix = 0;
      this.rebuildForecast();
    }

    // Weather changes over tens of minutes, not instantly.
    this.mix = Math.min(1, this.mix + dtHours / 0.6);
    const t = this.mix * this.mix * (3 - 2 * this.mix);
    for (const k of ["cloud", "precip", "windMul", "vis"]) {
      this.blend[k] = this.blend[k] + (this.target[k] - this.blend[k]) * (t * 0.12 + 0.02);
    }

    // Gusts: fast, signed, and the thing that actually knocks you over.
    const g = Math.sin(this.elapsed * 0.31) * Math.sin(this.elapsed * 0.13 + 1.3)
            + 0.5 * Math.sin(this.elapsed * 0.87 + 0.4);
    this.windGust = Math.max(-0.35, g * (0.22 + 0.5 * this.blend.precip));

    this.windFrom = 285 + 22 * Math.sin(this.day * 0.9) + 6 * Math.sin(this.elapsed * 0.05);

    // Fresh snow accumulates while it is falling and gets stripped by wind.
    const fall = this.blend.precip * dtHours * 0.35;
    const strip = Math.max(0, this.windAt(7000) - 14) * dtHours * 0.010;
    this.snowFall = Math.max(0.02, Math.min(1, this.snowFall + fall - strip - dtHours * 0.012));
  }

  /** Unit vector the wind is blowing TOWARD, in local frame. */
  windVector(out = new THREE.Vector3()) {
    const to = (this.windFrom + 180) * Math.PI / 180;
    return out.set(Math.sin(to), 0, -Math.cos(to));
  }
}

function pick(weighted, rand) {
  let total = 0;
  for (const [, w] of weighted) total += w;
  let r = rand() * total;
  for (const [s, w] of weighted) { if ((r -= w) <= 0) return s; }
  return weighted[weighted.length - 1][0];
}

/* ── Precipitation ───────────────────────────────────────────────────────
   One Points cloud that follows the camera, wrapping in a box around it, so
   a fixed number of particles covers any amount of ground. Snow at altitude
   is not the vertical drift of a christmas card — it is nearly horizontal
   and it is mostly old snow being moved rather than new snow arriving. */

const SNOW_VERT = /* glsl */`
  attribute float seed;
  uniform float time;
  uniform vec3  wind;        // metres/second, world
  uniform vec3  origin;      // box centre — the camera
  uniform float boxSize;
  uniform float fall;        // 0..1 intensity
  uniform float pixelScale;
  varying float vFade;
  varying float vSeed;

  void main() {
    vec3 p = position;
    // Advect, then wrap into the box around the camera. Wrapping in world
    // space (not view space) means the flakes do not swim when you turn.
    p += wind * time * (0.75 + 0.5 * seed);
    p.y -= time * (0.55 + 0.9 * seed) * 1.4;
    p = mod(p - origin + boxSize * 0.5, boxSize) - boxSize * 0.5 + origin;

    vec4 mv = viewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    // Fade the nearest ones out or the camera sits inside a flake.
    vFade = smoothstep(0.6, 3.0, d) * (1.0 - smoothstep(boxSize * 0.32, boxSize * 0.5, d));
    vSeed = seed;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.2 + 3.4 * seed) * fall * pixelScale / max(d, 1.0) * 40.0;
  }
`;

const SNOW_FRAG = /* glsl */`
  precision highp float;
  varying float vFade;
  varying float vSeed;
  uniform vec3 tint;
  uniform float fall;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    float a = (1.0 - r * 4.0) * vFade * (0.35 + 0.65 * vSeed) * fall;
    if (a <= 0.005) discard;
    gl_FragColor = vec4(tint, a);
  }
`;

export class Precipitation {
  constructor(count = 9000, boxSize = 120) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * boxSize;
      pos[i * 3 + 1] = (Math.random() - 0.5) * boxSize;
      pos[i * 3 + 2] = (Math.random() - 0.5) * boxSize;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boxSize);

    this.uniforms = {
      time: { value: 0 },
      wind: { value: new THREE.Vector3() },
      origin: { value: new THREE.Vector3() },
      boxSize: { value: boxSize },
      fall: { value: 0 },
      tint: { value: new THREE.Color(0.96, 0.97, 1.0) },
      pixelScale: { value: 1 },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 900;
    this.points.name = "precipitation";
  }

  update(camera, weather, dt, altitude, pixelRatio) {
    this.uniforms.time.value += dt;
    this.uniforms.origin.value.copy(camera.position);
    this.uniforms.pixelScale.value = pixelRatio;
    const w = weather.windVector(_wv).multiplyScalar(weather.windAt(altitude));
    this.uniforms.wind.value.copy(w);
    const amount = Math.min(1, weather.precip * 1.25 + weather.whiteout * 0.5);
    this.uniforms.fall.value += (amount - this.uniforms.fall.value) * Math.min(1, dt * 0.8);
    this.points.visible = this.uniforms.fall.value > 0.01;
  }
}

const _wv = new THREE.Vector3();

/**
 * Spindrift — the snow the wind is already carrying.
 *
 * Above about 15 m/s almost nothing falling out of the sky matters and
 * almost everything you see is old snow being moved sideways, hugging the
 * ground in streamers and pouring off every ridge. That is what a windy day
 * on this mountain *looks* like, and a particle system that only drifts
 * downward cannot show it at all.
 *
 * Drawn as line segments rather than points, because the length of a streak
 * is the wind speed: a point sprite can only get bigger, and bigger is not
 * faster. Each segment is stretched along the wind by however hard it is
 * blowing, so the same geometry reads as calm, as gusting, and as a scouring
 * eighty-knot ground blizzard without changing anything but a uniform.
 */
export class Spindrift {
  constructor(count = 4200, boxSize = 90) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * boxSize;
      const y = Math.random();                       // height fraction, resolved live
      const z = (Math.random() - 0.5) * boxSize;
      for (let e = 0; e < 2; e++) {
        pos[(i * 2 + e) * 3] = x;
        pos[(i * 2 + e) * 3 + 1] = y;
        pos[(i * 2 + e) * 3 + 2] = z;
        seed[i * 2 + e] = e;                         // 0 = tail, 1 = head
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("end", new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boxSize);

    this.uniforms = {
      time:    { value: 0 },
      wind:    { value: new THREE.Vector3() },
      origin:  { value: new THREE.Vector3() },
      ground:  { value: 0 },
      boxSize: { value: boxSize },
      amount:  { value: 0 },
      streak:  { value: 1 },
      tint:    { value: new THREE.Color(1, 1, 1) },
    };
    this.lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float end;
        uniform float time, boxSize, amount, streak, ground;
        uniform vec3 wind, origin;
        varying float vA;
        void main() {
          vec3 p = position;
          // Wrap a slab around the camera. The slab hugs the ground: y is a
          // fraction, biased low, so most of it is in the first few metres
          // where blowing snow actually lives.
          float hFrac = pow(p.y, 2.2);
          p.xz += wind.xz * time;
          p.xz = mod(p.xz - origin.xz + boxSize * 0.5, boxSize) - boxSize * 0.5 + origin.xz;
          float h = 0.15 + hFrac * 14.0;
          p.y = ground + h + sin(time * 1.7 + p.x * 0.4) * 0.35 * hFrac;
          /* The head of each segment runs ahead of the tail, by more the
             harder it blows — but bounded. Scaling straight off the wind put
             nine-metre streaks on the screen at 260 km/h, which reads as
             rain, or as a bug in the line renderer. Blowing snow streaks
             over roughly a metre at any speed you can stand up in; what
             changes with the wind is how many there are and how flat they
             run, not how long each one is. */
          p += normalize(wind + vec3(0.0001)) * end * streak;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = amount * smoothstep(1.0, 6.0, d) * (1.0 - smoothstep(boxSize * 0.3, boxSize * 0.5, d))
               * (1.0 - hFrac * 0.55);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vA;
        uniform vec3 tint;
        void main() {
          if (vA <= 0.004) discard;
          gl_FragColor = vec4(tint, vA * 0.5);
        }`,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 890;
    this.lines.name = "spindrift";
  }

  update(camera, weather, dt, groundY, altitude) {
    const u = this.uniforms;
    u.time.value += dt;
    u.origin.value.copy(camera.position);
    u.ground.value = groundY;
    const wind = weather.windAt(altitude);
    weather.windVector(_sv).multiplyScalar(wind);
    u.wind.value.copy(_sv);
    // Nothing is picked up below about 8 m/s; by 25 the air is full of it.
    // Wind alone lifts old snow; fresh snow just gives it more to lift.
    const amt = Math.min(1, Math.max(0, (wind - 7) / 20)) * (0.55 + 0.45 * weather.snowFall);
    u.amount.value += (amt - u.amount.value) * Math.min(1, dt * 0.9);
    u.streak.value = 0.35 + Math.min(1.35, wind / 26);      // metres
    this.lines.visible = u.amount.value > 0.01;
  }
}

const _sv = new THREE.Vector3();
