/**
 * Live satellites, as a point layer that moves.
 *
 * One tick fetches current orbital elements (TLEs) from CelesTrak and
 * propagates them with SGP4 — the vendored satellite.js, the same standard
 * propagator every tracker uses — into positions NOW, refreshed every second
 * and a half so the ISS visibly crawls across the map. Elements, not
 * positions, is the only honest way to do this: no public service streams
 * live coordinates without a key, and a TLE plus SGP4 IS the live position,
 * to a kilometre or so, for days around its epoch.
 *
 * The satellites arrive as an ORDINARY imported point layer, deliberately:
 * the triangles with their white rims, the symbology legend, the pixel-true
 * click that raises the scene card bottom-right — all of it is the machinery
 * the volcanoes already use, and a parallel implementation would be wrong
 * wherever it differed. Each dot is drawn at the SUB-SATELLITE POINT (the
 * spot on the ground the satellite is directly above), which is what a flat
 * map of a 3D orbit means; the altitude and speed ride on the card.
 *
 * Three CelesTrak groups, small on purpose: the stations, the ~100 brightest
 * objects, and the navigation constellations — a few hundred satellites, not
 * the ten thousand of GROUP=active, which would be texture for a layer meant
 * to be read and clicked.
 */

import { paintByField } from "./symbology-dialog.js?v=20260826-3316f0e";

const GROUPS = [
  { group: "stations", kind: "Space station", category: "Space stations" },
  { group: "visual", kind: "Satellite", category: "Bright (visual)" },
  { group: "gnss", kind: "Navigation satellite", category: "Navigation" },
];

/** The legend's colours, one per group — cyan, amber, green. */
const CATEGORY_COLOURS = {
  "Space stations": "#4ee1ec",
  "Bright (visual)": "#ffd166",
  "Navigation": "#7bdc6f",
};

const LAYER_NAME = "Live satellites (CelesTrak)";
const REFRESH_MS = 1500;
const TLE_URL = (group) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;

/**
 * A TLE text file as [{name, l1, l2}, ...].
 *
 * Pure and exported for the tests. Three lines per object — a name line and
 * the two element lines, recognised by their leading "1 "/"2 " rather than by
 * counting, because a truncated download must fail a record, not shift every
 * record after it.
 */
export function parseTle(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 1) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (name?.startsWith("1 ") || name?.startsWith("2 ")) continue;
    if (!l1?.startsWith("1 ") || !l2?.startsWith("2 ")) continue;
    out.push({ name: name.trim(), l1, l2 });
    i += 2;
  }
  return out;
}

/**
 * One propagated state as the properties the card and the legend read.
 *
 * Pure and exported for the tests. The CONTRACT with the scene card runs
 * through `featureToItem`: `kind` becomes the kicker, `summary` the copy,
 * `dimension` the detail row — and `label_rank: 0` marks the layer nameable
 * (so a click gets the corner card) without ever growing labels, which would
 * go stale the moment the satellite moved.
 */
export function satelliteProperties(entry, state) {
  const period = state.periodMinutes;
  return {
    name: entry.name,
    kind: entry.kind,
    category: entry.category,
    norad: entry.norad,
    label_rank: 0,
    altitude_km: Math.round(state.altitudeKm),
    speed_kms: +state.speedKms.toFixed(2),
    dimension: `${Math.round(state.altitudeKm).toLocaleString()} km up · `
      + `${state.speedKms.toFixed(2)} km/s · ${period.toFixed(0)} min orbit`,
    summary: `${entry.name} is tracked live: the dot is the point on the ground `
      + `it is directly above, moving as it orbits. NORAD ${entry.norad}, `
      + `inclination ${state.inclinationDeg.toFixed(1)}°, one orbit every `
      + `${period.toFixed(0)} minutes. Positions are SGP4-propagated from `
      + "CelesTrak elements and refresh every 1.5 s.",
  };
}

/* ── the propagator ──────────────────────────────────────────────────────── */

let satelliteLib = null;
function loadSatelliteLib() {
  if (window.satellite) return Promise.resolve(window.satellite);
  if (satelliteLib) return satelliteLib;
  satelliteLib = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = new URL("../vendor/satellite.min.js", import.meta.url).href;
    tag.onload = () => resolve(window.satellite);
    tag.onerror = () => reject(new Error("satellite.js failed to load"));
    document.head.appendChild(tag);
  });
  return satelliteLib;
}

/** Every tracked object with its satrec, or null where the TLE is unusable. */
function buildRecords(satellite, tleSets) {
  const seen = new Set();
  const records = [];
  tleSets.forEach(({ meta, triples }) => {
    triples.forEach(({ name, l1, l2 }) => {
      const norad = l1.slice(2, 7).trim();
      // The stations group overlaps visual (the ISS is both); first source
      // wins, and stations are listed first because their kind is the more
      // specific.
      if (seen.has(norad)) return;
      seen.add(norad);
      try {
        const satrec = satellite.twoline2satrec(l1, l2);
        records.push({ name, norad, satrec, kind: meta.kind, category: meta.category });
      } catch (error) { /* one malformed TLE must not sink the layer */ }
    });
  });
  return records;
}

/** Position now, or null for a decayed or unpropagatable object. */
function stateOf(satellite, record, date, gmst) {
  const out = satellite.propagate(record.satrec, date);
  if (!out?.position || !out?.velocity) return null;
  const geo = satellite.eciToGeodetic(out.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const v = out.velocity;
  return {
    lat,
    lon,
    altitudeKm: geo.height,
    speedKms: Math.hypot(v.x, v.y, v.z),
    inclinationDeg: (record.satrec.inclo * 180) / Math.PI,
    // v5 of satellite.js calls the mean motion `no`; older docs say
    // `no_kozai`. Radians per minute either way.
    periodMinutes: (2 * Math.PI) / (record.satrec.no_kozai ?? record.satrec.no),
  };
}

/* ── the layer ───────────────────────────────────────────────────────────── */

let active = null;   // { records, layer, timer, colourFor }

function say(message) {
  const node = document.getElementById("satellites-status");
  if (node) node.textContent = message || "";
}

function layerOf() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.name === LAYER_NAME);
}

/** Move every feature to where its satellite is NOW, then repaint. */
function tick() {
  if (!active?.layer) return;
  const { layer, records } = active;
  if (!layerOf()) { stop(); return; }
  const satellite = window.satellite;
  const date = new Date();
  const gmst = satellite.gstime(date);
  records.forEach((record) => {
    const feature = record.feature;
    if (!feature) return;
    const state = stateOf(satellite, record, date, gmst);
    if (!state) { return; }
    feature.geometry.coordinates[0] = +state.lon.toFixed(4);
    feature.geometry.coordinates[1] = +state.lat.toFixed(4);
    Object.assign(feature.properties, satelliteProperties(record, state));
  });
  // The same repaint the symbology uses: rebuilds the Points from the mutated
  // collection, so the dots, the relief attributes and the click data cannot
  // disagree about where a satellite is.
  layer.repaint?.(active.colourFor);
}

async function start() {
  say("Fetching orbital elements…");
  let satellite;
  try {
    satellite = await loadSatelliteLib();
  } catch (error) {
    say("The propagator failed to load — satellites need vendor/satellite.min.js.");
    return false;
  }
  let tleSets;
  try {
    tleSets = await Promise.all(GROUPS.map(async (meta) => {
      const response = await fetch(TLE_URL(meta.group));
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${meta.group}`);
      return { meta, triples: parseTle(await response.text()) };
    }));
  } catch (error) {
    say(`CelesTrak did not answer: ${error.message}`);
    return false;
  }
  const records = buildRecords(satellite, tleSets);
  const date = new Date();
  const gmst = satellite.gstime(date);
  const features = [];
  records.forEach((record) => {
    const state = stateOf(satellite, record, date, gmst);
    if (!state) return;
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [+state.lon.toFixed(4), +state.lat.toFixed(4)] },
      properties: satelliteProperties(record, state),
    };
    record.feature = feature;
    features.push(feature);
  });
  if (!features.length) { say("No propagatable satellites in the answer."); return false; }

  const fc = { type: "FeatureCollection", features };
  await window.GeoIDImportManager?.importFileList?.(
    [new File([JSON.stringify(fc)], `${LAYER_NAME}.geojson`, { type: "application/geo+json" })],
    { name: LAYER_NAME },
  );
  const layer = layerOf();
  if (!layer) { say("The layer could not be registered."); return false; }
  /**
   * Rebind to the LAYER'S OWN features. The import serialises the collection
   * into a File and the layer parses its own copy, so the objects built above
   * are orphans the moment the import returns — the first version mutated
   * them anyway, and the ISS sat bolted to its first position while the tick
   * claimed to be moving it.
   */
  const byNorad = new Map((layer.features || []).map((f) => [String(f.properties?.norad), f]));
  records.forEach((record) => { record.feature = byNorad.get(String(record.norad)) || null; });
  layer.featureNoun = "Satellite";
  layer.info = {
    source: "CelesTrak orbital elements, SGP4-propagated in the browser",
    summary: `${features.length} satellites: stations, the brightest objects, `
      + "and the navigation constellations",
  };
  paintByField(layer, "category", {
    overrides: new Map(Object.entries(CATEGORY_COLOURS)),
  });
  const colourFor = (feature) =>
    CATEGORY_COLOURS[feature?.properties?.category] || "#8a8a8a";
  active = { records, layer, colourFor, timer: window.setInterval(tick, REFRESH_MS) };
  say(`${features.length} satellites live — refreshing every ${REFRESH_MS / 1000} s. `
    + "Each dot is the point on the ground its satellite is directly above.");
  return true;
}

function stop() {
  if (active?.timer) window.clearInterval(active.timer);
  const layer = layerOf();
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  active = null;
  say("Satellites off.");
}

function init() {
  const tickBox = document.getElementById("satellites-toggle");
  if (!tickBox || tickBox.dataset.wired) return;
  tickBox.dataset.wired = "1";
  tickBox.addEventListener("change", async () => {
    if (tickBox.checked) {
      const ok = await start();
      if (!ok) tickBox.checked = false;
    } else {
      stop();
    }
  });
  // The layer box can remove the layer without asking: the tracker must not
  // go on ticking a corpse, and the box must not claim a layer that is gone.
  window.GeoIDImportManager?.onChange?.(() => {
    if (active && !layerOf()) { stop(); tickBox.checked = false; }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

if (typeof window !== "undefined") {
  window.GeoIDSatellites = { parseTle, satelliteProperties };
}
