// Earth Flight's ground: a quadtree of imagery tiles on the terrain.
//
// The imagery under an aircraft was three large canvases re-centred on it
// ("bands"), plus the 3D buildings' own ground drape. Every re-centre rebuilt a
// whole canvas and refilled it tile by tile, the three surfaces overlapped and
// were lifted to the terrain on different grids, and everything sat in globe
// coordinates where 32-bit floats wobble by half a metre at the ground --
// reported: "unstable", "patchy and not 100% nor immediate".
//
// This is the standard answer (Cesium, Google Earth):
//
//   * ONE surface. Every map tile is its own small terrain mesh, chosen by a
//     quadtree that splits by distance -- z17 (~1.2 m/px) under the aircraft
//     down to coarse tiles at the horizon. Leaves never overlap, so nothing
//     fights in depth; skirts hide the cracks between levels.
//   * PERSISTENT. A tile is built once and kept while it is wanted; flying on
//     adds tiles at the front, nothing already on screen is rebuilt.
//   * IMMEDIATE. A tile whose image has not arrived shows its nearest loaded
//     ancestor's image, cropped to it, so the ground is always fully covered
//     and sharpens in place.
//   * STABLE. Each tile is placed at its own centre and its vertices are
//     relative to it, so the GPU never adds big and small numbers.
//   * ON THE TERRAIN (flight-terrain.js), re-lifted as heights stream in, with
//     the vegetation rising out of the close tiles' own imagery.
//
// Esri World Imagery (blankTile=false: a missing tile is a 404 and the
// ancestor stays). Flight only.

const URL_TEMPLATE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false";
const ROOT_Z = 7;
export const MAX_Z = 17;
export const SPLIT = 2.4;            // split while closer than SPLIT x the tile's size
export const MAX_LEAVES = 800;
const MAX_TILES_KEPT = 1500;
const FETCH_BUDGET = 12;
const UNITS_PER_M = 3.2 / 6371000;
const EARTH_CIRC_M = 40075016.686;
const VEG_FROM_Z = 15;
const VEG_HEIGHT_M = 7;
const WORK_MS = 8;

/* ── Pure tile maths and selection (tested) ─────────────────────────────── */

export const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
};
export const tileXToLon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tileYToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
};
/** A tile's ground width in metres at its middle latitude. */
export function tileSizeM(z, y) {
  const lat = tileYToLat(y + 0.5, z);
  return EARTH_CIRC_M * Math.cos(lat * Math.PI / 180) / 2 ** z;
}
/** Ground distance in metres from a point to a tile's nearest edge (0 inside). */
export function distToTileM(lat, lon, z, x, y) {
  const n = tileYToLat(y, z), s = tileYToLat(y + 1, z), w = tileXToLon(x, z), e = tileXToLon(x + 1, z);
  const cl = Math.max(s, Math.min(n, lat));
  let dLon = 0;
  if (lon < w) dLon = w - lon; else if (lon > e) dLon = lon - e;
  const dy = (lat - cl) * 111320, dx = dLon * 111320 * Math.cos(lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/**
 * The leaves to draw: start from the ROOT_Z tiles round the aircraft within
 * `reachM`, and split a tile while the eye (at `altM` over `eye`) is closer
 * than SPLIT x its size, down to MAX_Z. Nearest first; at most MAX_LEAVES.
 */
export function selectLeaves(eye, altM, reachM, { maxZ = MAX_Z, split = SPLIT, maxLeaves = MAX_LEAVES } = {}) {
  const leaves = [];
  const z0 = ROOT_Z;
  const cx = Math.floor(lonToTileX(eye.lon, z0)), cy = Math.floor(latToTileY(eye.lat, z0));
  const span = Math.ceil(reachM / tileSizeM(z0, cy)) + 1;
  const n0 = 2 ** z0;
  const visit = (z, x, y) => {
    const ground = distToTileM(eye.lat, eye.lon, z, x, y);
    if (ground > reachM) return;
    const d = Math.hypot(ground, altM);
    if (z < maxZ && d < split * tileSizeM(z, y)) {
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) visit(z + 1, x * 2 + i, y * 2 + j);
    } else {
      leaves.push({ z, x, y, d });
    }
  };
  for (let y = cy - span; y <= cy + span; y++) {
    if (y < 0 || y >= n0) continue;
    for (let x = cx - span; x <= cx + span; x++) visit(z0, ((x % n0) + n0) % n0, y);
  }
  leaves.sort((a, b) => a.d - b.d);
  return leaves.slice(0, maxLeaves);
}

/** UV crop of an ancestor's image for a tile: [offsetU, offsetV, scale]. */
export function ancestorCrop(z, x, y, za, xa, ya) {
  const k = 2 ** (z - za);
  return [(x - xa * k) / k, 1 - (y - ya * k + 1) / k, 1 / k];
}

/* ── Rendering (browser) ────────────────────────────────────────────────── */

let THREE = null;
let group = null;
let timer = null;
const tiles = new Map();           // "z/x/y" -> { z, x, y, mesh, image: Texture|"missing"|null, loading, used }
const queue = [];
let inflight = 0;
const SUN = { value: null };

const key = (z, x, y) => `${z}/${x}/${y}`;

function localPoint(viewer, lat, lon) {
  const p = viewer.surfacePoint(lat, lon, 0);
  const v = new THREE.Vector3(-p.x, p.y, -p.z);
  const h = window.GeoIDFlightTerrain?.heightUnits?.(lat, lon) || 0;
  if (h) v.setLength(v.length() + h);
  return v;
}

const fullGrid = (z) => (z >= 15 ? 32 : z >= 11 ? 20 : 12);
const FIRST_GRID = 6;

/** A few heights across the tile: has the terrain under it actually changed? */
function heightSignature(t) {
  const T = window.GeoIDFlightTerrain;
  let sig = "";
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
    sig += ((T?.heightUnits?.(tileYToLat(t.y + j / 4, t.z), tileXToLon(t.x + i / 4, t.z)) || 0) / UNITS_PER_M).toFixed(1) + ",";
  }
  return sig;
}

/**
 * The tile's grid of N x N cells on the terrain, relative to its centre, with
 * skirts. A new tile goes up at once on a coarse grid (coverage first) and is
 * refined to its full grid as the work budget allows.
 */
function liftGeometry(viewer, t, N) {
  let geo = t.mesh?.geometry;
  if (!geo || t.N !== N) {
    geo?.dispose();
    geo = new THREE.BufferGeometry();
    if (t.mesh) t.mesh.geometry = geo;
  }
  t.N = N;
  t.sig = heightSignature(t);
  const verts = (N + 1) * (N + 1);
  const pos = geo.attributes.position ? geo.attributes.position.array : new Float32Array(verts * 2 * 3);
  const centre = localPoint(viewer, tileYToLat(t.y + 0.5, t.z), tileXToLon(t.x + 0.5, t.z));
  const skirt = Math.max(30, tileSizeM(t.z, t.y) * 0.03) * UNITS_PER_M;
  const v = new THREE.Vector3();
  for (let j = 0; j <= N; j++) {
    const lat = tileYToLat(t.y + j / N, t.z);
    for (let i = 0; i <= N; i++) {
      const lon = tileXToLon(t.x + i / N, t.z);
      v.copy(localPoint(viewer, lat, lon));
      const k = j * (N + 1) + i;
      pos[k * 3] = v.x - centre.x; pos[k * 3 + 1] = v.y - centre.y; pos[k * 3 + 2] = v.z - centre.z;
      v.setLength(v.length() - skirt);                     // the skirt vertex, below
      const s = verts + k;
      pos[s * 3] = v.x - centre.x; pos[s * 3 + 1] = v.y - centre.y; pos[s * 3 + 2] = v.z - centre.z;
    }
  }
  if (!geo.attributes.position) {
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const uv = new Float32Array(verts * 2 * 2);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N;
      uv[(verts + k) * 2] = i / N; uv[(verts + k) * 2 + 1] = 1 - j / N;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // Skirts down from every edge.
    const edge = (k0, k1) => { idx.push(k0, k1, verts + k0, k1, verts + k1, verts + k0); };
    for (let i = 0; i < N; i++) {
      edge(i, i + 1);                                          // north
      edge(N * (N + 1) + i + 1, N * (N + 1) + i);              // south
      edge((i + 1) * (N + 1), i * (N + 1));                    // west
      edge(i * (N + 1) + N, (i + 1) * (N + 1) + N);            // east
    }
    geo.setIndex(idx);
  } else {
    geo.attributes.position.needsUpdate = true;
  }
  geo.computeBoundingSphere();
  t.centre = centre;
  if (t.mesh) t.mesh.position.copy(centre);
}

function material(t) {
  // `transparent` (at full opacity) only to be drawn in the transparent pass:
  // the globe's horizon patch is a transparent, depth-ignoring drape at order
  // 40, and an opaque tile would be drawn BEFORE it and painted over.
  const m = new THREE.MeshBasicMaterial({
    map: null, side: THREE.DoubleSide, transparent: true, depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8,
  });
  if (t.z >= VEG_FROM_Z) vegetation(m, t);
  return m;
}

/**
 * The vegetation rises out of the tile's own imagery: blurred to ~25 m, a
 * mask of dark, green-dominant pixels (tree crowns; grass, water and shadow
 * stay flat) lifts each vertex up to VEG_HEIGHT_M along the local vertical,
 * shaded against the sun RELATIVE to flat ground so open ground keeps its
 * exact colour.
 */
function vegetation(m, t) {
  const mPerPx = tileSizeM(t.z, t.y) / 256;
  t.vegUniforms = {
    uVegLod: { value: Math.max(0, Math.log2(25 / mPerPx)) },
    uVegH: { value: VEG_HEIGHT_M * UNITS_PER_M },
    uVegSlope: { value: VEG_HEIGHT_M / tileSizeM(t.z, t.y) },
    uUp: { value: new THREE.Vector3() },
    uSunLocal: { value: new THREE.Vector3(0, 0, 1) },     // (east, north, up)
    uOwn: { value: 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, t.vegUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform sampler2D map;
uniform float uVegLod, uVegH, uVegSlope, uOwn;
uniform vec3 uUp, uSunLocal;
varying float vVegShade;
float vegAt(vec2 st) {
  vec3 c = sqrt(max(textureLod(map, st, uVegLod).rgb, 0.0));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return smoothstep(0.50, 0.22, lum) * smoothstep(-0.01, 0.08, c.g - c.b) * smoothstep(-0.04, 0.03, c.g - c.r);
}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  vVegShade = 1.0;
#ifdef USE_MAP
  if (uOwn > 0.5) {
    vec2 st = (mapTransform * vec3(uv, 1.0)).xy;
    float h0 = vegAt(st);
    transformed += uUp * (h0 * uVegH);
    float e = 1.0 / 32.0;
    float dx = (vegAt(st + vec2(e, 0.0)) - vegAt(st - vec2(e, 0.0))) * uVegSlope / (2.0 * e);
    float dy = (vegAt(st + vec2(0.0, e)) - vegAt(st - vec2(0.0, e))) * uVegSlope / (2.0 * e);
    vec3 n = normalize(vec3(-dx, -dy, 1.0));
    vVegShade = clamp(1.0 + 1.6 * (dot(n, uSunLocal) - uSunLocal.z) * step(0.0, uSunLocal.z), 0.72, 1.22) * (1.0 - 0.1 * h0);
  }
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vVegShade;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n  diffuseColor.rgb *= vVegShade;");
  };
  m.customProgramCacheKey = () => "geoid-flight-tile-veg";
}

/**
 * The best image this tile can show now: its own, or the nearest loaded
 * ancestor's, cropped to it. The crop is a clone sharing the ancestor's
 * image (one GPU upload) and is kept until something better arrives.
 */
function bestTexture(t) {
  if (t.image instanceof THREE.Texture) return { tex: t.image, own: true, from: t.z };
  for (let up = 1; t.z - up >= 1; up++) {
    const za = t.z - up, xa = t.x >> up, ya = t.y >> up;
    const a = tiles.get(key(za, xa, ya));
    if (!(a?.image instanceof THREE.Texture)) continue;
    if (t.crop?.from !== za) {
      t.crop?.tex.dispose();
      const tex = a.image.clone();
      const [ou, ov, sc] = ancestorCrop(t.z, t.x, t.y, za, xa, ya);
      tex.offset.set(ou, ov);
      tex.repeat.set(sc, sc);
      t.crop = { tex, from: za };
    }
    return { tex: t.crop.tex, own: false, from: za };
  }
  return null;
}

function applyTexture(t) {
  if (!t.mesh) return;
  const best = bestTexture(t);
  if (!best) { t.mesh.visible = false; return; }
  const m = t.mesh.material;
  if (m.map !== best.tex) {
    const first = !m.map;
    m.map = best.tex;
    if (first) m.needsUpdate = true;             // USE_MAP switches on once; later swaps are uniforms
    if (best.own && t.crop) { t.crop.tex.dispose(); t.crop = null; }
  }
  if (t.vegUniforms) t.vegUniforms.uOwn.value = best.own ? 1 : 0;
  t.mesh.visible = t.want;
}

function request(t) {
  if (t.image || t.loading) return;
  t.loading = true;
  queue.push(t);
}

function pump() {
  // The few coarse ancestors first (each covers dozens of leaves at once),
  // then the leaves, nearest first.
  const rank = (t) => (t.cover ? 0 : t.want ? 1 : 2);
  queue.sort((a, b) => rank(a) - rank(b) || a.d - b.d);
  while (inflight < FETCH_BUDGET && queue.length) {
    const t = queue.shift();
    if (!t.want && !t.ancestorWanted) { t.loading = false; continue; }
    inflight++;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      inflight--; t.loading = false;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      t.image = tex;
      // This tile, and every descendant showing an ancestor, may now improve.
      for (const o of tiles.values()) {
        if (o.want && o.z >= t.z && (o.x >> (o.z - t.z)) === t.x && (o.y >> (o.z - t.z)) === t.y) applyTexture(o);
      }
      pump();
    };
    img.onerror = () => { inflight--; t.loading = false; t.image = "missing"; pump(); };
    img.src = URL_TEMPLATE.replace("{z}", t.z).replace("{y}", t.y).replace("{x}", t.x);
  }
}

function tileFor(z, x, y) {
  const k = key(z, x, y);
  let t = tiles.get(k);
  if (!t) { t = { z, x, y, mesh: null, image: null, loading: false, used: 0, d: Infinity }; tiles.set(k, t); }
  return t;
}

function ensureMesh(viewer, t) {
  if (t.mesh) return;
  t.mesh = new THREE.Mesh(undefined, material(t));
  t.mesh.name = "GeoID-FlightTile";
  t.mesh.renderOrder = 40.5;          // over the flat horizon patch (40), under every imported layer (50+)
  t.mesh.frustumCulled = true;
  t.mesh.userData.nonInteractive = true;
  t.mesh.userData.keepRenderOrder = true;
  t.mesh.raycast = () => {};
  t.N = 0;
  liftGeometry(viewer, t, FIRST_GRID);
  t.terrainVersion = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  group.add(t.mesh);
}

/** The sun in the globe's frame, once a tick. */
function sunLocal(viewer) {
  const sunW = viewer.getSunDirection?.();
  if (!sunW) return null;
  return sunW.clone().normalize().transformDirection(new THREE.Matrix4().copy(viewer.globe.matrixWorld).invert());
}

/** The vegetation's sun, in the tile's east/north/up. */
function updateSun(t, sunL) {
  if (!t.vegUniforms || !t.centre) return;
  const up = t.centre.clone().normalize();
  t.vegUniforms.uUp.value.copy(up);
  if (!sunL) return;
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = up.clone().cross(east).normalize();
  t.vegUniforms.uSunLocal.value.set(sunL.dot(east), sunL.dot(north), sunL.dot(up));
}

function tick() {
  const viewer = window.GeoIDViewer, f = window.__flightSim;
  if (!viewer?.globe || !f?.active || !f.shipLatLon) return;
  if (group?.parent !== viewer.globe) {
    group = new THREE.Group();
    group.name = "GeoID-FlightTiles";
    group.userData.keepRenderOrder = true;
    viewer.globe.add(group);
  }
  const altM = (Number(f.shipAltUnits) || 0) / UNITS_PER_M;
  const horizonM = Math.sqrt(2 * 6371000 * Math.max(10, altM));
  const reach = Math.max(25000, Math.min(400000, 1.4 * horizonM));
  const leaves = selectLeaves(f.shipLatLon, altM, reach);
  const now = performance.now();
  for (const t of tiles.values()) { t.want = false; t.ancestorWanted = false; t.cover = false; t.d = Infinity; }
  const terrainVersion = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  // Building and re-lifting meshes reads the DEM per vertex, so it is
  // budgeted per tick, nearest first: every wanted tile first gets a coarse
  // mesh (the ground is never missing), then the close ones their full grid;
  // a new terrain version re-lifts only tiles whose heights really moved.
  const sunL = sunLocal(viewer);
  const wanted = leaves.map((L) => {
    const t = tileFor(L.z, L.x, L.y);
    t.want = true; t.d = L.d; t.used = now;
    return t;
  });
  for (const t of wanted) if (!t.mesh && performance.now() < now + WORK_MS) ensureMesh(viewer, t);
  for (const t of wanted) {
    if (!t.mesh || performance.now() > now + 2 * WORK_MS) continue;
    if (t.terrainVersion !== terrainVersion) {
      t.terrainVersion = terrainVersion;
      if (heightSignature(t) !== t.sig) { liftGeometry(viewer, t, t.N); continue; }
    }
    if (t.N < fullGrid(t.z)) liftGeometry(viewer, t, fullGrid(t.z));
  }
  for (const t of wanted) {
    request(t);
    // Ancestors two and five levels up, so a coarse image is there at once.
    for (const up of [2, 5]) {
      if (t.z - up < 1) continue;
      const a = tileFor(t.z - up, t.x >> up, t.y >> up);
      a.ancestorWanted = true; a.used = now; a.d = Math.min(a.d, t.d);
      if (up === 5) a.cover = true;
      request(a);
    }
    applyTexture(t);
    updateSun(t, sunL);
  }
  for (const t of tiles.values()) if (t.mesh && !t.want) t.mesh.visible = false;
  stats.built = leaves.filter((L) => tiles.get(key(L.z, L.x, L.y))?.mesh).length;
  // Forget the oldest beyond the budget.
  if (tiles.size > MAX_TILES_KEPT) {
    const old = [...tiles.values()].filter((t) => !t.want && !t.ancestorWanted).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, tiles.size - MAX_TILES_KEPT)) dispose(t);
  }
  pump();
  stats.leaves = leaves.length; stats.tiles = tiles.size; stats.inflight = inflight;
  stats.own = leaves.filter((L) => tiles.get(key(L.z, L.x, L.y))?.image instanceof THREE.Texture).length;
}

function dispose(t) {
  if (t.mesh) {
    t.mesh.parent?.remove(t.mesh);
    t.mesh.geometry.dispose();
    t.mesh.material.dispose();
  }
  t.crop?.tex.dispose();
  if (t.image instanceof THREE.Texture) t.image.dispose();
  tiles.delete(key(t.z, t.x, t.y));
}

export const stats = { leaves: 0, built: 0, tiles: 0, inflight: 0, own: 0 };

/** Start the flight ground (idempotent). */
let running = false;
export async function startFlightTiles() {
  if (running) return;
  running = true;                       // at once: the buildings ask while three loads
  if (!THREE) THREE = await import("../vendor/three.module.js");
  if (!running || timer) return;
  tick();
  timer = setInterval(tick, 100);
}

/** Stop and free everything. */
export function stopFlightTiles() {
  running = false;
  clearInterval(timer);
  timer = null;
  for (const t of [...tiles.values()]) dispose(t);
  queue.length = 0;
  group?.parent?.remove(group);
  group = null;
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTiles = { active: () => running, stats, startFlightTiles, stopFlightTiles };
}
