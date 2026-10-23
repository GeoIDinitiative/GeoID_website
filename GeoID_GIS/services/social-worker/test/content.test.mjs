/**
 * v1.3 content & map: field measurements are checked on the server, the
 * before/after pair cannot smuggle a script URL into an <img>, monitor series
 * are sorted, and the map of interest answers for a window of time.
 *
 *   cd GeoID_GIS/services/social-worker && node --test test/content.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { cleanMeasurement, cleanMeasurements, cleanImageRef, MAX_MEASUREMENTS } from "../content.js";
import { timeWindow } from "../interest.js";

const A = "a@example.com", B = "b@example.com";
const bad = (fn, re) => assert.throws(fn, (e) => e.status === 400 && (!re || re.test(e.message)), "should be refused");

test("planar measurements: ranges, right-hand rule, either convention in", () => {
  const m = cleanMeasurement({ type: "bedding", values: { strike: 120, dip: 35 } });
  assert.deepEqual(m.values, { strike: 120, dip: 35, dip_direction: 210 });
  // Dip direction alone gives the right-hand strike.
  assert.deepEqual(cleanMeasurement({ type: "joint", values: { dip_direction: 45, dip: 80 } }).values,
    { strike: 315, dip: 80, dip_direction: 45 });
  // A left-hand strike with its dip direction is the same plane, stored right-hand.
  assert.deepEqual(cleanMeasurement({ type: "strike_dip", values: { strike: 90, dip_direction: 0, dip: 20 } }).values,
    { strike: 270, dip: 20, dip_direction: 0 });
  // 360 is north, stored as 0; strings from a form are numbers.
  assert.equal(cleanMeasurement({ type: "bedding", values: { strike: "360", dip: "10" } }).values.strike, 0);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: 120, dip: 95 } }, 3), /Measurement 3: dip must be between 0 and 90/);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: -5, dip: 10 } }), /strike/);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: 400, dip: 10 } }), /strike/);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: 10 } }), /needs a dip/);
  bad(() => cleanMeasurement({ type: "fault", values: { dip: 60 } }), /strike or a dip direction/);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: 10, dip_direction: 50, dip: 30 } }), /right angles/);
  bad(() => cleanMeasurement({ type: "bedding", values: { strike: "steep", dip: 30 } }), /must be a number/);
  assert.equal(cleanMeasurement({ type: "fault", values: { strike: 10, dip: 60, rake: -90 } }).values.rake, -90);
  bad(() => cleanMeasurement({ type: "fault", values: { strike: 10, dip: 60, rake: 200 } }), /rake/);
});

test("lineations, plain measurements, unknown types and limits", () => {
  assert.deepEqual(cleanMeasurement({ type: "lineation", values: { trend: 300, plunge: 25 }, note: " stretching " }),
    { type: "lineation", values: { trend: 300, plunge: 25 }, note: "stretching" });
  bad(() => cleanMeasurement({ type: "lineation", values: { trend: 300, plunge: -1 } }), /plunge/);
  bad(() => cleanMeasurement({ type: "lineation", values: { trend: 300 } }), /needs a trend/);
  const t = cleanMeasurement({ type: "measurement", values: { value: 12.5, unit: "°C", label: "Spring temperature" } });
  assert.deepEqual(t.values, { value: 12.5, unit: "°C", label: "Spring temperature" });
  bad(() => cleanMeasurement({ type: "measurement", values: { unit: "m" } }), /needs a value/);
  bad(() => cleanMeasurement({ type: "foliation", values: {} }), /type must be one of/);
  bad(() => cleanMeasurement("strike 120"), /must be an object/);
  bad(() => cleanMeasurements(Array(MAX_MEASUREMENTS + 1).fill({ type: "measurement", values: { value: 1 } })), /At most/);
  bad(() => cleanMeasurements("120/35"), /must be a list/);
});

test("before/after references: keys, https and layer ids only", () => {
  assert.equal(cleanImageRef("m/u_1/abc123.png"), "m/u_1/abc123.png");
  assert.equal(cleanImageRef("https://example.org/a.png"), "https://example.org/a.png");
  assert.equal(cleanImageRef("javascript:alert(1)"), "");
  assert.equal(cleanImageRef("data:image/png;base64,AAAA"), "");
  assert.equal(cleanImageRef("../../v1/me"), "");
  assert.equal(cleanImageRef("ctx-mosaic-color"), "ctx-mosaic-color");
});

test("posts: observation measurements and analysis pairs through the API", async () => {
  const env = makeEnv();
  const ok = await call(env, "POST", "/v1/posts", { as: A, body: {
    kind: "observation", title: "Bedding at the quarry", provenance: "observed",
    meta: { measurements: [
      { type: "bedding", values: { strike: 120, dip: 35 }, note: "top surface" },
      { type: "lineation", values: { trend: 210, plunge: 30 } },
      { type: "measurement", values: { value: 7.2, unit: "pH" } },
    ] } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.meta.measurements.length, 3);
  assert.equal(ok.body.meta.measurements[0].values.dip_direction, 210);
  const refused = await call(env, "POST", "/v1/posts", { as: A, body: {
    kind: "observation", title: "Impossible", provenance: "observed",
    meta: { measurements: [{ type: "bedding", values: { strike: 10, dip: 10 } }, { type: "joint", values: { strike: 10, dip: 140 } }] } } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Measurement 2: dip/);

  const pair = await call(env, "POST", "/v1/posts", { as: A, body: {
    kind: "analysis", title: "Before and after", provenance: "derived",
    meta: { before: "javascript:alert(1)", after: "https://example.org/after.png", before_label: "Pre-event",
      before_date: "1700000000", after_date: 1710000000, uncertainty: "±1 px" } } });
  assert.equal(pair.status, 200, JSON.stringify(pair.body));
  assert.equal(pair.body.meta.before, "");
  assert.equal(pair.body.meta.after, "https://example.org/after.png");
  assert.equal(pair.body.meta.before_date, 1700000000);

  const mon = await call(env, "POST", "/v1/posts", { as: A, body: {
    kind: "monitor", title: "Tilt", provenance: "observed",
    meta: { series: [{ label: "Tilt", unit: "µrad", points: [[30, 2], [10, 1], ["x", 3], [20, 1.5]] }] } } });
  assert.deepEqual(mon.body.meta.series[0].points, [[10, 1], [20, 1.5], [30, 2]], "sorted by time, junk dropped");
});

test("interest windows: since/until select who counted then, and trending is measured from the window's end", async () => {
  const env = makeEnv();
  for (const [who, handle] of [[A, "ana"], [B, "ben"]]) await call(env, "PATCH", "/v1/me", { as: who, body: { handle } });
  const day = 86400;
  const t0 = Math.floor(Date.now() / 1000) - 400 * day;
  const old = await call(env, "POST", "/v1/posts", { as: A, body: { title: "old", location: { lat: 37.75, lon: 14.99, precision: "approx", place: "Etna" } } });
  const area = await call(env, "POST", "/v1/me/study-areas", { as: B, body: { name: "Etna", location: { lat: 37.7, lon: 15.0 } } });
  // Backdate: the post a year ago, the study area 100 days later.
  env.DB.raw.prepare("UPDATE posts SET created_at = ? WHERE id = ?").run(t0, old.body.id);
  env.DB.raw.prepare("UPDATE study_areas SET created_at = ? WHERE id = ?").run(t0 + 100 * day, area.body.id);

  const all = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3");
  assert.equal(all.body.researchers, 2);
  const first = await call(env, "GET", `/v1/map/interest?bbox=-180,-90,180,90&z=3&since=${t0 - day}&until=${t0 + day}`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.researchers, 1, "only the post existed then");
  assert.equal(first.body.cells[0].trend, "new", "new relative to the window's end, not today");
  assert.equal(first.body.since, t0 - day);
  const upTo = await call(env, "GET", `/v1/map/interest?bbox=-180,-90,180,90&z=3&until=${t0 + 101 * day}`);
  assert.equal(upTo.body.researchers, 2, "cumulative up to after the area was declared");
  const gap = await call(env, "GET", `/v1/map/interest?bbox=-180,-90,180,90&z=3&since=${t0 + 10 * day}&until=${t0 + 20 * day}`);
  assert.equal(gap.body.researchers, 0);
  assert.equal(gap.body.cells.length, 0);
  const backwards = await call(env, "GET", `/v1/map/interest?bbox=-180,-90,180,90&z=3&since=${t0}&until=${t0 - day}`);
  assert.equal(backwards.status, 400);
  // A window's tags and place names come from the window too.
  assert.equal(first.body.cells[0].place, "Etna");
});

test("timeWindow: absent is unbounded, a future end is now", () => {
  assert.deepEqual(timeWindow(null, null), { since: null, until: null });
  assert.deepEqual(timeWindow("", ""), { since: null, until: null });
  assert.equal(timeWindow("10", String(Math.floor(Date.now() / 1000) + 9999)).until, null);
  assert.throws(() => timeWindow("100", "50"), (e) => e.status === 400);
});
