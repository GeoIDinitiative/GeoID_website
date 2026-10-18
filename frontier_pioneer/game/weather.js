/**
 * WEATHER: the environment model for the site, and the "weather director"
 * that schedules its events. System id "weather", order 10.
 *
 * It publishes ONE object, `game.env`, rebuilt in place every tick. That
 * object is the contract the other systems read (thermal, hazards, the base
 * builder, the astronaut, missions). It also drives `state.weather.tau`, the
 * one number the foundation's sky, Sun, haze and solar array follow.
 *
 * DETERMINISM. Everything here is a pure function of (seed, sol clock): the
 * background dust, the wind, the temperatures, the storms the director
 * schedules, the forecast. The seed is in the save, so a reload gives the
 * same weather, and so does replaying the same sol. The only accumulated
 * state is what the player can change (scripted events, a manual tau from the
 * menu slider, the dust devils alive right now).
 *
 * WHAT IS MEASURED CLIMATOLOGY AND WHAT IS GAME DESIGN
 *  Measured ranges (Perseverance / MEDA era, Jezero, 18.4 N; the curve
 *  SHAPES below are simple fits to the published ranges, not the data):
 *   - Air temperature at 1.5 m: daily minimum about 190 to 198 K just before
 *     sunrise, daily maximum about 240 to 260 K in mid-afternoon; ground
 *     about 185 to 290 K, peaking near 13 h.
 *     [Rodriguez-Manfredi et al. 2023, Nature Geoscience 16, "The diverse
 *     meteorology of Jezero crater over the first 250 sols of Perseverance on
 *     Mars"; Munguira et al. 2023, JGR Planets 128, "Near surface atmospheric
 *     temperatures at Jezero from Mars 2020 MEDA measurements".]
 *   - Pressure: about 625 to 760 Pa over the Mars year (the CO2 cycle), with
 *     a daily thermal tide of roughly 10 to 35 Pa peak to peak, larger when
 *     dusty. [Sanchez-Lavega et al. 2023, JGR Planets 128, "Mars 2020
 *     Perseverance rover studies of the Martian atmosphere over Jezero from
 *     pressure measurements".]
 *   - Wind: mean about 3 m/s; afternoon upslope winds from the east-south-east
 *     of 5 to 8 m/s, weaker night winds from the west-north-west, gusts
 *     commonly 10 to 20 m/s and above 20 m/s on record. [Newman et al. 2022,
 *     Science Advances 8, "The dynamic atmospheric and aeolian environment of
 *     Jezero crater, Mars"; Viudez-Moreiras et al. 2022, JGR Planets 127,
 *     "Winds at the Mars 2020 landing site".]
 *   - Dust optical depth: about 0.3 to 0.5 in the clear aphelion season,
 *     0.6 to 1.0 and more in the perihelion dust season (Ls about 180 to
 *     330); the January 2022 regional storm took Jezero to about 1.5 to 2.
 *     [Lemmon et al. 2022, GRL 49, "Dust, sand, and winds within an active
 *     Martian storm in Jezero crater".] Regional storms elsewhere reach 2 to
 *     5; the 2018 global storm exceeded 8 at Curiosity and about 10.8 at
 *     Opportunity. [Guzewich et al. 2019, GRL 46, "Mars Science Laboratory
 *     observations of the 2018/Mars year 34 global dust storm".] The same
 *     paper is the source for the daily temperature range collapsing under
 *     heavy dust.
 *   - Convective vortices: Jezero is unusually active, several passing the
 *     rover each sol, peaking between noon and 13 h local. [Newman et al.
 *     2022, as above.] Dust devils cleaning solar panels is what kept Spirit
 *     and Opportunity alive (Spirit, sol 420, March 2005).
 *   - Radiation: about 0.64 mSv per sol of galactic cosmic rays at the
 *     surface. [Hassler et al. 2014, Science 343, "Mars' surface radiation
 *     environment measured with the Mars Science Laboratory's Curiosity
 *     rover".] The largest solar particle event Curiosity's RAD has recorded
 *     (May 2024) delivered about 8 mGy in a sol, some forty times background.
 *   - Dust settling on arrays: about 0.2% of output per sol (MER, InSight).
 *
 *  Game design, and said so wherever it is used:
 *   - EVENT FREQUENCY IS COMPRESSED. Jezero sees perhaps one to three
 *     regional storms in a 668-sol year and a global storm about one year in
 *     three. The director schedules a regional storm about every 10 to 18
 *     sols (some sixty times too often), guarantees the first between sols 3
 *     and 5 so a short game meets one, and allows a global storm from sol 8 in
 *     the dust season at about 1% per sol. Sol 1 is always quiet.
 *   - STORM LENGTHS ARE COMPRESSED: a regional storm lasts 2 to 5 sols here
 *     (a week or more in reality), a global one 7 to 14 sols (months).
 *   - NEAR-SURFACE VISIBILITY in a storm is far lower than the column optical
 *     depth implies for well-mixed dust (tau 4 over an 11 km scale height is
 *     about 10 km). The model multiplies the extinction near the ground while
 *     dust is being lifted so a regional storm closes in to 60 to 550 m.
 *   - PANEL DEPOSITION runs at four times the measured rate, so that dust is
 *     a decision within a ten-sol game.
 *   - SOLAR PARTICLE EVENTS come at about 3.5% per sol with three Mars-hours
 *     of warning (real warning is tens of minutes).
 *   - DUST DEVILS and the gusts you see move in REAL seconds (the rover's
 *     clock), not simulated ones, or they would cross the screen thirty times
 *     too fast. How many there are per sol is close to the published rate.
 *   - The UV index is a game scale (irradiance, scaled), not a measurement.
 *   - The seasonal curves ignore the orbit's eccentricity, as sky.js does.
 */
import { MARS } from "./config.js?v=6d37c9c-9b39e129";
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { surfaceIrradiance, sunPosition } from "./sky.js?v=6d37c9c-9b39e129";

export const SOL = MARS.solSeconds;
export const HOUR = SOL / 24;           // one Mars-hour, the unit the HUD clock shows
const D2R = Math.PI / 180;
const DUST_SCALE_HEIGHT = 11000;        // metres; the foundation's haze uses the same number

/** The numbers, in one place (the README quotes this table). */
export const CLIMATE = {
  air:      { minK: 194, minSwingK: 4, maxK: 249, maxSwingK: 9, warmestLs: 230 },   // measured range, fitted
  ground:   { aboveAirMaxK: 28, belowAirMinK: 6, leadHours: 1.5 },                 // measured range, fitted
  pressure: { meanPa: 700, semiannualPa: 35, annualPa: 32, tidePa: 12, tide2Pa: 8 }, // measured range, fitted
  wind:     { nightMs: 2.4, dayPeakMs: 7.0, dayFromDeg: 115, nightFromDeg: 290 },    // measured range, fitted
  tau:      { clear: 0.42, dustSeason: 0.33, wobble: 0.12 },                          // measured range, fitted
  storms: {                                                                           // GAME DESIGN (see header)
    local:    { perSol: [0.16, 0.26], leadH: [1.5, 2.5], rampH: 0.4, holdH: [2, 7], clearH: [2, 5], addTau: [0.7, 1.8], windMs: [4, 8] },
    regional: { perSol: [0.05, 0.11], leadH: [6, 10], rampH: 1.5, holdH: [29, 84], clearH: [14, 36], addTau: [1.8, 4.8], windMs: [6, 11] },
    global:   { perSol: [0, 0.012], leadH: [20, 30], rampH: 5, holdH: [120, 240], clearH: [48, 96], addTau: [5, 9], windMs: [8, 14] },
    firstRegionalSol: [3, 5], quietSols: 1, globalFromSol: 8,
  },
  radiation: { gcr_mSv_per_sol: 0.64, spePerSol: 0.035, speFromSol: 3, speLeadH: 3, spePeak_mSv_per_sol: [8, 25] },
  deposition: { perSolAtTauHalf: 0.01, exponent: 1.2 },        // 4 x the measured 0.2 to 0.3% per sol
  devils: { peakHour: 12.8, widthHours: 2.2, slotSeconds: 240, chanceAtPeak: 0.22, cleanFraction: 0.35 },
};

/* ── deterministic randomness ───────────────────────────────────────────── */

/** A hash of three integers to [0, 1). The whole model's only source of chance. */
export function hash(seed, a = 0, b = 0) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 15;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Smooth 1-D value noise in [0, 1] on channel ch. */
function noise1(seed, x, ch) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(seed, i, ch) * (1 - u) + hash(seed, i + 1, ch) * u;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (range, r) => range[0] + (range[1] - range[0]) * r;
function lerpAngle(a, b, t) { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }

/** Simulated seconds since midnight of sol 1. */
export function absTime(clock) { return (clock.sol - 1) * SOL + clock.tod; }
export const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compass(deg) { return COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }

/* ── climatology: pure functions of season, hour and dust ───────────────── */

/** 0 in the clear season, 1 in the dust season (Ls about 180 to 330). */
export function dustSeason(ls) { ls = ((ls % 360) + 360) % 360; return smooth(165, 205, ls) * (1 - smooth(315, 350, ls)); }

/** The daily temperature curve, 0 (coldest, just before sunrise) to 1 (warmest, 14.5 h). */
function diurnal(h) {
  h = ((h % 24) + 24) % 24;
  if (h >= 6 && h < 14.5) return Math.sin(Math.PI / 2 * (h - 6) / 8.5);
  if (h >= 14.5 && h < 18.5) return 1 - 0.45 * (1 - Math.cos(Math.PI * (h - 14.5) / 4)) / 2;
  const hn = h >= 18.5 ? h - 18.5 : h + 5.5;                       // hours into the night, 0..11.5
  return 0.55 * Math.exp(-hn / 4.2) - 0.0356 * hn / 11.5;          // Newtonian cooling, closed to 0 at sunrise
}
/** Air (1.5 m) and ground temperature, kelvin. Heavy dust flattens the daily swing (Guzewich et al. 2019). */
export function temperatures(hour, ls, tau, out = {}) {
  const C = CLIMATE, s = Math.cos((ls - C.air.warmestLs) * D2R);
  const aMin = C.air.minK + C.air.minSwingK * s, aMax = C.air.maxK + C.air.maxSwingK * s;
  const gMin = aMin - C.ground.belowAirMinK, gMax = aMax + C.ground.aboveAirMaxK;
  const squash = 1 / (1 + 0.30 * Math.max(0, tau - 0.6));
  const aMid = (aMin + aMax) / 2, gMid = (gMin + gMax) / 2;
  const a = aMin + (aMax - aMin) * diurnal(hour), g = gMin + (gMax - gMin) * diurnal(hour + C.ground.leadHours);
  out.air_K = aMid + (a - aMid) * squash;
  out.ground_K = gMid + (g - gMid) * squash;
  return out;
}
/** Surface pressure, Pa: a two-harmonic fit to the shape of the seasonal CO2 cycle, plus the daily thermal tide. */
export function pressure(hour, ls, tau) {
  const P = CLIMATE.pressure;
  const season = P.meanPa + P.semiannualPa * Math.cos(2 * (ls - 62) * D2R) + P.annualPa * Math.cos((ls - 290) * D2R);
  const k = 1 + 0.5 * Math.max(0, tau - 0.5);
  return season + k * (P.tidePa * Math.cos(2 * Math.PI * (hour - 8) / 24) + P.tide2Pa * Math.cos(4 * Math.PI * (hour - 9.5) / 24));
}
/** Mean wind without storms: speed m/s, the bearing it blows FROM, and the gust level. */
export function baseWind(seed, sol, hour, out = {}) {
  const W = CLIMATE.wind;
  const day = smooth(8.5, 13.5, hour) * (1 - smooth(16, 19.5, hour));           // the afternoon upslope wind
  const night = (1 - smooth(4, 7, hour)) + smooth(21, 24, hour);                 // the weaker downslope wind
  const calm = 1 - 0.45 * (smooth(5, 7, hour) * (1 - smooth(7, 9, hour)) + smooth(18, 19.5, hour) * (1 - smooth(19.5, 21.5, hour)));
  const daily = 0.8 + 0.4 * hash(seed, sol, 5);                                  // some sols are windier
  const wob = 0.85 + 0.3 * noise1(seed, (sol * 24 + hour) / 1.7, 6);
  out.speed = (W.nightMs * (0.75 + 0.35 * night) + (W.dayPeakMs - W.nightMs) * day) * calm * daily * wob;
  const veer = (noise1(seed, (sol * 24 + hour) / 2.3, 7) - 0.5) * 50;
  out.from = (lerpAngle(W.nightFromDeg, W.dayFromDeg, smooth(7.5, 10.5, hour) * (1 - smooth(17.5, 20.5, hour))) + veer + 360) % 360;
  out.gust = out.speed * (1.6 + 0.5 * day) + 1;                                  // convective afternoons gust harder
  return out;
}
/** Background dust optical depth (no storms). */
export function backgroundTau(seed, T, ls) {
  const C = CLIMATE.tau;
  return Math.max(0.25, C.clear + C.dustSeason * dustSeason(ls) + C.wobble * (2 * noise1(seed, T / (1.7 * SOL), 21) - 1));
}
/** Near-surface extinction multiplier while dust is being lifted (GAME DESIGN: see the header). */
function liftBoost(stormTau) { const i = Math.min(1.3, stormTau / 4); return 1 + 30 * i + 60 * i * i; }

/* ── the weather director ───────────────────────────────────────────────── */

function makeStorm(seed, n, kind, lsAtSol, ch) {
  const K = CLIMATE.storms[kind], r = (k) => hash(seed, n, ch + k);
  const onsetHour = kind === "local" ? 12 + 5 * r(1) : 6 + 14 * r(1);
  const t_onset = (n - 1) * SOL + onsetHour * HOUR;
  const lead = pick(K.leadH, r(2)) * HOUR, hold = pick(K.holdH, r(3)) * HOUR, clear = pick(K.clearH, r(4)) * HOUR;
  const e = {
    id: kind[0] + n, kind, sol: n, onsetHour,
    t_warn: t_onset - lead, t_onset, ramp: K.rampH * HOUR, t_clear: t_onset + K.rampH * HOUR + hold, t_end: 0,
    add: pick(K.addTau, r(5)), wind: pick(K.windMs, r(6)), from_deg: (300 + 120 * r(7)) % 360,     // out of the north-west to north-east
  };
  e.t_end = e.t_clear + clear;
  return e;
}
/** A scripted storm (tests, missions): the same record, built from "seconds from now". */
function scriptedStorm(T, o, serial) {
  const kind = o.kind || "regional", K = CLIMATE.storms[kind];
  const lead = o.lead_s ?? pick(K.leadH, 0.5) * HOUR, ramp = o.ramp_s ?? K.rampH * HOUR;
  const hold = o.hold_s ?? pick(K.holdH, 0.3) * HOUR, clear = o.clear_s ?? pick(K.clearH, 0.3) * HOUR;
  const t_onset = T + lead;
  return { id: "x" + serial, kind, scripted: true, sol: Math.floor(t_onset / SOL) + 1, onsetHour: (t_onset % SOL) / HOUR,
    t_warn: T, t_onset, ramp, t_clear: t_onset + ramp + hold, t_end: t_onset + ramp + hold + clear,
    add: o.add_tau ?? (o.peak_tau ? Math.max(0.2, o.peak_tau - 0.5) : pick(K.addTau, 0.5)), wind: o.wind_ms ?? pick(K.windMs, 0.5), from_deg: o.from_deg ?? 340 };
}
/** Dust added by one storm at time T. */
function stormTau(e, T) {
  if (T < e.t_warn || T >= e.t_end) return 0;
  if (T < e.t_onset) return e.add * 0.06 * smooth(e.t_warn, e.t_onset, T);              // a faint precursor haze
  if (T < e.t_onset + e.ramp) return e.add * (0.06 + 0.94 * smooth(e.t_onset, e.t_onset + e.ramp, T));
  if (T < e.t_clear) return e.add * (1 + 0.07 * Math.sin((T - e.t_onset) / HOUR * 1.3));
  const x = (T - e.t_clear) / (e.t_end - e.t_clear);
  return e.add * Math.exp(-3.2 * x) * (1 - smooth(0.85, 1, x));
}
function stormPhase(e, T) { return T < e.t_onset ? "approaching" : T < e.t_clear ? "peak" : "clearing"; }

class Director {
  constructor(seed, sol0, ls0) { this.seed = seed; this.sol0 = sol0; this.ls0 = ls0; this.kinds = [null, null]; this.cache = new Map(); this.spe = new Map(); }
  ls(n) { return (((this.ls0 + (n - this.sol0) * MARS.lsPerSol) % 360) + 360) % 360; }
  /** "regional" | "global" | null for sol n: the raw draw, the guaranteed first storm, and a two-sol gap between big ones. */
  big(n) {
    const S = CLIMATE.storms, k = this.kinds;
    for (let m = k.length; m <= n; m++) {
      const d = dustSeason(this.ls(m)), u = hash(this.seed, m, 11);
      let kind = null;
      if (m > S.quietSols) {
        if (m >= S.globalFromSol && d > 0.3 && u < S.global.perSol[1] * d) kind = "global";
        else if (u < lerp(S.regional.perSol[0], S.regional.perSol[1], d)) kind = "regional";
        const first = S.firstRegionalSol[0] + Math.floor(hash(this.seed, 0, 12) * (S.firstRegionalSol[1] - S.firstRegionalSol[0] + 1));
        if (!kind && m === first && !k.slice(0, m).some(Boolean)) kind = "regional";
        if (kind && (k[m - 1] || k[m - 2])) kind = null;
      }
      k.push(kind);
    }
    return n >= 0 ? k[n] : null;
  }
  /** The storms that BEGIN on sol n. */
  storms(n) {
    if (n < 1) return [];
    let list = this.cache.get(n);
    if (list) return list;
    list = [];
    const S = CLIMATE.storms, big = this.big(n), d = dustSeason(this.ls(n));
    if (big) list.push(makeStorm(this.seed, n, big, this.ls(n), 100));
    else if (n > S.quietSols && hash(this.seed, n, 13) < (n === 2 ? 0.7 : lerp(S.local.perSol[0], S.local.perSol[1], d))) list.push(makeStorm(this.seed, n, "local", this.ls(n), 200));
    this.cache.set(n, list);
    return list;
  }
  /** The solar particle event that begins on sol n, or null. */
  particle(n) {
    const R = CLIMATE.radiation;
    if (n < R.speFromSol) return null;
    if (this.spe.has(n)) return this.spe.get(n);
    let e = null;
    if (hash(this.seed, n, 41) < R.spePerSol) {
      const r = (k) => hash(this.seed, n, 42 + k), t_onset = (n - 1) * SOL + (2 + 20 * r(1)) * HOUR;
      e = { id: "p" + n, t_warn: t_onset - R.speLeadH * HOUR, t_onset, rise: HOUR, t_decay: t_onset + (4 + 3 * r(2)) * HOUR, t_end: 0, peak: pick(R.spePeak_mSv_per_sol, r(3)) };
      e.t_end = e.t_decay + (6 + 4 * r(4)) * HOUR;
    }
    this.spe.set(n, e);
    return e;
  }
}
function speRate(e, T) {
  if (T < e.t_onset || T >= e.t_end) return 0;
  if (T < e.t_onset + e.rise) return e.peak * smooth(e.t_onset, e.t_onset + e.rise, T);
  if (T < e.t_decay) return e.peak;
  return e.peak * Math.exp(-3 * (T - e.t_decay) / (e.t_end - e.t_decay));
}
function spePhase(e, T) { return T < e.t_onset ? "warning" : T < e.t_onset + e.rise ? "rising" : T < e.t_decay ? "peak" : "decay"; }

/* ── the system ─────────────────────────────────────────────────────────── */

const _w = {}, _t = {}, _irr = { a: 0 };

export const weather = {
  id: "weather", order: 10,
  S: null, env: null, director: null, fx: null, ui: null,
  _st: null, _gust: 0, _real: 0, _fcKey: "", _shelters: [], _serial: 0,

  async init(game) {
    this._makeEnv(game);
    // The picture and the panels are separate modules, loaded here so a headless or broken one cannot stop the model.
    try { const m = await import("./weather_fx.js?v=6d37c9c-9b39e129"); this.fx = new m.WeatherFx(game); }
    catch (err) { console.warn("[weather] visuals unavailable:", err && err.message); }
    try { const m = await import("./weather_ui.js?v=6d37c9c-9b39e129"); this.ui = new m.WeatherUi(game); }
    catch (err) { console.warn("[weather] panels unavailable:", err && err.message); }
  },

  /** saved = what save() returned, or undefined on a new game (or a save from before this system existed). */
  load(game, saved) {
    const st = game.state;
    this._st = st;
    st.systems = st.systems || {};
    const fresh = !saved || typeof saved.seed !== "number";
    this.S = st.systems.weather = fresh
      ? { v: 1, seed: (Math.random() * 0x7fffffff) | 0, sol0: st.clock.sol, ls0: st.clock.ls, scripted: [], scriptedSpe: [], manual: null, lastTau: null, devils: [], devilSlot: -1, cleaned: 0 }
      : saved;
    const S = this.S;
    S.scripted = S.scripted || []; S.scriptedSpe = S.scriptedSpe || []; S.devils = S.devils || [];
    this.director = new Director(S.seed, S.sol0, S.ls0);
    this._fcKey = "";
    if (fresh) { S.lastTau = st.weather.tau = this.modelTau(absTime(st.clock), st.clock.ls); }
    else if (S.lastTau === null || S.lastTau === undefined) S.lastTau = st.weather.tau;
    this.refresh(game);
  },
  save(game) {
    const S = this.S, st = game.state;
    if (!S) return undefined;
    // someone set tau by hand (the menu slider, a test) since the last tick: keep it across the reload
    if (st.weather.tau !== S.lastTau) { S.manual = { tau: st.weather.tau, until: absTime(st.clock) + 2 * HOUR }; S.lastTau = st.weather.tau; }
    return S;
  },

  /* ── API for other systems, missions and tests ── */

  /** Start again from a known seed (tests; a mission that wants a particular week of weather). */
  reseed(game, seed) {
    const st = game.state, S = this.S;
    S.seed = seed | 0; S.sol0 = st.clock.sol; S.ls0 = st.clock.ls; S.scripted = []; S.scriptedSpe = []; S.manual = null; S.devils = []; S.devilSlot = -1;
    this.director = new Director(S.seed, S.sol0, S.ls0);
    this._fcKey = "";
    S.lastTau = st.weather.tau = this.modelTau(absTime(st.clock), st.clock.ls);
    this.refresh(game);
  },
  /** Schedule a storm: { kind, lead_s, ramp_s, hold_s, clear_s, peak_tau | add_tau, wind_ms, from_deg } (simulated seconds). */
  scriptStorm(game, o = {}) {
    const e = scriptedStorm(absTime(game.state.clock), o, ++this._serial + Math.floor(absTime(game.state.clock)));
    this.S.scripted.push(e); this.S.manual = null; this._fcKey = "";
    this.refresh(game);
    return e;
  },
  /** Schedule a solar particle event: { lead_s, hold_s, decay_s, peak_mSv_per_sol }. */
  scriptParticleEvent(game, o = {}) {
    const T = absTime(game.state.clock), t_onset = T + (o.lead_s ?? CLIMATE.radiation.speLeadH * HOUR);
    const e = { id: "px" + (++this._serial) + Math.floor(T), scripted: true, t_warn: T, t_onset, rise: o.rise_s ?? HOUR, t_decay: t_onset + (o.hold_s ?? 4 * HOUR), t_end: 0, peak: o.peak_mSv_per_sol ?? 15 };
    e.t_end = e.t_decay + (o.decay_s ?? 6 * HOUR);
    this.S.scriptedSpe.push(e);
    this.refresh(game);
    return e;
  },
  clearScripted(game) { this.S.scripted = []; this.S.scriptedSpe = []; this._fcKey = ""; this.refresh(game); },
  /** Put a dust devil in the world (tests, missions). */
  spawnDevil(game, o = {}) {
    const p = game.vehicle.p, d = { id: "dx" + (++this._serial), x: o.x ?? p.x + 60, z: o.z ?? p.z, r: o.r ?? 6, h: o.h ?? 160, age: o.age ?? 8, life: o.life ?? 120, spin: 1, cleaned: false, ph: 1.3, still: !!o.still };
    this.S.devils.push(d);
    return d;
  },

  /** Every storm that can matter at time T: those begun in the last fortnight, those warned for, and the scripted ones. */
  stormsAt(T, ahead = 2) {
    const n = Math.floor(T / SOL) + 1, out = [];
    for (let m = Math.max(1, n - 16); m <= n + ahead; m++) for (const e of this.director.storms(m)) out.push(e);
    for (const e of this.S.scripted) out.push(e);
    return out;
  },
  /** The model's dust optical depth at time T (background + the worst storm, plus a little of any others). */
  modelTau(T, ls) {
    let worst = 0, sum = 0;
    for (const e of this.stormsAt(T)) { const a = stormTau(e, T); sum += a; if (a > worst) worst = a; }
    return Math.min(12, backgroundTau(this.S.seed, T, ls) + worst + 0.3 * (sum - worst));
  },

  tick(game, dt, ctx) {
    const st = game.state;
    if (st !== this._st) this.load(game, st.systems && st.systems.weather);        // game.restart() swapped the state
    const S = this.S, T = absTime(st.clock);
    // tau: ours unless someone else wrote it since the last tick (the menu slider): then theirs for two hours, easing back
    if (S.lastTau !== null && Math.abs(st.weather.tau - S.lastTau) > 1e-9) S.manual = { tau: st.weather.tau, until: T + 2 * HOUR };
    let tau = this.modelTau(T, st.clock.ls);
    if (S.manual) {
      const k = smooth(S.manual.until, S.manual.until + HOUR, T);
      if (k >= 1) S.manual = null; else tau = lerp(S.manual.tau, tau, k);
    }
    st.weather.tau = S.lastTau = Math.max(0.05, tau);
    this._real += dt;
    // gusts: a real-time signal between the mean and the gust level (visual, not part of the deterministic model)
    const g = 0.5 + 0.5 * Math.sin(this._real * 0.61 + 1.7 * Math.sin(this._real * 0.173)) * Math.sin(this._real * 0.097 + 0.6);
    this._gust = Math.max(0, g) ** 2.2;
    this.refresh(game);
    this._devils(game, dt, T);
    // old scripted events are dropped once they are over
    if (S.scripted.length && S.scripted[0].t_end < T - SOL) S.scripted.shift();
    if (S.scriptedSpe.length && S.scriptedSpe[0].t_end < T - SOL) S.scriptedSpe.shift();
  },

  frame(game, dt) {
    if (!this.S) return;
    if (!game.live) this.refresh(game);          // paused: the menu's sliders still move the clock and the dust
    if (this.fx) this.fx.update(game, dt, this.env, this.S);
    if (this.ui) this.ui.update(game, dt, this.env);
  },
  onMode(game, mode) { if (this.ui) this.ui.onMode(game, mode); },
  dispose(game) { if (this.fx) this.fx.dispose(game); if (this.ui) this.ui.dispose(); },

  /* ── the environment object ── */

  _makeEnv(game) {
    const self = this;
    this.env = game.env = Object.assign(game.env || {}, {
      tau: 0.5,
      wind: { speed_ms: 0, dir_deg: 0, gust_ms: 0, now_ms: 0, vec: [0, 0] },
      temp: { air_K: 220, ground_K: 220 },
      pressure_Pa: 700,
      sun: { elevation_deg: 0, irradiance_Wm2: 0, uv_index: 0 },
      visibility_m: 80000, hazeK: 0,
      dust: { lifting: false, storm: null, panel_deposition_per_sol: 0, devils: [] },
      radiation: { dose_mSv_per_sol: CLIMATE.radiation.gcr_mSv_per_sol, spe: null },
      season: { ls_deg: 0, name: "", dust_season: false },
      forecast: [], today: null, outlook: "",
      time: { sol: 1, hour: 0, abs_s: 0 },
      /** 0 (open ground) .. 1 (fully sheltered from the wind blowing now) at a place. Terrain lee, raised by anything registered. */
      shelter(x, z) { return self.shelter(game, x, z); },
      /** Register fn(x, z) -> 0..1 (a base module, a hangar). Returns a function that removes it. */
      addShelter(fn) { self._shelters.push(fn); return () => { const i = self._shelters.indexOf(fn); if (i >= 0) self._shelters.splice(i, 1); }; },
    });
    if (!game.env.hazardMap) game.env.hazardMap = { ready: false, layers: [], sample: (x, z, out = {}) => Object.assign(out, { slope: 0, sand: 0, shelter: 0, solar: 1, traversability: 1, suitability: 0, slope_deg: 0, ready: false }) };
  },

  shelter(game, x, z) {
    const env = this.env, f = game.field, th = env.wind.dir_deg * D2R, ux = Math.sin(th), uz = -Math.cos(th);       // upwind
    const h0 = f.height(x, z) + 2;
    let ang = 0;
    for (const d of [15, 30, 60, 100, 160, 240]) ang = Math.max(ang, Math.atan2(f.height(x + ux * d, z + uz * d) - h0, d));
    let s = smooth(3 * D2R, 14 * D2R, ang);
    for (const fn of this._shelters) { try { s = Math.max(s, clamp(+fn(x, z) || 0, 0, 1)); } catch { /* a provider's bug is not the weather's */ } }
    return s;
  },

  /** Rebuild game.env from the clock. Pure: writes nothing to the save. */
  refresh(game) {
    const st = game.state, S = this.S, env = this.env, clock = st.clock;
    if (!S || !env) return;
    const T = absTime(clock), hour = clock.tod / HOUR, ls = clock.ls, tau = st.weather.tau;
    env.tau = tau;
    env.time.sol = clock.sol; env.time.hour = hour; env.time.abs_s = T;
    env.season.ls_deg = ls;
    env.season.name = ["northern spring", "northern summer", "northern autumn", "northern winter"][Math.floor((((ls % 360) + 360) % 360) / 90)];
    env.season.dust_season = dustSeason(ls) > 0.5;

    // storms
    let storm = null, stormAdd = 0, windAdd = 0, windFrom = 0;
    for (const e of this.stormsAt(T)) {
      if (T < e.t_warn || T >= e.t_end) continue;
      const a = stormTau(e, T), on = T >= e.t_onset;
      if (a > stormAdd) { stormAdd = a; windAdd = e.wind * Math.min(1, a / e.add); windFrom = e.from_deg; }
      // the storm reported: the one over us if any (the strongest), otherwise the next to arrive
      const better = !storm || (on && !storm._on) || (on === storm._on && (on ? a > storm._a : e.t_onset < storm._e.t_onset));
      if (better) storm = { _e: e, _on: on, _a: a };
    }
    const bg = backgroundTau(S.seed, T, ls);
    if (storm) {
      const e = storm._e, peakTau = bg + e.add;
      env.dust.storm = { id: e.id, kind: e.kind, phase: stormPhase(e, T), eta_s: Math.max(0, e.t_onset - T), ends_s: Math.max(0, e.t_end - T),
        peak_tau: peakTau, from_deg: e.from_deg, solar_loss: this.solarLoss(game, bg, peakTau), scripted: !!e.scripted };
    } else env.dust.storm = null;
    // a manual tau (the menu slider) counts as dust in the air for the picture
    const lifted = Math.max(stormAdd, S.manual ? Math.max(0, tau - bg) * 0.6 : 0);

    // wind
    baseWind(S.seed, clock.sol, hour, _w);
    const k = windAdd > 0 ? Math.min(1, windAdd / 6) : 0;
    const speed = _w.speed + windAdd, from = lerpAngle(_w.from, windFrom, k * 0.8), gust = _w.gust + windAdd * 1.7;
    const W = env.wind, th = from * D2R;
    W.speed_ms = speed; W.dir_deg = from; W.gust_ms = gust;
    W.now_ms = speed + (gust - speed) * this._gust;
    W.vec[0] = -Math.sin(th) * speed; W.vec[1] = Math.cos(th) * speed;            // where the air is going: X east, Z south

    // temperature, pressure
    temperatures(hour, ls, tau, env.temp);
    let P = pressure(hour, ls, tau);
    // sun
    const sky = game.sky, sinEl = sky ? sky.sun.sinEl : 0;
    const I = sky ? surfaceIrradiance(sinEl, tau) : { total: 0 };
    env.sun.elevation_deg = sky ? sky.sun.elevation : 0;
    env.sun.irradiance_Wm2 = MARS.solarConstant * I.total;
    env.sun.uv_index = 0.03 * env.sun.irradiance_Wm2 * Math.exp(-0.25 * Math.max(0, tau - 0.5));     // a game scale
    // visibility: Koschmieder (2% contrast) through the dust near the ground
    const ext = tau / DUST_SCALE_HEIGHT * liftBoost(lifted);
    env.hazeK = ext;
    env.visibility_m = Math.max(40, 3.912 / ext);
    // dust
    env.dust.lifting = gust >= 16 || lifted > 0.8;
    env.dust.panel_deposition_per_sol = CLIMATE.deposition.perSolAtTauHalf * Math.pow(tau / 0.5, CLIMATE.deposition.exponent);
    env.dust.deposition_per_sol = env.dust.panel_deposition_per_sol;       // the same number under the name the base builder reads
    env.dust.devils.length = 0;
    const vp = game.vehicle ? game.vehicle.p : null;
    for (const d of S.devils) {
      env.dust.devils.push({ id: d.id, x: d.x, z: d.z, radius_m: d.r, height_m: d.h });
      if (vp) { const dist = Math.hypot(d.x - vp.x, d.z - vp.z); if (dist < d.r * 3) P -= 3.5 * (1 - dist / (d.r * 3)); }      // the vortex's pressure dip
    }
    env.pressure_Pa = P;
    // radiation
    let spe = null, speAdd = 0;
    const n = clock.sol;
    for (let m = n - 2; m <= n + 1; m++) { const e = this.director.particle(m); if (e && T >= e.t_warn && T < e.t_end) { spe = e; speAdd = Math.max(speAdd, speRate(e, T)); } }
    for (const e of S.scriptedSpe) if (T >= e.t_warn && T < e.t_end) { spe = e; speAdd = Math.max(speAdd, speRate(e, T)); }
    env.radiation.dose_mSv_per_sol = CLIMATE.radiation.gcr_mSv_per_sol * (1 + 0.08 * (700 - P) / 60) + speAdd;      // a thinner column shields a little less
    env.radiation.spe = spe ? { id: spe.id, phase: spePhase(spe, T), eta_s: Math.max(0, spe.t_onset - T), ends_s: spe.t_end - T, peak_mSv_per_sol: spe.peak } : null;

    // forecast: once a Mars-hour, or when something is scripted
    const key = clock.sol + ":" + Math.floor(hour) + ":" + S.scripted.length + ":" + S.seed;
    if (key !== this._fcKey) { this._fcKey = key; this._forecast(game, T, n); }
  },

  /** Fraction of today's noon solar input a given dust load takes away. */
  solarLoss(game, tauNow, tauThen) {
    const lat = game.sky ? game.sky.lat : 18.4, s = sunPosition(lat, SOL / 2, game.state.clock.ls).sinEl;
    const a = surfaceIrradiance(s, tauNow).total, b = surfaceIrradiance(s, tauThen).total;
    return a > 0 ? clamp(1 - b / a, 0, 1) : 0;
  },

  /**
   * The forecast for the rest of today and the next three sols. It is issued from the director's own schedule
   * (so nothing arrives unforecast) and blurred with lead time: chance falls and the tau range widens further out,
   * and a quiet sol carries a small false-alarm chance.
   */
  _forecast(game, T, n) {
    const S = this.S, env = this.env, ls = game.state.clock.ls;
    const all = this.stormsAt(T + 3 * SOL, 1);
    const one = (m, lead, from) => {
      const t0 = Math.max(from, (m - 1) * SOL), t1 = m * SOL;
      let lo = 99, hi = 0, worst = null;
      for (let i = 0; i <= 8; i++) {
        const t = t0 + (t1 - t0) * i / 8, b = backgroundTau(S.seed, t, ls + (m - n) * MARS.lsPerSol);
        let add = 0;
        for (const e of all) { const a = stormTau(e, t); if (a > add) add = a; if (a > 0.3 * e.add && t >= e.t_onset && (!worst || e.add > worst.add)) worst = e; }
        lo = Math.min(lo, b + add); hi = Math.max(hi, b + add);
      }
      // a storm whose front arrives within this sol counts even if no sample caught it
      for (const e of all) if (e.t_onset >= t0 && e.t_onset < t1) { if (!worst || e.add > worst.add) worst = e; hi = Math.max(hi, backgroundTau(S.seed, e.t_onset, ls) + e.add * Math.min(1, (t1 - e.t_onset) / Math.max(1, e.ramp))); }
      const wob = hash(S.seed, m, 60 + lead) - 0.5;
      const blur = 1 + 0.12 * lead * wob * 2;
      let chance;
      if (worst) chance = (worst.kind === "local" ? 0.62 : 0.94) - (worst.kind === "local" ? 0.12 : 0.13) * lead + 0.08 * wob;
      else chance = 0.03 + 0.05 * lead * hash(S.seed, m, 70 + lead);
      const f = { sol: m, tau_min: Math.max(0.2, lo * (lead ? 1 - 0.06 * lead : 1)), tau_max: hi * blur, storm_chance: clamp(chance, 0.02, 0.97),
        kind: worst ? worst.kind : null, when: null, solar_loss: 0, text: "" };
      if (worst) {
        const begins = worst.t_onset >= t0 && worst.t_onset < t1;
        const h = worst.onsetHour;
        f.when = begins ? (h < 10 ? "early" : h < 15 ? "around midday" : "late") : (worst.t_clear < t1 ? "clearing" : "all sol");
        f.solar_loss = this.solarLoss(game, backgroundTau(S.seed, t0, ls), backgroundTau(S.seed, t0, ls) + worst.add);
        const pc = Math.round(f.solar_loss * 20) * 5;
        const name = worst.kind === "local" ? "Local dust storm" : worst.kind === "regional" ? "Regional storm" : "Global dust storm";
        const likely = f.storm_chance > 0.75 ? "likely" : f.storm_chance > 0.45 ? "possible" : "a chance";
        f.text = begins ? `${name} ${likely} ${f.when} Sol ${m}: solar input will fall by about ${pc}%`
          : f.when === "clearing" ? `${name} clearing during Sol ${m}`
          : `${name} continues through Sol ${m}: solar input down about ${pc}%`;
      } else f.text = `Sol ${m}: no storm expected, dust optical depth ${f.tau_min.toFixed(1)} to ${f.tau_max.toFixed(1)}`;
      return f;
    };
    env.today = one(n, 0, T);
    env.forecast.length = 0;
    for (let i = 1; i <= 3; i++) env.forecast.push(one(n + i, i, 0));
    const first = [env.today, ...env.forecast].find((f) => f.kind);
    env.outlook = first ? first.text + "." : "No storm in the three-sol forecast. Dust devils likely around midday.";
  },

  /* ── dust devils: spawned from the seed in slots of simulated time, moved in real seconds ── */

  _devils(game, dt, T) {
    const S = this.S, D = CLIMATE.devils, env = this.env, v = game.vehicle;
    const fx = game.focus ? game.focus.x : v.p.x, fz = game.focus ? game.focus.z : v.p.z;
    const slot = Math.floor(T / D.slotSeconds);
    if (slot < S.devilSlot || slot - S.devilSlot > 3) S.devilSlot = slot - 1;         // the clock was moved: do not replay the gap
    const max = this.fx ? this.fx.maxDevils : 6;
    let made = 0;
    while (S.devilSlot < slot && made < 1) {
      const k = ++S.devilSlot, hour = ((k * D.slotSeconds) % SOL) / HOUR, sol = Math.floor(k * D.slotSeconds / SOL) + 1;
      const act = hour > 9.5 && hour < 16.5 ? Math.exp(-(((hour - D.peakHour) / D.widthHours) ** 2)) : 0;
      const quiet = env.dust.storm && env.dust.storm.phase !== "approaching" ? 0.15 : 1;       // a dusty sky kills the convection
      const p = D.chanceAtPeak * act * (0.6 + 0.8 * hash(S.seed, sol, 31)) * quiet;
      if (S.devils.length >= max || hash(S.seed, k, 32) >= p) continue;
      const a = 2 * Math.PI * hash(S.seed, k, 33), d = 220 + 900 * hash(S.seed, k, 34), q = hash(S.seed, k, 35);
      S.devils.push({ id: "d" + k, x: fx + Math.sin(a) * d, z: fz - Math.cos(a) * d, r: 2 + 10 * q * q, h: 40 + 260 * hash(S.seed, k, 36),
        age: 0, life: 60 + 150 * hash(S.seed, k, 37), spin: hash(S.seed, k, 38) < 0.5 ? -1 : 1, ph: 6.28 * hash(S.seed, k, 39), cleaned: false });
      made++;
    }
    const wx = env.wind.vec[0], wz = env.wind.vec[1];
    for (let i = S.devils.length - 1; i >= 0; i--) {
      const d = S.devils[i];
      d.age += dt;
      if (!d.still) {
        const wa = d.ph + d.age * 0.11;                                         // they wander as they drift downwind
        d.x += (wx * 0.7 + Math.cos(wa) * 1.6) * dt; d.z += (wz * 0.7 + Math.sin(wa * 1.3) * 1.6) * dt;
      }
      const dist = Math.hypot(d.x - v.p.x, d.z - v.p.z);
      if (!d.cleaned && d.age > 3 && dist < d.r + 2.6) {
        // Driving through one (or being run over by one) blows dust off the array: Spirit, sol 420.
        d.cleaned = true; S.cleaned = (S.cleaned || 0) + 1;
        const before = game.state.weather.panelDust || 0, after = before * (1 - D.cleanFraction);
        game.state.weather.panelDust = after;
        const hz = getSystem("hazards");
        if (hz && hz.onDevil) hz.onDevil(game, d, before, after);
        else if (before - after > 0.005) game.hud.toast(`Dust devil: array cleaned<small>${Math.round((before - after) * 100)}% of output recovered</small>`, 4);
        if (this.fx) this.fx.jolt(0.6);
      }
      if (d.age > d.life || Math.hypot(d.x - fx, d.z - fz) > 2400) S.devils.splice(i, 1);
    }
  },
};

registerSystem(weather);
