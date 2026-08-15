/**
 * The time engine, against planted collections.
 *
 * Everything here is the pure half of time.js — parseTime, detectTimeField,
 * timeRange, applyTimeFilter. The pill is not tested and does not need to be:
 * it reads the range, sets a bound and asks these four functions what to show,
 * so a fault in the pill is visible and a fault in these is not.
 *
 * The fixture carries a DECOY on purpose. `magnitude` is a number on every
 * feature, and a parser willing to call any number a date would pick it —
 * quietly filtering an earthquake layer by how big the earthquakes were. The
 * boundary cases are planted too: a field parseable on exactly 80% of features
 * must be detected and one at 60% must not, because a threshold that is not
 * tested at its edge is a threshold nobody knows the value of.
 *
 * Expected instants are derived with Date.UTC in the test rather than pasted
 * as literals, so they are the arithmetic and not a recollection of it.
 *
 * Run: node GeoID_GIS/viewer/gis/time.test.mjs
 */

import {
  parseTime, detectTimeField, timeRange, applyTimeFilter,
} from "./time.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
const same = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ── fixtures ── */

const feature = (properties) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties,
});
const fc = (features) => ({ type: "FeatureCollection", features });

// Six monthly readings plus one undated. Written as ISO strings; the expected
// instants are computed from Date.UTC, which is what an ISO date-only string
// means by specification.
const MONTHS = [0, 1, 2, 3, 4, 5];
const stamp = (m) => Date.UTC(2020, m, 1);
const iso = (m) => new Date(stamp(m)).toISOString().slice(0, 10);

const monthly = fc([
  ...MONTHS.map((m) => feature({ name: `m${m}`, event_date: iso(m), magnitude: 2 + m * 0.5 })),
  feature({ name: "undated", event_date: null, magnitude: 9 }),
]);

/* ── parseTime ──────────────────────────────────────────────────────────── */

{
  check("an ISO date is midnight UTC on that day",
    parseTime("2024-05-01") === Date.UTC(2024, 4, 1), String(parseTime("2024-05-01")));
  check("an ISO instant with a Z keeps its time of day",
    parseTime("2024-05-01T06:30:00Z") === Date.UTC(2024, 4, 1, 6, 30),
    String(parseTime("2024-05-01T06:30:00Z")));
  check("a year-month is the first of that month",
    parseTime("2024-05") === Date.UTC(2024, 4, 1), String(parseTime("2024-05")));

  const ms = Date.UTC(2024, 4, 1);
  check("epoch milliseconds pass through unchanged", parseTime(ms) === ms);
  check("epoch seconds are promoted to milliseconds",
    parseTime(Math.round(ms / 1000)) === ms, String(parseTime(Math.round(ms / 1000))));
  check("epoch milliseconds as a string also parse", parseTime(String(ms)) === ms);

  // The decoys, one per shape of numeric column this project actually carries.
  check("a magnitude is not a date", parseTime(4.5) === null);
  check("an elevation is not a date", parseTime(1200) === null);
  check("a population is not a date", parseTime(1e6) === null);
  check("a bare year is not a date, it is four digits", parseTime(1998) === null);
  check("a bare year as a string is not a date either", parseTime("1998") === null);
  // Date.parse("300") answers with a real instant in the year 300. Refusing to
  // call Date.parse until the string already looks like a date is the fix.
  check("a small integer string is not year 300", parseTime("300") === null);

  check("a month name with a year is a date", Number.isFinite(parseTime("1 May 2024")));
  check("a slashed US date is a date", Number.isFinite(parseTime("05/01/2024")));
  check("a slashed ISO date is a date", Number.isFinite(parseTime("2024/05/01")));
  check("prose is not a date", parseTime("not a date") === null);
  check("an empty string is not a date", parseTime("") === null);
  check("null is not a date", parseTime(null) === null);
  check("undefined is not a date", parseTime(undefined) === null);
  check("a Date object is its own instant",
    parseTime(new Date(ms)) === ms, String(parseTime(new Date(ms))));
  check("an invalid Date is not a date", parseTime(new Date("nonsense")) === null);
}

/* ── detectTimeField ────────────────────────────────────────────────────── */

{
  check("the dated field is found past a numeric decoy",
    detectTimeField(monthly) === "event_date", String(detectTimeField(monthly)));

  // 6 of 7 features carry a parseable date: 0.857, over the 0.8 floor.
  near("… and it is found on 6 of 7, not 7 of 7",
    timeRange(monthly).count, 6, 0);

  // Exactly at the floor: 4 of 5 = 0.80.
  const atFloor = fc([
    ...[0, 1, 2, 3].map((m) => feature({ when: iso(m) })),
    feature({ when: null }),
  ]);
  check("a field parseable on exactly 80% of features is detected",
    detectTimeField(atFloor) === "when", String(detectTimeField(atFloor)));

  // Below it: 3 of 5 = 0.60.
  const belowFloor = fc([
    ...[0, 1, 2].map((m) => feature({ when: iso(m) })),
    feature({ when: null }),
    feature({ when: "n/a" }),
  ]);
  check("a field parseable on 60% is not detected",
    detectTimeField(belowFloor) === null, String(detectTimeField(belowFloor)));

  // The denominator is the feature count, not the count of features carrying
  // the field: a field on 2 of 5 features, valid on both, is 40%.
  const sparse = fc([
    feature({ seen: iso(0) }),
    feature({ seen: iso(1) }),
    feature({ other: 1 }),
    feature({ other: 2 }),
    feature({ other: 3 }),
  ]);
  check("a field present on only part of the layer scores against the whole layer",
    detectTimeField(sparse) === null, String(detectTimeField(sparse)));

  // Two fields both fully parseable: the named one wins.
  const twoFields = fc(MONTHS.map((m) => ({
    ...feature({ code: iso(m), date: iso(m) }),
  })));
  check("a name matching /date|time|when/ beats an equally good unnamed field",
    detectTimeField(twoFields) === "date", String(detectTimeField(twoFields)));

  // … even when the unnamed one scores higher.
  const namedIsWorse = fc([
    ...[0, 1, 2, 3].map((m) => feature({ code: iso(m), timestamp: iso(m) })),
    feature({ code: iso(4), timestamp: null }),
  ]);
  check("… and it still wins when it scores lower, so long as it clears the floor",
    detectTimeField(namedIsWorse) === "timestamp", String(detectTimeField(namedIsWorse)));

  // The USGS shape: properties.time in epoch milliseconds.
  const usgs = fc(MONTHS.map((m) => feature({ time: stamp(m), mag: 4 + m })));
  check("an epoch-millisecond field is a time field",
    detectTimeField(usgs) === "time", String(detectTimeField(usgs)));

  check("an empty collection has no time field", detectTimeField(fc([])) === null);
  check("features with no properties have no time field",
    detectTimeField(fc([{ type: "Feature" }, { type: "Feature" }])) === null);
  check("a layer record is accepted as well as a collection",
    detectTimeField({ id: 1, collection: monthly }) === "event_date");
  check("a bare feature array is accepted too",
    detectTimeField(monthly.features) === "event_date");
  check("a threshold may be relaxed by the caller",
    detectTimeField(belowFloor, { threshold: 0.5 }) === "when");
}

/* ── timeRange ──────────────────────────────────────────────────────────── */

{
  const range = timeRange(monthly);
  check("the range starts at the first dated feature", range.from === stamp(0),
    String(range.from));
  check("… and ends at the last", range.to === stamp(5), String(range.to));
  check("… and names the field it read", range.field === "event_date");
  check("the count is the dated features only", range.count === 6, String(range.count));
  const none = timeRange(fc([feature({ magnitude: 3 })]));
  check("a collection with no dates has a null range",
    none.from === null && none.count === 0);
}

/* ── applyTimeFilter ────────────────────────────────────────────────────── */

{
  const all = applyTimeFilter(monthly, {});
  same("both ends open is inert — every index, undated feature included",
    all, [0, 1, 2, 3, 4, 5, 6]);

  const fromOnly = applyTimeFilter(monthly, { from: stamp(3) });
  same("an open upper end keeps everything at or after the lower bound",
    fromOnly, [3, 4, 5]);
  check("… and drops the undated feature, which has no position in the window",
    !fromOnly.includes(6));

  const toOnly = applyTimeFilter(monthly, { to: stamp(2) });
  same("an open lower end keeps everything at or before the upper bound",
    toOnly, [0, 1, 2]);

  same("both bounds are inclusive",
    applyTimeFilter(monthly, { from: stamp(1), to: stamp(3) }), [1, 2, 3]);

  same("a window between two dates catches neither neighbour",
    applyTimeFilter(monthly, { from: stamp(1) + 1, to: stamp(3) - 1 }), [2]);

  same("a window before the data is empty, not everything",
    applyTimeFilter(monthly, { to: stamp(0) - 1 }), []);

  same("ISO strings work as bounds",
    applyTimeFilter(monthly, { from: iso(4) }), [4, 5]);
  same("Date objects work as bounds",
    applyTimeFilter(monthly, { from: new Date(stamp(4)) }), [4, 5]);
  same("a numeric bound is read as epoch milliseconds, not as data",
    applyTimeFilter(monthly, { from: stamp(4) }), [4, 5]);

  same("an explicit field overrides detection",
    applyTimeFilter(monthly, { from: stamp(4), field: "event_date" }), [4, 5]);
  same("… and naming a field with no dates in it matches nothing",
    applyTimeFilter(monthly, { from: stamp(0), field: "magnitude" }), []);

  const dateless = fc([feature({ magnitude: 3 }), feature({ magnitude: 4 })]);
  same("a collection with no time field is inert rather than empty",
    applyTimeFilter(dateless, { from: stamp(0), to: stamp(5) }), [0, 1]);

  same("a layer record filters the same as its collection",
    applyTimeFilter({ id: 7, collection: monthly }, { from: stamp(4) }), [4, 5]);
  same("a bare feature array does too",
    applyTimeFilter(monthly.features, { from: stamp(4) }), [4, 5]);
  same("an empty collection filters to nothing without throwing",
    applyTimeFilter(fc([]), { from: stamp(0) }), []);

  // The USGS shape end to end: epoch-ms values, epoch-ms bounds.
  const usgs = fc(MONTHS.map((m) => feature({ time: stamp(m), mag: 4 + m })));
  same("an epoch-millisecond layer filters on the same bounds",
    applyTimeFilter(usgs, { from: stamp(2), to: stamp(4) }), [2, 3, 4]);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
