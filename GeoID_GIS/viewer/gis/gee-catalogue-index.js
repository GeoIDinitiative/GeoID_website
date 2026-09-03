import { dataUrl } from "./data-base.js?v=20260903-707d5b9";
/**
 * The whole Earth Engine data catalogue, searchable in the page.
 *
 * The app used to offer THIRTEEN datasets, because the image service holds an
 * allowlist and the page read it. Google publishes 1,139 — 1,021 of them
 * rasters with a default rendering — and none of them could be reached.
 *
 * They cannot be read live: the catalogue is a STAC tree of 1 root + 130
 * provider catalogs + one JSON per dataset, and the provider catalogs carry
 * only flattened ids, so a browser would need eleven hundred requests before
 * it could show a searchable list. `services/bake-gee-catalogue.py` walks it
 * once and writes `data/global/gee-catalogue.json` (869 KB, ~110 KB over the
 * wire) — the same discipline the volcano and geology catalogues use, and for
 * the same reason.
 *
 * This module owns that file: one fetch, held for the session, plus the
 * search everything else asks through. It is deliberately not a UI.
 */

/**
 * The data file takes the module's OWN stamp.
 *
 * `qt-layout.json` cost a whole verify loop by not doing this: the browser
 * served a stale copy against freshly stamped modules and a regenerated file
 * looked like it had changed nothing.
 */
const STAMP = new URL(import.meta.url).search;
// Absolute, not module-relative: `import.meta.url` here is `…/viewer/gis/`, so
// a relative "data/global/…" resolves inside `gis/` and 404s — the trap
// map-layers.js documents from one side and the GEE cache from the other.
const CATALOGUE_PATH = "/data/global/gee-catalogue.json";

let loading = null;
let catalogue = null;

/** The catalogue, fetched once. Rejects loudly; callers report it. */
export function loadCatalogue() {
  if (catalogue) return Promise.resolve(catalogue);
  if (loading) return loading;
  // Published, the URL already carries its own content fingerprint;
  // unpublished it takes the module stamp as it always did.
  loading = dataUrl(CATALOGUE_PATH)
    .then((url) => fetch(url === CATALOGUE_PATH ? `${url}${STAMP}` : url))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      catalogue = payload;
      // Searching lower-cased text per keystroke over 1,139 records is the
      // one thing here that would be felt; each record gets one haystack.
      catalogue.datasets.forEach((entry) => { entry._hay = haystack(entry); });
      return catalogue;
    })
    .catch((error) => {
      loading = null;                 // a failed load must be retryable
      throw error;
    });
  return loading;
}

function haystack(entry) {
  return [
    entry.id, entry.title, entry.summary,
    (entry.kw || []).join(" "), (entry.cats || []).join(" "),
    entry.provider || "",
  ].join(" ").toLowerCase();
}

/** Loaded already? Lets a caller draw something before the fetch lands. */
export function catalogueReady() { return Boolean(catalogue); }

/** The date the index was baked, so a panel can say how old the list is. */
export function bakedOn() { return catalogue?.baked || null; }

export function datasetCount() { return catalogue?.datasets?.length || 0; }

/**
 * Every record this index carries, as the BUCKET names it — `catalog/…json`.
 *
 * The watcher compares object paths rather than ids, because a record's URL
 * cannot be derived from its id (109 are filed under `projects/<owner>/…` in
 * a folder named nothing like their first path segment, which is why the bake
 * carries the href). Normalised here rather than in the watcher so there is
 * one place that knows both spellings.
 */
export function indexedHrefs() {
  const paths = new Set();
  (catalogue?.datasets || []).forEach((entry) => {
    const href = entry.href || "";
    const cut = href.indexOf("earthengine-stac/");
    if (cut >= 0) paths.add(href.slice(cut + "earthengine-stac/".length));
  });
  return paths;
}

/**
 * WHAT IS NEW, and the one rule that keeps it honest.
 *
 * `bake-gee-catalogue.py` stamps every entry with the bake it first appeared
 * in (`firstSeen`) and the bake at which its temporal extent last moved
 * forward (`extended`). Both are read by EQUALITY against the payload's own
 * `baked` date — never by comparing against today — so an index nobody has
 * re-baked for six months goes on naming the same handful of datasets rather
 * than quietly promoting older ones as the clock runs.
 *
 * A BASELINE BAKE HAS NO NEWS. The first run has no previous file to differ
 * from, so it stamps every id with its own date and says so on the payload;
 * without this guard the panel would open on eleven hundred "new" datasets,
 * which is the same fault `atlas-watch` records as its first rule.
 */
export function isNewDataset(entry) {
  if (!entry || catalogue?.baseline) return false;
  return entry.firstSeen === catalogue?.baked;
}

/** Its extent moved forward at this bake — a collection that gained imagery. */
export function isExtendedDataset(entry) {
  if (!entry || catalogue?.baseline) return false;
  return entry.extended === catalogue?.baked;
}

/** New or newly extended: what the panel's New chip counts and filters to. */
export function isFreshDataset(entry) {
  return isNewDataset(entry) || isExtendedDataset(entry);
}

/**
 * The counts behind the chip, and the date they are measured from — so the
 * panel can say "since 28 Aug" rather than "recently", which is not a claim
 * anybody can check.
 */
export function freshness() {
  const all = catalogue?.datasets || [];
  let added = 0;
  let extended = 0;
  all.forEach((entry) => {
    if (isNewDataset(entry)) added += 1;
    else if (isExtendedDataset(entry)) extended += 1;
  });
  return {
    added,
    extended,
    total: added + extended,
    since: catalogue?.previousBake || null,
    baked: catalogue?.baked || null,
    baseline: Boolean(catalogue?.baseline),
  };
}

/**
 * A dataset by its Earth Engine id — what a card needs to describe one, and
 * what the request path needs to know whether it can be draped at all.
 */
export function datasetById(id) {
  return catalogue?.datasets?.find((entry) => entry.id === id) || null;
}

/**
 * Google's own subject categories, with counts, commonest first.
 *
 * Their taxonomy rather than one of ours: it is the vocabulary the catalogue
 * is filed under, and inventing a parallel one would mean deciding which of
 * 1,139 datasets is "geology" — 1,126 decisions nobody here is qualified to
 * make and every one of them invisible when it is wrong.
 */
export function categories() {
  const counts = new Map();
  (catalogue?.datasets || []).forEach((entry) => {
    (entry.cats || []).forEach((cat) => counts.set(cat, (counts.get(cat) || 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, label: prettyCategory(id), count }));
}

export function prettyCategory(id) {
  return String(id).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Can this dataset be draped?
 *
 * Three things have to be true, and each excludes a real part of the
 * catalogue: it has to be a raster (a table is data, not a picture of data),
 * it has to name the bands to draw, and there has to be something to draw
 * them WITH — a stretch, or a classification's own colour table. 68 records
 * publish bands and neither, and rendering those would be grey noise under a
 * legend that says nothing.
 */
export function isDrapeable(entry) {
  if (!entry || (entry.type !== "image" && entry.type !== "image_collection")) return false;
  const vis = entry.vis;
  if (!vis?.bands?.length) return false;
  return Boolean(vis.classes?.length
    || (vis.min !== undefined && vis.max !== undefined));
}

/**
 * Search the catalogue.
 *
 * Deprecated datasets are OUT by default and counted rather than hidden: 253
 * of the 1,139 are superseded, and a search for "Landsat 5" that silently
 * returns nothing is worse than one that says how many were left out.
 * Non-drapeable ones are treated the same way — they exist, this app cannot
 * draw them, and pretending they are absent would be a different lie.
 */
export function searchCatalogue(options = {}) {
  return searchDatasets(catalogue?.datasets || [], options);
}

/**
 * The same search over a list handed in — pure, so the ordering rules can be
 * pinned by a test without a document, a fetch or the 869 KB file.
 */
export function searchDatasets(all, {
  query = "", category = "", includeDeprecated = false, drapeableOnly = true,
  freshOnly = false, limit = 60,
} = {}) {
  const needles = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  let deprecated = 0;
  let undrapeable = 0;
  const hits = [];
  for (const entry of all) {
    // Before every other exclusion, so the deprecated and undrapeable counts
    // reported alongside describe the set actually being searched.
    if (freshOnly && !isFreshDataset(entry)) continue;
    if (category && !(entry.cats || []).includes(category)) continue;
    // Built on demand as well as at load, so a caller that did not come
    // through loadCatalogue still searches the same text.
    if (!entry._hay) entry._hay = haystack(entry);
    if (needles.length && !needles.every((n) => entry._hay.includes(n))) continue;
    if (!includeDeprecated && entry.status === "deprecated") { deprecated += 1; continue; }
    if (drapeableOnly && !isDrapeable(entry)) { undrapeable += 1; continue; }
    hits.push(entry);
  }
  hits.sort(rank(needles));
  return {
    total: hits.length, deprecated, undrapeable,
    results: hits.slice(0, limit),
  };
}

/**
 * Ordering: a title match beats a body match, a shorter id beats a longer one.
 *
 * The second half matters more than it sounds. Searching "landsat" otherwise
 * puts `LANDSAT/LC08/C02/T1_L2/LC08_001004_20140524` — one scene — above
 * `LANDSAT/LC08/C02/T1_L2`, the collection somebody meant.
 */
function rank(needles) {
  return (a, b) => {
    const score = (entry) => {
      const title = entry.title.toLowerCase();
      const id = entry.id.toLowerCase();
      let points = 0;
      needles.forEach((n) => {
        if (title.startsWith(n) || id.toLowerCase().startsWith(n)) points -= 4;
        else if (title.includes(n)) points -= 2;
        else if (id.includes(n)) points -= 1;
      });
      if (entry.status === "beta") points += 1;
      return points;
    };
    return score(a) - score(b) || a.id.length - b.id.length || a.id.localeCompare(b.id);
  };
}

/**
 * A one-line description of what a dataset IS, for a card's second line:
 * kind, resolution and the years it covers.
 */
export function describeDataset(entry) {
  if (!entry) return "";
  const bits = [];
  bits.push(entry.type === "image" ? "Single image"
    : entry.type === "image_collection" ? "Image collection"
      : entry.type === "table_collection" ? "Table collection"
        : entry.type === "bigquery_table" ? "BigQuery table" : "Table");
  if (entry.gsd) {
    bits.push(entry.gsd >= 1000 ? `${(entry.gsd / 1000).toFixed(entry.gsd % 1000 ? 1 : 0)} km`
      : `${entry.gsd} m`);
  }
  if (entry.start) {
    const from = entry.start.slice(0, 4);
    const to = entry.end ? entry.end.slice(0, 4) : "now";
    bits.push(from === to ? from : `${from}–${to}`);
  }
  return bits.join(" · ");
}
