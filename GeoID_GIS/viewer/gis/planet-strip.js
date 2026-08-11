import { BODIES, currentBodyId } from "./bodies.js?v=20260811-b843940";

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

// Relative sizes, so the strip reads as a solar system rather than a toolbar.
const SIZES = {
  mercury: 20, venus: 26, earth: 28, moon: 18, mars: 22,
  jupiter: 40, saturn: 36, uranus: 30, neptune: 30, pluto: 18,
};

const STRIP_ID = "gis-planet-strip";

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
    node.style.setProperty("--icon-size", `${SIZES[body.id] || 24}px`);
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

function apply() {
  const strip = document.getElementById(STRIP_ID);
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
  strip.hidden = mode === "research";
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
  const strip = build();
  strip.addEventListener("click", (event) => {
    const node = event.target.closest(".planet-node");
    if (node?.dataset.planet) switchWorldInPlace(event, node.dataset.planet);
  });
  document.body.appendChild(strip);
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
