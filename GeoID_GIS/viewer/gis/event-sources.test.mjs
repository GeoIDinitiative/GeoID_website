/**
 * The feed registry and its conversions.
 *
 * Everything here is a rule that fails SILENTLY on a map: a magnitude read
 * from the wrong field is null rather than an error, a time read in seconds
 * puts every earthquake in 1970 with the ordering intact, and a depth taken as
 * an elevation is a plausible number that means something else. So each is
 * pinned against a record shaped exactly like the one USGS serves.
 */

import {
  SOURCES, FEED_GROUPS, sourceById, sourcesInGroup, activeGroups, groupState,
  defaultEnabled, usgsPoints, magnitudeSize, recencyOpacity,
  MAGNITUDE_RAMP, magnitudeColour, restoreSources, gdacsPoints, gdacsUrl,
}  from "./event-sources.js";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`PASS ${name}`); } else {
    fail += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

const ok = (name, got) => check(name, Boolean(got), true);

/* ── the registry ─────────────────────────────────────────────────────────── */

check("every source has an id, a label and a licence",
  SOURCES.filter((s) => s.id && s.label && s.licence).length, SOURCES.length);
check("ids are unique", new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
check("every usgs source carries a url",
  SOURCES.filter((s) => s.kind === "usgs" && !s.url).length, 0);
check("sourceById finds one", sourceById("quakes-day")?.kind, "usgs");
check("sourceById refuses an unknown id", sourceById("nope"), null);
// The default must draw something: a mode that opens empty reads as broken.
ok("something is on by default", defaultEnabled().length > 0);
ok("seismicity is on by default", defaultEnabled().includes("quakes-day"));

/* ── the subsections ──────────────────────────────────────────────────────── */

check("every source names a group that exists",
  SOURCES.filter((s) => !FEED_GROUPS.some((g) => g.id === s.group)).length, 0);
// A group with no rows renders an empty fold, which reads as something broken
// rather than as something absent.
check("no group is declared and left empty", activeGroups().length, FEED_GROUPS.length);
check("every group carries a label and a note",
  FEED_GROUPS.filter((g) => g.label && g.note).length, FEED_GROUPS.length);
ok("seismicity holds the three USGS windows",
  sourcesInGroup("seismic").filter((s) => s.kind === "usgs").length === 3);
// Everything here HAPPENED, with a time and a place. Faults and plate
// boundaries were briefly rows in this list; they are permanent features of
// the ground, so they are vector layers like a coastline is, and they live in
// global-data.js under Tectonics with every other one.
check("nothing here is a standing feature rather than an event",
  SOURCES.filter((s) => !["eonet", "usgs"].includes(s.kind)).length, 0);
check("faults are not offered as a feed", sourceById("faults"), null);
check("nor are plate boundaries", sourceById("plates"), null);
check("every source names a category to colour and group by",
  SOURCES.filter((s) => !s.category).length, 0);
// EONET's own earthquakes category is empty almost always and would double
// every USGS event that it did carry, under a different id.
check("EONET earthquakes is not offered beside the USGS feeds",
  SOURCES.some((s) => s.kind === "eonet" && s.category === "earthquakes"), false);
check("wildfires are still offered",
  SOURCES.some((s) => s.kind === "eonet" && s.category === "wildfires"), true);

/* ── the master toggle's three states ─────────────────────────────────────── */

const seismic = sourcesInGroup("seismic").map((s) => s.id);
check("all on", groupState("seismic", (id) => seismic.includes(id)),
  { total: 3, on: 3, all: true, none: false, indeterminate: false });
check("all off", groupState("seismic", () => false),
  { total: 3, on: 0, all: false, none: true, indeterminate: false });
// The state that matters: a box showing "off" over a group with one of three
// rows on is saying something false about the map.
check("some on is neither", groupState("seismic", (id) => id === seismic[0]),
  { total: 3, on: 1, all: false, none: false, indeterminate: true });
check("an unknown group is empty rather than an error",
  groupState("nope", () => true), { total: 0, on: 0, all: false, none: true, indeterminate: false });

/* ── restoring a remembered choice ───────────────────────────────────────── */

/**
 * The bug this section exists for: EONET was ONE row (`"eonet"`) covering every
 * category, and splitting it into a row per category renamed that id out of
 * existence. A plain `filter(sourceById)` then dropped it, so anybody who had
 * used the mode before the split came back with the earthquakes and nothing
 * else — no error, the panel and the globe agreeing with each other and both
 * wrong.
 */
const eonetIds = SOURCES.filter((s) => s.kind === "eonet").map((s) => s.id);

check("nothing stored gives the defaults",
  [...restoreSources(null)].sort(), defaultEnabled().sort());
check("rubbish stored gives the defaults",
  [...restoreSources("wat")].sort(), defaultEnabled().sort());
check("a set that leaves nothing on gives the defaults, not an empty map",
  [...restoreSources(["gone", "also-gone"])].sort(), defaultEnabled().sort());
check("a current set is kept exactly",
  [...restoreSources(["quakes-day", "eonet-wildfires"])].sort(),
  ["eonet-wildfires", "quakes-day"]);
// The legacy id is EXPANDED, not dropped: it is a positive record of "show me
// EONET", and every category is what it meant.
const migrated = restoreSources(["eonet", "quakes-day"]);
check("the old one-row EONET becomes every category",
  eonetIds.every((id) => migrated.has(id)), true);
check("and the feeds beside it are untouched", migrated.has("quakes-day"), true);
check("the legacy id itself is not kept as a source", migrated.has("eonet"), false);
// NOT recovered: a set that simply lacks EONET rows is what switching them all
// off looks like, and putting them back would undo that by hand.
check("switching every EONET feed off is respected",
  [...restoreSources(["quakes-day", "quakes-week"])].sort(),
  ["quakes-day", "quakes-week"]);

/* ── the USGS conversion ──────────────────────────────────────────────────── */

const source = sourceById("quakes-day");
const feed = {
  features: [
    {
      id: "us7000abcd",
      geometry: { type: "Point", coordinates: [-117.5, 34.2, 12.34] },
      properties: {
        mag: 4.6, place: "10 km SW of Somewhere", time: 1745000000000,
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
        felt: 42, tsunami: 0, title: "M 4.6 - 10 km SW of Somewhere",
      },
    },
    // A real record with no determined magnitude.
    {
      id: "us7000efgh",
      geometry: { type: "Point", coordinates: [140.1, 35.6, 0] },
      properties: { mag: null, place: "Off Honshu", time: 1745000100000, tsunami: 1 },
    },
    // Rubbish that must not become a marker at 0°N 0°E.
    { id: "broken", geometry: { type: "Point", coordinates: [null, null] }, properties: {} },
    { id: "no-geometry", properties: { mag: 3 } },
  ],
};

const points = usgsPoints(feed, source);
check("unplaceable records are dropped, not defaulted", points.length, 2);

const [first, second] = points;
check("longitude is the FIRST coordinate", first.lon, -117.5);
check("latitude is the second", first.lat, 34.2);
// The trap: the third coordinate is a depth in km, not an elevation.
check("depth comes from the third coordinate", first.depthKm, 12.34);
check("magnitude is carried", first.magnitude, 4.6);
// Epoch MILLISECONDS. A thousandfold error orders correctly and dates wrongly.
check("time is kept in milliseconds", first.timeMs, 1745000000000);
check("the year is this century", new Date(first.timeMs).getUTCFullYear() > 2000, true);
check("the id is the USGS id, so feeds merge", first.id, "us7000abcd");
check("every point is filed under earthquakes", first.categoryId, "earthquakes");
check("the source is recorded on the point", first.sourceId, "quakes-day");
check("the detail line reads", first.detail, "M 4.6 · 12 km deep · 10 km SW of Somewhere");

check("a null magnitude is null, not zero", second.magnitude, null);
check("and it says so rather than printing M null",
  second.detail.startsWith("magnitude undetermined"), true);
check("tsunami is a flag, not a count", second.tsunami, true);
check("a missing title falls back to the place", second.title, "Off Honshu");

// A zero depth is a real reading — the surface — and must survive the guard
// that drops missing ones.
check("zero depth is kept", second.depthKm, 0);

check("an empty payload is an empty list", usgsPoints(null, source), []);
check("a payload with no features is too", usgsPoints({}, source), []);

/* ── marker size ──────────────────────────────────────────────────────────── */

const base = 6;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

check("no magnitude is the base size", magnitudeSize(null, base), base);
check("nothing is smaller than the base", magnitudeSize(1, base) >= base, true);
check("an M2.5 — the smallest the day feed publishes — IS the base",
  magnitudeSize(2.5, base), base);
check("nothing is more than four times it", magnitudeSize(9.5, base) <= base * 4, true);
check("and an M8.5 is exactly that", near(magnitudeSize(8.5, base), base * 4), true);
ok("bigger earthquakes are bigger", magnitudeSize(7, base) > magnitudeSize(4, base));

/**
 * The size law, which is the point of this function.
 *
 * Magnitude is logarithmic, so an even mapping is a fixed RATIO per magnitude
 * unit — a fixed number of pixels per unit spends the range on the difference
 * between an M2.5 and an M4 and has nothing left for M6 to M8. The chosen
 * compression is a doubling of width every three units.
 */
check("width doubles every three magnitude units",
  near(magnitudeSize(5.5, base) / magnitudeSize(2.5, base), 2), true);
check("and again for the next three",
  near(magnitudeSize(8.5, base) / magnitudeSize(5.5, base), 2), true);
// The ratio is the same wherever it is measured, which a linear law cannot do.
const ratios = [3, 4, 5, 6, 7].map((m) => magnitudeSize(m + 1, base) / magnitudeSize(m, base));
check("one step is one ratio, anywhere in the range",
  ratios.every((r) => near(r, ratios[0], 1e-12)), true);
check("that ratio is the cube root of two", near(ratios[0], 2 ** (1 / 3)), true);
// Monotonic across the whole usable range, or two bands could swap.
let monotone = true;
for (let m = 1; m < 9; m += 0.5) {
  if (magnitudeSize(m + 0.5, base) < magnitudeSize(m, base)) monotone = false;
}
check("size never falls as magnitude rises", monotone, true);
check("the base scales the whole curve", magnitudeSize(6, 12), magnitudeSize(6, 6) * 2);

/* ── magnitude as a colour ────────────────────────────────────────────────── */

const rgbOf = (hexColour) => [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));

check("the ramp is ordered by magnitude",
  MAGNITUDE_RAMP.every((s, i) => i === 0 || s.m > MAGNITUDE_RAMP[i - 1].m), true);
check("below the ramp takes its low end", magnitudeColour(0.5), magnitudeColour(2.0));
check("above it takes the high end", magnitudeColour(11), magnitudeColour(8.0));
// An undetermined magnitude is usually a small unreviewed event; painting it
// mid-ramp states something the record does not.
check("no magnitude takes the low end, not the middle",
  magnitudeColour(null), magnitudeColour(2.0));
check("a stop returns itself exactly", magnitudeColour(5.0), "#ffbe28");
// Halfway between two stops is halfway between two colours, or the ramp has
// bands in it rather than a gradient.
check("it interpolates between stops", magnitudeColour(4.25), "#d5c82b");
check("every value is a six-digit hex",
  [1, 2, 3.7, 5, 6.2, 7, 9].every((m) => /^#[0-9a-f]{6}$/.test(magnitudeColour(m))), true);
// GREEN to RED, the reading every hazard map has trained people in.
const ramp = [2, 3.5, 5, 6.5, 8].map((m) => rgbOf(magnitudeColour(m)));
check("red rises all the way up the ramp",
  ramp.every((c, i) => i === 0 || c[0] >= ramp[i - 1][0]), true);
check("and green falls all the way up it",
  ramp.every((c, i) => i === 0 || c[1] <= ramp[i - 1][1]), true);
check("the small end is unmistakably green", ramp[0][1] > ramp[0][0] && ramp[0][1] > ramp[0][2], true);
check("the big end is unmistakably red", ramp[4][0] > ramp[4][1] && ramp[4][0] > ramp[4][2], true);
// The middle must not be mud: interpolating green straight to red crosses a
// dark olive exactly where the M5s are, so the ramp goes through yellow.
const middle = rgbOf(magnitudeColour(5));
check("the middle of the ramp is bright, not olive", middle[0] > 200 && middle[1] > 150, true);
// It moves in HUE, not in brightness. Ending in a dark crimson is the obvious
// way to say "more" and the wrong way to say it on a black globe: multiplied
// by the recency fade, an older M8 came out #170003 -- the largest earthquake
// on the map, drawn nearly invisible.
check("every stop stays luminous",
  ramp.every((c) => Math.max(...c) >= 200), true);
ok("and survives the recency floor",
  ramp.every((c) => Math.max(...c) * recencyOpacity(0, 1, 1) > 120));

/* ── recency ──────────────────────────────────────────────────────────────── */

const now = 1745000000000;
const day = 24 * 3600 * 1000;
check("right now is full strength", recencyOpacity(now, now, day), 1);
check("a full window back is the floor", recencyOpacity(now - day, now, day), 0.65);
check("older than the window stays at the floor",
  recencyOpacity(now - 10 * day, now, day), 0.65);
check("half a window back is halfway", recencyOpacity(now - day / 2, now, day), 0.825);
// A clock skew must not brighten something past full.
check("a future timestamp is clamped, not amplified",
  recencyOpacity(now + day, now, day), 1);
check("no timestamp gets a sensible middle", recencyOpacity(null, now, day), 0.82);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

/* ── GDACS floods ────────────────────────────────────────────────────────── */

{
  const payload = { features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [138.78, -35.45] },
      properties: { eventtype: "FL", eventid: 102938, name: "Flood in Australia",
        alertlevel: "Orange", fromdate: "2026-08-24T01:00:00", todate: "2026-08-26T01:00:00",
        url: { report: "https://www.gdacs.org/report.aspx?eventid=102938" } } },
    { type: "Feature", geometry: { type: "Point", coordinates: [null, 3] }, properties: {} },
  ] };
  const points = gdacsPoints(payload, { id: "gdacs-floods" });
  check("a GDACS flood converts with its alert level in the title",
    points.length === 1 && points[0].title === "Flood in Australia — Orange alert");
  check("its id is namespaced against every other registry",
    points[0].id === "gdacs:102938");
  check("the flood wears EONET's flood category so the symbols agree",
    points[0].categoryId === "floods");
  check("the report link and the window's end survive",
    points[0].link.includes("102938") && points[0].date === "2026-08-26T01:00:00");
  check("a feature with no coordinates is dropped, not a crash",
    gdacsPoints({ features: [{ geometry: {} }] }, { id: "x" }).length === 0);
  check("the url asks SEARCH for FL with all alert levels",
    /SEARCH\?fromDate=\d{4}-\d{2}-\d{2}&toDate=\d{4}-\d{2}-\d{2}&alertlevel=Green;Orange;Red&eventlist=FL$/.test(gdacsUrl()));
}
