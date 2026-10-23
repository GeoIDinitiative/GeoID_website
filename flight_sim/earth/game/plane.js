/**
 * The aircraft: a light single-engine model built from primitives, an
 * arcade flight model with coordinated turns, and the cameras.
 *
 * Not a flight dynamics model. Speed follows the throttle, the nose goes
 * where the stick points, and bank turns the aircraft at the rate a real one
 * would (ω = g·tan φ / v), which is the one piece of physics that makes
 * flying around a city feel right. The ground cannot be flown into: the
 * aircraft is held three metres above the finest terrain chunk under it.
 */

import * as THREE from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";

const G = 9.81;
export const SPEED = { min: 25, cruise: 70, max: 260, boost: 1400 };

function buildModel() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0 });
  const stripe = new THREE.MeshLambertMaterial({ color: 0xb8322a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a3138 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x5a7690 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  };
  // Nose toward -Z, like a three.js camera, so the camera can share axes.
  add(new THREE.CylinderGeometry(0.62, 0.42, 4.2, 14), white, 0, 0, -0.6, Math.PI / 2);   // cabin
  add(new THREE.CylinderGeometry(0.42, 0.14, 3.6, 12), white, 0, 0.12, 3.2, Math.PI / 2); // tail cone
  add(new THREE.ConeGeometry(0.55, 1.0, 14), dark, 0, 0, -3.15, -Math.PI / 2);            // cowling
  add(new THREE.BoxGeometry(0.9, 0.5, 1.6), glass, 0, 0.55, -1.0);                         // canopy
  add(new THREE.BoxGeometry(10.8, 0.14, 1.5), white, 0, 0.42, -0.6);                        // wing
  add(new THREE.BoxGeometry(10.82, 0.15, 0.25), stripe, 0, 0.42, -0.05);                    // wing stripe
  add(new THREE.BoxGeometry(3.6, 0.1, 0.9), white, 0, 0.25, 4.6);                           // stabiliser
  add(new THREE.BoxGeometry(0.1, 1.5, 1.1), stripe, 0, 0.95, 4.7);                          // fin
  const prop = add(new THREE.BoxGeometry(2.0, 0.14, 0.05), dark, 0, 0, -3.72);
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), dark, -1.1, -0.85, -0.9);             // gear
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), dark, 1.1, -0.85, -0.9);
  g.userData.prop = prop;
  return g;
}

export class Plane {
  constructor(scene) {
    this.model = buildModel();
    scene.add(this.model);
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.speed = SPEED.cruise;
    this.throttle = 0.25;
    this.paused = false;
    this.agl = 0;
    this.camMode = "chase";
    this.orbit = { yaw: 0, pitch: 0, dist: 26 };
    this.keys = new Set();
    this._camPos = new THREE.Vector3();
    this._camInit = false;
  }

  /** Heading in degrees clockwise from north; pitch degrees, nose up positive. */
  setPose(x, y, z, heading, pitch = 0) {
    this.pos.set(x, y, z);
    const e = new THREE.Euler(pitch * Math.PI / 180, -heading * Math.PI / 180, 0, "YXZ");
    this.q.setFromEuler(e);
    this._camInit = false;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.q); }

  get heading() {
    const f = this.forward();
    return (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
  }
  get pitch() { return Math.asin(THREE.MathUtils.clamp(this.forward().y, -1, 1)) * 180 / Math.PI; }
  get bank() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    return Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1)) * 180 / Math.PI;
  }

  update(dt, groundAt) {
    const k = this.keys;
    if (!this.paused) {
      if (k.has("KeyW")) this.throttle = Math.min(1, this.throttle + dt * 0.5);
      if (k.has("KeyS")) this.throttle = Math.max(0, this.throttle - dt * 0.5);
      const boost = k.has("ShiftLeft") || k.has("ShiftRight");
      const brake = k.has("Space");
      let target = SPEED.min + this.throttle * (SPEED.max - SPEED.min);
      if (boost) target = SPEED.boost;
      if (brake) target = SPEED.min;
      // Climbing costs speed and diving gains it, but only a little: enough to
      // feel, not enough to stall the arcade model.
      const f = this.forward();
      this.speed += (target - this.speed) * Math.min(1, dt * (boost ? 0.6 : 0.8)) - G * f.y * dt * 0.4;
      this.speed = THREE.MathUtils.clamp(this.speed, SPEED.min * 0.8, SPEED.boost);

      const pitchIn = (k.has("ArrowDown") ? 1 : 0) - (k.has("ArrowUp") ? 1 : 0);
      const rollIn = (k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0);
      const yawIn = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
      const rot = new THREE.Quaternion();
      rot.setFromEuler(new THREE.Euler(pitchIn * 0.9 * dt, yawIn * 0.45 * dt, rollIn * 1.8 * dt, "YXZ"));
      this.q.multiply(rot);

      // Coordinated turn: bank yaws the aircraft about world-up.
      const bank = this.bank * Math.PI / 180;
      const omega = G * Math.tan(THREE.MathUtils.clamp(bank, -1.2, 1.2)) / Math.max(this.speed, 30);
      this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -omega * dt));
      // With no roll input the wings drift back to level, slowly, like a stable trainer.
      if (!rollIn) {
        const back = THREE.MathUtils.clamp(-bank, -1, 1) * dt * 0.35;
        this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -back));
      }
      this.q.normalize();

      this.pos.addScaledVector(this.forward(), this.speed * dt);
      this.model.userData.prop.rotation.z += dt * (30 + this.throttle * 60);
    }
    const ground = groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 3) {
      this.pos.y = ground + 3;
      // Scraping the ground lifts the nose rather than ending the flight.
      if (this.forward().y < 0) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8 * dt));
    }
    this.agl = this.pos.y - ground;
    this.model.position.copy(this.pos);
    this.model.quaternion.copy(this.q);
  }

  /** Place the camera: chase (smoothed, orbitable with the mouse) or cockpit. */
  updateCamera(camera, dt) {
    if (this.camMode === "cockpit") {
      this.model.visible = false;
      camera.position.copy(this.pos).add(new THREE.Vector3(0, 0.75, -0.8).applyQuaternion(this.q));
      camera.quaternion.copy(this.q);
      return;
    }
    this.model.visible = true;
    const f = this.forward();
    const flat = new THREE.Vector3(f.x, 0, f.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    const yaw = this.orbit.yaw, pitch = 0.16 + this.orbit.pitch;
    const back = flat.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const want = this.pos.clone()
      .addScaledVector(back, this.orbit.dist * Math.cos(pitch))
      .add(new THREE.Vector3(0, this.orbit.dist * Math.sin(pitch) + 2, 0));
    if (!this._camInit) { this._camPos.copy(want); this._camInit = true; }
    this._camPos.lerp(want, 1 - Math.exp(-dt * 6));
    camera.position.copy(this._camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.pos.clone().addScaledVector(f, 8).add(new THREE.Vector3(0, 1.5, 0)));
  }
}
