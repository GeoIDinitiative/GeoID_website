/**
 * The ash model against what it must get right: the source rates, the
 * release profile, settling, the wind, and conservation of mass through the
 * deposit and the air.
 *
 *   node GeoID_GIS/viewer/gis/ash-plume.test.mjs
 */

import {
  massEruptionRate, eruptionDuration, suzukiWeights, grainClasses, settlingVelocity,
  windAt, windAtTime, simulate, depositGrid, depositExtent, concentrationGrid,
  erf, aviationClass, depositClass, ERUPTION_SIZES, particleDensity,
} from "./ash-plume.js";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

// ── Source ───────────────────────────────────────────────────────────────────
const q5 = massEruptionRate(5) / 2500;
ok(Math.abs(q5 - 44.8) < 0.5, "Mastin: a 5 km column is ~45 m³/s DRE", q5.toFixed(2));
ok(Math.abs(2.0 * (massEruptionRate(12) / 2500) ** 0.241 - 12) < 1e-9, "Mastin inverts exactly");
const d2 = eruptionDuration(ERUPTION_SIZES[2].massKg, ERUPTION_SIZES[2].heightKm) / 3600;
ok(d2 > 3 && d2 < 15, "a small eruption lasts hours, not seconds or weeks", `${d2.toFixed(1)} h`);
ok(Object.values(ERUPTION_SIZES).every((s, i, a) => !i || (s.heightKm > a[i - 1].heightKm && s.massKg > a[i - 1].massKg)),
  "sizes grow in height and mass with the VEI");

// ── Release profile and grains ──────────────────────────────────────────────
const w = suzukiWeights(20, 4);
ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12, "Suzuki weights sum to 1");
const peak = w.indexOf(Math.max(...w));
ok(peak > 10 && peak < 19, "with A = 4 most mass is released high in the column", `peak at band ${peak}`);
const gr = grainClasses();
ok(Math.abs(gr.reduce((a, b) => a + b.fraction, 0) - 1) < 1e-12, "grain fractions sum to 1");
ok(Math.abs(gr.find((g) => g.phi === 0).d - 0.001) < 1e-15, "φ 0 is 1 mm");
ok(particleDensity(-3) === 1000 && particleDensity(6) === 2500 && particleDensity(1.5) > 1000,
  "pumice coarse, glass fine, linear between");

// ── Settling ─────────────────────────────────────────────────────────────────
const v16um = settlingVelocity(16e-6, 2500, 0);
const vStokes = (9.80665 * 16e-6 * 16e-6 * (2500 - 1.225)) / (18 * 1.81e-5);
ok(Math.abs(v16um - vStokes) < 1e-12, "fine ash settles by Stokes", v16um.toExponential(3));
const v1mm = settlingVelocity(1e-3, 1900, 0);
ok(v1mm > 2 && v1mm < 8, "a 1 mm grain falls a few metres a second", v1mm.toFixed(2));
const sizes = [16e-6, 62e-6, 250e-6, 1e-3, 4e-3, 16e-3];
ok(sizes.every((d, i) => !i || settlingVelocity(d, 2000, 0) > settlingVelocity(sizes[i - 1], 2000, 0)),
  "settling velocity grows with size through every regime");
ok(settlingVelocity(4e-3, 1000, 10000) > settlingVelocity(4e-3, 1000, 0),
  "thinner air aloft: a lapillus falls faster high up");

// ── Wind ─────────────────────────────────────────────────────────────────────
const prof = [{ z: 0, u: 0, v: 0 }, { z: 1000, u: 10, v: -4 }, { z: 5000, u: 30, v: 0 }];
ok(windAt(prof, 500)[0] === 5 && windAt(prof, 500)[1] === -2, "wind is linear between levels");
ok(windAt(prof, 20000)[0] === 30 && windAt(prof, -50)[0] === 0, "wind is held beyond the ends");
const profiles = [{ t: 0, levels: [{ z: 0, u: 0, v: 0 }] }, { t: 3600, levels: [{ z: 0, u: 20, v: 10 }] }];
const mid = windAtTime(profiles, 1800, 0);
ok(mid[0] === 10 && mid[1] === 5, "wind is linear in time between profiles");

// ── Mass conservation, symmetry and drift ───────────────────────────────────
const still = [{ t: 0, levels: [{ z: 0, u: 0, v: 0 }, { z: 30000, u: 0, v: 0 }] }];
const small = {
  ventM: 0, heightKm: 4, massKg: 1e9, durationS: 3600,
  grains: grainClasses({ phis: [-2, -1, 0, 1, 2] }), levels: 8, releaseStepS: 900,
  dtS: 60, horizonS: 3600 * 30, K: 800,
};
const calm = simulate({ ...small, profiles: still });
ok(Math.abs(calm.mass.released - 1e9) / 1e9 < 1e-9, "every kilogram is released");
ok(Math.abs(calm.mass.landed + calm.mass.airborne - calm.mass.released) < 1, "landed + airborne = released");
const ext = depositExtent(calm, 200);
const dep = depositGrid(calm, ext);
const onGrid = dep.reduce((a, b) => a + b, 0) * ext.dx * ext.dy;
ok(Math.abs(onGrid - calm.mass.landed) / calm.mass.landed < 0.01, "the deposit integrates to the landed mass",
  `${(onGrid / calm.mass.landed).toFixed(4)}`);
let mx = 0; let my = 0; let mm = 0;
for (let j = 0; j < ext.ny; j += 1) for (let i = 0; i < ext.nx; i += 1) {
  const m = dep[j * ext.nx + i];
  mx += m * (ext.x0 + (i + 0.5) * ext.dx); my += m * (ext.y0 + (j + 0.5) * ext.dy); mm += m;
}
ok(Math.abs(mx / mm) < ext.dx && Math.abs(my / mm) < ext.dx, "with no wind the deposit is centred on the vent",
  `${(mx / mm).toFixed(0)}, ${(my / mm).toFixed(0)} m`);

const east = [{ t: 0, levels: [{ z: 0, u: 15, v: 0 }, { z: 30000, u: 15, v: 0 }] }];
const blown = simulate({ ...small, profiles: east });
const extB = depositExtent(blown, 200);
const depB = depositGrid(blown, extB);
let bx = 0; let by = 0; let bm = 0;
for (let j = 0; j < extB.ny; j += 1) for (let i = 0; i < extB.nx; i += 1) {
  const m = depB[j * extB.nx + i];
  bx += m * (extB.x0 + (i + 0.5) * extB.dx); by += m * (extB.y0 + (j + 0.5) * extB.dy); bm += m;
}
ok(bx / bm > 5000 && Math.abs(by / bm) < extB.dx, "a westerly wind carries the deposit east, not north",
  `${(bx / bm / 1000).toFixed(1)} km east`);
let maxCalm = 0; for (const v of dep) maxCalm = Math.max(maxCalm, v);
let maxB = 0; for (const v of depB) maxB = Math.max(maxB, v);
ok(maxB < maxCalm, "spreading downwind thins the deposit's peak");

// ── Air ──────────────────────────────────────────────────────────────────────
const snapshots = [1800, 7200];
const air = simulate({ ...small, profiles: east, snapshots, grains: grainClasses({ phis: [4, 5, 6] }) });
// The lattice reaches below sea level so a puff about to land is counted whole.
const lat = { x0: -200e3, y0: -100e3, z0: -3000, dx: 4000, dy: 4000, dz: 250, nx: 151, ny: 51, nz: 37 };
const conc = concentrationGrid(air, 1, lat);
let inAir = 0;
const nSnap = snapshots.length;
for (let p = 0; p < air.puffs.length; p += 1) {
  if (Number.isFinite(air.snap[(p * nSnap + 1) * 5])) inAir += air.puffs[p].mass;
}
const integrated = conc.reduce((a, b) => a + b, 0) * lat.dx * lat.dy * lat.dz / 1e6;
ok(inAir > 0 && Math.abs(integrated - inAir) / inAir < 0.05, "the air's ash integrates to the airborne mass",
  `${(integrated / inAir).toFixed(3)}`);
ok(aviationClass(0.1) === 0 && aviationClass(0.2) === 1 && aviationClass(3) === 2 && aviationClass(4) === 3,
  "aviation classes at 0.2, 2 and 4 mg/m³");
ok(depositClass(0.05) === -1 && depositClass(0.5) === 0 && depositClass(1) === 1 && depositClass(500) === 4,
  "deposit classes by thickness");
ok(Math.abs(erf(0.5) - 0.5204998778) < 2e-7 && Math.abs(erf(-1) + 0.8427007929) < 2e-7, "erf to 1e-7");

// ── The wind request and its reading ────────────────────────────────────────
const { windRequest, profilesFrom, windSummary, compass, hourText, HISTORICAL_BASE } = await import("./ash-wind.js");
const NOW = Date.UTC(2026, 9, 11, 9, 30);
const req = windRequest(37.75, 15, Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 12, 14), NOW);
const u = new URL(req.url);
ok(u.searchParams.get("start_hour") === "2026-10-11T14:00" && u.searchParams.get("end_hour") === "2026-10-12T15:00",
  "the request covers the eruption and an hour past it");
ok(u.searchParams.get("wind_speed_unit") === "ms" && u.searchParams.get("models") === "gfs_seamless", "GFS, in m/s");
ok(/wind_direction_250hPa/.test(u.searchParams.get("hourly")), "the pressure levels are asked for");
ok(windRequest(0, 0, Date.UTC(2025, 0, 1), Date.UTC(2025, 0, 2), NOW).base === HISTORICAL_BASE,
  "an eruption long ago asks the historical runs");
let beyond = ""; try { windRequest(0, 0, NOW, NOW + 20 * 86400e3, NOW); } catch (e) { beyond = e.message; }
ok(/sixteen days/.test(beyond), "beyond the forecast is refused in words");
const answer = { hourly: { time: ["2026-10-11T14:00", "2026-10-11T15:00"] }, hourly_units: {} };
for (const p of [850, 500, 250]) {
  answer.hourly[`temperature_${p}hPa`] = [5, 5];
  answer.hourly[`wind_speed_${p}hPa`] = [10, 20];
  answer.hourly[`wind_direction_${p}hPa`] = [270, 270];   // FROM the west
  answer.hourly[`geopotential_height_${p}hPa`] = [1500, 1500].map((x) => x * (p === 850 ? 1 : p === 500 ? 3.8 : 7.2));
  answer.hourly_units[`wind_speed_${p}hPa`] = "m/s";
}
const gfsProf = profilesFrom(answer, Date.UTC(2026, 9, 11, 14), [850, 500, 250]);
ok(gfsProf.length === 2 && gfsProf[1].t === 3600, "profiles in seconds from the start");
ok(Math.abs(gfsProf[0].levels[0].u - 10) < 1e-9 && Math.abs(gfsProf[0].levels[0].v) < 1e-9,
  "a wind FROM the west blows east (u > 0)");
ok(gfsProf[0].levels.every((l, i, a) => !i || l.z > a[i - 1].z), "levels rise");
const sum = windSummary(gfsProf, 5000);
ok(compass(sum.toward) === "E" && Math.abs(sum.speed - 10) < 1e-9, "the summary says east at 10 m/s");
ok(hourText(Date.UTC(2026, 0, 1, 3, 59)) === "2026-01-01T03:00", "hours floor");
