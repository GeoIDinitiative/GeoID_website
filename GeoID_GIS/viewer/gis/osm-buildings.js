// 3D buildings on the GeoHUB globe, streamed by tile around the camera once it
// comes down over a city, with sun shadows on the ground and on each other.
//
// The machinery is Earth Flight's (flight_sim/earth/): the same keyless
// OpenFreeMap vector tiles (OpenStreetMap footprints and heights, z14), the
// same worker that decodes and extrudes them off the main thread, the same
// roof imagery and procedural facades. What is new here is only how they sit
// on a planet instead of a flat local frame.
//
// ── Altitude ────────────────────────────────────────────────────────────────
// Buildings stream in below SHOW_BELOW_M (6 km above the ground) and are all
// unloaded above HIDE_ABOVE_M (8 km): between the two nothing new is fetched
// but nothing loaded is thrown away, so hovering at the threshold does not
// churn. Shadows are cast below SHADOW_BELOW_M (4 km). From 6 km a 30 m tower
// is a few pixels; above that a building layer is cost with nothing to show.
//
// ── Placement ───────────────────────────────────────────────────────────────
// Each z14 tile (about 1.5 km across at London's latitude) is one mesh in a
// TANGENT PLANE at the tile's centre, built in metres and scaled to globe
// units by its matrix. Two reasons rather than baking globe coordinates into
// the vertices:
//   * precision -- one globe unit is 1,991 km, so a Float32 vertex at radius
//     3.2 is good to about 40 cm; a tile-local vertex is good to a millimetre,
//     and the camera-relative matrix three builds in double does the rest;
//   * the relief -- the globe's terrain exaggeration eases off as the camera
//     lands (see vector-render.js, "Following the relief"), so the ground
//     moves. Only the tile's anchor follows it, re-read from `surfacePoint`
//     every frame; the buildings ride on the anchor.
// The plane is off the sphere by d^2/2R at its corners -- 0.18 m at a
// kilometre -- inside the 4 m every wall is sunk below its footprint.
//
// ── Draw order ──────────────────────────────────────────────────────────────
// The imagery drapes refuse the depth test and draw in the transparent pass
// (streamed tiles at 40, the imported/basemap stack at 50+), so an opaque
// building would be drawn first and painted over. Buildings therefore join the
// transparent pass in a group sorted at 190 (see GROUP_ORDER), still
// depth-tested and depth-writing against the globe and each other.

import { isEarth } from "./bodies.js?v=20261024-a3a897b";
import { facade, roof } from "../../../flight_sim/earth/game/facade.js?v=1";

const BUILDINGS_TILEJSON = "https://tiles.openfreemap.org/planet";
const IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const SHOW_BELOW_M = 6000;
export const HIDE_ABOVE_M = 8000;
export const SHADOW_BELOW_M = 4000;
const Z = 14;
const ROOF_Z = 16;
const ROOF_Z_NEAR = 17;
const ROOF_NEAR_M = 900;
const RADIUS_M = 2500;        // tiles whose box is this close to the eye's ground point
const AHEAD_M = 1800;         // ...or to the point the view is centred on
const MAX_TILES = 16;
const FETCH_BUDGET = 3;       // vector tiles + worker jobs in flight
const IMAGE_BUDGET = 6;       // roof imagery requests in flight
const UNITS_PER_M = 3.2 / 6371000;
// Draw order. The buildings' group sorts at 190: after every ground layer --
// the streamed imagery (40) AND the imported/basemap stack (50+), which a
// group at 45 still lost to, because three compares groupOrder before
// renderOrder and the Sentinel-2 basemap is itself a layer in that stack,
// drawn without a depth test over everything sorted before it -- and before
// the viewer's pins and labels (199+). Buildings depth-test against the globe,
// so drawing them last among the ground is also what is physically right:
// they hide the ground drapes where they stand, and nowhere else.
const GROUP_ORDER = 190;
const ORDER_CATCHER = 1;
const ORDER_BUILDINGS = 2;
const STORAGE_KEY = "geoid-gis:osm-buildings";

let THREE = null;
let template = null;
let worker = null;
let jobSeq = 0;
const jobs = new Map();
const tiles = new Map();      // "x/y" -> tile record
let fetching = 0;
const fetchQueue = [];
let wallMat = null;
let sun = null;
let keyLight = null;
let enabled = true;
let shadowsWanted = true;
let lastDecision = 0;
export const stats = { tiles: 0, buildings: 0, verts: 0, altitude: null, active: false, shadows: false };

/* ── Pure helpers (tested) ───────────────────────────────────────────────── */

export function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileXToLon(x, z) { return (x / 2 ** z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Ground metres from a point to the nearest edge of a tile (0 inside it). */
export function tileDistanceM(lat, lon, x, y, z = Z) {
  const n = tileYToLat(y, z), s = tileYToLat(y + 1, z);
  const w = tileXToLon(x, z), e = tileXToLon(x + 1, z);
  const clat = Math.min(Math.max(lat, s), n), clon = Math.min(Math.max(lon, w), e);
  const dy = (lat - clat) * 111320;
  const dx = (lon - clon) * 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * Which tiles to hold, nearest first: everything within RADIUS_M of the
 * ground under the camera, plus a smaller ring round the point the view is
 * centred on when that is close enough to matter (an oblique view looks at
 * ground well ahead of where the camera stands). Capped at MAX_TILES.
 */
export function wantedTiles(eye, focus, { radius = RADIUS_M, ahead = AHEAD_M, max = MAX_TILES, z = Z } = {}) {
  const out = new Map();
  const consider = (c, r) => {
    const cx = Math.floor(lonToTileX(c.lon, z)), cy = Math.floor(latToTileY(c.lat, z));
    const span = 3;
    for (let y = cy - span; y <= cy + span; y++)
      for (let x = cx - span; x <= cx + span; x++) {
        const d = tileDistanceM(c.lat, c.lon, x, y, z);
        if (d > r) continue;
        const key = x + "/" + y;
        const prev = out.get(key);
        const score = tileDistanceM(eye.lat, eye.lon, x, y, z);
        if (!prev) out.set(key, { x, y, d: score });
      }
  };
  consider(eye, radius);
  if (focus) consider(focus, ahead);
  return [...out.values()].sort((a, b) => a.d - b.d).slice(0, max);
}

/* ── Frames ──────────────────────────────────────────────────────────────── */

/** A lat/lon direction in the GLOBE MESH's frame (the half turn applied). */
function globeDir(viewer, lat, lon) {
  const v = viewer.latLonToVector3(lat, lon, 1);
  return new THREE.Vector3(-v.x, v.y, -v.z).normalize();
}

/** The ground at a lat/lon, in the globe mesh's frame, at the relief drawn now. */
function groundPoint(viewer, lat, lon) {
  const p = viewer.surfacePoint(lat, lon, 0);
  return new THREE.Vector3(-p.x, p.y, -p.z);
}

/** Camera's ground point and view centre as lat/lon, in the globe's frame. */
function eyeAndFocus(viewer) {
  const globe = viewer.globe;
  globe.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(globe.matrixWorld).invert();
  const toLL = (world) => {
    const l = world.clone().applyMatrix4(inv);
    l.set(-l.x, l.y, -l.z);
    const r = l.length() || 1;
    return { lat: Math.asin(Math.max(-1, Math.min(1, l.y / r))) * 180 / Math.PI,
      lon: Math.atan2(l.z, -l.x) * 180 / Math.PI };
  };
  const eye = toLL(viewer.camera.position);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), viewer.camera);
  const hit = new THREE.Vector3();
  const focus = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 3.2), hit) ? toLL(hit) : null;
  return { eye, focus };
}

/**
 * Height of the camera above the ground AS DRAWN under it, in metres.
 *
 * Not `getZoomAltitudeMetres`: that measures from the bare 3.2 sphere, and
 * the globe's ground is displaced by the terrain exaggeration until it tapers
 * away close in. Measured while posing a still over London: 1.1 km above the
 * drawn ground read as 123 km, because the ground itself was drawn 122 km up
 * at that moment's exaggeration. The thresholds are about what is in front of
 * the camera, so they are measured against what is drawn there.
 */
function heightAboveGround(viewer, eye) {
  const g = groundPoint(viewer, eye.lat, eye.lon);
  viewer.globe.updateMatrixWorld(true);
  const local = viewer.globe.worldToLocal(viewer.camera.position.clone());
  return (local.length() - g.length()) / UNITS_PER_M;
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL("../../../flight_sim/earth/game/buildings-worker.js?v=1", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const job = jobs.get(e.data.id);
    if (!job) return;
    jobs.delete(e.data.id);
    job(e.data);
  };
}

function pump(viewer) {
  fetchQueue.sort((a, b) => a.d - b.d);
  while (fetching < FETCH_BUDGET && fetchQueue.length) {
    const t = fetchQueue.shift();
    if (t.dead) continue;
    fetching++;
    loadTile(viewer, t).finally(() => { fetching--; pump(viewer); });
  }
}

async function loadTile(viewer, t) {
  const url = template.replace("{z}", Z).replace("{x}", t.x).replace("{y}", t.y);
  let buf;
  try {
    const r = await fetch(url);
    buf = r.ok ? await r.arrayBuffer() : null;
  } catch (e) { buf = null; }
  if (t.dead || !buf) return;
  // The tile's own ground size: a Mercator tile is cos(lat) of its nominal
  // width, taken at the tile's middle latitude.
  const lat = (tileYToLat(t.y, Z) + tileYToLat(t.y + 1, Z)) / 2;
  const sizeM = (2 * Math.PI * 6378137 / 2 ** Z) * Math.cos(lat * Math.PI / 180);
  const id = ++jobSeq;
  // No DEM: the globe's ground is drawn at its own (tapered) relief, which is
  // the anchor's job below, so every building stands on the tile's plane.
  const res = await new Promise((resolve) => {
    jobs.set(id, resolve);
    worker.postMessage({ id, buf, dem: null, demSize: 256, sizeLocal: sizeM }, [buf]);
  });
  if (t.dead || res.error || res.empty) return;
  build(viewer, t, res.mesh, res.buildings, lat, sizeM);
}

const imageQueue = [];
let imagesActive = 0;
function loadImage(url, isDead) {
  return new Promise((resolve, reject) => {
    imageQueue.push({ url, isDead, resolve, reject });
    nextImage();
  });
}
function nextImage() {
  while (imagesActive < IMAGE_BUDGET && imageQueue.length) {
    const job = imageQueue.shift();
    if (job.isDead()) { job.reject(new Error("retired")); continue; }
    imagesActive++;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => { imagesActive--; job.resolve(img); nextImage(); };
    img.onerror = () => { imagesActive--; job.reject(new Error("failed")); nextImage(); };
    img.src = job.url;
  }
}

/**
 * The tile's Esri imagery as one canvas: roofs are UV-mapped into it, and the
 * same texture is laid on the ground under the tile (see `build`), so a city
 * seen from a few hundred metres is on real 0.7 m imagery rather than the
 * globe's default basemap -- Sentinel-2 at 10 m, which is soft from there.
 * z17 (8 x 8 tiles, 2048 px, ~0.7 m/px over London) for tiles within
 * ROOF_NEAR_M of the camera when requested, z16 (1024 px) further out. z18
 * would be 4096 px a tile -- 64 MB of texture each, 256 requests -- which the
 * budget cannot carry for sixteen tiles; Earth Flight streams z18 per chunk.
 * Starts transparent: unloaded parts show the globe's own ground, not grey.
 */
function roofTexture(t) {
  const zoom = t.d < ROOF_NEAR_M ? ROOF_Z_NEAR : ROOF_Z;
  const k = 1 << (zoom - Z);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256 * k;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  for (let j = 0; j < k; j++)
    for (let i = 0; i < k; i++) {
      const url = IMAGERY_URL.replace("{z}", zoom).replace("{x}", t.x * k + i).replace("{y}", t.y * k + j);
      loadImage(url, () => t.dead).then((img) => {
        if (t.dead) return;
        ctx.drawImage(img, i * 256, j * 256);
        tex.needsUpdate = true;
      }).catch(() => {});
    }
  return tex;
}

/* Darken by the sun's shadow mask on top of whatever the scene's own lights
   made of the surface. The shadow-casting light has zero intensity -- adding
   light to a globe that is already balanced would brighten every lit material
   in it -- so its shadow would otherwise darken nothing. */
function shadowed(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <shadowmap_pars_fragment>", "#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.rgb *= mix(0.55, 1.0, getShadowMask());");
  };
  return material;
}

function noPick(obj) {
  obj.raycast = () => {};
  obj.userData.nonInteractive = true;
  return obj;
}

function build(viewer, t, m, count, lat, sizeM) {
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3, true));
  geo.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(m.color, 3, true));
  geo.setAttribute("aStyle", new THREE.BufferAttribute(m.style, 1, true));
  geo.addGroup(0, m.roofCount, 0);
  geo.addGroup(m.roofCount, m.wallCount, 1);
  geo.computeBoundingSphere();

  t.roof = roofTexture(t);
  const roofMat = roof(shadowed(new THREE.MeshLambertMaterial({ map: t.roof, transparent: true })));
  const mesh = noPick(new THREE.Mesh(geo, [roofMat, wallMat]));
  mesh.name = "GeoID-OSMBuildings";
  mesh.renderOrder = ORDER_BUILDINGS;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;

  // The ground under the buildings, showing only where a shadow falls.
  const catcher = noPick(new THREE.Mesh(
    new THREE.PlaneGeometry(sizeM, sizeM).rotateX(-Math.PI / 2).translate(sizeM / 2, 0.4, sizeM / 2),
    new THREE.ShadowMaterial({ opacity: 0.38, transparent: true, depthWrite: false })));
  catcher.renderOrder = ORDER_CATCHER;

  // The same imagery, on the ground under the tile, in the streamed-imagery
  // band: after the globe's own refine patch (40), before anything imported
  // (50+), refusing the depth test like every other drape.
  const ground = noPick(new THREE.Mesh(
    new THREE.PlaneGeometry(sizeM, sizeM).rotateX(-Math.PI / 2).translate(sizeM / 2, 0, sizeM / 2),
    new THREE.MeshBasicMaterial({ map: t.roof, transparent: true, depthTest: false, depthWrite: false })));
  ground.matrixAutoUpdate = false;
  catcher.receiveShadow = true;
  catcher.matrixAutoUpdate = false;

  // Tangent frame at the tile centre, in the globe mesh's frame.
  const clat = lat, clon = (tileXToLon(t.x, Z) + tileXToLon(t.x + 1, Z)) / 2;
  const up = globeDir(viewer, clat, clon);
  const east = globeDir(viewer, clat, clon + 0.001).sub(up).normalize();
  const north = globeDir(viewer, clat + 0.001, clon).sub(up).normalize();
  const south = north.clone().negate();
  // Gram-Schmidt: east and south exactly perpendicular to up and each other.
  east.addScaledVector(up, -east.dot(up)).normalize();
  south.crossVectors(east, up).normalize();     // x east, y up -> z south (right-handed)
  t.frame = { clat, clon, up, east, south, half: sizeM / 2 };
  t.mesh = mesh; t.catcher = catcher; t.ground = ground;
  t.count = count; t.verts = m.position.length / 3;
  place(viewer, t);
  holder(viewer).add(mesh, catcher);
  groundHolder(viewer).add(ground);
  stats.tiles++; stats.buildings += count; stats.verts += t.verts;
}

let group = null;
/** The group every tile hangs in: on the globe mesh (so it carries the spin
 *  and the half turn), sorted as one block at GROUP_ORDER. */
function holder(viewer) {
  if (!group || group.parent !== viewer.globe) {
    group = new THREE.Group();
    group.name = "GeoID-OSMBuildingsGroup";
    group.renderOrder = GROUP_ORDER;
    viewer.globe.add(group);
  }
  return group;
}

let groundGroup = null;
const GROUND_ORDER = 41;
function groundHolder(viewer) {
  if (!groundGroup || groundGroup.parent !== viewer.globe) {
    groundGroup = new THREE.Group();
    groundGroup.name = "GeoID-OSMBuildingsGround";
    groundGroup.renderOrder = GROUND_ORDER;
    viewer.globe.add(groundGroup);
  }
  return groundGroup;
}

/** Seat a tile on the ground as drawn this frame. */
function place(viewer, t) {
  const f = t.frame;
  const centre = groundPoint(viewer, f.clat, f.clon);
  const s = UNITS_PER_M;
  const origin = centre.clone()
    .addScaledVector(f.east, -f.half * s)
    .addScaledVector(f.south, -f.half * s);
  const mat = new THREE.Matrix4().makeBasis(
    f.east.clone().multiplyScalar(s), f.up.clone().multiplyScalar(s), f.south.clone().multiplyScalar(s));
  mat.setPosition(origin);
  t.mesh.matrix.copy(mat); t.mesh.matrixWorldNeedsUpdate = true;
  t.catcher.matrix.copy(mat); t.catcher.matrixWorldNeedsUpdate = true;
  t.ground.matrix.copy(mat); t.ground.matrixWorldNeedsUpdate = true;
}

function drop(key) {
  const t = tiles.get(key);
  if (!t) return;
  t.dead = true;
  if (t.mesh) {
    t.mesh.parent?.remove(t.mesh);
    t.catcher.parent?.remove(t.catcher);
    t.ground.parent?.remove(t.ground);
    t.ground.geometry.dispose();
    t.ground.material.dispose();
    t.mesh.geometry.dispose();
    t.mesh.material[0].dispose();
    t.catcher.geometry.dispose();
    t.catcher.material.dispose();
    stats.tiles--; stats.buildings -= t.count; stats.verts -= t.verts;
  }
  t.roof?.dispose();
  tiles.delete(key);
}

function dropAll() { for (const k of [...tiles.keys()]) drop(k); }

/* ── Sun shadows ─────────────────────────────────────────────────────────── */

/** The viewer's sun-following key light: the brightest directional light that is not ours. */
function findKeyLight(scene) {
  let best = null;
  scene.traverse((o) => {
    if (o.isDirectionalLight && o !== sun && (!best || o.intensity > best.intensity)) best = o;
  });
  return best;
}

function updateShadows(viewer, altitude, eye) {
  const want = shadowsWanted && altitude < SHADOW_BELOW_M && stats.tiles > 0;
  if (!sun) {
    if (!want) return;
    sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.name = "GeoID-OSMBuildingsSun";
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0002;
    viewer.scene.add(sun, sun.target);
    // Turned on once and left on: every material's program carries the flag,
    // so toggling it recompiles the whole globe. Nothing else in the scene
    // casts, so with it on the only extra work is this light's one pass.
    viewer.renderer.shadowMap.enabled = true;
    viewer.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  if (!keyLight || !keyLight.parent) keyLight = findKeyLight(viewer.scene);
  const sunDir = keyLight ? keyLight.position.clone().normalize() : null;
  const centre = viewer.globe.localToWorld(groundPoint(viewer, eye.lat, eye.lon));
  const upWorld = centre.clone().normalize();
  const lit = sunDir && sunDir.dot(upWorld) > 0.03;     // sun above the local horizon
  sun.castShadow = Boolean(want && lit);
  stats.shadows = sun.castShadow;
  if (!sun.castShadow) return;
  const halfM = Math.min(3000, Math.max(700, altitude * 1.5 + 600));
  const half = halfM * UNITS_PER_M;
  const D = 6000 * UNITS_PER_M;
  sun.position.copy(centre).addScaledVector(sunDir, D);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = D - 2500 * UNITS_PER_M; cam.far = D + 2500 * UNITS_PER_M;
  cam.updateProjectionMatrix();
  sun.shadow.normalBias = (2 * half / 2048) * 1.5;
}

/* ── The loop ────────────────────────────────────────────────────────────── */

function frame(now) {
  requestAnimationFrame(frame);
  const viewer = window.GeoIDViewer;
  if (!viewer?.globe || !viewer.surfacePoint || !viewer.latLonToVector3) return;
  if (!THREE) return;
  const { eye, focus } = eyeAndFocus(viewer);
  const alt = heightAboveGround(viewer, eye);
  if (!Number.isFinite(alt)) return;
  stats.altitude = alt;
  stats.eye = { lat: +eye.lat.toFixed(5), lon: +eye.lon.toFixed(5) };

  if (!enabled || alt > HIDE_ABOVE_M) {
    if (tiles.size) dropAll();
    stats.active = false;
    if (sun) { sun.castShadow = false; stats.shadows = false; }
    return;
  }
  // Seat every built tile on this frame's ground (the relief moves with altitude).
  for (const t of tiles.values()) if (t.mesh) place(viewer, t);
  updateShadows(viewer, alt, eye);

  if (now - lastDecision < 300) return;
  lastDecision = now;
  stats.active = alt < SHOW_BELOW_M;
  if (!template || !stats.active) return;
  const want = wantedTiles(eye, focus && tileDistanceKm(eye, focus) < 8 ? focus : null);
  const keep = new Set();
  for (const w of want) {
    const key = w.x + "/" + w.y;
    keep.add(key);
    const have = tiles.get(key);
    if (have) { have.d = w.d; continue; }
    const t = { x: w.x, y: w.y, d: w.d, dead: false, mesh: null };
    tiles.set(key, t);
    fetchQueue.push(t);
  }
  // Let go of anything no longer wanted once it is well out of range.
  for (const [key, t] of tiles) {
    if (keep.has(key)) continue;
    if (tileDistanceM(eye.lat, eye.lon, t.x, t.y) > RADIUS_M + 1500 || tiles.size > MAX_TILES + 6) drop(key);
  }
  pump(viewer);
}

function tileDistanceKm(a, b) {
  const dy = (a.lat - b.lat) * 111.32;
  const dx = (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/* ── Public seam and boot ────────────────────────────────────────────────── */

export function setEnabled(on) {
  enabled = Boolean(on);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, shadows: shadowsWanted })); } catch (e) { /* private mode */ }
}
export function setShadows(on) {
  shadowsWanted = Boolean(on);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, shadows: shadowsWanted })); } catch (e) { /* private mode */ }
}

async function boot() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!isEarth()) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) { enabled = saved.enabled !== false; shadowsWanted = saved.shadows !== false; }
  } catch (e) { /* private mode */ }
  THREE = await import("../vendor/three.module.js");
  wallMat = shadowed(facade(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true })));
  ensureWorker();
  try {
    const tj = await (await fetch(BUILDINGS_TILEJSON)).json();
    template = tj.tiles?.[0] || null;
  } catch (e) {
    template = null;
    console.warn("osm-buildings: no building tiles (TileJSON failed)", e);
  }
  window.GeoIDBuildings = {
    stats, setEnabled, setShadows,
    isEnabled: () => enabled, shadowsOn: () => shadowsWanted,
    source: () => template,
    thresholds: { SHOW_BELOW_M, HIDE_ABOVE_M, SHADOW_BELOW_M },
    pending: () => fetching + fetchQueue.filter((t) => !t.dead).length + jobs.size + imagesActive + imageQueue.length,
  };
  document.dispatchEvent(new CustomEvent("geoid:buildings-ready"));
  requestAnimationFrame(frame);
}

boot();
