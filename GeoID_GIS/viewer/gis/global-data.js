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

import { runConnector } from "./research/connectors.js?v=20260904-b0b1f62";
import { dataUrl } from "./data-base.js?v=20260904-b0b1f62";

/** Order the groups read in, coarse to specific. */
export const GROUPS = ["Physical", "Hydrology", "Boundaries", "Tectonics",
  "Ice sheets", "UK geology (BGS)", "Hazards", "Live services"];

/**
 * Which PANEL a dataset belongs on, where it is not the Vectors tab.
 *
 * Data · Vectors & Shapes began as the one list of everything, which made it a
 * list sorted by file format: a plate boundary beside a coastline beside a
 * volcano, because all three arrive as GeoJSON. That is not how anybody looks
 * for them. So a dataset may name its home, the panel for that home draws it,
 * and the Vectors tab draws what is left — the shapes that really are just
 * shapes, plus anything somebody imports.
 *
 * Declared here rather than in each panel so that "does this dataset appear
 * exactly once" is a question about one file. `catalogue-panels.js` mounts
 * them and its test checks every home named here has a panel and a host.
 */
export const HOMES = {
  hydrology: "hydrology-catalogue",
  "geology-tectonics": "tectonics-catalogue",
  "geology-volcanoes": "volcanoes-catalogue",
  "geology-ice": "ice-catalogue",
  // No shipped FILE lives under this home — the soil map is a tiled layer, so
  // it arrives through catalogue-panels' own TILED registry. The home is
  // declared here anyway because that is where "does this dataset appear
  // exactly once" is answered, and its test checks every home has a host.
  "geology-soil": "soil-catalogue",
};

export const DATASETS = [
  {
    id: "coastline-10m",
    home: "hydrology",
    featureNoun: "Coastline",
    group: "Hydrology",
    label: "Coastlines — global (Natural Earth 1:10m)",
    path: "/data/global/coastline_10m.geojson",
    name: "Global coastlines (Natural Earth 10m).geojson",
    summary: "4,133 lines, 410,957 vertices",
    licence: "Natural Earth — public domain",
  },
  {
    id: "rivers-10m",
    home: "hydrology",
    featureNoun: "River",
    group: "Hydrology",
    label: "Rivers and lake centrelines — global (Natural Earth 1:10m)",
    path: "/data/global/rivers_10m.geojson",
    name: "Global rivers (Natural Earth 10m).geojson",
    summary: "4,224 lines, 260,393 vertices",
    licence: "Natural Earth — public domain",
  },
  {
    id: "lakes-10m",
    home: "hydrology",
    featureNoun: "Lake",
    group: "Hydrology",
    label: "Lakes — global (Natural Earth 1:10m)",
    path: "/data/global/lakes_10m.geojson",
    name: "Global lakes (Natural Earth 10m).geojson",
    summary: "1,355 polygons",
    licence: "Natural Earth — public domain",
  },
  {
    id: "geographic-lines",
    featureNoun: "Geographic line",
    group: "Physical",
    label: "Equator, tropics and polar circles",
    path: "/data/global/graticule_lines.geojson",
    name: "Geographic lines (Natural Earth 10m).geojson",
    summary: "6 lines",
    licence: "Natural Earth — public domain",
  },
  {
    id: "boundaries-10m",
    featureNoun: "Country border",
    group: "Boundaries",
    label: "Country borders — global (Natural Earth 1:10m)",
    path: "/data/global/boundaries_10m.geojson",
    name: "Country borders (Natural Earth 10m).geojson",
    summary: "515 lines",
    licence: "Natural Earth — public domain",
  },
  {
    id: "countries-50m",
    featureNoun: "Country",
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
    home: "geology-tectonics",
    featureNoun: "Plate boundary",
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
    home: "geology-tectonics",
    featureNoun: "Active fault",
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
    home: "geology-tectonics",
    featureNoun: "Stress measurement",
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
    home: "geology-volcanoes",
    featureNoun: "Volcano",
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
    home: "hydrology",
    featureNoun: "River",
    group: "Hydrology",
    label: "Rivers — Northern Ireland (OpenStreetMap)",
    path: "/ni-prototype/data/ni_rivers.geojson",
    name: "NI rivers (OpenStreetMap).geojson",
    summary: "8,101 lines",
    licence: "OpenStreetMap contributors — ODbL",
  },
  /**
   * CONNECTOR-BACKED entries: the Research Hub's fetch services, offered as
   * ordinary catalogue rows. `connector` names an entry in
   * research/connectors.js — a pure URL builder + converter, CORS-verified —
   * and addDataset routes through runConnector instead of a plain fetch,
   * passing the drawn study area as the bbox when one exists. Provenance
   * (endpoint, time, feature count, attribution) lands on the layer's
   * metadata. EONET categories and USGS earthquakes are deliberately absent:
   * the Events tab already serves them as live feeds, and a second doorway
   * to the same data is the filing mistake this catalogue exists to end.
   */
  {
    id: "ice-sheets",
    home: "geology-ice",
    featureNoun: "Ice sheet",
    group: "Ice sheets",
    label: "Ice sheets and shelves — Greenland and Antarctica (Natural Earth 1:10m)",
    path: "/data/global/ice-sheets.geojson",
    name: "Ice sheets (Natural Earth 10m).geojson",
    /**
     * Two reasons this is a FILE where the glaciers are tiles, and the second
     * is the one that decides it: five polygons that change on no timescale
     * this map cares about, and Web Mercator stops at 85.05 degrees — tiled,
     * the Antarctic ice sheet would be a ring of ice around a hole at the pole.
     */
    summary: "161 polygons — the ice the Randolph inventory does not map, and "
      + "about 96% of the ice on Earth: the two grounded ice sheets "
      + "(12,059,468 km² Antarctica, 1,746,539 Greenland) and the 156 floating "
      + "shelves around them (1,555,136 km²). A file rather than tiles, "
      + "because Web Mercator cannot hold the South Pole.",
    /**
     * GROUNDED AND FLOATING ARE DIFFERENT ICE, so they are different colours.
     *
     * A shelf is the sheet's outflow afloat on the sea, already displacing its
     * own weight of water — which is the whole of why a shelf collapse and an
     * ice-sheet loss mean different things for sea level. Both are ice cover;
     * neither is the other.
     */
    colourBy: "kind",
    colours: { "Ice sheet": "#eaf7ff", "Ice shelf": "#a9d8ef" },
    licence: "Natural Earth — public domain",
  },
  {
    id: "conn-glims-outlines",
    home: "geology-ice",
    featureNoun: "Glacier outline",
    group: "Live services",
    label: "Glacier outlines — live (GLIMS archive)",
    connector: "glims-outlines",
    name: "GLIMS glacier outlines.geojson",
    summary: "The archive RGI is curated from, fetched over the drawn study "
      + "area at its own native resolution — one outline per glacier, the "
      + "latest imagery date GLIMS holds. Draw an area first: this is a "
      + "database of hundreds of thousands of outlines.",
    licence: "GLIMS and NSIDC (2005, updated) — glims.org",
  },
  {
    id: "conn-glims-change",
    /**
     * NO HOME, so no catalogue row: this one is driven by its own subtab
     * (`#geology-ice-change`), which asks WHICH GROUND first — the extent
     * picker, the way the GFS card does it. A tick that silently used
     * whatever happened to be drawn was the wrong question for a layer whose
     * whole cost and coverage depend on the box.
     */
    hidden: true,
    featureNoun: "Glacier change",
    group: "Live services",
    label: "Glacier change — repeat outlines (GLIMS)",
    connector: "glims-change",
    name: "Glacier change (GLIMS).geojson",
    summary: "Where the archive holds a glacier more than once, the earliest "
      + "and latest outlines compared: area change and its rate, over the "
      + "drawn study area. An area change is NOT a mass balance — a glacier "
      + "can thin for a decade without its outline moving.",
    /**
     * A DIVERGING scale, because zero means something here.
     *
     * Most glaciers in the archive have shrunk and a few have grown, so a
     * sequential ramp would put "no change" in the middle of a colour run and
     * hide the sign. Quantile classing, as the fire layers use, because the
     * distribution is long-tailed either side.
     */
    colourRange: { field: "change_pct_yr", method: "quantile", classes: 5, ramp: "risk-reversed" },
    licence: "GLIMS and NSIDC (2005, updated) — glims.org",
  },
  {
    id: "conn-usgs-streamflow",
    home: "hydrology",
    featureNoun: "Stream gauge",
    group: "Hydrology",
    label: "Streamflow gauges — live (USGS, US)",
    connector: "usgs-streamflow",
    name: "USGS streamflow gauges.geojson",
    summary: "Latest discharge at active US stream gauges, fetched at this moment. "
      + "Uses the drawn study area as its search box when one exists.",
    licence: "U.S. Geological Survey — National Water Information System (public domain)",
  },
  {
    id: "conn-osm-places",
    featureNoun: "Place",
    group: "Live services",
    label: "Places — live (OpenStreetMap)",
    connector: "osm-places",
    name: "OSM places.geojson",
    summary: "Cities and towns from the Overpass API over the drawn study area "
      + "(a global pull is refused by the service — draw an area first).",
    licence: "© OpenStreetMap contributors (ODbL)",
  },
  {
    id: "conn-fire-perimeters",
    featureNoun: "Wildfire perimeter",
    group: "Live services",
    label: "Wildfire perimeters — live (NIFC, US)",
    connector: "fire-perimeters",
    name: "Wildfire perimeters (NIFC).geojson",
    summary: "Surveyed boundaries of active US wildfires with name, cause, "
      + "acreage and containment — the mapped polygon, where the satellite "
      + "layers give hot pixels. United States only: no browser-reachable "
      + "service publishes active perimeters globally.",
    colourBy: "cause",
    colours: { Human: "#ff7a18", Natural: "#ffd166", Undetermined: "#8a8a8a" },
    licence: "NIFC / Wildland Fire Interagency Geospatial Services — public domain",
  },
  {
    id: "conn-fires-modis",
    featureNoun: "Active fire detection",
    group: "Live services",
    label: "Active fires — MODIS (today)",
    connector: "fires-modis",
    name: "Active fires MODIS (NASA FIRMS).geojson",
    summary: "Today's thermal anomalies from Terra and Aqua at 1 km, worldwide "
      + "— about 17,000 a day. Raw detections with intensity, not curated "
      + "events: the Events tab's EONET wildfires are 99% North America.",
    /**
     * By fire radiative POWER, classed — which is what a fire map is about.
     *
     * Confidence answers "is this real"; FRP answers "how big is it", and the
     * spread is enormous (measured today, 0 to 10,407 MW with a median of
     * 19.9). Quantile rather than equal interval, because a handful of
     * enormous fires would otherwise put every ordinary one in the bottom
     * class and the map would be one colour. The risk ramp reads hot without
     * a legend.
     */
    colourRange: { field: "frp_mw", method: "quantile", classes: 5, ramp: "risk" },
    // Places, not a point cloud: ninety thousand detections are ninety
    // thousand PLACES, and world-space sizing draws them sub-pixel.
    pointStyle: "places",
    licence: "NASA FIRMS via NASA EOSDIS GIBS — NASA open data",
  },
  {
    id: "conn-fires-viirs-snpp",
    featureNoun: "Active fire detection",
    group: "Live services",
    label: "Active fires — VIIRS Suomi NPP (today)",
    connector: "fires-viirs-snpp",
    name: "Active fires VIIRS SNPP (NASA FIRMS).geojson",
    summary: "The same day at 375 m rather than 1 km, so far more of it — "
      + "about 98,000 detections worldwide. Heavier to draw; the detail is "
      + "the point.",
    // Same FRP classing and the same reason as the MODIS row above.
    colourRange: { field: "frp_mw", method: "quantile", classes: 5, ramp: "risk" },
    pointStyle: "places",
    licence: "NASA FIRMS via NASA EOSDIS GIBS — NASA open data",
  },
  {
    id: "conn-fires-viirs-noaa20",
    featureNoun: "Active fire detection",
    group: "Live services",
    label: "Active fires — VIIRS NOAA-20 (today)",
    connector: "fires-viirs-noaa20",
    name: "Active fires VIIRS NOAA-20 (NASA FIRMS).geojson",
    summary: "A second 375 m VIIRS pass, about ninety minutes from Suomi NPP's "
      + "— two looks at the same day rather than a duplicate of one.",
    // Same FRP classing and the same reason as the MODIS row above.
    colourRange: { field: "frp_mw", method: "quantile", classes: 5, ramp: "risk" },
    pointStyle: "places",
    licence: "NASA FIRMS via NASA EOSDIS GIBS — NASA open data",
  },
  {
    id: "conn-submarine-cables",
    featureNoun: "Submarine cable",
    group: "Live services",
    label: "Submarine cables — live (Greg's Cable Map)",
    connector: "submarine-cables",
    name: "Submarine cables (Greg's Cable Map).geojson",
    summary: "285 of the world's submarine cables with capacity, length and "
      + "service year — labelled and clickable. Pair it with the landing "
      + "stations below for the ends.",
    colourBy: "status",
    // The rank is LENGTH here, not eruption recency, so the slider says so.
    // Bands match submarineCablesToGeoJSON's thresholds exactly — a caption
    // that disagrees with the rule behind it is worse than no caption.
    detailCopy: {
      1: "Transoceanic only (10,000 km+)",
      2: "Long-haul (4,000 km+)",
      3: "Regional and longer (1,500 km+)",
      4: "Down to short hops (300 km+)",
      5: "Every named cable",
    },
    licence: "Greg's Cable Map — GNU GPL",
  },
  {
    id: "conn-cable-landings",
    featureNoun: "Cable landing station",
    group: "Live services",
    label: "Cable landing stations — live (Greg's Cable Map)",
    connector: "cable-landings",
    name: "Cable landing stations (Greg's Cable Map).geojson",
    summary: "737 points where submarine cables come ashore, with country and "
      + "owner. The dots to the cables' paths.",
    // By COUNTRY, not by `kind` — every one of these is a landing station, so
    // that column holds one value and paints 737 dots a single colour under a
    // legend of one class. Country is the facet a reader actually asks a
    // landing map about, and the palette's twelve-plus-other is the honest
    // shape of it.
    colourBy: "country",
    licence: "Greg's Cable Map — GNU GPL",
  },
  {
    id: "conn-bgs-bedrock",
    home: "geology-tectonics",
    featureNoun: "Geological unit",
    group: "UK geology (BGS)",
    label: "Bedrock geology — live (BGS 625k, UK)",
    connector: "bgs-geology-bedrock",
    name: "BGS bedrock geology 625k.geojson",
    summary: "UK bedrock at 1:625,000 from the BGS OGC API, clipped to the "
      + "drawn study area when one exists. United Kingdom only.",
    licence: "Contains British Geological Survey materials © UKRI",
  },
  {
    id: "conn-bgs-superficial",
    home: "geology-tectonics",
    featureNoun: "Geological unit",
    group: "UK geology (BGS)",
    label: "Superficial deposits — live (BGS 625k, UK)",
    connector: "bgs-geology-superficial",
    name: "BGS superficial geology 625k.geojson",
    summary: "UK superficial deposits at 1:625,000 from the BGS OGC API, "
      + "clipped to the drawn study area when one exists. United Kingdom only.",
    licence: "Contains British Geological Survey materials © UKRI",
  },
  {
    id: "conn-haduk-rainfall",
    featureNoun: "Rainfall normal",
    group: "Live services",
    label: "Rainfall normals — live (HadUK 12km, UK)",
    connector: "met-rainfall-normals",
    name: "HadUK rainfall normals.geojson",
    summary: "1991–2020 annual rainfall normals on the HadUK 12 km grid. "
      + "United Kingdom only.",
    licence: "Met Office HadUK-Grid © Crown copyright, licensed under the Open Government Licence",
  },
  {
    id: "conn-nws-alerts",
    featureNoun: "Weather alert",
    group: "Live services",
    label: "Weather alerts — live (NWS, US)",
    connector: "nws-alerts",
    name: "NWS active alerts.geojson",
    summary: "Active US National Weather Service alerts with their polygons, "
      + "fetched at this moment. United States only.",
    licence: "NOAA / US National Weather Service (public domain)",
  },
];

/**
 * The drawn study area as a signed-longitude bbox, or null. The viewer
 * answers east-positive 0–360; every API the connectors speak wants signed
 * −180..180 (the WSM's 38.8° lesson, from the other direction).
 */
function drawnBbox() {
  const area = window.GeoIDViewer?.getExtractionGeometry?.();
  const vertices = area?.vertices;
  if (!vertices?.length) return null;
  const signed = (lon) => (lon > 180 ? lon - 360 : lon);
  const lats = vertices.map((v) => v.lat);
  const lons = vertices.map((v) => signed(v.lon));
  /**
   * THE SHAPE THE CONNECTORS SPEAK, which is an object and not an array.
   *
   * This returned `[west, south, east, north]` while every url builder in
   * `connectors.js` reads `bbox.minLon` / `minLat` / `maxLon` / `maxLat` — so
   * `[…].minLon` was `undefined` and every live row that takes a study area
   * sent one with `undefined` in it. Nothing threw: the BGS builder joined four
   * undefineds into ",,,", the USGS one set four empty parameters, and the
   * services answered as though no box had been given. Two vocabularies for a
   * box, which this file's own notes record as a silent skip — met again here,
   * and closed at the ONE place that builds it rather than in each reader.
   */
  return {
    minLon: Math.min(...lons), minLat: Math.min(...lats),
    maxLon: Math.max(...lons), maxLat: Math.max(...lats),
  };
}

export function datasetById(id) {
  return DATASETS.find((entry) => entry.id === id) || null;
}

/** Datasets in group order, for building a grouped picker. */
export function grouped() {
  /**
   * A dataset may be HIDDEN from every list and still be loadable by id.
   *
   * The glacier-change layer is driven by its own subtab, which asks which
   * ground first; a catalogue tick beside it would be a second door to the
   * same thing, taking the answer from wherever a shape happened to be drawn.
   * `datasetById` still finds it, so `addDataset` works — this only decides
   * what is OFFERED. The same discipline the geology panel keeps for the rows
   * it hides rather than deletes.
   */
  return GROUPS
    .map((group) => ({
      group,
      entries: DATASETS.filter((d) => d.group === group && !d.hidden),
    }))
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
export async function addDataset(id, onStatus = () => {},
  { bbox: bboxArg = null, ...connectorOptions } = {}) {
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
    let blob;
    let provenance = null;
    if (entry.connector) {
      /**
       * The CALLER's ground first, the drawn overlay second.
       *
       * A catalogue tick means "over whatever I have drawn", which is what
       * `drawnBbox` answers. A panel that asks the extent picker — the Glacier
       * change subtab, the way the GFS card does it — has already resolved a
       * box from a named layer, a captured extent or the live overlay, and
       * that answer must not be thrown away here.
       */
      const bbox = bboxArg || drawnBbox();
      onStatus(bbox
        ? `Fetching ${entry.label} over the drawn area…`
        : `Fetching ${entry.label}…`);
      /**
       * Whatever else the caller asked for travels with it — the glacier
       * change subtab's date window, for one. The connector's own defaults
       * still fill in the rest.
       */
      const result = await runConnector(entry.connector,
        { ...connectorOptions, ...(bbox ? { bbox } : {}) });
      if (!result.geojson.features.length) {
        const message = `${entry.label}: nothing returned for this area — it `
          + "may be outside the service's coverage.";
        onStatus(message);
        return { ok: false, message };
      }
      blob = new Blob([JSON.stringify(result.geojson)]);
      provenance = result.provenance;
    } else {
      // Resolved through the data base: a published file comes from the
      // bucket with its fingerprint, an unpublished one from the site.
      const response = await fetch(await dataUrl(source));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    }
    // The FILE keeps its extension, because that is what chooses the parser;
    // the LAYER is named without it. `options.name` is the importer's own
    // seam for exactly this, so the layer is right from the frame it lands
    // rather than being renamed a moment later in front of the user.
    await manager.importFileList(
      [new File([blob], entry.name, { type: "application/geo+json" })],
      // `pointStyle` because the renderer cannot tell a large CATALOGUE from a
      // point CLOUD and they want opposite treatment; only the entry knows.
      { name: layerNameOf(entry), pointStyle: entry.pointStyle || "auto" },
    );
    /**
     * EVERY catalogue layer states its provenance, not only the live ones.
     *
     * The Metadata tab reads `layer.metadata`, and a shipped file used to
     * arrive with none — so a Natural Earth layer read "Source: user import,
     * CRS: unstated" beside a live connector that named its endpoint and its
     * licence. That gap was invisible while each subtab carried its own
     * "Sources" fold; with those gone, the Metadata tab IS where a dataset
     * says where it came from, and it has to be able to.
     */
    const landed = loadedLayer(entry);
    if (landed) {
      landed.metadata = {
        source: provenance?.attribution || entry.path || entry.label,
        citation: entry.licence,
        crs: "EPSG:4326",
        ...(provenance ? {
          endpoint: provenance.endpoint,
          importedAt: provenance.fetched_at,
          features: provenance.features,
        } : {}),
      };
    }
  } catch (error) {
    const message = `${entry.label} did not load: ${error.message}`;
    onStatus(message);
    return { ok: false, message };
  }
  const layer = loadedLayer(entry);
  /**
   * What ONE of these features is, in words.
   *
   * The click card had only the geometry to go on and headed a stress
   * measurement "Mapped line" — true of a coastline, a river, a fault and a
   * border alike, and therefore useless on all of them. A catalogue that knows
   * it is shipping faults can say so, and does; the geometry stays as the
   * fallback for a file somebody dropped, which really is just a line.
   */
  if (layer && entry.featureNoun) layer.featureNoun = entry.featureNoun;
  // The colours the layer is WEARING, so the symbology dialog opens on them
  // rather than proposing the generic palette over the top of a published
  // convention. The FIELD travels with them: the dialog has to know that this
  // palette belongs to `regime` and not to whichever column is selected, or
  // exploring by method and coming back would quietly lose it.
  if (layer && entry.colours) {
    layer.cataloguePalette = { field: entry.colourBy, colours: entry.colours };
  }
  /**
   * A dataset that names the column worth colouring by gets it on arrival.
   *
   * `defaultSymbology` guesses, which is right for a file somebody dropped and
   * wrong for a catalogue entry: the guess ranks columns by how well they
   * spread, and for the volcanoes that is `country` -- a hundred hues saying
   * nothing about volcanoes. The entry knows better than the ranking, and can
   * still be recoloured from the Symbology button like anything else.
   */
  /**
   * A dataset whose interesting column is a NUMBER gets it classed, not listed.
   *
   * `colourBy` runs the categorical paint, which is right for rock names and
   * wrong for fire radiative power: quantiling a list of names is meaningless
   * and listing a continuous range gives one hue per distinct value. An entry
   * that names a `colourRange` gets `paintByRange` — the same classing the
   * rasters use, so a vector and a raster cut the same numbers the same way.
   */
  if (layer && entry.colourRange) {
    try {
      const { paintByRange } = await import(
        `./symbology-dialog.js${new URL(import.meta.url).search}`);
      const spec = entry.colourRange;
      paintByRange(layer, spec.field, {
        method: spec.method || "quantile",
        classes: spec.classes || 5,
        ramp: spec.ramp || "risk",
      });
    } catch (error) {
      /* the layer stands in its default colours */
    }
  } else if (layer && entry.colourBy) {
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
