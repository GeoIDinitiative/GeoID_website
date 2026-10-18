/**
 * The base's picture: the asset kit turned into a few draw calls.
 *
 * A GLB module is 6 to 18 meshes (one per named material per node). Thirty of
 * them drawn as they load would be about 300 draw calls, twice the whole
 * frame budget. So nothing from a GLB is ever added to the scene as it is:
 *
 *   Kit.proto(type)       the module's geometry sorted into STATIC (body),
 *                         HATCHES (one per pressurised port, dropped where two
 *                         modules join) and DYNAMIC nodes (solar panel, garage
 *                         door, airlock outer door), by material NAME, plus one
 *                         merged "silhouette" for ghosts, outlines and scaffolds
 *   BaseBatch             every built module of one base merged into ONE mesh
 *                         per material name (the kit promises the same name is
 *                         the same look in every file), with the legs that
 *                         level it, a contact shadow and the night light pools
 *                         draped on the ground
 *   Dynamics              the moving nodes of every base, instanced per
 *                         (type, node, material)
 *   LightPool             a fixed set of point lights, handed to the lamps
 *                         nearest the camera (a fixed count, so no shader is
 *                         ever recompiled because a module was built)
 *
 * A thirty-module base is therefore about 15 + 10 draw calls however it is
 * laid out. The terrain has its own shader and does not see three's lights,
 * which is why the lamps also get an additive pool draped on the ground.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { KIT, MODULES, defineKit, halfExtent, rot, toWorld } from "./basenet.js?v=6d37c9c-9b39e129";

const DYNAMIC_NODES = new Set(["panel", "door", "door_outer"]);
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n3 = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

/** Where each lit module hangs its lamp, module frame: [x, y, z]. */
const LAMPS = {
  hab_small: [[0, 2.7, 2.9]], hab_large: [[-2, 2.8, 2.9], [2, 2.8, -2.9]], hab_hdu: [[0, 4, 7]], node_hub: [[2.6, 2.8, 2.6]], airlock: [[0, 2.9, 3.2]],
  greenhouse: [[2.6, 2.4, 0]], garage: [[0, 3.6, 5.2]], landing_pad: [[5.2, 1.2, 5.2], [-5.2, 1.2, -5.2]], light_mast: [[0, 5.3, 1.6]],
};
export const lampsOf = (type) => LAMPS[type] || [];

/** Merge [{g, m}] (geometry, matrix) into one indexed geometry with positions and normals. */
export function mergeGeometry(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const P = p.g.attributes.position, N = p.g.attributes.normal, I = p.g.index;
    if (p.m) _n3.getNormalMatrix(p.m);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); if (p.m) _v.applyMatrix4(p.m);
      pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      if (N) { _v.fromBufferAttribute(N, i); if (p.m) _v.applyMatrix3(_n3).normalize(); } else _v.set(0, 1, 0);
      nor[(vo + i) * 3] = _v.x; nor[(vo + i) * 3 + 1] = _v.y; nor[(vo + i) * 3 + 2] = _v.z;
    }
    if (I) for (let k = 0; k < I.count; k++) idx[io++] = I.getX(k) + vo; else for (let k = 0; k < P.count; k++) idx[io++] = k + vo;
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

export class Kit {
  constructor(assets) {
    this.assets = assets;
    this.protos = new Map();
    this.materials = new Map();
    this.thumbs = new Map();
    this.ready = false;
  }
  async init() {
    defineKit(await this.assets.entries());
    this.ready = true;
    return this;
  }
  material(src) {
    const name = (src && src.name) || "hull";
    if (!this.materials.has(name)) {
      const m = src.clone();
      m.name = name;
      // no environment map here: a metallic surface under a Sun and a dusty sky renders black
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.3);
      this.materials.set(name, m);
    }
    return this.materials.get(name);
  }
  /** The module's geometry, loaded once: see the header. */
  proto(type) {
    if (!this.protos.has(type)) this.protos.set(type, this._load(type).then((p) => { this.protos.set(type, p); return p; }));
    return Promise.resolve(this.protos.get(type));
  }
  async _load(type) {
    const scene = await this.assets.load(type);
    if (!scene) throw new Error("the asset kit has no " + type);
    scene.updateMatrixWorld(true);
    const root = scene.children.length === 1 && !scene.children[0].isMesh ? scene.children[0] : scene;
    const P = { type, static: new Map(), hatches: new Map(), dynamic: new Map(), silhouette: null, triangles: 0 };
    const all = [];
    const push = (map, name, g, m) => { if (!map.has(name)) map.set(name, []); map.get(name).push({ g, m }); };
    scene.traverse((o) => {
      if (!o.isMesh) return;
      let top = o;
      while (top.parent && top.parent !== root) top = top.parent;
      const mat = this.material(o.material).name, world = o.matrixWorld.clone();
      all.push({ g: o.geometry, m: world });
      P.triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      if (/^hatch_/.test(top.name)) { const port = top.name.replace("hatch_", "port_"); if (!P.hatches.has(port)) P.hatches.set(port, new Map()); push(P.hatches.get(port), mat, o.geometry, world); }
      else if (DYNAMIC_NODES.has(top.name)) {
        if (!P.dynamic.has(top.name)) P.dynamic.set(top.name, { rest: top.matrixWorld.clone(), parts: new Map() });
        push(P.dynamic.get(top.name).parts, mat, o.geometry, new THREE.Matrix4().copy(top.matrixWorld).invert().multiply(world));
      } else push(P.static, mat, o.geometry, world);
    });
    const bake = (map) => { for (const [k, parts] of map) map.set(k, mergeGeometry(parts)); };
    bake(P.static);
    for (const h of P.hatches.values()) bake(h);
    for (const d of P.dynamic.values()) bake(d.parts);
    P.silhouette = mergeGeometry(all);
    return P;
  }
  loaded(type) { const p = this.protos.get(type); return p && !(p instanceof Promise) ? p : null; }
  async preload(types) { for (const t of types) await this.proto(t); }

  /** A lit group of the whole module (thumbnails). */
  async figure(type) {
    const P = await this.proto(type), g = new THREE.Group();
    const add = (map, m) => { for (const [name, geo] of map) { const mesh = new THREE.Mesh(geo, this.materials.get(name)); if (m) mesh.applyMatrix4(m); g.add(mesh); } };
    add(P.static);
    for (const h of P.hatches.values()) add(h);
    for (const d of P.dynamic.values()) add(d.parts, d.rest);
    return g;
  }

  /**
   * A small picture of a module, rendered once with the game's renderer and
   * kept as a data URL. Three-quarter view, the module's own materials.
   */
  async thumbnail(type, renderer, w = 176, h = 124) {
    if (this.thumbs.has(type)) return this.thumbs.get(type);
    const fig = await this.figure(type);
    const scene = new THREE.Scene();
    scene.add(fig, new THREE.HemisphereLight(0xfff0e0, 0x5a3a28, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    const box = new THREE.Box3().setFromObject(fig), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const dir = new THREE.Vector3(0.9, 0.62, 1).normalize(), r = 0.5 * size.length();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    cam.position.copy(c).addScaledVector(dir, 120); cam.lookAt(c); cam.updateMatrixWorld(true);
    // fit: project the box's corners into the camera's frame
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    let ex = 0.1, ey = 0.1;
    for (let k = 0; k < 8; k++) { _v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(inv); ex = Math.max(ex, Math.abs(_v.x)); ey = Math.max(ey, Math.abs(_v.y)); }
    const k = Math.max(ex / (w / h), ey) * 1.08 || r;
    cam.left = -k * w / h; cam.right = k * w / h; cam.top = k; cam.bottom = -k; cam.updateProjectionMatrix();
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha(), prevColor = renderer.getClearColor(new THREE.Color());
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(w * 2 * h * 2 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, px);
    renderer.setRenderTarget(prev); renderer.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    const cv = document.createElement("canvas"); cv.width = w * 2; cv.height = h * 2;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w * 2, h * 2), row = w * 2 * 4;
    for (let y = 0; y < h * 2; y++) img.data.set(px.subarray((h * 2 - 1 - y) * row, (h * 2 - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL("image/png");
    this.thumbs.set(type, url);
    return url;
  }
}

/* ── draped decals ──────────────────────────────────────────────────────── */

/** Append a ground-following patch to {pos, col, idx}. shade(u, v) -> alpha/intensity, u and v in -1..1. Positions are relative to (ox, oz). */
function drape(out, surface, ox, oz, cx, cz, ux, uz, hx, hz, lift, shade) {
  const nx = Math.max(2, Math.min(14, Math.ceil(hx))), nz = Math.max(2, Math.min(14, Math.ceil(hz))), base = out.pos.length / 3;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx * 2 - 1, v = j / nz * 2 - 1, x = cx + ux * u * hx - uz * v * hz, z = cz + uz * u * hx + ux * v * hz, a = shade(u, v);
    out.pos.push(x - ox, surface.height(x, z) + lift, z - oz);
    out.col.push(a, a, a, a);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    out.idx.push(a, c, b, b, c, d);
  }
}
function decalMesh(out, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(out.col, 4));
  g.setIndex(out.idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = 2;
  return m;
}

/* ── one base, merged ───────────────────────────────────────────────────── */

export class BaseBatch {
  constructor(kit, base) {
    this.kit = kit; this.base = base;
    this.group = new THREE.Group(); this.group.name = "base:" + base.id;       // the rigid frame: modules are in base-local coordinates
    this.ground = new THREE.Group(); this.ground.name = "base-ground:" + base.id;   // draped things, in world axes about the base origin
    this.meshes = [];
    this.glow = [];
    this.triangles = 0;
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.5 });
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lamps = [];
  }
  place() {
    const b = this.base;
    this.group.position.set(b.x, b.y, b.z); this.group.rotation.y = b.yaw;
    this.ground.position.set(b.x, 0, b.z);
    this.group.updateMatrixWorld(true);
  }
  /** Rebuild from the built modules. `joined`: Map id -> Set of mated port names. All protos must be loaded. */
  rebuild(mods, joined, surface) {
    for (const m of this.meshes) { m.geometry.dispose(); m.parent && m.parent.remove(m); }
    this.meshes = []; this.glow = []; this.lamps = []; this.triangles = 0;
    this.stats = { modules: mods.length, hatchesDrawn: 0, hatchesHidden: 0, legs: 0, drawCalls: 0 };
    this.drawn = new Set();
    this.place();
    const b = this.base, buckets = new Map();
    const push = (name, g, m) => { if (!buckets.has(name)) buckets.set(name, []); buckets.get(name).push({ g, m }); };
    const shadow = { pos: [], col: [], idx: [] }, pool = { pos: [], col: [], idx: [] };
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    for (const mod of mods) {
      const P = this.kit.loaded(mod.type);
      if (!P) continue;
      const M = new THREE.Matrix4().makeRotationY(mod.r * Math.PI / 2).setPosition(mod.lx, mod.ly || 0, mod.lz);
      this.drawn.add(mod.id);
      for (const [name, g] of P.static) push(name, g, M);
      const mated = joined.get(mod.id) || new Set();
      for (const [port, parts] of P.hatches) {
        if (mated.has(port)) { this.stats.hatchesHidden++; continue; }
        this.stats.hatchesDrawn++;
        for (const [name, g] of parts) push(name, g, M);
      }
      const [hx, hz] = halfExtent(mod.type, mod.r), w = toWorld(b, mod.lx, mod.lz);
      if (!mod.level) {
        // legs: the module is level, the ground is not
        const K = KIT[mod.type], a = K.aabb, inset = 0.45;
        const corners = [[a.min[0] + inset, a.min[2] + inset], [a.max[0] - inset, a.min[2] + inset], [a.min[0] + inset, a.max[2] - inset], [a.max[0] - inset, a.max[2] - inset]];
        if (K.fp[0] * K.fp[1] > 2) corners.push([0, a.min[2] + inset], [0, a.max[2] - inset], [a.min[0] + inset, 0], [a.max[0] - inset, 0]);
        for (const [px, pz] of corners) {
          const [rx, rz] = rot(mod.r, px, pz), wp = toWorld(b, mod.lx + rx, mod.lz + rz), drop = b.y - surface.height(wp.x, wp.z);
          if (drop < 0.12) continue;
          const len = drop + 0.35;
          this.stats.legs++;
          push("trim", BOX, new THREE.Matrix4().makeScale(0.2, len, 0.2).setPosition(mod.lx + rx, 0.1 - len / 2, mod.lz + rz));
          push("metal", BOX, new THREE.Matrix4().makeScale(0.5, 0.08, 0.5).setPosition(mod.lx + rx, -drop + 0.04, mod.lz + rz));
        }
        if (MODULES[mod.type].solid !== false) drape(shadow, surface, b.x, b.z, w.x, w.z, c, -s, hx + 1.3, hz + 1.3, 0.07, (u, v) => {
          const e = Math.max(Math.abs(u) * (hx + 1.3) - hx + 0.9, Math.abs(v) * (hz + 1.3) - hz + 0.9, 0) / 2.2;
          return 0.9 * (1 - Math.min(1, e)) ** 2;
        });
      }
      if (MODULES[mod.type].lit) for (const [px, py, pz] of lampsOf(mod.type)) {
        const [rx, rz] = rot(mod.r, px, pz), wp = toWorld(b, mod.lx + rx, mod.lz + rz);
        this.lamps.push({ x: wp.x, y: (mod.ly || 0) + py, z: wp.z, id: mod.id, mast: !!MODULES[mod.type].mast });
        const R = MODULES[mod.type].mast ? 13 : 7.5;
        if (!mod.level) drape(pool, surface, b.x, b.z, wp.x, wp.z, 1, 0, R, R, 0.09, (u, v) => { const d = Math.min(1, Math.hypot(u, v)); return (1 - d) ** 2 * (MODULES[mod.type].mast ? 1 : 0.7); });
      }
    }
    for (const [name, parts] of buckets) {
      let mat = this.kit.materials.get(name);
      if (/^glow/.test(name)) { mat = mat.clone(); mat.userData.base = mat.emissive.clone(); this.glow.push(mat); }
      const mesh = new THREE.Mesh(mergeGeometry(parts), mat);
      mesh.name = "base-" + name;
      this.triangles += mesh.geometry.index.count / 3;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    if (shadow.idx.length) { const m = decalMesh(shadow, this.shadowMat); this.ground.add(m); this.meshes.push(m); }
    if (pool.idx.length) { const m = decalMesh(pool, this.poolMat); m.name = "pools"; this.pools = m; this.ground.add(m); this.meshes.push(m); } else this.pools = null;
    this.stats.drawCalls = this.meshes.length; this.stats.triangles = this.triangles;
  }
  /** night 0..1, powered: the base's lights are on. */
  light(night, powered) {
    const k = powered ? 1 : 0;
    for (const m of this.glow) { m.emissive.copy(m.userData.base).multiplyScalar(k * (0.6 + 1.6 * night)); }
    if (this.pools) { this.pools.visible = k * night > 0.02; this.poolMat.color.setRGB(0.20 * night * k, 0.15 * night * k, 0.085 * night * k); }
  }
  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.parent && m.parent.remove(m); }
    this.group.parent && this.group.parent.remove(this.group);
    this.ground.parent && this.ground.parent.remove(this.ground);
  }
}

/* ── moving nodes, instanced across every base ──────────────────────────── */

export class Dynamics {
  constructor(kit, cap = 64) {
    this.kit = kit; this.cap = cap;
    this.group = new THREE.Group(); this.group.name = "base-dynamic";
    this.sets = new Map();          // "type|node" -> [InstancedMesh per material]
  }
  _set(type, node) {
    const key = type + "|" + node;
    if (!this.sets.has(key)) {
      const P = this.kit.loaded(type), d = P && P.dynamic.get(node);
      if (!d) return null;
      const meshes = [];
      for (const [name, g] of d.parts) {
        const im = new THREE.InstancedMesh(g, this.kit.materials.get(name), this.cap);
        im.name = "dyn:" + key + ":" + name; im.frustumCulled = false; im.count = 0;
        this.group.add(im); meshes.push(im);
      }
      this.sets.set(key, { meshes, rest: d.rest, n: 0 });
    }
    return this.sets.get(key);
  }
  begin() { for (const s of this.sets.values()) s.n = 0; }
  /** frame = the base group's world matrix; mod = the module; anim = a matrix applied to the node (module frame, before `rest`) or after it (`local`). */
  add(type, node, frame, mod, pre, post) {
    const s = this._set(type, node);
    if (!s || s.n >= this.cap) return;
    _m.makeRotationY(mod.r * Math.PI / 2).setPosition(mod.lx, mod.ly || 0, mod.lz).premultiply(frame);
    if (pre) _m.multiply(pre);
    _m.multiply(s.rest);
    if (post) _m.multiply(post);
    for (const im of s.meshes) im.setMatrixAt(s.n, _m);
    s.n++;
  }
  end() { for (const s of this.sets.values()) for (const im of s.meshes) { im.count = s.n; im.visible = s.n > 0; im.instanceMatrix.needsUpdate = true; } }
  get triangles() { let t = 0; for (const s of this.sets.values()) for (const im of s.meshes) t += im.count * im.geometry.index.count / 3; return t; }
}

/* ── real lights, a fixed number of them ────────────────────────────────── */

export class LightPool {
  constructor(n = 4) {
    this.group = new THREE.Group(); this.group.name = "base-lights";
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 34, 2);
      l.position.set(0, -1000, 0);
      this.group.add(l); this.lights.push(l);
    }
  }
  /** lamps: [{x, y, z, on, mast}] world; the nearest few to `eye` get a light. */
  assign(lamps, eye, night) {
    const lit = night > 0.02 ? lamps.filter((l) => l.on) : [];
    for (const l of lit) l.d = (l.x - eye.x) ** 2 + (l.z - eye.z) ** 2;
    lit.sort((a, b) => a.d - b.d);
    this.lights.forEach((L, i) => {
      const l = lit[i];
      if (!l) { L.intensity = 0; return; }
      L.position.set(l.x, l.y, l.z);
      L.intensity = (l.mast ? 26 : 13) * night;
    });
  }
}

/* ── ghosts, scaffolds, outlines, the grid ──────────────────────────────── */

export const GHOST_COLOURS = { ok: 0x58e08f, warn: 0xffc24a, bad: 0xff5148 };

export class Ghost {
  constructor(kit) {
    this.kit = kit;
    this.group = new THREE.Group(); this.group.name = "build-ghost"; this.group.visible = false;
    this.material = new THREE.MeshLambertMaterial({ color: GHOST_COLOURS.ok, emissive: GHOST_COLOURS.ok, emissiveIntensity: 0.45, transparent: true, opacity: 0.62 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 5;
    // the footprint: a plate of the cells it will own
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GHOST_COLOURS.ok, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.plate.renderOrder = 4;
    this.edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: GHOST_COLOURS.ok, transparent: true, opacity: 0.9 }));
    this.edge.renderOrder = 6;
    // rings where ports will join
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.95, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffffff }), 8);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 7;
    this.group.add(this.mesh, this.plate, this.edge);
    this.type = null;
  }
  setType(type) {
    if (type === this.type) return;
    this.type = type;
    const P = this.kit.loaded(type);
    if (P) this.mesh.geometry = P.silhouette;
    this.mesh.visible = !!P;
    if (!P) this.kit.proto(type).then((p) => { this.kit.protos.set(type, p); if (this.type === type) { this.mesh.geometry = p.silhouette; this.mesh.visible = true; } });
  }
  setState(state) {
    const c = GHOST_COLOURS[state] || GHOST_COLOURS.bad;
    this.material.color.set(c); this.material.emissive.set(c); this.plate.material.color.set(c); this.edge.material.color.set(c);
  }
  /** world pose of the module origin; hx / hz half extents in the ghost's own (rotated) frame. */
  pose(x, y, z, yaw, hx, hz, height) {
    this.group.position.set(x, y, z); this.group.rotation.y = yaw;
    this.plate.scale.set(hx * 2, 1, hz * 2); this.plate.position.set(0, 0.03, 0);
    this.edge.scale.set(hx * 2, height, hz * 2); this.edge.position.set(0, height / 2, 0);
  }
  /** rings at joints: [{x, y, z, dx, dz, type}] world */
  joints(list) {
    const n = Math.min(list.length, 8);
    for (let i = 0; i < n; i++) {
      const j = list[i];
      _q.setFromAxisAngle(_Y, Math.atan2(j.dx, j.dz));
      _m.compose(_p.set(j.x, j.y, j.z), _q, _s.set(1, 1, 1));
      this.rings.setMatrixAt(i, _m);
      this.rings.setColorAt(i, _c.set(j.type === "pressurized" ? 0x7fe9ff : j.type === "stack" ? 0xffffff : 0xffc24a));
    }
    this.rings.count = n; this.rings.visible = n > 0;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }
}
const _c = new THREE.Color();

/**
 * A module being assembled. Three things, all there from the first frame:
 *   - the whole module as an amber BLUEPRINT (translucent, pulsing in real time), so a placement is never invisible;
 *   - the part already built, a solid primer-grey silhouette rising from the ground through a clipping plane;
 *   - a scaffold cage.
 * Everything visual here runs on REAL seconds: the pop when it is placed, the pulse, and the easing of the
 * rising edge toward the true progress (which never shows less than a first course of 12%).
 */
export class Site {
  /** legs: how far below the floor datum the ground lies under this footprint (the scaffold stands on it). */
  constructor(kit, mod, legs = 0) {
    this.kit = kit; this.mod = mod; this.legs = legs;
    this.group = new THREE.Group(); this.group.name = "site:" + mod.id;
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.material = new THREE.MeshStandardMaterial({ color: 0xcfcabd, roughness: 0.85, metalness: 0, clippingPlanes: [this.plane], side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.blueMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.34, depthWrite: false });
    this.blue = new THREE.Mesh(new THREE.BufferGeometry(), this.blueMat);
    this.blue.renderOrder = 4;
    this.mesh.visible = false; this.blue.visible = false;
    const K = KIT[mod.type], h = K.height + 0.6, fx = K.fp[0] * 4, fz = K.fp[1] * 4, pts = [];
    const seg = (a, b) => pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    for (let y = 0; y <= h + 0.01; y += h / Math.max(2, Math.round(h / 1.5))) { seg([-fx / 2, y, -fz / 2], [fx / 2, y, -fz / 2]); seg([fx / 2, y, -fz / 2], [fx / 2, y, fz / 2]); seg([fx / 2, y, fz / 2], [-fx / 2, y, fz / 2]); seg([-fx / 2, y, fz / 2], [-fx / 2, y, -fz / 2]); }
    const y0 = -Math.max(0, legs) - 0.15;
    for (let x = -fx / 2; x <= fx / 2 + 0.01; x += 2) { seg([x, y0, -fz / 2], [x, h, -fz / 2]); seg([x, y0, fz / 2], [x, h, fz / 2]); }
    for (let z = -fz / 2 + 2; z < fz / 2 - 0.01; z += 2) { seg([-fx / 2, y0, z], [-fx / 2, h, z]); seg([fx / 2, y0, z], [fx / 2, h, z]); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.scaffold = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.85 }));
    this.height = K.height;
    this.group.add(this.mesh, this.blue, this.scaffold);
    this.group.position.set(mod.lx, mod.ly || 0, mod.lz); this.group.rotation.y = mod.r * Math.PI / 2;
    this.born = performance.now(); this.shown = 0;
    const show = (p) => { this.mesh.geometry = p.silhouette; this.blue.geometry = p.silhouette; this.mesh.visible = true; this.blue.visible = true; };
    const have = kit.loaded(mod.type);
    if (have) show(have); else kit.proto(mod.type).then(show);      // the ghost has normally loaded it already: then it is there this very frame
  }
  /** progress 0..1; baseY = world height of the base datum; dt real seconds. */
  update(progress, baseY, dt = 0.016) {
    const now = performance.now(), age = (now - this.born) / 1000, pop = Math.min(1, age / 0.3);
    // a blueprint (planned, in descent, or its components still at the pod): a cyan hologram, no scaffold, nothing rising
    const plan = this.mod.plan, blueprint = plan === "draft" || plan === "ordered" || plan === "delivered";
    if (blueprint !== this._bp) { this._bp = blueprint; this.blueMat.color.set(blueprint ? (plan === "draft" ? 0x5fd4ff : 0x8fb8ff) : 0xffa040); }
    const want = blueprint ? 0 : 0.12 + 0.88 * progress;
    this.shown += (want - this.shown) * Math.min(1, 0.25 + dt * 4);
    this.plane.constant = baseY + (this.mod.ly || 0) + 0.02 + this.height * this.shown;
    this.mesh.visible = !blueprint && !!this.mesh.geometry.attributes.position;
    this.scaffold.visible = !blueprint;
    this.group.scale.setScalar(0.82 + 0.18 * (1 - (1 - pop) * (1 - pop)));
    this.blueMat.opacity = blueprint ? (plan === "draft" ? 0.26 : 0.2) + 0.08 * Math.sin(now * 0.003) + 0.3 * (1 - pop) : (this.mod.queued ? 0.22 : 0.32) + 0.1 * Math.sin(now * 0.004) + 0.3 * (1 - pop);
    this.scaffold.material.opacity = this.mod.queued ? 0.5 : 0.85;
  }
  dispose() { this.scaffold.geometry.dispose(); this.material.dispose(); this.blueMat.dispose(); this.group.parent && this.group.parent.remove(this.group); }
}

/** The selection outline: the silhouette pushed out along its normals, back faces only. */
export class Outline {
  constructor(kit) {
    this.kit = kit;
    this.material = new THREE.MeshBasicMaterial({ color: 0xffb347, side: THREE.BackSide });
    this.material.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  transformed += normalize(normal) * 0.09;"); };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = "build-outline"; this.mesh.visible = false; this.mesh.matrixAutoUpdate = false; this.mesh.frustumCulled = false;
    this.id = null;
  }
  /** frame: Matrix4 of the base group; mod or null */
  show(mod, frame, colour = 0xffb347) {
    if (!mod) { this.mesh.visible = false; this.id = null; return; }
    const P = this.kit.loaded(mod.type);
    if (!P) { this.mesh.visible = false; return; }
    this.mesh.geometry = P.silhouette;
    this.mesh.matrix.makeRotationY(mod.r * Math.PI / 2).setPosition(mod.lx, mod.ly || 0, mod.lz).premultiply(frame);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.material.color.set(colour);
    this.mesh.visible = true; this.id = mod.id;
  }
}

/** The build grid: the base's 4 m lattice drawn on the ground around the cursor, in build mode only. */
export class GridDecal {
  constructor() {
    this.cells = 6;
    const n = (this.cells * 2 + 2) * 2 * (this.cells * 2 + 1) * 2 * 2;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    this.lines = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ color: 0xffc890, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.lines.name = "build-grid"; this.lines.frustumCulled = false; this.lines.visible = false; this.lines.renderOrder = 3;
    this.key = "";
  }
  /** frame {x, z, yaw}; (cx, cz) the lattice cell the cursor is in. Lines run along cell boundaries, 2 m segments, draped. */
  update(surface, frame, cx, cz) {
    const key = [frame.x.toFixed(2), frame.z.toFixed(2), frame.yaw.toFixed(3), cx, cz].join("|");
    this.lines.visible = true;
    if (key === this.key) return;
    this.key = key;
    const P = this.geometry.attributes.position, C = this.geometry.attributes.color, N = this.cells, w = {};
    let k = 0;
    const put = (lx, lz) => {
      toWorld(frame, lx, lz, w);
      const d = Math.hypot(lx - cx * 4, lz - cz * 4) / (N * 4 + 2), a = Math.max(0, 1 - d * d);
      P.setXYZ(k, w.x - frame.x, surface.height(w.x, w.z) + 0.11, w.z - frame.z); C.setXYZW(k, 1, 1, 1, a); k++;
    };
    for (let i = -N; i <= N + 1; i++) {
      const edge = (cx + i) * 4 - 2;
      for (let j = -N; j <= N; j++) for (let h = 0; h < 2; h++) {
        const a = (cz + j) * 4 - 2 + h * 2;
        put(edge, a); put(edge, a + 2);
      }
    }
    for (let j = -N; j <= N + 1; j++) {
      const edge = (cz + j) * 4 - 2;
      for (let i = -N; i <= N; i++) for (let h = 0; h < 2; h++) {
        const a = (cx + i) * 4 - 2 + h * 2;
        put(a, edge); put(a + 2, edge);
      }
    }
    this.geometry.setDrawRange(0, k);
    P.needsUpdate = true; C.needsUpdate = true;
    this.lines.position.set(frame.x, 0, frame.z);
  }
  hide() { this.lines.visible = false; }
}
