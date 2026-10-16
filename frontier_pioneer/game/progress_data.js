/**
 * PROGRESSION AND CUSTOMISATION: the tables. Pure data and pure functions (no
 * DOM, no three.js), so the lint imports it under node and the README can
 * quote it. game/progress.js runs it; game/workshop.js shows it.
 *
 * THE ECONOMY (MARS: Frontier Pioneer). One currency: CONTRIBUTION CREDIT,
 * "XP". Materials are not a currency here: in the story they come down from
 * the HALO-1 station in care packages and are unlimited; what limits a
 * pioneer is credit. XP is earned by contributing, and by nothing else:
 *   discoveries   tubes laid at a depot (rock cores, regolith), scans of new
 *                 ground, a scan that finds a safe base site (the hazard map's
 *                 suitability), first visits to the site's published
 *                 waypoints, water ice and minerals (through api.discovery(),
 *                 for the system that will model them)
 *   building      the first habitable base, and base-size milestones
 *   missions      0.5 XP per material the mission's reward table pays
 *   the story     api.award(xp, reason): reciting the poem, acting for Alice
 * Two numbers are kept: the BALANCE (spent in the Workshop and, later, on
 * care-package requests: api.spend) and the LIFETIME total, which sets the
 * TIER (TIERS below). The tier is the capacity other systems read through
 * api.limits(): how many care-package requests may be open and how many
 * modules a base may hold. Spending never lowers the tier.
 *
 * UPGRADES are Kestrel Dynamics hardware, grouped in LINES; inside a line
 * only the highest tier you own applies (its numbers are totals, not
 * increments). Lines combine by multiplying. A line marked `exclusive` (the
 * wheel sets) is a choice: buy any, equip one. Every number is a factor on
 * the design's own value.
 *
 *   suit effects  o2, power, scrub (cartridge), scrubW (scrubber rate), sprint, hop, air (steering in a hop),
 *                 rad (dose), dust (storm leak and wear)        -> avatar.js SUIT_MODS
 *                 bag (+ slots), core, scoop, scan (times), range (scan reach)   -> eva.js EVA_MODS
 *   rover effects drive (force), speed (top speed), capacity, solar, eff (drivetrain), mu / muSand (traction),
 *                 sink, crr (+ rolling resistance), stab, damp  -> vehicle.modifiers.progress
 *                 lampRange (night safe speed, hazards.js), lampW (+ W with the lights on),
 *                 dustCut (share of new dust shed from the array), arm (the sampling arm)
 */

export const XP_RULES = {
  core: 15, regolith: 8, depotBonus: 5,        // per tube laid; +5 at a named depot (not a beacon cache)
  scan: 4, scanMeasured: 2, scanSteep: 5, steepDeg: 20, scanRepeat: 1, repeatWithin_m: 40,
  safeSite: 6, safeSuitability: 0.75,          // a scan where the hazard map rates the ground a good base site
  poi: 10,                                     // first time the rover reaches each published waypoint
  missionPerMaterial: 0.5,                     // XP = 0.5 x the mission's materials (bonus included)
  firstHabitable: 100,                         // the first base with a powered, habitable habitat an airlock reaches
  milestones: [[5, 25], [10, 50], [20, 100], [30, 150], [50, 250]],     // [built modules across all bases, XP]
  discovery: { water_ice: 40, mineral: 20, safe_site: 6 },             // api.discovery(kind): for the systems that will model them
};

/** Capacity by lifetime XP. Read by other systems (HALO-1 care packages, the base builder) through api.limits(). */
export const TIERS = [
  { xp: 0, name: "Settler", maxOpenRequests: 1, maxBaseModules: 12, caretakers: 0 },
  { xp: 150, name: "Pathfinder", maxOpenRequests: 2, maxBaseModules: 20, caretakers: 1 },
  { xp: 400, name: "Surveyor", maxOpenRequests: 3, maxBaseModules: 32, caretakers: 1 },
  { xp: 800, name: "Builder", maxOpenRequests: 4, maxBaseModules: 48, caretakers: 2 },
  { xp: 1500, name: "Steward", maxOpenRequests: 5, maxBaseModules: 72, caretakers: 3 },
  { xp: 2500, name: "Pioneer", maxOpenRequests: 6, maxBaseModules: 100, caretakers: 4 },
];
export function tierFor(total) {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (total >= TIERS[k].xp) i = k;
  return Object.assign({ index: i, next: TIERS[i + 1] || null }, TIERS[i]);
}

const T = (o) => Object.assign({ tier: 1, cost: 0, requires: [], mission: null, effects: {}, visual: null }, o);

export const UPGRADES = [
  // ── the suit ─────────────────────────────────────────────────────────────
  T({ id: "suit_o2_1", group: "suit", line: "o2", lineName: "Oxygen", name: "Kestrel high-pressure O2 bottle", cost: 40,
    effects: { o2: 1.25 }, visual: "tank1", text: "Primary oxygen 0.60 -> 0.75 kg: about 10 h of walking instead of 8." }),
  T({ id: "suit_o2_2", group: "suit", line: "o2", lineName: "Oxygen", tier: 2, name: "Kestrel composite O2 tanks", cost: 110, requires: ["suit_o2_1"],
    effects: { o2: 1.6 }, visual: "tank2", text: "Primary oxygen 0.96 kg: the safe-return radius grows by 60%." }),
  T({ id: "suit_pwr_1", group: "suit", line: "power", lineName: "Power", name: "Kestrel Li-S suit battery", cost: 35,
    effects: { power: 1.3 }, text: "Suit battery 1.0 -> 1.3 kWh: fan, pump, heaters and lamp run longer." }),
  T({ id: "suit_pwr_2", group: "suit", line: "power", lineName: "Power", tier: 2, name: "Kestrel solid-state suit battery", cost: 100, requires: ["suit_pwr_1"],
    effects: { power: 1.7 }, text: "Suit battery 1.7 kWh: a cold night EVA no longer runs the heaters flat." }),
  T({ id: "suit_scrub", group: "suit", line: "scrub", lineName: "CO2 scrubber", name: "Kestrel swing-bed scrubber", cost: 45,
    effects: { scrub: 1.5, scrubW: 1.35 }, text: "Keeps up with 700 W instead of 520 (a lope uphill no longer builds CO2); cartridge 0.8 -> 1.2 kg." }),
  T({ id: "suit_mob_1", group: "suit", line: "mobility", lineName: "Mobility", name: "Kestrel bearing joints", cost: 50,
    effects: { sprint: 1.15 }, visual: "knees", text: "Sprint 4.5 -> 5.2 m/s." }),
  T({ id: "suit_mob_2", group: "suit", line: "mobility", lineName: "Mobility", tier: 2, name: "Kestrel exo-assist legs", cost: 120, requires: ["suit_mob_1"],
    effects: { sprint: 1.3, hop: 1.15 }, visual: "exo", text: "Sprint 5.85 m/s; hop take-off 2.6 -> 3.0 m/s (apex 0.91 -> 1.20 m)." }),
  T({ id: "suit_jet", group: "suit", line: "jet", lineName: "Late mod", tier: 3, name: "Kestrel Jetpack-lite (cold-gas hop boost)", cost: 200,
    requires: ["suit_mob_2"], mission: "survey",
    effects: { hop: 1.4, air: 2.5 }, visual: "jet",
    text: "With the exo legs: take-off 4.2 m/s, apex 2.4 m, 2.3 s in the air, and 2.5x the steering while airborne. Each boost costs 0.4% of the suit battery. Never faster than the sprint." }),
  T({ id: "suit_corer", group: "suit", line: "corer", lineName: "Tools", name: "Kestrel percussive corer", cost: 40,
    effects: { core: 0.65, scoop: 0.7 }, text: "Coring a rock 3.2 -> 2.1 s; scooping regolith 2.0 -> 1.4 s." }),
  T({ id: "suit_scan", group: "suit", line: "scanner", lineName: "Tools", name: "Kestrel spectrometer gauntlet", cost: 45,
    effects: { scan: 0.6, range: 2.5 }, visual: "gauntlet", text: "Scan reaches 3.75 m ahead instead of 1.5 (and rocks that far away); a scan takes 0.8 s instead of 1.3." }),
  T({ id: "suit_bag_1", group: "suit", line: "bag", lineName: "Carrying", name: "Kestrel sample caddy", cost: 35,
    effects: { bag: 4 }, visual: "caddy", text: "Carry 10 sample tubes instead of 6." }),
  T({ id: "suit_bag_2", group: "suit", line: "bag", lineName: "Carrying", tier: 2, name: "Kestrel sample sled harness", cost: 90, requires: ["suit_bag_1"],
    effects: { bag: 10 }, visual: "sled", text: "Carry 16 tubes: one trip fills a depot." }),
  T({ id: "suit_rad", group: "suit", line: "rad", lineName: "Protection", name: "Kestrel polyethylene liner", cost: 60,
    effects: { rad: 0.6 }, text: "40% less radiation dose to the wearer, particle events included." }),
  T({ id: "suit_dust", group: "suit", line: "dust", lineName: "Protection", name: "Kestrel dust-sealed joints", cost: 50,
    effects: { dust: 0.3 }, text: "In a dust storm the suit leaks 15% more instead of 50%, and wears 70% slower." }),

  // ── the rover (any design: the crew fits them to whichever rover is in use) ──
  T({ id: "rov_motor_1", group: "rover", line: "motor", lineName: "Drive", name: "Kestrel uprated hub motors", cost: 45,
    effects: { drive: 1.25 }, text: "25% more wheel torque: climbs, sand and towing out of a trap." }),
  T({ id: "rov_inverter", group: "rover", line: "inverter", lineName: "Drive", name: "Kestrel SiC inverters", cost: 60, requires: ["rov_motor_1"],
    effects: { speed: 1.15, eff: 1.12 }, text: "Top speed +15% (crew rover 8.0 -> 9.2 m/s); drivetrain 12% more efficient." }),
  T({ id: "rov_motor_2", group: "rover", line: "motor", lineName: "Drive", tier: 2, name: "Kestrel axial-flux motors", cost: 140, requires: ["rov_inverter"],
    effects: { drive: 1.5, speed: 1.15 }, text: "50% more torque and another 15% of top speed (crew rover 10.6 m/s with the inverters)." }),
  T({ id: "rov_batt_1", group: "rover", line: "battery", lineName: "Power", name: "Kestrel battery pods", cost: 50,
    effects: { capacity: 1.33 }, visual: "pods1", text: "A pod on each flank: battery x1.33 (crew rover 24 -> 32 kWh)." }),
  T({ id: "rov_batt_2", group: "rover", line: "battery", lineName: "Power", tier: 2, name: "Kestrel extended battery pods", cost: 120, requires: ["rov_batt_1"],
    effects: { capacity: 1.75 }, visual: "pods2", text: "Two pods each side: battery x1.75 (crew rover 42 kWh)." }),
  T({ id: "rov_wings", group: "rover", line: "solar", lineName: "Power", name: "Kestrel fold-out solar wings", cost: 60,
    effects: { solar: 1.5 }, visual: "wings", text: "Array area x1.5 (crew rover 12 -> 18 m2): about 1.8 kW at noon in ordinary dust." }),
  T({ id: "rov_filter", group: "rover", line: "filter", lineName: "Power", name: "Kestrel dust filters and panel shield", cost: 50,
    effects: { dustCut: 0.6 }, visual: "filters", text: "Sheds 60% of the dust that would settle on the array; storms cost the battery far less." }),
  T({ id: "wheel_stock", group: "rover", line: "wheels", lineName: "Wheel set", exclusive: true, name: "Stock wheels", cost: 0, builtin: true,
    effects: {}, text: "The design's own wheels: the reference for everything else." }),
  T({ id: "rov_wheel_mesh", group: "rover", line: "wheels", lineName: "Wheel set", exclusive: true, name: "Kestrel woven-mesh wheels", cost: 40,
    effects: { mu: 0.95, muSand: 1.25, sink: 0.5 }, visual: "wheel_mesh", text: "Sand: traction +25%, sinkage halved. Firm ground: 5% less grip." }),
  T({ id: "rov_wheel_balloon", group: "rover", line: "wheels", lineName: "Wheel set", exclusive: true, name: "Kestrel balloon tyres", cost: 70,
    effects: { muSand: 1.15, sink: 0.3, crr: 0.02, speed: 0.92 }, visual: "wheel_balloon", text: "Floats over sand traps (sinkage x0.3, traction +15%) but rolls heavier and tops out 8% slower." }),
  T({ id: "rov_wheel_spring", group: "rover", line: "wheels", lineName: "Wheel set", exclusive: true, name: "Kestrel spring-tyre performance set", cost: 110, requires: ["rov_motor_1"],
    effects: { mu: 1.15, muSand: 0.9, sink: 1.25, crr: -0.01, speed: 1.15 }, visual: "wheel_spring", text: "Firm ground: grip +15%, top speed +15%, less rolling loss. Sand: 10% less grip, sinks 25% deeper." }),
  T({ id: "rov_susp_1", group: "rover", line: "susp", lineName: "Chassis", name: "Kestrel long-travel dampers", cost: 60,
    effects: { stab: 1.3, damp: 1.25 }, text: "Less pitch and roll over rocks and across slopes (the drive acts 30% closer to the centre of mass); 25% more damping." }),
  T({ id: "rov_susp_2", group: "rover", line: "susp", lineName: "Chassis", tier: 2, name: "Kestrel active suspension", cost: 140, requires: ["rov_susp_1"],
    effects: { stab: 1.55, damp: 1.5 }, text: "Steadier still: the drive acts 55% closer to the centre of mass; 50% more damping." }),
  T({ id: "rov_lights", group: "rover", line: "lights", lineName: "Chassis", name: "Kestrel LED light bar", cost: 30,
    effects: { lampRange: 1.6, lampW: -50 }, visual: "lightbar", text: "Night safe speed 5 -> 8 m/s with the lights on, and the lamps draw 50 W less." }),
  T({ id: "rov_arm", group: "rover", line: "arm", lineName: "Tools", name: "Kestrel sampling arm", cost: 90, mission: "first_core",
    effects: { arm: 1 }, visual: "arm", text: "Core a rock from the cab: stop with one within 4.5 m of the nose and press Interact (Cross / E). The tube goes in the suit's sample bag." }),
];
export const UPGRADE = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** The designs (their physics is VEHICLES in vehicle.js; this is what the Workshop sells and where parts bolt on).
 *  Mount points are in the MODEL's space: metres, +Z forward, +X the rover's left, y up from the ground. */
export const DESIGNS = [
  { id: "rover_crew", name: "Kestrel Crew Rover", cost: 0, builtin: true,
    text: "Kestrel Dynamics' pressurised six-wheel rover, the one you landed with: the all-rounder.",
    mounts: { pods: [[1.16, 0.95, -0.9], [1.16, 0.95, 0.35]], wings: [1.0, 3.1, -0.25], wingScale: 1, lightbar: [0, 3.12, 1.45], filters: [[0.8, 3.05, -1.85], [-0.8, 3.05, -1.85]], arm: [0.62, 1.1, 2.72], armScale: 1, podScale: 1, decal: { pos: [1.157, 1.86, 0.1], size: [1.6, 0.3] } } },
  { id: "rover_scout", name: "Kestrel Scout", cost: 150,
    text: "Four wheels and a two-seat pod: 12 m/s and nimble, but 14 kWh, a narrow track and little weight on the wheels.",
    mounts: { pods: [[0.81, 0.78, 0.3], [0.81, 1.13, 0.3]], podScale: 0.8, wings: [0.76, 2.02, -0.3], wingScale: 0.7, lightbar: [0, 2.19, -0.3], filters: [[0.45, 1.94, -1.05], [-0.45, 1.94, -1.05]], filterScale: 0.6, arm: [0.38, 0.67, 1.75], armScale: 0.8, decal: { pos: [0.807, 1.32, 0.2], size: [0.7, 0.26] } } },
  { id: "rover_hauler", name: "Kestrel Hauler", cost: 280, mission: "foothold",
    text: "Six big wheels under a cab and a cargo module: 60 kWh, 20 m2 of array and 24 kN of drive, at 6 m/s.",
    mounts: { pods: [[1.21, 1.5, -2.2], [1.21, 1.5, -1.0]], podScale: 1, wings: [1.15, 2.92, -1.0], wingScale: 1.2, lightbar: [0, 3.05, 2.2], filters: [[0.9, 3.05, 1.45], [-0.9, 3.05, 1.45]], arm: [0.75, 1.05, 3.5], armScale: 1.1, decal: { pos: [1.213, 2.05, -0.9], size: [2.0, 0.42] } } },
];
export const DESIGN = Object.fromEntries(DESIGNS.map((d) => [d.id, d]));

/** GeoHUB's palette, and a few working colours beside it. */
export const PALETTE = [
  { id: "kit", name: "Kit white", hex: "#e6e2d8" },
  { id: "ink", name: "Ink", hex: "#fdf7ff" },
  { id: "chrome", name: "Chrome magenta", hex: "#ff2bd6" },
  { id: "data", name: "Data cyan", hex: "#00e5ff" },
  { id: "violet", name: "Violet", hex: "#7b4dff" },
  { id: "deep", name: "Deep violet", hex: "#2a1260" },
  { id: "sunset", name: "Outrun sunset", hex: "#ff6a3d" },
  { id: "amber", name: "Amber", hex: "#ffb347" },
  { id: "crt", name: "CRT green", hex: "#4dffa6" },
  { id: "graphite", name: "Graphite", hex: "#3a3f47" },
  { id: "safety", name: "Safety orange", hex: "#e0641c" },
];
export const COLOUR = Object.fromEntries(PALETTE.map((c) => [c.id, c]));
export const VISORS = [
  { id: "gold", name: "Gold", hex: "#d9a437" }, { id: "silver", name: "Silver", hex: "#c9d1d9" }, { id: "data", name: "Cyan", hex: "#16c6e0" },
  { id: "chrome", name: "Magenta", hex: "#e02ac0" }, { id: "amber", name: "Amber", hex: "#ff9a2a" }, { id: "smoke", name: "Smoke", hex: "#262a31" },
];
export const VISOR = Object.fromEntries(VISORS.map((c) => [c.id, c]));
/** Shoulder patches. A mission patch is earned by completing that mission. */
export const PATCHES = [
  { id: "none", name: "None" }, { id: "geoid", name: "GeoID" }, { id: "jezero", name: "Jezero" }, { id: "ares", name: "Ares" },
  { id: "touchdown", name: "Touchdown", mission: "touchdown" }, { id: "first_core", name: "First core", mission: "first_core" },
  { id: "depot", name: "Depot", mission: "depot" }, { id: "survey", name: "Survey", mission: "survey" },
  { id: "foothold", name: "Foothold", mission: "foothold" }, { id: "storm", name: "Storm", mission: "storm" },
];
export const DECALS = [{ id: "none", name: "None" }, { id: "number", name: "Number" }, { id: "stripe", name: "Speed stripe" }, { id: "chevron", name: "Chevrons" }, { id: "geoid", name: "GeoID" }];
export const NAMES = ["Okafor", "Lindqvist", "Tanaka", "Moreau", "Castillo", "Haddad", "Novak", "Achterberg", "Iyer", "Kowalczyk", "Mensah", "Ferreira", "Sato", "Brennan", "Abara", "Quispe"];

/** The pioneer has no name, only a unit number (the story): the name tag always reads this. */
export const PIONEER_NAME = "Pioneer 1";
export const DEFAULT_LOOK = { name: PIONEER_NAME, suit: "kit", accent: "safety", visor: "gold", patch: "geoid", nametag: true, height: 1, build: 1 };
export const DEFAULT_PAINT = { body: "kit", accent: "safety", decal: "stripe", number: 7 };
export const LIMITS = { height: [0.94, 1.06], build: [0.9, 1.15], number: [1, 99], name: 18 };

/** A look or paint with every field valid (old saves, hand-edited storage). */
export function cleanLook(l) {
  const o = Object.assign({}, DEFAULT_LOOK, l || {});
  o.name = PIONEER_NAME;                       // fixed: old saves' names and any edit are replaced
  if (!COLOUR[o.suit]) o.suit = DEFAULT_LOOK.suit;
  if (!COLOUR[o.accent]) o.accent = DEFAULT_LOOK.accent;
  if (!VISOR[o.visor]) o.visor = DEFAULT_LOOK.visor;
  if (!PATCHES.some((p) => p.id === o.patch)) o.patch = DEFAULT_LOOK.patch;
  o.nametag = true;                            // always worn
  o.height = Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], +o.height || 1));
  o.build = Math.min(LIMITS.build[1], Math.max(LIMITS.build[0], +o.build || 1));
  return o;
}
export function cleanPaint(p) {
  const o = Object.assign({}, DEFAULT_PAINT, p || {});
  if (!COLOUR[o.body]) o.body = DEFAULT_PAINT.body;
  if (!COLOUR[o.accent]) o.accent = DEFAULT_PAINT.accent;
  if (!DECALS.some((d) => d.id === o.decal)) o.decal = DEFAULT_PAINT.decal;
  o.number = Math.min(LIMITS.number[1], Math.max(LIMITS.number[0], Math.round(+o.number || 7)));
  return o;
}

const NEUTRAL = { o2: 1, power: 1, scrub: 1, scrubW: 1, sprint: 1, hop: 1, air: 1, rad: 1, dust: 1, bag: 0, core: 1, scoop: 1, scan: 1, range: 1,
  drive: 1, speed: 1, capacity: 1, solar: 1, eff: 1, mu: 1, muSand: 1, sink: 1, crr: 0, stab: 1, damp: 1, lampRange: 1, lampW: 0, dustCut: 0, arm: 0 };
const ADDITIVE = new Set(["bag", "crr", "lampW", "dustCut", "arm"]);

/**
 * What a set of installed upgrades does, as one table of factors. Inside a line
 * the highest tier counts; an exclusive line counts only its equipped member.
 */
export function combine(installed, equipped = {}) {
  const out = Object.assign({}, NEUTRAL), best = {};
  for (const id of installed || []) {
    const u = UPGRADE[id];
    if (!u) continue;
    if (u.exclusive) { if (equipped[u.line] === id) best[u.line] = u; continue; }
    if (!best[u.line] || best[u.line].tier < u.tier) best[u.line] = u;
  }
  for (const line in best) for (const [k, v] of Object.entries(best[line].effects)) out[k] = ADDITIVE.has(k) ? out[k] + v : out[k] * v;
  return out;
}

/** Why an upgrade or design cannot be bought yet (null when it can), given what is owned and which missions are done. */
export function blocker(item, owned, missionsDone) {
  for (const r of item.requires || []) if (!owned.includes(r)) return "Needs " + ((UPGRADE[r] && UPGRADE[r].name) || r);
  if (item.mission && !(missionsDone || []).includes(item.mission)) return "Complete the mission “" + item.mission.replace(/_/g, " ") + "”";
  return null;
}
