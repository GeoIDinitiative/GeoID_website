// The Earth gazetteer: the module's pure half, the baked file's shape, and the
// viewer seams that make thousands of names affordable. Run: node earth-places.test.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let pass = 0; const failures = [];
const ok = (cond, name) => { if (cond) pass += 1; else failures.push(name); };
process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  earth-places.test.mjs  —  ${pass} passed`);
});

const { isCuratedDuplicate, toItem, readOn } = await import("./earth-places.js");

// ---- curated duplicates ---------------------------------------------------
const curated = [
  { name: "Himalaya", lat: 28, lon: 86 },
  { name: "Atlantic Ocean", lat: 5, lon: 330 },
  { name: "Sierra Nevada", lat: 37.7, lon: 240.4 },
];
ok(isCuratedDuplicate({ name: "Himalayas", lat: 28.5, lon: 85, lod: 1 }, curated), "Himalayas meets the curated Himalaya");
ok(isCuratedDuplicate({ name: "Atlantic Ocean", lat: 34, lon: 331, lod: 1 }, curated),
  "a tier-1 ocean is one feature however far apart the anchors sit");
ok(!isCuratedDuplicate({ name: "Sierra Nevada", lat: 37.3, lon: 356.7, lod: 4 }, curated),
  "the Spanish Sierra Nevada is not California's");
ok(!isCuratedDuplicate({ name: "Mekong", lat: 15, lon: 105, lod: 2 }, curated), "an unrelated name is kept");
ok(isCuratedDuplicate({ name: "Himalayas", lat: 28, lon: 446 - 360, lod: 3 }, curated), "longitudes compare modulo 360");

// ---- baked row → label item ----------------------------------------------
let rankedWith = null;
const item = toItem({ name: "Matterhorn", type: "Mountain summit", lat: 45.9, lon: 7.7, lod: 4,
  category: "mountain", description: "d", source: "s", elevation_m: 4478 },
(it, lod, cat) => { rankedWith = [lod, cat]; return it; });
ok(item.place && item.lazy_label, "a gazetteer item is a place with a lazy chip");
ok(rankedWith && rankedWith[0] === 4 && rankedWith[1] === "place-mountain", "the viewer's rankPlace is handed the tier and category");
ok(item.elevation_m === 4478 && item.label_backing === 2, "height rides on the item; the chip backs at 2x");

// ---- stored exceptions ----------------------------------------------------
globalThis.localStorage = { getItem: () => { throw new Error("private window"); } };
ok(readOn().size === 0, "a storage that throws means nothing is switched on: the names open off");
globalThis.localStorage = { getItem: () => JSON.stringify(["place-city", 3]) };
ok(readOn().has("place-city") && readOn().size === 1, "the on-list keeps strings only");
delete globalThis.localStorage;

// ---- the baked file, where it is on disk ----------------------------------
const baked = join(ROOT, "data", "global", "earth-places.json");
if (existsSync(baked)) {
  const doc = JSON.parse(readFileSync(baked, "utf-8"));
  const P = doc.places || [];
  const CATS = new Set(["marine", "landform", "island", "mountain", "river", "lake", "tectonic", "city", "volcano"]);
  ok(P.length >= 10000 && P.length <= 16000, `10,000–16,000 places (${P.length})`);
  // Wikidata's summit heights come NORMALISED to metres (psn:): read as
  // typed, a 13,000 ft hill was an 8,000 m tier-2 peak.
  ok(P.filter((p) => p.category === "mountain" && p.lod <= 2).length < 120, "the top mountain tiers are the great peaks and ranges, not feet read as metres");
  ok(P.filter((p) => p.name === "Greenland").length === 1, "one Greenland: an island's two catalogues meet however far apart they anchor it");
  ok(P.some((p) => p.category === "volcano" && /Smithsonian/.test(p.source)), "the Smithsonian volcanoes are ranked among the names");
  ok(P.every((p) => CATS.has(p.category)), "every place is in a known category");
  ok(P.every((p) => p.lod >= 1 && p.lod <= 5), "every place carries a tier 1–5");
  ok(P.every((p) => p.lat >= -90 && p.lat <= 90 && p.lon >= 0 && p.lon < 360), "coordinates are lat and east 0–360");
  ok(P.every((p) => typeof p.description === "string" && p.description.length > 10), "every place has a description");
  ok(P.every((p) => p.source), "every place names its source");
  const tiers = [1, 2, 3, 4, 5].map((k) => P.filter((p) => p.lod === k).length);
  ok(tiers[0] < tiers[2] && tiers[2] < tiers[3], "the tiers widen downward (few landmarks, many details)");
  const byQid = new Map();
  for (const p of P) if (p.wikidata) byQid.set(p.wikidata, (byQid.get(p.wikidata) || 0) + 1);
  ok([...byQid.values()].every((n) => n === 1), "one label per Wikidata item");
  const everest = P.find((p) => /everest/i.test(p.name));
  ok(!everest || everest.lod <= 2, "an 8,000er outranks its label zoom");
} else {
  console.log("   (data/global/earth-places.json not on disk — bake-earth-places.py; file checks skipped)");
}

// ---- the viewer seams -----------------------------------------------------
const viewer = readFileSync(join(HERE, "..", "earth-viewer.js"), "utf-8");
ok(/function settleLazyLabels\(entries\)/.test(viewer) && /settleLazyLabels\(entries\);/.test(viewer),
  "lazy chips are drawn when placed, not when built");
ok(/map: lazy \? getLazyLabelPlaceholder\(\) : label\.texture/.test(viewer), "a lazy entry starts on the shared placeholder");
ok(/entry\.item\.lod <= currentLodLevel \+ zoomLodBonus/.test(viewer), "the density rule is Mars's lod <= level, plus the zoom's tiers");
ok(/c\.entry\.item\?\.lod == null && \(c\.entry\.priority/.test(viewer), "the old priority filter leaves ranked places alone");
ok(/!candidate\.entry\.item\?\.place/.test(viewer), "a gazetteer name is never forced onto the screen");
ok(/PLACE_MOSAIC_TIER\[entry\.item\.lod\]/.test(viewer), "the close layout restates the tier it would otherwise cancel");
ok(/setPlaceCategoryFilter\(fn\)/.test(viewer) && /placeCategoryEnabled\(entry\.category\)/.test(viewer),
  "the Locations rows gate their categories through the seam");
const html = readFileSync(join(HERE, "..", "index.html"), "utf-8");
ok(/id="place-category-rows"/.test(html) && /gis\/earth-places\.js/.test(html), "the Earth page hosts the rows and loads the module");
for (const id of ["volcanic-labels-toggle", "landing-labels-toggle", "habitation-labels-toggle", "labels-toggle"]) {
  ok(new RegExp(`id="${id}" type="checkbox">`).test(html), `${id} is OFF at launch on Earth`);
}
ok(/id="moon-toggle" type="checkbox" checked/.test(html), "the Moons row (the Moon itself, not a label) stays on");
{
}
const data = readFileSync(join(HERE, "global-data.js"), "utf-8");
const rivers = data.slice(data.indexOf('id: "rivers-10m"'), data.indexOf('id: "marine-areas"'));
ok(/defaultOn: true/.test(rivers), "the global rivers are drawn at launch");
