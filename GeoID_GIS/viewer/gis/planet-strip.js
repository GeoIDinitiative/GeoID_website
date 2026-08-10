import { BODIES, currentBodyId } from "./bodies.js?v=20260810-3675f72";

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
      // The page you are on is not a link to itself.
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
 * Leaving Model mode by switching worlds throws the model away, because each
 * world is a separate page. A confirm is the whole guard — the studio has no
 * autosave, and silently discarding someone's geometry because they clicked a
 * planet icon is the kind of loss that is nobody's fault and entirely ours.
 */
function guardModelLoss(event) {
  if (document.body.dataset.viewMode !== "model") return;
  const state = window.GeoIDMeshStudio?.state;
  const built = (state?.solids?.length || 0) + (state?.fields?.length || 0);
  if (!built) return;
  const noun = built === 1 ? "1 object" : `${built} objects`;
  if (!window.confirm(
    `Leaving for another world will discard this model (${noun}). `
    + "Save or export it first if you want to keep it.\n\nSwitch anyway?")) {
    event.preventDefault();
  }
}

export function init() {
  if (document.getElementById(STRIP_ID)) return;
  const strip = build();
  strip.addEventListener("click", (event) => {
    if (event.target.closest("a[href]")) guardModelLoss(event);
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
