/** The total-risk coefficient. Run: node GeoID_GIS/viewer/gis/total-risk.test.mjs */
import { readFileSync } from "node:fs";
import {
  horizonProbability, imminence, windAt, magnitudeReaching, aftershockProbability, weatherTerms,
  cycloneTerm, fosTerm, backgroundTerm, combine, riskClass, WEATHER_LEVELS, mainDangerSentence,
} from "./total-risk.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
process.on("exit", () => { console.log(`total-risk: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

ok(near(horizonProbability(1 / 475, 8766), 1 / 475, 1e-6), "a year's horizon is the annual chance");
ok(near(horizonProbability(1 / 475, 168), 168 / 8766 / 475, 1e-7), "a week of a 1-in-475 hazard");
ok(imminence(10, 72) === 1 && near(imminence(72, 72), Math.exp(-1), 1e-12) && imminence(80, 72) === 0, "lead-time discount");
ok(windAt(20, 100) === 100 && near(windAt(160, 100), 50, 1e-9), "flat inside R_max, r^-0.5 outside");
ok(near(magnitudeReaching(20), 6.0, 0.01), "an M 6 reaches 20 km");
{
  const P = aftershockProbability(7, 1, 8, 6);
  ok(P > 0.2 && P < 0.35, `an M 6 aftershock a week after an M 7 is ~25% (${P})`);
  ok(aftershockProbability(7, 30, 37, 6) < P, "and less likely a month on");
}
{
  const now = Date.parse("2026-10-11T00:00Z");
  const time = Array.from({ length: 72 }, (_, i) => new Date(now + i * 3600e3).toISOString().slice(0, 16));
  const precipitation = time.map((_, i) => (i >= 30 && i < 40 ? 5 : 0));
  const terms = weatherTerms({ time, precipitation, wind_gusts_10m: time.map(() => 10), apparent_temperature: time.map(() => 15), snowfall: time.map(() => 0), cape: time.map(() => 100) }, { nowMs: now, horizonHours: 72 });
  const rain = terms.find((t) => t.key === "rain");
  ok(near(rain.value, 50, 1e-9) && near(rain.raw, 1, 1e-9) && rain.lead === 30, "50 mm in 24 h is unit demand, 30 h out");
  ok(rain.h < 1 && near(rain.h, Math.exp(-6 / 48), 1e-9), "discounted for its lead");
  ok(terms.find((t) => t.key === "heat").raw === 0, "15 °C is no heat demand");
}
{
  const c = cycloneTerm({ storm: "X", km: 400, wind: 120, lead: 12, inCone: true });
  ok(near(c.raw, 120 / 64, 1e-9), "inside the cone the centre may pass over");
  const far = cycloneTerm({ storm: "X", km: 640, wind: 120, lead: 12, inCone: false });
  ok(near(far.value, 30, 1e-9), "640 km out a 120 kt storm is 30 kt");
}
{
  const r = combine([fosTerm("slope", "Slope", 2), backgroundTerm("Seismic risk", 1 / 475, { horizonHours: 168 }), cycloneTerm({ storm: "X", km: 100, wind: 100, lead: 6, inCone: false })]);
  ok(r.main.key === "cyclone", "an imminent cyclone outranks a quiet slope and a background fault");
  ok(near(r.terms.reduce((s, t) => s + t.share, 0), 1, 1e-12), "the shares sum to one");
  ok(near(r.fos, 1 / r.demand, 1e-12) && r.class.id === "act", `FoS = 1 / Σ w h (${r.fos})`);
  ok(/Main danger: Tropical cyclone X/.test(mainDangerSentence(r)), "the main danger is named");
  ok(combine([fosTerm("slope", "Slope", 2)], { slope: 0 }).fos === Infinity, "a weight of nought removes a model");
  ok(riskClass(2).id === "aware" && riskClass(5).id === "low", "classes");
}
{
  const src = readFileSync(new URL("./flow-layer.js", import.meta.url), "utf8");
  ok(src.includes(`[${WEATHER_LEVELS.rain.level}, "heavy`) && src.includes(`[${WEATHER_LEVELS.gust.level}, "storm`) && src.includes(`[${WEATHER_LEVELS.snow.level}, "significant"`), "warning levels are the hazard sheets' own");
}
