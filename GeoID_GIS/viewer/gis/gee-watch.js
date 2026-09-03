/**
 * The catalogue watcher — is Google's Earth Engine catalogue ahead of ours?
 *
 * `data/global/gee-catalogue.json` is BAKED, for the reason its own module
 * records: the STAC tree is 1 root + 131 provider catalogs + one JSON per
 * dataset, so keeping it live would mean eleven hundred requests at page open.
 * A baked index is a snapshot, and a snapshot goes stale silently — the panel
 * would go on offering last month's catalogue with nothing anywhere saying so.
 *
 * THE CHEAP SIGNAL IS THE BUCKET LISTING, NOT THE TREE. Google publishes the
 * STAC on Cloud Storage, and the JSON API lists a bucket a thousand objects at
 * a time — measured, the WHOLE catalogue is **2 requests** against the 1,272
 * the tree costs. Both endpoints answer CORS (the object endpoint `*`, the
 * listing endpoint by reflecting the Origin), which is why no key and no proxy
 * appears anywhere here.
 *
 * FOUR THINGS ABOUT THAT LISTING WERE MEASURED, AND EACH IS A WRONG ANSWER IF
 * ASSUMED:
 *
 * 1. **`updated` is not a change signal.** Google rewrites most of the bucket
 *    at once — measured on one listing, 1,176 of 1,686 objects carried the
 *    same day. Trusting it announces the whole catalogue as changed. The
 *    timestamps are read for nothing; only the NAMES are.
 * 2. **The listing is a SUPERSET of the tree.** 1,272 dataset objects against
 *    the index's 1,142, because an object can sit in the bucket without being
 *    linked from any provider catalog — 133 of them, most last touched in
 *    2023. So "in the bucket and not in our index" is NOT "new", and a diff
 *    against the index alone opens on 133 false alarms.
 * 3. **`-gfstmp-` objects are upload artefacts**, 236 of them, not datasets.
 * 4. **The id cannot be recovered from the path.** 109 records are filed under
 *    `projects/<owner>/assets/…` in a folder named nothing like their first
 *    path segment, which is why the bake CARRIES each href rather than
 *    computing it. So this module compares PATHS and reports paths; it never
 *    invents an id it cannot prove.
 *
 * Points 1 and 2 together are why the rules below are the ones `atlas-watch.js`
 * arrived at, and they are here for the same reason rather than by imitation.
 */

const STAMP = new URL(import.meta.url).search || "";

/**
 * The bucket listing. `fields` trims the reply to what is read — without it
 * every object carries its generation, etag, md5, storage class and a dozen
 * URLs, which is several times the payload for nothing.
 */
const LISTING = "https://storage.googleapis.com/storage/v1/b/earthengine-stac/o"
  + "?prefix=catalog/&fields=nextPageToken,items(name)&maxResults=1000";

/** Where the baseline lives. Per browser: it is a record of what THIS reader
 *  has already been told, which is not a fact about the project. */
const SEEN_KEY = "geoid-gee:catalogue-seen";

/** A listing is ~1,270 names; a runaway prefix must not fill localStorage. */
const MAX_PAGES = 8;

// ── The decision, pure ───────────────────────────────────────────────────────

/**
 * Is this object a dataset record at all?
 *
 * Rule 3 in its narrowest form: a provider catalog is structure, an upload
 * artefact is rubbish, and neither is news. Anything else under `catalog/`
 * ending `.json` is a published record.
 */
export function isDatasetObject(name) {
  const path = String(name || "");
  if (!path.startsWith("catalog/") || !path.endsWith(".json")) return false;
  if (path.endsWith("/catalog.json")) return false;
  if (path.includes("-gfstmp-")) return false;
  return true;
}

/**
 * What to say about a listing, given what was already known.
 *
 * Pure — no clock, no network, no storage — so the three rules can be pinned
 * against known inputs, which is the only way a rule that fails SILENTLY gets
 * tested at all. The impure part is the fetch and the two stores around it.
 *
 * @param names    every object name in the listing
 * @param indexed  the hrefs the baked index carries (`catalog/…json`)
 * @param seen     paths this reader has already been shown, or null on a first
 *                 run — which BASELINES and announces nothing
 */
export function triageCatalogue(names, indexed, seen) {
  const present = (names || []).filter(isDatasetObject);
  const known = seen instanceof Set ? seen : null;

  // The baseline is the index PLUS whatever was already in the bucket the
  // first time anybody looked. Seeding from the index alone would announce the
  // 133 unlinked objects, which have been sitting there for years.
  if (!known) {
    return {
      baseline: true, added: [], missing: 0,
      seen: new Set(present), total: present.length,
    };
  }

  const added = present.filter((path) => !known.has(path) && !indexed.has(path));
  /**
   * Records the bucket holds and our index does not — AND THIS IS NOT NEWS.
   *
   * It reads like the measure of how far behind a bake has fallen and it is
   * not: most of it is the unlinked residue described in the header, 133
   * objects that no re-bake would pick up because no provider catalog links
   * them, and which do not change from one month to the next. Saying it out
   * loud puts the same sentence in front of somebody every session — a
   * standing false alarm, which is rule 1's fault wearing a third costume.
   * Kept as a diagnostic, deliberately absent from `describeCheck`.
   */
  const missing = present.filter((path) => !indexed.has(path)).length;
  return {
    baseline: false, added, missing,
    seen: new Set([...known, ...present]), total: present.length,
  };
}

// ── The loop around it ───────────────────────────────────────────────────────

function readSeen() {
  try {
    const raw = window.localStorage?.getItem(SEEN_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? new Set(list) : null;
  } catch (error) {
    // A private window throws on the read. That is a first run, not a fault:
    // it baselines, which is the safe direction.
    return null;
  }
}

function writeSeen(seen) {
  try {
    window.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch (error) { /* quota or a private window; the check still worked */ }
}

/** Every object name under `catalog/`, paged. Two requests in practice. */
async function listBucket() {
  const names = [];
  let token = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = LISTING + (token ? `&pageToken=${encodeURIComponent(token)}` : "");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cloud Storage answered ${response.status}`);
    const payload = await response.json();
    (payload.items || []).forEach((item) => names.push(item.name));
    token = payload.nextPageToken || "";
    if (!token) return names;
  }
  // Ran out of pages rather than out of listing: report what was read and let
  // the caller decide, instead of pretending the tail does not exist.
  throw new Error("the catalogue listing is longer than this check expects");
}

let inflight = null;

/**
 * Check once, and remember. Held for the session: the bucket does not change
 * between two presses of the same button, and this is somebody else's storage.
 */
export function checkCatalogue(indexedHrefs) {
  if (inflight) return inflight;
  const indexed = indexedHrefs instanceof Set
    ? indexedHrefs : new Set(indexedHrefs || []);
  inflight = listBucket()
    .then((names) => {
      const result = triageCatalogue(names, indexed, readSeen());
      writeSeen(result.seen);
      return result;
    })
    .catch((error) => {
      inflight = null;              // a failed check must be retryable
      throw error;
    });
  return inflight;
}

/**
 * One sentence for the panel, or null when there is nothing worth a line.
 *
 * Silent on the baseline run (rule 1) and silent when the bucket holds nothing
 * the index lacks — a watcher that reports "no change" every time is a watcher
 * somebody learns to read past.
 */
export function describeCheck(result, bakedOn) {
  if (!result || result.baseline) return null;
  // ONLY a genuine publication speaks. `missing` is excluded on purpose — see
  // the note on it in `triageCatalogue`.
  if (!result.added.length) return null;
  const n = result.added.length;
  return `Google has published ${n} Earth Engine record${n === 1 ? "" : "s"} `
    + `since this browser last looked${bakedOn ? `; this index was baked ${bakedOn}` : ""}. `
    + "Re-run services/bake-gee-catalogue.py to browse them.";
}
