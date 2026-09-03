/**
 * Where a shipped data file is read from, and the two ways that fails silently.
 *
 * A wrong answer here is not an error: the layer either fetches from the site
 * when it should not (harmless, invisible) or fetches a URL that 404s (a
 * catalogue tick that does nothing). Both look like "the dataset is broken".
 *
 *   node GeoID_GIS/viewer/gis/data-base.test.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataUrl, resetForTests } from "./data-base.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const TABLE = {
  base: "https://data.example.com",
  files: { "volcanoes.geojson": "abc123", "ice/names.json": "def456" },
};

resetForTests(TABLE);
check("a published file resolves to the bucket, with its fingerprint",
  await dataUrl("/data/global/volcanoes.geojson")
    === "https://data.example.com/volcanoes.geojson?v=abc123",
  await dataUrl("/data/global/volcanoes.geojson"));

check("the bucket root mirrors data/global, so a pyramid sidecar works too",
  await dataUrl("/data/global/ice/names.json")
    === "https://data.example.com/ice/names.json?v=def456");

check("a file the table does not name stays LOCAL",
  await dataUrl("/data/global/rivers_10m.geojson") === "/data/global/rivers_10m.geojson",
  "a file added since the last publish must still be found");

check("an absolute URL to someone else's service is untouched",
  await dataUrl("https://macrostrat.org/x.json") === "https://macrostrat.org/x.json");

resetForTests({});
check("no sources.json at all keeps every path local",
  await dataUrl("/data/global/volcanoes.geojson") === "/data/global/volcanoes.geojson");

resetForTests({ files: { "volcanoes.geojson": "abc123" } });
check("a table with no base keeps paths local",
  await dataUrl("/data/global/volcanoes.geojson") === "/data/global/volcanoes.geojson");

resetForTests({ base: "https://data.example.com/", files: { "a.json": "z" } });
check("a trailing slash on the base does not double up",
  await dataUrl("/data/global/a.json") === "https://data.example.com/a.json?v=z",
  await dataUrl("/data/global/a.json"));

/**
 * THE FINGERPRINT IS WHAT MAKES THE IMMUTABLE CACHE SAFE, so the publisher must
 * write one for every file it uploads. Checked on the source rather than by
 * running rclone.
 */
const PUB = readFileSync(
  fileURLToPath(new URL("../../services/publish-data.py", import.meta.url)), "utf8");
check("the publisher fingerprints every file it lists",
  /def fingerprint/.test(PUB) && /files\[p\.name\] = fingerprint\(p\)/.test(PUB));
check("sources.json is never itself uploaded",
  /KEEP_LOCAL = \([^)]*"sources\.json"/s.test(PUB));

/**
 * THE INVARIANT THAT WILL BREAK SILENTLY LATER: any file `.gitignore` holds out
 * of `data/global/` is not on the site, so every module that names one must
 * reach it through `dataUrl`. Add a shipped file, publish it, forget to wire
 * it, and the fetch 404s in production only — the file is still on the
 * developer's disk and the dev server serves it happily.
 *
 * Checked on the SOURCE: any module naming a published file must import
 * `dataUrl`. The metadata that deliberately stays local (manifests, units,
 * classes, sources.json) is exempt because it is still shipped.
 */
const GIS = fileURLToPath(new URL(".", import.meta.url));
const SOURCES_JSON = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../data/global/sources.json", import.meta.url)), "utf8"));
const published = Object.keys(SOURCES_JSON.files || {});

let unwired = [];
for (const file of readdirSync(GIS).filter((f) => f.endsWith(".js"))) {
  // COMMENTS STRIPPED FIRST — this module's own header names an example path,
  // and prose is not a fetch. The same reason tool-runner's param scanner and
  // the shelf-name test strip them.
  const text = readFileSync(GIS + file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const names = published.filter((rel) => text.includes(`/data/global/${rel}`));
  if (names.length && !/from "\.\/data-base\.js/.test(text)) {
    unwired.push(`${file} names ${names[0]} but does not import dataUrl`);
  }
}
check("every module naming a PUBLISHED file resolves it through dataUrl",
  unwired.length === 0, unwired.join("; "));

check("sources.json itself is never published (it names the others)",
  !published.includes("sources.json"));

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
