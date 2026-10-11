/** The total-risk coefficient. Run: node GeoID_GIS/viewer/gis/total-risk.test.mjs */
import { readFileSync } from "node:fs";
import {
  horizonProbability, imminence, windAt, magnitudeReaching, aftershockProbability, weatherTerms,
  cycloneTerm, fosTerm, backgroundTerm, combine, riskClass, WEATHER_LEVELS, mainDangerSentence,
  combineInTime, demandAt, fireWeatherSeries, floodTerm, cycloneSeries,
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
{
  // The panel's wiring: loaded by the page, mounted under myGeoID, and the
  // slope seams it reads exist on the modules that own them.
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./total-risk-panel.js", import.meta.url), "utf8");
  const mode = readFileSync(new URL("./geoid-mode.js", import.meta.url), "utf8");
  const pipe = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  ok(/gis\/total-risk-panel\.js\?v=/.test(page), "the page loads the total-risk panel");
  ok(panel.includes(`byId("hazards-mygeoid-host")`), "the card mounts in the myGeoID host");
  ok(/export function fosNear/.test(mode) && /fosNear[,\s}]/.test(mode.slice(mode.indexOf("window.GeoIDMode"))), "GeoID mode publishes fosNear");
  ok(/lowestAt/.test(pipe.slice(pipe.indexOf("window.GeoIDLandslidePipeline"))), "the forecast pipeline publishes lowestAt");
  ok(/threatAt\(place\.lat, place\.lon\)/.test(panel) && /cycloneTerm\(/.test(panel), "the cyclone term is read through the forecast's own threatAt");
  ok(!/\beval\(|new Function\(/.test(panel), "nothing is evaluated");
}

{
  // THE TOTAL IN TIME: peaks days apart are not one storm.
  const now = Date.UTC(2026, 9, 1, 0);
  const H = 3_600_000;
  const hours = Array.from({ length: 97 }, (_, k) => now + k * H);
  const spike = (at) => ({ tMs: hours, h: hours.map((t) => (t === now + at * H ? 1 : 0)) });
  const rain = { key: "rain", model: "Rain", h: 1, raw: 1, series: spike(6) };
  const gale = { key: "gust", model: "Gust", h: 1, raw: 1, series: spike(20) };
  const apart = combineInTime([rain, gale], {}, { nowMs: now, horizonHours: 72 });
  ok(near(apart.fos, 1, 1e-9) && near(apart.peaksFos, 0.5, 1e-9), `peaks 14 h apart score 1, not the 0.5 their sum says (${apart.fos}, ${apart.peaksFos})`);
  ok(Math.round(apart.lead) === 6, "the worst hour is the first peak (ties go to the earliest)");
  const together = combineInTime([rain, { ...gale, series: spike(6) }], {}, { nowMs: now, horizonHours: 72 });
  ok(near(together.fos, 0.5, 1e-9) && Math.round(together.lead) === 6, "peaks in the same hour add in full");
  const late = combineInTime([{ ...gale, series: spike(60) }], {}, { nowMs: now, horizonHours: 72 });
  ok(near(late.fos, 1 / Math.exp(-36 / 48), 1e-9), "an hour 60 h out is discounted for its lead");
  const bg = backgroundTerm("Seismic", 0.01, { horizonHours: 72 });
  const withBg = combineInTime([rain, bg], {}, { nowMs: now, horizonHours: 72 });
  ok(near(withBg.demand, 1 + bg.h, 1e-12), "a risk map's chance stands for the whole horizon");
  ok(demandAt(rain, now + 90 * H) === 0 && demandAt(rain, now + 6 * H) === 1, "a series answers 0 where it is not");
  ok(demandAt({ h: 2, raw: 2, atMs: now + 30 * H }, now + 41 * H) === 2 && demandAt({ h: 2, raw: 2, atMs: now + 30 * H }, now + 43 * H) === 0, "a timed event without a series stands 12 h either side");
  ok(withBg.curve.length === 73 && withBg.terms.find((t) => t.key === "rain").peakH === 1, "the curve has every hour; each term keeps its own peak");
}
{
  const f = fireWeatherSeries([15, 7.5, 30, 15, NaN], [11.2, 30, 11.2, 11.2, 5], [0, 0, 0, 2, 0]);
  ok(near(f[0], 1, 1e-12), "Red Flag exactly: RH 15% with 11.2 m/s is 1");
  ok(near(f[1], 4, 1e-12), "each factor is capped at 2");
  ok(near(f[2], 0.5, 1e-12) && f[3] === 0 && Number.isNaN(f[4]), "humid halves it, rain clears it, a gap stays a gap");
  const t0 = Date.UTC(2026, 9, 1, 0);
  const time = Array.from({ length: 30 }, (_, k) => new Date(t0 + k * 3_600_000).toISOString().slice(0, 16));
  const z = time.map(() => 0);
  const terms = weatherTerms({ time, precipitation: z, wind_gusts_10m: z, apparent_temperature: z.map(() => 20), snowfall: z, cape: z,
    relative_humidity_2m: time.map((_, k) => (k === 10 ? 10 : 50)), wind_speed_10m: time.map(() => 12) }, { nowMs: t0, horizonHours: 24 });
  const fire = terms.find((t) => t.key === "fire");
  ok(fire && near(fire.raw, 1.5 * 12 / 11.2, 1e-9) && Math.round(fire.lead) === 10, "the forecast's driest windy hour is the fire-weather peak");
  ok(terms.every((t) => t.series?.h?.length === 30), "every weather term carries its hourly series");
}
{
  const t0 = Date.UTC(2026, 9, 1, 0);
  const reach = { fos: [3, 0.8, 2], times: [t0, t0 + 6 * 3_600_000, t0 + 12 * 3_600_000], widthM: 60, km: 1.2 };
  const fl = floodTerm(reach, { nowMs: t0, horizonHours: 72 });
  ok(fl.key === "flood" && near(fl.raw, 1.25, 1e-12) && near(fl.value, 0.8, 1e-12) && Math.round(fl.lead) === 6, "the channel's worst frame, h = 1 / FoS");
  ok(/over its brim/.test(fl.note), "below 1 the reach is said to be over its brim");
  ok(floodTerm({ fos: [], times: [] }) === null, "no frames, no term");
}
{
  const t0 = Date.UTC(2026, 9, 1, 0);
  const track = [0, 1, 2].map((k) => ({ lat: 20 + k, lon: -70, time: t0 + k * 12 * 3_600_000, wind: 100 }));
  const s = cycloneSeries(track, { inCone: true, wind: 100 }, 21, -70.01);
  ok(near(s.h[1], 100 / 64, 1e-9) && s.h[0] < s.h[1], "inside the cone the closest point is the centre over the place");
  const c = cycloneTerm({ storm: "X", km: 1, wind: 100, time: track[1].time, inCone: true }, { nowMs: t0, horizonHours: 72, track, place: { lat: 21, lon: -70.01 } });
  ok(c.series?.tMs.length === 3, "a cyclone term carries its track as a series");
}
{
  const panel = readFileSync(new URL("./total-risk-panel.js", import.meta.url), "utf8");
  const pipe = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  ok(/relative_humidity_2m,wind_speed_10m/.test(panel), "the forecast asks for the fire-weather inputs");
  ok(/combineInTime\(last\.terms/.test(panel) && !/combine\(last\.terms/.test(panel), "the card scores the worst HOUR, not the sum of peaks");
  ok(/floodAt: \(lat, lon/.test(pipe.slice(pipe.indexOf("window.GeoIDLandslidePipeline"))) && /floodAt\?\.\(place\.lat, place\.lon\)/.test(panel), "the river flood comes from the forecast's own flood wave");
  ok(/fl\.open\?\.\[i\]/.test(pipe.slice(pipe.indexOf("floodAt: (lat, lon"))), "an open reach is passed over, as the map passes over it");
}
