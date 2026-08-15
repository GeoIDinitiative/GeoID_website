import { ready } from "./shell.js?v=20260816-4b17eab";

/**
 * The GIS layer's entry point on a planet page.
 *
 * Earth's page lists the gis modules as its own script tags, because its
 * markup is already there when they run. A planet page has to inject the shell
 * first, and every one of those modules looks its panels up by id the moment
 * it loads -- so they are imported here, after the shell has landed, rather
 * than raced against it. A module that ran early would find nothing and fail
 * silently, which looks exactly like a page with no GIS layer.
 *
 * One script tag per planet page, so adding a module is an edit here.
 */

const MODULES = [
  "./import-manager.js",
  "./analysis-panel.js",
  "./toolbox.js",
  "./toolbox-ops.js",
  "./tool-search.js",
  "./tool-dialog.js",
  "./model-studio.js",
  "./layer-properties.js",
  "./layer-hierarchy.js",
  "./legend-dock.js",
  "./layer-export-dialog.js",
  "./side-panels.js",
  "./project.js",
  "./polygons.js",
  "./basemap-drape.js",
  "./zoom-bar.js",
  "./research/index.js",
  "./planet-strip.js",
  "./atlas-assistant.js",
];

const VERSION = "?v=20260816-4b17eab";

async function boot() {
  const shell = await ready;
  if (shell.error) {
    console.error("[GeoID GIS] shell missing, GIS layer not started:", shell.error);
    return;
  }
  // mode-manager is a classic script, not a module, and it reads the DOM on
  // load -- so it goes in only once the panels it switches actually exist.
  await new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = `/GeoID_GIS/viewer/gis/mode-manager.js${VERSION}`;
    tag.onload = resolve;
    tag.onerror = resolve;
    document.head.appendChild(tag);
  });

  for (const path of MODULES) {
    try {
      await import(new URL(`${path}${VERSION}`, import.meta.url).href);
    } catch (error) {
      // One bad module should not take the rest of the layer down with it.
      console.error(`[GeoID GIS] ${path} failed to load:`, error.message);
    }
  }
  // mode-manager applied a mode while loading, before the modules that react
  // to it existed -- so the toolbox never got told to lay itself out. Re-apply
  // now that every consumer is present. Cheap, and idempotent by design.
  const manager = window.GeoIDModeManager;
  if (manager?.setMode && manager?.getMode) manager.setMode(manager.getMode());

  document.dispatchEvent(new CustomEvent("geoid:gis-ready"));
}

void boot();
