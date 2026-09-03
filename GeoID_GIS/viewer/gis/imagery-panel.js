/**
 * IMAGERY OVER TIME — the Basemaps subtab that drives the imagery animator.
 *
 * Filed here because this is where imagery lives: the base textures, the tile
 * services and Earth Engine's imagery share are all in this tab, and a film of
 * the ground is the same subject seen through time.
 *
 * It asks the three questions a sequence needs and nothing else — which
 * ground, which years, which sensor — through the parts the rest of the app
 * already answers them with: `extent-picker` for the box (a drawn shape, typed
 * bounds, or any layer in Workspace by its own extent) and the GFS card's
 * two-press draw gesture. The player itself is `timelapse-player.js`, shared
 * with the glacier animator.
 *
 * NO POLYGONS, and that is the point of it being separate: anything a reader
 * wants over the film — glacier outlines, the geological map, a study area —
 * is an ordinary Workspace layer and draws above it by construction.
 */

import { refreshPolygonOptions, resolvePolygonExtent, promptDrawTool,
  drawnOverlayBounds } from "./extent-picker.js?v=20260904-cf3d814";

const search = new URL(import.meta.url).search;
const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("imagery-tl-status");
  if (node) node.textContent = message || "";
}

/** The typed box, or null unless all four are given and the way round. */
function typedBounds() {
  const read = (id) => Number(byId(id)?.value);
  const north = read("imagery-tl-north");
  const south = read("imagery-tl-south");
  const west = read("imagery-tl-west");
  const east = read("imagery-tl-east");
  if (![north, south, west, east].every(Number.isFinite)) return null;
  if (north <= south || east <= west) return null;
  return { west, south, east, north };
}

function chosenBounds() {
  const select = byId("imagery-tl-extent");
  return select?.value === "bounds" ? typedBounds() : resolvePolygonExtent(select?.value);
}

/**
 * A RANGE HAS TO START SOMEWHERE, so the dates arrive filled in — the last ten
 * years to today, which is a sequence anybody can press play on. Blank means
 * nothing useful here (unlike the glacier archive, where it means "every date
 * GLIMS holds"), so leaving them empty would only be a question with no
 * default answer.
 */
function prefillDates() {
  const from = byId("imagery-tl-from");
  const to = byId("imagery-tl-to");
  if (!from || !to || from.value || to.value) return;
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  to.value = iso(now);
  from.value = iso(new Date(Date.UTC(now.getUTCFullYear() - 10, 0, 1)));
}

export function init() {
  const run = byId("imagery-tl-run");
  const select = byId("imagery-tl-extent");
  if (!run || !select || run.dataset.wired) return;
  run.dataset.wired = "1";
  prefillDates();

  refreshPolygonOptions(select, "drawn", { allLayers: true });
  const bounds = byId("imagery-tl-bounds");
  const showBounds = () => { if (bounds) bounds.hidden = select.value !== "bounds"; };
  select.addEventListener("change", showBounds);
  showBounds();
  // The named extents follow the layers: a shape captured by any fetch should
  // be offerable here at once.
  window.GeoIDImportManager?.onChange?.(() => {
    refreshPolygonOptions(select, "drawn", { allLayers: true });
  });

  // The season is a property of a YEARLY frame; a month or a day is its own
  // window, and offering a control that does nothing is worse than none.
  const step = byId("imagery-tl-step");
  const seasonRow = byId("imagery-tl-season-row");
  const showSeason = () => { if (seasonRow) seasonRow.hidden = step?.value !== "year"; };
  step?.addEventListener("change", showSeason);
  showSeason();

  /**
   * The GFS card's two-press gesture, kept exactly: the first press with
   * nothing drawn arms the tool and says so; the second claims the shape as a
   * real layer, so it can be reused, clipped and exported like any other.
   */
  byId("imagery-tl-draw")?.addEventListener("click", () => {
    const drawn = drawnOverlayBounds();
    if (!drawn) {
      select.value = "drawn";
      showBounds();
      promptDrawTool();
      say("Draw the area on the globe — box, circle or polygon — then press this again to claim it.");
      return;
    }
    const captured = window.GeoIDDrawnLayers?.captureDrawn?.({ name: "Imagery sequence area" });
    refreshPolygonOptions(select, "drawn", { allLayers: true });
    select.value = captured?.ok && captured.layer ? `layer:${captured.layer.id}` : "drawn";
    showBounds();
    say(`Area set: ${drawn.south.toFixed(2)}–${drawn.north.toFixed(2)}°N, `
      + `${drawn.west.toFixed(2)}–${drawn.east.toFixed(2)}°E.`
      + (captured?.ok ? " Listed in Workspace." : ""));
  });

  byId("imagery-tl-stop")?.addEventListener("click", async () => {
    const mod = await import(`./imagery-timelapse.js${search}`);
    mod.stopImageryTimelapse();
    say("Sequence closed.");
  });

  run.addEventListener("click", async () => {
    const box = chosenBounds();
    if (!box) {
      say(select.value === "bounds"
        ? "Type all four bounds — north above south, east above west."
        : "Mark out an area first — draw one, or choose a layer to use its extent.");
      return;
    }
    if (box.error) { say(box.error); return; }
    run.disabled = true;
    say("Building the sequence…");
    try {
      const mod = await import(`./imagery-timelapse.js${search}`);
      await mod.startImageryTimelapse({
        bounds: box,
        from: byId("imagery-tl-from")?.value || "",
        to: byId("imagery-tl-to")?.value || "",
        step: byId("imagery-tl-step")?.value || "year",
        season: byId("imagery-tl-season")?.value || "full",
        collection: byId("imagery-tl-collection")?.value || "auto",
        datasetId: byId("imagery-tl-dataset")?.value || "",
        onStatus: say,
      });
    } catch (error) {
      say(`The sequence could not be built — ${error.message}`);
    } finally {
      run.disabled = false;
    }
  });
}

/** Mount when the host exists — the pattern `earth-data-panel.js` documents. */
let tries = 0;
const tick = () => {
  if (byId("imagery-tl-run")) { init(); return; }
  if ((tries += 1) < 50) window.setTimeout(tick, 300);
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tick);
} else {
  tick();
}
