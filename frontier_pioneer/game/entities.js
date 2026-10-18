/**
 * The placement layer: things that stand on the ground at a position.
 *
 * This is what the base builder extends. An entity is DATA
 *     { id, type, x, z, yaw, data }
 * plus an Object3D made for it by its type's factory. Its height is never
 * stored: it is taken from surface.height() when the entity is created, and
 * again whenever finer terrain arrives under it (`reseat`), so a module saved
 * on one visit stands on the same ground on the next.
 *
 *   registerType("hab_small", { kind: "base", footprint: 4.5, persist: true,
 *                               create: async (def, ctx) => Object3D })
 *   const e = await layer.add({ type: "hab_small", x, z, yaw })
 *   layer.canPlace(type, x, z)   -> {ok, slope, flatness, reason}
 *   layer.remove(id) ; layer.near(x, z, r) ; layer.serialise() ; await layer.restore(list)
 *
 * `persist: false` types (the POI beacons below) belong to the site, not the
 * save. ctx is { surface, site, assets } where assets.load(id) resolves a GLB
 * from assets/models/catalog.json (or null), so a base module type is three
 * lines once the kit is there.
 *
 * HOOKS A TYPE MAY SUPPLY (the base builder's module types use all of them;
 * see builder.js). Each is optional and the default behaviour above is what a
 * type gets without it:
 *     canPlace(type, x, z, layer)  replaces the slope / spacing test
 *     seat(e, layer)               replaces "stand it on the ground at its origin"
 *                                  (a base is levelled and re-seated as one rigid frame)
 *     onAdd(e, layer), onRemove(e, layer)
 * `layer.reseatHooks` are called after every reseat(), for anything that
 * follows the ground without being an entity.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const TYPES = new Map();
export function registerType(id, spec) { TYPES.set(id, Object.assign({ kind: "prop", footprint: 1, persist: true, maxSlope: 12 }, spec, { id })); }
export function entityTypes() { return [...TYPES.values()]; }

export class Assets {
  constructor(base = "assets/models/") { this.base = base; this.catalog = null; this.cache = new Map(); }
  async entries() {
    if (this.catalog) return this.catalog;
    try {
      const r = await fetch(this.base + "catalog.json", { cache: "no-cache" });
      const j = r.ok ? await r.json() : [];
      this.catalog = Array.isArray(j) ? j : (j.items || j.models || j.entries || []);
    } catch { this.catalog = []; }
    return this.catalog;
  }
  /** A fresh clone of the catalogued model, scaled, or null if the kit does not have it. */
  async load(id) {
    const e = (await this.entries()).find((x) => x.id === id);
    if (!e) return null;
    if (!this.cache.has(id)) {
      const { GLTFLoader } = await import("../vendor/GLTFLoader.js?v=6d37c9c-9b39e129");
      this.cache.set(id, new GLTFLoader().loadAsync(this.base + e.file).then((g) => { g.scene.scale.setScalar(e.scale ?? 1); return g.scene; }));
    }
    const o = (await this.cache.get(id)).clone(true);
    o.userData.catalog = e;
    return o;
  }
}

export class EntityLayer {
  constructor(surface, site, assets) {
    this.surface = surface; this.site = site; this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = "entities";
    this.items = new Map();
    this.reseatHooks = [];
    this._n = 0;
  }
  get ctx() { return { surface: this.surface, site: this.site, assets: this.assets }; }

  canPlace(type, x, z) {
    const T = TYPES.get(type);
    if (!T) return { ok: false, reason: "unknown type" };
    if (T.canPlace) return T.canPlace(type, x, z, this);
    if (!this.site.inside(x, z, 50)) return { ok: false, reason: "outside the mapped area" };
    const slope = this.surface.slopeDeg(x, z, Math.max(1.5, T.footprint)), flatness = this.surface.flatness(x, z, T.footprint);
    if (slope > T.maxSlope) return { ok: false, slope, flatness, reason: "too steep" };
    for (const e of this.items.values()) {
      const t = TYPES.get(e.def.type);
      if (t.persist && Math.hypot(e.def.x - x, e.def.z - z) < t.footprint + T.footprint) return { ok: false, slope, flatness, reason: "occupied" };
    }
    return { ok: true, slope, flatness };
  }

  async add(def) {
    const T = TYPES.get(def.type);
    if (!T) throw new Error("unknown entity type " + def.type);
    def = Object.assign({ id: def.type + "-" + (++this._n) + "-" + Math.random().toString(36).slice(2, 6), yaw: 0, data: {} }, def);
    const object = await T.create(def, this.ctx);
    object.name = "entity:" + def.id;
    const e = { def, type: T, object };
    this._seat(e);
    this.group.add(object);
    this.items.set(def.id, e);
    if (T.onAdd) T.onAdd(e, this);
    return e;
  }
  _seat(e) {
    if (e.type.seat) { e.type.seat(e, this); return; }
    e.object.position.set(e.def.x, this.surface.height(e.def.x, e.def.z), e.def.z);
    e.object.rotation.y = -e.def.yaw;
  }
  /** Re-derive every height (call when finer terrain has streamed in). */
  reseat() {
    for (const e of this.items.values()) this._seat(e);
    for (const f of this.reseatHooks) { try { f(this); } catch (err) { console.error("[entities] reseat hook", err); } }
  }
  remove(id) {
    const e = this.items.get(id);
    if (!e) return null;
    this.group.remove(e.object); this.items.delete(id);
    if (e.type.onRemove) e.type.onRemove(e, this);
    return e;
  }
  get(id) { return this.items.get(id) || null; }
  near(x, z, r) { return [...this.items.values()].filter((e) => Math.hypot(e.def.x - x, e.def.z - z) <= r); }
  serialise() { return [...this.items.values()].filter((e) => e.type.persist).map((e) => e.def); }
  async restore(list) { for (const d of list || []) { try { await this.add(d); } catch (err) { console.warn("[entities] skipped", d.type, err.message); } } }
}

/* ── the two types the foundation ships ─────────────────────────────────── */

registerType("poi_beacon", {
  kind: "marker", persist: false, footprint: 0.5,
  create: async (def) => {
    const g = new THREE.Group();
    const colour = new THREE.Color(def.data.colour || 0xffb347);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6, 8), new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.6, roughness: 0.4 }));
    pole.position.y = 3;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(4) }));
    lamp.position.y = 6.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 220, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(1.6), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 116;
    g.add(pole, lamp, beam);
    g.userData.lamp = lamp; g.userData.beam = beam;
    return g;
  },
});

registerType("sample_tube", {
  kind: "prop", persist: false, footprint: 0.2,
  create: async (def, ctx) => {
    const kit = await ctx.assets.load("sample_tube");
    if (kit) return kit;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.186, 10), new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.8, roughness: 0.3 }));
    m.rotation.z = Math.PI / 2; m.position.y = 0.012;
    const g = new THREE.Group(); g.add(m);
    return g;
  },
});
