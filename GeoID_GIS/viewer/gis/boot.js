import { ready } from "./shell.js?v=20260829-5d75f9b";

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

const VERSION = "?v=20260829-5d75f9b";

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
