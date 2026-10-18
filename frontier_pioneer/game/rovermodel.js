/**
 * What the rover looks like, behind one interface so the picture can change
 * without the physics noticing:
 *
 *   const model = await loadRoverModel(def, "assets/models/")
 *   model.group                      add to the scene
 *   model.source                     "glb:<file>" or "primitive"
 *   model.sync(vehicle)              pose the body, wheels, steering, suspension
 *   model.setHeadlights(on)
 *
 * If assets/models/catalog.json lists an entry whose id is def.model, its GLB
 * is used: scaled by entry.scale, turned so the model's forward (glTF's +Z
 * unless entry.forward says otherwise) is the body's -Z, and stood so its
 * wheel centres are where the physics has them. Wheel nodes named in
 * entry.wheels (wheel_fl, wheel_fr, wheel_ml, wheel_mr, wheel_rl, wheel_rr)
 * are spun, steered and moved with the suspension; the physics takes its
 * wheel track, wheelbase and radius FROM the model so the two agree.
 * Otherwise the rover is built from primitives with the same interface.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export async function loadRoverModel(def, vehicle, base = "assets/models/") {
  try {
    const r = await fetch(base + "catalog.json", { cache: "no-cache" });
    if (r.ok) {
      const cat = await r.json();
      const list = Array.isArray(cat) ? cat : (cat.items || cat.models || cat.entries || []);
      const entry = list.find((e) => e.id === def.model);
      if (entry) return await fromGLB(def, vehicle, entry, base, cat);
    }
  } catch (e) {
    console.warn("[rover] asset kit not used, falling back to primitives:", e.message);
  }
  return fromPrimitives(def, vehicle);
}

async function fromGLB(def, vehicle, entry, base, cat) {
  const { GLTFLoader } = await import("../vendor/GLTFLoader.js?v=6d37c9c-9b39e129");
  const gltf = await new GLTFLoader().loadAsync(base + entry.file);
  const group = new THREE.Group();
  group.name = "rover";
  const root = new THREE.Group();                 // model space -> body frame
  root.add(gltf.scene);
  const s = entry.scale ?? 1;
  root.scale.setScalar(s);
  const fwd = String(entry.forward || cat.forward || "+z").toLowerCase();
  root.rotation.y = fwd === "+z" ? Math.PI : fwd === "+x" ? Math.PI / 2 : fwd === "-x" ? -Math.PI / 2 : 0;
  group.add(root);
  group.updateMatrixWorld(true);

  // Wheel nodes, by the physics wheel they are nearest to in name.
  const wheels = [];
  const radii = [];
  for (const w of vehicle.wheels) {
    const spec = (entry.wheels || []).find((e) => e.node.toLowerCase().endsWith("_" + w.def.name));
    const node = spec && gltf.scene.getObjectByName(spec.node);
    if (!node) { wheels.push(null); continue; }
    const c = node.getWorldPosition(new THREE.Vector3());            // body frame, before the vertical fit
    wheels.push({ node, centre: c, restPos: node.position.clone(), restQuat: node.quaternion.clone() });
    radii.push((spec.radius ?? def.wheelRadius) * s);
  }
  const found = wheels.filter(Boolean);
  if (found.length === vehicle.wheels.length) {
    // The physics adopts the model's wheel layout and radius.
    const radius = radii.reduce((a, b) => a + b, 0) / radii.length;
    def.wheelRadius = radius;
    const meanY = found.reduce((a, w) => a + w.centre.y, 0) / found.length;
    vehicle.rideHeight = -vehicle.wheels[0].attach.y + vehicle.rest + radius;
    const lift = -(vehicle.rideHeight - radius) - meanY;             // wheel centres at rest, in the body frame
    root.position.y = lift;
    vehicle.wheels.forEach((w, i) => { w.attach.x = wheels[i].centre.x; w.attach.z = wheels[i].centre.z; });
  } else if (entry.bounds) {
    root.position.y = -vehicle.rideHeight;                            // model origin assumed on the ground
  }
  group.updateMatrixWorld(true);
  for (const w of found) {
    const parentInv = new THREE.Matrix4().copy(w.node.parent.matrixWorld).invert();
    w.upLocal = Y.clone().transformDirection(parentInv);              // body up, in the node's parent space
    w.scaleLocal = 1 / new THREE.Vector3().setFromMatrixScale(w.node.parent.matrixWorld).y;
    const worldQ = w.node.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(w.restQuat);
    const inv = worldQ.clone().invert();
    w.axleLocal = X.clone().applyQuaternion(inv);                     // body right, in the node's own space
    w.steerLocal = Y.clone().applyQuaternion(inv);
  }
  gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const lamps = addLamps(group, def);
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  return {
    group, source: "glb:" + entry.file, license: entry.license || "", lamps,
    // for game/progress.js (paint, bolt-on parts, wheel sets): the model's own space (+Z forward, origin on the ground) and its wheel nodes
    scene: gltf.scene, wheelNodes: wheels.map((w) => (w ? w.node : null)), radius: def.wheelRadius / s, design: def.id,
    sync(v) {
      group.position.copy(v.p); group.quaternion.copy(v.q);
      v.wheels.forEach((pw, i) => {
        const w = wheels[i];
        if (!w) return;
        const dy = (v.rest - pw.len) * w.scaleLocal;
        w.node.position.copy(w.restPos).addScaledVector(w.upLocal, dy);
        q1.setFromAxisAngle(w.steerLocal, -pw.steer);
        q2.setFromAxisAngle(w.axleLocal, -pw.spin);
        w.node.quaternion.copy(w.restQuat).multiply(q1).multiply(q2);
      });
    },
    setHeadlights(on) { for (const l of lamps) l.material.emissiveIntensity = on ? 6 : 0.0; },
  };
}

function addLamps(group, def) {
  const lamps = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d0, emissiveIntensity: 0 });
  for (const sx of [-0.75, 0.75]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(sx, def.lamp.pos[1] - 0.25, def.lamp.pos[2] + 0.02);
    m.name = "lamp";
    lamps.push(m);
  }
  return lamps;
}

function fromPrimitives(def, vehicle) {
  const group = new THREE.Group();
  group.name = "rover";
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.15 }, o));
  const hull = M(0xd9d4c8), dark = M(0x26262b, { roughness: 0.5, metalness: 0.4 }), glass = M(0x0b1118, { roughness: 0.12, metalness: 0.8 });
  const panel = M(0x152a55, { roughness: 0.3, metalness: 0.6 }), accent = M(0xd8662a), tyre = M(0x8a8d93, { roughness: 0.55, metalness: 0.75 });
  const add = (geo, mat, x, y, z, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const b = def.box;
  // chassis deck, pressurised cabin, nose
  add(new THREE.BoxGeometry(b.width * 0.82, 0.34, b.length * 0.96), dark, 0, -0.42, 0);
  const cabin = add(new THREE.CapsuleGeometry(0.95, b.length * 0.50, 6, 14), hull, 0, 0.48, 0.25);
  cabin.rotation.x = Math.PI / 2; cabin.scale.set(1.18, 1, 0.92);
  add(new THREE.BoxGeometry(1.75, 0.62, 0.9), glass, 0, 0.72, -b.length * 0.33 - 0.3).rotation.x = -0.28;   // windscreen
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.5, 1.5), glass, sx * 1.09, 0.72, -0.5);        // side windows
  add(new THREE.BoxGeometry(b.width * 0.86, 0.1, 0.5), accent, 0, -0.2, -b.length * 0.48);                   // front bumper
  add(new THREE.BoxGeometry(1.5, 0.8, 0.9), hull, 0, 0.25, b.length * 0.44);                                 // aft equipment bay
  // solar array: roof and two wings
  add(new THREE.BoxGeometry(2.2, 0.05, 3.3), panel, 0, 1.47, 0.35);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(1.5, 0.04, 2.9), panel, sx * 1.9, 1.40, 0.35).rotation.z = -sx * 0.10;
  // mast and camera head
  add(new THREE.CylinderGeometry(0.05, 0.06, 1.25, 10), dark, 0, 1.45, -0.9);
  add(new THREE.BoxGeometry(0.42, 0.2, 0.22), hull, 0, 2.1, -0.9);
  add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), dark, 0.8, 1.6, 1.7);                                   // whip antenna
  const dish = add(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, 1.1), hull, -0.7, 1.72, 1.6); dish.rotation.x = Math.PI * 0.9;
  // wheels: a pivot at the attach point's x/z, moved along body-Y by the suspension
  const tread = new THREE.CylinderGeometry(def.wheelRadius, def.wheelRadius, def.wheelWidth, 22, 1);
  tread.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(def.wheelRadius * 0.45, def.wheelRadius * 0.45, def.wheelWidth * 1.06, 12);
  hub.rotateZ(Math.PI / 2);
  const cleat = new THREE.BoxGeometry(def.wheelWidth * 1.02, 0.05, 0.07);
  const wheels = vehicle.wheels.map((pw) => {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.set(pw.attach.x, 0, pw.attach.z);
    pivot.add(spin);
    spin.add(new THREE.Mesh(tread, tyre)); spin.add(new THREE.Mesh(hub, dark));
    for (let k = 0; k < 12; k++) {
      const c = new THREE.Mesh(cleat, dark), a = k / 12 * Math.PI * 2;
      c.position.set(0, Math.cos(a) * def.wheelRadius, Math.sin(a) * def.wheelRadius);
      c.rotation.x = a;
      spin.add(c);
    }
    group.add(pivot);
    // strut from the chassis to the wheel
    const strut = add(new THREE.BoxGeometry(0.09, 0.09, 1), dark, 0, 0, 0);
    return { pivot, spin, strut, inner: new THREE.Vector3(Math.sign(pw.attach.x) * b.width * 0.36, -0.35, pw.attach.z * 0.55) };
  });
  const lamps = addLamps(group, def);
  for (const l of lamps) group.add(l);
  const tmp = new THREE.Vector3();
  return {
    group, source: "primitive", license: "generated in code", lamps, scene: null, wheelNodes: [], design: def.id,      // (progress.js dresses only a kit model)
    sync(v) {
      group.position.copy(v.p); group.quaternion.copy(v.q);
      v.wheels.forEach((pw, i) => {
        const w = wheels[i];
        w.pivot.position.y = pw.attach.y - pw.len;
        w.pivot.rotation.y = -pw.steer;
        w.spin.rotation.x = -pw.spin;
        tmp.copy(w.pivot.position).sub(w.inner);
        w.strut.position.copy(w.inner).addScaledVector(tmp, 0.5);
        w.strut.scale.z = tmp.length();
        w.strut.lookAt(group.localToWorld(w.pivot.position.clone()));
      });
    },
    setHeadlights(on) { for (const l of lamps) l.material.emissiveIntensity = on ? 6 : 0.0; },
  };
}
