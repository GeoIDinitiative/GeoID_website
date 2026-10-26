// Where Earth Flight is: the nation under the aircraft and the nearest town.
//
// The instrument panel was captioned "Earth atmosphere" and the heading tape
// named a Mars region (the shared sim had no Earth gazetteer, so it fell back
// to "NORTHERN LOWLANDS"). Owner, 2026-10-24: "maybe instead of 'Earth
// Atmosphere' the reader changes by nation and location". So:
//
//   * TITLE: the country whose outline holds the aircraft -- the Natural
//     Earth admin-0 outlines GeoHUB already serves (data/global/
//     countries_50m.geojson) -- or, over water, the nearest named sea within
//     400 km, else "Open sea";
//   * REGION: "OVER <town>" within 4 km of a gazetteer city, "NEAR <town>"
//     within 60 km, else the nearest named landform, lake or mountain within
//     40 km, else the title again.
//
// Places come from the globe's own gazetteer (GeoIDViewer.getAllPlaceItems),
// whether or not the Location labels switch is on. Looked up every 2 s.

import { dataUrl } from "./data-base.js?v=20261026-cbf1b2a";

// A published dataset: local first, R2 when the local copy is not served (data-base.js).
const COUNTRIES_PATH = "/data/global/countries_50m.geojson";
const R_KM = 6371;

/** Great-circle distance, km. */
export function distKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Even-odd test of a point against one polygon's rings ([lon, lat] pairs). */
export function inRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Index a FeatureCollection of country outlines: [{ name, box, polys }]. */
export function indexCountries(fc) {
  const out = [];
  for (const f of fc?.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of polys) {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of rings[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      out.push({ name: f.properties?.name || f.properties?.admin || "", box: [w, s, e, n], rings });
    }
  }
  return out;
}

export function countryAt(index, lat, lon) {
  for (const c of index) {
    const [w, s, e, n] = c.box;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (inRings(lon, lat, c.rings)) return c.name;
  }
  return null;
}

const nameOf = (item) => String(item.name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim();

/** The two readouts for a point, from the outlines and the gazetteer. */
export function describe(index, places, lat, lon) {
  const here = { lat, lon };
  const country = index ? countryAt(index, lat, lon) : null;
  const nearest = (cats, maxKm) => {
    let best = null, bd = maxKm;
    for (const p of places) {
      if (!cats.includes(p.category)) continue;
      const d = distKm(here, p);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { item: best, km: bd } : null;
  };
  let title = country;
  if (!title) {
    const sea = nearest(["place-marine"], 400);
    title = sea ? nameOf(sea.item) : "Open sea";
  }
  let region = null;
  const town = nearest(["place-city"], 60);
  if (town) region = `${town.km < 4 ? "Over" : "Near"} ${nameOf(town.item)}`;
  else {
    const feature = nearest(["place-landform", "place-mountain", "place-lake", "place-volcano", "place-island"], 40);
    region = feature ? `Near ${nameOf(feature.item)}` : title;
  }
  return { title, region: region.toUpperCase() };
}

/* ── Browser ────────────────────────────────────────────────────────────── */

let index = null, loading = false, places = null, placesAt = 0;
let last = { at: 0, lat: NaN, lon: NaN, value: null };

function ensure() {
  if (!index && !loading) {
    loading = true;
    dataUrl(COUNTRIES_PATH).then((url) => fetch(url)).then((r) => (r.ok ? r.json() : null)).then((fc) => { index = indexCountries(fc); })
      .catch(() => { index = []; });
  }
  // Re-read until the gazetteer has arrived, then every 30 s.
  if (!places?.length || performance.now() - placesAt > 30000) {
    placesAt = performance.now();
    places = (window.GeoIDViewer?.getAllPlaceItems?.() || []).filter((p) => p.category && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
}

/** The readouts for the aircraft's position, recomputed at most every 2 s. */
export function placeNow(lat, lon) {
  ensure();
  const now = performance.now();
  if (last.value && now - last.at < 2000) return last.value;
  last = { at: now, lat, lon, value: describe(index, places || [], lat, lon) };
  return last.value;
}

if (typeof window !== "undefined") window.GeoIDFlightPlace = { placeNow };
