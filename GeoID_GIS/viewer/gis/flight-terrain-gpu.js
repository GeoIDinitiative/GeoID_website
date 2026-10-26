// Earth Flight's terrain, on the GPU, for every surface overlay.
//
// Owner, 2026-10-24: "run through all surface overlays and ensure they are
// properly implemented within flight sim (depth tests etc) but can be queried
// and interacted with in the same manner as the geohub". The overlays --
// imported vectors, the geology, Earth Engine and GeoTIFF rasters, flows,
// watersheds, the basemap drape -- all place their vertices on the GPU
// (vector-render.js `followRelief`: direction x (radius + relief + drape)),
// built once and moved by uniforms. In flight that put them on the bare
// sphere, under the flight terrain's hills.
//
// So the flight terrain is handed to that same shader as height textures:
// three nested grids round the aircraft (fine near, coarse far), in METRES
// at the Vertical scale, which `followRelief` samples by each vertex's
// direction and adds. No layer is rebuilt; everything follows the hills, and
// the grids follow the aircraft and the streaming elevation.
//
// The grids are filled a few milliseconds a frame (the elevation sampler is a
// main-thread lookup), into a back buffer that replaces the live one only
// when complete, so an overlay never sees half a grid.
//
// FILLS are DRAPED rather than lifted. A polygon's triangles are as big as its
// outline allows -- 47 km across Denver's urban area -- and lifting only their
// corners leaves a flat sheet cutting through the hills, white haze where it
// floats and gaps where the ground pokes through. So in flight every fill
// (polygons, geology, Earth Engine and GeoTIFF rasters) is also rendered,
// with its own material, into lat/lon textures over three boxes round the
// aircraft, and the flight tiles paint those textures onto the ground
// (flight-tiles.js): exactly on the terrain, hidden by it like the photo is.
// Lines and markers stay geometry, which hides itself behind ridges
// (vector-render.js).

const UNITS_PER_M = 3.2 / 6371000;
// size (texels), half-span (km): ~78 m, ~625 m and ~3 km cells.
export const LEVELS = [
  { key: "Near", n: 512, halfKm: 20 },
  { key: "Mid", n: 256, halfKm: 80 },
  { key: "Far", n: 256, halfKm: 400 },
];
const WORK_MS = 4;
// The drapes: size (texels) and half-span (km), ~20 m, ~160 m and ~780 m a
// texel, and how often each is redrawn (layers toggled, restyled or added).
export const DRAPES = [
  { key: "Near", n: 2048, halfKm: 20, everyMs: 600 },
  { key: "Mid", n: 1024, halfKm: 80, everyMs: 2000 },
  { key: "Far", n: 1024, halfKm: 400, everyMs: 6000 },
];
/** The materials drawn into the drapes (vector-render.js registers its fills). */
export const DRAPE_MATERIALS = new WeakSet();

/** The shared uniforms every `followRelief` material reads (vector-render.js). */
export function flightGpuUniforms() {
  const w = typeof window !== "undefined" ? window : globalThis;
  // The boxes start as plain arrays, never null: three.js uploads a vec4
  // uniform on every draw and a null one throws, which stopped the render
  // loop of every page drawing an overlay -- the globe too, not just flight.
  w.__geoidFlightGPU = w.__geoidFlightGPU || {
    uFlightOn: { value: 0 },
    uFlightNear: { value: null }, uFlightNearBox: { value: [0, 0, 1, 1] },
    uFlightMid: { value: null }, uFlightMidBox: { value: [0, 0, 1, 1] },
    uFlightFar: { value: null }, uFlightFarBox: { value: [0, 0, 1, 1] },
    // The aircraft's direction in the overlays' frame, and the cosine of the
    // radius round it inside which fills are drawn by the drape, not as
    // geometry (2: nowhere).
    uFlightShipDir: { value: [0, 1, 0] },
    uFlightCoverCos: { value: 2 },
    // 1 while a drape is being drawn, and the lat/lon box it is drawn over.
    uFlightDrapePass: { value: 0 }, uFlightDrapeBox: { value: [0, 0, 1, 1] },
    uDrapeOn: { value: 0 },
    uDrapeNear: { value: null }, uDrapeNearBox: { value: [0, 0, 1, 1] },
    uDrapeMid: { value: null }, uDrapeMidBox: { value: [0, 0, 1, 1] },
    uDrapeFar: { value: null }, uDrapeFarBox: { value: [0, 0, 1, 1] },
  };
  return w.__geoidFlightGPU;
}

/** The overlays' direction convention (vector-render `aDir`): lon = atan(z, -x). */
export function dirFor(lat, lon) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return [-Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
}

/**
 * How far round the aircraft (m) the drapes stand in for fill geometry: inside
 * both the coarsest drape drawn (a box is snapped, so the aircraft can be a
 * quarter of its span off centre) and the flight tiles that paint it.
 */
export function drapeCoverM(readyHalfKm, tileReachM) {
  if (!readyHalfKm) return 0;
  return Math.min(0.75 * readyHalfKm * 1000, 0.95 * (tileReachM || 0));
}

/** A grid's box round a point, snapped to a quarter of its span so it does not crawl. */
export function boxFor(lat, lon, halfKm) {
  const dLat = halfKm / 111.32, sLat = dLat / 2;
  const cLat = Math.round(lat / sLat) * sLat;
  // The longitude span from the SNAPPED latitude, so it too holds still.
  const dLon = halfKm / (111.32 * Math.max(0.05, Math.cos(cLat * Math.PI / 180))), sLon = dLon / 2;
  const cLon = Math.round(lon / sLon) * sLon;
  return { lon0: cLon - dLon, lat0: Math.max(-85, cLat - dLat), dLon: 2 * dLon, dLat: Math.min(170, 2 * dLat) };
}

/* ── Browser ────────────────────────────────────────────────────────────── */

let THREE = null, timer = null, running = false, drapeCam = null;
const state = LEVELS.map(() => ({ tex: null, box: null, version: -1, job: null }));
const drapeState = DRAPES.map(() => ({ rt: null, box: null, at: 0 }));

function makeTexture(n, data) {
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  const r = window.GeoIDViewer?.renderer;
  const linear = r?.extensions?.has?.("OES_texture_float_linear");
  tex.magFilter = tex.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function step() {
  const T = window.GeoIDFlightTerrain, f = window.__flightSim, U = flightGpuUniforms();
  if (!running || !T?.active?.() || !f?.shipLatLon) { U.uFlightOn.value = 0; return; }
  const { lat, lon } = f.shipLatLon;
  const version = T.getVersion?.() ?? 0;
  const until = performance.now() + WORK_MS;
  for (let li = 0; li < LEVELS.length && performance.now() < until; li++) {
    const L = LEVELS[li], s = state[li];
    if (!s.job) {
      const box = boxFor(lat, lon, L.halfKm);
      const moved = !s.box || box.lon0 !== s.box.lon0 || box.lat0 !== s.box.lat0;
      if (!moved && s.version === version) continue;
      // A new terrain version that did not change a coarse grid's ground
      // (most of them: a tile arriving somewhere else) is taken without a
      // rebuild. The near grid's detail is finer than any sample would see,
      // so it rebuilds.
      if (!moved && li > 0 && s.sig && sameHeights(s.sig, sigFor(box, T))) { s.version = version; continue; }
      s.job = { box, version, row: 0, data: new Float32Array(L.n * L.n), sig: sigFor(box, T) };
    }
    const j = s.job, n = L.n;
    while (j.row < n && performance.now() < until) {
      const la = j.box.lat0 + (j.row + 0.5) / n * j.box.dLat;
      for (let i = 0; i < n; i++) {
        const lo = j.box.lon0 + (i + 0.5) / n * j.box.dLon;
        j.data[j.row * n + i] = (T.heightUnits(la, lo) || 0) / UNITS_PER_M;
      }
      j.row++;
    }
    if (j.row >= n) {
      // Complete: swap it in, texture and box together.
      s.tex?.dispose();
      s.tex = makeTexture(n, j.data);
      s.box = j.box; s.version = j.version; s.sig = j.sig; s.job = null;
      U[`uFlight${L.key}`].value = s.tex;
      U[`uFlight${L.key}Box`].value = new THREE.Vector4(s.box.lon0, s.box.lat0, s.box.dLon, s.box.dLat);
    }
  }
  U.uFlightOn.value = state[0].tex ? 1 : 0;
  U.uFlightShipDir.value = dirFor(lat, lon);
  if (U.uFlightOn.value) drapeStep(lat, lon, U);
}

/** A 7 x 7 sample of a box's ground (m): has the terrain under a grid moved? */
function sigFor(box, T) {
  const out = new Float32Array(49);
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
    out[j * 7 + i] = (T.heightUnits(box.lat0 + (j + 0.5) / 7 * box.dLat, box.lon0 + (i + 0.5) / 7 * box.dLon) || 0) / UNITS_PER_M;
  }
  return out;
}
const sameHeights = (a, b) => a.every((h, i) => Math.abs(h - b[i]) < 2);

/**
 * Something drawn into the drapes changed -- a time bar stepped a frame, a
 * layer was switched -- so each drape is redrawn at its next turn rather than
 * on its timer (up to 6 s for the far one: a played sequence trailed by
 * seconds on the ground round the aircraft). One drape a tick still.
 */
export function markDrapesDirty() {
  for (const s of drapeState) s.dirty = true;
}

/* One drape a tick at most: the one whose box moved, else a dirty one, else the stalest due. */
function drapeStep(lat, lon, U) {
  const now = performance.now();
  let moved = -1, dirty = -1, stale = -1;
  for (let i = 0; i < DRAPES.length; i++) {
    const s = drapeState[i], box = boxFor(lat, lon, DRAPES[i].halfKm);
    if (!s.box || box.lon0 !== s.box.lon0 || box.lat0 !== s.box.lat0) { moved = i; break; }
    if (dirty < 0 && s.dirty) dirty = i;
    if (stale < 0 && now - s.at > DRAPES[i].everyMs) stale = i;
  }
  const pick = moved >= 0 ? moved : dirty >= 0 ? dirty : stale;
  if (pick >= 0) { drapeState[pick].dirty = false; renderDrape(pick, boxFor(lat, lon, DRAPES[pick].halfKm), U); }
  let ready = 0;
  drapeState.forEach((s, i) => { if (s.box) ready = DRAPES[i].halfKm; });
  const coverM = drapeCoverM(ready, window.__geoidFlightTileReachM);
  U.uFlightCoverCos.value = coverM > 0 ? Math.cos(coverM / 6371000) : 2;
  U.uDrapeOn.value = drapeState[0].box ? 1 : 0;
}

/*
 * Draw every visible fill into one drape. The fills' own vertex shader moves
 * each vertex to its lat/lon in the box while uFlightDrapePass is 1
 * (vector-render.js), so they are drawn with their own material, colour,
 * opacity and order -- whatever the panels say -- in the order the globe
 * draws them. No depth buffer: a drape is flat.
 */
function renderDrape(i, box, U) {
  const V = window.GeoIDViewer, r = V?.renderer, scene = V?.scene;
  if (!r || !scene) return;
  const D = DRAPES[i], s = drapeState[i];
  if (!s.rt) {
    s.rt = new THREE.WebGLRenderTarget(D.n, D.n, { depthBuffer: false, stencilBuffer: false });
    const t = s.rt.texture;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = r.capabilities?.getMaxAnisotropy?.() || 1;
  }
  if (!drapeCam) { drapeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); drapeCam.layers.enableAll(); }
  const list = [];
  scene.traverseVisible((o) => {
    if (o.material && !Array.isArray(o.material) && o.material.visible !== false && DRAPE_MATERIALS.has(o.material)) list.push(o);
  });
  list.sort((a, b) => a.renderOrder - b.renderOrder || a.id - b.id);
  const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
  const prevColour = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
  try {
    r.setRenderTarget(s.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.autoClear = false;
    U.uFlightDrapePass.value = 1;
    U.uFlightDrapeBox.value = [box.lon0, box.lat0, box.dLon, box.dLat];
    for (const o of list) {
      // The vertex shader places it, so the camera's frustum must not cull it.
      const culled = o.frustumCulled;
      o.frustumCulled = false;
      try { r.render(o, drapeCam); } finally { o.frustumCulled = culled; }
    }
  } finally {
    U.uFlightDrapePass.value = 0;
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    r.setClearColor(prevColour, prevAlpha);
  }
  s.box = box; s.at = performance.now();
  U[`uDrape${D.key}`].value = s.rt.texture;
  U[`uDrape${D.key}Box`].value = [box.lon0, box.lat0, box.dLon, box.dLat];
}

/** Start keeping the overlays' terrain grids current (idempotent). */
export async function startFlightTerrainGpu() {
  if (running) return;
  running = true;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  if (!running) return;
  timer = setInterval(step, 50);
}

/** Stop: overlays return to the globe exactly as before. */
export function stopFlightTerrainGpu() {
  running = false;
  clearInterval(timer); timer = null;
  const U = flightGpuUniforms();
  U.uFlightOn.value = 0;
  state.forEach((s, li) => {
    s.tex?.dispose(); s.tex = null; s.box = null; s.job = null; s.version = -1; s.sig = null;
    U[`uFlight${LEVELS[li].key}`].value = null;
    U[`uFlight${LEVELS[li].key}Box`].value = [0, 0, 1, 1];
  });
  drapeState.forEach((s, i) => {
    s.rt?.dispose(); s.rt = null; s.box = null; s.at = 0;
    U[`uDrape${DRAPES[i].key}`].value = null;
    U[`uDrape${DRAPES[i].key}Box`].value = [0, 0, 1, 1];
  });
  U.uDrapeOn.value = 0;
  U.uFlightCoverCos.value = 2;
  U.uFlightDrapePass.value = 0;
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTerrainGpu = { startFlightTerrainGpu, stopFlightTerrainGpu, uniforms: flightGpuUniforms, markDrapesDirty };
}
