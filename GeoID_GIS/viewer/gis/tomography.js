/**
 * MATERIAL PROPERTIES AT DEPTH, from a tomography grid, in the form GALES reads.
 *
 * GALES's solid reads a heterogeneous material as `heterogeneous_pointwise {
 * input_file 3d <file> }` in props.txt, and the file (from input/) as a count
 * followed by rows of `x y z rho E nu` (2D: `x y rho E nu`). It then sorts the
 * unique x, y and z and INDEXES THE ROWS BY POSITION —
 *
 *     row = iz · nx · ny + iy · nx + ix        (every index ascending)
 *
 * — and interpolates trilinearly between them (solid_properties.hpp,
 * pointwise_properties). Nothing checks that the rows are in that order. A
 * file written z-descending (as the copy in gales/sim/solid_es/etna_3d_atlas
 * is) is read upside down: 125 GPa at the surface and 14 GPa at 25 km, with
 * no error. So the rows are never passed through: the grid is rebuilt and
 * written in the order the reader indexes, whatever order it arrived in, and
 * a grid with a missing node is refused rather than shifted.
 *
 * Two kinds of input:
 *   - elastic: x y z rho E nu, the GALES file itself or a table in any order,
 *     with or without its count line or a header;
 *   - velocity: x y z Vp [Vs] (km/s or m/s), converted with Brocher (2005):
 *     density from Nafe–Drake, Vs from Vp where it is absent, then the dynamic
 *     moduli of an isotropic elastic solid
 *         μ = ρ Vs²,  E = μ (3Vp² − 4Vs²) / (Vp² − Vs²),  ν = (Vp² − 2Vs²) / (2 (Vp² − Vs²)),
 *     with an optional static/dynamic ratio on E (tomography measures dynamic
 *     moduli; rock mass deforms statically, typically at 0.3–1 of them).
 *
 * Pure: text in, grids and text out.
 */

const LABELS = {
  x: /^(x|east(ing)?|lon(gitude)?|utm_?e)$/i,
  y: /^(y|north(ing)?|lat(itude)?|utm_?n)$/i,
  z: /^(z|elev(ation)?|depth|alt(itude)?|h)$/i,
  rho: /^(rho|density|dens)$/i,
  E: /^(e|young'?s?(_modulus)?|youngs)$/i,
  nu: /^(nu|poisson'?s?(_ratio)?|pr)$/i,
  vp: /^(vp|p_?velocity|velp)$/i,
  vs: /^(vs|s_?velocity|vels)$/i,
};

/**
 * A whitespace, comma or semicolon table: numbers, and a header when the
 * first line is words. A leading line holding one integer that equals the
 * number of rows after it is GALES's count line and is dropped.
 */
export function parseTable(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[#%]/.test(l));
  let header = null;
  const split = (l) => l.split(/[\s,;]+/).filter(Boolean);
  if (lines.length && split(lines[0]).some((t) => !Number.isFinite(Number(t)))) header = split(lines.shift());
  const rows = lines.map((l) => split(l).map(Number));
  if (rows.length > 1 && rows[0].length === 1 && rows[0][0] === rows.length - 1) rows.shift();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const bad = rows.filter((r) => r.length !== width || r.some((v) => !Number.isFinite(v))).length;
  return { header, rows: rows.filter((r) => r.length === width && r.every(Number.isFinite)), width, bad };
}

/** Which column is which: by header where there is one, else by count and range. */
export function guessColumns(table) {
  const map = {};
  if (table.header) {
    table.header.forEach((name, i) => {
      for (const [key, re] of Object.entries(LABELS)) if (map[key] === undefined && re.test(name.replace(/\[.*\]|\(.*\)/g, "").trim())) map[key] = i;
    });
    if (table.header.some((n) => /depth/i.test(n))) map.zIsDepth = true;
  }
  const w = table.width;
  if (map.x === undefined && w >= 5) { map.x = 0; map.y = 1; map.z = 2; }
  if (map.rho === undefined && map.vp === undefined) {
    // Six columns whose fifth is in the billions and sixth under 0.5 is x y z rho E nu.
    const sample = table.rows[0] || [];
    if (w === 6 && sample[4] > 1e6 && sample[5] < 0.5) Object.assign(map, { rho: 3, E: 4, nu: 5 });
    else if (w === 5 && map.x === 0 && sample[3] < 20 && sample[4] < 20) Object.assign(map, { vp: 3, vs: 4 });
    else if (w === 4) Object.assign(map, { x: 0, y: 1, z: 2, vp: 3 });
  }
  map.kind = map.rho !== undefined ? "elastic" : map.vp !== undefined ? "velocity" : "";
  return map;
}

/** Brocher (2005) Nafe–Drake density, g/cm³ from Vp in km/s (valid ~1.5–8.5 km/s). */
export function brocherDensity(vpKms) {
  const v = vpKms;
  return 1.6612 * v - 0.4721 * v ** 2 + 0.0671 * v ** 3 - 0.0043 * v ** 4 + 0.000106 * v ** 5;
}

/** Brocher (2005) Vs from Vp, both km/s (valid ~1.5–8 km/s). */
export function brocherVs(vpKms) {
  const v = vpKms;
  return 0.7858 - 1.2344 * v + 0.7949 * v ** 2 - 0.1238 * v ** 3 + 0.0064 * v ** 4;
}

/** Dynamic isotropic moduli from velocities (m/s) and density (kg/m³). */
export function elasticFromVelocity(vp, vs, rho) {
  const p2 = vp * vp; const s2 = vs * vs;
  const mu = rho * s2;
  return { E: (mu * (3 * p2 - 4 * s2)) / (p2 - s2), nu: (p2 - 2 * s2) / (2 * (p2 - s2)) };
}

/**
 * THE GRID. `options`: { columns (from guessColumns, editable), dim (3|2),
 * unitsKm (velocity in km/s), coordScale (e.g. 1000 for km coordinates),
 * zIsDepth (depth positive down: z becomes −depth), offset [ox, oy, oz]
 * subtracted from the coordinates, staticRatio (E multiplier, default 1) }.
 * Returns { ok, message, x, y, z, rho, E, nu (Float64 in index order), counts,
 * bounds, ranges, byDepth } or { ok: false, message }.
 */
export function buildGrid(table, options = {}) {
  const c = { ...guessColumns(table), ...(options.columns || {}) };
  const dim = options.dim === 2 ? 2 : 3;
  const scale = Number(options.coordScale) || 1;
  const [ox, oy, oz] = options.offset || [0, 0, 0];
  const zIsDepth = options.zIsDepth ?? c.zIsDepth ?? false;
  const kind = c.kind || (c.rho !== undefined ? "elastic" : c.vp !== undefined ? "velocity" : "");
  if (!kind) return { ok: false, message: "No property columns found: expected rho E nu, or Vp (and Vs)." };
  if (c.x === undefined || c.y === undefined || (dim === 3 && c.z === undefined)) return { ok: false, message: "No coordinate columns found: expected x y z first." };
  const velScale = options.unitsKm === false ? 1 : 1000;
  const ratio = Number.isFinite(Number(options.staticRatio)) && Number(options.staticRatio) > 0 ? Number(options.staticRatio) : 1;
  const points = [];
  let clamped = 0;
  for (const r of table.rows) {
    const x = r[c.x] * scale - ox;
    const y = r[c.y] * scale - oy;
    const z = dim === 3 ? (zIsDepth ? -r[c.z] : r[c.z]) * scale - oz : 0;
    let rho; let E; let nu;
    if (kind === "elastic") { rho = r[c.rho]; E = r[c.E] * ratio; nu = r[c.nu]; } else {
      const vpKms = r[c.vp] * (velScale === 1000 ? 1 : 0.001);
      if (vpKms < 1.5 || vpKms > 8.5) clamped += 1;
      const vsKms = c.vs !== undefined ? r[c.vs] * (velScale === 1000 ? 1 : 0.001) : brocherVs(vpKms);
      rho = brocherDensity(vpKms) * 1000;
      const m = elasticFromVelocity(vpKms * 1000, vsKms * 1000, rho);
      E = m.E * ratio; nu = m.nu;
    }
    points.push([x, y, z, rho, E, nu]);
  }
  const uniq = (i) => [...new Set(points.map((p) => p[i]))].sort((a, b) => a - b);
  const xs = uniq(0); const ys = uniq(1); const zs = dim === 3 ? uniq(2) : [0];
  const nx = xs.length; const ny = ys.length; const nz = zs.length;
  if (nx < 2 || ny < 2 || (dim === 3 && nz < 2)) return { ok: false, message: `A grid needs at least two distinct values on every axis (found ${nx} × ${ny}${dim === 3 ? ` × ${nz}` : ""}).` };
  const total = nx * ny * nz;
  const ix = new Map(xs.map((v, i) => [v, i])); const iy = new Map(ys.map((v, i) => [v, i])); const iz = new Map(zs.map((v, i) => [v, i]));
  const rho = new Float64Array(total).fill(NaN); const E = new Float64Array(total).fill(NaN); const nu = new Float64Array(total).fill(NaN);
  let duplicates = 0;
  for (const p of points) {
    const k = iz.get(p[2]) * nx * ny + iy.get(p[1]) * nx + ix.get(p[0]);
    if (!Number.isNaN(rho[k])) duplicates += 1;
    rho[k] = p[3]; E[k] = p[4]; nu[k] = p[5];
  }
  let missing = 0;
  for (let k = 0; k < total; k += 1) if (Number.isNaN(rho[k])) missing += 1;
  if (missing) return { ok: false, message: `${missing.toLocaleString()} of ${total.toLocaleString()} grid nodes have no row (${nx} × ${ny}${dim === 3 ? ` × ${nz}` : ""}). GALES interpolates on a full rectangular grid; a missing node would shift every row after it.` };
  const bad = [];
  for (let k = 0; k < total; k += 1) {
    if (!(rho[k] > 0) || !(E[k] > 0) || !(nu[k] > -1 && nu[k] < 0.5)) bad.push(k);
  }
  const range = (a) => { let lo = Infinity; let hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
  // Mean properties per z level, bottom first: the profile a reader checks.
  const byDepth = zs.map((zv, i) => {
    let r = 0; let e = 0; let n2 = 0;
    for (let k = i * nx * ny; k < (i + 1) * nx * ny; k += 1) { r += rho[k]; e += E[k]; n2 += nu[k]; }
    const n = nx * ny;
    return { z: zv, rho: r / n, E: e / n, nu: n2 / n };
  });
  return {
    ok: !bad.length, kind, dim, x: xs, y: ys, z: zs, rho, E, nu,
    counts: { nx, ny, nz, total, rows: table.rows.length, duplicates, clamped, invalid: bad.length },
    bounds: { min: [xs[0], ys[0], zs[0]], max: [xs[nx - 1], ys[ny - 1], zs[nz - 1]] },
    ranges: { rho: range(rho), E: range(E), nu: range(nu) },
    byDepth,
    message: bad.length ? `${bad.length} grid node${bad.length === 1 ? " has" : "s have"} a density or modulus not above zero, or a Poisson's ratio outside (−1, 0.5).` : "",
  };
}

const num = (v) => {
  const s = Number(v).toPrecision(10);
  return String(Number(s));
};

/** The GALES data file: a count, then rows in the order the reader indexes. */
export function pointwiseText(grid) {
  const out = [String(grid.counts.total)];
  const { nx, ny, nz } = grid.counts;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const n = k * nx * ny + j * nx + i;
        out.push(grid.dim === 3
          ? `${num(grid.x[i])} ${num(grid.y[j])} ${num(grid.z[k])} ${num(grid.rho[n])} ${num(grid.E[n])} ${num(grid.nu[n])}`
          : `${num(grid.x[i])} ${num(grid.y[j])} ${num(grid.rho[n])} ${num(grid.E[n])} ${num(grid.nu[n])}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

/**
 * Whether a table is ALREADY in the order GALES indexes: true, or the row
 * where it first departs. For a warning about a file somebody might hand the
 * solver directly.
 */
export function orderCheck(table, columns = guessColumns(table), dim = 3) {
  const grid = buildGrid(table, { columns, dim });
  if (!grid.counts) return { ok: false, row: -1 };
  const { nx, ny } = grid.counts;
  const ix = new Map(grid.x.map((v, i) => [v, i])); const iy = new Map(grid.y.map((v, i) => [v, i])); const iz = new Map(grid.z.map((v, i) => [v, i]));
  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    const k = (dim === 3 ? iz.get(row[columns.z]) : 0) * nx * ny + iy.get(row[columns.y]) * nx + ix.get(row[columns.x]);
    if (k !== r) return { ok: false, row: r };
  }
  return { ok: true, row: -1 };
}

/** The props at a point, exactly as GALES interpolates (for the preview and the tests). */
export function sampleGrid(grid, x, y, z = 0) {
  const idx = (v, c) => {
    const last = v.length - 1;
    if (c < v[0] || (v[0] <= c && c < v[1])) return 0;
    if (c > v[last] || (v[last - 1] <= c && c <= v[last])) return last - 1;
    for (let i = 1; i < last - 1; i += 1) if (v[i] <= c && c < v[i + 1]) return i;
    return 0;
  };
  const { nx, ny } = grid.counts;
  const x0 = idx(grid.x, x); const y0 = idx(grid.y, y); const z0 = grid.dim === 3 ? idx(grid.z, z) : 0;
  const xd = (x - grid.x[x0]) / (grid.x[x0 + 1] - grid.x[x0]);
  const yd = (y - grid.y[y0]) / (grid.y[y0 + 1] - grid.y[y0]);
  const zd = grid.dim === 3 ? (z - grid.z[z0]) / (grid.z[z0 + 1] - grid.z[z0]) : 0;
  const at = (a, i, j, k) => a[k * nx * ny + j * nx + i];
  const lerp = (a) => {
    const plane = (k) => (at(a, x0, y0, k) * (1 - xd) + at(a, x0 + 1, y0, k) * xd) * (1 - yd) + (at(a, x0, y0 + 1, k) * (1 - xd) + at(a, x0 + 1, y0 + 1, k) * xd) * yd;
    return grid.dim === 3 ? plane(z0) * (1 - zd) + plane(z0 + 1) * zd : plane(0);
  };
  return { rho: lerp(grid.rho), E: lerp(grid.E), nu: lerp(grid.nu) };
}
