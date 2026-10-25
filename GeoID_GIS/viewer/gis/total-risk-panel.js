/**
 * Hazards ▸ myGeoID ▸ "Total risk here" — the weighted total-risk coefficient
 * at one place, with every model's contribution and the main danger named.
 *
 * The arithmetic is `total-risk.js`; this module only GATHERS: it asks every
 * model on the page that can answer for a place, and says plainly which ones
 * could not and what would let them.
 *
 *   weather       a point forecast from GFS (Open-Meteo), fetched here, and
 *                 the GFS ensemble's 31 members, each scored as one future
 *   coast         the marine forecast's waves at the nearest sea, and a
 *                 storm-surge screen from the pressure and the onshore wind
 *   ash           an open vent's plume down the 500 hPa wind
 *   people        WorldPop within 1 and 5 km, for the risk-to-people matrix
 *   cyclone       GeoIDCycloneForecast.threatAt (GDACS)
 *   aftershocks   the live USGS feed (GeoIDEvents)
 *   eruption/fire the live EONET feed (GeoIDEvents)
 *   slope         myGeoID's FoS run (GeoIDMode.fosNear) and the forecast
 *                 landslide run (GeoIDLandslidePipeline.lowestAt)
 *   flood         the same run's channel flood wave (…floodAt)
 *   background    the cyclone, seismic and volcanic risk grids — the map on
 *                 the globe where it is ticked, else the published grid
 *
 * Weights are kept per browser; changing one recombines without refetching.
 */

import {
  weatherTerms, cycloneTerm, aftershockTerm, proximityTerm, fosTerm, backgroundTerm,
  combine, combineInTime, combineEnsemble, floodTerm, mainDangerSentence, DEFAULT_WEIGHTS, distanceKm,
  ensembleMembers, seawardBearing, waveTerm, ashTerm, peopleWithin, exposureClass, hazardLevel, riskMatrix,
} from "./total-risk.js?v=20261025-f5a5da0";

const byId = (id) => document.getElementById(id);
const WEIGHTS_KEY = "geoid-gis:total-risk-weights";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const LABELS = {
  slope: "Slope stability", flood: "River flood", cyclone: "Tropical cyclone", rain: "Rain",
  gust: "Wind gusts", heat: "Heat", cold: "Cold", snow: "Snow", cape: "Storm instability (CAPE)",
  aftershock: "Aftershocks", eruption: "Eruption nearby", wildfire: "Wildfire nearby", background: "Long-term risk maps",
  fire: "Fire weather",
};

let last = null;        // { terms, missing, place, horizon }
let picking = null;

function loadWeights() {
  try { return { ...DEFAULT_WEIGHTS, ...JSON.parse(localStorage.getItem(WEIGHTS_KEY) || "{}") }; } catch { return { ...DEFAULT_WEIGHTS }; }
}
function saveWeights(w) {
  try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w)); } catch { /* a private window */ }
}

function say(text) {
  const n = byId("total-risk-status");
  if (n) n.textContent = text;
}

/** Where to read: the drawn study area's centre, else the middle of the view. */
function placeFor(mode) {
  if (mode === "picked" && picking?.place) return picking.place;
  if (mode === "area") {
    const g = window.GeoIDViewer?.getExtractionGeometry?.("study") || window.GeoIDViewer?.getExtractionGeometry?.();
    const vs = g?.vertices || [];
    if (vs.length) {
      const lat = vs.reduce((s, v) => s + v.lat, 0) / vs.length;
      const lon = vs.reduce((s, v) => s + (v.lon > 180 ? v.lon - 360 : v.lon), 0) / vs.length;
      return { lat, lon, what: "the drawn study area's centre" };
    }
    return null;
  }
  const c = window.GeoIDViewer?.getViewCentreLatLon?.();
  if (!c || !Number.isFinite(c.lat)) return null;
  return { lat: c.lat, lon: c.lon > 180 ? c.lon - 360 : c.lon, what: "the middle of the view" };
}

const HOURLY = "precipitation,wind_gusts_10m,apparent_temperature,snowfall,cape,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl";
const ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";
const MARINE = "https://marine-api.open-meteo.com/v1/marine";
const asList = (json) => (Array.isArray(json) ? json : [json]);

function forecastParams(lat, lon, horizonHours, hourly, extra = {}) {
  return new URLSearchParams({
    latitude: Array.isArray(lat) ? lat.map((v) => v.toFixed(3)).join(",") : lat.toFixed(3),
    longitude: Array.isArray(lon) ? lon.map((v) => v.toFixed(3)).join(",") : lon.toFixed(3),
    hourly, forecast_hours: String(horizonHours + 24), past_hours: "1",
    wind_speed_unit: "ms", timezone: "GMT", ...extra,
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try { reason = (await res.json()).reason || reason; } catch { /* the status will do */ }
    throw new Error(reason);
  }
  return res.json();
}

async function fetchWeather(place, horizonHours) {
  return (await fetchJson(`${FORECAST}?${forecastParams(place.lat, place.lon, horizonHours, HOURLY, { models: "gfs_seamless" })}`)).hourly;
}

/** The GFS ensemble (31 members) at the place, or null where it does not answer. */
async function fetchEnsemble(place, horizonHours) {
  const json = await fetchJson(`${ENSEMBLE}?${forecastParams(place.lat, place.lon, horizonHours, HOURLY, { models: "gfs025" })}`);
  return ensembleMembers(json.hourly);
}

/**
 * The sea near the place: the marine model asked at the place and at eight
 * points 10 km round it. A land cell answers nulls, so the cells that answer
 * say where the sea is — the bearing for the surge's onshore wind and the
 * nearest one's waves.
 */
const PROBE_KM = 10;
async function fetchCoast(place, horizonHours) {
  const pts = [{ lat: place.lat, lon: place.lon, bearing: null, km: 0 }];
  for (let b = 0; b < 360; b += 45) {
    const r = Math.PI / 180;
    const dLat = (PROBE_KM / 111.195) * Math.cos(b * r);
    const dLon = (PROBE_KM / (111.195 * Math.max(0.1, Math.cos(place.lat * r)))) * Math.sin(b * r);
    pts.push({ lat: place.lat + dLat, lon: place.lon + dLon, bearing: b, km: PROBE_KM });
  }
  const json = asList(await fetchJson(`${MARINE}?${forecastParams(pts.map((p) => p.lat), pts.map((p) => p.lon), horizonHours, "wave_height")}`));
  const probes = pts.map((p, i) => {
    const hourly = json[i]?.hourly;
    const sea = Array.isArray(hourly?.wave_height) && hourly.wave_height.some((v) => Number.isFinite(v));
    return { ...p, sea, hourly };
  });
  if (!probes.some((p) => p.sea)) return null;
  const nearest = probes.filter((p) => p.sea).sort((a, b) => a.km - b.km)[0];
  return { bearing: probes[0].sea ? null : seawardBearing(probes.slice(1)), nearest, atSea: probes[0].sea };
}

/** The 500 hPa wind over each open vent, hour by hour. */
async function fetchVentWinds(vents, horizonHours) {
  const json = asList(await fetchJson(`${FORECAST}?${forecastParams(vents.map((v) => v.lat), vents.map((v) => v.lon), horizonHours,
    "wind_speed_500hPa,wind_direction_500hPa", { models: "gfs_seamless" })}`));
  return vents.map((_, i) => {
    const h = json[i]?.hourly || {};
    return { time: h.time || [], speed: h.wind_speed_500hPa || [], direction: h.wind_direction_500hPa || [] };
  });
}

/** People within 1 and 5 km, from WorldPop's own counts. */
async function fetchExposure(place) {
  // WorldPop is loaded on demand; import it under this module's own stamp,
  // as the risk reader does, so there is one instance of it.
  const wp = window.GeoIDWorldPop?.readCounts ? window.GeoIDWorldPop : await import(`./worldpop.js${new URL(import.meta.url).search}`);
  if (!wp?.readCounts) return null;
  const dLat = 5.5 / 111.195; const dLon = 5.5 / (111.195 * Math.max(0.1, Math.cos((place.lat * Math.PI) / 180)));
  const counts = await wp.readCounts({ west: place.lon - dLon, east: place.lon + dLon, south: place.lat - dLat, north: place.lat + dLat });
  if (!counts) return null;
  return { within1: peopleWithin(counts, place.lat, place.lon, 1), within5: peopleWithin(counts, place.lat, place.lon, 5), credit: counts.credit };
}

/**
 * Everything that can answer for the place. Weather comes in two forms: the
 * deterministic run (`terms`) and, where the ensemble answers, one set of
 * weather terms per member (`memberTerms`); everything that is not weather
 * is `shared` — the same in every member's future.
 */
export async function gather(place, horizonHours, { nowMs = Date.now() } = {}) {
  const shared = [];
  const missing = [];
  const opts = { horizonHours, nowMs };

  const [weather, ensemble, coast, exposure] = await Promise.allSettled([
    fetchWeather(place, horizonHours), fetchEnsemble(place, horizonHours), fetchCoast(place, horizonHours), fetchExposure(place),
  ]);
  const sea = coast.status === "fulfilled" ? coast.value : null;
  if (coast.status === "rejected") missing.push(["The coast", `the marine forecast did not answer (${coast.reason?.message})`]);
  const seaBearing = sea && Number.isFinite(sea.bearing) ? sea.bearing : null;
  const wopts = { ...opts, sea: seaBearing };
  let terms = [];
  if (weather.status === "fulfilled") terms = weatherTerms(weather.value, wopts);
  else missing.push(["Weather", `the GFS point forecast did not answer (${weather.reason?.message})`]);
  let memberTerms = [];
  if (ensemble.status === "fulfilled" && ensemble.value.length > 1) {
    memberTerms = ensemble.value.map((m) => weatherTerms(m, { ...wopts, source: `GFS ensemble member ${m.member}` }));
  } else {
    missing.push(["Forecast uncertainty", `the GFS ensemble did not answer${ensemble.reason ? ` (${ensemble.reason.message})` : ""}, so the single GFS run is read as certain`]);
  }
  if (sea?.nearest?.hourly) {
    const w = waveTerm(sea.nearest.hourly, { ...opts, km: sea.nearest.km });
    if (w) shared.push(w);
  }

  const cyc = window.GeoIDCycloneForecast;
  if (cyc?.threatAt) {
    try { if (!cyc.storms?.()?.length) await cyc.refresh?.(); } catch { /* GDACS unreachable: said below */ }
    const threat = cyc.threatAt(place.lat, place.lon);
    // Hour by hour along its own track, so the total sums the storm with
    // whatever else is happening WHILE it passes, not at some other time.
    const track = threat ? (cyc.storms?.() || []).find((s) => s.name === threat.storm)?.track : null;
    const t = cycloneTerm(threat, { ...opts, track, place });
    if (t) shared.push(t);
    else if (!cyc.storms?.()?.length) missing.push(["Tropical cyclones", "no active storm reported by GDACS (or GDACS did not answer)"]);
  }

  const events = window.GeoIDEvents?.getEvents?.() || [];
  if (!events.length) missing.push(["Live events", "switch on Live Events for aftershocks, eruptions and fires near the place"]);
  const quakes = events.filter((e) => e.categoryId === "earthquakes" && e.magnitude >= 5.5
    && Number.isFinite(e.timeMs) && nowMs - e.timeMs < 30 * 86_400_000);
  const after = quakes.map((q) => aftershockTerm(q, place.lat, place.lon, opts)).filter(Boolean)
    .sort((a, b) => b.h - a.h)[0];
  if (after) shared.push(after);
  const byDistance = (cat) => events.filter((e) => e.categoryId === cat && Number.isFinite(e.lat))
    .map((e) => ({ e, km: distanceKm(place.lat, place.lon, e.lat, e.lon) })).sort((a, b) => a.km - b.km);
  // An open vent: the ground near it (ballistics, flows) as a proximity
  // screen, and its ash down the forecast wind out to 500 km.
  const vents = byDistance("volcanoes");
  const near = proximityTerm("eruption", vents[0]?.e, place.lat, place.lon, 10);
  if (near) shared.push({ ...near, model: `Near the vent of ${near.model}` });
  const upwind = vents.filter((v) => v.km <= 500).slice(0, 3).map((v) => v.e);
  if (upwind.length) {
    try {
      const winds = await fetchVentWinds(upwind, horizonHours);
      const ash = upwind.map((v, i) => ashTerm(v, place, winds[i], opts)).filter(Boolean).sort((a, b) => b.h - a.h)[0];
      if (ash) shared.push(ash);
    } catch (error) {
      missing.push(["Volcanic ash", `the wind over the vent did not answer (${error.message})`]);
    }
  }
  const fire = proximityTerm("wildfire", byDistance("wildfires")[0]?.e, place.lat, place.lon, 5);
  if (fire) shared.push(fire);

  const slopes = [];
  const fs = window.GeoIDMode?.fosNear?.(place.lat, place.lon, opts);
  if (fs) slopes.push(fosTerm("slope", "Slope stability (myGeoID run)", fs.fos, { ...opts, atMs: fs.atMs, source: "myGeoID FoS", what: "lowest factor of safety" }));
  const ls = window.GeoIDLandslidePipeline?.lowestAt?.(place.lat, place.lon);
  if (ls) slopes.push(fosTerm("slope", "Slope stability (landslide forecast)", ls.fos, { ...opts, atMs: ls.atMs, source: "Landslide forecast", what: "lowest governing factor of safety" }));
  // Two answers from two slope models for one slope: the worse one governs.
  const slope = slopes.filter(Boolean).sort((a, b) => b.h - a.h)[0];
  const reach = window.GeoIDLandslidePipeline?.floodAt?.(place.lat, place.lon);
  const flood = floodTerm(reach, opts);
  if (flood) shared.push(flood);
  else if (!ls) {
    missing.push(["River flood", "run Hazards ▸ Landslides ▸ Forecast landslide risk over this place — its flood wave gives each river its channel factor of safety"]);
  }
  if (slope) shared.push(slope);
  else missing.push(["Slope stability", "enter myGeoID mode, or run Hazards ▸ Landslides ▸ Forecast landslide risk, over this place"]);

  // The long-term maps: a map ON the globe is read where it is drawn (it may
  // be a finer or newer reading); the rest are read from their published
  // grids, so the score does not depend on what happens to be ticked.
  const counted = new Set();
  const grids = window.GeoIDBackgroundRisk?.GRIDS || [];
  (window.GeoIDFeaturePopup?.featuresAt?.(place.lat, place.lon) || []).forEach(({ layer, feature }) => {
    const p = Number(feature?.properties?.p_yr);
    const grid = grids.find((g) => g.layer.test(layer.name || ""));
    if (!(p > 0) || counted.has(grid?.id || layer.name)) return;
    counted.add(grid?.id || layer.name);
    const t = backgroundTerm(layer.name, p, { horizonHours, source: `${layer.name} (on the globe)` });
    if (t) shared.push(t);
  });
  if (window.GeoIDBackgroundRisk?.backgroundAt) {
    const got = await window.GeoIDBackgroundRisk.backgroundAt(place.lat, place.lon, { skip: [...counted] });
    for (const g of got) {
      if (g.error) { missing.push([g.model, `the published grid could not be read (${g.error})`]); continue; }
      const t = backgroundTerm(g.model, g.p, { horizonHours, source: "published risk grid" });
      if (t) shared.push(t);
    }
  }

  const people = exposure.status === "fulfilled" ? exposure.value : null;
  if (!people) missing.push(["People here", `WorldPop could not be read${exposure.reason ? ` (${exposure.reason.message})` : ""}, so the risk to people is not scored`]);

  return {
    terms: [...terms, ...shared], memberTerms, shared, missing, nowMs, people,
    coast: sea ? { bearing: seaBearing, atSea: sea.atSea, km: sea.nearest?.km } : null,
  };
}

function whenText(atMs, leadH) {
  const iso = new Date(atMs).toISOString();
  const stamp = `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 13)}:00 UTC`;
  return leadH < 1 ? `now (${stamp})` : `in ${Math.round(leadH)} h (${stamp})`;
}

/**
 * The total's demand through the horizon: one line, the act level at 1, the
 * worst hour marked. A sparkline, not a chart.
 */
function curveCanvas(r) {
  const c = document.createElement("canvas");
  c.className = "total-risk-curve";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", `Combined demand over the horizon, worst ${r.demand.toFixed(2)} ${whenText(r.atMs, r.lead)}`);
  const W = 300; const H = 64; const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d");
  if (!g || !r.curve?.length) return c;
  g.scale(dpr, dpr);
  const top = Math.max(1.2, ...r.curve.map((p) => p.demand), ...(r.band || []).map((b) => b.p90)) * 1.08;
  const x = (k) => 2 + (k / (r.curve.length - 1 || 1)) * (W - 4);
  const y = (v) => H - 12 - (v / top) * (H - 18);
  g.strokeStyle = "rgba(229,50,45,.55)"; g.setLineDash([3, 3]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, y(1)); g.lineTo(W, y(1)); g.stroke(); g.setLineDash([]);
  g.fillStyle = "rgba(229,50,45,.8)"; g.font = "9px system-ui, sans-serif"; g.fillText("act", W - 18, y(1) - 3);
  if (r.band?.length === r.curve.length) {
    // The ensemble's middle 80%: where nine futures in ten put the hour.
    g.fillStyle = "rgba(95,225,255,.18)"; g.beginPath();
    r.band.forEach((b, k) => { if (k) g.lineTo(x(k), y(b.p90)); else g.moveTo(x(k), y(b.p90)); });
    for (let k = r.band.length - 1; k >= 0; k -= 1) g.lineTo(x(k), y(r.band[k].p10));
    g.closePath(); g.fill();
  }
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--nav-accent").trim() || "#ff2bd6";
  g.lineWidth = 1.5; g.beginPath();
  r.curve.forEach((p, k) => { if (k) g.lineTo(x(k), y(p.demand)); else g.moveTo(x(k), y(p.demand)); });
  g.stroke();
  const kw = r.curve.findIndex((p) => p.tMs === r.atMs);
  if (kw >= 0) { g.fillStyle = r.class.colour; g.beginPath(); g.arc(x(kw), y(r.curve[kw].demand), 3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillText("now", 2, H - 1);
  g.fillText(`+${Math.round((r.curve.at(-1).tMs - r.curve[0].tMs) / 3_600_000)} h`, W - 30, H - 1);
  return c;
}

/**
 * Who is there. The score is a HAZARD; this is the step to RISK — the same
 * hazard over an empty hillside and over a town are different decisions.
 */
function peopleBlock(r) {
  const box = document.createElement("div");
  box.className = "total-risk-people";
  const pp = last.people;
  if (!pp || !Number.isFinite(pp.within5)) {
    box.innerHTML = "<small>People here: not read (WorldPop did not answer), so the risk to people is not scored.</small>";
    return box;
  }
  const exp = exposureClass(pp.within5);
  const hz = hazardLevel(r.fos);
  const risk = riskMatrix(hz, exp);
  const n = (v) => (v < 10 ? "fewer than 10" : `about ${Math.round(v).toLocaleString()}`);
  box.innerHTML = `<span class="total-risk-chip" style="border-color:${risk.colour};color:${risk.colour}">${risk.label}</span>
    <small>${n(pp.within1)} people within 1 km and ${n(pp.within5)} within 5 km (WorldPop 2020) — ${exp.label}.
    Hazard level ${hz} × exposure level ${exp.id} = ${risk.score} on the 5 × 5 risk matrix.</small>`;
  return box;
}

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const fmtFos = (f) => (f === Infinity ? "∞" : f >= 100 ? "100+" : f.toFixed(2));

function render() {
  const out = byId("total-risk-result");
  if (!out || !last) return;
  const weights = loadWeights();
  const timing = { nowMs: last.nowMs, horizonHours: last.horizon };
  const quantile = Number(byId("total-risk-quantile")?.value) || 0.9;
  const deterministic = combineInTime(last.terms, weights, timing);
  const ens = last.memberTerms?.length > 1 ? combineEnsemble(last.memberTerms, last.shared, weights, { ...timing, quantile }) : null;
  const r = ens || deterministic;
  out.innerHTML = "";
  const head = document.createElement("div");
  head.className = "total-risk-head";
  head.innerHTML = `<span class="total-risk-fos" style="border-color:${r.class.colour};color:${r.class.colour}">${fmtFos(r.fos)}</span>
    <span><strong>${r.class.label}</strong><br><small>Total-risk FoS at ${last.place.lat.toFixed(3)}°, ${last.place.lon.toFixed(3)}° (${last.place.what}), worst hour ${whenText(r.atMs, r.lead)} of the next ${last.horizon} h</small></span>`;
  out.appendChild(head);
  if (ens) {
    const e = document.createElement("p");
    e.className = "compact-copy total-risk-ensemble";
    const which = quantile >= 1 ? "the worst member" : quantile <= 0.5 ? "the median member" : `the ${Math.round(quantile * 100)}th-percentile member — one future in ${Math.round(1 / (1 - quantile))} is worse`;
    e.textContent = `GFS ensemble, ${ens.members} forecasts: ${pct(ens.pAct)} of them reach act. `
      + `The score is ${which}; the median reads ${fmtFos(ens.medianFos)}, the single GFS run ${fmtFos(deterministic.fos)}.`
      + (last.shared.some((t) => t.key === "waves") ? " The waves are the single marine run, the same in every future." : "");
    out.appendChild(e);
  }
  out.appendChild(curveCanvas(r));
  if (r.peaksFos < r.fos - 0.005) {
    const peaks = document.createElement("p");
    peaks.className = "compact-copy total-risk-peaks";
    peaks.textContent = `The models' own worst moments do not coincide: adding every peak would read ${fmtFos(r.peaksFos)}, `
      + `but no single hour carries them all. The score is the worst hour's.`;
    out.appendChild(peaks);
  }
  const main = document.createElement("p");
  main.className = "compact-copy";
  main.textContent = mainDangerSentence(r);
  out.appendChild(main);
  out.appendChild(peopleBlock(r));

  const table = document.createElement("table");
  table.className = "total-risk-table";
  table.innerHTML = "<thead><tr><th>Model</th><th title=\"Demand at the worst hour; the model's own peak in brackets where it differs\">Demand</th><th>Weight</th><th>Share</th></tr></thead>";
  const body = document.createElement("tbody");
  r.terms.forEach((t) => {
    const tr = document.createElement("tr");
    tr.title = `${t.note}. Source: ${t.source || "—"}`;
    const name = document.createElement("td");
    name.textContent = t.model;
    const h = document.createElement("td");
    // Nothing on the way reads as nought, not as four decimal places of it.
    const num = (v) => (v === 0 ? "0" : v.toFixed(v < 0.01 ? 4 : 2));
    h.textContent = num(t.h);
    if (Number.isFinite(t.peakH) && Math.abs(t.peakH - t.h) > 0.005) {
      const pk = document.createElement("small");
      pk.className = "total-risk-peak";
      pk.textContent = ` (${num(t.peakH)})`;
      pk.title = "This model's own worst, at another hour";
      h.appendChild(pk);
    }
    const w = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.max = "3"; input.step = "0.25";
    input.value = String(t.weight);
    input.className = "input total-risk-weight";
    input.setAttribute("aria-label", `Weight for ${LABELS[t.key] || t.model}`);
    input.addEventListener("change", () => {
      const all = loadWeights();
      all[t.key] = Math.max(0, Math.min(3, Number(input.value) || 0));
      saveWeights(all);
      render();
    });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    w.appendChild(input);
    const share = document.createElement("td");
    share.innerHTML = `<span class="total-risk-bar"><i style="width:${Math.max(1, Math.round(t.share * 100))}%"></i></span> ${pct(t.share)}`;
    tr.append(name, h, w, share);
    body.appendChild(tr);
  });
  table.appendChild(body);
  if (r.terms.length) out.appendChild(table);
  if (last.missing.length) {
    const miss = document.createElement("ul");
    miss.className = "total-risk-missing";
    last.missing.forEach(([what, why]) => {
      const li = document.createElement("li");
      li.textContent = `${what}: ${why}.`;
      miss.appendChild(li);
    });
    const cap = document.createElement("p");
    cap.className = "compact-copy";
    cap.textContent = "Not counted:";
    out.append(cap, miss);
  }
  const how = document.createElement("p");
  how.className = "compact-copy";
  how.textContent = "Each model is a demand over its own capacity (1 = act), summed hour by hour as 1 / Σ weight × demand; the score is the worst hour. "
    + "A forecast more than a day out is discounted for its lead; a risk map's yearly chance is read over the horizon. "
    + "A screening score, not a warning — follow official warnings.";
  out.appendChild(how);
}

export async function compute() {
  const mode = byId("total-risk-place")?.value || "view";
  const horizon = Number(byId("total-risk-horizon")?.value) || 72;
  const place = placeFor(mode);
  if (!place) {
    say(mode === "area" ? "Draw a study area first." : mode === "picked" ? "Pick a place on the globe first." : "The globe is not ready yet.");
    return null;
  }
  const button = byId("total-risk-run");
  if (button) button.disabled = true;
  say("Asking every model that can answer for this place…");
  try {
    const { terms, memberTerms, shared, missing, nowMs, people, coast } = await gather(place, horizon);
    last = { terms, memberTerms, shared, missing, place, horizon, nowMs, people, coast };
    // The verification ledger (atlas-ledger-page.js) records each reading it
    // can check once the window has passed.
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("geoid-gis:total-risk-computed", { detail: { terms, place, nowMs, horizon } }));
    }
    render();
    say(`${terms.length} model reading${terms.length === 1 ? "" : "s"} combined.`);
    return memberTerms.length > 1
      ? combineEnsemble(memberTerms, shared, loadWeights(), { nowMs, horizonHours: horizon, quantile: Number(byId("total-risk-quantile")?.value) || 0.9 })
      : combineInTime(terms, loadWeights(), { nowMs, horizonHours: horizon });
  } catch (error) {
    say(`Could not compute: ${error.message}`);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function armPick() {
  const canvas = document.querySelector("#app > canvas");
  if (!canvas) return;
  say("Click the place on the globe.");
  let down = null;
  const onDown = (e) => { down = [e.clientX, e.clientY]; };
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(e.clientX, e.clientY);
    if (!at) return;
    window.GeoIDFeaturePopup?.suppress?.(800);
    picking = { place: { lat: at.lat, lon: at.lon, what: "the place picked" } };
    canvas.removeEventListener("pointerdown", onDown, true);
    canvas.removeEventListener("pointerup", onUp, true);
    void compute();
  };
  canvas.addEventListener("pointerdown", onDown, true);
  canvas.addEventListener("pointerup", onUp, true);
}

const STYLE = `
#total-risk-card .total-risk-head{display:flex;gap:.6rem;align-items:center;margin:.3rem 0}
#total-risk-card .total-risk-fos{font:700 1.35rem/1 'Exo 2',system-ui,sans-serif;border:2px solid;border-radius:.5rem;padding:.3rem .5rem;min-width:3.6rem;text-align:center;flex:0 0 auto;white-space:nowrap}
#total-risk-card .total-risk-table{width:100%;border-collapse:collapse;font-size:.72rem}
#total-risk-card .total-risk-table th,#total-risk-card .total-risk-table td{padding:.2rem .25rem;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)}
#total-risk-card .total-risk-weight{width:3.4rem;padding:.1rem .25rem}
#total-risk-card .total-risk-table td:last-child{white-space:nowrap}
#total-risk-card .total-risk-bar{display:inline-block;width:3rem;height:.4rem;background:rgba(255,255,255,.1);border-radius:.2rem;vertical-align:middle}
#total-risk-card .total-risk-bar i{display:block;height:100%;background:var(--nav-accent,#ff2bd6);border-radius:.2rem}
#total-risk-card .total-risk-curve{display:block;width:100%;height:64px;margin:.15rem 0 .35rem}
#total-risk-card .total-risk-peak{opacity:.6}
#total-risk-card .total-risk-people{display:flex;flex-direction:column;gap:.25rem;margin:.3rem 0 .5rem}
#total-risk-card .total-risk-chip{align-self:flex-start;border:1.5px solid;border-radius:999px;padding:.1rem .55rem;font:600 .74rem/1.4 'Exo 2',system-ui,sans-serif}
#total-risk-card .total-risk-missing{margin:.2rem 0 .4rem 1rem;padding:0;font-size:.7rem;opacity:.8}
`;

function buildCard() {
  const host = byId("hazards-mygeoid-host");
  if (!host || byId("total-risk-card")) return Boolean(host);
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  const card = document.createElement("details");
  card.className = "gis-tool-section";
  card.id = "total-risk-card";
  card.innerHTML = `
    <summary>Total risk here</summary>
    <div class="gis-tool-body">
      <p class="tool-copy">Every hazard model that can answer for a place, on one factor-of-safety scale,
        weighted, with each model's share and the main danger named.</p>
      <label class="row"><span>Place</span>
        <select id="total-risk-place" class="input">
          <option value="view" selected>The middle of the view</option>
          <option value="area">The drawn study area</option>
          <option value="picked">A place I pick</option>
        </select>
      </label>
      <label class="row"><span>Horizon</span>
        <select id="total-risk-horizon" class="input">
          <option value="24">The next 24 h</option>
          <option value="72" selected>The next 3 days</option>
          <option value="168">The next 7 days</option>
        </select>
      </label>
      <label class="row"><span>Design for</span>
        <select id="total-risk-quantile" class="input" title="Which of the ensemble's forecasts the score is read from">
          <option value="0.9" selected>One future in ten worse (90%)</option>
          <option value="0.5">The median future</option>
          <option value="1">The worst forecast</option>
        </select>
      </label>
      <div class="gis-btn-row">
        <button id="total-risk-run" class="button primary" type="button">Compute</button>
        <button id="total-risk-reset" class="button secondary" type="button">Default weights</button>
      </div>
      <div id="total-risk-status" class="gis-metric">Not computed yet.</div>
      <div id="total-risk-result"></div>
    </div>`;
  host.appendChild(card);
  byId("total-risk-run").addEventListener("click", () => {
    if (byId("total-risk-place").value === "picked") armPick();
    else void compute();
  });
  byId("total-risk-quantile").addEventListener("change", () => render());
  byId("total-risk-reset").addEventListener("click", () => { saveWeights({}); render(); say("Weights back to their defaults."); });
  return true;
}

/* NO CARD (removed on request, 2026-10-17): "Total risk here" under Hazards was
 * a second door to a reading the Workspace shield already gives -- the risk
 * reader, people exposed under every risk map, over the drawn area or view.
 * The engine stays: Atlas's total_risk tool (atlas-runner.js) and the
 * verification ledger (atlas-ledger-page.js, which records each computation
 * announced below) still use it, at the middle of the view over 72 h, the
 * defaults compute() falls back to when no card supplies a choice. buildCard()
 * is kept so the card can be restored by calling it. */
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDTotalRisk = { compute, gather, last: () => last, buildCard };
}
