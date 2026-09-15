/**
 * A MODEL AGAINST WHAT WAS MEASURED: GNSS displacements, or InSAR line-of-sight
 * points, read at their stations in the solution and compared.
 *
 * A deformation model is only as good as its fit to the ground, and the fit
 * that matters first is the simplest: for a linear elastic model every
 * displacement scales with the source's strength (pressure, volume change),
 * so the best source strength for a given geometry is one least-squares
 * number, k = Σ d·m/σ² / Σ m²/σ². Reporting the misfit before and after that
 * scaling says whether the model's SHAPE fits even where its size does not,
 * which is the question a reader asks before changing the geometry.
 *
 * Pure: a table in, numbers out. Locating the stations in the mesh is the
 * reader worker's job; this module takes the model's values at the stations.
 *
 * Tables are headed, comma, semicolon, tab or space separated:
 *   GNSS  name, x, y, [z], ue, un, uu, [se, sn, su]
 *   LOS   name, x, y, [z], los, [sigma]
 * Header words are matched loosely (east/easting, de/dx/u_e, sig_e, …). The
 * displacements are in the unit the caller names; coordinates are metres in
 * the mesh's own frame (x east, y north, z up). A missing z means "on the
 * ground": the caller puts the station on the model's surface.
 */

const ALIASES = {
  name: ["name", "station", "site", "id", "code", "point"],
  x: ["x", "east", "easting", "e_m", "x_m"],
  y: ["y", "north", "northing", "n_m", "y_m"],
  z: ["z", "elev", "elevation", "height", "alt", "altitude", "z_m"],
  ue: ["ue", "de", "dx", "u_e", "d_e", "ux", "disp_e", "east_disp", "ve"],
  un: ["un", "dn", "dy", "u_n", "d_n", "uy", "disp_n", "north_disp", "vn"],
  uu: ["uu", "du", "dz", "u_u", "d_u", "uz", "disp_u", "up_disp", "vu", "up"],
  se: ["se", "sig_e", "sigma_e", "s_e", "sde", "err_e"],
  sn: ["sn", "sig_n", "sigma_n", "s_n", "sdn", "err_n"],
  su: ["su", "sig_u", "sigma_u", "s_u", "sdu", "err_u"],
  los: ["los", "d_los", "dlos", "los_disp", "range_change"],
  slos: ["sigma", "slos", "sig_los", "sigma_los", "err", "err_los"],
};

const norm = (h) => String(h).trim().toLowerCase().replace(/[()[\]]/g, "").replace(/\s+/g, "_").replace(/_?(mm|cm|m)$/, "");

/** Which column holds each role, from a header row; null where absent. */
export function headerRoles(cells) {
  const roles = {};
  const used = new Set();
  const heads = cells.map(norm);
  for (const role of Object.keys(ALIASES)) {
    const at = heads.findIndex((h, k) => !used.has(k) && ALIASES[role].includes(h));
    roles[role] = at >= 0 ? at : null;
    if (at >= 0) used.add(at);
  }
  return roles;
}

const split = (line) => line.split(/[,;\t]|\s+/).map((c) => c.trim()).filter((c) => c !== "");

/**
 * Parse an observation table. `scale` converts the displacement unit to
 * metres (1000 → the file is in millimetres). Answers
 * { kind: "gnss" | "los", stations, warnings }.
 */
export function parseObservations(text, { scale = 1 } = {}) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const warnings = [];
  if (!lines.length) return { kind: null, stations: [], warnings: ["The table is empty."] };
  const head = split(lines[0]);
  // A name followed by numbers is a data row; a header has words past its first cell.
  const headed = head.slice(1).some((c) => !Number.isFinite(Number(c)));
  let roles = headed ? headerRoles(head) : null;
  const body = headed ? lines.slice(1) : lines;
  if (!roles) {
    // Unheaded: name? x y [z] then 3 (GNSS) or 1 (LOS) displacements, by count.
    const first = split(body[0]);
    const named = !Number.isFinite(Number(first[0]));
    const n = first.length - (named ? 1 : 0);
    const o = named ? 1 : 0;
    const base = { name: named ? 0 : null, x: o, y: o + 1, se: null, sn: null, su: null, slos: null };
    if (n >= 6) roles = { ...base, z: o + 2, ue: o + 3, un: o + 4, uu: o + 5, los: null, ...(n >= 9 ? { se: o + 6, sn: o + 7, su: o + 8 } : {}) };
    else if (n === 5) roles = { ...base, z: null, ue: o + 2, un: o + 3, uu: o + 4, los: null };
    else if (n >= 3) roles = { ...base, z: n >= 4 ? o + 2 : null, los: o + (n >= 4 ? 3 : 2), ue: null, un: null, uu: null, ...(n >= 5 ? { slos: o + 4 } : {}) };
    else return { kind: null, stations: [], warnings: ["Each row needs at least x, y and a displacement."] };
    warnings.push("No header row: columns were read by position.");
  }
  const kind = roles.ue !== null || roles.un !== null || roles.uu !== null ? "gnss" : roles.los !== null ? "los" : null;
  if (!kind) return { kind: null, stations: [], warnings: [...warnings, "No displacement columns found (ue/un/uu for GNSS, or los)."] };
  if (roles.x === null || roles.y === null) return { kind, stations: [], warnings: [...warnings, "No x and y columns found."] };
  const num = (cells, role) => (roles[role] === null ? null : Number(cells[roles[role]]));
  const stations = [];
  let skipped = 0;
  body.forEach((line, k) => {
    const cells = split(line);
    const x = num(cells, "x");
    const y = num(cells, "y");
    const zRaw = num(cells, "z");
    if (!Number.isFinite(x) || !Number.isFinite(y)) { skipped += 1; return; }
    const name = roles.name !== null ? cells[roles.name] : `station_${stations.length + 1}`;
    const z = Number.isFinite(zRaw) ? zRaw : null;
    if (kind === "gnss") {
      const obs = ["ue", "un", "uu"].map((r) => { const v = num(cells, r); return Number.isFinite(v) ? v / scale : NaN; });
      if (!obs.some(Number.isFinite)) { skipped += 1; return; }
      const sigma = ["se", "sn", "su"].map((r) => { const v = num(cells, r); return Number.isFinite(v) && v > 0 ? v / scale : null; });
      stations.push({ name, x, y, z, obs, sigma });
    } else {
      const v = num(cells, "los");
      if (!Number.isFinite(v)) { skipped += 1; return; }
      const s = num(cells, "slos");
      stations.push({ name, x, y, z, obs: [v / scale], sigma: [Number.isFinite(s) && s > 0 ? s / scale : null] });
    }
  });
  if (skipped) warnings.push(`${skipped} row${skipped > 1 ? "s" : ""} without usable coordinates or values were skipped.`);
  return { kind, stations, warnings };
}

/**
 * The best source-strength scale and the misfit either side of it.
 * `pairs` is [{ d, m, sigma }] — one entry per observed component. A missing
 * sigma weighs 1, so an unweighted file is ordinary least squares; mixing
 * weighted and unweighted components is refused rather than guessed.
 */
export function fitScale(pairs) {
  const use = pairs.filter((p) => Number.isFinite(p.d) && Number.isFinite(p.m));
  const weighted = use.filter((p) => p.sigma > 0).length;
  const mixed = weighted > 0 && weighted < use.length;
  const w = (p) => (weighted === use.length && weighted > 0 ? 1 / (p.sigma * p.sigma) : 1);
  let sdm = 0; let smm = 0; let sdd = 0; let sw = 0;
  for (const p of use) { const k = w(p); sdm += k * p.d * p.m; smm += k * p.m * p.m; sdd += k * p.d * p.d; sw += k; }
  const n = use.length;
  const scale = smm > 0 ? sdm / smm : NaN;
  const rms = (k) => Math.sqrt(use.reduce((a, p) => a + (p.d - k * p.m) ** 2, 0) / Math.max(1, n));
  const wrms = (k) => Math.sqrt(use.reduce((a, p) => a + w(p) * (p.d - k * p.m) ** 2, 0) / Math.max(1e-300, sw));
  const chi2 = (k) => (weighted === n && n > 0 ? use.reduce((a, p) => a + ((p.d - k * p.m) / p.sigma) ** 2, 0) : NaN);
  // How much of the data the scaled model explains, in the weights used.
  const explained = sdd > 0 && Number.isFinite(scale) ? 1 - (sdd - 2 * scale * sdm + scale * scale * smm) / sdd : NaN;
  return {
    n, weighted: weighted === n && n > 0, mixed, scale,
    rms: rms(1), wrms: wrms(1), chi2: chi2(1),
    rmsScaled: rms(scale), wrmsScaled: wrms(scale), chi2Scaled: chi2(scale),
    // Reduced chi² of the scaled fit has one parameter spent.
    reducedChi2Scaled: weighted === n && n > 1 ? chi2(scale) / (n - 1) : NaN,
    explained,
  };
}

/** The component pairs of a comparison, flattened for fitScale. */
export function pairsOf(stations, model) {
  const out = [];
  stations.forEach((s, i) => {
    const m = model[i];
    if (!m) return;
    s.obs.forEach((d, j) => out.push({ d, m: m[j], sigma: s.sigma?.[j] ?? null }));
  });
  return out;
}

/** One row per station: observed, modelled at the chosen scale, and the residual; metres converted by `scale`. */
export function comparisonCsv(kind, stations, model, { k = 1, unit = "mm", toUnit = 1000, header = [] } = {}) {
  const comps = kind === "gnss" ? ["e", "n", "u"] : ["los"];
  const f = (v) => (Number.isFinite(v) ? String(Number((v * toUnit).toPrecision(8))) : "");
  const cols = ["name", "x_m", "y_m", "z_m", ...comps.map((c) => `obs_${c}_${unit}`), ...comps.map((c) => `model_${c}_${unit}`), ...comps.map((c) => `resid_${c}_${unit}`), "placed"];
  const lines = [...header.map((h) => `# ${h}`), cols.join(",")];
  stations.forEach((s, i) => {
    const m = model[i];
    const mk = comps.map((_, j) => (m ? k * m[j] : NaN));
    lines.push([
      `"${String(s.name).replace(/"/g, '""')}"`, s.px ?? s.x, s.py ?? s.y, s.pz ?? (s.z ?? ""),
      ...s.obs.map(f), ...mk.map(f), ...s.obs.map((d, j) => f(d - mk[j])), s.placed || "",
    ].join(","));
  });
  return `${lines.join("\n")}\n`;
}
