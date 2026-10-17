/**
 * The ledger's page half: what it listens for, where it asks, and that the
 * assistant reaches it through the one tool registry.
 *
 *   node GeoID_GIS/viewer/gis/atlas-ledger-page.test.mjs
 */

import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
function ok(cond, msg) { if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}`); } }
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const here = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const pageSrc = strip(here("./atlas-ledger-page.js"));
const panel = strip(here("./total-risk-panel.js"));
const assistant = strip(here("./atlas-assistant.js"));
const html = here("../index.html");

ok(/dispatchEvent\(new CustomEvent\("geoid-gis:total-risk-computed", \{ detail: \{ terms, place, nowMs, horizon \} \}\)\)/.test(panel),
  "the total-risk card announces each computation with its terms and place");
ok(/addEventListener\("geoid-gis:total-risk-computed"/.test(pageSrc), "the ledger records what the card announces");
ok(/archive-api\.open-meteo\.com\/v1\/archive/.test(pageSrc) && /api\.open-meteo\.com\/v1\/forecast/.test(pageSrc),
  "weather: the archive once it covers the window, the model analysis before");
ok(/ARCHIVE_LAG = 6 \* DAY/.test(pageSrc), "the archive is trusted six days after the window");
ok(/eonet\.gsfc\.nasa\.gov\/api\/v3\/events\?status=all/.test(pageSrc) && /bbox=/.test(pageSrc),
  "events: EONET over each place's own box and window");
ok(/earthquake\.usgs\.gov\/fdsnws\/event\/1\/query\?format=geojson&minmagnitude=5/.test(pageSrc), "aftershocks: the USGS catalogue, M ≥ 5");
ok(/byPlace\(due\.filter\(\(r\) => VERIFY\[r\.key\]\.kind === "weather"\), archivable\)/.test(pageSrc),
  "archived and recent records are asked separately, so an old one is never read provisionally");
ok(/capeOnly/.test(pageSrc), "CAPE is read from the model analysis whatever the age (ERA5 lacks it)");
ok(/import\("\.\/extraction\.js\?v=[^"]+"\)/.test(pageSrc) && /downloadText\(/.test(pageSrc),
  "the CSV goes through the app's one download path");
ok(/metadata\/atlas_ledger\.json/.test(pageSrc), "an open project keeps a copy of the ledger");
ok(/window\.GeoIDAtlasLedger = \{ record, verify, report, stats, exportCsv, clear/.test(pageSrc), "the seam the runner reads");
ok(/runTool\("verification"/.test(assistant), "a verification question reaches the registry's own tool");
ok(/gis\/atlas-ledger-page\.js\?v=/.test(html) && html.indexOf("gis/atlas-ledger-page.js") > html.indexOf("gis/total-risk-panel.js"),
  "loaded on Earth's page after the total-risk card");
ok(!/fetch\([^)]*key=/i.test(pageSrc), "no key of ours in any request");
