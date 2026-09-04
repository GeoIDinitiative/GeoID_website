/**
 * ICE COVER — the world's glaciers, and what a geological map thinks they are.
 *
 * The first version of this subtab drew Macrostrat's own ice polygons, which
 * was right for taking them OUT of the geological map and wrong as a map of
 * ice: a geological compilation maps ice the way it maps a rock unit, so
 * Iceland arrived as a handful of blobs with Eyjafjallajokull and
 * Myrdalsjokull simply absent. Reported with a screenshot, and the screenshot
 * is the argument.
 *
 * So the primary layer here is now the **Randolph Glacier Inventory 7.0** —
 * the reference global inventory, one outline per glacier around the year
 * 2000, published by NSIDC under CC BY 4.0 — baked into vector tiles by
 * `services/bake-glaciers.py` and streamed exactly as the geology is. Measured
 * on the bake: **192,869 glacier complexes over 706,744 km2**, which is the
 * published global total to a fraction of a percent.
 *
 * The two ice SHEETS ride in the same tiles from Natural Earth, because RGI
 * maps the glaciers and ice caps AROUND Greenland and Antarctica and not the
 * ice sheets themselves — about 96% of the ice on Earth, and a "world ice
 * cover" layer without them would be a map missing almost all of its subject.
 *
 * Macrostrat's own ice stays as a second row, honestly labelled: it is what
 * the geological map holds and what the geology layer is now filtered against,
 * so being able to see it is how anyone checks that filter.
 */

import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260904-f8b0917";
import { loadIceNames, iceNameFor } from "./ice-names.js?v=20260904-f8b0917";
import { loadIceThickness, iceVolumeFor } from "./ice-thickness.js?v=20260904-f8b0917";
import { addDataset } from "./global-data.js?v=20260904-f8b0917";
import { refreshPolygonOptions, resolvePolygonExtent, promptDrawTool,
  drawnOverlayBounds } from "./extent-picker.js?v=20260904-f8b0917";
import { useIceNames, useIceVolumes } from "./ice-card.js?v=20260904-f8b0917";

/** The glacier inventory, off its own baked tiles. */
const RGI_LAYER_ID = "glaciers-rgi7";
const MANIFEST = "/data/global/ice/manifest.json";

/**
 * TWO COLOURS, because there are two things here and the difference matters.
 *
 * A glacier is an inventory entry with an outline, an area and an id; an ice
 * sheet is a continent of ice from a different source at a different scale.
 * Painting them alike would say the map knows the same amount about both.
 */
const GLACIER_COLOUR = "#cfe8f5";
const SHEET_COLOUR = "#eaf7ff";

/** A pale outline, so two touching ice caps are two ice caps. */
const ICE_CONTACTS = { mode: "shade", shade: 0.72, opacity: 0.5 };

let manifestOnce = null;

/**
 * ONE STATUS LINE for the subtab — `#ice-status`, which is also where
 * `catalogue-panels` writes (a host's id with `-catalogue` swapped for
 * `-status`). The panel used to build a second paragraph of its own above the
 * catalogue's, so a tick and a tiled load reported into two different places.
 */
function say(message) {
  const node = document.getElementById("ice-status");
  if (node) node.textContent = message || "";
}

/**
 * What the bake holds, for the sentence under the tick.
 *
 * The counts are read from the manifest rather than written into this file:
 * a number typed into a panel is a number that goes stale the next time the
 * inventory is baked, and the bake already records what it wrote.
 */
function inventory() {
  if (!manifestOnce) {
    manifestOnce = fetch(MANIFEST)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return manifestOnce;
}

async function loadInventory() {
  /**
   * THE NAMES, fetched alongside the tiles rather than inside them.
   *
   * RGI's complexes carry no name at all, so without this a click reads
   * "Glacier complex, Iceland" over Mýrdalsjökull. Started first and awaited
   * after the layer, so the fetch overlaps the build instead of delaying it.
   */
  const names = Promise.all([
    loadIceNames().then(() => useIceNames(iceNameFor)),
    /**
     * And how much ice is in each one. 5.5 MB, fetched alongside the tiles and
     * awaited after them, so it overlaps the build rather than delaying it.
     */
    loadIceThickness().then(() => useIceVolumes(iceVolumeFor)),
  ]).catch(() => {});
  const layer = await loadDerivedGeologyMap({
    id: RGI_LAYER_ID,
    label: "Glaciers and ice caps (RGI 7.0)",
    /**
     * ITS OWN PYRAMID, and no remote behind it. `kind` is the layer name
     * inside the tiles, which the bake writes as `ice`.
     */
    tiles: { manifest: MANIFEST, kind: "ice" },
    // Nothing to filter: these tiles are ice and only ice, and the geology's
    // own ice predicate reads a `lith` column this source does not have.
    featureFilter: null,
    colourFor: (f) => (f?.properties?.kind === "Ice sheet" ? SHEET_COLOUR : GLACIER_COLOUR),
    contacts: ICE_CONTACTS,
    // RGI's, not Macrostrat's — see the note on `credit` in geology-panel.js.
    credit: "Randolph Glacier Inventory 7.0 (RGI Consortium 2023, NSIDC), "
      + "CC BY 4.0; ice sheets from Natural Earth, public domain.",
    /**
     * WHERE IT CAME FROM, for the Metadata tab — which is where a dataset says
     * this now that the subtab's own "Sources" fold has gone. Both sources are
     * named because the layer draws both: RGI's complexes and, from the same
     * pyramid, the Natural Earth sheets RGI does not map.
     */
    metadata: {
      source: "Randolph Glacier Inventory 7.0 (RGI Consortium 2023, NSIDC) · "
        + "ice sheets and shelves from Natural Earth 1:10m",
      citation: "RGI Consortium (2023). Randolph Glacier Inventory — A Dataset "
        + "of Global Glacier Outlines, Version 7.0. NSIDC, CC BY 4.0, "
        + "doi:10.5067/f6jmovy5navz. Ice sheets: Natural Earth, public domain.",
      crs: "EPSG:4326",
      format: "vector tiles (MVT), baked on this site",
    },
    legendInfo: {
      palette: [GLACIER_COLOUR.replace("#", ""), SHEET_COLOUR.replace("#", "")],
      labels: ["Glacier or ice cap (RGI 7.0)", "Ice sheet (Natural Earth)"],
      values: ["Glacier or ice cap", "Ice sheet"],
      categorical: true, classed: true, field: "Ice cover",
    },
  });
  if (!layer) return null;
  await names;
  const held = await inventory();
  /**
   * COUNT AFTER THE TILES LAND, AND OFF THE LAYER THE MANAGER HOLDS NOW.
   *
   * Two traps in one line. `loadDerivedGeologyMap` resolves when the layer
   * exists and its tiles arrive a beat later, so an immediate read says "0 in
   * view" over a map that is plainly drawing — measured, exactly that. And a
   * tiled layer REBUILDS ITSELF into a new record whenever the view settles,
   * so the handle returned a moment ago is a snapshot: the count has to be
   * looked up again rather than read off it.
   */
  await new Promise((done) => window.setTimeout(done, 1500));
  const live = (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.geologyDataset === RGI_LAYER_ID) || layer;
  const drawn = (live.features || []).length;
  say(held
    ? `${held.glaciers.toLocaleString()} glacier complexes over `
      + `${Math.round(held.area_km2).toLocaleString()} km², plus the two ice `
      + `sheets. ${drawn.toLocaleString()} in view; it sharpens as you fly in.`
    : `${drawn.toLocaleString()} ice polygons in view.`);
  return layer;
}

/**
 * CHANGE OVER TIME IS A FETCH, so it asks which ground first.
 *
 * The layer was a catalogue tick, and a tick is the wrong control for it: what
 * this costs and what it covers both depend on the box. Measured over the
 * Valais Alps, GLIMS holds 15,568 outlines for one 1.2° × 0.9° box — a
 * continent-sized tick would be a download nobody asked for, and a tick that
 * silently used whatever shape happened to be on the globe would answer a
 * question the reader never put.
 *
 * So it is a subtab built like the GFS card: an extent select listing every
 * drawn shape and every loaded layer, a two-press Draw button, a Fetch that
 * runs the same connector, and a status line that says what came back.
 */
function say2(message) {
  const node = document.getElementById("ice-change-status");
  if (node) node.textContent = message || "";
}

/** What the fetch actually found, in one line. */
function summarise(layer) {
  const features = layer?.features || [];
  if (!features.length) return "Nothing with repeat outlines in that area.";
  const rates = features.map((f) => f.properties.change_pct_yr)
    .filter(Number.isFinite).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;
  const dates = features.flatMap((f) => [f.properties.first_date, f.properties.last_date])
    .filter(Boolean).sort();
  const coverage = features.find((f) => f.properties.archive_coverage)
    ?.properties.archive_coverage;
  const window = features.find((f) => f.properties.window)?.properties.window;
  return `${features.length.toLocaleString()} glaciers with repeat outlines`
    + (window ? ` between ${window}` : "")
    + (median === null ? "" : `, median ${median > 0 ? "+" : ""}${median.toFixed(2)}% a year`)
    + (dates.length ? `, spanning ${dates[0].slice(0, 4)}–${dates[dates.length - 1].slice(0, 4)}` : "")
    + ". An area change is not a mass balance."
    + (coverage ? ` This fetch held ${coverage}.` : "");
}

/** The typed box, when that is the choice — the weather card's own fallback. */
function typedBounds() {
  const read = (id) => Number(document.getElementById(id)?.value);
  const north = read("ice-change-north");
  const south = read("ice-change-south");
  const west = read("ice-change-west");
  const east = read("ice-change-east");
  if (![north, south, west, east].every(Number.isFinite)) return null;
  if (north <= south || east <= west) return null;
  return { north, south, west, east };
}

function wireChange() {
  const select = document.getElementById("ice-change-extent");
  const draw = document.getElementById("ice-change-draw");
  const run = document.getElementById("ice-change-run");
  if (!select || !draw || !run || run.dataset.wired) return;
  run.dataset.wired = "1";

  /**
   * EVERY GROUND THE APP KNOWS, in one list: the shapes drawn by hand, the
   * layers somebody imported, and the catalogue layers this site ships — the
   * weather card's arrangement, because "which patch of ground" is one
   * question and this app answers it in one place.
   */
  refreshPolygonOptions(select, "drawn", { allLayers: true });
  const bounds = document.getElementById("ice-change-bounds");
  const showBounds = () => { if (bounds) bounds.hidden = select.value !== "bounds"; };
  select.addEventListener("change", showBounds);
  showBounds();
  // The named extents follow the layers: a shape captured by any fetch should
  // be offerable here at once.
  window.GeoIDImportManager?.onChange?.(() => {
    refreshPolygonOptions(select, "drawn", { allLayers: true });
  });

  /**
   * The GFS card's two-press gesture, kept exactly: the first press with
   * nothing drawn arms the tool and says so; the second claims the shape as a
   * real layer, so it can be reused, clipped and exported like any other.
   */
  draw.addEventListener("click", () => {
    const drawn = drawnOverlayBounds();
    if (!drawn) {
      select.value = "drawn";
      promptDrawTool();
      say2("Draw the area on the globe — box, circle or polygon — then press this again to claim it.");
      return;
    }
    const captured = window.GeoIDDrawnLayers?.captureDrawn?.({ name: "Glacier change fetch area" });
    refreshPolygonOptions(select, "drawn", { allLayers: true });
    select.value = captured?.ok && captured.layer ? `layer:${captured.layer.id}` : "drawn";
    say2(`Area set: ${drawn.south.toFixed(2)}–${drawn.north.toFixed(2)}°N, `
      + `${drawn.west.toFixed(2)}–${drawn.east.toFixed(2)}°E.`
      + (captured?.ok ? " Listed in Workspace." : ""));
  });

  /**
   * THE SEQUENCE, not the summary.
   *
   * The change layer answers "how much" in one number per glacier; this plays
   * the archive's own dates with imagery from each one underneath. Same box,
   * same window, same fetch — a different reading of it.
   */
  document.getElementById("ice-change-play")?.addEventListener("click", async () => {
    const box = select.value === "bounds" ? typedBounds() : resolvePolygonExtent(select.value);
    if (!box || box.error) { say2(box?.error || "Mark out an area first."); return; }
    const from = document.getElementById("ice-change-from")?.value || null;
    const to = document.getElementById("ice-change-to")?.value || null;
    try {
      const mod = await import(`./glacier-timelapse.js${new URL(import.meta.url).search}`);
      await mod.startTimelapse({
        bounds: box, from, to, onStatus: say2,
        source: document.getElementById("ice-change-imagery")?.value || "auto",
        colourBy: document.getElementById("ice-change-colour")?.value || "age",
        outlines: document.getElementById("ice-change-outlines")?.checked !== false,
      });
    } catch (error) {
      say2("The time-lapse could not be built for that area.");
    }
  });

  /**
   * THE OUTLINES TICK IS ONE STATE SEEN THREE TIMES — this box, the bar's ◇
   * and the layer's eye in Workspace. It commits through the hierarchy's own
   * `setVisible` while a sequence is running, and reads back from the layer on
   * every layers-changed, so pressing any of the three moves the other two.
   * With nothing running it is simply what the next build starts as.
   */
  const outlines = document.getElementById("ice-change-outlines");
  const lapseLayer = () => (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => /^Glacier time-lapse/.test(l.name || ""));
  outlines?.addEventListener("change", () => {
    const layer = lapseLayer();
    if (layer) window.GeoIDLayerHierarchy?.setVisible?.(layer, outlines.checked);
  });
  window.addEventListener("geoid-gis:layers-changed", () => {
    const layer = lapseLayer();
    if (layer && outlines) outlines.checked = layer.visible !== false;
  });

  run.addEventListener("click", async () => {
    const box = select.value === "bounds" ? typedBounds() : resolvePolygonExtent(select.value);
    if (!box) {
      say2(select.value === "bounds"
        ? "Type all four bounds — north above south, east above west."
        : "Mark out an area first — draw one, or choose a layer to use its extent.");
      return;
    }
    if (box.error) { say2(box.error); return; }
    /**
     * A WINDOW OF TIME, applied on the server. Blank ends mean "everything the
     * archive holds"; one end alone is a real question — "everything since
     * 1990" — and the connector turns it into CQL either way.
     */
    const from = document.getElementById("ice-change-from")?.value || null;
    const to = document.getElementById("ice-change-to")?.value || null;
    if (from && to && from >= to) {
      say2("The From date has to come before the To date.");
      return;
    }
    run.disabled = true;
    say2("Reading the archive over that area…");
    try {
      /**
       * The picker's box, handed to the ONE import path. `addDataset` fetches
       * through the connector, files the provenance and paints the graduated
       * legend, so this subtab adds a question and no second pipeline.
       */
      const result = await addDataset("conn-glims-change", say2, {
        bbox: {
          minLon: box.west, minLat: box.south,
          maxLon: box.east, maxLat: box.north,
        },
        from, to,
      });
      if (!result?.ok) return;
      const layer = (window.GeoIDImportManager?.getLayers?.() || [])
        .find((l) => /GLIMS/.test(l.name || "") && /change/i.test(l.name || ""));
      say2(summarise(layer));
    } catch (error) {
      say2("The archive could not be read for that area.");
    } finally {
      run.disabled = false;
    }
  });
}

/** Mount when the host exists — the pattern `earth-data-panel.js` documents. */
function whenHost(selector, place) {
  let tries = 0;
  const tick = () => {
    const host = document.querySelector(selector);
    if (host) { place(host); return; }
    if ((tries += 1) < 50) window.setTimeout(tick, 300);
  };
  tick();
}

export function init() {
  whenHost("#ice-change-run", wireChange);
}

/**
 * THE INVENTORY IS A CATALOGUE ROW, and this is the seam it is driven from.
 *
 * It cannot be a `global-data.js` entry because it is not a file: it is this
 * site's own baked pyramid, streamed and refined by `geology-panel.js`'s
 * machinery. So `catalogue-panels.js` draws the row — same shape, same group
 * heading, same ⓘ as the ice sheets and the live archive beside it — and asks
 * here to load and unload it. The panel used to draw its own tick above the
 * catalogue, which is two kinds of control for one kind of thing.
 */
if (typeof window !== "undefined") {
  window.GeoIDIceCover = {
    load: loadInventory,
    remove: () => removeDerivedGeologyMap(RGI_LAYER_ID),
    layerOf: () => (window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => l.geologyDataset === RGI_LAYER_ID) || null,
    say,
  };
  window.GeoIDIceCoverPanel = { init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
