// Live natural-event feed from NASA EONET.
//
// EONET curates open natural events -- wildfires, storms, volcanic activity,
// icebergs and so on -- each with a category and a track of dated points. The
// feed is public, needs no key, and is served with permissive CORS, so it can
// be read straight from the browser.
//
// Events are their own mode rather than a layer: they are a live view of what is
// happening now, not something imported, and they come and go on their own
// schedule. When the mode is on they appear as a drop-down beside the legend and
// as markers on the globe; when it is off nothing is fetched and nothing drawn.

const API = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200";
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Symbology by EONET category. Colours follow the hazard sense the rest of the
 * viewer uses -- heat and fire warm, water cool, ground and ice neutral -- so a
 * glance at the globe reads the same way as a glance at the legend.
 */
const SYMBOLS = {
  wildfires: { colour: "#ff6b2c", glyph: "▲", label: "Wildfires" },
  volcanoes: { colour: "#ff2bd6", glyph: "▲", label: "Volcanoes" },
  severeStorms: { colour: "#52e4e8", glyph: "◉", label: "Severe storms" },
  seaLakeIce: { colour: "#bfe9ff", glyph: "◆", label: "Sea and lake ice" },
  floods: { colour: "#2f6bff", glyph: "▬", label: "Floods" },
  drought: { colour: "#d8b26a", glyph: "▬", label: "Drought" },
  earthquakes: { colour: "#ffd166", glyph: "✳", label: "Earthquakes" },
  landslides: { colour: "#c98b5e", glyph: "▼", label: "Landslides" },
  snow: { colour: "#e8f4ff", glyph: "❄", label: "Snow" },
  dustHaze: { colour: "#c2a878", glyph: "▨", label: "Dust and haze" },
  manmade: { colour: "#9aa5b1", glyph: "■", label: "Manmade" },
  waterColor: { colour: "#4fd1a5", glyph: "◉", label: "Water colour" },
  tempExtremes: { colour: "#ff8a5c", glyph: "✳", label: "Temperature extremes" },
};
const FALLBACK = { colour: "#9aa5b1", glyph: "●", label: "Other" };

const symbolFor = (id) => SYMBOLS[id] || FALLBACK;

let active = false;
let events = [];
let markers = null;
let timer = null;
let THREE = null;

const byId = (id) => document.getElementById(id);

function status(message) {
  const node = byId("events-status");
  if (node) node.textContent = message || "";
}

/** Latest dated point of an event's geometry -- where it is now, not where it began. */
function latestPoint(event) {
  const geometry = event.geometry || [];
  for (let i = geometry.length - 1; i >= 0; i -= 1) {
    const g = geometry[i];
    if (!g?.coordinates) continue;
    // Polygons carry a ring; take its first vertex as a representative point.
    const c = g.type === "Polygon" ? g.coordinates?.[0]?.[0] : g.coordinates;
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      return { lon: c[0], lat: c[1], date: g.date };
    }
  }
  return null;
}

async function fetchEvents() {
  status("Fetching…");
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    events = (data.events || []).map((event) => {
      const point = latestPoint(event);
      const category = event.categories?.[0] || {};
      return point ? {
        id: event.id,
        title: event.title,
        link: event.link,
        categoryId: category.id,
        categoryTitle: category.title,
        ...point,
      } : null;
    }).filter(Boolean);
    status(`${events.length} open event(s) · ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    events = [];
    // Said plainly: an empty list because the feed is unreachable is not the
    // same as an empty list because nothing is happening.
    status(`Feed unavailable (${error.message}). Nothing is being shown.`);
  }
  renderPanel();
  renderMarkers();
}

function renderPanel() {
  const panel = byId("events-panel-body");
  if (!panel) return;
  if (!events.length) {
    panel.innerHTML = '<p class="gis-hint">No events to show.</p>';
    return;
  }
  const groups = new Map();
  events.forEach((event) => {
    const key = event.categoryId || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  panel.innerHTML = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, list]) => {
      const symbol = symbolFor(key);
      const rows = list.slice(0, 12).map((event) => `
        <div class="event-row" data-lat="${event.lat}" data-lon="${event.lon}" title="${event.title}">
          <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
          <span class="event-name">${event.title}</span>
        </div>`).join("");
      const more = list.length > 12 ? `<div class="gis-hint">+${list.length - 12} more</div>` : "";
      return `<div class="event-group">
        <div class="event-group-head">
          <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
          <span>${symbol.label !== FALLBACK.label ? symbol.label : (list[0].categoryTitle || "Other")}</span>
          <span class="event-count">${list.length}</span>
        </div>${rows}${more}</div>`;
    }).join("");

  // Clicking an event flies the globe to it, the same as picking a location.
  panel.querySelectorAll(".event-row").forEach((row) => {
    row.addEventListener("click", () => {
      focusOn(Number(row.dataset.lat), Number(row.dataset.lon));
    });
  });
}

function focusOn(lat, lon) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.latLonToVector3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const local = viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS);
  // The point comes back in the globe's own frame, so it has to be carried
  // through the globe's world matrix before the camera is aimed at it --
  // otherwise the view lands wherever that spot was before the planet turned.
  const globe = viewer.globe;
  if (globe) {
    globe.updateMatrixWorld(true);
    local.applyMatrix4(globe.matrixWorld);
  }
  const distance = viewer.camera.position.length();
  viewer.camera.position.copy(local).setLength(distance);
  viewer.controls?.target.set(0, 0, 0);
  viewer.controls?.update();
}

let markerSprite = null;

/** A soft round dot, so markers read as points rather than square pixels. */
function markerTexture() {
  if (markerSprite || !THREE) return markerSprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  markerSprite = new THREE.CanvasTexture(canvas);
  return markerSprite;
}

function renderMarkers() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene || !THREE) return;
  if (markers) {
    markers.parent?.remove(markers);
    markers.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
    markers = null;
  }
  if (!active || !events.length) return;

  // One point cloud per category, so each carries its own colour and the whole
  // feed costs a handful of draw calls rather than one per event.
  markers = new THREE.Group();
  markers.name = "eonet-events";
  const groups = new Map();
  events.forEach((event) => {
    const key = event.categoryId || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  groups.forEach((list, key) => {
    const positions = new Float32Array(list.length * 3);
    list.forEach((event, i) => {
      const v = viewer.latLonToVector3(event.lat, event.lon, viewer.GLOBE_RADIUS * 1.004);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(symbolFor(key).colour),
      map: markerTexture(),
      // Sized in screen pixels rather than world units: at globe scale a
      // world-sized point is a speck, and it should stay legible at any zoom.
      size: 14,
      sizeAttenuation: false,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    }));
    // Drawn after the globe so a marker on the near face is never swallowed by
    // the surface it sits on.
    points.renderOrder = 20;
    points.name = `eonet-${key}`;
    markers.add(points);
  });
  // Parented to the globe itself, not the scene group around it. latLonToVector3
  // returns positions in the globe's own unrotated frame, and the globe carries
  // a rotation that the viewer animates; hanging the markers a level higher left
  // them fixed while the planet turned underneath, so every event drifted off
  // its true position by however far the globe had spun.
  (viewer.globe || viewer.earthSceneGroup || viewer.scene).add(markers);
}

async function setActive(on) {
  active = Boolean(on);
  document.body.dataset.events = active ? "true" : "false";
  const row = byId("gis-group-events");
  if (row) row.classList.toggle("is-armed", active);
  const button = byId("events-mode-enter");
  if (button) {
    button.textContent = active ? "Exit" : "Enter";
    button.classList.toggle("is-active", active);
  }
  const host = byId("events-overlay");
  const panel = byId("events-panel");
  const toggle = byId("events-panel-toggle");
  if (host) {
    host.hidden = !active;
    // Entering the mode is a request to see the feed, so it opens on the list
    // rather than on a closed tab that has to be found and clicked.
    if (active && panel) {
      panel.hidden = false;
      toggle?.setAttribute("aria-expanded", "true");
    }
    placeOverlay();
    if (!active && panel) {
      panel.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
    }
  }

  // Reading a feed against the globe means finding places on it, which a
  // turning planet makes needlessly hard. The spin stops while the mode is on
  // and is left off afterwards rather than forced back -- Space is the control
  // for it, and it should not be overridden behind the user.
  if (active) window.GeoIDModeManager?.setSpin?.(false);

  window.clearInterval(timer);
  timer = null;
  if (!active) {
    events = [];
    renderMarkers();
    return;
  }
  if (!THREE) THREE = await import("../vendor/three.module.js");
  await fetchEvents();
  timer = window.setInterval(fetchEvents, REFRESH_MS);
}

/**
 * Sits the feed immediately left of the legend, or in the legend's own slot when
 * there is no legend. Measured rather than assumed: the legend's width changes
 * as its panel opens and closes, and a fixed offset left an obvious gap
 * whenever it was shut.
 */
function placeOverlay() {
  const host = byId("events-overlay");
  const legend = byId("map-legend");
  if (!host) return;
  const base = 5.5 * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
  if (!legend || legend.hidden) {
    host.style.right = `${base}px`;
    return;
  }
  const gap = 8;
  host.style.right = `${window.innerWidth - legend.getBoundingClientRect().left + gap}px`;
}

function init() {
  byId("events-mode-enter")?.addEventListener("click", () => setActive(!active));
  const toggle = byId("events-panel-toggle");
  toggle?.addEventListener("click", () => {
    const panel = byId("events-panel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
  // The legend's width drives where this sits, so follow anything that changes
  // it: layers appearing or going, its panel opening, and the window resizing.
  document.getElementById("map-legend-toggle")?.addEventListener("click", () => {
    window.requestAnimationFrame(placeOverlay);
  });
  window.addEventListener("geoid-gis:layers-changed", () => {
    window.requestAnimationFrame(placeOverlay);
  });
  window.addEventListener("resize", placeOverlay);
  window.setInterval(placeOverlay, 1000);
  // The overlay sits over the scene, so it hangs off <body> like the legend.
  const overlay = byId("events-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
  // Leaving GIS puts the feed away: there is no globe to pin events to.
  window.addEventListener("geoid-gis:mode-change", (event) => {
    if (event.detail?.mode !== "gis" && active) setActive(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDEvents = { setActive, isActive: () => active, getEvents: () => events, SYMBOLS };
