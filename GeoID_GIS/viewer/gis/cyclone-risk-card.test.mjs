/**
 * The risk cell's card: the number in the title, and the two things a chance
 * is meaningless without.
 */
import { readFileSync } from "node:fs";
import {
  isRiskFeature, riskCard, returnPeriod, asPercent,
} from "./cyclone-risk-card.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── it recognises its own cells and nothing else ────────────────────────── */
const cell = { i: 10016, deg: 4, rate_yr: 0.0758, p_yr: 0.073,
  rate_hur_yr: 0, p_hur_yr: 0 };
check("a risk cell is recognised", isRiskFeature(cell), true);
check("a rock is not", isRiskFeature({ lith: "granite" }), false);
check("nor a soil unit", isRiskFeature({ unit: "Af", group: "Acrisols" }), false);
// Every one of the three is needed: a layer carrying only p_yr is not this grid.
check("nor a feature with only part of the shape",
  isRiskFeature({ p_yr: 0.5 }), false);

/* ── THE NUMBER IS THE TITLE ─────────────────────────────────────────────── */
// It was four rows down as `p_yr`, under a heading reading "OCEANIC" and a
// title reading "Mapped area" -- the one thing anybody clicked for, filed
// among the column names.
const card = riskCard(cell);
check("the title carries the chance", card.title, "1 in 13 years · 7.3% a year");
check("and the kicker says what kind of number it is",
  card.kicker, "Tropical cyclone risk");
// A chance with no radius and no window is not a chance.
check("the meta line carries the radius and the window",
  /200 km/.test(card.meta) && /1980/.test(card.meta), true);

/* ── said twice, because they are the same fact ──────────────────────────── */
// "1 in 13 years" is how a hazard is quoted; "7.3% a year" is what the map is
// coloured by. A reader with one and not the other cannot check the map
// against the key.
check("a return period", returnPeriod(0.0758), "1 in 13 years");
check("and one that has become annual reads as a rate", returnPeriod(3), "3.0 a year");
check("just under annual is not '1 in 1 years'", returnPeriod(0.9), "about one a year");
check("a rate of zero has no period", returnPeriod(0), null);
check("nor does a missing one", returnPeriod(undefined), null);
check("percent keeps a digit where the number is small", asPercent(0.073), "7.3%");
check("and rounds where it is not", asPercent(0.63), "63%");

/* ── never is not zero ───────────────────────────────────────────────────── */
// "0.0" is a measurement; "not once in the record" is what the file holds, and
// the difference matters most on the cells a reader checks because they were
// surprised.
const none = riskCard({ deg: 8, rate_yr: 0, p_yr: 0, rate_hur_yr: 0, p_hur_yr: 0 });
check("a cell it has never reached says so", none.title, "Not once on record");
check("rather than showing a zero", /0\.00/.test(none.headline[0][1]), false);

/* ── the hurricane view reads its own column ─────────────────────────────── */
const hur = riskCard({ deg: 1, rate_yr: 1.2, p_yr: 0.7, rate_hur_yr: 0.3,
  p_hur_yr: 0.26 }, { view: "hurricanes" });
check("the hurricane view is headed as one", hur.kicker, "Hurricane risk");
check("and titled from the hurricane column", hur.title.startsWith("1 in 3"), true);
// The reading NOT on screen is the obvious next question, so the card answers
// it rather than making somebody switch to find out.
check("with the other reading beside it", hur.headline[1][0], "Any tropical cyclone");

/* ── the cell's SIZE is on the card ──────────────────────────────────────── */
// The grid is variable, so a reader comparing two cells is entitled to know
// they are not the same patch of ground.
check("the cell says how big it is", card.headline[2][0], "Cell");
check("in degrees and on the ground", card.headline[2][1], "4° — about 444 km");

/* ── wired into the card builder, pinned on the source ───────────────────── */
// A card that exists in one of two builders is a card that does not exist --
// this tree's own lesson, paid for by the soil card.
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("the popup asks before falling through to the rock card",
  /isRiskFeature\(props\)/.test(popup), true);
check("and marks the card as already written, so nothing re-derives a heading",
  // Guarded by the ice and soil cards, and asked AFTER the volcanic grid,
  // whose cells carry the same three columns and would otherwise open here.
  /!ice && !soil && isRiskFeature\(props\)/.test(popup)
  && popup.indexOf("isVolcanicRiskFeature(props)") < popup.indexOf("isRiskFeature(props)"), true);

process.on("exit", () => {
  if (failures.length) {
    console.log(`✗  cyclone-risk-card.test.mjs  —  ${pass} passed, ${failures.length} FAILED`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  cyclone-risk-card.test.mjs  —  ${pass} passed`);
  }
});
