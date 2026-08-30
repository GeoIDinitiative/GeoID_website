/**
 * A deeper tile level may be a DIFFERENT, PARTIAL survey — not a finer drawing.
 *
 * Macrostrat's carto layer composites several source maps and switches between
 * them by scale. Measured over a box straddling the Northern Ireland border:
 * zoom 8 covers 99.9% of it from two source datasets, and zoom 9 covers 56.1%
 * from one — 1,579 of 3,600 sample points losing their geology — while the
 * vertex count RISES from 5,872 to 6,551, because the surviving survey is drawn
 * more finely. So the climb's detail ruler said "better" about a level that had
 * thrown 44% of the map away.
 *
 * The gate is pure geometry and is tested as such: a coverage measure that
 * cannot tell a full box from a half-empty one would pass the climb straight
 * back into the same hole.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const src = (await import("node:fs")).readFileSync(
  new URL("./vector-tiles.js", import.meta.url), "utf8");

// The gate must exist, be checked BEFORE the detail comparison, and stop the
// climb rather than merely noting the loss.
ok("a coverage measure exists", /function coverageWithin\(features, bounds\)/.test(src));
ok("the climb records coverage per level", /levels\.push\(\{[^}]*coverage/.test(src));
ok("a coverage collapse stops the climb", /stoppedFor = "coverage"/.test(src));
ok("the tolerance is a named constant", /const COVERAGE_TOLERANCE = [\d.]+;/.test(src));
{
  const gate = src.indexOf('stoppedFor = "coverage"');
  const detail = src.indexOf("if (!best || detail > best.detail)");
  ok("coverage is tested BEFORE detail wins the level", gate > 0 && detail > 0 && gate < detail);
}
{
  // The tolerance must be small enough to catch the measured collapse and
  // large enough not to trip on coastline wobble.
  const tol = Number(/const COVERAGE_TOLERANCE = ([\d.]+);/.exec(src)[1]);
  ok("the tolerance catches a 44-point collapse", 0.999 - tol > 0.561);
  ok("the tolerance allows ordinary generalisation wobble", tol >= 0.01);
}

// The measure itself, against shapes whose coverage is known by construction.
const { coverageWithin } = await import("./vector-tiles.js");
const bounds = { west: 0, south: 0, east: 1, north: 1 };
const poly = (w, s, e, n) => ({ geometry: { type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });

ok("a polygon covering the box reads as 1", coverageWithin([poly(-1, -1, 2, 2)], bounds) === 1);
ok("nothing reads as 0", coverageWithin([], bounds) === 0);
ok("a polygon outside the box reads as 0", coverageWithin([poly(5, 5, 6, 6)], bounds) === 0);
ok("half the box reads as a half",
  near(coverageWithin([poly(-1, -1, 0.5, 2)], bounds), 0.5, 0.03));
ok("two halves read as the whole",
  coverageWithin([poly(-1, -1, 0.5, 2), poly(0.5, -1, 2, 2)], bounds) === 1);
{
  // A HOLE is ground with no geology and must not be counted as covered --
  // the whole point of the measure is to notice missing ground.
  const donut = { geometry: { type: "Polygon", coordinates: [
    [[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]],
    [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]],
  ] } };
  ok("a hole is not covered", near(coverageWithin([donut], bounds), 1 - 0.36, 0.04));
}
{
  // MultiPolygon parts each count.
  const mp = { geometry: { type: "MultiPolygon", coordinates: [
    [[[-1, -1], [0.5, -1], [0.5, 2], [-1, 2], [-1, -1]]],
    [[[0.5, -1], [2, -1], [2, 2], [0.5, 2], [0.5, -1]]],
  ] } };
  ok("every part of a MultiPolygon counts", coverageWithin([mp], bounds) === 1);
}
ok("a line contributes nothing -- only areas cover ground",
  coverageWithin([{ geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }], bounds) === 0);

// And the measured collapse must be on the refusing side of the tolerance.
{
  const tol = Number(/const COVERAGE_TOLERANCE = ([\d.]+);/.exec(src)[1]);
  ok("the real z8 -> z9 collapse would be refused", (2020 / 3600) < 0.999 - tol);
}


// ── merging the levels ──────────────────────────────────────────────────────
/**
 * The fill is BY SOURCE DATASET, which is only exact because the surveys
 * MOSAIC: measured over a cross-border box, one sample point of 4,900 was
 * covered by more than one source. If they overlapped, filling by source would
 * double-cover ground and an extraction would count it twice.
 */
{
  const { sourceKey } = await import("./vector-tiles.js");
  ok("a feature's survey is its source_id",
    sourceKey({ properties: { source_id: 147 } }) === "147");
  ok("a source with no source_id is one unnamed survey",
    sourceKey({ properties: {} }) === "" && sourceKey(null) === "");

  // The merge itself, as the climb performs it: keep the deep level whole and
  // add only the surveys it does not carry.
  const deep = [{ properties: { source_id: 23, name: "fine A" } },
    { properties: { source_id: 23, name: "fine B" } }];
  const base = [{ properties: { source_id: 23, name: "coarse A" } },
    { properties: { source_id: 147, name: "other survey" } }];
  const here = new Set(deep.map(sourceKey));
  const missing = base.filter((f) => !here.has(sourceKey(f)));
  ok("only the absent survey is filled in", missing.length === 1
    && missing[0].properties.name === "other survey");
  ok("the deep level's own survey is NOT duplicated from the coarse level",
    !missing.some((f) => sourceKey(f) === "23"));

  const merged = deep.concat(missing);
  ok("the merge keeps every fine feature", merged.filter((f) => sourceKey(f) === "23").length === 2);
  ok("and carries both surveys", new Set(merged.map(sourceKey)).size === 2);
}
{
  // A source that does NOT composite must come out unchanged: every feature
  // shares one key, so nothing is ever filled and the merge is a no-op.
  const { sourceKey } = await import("./vector-tiles.js");
  const deep = [{ properties: { name: "a" } }];
  const base = [{ properties: { name: "b" } }, { properties: { name: "c" } }];
  const here = new Set(deep.map(sourceKey));
  ok("a single-survey source fills nothing",
    base.filter((f) => !here.has(sourceKey(f))).length === 0);
}
ok("the climb records how much each level was filled by", /filled/.test(src));
ok("the merge runs BEFORE the coverage refusal", (() => {
  const merge = src.indexOf("for (const [k, rec] of deepestFor)");
  const refuse = src.lastIndexOf('stoppedFor = "coverage"');
  return merge > 0 && refuse > merge;
})());
/**
 * THE FILL IS PER SURVEY, from the deepest level that carries it.
 *
 * Filling from one fallback level drops any survey that level lacks too.
 * Measured over a box across the North Channel: source 7 appears at zoom 5 and
 * 6 and is GONE by 7, while the deepest reachable level is 8 — so a fill that
 * read only zoom 8 never saw it and the dataset vanished from the clip.
 */
ok("each survey is remembered at its own deepest level",
  /const deepestFor = new Map\(\);/.test(src)
  && /deepestFor\.set\(k, \{ zoom: z, features: list \}\)/.test(src));
ok("the fill walks every remembered survey, not one level's features",
  /for \(const \[k, rec\] of deepestFor\)/.test(src));
ok("and only surveys the deep level does NOT carry are added",
  /if \(!carried\.has\(k\)\) missing\.push\(\.\.\.rec\.features\)/.test(src));
{
  // The algebra, on the measured shape: 23 and 147 reach zoom 8, 7 stops at 6.
  const deepest = new Map([["23", { zoom: 8 }], ["147", { zoom: 8 }], ["7", { zoom: 6 }]]);
  const carried = new Set(["23", "147"]);              // what zoom 8 holds
  const filled = [...deepest.keys()].filter((k) => !carried.has(k));
  ok("the survey that stops early is the one filled in",
    filled.length === 1 && filled[0] === "7");
  ok("and a survey the deep level HAS is never filled from a coarser copy",
    !filled.includes("23") && !filled.includes("147"));
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
