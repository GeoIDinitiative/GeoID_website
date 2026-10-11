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
  fire: { label: "Fire weather", unit: "× Red Flag", level: 1, note: "RH ≤ 15% with wind ≥ 11.2 m/s, the US NWS thresholds; the fuel is not known" },
};

/** Default weights: 1 for a demand, less for a precursor (CAPE is not damage). */
export const DEFAULT_WEIGHTS = {
  slope: 1, flood: 1, cyclone: 1, rain: 1, gust: 1, heat: 1, cold: 1, snow: 1, cape: 0.5,
  aftershock: 1, eruption: 1, wildfire: 1, background: 1, fire: 1,
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
    key, model, h: (1 / fos) * w, raw: 1 / fos, lead: L, atMs: Number.isFinite(atMs) ? atMs : null, value: fos, unit: "FoS",
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
  // Hourly raw demand per model, for the time-resolved total: a 24 h total
  // is the CENTRED sum, whose largest value is the same as the worst
  // forward window's, so the series and the peak agree.
  const centred24 = (arr) => times.map((t, i) => {
    if (!Number.isFinite(t)) return NaN;
    let sum = 0; let n = 0;
    for (let j = 0; j < arr.length; j += 1) {
      if (times[j] >= t - 12 * 3_600_000 && times[j] < t + 12 * 3_600_000 && Number.isFinite(arr[j])) { sum += arr[j]; n += 1; }
    }
    return n ? sum : NaN;
  });
  const seriesOf = (raw) => ({ tMs: times, h: raw });
  const term = (key, got, h, series = null) => {
    if (!got) return;
    const lv = WEATHER_LEVELS[key];
    const L = lead(got.atMs, nowMs);
    const w = imminence(L, horizonHours);
    out.push({
      key, model: lv.label, h: h * w, raw: h, lead: L, atMs: got.atMs, value: got.value, unit: lv.unit, source,
      series: series ? seriesOf(series) : null,
      note: (key === "fire" ? `${got.value.toFixed(2)}× the Red Flag criteria (${lv.note})`
        : `${got.value.toFixed(lv.unit === "J/kg" ? 0 : 1)} ${lv.unit} against ${lv.level} ${lv.unit} (${lv.note})`)
        + `${L != null ? `, in ${Math.round(L)} h` : ""}${w < 1 ? ` (×${w.toFixed(2)} for lead time)` : ""}`,
    });
  };
  const P = vals("precipitation");
  const rain = sum24(P);
  if (rain) term("rain", rain, rain.value / WEATHER_LEVELS.rain.level, centred24(P).map((v) => v / WEATHER_LEVELS.rain.level));
  const G = vals("wind_gusts_10m");
  const gust = peak(G);
  if (gust) term("gust", gust, gust.value / WEATHER_LEVELS.gust.level, G.map((v) => v / WEATHER_LEVELS.gust.level));
  const AT = vals("apparent_temperature");
  const heatH = (v) => Math.max(0, (v - 27) / (39 - 27));
  const coldH = (v) => Math.max(0, -v / 25);
  const hot = peak(AT);
  if (hot) term("heat", hot, heatH(hot.value), AT.map((v) => (Number.isFinite(v) ? heatH(v) : NaN)));
  const cold = peak(AT, -1);
  if (cold) term("cold", cold, coldH(cold.value), AT.map((v) => (Number.isFinite(v) ? coldH(v) : NaN)));
  const S = vals("snowfall");
  const snow = sum24(S);
  if (snow) term("snow", snow, snow.value / WEATHER_LEVELS.snow.level, centred24(S).map((v) => v / WEATHER_LEVELS.snow.level));
  const C = vals("cape");
  const cape = peak(C);
  if (cape) term("cape", cape, cape.value / WEATHER_LEVELS.cape.level, C.map((v) => v / WEATHER_LEVELS.cape.level));
  const fire = fireWeatherSeries(vals("relative_humidity_2m"), vals("wind_speed_10m"), P);
  if (fire.some(Number.isFinite)) {
    const got = peak(fire);
    if (got && got.value > 0) term("fire", got, got.value, fire);
  }
  return out;
}

/**
 * FIRE WEATHER, from the US National Weather Service's Red Flag criteria —
 * relative humidity at or below 15% with sustained wind of 25 mph (11.2 m/s)
 * or more — as a demand that reaches 1 exactly where both are met:
 *
 *   h = min(2, 15 / RH) × min(2, wind / 11.2)   (0 in any hour with rain)
 *
 * It is the WEATHER half of fire danger only: it knows nothing of the fuel,
 * which is why a reading here is a reason to look, not a fire.
 */
export function fireWeatherSeries(rh, wind, precip = []) {
  return (rh || []).map((r, i) => {
    const w = wind?.[i];
    if (!Number.isFinite(r) || !Number.isFinite(w)) return NaN;
    if (Number.isFinite(precip[i]) && precip[i] >= 0.1) return 0;
    return Math.min(2, 15 / Math.max(r, 1)) * Math.min(2, w / 11.2);
  });
}

/**
 * An approaching tropical cyclone, from `cyclone-cone.js`'s threatTo answer
 * ({ storm, km, time, lead, wind, inCone }). A place inside the cone is read
 * at the centre passing over it — the cone is where the centre may go — and
 * outside it at the forecast distance.
 */
export function cycloneTerm(threat, { horizonHours = 72, nowMs = Date.now(), track = null, place = null } = {}) {
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
    value: here, unit: "kt", source: "GDACS forecast track", atMs: Number.isFinite(threat.time) ? threat.time : null,
    series: track && place ? cycloneSeries(track, threat, place.lat, place.lon) : null,
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
 * The wind a cyclone brings to a place HOUR BY HOUR along its forecast track,
 * as demand against hurricane force. Inside the cone the centre may pass
 * over, so the closest point is read at the centre; every other point at its
 * own distance.
 */
export function cycloneSeries(track, threat, lat, lon) {
  if (!Array.isArray(track) || !track.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tMs = []; const h = [];
  let closest = -1; let best = Infinity;
  track.forEach((p, i) => { const d = distanceKm(lat, lon, p.lat, p.lon); if (d < best) { best = d; closest = i; } });
  track.forEach((p, i) => {
    if (!Number.isFinite(p.time)) return;
    const d = threat?.inCone && i === closest ? 0 : distanceKm(lat, lon, p.lat, p.lon);
    tMs.push(p.time);
    h.push(windAt(d, Number.isFinite(p.wind) ? p.wind : (threat?.wind ?? 64)) / 64);
  });
  return tMs.length ? { tMs, h } : null;
}

/**
 * A river reach near the place, from the forecast pipeline's flood wave: the
 * channel's own factor of safety (Q_bankfull / Q) through the run.
 *   reach  { fos: [per frame], times: [ms per frame], widthM, km, name }
 */
export function floodTerm(reach, { horizonHours = 72, nowMs = Date.now() } = {}) {
  if (!reach || !Array.isArray(reach.fos) || !reach.fos.length) return null;
  const h = reach.fos.map((f) => (f > 0 && Number.isFinite(f) ? 1 / f : NaN));
  let k = -1;
  h.forEach((v, i) => { const t = reach.times[i]; if (Number.isFinite(v) && Number.isFinite(t) && t <= nowMs + horizonHours * 3_600_000 && (k < 0 || v > h[k])) k = i; });
  if (k < 0) return null;
  const L = lead(reach.times[k], nowMs);
  const w = imminence(L, horizonHours);
  const fos = 1 / h[k];
  return {
    key: "flood", model: `River flood${reach.widthM ? ` (${Math.round(reach.widthM)} m channel)` : ""}`,
    h: h[k] * w, raw: h[k], lead: L, atMs: reach.times[k], value: fos, unit: "FoS",
    source: "Landslide forecast — channel flood wave", series: { tMs: reach.times, h },
    note: `channel factor of safety ${fos.toFixed(2)}${fos < 1 ? " — over its brim" : ""}, ${reach.km > 0.05 ? `${reach.km.toFixed(1)} km from the place` : "at the place"}`
      + `${L != null ? `, in ${Math.round(L)} h` : ""}${w < 1 ? ` (×${w.toFixed(2)} for lead time)` : ""}`,
  };
}

/** A term's raw demand at time t (before the lead discount), or 0 where it does not reach. */
export function demandAt(term, tMs, { holdHours = 12 } = {}) {
  const s = term.series;
  if (s && s.tMs?.length) {
    // Nearest sample in time, held over half the gap to its neighbours —
    // beyond the series' own span the model has said nothing, which is 0.
    const T = s.tMs; const n = T.length;
    const gap = n > 1 ? Math.abs(T[n - 1] - T[0]) / (n - 1) : holdHours * 3_600_000;
    if (tMs < T[0] - gap / 2 || tMs > T[n - 1] + gap / 2) return 0;
    let best = 0; let bd = Infinity;
    for (let i = 0; i < n; i += 1) { const d = Math.abs(T[i] - tMs); if (d < bd && Number.isFinite(s.h[i])) { bd = d; best = i; } }
    return Number.isFinite(s.h[best]) ? s.h[best] : 0;
  }
  // An event with a time and no series stands at its peak for a while either
  // side of it; one with no time (a risk map, an open eruption, an aftershock
  // probability over the window) stands for the whole horizon.
  if (Number.isFinite(term.atMs)) return Math.abs(tMs - term.atMs) <= holdHours * 3_600_000 ? (term.raw ?? term.h) : 0;
  return term.raw ?? term.h;
}

/**
 * THE TOTAL IN TIME. Summing each model's own worst moment adds peaks that
 * may be days apart — rain on Tuesday and a gale on Thursday are not one
 * storm. So the demand is summed HOUR BY HOUR over the horizon, each model
 * discounted for that hour's lead, and the score is the worst hour:
 *
 *   H(t) = Σ wᵢ hᵢ(t) · imminence(t − now) ,   FoS = 1 / max_t H(t)
 *
 * Answers the combination at the worst hour (its terms' demand and share
 * AT that hour), when it is, the whole curve, and what adding the separate
 * peaks would have said, so the difference is visible rather than hidden.
 */
export function combineInTime(terms, weights = {}, { nowMs = Date.now(), horizonHours = 72, stepHours = 1 } = {}) {
  const list = (terms || []).filter((t) => t && Number.isFinite(t.h) && t.h >= 0);
  const wOf = (t) => (Number.isFinite(weights[t.key]) ? weights[t.key] : (DEFAULT_WEIGHTS[t.key] ?? 1));
  const steps = Math.max(1, Math.round(horizonHours / stepHours));
  const curve = [];
  let worst = -1; let worstH = -1;
  for (let k = 0; k <= steps; k += 1) {
    const t = nowMs + k * stepHours * 3_600_000;
    const im = imminence(k * stepHours, horizonHours);
    let H = 0;
    for (const term of list) H += wOf(term) * demandAt(term, t) * (term.series || Number.isFinite(term.atMs) ? im : 1);
    curve.push({ tMs: t, demand: H, fos: H > 0 ? 1 / H : Infinity });
    if (H > worstH) { worstH = H; worst = k; }
  }
  const at = curve[worst]?.tMs ?? nowMs;
  const imAt = imminence((at - nowMs) / 3_600_000, horizonHours);
  const atWorst = list.map((term) => {
    const timed = Boolean(term.series || Number.isFinite(term.atMs));
    const hNow = demandAt(term, at) * (timed ? imAt : 1);
    return { ...term, peakH: term.h, h: hNow };
  });
  const result = combine(atWorst, weights);
  const peaks = combine(list, weights);
  return { ...result, atMs: at, lead: (at - nowMs) / 3_600_000, curve, peaksFos: peaks.fos };
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
