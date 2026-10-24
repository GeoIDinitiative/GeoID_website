/**
 * Live data connectors — the public sources that can actually be fetched.
 *
 * The ingest catalogue describes eleven domains of data; most of them are
 * portals with logins and terms, and for those an honest "open the portal" link
 * is all a static site can offer. But a few sources are open: no key, no login,
 * CORS-enabled, and free. Those get a real fetch here — a button that returns
 * data into the project rather than a link that sends you elsewhere.
 *
 * Each connector is split into a pure URL builder and a pure GeoJSON converter,
 * with the one impure `fetch` on top. That split is what lets the converters be
 * tested against recorded payloads with no network (connectors.test.mjs), which
 * is where the shape assumptions actually get checked.
 *
 * Everything a connector returns carries its provenance — the exact endpoint and
 * query, and when it ran — because a pulled file that cannot say where it came
 * from is worse than no file (Phase 5 of the roadmap: the monitor that watches
 * incoming data is only trustworthy if this is).
 */

import { createLedger, latestGlaciers, pieceAreaKm2 }
  from "../glacier-outlines.js?v=20261024-8839ad0";

/** N days ago as an ISO date (YYYY-MM-DD). */
function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * The project's study area as a signed bbox, or null for a global pull.
 * `updateMetadata` stores signed -180..180, which is what every API here wants.
 */
export function studyBbox(area) {
  if (!area) return null;
  const nums = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => Number(area[k]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [minLat, maxLat, minLon, maxLon] = nums;
  if (maxLat - minLat === 0 && maxLon - minLon === 0) return null;   // the zero default
  return { minLat, maxLat, minLon, maxLon };
}

// ── USGS earthquakes (FDSN event service) ─────────────────────────────────────
// Real-time global seismicity, returned as GeoJSON already. CORS-open, no key.

function usgsUrl({ bbox, days = 30, minMagnitude = 2.5, limit = 2000 } = {}) {
  const params = new URLSearchParams({
    format: "geojson", orderby: "time", limit: String(limit),
    starttime: daysAgoISO(days), minmagnitude: String(minMagnitude),
  });
  if (bbox) {
    params.set("minlatitude", String(bbox.minLat));
    params.set("maxlatitude", String(bbox.maxLat));
    params.set("minlongitude", String(bbox.minLon));
    params.set("maxlongitude", String(bbox.maxLon));
  }
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`;
}

// Already a FeatureCollection; keep the geometry, slim the properties to the
// ones a reader wants, and normalise the time to an ISO string.
export function usgsToGeoJSON(payload) {
  const features = (payload?.features || [])
    .filter((f) => f?.geometry?.coordinates)
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        title: f.properties?.title || f.properties?.place || "earthquake",
        magnitude: f.properties?.mag ?? null,
        place: f.properties?.place || "",
        time: f.properties?.time ? new Date(f.properties.time).toISOString() : null,
        depth_km: Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates[2] ?? null : null,
        url: f.properties?.url || "",
      },
    }));
  return { type: "FeatureCollection", features };
}

// ── NASA EONET (natural events) ───────────────────────────────────────────────
// Wildfires, volcanoes, storms, ice — as tracked events. CORS-open, no key.

function eonetUrl({ days = 60, category = "", limit = 500, status = "open" } = {}) {
  const params = new URLSearchParams({ days: String(days), limit: String(limit), status });
  if (category) params.set("category", category);
  return `https://eonet.gsfc.nasa.gov/api/v3/events?${params}`;
}

// An event carries a list of dated geometries (a storm track, a fire's growth);
// take the most recent point of each as the feature, which is where the event
// is now.
export function eonetToGeoJSON(payload) {
  const features = [];
  for (const event of payload?.events || []) {
    const geometries = Array.isArray(event.geometry) ? event.geometry : [];
    const last = geometries[geometries.length - 1];
    if (!last || !Array.isArray(last.coordinates)) continue;
    // EONET points are [lon, lat]; polygons we reduce to their first coordinate,
    // enough to place the event without carrying its whole footprint.
    const coords = last.type === "Point" ? last.coordinates
      : Array.isArray(last.coordinates[0]?.[0]) ? last.coordinates[0][0]
      : last.coordinates[0];
    if (!Array.isArray(coords) || coords.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [coords[0], coords[1]] },
      properties: {
        title: event.title || "event",
        category: (event.categories || []).map((c) => c.title).join(", "),
        date: last.date || null,
        eventId: event.id || "",
        source: (event.sources || [])[0]?.url || "",
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// ── NWS active weather alerts (api.weather.gov) ───────────────────────────────
// Live US watches/warnings as polygons, GeoJSON already. CORS-open, no key.

function nwsUrl() {
  return "https://api.weather.gov/alerts/active?status=actual&message_type=alert";
}
export function nwsToGeoJSON(payload) {
  const features = (payload?.features || [])
    .filter((f) => f?.geometry?.coordinates)   // many alerts reference zones, no geometry
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        event: f.properties?.event || "alert",
        headline: f.properties?.headline || "",
        severity: f.properties?.severity || "",
        area: f.properties?.areaDesc || "",
        effective: f.properties?.effective || null,
        expires: f.properties?.expires || null,
      },
    }));
  return { type: "FeatureCollection", features };
}

// ── USGS streamflow (Water Services, instantaneous values) ────────────────────
// Active US gauges with their latest discharge. CORS-open, no key. Needs a bbox
// (US only), so it requires a study area.

function usgsWaterUrl({ bbox } = {}) {
  if (!bbox) throw new Error("USGS streamflow needs a study area over the US — draw one first.");
  // USGS bBox is west,south,east,north and capped at a ~25° span per side.
  const bBox = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].map((n) => n.toFixed(6)).join(",");
  const params = new URLSearchParams({ format: "json", bBox, parameterCd: "00060", siteStatus: "active" });
  return `https://waterservices.usgs.gov/nwis/iv/?${params}`;
}
export function usgsWaterToGeoJSON(payload) {
  const series = payload?.value?.timeSeries || [];
  const features = [];
  for (const ts of series) {
    const geo = ts.sourceInfo?.geoLocation?.geogLocation;
    const lat = Number(geo?.latitude);
    const lon = Number(geo?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const readings = ts.values?.[0]?.value || [];
    const latest = readings[readings.length - 1];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        site: ts.sourceInfo?.siteCode?.[0]?.value || "",
        siteName: ts.sourceInfo?.siteName || "",
        discharge_cfs: latest ? Number(latest.value) : null,
        time: latest?.dateTime || null,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// ── Submarine cables and landing stations (Greg's Cable Map, via ArcGIS) ─────
/**
 * The world's submarine cables, and where they come ashore.
 *
 * **Not** submarinecablemap.com, and not for want of trying: TeleGeography's
 * API answers 200 to curl and sends **no `Access-Control-Allow-Origin`
 * header**, so a browser cannot read it whatever the licence says — and the
 * licence does not allow it either, since TeleGeography sells an annual
 * licence for the geocoded data and publishes the map CC BY-NC-SA
 * (NonCommercial).
 *
 * This is **Greg's Cable Map** — an independent survey, published under the
 * **GNU GPL**, which permits commercial use with attribution — served as an
 * ArcGIS FeatureServer that answers `f=geojson` with CORS `*`. Measured: 285
 * cables and 737 landing stations, each complete in ONE request (285 against
 * a maxRecordCount of 2000, `exceededTransferLimit` absent), 780 KB and
 * 150 KB.
 *
 * An OpenStreetMap version came first and was replaced: ODbL and honest, but
 * 199 systems to this one's 285, and with no landing points at all. The two
 * layers here are the pair the satellite tracker draws — the PATH and the
 * DOT — which is why they arrive together.
 *
 * Honest limit: the survey's own currency. `InService` years run to the late
 * 2010s, so cables lit since are missing. TeleGeography's roughly 600 systems
 * remains the fuller map, behind their licence.
 */
const CABLE_SERVICE = "https://services.arcgis.com/bDAhvQYMG4WL8O5o/arcgis/rest"
  + "/services/Global_Submarine_Cable_Map/FeatureServer";

/** ArcGIS speaks GeoJSON directly when asked; outSR pins it to WGS84. */
function cableLayerUrl(layerId) {
  const params = new URLSearchParams({
    where: "1=1", outFields: "*", outSR: "4326", f: "geojson",
  });
  return `${CABLE_SERVICE}/${layerId}/query?${params}`;
}

export function submarineCablesUrl() { return cableLayerUrl(1); }
export function cableLandingsUrl() { return cableLayerUrl(0); }

/** Kilometres along a lon/lat path. */
function pathKm(line) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  let km = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    const a = Math.sin(toRad(y2 - y1) / 2) ** 2
      + Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(toRad(x2 - x1) / 2) ** 2;
    km += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return km;
}

/**
 * Cables to the shape the label engine and the click card already read.
 *
 * `label_rank` is LENGTH in bands — significance the geometry itself supports,
 * so the layer never invents any. The survey's own `Distance_K` is preferred
 * where it has one, because that is the operator's figure for the cable rather
 * than the drawn polyline's.
 *
 * `NotLive` is carried rather than filtered: a planned or retired cable is a
 * true fact about the seabed, and the card says which it is.
 */
export function submarineCablesToGeoJSON(payload) {
  const features = (payload?.features || []).map((f) => {
    const p = f?.properties || {};
    const parts = f?.geometry?.type === "MultiLineString" ? f.geometry.coordinates
      : (f?.geometry?.type === "LineString" ? [f.geometry.coordinates] : []);
    if (!parts.length) return null;
    const name = String(p.Name || "").trim();
    const stated = Number(p.Distance_K);
    const km = Number.isFinite(stated) && stated > 0
      ? stated : parts.reduce((sum, part) => sum + pathKm(part), 0);
    const rank = km >= 10000 ? 5 : km >= 4000 ? 4 : km >= 1500 ? 3 : km >= 300 ? 2 : 1;
    return {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: parts },
      properties: {
        name,
        kind: "Submarine cable",
        length_km: Math.round(km),
        capacity_gbps: Number(p.Capacity_G) || null,
        in_service: Number(p.InService) || null,
        status: p.NotLive ? "Not in service" : "In service",
        homepage: p.URL1 || "",
        wikipedia: p.URL2 || "",
        notes: String(p.Notes || "").trim(),
        label_rank: name ? rank : 0,
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

/**
 * Landing stations — the DOTS the cables run between.
 *
 * Ranked below the cables on purpose: with both layers on, a name every time
 * a cable touches land would bury the cable names, and the cable is the thing
 * the map is about. `label_rank: 1` puts them at the bottom of the same
 * declutter the volcanoes use, so they appear as you come in.
 */
export function cableLandingsToGeoJSON(payload) {
  const features = (payload?.features || []).map((f) => {
    const p = f?.properties || {};
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    const name = String(p.Name || "").trim();
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c[0], c[1]] },
      properties: {
        name,
        kind: "Cable landing station",
        country: String(p.Country || "").trim(),
        owner: String(p.Owner || "").trim(),
        location: String(p.ExactLocat || "").trim(),
        label_rank: name ? 1 : 0,
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

// ── Active fire detections (NASA FIRMS, via GIBS vector tiles) ───────────────
/**
 * Today's thermal anomalies — MODIS and VIIRS — with no key and no proxy.
 *
 * This is FIRMS data, and FIRMS' own routes are both closed to a browser:
 * the bulk CSVs answer 200 to curl and send **no `Access-Control-Allow-Origin`
 * header** (measured; and VIIRS is 17.7 MB a day), while the API and WFS are
 * CORS-open but need a MAP_KEY — and a browser cannot hold a secret, which is
 * the rule the sidecar exists for.
 *
 * GIBS publishes the same detections as MAPBOX VECTOR TILES, keyless and
 * CORS `*`, and `gis/mvt.js` — written for Macrostrat — already decodes them.
 * The whole world is TWO tiles, because EPSG:4326 is two tiles wide at zoom
 * zero; fetching only `0/0/0`, as the first attempt did, silently returns the
 * western hemisphere and calls it global.
 *
 * Measured on one day: MODIS combined 16,905 detections over 1.6 MB, VIIRS
 * S-NPP 97,814 over 8.2 MB. Both are served gzipped — curl hands back the
 * compressed bytes unless asked otherwise, which looks like a corrupt tile;
 * `fetch` decompresses transparently, so this is only ever a testing trap.
 *
 * NOT the same thing as the Events tab's EONET wildfires, and neither
 * replaces the other. EONET is curated NAMED EVENTS and measured 496 of 500
 * in North America — it will never show a fire in Northern Ireland. These are
 * raw observations: every pixel that looked hot, anywhere, with its intensity.
 */
const FIRE_SENSORS = {
  modis: {
    label: "Active fires — MODIS (Terra + Aqua)",
    layer: "MODIS_Combined_Thermal_Anomalies_All",
    // The 4326 endpoint's own matrix sets, which are NOT the 3857 endpoint's
    // GoogleMapsCompatible_* names the capabilities document lists first.
    matrixSet: "1km",
    resolution: "1 km",
    // MODIS calls it BRIGHTNESS; VIIRS calls the same measurement BRIGHT_TI4.
    brightnessKey: "BRIGHTNESS",
  },
  "viirs-snpp": {
    label: "Active fires — VIIRS (Suomi NPP, 375 m)",
    layer: "VIIRS_SNPP_Thermal_Anomalies_375m_All",
    matrixSet: "500m",
    resolution: "375 m",
    brightnessKey: "BRIGHT_TI4",
  },
  "viirs-noaa20": {
    label: "Active fires — VIIRS (NOAA-20, 375 m)",
    layer: "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
    matrixSet: "500m",
    resolution: "375 m",
    brightnessKey: "BRIGHT_TI4",
  },
};

export const fireSensorIds = () => Object.keys(FIRE_SENSORS);
export const fireSensor = (id) => FIRE_SENSORS[id] || null;

/** Today, UTC — these layers accumulate through the day and today is served. */
export function fireDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * The two tiles that are the whole world.
 *
 * EPSG:4326 zoom 0 is a 2x1 matrix — `{z}/{row}/{col}`, so `0/0/0` and
 * `0/0/1`. One of them is half the planet.
 */
export function fireTileUrls(sensorId, date = fireDate()) {
  const sensor = FIRE_SENSORS[sensorId];
  if (!sensor) throw new Error(`Unknown fire sensor: ${sensorId}`);
  const base = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
  return [0, 1].map((col) =>
    `${base}/${sensor.layer}/default/${date}/${sensor.matrixSet}/0/0/${col}.mvt`);
}

/**
 * Confidence, as one vocabulary across two sensors.
 *
 * MODIS reports 0–100; VIIRS reports "l"/"n"/"h". Colouring by the raw column
 * would give one layer a hundred classes and the other three, and the two
 * would never share a legend. The thresholds are FIRMS' own published bands.
 */
export function confidenceBand(raw) {
  if (raw == null || raw === "") return "unknown";
  const text = String(raw).trim().toLowerCase();
  if (text === "h" || text === "high") return "high";
  if (text === "n" || text === "nominal") return "nominal";
  if (text === "l" || text === "low") return "low";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 80) return "high";
  if (n >= 30) return "nominal";
  return "low";
}

/**
 * Decoded MVT layers to one normalised FeatureCollection.
 *
 * The features carry LATITUDE/LONGITUDE as PROPERTIES, so the geometry is
 * rebuilt from those rather than from the tile's own projected coordinates —
 * which sidesteps the 4326-vs-3857 tile transform entirely and is exact
 * rather than quantised to the tile's extent grid.
 *
 * `label_rank: 0` on every feature, deliberately: ninety-eight thousand names
 * is a white planet, and a thermal anomaly has no name to write. The gate in
 * point-labels reads the COLUMN's presence, so the card contract still works
 * — a detection is clickable and reads as one.
 */
export function firesToGeoJSON(decodedLayers, sensorId) {
  const sensor = FIRE_SENSORS[sensorId] || FIRE_SENSORS.modis;
  const features = [];
  const seen = new Set();
  (decodedLayers || []).forEach((byLayer) => {
    Object.values(byLayer || {}).forEach((list) => {
      (list || []).forEach((f) => {
        const p = f?.properties || {};
        const lat = Number(p.LATITUDE);
        const lon = Number(p.LONGITUDE);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        // The two world tiles meet at the antimeridian and a detection on the
        // seam is carried by both; UID is FIRMS' own per-detection id.
        const key = `${p.UID ?? ""}|${lat.toFixed(5)}|${lon.toFixed(5)}|${p.ACQ_TIME ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        const frp = Number(p.FRP);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            kind: "Active fire detection",
            sensor: sensor.resolution === "375 m" ? "VIIRS" : "MODIS",
            satellite: String(p.SATELLITE || "").trim(),
            // Kelvin, and named so: a bare "brightness" invites a reader to
            // take it for a colour value.
            brightness_k: Number(p[sensor.brightnessKey]) || null,
            frp_mw: Number.isFinite(frp) ? frp : null,
            confidence: confidenceBand(p.CONFIDENCE),
            confidence_raw: p.CONFIDENCE ?? null,
            acquired: `${p.ACQ_DATE || ""} ${p.ACQ_TIME || ""}`.trim(),
            daynight: p.DAYNIGHT === "N" ? "Night" : (p.DAYNIGHT === "D" ? "Day" : ""),
            resolution: sensor.resolution,
            label_rank: 0,
          },
        });
      });
    });
  });
  return { type: "FeatureCollection", features };
}

/**
 * Fetch both world tiles, decode, normalise. The one impure part.
 *
 * `mvt.js` is imported lazily: most sessions never ask for fires, and the
 * decoder is dead weight in every one of them otherwise. A tile that 404s is
 * an empty hemisphere rather than a failure — GIBS omits a tile with no
 * detections in it — so one missing half must not lose the other.
 */
export async function loadFireDetections(sensorId, { date = fireDate() } = {}) {
  const sensor = FIRE_SENSORS[sensorId];
  if (!sensor) throw new Error(`Unknown fire sensor: ${sensorId}`);
  const { decodeTile } = await import(`../mvt.js${new URL(import.meta.url).search}`);
  const urls = fireTileUrls(sensorId, date);
  const decoded = [];
  let reached = 0;
  for (let col = 0; col < urls.length; col += 1) {
    let response;
    try {
      response = await fetch(urls[col]);
    } catch (error) {
      throw new Error(`Could not reach NASA GIBS for ${sensor.label}.`);
    }
    if (response.status === 404) continue;   // that half had no detections
    if (!response.ok) throw new Error(`GIBS returned HTTP ${response.status}.`);
    reached += 1;
    // `fetch` has already undone the gzip GIBS serves these with.
    const buffer = await response.arrayBuffer();
    decoded.push(decodeTile(buffer, { z: 0, x: col, y: 0 }));
  }
  if (!reached) {
    throw new Error(`GIBS has no ${sensor.label} tiles for ${date} yet.`);
  }
  return { geojson: firesToGeoJSON(decoded, sensorId), endpoint: urls.join(" + "), date };
}

// ── Wildfire perimeters (NIFC / WFIGS, United States) ────────────────────────
/**
 * The real mapped POLYGON — where a fire actually is, not where a pixel was hot.
 *
 * A FIRMS detection is a 375 m or 1 km pixel that exceeded a threshold; a
 * perimeter is a surveyed boundary with a name, a cause and a containment
 * figure. Where both exist the perimeter is the better answer, and it is the
 * one thing the satellite feeds cannot give.
 *
 * They exist for the UNITED STATES and, as far as a browser can reach, only
 * there. NIFC's Wildland Fire Interagency Geospatial Services layer is public
 * ArcGIS with CORS `*` and no key — measured, 234 current perimeters. Europe's
 * equivalent (EFFIS/GWIS) publishes burnt area rather than active perimeter
 * and its services are fragmented per country. So this layer is honestly
 * scoped in its own name rather than presented as global coverage.
 */
const NIFC_PERIMETERS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest"
  + "/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0";

export function firePerimetersUrl() {
  const params = new URLSearchParams({
    where: "1=1", outFields: "*", outSR: "4326", f: "geojson",
  });
  return `${NIFC_PERIMETERS}/query?${params}`;
}

/**
 * NIFC's 119 columns down to the ones a reader asks about.
 *
 * The service carries every field the interagency schema defines, most of
 * them null on most fires. `attr_` is the incident record and `poly_` the
 * mapped polygon, and the two disagree about size on purpose: the incident's
 * reported acreage is what the team declared, the polygon's is what was
 * drawn. Both are kept and both are labelled, rather than picking one and
 * calling it "size".
 */
export function firePerimetersToGeoJSON(payload) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const features = (payload?.features || []).map((f) => {
    const p = f?.properties || {};
    if (!f?.geometry?.coordinates?.length) return null;
    const name = String(p.poly_IncidentName || p.attr_IncidentName || "").trim();
    const discovered = num(p.attr_FireDiscoveryDateTime);
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        name,
        kind: "Wildfire perimeter",
        cause: String(p.attr_FireCause || "").trim(),
        // Declared by the incident team.
        reported_acres: num(p.attr_IncidentSize),
        // Measured off the drawn polygon.
        mapped_acres: num(p.poly_GISAcres),
        contained_pct: num(p.attr_PercentContained),
        state: String(p.attr_POOState || "").replace(/^US-/, ""),
        agency: String(p.attr_POOProtectingAgency || "").trim(),
        // The service reports epoch milliseconds; a bare number in a card is
        // not a date anybody can read.
        discovered: discovered ? new Date(discovered).toISOString().slice(0, 10) : "",
        // Perimeters are few and named, so they earn labels — unlike the
        // detections, where ninety thousand names is a white planet.
        label_rank: 3,
      },
    };
  }).filter(Boolean);
  return { type: "FeatureCollection", features };
}

// ── OpenStreetMap places (Overpass API) ───────────────────────────────────────
// Cities, towns and villages in an area. CORS-open, no key. Needs a bbox, so it
// requires a study area (a global Overpass query would time out).

/**
 * OVERPASS, WITH A SECOND SERVER.
 *
 * Every OSM row asks overpass-api.de, and that one public server sheds load:
 * on 2026-10-23 it answered 406 to a bare request and 502 "busy, back off" to
 * a browser's, while the bridges over Houston had loaded from it an hour
 * before. A row that fails whenever one volunteer server is busy is a row that
 * fails. The same query is asked of the next server in this list -- each
 * CORS-open and keyless, verified the same day -- and the error names the
 * last refusal when every one is busy.
 */
export const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** The same request on each server in turn; `{ payload, endpoint }` from the first to answer. */
export async function overpassFetch(url, { fetchImpl = fetch } = {}) {
  const query = new URL(url).search;
  let last = "";
  for (const server of OVERPASS_SERVERS) {
    const endpoint = `${server}${query}`;
    try {
      const response = await fetchImpl(endpoint, { headers: { Accept: "application/json" } });
      if (response.ok) return { payload: await response.json(), endpoint };
      last = `${new URL(server).host} answered HTTP ${response.status}`;
    } catch {
      last = `${new URL(server).host} could not be reached`;
    }
  }
  throw new Error(`OpenStreetMap's Overpass servers are busy (${last}). Try again in a minute.`);
}

/** A connector `load` over a url builder and converter: Overpass with its second server. */
function overpassLoad(urlOf, toGeoJSON) {
  return async (opts) => {
    const { payload, endpoint } = await overpassFetch(urlOf(opts));
    return { geojson: toGeoJSON(payload), endpoint };
  };
}

function overpassUrl({ bbox } = {}) {
  if (!bbox) throw new Error("OSM places needs a study area — draw one first, then fetch.");
  const query = "[out:json][timeout:25];("
    + `node["place"~"^(city|town|village)$"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});`
    + ");out 800;";
  return `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
}
export function overpassToGeoJSON(payload) {
  const features = (payload?.elements || [])
    .filter((e) => e.type === "node" && Number.isFinite(e.lat) && Number.isFinite(e.lon))
    .map((e) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [e.lon, e.lat] },
      properties: {
        name: e.tags?.name || "",
        place: e.tags?.place || "",
        population: e.tags?.population ? Number(e.tags.population) : null,
      },
    }));
  return { type: "FeatureCollection", features };
}

// ── OpenStreetMap roads and settlement outlines (Overpass API) ───────────────
// The same CORS-open, keyless Overpass service the places row uses, asked for
// two things a reader studying a hazard wants beside it: the road network,
// and the outline OSM records for each city and town. Both need a box — the
// drawn study area, else the view — because a global Overpass query times
// out, and how much of the network is asked for depends on how big it is.

/**
 * How big a box is, in degrees of ground: the longer side, with longitude
 * shrunk by cos(latitude) so a box at 60°N is not charged twice its width.
 */
export function boxSpanDeg(bbox) {
  const mid = ((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180;
  return Math.max(bbox.maxLat - bbox.minLat, (bbox.maxLon - bbox.minLon) * Math.cos(mid));
}

/**
 * The road classes worth asking for over a box this size, finest first.
 *
 * OSM splits a way at every junction, so a city's residential streets are
 * tens of thousands of ways: asked for over a region they are a download that
 * times out and a picture that is solid ink. Each tier stops where the next
 * class down would be noise at the scale the box is seen at — the same reason
 * a printed map drops minor roads as its scale falls.
 */
export const ROAD_TIERS = [
  { maxSpan: 0.15, classes: ["motorway", "trunk", "primary", "secondary", "tertiary",
    "unclassified", "residential", "living_street"], says: "every street" },
  { maxSpan: 0.6, classes: ["motorway", "trunk", "primary", "secondary", "tertiary"],
    says: "down to local roads (tertiary)" },
  { maxSpan: 2, classes: ["motorway", "trunk", "primary", "secondary"],
    says: "down to secondary roads" },
  { maxSpan: 6, classes: ["motorway", "trunk", "primary"],
    says: "the main network (motorways, trunk and primary roads)" },
];

/** The rank a class is drawn in: 1 is the most important road. */
export const ROAD_RANK = {
  motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5,
  unclassified: 6, residential: 6, living_street: 7,
};

function bboxClause(bbox) {
  return `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
}

/**
 * The Overpass query for the roads over a box, and which tier answered it.
 * Throws, in a sentence a reader can act on, for no box or one too large.
 */
export function overpassRoadsQuery(bbox) {
  if (!bbox) {
    throw new Error("OSM roads needs an area — draw one, or zoom in so the view is "
      + "a region rather than a continent.");
  }
  const span = boxSpanDeg(bbox);
  const tier = ROAD_TIERS.find((t) => span <= t.maxSpan);
  if (!tier) {
    throw new Error(`OSM roads: this area is ${span.toFixed(1)}° across, too large to ask `
      + "Overpass for. Draw a smaller area, or tick the global Natural Earth roads.");
  }
  const pattern = `^(${tier.classes.join("|")})(_link)?$`;
  const query = "[out:json][timeout:90];"
    + `way["highway"~"${pattern}"](${bboxClause(bbox)});`
    + "out geom;";
  return { query, tier, span };
}

function overpassRoadsUrl({ bbox } = {}) {
  const { query } = overpassRoadsQuery(bbox);
  return `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
}

function wayLine(way) {
  const coords = (way.geometry || [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => [p.lon, p.lat]);
  return coords.length >= 2 ? coords : null;
}

/** A tag that is a number in OSM is a string; a blank is not zero. */
function tagNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function overpassRoadsToGeoJSON(payload) {
  const features = (payload?.elements || [])
    .filter((e) => e.type === "way" && e.tags?.highway)
    .map((way) => {
      const coordinates = wayLine(way);
      if (!coordinates) return null;
      const highway = String(way.tags.highway);
      const link = highway.endsWith("_link");
      const roadClass = link ? highway.slice(0, -5) : highway;
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          name: way.tags.name || "",
          ref: way.tags.ref || "",
          class: roadClass,
          link,
          rank: ROAD_RANK[roadClass] || 8,
          lanes: tagNumber(way.tags.lanes),
          maxspeed: way.tags.maxspeed || "",
          surface: way.tags.surface || "",
          oneway: way.tags.oneway === "yes",
          bridge: Boolean(way.tags.bridge && way.tags.bridge !== "no"),
          tunnel: Boolean(way.tags.tunnel && way.tags.tunnel !== "no"),
          osm_id: `way/${way.id}`,
        },
      };
    })
    .filter(Boolean);
  return { type: "FeatureCollection", features };
}

// ── OpenStreetMap bridges and buildings (Overpass API) ───────────────────────
// What a hazard footprint is read against at street scale: the structures a
// flood, a landslide or an ash load actually damages. The same keyless Overpass
// service as the roads, the same box rules -- the drawn area, else the view --
// and the same tiering by how big the box is, because a city holds thousands
// of footbridges and a region holds millions of buildings.

/**
 * Which bridges are worth asking for over a box this size, finest first.
 * Rail is in every tier: a railway bridge is rare, and losing one cuts a line.
 */
export const BRIDGE_TIERS = [
  { maxSpan: 0.3, highway: null, says: "every bridge, footbridges included" },
  { maxSpan: 2, highway: ["motorway", "trunk", "primary", "secondary", "tertiary"],
    says: "road bridges down to local roads, and railway bridges" },
  { maxSpan: 6, highway: ["motorway", "trunk", "primary"],
    says: "bridges on the main roads, and railway bridges" },
];

const FOOT = new Set(["footway", "path", "cycleway", "pedestrian", "steps", "bridleway"]);
const BRIDGE_ROAD_RANK = { motorway: 1, trunk: 1, primary: 2, secondary: 3, tertiary: 4 };

/** The Overpass query for the bridges over a box, and which tier answered. */
export function overpassBridgesQuery(bbox) {
  if (!bbox) {
    throw new Error("OSM bridges needs an area — draw one, or zoom in to a region.");
  }
  const span = boxSpanDeg(bbox);
  const tier = BRIDGE_TIERS.find((t) => span <= t.maxSpan);
  if (!tier) {
    throw new Error(`OSM bridges: this area is ${span.toFixed(1)}° across, too large to ask `
      + `Overpass for. Draw one under ${BRIDGE_TIERS[BRIDGE_TIERS.length - 1].maxSpan}°.`);
  }
  const b = bboxClause(bbox);
  const roads = tier.highway
    ? `way["bridge"]["bridge"!="no"]["highway"~"^(${tier.highway.join("|")})(_link)?$"](${b});`
    : `way["bridge"]["bridge"!="no"](${b});`;
  const rail = `way["bridge"]["bridge"!="no"]["railway"~"^(rail|light_rail|subway|narrow_gauge|tram)$"](${b});`;
  const query = `[out:json][timeout:90];(${roads}${tier.highway ? rail : ""});out geom;`;
  return { query, tier, span };
}

function overpassBridgesUrl({ bbox } = {}) {
  const { query } = overpassBridgesQuery(bbox);
  return `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
}

/** Along-the-ground length of a [lon, lat] line, metres. */
function lineMetres(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [x1, y1] = coords[i - 1]; const [x2, y2] = coords[i];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    m += Math.hypot((x2 - x1) * k, y2 - y1) * 111320;
  }
  return m;
}

/**
 * What a bridge IS, in the words its card is headed with, and how much it
 * matters (1 = a motorway or a main railway). From what it carries: OSM tags
 * the road or railway on the bridge way itself.
 */
export function bridgeKind(tags = {}) {
  const viaduct = tags.bridge === "viaduct";
  const highway = String(tags.highway || "").replace(/_link$/, "");
  if (tags.railway) {
    const tram = tags.railway === "tram";
    return { type: `${tram ? "Tram" : "Railway"} ${viaduct ? "viaduct" : "bridge"}`, carries: `${tags.railway.replace(/_/g, " ")}`, rank: tram ? 3 : 1 };
  }
  if (tags.waterway) return { type: "Aqueduct", carries: tags.waterway, rank: 4 };
  if (FOOT.has(highway)) return { type: "Footbridge", carries: highway, rank: 6 };
  if (highway) {
    return { type: `Road ${viaduct ? "viaduct" : "bridge"} — ${highway.replace(/_/g, " ")} road`, carries: highway, rank: BRIDGE_ROAD_RANK[highway] || 5 };
  }
  return { type: viaduct ? "Viaduct" : "Bridge", carries: "", rank: 5 };
}

/** How close two sections' ends may be and still be one bridge: a carriageway apart. */
export const BRIDGE_JOIN_M = 60;

/**
 * ONE BRIDGE, NOT ITS SECTIONS.
 *
 * OpenStreetMap splits a bridge wherever its tags change and draws each
 * carriageway of a dual road as its own way, so a single viaduct arrives as
 * six ways and a readout said "4,988 bridges" over Houston where it meant
 * about half that, with one railway trestle listed nineteen times. Sections
 * of the same kind and name whose ends lie within BRIDGE_JOIN_M of each other
 * -- the next section along, or the other carriageway -- are one structure.
 * Unnamed sections are joined by the same rule, which is what keeps two
 * nameless footbridges a street apart as two.
 */
export function mergeBridgeSections(features) {
  const n = features.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cell = BRIDGE_JOIN_M / 111320;
  const grid = new Map();
  const ends = (f) => {
    const c = f.geometry.coordinates;
    return [c[0], c[c.length - 1]];
  };
  const keyOf = (f) => `${f.properties.type}|${f.properties.name}`;
  features.forEach((f, i) => {
    for (const [x, y] of ends(f)) {
      const gx = Math.floor(x / cell); const gy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const [j, ex, ey] of grid.get(`${gx + dx},${gy + dy}`) || []) {
            if (keyOf(features[j]) !== keyOf(f)) continue;
            const k = Math.cos(y * Math.PI / 180);
            if (Math.hypot((ex - x) * k, ey - y) * 111320 <= BRIDGE_JOIN_M) parent[find(i)] = find(j);
          }
        }
      }
    }
    for (const [x, y] of ends(f)) {
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      (grid.get(key) || grid.set(key, []).get(key)).push([i, x, y]);
    }
  });
  const groups = new Map();
  features.forEach((f, i) => {
    const root = find(i);
    (groups.get(root) || groups.set(root, []).get(root)).push(f);
  });
  return [...groups.values()].map((members) => {
    if (members.length === 1) return members[0];
    members.sort((a, b) => a.properties.rank - b.properties.rank);
    const first = members[0].properties;
    const pick = (k) => members.map((m) => m.properties[k]).find((v) => v !== "" && v != null) ?? first[k];
    return {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: members.map((m) => m.geometry.coordinates) },
      properties: {
        ...first,
        ref: pick("ref"), structure: pick("structure"), material: pick("material"), maxweight_t: pick("maxweight_t"),
        deck_length_m: members.reduce((sum, m) => sum + m.properties.deck_length_m, 0),
        sections: members.length,
        osm_id: members.map((m) => m.properties.osm_id).join(" "),
      },
    };
  });
}

export function overpassBridgesToGeoJSON(payload) {
  const sections = (payload?.elements || [])
    .filter((e) => e.type === "way" && e.tags?.bridge && e.tags.bridge !== "no")
    .map((way) => {
      const coordinates = wayLine(way);
      if (!coordinates) return null;
      const t = way.tags;
      const kind = bridgeKind(t);
      const props = {
        name: t["bridge:name"] || t.name || "",
        type: kind.type,
        carries: kind.carries,
        ref: t.ref || "",
        structure: t["bridge:structure"] || "",
        material: t.material || "",
        // Every section's deck: both carriageways of a dual road are counted.
        deck_length_m: Math.round(lineMetres(coordinates)),
        maxweight_t: tagNumber(t.maxweight),
        rank: kind.rank,
        osm_id: `way/${way.id}`,
      };
      return { type: "Feature", geometry: { type: "LineString", coordinates }, properties: props };
    })
    .filter(Boolean);
  return { type: "FeatureCollection", features: mergeBridgeSections(sections) };
}

/**
 * Buildings: a box this wide or less. A square kilometre of a city is a few
 * thousand footprints; this is about 4 km across, which is a district.
 */
export const BUILDING_MAX_SPAN = 0.04;

/**
 * The buildings a hazard reading names before the rest: where people are
 * that cannot easily leave, or that a response depends on. From `amenity`
 * first, then the building's own type.
 */
const CRITICAL = {
  hospital: "Hospital", clinic: "Clinic", school: "School", kindergarten: "Kindergarten",
  university: "University", college: "College", fire_station: "Fire station",
  police: "Police station", nursing_home: "Care home", townhall: "Town hall",
  shelter: "Shelter", place_of_worship: "Place of worship",
};
const BUILDING_WORDS = {
  yes: "Building", house: "House", detached: "Detached house", semidetached_house: "Semi-detached house",
  terrace: "Terraced houses", apartments: "Apartment block", residential: "Residential building",
  commercial: "Commercial building", retail: "Shop", office: "Office building", industrial: "Industrial building",
  warehouse: "Warehouse", garage: "Garage", garages: "Garages", shed: "Shed", barn: "Barn", farm: "Farmhouse",
  farm_auxiliary: "Farm building", church: "Church", mosque: "Mosque", temple: "Temple", hotel: "Hotel",
  train_station: "Railway station", transportation: "Transport building", hangar: "Hangar",
  roof: "Roof (open-sided)", construction: "Building under construction", ruins: "Ruin",
};

export function buildingKind(tags = {}) {
  const critical = CRITICAL[tags.amenity] || CRITICAL[tags.building] || null;
  if (critical) return { type: critical, critical: true, rank: 1 };
  const b = String(tags.building || "yes");
  const word = BUILDING_WORDS[b] || `${b.charAt(0).toUpperCase()}${b.slice(1).replace(/_/g, " ")} building`;
  const rank = ["apartments", "residential", "house", "detached", "semidetached_house", "terrace"].includes(b) ? 2
    : ["shed", "garage", "garages", "roof", "ruins"].includes(b) ? 4 : 3;
  return { type: word, critical: false, rank };
}

export function overpassBuildingsQuery(bbox) {
  if (!bbox) {
    throw new Error("OSM buildings needs an area — draw one over a town or a district.");
  }
  const span = boxSpanDeg(bbox);
  if (span > BUILDING_MAX_SPAN) {
    throw new Error(`OSM buildings: this area is ${span.toFixed(2)}° across; buildings are `
      + `fetched over a district (under ${BUILDING_MAX_SPAN}°, about 4 km). Draw a smaller `
      + "area, or zoom in.");
  }
  const b = bboxClause(bbox);
  const query = `[out:json][timeout:90];(way["building"](${b});rel["building"]["type"="multipolygon"](${b}););out geom;`;
  return { query, span };
}

function overpassBuildingsUrl({ bbox } = {}) {
  const { query } = overpassBuildingsQuery(bbox);
  return `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
}

export function overpassBuildingsToGeoJSON(payload) {
  const features = [];
  for (const e of payload?.elements || []) {
    if (!e.tags?.building) continue;
    let geometry = null;
    if (e.type === "way") {
      const ring = wayLine(e);
      if (!ring || ring.length < 4) continue;
      const [x0, y0] = ring[0]; const [x1, y1] = ring[ring.length - 1];
      if (x0 !== x1 || y0 !== y1) ring.push([x0, y0]);
      geometry = { type: "Polygon", coordinates: [ring] };
    } else if (e.type === "relation") {
      geometry = relationPolygon(e).geometry;
    }
    if (!geometry) continue;
    const t = e.tags;
    const kind = buildingKind(t);
    features.push({
      type: "Feature",
      geometry,
      properties: {
        name: t.name || "",
        type: kind.type,
        critical: kind.critical,
        levels: tagNumber(t["building:levels"]),
        height_m: tagNumber(t.height),
        address: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
        rank: kind.rank,
        osm_id: `${e.type}/${e.id}`,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Settlement outlines: the polygon OSM records for each city and town in the
 * box. A box larger than this pulls the county and district boundaries that
 * contain every town in it, which is megabytes of geometry for a few outlines.
 */
export const OUTLINE_MAX_SPAN = 2;

export function overpassOutlinesQuery(bbox) {
  if (!bbox) {
    throw new Error("OSM city outlines needs an area — draw one, or zoom in to a region.");
  }
  const span = boxSpanDeg(bbox);
  if (span > OUTLINE_MAX_SPAN) {
    throw new Error(`OSM city outlines: this area is ${span.toFixed(1)}° across; draw one `
      + `under ${OUTLINE_MAX_SPAN}° or tick the global Natural Earth urban areas.`);
  }
  const b = bboxClause(bbox);
  /**
   * THE OUTLINE IS FOUND FROM THE PLACE, not from the boundaries.
   *
   * Asking for every administrative boundary in a box returns parishes,
   * wards and counties alike, and which admin level is "the city" differs
   * country by country (a German city is level 6, a French commune 8, a
   * Japanese city 7). So the query starts from the place nodes, asks Overpass
   * which boundaries CONTAIN each one, and the converter keeps the boundary
   * that carries the place's own name. Places mapped as areas in their own
   * right come too.
   */
  const query = "[out:json][timeout:120];"
    + `node["place"~"^(city|town)$"]["name"](${b})->.p;`
    + ".p is_in->.a;"
    + 'rel(pivot.a)["boundary"="administrative"]["admin_level"~"^([5-9]|10)$"]->.r;'
    + `(way["place"~"^(city|town|village)$"]["name"](${b});`
    + `rel["place"~"^(city|town|village)$"]["name"](${b});)->.q;`
    + ".p out;"
    + ".r out geom;"
    + ".q out geom;";
  return { query, span };
}

function overpassOutlinesUrl({ bbox } = {}) {
  const { query } = overpassOutlinesQuery(bbox);
  return `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
}

/** The global urban extents the outlines fall back to over a wide view. */
export const NE_URBAN_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_urban_areas.geojson";

/** A feature's [minLon, minLat, maxLon, maxLat], from every coordinate it has. */
function featureBox(feature) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  (function walk(c) {
    if (typeof c?.[0] === "number") {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else if (Array.isArray(c)) c.forEach(walk);
  })(feature?.geometry?.coordinates);
  return [w, s, e, n];
}

/** The features of `fc` that touch `bbox` (all of them when there is no box). */
export function clipToBox(fc, bbox) {
  const features = fc?.features || [];
  if (!bbox) return { type: "FeatureCollection", features };
  return {
    type: "FeatureCollection",
    features: features.filter((f) => {
      const [w, s, e, n] = featureBox(f);
      return e >= bbox.minLon && w <= bbox.maxLon && n >= bbox.minLat && s <= bbox.maxLat;
    }),
  };
}

/**
 * OSM OUTLINES WHERE OVERPASS CAN ANSWER, NATURAL EARTH WHERE IT CANNOT.
 *
 * The layer is ticked from the globe, usually at a global view, and over
 * anything wider than OUTLINE_MAX_SPAN Overpass returns megabytes of county
 * geometry or times out -- so the layer used to answer only with an error
 * telling the reader to tick a different layer. Now a wide view draws the
 * Natural Earth urban extents for the same area, labelled as such, and a view
 * under the limit draws the settlements' own OSM outlines.
 */
async function loadCityOutlines(opts = {}) {
  const bbox = opts.bbox || null;
  if (bbox && boxSpanDeg(bbox) <= OUTLINE_MAX_SPAN) {
    const { payload, endpoint } = await overpassFetch(overpassOutlinesUrl(opts));
    return { geojson: overpassOutlinesToGeoJSON(payload), endpoint };
  }
  const response = await fetch(NE_URBAN_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Natural Earth urban areas returned HTTP ${response.status}.`);
  const geojson = clipToBox(await response.json(), bbox);
  const note = `Natural Earth urban extent — zoom in under ${OUTLINE_MAX_SPAN}° across for OpenStreetMap outlines`;
  geojson.features.forEach((f) => { f.properties = { ...(f.properties || {}), outline: note }; });
  return { geojson, endpoint: NE_URBAN_URL };
}

const SAME_POINT = 1e-7;
function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < SAME_POINT && Math.abs(a[1] - b[1]) < SAME_POINT;
}

/**
 * Join a relation's member ways into closed rings.
 *
 * A boundary relation is a bag of ways, each a piece of the edge, in no
 * promised order or direction. Each ring is grown from one piece by finding
 * another that starts or ends where it ends (reversing it if it is backwards)
 * until it comes back to its start. A piece that can never close it — the
 * relation is incomplete in the data — is reported rather than drawn as a
 * line across the map.
 */
export function assembleRings(pieces) {
  const pool = pieces.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings = [];
  let open = 0;
  while (pool.length) {
    let ring = pool.shift();
    let grown = true;
    while (!samePoint(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i += 1) {
        const piece = pool[i];
        if (samePoint(piece[0], end)) {
          ring = ring.concat(piece.slice(1));
        } else if (samePoint(piece[piece.length - 1], end)) {
          ring = ring.concat(piece.slice().reverse().slice(1));
        } else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (samePoint(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
    else open += 1;
  }
  return { rings, open };
}

/** Even–odd point in ring, [lon, lat]. */
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A relation's members as a GeoJSON polygon geometry: outer rings, each with
 * the inner rings that fall inside it (an enclave, a lake). Null when no ring
 * closes.
 */
export function relationPolygon(relation) {
  const outerPieces = [];
  const innerPieces = [];
  for (const member of relation.members || []) {
    if (member.type !== "way") continue;
    const line = wayLine(member);
    if (!line) continue;
    (member.role === "inner" ? innerPieces : outerPieces).push(line);
  }
  const outer = assembleRings(outerPieces);
  const inner = assembleRings(innerPieces);
  if (!outer.rings.length) return { geometry: null, open: outer.open + inner.open };
  const polygons = outer.rings.map((ring) => [ring]);
  for (const hole of inner.rings) {
    const home = polygons.find((poly) => inRing(hole[0], poly[0]));
    if (home) home.push(hole);
  }
  const geometry = polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
  return { geometry, open: outer.open + inner.open };
}

function geometryContains(geometry, point) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => inRing(point, rings[0])
    && !rings.slice(1).some((hole) => inRing(point, hole)));
}

/**
 * A name as it can be compared: lower case, accents off, and the words a
 * boundary wears around a settlement's name ("City of", "Stadt", "Ville de",
 * "Municipality") taken away — so the boundary "City of Edinburgh" matches the
 * place "Edinburgh" and "Landeshauptstadt München" matches "München".
 */
const NAME_WRAPPERS = new RegExp("\\b(" + [
  "city", "town", "municipality", "borough", "district", "county", "metropolitan",
  "of", "the", "stadt", "landeshauptstadt", "hansestadt", "gemeinde", "ville", "de",
  "du", "la", "le", "comune", "di", "municipio", "ciudad", "concelho", "gmina",
  "miasto", "shi", "si",
].join("|") + ")\\b", "g");

export function placeNameKey(name) {
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(NAME_WRAPPERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The outline for each city and town in an Overpass answer.
 *
 * Per place node, in order of how literally a polygon is that place: an area
 * mapped AS the place (a `place=city` way or relation with its name) that
 * contains it, else the administrative boundary that contains it AND carries
 * its name — the deepest at municipal level or above when several do (a city and its district can
 * share a name). A place with neither gets no outline and is counted rather
 * than given whatever boundary happens to surround it, which would be a
 * county's outline under a town's name.
 */
/**
 * Among same-named boundaries containing a place, the deepest at municipal
 * level or above (admin level 8 or less) — the city, not a ward of it that
 * happens to share its name. Only where there is none does a deeper one do.
 */
function pickBoundary(candidates) {
  const byDepth = (a, b) => (b.adminLevel || 0) - (a.adminLevel || 0);
  const municipal = candidates.filter((a) => (a.adminLevel || 0) <= 8).sort(byDepth);
  return municipal[0] || candidates.sort(byDepth)[0];
}

export function overpassOutlinesToGeoJSON(payload) {
  const elements = payload?.elements || [];
  const places = elements
    .filter((e) => e.type === "node" && e.tags?.name && e.tags?.place)
    .map((e) => ({
      name: e.tags.name,
      key: placeNameKey(e.tags.name),
      place: e.tags.place,
      population: tagNumber(e.tags.population),
      point: [Number(e.lon ?? e.center?.lon), Number(e.lat ?? e.center?.lat)],
      wikidata: e.tags.wikidata || "",
    }))
    .filter((p) => Number.isFinite(p.point[0]) && Number.isFinite(p.point[1]) && p.key);

  const areas = [];
  let open = 0;
  for (const e of elements) {
    let geometry = null;
    if (e.type === "relation" && (e.tags?.boundary === "administrative" || e.tags?.place)) {
      const built = relationPolygon(e);
      open += built.open;
      geometry = built.geometry;
    } else if (e.type === "way" && e.tags?.place) {
      const ring = wayLine(e);
      if (ring && ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1])) {
        geometry = { type: "Polygon", coordinates: [ring] };
      }
    }
    if (!geometry || !e.tags?.name) continue;
    areas.push({
      element: e,
      geometry,
      key: placeNameKey(e.tags.name),
      placeArea: Boolean(e.tags.place),
      adminLevel: tagNumber(e.tags.admin_level),
    });
  }

  const used = new Set();
  const features = [];
  let unmatched = 0;
  const order = [...places].sort((a, b) => (b.population || 0) - (a.population || 0));
  for (const place of order) {
    const containing = areas.filter((a) => geometryContains(a.geometry, place.point));
    const own = containing.find((a) => a.placeArea && a.key === place.key)
      || pickBoundary(containing.filter((a) => !a.placeArea && a.key === place.key));
    if (!own) { unmatched += 1; continue; }
    const id = `${own.element.type}/${own.element.id}`;
    if (used.has(id)) continue;
    used.add(id);
    features.push({
      type: "Feature",
      geometry: own.geometry,
      properties: {
        name: place.name,
        place: place.place,
        population: place.population,
        outline: own.placeArea
          ? "mapped as the settlement's own area"
          : `administrative boundary (level ${own.adminLevel ?? "?"}) carrying its name`,
        admin_level: own.adminLevel,
        osm_id: id,
        wikidata: own.element.tags?.wikidata || place.wikidata,
      },
    });
  }
  // Places mapped only as an area (villages are rarely nodes in a city query)
  // stand on their own.
  for (const area of areas) {
    const id = `${area.element.type}/${area.element.id}`;
    if (!area.placeArea || used.has(id)) continue;
    used.add(id);
    features.push({
      type: "Feature",
      geometry: area.geometry,
      properties: {
        name: area.element.tags.name,
        place: area.element.tags.place,
        population: tagNumber(area.element.tags.population),
        outline: "mapped as the settlement's own area",
        admin_level: area.adminLevel,
        osm_id: id,
        wikidata: area.element.tags?.wikidata || "",
      },
    });
  }
  return { type: "FeatureCollection", features, unmatched, open };
}

// ── BGS geology 625k (OGC API – Features) ─────────────────────────────────────
// Bedrock and superficial polygons, GeoJSON already (CRS84 lon/lat). CORS-open
// (origin echo), no key. The 625k product covers Northern Ireland — verified
// live 2026-08-15: 758 bedrock / 801 superficial features over the NI bbox,
// complete in a single page at limit=1000 (docs/ni-prototype/data-sources.md).

// The NI prototype's home extent, used whenever no study area is set. These
// collections are UK-wide, so a bounded default beats pulling the whole nation.
const NI_BBOX = "-8.2,54.0,-5.4,55.4";

/** OGC API / ArcGIS envelope order is lon,lat: minLon,minLat,maxLon,maxLat. */
function bboxOrNI(bbox) {
  if (!bbox) return NI_BBOX;
  return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].join(",");
}

const BGS_ATTRIBUTION =
  `Contains British Geological Survey materials © UKRI ${new Date().getFullYear()}`;

function bgsGeologyUrl(collection, { bbox, limit = 1000 } = {}) {
  const params = new URLSearchParams({
    bbox: bboxOrNI(bbox), limit: String(limit), f: "json",
  });
  return `https://ogcapi.bgs.ac.uk/collections/${collection}/items?${params}`;
}

// The payload IS GeoJSON, but passing it through must still be a checkpoint —
// a service error page is JSON too (ArcGIS even returns its errors as HTTP
// 200), and filing one as a layer poisons the data registry. Assert the shape,
// and stamp the licence line onto every feature so the credit survives any
// later split of the collection. Never mutates the source payload.
function passthroughGeoJSON(payload, attribution) {
  if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection — the service answered with something else.");
  }
  return {
    type: "FeatureCollection",
    features: payload.features.map((f) => ({
      ...f,
      properties: { ...(f.properties || {}), attribution },
    })),
  };
}

export function bgsGeologyToGeoJSON(payload) {
  return passthroughGeoJSON(payload, BGS_ATTRIBUTION);
}

// ── Met Office rainfall normals (HadUK-Grid 12 km, ArcGIS FeatureServer) ─────
// 1991–2020 annual precipitation normals as 12 km grid cells, field `pr`
// (mm/yr). CORS-open (ACAO:*), no key. Climatology, not live rain — right for
// susceptibility weighting, wrong for event rainfall. Parameter set verified
// live 2026-08-15 (112 cells over the NI bbox): where=1=1, geometry=<bbox>,
// geometryType=esriGeometryEnvelope, inSR=4326,
// spatialRel=esriSpatialRelIntersects, outFields=*, f=geojson.

const MET_ATTRIBUTION =
  "Contains Met Office data licensed under the Open Government Licence v3.0; HadUK-Grid © Crown copyright";

function metRainfallUrl({ bbox } = {}) {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: bboxOrNI(bbox),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    f: "geojson",
  });
  return "https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/"
    + `Annual_Precipitation_Observations_1991_2020/FeatureServer/0/query?${params}`;
}

export function metRainfallToGeoJSON(payload) {
  return passthroughGeoJSON(payload, MET_ATTRIBUTION);
}

/**
 * GLIMS — the glacier ARCHIVE, live, over the drawn area.
 *
 * `www.glims.org/geoserver` is a public GeoServer that answers WFS with
 * `Access-Control-Allow-Origin: *`, so a browser can read it with no key and no
 * login. That matters because the pre-staged database packages GLIMS points at
 * sit behind an Earthdata login, which a page cannot answer.
 *
 * WHAT THIS IS NOT. The shipped ice layer is RGI 7.0, one outline per ice mass
 * near the year 2000. GLIMS is every outline anybody has submitted, so a
 * glacier carries as many as it has been mapped times — measured over Iceland,
 * 675 outlines for 608 glaciers, with one glacier carrying six. Drawn raw that
 * is the same ice counted six times, which is why RGI exists and why this
 * keeps ONE outline per `glac_id`.
 */
const GLIMS_WFS = "https://www.glims.org/geoserver/GLIMS/ows";

/**
 * A date window as CQL, or null for "every date the archive holds".
 *
 * One end alone is a real question — "everything since 1990" — so `AFTER` and
 * `BEFORE` are offered as well as `DURING`. Dates arrive from a date input as
 * `YYYY-MM-DD` and the server wants an instant.
 */
export function glimsDateClause(from, to) {
  const at = (day, end = false) => {
    const text = String(day || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    return `${text}T${end ? "23:59:59Z" : "00:00:00Z"}`;
  };
  const start = at(from);
  const finish = at(to, true);
  if (start && finish) return `src_date DURING ${start}/${finish}`;
  if (start) return `src_date AFTER ${start}`;
  if (finish) return `src_date BEFORE ${finish}`;
  return null;
}
const GLIMS_ATTRIBUTION = "GLIMS and NSIDC (2005, updated) — Global Land Ice "
  + "Measurements from Space glacier database, glims.org";

/**
 * The archive over a box, and optionally over a WINDOW OF TIME.
 *
 * The date filter is server-side, through CQL — measured on the Valais box,
 * 15,568 outlines unfiltered against 12,000 for 1990-2020 — which is the
 * difference between asking for a quarter of an archive and asking for what
 * the question is about.
 *
 * TWO THINGS THE SERVER IS PARTICULAR ABOUT, both found by measuring:
 * `bbox` and `cql_filter` are mutually exclusive ("both specified but are
 * mutually exclusive", HTTP 500), so the box goes INSIDE the filter; and
 * `BBOX()` there takes **lat, lon** order — the WFS 2.0 axis order for
 * EPSG:4326 — where lon,lat returns a confident zero features.
 */
function glimsOutlinesUrl({ bbox, limit = 4000, from = null, to = null } = {}) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "GLIMS:GLIMS_Glacier_Outlines",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: String(limit),
  });
  /**
   * A STUDY AREA IS REQUIRED, the way it is for Overpass and USGS streamflow.
   *
   * Without one this would not fetch "the world": it would fetch the first
   * 4,000 outlines the server happens to return, which is a corner of the
   * archive presented as a global layer. The shipped RGI tiles are the global
   * answer; this is the archive over a place.
   */
  if (!bbox) {
    throw new Error("GLIMS is an archive of hundreds of thousands of outlines — "
      + "draw a study area first, then fetch.");
  }
  // `minLon/minLat/maxLon/maxLat` is this module's own bbox vocabulary — the
  // same one every builder above reads.
  const window = glimsDateClause(from, to);
  if (window) {
    params.set("cql_filter",
      `BBOX(entity_geom,${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon})`
      + ` AND ${window}`);
  } else {
    params.set("bbox",
      `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},EPSG:4326`);
  }
  return `${GLIMS_WFS}?${params}`;
}

/**
 * The LATEST outline per glacier, and it says which date it kept.
 *
 * `src_date` is when the imagery was taken, which is the date that matters —
 * `anlys_time` is when somebody drew it and is often empty. Ties keep the first
 * seen, which is arbitrary and harmless: two outlines of one glacier from one
 * image are the same ice.
 *
 * `line_type` is not all boundary: the archive also carries internal rock, the
 * basin, the snowline. Only `glac_bound` is the glacier's own edge, so only
 * that is kept — the rest would draw as ice.
 */
export function glimsOutlinesToGeoJSON(payload, options = {}) {
  const all = passthroughGeoJSON(payload, GLIMS_ATTRIBUTION);
  /**
   * `all` keeps EVERY outline instead of the latest per glacier — what a time
   * lapse is made of. The dedupe is right for a cover map and wrong for a
   * sequence: the older outlines ARE the sequence.
   */
  if (options.all) {
    return {
      type: "FeatureCollection",
      features: all.features
        .filter((f) => (f.properties?.line_type || "glac_bound") === "glac_bound")
        .map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            name: f.properties.glac_name || null,
            area_km2: f.properties.db_area ?? null,
            outline_date: String(f.properties.src_date || "").slice(0, 10) || null,
            kind: "Glacier outline (GLIMS)",
          },
        })),
    };
  }
  /**
   * The latest state of each glacier — EVERY piece of it. GLIMS files a
   * boundary as rows, one polygon each; keeping one row per `glac_id` drew
   * half of an ice cap filed in two parts. A newer outline replaces only the
   * pieces it overlaps (glacier-outlines.js).
   */
  const { features: latest } = latestGlaciers(all.features);
  return {
    type: "FeatureCollection",
    features: latest.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        // The card reads these; GLIMS's own column names are not a card's
        // words, and the date IS the fact that separates this from RGI.
        name: feature.properties.glac_name || null,
        area_km2: feature.properties.area_km2 ?? feature.properties.db_area ?? null,
        outline_date: String(feature.properties.src_date || "").slice(0, 10) || null,
        kind: "Glacier outline (GLIMS)",
      },
    })),
  };
}

/**
 * GLACIER CHANGE, out of the same archive — the one question the shipped
 * inventory cannot answer.
 *
 * RGI is a snapshot: one outline per ice mass, around the year 2000. GLIMS is
 * every outline anybody has submitted, and that is what makes a comparison
 * possible — measured over Iceland, 675 outlines for 608 glaciers, one of them
 * mapped six times.
 *
 * WHAT THIS IS NOT. Two outlines of one glacier are two people's readings of
 * two images, on two dates, in two seasons, with two instruments. The area
 * between them is a real difference and it is NOT a mass balance: a glacier
 * can thin for a decade without its outline moving, and late-lying snow can
 * make an outline larger than the ice under it. So the layer reports an area
 * change with both dates on the card, and never a rate of ice loss.
 */
const GLIMS_MIN_YEARS = 2;
/**
 * A GLACIER DOES NOT CHANGE BY A FIFTH OF ITSELF IN A YEAR.
 *
 * Measured over the Valais Alps: most pairs run between -1 and 0 percent a
 * year, and a handful came out at +244 and +432 — which is not a glacier
 * growing, it is two outlines of different things under one id, usually an
 * early submission that digitised one tributary. Even a surge does not do
 * that. Anything past this bound is dropped rather than drawn, because a
 * quantile legend running to +4,000% a year makes every real value one colour.
 */
const GLIMS_MAX_RATE = 20;

export function glimsChangeToGeoJSON(payload, options = {}) {
  const all = passthroughGeoJSON(payload, GLIMS_ATTRIBUTION);
  /**
   * WHAT THE SERVER HAD AGAINST WHAT IT SENT.
   *
   * The request is capped, and GeoServer says so: measured over the Valais
   * Alps, `numberMatched` 15,568 against 4,000 returned — a quarter of the
   * archive's outlines for that box, drawn as if it were all of them. A cap
   * nobody is told about is a map quietly answering a different question, so
   * the shortfall rides on every feature and the card says it.
   */
  /**
   * The window again, client-side. The server has already applied it, and
   * applying it here as well is what keeps the pair honest if the filter is
   * ever dropped: an outline outside the window must not become an endpoint.
   */
  const from = String(options.from || "").slice(0, 10) || null;
  const to = String(options.to || "").slice(0, 10) || null;
  const inWindow = (date) => (!from || date >= from) && (!to || date <= to);
  const matched = Number(payload?.numberMatched);
  const returned = Number(payload?.numberReturned ?? all.features.length);
  const shortfall = Number.isFinite(matched) && matched > returned
    ? `${returned.toLocaleString()} of ${matched.toLocaleString()} outlines in `
      + "this area — draw a smaller one to see the rest"
    : null;
  /** Every outline of one glacier, oldest first. */
  const byGlacier = new Map();
  for (const feature of all.features) {
    const props = feature.properties || {};
    if (props.line_type && props.line_type !== "glac_bound") continue;
    const id = props.glac_id;
    const date = String(props.src_date || "").slice(0, 10);
    const area = Number(props.db_area);
    if (!id || !date || !Number.isFinite(area) || area <= 0) continue;
    if (!inWindow(date)) continue;
    if (!byGlacier.has(id)) byGlacier.set(id, []);
    byGlacier.get(id).push({ feature, date, area });
  }

  const features = [];
  for (const [id, outlines] of byGlacier) {
    if (outlines.length < 2) continue;
    outlines.sort((a, b) => (a.date < b.date ? -1 : 1));
    /**
     * PIECES, NOT ROWS. An ice cap filed as two halves is two rows under one
     * id; read as a pair it is "the glacier doubled" (or halved), and drawn as
     * the latest row it is half an ice cap. The ledger keeps every piece and
     * compares each with the outline(s) it replaced, so the change is the
     * glacier's and the geometry is all of it.
     */
    const ledger = createLedger();
    for (const { feature } of outlines) ledger.add(feature);
    const held = ledger.held.get(id) || [];
    if (Math.max(0, ...held.map((p) => p.generations)) < 2) continue;
    const firstArea = held.reduce((sum, p) => sum + (p.root ?? NaN), 0);
    const lastArea = held.reduce((sum, p) => sum + (pieceAreaKm2(p.feature) ?? NaN), 0);
    const first = { date: outlines[0].date, area: firstArea };
    const last = { date: outlines[outlines.length - 1].date, area: lastArea,
      feature: ledger.features()[0] };
    if (!(first.area > 0) || !(last.area > 0)) continue;
    const years = (Date.parse(last.date) - Date.parse(first.date)) / 3.15576e10;
    // A pair six months apart is two readings of one summer, not a change.
    if (!(years >= GLIMS_MIN_YEARS)) continue;
    const change = last.area - first.area;
    const rate = (change / first.area / years) * 100;
    if (!Number.isFinite(rate) || Math.abs(rate) > GLIMS_MAX_RATE) continue;
    features.push({
      ...last.feature,
      properties: {
        ...last.feature.properties,
        // The LATEST outline is the geometry, so the map shows the ice as it
        // was most recently mapped; the card carries where it came from.
        kind: "Glacier change (GLIMS)",
        name: last.feature.properties.glac_name || null,
        glac_id: id,
        first_date: first.date,
        last_date: last.date,
        span_years: Math.round(years * 10) / 10,
        first_area_km2: first.area,
        last_area_km2: last.area,
        area_change_km2: Math.round(change * 1000) / 1000,
        change_pct: Math.round((change / first.area) * 1000) / 10,
        change_pct_yr: Math.round(rate * 10) / 10,
        outlines: outlines.length,
        archive_coverage: shortfall,
        window: from || to ? `${from || "the earliest"} to ${to || "the latest"}` : null,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// ── The registry ──────────────────────────────────────────────────────────────

export const CONNECTORS = {
  "usgs-earthquakes": {
    label: "USGS earthquakes",
    attribution: "U.S. Geological Survey — Earthquake Hazards Program",
    url: usgsUrl,
    toGeoJSON: usgsToGeoJSON,
    filename: (o = {}) => `usgs_earthquakes_${o.days || 30}d.geojson`,
    defaults: { days: 30, minMagnitude: 2.5 },
  },
  "eonet-volcanoes": {
    label: "EONET volcanoes",
    attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: (o = {}) => eonetUrl({ ...o, category: "volcanoes" }),
    toGeoJSON: eonetToGeoJSON,
    filename: () => "eonet_volcanoes.geojson",
    defaults: { days: 90 },
  },
  "eonet-wildfires": {
    label: "EONET wildfires",
    attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: (o = {}) => eonetUrl({ ...o, category: "wildfires" }),
    toGeoJSON: eonetToGeoJSON,
    filename: () => "eonet_wildfires.geojson",
    defaults: { days: 30 },
  },
  "eonet-storms": {
    label: "EONET severe storms",
    attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: (o = {}) => eonetUrl({ ...o, category: "severeStorms" }),
    toGeoJSON: eonetToGeoJSON,
    filename: () => "eonet_severe_storms.geojson",
    defaults: { days: 30 },
  },
  "eonet-floods": {
    label: "EONET floods",
    attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: (o = {}) => eonetUrl({ ...o, category: "floods" }),
    toGeoJSON: eonetToGeoJSON,
    filename: () => "eonet_floods.geojson",
    defaults: { days: 120 },
  },
  "eonet-ice": {
    label: "EONET sea & lake ice",
    attribution: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: (o = {}) => eonetUrl({ ...o, category: "seaLakeIce" }),
    toGeoJSON: eonetToGeoJSON,
    filename: () => "eonet_sea_lake_ice.geojson",
    defaults: { days: 60 },
  },
  "nws-alerts": {
    label: "NWS weather alerts",
    attribution: "NOAA / US National Weather Service",
    url: nwsUrl,
    toGeoJSON: nwsToGeoJSON,
    filename: () => "nws_active_alerts.geojson",
    defaults: {},
  },
  "usgs-streamflow": {
    label: "USGS streamflow gauges",
    attribution: "U.S. Geological Survey — National Water Information System",
    url: usgsWaterUrl,
    toGeoJSON: usgsWaterToGeoJSON,
    filename: () => "usgs_streamflow.geojson",
    defaults: {},
  },
  "fire-perimeters": {
    label: "Wildfire perimeters (NIFC, United States)",
    kind: "vector",
    url: firePerimetersUrl,
    toGeoJSON: firePerimetersToGeoJSON,
    filename: () => "wildfire_perimeters_nifc.geojson",
    attribution: "NIFC / Wildland Fire Interagency Geospatial Services (public domain)",
  },
  "fires-modis": {
    label: 'Active fires — MODIS (Terra + Aqua)',
    kind: "vector",
    load: (opts) => loadFireDetections("modis", opts),
    filename: () => "active_fires_modis.geojson",
    attribution: "NASA FIRMS via NASA EOSDIS GIBS",
  },
  "fires-viirs-snpp": {
    label: 'Active fires — VIIRS (Suomi NPP, 375 m)',
    kind: "vector",
    load: (opts) => loadFireDetections("viirs-snpp", opts),
    filename: () => "active_fires_viirs_snpp.geojson",
    attribution: "NASA FIRMS via NASA EOSDIS GIBS",
  },
  "fires-viirs-noaa20": {
    label: 'Active fires — VIIRS (NOAA-20, 375 m)',
    kind: "vector",
    load: (opts) => loadFireDetections("viirs-noaa20", opts),
    filename: () => "active_fires_viirs_noaa20.geojson",
    attribution: "NASA FIRMS via NASA EOSDIS GIBS",
  },
  "submarine-cables": {
    label: "Submarine cables (Greg's Cable Map)",
    kind: "vector",
    url: submarineCablesUrl,
    toGeoJSON: submarineCablesToGeoJSON,
    filename: () => "submarine_cables.geojson",
    attribution: "Greg's Cable Map (GNU GPL)",
  },
  "cable-landings": {
    label: "Cable landing stations (Greg's Cable Map)",
    kind: "vector",
    url: cableLandingsUrl,
    toGeoJSON: cableLandingsToGeoJSON,
    filename: () => "cable_landing_stations.geojson",
    attribution: "Greg's Cable Map (GNU GPL)",
  },
  "osm-roads": {
    label: "OSM roads",
    attribution: "© OpenStreetMap contributors (ODbL)",
    load: overpassLoad(overpassRoadsUrl, overpassRoadsToGeoJSON),
    url: overpassRoadsUrl,
    toGeoJSON: overpassRoadsToGeoJSON,
    filename: () => "osm_roads.geojson",
    defaults: {},
  },
  "osm-city-outlines": {
    label: "OSM city outlines",
    attribution: "© OpenStreetMap contributors (ODbL); Natural Earth (public domain) over wide views",
    load: loadCityOutlines,
    url: overpassOutlinesUrl,
    toGeoJSON: overpassOutlinesToGeoJSON,
    filename: () => "osm_city_outlines.geojson",
    defaults: {},
  },
  "osm-bridges": {
    label: "OSM bridges",
    attribution: "© OpenStreetMap contributors (ODbL)",
    load: overpassLoad(overpassBridgesUrl, overpassBridgesToGeoJSON),
    url: overpassBridgesUrl,
    toGeoJSON: overpassBridgesToGeoJSON,
    filename: () => "osm_bridges.geojson",
    defaults: {},
  },
  "osm-buildings": {
    label: "OSM buildings",
    attribution: "© OpenStreetMap contributors (ODbL)",
    load: overpassLoad(overpassBuildingsUrl, overpassBuildingsToGeoJSON),
    url: overpassBuildingsUrl,
    toGeoJSON: overpassBuildingsToGeoJSON,
    filename: () => "osm_buildings.geojson",
    defaults: {},
  },
  "osm-places": {
    label: "OSM places",
    attribution: "© OpenStreetMap contributors (ODbL)",
    load: overpassLoad(overpassUrl, overpassToGeoJSON),
    url: overpassUrl,
    toGeoJSON: overpassToGeoJSON,
    filename: () => "osm_places.geojson",
    defaults: {},
  },
  "bgs-geology-bedrock": {
    label: "BGS geology (bedrock 625k)",
    attribution: BGS_ATTRIBUTION,
    url: (o = {}) => bgsGeologyUrl("bgsgeology625kbedrock", o),
    toGeoJSON: bgsGeologyToGeoJSON,
    filename: () => "bgs_geology_625k_bedrock.geojson",
    defaults: { limit: 1000 },
  },
  "bgs-geology-superficial": {
    label: "BGS geology (superficial 625k)",
    attribution: BGS_ATTRIBUTION,
    url: (o = {}) => bgsGeologyUrl("bgsgeology625ksuperficial", o),
    toGeoJSON: bgsGeologyToGeoJSON,
    filename: () => "bgs_geology_625k_superficial.geojson",
    defaults: { limit: 1000 },
  },
  "glims-outlines": {
    label: "Glacier outlines (GLIMS, live)",
    attribution: GLIMS_ATTRIBUTION,
    url: glimsOutlinesUrl,
    toGeoJSON: glimsOutlinesToGeoJSON,
    filename: () => "glims_glacier_outlines.geojson",
    defaults: { limit: 4000 },
  },
  "glims-change": {
    label: "Glacier change (GLIMS repeat outlines)",
    attribution: GLIMS_ATTRIBUTION,
    // The same request as the outlines row; only the reading differs, so a
    // second fetch of the same box comes out of the browser's own cache.
    url: glimsOutlinesUrl,
    toGeoJSON: glimsChangeToGeoJSON,
    filename: () => "glims_glacier_change.geojson",
    // Higher than the outlines row's: this one needs EVERY outline of a
    // glacier to pair the first with the last, so a cap costs pairs rather
    // than duplicates. 8,000 is about 35 MB over a mountain range.
    defaults: { limit: 8000 },
  },
  "met-rainfall-normals": {
    label: "Rainfall normals (HadUK 12km)",
    attribution: MET_ATTRIBUTION,
    url: metRainfallUrl,
    toGeoJSON: metRainfallToGeoJSON,
    filename: () => "rainfall_normals_haduk_12km.geojson",
    defaults: {},
  },
};

/**
 * Run a connector: build the URL, fetch it, convert to GeoJSON, and hand back
 * everything the caller needs to file it with provenance. The only impure part.
 */
export async function runConnector(name, options = {}) {
  const connector = CONNECTORS[name];
  if (!connector) throw new Error(`Unknown connector: ${name}`);
  const opts = { ...connector.defaults, ...options };
  /**
   * A connector may bring its own loader.
   *
   * The shape below — one URL, `res.json()`, one pure converter — covers every
   * connector that speaks JSON over a single request, which was all of them.
   * The fire layers are binary vector tiles over TWO requests, and bending
   * that into `url` + `toGeoJSON` would mean a fetch wrapper that returns
   * something other than what it fetched. `load` returns the finished GeoJSON
   * and the endpoint it came from; everything downstream is unchanged.
   */
  if (typeof connector.load === "function") {
    const loaded = await connector.load(opts);
    const geojson = loaded?.geojson || { type: "FeatureCollection", features: [] };
    return {
      geojson,
      filename: connector.filename(opts),
      provider: connector.label,
      provenance: {
        endpoint: loaded?.endpoint || connector.label,
        fetched_at: new Date().toISOString(),
        features: geojson.features.length,
        attribution: connector.attribution,
      },
    };
  }
  const url = connector.url(opts);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    // A cross-origin block and an offline machine both surface here; name the
    // host so the cause is legible rather than a bare "failed to fetch".
    throw new Error(`Could not reach ${connector.label}. It may be offline, or `
      + "this origin is blocked by the source. The portal link still works.");
  }
  if (!response.ok) throw new Error(`${connector.label} returned HTTP ${response.status}.`);
  const payload = await response.json();
  // The converter sees the OPTIONS too: a date window is part of how the
  // answer must be read, not just of how it was asked for.
  const geojson = connector.toGeoJSON(payload, opts);
  return {
    geojson,
    filename: connector.filename(opts),
    provider: connector.label,
    provenance: {
      endpoint: url,
      fetched_at: new Date().toISOString(),
      features: geojson.features.length,
      attribution: connector.attribution,
    },
  };
}
