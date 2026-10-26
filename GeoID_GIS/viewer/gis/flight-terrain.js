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
//     Terrarium, ~20-40 m posts near the aircraft), THE SEA HELD FLAT (below), times the
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

import { waterMasks } from "./water-mask.js?v=20261025-794b342";

const UNITS_PER_M = 3.2 / 6371000;
const ENSURE_EVERY_MS = 1500;

/*
 * THE SEA IS FLAT (reported over Reykjavik as black spikes, "spike errors in
 * mapping again"). Not a decode fault this time: the source tiles themselves
 * carry it. North of 60 deg Mapzen's Terrarium is ArcticDEM, a surface model
 * on the ellipsoid, and over open water it is noise -- measured in Faxafloi
 * and Skerjafjordur, blobs of 430-520 m a few hundred metres across, at every
 * zoom from 12 to 15 -- while the honest sea beside them reads the local
 * geoid offset (~65 m in Iceland, ~0 elsewhere). A despike cannot tell a
 * 400 m blob from a sea cliff; the coastline can.
 *
 * So round the aircraft the GeoHUB's own ocean polygons (water-mask.js: OSM
 * water polygons, coastline-exact) are burnt onto a grid, the LOCAL SEA LEVEL
 * is the median of the DEM over those sea cells (the blobs are a small
 * minority), and a sea cell is never drawn higher than that level plus 3 m.
 * Capped at the local level, not at zero, so Iceland's coasts meet their sea
 * without a 65 m step. Flight only, like everything here.
 */
const SEA_HALF_KM = 25, SEA_GRID = 512, SEA_MOVE_KM = 8, SEA_SLACK_M = 3;
let sea = null;          // { box, lat, lon, ocean, level }
let seaPending = false;

/** The median of the finite values, or null with too few to say. */
export function seaLevelOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 20) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** A sea cell is drawn no higher than the local sea level (+ slack). */
export function capAtSea(h, inSea, level, slack = SEA_SLACK_M) {
  return inSea && Number.isFinite(level) ? Math.min(h, level + slack) : h;
}

function inSea(lat, lon) {
  if (!sea) return false;
  const { box: b } = sea;
  if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return false;
  const x = Math.min(SEA_GRID - 1, Math.floor((lon - b.west) / (b.east - b.west) * SEA_GRID));
  const y = Math.min(SEA_GRID - 1, Math.floor((b.north - lat) / (b.north - b.south) * SEA_GRID));
  return sea.ocean[y * SEA_GRID + x] === 1;
}

function measureSeaLevel() {
  if (!sea) return;
  const dem = window.GeoIDDem, b = sea.box, samples = [];
  for (let y = 3; y < SEA_GRID; y += 9) {
    for (let x = 3; x < SEA_GRID; x += 9) {
      if (sea.ocean[y * SEA_GRID + x] !== 1) continue;
      const lat = b.north - (y + 0.5) / SEA_GRID * (b.north - b.south);
      const lon = b.west + (x + 0.5) / SEA_GRID * (b.east - b.west);
      samples.push(dem?.heightAt?.(lat, lon));
    }
  }
  sea.level = seaLevelOf(samples);
}

async function refreshSea(ship) {
  if (seaPending) return;
  const km = sea ? Math.hypot((ship.lat - sea.lat) * 111.32, (ship.lon - sea.lon) * 111.32 * Math.cos(ship.lat * Math.PI / 180)) : Infinity;
  if (km < SEA_MOVE_KM) return;
  seaPending = true;
  try {
    const b = box(ship.lat, ship.lon, SEA_HALF_KM);
    const masks = await waterMasks(b, SEA_GRID, SEA_GRID);
    sea = { box: b, lat: ship.lat, lon: ship.lon, ocean: masks.ocean, level: null };
    measureSeaLevel();
    version += 1;
    window.dispatchEvent(new CustomEvent("geoid:flight-terrain-changed", { detail: { vex, version } }));
  } catch (_e) {
    // No mask is the old behaviour, not a fault: the DEM is drawn as it is.
  } finally {
    seaPending = false;
  }
}

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
  if (!Number.isFinite(h)) return null;
  return Math.max(0, sea ? capAtSea(h, inSea(lat, w), sea.level) : h);
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
  refreshSea(ship);
  await Promise.allSettled(asks);
  // The sampler's revision, not its tile count: a full cache swaps tiles at a
  // constant count, and the heights under everything changed unannounced.
  const st = dem.state?.() ?? dem.state ?? {};
  const held = Number.isFinite(st.revision) ? st.revision
    : (typeof st.tiles === "number" ? st.tiles : (Array.isArray(st.tiles) ? st.tiles.length : -1));
  if (held !== lastHeld) {
    lastHeld = held;
    measureSeaLevel();   // new heights: the sea's own median may have moved
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
  sea = null;
  version += 1;
  window.dispatchEvent(new CustomEvent("geoid:flight-terrain-changed", { detail: { vex, version } }));
}

if (typeof window !== "undefined") {
  window.GeoIDFlightTerrain = { active, groundMetres, heightUnits, getVex, setVex, getVersion, primeLaunchSite };
}
