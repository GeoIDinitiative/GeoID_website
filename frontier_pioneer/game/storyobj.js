/**
 * THE OBJECTIVE CHECKERS: one entry per objective type in story/acts.json
 * (objective_types: 54 of them), mapped onto what the game really does.
 *
 *   OBJ[type] = {
 *     enter(ob, P, run, m)        the objective becomes current (or the mission starts, for an optional one)
 *     poll(ob, P, run, m, dt, simDt) -> done?    a state that holds (four times a second)
 *     on(event, data, ob, P, run, m) -> done?    an event (eva scans, KEEPER answers, packages, choices...)
 *     action(ob, P, run, m) -> { at, r, text, run() }   a hold-to-use action in the world (story.js shows the prompt)
 *     meta / target                 the HUD tracker's second line and the marker
 *     relaxed                       may be done out of order (questions, pickups, conversations, warnings)
 *     force(ob, P)                  the dev skip completes it
 *   }
 *
 * WHAT IS REAL. reach / climb / eva / sample / scan / scan_site / build / survive / sleep / drive / walk
 * read the game's own state and events (the avatar, the eva system's scans and samples, the base system's
 * modules, the rover's odometer, the weather's storm). Packages are HALO-1's (halo.js), conversations
 * and barks the caretakers' (caretakers.js), questions KEEPER's (keeper.js), the planned modules the
 * tiers' (tiers.js). What has no system behind it yet is played as a hold-to-use action at a story place
 * with its authored lines (interact, salvage, inspect, deliver, diagnose, harvest, remediate, repair,
 * craft, stow_supplies), or as a short scripted sequence (fly: a hopper flight card and a move; race and
 * follow: moving markers; memory_spiral: rooms and a guide voice; evade: RECALL hunters). Distances
 * that cannot fit a 20 km site (drive 1,800 km, evade 40 km) are scaled and say so.
 */
import { getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { MARS } from "./config.js?v=b8cfe8e-efa5b7b7";
import { speech, esc, humanise, evalCond } from "./storydata.js?v=b8cfe8e-efa5b7b7";
import { plannedName, PLANNED } from "./tiers.js?v=b8cfe8e-efa5b7b7";

export const ACTION_HOLD = 0.6;
const fmtM = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km");

export function makeObjectives(st) {
  const g = st.game;
  const sys = (id) => { const s = getSystem(id); return s && s.api ? s.api : null; };
  const near = (p, r) => !!p && st.dist(p) <= r;
  const R = () => (st.onFoot() ? 6 : 25);
  const lines = (m, id) => (m.dialogue && m.dialogue.progress && m.dialogue.progress[id]) || [];
  const say = (ls, o) => speech(g).seq(ls, Object.assign({ when: () => st.S.vars }, o || {}));
  const toast = (h, s = 4) => g.hud.toast(h, s);
  const unitPlace = (name, ob) => {
    const C = sys("caretakers"); let u = C && C.get(name);
    if (!u && C && name) {
      // a founder away at their settlement comes to meet him; anyone else is met where the story says
      const D = st.D, founder = D && (D.founders[name] || D.second[name] || name === "GALE_ANVIL");
      const at = (ob && ob.poi && st.place(ob.poi)) || (founder ? null : st.place(String(name).toLowerCase()));
      const h = st.home(), p = st.playerPos();
      const base = at || { x: (h.x + p.x) / 2 + 12, z: (h.z + p.z) / 2 + 8 };
      if (founder) u = C.spawn({ callsign: name, founder: true, x: base.x, z: base.z });
      else if (/^UNIT:/.test(name) && ob && ob.callsign) u = C.spawn({ callsign: ob.callsign, template: name.slice(5), x: base.x, z: base.z });
      else if (!/^(COVENANT_LEAD|PIONEER_11)$/.test(name)) u = C.spawn({ callsign: name, x: base.x, z: base.z });
    }
    if (u && u.state !== "away") return { x: u.x, z: u.z, name: u.callsign, unit: u };
    return st.place(ob && ob.poi ? ob.poi : String(name).toLowerCase()) || st.home();
  };
  const built = (ob) => {
    const b = st.base(); let n = 0;
    try {
      const re = ob.match ? new RegExp(ob.match) : null;
      if (b) n = b.modules().filter((x) => x.built && (x.type === ob.module || (re && re.test(x.type)))).length;
    } catch { n = 0; }
    return n;
  };
  const objPlace = (id) => st.place(id) || st.home();
  /** A hold-to-use action that plays the objective's own lines and completes it. */
  const simple = (place, verb, extra = {}) => Object.assign({
    action(ob, P, run, m) { const at = place(ob, P); return { at, r: at ? (extra.r || R()) : 0, text: (typeof verb === "function" ? verb(ob, P) : verb) || ob.text, run: async () => { if (extra.before) await extra.before(ob, P, m); const r = extra.step ? extra.step(ob, P, m) : true; if (r) st.objectiveDone(m, ob); } }; },
    target(ob, P) { return place(ob, P); },
    force() {},
  }, extra.more || {});

  const O = {};

  /* ── movement and places ── */
  O.reach = {
    enter(ob, P) { P.seen = []; },
    poll(ob, P, run, m) {
      if (P.playing) return false;
      const list = Array.isArray(ob.poi) ? ob.poi : [ob.poi];
      const r = (ob.r || 30) * (st.onFoot() ? 1 : 1.2);
      if (ob.by === "rover" && st.onFoot()) return false;
      if (ob.by === "foot" && !st.onFoot()) return false;
      for (const id of list) { if (P.seen.includes(id)) continue; const q = st.place(id); if (q && near(q, r)) { P.seen.push(id); if (list.length > 1) toast(`Reached: ${esc(q.name)}<small>${P.seen.length} of ${ob.count || list.length}</small>`, 3); } }
      if (P.seen.length < (ob.count || list.length)) return false;
      if (ob.cutscene && !st.S.seen[ob.cutscene]) { P.playing = true; st.playCutscene(ob.cutscene).then(() => { P.playing = false; P.cs = true; st.objectiveDone(m, ob); }); return false; }
      return true;
    },
    target(ob, P) { const list = Array.isArray(ob.poi) ? ob.poi : [ob.poi]; for (const id of list) if (!(P.seen || []).includes(id)) return st.place(id); return null; },
    meta(ob, P) { const t = O.reach.target(ob, P); const list = Array.isArray(ob.poi) ? ob.poi : null; return (t ? fmtM(st.dist(t)) : "") + (ob.by === "rover" ? " · in the rover" : "") + (list ? ` · ${(P.seen || []).length} / ${ob.count || list.length}` : ""); },
  };
  O.climb = {
    poll(ob, P, run, m) { const q = st.place(ob.poi); return st.onFoot() && near(q, ob.r || 60) && !!m; },
    target(ob) { return st.place(ob.poi); }, meta(ob) { const q = st.place(ob.poi); return (q ? fmtM(st.dist(q)) : "") + " · on foot"; },
  };
  O.eva = { poll() { return st.onFoot(); }, meta() { return Math.abs(g.vehicle.t.speed) < 0.5 ? "hold L1 + R1, or E" : "stop first"; } };
  O.drive = {
    enter(ob, P) { P.odo0 = g.vehicle.odometer; },
    goal(ob) { return Math.min((ob.distance_km || 1) * 1000, 3000); },
    poll(ob, P) { if (P.odo0 == null) P.odo0 = g.vehicle.odometer; return g.vehicle.odometer - P.odo0 >= O.drive.goal(ob); },
    meta(ob, P) { return `${fmtM(Math.max(0, g.vehicle.odometer - (P.odo0 || 0)))} / ${fmtM(O.drive.goal(ob))}${ob.distance_km > 3 ? ` (${ob.distance_km} km, scaled to the site)` : ""}`; },
    force(ob, P) { P.odo0 = -1e9; },
  };
  O.walk = {
    enter(ob, P) { const a = sys("avatar"); P.w0 = a && a.stats ? a.stats.walked_m : 0; },
    poll(ob, P) { const a = sys("avatar"), w = a && a.stats ? a.stats.walked_m : 0; return w - (P.w0 || 0) >= Math.min(ob.distance_m || 500, 800); },
    meta(ob, P) { const a = sys("avatar"), w = a && a.stats ? a.stats.walked_m : 0; return `${fmtM(Math.max(0, w - (P.w0 || 0)))} / ${fmtM(Math.min(ob.distance_m || 500, 800))} on foot`; },
  };
  O.traverse = {
    enter(ob, P) { P.inside = false; P.lost = false; },
    poll(ob, P) {
      const z = st.place(ob.zone && ob.zone.poi), r = Math.min((ob.zone && ob.zone.r) || 300, 400); if (!z) return false;
      const d = st.dist(z);
      if (d < r * 0.4) P.inside = true;
      if (P.inside && d > r) { if (P.lost) { P.inside = false; P.lost = false; toast("The crossing cost you: go back and cross again", 4); return false; } return true; }
      return false;
    },
    on(ev, d, ob, P) { if (ev === "emergency") P.lost = true; return false; },
    target(ob, P) { const z = st.place(ob.zone && ob.zone.poi); return P.inside ? null : z; },
    meta(ob, P) { return P.inside ? `cross and leave the zone without an emergency${ob.guide ? " · " + ob.guide + " is guiding" : ""}` : "go to the crevasse field"; },
  };
  O.race = {
    enter(ob, P) { P.n = 0; if (ob.target === "dust_devil") O.race._devil(P); },
    _devil(P) { const W = getSystem("weather"), p = st.playerPos(), a = Math.random() * Math.PI * 2; P.goal = { x: p.x + Math.sin(a) * 260, z: p.z + Math.cos(a) * 260 }; if (W && W.spawnDevil) { try { P.dev = W.spawnDevil(g, { x: P.goal.x, z: P.goal.z, life: 240 }); } catch { P.dev = null; } } },
    poll(ob, P) {
      if (st.onFoot()) return false;
      if (ob.target === "dust_devil") { const q = P.dev ? { x: P.dev.x, z: P.dev.z } : P.goal; if (q && near(q, 25)) { P.n++; toast(`Caught one<small>${P.n} of ${ob.count || 1}</small>`, 3); if (P.n >= (ob.count || 1)) return true; O.race._devil(P); } return false; }
      const q = st.place(ob.to); return !!q && near(q, 60);
    },
    target(ob, P) { return ob.target === "dust_devil" ? (P.dev ? { x: P.dev.x, z: P.dev.z, name: "Dust devil" } : P.goal) : st.place(ob.to); },
    meta(ob, P) { return ob.target === "dust_devil" ? `${P.n || 0} / ${ob.count || 1} · in the rover` : `race ${ob.target} to ${humanise(ob.to)} · in the rover`; },
    force(ob, P) { P.n = 99; },
  };
  O.follow = {
    enter(ob, P) {
      P.i = 0; P.t = 0;
      const h = st.home();
      if (ob.relay_line) { const z = st.place(ob.relay_line + "_start") || h; P.nodes = []; for (let k = 0; k < (ob.nodes || 5); k++) P.nodes.push({ x: z.x + k * 140, z: z.z - k * 90, name: `Relay ${k + 1}` }); }
    },
    poll(ob, P, run, m, dt) {
      if (P.nodes) { const n = P.nodes[P.i]; if (n && near(n, st.onFoot() ? 15 : 30)) { P.i++; toast(`${n.name}<small>${P.i} of ${P.nodes.length}</small>`, 2.5); } return P.i >= P.nodes.length; }
      // follow a unit on its rounds: stay within 40 m of it for a minute
      const C = sys("caretakers"), u = C && (C.get(ob.target) || C.spawn({ callsign: ob.target, founder: true, x: st.home().x + 20, z: st.home().z }));
      if (!u) return false;
      if (!u.goal) { const h = st.home(), a = (P.t || 0) / 30; u.goal = { x: h.x + Math.sin(a) * 80, z: h.z + Math.cos(a) * 80, then: "idle" }; u.state = "walk"; }
      if (near(u, 40)) P.t = (P.t || 0) + dt;
      return P.t >= 60;
    },
    target(ob, P) { if (P.nodes) return P.nodes[P.i] || null; const C = sys("caretakers"), u = C && C.get(ob.target); return u ? { x: u.x, z: u.z, name: u.callsign } : null; },
    meta(ob, P) { return P.nodes ? `${P.i || 0} / ${P.nodes.length} relays` : `stay with ${ob.target}: ${Math.round(P.t || 0)} / 60 s`; },
    force(ob, P) { if (P.nodes) P.i = P.nodes.length; P.t = 99; },
  };
  O.fly = Object.assign(simple((ob) => st.place(ob.from) || st.home(), (ob) => `Board the ${ob.rocket_only ? "rocket" : "hopper"}: fly to ${humanise(ob.to || (ob.route || []).slice(-1)[0] || "the pad")}`, {
    r: 30,
    step(ob, P, m) {
      // a destination on another installed site: the flight ends there (the shell's travel: save, load, the chapter card)
      const to = ob.to || (ob.route || []).slice(-1)[0] || "", site = String(to).includes(".") ? String(to).split(".")[0] : null;
      if (site && site !== st.loadedSite && typeof window.__marsTravel === "function") {
        st._installed.then((inst) => { if (!inst.has(site)) return; st.S.site = site; st._save(); const ct = st.chapterTitle(); window.__marsTravel(site, { act: ct.act, chapter: m.title, reason: `${m.id}: ${ob.text}` }); });
      }
      return true;
    },
    async before(ob) {
      const ui = g.hud.ui, legs = ob.route ? ob.route.slice(1) : [ob.to];
      if (ui && ui.cutscene) ui.cutscene.start({ letterbox: true, skippable: true });
      for (const to of legs) {
        await (ui && ui.card ? ui.card({ eyebrow: ob.rocket_only ? "ROCKET" : "HOPPER FLIGHT", title: humanise(to).toUpperCase(), sub: `pilot: ${ob.pilot === "FERRY" ? "FERRY" : "you"}${ob.passenger ? " · passenger " + ob.passenger : ""}`, seconds: g.headless ? 0.2 : 3 }) : null);
        const q = to ? st.place(to) : null;
        if (q && !st.onFoot()) { try { g.teleport(q.x + 12, q.z + 12, 0); } catch { /* fine */ } }
      }
      if (ui && ui.cutscene && ui.cutscene.active) ui.cutscene.end();
    },
  }));
  /* ── the eva system's own actions ── */
  const zoneOf = (ob) => (ob.zone ? st.place(ob.zone.poi) : null);
  O.sample = {
    on(ev, d, ob, P) { if (ev !== "sample") return false; const z = zoneOf(ob), t = d.tube || d; if (z && Math.hypot(t.x - z.x, t.z - z.z) > Math.max(ob.zone.r || 200, 200)) return false; P.n++; return P.n >= (ob.count || 1); },
    target(ob) { return zoneOf(ob); }, meta(ob, P) { return `${P.n || 0} / ${ob.count || 1}${ob.depth_m ? ` · an ice core (${ob.depth_m} m: the drill goes as deep as it goes)` : ""}`; },
    action(ob, P, run, m) { const z = zoneOf(ob); if (!st.onFoot() || (z && st.dist(z) > 200)) return null; const E = sys("eva"); let t = null; try { t = E && E.target(); } catch { t = null; } if (t && t.hold > 0) return null; return { at: null, r: 0, text: ob.kind === "ice_core" ? "Drill an ice core" : "Take a sample", run: () => { P.n++; if (P.n >= (ob.count || 1)) st.objectiveDone(m, ob); } }; },
  };
  O.scan = {
    targetPlace(ob) {
      if (ob.zone) return st.place(ob.zone.poi);
      const map = { lander_interior: "lander", dune_ridge_landing: "dune_ridge_landing", outpost_ground: null, isru_plant: "isru_plant", m2020_sample_tube: "three_forks" };
      const key = ob.target in map ? map[ob.target] : ob.target;
      return key ? st.place(key) : st.home();
    },
    hit(ob, P, x, z) {
      const q = O.scan.targetPlace(ob), r = ob.zone ? Math.max(ob.zone.r || 60, 60) : 60;
      if (q && Math.hypot(q.x - x, q.z - z) > r) return false;
      P.at = P.at || [];
      if (ob.spacing && P.at.some((a) => Math.hypot(a[0] - x, a[1] - z) < ob.spacing)) { toast(`Too close to an earlier scan<small>${ob.spacing} m apart</small>`, 3); return false; }
      P.at.push([Math.round(x), Math.round(z)]); P.n = (P.n || 0) + 1;
      return P.n >= (ob.count || 1);
    },
    finish(ob, P, m) { if (ob.cutscene && !st.S.seen[ob.cutscene]) { P.playing = true; st.playCutscene(ob.cutscene).then(() => st.objectiveDone(m, ob)); return false; } return true; },
    on(ev, d, ob, P, run, m) { if (ev !== "scan" || P.playing) return false; if (ob.slope_min_deg && (d.dataSlope || 0) < ob.slope_min_deg) { toast(`Not steep enough: ${Math.round(d.dataSlope || 0)}° (${ob.slope_min_deg}° wanted)`, 3); return false; } return O.scan.hit(ob, P, d.x, d.z) && O.scan.finish(ob, P, m); },
    action(ob, P, run, m) {
      if (P.playing || ob.slope_min_deg) return null;
      const q = O.scan.targetPlace(ob); if (st.onFoot() && !ob.zone && ob.target !== "lander_interior") return null;      // on foot: the scanner (Q / D-pad left)
      const p = st.playerPos();
      return { at: q, r: ob.zone ? Math.max(ob.zone.r || 60, 60) : 40, text: `Scan ${humanise(ob.target)}${(ob.count || 1) > 1 ? ` (${(P.n || 0) + 1} of ${ob.count})` : ""}`, run: () => { const jitter = ob.spacing ? (P.n || 0) * (ob.spacing + 2) : 0; if (O.scan.hit(ob, P, p.x + jitter, p.z) && O.scan.finish(ob, P, m)) st.objectiveDone(m, ob); } };
    },
    target(ob) { return O.scan.targetPlace(ob); },
    meta(ob, P) { return `${P.n || 0} / ${ob.count || 1}${st.onFoot() ? " · scan: Q or D-pad left" : ""}`; },
  };
  O.scan_site = {
    test(ob, x, z, slope) {
      const c = ob.criteria || {}, why = [];
      if (c.slope_max_deg != null && slope > c.slope_max_deg) why.push("slope");
      if (c.wind_shelter_min != null) {
        // shelter: higher ground within 250 m to the west and north (the winds' quarter), from the real terrain
        const S = g.surface, h0 = S.height(x, z); let rise = 0;
        for (const [dx, dz] of [[-150, 0], [-250, 0], [0, -150], [0, -250], [-150, -150]]) rise = Math.max(rise, S.height(x + dx, z + dz) - h0);
        if (Math.min(1, rise / 12) < c.wind_shelter_min) why.push("shelter");
      }
      if (c.hydrated_minerals_within_m != null) {
        const clays = ["delta_front", "three_forks"].map((k) => g.site.pois.find((p) => p.id === k)).filter(Boolean);
        if (clays.length && !clays.some((p) => Math.hypot(p.x - x, p.z - z) < c.hydrated_minerals_within_m + 600)) why.push("minerals");
      }
      return why;
    },
    on(ev, d, ob, P, run, m) {
      if (ev !== "scan") return false;
      const z = zoneOf(ob); if (z && Math.hypot(d.x - z.x, d.z - z.z) > (ob.zone.r || 600)) { toast("Outside the survey area", 2.5); return false; }
      const why = O.scan_site.test(ob, d.x, d.z, Math.max(d.dataSlope || 0, g.surface.slopeDeg(d.x, d.z, 4)));
      if (why.length) { const f = (m.failure && m.failure.fail || []).find((l) => l.line.endsWith(why[0])); if (f) say([f], { style: "radio" }); else toast(`Site does not meet criteria: ${why[0]}`, 3); return false; }
      st.S.markers.candidate = { x: d.x, z: d.z, name: "the surveyed site" };
      return true;
    },
    target(ob) { return zoneOf(ob); },
    meta(ob) { const c = ob.criteria || {}; return [c.slope_max_deg != null ? `slope under ${c.slope_max_deg}°` : "", c.wind_shelter_min != null ? "wind shelter" : "", c.hydrated_minerals_within_m != null ? "clays near" : "", c.fresh_crater ? "fresh crater" : ""].filter(Boolean).join(" · ") + " · scan: Q on foot"; },
    force(ob, P) { const p = st.playerPos(); st.S.markers.candidate = { x: p.x + 20, z: p.z, name: "the surveyed site" }; },
  };
  O.place_marker = {
    mark(ob, x, z) { st.S.markers[ob.marker] = { x, z, name: humanise(ob.marker), site: st.loadedSite }; toast(`Marked: ${esc(humanise(ob.marker))}`, 3); },
    on(ev, d, ob) { if (ev !== "plant") return false; O.place_marker.mark(ob, d.x, d.z); return true; },
    action(ob, P, run, m) { const c = st.S.markers.candidate; return { at: c || null, r: c ? 80 : 0, text: `Mark ${humanise(ob.marker)} here`, run: () => { const p = st.playerPos(); O.place_marker.mark(ob, p.x, p.z); st.objectiveDone(m, ob); } }; },
    target() { return st.S.markers.candidate || null; },
    meta() { return st.onFoot() ? "plant a flag (F) or hold E" : "press E at the site"; },
    force(ob) { const p = st.playerPos(); O.place_marker.mark(ob, p.x + 25, p.z); },
  };
  O.collect = {
    enter(ob, P) {
      const ids = ob.collectible ? [ob.collectible] : st.collectSet(ob.collectible_set).slice(0, ob.count || 1);
      P.ids = ids; P.n = ids.filter((id) => st.S.collected[id]).length;
      const anchor = st.playerPos();
      ids.forEach((id, i) => { if (!st.S.collected[id]) st.spawnPickup(id, anchor, i); });
    },
    on(ev, d, ob, P) { if (ev !== "collect" || !(P.ids || []).includes(d.id)) return false; P.n = (P.ids || []).filter((id) => st.S.collected[id]).length; return P.n >= (ob.count || (P.ids || []).length || 1); },
    action(ob, P) { for (const [i, id] of (P.ids || []).entries()) { if (st.S.collected[id]) continue; const p = st.pickups.get(id) || st.spawnPickup(id, st.playerPos(), i); if (p) { const it = st.collectible(id); return { at: p, r: st.onFoot() ? 4 : 14, text: `Pick up: ${it ? it.title || it.header || humanise(id) : humanise(id)}`, run: () => st.collect(id) }; } } return null; },
    target(ob, P) { for (const id of P.ids || []) { const p = st.pickups.get(id); if (p && !st.S.collected[id]) return { x: p.x, z: p.z, name: "a record" }; } return null; },
    meta(ob, P) { return `${P.n || 0} / ${ob.count || (P.ids || []).length || 1} found`; },
    relaxed: true,
    force(ob, P) { for (const id of P.ids || []) st.S.collected[id] = 1; P.n = 99; },
  };
  O.read = {
    action(ob, P, run, m) { return { at: null, r: 0, text: `Read: ${(st.collectible(ob.item) || {}).title || humanise(ob.item)}`, run: async () => { await st.readDoc(st.collectible(ob.item) || { id: ob.item, title: humanise(ob.item), text: "" }); st.objectiveDone(m, ob); } }; },
    meta() { return "hold E (on foot) or press E"; }, relaxed: true,
  };

  /* ── building ── */
  O.build = {
    enter(ob, P, run, m) {
      if (ob.planned_module) { const T = sys("tiers"); if (T) T.order(ob.module, { count: ob.count || 1, key: m.id + "." + ob.id, mission: m.id, event: ob.event || null }); toast(`${esc(plannedName(ob.module))} ordered<small>the caretakers will build it at the base</small>`, 4); }
      if (ob.remote) P.t = 0;
    },
    poll(ob, P, run, m, dt) {
      if (ob.remote) { P.t = (P.t || 0) + dt; if (P.t > 20) { toast(`${esc(humanise(ob.site || ""))}: the Steward's crew reports the ${esc((MODULES_NAME[ob.module] || humanise(ob.module)).toLowerCase())} finished`, 5); return true; } return false; }
      if (ob.planned_module) {
        const T = sys("tiers"); if (!T) return false;
        // ordered at another site (before a travel): order it again here
        if (!T.structures().some((x) => x.key === m.id + "." + ob.id) && T.built(ob.module) < (ob.count || 1)) T.order(ob.module, { count: ob.count || 1, key: m.id + "." + ob.id, mission: m.id, event: ob.event || null });
        return T.built(ob.module) >= (ob.count || 1);
      }
      return built(ob) >= (ob.count || 1);
    },
    target(ob) { if (ob.planned_module) { const T = sys("tiers"), s = T && T.structures().find((x) => x.type === ob.module && x.progress < 1); return s ? { x: s.x, z: s.z, name: plannedName(ob.module) } : null; } return null; },
    meta(ob) {
      if (ob.remote) return "built by a Steward's crew";
      if (ob.planned_module) { const T = sys("tiers"), s = T && T.structures().find((x) => x.type === ob.module); return s ? `${Math.round(s.progress * 100)}%${s.waiting ? " · waiting for a crew" : " · the caretakers are on it"}` : ""; }
      return `${Math.min(built(ob), ob.count || 1)} / ${ob.count || 1} built · build mode: hold Cross, or B`;
    },
    force(ob) { if (ob.planned_module) { const T = sys("tiers"); if (T) T.finish(ob.module); } },
  };
  const MODULES_NAME = { landing_pad: "landing pad" };
  O.salvage = {
    parts(ob) { return ob.parts || (Array.isArray(ob.target) ? ob.target : null) || Array.from({ length: ob.count || 1 }, (x, i) => `${humanise(ob.target)} ${i + 1}`); },
    action(ob, P, run, m) {
      const parts = O.salvage.parts(ob), i = P.n || 0, part = parts[i % parts.length];
      const at = ob.source ? st.place(ob.source) : /lander/.test(ob.target) ? st.place("lander") : (() => { const b = st.base(); try { const mm = b && b.modules().find((x) => x.built && (Array.isArray(ob.target) ? ob.target.includes(x.type) : x.type === ob.target)); if (mm) return mm; } catch { /* none */ } return st.place(Array.isArray(ob.target) ? ob.target[0] : ob.target); })();
      return { at, r: st.onFoot() ? 8 : 25, text: `Salvage ${/lander/.test(ob.target) ? "the lander's " : ""}${humanise(part)} (${i + 1} of ${ob.count || parts.length})`, run: async () => {
        P.n = i + 1;
        const l = lines(m, ob.id)[i]; if (l) await say([l]);
        if (P.n >= (ob.count || parts.length)) st.objectiveDone(m, ob, { linesPlayed: true });
      } };
    },
    target(ob) { return ob.source ? st.place(ob.source) : /lander/.test(ob.target) ? st.place("lander") : null; },
    meta(ob, P) { return `${P.n || 0} / ${ob.count || O.salvage.parts(ob).length}`; },
  };
  O.craft = simple(() => null, (ob) => `Assemble the ${humanise(ob.item)}`, { step(ob) { st.setVar("item." + ob.item, true); return true; } });
  O.repair = {
    enter(ob, P) {
      const b = st.base(); P.faults = [];
      let mods = []; try { mods = b ? b.modules().filter((x) => x.built) : []; } catch { mods = []; }
      (ob.targets || ["fault"]).forEach((t, i) => { const mm = mods[(i * 3) % Math.max(1, mods.length)]; if (mm && b) { try { b.breach(mm.id, true); } catch { /* fine */ } } P.faults.push({ id: t, module: mm ? mm.id : null, x: mm ? mm.x : st.home().x + i * 6, z: mm ? mm.z : st.home().z, fixed: false }); });
    },
    action(ob, P, run, m) {
      const f = (P.faults || []).find((x) => !x.fixed); if (!f) return null;
      return { at: f, r: st.onFoot() ? 7 : 20, text: `Repair ${humanise(f.id)}`, run: () => { f.fixed = true; const b = st.base(); if (b && f.module) try { b.repair(f.module); } catch { /* fine */ } if (P.faults.every((x) => x.fixed)) st.objectiveDone(m, ob); } };
    },
    target(ob, P) { return (P.faults || []).find((x) => !x.fixed) || null; },
    meta(ob, P) { return `${(P.faults || []).filter((x) => x.fixed).length} / ${(P.faults || []).length} faults`; },
    force(ob, P) { const b = st.base(); for (const f of P.faults || []) { f.fixed = true; if (b && f.module) try { b.repair(f.module); } catch { /* fine */ } } },
  };
  const greenhouse = () => { const b = st.base(); try { const mm = b && b.modules().find((x) => x.built && /greenhouse/.test(x.type)); if (mm) return mm; } catch { /* none */ } const T = sys("tiers"), s = T && T.structures().find((x) => /biome/.test(x.type)); return s || st.home(); };
  O.harvest = {
    action(ob, P, run, m) { return { at: greenhouse(), r: st.onFoot() ? 9 : 25, text: `Lift the ${humanise(ob.crop)} (${P.n || 0} / ${ob.count})`, run: () => { P.n = Math.min(ob.count, (P.n || 0) + 5); if (P.n >= ob.count) st.objectiveDone(m, ob); } }; },
    target() { return greenhouse(); }, meta(ob, P) { return `${P.n || 0} / ${ob.count} ${humanise(ob.crop).toLowerCase()}`; },
  };
  O.remediate = {
    action(ob, P, run, m) { return { at: greenhouse(), r: st.onFoot() ? 9 : 25, text: `Wash a bed of perchlorate (${(P.n || 0) + 1} of ${ob.beds})`, run: () => { P.n = (P.n || 0) + 1; if (P.n >= ob.beds) st.objectiveDone(m, ob); } }; },
    target() { return greenhouse(); }, meta(ob, P) { return `${P.n || 0} / ${ob.beds} beds`; },
  };
  O.power_manage = {
    action(ob, P, run, m) {
      return { at: st.home(), r: st.onFoot() ? 40 : 80, text: "Set the power priorities", run: async () => {
        const ui = g.hud.ui, want = ob.priorities || [];
        for (let i = 0; i < want.length; i++) {
          const opts = want.slice().sort((a, b) => (a + i).localeCompare(b + i));
          const k = ui && ui.choose ? await ui.choose({ prompt: `Priority ${i + 1} of ${want.length}: what stays powered ${i === 0 ? "first" : "next"}?`, options: opts.map((x) => humanise(x)), style: "radio" }) : want.indexOf(want[i]);
          if (opts[k] !== want[i]) { await say([{ speaker: "KEEPER", text: "Priority order rejected. Life support first." }], { style: "radio" }); return; }
        }
        st.objectiveDone(m, ob);
      } };
    },
    meta(ob) { return "at the base: life support, then the crew, then comms"; },
  };
  O.survive = {
    enter(ob, P) { P.t = P.t || 0; },
    poll(ob, P, run, m, dt, simDt) {
      if (ob.storm && !P.stormOn) {
        P.stormOn = true;
        const W = getSystem("weather"), Ms = getSystem("missions"), M = Ms && Ms.missions;
        try { if (W && W.scriptStorm) W.scriptStorm(g, { kind: "regional", lead_s: 1800, ramp_s: 3600, hold_s: Math.max(1, ob.hours - 2) * 3600, clear_s: 7200, peak_tau: 3.4 }); else if (M && M._startStorm) M._startStorm(ob.hours); else g.setTau(3.4); } catch (e) { console.warn("[story] storm", e); }
        const C = sys("caretakers"); if (C) setTimeout(() => C.react("storm"), 4000);
      }
      const b = st.base(); let ok = true;
      if (ob.need === "base") { try { ok = !!b && b.modules().some((x) => /^hab/.test(x.type) && x.built && x.powered !== false && x.habitable !== false); } catch { ok = false; } }
      else ok = !g.vehicle.flat;
      if (!ok) { if (P.t > 600) toast(ob.need === "base" ? "The habitat went dark: the count starts again" : "The rover's battery went flat: the count starts again", 5); P.t = 0; return false; }
      P.t += simDt || 0;
      return P.t >= ob.hours * 3600;
    },
    meta(ob, P) { const left = Math.max(0, ob.hours * 3600 - (P.t || 0)); return `${Math.floor(left / 3600)} h ${String(Math.floor(left % 3600 / 60)).padStart(2, "0")} m to go · sleeping passes it`; },
    force(ob, P) { P.t = 1e9; },
  };
  O.sleep = {
    on(ev, d, ob, P) { if (ev !== "sleep") return false; if (ob.where === "rover" && d.where !== "rover") { toast("Sleep in the rover for this one", 3); return false; } P.n = (P.n || 0) + 1; return P.n >= (ob.count || 1); },
    action(ob, P) { return { at: null, r: 0, text: `Sleep (dormancy)${ob.where ? " in the " + ob.where : ""}`, run: () => st.sleep(ob.where) }; },
    meta(ob, P) { return `${(ob.count || 1) > 1 ? `${P.n || 0} / ${ob.count} · ` : ""}${ob.where === "rover" ? "in the rover" : "at the base or in the rover"}`; },
  };
  O.condition = {
    enter(ob) {
      // the units leave him alone: they walk off to the edge of the site
      const C = getSystem("caretakers"), q = st.place(ob.where) || st.home();
      if (C && C.caretakers) for (const u of C.caretakers.units) { if (Math.hypot(u.x - q.x, u.z - q.z) < (ob.no_units_within_m || 150) + 10) { const a = Math.atan2(u.x - q.x, u.z - q.z); u.site = null; u.goal = { x: q.x + Math.sin(a) * ((ob.no_units_within_m || 150) + 40), z: q.z + Math.cos(a) * ((ob.no_units_within_m || 150) + 40), then: "idle" }; u.state = "walk"; u.next = u.t + 600; } }
    },
    poll(ob) { const C = sys("caretakers"), q = st.place(ob.where) || st.home(); return !!q && !(C && C.nearest(q.x, q.z, ob.no_units_within_m || 150, (u) => !u.recalled)) && near(q, 60); },
    target(ob) { return st.place(ob.where) || st.home(); },
    meta(ob) { return `alone: no unit within ${ob.no_units_within_m || 150} m`; },
  };
  O.settings = {
    poll(ob) { const ui = g.hud.ui; if (!ui) return false; const s = ui.state ? ui.state() : {}; const nav = (ui.groups || []).find((x) => x.id === "navigation"); return !!(ui.hidden || (nav && nav.mode === "off") || (s && s.groups && s.groups.navigation === "off")); },
    meta() { return "Settings > Interface: Navigation off (or F1 hides everything)"; },
    force() {},
  };

  /* ── HALO-1 ── */
  O.request_package = {
    enter(ob) { const H = sys("halo"); if (H && !H.enabled && st.S.act !== "fugitive") H.setEnabled(true); },
    on(ev, d, ob, P) { if (ev !== "package_requested" || !d) return false; if (d.kind !== ob.kind && !(ob.unit && d.unit === ob.unit)) return false; P.pkg = d.id; return true; },
    action(ob) { return { at: null, r: 0, text: "Open the HALO-1 uplink", run: () => st.openUplink(true) }; },
    meta(ob) { const H = sys("halo"), c = H && H.cc(); return `U, or the menu: HALO-1 uplink${c ? ` · ${c.free} CC free` : ""}`; },
    force(ob, P, run, m) {
      const H = sys("halo"); if (!H) return;
      const want = st._uplinkWant() || {}, drop = (ob.drop && ob.drop.marker && st.place(ob.drop.marker)) || st.playerPos();
      const r = H.request(want.kind || ob.kind, { x: drop.x + 30, z: drop.z + 20, unit: ob.unit, story: true, mission: m.id, id: want.id, free: true });
      if (r.ok) P.pkg = r.pkg.id;
    },
  };
  O.await_package = {
    pkg(ob, run, m) { const H = sys("halo"); if (!H) return null; return H.get(ob.package) || H.packages().filter((p) => p.mission === m.id).slice(-1)[0] || null; },
    on(ev, d, ob, P, run, m) { if (ev !== "package_landed" || !d) return false; const p = O.await_package.pkg(ob, run, m); return !!p && p.id === d.id; },
    poll(ob, P, run, m) { const p = O.await_package.pkg(ob, run, m); return !!p && p.phase === "landed"; },
    target(ob, P, run, m) { const p = O.await_package.pkg(ob, run, m); return p ? { x: p.x, z: p.z, name: "the drop point" } : null; },
    meta(ob, P, run, m) { const p = O.await_package.pkg(ob, run, m); if (!p) return "request it first"; if (p.phase === "final") return "inbound: look east"; const l = Math.max(0, p.left); return `descent T-${Math.floor(l / 60)}:${String(Math.floor(l % 60)).padStart(2, "0")} (game minutes)`; },
    force(ob, P, run, m) { const p = O.await_package.pkg(ob, run, m), H = sys("halo"); if (p && H) H.landNow(p.id); },
    /** KEEPER (or the mission's own waiting lines) at ten, five and one minute. */
    countdown(d) {
      const S = st.S;
      for (const id of Object.keys(S.active)) {
        const m = st.D.mission(id), run = S.active[id], ob = m.objectives.find((o) => o.type === "await_package" && !run.done[o.id]);
        if (!ob) continue;
        const own = lines(m, ob.id), idx = { 10: 1, 5: 2, 1: 4 }[d.minutes];
        if (own.length && own[idx]) { say(idx === 4 && own[3] ? [own[3], own[4]] : [own[idx]]); return; }
      }
      speech(g).say({ 10: "KEEPER.bark.pkg_10min", 5: "KEEPER.bark.pkg_5min", 1: "KEEPER.bark.pkg_1min" }[d.minutes], { style: "radio", bark: true });
    },
  };
  O.stow_supplies = simple((ob) => st.place(ob.package) || st.home(), "Stow the supplies", { r: 8 });
  O.link_station = simple(() => { const b = st.base(); try { const mm = b && b.modules().find((x) => x.built && /comms/.test(x.type)); if (mm) return mm; } catch { /* none */ } return st.place("lander"); }, "Link to HALO-1", {
    step() { const b = st.base(); let power = false; try { power = !!b && b.modules().some((x) => x.built && /solar|battery/.test(x.type)); } catch { power = false; } if (!power) { toast("No power for the antenna<small>deploy the solar array first</small>", 3.5); return false; } const H = sys("halo"); if (H) H.setEnabled(true); st.S.vars["halo.linked"] = true; return true; },
  });

  /* ── the people ── */
  const talkLines = (ob, m) => {
    const D = st.D, own = lines(m, ob.id);
    if (own.length) return own;
    const o = D.others[ob.unit];
    if (o && o.meet) return o.meet;
    const F = D.founders[ob.unit] || D.second[ob.unit];
    if (F) { if (ob.topic && F.beats && F.beats[ob.topic]) return F.beats[ob.topic]; if (F.memory_fragment) return [F.memory_fragment]; const idle = F.idle && !Array.isArray(F.idle) ? F.idle[st.S.act] || [] : F.idle || []; return idle.slice(0, 2); }
    if (D.others.GALE_ANVIL && ob.unit === "GALE_ANVIL") return D.others.GALE_ANVIL.idle.slice(0, 2);
    return [];
  };
  O.talk = {
    action(ob, P, run, m) {
      const at = unitPlace(ob.unit, ob), name = ob.callsign || String(ob.unit).replace(/_/g, " ");
      return { at, r: st.onFoot() ? 6 : 16, text: `Talk to ${name}`, run: async () => {
        // after the archive opens he may use the donor's name (never ANVIL's: C15 does that)
        const D = st.D, F = D.founders[ob.unit] || D.second[ob.unit];
        await st.offerName(ob.unit);
        const cs = ob.cutscene || (D.cut.cutscenes.find((c) => !st.S.seen[c.id] && c.trigger.on === "talk" && c.trigger.unit === ob.unit && (!c.trigger.mission || st.S.active[c.trigger.mission])) || {}).id;
        if (cs && !st.S.seen[cs]) { await st.playCutscene(cs); st.objectiveDone(m, ob, { linesPlayed: true }); return; }
        await say(talkLines(ob, m));
        st.objectiveDone(m, ob, { linesPlayed: true });
      } };
    },
    target(ob) { return unitPlace(ob.unit, ob); },
    meta(ob) { const q = unitPlace(ob.unit, ob); return q ? fmtM(st.dist(q)) : ""; },
    relaxed: true,
  };
  O.deliver = simple(() => { const s = st.S.focus && st.D.mission(st.S.focus); return s && s.giver ? unitPlace(s.giver) : st.home(); }, (ob) => `Hand over ${ob.count > 1 ? ob.count + " × " : ""}${humanise(ob.item).toLowerCase()}`, { r: 8, more: { relaxed: true } });
  O.diagnose = simple((ob) => (ob.target === "self" ? null : unitPlace(ob.target)), (ob) => `Run a suit diagnostic on ${ob.target === "self" ? "yourself" : ob.target}`, { r: 7 });
  O.host_meal = simple(() => st.place("table_long") || st.home(), "Host the meal", {
    r: 25,
    before: async (ob) => { const C = sys("caretakers"), h = st.place("table_long") || st.home(); (ob.guests || []).forEach((u, i) => { if (C) C.spawn({ callsign: u, founder: true, x: h.x + Math.sin(i) * 4, z: h.z + Math.cos(i) * 4 }); }); },
  });
  O.warn = {
    action(ob, P, run, m) { return { at: null, r: 0, text: `Warn ${ob.unit} (open channel)`, run: async () => { st.setVar("warned." + ob.unit, true); await say([{ speaker: "P1", text: `${ob.unit}. It's me. They're coming for the units. I'm sorry. I wanted you to know.` }]); st.objectiveDone(m, ob, { linesPlayed: true }); } }; },
    meta(ob) { return "warning saves no one"; }, relaxed: true,
  };
  O.event = {
    enter(ob, P, run, m) {
      const id = ob.event;
      if (/^recall_/.test(id)) {
        // the Recall reaches the founders in a fixed order, a little apart: their last words over the open channel
        const order = m.objectives.filter((o) => o.type === "event" && /^recall_/.test(o.event)).map((o) => o.event), k = order.indexOf(id);
        P.at = performance.now() / 1000 + 18 + k * 2;
        return;
      }
      P.at = performance.now() / 1000 + (id === "korolev_lake_full" ? 30 : 12);
    },
    poll(ob, P, run, m) {
      if (P.firing || performance.now() / 1000 < (P.at || 0)) return false;
      P.firing = true;
      const id = ob.event;
      (async () => {
        if (/^recall_/.test(id)) {
          const unit = id.replace(/^recall_/, "").toUpperCase(), F = st.D.founders[unit] || st.D.second[unit], warned = !!st.S.vars["warned." + unit];
          // named before the Recall: the unit dies knowing who it was (bible draft 3): named_warned / named_unwarned
          // (or a single "named" set), else warned / unwarned
          const named = !!st.S.vars["names.used." + unit], R = F && F.recall;
          const pick = (k) => (R && Array.isArray(R[k]) && R[k].length ? R[k] : null);
          const ls = R ? (named && (pick(warned ? "named_warned" : "named_unwarned") || pick("named"))) || pick(warned ? "warned" : "unwarned") : null;
          if (Array.isArray(ls)) await say(ls, { preset: "radio" });
          const C = sys("caretakers"); if (C) C.recall(unit);
          toast(`${esc(unit)}: recalled<small>${esc((F && F.recall && F.recall.location) || "")}</small>`, 4);
        } else { toast(`${esc(humanise(id))}`, 4); }
        st.event(id);
        st.objectiveDone(m, ob);
      })();
      return false;
    },
    on(ev, d, ob) { return ev === "event" && d.event === ob.event; },
    meta(ob) { return /^recall_/.test(ob.event) ? "nothing he does can stop it" : ""; },
  };
  O.watch = {
    enter(ob, P) { P.t = 0; },
    poll(ob, P, run, m, dt) {
      if (ob.cutscene) {
        if (st.S.seen[ob.cutscene]) return true;
        // an automatic trigger (a package landing, reaching the pod) plays it; otherwise it plays now, or at its place
        const c = st.D.cutscene(ob.cutscene), auto = c && /^(package_landed|reach)$/.test(c.trigger.on);
        if (!auto && !P.playing && (!ob.poi || near(st.place(ob.poi), 30))) { P.playing = true; st.playCutscene(ob.cutscene); }
        return false;
      }
      // a world event to watch: the Covenant's landers come down on the pads
      if (!P.started) { P.started = true; O.watch._landers(ob); }
      P.t += dt;
      return P.t >= Math.min(ob.duration_s || 60, 75);
    },
    _landers(ob) {
      const H = getSystem("halo"), h = st.home();
      if (!H || !H.halo) return;
      for (let k = 0; k < 6; k++) { const pk = { id: "covenant_" + k, kind: "supplies_package", x: h.x + 120 + k * 22, z: h.z - 80 + (k % 2) * 30, cost: 0, minutes: 0, total: 0, left: 0, phase: "descent", story: true, said: { 10: 1, 5: 1, 1: 1 } }; H.halo.pk.push(pk); setTimeout(() => H.halo._final(pk), k * 2500); }
      void ob;
    },
    target(ob) { return ob.poi ? st.place(ob.poi) : null; },
    meta(ob, P) { return ob.cutscene ? "" : `${Math.round(P.t || 0)} s`; },
    force(ob) { if (ob.cutscene) st.S.seen[ob.cutscene] = st.S.seen[ob.cutscene] || { forced: true }; },
  };
  O.ask_keeper = {
    on(ev, d, ob, P, run, m) {
      if (ev !== "ask_keeper" || d.id !== ob.question_id) return false;
      if (ob.cutscene && !st.S.seen[ob.cutscene] && !d.viaCutscene) { st.playCutscene(ob.cutscene).then(() => st.objectiveDone(m, ob)); return false; }
      return true;
    },
    action() { return { at: null, r: 0, text: "Open the KEEPER terminal", run: () => st.openKeeper(true) }; },
    meta() { return "J at a base, or the menu: KEEPER terminal · ask it exactly"; },
    relaxed: true,
  };
  O.interact = {
    placeFor(ob) {
      const o = ob.object;
      if (/^lander_/.test(o)) return st.place("lander");
      if (o === "comms_tower") return st.place("comms_tower");
      if (o === "rover_intercom") return st.place("rover");
      if (o === "suit_radio") return null;
      return st.place(o) || st.home();
    },
    action(ob, P, run, m) {
      const at = O.interact.placeFor(ob);
      return { at, r: at ? (st.onFoot() ? 7 : 25) : 0, text: ob.text, run: async () => {
        if (ob.consequence) st.setVar(ob.consequence, true);
        if (ob.action === "scratch_names") { const names = st._namesUsed(); await say(lines(m, ob.id).length ? lines(m, ob.id) : [{ speaker: "P1", text: "Desmond Kerr." }]); if (names.length) toast(`Scratched into the rock<small>${esc(names.join(" · "))}</small>`, 8); }
        const cs = ob.cutscene || (st.D.cut.cutscenes.find((c) => !st.S.seen[c.id] && c.trigger.on === "interact" && c.trigger.object === ob.object && (!c.trigger.mission || st.S.active[c.trigger.mission])) || {}).id;
        if (ob.collectible) await st.collect(ob.collectible);
        if (cs && !st.S.seen[cs]) { await st.playCutscene(cs); st.objectiveDone(m, ob, { linesPlayed: true }); return; }
        st.objectiveDone(m, ob);
      } };
    },
    target(ob) { return O.interact.placeFor(ob); },
    meta(ob) { const q = O.interact.placeFor(ob); return q ? `${fmtM(st.dist(q))} · E` : "hold E"; },
  };
  O.open_panel = {
    on(ev, d) { return ev === "open_panel"; },
    poll() { return g.mode === "menu" && !g.storyHold; },
    meta() { return "open the menu (Esc / Options) or the Story log (O)"; },
  };
  O.inspect = {
    action(ob, P, run, m) {
      const left = (ob.items || []).filter((x) => !(P.seen || []).includes(x)); if (!left.length) return null;
      const it = left[0], at = st.place(it);
      return { at, r: st.onFoot() ? 7 : 20, text: `Examine the ${humanise(it).toLowerCase()}`, run: async () => {
        P.seen = (P.seen || []).concat(it);
        if (ob.force_open) { if (g.hud.ui && g.hud.ui.glitch) g.hud.ui.glitch(0.5, 0.6); toast("Forced open<small>every ration delivered is in here. Sealed. None of them was ever opened.</small>", 7); }
        if (P.seen.length >= (ob.items || []).length) st.objectiveDone(m, ob);
      } };
    },
    meta(ob, P) { return `${(P.seen || []).length} / ${(ob.items || []).length}`; },
    target(ob, P) { const left = (ob.items || []).filter((x) => !(P.seen || []).includes(x)); return left.length ? st.place(left[0]) : null; },
  };
  O.choose = {
    enter(ob, P, run, m) { P.t = 0; },
    poll(ob, P, run, m) {
      if (P.asking) return false;
      if (st.cs.active) return false;
      P.asking = true;
      (async () => {
        const D = st.D, def = ob.options ? { choice_id: ob.choice_id, options: ob.options } : D.choice(ob.choice_id);
        if (!def) { st.objectiveDone(m, ob); return; }
        const opts = def.options.filter((o) => !o.if || evalCond(o.if, st.S.vars));
        let k = g.hud.ui && g.hud.ui.choose ? await g.hud.ui.choose({ options: opts.map((o) => o.label), prompt: def.prompt || ob.text, style: "live" }) : 0;
        if (k < 0) { P.asking = false; return; }
        const o = opts[k];
        st.setVar("choice." + ob.choice_id, o.id);
        for (const [key, v] of Object.entries(o.set || {})) st.setVar(key, v);
        if (o.lines) await say(o.lines);
        st.notify("choose", { choice_id: ob.choice_id, option: o.id });
        st.objectiveDone(m, ob, { linesPlayed: true });
      })();
      return false;
    },
    // the final choice (and any other made elsewhere, in a cutscene or the dev skip) counts wherever it was made
    on(ev, d, ob, P, run, m) { if (ev !== "choose" || d.choice_id !== ob.choice_id || P.asking) return false; if (ob.choice_id === "final") setTimeout(() => st.finishMission(m.id), 0); return true; },
    relaxed: true,
    meta() { return "a choice"; },
  };
  O.choose_site = {
    poll(ob, P, run, m) {
      if (P.asking || st.cs.active) return false;
      P.asking = true;
      (async () => {
        const k = g.hud.ui && g.hud.ui.choose ? await g.hud.ui.choose({ prompt: ob.text, options: ob.options.slice(0, 4).map((x) => humanise(x)) }) : 0;
        if (k < 0) { P.asking = false; return; }
        st.setVar("hideout.site", ob.options[k]);
        st.S.markers.hideout_site = Object.assign({ name: humanise(ob.options[k]) }, st.place(ob.options[k]));
        st.objectiveDone(m, ob);
      })();
      return false;
    },
  };
  O.memory = {
    poll(ob, P, run, m) {
      if (P.playing || st.cs.active) return false;
      P.playing = true;
      (async () => {
        const ui = g.hud.ui, ls = lines(m, ob.id);
        if (ui && ui.cutscene) ui.cutscene.start({ letterbox: true, skippable: true, onSkip: () => speech(g).clear() });
        if (ui && ui.still) ui.still({ src: null, caption: "", seconds: 0.1 });
        await say(ls.length ? ls : [{ speaker: "P1_MEM", text: "..." }], { style: "memory" });
        if (ui && ui.cutscene && ui.cutscene.active) ui.cutscene.end();
        st.objectiveDone(m, ob, { linesPlayed: true });
      })();
      return false;
    },
  };
  O.memory_spiral = {
    poll(ob, P, run, m) {
      if (P.playing || st.cs.active) return false;
      P.playing = true;
      (async () => {
        const ui = g.hud.ui, rooms = ob.rooms || ["room"], guide = ob.guide_voice || "ANVIL";
        if (ui && ui.cutscene) ui.cutscene.start({ letterbox: true, skippable: false });
        for (let i = 0; i < rooms.length;) {
          if (ui && ui.card) await ui.card({ eyebrow: `SPIRAL · ${i + 1} / ${rooms.length}`, title: humanise(rooms[i]).toUpperCase(), sub: "the same room again, and not quite", seconds: g.headless ? 0.2 : 2.4 });
          const voices = [guide, "LUCY", "ALICE"].sort((a, b) => ((a + i).length % 3) - ((b + i).length % 3));
          const k = ui && ui.choose ? await ui.choose({ prompt: "Voices, from three doors. Follow one.", options: voices.map((v) => (v === guide ? `${v}: "Pioneer. This way. Look at the sensor bar."` : v === "LUCY" ? 'LUCY: "Stay. Just a bit longer."' : 'ALICE: "Daddy, come and see."')), style: "memory" }) : voices.indexOf(guide);
          if (voices[k] === guide) i++;
          else if (ui && ui.glitch) ui.glitch(0.6, 0.6);
        }
        if (ui && ui.cutscene && ui.cutscene.active) ui.cutscene.end();
        st.objectiveDone(m, ob);
      })();
      return false;
    },
    force(ob, P) { P.playing = true; },
  };
  O.recite_poem = {
    async recite(ob, m) {
      const g2 = g, D = st.D, S = st.S;
      const at = ob && ob.at ? st.place(ob.at) : null;
      if (at && !near(at, 30)) { toast(`Not here<small>at ${esc(at.name)}</small>`, 3); return false; }
      await say(D.memory.poem.lines, { style: "live", preset: "helmet" });
      // from Act II every recital shows the resolve bonus (clue 4); the 2.6 recital is the big one
      if (S.act !== "prologue" && S.act !== "I" && S.act !== "V" && S.act !== "fugitive") {
        const P = getSystem("progress"), dome = m && m.id === "2.6";
        if (S.poemSol !== g2.state.clock.sol || dome) { S.poemSol = g2.state.clock.sol; if (P && P.api) P.api.award(dome ? 50 : 15, "RESOLVE BONUS"); }
        st.clue("4");
      }
      const C = getSystem("caretakers"); if (C && C.api) setTimeout(() => C.api.react("poem"), 1500);
      st.notify("poem", {});
      return true;
    },
    action(ob, P, run, m) { const at = ob.at ? st.place(ob.at) : null; return { at, r: at ? 30 : 0, text: "Recite the poem", run: async () => { if (await O.recite_poem.recite(ob, m)) st.objectiveDone(m, ob, { linesPlayed: false }); } }; },
    target(ob) { return ob.at ? st.place(ob.at) : null; },
    meta() { return "hold E, or the Story log"; },
  };
  O.look = {
    dir(ob) {
      if (ob.target === "own_hands") return null;
      const q = st.place(ob.target); if (!q) return null;
      const c = g.camera.position, y = g.surface.height(q.x, q.z) + 1.5;
      const dx = q.x - c.x, dy = y - c.y, dz = q.z - c.z, d = Math.hypot(dx, dy, dz) || 1; return [dx / d, dy / d, dz / d];
    },
    poll(ob, P, run, m, dt) {
      const f = [0, 0, -1]; const q = g.camera.quaternion, x = q.x, y = q.y, z = q.z, w = q.w;
      const fx = -(2 * (x * z + w * y)), fy = -(2 * (y * z - w * x)), fz = -(1 - 2 * (x * x + y * y)); void f;
      let ok;
      if (ob.target === "own_hands") ok = fy < -0.7;
      else { const d = O.look.dir(ob); ok = !!d && fx * d[0] + fy * d[1] + fz * d[2] > 0.985; }
      if (ok) { P.t = (P.t || 0) + dt; if (ob.during === "glitch" && !P.g) { P.g = true; if (g.hud.ui && g.hud.ui.glitch) g.hud.ui.glitch(0.8, 1.4); st.notify("glitch", { intensity: 0.8, seconds: 0.6, unfiltered: true }); } }
      else P.t = 0;
      return P.t >= 1.5;
    },
    target(ob) { return ob.target === "own_hands" ? null : st.place(ob.target); },
    meta(ob) { return ob.target === "own_hands" ? "look down at your hands (camera)" : "look at it for a moment"; },
    force(ob, P) { P.t = 9; },
  };
  O.photograph = simple((ob) => (/transit|colonists/.test(ob.target) ? null : st.place(ob.target)), (ob) => `Take a photograph: ${humanise(ob.target).toLowerCase()}`, {
    r: 400,
    before: async () => { const el = document.createElement("div"); el.className = "story-flash"; document.body.appendChild(el); setTimeout(() => el.remove(), 500); },
  });
  O.stargaze = {
    action(ob, P, run, m) {
      if (P.busy) return null;
      const at = ob.where ? st.place(ob.where) : null;
      return { at, r: at ? 60 : 0, text: `Stargaze${ob.target ? ": " + st._skyName(ob.target).toLowerCase() : ""}${ob.time ? " at " + ob.time : ""}`, run: async () => {
        P.busy = true;
        const r = await st.stargaze({ target: ob.target, time: ob.time, duration_s: ob.duration_s, glitch: ob.glitch, expect: ob.expect, fast: g.headless });
        P.busy = false;
        if (!r || !r.done) return;
        P.n = (P.n || 0) + 1;
        if (P.n < (ob.count || 1)) { toast(`Logged<small>${P.n} of ${ob.count}</small>`, 3); return; }
        if (ob.expect === "absent") toast(`${esc(st._skyName(ob.target))}: not where it should be`, 4);
        if (ob.target === "city_lights_night_side") { st.objectiveDone(m, ob); if (m.id === "F.6") st._finalCard("high_lonely"); return; }
        if (ob.cutscene && !st.S.seen[ob.cutscene]) { await st.playCutscene(ob.cutscene); st.objectiveDone(m, ob, { linesPlayed: true }); return; }
        st.objectiveDone(m, ob);
      } };
    },
    target(ob) { return ob.where ? st.place(ob.where) : null; },
    meta(ob, P) { return `${(ob.count || 1) > 1 ? `${P.n || 0} / ${ob.count} · ` : ""}${ob.time || "night"} · hold E${ob.where ? " at the place" : ""}`; },
    force(ob, P, run, m) { if (m && m.id === "F.6" && ob.target === "city_lights_night_side") setTimeout(() => st._finalCard("high_lonely"), 50); },
  };
  O.track_object = {
    action(ob, P, run, m) {
      const sol = g.state.clock.sol, done = P.nights || [];
      // one night is earlier objectives' too (night1, night2, night3 share the log)
      const log = st.S.vars["sky.log." + ob.object] || [];
      if (log.includes(sol) || P.busy) return null;
      return { at: null, r: 0, text: `Log ${st._skyName(ob.object).toLowerCase()} in the sky log`, run: async () => {
        P.busy = true; const r = await st.stargaze({ target: ob.object, fast: g.headless }); P.busy = false;
        if (!r || !r.done) return;
        const l = (st.S.vars["sky.log." + ob.object] || []).concat(sol); st.S.vars["sky.log." + ob.object] = l; P.nights = done.concat(sol);
        if (l.length >= (ob.nights || 1)) st.objectiveDone(m, ob); else toast(`Logged: night ${l.length} of ${ob.nights}<small>sleep, and look again tomorrow night</small>`, 4);
      } };
    },
    poll(ob) { return (st.S.vars["sky.log." + ob.object] || []).length >= (ob.nights || 1); },
    meta(ob) { const n = (st.S.vars["sky.log." + ob.object] || []).length; return `nights logged ${n} / ${ob.nights || 1}${n ? " · one a night: sleep between" : ""}`; },
    force(ob) { const l = st.S.vars["sky.log." + ob.object] || []; while (l.length < (ob.nights || 1)) l.push(-l.length - 1); st.S.vars["sky.log." + ob.object] = l; },
  };
  O.listen = {
    action(ob, P, run, m) { if (P.busy) return null; return { at: null, r: 0, text: `Tune the radio: ${humanise(ob.channel).toLowerCase()}`, run: async () => {
      P.busy = true;
      const D = st.D, own = lines(m, "network").length ? lines(m, "network") : (D.others.PIONEER_N && D.others.PIONEER_N.act_iv) || [];
      const t0 = performance.now();
      await say(own, { preset: "radio" });
      const left = Math.max(0, 60 - (performance.now() - t0) / 1000) * (g.headless ? 0.01 : 1);
      if (left > 0) await new Promise((r) => setTimeout(r, left * 1000));
      P.busy = false;
      st.objectiveDone(m, ob, { linesPlayed: true });
    } }; },
    meta() { return "a minute on the channel"; },
  };
  O.record = {
    action(ob, P, run, m) {
      const sol = g.state.clock.sol, night = g.sky && g.sky.sun.sinEl < 0;
      if ((P.sols || []).includes(sol)) return null;
      return { at: null, r: 0, text: night ? `Record ${ob.source}'s broadcast` : `Record ${ob.source}'s broadcast (it is on at night)`, run: async () => {
        if (!(g.sky && g.sky.sun.sinEl < 0)) { await st.stargaze({ time: "night", fast: g.headless }); }
        P.sols = (P.sols || []).concat(g.state.clock.sol);
        const C = getSystem("caretakers"); if (C && C.api) C.api.bark(ob.source, "idle");
        if (P.sols.length >= (ob.count || 1)) st.objectiveDone(m, ob); else toast(`Recorded: night ${P.sols.length} of ${ob.count}`, 3);
      } };
    },
    meta(ob, P) { return `${(P.sols || []).length} / ${ob.count || 1} nights`; },
    force(ob, P) { P.sols = Array.from({ length: ob.count || 1 }, (x, i) => -i - 1); },
    poll(ob, P) { return (P.sols || []).length >= (ob.count || 1); },
  };
  O.evade = {
    enter(ob, P) { P.t = 0; P.clear = 0; st.S.hunters = true; P.goal = Math.min((ob.radius_km || 40) * 1000, 4000); },
    poll(ob, P, run, m, dt) {
      const h = st.home(), d = st.dist(h), seen = !!st.S.vars["hunters.seen"];
      P.t += dt; P.clear = seen ? 0 : P.clear + dt;
      return (d >= P.goal && P.clear > 30) || (P.t >= Math.min(ob.duration_s || 600, 600) && P.clear > 60);
    },
    meta(ob, P) { const d = st.dist(st.home()); return `${fmtM(d)} / ${fmtM(P.goal || 4000)} from the city${st.S.vars["hunters.seen"] ? " · SEEN" : ` · unseen ${Math.round(P.clear || 0)} s`}${(ob.radius_km || 0) > 4 ? " (scaled to the site)" : ""}`; },
    force(ob, P) { P.t = 1e9; P.clear = 1e9; P.goal = 0; },
  };
  return O;
}
export { PLANNED, MARS };
