/**
 * Earth Flight's gazetteer: every named place worth a label, from the
 * OpenStreetMap vector tiles the flight already streams (OpenFreeMap,
 * OpenMapTiles schema), ranked into the GeoHUB's significance hierarchy.
 *
 * Owner, 2026-10-25: the GeoHUB globe keeps its generalised labels, while
 * "the flight sim should be all encompassing, like a location museum as we
 * fly -- showing cities, buildings of interest, historical sites", with "the
 * same significance hierarchy and relative sizing", and shown dynamically:
 * "the White House should be visible at low altitudes but not at high
 * altitudes".
 *
 * Two sources:
 *   * the OSM tiles at z8 and z11: settlements, peaks and volcanoes, national
 *     parks and reserves, airports, lakes and seas;
 *   * Wikipedia's geosearch near the aircraft, low down: the buildings,
 *     landmarks, museums, churches and historic sites -- the tiles' POI layer
 *     only exists at z14 (880 KB a tile over Rome) and misses the famous ones
 *     (the White House is not in it at all, the Lincoln Memorial is a "park"),
 *     while an article's length says how notable a place is.
 *
 * So each feature gets
 *   lod       1 (continental) .. 7 (a single building), the GeoHUB's tiers 1-5
 *             extended by two for what only flight shows; size follows it;
 *   maxAltKm  the highest the aircraft can be and still see it labelled;
 *   reachKm   how far from the aircraft it is labelled at all;
 * and a category with its colour. Pure: tested in Node.
 */

// Flight-only categories, beside the GeoHUB's (earth-viewer.js
// PLACE_CATEGORIES), whose cities, islands, mountains, volcanoes, lakes and
// seas keep their colours.
export const FLIGHT_CATEGORIES = {
  "place-city": { label: "Cities & towns", colour: "#f0eef4" },
  "place-island": { label: "Islands", colour: "#8fd67a" },
  "place-mountain": { label: "Mountains", colour: "#d9c6a0" },
  "place-volcano": { label: "Volcanoes", colour: "#ff6f55" },
  "place-lake": { label: "Lakes", colour: "#8ee6e0" },
  "place-marine": { label: "Oceans & seas", colour: "#4fa8e8" },
  "place-landmark": { label: "Landmarks", colour: "#ffd166" },
  "place-heritage": { label: "Historic sites", colour: "#c9a0ff" },
  "place-culture": { label: "Museums & culture", colour: "#ff9ecb" },
  "place-worship": { label: "Places of worship", colour: "#b8c7ff" },
  "place-park": { label: "Parks & reserves", colour: "#7fd38a" },
  "place-airport": { label: "Airports", colour: "#9fc3dc" },
};

// The visibility window by tier: how high, and how far. Tiers 1-4 are the
// GeoHUB's own (the curated set, flight-labels.js keeps its reach rules for
// them); 5-7 are what flight adds as it comes down.
export const TIER_WINDOW = {
  1: { maxAltKm: Infinity, reachKm: 700 },
  2: { maxAltKm: Infinity, reachKm: 500 },
  3: { maxAltKm: 120, reachKm: 300 },
  4: { maxAltKm: 40, reachKm: 150 },
  5: { maxAltKm: 15, reachKm: 60 },
  6: { maxAltKm: 6, reachKm: 22 },
  7: { maxAltKm: 2.5, reachKm: 8 },
};

// Label size by tier, relative to tier 4 (the GeoHUB's [1.55, 1.30, 1.10,
// 1.0, 0.88], continued down).
export const TIER_SIZE = [1, 1.55, 1.30, 1.10, 1.0, 0.88, 0.78, 0.70];

const win = (lod, extra = {}) => ({ lod, ...TIER_WINDOW[lod], ...extra });

const cap = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Rank one decoded feature. `layer` is the OpenMapTiles layer, `p` its
 * properties, `z` the tile zoom it came from. Null for anything not worth a
 * label (or not named).
 */
export function rankFeature(layer, p, z) {
  const name = p && (p.name_en || p["name:en"] || p.name_int || p.name);
  if (!name) return null;
  const cls = p.class || "";
  const rank = Number(p.rank);
  if (layer === "place") {
    if (cls === "city") {
      const lod = p.capital === 2 ? 2 : (rank <= 4 ? 3 : 4);
      return { name, category: "place-city", type: p.capital === 2 ? "Capital city" : "City", ...win(lod) };
    }
    if (cls === "town") return { name, category: "place-city", type: "Town", ...win(5) };
    if (cls === "village") return { name, category: "place-city", type: "Village", ...win(6) };
    if (cls === "suburb" || cls === "quarter") return { name, category: "place-city", type: cap(cls), ...win(6, { maxAltKm: 4, reachKm: 12 }) };
    if (cls === "hamlet" || cls === "neighbourhood" || cls === "isolated_dwelling") return { name, category: "place-city", type: cap(cls), ...win(7) };
    if (cls === "island" || cls === "islet") return { name, category: "place-island", type: cap(cls), area: true, ...win(cls === "island" ? 5 : 7) };
    return null;                         // countries and states: the HUD names them
  }
  if (layer === "mountain_peak") {
    if (cls !== "peak" && cls !== "volcano") return null;
    const ele = Number(p.ele);
    const lod = ele >= 4000 ? 4 : ele >= 2500 ? 5 : ele >= 1000 ? 6 : 7;
    return { name, category: cls === "volcano" ? "place-volcano" : "place-mountain", type: cls === "volcano" ? "Volcano" : "Peak", ele: Number.isFinite(ele) ? ele : null, ...win(lod) };
  }
  if (layer === "park") {
    if (cls === "national_park") return { name, category: "place-park", type: "National park", area: true, ...win(4) };
    if (cls === "historic") return { name, category: "place-heritage", type: "Historic site", ...win(6) };
    if (cls === "nature_reserve" || cls === "protected_area" || cls === "wildlife_refuge") return { name, category: "place-park", type: cap(cls), area: true, ...win(6) };
    return null;
  }
  if (layer === "aerodrome_label") {
    if (cls === "international") return { name, category: "place-airport", type: "International airport", ...win(5) };
    if (cls === "public" || cls === "regional") return { name, category: "place-airport", type: "Airport", ...win(6) };
    return null;
  }
  if (layer === "water_name") {
    if (cls === "lake") return { name, category: "place-lake", type: "Lake", area: true, ...win(z <= 8 ? 5 : 6) };
    if (cls === "sea" || cls === "bay" || cls === "strait") return { name, category: "place-marine", type: cap(cls), area: true, ...win(4) };
    return null;
  }
  return null;
}

/** A normalised name, for telling the same place apart from a near namesake. */
export function nameKey(name) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Ground distance (km) between two points. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drop duplicates: the same name within a few km is the same place, whichever
 * zoom (or the curated set) it came from. The most significant copy wins;
 * curated places always win, since they carry the GeoHUB's descriptions.
 * `curated` is [{ name, lat, lon }].
 */
export function dedupe(items, curated = []) {
  const near = (lod) => (lod <= 3 ? 25 : lod <= 5 ? 6 : 1.5);
  const byName = new Map();
  for (const c of curated) {
    const k = nameKey(c.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ ...c, curated: true });
  }
  const out = [];
  for (const it of [...items].sort((a, b) => a.lod - b.lod)) {
    const k = nameKey(it.name);
    const list = byName.get(k) || [];
    if (list.some((o) => distanceKm(o.lat, o.lon, it.lat, it.lon) < Math.max(near(it.lod), near(o.lod || 7)))) continue;
    list.push(it);
    byName.set(k, list);
    out.push(it);
  }
  return out;
}

/** Slippy tiles at zoom z within `km` of a point. */
export function tilesAround(lat, lon, km, z) {
  const n = 2 ** z;
  const x = (lo) => Math.floor((lo + 180) / 360 * n);
  const y = (la) => {
    const r = Math.max(-85, Math.min(85, la)) * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  };
  const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  const out = [];
  for (let ty = y(lat + dLat); ty <= y(lat - dLat); ty++) {
    for (let tx = x(lon - dLon); tx <= x(lon + dLon); tx++) out.push({ z, x: ((tx % n) + n) % n, y: ty });
  }
  return out;
}

/** Tile pixel (0..extent) to lat/lon. */
export function tilePointToLatLon(z, x, y, px, py, extent = 4096) {
  const n = 2 ** z;
  const lon = (x + px / extent) / n * 360 - 180;
  const t = Math.PI * (1 - 2 * (y + py / extent) / n);
  return { lat: Math.atan(Math.sinh(t)) * 180 / Math.PI, lon };
}

/**
 * Which tile rings to stream at this altitude: zoom, radius (km), and the
 * layers each carries. The village ring only near the ground, where its tiers
 * can be seen at all (TIER_WINDOW).
 */
const RING_LAYERS = ["place", "mountain_peak", "park", "aerodrome_label", "water_name"];
export function ringsFor(altKm) {
  const rings = [{ z: 8, km: altKm > 10 ? 260 : 140, layers: RING_LAYERS }];
  if (altKm < 8) rings.push({ z: 11, km: 26, layers: RING_LAYERS });
  return rings;
}

/* ── Wikipedia ───────────────────────────────────────────────────────────── */

/** Below this the aircraft asks Wikipedia what is round it (the highest wiki window). */
export const WIKI_FROM_KM = 5;

// The windows of the Wikipedia tiers: tighter than the tiles' tiers of the
// same number, because a building is smaller than a village.
const WIKI_WINDOW = {
  5: { maxAltKm: 5, reachKm: 20 },
  6: { maxAltKm: 3, reachKm: 9 },
  7: { maxAltKm: 1.6, reachKm: 4 },
};

// What a place is, from its description, for the category and the card's
// kicker. First match wins.
const WIKI_KINDS = [
  [/\b(museum|gallery)\b/, "place-culture", "Museum"],
  [/\b(cathedral)\b/, "place-worship", "Cathedral"],
  [/\b(basilica|church|chapel|mosque|temple|synagogue|shrine|abbey|monastery|priory|minster)\b/, "place-worship", "Place of worship"],
  [/\b(castle|palace|fort|fortress|citadel|ruins?|archaeolog\w*|roman|ancient|medieval|historic\w*|tomb|mausoleum|cemetery|battlefield|city gate|city wall)\b/, "place-heritage", "Historic site"],
  [/\b(theatre|theater|opera|concert hall|library|university|college)\b/, "place-culture", "Culture"],
  [/\b(memorial|monument|statue|obelisk)\b/, "place-landmark", "Memorial"],
  [/\b(park|garden|gardens|zoo|reserve)\b/, "place-park", "Park"],
  [/\b(lake|reservoir|river|canal|waterfall)\b/, "place-lake", "Water"],
  [/\b(island|isle)\b/, "place-island", "Island"],
  [/\b(mountain|hill|peak|volcano|summit)\b/, "place-mountain", "Mountain"],
  [/\b(airport)\b/, "place-airport", "Airport"],
];
const PLACE_WORDS = /\b(buildings?|headquarters|development|museum|gallery|church|cathedral|basilica|chapel|mosque|temple|synagogue|shrine|abbey|monastery|memorial|monument|statue|obelisk|park|garden|square|plaza|bridge|tower|castle|palace|fort|fortress|ruins?|archaeolog\w*|historic\w*|house|hall|theatre|theater|opera|stadium|arena|library|university|college|station|airport|lighthouse|harbou?r|port|dam|canal|lake|river|island|mountain|hill|volcano|cave|beach|waterfall|zoo|aquarium|market|street|avenue|neighbou?rhood|district|village|town|city|cemetery|tomb|site|landmark|skyscraper|hotel|mansion|estate|villa|gate|wall|arch|fountain|observatory|embassy|capitol|courthouse|residence|tree)\b/;
// Rooms and wings of a building: the building is the place.
const INTERIOR = /\b(room|ballroom|suite|corridor|wing|hallway|staircase)\b/;
const NOT_PLACE = /\b(agency|organi[sz]ation|company|corporation|think tank|advocacy|political|party|program(me)?|project|episode|album|song|film|novel|newspaper|magazine|band|politician|incident|protest|riot|shooting|scandal|lawsuit|case|election|treaty|operation|campaign|festival|award|team|club|league|association|foundation|institute|society|union|council|committee|department|ministry|bureau|service|series)\b/;
const PLACE_TYPES = new Set(["landmark", "edu", "railwaystation", "airport", "waterbody", "isle", "mountain", "river", "glacier", "forest"]);

/**
 * Rank one page from Wikipedia's geosearch (prop=coordinates|description|
 * info, coprop=type). Null for what is not a place you could fly over: an
 * agency at its headquarters, an event, a district or a country.
 */
export function rankWikipedia(page) {
  const c = page?.coordinates?.[0];
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !page.title) return null;
  const type = c.type || "";
  if (/^(event|adm\w*|country|state|city)$/.test(type)) return null;   // the tiles and the HUD name those
  const d = String(page.description || "").toLowerCase();
  const placeWord = PLACE_WORDS.test(d);
  if (!PLACE_TYPES.has(type) && !placeWord) return null;
  if (NOT_PLACE.test(d) && !placeWord) return null;
  if (INTERIOR.test(d)) return null;
  const len = Number(page.length) || 0;
  const lod = len >= 90000 ? 5 : len >= 30000 ? 6 : 7;
  const kind = WIKI_KINDS.find(([re]) => re.test(d));
  const category = kind ? kind[1] : type === "railwaystation" ? "place-landmark" : "place-landmark";
  const kindName = kind ? kind[2] : type === "railwaystation" ? "Station" : "Landmark";
  return {
    // "Lafayette Square, Washington, D.C." and "Old Post Office (Washington,
    // D.C.)": the place's own name, without the disambiguation.
    name: page.title.replace(/\s*\([^)]*\)\s*$/, "").replace(/,.*$/, ""),
    title: page.title,
    lat: c.lat, lon: c.lon,
    category, type: kindName,
    description: page.description || "",
    wiki: true,
    lod, ...WIKI_WINDOW[lod],
  };
}

/**
 * Within `metres` of a more notable place, a place is part of it (a building's
 * annexes, a monument's plaques): the more notable one is kept. Items must
 * carry lat, lon and lod.
 */
export function thinNearby(items, metres = 80) {
  const kept = [];
  for (const it of [...items].sort((a, b) => a.lod - b.lod)) {
    if (kept.some((k) => k.lod <= it.lod && distanceKm(k.lat, k.lon, it.lat, it.lon) * 1000 < metres)) continue;
    kept.push(it);
  }
  return kept;
}

/** The geosearch URL for a point (10 km is the API's own limit). */
export function wikiGeoUrl(lat, lon, km = 10) {
  const r = Math.round(Math.min(10, km) * 1000);
  return "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*"
    + `&generator=geosearch&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&ggsradius=${r}&ggslimit=500`
    + "&prop=coordinates|description|info&coprop=type&colimit=max";
}
