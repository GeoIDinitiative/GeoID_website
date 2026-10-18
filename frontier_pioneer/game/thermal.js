/**
 * THERMAL: the cold, and the rover's component health. System id "thermal",
 * order 20 (after weather, before hazards).
 *
 * WHAT IT MODELS (GAME DESIGN on real physics; the numbers are the game's)
 *  - The battery pack has a temperature. Survival heaters hold it at 283 K
 *    (10 C) while they can: they need G x (283 - air) watts and have a
 *    ceiling, so on a 193 K night they fall short and the pack settles
 *    around 253 K. That heater power is an extra hotel load: night driving
 *    costs more, and a storm's cold days cost more than clear ones.
 *  - A cold pack delivers less: full capacity down to 268 K (-5 C), 70% at
 *    233 K (-40 C), 45% at 203 K. (Lithium-ion cells lose roughly a quarter
 *    of their capacity by -20 C and most of it by -40 C; the curve is that
 *    shape, not a datasheet.) The lost part is LOCKED, not gone: the rover
 *    goes flat when the charge falls to the locked amount, and gets it back
 *    as the pack warms.
 *  - With no power (a flat battery at night) the heaters stop and the pack
 *    cools toward the air with a three-hour time constant. Below 233 K the
 *    cells and the heaters themselves take damage, slowly: 4% an hour
 *    (Standard). The HUD gives the time left before that line is crossed.
 *    This is what ended Spirit and Opportunity: not the storm, the cold
 *    after the power ran out.
 *  - Component health, 0.2 .. 1 each: battery, heaters, wheels, panels. A
 *    damaged component works worse (see EFFECTS) and never fails outright:
 *    the rover can always limp. Repair is for a base to offer:
 *        getSystem("thermal").repair("wheels", 0.25)
 *    Other systems add damage through damage(component, amount, cause).
 *
 * It publishes game.env.rover = { pack_K, capacity_factor, locked_fraction,
 * heater_W, heater_max_W, powered, cold_damage_eta_s, health: {...} } and
 * feeds the vehicle through vehicle.modifiers.thermal.
 *
 * Hazards "Off": the pack stays warm, the heaters cost nothing, nothing wears.
 */
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";

export const THERMAL = {
  setpointK: 283,
  conductance: { standard: 5.0, harsh: 6.5 },       // W/K from the pack to the air
  heaterMaxW: 300,
  tauPoweredS: 1.5 * 3699, tauUnpoweredS: 3 * 3699, // time constants, simulated seconds
  curve: [[268, 1.0], [233, 0.70], [203, 0.45]],    // pack temperature K -> fraction of capacity
  damageBelowK: 233,
  damagePerHour: { standard: 0.04, harsh: 0.08 },
  minHealth: 0.2,
};
/** How each component's health (h = 0.2 .. 1) changes the rover. */
export const EFFECTS = {
  battery: (h) => ({ capacity: 0.6 + 0.4 * h }),            // usable capacity x
  heaters: (h) => ({ heaterMax: h }),                       // heater ceiling x
  wheels: (h) => ({ drive: 0.6 + 0.4 * h, crr: 0.05 * (1 - h) }),   // drive force x, rolling resistance +
  panels: (h) => ({ solar: 0.5 + 0.5 * h }),                // array output x
};
export const COMPONENTS = ["battery", "heaters", "wheels", "panels"];

export function difficulty(game) {
  const d = game.settings && game.settings.hazards;
  return d === "off" || d === "harsh" ? d : "standard";
}
export function capacityFactor(packK) {
  const c = THERMAL.curve;
  if (packK >= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (packK >= c[i][0]) return c[i][1] + (c[i - 1][1] - c[i][1]) * (packK - c[i][0]) / (c[i - 1][0] - c[i][0]);
  return c[c.length - 1][1];
}
const fmtC = (k) => (k - 273.15 >= 0 ? "" : "−") + Math.abs(Math.round(k - 273.15)) + " °C";
function fmtDur(s) { const m = Math.max(0, Math.round(s / 3699 * 60)); return m >= 60 ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min" : m + " min"; }

export const thermal = {
  id: "thermal", order: 20,
  THERMAL, EFFECTS, COMPONENTS,
  S: null, _st: null, _warned: {},

  load(game, saved) {
    const st = game.state;
    this._st = st;
    st.systems = st.systems || {};
    this.S = st.systems.thermal = saved && saved.health ? saved : { v: 1, pack_K: THERMAL.setpointK, health: { battery: 1, heaters: 1, wheels: 1, panels: 1 }, coldHours: 0 };
    this._warned = {};
    this._publish(game, 0, true, Infinity);
  },
  save() { return this.S || undefined; },

  /** Wear or break something: amount is a fraction of full health. Returns the new health. */
  damage(game, component, amount, cause = "") {
    const H = this.S.health;
    if (!(component in H) || !(amount > 0) || difficulty(game) === "off") return H[component];
    const before = H[component];
    H[component] = Math.max(THERMAL.minHealth, before - amount);
    // report each quarter lost, once
    const step = (h) => Math.floor((1 - h) * 4 + 1e-9);
    if (step(H[component]) > step(before)) {
      const hz = getSystem("hazards"), pct = Math.round(H[component] * 100);
      const text = `${component[0].toUpperCase() + component.slice(1)} at ${pct}%` + (cause ? ": " + cause : "");
      if (hz && hz.log) hz.log(game, "damage", pct < 55 ? "danger" : "warn", text, { component, health: H[component] });
      game.hud.toast(`${text}<small>repair at a base</small>`, 4);
    }
    return H[component];
  },
  /** Restore health (a base's repair bay). amount defaults to everything. */
  repair(game, component, amount = 1) {
    const H = this.S.health;
    for (const c of component === "all" ? COMPONENTS : [component]) if (c in H) H[c] = Math.min(1, H[c] + amount);
    return H;
  },

  tick(game, dt, ctx) {
    const st = game.state;
    if (st !== this._st) this.load(game, st.systems && st.systems.thermal);
    const S = this.S, v = game.vehicle, env = game.env, diff = difficulty(game), simDt = ctx.simDt;
    const air = env && env.temp ? env.temp.air_K : 220;
    if (diff === "off") {
      S.pack_K = THERMAL.setpointK;
      v.modifiers.thermal = null;
      this._publish(game, 0, true, Infinity);
      game.hud.setAlert("cold", null); game.hud.setAlert("battery-cold", null);
      return;
    }
    const G = THERMAL.conductance[diff], heaterMax = THERMAL.heaterMaxW * EFFECTS.heaters(S.health.heaters).heaterMax;
    // the heaters run off the battery, or straight off the array when the Sun is up
    const powered = !v.flat || v.t.solar_W > 150;
    const heater = powered ? Math.max(0, Math.min(heaterMax, G * (THERMAL.setpointK - air))) : 0;
    const eq = Math.min(THERMAL.setpointK, air + heater / G);
    const tc = powered ? THERMAL.tauPoweredS : THERMAL.tauUnpoweredS;
    S.pack_K += (eq - S.pack_K) * (1 - Math.exp(-simDt / tc));
    const cap = capacityFactor(S.pack_K) * EFFECTS.battery(S.health.battery).capacity;
    v.modifiers.thermal = { hotel_W: heater, locked: 1 - cap };

    // deep cold without power: damage, slowly, and never without warning
    let eta = Infinity;
    if (S.pack_K < THERMAL.damageBelowK) {
      eta = 0;
      const d = THERMAL.damagePerHour[diff] * simDt / 3699;
      S.coldHours += simDt / 3699;
      this.damage(game, "battery", d, "the pack froze with no power for its heaters");
      this.damage(game, "heaters", d * 0.5, "the heaters froze");
    } else if (eq < THERMAL.damageBelowK) eta = -tc * Math.log((THERMAL.damageBelowK - eq) / (S.pack_K - eq));
    this._publish(game, heater, powered, eta, heaterMax);

    // alerts
    const hud = game.hud, hz = getSystem("hazards");
    if (!powered && eta < Infinity) {
      const text = eta > 0 ? `No power for the heaters: pack ${fmtC(S.pack_K)}, damage in ${fmtDur(eta)}` : `Battery pack frozen (${fmtC(S.pack_K)}): taking damage`;
      hud.setAlert("cold", text, "danger");
      if (!this._warned.cold) { this._warned.cold = true; if (hz && hz.log) hz.log(game, "cold", "danger", text, { pack_K: S.pack_K, eta_s: eta }); }
    } else { hud.setAlert("cold", null); this._warned.cold = false; }
    if (cap < 0.93 && powered) hud.setAlert("battery-cold", `Cold battery: ${Math.round(cap * 100)}% of capacity usable (pack ${fmtC(S.pack_K)})`, "info");
    else hud.setAlert("battery-cold", null);
  },

  _publish(game, heater, powered, eta, heaterMax = THERMAL.heaterMaxW) {
    const S = this.S, env = game.env = game.env || {};
    const cap = capacityFactor(S.pack_K) * EFFECTS.battery(S.health.battery).capacity;
    env.rover = Object.assign(env.rover || {}, {
      pack_K: S.pack_K, capacity_factor: cap, locked_fraction: 1 - cap, heater_W: heater, heater_max_W: heaterMax, powered,
      cold_damage_eta_s: eta, health: S.health,
    });
  },
};

registerSystem(thermal);
