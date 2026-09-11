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
 * | `volcanic-hazards` | Hazards · Volcanic hazards — the Smithsonian GVP |
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
  HOMES, MIRRORS, grouped, addDataset, layerForDataset, loadLaunchDefaults,
} from "./global-data.js?v=20260911-2446ced";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260911-2446ced";
import { mathsFor } from "./equations.js?v=20260911-2446ced";
import { bandOf, bandRows, bandSymbology, describeFilter, magOf }
  from "./seismic-magnitude.js?v=20260911-2446ced";

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
/** A status writer for a line this file does not own a host for. */
const sayIn = (id) => (message) => {
  const node = byId(id);
  if (node) node.textContent = message || "";
};

const TILED = {
  "hydrology": [{
    id: "river-zones",
    group: "Water bodies",
    label: "River corridor zones (GRWL)",
    title: "Incremental zones round every river, sized by the river's own width: "
      + "seasonal margin, migration belt, and the floodplain within 5 m of the "
      + "channel. Switch each on or off under the row.",
    info: {
      summary: "Where a river's influence reaches, in three steps out from the "
        + "water's edge at mean flow. Each is a multiple of the channel's own "
        + "width, because a 30 m stream and a 3 km river are not served by one "
        + "distance; the floodplain also has to stand within 5 m of the channel "
        + "on the streamed heights, so valley sides are not painted.",
      citation: "GRWL (Allen & Pavelsky 2018), CC BY 4.0; heights Mapzen Terrain "
        + "Tiles; rationale Leopold & Maddock (1953), Williams (1986), Nobre et "
        + "al. (2011)",
      maths: mathsFor("river-zones"),
    },
    settings: "river-zone-controls",
    ready: () => Boolean(window.GeoIDDemSheets),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("riverzones") || null,
    load: () => window.GeoIDDemSheets.addSheet("riverzones", sayIn("hydrology-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("riverzones"); sayIn("hydrology-status")(""); },
  }, {
    id: "hydro-lakes",
    group: "Water bodies",
    label: "Lakes and reservoirs (HydroLAKES)",
    title: "HydroLAKES v1.0 — the shoreline of every lake and reservoir of 10 ha "
      + "or more, 1.4 million of them, baked into vector tiles on this site. "
      + "Streams and sharpens as you fly in.",
    info: {
      summary: "Every lake and reservoir of 10 hectares or more, with its area, "
        + "volume, mean depth, shoreline, watershed and residence time. The "
        + "volume is surveyed for the largest lakes and reservoirs and MODELLED "
        + "for nearly all the rest, and each lake's card says which. Small "
        + "lakes join as you zoom in: under 1,000 km² they are left off the "
        + "world view, under 2 km² off the regional one, because they are "
        + "under a pixel there.",
      citation: "Messager et al. (2016), Nature Communications 7: 13603 — "
        + "doi:10.1038/ncomms13603, CC BY 4.0",
    },
    ready: () => Boolean(window.GeoIDHydroCover?.load),
    layerOf: () => window.GeoIDHydroCover?.layerOf?.("hydro-lakes") || null,
    load: () => window.GeoIDHydroCover.load("hydro-lakes"),
    // None: the layer writes its own line once its tiles have landed.
    unload: () => {
      window.GeoIDHydroCover?.remove?.("hydro-lakes");
      window.GeoIDHydroCover?.say?.("");
    },
  }, {
    id: "hydro-rivers",
    group: "Water bodies",
    label: "Rivers by width (GRWL)",
    title: "GRWL — centrelines of rivers and streams at least 30 m wide, measured "
      + "from Landsat at mean discharge and coloured by their width. Baked "
      + "into vector tiles on this site.",
    info: {
      summary: "Every river and stream wide enough for Landsat to see — 30 m at mean "
        + "discharge — with its median, minimum and maximum width. GRWL is a "
        + "width survey, not a gazetteer, so its rivers carry no names; the "
        + "Natural Earth row carries the names of the large ones. The fuller "
        + "network (HydroRIVERS) is not offered: its licence forbids "
        + "distributing it as a stand-alone product.",
      citation: "Allen & Pavelsky (2018), Science 361: 585-588 — "
        + "doi:10.1126/science.aat0636, CC BY 4.0",
    },
    ready: () => Boolean(window.GeoIDHydroCover?.load),
    layerOf: () => window.GeoIDHydroCover?.layerOf?.("hydro-rivers") || null,
    load: () => window.GeoIDHydroCover.load("hydro-rivers"),
    // None: the layer writes its own line once its tiles have landed.
    unload: () => {
      window.GeoIDHydroCover?.remove?.("hydro-rivers");
      window.GeoIDHydroCover?.say?.("");
    },
  }, {
    id: "hydro-ocean",
    group: "Ocean",
    label: "Ocean and seas (OpenStreetMap, Natural Earth)",
    title: "The sea as a filled map: Natural Earth's 1:10m ocean from orbit, "
      + "OpenStreetMap's coastline-exact water polygons from zoom 4.",
    info: {
      summary: "The sea drawn as an area rather than as a coastline — what a flood, "
        + "surge or sea-level study reads against. From orbit it is Natural "
        + "Earth's single 1:10m ocean polygon; from zoom 4 it is "
        + "OpenStreetMap's water polygons, which follow the coast to a few "
        + "metres.",
      citation: "© OpenStreetMap contributors, ODbL 1.0 · Natural Earth, public domain",
    },
    ready: () => Boolean(window.GeoIDHydroCover?.load),
    layerOf: () => window.GeoIDHydroCover?.layerOf?.("hydro-ocean") || null,
    load: () => window.GeoIDHydroCover.load("hydro-ocean"),
    // None: the layer writes its own line once its tiles have landed.
    unload: () => {
      window.GeoIDHydroCover?.remove?.("hydro-ocean");
      window.GeoIDHydroCover?.say?.("");
    },
  }],
  "exposure": [{
    id: "worldpop",
    group: "Population",
    label: "Population density (WorldPop 2020, 1 km)",
    title: "People per square kilometre in 2020 on a 1 km grid, WorldPop's "
      + "top-down constrained estimate: census totals disaggregated by "
      + "settlement, land cover, night lights and roads. Read from a "
      + "Cloud-Optimised GeoTIFF at the level this view deserves; a click "
      + "reads the full-resolution cell.",
    info: {
      summary: "The exposure half of risk. A MODEL calibrated to census "
        + "totals, not a count: right at the country level, and where the "
        + "model puts people within it. Drawn on decades of people per km², "
        + "because a linear ramp of density is a black map with three bright "
        + "pixels.",
      citation: "WorldPop (2020), Global 1 km population, University of "
        + "Southampton — doi:10.5258/SOTON/WP00647, CC BY 4.0",
      maths: mathsFor("worldpop"),
    },
    ready: () => true,
    layerOf: () => (window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => l.name === "Population density (WorldPop 2020, 1 km)") || null,
    load: async () => {
      const mod = await import(`./worldpop.js${new URL(import.meta.url).search}`);
      const out = await mod.addPopulation();
      if (!out?.ok) throw new Error(out?.message || "it could not be read");
      return out.layer;
    },
    unload: async () => {
      const mod = await import(`./worldpop.js${new URL(import.meta.url).search}`);
      mod.removePopulation();
    },
  }],
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
  // Hydrology ▸ Sea level: its own subtab, because it is a model you set a
  // number on rather than a map you tick.
  "sea-level": [{
    id: "sea-level",
    group: "Sea level",
    label: "Sea level on the streamed DEM",
    title: "Where the sea stands at a level you choose: spread from the real "
      + "coastline through the streamed heights, lakes held at their own surface. "
      + "Set the level in the controls under the row.",
    info: {
      summary: "A bathtub model with connectivity. Today's sea is the coastline "
        + "polygons; a risen sea covers only ground below it that it can reach "
        + "from them, and ground lower still but cut off is reported rather "
        + "than drawn. A fallen sea leaves the seabed above it standing. Each "
        + "lake stays at its surveyed surface. No tides, surges, defences finer "
        + "than the DEM, or land moving under the load.",
      citation: "Heights: Mapzen Terrain Tiles (AWS Open Data). Coastline: © "
        + "OpenStreetMap contributors (ODbL), Natural Earth. Lakes: HydroLAKES "
        + "(Messager et al. 2016), CC BY 4.0",
      maths: mathsFor("sea-level"),
    },
    settings: "sea-level-controls",
    ready: () => Boolean(window.GeoIDDemSheets),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("sealevel") || null,
    load: () => window.GeoIDDemSheets.addSheet("sealevel", sayIn("sea-level-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("sealevel"); sayIn("sea-level-status")(""); },
  }],
  // Hazards ▸ Flood: a model you set a flood on, like the sea level beside it
  // in Hydrology — the scenarios and sliders are in the drawer under the row.
  "flood": [{
    id: "flood-inundation",
    group: "Inundation",
    label: "River flood inundation on the streamed DEM",
    title: "Where a river flood reaches and how deep: every GRWL river's water "
      + "raised by a stage sized by its own width, spread over the streamed "
      + "heights. Pick a flood and shape it in the controls under the row.",
    info: {
      summary: "A height-above-river model with connectivity. Each river's water "
        + "surface is raised by a stage from its width and the flood's discharge; "
        + "ground below it, joined to the channel and within reach, floods to the "
        + "depth between. An upper screening estimate: no defences finer than the "
        + "heights, no attenuation, no volume limit, no tide. The scenario ratios "
        + "are assumed typical values, and every one is a slider.",
      citation: "Rivers: GRWL (Allen & Pavelsky 2018), CC BY 4.0. Channel depth: "
        + "Moody & Troutman (2002). Depth on discharge: Leopold & Maddock (1953). "
        + "Depth classes: US National Weather Service, Turn Around Don't Drown. "
        + "Heights: Mapzen Terrain Tiles (AWS Open Data)",
      maths: mathsFor("flood-inundation"),
    },
    settings: "flood-inundation-controls",
    ready: () => Boolean(window.GeoIDDemSheets),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("inundation") || null,
    load: () => window.GeoIDDemSheets.addSheet("inundation", sayIn("flood-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("inundation"); sayIn("flood-status")(""); },
  }, {
    // The same model, set by ONE river's discharge in m³/s rather than by a
    // multiple of every river's mean flow — for a reader holding a gauge
    // reading or a design flow for a particular river.
    id: "flood-discharge",
    group: "Inundation",
    label: "River flood by discharge on the streamed DEM",
    title: "One river's flood at a discharge you set in cubic metres a second: pick "
      + "the river on the map, type or slide the flow, and its water is spread over "
      + "the streamed heights the way the scenario model does.",
    info: {
      summary: "The inundation model run for ONE river at a stated discharge. The "
        + "river is chosen on the map and traced along GRWL's channel of similar "
        + "width; its mean flow is estimated from its width (or typed from a gauge), "
        + "and the discharge you set is read as a multiple of it. An upper screening "
        + "estimate with the same limits as the scenario model.",
      citation: "Rivers: GRWL (Allen & Pavelsky 2018), CC BY 4.0. Width and depth on "
        + "discharge: Moody & Troutman (2002). Depth on discharge at a station: "
        + "Leopold & Maddock (1953). Depth classes: US National Weather Service. "
        + "Heights: Mapzen Terrain Tiles (AWS Open Data)",
      maths: mathsFor("flood-discharge"),
    },
    settings: "flood-discharge-controls",
    ready: () => Boolean(window.GeoIDDemSheets),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("discharge") || null,
    load: () => window.GeoIDDemSheets.addSheet("discharge", sayIn("flood-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("discharge"); sayIn("flood-status")(""); },
  }],
  /**
   * THE MEAN CLIMATE, as two readings of the streamed DEM — the same function
   * the TEMP and PRESSURE readouts use, over the view's own grid, so the map
   * and the number under the cursor are one calculation.
   */
  "weather": [{
    id: "climate-temperature",
    group: "Climate normals",
    label: "Mean temperature 2001–2020 (MERRA-2)",
    title: "The 2001–2020 annual mean of 2 m air temperature from NASA's MERRA-2 "
      + "reanalysis, carried from its 55 km grid to the streamed ground by the "
      + "standard lapse rate. The TEMP readout reads the same.",
    info: {
      summary: "What the air is like on average, not today. MERRA-2's grid cell "
        + "describes the cell's mean height, so a summit inside it is colder by "
        + "the height it stands above that; over the sea the surface is the sea, "
        + "not the seabed the DEM reports.",
      citation: "NASA POWER (MERRA-2), Gelaro et al. (2017), J. Climate 30: 5419-5454",
      maths: mathsFor("climate-temperature"),
    },
    ready: () => Boolean(window.GeoIDDemSheets && window.GeoIDClimate),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("temperature") || null,
    load: () => window.GeoIDDemSheets.addSheet("temperature", sayIn("weather-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("temperature"); sayIn("weather-status")(""); },
  }, {
    id: "climate-pressure",
    group: "Climate normals",
    label: "Mean surface pressure 2001–2020 (MERRA-2)",
    title: "The 2001–2020 annual mean surface pressure from NASA's MERRA-2 "
      + "reanalysis, carried from its 55 km grid to the streamed ground by the "
      + "hypsometric equation. The PRESSURE readout reads the same.",
    info: {
      summary: "Surface air pressure on average: about 101 kPa at sea level and "
        + "a third less on a 3 km plateau. Carried to the ground's height from "
        + "the grid cell's own, at the layer's mean temperature.",
      citation: "NASA POWER (MERRA-2), Gelaro et al. (2017), J. Climate 30: 5419-5454",
      maths: mathsFor("climate-pressure"),
    },
    ready: () => Boolean(window.GeoIDDemSheets && window.GeoIDClimate),
    layerOf: () => window.GeoIDDemSheets?.sheetLayer?.("pressure") || null,
    load: () => window.GeoIDDemSheets.addSheet("pressure", sayIn("weather-status")),
    unload: () => { window.GeoIDDemSheets?.removeSheet?.("pressure"); sayIn("weather-status")(""); },
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

/** The mirror declaration for a dataset in this home, or undefined. */
const mirrorOf = (home, id) => (MIRRORS[home] || []).find((m) => m.id === id);

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
      // A tiled row may hang its own controls under itself too (the sea level
      // is a number the reader sets). Dropped here, the drawer silently never
      // appears -- the fourth time a projection has cost a field.
      settings: entry.settings,
    })),
    ...grouped().flatMap(({ group, entries: list }) => list
      .filter((entry) => entry.home === home || mirrorOf(home, entry.id))
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
        // A row whose drawer holds its own labelled slider takes no inline one.
        ownDetail: entry.ownDetail,
        // Third field this trap has cost: a projection that drops it hangs no
        // drawer under the row, silently. A MIRRORED row docks the mirror's
        // own block, never the home's: a block is one element and can hang
        // under one row.
        settings: mirrorOf(home, entry.id)?.settings ?? entry.settings,
      }))),
    ...geeEntries,
  ];
  if (!entries.length) return;
  // A host shipped in markup every world shares is HIDDEN until it has rows,
  // so a world with nothing to offer there shows no heading over nothing.
  const shell = host.closest("[data-catalogue-shell]");
  if (shell) shell.hidden = false;
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
  drawSeismicBands();
}

/**
 * HIDING A CLASS OF A LAYER — the satellite categories' pattern, written once
 * because two copies of it drift and the thing they drift on is invisible.
 *
 * The toggle FILTERS `layer.features` (and the collection the renderer reads)
 * against a kept master list, so the dots, the click pick and the labels all
 * answer from the same filtered set — a class switched off cannot be clicked
 * and cannot keep a label.
 *
 * COLOURS ARE NEVER RE-DERIVED ON REPAINT, and that is the whole discipline
 * here. `categoricalSymbology` assigns by frequency and filtering changes the
 * frequencies; `buildSymbology` drops a class outside the data's range and
 * spreads the ramp across what survives. Either way the classes still on
 * screen change colour when one is hidden, under a key that has quietly lost
 * a row. So the caller hands in a FIXED lookup and the legend is left
 * untouched — the swatches beside these ticks stay meaningful while a class
 * is hidden, which is what makes the control readable at all.
 */
function applyClassFilter(layer, { classOf, colourFor, off, after = null }) {
  if (!layer) return null;
  if (!layer._allFeatures) layer._allFeatures = layer.features;
  const all = layer._allFeatures || [];
  const filtered = off.size
    ? all.filter((f) => {
      const key = classOf(f);
      return key === null || key === undefined || !off.has(String(key));
    })
    : all;
  layer.features = filtered;
  if (layer.collection) layer.collection.features = filtered;
  layer.repaint?.(colourFor);
  after?.(layer);
  return filtered;
}

/** The tick, its swatch and its name — one row per class, in the class's own order. */
function drawClassRows(host, classes, off, onToggle, idPrefix) {
  host.replaceChildren();
  classes.forEach(({ key, label, colour }) => {
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = !off.has(String(key));
    tick.id = `${idPrefix}-${String(key).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const swatch = document.createElement("span");
    swatch.style.cssText = `flex:0 0 auto;width:0.55rem;height:0.55rem;`
      + `border-radius:0.12rem;background:${colour};`;
    const name = document.createElement("label");
    name.className = "gis-catalogue-name";
    name.htmlFor = tick.id;
    name.textContent = label;
    tick.addEventListener("change", () => {
      if (tick.checked) off.delete(String(key));
      else off.add(String(key));
      onToggle();
    });
    row.append(tick, swatch, name);
    host.appendChild(row);
  });
}

/** Per-type toggles for the volcano layer. */
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
  const lookup = new Map(legend.values.map((value, i) => [value, `#${legend.palette[i]}`]));
  applyClassFilter(layer, {
    off: volcanoTypesOff,
    classOf: (f) => String(f?.properties?.type_group),
    colourFor: (f) => lookup.get(String(f?.properties?.type_group)) || "#8a8a8a",
    // The labels rebuild from the filtered features; off-then-on keeps the
    // chosen detail level because point-labels remembers it by layer name.
    after: (l) => {
      const labels = window.GeoIDPointLabels;
      if (labels?.isLabelled?.(l)) {
        void labels.setLabels(l, false);
        void labels.setLabels(l, true);
      }
    },
  });
}

function drawVolcanoTypes() {
  const host = byId("volcano-types");
  if (!host) return;
  const bits = volcanoLayerBits();
  if (!bits) { host.replaceChildren(); return; }
  const { legend } = bits;
  drawClassRows(
    host,
    legend.values.map((value, i) => ({ key: value, label: value, colour: `#${legend.palette[i]}` })),
    volcanoTypesOff,
    applyVolcanoTypes,
    "volcano-type",
  );
}

/**
 * PER-MAGNITUDE toggles for the seismic record — the same control, over a
 * layer whose classes are numeric bands rather than named types.
 *
 * Three hundred thousand arrivals is mostly M 4.5–4.9, so at a global view
 * the ordinary background of the planet is drawn over the earthquakes anybody
 * remembers. The bands come from `seismic-magnitude.js`, whose symbology is
 * PINNED to all five classes — see the note there for why a filtered layer
 * repainted through the ordinary path recolours every band that is left.
 *
 * The ANIMATION follows without being told: it builds its frames from
 * `layer.features`, which this has already filtered, and `seismic-timelapse`
 * rebuilds under a hold on the same `change` — the span and the step do
 * exactly that already.
 */
const seismicBandsOff = new Set();

function seismicLayer() {
  const layer = layerForDataset("earthquakes");
  return layer?.features?.length || layer?._allFeatures?.length ? layer : null;
}

function applySeismicBands() {
  const layer = seismicLayer();
  if (!layer) return;
  if (!layer._allFeatures) layer._allFeatures = layer.features;
  const sym = bandSymbology((layer._allFeatures || []).map((f) => magOf(f?.properties)));
  applyClassFilter(layer, {
    off: seismicBandsOff,
    classOf: (f) => bandOf(f?.properties),
    colourFor: (f) => {
      const band = bandOf(f?.properties);
      return band === null ? null : sym.rows[band]?.colour || null;
    },
  });
  say("seismic-magnitudes-status", describeFilter(layer._allFeatures || [], seismicBandsOff));
}

function drawSeismicBands() {
  const host = byId("seismic-magnitudes");
  if (!host) return;
  const layer = seismicLayer();
  if (!layer) { host.replaceChildren(); say("seismic-magnitudes-status", ""); return; }
  drawClassRows(
    host,
    bandRows(layer._allFeatures || layer.features || [])
      .map((b) => ({ ...b, label: `${b.label} — ${b.count.toLocaleString()}` })),
    seismicBandsOff,
    applySeismicBands,
    "seismic-mag",
  );
  say("seismic-magnitudes-status", describeFilter(layer._allFeatures || layer.features || [], seismicBandsOff));
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
    if (!layer) { say("volcanic-catalogue", "Level saved — the labels follow when the layer is ticked on."); return; }
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
  /**
   * The catalogue's own launch defaults, once the importer exists to take them.
   *
   * Here rather than in `global-data.js` because this is the module that knows
   * the page HAS catalogues: a planet shell returns above without drawing a
   * list, and it should not be fetching Earth's plate boundaries either.
   *
   * IT WAITS FOR THE VIEWER'S SCENE, not merely for the import manager.
   *
   * `ensureGroups` needs `viewer.scene` to hang the layer's group off, and
   * without one `importFileList` marks the layer `error` with "Viewer is not
   * ready yet." and RETURNS — it does not throw, so `addDataset` reported
   * `ok: true` over a layer that had failed, and `loadLaunchDefaults`'
   * try/catch never saw a thing. Measured at launch: the plate boundaries
   * registered, took their 30%, and carried no geometry at all; the identical
   * call by hand a minute later loaded all 241 segments. Gate on what the
   * importer itself requires.
   *
   * Bounded retry, and it gives up quietly. A page still without a viewer
   * after twelve seconds has a larger problem than a default layer, and a poll
   * that runs for the life of the tab is worse than an unticked box.
   */
  let tries = 0;
  const arm = () => {
    if (!window.GeoIDImportManager?.importFileList || !window.GeoIDViewer?.scene) {
      if (tries >= 40) return;
      tries += 1;
      window.setTimeout(arm, 300);
      return;
    }
    void loadLaunchDefaults();
  };
  arm();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
