// Game systems: the extension point for everything built on the foundation
// (weather and hazards, the base builder, the astronaut, missions).
//
// A system is a plain object registered once at module load:
//
//   registerSystem({
//     id: "weather",            // unique; also its key in the save file
//     order: 10,                // lower runs first (weather before power before hud)
//     async init(game) {},      // after terrain, vehicle and entities exist; before the first frame
//     load(game, saved) {},     // saved = what save() returned last time, or undefined on a new game
//     save(game) { return {} }, // JSON-able; stored under state.systems[id]
//     tick(game, dt, ctx) {},   // simulation step; ctx = { ctl, active, simDt }; only while the game is live (not paused / in menus)
//     frame(game, dt) {},       // every rendered frame, paused or not (visuals, UI)
//     onMode(game, mode, prev) {}, // game.setMode changes
//     dispose(game) {},
//   });
//
// Systems are imported from plugins.js (one line each), which main.js imports.
// A system must not assume another exists: ask with getSystem(id) and cope with
// undefined. Nothing here may throw into the frame loop: a failing system is
// reported once and switched off, and the game carries on.

const SYSTEMS = [];
const dead = new Set();

export function registerSystem(sys) {
  if (!sys || !sys.id) throw new Error("a system needs an id");
  if (SYSTEMS.some((s) => s.id === sys.id)) return sys;
  SYSTEMS.push(sys);
  SYSTEMS.sort((a, b) => (a.order || 0) - (b.order || 0));
  return sys;
}
export function getSystem(id) { return SYSTEMS.find((s) => s.id === id && !dead.has(id)); }
export function systemList() { return SYSTEMS.filter((s) => !dead.has(s.id)); }
export const systemErrors = [];

function guard(sys, what, fn) {
  if (dead.has(sys.id)) return undefined;
  try { return fn(); }
  catch (err) {
    dead.add(sys.id);
    systemErrors.push({ id: sys.id, what, message: String(err && err.message || err) });
    console.error(`[systems] ${sys.id}.${what} failed and was switched off:`, err);
    return undefined;
  }
}

export async function initSystems(game) {
  for (const s of SYSTEMS) {
    if (!s.init || dead.has(s.id)) continue;
    try { await s.init(game); }
    catch (err) {
      dead.add(s.id);
      systemErrors.push({ id: s.id, what: "init", message: String(err && err.message || err) });
      console.error(`[systems] ${s.id}.init failed and was switched off:`, err);
    }
  }
}
export function loadSystems(game, state) {
  const saved = (state && state.systems) || {};
  for (const s of SYSTEMS) if (s.load) guard(s, "load", () => s.load(game, saved[s.id]));
}
export function saveSystems(game, state) {
  const out = Object.assign({}, state.systems || {});
  for (const s of SYSTEMS) if (s.save) { const v = guard(s, "save", () => s.save(game)); if (v !== undefined) out[s.id] = v; }
  state.systems = out;
}
export function tickSystems(game, dt, ctx) { for (const s of SYSTEMS) if (s.tick) guard(s, "tick", () => s.tick(game, dt, ctx)); }
export function frameSystems(game, dt) { for (const s of SYSTEMS) if (s.frame) guard(s, "frame", () => s.frame(game, dt)); }
export function modeSystems(game, mode, prev) { for (const s of SYSTEMS) if (s.onMode) guard(s, "onMode", () => s.onMode(game, mode, prev)); }
