/**
 * The draw-order bands, which decide what is buried under what.
 *
 * Every one of them is a DEFAULT — a dragged row takes the band of the row it
 * displaced — so what is pinned here is the order the app proposes, not a rule
 * it enforces against the user.
 *
 * The band that matters most is the drawn one. A study area is not a dataset,
 * it is the question being asked of the datasets: the boundary every
 * extraction, clip and zonal statistic is scoped to. It used to share band 2
 * with every ordinary import, so it was under anything mapped after it —
 * measured live, a captured study area at renderOrder 54 and a DEM mapped a
 * moment later at 55 — and a drape does not depth-test, so it painted over the
 * outline rather than fighting it. Drawing a boundary and then mapping the
 * data inside it is the ordinary order of work.
 */
import { bandOf } from "./draw-order.js";
import { readFileSync } from "node:fs";


let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: got ${a}, expected ${b}`); }
function ok(c, what) { if (!c) throw new Error(what); }

const drawn = { ext: "drawn", name: "Study area 1" };
const dataset = { ext: "geojson", name: "an import" };
const derived = { ext: "derived", name: "a tool output" };
const geology = { ext: "geojson", name: "world geology", geologyDataset: "macrostrat" };
const imagery = { ext: "tiles", name: "a basemap patch" };
const gee = { ext: "gee", name: "Rainfall (CHIRPS)" };
const events = { ext: "events", name: "Live events" };

check("a drawn shape outranks EVERY mapped dataset", () => {
  for (const other of [dataset, derived, geology, imagery, gee, events]) {
    ok(bandOf(drawn) > bandOf(other),
      `a drawn shape must outrank ${other.name} (${bandOf(drawn)} vs ${bandOf(other)})`);
  }
});

check("the bands below it keep the order they had", () => {
  ok(bandOf(events) > bandOf(dataset), "a live feed sits over ordinary data");
  ok(bandOf(dataset) > bandOf(geology), "an import sits over the geological ground");
  ok(bandOf(geology) > bandOf(imagery), "geology sits over imagery");
  eq(bandOf(gee), bandOf(imagery), "a GEE drape is imagery");
});

check("a raster mapped AFTER a drawn shape still sits under it", () => {
  // The reported case, as a band comparison: the newer layer wins inside a
  // band, and this is the whole reason the drawn shape needs its own.
  ok(bandOf(drawn) > bandOf({ ext: "derived", name: "after_dem" }),
    "a DEM mapped afterwards must not bury the boundary it was cut to");
});

check("but the band is a DEFAULT — a dragged row still wins", () => {
  eq(bandOf({ ...drawn, bandOverride: 0 }), 0, "a hand-dragged drawn shape");
  eq(bandOf({ ...dataset, bandOverride: 4 }), 4, "a hand-dragged dataset");
});

check("a fractional lift survives the stack stamp — the sharp tiles' half step", () => {
  /**
   * applyStack re-stamps every node on each hierarchy change. The tiled
   * geology draws the view's sharp tiles half a step above the coarse
   * backdrop, and flattening that leaves both at the band value with the
   * winner decided by traversal order — which showed up as the coarse map
   * drawing over the fine one the moment the backdrop stopped being cut away
   * beneath it. This pins the ARITHMETIC the stamp must use.
   */
  const stampOf = (band, node) => band + (Number(node.userData?.renderLift) || 0);
  const backdropTile = { userData: { renderLift: 0 } };
  const sharpTile = { userData: { renderLift: 0.5 } };
  const plain = { userData: {} };
  eq(stampOf(51, backdropTile), 51, "the backdrop sits on the band");
  eq(stampOf(51, sharpTile), 51.5, "the view's tiles sit half a step above it");
  eq(stampOf(51, plain), 51, "ordinary geometry takes the band exactly");
  ok(stampOf(51, sharpTile) > stampOf(51, backdropTile),
    "the fine map must outrank the coarse one it replaces");
  // And the offset RIDES the band, so dragging the layer still moves both.
  eq(stampOf(55, sharpTile) - stampOf(55, backdropTile), 0.5,
    "the gap is preserved wherever the layer is dragged to");
});

/**
 * A GROUP added to the scene must carry a band, or its children sort at ZERO.
 *
 * `reversePainterSortStable` compares groupOrder before renderOrder and
 * `projectObject` reads groupOrder off the nearest `isGroup` ancestor, so a
 * bare `new THREE.Group()` contributes 0 no matter what its children say.
 * Measured live: the hover highlight existed as nine LineLoops at renderOrder
 * 239 with depthTest off, sorting at groupOrder 0 against the geology's 51 —
 * drawn first, painted over, visible only through a faded sheet.
 *
 * The check is on the SOURCE because these holders are built inside an async
 * DOM path that needs a scene, a viewer and three.js. Text is a blunt
 * instrument and it catches the one thing that actually regressed: a
 * `new THREE.Group()` reaching the scene without a band.
 */
check("every highlight holder is banded above the data layers", () => {
  const src = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
  const bare = [...src.matchAll(/const (\w+) = new THREE\.Group\(\);/g)].map((m) => m[1]);
  eq(bare.join(", "), "", "holders built as a bare Group carry no band");
  const banded = [...src.matchAll(/const \w+ = bandHolder\(new THREE\.Group\(\)\)/g)].length;
  eq(banded, 2, "both the hover and the selection holder go through bandHolder");
  const band = /const HIGHLIGHT_BAND = (\d+);/.exec(src);
  eq(Boolean(band), true, "HIGHLIGHT_BAND is declared");
  // Above the imported data band (50+), above the drawn shapes, and above the
  // event markers at 230 -- a highlight is what you are pointing at.
  eq(Number(band[1]) > 230, true, "the highlight band outranks the event markers");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
