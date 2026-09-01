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
  const best = new Map();
  for (const feature of all.features) {
    const props = feature.properties || {};
    if (props.line_type && props.line_type !== "glac_bound") continue;
    const id = props.glac_id || `${props.anlys_id ?? ""}:${props.subm_id ?? ""}`;
    const held = best.get(id);
    const date = String(props.src_date || "");
    if (!held || date > String(held.properties.src_date || "")) best.set(id, feature);
  }
  return {
    type: "FeatureCollection",
    features: [...best.values()].map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        // The card reads these; GLIMS's own column names are not a card's
        // words, and the date IS the fact that separates this from RGI.
        name: feature.properties.glac_name || null,
        area_km2: feature.properties.db_area ?? null,
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
    const first = outlines[0];
    const last = outlines[outlines.length - 1];
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
  "osm-places": {
    label: "OSM places",
    attribution: "© OpenStreetMap contributors (ODbL)",
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
