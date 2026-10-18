/**
 * HALO-1: the logistics station that hangs over the pioneer's longitude, and
 * the care packages it drops wherever he asks.
 *
 * System "halo" (order 84). Runs only in a story campaign (story.js says so).
 *
 *   THE STATION is areostationary over 77 E (Jezero's meridian), 17,032 km up:
 *   from Jezero it stands about 68 degrees up in the south and never moves. It is drawn as a point of
 *   light in the sky (brighter at night), tagged "HALO-1" on the story layer when it matters, and is a
 *   marker on the corner map and the compass.
 *
 *   THE PLAN. Build mode is a planning table (builder.js): the pioneer lays the settlement out as blueprints
 *   from the rover, then sends the plan (G in build mode, its HALO-1 tab, or here). The package carries every
 *   blueprint's components, food, water, oxygen and spares for the stores, and the caretakers who will build
 *   it (one per three modules; the story says who: ANVIL rides the first). It drops beside the plan unless
 *   the uplink moves it. On landing the pod opens, the supplies go into the base's stores, the components
 *   are crates beside the pod (caretakers.js carries them to the blueprints and builds), the units step out.
 *   Materials are unlimited (HALO-1's stock); Contribution Credit is the only limit: the footprint of every
 *   module, planned or built, and the dispatch of each open package draw against 400 + lifetime XP, and the
 *   progression tier caps the base size and the packages open at once (progress.api.limits()).
 *
 *   THE UPLINK (U on the keyboard, "HALO-1 uplink" in the pause menu, or the story asking) sends the plan, or
 *   a resupply (food and water only), or what a mission asks for (a named unit, the rover, a hopper...), to a
 *   drop point on a relief map of the ground around you (click, or the D-pad and Cross).
 *
 *   THE DESCENT takes 20 to 30 game minutes (KEEPER says which: KEEPER.bark.descent_20..30), counted down
 *   on the map, the compass and a tag at the drop point, with KEEPER at ten, five and one minute. The
 *   last stretch is played in real time so it can be watched: a fiery entry streak from high in the
 *   east, a parachute, retro flare, a thump and a ring of dust. The pod stays where it lands, its
 *   beacon blinking amber. Every package brings food, water and components, and construction units
 *   (a named founder when the story says so; a generated caretaker while the act's population allows).
 *
 *   getSystem("halo").api = { requestPlan({ids, x, z, unit, id, free}), planDrop(ids), crates(), request(kind, {x, z, unit, item, story}), packages(), get(id), cc(), kinds,
 *     stationDir(), openUplink({kind, unit, drop}), closeUplink(), advance(simSeconds), landNow(id), enabled }
 *   events on the game: "halo:request" {pkg}, "halo:countdown" {id, minutes}, "halo:final" {id},
 *     "halo:landed" {pkg}, "halo:denied" {reason}
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { loadStory, speech, esc, ensureStoryStyles } from "./storydata.js?v=6d37c9c-9b39e129";
import { MODULES, planManifest, cratesFor } from "./basenet.js?v=6d37c9c-9b39e129";

export const STATION = { lonDeg: 77.0, radiusKm: 20428, marsKm: 3389.5 };
const D2R = Math.PI / 180;
const FINAL_S = 18;                 // the last stretch, in real seconds: entry streak, chute, retro
/** What can be asked for. cost: Contribution Credit held while the request is open. */
export const KINDS = {
  plan: { name: "The settlement plan", cost: 0, note: "the blueprints' components, supplies for the stores, and the caretakers who build it", plan: true },
  starter: { name: "Starter package", cost: 180, note: "rations, water, outpost components and one construction unit", food: 40, water: 150, materials: 400, units: 1, story: true, needsPlan: true },
  supplies_package: { name: "Resupply", cost: 20, note: "food and water only, for the stores", food: 40, water: 200 },
  components_small: { name: "Components", cost: 40, note: "base components (materials)", materials: 250, story: true },
  construction_unit: { name: "Construction unit", cost: 120, note: "one caretaker unit, with its own supplies", units: 1, food: 10, water: 40, materials: 60, story: true },
  long_range_rover: { name: "Long-range rover", cost: 150, note: "a pressurised long-range rover kit", materials: 120, item: "long_range_rover", story: true },
  hopper: { name: "Hopper", cost: 200, note: "a rocket hopper for pad-to-pad flights", item: "hopper", story: true },
  pad_kit: { name: "Pad kit", cost: 80, note: "a landing pad for hopper flights", item: "pad_kit", materials: 100, story: true },
  seed_vault: { name: "Seed vault", cost: 40, note: "seed stock and scions", item: "seed_vault", food: 10, story: true },
  aquaculture: { name: "Aquaculture", cost: 40, note: "fry and tanks", item: "aquaculture", water: 100, story: true },
};
const kindOf = (k) => KINDS[k] || KINDS[k === "supplies" ? "supplies_package" : k === "components" ? "components_small" : "construction_unit"];

/** Direction (world: X east, Y up, Z south) to an areostationary station from latitude / east longitude. */
export function stationDirection(latDeg, lonDeg, sLon = STATION.lonDeg) {
  const p = latDeg * D2R, l = lonDeg * D2R, s = sLon * D2R, R = STATION.marsKm, rs = STATION.radiusKm;
  const O = [R * Math.cos(p) * Math.cos(l), R * Math.cos(p) * Math.sin(l), R * Math.sin(p)], S = [rs * Math.cos(s), rs * Math.sin(s), 0];
  const v = [S[0] - O[0], S[1] - O[1], S[2] - O[2]];
  const E = [-Math.sin(l), Math.cos(l), 0], N = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], U = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const e = dot(v, E), n = dot(v, N), u = dot(v, U), m = Math.hypot(e, n, u);
  return [e / m, u / m, -n / m];
}

/* ── pictures ───────────────────────────────────────────────────────────── */

function podMesh() {
  const g = new THREE.Group(); g.name = "halo-pod";
  const shell = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.55, metalness: 0.25 }), dark = new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.5, metalness: 0.4 });
  const scorch = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9 }), band = new THREE.MeshStandardMaterial({ color: 0xe0641c, roughness: 0.5 });
  const add = (m, y) => { m.position.y = y; g.add(m); return m; };
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.3, 2.1, 20), shell), 1.4);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.8, 20), shell), 2.85);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.06, 1.06, 0.2, 20), band), 1.95);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.2, 0.35, 20), scorch), 0.32);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), dark); leg.position.set(Math.cos(a) * 1.35, 0.4, Math.sin(a) * 1.35); leg.rotation.z = 0.4 * Math.cos(a); leg.rotation.x = -0.4 * Math.sin(a); g.add(leg); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb000 })); lamp.position.y = 3.3; lamp.name = "pod-lamp"; g.add(lamp);
  // the hatch: a curved door on the +z side, hinged at its left edge; it swings open when the crew steps out
  const hinge = new THREE.Group(); hinge.name = "pod-hatch"; hinge.position.set(-0.62, 0.55, 0.78); g.add(hinge);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.12, 1.55, 10, 1, true, -0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
  door.position.set(0.62, 0.78, -0.78); hinge.add(door);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.98, 1.5, 10, 1, true, -0.55, 1.1), new THREE.MeshBasicMaterial({ color: 0x0d0f12, side: THREE.BackSide }));
  inner.position.y = 1.33; inner.name = "pod-inside"; g.add(inner);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  flame.name = "pod-retro"; flame.rotation.x = Math.PI; flame.position.y = -2.2; flame.visible = false; g.add(flame);
  // the parachute: a canopy and its lines, packed until the chute phase
  const chute = new THREE.Group(); chute.name = "pod-chute"; chute.visible = false;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8, side: THREE.DoubleSide }));
  canopy.position.y = 16; chute.add(canopy);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(6.05, 20, 2, 0, Math.PI * 2, 0.55, 0.18), new THREE.MeshStandardMaterial({ color: 0xe0641c, roughness: 0.8, side: THREE.DoubleSide })); stripe.position.y = 16; chute.add(stripe);
  const lineGeo = new THREE.BufferGeometry(), pts = [];
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; pts.push(0, 3.2, 0, Math.cos(a) * 5.2, 16 + 2.6, Math.sin(a) * 5.2); }
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  chute.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xcfc8bc })));
  g.add(chute);
  // the entry: an incandescent sheath and a long trail, aligned with the motion
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 2.2, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  trail.name = "pod-trail"; trail.visible = false; g.add(trail);
  const sheath = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  sheath.name = "pod-sheath"; sheath.visible = false; sheath.position.y = 1.4; g.add(sheath);
  g.traverse((o) => { if (o.isMesh || o.isLineSegments) o.frustumCulled = false; });
  return g;
}

/** A component crate: a pallet-crate in the kit's colours, a stripe by what it is for. */
const _crateGeo = { box: null, strap: null }, _crateMat = new Map();
const CAT_COLOUR = { habitat: 0xe6dccb, connect: 0x9ba5b0, power: 0x4f83e6, life: 0x5cc489, storage: 0xd8b055, vehicles: 0xc07a44, utility: 0x8a7f78 };
function crateMesh(type) {
  if (!_crateGeo.box) { _crateGeo.box = new THREE.BoxGeometry(1.1, 0.75, 0.8); _crateGeo.strap = new THREE.BoxGeometry(1.14, 0.12, 0.84); _crateGeo.pallet = new THREE.BoxGeometry(1.16, 0.1, 0.86); }
  const c = (MODULES[type] || {}).cat || "utility", key = c;
  if (!_crateMat.has(key)) _crateMat.set(key, { body: new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.8, metalness: 0.1 }), strap: new THREE.MeshStandardMaterial({ color: CAT_COLOUR[c] || 0x8a7f78, roughness: 0.6 }), pallet: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.8 }) });
  const M = _crateMat.get(key), g = new THREE.Group(); g.name = "crate:" + type;
  const b = new THREE.Mesh(_crateGeo.box, M.body); b.position.y = 0.48; g.add(b);
  const s1 = new THREE.Mesh(_crateGeo.strap, M.strap); s1.position.y = 0.62; g.add(s1);
  const p = new THREE.Mesh(_crateGeo.pallet, M.pallet); p.position.y = 0.05; g.add(p);
  return g;
}

/* ── the system ─────────────────────────────────────────────────────────── */

class Halo {
  constructor(game) {
    this.game = game; this.pk = []; this.seq = 0; this.meshes = new Map(); this.puffs = []; this.enabled = false; this.crateMeshes = new Map();
    this.dir = [0, 0.93, 0.37];
    const mat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat); this.star.renderOrder = -999; this.star.frustumCulled = false; this.star.visible = false; this.star.name = "halo-1";
    game.scene.add(this.star);
    ensureStoryStyles();
    this._ui();
  }
  get story() { const s = getSystem("story"); return s && s.api ? s.api : null; }
  setSite() {
    const s = this.game.site, ll = s.toLonLat(0, 0);
    this.dir = stationDirection(ll.lat, ll.lon);
    this.elevation = Math.asin(this.dir[1]) / D2R;
  }

  /* ── Contribution Credit ── */
  cc() {
    const D = this._D, P = getSystem("progress"), lim = P && P.api && P.api.limits ? P.api.limits() : null;
    const start = (D && D.acts.economy.start) || 400, total = P && P.api ? P.api.xpTotal || 0 : 0;
    let footprint = 0;
    const b = getSystem("base");
    try { if (b && b.api) for (const m of b.api.modules()) footprint += ((b.api.balance[m.type] || {}).cost || 0) / 2; } catch { /* no base */ }
    const open = this.pk.filter((p) => p.phase !== "landed");
    const held = open.reduce((a, p) => a + (p.cost || 0), 0);
    const capacity = start + total;
    return { capacity, footprint: Math.round(footprint), held, free: Math.round(capacity - footprint - held), open: open.length, maxOpen: lim ? lim.maxOpenRequests : 2, tier: lim ? lim.name : "", maxModules: lim ? lim.maxBaseModules : 24 };
  }
  validDrop(x, z) {
    const g = this.game;
    if (!g.site.inside(x, z, 80)) return { ok: false, reason: "outside the mapped area" };
    const s = g.surface.slopeDeg(x, z, 3);
    if (s > 12) return { ok: false, reason: `too steep for a drop: ${s.toFixed(0)} degrees`, slope: s };
    return { ok: true, slope: s };
  }
  /** Ask for a package. o: {x, z, unit, item, story, id, mission}. Returns {ok, reason, pkg}. */
  request(kind, o = {}) {
    const g = this.game, K = kindOf(kind), C = this.cc();
    if (!this.enabled) return this._deny("HALO-1 does not answer");
    if (C.open >= C.maxOpen) return this._deny(`open requests: ${C.open} of ${C.maxOpen} at tier ${C.tier}`);
    const cost = o.free ? 0 : K.cost;
    if (cost > C.free) return this._deny(`Contribution Credit: ${cost} needed, ${Math.max(0, C.free)} free`);
    const v = this.validDrop(o.x, o.z);
    if (!v.ok) return this._deny(v.reason, "KEEPER.bark.pkg_drop_invalid");
    const id = this._newId(o.id);
    const minutes = o.minutes || 20 + Math.floor(Math.random() * 11);
    const pkg = { id, kind, unit: o.unit || null, item: o.item || K.item || null, extra: o.extra || null, x: o.x, z: o.z, cost, minutes, total: minutes * 60, left: minutes * 60,
      phase: "descent", story: !!o.story, mission: o.mission || null, said: {}, sol: g.state.clock.sol };
    this.pk.push(pkg);
    speech(g).say("KEEPER.bark.descent_" + minutes, { style: "radio" });
    g.emit("halo:request", { pkg });
    this._markers();
    return { ok: true, pkg };
  }
  _newId(want) {
    if (want && !this.get(want)) { const n = +String(want).replace(/^pkg_/, ""); if (Number.isFinite(n)) this.seq = Math.max(this.seq, n); return want; }
    let id; do id = "pkg_" + String(++this.seq).padStart(3, "0"); while (this.get(id));
    return id;
  }
  /** Is the link up? In a campaign HALO-1 answers once the lander's mast has linked (1.1). */
  linked() {
    const st = this.story, S = st && st.state ? st.state() : null;
    return !S || !S.campaign || !!(S.vars["halo.linked"] || S.done["1.1"]);
  }
  /** Where the plan's package lands by default: beside the blueprints, on clear level ground. */
  planDrop(ids) {
    const b = getSystem("base"), mods = b && b.api ? (ids || []).map((id) => b.api.module(id)).filter(Boolean) : [];
    if (!mods.length) { const f = this.game.focus || this.game.vehicle.p; return { x: f.x + 30, z: f.z + 20 }; }
    let cx = 0, cz = 0; for (const m of mods) { cx += m.x; cz += m.z; } cx /= mods.length; cz /= mods.length;
    const all = b.api.modules();
    let R = 0; for (const m of mods) R = Math.max(R, Math.hypot(m.x - cx, m.z - cz));
    for (let ring = 0; ring < 4; ring++) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + 0.35, d = R + 13 + ring * 7, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!this.validDrop(x, z).ok) continue;
      if (all.some((m) => Math.hypot(m.x - x, m.z - z) < 9)) continue;
      return { x, z };
    }
    return { x: cx + R + 14, z: cz };
  }
  /** Send the plan: the blueprints' components, their supplies and their caretakers, in one package. o: {ids, x, z, unit, id, free, mission} */
  requestPlan(o = {}) {
    const g = this.game, b = getSystem("base"), C = this.cc();
    if (!this.enabled) return this._deny("HALO-1 does not answer");
    if (!this.linked()) return this._deny("no link to HALO-1 yet: link the lander's mast first", null);
    const ids = (o.ids || (b && b.api ? b.api.drafts().map((d) => d.id) : [])).filter((id) => { const m = b && b.api.module(id); return m && m.plan === "draft"; });
    if (!ids.length) return this._deny("nothing planned: lay out blueprints in build mode first", null);
    if (C.open >= C.maxOpen) return this._deny(`open requests: ${C.open} of ${C.maxOpen} at tier ${C.tier}`);
    const types = ids.map((id) => b.api.module(id).type), M = planManifest(types);
    const st = getSystem("story"), want = st && st.story && st.story._uplinkWant ? st.story._uplinkWant() : null;
    const cost = o.free ? 0 : 20 + 10 * M.caretakers;                     // the dispatch (crew and supplies), held while the package is open
    if (C.free < 0) return this._deny(`Contribution Credit: the plan's footprint is ${-C.free} over`);
    if (cost > C.free) return this._deny(`Contribution Credit: ${cost} needed for the dispatch, ${Math.max(0, C.free)} free`);
    const at = o.x != null ? { x: o.x, z: o.z } : this.planDrop(ids);
    const v = this.validDrop(at.x, at.z);
    if (!v.ok) return this._deny(v.reason, "KEEPER.bark.pkg_drop_invalid");
    const id = this._newId(o.id || (want && want.id));
    const minutes = o.minutes || 20 + Math.floor(Math.random() * 11);
    // who rides down: the story's unit, or ANVIL with the first plan of a campaign
    const C2 = getSystem("caretakers"), S = st && st.api ? st.api.state() : null;
    let unit = o.unit || (want && want.unit) || null;
    if (!unit && S && S.campaign && S.act !== "fugitive" && !(C2 && C2.api.get("ANVIL")) && !this.pk.some((p) => p.unit === "ANVIL")) unit = "ANVIL";
    const pkg = { id, kind: "plan", unit, item: (want && want.item) || null, extra: (want && want.extra) || null, x: at.x, z: at.z, cost, minutes, total: minutes * 60, left: minutes * 60,
      phase: "descent", story: true, mission: o.mission || (want && want.mission) || null, said: {}, sol: g.state.clock.sol, modules: ids, manifest: M, base: b.api.module(ids[0]).base, wantKind: want ? want.kind : null };
    for (const mid of ids) b.api.setPlan(mid, "ordered", { pkg: id });
    this.pk.push(pkg);
    speech(g).say("KEEPER.bark.descent_" + minutes, { style: "radio" });
    g.hud.toast(`HALO-1: plan received<small>package ${id.replace("pkg_", "")}: ${ids.length} module${ids.length > 1 ? "s" : ""}, ${M.crates} crates, supplies${unit ? ", " + unit : M.caretakers ? ", caretakers" : ""} \u00b7 descent ${minutes} minutes</small>`, 6);
    g.emit("halo:request", { pkg });
    this._markers();
    try { g.save(); } catch { /* not ready */ }
    return { ok: true, pkg };
  }
  _deny(reason, line = "KEEPER.bark.pkg_denied") {
    if (line) speech(this.game).say(line, { style: "radio" });
    this.game.hud.toast(`HALO-1: request refused<small>${esc(reason)}</small>`, 4.5);
    this.game.emit("halo:denied", { reason });
    return { ok: false, reason };
  }
  get(id) { return this.pk.find((p) => p.id === id) || null; }

  /* ── time ── */
  tick(dt, simDt) {
    for (const p of this.pk) {
      if (p.phase !== "descent") continue;
      p.left -= simDt;
      for (const m of [10, 5, 1]) if (p.left <= m * 60 && !p.said[m] && p.total > m * 60 + 30) { p.said[m] = true; this.game.emit("halo:countdown", { id: p.id, minutes: m, pkg: p }); }
      const scale = Math.max(1, this.game.state.clock.scale);
      if (p.left <= FINAL_S * scale) this._final(p);
    }
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.5) { this._acc = 0; this._markers(); }
  }
  /** Fast-forward the countdowns (tests; dormancy). */
  advance(sim) { for (const p of this.pk) if (p.phase === "descent") { p.left -= sim; if (p.left <= 0) this._final(p); } }
  _final(p) {
    if (p.phase !== "descent") return;
    p.phase = "final"; p.ft = 0; p.left = 0;
    const g = this.game, m = podMesh();
    g.scene.add(m); this.meshes.set(p.id, m);
    // where it comes from: high in the east, along the station's side of the sky
    const e = (p.x * 0.13 + p.z * 0.07) % 1;
    p.from = { x: p.x + 5200 + e * 600, y: 9000, z: p.z - 1800 };
    g.emit("halo:final", { id: p.id, pkg: p });
  }
  landNow(id) { const p = this.get(id); if (!p) return; if (p.phase === "descent") this._final(p); if (p.phase === "final") p.ft = FINAL_S; }

  /** Real time, paused or not: the final descent is watched (a cutscene may be holding the world). */
  frame(dt) {
    const g = this.game, cam = g.camera;
    // the station
    const on = this.enabled && g.mode !== "title";
    this.star.visible = on;
    if (on) {
      const day = g.sky ? g.sky.uniforms.uDay.value : 1;
      this.star.position.set(cam.position.x + this.dir[0] * 20000, cam.position.y + this.dir[1] * 20000, cam.position.z + this.dir[2] * 20000);
      this.star.scale.setScalar(26 + 14 * (1 - day));
      this.star.material.opacity = 0.25 + 0.7 * (1 - day);
      const ui = g.hud.ui, want = on && (day < 0.35 || this.uplinkOpen || this.pk.some((p) => p.phase !== "landed") || (this.story && this.story.wantsStation && this.story.wantsStation()));
      if (ui && ui.tag) {
        if (want && !this._tag) this._tag = ui.tag("halo1", { dir: this.dir, text: "HALO-1", kind: "sky" });
        else if (!want && this._tag) { this._tag.remove(); this._tag = null; }
      }
    } else if (this._tag) { this._tag.remove(); this._tag = null; }
    // final descents
    for (const p of this.pk) {
      if (p.phase !== "final") continue;
      const m = this.meshes.get(p.id); if (!m) continue;
      p.ft += dt || 0;
      const k = Math.min(1, p.ft / FINAL_S), gy = g.surface.height(p.x, p.z);
      const trail = m.getObjectByName("pod-trail"), sheath = m.getObjectByName("pod-sheath"), chute = m.getObjectByName("pod-chute"), retro = m.getObjectByName("pod-retro");
      if (k < 0.5) {
        // entry: a straight, fast, glowing line from high in the east down to 700 m
        const u = k / 0.5, uu = u * (2 - u);
        m.position.set(p.from.x + (p.x - p.from.x) * uu, p.from.y + (gy + 700 - p.from.y) * uu, p.from.z + (p.z - p.from.z) * uu);
        _v.set(p.from.x - p.x, p.from.y - gy - 700, p.from.z - p.z).normalize();
        trail.visible = true; sheath.visible = true; chute.visible = false;
        trail.quaternion.setFromUnitVectors(_up, _v); trail.position.copy(_v).multiplyScalar(45);
        m.scale.setScalar(1 + (1 - u) * 6);              // visible from far away
        trail.material.opacity = 0.65 * (1 - u * 0.6);
      } else if (k < 0.87) {
        const u = (k - 0.5) / 0.37;
        m.position.set(p.x, gy + 700 - (700 - 45) * u, p.z); m.scale.setScalar(1);
        trail.visible = false; sheath.visible = false; chute.visible = true; chute.scale.setScalar(Math.min(1, u * 5));
      } else {
        const u = (k - 0.87) / 0.13;
        m.position.set(p.x, gy + 45 * (1 - u) * (1 - u), p.z);
        chute.visible = false; retro.visible = true; retro.scale.y = 0.7 + 0.6 * Math.random();
      }
      if (k >= 1) this._land(p, m);
    }
    // landed pods: blink, and the dust rings
    const now = performance.now();
    const C = getSystem("caretakers"), units = C && C.api ? C.api.list() : [];
    for (const p of this.pk) {
      if (p.phase !== "landed") continue;
      const m = this.meshes.get(p.id); if (!m) continue;
      const l = m.getObjectByName("pod-lamp"); if (l) l.visible = (now % 1600) < 350;
      // the hatch opens once whoever rode down is out (ANVIL stays in until C03: he knocks from the inside)
      const shut = units.some((u) => u.pkg === p.id && u.state === "dormant") || (p.kind !== "plan" && !p.unit && !kindOf(p.kind).units);
      const h = m.getObjectByName("pod-hatch");
      if (h) { const want = shut ? 0 : -1.9; h.rotation.y += (want - h.rotation.y) * Math.min(1, (dt || 0) * 1.5); }
      if (p.pending) { const b = getSystem("base"); try { const bs = b && b.api ? b.api.bases() : []; if (bs.length) { const near = bs.sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0]; p.stowed = b.api.stow(near.id, p.pending); p.base = near.id; p.pending = null; } } catch { /* later */ } }
    }
    this._drawCrates(dt || 0);
    this._dust(dt || 0);
  }
  _land(p, m) {
    const g = this.game;
    p.phase = "landed"; p.landedSol = g.state.clock.sol;
    m.position.set(p.x, g.surface.height(p.x, p.z), p.z); m.scale.setScalar(1);
    for (const n of ["pod-trail", "pod-sheath", "pod-chute", "pod-retro"]) { const o = m.getObjectByName(n); if (o) o.visible = false; }
    this._puff(p.x, p.z);
    try { const A = getSystem("audio"); if (A && A.snd) A.snd.fx("impact", "world"); } catch { /* no sound */ }
    // the supplies go into the base's stores (crated beside them when there is no room); a plan's components are crates at the pod
    const K = kindOf(p.kind), b = getSystem("base");
    try {
      if (b && b.api) {
        if (K.materials) b.api.addMaterials(K.materials);
        const net = b.api.net, bases = net ? [...net.bases.values()] : [];
        const base = (p.base && net.bases.get(p.base)) || bases.sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
        const sup = p.kind === "plan" ? p.manifest.supplies : { food: K.food || 0, water: K.water || 0, o2: 0, spares: 0 };
        if (base) { p.stowed = b.api.stow(base.id, sup); p.base = base.id; }
        else p.pending = sup;                                          // nothing to stow into yet: it waits in the pod
        if (p.kind === "plan") this._crates(p, b);
      }
    } catch (e) { console.warn("[halo] stores", e); }
    speech(g).say(K.units || p.unit || p.kind === "plan" ? "KEEPER.bark.pkg_unit" : "KEEPER.bark.pkg_down", { style: "radio", bark: true });
    g.emit("halo:landed", { pkg: p, kind: K });
    this._markers();
    try { g.save(); } catch { /* not ready */ }
  }
  /** A plan's components: crates in rows beside the pod, one per caretaker trip; the blueprints wait for them. */
  _crates(p, b) {
    p.crates = [];
    const ids = (p.modules || []).filter((id) => { const m = b.api.module(id); return m && !m.built; });
    let k = 0;
    const away = Math.atan2((b.api.module(ids[0]) || p).z - p.z, (b.api.module(ids[0]) || p).x - p.x);
    for (const id of ids) {
      const m = b.api.module(id), n = cratesFor(m.type);
      for (let i = 0; i < n; i++, k++) {
        const row = Math.floor(k / 6), col = k % 6, a = away + Math.PI * 0.5 + (col - 2.5) * 0.32, r = 4.2 + row * 1.5;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        p.crates.push({ id: `${p.id}:${k}`, module: id, type: m.type, x, z, hx: x, hz: z, yaw: a, state: "pod", by: null });
      }
      b.api.setPlan(id, "delivered", { got: 0 });
    }
  }
  /** Every crate of every package (live records: caretakers.js moves them). */
  crates() { const out = []; for (const p of this.pk) for (const c of p.crates || []) out.push(c); return out; }
  _drawCrates(dt) {
    const g = this.game, b = getSystem("base"), seen = new Set();
    for (const p of this.pk) for (const c of p.crates || []) {
      const m = b && b.net ? b.net.modules.get(c.module) : null;
      const gone = !m || m.progress >= 1 || (c.state === "site" && m.progress > 0.25) || c.state === "used";
      if (gone) { if (c.state !== "used") c.state = "used"; continue; }
      seen.add(c.id);
      let o = this.crateMeshes.get(c.id);
      if (!o) { o = crateMesh(c.type); this.game.scene.add(o); this.crateMeshes.set(c.id, o); }
      const y = c.state === "carried" && c.y != null ? c.y : g.surface.height(c.x, c.z);
      o.position.set(c.x, y, c.z); o.rotation.y = c.yaw || 0;
      o.scale.setScalar(c.state === "carried" ? 0.78 : 1);
    }
    for (const [id, o] of this.crateMeshes) if (!seen.has(id)) { this.game.scene.remove(o); this.crateMeshes.delete(id); }
    void dt;
  }
  _puff(x, z) {
    const g = this.game, y = g.surface.height(x, z), grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xb98a63, transparent: true, opacity: 0.6, depthWrite: false }), geo = new THREE.SphereGeometry(1, 10, 6), list = [];
    for (let k = 0; k < 18; k++) { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; grp.add(m); list.push({ m, a: k / 18 * Math.PI * 2 + Math.random() * 0.2 }); }
    g.scene.add(grp);
    this.puffs.push({ grp, list, mat, geo, x, y, z, t: 0 });
  }
  _dust(dt) {
    for (const P of this.puffs.slice()) {
      P.t += dt;
      const k = Math.min(1, P.t / 4), r = 1.5 + 11 * Math.sqrt(k);
      for (const q of P.list) { q.m.position.set(P.x + Math.cos(q.a) * r, P.y + 0.5 + 1.4 * k, P.z + Math.sin(q.a) * r); q.m.scale.setScalar(1.2 + 3.5 * k); }
      P.mat.opacity = 0.6 * (1 - k);
      if (k >= 1) { this.game.scene.remove(P.grp); P.geo.dispose(); P.mat.dispose(); this.puffs.splice(this.puffs.indexOf(P), 1); }
    }
  }
  /** The map and the compass: the station, and each package on its way (with its countdown). */
  _markers() {
    const g = this.game, list = (g.extraMarkers || []).filter((m) => !String(m.id).startsWith("halo:"));
    if (this.enabled) {
      const f = g.focus || g.vehicle.p, h = Math.hypot(this.dir[0], this.dir[2]) || 1;
      list.push({ id: "halo:station", kind: "poi", x: f.x + this.dir[0] / h * 4000, z: f.z + this.dir[2] / h * 4000, name: `HALO-1 · ${Math.round(this.elevation || 68)}° up`, priority: 0.8 });
      for (const p of this.pk) {
        if (p.phase === "landed" && g.state.clock.sol - (p.landedSol || 0) > 3) continue;
        const left = Math.max(0, p.left), mm = Math.floor(left / 60), ss = Math.floor(left % 60);
        list.push({ id: "halo:" + p.id, kind: "beacon", x: p.x, z: p.z, name: p.phase === "landed" ? `Package ${p.id.replace("pkg_", "")} (down)` : p.phase === "final" ? `Package ${p.id.replace("pkg_", "")} · descending` : `Package ${p.id.replace("pkg_", "")} · ${mm}:${String(ss).padStart(2, "0")}`, priority: 2.6 });
      }
    }
    g.extraMarkers = list;
    // a tag over each drop point while it counts down
    const ui = g.hud.ui; if (!ui || !ui.tag) return;
    this._dropTags = this._dropTags || new Map();
    for (const p of this.pk) {
      const want = this.enabled && p.phase !== "landed";
      const t = this._dropTags.get(p.id);
      const left = Math.max(0, p.left), txt = p.phase === "final" ? "PKG · INBOUND" : `PKG ${p.id.replace("pkg_", "")} · T-${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
      if (want && !t) this._dropTags.set(p.id, ui.tag("halo-drop-" + p.id, { pos: { x: p.x, z: p.z }, text: txt, kind: "ground" }));
      else if (want && t) t.set(txt);
      else if (!want && t) { t.remove(); this._dropTags.delete(p.id); }
    }
  }

  /* ── the uplink: choose a kind and a drop point ── */
  _ui() {
    const el = this.el = document.createElement("section");
    el.id = "screen-halo"; el.className = "screen modal halo"; el.hidden = true; el.setAttribute("data-pad-closable", "");
    el.innerHTML = `<div class="card wide h-card">
      <div class="kt-head"><div><div class="eyebrow">HALO-1 · logistics uplink</div><h2>Care package</h2></div><p class="h-cc"></p></div>
      <div class="h-cols"><div class="h-mapbox"><canvas class="h-map" width="360" height="360" tabindex="0" aria-label="Drop point: click, or move it with the arrow keys or the D-pad"></canvas><p class="fine h-drop"></p></div>
        <div class="h-side"><div class="eyebrow">What to send</div><div class="h-kinds" role="radiogroup"></div><p class="fine h-why"></p></div></div>
      <div class="row"><button type="button" class="btn primary" data-h="go">Request the drop</button><button type="button" class="btn" data-pad-close data-h="close">Close</button></div></div>`;
    document.body.appendChild(el);
    this.cv = el.querySelector(".h-map");
    this.cv.addEventListener("click", (e) => { const r = this.cv.getBoundingClientRect(); this._setDrop(((e.clientX - r.left) / r.width - 0.5) * 2 * this.R + this.c.x, ((e.clientY - r.top) / r.height - 0.5) * 2 * this.R + this.c.z); });
    el.querySelector('[data-h="go"]').addEventListener("click", () => this._confirm());
    el.querySelector('[data-h="close"]').addEventListener("click", () => this.closeUplink());
    window.addEventListener("keydown", (e) => {
      if (!this.uplinkOpen) return;
      const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
      if (step && document.activeElement === this.cv) { this._setDrop(this.drop.x + step[0] * 30, this.drop.z + step[1] * 30); e.preventDefault(); }
      if (e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.closeUplink(); }
    }, true);
    const P = window.GeoIDPad;
    if (P) for (const [b, d] of [["up", [0, -1]], ["down", [0, 1]], ["left", [-1, 0]], ["right", [1, 0]]]) P.on(b, () => { if (this.uplinkOpen && document.activeElement === this.cv) this._setDrop(this.drop.x + d[0] * 40, this.drop.z + d[1] * 40); });
  }
  async openUplink(o = {}) {
    const g = this.game;
    if (!this.enabled) { g.hud.toast("HALO-1 does not answer<small>no logistics link</small>", 3); return false; }
    this._D = await loadStory();
    this.want = o;
    const f = g.focus || g.vehicle.p;
    this.c = { x: f.x, z: f.z }; this.R = 1200;
    const mk = o.drop && this.story ? this.story.place(o.drop.marker || o.drop.poi) : null;
    const drafts = this._drafts();
    this.kind = drafts.length ? "plan" : o.kind && !KINDS[o.kind]?.needsPlan ? o.kind : o.kind === "starter" ? "plan" : "supplies_package";
    const d0 = this.kind === "plan" && drafts.length ? this.planDrop(drafts) : mk ? { x: mk.x + 25, z: mk.z + 25 } : { x: f.x + 60, z: f.z - 40 };
    if (this.kind === "plan" && drafts.length) { let cx = 0, cz = 0; const b = getSystem("base"); for (const id of drafts) { const m = b.api.module(id); cx += m.x; cz += m.z; } this.c = { x: cx / drafts.length, z: cz / drafts.length }; this.R = 280; }
    this.uplinkOpen = true; this._resume = g.live; if (g.live) g.pause(true);
    const menu = document.getElementById("screen-menu"); this._fromMenu = menu && !menu.hidden; if (menu) menu.hidden = true;
    this.el.hidden = false;
    this._relief();
    this._setDrop(d0.x, d0.z);
    this._kinds();
    const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => P.focus.first(this.el), 60);
    if (this.story) this.story.notify("open_panel", { panel: "halo" });
    return true;
  }
  closeUplink() {
    if (!this.uplinkOpen) return;
    this.uplinkOpen = false; this.el.hidden = true;
    const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
    if (this._fromMenu) { const menu = document.getElementById("screen-menu"); if (menu) menu.hidden = false; }
    else if (this._resume && this.game.mode === "menu") this.game.pause(false);
  }
  _drafts() { const b = getSystem("base"); try { return b && b.api ? b.api.drafts().map((d) => d.id) : []; } catch { return []; } }
  _kinds() {
    const C = this.cc(), box = this.el.querySelector(".h-kinds"), want = this.want || {}, drafts = this._drafts();
    const list = Object.entries(KINDS).filter(([k, K]) => k === "plan" || (!K.needsPlan && (!K.story || k === want.kind || (this.story && this.story.hasItem && this.story.hasItem(k)))));
    const M = drafts.length ? planManifest(drafts.map((id) => getSystem("base").api.module(id).type)) : null;
    box.innerHTML = list.map(([k, K]) => {
      if (k === "plan") {
        const C2 = getSystem("caretakers"), fc = M && C2 && C2.api && C2.api.forecast ? C2.api.forecast(M) : null;
        const note = M ? `${M.modules} module${M.modules > 1 ? "s" : ""}, ${M.crates} crates · food ${M.supplies.food} kg, water ${M.supplies.water} L · ${fc ? esc(fc.text) : M.caretakers + " caretaker" + (M.caretakers > 1 ? "s" : "")}`
          : want.kind === "starter" ? "nothing planned yet: plan the outpost in build mode first (from the rover: B, or hold Cross)" : "nothing planned yet: lay out blueprints in build mode first";
        return `<label class="h-kind${k === this.kind ? " on" : ""}${M ? "" : " off"}"><input type="radio" name="h-kind" value="plan"${k === this.kind ? " checked" : ""}${M ? "" : " disabled"}><b>${esc(K.name)}</b><span>${note}</span><em>${M ? 20 + 10 * M.caretakers + " CC" : ""}</em></label>`;
      }
      return `<label class="h-kind${k === this.kind ? " on" : ""}"><input type="radio" name="h-kind" value="${k}"${k === this.kind ? " checked" : ""}><b>${esc(K.name)}${k === want.kind && want.unit ? " · " + esc(want.unit) : ""}</b><span>${esc(K.note)}</span><em>${K.cost} CC</em></label>`;
    }).join("");
    box.querySelectorAll("input").forEach((i) => i.addEventListener("change", () => { this.kind = i.value; if (i.value === "plan" && drafts.length) this._setDrop(...Object.values(this.planDrop(drafts))); this._kinds(); }));
    this.el.querySelector(".h-cc").textContent = `Contribution Credit ${C.free} free of ${C.capacity} · requests open ${C.open} / ${C.maxOpen}`;
    const go = this.el.querySelector('[data-h="go"]'); go.textContent = this.kind === "plan" ? "Send the plan" : "Request the drop";
    if (this.kind === "plan" && !M) go.disabled = true;
  }
  _setDrop(x, z) {
    this.drop = { x, z };
    const v = this.validDrop(x, z), g = this.game, f = g.focus || g.vehicle.p, d = Math.hypot(x - f.x, z - f.z);
    this.el.querySelector(".h-drop").textContent = `Drop point ${Math.round(d)} m from you · ${v.ok ? `level enough (${v.slope.toFixed(0)}°)` : v.reason}`;
    this.el.querySelector('[data-h="go"]').disabled = !v.ok;
    this._draw();
  }
  _relief() {
    const g = this.game, N = 90, img = new ImageData(N, N), S = g.surface, c = this.c, R = this.R, h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = S.height(c.x + (i / (N - 1) - 0.5) * 2 * R, c.z + (j / (N - 1) - 0.5) * 2 * R);
    const cs = getComputedStyle(document.documentElement), rgb = (n, d) => (cs.getPropertyValue(n) || d).split(",").map((x) => +x);
    const lo = rgb("--skin-vignette", "13, 2, 33"), hi = rgb("--skin-muted", "226, 214, 255");
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = h[j * N + Math.min(N - 1, i + 1)] - h[j * N + Math.max(0, i - 1)], b = h[Math.min(N - 1, j + 1) * N + i] - h[Math.max(0, j - 1) * N + i];
      const s = Math.max(0, Math.min(1, 0.55 - (a + b) * 0.02));
      const k = (j * N + i) * 4; for (let q = 0; q < 3; q++) img.data[k + q] = lo[q] + (hi[q] - lo[q]) * s * 0.55; img.data[k + 3] = 255;
    }
    const off = document.createElement("canvas"); off.width = off.height = N; off.getContext("2d").putImageData(img, 0, 0);
    this._bg = off;
  }
  _draw() {
    const cv = this.cv, c = cv.getContext("2d"), W = cv.width, g = this.game, R = this.R, cs = getComputedStyle(document.documentElement);
    const chrome = cs.getPropertyValue("--skin-chrome").trim() || "#ff2bd6", data = cs.getPropertyValue("--skin-data").trim() || "#00e5ff", ink = cs.getPropertyValue("--skin-ink").trim() || "#fff";
    c.imageSmoothingEnabled = true; c.drawImage(this._bg, 0, 0, W, W);
    const P = (x, z) => [((x - this.c.x) / (2 * R) + 0.5) * W, ((z - this.c.z) / (2 * R) + 0.5) * W];
    c.lineWidth = 1.5;
    const b = getSystem("base");
    try { for (const base of (b && b.api ? b.api.bases() : [])) { const [x, y] = P(base.x, base.z); c.strokeStyle = data; c.strokeRect(x - 5, y - 5, 10, 10); } } catch { /* none */ }
    for (const p of this.pk) { const [x, y] = P(p.x, p.z); c.fillStyle = data; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
    try { for (const m of (b && b.api ? b.api.modules() : [])) { if (!m.plan) continue; const [x, y] = P(m.x, m.z); c.strokeStyle = m.plan === "draft" ? "#5fd4ff" : data; c.setLineDash([3, 2]); c.strokeRect(x - 3, y - 3, 6, 6); c.setLineDash([]); } } catch { /* none */ }
    const f = g.focus || g.vehicle.p, [fx, fy] = P(f.x, f.z);
    c.fillStyle = ink; c.beginPath(); c.arc(fx, fy, 4, 0, 7); c.fill();
    const [dx, dy] = P(this.drop.x, this.drop.z);
    c.strokeStyle = chrome; c.lineWidth = 2; c.beginPath(); c.arc(dx, dy, 9, 0, 7); c.moveTo(dx - 15, dy); c.lineTo(dx + 15, dy); c.moveTo(dx, dy - 15); c.lineTo(dx, dy + 15); c.stroke();
    c.fillStyle = ink; c.font = "11px sans-serif"; c.fillText("N", W / 2 - 3, 12); c.fillText(`${(R * 2 / 1000).toFixed(1)} km`, 6, W - 6);
  }
  _confirm() {
    const w = this.want || {};
    if (this.kind === "plan") { const r = this.requestPlan({ x: this.drop.x, z: this.drop.z, mission: w.mission }); if (r.ok) this.closeUplink(); else this._kinds(); return r; }
    const r = this.request(this.kind, { x: this.drop.x, z: this.drop.z, unit: this.kind === w.kind ? w.unit : null, item: this.kind === w.kind ? w.item : null, extra: w.extra, story: !!w.story, mission: w.mission, id: this.kind === w.kind ? w.id : undefined });
    if (r.ok) this.closeUplink(); else this._kinds();
    return r;
  }

  toJSON() { return { v: 1, seq: this.seq, pk: this.pk.map((p) => Object.assign({}, p, { ft: undefined })) }; }
  fromJSON(s) {
    for (const m of this.meshes.values()) this.game.scene.remove(m);
    this.meshes.clear();
    for (const o of this.crateMeshes.values()) this.game.scene.remove(o);
    this.crateMeshes.clear();
    this.pk = (s && s.pk) || []; this.seq = (s && s.seq) || 0;
    for (const p of this.pk) {
      if (p.phase === "final") { p.phase = "descent"; p.left = 2; }                            // saved in the last stretch: it comes down again on load
      for (const c of p.crates || []) if (c.state === "carried") { c.state = "pod"; c.x = c.hx; c.z = c.hz; c.by = null; c.y = null; }   // a crate in someone's arms goes back on the pile
      if (p.phase === "landed") { const m = podMesh(); m.position.set(p.x, this.game.surface.height(p.x, p.z), p.z); for (const n of ["pod-trail", "pod-sheath", "pod-chute", "pod-retro"]) m.getObjectByName(n).visible = false; this.game.scene.add(m); this.meshes.set(p.id, m); }
      if (p.phase === "descent" && p.kind === "plan") { const b = getSystem("base"); for (const id of p.modules || []) { const mm = b && b.api && b.api.module(id); if (mm && !mm.plan) b.api.setPlan(id, "ordered", { pkg: p.id }); } }
    }
    this._markers();
  }
}
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

let H = null;
const sys = {
  id: "halo", order: 84,
  get halo() { return H; },
  api: {
    get enabled() { return !!(H && H.enabled); },
    setEnabled: (on) => { if (H) { H.enabled = !!on; H._markers(); } },
    request: (kind, o) => (H ? H.request(kind, o) : { ok: false, reason: "no HALO" }),
    requestPlan: (o) => (H ? H.requestPlan(o) : { ok: false, reason: "no HALO" }),
    planDrop: (ids) => (H ? H.planDrop(ids) : null),
    crates: () => (H ? H.crates() : []),
    linked: () => !!(H && H.linked()),
    packages: () => (H ? H.pk.slice() : []),
    get: (id) => (H ? H.get(id) : null),
    cc: () => (H ? H.cc() : null),
    kinds: KINDS,
    stationDir: () => (H ? H.dir.slice() : null),
    openUplink: (o) => H && H.openUplink(o),
    closeUplink: () => H && H.closeUplink(),
    confirm: () => H && H._confirm(),
    setDrop: (x, z) => H && H._setDrop(x, z),
    advance: (s) => H && H.advance(s),
    landNow: (id) => H && H.landNow(id),
    get uplinkOpen() { return !!(H && H.uplinkOpen); },
  },
  async init(game) { H = new Halo(game); H.setSite(); loadStory().then((D) => { H._D = D; }).catch(() => {}); },
  load(game, saved) { if (H) { H.setSite(); H.fromJSON(saved); } },
  save() { return H ? H.toJSON() : undefined; },
  tick(game, dt, ctx) { if (H && H.enabled) H.tick(dt, ctx.simDt); },
  frame(game, dt) { if (H) H.frame(dt); },
};
registerSystem(sys);
