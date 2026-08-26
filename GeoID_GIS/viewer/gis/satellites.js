/**
 * Live satellites, at their real altitudes.
 *
 * One tick fetches current orbital elements (TLEs) from CelesTrak and
 * propagates them with SGP4 — the vendored satellite.js, the standard
 * propagator every tracker uses — refreshed every second and a half so the
 * ISS visibly crawls. Elements, not positions, is the only honest source:
 * no public service streams live coordinates without a key, and a TLE plus
 * SGP4 IS the live position, to a kilometre or so, for days around its epoch.
 *
 * The first version draped the satellites onto the surface as an imported
 * vector layer, to reuse the point machinery wholesale — and a satellite is
 * the one thing on this globe that is genuinely NOT on the surface. A GPS
 * satellite orbits at 20,200 km: three Earth radii of altitude flattened
 * into a ground dot. So this layer draws its own dots, at
 * `3.2 × (1 + altitude/6371)`, in the imported-geo group so the existing
 * per-frame spin sync carries them exactly as it carries a coastline. What
 * it KEEPS of the ordinary machinery: the layer row and eye (via
 * `addDerivedLayer`), the legend, and the click card — a raycast pick hands
 * the same item shape to the same `openSceneFeature` the volcano dots use.
 *
 * Orbit paths are togglable rings: each orbit sampled once around in ECI
 * (inertial) coordinates and frozen to the Earth-fixed frame at build time;
 * afterwards the ring group counter-rotates by the change in sidereal angle,
 * because an orbit plane is fixed among the stars, not to the ground — so
 * the rings drift westward over the turning Earth exactly as real orbits do,
 * for one rotation per tick instead of forty thousand re-propagations.
 */

import * as THREE from "../vendor/three.module.js";

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
const RING_SAMPLES = 96;
const KM_TO_UNITS = 3.2 / 6371;
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
 * One propagated state as the properties the card reads.
 *
 * Pure and exported for the tests. The CONTRACT with the scene card runs
 * through `featureToItem`: `kind` becomes the kicker, `summary` the copy,
 * `dimension` the detail row. `label_rank: 0` says the points speak the card
 * contract without ever growing labels (stale in 1.5 s), and `no_flash`
 * declines the temporary ground label a click would otherwise raise — the
 * dot is at altitude, and a golden chip on the ground three Earth radii
 * below it would mark the wrong place.
 */
export function satelliteProperties(entry, state) {
  const period = state.periodMinutes;
  return {
    name: entry.name,
    kind: entry.kind,
    category: entry.category,
    norad: entry.norad,
    label_rank: 0,
    no_flash: true,
    altitude_km: Math.round(state.altitudeKm),
    speed_kms: +state.speedKms.toFixed(2),
    dimension: `${Math.round(state.altitudeKm).toLocaleString()} km up · `
      + `${state.speedKms.toFixed(2)} km/s · ${period.toFixed(0)} min orbit`,
    summary: `${entry.name} is tracked live, drawn at its real altitude and `
      + `moving as it orbits. NORAD ${entry.norad}, inclination `
      + `${state.inclinationDeg.toFixed(1)}°, one orbit every `
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

/** Every tracked object with its satrec, or dropped where the TLE is unusable. */
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
        // CelesTrak's groups carry their associated junk — the stations file
        // lists Fregat debris beside the ISS — and a card calling debris a
        // space station is wrong in the headline. The catalogue's own naming
        // convention marks debris DEB and spent boosters R/B.
        const kind = /\bDEB\b/.test(name) ? "Orbital debris"
          : /\bR\/B\b/.test(name) ? "Rocket body"
            : meta.kind;
        records.push({ name, norad, satrec, kind, category: meta.category });
      } catch (error) { /* one malformed TLE must not sink the layer */ }
    });
  });
  return records;
}

/**
 * ECEF kilometres into the baseline scene frame.
 *
 * The same convention `latLonToVector3` encodes: scene x is −X, scene y is
 * Z (the pole), scene z is Y. Written once here and used for dots and rings
 * both, so the two cannot disagree about which way the planet faces.
 */
function ecfToScene(ecf, target) {
  return target.set(-ecf.x * KM_TO_UNITS, ecf.z * KM_TO_UNITS, ecf.y * KM_TO_UNITS);
}

/** Position now — ECI plus the geodetic numbers the card shows. */
function stateOf(satellite, record, date, gmst) {
  let out;
  try {
    out = satellite.propagate(record.satrec, date);
  } catch (error) {
    return null;
  }
  if (!out?.position || !out?.velocity) return null;
  const geo = satellite.eciToGeodetic(out.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const v = out.velocity;
  return {
    eci: out.position,
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

let active = null;

function say(message) {
  const node = document.getElementById("satellites-status");
  if (node) node.textContent = message || "";
}

function layerOf() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.name === LAYER_NAME);
}

/** A round dot: white disc the material tints, drawn twice for the white rim. */
let dotTexture = null;
function makeDotTexture() {
  if (dotTexture) return dotTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  dotTexture = new THREE.CanvasTexture(canvas);
  dotTexture.needsUpdate = true;
  return dotTexture;
}

/** Move every dot to where its satellite is NOW. */
function tick() {
  if (!active) return;
  if (!layerOf()) { stop(); return; }
  const satellite = window.satellite;
  const date = new Date();
  const gmst = satellite.gstime(date);
  const scratch = new THREE.Vector3();
  const positions = active.geometry.attributes.position;
  active.records.forEach((record, i) => {
    const state = stateOf(satellite, record, date, gmst);
    if (!state) {
      // A decayed object parks at the planet's centre, where the depth test
      // hides it without a per-point visibility scheme.
      positions.setXYZ(i, 0, 0, 0);
      record.dead = true;
      return;
    }
    record.dead = false;
    const ecf = satellite.eciToEcf(state.eci, gmst);
    ecfToScene(ecf, scratch);
    positions.setXYZ(i, scratch.x, scratch.y, scratch.z);
    record.feature.geometry.coordinates[0] = +state.lon.toFixed(4);
    record.feature.geometry.coordinates[1] = +state.lat.toFixed(4);
    Object.assign(record.feature.properties, satelliteProperties(record, state));
  });
  positions.needsUpdate = true;
  active.geometry.computeBoundingSphere();
  /**
   * The rings were frozen to the ground at their build instant; an orbit
   * plane is fixed among the STARS. Counter-rotating the ring group by the
   * sidereal angle since then keeps each ring in its true plane while the
   * planet turns under it — one rotation, not forty thousand propagations.
   */
  if (active.rings) {
    active.rings.rotation.y = -(gmst - active.rings.userData.gmst0);
  }
}

/**
 * Every orbit as one merged line mesh: hundreds of rings, one draw call.
 *
 * Sampled in ECI over each object's own period, converted to the ground
 * frame at ONE shared instant (`gmst0`), coloured by category at the vertex.
 */
function buildRings() {
  const satellite = window.satellite;
  const date = new Date();
  const gmst0 = satellite.gstime(date);
  const positions = [];
  const colours = [];
  const colour = new THREE.Color();
  const scratch = new THREE.Vector3();
  active.records.forEach((record) => {
    if (record.dead) return;
    const periodMs = ((2 * Math.PI) / (record.satrec.no_kozai ?? record.satrec.no)) * 60000;
    colour.set(CATEGORY_COLOURS[record.category] || "#8a8a8a");
    const points = [];
    for (let k = 0; k <= RING_SAMPLES; k += 1) {
      let out;
      try {
        out = satellite.propagate(record.satrec,
          new Date(date.getTime() + (periodMs * k) / RING_SAMPLES));
      } catch (error) { break; }
      if (!out?.position) break;
      const ecf = satellite.eciToEcf(out.position, gmst0);
      points.push(ecfToScene(ecf, scratch).clone());
    }
    for (let k = 0; k + 1 < points.length; k += 1) {
      positions.push(points[k].x, points[k].y, points[k].z,
        points[k + 1].x, points[k + 1].y, points[k + 1].z);
      colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  const rings = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false,
  }));
  rings.name = "satellite-orbits";
  rings.frustumCulled = false;
  rings.userData.gmst0 = gmst0;
  return rings;
}

function setRings(on) {
  if (!active) return;
  if (on && !active.rings) {
    say("Computing orbit paths…");
    active.rings = buildRings();
    active.group.add(active.rings);
    say(`${active.records.length} satellites live, orbit paths on.`);
  }
  if (active.rings) active.rings.visible = on;
}

/**
 * The click, raycast against the dots themselves.
 *
 * The surface pick cannot serve here — `featuresAt` answers "what is at this
 * ground coordinate", and a navigation satellite is three Earth radii off
 * the ground it happens to be above; seen obliquely, its dot is nowhere near
 * its sub-satellite point on screen. This is the one picker in the app that
 * targets true 3D points, and it hands its answer to the SAME card the
 * volcano dots use.
 */
function onClick(event) {
  if (!active) return;
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || event.target !== canvas) return;
  if (active.downAt
    && Math.hypot(event.clientX - active.downAt.x, event.clientY - active.downAt.y) > 4) return;
  const layer = layerOf();
  if (!layer || layer.visible === false) return;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, viewer.camera);
  // ~12 px of pick radius, in world units at the camera's range.
  const worldPerPixel = (2 * viewer.camera.position.length()
    * Math.tan((viewer.camera.fov * Math.PI) / 360)) / rect.height;
  raycaster.params.Points.threshold = 12 * worldPerPixel;
  const hits = raycaster.intersectObject(active.fill, false)
    .filter((h) => !active.records[h.index]?.dead)
    .sort((a, b) => a.distanceToRay - b.distanceToRay);
  const hit = hits[0];
  if (!hit) return;
  const record = active.records[hit.index];
  const item = window.GeoIDPointLabels?.featureToItem?.(record.feature, active.legendInfo);
  if (!item || !viewer.openSceneFeature?.(item)) return;
  window.GeoIDFeaturePopup?.suppress?.(500);
  event.stopPropagation();
}

function onDown(event) {
  if (active) active.downAt = { x: event.clientX, y: event.clientY };
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
  if (!records.length) { say("No usable element sets in the answer."); return false; }
  records.forEach((record) => {
    record.feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    };
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",
    new THREE.Float32BufferAttribute(new Float32Array(records.length * 3), 3));
  const colour = new THREE.Color();
  const colours = new Float32Array(records.length * 3);
  records.forEach((record, i) => {
    colour.set(CATEGORY_COLOURS[record.category] || "#8a8a8a");
    colours.set([colour.r, colour.g, colour.b], i * 3);
  });
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));

  // The white rim is a second, larger draw of the same geometry — the fill's
  // disc is tinted by the vertex colour, so a rim inside the texture would
  // be tinted with it.
  const outline = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 10.5, sizeAttenuation: false, map: makeDotTexture(), alphaTest: 0.35,
    transparent: true, depthWrite: false, color: 0xffffff,
  }));
  const fill = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 7, sizeAttenuation: false, map: makeDotTexture(), alphaTest: 0.35,
    transparent: true, depthWrite: false, vertexColors: true,
  }));
  fill.renderOrder = 1;
  const group = new THREE.Group();
  group.name = "satellites-live";
  group.add(outline, fill);

  const legendInfo = {
    palette: Object.values(CATEGORY_COLOURS).map((c) => c.replace("#", "")),
    labels: Object.keys(CATEGORY_COLOURS),
    values: Object.keys(CATEGORY_COLOURS),
    counts: Object.keys(CATEGORY_COLOURS).map((category) =>
      records.filter((r) => r.category === category).length),
    categorical: true,
    classed: true,
    field: "category",
  };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, {
    object3D: group,
    georeferenced: true,   // the imported-geo group carries the spin for us
    legendInfo,
    info: {
      source: "CelesTrak orbital elements, SGP4-propagated in the browser",
      summary: `${records.length} satellites at their real altitudes: stations, `
        + "the brightest objects, and the navigation constellations",
    },
  }, "live");
  if (!layer) { say("The layer could not be registered."); return false; }
  layer.featureNoun = "Satellite";

  active = { records, geometry, fill, group, layer, legendInfo, rings: null, downAt: null };
  tick();
  active.timer = window.setInterval(tick, REFRESH_MS);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("click", onClick, true);
  window.GeoIDLayerHierarchy?.render?.();
  say(`${records.length} satellites live at their real altitudes — refreshing `
    + `every ${REFRESH_MS / 1000} s.`);
  if (document.getElementById("satellites-orbits")?.checked) setRings(true);
  return true;
}

function stop() {
  if (!active) return;
  window.clearInterval(active.timer);
  window.removeEventListener("pointerdown", onDown, true);
  window.removeEventListener("click", onClick, true);
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
  document.getElementById("satellites-orbits")?.addEventListener("change", (event) => {
    setRings(event.target.checked);
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
