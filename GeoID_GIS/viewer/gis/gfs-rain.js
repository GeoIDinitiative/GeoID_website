/**
 * GFS RAINFALL MAPS, on the model's own grid.
 *
 * NOAA's Global Forecast System through Open-Meteo's historical-forecast
 * endpoint, which is ONE door for every window this app asks for: past dates
 * are the first hours of successive GFS runs stitched into a continuous
 * series, future dates are the latest run, out to fifteen days — so a storm
 * last spring, the week ahead, and a window straddling today are the same
 * request. Measured: the endpoint answers from 2016-01-01 to today + 15, with
 * real GFS from late March 2021 (January 2021 comes back all nulls).
 *
 * THE MAP IS THE MODEL'S GRID, NOT A SCATTER OF POINTS. GFS runs on a T1534
 * Gaussian grid, 3072 longitudes (0.1171875°, about 13 km) by 1536 near-even
 * latitudes, and Open-Meteo answers each coordinate from its nearest NODE.
 * Asking six points across a 30 km box therefore returned fourteen distinct
 * nodes for thirty-six points (measured), and inverse-distance weighting over
 * duplicates is a picture of the request, not of the rain. So the request is a
 * lattice at HALF the node spacing over the area plus a node of margin, the
 * answers are de-duplicated to the nodes themselves, and a rainfall map is the
 * node field interpolated bilinearly — the resolution GFS actually has, drawn
 * smoothly, and no finer.
 *
 * A MAP IS AN ACCUMULATION OVER A WINDOW. Each frame is the rain summed over
 * the hours before it (a 24-hour map by default), because the static slope
 * model that reads it is a STEADY STATE: it asks what water table a sustained
 * recharge would build, and an hour of rain sustained for ever is not what any
 * storm does. The window is a control, and the fetch starts early enough that
 * the first frame's window is full.
 */

export const GFS_ENDPOINT = "https://historical-forecast-api.open-meteo.com/v1/forecast";
export const GFS_MODEL = "gfs_global";
/** T1534's longitude step; the latitudes are Gaussian but within 0.03% of it. */
export const GFS_NODE_DEG = 360 / 3072;
/** The first date the archive holds real GFS; earlier dates answer in nulls. */
export const GFS_ARCHIVE_START = "2021-03-24";
export const GFS_CREDIT = "NOAA NCEP Global Forecast System (GFS), via Open-Meteo (CC BY 4.0)";

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The window to fetch: the asked dates, started early by the rainfall window so
 * the first map's accumulation is complete, and refused past what exists.
 */
export function fetchWindow({ start, end, windowH = 24, today = iso(Date.now()) } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) {
    return { ok: false, message: "Give a start and an end date." };
  }
  if (start > end) return { ok: false, message: "The start is after the end." };
  const last = iso(Date.parse(`${today}T00:00:00Z`) + 15 * DAY_MS);
  if (end > last) return { ok: false, message: `GFS forecasts reach ${last}; the window ends ${end}.` };
  if (start < GFS_ARCHIVE_START) {
    return { ok: false, message: `The GFS archive begins ${GFS_ARCHIVE_START}; the window starts ${start}.` };
  }
  const leadDays = Math.ceil(Math.max(0, windowH - 1) / 24);
  const from = iso(Date.parse(`${start}T00:00:00Z`) - leadDays * DAY_MS);
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  return { ok: true, from: from < GFS_ARCHIVE_START ? GFS_ARCHIVE_START : from, to: end, start, end, days, leadDays };
}

/**
 * Where to ask: a lattice over the bounds plus a node and a half of margin, at
 * HALF the node spacing so every node is reached by some request (asking AT
 * the spacing lets two neighbours snap to one node and leave a hole). Falls
 * back to the node spacing when that would be more than `maxPoints`.
 */
export function gfsLattice(bounds, { maxPoints = 900 } = {}) {
  const { west, south, east, north } = bounds;
  const pad = GFS_NODE_DEG * 1.5;
  for (const step of [GFS_NODE_DEG / 2, GFS_NODE_DEG]) {
    const lats = []; const lons = [];
    for (let v = south - pad; v <= north + pad + 1e-9; v += step) lats.push(Math.max(-89.9, Math.min(89.9, v)));
    for (let v = west - pad; v <= east + pad + 1e-9; v += step) lons.push(v);
    if (lats.length * lons.length <= maxPoints || step === GFS_NODE_DEG) {
      const points = [];
      lats.forEach((lat) => lons.forEach((lon) => points.push({ lat, lon })));
      return { points, step, rows: lats.length, cols: lons.length };
    }
  }
  return { points: [], step: GFS_NODE_DEG, rows: 0, cols: 0 };
}

export function gfsUrl(points, { from, to }) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => (((p.lon + 540) % 360) - 180).toFixed(4)).join(","),
    start_date: from, end_date: to, hourly: "precipitation", models: GFS_MODEL, timezone: "UTC",
  });
  return `${GFS_ENDPOINT}?${q.toString()}`;
}

/**
 * The answers, de-duplicated to the GFS nodes they came from. Each node keeps
 * its own coordinate (the one the model uses), its elevation, and its hourly
 * rain as a Float32Array with NaN where the archive has nothing.
 */
export function nodesFromResponses(responses) {
  const nodes = new Map();
  let times = null;
  for (const json of responses) {
    const list = Array.isArray(json) ? json : [json];
    for (const e of list) {
      if (!e?.hourly?.time) continue;
      if (!times) times = e.hourly.time;
      const key = `${e.latitude.toFixed(4)},${e.longitude.toFixed(4)}`;
      if (nodes.has(key)) continue;
      const rain = Float32Array.from(e.hourly.precipitation, (v) => (Number.isFinite(v) ? v : NaN));
      nodes.set(key, { lat: e.latitude, lon: e.longitude, elevation: e.elevation, rain });
    }
  }
  return { times: times || [], nodes: [...nodes.values()] };
}

/**
 * The node field as a grid: sorted distinct latitudes and longitudes, and the
 * node at each. Regular when every combination is present, which it is for a
 * Gaussian grid read over a box; otherwise `regular` is false and the caller
 * interpolates by distance instead.
 */
export function nodeGrid(nodes) {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  const lats = [...new Set(nodes.map((n) => r(n.lat)))].sort((a, b) => a - b);
  const lons = [...new Set(nodes.map((n) => r(n.lon)))].sort((a, b) => a - b);
  const at = new Int32Array(lats.length * lons.length).fill(-1);
  nodes.forEach((n, k) => { at[lats.indexOf(r(n.lat)) * lons.length + lons.indexOf(r(n.lon))] = k; });
  return { lats, lons, at, regular: at.every((k) => k >= 0), count: nodes.length };
}

/**
 * How a point reads the node field: four node indices and their weights.
 * Bilinear inside the grid (exact on a plane), clamped at its edge; the nearest
 * four by inverse distance where the grid has a hole.
 */
export function interpolatorFor(grid, nodes, lat, lon) {
  const lonE = (((lon + 540) % 360) - 180);
  if (grid.regular && grid.lats.length > 1 && grid.lons.length > 1) {
    const seek = (axis, v) => {
      let i = 0;
      while (i < axis.length - 2 && axis[i + 1] <= v) i += 1;
      const t = (v - axis[i]) / (axis[i + 1] - axis[i]);
      return [i, Math.max(0, Math.min(1, t))];
    };
    const [j, ty] = seek(grid.lats, lat); const [i, tx] = seek(grid.lons, lonE);
    const w = grid.lons.length;
    const idx = [grid.at[j * w + i], grid.at[j * w + i + 1], grid.at[(j + 1) * w + i], grid.at[(j + 1) * w + i + 1]];
    const wt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    return { idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
  }
  const ranked = nodes.map((n, k) => ({ k, d2: (n.lat - lat) ** 2 + ((n.lon - lonE) * Math.cos(lat * Math.PI / 180)) ** 2 }))
    .sort((a, b) => a.d2 - b.d2).slice(0, 4);
  if (ranked[0]?.d2 < 1e-12) return { idx: Int32Array.of(ranked[0].k, 0, 0, 0), wt: Float32Array.of(1, 0, 0, 0) };
  const inv = ranked.map((r) => 1 / r.d2); const sum = inv.reduce((a, b) => a + b, 0);
  return { idx: Int32Array.from(ranked.map((r) => r.k)), wt: Float32Array.from(inv.map((v) => v / sum)) };
}

/**
 * The frames: one rainfall map every `everyH` hours from the asked start to the
 * last hour fetched, each the rain summed over the `windowH` hours before it
 * (Open-Meteo's hourly value at T is the rain in the hour ENDING at T). Past
 * `maxFrames` the frames are strided, and the stride is reported rather than
 * the span quietly shortened.
 */
export function rainfallFrames(times, nodes, { start, windowH = 24, everyH = 6, maxFrames = 240 } = {}) {
  const n = times.length;
  const prefix = nodes.map((node) => {
    const p = new Float64Array(n + 1);
    for (let t = 0; t < n; t += 1) p[t + 1] = p[t] + (Number.isFinite(node.rain[t]) ? node.rain[t] : 0);
    return p;
  });
  let missing = 0;
  nodes.forEach((node) => node.rain.forEach((v) => { if (!Number.isFinite(v)) missing += 1; }));
  const first = `${start}T00:00`;
  const at = [];
  for (let t = 0; t < n; t += 1) {
    if (times[t] < first || t + 1 < windowH) continue;
    const hour = Number(times[t].slice(11, 13));
    if (hour % everyH === 0) at.push(t);
  }
  const stride = Math.max(1, Math.ceil(at.length / maxFrames));
  const chosen = at.filter((_, k) => k % stride === 0);
  const frames = chosen.map((t) => ({ index: t, time: times[t], from: times[Math.max(0, t - windowH + 1)] }));
  /** The node accumulations for one frame, in mm over the window. */
  const accumulation = (frame) => {
    const out = new Float32Array(nodes.length);
    const lo = Math.max(0, frame.index - windowH + 1);
    for (let k = 0; k < nodes.length; k += 1) out[k] = prefix[k][frame.index + 1] - prefix[k][lo];
    return out;
  };
  /** The node accumulations over hours lo..hi inclusive, in mm. */
  const accumulateRange = (lo, hi) => {
    const out = new Float32Array(nodes.length);
    const a = Math.max(0, lo); const b = Math.min(n - 1, hi);
    if (b < a) return out;
    for (let k = 0; k < nodes.length; k += 1) out[k] = prefix[k][b + 1] - prefix[k][a];
    return out;
  };
  return { frames, accumulation, accumulateRange, stride, windowH, everyH, missing, hours: n };
}

/**
 * The hours that make up one UTC day: Open-Meteo's value at T is the hour
 * ENDING at T, so the day is 01:00 through the next day's 00:00. Null where the
 * series does not reach it.
 */
export function dayHours(times, day) {
  const lo = times.indexOf(`${day}T01:00`);
  if (lo < 0) return null;
  const end = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const next = times.indexOf(`${end}T00:00`);
  return { lo, hi: next >= 0 ? next : Math.min(times.length - 1, lo + 22) };
}

/** Fetch every node's hourly rain over the window, in chunks the URL can hold. */
export async function fetchGfsNodes(bounds, window, { chunk = 100, fetcher = fetch, onProgress = () => {} } = {}) {
  const lattice = gfsLattice(bounds);
  const responses = [];
  for (let k = 0; k < lattice.points.length; k += chunk) {
    const part = lattice.points.slice(k, k + chunk);
    onProgress(Math.min(lattice.points.length, k + chunk), lattice.points.length);
    // eslint-disable-next-line no-await-in-loop
    const res = await fetcher(gfsUrl(part, window));
    if (!res.ok) {
      let reason = "";
      try { reason = (await res.json())?.reason || ""; } catch (e) { /* no body */ }
      throw new Error(`Open-Meteo answered ${res.status}${reason ? `: ${reason}` : ""}`);
    }
    // eslint-disable-next-line no-await-in-loop
    responses.push(await res.json());
  }
  const { times, nodes } = nodesFromResponses(responses);
  if (!nodes.length) throw new Error("no GFS nodes came back for this area");
  const allMissing = nodes.every((node) => node.rain.every((v) => !Number.isFinite(v)));
  if (allMissing) throw new Error("GFS has no data for these dates here");
  return { times, nodes, grid: nodeGrid(nodes), lattice };
}
