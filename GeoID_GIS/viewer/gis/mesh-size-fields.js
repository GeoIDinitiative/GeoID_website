/**
 * MESH SIZE FIELDS, gmsh's own vocabulary, user-defined.
 *
 * gmsh does not want one element size for a study: it wants FIELDS -- a size
 * near a point graded out to a distance, a size along a flagged boundary, a
 * size inside a box or a ball, a size from a formula -- combined by taking
 * the smallest (or the largest) at every place, and set as the background
 * mesh. The Model Builder had one number and a slope grading; this is the
 * rest of it, and every field here is what gmsh calls it:
 *
 * | type      | gmsh                                   | what it says                         |
 * | --------- | -------------------------------------- | ------------------------------------ |
 * | point     | MathEval (distance) + Threshold        | `sizeM` within `distMinM` of a point, `sizeMaxM` past `distMaxM` |
 * | boundary  | Distance (by physical flag) + Threshold| the same, measured from a flagged surface (3D) or curve (2D) |
 * | box       | Box                                    | `sizeM` inside, `sizeOutM` outside, a `thicknessM` blend |
 * | ball      | Ball                                   | the same, in a sphere (a circle in 2D) |
 * | expr      | MathEval                               | a formula in x, y, z -- the user's own |
 * | slope     | Structured (file)                      | the terrain-graded field the builder writes beside the STL |
 *
 * Coordinates are LOCAL and already resolved by the caller: east/north/up
 * metres for a 3D block, (s along the line, z, 0) for a 2D section, so one
 * emitter serves both scripts. Pure; no DOM; tested in Node.
 */

export const FIELD_TYPES = {
  point: { label: "Size at a point", blurb: "A size within a distance of a point, graded out to the coarse size." },
  boundary: { label: "Size along a boundary", blurb: "A size within a distance of a flagged surface or edge, graded out." },
  box: { label: "Size in a box", blurb: "One size inside a box, another outside, blended over a thickness." },
  ball: { label: "Size in a circle / sphere", blurb: "One size inside a radius, another outside, blended over a thickness." },
  expr: { label: "Size from a formula", blurb: "gmsh MathEval: any expression of x, y, z (and F1..Fn for other fields)." },
  slope: { label: "Finer on slopes", blurb: "The terrain-graded field the builder computes from the DEM." },
};

/** The default combination, and gmsh's own size sources: OFF when a field exists, or they win where it was written for. */
export const DEFAULT_OPTIONS = Object.freeze({
  combine: "min",        // "min" | "max"
  sizeMaxM: null,        // a global cap, or null for gmsh's own default
  sizeMinM: null,        // a global floor, or null for none
  extendFromBoundary: false,
  fromPoints: false,
  fromCurvature: 0,      // 0 off, else elements per 2π of curvature
  algorithm2d: null,     // gmsh Mesh.Algorithm, or null for the default
  algorithm3d: null,     // gmsh Mesh.Algorithm3D, or null for the default
});

const f = (v) => Number(v).toFixed(4);
const PY = (v) => JSON.stringify(v);

/** A new field of a type with sensible numbers, seeded from the study's coarse size. */
export function defaultField(type, { coarseM = 100, name = "" } = {}) {
  const fine = Math.max(1, coarseM / 4);
  const base = { id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, type, name: name || FIELD_TYPES[type]?.label || type, on: true };
  switch (type) {
    case "point": return { ...base, lat: null, lon: null, pointName: null, depthM: 0, sizeM: fine, distMinM: coarseM, distMaxM: coarseM * 5, sizeMaxM: null };
    case "boundary": return { ...base, key: "top", sizeM: fine, distMinM: coarseM / 2, distMaxM: coarseM * 4, sizeMaxM: null };
    case "box": return { ...base, west: null, east: null, south: null, north: null, zMinM: null, zMaxM: null, sizeM: fine, sizeOutM: null, thicknessM: coarseM };
    case "ball": return { ...base, lat: null, lon: null, zM: null, depthM: 0, radiusM: coarseM * 5, sizeM: fine, sizeOutM: null, thicknessM: coarseM };
    case "expr": return { ...base, expression: `${f(coarseM)}` };
    case "slope": return { ...base };
    default: return base;
  }
}

/** One line of prose about a field, for a status or a card. */
export function describeField(field, coarseM = null) {
  const out = (v) => (Number(v) > 0 ? `${Math.round(v)} m` : (coarseM ? `${Math.round(coarseM)} m (the coarse size)` : "the coarse size"));
  switch (field?.type) {
    case "point": return `${Math.round(field.sizeM)} m within ${Math.round(field.distMinM)} m of ${field.pointName ? `point "${field.pointName}"` : "the point"}, ${out(field.sizeMaxM)} past ${Math.round(field.distMaxM)} m`;
    case "boundary": return `${Math.round(field.sizeM)} m within ${Math.round(field.distMinM)} m of "${field.key}", ${out(field.sizeMaxM)} past ${Math.round(field.distMaxM)} m`;
    case "box": return `${Math.round(field.sizeM)} m inside the box, ${out(field.sizeOutM)} outside, blended over ${Math.round(field.thicknessM)} m`;
    case "ball": return `${Math.round(field.sizeM)} m within ${Math.round(field.radiusM)} m of the centre, ${out(field.sizeOutM)} outside, blended over ${Math.round(field.thicknessM)} m`;
    case "expr": return `F = ${field.expression}`;
    case "slope": return "the terrain-graded field (finer where the ground is steep)";
    default: return String(field?.type || "field");
  }
}

/**
 * THE PYTHON, for `gmsh.model.mesh.field`. `fields` are RESOLVED: a point
 * carries x, y, z; a box its local bounds; a ball its local centre; a
 * boundary its flag and the dimension of the entities it is measured from
 * (2 in a 3D block, 1 in a 2D section). `dim` is the model's. Returns the
 * lines to place after the physical groups are made (a boundary field looks
 * its entities up by flag) and before `generate`.
 */
export function sizeFieldLines({ fields = [], dim = 3, options = {}, structuredFile = null, coarseM = null } = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const coarse = Number(opt.sizeMaxM) > 0 ? Number(opt.sizeMaxM) : (Number(coarseM) > 0 ? Number(coarseM) : null);
  const outSize = (v) => (Number(v) > 0 ? Number(v) : (coarse || 1e22));
  const lines = [];
  const ids = [];
  let next = 1;
  const active = (fields || []).filter((fld) => fld && fld.on !== false);
  if (active.length || structuredFile) lines.push("", "# MESH SIZE FIELDS: a size per place, in gmsh's own terms, combined below.");
  active.forEach((fld) => {
    const name = String(fld.name || fld.type);
    lines.push(`# ${name}: ${describeField(fld, coarse)}`);
    if (fld.type === "point") {
      const d = next; const t = next + 1;
      lines.push(
        `gmsh.model.mesh.field.add("MathEval", ${d})`,
        `gmsh.model.mesh.field.setString(${d}, "F", ${PY(`sqrt((x-(${f(fld.x)}))^2+(y-(${f(fld.y)}))^2+(z-(${f(fld.z || 0)}))^2)`)})`,
        `gmsh.model.mesh.field.add("Threshold", ${t})`,
        `gmsh.model.mesh.field.setNumber(${t}, "InField", ${d})`,
        `gmsh.model.mesh.field.setNumber(${t}, "SizeMin", ${f(fld.sizeM)})`,
        `gmsh.model.mesh.field.setNumber(${t}, "SizeMax", ${f(outSize(fld.sizeMaxM))})`,
        `gmsh.model.mesh.field.setNumber(${t}, "DistMin", ${f(fld.distMinM)})`,
        `gmsh.model.mesh.field.setNumber(${t}, "DistMax", ${f(fld.distMaxM)})`,
      );
      ids.push(t); next += 2;
    } else if (fld.type === "boundary") {
      const d = next; const t = next + 1;
      const edim = Number(fld.entityDim) || (dim === 2 ? 1 : 2);
      const listName = edim === 2 ? "SurfacesList" : edim === 1 ? "CurvesList" : "PointsList";
      lines.push(
        `_ents = list(gmsh.model.getEntitiesForPhysicalGroup(${edim}, ${Math.round(Number(fld.flag))}))  # the entities wearing flag ${Math.round(Number(fld.flag))}`,
        `gmsh.model.mesh.field.add("Distance", ${d})`,
        `gmsh.model.mesh.field.setNumbers(${d}, ${PY(listName)}, _ents)`,
        `gmsh.model.mesh.field.setNumber(${d}, "Sampling", 100)`,
        `gmsh.model.mesh.field.add("Threshold", ${t})`,
        `gmsh.model.mesh.field.setNumber(${t}, "InField", ${d})`,
        `gmsh.model.mesh.field.setNumber(${t}, "SizeMin", ${f(fld.sizeM)})`,
        `gmsh.model.mesh.field.setNumber(${t}, "SizeMax", ${f(outSize(fld.sizeMaxM))})`,
        `gmsh.model.mesh.field.setNumber(${t}, "DistMin", ${f(fld.distMinM)})`,
        `gmsh.model.mesh.field.setNumber(${t}, "DistMax", ${f(fld.distMaxM)})`,
      );
      ids.push(t); next += 2;
    } else if (fld.type === "box") {
      lines.push(
        `gmsh.model.mesh.field.add("Box", ${next})`,
        `gmsh.model.mesh.field.setNumber(${next}, "XMin", ${f(fld.xMin)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "XMax", ${f(fld.xMax)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "YMin", ${f(fld.yMin)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "YMax", ${f(fld.yMax)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "ZMin", ${f(fld.zMin ?? -1e9)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "ZMax", ${f(fld.zMax ?? 1e9)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "VIn", ${f(fld.sizeM)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "VOut", ${f(outSize(fld.sizeOutM))})`,
        `gmsh.model.mesh.field.setNumber(${next}, "Thickness", ${f(Number(fld.thicknessM) > 0 ? fld.thicknessM : fld.sizeM)})`,
      );
      ids.push(next); next += 1;
    } else if (fld.type === "ball") {
      lines.push(
        `gmsh.model.mesh.field.add("Ball", ${next})`,
        `gmsh.model.mesh.field.setNumber(${next}, "XCenter", ${f(fld.x)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "YCenter", ${f(fld.y)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "ZCenter", ${f(fld.z || 0)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "Radius", ${f(fld.radiusM)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "VIn", ${f(fld.sizeM)})`,
        `gmsh.model.mesh.field.setNumber(${next}, "VOut", ${f(outSize(fld.sizeOutM))})`,
        `gmsh.model.mesh.field.setNumber(${next}, "Thickness", ${f(Number(fld.thicknessM) > 0 ? fld.thicknessM : fld.sizeM)})`,
      );
      ids.push(next); next += 1;
    } else if (fld.type === "expr") {
      lines.push(
        `gmsh.model.mesh.field.add("MathEval", ${next})`,
        `gmsh.model.mesh.field.setString(${next}, "F", ${PY(String(fld.expression || "1"))})`,
      );
      ids.push(next); next += 1;
    }
  });
  if (structuredFile) {
    lines.push(
      "# The terrain-graded field, written beside the STL.",
      `gmsh.model.mesh.field.add("Structured", ${next})`,
      `gmsh.model.mesh.field.setString(${next}, "FileName", ${PY(structuredFile)})`,
      `gmsh.model.mesh.field.setNumber(${next}, "TextFormat", 1)`,
      `gmsh.model.mesh.field.setNumber(${next}, "SetOutsideValue", 1)`,
      `gmsh.model.mesh.field.setNumber(${next}, "OutsideValue", ${f(coarse || 1e22)})`,
    );
    ids.push(next); next += 1;
  }
  if (ids.length) {
    const combine = opt.combine === "max" ? "Max" : "Min";
    lines.push(
      `# ${combine === "Min" ? "The smallest wins at every place" : "The largest wins at every place"}.`,
      `gmsh.model.mesh.field.add(${PY(combine)}, ${next})`,
      `gmsh.model.mesh.field.setNumbers(${next}, "FieldsList", [${ids.join(", ")}])`,
      `gmsh.model.mesh.field.setAsBackgroundMesh(${next})`,
    );
  }
  // gmsh's own size sources, stated whether or not a field exists, so the
  // choice is on the page rather than in a default nobody sees.
  lines.push(
    "",
    "# gmsh's own size sources. With a background field they are OFF unless asked: they win exactly where the field was written for.",
    `gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", ${opt.extendFromBoundary ? 1 : 0})`,
    `gmsh.option.setNumber("Mesh.MeshSizeFromPoints", ${opt.fromPoints ? 1 : 0})`,
    `gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", ${Number(opt.fromCurvature) > 0 ? Math.round(Number(opt.fromCurvature)) : 0})`,
  );
  if (Number(opt.sizeMaxM) > 0) lines.push(`gmsh.option.setNumber("Mesh.MeshSizeMax", ${f(opt.sizeMaxM)})`);
  if (Number(opt.sizeMinM) > 0) lines.push(`gmsh.option.setNumber("Mesh.MeshSizeMin", ${f(opt.sizeMinM)})`);
  if (Number(opt.algorithm2d) > 0) lines.push(`gmsh.option.setNumber("Mesh.Algorithm", ${Math.round(Number(opt.algorithm2d))})`);
  if (Number(opt.algorithm3d) > 0 && dim === 3) lines.push(`gmsh.option.setNumber("Mesh.Algorithm3D", ${Math.round(Number(opt.algorithm3d))})`);
  return lines;
}

/** The smallest size any field asks for, for a status line and a floor. */
export function smallestSize(fields = []) {
  let min = Infinity;
  (fields || []).forEach((fld) => {
    if (!fld || fld.on === false) return;
    if (Number(fld.sizeM) > 0) min = Math.min(min, Number(fld.sizeM));
  });
  return Number.isFinite(min) ? min : null;
}
