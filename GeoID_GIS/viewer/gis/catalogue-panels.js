/**
 * The catalogue, drawn where each dataset belongs rather than all in one list.
 *
 * Data · Vectors & Shapes began as the one list of everything, which made it a
 * list sorted by FILE FORMAT: a plate boundary beside a coastline beside a
 * volcano, because all three arrive as GeoJSON. Nobody looks for the world's
 * faults under "Vectors & Shapes", or for its rivers under a heading that also
 * holds country borders.
 *
 * So a dataset names its home in `global-data.js` and this mounts one list per
 * home:
 *
 * | home | where it appears |
 * | --- | --- |
 * | `hydrology` | Hydrology · Water bodies — coastlines, rivers, lakes |
 * | `geology-tectonics` | Geology · Tectonics — plates, faults, stress |
 * | `geology-volcanoes` | Geology · Volcanoes — the Smithsonian GVP |
 *
 * Each is the same `renderCatalogue` rows from the same catalogue, so a layer
 * ticked here is an ordinary layer with its symbology, click card, legend entry
 * and export — and `polygons.js` draws only what has NO home, so every dataset
 * is on exactly one list. Two lists for one dataset is how a tick in one place
 * fails to explain the tick already showing in the other.
 *
 * This module replaced `tectonics-panel.js`, which was this for one home. The
 * second and third home would have been two more copies of the same forty
 * lines, and the copies are what drift.
 */

import {
  HOMES, grouped, addDataset, layerForDataset,
} from "./global-data.js?v=20260905-ffb0892";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260905-ffb0892";
import { mathsFor } from "./equations.js?v=20260905-ffb0892";

const byId = (id) => document.getElementById(id);

/** The status line under a list is the host's id with `-status` for `-catalogue`. */
const statusIdFor = (hostId) => hostId.replace(/-catalogue$/, "-status");

function say(hostId, message) {
  const node = byId(statusIdFor(hostId));
  if (node) node.textContent = message;
}

/** Which of this module's homes carries a share of the GEE catalogue. */
const GEE_SHARE = { hydrology: "hydrology" };

/**
 * TILED LAYERS AS CATALOGUE ROWS.
 *
 * Two of these lists hold a layer `global-data.js` cannot describe, because it
 * is not a file: the world's contacts and faults, and the glacier inventory.
 * Both are tile services driven by `geology-panel.js`'s own machinery, and
 * both were drawn as a bespoke tick — one appended after the list here, one
 * built by `ice-cover-panel.js` above it. Two shapes of control for one kind
 * of thing, and neither carried the ⓘ every row beside it has.
 *
 * They are ordinary ENTRIES now, merged into the list for their home before it
 * is drawn, so they take the same row, the same group heading and the same
 * info card as everything else. What is per-layer is only how it loads: each
 * declares `ready`, `layerOf`, `load` and `unload` against its own module's
 * seam, and this file knows nothing else about either of them.
 */
const TILED = {
  "geology-tectonics": [{
    id: "macrostrat-lines",
    group: "Tectonics",
    label: "World contacts and faults (Macrostrat)",
    title: "The lines the source maps draw between units — contacts, thrusts, "
      + "normal faults — from the Macrostrat Burwell compilation, CC BY 4.0. "
      + "Tiled: follows the view like the world geology does.",
    info: {
      summary: "The contacts, thrusts and normal faults the source surveys "
        + "draw between their units, streamed as vector tiles and refined as "
        + "you fly in — the line layer of the same compilation the world "
        + "geological map comes from.",
      citation: "Macrostrat Burwell compilation — CC BY 4.0",
    },
    ready: () => Boolean(window.GeoIDGeology?.load),
    /**
     * By dataset id AND by name: `geologyDataset` is stamped a beat after the
     * layer registers, and the layer-change event that redraws this row fires
     * in between — matched by id alone, the fresh row read "not loaded" for a
     * layer that was, and the tick unchecked itself while the lines drew.
     */
    layerOf: () => (window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => l.geologyDataset === "macrostrat-lines"
        || l.name === "World contacts and faults (Macrostrat)") || null,
    load: () => window.GeoIDGeology.load("macrostrat-lines"),
    // What an ordinary row's `addDataset` reports for itself. The inventory
    // needs none: it writes its own, richer, line when its tiles have landed.
    added: "World contacts and faults added. Macrostrat, CC BY 4.0.",
    unload: (layer) => {
      // A tiled layer holds GPU buffers for every tile it has built, and
      // removing the record does not free them.
      layer?.tiled?.dispose?.();
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
    },
  }],
  "geology-soil": [{
    id: "soil-dsmw",
    group: "Global map",
    label: "Soils of the world (FAO/UNESCO)",
    title: "The FAO/UNESCO Soil Map of the World — 34,112 polygons over 123 "
      + "dominant soil units at 1:5,000,000 — baked into vector tiles on this "
      + "site. Streams and sharpens as you fly in, like the geological map.",
    info: {
      summary: "FAO's digitised 1:5,000,000 sheets: every polygon carries its "
        + "dominant soil unit, that unit's FAO name, and — for 28,144 of them "
        + "— FAO's own measured topsoil properties: sand, silt and clay "
        + "percentages, pH, organic carbon and bulk density. Finer soil data "
        + "exists (SoilGrids is 250 m) and is a raster, so it is a companion "
        + "to this map rather than a sharper version of it.",
      citation: "FAO/UNESCO (2007). Digital Soil Map of the World v3.6 — CC BY 4.0",
    },
    ready: () => Boolean(window.GeoIDSoilCover?.load),
    layerOf: () => window.GeoIDSoilCover?.layerOf?.() || null,
    load: () => window.GeoIDSoilCover.load(),
    // None: the layer writes its own richer line once its tiles have landed,
    // the way the glacier inventory does.
    unload: (layer) => {
      // A tiled layer holds GPU buffers for every tile it has built, and
      // removing the record does not free them.
      layer?.tiled?.dispose?.();
      window.GeoIDSoilCover?.remove?.();
      window.GeoIDSoilCover?.say?.("");
    },
  },
  {
    /**
     * A COG, not a pyramid — the one dataset here that needed no bake at all.
     * Its overviews are already in the file and the bucket answers byte
     * ranges, so the page reads the window and the level a view deserves.
     */
    id: "soil-thickness",
    group: "Global map",
    label: "Soil and sediment thickness (Pelletier)",
    title: "Modelled thickness of the permeable layers above bedrock — soil, "
      + "regolith and sedimentary deposits — on a 1 km grid, 0 to 50 m. Read "
      + "from a Cloud-Optimised GeoTIFF: the window this view needs, at the "
      + "resolution it can show.",
    info: {
      summary: "How much unconsolidated material sits above bedrock, which is "
        + "the companion to the slope map rather than to the soil map beside "
        + "it: FAO says what the soil IS, this says how much there is to "
        + "move. A MODEL, calibrated against measured soil thickness in the "
        + "US and Europe and against depth-to-bedrock from US groundwater "
        + "wells — and a weighted mosaic of its own hillslope and "
        + "valley-bottom grids, weighted by area and by topographic wetness "
        + "index, because all the water leaves through the valley bottoms "
        + "whatever fraction of the ground they are. Clipped at 60°S.",
      citation: "Pelletier, J.D. et al. (2016), ORNL DAAC — doi:10.3334/ORNLDAAC/1304",
      // A model, and the card says whose: the thickness is Pelletier's
      // arithmetic and only the 8-bit banding is ours.
      maths: mathsFor("soil-thickness"),
    },
    ready: () => true,
    layerOf: () => (window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => l.name === "Soil and sediment thickness (Pelletier)") || null,
    load: async () => {
      const mod = await import(`./soil-thickness.js${new URL(import.meta.url).search}`);
      const out = await mod.addThickness();
      // The layer is the truth about whether it loaded, never the press.
      if (!out?.ok) throw new Error(out?.message || "it could not be read");
      return out.layer;
    },
    unload: async () => {
      const mod = await import(`./soil-thickness.js${new URL(import.meta.url).search}`);
      mod.removeThickness();
    },
  },
  {
    id: "glim-lithology",
    group: "Surface lithology",
    label: "Surface lithology (GLiM)",
    title: "GLiM — the Global Lithological Map, 1,235,259 polygons of what "
      + "rock is exposed at the surface, about 1:3,750,000. Baked into vector "
      + "tiles on this site; streams and sharpens as you fly in.",
    info: {
      summary: "What rock is at the SURFACE, which is a different question "
        + "from both of its neighbours: Macrostrat maps the bedrock formation "
        + "and FAO maps the soil that formed on it. Sixteen lithological "
        + "classes — sediments, volcanics, plutonics, metamorphics — about a "
        + "hundred times the detail of previous global lithological maps, and "
        + "thirty-six times the polygon count of the soil map.",
      citation: "Hartmann & Moosdorf (2012), doi:10.1029/2012GC004370",
    },
    ready: () => Boolean(window.GeoIDGlimCover?.load),
    layerOf: () => window.GeoIDGlimCover?.layerOf?.() || null,
    load: () => window.GeoIDGlimCover.load(),
    unload: (layer) => {
      layer?.tiled?.dispose?.();
      window.GeoIDGlimCover?.remove?.();
      window.GeoIDGlimCover?.say?.("");
    },
  }],
  "geology-ice": [{
    id: "glaciers-rgi7",
    group: "Global inventory",
    label: "Glaciers and ice caps (RGI 7.0)",
    title: "Randolph Glacier Inventory 7.0 (RGI Consortium 2023, NSIDC, "
      + "CC BY 4.0), baked into vector tiles on this site — streams and "
      + "sharpens as you fly in, like the geological map.",
    info: {
      summary: "192,869 glacier complexes over 706,744 km² — one outline per "
        + "ice mass around the year 2000, the reference global inventory. The "
        + "two ice sheets ride in the same tiles from Natural Earth, because "
        + "RGI maps the glaciers AROUND them and not the sheets themselves.",
      citation: "RGI Consortium (2023), NSIDC — CC BY 4.0 · ice sheets from "
        + "Natural Earth, public domain",
    },
    ready: () => Boolean(window.GeoIDIceCover?.load),
    layerOf: () => window.GeoIDIceCover?.layerOf?.() || null,
    load: () => window.GeoIDIceCover.load(),
    unload: () => window.GeoIDIceCover.remove(),
  }],
};

/** The tiled rows this home has, and whose module is actually loaded. */
function tiledFor(home) {
  return (TILED[home] || []).filter((entry) => entry.ready());
}

function draw(home, hostId) {
  const host = byId(hostId);
  if (!host) return;
  // Earth Engine's share of this subject merges into the SAME list — one
  // catalogue per tab, the service cited in the row's tooltip and in the
  // layer's metadata, never a second list of its own.
  const gee = GEE_SHARE[home] ? window.GeoIDGeeCatalogue : null;
  const geeEntries = gee?.entriesFor(GEE_SHARE[home]) || [];
  const tiled = tiledFor(home);
  const entries = [
    ...tiled.map((entry) => ({
      id: entry.id, group: entry.group, label: entry.label,
      title: entry.title, info: entry.info,
    })),
    ...grouped().flatMap(({ group, entries: list }) => list
      .filter((entry) => entry.home === home)
      .map((entry) => ({
        id: entry.id,
        group,
        label: entry.label,
        title: `${entry.summary} — ${entry.licence}`,
        info: { summary: entry.summary, citation: entry.licence },
        // Same reason as polygons.js: the row's label-detail slider captions
        // itself from the dataset's own words, and a projection that drops
        // this falls back to wording written for another catalogue.
        detailCopy: entry.detailCopy,
      }))),
    ...geeEntries,
  ];
  if (!entries.length) return;
  const tiledById = (id) => tiled.find((entry) => entry.id === id);
  renderCatalogue(host, entries, {
    // No dropdown: each list is a handful of rows inside a subsection that is
    // already folded away. A lid on a lid is one press too many.
    layerFor: (id) => (tiledById(id)?.layerOf() ?? null)
      || (gee?.owns(id) ? gee.layerFor(id) : layerForDataset(id)),
    add: async (id) => {
      const tile = tiledById(id);
      if (tile) {
        const added = await tile.load();
        /**
         * A LOAD THAT FAILED MUST UNTICK ITSELF, AND SAY SO HERE.
         *
         * Two faults in one, both measured with GLiM's pyramid missing from
         * disk. The box stayed TICKED over a layer that does not exist, which
         * is the row stating something false about the globe — and the reason
         * WAS reported, into `#gis-geology-status`, the status line of a
         * DIFFERENT SUBTAB, because the loader lives in the geology panel
         * while the row lives here. So a reader ticked a box in "Soil and
         * surface materials" and the explanation appeared one subtab over.
         *
         * This matters well beyond a missing bake: an unreachable tile host —
         * a bucket that is down, a wrong CORS policy, a custom domain that has
         * not propagated — presents in exactly this shape.
         *
         * `layerOf()` is the truth about whether anything reached the globe;
         * the redraw reads it and the tick follows.
         */
        if (!tile.layerOf?.()) {
          say(hostId, `${tile.label} could not be added — its data could not `
            + "be read. Nothing was put on the globe.");
          draw(home, hostId);
          return added;
        }
        if (tile.added) say(hostId, tile.added);
        return added;
      }
      return gee?.owns(id) ? gee.add(id)
        : addDataset(id, (message) => say(hostId, message));
    },
    remove: (id) => {
      /**
       * The untick IS the report, and the status is CLEARED on every path.
       * A sentence naming the layer that has just gone restates what the empty
       * box already says — and the line then sits there describing something
       * no longer on the globe, which is worse than saying nothing. Cleared
       * first, so a path that returns early cannot leave the last load's
       * message standing over an empty list.
       */
      say(hostId, "");
      const tile = tiledById(id);
      if (tile) return tile.unload(tile.layerOf());
      if (gee?.owns(id)) return gee.remove(id);
      const layer = layerForDataset(id);
      if (!layer) return undefined;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      return undefined;
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say(hostId, "This layer cannot be recoloured.");
    },
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("geoid-gee:catalogue", () => drawAll());
}

function drawAll() {
  Object.entries(HOMES).forEach(([home, hostId]) => draw(home, hostId));
  drawVolcanoTypes();
}

/**
 * Per-type toggles for the volcano layer — the satellite categories'
 * pattern applied to an ordinary vector layer.
 *
 * The toggle FILTERS `layer.features` (and the collection the renderer
 * reads) against a kept master list, so the dots, the click pick, and the
 * labels all answer from the same filtered set — a type switched off
 * cannot be clicked and cannot keep a label. Colours must NOT be re-derived
 * on repaint: `categoricalSymbology` assigns by frequency, and filtering
 * changes the frequencies, so the lookup is taken once from the legend the
 * layer already wears and the legend itself is left untouched — the
 * swatches beside these ticks stay meaningful while a class is hidden.
 */
const volcanoTypesOff = new Set();

function volcanoLayerBits() {
  const layer = layerForDataset("volcanoes");
  const legend = layer?.legendInfo;
  if (!layer || legend?.field !== "type_group") return null;
  return { layer, legend };
}

function applyVolcanoTypes() {
  const bits = volcanoLayerBits();
  if (!bits) return;
  const { layer, legend } = bits;
  if (!layer._allFeatures) layer._allFeatures = layer.features;
  const filtered = volcanoTypesOff.size
    ? layer._allFeatures.filter((f) => !volcanoTypesOff.has(String(f?.properties?.type_group)))
    : layer._allFeatures;
  layer.features = filtered;
  if (layer.collection) layer.collection.features = filtered;
  const lookup = new Map(legend.values.map((value, i) => [value, `#${legend.palette[i]}`]));
  layer.repaint?.((feature) =>
    lookup.get(String(feature?.properties?.type_group)) || "#8a8a8a");
  // The labels rebuild from the filtered features; off-then-on keeps the
  // chosen detail level because point-labels remembers it by layer name.
  const labels = window.GeoIDPointLabels;
  if (labels?.isLabelled?.(layer)) {
    void labels.setLabels(layer, false);
    void labels.setLabels(layer, true);
  }
}

function drawVolcanoTypes() {
  const host = byId("volcano-types");
  if (!host) return;
  const bits = volcanoLayerBits();
  host.replaceChildren();
  if (!bits) return;
  const { legend } = bits;
  legend.values.forEach((value, i) => {
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = !volcanoTypesOff.has(value);
    tick.id = `volcano-type-${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const swatch = document.createElement("span");
    swatch.style.cssText = `flex:0 0 auto;width:0.55rem;height:0.55rem;`
      + `border-radius:0.12rem;background:#${legend.palette[i]};`;
    const name = document.createElement("label");
    name.className = "gis-catalogue-name";
    name.htmlFor = tick.id;
    name.textContent = value;
    tick.addEventListener("change", () => {
      if (tick.checked) volcanoTypesOff.delete(value);
      else volcanoTypesOff.add(value);
      applyVolcanoTypes();
    });
    row.append(tick, swatch, name);
    host.appendChild(row);
  });
}

/**
 * The Volcanoes subsection's own control: how deep the labels go.
 *
 * The slider is per-DATASET rather than a global label density, because it is
 * a question about this catalogue: `label_rank` is eruption recency, and the
 * positions read as its bands ("Erupted since 1900") rather than as abstract
 * levels. It talks to `point-labels.js`, which rebuilds the label set on the
 * slider's `change`. The labels themselves are automatic — they arrive with
 * the layer, at the default level — so this slider is the one control.
 */
function wireVolcanoDetail() {
  const slider = byId("volcano-detail");
  const copy = byId("volcano-detail-copy");
  if (!slider || slider.dataset.wired) return;
  slider.dataset.wired = "1";
  const labels = window.GeoIDPointLabels;
  const caption = () => {
    if (copy) copy.textContent = labels?.DETAIL_COPY?.[Number(slider.value)] || "";
  };
  caption();
  // The caption tracks the drag; the rebuild waits for the release.
  slider.addEventListener("input", caption);
  slider.addEventListener("change", () => {
    const layer = layerForDataset("volcanoes");
    if (!layer) { say("volcanoes-catalogue", "Level saved — the labels follow when the layer is ticked on."); return; }
    labels?.setDetailLevel?.(layer, Number(slider.value));
  });
}

function init() {
  // A page with none of the hosts — a planet shell — mounts nothing rather
  // than listening for changes it will never draw.
  if (!Object.values(HOMES).some((hostId) => byId(hostId))) return;
  drawAll();
  wireVolcanoDetail();
  // Whoever took a layer off — one of these lists or the layer box — the tick
  // follows, because the list asks the catalogue rather than remembering.
  window.GeoIDImportManager?.onChange?.(drawAll);
  // The volcano type list is built FROM the legend, and the legend lands a
  // beat after the layer registers — the symbology announces itself on this
  // event, which is the moment the swatches exist to draw.
  window.addEventListener("geoid-gis:layers-changed", (event) => {
    if (event.detail?.reason === "symbology") drawVolcanoTypes();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
