/**
 * HAZARDS: what the environment does to the rover, and the warnings that come
 * first. System id "hazards", order 30 (after weather and thermal).
 *
 * THE RULE: every consequence is forecast or visible before it lands, and
 * none of them is an instant death. Each hazard raises a HUD alert with a
 * severity and, where it has one, a lead time; writes an entry to the event
 * log (state.systems.hazards.log); and then costs something a player can
 * plan around: energy, time, speed, or component health that a base repairs.
 *
 * THE HAZARDS (rates are GAME DESIGN; what they are modelled on is real)
 *  Dust storms      Dust in the air cuts the array through the foundation's
 *                   own irradiance model (state.weather.tau). Dust also
 *                   SETTLES on the array (state.weather.panelDust): the
 *                   weather's deposition rate, reduced by up to 75% where the
 *                   rover is sheltered from the wind (env.shelter: the lee of
 *                   a ridge, or anything a base registers). It never exceeds
 *                   85%. Visibility sets a safe speed (see below). Warning:
 *                   the weather director's lead time, 1.5 to 30 Mars-hours.
 *  Low visibility   safe speed = what you can stop for: a tenth of the
 *                   visibility in three seconds, 2.5 m/s at night without
 *                   headlights, 5 with. Faster than that on rocky ground
 *                   triples wheel wear (rocks you did not see). No governor:
 *                   pushing on is the player's call.
 *  Sand traps       Where the hazard map's sand layer is above 0.55 the
 *                   wheels sink as they roll: the embedding depth grows
 *                   toward 10 to 35 cm with speed and wheel slip. Momentum
 *                   carries a fast, straight crossing through a small pocket;
 *                   a slow or turning one stops, as Spirit did at Troy.
 *                   Getting out: hold low range and work at it (the depth
 *                   falls slowly), or dig out with "right the rover", which
 *                   costs two hours instead of twenty minutes and leaves
 *                   traction mats down until the rover is clear. Warning: the
 *                   HUD names the trap 50 m ahead.
 *  Steep / loose    The physics already rolls a rover that asks too much. The
 *  slopes           HUD warns from 24 degrees of tilt and of steep ground
 *                   ahead; a rollover costs array health.
 *  Sharp rocks      Wheel wear per metre grows with rockiness and with the
 *                   square of speed (Curiosity's wheels were holed by sharp,
 *                   embedded rocks; the mission slowed down and re-routed
 *                   over softer ground). 6% of wheel health per kilometre
 *                   flat out on the rockiest ground, under 1% at 3 m/s.
 *  Radiation        The unshielded surface dose is tallied (dose_mSv) and
 *                   published; a solar particle event is announced three
 *                   Mars-hours ahead. What it does to crew is for the
 *                   astronaut and base systems to apply.
 *  Cold             thermal.js.
 *
 * DIFFICULTY (settings.hazards): "off" leaves the weather on screen and
 * harmless (no deposition, no wear, no sinking, and the array is compensated
 * for the dust in the air); "standard"; "harsh" multiplies every rate by 1.8.
 */
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { MARS } from "./config.js?v=6d37c9c-9b39e129";
import { surfaceIrradiance } from "./sky.js?v=6d37c9c-9b39e129";
import * as State from "./state.js?v=6d37c9c-9b39e129";
import { HazardMap } from "./hazardmap.js?v=6d37c9c-9b39e129";
// (thermal.js is loaded by plugins.js under its own URL: it is reached through getSystem("thermal"), never imported here)
const NO_EFFECTS = { panels: () => ({ solar: 1 }), wheels: () => ({ drive: 1, crr: 0 }) };
function difficulty(game) { const d = game.settings && game.settings.hazards; return d === "off" || d === "harsh" ? d : "standard"; }

export const RULES = {
  rate: { off: 0, standard: 1, harsh: 1.8 },
  panelDustMax: 0.85, shelterCut: 0.75,
  gustClean: { aboveMs: 15, perSol: 0.08 },               // strong gusts blow a little off
  sand: { enter: 0.55, leave: 0.45, depthMin: 0.10, depthMax: 0.35, lookAhead: [8, 16, 26, 38, 50], stuckDepth: 0.12, crawlOut: 0.012, digHours: 2 },
  rocks: { wearPerMetre: 6e-5, speedRef: 8, alertRock: 0.5, alertSpeed: 3.5, blindFactor: 3 },
  tilt: { warn: 24, danger: 32, aheadDeg: 27, rolloverPanels: 0.06 },
  safeSpeed: { perVisibility: 0.1 / 3, nightDark: 2.5, nightLit: 5, max: 8 },
  logMax: 200,
};
const SOL = MARS.solSeconds, HOUR = SOL / 24;
const fmtDur = (s) => { const m = Math.max(0, Math.round(s / HOUR * 60)); return m >= 90 ? (m / 60 >= 48 ? Math.round(m / 60 / 24) + " sols" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0")) : m + " min"; };
const fmtDist = (m) => m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m";
const STORM = { local: "Local dust storm", regional: "Regional dust storm", global: "Global dust storm" };
const _h = {}, _a = {};

export const hazards = {
  id: "hazards", order: 30,
  S: null, map: null, _st: null, _acc: 0, _ahead: 0, _aheadSlope: 0, _stuckT: 0, _rock: 0, _tipped: false,

  async init(game) {
    // the risk raster, from the real terrain, sliced behind the loading screen
    this.map = new HazardMap();
    game.env = game.env || {};
    game.env.hazardMap = this.map;
    await this.map.compute(game);
    game.input.on("hazardmap", () => { if (game.live) this.toggleOverlay(game); });
    // "Right the rover" from a sand trap is digging out: it works, and it takes two hours instead of twenty minutes.
    game.on("recover", () => {
      const S = this.S, Sd = RULES.sand;
      if (!S || S.embed <= 0.08) return;
      S.embed = 0; S.embedded = false; S.matted = true; this._stuckT = 0;       // mats under the wheels until it is clear of this trap
      State.advanceClock(game.state.clock, (Sd.digHours * 60 - 20) * 60);
      this.log(game, "sand", "warn", `Dug the rover out of a sand trap: ${Sd.digHours} hours of the sol spent`, { x: game.vehicle.p.x, z: game.vehicle.p.z });
      game.hud.toast(`Dug out of the sand<small>${Sd.digHours} hours of the sol spent</small>`, 4);
    });
  },

  load(game, saved) {
    const st = game.state;
    this._st = st;
    st.systems = st.systems || {};
    this.S = st.systems.hazards = saved && Array.isArray(saved.log) ? saved : { v: 1, log: [], dose_mSv: 0, embed: 0, embedded: false, counts: {}, seen: {}, overlay: { on: false, layer: "traversability" } };
    const S = this.S;
    S.counts = S.counts || {}; S.overlay = S.overlay || { on: false, layer: "traversability" };
    S.seen = S.seen || {}; this._stuckT = 0;
    if (this.map && this.map.ready) this.map.setOverlay(game, S.overlay.on, S.overlay.layer);
    game.env = game.env || {};
    game.env.radiation = game.env.radiation || {};
    game.env.radiation.cumulative_mSv = S.dose_mSv;
  },
  save() { return this.S || undefined; },

  /** Append to the event log. level: "info" | "warn" | "danger". */
  log(game, kind, level, text, data) {
    const S = this.S, c = game.state.clock;
    S.log.push({ sol: c.sol, tod: Math.round(c.tod), kind, level, text, data: data || null });
    if (S.log.length > RULES.logMax) S.log.splice(0, S.log.length - RULES.logMax);
    S.counts[kind] = (S.counts[kind] || 0) + 1;
    game.emit("hazard", S.log[S.log.length - 1]);
  },
  /** Log once per key (a storm's phase, a particle event) until the key is forgotten. */
  _once(game, key, kind, level, text, data) {
    const seen = this.S.seen || (this.S.seen = {});
    if (seen[key]) return false;
    if (Object.keys(seen).length > 400) this.S.seen = {};
    this.S.seen[key] = 1; this.log(game, kind, level, text, data); return true;
  },

  toggleOverlay(game, on = !this.S.overlay.on, layer = this.S.overlay.layer) {
    if (!this.map.setOverlay(game, on, layer)) return false;
    this.S.overlay.on = on; this.S.overlay.layer = this.map.overlay.layer;
    const L = this.map.layers.find((l) => l.id === this.map.overlay.layer);
    if (game.live) game.hud.toast(on ? `Hazard map: ${L.label}<small>green ${L.good}, red ${L.bad}. A heuristic from the terrain data, not a survey.</small>` : "Hazard map off", 3.5);
    const ui = getSystem("weather") && getSystem("weather").ui;
    if (ui) ui.legend(game, on ? L : null);
    return true;
  },
  /** Next layer (the pause menu's button): off -> each layer in turn -> off. */
  cycleOverlay(game) {
    const ids = this.map.layers.map((l) => l.id), S = this.S;
    if (!S.overlay.on) return this.toggleOverlay(game, true, ids[0]);
    const i = ids.indexOf(S.overlay.layer);
    return i >= ids.length - 1 ? this.toggleOverlay(game, false, ids[0]) : this.toggleOverlay(game, true, ids[i + 1]);
  },

  /** Called by the weather when a dust devil passes over the rover. */
  onDevil(game, d, before, after) {
    const got = before - after;
    this.log(game, "dust-devil", "info", got > 0.005 ? `A dust devil passed over the rover: array cleaned, ${Math.round(got * 100)}% of output recovered` : "A dust devil passed over the rover", { before, after });
    game.hud.toast(got > 0.005 ? `Dust devil: array cleaned<small>${Math.round(got * 100)}% of output recovered, as happened to Spirit and Opportunity</small>` : "Dust devil<small>it passed straight over the rover</small>", 4.5);
  },

  tick(game, dt, ctx) {
    const st = game.state;
    if (st !== this._st) this.load(game, st.systems && st.systems.hazards);
    const S = this.S, v = game.vehicle, env = game.env, hud = game.hud, simDt = ctx.simDt;
    const diff = difficulty(game), k = RULES.rate[diff], th = getSystem("thermal"), health = th && th.S ? th.S.health : null, EFFECTS = (th && th.EFFECTS) || NO_EFFECTS;
    const driving = ctx.mode === "driving" || game.mode === "driving";
    const mod = v.modifiers.hazards || (v.modifiers.hazards = { solar: 1, drive: 1, crr: 0 });
    if (!env || !env.wind) { mod.solar = 1; mod.drive = 1; mod.crr = 0; return; }
    const W = st.weather, T = env.time.abs_s;

    /* ── radiation: tally and announce ── */
    S.dose_mSv += env.radiation.dose_mSv_per_sol * simDt / SOL;
    env.radiation.cumulative_mSv = S.dose_mSv;
    const spe = env.radiation.spe;
    if (spe) {
      const rate = env.radiation.dose_mSv_per_sol.toFixed(1), peak = spe.peak_mSv_per_sol.toFixed(0);
      if (spe.phase === "warning") {
        hud.setAlert("radiation", `Solar particle event in ${fmtDur(spe.eta_s)}: dose rate to ${peak} mSv/sol. Get crew under cover`, "warn");
        this._once(game, spe.id + ":warn", "radiation", "warn", `Solar particle event forecast in ${fmtDur(spe.eta_s)}, peaking near ${peak} mSv/sol`, { eta_s: spe.eta_s, peak_mSv_per_sol: spe.peak_mSv_per_sol });
      } else {
        hud.setAlert("radiation", `Solar particle event (${spe.phase}): ${rate} mSv/sol, ${fmtDur(spe.ends_s)} left`, spe.phase === "decay" ? "warn" : "danger");
        this._once(game, spe.id + ":on", "radiation", "danger", `Solar particle event began: dose rate rising toward ${peak} mSv/sol`, { peak_mSv_per_sol: spe.peak_mSv_per_sol });
      }
    } else hud.setAlert("radiation", null);

    /* ── dust storms: the warning, the dust on the array ── */
    const storm = env.dust.storm;
    if (storm) {
      const name = STORM[storm.kind], loss = Math.round(storm.solar_loss * 20) * 5;
      if (storm.phase === "approaching") {
        hud.setAlert("storm", `${name} in ${fmtDur(storm.eta_s)}: solar input −${loss}%. Push on, turn back or find shelter`, storm.kind === "local" ? "info" : "warn");
        this._once(game, storm.id + ":warn", "storm", "warn", `${name} warning: arriving in ${fmtDur(storm.eta_s)} from the ${compassOf(storm.from_deg)}, dust optical depth to about ${storm.peak_tau.toFixed(1)}, solar input down about ${loss}%`,
          { kind: storm.kind, eta_s: storm.eta_s, peak_tau: storm.peak_tau, solar_loss: storm.solar_loss });
      } else if (storm.phase === "peak") {
        hud.setAlert("storm", `${name}: visibility ${fmtDist(env.visibility_m)}, ${fmtDur(storm.ends_s)} to clear`, storm.kind === "local" ? "warn" : "danger");
        this._once(game, storm.id + ":peak", "storm", storm.kind === "local" ? "warn" : "danger", `${name} arrived: dust optical depth rising to about ${storm.peak_tau.toFixed(1)}`, { kind: storm.kind, peak_tau: storm.peak_tau });
      } else {
        hud.setAlert("storm", `${name} clearing: ${fmtDur(storm.ends_s)} left`, "info");
        this._once(game, storm.id + ":clear", "storm", "info", `${name} clearing`, { kind: storm.kind });
      }
    } else hud.setAlert("storm", null);

    const x = v.p.x, z = v.p.z;
    if (k > 0) {
      const sheltered = env.shelter ? env.shelter(x, z) : 0;
      let dust = (W.panelDust || 0) + env.dust.panel_deposition_per_sol * (1 - RULES.shelterCut * sheltered) * k * simDt / SOL;
      if (env.wind.gust_ms > RULES.gustClean.aboveMs && !(storm && storm.phase === "peak")) dust -= dust * RULES.gustClean.perSol * simDt / SOL;
      W.panelDust = Math.max(0, Math.min(RULES.panelDustMax, dust));
      env.rover = env.rover || {};
      env.rover.shelter = sheltered;
      if (W.panelDust > 0.3) { if (this._once(game, "dust30", "dust", "warn", "Dust on the array is costing 30% of its output: a dust devil or a base's cleaning bay will clear it")) hud.toast("Array dusty: 30% of output lost<small>drive through a dust devil, or clean it at a base</small>", 5); }
      else if (W.panelDust < 0.2 && S.seen) delete S.seen.dust30;
    }

    /* ── the array: component health, and "off" means the dust in the air costs nothing ── */
    let solar = health ? EFFECTS.panels(health.panels).solar : 1;
    if (k === 0) {
      const sky = game.sky, sinEl = sky.sun.sinEl;
      if (sinEl > 0.01 && env.tau > 0.56) {
        const clear = surfaceIrradiance(sinEl, 0.55), now = sky.irradiance;
        _a.x = 0; _a.y = 1; _a.z = 0;
        const up = v.q ? upOf(v.q, _a) : _a, facing = Math.max(0, up.x * sky.sunDir.x + up.y * sky.sunDir.y + up.z * sky.sunDir.z);
        const want = clear.direct / sinEl * facing + clear.diffuse, got = now.direct / sinEl * facing + now.diffuse;
        if (got > 1e-4) solar *= Math.max(1, want / got);
      }
      solar /= Math.max(0.05, 1 - (W.panelDust || 0));         // and whatever dust an earlier difficulty left on the array
      solar = health ? solar / EFFECTS.panels(health.panels).solar : solar;
    }
    mod.solar = solar;
    const wheel = health && k > 0 ? EFFECTS.wheels(health.wheels) : { drive: 1, crr: 0 };
    mod.drive = wheel.drive; mod.crr = wheel.crr;

    /* ── safe speed for the visibility ── */
    const R = RULES.safeSpeed, night = game.sky.sun.sinEl <= 0.02;
    let safe = Math.min(R.max, Math.max(1.5, env.visibility_m * R.perVisibility));
    if (night) safe = Math.min(safe, v.headlights ? R.nightLit * (v.lampRange || 1) : R.nightDark);     // lampRange: a light bar (game/progress.js)
    env.rover = env.rover || {};
    env.rover.safe_speed_ms = safe;
    const speed = Math.abs(v.t.speed), blind = speed > safe + 0.5;
    if (k > 0 && driving && blind && safe < R.max - 0.01) hud.setAlert("speed", `Too fast for the ${night ? "dark" : "visibility"}: safe speed ${safe.toFixed(1)} m/s`, "warn");
    else hud.setAlert("speed", null);

    if (!driving || !this.map || !this.map.ready) { this._clearTerrain(hud); return; }

    /* ── terrain: five times a second for the look-ahead, every tick for the sinking ── */
    const here = this.map.value("sand", x, z);
    this._acc += dt;
    if (this._acc >= 0.2) {
      this._acc = 0;
      const dir = v.t.speed < -0.3 ? -1 : 1, hd = v.t.heading * Math.PI / 180, fx = Math.sin(hd) * dir, fz = -Math.cos(hd) * dir;
      let trapAt = 0, steepAt = 0;
      for (const d of RULES.sand.lookAhead) {
        if (!trapAt && this.map.value("sand", x + fx * d, z + fz * d) > RULES.sand.enter) trapAt = d;
        if (!steepAt && this.map.value("slope_deg", x + fx * d, z + fz * d) > RULES.tilt.aheadDeg) steepAt = d;
      }
      this._ahead = trapAt; this._aheadSlope = steepAt;
      this._rock = game.surface.regolith(x, z, _h).rock;
    }
    const moving = speed > 0.4;

    // sand
    const Sd = RULES.sand;
    if (k > 0) {
      const inTrap = here > (S.embed > 0.01 ? Sd.leave : Sd.enter) && !v.t.airborne;
      if (inTrap) {
        const i = Math.min(1, (here - Sd.leave) / (1 - Sd.leave));
        const depth = S.matted ? 0.04 : Sd.depthMin + (Sd.depthMax - Sd.depthMin) * i + (diff === "harsh" ? 0.05 : 0);
        const crawlingOut = game.input.ctl.crawl && (game.input.ctl.throttle > 0.2 || game.input.ctl.brake > 0.2);
        if (crawlingOut && S.embed > 0.06) S.embed = Math.max(0.06, S.embed - Sd.crawlOut / (diff === "harsh" ? 2 : 1) * dt);       // low range, patiently
        else if (S.embed < depth) S.embed = Math.min(depth, S.embed + (0.02 + 0.05 * speed + (v.t.slipping ? 0.10 : 0)) * (0.4 + 0.6 * i) * dt);
      } else { S.matted = false; if (S.embed > 0) S.embed = Math.max(0, S.embed - (0.05 + 0.10 * speed) * dt); }
      if (S.embed > 0) for (const w of v.wheels) if (w.contact && w.sink < S.embed) w.sink = S.embed;
      this._stuckT = S.embed > Sd.stuckDepth && speed < 0.3 ? this._stuckT + dt : 0;
      if (this._stuckT > 2 && !S.embedded) {
        S.embedded = true;
        this.log(game, "sand", "danger", "Embedded in a sand trap: the wheels have dug in", { x, z, depth_m: S.embed, likelihood: here });
      } else if (S.embedded && (S.embed < 0.07 || speed > 1)) { S.embedded = false; this.log(game, "sand", "info", "Free of the sand trap", { x, z }); }
    } else { S.embed = 0; S.embedded = false; }
    if (S.embedded) hud.setAlert("sand", "Embedded: hold low range (Shift / L1) and work free, or dig out (R / L3, 2 hours)", "danger");
    else if (k > 0 && S.embed > 0.03 && here > Sd.leave) hud.setAlert("sand", `Sand trap: sinking ${Math.round(S.embed * 100)} cm. Keep moving straight, or back out in low range`, "danger");
    else if (this._ahead && moving) {
      hud.setAlert("sand", `Sand trap ${this._ahead} m ahead: steer round it, or cross fast and straight`, "warn");
      if (k > 0) this._once(game, "sand:" + Math.round(x / 60) + ":" + Math.round(z / 60), "sand", "warn", `Sand trap flagged ${this._ahead} m ahead`, { x, z });
    } else hud.setAlert("sand", null);

    // slopes
    const Tl = RULES.tilt, tilt = v.t.tilt;
    if (v.t.tipped) {
      if (!this._tipped) { this._tipped = true; this.log(game, "rollover", "danger", "The rover rolled over", { x, z, slope: v.t.slope }); if (th && k > 0) th.damage(game, "panels", Tl.rolloverPanels * k, "the rover rolled onto its array"); }
      hud.setAlert("slope", null);
    } else {
      this._tipped = false;
      if (tilt > Tl.danger) hud.setAlert("slope", `Tilt ${tilt.toFixed(0)}°: about to roll. Turn downhill and stop`, "danger");
      else if (tilt > Tl.warn) hud.setAlert("slope", `Tilt ${tilt.toFixed(0)}°: rollover risk. Take slopes straight up or down`, "warn");
      else if (this._aheadSlope && moving) hud.setAlert("slope", `Steep ground ${this._aheadSlope} m ahead (over ${Tl.aheadDeg}°)`, "warn");
      else if (v.t.slope > 12 && v.t.sand > 0.45 && moving) hud.setAlert("slope", "Loose slope: traction is marginal, use low range", "info");
      else hud.setAlert("slope", null);
    }

    // rocks
    const Rk = RULES.rocks, rock = this._rock || 0;
    if (k > 0 && th && moving && !v.t.airborne) {
      const wear = Rk.wearPerMetre * Math.pow(rock, 1.5) * (speed / Rk.speedRef) ** 2 * (blind ? Rk.blindFactor : 1) * k * speed * dt;
      if (wear > 0) th.damage(game, "wheels", wear, blind ? "rocks hit at speed in poor visibility" : "sharp rocks at speed");
    }
    if (k > 0 && rock > Rk.alertRock && speed > Rk.alertSpeed) hud.setAlert("rocks", `Sharp rocks: wheel wear. Slow below ${Rk.alertSpeed.toFixed(0)} m/s or find softer ground`, "warn");
    else hud.setAlert("rocks", null);

  },

  _clearTerrain(hud) { hud.setAlert("sand", null); hud.setAlert("slope", null); hud.setAlert("rocks", null); },
  onMode(game, mode) { if (mode !== "driving" && game.hud.setAlert) this._clearTerrain(game.hud); },
};

function compassOf(deg) { return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
/** The rover's up vector from its quaternion, without allocating. */
function upOf(q, out) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  out.x = 2 * (x * y - w * z); out.y = 1 - 2 * (x * x + z * z); out.z = 2 * (y * z + w * x);
  return out;
}

registerSystem(hazards);
