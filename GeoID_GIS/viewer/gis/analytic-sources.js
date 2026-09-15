/**
 * ANALYTICAL SOURCES: the closed-form deformation a FEM run is checked
 * against, and the simplest source that explains what was measured.
 *
 * The Mogi point source (Mogi 1958; the form in Segall 2010, eq. 7.14): a
 * small spherical cavity whose volume changes by ΔV at depth d in a uniform,
 * isotropic elastic half-space with Poisson's ratio ν. At the free surface,
 * at horizontal offset (dx, dy) and R = √(dx² + dy² + d²),
 *
 *     u_x = C dx / R³     u_y = C dy / R³     u_z = C d / R³,   C = (1 − ν) ΔV / π
 *
 * and for a pressure change ΔP in a sphere of radius a in shear modulus G,
 * ΔV = π a³ ΔP / G. The point-source limit holds while a ≪ d; McTigue (1987)
 * is the finite-sphere correction and is not applied here.
 *
 * Why it belongs on the model page: a FEM run of a spherical chamber in a
 * flat, uniform box must reproduce this away from the box's walls, so the
 * comparison is a benchmark of the mesh, the boundary conditions and the
 * material. Where the run has topography or layering, the difference is what
 * those add. And because u is LINEAR in ΔV, the best ΔV for any geometry is
 * one least-squares number, so a source can be inverted by searching position
 * and depth alone.
 *
 * Pure. Coordinates are metres in the mesh's frame (x east, y north, z up);
 * the source's depth is below the free surface at `surfaceZ`.
 */

/** Surface displacement [ux, uy, uz] of a Mogi source at (x, y). */
export function mogi({ x0 = 0, y0 = 0, depth, dV, nu = 0.25 }, x, y) {
  const dx = x - x0;
  const dy = y - y0;
  const R2 = dx * dx + dy * dy + depth * depth;
  const k = ((1 - nu) * dV) / (Math.PI * R2 * Math.sqrt(R2));
  return [k * dx, k * dy, k * depth];
}

/** ΔV of a sphere of radius a under ΔP in shear modulus G (point-source limit). */
export const volumeFromPressure = (dP, radius, G) => (Math.PI * radius ** 3 * dP) / G;

/** Shear modulus from Young's modulus and Poisson's ratio. */
export const shearModulus = (E, nu) => E / (2 * (1 + nu));

/**
 * Stations flattened for the search: positions, observed components and
 * weights in typed arrays, so a trial costs arithmetic and no allocation.
 * Each station contributes up to three components [e, n, u], or one LOS.
 */
export function packStations(stations, los = null) {
  const rows = [];
  for (const s of stations) {
    const comps = los ? 1 : 3;
    for (let j = 0; j < comps; j += 1) {
      const d = s.obs[j];
      if (!Number.isFinite(d)) continue;
      const sig = s.sigma?.[j];
      rows.push([s.x, s.y, j, d, sig > 0 ? 1 / (sig * sig) : 1]);
    }
  }
  const n = rows.length;
  const P = { n, x: new Float64Array(n), y: new Float64Array(n), c: new Uint8Array(n), d: new Float64Array(n), w: new Float64Array(n), los };
  rows.forEach((r, k) => { P.x[k] = r[0]; P.y[k] = r[1]; P.c[k] = r[2]; P.d[k] = r[3]; P.w[k] = r[4]; });
  let sdd = 0;
  for (let k = 0; k < n; k += 1) sdd += P.w[k] * P.d[k] * P.d[k];
  P.sdd = sdd;
  // Weighted when any component carries a sigma: the misfit is then χ², not metres².
  P.weighted = rows.some((r) => r[4] !== 1) || stations.some((st) => st.sigma?.some((v) => v > 0));
  return P;
}

function volumeFit(P, x0, y0, depth, nu) {
  let sdg = 0; let sgg = 0;
  const L = P.los;
  const scale = (1 - nu) / Math.PI;
  const d2 = depth * depth;
  for (let k = 0; k < P.n; k += 1) {
    const dx = P.x[k] - x0;
    const dy = P.y[k] - y0;
    const R2 = dx * dx + dy * dy + d2;
    const q = scale / (R2 * Math.sqrt(R2));
    const g = L ? q * (dx * L[0] + dy * L[1] + depth * L[2]) : q * (P.c[k] === 0 ? dx : P.c[k] === 1 ? dy : depth);
    sdg += P.w[k] * P.d[k] * g;
    sgg += P.w[k] * g * g;
  }
  const dV = sgg > 0 ? sdg / sgg : 0;
  const misfit = Math.max(0, P.sdd - 2 * dV * sdg + dV * dV * sgg);
  return { dV, misfit, n: P.n, explained: P.sdd > 0 ? 1 - misfit / P.sdd : NaN };
}

/**
 * The best ΔV for a fixed position and depth, and its misfit: ΔV = Σ w d g / Σ w g²,
 * χ² = Σ w (d − ΔV g)². `stations` are [{ x, y, obs:[…], sigma:[…|null] }].
 */
export function bestVolume(stations, { x0, y0, depth, nu = 0.25 }, { los = null } = {}) {
  return volumeFit(packStations(stations, los), x0, y0, depth, nu);
}

/**
 * Invert stations for a Mogi source: a grid over position and (log-spaced)
 * depth, refined around the best cell, with ΔV solved at every trial. A grid
 * rather than a descent because the misfit surface of a point source has a
 * long valley along the depth–volume trade-off, and a descent stops anywhere
 * in it. Answers the source, its misfit and fit, and the misfit along depth at
 * the best position -- the curve that says how well the depth is determined.
 */
export function invertMogi(stations, {
  bounds, depthRange = [200, 30000], nu = 0.25, los = null,
  grid = 13, depths = 18, rounds = 5,
} = {}) {
  const use = stations.filter((s) => s.obs.some(Number.isFinite));
  if (use.length < 2) return null;
  const P = packStations(use, los);
  const xs = use.map((s) => s.x); const ys = use.map((s) => s.y);
  const outer = bounds || { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  let box = { ...outer };
  const [dMin, dMax] = depthRange.map((d) => Math.log(d));
  let [dLo, dHi] = [dMin, dMax];
  let best = null;
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < grid; i += 1) {
      const x0 = box.minX + ((box.maxX - box.minX) * i) / (grid - 1);
      for (let j = 0; j < grid; j += 1) {
        const y0 = box.minY + ((box.maxY - box.minY) * j) / (grid - 1);
        for (let k = 0; k < depths; k += 1) {
          const depth = Math.exp(dLo + ((dHi - dLo) * k) / (depths - 1));
          const fit = volumeFit(P, x0, y0, depth, nu);
          if (!best || fit.misfit < best.misfit) best = { x0, y0, depth, nu, ...fit };
        }
      }
    }
    // Shrink round the best cell, keeping two cells either side of it.
    const hx = (2 * (box.maxX - box.minX)) / (grid - 1);
    const hy = (2 * (box.maxY - box.minY)) / (grid - 1);
    // Refinement stays inside the search it was asked for: a window allowed to
    // grow past it walks the answer out of the model (measured on Etna: 99 km
    // deep in a 50 km box).
    box = {
      minX: Math.max(outer.minX, best.x0 - hx), maxX: Math.min(outer.maxX, best.x0 + hx),
      minY: Math.max(outer.minY, best.y0 - hy), maxY: Math.min(outer.maxY, best.y0 + hy),
    };
    const hd = (2 * (dHi - dLo)) / (depths - 1);
    const ld = Math.log(best.depth);
    [dLo, dHi] = [Math.max(dMin, ld - hd), Math.min(dMax, ld + hd)];
  }
  // A best answer on the edge of the search is not a minimum, only the limit of
  // where it was allowed to look.
  const edge = (v, lo, hi) => Math.abs(v - lo) <= 1e-6 * Math.max(1, Math.abs(hi - lo)) || Math.abs(v - hi) <= 1e-6 * Math.max(1, Math.abs(hi - lo));
  const atEdge = {
    depth: Math.abs(Math.log(best.depth) - dMin) < 1e-9 || Math.abs(Math.log(best.depth) - dMax) < 1e-9,
    position: edge(best.x0, outer.minX, outer.maxX) || edge(best.y0, outer.minY, outer.maxY),
  };
  const curve = [];
  const [c0, c1] = depthRange.map((d) => Math.log(d));
  for (let k = 0; k < 40; k += 1) {
    const depth = Math.exp(c0 + ((c1 - c0) * k) / 39);
    curve.push({ depth, misfit: volumeFit(P, best.x0, best.y0, depth, nu).misfit });
  }
  const rms = Math.sqrt(best.misfit / Math.max(1, best.n));
  return { ...best, rms, curve, atEdge, weighted: P.weighted };
}

/**
 * The top of a model's surface, sampled: the highest surface node in each
 * cell of a plan grid, away from the box's walls (a wall is surface too, and
 * a free surface is what a Mogi source is measured at). Answers node indices.
 */
export function topSurfaceNodes(coords, surfaceNodes, bounds, { cells = 120, wallMargin = 0.03, cap = 4000 } = {}) {
  const sx = bounds.max[0] - bounds.min[0];
  const sy = bounds.max[1] - bounds.min[1];
  const top = new Map();
  for (let k = 0; k < surfaceNodes.length; k += 1) {
    const i = surfaceNodes[k];
    const fx = (coords[i * 3] - bounds.min[0]) / sx;
    const fy = (coords[i * 3 + 1] - bounds.min[1]) / sy;
    if (fx < wallMargin || fx > 1 - wallMargin || fy < wallMargin || fy > 1 - wallMargin) continue;
    const key = Math.min(cells - 1, Math.floor(fx * cells)) * cells + Math.min(cells - 1, Math.floor(fy * cells));
    const at = top.get(key);
    if (at === undefined || coords[i * 3 + 2] > coords[at * 3 + 2]) top.set(key, i);
  }
  let out = [...top.values()];
  // A bucket whose highest node is still far below its neighbourhood is a
  // cavity's roof seen from above, not the ground: keep nodes within the
  // model's top tenth of height of the highest in the grid.
  const zTop = Math.max(...out.map((i) => coords[i * 3 + 2]));
  const span = bounds.max[2] - bounds.min[2];
  out = out.filter((i) => coords[i * 3 + 2] >= zTop - 0.1 * span);
  if (out.length > cap) {
    const stride = out.length / cap;
    out = Array.from({ length: cap }, (_, k) => out[Math.floor(k * stride)]);
  }
  return out;
}
