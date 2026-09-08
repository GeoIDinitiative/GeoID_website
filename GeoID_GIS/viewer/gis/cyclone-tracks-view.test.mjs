/**
 * The two readings of the tracks layer, and the one colour that means two
 * things unless the key says otherwise.
 */
import { readFileSync } from "node:fs";
import { trackPaint } from "./cyclone-tracks-view.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

const storm = (kts) => ({ properties: { peak_wind_kts: kts } });
const set = [storm(30), storm(70), storm(100), storm(140), storm(null), storm(null)];

/* ── Number(null) IS ZERO, and this file is 54% nulls ────────────────────── */
// 7,267 of 13,513 tracks carry no measured peak. Read with a bare Number()
// every one becomes 0 -- finite, so it passes an isFinite guard and lands in
// the BOTTOM class, stating a strength for a storm nobody measured.
const cat = trackPaint(set, "category");
check("an unmeasured storm keeps no colour", cat.colourFor(storm(null)), null);
check("and an empty string is not a calm either", cat.colourFor(storm("")), null);
check("a measured weak storm still gets the bottom class",
  typeof cat.colourFor(storm(30)), "string");
check("which is NOT the same answer as unmeasured",
  cat.colourFor(storm(30)) !== cat.colourFor(storm(null)), true);

/* ── the key accounts for every line drawn ───────────────────────────────── */
const sum = (a) => a.reduce((t, n) => t + n, 0);
check("the default key names the unmeasured", cat.legend.labels[0], "Peak never measured");
check("and counts them", cat.legend.counts[0], 2);
check("the key sums to the features", sum(cat.legend.counts), set.length);

const hur = trackPaint(set, "hurricane");
// THE GREY IS TWO THINGS on this view -- storms measured below 64, and storms
// nobody measured. Naming it "never reached hurricane force" would state that
// of 7,267 storms with no reading at all.
check("the hurricane key names both, not just the weak ones",
  hur.legend.labels[0], "Below hurricane force, or never measured");
check("and counts both", hur.legend.counts[0], 3);
check("its key sums to the features too", sum(hur.legend.counts), set.length);
check("a storm that reached hurricane force keeps its category colour",
  hur.colourFor(storm(140)), cat.colourFor(storm(140)));
check("one that did not is stood down", hur.colourFor(storm(30)), "#8a8a8a");
check("and one nobody measured is still not coloured",
  hur.colourFor(storm(null)), null);

/* ── the classes are the scale's, on both views ──────────────────────────── */
check("same class labels either way, past the first row",
  hur.legend.labels.slice(1), cat.legend.labels.slice(2));
check("and the scale's own words", cat.legend.labels[1], "Tropical storm or weaker");

/* ── it must be a REPAINT, pinned on the source ──────────────────────────── */
// A choice that loads a different FILE is not a symbology: it drops the layer,
// rebuilds it and paints it a beat later, which is how the button this
// replaced was reported -- "it changes colours in stages".
const src = readFileSync(new URL("./cyclone-tracks-view.js", import.meta.url), "utf8");
check("the view repaints the loaded features",
  /layer\.repaint\?\.\(paint\.colourFor\)/.test(src), true);
check("and fetches nothing", !/fetch\(|import\(|dataUrl/.test(src), true);
// It highlights whole STORMS that reached hurricane force, which is not the
// stretches they spent there -- 47% of Katrina's track, 13% of Sandy's. The
// option is named for what it does.
check("the option does not claim to be the stretches",
  /Only those that reached hurricane force/.test(
    readFileSync(new URL("./global-data.js", import.meta.url), "utf8")), true);

process.on("exit", () => {
  if (failures.length) {
    console.log(`✗  cyclone-tracks-view.test.mjs  —  ${pass} passed, ${failures.length} FAILED`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  cyclone-tracks-view.test.mjs  —  ${pass} passed`);
  }
});
