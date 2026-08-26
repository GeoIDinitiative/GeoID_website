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

/* ── the hierarchy has to be visible in the spacing too ───────────────────
 *
 * Rank drives the type size, and a bigger name needs more room. A candidate
 * may therefore carry its OWN claim radius; the pair is separated by the
 * larger of the two, or a rank-5 name would be held off its neighbours while
 * a rank-1 was free to sit under its descenders.
 */
check("a candidate's own claim outranks the default", () => {
  const kept = chooseLabels([
    { rank: 5, x: 100, y: 100, visible: true, fromCentre: 0, claim: 80 },
    { rank: 4, x: 160, y: 100, visible: true, fromCentre: 1, claim: 40 },
  ], { max: 10, claim: 40 });
  eq(kept.length, 1, "60 px apart is inside the big one's 80 px claim");
});

check("and the LARGER of the two claims is what separates them", () => {
  // Same pair, the big one second: the small one is kept first and its own
  // claim is 40, so testing only the kept label's radius would let the big
  // one in at 60 px.
  const kept = chooseLabels([
    { rank: 5, x: 160, y: 100, visible: true, fromCentre: 0, claim: 40 },
    { rank: 4, x: 100, y: 100, visible: true, fromCentre: 1, claim: 80 },
  ], { max: 10, claim: 40 });
  eq(kept.length, 1, "the second candidate's own claim still applies");
});

check("a candidate with no claim of its own falls back to the option", () => {
  const near = chooseLabels([
    { rank: 5, x: 100, y: 100, visible: true, fromCentre: 0 },
    { rank: 4, x: 140, y: 100, visible: true, fromCentre: 1 },
  ], { max: 10, claim: 46 });
  eq(near.length, 1, "40 px apart is inside the 46 px default");
  const far = chooseLabels([
    { rank: 5, x: 100, y: 100, visible: true, fromCentre: 0 },
    { rank: 4, x: 150, y: 100, visible: true, fromCentre: 1 },
  ], { max: 10, claim: 46 });
  eq(far.length, 2, "50 px apart is outside it, and both are drawn");
});

/* ── a label is a BOX ─────────────────────────────────────────────────────
 *
 * The chip is up to 110 px wide and its dot is a point. A circular claim round
 * the dot let "Campi Flegrei" and "Vesuvius" both through at 46 px apart, and
 * the map read "Campi FleVesuvius". Where both candidates know their box, the
 * boxes are what is tested.
 */
const box = (x, y, w, h = 34) => ({ left: x, right: x + w, top: y - h, bottom: y });

check("two overlapping chips cannot both be drawn", () => {
  const kept = chooseLabels([
    { rank: 5, x: 100, y: 100, visible: true, fromCentre: 0, rect: box(118, 82, 110) },
    { rank: 4, x: 146, y: 100, visible: true, fromCentre: 1, rect: box(164, 82, 90) },
  ], { max: 10, claim: 46 });
  eq(kept.length, 1, "46 px between the dots, but the chips overlap by 64 px");
});

check("and two that clear each other both are", () => {
  const kept = chooseLabels([
    { rank: 5, x: 100, y: 100, visible: true, fromCentre: 0, rect: box(118, 82, 110) },
    { rank: 4, x: 300, y: 100, visible: true, fromCentre: 1, rect: box(318, 82, 90) },
  ], { max: 10, claim: 46 });
  eq(kept.length, 2, "boxes apart, both drawn -- even though a 46 px circle would not care");
});

check("a chip clears a neighbour that is only ABOVE it", () => {
  // Rectangles, not rows: a name directly overhead is a clash, one to the side
  // at the same height is not, and a radius cannot tell those apart.
  const kept = chooseLabels([
    { rank: 5, x: 100, y: 200, visible: true, fromCentre: 0, rect: box(118, 182, 110) },
    { rank: 4, x: 100, y: 120, visible: true, fromCentre: 1, rect: box(118, 102, 110) },
  ], { max: 10, claim: 46 });
  eq(kept.length, 2, "80 px of vertical clearance is enough for a 34 px chip");
});

if (failures.length) process.exitCode = 1;
export const results = { passed, failures };
