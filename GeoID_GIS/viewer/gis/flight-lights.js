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
//   * AT EVERY RANGE, centred AHEAD of the aircraft and growing with height,
//     coarser outward: every lit street close round it (z14) and out to
//     26-80 km ahead (z12), town and main roads to 70-170 km (z11), from 8 km
//     up motorway-secondary to ~180 km more (z10), motorways and trunk roads
//     to 200-400 km (z9), with wide crossfades between them. Black Marble is never drawn: it only
//     decides which lamps are lit. From ~1.5 km up the lamps turn from sharp
//     lanterns into a soft glow (their light spread over a few pixels, so the
//     sum follows the roads), and the every-street ring hands over to the
//     main roads. Each lamp is a hot point with a halo whose
//     size follows its real distance (sub-pixel lamps keep their light, so a
//     far motorway is a dotted line of light); close in, each also throws a
//     pool of light on the road (an additive disc lying on the ground).
//   * Depth-tested: hills and buildings hide what is behind them. Night only
//     (the ship's NIGHT from flight-tiles.js); nothing runs by day.

import { NIGHT } from "./night-lights.js?v=20261025-a4b7425";

const TILEJSON = "https://tiles.openfreemap.org/planet";
const BM = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const UNITS_PER_M = 3.2 / 6371000;
const EARTH_CIRC_M = 40075016.686;
const LAMP_HEIGHT_M = 9;
const ALL = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"];
// Each level: its tile zoom, the classes it draws, whether it is centred on
// the aircraft or on a point AHEAD of it, how far it reaches from that centre,
// and the distances it fades in and out over (`fade`: in0, in1 measured from
// `inFrom`, out0, out1 from `outFrom`; 0 = the aircraft, 1 = the ahead point).
// Reaches and fades are set each tick from the aircraft's height (tick()).
export const LEVELS = [
  { z: 14, classes: ALL, pools: true, centre: 0, reach: 4500, inFrom: 0, outFrom: 0, fade: [0, 0, 3500, 4500] },
  { z: 11, classes: ["motorway", "trunk", "primary", "secondary", "tertiary"], centre: 1, reach: 70000, inFrom: 1, outFrom: 1, fade: [0, 0, 0, 0], thin: 2 },
  { z: 9, classes: ["motorway", "trunk", "primary"], centre: 1, reach: 200000, inFrom: 1, outFrom: 1, fade: [0, 0, 0, 0], thin: 3 },
  // Every street, coarser (z12 carries the minor roads too, at a quarter of
  // z13's tiles), far out ahead: a town 20-80 km away is its whole street
  // network glowing, not just its arterials -- every second lamp, each twice
  // as bright, which reads the same at that range.
  { z: 12, classes: ALL, centre: 1, reach: 14000, inFrom: 0, outFrom: 1, fade: [0, 0, 0, 0], thin: 2 },
  // From ~8 km up, a ring between the main roads and the motorways (z10:
  // motorway to secondary), so the lit country reaches ~180 km.
  { z: 10, classes: ["motorway", "trunk", "primary", "secondary"], centre: 1, reach: 0, inFrom: 1, outFrom: 1, fade: [0, 0, 0, 0], thin: 3 },
];
const FETCH_BUDGET = 10;          // OpenFreeMap is HTTP/2: one connection, many streams
const MAX_KEPT = 900;

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

/** The tiles a level wants within `reach` of a centre, nearest the aircraft first. */
export function tilesFor(level, centre, ship = centre, reach = level.reach) {
  const { z } = level, n = 2 ** z;
  const cx = Math.floor(lonToX(centre.lon, z)), cy = Math.floor(latToY(centre.lat, z));
  const span = Math.ceil(reach / tileSizeM(z, cy)) + 1;
  const out = [];
  for (let y = cy - span; y <= cy + span; y++) {
    if (y < 0 || y >= n) continue;
    for (let x = cx - span; x <= cx + span; x++) {
      const xx = ((x % n) + n) % n;
      const dc = distToTileM(centre.lat, centre.lon, z, xx, y);
      if (dc > reach) continue;
      out.push({ z, x: xx, y, dc, d: distToTileM(ship.lat, ship.lon, z, xx, y) });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/* ── Browser ────────────────────────────────────────────────────────────── */

let THREE = null, group = null, timer = null, running = false, template = null;
// Decoding road tiles is the slow part: a few workers in parallel. A tile
// always goes to the same one (by its key), which caches its decoded roads
// for terrain updates; Black Marble tiles go to every worker.
const workers = [];
const POOL = Math.max(2, Math.min(4, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4) - 1));
function workerFor(key) { let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0; return workers[Math.abs(h) % workers.length]; }
let lampMat = null, poolMat = null, poolGeo = null;
const tiles = new Map();          // "L/z/x/y" -> { level, z, x, y, state, lamps, points, pools, used, d }
const fetchQueue = [], readyQueue = [];
let fetching = 0, nextJob = 1;
let prevShip = null, lastDir = null;
const jobs = new Map();
const bm = new Map();             // "x/y" (z8) -> Uint8ClampedArray | "loading" | "missing"
const shared = {
  uNight: { value: 0 }, uPxScale: { value: 800 }, uShipW: { value: null }, uAheadW: { value: null }, uDiffuse: { value: 0 },
};
export const stats = { tiles: 0, lamps: 0, lit: 0 };

/** The z8 Black Marble tile a lamp tile's lamps fall in, handed to the worker once. */
function ensureBM(z, x, y) {
  const s = 8 - z;
  const bx = s >= 0 ? x << s : x >> -s, by = s >= 0 ? y << s : y >> -s;
  const k = `${bx}/${by}`;
  const have = bm.get(k);
  if (have === "sent" || have === "missing") return true;
  if (have === "loading") return false;
  bm.set(k, "loading");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, 256, 256).data;
    for (const w of workers) w.postMessage({ bm: data, bmKey: k });
    bm.set(k, "sent");
  };
  img.onerror = () => bm.set(k, "missing");
  img.src = BM.replace("{z}", 8).replace("{y}", by).replace("{x}", bx);
  return false;
}

/** The tile's ground heights (scene units, at the Vertical scale) for the
 *  worker: 33 x 33, or 65 x 65 on the big z9-z11 tiles. */
function demGrid(t) {
  const T = window.GeoIDFlightTerrain;
  if (!T?.active?.()) return null;
  const n = t.z <= 11 ? 65 : 33;
  const dem = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const lat = yToLat(t.y + j / (n - 1), t.z);
    for (let i = 0; i < n; i++) dem[j * n + i] = T.heightUnits(lat, xToLon(t.x + i / (n - 1), t.z)) || 0;
  }
  return dem;
}
/** A few heights across a tile: has the terrain under its lamps really changed? */
function heightSig(t) {
  const T = window.GeoIDFlightTerrain;
  const out = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    out.push(T?.heightUnits?.(yToLat(t.y + (j + 0.5) / 3, t.z), xToLon(t.x + (i + 0.5) / 3, t.z)) || 0);
  }
  return out;
}

const LAMP_VERT = /* glsl */`
  uniform float uNight, uPxScale, uDiffuse;
  uniform vec3 uShipW, uAheadW;
  uniform vec4 uFade;           // in0, in1 (m from uInFrom's centre), out0, out1 (from uOutFrom's)
  uniform vec2 uFrom;           // x: fade-in from (0 aircraft, 1 ahead point), y: fade-out from
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
    float upm = ${UNITS_PER_M.toExponential(8)};
    float dCam = max(-mv.z, 1e-9);
    // DEPTH MARGIN: the lamps stand on a 33 x 33 height grid per road tile,
    // the ground on finer heights, so on any rise a lamp sat under the drawn
    // surface and the depth test hid it (measured: 717k lamps in view, 30 km
    // up, almost none drawn). Its depth is pulled toward the eye by a margin
    // growing with range (screen position unchanged); hills and buildings
    // still hide it.
    // Far off, the ground tiles are coarse: kilometre cells whose heights are
    // interpolated straight across, so a valley (where the towns are) is
    // bridged hundreds of metres above its floor. The margin follows that
    // error, ~1.2% of the range.
    // And from altitude (diffuse) it opens right up: you are above anything
    // that could hide a town, while the coarse distant ground's heights shift
    // as its tiles change detail, so a strict test flipped whole towns between
    // buried and lit as you moved -- and made them shimmer. Close in (sharp
    // lanterns) it stays strict, so buildings and hills hide what is behind.
    float margin = max(30.0 * upm, dCam * mix(0.012, 0.35, uDiffuse));
    // Never through the eye: behind the camera (dCam was floored at 1e-9, so
    // the factor below went hugely negative) or nearer than the margin, the
    // pull flipped a lamp to the far side of the camera -- the city behind the
    // aircraft hung upside down in the sky ahead. Behind is clipped; nearer
    // than the margin keeps a sliver of its range.
    if (mv.z > -1e-9) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    else gl_Position = projectionMatrix * vec4(mv.xyz * max(1.0 - margin / dCam, 0.02), 1.0);
    #include <logdepthbuf_vertex>
    float dShip = distance(wp.xyz, uShipW) / upm, dAhead = distance(wp.xyz, uAheadW) / upm;
    float dIn = mix(dShip, dAhead, uFrom.x), dOut = mix(dShip, dAhead, uFrom.y);
    float keep = smoothstep(uFade.x, uFade.y + 0.001, dIn) * (1.0 - smoothstep(uFade.z, uFade.w, dOut));
    // The lantern's glow (~12 m) in pixels; a lamp smaller than that still
    // draws two pixels and keeps its light, so far roads stay dotted.
    float px = 12.0 * upm * uPxScale / dCam;
    // High up, a lamp's light falls off with distance, so the sum over a
    // city is a glow that follows its street density, not a flat wash
    // (between a point source's 1/d^2 and the 1/d of an eye exposing for the
    // night).
    // Gain tuned with every lamp drawn (it had been set while the depth test
    // was hiding most of them, and over-exposed into white blobs once fixed).
    float energy = 4.0 * min(1.0, pow(px, 1.5)) * 1.0;
    // HIGH UP the dots go soft: the glow widens to a few pixels whatever the
    // distance, the light SPREAD over it (energy / area), so thousands of
    // lamps add up to a diffuse glow that still follows the roads, rather
    // than a scatter of sub-pixel sparks.
    float diffusePx = mix(2.0, 10.0, uDiffuse);
    float size = clamp(max(px * 2.0, diffusePx), 2.0, 32.0);
    gl_PointSize = size;
    vCore = clamp(1.6 / size, 0.03, 0.6);
    // Low down a lamp keeps a 2 px dot's light out to where its glow is a
    // third of a pixel, and beyond that dims with distance (^1.5): with the
    // streets lit 26 km ahead, a fixed floor stacked thousands of far lamps
    // into an over-exposed white line along the horizon.
    float lowA = px >= 0.35 ? min(px, 1.0) : 0.35 * pow(px / 0.35, 1.5);
    vA = keep * uNight * mix(lowA, energy / (size * size) * 2.2, uDiffuse);
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
    uniforms: { ...shared, uFade: { value: new THREE.Vector4() }, uFrom: { value: new THREE.Vector2() } }, vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  poolMat = new THREE.ShaderMaterial({
    uniforms: shared, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -16,
  });
  poolGeo = new THREE.PlaneGeometry(1, 1);
}

/*
 * The worker takes tiles a few at a time, always the most urgent first: it
 * works in arrival order, and big z11/z13 road tiles that landed early were
 * keeping the close streets waiting ~10 s.
 */
const WORKER_BUDGET = 2 * POOL;
let working = 0;
function pumpReady() {
  readyQueue.sort((a, b) => priority(a) - priority(b));
  for (let i = 0; i < readyQueue.length && working < WORKER_BUDGET;) {
    const t = readyQueue[i];
    if (!t.want && t.state === "fetched") { readyQueue.splice(i, 1); t.state = null; t.buf = null; continue; }
    if (!ensureBM(t.z, t.x, t.y)) { i++; continue; }
    readyQueue.splice(i, 1);
    t.queued = false;
    working++;
    stand(t);
  }
}

/** Hand a tile to the worker: its road tile (first time) and its ground heights. */
function stand(t) {
  const id = nextJob++;
  jobs.set(id, t);
  t.state = "standing";
  const dem = demGrid(t);
  const msg = { id, key: t.key, z: t.z, x: t.x, y: t.y, tileSizeM: tileSizeM(t.z, t.y), classes: t.level.classes, dem, demN: dem ? Math.round(Math.sqrt(dem.length)) : 0, pools: !!t.level.pools, thin: t.level.thin || 1 };
  const transfer = [];
  if (t.buf) { msg.buf = t.buf; transfer.push(t.buf); t.buf = null; }
  if (msg.dem) transfer.push(msg.dem.buffer);
  t.terrainVersion = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  t.sig = heightSig(t);
  t.vex = window.GeoIDFlightTerrain?.getVex?.() ?? 1;
  workerFor(t.key).postMessage(msg, transfer);
}

/** The worker's lamps for a tile, as a Points (and pools) at the tile's centre. */
function meshes(t, r) {
  disposeMeshes(t);
  const n = r.positions.length / 3;
  t.count = n;
  t.state = "built";
  if (!n || !group) return;
  const centre = new THREE.Vector3(...r.centre);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(r.colours, 3));
  geo.computeBoundingSphere();
  const mat = lampMat.clone();
  mat.uniforms = { ...shared, uFade: { value: new THREE.Vector4(...t.level.fade) }, uFrom: { value: new THREE.Vector2(t.level.inFrom, t.level.outFrom) } };
  t.points = new THREE.Points(geo, mat);
  t.points.position.copy(centre);
  t.points.renderOrder = 195;          // after the ground and the buildings (190)
  t.points.raycast = () => {};
  t.points.visible = !!t.want;
  group.add(t.points);
  if (r.pools && r.pools.length) {
    const np = r.pools.length / 16;
    t.pools = new THREE.InstancedMesh(poolGeo, poolMat, np);
    t.pools.instanceMatrix.array.set(r.pools);
    t.pools.instanceMatrix.needsUpdate = true;
    t.pools.instanceColor = new THREE.InstancedBufferAttribute(r.colours, 3);
    t.pools.position.copy(centre);
    t.pools.renderOrder = 41;          // on the ground, under the buildings
    t.pools.frustumCulled = false;
    t.pools.raycast = () => {};
    t.pools.visible = !!t.want;
    group.add(t.pools);
  }
}

function disposeMeshes(t) {
  if (t.points) { t.points.parent?.remove(t.points); t.points.geometry.dispose(); t.points.material.dispose(); t.points = null; }
  if (t.pools) { t.pools.parent?.remove(t.pools); t.pools.dispose?.(); t.pools = null; }
}

// Fetch order: the close streets first, then the wider rings (the ship sits
// inside the big z9/z11 tiles too, and they were competing as equals).
const LEVEL_PENALTY_M = [0, 8000, 40000, 2500, 25000];
const priority = (t) => t.d + LEVEL_PENALTY_M[LEVELS.indexOf(t.level)];
function pump() {
  fetchQueue.sort((a, b) => priority(a) - priority(b));
  while (fetching < FETCH_BUDGET && fetchQueue.length) {
    const t = fetchQueue.shift();
    if (!t.want) { t.state = null; continue; }
    fetching++;
    fetch(template.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!buf) { t.state = "built"; t.count = 0; return; }
        t.buf = buf;
        t.state = "fetched";
        readyQueue.push(t);
        pumpReady();
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
  // Sharp lanterns low down, a diffuse glow from ~1.5 km up (fully by 6 km).
  const altM = (Number(f.shipAltUnits) || 0) / UNITS_PER_M;
  shared.uDiffuse.value = Math.min(1, Math.max(0, (altM - 1500) / 4500));
  // Ring sizes change in 1 km steps of height, not with every metre of a climb.
  const altStep = Math.round(altM / 1000) * 1000;
  // AHEAD: the rings are centred where the aircraft is going (its own motion
  // since the last tick), so the lit streets reach far out in front of it
  // (owner: "the radius ahead of view for the night lighting needs increased
  // greatly") rather than round it, where most of the light was behind.
  // From the sim's own heading (position deltas every 0.3 s were noisy),
  // smoothed over ~8 s, so a turn swings the rings slowly.
  const tNow = performance.now();
  const hd = (Number(f.headingDeg) || 0) * Math.PI / 180;
  const cur = { lat: Math.cos(hd), lon: Math.sin(hd) };
  if (!lastDir) lastDir = cur;
  else {
    const k = 1 - Math.exp(-Math.max(0, tNow - (prevShip?.t ?? tNow)) / 8000);
    const a = lastDir.lat + (cur.lat - lastDir.lat) * k, b = lastDir.lon + (cur.lon - lastDir.lon) * k;
    const n = Math.hypot(a, b) || 1;
    lastDir = { lat: a / n, lon: b / n };
  }
  prevShip = { lat, lon, t: tNow };
  const aheadM = Math.min(40000, 12000 + 1.5 * altStep);
  const d = lastDir || { lat: 0, lon: 0 };
  const ahead = { lat: lat + d.lat * aheadM / 111320, lon: lon + d.lon * aheadM / (111320 * Math.cos(lat * Math.PI / 180)) };
  const ap = viewer.surfacePoint(ahead.lat, ahead.lon, 0);
  shared.uAheadW.value = viewer.globe.localToWorld(new THREE.Vector3(-ap.x, ap.y, -ap.z));
  // Every street: close round the aircraft (z14), and from there out to
  // ~26 km ahead (z13, further when higher); main roads to ~70 km ahead;
  // motorways and A-roads to 200-300 km. Each fades in where the last fades
  // out. From ~2.5 km up the close ring hands over to the z13 one.
  const high = Math.min(1, Math.max(0, (altM - 2500) / 2500)), hand = 1 - high;
  // Radii grow with height, the tiles coarsening outward ("lower resolution
  // with height"); crossfades are wide (a fifth of a ring) so no band of
  // light sweeps visibly across the ground as the aircraft moves.
  const r13 = Math.min(40000, 14000 + 1.3 * altStep);
  const r11 = Math.min(90000, 70000 + 1.0 * altStep);
  const useZ10 = altStep > 8000;
  const r10 = useZ10 ? Math.min(180000, 100000 + 4 * altStep) : 0;
  const r9 = Math.min(400000, Math.max(200000, 12 * altStep));
  const band = (r) => 0.2 * r;
  LEVELS[0].fade = [0, 0, 3500 * hand, 4500 * hand + 1];
  LEVELS[3].reach = r13; LEVELS[3].fade = [3500 * hand, 4500 * hand, r13 - band(r13), r13];
  LEVELS[1].reach = r11; LEVELS[1].fade = [r13 - band(r13), r13, r11 - band(r11), r11];
  LEVELS[4].reach = r10; LEVELS[4].fade = [r11 - band(r11), r11, r10 - band(r10), r10];
  const r9in = useZ10 ? r10 : r11;
  LEVELS[2].reach = r9; LEVELS[2].fade = [r9in - band(r9in), r9in, r9 - band(r9), r9];
  const now = performance.now();
  for (const t of tiles.values()) t.want = false;
  const tv = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  let restands = 0;
  const vexNow = window.GeoIDFlightTerrain?.getVex?.() ?? 1;
  LEVELS.forEach((level, li) => {
    if (level.reach <= 0) return;
    // HYSTERESIS: a tile joins inside its ring and leaves only 15% beyond
    // it, so tiles at the edge do not flicker in and out (measured: 2-7 per
    // tick in straight, level flight).
    for (const w of tilesFor(level, level.centre ? ahead : { lat, lon }, { lat, lon }, level.reach * 1.15)) {
      const key = `${li}/${w.z}/${w.x}/${w.y}`;
      let t = tiles.get(key);
      if (w.dc > level.reach && !t?.wasWanted) continue;
      if (!t) { t = { level, key, z: w.z, x: w.x, y: w.y, state: null }; tiles.set(key, t); }
      t.want = true; t.d = w.d; t.used = now;
      if (!t.state) { t.state = "fetch"; fetchQueue.push(t); }
      if (t.points) { t.points.visible = true; t.points.material.uniforms.uFade.value.set(...level.fade); }
      if (t.pools) t.pools.visible = true;
      // The close lamps follow the terrain as finer heights stream in.
      // EVERY ring follows the terrain as finer heights stream in (only the
      // close one did, and lamps stood on early, coarse heights stayed
      // floating over valleys): re-stood when the heights under the tile have
      // really moved, a few tiles a tick, nearest first.
      // A change of the Vertical scale re-stands everything at once: lamps
      // left at the old scale floated kilometres up (or sank), and where two
      // rings overlap the same road showed twice, at two heights.
      if (t.queued) { /* already waiting for the worker */ }
      else if (t.state === "built" && t.count && t.vex !== vexNow) { t.terrainVersion = tv; t.queued = true; readyQueue.push(t); }
      else if (t.state === "built" && t.count && t.terrainVersion !== tv && restands < 20) {
        const sig = heightSig(t);
        const moved = !t.sig || sig.some((h, i) => Math.abs(h - t.sig[i]) / UNITS_PER_M > 3);
        t.terrainVersion = tv;
        if (moved) { t.queued = true; readyQueue.push(t); restands++; }
      }
    }
  });
  for (const t of tiles.values()) { t.wasWanted = t.want; if (!t.want) { if (t.points) t.points.visible = false; if (t.pools) t.pools.visible = false; } }
  // Hand what has arrived to the worker, nearest first, once its Black
  // Marble tile is there (a few ms here: the heights grid; the rest is off
  // the main thread).
  pumpReady();
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
  shared.uAheadW.value = new THREE.Vector3();
  if (!workers.length) {
    const onmessage = (e) => {
      const t = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      working = Math.max(0, working - 1);
      pumpReady();
      if (!t) return;
      if (e.data.refetch) { t.state = null; return; }            // the worker forgot it: fetch again
      if (e.data.error) { t.state = "built"; t.count = 0; return; }
      meshes(t, e.data);
    };
    for (let i = 0; i < POOL; i++) {
      const w = new Worker(new URL("../../../flight_sim/earth/game/lights-worker.js?v=4", import.meta.url), { type: "module" });
      w.onmessage = onmessage;
      workers.push(w);
    }
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
  tiles.clear(); fetchQueue.length = 0; readyQueue.length = 0; jobs.clear(); working = 0;
  group?.parent?.remove(group); group = null;
  prevShip = null; lastDir = null;
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

// The road tiles' index is fetched as soon as this module loads (pre-flight),
// so the first lamps do not wait on it after take-off.
if (typeof window !== "undefined" && typeof fetch === "function") {
  fetch(TILEJSON).then((r) => r.json()).then((tj) => { template = template || tj.tiles?.[0] || null; }).catch(() => {});
}

if (typeof window !== "undefined") {
  window.GeoIDFlightLights = { active: () => running, stats, startFlightLights, stopFlightLights, creditNow };
}
