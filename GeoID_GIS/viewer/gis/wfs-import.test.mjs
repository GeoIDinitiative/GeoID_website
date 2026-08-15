/**
 * The feature-service importer: URLs, paging and the caps.
 *
 * Two classes of bug live here, and neither announces itself:
 *
 * 1. **The bbox axis order.** OGC API is longitude-first; WFS 2.0 follows the
 *    CRS, and EPSG:4326 is latitude-first. The same four numbers in the same
 *    order therefore mean Northern Ireland to one service and the Indian Ocean
 *    to the other — and the request succeeds either way, returning nothing, or
 *    worse, the wrong features. The expected strings below are written out
 *    coordinate by coordinate rather than computed, so a "tidy-up" that
 *    reorders them has to change this file too.
 *
 * 2. **The paging walk.** A next link that points at the page it came from is
 *    an infinite loop; a server that sends no next links at all needs the
 *    startIndex walk; and a query with no ceiling will pull a national dataset
 *    into a browser tab until it dies. The pages here are planted objects fed
 *    through an injected fetch, so all of it runs under node with no network.
 *
 * The truncation contract is checked exactly: `fetched` is the number of
 * features in the collection, not the number the last page happened to end on.
 *
 * Run: node GeoID_GIS/viewer/gis/wfs-import.test.mjs
 */

import {
  buildFeaturesUrl, detectApiKind, nextLink, mergePages, normalizeBbox,
  layerFileName, pageFeatures, fetchAllFeatures, importFromWfs,
} from "./wfs-import.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const equal = (name, got, want) =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ── fixtures ── */

const OGC_BASE = "https://demo.example.org/ogcapi";
const WFS_BASE = "https://maps.example.org/geoserver/wfs";
// Northern Ireland, as the study area would give it: [west, south, east, north].
const NI_BBOX = [-8.2, 54.05, -5.4, 55.3];

const params = (url) => new URL(url).searchParams;

/** A page of `count` features, with whatever links and extras are planted. */
function plantPage(count, links = [], extra = {}) {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-6.5, 54.6] },
      properties: { n: i },
    })),
    links,
    ...extra,
  };
}

/** A fetch that answers with planted pages in order and records what it was asked. */
function plantFetch(pages) {
  const calls = [];
  let index = 0;
  const impl = async (url) => {
    calls.push(String(url));
    if (index >= pages.length) throw new Error(`unexpected extra request: ${url}`);
    const page = pages[index];
    index += 1;
    if (page instanceof Error) throw page;
    if (page && page.__status) return { ok: false, status: page.__status };
    if (page && page.__notJson) {
      return { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
    }
    return { ok: true, status: 200, json: async () => page };
  };
  return { impl, calls };
}

/* ── OGC API - Features URLs ── */

{
  const url = buildFeaturesUrl(OGC_BASE, { collection: "hydro:rivers", limit: 500, kind: "ogcapi" });
  check("OGC API: the landing page grows /collections/<id>/items",
    new URL(url).pathname === "/ogcapi/collections/hydro%3Arivers/items", url);
  equal("OGC API: limit", params(url).get("limit"), "500");
  equal("OGC API: JSON is asked for explicitly", params(url).get("f"), "json");
  equal("OGC API: no paging parameter until one is asked for", params(url).get("offset"), null);
}

equal("OGC API: startIndex becomes offset",
  params(buildFeaturesUrl(OGC_BASE, { collection: "x", startIndex: 200, kind: "ogcapi" })).get("offset"),
  "200");

equal("OGC API: bbox is west,south,east,north — longitude first",
  params(buildFeaturesUrl(OGC_BASE, { collection: "x", bbox: NI_BBOX, kind: "ogcapi" })).get("bbox"),
  "-8.2,54.05,-5.4,55.3");

check("OGC API: a base that is already an items URL is not doubled",
  new URL(buildFeaturesUrl(`${OGC_BASE}/collections/x/items`, { collection: "x" })).pathname
    === "/ogcapi/collections/x/items");

check("OGC API: a collection URL gains /items",
  new URL(buildFeaturesUrl(`${OGC_BASE}/collections/x`, { collection: "x" })).pathname
    === "/ogcapi/collections/x/items");

check("OGC API: a trailing slash on the landing page is absorbed",
  new URL(buildFeaturesUrl(`${OGC_BASE}/`, { collection: "x", kind: "ogcapi" })).pathname
    === "/ogcapi/collections/x/items");

{
  let threw = "";
  try {
    buildFeaturesUrl(OGC_BASE, { limit: 10 });
  } catch (error) {
    threw = error.message;
  }
  check("a request with no layer named refuses rather than fetching the service root",
    /collection|typeNames/i.test(threw), threw);
}

/* ── WFS 2.0 URLs ── */

{
  const url = buildFeaturesUrl(WFS_BASE, { collection: "ni:landslides", limit: 1000 });
  const p = params(url);
  equal("WFS: service", p.get("service"), "WFS");
  equal("WFS: version defaults to 2.0.0", p.get("version"), "2.0.0");
  equal("WFS: request", p.get("request"), "GetFeature");
  equal("WFS: typeNames", p.get("typeNames"), "ni:landslides");
  equal("WFS: outputFormat asks for JSON, not GML", p.get("outputFormat"), "application/json");
  equal("WFS: the page size is count, not limit", p.get("count"), "1000");
  equal("WFS: srsName pins the answer to degrees", p.get("srsName"), "EPSG:4326");
}

equal("WFS: startIndex is the paging cursor",
  params(buildFeaturesUrl(WFS_BASE, { collection: "x", startIndex: 3000 })).get("startIndex"),
  "3000");

// The axis-order trap, written out in full.
equal("WFS 2.0 + EPSG:4326: bbox is south,west,north,east — LATITUDE first",
  params(buildFeaturesUrl(WFS_BASE, { collection: "x", bbox: NI_BBOX })).get("bbox"),
  "54.05,-8.2,55.3,-5.4,EPSG:4326");

equal("WFS: axisOrder overrides the CRS's own rule for a server that disagrees",
  params(buildFeaturesUrl(WFS_BASE, { collection: "x", bbox: NI_BBOX, axisOrder: "lonlat" })).get("bbox"),
  "-8.2,54.05,-5.4,55.3,EPSG:4326");

equal("WFS 1.0.0 predates the axis-order change and stays longitude first",
  params(buildFeaturesUrl(WFS_BASE, { collection: "x", bbox: NI_BBOX, version: "1.0.0" })).get("bbox"),
  "-8.2,54.05,-5.4,55.3,EPSG:4326");

{
  const p = params(buildFeaturesUrl(WFS_BASE, { collection: "x", limit: 50, version: "1.1.0" }));
  equal("WFS 1.1.0: typeName, singular — 2.0.0's spelling is rejected there", p.get("typeName"), "x");
  equal("WFS 1.1.0: typeNames is not sent as well", p.get("typeNames"), null);
  equal("WFS 1.1.0: maxFeatures, not count", p.get("maxFeatures"), "50");
}

{
  const url = buildFeaturesUrl("https://maps.example.org/geoserver/ows?token=abc", { collection: "x" });
  const p = params(url);
  equal("WFS: a parameter already on the endpoint survives", p.get("token"), "abc");
  equal("WFS: and the service parameters are added beside it", p.get("request"), "GetFeature");
}

equal("a next link is used verbatim rather than rebuilt",
  buildFeaturesUrl(OGC_BASE, { collection: "x", next: "https://elsewhere.example.org/p2?cursor=zzz" }),
  "https://elsewhere.example.org/p2?cursor=zzz");

/* ── which protocol ── */

equal("detect: /geoserver/wfs is WFS", detectApiKind(WFS_BASE), "wfs");
equal("detect: service=WFS on an /ows endpoint",
  detectApiKind("https://maps.example.org/geoserver/ows?service=WFS&request=GetCapabilities"), "wfs");
equal("detect: an ArcGIS WFSServer endpoint",
  detectApiKind("https://gis.example.org/server/rest/services/x/MapServer/WFSServer?request=GetCapabilities"),
  "wfs");
equal("detect: a /collections path is OGC API",
  detectApiKind(`${OGC_BASE}/collections/x/items`), "ogcapi");
equal("detect: a bare landing URL defaults to OGC API", detectApiKind(OGC_BASE), "ogcapi");
equal("detect: a landing document that declares conformance",
  detectApiKind({ title: "Demo", conformsTo: ["http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core"] }),
  "ogcapi");
equal("detect: a landing document with a data link",
  detectApiKind({ links: [{ rel: "data", href: "/collections" }] }), "ogcapi");

/* ── next links ── */

equal("nextLink: the href of rel=next",
  nextLink(plantPage(1, [{ rel: "self", href: "/a" }, { rel: "next", href: "/b" }])), "/b");
equal("nextLink: no next link is the end", nextLink(plantPage(1, [{ rel: "self", href: "/a" }])), null);
equal("nextLink: a page with no links at all", nextLink({ type: "FeatureCollection", features: [] }), null);
equal("nextLink: an OGC relation URI still reads as next",
  nextLink(plantPage(1, [{ rel: "http://www.opengis.net/def/rel/ogc/1.0/next", href: "/c" }])), "/c");
equal("nextLink: among several formats, follow the JSON one",
  nextLink(plantPage(1, [
    { rel: "next", href: "/html", type: "text/html" },
    { rel: "next", href: "/json", type: "application/geo+json" },
  ])), "/json");

/* ── merging ── */

{
  const merged = mergePages([plantPage(2), plantPage(3), plantPage(1)]);
  equal("mergePages: one collection", merged.type, "FeatureCollection");
  equal("mergePages: every feature, in page order", merged.features.length, 6);
  equal("mergePages: nothing else is invented", merged.numberMatched, undefined);
}
equal("mergePages: numberMatched carries through when the server states it",
  mergePages([plantPage(2, [], { numberMatched: 9 }), plantPage(2)]).numberMatched, 9);
equal("mergePages: no pages is an empty collection", mergePages([]).features.length, 0);
equal("pageFeatures: a lone Feature counts as one",
  pageFeatures({ type: "Feature", geometry: null, properties: {} }).length, 1);

/* ── bbox shapes ── */

check("normalizeBbox: an array passes through",
  JSON.stringify(normalizeBbox(NI_BBOX)) === JSON.stringify(NI_BBOX));
check("normalizeBbox: the connectors' {minLat,minLon,…} shape",
  JSON.stringify(normalizeBbox({ minLat: 54.05, maxLat: 55.3, minLon: -8.2, maxLon: -5.4 }))
    === JSON.stringify(NI_BBOX));
check("normalizeBbox: a raster's {minX,minY,maxX,maxY} bounds",
  JSON.stringify(normalizeBbox({ minX: -8.2, minY: 54.05, maxX: -5.4, maxY: 55.3 }))
    === JSON.stringify(NI_BBOX));
equal("normalizeBbox: a half-filled box asks for no filter at all",
  normalizeBbox({ minLon: -8.2, minLat: 54.05 }), null);
equal("normalizeBbox: nothing", normalizeBbox(null), null);

/* ── filenames ── */

equal("layerFileName: a namespaced type name becomes a legal filename",
  layerFileName("ni:landslides"), "ni_landslides.geojson");
equal("layerFileName: a plain collection id", layerFileName("rivers"), "rivers.geojson");
equal("layerFileName: an extension already present is not doubled",
  layerFileName("rivers.geojson"), "rivers.geojson");
equal("layerFileName: nothing to name", layerFileName(""), "features.geojson");

/* ── the paging walk ── */

{
  const first = buildFeaturesUrl(OGC_BASE, { collection: "x", limit: 2, kind: "ogcapi" });
  const second = `${first}&offset=2`;
  const { impl, calls } = plantFetch([
    plantPage(2, [{ rel: "next", href: second }]),
    plantPage(2, [{ rel: "next", href: `${first}&offset=4` }]),
    plantPage(1),
  ]);
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 }, { fetchImpl: impl });
  equal("walk: every page's features arrive", fc.features.length, 5);
  equal("walk: three requests were made", calls.length, 3);
  equal("walk: the second request is the first page's next link", calls[1], second);
  equal("walk: fetched matches the collection", fc.fetched, 5);
  equal("walk: pages counted", fc.pages, 3);
  equal("walk: a complete pull is not truncated", fc.truncated, false);
  equal("walk: and says nothing about why", fc.truncatedBy, undefined);
}

{
  // Servers commonly write next as a relative href.
  const { impl, calls } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?f=json&limit=2&offset=2" }]),
    plantPage(1),
  ]);
  await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 }, { fetchImpl: impl });
  equal("walk: a relative next link resolves against the page it came from",
    calls[1], "https://demo.example.org/ogcapi/collections/x/items?f=json&limit=2&offset=2");
}

{
  // A next link pointing at the page it came from is an infinite loop.
  const first = buildFeaturesUrl(OGC_BASE, { collection: "x", limit: 2, kind: "ogcapi" });
  const { impl, calls } = plantFetch([plantPage(2, [{ rel: "next", href: first }])]);
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 }, { fetchImpl: impl });
  equal("walk: a self-referential next link stops the walk", calls.length, 1);
  equal("walk: with what it had", fc.features.length, 2);
}

{
  // No next links anywhere: the startIndex walk, and a short page ends it.
  const { impl, calls } = plantFetch([plantPage(2), plantPage(1)]);
  const fc = await fetchAllFeatures(WFS_BASE, { collection: "x", limit: 2 }, { fetchImpl: impl });
  equal("walk: a server with no next links is paged by startIndex", calls.length, 2);
  equal("walk: the second request starts where the first ended",
    params(calls[1]).get("startIndex"), "2");
  equal("walk: a page shorter than the limit is the last page", fc.features.length, 3);
  equal("walk: and that is not a truncation", fc.truncated, false);
}

{
  // numberMatched says the whole answer has arrived even on a full page.
  const { impl, calls } = plantFetch([plantPage(2, [], { numberMatched: 2 })]);
  const fc = await fetchAllFeatures(WFS_BASE, { collection: "x", limit: 2 }, { fetchImpl: impl });
  equal("walk: numberMatched ends the walk without an extra empty request", calls.length, 1);
  equal("walk: numberMatched pull is complete", fc.truncated, false);
}

{
  const { impl, calls } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?offset=2" }]),
    plantPage(2, [{ rel: "next", href: "items?offset=4" }]),
    plantPage(2, [{ rel: "next", href: "items?offset=6" }]),
  ]);
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 },
    { fetchImpl: impl, maxPages: 2 });
  equal("cap: maxPages stops the walk", calls.length, 2);
  equal("cap: with the features it collected", fc.features.length, 4);
  equal("cap: truncated", fc.truncated, true);
  equal("cap: and says which cap it hit", fc.truncatedBy, "maxPages");
}

{
  const { impl } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?offset=2" }]),
    plantPage(2, [{ rel: "next", href: "items?offset=4" }]),
  ]);
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 },
    { fetchImpl: impl, maxFeatures: 3 });
  equal("cap: maxFeatures trims to the cap exactly, not to a page boundary",
    fc.features.length, 3);
  equal("cap: fetched is the number of features in the collection", fc.fetched, 3);
  equal("cap: truncated", fc.truncated, true);
  equal("cap: by the feature cap", fc.truncatedBy, "maxFeatures");
}

{
  // Exactly the cap, with nothing left behind, is NOT a truncation.
  const { impl } = plantFetch([plantPage(3)]);
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 100 },
    { fetchImpl: impl, maxFeatures: 3 });
  equal("cap: a pull that ends exactly on the cap is complete", fc.truncated, false);
  equal("cap: and reports its count", fc.fetched, 3);
}

{
  const seen = [];
  const { impl } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?offset=2" }]),
    plantPage(1),
  ]);
  await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 },
    { fetchImpl: impl, onProgress: (event) => seen.push(event.features) });
  check("progress: one report per page, cumulative",
    JSON.stringify(seen) === JSON.stringify([2, 3]), JSON.stringify(seen));
}

{
  const { impl } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?offset=2" }]),
    plantPage(1),
  ]);
  const thrower = () => { throw new Error("the status line blew up"); };
  const fc = await fetchAllFeatures(OGC_BASE, { collection: "x", limit: 2 },
    { fetchImpl: impl, onProgress: thrower });
  equal("progress: a failing progress display never ends the pull", fc.features.length, 3);
}

/* ── failures the user has to be able to read ── */

{
  const { impl } = plantFetch([{ __status: 404 }]);
  let message = "";
  try {
    await fetchAllFeatures(OGC_BASE, { collection: "x" }, { fetchImpl: impl });
  } catch (error) {
    message = error.message;
  }
  check("error: an HTTP status is reported with the host", /404/.test(message)
    && /demo\.example\.org/.test(message), message);
}

{
  const { impl } = plantFetch([{ __notJson: true }]);
  let message = "";
  try {
    await fetchAllFeatures(WFS_BASE, { collection: "x" }, { fetchImpl: impl });
  } catch (error) {
    message = error.message;
  }
  check("error: a GML-only server is named as such, not as a parse failure",
    /JSON/i.test(message) && /outputFormat/i.test(message), message);
}

{
  const { impl } = plantFetch([new Error("Failed to fetch")]);
  let message = "";
  try {
    await fetchAllFeatures(WFS_BASE, { collection: "x" }, { fetchImpl: impl });
  } catch (error) {
    message = error.message;
  }
  check("error: an unreachable host names the host and the likely cause",
    /maps\.example\.org/.test(message) && /CORS|offline/i.test(message), message);
}

/* ── the hand-off to the one import path ── */

{
  const handed = [];
  const importManager = { importFileList: async (files) => { handed.push(...files); } };
  const { impl } = plantFetch([
    plantPage(2, [{ rel: "next", href: "items?offset=2" }]),
    plantPage(1),
  ]);
  const result = await importFromWfs(WFS_BASE, { collection: "ni:landslides", limit: 2 },
    { fetchImpl: impl, importManager });
  equal("import: exactly one file is handed over", handed.length, 1);
  equal("import: named after the layer", handed[0].name, "ni_landslides.geojson");
  const parsed = JSON.parse(await handed[0].text());
  equal("import: the file holds every page's features", parsed.features.length, 3);
  equal("import: it is a FeatureCollection", parsed.type, "FeatureCollection");
  equal("import: the truncation flag travels with the file", parsed.truncated, false);
  equal("import: the caller is told what landed", result.features, 3);
  equal("import: and under what name", result.name, "ni_landslides.geojson");
}

{
  const handed = [];
  const importManager = { importFileList: async (files) => { handed.push(...files); } };
  const { impl } = plantFetch([plantPage(0)]);
  let message = "";
  try {
    await importFromWfs(WFS_BASE, { collection: "x", bbox: NI_BBOX }, { fetchImpl: impl, importManager });
  } catch (error) {
    message = error.message;
  }
  check("import: a query that matched nothing says so", /no features/i.test(message), message);
  equal("import: and no empty layer is added to the map", handed.length, 0);
}

{
  let message = "";
  try {
    await importFromWfs(WFS_BASE, { collection: "x" }, { fetchImpl: plantFetch([]).impl });
  } catch (error) {
    message = error.message;
  }
  check("import: with no import manager on the page, it says so rather than throwing at fetch time",
    /import manager/i.test(message), message);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
