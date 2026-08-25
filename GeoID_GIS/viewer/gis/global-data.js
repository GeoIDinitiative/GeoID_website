/**
 * The global vector catalogue — coastlines, rivers, lakes, borders, plates,
 * faults — as datasets anyone can put on the globe in one press.
 *
 * Two kinds of entry, and the difference is a licence rather than a technical
 * one:
 *
 * - **Shipped.** Natural Earth is public domain, so those layers are converted
 *   once (shapefile -> GeoJSON, 4 decimal places, the attributes worth keeping)
 *   and served with the site from `/data/global/`. They work offline, they load
 *   in one round trip, and nobody has to find them.
 * - **Live.** The tectonics layers are under their authors' own terms, so they
 *   are fetched from the canonical source at the moment they are asked for,
 *   with the credit shown beside them. That is also honest about freshness: an
 *   active-fault compilation is edited, and a copy taken today is a copy of
 *   today. Every one of these sources answers with `Access-Control-Allow-Origin:
 *   *`, which is what makes fetching them from a page possible at all.
 *
 * Both go in through the SAME `importFileList` a dropped file uses, so a
 * catalogue layer is an ordinary layer the moment it lands: the layer box, the
 * legend, opacity, extraction, export and the feature card all work on it with
 * nothing added.
 *
 * The conversion is written down in `data/global/README.md` — the ogr2ogr
 * commands, the source URLs and each licence — so the shipped files can be
 * rebuilt or updated without guessing what was done to them.
 */

/** Order the groups read in, coarse to specific. */
export const GROUPS = ["Physical", "Boundaries", "Tectonics", "Hazards", "Regional"];

export const DATASETS = [
  {
    id: "coastline-10m",
    group: "Physical",
    label: "Coastlines — global (Natural Earth 1:10m)",
    path: "/data/global/coastline_10m.geojson",
    name: "Global coastlines (Natural Earth 10m).geojson",
    summary: "4,133 lines, 410,957 vertices",
    licence: "Natural Earth — public domain",
  },
  {
    id: "rivers-10m",
    group: "Physical",
    label: "Rivers and lake centrelines — global (Natural Earth 1:10m)",
    path: "/data/global/rivers_10m.geojson",
    name: "Global rivers (Natural Earth 10m).geojson",
    summary: "4,224 lines, 260,393 vertices",
    licence: "Natural Earth — public domain",
  },
  {
    id: "lakes-10m",
    group: "Physical",
    label: "Lakes — global (Natural Earth 1:10m)",
    path: "/data/global/lakes_10m.geojson",
    name: "Global lakes (Natural Earth 10m).geojson",
    summary: "1,355 polygons",
    licence: "Natural Earth — public domain",
  },
  {
    id: "geographic-lines",
    group: "Physical",
    label: "Equator, tropics and polar circles",
    path: "/data/global/graticule_lines.geojson",
    name: "Geographic lines (Natural Earth 10m).geojson",
    summary: "6 lines",
    licence: "Natural Earth — public domain",
  },
  {
    id: "boundaries-10m",
    group: "Boundaries",
    label: "Country borders — global (Natural Earth 1:10m)",
    path: "/data/global/boundaries_10m.geojson",
    name: "Country borders (Natural Earth 10m).geojson",
    summary: "515 lines",
    licence: "Natural Earth — public domain",
  },
  {
    id: "countries-50m",
    group: "Boundaries",
    label: "Countries as polygons (Natural Earth 1:50m)",
    path: "/data/global/countries_50m.geojson",
    name: "Countries (Natural Earth 50m).geojson",
    summary: "242 polygons — the coarser scale on purpose: this one is for "
      + "clipping and attribution, and 1:10m polygons cost 12 MB to say the "
      + "same thing",
    licence: "Natural Earth — public domain",
  },
  {
    id: "plate-boundaries",
    group: "Tectonics",
    label: "Plate boundaries — global (Bird 2003)",
    url: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json",
    name: "Plate boundaries (Bird 2003).geojson",
    summary: "241 boundary segments, named by the two plates they separate",
    licence: "Bird (2003), PB2002 — cite the paper; redistributed via "
      + "fraxen/tectonicplates, which states no licence of its own",
    live: true,
  },
  {
    id: "active-faults",
    group: "Tectonics",
    label: "Active faults — global (GEM)",
    url: "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults"
      + "/master/geojson/gem_active_faults_harmonized.geojson",
    name: "Active faults (GEM global).geojson",
    summary: "13,696 faults with slip type, rate and dip where known",
    licence: "GEM Global Active Faults — CC BY-SA 4.0",
    live: true,
  },
  {
    id: "stress-vectors",
    group: "Tectonics",
    label: "Stress orientations — measurements (World Stress Map)",
    path: "/data/global/stress-vectors.geojson",
    name: "Stress orientations (World Stress Map 2016).geojson",
    summary: "32,464 A–C measurements of SHmax, each a 60 km bar along the "
      + "orientation it recorded, with its method, quality class, depth, "
      + "faulting regime and — for the few hundred that have any — the "
      + "principal stress magnitudes",
    licence: "World Stress Map 2016 (Heidbach et al.) — CC BY 4.0",
    /**
     * Coloured by REGIME, which is the half of a stress measurement that an
     * orientation alone does not carry.
     *
     * SHmax says which way the crust is being squeezed; the regime says what
     * that does to it — normal faulting where the vertical stress is the
     * largest and the crust is pulling apart, thrust where it is the smallest
     * and the crust is shortening, strike-slip where it is in between. Colour
     * by azimuth and the map is a rainbow of directions; colour by regime and
     * it is a map of what the ground is doing.
     */
    colourBy: "regime",
    /**
     * The WSM's own colours, not a palette picked by frequency.
     *
     * Red where the crust is pulling apart, blue where it is shortening, green
     * where it is shearing past itself — the key thirty years of published
     * stress maps have used. `categoricalSymbology` would otherwise assign by
     * how common each class is, which put normal faulting in orange and thrust
     * in green: a map a reader has to decode from its legend when they already
     * knew what the colours meant.
     */
    colours: {
      "Normal faulting": "#e2444a",
      "Normal with strike-slip": "#e07a8a",
      "Strike-slip": "#3aa03a",
      "Thrust with strike-slip": "#5f8fd0",
      "Thrust faulting": "#3a6bd6",
      Undetermined: "#96969e",
    },
  },
  {
    id: "volcanoes",
    group: "Hazards",
    label: "Volcanoes — global (Smithsonian GVP)",
    path: "/data/global/volcanoes.geojson",
    name: "World volcanoes (Smithsonian GVP).geojson",
    summary: "2,666 volcanoes: 1,214 Holocene and 1,452 Pleistocene, with type, "
      + "last eruption, tectonic setting and a summary each",
    licence: "Smithsonian Global Volcanism Program — free for non-commercial use "
      + "with citation",
    /**
     * Coloured by `type_group` on arrival rather than by whatever ranks first.
     *
     * `rankColourFields` would pick something with a good spread and no
     * meaning -- country has 100+ values, `gvp_number` is unique per feature.
     * The two columns anybody actually wants are the landform type and the
     * eruption recency, and the type is the one that makes the map read as a
     * map of volcanoes rather than a map of nations.
     */
    colourBy: "type_group",
  },
  {
    id: "ni-rivers",
    group: "Regional",
    label: "Rivers — Northern Ireland (OpenStreetMap)",
    path: "/ni-prototype/data/ni_rivers.geojson",
    name: "NI rivers (OpenStreetMap).geojson",
    summary: "8,101 lines",
    licence: "OpenStreetMap contributors — ODbL",
  },
];

export function datasetById(id) {
  return DATASETS.find((entry) => entry.id === id) || null;
}

/** Datasets in group order, for building a grouped picker. */
export function grouped() {
  return GROUPS
    .map((group) => ({ group, entries: DATASETS.filter((d) => d.group === group) }))
    .filter((g) => g.entries.length);
}

/**
 * What the layer is CALLED, which is not what the file is called.
 *
 * The importer picks its parser from the extension, so the File handed to it
 * has to be `NI rivers (OpenStreetMap).geojson`. Nothing downstream needs that:
 * the layer box, the Polygons list, the legend and the symbology dialog are all
 * showing a dataset somebody ticked, not a file they chose, and ".geojson" in
 * every row is plumbing on display. Derived rather than a second field, so the
 * two cannot be edited apart.
 */
export function layerNameOf(entry) {
  return String(entry?.name || "").replace(/\.(geojson|json|shp|kml|gpx|wkt|csv)$/i, "");
}

/** The layer a catalogue dataset is currently loaded as, or null. */
export function layerForDataset(id) {
  const entry = typeof id === "object" ? id : datasetById(id);
  if (!entry) return null;
  const display = layerNameOf(entry);
  return (window.GeoIDImportManager?.getLayers?.() || [])
    // Either name: the file's while the import is still in flight, the tidied
    // one from the moment the rename lands.
    .find((layer) => layer.name === display || layer.name === entry.name) || null;
}

/** Did this layer come from the catalogue? */
export function isCatalogueLayer(layer) {
  if (!layer?.name) return false;
  return DATASETS.some((entry) => layer.name === entry.name || layer.name === layerNameOf(entry));
}

const loadedLayer = (entry) => layerForDataset(entry);

/**
 * Put one catalogue dataset on the globe.
 *
 * `onStatus` is called with every step rather than the module owning a status
 * node: the same catalogue is offered from more than one panel, and each has
 * its own place to say what is happening.
 */
export async function addDataset(id, onStatus = () => {}) {
  const entry = datasetById(id);
  if (!entry) return { ok: false, message: `No dataset called "${id}".` };
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    return { ok: false, message: "The GIS layer is still starting — try again in a moment." };
  }
  if (loadedLayer(entry)) {
    const message = `${entry.label} is already on the globe.`;
    onStatus(message);
    return { ok: true, already: true, message };
  }
  const source = entry.path || entry.url;
  try {
    // A big one takes a few seconds to build geometry, so say so first: the
    // press has no other feedback until the layer appears.
    onStatus(`Loading ${entry.label}…`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    // The FILE keeps its extension, because that is what chooses the parser;
    // the LAYER is named without it. `options.name` is the importer's own
    // seam for exactly this, so the layer is right from the frame it lands
    // rather than being renamed a moment later in front of the user.
    await manager.importFileList(
      [new File([blob], entry.name, { type: "application/geo+json" })],
      { name: layerNameOf(entry) },
    );
  } catch (error) {
    const message = `${entry.label} did not load: ${error.message}`;
    onStatus(message);
    return { ok: false, message };
  }
  const layer = loadedLayer(entry);
  /**
   * A dataset that names the column worth colouring by gets it on arrival.
   *
   * `defaultSymbology` guesses, which is right for a file somebody dropped and
   * wrong for a catalogue entry: the guess ranks columns by how well they
   * spread, and for the volcanoes that is `country` -- a hundred hues saying
   * nothing about volcanoes. The entry knows better than the ranking, and can
   * still be recoloured from the Symbology button like anything else.
   */
  if (layer && entry.colourBy) {
    try {
      const { paintByField } = await import(
        `./symbology-dialog.js${new URL(import.meta.url).search}`);
      // A dataset may name the colours its own discipline reads by. The WSM's
      // red/green/blue for faulting regime is thirty years of published maps,
      // and a palette assigned by frequency instead — blue for normal, orange
      // for thrust — is a map that every reader has to decode from its legend
      // when they already knew the answer.
      // A layer that covers the whole globe is a BASEMAP unless you can see
      // through it. The stress mesh fills 2,860 cells of 300 km each; at full
      // opacity that is an opaque sheet over the planet, and it was reported
      // as still being a raster basemap when it had been vectors for a day.
      if (Number.isFinite(entry.opacity)) {
        window.GeoIDLayerHierarchy?.setOpacity?.(layer, entry.opacity);
        window.GeoIDLayerHierarchy?.render?.();
      }
      paintByField(layer, entry.colourBy, entry.colours
        ? { overrides: new Map(Object.entries(entry.colours)) }
        : {});
    } catch (error) {
      console.warn("[GeoID GIS] default symbology failed:", error.message);
    }
  }
  const message = `${entry.label} added. ${entry.licence}.`;
  onStatus(message);
  return { ok: true, layer, message };
}

if (typeof window !== "undefined") {
  window.GeoIDGlobalData = {
    DATASETS, GROUPS, grouped, datasetById, addDataset,
    layerNameOf, layerForDataset, isCatalogueLayer,
  };
}
