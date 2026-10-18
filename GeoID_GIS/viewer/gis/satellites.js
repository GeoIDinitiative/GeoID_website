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
// Unversioned, as stl-loader-adapter imports it: STLLoader pulls in
// "./three.module.js" itself, and that must stay the one copy of three.
import { STLLoader } from "../vendor/STLLoader.js";

/**
 * Seven CelesTrak groups now — roughly 1,700 objects. Fetched SEQUENTIALLY,
 * because CelesTrak throttles rapid-fire parallel queries into empty
 * answers — the first parallel version read `geo` and `science` as zero
 * satellites. Every group draws rings (a dot with no line reads as broken);
 * OneWeb's are faded instead — see RING_OPACITY.
 */
const GROUPS = [
  { group: "stations", kind: "Space station", category: "Space stations" },
  { group: "science", kind: "Science satellite", category: "Science" },
  { group: "visual", kind: "Satellite", category: "Bright (visual)" },
  { group: "weather", kind: "Weather satellite", category: "Weather" },
  { group: "gnss", kind: "Navigation satellite", category: "Navigation" },
  { group: "geo", kind: "Geostationary satellite", category: "Geostationary" },
  { group: "oneweb", kind: "Constellation satellite", category: "OneWeb constellation" },
];

/**
 * Ring opacity per category. OneWeb used to draw NO rings at all — 650
 * near-identical polar orbits at full strength are a cage that hides every
 * other orbit — but a dot with no line reads as broken, not as restraint.
 * The shell is drawn at a fraction of the strength instead: present,
 * legible as the lattice it is, and beneath every deliberate orbit.
 */
const RING_OPACITY = { "OneWeb constellation": 0.09 };
const RING_OPACITY_DEFAULT = 0.35;

/** The legend's colours, one per group. */
/**
 * Vivid on purpose: the first palette was pastel, and against a starfield of
 * hundreds of dots the categories were reported as indistinguishable. OneWeb
 * stays deliberately muted — 650 near-identical dots would flood any hue they
 * were given. These are only the DEFAULTS: the Symbology button hands the
 * layer to the ordinary dialog, and `colourFor` prefers what it painted.
 */
const CATEGORY_COLOURS = {
  "Space stations": "#00e5ff",
  "Science": "#c26bff",
  "Bright (visual)": "#ffc400",
  "Weather": "#3f8cff",
  "Navigation": "#2ee06a",
  "Geostationary": "#ff5c4d",
  "OneWeb constellation": "#8b93a3",
};

/**
 * The moment to propagate for — the VIEWER'S clock, not the wall clock.
 * In real time the two agree; in time-lapse the satellites orbit at the
 * same 720× the globe turns, one clock for everything on it.
 */
function simNow() {
  return new Date(window.GeoIDViewer?.getSimulatedUtcMs?.() ?? Date.now());
}

/** A record's drawn colour: the symbology dialog's choice, else its category. */
function colourFor(record) {
  return record.colour || CATEGORY_COLOURS[record.category] || "#8a8a8a";
}

/** Label priority when the declutter has to choose, most interesting first. */
const LABEL_PRIORITY = ["Space stations", "Science", "Bright (visual)", "Weather",
  "Geostationary", "Navigation", "OneWeb constellation"];

/** The Labels slider's stops: which categories may carry a name. */
/**
 * Which categories are showing — module-level so the choice survives the
 * tracker being switched off and on. A disabled category hides its dots
 * (parked at the planet's centre, the same trick as decayed objects), its
 * ring mesh, its tags and its picks, all from this one set.
 */
const enabledCategories = new Set(Object.keys(CATEGORY_COLOURS));

const LABEL_LEVELS = {
  0: [],
  1: ["Space stations", "Science"],
  2: ["Space stations", "Science", "Bright (visual)", "Weather"],
  3: LABEL_PRIORITY,
};
const LABEL_LEVEL_COPY = {
  0: "No names",
  1: "Stations and science",
  2: "Adds the bright and weather satellites",
  3: "Every satellite competes for a name",
};
const MAX_LABELS = 40;
const LABEL_SPACING_PX = 64;

const LAYER_NAME = "Live satellites (CelesTrak)";
const REFRESH_MS = 1500;
const RING_SAMPLES = 160;
// A single highlighted orbit affords more: the hover/selection overlays
// sample finer than the mass of rings, because one smooth ring is the whole
// point of picking it out.
const SOLO_SAMPLES = 256;
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
        records.push({
          name, norad, satrec, kind,
          category: meta.category,
          noRings: meta.rings === false,
        });
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

/**
 * The run token. `start()` spends ten seconds and more in awaited fetches
 * before `active` exists, and an untick landing in that window found
 * nothing to stop — `stop()` returned quietly and the layer arrived anyway,
 * tracked and ticking, under an unticked box. Every await in `start()`
 * re-checks the token; `stop()` bumps it, which is what cancellation IS.
 */
let runId = 0;

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
  const date = simNow();
  const gmst = satellite.gstime(date);
  const scratch = new THREE.Vector3();
  const positions = active.geometry.attributes.position;
  active.records.forEach((record, i) => {
    if (!enabledCategories.has(record.category)) {
      // A switched-off category parks its dots at the planet's centre —
      // the same trick as decayed objects — and `hidden` keeps them out of
      // the pickers and the tags.
      positions.setXYZ(i, 0, 0, 0);
      record.hidden = true;
      return;
    }
    record.hidden = false;
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
    // A dot drawn over its close-in model is placed every frame by
    // modelStep, lifted above the model; this coarser pass leaves it alone,
    // or for one frame in every tick the dot (and its tag) drops onto the
    // middle of the model.
    if (!active.lifted?.has(i)) positions.setXYZ(i, scratch.x, scratch.y, scratch.z);
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
  updateLabels();
}

/**
 * Every orbit as one merged line mesh: hundreds of rings, one draw call.
 *
 * Sampled in ECI over each object's own period, converted to the ground
 * frame at ONE shared instant (`gmst0`), coloured by category at the vertex.
 */
/**
 * Kepler's equation, M = E − e·sinE, solved for E by Newton's method.
 * Ten iterations converge to machine precision for any bound orbit; the
 * ring sampler needs it to place uniform-anomaly samples in time.
 */
export function eccentricFromMean(meanAnomaly, eccentricity) {
  let E = meanAnomaly;
  for (let i = 0; i < 10; i += 1) {
    E -= (E - eccentricity * Math.sin(E) - meanAnomaly)
      / (1 - eccentricity * Math.cos(E));
  }
  return E;
}

/** The Julian date of a JS Date, via satellite.js's own converter. */
function julianOf(date) {
  return window.satellite.jday(
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(),
    date.getUTCSeconds() + date.getUTCMilliseconds() / 1000);
}

/**
 * One orbit as scene-frame points, closed, sampled uniformly in ECCENTRIC
 * ANOMALY — both the mass rings and the solo overlays draw from this.
 *
 * Uniform time IS uniform mean anomaly, and an eccentric orbit spends
 * almost none of its period at perigee — Cluster II (e ≈ 0.9) got its
 * fastest, tightest arc as a handful of 6-unit straight chords slicing
 * across the whole scene, which is what "broken orbit lines" looks like.
 * The eccentric anomaly is the ellipse's own parametric angle, so equal
 * steps of it draw the curve smoothly everywhere — and for a circular
 * orbit it IS uniform time, so nothing changes for the 95%. The step from
 * anomaly to a propagation time is Kepler's equation, run from the mean
 * anomaly the satellite actually has NOW, so the dense samples land on the
 * true perigee rather than on wherever the ring happened to start.
 *
 * A COMPLETE ring is then closed by hand: nodal precession moves the orbit
 * plane ~0.4° during the very period being sampled, so the last point
 * never lands on the first — a ~6 px notch in every LEO ring at the
 * default view, read as a break. The half-degree of physics is invisible;
 * the gap is not.
 */
function sampleOrbitPoints(record, samples, gmst0, date) {
  const satellite = window.satellite;
  const meanMotion = record.satrec.no_kozai ?? record.satrec.no; // rad/min
  const ecc = record.satrec.ecco || 0;
  const tsinceMin = (julianOf(date) - record.satrec.jdsatepoch) * 1440;
  const meanNow = record.satrec.mo + meanMotion * tsinceMin;
  const eccNow = eccentricFromMean(meanNow, ecc);
  const scratch = new THREE.Vector3();
  const points = [];
  for (let k = 0; k <= samples; k += 1) {
    const E = eccNow + (2 * Math.PI * k) / samples;
    const M = E - ecc * Math.sin(E);
    const dtMs = ((M - meanNow) / meanMotion) * 60000;
    let out;
    try {
      out = satellite.propagate(record.satrec, new Date(date.getTime() + dtMs));
    } catch (error) { break; }
    if (!out?.position || !isFinite(out.position.x)) break;
    const ecf = satellite.eciToEcf(out.position, gmst0);
    points.push(ecfToScene(ecf, scratch).clone());
  }
  if (points.length === samples + 1) {
    points[points.length - 1] = points[0].clone();
  }
  return points;
}

async function buildRings() {
  const satellite = window.satellite;
  const date = simNow();
  const gmst0 = satellite.gstime(date);
  const positions = [];
  const colours = [];
  const colour = new THREE.Color();
  const segmentOwner = [];
  /**
   * In CHUNKS, yielding between them: ~1,000 ringed orbits at 160 samples
   * is a sixth of a million propagations, and doing them in one task
   * freezes the frame for seconds — reported once already as the whole app
   * hitching when the paths came on.
   */
  let sinceYield = 0;
  for (const record of active.records) {
    if ((sinceYield += 1) % 120 === 0) {
      say(`Computing orbit paths… ${Math.round((sinceYield / active.records.length) * 100)}%`);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      if (!active) return null;
    }
    record.soloRing = null;
    if (record.dead || record.noRings) continue;
    colour.set(colourFor(record));
    // Uniform-anomaly sampling and the closed seam both live in
    // sampleOrbitPoints — see its header for why either matters.
    const points = sampleOrbitPoints(record, RING_SAMPLES, gmst0, date);
    for (let k = 0; k + 1 < points.length; k += 1) {
      positions.push(points[k].x, points[k].y, points[k].z,
        points[k + 1].x, points[k + 1].y, points[k + 1].z);
      colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
      // One entry per SEGMENT: the raycaster answers with a vertex index,
      // and index/2 is the segment — this is how a line hit finds its
      // satellite.
      segmentOwner.push(record);
    }
  }
  /**
   * ONE MESH PER CATEGORY under one group — seven draw calls instead of
   * one, bought deliberately: the category toggles need to hide a whole
   * constellation's rings, and a visibility flip on a small mesh beats
   * rebuilding a merged buffer every time a box is ticked.
   */
  const rings = new THREE.Group();
  rings.name = "satellite-orbits";
  rings.renderOrder = 199;
  rings.userData.keepRenderOrder = true;
  rings.userData.gmst0 = gmst0;
  rings.userData.ringMeshes = [];
  Object.keys(CATEGORY_COLOURS).forEach((category) => {
    const catPositions = [];
    const catColours = [];
    const catOwner = [];
    segmentOwner.forEach((owner, seg) => {
      if (owner.category !== category) return;
      for (let f = 0; f < 6; f += 1) {
        catPositions.push(positions[seg * 6 + f]);
        catColours.push(colours[seg * 6 + f]);
      }
      catOwner.push(owner);
    });
    if (!catOwner.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(catPositions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(catColours, 3));
    const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true,
      opacity: RING_OPACITY[category] ?? RING_OPACITY_DEFAULT, depthWrite: false,
    }));
    mesh.frustumCulled = false;
    mesh.userData.segmentOwner = catOwner;
    mesh.userData.isRingMesh = true;
    mesh.userData.category = category;
    mesh.visible = enabledCategories.has(category);
    rings.add(mesh);
    rings.userData.ringMeshes.push(mesh);
  });
  /**
   * The hover highlight and the selection pulse are CHILDREN of the ring
   * mesh: both draw one orbit's own vertices copied into a small overlay,
   * and living under the mesh means they inherit the sidereal
   * counter-rotation for free — an overlay parented anywhere else would
   * drift off its orbit as the planet turned.
   */
  const overlayGeometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position",
      new THREE.Float32BufferAttribute(new Float32Array(SOLO_SAMPLES * 6), 3));
    g.setDrawRange(0, 0);
    return g;
  };
  const hover = new THREE.LineSegments(overlayGeometry(), new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  hover.visible = false;
  hover.frustumCulled = false;
  rings.add(hover);
  rings.userData.hover = hover;
  const pulse = new THREE.LineSegments(overlayGeometry(), new THREE.LineBasicMaterial({
    color: 0xffbf6f, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  pulse.visible = false;
  pulse.frustumCulled = false;
  rings.add(pulse);
  rings.userData.pulse = pulse;
  return rings;
}

/**
 * One satellite's whole orbit, sampled fresh at solo resolution.
 *
 * A 160-sample ring is acceptable as one thread among a thousand and not as
 * the one line you are looking at, so the hover and selection overlays
 * resample at SOLO_SAMPLES. Cached per record against the rings' own gmst0
 * frame, so it costs one propagation pass per satellite per activation.
 */
function soloOrbit(record) {
  if (record.soloRing) return record.soloRing;
  const gmst0 = active.rings.userData.gmst0;
  const points = sampleOrbitPoints(record, SOLO_SAMPLES, gmst0, simNow());
  const array = new Float32Array(Math.max(0, points.length - 1) * 6);
  for (let k = 0; k + 1 < points.length; k += 1) {
    array.set([points[k].x, points[k].y, points[k].z,
      points[k + 1].x, points[k + 1].y, points[k + 1].z], k * 6);
  }
  record.soloRing = array;
  return array;
}

/** Draw one orbit into an overlay line, or hide it. */
function showOrbitOverlay(overlay, record) {
  if (!record || !active?.rings) {
    overlay.visible = false;
    return;
  }
  const target = overlay.geometry.attributes.position;
  const solo = soloOrbit(record);
  if (!solo.length) { overlay.visible = false; return; }
  target.array.set(solo);
  target.needsUpdate = true;
  overlay.geometry.setDrawRange(0, solo.length / 3);
  overlay.geometry.computeBoundingSphere();
  overlay.visible = true;
}

/* ── labels ──────────────────────────────────────────────────────────────── */

/**
 * The satellite tag: the Explorer location chip, in every respect.
 *
 * Texture, palette, face, layout, baking AND sizing all come from the label
 * engine's own path — the only things this module keeps are the anchor (a
 * moving dot at altitude, which the engine cannot serve) and the selection
 * gold. Every departure tried here was reported as a different app bolted
 * onto this one.
 */
const tagTextures = new Map();

function makePillTexture(name, variant = "rest") {
  const key = `v12|${variant}|${name}`;
  if (tagTextures.has(key)) return tagTextures.get(key);
  /**
   * VERBATIM the Explorer location chip — the engine's own default palette,
   * face, layout AND baking, nothing overridden. Every custom look tried
   * here (a chamfered strip, bare haloed type, a category-coloured space-HUD
   * skin, a texel-for-pixel bespoke bake) was reported as a different app
   * bolted onto this one; the category colour lives on the dot, the ring and
   * the legend, where it always did. Now that the sprites SIZE like the
   * Explorer chips too (world units, the engine's own scale law), the bake
   * is drawn at the same range of sizes the curated chips are, so the
   * engine's default backing is the matching sharpness by construction.
   *
   * "gold" is the selection variant: the same chip re-inked in the
   * selection gold the dot and orbit overlays wear.
   */
  const make = window.GeoIDViewer?.makeLabelTexture;
  const label = make(name, {
    // No minimum width: satellite names run to three letters, and under the
    // engine's 110 px floor "HST" was a chip mostly made of empty backing.
    // The chip hugs its text plus the engine's own padding, nothing else
    // about the layout changed.
    minWidth: 0,
    ...(variant === "gold" ? {
      customPalette: {
        bg: "rgba(30, 22, 6, 0.85)",
        stroke: "rgba(255, 191, 111, 0.9)",
        accent: "#ffbf6f",
        title: "rgba(255, 244, 224, 0.98)",
      },
    } : {}),
  });
  const record = { texture: label.texture, width: label.width, height: label.height };
  tagTextures.set(key, record);
  return record;
}

/**
 * Is a point hidden behind the planet from this camera? The labels render
 * with the depth test OFF — they must beat the orbit spaghetti — so the
 * occlusion the depth buffer would have done is answered here instead.
 */
function occludedByGlobe(point, camera) {
  const toPoint = point.clone().sub(camera.position);
  const span = toPoint.length();
  toPoint.divideScalar(span || 1);
  const t = -camera.position.dot(toPoint);
  if (t <= 0 || t >= span) return false;
  const closest = camera.position.clone().addScaledVector(toPoint, t);
  return closest.length() < 3.15;
}

/**
 * Names beside the dots, drawn by this module and looking like everyone
 * else's.
 *
 * The label ENGINE cannot serve here — it anchors chips to surface points at
 * build time, and a satellite floats at altitude and moves every tick — so
 * the sprites are ours, but the CHIP is the viewer's own `makeLabelTexture`
 * through the seam added for exactly this, with the category colour as the
 * accent. Which dots get a name is the Labels slider (categories) plus a
 * screen-space declutter: candidates in priority order, each claiming
 * `LABEL_SPACING_PX` around itself, capped at `MAX_LABELS`. Re-decided every
 * tick, because the dots moved.
 */
function updateLabels() {
  if (!active) return;
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !viewer.makeLabelTexture) return;
  const allowed = new Set(LABEL_LEVELS[active.labelLevel] || []);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !allowed.size) {
    active.labels.forEach((sprite) => { sprite.visible = false; });
    return;
  }
  /**
   * SIZED BY THE EXPLORER LABELS' OWN LAW, not by a pixel constant.
   *
   * Five rounds of "the labels are unchanged / massive / oversized" all had
   * one root: the pills were pinned to a fixed screen size
   * (`sizeAttenuation: false`) while the curated location chips are
   * WORLD-SIZED sprites whose scale eases with camera distance — so the two
   * kinds of chip only ever matched at the one view the constant was tuned
   * for, and every texture fix looked like no fix from anywhere else. The
   * formula below is earth-viewer's label pass verbatim: base scale
   * `(texture/200) × 0.66`, `labelScale` easing 0.12 → 1.35 on
   * `((distance − 0.2) / 6.2) ^ 0.85`, capped at 24 px of drawn height.
   * Same numbers at the same camera distance as every curated chip.
   */
  const camDist = viewer.camera.position.length();
  const far = Math.max(0, Math.min(1, (camDist - 5) / 20));
  const fovScale = rect.height
    / (2 * Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov) * 0.5));
  const spacingPx = LABEL_SPACING_PX + 66 * far;
  const camDir = viewer.camera.position.clone().normalize();
  const positions = active.geometry.attributes.position;
  const world = new THREE.Vector3();
  active.group.updateMatrixWorld(true);

  const candidates = [];
  active.records.forEach((record, i) => {
    if (record.dead || record.hidden || !allowed.has(record.category)) return;
    world.set(positions.getX(i), positions.getY(i), positions.getZ(i))
      .applyMatrix4(active.group.matrixWorld);
    // The tags draw with the depth test off (they must beat the orbit
    // spaghetti), so the planet's occlusion is answered geometrically.
    if (occludedByGlobe(world, viewer.camera)) return;
    const distance = viewer.camera.position.distanceTo(world);
    const p = world.clone().project(viewer.camera);
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return;
    candidates.push({
      record,
      i,
      distance,
      x: (p.x * 0.5 + 0.5) * rect.width,
      y: (-p.y * 0.5 + 0.5) * rect.height,
      priority: LABEL_PRIORITY.indexOf(record.category),
    });
  });
  candidates.sort((a, b) => a.priority - b.priority);

  const kept = [];
  for (const candidate of candidates) {
    if (kept.length >= MAX_LABELS) break;
    const clash = kept.some((k) => {
      const dx = k.x - candidate.x;
      const dy = k.y - candidate.y;
      return dx * dx + dy * dy < spacingPx * spacingPx;
    });
    if (!clash) kept.push(candidate);
  }

  const wanted = new Set(kept.map((k) => k.record.norad));
  active.labels.forEach((sprite, norad) => {
    if (!wanted.has(norad)) sprite.visible = false;
  });
  kept.forEach((candidate) => {
    const { record } = candidate;
    let sprite = active.labels.get(record.norad);
    if (!sprite) {
      const tag = makePillTexture(record.name);
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tag.texture, transparent: true, depthTest: false, depthWrite: false,
      }));
      // The curated chips' own base scale: (texture px / 200) × 0.66 world
      // units. sizeAttenuation stays at its default TRUE — that is the whole
      // point; the chip is a thing in the world, like every other label.
      sprite.userData.baseScale = new THREE.Vector2(
        (tag.width / 200) * 0.66, (tag.height / 200) * 0.66);
      sprite.userData.record = record;
      active.labelGroup.add(sprite);
      active.labels.set(record.norad, sprite);
    }
    sprite.visible = true;
    // In the group's own frame, exactly where the dot is; the offset is the
    // sprite's centre, in fractions of its own size, so it clears the dot by
    // the same margin at every zoom.
    sprite.position.set(positions.getX(candidate.i), positions.getY(candidate.i),
      positions.getZ(candidate.i));
    // earth-viewer's label scale pass, verbatim, against the tag's own
    // camera distance (a curated chip's anchor is the ground; this chip's
    // anchor is the dot itself, so its distance is measured there).
    const base = sprite.userData.baseScale;
    const t = Math.max(0, Math.min(1, (candidate.distance - 0.2) / 6.2));
    const easedT = Math.pow(t, 0.85);
    let labelScale = 0.12 + (1.35 - 0.12) * easedT;
    // The engine's own floor (0.05) is for a curated chip seen from orbit;
    // a satellite the camera has flown to can be far closer than that, and
    // with the floor the 24 px cap stopped binding — measured, a pill the
    // width of the screen beside a followed ISS. Below 0.05 the true distance
    // is used; at every farther distance the law is unchanged.
    const spritePxPerUnit = fovScale
      / Math.max(candidate.distance - 0.24, Math.min(0.05, candidate.distance));
    labelScale = Math.min(labelScale,
      24 / Math.max(base.y * spritePxPerUnit, 1e-6));
    sprite.scale.set(base.x * labelScale, base.y * labelScale, 1);
    sprite.center.set(-0.1, 0.5);
  });
}

/** Apply the category set: ring meshes flip, dots re-park on the next tick. */
function setCategoryEnabled(category, on) {
  if (on) enabledCategories.add(category);
  else enabledCategories.delete(category);
  if (!active) return;
  (active.rings?.userData.ringMeshes || []).forEach((mesh) => {
    if (mesh.userData.category === category) mesh.visible = on;
  });
  // A selection in a category that just vanished must not go on pulsing.
  if (!on && active.selected?.category === category) deselect();
  tick();
}

/**
 * The category checklist, one row per legend class — the same pattern the
 * Locations label toggles use: a coloured swatch, a name, a tick.
 */
function buildCategoryList() {
  const host = document.getElementById("satellites-categories");
  if (!host || host.dataset.built) return;
  host.dataset.built = "1";
  Object.entries(CATEGORY_COLOURS).forEach(([category, colour]) => {
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = enabledCategories.has(category);
    tick.id = `satellites-cat-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const swatch = document.createElement("span");
    swatch.dataset.catSwatch = category;
    swatch.style.cssText = `flex:0 0 auto;width:0.55rem;height:0.55rem;`
      + `border-radius:0.12rem;background:${colour};`;
    const name = document.createElement("label");
    name.className = "gis-catalogue-name";
    name.htmlFor = tick.id;
    name.textContent = category;
    tick.addEventListener("change", () => setCategoryEnabled(category, tick.checked));
    row.append(tick, swatch, name);
    host.appendChild(row);
  });
}

function setLabelLevel(level) {
  if (!active) return;
  active.labelLevel = level;
  updateLabels();
}

/** The tab's category swatches follow whatever the dots are wearing now. */
function refreshCategorySwatches() {
  const host = document.getElementById("satellites-categories");
  if (!host) return;
  host.querySelectorAll("[data-cat-swatch]").forEach((el) => {
    const category = el.dataset.catSwatch;
    const record = active?.records.find((r) => r.category === category);
    el.style.background = record ? colourFor(record) : (CATEGORY_COLOURS[category] || "#8a8a8a");
  });
}

/**
 * Re-ink everything that carries a colour, from `colourFor`'s current answer:
 * the dot vertex colours, every ring mesh's per-segment colours, the baked
 * tag textures (dropped; the next `updateLabels` redraws them under their new
 * colour) and the tab's category swatches. This is what `layer.repaint` calls
 * after the symbology dialog has written each record's choice.
 */
function recolourAll() {
  if (!active) return;
  const colour = new THREE.Color();
  const dotColours = active.geometry.attributes.color;
  active.records.forEach((record, i) => {
    colour.set(colourFor(record));
    dotColours.setXYZ(i, colour.r, colour.g, colour.b);
  });
  dotColours.needsUpdate = true;
  (active.rings?.userData.ringMeshes || []).forEach((mesh) => {
    const attr = mesh.geometry.attributes.color;
    (mesh.userData.segmentOwner || []).forEach((owner, seg) => {
      colour.set(colourFor(owner));
      attr.setXYZ(seg * 2, colour.r, colour.g, colour.b);
      attr.setXYZ(seg * 2 + 1, colour.r, colour.g, colour.b);
    });
    attr.needsUpdate = true;
  });
  active.labels.forEach((sprite) => {
    sprite.material.map?.dispose?.();
    sprite.material.dispose?.();
    active.labelGroup.remove(sprite);
  });
  active.labels.clear();
  refreshCategorySwatches();
  updateLabels();
}

async function setRings(on) {
  if (!active) return;
  if (on && !active.rings && !active.buildingRings) {
    active.buildingRings = true;
    say("Computing orbit paths…");
    const rings = await buildRings();
    if (!active) return;
    active.buildingRings = false;
    if (rings) {
      active.rings = rings;
      active.group.add(rings);
      say(`${active.records.length} satellites live, orbit paths on.`);
    }
  }
  if (active.rings) active.rings.visible = on;
  // A selection made while the paths were off gains its orbit pulse the
  // moment they come up.
  if (on && active.selected) showOrbitOverlay(active.rings.userData.pulse, active.selected);
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
function castAt(clientX, clientY) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -(((clientY - rect.top) / rect.height) * 2 - 1),
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, viewer.camera);
  const worldPerPixel = (2 * viewer.camera.position.length()
    * Math.tan((viewer.camera.fov * Math.PI) / 360)) / rect.height;
  return { raycaster, worldPerPixel };
}

/**
 * The tag under a pointer position, tested in SCREEN space.
 *
 * The sprites are world-sized now, so their drawn size is world scale times
 * the pixels-per-world-unit at their own distance — the same conversion the
 * scale pass uses. The same projection that places a tag answers whether a
 * click landed on it.
 */
function tagAt(clientX, clientY) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !active) return null;
  const rect = canvas.getBoundingClientRect();
  const fovScale = rect.height
    / (2 * Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov) * 0.5));
  const world = new THREE.Vector3();
  for (const sprite of active.labels.values()) {
    if (!sprite.visible) continue;
    sprite.getWorldPosition(world);
    const pxPerUnit = fovScale
      / Math.max(viewer.camera.position.distanceTo(world), 0.001);
    world.project(viewer.camera);
    const ax = (world.x * 0.5 + 0.5) * rect.width + rect.left;
    const ay = (-world.y * 0.5 + 0.5) * rect.height + rect.top;
    const w = sprite.scale.x * pxPerUnit;
    const h = sprite.scale.y * pxPerUnit;
    /**
     * sprite.center is (-0.1, 0.5): the quad's centre sits 0.6 widths right
     * of the anchor, level with it — and `(0.5 - center.x) * w` IS that
     * offset, complete. A further `- w/2` was subtracted here, shifting the
     * hit zone half a pill LEFT of the pill: its right half was dead and
     * the zone hung over the empty space beside the dot, which is exactly
     * "the label pill itself is not interactive".
     */
    const cx = ax + (0.5 - sprite.center.x) * w;
    const cy = ay + (sprite.center.y - 0.5) * h;
    if (Math.abs(clientX - cx) <= w / 2 + 4 && Math.abs(clientY - cy) <= h / 2 + 4) {
      return sprite.userData.record || null;
    }
  }
  return null;
}

/** The satellite under a pointer: its tag, then its dot, then its orbit. */
function recordAt(clientX, clientY) {
  if (!active) return null;
  const cast = castAt(clientX, clientY);
  if (!cast) return null;
  const { raycaster, worldPerPixel } = cast;
  /**
   * TAGS BEFORE DOTS, because that is the stacking order on screen. The
   * pills render at 206, above the dot cloud — and with dots tried first,
   * any dot within the 12 px threshold of a pill's face stole the click:
   * measured, a click on FREGAT DEB's pill opened ONEWEB-0085's card. Pick
   * order is paint order; a click lands on what it looks like it lands on.
   * A bare dot is untouched — its own pill sits beside it, not over it.
   */
  const tagged = tagAt(clientX, clientY);
  if (tagged) return tagged;
  raycaster.params.Points.threshold = 12 * worldPerPixel;
  const dotHit = raycaster.intersectObject(active.fill, false)
    .filter((h) => !active.records[h.index]?.dead && !active.records[h.index]?.hidden)
    .sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
  if (dotHit) return active.records[dotHit.index];
  if (active.rings?.visible) {
    raycaster.params.Line.threshold = 7 * worldPerPixel;
    const meshes = (active.rings.userData.ringMeshes || []).filter((m) => m.visible);
    const ringHit = raycaster.intersectObjects(meshes, false)
      .sort((a, b) => a.distance - b.distance)[0];
    if (ringHit) {
      // A line hit answers with a vertex index; index/2 is the segment, and
      // each category mesh carries its own segment-owner table.
      return ringHit.object.userData.segmentOwner?.[Math.floor(ringHit.index / 2)] || null;
    }
  }
  return null;
}

function onClick(event) {
  if (!active) return;
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || event.target !== canvas) return;
  if (active.downAt
    && Math.hypot(event.clientX - active.downAt.x, event.clientY - active.downAt.y) > 4) return;
  const layer = layerOf();
  if (!layer || layer.visible === false) return;
  const record = recordAt(event.clientX, event.clientY);
  if (!record) return;
  if (!openRecord(record)) return;
  // The same click every control and location label answers with.
  window.GeoIDUiSound?.playClick?.();
  window.GeoIDFeaturePopup?.suppress?.(500);
  event.stopPropagation();
}

/** Open a satellite's card, select it, fly to it and follow it. */
function openRecord(record) {
  const viewer = window.GeoIDViewer;
  if (!active || !record || !viewer) return false;
  const item = window.GeoIDPointLabels?.featureToItem?.(record.feature, active.legendInfo);
  if (!item || !viewer.openSceneFeature?.(item)) return false;
  // The card goes when the tracker's layer does -- see card-owner.js.
  window.GeoIDCardOwner?.own?.("viewer", LAYER_NAME, () => window.GeoIDViewer?.closeCards?.());
  select(record);
  // And the camera goes to it, as tour mode goes to a stop, then follows it.
  flyToSatellite(record);
  return true;
}

/**
 * Hover finds the orbit under the pointer and brightens it — one merged mesh
 * is one colour-blur of hundreds of rings, and without this there is no
 * telling which ring the pointer is over before committing a click.
 * Throttled: a raycast against 30k segments per mousemove event is how a
 * smooth pan becomes a slideshow.
 */
let hoverPending = false;
function onMove(event) {
  if (!active?.rings?.visible || hoverPending) return;
  hoverPending = true;
  window.setTimeout(() => {
    hoverPending = false;
    if (!active?.rings?.visible) return;
    const viewer = window.GeoIDViewer;
    const canvas = viewer?.renderer?.domElement;
    if (!canvas || event.target !== canvas) return;
    const cast = castAt(event.clientX, event.clientY);
    if (!cast) return;
    // Dots first: a constellation satellite draws no mass ring, and hovering
    // its DOT is how its orbit becomes visible at all.
    cast.raycaster.params.Points.threshold = 10 * cast.worldPerPixel;
    const dotHit = cast.raycaster.intersectObject(active.fill, false)
      .filter((h) => !active.records[h.index]?.dead && !active.records[h.index]?.hidden)
      .sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
    let record = dotHit ? active.records[dotHit.index] : null;
    if (!record) {
      cast.raycaster.params.Line.threshold = 7 * cast.worldPerPixel;
      const meshes = (active.rings.userData.ringMeshes || []).filter((m) => m.visible);
      const hit = cast.raycaster.intersectObjects(meshes, false)
        .sort((a, b) => a.distance - b.distance)[0];
      record = hit
        ? hit.object.userData.segmentOwner?.[Math.floor(hit.index / 2)] : null;
    }
    if (record !== active.hovered) {
      active.hovered = record || null;
      showOrbitOverlay(active.rings.userData.hover, active.hovered);
      canvas.style.cursor = record ? "pointer" : "";
    }
  }, 70);
}

/* ── the close-in model, and the flight to a satellite ───────────────────── */

/**
 * A satellite seen from nearby is drawn as a MODEL; from afar it stays the
 * dot it always was. The model is `assets/models/satellite_*.stl`, baked by
 * services/bake-satellite-model.py — four parts because STL carries no
 * colour: gold-foil body, solar wings, white dish, and a band tinted with the
 * satellite's own category colour. Each part is ONE InstancedMesh of
 * `MODEL_MAX`, so a hundred satellites close in cost four draw calls, and
 * only the nearest `MODEL_MAX` within a pixel of being visible (`modelFarKm`) are ever
 * placed.
 *
 * TRUE SIZE. Each satellite is drawn at its real span (`halfSpanKm`): the ISS
 * at 109 m, Hubble at 13, a GPS satellite at 19, a OneWeb at 6. From afar
 * that is under a pixel and the colour-coded dot carries it; the model is
 * placed only once it would be about a pixel across (`modelFarKm`), so it
 * arrives as a speck and grows by perspective alone. The flight to a
 * satellite lands a few spans from it, which is the only way to see a
 * real-sized one at all.
 *
 * CAMERA-RELATIVE. A 10 m object 6,800 km from the planet's centre is below
 * float32's resolution there (one step is half a metre at that radius), so
 * the model group sits AT THE CAMERA and each instance is placed by its
 * offset from it. The large translation then cancels in double precision on
 * the CPU and the model does not shimmer at arm's length.
 *
 * Placed EVERY FRAME, from SGP4 at the viewer's clock, in the scene's
 * `onBeforeRender` — the dots move every 1.5 s, which from 150 km away is a
 * visible jump of ten kilometres. The colour-coded dot of a modelled
 * satellite is lifted above the model in the SCREEN's up direction, so it
 * floats just over it from any view rather than sitting on its middle.
 */
const MODEL_PARTS = [
  { file: "satellite_bus.stl", colour: 0xc9a24a, metalness: 0.55, roughness: 0.38, emissive: 0x2b2008 },
  { file: "satellite_wings.stl", colour: 0x22397a, metalness: 0.35, roughness: 0.3, emissive: 0x060d26 },
  { file: "satellite_dish.stl", colour: 0xe9edf2, metalness: 0.1, roughness: 0.55, emissive: 0x1c1e22 },
  { file: "satellite_accent.stl", colour: 0xffffff, metalness: 0.2, roughness: 0.5, emissive: 0x161616, tinted: true },
];
const MODEL_VERSION = "1";
const MODEL_MAX = 24;
/**
 * Real half-spans in METRES — the longest dimension, arrays out — by
 * category, with the few objects big enough to be worth naming. A category
 * is a fair stand-in: the shape is generic, and what a reader needs from it
 * is the right size beside the ground and beside each other.
 */
const HALF_SPAN_M_BY_CATEGORY = {
  "Space stations": 30,
  Science: 6,
  "Bright (visual)": 5,
  Weather: 6,
  Navigation: 9,
  Geostationary: 17,
  "OneWeb constellation": 3,
};
const HALF_SPAN_M_BY_NAME = [
  [/^ISS\b|ZARYA/i, 54.5],     // 109 m truss
  [/TIANHE|^CSS\b/i, 27],      // Tiangong with its arrays
  [/^HST$|HUBBLE/i, 6.6],       // 13.2 m long
];
const DEFAULT_HALF_SPAN_M = 5;
/** A satellite's real half-span, in km (cached on the record). */
function halfSpanKm(record) {
  if (record.halfKm) return record.halfKm;
  let metres = HALF_SPAN_M_BY_CATEGORY[record.category] ?? DEFAULT_HALF_SPAN_M;
  for (const [pattern, m] of HALF_SPAN_M_BY_NAME) {
    if (pattern.test(record.name || "")) { metres = m; break; }
  }
  record.halfKm = metres / 1000;
  return record.halfKm;
}
/**
 * Beyond about 2,000 half-spans a satellite is under a pixel on an ordinary
 * screen (a 45° view over 800 px is a milliradian a pixel), so there is no
 * model worth placing; the dot is the satellite there.
 */
function modelFarKm(record) {
  return Math.max(5, halfSpanKm(record) * 2000);
}
/** Where the flight lands: far enough that the whole satellite is in view. */
function landKm(record) { return halfSpanKm(record) * 8; }
/** The closest a scroll may bring the camera: just clear of the arrays. */
function followMinKm(record) { return halfSpanKm(record) * 1.6; }
const FOLLOW_MAX_KM = 6000;

let modelPromise = null;
let modelData = null;
function loadModel() {
  if (modelPromise) return modelPromise;
  const loader = new STLLoader();
  modelPromise = Promise.all(MODEL_PARTS.map((part) => new Promise((resolve, reject) => {
    // Anchored to the module, never to the document: the viewer's page is a
    // directory up from gis/, so a document-relative path would miss.
    const url = new URL(`../assets/models/${part.file}?v=${MODEL_VERSION}`, import.meta.url).href;
    loader.load(url, resolve, undefined, reject);
  }))).then((geometries) => {
    let radius = 0;
    geometries.forEach((geometry) => {
      geometry.computeBoundingSphere();
      const s = geometry.boundingSphere;
      radius = Math.max(radius, s.center.length() + s.radius);
    });
    modelData = { geometries, radius: radius || 1 };
    return modelData;
  }).catch(() => {
    // A model that cannot load leaves the dots exactly as they were.
    modelData = { failed: true };
    return null;
  });
  return modelPromise;
}

function ensureModelMeshes() {
  if (!active || active.models || !modelData?.geometries) return;
  const group = new THREE.Group();
  group.name = "satellite-models";
  // The dots' own trick: a nested band group with keepRenderOrder, and the
  // materials in the transparent pass (at full opacity), so a drape painted
  // with the depth test off cannot draw over a model.
  group.renderOrder = 197;
  group.userData.keepRenderOrder = true;
  const meshes = MODEL_PARTS.map((part, k) => {
    const material = new THREE.MeshStandardMaterial({
      color: part.colour,
      metalness: part.metalness,
      roughness: part.roughness,
      emissive: part.emissive,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
    const mesh = new THREE.InstancedMesh(modelData.geometries[k], material, MODEL_MAX);
    mesh.name = `satellite-model-${part.file.replace(/\.stl$/, "")}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (part.tinted) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MODEL_MAX * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // Picks go through this module's own dot/tag/ring picker.
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  });
  active.group.add(group);
  active.models = { group, meshes };
}

/** Is the tracker's group actually drawn — every ancestor visible? */
function groupShown() {
  if (!active || active.layer?.visible === false) return false;
  for (let node = active.group; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Where a record is, in the group's own (Earth-fixed) frame, at a moment. */
function placeOf(record, date, gmst, outPos, outVel) {
  const satellite = window.satellite;
  let state;
  try { state = satellite.propagate(record.satrec, date); } catch (error) { return false; }
  if (!state?.position || !Number.isFinite(state.position.x)) return false;
  ecfToScene(satellite.eciToEcf(state.position, gmst), outPos);
  if (outVel && state.velocity) ecfToScene(satellite.eciToEcf(state.velocity, gmst), outVel);
  return true;
}

/**
 * How fast the viewer's clock and the globe run, measured rather than
 * asked: simulated ms per wall ms, and radians of spin per wall ms. The
 * flight predicts where the satellite WILL be when it lands from these, so
 * it lands on a moving target in real time, in time-lapse and paused alike.
 */
const clockRate = { sim: 1, spin: 0, lastWall: 0, lastSim: 0, lastRot: null };
function trackClock(nowSimMs) {
  const wall = performance.now();
  const rot = active?.group?.parent?.rotation?.y;
  if (clockRate.lastWall && wall - clockRate.lastWall > 1) {
    const dt = wall - clockRate.lastWall;
    const sim = (nowSimMs - clockRate.lastSim) / dt;
    if (Number.isFinite(sim)) clockRate.sim += (sim - clockRate.sim) * 0.2;
    if (Number.isFinite(rot) && Number.isFinite(clockRate.lastRot)) {
      let d = rot - clockRate.lastRot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      clockRate.spin += (d / dt - clockRate.spin) * 0.2;
    }
  }
  clockRate.lastWall = wall;
  clockRate.lastSim = nowSimMs;
  clockRate.lastRot = Number.isFinite(rot) ? rot : null;
}

const _scratch = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  camLocal: new THREE.Vector3(),
  upLocal: new THREE.Vector3(),
  along: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  zenith: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
  inverse: new THREE.Matrix4(),
  rotation: new THREE.Matrix3(),
  colour: new THREE.Color(),
  world: new THREE.Vector3(),
};

/** The models, the lifted dots and the near plane, for this frame. */
function modelStep(camera, date, gmst) {
  const models = active.models;
  const shown = groupShown();
  const lifted = active.lifted || (active.lifted = new Map());
  const positions = active.geometry.attributes.position;
  const array = positions.array;
  let dirty = false;

  const restore = (keep) => {
    lifted.forEach((_, i) => {
      if (keep?.has(i)) return;
      lifted.delete(i);
      const record = active.records[i];
      if (record && !record.dead && !record.hidden && placeOf(record, date, gmst, _scratch.pos)) {
        positions.setXYZ(i, _scratch.pos.x, _scratch.pos.y, _scratch.pos.z);
      } else {
        positions.setXYZ(i, 0, 0, 0);
      }
      dirty = true;
    });
  };

  if (!shown || modelData?.failed) {
    if (models) models.meshes.forEach((mesh) => { mesh.count = 0; });
    restore(null);
    if (dirty) positions.needsUpdate = true;
    return;
  }

  // The camera, in the group's own frame (the dots' frame).
  _scratch.inverse.copy(active.group.matrixWorld).invert();
  const camLocal = _scratch.camLocal.copy(camera.position).applyMatrix4(_scratch.inverse);
  const candidates = [];
  const followed = active.follow?.record || null;
  for (let i = 0; i < active.records.length; i += 1) {
    const record = active.records[i];
    if (record.dead || record.hidden) continue;
    const dx = array[i * 3] - camLocal.x;
    const dy = array[i * 3 + 1] - camLocal.y;
    const dz = array[i * 3 + 2] - camLocal.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const far = modelFarKm(record) * KM_TO_UNITS;
    if (d2 < far * far || record === followed) candidates.push({ i, d2: record === followed ? -1 : d2 });
  }
  if (candidates.length && !modelData) { loadModel(); }
  if (!models) {
    ensureModelMeshes();
    if (!active.models) { restore(null); if (dirty) positions.needsUpdate = true; return; }
  }
  candidates.sort((a, b) => a.d2 - b.d2);
  if (candidates.length > MODEL_MAX) candidates.length = MODEL_MAX;

  // The screen's up, in the group's frame: where a lifted dot goes.
  _scratch.rotation.setFromMatrix4(_scratch.inverse);
  const upLocal = _scratch.upLocal.set(0, 1, 0).applyQuaternion(camera.quaternion)
    .applyMatrix3(_scratch.rotation).normalize();

  // The models are placed relative to the CAMERA (see the header): the group
  // sits at the camera, in the tracker's own frame, and each instance is its
  // offset from it.
  active.models.group.position.copy(camLocal);
  active.models.group.updateMatrixWorld(true);

  const keep = new Set();
  let count = 0;
  let nearestClear = Infinity;
  const { meshes } = active.models;
  for (const { i } of candidates) {
    const record = active.records[i];
    if (!placeOf(record, date, gmst, _scratch.pos, _scratch.vel)) continue;
    const pos = _scratch.pos;
    const distance = pos.distanceTo(camLocal);
    const half = halfSpanKm(record) * KM_TO_UNITS;

    // Nadir-pointing, flying along its velocity: +Z zenith, +X along-track,
    // +Y the orbit normal (the wings' axis).
    const zenith = _scratch.zenith.copy(pos).normalize();
    const along = _scratch.along.copy(_scratch.vel).addScaledVector(zenith, -_scratch.vel.dot(zenith));
    if (along.lengthSq() < 1e-18) along.set(zenith.y, -zenith.x, 0);
    along.normalize();
    const normal = _scratch.normal.crossVectors(zenith, along).normalize();
    const scale = half / modelData.radius;
    _scratch.matrix.set(
      along.x * scale, normal.x * scale, zenith.x * scale, pos.x - camLocal.x,
      along.y * scale, normal.y * scale, zenith.y * scale, pos.y - camLocal.y,
      along.z * scale, normal.z * scale, zenith.z * scale, pos.z - camLocal.z,
      0, 0, 0, 1,
    );
    _scratch.colour.set(colourFor(record));
    meshes.forEach((mesh) => {
      mesh.setMatrixAt(count, _scratch.matrix);
      if (mesh.instanceColor) mesh.setColorAt(count, _scratch.colour);
    });
    count += 1;

    // The colour-coded dot floats just over the model, on screen.
    const lift = half * 1.3;
    positions.setXYZ(i, pos.x + upLocal.x * lift, pos.y + upLocal.y * lift, pos.z + upLocal.z * lift);
    lifted.set(i, true);
    keep.add(i);
    dirty = true;
    const tag = active.labels.get(record.norad);
    if (tag?.visible) tag.position.set(positions.getX(i), positions.getY(i), positions.getZ(i));
    nearestClear = Math.min(nearestClear, distance - half * 1.6);
  }
  meshes.forEach((mesh) => {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  restore(keep);
  if (dirty) positions.needsUpdate = true;

  /**
   * The near plane. The render loop sets it from the distance to the ground
   * — 0.08 units (160 km) at a LEO satellite's height — which would clip a
   * model the camera is closer to than that. The renderer runs a logarithmic
   * depth buffer, so a near plane well inside the closest model is safe; the
   * loop sets it afresh next frame, so this cannot leak.
   */
  if (count && Number.isFinite(nearestClear)) {
    const wanted = Math.max(1e-7, nearestClear * 0.5);
    if (wanted < camera.near) {
      camera.near = wanted;
      camera.updateProjectionMatrix();
    }
  }
}

/**
 * Keep the camera on the followed satellite, at the follow distance, looking
 * at it from the direction the reader has turned to.
 *
 * The direction is held in the SATELLITE'S OWN FRAME -- up the local radial,
 * east and north beside it -- as a pitch from overhead and a yaw round it,
 * so the view stays fixed relative to the satellite and the ground under it
 * while both race round the planet at 7.7 km/s. Pitch 0 is straight down,
 * which is where the flight lands.
 */
function followStep(camera, date, gmst) {
  const follow = active.follow;
  const now = performance.now();
  const record = follow.record;
  if (active.selected !== record || record.dead || record.hidden || !groupShown()) { endFollow(); return; }
  if (follow.phase === "flying") {
    // A flight somebody else started cancels ours without calling back.
    if (now - follow.flyStarted > follow.flyMs + 1500) endFollow();
    return;
  }
  if (!placeOf(record, date, gmst, _scratch.pos)) return;
  const world = _scratch.world.copy(_scratch.pos).applyMatrix4(active.group.matrixWorld);
  const radius = world.length();
  if (!(radius > 0)) return;
  const frame = followFrame(world, follow.yaw || 0, follow.pitch || 0);
  const desired = world.clone().addScaledVector(frame.dir, follow.dist);
  const blend = Math.min(1, (now - follow.landedAt) / 700);
  if (blend < 1 && follow.blendFrom) {
    const eased = 1 - ((1 - blend) ** 3);
    camera.position.lerpVectors(follow.blendFrom, desired, eased);
  } else {
    camera.position.copy(desired);
  }
  camera.up.copy(frame.up);
  camera.lookAt(world);
  camera.updateMatrixWorld();
  // The orbit target stays on the planet's centre: the render loop still
  // calls OrbitControls' update(), and the camera it reads between that and
  // this frame is what the tile refine and the near plane are measured from.
}

/**
 * The satellite's local frame and the view direction in it. Up is the
 * radial; east is the pole crossed with it (X where the pole is the radial);
 * `dir` points from the satellite to the camera and `up` is the screen's up,
 * `sin p * radial - cos p * horizontal`, which never meets `dir` -- so the
 * view has no singular pitch, overhead included.
 */
export function followFrame(world, yaw, pitch) {
  const u = world.clone().normalize();
  let east = new THREE.Vector3(0, 1, 0).cross(u);
  if (east.lengthSq() < 1e-8) east = new THREE.Vector3(1, 0, 0).cross(u);
  east.normalize();
  const north = u.clone().cross(east);
  const h = east.multiplyScalar(Math.cos(yaw)).addScaledVector(north, Math.sin(yaw));
  const dir = u.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(h, Math.sin(pitch)).normalize();
  const up = u.clone().multiplyScalar(Math.sin(pitch)).addScaledVector(h, -Math.cos(pitch)).normalize();
  return { dir, up };
}

/** Pitch is held short of the satellite's own horizon from below. */
export const FOLLOW_PITCH_MAX = THREE.MathUtils.degToRad(170);

function endFollow() {
  if (!active?.follow) return;
  const follow = active.follow;
  active.follow = null;
  window.removeEventListener("wheel", onFollowWheel, true);
  orbitDrag = null;
  const viewer = window.GeoIDViewer;
  const controls = viewer?.controls;
  if (follow.heldControls && controls) {
    // The globe's own orbit comes back centred on the planet, as it was.
    controls.enabled = follow.controlsWere !== false;
    controls.target.set(0, 0, 0);
    viewer.camera?.up?.set?.(0, 1, 0);
    controls.update?.();
  }
}

/**
 * While following, the wheel zooms on the SATELLITE, not on the ground. The
 * viewer's own wheel zoom moves the camera by a fraction of its height above
 * the surface — from 160 km over a LEO satellite one notch is past it.
 */
function onFollowWheel(event) {
  const follow = active?.follow;
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!follow || follow.phase !== "follow" || event.target !== canvas) return;
  event.preventDefault();
  event.stopPropagation();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  const next = follow.dist * Math.exp(event.deltaY * unit * 0.0015);
  if (next > FOLLOW_MAX_KM * KM_TO_UNITS) { endFollow(); return; }
  follow.dist = Math.max(followMinKm(follow.record) * KM_TO_UNITS, next);
}

/**
 * While following, a drag on the globe turns the view ROUND THE SATELLITE.
 *
 * It used to hand the camera back -- and a satellite let go of at close range
 * leaves the frame at 7.7 km/s, so the first nudge of the mouse made it
 * vanish. The reader lets go by closing its card, by Escape, or by scrolling
 * out past the follow's reach. OrbitControls is held off for the follow so
 * the drag is not also read as a turn of the planet; the press is never
 * stopped (the viewer's click handling still sees it).
 */
let orbitDrag = null;
function onFollowPointerDown(event) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  const follow = active?.follow;
  if (!follow || follow.phase !== "follow" || event.target !== canvas || event.button !== 0) return;
  orbitDrag = { x: event.clientX, y: event.clientY, id: event.pointerId };
}

function onFollowPointerMove(event) {
  const follow = active?.follow;
  if (!orbitDrag || !follow || follow.phase !== "follow") return;
  if (event.pointerId !== orbitDrag.id || !(event.buttons & 1)) { orbitDrag = null; return; }
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  const height = canvas?.clientHeight || 800;
  const k = (2 * Math.PI) / height;
  follow.yaw = (follow.yaw || 0) - (event.clientX - orbitDrag.x) * k;
  follow.pitch = THREE.MathUtils.clamp(
    (follow.pitch || 0) - (event.clientY - orbitDrag.y) * k, 0, FOLLOW_PITCH_MAX);
  orbitDrag.x = event.clientX;
  orbitDrag.y = event.clientY;
  // The blend from the flight is over once the reader moves the view.
  follow.blendFrom = null;
}

function onFollowPointerUp(event) {
  if (orbitDrag && event.pointerId === orbitDrag.id) orbitDrag = null;
}

function onFollowKey(event) {
  if (event.key !== "Escape" || !active?.follow) return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  const name = active.follow.record?.name;
  endFollow();
  if (name) say(`Let go of ${name}.`);
}

/**
 * Fly to a satellite with tour mode's own flight — the seam's
 * `flyCameraTo` — and then follow it for a while as it moves.
 *
 * The target moves, so the landing point is PREDICTED: the satellite where
 * SGP4 puts it when the flight ends, on a globe turned by the spin it will
 * have by then (both rates measured off the running clock). The follow then
 * blends out whatever the prediction missed.
 */
function flyToSatellite(record) {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!active || !camera || typeof viewer.flyCameraTo !== "function") return false;
  if (record.dead || record.hidden) return false;
  loadModel();
  active.group.updateWorldMatrix(true, false);
  const now = simNow().getTime();
  const satellite = window.satellite;
  // Where it is now, for the choice of flight.
  if (!placeOf(record, new Date(now), satellite.gstime(new Date(now)), _scratch.pos)) return false;
  const nowWorld = _scratch.pos.clone().applyMatrix4(active.group.matrixWorld);
  const camDistKm = camera.position.distanceTo(nowWorld) / KM_TO_UNITS;
  const angle = camera.position.clone().normalize().angleTo(nowWorld.clone().normalize());
  const tourHop = angle > THREE.MathUtils.degToRad(25) || camDistKm > 8000;
  const durationMs = tourHop ? 2800 : 1400;
  // Where it will be when the flight lands.
  const endSim = new Date(now + durationMs * clockRate.sim);
  if (!placeOf(record, endSim, satellite.gstime(endSim), _scratch.pos)) return false;
  const local = _scratch.pos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), clockRate.spin * durationMs);
  const endWorld = local.applyMatrix4(active.group.matrixWorld);
  const landDist = landKm(record) * KM_TO_UNITS;
  const endPosition = endWorld.clone().multiplyScalar((endWorld.length() + landDist) / endWorld.length());
  endFollow();
  viewer.clearZoomTarget?.();
  active.follow = {
    record,
    phase: "flying",
    dist: landDist,
    flyStarted: performance.now(),
    flyMs: durationMs,
  };
  window.addEventListener("wheel", onFollowWheel, { capture: true, passive: false });
  const ok = viewer.flyCameraTo(endPosition, {
    tourHop,
    durationMs,
    onComplete: () => {
      const follow = active?.follow;
      if (!follow || follow.record !== record) return;
      follow.phase = "follow";
      follow.landedAt = performance.now();
      follow.blendFrom = camera.position.clone();
      follow.yaw = 0;
      follow.pitch = 0;
      // Held off for the follow: a drag turns the view round the satellite,
      // and the planet's own orbit would read the same drag as a turn of
      // the globe and fight the follow for the camera.
      const controls = viewer.controls;
      if (controls) {
        follow.controlsWere = controls.enabled;
        follow.heldControls = true;
        controls.enabled = false;
      }
      say(`Following ${record.name} at true size (${Math.round(halfSpanKm(record) * 2000)} m across) — `
        + "drag to look round it, scroll to zoom, Escape or close its card to let go.");
    },
  });
  if (!ok) { endFollow(); return false; }
  return true;
}

/**
 * The per-frame step, chained onto the scene's `onBeforeRender` — the top of
 * the frame being drawn, after the camera has moved and before the frustum
 * is taken, so the follow, the models and the near plane all land in the
 * same frame they are drawn in. Chained, never replaced: the relief sync is
 * already there.
 */
let frameHookScene = null;
function installFrameHook() {
  const scene = window.GeoIDViewer?.scene;
  if (!scene || frameHookScene === scene) return;
  frameHookScene = scene;
  const previous = typeof scene.onBeforeRender === "function"
    ? scene.onBeforeRender.bind(scene)
    : null;
  scene.onBeforeRender = function satelliteFrame(...args) {
    if (previous) previous(...args);
    const camera = args[2];
    if (!active || !camera || camera !== window.GeoIDViewer?.camera || !window.satellite) return;
    try {
      const date = simNow();
      trackClock(date.getTime());
      const gmst = window.satellite.gstime(date);
      if (active.follow) followStep(camera, date, gmst);
      modelStep(camera, date, gmst);
    } catch (error) { /* one bad frame must not stop the render */ }
  };
}

/* ── selection pulse ─────────────────────────────────────────────────────── */

/**
 * The selected satellite pulses — its dot always, its orbit when the rings
 * are up — in the same gold the label selection ring wears everywhere else.
 * A rAF loop runs only while something is selected, and the selection ends
 * itself when the scene card closes, however it was closed: polling the
 * card's visibility is one boolean a frame against wiring into every close
 * path the viewer has.
 */
function select(record) {
  if (!active) return;
  active.selected = record;
  if (!active.pulseDot) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(3), 3));
    active.pulseDot = new THREE.Points(g, new THREE.PointsMaterial({
      size: 14, sizeAttenuation: false, map: makeDotTexture(), alphaTest: 0.2,
      transparent: true, depthWrite: false, color: 0xffbf6f, opacity: 0.9,
    }));
    active.pulseDot.frustumCulled = false;
    active.pulseDot.renderOrder = 2;
    active.group.add(active.pulseDot);
  }
  if (active.rings) showOrbitOverlay(active.rings.userData.pulse, record);
  /**
   * The selected PILL goes GOLD — the same gold the dot and orbit wear — by
   * swapping to a rebaked chip in that colour, never by tinting: a material
   * tint multiplies the whole texture and muddies the text. The rest-state
   * map is kept on the sprite so deselect is a swap back, not a rebake.
   */
  const tag = active.labels.get(record.norad);
  if (tag) {
    if (!tag.userData.restMap) tag.userData.restMap = tag.material.map;
    tag.material.map = makePillTexture(record.name, "gold").texture;
    tag.material.needsUpdate = true;
  }
  if (!active.pulseFrame) pulseLoop();
}

function deselect() {
  if (!active) return;
  const was = active.selected;
  active.selected = null;
  if (active.pulseDot) active.pulseDot.visible = false;
  if (active.rings?.userData.pulse) active.rings.userData.pulse.visible = false;
  // The pill goes back to its rest chip and full opacity.
  const tag = was ? active.labels.get(was.norad) : null;
  if (tag) {
    if (tag.userData.restMap) {
      tag.material.map = tag.userData.restMap;
      tag.material.needsUpdate = true;
    }
    tag.material.opacity = 1;
  }
}

function pulseLoop() {
  if (!active) return;
  if (!active.selected) { active.pulseFrame = null; return; }
  const kicker = document.querySelector("#scene-popup-kicker, [class*=\"scene-popup-kicker\"]");
  if (kicker && kicker.offsetParent === null) {
    deselect();
    active.pulseFrame = null;
    return;
  }
  const t = performance.now() * 0.004;
  const pulse = (Math.sin(t) + 1) * 0.5;
  const record = active.selected;
  const i = active.records.indexOf(record);
  if (active.pulseDot && i >= 0 && !record.dead) {
    const positions = active.geometry.attributes.position;
    const target = active.pulseDot.geometry.attributes.position;
    target.setXYZ(0, positions.getX(i), positions.getY(i), positions.getZ(i));
    target.needsUpdate = true;
    active.pulseDot.visible = true;
    active.pulseDot.material.size = 11 + pulse * 6;
    active.pulseDot.material.opacity = 0.5 + pulse * 0.45;
  }
  const ringPulse = active.rings?.userData.pulse;
  if (ringPulse?.visible) ringPulse.material.opacity = 0.35 + pulse * 0.6;
  /**
   * The gold pill GLOWS, it does not breathe: a label that changes size
   * cannot be read while you look at it. Opacity is the whole pulse; the
   * gold itself is the highlight, swapped in by select().
   */
  const tag = active.labels.get(record.norad);
  if (tag?.visible) tag.material.opacity = 0.72 + 0.28 * pulse;
  active.pulseFrame = window.requestAnimationFrame(pulseLoop);
}

function onDown(event) {
  if (active) active.downAt = { x: event.clientX, y: event.clientY };
}

/**
 * The last good elements, kept in localStorage per group.
 *
 * CelesTrak escalates from throttling to a flat 403 for a busy IP, and an
 * element set is valid for DAYS around its epoch — so the last successful
 * fetch is an honest fallback, and the status says when it is being used
 * and how old it is rather than letting stored data pass as fresh.
 */
const TLE_CACHE_PREFIX = "geoid-tle-";
const TLE_CACHE_MAX_AGE_MS = 5 * 24 * 3600 * 1000;

function saveTleCache(group, text) {
  try {
    localStorage.setItem(TLE_CACHE_PREFIX + group, JSON.stringify({ t: Date.now(), text }));
  } catch (error) { /* a full store must not sink the layer */ }
}

function readTleCache(group) {
  try {
    const raw = localStorage.getItem(TLE_CACHE_PREFIX + group);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.text || (Date.now() - entry.t) > TLE_CACHE_MAX_AGE_MS) return null;
    return entry;
  } catch (error) { return null; }
}

function ageCopy(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

async function start() {
  const id = ++runId;
  say("Fetching orbital elements…");
  let satellite;
  try {
    satellite = await loadSatelliteLib();
  } catch (error) {
    say("The propagator failed to load — satellites need vendor/satellite.min.js.");
    return false;
  }
  if (id !== runId) return false;
  const tleSets = [];
  let cachedGroups = 0;
  let oldestCacheMs = 0;
  for (const meta of GROUPS) {
    if (id !== runId) return false;   // or a cancelled run keeps narrating
    say(`Fetching orbital elements… ${meta.group}`);
    let triples = [];
    try {
      const response = await fetch(TLE_URL(meta.group));
      if (id !== runId) return false;
      if (response.ok) {
        const text = await response.text();
        triples = parseTle(text);
        if (triples.length) saveTleCache(meta.group, text);
      }
    } catch (error) { /* one throttled group must not sink the layer */ }
    if (!triples.length) {
      const cached = readTleCache(meta.group);
      if (cached) {
        triples = parseTle(cached.text);
        if (triples.length) {
          cachedGroups += 1;
          oldestCacheMs = Math.max(oldestCacheMs, Date.now() - cached.t);
        }
      }
    }
    if (triples.length) tleSets.push({ meta, triples });
    // CelesTrak throttles rapid-fire queries into empty 200s; a beat between
    // requests is what keeps `geo` and `science` from arriving blank.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    if (id !== runId) return false;
  }
  if (!tleSets.length) {
    say("CelesTrak is not answering (it rate-limits busy connections, sometimes "
      + "for hours) and no stored elements exist here yet — try again later.");
    return false;
  }
  if (id !== runId) return false;
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
    colour.set(colourFor(record));
    colours.set([colour.r, colour.g, colour.b], i * 3);
  });
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));

  // The white rim is a second, larger draw of the same geometry — the fill's
  // disc is tinted by the vertex colour, so a rim inside the texture would
  // be tinted with it.
  const outline = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 7.4, sizeAttenuation: false, map: makeDotTexture(), alphaTest: 0.35,
    transparent: true, depthWrite: false, color: 0xffffff,
  }));
  const fill = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 5, sizeAttenuation: false, map: makeDotTexture(), alphaTest: 0.35,
    transparent: true, depthWrite: false, vertexColors: true,
  }));
  fill.renderOrder = 1;
  const group = new THREE.Group();
  group.name = "satellites-live";
  /**
   * Dots in a NESTED band-198 group: the hierarchy stamps the layer's own
   * group into the data band (~51), and a streamed basemap patch drawn
   * with the depth test off paints over anything sorted there — measured
   * as the Esri tiles erasing dots and orbits at close zoom. A nested
   * group resets groupOrder (the trap the volcano labels documented, used
   * deliberately here as with the tags), so the dots sort at 198 and the
   * rings at 199: above every drape, below the label band at 200.
   */
  const dotsGroup = new THREE.Group();
  dotsGroup.name = "satellite-dots";
  dotsGroup.renderOrder = 198;
  dotsGroup.userData.keepRenderOrder = true;
  dotsGroup.add(outline, fill);
  group.add(dotsGroup);
  /**
   * The tags live in a NESTED group with its own renderOrder, because a
   * nested group resets groupOrder for its children — the trap that once
   * buried the volcano labels, used deliberately here: the satellite layer's
   * group is stamped into the data band (~51) by the hierarchy, and the tags
   * must sort with the annotation band (200s) or every orbit line draws
   * over them.
   */
  const labelGroup = new THREE.Group();
  labelGroup.name = "satellite-tags";
  labelGroup.renderOrder = 206;
  labelGroup.userData.keepRenderOrder = true;
  group.add(labelGroup);

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
    /**
     * NOT pickable from the ground. The records' feature coordinates are the
     * live SUBSATELLITE points — right for the card's readout, wrong as a hit
     * target: the shared vector picker (hover highlight, click cards) works
     * in ground coordinates, so it caught clicks on the SURFACE three Earth
     * radii under the dot and drew its highlight down there. This layer runs
     * its own true-3D picking (dots, tags, rings); the ground picker must
     * leave it alone.
     */
    groundPick: false,
    legendInfo,
    info: {
      source: "CelesTrak orbital elements, SGP4-propagated in the browser",
      citation: "Orbital elements courtesy of CelesTrak (celestrak.org). "
        + "Propagated with satellite.js (SGP4, MIT licence).",
      crs: "EPSG:4326 (sub-satellite points); drawn at true altitude",
      summary: `${records.length} satellites at their real altitudes: stations, `
        + "the brightest objects, and the navigation constellations",
    },
  }, "live");
  if (!layer) { say("The layer could not be registered."); return false; }
  if (id !== runId) {
    // Cancelled between the registration call and here: the layer exists
    // and nothing will ever own it — take it straight back out.
    window.GeoIDImportManager?.removeLayer?.(layer.id);
    return false;
  }
  layer.featureNoun = "Satellite";
  /**
   * The seam the symbology dialog speaks: `features` to read columns from,
   * `repaint` taking a colour-of-feature function (a CSS string per feature,
   * the vector contract), and `cataloguePalette` so opening the dialog on
   * the category column proposes the colours the layer already wears rather
   * than the generic qualitative ramp.
   */
  layer.features = records.map((record) => record.feature);
  layer.repaint = (colourOf) => {
    records.forEach((record) => { record.colour = colourOf(record.feature) || null; });
    recolourAll();
  };
  layer.cataloguePalette = { field: "category", colours: { ...CATEGORY_COLOURS } };

  active = {
    records, geometry, fill, group, labelGroup, layer, legendInfo,
    rings: null, downAt: null, labels: new Map(),
    labelLevel: Number(document.getElementById("satellites-labels")?.value ?? 1),
  };
  tick();
  active.timer = window.setInterval(tick, REFRESH_MS);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onFollowPointerDown, true);
  window.addEventListener("pointermove", onFollowPointerMove, true);
  window.addEventListener("pointerup", onFollowPointerUp, true);
  window.addEventListener("keydown", onFollowKey, true);
  installFrameHook();
  window.GeoIDLayerHierarchy?.render?.();
  const cacheNote = cachedGroups
    ? ` ${cachedGroups} of ${GROUPS.length} groups from stored elements `
      + `(${ageCopy(oldestCacheMs)} old) — CelesTrak is rate-limiting.`
    : "";
  say(`${records.length} satellites live at their real altitudes — refreshing `
    + `every ${REFRESH_MS / 1000} s.${cacheNote}`);
  if (document.getElementById("satellites-orbits")?.checked) setRings(true);
  // A fresh start wears the defaults; the swatches must say so even if a
  // previous session's symbology had repainted them.
  refreshCategorySwatches();
  /**
   * Live data deserves a live clock: tracking drops the globe to real time
   * — true rotation, the terminator where it really is — via the corner
   * control's own seam, so the pill says LIVE and the user can put the
   * time-lapse back with one click. Remembered as OURS, so stop() only
   * restores the showcase spin if nobody chose otherwise in between.
   */
  const viewer = window.GeoIDViewer;
  if (viewer?.getTimeRate?.() === "lapse") {
    viewer.setTimeRate?.("real");
    active.autoRealTime = true;
  }
  return true;
}

function stop() {
  // Bumped FIRST and unconditionally: a stop with no `active` yet is a
  // cancellation of the start still in flight.
  runId += 1;
  if (!active) return;
  window.clearInterval(active.timer);
  active.labels.forEach((sprite) => {
    sprite.material.map?.dispose?.();
    sprite.material.dispose?.();
  });
  window.removeEventListener("pointerdown", onDown, true);
  window.removeEventListener("click", onClick, true);
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerdown", onFollowPointerDown, true);
  window.removeEventListener("pointermove", onFollowPointerMove, true);
  window.removeEventListener("pointerup", onFollowPointerUp, true);
  window.removeEventListener("keydown", onFollowKey, true);
  endFollow();
  active.models?.meshes.forEach((mesh) => { mesh.material.dispose?.(); mesh.dispose?.(); });
  if (active.pulseFrame) window.cancelAnimationFrame(active.pulseFrame);
  const viewerCanvas = window.GeoIDViewer?.renderer?.domElement;
  if (viewerCanvas) viewerCanvas.style.cursor = "";
  const layer = layerOf();
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  if (active.autoRealTime && window.GeoIDViewer?.getTimeRate?.() === "real") {
    window.GeoIDViewer.setTimeRate?.("lapse");
  }
  active = null;
  say("Satellites off.");
}

function init() {
  const tickBox = document.getElementById("satellites-toggle");
  if (!tickBox || tickBox.dataset.wired) return;
  tickBox.dataset.wired = "1";
  buildCategoryList();
  const orbitsBox = document.getElementById("satellites-orbits");
  const master = document.getElementById("satellites-master-toggle");
  // The header tick means ALL of it: tracking and orbits together. It stays
  // honest against the children — untick just the orbits and the header
  // unchecks, because "all" is no longer true.
  const syncMaster = () => {
    if (master) master.checked = Boolean(tickBox.checked && orbitsBox?.checked);
  };
  /**
   * The failure untick must come from the CURRENT attempt. A slow fetch
   * invites tick → untick → tick again; the first start is cancelled and
   * resolves false AFTER the second has drawn its dots — and an
   * unconditional untick here then switched the box off under a live
   * layer, which is exactly how "plots the dots then unticks itself" was
   * reported. The sequence token says whose failure it is.
   */
  let tickSeq = 0;
  tickBox.addEventListener("change", async () => {
    if (tickBox.checked) {
      const seq = ++tickSeq;
      const ok = await start();
      if (!ok && seq === tickSeq && !active) tickBox.checked = false;
    } else {
      stop();
    }
    syncMaster();
  });
  orbitsBox?.addEventListener("change", syncMaster);
  /**
   * BOTH boxes are set before EITHER is told, and that ordering is the fix.
   *
   * The old shape set the tracker first and polled for `active` before
   * ticking the orbits — because start() is async and rings need a live
   * tracker. But start() reads the orbits box itself at its finish line, so
   * the poll was never needed: with the box already ticked, one start plots
   * dots AND paths together. And the poll was not merely redundant — it was
   * the bug. While it waited, the tracker's own change handler finished
   * start() and ran syncMaster, which saw tracker-on/orbits-off, unticked
   * this master ("all" was not yet true), and the poll's stale-check then
   * read that untick as the user changing their mind and aborted: dots
   * plotted, master off, orbits never drawn — exactly as reported.
   *
   * Setting both CHECKED states first means any sync that runs mid-start
   * sees the settled intent, never a half-applied one. The orbits box gets
   * its own dispatch only when the tracker is not being started or stopped:
   * a starting tracker applies the box itself, a stopping one takes the
   * rings down with the layer, and setRings guards on `active` anyway.
   */
  master?.addEventListener("change", () => {
    const on = master.checked;
    const trackerChanged = tickBox.checked !== on;
    const orbitsChanged = Boolean(orbitsBox) && orbitsBox.checked !== on;
    if (orbitsBox) orbitsBox.checked = on;
    tickBox.checked = on;
    if (trackerChanged) tickBox.dispatchEvent(new Event("change"));
    else if (orbitsChanged) orbitsBox.dispatchEvent(new Event("change"));
    syncMaster();
  });
  document.getElementById("satellites-orbits")?.addEventListener("change", (event) => {
    setRings(event.target.checked);
  });
  const labelSlider = document.getElementById("satellites-labels");
  const labelCopy = document.getElementById("satellites-labels-copy");
  const caption = () => {
    if (labelCopy) labelCopy.textContent = LABEL_LEVEL_COPY[Number(labelSlider?.value)] || "";
  };
  caption();
  labelSlider?.addEventListener("input", caption);
  labelSlider?.addEventListener("change", () => setLabelLevel(Number(labelSlider.value)));
  // The same dialog every catalogue layer opens, pointed at the live layer.
  document.getElementById("satellites-symbology")?.addEventListener("click", async () => {
    const layer = layerOf();
    if (!layer) {
      say("Turn the tracker on first — symbology colours the live layer.");
      return;
    }
    const dialog = await import("./symbology-dialog.js?v=20261018-0065fc8");
    dialog.openSymbologyDialog(layer);
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
  window.GeoIDSatellites = {
    parseTle,
    satelliteProperties,
    /** Open, fly to and follow a live satellite by NORAD id or name. */
    focus(key) {
      const wanted = String(key ?? "").trim().toUpperCase();
      const record = active?.records.find((r) => r.norad === wanted
        || r.name.trim().toUpperCase() === wanted);
      return record ? openRecord(record) : false;
    },
    /** What the close-in model pass is drawing — for checks, not for UI. */
    modelState() {
      return {
        models: active?.models?.meshes[0]?.count ?? 0,
        following: active?.follow ? { name: active.follow.record.name, phase: active.follow.phase } : null,
        loaded: Boolean(modelData?.geometries),
      };
    },
  };
}
