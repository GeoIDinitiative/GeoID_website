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
  MAGNITUDE_RAMP, magnitudeColour,
} from "./event-sources.js";

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
check("no magnitude is the base size", magnitudeSize(null, base), base);
check("nothing is smaller than the base", magnitudeSize(1, base) >= base, true);
check("nothing is more than four times it", magnitudeSize(9.5, base) <= base * 4, true);
ok("bigger earthquakes are bigger", magnitudeSize(7, base) > magnitudeSize(4, base));
ok("and the gap is not a rounding error", magnitudeSize(7, base) - magnitudeSize(4, base) > 2);
// Monotonic across the whole usable range, or two bands could swap.
let monotone = true;
for (let m = 1; m < 9; m += 0.5) {
  if (magnitudeSize(m + 0.5, base) < magnitudeSize(m, base)) monotone = false;
}
check("size never falls as magnitude rises", monotone, true);

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
check("a stop returns itself exactly", magnitudeColour(5.0), "#ff7a3c");
// Halfway between two stops is halfway between two colours, or the ramp has
// bands in it rather than a gradient.
check("it interpolates between stops", magnitudeColour(4.25), "#ff9551");
check("every value is a six-digit hex",
  [1, 2, 3.7, 5, 6.2, 7, 9].every((m) => /^#[0-9a-f]{6}$/.test(magnitudeColour(m))), true);
// Gradational RED: red stays high while green and blue fall away, so the ramp
// deepens rather than wandering into another hue.
const ramp = [2, 3.5, 5, 6.5, 8].map((m) => rgbOf(magnitudeColour(m)));
check("green falls all the way up the ramp",
  ramp.every((c, i) => i === 0 || c[1] <= ramp[i - 1][1]), true);
check("and the reddest channel stays the red one",
  ramp.every((c) => c[0] > c[1] && c[0] > c[2]), true);
// It deepens in HUE, not in brightness. Ending in a dark crimson is the
// obvious way to say "more" and the wrong way to say it on a black globe:
// multiplied by the recency fade, an older M8 came out #170003 -- the largest
// earthquake on the map, drawn nearly invisible.
check("red never falls away", ramp.every((c) => c[0] >= 250), true);
ok("the top of the ramp survives the recency floor",
  Math.max(...ramp[4].map((v) => v * recencyOpacity(0, 1, 1))) > 120);

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
