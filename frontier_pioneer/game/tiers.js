/**
 * BASE TIERS, PLANNED STRUCTURES, THE CITY, AND THE SKY TURNING BLUE.
 *
 * System "tiers" (order 88). Active in a story campaign only.
 *
 *   TIERS: outpost -> settlement -> dome -> biome -> city -> terraforming. Read from what is built
 *   (the base system's modules and the planned structures below) and floored by the act the story is
 *   in, so a jump to Act V looks like Act V. KEEPER announces each (KEEPER.bark.tier_*).
 *
 *   PLANNED STRUCTURES are the story's modules that the kit does not have yet (a dome, a biome dome, relay
 *   towers, an ice mine, a telescope, the long table...): ordered by a build objective, placed on a ring
 *   around the home base, and assembled by the caretakers exactly like kit modules (a crew at the site,
 *   or the pioneer before there is one). Drawn as scaffolding that fills in, then the structure.
 *
 *   THE CITY grows on its own from the city tier: domes and lit blocks on rings around the old outpost,
 *   more every sol (and a lot more while the pioneer sleeps: grow(sols)), lit at night like lanterns.
 *
 *   TERRAFORMING sets one number on the sky (game.sky.terraform, 0..1: the small hook in sky.js tints the
 *   painted sky bluer from the horizon up), from the true date once the regional project has begun.
 *
 *   getSystem("tiers").api = { tier(), name(), order(type, o), built(type), sites(), structures(), advance(sim),
 *     grow(sols), terraform(), population() }
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { RULES } from "./basenet.js?v=b8cfe8e-efa5b7b7";
import { speech, hash, rng, humanise } from "./storydata.js?v=b8cfe8e-efa5b7b7";

export const TIER_NAMES = ["none", "outpost", "settlement", "dome", "biome", "city", "terraforming"];
const TIER_LINE = { 1: "KEEPER.bark.tier_outpost", 2: "KEEPER.bark.tier_settlement", 3: "KEEPER.bark.tier_dome", 4: "KEEPER.bark.tier_biome", 5: "KEEPER.bark.tier_city", 6: "KEEPER.bark.tier_terraform" };
/** The story's modules that are not in the kit: name, build hours of sol clock, footprint radius, how to draw them. */
export const PLANNED = {
  dome: { name: "Jezero Dome", build_h: 3, r: 16, shape: "dome", ring: 62 },
  biome_dome: { name: "Biome dome", build_h: 3, r: 18, shape: "dome", green: true, ring: 70 },
  ice_mine: { name: "Ice mine", build_h: 1, r: 4, shape: "rig", ring: 40 },
  relay_tower: { name: "Relay tower", build_h: 0.6, r: 2, shape: "mast", ring: 46, spread: 280 },
  melt_plant: { name: "Melt plant", build_h: 1, r: 5, shape: "tanks", ring: 44 },
  telescope_mod: { name: "Telescope", build_h: 0.8, r: 3, shape: "scope", ring: 38 },
  table_long: { name: "The long table", build_h: 0.2, r: 3, shape: "table", ring: 30 },
  dome_crown_ring: { name: "Dome crown ring", build_h: 1, r: 16, shape: "ring", on: "dome" },
  printed_arch: { name: "Printed arch", build_h: 1.5, r: 8, shape: "arch", ring: 80 },
  atmosphere_plant: { name: "Atmosphere plant", build_h: 2, r: 8, shape: "stacks", ring: 95 },
  desk: { name: "School desks", build_h: 0.05, r: 6, shape: "desks", ring: 52, batch: true },
  hideout: { name: "Hideout", build_h: 0.8, r: 4, shape: "hideout", ring: 25 },
};
export const plannedName = (t) => (PLANNED[t] ? PLANNED[t].name : humanise(t));

const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.2 }, o));
const GLASS = () => new THREE.MeshStandardMaterial({ color: 0x9fd6ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
function structureMesh(type) {
  const P = PLANNED[type] || { r: 3, shape: "mast" }, g = new THREE.Group(), frame = M(0xcfd3d8, { metalness: 0.5 }), dark = M(0x3a3f45);
  const r = P.r;
  if (P.shape === "dome") {
    const glass = GLASS(); if (P.green) glass.color.set(0xa8f0c0);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass); g.add(dome);
    for (let k = 0; k < 12; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 4, 24, Math.PI), frame); rib.rotation.y = k / 12 * Math.PI; g.add(rib); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 6, 48), frame); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 32), M(P.green ? 0x3f8f45 : 0x5d8a3a, { emissive: 0x16300f, emissiveIntensity: 0.4 })); lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.15; g.add(lawn);
    g.userData.glow = lawn;
  } else if (P.shape === "mast") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 14, 6), frame); m.position.y = 7; g.add(m);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 6, 0, Math.PI * 2, 0, 1), frame); dish.position.y = 13.5; dish.rotation.x = -1; g.add(dish);
  } else if (P.shape === "rig") {
    for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6), frame); const a = k / 3 * Math.PI * 2; l.position.set(Math.cos(a) * 1.4, 3.3, Math.sin(a) * 1.4); l.rotation.z = Math.cos(a) * 0.2; l.rotation.x = -Math.sin(a) * 0.2; g.add(l); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), M(0xd98e04)); box.position.y = 0.8; g.add(box);
  } else if (P.shape === "tanks" || P.shape === "stacks") {
    for (let k = 0; k < (P.shape === "stacks" ? 4 : 3); k++) { const h = P.shape === "stacks" ? 12 + k * 2 : 4; const c = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, h, 14), k % 2 ? frame : M(0xb8bcc2)); c.position.set(-3 + k * 2.4, h / 2, 0); g.add(c); }
  } else if (P.shape === "scope") {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 2.4, 16), frame); b.position.y = 1.2; g.add(b);
    const d = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xeaeaea)); d.position.y = 2.4; g.add(d);
  } else if (P.shape === "table") {
    const t = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 1.2), M(0x8a6b4a)); t.position.y = 0.9; g.add(t);
    for (const x of [-2.8, 2.8]) for (const z of [-0.5, 0.5]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), dark); l.position.set(x, 0.45, z); g.add(l); }
  } else if (P.shape === "ring") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.4, 8, 32), frame); ring.rotation.x = Math.PI / 2; ring.position.y = r - 0.5; g.add(ring);
  } else if (P.shape === "arch") {
    const a = new THREE.Mesh(new THREE.TorusGeometry(r, 0.9, 8, 24, Math.PI), M(0xb07a52, { roughness: 0.9 })); g.add(a);
  } else if (P.shape === "desks") {
    for (let k = 0; k < 30; k++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), M(0x8a6b4a)); d.position.set(-4 + (k % 6) * 1.6, 0.35, -4 + Math.floor(k / 6) * 1.6); d.visible = false; d.name = "desk" + k; g.add(d); }
  } else {
    const h = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 4), M(0x6b6255, { roughness: 0.95 })); h.position.y = 1.1; g.add(h);
  }
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  return g;
}
function scaffold(r, h) {
  const geo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r, h, 10, 3, true)), s = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
  s.position.y = h / 2; return s;
}

class Tiers {
  constructor(game) {
    this.game = game; this.root = new THREE.Group(); this.root.name = "tiers"; game.scene.add(this.root);
    this.S = this._fresh(); this.objs = new Map(); this.enabled = false; this.city = null; this._tags = new Map();
  }
  _fresh() { return { v: 1, tier: 0, list: [], pop: 0, blocks: 0, seq: 0 }; }
  get story() { const s = getSystem("story"); return s && s.api ? s.api : null; }
  home() { const st = this.story; return st ? st.home() : { x: this.game.vehicle.p.x, z: this.game.vehicle.p.z }; }

  /** Order a planned structure (idempotent per key). Returns its record. */
  order(type, o = {}) {
    const key = o.key || type;
    let s = this.S.list.find((x) => x.key === key);
    if (s) return s;
    const P = PLANNED[type] || { r: 4, ring: 40, build_h: 1 };
    const h = this.home(), n = this.S.list.length, base = (hash(type) % 360) * Math.PI / 180;
    let x = h.x, z = h.z;
    if (P.on) { const on = this.S.list.find((q) => q.type === P.on); if (on) { x = on.x; z = on.z; } }
    else {
      const ring = (P.ring || 40) + (o.index || 0) * (P.spread || 0) * 0.25;
      for (let k = 0; k < 16; k++) {
        const a = base + k * 0.7 + (o.index || 0) * 2.1, rr = ring + k * 3 + (P.spread ? (o.index || 0) * P.spread : 0);
        x = h.x + Math.sin(a) * rr; z = h.z + Math.cos(a) * rr;
        if (!this.game.site.inside(x, z, 120)) continue;
        if (this.game.surface.slopeDeg(x, z, Math.max(2, P.r * 0.6)) < 9 && !this.S.list.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + P.r + 4)) break;
      }
    }
    s = { id: "planned_" + (++this.S.seq), key, type, x, z, r: P.r, progress: o.instant ? 1 : 0, count: o.count || 1, mission: o.mission || null, event: o.event || null };
    this.S.list.push(s);
    this._draw(s);
    return s;
  }
  built(type) { return this.S.list.filter((s) => s.type === type).reduce((a, s) => a + (s.count > 1 ? Math.floor(s.progress * s.count + 1e-6) : s.progress >= 1 ? 1 : 0), 0); }
  sites() { return this.S.list.filter((s) => s.progress < 1).map((s) => ({ id: s.id, x: s.x, z: s.z, r: s.r })); }
  /** Construction: sol-clock seconds, at least RULES.buildPace per real second, only with a crew at the site. */
  advance(sim) {
    const C = getSystem("caretakers"), api = C && C.api, cc = C && C.caretakers;
    for (const s of this.S.list) {
      if (s.progress >= 1) continue;
      const crew = api && (api.crewAt(s.id) || (cc && cc.playerCrew(s.x, s.z)));
      if (!crew) { s.waiting = true; continue; }
      s.waiting = false;
      const P = PLANNED[s.type] || { build_h: 1 };
      s.progress = Math.min(1, s.progress + sim / 3600 / Math.max(0.05, P.build_h * (s.count > 1 ? Math.max(1, s.count / 10) : 1)));
      if (s.progress >= 1) this._done(s);
    }
  }
  _done(s) {
    const g = this.game;
    this._draw(s);
    speech(g).say("KEEPER.bark.build_done", { style: "radio", bark: true });
    g.hud.toast(`${plannedName(s.type)} complete<small>built by the caretakers</small>`, 4);
    g.emit("tiers:built", { structure: s });
    if (s.event && this.story) this.story.event(s.event);
  }
  _draw(s) {
    let o = this.objs.get(s.id);
    if (!o) { o = { g: new THREE.Group(), mesh: structureMesh(s.type) }; o.g.add(o.mesh); this.root.add(o.g); this.objs.set(s.id, o); }
    const y = this.game.surface.height(s.x, s.z);
    o.g.position.set(s.x, y, s.z);
    const done = s.progress >= 1;
    if (!done && !o.scaf) { o.scaf = scaffold(s.r * 0.85, Math.max(3, s.r * 0.7)); o.g.add(o.scaf); }
    if (o.scaf) o.scaf.visible = !done;
    if (s.count > 1) { const n = Math.floor(s.progress * s.count + 1e-6); o.mesh.children.forEach((c, i) => { c.visible = i < n; }); o.mesh.scale.y = 1; }
    else o.mesh.scale.y = done ? 1 : Math.max(0.02, s.progress);
    o.mesh.visible = done || s.progress > 0.02;
  }

  /* ── the tier ── */
  compute() {
    const g = this.game, b = getSystem("base"), st = this.story;
    let mods = [];
    try { mods = b && b.api ? b.api.modules().filter((m) => m.built) : []; } catch { mods = []; }
    const has = (re) => mods.some((m) => re.test(m.type));
    let t = 0;
    if (has(/^hab/) && has(/solar|battery/) && has(/airlock|hab_hdu/)) t = 1;
    if (t >= 1 && mods.length >= 6 && has(/isru|greenhouse/)) t = 2;
    if (this.built("dome")) t = Math.max(t, 3);
    if (this.built("biome_dome") || (t >= 3 && has(/greenhouse/))) t = Math.max(t, 4);
    const act = st ? st.act() : "I";
    if (t >= 3 && (act === "III" || act === "IV" || act === "V" || act === "fugitive")) t = Math.max(t, 5);
    if ((t >= 5 && (act === "IV" || act === "V" || act === "fugitive")) || this.built("atmosphere_plant")) t = Math.max(t, 6);
    t = Math.max(t, st ? st.tierFloor() : 0);
    return t;
  }
  update(dt, simDt) {
    if (!this.enabled) return;
    this.advance(Math.max(simDt, dt * RULES.buildPace));
    this._acc = (this._acc || 0) + dt;
    for (const s of this.S.list) if (s.progress < 1) this._draw(s);
    if (this._acc < 0.5) return;
    this._acc = 0;
    const t = this.compute();
    if (t > this.S.tier) {
      const was = this.S.tier; this.S.tier = t;
      if (was > 0 || t === 1) { speech(this.game).say(TIER_LINE[t], { style: "radio", bark: true }); this.game.hud.toast(`Tier: ${TIER_NAMES[t]}<small>${["", "a pressurised outpost", "a settlement that feeds itself", "the first dome", "a living biome", "a city", "the regional project has begun"][t]}</small>`, 5); }
      this.game.emit("story:tier", { tier: t, name: TIER_NAMES[t] });
    } else if (t < this.S.tier && t >= 0) this.S.tier = Math.max(t, this.story ? this.story.tierFloor() : 0);
    this._tagSites();
    this._cityGrow(0);
    this._sky();
  }
  _tagSites() {
    const ui = this.game.hud.ui; if (!ui || !ui.tag) return;
    for (const s of this.S.list) {
      const want = s.progress < 1, t = this._tags.get(s.id), txt = `${plannedName(s.type).toUpperCase()} · ${Math.round(s.progress * 100)}%${s.waiting ? " · waiting for a crew" : ""}`;
      if (want && !t) this._tags.set(s.id, ui.tag("planned-" + s.id, { pos: { x: s.x, z: s.z }, text: txt, kind: "ground" }));
      else if (want && t) t.set(txt);
      else if (!want && t) { t.remove(); this._tags.delete(s.id); }
    }
  }

  /* ── the city ── */
  grow(sols) {
    const t = this.S.tier, act = this.story ? this.story.act() : "I";
    const target = { I: 2, II: 20, III: 150, IV: 800, V: 3000, fugitive: 3000 }[act] || 2;
    this.S.pop = Math.min(target, this.S.pop + Math.max(1, Math.round(sols * target / 40)));
    if (t >= 5) this.S.blocks = Math.min(t >= 6 ? 64 : 36, this.S.blocks + Math.max(2, Math.round(sols * 1.5)));
    this._cityGrow(0, true);
  }
  _cityGrow(dt, force = false) {
    const want = this.S.tier >= 5 ? Math.max(this.S.blocks, this.S.tier >= 6 ? 40 : 18) : 0;
    if (!force && this.city && this.city.n === want) { this._cityLights(); return; }
    if (this.city) { this.root.remove(this.city.domes, this.city.blocks); this.city = null; }
    if (!want) return;
    const g = this.game, h = this.home(), r = rng(hash("city" + (this.story ? this.story.seed() : 1)));
    const domeGeo = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), blockGeo = new THREE.BoxGeometry(1, 1, 1);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55, emissive: 0xffc070, emissiveIntensity: 0 });
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7, emissive: 0xffb347, emissiveIntensity: 0 });
    const domes = new THREE.InstancedMesh(domeGeo, domeMat, want), blocks = new THREE.InstancedMesh(blockGeo, blockMat, want);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let nd = 0, nb = 0;
    for (let i = 0; i < want * 3 && nd + nb < want * 2; i++) {
      const a = r() * Math.PI * 2, rr = 110 + Math.sqrt(r()) * (160 + want * 7);
      const x = h.x + Math.sin(a) * rr, z = h.z + Math.cos(a) * rr;
      if (!g.site.inside(x, z, 100) || g.surface.slopeDeg(x, z, 6) > 8) continue;
      if (this.S.list.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 14)) continue;
      const y = g.surface.height(x, z);
      if (r() < 0.45 && nd < want) { const R = 6 + r() * 10; m.compose(p.set(x, y, z), q.identity(), s.set(R, R * 0.8, R)); domes.setMatrixAt(nd++, m); }
      else if (nb < want) { m.compose(p.set(x, y + 2, z), q.setFromAxisAngle(_Y, r() * Math.PI), s.set(6 + r() * 10, 4 + r() * 6, 5 + r() * 8)); blocks.setMatrixAt(nb++, m); }
    }
    domes.count = nd; blocks.count = nb; domes.frustumCulled = false; blocks.frustumCulled = false;
    domes.name = "city-domes"; blocks.name = "city-blocks";
    this.root.add(domes, blocks);
    this.city = { domes, blocks, n: want, domeMat, blockMat };
    this._cityLights();
  }
  _cityLights() {
    if (!this.city) return;
    const day = this.game.sky ? this.game.sky.uniforms.uDay.value : 1;
    this.city.domeMat.emissiveIntensity = (1 - day) * 1.4; this.city.blockMat.emissiveIntensity = (1 - day) * 0.9;
    for (const s of this.S.list) { const o = this.objs.get(s.id); if (o && o.mesh.userData.glow) o.mesh.userData.glow.material.emissiveIntensity = 0.4 + (1 - day) * 1.2; }
  }
  terraform() {
    const st = this.story; if (!st || this.S.tier < 6) return 0;
    const sol = st.trueSol(), k = Math.max(0, Math.min(1, (sol - 13600) / (18830 - 13600)));
    return Math.min(1, 0.12 + 0.48 * k + (this.built("atmosphere_plant") ? 0.1 : 0));
  }
  _sky() { const s = this.game.sky; if (s) s.terraform = this.enabled ? this.terraform() : 0; }

  toJSON() { return this.S; }
  fromJSON(s) {
    for (const o of this.objs.values()) this.root.remove(o.g);
    for (const t of this._tags.values()) t.remove();
    this.objs.clear(); this._tags.clear();
    if (this.city) { this.root.remove(this.city.domes, this.city.blocks); this.city = null; }
    this.S = Object.assign(this._fresh(), s || {});
    for (const x of this.S.list) this._draw(x);
  }
}
const _Y = new THREE.Vector3(0, 1, 0);

let T = null;
const sys = {
  id: "tiers", order: 88,
  get tiers() { return T; },
  api: {
    get enabled() { return !!(T && T.enabled); },
    setEnabled: (on) => { if (!T) return; T.enabled = !!on; T.root.visible = !!on; if (!on && T.game.sky) T.game.sky.terraform = 0; },
    tier: () => (T ? T.S.tier : 0), name: () => (T ? TIER_NAMES[T.S.tier] : "none"),
    order: (type, o) => (T ? T.order(type, o) : null), built: (type) => (T ? T.built(type) : 0),
    sites: () => (T && T.enabled ? T.sites() : []), structures: () => (T ? T.S.list.slice() : []),
    advance: (s) => T && T.advance(s), grow: (sols) => T && T.grow(sols), terraform: () => (T ? T.terraform() : 0),
    population: () => (T ? T.S.pop : 0), recompute: () => T && T.update(0.6, 0),
    finish: (type) => { if (!T) return; for (const s of T.S.list) if (s.type === type && s.progress < 1) { s.progress = 1; T._done(s); } },
  },
  init(game) { T = new Tiers(game); },
  load(game, saved) { if (T) T.fromJSON(saved); },
  save() { return T ? T.toJSON() : undefined; },
  tick(game, dt, ctx) { if (T) T.update(dt, ctx.simDt); },
  frame() { if (T && T.enabled) { T._cityLights(); T._sky(); } },
};
registerSystem(sys);
export { PLANNED as PLANNED_STRUCTURES };
