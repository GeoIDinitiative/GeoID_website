/**
 * AN EARTHQUAKE'S CARD: the magnitude and the year, first.
 * Run: node GeoID_GIS/viewer/gis/earthquake-card.test.mjs
 *
 * IDIOM: `check(name, got, want)` COMPARES; `ok(name, cond)` asserts.
 */
import { readFileSync } from "node:fs";
import { isEarthquakeFeature, earthquakeCard, yearOf, magnitudeText } from "./earthquake-card.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};
const ok = (name, cond) => check(name, Boolean(cond), true);

const KANTO = {
  mag: 7.9, magType: "mw", mag_best: 7.94, mw: 7.94, time: Date.UTC(1923, 8, 1, 2, 58, 32),
  year: 1923, place: "near Tokyo, Japan", id: "iscgem911526", depth_km: 15,
};
const MB = { mag: 5.2, magType: "mb", mag_best: 5.2, time: Date.UTC(2016, 5, 3, 4, 5, 6), year: 2016,
  place: "22 km SSE of Somewhere", id: "us10005abc", depth_km: 410 };
const HIST = { mag: 7.0, magType: "s", mag_best: 7.0, time: Date.UTC(1008, 3, 27), year: 1008,
  place: "Dinavar", id: "ghec6849", historical: 1 };

/* ── recognised, and NOT confused with its neighbours ─────────────────────── */
ok("an event of the merged record is recognised", isEarthquakeFeature(KANTO));
ok("and a historical one", isEarthquakeFeature(HIST));
/* `mag_best` is the discriminator: a risk CELL carries mag_max and rates, and
   the live USGS feed carries `mag` but never `mag_best` — its events have their
   own card with a seismogram on it. */
check("a risk cell is not an earthquake",
  isEarthquakeFeature({ p_yr: 0.1, rate_yr: 0.1, deg: 2, mag_max: 8.8 }), false);
check("nor a live-feed event", isEarthquakeFeature({ mag: 6.1, magType: "mww", time: 1 }), false);
check("nor a bare point", isEarthquakeFeature({ name: "somewhere" }), false);

/* ── the title leads with what the click was for ──────────────────────────── */
check("the magnitude and the year are the title", earthquakeCard(KANTO).title, "M 7.9 — 1923");
check("the place is the line under it", earthquakeCard(KANTO).meta, "near Tokyo, Japan");
check("and the kicker says what it is", earthquakeCard(KANTO).kicker, "EARTHQUAKE");
check("a historical one says so", earthquakeCard(HIST).kicker, "HISTORICAL EARTHQUAKE");
/* One decimal, never two: the map is drawn on a magnitude the reach model can
   only resolve to about half a unit anyway. */
check("the magnitude reads at one decimal", magnitudeText({ mag_best: 7.94 }), "M 7.9");
check("the year falls back to the instant", yearOf({ time: Date.UTC(1994, 0, 2) }), 1994);
check("and is null when there is neither", yearOf({}), null);
check("a card with neither still has a title", earthquakeCard({ mag_best: 6 }).title, "M 6.0");

/* ── which magnitude is being shown, and both where they differ ───────────── */
const row = (card, key) => (card.headline.find(([k]) => k === key) || [])[1];
ok("ISC-GEM's Mw is named as ISC-GEM's", /Mw 7\.94 — ISC-GEM/.test(row(earthquakeCard(KANTO), "Magnitude")));
/* ComCat's own is shown only where it DISAGREES: repeating 7.9 against 7.94 is
   a row that says nothing. */
check("ComCat's own is withheld when it agrees", row(earthquakeCard(KANTO), "ComCat's own"), undefined);
check("and shown when it does not",
  row(earthquakeCard({ ...KANTO, mag: 7.1 }), "ComCat's own"), "7.1 mw");
/* 82% of modern ComCat at this threshold is body-wave mb, which saturates near
   6 — a card showing one number without saying which scale it is on hides the
   most consequential thing about this record. */
ok("an mb magnitude says what mb is", /saturates near 6/.test(row(earthquakeCard(MB), "Magnitude")));
check("and the ISC-GEM row is absent when it does not reach",
  row(earthquakeCard(MB), "ComCat's own"), undefined);

/* ── the date, and no clock on a historical one ───────────────────────────── */
ok("an instrumental event carries its time", /UTC$/.test(row(earthquakeCard(KANTO), "When")));
/* GEM gives a year and often a month and day; where its source gave neither the
   bake wrote 1 January, so a clock against a 1008 event is a time nobody
   recorded dressed as a reading. */
ok("a historical one does not", !/UTC$/.test(row(earthquakeCard(HIST), "When")));
ok("and says the date is the record's", /as the historical record gives it/.test(row(earthquakeCard(HIST), "When")));
check("depth is banded", row(earthquakeCard(MB), "Depth"), "410.0 km — deep");
check("and shallow is named too", row(earthquakeCard(KANTO), "Depth"), "15.0 km — shallow");
ok("the catalogue is named", /ISC-GEM/.test(row(earthquakeCard(KANTO), "Catalogue")));
ok("a historical card cites GEM", /GHEC|Historical Earthquake Catalogue/.test(earthquakeCard(HIST).source));
ok("and states the share-alike licence", /CC BY-SA 3\.0/.test(earthquakeCard(HIST).source));
ok("an instrumental card states the public domain one", /public domain/.test(earthquakeCard(MB).source));

/* ── wired into the click path, ahead of the generic card ─────────────────── */
{
  const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
  ok("built from the feature", /isEarthquakeFeature\(props\)\n?\s*\? earthquakeCard\(props\) : null/.test(popup));
  ok("and mapped ahead of the rock card", /const feature = quake \? \{/.test(popup));
  /* `soil: true` is the established seam for "this card wrote its own lines":
     it is what stops earth-viewer re-deriving CONTINENTAL from the elevation
     and what keeps the rock-property fold off a point made of nothing. */
  const branch = popup.slice(popup.indexOf("const feature = quake ? {"));
  ok("declaring that it wrote its own lines", /soil: true/.test(branch.slice(0, 400)));
  ok("and leaving the lithology null", /lithology: null/.test(branch.slice(0, 500)));
}

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`earthquake-card: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
