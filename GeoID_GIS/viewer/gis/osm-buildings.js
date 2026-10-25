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

import { isEarth } from "./bodies.js?v=20261025-03194db";
import { facade, roof } from "../../../flight_sim/earth/game/facade.js?v=3";
import { NIGHT } from "./night-lights.js?v=20261025-03194db";

const BUILDINGS_TILEJSON = "https://tiles.openfreemap.org/planet";
// blankTile=false: a tile with no imagery is a 404, not Esri's grey "Map data
// not yet available" picture (tile-sources.js); roofTexture then falls back
// to the parent tile.
const IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false";

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
// In flight the tiles follow the aircraft and the ground it is flying towards:
// a circle round it and a larger one ahead along the heading, further out the
// higher it flies, on a bigger budget. At the edge of that cover everything
// fades out over FADE_M (see edgeFaded) instead of ending in a wall.
const FLIGHT_RADIUS_M = 3000;
const FLIGHT_AHEAD_RADIUS_M = 4500;
const FLIGHT_MAX_TILES = 32;
const FADE_M = 800;
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
let treeGeo = null, treeMat = null;

/**
 * One tree, unit-sized, for instancing: a seven-sided crown on a short trunk,
 * coloured by vertex (trunk brown, crown green) and tinted per tree. Low-poly
 * on purpose -- a few thousand per tile, all in one draw.
 */
function treeAssets() {
  if (treeGeo) return;
  const crown = new THREE.ConeGeometry(1, 0.8, 7, 1).translate(0, 0.6, 0);
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.3, 5, 1).translate(0, 0.15, 0);
  const paint = (g, c) => {
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [paint(trunk, [0.36, 0.27, 0.19]), paint(crown, [0.24, 0.38, 0.20])];
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const arrays = parts.map((g) => g.attributes[name].array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0; for (const a of arrays) { out.set(a, o); o += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  treeGeo = merged;
  treeMat = shadowed(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true }));
}
/**
 * The canopy's two materials (flight_sim/earth/game/canopy.js builds the
 * shape). The top is the tile's own aerial imagery -- the photographed
 * forest, raised -- over a dark green where the imagery has not arrived yet,
 * so a loading canopy is a canopy and not a hole. The walls are a foliage
 * texture drawn once here: dark, mottled crowns with lighter flecks and a
 * shadowed foot, repeating every 8 m (the wall UVs are in eighths of a metre).
 */
let foliageTex = null;
function foliageTexture() {
  if (foliageTex) return foliageTex;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "#1f3317";
  g.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Crowns: overlapping blobs in a few greens, lighter towards the top.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * N, y = rnd() * N, r = 4 + rnd() * 14;
    const lift = 1 - y / N;
    const l = 14 + lift * 16 + rnd() * 10;
    g.fillStyle = `hsl(${88 + rnd() * 30}, ${32 + rnd() * 18}%, ${l}%)`;
    for (const dx of [-N, 0, N]) { g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill(); }
  }
  // Sunlit flecks.
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(150, 190, 90, ${0.15 + rnd() * 0.25})`;
    g.fillRect(rnd() * N, rnd() * N * 0.7, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // The foot of the wall is in the wood's own shadow.
  const foot = g.createLinearGradient(0, N, 0, N * 0.55);
  foot.addColorStop(0, "rgba(5, 10, 4, 0.75)");
  foot.addColorStop(1, "rgba(5, 10, 4, 0)");
  g.fillStyle = foot;
  g.fillRect(0, 0, N, N);
  foliageTex = new THREE.CanvasTexture(c);
  foliageTex.colorSpace = THREE.SRGBColorSpace;
  foliageTex.wrapS = THREE.RepeatWrapping;
  foliageTex.wrapT = THREE.RepeatWrapping;   // flipY (default) puts v = 0, the foot, at the canvas bottom
  foliageTex.anisotropy = 8;
  return foliageTex;
}
let canopySideMat = null;
function canopyMaterials(imagery) {
  if (!canopySideMat) {
    // v runs 0 at the foot to 1 a canvas-height (8 m) up; taller walls
    // repeat the crown band rather than stretching it.
    canopySideMat = edgeFaded(shadowed(new THREE.MeshLambertMaterial({ map: foliageTexture() })), "dither");
  }
  const top = shadowed(new THREE.MeshLambertMaterial({ map: imagery }));
  const prev = top.onBeforeCompile;
  top.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec4 canopyTexel = texture2D( map, vMapUv );
        diffuseColor.rgb *= mix( vec3( 0.13, 0.21, 0.10 ), canopyTexel.rgb, canopyTexel.a );
      #endif`);
  };
  const key = top.customProgramCacheKey.bind(top);
  top.customProgramCacheKey = () => key() + "|canopy";
  return [edgeFaded(top, "dither"), canopySideMat];
}

let sun = null;
let keyLight = null;
let enabled = true;
let shadowsWanted = true;
let lastDecision = 0;
export const stats = { tiles: 0, buildings: 0, trees: 0, woods: 0, verts: 0, altitude: null, active: false, shadows: false };

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
  worker = new Worker(new URL("../../../flight_sim/earth/game/buildings-worker.js?v=6", import.meta.url), { type: "module" });
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

const DEM_N = 65;
async function tileDem(t) {
  const T = window.GeoIDFlightTerrain;
  if (!T?.active?.()) return { dem: null, demSize: 256 };
  try {
    await window.GeoIDDem?.ensure?.({
      north: tileYToLat(t.y, Z), south: tileYToLat(t.y + 1, Z), west: tileXToLon(t.x, Z), east: tileXToLon(t.x + 1, Z),
    }, { maxTiles: 4 });
  } catch (e) { /* flat where the DEM cannot be had */ }
  const vex = T.getVex();
  const dem = new Float32Array(DEM_N * DEM_N);
  for (let j = 0; j < DEM_N; j++) {
    const lat = tileYToLat(t.y + (j + 0.5) / DEM_N, Z);
    for (let i = 0; i < DEM_N; i++) {
      const lon = tileXToLon(t.x + (i + 0.5) / DEM_N, Z);
      dem[j * DEM_N + i] = (T.groundMetres(lat, lon) ?? 0) * vex;
    }
  }
  t.dem = dem;
  return { dem, demSize: DEM_N };
}
/** The tile's ground height at tile-local metres (x east, z south), as extrude.js samples it. */
function demAt(t, sizeM, x, z) {
  const dem = t.dem;
  if (!dem) return 0;
  const fx = Math.min(Math.max(x / sizeM * DEM_N - 0.5, 0), DEM_N - 1);
  const fy = Math.min(Math.max(z / sizeM * DEM_N - 0.5, 0), DEM_N - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, DEM_N - 1), y1 = Math.min(y0 + 1, DEM_N - 1);
  const tx = fx - x0, ty = fy - y0;
  return (dem[y0 * DEM_N + x0] * (1 - tx) + dem[y0 * DEM_N + x1] * tx) * (1 - ty)
    + (dem[y1 * DEM_N + x0] * (1 - tx) + dem[y1 * DEM_N + x1] * tx) * ty;
}
/** A ground plane for the tile, lifted to its height grid when it has one. */
function groundPlane(t, sizeM, y) {
  const seg = t.dem ? 32 : 1;
  const g = new THREE.PlaneGeometry(sizeM, sizeM, seg, seg).rotateX(-Math.PI / 2).translate(sizeM / 2, y, sizeM / 2);
  if (t.dem) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + demAt(t, sizeM, p.getX(i), p.getZ(i)));
    p.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
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
  // In Earth Flight the ground is the flight terrain (flight-terrain.js): the
  // tile carries a height grid, metres x the Vertical scale with the sea at
  // zero, sampled at cell centres, so every building and wood stands on its
  // own ground (extrude.js `ground(u, v)`). Otherwise no DEM: the globe's
  // ground is drawn at its own (tapered) relief, which is the anchor's job
  // below, and every building stands on the tile's plane.
  const { dem, demSize } = await tileDem(t);
  if (t.dead) return;
  const res = await new Promise((resolve) => {
    jobs.set(id, resolve);
    worker.postMessage({ id, buf, dem, demSize, sizeLocal: sizeM, origin: [t.x, t.y] }, [buf]);
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
      // Missing at this zoom: the same ground cut from the parent tile, up to
      // four levels coarser, so the roofs and ground keep the best imagery
      // that exists instead of going bare.
      const draw = (z, up) => {
        const s = 1 << up, x = (t.x * k + i), y = (t.y * k + j);
        const px = x >> up, py = y >> up;
        const url = IMAGERY_URL.replace("{z}", z).replace("{x}", px).replace("{y}", py);
        loadImage(url, () => t.dead).then((img) => {
          if (t.dead) return;
          const sub = 256 / s;
          ctx.drawImage(img, (x - px * s) * sub, (y - py * s) * sub, sub, sub, i * 256, j * 256, 256, 256);
          tex.needsUpdate = true;
        }).catch(() => { if (!t.dead && up < 4) draw(z - 1, up + 1); });
      };
      draw(zoom, 0);
    }
  return tex;
}

/* Darken by the sun's shadow mask on top of whatever the scene's own lights
   made of the surface. The shadow-casting light has zero intensity -- adding
   light to a globe that is already balanced would brighten every lit material
   in it -- so its shadow would otherwise darken nothing. */
function shadowed(material) {
  const prev = material.onBeforeCompile;
  material.userData.night = NIGHT;
  material.onBeforeCompile = (shader) => {
    prev(shader);
    // Night (night-lights.js): the scene's ambient keeps lit materials bright
    // at midnight, so the buildings are dimmed to a fifth with the ground.
    if (!shader.fragmentShader.includes("uniform float uNight;")) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;");
    }
    shader.uniforms.uNight = NIGHT;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <shadowmap_pars_fragment>", "#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.rgb *= mix(0.55, 1.0, getShadowMask()) * mix(1.0, 0.2, uNight);");
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : "") + "|night";
  return material;
}

/* ── Fading out at the edge of the cover (flight) ──────────────────────────
   The buildings, woods and their sharp ground stop where the streamed tiles
   stop, and in flight that edge was a wall a couple of kilometres ahead, with
   0.7 m imagery against the 10 m basemap beyond (reported: "too big of an
   immediate discontinuity"). Every one of their materials fades out over the
   last FADE_M of the cover: solids by a screen-door dither (they stay depth
   tested and opaque), the ground drape by alpha. The cover is the union of two
   circles -- round the aircraft and round the point ahead -- passed in world
   space each frame; off in orbit (uFadeOn 0). */
const FADE = {
  uFadeOn: { value: 0 },
  uFadeA: { value: null },      // world centre of the aircraft circle
  uFadeB: { value: null },      // world centre of the circle ahead
  uFadeR: { value: null },      // (rA, rB, fade) in world units
};
function edgeFaded(material, mode) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, FADE);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vFadeW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    const body = mode === "dither"
      ? "if (edgeFade < 0.999 && edgeFade < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;"
      : "gl_FragColor.a *= edgeFade;";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeW;\nuniform float uFadeOn;\nuniform vec3 uFadeA;\nuniform vec3 uFadeB;\nuniform vec3 uFadeR;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
  {
    float edgeFade = 1.0;
    if (uFadeOn > 0.5) {
      float a = 1.0 - smoothstep(uFadeR.x - uFadeR.z, uFadeR.x, distance(vFadeW, uFadeA));
      float b = 1.0 - smoothstep(uFadeR.y - uFadeR.z, uFadeR.y, distance(vFadeW, uFadeB));
      edgeFade = max(a, b);
    }
    ${body}
  }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : "") + "|edge-" + mode;
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
  const roofMat = edgeFaded(roof(shadowed(new THREE.MeshLambertMaterial({ map: t.roof, transparent: true }))), "dither");
  const mesh = noPick(new THREE.Mesh(geo, [roofMat, wallMat]));
  mesh.name = "GeoID-OSMBuildings";
  mesh.renderOrder = ORDER_BUILDINGS;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;

  // The ground under the buildings, showing only where a shadow falls.
  const onTerrain = Boolean(t.dem);
  const catcher = noPick(new THREE.Mesh(
    groundPlane(t, sizeM, 0.4),
    new THREE.ShadowMaterial({ opacity: 0.38, transparent: true, depthWrite: false })));
  catcher.renderOrder = ORDER_CATCHER;

  // The same imagery, on the ground under the tile, in the streamed-imagery
  // band: after the globe's own refine patch (40), before anything imported
  // (50+), refusing the depth test like every other drape.
  // On the flight terrain the drape is real ground too: lifted to the tile's
  // heights and depth-tested, just over the terrain patches under it.
  // Flying, the ground IS the flight quadtree (flight-tiles.js: one surface,
  // with the vegetation rising out of it), so this drape is not drawn.
  const flying = Boolean(window.__flightSim?.active);
  const groundMat = edgeFaded(new THREE.MeshBasicMaterial({
    map: t.roof, transparent: true, depthTest: onTerrain, depthWrite: false,
    polygonOffset: onTerrain, polygonOffsetFactor: -1, polygonOffsetUnits: -24,
  }), "alpha");
  const ground = noPick(new THREE.Mesh(groundPlane(t, sizeM, 0), groundMat));
  ground.visible = !flying;
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
  // Trees scattered in the tile's woods and parks (structures.js), one draw.
  let trees = null;
  const T = m.trees;
  if (T && T.length) {
    treeAssets();
    const count = T.length / 5;
    trees = noPick(new THREE.InstancedMesh(treeGeo, treeMat, count));
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = i * 5, r = T[k + 4], h = T[k + 3];
      p.set(T[k], T[k + 1] - 0.5, T[k + 2]);
      sc.set(r, h, r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.39996) % (Math.PI * 2));
      trees.setMatrixAt(i, mat.compose(p, q, sc));
      const v = 0.75 + 0.5 * ((i * 0.618034) % 1);
      trees.setColorAt(i, tint.setRGB(v * 0.95, v, v * 0.9));
    }
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    trees.computeBoundingSphere();
    trees.renderOrder = ORDER_BUILDINGS;
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.matrixAutoUpdate = false;
    stats.trees = (stats.trees || 0) + count;
  }
  // Woods and scrub as a raised canopy: imagery on top, foliage on the walls.
  let canopy = null;
  const C = m.canopy;
  if (C && C.index && C.index.length) {
    const cg = new THREE.BufferGeometry();
    cg.setIndex(new THREE.BufferAttribute(C.index, 1));
    cg.setAttribute("position", new THREE.BufferAttribute(C.position, 3));
    cg.setAttribute("normal", new THREE.BufferAttribute(C.normal, 3));
    cg.setAttribute("uv", new THREE.BufferAttribute(C.uv, 2));
    cg.addGroup(0, C.topCount, 0);
    cg.addGroup(C.topCount, C.index.length - C.topCount, 1);
    cg.computeBoundingSphere();
    canopy = noPick(new THREE.Mesh(cg, canopyMaterials(t.roof)));
    canopy.name = "GeoID-OSMCanopy";
    canopy.renderOrder = ORDER_BUILDINGS;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    canopy.matrixAutoUpdate = false;
    t.canopyWoods = C.polygons;
    stats.woods += C.polygons;
  }
  t.mesh = mesh; t.catcher = catcher; t.ground = ground; t.trees = trees; t.canopy = canopy;
  t.count = count; t.verts = m.position.length / 3;
  place(viewer, t);
  holder(viewer).add(keep(mesh), keep(catcher));
  if (trees) holder(viewer).add(keep(trees));
  if (canopy) holder(viewer).add(keep(canopy));
  groundHolder(viewer).add(keep(ground));
  stats.tiles++; stats.buildings += count; stats.verts += t.verts;
}

/* ── Credit, not a Workspace layer ────────────────────────────────────────
   The buildings, trees, bridges and their ground imagery are part of Earth
   Flight itself, on by default and switched from its own panel ("3D
   buildings"), so they are NOT a Workspace row (owner, 2026-10-24). Their
   provenance still reaches the Metadata window: it reads `creditNow()` from
   GeoIDBuildings while there is anything drawn -- OpenStreetMap under the ODbL
   through OpenFreeMap, and Esri World Imagery for the roofs and the ground.
   Every node keeps its own draw order (`keepRenderOrder`): the ground drape is
   imagery (41) and the buildings are depth-tested solids drawn after every
   ground layer (190). */
const LAYER_NAME = "3D buildings & trees (OpenStreetMap)";
const LAYER_INFO = {
  source: "OpenStreetMap via OpenFreeMap vector tiles (OpenMapTiles schema, z14): building, transportation, water, landcover; roof imagery Esri World Imagery z16-z17",
  citation: "Buildings, bridges, trees: © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright); tiles: OpenFreeMap (openfreemap.org), OpenMapTiles schema © OpenMapTiles. Imagery: Esri World Imagery — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Facades and pitched roofs are procedural.",
  crs: "EPSG:3857 tiles, drawn on the globe",
  licence: "ODbL 1.0 (OpenStreetMap data); Esri terms of use (imagery)",
};
let layerRoot = null;
function keep(obj) { obj.traverse((n) => { n.userData.keepRenderOrder = true; }); return obj; }
function root(viewer) {
  if (!layerRoot || layerRoot.parent !== viewer.globe) {
    layerRoot = new THREE.Group();
    layerRoot.name = "GeoID-OSMBuildingsLayer";
    layerRoot.userData.keepRenderOrder = true;
    viewer.globe.add(layerRoot);
  }
  return layerRoot;
}

let group = null;
/** The group every tile hangs in: on the globe mesh (so it carries the spin
 *  and the half turn), sorted as one block at GROUP_ORDER. */
function holder(viewer) {
  if (!group || group.parent !== root(viewer)) {
    group = new THREE.Group();
    group.name = "GeoID-OSMBuildingsGroup";
    group.renderOrder = GROUP_ORDER;
    group.userData.keepRenderOrder = true;
    root(viewer).add(group);
  }
  return group;
}

let groundGroup = null;
const GROUND_ORDER = 41;
function groundHolder(viewer) {
  if (!groundGroup || groundGroup.parent !== root(viewer)) {
    groundGroup = new THREE.Group();
    groundGroup.name = "GeoID-OSMBuildingsGround";
    groundGroup.renderOrder = GROUND_ORDER;
    groundGroup.userData.keepRenderOrder = true;
    root(viewer).add(groundGroup);
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
  if (t.trees) { t.trees.matrix.copy(mat); t.trees.matrixWorldNeedsUpdate = true; }
  if (t.canopy) { t.canopy.matrix.copy(mat); t.canopy.matrixWorldNeedsUpdate = true; }
}

function drop(key) {
  const t = tiles.get(key);
  if (!t) return;
  t.dead = true;
  if (t.mesh) {
    t.mesh.parent?.remove(t.mesh);
    t.catcher.parent?.remove(t.catcher);
    t.ground.parent?.remove(t.ground);
    if (t.trees) { t.trees.parent?.remove(t.trees); t.trees.dispose(); stats.trees -= t.trees.count; }
    if (t.canopy) {
      t.canopy.parent?.remove(t.canopy);
      t.canopy.geometry.dispose();
      t.canopy.material[0].dispose();   // the top is per tile; the wall material is shared
      stats.woods -= t.canopyWoods || 0;
    }
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

/** In flight: the aircraft's ground point and the point ahead of it. */
function flightCover(viewer, altM) {
  const f = window.__flightSim;
  const ship = f?.active ? f.shipLatLon : null;
  if (!ship || !Number.isFinite(ship.lat)) return null;
  const aheadM = Math.max(3000, Math.min(9000, 3000 + 3 * (Number(altM) || 0)));
  const h = (Number(f.headingDeg) || 0) * Math.PI / 180;
  const cosLat = Math.max(0.05, Math.cos(ship.lat * Math.PI / 180));
  const ahead = { lat: ship.lat + (aheadM * Math.cos(h)) / 111320, lon: ship.lon + (aheadM * Math.sin(h)) / (111320 * cosLat) };
  return { eye: { lat: ship.lat, lon: ship.lon }, ahead };
}
function updateFade(viewer, cover) {
  FADE.uFadeOn.value = cover ? 1 : 0;
  if (!cover) return;
  if (!FADE.uFadeA.value) { FADE.uFadeA.value = new THREE.Vector3(); FADE.uFadeB.value = new THREE.Vector3(); FADE.uFadeR.value = new THREE.Vector3(); }
  FADE.uFadeA.value.copy(viewer.globe.localToWorld(groundPoint(viewer, cover.eye.lat, cover.eye.lon)));
  FADE.uFadeB.value.copy(viewer.globe.localToWorld(groundPoint(viewer, cover.ahead.lat, cover.ahead.lon)));
  // The cover reaches a tile's FAR corner, so the fade sits just inside the
  // radius the tiles were chosen by.
  FADE.uFadeR.value.set(FLIGHT_RADIUS_M * UNITS_PER_M, FLIGHT_AHEAD_RADIUS_M * UNITS_PER_M, FADE_M * UNITS_PER_M);
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
  updateFade(viewer, flightCover(viewer, alt));

  if (now - lastDecision < 300) return;
  lastDecision = now;
  stats.active = alt < SHOW_BELOW_M;
  if (!template || !stats.active) return;
  // In flight: round the aircraft and round the ground ahead of it, not round
  // the chase camera's ground point behind it.
  const flight = flightCover(viewer, alt);
  const want = flight
    ? wantedTiles(flight.eye, flight.ahead, { radius: FLIGHT_RADIUS_M, ahead: FLIGHT_AHEAD_RADIUS_M, max: FLIGHT_MAX_TILES })
    : wantedTiles(eye, focus && tileDistanceKm(eye, focus) < 8 ? focus : null);
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
    const far = flight
      ? tileDistanceM(flight.eye.lat, flight.eye.lon, t.x, t.y) > FLIGHT_RADIUS_M + 1500
        && tileDistanceM(flight.ahead.lat, flight.ahead.lon, t.x, t.y) > FLIGHT_AHEAD_RADIUS_M + 1500
      : tileDistanceM(eye.lat, eye.lon, t.x, t.y) > RADIUS_M + 1500;
    if (far || tiles.size > (flight ? FLIGHT_MAX_TILES : MAX_TILES) + 6) drop(key);
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
  wallMat = edgeFaded(shadowed(facade(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true }))), "dither");
  ensureWorker();
  try {
    const tj = await (await fetch(BUILDINGS_TILEJSON)).json();
    template = tj.tiles?.[0] || null;
  } catch (e) {
    template = null;
    console.warn("osm-buildings: no building tiles (TileJSON failed)", e);
  }
  // Rebuild every tile when the flight terrain's scale changes or it comes on
  // or off -- not on every new DEM tile, which would thrash.
  let terrainKey = "orbit:flat";
  const terrainCheck = () => {
    const T = window.GeoIDFlightTerrain;
    // Flight itself is part of the key: the ground drape carries the
    // vegetation relief only in flight.
    const key = `${window.__flightSim?.active ? "flight" : "orbit"}:${T?.active?.() ? T.getVex() : "flat"}`;
    if (key !== terrainKey) { terrainKey = key; dropAll(); }
  };
  window.addEventListener("geoid:flight-terrain-changed", terrainCheck);
  window.addEventListener("flightsim:disengaged", () => setTimeout(terrainCheck, 100));
  setInterval(terrainCheck, 1000);
  window.GeoIDBuildings = {
    stats, setEnabled, setShadows,
    // For the Metadata window, while anything is drawn.
    creditNow: () => (enabled && stats.tiles > 0 ? { title: LAYER_NAME, ...LAYER_INFO } : null),
    isEnabled: () => enabled, shadowsOn: () => shadowsWanted,
    source: () => template,
    thresholds: { SHOW_BELOW_M, HIDE_ABOVE_M, SHADOW_BELOW_M },
    pending: () => fetching + fetchQueue.filter((t) => !t.dead).length + jobs.size + imagesActive + imageQueue.length,
  };
  document.dispatchEvent(new CustomEvent("geoid:buildings-ready"));
  requestAnimationFrame(frame);
}

boot();
