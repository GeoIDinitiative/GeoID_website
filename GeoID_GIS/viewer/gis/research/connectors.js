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
