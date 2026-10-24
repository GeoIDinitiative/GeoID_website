// Earth Flight's street lighting: real lamps on real roads, by night.
//
// Owner, 2026-10-24: Black Marble is "a guide to add surface level
// streetlights, urban lighting and using road shp for lampposts" -- not an
// overlay; "streetlights aren't randomly scattered - they must be informed by
// data and mapped quickly on the fly". So:
//
//   * WHERE: every lamp stands on an OpenStreetMap road (the OpenFreeMap
//     vector tiles the 3D buildings already stream), spaced and set back by
//     road class (flight_sim/earth/game/lamps.js), decoded off the main
//     thread (lights-worker.js).
//   * WHETHER and HOW BRIGHT: NASA Black Marble radiance at the lamp's own
//     position decides (lamps.js litPower): a motorway through dark
//     countryside is unlit, a town's residential streets are lit, service
//     roads only in bright centres. LED white or low-pressure sodium by a
//     stable hash of the lamp's place, more LED on the main roads.
//   * AT EVERY RANGE: every lit street within ~4 km (z14 tiles), the main
//     roads to ~30 km (z11), motorways and trunk roads to ~120-220 km (z9),
//     cross-fading between them. From ~1.5 km up the lamps turn from sharp
//     lanterns into a soft glow (their light spread over a few pixels, so the
//     sum follows the roads), and the every-street ring hands over to the
//     main roads. Each lamp is a hot point with a halo whose
//     size follows its real distance (sub-pixel lamps keep their light, so a
//     far motorway is a dotted line of light); close in, each also throws a
//     pool of light on the road (an additive disc lying on the ground).
//   * Depth-tested: hills and buildings hide what is behind them. Night only
//     (the ship's NIGHT from flight-tiles.js); nothing runs by day.

import { NIGHT } from "./night-lights.js?v=20261024-4aa0c10";
import { litPower, radianceAboveBackground, CLASS_BY_CODE } from "../../../flight_sim/earth/game/lamps.js?v=1";

const TILEJSON = "https://tiles.openfreemap.org/planet";
const BM = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const UNITS_PER_M = 3.2 / 6371000;
const EARTH_CIRC_M = 40075016.686;
const LAMP_HEIGHT_M = 9;
const ALL = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"];
// Each level: its tile zoom, how far it reaches, the classes it draws, and
// the distances (m from the aircraft's ground point) it fades in and out over.
export const LEVELS = [
  { z: 14, reach: 4500, classes: ALL, fade: [0, 0, 3500, 4500], pools: true },
  { z: 11, reach: 32000, classes: ["motorway", "trunk", "primary", "secondary"], fade: [3500, 4500, 26000, 32000] },
  { z: 9, reach: 125000, classes: ["motorway", "trunk", "primary"], fade: [26000, 32000, 105000, 125000] },
];
const FETCH_BUDGET = 6;
const BUILD_MS = 6;
const MAX_KEPT = 260;

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const xToLon = (x, z) => (x / 2 ** z) * 360 - 180;
const yToLat = (y, z) => Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z)) * 180 / Math.PI;
const tileSizeM = (z, y) => EARTH_CIRC_M * Math.cos(yToLat(y + 0.5, z) * Math.PI / 180) / 2 ** z;
function distToTileM(lat, lon, z, x, y) {
  const n = yToLat(y, z), s = yToLat(y + 1, z), w = xToLon(x, z), e = xToLon(x + 1, z);
  const cl = Math.max(s, Math.min(n, lat));
  const dLon = lon < w ? w - lon : lon > e ? lon - e : 0;
  return Math.hypot((lat - cl) * 111320, dLon * 111320 * Math.cos(lat * Math.PI / 180));
}

/** The tiles a level wants round a point, nearest first. */
export function tilesFor(level, lat, lon) {
  const { z, reach } = level, n = 2 ** z;
  const cx = Math.floor(lonToX(lon, z)), cy = Math.floor(latToY(lat, z));
  const span = Math.ceil(reach / tileSizeM(z, cy)) + 1;
  const out = [];
  for (let y = cy - span; y <= cy + span; y++) {
    if (y < 0 || y >= n) continue;
    for (let x = cx - span; x <= cx + span; x++) {
      const d = distToTileM(lat, lon, z, ((x % n) + n) % n, y);
      if (d <= reach) out.push({ z, x: ((x % n) + n) % n, y, d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/* ── Browser ────────────────────────────────────────────────────────────── */

let THREE = null, group = null, timer = null, running = false, template = null, worker = null;
let lampMat = null, poolMat = null, poolGeo = null;
const tiles = new Map();          // "L/z/x/y" -> { level, z, x, y, state, lamps, points, pools, used, d }
const fetchQueue = [], buildQueue = [];
let fetching = 0, nextJob = 1;
const jobs = new Map();
const bm = new Map();             // "x/y" (z8) -> Uint8ClampedArray | "loading" | "missing"
const shared = {
  uNight: { value: 0 }, uPxScale: { value: 800 }, uShipW: { value: null }, uDiffuse: { value: 0 },
};
export const stats = { tiles: 0, lamps: 0, lit: 0 };

function radianceAt(lat, lon) {
  const fx = lonToX(lon, 8), fy = latToY(lat, 8);
  const k = `${Math.floor(fx)}/${Math.floor(fy)}`;
  const d = bm.get(k);
  if (!(d instanceof Uint8ClampedArray)) return null;
  const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
  const i = (py * 256 + px) * 4;
  return radianceAboveBackground(d[i], d[i + 1], d[i + 2]);
}
function ensureBM(z, x, y) {
  // The z8 Black Marble tiles a tile's lamps fall in (one, or a few for z9).
  const s = 8 - z;
  const keys = s >= 0 ? [[x << s, y << s, 1 << s]] : [[x >> -s, y >> -s, 1]];
  let ready = true;
  for (const [bx, by, n] of keys) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = `${bx + i}/${by + j}`;
    const have = bm.get(k);
    if (have instanceof Uint8ClampedArray || have === "missing") continue;
    ready = false;
    if (have === "loading") continue;
    bm.set(k, "loading");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      bm.set(k, cx.getImageData(0, 0, 256, 256).data);
    };
    img.onerror = () => bm.set(k, "missing");
    img.src = BM.replace("{z}", 8).replace("{y}", by + j).replace("{x}", bx + i);
  }
  return ready;
}

const LAMP_VERT = /* glsl */`
  uniform float uNight, uPxScale, uDiffuse;
  uniform vec3 uShipW;
  uniform vec4 uFade;           // in0, in1, out0, out1 (m from the aircraft)
  attribute vec3 color;         // lamp colour x power
  varying vec3 vCol;
  varying float vA;
  varying float vCore;
  varying float vDiffuse;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    float upm = ${UNITS_PER_M.toExponential(8)};
    float dCam = max(-mv.z, 1e-9);
    float dShip = distance(wp.xyz, uShipW) / upm;
    float keep = smoothstep(uFade.x, uFade.y + 0.001, dShip) * (1.0 - smoothstep(uFade.z, uFade.w, dShip));
    // The lantern's glow (~12 m) in pixels; a lamp smaller than that still
    // draws two pixels and keeps its light, so far roads stay dotted.
    float px = 12.0 * upm * uPxScale / dCam;
    // High up, a lamp's light falls off with the square of its distance, as
    // a point source's does: the sum over a city is then a glow that follows
    // its density, not a flat wash (a fixed minimum per lamp, right for the
    // scattered far roads seen from 1 km, saturated 500k lamps at 8 km).
    float energy = 4.0 * min(1.0, px * px) * 3.0;
    // HIGH UP the dots go soft: the glow widens to a few pixels whatever the
    // distance, the light SPREAD over it (energy / area), so thousands of
    // lamps add up to a diffuse glow that still follows the roads, rather
    // than a scatter of sub-pixel sparks.
    float diffusePx = mix(2.0, 9.0, uDiffuse);
    float size = clamp(max(px * 2.0, diffusePx), 2.0, 32.0);
    gl_PointSize = size;
    vCore = clamp(1.6 / size, 0.03, 0.6);
    vA = keep * uNight * mix(clamp(px, 0.35, 1.0), energy / (size * size) * 2.2, uDiffuse);
    vDiffuse = uDiffuse;
    vCol = color;
  }
`;
const LAMP_FRAG = /* glsl */`
  varying vec3 vCol;
  varying float vA;
  varying float vCore;
  varying float vDiffuse;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0 || vA < 0.0005) discard;
    float core = exp(-(r * r) / (vCore * vCore));
    float halo = exp(-r * r * 5.0) * 0.28 + (1.0 - r) * (1.0 - r) * 0.08;
    float soft = exp(-r * r * 3.2);                       // diffuse: a gaussian, no hot core
    float f = mix(core * 1.8 + halo, soft, vDiffuse);
    gl_FragColor = vec4(vCol * f * vA, 1.0);
  }
`;
const POOL_VERT = /* glsl */`
  uniform vec3 uShipW;
  uniform float uNight, uDiffuse;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
    float dShip = distance(wp.xyz, uShipW) / ${UNITS_PER_M.toExponential(8)};
    vA = uNight * (1.0 - smoothstep(3000.0, 4500.0, dShip)) * (1.0 - uDiffuse);
    vCol = instanceColor;
  }
`;
const POOL_FRAG = /* glsl */`
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv * 2.0 - 1.0);
    if (r > 1.0 || vA < 0.003) discard;
    // A lamp's light on the road: brightest under it, falling off softly.
    // Tight enough that the dark between columns stays dark: each lamp lights
    // its own stretch of road, as from the air at night.
    float f = pow(1.0 - r, 3.0) * 0.13 + exp(-r * r * 22.0) * 0.12;
    gl_FragColor = vec4(vCol * f * vA, 1.0);
  }
`;

function materials() {
  if (lampMat) return;
  lampMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uFade: { value: new THREE.Vector4() } }, vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  poolMat = new THREE.ShaderMaterial({
    uniforms: shared, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -16,
  });
  poolGeo = new THREE.PlaneGeometry(1, 1);
}

const LED = [1.0, 0.9, 0.78], SODIUM = [1.0, 0.56, 0.2];
function lampColour(code, hash, power) {
  // More LED on the main roads; minor streets keep more sodium.
  const ledShare = code <= 2 ? 0.8 : 0.6;
  const c = hash < ledShare ? LED : SODIUM;
  const k = power * (code <= 1 ? 1.15 : code >= 5 ? 0.85 : 1.0);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Lamps of one tile stood on the terrain: a Points (and pools) at the tile's centre. */
function build(viewer, t) {
  const T = window.GeoIDFlightTerrain;
  const L = t.lamps, n = L.length / 4;
  const centreP = viewer.surfacePoint(yToLat(t.y + 0.5, t.z), xToLon(t.x + 0.5, t.z), 0);
  const centre = new THREE.Vector3(-centreP.x, centreP.y, -centreP.z);
  const pos = [], col = [], poolM = [], poolC = [];
  const v = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), sc = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const u = L[i * 4], vv = L[i * 4 + 1], code = L[i * 4 + 2], hash = L[i * 4 + 3];
    const lat = yToLat(t.y + vv, t.z), lon = xToLon(t.x + u, t.z);
    const rad = radianceAt(lat, lon);
    const power = rad == null ? 0 : litPower(code, rad);
    if (power <= 0) continue;
    lit++;
    const p = viewer.surfacePoint(lat, lon, 0);
    v.set(-p.x, p.y, -p.z);
    const ground = (T?.heightUnits?.(lat, lon) || 0);
    up.copy(v).normalize();
    v.setLength(v.length() + ground + LAMP_HEIGHT_M * UNITS_PER_M);
    const [r, g, b] = lampColour(code, hash, power);
    pos.push(v.x - centre.x, v.y - centre.y, v.z - centre.z);
    col.push(r, g, b);
    if (t.level.pools) {
      const cls = CLASS_BY_CODE[code];
      const diam = (cls.offset * 1.5 + 9) * UNITS_PER_M;
      const gp = v.clone().addScaledVector(up, -LAMP_HEIGHT_M * UNITS_PER_M + 0.15 * UNITS_PER_M).sub(centre);
      q.setFromUnitVectors(Z, up);
      m.compose(gp, q, sc.set(diam, diam, 1));
      poolM.push(m.clone());
      poolC.push(r, g, b);
    }
  }
  disposeMeshes(t);
  if (!lit) { t.state = "built"; t.count = 0; return; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mat = lampMat.clone();
  mat.uniforms = { ...shared, uFade: { value: new THREE.Vector4(...t.level.fade) } };
  t.points = new THREE.Points(geo, mat);
  t.points.position.copy(centre);
  t.points.renderOrder = 195;          // after the ground and the buildings (190)
  t.points.frustumCulled = true;
  t.points.raycast = () => {};
  group.add(t.points);
  if (poolM.length) {
    t.pools = new THREE.InstancedMesh(poolGeo, poolMat, poolM.length);
    poolM.forEach((mm, i) => t.pools.setMatrixAt(i, mm));
    t.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(poolC), 3);
    t.pools.position.copy(centre);
    t.pools.renderOrder = 41;          // on the ground, under the buildings
    t.pools.frustumCulled = false;
    t.pools.raycast = () => {};
    group.add(t.pools);
  }
  t.count = lit;
  t.state = "built";
  t.terrainVersion = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
}

function disposeMeshes(t) {
  if (t.points) { t.points.parent?.remove(t.points); t.points.geometry.dispose(); t.points.material.dispose(); t.points = null; }
  if (t.pools) { t.pools.parent?.remove(t.pools); t.pools.dispose?.(); t.pools = null; }
}

function pump() {
  fetchQueue.sort((a, b) => a.d - b.d);
  while (fetching < FETCH_BUDGET && fetchQueue.length) {
    const t = fetchQueue.shift();
    if (!t.want) { t.state = null; continue; }
    fetching++;
    fetch(template.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!buf) { t.state = "built"; t.count = 0; return; }
        const id = nextJob++;
        jobs.set(id, t);
        worker.postMessage({ id, buf, tileSizeM: tileSizeM(t.z, t.y), classes: t.level.classes }, [buf]);
      })
      .catch(() => { t.state = null; })
      .finally(() => { fetching--; pump(); });
  }
}

function tick() {
  const viewer = window.GeoIDViewer, f = window.__flightSim;
  if (!running || !viewer?.globe || !f?.active || !f.shipLatLon || !template) return;
  const night = NIGHT.value;
  shared.uNight.value = night;
  if (group?.parent !== viewer.globe) {
    group = new THREE.Group();
    group.name = "GeoID-FlightLights";
    group.userData.keepRenderOrder = true;
    viewer.globe.add(group);
  }
  group.visible = night > 0.02;
  if (!group.visible) return;
  // The aircraft's ground point, in world space, for the shaders' range fades.
  const { lat, lon } = f.shipLatLon;
  const sp = viewer.surfacePoint(lat, lon, 0);
  const shipLocal = new THREE.Vector3(-sp.x, sp.y, -sp.z);
  shared.uShipW.value = viewer.globe.localToWorld(shipLocal.clone());
  const canvas = viewer.renderer?.domElement;
  shared.uPxScale.value = (canvas?.clientHeight || 800) / (2 * Math.tan((viewer.camera.fov * Math.PI / 180) / 2));
  // Sharp lanterns low down, a diffuse glow from ~1.5 km up (fully by 6 km);
  // the major-road ring reaches further as the view widens.
  const altM = (Number(f.shipAltUnits) || 0) / UNITS_PER_M;
  shared.uDiffuse.value = Math.min(1, Math.max(0, (altM - 1500) / 4500));
  LEVELS[2].reach = Math.max(125000, Math.min(220000, 4 * altM));
  LEVELS[2].fade[3] = LEVELS[2].reach; LEVELS[2].fade[2] = LEVELS[2].reach * 0.85;
  // From ~2.5 km up the every-street ring hands over to the main-roads ring,
  // so a city does not glow as a bright disc under the aircraft with only
  // its arterials lit round it.
  const hand = 1 - Math.min(1, Math.max(0, (altM - 2500) / 2500));
  LEVELS[0].fade[2] = 3500 * hand; LEVELS[0].fade[3] = 4500 * hand + 1;
  LEVELS[1].fade[0] = 3500 * hand; LEVELS[1].fade[1] = 4500 * hand;
  const now = performance.now();
  for (const t of tiles.values()) t.want = false;
  const tv = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  LEVELS.forEach((level, li) => {
    for (const w of tilesFor(level, lat, lon)) {
      const key = `${li}/${w.z}/${w.x}/${w.y}`;
      let t = tiles.get(key);
      if (!t) { t = { level, z: w.z, x: w.x, y: w.y, state: null }; tiles.set(key, t); }
      t.want = true; t.d = w.d; t.used = now;
      if (!t.state) { t.state = "fetch"; fetchQueue.push(t); }
      if (t.points) { t.points.visible = true; t.points.material.uniforms.uFade.value.set(...level.fade); }
      if (t.pools) t.pools.visible = true;
      // The close lamps follow the terrain as finer heights stream in.
      if (t.state === "built" && li === 0 && t.count && t.terrainVersion !== tv && t.lamps && !buildQueue.includes(t)) buildQueue.push(t);
    }
  });
  for (const t of tiles.values()) if (!t.want) { if (t.points) t.points.visible = false; if (t.pools) t.pools.visible = false; }
  // Build what has decoded, nearest first, within a few ms.
  buildQueue.sort((a, b) => a.d - b.d);
  const until = now + BUILD_MS;
  for (let i = 0; i < buildQueue.length && performance.now() < until;) {
    const t = buildQueue[i];
    if (!t.want) { buildQueue.splice(i, 1); continue; }
    if (!ensureBM(t.z, t.x, t.y)) { i++; continue; }
    buildQueue.splice(i, 1);
    build(viewer, t);
  }
  // Forget the oldest beyond the budget.
  if (tiles.size > MAX_KEPT) {
    const old = [...tiles.values()].filter((t) => !t.want).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, tiles.size - MAX_KEPT)) { disposeMeshes(t); tiles.delete(`${LEVELS.indexOf(t.level)}/${t.z}/${t.x}/${t.y}`); }
  }
  pump();
  let lit = 0, nt = 0;
  for (const t of tiles.values()) if (t.want && t.count) { lit += t.count; nt++; }
  stats.tiles = nt; stats.lit = lit;
}

/** Start the street lighting (idempotent). */
export async function startFlightLights() {
  if (running) return;
  running = true;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  materials();
  shared.uShipW.value = new THREE.Vector3();
  if (!worker) {
    worker = new Worker(new URL("../../../flight_sim/earth/game/lights-worker.js?v=1", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const t = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      if (!t) return;
      if (e.data.error || !e.data.lamps?.length) { t.state = "built"; t.count = 0; return; }
      t.lamps = e.data.lamps;
      t.state = "decoded";
      buildQueue.push(t);
    };
  }
  if (!template) {
    try { template = (await (await fetch(TILEJSON)).json()).tiles?.[0] || null; } catch (e) { template = null; }
  }
  if (!running) return;
  tick();
  timer = setInterval(tick, 300);
}

/** Stop and free it. */
export function stopFlightLights() {
  running = false;
  clearInterval(timer); timer = null;
  for (const t of tiles.values()) disposeMeshes(t);
  tiles.clear(); fetchQueue.length = 0; buildQueue.length = 0; jobs.clear();
  group?.parent?.remove(group); group = null;
}

/** For the Metadata window while lights are drawn. */
export function creditNow() {
  if (!running || !stats.lit) return null;
  return {
    title: "Earth Flight street lighting",
    source: "Lamps on OpenStreetMap roads (OpenFreeMap vector tiles, transportation layer, z9/z11/z14), spaced by road class; lit or dark, and how brightly, from NASA Black Marble (VIIRS, 2016) radiance at each lamp",
    citation: "Roads: © OpenStreetMap contributors, ODbL 1.0; tiles: OpenFreeMap (openfreemap.org), OpenMapTiles schema © OpenMapTiles. Night lights: NASA Black Marble (Suomi NPP VIIRS), 2016, via NASA EOSDIS GIBS, public domain. Lamp spacing, setback and colour are typical practice (procedural); which lamps are lit follows the radiance.",
    crs: "EPSG:3857 tiles, drawn on the globe",
    licence: "ODbL 1.0 (OpenStreetMap); public domain (Black Marble)",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDFlightLights = { active: () => running, stats, startFlightLights, stopFlightLights, creditNow };
}
