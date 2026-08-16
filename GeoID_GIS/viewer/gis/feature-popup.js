/**
 * Click a vector feature, read what it is.
 *
 * The Mars and Moon viewers have had this for their geology since the start —
 * a polygon is not a colour, it is a unit with a name, an age and a lithology,
 * and a map you cannot interrogate is a picture. Imported vector layers had no
 * equivalent: the BGS bedrock polygons carry fifty-seven attributes each and
 * there was no way to see one of them.
 *
 * It hit-tests in COORDINATES, not in geometry. A click asks the viewer what
 * lat/lon the pixel is (`surfaceLatLonAt`), and the answer is tested against
 * each visible layer's GeoJSON with the same `pointInPolygon` the query engine
 * and the extraction use. That matters for three reasons: the drape meshes are
 * built with `depthTest: false` and would raycast in an order that has nothing
 * to do with what you see; a simplified render mesh is not the feature; and
 * this way the popup and a spatial query can never disagree about which
 * polygon a point is in.
 *
 * Topmost wins, where "top" is the layer stack the hierarchy already defines —
 * the same order the eye reads, so the answer is the polygon you clicked.
 */

import { pointInPolygon, boundsOf, haversineMetres } from "./geometry.js?v=20260816-3db7329";

/* A line has no interior, so it is picked by proximity. Scaled to the view:
   8 px worth of ground at the current altitude, floored so a click at orbital
   distance cannot select a river 400 km away. */
const LINE_PIXELS = 8;
const LINE_FLOOR_M = 30;
const LINE_CEILING_M = 20000;

let installed = false;
let popup = null;
let suppressUntil = 0;

/* ── the popup ──────────────────────────────────────────────────────────── */

const STYLE = `
#gis-feature-popup {
  position: fixed;
  z-index: 21;
  max-width: 22rem;
  max-height: 60vh;
  overflow-y: auto;
  padding: 0.55rem 0.7rem 0.65rem;
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 60, 172), 0.55);
  border-radius: 0.4rem;
  background: rgba(10, 4, 18, 0.94);
  box-shadow: 0 0.5rem 1.6rem rgba(0, 0, 0, 0.55);
  font-family: "Exo 2", system-ui, sans-serif;
  font-size: 0.72rem;
  color: var(--text, #e8e2f2);
}
#gis-feature-popup[hidden] { display: none; }
#gis-feature-popup .gis-fp-head {
  display: flex; align-items: flex-start; gap: 0.5rem;
  margin-bottom: 0.4rem;
}
#gis-feature-popup .gis-fp-title {
  flex: 1; font-weight: 600; line-height: 1.25;
  color: var(--nav-accent, #ff3cac);
}
#gis-feature-popup .gis-fp-close {
  flex: 0 0 auto; width: 1.2rem; height: 1.2rem; padding: 0;
  border: 0; border-radius: 0.2rem; cursor: pointer;
  background: transparent; color: inherit; font-size: 0.8rem; line-height: 1;
}
#gis-feature-popup .gis-fp-close:hover { background: rgba(255, 255, 255, 0.12); }
#gis-feature-popup .gis-fp-layer {
  margin-bottom: 0.35rem; letter-spacing: 0.06em; text-transform: uppercase;
  font-size: 0.6rem; opacity: 0.7;
}
#gis-feature-popup dl {
  display: grid; grid-template-columns: minmax(5.5rem, auto) 1fr;
  gap: 0.15rem 0.6rem; margin: 0;
}
#gis-feature-popup dt {
  color: var(--skin-data, #59f2ff); opacity: 0.85;
  overflow-wrap: anywhere;
}
#gis-feature-popup dd { margin: 0; overflow-wrap: anywhere; }
#gis-feature-popup .gis-fp-more {
  margin-top: 0.4rem; font-size: 0.62rem; opacity: 0.65;
}
`;

function ensurePopup() {
  if (popup) return popup;
  if (!document.getElementById("gis-feature-popup-style")) {
    const style = document.createElement("style");
    style.id = "gis-feature-popup-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  popup = document.createElement("div");
  popup.id = "gis-feature-popup";
  popup.setAttribute("role", "dialog");
  popup.hidden = true;
  document.body.appendChild(popup);
  return popup;
}

export function hidePopup() {
  if (popup) popup.hidden = true;
}

/* Attributes worth leading with, in the order a geologist reads them. Anything
   not named here still shows, below these; nothing is hidden. */
const PREFERRED = [
  "name", "NAME", "lex_d", "rcs_d", "lex_rcs_d", "bgstype", "max_time_d",
  "min_time_d", "max_period", "min_period", "max_era", "age_onegl",
  "waterway", "value", "class", "unit", "description",
];

function titleOf(props) {
  for (const key of ["lex_d", "name", "NAME", "Name", "lex_rcs_d", "rcs_d", "id"]) {
    const v = props?.[key];
    if (v != null && String(v).trim()) return String(v);
  }
  return "Feature";
}

function orderedEntries(props) {
  const seen = new Set();
  const rows = [];
  PREFERRED.forEach((key) => {
    if (props[key] != null && String(props[key]).trim() && !seen.has(key)) {
      seen.add(key);
      rows.push([key, props[key]]);
    }
  });
  Object.keys(props).forEach((key) => {
    if (seen.has(key)) return;
    const v = props[key];
    if (v == null || !String(v).trim() || String(v) === "0") return;
    seen.add(key);
    rows.push([key, v]);
  });
  return rows;
}

function showPopup(x, y, layerName, feature) {
  const host = ensurePopup();
  host.innerHTML = "";
  const props = feature.properties || {};

  const head = document.createElement("div");
  head.className = "gis-fp-head";
  const title = document.createElement("span");
  title.className = "gis-fp-title";
  title.textContent = titleOf(props);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-fp-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", hidePopup);
  head.append(title, close);

  const layer = document.createElement("div");
  layer.className = "gis-fp-layer";
  layer.textContent = layerName;

  const list = document.createElement("dl");
  const rows = orderedEntries(props);
  rows.slice(0, 24).forEach(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    list.append(dt, dd);
  });

  host.append(head, layer, list);
  if (rows.length > 24) {
    const more = document.createElement("div");
    more.className = "gis-fp-more";
    more.textContent = `+${rows.length - 24} more fields — the attribute table has all of them.`;
    host.appendChild(more);
  }

  host.hidden = false;
  // Place it beside the click, then pull it back inside the window. Measuring
  // after it is shown is the only way to know how tall it ended up.
  const box = host.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8);
  const top = Math.min(Math.max(8, y + 12), window.innerHeight - box.height - 8);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

/* ── hit testing ────────────────────────────────────────────────────────── */

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function inBounds(point, coords, padDeg = 0) {
  // boundsOf answers {minX, minY, maxX, maxY} — an OBJECT, not the [w, s, e, n]
  // array the rest of the GeoJSON world uses. Indexing it numerically yields
  // undefined, every comparison is false, and the pre-filter then rejects every
  // feature on the globe: a hit test that silently never hits.
  const b = boundsOf(coords);
  if (!b || !Number.isFinite(b.minX)) return false;
  return point[0] >= b.minX - padDeg && point[0] <= b.maxX + padDeg
    && point[1] >= b.minY - padDeg && point[1] <= b.maxY + padDeg;
}

/** Distance from a point to a polyline, in metres, by nearest vertex-segment. */
function distanceToLine(point, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let t = 0;
    if (dx || dy) {
      t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
    }
    const near = [a[0] + t * dx, a[1] + t * dy];
    const d = haversineMetres(point, near);
    if (d < best) best = d;
  }
  return best;
}

function lineTolerance() {
  const metres = window.GeoIDViewer?.getZoomAltitudeMetres?.()?.metres;
  if (!Number.isFinite(metres)) return LINE_CEILING_M;
  // The view is roughly the altitude across, over a 60° field; 8 px of a
  // ~900 px canvas is therefore about altitude/110.
  const scaled = (metres / 110) * (LINE_PIXELS / 8);
  return Math.min(LINE_CEILING_M, Math.max(LINE_FLOOR_M, scaled));
}

/**
 * The feature under a coordinate, searching the visible vector layers from the
 * top of the stack down. Exported for the tests and for anything that wants to
 * ask without a click.
 */
export function featureAt(lat, lon) {
  const layers = window.GeoIDImportManager?.getVectorLayers?.() || [];
  const point = [lon, lat];
  const tolerance = lineTolerance();
  // Later imports draw over earlier ones, so search the list backwards.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer.visible === false) continue;
    if (layer.object3D && layer.object3D.visible === false) continue;
    let nearest = null;
    for (const feature of layer.features) {
      const geometry = feature?.geometry;
      const polys = polygonsOf(geometry);
      for (const poly of polys) {
        if (!poly?.length || !inBounds(point, poly[0])) continue;
        if (pointInPolygon(point, poly)) {
          return { layer, feature };
        }
      }
      if (polys.length) continue;
      for (const line of linesOf(geometry)) {
        if (line.length < 2 || !inBounds(point, line, tolerance / 111000)) continue;
        const d = distanceToLine(point, line);
        if (d <= tolerance && (!nearest || d < nearest.d)) nearest = { d, feature };
      }
    }
    if (nearest) return { layer, feature: nearest.feature };
  }
  return null;
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

/**
 * A click that was really a drag must not open a popup — an orbit control
 * drag ends in a click event at the release point, and a globe you cannot
 * turn without popups appearing is worse than no popups.
 */
function install() {
  if (installed) return;
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  installed = true;

  let downAt = null;
  canvas.addEventListener("pointerdown", (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  }, true);

  canvas.addEventListener("click", (event) => {
    const moved = downAt
      ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      : 0;
    downAt = null;
    if (moved > 4) return;
    if (Date.now() < suppressUntil) return;
    // The Draw tool and the measure modes own the click while they are armed.
    if (window.GeoIDViewer?.isMeasuring?.()) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
    if (!at) { hidePopup(); return; }
    const hit = featureAt(at.lat, at.lon);
    if (!hit) { hidePopup(); return; }
    showPopup(event.clientX, event.clientY, hit.layer.name || "Layer", hit.feature);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopup();
  });
}

/** Ignore clicks for a moment — used by anything that takes over the canvas. */
export function suppress(ms = 600) {
  suppressUntil = Date.now() + ms;
}

// The canvas is created by the viewer's own async boot, so the first attempt
// usually misses it. The retry is BOUNDED — an unbounded one keeps a timer
// alive for the life of the page (and hangs node outright, where there is no
// canvas and never will be), which is how the unit run for this module first
// went silent for three minutes.
let attempts = 0;
function boot() {
  install();
  if (!installed && (attempts += 1) < 40) setTimeout(boot, 400);
}

if (typeof window !== "undefined") {
  window.GeoIDFeaturePopup = { featureAt, hidePopup, suppress };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
