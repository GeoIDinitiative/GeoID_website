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
  SOURCES, sourceById, usgsPoints, magnitudeSize, recencyOpacity,
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
ok("something is on by default", SOURCES.some((s) => s.defaultOn));

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

/* ── recency ──────────────────────────────────────────────────────────────── */

const now = 1745000000000;
const day = 24 * 3600 * 1000;
check("right now is full strength", recencyOpacity(now, now, day), 1);
check("a full window back is the floor", recencyOpacity(now - day, now, day), 0.4);
check("older than the window stays at the floor",
  recencyOpacity(now - 10 * day, now, day), 0.4);
check("half a window back is halfway", recencyOpacity(now - day / 2, now, day), 0.7);
// A clock skew must not brighten something past full.
check("a future timestamp is clamped, not amplified",
  recencyOpacity(now + day, now, day), 1);
check("no timestamp gets a sensible middle", recencyOpacity(null, now, day), 0.75);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
