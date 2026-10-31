// Earth Flight's locator map: where on Earth the aircraft is.
//
// The frontier game keeps a north-up corner map with the vehicle at its centre
// and the track behind it (frontier_pioneer/game/navmap.js); flying a planet,
// the same question needs the same answer, at every scale from the field
// below to the whole globe. So this is a north-up web-Mercator map drawn from
// the basemap the globe is showing (or the default tile service,
// OpenStreetMap, when the basemap is not a tile service): the aircraft an
// arrow at the centre turned to its heading,
// the track flown so far, a scale bar and the position, and - / + to zoom
// from a few kilometres out to the whole Earth (zoom 1); it folds to its
// title bar and back.
//
// It sits in the bottom-right corner, directly above the scale bar (owner,
// 2026-10-24), re-measured as the bar resizes. Flight only: built on launch, taken
// down on Exit. Redrawn four times a second -- a map, not an instrument.

import { TILE_SOURCES, DEFAULT_SOURCE, tileUrl } from "./tile-sources.js?v=20261031-7fefdf8";
import { tileBasemapSource } from "./basemap-drape.js?v=20261031-7fefdf8";

const SIZE = 184;                 // CSS px, square
const Z_MIN = 1, Z_MAX = 13;
const TRACK_MAX = 3000;
const TRACK_STEP_M = 150;
const R_EARTH = 6378137;
const FOLD_KEY = "geoid-gis:flight-map-folded";

let box = null, canvas = null, ctx = null, posLine = null;
let zoom = 9;
let timer = null;
const track = [];
const tiles = new Map();          // url -> HTMLImageElement | "missing" | "loading"

const clampLat = (lat) => Math.max(-85.05, Math.min(85.05, lat));
const worldPx = (z) => 256 * 2 ** z;
function project(lat, lon, z) {
  const w = worldPx(z), s = Math.sin(clampLat(lat) * Math.PI / 180);
  return { x: ((lon + 180) / 360) * w, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * w };
}
function metres(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function source() {
  const s = tileBasemapSource?.();
  return s && TILE_SOURCES[s] ? s : DEFAULT_SOURCE;
}

function tile(src, z, x, y) {
  const n = 2 ** z;
  const url = tileUrl(src, z, ((x % n) + n) % n, y);
  const have = tiles.get(url);
  if (have instanceof HTMLImageElement) return have;
  if (have) return null;
  tiles.set(url, "loading");
  const img = new Image();
  img.onload = () => { tiles.set(url, img); draw(); };
  img.onerror = () => tiles.set(url, "missing");
  img.src = url;
  if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
  return null;
}

function draw() {
  const fs = window.__flightSim;
  const ship = fs?.shipLatLon;
  if (!ctx || !ship) return;
  const dpr = canvas.width / SIZE;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const src = source();
  const maxZ = Math.min(zoom, TILE_SOURCES[src]?.maxZoom ?? 18);
  const c = project(ship.lat, ship.lon, zoom);
  const x0 = c.x - SIZE / 2, y0 = c.y - SIZE / 2;
  // Tiles at the map's zoom, or the source's deepest, scaled up.
  const scale = 2 ** (zoom - maxZ), tpx = 256 * scale;
  const n = 2 ** maxZ;
  for (let ty = Math.floor(y0 / tpx); ty * tpx < y0 + SIZE; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / tpx); tx * tpx < x0 + SIZE; tx++) {
      const img = tile(src, maxZ, tx, ty);
      if (img) ctx.drawImage(img, tx * tpx - x0, ty * tpx - y0, tpx, tpx);
    }
  }
  // The track.
  if (track.length > 1) {
    ctx.beginPath();
    track.forEach((p, i) => {
      const q = project(p.lat, p.lon, zoom);
      let dx = q.x - c.x;
      const w = worldPx(zoom);
      if (dx > w / 2) dx -= w; else if (dx < -w / 2) dx += w;
      const X = SIZE / 2 + dx, Y = SIZE / 2 + (q.y - c.y);
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    });
    ctx.lineTo(SIZE / 2, SIZE / 2);
    ctx.strokeStyle = "rgba(255, 214, 92, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The aircraft: an arrow at the centre, turned to the heading.
  const h = (Number(fs.headingDeg) || 0) * Math.PI / 180;
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate(h);
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
  ctx.fillStyle = "#ffd65c";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.lineWidth = 1.4;
  ctx.fill(); ctx.stroke();
  ctx.restore();
  // North, and the scale bar.
  ctx.font = '600 10px "Exo 2", "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd65c";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.lineWidth = 3;
  ctx.strokeText("N", SIZE / 2, 12); ctx.fillText("N", SIZE / 2, 12);
  const mPerPx = (2 * Math.PI * R_EARTH * Math.cos(clampLat(ship.lat) * Math.PI / 180)) / worldPx(zoom);
  const want = mPerPx * 60;
  const nice = [1, 2, 5].flatMap((k) => [k, k * 10, k * 100, k * 1000, k * 1e4, k * 1e5, k * 1e6]).sort((a, b) => a - b)
    .filter((v) => v <= want).pop() || want;
  const barPx = nice / mPerPx;
  ctx.fillStyle = "rgba(8, 11, 18, 0.7)";
  ctx.fillRect(6, SIZE - 20, barPx + 8, 15);
  ctx.fillStyle = "#eef3fb";
  ctx.fillRect(10, SIZE - 9, barPx, 2);
  ctx.textAlign = "left";
  ctx.font = '600 9px "Exo 2", "Segoe UI", sans-serif';
  ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 10, SIZE - 11);
  if (posLine) {
    const ns = ship.lat >= 0 ? "N" : "S", ew = ship.lon >= 0 ? "E" : "W";
    posLine.textContent = `${Math.abs(ship.lat).toFixed(3)}°${ns}  ${Math.abs(ship.lon).toFixed(3)}°${ew}`;
  }
}

function sampleTrack() {
  const ship = window.__flightSim?.shipLatLon;
  if (!ship) return;
  const last = track[track.length - 1];
  if (!last || metres(last, ship) >= TRACK_STEP_M) {
    track.push({ lat: ship.lat, lon: ship.lon });
    if (track.length > TRACK_MAX) track.shift();
  }
}

function build() {
  box = document.createElement("div");
  box.id = "fs-locator-map";
  box.innerHTML = `
    <div class="fs-map-head">
      <span class="fs-map-title">Map</span>
      <button type="button" class="fs-map-btn" data-step="-1" aria-label="Zoom the map out">−</button>
      <button type="button" class="fs-map-btn" data-step="1" aria-label="Zoom the map in">+</button>
      <button type="button" class="fs-map-btn fs-map-fold" aria-expanded="true" aria-label="Collapse the map">▾</button>
    </div>
    <canvas width="${SIZE * 2}" height="${SIZE * 2}" aria-label="Map of the aircraft's position"></canvas>
    <div class="fs-map-pos"></div>`;
  canvas = box.querySelector("canvas");
  ctx = canvas.getContext("2d");
  posLine = box.querySelector(".fs-map-pos");
  // Collapse to the title bar and back, remembered for this browser.
  const fold = box.querySelector(".fs-map-fold");
  const setFolded = (folded) => {
    box.classList.toggle("is-collapsed", folded);
    fold.textContent = folded ? "▴" : "▾";
    fold.setAttribute("aria-expanded", String(!folded));
    fold.setAttribute("aria-label", folded ? "Expand the map" : "Collapse the map");
    try { localStorage.setItem(FOLD_KEY, folded ? "1" : "0"); } catch (e) { /* private mode */ }
  };
  let startFolded = false;
  try { startFolded = localStorage.getItem(FOLD_KEY) === "1"; } catch (e) { /* private mode */ }
  setFolded(startFolded);
  fold.addEventListener("click", () => setFolded(!box.classList.contains("is-collapsed")));
  box.querySelectorAll(".fs-map-btn[data-step]").forEach((b) => b.addEventListener("click", () => {
    zoom = Math.max(Z_MIN, Math.min(Z_MAX, zoom + Number(b.dataset.step)));
    draw();
  }));
  if (!document.getElementById("fs-locator-map-style")) {
    const st = document.createElement("style");
    st.id = "fs-locator-map-style";
    st.textContent = `
#fs-locator-map {
  position: fixed;
  right: var(--fs-map-right, 1rem);
  bottom: var(--fs-map-bottom, 3.4rem);
  z-index: 13;
  width: ${SIZE}px;
  background: rgba(8, 11, 18, 0.78);
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 214, 92), 0.42);
  border-radius: 0.3rem;
  backdrop-filter: blur(4px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  padding: 0.3rem;
  font-family: "Exo 2", "Segoe UI", sans-serif;
  pointer-events: auto;
}
#fs-locator-map canvas { display: block; width: 100%; height: auto; border-radius: 0.2rem; }
#fs-locator-map.is-collapsed canvas, #fs-locator-map.is-collapsed .fs-map-pos,
#fs-locator-map.is-collapsed .fs-map-btn[data-step] { display: none; }
#fs-locator-map.is-collapsed .fs-map-head { margin: 0; }
#fs-locator-map .fs-map-head { display: flex; align-items: center; gap: 0.3rem; margin: 0 0 0.25rem; }
#fs-locator-map .fs-map-title {
  flex: 1; font-size: 0.56rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--nav-accent, #ffd65c);
}
#fs-locator-map .fs-map-btn {
  width: 1.15rem; height: 1.15rem; padding: 0; line-height: 1;
  font: 600 0.78rem "Exo 2", "Segoe UI", sans-serif;
  color: var(--nav-accent, #ffd65c);
  background: rgba(var(--nav-accent-rgb, 255, 214, 92), 0.12);
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 214, 92), 0.5);
  border-radius: 0.2rem; cursor: pointer;
}
#fs-locator-map .fs-map-btn:hover { background: rgba(var(--nav-accent-rgb, 255, 214, 92), 0.28); }
#fs-locator-map .fs-map-pos {
  margin-top: 0.25rem; font-size: 0.62rem; font-weight: 600; color: #eef3fb;
  font-variant-numeric: tabular-nums; letter-spacing: 0.04em; text-align: center;
}`;
    document.head.appendChild(st);
  }
}

/** Above the scale bar, right-aligned with it. */
function place() {
  const bar = document.getElementById("scale-readout");
  const r = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
  if (!box) return;
  if (r && r.width) {
    box.style.setProperty("--fs-map-bottom", `${Math.round(window.innerHeight - r.top + 8)}px`);
    box.style.setProperty("--fs-map-right", `${Math.round(window.innerWidth - r.right)}px`);
  }
}

/** Show the map (idempotent): bottom right, above the scale bar. */
export function showFlightMap() {
  if (!box) build();
  if (box.parentElement !== document.body) document.body.appendChild(box);
  track.length = 0;
  // Start at a scale that suits the altitude: ~25 km across low down.
  const altKm = (Number(window.__flightSim?.shipAltUnits) || 0) * 6371 / 3.2;
  zoom = altKm > 200 ? 5 : altKm > 30 ? 7 : altKm > 6 ? 8 : 9;
  clearInterval(timer);
  timer = setInterval(() => { sampleTrack(); place(); draw(); }, 250);
  sampleTrack();
  place();
  draw();
}

/** Take it down on Exit. */
export function hideFlightMap() {
  clearInterval(timer);
  timer = null;
  box?.remove();
}
