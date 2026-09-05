/**
 * The Factor of Safety engine, against cases whose answer is known from the
 * model itself rather than from a previous run.
 *
 * The infinite-slope equation has three behaviours that must hold or the map
 * is worse than nothing: FoS falls as the slope steepens, falls as the ground
 * wets, and rises with cohesion and friction. Everything else is bookkeeping.
 */

import {
  factorOfSafety, wetnessSeries, fosSeries, materialFor, stabilityBand,
  MATERIAL_DEFAULTS, WATER_UNIT_WEIGHT, failureDepth, SHALLOW_FAILURE_CAP_M,
} from "./fos.js";

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}
function ok(condition, what) { if (!condition) throw new Error(what); }

const CELL = { slopeDeg: 25, cohesion: 8, friction: 30, unitWeight: 19, depth: 2, wetFraction: 0 };

check("a dry slope matches the equation worked by hand", () => {
  // β=25°, c'=8, φ'=30, γ=19, z=2, m=0
  //   driving   = 19·2·sin25·cos25            = 14.556
  //   resisting = 8 + 19·2·cos²25·tan30       = 8 + 18.023 = 26.023
  //   FoS       = 1.7878
  near(factorOfSafety(CELL), 1.788, 0.01, "dry FoS");
});

check("wetting the column lowers it, saturation lowers it most", () => {
  const dry = factorOfSafety({ ...CELL, wetFraction: 0 });
  const half = factorOfSafety({ ...CELL, wetFraction: 0.5 });
  const wet = factorOfSafety({ ...CELL, wetFraction: 1 });
  if (!(dry > half && half > wet)) throw new Error(`not monotonic: ${dry} ${half} ${wet}`);
  // At m=1 the buoyant weight is (19 − 9.81) = 9.19, so the frictional term
  // falls by just over half while cohesion is untouched.
  near(wet, (8 + (19 - WATER_UNIT_WEIGHT) * 2 * Math.cos(25 * Math.PI / 180) ** 2
    * Math.tan(30 * Math.PI / 180)) / (19 * 2 * Math.sin(25 * Math.PI / 180)
    * Math.cos(25 * Math.PI / 180)), 0.001, "saturated FoS");
});

check("steeper is less safe", () => {
  const gentle = factorOfSafety({ ...CELL, slopeDeg: 15 });
  const steep = factorOfSafety({ ...CELL, slopeDeg: 40 });
  if (!(gentle > steep)) throw new Error(`${gentle} should exceed ${steep}`);
});

check("stronger material is safer", () => {
  const weak = factorOfSafety({ ...CELL, cohesion: 0, friction: 20 });
  const strong = factorOfSafety({ ...CELL, cohesion: 25, friction: 38 });
  if (!(strong > weak)) throw new Error("strength did not help");
});

check("flat ground is not applicable, not infinitely safe", () => {
  eq(factorOfSafety({ ...CELL, slopeDeg: 2 }), null, "2 degrees");
  eq(factorOfSafety({ ...CELL, slopeDeg: 0 }), null, "flat");
});

check("nonsense in is null out, never a number", () => {
  eq(factorOfSafety({ ...CELL, depth: 0 }), null, "no depth");
  eq(factorOfSafety({ ...CELL, unitWeight: 0 }), null, "no weight");
  eq(factorOfSafety({ ...CELL, slopeDeg: NaN }), null, "no slope");
});

check("wetness cannot exceed saturation however hard it rains", () => {
  const m = wetnessSeries([500, 500, 500]);
  m.forEach((v) => { if (v > 1) throw new Error(`m reached ${v}`); });
});

check("the column remembers: it dries between storms", () => {
  const m = wetnessSeries([60, 0, 0, 0, 0], { capacityMm: 120, drainPerDay: 0.1, initial: 0 });
  eq(m[0] > 0, true, "the storm wets it");
  if (!(m[1] < m[0] && m[2] < m[1])) throw new Error("no recession");
  // Memory, not instant reset: two days later it is still wetter than it began.
  if (!(m[2] > 0)) throw new Error("the column forgot the storm immediately");
});

check("a dry spell after a wet one is what makes FoS time-varying", () => {
  const m = wetnessSeries([80, 40, 0, 0, 0, 0], { capacityMm: 120, drainPerDay: 0.15, initial: 0.1 });
  const fos = m.map((w) => factorOfSafety({ ...CELL, wetFraction: w }));
  const min = Math.min(...fos);
  const last = fos[fos.length - 1];
  if (!(last > min)) throw new Error("the slope never recovered");
});

check("the bands split at the values engineers read them at", () => {
  eq(stabilityBand(0.9), "failure", "below one");
  eq(stabilityBand(1.05), "marginal", "just above");
  eq(stabilityBand(1.2), "low margin", "1.2");
  eq(stabilityBand(1.4), "adequate", "1.4");
  eq(stabilityBand(2), "stable", "2");
  eq(stabilityBand(null), null, "not applicable");
});

check("lithology maps to strength, longest name first", () => {
  eq(materialFor("MADE GROUND, SAND AND GRAVEL").matched, "made ground", "compound name");
  eq(materialFor("BASALT LAVA").matched, "basalt", "basalt");
  eq(materialFor("SOMETHING UNRECORDED").matched, null, "unmatched falls back");
  eq(materialFor("").cohesion, MATERIAL_DEFAULTS.default.cohesion, "empty");
});

check("a series gives one grid per step and names its worst", () => {
  const cells = [
    { slopeDeg: 35, material: MATERIAL_DEFAULTS.peat },
    { slopeDeg: 30, material: MATERIAL_DEFAULTS.sand },
    { slopeDeg: 2, material: MATERIAL_DEFAULTS.clay },     // flat: not applicable
  ];
  const wet = wetnessSeries([0, 100, 0], { capacityMm: 100, drainPerDay: 0.2, initial: 0 });
  const out = fosSeries(cells, wet, ["d1", "d2", "d3"]);
  eq(out.ok, true, "ok");
  eq(out.steps.length, 3, "steps");
  eq(out.steps[0].applicable, 2, "the flat cell is excluded");
  if (!(out.steps[1].failing >= out.steps[0].failing)) {
    throw new Error("the wet day was not worse than the dry one");
  }
  eq(out.worst.date, out.steps.reduce((a, b) => (b.failing > a.failing ? b : a)).date, "worst named");
});

check("empty inputs are refused with a reason", () => {
  eq(fosSeries([], [0.5]).ok, false, "no cells");
  eq(fosSeries([{ slopeDeg: 30 }], []).ok, false, "no steps");
});

/* ── the depth, which was the last term that was not a property of the place ─
   c′, φ′ and γ come from the mapped lithology, β from the DEM, m from the
   weather — and z was 1.0 to 2.5 m by lithology class over the whole map.
   Pelletier's raster answers it per kilometre, and is NOT that number: it
   models the entire permeable column, up to 50 m in a valley fill, while this
   model assumes a plane parallel to the ground. */
check("a thin cover is used as measured", () => {
  const z = failureDepth(1.2, 2.0);
  near(z.depth, 1.2, 1e-9, "the model's own number");
  ok(/modelled thickness/.test(z.from) && !/capped/.test(z.from), z.from);
});

check("a deep basin is capped, and the cap says what it did", () => {
  const z = failureDepth(50, 2.0);
  near(z.depth, SHALLOW_FAILURE_CAP_M, 1e-9, "capped");
  ok(/50 m/.test(z.from) && /capped/.test(z.from), z.from);
  eq(z.thickness, 50, "and the model's number survives beside it");
});

check("no reading leaves the lithology's own default standing", () => {
  const z = failureDepth(null, 2.5);
  near(z.depth, 2.5, 1e-9, "the class default");
  ok(/default/.test(z.from), z.from);
  eq(z.thickness, undefined, "with no thickness claimed");
});

/**
 * The point of the whole exercise: where the cover is thin — which is where
 * shallow failures actually happen and where the constant was most wrong — the
 * modelled depth changes the answer.
 */
check("a thinner column is less stable, all else equal", () => {
  const base = { slopeDeg: 30, cohesion: 8, friction: 30, unitWeight: 19, wetFraction: 0.5 };
  const thin = factorOfSafety({ ...base, depth: failureDepth(0.5, 2).depth });
  const deep = factorOfSafety({ ...base, depth: failureDepth(20, 2).depth });
  ok(thin > deep, `cohesion carries a thin column: ${thin} against ${deep}`);
  ok(deep === factorOfSafety({ ...base, depth: SHALLOW_FAILURE_CAP_M }),
    "and a deep one is the capped case exactly");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
