import { BODIES, currentBodyId } from "./bodies.js?v=20261023-26ffafb";

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
/* ONE BAR, IN THE PANELS' OWN MATERIAL (owner, 2026-10-23).
   It was an opaque strip with a separate pill above it for collapsing -- two
   objects, the only solid thing floating over the globe, and the same colour
   under every theme. Now the dock IS the bar: the theme's panel colour at the
   translucency the side panels read at, blurred, edged in the data colour like
   #ui, and the collapse control is its last segment. Collapsed, EVERY world
   folds away (owner: "completely collapsed") and only the control is left --
   a small tab of the same material with a worlds glyph, so it is plain what
   it is and how to get it back. Themes restyle it alongside
   .layer-dock in viewer-themes.css (and the default theme squares it with the
   rest in side-panels.js). */
#gis-planet-dock.gis-planet-dock {
  position: fixed;
  left: 50%;
  bottom: 0.6rem;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0;
  padding: 0.22rem 0.22rem 0.22rem 0.4rem;
  border: 1px solid rgba(var(--skin-data-rgb, 0, 229, 255), 0.34);
  border-radius: calc(1.3rem * var(--skin-round, 1));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 60%),
    rgba(var(--skin-panel, 22, 9, 51), 0.62);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34),
    0 0 22px rgba(var(--nav-accent-rgb), 0.12);
  color: var(--skin-ink, var(--text, #e9fbff));
  pointer-events: auto;
}
.gis-planet-dock[hidden] { display: none !important; }

/* The strip stops being a box of its own: no ground, no edge, no position. */
#gis-planet-dock > .gis-planet-strip {
  position: static;
  left: auto; bottom: auto;
  transform: none;
  z-index: auto;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
#gis-planet-dock .planet-node {
  width: 2.1rem;
  height: 2.1rem;
  max-width: 2.1rem;
  margin: 0 0.12rem;
  opacity: 0.66;
  overflow: hidden;
  transition: max-width 220ms cubic-bezier(0.23, 1, 0.32, 1), margin 220ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 160ms ease, transform 150ms ease;
}
@media (hover: hover) and (pointer: fine) {
  #gis-planet-dock .planet-node:hover { opacity: 1; transform: scale(1.12); }
  #gis-planet-dock .planet-node.is-current:hover { transform: none; }
}
#gis-planet-dock .planet-node:focus-visible { opacity: 1; outline: 2px solid rgba(var(--nav-accent-rgb), 0.85); outline-offset: 1px; }
#gis-planet-dock .planet-node.is-current {
  opacity: 1;
  box-shadow: 0 0 0 1px rgba(var(--nav-accent-rgb), 0.9), 0 0 14px rgba(var(--nav-accent-rgb), 0.35);
}

/* Collapsed: every world folds away, sideways, into the control. */
#gis-planet-dock.is-collapsed { padding: 0.22rem; }
#gis-planet-dock.is-collapsed .planet-node {
  max-width: 0;
  margin: 0;
  opacity: 0;
  box-shadow: none;
  pointer-events: none;
}
#gis-planet-dock.is-collapsed .gis-planet-toggle {
  width: auto;
  padding: 0 0.55rem;
  margin-left: 0;
  gap: 0.35rem;
  border-left: 0;
  border-radius: calc(1.1rem * var(--skin-round, 1));
  opacity: 0.9;
}
.gis-planet-worlds { display: none; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; }
#gis-planet-dock.is-collapsed .gis-planet-worlds { display: inline; }

/* The collapse control: the bar's last segment, behind a hairline divider. */
#gis-planet-dock .gis-planet-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.7rem;
  height: 2.1rem;
  margin-left: 0.3rem;
  padding: 0;
  border: 0;
  border-left: 1px solid rgba(var(--skin-data-rgb, 0, 229, 255), 0.22);
  border-radius: 0 calc(1.1rem * var(--skin-round, 1)) calc(1.1rem * var(--skin-round, 1)) 0;
  background: transparent;
  color: inherit;
  opacity: 0.72;
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
  transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
}
@media (hover: hover) and (pointer: fine) {
  #gis-planet-dock .gis-planet-toggle:hover { opacity: 1; color: rgb(var(--nav-accent-rgb)); background: rgba(var(--nav-accent-rgb), 0.1); }
}
#gis-planet-dock .gis-planet-toggle:focus-visible { opacity: 1; outline: 2px solid rgba(var(--nav-accent-rgb), 0.85); outline-offset: -2px; }
#gis-planet-dock .gis-planet-toggle:active { transform: scale(0.94); }
.gis-planet-caret { display: block; transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1); }
/* Open, it points in (fold); folded, it points out (unfold). */
#gis-planet-dock.is-collapsed .gis-planet-caret { transform: rotate(180deg); }

@media (max-height: 560px) and (orientation: landscape) {
  #gis-planet-dock.gis-planet-dock { bottom: 0.3rem; padding: 0.14rem 0.14rem 0.14rem 0.28rem; }
  #gis-planet-dock .planet-node { width: 1.6rem; height: 1.6rem; max-width: 1.6rem; }
  #gis-planet-dock .gis-planet-toggle { height: 1.6rem; }
}
@media (prefers-reduced-motion: reduce) {
  #gis-planet-dock .planet-node, .gis-planet-caret { transition: opacity 150ms ease; }
  #gis-planet-dock .planet-node:hover, #gis-planet-dock .gis-planet-toggle:active { transform: none; }
}
/* No blur wanted: the panel colour, solid. */
@media (prefers-reduced-transparency: reduce) {
  #gis-planet-dock.gis-planet-dock { background: rgb(var(--skin-panel, 22, 9, 51)); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
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
  // A chevron pointing back along the bar: open, it folds the worlds in.
  toggle.innerHTML = '<span class="gis-planet-worlds" aria-hidden="true">Worlds</span>'
    + '<span class="gis-planet-caret" aria-hidden="true">&#8249;</span>';
  toggle.addEventListener("click", () => setCollapsed(!isCollapsed()));

  // The strip first, the control as the bar's last segment -- one object.
  dock.appendChild(strip);
  dock.appendChild(toggle);
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

/**
 * COLLAPSED BY DEFAULT. The worlds strip is a place to GO, not a thing to
 * read, and it sat open across the foot of every page taking a band of the
 * view for a choice most sessions never make. An explicit choice is still
 * remembered in both directions -- only the absence of one changed.
 */
function storedCollapsed() {
  try {
    const stored = window.localStorage?.getItem(STORE_KEY);
    return stored === null || stored === undefined ? true : stored === "1";
  } catch { return true; }
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
