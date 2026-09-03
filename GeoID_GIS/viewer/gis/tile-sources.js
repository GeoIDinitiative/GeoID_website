/**
 * The XYZ tile services this app draws, and the credit each one requires.
 *
 * One list, because there are now two consumers — the Map Composer's flat
 * canvas map (`research/map2d.js`) and the globe drape (`basemap-drape.js`) —
 * and a source added to one but not the other is the kind of drift that is
 * invisible until someone asks why the globe has fewer basemaps than the map.
 *
 * **The credit is not decoration.** Every service here is free to use *on
 * condition* of attribution, and a figure exported from either surface carries
 * that credit into print, so a wrong line is a licence breach rather than a
 * cosmetic slip. The Esri strings are the `copyrightText` their own service
 * returns (`.../MapServer?f=json`); this used to say "Esri", which credits
 * neither Vantor and Earthstar for the imagery nor the fifteen agencies behind
 * the topo map.
 *
 * **On OpenStreetMap's own tiles.** `tile.openstreetmap.org` is governed by the
 * OSMF Tile Usage Policy: interactive viewing is fine, bulk pre-fetching is not,
 * and access carries no guarantee ("may be withdrawn at any point"). Drawing the
 * tiles a user is actually looking at — which is all either consumer does — is
 * squarely within it. A production deployment should self-host or buy tiles
 * rather than lean on the foundation's servers.
 *
 * `maxZoom` is measured, not assumed: each was probed by requesting a tile over
 * Etna at increasing zoom until the service stopped answering.
 *
 * **Answering is not the same as having the detail.** EOX serves Sentinel-2
 * cloudless to zoom 18 and the sensor is 10 m/px: zoom 14 over Etna is already
 * 7.55 m/px, and the tiles past it are interpolation. Measured bytes down that
 * ladder — 17,710 at z10, 8,553 at z12, 5,226 at z14, then 4,863 / 6,017 /
 * 4,257 / 2,143 — fall to noise rather than carrying new information. Its
 * `maxZoom` is therefore the honest 14, not the 18 the server will hand over.
 * Same lesson as RainViewer's placeholder tiles and Earth Engine's `scale`:
 * quote what was DELIVERED, never what the source is capable of elsewhere.
 *
 * **`freeToStream: false` means "the licence has a condition you may not
 * meet".** It drives a warning beside the credit rather than hiding anything,
 * because which uses are permitted depends on who is looking — a university
 * and a funded product read a NonCommercial clause differently, and that is
 * the reader's call to make with the terms in front of them, not ours to make
 * silently by omitting the layer.
 */

/**
 * NASA GIBS dates its daily layers, and TODAY is not ready.
 *
 * Measured: 2026-08-27 returns 404 while 2026-08-26 returns a real JPEG, so
 * the imagery lands a day behind. Asking for yesterday is the difference
 * between a basemap and a blank globe. Resolved once, when the module loads,
 * so both consumers get an already-complete URL template — teaching two
 * separate `tileUrl` implementations about a `{time}` placeholder is exactly
 * the drift this file's header warns about. A tab left open across midnight
 * UTC keeps yesterday's date, which is correct imagery either way.
 *
 * Wall clock on purpose, NOT the viewer's simulated time: this is a real
 * photograph of a real day, and a scrubbed clock pointed at next week would
 * ask for a picture nobody has taken.
 */
function gibsDate() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export const GIBS_DATE = gibsDate();

/**
 * `distribute: false` — WORKS, BUT IS NOT OFFERED TO A VISITOR.
 *
 * A separate axis from `freeToStream`, and the difference matters. That one
 * describes the LICENCE: whether a condition rides on using the tiles at all.
 * This one is the decision taken about that condition for THIS deployment —
 * Esri's imagery is the best-looking map here and its item record puts it
 * under the Master License Agreement, so it is fine to work with locally and
 * not something to hand to every visitor to a public page.
 *
 * The source stays whole: registered in this table, fetchable, credited and
 * selectable in code. Only `listBaseLayerOptions` in `basemap-drape.js`
 * withholds it from the picker, and it says there how to turn it back on.
 * Deleting these entries instead would take the implementation with them.
 */
export const TILE_SOURCES = {
  "OpenStreetMap": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors",
    maxZoom: 19,
    kind: "map",
    licence: "ODbL. Free to use with attribution. The OSMF tile servers are "
      + "best-effort and forbid bulk pre-fetching; a real deployment self-hosts "
      + "or buys tiles.",
    freeToStream: true,
  },
  /**
   * CARTO'S TWO ARE GONE, and they were not merely unwanted — they were dead.
   * Their free CDN answers 200 with an "API KEY REQUIRED" watermark rather
   * than a tile (measured: 17 distinct colours in a zoom-3 `dark_all` tile),
   * so both offered the reader a basemap that renders as a nag across the
   * planet. `map2d.js` already opens on OpenStreetMap for this reason.
   */
  "ESRI Satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
    kind: "imagery",
    // Checked against the item record, not assumed: licenseInfo says "Esri
    // Master License Agreement" and states the layer is "not intended for
    // offline tile export". No charge and no key on this endpoint today, but
    // that is not the same as licensed for arbitrary embedding — and
    // compositing tiles into a canvas we then save is closer to export than to
    // viewing. Fine to look at; check with Esri before shipping it.
    licence: "Esri Master License Agreement. No charge on this endpoint, but "
      + "not licensed for unrestricted or commercial embedding, and explicitly "
      + "not for offline tile export. Esri's supported route is ArcGIS Location "
      + "Platform with an API key and a metered free tier.",
    freeToStream: false,
    distribute: false,
  },
  /**
   * The nearest thing to Esri's imagery that does not go through Esri.
   *
   * A cloud-free global mosaic built from Copernicus Sentinel-2 — one clean
   * picture of the whole planet at 10 m, where the daily sensors below give
   * you whatever weather there was. It is the layer to reach for when the
   * question is "what does the ground look like here" and the answer must
   * not depend on a licence nobody has checked.
   *
   * LICENCE, and this is the part that matters: the current editions are
   * **NonCommercial**. EOX releases them under CC BY-NC-SA 4.0 and sells
   * commercial use separately under its own Attribution-RestrictedUse
   * licence. Only the 2016 edition was CC BY 4.0, and it is no longer served
   * under a year we could verify — `s2cloudless-2016` returns 404, and the
   * unversioned `s2cloudless_3857` answers but cannot be shown to BE that
   * edition, so it is not offered here wearing a licence we cannot prove.
   */
  "Sentinel-2 Cloudless": {
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg",
    // EOX's own required wording, links included as they specify for online use.
    credit: "Sentinel-2 cloudless 2025 - https://s2maps.eu by EOX IT Services GmbH "
      + "(Contains modified Copernicus Sentinel data 2025)",
    // Measured: the service answers to 18, the sensor stops at 10 m/px.
    maxZoom: 14,
    kind: "imagery",
    licence: "CC BY-NC-SA 4.0 — free with attribution for NON-COMMERCIAL use. "
      + "Commercial use needs EOX's Attribution-RestrictedUse licence "
      + "(cloudless@eox.at). Copernicus Sentinel data itself is free and open, "
      + "including commercially; the cloud-free mosaic is EOX's own work.",
    freeToStream: false,
  },
  /**
   * Yesterday's Earth, photographed, and free of every string above.
   *
   * NASA's GIBS serves the VIIRS corrected-reflectance mosaic as open data —
   * no key, no subscription, no commercial clause — which makes it the one
   * imagery layer here that needs no judgement call before shipping. The
   * trade is resolution: it stops at zoom 9, about 250 m/px, so it is a
   * picture of continents and weather rather than of streets.
   *
   * It earns its place beside the Events tab. Those feeds say a wildfire is
   * burning and where; this layer shows the smoke leaving it, the cloud over
   * the storm, the dust off the Sahara — the same day, from the same globe.
   */
  // Named without brackets on purpose: `baseLayerIdFor` slugifies this into the
  // dropdown's option value, and "(yesterday)" left a trailing hyphen on the id
  // — harmless until something matches ids exactly. The day it is showing is on
  // the credit line, which is where a reader looks for it anyway.
  "NASA VIIRS Daily": {
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
      + `/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${GIBS_DATE}`
      + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
    credit: `VIIRS (Suomi NPP) corrected reflectance, ${GIBS_DATE} — NASA EOSDIS GIBS / Worldview`,
    maxZoom: 9,
    kind: "imagery",
    licence: "NASA EOSDIS open data — no charge, no key, no commercial "
      + "restriction. NASA asks only that GIBS/Worldview be acknowledged.",
    freeToStream: true,
  },
  "ESRI Topo": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, "
      + "NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, "
      + "Esri China (Hong Kong), © OpenStreetMap contributors, and the GIS User Community",
    maxZoom: 19,
    kind: "map",
    licence: "Esri Master License Agreement, as World Imagery above — no charge "
      + "on this endpoint, and not licensed for unrestricted or commercial "
      + "embedding. Offered locally, never on the public site.",
    freeToStream: false,
    distribute: false,
  },
};

/** Just the URL templates, the shape `map2d.js` has always taken. */
export const BASEMAPS = Object.fromEntries(
  Object.entries(TILE_SOURCES).map(([name, s]) => [name, s.url]),
);

export const ATTRIBUTION = Object.fromEntries(
  Object.entries(TILE_SOURCES).map(([name, s]) => [name, s.credit]),
);

/**
 * OpenStreetMap, not the satellite imagery.
 *
 * Esri's World Imagery is the better-looking default and the wrong one: its
 * item record puts it under the Esri Master License Agreement and rules out
 * offline tile export, so it should be a deliberate choice rather than what
 * everyone gets by opening the page. OSM is ODbL and unambiguous.
 */
export const DEFAULT_SOURCE = "OpenStreetMap";

/** `{z}/{x}/{y}` filled in. Esri orders its path `{z}/{y}/{x}`; the template says so. */
/**
 * IMAGERY ON A DATE — the only kind there is, free and keyless.
 *
 * GIBS is the one global archive that is addressed by TIME: MODIS Terra from
 * 2000-02-24 and VIIRS from 2012, both corrected-reflectance true colour at
 * 250 m, no key, CORS open, and NASA asking only to be acknowledged. Checked
 * against its own capabilities: there is no Landsat or Sentinel true-colour
 * mosaic in GIBS, so 250 m is the ceiling — which is context at ice-cap scale
 * and NOT an outline. A finer time series means Earth Engine (Landsat annual
 * composites at 30 m) through this site's own GEE service.
 *
 * VIIRS where it reaches, because it is the newer instrument and the cleaner
 * mosaic; MODIS for everything from 2000 to 2012.
 */
export const GIBS_IMAGERY_FROM = "2000-02-24";
const VIIRS_FROM = "2012-01-19";

export function gibsSourceFor(date) {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < GIBS_IMAGERY_FROM) return null;
  const viirs = day >= VIIRS_FROM;
  const layer = viirs
    ? "VIIRS_SNPP_CorrectedReflectance_TrueColor"
    : "MODIS_Terra_CorrectedReflectance_TrueColor";
  const id = `gibs-${viirs ? "viirs" : "modis"}-${day}`;
  if (!TILE_SOURCES[id]) {
    TILE_SOURCES[id] = {
      label: `${viirs ? "VIIRS" : "MODIS Terra"} true colour, ${day}`,
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
        + `/${layer}/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      // Level9 is the deepest the corrected-reflectance mosaics are served at:
      // asking for zoom 10 is a 400, not a sharper picture.
      maxZoom: 9,
      credit: `${viirs ? "VIIRS (Suomi NPP)" : "MODIS (Terra)"} corrected `
        + `reflectance, ${day} — NASA EOSDIS GIBS / Worldview`,
      licence: "NASA open data — no restriction; GIBS/Worldview acknowledged.",
      freeToStream: true,
    };
  }
  return id;
}

export function tileUrl(name, z, x, y) {
  const source = TILE_SOURCES[name];
  if (!source) throw new Error(`No tile source named "${name}".`);
  return source.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
