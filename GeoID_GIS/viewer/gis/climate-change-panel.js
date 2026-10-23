/**
 * Earth Observation ▸ Atmosphere ▸ "Climate change over time" — the archive
 * read as a change against a normal, and played.
 *
 * One composite of the same window (a season, a month, the whole year) for
 * every year asked for, fetched from the Earth Engine service with the same
 * `fetchScene` every other GEE reader uses and decoded back to the dataset's
 * own numbers by the same palette inversion. `climate-change.js` turns the
 * stack into anomalies against a chosen baseline, a per-pixel trend (Sen's
 * slope, Mann–Kendall) and an area series; this module fetches, draws and
 * plays:
 *
 *  - the ANOMALY of each year, draped over the box and played through the one
 *    time-lapse bar, on a diverging palette fixed across the sequence, so a
 *    colour means the same departure in 1985 and in 2024;
 *  - the TREND per decade as a layer of its own, a slope that is not
 *    significant at p < 0.05 drawn at a third of the alpha;
 *  - the area-mean SERIES in the card, with its own Sen's slope.
 *
 * Every year is one billed render, so the count is said before anything is
 * spent and a long request is a second press. Both layers answer a click
 * with the numbers under it — the drawn colour is the departure, the card is
 * the value.
 */

import {
  CLIMATE_VARS, WINDOWS, windowOf, yearsFor, rampMaxForDays, decodeScene, alignGrid, baselineMean,
  anomalies, symmetricRange, senMannKendall, pixelTrends, areaSeries, frameRGBA, signed, pixelOf,
  seriesCsv,
} from "./climate-change.js?v=20261023-26ffafb";
import { refreshPolygonOptions, resolvePolygonExtent, signedLon } from "./extent-picker.js?v=20261023-26ffafb";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20261023-26ffafb";
import { downloadText } from "./extraction.js?v=20261023-26ffafb";

const search = new URL(import.meta.url).search;
const RENDER_BUDGET = 30;
const ANOMALY_NAME = "Climate anomaly — Earth Engine";
const TREND_NAME = "Climate trend per decade — Earth Engine";
const KM_PER_DEG = 111.195;
const byId = (id) => document.getElementById(id);

let three = null;
let busy = false;
let armedFor = "";          // the request a second press would spend
let study = null;           // the last stack, for the trend, the CSV and a click
let trend = null;           // { slope, p, range }
let playing = false;

function say(message) {
  const node = byId("climate-status");
  if (node) node.textContent = message;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the rendered image could not be read"));
    image.src = url;
  });
}

/** A box `km` across about the middle of the view, signed degrees. */
function boxAboutView(km) {
  const centre = window.GeoIDViewer?.getViewCentreLatLon?.();
  if (!centre || !Number.isFinite(centre.lat)) return null;
  const lat = centre.lat; const lon = signedLon(centre.lon);
  const dLat = km / 2 / KM_PER_DEG;
  const dLon = km / 2 / (KM_PER_DEG * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { south: Math.max(-85, lat - dLat), north: Math.min(85, lat + dLat), west: lon - dLon, east: lon + dLon };
}

function readRequest() {
  const variable = byId("climate-variable")?.value || "lst";
  const spec = CLIMATE_VARS[variable];
  const windowId = byId("climate-window")?.value || spec.defaultWindow;
  const fromYear = Number(byId("climate-from")?.value) || spec.firstYear;
  const toYear = Number(byId("climate-to")?.value) || new Date().getUTCFullYear();
  const baseFrom = Number(byId("climate-base-from")?.value) || fromYear;
  const baseTo = Number(byId("climate-base-to")?.value) || baseFrom + 9;
  const dimensions = Number(byId("climate-res")?.value) || 384;
  const mode = byId("climate-extent")?.value || "view";
  let box;
  if (mode === "view") {
    box = boxAboutView(Math.max(50, Math.min(4000, Number(byId("climate-width")?.value) || 600)));
    if (!box) return { error: "The globe is not ready yet." };
  } else {
    const got = resolvePolygonExtent(mode);
    if (!got || got.error) return { error: got?.error || "Draw an area on the globe first — the Draw tool is active." };
    box = got;
  }
  if (box.east - box.west > 60 || box.north - box.south > 40) {
    return { error: "That area is wider than 60° × 40° — a regional change, not a hemisphere, is what one render per year can resolve. Choose a smaller box." };
  }
  if (spec.maxLat && (box.north > spec.maxLat || box.south < -spec.maxLat)) {
    return { error: `${spec.short} (CHIRPS) covers ${spec.maxLat}°S to ${spec.maxLat}°N only; move the box inside that band.` };
  }
  const years = yearsFor(variable, fromYear, toYear, windowId);
  if (years.length < 4) return { error: `Fewer than four complete ${windowLabel(windowId)} windows from ${fromYear} to ${toYear} — a change needs years to show in.` };
  return { variable, spec, windowId, years, baseFrom, baseTo, dimensions, box };
}

const windowLabel = (id) => WINDOWS.find((w) => w.id === id)?.label || id;
const requestKey = (r) => `${r.variable}|${r.windowId}|${r.years[0]}-${r.years[r.years.length - 1]}|${r.dimensions}|${[r.box.west, r.box.south, r.box.east, r.box.north].map((v) => v.toFixed(3)).join(",")}`;

/** One year's composite, decoded: `{ values, width, height, bounds, clipped }`. */
async function fetchYear(r, year, gee) {
  const w = windowOf(year, r.windowId);
  const scene = await gee.fetchScene({
    dataset: r.spec.dataset, bounds: r.box, from: w.from, to: w.to, dimensions: r.dimensions,
    max: r.spec.reducer === "sum" ? rampMaxForDays(w.days) : null,
  });
  if (!scene?.imageUrl) throw new Error(`Earth Engine returned no picture for ${year}`);
  const image = await loadImage(scene.imageUrl);
  const width = image.naturalWidth; const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  const values = decodeScene(data, width, height, { palette: scene.palette, legend: scene.legend });
  // A value pinned to an end of the ramp reads as that end whatever the ground
  // did, so it is counted and said rather than quietly averaged into a trend.
  const lo = Number(scene.legend?.min); const hi = Number(scene.legend?.max);
  const span = hi - lo;
  let clipped = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v >= hi - span * 0.004 || (r.spec.reducer !== "sum" && v <= lo + span * 0.004)) clipped += 1;
  }
  const b = scene.bounds || {};
  return {
    year, values, width, height, clipped,
    bounds: { west: b.minX ?? r.box.west, south: b.minY ?? r.box.south, east: b.maxX ?? r.box.east, north: b.maxY ?? r.box.north },
  };
}

async function fetchAll(r) {
  const gee = await import(`./gee.js${search}`);
  const out = new Array(r.years.length);
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < r.years.length) {
      const k = next; next += 1;
      // eslint-disable-next-line no-await-in-loop
      out[k] = await fetchYear(r, r.years[k], gee);
      done += 1;
      say(`Rendering ${r.spec.short} for each year… ${done} of ${r.years.length}.`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, r.years.length) }, worker));
  return out;
}

function canvasOf(rgba, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

const toMinMax = (b) => ({ minX: b.west, minY: b.south, maxX: b.east, maxY: b.north });

/** Drape a picture over a box and register it as a layer: `{ mesh, layer }`. */
async function drapeLayer(name, canvas, bounds, legend, info) {
  const gee = await import(`./gee.js${search}`);
  if (!three) three = await import("../vendor/three.module.js");
  const mesh = await gee.drape(canvas.toDataURL(), toMinMax(bounds));
  if (!mesh) throw new Error("the globe is not ready yet");
  const im = window.GeoIDImportManager;
  (im?.getLayers?.() || []).filter((l) => l.name === name).forEach((l) => im.removeLayer(l.id));
  const layer = im?.addDerivedLayer?.(name, {
    object3D: mesh, bounds: toMinMax(bounds), georeferenced: true, legendInfo: legend,
    home: "weather", info,
  }, "gee");
  /**
   * Registered for its row and its key, then PARENTED TO THE GLOBE: `drape`
   * bakes the globe's half-turn into its vertices, and the imported group
   * carries the spin another way — the pair gee.js and the cyclone estimate
   * both do, for the same reason.
   */
  if (layer) {
    mesh.userData.geoidLayer = true;
    window.GeoIDViewer?.globe?.add?.(mesh);
  }
  return { mesh, layer };
}

function retexture(mesh, canvas) {
  const next = new three.CanvasTexture(canvas);
  next.colorSpace = three.SRGBColorSpace;
  mesh.traverse?.((n) => {
    if (!n.material || !("map" in n.material)) return;
    n.material.map?.dispose?.();
    n.material.map = next;
    n.material.needsUpdate = true;
  });
}

function disposeMesh(mesh) {
  mesh?.parent?.remove(mesh);
  mesh?.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.map?.dispose?.(); n.material?.dispose?.(); });
}

function legendFor(spec, range, label, unit) {
  return {
    palette: spec.anomalyPalette, min: -range, max: range, unit,
    label, classed: false, categorical: false,
  };
}

/* ── the run ───────────────────────────────────────────────────────────── */

export async function run({ confirmed = false } = {}) {
  if (busy) return null;
  const r = readRequest();
  if (r.error) { say(r.error); return null; }
  const key = requestKey(r);
  if (r.years.length > RENDER_BUDGET && !confirmed && armedFor !== key) {
    armedFor = key;
    const button = byId("climate-run");
    if (button) button.textContent = `Fetch — spend ${r.years.length} renders`;
    say(`${r.years.length} years is ${r.years.length} billed Earth Engine renders. Press again to spend them, or shorten the span.`);
    return null;
  }
  armedFor = "";
  busy = true;
  const button = byId("climate-run");
  if (button) { button.disabled = true; button.textContent = "Fetch and animate"; }
  try {
    const got = await fetchAll(r);
    const w0 = got[0].width; const h0 = got[0].height;
    const frames = got.map((g) => alignGrid(g.values, g.width, g.height, w0, h0));
    const bounds = got[0].bounds;
    let baseIdx = r.years.map((y, k) => (y >= r.baseFrom && y <= r.baseTo ? k : -1)).filter((k) => k >= 0);
    let baseNote = `baseline ${r.baseFrom}–${r.baseTo}`;
    if (baseIdx.length < 3) {
      const n = Math.max(3, Math.floor(r.years.length / 3));
      baseIdx = r.years.slice(0, n).map((_, k) => k);
      baseNote = `baseline the first ${n} years (${r.years[0]}–${r.years[n - 1]}) — the asked baseline held fewer than three`;
    }
    const base = baselineMean(frames, baseIdx);
    const an = anomalies(frames, base);
    const range = symmetricRange(an);
    const series = areaSeries(frames, w0, h0, bounds);
    const baseMean = baseIdx.reduce((s, k) => s + (Number.isFinite(series.means[k]) ? series.means[k] : 0), 0)
      / Math.max(1, baseIdx.filter((k) => Number.isFinite(series.means[k])).length);
    const seriesTrend = senMannKendall(series.means, r.years);
    const clipped = got.reduce((s, g) => s + g.clipped, 0);
    study = {
      ...r, frames, anomalies: an, base, range, width: w0, height: h0, bounds, series, baseMean,
      seriesTrend, baseIdx, baseNote, clipped,
    };
    trend = null;
    drawSeries();
    await play();
    const unit = r.spec.unit;
    const tr = Number.isFinite(seriesTrend.slope)
      ? `area trend ${signed(seriesTrend.slope * 10, unit)} a decade (Mann–Kendall p ${seriesTrend.p.toFixed(3)})`
      : "no trend can be fitted";
    say(`${r.years.length} ${windowLabel(r.windowId)} composites, ${r.years[0]}–${r.years[r.years.length - 1]}, ${w0}×${h0} px; ${baseNote}; ${tr}.`
      + (series.common ? "" : " Fewer than a tenth of the pixels have a value every year, so each year is averaged over its own pixels.")
      + (clipped ? ` ${clipped.toLocaleString()} pixel-years sit at an end of the service's colour ramp and read as that end — a shorter window keeps them inside it.` : "")
      + " Building the trend map…");
    await buildTrend();
    return study;
  } catch (error) {
    say(`Could not build the sequence: ${error.message}`);
    return null;
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

async function play() {
  const s = study;
  if (!s) return;
  if (playing) { stopPlayer(); playing = false; }
  const unit = s.spec.unit;
  const frameCanvas = (k) => canvasOf(frameRGBA(s.anomalies[k], s.spec.anomalyPalette, s.range), s.width, s.height);
  const last = s.years.length - 1;
  const legend = legendFor(s.spec, s.range,
    `${s.spec.short} anomaly — ${windowLabel(s.windowId)}, against the ${s.baseNote.replace(/^baseline /, "")}`, unit || null);
  const { mesh, layer } = await drapeLayer(ANOMALY_NAME, frameCanvas(last), s.bounds, legend, {
    rows: [["What", `${s.spec.label}, ${windowLabel(s.windowId)} composite each year, less the per-pixel mean of the baseline years`],
      ["Colour", s.spec.paletteSays]],
  });
  if (layer) layer.climateStudy = true;
  const epochs = s.years.map((year, k) => ({
    date: String(year), label: String(year), dataset: null, year, k,
    from: windowOf(year, s.windowId).from, to: windowOf(year, s.windowId).to,
    tick: year % 5 === 0,
  }));
  playing = true;
  await startPlayer({
    bounds: toMinMax(s.bounds),
    epochs,
    source: "none",
    interval: 900,
    startAt: last,
    noteFor: (e) => {
      const m = s.series.means[e.k];
      return Number.isFinite(m) && Number.isFinite(s.baseMean) ? `${signed(m - s.baseMean, unit)} area mean` : "no area mean";
    },
    noteTitle: (e) => `${s.spec.short}, ${windowLabel(s.windowId)} ${e.year}, against the ${s.baseNote}`,
    onStatus: () => {},
    owns: () => [(window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === layer?.id)],
    onShow: (index) => {
      retexture(mesh, frameCanvas(index));
      s.shown = index;
      drawSeries();
    },
    onStop: () => {
      playing = false;
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
      disposeMesh(mesh);
      s.shown = null;
      drawSeries();
    },
  });
}

/** The trend, computed in slices so the page keeps drawing, then draped. */
async function buildTrend() {
  const s = study;
  if (!s) return;
  const n = s.width * s.height;
  const out = { slope: new Float32Array(n).fill(NaN), p: new Float32Array(n).fill(NaN), n: new Uint8Array(n) };
  const slice = Math.max(500, Math.floor(200000 / Math.max(1, s.years.length)));
  for (let from = 0; from < n; from += slice) {
    pixelTrends(s.frames, s.years, { from, to: from + slice, out });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (study !== s) return;
  }
  const range = symmetricRange([out.slope]);
  const fade = new Uint8Array(n);
  let significant = 0; let valid = 0;
  for (let p = 0; p < n; p += 1) {
    if (!Number.isFinite(out.slope[p])) continue;
    valid += 1;
    if (out.p[p] < 0.05) significant += 1; else fade[p] = 1;
  }
  trend = { ...out, range, significant, valid };
  const unit = s.spec.unit;
  const canvas = canvasOf(frameRGBA(out.slope, s.spec.anomalyPalette, range, { fade }), s.width, s.height);
  const legend = legendFor(s.spec, range, `${s.spec.short} trend per decade, ${s.years[0]}–${s.years[s.years.length - 1]} (${windowLabel(s.windowId)})`,
    unit ? `${unit}/decade` : "per decade");
  const held = await drapeLayer(TREND_NAME, canvas, s.bounds, legend, {
    rows: [["Method", "Sen's slope over every pair of years; Mann–Kendall test, pixels with p ≥ 0.05 drawn faint"],
      ["Significant", `${significant.toLocaleString()} of ${valid.toLocaleString()} pixels (${valid ? Math.round((100 * significant) / valid) : 0}%)`]],
  });
  if (held.layer) held.layer.climateStudy = true;
  const node = byId("climate-status");
  if (node) {
    node.textContent = node.textContent.replace(/ Building the trend map…$/, "")
      + ` Trend map: ${significant.toLocaleString()} of ${valid.toLocaleString()} pixels significant at p < 0.05 (the rest drawn faint).`;
  }
}

/* ── the series plot ──────────────────────────────────────────────────── */

function drawSeries() {
  const canvas = byId("climate-series");
  const s = study;
  if (!canvas) return;
  canvas.hidden = !s;
  if (!s) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300; const cssH = 130;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const vals = s.series.means.map((m) => m - s.baseMean);
  const finite = vals.filter(Number.isFinite);
  if (!finite.length) return;
  const top = Math.max(...finite.map(Math.abs)) || 1;
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const W = cssW - pad.l - pad.r; const H = cssH - pad.t - pad.b;
  const x = (k) => pad.l + (s.years.length === 1 ? W / 2 : (k / (s.years.length - 1)) * W);
  const y = (v) => pad.t + H / 2 - (v / top) * (H / 2);
  const ink = getComputedStyle(canvas).color || "#ccc";
  ctx.strokeStyle = ink; ctx.globalAlpha = 0.35; ctx.beginPath();
  ctx.moveTo(pad.l, y(0)); ctx.lineTo(pad.l + W, y(0)); ctx.stroke(); ctx.globalAlpha = 1;
  const bw = Math.max(1, W / s.years.length - 1);
  const [neg, pos] = [s.spec.anomalyPalette[0], s.spec.anomalyPalette[s.spec.anomalyPalette.length - 1]];
  vals.forEach((v, k) => {
    if (!Number.isFinite(v)) return;
    ctx.fillStyle = `#${v < 0 ? neg : pos}`;
    ctx.globalAlpha = s.shown === k ? 1 : 0.7;
    const y0 = y(0); const y1 = y(v);
    ctx.fillRect(x(k) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
  });
  ctx.globalAlpha = 1;
  const t = s.seriesTrend;
  if (Number.isFinite(t.slope)) {
    const mid = (s.years[0] + s.years[s.years.length - 1]) / 2;
    const medianAnom = [...finite].sort((a, b) => a - b)[Math.floor(finite.length / 2)];
    const at = (k) => medianAnom + t.slope * (s.years[k] - mid);
    ctx.strokeStyle = ink; ctx.setLineDash([4, 3]); ctx.beginPath();
    ctx.moveTo(x(0), y(at(0))); ctx.lineTo(x(s.years.length - 1), y(at(s.years.length - 1))); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = ink; ctx.font = "10px 'Exo 2', sans-serif";
  ctx.fillText(signed(top, s.spec.unit), 2, pad.t + 8);
  ctx.fillText(signed(-top, s.spec.unit), 2, pad.t + H);
  ctx.fillText(String(s.years[0]), pad.l, cssH - 4);
  const lastLabel = String(s.years[s.years.length - 1]);
  ctx.fillText(lastLabel, pad.l + W - ctx.measureText(lastLabel).width, cssH - 4);
}

function exportCsv() {
  const s = study;
  if (!s) { say("Fetch a sequence first."); return; }
  const text = seriesCsv(s.years, s.series.means, s.baseMean, s.spec.unit,
    `${s.spec.label}, ${windowLabel(s.windowId)}, area mean over ${[s.bounds.west, s.bounds.south, s.bounds.east, s.bounds.north].map((v) => v.toFixed(3)).join(",")}, ${s.baseNote}`);
  const name = `climate_${s.variable}_${s.windowId}_${s.years[0]}-${s.years[s.years.length - 1]}.csv`;
  // Through the one export door: it files into the open project as well, and
  // it is where saving is gated.
  downloadText(name, text, "text/csv");
}

/* ── a click on either sheet ──────────────────────────────────────────── */

function shownLayer(name) {
  return (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === name && l.visible !== false && l.object3D?.visible !== false);
}

/** Synchronously true when the click is on a climate sheet; the card follows. */
export function probeAt(lat, lon) {
  const s = study;
  if (!s || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const anomalyOn = shownLayer(ANOMALY_NAME);
  const trendOn = shownLayer(TREND_NAME);
  if (!anomalyOn && !trendOn) return false;
  const p = pixelOf(lat, lon, s.bounds, s.width, s.height);
  if (p < 0) return false;
  const unit = s.spec.unit;
  const values = s.years.map((_, k) => s.frames[k][p]);
  const t = senMannKendall(values, s.years);
  const k = Number.isInteger(s.shown) ? s.shown : s.years.length - 1;
  const rows = [
    [`${s.years[k]}`, Number.isFinite(values[k]) ? `${signed(s.anomalies[k][p], unit)} against the baseline (value ${values[k].toFixed(3)}${unit ? ` ${unit}` : ""})` : "no value that year"],
    ["Baseline mean", Number.isFinite(s.base[p]) ? `${s.base[p].toFixed(3)}${unit ? ` ${unit}` : ""} (${s.baseNote.replace(/^baseline /, "")})` : "no baseline here"],
    ["Trend", Number.isFinite(t.slope)
      ? `${signed(t.slope * 10, unit)} a decade — Mann–Kendall p ${t.p.toFixed(3)}${t.p < 0.05 ? ", significant" : ", not significant"} (${t.n} years)`
      : "fewer than four years with a value"],
  ];
  window.GeoIDViewer?.showFeatureCard?.({
    source_layer: anomalyOn ? ANOMALY_NAME : TREND_NAME,
    soil: true,
    type: `${s.spec.short} — ${windowLabel(s.windowId)}`,
    rock_type: Number.isFinite(t.slope) ? `${signed(t.slope * 10, unit)} per decade` : "No trend here",
    lithology: null, name: null,
    description: `${s.years[0]}–${s.years[s.years.length - 1]}, one Earth Engine composite a year`,
    extra_rows: rows,
    origin: `Earth Engine · ${s.spec.dataset}`,
    rows: [["Note", "A composite pixel, decoded from the service's rendering by inverting its palette — a few percent off the band itself."]],
  }, lat, lon);
  return true;
}

/* ── the card ─────────────────────────────────────────────────────────── */

function buildCard() {
  const host = byId("atmosphere-weather-host");
  if (!host || byId("climate-card")) return Boolean(host);
  const card = document.createElement("details");
  card.className = "gis-tool-section";
  card.id = "climate-card";
  const year = new Date().getUTCFullYear();
  card.innerHTML = `
    <summary>Climate change over time</summary>
    <div class="gis-tool-body">
      <p class="tool-copy">One Earth Engine composite a year, read as a departure from a baseline and
        played; a trend per decade beside it, with its significance.</p>
      <label class="row"><span>Variable</span>
        <select id="climate-variable" class="input">
          ${Object.entries(CLIMATE_VARS).map(([id, v]) => `<option value="${id}">${v.label}</option>`).join("")}
        </select>
      </label>
      <label class="row"><span>Window</span>
        <select id="climate-window" class="input">
          ${WINDOWS.map((w) => `<option value="${w.id}">${w.label}</option>`).join("")}
        </select>
      </label>
      <div class="row"><label for="climate-from">From</label>
        <input id="climate-from" class="input" type="number" min="1981" max="${year}" step="1" value="2001"></div>
      <div class="row"><label for="climate-to">To</label>
        <input id="climate-to" class="input" type="number" min="1981" max="${year}" step="1" value="${year}"></div>
      <div class="row"><label for="climate-base-from">Baseline from</label>
        <input id="climate-base-from" class="input" type="number" min="1981" max="${year}" step="1" value="2001"></div>
      <div class="row"><label for="climate-base-to">Baseline to</label>
        <input id="climate-base-to" class="input" type="number" min="1981" max="${year}" step="1" value="2010"></div>
      <label class="row"><span>Extent</span>
        <select id="climate-extent" class="input">
          <option value="view" selected>A box about the middle of the view</option>
          <option value="drawn">An area drawn by hand</option>
        </select>
      </label>
      <div class="row" id="climate-width-row"><label for="climate-width">Width (km)</label>
        <input id="climate-width" class="input" type="number" min="50" max="4000" step="50" value="600"></div>
      <label class="row"><span>Pixels across</span>
        <select id="climate-res" class="input">
          <option value="256">256</option><option value="384" selected>384</option><option value="512">512</option>
        </select>
      </label>
      <div class="gis-btn-row">
        <button id="climate-run" class="button primary" type="button">Fetch and animate</button>
        <button id="climate-csv" class="button secondary" type="button">Series CSV</button>
      </div>
      <canvas id="climate-series" class="climate-series" hidden style="width:100%;display:block;color:var(--skin-data, #52e4e8)"></canvas>
      <div id="climate-status" class="gis-metric">Every year is one billed render; the count is said before anything is spent.</div>
    </div>`;
  host.appendChild(card);
  const select = byId("climate-extent");
  const syncExtent = () => {
    refreshPolygonOptions(select, "view", { allLayers: true });
    byId("climate-width-row").hidden = select.value !== "view";
  };
  syncExtent();
  window.GeoIDImportManager?.onChange?.(syncExtent);
  select.addEventListener("change", () => { byId("climate-width-row").hidden = select.value !== "view"; });
  // A variable sets its own sensible defaults: its first year, and a window
  // that keeps a summed rainfall composite inside the service's ramp.
  const variable = byId("climate-variable");
  const applyDefaults = () => {
    const spec = CLIMATE_VARS[variable.value];
    byId("climate-window").value = spec.defaultWindow;
    byId("climate-from").value = String(spec.firstYear);
    byId("climate-base-from").value = String(spec.firstYear);
    byId("climate-base-to").value = String(spec.firstYear + 9);
  };
  applyDefaults();
  variable.addEventListener("change", () => { applyDefaults(); armedFor = ""; byId("climate-run").textContent = "Fetch and animate"; });
  card.querySelectorAll("input, select").forEach((el) => el.addEventListener("change", () => {
    if (!armedFor) return;
    armedFor = "";
    byId("climate-run").textContent = "Fetch and animate";
  }));
  byId("climate-run").addEventListener("click", () => run());
  byId("climate-csv").addEventListener("click", exportCsv);
  return true;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  let tries = 0;
  const attempt = () => {
    if (buildCard() || (tries += 1) > 60) return;
    setTimeout(attempt, 500);
  };
  attempt();
  window.GeoIDClimateChange = {
    run, probeAt,
    study: () => study,
    trend: () => trend,
  };
}
