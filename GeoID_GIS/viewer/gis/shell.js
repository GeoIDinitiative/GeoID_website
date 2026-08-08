/**
 * Puts the GIS shell onto a page that has not got one.
 *
 * The Earth page carries the toolbox, layer box, Meshing Studio and Research
 * Hub in its own markup. Copying that into nine planet pages would be nine
 * copies to keep in step, and they would not stay in step. Instead the blocks
 * live once in gis/shell.html and this fetches them.
 *
 * Injection has to finish before the gis modules run, because they look their
 * panels up by id on load. So this module is imported first and every other
 * gis module waits on `ready` — a page that mounted its toolbox after the
 * toolbox code had already given up would look exactly like a page with no
 * toolbox at all.
 */

const SHELL_URL = "/GeoID_GIS/viewer/gis/shell.html";

/** Where each block goes, and how to tell it is already there. */
const SLOTS = {
  // The mode switch belongs in the sidebar header, beside the project button.
  "mode-switch": {
    marker: "view-mode-switch",
    place(node) {
      const header = document.querySelector(".brand-toprow")
        || document.querySelector(".brand-hero")
        || document.getElementById("ui-scroll-body");
      if (!header) return false;
      header.appendChild(node);
      return true;
    },
  },
  // The shell GIS mode folds the viewer's own panels into.
  // applyToolboxLayout returns early without it, so the toolbox is useless on
  // its own -- which is exactly what happened when this was left out.
  "geoid-group": {
    marker: "geoid-controls-group",
    place(node) {
      const list = document.getElementById("ui-scroll-body");
      if (!list) return false;
      list.insertBefore(node, list.firstChild);
      return true;
    },
  },
  // The toolbox goes at the top of the scrolling panel; toolbox.js then moves
  // the viewer's own sections into it and puts them in order.
  toolbox: {
    marker: "gis-toolbox-panels",
    place(node) {
      const list = document.getElementById("ui-scroll-body");
      if (!list) return false;
      list.insertBefore(node, list.firstChild);
      return true;
    },
  },
  // These three are full-screen or fixed, so they hang off <body>.
  "layer-dock": { marker: "layer-dock", place: (n) => !!document.body.appendChild(n) },
  "research-hub": { marker: "research-hub", place: (n) => !!document.body.appendChild(n) },
  "model-studio": { marker: "model-studio", place: (n) => !!document.body.appendChild(n) },
};

async function inject() {
  // Earth already has all of it in its own markup; nothing to do.
  const needed = Object.entries(SLOTS)
    .filter(([, slot]) => !document.getElementById(slot.marker));
  if (!needed.length) return { injected: [], skipped: "already present" };

  let html;
  try {
    const response = await fetch(SHELL_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    console.error("[GeoID GIS] could not load the shared shell:", error.message);
    return { injected: [], error: error.message };
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const injected = [];
  for (const [name, slot] of needed) {
    const template = parsed.querySelector(`template[data-slot="${name}"]`);
    if (!template) continue;
    // importNode rather than moving: the parsed document is discarded, and a
    // node still owned by it would come across without its document context.
    const fragment = document.importNode(template.content, true);
    const element = fragment.firstElementChild;
    if (!element) continue;
    if (slot.place(fragment)) injected.push(name);
  }
  return { injected };
}

/**
 * Resolves once the shell is on the page. Every gis module that looks up a
 * panel by id should await this first.
 */
export const ready = inject();

// Announced for anything that wants to know without importing this module.
ready.then((result) => {
  window.GeoIDShell = result;
  document.dispatchEvent(new CustomEvent("geoid:shell-ready", { detail: result }));
});
