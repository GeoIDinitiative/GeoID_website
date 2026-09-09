/**
 * The volcanic risk sheets: one scale, one band per VEI, the card that reads
 * them, and the rows that load them.
 */
import { readFileSync } from "node:fs";
import {
  riskEdges, RISK_LABELS, RETURN_PERIODS_YEARS, classOf, VEI_COLOURS, VIEWS, VIEW_ORDER,
} from "./volcanic-risk.js";
import { volcanicRiskCard, returnPeriod, asPercent } from "./volcanic-risk-card.js";
import { DATASETS } from "./global-data.js";
import { mathsFor } from "./equations.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── one scale: return periods, one label more than edges ────────────────── */
const edges = riskEdges();
check("an edge per period", edges.length, RETURN_PERIODS_YEARS.length);
check("one label more than the edges", RISK_LABELS.length, edges.length + 1);
check("an edge is 1 - exp(-1/T)", Number(edges[4].toFixed(6)), Number((1 - Math.exp(-1 / 100)).toFixed(6)));
check("the scale reaches one in 100,000 years, where a VEI 7 band lives", RETURN_PERIODS_YEARS[0], 100000);
check("nothing is not a class", classOf(0), -1);
check("1 in 476 years is the 1-in-1,000 class", RISK_LABELS[classOf(1 - Math.exp(-1 / 476))], "about 1 in 1,000 years");
check("a yearly rate is the top class", RISK_LABELS[classOf(1 - Math.exp(-1))], "more often than 1 in 5 years");

/* ── every VEI is a view of its own, and the magnitude is ordinal ───────── */
check("a view per VEI number", [0, 1, 2, 3, 4, 5, 6, 7].every((v) => VIEWS[`vei${v}`]?.band === `vei${v}`), true);
check("plus any and the largest", [VIEWS.any.band, VIEWS.vei_max.categorical], ["any", true]);
check("every view is offered", VIEW_ORDER.every((v) => VIEWS[v]) && VIEW_ORDER.length === Object.keys(VIEWS).length, true);
check("the VEI palette is fixed and in order", Object.keys(VEI_COLOURS).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8]);

/* ── the card reads the bands ────────────────────────────────────────────── */
const sample = { any: 0.1843, vei0: 0, vei1: 0.069, vei2: 0.081, vei3: 0.034, vei4: 0, vei5: 4.3e-5, vei6: 0, vei7: 0, vei_max: 5, vents: 19, prior_only: 0 };
const card = volcanicRiskCard(sample);
check("the title carries the chance for the view", card.title, "1 in 5.4 years · 17% a year");
check("the kicker names the record", card.kicker, "Volcanic risk — any eruption (windowed record)");
check("every size with a rate is a row, largest first",
  card.headline.filter(([k]) => /^VEI \d$/.test(k)).map(([k]) => k), ["VEI 5", "VEI 3", "VEI 2", "VEI 1"]);
check("and the largest on record", card.headline.find(([k]) => /Largest/.test(k))[1], "VEI 5");
check("a VEI view titles by that band", volcanicRiskCard(sample, { view: "vei5" }).title, "1 in 23,256 years · 0.0043% a year");
check("the full record says so", /full Holocene/.test(volcanicRiskCard(sample, { full: true }).kicker), true);
check("a prior-only point names its basis", volcanicRiskCard({ ...sample, prior_only: 1 }).headline.some(([k, v]) => k === "Basis" && /floor prior/.test(v)), true);
check("nothing reached is said, not zeroed", volcanicRiskCard({ any: 0, vei_max: 0 }).title, "Not once on record");
check("return periods", [returnPeriod(1 / 11700), returnPeriod(0.9), returnPeriod(3)], ["1 in 11,700 years", "about one a year", "3.0 a year"]);
check("percent from a rate, through Poisson", asPercent(0.1843), "17%");

/* ── the sheets are rows, not catalogue entries, and the popup asks them ─── */
check("no polygon entry survives in the catalogue", DATASETS.some((d) => /^volcanic-risk/.test(d.id)), false);
const panels = readFileSync(new URL("./catalogue-panels.js", import.meta.url), "utf8");
check("both sheets are TILED rows under the volcanic hazards home",
  /"volcanic-hazards": \["volcanic-risk", "volcanic-risk-holocene"\]\.map/.test(panels), true);
check("each carrying its working", /maths: mathsFor\(id\)/.test(panels), true);
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("a click on a sheet is offered to it before the dismissal",
  /GeoIDVolcanicRiskRaster\?\.probeAt\?\.\(at\.lat, at\.lon\)\) return;/.test(popup), true);
const raster = readFileSync(new URL("./volcanic-risk-raster.js", import.meta.url), "utf8");
check("the sheet is registered and then parented to the globe, the drape's own frame",
  raster.indexOf("addDerivedLayer") < raster.indexOf("globe?.add?.(mesh)"), true);
check("a sheet that skips the depth test does not write it", /m\.depthTest === false\) m\.depthWrite = false/.test(raster), true);
for (const id of ["volcanic-risk", "volcanic-risk-holocene"]) {
  const m = mathsFor(id);
  check(`${id} states one kernel scale for every eruption`, /R = 100 km/.test(JSON.stringify(m.terms)), true);
  check(`${id} prints a band per VEI`, /λ_n\(p\)/.test(JSON.stringify(m.lines)), true);
}
check("the windowed ⓘ states the windows", /1550/.test(JSON.stringify(mathsFor("volcanic-risk").terms)), true);
check("and the full-record one its own denominator", /own record span/i.test(JSON.stringify(mathsFor("volcanic-risk-holocene").terms)), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`volcanic-risk: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
