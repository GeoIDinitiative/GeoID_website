/**
 * The game state: one plain object, serialisable as it stands, with a
 * versioned save format.
 *
 *   state = {
 *     schema: 1,                    // SAVE_SCHEMA; migrations below key on it
 *     site: "jezero",
 *     detail: "procedural-v1",      // which detail provider the ground was made with
 *     clock:   { sol, tod, ls, scale },   // tod = seconds since local midnight; ls = solar longitude, degrees
 *     weather: { tau, panelDust },        // dust optical depth; fraction of array output lost to dust (0..1)
 *     vehicle: { type, p, q, battery_J, odometer_m, energyUsed_J, headlights },
 *     objectives: { route: [poi ids], index, reached: {id: {sol, tod, odometer_m}}, complete,
 *                   start: {sol, tod, odometer_m, energyUsed_J} },
 *     entities: [ { id, type, x, z, yaw, data } ],   // PLACED things (base modules go here); y is never saved,
 *                                                    // it is re-derived from the ground on load
 *     view: { camera, honesty },
 *     playtime_s
 *   }
 *
 * Weather and hazards will drive `weather`; the base builder appends to
 * `entities`; missions extend `objectives`. Add fields freely: load() keeps
 * unknown ones. Change the meaning of a field: bump SAVE_SCHEMA and add a
 * step to MIGRATIONS.
 */
import { ATMOSPHERE, MARS, SAVE_KEY, SAVE_SCHEMA, SETTINGS_KEY, TIME_SCALE, DEFAULT_QUALITY } from "./config.js?v=b8cfe8e-efa5b7b7";

export function newState(site, detailId) {
  return {
    schema: SAVE_SCHEMA,
    site: site.id,
    detail: detailId,
    clock: { sol: 1, tod: 9.6 / 24 * MARS.solSeconds, ls: 5.6, scale: TIME_SCALE },
    weather: { tau: ATMOSPHERE.tau, panelDust: 0 },
    vehicle: null,
    objectives: { route: site.pois.slice(1).map((p) => p.id), index: 0, reached: {}, complete: false, start: null },
    entities: [],
    view: { camera: "chase", honesty: false },
    playtime_s: 0,
  };
}

/** schema n -> n + 1. Empty for now; the shape is here so the first change has somewhere to go. */
const MIGRATIONS = {
  // 1: (s) => { s.weather.wind = { speed: 0, dir: 0 }; return s; },
};

export function migrate(s) {
  let v = s.schema | 0;
  if (v < 1 || v > SAVE_SCHEMA) return null;
  while (v < SAVE_SCHEMA) { s = MIGRATIONS[v](s); v++; s.schema = v; }
  return s;
}

const store = () => { try { return window.localStorage; } catch { return null; } };

export function saveGame(state, siteId = state.site) {
  const ls = store();
  if (!ls) return false;
  try { ls.setItem(SAVE_KEY + "." + siteId, JSON.stringify(Object.assign({}, state, { savedAt: Date.now() }))); return true; }
  catch { return false; }
}

export function loadGame(siteId) {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SAVE_KEY + "." + siteId);
    if (!raw) return null;
    const s = migrate(JSON.parse(raw));
    return s && s.site === siteId ? s : null;
  } catch { return null; }
}

export function clearGame(siteId) { const ls = store(); if (ls) ls.removeItem(SAVE_KEY + "." + siteId); }
export function hasSave(siteId) { return !!loadGame(siteId); }

export const DEFAULT_SETTINGS = { quality: DEFAULT_QUALITY, invertY: false, units: "metric", touch: "auto", shadows: true, hazards: "standard" };
export function loadSettings() {
  const ls = store();
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse((ls && ls.getItem(SETTINGS_KEY)) || "{}")); }
  catch { return Object.assign({}, DEFAULT_SETTINGS); }
}
export function saveSettings(s) { const ls = store(); try { ls && ls.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private window */ } }

/** Advance the sol clock by `simSeconds`. */
export function advanceClock(clock, simSeconds) {
  clock.tod += simSeconds;
  while (clock.tod >= MARS.solSeconds) { clock.tod -= MARS.solSeconds; clock.sol += 1; clock.ls = (clock.ls + MARS.lsPerSol) % 360; }
  while (clock.tod < 0) { clock.tod += MARS.solSeconds; clock.sol -= 1; }
}
/** "14:07" in Mars local true solar time: a sol divided into 24 Mars-hours. */
export function clockText(clock) {
  const h = clock.tod / MARS.solSeconds * 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
export function solsBetween(a, b) {
  return (b.sol - a.sol) + (b.tod - a.tod) / MARS.solSeconds;
}

/**
 * The first objective: drive the published traverse. Call each frame with
 * the rover; returns an event ({reached} or {complete}) when something
 * happens.
 */
export const REACH_RADIUS = 30;
export function stepObjectives(state, site, vehicle) {
  const o = state.objectives;
  if (!o.start) o.start = { sol: state.clock.sol, tod: state.clock.tod, odometer_m: vehicle.odometer, energyUsed_J: vehicle.energyUsed };
  if (o.managed) return null;          // a missions system owns the objectives (missions.js); `route`, `index` and `reached` stay its record of the waypoints
  if (o.complete) return null;
  const poi = site.pois.find((p) => p.id === o.route[o.index]);
  if (!poi) { o.complete = true; return { complete: true }; }
  const d = Math.hypot(vehicle.p.x - poi.x, vehicle.p.z - poi.z);
  if (d > REACH_RADIUS) return null;
  o.reached[poi.id] = { sol: state.clock.sol, tod: state.clock.tod, odometer_m: vehicle.odometer };
  o.index++;
  if (o.index >= o.route.length) { o.complete = true; return { reached: poi, complete: true }; }
  return { reached: poi };
}
export function currentTarget(state, site) {
  const o = state.objectives;
  if (o.managed) return o.target || null;       // {id, name, note, x, z} set by the missions system (not saved)
  return o.complete ? null : site.pois.find((p) => p.id === o.route[o.index]) || null;
}
export function summary(state, vehicle) {
  const o = state.objectives, s = o.start || { sol: state.clock.sol, tod: state.clock.tod, odometer_m: 0, energyUsed_J: 0 };
  return {
    distance_m: vehicle.odometer - s.odometer_m,
    energy_kWh: (vehicle.energyUsed - s.energyUsed_J) / 3.6e6,
    sols: solsBetween(s, state.clock),
  };
}
