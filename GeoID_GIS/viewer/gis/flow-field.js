/**
 * Vector fields on the globe — wind and ocean currents — the pure half.
 *
 * Everything here is arithmetic on plain arrays so it can be pinned in Node:
 * where to sample, how to ask Open-Meteo for it, how to read what comes back
 * (units included), how to interpolate a field at any point, how far a
 * particle moves in one step, and what colour a speed is. The drawing, the
 * fetching and the animation loop are `flow-layer.js`.
 *
 * A FIELD is a regular lat/lon lattice: `nx` columns from `west` to `east`,
 * `ny` rows from `south` to `north`, both ends included, with eastward `u`
 * and northward `v` in metres per second (NaN where there is no value — land,
 * for a current). A global field wraps in longitude.
 */

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;
/** Metres in one degree of latitude on the mean Earth. */
export const M_PER_DEG = 111_320;

/** The whole planet, as the box a global field covers. */
export const WORLD = Object.freeze({ west: -180, east: 180, south: -80, north: 80 });

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Longitude into [-180, 180). */
export function wrapLon(lon) {
  const x = ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
  return Object.is(x, -0) ? 0 : x;
}

/** True when a box spans every longitude, so the lattice wraps. */
export function isGlobal(box) {
  return box.east - box.west >= 359.999;
}

/**
 * How many columns and rows to sample a box at, inside a point budget.
 *
 * The SPACING is the same in both directions on the ground (degrees of
 * longitude shrink with the cosine of the mean latitude), so a wide shallow
 * box gets more columns than rows rather than square cells in degrees, which
 * on a Mercator mind's eye look fine and on a globe are stretched.
 */
export function planGrid(box, budget = 400, { min = 4 } = {}) {
  const midLat = (box.south + box.north) / 2;
  const shrink = Math.max(0.2, Math.cos(midLat * RAD));
  const w = Math.max(1e-6, (box.east - box.west) * shrink);
  const h = Math.max(1e-6, box.north - box.south);
  const spacing = Math.sqrt((w * h) / Math.max(1, budget));
  const nx = Math.max(min, Math.round(w / spacing) + 1);
  const ny = Math.max(min, Math.round(h / spacing) + 1);
  return { nx, ny };
}

/**
 * The lattice's points, row by row from the south-west corner. A global box
 * does NOT repeat its seam: 360° wide with `nx` columns means a step of
 * 360/nx, the last column one step short of where the first one is again.
 */
export function gridPoints(box, nx, ny) {
  const global = isGlobal(box);
  const dLon = (box.east - box.west) / (global ? nx : Math.max(1, nx - 1));
  const dLat = (box.north - box.south) / Math.max(1, ny - 1);
  const lats = new Float64Array(nx * ny);
  const lons = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      lats[k] = box.south + j * dLat;
      lons[k] = wrapLon(box.west + i * dLon);
    }
  }
  return { lats, lons, dLon, dLat };
}

/**
 * From a speed and a compass direction to eastward and northward components.
 *
 * The two services this reads speak different conventions, and getting it
 * backwards draws every particle the wrong way round with nothing to say so:
 * a WIND direction is where it blows FROM (meteorological), a CURRENT's is
 * where it flows TO (oceanographic).
 */
export function uvFromSpeedDir(speed, dirDeg, convention = "from") {
  const s = Number(speed);
  const d = Number(dirDeg);
  if (!Number.isFinite(s) || !Number.isFinite(d)) return [NaN, NaN];
  const sign = convention === "to" ? 1 : -1;
  return [sign * s * Math.sin(d * RAD), sign * s * Math.cos(d * RAD)];
}

/** The compass direction a (u, v) blows TOWARD, 0..360. */
export function headingOf(u, v) {
  return ((Math.atan2(u, v) * DEG) + 360) % 360;
}

/** Compass words for a direction, sixteen points. */
export function compassPoint(deg) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** A speed in whatever unit a service answered in, as metres per second. */
export function toMetresPerSecond(value, unit) {
  // `Number(null)` is 0, and a missing value read as a calm is the oldest
  // trap in this tree.
  if (value === null || value === undefined || value === "") return NaN;
  const x = Number(value);
  if (!Number.isFinite(x)) return NaN;
  const u = String(unit || "").toLowerCase().replace(/\s+/g, "");
  if (u === "km/h" || u === "kmh" || u === "kph") return x / 3.6;
  if (u === "kn" || u === "kt" || u === "knots" || u === "kts") return x * 0.514444;
  if (u === "mph" || u === "mp/h") return x * 0.44704;
  return x; // "m/s", or unstated
}

/* ── asking Open-Meteo ─────────────────────────────────────────────────── */

export const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_MARINE = "https://marine-api.open-meteo.com/v1/marine";
/**
 * Points per request. Open-Meteo answers many coordinates in one call, but
 * they ride in the URL, and a few hundred is where a URL stays well inside
 * what every proxy on the way will pass (about 12 characters a point).
 */
export const CHUNK = 250;

/** Split a lattice into request-sized lists of points. */
export function chunkPoints(lats, lons, size = CHUNK) {
  const out = [];
  for (let start = 0; start < lats.length; start += size) {
    const end = Math.min(lats.length, start + size);
    out.push({ start, lats: Array.from(lats.slice(start, end)), lons: Array.from(lons.slice(start, end)) });
  }
  return out;
}

const fixed = (x, d = 2) => Number(x.toFixed(d));

/**
 * One request's URL. `hourly` with a short window rather than `current`,
 * because only the hourly API has the pressure levels and the forecast hours
 * — and a field read at "now" and one read at "+24 h" should come from one
 * kind of request, or the two would disagree for reasons that are not the
 * weather.
 */
export function requestUrl(base, { lats, lons, variables, extra = {}, hoursAhead = 0 }) {
  const params = new URLSearchParams();
  params.set("latitude", lats.map((x) => fixed(x)).join(","));
  params.set("longitude", lons.map((x) => fixed(x)).join(","));
  params.set("hourly", variables.join(","));
  params.set("past_hours", "1");
  params.set("forecast_hours", String(Math.max(2, Math.ceil(hoursAhead) + 2)));
  params.set("timezone", "GMT");
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${base}?${params.toString()}`;
}

/**
 * Which hour of an hourly series is the one asked for: the nearest to `now`
 * plus `hoursAhead`. Times come back as "2026-10-11T14:00" in GMT.
 */
export function pickHour(times, nowMs, hoursAhead = 0) {
  if (!Array.isArray(times) || !times.length) return -1;
  const target = nowMs + hoursAhead * 3_600_000;
  let best = -1;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const ms = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
    const diff = Math.abs(ms - target);
    if (Number.isFinite(diff) && diff < bestDiff) { best = i; bestDiff = diff; }
  });
  return best;
}

/**
 * Read one Open-Meteo answer — a single location's object or a list of them —
 * into flat arrays, one per variable, CONVERTED to the unit asked for where
 * the variable is a speed. Missing values (land, for the sea) are NaN.
 *
 * `convert` maps a variable name to "speed" for a velocity; anything else is
 * passed through as the number it is.
 */
export function readHourly(json, variables, { nowMs, hoursAhead = 0, convert = {} } = {}) {
  const list = Array.isArray(json) ? json : [json];
  const out = {};
  for (const name of variables) out[name] = new Float64Array(list.length).fill(NaN);
  let time = null;
  list.forEach((loc, i) => {
    const hourly = loc?.hourly;
    if (!hourly) return;
    const h = pickHour(hourly.time, nowMs, hoursAhead);
    if (h < 0) return;
    time ??= hourly.time[h];
    for (const name of variables) {
      const raw = hourly[name]?.[h];
      if (raw === null || raw === undefined) continue;
      out[name][i] = convert[name] === "speed"
        ? toMetresPerSecond(raw, loc.hourly_units?.[name])
        : Number(raw);
    }
  });
  return { values: out, time };
}

/* ── the field ─────────────────────────────────────────────────────────── */

/**
 * A field from a lattice and its speeds and directions. Any extra scalar
 * arrays (sea surface temperature, say) ride along under `scalars`.
 */
export function buildField(box, nx, ny, speed, dir, { convention = "from", scalars = {}, time = null } = {}) {
  const n = nx * ny;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  let max = 0;
  let valid = 0;
  for (let k = 0; k < n; k += 1) {
    const [a, b] = uvFromSpeedDir(speed[k], dir[k], convention);
    u[k] = a; v[k] = b;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      valid += 1;
      max = Math.max(max, Math.hypot(a, b));
    }
  }
  const scal = {};
  for (const [name, arr] of Object.entries(scalars)) scal[name] = Float32Array.from(arr);
  return { ...box, nx, ny, u, v, scalars: scal, global: isGlobal(box), max, valid, time };
}

/** True when a point falls inside the field's box (a global one holds everything in its latitudes). */
export function covers(field, lat, lon) {
  if (!field) return false;
  if (lat < field.south || lat > field.north) return false;
  if (field.global) return true;
  const x = wrapLon(lon);
  return x >= field.west && x <= field.east;
}

/**
 * Bilinear interpolation of any array on the lattice. NaN at any of the four
 * corners answers NaN: for a current that is the coast, and a particle that
 * meets it should end there rather than be blended onto the land.
 */
export function interpolate(field, arr, lat, lon) {
  if (!covers(field, lat, lon)) return NaN;
  const { nx, ny } = field;
  const fy = ((lat - field.south) / (field.north - field.south)) * (ny - 1);
  let fx;
  if (field.global) {
    fx = ((((wrapLon(lon) - field.west) % 360) + 360) % 360) / (360 / nx);
  } else {
    fx = ((wrapLon(lon) - field.west) / (field.east - field.west)) * (nx - 1);
  }
  const j0 = clamp(Math.floor(fy), 0, ny - 1);
  const j1 = Math.min(ny - 1, j0 + 1);
  const ty = clamp(fy - j0, 0, 1);
  let i0 = Math.floor(fx);
  let i1 = i0 + 1;
  const tx = fx - i0;
  if (field.global) {
    i0 = ((i0 % nx) + nx) % nx;
    i1 = ((i1 % nx) + nx) % nx;
  } else {
    i0 = clamp(i0, 0, nx - 1);
    i1 = clamp(i1, 0, nx - 1);
  }
  const corners = [
    [arr[j0 * nx + i0], (1 - tx) * (1 - ty)],
    [arr[j0 * nx + i1], tx * (1 - ty)],
    [arr[j1 * nx + i0], (1 - tx) * ty],
    [arr[j1 * nx + i1], tx * ty],
  ];
  // A corner with no weight is not consulted, so a node beside the coast
  // still answers its own value.
  let sum = 0;
  for (const [value, weight] of corners) {
    if (weight <= 1e-12) continue;
    if (!Number.isFinite(value)) return NaN;
    sum += value * weight;
  }
  return sum;
}

/**
 * The flow at a point from a STACK of fields, finest first: a view's own
 * lattice over the world's coarse one. The first field that covers the point
 * answers, even with NaN — a fine field saying "coast" must not be overruled
 * by a coarse one that blurred the coast away.
 */
export function sampleStack(stack, lat, lon) {
  for (const field of stack) {
    if (!field || !covers(field, lat, lon)) continue;
    const u = interpolate(field, field.u, lat, lon);
    const v = interpolate(field, field.v, lat, lon);
    return { u, v, field };
  }
  return { u: NaN, v: NaN, field: null };
}

/** A named scalar from the same stack, by the same rule. */
export function sampleScalar(stack, name, lat, lon) {
  for (const field of stack) {
    if (!field || !covers(field, lat, lon)) continue;
    const arr = field.scalars?.[name];
    return arr ? interpolate(field, arr, lat, lon) : NaN;
  }
  return NaN;
}

/**
 * Move a point along (u, v) by `stepDeg` degrees of arc per metre-per-second.
 *
 * The step is in DEGREES rather than seconds because what is being drawn is a
 * picture of the field, not a trajectory: a particle crossing the view in the
 * same number of frames at every zoom is what makes the map legible, and the
 * renderer sets `stepDeg` from the view's own span. Longitude is divided by
 * the cosine of the latitude so a step east is the same ground as a step
 * north; near the poles that is clamped rather than divided by nothing.
 */
export function advect(lat, lon, u, v, stepDeg) {
  const cos = Math.max(0.05, Math.cos(lat * RAD));
  const nextLat = lat + v * stepDeg;
  const nextLon = wrapLon(lon + (u * stepDeg) / cos);
  return [nextLat, nextLon];
}

/**
 * A random point inside a box, UNIFORM BY AREA: latitude through its sine, or
 * the poles are drawn as densely as the equator and every map of a flow looks
 * busiest where the ground is smallest.
 */
export function randomPoint(box, rand = Math.random) {
  const s0 = Math.sin(clamp(box.south, -89.9, 89.9) * RAD);
  const s1 = Math.sin(clamp(box.north, -89.9, 89.9) * RAD);
  const lat = Math.asin(s0 + rand() * (s1 - s0)) * DEG;
  const span = isGlobal(box) ? 360 : box.east - box.west;
  const lon = wrapLon(box.west + rand() * span);
  return [lat, lon];
}

/* ── colour ────────────────────────────────────────────────────────────── */

/**
 * Speed ramps, as stops of [value in m/s, r, g, b]. The wind's runs from a
 * calm blue-grey through green and yellow to a storm magenta — the reading
 * nullschool trained everybody in — and is anchored on the Beaufort scale's
 * own thresholds (3.4 gentle breeze, 10.8 strong breeze, 17.2 gale, 24.5
 * storm, 32.7 hurricane force), so a colour means a wind a sailor would name.
 * The current's spans the ocean's own range, where 1 m/s is a strong current
 * and 2 is the Gulf Stream's core.
 */
export const RAMPS = {
  wind: [
    [0, 36, 104, 180], [3.4, 24, 170, 192], [7, 70, 200, 120], [10.8, 196, 220, 60],
    [17.2, 250, 170, 40], [24.5, 236, 70, 54], [32.7, 220, 40, 160], [45, 250, 220, 255],
  ],
  current: [
    [0, 26, 60, 140], [0.15, 30, 120, 200], [0.35, 40, 190, 210], [0.6, 120, 220, 170],
    [1.0, 240, 230, 110], [1.5, 250, 150, 60], [2.2, 240, 70, 90],
  ],
  sst: [
    [-2, 60, 40, 140], [5, 40, 100, 200], [12, 40, 180, 200], [18, 120, 210, 140],
    [24, 245, 210, 90], [28, 240, 120, 60], [32, 200, 40, 70],
  ],
};

/** The colour a value takes on a ramp, as [r, g, b] in 0..1. */
export function rampAt(ramp, value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return [0.55, 0.55, 0.55];
  if (x <= ramp[0][0]) return ramp[0].slice(1).map((c) => c / 255);
  for (let i = 1; i < ramp.length; i += 1) {
    const [v1, ...c1] = ramp[i];
    if (x <= v1) {
      const [v0, ...c0] = ramp[i - 1];
      const t = (x - v0) / (v1 - v0 || 1);
      return c0.map((c, k) => (c + (c1[k] - c) * t) / 255);
    }
  }
  return ramp[ramp.length - 1].slice(1).map((c) => c / 255);
}

/** A ramp as the legend's palette: hex strings, no hash, low to high. */
export function rampPalette(ramp, steps = 9) {
  const lo = ramp[0][0];
  const hi = ramp[ramp.length - 1][0];
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const rgb = rampAt(ramp, lo + ((hi - lo) * i) / (steps - 1));
    out.push(rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join(""));
  }
  return out;
}

/** The Beaufort number for a wind speed in m/s, and its name. */
export function beaufort(speed) {
  const edges = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const names = ["Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze",
    "Fresh breeze", "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm",
    "Violent storm", "Hurricane force"];
  const s = Number(speed);
  if (!Number.isFinite(s)) return null;
  let n = 0;
  while (n < edges.length && s >= edges[n]) n += 1;
  return { number: n, name: names[n] };
}

/* ── forecast windows ──────────────────────────────────────────────────── */

/**
 * One number per location from an hourly series over a WINDOW: the sum of the
 * precipitation in the next day, the strongest gust, the peak CAPE. A hazard
 * is a question about a period, not about the hour the request happened to be
 * made in, so a forecast field is read this way rather than by `readHourly`.
 *
 * The window is [now + fromHours, now + toHours), on the hourly steps the
 * service returned. A location with no value at any hour of it is NaN; one
 * with some missing hours is summed or maximised over the hours it has, and
 * `hours` says how many those were.
 */
export function aggregateHourly(json, variable, { nowMs, fromHours = 0, toHours = 24, op = "sum", convert = null } = {}) {
  const list = Array.isArray(json) ? json : [json];
  const values = new Float64Array(list.length).fill(NaN);
  const hours = new Int32Array(list.length);
  const t0 = nowMs + fromHours * 3_600_000;
  const t1 = nowMs + toHours * 3_600_000;
  let first = null;
  let last = null;
  list.forEach((loc, i) => {
    const hourly = loc?.hourly;
    const series = hourly?.[variable];
    if (!hourly || !Array.isArray(series)) return;
    let acc = op === "max" ? -Infinity : op === "min" ? Infinity : 0;
    let n = 0;
    hourly.time.forEach((t, k) => {
      const ms = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
      // The hour LABELLED t is the hour ending at t for an accumulation, so
      // an hour is in the window when it ends inside it.
      if (!(ms > t0 && ms <= t1 + 1)) return;
      const raw = series[k];
      if (raw === null || raw === undefined) return;
      let x = Number(raw);
      if (!Number.isFinite(x)) return;
      if (convert === "speed") x = toMetresPerSecond(x, loc.hourly_units?.[variable]);
      if (op === "max") acc = Math.max(acc, x);
      else if (op === "min") acc = Math.min(acc, x);
      else acc += x;
      n += 1;
      if (i === 0) { first ??= t; last = t; }
    });
    if (n) { values[i] = acc; hours[i] = n; }
  });
  return { values, hours, from: first, to: last };
}

/** How many finite values an array holds. */
export function countFinite(arr) {
  let n = 0;
  for (const x of arr || []) if (Number.isFinite(x)) n += 1;
  return n;
}
