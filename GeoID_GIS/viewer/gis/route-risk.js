/**
 * The hazard a flight flies through, as a path integral along its route — the
 * pure half, pinned in Node.
 *
 * WHAT IS INTEGRATED. myGeoID's factor of safety is capacity over demand at a
 * PLACE. A flight is not at a place; it sweeps a line through the hazard field
 * in space and time. So at every sample along the route each hazard is read as
 * a UTILISATION u = demand / capacity (1/FoS — 1 is "at the limit"), u is
 * turned into a risk density h(u) per kilometre, and the route's risk is
 *
 *     R = ∫ Σᵢ h(uᵢ(s)) ds          (trapezoid rule over the samples)
 *
 * in EQUIVALENT KILOMETRES AT THE LIMIT: a route that spends 40 km exactly at
 * one hazard's limit and nothing anywhere else scores 40. The cumulative curve
 * C(s) is the same integral stopped at s, the per-segment risks are its
 * increments over fixed lengths, and the worst segment is the one with the
 * largest increment, named by the hazard that put most into it.
 *
 *     h(u) = 0                      u ≤ ½   (half the limit: not yet a concern)
 *          = smoothstep((u − ½)/½)  ½ < u < 1
 *          = u                      u ≥ 1   (past the limit, in proportion)
 *
 * The hazards and their capacities (each a screening number, said wherever
 * the answer is shown):
 *
 *   cyclone     the storm's expected wind at the aircraft's position over
 *               64 kt (hurricane force), with the centre smeared by the
 *               forecast's own position error — the cone's 2-in-3 radius at
 *               that lead time — so a five-day-out storm is broad and faint
 *               and a storm now is narrow and sharp;
 *   turbulence  clear-air turbulence from GFS's jet-level layers: the
 *               Richardson number Ri = N²/S² of the layer the aircraft is in,
 *               capacity Ri = 0.25, the Kelvin–Helmholtz value. GFS's 50 hPa
 *               (≈ 1.3 km) layers smooth the shear, so the same air reads a
 *               higher Ri than it has at the eddies' scale: reaching 0.25 in
 *               the model is a strong signal, and the ramp from Ri = 0.5 is
 *               where the risk starts to count. (At Ri_c = 1, then 0.5, an
 *               ordinary jet put a third to a half of a long-haul route past
 *               the limit — measured on 2026-10-23, JFK–LHR and HKG–NRT.)
 *   convection  thunderstorm instability, CAPE over 1500 J/kg, and at least
 *               the limit wherever GFS forecasts a thunderstorm (WMO code
 *               95–99);
 *   ash         airborne ash from the last ash model, over 2 mg/m³ — the
 *               boundary of EASA/ICAO "medium" contamination.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_KM = 6371.0088;
const G = 9.80665;

export const CAPACITY = {
  cycloneKt: 64,
  richardson: 0.25,
  capeJkg: 1500,
  ashMgM3: 2,
};

export const HAZARDS = ["cyclone", "turbulence", "convection", "ash"];

export const HAZARD_LABELS = {
  cyclone: "Tropical cyclone",
  turbulence: "Clear-air turbulence (jet-level shear)",
  convection: "Thunderstorms (CAPE)",
  ash: "Volcanic ash",
};

const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ── the route ─────────────────────────────────────────────────────────── */

export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The great circle from a to b ({lat, lon}), a sample every `stepKm` or
 * closer, each {lat, lon, s} with s the distance flown in km. Interpolated on
 * the sphere (slerp), so a polar route bends the way the aircraft does.
 */
export function greatCircle(a, b, stepKm = 25) {
  const total = distanceKm(a.lat, a.lon, b.lat, b.lon);
  const n = Math.max(1, Math.ceil(total / stepKm));
  const toV = (p) => [
    Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD),
    Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD),
    Math.sin(p.lat * RAD),
  ];
  const va = toV(a);
  const vb = toV(b);
  const omega = total / EARTH_KM;
  const out = [];
  for (let k = 0; k <= n; k += 1) {
    const f = k / n;
    let v;
    if (omega < 1e-9) v = va;
    else {
      const wa = Math.sin((1 - f) * omega) / Math.sin(omega);
      const wb = Math.sin(f * omega) / Math.sin(omega);
      v = [wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]];
    }
    out.push({
      lat: Math.asin(clamp(v[2], -1, 1)) * DEG,
      lon: wrap(Math.atan2(v[1], v[0]) * DEG),
      s: total * f,
    });
  }
  return out;
}

/** Move `km` along an initial compass bearing on the sphere (a great circle). */
export function destination(lat, lon, bearingDeg, km) {
  const d = km / EARTH_KM;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lon: wrap(l2 * DEG) };
}

/**
 * A live aircraft with no known destination, carried along its current
 * track: the great circle it is on, for `km` ahead.
 */
export function deadReckonPath(lat, lon, headingDeg, km, stepKm = 25) {
  const n = Math.max(1, Math.ceil(km / stepKm));
  const out = [];
  for (let k = 0; k <= n; k += 1) {
    const s = (km * k) / n;
    out.push({ ...destination(lat, lon, headingDeg, s), s });
  }
  return out;
}

/**
 * Altitude and time at every sample: a climb to cruise over `climbKm`, a
 * cruise, and a descent over `descentKm`, flown at `cruiseKmh` in the cruise
 * and at `terminalKmh` on average in the climb and descent. A route too short
 * for both tops out lower, in proportion. `startAltM` starts the profile in
 * the air (a live aircraft): the climb then begins from that height.
 */
export function flightProfile(path, {
  departMs = Date.now(), cruiseAltM = 10700, cruiseKmh = 850, terminalKmh = 550,
  climbKm = 200, descentKm = 250, startAltM = 0, endAltM = 0,
} = {}) {
  const L = path.at(-1)?.s ?? 0;
  const startAlt = Math.max(0, startAltM || 0);
  const climbNeed = cruiseAltM > startAlt ? climbKm * (cruiseAltM - startAlt) / cruiseAltM : 0;
  const descNeed = descentKm * (cruiseAltM - endAltM) / cruiseAltM;
  const squeeze = climbNeed + descNeed > L && climbNeed + descNeed > 0 ? L / (climbNeed + descNeed) : 1;
  const c = climbNeed * squeeze;
  const d = descNeed * squeeze;
  const top = squeeze < 1 ? startAlt + (cruiseAltM - startAlt) * squeeze : cruiseAltM;
  const topDesc = squeeze < 1 ? endAltM + (cruiseAltM - endAltM) * squeeze : cruiseAltM;
  const peak = Math.min(top, topDesc);
  const altAt = (s) => {
    if (c > 0 && s < c) return startAlt + (peak - startAlt) * (s / c);
    if (d > 0 && s > L - d) return endAltM + (peak - endAltM) * ((L - s) / d);
    return peak;
  };
  const speedAt = (s) => ((s < c || s > L - d) ? terminalKmh : cruiseKmh);
  let t = departMs;
  return path.map((p, i) => {
    if (i > 0) {
      const ds = p.s - path[i - 1].s;
      const mid = (p.s + path[i - 1].s) / 2;
      t += (ds / speedAt(mid)) * 3600e3;
    }
    return { ...p, altM: altAt(p.s), timeMs: t };
  });
}

/* ── hazards as utilisations (demand / capacity) ──────────────────────── */

/** The 2-in-3 cone radius → the standard deviation of a 2D Gaussian position error. */
export const CONE_TO_SIGMA = 1 / Math.sqrt(2 * Math.log(3));

/**
 * A storm's 34-kt radius from its strength — a climatological size, used only
 * because GDACS's tracks rarely carry wind radii: 100 km at tropical-storm
 * strength growing 2 km per knot, held between 80 and 350 km.
 */
export function galeRadiusKm(windKt) {
  return clamp(100 + 2 * (Math.max(34, windKt || 34) - 34), 80, 350);
}

/** Where a storm's track puts its centre at `timeMs`, or null outside it. */
export function stormAt(track, timeMs, graceMs = 6 * 3600e3) {
  if (!track?.length) return null;
  const first = track[0];
  const last = track.at(-1);
  if (timeMs < first.time - graceMs || timeMs > last.time + graceMs) return null;
  if (timeMs <= first.time) return { ...first, lead: first.lead ?? 0 };
  if (timeMs >= last.time) return { ...last, lead: last.lead ?? 0 };
  for (let i = 1; i < track.length; i += 1) {
    const b = track[i];
    if (timeMs <= b.time) {
      const a = track[i - 1];
      const f = (timeMs - a.time) / Math.max(1, b.time - a.time);
      let lonB = b.lon;
      while (lonB - a.lon > 180) lonB -= 360;
      while (lonB - a.lon < -180) lonB += 360;
      const wa = Number.isFinite(a.wind) ? a.wind : b.wind;
      const wb = Number.isFinite(b.wind) ? b.wind : a.wind;
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: wrap(a.lon + (lonB - a.lon) * f),
        wind: Number.isFinite(wa) ? wa + (wb - wa) * f : NaN,
        lead: (a.lead ?? 0) + ((b.lead ?? 0) - (a.lead ?? 0)) * f,
        time: timeMs,
      };
    }
  }
  return null;
}

/**
 * The cyclone utilisation at a point and time: the storm's EXPECTED wind
 * there over 64 kt.
 *
 * The wind is a Gaussian in distance, V(d) = Vmax·exp(−d²/2a²), with a fixed
 * so V falls to 34 kt at the gale radius. The centre is uncertain by a 2D
 * Gaussian of σ from the cone at that lead time; the expectation of the one
 * over the other is again a Gaussian, wider and fainter:
 *
 *     E[V](d) = Vmax · a²/(a²+σ²) · exp(−d² / 2(a²+σ²))
 *
 * `coneRadiusKm` is the cone's 2-in-3 radius at a lead time, passed in so this
 * file does not depend on the layer's table.
 */
export function cycloneUtilisation(lat, lon, timeMs, storms, coneRadiusKm = () => 0) {
  let best = { u: 0, storm: null, km: Infinity };
  for (const storm of storms || []) {
    const at = stormAt(storm.track, timeMs);
    if (!at || !Number.isFinite(at.wind) || at.wind <= 0) continue;
    const R = galeRadiusKm(at.wind);
    const ratio = Math.max(1.2, at.wind / 34);
    const a2 = (R * R) / (2 * Math.log(ratio));
    const sigma = coneRadiusKm(Math.max(0, at.lead || 0)) * CONE_TO_SIGMA;
    const v2 = a2 + sigma * sigma;
    const d = distanceKm(lat, lon, at.lat, at.lon);
    const u = (at.wind / CAPACITY.cycloneKt) * (a2 / v2) * Math.exp(-(d * d) / (2 * v2));
    if (u > best.u) best = { u, storm: storm.name || null, km: d };
  }
  return best;
}

/** Potential temperature, K, from °C and hPa. */
export function theta(tempC, pHpa) {
  return (tempC + 273.15) * (1000 / pHpa) ** 0.2857;
}

/**
 * Clear-air turbulence utilisation from a column of pressure levels
 * [{p, z, t (°C), u, v (m/s)}], at an altitude: the bulk Richardson number of
 * each layer between neighbouring levels, read for the layer the aircraft is
 * in (or the nearest), u = Ri_c / Ri (Ri_c = CAPACITY.richardson). A statically unstable layer (N² ≤ 0)
 * is taken as twice the limit. Below the jet-level layers the reading fades
 * out over 3 km — the low-level shear this proxy is not about.
 */
export function turbulenceUtilisation(levels, altM) {
  const col = (levels || [])
    .filter((l) => [l.p, l.z, l.t, l.u, l.v].every(Number.isFinite))
    .sort((a, b) => a.z - b.z);
  if (col.length < 2 || !Number.isFinite(altM)) return { u: 0, ri: null };
  let pick = null;
  let pickD = Infinity;
  const layers = [];
  for (let i = 0; i < col.length - 1; i += 1) {
    const lo = col[i]; const hi = col[i + 1];
    const dz = hi.z - lo.z;
    if (dz <= 0) continue;
    const th1 = theta(lo.t, lo.p); const th2 = theta(hi.t, hi.p);
    const n2 = (G / ((th1 + th2) / 2)) * ((th2 - th1) / dz);
    const s2 = ((hi.u - lo.u) ** 2 + (hi.v - lo.v) ** 2) / (dz * dz);
    const ri = s2 > 0 ? n2 / s2 : Infinity;
    const u = n2 <= 0 ? 2 : (Number.isFinite(ri) ? CAPACITY.richardson / ri : 0);
    const layer = { bottom: lo.z, top: hi.z, ri, u, n2, shear: Math.sqrt(s2) };
    layers.push(layer);
    const dist = altM < lo.z ? lo.z - altM : altM > hi.z ? altM - hi.z : 0;
    if (dist < pickD) { pickD = dist; pick = layer; }
  }
  if (!pick) return { u: 0, ri: null };
  const below = col[0].z - altM;
  const fade = below > 0 ? clamp(1 - below / 3000, 0, 1) : (altM > col.at(-1).z + 3000 ? 0 : 1);
  return { u: pick.u * fade, ri: pick.ri, shear: pick.shear, layer: [pick.bottom, pick.top] };
}

/** Thunderstorm utilisation: CAPE over its capacity, at least 1 where a thunderstorm is forecast. */
export function convectionUtilisation(capeJkg, weatherCode) {
  const fromCape = Number.isFinite(capeJkg) ? Math.max(0, capeJkg) / CAPACITY.capeJkg : 0;
  const storm = Number.isFinite(weatherCode) && weatherCode >= 95 && weatherCode <= 99;
  return storm ? Math.max(1, fromCape) : fromCape;
}

export function ashUtilisation(mgM3) {
  return Number.isFinite(mgM3) && mgM3 > 0 ? mgM3 / CAPACITY.ashMgM3 : 0;
}

/** Risk density per km from a utilisation: see the header. */
export function riskDensity(u) {
  if (!Number.isFinite(u) || u <= 0.5) return 0;
  if (u >= 1) return u;
  const x = (u - 0.5) / 0.5;
  return x * x * (3 - 2 * x);
}

/* ── the integral ──────────────────────────────────────────────────────── */

/**
 * The path integral. `samples` are [{s, ...}] (s in km, increasing) and
 * `util` is one {cyclone, turbulence, convection, ash} of utilisations per
 * sample. Returns:
 *
 *   lengthKm, total (equivalent km at the limit), perHazard {name: km},
 *   density [per sample], cumulative [per sample], fos [per sample, 1/max u],
 *   segments [{fromKm, toKm, risk, byHazard, governing, minFos}], worst,
 *   minFos {value, s, hazard}, rating.
 */
export function integrateRoute(samples, util, { segmentKm = 100 } = {}) {
  const n = samples.length;
  const density = new Array(n).fill(0);
  const parts = HAZARDS.map(() => new Array(n).fill(0));
  const fos = new Array(n).fill(Infinity);
  const governing = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    let maxU = 0;
    HAZARDS.forEach((h, k) => {
      const u = Number(util[i]?.[h]) || 0;
      parts[k][i] = riskDensity(u);
      density[i] += parts[k][i];
      if (u > maxU) { maxU = u; governing[i] = h; }
    });
    fos[i] = maxU > 0 ? 1 / maxU : Infinity;
  }
  const cumulative = new Array(n).fill(0);
  const perHazard = Object.fromEntries(HAZARDS.map((h) => [h, 0]));
  const L = n ? samples[n - 1].s : 0;
  const nSeg = Math.max(1, Math.ceil(L / segmentKm - 1e-9));
  const segments = Array.from({ length: nSeg }, (_, j) => ({
    fromKm: j * segmentKm, toKm: Math.min(L, (j + 1) * segmentKm), risk: 0,
    byHazard: Object.fromEntries(HAZARDS.map((h) => [h, 0])), governing: null, minFos: Infinity,
  }));
  for (let i = 1; i < n; i += 1) {
    const ds = samples[i].s - samples[i - 1].s;
    const inc = ((density[i] + density[i - 1]) / 2) * ds;
    cumulative[i] = cumulative[i - 1] + inc;
    const mid = (samples[i].s + samples[i - 1].s) / 2;
    const seg = segments[Math.min(nSeg - 1, Math.floor(mid / segmentKm))];
    seg.risk += inc;
    HAZARDS.forEach((h, k) => {
      const part = ((parts[k][i] + parts[k][i - 1]) / 2) * ds;
      seg.byHazard[h] += part;
      perHazard[h] += part;
    });
    seg.minFos = Math.min(seg.minFos, fos[i], fos[i - 1]);
  }
  for (const seg of segments) {
    const top = HAZARDS.reduce((a, h) => (seg.byHazard[h] > (seg.byHazard[a] ?? -1) ? h : a), HAZARDS[0]);
    seg.governing = seg.byHazard[top] > 0 ? top : null;
  }
  const total = cumulative[n - 1] || 0;
  const worst = segments.reduce((a, b) => (b.risk > a.risk ? b : a), segments[0]);
  let minFos = { value: Infinity, s: null, hazard: null };
  fos.forEach((f, i) => { if (f < minFos.value) minFos = { value: f, s: samples[i].s, hazard: governing[i], index: i }; });
  return {
    lengthKm: L, total, perHazard, density, cumulative, fos, segments,
    worst: worst && worst.risk > 0 ? worst : null,
    minFos, rating: rateRoute(total, minFos.value),
  };
}

/**
 * A word for a route: by the integral — under 2, 20, 100 and 500 equivalent
 * km — and never milder than its worst point says (a route that touches
 * FoS < 1 anywhere is at least "moderate"). The bands are set so a route
 * across a strong jet reads "high" rather than "severe": HKG–NRT across the
 * subtropical jet on 2026-10-23 integrated to about 400.
 */
export function rateRoute(totalKm, minFos = Infinity) {
  const order = ["negligible", "low", "moderate", "high", "severe"];
  let k = totalKm < 2 ? 0 : totalKm < 20 ? 1 : totalKm < 100 ? 2 : totalKm < 500 ? 3 : 4;
  if (minFos < 1) k = Math.max(k, 2);
  else if (minFos < 1.5) k = Math.max(k, 1);
  return order[k];
}

/* ── GFS along the route (Open-Meteo, many points in one request) ─────── */

export const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
export const JET_LEVELS = [400, 300, 250, 200, 150];
const LEVEL_VARS = ["temperature", "wind_speed", "wind_direction", "geopotential_height"];

/**
 * Which samples to ask GFS about: one about every `everyKm`, the ends always,
 * at most `max` (Open-Meteo counts each location as a call).
 */
export function weatherSampleIndices(samples, everyKm = 300, max = 40) {
  if (!samples.length) return [];
  const L = samples.at(-1).s;
  const want = Math.min(max, Math.max(2, Math.ceil(L / everyKm) + 1));
  const out = new Set();
  for (let k = 0; k < want; k += 1) {
    const target = (L * k) / (want - 1 || 1);
    let best = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if (Math.abs(samples[i].s - target) < Math.abs(samples[best].s - target)) best = i;
    }
    out.add(best);
  }
  return [...out].sort((a, b) => a - b);
}

const hourText = (ms) => new Date(Math.floor(ms / 3600e3) * 3600e3).toISOString().slice(0, 16);

/** One GET for every point's hourly GFS from `fromMs` to `toMs`. */
export function routeWeatherUrl(points, fromMs, toMs) {
  const hourly = ["cape", "weather_code",
    ...JET_LEVELS.flatMap((p) => LEVEL_VARS.map((v) => `${v}_${p}hPa`))];
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    hourly: hourly.join(","),
    models: "gfs_seamless",
    wind_speed_unit: "ms",
    timezone: "GMT",
    start_hour: hourText(fromMs - 3600e3),
    end_hour: hourText(toMs + 2 * 3600e3),
  });
  return `${FORECAST_BASE}?${params}`;
}

/**
 * The answer (an array for several points, an object for one) read into
 * [{s, times: [ms], cape: [], code: [], levels: [[{p,z,t,u,v}] per hour]}],
 * one per point, `s` from the samples the points were taken at.
 */
export function readRouteWeather(answer, pointS) {
  const list = Array.isArray(answer) ? answer : [answer];
  return list.map((a, k) => {
    const h = a?.hourly || {};
    const times = (h.time || []).map((t) => Date.parse(/Z$/.test(t) ? t : `${t}Z`));
    const levels = times.map((_, i) => JET_LEVELS.map((p) => {
      const spd = h[`wind_speed_${p}hPa`]?.[i];
      const dir = h[`wind_direction_${p}hPa`]?.[i];
      // Meteorological direction is where the wind comes FROM.
      const u = -spd * Math.sin(dir * RAD);
      const v = -spd * Math.cos(dir * RAD);
      return { p, z: h[`geopotential_height_${p}hPa`]?.[i], t: h[`temperature_${p}hPa`]?.[i], u, v };
    }).filter((l) => [l.z, l.t, l.u, l.v].every(Number.isFinite)));
    return { s: pointS[k], times, cape: h.cape || [], code: h.weather_code || [], levels };
  });
}

/** The weather point nearest along the route and the hour nearest in time. */
export function weatherAt(weather, s, timeMs) {
  if (!weather?.length) return null;
  let w = weather[0];
  for (const x of weather) if (Math.abs(x.s - s) < Math.abs(w.s - s)) w = x;
  if (!w.times.length) return null;
  let i = 0;
  for (let k = 1; k < w.times.length; k += 1) {
    if (Math.abs(w.times[k] - timeMs) < Math.abs(w.times[i] - timeMs)) i = k;
  }
  return { cape: Number(w.cape[i]), code: Number(w.code[i]), levels: w.levels[i] || [], timeMs: w.times[i] };
}

/**
 * Every hazard's utilisation at every sample, then the integral.
 *
 *   samples   flightProfile() output: {lat, lon, s, altM, timeMs}
 *   weather   readRouteWeather() output, or null (no turbulence/convection)
 *   storms    [{name, track: [{lat, lon, time, wind, lead}]}] (GDACS), or []
 *   ashAt     (lat, lon, altM, timeMs) → mg/m³, or null
 *   coneRadiusKm  lead hours → km (cyclone-cone.js)
 */
export function assessRoute(samples, { weather = null, storms = [], ashAt = null, coneRadiusKm = () => 0, segmentKm = 100 } = {}) {
  const detail = [];
  const util = samples.map((p) => {
    const cyc = cycloneUtilisation(p.lat, p.lon, p.timeMs, storms, coneRadiusKm);
    const wx = weather ? weatherAt(weather, p.s, p.timeMs) : null;
    const turb = wx ? turbulenceUtilisation(wx.levels, p.altM) : { u: 0, ri: null };
    const conv = wx ? convectionUtilisation(wx.cape, wx.code) : 0;
    const ash = ashAt ? ashUtilisation(ashAt(p.lat, p.lon, p.altM, p.timeMs)) : 0;
    detail.push({ storm: cyc.storm, stormKm: cyc.km, ri: turb.ri, cape: wx?.cape ?? null, code: wx?.code ?? null });
    return { cyclone: cyc.u, turbulence: turb.u, convection: conv, ash };
  });
  const out = integrateRoute(samples, util, { segmentKm });
  return { ...out, util, detail, have: { weather: Boolean(weather), storms: (storms || []).length, ash: Boolean(ashAt) } };
}

/** A route's answer in a few sentences. */
export function describeRisk(result, { from = "the start", to = "the end", samples = [] } = {}) {
  const km = (x) => `${Math.round(x).toLocaleString("en-GB")} km`;
  const lines = [];
  lines.push(`Route risk **${result.rating}**: ${result.total.toFixed(1)} equivalent km at the limit `
    + `over ${km(result.lengthKm)} (${from} → ${to}).`);
  const named = HAZARDS.filter((h) => result.perHazard[h] > 0.05)
    .sort((a, b) => result.perHazard[b] - result.perHazard[a])
    .map((h) => `${HAZARD_LABELS[h].toLowerCase()} ${result.perHazard[h].toFixed(1)}`);
  if (named.length) lines.push(`From: ${named.join(", ")}.`);
  if (result.worst) {
    const w = result.worst;
    const at = samples.find((p) => p.s >= (w.fromKm + w.toKm) / 2);
    const where = at ? ` near ${Math.abs(at.lat).toFixed(1)}°${at.lat >= 0 ? "N" : "S"} ${Math.abs(at.lon).toFixed(1)}°${at.lon >= 0 ? "E" : "W"}` : "";
    const when = at?.timeMs ? `, about ${new Date(at.timeMs).toISOString().slice(11, 16)} UTC` : "";
    lines.push(`Worst segment: km ${Math.round(w.fromKm)}–${Math.round(w.toKm)}${where}${when}, `
      + `${w.risk.toFixed(1)} equivalent km, mostly ${HAZARD_LABELS[w.governing].toLowerCase()}.`);
  } else {
    lines.push("No segment comes within half of any hazard's limit.");
  }
  if (Number.isFinite(result.minFos.value)) {
    lines.push(`Lowest factor of safety on the route: ${result.minFos.value.toFixed(2)} `
      + `(${HAZARD_LABELS[result.minFos.hazard].toLowerCase()}, km ${Math.round(result.minFos.s)}).`);
  }
  return lines.join("\n");
}
