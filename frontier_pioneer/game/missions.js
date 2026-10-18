/**
 * MISSIONS: a small framework, the Jezero chain, and the screens.
 *
 * System "missions" (order 70). A mission is data:
 *
 *   { id, title, short, briefing: [paragraphs], facts: [{text, source}],
 *     requires: null | "base" | "weather",          // a system that must be present, else the mission is "unavailable"
 *     objectives: [ { id, type, text, ...params, optional } ],
 *     rewards: { materials, unlocks: [module ids], bonus: { materials } }, debrief }
 *
 * Objective types (all of them drive the ONE objective tracker in the HUD):
 *   reach    { poi | x, z, r, by: "rover" | "foot" }     get there
 *   eva      {}                                          step out of the rover
 *   sample   { zone, count }                             collect cores / regolith inside the zone
 *   deposit  { zone, count }                             lay tubes at the depot
 *   plant    { what: "flag" | "beacon", zone, count }
 *   scan     { zone, count, spacing, slopeMin }          scans at least `spacing` apart
 *   survive  { hours, need: "rover" | "base" }           simulated hours with the condition holding
 *   return   { to: "rover" | "refuge" }
 *   build    { match: RegExp source, count }             base system: built modules whose type matches
 *   sustain  { }                                         base system: a habitable, powered habitat
 * Objectives run in order; `optional` ones are bonuses scored whenever they
 * happen while the mission is open.
 *
 *   getSystem("missions").api = { current, list, complete(id), on(event, fn), unlocked(), bank(),
 *                                 status(id), announce(), briefing(), log(), depots(), wants(type, x, z) }
 *   events: "start" | "objective" | "complete" | "unlock" | "freeplay"
 *
 * THE OLD ROUTE. The foundation's state.objectives {route, index, reached}
 * is kept as the record of which published waypoints the rover has reached:
 * `index` is read when a save loads (so a save made before missions existed
 * resumes at the right mission) and written when a route waypoint is reached.
 * While this system runs it marks state.objectives as managed (state.js then
 * leaves it alone) and supplies the HUD's target and text.
 */
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { MARS, ATMOSPHERE } from "./config.js?v=6d37c9c-9b39e129";
import { clockText, solsBetween } from "./state.js?v=6d37c9c-9b39e129";

const H = 3600;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtM = (m) => m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
const hide = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true });   // on the state, never in the save

/* ── content ──────────────────────────────────────────────────────────────── */

const M20 = "NASA/JPL Mars 2020 waypoints (mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json)";
const BASE_MISSIONS = (where) => [
  { id: "foothold", title: "Foothold", short: "Choose a site and build a first habitat, power and an airlock", requires: "base",
    briefing: [`Time to stay. Pick ground near ${where} that the data says is flat and firm (scan it: the builder refuses slopes it cannot level), then put down the three things a crew cannot do without: somewhere pressurised to live, something to power it, and a door.`,
      "The lander's stock of materials is enough for all three. What you earned on the earlier missions is added to it."],
    facts: [{ text: "Slope and roughness at a site come from the HiRISE or CTX terrain model under it; the game labels which.", source: "site manifest" }],
    objectives: [
      { id: "hab", type: "build", match: "^hab", count: 1, text: "Build a habitat" },
      { id: "power", type: "build", match: "solar|battery|rtg|power", count: 1, text: "Build a power source" },
      { id: "airlock", type: "build", match: "airlock|hab_hdu", count: 1, text: "Build an airlock" },
    ],
    rewards: { materials: 150, unlocks: ["greenhouse", "water_tank", "oxygen_tank"] }, debrief: "A pressurised volume, a power bus and a way in and out: a base. The airlock is now a refuge on foot, and refills the suit." },
  { id: "overnight", title: "Overnight", short: "Keep the base alive through a night", requires: "base",
    briefing: ["The Sun sets and the array gives nothing for half a sol, while the heaters work hardest: the air drops from about -20 C to -80 C. A habitat that loses power falls back on its own reserve for a few hours and then stops being habitable.",
      "Keep a habitat powered and pressurised for 14 hours. Batteries are the obvious answer; shedding loads is the cheap one. Time warp (in the rover) passes the night quickly."],
    facts: [{ text: "Jezero's air temperature swings between roughly -83 C before dawn and -22 C in the afternoon (Perseverance's MEDA).", source: "Rodriguez-Manfredi et al. 2023, Nature Geoscience" }],
    objectives: [{ id: "night", type: "survive", hours: 14, need: "base", text: "Keep a habitat powered and habitable for 14 hours" }],
    rewards: { materials: 200, unlocks: ["isru_plant", "garage"] }, debrief: "The base carried itself through the dark. From here it can grow toward making its own oxygen and water." },
];
const STORM = (home, homeName) => ({ id: "storm", title: "Storm", short: "A regional dust storm: live on what the battery holds", requires: null,
  briefing: ["Orbiters are tracking a regional dust storm that will reach this area within hours. Under it the sky's optical depth goes above 3 and a solar array gives a small fraction of its clear-sky power.",
    `Get the rover back to ${homeName} before it closes in, then sit it out: fourteen hours on what the battery holds. Driving on sand costs about 2 kWh per kilometre; the hotel loads never stop. On foot, the cold and the dust cost the suit more too.`],
  facts: [{ text: "The 2018 global dust storm raised the optical depth at Opportunity above 10 and ended that rover's mission; regional storms of tau 2 to 4 are common in the dusty season.", source: "NASA/JPL; Guzewich et al. 2019, GRL" }],
  objectives: [
    { id: "home", type: "reach", poi: home, r: 60, by: "rover", text: `Drive the rover back to ${homeName}` },
    { id: "ride", type: "survive", hours: 14, need: "rover", storm: true, text: "Ride out the storm: 14 hours without the rover's battery going flat" },
  ],
  rewards: { materials: 250, unlocks: ["comms_tower", "regolith_berm"] }, debrief: "The storm passed and the rover still had charge. That is the last of the scripted missions: the crater is yours." });

function jezeroChain(site) {
  return [
    { id: "touchdown", title: "Touchdown", short: "Drive to Three Forks",
      briefing: ["You are down at Octavia E. Butler Landing, where Perseverance touched down on 18 February 2021. The crew rover is charged and the Sun is up.",
        "Drive west across the crater floor to Three Forks, the flat ground below the delta where the real mission later built its sample depot: 2.4 km as the crow flies. Watch the battery and the sand; low range gets you out of what the throttle gets you into."],
      facts: [{ text: "Perseverance landed in Jezero crater on 18 February 2021; the landing site and Three Forks are the rover's own localised positions.", source: M20 }],
      objectives: [{ id: "drive", type: "reach", poi: "three_forks", r: 30, by: "rover", text: "Drive to Three Forks" }],
      rewards: { materials: 60 }, debrief: "The rover is at Three Forks. Perseverance needed about 650 sols to get here by way of the crater floor campaign; you were in less of a hurry." },
    { id: "first_core", title: "First core", short: "Walk to an outcrop at the delta front and collect a sample",
      briefing: ["The foot of the western delta is 400 m west of Three Forks, at Hawksbill Gap. Its layered rocks were laid down in the lake that once filled this crater: the reason anyone came to Jezero.",
        "Drive to the delta front, stop, and step outside (hold L1 + R1 together, or E). On foot the suit is your budget: oxygen, battery and the CO2 scrubber, with the rover as your refuge. Find a rock within 150 m of the marker, hold Use beside it to core it, and walk back to the rover's rear hatch before the suit's turn-back warning becomes a problem."],
      facts: [{ text: "Perseverance took its first delta-front cores in July and August 2022: Swift Run and Skyland from Skinner Ridge, Hazeltop and Bearwallow from Wildcat Ridge, all in Hawksbill Gap.", source: "NASA Mars 2020 sample reports (mars.nasa.gov/mars-rock-samples)" }],
      objectives: [
        { id: "drive", type: "reach", poi: "delta_front", r: 45, text: "Drive to the delta front at Hawksbill Gap" },
        { id: "out", type: "eva", text: "Stop and step outside (hold L1 + R1, or E)" },
        { id: "core", type: "sample", zone: { poi: "delta_front", r: 150 }, count: 1, text: "Core a rock within 150 m of the delta front" },
        { id: "back", type: "return", to: "refuge", text: "Walk back and get in (hold Use at the rear hatch)" },
      ],
      rewards: { materials: 80, unlocks: ["storage_crate"] }, debrief: "One sealed tube. The rock you cored is generated (nothing in the data resolves a 40 cm rock), but the ground it stood on is the real HiRISE terrain of Hawksbill Gap." },
    { id: "depot", title: "Depot", short: "Place sample tubes at Three Forks",
      briefing: ["Samples are no use in a bag. Perseverance laid ten tubes on the flat ground at Three Forks as a backup cache, each photographed and located to the centimetre, in a zigzag so a later lander could reach any one of them.",
        "Go back to Three Forks. You need two tubes: core or scoop a second sample on the way or on the floor there. Lay them at least two metres apart (hold Use), and plant a flag so the depot can be found again."],
      facts: [{ text: "Perseverance deposited ten sample tubes at Three Forks between 21 December 2022 and 28 January 2023, 5 to 15 m apart in a zigzag.", source: "NASA/JPL, Three Forks Sample Depot; " + M20 }],
      objectives: [
        { id: "go", type: "reach", poi: "three_forks", r: 30, text: "Return to Three Forks" },
        { id: "second", type: "sample", count: 1, text: "Collect a second sample (any rock, or regolith at the depot)", zone: { poi: "three_forks", r: 600 }, have: 2 },
        { id: "lay", type: "deposit", zone: { poi: "three_forks", r: 30 }, count: 2, text: "Lay two tubes at the depot, two metres apart" },
        { id: "flag", type: "plant", what: "flag", zone: { poi: "three_forks", r: 40 }, count: 1, text: "Plant a flag at the depot" },
      ],
      rewards: { materials: 100, unlocks: ["light_mast"] }, debrief: "Two tubes on the ground at Three Forks, flagged. The real ten are still there, waiting for a return mission that has not been built yet." },
    { id: "survey", title: "Delta front survey", short: "Scan the scarp: the easy way along its foot, or the steep way for more",
      briefing: ["Before anyone builds here the ground has to be known. A scan reports what the data says about a spot: which terrain model it came from, the slope in that model, and what the regolith heuristic makes of it.",
        "Take three scans at least 80 m apart within 500 m of the delta front. Along the foot of the scarp that is a walk. The layers themselves are exposed ON the scarp: one scan where the terrain model says 20 degrees or more doubles the reward, but loose ground stops a suited walker at 26 degrees and firm ground at 38, a slide costs suit integrity, and every metre up is oxygen you need to get back down."],
      facts: [{ text: "Perseverance's Delta Front Campaign ran from April 2022 into early 2023 along this scarp, between Hawksbill Gap and Cape Nukshak.", source: "NASA/JPL Mars 2020 mission updates; " + M20 }],
      objectives: [
        { id: "go", type: "reach", poi: "delta_front", r: 60, text: "Go to the delta front" },
        { id: "scans", type: "scan", zone: { poi: "delta_front", r: 500 }, count: 3, spacing: 80, text: "Scan three places at least 80 m apart near the delta front" },
        { id: "steep", type: "scan", zone: { poi: "delta_front", r: 500 }, count: 1, slopeMin: 20, optional: true, text: "Bonus: one scan on the scarp (20 degrees or more in the data)" },
        { id: "back", type: "return", to: "refuge", text: "Return to the rover" },
      ],
      rewards: { materials: 120, unlocks: ["battery_bank"], bonus: { materials: 120 } }, debrief: "Three scans of the delta front. Each says where its numbers came from: that line between measured and generated is the point of the whole game." },
    ...BASE_MISSIONS("Three Forks"),
    STORM("landing", "the landing site"),
  ];
}

/** Any other site: the same shape of campaign, built from the manifest's own cited POIs. */
function genericChain(site) {
  const P = site.pois, a = P[1] || P[0], b = P[2] || a, home = P[0];
  const src = site.manifest.poi_source_url || (a && a.source) || "site manifest";
  const fact = (p) => ({ text: `${p.name}: ${p.note}`, source: p.source || src });
  return [
    { id: "touchdown", title: "Touchdown", short: `Drive to ${a.name}`,
      briefing: [`You are down at ${home.name}. ${home.note}`, `Drive to ${a.name}: ${a.note} Watch the battery and the sand.`],
      facts: [fact(home), fact(a)], objectives: [{ id: "drive", type: "reach", poi: a.id, r: 30, by: "rover", text: `Drive to ${a.name}` }],
      rewards: { materials: 60 }, debrief: `The rover is at ${a.name}.` },
    { id: "first_core", title: "First core", short: `Walk out at ${b.name} and collect a sample`,
      briefing: [`${b.name}: ${b.note}`, "Drive there, stop, and step outside (hold L1 + R1 together, or E). On foot the suit is your budget and the rover is your refuge. Core a rock within 150 m of the marker and get back in."],
      facts: [fact(b)],
      objectives: [{ id: "drive", type: "reach", poi: b.id, r: 45, text: `Drive to ${b.name}` }, { id: "out", type: "eva", text: "Stop and step outside (hold L1 + R1, or E)" },
        { id: "core", type: "sample", zone: { poi: b.id, r: 150 }, count: 1, text: `Core a rock within 150 m of ${b.name}` }, { id: "back", type: "return", to: "refuge", text: "Walk back and get in" }],
      rewards: { materials: 80, unlocks: ["storage_crate"] }, debrief: "One sealed tube. The rock is generated; the ground it stood on is the real terrain model." },
    { id: "depot", title: "Cache", short: `Cache your samples under a beacon at ${a.name}`,
      briefing: [`Samples are no use in a bag. Go back to ${a.name}, place a beacon (hold D-pad right / B) and lay two tubes within 12 m of it.`],
      facts: [fact(a)],
      objectives: [{ id: "go", type: "reach", poi: a.id, r: 40, text: `Return to ${a.name}` }, { id: "beacon", type: "plant", what: "beacon", zone: { poi: a.id, r: 60 }, count: 1, text: "Place a beacon" },
        { id: "second", type: "sample", count: 1, zone: { poi: a.id, r: 600 }, have: 2, text: "Collect a second sample" }, { id: "lay", type: "deposit", zone: { poi: a.id, r: 80 }, count: 2, text: "Lay two tubes at the beacon" }],
      rewards: { materials: 100, unlocks: ["light_mast"] }, debrief: "A cache, marked and mapped." },
    { id: "survey", title: "Survey", short: `Scan the ground around ${b.name}`,
      briefing: ["Take three scans at least 80 m apart. One on a slope of 20 degrees or more in the terrain model doubles the reward, if you can reach it and get back."],
      facts: [fact(b)],
      objectives: [{ id: "go", type: "reach", poi: b.id, r: 60, text: `Go to ${b.name}` }, { id: "scans", type: "scan", zone: { poi: b.id, r: 500 }, count: 3, spacing: 80, text: "Scan three places at least 80 m apart" },
        { id: "steep", type: "scan", zone: { poi: b.id, r: 500 }, count: 1, slopeMin: 20, optional: true, text: "Bonus: one scan on a 20 degree slope" }, { id: "back", type: "return", to: "refuge", text: "Return to the rover" }],
      rewards: { materials: 120, unlocks: ["battery_bank"], bonus: { materials: 120 } }, debrief: "Three scans, each labelled with where its numbers came from." },
    ...BASE_MISSIONS(a.name),
    STORM(home.id, home.name),
  ];
}
export function chainFor(site) { return site.id === "jezero" && site.pois.some((p) => p.id === "three_forks") ? jezeroChain(site) : genericChain(site); }
/** For the launcher's site card: what there is to do, from a manifest alone. */
export function campaignSummary(manifest) {
  const fake = { id: manifest.id, pois: manifest.pois, manifest };
  return chainFor(fake).map((m) => ({ id: m.id, title: m.title, short: m.short, requires: m.requires || null }));
}

/* ── the engine ───────────────────────────────────────────────────────────── */

class Missions {
  constructor(game) {
    this.game = game; this.chain = chainFor(game.site); this.listeners = {};
    this.S = this._fresh(); this.modal = null; this.session = 0;
    this._ui();
    for (const ev of ["sample", "deposit", "plant", "scan", "exit", "enter", "recovered"]) game.on("eva:" + ev, (d) => this._event(ev, d || {}));
  }
  _fresh() { return { v: 1, site: this.game.site.id, current: null, index: 0, prog: {}, done: {}, bonus: {}, started: null, bank: 0, unlocked: [], log: [], free: false, began: false, belva: false }; }
  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return () => { const l = this.listeners[name], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  emit(name, d) { for (const f of this.listeners[name] || []) { try { f(d); } catch (e) { console.error("[missions]", e); } } this.game.emit("mission:" + name, d); }

  get mission() { return this.chain.find((m) => m.id === this.S.current) || null; }
  get objective() { const m = this.mission; return m ? m.objectives[this.S.index] || null : null; }
  available(m) { return !m.requires || !!getSystem(m.requires); }
  status(id) { const m = this.chain.find((x) => x.id === id); if (!m) return null; return this.S.done[id] ? "done" : !this.available(m) ? "unavailable" : this.S.current === id ? "current" : "locked"; }
  number(m) { return this.chain.indexOf(m) + 1; }

  /* ── state ── */
  load(saved) {
    const g = this.game;
    this.chain = chainFor(g.site);
    this.S = Object.assign(this._fresh(), saved && saved.site === g.site.id ? saved : null);
    this.session++; this._announced = false; this.closeAll();
    if (this._storm && !saved) this._endStorm();
    if (!this.S.current && !this.S.free) this._next(true);
    this._reconcile();
    this._publish();
  }
  save() { return this.S; }

  /** state.objectives.index says how many route waypoints the rover has reached: honour it (old saves, and the foundation's own tests). */
  _reconcile() {
    const o = this.game.state.objectives, S = this.S;
    for (let guard = 0; guard < 12; guard++) {
      const ob = this.objective;
      if (!ob || ob.type !== "reach" || !ob.poi) break;
      const k = o.route.indexOf(ob.poi);
      if (k < 0 || k >= o.index || this.S.index !== 0 && this.mission.objectives.slice(0, this.S.index).some((x) => x.type !== "reach")) break;
      this._advance(true);
    }
    void S;
  }
  _snapshot() {
    const g = this.game, a = getSystem("avatar"), st = a && a.api && a.api.stats, e = getSystem("eva");
    return { sol: g.state.clock.sol, tod: g.state.clock.tod, odo: g.vehicle.odometer, energy: g.vehicle.energyUsed, walked: st ? st.walked_m : 0, o2: st ? st.o2_kg : 0,
      emergencies: st ? st.emergencies : 0, evas: st ? st.evas : 0, scans: e && e.api ? e.api.scans : 0 };
  }
  _next(silent = false) {
    const S = this.S, from = S.current ? this.chain.findIndex((m) => m.id === S.current) + 1 : 0;
    let m = null;
    for (let i = from; i < this.chain.length; i++) { const c = this.chain[i]; if (S.done[c.id]) continue; if (!this.available(c)) continue; m = c; break; }
    if (!m) { S.current = null; S.free = true; S.index = 0; S.prog = {}; if (!silent) this.emit("freeplay", {}); return null; }
    S.current = m.id; S.index = 0; S.prog = {}; S.bonus = {}; S.started = this._snapshot(); S.free = false;
    this._log(`Mission ${this.number(m)} started: ${m.title}`);
    this.emit("start", { id: m.id, title: m.title });
    return m;
  }
  _log(text) { const c = this.game.state.clock; this.S.log.push({ sol: c.sol, time: clockText(c), text }); if (this.S.log.length > 60) this.S.log.shift(); }
  _advance(silent = false) {
    const m = this.mission, S = this.S, g = this.game, ob = this.objective;
    if (!m || !ob) return;
    if (ob.type === "reach" && ob.poi) {
      const o = g.state.objectives, k = o.route.indexOf(ob.poi);
      if (k >= 0) { o.reached[ob.poi] = o.reached[ob.poi] || { sol: g.state.clock.sol, tod: g.state.clock.tod, odometer_m: g.vehicle.odometer }; o.index = Math.max(o.index, k + 1); o.complete = o.index >= o.route.length; }
    }
    if (ob.storm) this._endStorm();
    S.index++; S.prog = {};
    this.emit("objective", { mission: m.id, done: ob.id, next: (m.objectives[S.index] || {}).id || null });
    // skip optional objectives in the sequence: they are scored in parallel
    while (m.objectives[S.index] && m.objectives[S.index].optional) S.index++;
    if (S.index >= m.objectives.length) this._complete(m, silent);
    else if (!silent) { const nx = m.objectives[S.index]; g.hud.toast(`Done: ${esc(ob.text)}<small>Next: ${esc(nx.text)}</small>`, 5); g.save(); }
    this._publish();
  }
  _complete(m, silent = false) {
    const S = this.S, g = this.game, s0 = S.started || this._snapshot(), s1 = this._snapshot();
    const stats = { sols: solsBetween(s0, s1), driven_m: s1.odo - s0.odo, walked_m: s1.walked - s0.walked, o2_kg: s1.o2 - s0.o2, energy_kWh: (s1.energy - s0.energy) / 3.6e6,
      emergencies: s1.emergencies - s0.emergencies, evas: s1.evas - s0.evas, scans: s1.scans - s0.scans };
    const bonus = m.objectives.filter((o) => o.optional && S.bonus[o.id]).length > 0;
    const R = m.rewards || {}, materials = (R.materials || 0) + (bonus && R.bonus ? R.bonus.materials || 0 : 0), unlocks = (R.unlocks || []).filter((u) => !S.unlocked.includes(u));
    S.done[m.id] = { sol: g.state.clock.sol, time: clockText(g.state.clock), stats, materials, unlocks, bonus, reconciled: silent };
    S.unlocked.push(...unlocks);
    const delivered = this._grant(materials);
    S.bank += delivered ? 0 : materials;
    this._log(`Mission ${this.number(m)} complete: ${m.title}` + (bonus ? " (with the bonus)" : ""));
    this.emit("complete", { id: m.id, stats, materials, unlocks, bonus });
    if (unlocks.length) this.emit("unlock", { ids: unlocks });
    const next = this._next(silent);
    if (!silent) { g.save(); this.showDebrief(m, next); }
  }
  /** Materials go to the base economy when there is one; otherwise they wait in the bank (api.bank()). */
  _grant(n) {
    if (!n) return true;
    const b = getSystem("base"), api = b && b.api;
    try {
      if (api && typeof api.addMaterials === "function") { api.addMaterials(n); return true; }
      if (api && api.net && Number.isFinite(api.net.materials)) { api.net.materials += n; return true; }
    } catch (e) { console.warn("[missions] could not deliver materials", e); }
    return false;
  }
  complete(id) { const m = this.chain.find((x) => x.id === id); if (!m || this.S.done[id]) return false; if (this.S.current !== id) { this.S.current = id; this.S.index = 0; this.S.started = this._snapshot(); } this._complete(m, false); return true; }

  /* ── objectives ── */
  zone(z) {
    if (!z) return null;
    const p = z.poi ? this.game.site.pois.find((q) => q.id === z.poi) : null;
    return p ? { x: p.x, z: p.z, r: z.r || 30, name: p.name, id: p.id, note: p.note } : Number.isFinite(z.x) ? { x: z.x, z: z.z, r: z.r || 30, name: z.name || "the marked area", id: z.id || "zone" } : null;
  }
  inZone(z, x, zz) { const q = this.zone(z); return !q || Math.hypot(q.x - x, q.z - zz) <= q.r; }
  who() { const a = getSystem("avatar"), api = a && a.api, v = this.game.vehicle; return { onFoot: !!(api && api.onFoot), inside: api ? api.inside : null, p: api && api.onFoot && api.position ? api.position : v.p }; }

  _event(ev, d) {
    if (this.game.storyOwns) return;      // HOOK (story.js): the story campaign owns the objective tracker; this chain sleeps
    const m = this.mission; if (!m) return;
    const test = (ob) => {
      if (!ob) return false;
      const P = this.S.prog[ob.id] || (this.S.prog[ob.id] = { n: 0, at: [] });
      if (ev === "sample" && ob.type === "sample" && this.inZone(ob.zone, d.tube.x, d.tube.z)) P.n++;
      else if (ev === "deposit" && ob.type === "deposit" && this.inZone(ob.zone, d.tube.x, d.tube.z)) P.n++;
      else if (ev === "plant" && ob.type === "plant" && d.what === ob.what && this.inZone(ob.zone, d.x, d.z)) P.n++;
      else if (ev === "scan" && ob.type === "scan" && this.inZone(ob.zone, d.x, d.z)) {
        if (ob.slopeMin && Math.max(d.dataSlope || 0, 0) < ob.slopeMin) return false;
        if (ob.spacing && P.at.some((q) => Math.hypot(q[0] - d.x, q[1] - d.z) < ob.spacing)) { if (!ob.optional) this.game.hud.toast(`Too close to an earlier scan<small>scans count ${ob.spacing} m apart</small>`, 3); return false; }
        P.n++; P.at.push([Math.round(d.x), Math.round(d.z)]);
      } else if (ev === "exit" && ob.type === "eva") P.n++;
      else return false;
      return P.n >= (ob.count || 1);
    };
    for (const ob of m.objectives) if (ob.optional && !this.S.bonus[ob.id] && test(ob)) { this.S.bonus[ob.id] = true; this.game.hud.toast(`Bonus: ${esc(ob.text.replace(/^Bonus: /, ""))}`, 4); }
    const cur = this.objective;
    if (cur && !cur.optional && test(cur)) this._advance(); else this._publish();
  }

  tick(dt, simDt) {
    if (this.game.storyOwns) return;      // HOOK (story.js): the story campaign owns the objective tracker; this chain sleeps
    const g = this.game, S = this.S, ob = this.objective;
    this._acc = (this._acc || 0) + dt;
    if (ob) {
      const w = this.who(), P = S.prog[ob.id] || (S.prog[ob.id] = { n: 0, at: [] });
      if (ob.type === "reach") {
        const z = this.zone({ poi: ob.poi, x: ob.x, z: ob.z, r: ob.r });
        if (z && Math.hypot(z.x - w.p.x, z.z - w.p.z) <= z.r && (!ob.by || (ob.by === "rover") === !w.onFoot)) { g.hud.toast(`Reached: ${esc(z.name)}<small>${esc(z.note || "")}</small>`, 6); this._advance(); return; }
      } else if (ob.type === "eva") { if (w.onFoot) { this._advance(); return; } }
      else if (ob.type === "return") { if (!w.onFoot || (ob.to === "refuge" && w.inside)) { this._advance(); return; } }
      else if (ob.type === "sample" && ob.have) { const e = getSystem("eva"); if (e && e.api && e.api.bag.length + e.api.depot.length >= ob.have) { this._advance(); return; } }
      else if (ob.type === "build") { if (this._acc > 0.5 && this._built(ob.match) >= (ob.count || 1)) { this._advance(); return; } }
      else if (ob.type === "sustain") { if (this._acc > 0.5 && this._baseAlive()) { this._advance(); return; } }
      else if (ob.type === "survive") {
        if (ob.storm && !P.stormOn) { P.stormOn = true; this._startStorm(ob.hours); }
        const ok = ob.need === "base" ? this._baseAlive() : !g.vehicle.flat;
        if (!ok) { if (P.t > 600) g.hud.toast(ob.need === "base" ? "The habitat went dark: the count starts again" : "The rover's battery went flat: the count starts again", 5); P.t = 0; }
        else P.t = (P.t || 0) + simDt;
        if (P.t >= ob.hours * H) { this._advance(); return; }
      }
    } else if (S.free && !S.belva) {
      const p = g.site.pois.find((q) => q.id === "belva"), w = this.who();
      if (p && Math.hypot(p.x - w.p.x, p.z - w.p.z) < 40) { S.belva = true; const o = g.state.objectives; o.reached.belva = { sol: g.state.clock.sol, tod: g.state.clock.tod, odometer_m: g.vehicle.odometer }; o.index = o.route.length; o.complete = true;
        this._log("Reached the rim of Belva crater"); g.hud.toast(`Reached: ${esc(p.name)}<small>${esc(p.note)} Perseverance took 770 sols to get here.</small>`, 8); g.save(); }
    }
    if (this._acc > 0.25) { this._acc = 0; this._publish(); }
  }
  _built(match) {
    const b = getSystem("base"), api = b && b.api; if (!api || !api.modules) return 0;
    const re = new RegExp(match);
    try { return api.modules().filter((m) => re.test(m.type) && m.built !== false && !(m.progress < 1)).length; } catch { return 0; }
  }
  _baseAlive() {
    const b = getSystem("base"), api = b && b.api; if (!api || !api.modules) return false;
    try { return api.modules().some((m) => /^hab/.test(m.type) && m.built !== false && m.powered !== false && m.habitable !== false); } catch { return false; }
  }
  /** The storm: the weather system's own scripted storm when it is there; otherwise the dust optical depth is driven here for the duration. */
  _startStorm(hours) {
    const g = this.game, w = getSystem("weather");
    if (w && typeof w.scriptStorm === "function") { try { w.scriptStorm(g, { kind: "regional", lead_s: 0.5 * H, ramp_s: 1 * H, hold_s: (hours - 2) * H, clear_s: 2 * H, peak_tau: 3.4 }); this._storm = { weather: true }; return; } catch (e) { console.warn("[missions] weather.scriptStorm", e); } }
    this._storm = { tau0: g.state.weather.tau }; g.setTau(3.4);
    g.hud.toast("The storm is here<small>dust optical depth 3.4: the array gives a fraction of its power</small>", 6);
  }
  _endStorm() { const s = this._storm; this._storm = null; if (!getSystem("weather") && this.game.state.weather.tau > 2) this.game.setTau(s && s.tau0 ? Math.min(s.tau0, 1) : ATMOSPHERE.tau); }

  /* ── the HUD's one objective tracker ── */
  _publish() {
    if (this.game.storyOwns) return;      // HOOK (story.js): the story campaign owns the objective tracker; this chain sleeps
    const g = this.game, o = g.state.objectives, m = this.mission, ob = this.objective, S = this.S;
    hide(o, "managed", true);
    let target = null, hud;
    if (m && ob) {
      const P = S.prog[ob.id] || { n: 0 }, w = this.who(), need = ob.count || 1;
      const z = ob.type === "reach" ? this.zone({ poi: ob.poi, x: ob.x, z: ob.z, r: ob.r }) : this.zone(ob.zone);
      let meta = "";
      if (ob.type === "return") { const v = g.vehicle; target = w.onFoot && !w.inside ? { id: "rover", name: ob.text, note: "The rover's rear hatch.", x: v.p.x, z: v.p.z } : null; meta = "at the rear hatch"; }
      else if (z && (ob.type === "reach" || Math.hypot(z.x - w.p.x, z.z - w.p.z) > z.r)) target = { id: z.id, name: ob.type === "reach" ? z.name : ob.text, note: z.note || ob.text, x: z.x, z: z.z };
      if (ob.type === "survive") { const left = Math.max(0, ob.hours * H - (P.t || 0)); meta = `${Math.floor(left / H)} h ${String(Math.floor(left % H / 60)).padStart(2, "0")} m to go` + (ob.need === "rover" ? ` · battery ${Math.round(g.vehicle.batteryFraction * 100)}%` : ""); }
      else if (ob.type === "build") meta = `${Math.min(need, this._built(ob.match))} / ${need} built · build mode: see the menu`;
      else if (ob.type === "eva") meta = Math.abs(g.vehicle.t.speed) < 0.5 ? "hold L1 + R1, or E" : "stop first";
      else if (["sample", "deposit", "plant", "scan"].includes(ob.type)) meta = (need > 1 ? `${P.n} / ${need}` : z && !target ? "in the area" : "") + (ob.type === "sample" && ob.have ? " · need " + ob.have + " tubes" : "");
      const bonus = m.objectives.filter((x) => x.optional);
      if (bonus.length && !target) meta += (meta ? " · " : "") + (bonus.every((x) => S.bonus[x.id]) ? "bonus done" : "bonus open");
      hud = { eyebrow: `Mission ${this.number(m)} · ${m.title}`, name: target && ob.type === "reach" ? target.name : ob.text, meta, count: `${Math.min(m.objectives.filter((x) => !x.optional).indexOf(ob) + 1, 9)} / ${m.objectives.filter((x) => !x.optional).length}` };
    } else {
      const p = !S.belva && g.site.pois.find((q) => q.id === "belva");
      if (p) target = { id: p.id, name: p.name, note: p.note, x: p.x, z: p.z };
      hud = { eyebrow: "Free exploration", name: p ? p.name : "All missions complete", meta: p ? "" : "the site is yours", count: "" };
    }
    hide(o, "target", target); hide(o, "hud", hud);
    const eb = this._eyebrow || (this._eyebrow = document.querySelector("#hud .hud-tl .eyebrow"));
    if (eb && eb.textContent !== hud.eyebrow) eb.textContent = hud.eyebrow;
  }

  /* ── screens: briefing, debrief, log ── */
  _ui() {
    const mk = (id, wide = true) => { let s = document.getElementById(id); if (s) return s; s = document.createElement("section"); s.id = id; s.className = "screen modal mission"; s.hidden = true; s.setAttribute("data-pad-closable", ""); s.innerHTML = `<div class="card${wide ? " wide" : ""}"></div>`; document.body.appendChild(s); return s; };
    this.elBrief = mk("screen-briefing"); this.elDebrief = mk("screen-debrief"); this.elLog = mk("screen-log");
    const menu = document.querySelector("#screen-menu .col"), save = document.getElementById("btn-save");
    if (menu && !document.getElementById("btn-missions")) {
      const b = document.createElement("button"); b.type = "button"; b.id = "btn-missions"; b.className = "btn"; b.textContent = "Mission log";
      menu.insertBefore(b, save || null);
      b.addEventListener("click", () => this.showLog(true));
    }
    const g = this.game;
    g.on("mode", (mode) => { if (mode === "driving" || mode === "onfoot" || mode === "build") this.closeAll(false); });
    window.addEventListener("keydown", (e) => { if (this.modal && (e.code === "Enter" || e.code === "Escape")) { const b = this.modal.querySelector("[data-pad-close]"); if (b) { b.click(); e.preventDefault(); e.stopPropagation(); } } }, true);
  }
  _open(el) {
    const g = this.game, P = window.GeoIDPad, menu = document.getElementById("screen-menu");
    if (!this.modal) {                       // where to go back to: the pause menu, or the game
      this._origin = menu && !menu.hidden ? "menu" : g.live ? "live" : "other";
      if (this._origin === "live") g.pause(true);
    }
    if (menu) menu.hidden = true;
    for (const s of [this.elBrief, this.elDebrief, this.elLog]) s.hidden = s !== el;
    this.modal = el;
    if (P && P.connected) setTimeout(() => { if (!el.hidden) P.focus.first(el); }, 60);
  }
  closeAll(resume = true) {
    if (!this.modal) return;
    for (const s of [this.elBrief, this.elDebrief, this.elLog]) s.hidden = true;
    this.modal = null;
    const g = this.game, P = window.GeoIDPad, origin = this._origin;
    this._origin = null;
    if (P) P.focus.clear();
    if (!resume || g.mode !== "menu") return;
    if (origin === "menu") { const menu = document.getElementById("screen-menu"); if (menu) { menu.hidden = false; if (P && P.connected) setTimeout(() => { if (!menu.hidden) P.focus.first(menu); }, 60); } }
    else if (origin === "live") g.pause(false);
  }
  _objList(m, live = false) {
    const S = this.S, cur = S.current === m.id, done = !!S.done[m.id];
    return m.objectives.map((o, i) => {
      const st = done || (cur && live && !o.optional && i < S.index) || (o.optional && (S.bonus[o.id] && cur || done && S.done[m.id].bonus)) ? "done" : cur && live && i === S.index ? "now" : "";
      return `<li class="${st}${o.optional ? " opt" : ""}">${esc(o.text)}</li>`;
    }).join("");
  }
  _rewardText(m) {
    const R = m.rewards || {}, names = (R.unlocks || []).map((u) => u.replace(/_/g, " "));
    return [R.materials ? `${R.materials} materials for the base` : "", R.bonus && R.bonus.materials ? `+${R.bonus.materials} with the bonus` : "", names.length ? "unlocks: " + names.join(", ") : ""].filter(Boolean).join(" · ") || "none";
  }
  showBriefing(m = this.mission) {
    const g = this.game;
    if (!m) { this.showLog(false); return; }
    const live = this.S.current === m.id && (this.S.index > 0 || this.S.began);
    this.S.began = true;
    this.elBrief.firstChild.innerHTML = `<div class="eyebrow">Mission ${this.number(m)} of ${this.chain.length} &middot; ${esc(g.site.name)}</div><h2>${esc(m.title)}</h2>
      <div class="m-body">${m.briefing.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <div class="m-cols"><div><div class="eyebrow">Objectives</div><ol class="m-obj">${this._objList(m, true)}</ol></div>
        <div><div class="eyebrow">Reward</div><p class="m-reward">${esc(this._rewardText(m))}</p>
        <div class="eyebrow">The real mission</div>${m.facts.map((f) => `<p class="fine">${esc(f.text)} <span class="m-src">Source: ${esc(f.source)}.</span></p>`).join("")}</div></div>
      <div class="row"><button type="button" class="btn primary" data-pad-close data-m="go">${live ? "Continue" : "Begin"}</button><button type="button" class="btn" data-m="log">Mission log</button></div>`;
    this.elBrief.querySelector('[data-m="go"]').addEventListener("click", () => this.closeAll());
    this.elBrief.querySelector('[data-m="log"]').addEventListener("click", () => this.showLog(false));
    this._open(this.elBrief);
  }
  showDebrief(m, next) {
    const d = this.S.done[m.id], s = d.stats, g = this.game;
    const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    this.elDebrief.firstChild.innerHTML = `<div class="eyebrow">Mission ${this.number(m)} complete &middot; Sol ${d.sol}, ${d.time}</div><h2>${esc(m.title)}</h2>
      <div class="stats m-stats">${stat(s.sols.toFixed(2), "sols taken")}${stat(fmtM(s.driven_m), "driven")}${stat(fmtM(s.walked_m), "walked")}${stat(s.energy_kWh.toFixed(1) + " kWh", "rover energy")}${stat((s.o2_kg * 1000).toFixed(0) + " g", "suit oxygen")}${stat(String(s.emergencies), s.emergencies === 1 ? "emergency" : "emergencies")}</div>
      <div class="m-body"><p>${esc(m.debrief)}</p></div>
      <div class="m-cols"><div><div class="eyebrow">Objectives</div><ol class="m-obj">${this._objList(m)}</ol></div>
        <div><div class="eyebrow">Earned</div><p class="m-reward">${d.materials ? d.materials + " materials" + (getSystem("base") ? " delivered to the base stock" : " banked until there is a base") : "nothing to carry"}${d.bonus ? " (bonus included)" : ""}${d.unlocks.length ? "<br>Unlocked: " + esc(d.unlocks.map((u) => u.replace(/_/g, " ")).join(", ")) : ""}</p>
        <div class="eyebrow">Next</div><p class="fine">${next ? `Mission ${this.number(next)}: ${esc(next.title)}. ${esc(next.short)}.` : "No scripted mission is left that this build can run: free exploration." + this.chain.filter((c) => !this.S.done[c.id] && !this.available(c)).map((c) => ` ${esc(c.title)} needs the ${c.requires === "base" ? "base builder" : c.requires}.`).join("")}</p></div></div>
      <div class="row"><button type="button" class="btn primary" data-pad-close data-m="go">${next ? "Next briefing" : "Keep exploring"}</button><button type="button" class="btn" data-m="stay">Stay here</button></div>`;
    this.elDebrief.querySelector('[data-m="go"]').addEventListener("click", () => { if (next) this.showBriefing(next); else this.closeAll(); });
    this.elDebrief.querySelector('[data-m="stay"]').addEventListener("click", () => this.closeAll());
    this._open(this.elDebrief);
    void g;
  }
  showLog(fromMenu) {
    const S = this.S, label = { done: "done", current: "current", locked: "to come", unavailable: "unavailable" };
    const rows = this.chain.map((m) => {
      const st = this.status(m.id), d = S.done[m.id];
      return `<li class="m-row ${st}"><b>${this.number(m)}</b><div><h3>${esc(m.title)} <em>${label[st]}</em></h3><p>${esc(m.short)}.${st === "unavailable" ? ` Needs the ${m.requires === "base" ? "base builder" : m.requires + " system"}, which is not in this build.` : ""}${d ? ` Sol ${d.sol}, ${d.time}${d.reconciled ? "" : `: ${d.stats.sols.toFixed(2)} sols, ${fmtM(d.stats.driven_m)} driven, ${fmtM(d.stats.walked_m)} walked`}.` : ""}</p>
        ${st === "current" ? `<ol class="m-obj">${this._objList(m, true)}</ol>` : ""}</div></li>`;
    }).join("");
    this.elLog.firstChild.innerHTML = `<div class="eyebrow">${esc(this.game.site.name)} &middot; Sol ${this.game.state.clock.sol}</div><h2>Mission log</h2>
      <ol class="m-list">${rows}</ol>
      <p class="fine">${S.bank ? `${S.bank} materials banked for a base. ` : ""}${S.unlocked.length ? "Unlocked: " + esc(S.unlocked.map((u) => u.replace(/_/g, " ")).join(", ")) + ". " : ""}${S.log.slice(-3).map((l) => `Sol ${l.sol} ${l.time}: ${esc(l.text)}.`).join(" ")}</p>
      <div class="row"><button type="button" class="btn primary" data-pad-close data-m="back">Back</button>${this.mission ? '<button type="button" class="btn" data-m="brief">Current briefing</button>' : ""}</div>`;
    this.elLog.querySelector('[data-m="back"]').addEventListener("click", () => this.closeAll());
    const b = this.elLog.querySelector('[data-m="brief"]'); if (b) b.addEventListener("click", () => this.showBriefing());
    this._open(this.elLog);
    void fromMenu;
  }
  /** The "show the objective" control: the first time in a session a line, after that the briefing. */
  announce() {
    if (this.game.storyOwns) { const st = getSystem("story"); return st && st.api && st.api.announce(); }      // HOOK (story.js): O opens the story's log
    const g = this.game, m = this.mission, ob = this.objective;
    if (!this._announced) {
      this._announced = true;
      g.hud.toast(m ? `Mission ${this.number(m)}: ${esc(m.title)}<small>${esc(ob ? ob.text : m.short)}. Briefing: ${g.input.padConnected && g.input.lastDevice === "pad" && window.GeoIDPad ? window.GeoIDPad.glyph("down") : "<kbd>O</kbd>"}</small>` : "Free exploration<small>every mission this build can run is done</small>", 7);
      return;
    }
    this.showBriefing();
  }
}

let M = null;
const sys = {
  id: "missions", order: 70,
  api: {
    get current() { const m = M && M.mission, o = M && M.objective; return m ? { id: m.id, title: m.title, number: M.number(m), objective: o ? { id: o.id, type: o.type, text: o.text, progress: (M.S.prog[o.id] || {}).n || 0, count: o.count || 1 } : null, index: M.S.index } : null; },
    get list() { return M ? M.chain.map((m) => ({ id: m.id, title: m.title, short: m.short, status: M.status(m.id), requires: m.requires || null, done: M.S.done[m.id] || null })) : []; },
    complete: (id) => !!M && M.complete(id),
    on: (name, fn) => M ? M.on(name, fn) : () => {},
    unlocked: () => M ? M.S.unlocked.slice() : [],
    bank: () => M ? M.S.bank : 0,
    takeBank: () => { if (!M) return 0; const n = M.S.bank; M.S.bank = 0; return n; },
    status: (id) => M ? M.status(id) : null,
    announce: () => M && M.announce(),
    briefing: (id) => M && M.showBriefing(id ? M.chain.find((m) => m.id === id) : undefined),
    log: () => M && M.showLog(false),
    close: () => M && M.closeAll(),
    depots: () => {
      if (!M) return [];
      const out = [], seen = new Set();
      for (const m of M.chain) for (const o of m.objectives) if (o.type === "deposit") { const z = M.zone(o.zone); if (z && !seen.has(z.id)) { seen.add(z.id); out.push({ id: z.id, name: z.name, x: z.x, z: z.z, r: z.r }); } }
      return out;
    },
    wants: (type, x, z) => { const o = M && M.objective; return !!(o && o.type === type && M.inZone(o.zone, x, z)); },
    get state() { return M ? M.S : null; },
  },
  init(game) { M = new Missions(game); this.missions = M; },
  load(game, saved) { if (M) M.load(saved); },
  save() { return M ? M.save() : undefined; },
  tick(game, dt, ctx) { if (M) M.tick(dt, ctx.simDt); },
  onMode(game, mode) { if (M && (mode === "driving" || mode === "onfoot")) M._publish(); },
};
registerSystem(sys);
void MARS;
