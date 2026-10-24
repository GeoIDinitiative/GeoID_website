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

const UNITS_PER_M = 3.2 / 6371000;
// size (texels), half-span (km): ~78 m, ~625 m and ~3 km cells.
export const LEVELS = [
  { key: "Near", n: 512, halfKm: 20 },
  { key: "Mid", n: 256, halfKm: 80 },
  { key: "Far", n: 256, halfKm: 400 },
];
const WORK_MS = 4;

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
  };
  return w.__geoidFlightGPU;
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

let THREE = null, timer = null, running = false;
const state = LEVELS.map(() => ({ tex: null, box: null, version: -1, job: null }));

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
      s.job = { box, version, row: 0, data: new Float32Array(L.n * L.n) };
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
      s.box = j.box; s.version = j.version; s.job = null;
      U[`uFlight${L.key}`].value = s.tex;
      U[`uFlight${L.key}Box`].value = new THREE.Vector4(s.box.lon0, s.box.lat0, s.box.dLon, s.box.dLat);
    }
  }
  U.uFlightOn.value = state[0].tex ? 1 : 0;
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
    s.tex?.dispose(); s.tex = null; s.box = null; s.job = null; s.version = -1;
    U[`uFlight${LEVELS[li].key}`].value = null;
    U[`uFlight${LEVELS[li].key}Box`].value = [0, 0, 1, 1];
  });
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTerrainGpu = { startFlightTerrainGpu, stopFlightTerrainGpu, uniforms: flightGpuUniforms };
}
