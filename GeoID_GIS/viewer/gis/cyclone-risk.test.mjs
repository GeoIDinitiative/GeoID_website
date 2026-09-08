/**
 * The cyclone risk map's arithmetic, and the two claims it must never make.
 *
 * Every check here is about the DIFFERENCE between a rate and a count, and
 * between a value measured at a point and one averaged over a cell. Both are
 * the kind of error that draws a perfectly plausible map.
 */
import { readFileSync } from "node:fs";
import {
  riskEdges, RETURN_PERIODS_YEARS, RISK_LABELS, COUNT_EDGES,
  countsFor, seasonsIn, seasonNote, seasonPaint,
} from "./cyclone-risk.js";

let pass = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}
function near(name, got, want, tol = 1e-9) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (ok) pass += 1;
  else failures.push(`${name}\n     got  ${got}\n     want ${want} (+-${tol})`);
}

/* ── the edges ARE the return periods ───────────────────────────────────── */
// P = 1 - exp(-1/T) is the Poisson chance of at least one arrival in a year at
// a rate of one per T years. If this drifts, the key says "1 in 10 years" over
// a class that is not that.
const edges = riskEdges();
check("one edge per named return period", edges.length, RETURN_PERIODS_YEARS.length);
near("1 in 10 years", edges[0], 1 - Math.exp(-1 / 10));
near("1 in 2 years", edges[2], 1 - Math.exp(-1 / 2));
near("1 a year", edges[3], 1 - Math.exp(-1));
check("edges rise", edges.every((v, i) => i === 0 || v > edges[i - 1]), true);
check("every edge is a probability",
  edges.every((v) => v > 0 && v < 1), true);
// A class list is one longer than its edges, and every one needs a word or the
// key falls back to bounds for the class it is missing.
check("a label for every class", RISK_LABELS.length, edges.length + 1);

/* ── a count is not a probability ───────────────────────────────────────── */
// The season classes are half-integers because a coarsened cell's value is a
// mean of integers. 0.5 is what separates "no storm" from "one".
check("count edges are half-integers",
  COUNT_EDGES.every((v) => Math.abs(v % 1) === 0.5), true);
check("the first count edge separates none from one", COUNT_EDGES[0], 0.5);

/* ── reading the sparse per-season file ─────────────────────────────────── */
const payload = {
  _source: { partial: 2026 },
  years: {
    1980: { 3: 1, 7: 2.5 },
    1981: { 3: 1 },
    2026: { 9: 1 },
  },
};
check("seasons come back in order", seasonsIn(payload), [1980, 1981, 2026]);
const c80 = countsFor(payload, 1980);
check("counts read by cell index", [...c80.entries()], [[3, 1], [7, 2.5]]);
check("a season string or number both answer",
  [...countsFor(payload, "1980").keys()], [3, 7]);
// ABSENT IS A REAL ZERO, not a gap: the file lists only the cells a season
// reached. A caller that cannot tell the two apart paints empty ground as
// though a storm crossed it, which is the one error a season map cannot take.
check("a cell the season never reached is absent, not zero", c80.has(4), false);
check("a season the file does not hold answers null",
  countsFor(payload, 1999), null);

/* ── the note says COUNT, and says when the year is unfinished ──────────── */
const note = seasonNote(1980, c80, 10, 2026);
check("the note counts cells reached", note.includes("2 of 10"), true);
check("the note says storms, never a chance",
  /storms within 200 km/i.test(note) && !/chance|probab/i.test(note), true);
check("an unfinished season says so",
  seasonNote(2026, countsFor(payload, 2026), 10, 2026).includes("still in progress"),
  true);
check("a finished one does not",
  note.includes("still in progress"), false);

/* ── a season's key must account for every cell it draws ────────────────── */
// Half the map is ground the record covers and this season did not, drawn in
// the app's NO-VALUE grey -- which everywhere else means "not measured" and
// here means "measured, and zero". Measured on 2005: 43,039 of 91,156 cells.
// A colour carrying half a map under a key that does not mention it is the
// legend saying something false by omission.
const paint = seasonPaint(new Map([[1, 1], [2, 3]]), 1992, 10);
check("the none row leads the key", paint.legend.labels[0], "no storm that season");
check("and wears the colour an unpainted cell actually takes",
  paint.legend.palette[0], "8a8a8a");
check("and counts the cells in it", paint.legend.counts[0], 8);
check("its bounds are a zero, not a range", paint.legend.bounds[0], ["0", "0"]);
check("the classes read as counts, not as bounds",
  paint.legend.labels.slice(1, 3), ["1 storm across part of the cell", "about 1 storm"]);
check("every class has a swatch",
  paint.legend.palette.length, paint.legend.labels.length);
check("and a count", paint.legend.counts.length, paint.legend.labels.length);
// A cell the season never reached takes NO colour. The bottom class is a
// storm, so painting an empty cell with it would put a storm on ground that
// had none -- which is the whole subject of a season map.
check("an unreached cell keeps no colour",
  paint.colourFor({ properties: { i: 5 } }), null);
check("a reached one does",
  typeof paint.colourFor({ properties: { i: 1 } }), "string");
// A COARSENED cell one storm clipped averages under one. Rounding that down to
// "none" would be the map losing a storm the record holds.
check("a fractional count is a class, not a nothing",
  typeof seasonPaint(new Map([[1, 0.06], [2, 2]]), 1992, 4)
    .colourFor({ properties: { i: 1 } }), "string");

/* ── the BAKE's own gate, pinned on its source ──────────────────────────── */
// The quadtree's flatness test has to refuse a block that is empty in part,
// and no amount of arithmetic in this file can check that -- the shipped
// GeoJSON is published to the bucket and is not on a fresh clone's disk. What
// IS checkable is that the gate is still written. Measured before it existed:
// 177 cells of 2 degrees and up claiming rates down to "once every 3,623
// years", which is one lattice point's rate divided by the thousand beside it
// that no storm ever reached -- the cell-size dependence the whole design is
// against, reappearing at the sparse end.
const bake = readFileSync(
  new URL("../../services/bake-cyclone-risk.py", import.meta.url), "utf8");
check("the bake refuses a block that is empty in part",
  /if\s+lo\s*==\s*0\s+and\s+hi\s*>\s*0:\s*\n\s*return False/.test(bake), true);
check("and applies it to BOTH fields, not the storm rate alone",
  /flat\(rate,[\s\S]{0,80}flat\(rate_hur,/.test(bake), true);
// A partial season divided into a full window understates every cell.
check("the climatology excludes the season in progress",
  /complete\s*=\s*\[y for y in seasons if y != partial\]/.test(bake), true);
// The disc is in KILOMETRES. A fixed column count would be 200 km at the
// equator, 100 at 60 degrees and meaningless at the pole.
check("the disc is solved on the sphere, not flat",
  /math\.asin\(s\)/.test(bake) && /hav_r\s*-\s*hav_lat/.test(bake), true);
// A cell is in the disc when its CENTRE is inside. Rounding outward adds a
// cell and a half of reach -- 240 km under a layer claiming 200.
check("and floors rather than rounding the radius outward",
  /math\.floor\(dlon \/ STEP\)/.test(bake), true);

/**
 * THE VERDICT IS REPORTED ON EXIT, not at the bottom of the file.
 *
 * A verdict written inline is only correct while it is the last statement, and
 * this tree has lost checks to that twice -- `event-sources.test.mjs` had 89 of
 * them printed and discarded because a later edit put the summary a third of
 * the way down, and `geoprocessing.test.mjs` calls process.exit and silently
 * skips whatever follows. Both were caught by an A/B rather than by reading.
 *
 * Deferring to the exit hook makes the ordering stop mattering: a check
 * appended anywhere, by anyone, still counts. Verified by the same A/B -- a
 * deliberate failure appended after this block exits 1.
 */
process.on("exit", () => {
  if (failures.length) {
    console.log(`✗  cyclone-risk.test.mjs  —  ${pass} passed, ${failures.length} FAILED`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  cyclone-risk.test.mjs  —  ${pass} passed`);
  }
});
