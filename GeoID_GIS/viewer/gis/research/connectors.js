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
  const geojson = connector.toGeoJSON(payload);
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
