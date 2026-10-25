/**
 * Active tropical cyclones: where each has been, where it is forecast to go,
 * and the cone of uncertainty round that forecast — Hazards ▸ Tropical
 * cyclones.
 *
 * The source is GDACS (the EC Joint Research Centre's alert system), which
 * carries every basin's active storms from the warning agencies' own advisories
 * and answers browsers directly — the same service the Live flood feed reads.
 * For each storm with a current episode the episode's geometry is read into
 * the observed track and the forecast fixes; the agency's own cone is drawn
 * where GDACS carries it, and otherwise one is built from the forecast track
 * by the National Hurricane Center's method (`cyclone-cone.js`).
 *
 * The same answers serve the myGeoID score, which asks "is a cyclone coming
 * here, how close, and when" through `window.GeoIDCycloneForecast.threatTo`.
 */

import { buildVectorLayerResult } from "./vector-render.js?v=20261025-2a63c19";
import {
  gdacsCycloneListUrl, gdacsGeometryUrl, gdacsStorms, readGdacsGeometry, interpolateTrack,
  conePolygon, threatTo, saffirSimpson,
} from "./cyclone-cone.js?v=20261025-2a63c19";

export const LAYER_NAME = "Active cyclones — forecast track and cone (GDACS)";
const CREDIT = "GDACS — European Commission Joint Research Centre, from the warning agencies' "
  + "advisories; cone by the NHC method where GDACS carries none";

const COLOURS = {
  cone: "#f4f1e8",
  forecast: "#ffd23f",
  observed: "#ff5a5f",
  fix: "#ffd23f",
};

const byId = (id) => document.getElementById(id);
const manager = () => window.GeoIDImportManager;

let storms = [];
let layer = null;

function say(message) {
  const node = byId("hazards-status");
  if (node) node.textContent = message || "";
}

/** A ring kept inside ±180, or null when it cannot be without being cut. */
function inRange(ring) {
  const lons = ring.map((c) => c[0]);
  const lo = Math.min(...lons);
  const hi = Math.max(...lons);
  if (lo >= -180 && hi <= 180) return ring;
  if (hi > 180 && lo - 360 >= -180) return ring.map(([x, y]) => [x - 360, y]);
  if (lo < -180 && hi + 360 <= 180) return ring.map(([x, y]) => [x + 360, y]);
  return null;
}

const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

function categoryLabel(kt) {
  const c = saffirSimpson(kt);
  if (c === null) return "strength not given";
  if (c < 0) return "tropical depression";
  if (c === 0) return "tropical storm";
  return `Category ${c}`;
}

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** One storm's features: the cone, the forecast line, the observed line, the forecast fixes. */
export function stormFeatures(storm) {
  const out = [];
  const name = storm.name;
  if (storm.cone) {
    const ring = inRange(storm.cone);
    if (ring) {
      out.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          part: "cone", name: `${name} — cone of uncertainty`,
          kind: "Forecast cone",
          method: storm.coneSource === "agency" ? "the issuing agency's own cone (via GDACS)"
            : "built here: NHC two-thirds-probability circles along the forecast track",
          meaning: "where the CENTRE is expected to stay about two times in three — not the "
            + "storm's size, and a third of storms leave it",
        },
      });
    }
  }
  if (storm.track.length >= 2) {
    out.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: storm.track.map((p) => [wrap(p.lon), p.lat]) },
      properties: { part: "forecast", name: `${name} — forecast track`, kind: "Forecast track",
        from: fmt(storm.track[0].time), to: fmt(storm.track.at(-1).time) },
    });
  }
  if (storm.past.length >= 2) {
    out.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: storm.past.map((p) => [wrap(p.lon), p.lat]) },
      properties: { part: "observed", name: `${name} — observed track`, kind: "Observed track",
        from: fmt(storm.past[0].time), to: fmt(storm.past.at(-1).time) },
    });
  }
  storm.forecast.forEach((p) => {
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [wrap(p.lon), p.lat] },
      properties: {
        part: "fix", name: `${name} — ${fmt(p.time)}`, kind: "Forecast position",
        valid: fmt(p.time),
        wind_kt: Number.isFinite(p.wind) ? Math.round(p.wind) : null,
        wind_source: p.windFrom === "category" ? "mid-point of the advisory's class"
          : p.windFrom === "eased" ? "eased from the measured wind toward the next class" : "reported",
        strength: categoryLabel(p.wind),
        lead_h: Math.round((p.time - (storm.track[0]?.time ?? p.time)) / 3_600_000),
      },
    });
  });
  return out;
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch every active storm's forecast. Answers the storms read, each with its
 * observed fixes, its forecast fixes, its interpolated track and its cone.
 */
export async function fetchStorms({ signal } = {}) {
  const list = gdacsStorms(await getJson(gdacsCycloneListUrl(10), signal));
  // One episode per storm, the latest; "current" when GDACS says so, else
  // anything whose episode ended in the last two days.
  const latest = new Map();
  for (const s of list) {
    const prev = latest.get(s.eventId);
    if (!prev || Number(s.episodeId) > Number(prev.episodeId)) latest.set(s.eventId, s);
  }
  const recent = [...latest.values()].filter((s) => s.current
    || (s.to && Date.now() - Date.parse(s.to) < 2 * 86400000));
  const now = Date.now();
  const read = await Promise.all(recent.map(async (s) => {
    try {
      const url = s.geometryUrl || gdacsGeometryUrl(s.eventId, s.episodeId);
      const geom = readGdacsGeometry(await getJson(url, signal), now);
      const track = interpolateTrack(geom.track, 3);
      let cone = geom.cone;
      let coneSource = cone ? "agency" : null;
      if (!cone && track.length >= 2) { cone = conePolygon(track); coneSource = "built"; }
      return { ...s, past: geom.past, forecast: geom.forecast, track, cone, coneSource };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return { ...s, past: [], forecast: [], track: [], cone: null, error: error.message };
    }
  }));
  return read;
}

export async function addForecast() {
  if (layer && (manager()?.getLayers?.() || []).includes(layer)) return layer;
  if (!manager()?.addDerivedLayer) throw new Error("the globe is not ready yet");
  say("Asking GDACS for active tropical cyclones…");
  try {
    storms = await fetchStorms();
  } catch (error) {
    throw new Error(`GDACS did not answer (${error.message})`);
  }
  const withForecast = storms.filter((s) => s.track.length >= 2);
  const features = storms.flatMap(stormFeatures);
  if (!features.length) {
    say(storms.length
      ? `${storms.length} active storm(s), none with a forecast track published yet.`
      : "No active tropical cyclones anywhere right now.");
    throw new Error(storms.length ? "no forecast tracks published yet" : "no active tropical cyclones right now");
  }
  const fc = { type: "FeatureCollection", features };
  const built = buildVectorLayerResult(fc, {
    name: LAYER_NAME,
    style: {
      field: "part",
      categories: [
        { value: "cone", label: "Cone of uncertainty (2 in 3)", colour: COLOURS.cone },
        { value: "forecast", label: "Forecast track", colour: COLOURS.forecast },
        { value: "fix", label: "Forecast position", colour: COLOURS.fix },
        { value: "observed", label: "Observed track", colour: COLOURS.observed },
      ],
    },
  });
  built.home = "hazards";
  // Not the half strength an AREA opens at: the tracks are lines, and at half
  // strength the observed track all but vanished over the imagery (measured).
  built.opacity = 0.75;
  built.info = {
    source: CREDIT,
    summary: "Every active tropical cyclone's observed track, its forecast track and the cone "
      + "of uncertainty round it. The cone is where the storm's CENTRE is expected to stay about "
      + "two times in three; it widens with lead time because the forecast gets worse, not "
      + "because the storm grows, and the storm's winds reach well outside it.",
  };
  layer = manager().addDerivedLayer(LAYER_NAME, built, "geojson");
  if (!layer) throw new Error("the globe would not take the layer");
  layer.metadata = { ...(layer.metadata || {}), source: CREDIT, format: "live GeoJSON (GDACS)", crs: "EPSG:4326" };
  const built_ = storms.filter((s) => s.coneSource === "built").length;
  say(`${storms.length} active storm(s), ${withForecast.length} with a forecast: `
    + `${storms.map((s) => s.name).join(", ")}.`
    + (built_ ? ` ${built_} cone(s) built here by the NHC method.` : ""));
  return layer;
}

export function removeForecast() {
  if (layer) manager()?.removeLayer?.(layer.id);
  layer = null;
  say("");
}

export function layerOf() {
  return layer && (manager()?.getLayers?.() || []).includes(layer) ? layer : null;
}

/**
 * For a place: the nearest any active storm's forecast centre passes, when,
 * at what strength, and whether the place is inside its cone. Null with no
 * storms read (the layer has to have been loaded, or `refresh` called).
 */
export function threatAt(lat, lon) {
  const answers = storms
    .filter((s) => s.track.length >= 2)
    .map((s) => ({ storm: s.name, alert: s.alert, ...threatTo(lat, lon, s.track, s.cone) }))
    .filter((t) => Number.isFinite(t.km))
    .sort((a, b) => (b.inCone - a.inCone) || (a.km - b.km));
  return answers[0] || null;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDCycloneForecast = {
    add: addForecast,
    remove: removeForecast,
    layerOf,
    threatAt,
    refresh: async () => { storms = await fetchStorms(); return storms; },
    storms: () => storms,
  };
  window.dispatchEvent(new CustomEvent("geoid-gis:catalogue-changed"));
}
