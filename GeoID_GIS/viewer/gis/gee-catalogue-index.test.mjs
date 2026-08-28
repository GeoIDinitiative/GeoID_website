/**
 * The catalogue search, pinned against the REAL baked index.
 *
 * The ordering rules are the whole value of this module — a search over 1,139
 * datasets that puts one Landsat scene above the Landsat collection is a
 * search nobody can use — and every one of them fails silently.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  searchDatasets, isDrapeable, describeDataset,
} from "./gee-catalogue-index.js";

const path = fileURLToPath(new URL("../../../data/global/gee-catalogue.json", import.meta.url));
const catalogue = JSON.parse(readFileSync(path, "utf8"));
const all = catalogue.datasets;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (ok, detail) => { if (!ok) throw new Error(detail || "assertion failed"); };

test("the baked index holds the whole catalogue", () => {
  assert(all.length > 1000, `only ${all.length} datasets`);
  assert(catalogue.baked && /^\d{4}-\d{2}-\d{2}$/.test(catalogue.baked), "no bake date");
});

test("a collection outranks one of its own scenes", () => {
  const { results } = searchDatasets(all, { query: "landsat 8" });
  const collection = results.findIndex((e) => e.id === "LANDSAT/LC08/C02/T1_L2");
  const scene = results.findIndex((e) => /LC08_\d{6}_\d{8}$/.test(e.id));
  assert(collection >= 0, "the Landsat 8 collection is not in the results");
  assert(scene === -1 || collection < scene,
    `scene at ${scene} outranked the collection at ${collection}`);
});

test("every word has to match, not just one", () => {
  const { results } = searchDatasets(all, { query: "soil moisture" });
  assert(results.length > 0, "no soil moisture datasets");
  assert(results.every((e) => e._hay.includes("soil") && e._hay.includes("moisture")),
    "a result matched only one of the two words");
});

test("keywords are searched, not only titles", () => {
  // CHIRPS is titled "CHIRPS Precipitation Daily…" and never says "rainfall";
  // its keywords do. A title-only search is why it could not be found.
  const { results } = searchDatasets(all, { query: "precipitation", limit: 400 });
  assert(results.some((e) => e.id === "UCSB-CHG/CHIRPS/DAILY"), "CHIRPS not found");
});

test("deprecated datasets are excluded but COUNTED", () => {
  const out = searchDatasets(all, { query: "landsat", limit: 500 });
  assert(out.deprecated > 0, "no deprecated datasets were reported");
  assert(out.results.every((e) => e.status !== "deprecated"), "a deprecated one got through");
  const inc = searchDatasets(all, { query: "landsat", includeDeprecated: true, limit: 500 });
  assert(inc.total > out.total, "including them did not widen the results");
});

test("tables are excluded from a drapeable search and counted", () => {
  const out = searchDatasets(all, { query: "tiger", limit: 200 });
  assert(out.undrapeable > 0, "no undrapeable datasets were reported");
  assert(out.results.every(isDrapeable), "something undrapeable got through");
});

test("a category narrows to that subject", () => {
  const out = searchDatasets(all, { category: "fire", limit: 500 });
  assert(out.total > 10, `only ${out.total} fire datasets`);
  assert(out.results.every((e) => e.cats.includes("fire")), "a non-fire dataset got through");
});

test("every drapeable dataset carries what the service needs to render it", () => {
  const drapeable = all.filter(isDrapeable);
  assert(drapeable.length > 900, `only ${drapeable.length} drapeable`);
  // Land cover has no stretch and IS renderable, from its own class table.
  const worldcover = all.find((e) => e.id === "ESA/WorldCover/v200");
  assert(isDrapeable(worldcover), "ESA WorldCover was excluded");
  assert(worldcover.vis.classes.length > 5, "WorldCover kept no class table");
  const broken = drapeable.filter((e) => !e.vis.bands.length
    || (!e.vis.classes?.length
      && (e.vis.min === undefined || e.vis.max === undefined)));
  assert(!broken.length,
    `${broken.length} with nothing to render them with, e.g. ${broken[0]?.id}`);
});

test("the one-line description says kind, resolution and years", () => {
  const chirps = all.find((e) => e.id === "UCSB-CHG/CHIRPS/DAILY");
  const line = describeDataset(chirps);
  assert(line.startsWith("Image collection"), line);
  assert(line.includes("1981"), line);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓  ${name}`); }
  catch (error) { failed += 1; console.log(`✗  ${name} — ${error.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
