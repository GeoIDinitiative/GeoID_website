/**
 * RESET WORKSPACE — back to what the page opened with.
 *
 * The Workspace box lists what is on the globe; the nav bar's ticks are what
 * put it there. A reset that cleared one and not the other would leave a tick
 * standing over an empty globe, or a layer with nothing in the nav bar to say
 * where it came from, so this goes through the same doors the page itself
 * uses, and the two stay one state:
 *
 * 1. Any time-lapse is stopped (its plot row goes with it).
 * 2. Every layer is removed except the live events feed, which the page
 *    opens with. Removing a catalogue layer is what unticks its row: a
 *    catalogue tick is drawn from `layerForDataset`, never remembered.
 * 3. The live feed is put back as it launched: on, its default feeds ticked,
 *    visible at full strength.
 * 4. The launch defaults (`defaultOn` in global-data.js) are loaded again
 *    through `loadLaunchDefaults`, after forgetting any untick of them, so
 *    their visibility, opacity, colours and order are the launch's own --
 *    there is no second copy of what "default" means to drift from it.
 * 5. On Earth, the place-name rows (OFF at launch there) are switched off;
 *    the basemap's eye is switched back on; a live, unsaved drawing is put
 *    away.
 *
 * The pure halves (`partitionForReset`, `sourceChanges`) are what the tests
 * pin; the rest is the page's own seams, asked for at the moment of reset.
 */

import { stopPlayer } from "./timelapse-player.js?v=20261024-6c43adb";
import { defaultEnabled, SOURCES } from "./event-sources.js?v=20261024-6c43adb";

const search = new URL(import.meta.url).search;

/** The events feed's own row, the one layer the page opens with that is not a catalogue dataset. */
export const EVENTS_LAYER_NAME = "Live events";

/** Which layers go, and which one stays. */
export function partitionForReset(layers, { keep = (layer) => layer?.adopted && layer?.name === EVENTS_LAYER_NAME } = {}) {
  const out = { remove: [], keep: [] };
  (layers || []).forEach((layer) => {
    if (!layer) return;
    (keep(layer) ? out.keep : out.remove).push(layer);
  });
  return out;
}

/** The feed ticks to change so that exactly the default feeds are on. */
export function sourceChanges(defaults, isOn, all) {
  const want = new Set(defaults || []);
  return (all || []).filter((id) => Boolean(isOn(id)) !== want.has(id))
    .map((id) => ({ id, on: want.has(id) }));
}

/** The Explorer ▸ Locations rows, as the Workspace's own labels row reads them. */
const LOCATION_BOXES = "#locations-section input[type=checkbox]:not(#locations-master-toggle):not(#moon-toggle)";

function tick(box, on) {
  if (!box || box.checked === on) return;
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

let busy = false;

/**
 * Put the Workspace and the nav bar back as the page opened them. Resolves to
 * `{ removed, reloaded }`; refuses (resolves `{ busy: true }`) while a reset
 * is already running, since the launch defaults take a few seconds to land.
 */
export async function resetWorkspace({ onStatus = () => {} } = {}) {
  if (busy) return { busy: true };
  busy = true;
  try {
    const manager = window.GeoIDImportManager;
    const hierarchy = window.GeoIDLayerHierarchy;
    onStatus("Resetting the workspace…");

    // 1. A sequence first, so its own teardown does not race the removals.
    try { stopPlayer({ reason: "reset" }); } catch (error) { /* nothing was playing */ }

    // 2. Everything but the live feed.
    const { remove, keep } = partitionForReset(manager?.getLayers?.() || []);
    remove.forEach((layer) => {
      try { manager?.removeLayer?.(layer.id); } catch (error) {
        console.warn("[GeoID GIS] reset could not remove a layer:", error.message);
      }
    });

    // 3. The live feed as it launched.
    keep.forEach((layer) => {
      layer.userHidden = false;
      delete layer.bandOverride;
      if (layer.visible === false || layer.object3D?.visible === false) hierarchy?.setVisible?.(layer, true);
      if (Number.isFinite(layer.opacity) && layer.opacity !== 1) hierarchy?.setOpacity?.(layer, 1);
    });
    const events = window.GeoIDEvents;
    if (events?.setSourceEnabled && events?.isSourceEnabled) {
      sourceChanges(defaultEnabled(), events.isSourceEnabled, SOURCES.map((s) => s.id))
        .forEach(({ id, on }) => events.setSourceEnabled(id, on));
    }
    if (events?.setActive && events.isActive && !events.isActive()) void events.setActive(true);

    // 5. The furniture the nav bar holds outside the catalogue.
    if (window.GeoIDEarthPlaces) {
      document.querySelectorAll(LOCATION_BOXES).forEach((box) => tick(box, false));
    }
    const basemapEye = document.querySelector(".layer-row-basemap:not(.layer-row-labels) [data-role=\"visible\"]");
    tick(basemapEye, true);
    try { window.GeoIDViewer?.clearStudyArea?.(); } catch (error) { /* nothing drawn */ }

    // 4. The launch defaults, through the launch's own loader.
    const data = await import(`./global-data.js${search}`);
    data.DATASETS.filter((entry) => entry.defaultOn).forEach((entry) => data.noteDatasetChoice(entry.id, true));
    const offered = (entry) => Boolean(entry && document.getElementById(
      entry.home ? data.HOMES[entry.home] : "polygon-catalogue"));
    const before = new Set((manager?.getLayers?.() || []).map((layer) => layer.id));
    await data.loadLaunchDefaults(offered);
    const reloaded = (manager?.getLayers?.() || []).filter((layer) => !before.has(layer.id)).length;
    hierarchy?.render?.();
    onStatus(`Workspace reset — ${remove.length} layer${remove.length === 1 ? "" : "s"} removed`
      + (reloaded ? `, ${reloaded} default${reloaded === 1 ? "" : "s"} restored.` : "."));
    return { removed: remove.length, reloaded };
  } finally {
    busy = false;
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDWorkspaceReset = { reset: resetWorkspace, partitionForReset, sourceChanges };
}
