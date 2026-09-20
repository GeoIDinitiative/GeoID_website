// Fast launch: one root service worker whose caches survive, and a start-up
// screen that waits for what the page opens with. Run: node launch-cache.test.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf-8");
let pass = 0; const failures = [];
const ok = (cond, name) => { if (cond) pass += 1; else failures.push(name); };
process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  launch-cache.test.mjs  —  ${pass} passed`);
});

// ---- one worker at root ----------------------------------------------------
const nav = read("styles", "nav.js");
ok(/register\('\/sw\.js', \{ scope: '\/' \}\)/.test(nav), "the site nav registers /sw.js at root");
for (const viewer of [["GeoID_GIS", "viewer", "earth-viewer.js"], ["GeoID_Earth", "viewer", "earth-viewer.js"]]) {
  const text = read(...viewer);
  ok(/register\("\/sw\.js", \{ scope: "\/" \}\)/.test(text) && !/new URL\("\.\.\/\.\.\/sw-ctx-tiles\.js"/.test(text),
    `${viewer[0]} registers the SAME root worker, not a second one`);
}
ok(/^\s*importScripts\('\/sw\.js'\);/m.test(read("sw-ctx-tiles.js")), "the old root worker URL is only a shim onto /sw.js");

// ---- the worker deletes only what it owns -----------------------------------
const sw = read("sw.js");
ok(/!OWNED\.includes\(k\) && \(\s*FAMILIES\.some/.test(sw), "activate deletes only old versions of its own families");
ok(!/k\.startsWith\('geoid-'\)/.test(sw), "no blanket geoid-* deletion (Cache Storage is origin-wide)");
ok(!/geoid-mosaic/.test(sw.replace(/\/\/.*$/gm, "")), "the page's own mosaic cache is never named by the worker");
for (const f of [["planet_explorer", "sw-ctx-tiles.js"], ["flight_sim", "sw-ctx-tiles.js"]]) {
  const text = read(...f);
  ok(!/startsWith\('geoid-'\)/.test(text), `${f[0]}'s worker no longer deletes every geoid-* cache`);
  ok(/geoid-(planets|flight)-ctx-tiles-/.test(text), `${f[0]}'s worker has a cache family of its own`);
}
ok(/host === 'data\.geoidinitiative\.com'/.test(sw) && /searchParams\.has\('v'\)/.test(sw), "fingerprinted bucket data is cache-first");
ok(/tiles\.maps\.eox\.at/.test(sw), "the Sentinel-2 tiles are cached");
ok(/raw\.githubusercontent\.com/.test(sw) && /staleWhileRevalidate\(REMOTE_CACHE/.test(sw), "the plate boundaries are shown from cache and refreshed behind");
ok(/request\.headers\.has\('range'\)/.test(sw), "a byte-range request is never cached");
ok(/const STAMP = /.test(sw) && /isCode && !LOCAL && STAMP\.test/.test(sw), "stamped code is cache-first (off on localhost)");
const STAMP = /(^|[?&])v=(gis-)?\d{8}-[0-9a-f]{7}(&|$)/;
ok(STAMP.test("?v=20260919-b978060") && !STAMP.test("?v=1773813890"), "the stamp test takes stamp.py's form and not an epoch stamp");

// ---- the start-up screen waits ---------------------------------------------
const shell = read("index.html");
ok(/launch\.pending && launch\.pending\.size\) return false/.test(shell), "the start-up screen waits for launch holds");
const drape = read("GeoID_GIS", "viewer", "gis", "basemap-drape.js");
ok(/holdLaunch\("basemap"/.test(drape) && /readMosaic\(sourceName\)/.test(drape) && /saveMosaic\(sourceName/.test(drape),
  "the opening mosaic is held for and cached whole");
ok(/result\.drawn >= result\.tiles \* 0\.97/.test(drape), "only a whole mosaic is kept");
ok(/holdLaunch\("launch-defaults"/.test(read("GeoID_GIS", "viewer", "gis", "catalogue-panels.js")), "the launch defaults are held for");
ok(/holdLaunch\("places"/.test(read("GeoID_GIS", "viewer", "gis", "earth-places.js")), "the place names are held for");
ok(/holdLaunch\("events"/.test(read("GeoID_GIS", "viewer", "gis", "events.js")), "the first round of live feeds is held for");
const data = read("GeoID_GIS", "viewer", "gis", "global-data.js");
ok(/Promise\.all\(launchDatasets\(\)\.map/.test(data), "launch defaults load in parallel");
const borders = data.slice(data.indexOf('id: "boundaries-10m"'), data.indexOf('id: "countries-50m"'));
/**
 * ON AT LAUNCH, WHITE, AND FAINT. The strength is the part that moved: full
 * white on every border ruled a political map over the physical one it is
 * there to locate. What the pin holds is that all three are stated -- a
 * border left to the renderer takes `lineColor`, the app's own data cyan, and
 * reads as a measured layer.
 */
ok(/defaultOn: true/.test(borders), "country borders are on at launch");
ok(/colour: "#ffffff"/.test(borders), "and white, not the renderer's data cyan");
ok(/opacity: 0\.3\b/.test(borders), "and faint enough to locate rather than rule");

// ---- the registry itself -----------------------------------------------------
globalThis.window = {};
const { holdLaunch, launchPending } = await import("./launch-ready.js");
const a = holdLaunch("a", 50); const b = holdLaunch("b", 50);
ok(launchPending().length === 2, "two holds are pending");
a(); a();
ok(launchPending().length === 1, "a release is idempotent");
await new Promise((r) => setTimeout(r, 80));
ok(launchPending().length === 0, "a hold nobody releases times out by itself");
b();
