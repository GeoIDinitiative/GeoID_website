/**
 * Checks for the gate in front of the data bucket.
 *
 *     node GeoID_GIS/services/data-gate/worker.test.mjs
 *
 * Two things, and the second is the one that will break silently. WHICH PATHS
 * are gated, in both directions -- letting an open file through matters as much
 * as refusing a gated one, because gating somebody else's open data by accident
 * is a licence problem rather than a bug. And that the Worker's list and the
 * app's are THE SAME LIST: neither can import the other (one is a page's
 * module, one is a Worker), and a gate drifting from its enforcement is a gate
 * that has quietly opened.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gatedData, MEMBER_DATA, validPass } from "./worker.js";

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ── 1. The two lists are one list ──────────────────────────────────────────

const app = readFileSync(join(HERE, "../../viewer/gis/membership.js"), "utf8");
const appList = (app.match(/export const MEMBER_DATA = \[([\s\S]*?)\];/) || [])[1] || "";
const appIds = [...appList.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("the app and the gate name the same paths",
  JSON.stringify(appIds) === JSON.stringify(MEMBER_DATA),
  `app ${JSON.stringify(appIds)} vs gate ${JSON.stringify(MEMBER_DATA)}`);

// The predicate is copied too, so it is compared as SOURCE. Both sides strip
// comments first: the prose either side of it names the paths it is about.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const body = (s) => (strip(s).match(/export function gatedData\(path\) \{([\s\S]*?)\n\}/) || [])[1];
check("the predicate is the same on both sides",
  body(app) && body(app).replace(/\s+/g, " ") === body(readFileSync(join(HERE, "worker.js"), "utf8")).replace(/\s+/g, " "),
  "they have drifted");

// ── 2. What is gated, and what must not be ─────────────────────────────────

for (const path of [
  "cyclone-risk.geojson",
  "/cyclone-risk.geojson",
  "data/global/cyclone-risk.geojson",
  "cyclone-risk-years.json",
  "cyclone-risk-cumulative.hotlink-ok.tif",
  "seismic-risk/vei3.geojson",
  "volcanic-risk.geojson",
  "volcanic-risk-holocene.geojson",
  "volcanic-risk/any.geojson",
]) check(`gated: ${path}`, gatedData(path) === true);

// Every one of these is somebody else's open data that we redistribute, or the
// terrain, or a survey. Gating one by accident is a licence problem.
for (const path of [
  "soil/manifest.json", "glim/3/4/5.mvt", "ice/names.json",
  "earthquakes.geojson", "cyclone-tracks.geojson", "volcanoes.geojson",
  "soil_thickness_1km.hotlink-ok.tif", "worldpop.hotlink-ok.tif",
  "climate-normals.json", "coastline_10m.geojson", "sources.json",
  "hydrolakes/2/1/1.mvt", "grwl/manifest.json",
]) check(`open: ${path}`, gatedData(path) === false);

// The catalogues the risk maps are BUILT from stay open, which is the whole
// distinction: the record of what happened is a fact, the model of what may
// happen is the work.
check("the cyclone TRACK record is open", gatedData("cyclone-tracks.geojson") === false);
check("the earthquake record is open", gatedData("earthquakes.geojson") === false);

// ── 3. A pass is only a pass for this ──────────────────────────────────────

const SECRET = "a-long-random-string";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body_ = b64(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body_}`));
  return `${head}.${body_}.${Buffer.from(mac).toString("base64url")}`;
}
const now = () => Math.floor(Date.now() / 1000);

check("a data pass is accepted",
  !!(await validPass(await sign({ aud: "data", exp: now() + 900 }), SECRET)));
// The week-long session token must not stand in for the fifteen-minute pass:
// this one travels in a query string and is logged.
check("a session token is NOT a pass",
  (await validPass(await sign({ aud: "site", exp: now() + 900 }), SECRET)) === null);
check("a pass with no audience is refused",
  (await validPass(await sign({ exp: now() + 900 }), SECRET)) === null);
check("an expired pass is refused",
  (await validPass(await sign({ aud: "data", exp: now() - 1 }), SECRET)) === null);
check("a pass with no expiry is refused",
  (await validPass(await sign({ aud: "data" }), SECRET)) === null);
check("a pass signed with another key is refused",
  (await validPass(await sign({ aud: "data", exp: now() + 900 }), "other")) === null);
check("a malformed pass is refused rather than thrown",
  (await validPass("not.a.pass", SECRET)) === null);

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
