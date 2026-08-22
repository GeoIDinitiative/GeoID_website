/**
 * The two vector paints, against the fault that made this file worth having.
 *
 * `categoricalSymbology` counts values as STRINGS, and a shapefile's columns
 * are often numbers — so a lookup keyed by the raw value missed every feature
 * and painted the whole layer the no-value grey, under a legend that named its
 * seven classes perfectly. Measured on Natural Earth coastlines by `scalerank`:
 * all 813,648 vertices grey. Nothing about that looks like a bug in a
 * screenshot, which is exactly why it is pinned here.
 */

import { paintByField, paintSingle, DEFAULT_SINGLE } from "./symbology-dialog.js";

let passed = 0;
const failures = [];
// PASS/FAIL per line: that is what tests/run.mjs counts for its summary.
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

/** A layer whose repaint records the colour each feature was given. */
function fakeLayer(features) {
  const layer = { name: "test", features, painted: null };
  layer.repaint = (colourFor) => {
    layer.painted = features.map((f) => colourFor(f));
    return true;
  };
  return layer;
}

const numeric = [1, 1, 1, 2, 2, 3].map((scalerank, i) => ({
  properties: { scalerank, name: `f${i}` },
}));
const textual = ["basalt", "basalt", "granite"].map((rock, i) => ({
  properties: { rock, name: `f${i}` },
}));

check("a NUMERIC column colours every feature, not the grey fallback", () => {
  const layer = fakeLayer(numeric);
  const sym = paintByField(layer, "scalerank");
  eq(sym.ok, true, "symbology");
  eq(layer.painted.length, 6, "painted");
  eq(layer.painted.filter((c) => c === "#8a8a8a").length, 0, "grey features");
  eq(new Set(layer.painted).size, 3, "distinct colours");
});

check("features sharing a numeric value share a colour", () => {
  const layer = fakeLayer(numeric);
  paintByField(layer, "scalerank");
  eq(layer.painted[0], layer.painted[1], "same class");
  eq(layer.painted[0] === layer.painted[3], false, "different class");
});

check("a text column still works, and is the case that always did", () => {
  const layer = fakeLayer(textual);
  paintByField(layer, "rock");
  eq(new Set(layer.painted).size, 2, "distinct colours");
  eq(layer.painted[0], layer.painted[1], "same rock");
});

check("a feature with no value takes the fallback rather than a class", () => {
  const layer = fakeLayer([...numeric, { properties: { name: "blank" } }]);
  paintByField(layer, "scalerank");
  eq(layer.painted[6], null, "missing value");
});

check("the legend is built from the same rows that were painted", () => {
  const layer = fakeLayer(numeric);
  paintByField(layer, "scalerank");
  eq(layer.legendInfo.field, "scalerank", "field");
  eq(layer.legendInfo.palette.length, 3, "palette");
  eq(layer.legendInfo.labels.join(","), "1,2,3", "labels");
  eq(layer.legendInfo.counts.join(","), "3,2,1", "counts");
});

check("a class can be renamed without changing what is painted", () => {
  const layer = fakeLayer(numeric);
  paintByField(layer, "scalerank", { labels: new Map([["1", "Coast"]]) });
  eq(layer.legendInfo.labels[0], "Coast", "renamed");
  eq(layer.legendInfo.values[0], "1", "raw value kept");
});

check("an override recolours one class and only that class", () => {
  const layer = fakeLayer(numeric);
  paintByField(layer, "scalerank", { overrides: new Map([["1", "#ff0000"]]) });
  eq(layer.painted[0], "#ff0000", "overridden");
  eq(layer.painted[3] === "#ff0000", false, "untouched");
});

check("one colour paints every feature the same", () => {
  const layer = fakeLayer(numeric);
  const out = paintSingle(layer, "#ff4d00");
  eq(out.ok, true, "ok");
  eq(new Set(layer.painted).size, 1, "distinct colours");
  eq(layer.painted[0], "#ff4d00", "colour");
  eq(layer.symbologySingle, "#ff4d00", "remembered");
});

check("one colour has a default, so a line layer needs no choice made", () => {
  const layer = fakeLayer(numeric);
  paintSingle(layer);
  eq(layer.painted[0], DEFAULT_SINGLE, "default");
});

check("the two modes are exclusive in both directions", () => {
  const layer = fakeLayer(numeric);
  paintSingle(layer, "#ff4d00");
  eq(layer.geologyField, null, "field cleared by single");
  paintByField(layer, "scalerank");
  eq(layer.symbologySingle, null, "single cleared by field");
  eq(layer.geologyField, "scalerank", "field set");
});

check("one colour writes a legend of one swatch", () => {
  const layer = fakeLayer(numeric);
  paintSingle(layer, "#ff4d00");
  eq(layer.legendInfo.palette.join(","), "ff4d00", "palette");
  eq(layer.legendInfo.labels.length, 1, "one row");
});

check("a layer with nothing to colour refuses rather than throwing", () => {
  eq(paintByField(fakeLayer([]), "scalerank").ok, false, "no features");
  eq(paintSingle({ name: "x" }).ok, false, "no repaint");
});

if (failures.length) process.exitCode = 1;
export const results = { passed, failures };
