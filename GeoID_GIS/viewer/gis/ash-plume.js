/**
 * Ash from an eruption: where it goes in the air, and where it lands.
 *
 * A Lagrangian puff model of the Tephra2 / HAZMAP family (Bonadonna et al.
 * 2005; Macedonio et al. 2005), pure and DOM-free so every claim it makes is
 * checked in Node. What it does, in the order the physics happens:
 *
 *   1. **Source.** An eruption of a given size is a column height H above the
 *      vent and a total erupted mass M. The mass leaves the vent at the rate
 *      the plume height implies — Mastin et al. (2009), H = 2.00 Q^0.241 with
 *      Q the dense-rock-equivalent volume rate in m³/s — so the duration is
 *      M over that rate, never a free number.
 *   2. **Release height.** Mass is let go up the column by Suzuki's (1983)
 *      distribution, f(z) ∝ (1 − z/H)·exp(A(z/H − 1)), most of it near the top
 *      for A = 4 — where the column spreads as an umbrella.
 *   3. **Grain size.** The mass is split over φ classes by a normal
 *      distribution in φ, each class with its own density (pumice light,
 *      fine glass dense; Bonadonna & Phillips 2003) and settling velocity
 *      (Stokes, intermediate and turbulent regimes, in air whose density
 *      falls with height).
 *   4. **Transport.** Each puff — one release time, one height, one grain
 *      class — falls at its settling velocity while the WIND AT ITS OWN
 *      HEIGHT AND TIME carries it, and spreads as a Gaussian whose variance
 *      grows as σ² = σ₀² + 2K·t (Fickian horizontal diffusion).
 *   5. **Deposit.** A puff that reaches the ground lays its mass down as a
 *      2D Gaussian of its width at landing; summed, the ground load in kg/m²,
 *      which at a deposit density of 1,000 kg/m³ is millimetres of ash.
 *   6. **Concentration.** A puff still in the air is a 3D Gaussian, so the
 *      ash in a lattice of air at any instant is the sum over the puffs
 *      airborne then — in mg/m³, the unit aviation thresholds are set in.
 *
 * WHAT IT IS NOT, said where it is used as well as here: the wind is ONE
 * column over the vent (as Tephra2's is), so curvature of a plume crossing a
 * weather system is not captured; the column is not modelled dynamically, it
 * is given; aggregation of fine ash is not modelled, so far-field fines land
 * later and farther than in a real deposit. It is a screening model — an
 * order of magnitude, correctly placed downwind — not a forecast.
 *
 * Frame: local east/north metres about the vent, z metres above sea level.
 */

const G = 9.80665;
const MU_AIR = 1.81e-5;          // dynamic viscosity of air, Pa·s
const RHO_AIR0 = 1.225;          // sea-level air density, kg/m³
const SCALE_HEIGHT = 8200;       // m
const RHO_DRE = 2500;            // dense rock equivalent, kg/m³
export const DEPOSIT_DENSITY = 1000; // kg/m³ — 1 kg/m² is 1 mm

/**
 * An eruption by its Volcanic Explosivity Index: a column height and a total
 * erupted (tephra) mass. The masses are the middle of each VEI's bulk volume
 * band (Newhall & Self 1982) at a bulk density of ~1,000 kg/m³, the heights
 * the middle of its column band. A size is a STARTING POINT a reader can
 * change, not a claim about a particular volcano.
 */
export const ERUPTION_SIZES = {
  1: { vei: 1, label: "very small", heightKm: 2, massKg: 3e8 },
  2: { vei: 2, label: "small", heightKm: 5, massKg: 3e9 },
  3: { vei: 3, label: "moderate", heightKm: 12, massKg: 3e10 },
  4: { vei: 4, label: "large", heightKm: 20, massKg: 3e11 },
  5: { vei: 5, label: "very large", heightKm: 28, massKg: 3e12 },
};

/** Size words a prompt uses, to a VEI. */
export const SIZE_WORDS = [
  [/\b(tiny|very small|minor|weak)\b/, 1],
  [/\b(small|little|modest)\b/, 2],
  [/\b(moderate|medium|mid-?sized?)\b/, 3],
  [/\b(large|big|strong|major|sub-?plinian)\b/, 4],
  [/\b(very large|huge|massive|plinian|catastrophic|enormous)\b/, 5],
];

/**
 * The mass eruption rate a column height implies, kg/s. Mastin et al. (2009):
 * H [km above the vent] = 2.00 · Q^0.241, Q the DRE volume rate in m³/s.
 */
export function massEruptionRate(heightKm) {
  const q = (Math.max(0.1, heightKm) / 2) ** (1 / 0.241);
  return q * RHO_DRE;
}

/** How long an eruption of this mass and column height lasts, s. */
export function eruptionDuration(massKg, heightKm) {
  return massKg / massEruptionRate(heightKm);
}

/** Air density at a height above sea level, kg/m³ (isothermal exponential). */
export function airDensityAt(z) {
  return RHO_AIR0 * Math.exp(-Math.max(0, z) / SCALE_HEIGHT);
}

/**
 * Suzuki release weights over `n` equal levels between the vent and the top
 * of the column, as fractions that sum to 1 (level i at the middle of band i).
 */
export function suzukiWeights(n, A = 4) {
  const w = [];
  for (let i = 0; i < n; i += 1) {
    const s = (i + 0.5) / n;                 // z / H, above the vent
    w.push((1 - s) * Math.exp(A * (s - 1)));
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/** Particle density by size: pumice for coarse lapilli, glass for fine ash. */
export function particleDensity(phi) {
  const coarse = 1000; const fine = 2500;
  if (phi <= -1) return coarse;
  if (phi >= 4) return fine;
  return coarse + ((phi + 1) / 5) * (fine - coarse);
}

/**
 * The grain classes, each with a diameter, a density and the fraction of the
 * mass it carries: a normal distribution in φ (φ = −log₂ d[mm]), cut into
 * unit bins and renormalised over the bins kept.
 */
export function grainClasses({ meanPhi = 1, sdPhi = 1.5, phis = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6] } = {}) {
  const dens = phis.map((p) => Math.exp(-0.5 * ((p - meanPhi) / sdPhi) ** 2));
  const sum = dens.reduce((a, b) => a + b, 0);
  return phis.map((phi, i) => ({
    phi,
    d: 2 ** -phi / 1000,                     // metres
    rho: particleDensity(phi),
    fraction: dens[i] / sum,
  }));
}

/**
 * Terminal settling velocity of a sphere in air, m/s, at a height: Stokes
 * for small Reynolds numbers, the intermediate regime (Kunii & Levenspiel)
 * above Re 0.4, and Newton's turbulent regime above 500 — the scheme Tephra2
 * and Bonadonna et al. (1998) use.
 */
export function settlingVelocity(d, rhoP, z = 0) {
  const rhoA = airDensityAt(z);
  const stokes = (G * d * d * (rhoP - rhoA)) / (18 * MU_AIR);
  if ((rhoA * stokes * d) / MU_AIR < 0.4) return stokes;
  const inter = d * ((4 * rhoP * rhoP * G * G) / (225 * MU_AIR * rhoA)) ** (1 / 3);
  if ((rhoA * inter * d) / MU_AIR < 500) return inter;
  return Math.sqrt((3.1 * rhoP * G * d) / rhoA);
}

/**
 * The wind at a height in one profile ([{z, u, v}] rising), m/s, linear
 * between levels and held at the ends — below the lowest level the lowest
 * wind, above the highest the highest.
 */
export function windAt(levels, z) {
  if (!levels?.length) return [0, 0];
  if (z <= levels[0].z) return [levels[0].u, levels[0].v];
  const top = levels[levels.length - 1];
  if (z >= top.z) return [top.u, top.v];
  let i = 1;
  while (levels[i].z < z) i += 1;
  const a = levels[i - 1]; const b = levels[i];
  const t = (z - a.z) / (b.z - a.z);
  return [a.u + t * (b.u - a.u), a.v + t * (b.v - a.v)];
}

/**
 * The wind at a height and a time, from profiles at times ([{t, levels}],
 * t in seconds from the eruption's start, rising): linear in time between the
 * two profiles either side, held at the ends.
 */
export function windAtTime(profiles, t, z) {
  if (!profiles?.length) return [0, 0];
  if (t <= profiles[0].t) return windAt(profiles[0].levels, z);
  const last = profiles[profiles.length - 1];
  if (t >= last.t) return windAt(last.levels, z);
  let i = 1;
  while (profiles[i].t < t) i += 1;
  const a = profiles[i - 1]; const b = profiles[i];
  const f = (t - a.t) / (b.t - a.t);
  const wa = windAt(a.levels, z); const wb = windAt(b.levels, z);
  return [wa[0] + f * (wb[0] - wa[0]), wa[1] + f * (wb[1] - wa[1])];
}

/**
 * Run the model.
 *
 *   ventM        vent height above sea level, m
 *   heightKm     column height ABOVE THE VENT, km
 *   massKg       total erupted mass, kg
 *   profiles     [{t, levels: [{z, u, v}]}] — the wind over the vent
 *   snapshots    times (s from the start) at which to record airborne puffs
 *   horizonS     how long to follow the puffs (s from the start)
 *   groundAt     (x, y) → ground height, m (default sea level)
 *
 * Returns the puffs (release time, mass, grain class), where each landed
 * (x, y, σ, t) and where each was at every snapshot (x, y, z, σ, or NaN when
 * not airborne then), with the mass accounting: released, landed, still
 * airborne at the horizon.
 */
export function simulate({
  ventM = 0, heightKm, massKg, durationS = null, profiles = [],
  grains = grainClasses(), levels = 20, suzukiA = 4,
  releaseStepS = null, dtS = 120, horizonS = null, snapshots = [],
  K = 1000, Kz = 5, groundAt = () => 0,
} = {}) {
  const H = heightKm * 1000;
  const duration = durationS ?? eruptionDuration(massKg, heightKm);
  const horizon = horizonS ?? duration + 24 * 3600;
  const relStep = releaseStepS ?? Math.max(300, Math.min(1800, duration / 24));
  const releases = Math.max(1, Math.round(duration / relStep));
  const weights = suzukiWeights(levels, suzukiA);
  const sigma0 = Math.max(250, 0.1 * H);
  const sigmaZ0 = H / levels / 2;
  const nSnap = snapshots.length;

  const puffs = [];
  for (let r = 0; r < releases; r += 1) {
    const tRel = (r + 0.5) * (duration / releases);
    for (let k = 0; k < levels; k += 1) {
      const zRel = ventM + ((k + 0.5) / levels) * H;
      for (let g = 0; g < grains.length; g += 1) {
        const mass = (massKg / releases) * weights[k] * grains[g].fraction;
        if (mass <= 0) continue;
        puffs.push({ tRel, zRel, grain: g, mass });
      }
    }
  }

  const landX = new Float64Array(puffs.length).fill(NaN);
  const landY = new Float64Array(puffs.length).fill(NaN);
  const landS = new Float64Array(puffs.length).fill(NaN);
  const landT = new Float64Array(puffs.length).fill(NaN);
  const snap = new Float32Array(puffs.length * nSnap * 5).fill(NaN);
  let landed = 0; let airborne = 0;

  for (let p = 0; p < puffs.length; p += 1) {
    const puff = puffs[p];
    const gr = grains[puff.grain];
    let x = 0; let y = 0; let z = puff.zRel; let t = puff.tRel;
    let si = 0;
    while (si < nSnap && snapshots[si] < t) si += 1;
    let done = false;
    while (!done && t < horizon) {
      const vs = settlingVelocity(gr.d, gr.rho, z);
      const ground = groundAt(x, y);
      // Step no further than lands it, so a fast lapillus is not carried a
      // whole step past the ground it has already hit.
      const tToGround = (z - ground) / vs;
      const dt = Math.min(dtS, Math.max(1e-3, tToGround), horizon - t);
      const [u, v] = windAtTime(profiles, t + dt / 2, z - (vs * dt) / 2);
      const nx = x + u * dt; const ny = y + v * dt; const nz = z - vs * dt;
      const nt = t + dt;
      while (si < nSnap && snapshots[si] <= nt) {
        const f = (snapshots[si] - t) / dt;
        const age = snapshots[si] - puff.tRel;
        const o = (p * nSnap + si) * 5;
        snap[o] = x + f * (nx - x);
        snap[o + 1] = y + f * (ny - y);
        snap[o + 2] = z + f * (nz - z);
        snap[o + 3] = Math.sqrt(sigma0 * sigma0 + 2 * K * age);
        snap[o + 4] = Math.sqrt(sigmaZ0 * sigmaZ0 + 2 * Kz * age);
        si += 1;
      }
      x = nx; y = ny; z = nz; t = nt;
      if (z <= groundAt(x, y) + 1e-6) {
        landX[p] = x; landY[p] = y; landT[p] = t;
        landS[p] = Math.sqrt(sigma0 * sigma0 + 2 * K * (t - puff.tRel));
        landed += puff.mass;
        done = true;
      }
    }
    if (!done) airborne += puff.mass;
  }

  return {
    puffs, landX, landY, landS, landT, snap, snapshots: snapshots.slice(),
    grains, params: { ventM, heightKm, massKg, duration, horizon, K, Kz, sigma0, releases, levels },
    mass: { released: puffs.reduce((a, b) => a + b.mass, 0), landed, airborne },
  };
}

/**
 * The deposit by a time, kg/m² (= mm at 1,000 kg/m³), on a grid
 * { x0, y0, dx, dy, nx, ny } (cell centres at x0 + (i + ½)dx). Each landed
 * puff lays its mass down as a 2D Gaussian of its width at landing; the
 * kernel is integrated over each cell (erf), so a puff narrower than a cell
 * still puts all its mass in the cells it falls in.
 */
export function depositGrid(result, grid, untilS = Infinity) {
  const { x0, y0, dx, dy, nx, ny } = grid;
  const out = new Float32Array(nx * ny);
  const area = dx * dy;
  for (let p = 0; p < result.puffs.length; p += 1) {
    const t = result.landT[p];
    if (!(t <= untilS)) continue;
    const m = result.puffs[p].mass;
    const cx = result.landX[p]; const cy = result.landY[p]; const s = result.landS[p];
    const i0 = Math.max(0, Math.floor((cx - 4 * s - x0) / dx));
    const i1 = Math.min(nx - 1, Math.floor((cx + 4 * s - x0) / dx));
    const j0 = Math.max(0, Math.floor((cy - 4 * s - y0) / dy));
    const j1 = Math.min(ny - 1, Math.floor((cy + 4 * s - y0) / dy));
    if (i1 < i0 || j1 < j0) continue;
    const wx = cellWeights(cx, s, x0, dx, i0, i1);
    const wy = cellWeights(cy, s, y0, dy, j0, j1);
    for (let j = j0; j <= j1; j += 1) {
      const fy = wy[j - j0];
      if (!fy) continue;
      for (let i = i0; i <= i1; i += 1) out[j * nx + i] += (m * fy * wx[i - i0]) / area;
    }
  }
  return out;
}

/** The share of a 1D Gaussian (centre c, σ) falling in each cell from a to b. */
function cellWeights(c, s, origin, step, a, b) {
  const w = new Float64Array(b - a + 1);
  for (let i = a; i <= b; i += 1) {
    const lo = origin + i * step; const hi = lo + step;
    w[i - a] = 0.5 * (erf((hi - c) / (s * Math.SQRT2)) - erf((lo - c) / (s * Math.SQRT2)));
  }
  return w;
}

/** Abramowitz & Stegun 7.1.26 — |error| < 1.5e-7. */
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-a * a);
  return sign * y;
}

/**
 * Ash in the air at snapshot `k`, mg/m³, on a lattice
 * { x0, y0, z0, dx, dy, dz, nx, ny, nz } of NODES (node i at x0 + i·dx).
 * Each airborne puff is a 3D Gaussian (σ horizontal, σz vertical).
 */
export function concentrationGrid(result, k, lattice) {
  const { x0, y0, z0, dx, dy, dz, nx, ny, nz } = lattice;
  const out = new Float32Array(nx * ny * nz);
  const nSnap = result.snapshots.length;
  const norm = (2 * Math.PI) ** 1.5;
  for (let p = 0; p < result.puffs.length; p += 1) {
    const o = (p * nSnap + k) * 5;
    const x = result.snap[o];
    if (!Number.isFinite(x)) continue;
    const y = result.snap[o + 1]; const z = result.snap[o + 2];
    const s = result.snap[o + 3]; const sz = result.snap[o + 4];
    const c0 = (result.puffs[p].mass * 1e6) / (norm * s * s * sz);   // mg/m³ at the centre
    const i0 = Math.max(0, Math.ceil((x - 3 * s - x0) / dx));
    const i1 = Math.min(nx - 1, Math.floor((x + 3 * s - x0) / dx));
    const j0 = Math.max(0, Math.ceil((y - 3 * s - y0) / dy));
    const j1 = Math.min(ny - 1, Math.floor((y + 3 * s - y0) / dy));
    const l0 = Math.max(0, Math.ceil((z - 3 * sz - z0) / dz));
    const l1 = Math.min(nz - 1, Math.floor((z + 3 * sz - z0) / dz));
    for (let l = l0; l <= l1; l += 1) {
      const ez = Math.exp(-(((z0 + l * dz - z) / sz) ** 2) / 2);
      for (let j = j0; j <= j1; j += 1) {
        const ey = Math.exp(-(((y0 + j * dy - y) / s) ** 2) / 2);
        for (let i = i0; i <= i1; i += 1) {
          const ex = Math.exp(-(((x0 + i * dx - x) / s) ** 2) / 2);
          out[(l * ny + j) * nx + i] += c0 * ex * ey * ez;
        }
      }
    }
  }
  return out;
}

/**
 * The aviation ash thresholds (ICAO / EASA): 0.2, 2 and 4 mg/m³ — the
 * boundaries of low, medium and high contamination. Each node's class.
 */
export const AVIATION_THRESHOLDS = [0.2, 2, 4];
export const AVIATION_CLASSES = ["below 0.2 mg/m³", "low (0.2–2)", "medium (2–4)", "high (≥ 4)"];

export function aviationClass(mgPerM3) {
  if (!(mgPerM3 >= AVIATION_THRESHOLDS[0])) return 0;
  if (mgPerM3 < AVIATION_THRESHOLDS[1]) return 1;
  if (mgPerM3 < AVIATION_THRESHOLDS[2]) return 2;
  return 3;
}

/**
 * Deposit thickness classes, mm, with what each means on the ground — the
 * thresholds of the ash-impact literature (Wilson et al. 2012; Jenkins et al.
 * 2015): 1 mm closes airports and disrupts roads, 10 mm damages crops and
 * vehicles, 100 mm loads weak roofs, 300 mm collapses them.
 */
export const DEPOSIT_CLASSES = [
  { min: 0.1, label: "0.1–1 mm — a dusting; airports and runways affected", colour: [255, 245, 200] },
  { min: 1, label: "1–10 mm — roads and power disrupted, eyes and lungs", colour: [253, 208, 120] },
  { min: 10, label: "10–100 mm — crops, vehicles and water supply damaged", colour: [244, 140, 60] },
  { min: 100, label: "100–300 mm — weak roofs loaded, gutters fail", colour: [200, 60, 40] },
  { min: 300, label: "≥ 300 mm — roofs collapse", colour: [110, 20, 40] },
];

export function depositClass(mm) {
  let c = -1;
  for (let i = 0; i < DEPOSIT_CLASSES.length; i += 1) if (mm >= DEPOSIT_CLASSES[i].min) c = i;
  return c;
}

/**
 * A grid covering where the puffs landed, padded by three of their widths,
 * with at most `cells` cells on its longer side and square cells.
 */
export function depositExtent(result, cells = 240, untilS = Infinity) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let p = 0; p < result.puffs.length; p += 1) {
    if (!(result.landT[p] <= untilS)) continue;
    const s = 3 * result.landS[p];
    minX = Math.min(minX, result.landX[p] - s); maxX = Math.max(maxX, result.landX[p] + s);
    minY = Math.min(minY, result.landY[p] - s); maxY = Math.max(maxY, result.landY[p] + s);
  }
  if (!Number.isFinite(minX)) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  const step = span / cells;
  const nx = Math.max(2, Math.ceil((maxX - minX) / step));
  const ny = Math.max(2, Math.ceil((maxY - minY) / step));
  return { x0: minX, y0: minY, dx: step, dy: step, nx, ny };
}
