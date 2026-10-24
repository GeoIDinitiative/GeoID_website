/**
 * The wind over a vent, hour by hour, from GFS on its pressure levels — the
 * profiles the ash model is carried by. Pure: the URL and the reading of the
 * answer, so both are tested; the fetch is the caller's.
 *
 * Open-Meteo's forecast endpoint answers from about three months back to
 * sixteen days ahead; anything earlier is its historical-forecast endpoint
 * (GFS's own past runs, from 2021). The date decides which, and an eruption
 * asked for further ahead than any forecast reaches is refused here rather
 * than run on winds that do not exist.
 */

import { LEVELS, readColumn } from "./atmosphere-model.js?v=20261024-bc1cb01";

export const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
export const HISTORICAL_BASE = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const DAY = 86400e3;

const VARS = ["temperature", "wind_speed", "wind_direction", "geopotential_height"];

/** "2026-10-11T14:00" — Open-Meteo's own hour format, in GMT. */
export function hourText(ms) {
  return new Date(Math.floor(ms / 3600e3) * 3600e3).toISOString().slice(0, 16);
}

/**
 * The request for the wind over a point from `fromMs` to `toMs`.
 * Throws, in words, for a window the forecast cannot reach.
 */
export function windRequest(lat, lon, fromMs, toMs, nowMs = Date.now(), levels = LEVELS) {
  if (toMs > nowMs + 16 * DAY) {
    throw new Error("GFS forecasts reach sixteen days ahead; that eruption time is beyond them.");
  }
  if (fromMs < Date.UTC(2021, 2, 23)) {
    throw new Error("GFS's archived runs begin in March 2021; an earlier eruption has no wind to carry it here.");
  }
  const base = fromMs < nowMs - 80 * DAY ? HISTORICAL_BASE : FORECAST_BASE;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: levels.flatMap((p) => VARS.map((v) => `${v}_${p}hPa`)).join(","),
    models: "gfs_seamless",
    wind_speed_unit: "ms",
    timezone: "GMT",
    start_hour: hourText(fromMs),
    end_hour: hourText(toMs + 3600e3),
  });
  return { url: `${base}?${params}`, base, historical: base === HISTORICAL_BASE };
}

/**
 * The answer as profiles in the ash model's shape — [{t, levels: [{z, u, v}]}],
 * t in seconds from `startMs` — dropping hours the model left empty.
 */
export function profilesFrom(answer, startMs, levels = LEVELS) {
  const times = answer?.hourly?.time || [];
  const out = [];
  times.forEach((time, i) => {
    const ms = Date.parse(/Z$/.test(time) ? time : `${time}Z`);
    const col = readColumn(answer, i, levels).filter((l) => Number.isFinite(l.u) && Number.isFinite(l.v));
    if (col.length >= 2 && Number.isFinite(ms)) {
      out.push({ t: (ms - startMs) / 1000, levels: col.map((l) => ({ z: l.z, u: l.u, v: l.v, p: l.p, tC: l.t })) });
    }
  });
  return out;
}

/** The wind at a height at the eruption's start, for saying where the ash goes. */
export function windSummary(profiles, z) {
  const p = profiles.find((x) => x.t >= 0) || profiles[profiles.length - 1];
  if (!p) return null;
  let best = p.levels[0];
  for (const l of p.levels) if (Math.abs(l.z - z) < Math.abs(best.z - z)) best = l;
  const speed = Math.hypot(best.u, best.v);
  // The direction the wind blows TOWARD, as a compass bearing.
  const toward = (Math.atan2(best.u, best.v) * 180 / Math.PI + 360) % 360;
  return { speed, toward, z: best.z, p: best.p };
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compass(bearing) {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}
