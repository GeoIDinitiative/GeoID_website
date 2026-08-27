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

/**
 * Seven CelesTrak groups now — roughly 1,700 objects. `rings: false` on the
 * OneWeb constellation: 650 near-identical polar orbits drawn as rings is a
 * hairball that hides every other orbit, and the constellation's dots
 * already read as the shell they are. Fetched SEQUENTIALLY, because
 * CelesTrak throttles rapid-fire parallel queries into empty answers — the
 * first parallel version read `geo` and `science` as zero satellites.
 */
const GROUPS = [
  { group: "stations", kind: "Space station", category: "Space stations" },
  { group: "science", kind: "Science satellite", category: "Science" },
  { group: "visual", kind: "Satellite", category: "Bright (visual)" },
  { group: "weather", kind: "Weather satellite", category: "Weather" },
  { group: "gnss", kind: "Navigation satellite", category: "Navigation" },
  { group: "geo", kind: "Geostationary satellite", category: "Geostationary" },
  { group: "oneweb", kind: "Constellation satellite", category: "OneWeb constellation", rings: false },
];

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
  updateLabels();
}

/**
 * Every orbit as one merged line mesh: hundreds of rings, one draw call.
 *
 * Sampled in ECI over each object's own period, converted to the ground
 * frame at ONE shared instant (`gmst0`), coloured by category at the vertex.
 */
async function buildRings() {
  const satellite = window.satellite;
  const date = simNow();
  const gmst0 = satellite.gstime(date);
  const positions = [];
  const colours = [];
  const colour = new THREE.Color();
  const scratch = new THREE.Vector3();
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
    const periodMs = ((2 * Math.PI) / (record.satrec.no_kozai ?? record.satrec.no)) * 60000;
    colour.set(colourFor(record));
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
      vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false,
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
 * For the constellations that draw no mass rings (OneWeb), and for anything
 * whose 160-sample ring is being singled out — a chord-y polyline is
 * acceptable as one thread among a thousand and not as the one line you are
 * looking at. Cached per record against the rings' own gmst0 frame, so it
 * costs one propagation pass per satellite per activation.
 */
function soloOrbit(record) {
  if (record.soloRing) return record.soloRing;
  const satellite = window.satellite;
  const gmst0 = active.rings.userData.gmst0;
  const date = simNow();
  const periodMs = ((2 * Math.PI) / (record.satrec.no_kozai ?? record.satrec.no)) * 60000;
  const scratch = new THREE.Vector3();
  const points = [];
  for (let k = 0; k <= SOLO_SAMPLES; k += 1) {
    let out;
    try {
      out = satellite.propagate(record.satrec,
        new Date(date.getTime() + (periodMs * k) / SOLO_SAMPLES));
    } catch (error) { break; }
    if (!out?.position) break;
    const ecf = satellite.eciToEcf(out.position, gmst0);
    points.push(ecfToScene(ecf, scratch).clone());
  }
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
 * The satellite tag: bare type, no box.
 *
 * The strip version — translucent backing, chamfer, underline — read as
 * forty dark plaques stuck over the planet at a global view. What a tracker
 * HUD actually needs is the NAME and nothing else: micro uppercase type
 * with a tight dark halo for legibility over stars and orbit lines, and a
 * short leader dash in the category colour tying it to its dot. The ink is
 * a fraction of the strip's, so the same count of labels reads far quieter.
 */
const tagTextures = new Map();

function makePillTexture(name, colour) {
  const key = `v4|${colour}|${name}`;
  if (tagTextures.has(key)) return tagTextures.get(key);
  /**
   * The viewer's OWN pill, through the seam the volcano labels use — the
   * bespoke bare-type tag before it was reported twice: not interactive
   * enough, and its type smearing. `makeLabelTexture` is the engine every
   * other location label goes through, so the satellites finally wear the
   * same chip, with the category colour as the accent bar and a darker
   * space-HUD backing. backingScale 2: forty names, not four.
   */
  const make = window.GeoIDViewer?.makeLabelTexture;
  const label = make(name, {
    backingScale: 3,
    customPalette: {
      bg: "rgba(6, 10, 18, 0.82)",
      stroke: `${colour}88`,
      accent: colour,
      title: "rgba(240, 246, 252, 0.97)",
    },
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
   * The tags shrink and thin out as the camera pulls away.
   *
   * A fixed size reads right when the globe fills the screen and enormous
   * when the whole GNSS shell is in frame and the Earth is a coin — the
   * tag stays, the world it annotates shrinks. Height eases 10 → 6.5 px
   * (bare type, so that is ~7.5 px letters down to ~5 px) and the declutter
   * spacing widens 64 → 130 px as the camera runs out from 5 to 25 units,
   * so a distant view carries fewer, smaller names.
   */
  const camDist = viewer.camera.position.length();
  const far = Math.max(0, Math.min(1, (camDist - 5) / 20));
  // Pill height on screen: the chip is 34 logical px tall, shown at
  // 18 px easing to 13 as the camera runs out — 15 px was reported
  // unreadable, and the backing renders at 3x for the minification.
  const heightPx = 18 - 5 * far;
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
    const p = world.clone().project(viewer.camera);
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return;
    candidates.push({
      record,
      i,
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
      const tag = makePillTexture(record.name, colourFor(record));
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tag.texture, transparent: true, depthTest: false, depthWrite: false,
        sizeAttenuation: false,
      }));
      sprite.userData.aspect = tag.width / tag.height;
      sprite.userData.record = record;
      active.labelGroup.add(sprite);
      active.labels.set(record.norad, sprite);
    }
    sprite.visible = true;
    // In the group's own frame, exactly where the dot is; the offset is the
    // sprite's centre, in fractions of its own size, so it clears the dot by
    // the same margin at every zoom. Each axis converts against its own
    // canvas dimension — width against width — or the viewport's aspect
    // ratio stretches every tag (the fault the volcano labels documented).
    sprite.position.set(positions.getX(candidate.i), positions.getY(candidate.i),
      positions.getZ(candidate.i));
    sprite.scale.set(((heightPx * sprite.userData.aspect) / rect.width) * 2,
      (heightPx / rect.height) * 2, 1);
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
 * A raycast cannot serve here: the sprites render with
 * `sizeAttenuation: false`, so their drawn size is a screen fact the
 * raycaster's world-space math does not see. The same projection that
 * places a tag answers whether a click landed on it.
 */
function tagAt(clientX, clientY) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !active) return null;
  const rect = canvas.getBoundingClientRect();
  const world = new THREE.Vector3();
  for (const sprite of active.labels.values()) {
    if (!sprite.visible) continue;
    sprite.getWorldPosition(world).project(viewer.camera);
    const ax = (world.x * 0.5 + 0.5) * rect.width + rect.left;
    const ay = (-world.y * 0.5 + 0.5) * rect.height + rect.top;
    const w = (sprite.scale.x * rect.width) / 2;
    const h = (sprite.scale.y * rect.height) / 2;
    // sprite.center is (-0.1, 0.5): the quad's centre sits 0.6 widths
    // right of the anchor, level with it.
    const cx = ax + (0.5 - sprite.center.x) * w - w / 2;
    const cy = ay + (sprite.center.y - 0.5) * h;
    if (Math.abs(clientX - cx) <= w / 2 + 4 && Math.abs(clientY - cy) <= h / 2 + 4) {
      return sprite.userData.record || null;
    }
  }
  return null;
}

/** The satellite under a pointer: its dot, then its tag, then its orbit. */
function recordAt(clientX, clientY) {
  if (!active) return null;
  const cast = castAt(clientX, clientY);
  if (!cast) return null;
  const { raycaster, worldPerPixel } = cast;
  raycaster.params.Points.threshold = 12 * worldPerPixel;
  const dotHit = raycaster.intersectObject(active.fill, false)
    .filter((h) => !active.records[h.index]?.dead && !active.records[h.index]?.hidden)
    .sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
  if (dotHit) return active.records[dotHit.index];
  const tagged = tagAt(clientX, clientY);
  if (tagged) return tagged;
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
  const item = window.GeoIDPointLabels?.featureToItem?.(record.feature, active.legendInfo);
  if (!item || !viewer.openSceneFeature?.(item)) return;
  select(record);
  window.GeoIDFeaturePopup?.suppress?.(500);
  event.stopPropagation();
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
  if (!active.pulseFrame) pulseLoop();
}

function deselect() {
  if (!active) return;
  active.selected = null;
  if (active.pulseDot) active.pulseDot.visible = false;
  if (active.rings?.userData.pulse) active.rings.userData.pulse.visible = false;
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
    legendInfo,
    info: {
      source: "CelesTrak orbital elements, SGP4-propagated in the browser",
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
  master?.addEventListener("change", async () => {
    const on = master.checked;
    if (tickBox.checked !== on) {
      tickBox.checked = on;
      tickBox.dispatchEvent(new Event("change"));
      // start() is async; the orbits tick below finds `active` because the
      // change handler above awaited it before returning… it did not — the
      // dispatch returns immediately. So wait for the tracker to be up.
      if (on) {
        for (let i = 0; i < 100 && !active; i += 1) {
          await new Promise((resolve) => { setTimeout(resolve, 200); });
          // The user changed their mind mid-fetch: this handler's plan is
          // stale, and the newer change event owns the outcome.
          if (master.checked !== on) return;
        }
      }
    }
    if (orbitsBox && orbitsBox.checked !== on) {
      orbitsBox.checked = on;
      orbitsBox.dispatchEvent(new Event("change"));
    }
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
    const dialog = await import("./symbology-dialog.js?v=20260827-5e51d5b");
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
  window.GeoIDSatellites = { parseTle, satelliteProperties };
}
