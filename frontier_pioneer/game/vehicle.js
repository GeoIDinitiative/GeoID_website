/**
 * Surface vehicles: definitions as data, and one physics model that drives
 * any of them. Built the way the flight sim builds ships (a table of numbers
 * per craft, one integrator), but for the ground.
 *
 * BODY FRAME: -Z forward, +X right, +Y up; the origin is the centre of mass.
 *
 * THE MODEL, AND WHAT IT IS NOT. A rigid body on six independently sprung
 * wheels. Each wheel samples the SAME ground function the renderer draws
 * (surface.contact: measured terrain + generated detail + rocks), pushes back
 * along the ground normal with a spring and damper, and can put down
 * traction up to mu x normal force, shared between driving and cornering (a
 * friction circle). Traction and rolling resistance come from the regolith
 * under that wheel: bedrock grips, sand does not, and a wheel that spins in
 * sand digs itself in. That is enough for terrain to matter: the rover
 * pitches over rocks, slides on side slopes, tips if you ask too much of it,
 * and stalls on a steep loose slope (it can hold about atan(mu - Crr): 34
 * degrees on rock, 15 on sand).
 * It is NOT a rocker-bogie: the real mechanism links the wheels through a
 * differential so the body takes half the pitch of either side. Six
 * independent springs with long travel approximate the look and the
 * compliance, not the kinematics. Nor is it terramechanics: sinkage is one
 * number per wheel.
 *
 * ENERGY. Drive energy is mechanical work at the wheels divided by drivetrain
 * efficiency: force times distance, so it does not depend on how fast the
 * clock runs. Hotel loads (avionics, heaters) and solar input are per
 * simulated second. A flat battery stops the drive; the Sun brings it back.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { MARS } from "./config.js?v=6d37c9c-9b39e129";

export const VEHICLES = {
  rover_crew: {
    id: "rover_crew",
    name: "Crew rover",
    model: "rover_crew",              // id in assets/models/catalog.json, when the kit provides it
    mass: 3200,                       // kg
    box: { length: 5.3, width: 2.9, height: 2.3, y: 0.75 },     // hull envelope, centre offset up from the centre of mass
    wheelRadius: 0.5, wheelWidth: 0.42,
    // attach points of the suspension, body frame. steer: +1 front, 0 middle, -1 rear (rear counter-steers)
    wheels: [
      { name: "fl", pos: [-1.45, -0.18, -1.9], steer: 1 },
      { name: "fr", pos: [1.45, -0.18, -1.9], steer: 1 },
      { name: "ml", pos: [-1.45, -0.18, 0.0], steer: 0 },
      { name: "mr", pos: [1.45, -0.18, 0.0], steer: 0 },
      { name: "rl", pos: [-1.45, -0.18, 1.9], steer: -0.6 },
      { name: "rr", pos: [1.45, -0.18, 1.9], steer: -0.6 },
    ],
    suspension: { free: 0.60, min: 0.12, sag: 0.16, dampingRatio: 0.55 },
    drive: {
      maxSpeed: 8.0,                  // m/s forward (a real rover: 0.04)
      reverseSpeed: 3.0,
      stallForce: 9500,               // N, all wheels together
      crawlSpeed: 2.2, crawlForce: 1.6,   // L1: low range, more torque, traction control
      brakeForce: 16000,
      steerMaxDeg: 30, steerRate: 2.6,    // rad/s of steering slew
    },
    power: {
      battery_kWh: 24,
      driveEfficiency: 0.45,              // wheels, gearboxes, motor controllers, and slip
      hotelDay_kW: 0.2, hotelNight_kW: 0.4,
      headlights_kW: 0.15,
      solarArea_m2: 12, solarEfficiency: 0.27,   // about 1.2 kW at noon in ordinary dust: roughly a sol's hotel load
    },
    cameras: { chase: { distance: 9.5, height: 3.4 }, mast: { pos: [0, 2.25, -1.7] } },
    lamp: { pos: [0, 1.0, -2.9] },
  },
  // Progression designs (game/progress.js: bought in the Workshop, switched to at a base garage). Same model, other numbers;
  // like the crew rover, each takes its wheel track, wheelbase and radius from its own GLB (tools/assets/build_procedural.py).
  rover_scout: {
    id: "rover_scout",
    name: "Scout buggy",
    model: "rover_scout",
    mass: 1400,
    box: { length: 3.4, width: 1.7, height: 1.3, y: 0.44 },
    wheelRadius: 0.42, wheelWidth: 0.34,
    wheels: [
      { name: "fl", pos: [-1.05, -0.12, -1.3], steer: 1 },
      { name: "fr", pos: [1.05, -0.12, -1.3], steer: 1 },
      { name: "rl", pos: [-1.05, -0.12, 1.3], steer: -0.5 },
      { name: "rr", pos: [1.05, -0.12, 1.3], steer: -0.5 },
    ],
    suspension: { free: 0.50, min: 0.10, sag: 0.13, dampingRatio: 0.5 },
    drive: { maxSpeed: 12.0, reverseSpeed: 4.0, stallForce: 6000, crawlSpeed: 2.6, crawlForce: 1.5, brakeForce: 8000, steerMaxDeg: 32, steerRate: 3.0 },
    power: { battery_kWh: 14, driveEfficiency: 0.5, hotelDay_kW: 0.12, hotelNight_kW: 0.25, headlights_kW: 0.10, solarArea_m2: 6, solarEfficiency: 0.27 },
    cameras: { chase: { distance: 7.5, height: 2.8 }, mast: { pos: [0, 1.55, -1.0] } },
    lamp: { pos: [0, 0.35, -1.75] },
  },
  rover_hauler: {
    id: "rover_hauler",
    name: "Heavy hauler",
    model: "rover_hauler",
    mass: 6500,
    box: { length: 6.8, width: 2.6, height: 2.0, y: 0.65 },
    wheelRadius: 0.65, wheelWidth: 0.55,
    wheels: [
      { name: "fl", pos: [-1.6, -0.25, -2.3], steer: 1 },
      { name: "fr", pos: [1.6, -0.25, -2.3], steer: 1 },
      { name: "ml", pos: [-1.6, -0.25, 0.0], steer: 0 },
      { name: "mr", pos: [1.6, -0.25, 0.0], steer: 0 },
      { name: "rl", pos: [-1.6, -0.25, 2.3], steer: -0.6 },
      { name: "rr", pos: [1.6, -0.25, 2.3], steer: -0.6 },
    ],
    suspension: { free: 0.75, min: 0.15, sag: 0.20, dampingRatio: 0.6 },
    drive: { maxSpeed: 6.0, reverseSpeed: 2.5, stallForce: 24000, crawlSpeed: 2.0, crawlForce: 1.8, brakeForce: 34000, steerMaxDeg: 26, steerRate: 2.0 },
    power: { battery_kWh: 60, driveEfficiency: 0.5, hotelDay_kW: 0.3, hotelNight_kW: 0.6, headlights_kW: 0.2, solarArea_m2: 20, solarEfficiency: 0.27 },
    cameras: { chase: { distance: 13, height: 4.4 }, mast: { pos: [0, 1.75, -2.6] } },
    lamp: { pos: [0, 0.35, -3.45] },
  },
};

/** Regolith -> wheel parameters. Bedrock to loose sand. */
export function ground(sand) {
  return { mu: 0.75 - 0.30 * sand, crr: 0.06 + 0.12 * sand };
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Vector3();
const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const SUB = 1 / 120;

export class Vehicle {
  constructor(def, surface) {
    this.def = def; this.surface = surface;
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    const b = def.box, m = def.mass;
    this.inertia = new THREE.Vector3(m / 12 * (b.height ** 2 + b.length ** 2), m / 12 * (b.width ** 2 + b.length ** 2), m / 12 * (b.width ** 2 + b.height ** 2));
    const s = def.suspension, share = m * MARS.gravity / def.wheels.length;
    this.k = share / s.sag;
    this.c = 2 * s.dampingRatio * Math.sqrt(this.k * m / def.wheels.length);
    this.rest = s.free - s.sag;
    this.rideHeight = -def.wheels[0].pos[1] + this.rest + def.wheelRadius;       // COM above ground at rest
    this.wheels = def.wheels.map((d) => ({
      def: d, attach: new THREE.Vector3(...d.pos), len: this.rest, steer: 0, spin: 0, sink: 0, slip: 0,
      contact: false, load: 0, sand: 0,
    }));
    this.battery = def.power.battery_kWh * 3.6e6;          // joules
    this.capacity = this.battery;
    this.flat = false;
    this.headlights = false;
    this.odometer = 0; this.energyUsed = 0;
    this.steer = 0;
    this.t = { speed: 0, heading: 0, pitch: 0, roll: 0, tilt: 0, slope: 0, solar_W: 0, drive_W: 0, hotel_W: 0,
      airborne: false, stuck: false, tipped: false, slipping: false, sand: 0, sink: 0 };
    this._stuckT = 0; this._tipT = 0; this._acc = 0;
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false, crawl: false };
    // What other systems do to the rover (cold, wear, a base's charger...). Each sets its own entry:
    //   vehicle.modifiers.<system id> = { hotel_W: +watts, solar: x, drive: x force, crr: +rolling resistance, locked: 0..1 of capacity unusable }
    // and they are combined once per update: sums for hotel_W and crr, products for solar and drive, the largest locked.
    this.modifiers = {};
    // Progression (game/progress.js) adds factors, all products (1 = stock): speed (top speed), mu / muSand (traction on firm
    //   ground / on loose sand, blended by the regolith under each wheel), sink (sinkage), capacity (battery), eff (drivetrain
    //   efficiency), stab (raises where traction acts toward the centre of mass: less pitch and roll), damp (suspension damping).
    this._mod = { hotel_W: 0, solar: 1, drive: 1, crr: 0, locked: 0, speed: 1, mu: 1, muSand: 1, sink: 1, capacity: 1, eff: 1, stab: 1, damp: 1 };
  }
  _modifiers() {
    const m = this._mod;
    m.hotel_W = 0; m.solar = 1; m.drive = 1; m.crr = 0; m.locked = 0;
    m.speed = 1; m.mu = 1; m.muSand = 1; m.sink = 1; m.capacity = 1; m.eff = 1; m.stab = 1; m.damp = 1;
    for (const k in this.modifiers) {
      const s = this.modifiers[k];
      if (!s) continue;
      m.hotel_W += s.hotel_W || 0; m.solar *= s.solar ?? 1; m.drive *= s.drive ?? 1; m.crr += s.crr || 0; m.locked = Math.max(m.locked, s.locked || 0);
      m.speed *= s.speed ?? 1; m.mu *= s.mu ?? 1; m.muSand *= s.muSand ?? 1; m.sink *= s.sink ?? 1; m.capacity *= s.capacity ?? 1;
      m.eff *= s.eff ?? 1; m.stab *= s.stab ?? 1; m.damp *= s.damp ?? 1;
    }
    m.locked = Math.min(0.9, m.locked);
    m.stab = Math.min(m.stab, 1.6);                     // the traction point never rises above the centre of mass
    // capacity follows its factor; the charge in it does not (a bigger pack starts as full as the joules in it)
    const cap = this.def.power.battery_kWh * 3.6e6 * m.capacity;
    if (Math.abs(cap - this.capacity) > 1) { this.capacity = cap; this.battery = Math.min(this.battery, cap); }
  }

  get batteryFraction() { return this.battery / this.capacity; }

  /** Put the rover on the ground at (x, z), facing `yaw` radians clockwise from north. */
  place(x, z, yaw = 0) {
    const n = this.surface.normal(x, z, 1.8, _n);
    const qYaw = _dq.setFromAxisAngle(_a.set(0, 1, 0), -yaw);
    const qTilt = _qi.setFromUnitVectors(_a.set(0, 1, 0), n);
    this.q.copy(qTilt).multiply(qYaw);
    this.p.set(x, this.surface.contact(x, z) + this.rideHeight + 0.08, z);
    this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wheels) { w.len = this.rest; w.sink = 0; w.slip = 0; }
    this._stuckT = 0; this._tipT = 0;
  }

  /** Right the rover where it stands (L3). */
  recover() {
    _fw.set(0, 0, -1).applyQuaternion(this.q);
    const yaw = Math.atan2(_fw.x, -_fw.z);
    this.place(this.p.x, this.p.z, yaw);
  }

  /**
   * Advance by dt real seconds.
   * @param env {sunDir: Vector3, irradiance: {direct, diffuse}, sinEl, timeScale, night: bool}
   */
  update(dt, ctl, env) {
    this.ctl = ctl;
    this._modifiers();
    this._acc += Math.min(dt, 0.1);
    let driveJ = 0;
    while (this._acc >= SUB) { driveJ += this._substep(SUB, ctl); this._acc -= SUB; }
    this._energy(dt, driveJ, env);
    this._telemetry(dt, ctl);
  }

  _substep(dt, ctl) {
    const def = this.def, S = this.surface, m = def.mass, nW = this.wheels.length;
    _up.set(0, 1, 0).applyQuaternion(this.q);
    _fw.set(0, 0, -1).applyQuaternion(this.q);
    _rt.set(1, 0, 0).applyQuaternion(this.q);
    _F.set(0, -m * MARS.gravity, 0);
    _T.set(0, 0, 0);

    // Steering slews toward the stick, and eases off with speed.
    const fwdSpeed = this.v.dot(_fw);
    const maxSteer = def.drive.steerMaxDeg * Math.PI / 180 / (1 + Math.pow(Math.abs(fwdSpeed) / 6.5, 2));
    const target = ctl.steer * maxSteer;
    const ds = def.drive.steerRate * dt;
    this.steer += Math.max(-ds, Math.min(ds, target - this.steer));

    // Throttle and brake -> a signed drive demand and a brake demand.
    let drive = 0, brake = ctl.handbrake ? 1 : 0;
    if (ctl.throttle > 0 && fwdSpeed > -0.4) drive = ctl.throttle;
    else if (ctl.throttle > 0) brake = Math.max(brake, ctl.throttle);
    if (ctl.brake > 0) {
      if (fwdSpeed > 0.4 || ctl.throttle > 0) brake = Math.max(brake, ctl.brake);
      else drive = -ctl.brake;                                  // stopped: the brake trigger backs up
    }
    if (drive === 0 && !ctl.brake) brake = Math.max(brake, Math.abs(fwdSpeed) < 0.35 ? 0.6 : 0.10);   // parking brake; motor drag when coasting
    if (this.flat) drive = 0;
    const crawl = ctl.crawl;
    const vmax = drive >= 0 ? (crawl ? def.drive.crawlSpeed : def.drive.maxSpeed * this._mod.speed) : Math.min(def.drive.reverseSpeed * this._mod.speed, crawl ? def.drive.crawlSpeed : 99);
    const stall = def.drive.stallForce / nW * (crawl ? def.drive.crawlForce : 1) * this._mod.drive;
    const mEff = m / nW;
    let work = 0, contacts = 0, slipping = false, sandSum = 0, sinkMax = 0;
    const md = this._mod;
    const tiltOK = Math.max(_up.y, 0.3);

    for (let i = 0; i < nW; i++) {
      const w = this.wheels[i], d = w.def;
      // attach point in the world
      _a.copy(w.attach).applyQuaternion(this.q).add(this.p);
      // wheel centre at full droop
      const free = def.suspension.free;
      _c.copy(_a).addScaledVector(_up, -free);
      const g = S.contact(_c.x, _c.z) - w.sink * md.sink;
      sinkMax = Math.max(sinkMax, w.sink * md.sink);
      const pen = g + def.wheelRadius - _c.y;
      const prev = w.len;
      if (pen <= 0 || _up.y < 0.05) { w.len = free; w.contact = false; w.load = 0; w.slip = 0; w.spin += fwdSpeed / def.wheelRadius * dt; continue; }
      w.len = free - pen / tiltOK;
      let Fs = this.k * (free - w.len) + this.c * md.damp * (prev - w.len) / dt;
      if (w.len < def.suspension.min) { Fs += 9 * this.k * (def.suspension.min - w.len); if (w.len < 0) w.len = 0; }
      if (Fs <= 0) { w.contact = false; w.load = 0; continue; }
      Fs = Math.min(Fs, m * MARS.gravity * 4);
      w.contact = true; w.load = Fs; contacts++;
      S.normal(_c.x, _c.z, 0.4, _n);
      // contact point and its velocity
      _r.set(_c.x - this.p.x, g - this.p.y, _c.z - this.p.z);
      _v.copy(this.w).cross(_r).add(this.v);
      // wheel heading on the ground plane
      const ang = this.steer * d.steer;
      _f.copy(_fw).multiplyScalar(Math.cos(ang)).addScaledVector(_rt, Math.sin(ang));
      _f.addScaledVector(_n, -_f.dot(_n)).normalize();
      _s.copy(_f).cross(_n);
      const vl = _v.dot(_f), vs = _v.dot(_s);
      const reg = S.regolith(_c.x, _c.z);
      w.sand = reg.sand; sandSum += reg.sand;
      const gr = ground(reg.sand);
      const limit = gr.mu * (md.mu + (md.muSand - md.mu) * reg.sand) * Fs;
      // drive, tapering to nothing at the governed speed
      let Fd = 0;
      if (drive !== 0) {
        const along = vl * Math.sign(drive) / vmax;
        Fd = drive * stall * (along <= 0 ? 1 : Math.max(0, 1 - along * along));
        if (crawl) Fd = Math.max(-0.85 * limit, Math.min(0.85 * limit, Fd));      // traction control
      }
      let Fb = 0;
      if (brake > 0) {
        const hb = ctl.handbrake && d.steer <= 0 ? 1 : brake;
        Fb = -Math.sign(vl) * Math.min(hb * def.drive.brakeForce / nW, Math.abs(vl) * mEff / dt);
      }
      let Fl = -vs * mEff / dt * 0.5 * (ctl.handbrake && d.steer < 0 ? 0.35 : 1);
      let Fx = Fd + Fb;
      const want = Math.hypot(Fx, Fl);
      w.slip = want / Math.max(limit, 1);
      let kTr = 1;
      if (want > limit) { kTr = limit / want; Fx *= kTr; Fl *= kTr; }
      // spinning in sand digs in; rolling freely climbs back out
      // (only when the wheel is saturated AND going nowhere: a standing start on flat sand gets away, a loose slope does not)
      const spin = Math.abs(Fd) > limit * 0.98 && Math.abs(vl) < 0.45;
      if (spin && reg.sand > 0.3) { w.sink = Math.min(0.22, w.sink + dt * 0.05 * reg.sand); slipping = true; }
      else w.sink = Math.max(0, w.sink - dt * (0.02 + 0.06 * Math.abs(vl)));
      const crr = gr.crr + 1.9 * w.sink * md.sink + md.crr;
      const Fr = -Math.sign(vl) * Math.min(crr * Fs, Math.abs(vl) * mEff / dt);
      if (Fd * vl > 0) work += Fd * kTr * vl * dt;
      // accumulate: normal force at the contact, traction a little above it (keeps hard launches from pitching the body over)
      _b.copy(_n).multiplyScalar(Fs);
      _F.add(_b); _T.add(_c.copy(_r).cross(_b));
      _b.copy(_f).multiplyScalar(Fx + Fr).addScaledVector(_s, Fl);
      _F.add(_b);
      _r.addScaledVector(_up, this.rideHeight * 0.55 * md.stab);
      _T.add(_c.copy(_r).cross(_b));
      w.spin += vl / def.wheelRadius * dt;
      w.steer = ang;
    }

    // The body itself: corners of the envelope against the ground, so a rolled rover lies on its roof.
    const bx = def.box, hx = bx.width / 2, hz = bx.length / 2;
    for (let k = 0; k < 8; k++) {
      _a.set(k & 1 ? hx : -hx, bx.y + (k & 2 ? bx.height / 2 : -bx.height / 2), k & 4 ? hz : -hz).applyQuaternion(this.q);
      const px = this.p.x + _a.x, pz = this.p.z + _a.z, py = this.p.y + _a.y;
      const depth = S.height(px, pz) - py;
      if (depth <= 0) continue;
      _v.copy(this.w).cross(_a).add(this.v);
      const Fn = Math.max(0, 70000 * depth - 7000 * _v.y);
      _b.set(0, Fn, 0);
      const vt = Math.hypot(_v.x, _v.z);
      if (vt > 1e-3) { const fr = Math.min(0.7 * Fn, vt * m / 8 / dt); _b.x = -_v.x / vt * fr; _b.z = -_v.z / vt * fr; }
      _F.add(_b); _T.add(_c.copy(_a).cross(_b));
    }

    // integrate
    this.v.addScaledVector(_F, dt / m);
    _qi.copy(this.q).invert();
    _a.copy(_T).applyQuaternion(_qi);                 // torque in the body frame
    _b.copy(this.w).applyQuaternion(_qi);             // angular velocity in the body frame
    const I = this.inertia;
    _c.set(I.x * _b.x, I.y * _b.y, I.z * _b.z);
    _v.copy(_b).cross(_c);
    _b.x += (_a.x - _v.x) / I.x * dt; _b.y += (_a.y - _v.y) / I.y * dt; _b.z += (_a.z - _v.z) / I.z * dt;
    _b.multiplyScalar(1 - Math.min(1, 0.35 * dt));
    this.w.copy(_b).applyQuaternion(this.q);
    const wl = this.w.length();
    if (wl > 1e-6) { _dq.setFromAxisAngle(_a.copy(this.w).divideScalar(wl), wl * dt); this.q.premultiply(_dq).normalize(); }
    this.p.addScaledVector(this.v, dt);
    // never under the ground, whatever happened
    const floor = S.height(this.p.x, this.p.z) + 0.25;
    if (this.p.y < floor) { this.p.y = floor; if (this.v.y < 0) this.v.y = 0; }
    this.odometer += Math.abs(fwdSpeed) * dt;
    this._contacts = contacts; this._slipping = slipping; this._sand = sandSum / nW; this._sinkMax = sinkMax;
    return Math.max(0, work);
  }

  _energy(dt, driveJ, env) {
    const P = this.def.power;
    const simDt = dt * (env.timeScale || 1);
    const driveIn = driveJ / Math.min(0.95, P.driveEfficiency * this._mod.eff);
    const night = env.sinEl <= 0;
    let hotelW = (night ? P.hotelNight_kW : P.hotelDay_kW) * 1000;
    if (this.headlights) hotelW += P.headlights_kW * 1000;
    hotelW += this._mod.hotel_W;
    _up.set(0, 1, 0).applyQuaternion(this.q);
    const facing = Math.max(0, _up.dot(env.sunDir));
    const beam = env.sinEl > 0 ? env.irradiance.direct / Math.max(env.sinEl, 1e-3) : 0;      // normal-incidence fraction
    const solarW = MARS.solarConstant * P.solarArea_m2 * P.solarEfficiency * (beam * facing + env.irradiance.diffuse) * (env.panelFactor ?? 1) * this._mod.solar;
    const before = this.battery;
    this.battery = Math.max(0, Math.min(this.capacity, this.battery - driveIn - hotelW * simDt + solarW * simDt));
    this.energyUsed += driveIn + hotelW * simDt;
    const locked = this._mod.locked * this.capacity;          // charge a cold or damaged pack cannot deliver
    if (this.battery <= locked) this.flat = true;
    else if (this.flat && this.battery > locked + 0.03 * this.capacity) this.flat = false;
    const t = this.t;
    t.solar_W = solarW; t.hotel_W = hotelW; t.drive_W = dt > 0 ? driveIn / dt : 0;
    t.net_W = dt > 0 ? (this.battery - before) / simDt : 0;
  }

  _telemetry(dt, ctl) {
    const t = this.t;
    _up.set(0, 1, 0).applyQuaternion(this.q);
    _fw.set(0, 0, -1).applyQuaternion(this.q);
    _rt.set(1, 0, 0).applyQuaternion(this.q);
    t.speed = this.v.dot(_fw);
    t.heading = (Math.atan2(_fw.x, -_fw.z) * 180 / Math.PI + 360) % 360;
    t.pitch = Math.asin(Math.max(-1, Math.min(1, _fw.y))) * 180 / Math.PI;
    t.roll = Math.asin(Math.max(-1, Math.min(1, -_rt.y))) * 180 / Math.PI;
    t.tilt = Math.acos(Math.max(-1, Math.min(1, _up.y))) * 180 / Math.PI;
    t.slope = this.surface.slopeDeg(this.p.x, this.p.z, 2);
    t.airborne = this._contacts === 0;
    t.slipping = !!this._slipping;
    t.sand = this._sand || 0;
    t.sink = this._sinkMax || 0;                      // the deepest wheel's effective sinkage, m
    const pushing = (ctl.throttle > 0.4 || ctl.brake > 0.4) && !this.flat;
    this._stuckT = pushing && Math.abs(t.speed) < 0.25 && !t.airborne ? this._stuckT + dt : 0;
    t.stuck = this._stuckT > 1.5;
    this._tipT = t.tilt > 65 && this.v.length() < 1.5 ? this._tipT + dt : 0;
    t.tipped = this._tipT > 1.2;
  }

  toJSON() {
    return { type: this.def.id, p: this.p.toArray(), q: this.q.toArray(), battery_J: this.battery, odometer_m: this.odometer, energyUsed_J: this.energyUsed, headlights: this.headlights };
  }
  fromJSON(s) {
    this.p.fromArray(s.p); this.q.fromArray(s.q).normalize();
    this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    this.battery = Math.max(0, Math.min(this.capacity, s.battery_J ?? this.capacity));
    this.odometer = s.odometer_m || 0; this.energyUsed = s.energyUsed_J || 0;
    this.headlights = !!s.headlights;
    this.flat = this.battery <= 0;
    // The ground may have changed under an old save (a different detail provider): never start buried.
    const floor = this.surface.contact(this.p.x, this.p.z) + this.rideHeight * 0.6;
    if (!(this.p.y > floor)) this.p.y = floor + 0.3;
  }
}
