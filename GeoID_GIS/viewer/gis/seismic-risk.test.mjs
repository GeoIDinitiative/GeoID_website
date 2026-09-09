/**
 * The seismic hazard tab: the record, the frames on the shared driver, the
 * card, and the entries -- built the way the volcanic one is, by mechanism.
 */
import { readFileSync } from "node:fs";
import { BANDS, FRAME_BANDS, RECORD, SPEC, colourRange, riskLayer, noteFor } from "./seismic-risk.js";
import { specFor, epochsFor, framePaint, bandOf } from "./risk-frames.js";
import { isSeismicRiskFeature, seismicRiskCard } from "./seismic-risk-card.js";
import { isVolcanicRiskFeature } from "./volcanic-risk-card.js";
import { yearsIn, colouring, noteFor as yearNote, MAG_LABELS } from "./seismic-timelapse.js";
import { DATASETS, HOMES } from "./global-data.js";
import { mathsFor } from "./equations.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── the spec is on the shared driver ────────────────────────────────────── */
check("the seismic record is registered on the frames driver", specFor("seismic-risk")?.path === SPEC.path && specFor("seismic-risk")?.frames.length === 4, true);
check("four frames, M5 to M8+", FRAME_BANDS, ["m5", "m6", "m7", "m8"]);
const epochs = epochsFor(SPEC, 1000);
check("and the collective ends them", epochs.map((e) => e.label), ["M 5", "M 6", "M 7", "M 8+", "All"]);
check("the scale is the volcanic maps' own", SPEC.scale.labels.length, 8);
const fp = framePaint([{ properties: { p_yr: 0.5 } }, { properties: { p_yr: 0 } }], SPEC, "m7");
check("a frame's key is labelled for its magnitude, none row leading", [fp.legend.label, fp.legend.labels[0]], [BANDS.m7.label, SPEC.scale.noneLabel]);
check("nothing on record is not drawn", fp.colourFor({ properties: { p_yr: 0 } }), "transparent");
check("notes count cells", [noteFor({ ...epochs[2], count: 12 }), noteFor(epochs[4])], ["M 7 · 12 cells", "1,000 cells reached, every size"]);
check("the collective's paint is the shared scale", [colourRange().field, colourRange().edges.length], ["p_yr", 7]);

/* ── the card, and its place in the popup ────────────────────────────────── */
const cell = { i: 1, deg: 0.25, rate_yr: 0.0787, p_yr: 0.0757, m5: 0.019, m6: 0.016, m7: 0.026, m8: 0.018, mag_max: 9.1, quakes: 412, none: 0 };
check("a seismic cell is recognised", isSeismicRiskFeature(cell), true);
check("and is not mistaken for a volcanic one", isVolcanicRiskFeature(cell), false);
const card = seismicRiskCard(cell);
check("the title carries the chance", card.title, "1 in 13 years · 7.6% a year");
check("every magnitude with a rate is a row, largest first", card.headline.filter(([k]) => /^M \d/.test(k)).map(([k]) => k), ["M 8+", "M 7–7.9", "M 6–6.9", "M 5–5.9"]);
check("and the largest on record", card.headline.find(([k]) => /Largest/.test(k))[1], "M 9.1");
check("a frame cell is titled for its band", seismicRiskCard({ deg: 1, rate_yr: 0.018, p_yr: 0.018, mag_max: 9.1 }, { band: "m8" }).kicker, "Seismic risk — M 8+ (USGS ComCat, M ≥ 5 since 1900)");
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("the popup asks the seismic card before the volcanic and cyclone ones",
  popup.indexOf("isSeismicRiskFeature(props)") > 0 && popup.indexOf("isSeismicRiskFeature(props)") < popup.indexOf("isVolcanicRiskFeature(props)"), true);
const held = [{ name: "Seismic risk by magnitude", riskRecord: "seismic-risk", riskBand: "m7", features: [{ properties: cell }] }];
check("a plot cell reads as its frame's band", bandOf(cell, held).band, "m7");
check("the layer is found by its name", riskLayer([{ name: "Seismic risk (USGS ComCat, M ≥ 5 since 1900)", features: [] }])?.name, "Seismic risk (USGS ComCat, M ≥ 5 since 1900)");

/* ── the timeline ────────────────────────────────────────────────────────── */
const quakes = [{ properties: { year: 1964, mag: 9.2 } }, { properties: { year: 1964, mag: 5.1 } }, { properties: { year: 2011, mag: 9.1 } }, { properties: { year: 1906, mag: 7.9 } }];
check("years present, in order, from a span", yearsIn(quakes, 1964).map(([y, f]) => [y, f.length]), [[1964, 2], [2011, 1]]);
check("magnitude classes are fixed unit edges", colouring(quakes).legend.labels, MAG_LABELS);
check("a year's note is a counter with the largest", yearNote({ year: 1964, count: 2, total: 4, largest: 9.2 }), "2 / 4 · largest M 9.2");

/* ── the entries and the page ────────────────────────────────────────────── */
check("the seismic home has a host", HOMES.seismic, "seismic-catalogue");
const entries = DATASETS.filter((d) => d.home === "seismic").map((d) => d.id);
check("the record and the risk map live there", entries, ["earthquakes", "seismic-risk"]);
const quakesEntry = DATASETS.find((d) => d.id === "earthquakes");
check("the record docks its span under its row and opens the bar", [quakesEntry.settings, typeof quakesEntry.animation?.open], ["seismic-timelapse", "function"]);
check("the risk map's layer name matches the module's pattern", RECORD.name.test(DATASETS.find((d) => d.id === "seismic-risk").name), true);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page carries the subtab, its hosts and the modules",
  /id="seismic-catalogue"/.test(html) && /id="seismic-status"/.test(html) && /id="seismic-timelapse-span"/.test(html)
  && /gis\/seismic-risk\.js\?v=/.test(html) && /gis\/seismic-timelapse\.js\?v=/.test(html), true);
check("the live row is a proxy onto the past-week USGS feed", /data-feed-proxy="quakes-week"/.test(html), true);
check("the ⓘ states the reach and the windows", /0\.5 M − 1\.7/.test(JSON.stringify(mathsFor("seismic-risk").terms)) && /1964/.test(JSON.stringify(mathsFor("seismic-risk").terms)), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`seismic-risk: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
