/**
 * THE CINEMATIC DIRECTOR: cutscenes as films. Each cutscene may have a cinematic track,
 * story/cinematics/<id>.json; cutscene.js plays the beats (lines, titles, choices, fades, sets) exactly as
 * before and tells the director every beat and every line as it happens (cue), and the director shoots it:
 * shots with camera keys on splines, lenses and depth of field, handheld and shake, cuts and blends; actors
 * (the rigged characters, game/charrig.js, through game/actors.js) placed, walked, posed and turned on cues;
 * lights; a grade per shot; procedural sets (game/cinesets.js) for the interiors and the memories.
 * A cutscene with no cinematic plays the old way (camera intents, line-art stills).
 *
 * SYNC. The picture keys on the dialogue: a shot or a track event says `"at": "C03.02"` (when that line
 * starts), `"C03.02/end"` (when it has been heard), `"C03.02+1.5"` (seconds after), `"beat:7"` (the 8th beat),
 * `"start"`. Lines take their real voice durations (assets/voice/index.json), so the schedule is predicted at
 * the start (for the length of each shot, which its camera move fills) and re-anchored on every cue: if a
 * voice runs long the shot holds its last frame, never cuts away early; a skip ends everything at once.
 *
 * THE FILE (all fields optional but `shots`):
 *   { "id": "C03",
 *     "stage": { "at": "pod" | "player" | "lander" | "home" | "rover" | "poi:<id>" | "unit:<CALLSIGN>",
 *                "face": "<anchor>" | <deg>, "away": true (turn round: facing away from it), "offset": [x, z] },  the frame everything outdoors is placed in:
 *                x right, y up (above the ground there), z forward (toward `face`), metres
 *     "world": { "hour": 6.8, "tau": 0.4, "hideAvatar": true, "hideUnits": ["ANVIL"] | "all", "focus": true, "keepRover": false, "clear": 14 },
 *     "sets": [ { "id": "cab", "kind": "<set or dressing>", "at": [x, y, z] | "anchor": "<anchor>", "yaw": deg, ...params } ],
 *     "actors": [ { "id": "p1", "kind": "pioneer" | "caretaker" | "recall" | "human" | "child" | "kestrel" | "covenant",
 *                  "look": "ANVIL" | { suit, trim, visor, callsign, hair, material, helmet, props }, "set": "<set id>",
 *                  "at": [x, y, z], "yaw": deg, "clip": "idle", "hidden": true, "props": [ { "prop": "torch", "socket": "sk_grip_R" } ],
 *                  "kit": ["broom"] (replaces the role's kit), "ik": false (no foot planting: sitting on a hull, a roof) } ],
 *     "lights": [ { "id": "rim", "type": "point" | "spot" | "dir", "at": [x, y, z], "target": [x, y, z], "color": "#ffb070", "intensity": 20, "dist": 12, "set": "<id>",
 *                   "night": 0..1 (that much of it fades out in daylight: lamps outdoors), "glow": size (the lamp itself, seen) } ],
 *     "shots": [ { "at": "<cue>", "name": "...", "set": "<interior set id>" | null, "dur": s,
 *                  "cam": { "keys": [ { "t": 0..1, "pos": P, "look": P, "lens": mm, "roll": deg } ], "ease": "inout" | "linear" | "in" | "out",
 *                           "lens": mm, "handheld": 0..1, "shake": 0..1, "blend": s },
 *                  "dof": { "focus": P | m, "fstop": 2.8, "boost": 1 }, "grade": "<preset>" | { "base": "<preset>", ...overrides },
 *                  "hour": 18.5 } ],
 *     "track": [ { "at": "<cue>", "actor": "<id>", "play": "clip", "fade": 0.3, "speed": 1, "hold": true,
 *                  "walk": P | [P, P...], "speed": 1.3, "gait": "walk", "then": "clip",
 *                  "move": P, "dur": s (a straight slide, any height: down a line, onto a roof),
 *                  "face": P | deg, "lookAt": P | "<actor>" | null, "weight": 1, "pos": P, "yaw": deg, "visible": bool,
 *                  "kind": "kestrel", "helmet": false, "attach": { "prop": "torch", "socket": "sk_grip_R", "lit": true }, "detach": "torch" },
 *                { "at": ..., "fx": "dust" | "smoke" | "sparks" | "steam" | "glare", "where": P, ...params },
 *                { "at": ..., "light": "<id>", "intensity": x, "dur": s }, { "at": ..., "setp": "<set id>", "key": "state", "value": "landed" },
 *                { "at": ..., "shake": 0.8, "dur": 1.2 }, { "at": ..., "hide": "<world object name>" }, { "at": ..., "show": "<name>" },
 *                { "at": ..., "anim": { "obj": "pod-hatch", "prop": "rotation.y", "to": -1.8, "dur": 0.3 } } ],
 *     "handoff": [ { "actor": "anvil", "unit": "ANVIL" } ]  (where the film leaves a caretaker, the game picks him up) }
 *   P (a point): [x, y, z] in the stage (outdoors: y above the ground there) or in the shot's set; { "a": "<anchor>", "o": [x, y, z] };
 *     { "actor": "<id>", "bone": "head", "o": [x, y, z] } (follows them); "actor:<id>" (their head); { "sky": "halo" | [x, y, z] } (a look direction);
 *     { "obj": "story-lander", "o": [x, y, z] } (in the frame of something already in the world: the tipped lander's hull)
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { loadStory, readTime } from "./storydata.js?v=6d37c9c-9b39e129";
import { createActor, lookFor, makeKit } from "./actors.js?v=6d37c9c-9b39e129";
import { buildSet, makeProp, makeFx } from "./cinesets.js?v=6d37c9c-9b39e129";
import { loadCharacters } from "./charrig.js?v=6d37c9c-9b39e129";
import { dressAstronaut } from "./cosmetics.js?v=6d37c9c-9b39e129";

const STAMP = new URL(import.meta.url).searchParams.get("v") || "";
let _glowTex = null;
const GLOWTEX = () => { if (_glowTex) return _glowTex; const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.4)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); _glowTex = new THREE.CanvasTexture(c); return _glowTex; };
const CIN_URL = new URL("../story/cinematics/", import.meta.url).href;
const D2R = Math.PI / 180;
const PACE = 0.85;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = { inout: (k) => k * k * (3 - 2 * k), linear: (k) => k, in: (k) => k * k, out: (k) => 1 - (1 - k) * (1 - k), hold: () => 0, slow: (k) => 1 - Math.pow(1 - k, 3) };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

/** Grades: Mars light by hour, interiors, the memory look, the archive tape. */
export const GRADES = {
  neutral: { grain: 0.25, vignette: 0.22 },
  mars_day: { temp: 0.1, sat: 1.05, con: 1.16, grain: 0.3, vignette: 0.3, lift: [-0.014, -0.016, -0.012], gain: [1.04, 1.0, 0.95] },
  mars_dawn: { temp: -0.18, sat: 0.9, con: 1.1, grain: 0.35, vignette: 0.3, lift: [0, 0.006, 0.022], gain: [1.0, 0.99, 1.02] },
  mars_dusk: { temp: 0.3, sat: 1.08, con: 1.08, grain: 0.35, vignette: 0.32, lift: [0.02, 0.006, 0.03], bloom: 1.6 },
  mars_night: { exposure: 1.35, temp: -0.28, sat: 0.72, con: 1.1, grain: 0.5, vignette: 0.38, lift: [0.006, 0.01, 0.028], bloom: 2.4 },
  storm: { temp: 0.25, sat: 0.7, con: 0.95, grain: 0.45, vignette: 0.35, lift: [0.04, 0.025, 0.01] },
  interior_warm: { exposureAbs: 1.02, temp: 0.22, sat: 0.95, con: 1.08, grain: 0.4, vignette: 0.32, bloom: 1.6 },
  interior_cold: { exposureAbs: 0.92, temp: -0.22, sat: 0.9, con: 1.1, grain: 0.4, vignette: 0.32, bloom: 1.6 },
  interior_night: { exposureAbs: 1.5, temp: -0.12, sat: 0.85, con: 1.16, grain: 0.55, vignette: 0.42, bloom: 2.0, lift: [0, 0.004, 0.012] },
  plasma: { exposureAbs: 1.05, temp: 0.28, sat: 1.0, con: 1.12, grain: 0.4, vignette: 0.4, bloom: 2.6, ca: 0.0012 },
  tube: { exposureAbs: 1.1, temp: 0.18, sat: 0.85, con: 1.18, grain: 0.5, vignette: 0.45, bloom: 2.2, lift: [0.006, 0.003, 0] },
  memory: { exposureAbs: 1.3, memory: 1, temp: 0.4, sat: 0.82, con: 0.94, lift: [0.035, 0.018, 0.004], grain: 0.25, vignette: 0.5, bloom: 2.6 },
  archive: { exposureAbs: 1.0, vhs: 1, sat: 0.72, con: 1.05, grain: 0.6, vignette: 0.4, temp: 0.12 },
  advert: { exposureAbs: 1.0, vhs: 0.75, sat: 1.25, con: 1.05, grain: 0.5, vignette: 0.35, temp: 0.2, bloom: 2.4 },
  dome: { exposureAbs: 1.0, temp: 0.05, sat: 1.04, con: 1.04, grain: 0.25, vignette: 0.22, bloom: 1.4 },
  bay: { exposureAbs: 0.9, temp: -0.08, sat: 0.8, con: 1.0, grain: 0.3, vignette: 0.3, bloom: 1.8, lift: [0.02, 0.02, 0.025] },
  burnt: { sat: 0.35, con: 1.25, temp: -0.2, ca: 0.0025, grain: 0.6, vignette: 0.45 },
  polar: { temp: -0.08, sat: 0.95, con: 1.1, grain: 0.3, vignette: 0.3, bloom: 1.8, gain: [1.0, 1.0, 1.03] },
};

/* ── predicting the schedule from the beats and the voices ───────────────────── */
function beatSeconds(b, D) {
  if (b.parallel) return 0;
  const hint = b.duration_hint || 0;
  switch (b.kind) {
    case "line": { const v = D && b.line ? D.voice(b.line) : null; return Math.max(v && v.dur ? v.dur + 0.45 : 0, readTime(b.text || "")) + 0.15; }
    case "direction": return Math.max(1.6, hint * PACE);
    case "title": return b.style === "act" ? Math.max(2.5, hint || 3) + 0.2 : Math.max(1.2, hint || 1.5);
    case "glitch": { const s = Math.max(0.15, hint || 0.3); return s > 0.3 ? s : 0; }
    case "fade": return hint || 1;
    case "choice": return 4;
    default: return 0;
  }
}
/** cue name -> predicted seconds from the start. */
export function predict(cs, D) {
  const out = new Map([["start", 0]]);
  let t = 0;
  const run = (beats, prefix) => {
    beats.forEach((b, i) => {
      out.set(prefix + i, t);
      if (b.kind === "line" && b.line) out.set(b.line, t);
      const s = beatSeconds(b, D);
      if (b.kind === "line" && b.line) out.set(b.line + "/end", t + s - 0.15);
      if (b.kind === "choice") {
        const t0 = t;
        for (const o of b.options || []) { t = t0 + 1.2; run(o.then || [], `opt:${b.choice_id}:${o.id}:`); }
        t = t0 + s;
      } else t += s;
    });
  };
  run(cs.beats || [], "beat:");
  out.set("end", t);
  return out;
}

/* ── the director ──────────────────────────────────────────────────────────── */
export class Director {
  constructor(game, story) {
    this.game = game; this.story = story; this.cache = new Map(); this.on = false; this.warnings = [];
  }
  get active() { return this.on; }

  async load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let spec = null;
    try {
      const r = await fetch(CIN_URL + id + ".json" + (STAMP ? "?v=" + encodeURIComponent(STAMP) : ""), { cache: "no-cache" });
      if (r.ok) spec = await r.json();
    } catch { spec = null; }
    this.cache.set(id, spec);
    return spec;
  }

  /* ── anchors and points ── */
  anchor(name) {
    const g = this.game, st = this.story, S = g.surface;
    const n = String(name || "player");
    const out = (x, z, yaw = 0) => ({ x, z, y: S.height(x, z), yaw });
    const pp = st.playerPos();
    const av = getSystem("avatar"), heading = av && av.api ? av.api.heading * D2R : 0;
    if (n === "player" || n === "here") return out(pp.x, pp.z, heading);
    if (n === "rover") { const v = g.vehicle; return out(v.p.x, v.p.z, (v.t.heading || 0) * D2R); }
    if (n === "lander" && st.S.lander) return out(st.S.lander.x, st.S.lander.z, st.S.lander.yaw || 0);
    if (n === "home") { const h = st.home(); return out(h.x, h.z, 0); }
    if (n === "pod") {
      const H = getSystem("halo"), list = H && H.api ? H.api.packages() : [], pk = list.filter((x) => x.phase === "landed" || x.phase === "final").slice(-1)[0] || list[list.length - 1];
      if (pk) { const m = H.halo && H.halo.meshes.get(pk.id); return m ? out(m.position.x, m.position.z, 0) : out(pk.x, pk.z, 0); }
      const L = st.S.lander; if (L) return out(L.x + 120, L.z + 300, 0);
    }
    if (n.startsWith("unit:")) { const C = getSystem("caretakers"), u = C && C.api ? C.api.get(n.slice(5)) : null; if (u) return out(u.x, u.z, u.yaw || 0); }
    if (n.startsWith("poi:")) { const q = st.place(n.slice(4)); if (q) return out(q.x, q.z, 0); }
    if (this.anchors && this.anchors[n]) return this.anchors[n];
    return out(pp.x, pp.z, heading);
  }
  /** stage (x right, y up above the ground, z forward) -> world */
  stagePoint(p, o = {}) {
    const F = o.frame || this.stage, yaw = F.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const x = F.x + c * p[0] + Math.sin(yaw) * p[2], z = F.z + s * p[0] - Math.cos(yaw) * p[2];
    const gy = o.abs ? F.y : this.game.surface.height(x, z);
    return (o.out || new THREE.Vector3()).set(x, gy + (p[1] || 0), z);
  }
  /** set-local -> that set's world (its own scene: the set's root frame) */
  setPoint(set, p, out = new THREE.Vector3()) {
    out.set(p[0], p[1] || 0, p[2]);
    if (set.group) set.group.localToWorld(out);
    else if (set.root) set.root.localToWorld(out);
    return out;
  }
  /** A point spec -> world position (in whatever scene the shot or the actor is in). */
  point(P, ctxSet = null, out = new THREE.Vector3()) {
    if (P == null) return null;
    if (typeof P === "string") {
      if (P.startsWith("actor:")) return this.point({ actor: P.slice(6), bone: "head" }, ctxSet, out);
      const a = this.anchor(P); return out.set(a.x, a.y + 1.4, a.z);
    }
    if (Array.isArray(P)) {
      const set = ctxSet && this.sets[ctxSet];
      if (set && set.interior) return this.setPoint(set, P, out);
      return this.stagePoint(P, { out });
    }
    if (P.actor) {
      const A = this.actors[P.actor]; if (!A) return out.set(0, 0, 0);
      const ch = A.a.character, b = ch && ch.bones.get(P.bone || "head");
      if (b) { A.a.object3d.updateMatrixWorld(true); b.getWorldPosition(out); } else out.copy(A.a.object3d.position).y += 1.5;
      if (P.o) out.add(_w.set(P.o[0], P.o[1], P.o[2]).applyAxisAngle(_v.set(0, 1, 0), A.a.object3d.rotation.y));
      return out;
    }
    if (P.a) { const a = this.anchor(P.a); return this.stagePoint(P.o || [0, 0, 0], { frame: Object.assign({}, a, { yaw: P.yaw != null ? P.yaw * D2R : this.stage.yaw }), out }); }
    if (P.sky) {
      const cam = this.game.camera.position;
      let d = Array.isArray(P.sky) ? _v.set(P.sky[0], P.sky[1], P.sky[2]) : P.sky === "sun" && this.game.sky ? _v.copy(this.game.sky.sunDir) : null;
      if (!d) { const H = getSystem("halo"), s = H && H.api && H.api.stationDir ? H.api.stationDir() : [0.2, 0.8, -0.5]; d = _v.set(s[0], s[1], s[2]); }
      return out.copy(cam).addScaledVector(d.normalize(), 1000);
    }
    if (P.obj) {           // an object already in the world (the lander, a pod), in its own frame
      let o = null, bd = 1e9;
      this.game.scene.traverse((x) => { if (x.name === P.obj) { x.getWorldPosition(_w); const d = Math.hypot(_w.x - this.stage.x, _w.z - this.stage.z); if (d < bd) { bd = d; o = x; } } });
      if (!o) return out.set(this.stage.x, this.stage.y, this.stage.z);
      o.updateMatrixWorld(true);
      return o.localToWorld(out.set(...(P.o || [0, 0, 0])));
    }
    if (P.set) { const set = this.sets[P.set]; return set ? this.setPoint(set, P.o || [0, 0, 0], out) : out.set(0, 0, 0); }
    return out.set(0, 0, 0);
  }

  /* ── begin and end ── */
  async begin(id, spec, cs) {
    const g = this.game, st = this.story;
    this.end();
    this.on = true; this.id = id; this.spec = spec; this.t = 0; this.cs = cs;
    this.D = await loadStory().catch(() => null);
    this.sched = predict(cs, this.D);
    this.hit = new Map(); this.pending = []; this.shot = null; this.prev = null; this.fx = []; this.tweens = []; this.shakeK = 0; this.shakeT = 0;
    this.saved = { fov: g.camera.fov, near: g.camera.near, view: g.view || null, tod: g.state.clock.tod, tau: g.state.weather.tau, focus: g.focus };
    this.sets = {}; this.actors = {}; this.lights = {}; this.hidden = [];
    const W = spec.world || {};
    // the stage
    const sa = this.anchor((spec.stage && spec.stage.at) || "player");
    let yaw = sa.yaw;
    if (spec.stage && spec.stage.face != null) {
      if (typeof spec.stage.face === "number") yaw = spec.stage.face * D2R;
      else { const fa = this.anchor(spec.stage.face); if (Math.hypot(fa.x - sa.x, fa.z - sa.z) > 0.5) yaw = Math.atan2(fa.x - sa.x, -(fa.z - sa.z)); }
      if (spec.stage.away) yaw += Math.PI;
    }
    this.stage = { x: sa.x, z: sa.z, y: sa.y, yaw };
    if (spec.stage && spec.stage.offset) { const o = this.stagePoint([spec.stage.offset[0], 0, spec.stage.offset[1]]); this.stage.x = o.x; this.stage.z = o.z; this.stage.y = o.y; }
    this.anchors = {};
    if (W.hour != null) g.setTimeOfDay(W.hour);
    if (W.tau != null) g.setTau(W.tau);
    if (W.focus !== false) g.focus = { x: this.stage.x, z: this.stage.z };
    // who is in the world already and must not be twice
    const av = getSystem("avatar");
    if (W.hideAvatar !== false && av && av.avatar && av.avatar.group.visible) { av.avatar.group.visible = false; this.hidden.push(av.avatar.group); }
    const C = getSystem("caretakers");
    if (W.hideUnits && C && C.api) for (const u of C.api.list()) if ((W.hideUnits === "all" || W.hideUnits.includes(u.callsign)) && u.mesh && u.mesh.visible) { u.mesh.visible = false; this.hidden.push(u.mesh); }
    // the real rover parks itself in the middle of the set more often than not: out of shot unless the scene keeps it
    const rv = g.model && g.model.group;
    if (rv && rv.visible && W.keepRover !== true && (W.hideRover || Math.hypot(rv.position.x - this.stage.x, rv.position.z - this.stage.z) < (W.clear || 14))) { rv.visible = false; this.hidden.push(rv); }
    // gameplay markers (the POI beacons and their sky beams) are interface, not the world: out of every film
    g.scene.traverse((o) => { if (o.userData && o.userData.beam && o.visible && W.keepMarkers !== true) { o.visible = false; this.hidden.push(o); } });
    for (const name of W.hide || []) { const pre = name.endsWith("*") ? name.slice(0, -1) : null; g.scene.traverse((o) => { if ((pre != null ? o.name.startsWith(pre) : o.name === name) && o.visible) { o.visible = false; this.hidden.push(o); } }); }
    // sets
    const lib = await loadCharacters().catch(() => null);
    for (const s0 of spec.sets || []) {
      const s = Object.assign({}, s0);
      if (s.names === "@names") s.names = (st._namesUsed ? st._namesUsed() : []);
      const set = buildSet(s.kind, Object.assign({ helmet: lib && lib.props.helmet }, s, s.params || {}), { director: this });
      if (!set) continue;
      this.sets[s.id || s.kind] = set;
      if (!set.interior) {
        set.group.name = "set:" + (s.id || s.kind);
        const at = s.anchor ? (() => { const a = this.anchor(s.anchor); return new THREE.Vector3(a.x, a.y, a.z); })() : this.stagePoint(s.at || [0, 0, 0], { abs: !!s.abs });
        set.group.position.copy(at); if (s.dy) set.group.position.y += s.dy;
        set.group.rotation.y = -(this.stage.yaw + (s.yaw || 0) * D2R);
        if (s.scale) set.group.scale.setScalar(s.scale);
        g.scene.add(set.group);
      }
    }
    // lights
    for (const L of spec.lights || []) this._light(L);
    // actors
    for (const a of spec.actors || []) this._actor(a);
    await Promise.all(Object.values(this.actors).map((A) => A.a.ready));
    for (const A of Object.values(this.actors)) this._dress(A);
    this.cue("start");
    return true;
  }
  _light(L) {
    let o;
    const col = new THREE.Color(L.color || "#ffffff");
    if (L.type === "spot") { o = new THREE.SpotLight(col, L.intensity ?? 20, L.dist ?? 0, (L.angle ?? 30) * D2R, L.pen ?? 0.5, 2); }
    else if (L.type === "dir") o = new THREE.DirectionalLight(col, L.intensity ?? 2);
    else o = new THREE.PointLight(col, L.intensity ?? 10, L.dist ?? 0, 2);
    const set = L.set && this.sets[L.set], parent = set ? set.interior ? set.scene : set.group : this.game.scene;
    parent.add(o);
    const pos = set && set.interior ? new THREE.Vector3(...L.at) : this.point(L.at || [0, 3, 0]);
    o.position.copy(pos);
    if (o.target) { parent.add(o.target); o.target.position.copy(set && set.interior ? new THREE.Vector3(...(L.target || [0, 0, 0])) : this.point(L.target || [0, 0, 0])); }
    if (L.glow) {         // the lamp itself, seen: a soft sprite that dims with the light
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOWTEX(), color: new THREE.Color(L.color || "#ffffff").multiplyScalar(L.glowK || 4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(L.glow); o.add(sp); o.userData.sprite = sp;
    }
    o.userData.base = o.intensity;
    // "night": a lamp that only matters in the dark (it fades out as the Sun climbs)
    if (L.night) o.userData.night = L.night;
    this.lights[L.id || "light" + Object.keys(this.lights).length] = o;
    return o;
  }
  _actor(spec) {
    const set = spec.set && this.sets[spec.set], parent = set ? set.interior ? set.scene : set.group : this.game.scene;
    let look = spec.look;
    if (typeof look === "string") look = lookFor(look);
    if (spec.kit) look = Object.assign({}, look || {}, { props: spec.kit });
    const kind = spec.kind || "pioneer";
    const a = createActor({ kind, look: Object.assign({}, look || {}), parent, name: "cine:" + spec.id, clip: spec.clip || "idle" });
    a.external = true; a.cine = true;
    const A = { id: spec.id, spec, a, set: spec.set || null, x: 0, y: 0, z: 0, yaw: 0, path: null, face: null, look: null };
    this.actors[spec.id] = A;
    this._place(A, spec.at || [0, 0, 0], spec.yaw || 0);
    if (spec.hidden) a.setVisible(false);
    return A;
  }
  _dress(A) {
    const ch = A.a.character; if (!ch) return;
    // the pioneer in a cutscene is the player's own pioneer: the Workshop's look
    if (A.spec.kind === "pioneer" || !A.spec.kind) {
      const P = getSystem("progress"), look = P && P.profile && P.profile.look;
      if (look) { try { dressAstronaut({ body: ch.root, rig: ch }, look, (P.suitVisuals && P.suitVisuals()) || new Set()); } catch (e) { console.warn("[cinema] dress", e); } }
    }
    for (const pr of A.spec.props || []) this._attach(A, pr);
    if (A.spec.raw) ch.setKind("kestrel");
    ch.ground = A.set ? null : this._gfn || (this._gfn = (x, z) => this.game.surface.height(x, z));
    ch.ikOn = !A.set && A.spec.ik !== false;
  }
  _attach(A, pr) {
    const ch = A.a.character; if (!ch) return null;
    const lib = ch.lib, kit = pr.prop === "spotlamp" ? null : makeKit(pr.prop);
    const o = kit ? kit.obj : makeProp(pr.prop, Object.assign({ mesh: pr.prop === "helmet" && lib.props.helmet }, pr));
    o.name = "prop:" + pr.prop;
    ch.attach(pr.socket || (kit && kit.socket) || "sk_grip_R", o, pr.pos || null, pr.rot ? pr.rot.map((d) => d * D2R) : null);
    return o;
  }
  _place(A, P, yawDeg) {
    const o = A.a.object3d, set = A.set && this.sets[A.set];
    if (set && set.interior) { o.position.set(P[0], P[1] || 0, P[2]); A.yaw = (yawDeg || 0) * D2R; o.rotation.y = A.yaw; }
    else if (set) { o.position.set(P[0], P[1] || 0, P[2]); A.yaw = (yawDeg || 0) * D2R; o.rotation.y = A.yaw; }
    else {
      const w = Array.isArray(P) ? this.stagePoint(P) : this.point(P);
      o.position.copy(w);
      A.yaw = this.stage.yaw + (yawDeg || 0) * D2R;
      o.rotation.y = Math.PI - A.yaw;
    }
    A.raised = !Array.isArray(P) ? (set ? 0 : o.position.y - this.game.surface.height(o.position.x, o.position.z)) : (P[1] || 0);
  }

  end() {
    if (!this.on) return;
    const g = this.game;
    this.on = false;
    if (this._previewUi) { this._previewUi = false; const ui = g.hud && g.hud.ui; if (ui && ui.cutscene) ui.cutscene.end(); }
    // hand a character back to the game where the film left them (ANVIL out of the pod, C03)
    for (const h of (this.spec && this.spec.handoff) || []) {
      const A = this.actors[h.actor], C = getSystem("caretakers"), u = C && C.api && h.unit ? C.api.get(h.unit) : null;
      if (A && u && !A.set) { u.x = A.a.object3d.position.x; u.z = A.a.object3d.position.z; u.yaw = A.yaw + Math.PI; }
    }
    for (const A of Object.values(this.actors || {})) A.a.dispose();
    for (const s of Object.values(this.sets || {})) { try { s.dispose(); } catch { /* gone */ } }
    for (const L of Object.values(this.lights || {})) { if (L.parent) L.parent.remove(L); if (L.target && L.target.parent) L.target.parent.remove(L.target); }
    for (const f of this.fx || []) if (f.obj.parent) f.obj.parent.remove(f.obj);
    for (const o of this.hidden || []) o.visible = true;
    const S = this.saved || {};
    g.view = S.view || null;
    g.post.cine = null;
    if (S.fov) { g.camera.fov = S.fov; g.camera.near = S.near; g.camera.updateProjectionMatrix(); }
    const W = (this.spec && this.spec.world) || {};
    if (W.hour != null && W.restore !== false && S.tod != null) g.state.clock.tod = S.tod;
    if (W.tau != null && S.tau != null) g.setTau(S.tau);
    g.focus = S.focus || null;
    this.actors = {}; this.sets = {}; this.lights = {}; this.fx = []; this.hidden = []; this.shot = null;
  }

  /* ── cues ── */
  cue(name) {
    if (!this.on) return;
    this.hit.set(name, this.t);
    const spec = this.spec;
    const fire = (list, fn) => {
      for (const e of list || []) {
        const at = String(e.at || "start"), m = at.match(/^(.*?)(?:\+([\d.]+))?$/), base = m[1], off = m[2] ? parseFloat(m[2]) : 0;
        if (base !== name) continue;
        if (off > 0) this.pending.push({ t: this.t + off, fn: () => fn(e) });
        else fn(e);
      }
    };
    fire(spec.shots, (s) => this._shot(s));
    fire(spec.track, (e) => this._event(e));
  }
  _predictedDur(s) {
    if (s.dur) return s.dur;
    const shots = this.spec.shots || [], i = shots.indexOf(s), key = (x) => String(x.at || "start").replace(/\+.*$/, "");
    const off = (x) => { const m = String(x.at || "").match(/\+([\d.]+)$/); return m ? parseFloat(m[1]) : 0; };
    const t0 = this.sched.get(key(s)), n = shots[i + 1];
    if (t0 != null && n && this.sched.get(key(n)) != null) return Math.max(1, this.sched.get(key(n)) + off(n) - t0 - off(s));
    if (t0 != null && !n) return Math.max(2, this.sched.get("end") - t0 - off(s));
    return 5;
  }
  _shot(s) {
    const g = this.game;
    this.prev = this.shot ? this._camPose(this.shot) : null;
    this.shot = { s, t0: this.t, dur: this._predictedDur(s), set: s.set || null };
    const set = s.set && this.sets[s.set];
    g.view = set && set.interior ? { scene: set.scene } : this.saved.view || null;
    if (s.hour != null) g.setTimeOfDay(s.hour);
    g.emit("cinema:shot", { id: this.id, name: s.name || s.at, set: s.set || null });
  }
  _event(e) {
    const g = this.game;
    if (e.actor) {
      const A = this.actors[e.actor]; if (!A) return;
      const ch = A.a.character;
      if (e.visible != null) A.a.setVisible(!!e.visible);
      if (e.pos) this._place(A, e.pos, e.yaw ?? (A.yaw - (A.set ? 0 : this.stage.yaw)) / D2R);
      if (e.kind && ch) ch.setKind(e.kind, e.helmet != null ? { helmet: e.helmet } : {});
      else if (e.helmet != null && ch) ch.setKind(ch.kind, { helmet: !!e.helmet });
      if (e.unfiltered != null && ch) ch.unfiltered(!!e.unfiltered);
      if (e.attach) this._attach(A, e.attach);
      if (e.detach && ch) for (const s of Object.values(ch.sockets)) for (const c of s.children.slice()) if (c.name === "prop:" + e.detach) s.remove(c);
      if (e.lit != null && ch) ch.model.traverse((o) => { if (o.name === "flame" || o.name === "flame-light") o.visible = !!e.lit; });
      if (e.play && ch) { ch.speed = 0; ch.play(e.play, { fade: e.fade ?? 0.35, speed: e.speed, hold: e.hold }); A.path = null; }
      if (e.walk) {
        const W = e.walk, pts = Array.isArray(W) && W.length && typeof W[0] === "number" ? [W] : Array.isArray(W) ? W : [W];
        A.path = { pts: pts.map((p) => this._localTarget(A, p)), i: 0, speed: e.speed ?? 1.3, gait: e.gait || null, then: e.then || "idle" };
      }
      if (e.move) { const to = this._localTarget(A, e.move); if (!A.set) to.y += 0; A.mv = { from: A.a.object3d.position.clone(), to, t: 0, dur: e.dur ?? 2, abs: !!A.set || e.air }; A.path = null; }
      if (e.face != null) { const yaw = typeof e.face === "number" ? (A.set ? 0 : this.stage.yaw) + e.face * D2R : this._yawTo(A, this._localTarget(A, e.face)); A.face = { from: A.yaw, to: yaw, t: 0, dur: e.dur ?? 1.0, step: Math.abs(Math.atan2(Math.sin(yaw - A.yaw), Math.cos(yaw - A.yaw))) > 0.7 && !e.noStep }; }
      if (e.lookAt !== undefined) A.look = e.lookAt === null ? null : { P: e.lookAt, w: e.weight ?? 1 };
      return;
    }
    if (e.fx) {
      const set = e.set && this.sets[e.set];
      if (e.from && e.to && !(set && set.interior)) {      // a path in the stage, relative to where the effect sits
        const w = this.point(e.where || [0, 0, 0]);
        e = Object.assign({}, e, { from: this.point(e.from).sub(w).toArray(), to: this.point(e.to).sub(w).toArray() });
      }
      const f = makeFx(e.fx, e);
      const parent = set ? set.interior ? set.scene : set.group : g.scene;
      parent.add(f.obj);
      f.obj.position.copy(set && set.interior ? new THREE.Vector3(...(e.where || [0, 0, 0])) : this.point(e.where || [0, 0, 0]));
      this.fx.push(f);
      return;
    }
    if (e.light) { const L = this.lights[e.light] || this._setLight(e.light); if (L) this.tweens.push({ o: L, k: "intensity", from: L.intensity, to: e.intensity ?? 0, t: 0, dur: e.dur ?? 0.5 }); return; }
    if (e.setp) { const s = this.sets[e.setp]; if (s) { if (s.set) s.set(e.key, e.value); else if (s[e.key] && s[e.key].visible != null) s[e.key].visible = !!e.value; } return; }
    if (e.shake != null) { this.shakeK = e.shake; this.shakeT = e.dur ?? 1; this.shakeT0 = this.shakeT; return; }
    const find = (n) => { for (const st of Object.values(this.sets)) { const o = (st.scene || st.group).getObjectByName(n); if (o) return o; } return g.scene.getObjectByName(n); };
    if (e.hide) { const o = find(e.hide); if (o && o.visible) { o.visible = false; this.hidden.push(o); } return; }
    if (e.show) { const o = find(e.show); if (o) o.visible = true; return; }
    if (e.anim) {          // a tween on something already in the world, nearest the stage (the pod's hatch)
      const A = e.anim; let best = null, bd = 1e9;
      const look = (root, ref) => root.traverse((o) => { if (o.name === A.obj) { o.getWorldPosition(_v); const d = ref ? Math.hypot(_v.x - this.stage.x, _v.z - this.stage.z) : 0; if (d < bd) { bd = d; best = o; } } });
      for (const st of Object.values(this.sets)) if (st.interior) look(st.scene, false);
      if (!best) look(g.scene, true);
      if (best) { const [k1, k2] = A.prop.split("."); const tgt = k2 ? best[k1] : best; const key = k2 || k1; this.tweens.push({ o: tgt, k: key, from: tgt[key], to: A.to, t: 0, dur: A.dur ?? 0.5 }); }
      return;
    }
    if (e.sky) { const s = this.sets[e.sky]; if (s && s.params) Object.assign(s.params, e); return; }
  }
  _setLight(name) { for (const s of Object.values(this.sets)) if (s.lights && s.lights[name]) return s.lights[name]; return null; }
  _localTarget(A, P) {
    const set = A.set && this.sets[A.set];
    if (set && Array.isArray(P)) return new THREE.Vector3(P[0], P[1] || 0, P[2]);
    if (Array.isArray(P)) return this.stagePoint(P);
    const w = this.point(P, A.set); if (set && set.interior) set.root.worldToLocal(w);
    return w;
  }
  _yawTo(A, T) {
    const o = A.a.object3d, dx = T.x - o.position.x, dz = T.z - o.position.z;
    return A.set ? Math.atan2(dx, dz) : Math.atan2(dx, -dz);
  }

  /* ── per frame ── */
  frame(dt) {
    if (!this.on) return;
    dt = Math.min(dt || 0, 0.1);
    this.t += dt;
    const g = this.game;
    for (const p of this.pending.slice()) if (this.t >= p.t) { this.pending.splice(this.pending.indexOf(p), 1); p.fn(); }
    for (const s of Object.values(this.sets)) { try { s.update(dt, this.t); } catch (e) { console.warn("[cinema] set", e); } }
    this.fx = this.fx.filter((f) => { const alive = f.update(dt); if (!alive && f.obj.parent) f.obj.parent.remove(f.obj); return alive; });
    const el = g.sky ? g.sky.sun.sinEl : 0, dark = clamp((0.18 - el) / 0.24, 0, 1);
    for (const L of Object.values(this.lights)) {
      if (L.userData.night) L.intensity = L.userData.base * (1 - L.userData.night + L.userData.night * dark);
      if (L.userData.sprite) L.userData.sprite.material.opacity = clamp(L.intensity / Math.max(1e-3, L.userData.base), 0, 1.5);
    }
    for (const tw of this.tweens.slice()) { tw.t += dt; const k = clamp(tw.t / Math.max(0.01, tw.dur), 0, 1); tw.o[tw.k] = tw.from + (tw.to - tw.from) * ease.inout(k); if (k >= 1) this.tweens.splice(this.tweens.indexOf(tw), 1); }
    // actors: paths, turns, eyelines, their animation
    for (const A of Object.values(this.actors)) this._actorFrame(A, dt);
    // the camera
    if (this.shot) this._camera(dt);
  }
  _actorFrame(A, dt) {
    const a = A.a, ch = a.character, o = a.object3d; if (!ch) return;
    const interior = !!A.set;
    if (A.path) {
      const P = A.path, T = P.pts[P.i];
      const dx = T.x - o.position.x, dz = T.z - o.position.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { P.i++; if (P.i >= P.pts.length) { A.path = null; ch.play(P.then, { fade: 0.4 }); ch.speed = 0; } }
      else {
        const want = interior ? Math.atan2(dx, dz) : Math.atan2(dx, -dz);
        A.yaw += Math.atan2(Math.sin(want - A.yaw), Math.cos(want - A.yaw)) * Math.min(1, dt * 5);
        const sp = Math.min(P.speed, d / Math.max(dt, 1e-3));
        o.position.x += dx / d * sp * dt; o.position.z += dz / d * sp * dt;
        if (P.gait) { if (ch.cur !== P.gait) ch.play(P.gait, { fade: 0.3 }); ch.speed = sp; }
        else ch.locomote(sp, { walk: "walk", lope: "lope", sprint: null });
      }
    }
    if (A.mv) {
      const V = A.mv; V.t += dt; const k = clamp(V.t / V.dur, 0, 1);
      o.position.lerpVectors(V.from, V.to, k);
      if (!interior) A.raised = o.position.y - this.game.surface.height(o.position.x, o.position.z);
      if (k >= 1) A.mv = null;
    }
    if (A.face) {
      const F = A.face; F.t += dt; const k = clamp(F.t / F.dur, 0, 1), d = Math.atan2(Math.sin(F.to - F.from), Math.cos(F.to - F.from));
      A.yaw = F.from + d * ease.inout(k);
      if (F.step && !A.path) { if (k < 1 && ch.cur !== "turn_step") { F.prevClip = ch.cur; ch.play("turn_step", { fade: 0.2 }); } else if (k >= 1) ch.play(F.prevClip && F.prevClip !== "turn_step" ? F.prevClip : "idle", { fade: 0.3 }); }
      if (k >= 1) A.face = null;
    }
    if (!interior) { o.position.y = this.game.surface.height(o.position.x, o.position.z) + (A.raised || 0); o.rotation.y = Math.PI - A.yaw; }
    else o.rotation.y = A.yaw;
    if (A.look) {
      const P = typeof A.look.P === "string" && this.actors[A.look.P] ? { actor: A.look.P, bone: "head" } : A.look.P;
      const w = this.point(P, A.set); ch.lookAt(w, A.look.w);
    } else ch.lookAt(null);
    a.update(dt, this.game.camera.position, false);
  }
  /** Never inside a person: a camera that ends up within an actor's body (they walked into the lens, or a key sits
   *  too close) is eased out sideways to just clear the suit, so the frame shows them rather than their lining. */
  _clearActors(pos, set) {
    const inSet = !!(set && this.sets[set] && this.sets[set].interior), R = 0.62;
    for (const A of Object.values(this.actors)) {
      const o = A.a.object3d; if (!o.visible) continue;
      const aIn = !!(A.set && this.sets[A.set] && this.sets[A.set].interior);
      if (aIn !== inSet || (inSet && A.set !== set)) continue;
      o.getWorldPosition(_w);
      if (pos.y < _w.y - 0.1 || pos.y > _w.y + 2.05) continue;
      const dx = pos.x - _w.x, dz = pos.z - _w.z, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const k = d > 1e-3 ? R / d : 0; pos.x = _w.x + (d > 1e-3 ? dx * k : R); pos.z = _w.z + (d > 1e-3 ? dz * k : 0);
    }
  }
  /** Authoring guard: a shot that frames an actor who is hidden, or who stands in another scene, films an empty set. */
  _checkShot(sh, keys) {
    const inSet = !!(sh.set && this.sets[sh.set] && this.sets[sh.set].interior);
    for (const k of keys) for (const P of [k.pos, k.look]) {
      if (!P || typeof P !== "object" || Array.isArray(P) || !P.actor) continue;
      const A = this.actors[P.actor], why = !A ? "missing" : !A.a.object3d.visible ? "hidden" : (!!(A.set && this.sets[A.set] && this.sets[A.set].interior) !== inSet || (inSet && A.set !== sh.set)) ? "in another scene" : null;
      if (why) { const w = `${this.id} shot "${sh.s.name || sh.s.at}" frames ${P.actor} (${why})`; if (!this.warnings.includes(w)) { this.warnings.push(w); console.warn("[cinema] " + w); } }
    }
  }
  _camPose(shot) {
    return { pos: this.game.camera.position.clone(), quat: this.game.camera.quaternion.clone(), fov: this.game.camera.fov };
  }
  _camera(dt) {
    const g = this.game, cam = g.camera, sh = this.shot, s = sh.s, C = s.cam || {};
    const keys = C.keys && C.keys.length ? C.keys : [{ t: 0, pos: [0, 1.6, -6], look: [0, 1.2, 0] }];
    const u = (ease[C.ease || "inout"] || ease.inout)(clamp((this.t - sh.t0) / Math.max(0.1, sh.dur), 0, 1));
    // keys: the two around u, Catmull-Rom through their neighbours
    let i = 0; while (i < keys.length - 2 && u > (keys[i + 1].t ?? 1)) i++;
    const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[Math.min(keys.length - 1, i + 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
    const span = Math.max(1e-4, (k2.t ?? 1) - (k1.t ?? 0)), f = keys.length === 1 ? 0 : clamp((u - (k1.t ?? 0)) / span, 0, 1);
    const set = sh.set;
    if (!sh.checked && this.t - sh.t0 > 0.3) { sh.checked = true; this._checkShot(sh, keys); }
    const P = (k, which) => this.point(k[which] || k1[which], set);
    const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
    const p0 = P(k0, "pos"), p1 = P(k1, "pos"), p2 = P(k2, "pos"), p3 = P(k3, "pos");
    const l0 = P(k0, "look"), l1 = P(k1, "look"), l2 = P(k2, "look"), l3 = P(k3, "look");
    const pos = new THREE.Vector3(cr(p0.x, p1.x, p2.x, p3.x, f), cr(p0.y, p1.y, p2.y, p3.y, f), cr(p0.z, p1.z, p2.z, p3.z, f));
    const look = new THREE.Vector3(cr(l0.x, l1.x, l2.x, l3.x, f), cr(l0.y, l1.y, l2.y, l3.y, f), cr(l0.z, l1.z, l2.z, l3.z, f));
    if (!set || !this.sets[set] || !this.sets[set].interior) { const fl = g.surface.height(pos.x, pos.z) + 0.25; if (pos.y < fl) pos.y = fl; }
    this._clearActors(pos, set);
    const lens = (k1.lens ?? C.lens ?? 35) + ((k2.lens ?? C.lens ?? 35) - (k1.lens ?? C.lens ?? 35)) * f;
    const fov = clamp(2 * Math.atan(12 / lens) / D2R, 8, 100);
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    _m.lookAt(pos, look, cam.up); cam.quaternion.setFromRotationMatrix(_m);
    const roll = (k1.roll ?? 0) + ((k2.roll ?? 0) - (k1.roll ?? 0)) * f;
    // handheld (slow drift) and shake (impacts, buffeting)
    const hh = C.handheld || 0, t = this.t;
    let yawN = 0, pitN = 0, rollN = roll * D2R;
    if (hh > 0) { yawN += hh * 0.012 * (Math.sin(t * 0.9) + 0.6 * Math.sin(t * 2.3 + 1)); pitN += hh * 0.009 * (Math.sin(t * 1.1 + 2) + 0.5 * Math.sin(t * 2.9)); rollN += hh * 0.006 * Math.sin(t * 0.7 + 3); }
    if (this.shakeT > 0) this.shakeT -= dt;
    const shk = (C.shake || 0) + (this.shakeT > 0 ? this.shakeK * (this.shakeT / Math.max(0.01, this.shakeT0)) : 0);
    if (shk > 0) { yawN += shk * 0.02 * Math.sin(t * 37) * Math.sin(t * 11.3); pitN += shk * 0.02 * Math.sin(t * 41 + 1) * Math.sin(t * 7.7); }
    cam.quaternion.multiply(_q.setFromEuler(new THREE.Euler(pitN, yawN, rollN, "YXZ")));
    // a blend from the previous shot's camera
    const bl = C.blend || 0;
    if (bl > 0 && this.prev && this.t - sh.t0 < bl) {
      const k = ease.inout((this.t - sh.t0) / bl);
      cam.position.lerpVectors(this.prev.pos, cam.position, k); cam.quaternion.slerpQuaternions(this.prev.quat, cam.quaternion.clone(), k);
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (cam.near !== 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
    // the grade and the lens
    const auto = () => { const e = g.sky ? g.sky.sun.sinEl : 0.5; return e > 0.28 ? "mars_day" : e > 0.06 ? "mars_dusk" : e > -0.1 ? "mars_dawn" : "mars_night"; };
    const gname = (n) => (n === "auto" || !n ? auto() : n);
    const gr = typeof s.grade === "string" ? GRADES[gname(s.grade)] : s.grade ? Object.assign({}, GRADES[gname(s.grade.base)] || {}, s.grade) : GRADES[auto()];
    const cine = Object.assign({}, GRADES.neutral, gr || {});
    if (s.dof) {
      let focus = s.dof.focus;
      if (s.dof.keys) { const ks = s.dof.keys; let j = 0; while (j < ks.length - 1 && u > ks[j + 1].t) j++; const a = ks[j], b = ks[Math.min(ks.length - 1, j + 1)], ff = b === a ? 0 : clamp((u - a.t) / Math.max(1e-4, b.t - a.t), 0, 1); const fa = this._focusDist(a.focus, set), fb = this._focusDist(b.focus, set); focus = fa + (fb - fa) * ease.inout(ff); }
      else focus = this._focusDist(focus, set);
      cine.dof = { focus, fstop: s.dof.fstop ?? 2.8, lens, boost: s.dof.boost ?? 1 };
    }
    g.post.cine = cine;
  }
  _focusDist(f, set) {
    if (typeof f === "number") return f;
    if (f == null) return 10;
    const P = typeof f === "string" && this.actors[f] ? { actor: f, bone: "chest" } : f;
    const w = this.point(P, set);
    return Math.max(0.3, w.distanceTo(this.game.camera.position));
  }
  /* ── preview: a cinematic without its beats, seeked to a time (the tests' key frames, authoring) ── */
  async preview(id, o = {}) {
    const spec = await this.load(id), D = await loadStory(), cs = D && D.cutscene(id);
    if (!spec || !cs) return false;
    await this.begin(id, spec, cs);
    // a preview looks like the film: the HUD away, the letterbox in (what the runner's ui.cutscene.start does)
    const ui = this.game.hud && this.game.hud.ui;
    if (ui && ui.cutscene && !ui.cutscene.active) { ui.cutscene.start({ letterbox: true, skippable: false, hold: false }); this._previewUi = true; }
    const order = []; let t = 0;
    const run = (beats, prefix) => beats.forEach((b, i) => {
      order.push([prefix + i, t]);
      if (b.kind === "line" && b.line) order.push([b.line, t]);
      const s = beatSeconds(b, D);
      if (b.kind === "line" && b.line) order.push([b.line + "/end", t + Math.max(0, s - 0.15)]);
      if (b.kind === "choice") {
        const opts = b.options || [], pick = opts.find((x) => x.id === (o.choices || {})[b.choice_id]) || opts[0];
        t += 1.2; if (pick) { order.push(["chose:" + b.choice_id + ":" + pick.id, t]); run(pick.then || [], `opt:${b.choice_id}:${pick.id}:`); }
      } else t += s;
    });
    run(cs.beats || [], "beat:");
    order.push(["end", t]);
    this.previewOrder = order.sort((a, b) => a[1] - b[1]);
    this.previewEnd = t;
    return true;
  }
  /** Advance the preview to `time` seconds: cues fire in their predicted order, the film runs at 20 fps without rendering. */
  seek(time) {
    if (!this.on || !this.previewOrder) return;
    while (this.t < time - 1e-6) {
      const dt = Math.min(1 / 20, time - this.t);
      for (const [n, ct] of this.previewOrder) if (ct <= this.t + dt && !this.hit.has(n)) this.cue(n);
      this.frame(dt);
    }
  }
  /** The predicted start and length of every shot in a preview: [{ name, at, t, dur, set }]. */
  shotTimes() {
    const map = new Map(this.previewOrder || []);
    return (this.spec.shots || []).map((s) => { const at = String(s.at || "start"), m = at.match(/^(.*?)(?:\+([\d.]+))?$/); const t = (map.get(m[1]) ?? 0) + (m[2] ? parseFloat(m[2]) : 0); return { name: s.name || at, at, t, set: s.set || null }; })
      .map((x, i, arr) => Object.assign(x, { dur: (arr[i + 1] ? arr[i + 1].t : this.previewEnd) - x.t }));
  }
  state() {
    return { active: this.on, id: this.id, t: this.t, shot: this.shot ? (this.shot.s.name || this.shot.s.at) : null, set: this.shot ? this.shot.set : null,
      actors: Object.keys(this.actors || {}), sets: Object.keys(this.sets || {}), cues: [...(this.hit || new Map()).keys()], warnings: this.warnings.slice() };
  }
}
