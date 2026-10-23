/**
 * The route-risk path integral against closed forms.
 * Run: node GeoID_GIS/viewer/gis/route-risk.test.mjs
 */
import {
  CAPACITY, distanceKm, greatCircle, destination, deadReckonPath, flightProfile, galeRadiusKm, stormAt,
  cycloneUtilisation, CONE_TO_SIGMA, theta, turbulenceUtilisation, convectionUtilisation,
  ashUtilisation, riskDensity, integrateRoute, rateRoute, weatherSampleIndices, routeWeatherUrl,
  readRouteWeather, weatherAt, assessRoute, describeRisk, HAZARDS,
} from "./route-risk.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
process.on("exit", () => {
  console.log(`route-risk: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

/* the route */
{
  const lhr = { lat: 51.47, lon: -0.4543 };
  const jfk = { lat: 40.6413, lon: -73.7781 };
  const path = greatCircle(lhr, jfk, 25);
  const L = distanceKm(lhr.lat, lhr.lon, jfk.lat, jfk.lon);
  ok(near(L, 5540, 15), `LHR–JFK is about 5540 km (${L.toFixed(0)})`);
  ok(near(path.at(-1).s, L, 1e-6) && path[0].s === 0, "s runs from 0 to the length");
  ok(path.every((p, i) => !i || near(p.s - path[i - 1].s, L / (path.length - 1), 1e-6)), "evenly spaced");
  let sum = 0;
  for (let i = 1; i < path.length; i += 1) sum += distanceKm(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
  ok(near(sum, L, 0.01), "the samples lie on the great circle (chord sum = length)");
  ok(Math.max(...path.map((p) => p.lat)) > 52, "the great circle bows north of both ends");
  const across = greatCircle({ lat: 35, lon: 170 }, { lat: 35, lon: -170 }, 50);
  ok(across.every((p) => Math.abs(p.lon) >= 169.9), "across the antimeridian, the short way");
  const same = greatCircle(lhr, lhr);
  ok(same.length === 2 && same[1].s === 0, "a zero-length route does not divide by zero");
}
{
  const d = destination(0, 0, 90, 111.195);
  ok(near(d.lat, 0, 1e-9) && near(d.lon, 1, 1e-3), "a degree east on the equator");
  const dr = deadReckonPath(10, 20, 45, 1000, 100);
  ok(dr.length === 11 && near(distanceKm(10, 20, dr.at(-1).lat, dr.at(-1).lon), 1000, 1e-6), "dead reckoning goes the distance");
}

/* the profile */
{
  const path = greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 30 }, 10);
  const L = path.at(-1).s;
  const prof = flightProfile(path, { departMs: 0, cruiseAltM: 10000, climbKm: 200, descentKm: 250, cruiseKmh: 800, terminalKmh: 500 });
  ok(prof[0].altM === 0 && near(prof.at(-1).altM, 0, 1e-9), "on the ground at both ends");
  ok(near(Math.max(...prof.map((p) => p.altM)), 10000, 1e-9), "cruises at the cruise altitude");
  const mid = prof.find((p) => p.s >= 100);
  ok(near(mid.altM, 10000 * mid.s / 200, 1e-6), "climbs linearly over the climb distance");
  const hours = (450 / 500) + ((L - 450) / 800);
  ok(near(prof.at(-1).timeMs / 3600e3, hours, 0.02), `time = Σ ds/v (${(prof.at(-1).timeMs / 3600e3).toFixed(3)} vs ${hours.toFixed(3)})`);
  const short = flightProfile(greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 1.8 }, 5), { cruiseAltM: 10000 });
  const peak = Math.max(...short.map((p) => p.altM));
  ok(peak < 10000 && peak > 3000, `a 200 km hop tops out lower (${peak.toFixed(0)} m)`);
  const live = flightProfile(path, { startAltM: 10000 });
  ok(live[0].altM === 10000, "a live aircraft starts in the air");
}

/* cyclone */
{
  ok(galeRadiusKm(34) === 100 && galeRadiusKm(200) === 350 && galeRadiusKm(10) === 100, "gale radius clamps");
  const track = [{ lat: 20, lon: -60, time: 0, wind: 100, lead: 0 }, { lat: 22, lon: -62, time: 12 * 3600e3, wind: 120, lead: 12 }];
  const mid = stormAt(track, 6 * 3600e3);
  ok(near(mid.lat, 21, 1e-9) && near(mid.wind, 110, 1e-9) && near(mid.lead, 6, 1e-9), "the storm halfway along");
  ok(stormAt(track, -7 * 3600e3) === null && stormAt(track, 19 * 3600e3) === null, "outside the track, no storm");
  ok(stormAt(track, -3 * 3600e3).lat === 20, "just before the track, its first fix");
  const wrapT = [{ lat: 0, lon: 179, time: 0, wind: 50 }, { lat: 0, lon: -179, time: 2, wind: 50 }];
  ok(near(Math.abs(stormAt(wrapT, 1).lon), 180, 1e-9), "interpolated across the antimeridian");

  const storms = [{ name: "Test", track: [{ lat: 20, lon: -60, time: 0, wind: 128, lead: 0 }] }];
  const c0 = cycloneUtilisation(20, -60, 0, storms);
  ok(near(c0.u, 2, 1e-9) && c0.storm === "Test", "at the centre with no position error, Vmax/64");
  const R = galeRadiusKm(128);
  const [lat, lon] = [destination(20, -60, 0, R).lat, destination(20, -60, 0, R).lon];
  ok(near(cycloneUtilisation(lat, lon, 0, storms).u, 34 / 64, 1e-6), "at the gale radius, 34 kt");
  // Position error: the peak falls by a²/(a²+σ²) — and the integral across is conserved.
  const cone = () => 300;
  const sigma = 300 * CONE_TO_SIGMA;
  const a2 = R * R / (2 * Math.log(128 / 34));
  ok(near(cycloneUtilisation(20, -60, 0, storms, cone).u, 2 * a2 / (a2 + sigma * sigma), 1e-9), "smeared by the forecast error");
  const line = (cr) => {
    let s = 0;
    for (let x = -3000; x <= 3000; x += 5) s += cycloneUtilisation(20, -60 + x / (111.195 * Math.cos(20 * Math.PI / 180)), 0, storms, cr).u * 5;
    return s;
  };
  // In 2D the volume is conserved; along one line the integral scales as a/√(a²+σ²).
  ok(near(line(cone) / line(() => 0), Math.sqrt(a2 / (a2 + sigma * sigma)), 0.02), "a line integral across scales as a/√(a²+σ²)");
  ok(cycloneUtilisation(20, -60, 0, []).u === 0, "no storms, nothing");
}

/* turbulence */
{
  ok(near(theta(15, 1000), 288.15, 1e-9), "θ at 1000 hPa is T");
  // A layer with N² ≈ 1e-4 and shear 0.01 /s → Ri ≈ 1 → u = Ri_c / Ri.
  const z0 = 9000; const dz = 1000; const p0 = 300; const t0 = -40;
  const th0 = theta(t0, p0);
  const n2 = 1e-4;
  const th1 = th0 * (1 + (n2 * dz) / 9.80665 * 1) ; // approximately; refined below
  const p1 = 250;
  const t1 = th1 / (1000 / p1) ** 0.2857 - 273.15;
  const lv = [{ p: p0, z: z0, t: t0, u: 0, v: 0 }, { p: p1, z: z0 + dz, t: t1, u: 10, v: 0 }];
  const out = turbulenceUtilisation(lv, 9500);
  const n2Got = (9.80665 / ((th0 + th1) / 2)) * ((th1 - th0) / dz);
  ok(near(out.ri, n2Got / 1e-4, 1e-9) && near(out.u, CAPACITY.richardson / out.ri, 1e-12), `Ri = N²/S² (${out.ri.toFixed(3)})`);
  ok(near(out.shear, 0.01, 1e-12), "shear is |Δv|/Δz");
  ok(turbulenceUtilisation(lv, 2000).u === 0, "far below the jet layers, nothing");
  ok(near(turbulenceUtilisation(lv, 7500).u, out.u * 0.5, 1e-9), "fading in over 3 km below");
  const unstable = [{ p: 300, z: 9000, t: -40, u: 0, v: 0 }, { p: 250, z: 10000, t: -60, u: 1, v: 0 }];
  ok(turbulenceUtilisation(unstable, 9500).u === 2, "a statically unstable layer is twice the limit");
  ok(turbulenceUtilisation([], 9500).u === 0, "no column, nothing");
}

/* convection, ash, density */
{
  ok(convectionUtilisation(3000, 3) === 2 && convectionUtilisation(300, 95) === 1, "CAPE over 1500; a thunderstorm is at least the limit");
  ok(convectionUtilisation(NaN, NaN) === 0, "nothing known, nothing");
  ok(ashUtilisation(4) === 2 && ashUtilisation(-1) === 0, "ash over 2 mg/m³");
  ok(riskDensity(0.5) === 0 && riskDensity(1) === 1 && riskDensity(3) === 3 && near(riskDensity(0.75), 0.5, 1e-12), "the density ramp");
  let mono = true;
  for (let u = 0; u < 3; u += 0.01) if (riskDensity(u + 0.01) < riskDensity(u)) mono = false;
  ok(mono, "density never falls as utilisation rises");
}

/* the integral */
{
  const samples = Array.from({ length: 101 }, (_, i) => ({ s: i * 10 }));   // 1000 km
  const flat = integrateRoute(samples, samples.map(() => ({ convection: 1 })));
  ok(near(flat.total, 1000, 1e-9), "1000 km exactly at the limit is 1000 equivalent km");
  ok(near(flat.cumulative[50], 500, 1e-9), "the cumulative curve is linear at constant density");
  ok(flat.segments.length === 10 && flat.segments.every((g) => near(g.risk, 100, 1e-9)), "ten 100 km segments of 100");
  ok(flat.minFos.value === 1 && flat.minFos.hazard === "convection", "FoS 1 everywhere");
  // A box of u = 2 over 200–300 km; elsewhere zero.
  const box = integrateRoute(samples, samples.map((p) => ({ turbulence: p.s >= 200 && p.s <= 300 ? 2 : 0 })));
  ok(near(box.total, 2 * 100 + 2 * 10, 1e-9), `a box integrates to its area, plus the trapezoid's two half-steps (${box.total})`);
  ok(box.worst.fromKm === 200 && box.worst.governing === "turbulence", "the worst segment is the box, named");
  ok(near(box.minFos.value, 0.5, 1e-12) && box.minFos.s === 200, "lowest FoS 1/2 where it starts");
  ok(near(box.perHazard.turbulence, box.total, 1e-9) && box.perHazard.ash === 0, "all of it is turbulence");
  ok(near(box.cumulative.at(-1), box.segments.reduce((a, g) => a + g.risk, 0), 1e-9), "segments sum to the total");
  // A kinked ramp: the trapezoid is exact on each straight piece.
  const ramp = integrateRoute(samples, samples.map((p) => ({ ash: 2 * Math.max(1, p.s / 100) })));
  const exact = 100 + (1000 ** 2 - 100 ** 2) / 200;   // ∫ max(1, s/100) ds
  ok(near(ramp.total, 2 * exact, 1e-6), `a ramp integrates to its area (${ramp.total.toFixed(2)} vs ${(2 * exact).toFixed(2)})`);
  // Two hazards add.
  const two = integrateRoute(samples, samples.map(() => ({ ash: 2, convection: 2 })));
  ok(near(two.total, 4000, 1e-9), "hazards add");
  ok(near(two.minFos.value, 0.5, 1e-12), "the governing FoS is the worst single one");
  const none = integrateRoute(samples, samples.map(() => ({})));
  ok(none.total === 0 && none.worst === null && none.rating === "negligible" && none.minFos.value === Infinity, "a clean route");
  ok(rateRoute(0.5, 0.9) === "moderate" && rateRoute(300) === "high" && rateRoute(600) === "severe"
    && rateRoute(5, 1.2) === "low" && rateRoute(1) === "negligible", "the rating words");
}

/* GFS along the route */
{
  const samples = greatCircle({ lat: 51.47, lon: -0.45 }, { lat: 40.64, lon: -73.78 }, 25);
  const idx = weatherSampleIndices(samples, 300, 40);
  ok(idx[0] === 0 && idx.at(-1) === samples.length - 1, "the ends are always asked");
  ok(idx.length >= 18 && idx.length <= 21, `about one every 300 km (${idx.length})`);
  ok(weatherSampleIndices(samples, 10, 12).length === 12, "capped");
  const url = routeWeatherUrl(idx.map((i) => samples[i]), Date.UTC(2026, 9, 23, 12), Date.UTC(2026, 9, 23, 20));
  ok(url.includes("latitude=51.470%2C") && url.includes("gfs_seamless") && url.includes("start_hour=2026-10-23T11%3A00"), "one request, every point");
  const hourly = (k) => ({
    time: ["2026-10-23T12:00", "2026-10-23T13:00"],
    cape: [100 * k, 2000], weather_code: [3, 95],
    ...Object.fromEntries([400, 300, 250, 200, 150].flatMap((p, j) => [
      [`temperature_${p}hPa`, [-20 - 10 * j, -20 - 10 * j]],
      [`wind_speed_${p}hPa`, [10 + 5 * j, 10]],
      [`wind_direction_${p}hPa`, [270, 270]],
      [`geopotential_height_${p}hPa`, [7000 + 1500 * j, 7000 + 1500 * j]],
    ])),
  });
  const wx = readRouteWeather([{ hourly: hourly(1) }, { hourly: hourly(2) }], [0, 1000]);
  ok(wx.length === 2 && wx[1].s === 1000 && wx[0].times[0] === Date.UTC(2026, 9, 23, 12), "read per point, times in UTC");
  ok(near(wx[0].levels[0][0].u, 10, 1e-9) && near(wx[0].levels[0][0].v, 0, 1e-9), "a westerly is +u");
  const at = weatherAt(wx, 900, Date.UTC(2026, 9, 23, 13, 20));
  ok(at.cape === 2000 && at.code === 95, "nearest point along the route, nearest hour");
  ok(readRouteWeather({ hourly: hourly(1) }, [0]).length === 1, "a single point answers as an object");

  const prof = flightProfile(samples, { departMs: Date.UTC(2026, 9, 23, 12) });
  const res = assessRoute(prof, {
    weather: wx,
    storms: [{ name: "Zeta", track: [{ lat: 52, lon: -40, time: Date.UTC(2026, 9, 23, 12), wind: 90, lead: 0 }, { lat: 53, lon: -38, time: Date.UTC(2026, 9, 24, 0), wind: 80, lead: 12 }] }],
    ashAt: () => 0,
    coneRadiusKm: (h) => 5 * h,
  });
  ok(res.util.length === prof.length && HAZARDS.every((h) => Number.isFinite(res.perHazard[h])), "every sample, every hazard");
  ok(res.perHazard.cyclone > 0 && res.detail.some((d) => d.storm === "Zeta"), "the storm on the route counts");
  ok(res.perHazard.convection > 0, "the thunderstorm hour counts");
  const text = describeRisk(res, { from: "LHR", to: "JFK", samples: prof });
  ok(/Route risk \*\*\w+\*\*/.test(text) && /Worst segment: km \d+/.test(text) && /LHR → JFK/.test(text), "described in words");
  const bare = assessRoute(prof, {});
  ok(bare.total === 0 && /No segment/.test(describeRisk(bare)), "with nothing known, nothing is invented");
}
