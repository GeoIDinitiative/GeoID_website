/**
 * Where a shipped data file is read from — the site, or the bucket.
 *
 * The baked pyramids answer this in their own manifests (`tiles_base`). The
 * LOOSE files under `data/global/` have no manifest, so `sources.json` — which
 * `services/publish-data.py` writes and which stays with the site — carries the
 * base and a content fingerprint per file.
 *
 * TWO RULES, and both fail silently when broken:
 *
 *   1. No `sources.json`, no base, or a file the table does not name → the
 *      LOCAL path is returned unchanged. That is the shipped-with-the-site
 *      behaviour, so a deployment that has published nothing works exactly as
 *      it always did, and a file added since the last publish is still found.
 *   2. A published file carries `?v=<fingerprint>`, because the bucket serves
 *      these under `immutable, max-age=1 year`. Without it a re-baked
 *      `volcanoes.geojson` would be invisible to every browser holding the old
 *      one, for a year — the trap the glacier pyramid already paid for.
 *
 * The table is fetched ONCE and shared; it is a few hundred bytes. A failure to
 * read it resolves to the empty table rather than rejecting, because the honest
 * fallback is "read it from the site" and not "the layer cannot load".
 */

const STAMP = new URL(import.meta.url).search || "";
const SOURCES = `/data/global/sources.json${STAMP}`;
const PREFIX = "/data/global/";

let table = null;

function sources() {
  if (!table) {
    table = fetch(SOURCES)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return table;
}

/**
 * `/data/global/ice/names.json` → `<base>/ice/names.json?v=<hash>`
 *
 * THE BUCKET ROOT MIRRORS `data/global/`, which is what lets one rule serve
 * both a loose file and a pyramid's sidecar: strip the prefix and the rest is
 * the key. Anything not under that prefix — an absolute URL to somebody else's
 * service, say — is returned untouched.
 */
async function dataUrl(path) {
  const local = String(path || "");
  if (!local.startsWith(PREFIX)) return local;
  const body = await sources();
  const base = body && body.base;
  if (!base) return local;
  // Trailing slash stripped: the publisher already does this when it
  // writes the base, but a hand-edited sources.json would otherwise
  // produce `//volcanoes.geojson`, which some hosts 404.
  const root = String(base).replace(/\/+$/, "");
  const rel = local.slice(PREFIX.length);
  const stamp = (body.files || {})[rel];
  if (!stamp) return local;
  return `${root}/${rel}?v=${stamp}`;
}

/** Test seam: forget the fetched table so a fixture can be installed. */
function resetForTests(fixture) {
  table = fixture === undefined ? null : Promise.resolve(fixture);
}

export { dataUrl, resetForTests, PREFIX };
