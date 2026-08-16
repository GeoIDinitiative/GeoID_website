/**
 * The forecast maths, against series whose answers are worked by hand.
 *
 * Everything here is pure, which is the point: the network part is one fetch
 * and a JSON parse, and the part that could be quietly wrong — which window
 * counts which day — is the part that gets pinned.
 */

import {
  buildUrl, parseForecast, triggerIndex, riskEvolution, bandOf, normalise,
  forecastRiskAt, DEFAULTS,
} from "./forecast.js";

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

check("the forecast request names GFS and asks for no past days", () => {
  const url = new URL(buildUrl({ lat: 54.67, lon: -6.775 }));
  eq(url.searchParams.get("forecast_days"), "16", "forecast_days");
  eq(url.searchParams.get("past_days"), null, "past_days");
  eq(url.searchParams.get("models"), "gfs_seamless", "model");
  eq(url.searchParams.get("daily"), "precipitation_sum", "variable");
});

check("the history request drops the model, because GFS has no archive", () => {
  // Measured against the live service: past_days together with
  // models=gfs_seamless returns null for EVERY day, forecast included.
  const url = new URL(buildUrl({ lat: 54.67, lon: -6.775, days: 1, pastDays: 15, model: null }));
  eq(url.searchParams.get("past_days"), "15", "past_days");
  eq(url.searchParams.get("models"), null, "no model on the history call");
});

check("a null day is not zero rain", () => {
  const out = parseForecast({
    daily_units: { precipitation_sum: "mm" },
    daily: { time: ["a", "b"], precipitation_sum: [null, 4] },
  });
  eq(out.days[0].precipMm, null, "unknown day");
  eq(out.days[1].precipMm, 4, "known day");
});

check("a response that is null throughout is refused, not drawn as dry", () => {
  let message = "";
  try {
    parseForecast({ daily: { time: ["a", "b"], precipitation_sum: [null, null] } });
  } catch (e) { message = e.message; }
  if (!/no precipitation values/.test(message)) {
    throw new Error(`expected a refusal, got "${message}"`);
  }
});

check("an unfillable antecedent window is flagged rather than counted as dry", () => {
  const days = [{ date: "a", precipMm: null }, { date: "b", precipMm: 10 }];
  const rows = triggerIndex(days, { fromIndex: 1 });
  eq(rows[0].antecedentComplete, false, "completeness");
});

check("more than 16 days is clamped, not requested", () => {
  eq(new URL(buildUrl({ lat: 0, lon: 0, days: 40 })).searchParams.get("forecast_days"), "16", "days");
});

check("a service error surfaces its own reason", () => {
  let message = "";
  try { parseForecast({ error: true, reason: "latitude must be in range" }); }
  catch (e) { message = e.message; }
  eq(message, "latitude must be in range", "reason");
});

check("the response parses to dated millimetres", () => {
  const out = parseForecast({
    latitude: 54.65, longitude: -6.79, elevation: 112,
    daily_units: { precipitation_sum: "mm" },
    daily: { time: ["2026-08-16", "2026-08-17"], precipitation_sum: [2.9, 5.1] },
  });
  eq(out.days.length, 2, "days");
  eq(out.days[1].precipMm, 5.1, "day 2 rain");
  eq(out.unit, "mm", "unit");
});

check("the burst window is inclusive of today and the antecedent is not", () => {
  // 20 mm today, 20 mm yesterday, and 100 mm spread over the fortnight before.
  const days = [];
  for (let i = 0; i < 15; i += 1) days.push({ date: `d${i}`, precipMm: 100 / 15 });
  days.push({ date: "yesterday", precipMm: 20 });
  days.push({ date: "today", precipMm: 20 });
  const [today] = triggerIndex(days, { fromIndex: days.length - 1 });
  near(today.burstMm, 20 + 20 + 100 / 15, 0.2, "3-day burst");
  // The antecedent ends yesterday, so it holds yesterday's 20 and 14 of the
  // fortnight's days — today's 20 mm must NOT appear in both windows.
  near(today.antecedentMm, 20 + (100 / 15) * 14, 0.2, "15-day antecedent");
});

check("the trigger is the stated weighting and saturates at one", () => {
  const dry = triggerIndex([{ date: "a", precipMm: 0 }])[0];
  eq(dry.trigger, 0, "no rain");
  // 40 mm in one day is the whole burst threshold and no antecedent.
  const burst = triggerIndex([{ date: "a", precipMm: 40 }])[0];
  near(burst.trigger, 0.6, 0.001, "burst alone");
  // A deluge cannot exceed one.
  const flood = triggerIndex(
    Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, precipMm: 100 })),
    { fromIndex: 19 })[0];
  eq(flood.trigger, 1, "saturated");
});

check("risk is susceptibility times trigger, banded", () => {
  const rows = riskEvolution(0.8, [{ date: "a", trigger: 1 }, { date: "b", trigger: 0.25 }]);
  eq(rows[0].risk, 0.8, "wet day");
  eq(rows[0].band, "high", "wet band");
  eq(rows[1].risk, 0.2, "dry day");
  eq(rows[1].band, "low", "dry band");
});

check("susceptibility outside 0..1 is clamped rather than believed", () => {
  eq(riskEvolution(4, [{ date: "a", trigger: 1 }])[0].risk, 1, "over");
  eq(riskEvolution(-2, [{ date: "a", trigger: 1 }])[0].risk, 0, "under");
});

check("the bands are ordered and cover the range", () => {
  eq(bandOf(0), "minimal", "0");
  eq(bandOf(0.2), "low", "0.2");
  eq(bandOf(0.4), "moderate", "0.4");
  eq(bandOf(0.9), "high", "0.9");
});

check("normalise refuses a degenerate range instead of dividing by zero", () => {
  eq(normalise(5, 0, 10), 0.5, "midpoint");
  eq(normalise(5, 3, 3), null, "flat range");
  eq(normalise("x", 0, 1), null, "not a number");
});

await checkAsync("the whole chain reports the forecast half even with no raster", async () => {
  const body = {
    latitude: 54.65, longitude: -6.79, elevation: 112,
    daily_units: { precipitation_sum: "mm" },
    daily: {
      time: Array.from({ length: 16 }, (_, i) => `2026-08-${String(16 + i).padStart(2, "0")}`),
      precipitation_sum: Array.from({ length: 16 }, () => 1),
    },
  };
  const history = {
    daily_units: { precipitation_sum: "mm" },
    daily: {
      time: Array.from({ length: 15 }, (_, i) => `2026-08-${String(1 + i).padStart(2, "0")}`),
      precipitation_sum: Array.from({ length: 15 }, () => 2),
    },
  };
  const out = await forecastRiskAt({
    lat: 54.67, lon: -6.775, days: 16,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (String(url).includes("past_days") ? history : body),
    }),
  });
  eq(out.days.length, 16, "forecast days");
  eq(out.susceptibility, null, "no layer");
  eq(out.days[0].risk, null, "risk withheld");
  if (!(out.days[0].antecedentMm > 10)) {
    throw new Error("the past days were not used as antecedent history");
  }
});

await checkAsync("a sampled raster completes it", async () => {
  const body = {
    latitude: 54.65, longitude: -6.79,
    daily_units: { precipitation_sum: "mm" },
    daily: { time: ["z9"], precipitation_sum: [40] },
  };
  const out = await forecastRiskAt({
    lat: 54.67, lon: -6.775, days: 1,
    layer: { name: "susceptibility", sampler: () => 4, legendInfo: { min: 1, max: 5 } },
    // The history call fails; the forecast must still answer.
    fetchImpl: async (url) => String(url).includes("past_days")
      ? { ok: false, status: 500 }
      : { ok: true, json: async () => body },
  });
  eq(out.susceptibility, 0.75, "normalised reading");
  near(out.days[0].risk, 0.45, 0.001, "risk on the wet day");
  eq(out.days[0].band, "moderate", "band");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
