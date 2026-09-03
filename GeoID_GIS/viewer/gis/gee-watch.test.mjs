/**
 * The catalogue watcher's triage, and the freshness the bake stamps.
 *
 * Every rule here fails SILENTLY when it breaks — you get a panel shouting
 * about a thousand datasets, or one that never mentions the three Google
 * actually published, and nothing errors either way. The measurements behind
 * them are in `gee-watch.js`'s header; these pin the behaviour:
 *
 *   1. the first run baselines and announces nothing (no 133-alert greeting)
 *   2. an object already seen never announces twice (no repeat on reload)
 *   3. a provider catalog, an upload artefact and a bucket object our index
 *      already carries are none of them news
 *   4. "new" is read by EQUALITY against the bake date, so a stale index
 *      cannot promote old datasets as the clock runs
 *
 *   node GeoID_GIS/viewer/gis/gee-watch.test.mjs
 */

import { triageCatalogue, isDatasetObject, describeCheck } from "./gee-watch.js";
import { searchDatasets } from "./gee-catalogue-index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── Rule 3, the narrow form: what even counts as a dataset record ────────────
check("a dataset record counts", isDatasetObject("catalog/AAFC/AAFC_ACI.json"));
check("a provider catalog does not", !isDatasetObject("catalog/AAFC/catalog.json"));
check("the root does not", !isDatasetObject("catalog/catalog.json"));
check("a -gfstmp- upload artefact does not",
  !isDatasetObject("catalog/ASTER/ASTER_AST_L1T_003.json-gfstmp-UCWU7TVQLC"));
check("something outside catalog/ does not", !isDatasetObject("other/thing.json"));
check("a non-json object does not", !isDatasetObject("catalog/AAFC/readme.txt"));

// ── Rule 1: the first run baselines ─────────────────────────────────────────
const indexed = new Set(["catalog/A/A_ONE.json"]);
// Two records our index carries nothing about — exactly the unlinked residue
// that a diff against the index alone would announce.
const listing = [
  "catalog/catalog.json",
  "catalog/A/catalog.json",
  "catalog/A/A_ONE.json",
  "catalog/A/A_OLD_UNLINKED.json",
  "catalog/B/B_ALSO_UNLINKED.json",
  "catalog/B/B_ONE.json-gfstmp-ZZZZ",
];
const first = triageCatalogue(listing, indexed, null);
check("first run reports a baseline", first.baseline === true);
check("first run announces nothing", first.added.length === 0,
  `${first.added.length} announced`);
check("first run counts only real dataset records", first.total === 3,
  `total ${first.total}`);
check("first run says nothing out loud", describeCheck(first, "2026-09-03") === null);

// ── Rule 2: a second run over the SAME listing announces nothing ─────────────
const again = triageCatalogue(listing, indexed, first.seen);
check("an unchanged bucket announces nothing", again.added.length === 0,
  `${again.added.length} announced`);
check("...and is silent in the panel", describeCheck(again, "2026-09-03") === null,
  String(describeCheck(again, "2026-09-03")));

// ── A genuinely new record announces, once ──────────────────────────────────
const grown = listing.concat(["catalog/C/C_BRAND_NEW.json"]);
const third = triageCatalogue(grown, indexed, first.seen);
check("a newly published record announces",
  third.added.length === 1 && third.added[0] === "catalog/C/C_BRAND_NEW.json",
  third.added.join(","));
check("it announces in words",
  /published 1 Earth Engine record/.test(describeCheck(third, "x") || ""),
  String(describeCheck(third, "x")));
// The unlinked residue must never speak on its own: it is the same number every
// session, so a panel that reports it is a panel somebody learns to read past.
check("staleness alone never speaks",
  describeCheck({ baseline: false, added: [], missing: 133 }, "2026-09-03") === null);
const fourth = triageCatalogue(grown, indexed, third.seen);
check("and never announces twice", fourth.added.length === 0,
  `${fourth.added.length} announced`);

// ── Rule 3 again: something the INDEX already carries is not news ───────────
const withIndexed = triageCatalogue(
  listing.concat(["catalog/A/A_TWO.json"]),
  new Set([...indexed, "catalog/A/A_TWO.json"]),
  first.seen,
);
check("a record the index already lists is never announced",
  withIndexed.added.length === 0, withIndexed.added.join(","));

// ── The staleness count is the bucket against the INDEX, not against seen ────
check("staleness counts what the index lacks", again.missing === 2,
  `missing ${again.missing}`);

// ── Rule 4: freshness is equality against the payload's own bake date ────────
const CATALOGUE = fileURLToPath(
  new URL("../../../data/global/gee-catalogue.json", import.meta.url));
const baked = JSON.parse(readFileSync(CATALOGUE, "utf8"));
check("the bake records what it was measured against",
  typeof baked.baked === "string" && "previousBake" in baked && "baseline" in baked,
  JSON.stringify({ baked: baked.baked, previousBake: baked.previousBake }));
check("every entry carries a firstSeen",
  baked.datasets.every((e) => typeof e.firstSeen === "string"),
  `${baked.datasets.filter((e) => !e.firstSeen).length} without one`);
check("no entry claims to have been first seen after this bake",
  baked.datasets.every((e) => e.firstSeen <= baked.baked));
check("an extended entry states a date no later than this bake",
  baked.datasets.every((e) => !e.extended || e.extended <= baked.baked));

// A real bake must not mark most of the catalogue new; that is the shape of
// the fault rule 1 exists to prevent, and it is invisible until somebody opens
// the panel to a thousand badges.
const fresh = baked.datasets.filter((e) => e.firstSeen === baked.baked);
const extended = baked.datasets.filter((e) => e.extended === baked.baked);
check("a non-baseline bake marks a minority new",
  baked.baseline || fresh.length < baked.datasets.length / 4,
  `${fresh.length} of ${baked.datasets.length}`);
check("new and extended are disjoint readings",
  !fresh.some((e) => extended.includes(e)),
  "an entry cannot be both first seen and extended at one bake");

// ── The search's freshOnly narrows to exactly that set ───────────────────────
const all = searchDatasets(baked.datasets, { limit: 5000, drapeableOnly: false });
const only = searchDatasets(baked.datasets, {
  limit: 5000, drapeableOnly: false, freshOnly: true,
});
// The module's own readers key off a catalogue it has loaded; over a bare list
// nothing is fresh, so this pins the SHAPE — freshOnly can only ever narrow.
check("freshOnly never widens the result", only.total <= all.total,
  `${only.total} of ${all.total}`);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
