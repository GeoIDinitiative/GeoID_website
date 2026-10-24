/**
 * Earth flight — boot, the frame loop, the shadow frustum, the HUD.
 *
 * See ../README.md for what every pixel is made of and under what licence.
 */

import * as THREE from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { pending as tilesPending, stats as tileStats } from "../../../everest/game/tiles.js?v=84ebb99-a7f30c15";
import { setSession, shiftOrigin, llToLocal, localToLL, frame } from "./geo.js?v=1";
import { Terrain, IMAGERY, ELEVATION } from "./terrain.js?v=1";
import { Buildings, BUILDINGS } from "./buildings.js?v=1";
import { Sky } from "./sky.js?v=1";
import { Plane } from "./plane.js?v=1";

export const CITIES = {
  london:    { name: "London",         lat: 51.5040, lon: -0.1090, hdg: 280 },
  catania:   { name: "Catania",        lat: 37.5000, lon: 15.1000, hdg: 330 },
  newyork:   { name: "New York",       lat: 40.6950, lon: -74.0200, hdg: 20 },
  paris:     { name: "Paris",          lat: 48.8520, lon: 2.3200, hdg: 300 },
  rome:      { name: "Rome",           lat: 41.8880, lon: 12.5000, hdg: 290 },
  sanfran:   { name: "San Francisco",  lat: 37.8050, lon: -122.3800, hdg: 230 },
  chicago:   { name: "Chicago",        lat: 41.8750, lon: -87.6050, hdg: 270 },
  tokyo:     { name: "Tokyo",          lat: 35.6750, lon: 139.7750, hdg: 300 },
  hongkong:  { name: "Hong Kong",      lat: 22.2900, lon: 114.1700, hdg: 250 },
  dubai:     { name: "Dubai",          lat: 25.1850, lon: 55.2900, hdg: 290 },
  sydney:    { name: "Sydney",         lat: -33.8500, lon: 151.2300, hdg: 260 },
  rio:       { name: "Rio de Janeiro", lat: -22.9700, lon: -43.1700, hdg: 320 },
};

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

/* ── Renderer ─────────────────────────────────────────────────────────── */

const canvas = $("view");
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance",
  // 0.3 m to 1,000 km: no 24-bit linear depth survives that ratio.
  logarithmicDepthBuffer: true,
  preserveDrawingBuffer: params.has("capture"),
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;    // the imagery is already a photograph
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2e6);

const terrain = new Terrain(renderer);
scene.add(terrain.group);
const buildings = new Buildings(terrain.anisotropy);
scene.add(buildings.group);
const sky = new Sky(scene);
const plane = new Plane(scene);

/* ── Shadows ──────────────────────────────────────────────────────────────
   One shadow map, refitted every frame to a square of ground ahead of the
   camera whose size follows height: ~1.2 km across at rooftop level, up to
   8 km from high. A cascade set would cover more, but a building's shadow is
   only legible where the building is, and from 3 km up the city is texture.
   One 4096² map at 1.2 km is 30 cm a texel, sharper than the imagery under it.

   The box is snapped to whole texels in light space; without that the edge
   of every shadow crawls as the aircraft moves. */
const MAP = renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
sky.sun.shadow.mapSize.set(MAP, MAP);
sky.sun.shadow.bias = -0.00004;
const shadowCam = sky.sun.shadow.camera;
const _lightRot = new THREE.Matrix4(), _inv = new THREE.Matrix4();
let shadowsOn = true;

function fitShadow(agl) {
  sky.sun.castShadow = shadowsOn && sky.altitude > 1;
  if (!sky.sun.castShadow) return;
  const half = THREE.MathUtils.clamp(agl * 2.2 + 300, 400, 4000);
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  const c = camera.position.clone().addScaledVector(f, half * 0.55);
  c.y = terrain.heightAt(c.x, c.z);

  // Snap the centre to the texel grid of the light's view.
  _lightRot.lookAt(new THREE.Vector3(), sky.dir.clone().negate(), new THREE.Vector3(0, 1, 0));
  _inv.copy(_lightRot).invert();
  const texel = (2 * half) / MAP;
  const lc = c.clone().applyMatrix4(_inv);
  lc.x = Math.round(lc.x / texel) * texel;
  lc.y = Math.round(lc.y / texel) * texel;
  c.copy(lc.applyMatrix4(_lightRot));

  const D = 6000;
  sky.sun.position.copy(c).addScaledVector(sky.dir, D);
  sky.sun.target.position.copy(c);
  sky.sun.target.updateMatrixWorld();
  shadowCam.left = -half; shadowCam.right = half;
  shadowCam.top = half; shadowCam.bottom = -half;
  shadowCam.near = 10; shadowCam.far = D * 2;
  shadowCam.updateProjectionMatrix();
  sky.sun.shadow.normalBias = texel * 1.2;
}

/* ── Session ──────────────────────────────────────────────────────────── */

let hour = params.has("hour") ? +params.get("hour") : 15.5;
let cityKey = CITIES[params.get("city")] ? params.get("city") : "london";
let spawnAgl = null;

function startCity(key, opts = {}) {
  cityKey = key;
  const c = CITIES[key];
  const lat = opts.lat ?? c.lat, lon = opts.lon ?? c.lon;
  setSession(lat, lon);
  terrain.dispose();
  for (const k of [...buildings.tiles.keys()]) buildings.drop(k);
  spawnAgl = opts.alt ?? 380;
  plane.setPose(0, spawnAgl, 0, opts.hdg ?? c.hdg, opts.pitch ?? -2);
  plane.speed = 70; plane.throttle = 0.25;
  $("city").value = key;
  updateSun();
}

function updateSun() {
  const ll = localToLL(plane.pos.x, plane.pos.z);
  sky.set(ll.lat, ll.lon, hour);
}

/* Re-centre the world under the aircraft every 20 km (see geo.js). */
function maybeRebase() {
  const dx = plane.pos.x, dz = plane.pos.z;
  if (Math.hypot(dx, dz) < 20000) return;
  shiftOrigin(dx, dz);
  plane.pos.x -= dx; plane.pos.z -= dz;
  plane._camPos.x -= dx; plane._camPos.z -= dz;
  terrain.rebase();
  buildings.rebase();
}

/* ── Input ────────────────────────────────────────────────────────────── */

const FLIGHT_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown",
  "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"]);
addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input, select, textarea")) return;
  if (FLIGHT_KEYS.has(e.code)) { plane.keys.add(e.code); e.preventDefault(); }
  if (e.code === "KeyC") setCam(plane.camMode === "chase" ? "cockpit" : "chase");
  if (e.code === "KeyH") document.body.classList.toggle("hud-off");
  if (e.code === "KeyP") plane.paused = !plane.paused;
  if (e.code === "KeyR") { plane.setPose(plane.pos.x, plane.pos.y, plane.pos.z, plane.heading, 0); plane.speed = 70; }
  if (e.code === "BracketLeft") setHour(hour - 0.25);
  if (e.code === "BracketRight") setHour(hour + 0.25);
});
addEventListener("keyup", (e) => plane.keys.delete(e.code));
addEventListener("blur", () => plane.keys.clear());

let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  plane.orbit.yaw -= (e.clientX - drag.x) * 0.006;
  plane.orbit.pitch = THREE.MathUtils.clamp(plane.orbit.pitch + (e.clientY - drag.y) * 0.004, -0.3, 1.3);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", () => { drag = null; });
canvas.addEventListener("dblclick", () => { plane.orbit.yaw = 0; plane.orbit.pitch = 0; });
canvas.addEventListener("wheel", (e) => {
  plane.orbit.dist = THREE.MathUtils.clamp(plane.orbit.dist * Math.exp(e.deltaY * 0.001), 9, 1500);
  e.preventDefault();
}, { passive: false });

function setCam(mode) { plane.camMode = mode; $("cam").value = mode; }
function setHour(h) {
  hour = ((h % 24) + 24) % 24;
  $("hour").value = hour;
  updateSun();
}

for (const [k, c] of Object.entries(CITIES)) {
  const o = document.createElement("option"); o.value = k; o.textContent = c.name; $("city").appendChild(o);
}
$("city").addEventListener("change", (e) => startCity(e.target.value));
$("hour").addEventListener("input", (e) => setHour(+e.target.value));
$("cam").addEventListener("change", (e) => setCam(e.target.value));
$("bldg").addEventListener("change", (e) => buildings.setEnabled(e.target.checked));
$("shadows").addEventListener("change", (e) => { shadowsOn = e.target.checked; });
$("detail").addEventListener("change", (e) => terrain.setDetail(+e.target.value));
$("help-btn").addEventListener("click", () => document.body.classList.toggle("help-open"));

$("credits").textContent = [IMAGERY.credit, ELEVATION.credit, BUILDINGS.credit].join(" · ");

/* ── Loop ─────────────────────────────────────────────────────────────── */

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
let hudT = 0, sunT = 0, fps = 60, lastSettled = 0;
const ground = (x, z) => terrain.heightAt(x, z);

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

  if (spawnAgl != null && terrain.detailAt(plane.pos.x, plane.pos.z) >= 13) {
    plane.pos.y = ground(plane.pos.x, plane.pos.z) + spawnAgl;
    plane._camInit = false;
    spawnAgl = null;
  }
  plane.update(dt, ground);
  maybeRebase();
  plane.updateCamera(camera, dt);
  camera.updateMatrixWorld();

  const camAgl = camera.position.y - ground(camera.position.x, camera.position.z);
  terrain.stats.drawn = 0; terrain.stats.maxZ = 0;
  terrain.update(camera.position, camera);
  buildings.update(camera.position, camAgl);

  if ((sunT += dt) > 1) { sunT = 0; updateSun(); }
  sky.follow(camera, camera.position.y);
  fitShadow(Math.max(camAgl, 0));

  renderer.render(scene, camera);

  if ((hudT += dt) > 0.12) { hudT = 0; hud(); }
  requestAnimationFrame(tick);
}

function hud() {
  const ll = localToLL(plane.pos.x, plane.pos.z);
  $("h-alt").textContent = Math.round(plane.pos.y).toLocaleString() + " m";
  $("h-agl").textContent = Math.round(plane.agl).toLocaleString() + " m";
  $("h-spd").textContent = Math.round(plane.speed * 1.94384) + " kt";
  $("h-hdg").textContent = String(Math.round(plane.heading) % 360).padStart(3, "0") + "°";
  $("h-pos").textContent = ll.lat.toFixed(4) + "°, " + ll.lon.toFixed(4) + "°";
  $("h-thr").style.width = (plane.throttle * 100).toFixed(0) + "%";
  const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
  $("h-time").textContent = String(hh).padStart(2, "0") + ":" + String(mm % 60).padStart(2, "0")
    + " solar · sun " + sky.altitude.toFixed(0) + "°";
  const info = renderer.info.render;
  $("h-stats").textContent = `${fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1e6).toFixed(2)} M tris · `
    + `${terrain.stats.drawn} chunks · ${buildings.stats.tiles} bldg tiles (${buildings.stats.buildings.toLocaleString()}) · `
    + `${tilesPending() + buildings.pending()} loading`;
  $("h-paused").hidden = !plane.paused;
}

/* ── Hooks: for the screenshot harness and the console ────────────────── */

window.__earthFlight = {
  THREE, scene, camera, renderer, terrain, buildings, sky, plane, frame,
  /** alt is height above ground. */
  setPose({ lat, lon, alt = 300, heading = 0, pitch = 0, city } = {}) {
    if (city && city !== cityKey) startCity(city, { lat, lon, alt, hdg: heading, pitch });
    const p = lat != null ? llToLocal(lat, lon) : { x: plane.pos.x, z: plane.pos.z };
    plane.setPose(p.x, ground(p.x, p.z) + alt, p.z, heading, pitch);
    spawnAgl = alt;
  },
  setHour, setCam,
  pause(on = true) { plane.paused = on; },
  orbit(o) { Object.assign(plane.orbit, o); plane._camInit = false; },
  /** Resolves once nothing has been loading for `quiet` ms (or at `timeout`). */
  idle(quiet = 1500, timeout = 90000) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const busy = tilesPending() + buildings.pending();
        const now = performance.now();
        if (busy) lastSettled = now;
        if ((!busy && now - lastSettled > quiet) || now - t0 > timeout) {
          resolve({ busy, ms: Math.round(now - t0), ...this.stats() });
        } else setTimeout(check, 200);
      };
      lastSettled = performance.now();
      check();
    });
  },
  stats() {
    const i = renderer.info;
    return {
      fps: Math.round(fps), calls: i.render.calls, triangles: i.render.triangles,
      textures: i.memory.textures, geometries: i.memory.geometries,
      chunks: terrain.stats.drawn, deepestImageryZoom: terrain.stats.maxZ, buildingTiles: buildings.stats.tiles,
      buildings: buildings.stats.buildings, buildingVerts: buildings.stats.verts,
      tiles: { ...tileStats }, sunAlt: +sky.altitude.toFixed(1), sunAz: +sky.azimuth.toFixed(1),
    };
  },
};

startCity(cityKey, {
  alt: params.has("alt") ? +params.get("alt") : undefined,
  hdg: params.has("hdg") ? +params.get("hdg") : undefined,
  pitch: params.has("pitch") ? +params.get("pitch") : undefined,
  lat: params.has("lat") ? +params.get("lat") : undefined,
  lon: params.has("lon") ? +params.get("lon") : undefined,
});
setHour(hour);
// Arrived from GeoHUB's Explorer (or any link with a place): the city menu
// says so rather than claiming the default city, and a way back is shown.
if (params.has("lat") && params.has("lon")) {
  const o = document.createElement("option");
  o.value = ""; o.textContent = "This place"; o.disabled = true;
  $("city").prepend(o);
  $("city").value = "";
}
if (params.get("from") === "geohub") $("back-geohub").hidden = false;
if (params.get("cam")) setCam(params.get("cam"));
if (params.has("pause")) plane.paused = true;
requestAnimationFrame(tick);
