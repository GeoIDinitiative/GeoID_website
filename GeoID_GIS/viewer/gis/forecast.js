/**
 * Sixteen days of weather against a susceptibility map.
 *
 * A susceptibility map says where a slope could fail or where water could
 * stand. It does not say when, and on its own it never changes — which is why
 * a static hazard layer answers so few of the questions people actually have.
 * The missing half is the trigger: how much rain is coming, and onto ground
 * that is already how wet.
 *
 * The forecast is NOAA's GFS, delivered by Open-Meteo (CC-BY 4.0) because it
 * serves the model with CORS headers and no key, which is what a static site
 * can consume. Sixteen days is GFS's own horizon, not a number chosen here.
 * Nothing about the model is hidden behind the convenience: the source, the
 * run's own coordinates and the licence travel with every result.
 *
 * The combination is deliberately simple and stated rather than tuned:
 *
 *   trigger = 0.6 × (3-day rain / burst threshold)
 *           + 0.4 × (15-day antecedent rain / wetness threshold)
 *   risk    = susceptibility × min(1, trigger)
 *
 * Rain over a short window is what moves a slope; rain over the preceding
 * fortnight is what decides whether the ground can take any more. Both are
 * capped, because a threshold exceeded twice over is not twice the hazard —
 * past the threshold the answer is "yes" and more rain does not make it more
 * yes. The thresholds are parameters with published Irish/British defaults
 * (~40 mm in 3 days, ~150 mm in 15), NOT calibrated against a landslide
 * inventory, and the panel says so: this ranks days against each other, it
 * does not forecast failures.
 */

export const SOURCE = {
  id: "gfs-open-meteo",
  name: "NOAA GFS via Open-Meteo",
  licence: "CC-BY 4.0 (Open-Meteo), NOAA GFS is public domain",
  attribution: "Weather data by Open-Meteo.com, NOAA Global Forecast System",
  endpoint: "https://api.open-meteo.com/v1/forecast",
};

export const DEFAULTS = {
  days: 16,          // GFS's horizon; asking for more silently returns fewer.
  burstDays: 3,
  burstMm: 40,
  antecedentDays: 15,
  antecedentMm: 150,
};

/* ── pure ───────────────────────────────────────────────────────────────── */

export function buildUrl({ lat, lon, days = DEFAULTS.days, pastDays = 0, model = "gfs_seamless" }) {
  const q = new URLSearchParams({
    latitude: String(Number(lat).toFixed(4)),
    longitude: String(Number(lon).toFixed(4)),
    daily: "precipitation_sum",
    forecast_days: String(Math.max(1, Math.min(16, Math.round(days)))),
    timezone: "UTC",
  });
  if (pastDays > 0) q.set("past_days", String(Math.round(pastDays)));
  // GFS has no archive behind it, and asking one model for past days does not
  // return fewer days — it returns SIXTEEN NULLS AND FIFTEEN MORE, forecast
  // included. Measured against the live service. So the two windows are two
  // requests: the forecast from GFS, the antecedent from Open-Meteo's
  // best-match analysis, and the panel says which is which rather than
  // pretending one model answered both.
  if (model && pastDays <= 0) q.set("models", model);
  return `${SOURCE.endpoint}?${q}`;
}

/**
 * The response, as days. A null is NOT zero rain — it is the service saying it
 * has no value, and writing it down as 0 mm turns a broken request into a
 * confident dry forecast. That is precisely how the null-for-every-day bug
 * above stayed invisible: the chart drew sixteen empty bars and the panel
 * reported minimal risk, which is what a genuinely dry fortnight looks like.
 */
export function parseForecast(json) {
  if (json?.error) throw new Error(json.reason || "the forecast service refused");
  const time = json?.daily?.time;
  const rain = json?.daily?.precipitation_sum;
  if (!Array.isArray(time) || !Array.isArray(rain) || !time.length) {
    throw new Error("no daily precipitation in the response");
  }
  const days = time.map((date, i) => ({
    date,
    precipMm: Number.isFinite(rain[i]) ? rain[i] : null,
  }));
  if (days.every((d) => d.precipMm == null)) {
    throw new Error("the service returned no precipitation values for any day");
  }
  return {
    lat: json.latitude,
    lon: json.longitude,
    elevation: json.elevation,
    unit: json.daily_units?.precipitation_sum || "mm",
    days,
  };
}

/** Sums a window, and says how much of it was actually known. */
function rollingSum(values, index, window) {
  let total = 0;
  let known = 0;
  let wanted = 0;
  for (let i = Math.max(0, index - window + 1); i <= index; i += 1) {
    wanted += 1;
    if (Number.isFinite(values[i])) { total += values[i]; known += 1; }
  }
  return { total, known, wanted };
}

/**
 * Per-day trigger index from a daily rain series. `fromIndex` is the first day
 * to report — everything before it is history feeding the windows.
 */
export function triggerIndex(days, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const rain = days.map((d) => d.precipMm);
  const fromIndex = Number.isInteger(options.fromIndex) ? options.fromIndex : 0;
  const out = [];
  for (let i = fromIndex; i < days.length; i += 1) {
    const burst = rollingSum(rain, i, o.burstDays);
    // The antecedent window ENDS the day before: rain that falls today is the
    // burst, and counting it twice makes a single wet day look like a wet
    // fortnight as well.
    const antecedent = i > 0 ? rollingSum(rain, i - 1, o.antecedentDays)
      : { total: 0, known: 0, wanted: o.antecedentDays };
    const trigger = Math.min(1,
      0.6 * Math.min(1, burst.total / o.burstMm)
      + 0.4 * Math.min(1, antecedent.total / o.antecedentMm));
    out.push({
      date: days[i].date,
      precipMm: rain[i],
      burstMm: Number(burst.total.toFixed(1)),
      antecedentMm: Number(antecedent.total.toFixed(1)),
      // A trigger built on a window the service could not fill is a smaller
      // number than the truth, so whether it was complete travels with it.
      antecedentComplete: antecedent.known === antecedent.wanted,
      trigger: Number(trigger.toFixed(3)),
    });
  }
  return out;
}

/** Susceptibility (0..1) × trigger (0..1), with the band it lands in. */
export function riskEvolution(susceptibility, triggerDays) {
  const s = Math.max(0, Math.min(1, Number(susceptibility)));
  return triggerDays.map((day) => {
    const risk = Number((s * day.trigger).toFixed(3));
    return { ...day, susceptibility: Number(s.toFixed(3)), risk, band: bandOf(risk) };
  });
}

export function bandOf(risk) {
  if (risk >= 0.6) return "high";
  if (risk >= 0.35) return "moderate";
  if (risk >= 0.15) return "low";
  return "minimal";
}

/** Normalise a raster reading to 0..1 given the layer's own range. */
export function normalise(value, min, max) {
  const v = Number(value);
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return null;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

/* ── impure ─────────────────────────────────────────────────────────────── */

export async function fetchForecast({ lat, lon, days = DEFAULTS.days, fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) throw new Error("no fetch available");
  const get = async (url) => {
    const response = await f(url);
    if (!response.ok) throw new Error(`the forecast service answered ${response.status}`);
    return parseForecast(await response.json());
  };
  const forecast = await get(buildUrl({ lat, lon, days }));
  // The history is a second request and a different model, so a failure there
  // must not take the forecast with it — an antecedent window we could not
  // fill is a weaker answer, not no answer.
  let history = null;
  try {
    history = await get(buildUrl({
      lat, lon, days: 1, pastDays: DEFAULTS.antecedentDays, model: null,
    }));
  } catch (error) {
    history = null;
  }
  // Overlap is decided by which dates the forecast already holds, not by
  // comparing date strings — the service returns ISO days where that would
  // work, but a comparison that depends on the format is a comparison waiting
  // for a service that changes it.
  const held = new Set(forecast.days.map((d) => d.date));
  const past = history ? history.days.filter((d) => !held.has(d.date)) : [];
  return {
    ...forecast,
    days: [...past, ...forecast.days],
    forecastFrom: forecast.days[0].date,
    historyDays: past.length,
  };
}

/**
 * The whole chain for one point: forecast → trigger → risk, with the
 * susceptibility read from whichever loaded raster the caller names.
 */
export async function forecastRiskAt({ lat, lon, layer, days = DEFAULTS.days, fetchImpl } = {}) {
  const forecast = await fetchForecast({ lat, lon, days, fetchImpl });
  // Everything before the first forecast day is antecedent history.
  const fromIndex = forecast.historyDays ?? Math.max(0, forecast.days.length - days);
  const trigger = triggerIndex(forecast.days, { fromIndex });
  let susceptibility = null;
  let reading = null;
  if (layer?.sampler) {
    reading = layer.sampler(lat, lon);
    const value = typeof reading === "object" ? reading?.value : reading;
    susceptibility = normalise(value, layer.legendInfo?.min, layer.legendInfo?.max);
  }
  return {
    source: SOURCE,
    at: { lat: forecast.lat, lon: forecast.lon, elevation: forecast.elevation },
    layer: layer?.name || null,
    susceptibility,
    reading,
    days: susceptibility == null
      ? trigger.map((d) => ({ ...d, susceptibility: null, risk: null, band: null }))
      : riskEvolution(susceptibility, trigger),
  };
}

if (typeof window !== "undefined") {
  window.GeoIDForecast = {
    SOURCE, DEFAULTS, buildUrl, parseForecast, triggerIndex,
    riskEvolution, normalise, fetchForecast, forecastRiskAt,
  };
}
