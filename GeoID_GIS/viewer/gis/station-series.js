/**
 * SAMPLING STATIONS AND THEIR SERIES — what any model on this page records at
 * named points on the ground, in one shape.
 *
 * The landslide forecast is the first model to record here and will not be the
 * last: the point of a station is that it can be asked of ANY run — a factor of
 * safety, a water table, a flood depth — and that the readings come back in a
 * form an analysis page can plot and a spreadsheet can open without being told
 * which model wrote them. So nothing in this file knows what a landslide is.
 *
 *   station  { id, name, lat, lon, colour, source }      signed lon, WGS84
 *   series   { model, credit, times: [ISO], params: [{ key, label, unit }],
 *              stations: [station & { cell, note }],
 *              values: { [stationId]: { [key]: number[] } },
 *              constants: { [stationId]: { [label]: text } } }
 *
 * Pure: no DOM, no globe. The model that fills a series and the page that
 * draws it live elsewhere.
 */

/** One colour per station, far enough apart on a dark globe and a plot alike. */
export const STATION_COLOURS = [
  "#52e4e8", "#ff2bd6", "#ffd36a", "#9df58a", "#ff8b5c", "#8ab6ff",
  "#e6a8ff", "#ff6b8b", "#5cffc6", "#c9c9c9", "#ffb347", "#6fa8ff",
];

export const colourAt = (index) => STATION_COLOURS[((index % STATION_COLOURS.length) + STATION_COLOURS.length) % STATION_COLOURS.length];

/** The most stations a series holds: a plot of fifty lines is a texture. */
export const MAX_STATIONS = 50;

let counter = 0;
/** A station, with a name and a colour if it came without them. */
export function makeStation({ name, lat, lon, source = "added" }, index = 0) {
  counter += 1;
  return {
    id: `st-${Date.now().toString(36)}-${counter}`,
    name: String(name || `S${index + 1}`).slice(0, 40),
    lat: Number(lat), lon: signedLon(Number(lon)),
    colour: colourAt(index), source,
  };
}

/** A longitude in −180..180, whichever convention it arrived in. */
export function signedLon(lon) {
  if (!Number.isFinite(lon)) return NaN;
  let v = ((lon % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return v;
}

export const validStation = (s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon)
  && s.lat >= -90 && s.lat <= 90 && s.lon >= -180 && s.lon <= 180;

/* ── reading stations in ─────────────────────────────────────────────────── */

const NAME_KEYS = ["name", "station", "station_name", "site", "site_name", "label", "id", "code"];
const LAT_KEYS = ["lat", "latitude", "y", "lat_dd", "latitude_dd"];
const LON_KEYS = ["lon", "lng", "long", "longitude", "x", "lon_dd", "longitude_dd"];

function splitLine(line, delim) {
  const out = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Stations from a delimited file: a header naming the latitude and longitude
 * columns (`lat`/`latitude`/`y`, `lon`/`longitude`/`x`) and, if it has one, a
 * name column. Rows without a finite coordinate are dropped and COUNTED —
 * `Number("")` is zero, and a blank row read as 0°N 0°E is a station in the
 * Gulf of Guinea.
 */
export function parseStationsCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, message: "The file has no rows under a header." };
  const delim = [",", ";", "\t"].map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const find = (keys) => keys.map((k) => head.indexOf(k)).find((i) => i >= 0) ?? -1;
  const iLat = find(LAT_KEYS); const iLon = find(LON_KEYS); const iName = find(NAME_KEYS);
  if (iLat < 0 || iLon < 0) return { ok: false, message: `No latitude and longitude columns in "${lines[0].slice(0, 80)}" — name them lat and lon.` };
  const stations = []; let dropped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delim);
    const lat = cells[iLat] === "" ? NaN : Number(cells[iLat]);
    const lon = cells[iLon] === "" ? NaN : Number(cells[iLon]);
    const s = { name: iName >= 0 ? cells[iName] : "", lat, lon: signedLon(lon) };
    if (!validStation(s)) { dropped += 1; continue; }
    stations.push(s);
  }
  return { ok: stations.length > 0, stations, dropped, message: stations.length ? "" : "No row had a usable coordinate." };
}

/** Stations from a layer's point features, named from the feature where it says. */
export function stationsFromFeatures(features, { prefix = "P" } = {}) {
  const out = [];
  for (const f of features || []) {
    const g = f?.geometry;
    const points = g?.type === "Point" ? [g.coordinates] : g?.type === "MultiPoint" ? g.coordinates : [];
    const p = f?.properties || {};
    const named = NAME_KEYS.map((k) => p[k] ?? p[k.toUpperCase()] ?? p[k[0].toUpperCase() + k.slice(1)]).find((v) => v !== undefined && v !== null && String(v).trim());
    points.forEach((c, k) => {
      const s = { name: named ? `${named}${points.length > 1 ? ` ${k + 1}` : ""}` : `${prefix}${out.length + 1}`, lat: Number(c?.[1]), lon: signedLon(Number(c?.[0])) };
      if (validStation(s)) out.push(s);
    });
  }
  return out;
}

/** A name nobody else in the list has, by appending a count. */
export function uniqueName(name, taken) {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let k = 2; k < 1000; k += 1) if (!set.has(`${name} (${k})`)) return `${name} (${k})`;
  return `${name} (${Date.now()})`;
}

/* ── writing a series out ─────────────────────────────────────────────────── */

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(+v.toPrecision(6)) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = (p) => (p.unit ? `${p.key}_${p.unit.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}` : p.key);

/**
 * A series as ONE TIDY TABLE: a row per station per time, a column per
 * parameter, the unit in the column's name, then the station's constants
 * repeated on every row so the file stands on its own. Long by station and
 * time because that is what every analysis tool groups by; wide by parameter
 * because a parameter is what a reader plots against time. A station the model
 * could not read (outside the area, no ground) still gets its rows, empty, and
 * a note — dropping it would make a missing reading look like no station.
 */
export function seriesCsv(series) {
  const params = series.params || [];
  const constKeys = [];
  for (const st of series.stations || []) Object.keys(series.constants?.[st.id] || {}).forEach((k) => { if (!constKeys.includes(k)) constKeys.push(k); });
  const cols = ["model", "station", "lat", "lon", "time", ...params.map(header), ...constKeys, "note"];
  const rows = [cols.join(",")];
  for (const st of series.stations || []) {
    const vals = series.values?.[st.id] || {};
    const c = series.constants?.[st.id] || {};
    (series.times || []).forEach((t, k) => {
      rows.push([series.model, st.name, st.lat, st.lon, t, ...params.map((p) => vals[p.key]?.[k]), ...constKeys.map((key) => c[key]), st.note || ""]
        .map(csvCell).join(","));
    });
  }
  return `${rows.join("\n")}\n`;
}

/** What each station's constants are (slope, material, …) as a second small table. */
export function constantsCsv(series) {
  const keys = [];
  for (const st of series.stations || []) Object.keys(series.constants?.[st.id] || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  const rows = [["station", "lat", "lon", ...keys].map(csvCell).join(",")];
  for (const st of series.stations || []) {
    const c = series.constants?.[st.id] || {};
    rows.push([st.name, st.lat, st.lon, ...keys.map((k) => c[k])].map(csvCell).join(","));
  }
  return `${rows.join("\n")}\n`;
}

/** The lowest, highest and when, per station, for one parameter. */
export function summarise(series, key) {
  return (series.stations || []).map((st) => {
    const v = series.values?.[st.id]?.[key] || [];
    let lo = Infinity; let hi = -Infinity; let at = -1;
    v.forEach((x, k) => { if (!Number.isFinite(x)) return; if (x < lo) { lo = x; at = k; } if (x > hi) hi = x; });
    return { id: st.id, name: st.name, min: Number.isFinite(lo) ? lo : NaN, max: Number.isFinite(hi) ? hi : NaN, minAt: at >= 0 ? series.times[at] : null };
  });
}

/** A file name from a model and a date span, safe on every filesystem. */
export function seriesFileName(series, suffix = "stations") {
  const t = series.times || [];
  const span = t.length ? `${String(t[0]).slice(0, 10)}_${String(t[t.length - 1]).slice(0, 10)}` : "series";
  return `${String(series.model || "model").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}_${suffix}_${span}.csv`;
}
