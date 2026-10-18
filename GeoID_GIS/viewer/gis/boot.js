import { ready } from "./shell.js?v=20261018-64ee85f";

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
  // FIRST: it renders the panels every module below looks its controls up in.
  "./panels.js",
  "./settings-panel.js",
  "./gee-live.js",
  "./fos.js",
  // Publishes the window seam the click cards read; it imports fos.js for the
  // strength table, so it belongs beside it.
  "./ground-profile.js",
  "./overlay-stack.js",
  // The mode bar, when a shell's header is hosting it rather than a page.
  "./mode-bar-bridge.js",
  // Core View cuts the planet in half on all ten worlds, and every layer on
  // the globe has to be cut with it -- including the ones loaded afterwards.
  "./cutaway.js",
  // A card goes when the layer it describes does: hidden, removed, unticked.
  "./card-owner.js",
  // What a locked part of the app looks like. A locked tab keeps its place and
  // wears a padlock rather than disappearing: a feature nobody can see is a
  // feature nobody knows they could have.
  "./feature-locks.js",
  // Every credential a browser holds, cleared when membership goes.
  "./credential-wipe.js",
  "./master-key.js",
  "./geoid-pipeline.js",
  "./geoid-mode.js",
  "./import-manager.js",
  "./analysis-panel.js",
  // The Model Builder tab's pipeline: study area -> layers -> surface ->
  // domain -> conditions -> a gmsh script and a FEM run spec.
  "./model-pipeline.js",
  // The gesture bar over the canvas. Earth lists it as a script tag; the
  // rocky worlds carry the same press-drag apparatus now (ported by
  // services/port-draw-tools.py), so they need the HUD that names it.
  "./draw-hud.js",
  "./add-data.js",
  "./section-activity.js",
  // Sunlight and air for the worlds that are not Earth (Earth builds its own).
  "./planet-atmosphere.js",
  // Two shelves by OUTPUT: a tool that makes a map layer is geoprocessing, one
  // that makes a table, a statistic or a chart is analysis.
  "./tool-shelves.js",
  "./pipeline-sync.js",
  "./geology-panel.js",
  "./toolbox.js",
  "./toolbox-ops.js",
  "./sidecar-client.js",
  "./tool-search.js",
  "./tool-dialog.js",
  "./charts.js",
  "./time.js",
  "./edit-tools.js",
  "./feature-popup.js",
  "./forecast.js",
  "./location-tools.js",
  "./point-extract.js",
  "./drawn-layers.js",
  // Explorer ▸ Locations ▸ Feature outlines (IAU): the named features' extents
  "./nomenclature-outlines.js",
  // Click-to-drop points, filed as a layer; self-gates on the seams a
  // world offers (gas giants never build the button).
  "./point-tool.js",
  // Keeps a saved shape's area written inside it, on every world.
  "./area-labels.js",
  "./panel-styles.js",
  "./symbology.js",
  "./symbology-panel.js",
  "./batch.js",
  "./batch-panel.js",
  "./georeference.js",
  "./georeference-panel.js",
  "./wfs-import.js",
  "./demo-layers.js",
  "./model-studio.js",
  "./gales-results-panel.js",
  "./mesh-quality-panel.js",
  "./studio-setup-panel.js",
  "./real-mesh-panel.js",
  "./studio-workspaces.js",
  "./results-analysis-panel.js",
  "./results-second-view.js",
  "./studio-launchpad.js",
  "./results-toolbar.js",
  "./studio-help.js",
  "./studio-palette.js",
  "./studio-toast.js",
  "./layer-properties.js",
  "./layer-hierarchy.js",
  "./table-editor.js",
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

const VERSION = "?v=20261018-64ee85f";

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

  // Settled: the panel can be shown, and anything waiting outside the page can
  // stop waiting. `GeoIDGisPending` is set at module evaluation rather than
  // inside boot(), so a page that never runs this file is simply NOT PENDING —
  // a watcher cannot tell "not started" from "absent" if the flag only appears
  // once work begins, and Earth's viewer loads its modules as its own script
  // tags and never comes through here.
  document.documentElement.classList.remove("gis-arranging");
  window.GeoIDGisPending = false;
  document.dispatchEvent(new CustomEvent("geoid:gis-ready"));
}

/**
 * DOWNLOAD IN PARALLEL, EVALUATE IN ORDER. boot() awaits each import before
 * starting the next, because the order above is load-bearing -- and so, on a
 * first visit, each module's download also waited for the one before it: a
 * waterfall of one round trip per file. At 60 ms of latency Jupiter's GIS
 * layer took 20.9 s to settle, against the 9 s transit waits before handing a
 * world over, so a world opened from the planet strip arrived with its panels
 * still arranging and its main thread busy -- and the second attempt, from
 * cache, was fine. `modulepreload` fetches every entry now, all at once,
 * without running any of it; boot() still evaluates them one at a time. Same
 * URLs as the imports (same stamp), or the preload is a second download.
 */
function preloadModules() {
  const head = document.head || document.documentElement;
  for (const path of MODULES) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = new URL(`${path}${VERSION}`, import.meta.url).href;
    head.appendChild(link);
  }
}

window.GeoIDGisPending = true;
preloadModules();

void boot().catch((error) => {
  // The panel must never be left hidden by a failure. The shell's own timeout
  // would clear it eventually; this clears it at once.
  console.error("[GeoID GIS] boot failed:", error);
  document.documentElement.classList.remove("gis-arranging");
  window.GeoIDGisPending = false;
});
