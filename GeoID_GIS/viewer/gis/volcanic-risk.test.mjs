/**
 * The volcanic risk map: its classes, its three readings, and the card that
 * must not be mistaken for a cyclone's.
 */
import { readFileSync } from "node:fs";
import {
  riskEdges, RISK_LABELS, RETURN_PERIODS_YEARS, VIEWS, VEI_COLOURS,
  frequencyPaint, magnitudePaint, paintFor, riskLayer, LAYER_NAMES, TEPHRA_EDGES, TEPHRA_LABELS,
} from "./volcanic-risk.js";
import {
  isVolcanicRiskFeature, volcanicRiskCard, returnPeriod, asPercent, asVolume,
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
check("an edge is 1 - exp(-1/T)", Number(edges[3].toFixed(6)), Number((1 - Math.exp(-1 / 100)).toFixed(6)));
// The tails of the kernel put most of the map below one in a thousand years,
// so the bottom of the scale has to keep resolving there.
check("the scale reaches one in ten thousand years", RETURN_PERIODS_YEARS[0], 10000);
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

/* ── the full-record layer: its own file, its own views, the same module ─── */
const full = DATASETS.find((d) => d.id === "volcanic-risk-holocene");
check("the full-record map is its own entry in the same home", full?.home, "volcanic-hazards");
check("opening on magnitude × frequency", full?.views?.options?.[0]?.id, "tephra");
check("and its views are keyed by its own id", /volcanic-risk-holocene/.test(String(full?.views?.apply)), true);
// Two layers, one module: each is found by its own name, so a view set on one
// cannot repaint the other.
const held = [{ name: "Volcanic risk (Smithsonian GVP eruption record)", features: [] },
  { name: "Volcanic risk (full Holocene record, Smithsonian GVP)", features: [] }];
check("the windowed layer is found by its name", riskLayer(held).name, held[0].name);
check("and the full-record one by its own", riskLayer(held, "volcanic-risk-holocene").name, held[1].name);
check("the two entries' layer names match the module's patterns",
  [LAYER_NAMES["volcanic-risk"].test(entry.name.replace(/\.geojson$/, "")),
    LAYER_NAMES["volcanic-risk-holocene"].test(full.name.replace(/\.geojson$/, ""))], [true, true]);
check("tephra classes are orders of magnitude, one label more than edges",
  [TEPHRA_EDGES.every((e, i) => i === 0 || e === TEPHRA_EDGES[i - 1] * 10), TEPHRA_LABELS.length], [true, TEPHRA_EDGES.length + 1]);
const withTephra = cells.map((c) => ({ properties: { ...c.properties, tephra_m3_yr: [8.3e7, 6.3e6, 0][c.properties.i] } }));
const tp = frequencyPaint(withTephra, { view: "tephra" });
check("the tephra view cuts on its own edges and labels", tp.legend.labels, [VIEWS.tephra.noneLabel, ...TEPHRA_LABELS.filter((_, i) => tp.legend.labels.includes(TEPHRA_LABELS[i]))]);
check("a cell with no tephra keeps no colour", tp.colourFor(withTephra[2]), null);
const fullCard = volcanicRiskCard(withTephra[0].properties, { view: "tephra", full: true });
check("the tephra card titles by volume", fullCard.title, "83 million m³ a year");
check("and says which record it is", /full Holocene/.test(fullCard.kicker) && /9700 BCE/.test(fullCard.meta), true);
const priorCard = volcanicRiskCard({ ...cells[2].properties, prior_only: 1 });
check("a cell only a floor prior reaches says so", priorCard.headline.some(([k, v]) => k === "Basis" && /floor prior/.test(v)), true);
check("and one the record reaches does not", volcanicRiskCard(cells[0].properties).headline.some(([k]) => k === "Basis"), false);
check("the ⓘ states the kernel and the priors", [/exp\(−d\/R\)/.test(JSON.stringify(mathsFor("volcanic-risk").terms)), /floor prior/.test(JSON.stringify(mathsFor("volcanic-risk-holocene").terms))], [true, true]);
check("volumes read in words", [asVolume(2.51e6), asVolume(9210), asVolume(0)], ["2.51 million m³ a year", "9,210 m³ a year", null]);
check("the ⓘ states the record span rule", /own record span/i.test(JSON.stringify(mathsFor("volcanic-risk-holocene").terms)), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`volcanic-risk: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
