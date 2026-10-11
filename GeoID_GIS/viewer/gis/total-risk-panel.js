/**
 * Hazards ▸ myGeoID ▸ "Total risk here" — the weighted total-risk coefficient
 * at one place, with every model's contribution and the main danger named.
 *
 * The arithmetic is `total-risk.js`; this module only GATHERS: it asks every
 * model on the page that can answer for a place, and says plainly which ones
 * could not and what would let them.
 *
 *   weather       a point forecast from GFS (Open-Meteo), fetched here
 *   cyclone       GeoIDCycloneForecast.threatAt (GDACS)
 *   aftershocks   the live USGS feed (GeoIDEvents)
 *   eruption/fire the live EONET feed (GeoIDEvents)
 *   slope         myGeoID's FoS run (GeoIDMode.fosNear) and the forecast
 *                 landslide run (GeoIDLandslidePipeline.lowestAt)
 *   background    any risk map on the globe whose cells carry p_yr
 *
 * Weights are kept per browser; changing one recombines without refetching.
 */

import {
  weatherTerms, cycloneTerm, aftershockTerm, proximityTerm, fosTerm, backgroundTerm,
  combine, mainDangerSentence, DEFAULT_WEIGHTS, distanceKm,
} from "./total-risk.js?v=20261011-acf80cd";

const byId = (id) => document.getElementById(id);
const WEIGHTS_KEY = "geoid-gis:total-risk-weights";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const LABELS = {
  slope: "Slope stability", flood: "River flood", cyclone: "Tropical cyclone", rain: "Rain",
  gust: "Wind gusts", heat: "Heat", cold: "Cold", snow: "Snow", cape: "Storm instability (CAPE)",
  aftershock: "Aftershocks", eruption: "Eruption nearby", wildfire: "Wildfire nearby", background: "Long-term risk maps",
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

async function fetchWeather(place, horizonHours) {
  const params = new URLSearchParams({
    latitude: place.lat.toFixed(3), longitude: place.lon.toFixed(3),
    hourly: "precipitation,wind_gusts_10m,apparent_temperature,snowfall,cape",
    forecast_hours: String(horizonHours + 24), past_hours: "1",
    wind_speed_unit: "ms", timezone: "GMT", models: "gfs_seamless",
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`the forecast answered ${res.status}`);
  return (await res.json()).hourly;
}

export async function gather(place, horizonHours, { nowMs = Date.now() } = {}) {
  const terms = [];
  const missing = [];
  const opts = { horizonHours, nowMs };

  try {
    terms.push(...weatherTerms(await fetchWeather(place, horizonHours), opts));
  } catch (error) {
    missing.push(["Weather", `the GFS point forecast did not answer (${error.message})`]);
  }

  const cyc = window.GeoIDCycloneForecast;
  if (cyc?.threatAt) {
    try { if (!cyc.storms?.()?.length) await cyc.refresh?.(); } catch { /* GDACS unreachable: said below */ }
    const t = cycloneTerm(cyc.threatAt(place.lat, place.lon), opts);
    if (t) terms.push(t);
    else if (!cyc.storms?.()?.length) missing.push(["Tropical cyclones", "no active storm reported by GDACS (or GDACS did not answer)"]);
  }

  const events = window.GeoIDEvents?.getEvents?.() || [];
  if (!events.length) missing.push(["Live events", "switch on Live Events for aftershocks, eruptions and fires near the place"]);
  const quakes = events.filter((e) => e.categoryId === "earthquakes" && e.magnitude >= 5.5
    && Number.isFinite(e.timeMs) && nowMs - e.timeMs < 30 * 86_400_000);
  const after = quakes.map((q) => aftershockTerm(q, place.lat, place.lon, opts)).filter(Boolean)
    .sort((a, b) => b.h - a.h)[0];
  if (after) terms.push(after);
  const nearest = (cat) => events.filter((e) => e.categoryId === cat && Number.isFinite(e.lat))
    .sort((a, b) => distanceKm(place.lat, place.lon, a.lat, a.lon) - distanceKm(place.lat, place.lon, b.lat, b.lon))[0];
  const volc = proximityTerm("eruption", nearest("volcanoes"), place.lat, place.lon, 15);
  if (volc) terms.push(volc);
  const fire = proximityTerm("wildfire", nearest("wildfires"), place.lat, place.lon, 5);
  if (fire) terms.push(fire);

  const slopes = [];
  const fs = window.GeoIDMode?.fosNear?.(place.lat, place.lon, opts);
  if (fs) slopes.push(fosTerm("slope", "Slope stability (myGeoID run)", fs.fos, { ...opts, atMs: fs.atMs, source: "myGeoID FoS", what: "lowest factor of safety" }));
  const ls = window.GeoIDLandslidePipeline?.lowestAt?.(place.lat, place.lon);
  if (ls) slopes.push(fosTerm("slope", "Slope stability (landslide forecast)", ls.fos, { ...opts, atMs: ls.atMs, source: "Landslide forecast", what: "lowest governing factor of safety" }));
  // Two answers from two slope models for one slope: the worse one governs.
  const slope = slopes.filter(Boolean).sort((a, b) => b.h - a.h)[0];
  if (slope) terms.push(slope);
  else missing.push(["Slope stability", "enter myGeoID mode, or run Hazards ▸ Landslides ▸ Forecast landslide risk, over this place"]);

  const seen = new Set();
  (window.GeoIDFeaturePopup?.featuresAt?.(place.lat, place.lon) || []).forEach(({ layer, feature }) => {
    const p = Number(feature?.properties?.p_yr);
    if (!(p > 0) || seen.has(layer.name)) return;
    seen.add(layer.name);
    const t = backgroundTerm(layer.name, p, { horizonHours, source: layer.name });
    if (t) terms.push(t);
  });
  if (!seen.size) missing.push(["Long-term risk maps", "tick a cyclone, seismic or volcanic risk map in Hazards to count it"]);

  return { terms, missing };
}

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const fmtFos = (f) => (f === Infinity ? "∞" : f >= 100 ? "100+" : f.toFixed(2));

function render() {
  const out = byId("total-risk-result");
  if (!out || !last) return;
  const weights = loadWeights();
  const r = combine(last.terms, weights);
  out.innerHTML = "";
  const head = document.createElement("div");
  head.className = "total-risk-head";
  head.innerHTML = `<span class="total-risk-fos" style="border-color:${r.class.colour};color:${r.class.colour}">${fmtFos(r.fos)}</span>
    <span><strong>${r.class.label}</strong><br><small>Total-risk FoS at ${last.place.lat.toFixed(3)}°, ${last.place.lon.toFixed(3)}° (${last.place.what}), next ${last.horizon} h</small></span>`;
  out.appendChild(head);
  const main = document.createElement("p");
  main.className = "compact-copy";
  main.textContent = mainDangerSentence(r);
  out.appendChild(main);

  const table = document.createElement("table");
  table.className = "total-risk-table";
  table.innerHTML = "<thead><tr><th>Model</th><th>Demand</th><th>Weight</th><th>Share</th></tr></thead>";
  const body = document.createElement("tbody");
  r.terms.forEach((t) => {
    const tr = document.createElement("tr");
    tr.title = `${t.note}. Source: ${t.source || "—"}`;
    const name = document.createElement("td");
    name.textContent = t.model;
    const h = document.createElement("td");
    // Nothing on the way reads as nought, not as four decimal places of it.
    h.textContent = t.h === 0 ? "0" : t.h.toFixed(t.h < 0.01 ? 4 : 2);
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
  how.textContent = "Each model is a demand over its own capacity (1 = act); the total is 1 / Σ weight × demand. "
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
    const { terms, missing } = await gather(place, horizon);
    last = { terms, missing, place, horizon };
    render();
    say(`${terms.length} model reading${terms.length === 1 ? "" : "s"} combined.`);
    return combine(terms, loadWeights());
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
  byId("total-risk-reset").addEventListener("click", () => { saveWeights({}); render(); say("Weights back to their defaults."); });
  return true;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  let tries = 0;
  const attempt = () => { if (!buildCard() && (tries += 1) < 60) setTimeout(attempt, 500); };
  attempt();
  window.GeoIDTotalRisk = { compute, gather, last: () => last };
}
