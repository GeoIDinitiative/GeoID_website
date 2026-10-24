// Earth Flight's place labels: GUI cards anchored to their place on the
// ground.
//
// The globe's place labels are sprites sized and thinned for a planet seen
// from orbit; flying a few kilometres up, the Location labels switch put
// nothing on screen at all. In flight they are drawn the way the geology and
// event pop-ups are: a chip in the style of the Mars flight sim's labels,
// held above its place by a leader line that ends in a dot ON the surface, at
// the place's true 3D point -- so the chip says what, and the dot
// says exactly where, wherever the aircraft looks from.
//
// They follow the Mars viewer's flight-mode labels (planet_explorer/mars/
// viewer/label-layer.js, its close-range "mosaic" layout), as the owner asked:
//
//   * HORIZON-AWARE: nothing beyond the horizon (the same p . c >= R^2 test the
//     event markers use), and a label fades out over the last degree and a
//     half before its place drops behind the limb, rather than popping;
//   * FADE AND SHRINK WITH DISTANCE: full strength in the near third of the
//     range, fading to nothing at its end; the range is tied to the horizon
//     (1.1x its distance, 20-250 km), so it grows as the aircraft climbs;
//   * SIGNIFICANCE: the size ramp by the place's tier (item.lod 1-5) is Mars's
//     own (LOD_MOSAIC_TIER), and a more significant place wins a crowded spot;
//   * NO OVERLAPS: Mars's "pure occlusion" -- a card that would overlap one
//     already placed is hidden, not shuffled, so nothing jumps frame to frame;
//   * only while flying with Location labels ticked; at most 16 cards;
//     repositioned every frame; a click opens the place's ordinary pop-up.

const MAX_KM = 250;
const MIN_KM = 20;
const MAX_CARDS = 16;
const LIFT_PX = 30;
const KM_PER_UNIT = 6371 / 3.2;
const LIFT_UNITS = 25 / 6371000 * 3.2;
const LOD_MOSAIC_TIER = [1.0, 1.0, 0.88, 0.77, 0.67, 0.58];   // label-layer.js
const HORIZON_FADE_DEG = 1.5;
// Mars's chip: 15 px Orbitron on a 34 px pill, never under ~59% (its 20 px floor).
const BASE_PX = 15;
const fontPx = (scale) => Math.max(9, BASE_PX * scale);
const tier = (lod) => { const n = Number(lod); return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 3; };

let layer = null;
let frame = null;
const cards = new Map();          // name|lat|lon -> element

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement("div");
  layer.id = "fs-place-labels";
  if (!document.getElementById("fs-place-labels-style")) {
    const st = document.createElement("style");
    st.id = "fs-place-labels-style";
    st.textContent = `
/* Just above the 3D canvas and UNDER all of GeoHUB's chrome (the nav is 10,
   the Workspace 11, the HUD 30): a label belongs to the view, so a panel
   covers it as it covers the ground. At 11 it was drawn over the nav. */
#fs-place-labels { position: fixed; inset: 0; pointer-events: none; z-index: 1; }
.fs-place { position: absolute; left: 0; top: 0; will-change: transform; transition: opacity 0.25s linear; }
/* The Mars flight sim's chip (planet_explorer/mars/viewer/label-layer.js,
   makeLabelTexture), drawn in CSS: a pill with a dark glass fill, a thin
   outline and a solid accent bar in its palette, the name in Orbitron. */
.fs-place-card {
  position: absolute; left: 0; bottom: ${LIFT_PX}px; transform: translateX(-50%);
  white-space: nowrap; pointer-events: auto; cursor: pointer;
  display: flex; align-items: center; gap: 0.42em;
  min-width: 4.6em; height: 2.27em; box-sizing: border-box;
  padding: 0 0.95em 0 0.5em;
  background: var(--chip-bg);
  border: 1.6px solid var(--chip-stroke);
  border-radius: 1em;
  font: 600 1em/1 Orbitron, "Exo 2", Aldrich, "Trebuchet MS", sans-serif;
  color: var(--chip-title);
  letter-spacing: 0.02em;
}
.fs-place-card::before {
  content: ""; flex: 0 0 auto; width: 0.4em; align-self: stretch; margin: 0.27em 0 0.27em 0.4em;
  background: var(--chip-accent); border-radius: 1px;
}
.fs-place-card:hover { filter: brightness(1.25); }
.fs-place-line {
  position: absolute; left: -0.5px; bottom: 0; width: 1.2px; height: ${LIFT_PX}px;
  background: var(--chip-accent); opacity: 0.85;
}
.fs-place-dot {
  position: absolute; left: -3px; bottom: -3px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--chip-accent); box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.75);
}`;
    document.head.appendChild(st);
  }
  document.body.appendChild(layer);
  return layer;
}

// The Mars chip palettes, by the label's class; the default follows the
// theme's chip ink, as Mars's does (chipInk).
const PALETTES = {
  volcanic: ["rgba(28, 10, 10, 0.72)", "rgba(255, 122, 96, 0.56)", "rgba(255, 88, 69, 0.92)", "rgba(255, 234, 230, 0.96)"],
  mission: ["rgba(10, 22, 14, 0.74)", "rgba(128, 229, 160, 0.42)", "rgba(98, 222, 132, 0.94)", "rgba(237, 255, 242, 0.96)"],
  habitation: ["rgba(8, 20, 11, 0.74)", "rgba(112, 232, 146, 0.46)", "rgba(92, 222, 118, 0.96)", "rgba(234, 255, 238, 0.96)"],
  crater: ["rgba(28, 8, 18, 0.74)", "rgba(255, 95, 170, 0.50)", "rgba(255, 95, 170, 0.92)", "rgba(255, 228, 242, 0.96)"],
  landing: ["rgba(22, 20, 0, 0.78)", "rgba(255, 229, 0, 0.58)", "rgba(255, 229, 0, 0.96)", "rgba(255, 252, 200, 0.96)"],
  tectonic: ["rgba(18, 10, 4, 0.76)", "rgba(184, 115, 51, 0.50)", "rgba(184, 115, 51, 0.92)", "rgba(255, 235, 210, 0.96)"],
  fluvial: ["rgba(4, 10, 26, 0.78)", "rgba(26, 95, 191, 0.56)", "rgba(26, 95, 191, 0.92)", "rgba(204, 220, 255, 0.96)"],
};
function chipInk(alpha) {
  const ink = window.GeoIDTheme?.token?.("--skin-chip", "#3aeee8") || "#3aeee8";
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(ink).trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : `rgba(58, 214, 208, ${alpha})`;
}
function paletteFor(item) {
  const p = PALETTES[item.theme] || PALETTES[item.category];
  return p || ["rgba(9, 14, 24, 0.62)", chipInk(0.28), chipInk(0.92), "rgba(242, 247, 250, 0.94)"];
}

function cardFor(item) {
  const key = `${item.name}|${item.lat}|${item.lon}`;
  let el = cards.get(key);
  if (el) return el;
  el = document.createElement("div");
  el.className = "fs-place";
  const [bg, stroke, accent, title] = paletteFor(item);
  el.style.setProperty("--chip-bg", bg);
  el.style.setProperty("--chip-stroke", stroke);
  el.style.setProperty("--chip-accent", accent);
  el.style.setProperty("--chip-title", title);
  const card = document.createElement("div");
  card.className = "fs-place-card";
  // As Mars: the name alone, parentheticals stripped.
  card.textContent = String(item.name).replace(/\s*\([^)]*\)\s*/g, " ").trim();
  card.addEventListener("click", () => window.GeoIDViewer?.openPlace?.(item));
  el.append(card, Object.assign(document.createElement("div"), { className: "fs-place-line" }),
    Object.assign(document.createElement("div"), { className: "fs-place-dot" }));
  cards.set(key, el);
  return el;
}

function step() {
  frame = requestAnimationFrame(step);
  const viewer = window.GeoIDViewer;
  const flying = !!window.__flightSim?.active;
  const items = flying ? viewer?.getPlaceLabels?.() || [] : [];
  if (!items.length || !viewer?.camera || !viewer.globe || !viewer.surfacePoint) {
    if (layer) layer.replaceChildren();
    return;
  }
  ensureLayer();
  const cam = viewer.camera;
  const canvas = viewer.renderer?.domElement;
  const rect = canvas?.getBoundingClientRect();
  if (!rect?.width) return;
  const V = cam.position.constructor;
  const centre = viewer.globe.getWorldPosition(new V());
  const camRel = cam.position.clone().sub(centre);
  const R = viewer.GLOBE_RADIUS || 3.2;
  const camAltKm = (camRel.length() - R) * KM_PER_UNIT;
  const range = Math.max(MIN_KM, Math.min(MAX_KM, 1.1 * Math.sqrt(2 * 6371 * Math.max(0, camAltKm))));
  const up = camRel.clone().normalize();
  const shown = [];
  for (const item of items) {
    const base = viewer.surfacePoint(item.lat, item.lon, LIFT_UNITS);
    if (!base) continue;
    // surfacePoint is in the globe's baseline frame; the mesh sits half a turn
    // round inside its group, so its local frame is (-x, y, -z) of that.
    // Without the flip, London showed the Aleutians' volcanoes.
    const world = viewer.globe.localToWorld(new V(-base.x, base.y, -base.z));
    const rel = world.clone().sub(centre);
    if (rel.dot(camRel) < R * R) continue;                         // beyond the horizon
    const km = world.distanceTo(cam.position) * KM_PER_UNIT;
    if (km > range) continue;
    const n = world.clone().project(cam);
    if (n.z > 1 || Math.abs(n.x) > 1.05 || Math.abs(n.y) > 1.05) continue;
    // How far above the horizon the place is seen: the angle between the line
    // of sight and the horizon's dip from this height.
    const sight = world.clone().sub(cam.position).normalize();
    const dip = Math.acos(Math.min(1, R / camRel.length()));        // horizon dip, radians
    const below = -Math.asin(Math.max(-1, Math.min(1, sight.dot(up))));   // depression of the place
    const marginDeg = (below - dip) * 180 / Math.PI;                // > 0: seen above the horizon line
    const horizonFade = Math.max(0, Math.min(1, marginDeg / HORIZON_FADE_DEG));
    const t = km / range;
    const distFade = t < 0.33 ? 1 : Math.max(0, 1 - (t - 0.33) / 0.67);
    const opacity = horizonFade * distFade;
    if (opacity < 0.04) continue;
    const lod = tier(item.lod);
    const scale = LOD_MOSAIC_TIER[lod] * (1 - 0.28 * t);
    shown.push({ item, km, lod, opacity, scale, x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height });
  }
  // Significance first, then nearness: a landmark wins a crowded spot.
  shown.sort((a, b) => (a.lod - b.lod) || (a.km - b.km));
  const placed = [];
  const els = [];
  for (const s of shown) {
    if (els.length >= MAX_CARDS) break;
    const el = cardFor(s.item);
    const card = el.firstChild;
    card.style.fontSize = `${fontPx(s.scale).toFixed(2)}px`;
    // The card's box on screen, from its size at this scale (measured once
    // and cached per card at scale 1).
    if (!el._w) { layer.appendChild(el); card.style.fontSize = `${BASE_PX}px`; el._w = card.offsetWidth; el._h = card.offsetHeight; card.style.fontSize = `${fontPx(s.scale).toFixed(2)}px`; }
    const k = fontPx(s.scale) / BASE_PX, w = el._w * k, h = el._h * k;
    const box = { l: s.x - w / 2 - 3, r: s.x + w / 2 + 3, t: s.y - LIFT_PX - h - 2, b: s.y - LIFT_PX + 2 };
    if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue;   // pure occlusion
    placed.push(box);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    el.style.opacity = s.opacity.toFixed(2);
    el.style.zIndex = String(1000 - Math.round(s.km));
    els.push(el);
  }
  // Farthest first in the DOM, so the nearer cards paint over them.
  layer.replaceChildren(...els.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex)));
}

/** Start following the view (idempotent). */
export function startFlightLabels() {
  if (frame) return;
  frame = requestAnimationFrame(step);
}

/** Stop and clear. */
export function stopFlightLabels() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  layer?.replaceChildren();
}
