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
 *   A REQUEST (the uplink: U on the keyboard, "HALO-1 uplink" in the pause menu, or the story asking)
 *   picks a kind and a drop point on a relief map of the ground around you (click, or the D-pad and
 *   Cross). Materials are unlimited (HALO-1's stock); Contribution Credit is the only limit: open
 *   requests and the footprint of every base draw against a capacity of 400 + lifetime XP, and the
 *   progression tier caps how many requests may be open at once (progress.api.limits()).
 *
 *   THE DESCENT takes 20 to 30 game minutes (KEEPER says which: KEEPER.bark.descent_20..30), counted down
 *   on the map, the compass and a tag at the drop point, with KEEPER at ten, five and one minute. The
 *   last stretch is played in real time so it can be watched: a fiery entry streak from high in the
 *   east, a parachute, retro flare, a thump and a ring of dust. The pod stays where it lands, its
 *   beacon blinking amber. Every package brings food, water and components, and construction units
 *   (a named founder when the story says so; a generated caretaker while the act's population allows).
 *
 *   getSystem("halo").api = { request(kind, {x, z, unit, item, story}), packages(), get(id), cc(), kinds,
 *     stationDir(), openUplink({kind, unit, drop}), closeUplink(), advance(simSeconds), landNow(id), enabled }
 *   events on the game: "halo:request" {pkg}, "halo:countdown" {id, minutes}, "halo:final" {id},
 *     "halo:landed" {pkg}, "halo:denied" {reason}
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { loadStory, speech, esc, ensureStoryStyles } from "./storydata.js?v=b8cfe8e-efa5b7b7";

export const STATION = { lonDeg: 77.0, radiusKm: 20428, marsKm: 3389.5 };
const D2R = Math.PI / 180;
const FINAL_S = 18;                 // the last stretch, in real seconds: entry streak, chute, retro
/** What can be asked for. cost: Contribution Credit held while the request is open. */
export const KINDS = {
  starter: { name: "Starter package", cost: 180, note: "rations, water, outpost components and one construction unit", food: 40, water: 150, materials: 400, units: 1, story: true },
  supplies_package: { name: "Supplies", cost: 20, note: "rations and water", food: 40, water: 200 },
  components_small: { name: "Components", cost: 40, note: "base components (materials)", materials: 250 },
  construction_unit: { name: "Construction unit", cost: 120, note: "one caretaker unit, with its own supplies", units: 1, food: 10, water: 40, materials: 60 },
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

/* ── the system ─────────────────────────────────────────────────────────── */

class Halo {
  constructor(game) {
    this.game = game; this.pk = []; this.seq = 0; this.meshes = new Map(); this.puffs = []; this.enabled = false;
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
    const id = o.id || "pkg_" + String(++this.seq).padStart(3, "0");
    const minutes = o.minutes || 20 + Math.floor(Math.random() * 11);
    const pkg = { id, kind, unit: o.unit || null, item: o.item || K.item || null, extra: o.extra || null, x: o.x, z: o.z, cost, minutes, total: minutes * 60, left: minutes * 60,
      phase: "descent", story: !!o.story, mission: o.mission || null, said: {}, sol: g.state.clock.sol };
    this.pk.push(pkg);
    speech(g).say("KEEPER.bark.descent_" + minutes, { style: "radio" });
    g.emit("halo:request", { pkg });
    this._markers();
    return { ok: true, pkg };
  }
  _deny(reason, line = "KEEPER.bark.pkg_denied") {
    speech(this.game).say(line, { style: "radio" });
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
    for (const p of this.pk) { if (p.phase !== "landed") continue; const m = this.meshes.get(p.id); const l = m && m.getObjectByName("pod-lamp"); if (l) l.visible = (now % 1600) < 350; }
    this._dust(dt || 0);
  }
  _land(p, m) {
    const g = this.game;
    p.phase = "landed"; p.landedSol = g.state.clock.sol;
    m.position.set(p.x, g.surface.height(p.x, p.z), p.z); m.scale.setScalar(1);
    for (const n of ["pod-trail", "pod-sheath", "pod-chute", "pod-retro"]) { const o = m.getObjectByName(n); if (o) o.visible = false; }
    this._puff(p.x, p.z);
    try { const A = getSystem("audio"); if (A && A.snd) A.snd.fx("impact", "world"); } catch { /* no sound */ }
    // the supplies go to the nearest base's stores; components to the build stock
    const K = kindOf(p.kind), b = getSystem("base");
    try {
      if (b && b.api) {
        if (K.materials) b.api.addMaterials(K.materials);
        const net = b.api.net, bases = net ? [...net.bases.values()] : [];
        const base = bases.sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
        if (base) { base.food = (base.food || 0) + (K.food || 0); base.water = (base.water || 0) + (K.water || 0); }
      }
    } catch (e) { console.warn("[halo] stores", e); }
    speech(g).say(K.units ? "KEEPER.bark.pkg_unit" : "KEEPER.bark.pkg_down", { style: "radio", bark: true });
    g.emit("halo:landed", { pkg: p, kind: K });
    this._markers();
    try { g.save(); } catch { /* not ready */ }
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
    const d0 = mk ? { x: mk.x + 25, z: mk.z + 25 } : { x: f.x + 60, z: f.z - 40 };
    this.kind = o.kind || "supplies_package";
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
  _kinds() {
    const C = this.cc(), box = this.el.querySelector(".h-kinds"), want = this.want || {};
    const list = Object.entries(KINDS).filter(([k, K]) => !K.story || k === want.kind || (this.story && this.story.hasItem && this.story.hasItem(k)));
    box.innerHTML = list.map(([k, K]) => `<label class="h-kind${k === this.kind ? " on" : ""}"><input type="radio" name="h-kind" value="${k}"${k === this.kind ? " checked" : ""}><b>${esc(K.name)}${k === want.kind && want.unit ? " · " + esc(want.unit) : ""}</b><span>${esc(K.note)}</span><em>${K.cost} CC</em></label>`).join("");
    box.querySelectorAll("input").forEach((i) => i.addEventListener("change", () => { this.kind = i.value; this._kinds(); }));
    this.el.querySelector(".h-cc").textContent = `Contribution Credit ${C.free} free of ${C.capacity} · requests open ${C.open} / ${C.maxOpen}`;
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
    const f = g.focus || g.vehicle.p, [fx, fy] = P(f.x, f.z);
    c.fillStyle = ink; c.beginPath(); c.arc(fx, fy, 4, 0, 7); c.fill();
    const [dx, dy] = P(this.drop.x, this.drop.z);
    c.strokeStyle = chrome; c.lineWidth = 2; c.beginPath(); c.arc(dx, dy, 9, 0, 7); c.moveTo(dx - 15, dy); c.lineTo(dx + 15, dy); c.moveTo(dx, dy - 15); c.lineTo(dx, dy + 15); c.stroke();
    c.fillStyle = ink; c.font = "11px sans-serif"; c.fillText("N", W / 2 - 3, 12); c.fillText(`${(R * 2 / 1000).toFixed(1)} km`, 6, W - 6);
  }
  _confirm() {
    const w = this.want || {}, r = this.request(this.kind, { x: this.drop.x, z: this.drop.z, unit: this.kind === w.kind ? w.unit : null, item: this.kind === w.kind ? w.item : null, extra: w.extra, story: !!w.story, mission: w.mission, id: this.kind === w.kind ? w.id : undefined });
    if (r.ok) this.closeUplink(); else this._kinds();
    return r;
  }

  toJSON() { return { v: 1, seq: this.seq, pk: this.pk.map((p) => Object.assign({}, p, { ft: undefined })) }; }
  fromJSON(s) {
    for (const m of this.meshes.values()) this.game.scene.remove(m);
    this.meshes.clear();
    this.pk = (s && s.pk) || []; this.seq = (s && s.seq) || 0;
    for (const p of this.pk) {
      if (p.phase === "final") { p.phase = "landed"; p.landedSol = this.game.state.clock.sol; }
      if (p.phase === "landed") { const m = podMesh(); m.position.set(p.x, this.game.surface.height(p.x, p.z), p.z); for (const n of ["pod-trail", "pod-sheath", "pod-chute", "pod-retro"]) m.getObjectByName(n).visible = false; this.game.scene.add(m); this.meshes.set(p.id, m); }
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
