/**
 * Pulling a layer straight out of a feature service — OGC API - Features and
 * classic WFS 2.0, paged.
 *
 * The connectors (`research/connectors.js`) each know one endpoint by name.
 * This is the other half: a service the user names themselves, which is how a
 * national mapping agency's whole catalogue becomes reachable without a
 * connector per layer. Two protocols cover almost all of them, and they differ
 * in every detail that matters:
 *
 *   OGC API  /collections/<id>/items?limit=100&bbox=w,s,e,n
 *   WFS 2.0  ?service=WFS&version=2.0.0&request=GetFeature&typeNames=<id>
 *            &outputFormat=application/json&count=100&startIndex=100
 *            &bbox=s,w,n,e,EPSG:4326
 *
 * **The bbox axis order is the trap, and it is not a preference.** OGC API is
 * always CRS84 — longitude first. WFS 2.0 follows the axis order the CRS
 * declares, and EPSG:4326 declares latitude first, which is why the same four
 * numbers in the same order return Somalia from one service and Ireland from
 * the other. The default here follows each protocol's own rule (and drops to
 * longitude-first for WFS 1.0.0, which predates that change); `axisOrder`
 * overrides it for a server that disagrees with its own specification.
 *
 * The structure mirrors connectors.js deliberately: pure URL builders, a pure
 * page merger and a pure next-link reader, with the one impure runner on top —
 * which is what lets the paging be tested against planted pages with no
 * network at all, and the paging is where the bugs live (a next link that
 * points at itself, a server that never sends one, a query that would pull
 * four million features into a browser tab).
 *
 * Nothing here draws anything. `importFromWfs` hands the collected
 * FeatureCollection to `window.GeoIDImportManager.importFileList` as a named
 * .geojson File — the SAME path a dropped file takes — so the layer is
 * georeferenced, listed, styled, exported and recorded on the project by code
 * that already exists rather than by a second import path.
 */

const DEFAULT_MAX_FEATURES = 50000;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_PAGE_LIMIT = 1000;

/* ── pure: what the request looks like ───────────────────────────────────── */

/**
 * A bbox in any of the three shapes this codebase carries, as [w, s, e, n].
 *
 * `connectors.js` speaks {minLat, maxLat, minLon, maxLon}; a raster's bounds
 * are {minX, minY, maxX, maxY} with X as longitude; GeoJSON writes a bare
 * array. Returns null for anything incomplete, so a half-filled form asks for
 * the whole layer rather than for a bbox with a NaN in it.
 */
export function normalizeBbox(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox)) {
    const nums = bbox.slice(0, 4).map(Number);
    if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return null;
    return nums;
  }
  if (typeof bbox !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      if (bbox[key] !== undefined && bbox[key] !== null && bbox[key] !== "") return Number(bbox[key]);
    }
    return NaN;
  };
  const box = [
    pick("minLon", "minlon", "west", "minX", "minx"),
    pick("minLat", "minlat", "south", "minY", "miny"),
    pick("maxLon", "maxlon", "east", "maxX", "maxx"),
    pick("maxLat", "maxlat", "north", "maxY", "maxy"),
  ];
  return box.some((n) => !Number.isFinite(n)) ? null : box;
}

function safeUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

function resolveUrl(href, base) {
  try {
    return new URL(String(href), String(base)).toString();
  } catch {
    return String(href);
  }
}

/**
 * Which protocol is this? — from a base URL, or from a landing-page document.
 *
 * A landing page answers definitively (`conformsTo` is OGC API's own
 * self-description). A URL is a heuristic, in the order that a wrong guess is
 * cheapest: an explicit `service=WFS` beats the path, `/collections` is
 * conclusive for OGC API, and the WFS endpoints of the three server families
 * that matter here are `/wfs`, `/ows` and ArcGIS's `…/WFSServer`.
 */
export function detectApiKind(input) {
  if (input && typeof input === "object") {
    if (Array.isArray(input.conformsTo)) return "ogcapi";
    if (Array.isArray(input.collections)) return "ogcapi";
    if (Array.isArray(input.links)) {
      const rels = input.links.map((link) => String(link?.rel || "").toLowerCase());
      if (rels.some((rel) => rel === "conformance" || rel.endsWith("/conformance")
        || rel === "data" || rel.endsWith("/data") || rel === "items")) {
        return "ogcapi";
      }
    }
    if (String(input.service || "").toUpperCase() === "WFS") return "wfs";
    if (input.WFS_Capabilities || input.wfsCapabilities) return "wfs";
    return "ogcapi";
  }

  const text = String(input || "");
  const url = safeUrl(text);
  if (url) {
    const params = new Map();
    url.searchParams.forEach((value, key) => params.set(key.toLowerCase(), value));
    if (String(params.get("service") || "").toUpperCase() === "WFS") return "wfs";
    if (params.has("typenames") || params.has("typename")) return "wfs";
    const path = url.pathname.toLowerCase();
    if (path.includes("/collections") || path.includes("/items")) return "ogcapi";
    if (path.includes("wfsserver") || /(^|\/)wfs(\/|$)/.test(path) || /(^|\/)ows(\/|$)/.test(path)) {
      return "wfs";
    }
    return "ogcapi";
  }
  return /service=wfs|typenames?=/i.test(text) ? "wfs" : "ogcapi";
}

function bboxParam(box, kind, opts) {
  const [w, s, e, n] = box;
  if (kind !== "wfs") return [w, s, e, n].join(",");   // OGC API is always CRS84
  const crs = opts.bboxCrs === undefined ? "EPSG:4326" : opts.bboxCrs;
  const version = String(opts.version || "2.0.0");
  // WFS 1.0.0 is longitude-first; 1.1.0 and 2.0.0 follow the CRS, and EPSG:4326
  // is latitude-first. An explicit axisOrder always wins.
  const latFirst = opts.axisOrder
    ? String(opts.axisOrder).toLowerCase().replace(/[^a-z]/g, "") === "latlon"
    : Boolean(crs) && /4326/.test(String(crs)) && !version.startsWith("1.0");
  const coords = latFirst ? [s, w, n, e] : [w, s, e, n];
  return crs ? coords.concat(crs).join(",") : coords.join(",");
}

function ogcApiUrl(base, collection, opts) {
  const url = safeUrl(base);
  if (!url) throw new Error(`"${base}" is not a URL.`);
  let path = url.pathname.replace(/\/+$/, "");
  if (!/\/items$/i.test(path)) {
    if (/\/collections\/[^/]+$/i.test(path)) path += "/items";
    else path = `${path.replace(/\/collections$/i, "")}/collections/${encodeURIComponent(collection)}/items`;
  }
  url.pathname = path;
  if (opts.format !== null) url.searchParams.set("f", opts.format || "json");
  if (Number(opts.limit) > 0) url.searchParams.set("limit", String(Math.floor(Number(opts.limit))));
  if (Number(opts.startIndex) > 0) url.searchParams.set("offset", String(Math.floor(Number(opts.startIndex))));
  const box = normalizeBbox(opts.bbox);
  if (box) url.searchParams.set("bbox", bboxParam(box, "ogcapi", opts));
  if (opts.datetime) url.searchParams.set("datetime", String(opts.datetime));
  applyExtra(url, opts.extra);
  return url.toString();
}

function wfsUrl(base, typeNames, opts) {
  const url = safeUrl(base);
  if (!url) throw new Error(`"${base}" is not a URL.`);
  const version = String(opts.version || "2.0.0");
  const two = version.startsWith("2.");
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", version);
  url.searchParams.set("request", "GetFeature");
  // 2.0.0 renamed both of these, and a 1.1.0 server rejects the 2.0.0 spelling
  // outright rather than ignoring it.
  url.searchParams.set(two ? "typeNames" : "typeName", typeNames);
  url.searchParams.set("outputFormat", opts.outputFormat || "application/json");
  if (Number(opts.limit) > 0) {
    url.searchParams.set(two ? "count" : "maxFeatures", String(Math.floor(Number(opts.limit))));
  }
  // Paging arrived with 2.0.0; asking an older server to start at an offset
  // silently returns the first page again, so it is not asked.
  if (two && Number(opts.startIndex) > 0) {
    url.searchParams.set("startIndex", String(Math.floor(Number(opts.startIndex))));
  }
  const box = normalizeBbox(opts.bbox);
  if (box) url.searchParams.set("bbox", bboxParam(box, "wfs", opts));
  // Without srsName a server answers in its own projection and the features
  // land wherever those metres happen to plot. Ask for degrees explicitly.
  if (opts.srsName !== null) url.searchParams.set("srsName", opts.srsName || "EPSG:4326");
  if (opts.cql) url.searchParams.set("cql_filter", String(opts.cql));
  applyExtra(url, opts.extra);
  return url.toString();
}

function applyExtra(url, extra) {
  if (!extra || typeof extra !== "object") return;
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
}

/**
 * The URL of one page of features.
 *
 * `next` short-circuits everything else: a next link is the server's own
 * paging cursor and may carry tokens no builder could reconstruct, so it is
 * resolved against the base and used verbatim.
 */
export function buildFeaturesUrl(base, opts = {}) {
  if (opts.next) return resolveUrl(opts.next, base);
  const kind = opts.kind || detectApiKind(base);
  const collection = opts.collection || opts.typeNames || opts.typeName || "";
  if (!collection) {
    throw new Error("Name the layer to fetch: a collection id for OGC API, or typeNames for WFS.");
  }
  return kind === "wfs"
    ? wfsUrl(base, String(collection), opts)
    : ogcApiUrl(base, String(collection), opts);
}

/** The features of one page, whatever shape the server wrapped them in. */
export function pageFeatures(page) {
  if (!page || typeof page !== "object") return [];
  if (Array.isArray(page.features)) return page.features.filter(Boolean);
  if (page.type === "Feature") return [page];
  return [];
}

/**
 * The href of this page's rel=next link, or null when the paging ends here.
 *
 * Servers write the relation both bare ("next") and as an IANA/OGC URI, and
 * some offer the same next page in several formats — the JSON one is the one
 * to follow, or the walk lands on an HTML page and the run ends on a parse
 * error that looks like a server fault.
 */
export function nextLink(page) {
  const links = Array.isArray(page?.links) ? page.links : [];
  const nexts = links.filter((link) => {
    if (!link || typeof link.href !== "string" || !link.href) return false;
    const rel = String(link.rel || "").toLowerCase().trim();
    return rel === "next" || rel.endsWith("/next");
  });
  if (!nexts.length) return null;
  const json = nexts.find((link) => /json/i.test(String(link.type || "")));
  return (json || nexts[0]).href;
}

/** Every page's features, in order, as one FeatureCollection. */
export function mergePages(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const features = [];
  let numberMatched = null;
  let crs = null;
  for (const page of list) {
    for (const feature of pageFeatures(page)) features.push(feature);
    if (numberMatched === null && Number.isFinite(Number(page?.numberMatched))) {
      numberMatched = Number(page.numberMatched);
    }
    if (!crs && page?.crs) crs = page.crs;
  }
  const collection = { type: "FeatureCollection", features };
  if (numberMatched !== null) collection.numberMatched = numberMatched;
  if (crs) collection.crs = crs;
  return collection;
}

/** `ns:layer` is a legal type name and an illegal filename. */
export function layerFileName(collection) {
  const raw = String(collection || "features").trim();
  const base = raw.split(/[/\\]/).pop().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  const safe = base || "features";
  return /\.geojson$/i.test(safe) ? safe : `${safe}.geojson`;
}

/* ── impure: the walk ────────────────────────────────────────────────────── */

function hostOf(url) {
  return safeUrl(url)?.host || String(url);
}

async function getJson(doFetch, url, headers, signal) {
  let response;
  try {
    response = await doFetch(url, {
      headers: { Accept: "application/geo+json, application/json;q=0.9", ...(headers || {}) },
      signal,
    });
  } catch {
    // An offline machine and a cross-origin block surface identically here;
    // name the host so the cause is legible rather than "failed to fetch".
    throw new Error(`Could not reach ${hostOf(url)}. It may be offline, or this `
      + "origin is blocked by the service (CORS).");
  }
  if (!response) throw new Error(`${hostOf(url)} returned nothing.`);
  if (response.ok === false) {
    throw new Error(`${hostOf(url)} returned HTTP ${response.status}.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${hostOf(url)} did not return JSON. A WFS server needs `
      + "outputFormat=application/json; some only speak GML.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`${hostOf(url)} returned no feature collection.`);
  }
  if (payload.exceptionReport || payload.ExceptionReport) {
    const report = payload.exceptionReport || payload.ExceptionReport;
    const text = report?.exceptions?.[0]?.exceptionText || report?.exceptionText || "";
    throw new Error(`The service reported an error${text ? `: ${text}` : "."}`);
  }
  return payload;
}

/**
 * Where the next page is, or null when there is no next page.
 *
 * Two mechanisms, in order of trust: the server's own next link, then a
 * startIndex/offset walk for the many services that page without advertising
 * it. The startIndex walk stops on a short page — a page holding fewer than
 * the limit asked for is the last one — because otherwise the only way to
 * learn there is nothing left is to fetch an empty page, and a server that
 * ignores startIndex entirely would then be re-fetched until the cap.
 */
function nextPageUrl(context) {
  const { page, base, url, query, seen, count, limit, got } = context;
  const href = nextLink(page);
  if (href) {
    const absolute = resolveUrl(href, url);
    return seen.has(absolute) ? null : absolute;   // a next link pointing at itself
  }
  if (got === 0) return null;
  const matched = Number(page?.numberMatched);
  if (Number.isFinite(matched) && count >= matched) return null;
  if (got < limit) return null;
  const absolute = buildFeaturesUrl(base, { ...query, next: null, startIndex: count });
  return seen.has(absolute) ? null : absolute;
}

/**
 * Fetch every page of a query and return one FeatureCollection.
 *
 * The caps are the point, not a formality: a national parcel layer is tens of
 * millions of features, and a browser tab asking for it without a ceiling dies
 * silently with the fetch still running. So the result always says what it is
 * — `fetched` is the exact count returned, and `truncated` / `truncatedBy`
 * say whether that is the whole answer or the first `maxFeatures` of it. A
 * truncated pull trimmed to the cap exactly, never rounded up to a page
 * boundary, so the number in the FC is the number of features in the FC.
 */
export async function fetchAllFeatures(base, opts = {}, runOpts = {}) {
  const {
    maxFeatures = DEFAULT_MAX_FEATURES,
    maxPages = DEFAULT_MAX_PAGES,
    onProgress = null,
    fetchImpl = null,
    headers = null,
    signal = undefined,
  } = runOpts;
  const doFetch = fetchImpl
    || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("This environment has no fetch.");

  const kind = opts.kind || detectApiKind(base);
  const limit = Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : DEFAULT_PAGE_LIMIT;
  const query = { ...opts, kind, limit };
  const seen = new Set();
  const pages = [];
  let url = buildFeaturesUrl(base, query);
  let count = 0;
  let truncatedBy = null;

  for (;;) {
    seen.add(url);
    const page = await getJson(doFetch, url, headers, signal);
    pages.push(page);
    const got = pageFeatures(page).length;
    count += got;
    if (typeof onProgress === "function") {
      try {
        onProgress({ page: pages.length, features: count, url, expected: Number(page?.numberMatched) || null });
      } catch {
        /* a progress display must never end the pull */
      }
    }
    const next = nextPageUrl({ page, base, url, query, seen, count, limit, got });
    if (count >= maxFeatures) {
      truncatedBy = (count > maxFeatures || next) ? "maxFeatures" : null;
      break;
    }
    if (!next) break;
    if (pages.length >= maxPages) {
      truncatedBy = "maxPages";
      break;
    }
    url = next;
  }

  const collection = mergePages(pages);
  if (collection.features.length > maxFeatures) collection.features.length = maxFeatures;
  collection.fetched = collection.features.length;
  collection.pages = pages.length;
  collection.truncated = Boolean(truncatedBy);
  if (truncatedBy) collection.truncatedBy = truncatedBy;
  return collection;
}

function makeGeoJsonFile(collection, name, FileImpl) {
  const text = JSON.stringify(collection);
  const type = "application/geo+json";
  const Ctor = FileImpl || (typeof File === "function" ? File : null);
  if (Ctor) return new Ctor([text], name, { type });
  const blob = new Blob([text], { type });
  try {
    Object.defineProperty(blob, "name", { value: name });
  } catch {
    /* a Blob that will not take a name still imports if the caller names it */
  }
  return blob;
}

/**
 * Pull a layer and put it on the globe through the one standard import path.
 *
 * The FeatureCollection is written into a File named after the collection and
 * handed to `importFileList`, which is what a dropped file goes through — so
 * the layer gets its georeferencing, its entry in the layer list, its
 * properties panel, its export and its record in the project's data registry
 * from code that already exists. Nothing here touches the scene.
 */
export async function importFromWfs(base, opts = {}, runOpts = {}) {
  const manager = runOpts.importManager
    || (typeof window !== "undefined" ? window.GeoIDImportManager : null);
  if (!manager || typeof manager.importFileList !== "function") {
    throw new Error("The import manager is not on this page, so there is nowhere to put the layer.");
  }
  const collection = await fetchAllFeatures(base, opts, runOpts);
  const name = layerFileName(opts.collection || opts.typeNames || opts.typeName || "features");
  if (!collection.features.length) {
    // An empty layer in the list is worse than a message: it looks like a
    // failed import of real data rather than a query that matched nothing.
    throw new Error(`${name} returned no features`
      + (opts.bbox ? " in this area. Try without the study-area filter." : "."));
  }
  const before = new Set((manager.getLayers?.() || []).map((l) => l.id));
  await manager.importFileList([makeGeoJsonFile(collection, name, runOpts.FileImpl)]);
  /**
   * The QUERY is kept on the layer it produced, so a study area can ask the
   * service again.
   *
   * A WFS layer is already exact geometry — there is no coarser or finer
   * version of a boundary — so "highest resolution available" means something
   * different here: the fetch runs under a feature COUNT limit, and what a cap
   * cut off is not detail smeared away but whole features missing. Re-asking
   * for a smaller bbox is how they come back.
   *
   * `importFileList` answers with nothing, so the layer is found by what
   * appeared: ids taken before, and the difference after.
   */
  const added = (manager.getLayers?.() || []).filter((l) => !before.has(l.id));
  const layer = added.find((l) => String(l.name || "").startsWith(name)) || added[0] || null;
  if (layer) attachWfsRefine(layer, base, opts, runOpts, collection);
  return {
    name,
    features: collection.features.length,
    fetched: collection.fetched,
    pages: collection.pages,
    truncated: collection.truncated,
    truncatedBy: collection.truncatedBy || null,
  };
}

/**
 * A WFS LAYER RE-ASKS FOR A STUDY AREA when a cap cut its answer short.
 *
 * `refineFor` is the contract the tool runner puts to every input before a run
 * that has a ground. For a feature service the honest answer has two branches,
 * and the second one matters as much as the first:
 *
 *   - the import was TRUNCATED, so the layer holds the first N features of a
 *     larger answer and the study area may be mostly in the part that never
 *     arrived. Re-asking with a bbox returns that ground in full;
 *   - the import was COMPLETE, and there is nothing to fetch. Saying so beats
 *     a silent no-op, and beats a request that spends the service's time to
 *     receive what is already in hand.
 *
 * The layer is put back by `restoreLive` either way: a clip must not leave the
 * map holding one study area's features, which this codebase already records
 * as the fault that sent click-picks to the wrong polygon.
 */
export function attachWfsRefine(layer, base, opts, runOpts, imported) {
  layer.wfsQuery = { base, opts, truncated: Boolean(imported?.truncated) };
  layer.refineFor = async (area) => {
    if (!layer.wfsQuery.truncated) {
      return `${layer.name}: every feature already in hand, nothing to re-fetch.`;
    }
    const bbox = [area.minX, area.minY, area.maxX, area.maxY];
    const fresh = await fetchAllFeatures(base, { ...opts, bbox }, runOpts);
    const features = fresh?.features || [];
    if (!features.length) return "";
    const had = { collection: layer.collection, features: layer.features };
    const hadRestore = layer.restoreLive;
    layer.collection = { type: "FeatureCollection", features };
    layer.features = features;
    layer.restoreLive = () => {
      layer.collection = had.collection;
      layer.features = had.features;
      layer.restoreLive = hadRestore;
    };
    const was = had.features?.length || 0;
    return `${layer.name}: re-fetched for the study area, ${features.length} features`
      + (features.length > was ? ` where the capped import held ${was}` : "")
      + (fresh.truncated ? " (still capped — narrow the area for the rest)" : "")
      + ".";
  };
}

/* ── the seam ────────────────────────────────────────────────────────────── */

if (typeof window !== "undefined") {
  window.GeoIDWfsImport = Object.assign(window.GeoIDWfsImport || {}, {
    fetchAllFeatures,
    importFromWfs,
    attachWfsRefine,
    buildFeaturesUrl,
    detectApiKind,
  });
}
