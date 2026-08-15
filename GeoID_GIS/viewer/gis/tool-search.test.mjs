/**
 * The tool-search ranking, against a registry whose answers are known by
 * construction.
 *
 * The bug this file exists to pin: without the score floor, a query the
 * toolbox cannot answer matches some blurb somewhere and gets a confident
 * wrong answer — the atlas page-search lesson ("where do I do meshing?"
 * recommending Metadata & Lineage because its blurb began with "Where").
 * The floor of 3 is the honesty mechanism: only a name (5) or keyword (3)
 * hit clears it, a blurb hit (1) alone cannot, and favourites/recents are
 * TIEBREAKERS that must never resurrect a sub-floor tool — a favourite
 * that merely blurb-matches must stay invisible, not float to the top.
 *
 * Everything here injects `{tools, favourites, recents}` so the pure
 * algorithm runs under node with no browser and no localStorage.
 *
 * Run: node GeoID_GIS/viewer/gis/tool-search.test.mjs
 */

import { rankTools } from "./tool-search.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── fixtures: a registry small enough to score by hand ── */

const tool = (id, label, blurb, keywords = [], category = "Vector geoprocessing") =>
  ({ id, label, category, blurb, keywords });

const TOOLS = [
  tool("buffer", "Buffer",
    "Grow each feature outward by a distance in metres; overlaps merge.",
    ["distance", "offset", "grow", "ring", "zone"]),
  tool("clip", "Clip",
    "Cut features to the shape of an overlay polygon.",
    ["cut", "mask", "crop"]),
  tool("clipRaster", "Clip raster",
    "Cut a raster to a polygon extent.",
    ["cut", "mask", "extent"], "Raster analysis"),
  // The trap tool: its blurb mentions "buffer" and "zone" but its name and
  // keywords do not — it must never be offered for those queries.
  tool("dissolve", "Dissolve",
    "Merge features sharing a field value; a buffer zone often feeds this.",
    ["merge", "union"]),
];

/* ── empty and unanswerable queries ── */

{
  // Empty means "show the browse state", which is null — NOT an empty array,
  // which means "searched and found nothing". The two render differently.
  check("empty query returns null", rankTools("", { tools: TOOLS }) === null);
  check("whitespace query returns null", rankTools("   ", { tools: TOOLS }) === null);
  // Stopwords and sub-2-char fragments tokenize to nothing.
  check("stopword-only query returns null",
    rankTools("where the", { tools: TOOLS }) === null);
  check("single-letter query returns null", rankTools("a b", { tools: TOOLS }) === null);
}

/* ── name vs blurb weighting, and the floor ── */

{
  // "buffer" hits Buffer's name (5) and, being the whole label, the exact
  // bonus (+20) = 25. Dissolve's blurb hit scores 1 — below the floor, so it
  // must be absent entirely, not merely ranked last.
  const out = rankTools("buffer", { tools: TOOLS, favourites: [], recents: [] });
  check("name match is offered", out.length === 1 && out[0].tool.id === "buffer");
  near("name + exact scores 5 + 20", out[0].score, 25, 0);
  check("a blurb-only match is rejected by the floor",
    !out.some((r) => r.tool.id === "dissolve"));
}
{
  // "outward" appears only in Buffer's blurb: score 1, under the floor, so
  // the honest answer is an empty ARRAY — the no-match state.
  const out = rankTools("outward", { tools: TOOLS, favourites: [], recents: [] });
  check("blurb-only query yields no match", Array.isArray(out) && out.length === 0);
}
{
  // A keyword hit scores 3 — exactly the floor — where the same word in a
  // blurb scores 1. "zone" is Buffer's keyword AND in Dissolve's blurb: only
  // Buffer clears.
  const out = rankTools("zone", { tools: TOOLS, favourites: [], recents: [] });
  check("keyword hit clears the floor", out.length === 1 && out[0].tool.id === "buffer");
  near("keyword scores 3", out[0].score, 3, 0);
}

/* ── the exact-label bonus ── */

{
  // Both Clip and Clip raster carry a name hit (5); only Clip is the whole
  // query, so it takes +20 and must lead.
  const out = rankTools("clip", { tools: TOOLS, favourites: [], recents: [] });
  check("both name matches are offered", out.length === 2);
  check("exact label outranks a partial name hit",
    out[0].tool.id === "clip" && out[0].score === 25);
  check("the partial hit still scores its 5",
    out.some((r) => r.tool.id === "clipRaster" && r.score === 5));
}

/* ── tiebreakers: favourites, then recency, then the alphabet ── */

const TIED = [
  tool("zonalHist", "Zonal histogram", "Bin raster values per zone polygon.", []),
  tool("zonalStats", "Zonal statistics", "Summarise raster values per zone polygon.", []),
];

{
  // Equal 5-point name hits with no prefs: alphabetical order decides.
  const out = rankTools("zonal", { tools: TIED, favourites: [], recents: [] });
  check("equal scores fall back to the alphabet",
    out.length === 2 && out[0].tool.id === "zonalHist");
}
{
  // A favourite wins the tie...
  const out = rankTools("zonal", { tools: TIED, favourites: ["zonalStats"], recents: [] });
  check("a favourite wins a tied score", out[0].tool.id === "zonalStats");
}
{
  // ...and recency breaks the tie among non-favourites. Recents are newest
  // first (spec §5), so index 0 is the most recent.
  const out = rankTools("zonal", {
    tools: TIED,
    favourites: [],
    recents: [{ id: "zonalStats", t: 200 }, { id: "zonalHist", t: 100 }],
  });
  check("the more recent tool wins a tied score", out[0].tool.id === "zonalStats");
}
{
  // Plain-string recents (a hand-edited store) must not crash the comparator.
  const out = rankTools("zonal", { tools: TIED, favourites: [], recents: ["zonalStats"] });
  check("string recents are tolerated", out[0].tool.id === "zonalStats");
}

/* ── prefs are tiebreakers ONLY — the invariant the floor depends on ── */

{
  // Dissolve blurb-matches "buffer" (score 1). Favouriting it must not lift
  // it over the floor: prefs order what is already offered, never widen it.
  const out = rankTools("buffer", { tools: TOOLS, favourites: ["dissolve"], recents: [] });
  check("a favourite never lifts a sub-floor tool",
    !out.some((r) => r.tool.id === "dissolve"));
}
{
  // Nor may a favourite outrank a better score: Clip raster favourited still
  // sits under Clip's exact-match 25.
  const out = rankTools("clip", { tools: TOOLS, favourites: ["clipRaster"], recents: [] });
  check("score beats favourite", out[0].tool.id === "clip");
}
{
  // Recency likewise cannot resurrect: a just-run tool that scores 1 stays out.
  const out = rankTools("buffer", {
    tools: TOOLS, favourites: [], recents: [{ id: "dissolve", t: Date.now() }],
  });
  check("recency never lifts a sub-floor tool",
    !out.some((r) => r.tool.id === "dissolve"));
}

/* ── the result cap ── */

{
  // Fifteen name matches: only twelve are offered, best-alphabetical first.
  const many = Array.from({ length: 15 }, (_, i) =>
    tool(`grid${i}`, `Grid ${String(i + 1).padStart(2, "0")}`, "A gridding tool.", []));
  const out = rankTools("grid", { tools: many, favourites: [], recents: [] });
  check("results cap at 12", out.length === 12);
  check("and the cap keeps the best-ranked head", out[0].tool.label === "Grid 01");
}

/* ── result shape ── */

{
  const out = rankTools("clip", { tools: TOOLS, favourites: [], recents: [] });
  check("rows carry {tool, score}",
    out.every((r) => r.tool && typeof r.tool.id === "string" && typeof r.score === "number"));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
