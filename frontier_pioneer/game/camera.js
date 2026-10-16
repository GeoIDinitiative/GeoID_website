/**
 * Two cameras on one rig: a third-person chase camera that orbits the rover,
 * and a mast camera that looks out from it.
 *
 * The chase camera follows the rover's heading with a lag, can be swung
 * around with the right stick or a mouse drag, and eases back behind the
 * rover a couple of seconds after the last look input while it is moving. It
 * never goes below the ground.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";

const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ");
const _fw = new THREE.Vector3();

export class Rig {
  constructor(camera, def) {
    this.camera = camera; this.def = def;
    this.mode = "chase";
    this.yaw = 0; this.pitch = 0.24;          // orbit offsets (chase), look offsets (mast)
    this.followYaw = null;
    this.distance = def.cameras.chase.distance;
    this.idle = 0;
    this.invertY = false;
  }
  toggle() { this.mode = this.mode === "chase" ? "mast" : "chase"; this.recentre(); return this.mode; }
  recentre() { this.yaw = 0; this.pitch = this.mode === "chase" ? 0.24 : 0; this.idle = 99; }
  zoom(k) { this.distance = Math.max(5, Math.min(40, this.distance * k)); }

  /** look: {x, y} rate in -1..1 (stick) ; drag: {x, y} radians already (mouse) */
  update(dt, vehicle, surface, look, drag) {
    const inv = this.invertY ? -1 : 1;
    const lx = look.x * 2.2 * dt + drag.x, ly = (look.y * 1.5 * dt + drag.y) * inv;
    if (lx !== 0 || ly !== 0) this.idle = 0; else this.idle += dt;
    this.yaw += lx;
    this.pitch += ly;
    _fw.set(0, 0, -1).applyQuaternion(vehicle.q);
    const heading = Math.atan2(_fw.x, -_fw.z);
    if (this.mode === "chase") {
      this.pitch = Math.max(-0.12, Math.min(1.25, this.pitch));
      if (this.idle > 2.5 && Math.abs(vehicle.t.speed) > 0.8) {
        const k = Math.min(1, dt * 1.6);
        this.yaw -= Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw)) * k;
        this.pitch += (0.24 - this.pitch) * k;
      }
      if (this.followYaw === null) this.followYaw = heading;
      const dy = Math.atan2(Math.sin(heading - this.followYaw), Math.cos(heading - this.followYaw));
      this.followYaw += dy * Math.min(1, dt * 3.2);
      const a = this.followYaw + this.yaw;
      _t.copy(vehicle.p); _t.y += 1.1;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      // behind the rover: opposite its forward (sin a, 0, -cos a)
      _d.set(-Math.sin(a) * cp, sp, Math.cos(a) * cp);
      const cam = this.camera.position;
      cam.copy(_t).addScaledVector(_d, this.distance);
      const floor = surface.height(cam.x, cam.z) + 0.7;
      if (cam.y < floor) cam.y = floor;
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(_t);
    } else {
      this.yaw = Math.max(-2.6, Math.min(2.6, this.yaw));
      this.pitch = Math.max(-0.9, Math.min(0.9, this.pitch));
      const m = this.def.cameras.mast.pos;
      this.camera.position.set(m[0], m[1], m[2]).applyQuaternion(vehicle.q).add(vehicle.p);
      _e.set(-this.pitch, -this.yaw, 0);
      this.camera.quaternion.copy(vehicle.q).multiply(_q.setFromEuler(_e));
      this.followYaw = heading;
    }
  }
}
