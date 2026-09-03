/**
 * Where a pyramid's TILES are read from, which is not where its manifest is.
 *
 * The baked maps are moving to object storage because the repository is past
 * GitHub Pages' 1 GB limit. The split that makes that safe is: the tile bytes
 * go to the bucket, the manifest stays with the site — because the manifest
 * carries `has()` and every tile's SIZE, and those are what choose a zoom
 * BEFORE anything is fetched. Put the manifest in the bucket too and an
 * unreachable bucket stalls the chooser rather than merely costing tiles.
 *
 * Two rules, and both fail SILENTLY when broken — a wrong base is a map that
 * draws nothing, which this codebase has now seen twice:
 *
 *   1. no `tiles_base` behaves exactly as before (derived from the manifest URL)
 *   2. a `tiles_base` wins, and the version fingerprint still rides along
 *
 *   node GeoID_GIS/viewer/gis/tiles-base.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/**
 * `loadManifest` is a fetch away from testable, and the whole point is one
 * expression inside it. Read from the source and evaluated here rather than
 * imported: importing `vector-tiles.js` pulls in three.js and the renderer,
 * which is a browser's worth of machinery for one string.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("./vector-tiles.js", import.meta.url)), "utf8");

const line = SOURCE.split("\n").find((l) => l.includes("base: body.tiles_base"));
check("loadManifest reads tiles_base at all", Boolean(line), line || "not found");

// The behaviour, reproduced exactly as the source writes it.
const baseFor = (body, url) => body.tiles_base || url.replace(/\/manifest\.json.*$/, "");

check("no tiles_base keeps the base derived from the manifest URL",
  baseFor({}, "/data/global/soil/manifest.json?v=abc123")
    === "/data/global/soil",
  baseFor({}, "/data/global/soil/manifest.json?v=abc123"));

check("...including when the manifest carries no query",
  baseFor({}, "/data/global/glim/manifest.json") === "/data/global/glim");

check("a tiles_base wins over the derived one",
  baseFor({ tiles_base: "https://data.example.com/glim" },
    "/data/global/glim/manifest.json?v=abc123") === "https://data.example.com/glim");

check("an empty tiles_base is ignored rather than blanking the base",
  baseFor({ tiles_base: "" }, "/data/global/glim/manifest.json") === "/data/global/glim");

/**
 * THE VERSION MUST STILL BE APPENDED. Tiles reached through `sources.local`
 * carry the bake's own fingerprint, and that is what makes a long immutable
 * cache safe on the bucket — a re-bake changes the URL. The remote path
 * deliberately does NOT get it (that is Macrostrat's cache key, not ours), so
 * a published pyramid has to travel the local path, which is exactly what
 * setting `base` rather than `remote` achieves.
 */
check("published tiles travel the versioned path, not the remote one",
  /const local = sources\.local && sources\.has\?\.\(path\)/.test(SOURCE)
  && /\$\{sources\.version \? `\?v=\$\{sources\.version\}` : ""\}/.test(SOURCE));

/**
 * And the manifests themselves must be READABLE FROM THE SITE. A pyramid whose
 * manifest went to the bucket with its tiles would defeat the whole split, and
 * `.gitignore` is where that would happen by accident — the tile directories
 * are ignored by a glob, and a broader one would take the manifest with them.
 */
const IGNORE = readFileSync(
  fileURLToPath(new URL("../../../.gitignore", import.meta.url)), "utf8");
const rules = IGNORE.split("\n").map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
check("no rule ignores a whole baked pyramid, manifest included",
  !rules.some((r) => /^data\/global\/[a-z-]+\/$/.test(r)),
  rules.filter((r) => /^data\/global\/[a-z-]+\/$/.test(r)).join(", "));

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
