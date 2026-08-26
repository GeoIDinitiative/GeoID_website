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
const CATEGORY_COLOURS = {
  "Space stations": "#4ee1ec",
  "Science": "#c792ea",
  "Bright (visual)": "#ffd166",
  "Weather": "#6f9dff",
  "Navigation": "#7bdc6f",
  "Geostationary": "#ff8f7a",
  "OneWeb constellation": "#9aa4b2",
};

/** Label priority when the declutter has to choose, most interesting first. */
const LABEL_PRIORITY = ["Space stations", "Science", "Bright (visual)", "Weather",
  "Geostationary", "Navigation", "OneWeb constellation"];

/** The Labels slider's stops: which categories may carry a name. */
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
  updateLabels();
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
  const segmentOwner = [];
  active.records.forEach((record) => {
    record.ringRange = null;
    if (record.dead || record.noRings) return;
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
    const startFloats = positions.length;
    for (let k = 0; k + 1 < points.length; k += 1) {
      positions.push(points[k].x, points[k].y, points[k].z,
        points[k + 1].x, points[k + 1].y, points[k + 1].z);
      colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
      // One entry per SEGMENT: the raycaster answers with a vertex index,
      // and index/2 is the segment — this is how a hit on the one merged
      // mesh finds its satellite.
      segmentOwner.push(record);
    }
    record.ringRange = { start: startFloats, count: positions.length - startFloats };
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
  rings.userData.segmentOwner = segmentOwner;
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
      new THREE.Float32BufferAttribute(new Float32Array(RING_SAMPLES * 6), 3));
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

/** Copy one orbit's vertices into an overlay line, or hide it. */
function showOrbitOverlay(overlay, record) {
  if (!record?.ringRange || !active?.rings) {
    overlay.visible = false;
    return;
  }
  const source = active.rings.geometry.attributes.position.array;
  const target = overlay.geometry.attributes.position;
  const { start, count } = record.ringRange;
  target.array.set(source.subarray(start, start + count));
  target.needsUpdate = true;
  overlay.geometry.setDrawRange(0, count / 3);
  overlay.geometry.computeBoundingSphere();
  overlay.visible = true;
}

/* ── labels ──────────────────────────────────────────────────────────────── */

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
  const camDir = viewer.camera.position.clone().normalize();
  const positions = active.geometry.attributes.position;
  const world = new THREE.Vector3();
  active.group.updateMatrixWorld(true);

  const candidates = [];
  active.records.forEach((record, i) => {
    if (record.dead || !allowed.has(record.category)) return;
    world.set(positions.getX(i), positions.getY(i), positions.getZ(i))
      .applyMatrix4(active.group.matrixWorld);
    // Near side only — a name for a dot behind the planet is a name for
    // nothing, and high orbits are visible well past the limb, so the test
    // is against the CAMERA direction, loosely.
    if (world.clone().normalize().dot(camDir) < -0.2) return;
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
      return dx * dx + dy * dy < LABEL_SPACING_PX * LABEL_SPACING_PX;
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
      const colour = CATEGORY_COLOURS[record.category] || "#8a8a8a";
      const chip = viewer.makeLabelTexture({ name: record.name }, {
        backingScale: 2,
        customPalette: {
          bg: "rgba(10, 12, 20, 0.74)",
          stroke: `${colour}8c`,
          accent: colour,
          title: "rgba(245, 247, 252, 0.96)",
        },
      });
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: chip.texture, transparent: true, depthTest: false, depthWrite: false,
        sizeAttenuation: false,
      }));
      sprite.userData.aspect = chip.width / chip.height;
      active.group.add(sprite);
      active.labels.set(record.norad, sprite);
    }
    sprite.visible = true;
    // In the group's own frame, exactly where the dot is; the offset is the
    // sprite's centre, in fractions of its own size, so it clears the dot by
    // the same margin at every zoom. Each axis converts against its own
    // canvas dimension — width against width — or the viewport's aspect
    // ratio stretches every chip (the fault the volcano labels documented).
    sprite.position.set(positions.getX(candidate.i), positions.getY(candidate.i),
      positions.getZ(candidate.i));
    const heightPx = 20;
    sprite.scale.set(((heightPx * sprite.userData.aspect) / rect.width) * 2,
      (heightPx / rect.height) * 2, 1);
    sprite.center.set(-0.08, 0.5);
    sprite.renderOrder = 3;
  });
}

function setLabelLevel(level) {
  if (!active) return;
  active.labelLevel = level;
  updateLabels();
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

/** The satellite under a pointer position: its dot first, then its orbit. */
function recordAt(clientX, clientY) {
  if (!active) return null;
  const cast = castAt(clientX, clientY);
  if (!cast) return null;
  const { raycaster, worldPerPixel } = cast;
  raycaster.params.Points.threshold = 12 * worldPerPixel;
  const dotHit = raycaster.intersectObject(active.fill, false)
    .filter((h) => !active.records[h.index]?.dead)
    .sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
  if (dotHit) return active.records[dotHit.index];
  if (active.rings?.visible) {
    raycaster.params.Line.threshold = 7 * worldPerPixel;
    const ringHit = raycaster.intersectObject(active.rings, false)
      .sort((a, b) => a.distance - b.distance)[0];
    if (ringHit) {
      // A hit on the merged mesh answers with a vertex index; index/2 is the
      // segment, and the build recorded each segment's owner.
      return active.rings.userData.segmentOwner?.[Math.floor(ringHit.index / 2)] || null;
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
    cast.raycaster.params.Line.threshold = 7 * cast.worldPerPixel;
    const hit = cast.raycaster.intersectObject(active.rings, false)
      .sort((a, b) => a.distance - b.distance)[0];
    const record = hit
      ? active.rings.userData.segmentOwner?.[Math.floor(hit.index / 2)] : null;
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

async function start() {
  say("Fetching orbital elements…");
  let satellite;
  try {
    satellite = await loadSatelliteLib();
  } catch (error) {
    say("The propagator failed to load — satellites need vendor/satellite.min.js.");
    return false;
  }
  const tleSets = [];
  for (const meta of GROUPS) {
    say(`Fetching orbital elements… ${meta.group}`);
    try {
      const response = await fetch(TLE_URL(meta.group));
      if (response.ok) tleSets.push({ meta, triples: parseTle(await response.text()) });
    } catch (error) { /* one throttled group must not sink the layer */ }
    // CelesTrak throttles rapid-fire queries into empty 200s; a beat between
    // requests is what keeps `geo` and `science` from arriving blank.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  if (!tleSets.some((set) => set.triples.length)) {
    say("CelesTrak did not answer.");
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

  active = {
    records, geometry, fill, group, layer, legendInfo,
    rings: null, downAt: null, labels: new Map(),
    labelLevel: Number(document.getElementById("satellites-labels")?.value ?? 1),
  };
  tick();
  active.timer = window.setInterval(tick, REFRESH_MS);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointermove", onMove, true);
  window.GeoIDLayerHierarchy?.render?.();
  say(`${records.length} satellites live at their real altitudes — refreshing `
    + `every ${REFRESH_MS / 1000} s.`);
  if (document.getElementById("satellites-orbits")?.checked) setRings(true);
  return true;
}

function stop() {
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
  const labelSlider = document.getElementById("satellites-labels");
  const labelCopy = document.getElementById("satellites-labels-copy");
  const caption = () => {
    if (labelCopy) labelCopy.textContent = LABEL_LEVEL_COPY[Number(labelSlider?.value)] || "";
  };
  caption();
  labelSlider?.addEventListener("input", caption);
  labelSlider?.addEventListener("change", () => setLabelLevel(Number(labelSlider.value)));
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
