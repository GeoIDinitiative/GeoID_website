#!/usr/bin/env node
/**
 * HIDING A MAGNITUDE BAND MUST NOT MOVE THE OTHERS.
 * Run: node GeoID_GIS/viewer/gis/seismic-magnitude.test.mjs
 *
 * The filter itself is one line of arithmetic. What is worth pinning is
 * everything around it, because each of these fails SILENTLY — a plausible
 * map under a plausible key, in the wrong colours:
 *
 * - a class outside the filtered range being dropped, which respreads the ramp;
 * - a label list keyed by index rather than by the class's own floor;
 * - a repaint through the ordinary symbology path, which reclassifies;
 * - the animation going on playing frames cut from a set the layer no longer
 *   holds.
 *
 * IDIOM, because this tree has two other `check` signatures and writing one
 * file's into another passes without running the body: here it is
 * `check(name, got, want)` and `ok(name, condition)`. The verdict is in an
 * exit hook, so a check appended anywhere still counts.
 */
import { readFileSync } from "node:fs";
import {
  MAG_EDGES, MAG_LABELS, MAG_FLOORS, magOf, bandOf, bandSymbology, bandRows,
  keptFeatures, describeFilter,
} from "./seismic-magnitude.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};
const ok = (name, cond) => check(name, Boolean(cond), true);
const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
/* Prose is not code: a note explaining a trap names the very call it warns
   about, and a scan that reads comments finds the warning and calls it the
   fault. */
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ev = (mag, extra = {}) => ({ properties: { mag_best: mag, ...extra } });

/* ── which band an event is in ────────────────────────────────────────────── */
check("the bands are a class per magnitude unit", [MAG_EDGES, MAG_FLOORS], [[5, 6, 7, 8], [0, 5, 6, 7, 8]]);
check("an event below 5 is the half class at the foot", bandOf({ mag_best: 4.7 }), 0);
check("a boundary belongs to the class it opens", [bandOf({ mag_best: 5 }), bandOf({ mag_best: 6 }), bandOf({ mag_best: 7 }), bandOf({ mag_best: 8 })], [1, 2, 3, 4]);
check("and everything above the top edge is M 8+", bandOf({ mag_best: 9.55 }), 4);
/* ISC-GEM's homogenised Mw is what the map is drawn on: about 82% of modern
   ComCat at this threshold is body-wave mb, which saturates near 6, so the raw
   number puts an event a band low. */
check("the band reads the resolved magnitude, not the raw one",
  [bandOf({ mag: 5.9, mag_best: 6.4 }), bandOf({ mag: 5.9 })], [2, 1]);
check("an event with no magnitude is in no band", bandOf({ place: "somewhere" }), null);
check("magOf prefers ISC-GEM and falls back", [magOf({ mag: 5.2, mag_best: 6.1 }), magOf({ mag: 5.2 }), magOf({})], [6.1, 5.2, null]);

/* ── the palette is PINNED, which is the whole point ──────────────────────── */
const everything = [4.6, 5.4, 6.2, 7.1, 8.8].map((m) => magOf({ mag_best: m }));
const noBigOnes = [4.6, 5.4, 6.2].map((m) => magOf({ mag_best: m }));
const one = [magOf({ mag_best: 6.2 })];
const rowsOf = (v) => bandSymbology(v).rows;
check("five classes, whatever the values hold", [rowsOf(everything).length, rowsOf(noBigOnes).length, rowsOf(one).length, rowsOf([]).length], [5, 5, 5, 5]);
check("and the colours do not move between them",
  [rowsOf(noBigOnes).map((r) => r.colour), rowsOf(one).map((r) => r.colour)],
  [rowsOf(everything).map((r) => r.colour), rowsOf(everything).map((r) => r.colour)]);
check("labelled by the class's own floor", rowsOf(noBigOnes).map((r) => r.label), MAG_LABELS);
/* The rows are the scale; the counts are this set. A row of zero is a band
   nothing fell in, not a band that does not exist. */
check("the counts are the values' own", rowsOf(everything).map((r) => r.count), [1, 1, 1, 1, 1]);
check("an empty band counts zero rather than vanishing", rowsOf(noBigOnes).map((r) => r.count), [1, 1, 1, 0, 0]);
check("a boundary value is counted in the class it opens", rowsOf([5, 6, 7, 8]).map((r) => r.count), [0, 1, 1, 1, 1]);
check("and the top class is inclusive at both ends", rowsOf([8, 9.55]).map((r) => r.count)[4], 2);
check("a row carries the colour, the label and the count",
  bandRows([ev(6.2), ev(6.9)]).map(({ label, count }) => [label, count]),
  [["M 4.5–4.9", 0], ["M 5–5.9", 0], ["M 6–6.9", 2], ["M 7–7.9", 0], ["M 8+", 0]]);
ok("and its colour is a hex the swatch can wear", /^#[0-9a-f]{6}$/i.test(bandRows([ev(6.2)])[0].colour));

/* ── the filter ───────────────────────────────────────────────────────────── */
const record = [ev(4.6), ev(4.9), ev(5.4), ev(6.2), ev(7.1), ev(8.8), { properties: { place: "no magnitude" } }];
check("nothing off keeps everything", keptFeatures(record, new Set()).length, record.length);
check("a band off drops exactly its own", keptFeatures(record, new Set(["0"])).length, 5);
check("two bands off drop both", keptFeatures(record, new Set(["0", "4"])).length, 4);
/* An event with no magnitude is in no band, so no tick is a statement about
   it — dropping it would make the ticks quietly delete data none of them
   names. */
check("an event with no magnitude survives every filter",
  keptFeatures(record, new Set(["0", "1", "2", "3", "4"])).map((f) => f.properties.place), ["no magnitude"]);
check("the filter does not touch the master list", record.length, 7);

/* ── the panel says what is drawn, rather than leaving it to be inferred ──── */
check("everything shown", describeFilter(record, new Set()), "7 earthquakes — every magnitude shown.");
ok("a filtered set counts what is drawn against what is held",
  /^5 of 7 drawn — M 4\.5–4\.9 hidden\.$/.test(describeFilter(record, new Set(["0"]))));
ok("and every band off says so plainly",
  /^Nothing drawn/.test(describeFilter([ev(6)], new Set(["2"]))));

/* ── wired, and wired the one way that keeps the colours still ────────────── */
{
  const panels = code("catalogue-panels.js");
  ok("the panel draws the bands", /function drawSeismicBands\(\)/.test(panels));
  ok("and draws them on every catalogue pass", /drawAll\(\)[\s\S]{0,200}drawSeismicBands\(\);/.test(panels));
  /* ONE implementation for both toggle lists. A second copy is where the
     fixed-lookup rule goes to be forgotten -- it is the part that looks like
     an optimisation and is the part that keeps the map honest. */
  ok("both toggle lists filter through the one helper",
    (panels.match(/applyClassFilter\(/g) || []).length >= 3);
  ok("and draw their rows through the one builder",
    (panels.match(/drawClassRows\(/g) || []).length >= 3);
  /* The seismic repaint must take its colour from the PINNED symbology and
     never from the layer's own classing. */
  const band = panels.slice(panels.indexOf("function applySeismicBands"));
  ok("the seismic repaint reads the pinned rows", /sym\.rows\[band\]/.test(band.slice(0, 900)));
  ok("and nothing in the panel reclassifies a filtered layer",
    !/paintByRange|categoricalSymbology/.test(panels));
}
{
  const tl = code("seismic-timelapse.js");
  ok("the frames take the pinned symbology", /bandSymbology\(/.test(tl));
  ok("and no longer classify the frame's own values", !/buildSymbology\(/.test(tl));
  /* A frame is built from `layer.features`, which the panel has already
     filtered; without the rebuild the bar plays frames cut from a set the
     layer no longer holds. */
  ok("a magnitude tick rebuilds the sequence", /seismic-mag-/.test(tl));
  ok("under the hold, so the rebuild does not read as a dismissal",
    /GeoIDAnimatedLayers\?\.hold/.test(tl));
  ok("and every band off is its own sentence, not 'tick the catalogue on'",
    /Every magnitude is switched off/.test(tl));
}
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  ok("the ticks have a host inside the record's own settings drawer",
    /id="seismic-timelapse"[\s\S]*?id="seismic-magnitudes"[\s\S]*?<\/div>\s*<\/details>/.test(html));
  ok("and a status line under them", /id="seismic-magnitudes-status"/.test(html));
}

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`seismic-magnitude: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
