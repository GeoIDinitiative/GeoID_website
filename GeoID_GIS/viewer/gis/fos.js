/**
 * Factor of Safety, per cell, per time step.
 *
 * This is what GeoID mode computes: the prototype's static inputs — slope from
 * the DEM, strength from the geology — combined with a weather surface that
 * changes through the forecast, giving a stack of FoS rasters rather than one
 * susceptibility picture.
 *
 * The model is the **infinite-slope** one, which is what the landslide
 * literature uses for shallow translational failures and what a raster can
 * actually support (it assumes the failure plane is parallel to the ground and
 * long compared with its depth — true of the soil-slip case, false for deep
 * rotational failures, and the tool says so rather than pretending otherwise):
 *
 *     FoS = [ c' + (γ − m·γw)·z·cos²β·tanφ' ] / [ γ·z·sinβ·cosβ ]
 *
 *   c'  effective cohesion (kPa)        φ'  effective friction angle (°)
 *   γ   unit weight of soil (kN/m³)     γw  unit weight of water (9.81)
 *   z   depth to the failure plane (m)  β   slope angle
 *   m   the WET FRACTION of that depth — the only term the weather moves
 *
 * FoS > 1 is stable, < 1 is failure, and the interesting band is 1.0–1.3.
 * Every parameter above is a property of a place except `m`, which is a
 * property of a place AND a moment — which is precisely why this belongs on a
 * time-stepped map rather than in a single layer.
 *
 * Two honesty rules the code enforces:
 *
 * - **Flat ground has no driving stress.** sinβ → 0 makes FoS → ∞, which is
 *   arithmetic rather than insight; cells below a threshold slope return null
 *   ("not applicable"), not a huge number that would dominate any legend.
 * - **m is capped at 1.** Rain beyond saturation does not keep raising pore
 *   pressure in this model, and letting it drives FoS negative, which means
 *   nothing.
 */

export const WATER_UNIT_WEIGHT = 9.81;          // kN/m³

/**
 * THE FAILURE PLANE OF A SHALLOW SLIDE IS NOT THE BASE OF A SEDIMENT BASIN.
 *
 * `z` used to be a per-lithology constant — 1.0 to 2.5 m by class, the same
 * number over a whole map — because there was nothing spatial to put there.
 * Pelletier's thickness raster is spatial and is NOT that number: it models the
 * entire permeable column, up to 50 m in a valley fill, while the infinite
 * slope model above assumes a plane parallel to the ground and long compared
 * with its depth. Handing it 50 m answers a question nobody asked, about a
 * rotational failure this model cannot represent.
 *
 * So the thickness enters as `min(thickness, 3 m)`: a real spatial floor where
 * the cover is thin — which is where shallow failures actually happen and
 * where the old constant was most wrong — and the model's own assumption where
 * it is deep. Both numbers are reported; neither is quietly substituted.
 */
export const SHALLOW_FAILURE_CAP_M = 3;

/** The depth to give one cell, and where it came from. */
export function failureDepth(thicknessM, fallbackM) {
  if (!Number.isFinite(thicknessM)) {
    return { depth: fallbackM, from: "the lithology's default" };
  }
  const capped = Math.min(thicknessM, SHALLOW_FAILURE_CAP_M);
  return {
    depth: capped,
    from: capped < thicknessM
      ? `the modelled thickness (${thicknessM} m), capped at ${SHALLOW_FAILURE_CAP_M} m`
      : "the modelled thickness",
    thickness: thicknessM,
  };
}

/**
 * Typical effective-strength parameters by lithology class.
 *
 * Deliberately coarse and openly sourced from standard engineering-geology
 * ranges — they are a starting point for a screening model, not site
 * investigation values, and the panel that uses them says so. A user with real
 * parameters should override them per class.
 */
export const MATERIAL_DEFAULTS = {
  // class            c' kPa  φ' deg  γ kN/m³  z m
  peat:              { cohesion: 5,  friction: 20, unitWeight: 11, depth: 1.5 },
  clay:              { cohesion: 10, friction: 22, unitWeight: 18, depth: 2.0 },
  silt:              { cohesion: 6,  friction: 27, unitWeight: 18, depth: 2.0 },
  sand:              { cohesion: 2,  friction: 33, unitWeight: 19, depth: 2.0 },
  gravel:            { cohesion: 0,  friction: 36, unitWeight: 20, depth: 2.0 },
  till:              { cohesion: 8,  friction: 30, unitWeight: 20, depth: 2.5 },
  "made ground":     { cohesion: 3,  friction: 28, unitWeight: 18, depth: 2.0 },
  mudstone:          { cohesion: 15, friction: 26, unitWeight: 21, depth: 1.5 },
  sandstone:         { cohesion: 20, friction: 35, unitWeight: 22, depth: 1.5 },
  limestone:         { cohesion: 25, friction: 37, unitWeight: 23, depth: 1.2 },
  basalt:            { cohesion: 30, friction: 40, unitWeight: 24, depth: 1.0 },
  granite:           { cohesion: 30, friction: 42, unitWeight: 25, depth: 1.0 },
  default:           { cohesion: 8,  friction: 30, unitWeight: 19, depth: 2.0 },
};

/** Match a geology description to a material class, or fall back honestly. */
export function materialFor(description) {
  const text = String(description || "").toLowerCase();
  if (!text) return { ...MATERIAL_DEFAULTS.default, matched: null };
  const keys = Object.keys(MATERIAL_DEFAULTS).filter((k) => k !== "default");
  // Longest name first, so "made ground" beats "sand" inside it.
  const hit = keys.sort((a, b) => b.length - a.length).find((k) => text.includes(k));
  return hit
    ? { ...MATERIAL_DEFAULTS[hit], matched: hit }
    : { ...MATERIAL_DEFAULTS.default, matched: null };
}

/**
 * The wet fraction of the soil column at one time step.
 *
 * A bucket, not a groundwater model: rain fills the column at its infiltration
 * capacity and drains at a recession rate, so `m` rises through a wet spell and
 * falls between them. That behaviour — memory of the preceding days — is the
 * whole reason a time-stepped FoS differs from a single rainfall map, and a
 * more elaborate model would need soil data this screening does not have.
 */
export function wetnessSeries(rainMm, {
  capacityMm = 120, drainPerDay = 0.12, initial = 0.2, stepHours = 24,
} = {}) {
  let m = Math.max(0, Math.min(1, initial));
  // Drainage is a RATE. Feeding an hourly series a per-day recession dries the
  // column twenty-four times too fast and every storm vanishes within the hour
  // it fell — which looks exactly like a map that does not respond to rain.
  const drainPerStep = drainPerDay * (Math.max(0.001, stepHours) / 24);
  return (rainMm || []).map((rain) => {
    const add = Number.isFinite(rain) ? Math.max(0, rain) / capacityMm : 0;
    m = Math.min(1, m + add);
    const before = m;
    m = Math.max(0, m - drainPerStep);         // drainage applies to the NEXT step
    return Number(before.toFixed(4));
  });
}

/** Infinite-slope FoS for one cell at one wetness. */
export function factorOfSafety({
  slopeDeg, cohesion, friction, unitWeight, depth, wetFraction,
}, { minSlopeDeg = 5 } = {}) {
  const beta = (Number(slopeDeg) * Math.PI) / 180;
  if (!Number.isFinite(beta)) return null;
  if (Number(slopeDeg) < minSlopeDeg) return null;   // no driving stress worth modelling
  const phi = (Number(friction) * Math.PI) / 180;
  const z = Number(depth);
  const gamma = Number(unitWeight);
  const m = Math.max(0, Math.min(1, Number(wetFraction)));
  if (![phi, z, gamma, m].every(Number.isFinite) || z <= 0 || gamma <= 0) return null;
  const driving = gamma * z * Math.sin(beta) * Math.cos(beta);
  if (driving <= 0) return null;
  const resisting = Number(cohesion)
    + (gamma - m * WATER_UNIT_WEIGHT) * z * Math.cos(beta) ** 2 * Math.tan(phi);
  return Number((resisting / driving).toFixed(4));
}

/** The band a value falls in — the legend the map is read with. */
export function stabilityBand(fos) {
  if (!Number.isFinite(fos)) return null;
  if (fos < 1) return "failure";
  if (fos < 1.1) return "marginal";
  if (fos < 1.3) return "low margin";
  if (fos < 1.5) return "adequate";
  return "stable";
}

/**
 * One FoS grid per time step.
 *
 * `cells` is `[{ slopeDeg, material }]` in raster order, `wetness` the series
 * from `wetnessSeries`. Returns `{ steps: [{ date, values, failing }] }` —
 * values in the same order as the cells, so the caller can wrap them in
 * whatever raster it already has.
 */
export function fosSeries(cells, wetness, dates = [], options = {}) {
  const list = Array.isArray(cells) ? cells : [];
  if (!list.length) return { ok: false, message: "no cells to evaluate" };
  if (!wetness?.length) return { ok: false, message: "no weather steps" };
  const steps = wetness.map((m, i) => {
    const values = new Float32Array(list.length).fill(NaN);
    let failing = 0;
    let applicable = 0;
    list.forEach((cell, j) => {
      const material = cell.material || MATERIAL_DEFAULTS.default;
      const fos = factorOfSafety({
        slopeDeg: cell.slopeDeg,
        cohesion: material.cohesion,
        friction: material.friction,
        unitWeight: material.unitWeight,
        depth: material.depth,
        wetFraction: m,
      }, options);
      if (fos == null) return;
      values[j] = fos;
      applicable += 1;
      if (fos < 1) failing += 1;
    });
    return {
      date: dates[i] || `step ${i + 1}`,
      wetFraction: m,
      values,
      applicable,
      failing,
      failingFraction: applicable ? Number((failing / applicable).toFixed(4)) : 0,
    };
  });
  const worst = steps.reduce((a, b) => (b.failing > a.failing ? b : a), steps[0]);
  return {
    ok: true,
    steps,
    worst: { date: worst.date, failing: worst.failing, wetFraction: worst.wetFraction },
    message: `${steps.length} steps over ${list.length} cells; worst is ${worst.date} `
      + `with ${worst.failing} cells below FoS 1.`,
  };
}

if (typeof window !== "undefined") {
  window.GeoIDFoS = {
    factorOfSafety, wetnessSeries, fosSeries, materialFor, stabilityBand,
    MATERIAL_DEFAULTS, WATER_UNIT_WEIGHT,
  };
}
