/**
 * RESET WORKSPACE: what goes, what stays, and that the nav bar follows.
 *
 * The reset is mostly the page's own seams, so the checks are of two kinds:
 * the pure decisions (which layers are removed, which feed ticks change) run
 * against known answers, and the wiring is pinned on the source -- the launch
 * defaults must come back through the launch's OWN loader, never a second copy
 * of what "default" means, and the button must ask before it acts.
 *
 * Run: node GeoID_GIS/viewer/gis/workspace-reset.test.mjs
 */
import { readFileSync } from "node:fs";
import { partitionForReset, sourceChanges, EVENTS_LAYER_NAME } from "./workspace-reset.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};
process.on("exit", () => {
  console.log(`${pass} passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exitCode = 1; }
});

// --- which layers go ---
const layers = [
  { id: 1, name: "Plate boundaries (Bird 2003)" },
  { id: 2, name: EVENTS_LAYER_NAME, adopted: true },
  { id: 3, name: "my-survey.shp" },
  { id: 4, name: "Earthquakes plotted — by year" },
  { id: 5, name: "Study area 1", ext: "drawn" },
  { id: 6, name: "Satellites", adopted: true },
];
const plan = partitionForReset(layers);
ok("the live events feed stays", plan.keep.map((l) => l.id).join() === "2");
ok("everything else goes — defaults too, to come back as they launched",
  plan.remove.map((l) => l.id).join() === "1,3,4,5,6", plan.remove.map((l) => l.id).join());
ok("an adopted layer that is not the feed is removed", plan.remove.some((l) => l.id === 6));
ok("a name alone is not the feed: it has to be the ADOPTED row",
  partitionForReset([{ id: 9, name: EVENTS_LAYER_NAME }]).remove.length === 1);
ok("nothing to reset is nothing removed", partitionForReset([]).remove.length === 0);

// --- the feed's ticks ---
const on = new Set(["a", "c"]);
const changes = sourceChanges(["a", "b"], (id) => on.has(id), ["a", "b", "c", "d"]);
ok("a default that was switched off comes back on, a non-default goes off",
  JSON.stringify(changes) === JSON.stringify([{ id: "b", on: true }, { id: "c", on: false }]),
  JSON.stringify(changes));
ok("a feed already as it launched is left alone",
  sourceChanges(["a"], (id) => id === "a", ["a", "b"]).length === 0);

// --- the wiring ---
const src = readFileSync(new URL("./workspace-reset.js", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
ok("the defaults return through the launch's own loader",
  /loadLaunchDefaults\(offered\)/.test(src));
ok("after forgetting any untick of them, so the reset is the launch and not the last session",
  /defaultOn\)\.forEach\(\(entry\) => data\.noteDatasetChoice\(entry\.id, true\)\)/.test(src));
ok("a sequence is stopped before anything is removed",
  src.indexOf("stopPlayer(") > 0 && src.indexOf("stopPlayer(") < src.indexOf("removeLayer"));
ok("removing a layer is what unticks the nav bar: no tick is set by hand for a catalogue row",
  !/gis-cat-/.test(src));

const addData = readFileSync(new URL("./add-data.js", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const btn = addData.slice(addData.indexOf("function resetButton"), addData.indexOf("function addButtonFor"));
ok("the Workspace header carries the reset door", /row\.appendChild\(resetButton\(\)\)/.test(addData));
ok("it wears an icon like its neighbours", /Reset: '<path/.test(addData));
ok("the first press only arms it, as the layer drawer's Remove → Sure? does",
  /if \(!armedAt\) \{[\s\S]*?"Reset\?"[\s\S]*?return;/.test(btn));
ok("and it stands down on its own", /setTimeout\(standDown, 4000\)/.test(btn));
