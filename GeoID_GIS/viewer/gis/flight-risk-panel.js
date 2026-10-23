/**
 * Hazards ▸ Exposure ▸ Flight route risk — a flight's route on the globe, the
 * hazards along it integrated into one number, and the profile of where that
 * number comes from.
 *
 * The maths is `route-risk.js`; this module only GATHERS and DRAWS:
 *
 *   route       two airports from `airports.js` (a great circle), or a live
 *               aircraft from the Aircraft layer — to an airport if one is
 *               given, else carried along its own track for three hours
 *               (the open feeds do not say where a flight is going);
 *   cyclones    every active storm's forecast track from GDACS, through
 *               GeoIDCycloneForecast (whose layer draws the cones);
 *   GFS         jet-level winds and temperatures, CAPE and the weather code
 *               along the route in one Open-Meteo request;
 *   ash         the last ash model Atlas ran, if any (GeoIDAtlasAsh).
 *
 * Answers in the card (the profile and its sentences), on the globe (the
 * route coloured by each 100 km segment's risk) and to Atlas (`assess`).
 */

import { buildVectorLayerResult } from "./vector-render.js?v=20261024-256a6da";
import {
  greatCircle, deadReckonPath, destination, flightProfile, assessRoute, describeRisk, routeWeatherUrl,
  readRouteWeather, weatherSampleIndices, riskDensity, HAZARDS, HAZARD_LABELS, CAPACITY,
} from "./route-risk.js?v=20261024-256a6da";
import { AIRPORTS, findAirport, airportLabel } from "./airports.js?v=20261024-256a6da";
import { coneRadiusKm } from "./cyclone-cone.js?v=20261024-256a6da";
import { concentrationGrid } from "./ash-plume.js?v=20261024-256a6da";
import {
  chartColors, prepareCanvas, plotRect, drawAxes, niceTicks, formatNumber,
} from "./chart-core.js?v=20261024-256a6da";

const byId = (id) => document.getElementById(id);
const manager = () => window.GeoIDImportManager;
const LAYER_PREFIX = "Flight route risk";
const DAY = 86400e3;

const HAZARD_COLOURS = {
  cyclone: "#ff5a5f",
  turbulence: "#7aa7ff",
  convection: "#ffd23f",
  ash: "#b58cff",
};

/** Each 100 km segment's class, by its equivalent km at the limit. */
const SEGMENT_CLASSES = [
  { value: "clear", label: "Clear (< 0.5)", colour: "#5ad17a", max: 0.5 },
  { value: "low", label: "Low (0.5–5)", colour: "#c8e65a", max: 5 },
  { value: "moderate", label: "Moderate (5–25)", colour: "#ffd23f", max: 25 },
  { value: "high", label: "High (25–60)", colour: "#ff8c3a", max: 60 },
  { value: "severe", label: "Severe (≥ 60)", colour: "#ff3b4e", max: Infinity },
];

let layer = null;
let last = null;   // { result, samples, from, to, label, notes }

function say(text) {
  const n = byId("flight-risk-status");
  if (n) n.textContent = text || "";
}

const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * The line as drawn: every 25 km sample pair cut into ~4 km pieces. A draped
 * line is straight between its vertices, and a 25 km chord sinks under the
 * curved ground in its middle — the route came out dashed (measured).
 */
function densify(coords, pieces = 6) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const [x0, y0] = coords[i - 1];
    let [x1] = coords[i];
    const [, y1] = coords[i];
    if (x1 - x0 > 180) x1 -= 360;
    if (x1 - x0 < -180) x1 += 360;
    for (let k = 1; k <= pieces; k += 1) out.push([wrap(x0 + ((x1 - x0) * k) / pieces), y0 + ((y1 - y0) * k) / pieces]);
  }
  return out;
}

const RAD = Math.PI / 180;
const bearingOf = (a, b) => {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return Math.atan2(y, x) / RAD;
};

/**
 * A stretch of track as a corridor `halfKm` either side, one closed
 * [lon, lat] ring kept inside ±180 (null when it cannot be without a cut).
 * Drawn as an area because a draped LINE loses on depth to the displaced
 * ocean and came out dashed (foundations.md, "Draping onto the globe"); the
 * cone beside it is an area and draws whole.
 */
function corridor(pts, halfKm = 35) {
  const left = [];
  const right = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const h = bearingOf(a, b);
    const l = destination(p.lat, p.lon, h - 90, halfKm);
    const r = destination(p.lat, p.lon, h + 90, halfKm);
    left.push([l.lon, l.lat]);
    right.push([r.lon, r.lat]);
  });
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  const ref = ring[0][0];
  const un = ring.map(([x, y]) => {
    let u = x;
    while (u - ref > 180) u -= 360;
    while (u - ref < -180) u += 360;
    return [u, y];
  });
  const lo = Math.min(...un.map((c) => c[0]));
  const hi = Math.max(...un.map((c) => c[0]));
  if (lo >= -180 && hi <= 180) return un;
  if (hi > 180 && lo - 360 >= -180) return un.map(([x, y]) => [x - 360, y]);
  if (lo < -180 && hi + 360 <= 180) return un.map(([x, y]) => [x + 360, y]);
  return null;
}

/** A line of [lon, lat] split where it crosses the antimeridian. */
function splitLine(coords) {
  const parts = [[coords[0]]];
  for (let i = 1; i < coords.length; i += 1) {
    const [x0] = coords[i - 1];
    const [x1] = coords[i];
    if (Math.abs(x1 - x0) > 180) parts.push([]);
    parts.at(-1).push(coords[i]);
  }
  return parts.filter((p) => p.length >= 2);
}

function segmentClass(risk) {
  return SEGMENT_CLASSES.find((c) => risk < c.max)?.value || "severe";
}

/* ── gathering ─────────────────────────────────────────────────────────── */

async function stormsNow(onStatus) {
  const C = window.GeoIDCycloneForecast;
  if (!C) return { storms: [], note: "the cyclone forecast is not loaded on this page" };
  let list = C.storms?.() || [];
  if (!list.length) {
    onStatus("Asking GDACS for active tropical cyclones…");
    try { list = await C.refresh(); } catch (error) {
      return { storms: [], note: `GDACS did not answer (${error.message}), so cyclones are not counted` };
    }
  }
  const storms = list.filter((s) => s.track?.length >= 2);
  return { storms, note: storms.length ? null : "no active tropical cyclone has a forecast track" };
}

async function weatherFor(samples, onStatus) {
  const t0 = samples[0].timeMs;
  const t1 = samples.at(-1).timeMs;
  if (t1 > Date.now() + 16 * DAY) return { weather: null, note: "GFS reaches 16 days ahead; turbulence and storms are not counted for a flight past that" };
  if (t0 < Date.now() - 80 * DAY) return { weather: null, note: "GFS forecasts on this endpoint go back about three months; turbulence and storms are not counted" };
  const idx = weatherSampleIndices(samples, 300, 40);
  onStatus(`Reading GFS at ${idx.length} points along the route…`);
  try {
    const res = await fetch(routeWeatherUrl(idx.map((i) => samples[i]), t0, t1));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { weather: readRouteWeather(await res.json(), idx.map((i) => samples[i].s)), note: null };
  } catch (error) {
    return { weather: null, note: `GFS did not answer (${error.message}); turbulence and storms are not counted` };
  }
}

/** Ash in the air from the last ash model, mg/m³, at a place, height and time — or null with no model. */
function ashSampler() {
  const run = window.GeoIDAtlasAsh?.last?.();
  if (!run?.result?.snapshots?.length || !run.frame) return null;
  const res = run.result;
  const snaps = res.snapshots;
  return (lat, lon, altM, timeMs) => {
    const t = (timeMs - run.startMs) / 1000;
    if (t < snaps[0] - 1800 || t > snaps.at(-1) + 1800) return 0;
    let k = 0;
    for (let i = 1; i < snaps.length; i += 1) if (Math.abs(snaps[i] - t) < Math.abs(snaps[k] - t)) k = i;
    const [x, y] = run.frame.toXY(lat, lon);
    return concentrationGrid(res, k, { x0: x, y0: y, z0: altM, dx: 1, dy: 1, dz: 1, nx: 1, ny: 1, nz: 1 })[0];
  };
}

function airport(phrase, which) {
  const found = findAirport(phrase);
  if (!found) throw new Error(`I don't know an airport called “${phrase}” (${which}). Use its code — LHR, JFK — or a major city`);
  return found.airport;
}

/** The route to fly: samples with altitude and time, and the words for its ends. */
function routeFor({ from, to, callsign, departMs }) {
  if (callsign) {
    const { list } = window.GeoIDTraffic?.aircraft?.() || { list: [] };
    const want = String(callsign).trim().toUpperCase();
    const craft = list.find((a) => (a.callsign || "").toUpperCase() === want || a.name.toUpperCase() === want || a.id.toUpperCase() === want);
    if (!craft) throw new Error(`${callsign} is not on the Aircraft layer — tick Track aircraft and bring it into view first`);
    return liveRoute(craft, to);
  }
  const a = airport(from, "from");
  const b = airport(to, "to");
  if (a === b) throw new Error("that is the same airport at both ends");
  const samples = flightProfile(greatCircle(a, b, 25), { departMs });
  return { samples, from: airportLabel(a), to: airportLabel(b), ends: [a, b], how: "great circle between the airports, typical climb, cruise at FL350 and descent" };
}

function liveRoute(craft, to) {
  const altM = Number.isFinite(craft.altM) && !craft.onGround ? craft.altM : 0;
  const name = craft.callsign || craft.name;
  const start = { lat: craft.lat, lon: craft.lon, iata: name, city: name };
  if (to) {
    const b = airport(to, "to");
    const samples = flightProfile(greatCircle(start, b, 25), {
      departMs: craft.timeMs || Date.now(), startAltM: altM, cruiseAltM: Math.max(altM, 10700),
    });
    return { samples, from: `${name} (now)`, to: airportLabel(b), ends: [start, b], how: `${name}'s reported position to ${b.iata} on a great circle` };
  }
  const kmh = Number.isFinite(craft.speedMs) && craft.speedMs > 30 ? craft.speedMs * 3.6 : 850;
  const heading = Number.isFinite(craft.headingDeg) ? craft.headingDeg : 0;
  const path = deadReckonPath(craft.lat, craft.lon, heading, kmh * 3, 25);
  const cruise = Math.max(altM, 1000);
  const samples = flightProfile(path, {
    departMs: craft.timeMs || Date.now(), startAltM: cruise, cruiseAltM: cruise, endAltM: cruise, cruiseKmh: kmh, terminalKmh: kmh,
  });
  const end = samples.at(-1);
  return {
    samples, from: `${name} (now)`, to: "3 h along its track", ends: [start, { lat: end.lat, lon: end.lon, iata: "+3 h", city: "+3 h" }],
    how: `${name} carried along its reported track (${Math.round(heading)}°) at its reported speed — the open feeds do not say where it is going`,
  };
}

/* ── drawing ───────────────────────────────────────────────────────────── */

function routeFeatures(samples, result, ends) {
  const out = [];
  const segOf = (km) => result.segments.find((g) => km >= g.fromKm - 1e-6 && km <= g.toKm + 1e-6) || result.segments.at(-1);
  // One quad per sample step, given to the segment its midpoint is in — as
  // the integral assigns it. A long thin ring per segment triangulated with
  // gaps along it, and steps across a segment boundary went undrawn
  // (measured); four corners cannot.
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const seg = segOf((a.s + b.s) / 2);
    const ring = corridor([a, b]);
    const geoms = ring ? [{ type: "Polygon", coordinates: [ring] }]
      : splitLine(densify([[wrap(a.lon), a.lat], [wrap(b.lon), b.lat]])).map((c) => ({ type: "LineString", coordinates: c }));
    for (const geometry of geoms) {
      out.push({
        type: "Feature",
        geometry,
        properties: {
          part: segmentClass(seg.risk),
          name: `km ${Math.round(seg.fromKm)}–${Math.round(seg.toKm)}`,
          risk_eq_km: Number(seg.risk.toFixed(2)),
          governing: seg.governing ? HAZARD_LABELS[seg.governing] : "none",
          min_fos: Number.isFinite(seg.minFos) ? Number(seg.minFos.toFixed(2)) : null,
          at_utc: new Date(a.timeMs).toISOString().slice(0, 16).replace("T", " "),
          altitude_m: Math.round(a.altM),
        },
      });
    }
  }
  for (const e of ends) {
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [wrap(e.lon), e.lat] },
      properties: { part: "end", name: e.name ? `${e.city} ${e.iata} — ${e.name}` : e.city, kind: "Route end" },
    });
  }
  return out;
}

function drawRoute(route, result) {
  removeRoute();
  const name = `${LAYER_PREFIX} — ${route.from} → ${route.to}`;
  const fc = { type: "FeatureCollection", features: routeFeatures(route.samples, result, route.ends) };
  const built = buildVectorLayerResult(fc, {
    name,
    style: {
      field: "part",
      categories: [
        ...SEGMENT_CLASSES.map(({ value, label, colour }) => ({ value, label: `Segment risk: ${label} eq. km`, colour })),
        { value: "end", label: "Route end", colour: "#f4f1e8" },
      ],
    },
  });
  built.home = "hazards";
  built.opacity = 0.8;
  built.info = {
    source: "GeoID route risk: GDACS cyclone forecasts, GFS via Open-Meteo, Atlas ash model",
    summary: `${route.how}. Each 100 km segment is a corridor coloured by the hazard integrated over it, in `
      + "equivalent km flown at the limit; click one for its governing hazard and lowest factor of safety.",
  };
  layer = manager()?.addDerivedLayer?.(name, built, "geojson") || null;
  if (layer) {
    layer.metadata = { ...(layer.metadata || {}), source: built.info.source, format: "GeoJSON (computed)", crs: "EPSG:4326" };
    const lats = route.samples.map((p) => p.lat);
    const lons = route.samples.map((p) => p.lon);
    if (Math.max(...lons) - Math.min(...lons) < 180) {
      manager()?.frameLayer?.({ georeferenced: true, bounds: { minX: Math.min(...lons), maxX: Math.max(...lons), minY: Math.min(...lats), maxY: Math.max(...lats) } });
    }
  }
}

export function removeRoute() {
  const im = manager();
  (im?.getLayers?.() || []).filter((l) => String(l.name || "").startsWith(LAYER_PREFIX)).forEach((l) => im.removeLayer?.(l.id));
  layer = null;
}

/**
 * The profile: risk density per km stacked by hazard against distance, the
 * cumulative integral on the right-hand axis, the worst segment shaded, and
 * the altitude flown faint behind.
 */
export function drawChart(canvas, run) {
  if (!canvas || !run) return;
  const { result, samples } = run;
  const width = Math.max(240, canvas.parentElement?.clientWidth || 0, canvas.closest?.(".gis-tool-body")?.clientWidth || 0) || 300;
  const height = 190;
  const ctx = prepareCanvas(canvas, width, height);
  const colors = chartColors(canvas);
  const rect = plotRect(width, height, { xLabel: "distance flown (km)", yLabel: "risk / km" });
  rect.w -= 34; // room for the cumulative axis
  const L = result.lengthKm || 1;
  const yMax = Math.max(1, ...result.density) * 1.1;
  const axes = drawAxes(ctx, rect, {
    xRange: [0, L], yRange: [0, yMax], xLabel: "distance flown (km)", yLabel: "risk / km", colors,
  });
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  // Altitude, faint, scaled to the plot height.
  const altMax = Math.max(1, ...samples.map((p) => p.altM));
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath();
  samples.forEach((p, i) => {
    const x = axes.toX(p.s); const y = rect.y + rect.h - (p.altM / altMax) * rect.h * 0.9;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke(); ctx.setLineDash([]);
  // The worst segment.
  if (result.worst) {
    ctx.fillStyle = "rgba(255, 59, 78, 0.14)";
    const x0 = axes.toX(result.worst.fromKm); const x1 = axes.toX(result.worst.toKm);
    ctx.fillRect(x0, rect.y, Math.max(2, x1 - x0), rect.h);
  }
  // Stacked density by hazard.
  const util = result.util || [];
  const base = new Array(samples.length).fill(0);
  for (const h of HAZARDS) {
    const top = samples.map((_, i) => base[i] + riskDensity(util[i]?.[h]));
    if (top.every((v, i) => v === base[i])) continue;
    ctx.fillStyle = `${HAZARD_COLOURS[h]}bb`;
    ctx.beginPath();
    samples.forEach((p, i) => { const x = axes.toX(p.s); const y = axes.toY(top[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    for (let i = samples.length - 1; i >= 0; i -= 1) ctx.lineTo(axes.toX(samples[i].s), axes.toY(base[i]));
    ctx.closePath(); ctx.fill();
    top.forEach((v, i) => { base[i] = v; });
  }
  // The cumulative integral, on its own scale.
  const cMax = Math.max(1, result.total) * 1.05;
  const toYc = (v) => rect.y + rect.h - (v / cMax) * rect.h;
  ctx.strokeStyle = colors.text; ctx.lineWidth = 1.6;
  ctx.beginPath();
  samples.forEach((p, i) => { const x = axes.toX(p.s); const y = toYc(result.cumulative[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.restore();
  // Right-hand axis for the cumulative curve.
  ctx.save();
  ctx.font = "10px 'Exo 2', system-ui, sans-serif";
  ctx.fillStyle = colors.text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  for (const v of niceTicks(0, cMax, 4)) {
    if (v > cMax) continue;
    ctx.fillText(formatNumber(v), rect.x + rect.w + 4, toYc(v));
  }
  ctx.translate(width - 6, rect.y + rect.h / 2); ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("cumulative eq. km", 0, 0);
  ctx.restore();
}

function renderSummary(run) {
  const node = byId("flight-risk-summary");
  if (!node) return;
  const { result } = run;
  const lines = describeRisk(result, { from: run.from, to: run.to, samples: run.samples }).split("\n");
  const key = HAZARDS.map((h) => `<span class="flight-risk-key"><i style="background:${HAZARD_COLOURS[h]}"></i>${HAZARD_LABELS[h]}</span>`).join("");
  node.innerHTML = `<div class="flight-risk-keys">${key}<span class="flight-risk-key"><i class="line"></i>cumulative</span></div>`
    + lines.map((l) => `<p>${escape(l).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`).join("")
    + (run.notes.length ? `<p class="flight-risk-notes">Not counted: ${run.notes.map(escape).join("; ")}.</p>` : "")
    + `<p class="flight-risk-notes">Limits: cyclone ${CAPACITY.cycloneKt} kt expected wind, Richardson number ${CAPACITY.richardson}, `
    + `CAPE ${CAPACITY.capeJkg} J/kg or a forecast thunderstorm, ash ${CAPACITY.ashMgM3} mg/m³. A screening estimate on a `
    + "great-circle route and a typical profile, not a flight plan or a briefing.</p>";
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

/* ── the one entry point ───────────────────────────────────────────────── */

/**
 * Assess a flight: { from, to } airports, or { callsign[, to] } for a live
 * aircraft; departMs (default now). Draws the route and the profile, and
 * answers { text, result }.
 */
export async function assess({ from, to, callsign = null, departMs = Date.now(), onStatus = say } = {}) {
  const route = routeFor({ from, to, callsign, departMs: Number.isFinite(departMs) ? departMs : Date.now() });
  // The card says what was asked, however it was asked (Atlas, or the boxes).
  if (!callsign && byId("flight-risk-from")) {
    byId("flight-risk-from").value = route.ends[0].iata;
    byId("flight-risk-to").value = route.ends[1].iata;
  }
  if (byId("flight-risk-depart")) byId("flight-risk-depart").value = utcInputValue(route.samples[0].timeMs);
  const notes = [];
  // The cones on the globe first: adding the layer reads the storms, which
  // the integral then uses (a layer added after the answer was drawn late).
  if (byId("flight-risk-cyclones")?.checked !== false && window.GeoIDCycloneForecast?.add) {
    onStatus("Drawing the active cyclones' forecast tracks and cones…");
    await window.GeoIDCycloneForecast.add().catch(() => null);
  }
  const [{ storms, note: sNote }, { weather, note: wNote }] = await Promise.all([
    stormsNow(onStatus), weatherFor(route.samples, onStatus),
  ]);
  if (sNote) notes.push(sNote);
  if (wNote) notes.push(wNote);
  const ashAt = ashSampler();
  if (!ashAt) notes.push("no ash model has been run (ask Atlas to model one)");
  onStatus("Integrating the hazards along the route…");
  const result = assessRoute(route.samples, { weather, storms, ashAt, coneRadiusKm });
  last = { result, samples: route.samples, from: route.from, to: route.to, notes, how: route.how };
  drawRoute(route, result);
  drawChart(byId("flight-risk-chart"), last);
  renderSummary(last);
  const hours = (route.samples.at(-1).timeMs - route.samples[0].timeMs) / 3600e3;
  say(`${route.from} → ${route.to}: ${Math.round(result.lengthKm).toLocaleString("en-GB")} km, about ${hours.toFixed(1)} h, `
    + `departing ${new Date(route.samples[0].timeMs).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  const text = `${describeRisk(result, { from: route.from, to: route.to, samples: route.samples })}\n`
    + `Route: ${route.how}.`
    + (notes.length ? `\nNot counted: ${notes.join("; ")}.` : "")
    + "\nA screening estimate in equivalent km flown at each hazard's limit — not a flight plan or a weather briefing.";
  return { text, result };
}

/** Open the card where the profile is. */
export function open() {
  const card = byId("flight-risk-card");
  if (!card) return;
  // The card is nested inside Hazards ▸ Exposure, itself inside the Hazards
  // group; every enclosing section has to be unfolded.
  for (let n = card; n; n = n.parentElement) if (n.tagName === "DETAILS") n.open = true;
  card.scrollIntoView?.({ block: "start" });
  // Drawn once the unfolded card has its width.
  if (last) requestAnimationFrame(() => drawChart(byId("flight-risk-chart"), last));
}

/* ── the card ──────────────────────────────────────────────────────────── */

const STYLE = `
#flight-risk-card .flight-risk-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 0.5rem; align-items: center; }
#flight-risk-card .flight-risk-grid input { min-width: 0; width: 100%; }
#flight-risk-card canvas { display: block; width: 100%; margin-top: 0.4rem; }
#flight-risk-summary p { margin: 0.25rem 0; font-size: 0.78rem; line-height: 1.35; }
#flight-risk-summary .flight-risk-notes { opacity: 0.7; font-size: 0.72rem; }
#flight-risk-summary .flight-risk-keys { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; font-size: 0.7rem; opacity: 0.85; }
#flight-risk-summary .flight-risk-key i { display: inline-block; width: 0.7rem; height: 0.5rem; margin-right: 0.25rem; vertical-align: middle; border-radius: 2px; }
#flight-risk-summary .flight-risk-key i.line { height: 2px; background: currentColor; }
`;

function utcInputValue(ms) {
  return new Date(Math.floor(ms / 60e3) * 60e3).toISOString().slice(0, 16);
}

function init() {
  const card = byId("flight-risk-card");
  if (!card) return;
  if (!document.getElementById("flight-risk-style")) {
    const style = document.createElement("style");
    style.id = "flight-risk-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const list = byId("flight-risk-airports");
  if (list && !list.children.length) {
    list.innerHTML = AIRPORTS.map((a) => `<option value="${a.iata}">${escape(`${a.city} — ${a.name}`)}</option>`).join("");
  }
  const depart = byId("flight-risk-depart");
  if (depart && !depart.value) depart.value = utcInputValue(Date.now());
  const run = async (opts) => {
    const button = byId("flight-risk-run");
    if (button) button.disabled = true;
    try {
      await assess(opts);
    } catch (error) {
      say(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  };
  const departMs = () => {
    const v = byId("flight-risk-depart")?.value;
    const ms = v ? Date.parse(`${v}:00Z`) : Date.now();
    return Number.isFinite(ms) ? ms : Date.now();
  };
  byId("flight-risk-run")?.addEventListener("click", () => run({
    from: byId("flight-risk-from")?.value, to: byId("flight-risk-to")?.value, departMs: departMs(),
  }));
  byId("flight-risk-live")?.addEventListener("click", () => {
    const sel = window.GeoIDTraffic?.aircraft?.().selected;
    if (!sel) { say("Open an aircraft's card on the globe first (tick Track aircraft, then click one)."); return; }
    run({ callsign: sel.id, to: byId("flight-risk-to")?.value || null });
  });
  byId("flight-risk-clear")?.addEventListener("click", () => {
    removeRoute();
    last = null;
    const s = byId("flight-risk-summary");
    if (s) s.innerHTML = "";
    const c = byId("flight-risk-chart");
    if (c) prepareCanvas(c, c.clientWidth || 300, 1);
    say("");
  });
  card.addEventListener("toggle", () => { if (card.open && last) drawChart(byId("flight-risk-chart"), last); });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDFlightRisk = { assess, open, remove: removeRoute, last: () => last, layerOf: () => layer };
}
