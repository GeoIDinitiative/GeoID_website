/**
 * The volcanic risk map: its classes, its three readings, and the card that
 * must not be mistaken for a cyclone's.
 */
import { readFileSync } from "node:fs";
import {
  riskEdges, RISK_LABELS, RETURN_PERIODS_YEARS, VIEWS, VEI_COLOURS,
  frequencyPaint, magnitudePaint, paintFor,
} from "./volcanic-risk.js";
import {
  isVolcanicRiskFeature, volcanicRiskCard, returnPeriod, asPercent,
} from "./volcanic-risk-card.js";
import { isRiskFeature } from "./cyclone-risk-card.js";
import { DATASETS } from "./global-data.js";
import { mathsFor } from "./equations.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── the classes are return periods, one more label than edges ───────────── */
const edges = riskEdges();
check("five edges for five periods", edges.length, RETURN_PERIODS_YEARS.length);
check("six labels, one more than the edges", RISK_LABELS.length, edges.length + 1);
check("an edge is 1 - exp(-1/T)", Number(edges[2].toFixed(6)), Number((1 - Math.exp(-1 / 100)).toFixed(6)));
check("and they rise with the rate", edges.every((e, i) => i === 0 || e > edges[i - 1]), true);

/* ── the fixture: three cells, one never reached by a large eruption ─────── */
const cells = [
  { properties: { i: 0, deg: 0.25, rate_yr: 0.0527, p_yr: 0.0513, rate_large_yr: 0.00009, p_large_yr: 0.00009, vei_max: 7, vents: 2, top_volcano: "Etna", top_eruptions: 40, top_vei_max: 4, top_rate_yr: 0.05 } },
  { properties: { i: 1, deg: 1, rate_yr: 0.0021, p_yr: 0.0021, rate_large_yr: 0.0021, p_large_yr: 0.0021, vei_max: 5, vents: 1, top_volcano: "Vesuvius", top_eruptions: 1, top_vei_max: 5, top_rate_yr: 0.0021 } },
  { properties: { i: 2, deg: 2, rate_yr: 0.013, p_yr: 0.0129, rate_large_yr: 0, p_large_yr: 0, vei_max: 2, vents: 1 } },
];

/* ── the frequency view classes the zeros OUT and names them ─────────────── */
const any = frequencyPaint(cells, { view: "ashfall" });
check("every cell takes a colour on the any-eruption view",
  cells.every((c) => any.colourFor(c)), true);
check("and the key has no 'none' row when nothing is zero",
  any.legend.labels[0], RISK_LABELS[0]);
const large = frequencyPaint(cells, { view: "large" });
check("a cell no large eruption reaches keeps no colour", large.colourFor(cells[2]), null);
check("and the key names it, leading", large.legend.labels[0], VIEWS.large.noneLabel);
check("with its count", large.legend.counts[0], 1);
check("so the key sums to the cells", large.legend.counts.reduce((a, b) => a + b, 0), cells.length);
check("Naples-like 1-in-476 lands in the 1-in-1,000 class",
  large.legend.labels[large.legend.palette.indexOf(large.colourFor(cells[1]).replace("#", ""))],
  "about 1 in 1,000 years");

/* ── the magnitude view is ORDINAL, painted in VEI order ─────────────────── */
const mag = magnitudePaint(cells);
check("one row per VEI present, in order", mag.legend.labels, ["VEI 2", "VEI 5", "VEI 7"]);
check("in the fixed VEI palette", mag.legend.palette, [VEI_COLOURS[2], VEI_COLOURS[5], VEI_COLOURS[7]]);
check("categorical and classed, so the dock draws rows", [mag.legend.categorical, mag.legend.classed], [true, true]);
check("paintFor routes the views", [paintFor(cells, "magnitude").legend.field, paintFor(cells, "large").legend.field], ["vei_max", "p_large_yr"]);

/* ── the card is not a cyclone's ─────────────────────────────────────────── */
// A volcanic cell carries the three columns the cyclone card recognises its
// own by, so BOTH tests say yes to it -- which is why feature-popup asks this
// one first, and why it is pinned there.
check("a volcanic cell is recognised", isVolcanicRiskFeature(cells[1].properties), true);
check("and the cyclone test would claim it too", isRiskFeature(cells[1].properties), true);
check("a cyclone cell is not volcanic", isVolcanicRiskFeature({ i: 1, deg: 1, rate_yr: 1, p_yr: 0.6, rate_hur_yr: 0, p_hur_yr: 0 }), false);
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("feature-popup tests the volcanic grid before the cyclone one",
  popup.indexOf("isVolcanicRiskFeature(props)") < popup.indexOf("isRiskFeature(props)")
  && popup.indexOf("isVolcanicRiskFeature(props)") > 0, true);

const card = volcanicRiskCard(cells[1].properties);
check("the title carries the chance", card.title, "1 in 476 years · 0.21% a year");
check("the kicker says what kind of number", card.kicker, "Volcanic ashfall risk");
check("the magnitude is a row", card.headline.some(([k, v]) => /Largest/.test(k) && v === "VEI 5"), true);
check("and the volcano behind it", card.headline.find(([k]) => /Contributing/.test(k))[1],
  "Vesuvius — 1 counted eruption, up to VEI 5, 1 in 476 years");
const magCard = volcanicRiskCard(cells[0].properties, { view: "magnitude" });
check("the magnitude view titles by VEI", magCard.title, "VEI 7 on record");
const never = volcanicRiskCard(cells[2].properties, { view: "large" });
check("never is not zero", never.title, "Not once on record");
check("return period formats thousands", returnPeriod(1 / 11700), "1 in 11,700 years");
check("percent keeps two digits under one", asPercent(0.0021), "0.21%");

/* ── the entry, and the working travels with it ──────────────────────────── */
const entry = DATASETS.find((d) => d.id === "volcanic-risk");
check("the entry is filed under the volcanic hazards home", entry?.home, "volcanic-hazards");
check("a view IS the colouring, so no colourRange beside it", entry?.colourRange, undefined);
check("three views", entry?.views?.options?.map((o) => o.id), ["ashfall", "large", "magnitude"]);
const maths = mathsFor("volcanic-risk");
check("the ⓘ prints the windows", /1550/.test(JSON.stringify(maths.terms)) && /1950/.test(JSON.stringify(maths.terms)), true);
check("and names the reach as schematic", /isotropic/.test(JSON.stringify(maths.terms)), true);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page loads the module", /gis\/volcanic-risk\.js\?v=/.test(html), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`volcanic-risk: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
