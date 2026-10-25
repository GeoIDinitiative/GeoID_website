// Earth Flight's own gazetteer: the places the flight labels add to the
// GeoHUB's curated set, streamed round the aircraft as it flies.
//
// Owner, 2026-10-25: a partition between the globe's labels and the flight's.
// The GeoHUB globe keeps its generalised set; the flight is "all encompassing,
// like a location museum as we fly -- showing cities, buildings of interest,
// historical sites", in the same significance hierarchy, and dynamic: "the
// White House should be visible at low altitudes but not at high altitudes".
//
// Two streams, ranked by flight_sim/earth/game/gazetteer.js into tiers 1-7
// with a visibility window each (how high, how far):
//   * OpenStreetMap places from the vector tiles the lamps and buildings
//     already use (OpenFreeMap): towns, villages, suburbs, peaks, volcanoes,
//     parks, airports, lakes -- a z8 ring always, a z11 ring below 8 km,
//     decoded in a worker;
//   * Wikipedia's geosearch below 5 km: the landmarks, buildings, museums,
//     churches and historic sites within 10 km, ranked by how much has been
//     written about them; asked again as the aircraft moves on.
// The flight labels (flight-labels.js) take `getItems()` once a second and
// show each place only inside its window.

import { ringsFor, tilesAround, dedupe, thinNearby, rankWikipedia, wikiGeoUrl, WIKI_FROM_KM, distanceKm, nameKey, FLIGHT_CATEGORIES, TIER_SIZE } from "../../../flight_sim/earth/game/gazetteer.js?v=1";

const TILEJSON = "https://tiles.openfreemap.org/planet";
const TICK_MS = 1500;
const FETCHES = 4;                 // tiles in flight at once
const MAX_TILES = 300;             // decoded tiles kept
const WIKI_MOVE_KM = 4;            // ask Wikipedia again after moving this far
const WIKI_KEEP_KM = 30;           // and forget its places further than this
const UNITS_PER_M = 3.2 / 6371000;

let template = null, timer = null, worker = null, running = false;
const tiles = new Map();           // "z/x/y" -> { z, x, y, layers, state, items, used }
const jobs = new Map();
let nextJob = 1, inflight = 0;
const wiki = { pages: new Map(), at: null, busy: false, retryAt: 0 };
let version = 0;
const byId = new Map();            // stable item objects, so the labels can diff by identity
let cache = { version: -1, items: [] };
export const stats = { tiles: 0, osm: 0, wiki: 0, items: 0 };

/* ── Items for the label layer ───────────────────────────────────────────── */

function palette(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return { bg: "rgba(9, 14, 24, 0.66)", stroke: `rgba(${r}, ${g}, ${b}, 0.42)`, accent: `rgba(${r}, ${g}, ${b}, 0.95)`, title: "rgba(244, 247, 250, 0.96)" };
}

/** The label item for a ranked place, the same object every time it is seen. */
function itemFor(r) {
  const id = `${r.wiki ? "wiki" : "osm"}:${nameKey(r.name)}:${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
  let it = byId.get(id);
  if (it) return it;
  const cat = FLIGHT_CATEGORIES[r.category] || FLIGHT_CATEGORIES["place-landmark"];
  it = {
    id, name: r.name, lat: r.lat, lon: r.lon,
    lod: r.lod, priority: Math.max(0, 6 - r.lod), label_scale: TIER_SIZE[r.lod] || 0.7,
    category: r.category, label_colour: cat.colour, label_palette: palette(cat.colour),
    type: r.type, maxAltKm: r.maxAltKm, reachKm: r.reachKm, area: Boolean(r.area),
    elevation_m: Number.isFinite(r.ele) ? r.ele : undefined,
    description: r.description || "",
    wikiTitle: r.title || null,
    source: r.wiki ? "Wikipedia (CC BY-SA 4.0)" : "© OpenStreetMap contributors (ODbL), via OpenFreeMap",
    flightOnly: true,
  };
  byId.set(id, it);
  return it;
}

/**
 * Every streamed place, deduplicated against itself and against the curated
 * set (`curated`: [{ name, lat, lon }], the GeoHUB's, which always wins).
 */
export function getItems(curated = []) {
  if (cache.version === version) return cache.items;
  const osm = [];
  for (const t of tiles.values()) if (t.state === "done") for (const r of t.items) osm.push(r);
  const wikiPlaces = thinNearby([...wiki.pages.values()]);
  const ranked = dedupe([...osm, ...wikiPlaces], curated);
  stats.osm = osm.length; stats.wiki = wikiPlaces.length; stats.items = ranked.length;
  cache = { version, items: ranked.map(itemFor) };
  return cache.items;
}
export function getVersion() { return version; }

/* ── Tiles ───────────────────────────────────────────────────────────────── */

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../../../flight_sim/earth/game/gazetteer-worker.js?v=1", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const t = jobs.get(e.data.id);
    jobs.delete(e.data.id);
    if (!t || !running) return;
    t.items = e.data.items || [];
    t.state = "done";
    version += 1;
  };
  return worker;
}

async function fetchTile(t) {
  inflight += 1;
  t.state = "loading";
  try {
    const res = await fetch(template.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y));
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    if (!running) return;
    const id = nextJob++;
    jobs.set(id, t);
    ensureWorker().postMessage({ id, z: t.z, x: t.x, y: t.y, layers: t.layers, buf }, [buf]);
  } catch (err) {
    t.state = "failed";
    t.failedAt = performance.now();
  } finally {
    inflight -= 1;
  }
}

function tileCentre(t) {
  const n = 2 ** t.z;
  const lon = (t.x + 0.5) / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (t.y + 0.5) / n))) * 180 / Math.PI;
  return { lat, lon };
}

/* ── Wikipedia ───────────────────────────────────────────────────────────── */

async function askWikipedia(lat, lon) {
  wiki.busy = true;
  try {
    const res = await fetch(wikiGeoUrl(lat, lon));
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    if (!running) return;
    for (const page of Object.values(json?.query?.pages || {})) {
      const r = rankWikipedia(page);
      if (r) wiki.pages.set(page.pageid, r);
    }
    wiki.at = { lat, lon };
    version += 1;
  } catch (err) {
    wiki.retryAt = performance.now() + 60000;     // an outage is not hammered
  } finally {
    wiki.busy = false;
  }
}

function wikiTick(lat, lon, altKm, headingDeg) {
  if (altKm >= WIKI_FROM_KM || wiki.busy || performance.now() < wiki.retryAt) return;
  // A little ahead: what is coming matters more than what is behind.
  const h = (Number(headingDeg) || 0) * Math.PI / 180;
  const ahead = { lat: lat + 3 * Math.cos(h) / 111.32, lon: lon + 3 * Math.sin(h) / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180))) };
  if (wiki.at && distanceKm(wiki.at.lat, wiki.at.lon, ahead.lat, ahead.lon) < WIKI_MOVE_KM) return;
  // Forget what is far behind before asking again.
  for (const [id, r] of wiki.pages) if (distanceKm(lat, lon, r.lat, r.lon) > WIKI_KEEP_KM) wiki.pages.delete(id);
  askWikipedia(ahead.lat, ahead.lon);
}

/* ── The loop ────────────────────────────────────────────────────────────── */

function tick() {
  const f = window.__flightSim;
  if (!running || !f?.active || !f.shipLatLon) return;
  const { lat, lon } = f.shipLatLon;
  const altKm = (Number(f.shipAltUnits) || 0) / UNITS_PER_M / 1000;
  const now = performance.now();
  const want = [];
  for (const ring of ringsFor(altKm)) {
    for (const t of tilesAround(lat, lon, ring.km, ring.z)) {
      const k = `${t.z}/${t.x}/${t.y}`;
      let s = tiles.get(k);
      if (!s) { s = { ...t, layers: ring.layers, state: "queued", items: [] }; tiles.set(k, s); }
      s.used = now;
      const retry = s.state === "failed" && now - s.failedAt > 30000;
      if (s.state === "queued" || retry) {
        const c = tileCentre(s);
        want.push({ s, d: distanceKm(lat, lon, c.lat, c.lon) });
      }
    }
  }
  // Coarse first (a whole region's towns), then nearest.
  want.sort((a, b) => (a.s.z - b.s.z) || (a.d - b.d));
  if (template) for (const w of want) { if (inflight >= FETCHES) break; fetchTile(w.s); }
  // Forget the tiles longest unused beyond the budget.
  if (tiles.size > MAX_TILES) {
    const old = [...tiles.values()].filter((t) => t.state !== "loading" && now - t.used > 5000).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, tiles.size - MAX_TILES)) tiles.delete(`${t.z}/${t.x}/${t.y}`);
    version += 1;
  }
  stats.tiles = tiles.size;
  wikiTick(lat, lon, altKm, f.headingDeg);
}

/** Start streaming places (idempotent). */
export async function startFlightGazetteer() {
  if (running) return;
  running = true;
  if (!template) {
    try { template = (await (await fetch(TILEJSON)).json()).tiles?.[0] || null; } catch (e) { template = null; }
  }
  if (!running || timer) return;
  tick();
  timer = setInterval(tick, TICK_MS);
}

/** Stop and forget (the next flight starts afresh where it is). */
export function stopFlightGazetteer() {
  running = false;
  clearInterval(timer);
  timer = null;
  tiles.clear();
  jobs.clear();
  wiki.pages.clear();
  wiki.at = null;
  byId.clear();
  version += 1;
  worker?.terminate();
  worker = null;
}

/** A Wikipedia place's summary, for its card (null when there is none). */
export async function wikiSummary(title) {
  if (!title) return null;
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (!res.ok) return null;
    const j = await res.json();
    return { extract: j.extract || "", url: j.content_urls?.desktop?.page || null };
  } catch (e) {
    return null;
  }
}

export function creditNow() {
  if (!running || !stats.items) return null;
  return {
    title: "Earth Flight places",
    source: "Place names from OpenStreetMap (OpenFreeMap vector tiles: place, mountain_peak, park, aerodrome_label and water_name layers, z8/z11); landmarks, buildings and historic sites from Wikipedia's geosearch (articles within 10 km, ranked by article length)",
    citation: "© OpenStreetMap contributors, ODbL 1.0; tiles: OpenFreeMap (openfreemap.org), OpenMapTiles schema © OpenMapTiles. Landmark names and descriptions: Wikipedia, CC BY-SA 4.0.",
    crs: "WGS 84 points",
    licence: "ODbL 1.0 (OpenStreetMap); CC BY-SA 4.0 (Wikipedia)",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDFlightGazetteer = { startFlightGazetteer, stopFlightGazetteer, getItems, getVersion, wikiSummary, stats, creditNow };
}
