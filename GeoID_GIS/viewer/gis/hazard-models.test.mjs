/**
 * The Models tab shows what the bakes wrote, every map of it, honestly.
 *
 * Run against a hand-made entry (so a missing field fails here and not on the
 * page) and against the published file itself: every map GeoHUB sells must be
 * in it, and every card must carry its parameters, its hold-out and the five
 * metrics, with a confusion matrix that adds up to its own n.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCard, renderModels, formatMetric, formatParam, skillWord, regionTable, licenceRows, renderLicences } from "./hazard-models.js";

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}`); }
}
function ok(cond, what) { if (!cond) throw new Error(what); }

const ENTRY = {
  id: "x", name: "Test <map>", script: "s.py", generated: "2026-10-23T00:00:00Z",
  model: { method: "forest", parameters: { trees: 300, weights: { a: 0.35 }, importance: [["slope", 0.2]] },
    inputs: [{ name: "DEM", source: "Terrarium" }], gap_fills: { rain: { method: "IDW", cells: 12, why: "coast" } } },
  validation: { holdout: "temporal", n: 10, tp: 3, fp: 1, tn: 5, fn: 1, accuracy: 0.8, precision: 0.75,
    recall: 0.75, f1: 0.75, kappa: 0.5833, auc: 0.875, threshold_rule: "score >= 0.5", positives: 4 },
  limits: ["a limit"],
};

check("a card shows every metric, the matrix, the parameters and the hold-out", () => {
  const html = renderCard(ENTRY);
  for (const s of ["0.875", "0.800", "0.750", "0.583", ">3<small>TP", ">1<small>FP", ">5<small>TN", ">1<small>FN",
    "trees", "300", "a: 0.35", "slope 0.2", "temporal", "score &gt;= 0.5", "IDW", "a limit", "Terrarium"]) {
    ok(html.includes(s), `missing ${s}`);
  }
});
check("names are escaped", () => {
  ok(renderCard(ENTRY).includes("Test &lt;map&gt;"), "unescaped name");
});
check("an unscored map says NOT ASSESSABLE and shows no numbers", () => {
  const html = renderCard({ ...ENTRY, validation: { assessable: false, auc: null, message: "n = 3" } });
  ok(html.includes("NOT ASSESSABLE"), "no verdict");
  ok(!html.includes("hm-cm"), "a matrix was drawn for an unscored map");
});
check("undefined rates are a dash, never NaN", () => {
  ok(formatMetric(null) === "—" && formatMetric(NaN) === "—" && formatMetric(0.5) === "0.500", "format");
  ok(formatParam({ a: [1, 2] }) === "a: 1, 2", formatParam({ a: [1, 2] }));
  ok(skillWord(0.95) === "excellent" && skillWord(0.5) === "no skill" && skillWord(null) === "not assessable", "skill");
});
check("a region-held-out model shows a row per region, and says which could not be scored", () => {
  const html = regionTable({ europe: { auc: 0.81, accuracy: 0.7, precision: 0.6, recall: 0.5, f1: 0.545, events: 9 },
    oceania: { assessable: false, message: "fewer than 30 flooded cells", events: 2 } });
  ok(html.includes(">europe<") && html.includes("0.810") && html.includes("0.545"), "europe row");
  ok(html.includes("not assessable") && html.includes("fewer than 30"), "unscored region");
  ok(renderCard({ ...ENTRY, validation: { ...ENTRY.validation, regions: { europe: { auc: 0.9 } } } }).includes("hm-regions"),
    "card does not carry the region table");
});

check("licences are listed once per source, with every map that uses it", () => {
  const data = { maps: [
    { name: "A", model: { inputs: [{ name: "DEM", source: "Terrarium", licence: "public domain" }, { name: "Floods", source: "EMS", licence: "Copernicus open" }] } },
    { name: "B", model: { inputs: [{ name: "DEM", source: "Terrarium", licence: "public domain" }] } }] };
  const rows = licenceRows(data);
  ok(rows.length === 2 && rows[0].maps.join() === "A,B", JSON.stringify(rows));
  ok(renderLicences(data).includes("Copernicus open") && renderCard(data.maps[0]).includes("Licence: public domain"), "licence not shown");
});

check("an empty file renders a sentence, not nothing", () => {
  ok(renderModels({ maps: [] }).includes("No validated"), "empty");
});

const PUBLISHED = join(HERE, "../../../data/global/hazard-validation.json");
check("the published file holds all six maps, each scored or explicitly unassessable", () => {
  ok(existsSync(PUBLISHED), "data/global/hazard-validation.json missing");
  const data = JSON.parse(readFileSync(PUBLISHED, "utf8"));
  const ids = data.maps.map((m) => m.id);
  for (const id of ["flood-susceptibility", "flood-susceptibility-fine", "flood-susceptibility-wales", "landslide-susceptibility-global", "landslide-susceptibility-fine", "landslide-susceptibility", "cyclone-risk", "seismic-risk",
    "volcanic-risk", "volcanic-risk-holocene"]) ok(ids.includes(id), `no entry for ${id}`);
  for (const id of ["flood-susceptibility", "flood-susceptibility-fine", "landslide-susceptibility-global", "landslide-susceptibility-fine"]) {
    const m = data.maps.find((x) => x.id === id);
    ok((m.model.inputs || []).every((i) => i.licence), `${id}: an input without a licence`);
    ok(Object.keys(m.validation.regions || {}).length >= 5, `${id}: fewer than five held-out regions`);
  }
  data.maps.forEach((m) => {
    const v = m.validation;
    ok(m.model && Object.keys(m.model.parameters || {}).length, `${m.id}: no parameters`);
    ok(v.holdout, `${m.id}: no hold-out stated`);
    if (v.assessable === false) return;
    for (const k of ["auc", "accuracy", "precision", "recall", "f1"]) ok(Number.isFinite(v[k]), `${m.id}: ${k}`);
    ok(v.tp + v.fp + v.tn + v.fn === v.n, `${m.id}: matrix sums to ${v.tp + v.fp + v.tn + v.fn}, n ${v.n}`);
    ok(Math.abs(v.accuracy - (v.tp + v.tn) / v.n) < 1e-4, `${m.id}: accuracy disagrees with its matrix`);
    if (v.tp + v.fp) ok(Math.abs(v.precision - v.tp / (v.tp + v.fp)) < 1e-4, `${m.id}: precision`);
    ok(Math.abs(v.recall - v.tp / (v.tp + v.fn)) < 1e-4, `${m.id}: recall`);
    ok(renderCard(m).includes(formatMetric(v.f1)), `${m.id}: F1 not on the card`);
  });
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
