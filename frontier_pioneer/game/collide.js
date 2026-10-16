/**
 * Rover against base modules: footprint boxes and circles, nothing more.
 *
 * A module is one oriented box on the ground (the catalogue's bounding box,
 * not the whole 4 m cell, so the rover can pass between a tank and its
 * neighbour); the garage is its three walls, so the rover drives in through the
 * door. The rover is three circles along its hull.
 * Pure arithmetic (no three.js): the base system builds the obstacle list
 * when a base changes and calls `resolve` once a frame after the vehicle has
 * stepped. The correction is positional and inelastic: the rover is moved out
 * along the contact normal and loses the part of its velocity that points
 * into the wall. Nothing here touches the wheels or the suspension, so the
 * vehicle feels exactly as it did everywhere else.
 */
import { KIT, MODULES, rot, toWorld } from "./basenet.js?v=b8cfe8e-efa5b7b7";

/** Local boxes [x0, z0, x1, z1] in the module's own frame. */
function localBoxes(type) {
  const K = KIT[type], B = MODULES[type];
  if (!K || !B || B.solid === false) return [];
  const a = K.aabb, x0 = a.min[0], x1 = a.max[0], z0 = a.min[2], z1 = a.max[2];
  if (B.garage) {
    const w = 0.55;                     // wall thickness; the whole north side is the door
    return [[x0, z0, x0 + w, z1], [x1 - w, z0, x1, z1], [x0, z0, x1, z0 + w]];
  }
  return [[x0, z0, x1, z1]];
}

/** World obstacles for one module: [{x, z, hx, hz, c, s, id, type}] (centre, half extents, frame axis). */
export function obstaclesOf(m, base, out = []) {
  if (m.level > 0) return out;
  for (const [x0, z0, x1, z1] of localBoxes(m.type)) {
    const [cx, cz] = rot(m.r, (x0 + x1) / 2, (z0 + z1) / 2);
    const w = toWorld(base, m.lx + cx, m.lz + cz), odd = m.r & 1;
    out.push({ x: w.x, z: w.z, hx: (odd ? z1 - z0 : x1 - x0) / 2, hz: (odd ? x1 - x0 : z1 - z0) / 2, c: Math.cos(base.yaw), s: Math.sin(base.yaw), id: m.id, type: m.type });
  }
  return out;
}

/** Push a circle out of a box. Returns the depth (0 if clear) and writes the world normal into n. */
export function circleBox(px, pz, r, o, n) {
  const dx = px - o.x, dz = pz - o.z;
  const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;            // into the box frame
  const qx = Math.max(-o.hx, Math.min(o.hx, lx)), qz = Math.max(-o.hz, Math.min(o.hz, lz));
  let nx = lx - qx, nz = lz - qz, d = Math.hypot(nx, nz), depth;
  if (d > 1e-6) { if (d >= r) return 0; nx /= d; nz /= d; depth = r - d; }
  else {                                                              // centre inside: out through the nearest face
    const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
    if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; depth = ex + r; } else { nx = 0; nz = Math.sign(lz) || 1; depth = ez + r; }
  }
  n.x = nx * o.c + nz * o.s; n.z = -nx * o.s + nz * o.c;
  return depth;
}

/** Does a circle touch any obstacle? */
export function hits(px, pz, r, obstacles) {
  const n = { x: 0, z: 0 };
  for (const o of obstacles) if (Math.abs(px - o.x) < o.hx + o.hz + r && Math.abs(pz - o.z) < o.hx + o.hz + r && circleBox(px, pz, r, o, n) > 0) return o;
  return null;
}

/**
 * Keep a vehicle out of the obstacles. `circles` are [{x, z, r}] in the world
 * (the caller derives them from the hull). Moves p, trims v; returns the
 * obstacle touched, or null.
 */
export function resolve(p, v, circles, obstacles) {
  const n = { x: 0, z: 0 };
  let touched = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of circles) {
      for (const o of obstacles) {
        const reach = o.hx + o.hz + c.r;
        if (Math.abs(c.x - o.x) > reach || Math.abs(c.z - o.z) > reach) continue;
        const depth = circleBox(c.x, c.z, c.r, o, n);
        if (depth <= 0) continue;
        touched = o;
        p.x += n.x * depth; p.z += n.z * depth;
        for (const k of circles) { k.x += n.x * depth; k.z += n.z * depth; }
        const vn = v.x * n.x + v.z * n.z;
        if (vn < 0) { v.x -= n.x * vn; v.z -= n.z * vn; v.x *= 0.96; v.z *= 0.96; }
      }
    }
  }
  return touched;
}
