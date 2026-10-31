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

import { NIGHT } from "./night-lights.js?v=20261031-747e383";
import { flightGpuUniforms } from "./flight-terrain-gpu.js?v=20261031-747e383";

// Esri serves World Imagery over HTTP/1.1, so a browser opens only ~6
// connections per host: measured, 12 requests on one host ran at ~20 tiles/s.
// The same tiles come from two hosts; tiles alternate between them.
const URL_TEMPLATES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
];
const ROOT_Z = 7;
export const MAX_Z = 17;
// Split while closer than SPLIT x the tile's size. 2.4 (was 2.0; owner,
// 2026-10-25: "extend the radius of the higher res"): the sharpest imagery
// reaches about a fifth further before giving way to the next level.
export const SPLIT = 2.4;
export const MAX_LEAVES = 1000;
const MAX_TILES_KEPT = 1800;
const FETCH_BUDGET = 12;            // 6 per host x 2 hosts
const AHEAD_S = 6;                 // prefetch where the aircraft will be this far ahead
const UNITS_PER_M = 3.2 / 6371000;
const EARTH_CIRC_M = 40075016.686;
const VEG_FROM_Z = 16;
const VEG_HEIGHT_M = 7;
const ROCK_FROM_Z = 15;            // vertices lifted by rock relief (needs a fine grid)
const BUMP_FROM_Z = 13;            // per-pixel crag shading
const ROCK_HEIGHT_M = 8;
const BUMP_HEIGHT_M = 6;
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
    // Foreshortening: ground seen at a shallow angle is squashed on screen,
    // so it needs less detail than ground seen from above -- about a level
    // less toward the horizon, full detail straight down. Fewer tiles, and
    // the sharp ones where they show.
    const sinElev = Math.min(1, altM / Math.max(d, 1));
    if (z < maxZ && d < split * tileSizeM(z, y) * (0.45 + 0.55 * Math.sqrt(sinElev))) {
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

/**
 * How much coarser each neighbour is, across the tile's four edges
 * [north, south, west, east], in quadtree levels (0 where the neighbour is
 * as fine or finer). `isLeaf(z, x, y)` says whether that tile is drawn.
 *
 * WHY. Leaves of different levels meet edge to edge, and the photograph
 * changed sharpness in a straight line there (owner: "a clean transition
 * between mapped higher and lower resolution tiles"). Knowing the step, a
 * tile samples its own image that many mip levels coarser AT the edge,
 * easing to full sharpness half a tile in, so the two sides match where
 * they touch; and its vegetation and rock relief fade out there when the
 * neighbour has none, so the ground does not step either.
 */
export function edgeSteps(z, x, y, isLeaf) {
  const n = 2 ** z;
  const across = [[x, y - 1], [x, y + 1], [((x - 1) % n + n) % n, y], [(x + 1) % n, y]];
  return across.map(([nx, ny]) => {
    if (ny < 0 || ny >= n) return 0;
    for (let up = 0; z - up >= 1; up++) {
      if (isLeaf(z - up, nx >> up, ny >> up)) return up;
    }
    return 0;
  });
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
let prevShip = null;
const SUN = { value: null };
// The ground's share of the night light (skyglow), by the aircraft's height.
const SKYGLOW = { value: 0.05 };

const key = (z, x, y) => `${z}/${x}/${y}`;

function localPoint(viewer, lat, lon) {
  const p = viewer.surfacePoint(lat, lon, 0);
  const v = new THREE.Vector3(-p.x, p.y, -p.z);
  const h = window.GeoIDFlightTerrain?.heightUnits?.(lat, lon) || 0;
  if (h) v.setLength(v.length() + h);
  return v;
}

const fullGrid = (z) => (z >= 16 ? 32 : z >= 15 ? 24 : z >= 12 ? 16 : 10);
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
  const T = window.GeoIDFlightTerrain;
  const hM = new Float32Array(verts);
  for (let j = 0; j <= N; j++) {
    const lat = tileYToLat(t.y + j / N, t.z);
    for (let i = 0; i <= N; i++) {
      const lon = tileXToLon(t.x + i / N, t.z);
      v.copy(localPoint(viewer, lat, lon));
      const k = j * (N + 1) + i;
      hM[k] = T?.active?.() ? (T.groundMetres(lat, lon) ?? 0) : 0;
      pos[k * 3] = v.x - centre.x; pos[k * 3 + 1] = v.y - centre.y; pos[k * 3 + 2] = v.z - centre.z;
      v.setLength(v.length() - skirt);                     // the skirt vertex, below
      const s = verts + k;
      pos[s * 3] = v.x - centre.x; pos[s * 3 + 1] = v.y - centre.y; pos[s * 3 + 2] = v.z - centre.z;
    }
  }
  // How rocky the ground can be here: the terrain's slope (true metres),
  // 0 below ~11 deg, 1 above ~31 deg. Cliffs and crags are on steep ground;
  // grey city roofs, which look like rock in colour, are on flat ground.
  const slope = geo.attributes.aSlope ? geo.attributes.aSlope.array : new Float32Array(verts * 2);
  const cell = tileSizeM(t.z, t.y) / N;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i;
    const e = hM[j * (N + 1) + Math.min(N, i + 1)], w = hM[j * (N + 1) + Math.max(0, i - 1)];
    const so = hM[Math.min(N, j + 1) * (N + 1) + i], no = hM[Math.max(0, j - 1) * (N + 1) + i];
    const gx = (e - w) / (cell * (Math.min(N, i + 1) - Math.max(0, i - 1)));
    const gy = (so - no) / (cell * (Math.min(N, j + 1) - Math.max(0, j - 1)));
    const g = Math.hypot(gx, gy), r = Math.min(1, Math.max(0, (g - 0.2) / 0.4));
    slope[k] = slope[verts + k] = r * r * (3 - 2 * r);
  }
  if (!geo.attributes.position) {
    geo.setAttribute("aSlope", new THREE.BufferAttribute(slope, 1));
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
    geo.attributes.aSlope.needsUpdate = true;
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
  const veg = t.z >= VEG_FROM_Z, rocks = t.z >= ROCK_FROM_Z, bump = t.z >= BUMP_FROM_Z;
  const sizeM = tileSizeM(t.z, t.y), mPerPx = sizeM / 256;
  t.uniforms = {
    uVegLod: { value: Math.max(0, Math.log2(25 / mPerPx)) },
    uVegH: { value: VEG_HEIGHT_M * UNITS_PER_M },
    uVegSlope: { value: VEG_HEIGHT_M / sizeM },
    uRockLod: { value: Math.max(0, Math.log2(20 / mPerPx)) },
    uRockH: { value: ROCK_HEIGHT_M * UNITS_PER_M },
    uBumpScale: { value: BUMP_HEIGHT_M / sizeM },
    uUp: { value: new THREE.Vector3() },
    uSunLocal: { value: new THREE.Vector3(0, 0, 1) },     // (east, north, up)
    uOwn: { value: 0 },
    // Coarser-neighbour steps (edgeSteps) and which edges' neighbours carry
    // no vegetation / rock relief: (north, south, west, east).
    uEdgeLod: { value: new THREE.Vector4() },
    uEdgeVeg: { value: new THREE.Vector4() },
    uEdgeRock: { value: new THREE.Vector4() },
    uNight: { value: 0 },
    uLights: { value: null },
    uLightsXf: { value: new THREE.Vector3(0, 0, 1) },      // offset u, v, scale into the Black Marble tile
    uLightsOn: { value: 0 },
    uLampCells: { value: sizeM / 9 },
    uSkyglow: SKYGLOW,
    // The tile's longitudes and Web Mercator rows (0..1 from the north), so a
    // fragment knows its lat/lon for the overlays' drapes.
    uTileLL: { value: [tileXToLon(t.x, t.z), 360 / 2 ** t.z, t.y / 2 ** t.z, (t.y + 1) / 2 ** t.z] },
  };
  const D = flightGpuUniforms();
  for (const k of ["uDrapeOn", "uDrapeNear", "uDrapeNearBox", "uDrapeMid", "uDrapeMidBox", "uDrapeFar", "uDrapeFarBox"]) t.uniforms[k] = D[k];
  const sampled = veg || rocks;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, t.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec2 vTileUv;
attribute float aSlope;
varying float vSlope;
${EDGE_PARS}
${sampled ? SAMPLE_VERTEX_PARS + ROCK_FN : ""}
${veg ? VEG_VERTEX_PARS : ""}
${rocks ? ROCK_VERTEX_PARS : ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  vTileUv = uv;
  vSlope = aSlope;
${veg ? VEG_VERTEX : ""}
${rocks ? ROCK_VERTEX : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec2 vTileUv;
varying float vSlope;
${EDGE_PARS}
${veg ? "varying float vVegShade;" : ""}
${bump ? ROCK_FN + BUMP_PARS : ""}
${bump ? "" : "uniform float uOwn;   // the joins' mip ramp reads it; BUMP_PARS declares it otherwise"}
${NIGHT_PARS}
${DRAPE_PARS}`)
      .replace("#include <map_fragment>", `${EDGE_MAP_FRAGMENT}
${veg ? "  diffuseColor.rgb *= vVegShade;" : ""}
${bump ? BUMP_FRAGMENT : ""}
${NIGHT_FRAGMENT}
${DRAPE_FRAGMENT}`);
  };
  m.customProgramCacheKey = () => `geoid-flight-tile2|${veg}|${rocks}|${bump}`;
  return m;
}

/* Seams between levels (edgeSteps). `edgeRamp(steps)` is, per edge with a
   non-zero entry, 1 at that edge falling to 0 half a tile in; the largest
   wins. vTileUv: u 0 west -> 1 east, v 1 north -> 0 south (skirts share
   their edge's uv, so they follow it). */
const EDGE_PARS = /* glsl */`
uniform vec4 uEdgeLod, uEdgeVeg, uEdgeRock;
vec4 edgeNear(vec2 t) {
  vec4 d = vec4(1.0 - t.y, t.y, t.x, 1.0 - t.x);         // distance to N, S, W, E in tiles
  return vec4(1.0) - smoothstep(vec4(0.0), vec4(0.5), d);
}
float edgeRamp(vec2 t, vec4 steps) {
  vec4 w = edgeNear(t) * steps;
  return max(max(w.x, w.y), max(w.z, w.w));
}`;
/* The photograph, sampled `edgeRamp` mip levels coarser near a coarser
   neighbour (own images only; an ancestor's crop is already coarse). */
const EDGE_MAP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv, uOwn * edgeRamp(vTileUv, uEdgeLod) );
  diffuseColor *= sampledDiffuseColor;
#endif`;

const SAMPLE_VERTEX_PARS = /* glsl */`
uniform sampler2D map;
uniform float uOwn;
uniform vec3 uUp, uSunLocal;`;

/*
 * The vegetation rises out of the tile's own imagery: blurred to ~25 m, a
 * mask of dark, green-dominant pixels (tree crowns; grass, water and shadow
 * stay flat) lifts each vertex up to VEG_HEIGHT_M along the local vertical,
 * shaded against the sun RELATIVE to flat ground so open ground keeps its
 * exact colour.
 */
const VEG_VERTEX_PARS = /* glsl */`
uniform float uVegLod, uVegH, uVegSlope;
varying float vVegShade;
float vegAt(vec2 st) {
  vec3 c = sqrt(max(textureLod(map, st, uVegLod).rgb, 0.0));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return smoothstep(0.50, 0.22, lum) * smoothstep(-0.01, 0.08, c.g - c.b) * smoothstep(-0.04, 0.03, c.g - c.r);
}`;
const VEG_VERTEX = /* glsl */`
  vVegShade = 1.0;
#ifdef USE_MAP
  if (uOwn > 0.5) {
    vec2 st = (mapTransform * vec3(uv, 1.0)).xy;
    // Fades to nothing at an edge whose neighbour has no vegetation relief.
    float h0 = vegAt(st) * (1.0 - min(1.0, edgeRamp(uv, uEdgeVeg)));
    transformed += uUp * (h0 * uVegH);
    float e = 1.0 / 32.0;
    float dx = (vegAt(st + vec2(e, 0.0)) - vegAt(st - vec2(e, 0.0))) * uVegSlope / (2.0 * e);
    float dy = (vegAt(st + vec2(0.0, e)) - vegAt(st - vec2(0.0, e))) * uVegSlope / (2.0 * e);
    vec3 n = normalize(vec3(-dx, -dy, 1.0));
    vVegShade = clamp(1.0 + 1.6 * (dot(n, uSunLocal) - uSunLocal.z) * step(0.0, uSunLocal.z), 0.72, 1.22) * (1.0 - 0.1 * h0);
  }
#endif`;

/*
 * Rock and cliffs (owner, 2026-10-24: "like the trees and buildings, can we
 * use shadows to infer the protrusion of rocks/cliffs"). Shape from shading,
 * kept where it can only be rock: the terrain is steep (aSlope, from the
 * DEM: 0 below ~11 deg, 1 above ~31 deg -- so grey city roofs, on flat
 * ground, are never touched) AND the photo is not vegetation or water there
 * (rockFn). Inside that, the photo's own light and dark at ~20 m -- sunlit
 * faces against shadowed gullies -- is read as height against its ~80 m
 * surroundings and lifts the close tiles' vertices by up to ROCK_HEIGHT_M;
 * per pixel, the same detail at ~3 m shades against today's sun, so crags
 * catch the light. Both RELATIVE to the photo as it is: flat or open ground
 * keeps its exact colour.
 */
const ROCK_FN = /* glsl */`
float rockFn(vec3 c) {                  // c ~sRGB
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float notGreen = smoothstep(0.05, -0.01, c.g - max(c.r, c.b));
  float notWater = smoothstep(0.10, 0.18, lum) * (1.0 - smoothstep(0.03, 0.10, c.b - c.r));
  return notGreen * notWater;
}`;
const ROCK_VERTEX_PARS = /* glsl */`
uniform float uRockLod, uRockH;`;
const ROCK_VERTEX = /* glsl */`
#ifdef USE_MAP
  if (uOwn > 0.5 && aSlope > 0.01) {
    vec2 st = (mapTransform * vec3(uv, 1.0)).xy;
    vec3 c1 = sqrt(max(textureLod(map, st, uRockLod).rgb, 0.0));
    vec3 c2 = sqrt(max(textureLod(map, st, uRockLod + 2.0).rgb, 0.0));
    float l1 = dot(c1, vec3(0.299, 0.587, 0.114)), l2 = dot(c2, vec3(0.299, 0.587, 0.114));
    float keep = 1.0 - min(1.0, edgeRamp(uv, uEdgeRock));    // none where the neighbour has none
    transformed += uUp * (clamp((l1 - l2) * 2.5, -1.0, 1.0) * aSlope * rockFn(c1) * uRockH * keep);
  }
#endif`;
const BUMP_PARS = /* glsl */`
uniform float uOwn, uBumpScale;
uniform vec3 uSunLocal;
float lumOf(vec3 c) { return dot(sqrt(max(c, 0.0)), vec3(0.299, 0.587, 0.114)); }`;
const BUMP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
  if (vSlope > 0.01 && uOwn > 0.5 && uSunLocal.z > 0.0) {
    float rock = vSlope * rockFn(sqrt(max(diffuseColor.rgb, 0.0)));
    if (rock > 0.01) {
      float e = 1.5 / 256.0;
      float gx = (lumOf(texture2D(map, vMapUv + vec2(e, 0.0)).rgb) - lumOf(texture2D(map, vMapUv - vec2(e, 0.0)).rgb)) / (2.0 * e);
      float gy = (lumOf(texture2D(map, vMapUv + vec2(0.0, e)).rgb) - lumOf(texture2D(map, vMapUv - vec2(0.0, e)).rgb)) / (2.0 * e);
      vec3 n = normalize(vec3(-gx * uBumpScale, -gy * uBumpScale, 1.0));
      float shade = clamp(1.0 + 1.3 * (dot(n, uSunLocal) - uSunLocal.z), 0.7, 1.3);
      diffuseColor.rgb *= mix(1.0, shade, rock);
    }
  }
#endif`;

/*
 * Night (owner, 2026-10-24: "darkened imagery, and Black Marble to infer
 * streetlights / city lights"). The photograph is a daytime one, so by night
 * it is taken down to faint moonlight, and the light comes from two things
 * multiplied together:
 *
 *   * WHERE there is light, and how much: NASA's VIIRS Black Marble
 *     radiance (z8, ~0.4-0.6 km/px), cropped to the tile;
 *   * WHAT is lit: nothing here -- the lamps are real points on real roads
 *     (flight-lights.js). The ground keeps only the skyglow over towns,
 *     from the radiance: faint near the ground, growing with height.
 *
 * uNight is per tile, from the sun's elevation over it (twilight sweeps
 * across the ground as it does), 0 by day: nothing here costs anything then.
 */
const NIGHT_PARS = /* glsl */`
uniform float uNight, uLightsOn, uLampCells, uSkyglow;
uniform sampler2D uLights;
uniform vec3 uLightsXf;
// Arithmetic hash (no sin): this runs per ground pixel at night.
float nHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`;
const NIGHT_FRAGMENT = /* glsl */`
  if (uNight > 0.001) {
    vec3 day = diffuseColor.rgb;
    vec3 c = sqrt(max(day, 0.0));                                   // ~sRGB, for the masks
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    // Asphalt: grey and mid-dark. Bright roofs and concrete stay unlit.
    float paved = smoothstep(0.14, 0.05, sat) * smoothstep(0.12, 0.24, lum) * smoothstep(0.62, 0.40, lum);
    float rad = 0.0;
    if (uLightsOn > 0.5) {
      // Blurred (a mip bias of 2.5, ~2 km): skyglow is scattered light, and
      // Black Marble's 500 m pixels read as blotches when sharp.
      vec3 bm = texture2D(uLights, uLightsXf.xy + vTileUv * uLightsXf.z, 2.5).rgb;
      rad = clamp(dot(bm, vec3(0.35, 0.45, 0.20)) * 1.8, 0.0, 1.0);
    }
    // The lamps themselves are real points on real roads (flight-lights.js);
    // the ground carries only their SKYGLOW -- the scattered light over a
    // town, from Black Marble, faint close to the ground and growing with
    // height, where it is what a city is from the stratosphere.
    // Only over genuinely bright town centres: Black Marble's faint village
    // and suburb blobs, blurred, were the blotches across the countryside;
    // there the lamps alone are the light.
    float core = clamp((rad - 0.35) / 0.65, 0.0, 1.0);
    float glow = pow(core, 1.4) * uSkyglow * (0.85 + 0.3 * paved);
    vec3 warm = vec3(1.0, 0.72, 0.42);
    vec3 moon = day * vec3(0.035, 0.045, 0.07);
    diffuseColor.rgb = mix(day, moon + warm * glow, uNight);
  }`;

/*
 * The overlays' fills, draped (flight-terrain-gpu.js): every polygon and
 * raster layer drawn into lat/lon textures round the aircraft, laid over the
 * photo here, after the night, so a layer reads by night as by day. The
 * finest drape that covers the fragment is used.
 */
const DRAPE_PARS = /* glsl */`
uniform float uDrapeOn;
uniform sampler2D uDrapeNear, uDrapeMid, uDrapeFar;
uniform vec4 uDrapeNearBox, uDrapeMidBox, uDrapeFarBox;
uniform vec4 uTileLL;
bool inDrape(vec2 ll, vec4 box, out vec2 uv) {
  float c = box.x + 0.5 * box.z;
  ll.x = c + mod(ll.x - c + 180.0, 360.0) - 180.0;
  uv = (ll - box.xy) / box.zw;
  return uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
}`;
const DRAPE_FRAGMENT = /* glsl */`
  if (uDrapeOn > 0.5) {
    float my = mix(uTileLL.z, uTileLL.w, 1.0 - vTileUv.y);
    vec2 ll = vec2(uTileLL.x + vTileUv.x * uTileLL.y, degrees(atan(sinh(PI * (1.0 - 2.0 * my)))));
    vec2 duv;
    vec4 o = vec4(0.0);
    if (inDrape(ll, uDrapeNearBox, duv)) o = texture2D(uDrapeNear, duv);
    else if (inDrape(ll, uDrapeMidBox, duv)) o = texture2D(uDrapeMid, duv);
    else if (inDrape(ll, uDrapeFarBox, duv)) o = texture2D(uDrapeFar, duv);
    // Drawn over clear black with the layers' own blending: premultiplied.
    diffuseColor.rgb = diffuseColor.rgb * (1.0 - o.a) + o.rgb;
  }`;

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
  t.uniforms.uOwn.value = best.own ? 1 : 0;
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
  // ...and what the aircraft is about to reach, after everything it needs now.
  const rank = (t) => (t.cover ? 0 : t.want ? 1 : t.ahead ? 3 : 2);
  queue.sort((a, b) => rank(a) - rank(b) || a.d - b.d);
  while (inflight < FETCH_BUDGET && queue.length) {
    const t = queue.shift();
    if (!t.want && !t.ancestorWanted && !t.ahead) { t.loading = false; continue; }
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
    // A failure may be a 404 (no imagery: keep the ancestor) or a refusal
    // under load (429): try once more a few seconds later before giving up.
    img.onerror = () => {
      inflight--; t.loading = false;
      if (!t.retried) { t.retried = true; setTimeout(() => { if (t.image == null) request(t); }, 4000); }
      else t.image = "missing";
      pump();
    };
    img.src = URL_TEMPLATES[(t.x + t.y) & 1].replace("{z}", t.z).replace("{y}", t.y).replace("{x}", t.x);
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
  t.mesh.userData.tile = { z: t.z, x: t.x, y: t.y };     // for inspection
  t.mesh.userData.uniforms = t.uniforms;
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

/** The tile's sun (vegetation shading) and how dark it is over it. */
function updateSun(t, sunL) {
  if (!t.uniforms || !t.centre) return;
  const up = t.centre.clone().normalize();
  t.uniforms.uUp.value.copy(up);
  if (!sunL) return;
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = up.clone().cross(east).normalize();
  t.uniforms.uSunLocal.value.set(sunL.dot(east), sunL.dot(north), sunL.dot(up));
  t.uniforms.uNight.value = nightFor(sunL.dot(up));
  if (t.uniforms.uNight.value > 0.01) lightsFor(t);
}

/** 0 by day .. 1 by night, from the sine of the sun's elevation (as night-lights.js). */
const nightFor = (sinSun) => Math.min(1, Math.max(0, (0.10 - sinSun) / 0.22));

/* Black Marble, z8 at most (GIBS's Level8), one texture per z8 tile, shared. */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const LIGHTS_Z = 8;
const lights = new Map();           // "z/x/y" -> Texture | "loading" | "missing"
function lightsFor(t) {
  const zl = Math.min(t.z, LIGHTS_Z), up = t.z - zl;
  const xl = t.x >> up, yl = t.y >> up, k = key(zl, xl, yl);
  const have = lights.get(k);
  if (have instanceof THREE.Texture) {
    if (t.uniforms.uLights.value !== have) {
      const [ou, ov, sc] = ancestorCrop(t.z, t.x, t.y, zl, xl, yl);
      t.uniforms.uLights.value = have;
      t.uniforms.uLightsXf.value.set(ou, ov, sc);
      t.uniforms.uLightsOn.value = 1;
    }
    return;
  }
  if (have) return;
  lights.set(k, "loading");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    lights.set(k, tex);
  };
  img.onerror = () => lights.set(k, "missing");
  img.src = GIBS.replace("{z}", zl).replace("{y}", yl).replace("{x}", xl);
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
  window.__geoidFlightTileReachM = reach;      // how far the drapes can be painted (flight-terrain-gpu.js)
  const leaves = selectLeaves(f.shipLatLon, altM, reach);
  const now = performance.now();
  for (const t of tiles.values()) { t.want = false; t.ancestorWanted = false; t.cover = false; t.ahead = false; t.d = Infinity; }
  // AHEAD: where the aircraft will be in AHEAD_S, from its own movement since
  // the last tick; the sharp tiles there are fetched (images only) once
  // everything needed now is in hand, so flying on finds them ready.
  if (prevShip && now > prevShip.t) {
    const k = AHEAD_S * 1000 / (now - prevShip.t);
    const ahead = { lat: f.shipLatLon.lat + (f.shipLatLon.lat - prevShip.lat) * k, lon: f.shipLatLon.lon + (f.shipLatLon.lon - prevShip.lon) * k };
    if (Math.abs(ahead.lat - f.shipLatLon.lat) + Math.abs(ahead.lon - f.shipLatLon.lon) > 1e-4) {
      for (const L of selectLeaves(ahead, altM, Math.min(reach, 12000), { maxLeaves: 220 })) {
        const t = tileFor(L.z, L.x, L.y);
        t.ahead = true; t.used = now; t.d = Math.min(t.d, 1e6 + L.d);
        if (!t.image) request(t);
      }
    }
  }
  prevShip = { lat: f.shipLatLon.lat, lon: f.shipLatLon.lon, t: now };
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
  // Coarser neighbours across each edge (edgeSteps), for the seam blend.
  const leafSet = new Set(leaves.map((L) => key(L.z, L.x, L.y)));
  const isLeaf = (z, x, y) => leafSet.has(key(z, x, y));
  for (const t of wanted) {
    if (!t.uniforms) continue;
    const st = edgeSteps(t.z, t.x, t.y, isLeaf);
    t.uniforms.uEdgeLod.value.set(...st);
    const lacks = (fromZ) => st.map((k) => (t.z >= fromZ && k > 0 && t.z - k < fromZ ? 1 : 0));
    t.uniforms.uEdgeVeg.value.set(...lacks(VEG_FROM_Z));
    t.uniforms.uEdgeRock.value.set(...lacks(ROCK_FROM_Z));
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
  // A tile no longer wanted stays drawn -- pushed behind the rest -- until
  // every wanted tile over it has a mesh. Hiding it at once left a hole when
  // the selection changed (a turn, a climb) faster than the new meshes were
  // built, and through it the globe's unlit daytime backdrop, framed by the
  // neighbours' skirts: reported as a bright plateau with walls on Etna's
  // slopes by night.
  const bare = wanted.filter((t) => !t.mesh);
  const overlaps = (a, b) => {
    const z = Math.min(a.z, b.z);
    return (a.x >> (a.z - z)) === (b.x >> (b.z - z)) && (a.y >> (a.z - z)) === (b.y >> (b.z - z));
  };
  for (const t of tiles.values()) {
    if (!t.mesh) continue;
    const standIn = !t.want && t.mesh.visible && bare.some((b) => overlaps(t, b));
    if (!t.want && !standIn) t.mesh.visible = false;
    else if (t.want) t.mesh.visible = true;
    const units = standIn ? 16 : -8;
    if (t.mesh.material.polygonOffsetUnits !== units) t.mesh.material.polygonOffsetUnits = units;
  }
  hideBackdropPatches(viewer);
  stats.built = leaves.filter((L) => tiles.get(key(L.z, L.x, L.y))?.mesh).length;
  // Forget the oldest beyond the budget.
  if (tiles.size > MAX_TILES_KEPT) {
    const old = [...tiles.values()].filter((t) => !t.want && !t.ancestorWanted && !t.ahead).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, tiles.size - MAX_TILES_KEPT)) dispose(t);
  }
  // Faint: the lamps (flight-lights.js) carry the light; this only fills
  // between them, a little more as the view widens.
  // Black Marble is a GUIDE only (owner): it decides which lamps are lit
  // (flight-lights.js) and is never drawn as light -- its 500 m pixels are
  // blotches at any height.
  SKYGLOW.value = 0;
  // The buildings' night (lit windows, dimmed walls) is the ship's.
  if (sunL) {
    const p = viewer.surfacePoint(f.shipLatLon.lat, f.shipLatLon.lon, 0);
    NIGHT.value = nightFor(new THREE.Vector3(-p.x, p.y, -p.z).normalize().dot(sunL));
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

/** For the Metadata window while flying: what the ground is made of. */
export function creditNow() {
  if (!running) return null;
  const night = [...lights.values()].some((v) => v instanceof THREE.Texture);
  return {
    title: "Earth Flight ground",
    source: "Esri World Imagery tiles z7-z17 on the streamed elevation (flight-terrain.js)"
      + (night ? "; at night NASA GIBS VIIRS_Black_Marble (2016) z8 radiance, with street lights placed on the imagery's paved surfaces" : ""),
    citation: "Imagery: Esri World Imagery — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Vegetation relief up to 7 m from the imagery's colour (procedural)."
      + (night ? " Night lights: NASA Earth Observatory / NASA Goddard Space Flight Center, VIIRS Black Marble (Suomi NPP), 2016, via NASA EOSDIS GIBS, public domain; street-light placement is inferred (procedural)." : ""),
    crs: "EPSG:3857 tiles, drawn on the globe",
    licence: "Esri terms of use (imagery)" + (night ? "; public domain (Black Marble)" : ""),
  };
}

/*
 * The globe's view-detail patches (basemap-drape.js) are daytime imagery,
 * unlit, at sea level, drawn without a depth test under these tiles. In flight
 * the tiles are the ground, so the patches only ever showed through a gap --
 * bright day at night. Hidden while flying, given back after.
 */
const hiddenBackdrop = new Set();
function hideBackdropPatches(viewer) {
  for (const o of viewer.globe?.children || []) {
    if (/^GeoID-BasemapRefine/.test(o.name) && o.visible) { o.visible = false; hiddenBackdrop.add(o); }
  }
}
function restoreBackdropPatches() {
  for (const o of hiddenBackdrop) if (o.parent) o.visible = true;
  hiddenBackdrop.clear();
}

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
  prevShip = null;
  NIGHT.value = 0;
  restoreBackdropPatches();
  group?.parent?.remove(group);
  group = null;
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTiles = { active: () => running, stats, creditNow, startFlightTiles, stopFlightTiles };
}
