/**
 * Extraction at points the user defines — any number of them.
 *
 * The panel offered "Dropped pin", which is one point, and behind it there was
 * no code at all: the select and its Run button had never been wired to
 * anything. One pin is also the wrong unit of work. A transect, a set of
 * boreholes, a station network, the corners of a site — all of them are lists
 * of coordinates somebody already has, usually in a spreadsheet, and the thing
 * they want is every loaded layer read at each of them, side by side, as a
 * table they can take away.
 *
 * So the input is text: one point per line, `lat, lon` with an optional height
 * and an optional label. Paste a column out of a spreadsheet and it works.
 * Commas, tabs, semicolons or runs of spaces all separate, because a
 * coordinate list arrives in whatever the last tool emitted and asking the
 * user to reformat it is asking them to leave.
 *
 * A line that cannot be read is REPORTED with its number rather than skipped:
 * silently dropping row 40 of 200 gives a table that looks complete and is
 * not, which is the same class of fault as writing a null down as zero.
 */

import { rowsToCsv, rowsToGeoJson, downloadText } from "./extraction.js?v=20260821-233e441";

/* ── parsing ────────────────────────────────────────────────────────────── */

const SPLIT = /[\s,;]+/;

/**
 * Text → `{ points, errors }`.
 *
 * A label may lead or trail the numbers ("Station 4: 54.6, -6.7" or
 * "54.6 -6.7 Station 4"); anything non-numeric that is not a coordinate is
 * kept as the label rather than rejected, because a pasted column usually has
 * a name attached to it.
 */
export function parsePoints(text) {
  const points = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    // A leading "name:" is a label, and the colon is not a separator anywhere
    // else, so it can be taken off before the numbers are read.
    let label = null;
    let body = line;
    const colon = line.indexOf(":");
    if (colon > 0 && !/^-?\d/.test(line)) {
      label = line.slice(0, colon).trim();
      body = line.slice(colon + 1).trim();
    }
    const parts = body.split(SPLIT).filter(Boolean);
    const numbers = [];
    const words = [];
    parts.forEach((part) => {
      const value = Number(part);
      if (Number.isFinite(value) && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(part)) numbers.push(value);
      else words.push(part);
    });
    if (numbers.length < 2) {
      errors.push(`line ${index + 1}: "${line}" has no latitude and longitude`);
      return;
    }
    const [lat, lon, z] = numbers;
    if (lat < -90 || lat > 90) {
      errors.push(`line ${index + 1}: latitude ${lat} is outside -90..90`);
      return;
    }
    if (lon < -360 || lon > 360) {
      errors.push(`line ${index + 1}: longitude ${lon} is outside -360..360`);
      return;
    }
    points.push({
      // East-positive beyond 180 is what the viewer carries internally and
      // what someone reads off the cursor readout; the file wants signed.
      lat,
      lon: lon > 180 ? lon - 360 : lon,
      z: Number.isFinite(z) ? z : null,
      label: label || (words.length ? words.join(" ") : null),
    });
  });
  return { points, errors };
}

/** Points → the text form, so a round trip through the box is lossless. */
export function formatPoints(points) {
  return (points || []).map((p) => {
    const head = p.label ? `${p.label}: ` : "";
    const z = Number.isFinite(p.z) ? `, ${p.z}` : "";
    return `${head}${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)}${z}`;
  }).join("\n");
}

/* ── sampling ───────────────────────────────────────────────────────────── */

/** A column name that survives a CSV and a shapefile's 10-character fields. */
export function columnName(layerName) {
  return String(layerName || "layer")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "layer";
}

function readLayer(layer, lat, lon) {
  try {
    const reading = layer.sampler(lat, lon);
    const value = (reading && typeof reading === "object") ? reading.value : reading;
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/**
 * Every layer read at every point. Pure given the layers handed in, so the
 * test can pass analytic samplers and know the answers.
 */
export function extractAtPoints(points, layers, options = {}) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return { ok: false, message: "No points given.", rows: [] };
  const cols = new Map();
  (layers || []).forEach((layer) => {
    let name = columnName(layer.name);
    // Two layers can reduce to the same column; numbering them keeps both
    // rather than letting the second overwrite the first in silence.
    let n = 2;
    while (cols.has(name)) name = `${columnName(layer.name)}_${n++}`;
    cols.set(name, layer);
  });

  // Every row carries the same keys. Giving only the rows that HAVE a height a
  // `z` meant the column set was read off row one — so a list whose first
  // point had no height dropped the heights of all the others, from the table
  // and from the CSV alike, without a word.
  const anyZ = list.some((point) => Number.isFinite(point.z));
  const rows = list.map((point, index) => {
    const row = {
      point: index + 1,
      label: point.label || `P${index + 1}`,
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
    };
    if (anyZ) row.z = Number.isFinite(point.z) ? point.z : null;
    if (options.elevation && typeof options.elevation === "function") {
      const metres = options.elevation(point.lat, point.lon);
      row.elevation_m = Number.isFinite(metres) ? Math.round(metres) : null;
    }
    cols.forEach((layer, name) => { row[name] = readLayer(layer, point.lat, point.lon); });
    return row;
  });

  const filled = rows.filter((row) => Object.keys(row)
    .some((key) => !["point", "label", "lat", "lon", "z"].includes(key) && row[key] != null));
  return {
    ok: true,
    rows,
    columns: [...cols.keys()],
    message: `${rows.length} point${rows.length === 1 ? "" : "s"} sampled across `
      + `${cols.size} layer${cols.size === 1 ? "" : "s"}`
      + (filled.length === rows.length ? "" : `; ${rows.length - filled.length} fell outside every layer`),
  };
}

/* ── the panel ──────────────────────────────────────────────────────────── */

const state = { result: null };

function byId(id) { return document.getElementById(id); }

function sampleableLayers(selectValue) {
  const all = window.GeoIDImportManager?.getSampleableLayers?.() || [];
  if (!selectValue || selectValue === "all") return all;
  return all.filter((l) => String(l.id ?? l.name) === String(selectValue));
}

function fillSourceSelect() {
  const select = byId("extract-source");
  if (!select) return;
  const held = select.value;
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All active layers";
  select.appendChild(all);
  (window.GeoIDImportManager?.getSampleableLayers?.() || []).forEach((layer) => {
    const option = document.createElement("option");
    option.value = layer.id != null ? String(layer.id) : layer.name;
    option.textContent = layer.name;
    select.appendChild(option);
  });
  if (held) select.value = held;
}

function setStatus(text) {
  const node = byId("extract-summary");
  if (node) node.textContent = text;
}

function currentPoints() {
  return parsePoints(byId("extract-points")?.value || "");
}

function appendPoint(lat, lon, label) {
  const box = byId("extract-points");
  if (!box) return;
  const line = `${label ? `${label}: ` : ""}${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  box.value = box.value.trim() ? `${box.value.replace(/\s+$/, "")}\n${line}` : line;
  const { points } = currentPoints();
  setStatus(`${points.length} point${points.length === 1 ? "" : "s"} listed.`);
}

function run() {
  const { points, errors } = currentPoints();
  if (errors.length) {
    setStatus(`${errors.length} line${errors.length === 1 ? "" : "s"} could not be read — ${errors[0]}`);
    if (!points.length) return;
  }
  const layers = sampleableLayers(byId("extract-source")?.value);
  if (!layers.length) {
    setStatus("No sampleable layer is loaded — import a raster first.");
    return;
  }
  const viewer = window.GeoIDViewer;
  const result = extractAtPoints(points, layers, {
    elevation: viewer?.sampleElevationMeters ? (lat, lon) => viewer.sampleElevationMeters(lat, lon) : null,
  });
  state.result = result.ok ? result : null;
  setStatus(result.ok
    ? `${result.message}${errors.length ? ` (${errors.length} line(s) skipped)` : ""}.`
    : result.message);
  renderTable(result);
  setExportsEnabled(result.ok);
}

function setExportsEnabled(on) {
  ["extract-csv", "extract-geojson", "extract-to-layer"].forEach((id) => {
    const button = byId(id);
    if (button) button.disabled = !on;
  });
}

function renderTable(result) {
  const host = byId("extract-table");
  if (!host) return;
  host.innerHTML = "";
  if (!result?.ok || !result.rows.length) return;
  const table = document.createElement("table");
  table.className = "gis-point-table";
  const keys = Object.keys(result.rows[0]);
  const head = document.createElement("tr");
  keys.forEach((key) => {
    const th = document.createElement("th");
    th.textContent = key;
    head.appendChild(th);
  });
  table.appendChild(head);
  result.rows.slice(0, 200).forEach((row) => {
    const tr = document.createElement("tr");
    keys.forEach((key) => {
      const td = document.createElement("td");
      const value = row[key];
      td.textContent = value == null ? "—"
        : (typeof value === "number" ? String(Number(value.toFixed(4))) : String(value));
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  host.appendChild(table);
  if (result.rows.length > 200) {
    const note = document.createElement("div");
    note.className = "gis-metric";
    note.textContent = `Showing the first 200 of ${result.rows.length}; the export has all of them.`;
    host.appendChild(note);
  }
}

function exportAs(kind) {
  if (!state.result?.rows?.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "csv") {
    downloadText(`geoid_points_${stamp}.csv`, rowsToCsv(state.result.rows), "text/csv");
  } else {
    downloadText(`geoid_points_${stamp}.geojson`,
      rowsToGeoJson(state.result.rows), "application/geo+json");
  }
}

/** The sampled points become a vector layer, so every tool can consume them. */
function toLayer() {
  if (!state.result?.rows?.length) return;
  const features = state.result.rows.map((row) => ({
    type: "Feature",
    properties: { ...row },
    geometry: { type: "Point", coordinates: [row.lon, row.lat] },
  }));
  const added = window.GeoIDImportManager?.addDerivedLayer?.({
    name: `extracted_points_${state.result.rows.length}`,
    collection: { type: "FeatureCollection", features },
    features,
    ext: "geojson",
  });
  setStatus(added
    ? `${features.length} points added as a layer — every tool can take it as input now.`
    : "Could not add the layer.");
}

export function init() {
  const box = byId("extract-points");
  if (!box) return;                                   // page without the panel
  fillSourceSelect();
  window.GeoIDImportManager?.onChange?.(fillSourceSelect);
  byId("extract-run")?.addEventListener("click", run);
  byId("extract-csv")?.addEventListener("click", () => exportAs("csv"));
  byId("extract-geojson")?.addEventListener("click", () => exportAs("geojson"));
  byId("extract-to-layer")?.addEventListener("click", toLayer);
  byId("extract-clear")?.addEventListener("click", () => {
    box.value = "";
    setStatus("Points cleared.");
    renderTable(null);
    setExportsEnabled(false);
  });
  byId("extract-add-centre")?.addEventListener("click", () => {
    const centre = window.GeoIDViewer?.getViewCentreLatLon?.();
    if (!centre || !Number.isFinite(centre.lat)) {
      setStatus("The view centre is not on the globe.");
      return;
    }
    let lon = ((centre.lon % 360) + 360) % 360;
    if (lon > 180) lon -= 360;
    appendPoint(centre.lat, lon, null);
  });
  byId("extract-pick")?.addEventListener("click", async () => {
    const pick = window.GeoIDViewer?.pickOnGlobe;
    if (!pick) { setStatus("This viewer cannot pick points."); return; }
    setStatus("Click a point on the globe (Escape to stop)…");
    try {
      const { lat, lon } = await pick();
      let signed = ((lon % 360) + 360) % 360;
      if (signed > 180) signed -= 360;
      appendPoint(lat, signed, null);
    } catch (error) {
      setStatus("Picking stopped.");
    }
  });
  setExportsEnabled(false);
}

if (typeof window !== "undefined") {
  window.GeoIDPointExtract = { parsePoints, formatPoints, extractAtPoints, columnName, init };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
