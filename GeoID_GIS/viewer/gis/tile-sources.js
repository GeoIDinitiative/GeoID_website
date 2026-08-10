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
 */

export const TILE_SOURCES = {
  "OpenStreetMap": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors",
    maxZoom: 19,
    kind: "map",
  },
  "CartoDB Dark": {
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors, © CARTO",
    maxZoom: 19,
    kind: "map",
  },
  "CartoDB Positron": {
    url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors, © CARTO",
    maxZoom: 19,
    kind: "map",
  },
  "ESRI Satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
    kind: "imagery",
  },
  "ESRI Topo": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, "
      + "NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, "
      + "Esri China (Hong Kong), © OpenStreetMap contributors, and the GIS User Community",
    maxZoom: 19,
    kind: "map",
  },
};

/** Just the URL templates, the shape `map2d.js` has always taken. */
export const BASEMAPS = Object.fromEntries(
  Object.entries(TILE_SOURCES).map(([name, s]) => [name, s.url]),
);

export const ATTRIBUTION = Object.fromEntries(
  Object.entries(TILE_SOURCES).map(([name, s]) => [name, s.credit]),
);

export const DEFAULT_SOURCE = "ESRI Satellite";

/** `{z}/{x}/{y}` filled in. Esri orders its path `{z}/{y}/{x}`; the template says so. */
export function tileUrl(name, z, x, y) {
  const source = TILE_SOURCES[name];
  if (!source) throw new Error(`No tile source named "${name}".`);
  return source.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
