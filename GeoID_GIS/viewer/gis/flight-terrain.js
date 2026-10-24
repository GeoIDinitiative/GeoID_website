// Earth Flight's terrain: real ground under the aircraft, from the streamed
// elevation, at the Vertical scale.
//
// The globe's own relief is a ~10 km elevation texture, exaggerated for a
// planet seen from orbit and deliberately eased to NOTHING below ~300 km so the
// camera can come down to the ground (earth-viewer.js, getEffectiveTerrainRelief).
// Flying, that left the ground flat and the Vertical scale slider multiplying
// zero (reported). The globe's relief cannot simply be left on near the ground:
// that texture is normalised from the deepest trench, so even true scale lifts
// sea-level ground ~11 km off the sphere every other layer is drawn on.
//
// So flight has its own terrain, kept beside the globe rather than in it:
//
//   * heights are metres from the streamed DEM (dem-tiles.js / dem-stream.js,
//     Terrarium, ~20-40 m posts near the aircraft), SEA HELD AT ZERO, times the
//     Vertical scale slider (1 = true scale);
//   * this module keeps the DEM loaded round the aircraft and ahead of it;
//   * `version` moves whenever new heights arrive or the scale changes, and
//     everything built on the terrain (the imagery patches, the building
//     tiles) rebuilds against it;
//   * the flight sim (altitude, ground readout, collision), the event markers
//     and the place labels read heights from here, so they stand on the hills.
//
// Only while flying: `active()` is false otherwise, and every consumer then
// behaves exactly as before.

const UNITS_PER_M = 3.2 / 6371000;
const ENSURE_EVERY_MS = 1500;

let vex = 1;
let version = 0;
let timer = null;
let lastHeld = -1;

/** Is flight terrain on (flying, with streamed elevation available)? */
export function active() {
  return Boolean(window.__flightSim?.active && window.GeoIDDem?.heightAt);
}

/** Ground height in metres (sea level 0), NOT exaggerated; null where unknown. */
export function groundMetres(lat, lon) {
  const w = lon >= -180 && lon < 180 ? lon : ((lon + 540) % 360) - 180;   // east-positive 0-360 too
  const h = window.GeoIDDem?.heightAt?.(lat, w);
  return Number.isFinite(h) ? Math.max(0, h) : null;
}

/** Drawn height in scene units: ground metres x the Vertical scale. */
export function heightUnits(lat, lon) {
  if (!active()) return 0;
  const m = groundMetres(lat, lon);
  return m == null ? 0 : m * vex * UNITS_PER_M;
}

export function getVex() { return vex; }
export function getVersion() { return version; }

/** Set the Vertical scale (1 = true scale); bumps the version. */
export function setVex(v) {
  const n = Math.max(1, Math.min(10, Number(v) || 1));
  if (n === vex) return;
  vex = n;
  version += 1;
  window.dispatchEvent(new CustomEvent("geoid:flight-terrain-changed", { detail: { vex, version } }));
}

function box(lat, lon, halfKm) {
  const dLat = halfKm / 111.32, dLon = halfKm / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  return { north: Math.min(85, lat + dLat), south: Math.max(-85, lat - dLat), east: lon + dLon, west: lon - dLon };
}

/** Keep the DEM loaded where the aircraft is and where it is going. */
async function ensureAround() {
  const f = window.__flightSim, dem = window.GeoIDDem;
  const ship = f?.active ? f.shipLatLon : null;
  if (!ship || !dem?.ensure) return;
  const altKm = (Number(f.shipAltUnits) || 0) / UNITS_PER_M / 1000;
  const h = (Number(f.headingDeg) || 0) * Math.PI / 180;
  const cosLat = Math.max(0.05, Math.cos(ship.lat * Math.PI / 180));
  const at = (km) => ({ lat: ship.lat + km * Math.cos(h) / 111.32, lon: ship.lon + km * Math.sin(h) / (111.32 * cosLat) });
  const near = at(3), mid = at(15);
  // Fine where the detail is (the buildings and the close imagery), coarser
  // further out; the sampler answers from the finest level it holds.
  const asks = [
    dem.ensure(box(near.lat, near.lon, 7), { maxTiles: 12 }),
    dem.ensure(box(mid.lat, mid.lon, 30 + 6 * altKm), { maxTiles: 12 }),
  ];
  await Promise.allSettled(asks);
  const held = dem.state?.()?.tiles ?? dem.state?.tiles ?? null;
  const count = typeof held === "number" ? held : (Array.isArray(held) ? held.length : -1);
  if (count !== lastHeld) {
    lastHeld = count;
    version += 1;
    window.dispatchEvent(new CustomEvent("geoid:flight-terrain-changed", { detail: { vex, version } }));
  }
}

/**
 * PRE-FLIGHT: fine elevation round the launch site before Launch is pressed.
 * The launch altitude is measured above the ground (the sim reads this
 * terrain at spawn), and with only the coarse view tiles loaded a "300 m"
 * launch came out ~140 m above the real ground. The site is where the
 * pre-flight camera looks straight down.
 */
let primeTimer = null;
function primeSite() {
  const viewer = window.GeoIDViewer, dem = window.GeoIDDem;
  if (!document.body.classList.contains("fs-preflight")) { clearInterval(primeTimer); primeTimer = null; return; }
  if (!viewer?.camera || !viewer.globe || !dem?.ensure) return;
  const local = viewer.globe.worldToLocal(viewer.camera.position.clone());
  local.set(-local.x, local.y, -local.z);
  const r = local.length() || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, local.y / r))) * 180 / Math.PI;
  const lon = Math.atan2(local.z, -local.x) * 180 / Math.PI;
  dem.ensure(box(lat, lon, 4), { maxTiles: 6 }).catch(() => {});
}
export function primeLaunchSite() {
  if (primeTimer) return;
  primeSite();
  primeTimer = setInterval(primeSite, 1200);
}

/** Start keeping the terrain current (idempotent). */
export function startFlightTerrain() {
  if (timer) return;
  version += 1;
  ensureAround();
  timer = setInterval(ensureAround, ENSURE_EVERY_MS);
}

/** Stop; consumers fall back to the flat globe. */
export function stopFlightTerrain() {
  clearInterval(timer);
  timer = null;
  version += 1;
  window.dispatchEvent(new CustomEvent("geoid:flight-terrain-changed", { detail: { vex, version } }));
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTerrain = { active, groundMetres, heightUnits, getVex, setVex, getVersion, primeLaunchSite };
}
