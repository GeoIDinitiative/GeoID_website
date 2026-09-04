/**
 * The time seam: one window, one series, many sources.
 *
 * These pin the three habits taken from the glacier animator, because each of
 * them is a thing a naive generic version gets wrong:
 *
 *   1. a source's own dates beat arithmetic
 *   2. a cap strides and SAYS SO, rather than truncating quietly
 *   3. the frame and request counts are known before anything is fetched
 *
 * Run: node GeoID_GIS/viewer/gis/time-series.test.mjs
 */

import { readFileSync } from "node:fs";
import { windowsFrom, stride, planSeries, MAX_FRAMES } from "./time-series.js";
import { normaliseWindow, describeWindow, CADENCES, SEASONS } from "./time-window.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/* ── the window, checked as a whole ──────────────────────────────────────── */

{
  const good = normaliseWindow({ from: "2016-01-01", to: "2026-01-01", step: "year" });
  check("a well-formed window is ok", good.ok && good.error === null);
  eq("and comes back normalised", good.window.season, "full");

  const backwards = normaliseWindow({ from: "2026-01-01", to: "2016-01-01", step: "year" });
  check("two valid dates the wrong way round are refused", backwards.ok === false);
  check("with an instruction, not a diagnosis",
    /From date has to come before/.test(backwards.error));
  // The failure this guards: each field is individually valid, so per-field
  // checking passes and the frame arithmetic reports "holds no frames" from
  // three files away.
  eq("and nothing is handed on", backwards.window, null);

  eq("a missing date says which", normaliseWindow({ to: "2026-01-01" }).error,
    "Give a From date.");
  check("an unknown cadence is refused rather than silently defaulted",
    /not a cadence/.test(normaliseWindow(
      { from: "2016-01-01", to: "2026-01-01", step: "fortnight" }).error));
  check("an unknown season falls back to the whole year",
    normaliseWindow({ from: "2016-01-01", to: "2026-01-01", season: "harvest" })
      .window.season === "full");
}

eq("a window describes itself in the reader's terms",
  describeWindow({ from: "2016-06-01", to: "2026-06-01", step: "year", season: "summer" }),
  "2016 to 2026, one frame per year, summer only");

/* ── even splits, for sources with no dates of their own ─────────────────── */

{
  const years = windowsFrom({ from: "2016-01-01", to: "2020-12-31", step: "year" });
  eq("five calendar years", years.length, 5);
  eq("the first is labelled by its year", years[0].label, "2016");
  eq("and does not spill into the next", years[0].to, "2016-12-31");
  eq("the last ends where the window ends", years[4].to, "2020-12-31");

  const months = windowsFrom({ from: "2020-01-01", to: "2020-06-30", step: "month" });
  eq("six months", months.length, 6);

  eq("a backwards range yields nothing rather than throwing",
    windowsFrom({ from: "2026-01-01", to: "2016-01-01" }).length, 0);
  eq("and so does a malformed one", windowsFrom({ from: "yesterday", to: "2016" }).length, 0);
}

/* ── the cap strides, and says what it cost ──────────────────────────────── */

{
  const many = Array.from({ length: 100 }, (_, i) => ({ date: `20${String(i).padStart(2, "0")}` }));
  const out = stride(many, 10);
  check("a long sequence is capped", out.epochs.length <= 11);
  check("by striding, not truncating", out.stride > 1);
  eq("and the far end survives the stride",
    out.epochs[out.epochs.length - 1], many[many.length - 1]);
  eq("what the cap cost is returned", out.dropped, 100 - out.epochs.length);

  const few = stride([{ date: "a" }, { date: "b" }], 10);
  eq("a short sequence is untouched", few.stride, 1);
  eq("and drops nothing", few.dropped, 0);
}

/* ── planning: counts before fetches ─────────────────────────────────────── */

{
  const window = { from: "2016-01-01", to: "2020-12-31", step: "year", season: "full" };

  // A source with no opinions gets the even split and an unbilled request each.
  const plain = planSeries({}, window);
  check("a source with no opinions still plans", plain.ok);
  eq("one frame per year", plain.epochs.length, 5);
  eq("and one request per frame", plain.cost.requests, 5);
  check("said plainly under the button", /5 frames, 5 requests/.test(plain.summary));

  // Earth Engine: one billed render per frame. The wording has to differ.
  const billed = planSeries({ costFor: (e) => ({ requests: e.length, billed: true }) }, window);
  check("a billed source says renders, not requests",
    /5 frames, 5 billed renders/.test(billed.summary), billed.summary);

  // GFS: every hour of one run arrives together. N frames, ONE request.
  const forecast = planSeries({
    cadences: ["day", "month"],
    epochsFor: (w) => windowsFrom({ ...w, step: "day" }).slice(0, 16),
    costFor: () => ({ requests: 1, billed: false }),
  }, { from: "2026-09-01", to: "2026-09-16", step: "day" });
  eq("sixteen forecast frames", forecast.epochs.length, 16);
  check("from a single request", /16 frames, 1 request\b/.test(forecast.summary), forecast.summary);

  // Habit 1: the archive's own dates, not an even split across them.
  const archive = planSeries({
    epochsFor: () => [{ date: "1985-08-13" }, { date: "2003-08-13" }, { date: "2018-09-01" }],
  }, window);
  eq("a source's own dates are used as given", archive.epochs.map((e) => e.date),
    ["1985-08-13", "2003-08-13", "2018-09-01"]);

  // A cadence the source cannot honour is refused, not silently substituted.
  const refused = planSeries({ cadences: ["year"] }, { ...window, step: "day" });
  check("a cadence the source cannot honour is refused", refused.ok === false);
  check("naming the cadence", /cannot step by day/.test(refused.error));

  const empty = planSeries({ epochsFor: () => [] }, window);
  check("a plan with no frames is not ok", empty.ok === false);
  eq("and says so", empty.error, "That range holds no frames.");
  eq("no window at all is refused too", planSeries({}, null).ok, false);

  // Habit 3: planning must not fetch. A source whose frameFor throws still plans.
  let fetched = 0;
  const lazy = planSeries({ frameFor: () => { fetched += 1; throw new Error("fetched!"); } },
    window);
  check("planning touches no source data", lazy.ok && fetched === 0);
}

/* ── the vocabulary is shared, not re-spelled ────────────────────────────── */

check("cadences are declared once", CADENCES.map((c) => c.id).includes("season"));
check("and seasons too", SEASONS.map((s) => s.id).includes("summer"));
eq("the frame cap is a named constant", typeof MAX_FRAMES, "number");

/* ── the cap is shared, not copied ───────────────────────────────────────── */
/**
 * A structural check, in the shape this tree already uses for the two tool
 * registries: the imagery driver must CALL the shared cap rather than keep a
 * second copy of the same arithmetic. A copy is not wrong on the day it is
 * made -- it is wrong the first time either is fixed, which is the whole
 * reason `timelapse-player.js` was extracted in the first place.
 *
 * The glacier animator is deliberately NOT held to this. It caps by keeping
 * the FULLEST dates, which is a rule about the GLIMS archive rather than
 * about sliders, and forcing it through an even stride would throw away the
 * very frames it selects for.
 */
{
  const src = readFileSync(new URL("./imagery-timelapse.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("the imagery driver imports the shared cap",
    /from "\.\/time-series\.js/.test(src));
  check("and does not re-derive a stride of its own",
    !/Math\.ceil\([a-zA-Z]+\.length \/ max\)/.test(src));

  const glacier = readFileSync(new URL("./glacier-timelapse.js", import.meta.url), "utf8");
  check("the glacier animator keeps its own fullest-dates rule",
    /slice\(0, max\)/.test(glacier));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
