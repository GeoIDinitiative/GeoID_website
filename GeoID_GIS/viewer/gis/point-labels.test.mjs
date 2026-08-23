/**
 * Which points get a name — the whole behaviour of a label layer.
 *
 * The rendering can be looked at; the CHOOSING cannot. Rank ordering and
 * spacing are both easy to get subtly wrong in a way that shows only as
 * "the labels look messy", and both are pure, so both are pinned here.
 */

import { chooseLabels } from "./point-labels.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
}
function eq(a, b, what = "") {
  if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const at = (name, rank, x, y, fromCentre = 0) =>
  ({ name, rank, x, y, fromCentre, visible: true, index: name });

check("rank decides, not order of arrival", () => {
  // Far apart, so spacing never enters into it.
  const kept = chooseLabels([
    at("undated", 1, 0, 0), at("erupting", 5, 500, 0), at("historical", 3, 1000, 0),
  ], { max: 3, claim: 40 });
  eq(kept.map((k) => k.name).join(","), "erupting,historical,undated");
});

check("a rank of zero is never labelled, however much room there is", () => {
  // Pleistocene volcanoes: 1,452 of them, and no eruption anybody recorded.
  eq(chooseLabels([at("pleistocene", 0, 0, 0)], { max: 10 }).length, 0);
});

check("an off-screen candidate is not a candidate", () => {
  eq(chooseLabels([{ ...at("behind", 5, 0, 0), visible: false }], { max: 10 }).length, 0);
});

check("SPACING: a lower rank loses the ground a higher one has taken", () => {
  const kept = chooseLabels([
    at("big", 5, 100, 100),
    at("small", 4, 110, 100),      // 10 px away — inside the claim
    at("far", 4, 400, 100),        // clear of it
  ], { max: 10, claim: 46 });
  eq(kept.map((k) => k.name).join(","), "big,far", "the crowded one is dropped");
});

check("spacing is a radius, so the clash test is not axis-aligned", () => {
  // 40 px diagonally is 28.3 in x and in y: an axis-by-axis test would let
  // this through and the two labels would overlap on screen.
  const kept = chooseLabels([
    at("a", 5, 0, 0), at("b", 4, 28.3, 28.3),
  ], { max: 10, claim: 46 });
  eq(kept.length, 1, "the diagonal neighbour is still a clash");
});

check("of two equal ranks, the one nearer the middle of the view wins", () => {
  const kept = chooseLabels([
    at("edge", 4, 10, 10, 900),
    at("centre", 4, 20, 10, 5),
  ], { max: 10, claim: 46 });
  eq(kept[0].name, "centre", "what you are looking at is named first");
});

check("the cap is a cap, and it takes the highest ranks", () => {
  const many = [];
  for (let i = 0; i < 200; i += 1) {
    // Spread far enough apart that spacing never fires: only the cap can bite.
    many.push(at(`v${i}`, (i % 5) + 1, i * 200, 0, i));
  }
  const kept = chooseLabels(many, { max: 12, claim: 46 });
  eq(kept.length, 12, "capped");
  eq(kept.every((k) => k.rank === 5), true, "and it kept the top rank");
});

check("nothing to label is an empty answer, not a crash", () => {
  eq(chooseLabels([]).length, 0);
});

check("a whole hemisphere of volcanoes stays readable", () => {
  // 231 rank-5 volcanoes is what the real catalogue holds, and a global view
  // shows about half of them. Scattered over a 1600x900 canvas, the layer has
  // to come back with a number a person can read rather than 115 names.
  const crowd = [];
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 115; i += 1) {
    const x = rand() * 1600;
    const y = rand() * 900;
    crowd.push(at(`v${i}`, 5, x, y, Math.hypot(x - 800, y - 450)));
  }
  const kept = chooseLabels(crowd);
  eq(kept.length <= 42, true, `at most the cap, got ${kept.length}`);
  eq(kept.length > 5, true, `and not nothing, got ${kept.length}`);
  // No two survivors may overlap: that is the property the whole thing is for.
  for (let i = 0; i < kept.length; i += 1) {
    for (let j = i + 1; j < kept.length; j += 1) {
      const d = Math.hypot(kept[i].x - kept[j].x, kept[i].y - kept[j].y);
      if (d < 46) throw new Error(`${kept[i].name} and ${kept[j].name} are ${d.toFixed(1)}px apart`);
    }
  }
});

if (failures.length) process.exitCode = 1;
export const results = { passed, failures };
