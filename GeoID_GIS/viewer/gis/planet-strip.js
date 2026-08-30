import { BODIES, currentBodyId } from "./bodies.js?v=20260830-538554b";

/**
 * The worlds, along the bottom of the GIS page.
 *
 * Markup and icons are the orrery's, from explorer/index.html -- the same
 * `.planet-node` / `.planet-icon` pair, so the two places agree about what a
 * planet button looks like without a second set of assets.
 *
 * Links rather than buttons: each world is a real page, so middle-click and
 * open-in-new-tab work, and the browser shows where a node goes before it is
 * clicked. The GIS page is a globe page; Model and Research are not, so the
 * strip stands down in those modes.
 *
 * Journeys go through /transit/, which loads the destination viewer in a
 * background iframe and crossfades to it once it is ready. These viewers take
 * seconds to build a globe and its tile pyramid, and transit turns that into
 * something to watch rather than a white page.
 *
 * Earth is the exception: /transit/?destination=earth is the ISS viewer, and
 * Earth's GIS page is this one, so its node links straight there.
 */

// Orrery order, not registry order -- Sun outward, with the Moon beside Earth,
// which is how the strip reads on the explorer page.
const ORDER = ["mercury", "venus", "earth", "moon", "mars",
  "jupiter", "saturn", "uranus", "neptune", "pluto"];

// One size for every world. The strip wore relative sizes once — "reads as a
// solar system, not a toolbar" — and it read as a toolbar with mismatched
// buttons: Jupiter twice the Moon, targets of different sizes for one kind of
// action. It IS a toolbar; the icons are equal.
const ICON_SIZE = 26;

const STRIP_ID = "gis-planet-strip";
const DOCK_ID = "gis-planet-dock";
const TOGGLE_ID = "gis-planet-toggle";
// Remembered, because every world is a separate page: without this the strip
// would come back up on each hop, and dismissing it would only ever last until
// you used it.
const STORE_KEY = "geoid:planet-strip-collapsed";

/**
 * The strip is styled twice -- Earth reads styles.css, the nine planet pages
 * read shell.css, and both carry a copy of .gis-planet-strip. Anything written
 * to either would be a rule for one half of the GUI, so the dock's own styling
 * is injected here instead, which is the one place both halves share.
 */
const STYLE = `
.gis-planet-dock {
  position: fixed;
  left: 50%;
  bottom: 0.6rem;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  /* The column is wider than the arrow and taller than the strip, so it would
     otherwise sit over the globe swallowing drags in the gap beside them. */
  pointer-events: none;
}
.gis-planet-dock > * { pointer-events: auto; }
.gis-planet-dock[hidden] { display: none; }

/* The strip stops positioning itself -- the dock does it now, so the arrow can
   sit above the strip and stay put when the strip goes. */
#gis-planet-dock > .gis-planet-strip {
  position: static;
  left: auto;
  bottom: auto;
  transform: none;
  z-index: auto;
  max-height: 7rem;
  overflow: hidden;
  transition: max-height 0.24s ease, opacity 0.16s ease,
              padding-top 0.24s ease, padding-bottom 0.24s ease, border-width 0.24s ease;
}
/* Collapsed downward into the footer rather than switched off, so it is clear
   where it went and where it will come back from. */
#gis-planet-dock.is-collapsed > .gis-planet-strip {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-width: 0;
  pointer-events: none;
}

.gis-planet-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 1.2rem;
  padding: 0;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.38);
  border-radius: 999px;
  background: rgba(6, 10, 16, 0.72);
  backdrop-filter: blur(10px);
  color: var(--text);
  font-size: 0.6rem;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.gis-planet-toggle:hover {
  border-color: rgb(var(--nav-accent-rgb));
  color: rgb(var(--nav-accent-rgb));
}
/* Collapsed, the arrow is the only thing left, so it takes the accent to say
   there is something down there rather than reading as a stray pill. */
#gis-planet-dock.is-collapsed .gis-planet-toggle {
  background: rgb(var(--nav-accent-rgb));
  border-color: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
}
.gis-planet-caret {
  display: block;
  transition: transform 0.22s ease;
}
#gis-planet-dock.is-collapsed .gis-planet-caret { transform: rotate(180deg); }
`;

function injectStyle() {
  if (document.getElementById("geoid-planet-dock-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-planet-dock-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function build() {
  const strip = document.createElement("nav");
  strip.id = STRIP_ID;
  strip.className = "gis-planet-strip";
  strip.setAttribute("aria-label", "Worlds");

  const here = currentBodyId();
  ORDER.forEach((id) => {
    const body = BODIES.find((b) => b.id === id);
    if (!body) return;
    const node = document.createElement("a");
    node.className = "planet-node";
    node.href = body.id === "earth"
      ? body.path
      : `/transit/?destination=${body.id}`;
    node.dataset.planet = body.id;
    node.style.setProperty("--icon-size", `${ICON_SIZE}px`);
    node.title = body.name;
    node.setAttribute("aria-label", `Open the ${body.name} viewer`);
    if (body.id === here) {
      node.classList.add("is-current");
      // The page you are on is not a link to itself. It stays in the DOM as a
      // node rather than a link, so Model mode can still select it -- there the
      // current world is a studio setting, not the page.
      node.removeAttribute("href");
      node.setAttribute("aria-current", "page");
    }
    const icon = document.createElement("img");
    icon.className = "planet-icon";
    icon.src = body.icon;
    icon.alt = "";
    icon.loading = "lazy";
    icon.decoding = "async";
    node.appendChild(icon);
    strip.appendChild(node);
  });
  return strip;
}

/** The arrow, and the dock that lets it stay put while the strip goes. */
function buildDock(strip) {
  const dock = document.createElement("div");
  dock.id = DOCK_ID;
  dock.className = "gis-planet-dock";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = TOGGLE_ID;
  toggle.className = "gis-planet-toggle";
  toggle.setAttribute("aria-controls", STRIP_ID);
  toggle.innerHTML = '<span class="gis-planet-caret" aria-hidden="true">&#9662;</span>';
  toggle.addEventListener("click", () => setCollapsed(!isCollapsed()));

  dock.appendChild(toggle);
  dock.appendChild(strip);
  return dock;
}

function isCollapsed() {
  return document.getElementById(DOCK_ID)?.classList.contains("is-collapsed") || false;
}

function setCollapsed(collapsed) {
  const dock = document.getElementById(DOCK_ID);
  const toggle = document.getElementById(TOGGLE_ID);
  if (!dock || !toggle) return;
  dock.classList.toggle("is-collapsed", collapsed);
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = collapsed ? "Show the worlds" : "Hide the worlds";
  toggle.title = label;
  toggle.setAttribute("aria-label", label);
  // Private browsing and blocked storage both throw on write; a strip that
  // forgets is a smaller problem than a strip that fails to appear.
  try { window.localStorage?.setItem(STORE_KEY, collapsed ? "1" : "0"); } catch { /* not fatal */ }
}

function storedCollapsed() {
  try { return window.localStorage?.getItem(STORE_KEY) === "1"; } catch { return false; }
}

function apply() {
  const strip = document.getElementById(STRIP_ID);
  const dock = document.getElementById(DOCK_ID);
  if (!strip) return;
  const mode = document.body.dataset.viewMode;
  /**
   * The strip stays up in Model mode.
   *
   * The Meshing Studio is per-world — its ground sphere is that body's radius,
   * so the horizon and the scale bar are the body's too (Earth 6,371 km, the
   * Moon 1,737 km, Jupiter 69,911 km, all read from the body registry). Which
   * world you are modelling on is therefore a property of the page you are on,
   * and the strip is how you change it.
   *
   * Research keeps standing down: the hub is a project workspace and its pages
   * are about a project, not about a globe.
   */
  // Stood down as a whole: hiding the strip but leaving its arrow behind would
  // offer to expand something that is not there.
  if (dock) dock.hidden = mode === "research";
  else strip.hidden = mode === "research";
}

/**
 * In Model mode a planet is a radius, not a destination.
 *
 * The Meshing Studio has no globe in it — the body only sets the ground
 * curvature, the horizon and the scale. So the strip changes the world **in
 * place**: no navigation, no transit page, and the model stays exactly where it
 * is. Loading another viewer to change one float would throw the model away and
 * cost a full WebGL boot to do it.
 *
 * In GIS mode the strip still navigates, because there the world IS the page.
 */
function switchWorldInPlace(event, bodyId) {
  if (document.body.dataset.viewMode !== "model") return false;
  const studio = window.GeoIDMeshStudio;
  if (!studio?.setStudioBody) return false;
  event.preventDefault();
  if (!studio.setStudioBody(bodyId)) return false;
  markCurrent(bodyId);
  return true;
}

/** Which icon reads as the world you are on. */
function markCurrent(bodyId) {
  const strip = document.getElementById(STRIP_ID);
  if (!strip) return;
  strip.querySelectorAll(".planet-node").forEach((node) => {
    const isHere = node.dataset.planet === bodyId;
    node.classList.toggle("is-current", isHere);
    if (isHere) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
}

export function init() {
  if (document.getElementById(STRIP_ID)) return;
  injectStyle();
  const strip = build();
  strip.addEventListener("click", (event) => {
    const node = event.target.closest(".planet-node");
    if (node?.dataset.planet) switchWorldInPlace(event, node.dataset.planet);
  });
  document.body.appendChild(buildDock(strip));
  // Set without a transition on the first paint: restoring a remembered state
  // should look like the page loaded that way, not like the strip collapsed by
  // itself a moment after arriving.
  const dock = document.getElementById(DOCK_ID);
  if (storedCollapsed()) {
    strip.style.transition = "none";
    setCollapsed(true);
    requestAnimationFrame(() => { strip.style.transition = ""; });
  } else {
    setCollapsed(false);
  }
  // Mode is announced on <body>, so watching the attribute keeps the strip in
  // step without the mode manager needing to know it exists.
  new MutationObserver(apply).observe(document.body, {
    attributes: true, attributeFilter: ["data-view-mode"],
  });
  apply();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
