/**
 * The volcanic risk maps: one scale, one grid per VEI played through the bar,
 * the card that reads a cell, and the entries that load them.
 */
import { readFileSync } from "node:fs";
import {
  riskEdges, RISK_LABELS, RETURN_PERIODS_YEARS, classOf, FRAME_VEIS, RECORDS,
  colourRange, riskLayer, bandOf,
} from "./volcanic-risk.js";
import { isVolcanicRiskFeature, volcanicRiskCard, returnPeriod, asPercent } from "./volcanic-risk-card.js";
import { epochsFor, noteFor, noteTitle, framePaint } from "./volcanic-risk-frames.js";
import { isRiskFeature } from "./cyclone-risk-card.js";
import { DATASETS } from "./global-data.js";
import { mathsFor } from "./equations.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── one scale ───────────────────────────────────────────────────────────── */
const edges = riskEdges();
check("an edge per period", edges.length, RETURN_PERIODS_YEARS.length);
check("one label more than the edges", RISK_LABELS.length, edges.length + 1);
check("an edge is 1 - exp(-1/T)", Number(edges[4].toFixed(6)), Number((1 - Math.exp(-1 / 100)).toFixed(6)));
check("the scale reaches one in 100,000 years, where the VEI 6 and 7 maps live", RETURN_PERIODS_YEARS[0], 100000);
check("nothing is not a class", classOf(0), -1);
check("1 in 476 years is the 1-in-1,000 class", RISK_LABELS[classOf(1 - Math.exp(-1 / 476))], "about 1 in 1,000 years");
check("the catalogue paint is the same scale", [colourRange().field, colourRange().edges.length, colourRange().labels.length], ["p_yr", 7, 8]);

/* ── frames: VEI 1-5 then the collective, all on that scale ─────────────── */
const epochs = epochsFor(47150);
check("eight VEI frames and the collective", epochs.map((e) => e.label), ["VEI 1", "VEI 2", "VEI 3", "VEI 4", "VEI 5", "VEI 6", "VEI 7", "VEI 8", "All"]);
check("an empty frame says why rather than counting nothing", noteFor({ ...epochs[7], count: 0 }), "VEI 8 · none in the Holocene record");
check("and its title names the last of that size", /Toba/.test(noteTitle({ ...epochs[7], count: 0 })), true);
check("the collective is the terminal frame", epochs[epochs.length - 1].all, true);
check("FRAME_VEIS is 1 to 8", FRAME_VEIS, [1, 2, 3, 4, 5, 6, 7, 8]);
check("a frame's note counts its cells once known", noteFor({ ...epochs[2], count: 26428 }), "VEI 3 · 26,428 cells");
check("and says so while it is not", noteFor(epochs[2]), "VEI 3 · … cells");
check("the collective's note is the whole layer", noteFor(epochs[8]), "47,150 cells, every size");
const fp = framePaint([{ properties: { p_yr: 0.5 } }, { properties: { p_yr: 0.0001 } }], "vei3");
check("a frame's key is labelled for its VEI on the shared classes", [fp.legend.label, fp.legend.labels.length], ["Ashfall ≥ 1 mm from VEI 3 eruptions — per year", RISK_LABELS.length]);
check("and a cell with nothing keeps no colour", fp.colourFor({ properties: { p_yr: 0 } }), null);
check("the counts fall in the right classes whatever the frame's range", fp.legend.counts, [0, 0, 1, 0, 0, 0, 0, 1]);
check("so a colour means the same in every frame", fp.colourFor({ properties: { p_yr: 0.5 } }), `#${fp.legend.palette[7]}`);

/* ── the card reads a cell ───────────────────────────────────────────────── */
const cell = { i: 1, deg: 0.25, rate_yr: 0.1843, p_yr: 0.1683, vei0: 0, vei1: 0.069, vei2: 0.081, vei3: 0.034, vei4: 0, vei5: 4.3e-5, vei6: 0, vei7: 0, vei_max: 5, vents: 19, prior_only: 0 };
check("a volcanic cell is recognised", isVolcanicRiskFeature(cell), true);
check("and the cyclone test would claim it too, which is why the popup asks this one first", isRiskFeature(cell), true);
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("the popup tests the volcanic grid before the cyclone one",
  popup.indexOf("isVolcanicRiskFeature(props)") > 0 && popup.indexOf("isVolcanicRiskFeature(props)") < popup.indexOf("isRiskFeature(props)"), true);
const card = volcanicRiskCard(cell);
check("the collective's title carries the chance", card.title, "1 in 5.4 years · 17% a year");
check("every size with a rate is a row, largest first", card.headline.filter(([k]) => /^VEI \d$/.test(k)).map(([k]) => k), ["VEI 5", "VEI 3", "VEI 2", "VEI 1"]);
check("a frame cell is titled for its band", volcanicRiskCard({ deg: 1, rate_yr: 4.3e-5, p_yr: 4.3e-5, vei_max: 5 }, { band: "vei5" }).kicker, "Volcanic risk — VEI 5 (windowed record)");
check("the full record says so", /full Holocene/.test(volcanicRiskCard(cell, { full: true }).kicker), true);
check("a prior-only cell names its basis", volcanicRiskCard({ ...cell, prior_only: 1 }).headline.some(([k, v]) => k === "Basis" && /floor prior/.test(v)), true);
check("return periods", [returnPeriod(1 / 11700), returnPeriod(0.9), returnPeriod(3)], ["1 in 11,700 years", "about one a year", "3.0 a year"]);
check("percent keeps digits where small", [asPercent(0.1683), asPercent(4.3e-5)], ["17%", "0.0043%"]);
const held = [{ name: "Volcanic risk (windowed record, Smithsonian GVP)", features: [{ properties: cell }] },
  { name: "Volcanic risk by VEI — full Holocene record", volcanicRecord: "volcanic-risk-holocene", volcanicBand: "vei4", features: [{ properties: { p_yr: 1 } }] }];
check("a collective cell reads as its record, band any", bandOf(cell, held), { id: "volcanic-risk", band: "any", full: false });
check("a plot cell reads as its frame's band and record", bandOf(held[1].features[0].properties, held), { id: "volcanic-risk-holocene", band: "vei4", full: true });
check("each record's layer is found by its own name", [riskLayer("volcanic-risk", held)?.name === held[0].name, riskLayer("volcanic-risk-holocene", held)], [true, null]);

/* ── the entries ─────────────────────────────────────────────────────────── */
const entries = DATASETS.filter((d) => RECORDS[d.id]);
check("both records are catalogue entries in the volcanic hazards home", entries.map((e) => e.home), ["volcanic-hazards", "volcanic-hazards"]);
check("each names the collective file", entries.map((e) => e.path), ["/data/global/volcanic-risk.geojson", "/data/global/volcanic-risk-holocene.geojson"]);
check("each layer name matches the module's pattern", entries.every((e) => RECORDS[e.id].name.test(e.name)), true);
check("each opens the bar on tick", entries.every((e) => typeof e.animation?.open === "function"), true);
check("and paints on the shared scale", entries.every((e) => e.colourRange?.field === "p_yr" && e.colourRange.edges.length === 7), true);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page loads the scale and the frames", /gis\/volcanic-risk\.js\?v=/.test(html) && /gis\/volcanic-risk-frames\.js\?v=/.test(html), true);
for (const id of Object.keys(RECORDS)) {
  const m = mathsFor(id);
  check(`${id} states the reach per VEI and its spread`, /5 km at VEI 1/.test(JSON.stringify(m.terms)) && /σ = 0\.5/.test(JSON.stringify(m.terms)), true);
  check(`${id} names the threshold`, /1 mm/.test(JSON.stringify(m.lines)), true);
  check(`${id} says one grid per VEI`, /one-grid-per-VEI|ONE GRID PER VEI/.test(m.note), true);
}

const frames = readFileSync(new URL("./volcanic-risk-frames.js", import.meta.url), "utf8");
check("the collective's key is withheld while a frame is up", /layer\.legendHidden = !whole;/.test(frames), true);
check("and given back when the bar closes", /back\.legendHidden = false;/.test(frames), true);
check("a frame's count is written back into the note once fetched", /note\.textContent = noteFor\(epochs\[index\]\)/.test(frames), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`volcanic-risk: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
