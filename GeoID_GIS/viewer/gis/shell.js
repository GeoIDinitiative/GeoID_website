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

/**
 * The shell markup, stamped like every other module.
 *
 * This was fetched unstamped, so a warm browser kept its first copy for ever
 * and **every edit to the shell was invisible on the planet pages** — the
 * markup on disk and the markup on screen simply diverged, with nothing to
 * show for it. Found when a new element in the studio's mode bar was in the
 * served file and absent from the page.
 *
 * The stamp is taken off this module's own URL, which is the same trick
 * qt-layout.json needed for the same reason: `stamp.py` rewrites the import
 * above, and the fetch below then rides along.
 */
const SHELL_STAMP = new URL(import.meta.url).search || "";
const SHELL_URL = `/GeoID_GIS/viewer/gis/shell.html${SHELL_STAMP}`;
const ATLAS_CSS = "/GeoID_GIS/viewer/gis/research/atlas.css?v=20260825-3b1f093";

/**
 * The Research Hub's stylesheet, loaded here rather than from ten <head>s.
 *
 * It used to be a block inside styles.css and a second copy inside shell.css,
 * one for Earth and one for the planets, and the two drifted. One file, linked
 * once per page, cannot.
 */
function loadAtlasCss() {
  if (document.querySelector('link[data-atlas-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = ATLAS_CSS;
  link.dataset.atlasCss = "true";
  document.head.appendChild(link);
}

/**
 * Panels belong after the viewer's own name and icon, which is the order the
 * Earth page has: viewer-info, brand-hero, then the GIS groups. Inserted at the
 * top instead, the toolbox pushed the planet's title and icon to the foot of
 * the sidebar, under every tab -- which is where they were showing.
 */
function afterBrand(node) {
  const list = document.getElementById("ui-scroll-body");
  if (!list) return false;
  const brand = list.querySelector(".brand-hero")
    || list.querySelector(".viewer-info");
  if (brand) brand.after(node);
  else list.insertBefore(node, list.firstChild);
  return true;
}

/** Where each block goes, and how to tell it is already there. */
const SLOTS = {
  // The folder button opens the project dialog. It is the way in to a project
  // from any world, so it leads the sidebar header on every page, not just
  // Earth's -- a Moon study is filed under the Moon and has to be reachable
  // from the Moon.
  "project-button": {
    marker: "project-open-modal",
    place(node) {
      const header = document.querySelector(".brand-toprow");
      if (!header) return false;
      header.insertBefore(node, header.firstChild);
      return true;
    },
  },
  "project-dialog": {
    marker: "project-dialog",
    place: (n) => !!document.body.appendChild(n),
  },
  // The mode switch belongs in the sidebar header, beside the project button.
  "mode-switch": {
    marker: "view-mode-switch",
    place(node) {
      const header = document.querySelector(".brand-toprow");
      if (!header) return false;
      // Before the info and collapse buttons, which is where the Earth page
      // keeps it. Appending put the switch after them and the row read
      // backwards against every other page.
      const actions = header.querySelector(".brand-toprow-actions");
      if (actions) header.insertBefore(node, actions);
      else header.appendChild(node);
      return true;
    },
  },
  // The shell GIS mode folds the viewer's own panels into.
  // applyToolboxLayout returns early without it, so the toolbox is useless on
  // its own -- which is exactly what happened when this was left out.
  "geoid-group": {
    marker: "geoid-controls-group",
    place: afterBrand,
  },
  // The toolbox goes at the top of the scrolling panel; toolbox.js then moves
  // the viewer's own sections into it and puts them in order.
  toolbox: {
    marker: "gis-toolbox-panels",
    place: afterBrand,
  },
  // These three are full-screen or fixed, so they hang off <body>.
  "layer-dock": { marker: "layer-dock", place: (n) => !!document.body.appendChild(n) },
  "research-hub": { marker: "research-hub", place: (n) => !!document.body.appendChild(n) },
  "model-studio": { marker: "model-studio", place: (n) => !!document.body.appendChild(n) },
};

async function inject() {
  loadAtlasCss();
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
