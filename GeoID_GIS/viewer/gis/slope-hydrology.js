/**
 * THE HYDROGEOLOGICAL SLOPE MODEL — a static, steady-state one, run once per
 * rainfall map.
 *
 * Shallow landslides start where water CONVERGES: in the hollows at the heads
 * of channels, where the ground upslope drains through a thin soil that cannot
 * pass it all on. A bucket per cell has no upslope, so it cannot see that — a
 * convex nose and the hollow beside it filled at the same rate, and over the
 * May 2023 Emilia-Romagna storm (hundreds of millimetres, over a thousand
 * landslides) the old model found not one failing cell.
 *
 * So this is the SHALSTAB / SINMAP family (Montgomery & Dietrich 1994; Pack,
 * Tarboton & Goodwin 1998), the standard static physically based model:
 *
 *   recharge        r = min(P / Δt, Ks)                       (what infiltrates)
 *   flux            q = Σ_upslope r·A                          (routed, m³/s)
 *   water table     h = min(z_s, q / (b · F·Ks · sin β))       (Darcy, steady)
 *   failure plane   m = clamp((h − (z_s − z_f)) / z_f, 0, 1)
 *   FoS             [c′ + c_r + (γ − m·γw)·z_f·cos²β·tan φ′] / [γ·z_f·sin β·cos β]
 *
 * Every term is a property of the ground: β and the routing from the DEM, z_s
 * from the soil-thickness model, z_f the shallow failure plane within it, and
 * c′, φ′, γ, n and Ks from the material the maps name, read through the
 * rock-properties database — never its INTACT ROCK values, which describe a
 * core in a press, not the regolith a shallow slide happens in.
 *
 * THE RAINFALL TO FAIL is the same equations run backwards: the steady
 * recharge that brings a cell to FoS = 1, which is SHALSTAB's own map and
 * needs no forecast at all. A cell stable even saturated needs infinite rain;
 * one that fails dry needs none.
 */

export const WATER_UNIT_WEIGHT = 9.81;      // kN/m³
export const SHALLOW_FAILURE_CAP_M = 3;     // fos.js's own rule, restated here

/** Cosby et al. (1984), the pedotransfer land-surface models use: Ks from sand and clay %. */
export function cosbyKsat(sandPct, clayPct) {
  if (!Number.isFinite(sandPct) || !Number.isFinite(clayPct)) return null;
  const inPerHour = 10 ** (-0.6 + 0.0126 * sandPct - 0.0064 * clayPct);
  return inPerHour * 0.0254 / 3600;           // m/s
}

/** The dominant fraction of a topsoil texture: the soil entry it reads as. */
export function textureClass({ sand, silt, clay } = {}) {
  const parts = [["sand", sand], ["silt", silt], ["clay", clay]].filter(([, v]) => Number.isFinite(v));
  if (!parts.length) return null;
  // Clay governs a soil's strength well before it is the largest fraction: a
  // loam with 35% clay behaves as a clay on a slope.
  if (Number.isFinite(clay) && clay >= 35) return "clay";
  return parts.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * LATERAL FLOW IS NOT THE MATRIX. A hillslope soil drains downslope through
 * macropores, root channels and soil pipes, one to two orders of magnitude
 * faster than water soaks vertically through its matrix (Beven & Germann
 * 1982; Weiler & McDonnell 2007) — and the vertical matrix value is what a
 * pedotransfer function or a laboratory test gives. Used for lateral flow as
 * it stands, a 2 m loam column saturated at about 1 mm a day on any slope:
 * measured over the Emilia-Romagna storm, every map from 9 mm to 228 mm read
 * as fully saturated and the failing set never moved. F multiplies Ks for the
 * lateral transmissivity T = F·Ks·z_s; 30 puts a typical loam (Ks ≈ 3.5e-6 m/s,
 * 2 m) at 18 m²/day, the low end of the 17–65 m²/day Montgomery & Dietrich
 * (1994) worked with. It is a control, and the card says which was used.
 */
export const LATERAL_FACTOR = 30;

/**
 * THE MATERIAL OF THE FAILING COLUMN, and where each number came from.
 *
 * In order of how directly the map says what the ground is:
 *   1. a SOIL-state material the geology names (a superficial map's till,
 *      alluvium, peat; GLiM's unconsolidated sediments),
 *   2. the FAO soil map's topsoil texture — its dominant fraction for strength,
 *   3. over bedrock, the database's REGOLITH — the weathered mantle, which is
 *      what a shallow slide on a rock map moves.
 *
 * and Ks, separately: Cosby's pedotransfer from the soil map's sand and clay
 * wherever the soil map is on, WHATEVER the material — it describes the soil
 * mantle water actually moves through, where the database's value for a
 * mapped clay (1e-11 m/s) is an intact laboratory sample, and its own note
 * says a weathered, fissured clay is orders of magnitude above it; then the
 * database's value for the material; then a stated default.
 *
 * `rp(name, key)` reads the rock-properties database (typical values);
 * `state(name)` its state ("soil" / "rock").
 */
export function columnMaterial({ lith = null, texture = null, rp, state, strength = "peak", rootCohesionKPa = 0 } = {}) {
  const read = (name, key) => {
    const v = rp?.(name, key);
    return Number.isFinite(v) ? v : null;
  };
  let name = null; let from = null;
  const lithState = lith ? state?.(lith) : null;
  if (lith && lithState === "soil") { name = lith; from = "the mapped deposit"; }
  const tex = texture ? textureClass(texture) : null;
  if (!name && tex) { name = tex; from = `the soil map's topsoil texture (${tex})`; }
  if (!name) { name = "regolith"; from = lith ? `regolith over ${lith}` : "regolith (no map named the ground)"; }
  const phiKey = strength === "residual" ? "residual_friction_angle" : "friction_angle";
  const cKey = strength === "residual" ? "residual_cohesion" : "cohesion";
  const phi = read(name, phiKey) ?? read("regolith", phiKey) ?? 30;
  const cMPa = read(name, cKey) ?? read("regolith", cKey) ?? 0.005;
  const porosityPct = read(name, "porosity") ?? read("regolith", "porosity") ?? 30;
  const density = read(name, "dry_density") ?? read("regolith", "dry_density") ?? 1700;
  const n = Math.max(0.02, Math.min(0.9, porosityPct / 100));
  // Saturated unit weight: the dry solids plus the pores full of water.
  const gamma = ((density / 1000) + n) * WATER_UNIT_WEIGHT;
  const cosby = texture ? cosbyKsat(texture.sand, texture.clay) : null;
  let K = null; let kFrom = null;
  if (Number.isFinite(cosby)) { K = cosby; kFrom = "Cosby et al. (1984) from the soil map's sand and clay"; }
  if (!Number.isFinite(K) && lithState === "soil" && name === lith) { K = read(name, "hydraulic_conductivity"); kFrom = "the database, for the mapped deposit"; }
  if (!Number.isFinite(K)) { K = read(name, "hydraulic_conductivity"); kFrom = `the database's ${name}`; }
  if (!Number.isFinite(K) || K <= 0) { K = 1e-6; kFrom = "a stated default"; }
  return {
    name, from, strength,
    cohesionKPa: Number((cMPa * 1000 + (Number(rootCohesionKPa) || 0)).toFixed(2)),
    rootCohesionKPa: Number(rootCohesionKPa) || 0,
    friction: phi, unitWeight: Number(gamma.toFixed(2)), porosity: n, K, kFrom,
  };
}

/** The soil column: the thickness above bedrock and the shallow failure plane in it. */
export function soilColumn(thicknessM, fallbackM = 2) {
  if (Number.isFinite(thicknessM)) {
    if (thicknessM <= 0) return { zs: 0, zf: 0, bare: true, from: "bare rock (the thickness model's 0 m)" };
    return { zs: thicknessM, zf: Math.min(thicknessM, SHALLOW_FAILURE_CAP_M), bare: false, from: "the soil-thickness model" };
  }
  return { zs: fallbackM, zf: Math.min(fallbackM, SHALLOW_FAILURE_CAP_M), bare: false, from: "a stated default (no thickness here)" };
}

/** Steady Darcy water table: h = q / (b·F·K·sin β), as a fraction of the column. */
export function steadyWetness({ q, b, K, zs, slopeRad, lateral = 1 }) {
  if (!(zs > 0) || !(K > 0) || !(b > 0)) return NaN;
  const s = Math.sin(slopeRad);
  if (!(q > 0)) return 0;
  if (!(s > 1e-6)) return 1;
  return Math.min(1, q / (b * K * lateral * s * zs));
}

/** Water above the failure plane, as a fraction of it, from the table's height. */
export function planeWetness(W, zs, zf) {
  if (!Number.isFinite(W) || !(zf > 0)) return NaN;
  const h = W * zs;
  return Math.max(0, Math.min(1, (h - (zs - zf)) / zf));
}

export function factorOfSafety({ slopeRad, c, phi, gamma, zf, m }) {
  const phiR = phi * Math.PI / 180;
  const cos = Math.cos(slopeRad); const sin = Math.sin(slopeRad);
  const driving = gamma * zf * sin * cos;
  if (!(driving > 0)) return NaN;
  return (c + (gamma - m * WATER_UNIT_WEIGHT) * zf * cos * cos * Math.tan(phiR)) / driving;
}

/**
 * THE RAINFALL TO FAIL, in mm a day of steady recharge over the cell's whole
 * contributing area — or `Infinity` (stable even saturated) or `0` (fails
 * dry). `areaM2` is the upslope area including the cell.
 */
export function criticalRecharge({ slopeRad, c, phi, gamma, zs, zf, K, b, areaM2, lateral = 1 }) {
  const phiR = phi * Math.PI / 180;
  const cos = Math.cos(slopeRad); const sin = Math.sin(slopeRad);
  const denom = WATER_UNIT_WEIGHT * zf * cos * cos * Math.tan(phiR);
  if (!(denom > 0) || !(areaM2 > 0)) return NaN;
  const mCrit = (c + gamma * zf * cos * cos * Math.tan(phiR) - gamma * zf * sin * cos) / denom;
  if (mCrit >= 1) return Infinity;
  if (mCrit <= 0) return 0;
  const h = (zs - zf) + mCrit * zf;
  const q = b * K * lateral * sin * h;          // m³/s at the cell
  return (q / areaM2) * 86400 * 1000;           // mm/day over the area
}

/** The classes the map is read with, from the factor of safety. */
export const FOS_CLASSES = [
  { max: 1, label: "failure (< 1)", colour: [215, 25, 28] },
  { max: 1.1, label: "marginal (1–1.1)", colour: [253, 141, 60] },
  { max: 1.3, label: "low margin (1.1–1.3)", colour: [254, 217, 118] },
  { max: 1.5, label: "adequate (1.3–1.5)", colour: [161, 218, 180] },
  { max: Infinity, label: "stable (≥ 1.5)", colour: [44, 127, 184] },
];

export function fosClass(v) {
  if (!Number.isFinite(v)) return -1;
  return FOS_CLASSES.findIndex((k) => v < k.max);
}
