/**
 * The verification ledger against answers known in advance.
 *
 *   node GeoID_GIS/viewer/gis/atlas-ledger.test.mjs
 */

import {
  VERIFY, windowOf, recordFrom, addRecords, dueRecords, matchEvent, verifyEvent,
  reduceWeather, reached, verifyWeather, naiveProbability, fitLogistic, predict,
  calibrate, reliability, skill, summarise, reportText, toCsv, eonetEvents, usgsEvents,
  weatherVars, LEDGER_CAP,
} from "./atlas-ledger.js";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1, 0);
const place = { lat: 51.5074, lon: -0.1278 };

// ── records ─────────────────────────────────────────────────────────────────
const rainTerm = { key: "rain", model: "Rain in 24 h", raw: 1.4, h: 1.1, value: 70, unit: "mm", atMs: T0 + 30 * H, source: "GFS" };
const r = recordFrom(rainTerm, place, { issuedMs: T0, horizonHours: 72 });
ok(r && r.key === "rain" && r.score === 1.4, "the record keeps the RAW score, not the lead-discounted one");
ok(r.fromMs === T0 + 18 * H && r.toMs === T0 + 42 * H, "a timed reading stands 12 h either side of its time");
ok(r.lead === 18, "the lead is to the window's start", r.lead);
ok(recordFrom({ key: "background", raw: 0.2 }, place, { issuedMs: T0 }) === null, "a yearly chance is not recorded");
ok(recordFrom({ key: "waves", raw: 2 }, place, { issuedMs: T0 }) === null, "nor is a hazard with nothing to verify it against");
const untimed = windowOf({ key: "eruption" }, T0, 48);
ok(untimed.fromMs === T0 && untimed.toMs === T0 + 48 * H, "an untimed reading stands for the whole horizon");
ok(windowOf({ atMs: T0 + 2 * H }, T0, 72).fromMs === T0, "a window never starts before the forecast was issued");

// The same forecast asked twice an hour apart is one record; a new day's is another.
let ledger = addRecords([], [r]);
ledger = addRecords(ledger, [recordFrom({ ...rainTerm, raw: 1.6 }, place, { issuedMs: T0 + H })]);
ok(ledger.length === 1 && ledger[0].score === 1.6, "re-asking replaces, keeping the newer reading");
ledger = addRecords(ledger, [recordFrom(rainTerm, place, { issuedMs: T0 + 30 * H })]);
ok(ledger.length === 2, "a forecast issued later for another window is another record");
const withOutcome = [{ ...ledger[0], outcome: { observed: true } }];
const again = addRecords(withOutcome, [{ ...ledger[0], score: 9 }]);
ok(again[0].outcome?.observed === true && again[0].score === 9, "an outcome already earned survives a re-ask");
const many = Array.from({ length: LEDGER_CAP + 5 }, (_, i) => ({ id: `x${i}`, issuedMs: i, key: "rain" }));
const capped = addRecords([], many);
ok(capped.length === LEDGER_CAP && capped[0].id === "x5", "past the cap the oldest go first");

// ── what is due ────────────────────────────────────────────────────────────
const due = dueRecords([
  { toMs: T0, outcome: null },
  { toMs: T0 + 10 * H, outcome: null },
  { toMs: T0, outcome: { observed: false, provisional: true } },
  { toMs: T0 - 7 * 24 * H, outcome: { observed: false, provisional: true } },
  { toMs: T0 - 7 * 24 * H, outcome: { observed: false } },
], T0 + H);
ok(due.length === 2, "due: window passed and unverified, or provisional once the archive covers it", due.length);

// ── events ─────────────────────────────────────────────────────────────────
const quakeRec = recordFrom({ key: "aftershock", raw: 0.8 }, { lat: 38, lon: 142 }, { issuedMs: T0, horizonHours: 72 });
const events = [
  { id: "far", category: "earthquakes", lat: 40, lon: 142, timeMs: T0 + 5 * H, mag: 6 },      // 222 km — out of reach
  { id: "small", category: "earthquakes", lat: 38.1, lon: 142, timeMs: T0 + 5 * H, mag: 4.2 }, // under M5
  { id: "late", category: "earthquakes", lat: 38.1, lon: 142, timeMs: T0 + 80 * H, mag: 6 },   // after the window
  { id: "hit", category: "earthquakes", lat: 38.3, lon: 142.1, timeMs: T0 + 6 * H, mag: 5.4, title: "M 5.4" },
  { id: "storm", category: "severeStorms", lat: 38, lon: 142, timeMs: T0 + 6 * H },
];
const m = matchEvent(quakeRec, events);
ok(m?.event.id === "hit" && m.km > 30 && m.km < 40, "an event matches by category, reach, window and size", m?.event.id);
const o = verifyEvent(quakeRec, events, { nowMs: T0 + 100 * H, source: "USGS" });
ok(o.observed === true && o.event.id === "hit" && o.how === "event", "the outcome names the event");
ok(verifyEvent(quakeRec, events.slice(0, 3)).observed === false, "nothing in reach is a no");

// ── weather ────────────────────────────────────────────────────────────────
const hours = Array.from({ length: 72 }, (_, i) => new Date(T0 + i * H).toISOString().slice(0, 16));
const precip = hours.map((_, i) => (i >= 20 && i < 30 ? 6 : 0.5));   // 10 h of 6 mm/h inside 24 h
const hourly = {
  time: hours, precipitation: precip,
  wind_gusts_10m: hours.map((_, i) => (i === 25 ? 27 : 10)),
  apparent_temperature: hours.map((_, i) => 10 - (i === 30 ? 40 : 0)),
  relative_humidity_2m: hours.map((_, i) => (i === 22 ? 10 : 60)),
  wind_speed_10m: hours.map((_, i) => (i === 22 ? 12 : 3)),
};
const wettest = reduceWeather("rain", hourly, T0 + 18 * H, T0 + 42 * H);
ok(Math.abs(wettest - (60 + 14 * 0.5)) < 1e-9, "the wettest 24 h, as the forecast was reduced", wettest);
ok(reduceWeather("gust", hourly, T0, T0 + 71 * H) === 27, "the strongest gust");
ok(reduceWeather("cold", hourly, T0, T0 + 71 * H) === -30, "the coldest it felt");
const fire = reduceWeather("fire", hourly, T0, T0 + 71 * H);
ok(Math.abs(fire - (1.5 * (12 / 11.2))) < 1e-9, "the Red Flag multiple at the worst hour", fire);
ok(Number.isNaN(reduceWeather("rain", hourly, T0 + 200 * H, T0 + 220 * H)), "nothing recorded is NaN, not zero");
ok(reached("cold", -30) === true && reached("cold", -10) === false && reached("rain", 49.9) === false, "below and above the level");
const ow = verifyWeather(r, hourly, { nowMs: T0 + 50 * H, source: "ERA5" });
ok(ow.observed === true && ow.value === 67 && ow.error === 3, "rain: observed, the value and the error", JSON.stringify(ow));
ok(verifyWeather({ ...r, fromMs: T0 + 200 * H, toMs: T0 + 210 * H }, hourly) === null, "no observation, no outcome");
ok(weatherVars([r, { key: "fire" }, quakeRec]).join() === "precipitation,relative_humidity_2m,wind_speed_10m", "the variables to ask for");

// ── probabilities and the calibration ──────────────────────────────────────
ok(Math.abs(naiveProbability(1) - (1 - Math.exp(-1))) < 1e-12 && naiveProbability(0) === 0, "naive probability 1 − e^(−score)");

// A logistic recovered from data generated by one.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const synth = [];
for (let i = 0; i < 3000; i += 1) {
  const score = Math.exp(-2 + 4 * rand());
  const lead = 72 * rand();
  const z = -1 + 1.5 * Math.log(score + 0.05) - 0.4 * (lead / 24);
  const p = 1 / (1 + Math.exp(-z));
  synth.push({ key: "rain", score, lead, outcome: { observed: rand() < p } });
}
const beta = fitLogistic(synth.map((s) => [1, Math.log(s.score + 0.05), s.lead / 24]), synth.map((s) => (s.outcome.observed ? 1 : 0)), { ridge: 1e-6 });
ok(Math.abs(beta[0] + 1) < 0.15 && Math.abs(beta[1] - 1.5) < 0.12 && Math.abs(beta[2] + 0.4) < 0.1,
  "IRLS recovers the generating logistic", beta.map((b) => b.toFixed(3)).join(", "));
ok(Math.abs(predict(beta, { score: 1, lead: 0 }) - 1 / (1 + Math.exp(-(-1 + 1.5 * Math.log(1.05))))) < 0.04, "predict follows the fit");
const cal = calibrate(synth);
ok(cal.ok && cal.cvBrier < cal.naiveBrier && cal.cvBrier < cal.climBrier,
  "cross-validated calibration beats the naive probability and climatology", `${cal.cvBrier?.toFixed(4)} ${cal.naiveBrier?.toFixed(4)} ${cal.climBrier?.toFixed(4)}`);
ok(calibrate(synth.slice(0, 5)).ok === false && /needs 20/.test(calibrate(synth.slice(0, 5)).why), "too few to learn from, said so");
ok(/no event/.test(calibrate(synth.map((s) => ({ ...s, outcome: { observed: false } }))).why), "one outcome only, said so");

// Separable data must not run the coefficients away.
const sep = Array.from({ length: 60 }, (_, i) => ({ score: i < 30 ? 0.1 : 3, lead: 0, outcome: { observed: i >= 30 } }));
const bs = fitLogistic(sep.map((s) => [1, Math.log(s.score + 0.05), 0]), sep.map((s) => (s.outcome.observed ? 1 : 0)));
ok(bs.every(Number.isFinite) && Math.abs(bs[1]) < 50, "a separable ledger stays finite under the ridge", bs.map((b) => b.toFixed(2)).join(", "));

const rel = reliability([0.05, 0.15, 0.95, 0.95], [0, 0, 1, 0], 10);
ok(rel[0].n === 1 && rel[1].n === 1 && rel[9].n === 2 && rel[9].freq === 0.5, "reliability bins count and frequency");

// ── skill ──────────────────────────────────────────────────────────────────
const recs = [
  { key: "rain", score: 1.5, lead: 10, value: 60, unit: "mm", outcome: { observed: true, how: "weather", value: 55 } },   // hit
  { key: "rain", score: 1.2, lead: 10, value: 55, unit: "mm", outcome: { observed: false, how: "weather", value: 40 } },  // false alarm
  { key: "rain", score: 0.5, lead: 10, value: 25, unit: "mm", outcome: { observed: true, how: "weather", value: 52 } },   // miss
  { key: "rain", score: 0.2, lead: 10, value: 10, unit: "mm", outcome: { observed: false, how: "weather", value: 8 } },   // correct quiet
  { key: "rain", score: 0.3, lead: 10, value: 15, unit: "mm", outcome: null },                                             // pending
];
const s = skill(recs);
ok(s.hits === 1 && s.falseAlarms === 1 && s.misses === 1 && s.correctNegatives === 1 && s.pending === 1, "the contingency table");
ok(s.pod === 0.5 && s.far === 0.5 && Math.abs(s.csi - 1 / 3) < 1e-12 && s.bias === 1, "POD, FAR, CSI and bias");
const pN = [1.5, 1.2, 0.5, 0.2].map(naiveProbability);
const bExp = [(pN[0] - 1) ** 2, pN[1] ** 2, (pN[2] - 1) ** 2, pN[3] ** 2].reduce((a, b) => a + b) / 4;
ok(Math.abs(s.brier - bExp) < 1e-12, "the Brier score of the naive probability");
ok(Math.abs(s.bss - (1 - bExp / 0.25)) < 1e-12, "skill against a 50% climatology");
const c = s.continuous;
ok(c.n === 4 && Math.abs(c.bias - ((5 + 15 - 27 + 2) / 4)) < 1e-12, "the error's mean is forecast minus observed", c.bias);
ok(Math.abs(c.mae - (5 + 15 + 27 + 2) / 4) < 1e-12 && c.rmse > c.mae, "MAE and RMSE");
ok(c.q10 <= c.q50 && c.q50 <= c.q90, "error quantiles are ordered");
// A forecast that is exactly 2x the truth: the correction is observed = 0 + 0.5 forecast.
const twice = [10, 20, 30, 40].map((o) => ({ key: "gust", score: 1, lead: 0, value: 2 * o, unit: "m/s", outcome: { observed: true, how: "weather", value: o } }));
const corr = skill(twice).continuous.correction;
ok(Math.abs(corr.a) < 1e-9 && Math.abs(corr.b - 0.5) < 1e-12 && Math.abs(skill(twice).continuous.r - 1) < 1e-12,
  "the least-squares correction of a doubled forecast is ×0.5");

// ── words and files ────────────────────────────────────────────────────────
const sum = summarise([...recs, { ...quakeRec, outcome: o }]);
ok(Object.keys(sum.byKey).join() === "aftershock,rain", "summarised per hazard");
const text = reportText(sum);
ok(/5 forecasts? recorded|6 forecasts recorded/.test(text) && /POD/.test(text) && /EONET/.test(text), "the report says what it counted and against what");
ok(/empty/.test(reportText(summarise([]))), "an empty ledger says how it fills");
const csv = toCsv([r, { ...quakeRec, outcome: o }]);
ok(csv.split("\n").length === 3 && /^id,key,model/.test(csv) && /M 5\.4/.test(csv), "the CSV holds every record with its outcome");

const eon = eonetEvents({ events: [{ id: "EONET_1", title: "Flood", categories: [{ id: "floods" }],
  geometry: [{ date: "2026-10-01T06:00:00Z", type: "Point", coordinates: [10, 45] },
    { date: "2026-10-02T06:00:00Z", type: "Polygon", coordinates: [[[11, 46], [12, 46], [12, 47], [11, 46]]] }] }] });
ok(eon.length === 2 && eon[0].category === "floods" && eon[1].lat === 46 && eon[1].lon === 11, "EONET: a point per dated geometry");
const us = usgsEvents({ features: [{ id: "us1", properties: { time: 5, mag: 6.1, place: "x" }, geometry: { coordinates: [142, 38, 10] } }] });
ok(us[0].mag === 6.1 && us[0].category === "earthquakes" && us[0].lat === 38, "USGS: lat/lon from the geometry");
ok(Object.values(VERIFY).every((v) => v.kind === "weather" ? v.vars?.length && Number.isFinite(v.level) : v.categories?.length && v.reachKm > 0),
  "every hazard says how it is verified");
