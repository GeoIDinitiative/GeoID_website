/**
 * myGeoID's total-risk coefficient: every hazard model that can answer for a
 * place, put on ONE scale, weighted, combined, and broken down so the reader
 * can see which model is doing the work.
 *
 * THE SCALE IS DEMAND OVER CAPACITY. A slope's factor of safety already is one
 * (resisting over driving, < 1 fails), so every other model is expressed the
 * same way round, as a ratio h that reaches 1 at the point a reader should act:
 *
 *   slope          h = 1 / FoS                     (the slope model's own)
 *   weather        h = forecast value / warning level   (the hazard sheets' own bands)
 *   cyclone        h = wind expected here / 64 kt  (hurricane force at the place)
 *   aftershocks    h = P(damaging aftershock in the horizon) / 10%
 *   eruption, fire h = reach / distance            (a proximity screen)
 *   background     h = P(event in the horizon) / 10%   (a risk map's p_yr)
 *
 * and the total is the LINEAR INTERACTION rule structural codes use for
 * combined actions (Σ demand_i / capacity_i ≤ 1):
 *
 *   H = Σ w_i h_i ,   FoS_total = 1 / H
 *
 * Linear is the conservative choice — it assumes the actions add, which a
 * storm and a saturated slope genuinely do — and it is what makes the
 * breakdown exact: each model's share of the total is w_i h_i / H, no
 * interaction terms hiding anywhere.
 *
 * IMMINENT OUTRANKS BACKGROUND BY CONSTRUCTION. A risk map's annual chance is
 * turned into the chance inside the horizon, so a city on a 1-in-475-year
 * fault reads h ≈ 0.0004 over a week while a cyclone 36 h out reads h ≈ 1:
 * the score moves when something is coming, which is what it is for. A
 * forecast term further out than a day is discounted for its lead time
 * (`imminence`), because a forecast five days out is a forecast of a
 * different storm from the one that arrives.
 *
 * Pure: no window, no fetch. `total-risk-panel.js` gathers the inputs.
 */

/** A probability inside the horizon read as unit demand. */
export const P_REF = 0.10;

export const HOURS_PER_YEAR = 8766;

/**
 * The warning levels, the hazard sheets' own (`flow-layer.js` HAZARD_VARS):
 * where each hazard's band says "act", h = 1. The test reads them back out of
 * that file so the two cannot drift.
 */
export const WEATHER_LEVELS = {
  rain: { label: "Rain in 24 h", unit: "mm", level: 50, note: "heavy — flooding possible" },
  gust: { label: "Strongest gust", unit: "m/s", level: 24.5, note: "storm — structural damage" },
  heat: { label: "Hottest it will feel", unit: "°C", floor: 27, level: 39, note: "danger — heat exhaustion likely" },
  cold: { label: "Coldest it will feel", unit: "°C", floor: 0, level: -25, note: "frostbite in 30 minutes" },
  snow: { label: "Snow in 24 h", unit: "cm", level: 10, note: "significant" },
  cape: { label: "Instability (CAPE)", unit: "J/kg", level: 2500, note: "thunderstorms likely if triggered" },
};

/** Default weights: 1 for a demand, less for a precursor (CAPE is not damage). */
export const DEFAULT_WEIGHTS = {
  slope: 1, flood: 1, cyclone: 1, rain: 1, gust: 1, heat: 1, cold: 1, snow: 1, cape: 0.5,
  aftershock: 1, eruption: 1, wildfire: 1, background: 1,
};

/** The chance of at least one event inside `hours`, from an annual chance. */
export function horizonProbability(pYear, hours) {
  if (!(pYear > 0)) return 0;
  const p = Math.min(pYear, 1 - 1e-12);
  const rate = -Math.log(1 - p);           // events a year
  return 1 - Math.exp(-rate * hours / HOURS_PER_YEAR);
}

/**
 * How much a forecast term counts, from its lead time. Full inside a day;
 * beyond it the weight falls by e every 48 h; nothing past the horizon.
 */
export function imminence(leadHours, horizonHours) {
  if (!Number.isFinite(leadHours)) return 1;
  if (leadHours > horizonHours) return 0;
  if (leadHours <= 24) return 1;
  return Math.exp(-(leadHours - 24) / 48);
}

/**
 * Sustained wind at `km` from a tropical cyclone's centre, from its peak
 * wind: flat inside the radius of maximum wind, and outside it the outer
 * profile v ∝ r^-0.5 of a Rankine-type vortex (Holland's outer profile at
 * B ≈ 1). R_max defaults to 40 km, the climatological median.
 */
export function windAt(km, vmaxKt, rmaxKm = 40) {
  if (!Number.isFinite(vmaxKt) || vmaxKt <= 0) return 0;
  if (!(km > rmaxKm)) return vmaxKt;
  return vmaxKt * Math.sqrt(rmaxKm / km);
}

/**
 * The shaking a magnitude reaches: log10(R km) = 0.5 M − 1.7 for about
 * MMI VI (the seismic risk bake's own reach law). Inverted: the smallest
 * magnitude whose damaging reach gets to `km`.
 */
export function magnitudeReaching(km) {
  return 2 * (Math.log10(Math.max(km, 1)) + 1.7);
}

/**
 * Reasenberg & Jones (1989), generic California parameters: the expected
 * number of aftershocks of magnitude ≥ M between t1 and t2 days after a
 * mainshock Mm, and the chance of at least one.
 */
export const RJ_GENERIC = { a: -1.67, b: 0.91, p: 1.08, c: 0.05 };
export function aftershockProbability(mainM, fromDays, toDays, minM, params = RJ_GENERIC) {
  const { a, b, p, c } = params;
  if (!(toDays > fromDays)) return 0;
  const k = 10 ** (a + b * (mainM - minM));
  const t1 = Math.max(0, fromDays) + c;
  const t2 = toDays + c;
  const integral = Math.abs(p - 1) < 1e-9
    ? Math.log(t2 / t1)
    : (t1 ** (1 - p) - t2 ** (1 - p)) / (p - 1);
  return 1 - Math.exp(-k * integral);
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(s)));
}

const lead = (atMs, nowMs) => (Number.isFinite(atMs) ? Math.max(0, (atMs - nowMs) / 3_600_000) : null);

/* ── The terms. Each answers { key, model, h, lead, value, source, note } or null. ── */

/** A slope (or any) factor of safety, h = 1 / FoS. */
export function fosTerm(key, model, fos, { atMs = null, nowMs = Date.now(), horizonHours = 72, source = "", what = "" } = {}) {
  if (!(fos > 0) || !Number.isFinite(fos)) return null;
  const L = lead(atMs, nowMs);
  const w = imminence(L, horizonHours);
  return {
    key, model, h: (1 / fos) * w, raw: 1 / fos, lead: L, value: fos, unit: "FoS",
    source, note: `${what || "factor of safety"} ${fos.toFixed(2)}${L != null ? ` in ${Math.round(L)} h` : ""}${w < 1 ? ` (×${w.toFixed(2)} for lead time)` : ""}`,
  };
}

/**
 * The weather terms from one place's hourly forecast: the worst 24 h of rain
 * and snow, the strongest gust, the hottest and coldest it will feel and the
 * peak CAPE, each against its warning level and discounted for its lead.
 *
 *   series  { time: [iso...], precipitation, wind_gusts_10m, apparent_temperature, snowfall, cape }
 */
export function weatherTerms(series, { nowMs = Date.now(), horizonHours = 72, source = "GFS (Open-Meteo)" } = {}) {
  const times = (series?.time || []).map((t) => Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`));
  const inWindow = times.map((ms) => Number.isFinite(ms) && ms >= nowMs - 3_600_000 && ms <= nowMs + horizonHours * 3_600_000);
  const vals = (k) => (series?.[k] || []).map((v) => (v == null ? NaN : Number(v)));
  const out = [];
  const peak = (arr, sign = 1) => {
    let best = -Infinity; let at = -1;
    arr.forEach((v, i) => { if (inWindow[i] && Number.isFinite(v) && sign * v > best) { best = sign * v; at = i; } });
    return at < 0 ? null : { value: sign * best, atMs: times[at] };
  };
  const sum24 = (arr) => {
    let best = -Infinity; let at = -1;
    for (let i = 0; i < arr.length; i += 1) {
      if (!inWindow[i]) continue;
      let s = 0; let n = 0; let first = -1;
      for (let j = i; j < arr.length && times[j] < times[i] + 24 * 3_600_000; j += 1) {
        if (Number.isFinite(arr[j])) { s += arr[j]; n += 1; if (first < 0 && arr[j] > 0) first = j; }
      }
      // The lead is when the worst day's rain STARTS, not the window's edge.
      if (n && s > best) { best = s; at = first >= 0 ? first : i; }
    }
    return at < 0 ? null : { value: best, atMs: times[at] };
  };
  const term = (key, got, h) => {
    if (!got) return;
    const lv = WEATHER_LEVELS[key];
    const L = lead(got.atMs, nowMs);
    const w = imminence(L, horizonHours);
    out.push({
      key, model: lv.label, h: h * w, raw: h, lead: L, value: got.value, unit: lv.unit, source,
      note: `${got.value.toFixed(lv.unit === "J/kg" ? 0 : 1)} ${lv.unit} against ${lv.level} ${lv.unit} (${lv.note})`
        + `${L != null ? `, in ${Math.round(L)} h` : ""}${w < 1 ? ` (×${w.toFixed(2)} for lead time)` : ""}`,
    });
  };
  const rain = sum24(vals("precipitation"));
  if (rain) term("rain", rain, rain.value / WEATHER_LEVELS.rain.level);
  const gust = peak(vals("wind_gusts_10m"));
  if (gust) term("gust", gust, gust.value / WEATHER_LEVELS.gust.level);
  const hot = peak(vals("apparent_temperature"));
  if (hot) term("heat", hot, Math.max(0, (hot.value - 27) / (39 - 27)));
  const cold = peak(vals("apparent_temperature"), -1);
  if (cold) term("cold", cold, Math.max(0, -cold.value / 25));
  const snow = sum24(vals("snowfall"));
  if (snow) term("snow", snow, snow.value / WEATHER_LEVELS.snow.level);
  const cape = peak(vals("cape"));
  if (cape) term("cape", cape, cape.value / WEATHER_LEVELS.cape.level);
  return out;
}

/**
 * An approaching tropical cyclone, from `cyclone-cone.js`'s threatTo answer
 * ({ storm, km, time, lead, wind, inCone }). A place inside the cone is read
 * at the centre passing over it — the cone is where the centre may go — and
 * outside it at the forecast distance.
 */
export function cycloneTerm(threat, { horizonHours = 72, nowMs = Date.now() } = {}) {
  if (!threat || !Number.isFinite(threat.km)) return null;
  const vmax = Number.isFinite(threat.wind) ? threat.wind : 64;
  const dEff = threat.inCone ? 0 : threat.km;
  const here = windAt(dEff, vmax);
  const L = Number.isFinite(threat.lead) ? threat.lead : lead(threat.time, nowMs);
  const w = imminence(L, horizonHours);
  if (!(w > 0)) return null;
  const raw = here / 64;
  return {
    key: "cyclone", model: `Tropical cyclone ${threat.storm || ""}`.trim(), h: raw * w, raw, lead: L,
    value: here, unit: "kt", source: "GDACS forecast track",
    note: `${threat.inCone ? "inside the cone — the centre may pass over" : `centre ${Math.round(threat.km)} km away`}`
      + `; ${Math.round(here)} kt here against 64 kt (hurricane force), peak ${Math.round(vmax)} kt`
      + `${L != null ? `, in ${Math.round(L)} h` : ""}${w < 1 ? ` (×${w.toFixed(2)} for lead time)` : ""}`,
  };
}

/**
 * Aftershocks of a recent large earthquake nearby: the chance that one big
 * enough to shake THIS place damagingly comes inside the horizon.
 */
export function aftershockTerm(quake, lat, lon, { horizonHours = 72, nowMs = Date.now() } = {}) {
  if (!quake || !Number.isFinite(quake.magnitude) || !Number.isFinite(quake.timeMs)) return null;
  const km = distanceKm(lat, lon, quake.lat, quake.lon);
  const needM = magnitudeReaching(km);
  if (needM > quake.magnitude + 0.5) return null; // nothing that size follows
  const since = Math.max(0, (nowMs - quake.timeMs) / 86_400_000);
  const P = aftershockProbability(quake.magnitude, since, since + horizonHours / 24, Math.max(needM, quake.magnitude - 2.5));
  if (!(P > 0)) return null;
  const raw = P / P_REF;
  return {
    key: "aftershock", model: `Aftershocks of ${quake.title || `M ${quake.magnitude.toFixed(1)}`}`, h: raw, raw, lead: 0,
    value: P, unit: "P", source: "USGS + Reasenberg & Jones (1989)",
    note: `${(P * 100).toFixed(1)}% chance of an M ≥ ${Math.max(needM, quake.magnitude - 2.5).toFixed(1)} aftershock in the next ${Math.round(horizonHours)} h; the mainshock is ${Math.round(km)} km away, ${since.toFixed(1)} days ago`,
  };
}

/** A proximity screen: an open eruption or a fire within reach of the place. */
export function proximityTerm(key, event, lat, lon, reachKm) {
  if (!event || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return null;
  const km = distanceKm(lat, lon, event.lat, event.lon);
  const raw = Math.min(3, reachKm / Math.max(km, 0.5));
  if (raw < 0.01) return null;
  return {
    key, model: event.title || (key === "eruption" ? "Volcanic activity" : "Wildfire"), h: raw, raw, lead: 0,
    value: km, unit: "km", source: "NASA EONET",
    note: `${Math.round(km)} km away against a ${reachKm} km reach (a proximity screen, not a dispersal model)`,
  };
}

/** A risk map's annual chance at the place, over the horizon. */
export function backgroundTerm(model, pYear, { horizonHours = 72, source = "" } = {}) {
  if (!(pYear > 0)) return null;
  const P = horizonProbability(pYear, horizonHours);
  const raw = P / P_REF;
  return {
    key: "background", model, h: raw, raw, lead: null, value: pYear, unit: "p/yr", source,
    note: `1 in ${Math.round(1 / pYear).toLocaleString()} years, so ${(P * 100).toPrecision(2)}% in the next ${Math.round(horizonHours)} h`,
  };
}

/**
 * The combination. `weights` by term key (DEFAULT_WEIGHTS for anything not
 * named). Answers the total coefficient, the class, every term with its weight
 * and share, and the term doing the most work.
 */
export function combine(terms, weights = {}) {
  const list = (terms || []).filter((t) => t && Number.isFinite(t.h) && t.h >= 0).map((t) => {
    const w = Number.isFinite(weights[t.key]) ? weights[t.key] : (DEFAULT_WEIGHTS[t.key] ?? 1);
    return { ...t, weight: w, contribution: w * t.h };
  });
  const H = list.reduce((s, t) => s + t.contribution, 0);
  list.forEach((t) => { t.share = H > 0 ? t.contribution / H : 0; });
  list.sort((a, b) => b.contribution - a.contribution);
  const fos = H > 0 ? 1 / H : Infinity;
  return { fos, demand: H, class: riskClass(fos), terms: list, main: list[0] && list[0].contribution > 0 ? list[0] : null };
}

/** The coefficient's words: < 1 act, 1–1.5 watch, 1.5–3 be aware, past 3 low. */
export function riskClass(fos) {
  if (!(fos < Infinity)) return { id: "none", label: "No hazard reaching here", colour: "#5fd38d" };
  if (fos < 1) return { id: "act", label: "Act — the combined demand exceeds capacity", colour: "#e5322d" };
  if (fos < 1.5) return { id: "watch", label: "Watch — little margin left", colour: "#f08a24" };
  if (fos < 3) return { id: "aware", label: "Be aware", colour: "#f2c12e" };
  return { id: "low", label: "Low", colour: "#5fd38d" };
}

/** One sentence naming the main danger. */
export function mainDangerSentence(result) {
  const m = result?.main;
  if (!m) return "No model reports a hazard reaching this place in the horizon.";
  const when = m.lead == null ? "" : m.lead < 1 ? " — now" : ` — in about ${Math.round(m.lead)} h`;
  return `Main danger: ${m.model}${when} (${Math.round(m.share * 100)}% of the total). ${m.note}.`;
}
