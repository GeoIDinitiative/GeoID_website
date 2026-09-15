/**
 * STRAIN AND STRESS FROM A DISPLACEMENT FIELD, the way a solid result is read.
 *
 * GALES's solid writes the displacement u at the nodes and nothing else. What
 * a reader of a deformation model asks about is the STRESS and STRAIN it
 * implies: where the rock is in tension, how close it is to yielding, how the
 * volume changes above a pressurised chamber. Those follow from u exactly
 * within the element formulation the solver used:
 *
 *   - In a linear tetrahedron u is linear, so its gradient is CONSTANT in the
 *     element: ∇u = Σᵢ uᵢ ⊗ ∇Nᵢ, with ∇Nᵢ from the inverse of the element's
 *     edge matrix. Small strain ε = ½(∇u + ∇uᵀ).
 *   - Hooke's law for an isotropic solid: σ = λ tr(ε) I + 2μ ε, with
 *     λ = Eν / ((1+ν)(1−2ν)) and μ = E / (2(1+ν)) — E and ν taken from the
 *     run's own props.txt at the element's centroid (uniform, z-wise layers,
 *     or a pointwise tomography grid).
 *   - Element values go to the nodes as a VOLUME-WEIGHTED average of the
 *     elements that share each node — ParaView's cell-to-point, and what a
 *     colour map over the surface expects.
 *
 * Out: per node, 16 components — εxx εyy εzz εxy εyz εxz (tensor shear, not
 * engineering γ), σxx σyy σzz σxy σyz σxz (Pa), von Mises stress, maximum and
 * minimum principal stress (tension positive), and volumetric strain tr(ε).
 *
 * Pure: arrays in, arrays out. 3D tetrahedra only; a 2D mesh is refused by
 * name rather than answered wrongly.
 */

export const DERIVED_COMPONENTS = [
  ["exx", "Strain εxx", ""], ["eyy", "Strain εyy", ""], ["ezz", "Strain εzz", ""],
  ["exy", "Strain εxy", ""], ["eyz", "Strain εyz", ""], ["exz", "Strain εxz", ""],
  ["sxx", "Stress σxx", "Pa"], ["syy", "Stress σyy", "Pa"], ["szz", "Stress σzz", "Pa"],
  ["sxy", "Stress σxy", "Pa"], ["syz", "Stress σyz", "Pa"], ["sxz", "Stress σxz", "Pa"],
  ["vm", "Von Mises stress", "Pa"], ["s1", "Max principal stress σ₁", "Pa"], ["s3", "Min principal stress σ₃", "Pa"],
  ["ev", "Volumetric strain", ""],
  // Ground tilt, what a tiltmeter records: the slope of the vertical
  // displacement, + where the ground rises toward east (north). Radians; a
  // volcano's tilt is quoted in microradians.
  ["tx", "Tilt east ∂u_z/∂x", "rad"], ["ty", "Tilt north ∂u_z/∂y", "rad"], ["tilt", "Tilt magnitude", "rad"],
].map(([key, label, unit]) => ({ key, label, unit }));

/** Lamé parameters from Young's modulus and Poisson's ratio. */
export function lame(E, nu) {
  return { lambda: (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu: E / (2 * (1 + nu)) };
}

/** Eigenvalues of a symmetric 3×3 (analytic, trigonometric form), sorted high to low. */
export function symmetricEigen(xx, yy, zz, xy, yz, xz) {
  const p1 = xy * xy + yz * yz + xz * xz;
  if (p1 < 1e-30 * Math.max(1, xx * xx + yy * yy + zz * zz)) return [xx, yy, zz].sort((a, b) => b - a);
  const q = (xx + yy + zz) / 3;
  const p2 = (xx - q) ** 2 + (yy - q) ** 2 + (zz - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const b = [(xx - q) / p, xy / p, xz / p, (yy - q) / p, yz / p, (zz - q) / p];
  const r = (b[0] * (b[3] * b[5] - b[4] * b[4]) - b[1] * (b[1] * b[5] - b[4] * b[2]) + b[2] * (b[1] * b[4] - b[3] * b[2])) / 2;
  const phi = r <= -1 ? Math.PI / 3 : r >= 1 ? 0 : Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return [e1, 3 * q - e1 - e3, e3];
}

/**
 * THE MATERIAL A RUN SOLVED WITH, from its props.txt: { kind: "uniform", E, nu }
 * | { kind: "layers", axis, layers: [{ lo, hi, E, nu }] } | { kind: "pointwise",
 * dim, file } | null. The pointwise grid itself is loaded by the caller.
 */
export function parseSolidProps(text) {
  const src = String(text || "").replace(/#.*$/gm, "");
  if (!/^\s*solid\b/m.test(src)) return null;
  const num = (re, from = src) => { const m = from.match(re); return m ? Number(m[1]) : NaN; };
  const pw = src.match(/heterogeneous_pointwise\s*\{[^}]*input_file\s+(2d|3d)\s+(\S+)/);
  if (pw) return { kind: "pointwise", dim: pw[1] === "2d" ? 2 : 3, file: pw[2], fallback: { E: num(/^\s*E\s+([-+\d.eE]+)/m), nu: num(/^\s*nu\s+([-+\d.eE]+)/m) } };
  const layered = src.match(/heterogeneous_layers\s+([xyz])-wise/);
  if (layered) {
    const layers = [];
    for (const m of src.matchAll(/layer\s*\{([^}]*)\}/g)) {
      const body = m[1];
      const bound = body.match(/bound\s+([-+\d.eE]+)\s+([-+\d.eE]+)/);
      layers.push({ lo: bound ? Number(bound[1]) : -Infinity, hi: bound ? Number(bound[2]) : Infinity, E: num(/\bE\s+([-+\d.eE]+)/, body), nu: num(/\bnu\s+([-+\d.eE]+)/, body) });
    }
    if (layers.length) return { kind: "layers", axis: layered[1], layers };
  }
  const E = num(/^\s*E\s+([-+\d.eE]+)/m);
  const nu = num(/^\s*nu\s+([-+\d.eE]+)/m);
  return Number.isFinite(E) && Number.isFinite(nu) ? { kind: "uniform", E, nu } : null;
}

/** A material spec as a function of position → { E, nu }, or null (strain only). */
export function materialAt(spec, grid = null, sampleGrid = null) {
  if (!spec) return null;
  if (spec.kind === "uniform") return () => ({ E: spec.E, nu: spec.nu });
  if (spec.kind === "layers") {
    const a = { x: 0, y: 1, z: 2 }[spec.axis] ?? 2;
    const layers = [...spec.layers].sort((p, q) => p.lo - q.lo);
    return (p) => {
      const c = p[a];
      // GALES's layer bounds are (lo, hi]: the lowest layer holds its own floor.
      const hit = layers.find((l, i) => (i === 0 ? c >= l.lo : c > l.lo) && c <= l.hi) || (c < layers[0].lo ? layers[0] : layers.at(-1));
      return { E: hit.E, nu: hit.nu };
    };
  }
  if (spec.kind === "pointwise" && grid && sampleGrid) {
    return (p) => {
      const s = sampleGrid(grid, p[0], p[1], p[2]);
      return { E: s.E, nu: s.nu };
    };
  }
  return null;
}

/**
 * Strain and stress at the nodes. `mesh` { dim, nodeCount, coords, cells,
 * cellOffsets }, `u` Float64 nodes × nbDofs (node-interleaved), `material`
 * from materialAt (null: strains only, stresses NaN).
 */
export function derivedFields(mesh, u, nbDofs, material) {
  if (mesh.dim !== 3) throw new Error("Stress and strain are derived for 3D tetrahedral meshes; this mesh is 2D.");
  if (nbDofs < 3) throw new Error("A displacement field needs three components per node.");
  const n = mesh.nodeCount;
  const K = DERIVED_COMPONENTS.length;
  const acc = new Float64Array(n * K);
  const weight = new Float64Array(n);
  const c = mesh.coords; const conn = mesh.cells; const off = mesh.cellOffsets;
  let skipped = 0;
  const value = new Float64Array(K);
  for (let e = 0; e + 1 < off.length; e += 1) {
    const s = off[e];
    if (off[e + 1] - s < 4) continue;
    const i0 = conn[s]; const i1 = conn[s + 1]; const i2 = conn[s + 2]; const i3 = conn[s + 3];
    // Edge matrix J (columns x1−x0, x2−x0, x3−x0) and its inverse.
    const a = [c[i1 * 3] - c[i0 * 3], c[i2 * 3] - c[i0 * 3], c[i3 * 3] - c[i0 * 3],
      c[i1 * 3 + 1] - c[i0 * 3 + 1], c[i2 * 3 + 1] - c[i0 * 3 + 1], c[i3 * 3 + 1] - c[i0 * 3 + 1],
      c[i1 * 3 + 2] - c[i0 * 3 + 2], c[i2 * 3 + 2] - c[i0 * 3 + 2], c[i3 * 3 + 2] - c[i0 * 3 + 2]];
    const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    const vol = Math.abs(det) / 6;
    if (!(vol > 0)) { skipped += 1; continue; }
    const inv = [
      (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
      (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
      (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
    ];
    // ∇N for nodes 1..3 are the rows of J⁻¹; node 0's is minus their sum.
    const g = [
      [-(inv[0] + inv[3] + inv[6]), -(inv[1] + inv[4] + inv[7]), -(inv[2] + inv[5] + inv[8])],
      [inv[0], inv[1], inv[2]], [inv[3], inv[4], inv[5]], [inv[6], inv[7], inv[8]],
    ];
    const ids = [i0, i1, i2, i3];
    // H = ∇u: H[r][q] = ∂u_r/∂x_q
    const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 4; k += 1) {
      const node = ids[k];
      for (let r = 0; r < 3; r += 1) {
        const ur = u[node * nbDofs + r];
        H[r * 3] += ur * g[k][0]; H[r * 3 + 1] += ur * g[k][1]; H[r * 3 + 2] += ur * g[k][2];
      }
    }
    const exx = H[0]; const eyy = H[4]; const ezz = H[8];
    const exy = (H[1] + H[3]) / 2; const eyz = (H[5] + H[7]) / 2; const exz = (H[2] + H[6]) / 2;
    const tr = exx + eyy + ezz;
    value[0] = exx; value[1] = eyy; value[2] = ezz; value[3] = exy; value[4] = eyz; value[5] = exz; value[15] = tr;
    value[16] = H[6]; value[17] = H[7]; value[18] = 0;
    if (material) {
      const cx = (c[i0 * 3] + c[i1 * 3] + c[i2 * 3] + c[i3 * 3]) / 4;
      const cy = (c[i0 * 3 + 1] + c[i1 * 3 + 1] + c[i2 * 3 + 1] + c[i3 * 3 + 1]) / 4;
      const cz = (c[i0 * 3 + 2] + c[i1 * 3 + 2] + c[i2 * 3 + 2] + c[i3 * 3 + 2]) / 4;
      const { E, nu } = material([cx, cy, cz]);
      const { lambda, mu } = lame(E, nu);
      const sxx = lambda * tr + 2 * mu * exx; const syy = lambda * tr + 2 * mu * eyy; const szz = lambda * tr + 2 * mu * ezz;
      const sxy = 2 * mu * exy; const syz = 2 * mu * eyz; const sxz = 2 * mu * exz;
      value[6] = sxx; value[7] = syy; value[8] = szz; value[9] = sxy; value[10] = syz; value[11] = sxz;
      value[12] = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (sxy * sxy + syz * syz + sxz * sxz));
      const eig = symmetricEigen(sxx, syy, szz, sxy, syz, sxz);
      value[13] = eig[0]; value[14] = eig[2];
    } else {
      for (let j = 6; j <= 14; j += 1) value[j] = NaN;
    }
    for (const node of ids) {
      weight[node] += vol;
      for (let j = 0; j < K; j += 1) acc[node * K + j] += vol * value[j];
    }
  }
  for (let i = 0; i < n; i += 1) {
    const w = weight[i];
    for (let j = 0; j < K; j += 1) acc[i * K + j] = w > 0 ? acc[i * K + j] / w : NaN;
    // The tilt a station reads is the length of ITS OWN two components: taken
    // after averaging, not an average of each element's lengths (which is
    // longer wherever the elements round a node disagree in direction).
    acc[i * K + 18] = Math.hypot(acc[i * K + 16], acc[i * K + 17]);
  }
  return { values: acc, nbDofs: K, skipped, stress: Boolean(material) };
}

/**
 * GRADIENT of a nodal scalar — ParaView's Gradient filter. Each linear
 * element's gradient is constant (tets in 3D, triangles in 2D, where ∂/∂z is
 * 0); it is volume- (area-) weighted to the nodes and the magnitude is taken
 * AFTER averaging, as the tilt is. A cell touching a NaN node is left out.
 *
 *   → Float64Array nodes × 4: ∂s/∂x, ∂s/∂y, ∂s/∂z, |∇s|
 */
export function nodalGradient(mesh, scalar) {
  const n = mesh.nodeCount;
  const acc = new Float64Array(n * 3);
  const weight = new Float64Array(n);
  const c = mesh.coords; const conn = mesh.cells; const off = mesh.cellOffsets;
  const three = mesh.dim === 3;
  let skipped = 0;
  for (let e = 0; e + 1 < off.length; e += 1) {
    const s = off[e];
    const count = off[e + 1] - s;
    if (three && count < 4) continue;
    if (!three && count < 3) continue;
    if (three) {
      const i0 = conn[s]; const i1 = conn[s + 1]; const i2 = conn[s + 2]; const i3 = conn[s + 3];
      const f0 = scalar[i0]; const f1 = scalar[i1]; const f2 = scalar[i2]; const f3 = scalar[i3];
      if (!(Number.isFinite(f0) && Number.isFinite(f1) && Number.isFinite(f2) && Number.isFinite(f3))) { skipped += 1; continue; }
      const a = [c[i1 * 3] - c[i0 * 3], c[i2 * 3] - c[i0 * 3], c[i3 * 3] - c[i0 * 3],
        c[i1 * 3 + 1] - c[i0 * 3 + 1], c[i2 * 3 + 1] - c[i0 * 3 + 1], c[i3 * 3 + 1] - c[i0 * 3 + 1],
        c[i1 * 3 + 2] - c[i0 * 3 + 2], c[i2 * 3 + 2] - c[i0 * 3 + 2], c[i3 * 3 + 2] - c[i0 * 3 + 2]];
      const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
      const vol = Math.abs(det) / 6;
      if (!(vol > 0)) { skipped += 1; continue; }
      // J^T ∇f = (f1−f0, f2−f0, f3−f0): the rows of J⁻¹ give ∇f = J⁻ᵀ d.
      const d1 = f1 - f0; const d2 = f2 - f0; const d3 = f3 - f0;
      const inv = [
        (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
        (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
        (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
      ];
      const gx = inv[0] * d1 + inv[3] * d2 + inv[6] * d3;
      const gy = inv[1] * d1 + inv[4] * d2 + inv[7] * d3;
      const gz = inv[2] * d1 + inv[5] * d2 + inv[8] * d3;
      for (const node of [i0, i1, i2, i3]) { acc[node * 3] += vol * gx; acc[node * 3 + 1] += vol * gy; acc[node * 3 + 2] += vol * gz; weight[node] += vol; }
    } else {
      const i0 = conn[s]; const i1 = conn[s + 1]; const i2 = conn[s + 2];
      const f0 = scalar[i0]; const f1 = scalar[i1]; const f2 = scalar[i2];
      if (!(Number.isFinite(f0) && Number.isFinite(f1) && Number.isFinite(f2))) { skipped += 1; continue; }
      const ax = c[i1 * 3] - c[i0 * 3]; const ay = c[i1 * 3 + 1] - c[i0 * 3 + 1];
      const bx = c[i2 * 3] - c[i0 * 3]; const by = c[i2 * 3 + 1] - c[i0 * 3 + 1];
      const det = ax * by - ay * bx;
      const area = Math.abs(det) / 2;
      if (!(area > 0)) { skipped += 1; continue; }
      const d1 = f1 - f0; const d2 = f2 - f0;
      const gx = (by * d1 - ay * d2) / det;
      const gy = (-bx * d1 + ax * d2) / det;
      for (const node of [i0, i1, i2]) { acc[node * 3] += area * gx; acc[node * 3 + 1] += area * gy; weight[node] += area; }
    }
  }
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const w = weight[i];
    if (!(w > 0)) { out.fill(NaN, i * 4, i * 4 + 4); continue; }
    const gx = acc[i * 3] / w; const gy = acc[i * 3 + 1] / w; const gz = acc[i * 3 + 2] / w;
    out[i * 4] = gx; out[i * 4 + 1] = gy; out[i * 4 + 2] = gz; out[i * 4 + 3] = Math.hypot(gx, gy, gz);
  }
  return { values: out, skipped };
}
