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
// How far above the surface the markers float, as a fraction of the globe's
// radius. The globe is not a bare sphere -- there are shells above it -- so a
// marker needs to clear those as well as the ground to survive the depth test.
const MARKER_LIFT = 1.05;

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
        <div class="event-row" data-id="${event.id}" title="${event.title}">
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

  // A row and its marker are the same event, so clicking either does the same
  // thing: bring it into view, ring it, and open its description.
  panel.querySelectorAll(".event-row").forEach((row) => {
    row.addEventListener("click", () => {
      const event = events.find((e) => e.id === row.dataset.id);
      if (!event) return;
      selectEvent(event);
      panel.querySelectorAll(".event-row").forEach((r) => r.classList.remove("is-selected"));
      row.classList.add("is-selected");
    });
  });
}

/**
 * Everything that happens when an event is chosen, from either the list or the
 * globe. Kept in one place so the two cannot drift into doing different things.
 */
function selectEvent(event, at) {
  if (!event) return;
  focusOn(event.lat, event.lon);
  // The popup is placed at the pointer when a marker is picked, and beside the
  // feed when a row is, so it never lands on top of what was clicked.
  const point = at || feedAnchor();
  showPopup(event, point.x, point.y);
}

/** A spot just left of the feed, for popups opened from the list. */
function feedAnchor() {
  const overlay = byId("events-overlay");
  if (!overlay) return { x: 80, y: 120 };
  const rect = overlay.getBoundingClientRect();
  return { x: Math.max(20, rect.left - 300), y: rect.top + 40 };
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
  // Selecting an event is a request to look at it, so the view closes in as
  // well as coming round -- staying at whatever distance it happened to be at
  // left the event a speck in the middle of the screen.
  const close = viewer.GLOBE_RADIUS * 1.55;
  const from = viewer.camera.position.clone();
  const to = local.clone().setLength(Math.min(from.length(), close));
  const started = performance.now();
  const duration = 650;
  if (flyFrame) window.cancelAnimationFrame(flyFrame);
  const step = (now) => {
    const t = Math.min((now - started) / duration, 1);
    // Ease out, so it arrives gently rather than stopping dead.
    const e = 1 - ((1 - t) ** 3);
    // Interpolated as a direction and a distance rather than straight across,
    // which would cut a chord through the planet on a long move.
    const dir = from.clone().normalize().lerp(to.clone().normalize(), e).normalize();
    const dist = from.length() + (to.length() - from.length()) * e;
    viewer.camera.position.copy(dir).setLength(dist);
    viewer.controls?.target.set(0, 0, 0);
    viewer.controls?.update();
    flyFrame = t < 1 ? window.requestAnimationFrame(step) : null;
  };
  flyFrame = window.requestAnimationFrame(step);
}

/**
 * The globe's apparent radius in pixels. Both the dots and the selection ring
 * are sized from this, so they keep the same relationship to the planet at any
 * zoom: a fixed pixel size made the dots swallow the globe when pulled right
 * out, and a fixed world size made the ring balloon on the way in.
 */
function globeRadiusPx() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  const height = viewer?.renderer?.domElement?.clientHeight || 0;
  if (!camera || !height) return 0;
  const distance = Math.max(camera.position.length(), 1e-6);
  const fov = (camera.fov || 45) * Math.PI / 180;
  return (viewer.GLOBE_RADIUS / distance) * (height / (2 * Math.tan(fov / 2)));
}

/**
 * Dot size in pixels: a fixed fraction of the globe, floored so a distant event
 * stays clickable and capped so a close one does not cover what it marks.
 */
function dotSizePx(globePx) {
  return Math.max(4, Math.min(16, globePx * 0.022));
}

let markerSprite = null;
let sizeFrame = null;

/** Keeps marker size in step with the view. */
function trackScale() {
  if (sizeFrame) return;
  const step = () => {
    if (!active) { sizeFrame = null; return; }
    const px = globeRadiusPx();
    if (px > 0 && markers) {
      const size = dotSizePx(px);
      markers.children.forEach((points) => {
        if (points.material.size !== size) points.material.size = size;
      });
    }
    sizeFrame = window.requestAnimationFrame(step);
  };
  sizeFrame = window.requestAnimationFrame(step);
}

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
    // The index of a hit point is all a raycast returns, so the events behind
    // each cloud are kept in the same order to look the hit back up.
    list.forEach((event, i) => {
      const v = viewer.latLonToVector3(event.lat, event.lon, viewer.GLOBE_RADIUS * MARKER_LIFT);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(symbolFor(key).colour),
      map: markerTexture(),
      // Sized in screen pixels rather than world units: at globe scale a
      // world-sized point is a speck, and it should stay legible at any zoom.
      size: 8,
      sizeAttenuation: false,
      depthWrite: false,
      // Depth tested, so events on the far side are hidden by the planet rather
      // than showing through it. They sit slightly proud of the surface, which
      // is what keeps the near-side ones from being swallowed by it -- turning
      // the test off did that too, but at the cost of seeing straight through
      // the globe.
      depthTest: true,
      transparent: true,
      opacity: 0.95,
    }));
    points.renderOrder = 20;
    points.name = `eonet-${key}`;
    points.userData.events = list;
    markers.add(points);
  });
  // Parented to the globe itself, not the scene group around it. latLonToVector3
  // returns positions in the globe's own unrotated frame, and the globe carries
  // a rotation that the viewer animates; hanging the markers a level higher left
  // them fixed while the planet turned underneath, so every event drifted off
  // its true position by however far the globe had spun.
  (viewer.globe || viewer.earthSceneGroup || viewer.scene).add(markers);
  trackScale();
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
  window.GeoIDModeManager?.setSpin?.(!active && window.GeoIDModeManager?.isSpinning?.());

  window.clearInterval(timer);
  timer = null;
  if (!active) {
    events = [];
    hidePopup();
    renderMarkers();
    return;
  }
  if (!THREE) THREE = await import("../vendor/three.module.js");
  installPicking();
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

/**
 * Picking. Points are drawn at a fixed pixel size, so the raycaster's threshold
 * is set from that rather than left at its world-unit default -- otherwise the
 * hit area has nothing to do with what is on screen.
 */
function installPicking() {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !THREE || canvas.dataset.eonetPicking) return;
  canvas.dataset.eonetPicking = "true";
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;

  canvas.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    // A drag is navigation, not a pick.
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    if (!active || !markers) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, viewer.camera);
    const scale = viewer.camera.position.length() / Math.max(rect.height, 1);
    raycaster.params.Points.threshold = scale * 12;
    const hits = raycaster.intersectObjects(markers.children, false);
    // Nearest first, and only on the side of the globe facing the camera.
    const hit = hits.find((h) => h.point.clone().normalize()
      .dot(viewer.camera.position.clone().normalize()) > 0);
    if (hit) {
      const event = hit.object.userData.events?.[hit.index];
      if (event) {
        showPopup(event, e.clientX, e.clientY);
        setSelection(event);
        markRow(event.id);
        return;
      }
    }
    hidePopup();
  });
}

let halo = null;
let haloFrame = null;
let flyFrame = null;

/**
 * A pulsing ring on the selected event, so the popup and the globe agree on
 * which one is being read. Parented to the globe like the markers, so it stays
 * on its event however the planet is turned.
 */
/**
 * Holds the ring on the dot's circumference. dotSizePx is a width and the ring's
 * scale is a radius, so it takes half the dot's width plus a little clearance.
 */
function applyHaloScale() {
  const viewer = window.GeoIDViewer;
  if (!halo || !viewer) return;
  const px = globeRadiusPx();
  const ringPx = px > 0 ? dotSizePx(px) * 0.62 : 3;
  halo.scale.setScalar(px > 0
    ? viewer.GLOBE_RADIUS * (ringPx / px)
    : viewer.GLOBE_RADIUS * 0.01);
}

function setSelection(event) {
  const viewer = window.GeoIDViewer;
  if (halo) {
    halo.parent?.remove(halo);
    halo.geometry?.dispose?.();
    halo.material?.dispose?.();
    halo = null;
  }
  if (haloFrame) { window.cancelAnimationFrame(haloFrame); haloFrame = null; }
  if (!event || !viewer?.globe || !THREE) return;

  const position = viewer.latLonToVector3(event.lat, event.lon, viewer.GLOBE_RADIUS * MARKER_LIFT);
  halo = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0x52e4e8,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  halo.name = "eonet-selection";
  halo.position.copy(position);
  halo.renderOrder = 21;
  // Sized before it is added, not on the first animation frame: left at unit
  // scale the ring is the radius of the globe, which showed as a huge flash.
  applyHaloScale();
  viewer.globe.add(halo);

  const started = performance.now();
  const pulse = (now) => {
    if (!halo) return;
    // Size is held on the dot every frame, so it tracks a zoom as it happens.
    applyHaloScale();
    // The pulse is in brightness alone. Pulsing the size was what took the ring
    // off the dot it is meant to sit on: it can only stay on the circumference
    // if it stays that size.
    const t = ((now - started) % 1400) / 1400;
    halo.material.opacity = 0.35 + 0.55 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
    // Kept facing the camera, so it is a ring rather than an ellipse edge-on.
    if (viewer.camera) halo.lookAt(viewer.camera.position);
    haloFrame = window.requestAnimationFrame(pulse);
  };
  haloFrame = window.requestAnimationFrame(pulse);
}

/** Keeps the feed's highlight in step with whatever is selected. */
function markRow(id) {
  byId("events-panel-body")?.querySelectorAll(".event-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.id === id);
  });
}

function hidePopup() {
  byId("event-popup")?.setAttribute("hidden", "");
  setSelection(null);
  markRow(null);
}

function showPopup(event, x, y) {
  const node = byId("event-popup");
  if (!node) return;
  const symbol = symbolFor(event.categoryId);
  const when = event.date ? new Date(event.date).toLocaleString() : "date not given";
  node.innerHTML = `
    <button type="button" class="event-popup-close" aria-label="Close">×</button>
    <div class="event-popup-head">
      <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
      <span>${event.categoryTitle || symbol.label}</span>
    </div>
    <h3>${event.title}</h3>
    <dl>
      <dt>Position</dt><dd>${event.lat.toFixed(3)}°, ${event.lon.toFixed(3)}°</dd>
      <dt>Last report</dt><dd>${when}</dd>
      <dt>Source</dt><dd>NASA EONET · ${event.id}</dd>
    </dl>
    ${event.link ? `<a href="${event.link}" target="_blank" rel="noopener">Open in EONET</a>` : ""}
    <div class="event-popup-actions">
      <button type="button" class="button secondary" data-role="fly">Bring into view</button>
    </div>`;
  node.removeAttribute("hidden");
  setSelection(event);
  // Placed at the click, then nudged back inside the window if it would spill.
  const rect = node.getBoundingClientRect();
  const left = Math.min(x + 12, window.innerWidth - rect.width - 12);
  const top = Math.min(y + 12, window.innerHeight - rect.height - 12);
  node.style.left = `${Math.max(12, left)}px`;
  node.style.top = `${Math.max(12, top)}px`;
  node.querySelector(".event-popup-close")?.addEventListener("click", hidePopup);
  node.querySelector('[data-role="fly"]')?.addEventListener("click", () => {
    focusOn(event.lat, event.lon);
  });
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
  // Escape drops the selection, the way it dismisses the other overlays.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("event-popup")?.hidden) hidePopup();
  });
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
