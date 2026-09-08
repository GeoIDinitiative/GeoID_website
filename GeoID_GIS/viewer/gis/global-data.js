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

import { runConnector } from "./research/connectors.js?v=20260908-f45bf2a";
import { dataUrl } from "./data-base.js?v=20260908-f45bf2a";
import { mathsFor } from "./equations.js?v=20260908-f45bf2a";
import {
  riskEdges, RISK_LABELS,
} from "./cyclone-risk.js?v=20260908-f45bf2a";
// The cyclone tracks are classed on the same scale the live storm markers
// band by, so the archive and the feed cut intensity at the same knots.
import { SAFFIR_SIMPSON_KTS } from "./event-sources.js?v=20260908-f45bf2a";

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
  // Hazards ▸ Tropical cyclones. The only home outside Geology and
  // Hydrology, because a cyclone track is neither the ground nor the water: it
  // is a record of what happened over them.
  hazards: "hazards-catalogue",
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
    /**
     * ON WHEN THE PAGE OPENS, at a third of full strength.
     *
     * Almost everything this app maps is read against the plates — the
     * seismicity most of all, which is 63% within 100 km of a boundary — so
     * they are the one dataset that is context for the others rather than a
     * subject of its own. That is also why they are faint: at full strength
     * 241 segments across the planet is a net drawn OVER the map, and the
     * point of them is to be underneath what you are reading.
     */
    defaultOn: true,
    opacity: 0.3,
  },
  {
    /**
     * EVERY TROPICAL CYCLONE ON RECORD, one line per storm.
     *
     * IBTrACS is the authoritative archive — every agency's best track,
     * reconciled by NOAA NCEI — and it is the historical companion to the live
     * storm markers: the same scale cuts both, so a Category 3 on the map now
     * and a Category 3 in 1972 are the same colour for the same reason.
     *
     * Baked rather than fetched live, which is unlike the two Tectonics rows
     * above it. The published shapefile is one feature per THREE-HOUR SEGMENT
     * (713,155 of them), and its longitudes run past 180 — which fails
     * `looksLikeGeographic` and files the whole layer as not georeferenced.
     * `services/bake-cyclone-tracks.py` records both, and what ships is one
     * line per storm with the seam already cut.
     */
    id: "cyclone-tracks",
    home: "hazards",
    featureNoun: "Cyclone track",
    group: "Hazards",
    label: "Tropical cyclone tracks (IBTrACS)",
    path: "/data/global/cyclone-tracks.geojson",
    name: "Tropical cyclone tracks (IBTrACS v04r01).geojson",
    summary: "13,513 storms from 1842 to 2026, each carrying its name, season, "
      + "basin, peak wind and lowest pressure \u2014 5,733 of them named and "
      + "6,246 with a measured peak intensity",
    licence: "IBTrACS v04r01, NOAA NCEI \u2014 open data; cite Knapp et al. (2010), "
      + "Bull. Amer. Meteor. Soc., 91, 363-376",
    /**
     * Cut on the SCALE, not on this file's own quantiles.
     *
     * `SAFFIR_SIMPSON_KTS` is the same list the live storm markers band by, so
     * the archive and the feed agree about where a category begins. A quantile
     * of 6,246 peak winds would put a boundary at 62 or 71 knots and call it a
     * class, which is a boundary that means nothing to anybody reading it.
     */
    // The scale's own words rather than the column's: "83 - 96" is the
    // arithmetic, "Category 2" is what the scale calls it. SIX bands, because
    // this layer holds storms that never reached hurricane force.
    colourRange: {
      field: "peak_wind_kts",
      edges: SAFFIR_SIMPSON_KTS,
      ramp: "risk",
      labels: ["Tropical storm or weaker", "Category 1", "Category 2",
        "Category 3", "Category 4", "Category 5"],
      legendLabel: "Strongest the storm got (Saffir\u2013Simpson)",
    },
    /**
     * Faint, and for the reason the plate boundaries are: thirteen thousand
     * tracks over the tropics is a web rather than a map at full strength, and
     * what anybody is reading is the ground underneath them.
     */
    opacity: 0.55,
    /**
     * The season animation belongs to THIS layer -- it draws the tracks, one
     * year at a time -- so the button is on its row and exists only while the
     * layer does. The span is read at the press rather than closed over,
     * because the select is redrawn whenever the catalogue is.
     */
    /**
     * THE SAME 13,513 TRACKS, READ TWO WAYS — and both are repaints, which is
     * the whole reason they belong on the symbology surface.
     *
     * "Reached hurricane force" is named for exactly what it is. It highlights
     * whole STORMS whose peak was 64 knots or more, which is not the same as
     * the stretches they spent at that strength: only 47% of Katrina's track
     * and 13% of Sandy's was at hurricane force. The stretches are genuinely
     * different geometry — a separate baked file — and a choice that loads a
     * different file is not a symbology: it drops the layer and rebuilds it,
     * which is the staged repaint this control was moved here to stop.
     */
    views: {
      label: "Show",
      options: [
        { id: "category", label: "Every storm, by category" },
        { id: "hurricane", label: "Only those that reached hurricane force" },
      ],
      current: () => window.GeoIDCycloneTracks?.currentView?.() || "category",
      apply: (view) => window.GeoIDCycloneTracks?.show(view),
    },
    /**
     * Ticking the tracks on opens the season bar, parked on its "All" frame —
     * the whole archive, unchanged. Nothing about the map differs from having
     * no bar at all; what is gained is that the years are one drag away.
     */
    animation: {
      open: () => {
        const span = Number(
          document.getElementById("cyclone-timelapse-span")?.value) || 1980;
        return window.GeoIDCycloneTimelapse?.play({ from: span });
      },
    },
  },
  {
    /**
     * HOW OFTEN A CYCLONE PASSES, as a map -- and the companion to the tracks
     * above rather than a second view of them. Thirteen thousand lines say
     * where every storm went; they cannot answer "how often does this happen
     * here", which is the question a reader has in front of them.
     *
     * THE NUMBER: distinct storms passing within 200 KM OF A POINT, per year,
     * over the 46 complete seasons since 1980. `p_yr` is 1 - exp(-rate), the
     * chance of at least one in a given year.
     *
     * WHY THE CELLS ARE DIFFERENT SIZES, and why that is safe. The value is
     * measured AT A POINT within a FIXED radius, so a cell's size is only how
     * finely the field is drawn there -- fine where it varies, coarse where
     * nothing happens. "Storms in this cell" would not be comparable at all: a
     * four-degree cell catches more storms by being big, and the map would be
     * a picture of its own resolution rather than of the hazard. Measured: 28
     * km cells over Florida and the Philippines, 444 km over the empty ocean.
     */
    id: "cyclone-risk",
    home: "hazards",
    featureNoun: "Cyclone risk cell",
    group: "Hazards",
    label: "Tropical cyclone risk \u2014 chance of a storm passing (IBTrACS)",
    path: "/data/global/cyclone-risk.geojson",
    name: "Tropical cyclone risk (IBTrACS v04r01).geojson",
    summary: "The chance a tropical cyclone passes within 200 km, per year, "
      + "over the 46 complete seasons 1980-2025. 91,156 cells at a variable "
      + "resolution \u2014 28 km where the field varies, 444 km where it does "
      + "not \u2014 each also carrying the rate for hurricane-force winds",
    licence: "IBTrACS v04r01, NOAA NCEI \u2014 open data; cite Knapp et al. (2010), "
      + "Bull. Amer. Meteor. Soc., 91, 363-376",
    /**
     * CUT ON RETURN PERIODS, not on this file's own quantiles -- the same
     * argument the tracks make for Saffir-Simpson. "Once a decade" and "once a
     * year" mean something before anybody looks at the data, and they are what
     * a reader is asking about; a quantile would move every boundary the
     * moment the window or the basin changed, so two of these maps could not
     * be read against each other.
     */
    colourRange: {
      field: "p_yr",
      edges: riskEdges(),
      labels: RISK_LABELS,
      legendLabel: "Chance of a storm passing within 200 km",
      ramp: "risk",
    },
    opacity: 0.6,
    /**
     * And the estimate animation belongs to THIS one: it plays this very map,
     * recomputed after each season, so the button sits on the row that put it
     * on the globe.
     */
    /**
     * And ticking the risk map opens the estimate bar on its LAST band, which
     * is the full-record climatology — the very map the layer draws. So here
     * the parking frame needs no special case: the sequence already ends on
     * the answer.
     */
    // Ticking it on IS choosing the default view, which is the estimate --
    // so the bar opens through the same call the symbology row makes, rather
    // than a second path that could drift from it.
    animation: {
      open: () => window.GeoIDCycloneRisk?.setView("estimate"),
    },
    /**
     * EVERY CELL CARRIES BOTH RATES, so this is a repaint of the layer already
     * loaded: 23 MB and 91,156 polygons fetched and triangulated once, not
     * twice for a column that is in memory. That is what lets it live on the
     * symbology surface rather than as a button of its own.
     */
    views: {
      label: "Show",
      options: [
        { id: "estimate", label: "The estimate over time" },
        { id: "storms", label: "Rate per year \u2014 any cyclone" },
        { id: "hurricanes", label: "Rate per year \u2014 hurricane force" },
      ],
      current: () => window.GeoIDCycloneRisk?.currentView?.() || "estimate",
      apply: (view) => window.GeoIDCycloneRisk?.setView(view),
    },
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
  { bbox: bboxArg = null, launch = false, ...connectorOptions } = {}) {
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
      {
        name: layerNameOf(entry),
        // `pointStyle` because the renderer cannot tell a large CATALOGUE from
        // a point CLOUD and they want opposite treatment; only the entry knows.
        pointStyle: entry.pointStyle || "auto",
        /**
         * A LAUNCH DEFAULT TOUCHES NEITHER THE CAMERA NOR THE SPIN.
         *
         * Both exist because an import is a gesture — you framed it and
         * stopped the globe in order to look at the thing you just added. A
         * layer that arrives because the page opened had no gesture behind it,
         * and framing a GLOBAL one throws the opening camera out to the whole
         * planet on every load.
         */
        ...(launch ? { frame: false, hold: false } : {}),
      },
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
      /**
       * AND A MODELLED ONE SHOWS ITS WORKING.
       *
       * By the entry's OWN id, so this is a seam rather than one more special
       * case: a catalogue dataset that has an `equations.js` entry gets the ⓘ
       * on its Workspace row, and one that has not gets no button. Most of
       * this catalogue is a survey rather than a model, and a survey has no
       * arithmetic to show — an "How it is calculated" fold over Natural
       * Earth's coastlines would suggest everything here is computed.
       *
       * It matters most for the cyclone risk map, which is the one entry
       * whose numbers this repository produces: a screening map whose method
       * is a secret has authority it has not earned.
       */
      const maths = mathsFor(entry.id);
      if (maths) landed.info = { ...(landed.info || {}), maths };
      /**
       * AND ITS ALTERNATIVE READINGS, which the symbology dialog offers as a
       * row. On the LAYER rather than looked up from the entry, because the
       * dialog is handed a layer and knows nothing about catalogues -- a
       * shapefile somebody dropped in reaches the same code.
       */
      if (entry.views?.apply) landed.symbologyViews = entry.views;
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
   * The weight a dataset opens at, where its own reading is not full strength.
   *
   * A layer that covers the whole globe is a BASEMAP unless you can see
   * through it: the stress mesh fills 2,860 cells of 300 km each, and at full
   * opacity that is an opaque sheet over the planet — reported as still being
   * a raster basemap when it had been vectors for a day. The plate boundaries
   * are the other shape of the same argument: they are drawn to be read
   * AGAINST what is under them, so they are a net over the map rather than
   * a layer covering it.
   *
   * Applied HERE rather than inside the symbology branch it used to live in.
   * There it reached only entries carrying a `colourBy`, so a dataset with one
   * flat colour — which is most lines — could not ask for a weight at all.
   * `setOpacity` records it on the layer, so the paint that follows rebuilds
   * every material and hands it back at the weight it was set to.
   */
  if (layer && Number.isFinite(entry.opacity)) {
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, entry.opacity);
    window.GeoIDLayerHierarchy?.render?.();
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
  /**
   * A VIEW IS THE COLOURING, so an entry that declares one does not also get
   * `colourRange`. They were both running — the view's paint first and
   * `paintByRange` a moment later over the top — which is two implementations
   * of one map, and the KEY differed between them: the layer arrived counting
   * 6,246 classed storms and, the moment anybody switched view and back, 13,513
   * with a row naming the 7,267 nobody measured. The second was the true one,
   * and it took a round trip through the dialog to see it.
   */
  if (layer && entry.views?.apply) {
    try {
      await entry.views.apply(entry.views.current?.());
    } catch (error) { /* the layer keeps whatever the import gave it */ }
  } else if (layer && entry.colourRange) {
    try {
      const { paintByRange } = await import(
        `./symbology-dialog.js${new URL(import.meta.url).search}`);
      const spec = entry.colourRange;
      paintByRange(layer, spec.field, {
        method: spec.method || "quantile",
        classes: spec.classes || 5,
        ramp: spec.ramp || "risk",
        // Where the entry names them: a published scale cuts where the scale
        // says, not where this particular file's values happen to fall.
        edges: spec.edges || null,
        // And a published scale is published in words. Without these the
        // cyclone risk map's key reads "0.0951 - 0.1813" where it means
        // "about 1 in 10 years".
        labels: spec.labels || null,
        legendLabel: spec.legendLabel || null,
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

/**
 * WHAT IS ON THE GLOBE WHEN THE PAGE OPENS.
 *
 * An entry may declare `defaultOn`, which is a claim that the map is better
 * with it than without it for somebody who has asked for nothing — the plate
 * boundaries, because most of what this app maps is read against them.
 *
 * It is a DEFAULT and not an imposition, so an explicit untick is remembered
 * and honoured. Getting a layer back the next morning after taking it off is
 * the app overruling a decision, and this file's own `restoreSources` refuses
 * to do that about a feed somebody unticked. Only the off is stored: a tick
 * that was never touched has said nothing, and a list of "still on" would go
 * stale the moment a new default is added.
 */
const LAUNCH_OFF_KEY = "geoid-gis:catalogue-off";

function switchedOff() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAUNCH_OFF_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch (error) {
    // No storage, or rubbish in it: nothing has been switched off that we can
    // prove, so the defaults stand.
    return new Set();
  }
}

function rememberOff(ids) {
  try {
    window.localStorage.setItem(LAUNCH_OFF_KEY, JSON.stringify([...ids]));
  } catch (error) { /* no storage, the choice is still live this session */ }
}

/** Called from the catalogue row: the tick is the gesture, either way. */
export function noteDatasetChoice(id, on) {
  if (!datasetById(id)?.defaultOn) return;   // nothing else has a default to override
  const off = switchedOff();
  if (on) off.delete(id); else off.add(id);
  rememberOff(off);
}

/** The ids to put on the globe at launch, minus anything switched off. */
export function launchDatasets() {
  const off = switchedOff();
  return DATASETS.filter((entry) => entry.defaultOn && !off.has(entry.id)).map((e) => e.id);
}

/**
 * Load them, one after another rather than at once: each is a live fetch and
 * seconds of geometry, and the page has a basemap to draw first. Failures are
 * swallowed on purpose — a default that cannot reach its source must not put
 * an error in front of somebody who did not ask for it, and the row is still
 * there to be ticked by hand.
 */
export async function loadLaunchDefaults() {
  for (const id of launchDatasets()) {
    try {
      await addDataset(id, () => {}, { launch: true });
      /**
       * A LAYER CAN FAIL WITHOUT ANYTHING THROWING. `importFileList` reports a
       * failure by setting the layer's status and a status line, not by
       * raising — so `addDataset` answers `ok` over an import that produced no
       * geometry, and the catch below never runs. A dead row nobody asked for
       * is worse than an unticked box: it is taken off, and the catalogue
       * still offers it to anybody who wants to try by hand.
       */
      const landed = layerForDataset(id);
      if (landed?.status === "error") {
        window.GeoIDImportManager?.removeLayer?.(landed.id);
      }
    } catch (error) { /* the catalogue row still offers it */ }
  }
}

if (typeof window !== "undefined") {
  window.GeoIDGlobalData = {
    DATASETS, GROUPS, grouped, datasetById, addDataset,
    layerNameOf, layerForDataset, isCatalogueLayer,
    launchDatasets, loadLaunchDefaults, noteDatasetChoice,
  };
}
