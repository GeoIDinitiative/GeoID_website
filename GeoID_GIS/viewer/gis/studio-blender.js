/**
 * BLENDER, THE STUDIO'S SECOND MESHER -- beside gmsh, never instead of it.
 *
 * gmsh stays the default: it builds OCC solids, fragments them so interfaces
 * conform, and carries every flag chosen on the page. Blender is the other
 * way to make the same model -- its exact booleans, voxel remesh and the tools
 * an AI can drive through a Blender MCP server -- and a model says which one
 * it wants (`MESHERS`, the same two names a GeoID Network model post carries).
 *
 * Two pure pieces:
 *
 * - `studioBlenderScript(model)` emits a bpy script: every primitive as a
 *   Blender mesh (bmesh, no operator context needed, so it runs headless and
 *   inside a live Blender alike), the booleans in the studio's own order with
 *   the EXACT solver, an optional voxel remesh, and one JSON file of the
 *   result's closed surfaces, split into loose parts. The sidecar's driver
 *   (`sidecar/blender_mesher.py`) reads that file, flags the faces, nests the
 *   shells and has gmsh fill the volume -- so a Blender model ends as the same
 *   `meshes/<name>.msh` FEM Setup and the GALES prepare already read.
 *
 * - `shapesToSolids(shapes)` reads a shape list an AI wrote ({kind, op,
 *   ...params}) into studio entries, numbers only, against the primitives'
 *   own parameter specs. Nothing a model writes becomes Python text: the
 *   script is built from numbers this module formats.
 */
import { PRIMITIVES, parseThicknesses } from "./mesh-primitives.js";

export const MESHERS = ["gmsh", "blender"];
export const OPS = ["union", "difference", "intersect"];
/** The kinds Blender can build. The atmosphere is gmsh's alone. */
export const BLENDER_KINDS = ["box", "sphere", "ellipsoid", "cylinder", "cone", "torus", "layered_halfspace", "volcano_edifice", "dike"];
/** The most shapes one request may carry -- a model, not a scene. */
export const MAX_SHAPES = 32;

const f = (v) => Number(v).toFixed(6);
const DEG = Math.PI / 180;

/** The mesher a model asked for, or gmsh. */
export function normMesher(m) {
  return MESHERS.includes(String(m || "").toLowerCase()) ? String(m).toLowerCase() : "gmsh";
}

/** The bpy lines that leave one primitive's object(s) in `objs[i]`. */
function bpyLines(entry, i, notes) {
  const p = entry.params || {};
  const kind = entry.kind;
  const at = (x, y, z) => `(${f(x)}, ${f(y)}, ${f(z)})`;
  if (kind === "box") return [`objs[${i}] = [box(${at(p.x, p.y, p.z)}, ${at(p.dx, p.dy, p.dz)})]`];
  if (kind === "sphere") return [`objs[${i}] = [ellipsoid(${at(p.x, p.y, p.z)}, ${at(p.r, p.r, p.r)})]`];
  if (kind === "ellipsoid") return [`objs[${i}] = [ellipsoid(${at(p.x, p.y, p.z)}, ${at(p.rx, p.ry, p.rz)})]`];
  if (kind === "cylinder") return [`objs[${i}] = [cone(${at(p.x, p.y, p.z)}, ${f(p.h)}, ${f(p.r)}, ${f(p.r)})]`];
  if (kind === "cone") return [`objs[${i}] = [cone(${at(p.x, p.y, p.z)}, ${f(p.h)}, ${f(p.r1)}, ${f(p.r2)})]`];
  if (kind === "torus") return [`objs[${i}] = [torus(${at(p.x, p.y, p.z)}, ${f(p.r1)}, ${f(p.r2)})]`];
  if (kind === "layered_halfspace") {
    // ONE BLOCK, not one volume per layer: Blender has no fragment, and
    // stacked boxes that only touch would give gmsh two copies of every
    // interface. A layered model wants gmsh; this says so.
    const total = parseThicknesses(p.thicknesses).reduce((a, b) => a + b, 0) || 1;
    notes.push("Blender meshes a layered halfspace as one block; its layers need gmsh.");
    return [`objs[${i}] = [box(${at(-p.width / 2, -p.depth / 2, -total)}, ${at(p.width, p.depth, total)})]`];
  }
  if (kind === "volcano_edifice") {
    return [
      `_crust = box(${at(-p.crust_width / 2, -p.crust_width / 2, -p.crust_depth)}, ${at(p.crust_width, p.crust_width, p.crust_depth)})`,
      `_cone = cone((0.0, 0.0, 0.0), ${f(p.height)}, ${f(p.base_radius)}, ${f(p.summit_radius)})`,
      "objs[" + i + "] = [boolean(_crust, _cone, 'UNION')]",
    ];
  }
  if (kind === "dike") {
    // The studio's frame, as studio-gmsh.js builds it: a thin box about the
    // origin, tilted (90 - dip) about y, turned -strike about z, then moved.
    const zc = -Math.abs(p.top_depth) - p.height / 2;
    return [`objs[${i}] = [box(${at(-p.thickness / 2, -p.length / 2, -p.height / 2)}, ${at(p.thickness, p.length, p.height)}, `
      + `rot_y=${f((90 - p.dip) * DEG)}, rot_z=${f(-p.strike * DEG)}, move=${at(p.x, p.y, zc)})]`];
  }
  notes.push(`${kind}: Blender has no construction for it; left out.`);
  return [`objs[${i}] = []`];
}

/**
 * The bpy script. `solids` are the studio's entries (kind, op, params,
 * enabled, flags.void); `remeshM` > 0 voxel-remeshes the result at that size
 * (metres) -- Blender's own way to a clean, even surface; `segments` sets the
 * round primitives' resolution. Returns { script, notes }.
 *
 * The output path is GEOID_OUT if the runner defined it (a live Blender over
 * MCP, where there is no argv), else the first argument after `--`
 * (`blender --background --python s.py -- out.json`).
 */
export function studioBlenderScript({ name = "geoid_studio", solids = [], remeshM = 0, segments = 48 } = {}) {
  const notes = [];
  const active = solids.filter((s) => s.enabled !== false && s.kind !== "atmosphere");
  const seg = Math.max(8, Math.min(256, Math.round(Number(segments) || 48)));
  const lines = [
    "# GeoID Meshing Studio — the model as Blender geometry, for the sidecar's Blender mesher.",
    "# Run: blender --background --factory-startup --python this_script.py -- out.json",
    "# (or through the sidecar's /jobs/blender, headless or into a live Blender over MCP)",
    "import bpy, bmesh, json, math, sys",
    "from mathutils import Matrix, Vector",
    "",
    "OUT = globals().get('GEOID_OUT') or (sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'geoid_blender.json')",
    `SEG = ${seg}`,
    `NAME = ${JSON.stringify(String(name).replace(/[^A-Za-z0-9_.-]/g, "_"))}`,
    "",
    "# A clean slate: this script owns the scene it builds (a live Blender is told",
    "# the same — its objects named geoid_* are replaced, nothing else is touched).",
    "for ob in [o for o in bpy.data.objects if o.name.startswith('geoid_')]:",
    "    bpy.data.objects.remove(ob, do_unlink=True)",
    "",
    "def _obj(bm, tag):",
    "    me = bpy.data.meshes.new('geoid_' + tag)",
    "    bm.to_mesh(me)",
    "    bm.free()",
    "    ob = bpy.data.objects.new('geoid_' + tag, me)",
    "    bpy.context.scene.collection.objects.link(ob)",
    "    return ob",
    "",
    "def box(origin, size, rot_y=0.0, rot_z=0.0, move=(0.0, 0.0, 0.0)):",
    "    bm = bmesh.new()",
    "    bmesh.ops.create_cube(bm, size=1.0)",
    "    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)",
    "    c = Vector(origin) + Vector(size) / 2",
    "    bmesh.ops.translate(bm, vec=c, verts=bm.verts)",
    "    if rot_y or rot_z:",
    "        m = Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Rotation(rot_y, 4, 'Y')",
    "        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=m, verts=bm.verts)",
    "    bmesh.ops.translate(bm, vec=Vector(move), verts=bm.verts)",
    "    return _obj(bm, 'box')",
    "",
    "def ellipsoid(center, radii):",
    "    bm = bmesh.new()",
    "    bmesh.ops.create_uvsphere(bm, u_segments=SEG, v_segments=max(SEG // 2, 4), radius=1.0)",
    "    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)",
    "    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)",
    "    return _obj(bm, 'ellipsoid')",
    "",
    "def cone(base, h, r1, r2):",
    "    bm = bmesh.new()",
    "    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=SEG, radius1=r1, radius2=r2, depth=h)",
    "    bmesh.ops.translate(bm, vec=Vector(base) + Vector((0, 0, h / 2)), verts=bm.verts)",
    "    if r2 <= 0:",
    "        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-9)",
    "    return _obj(bm, 'cone')",
    "",
    "def torus(center, R, r):",
    "    bm = bmesh.new()",
    "    ring = []",
    "    for i in range(SEG):",
    "        a = 2 * math.pi * i / SEG",
    "        row = []",
    "        for j in range(max(SEG // 2, 6)):",
    "            b = 2 * math.pi * j / max(SEG // 2, 6)",
    "            w = R + r * math.cos(b)",
    "            row.append(bm.verts.new((center[0] + w * math.cos(a), center[1] + w * math.sin(a), center[2] + r * math.sin(b))))",
    "        ring.append(row)",
    "    n, m = len(ring), len(ring[0])",
    "    for i in range(n):",
    "        for j in range(m):",
    "            bm.faces.new((ring[i][j], ring[(i + 1) % n][j], ring[(i + 1) % n][(j + 1) % m], ring[i][(j + 1) % m]))",
    "    return _obj(bm, 'torus')",
    "",
    "def boolean(a, b, op):",
    "    \"\"\"a <op> b with the EXACT solver, applied without operator context.\"\"\"",
    "    mod = a.modifiers.new('geoid_bool', 'BOOLEAN')",
    "    mod.operation = op",
    "    mod.solver = 'EXACT'",
    "    mod.object = b",
    "    dg = bpy.context.evaluated_depsgraph_get()",
    "    me = bpy.data.meshes.new_from_object(a.evaluated_get(dg))",
    "    a.modifiers.clear()",
    "    a.data = me",
    "    bpy.data.objects.remove(b, do_unlink=True)",
    "    return a",
    "",
    `objs = [None] * ${active.length}`,
    "",
    "# THE PRIMITIVES, in the order they were added.",
  ];
  active.forEach((entry, i) => {
    lines.push(`# ${i}: ${entry.kind} (${entry.op || "union"})`);
    lines.push(...bpyLines(entry, i, notes));
  });
  const ops = active.map((e) => (OPS.includes(e.op) ? e.op : "union"));
  if (active.some((e, i) => i > 0 && ops[i] === "difference" && !e.flags?.void)) {
    notes.push("A cut is kept as its own volume (a chamber is a domain too), as gmsh keeps it.");
  }
  lines.push(
    "",
    "# THE BOOLEANS, in the studio's order: the first is the object; each later one",
    "# fuses into it, is cut from it, or intersects it.",
    `OPS = ${JSON.stringify(ops)}`,
    "model = None",
    "for i, group in enumerate(objs):",
    "    for ob in group or []:",
    "        if model is None:",
    "            model = ob",
    "            continue",
    "        model = boolean(model, ob, {'union': 'UNION', 'difference': 'DIFFERENCE', 'intersect': 'INTERSECT'}[OPS[i]])",
    "if model is None:",
    "    # RuntimeError, not SystemExit: in a live Blender an exit would close it.",
    "    raise RuntimeError('nothing to mesh — the model has no solids Blender can build')",
    "model.name = 'geoid_' + NAME",
    "",
  );
  const remesh = Number(remeshM);
  if (remesh > 0) {
    lines.push(
      "# A VOXEL REMESH: an even surface at one size, which is what a tet mesher likes.",
      "rm = model.modifiers.new('geoid_remesh', 'REMESH')",
      "rm.mode = 'VOXEL'",
      `rm.voxel_size = ${f(remesh)}`,
      "dg = bpy.context.evaluated_depsgraph_get()",
      "me = bpy.data.meshes.new_from_object(model.evaluated_get(dg))",
      "model.modifiers.clear()",
      "model.data = me",
      "",
    );
  }
  lines.push(
    "# THE SURFACES OUT: triangulated, split into loose parts (an outer shell, a",
    "# chamber's wall), each its vertices and triangles. The sidecar does the rest.",
    "bm = bmesh.new()",
    "bm.from_mesh(model.data)",
    "bm.transform(model.matrix_world)",
    "bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)",
    "bmesh.ops.triangulate(bm, faces=bm.faces)",
    "bm.verts.index_update()",
    "bm.verts.ensure_lookup_table()",
    "seen, parts = set(), []",
    "for v0 in bm.verts:",
    "    if v0.index in seen:",
    "        continue",
    "    stack, comp = [v0], []",
    "    seen.add(v0.index)",
    "    while stack:",
    "        v = stack.pop()",
    "        comp.append(v)",
    "        for e in v.link_edges:",
    "            w = e.other_vert(v)",
    "            if w.index not in seen:",
    "                seen.add(w.index)",
    "                stack.append(w)",
    "    ids = {v.index for v in comp}",
    "    faces = [fc for fc in bm.faces if fc.verts[0].index in ids]",
    "    if not faces:",
    "        continue",
    "    local = {}",
    "    verts, tris = [], []",
    "    for fc in faces:",
    "        for v in fc.verts:",
    "            if v.index not in local:",
    "                local[v.index] = len(local)",
    "                verts.extend((v.co.x, v.co.y, v.co.z))",
    "        tris.extend(local[v.index] for v in fc.verts)",
    "    parts.append({'verts': verts, 'tris': tris})",
    "bm.free()",
    "with open(OUT, 'w') as fh:",
    "    json.dump({'name': NAME, 'parts': parts, 'blender': bpy.app.version_string}, fh)",
    "print('GeoID: wrote %d surface part(s) to %s' % (len(parts), OUT))",
  );
  return { script: `${lines.join("\n")}\n`, notes };
}

/**
 * A shape list an AI wrote, as studio entries. Each shape is
 * { kind, op?, ...params }: the kind one of BLENDER_KINDS, the op one of OPS
 * (the first shape's op is ignored -- it is the object), every parameter a
 * finite number from that primitive's own spec, missing ones its default.
 * Returns { ok, solids, problems }; never throws.
 */
export function shapesToSolids(shapes) {
  const problems = [];
  const solids = [];
  if (!Array.isArray(shapes) || !shapes.length) return { ok: false, solids, problems: ["shapes must be a non-empty list"] };
  if (shapes.length > MAX_SHAPES) return { ok: false, solids, problems: [`at most ${MAX_SHAPES} shapes`] };
  shapes.forEach((s, i) => {
    const kind = String(s?.kind || "").toLowerCase();
    if (!BLENDER_KINDS.includes(kind)) { problems.push(`shape ${i + 1}: kind must be one of ${BLENDER_KINDS.join(", ")}`); return; }
    const op = i === 0 ? "union" : String(s.op || "union").toLowerCase();
    if (!OPS.includes(op)) { problems.push(`shape ${i + 1}: op must be one of ${OPS.join(", ")}`); return; }
    const params = {};
    for (const [key, [, def]] of Object.entries(PRIMITIVES[kind].params)) {
      const raw = s[key];
      if (key === "thicknesses") {
        const th = parseThicknesses(raw ?? def);
        if (!th.length) problems.push(`shape ${i + 1}: thicknesses must be positive numbers`);
        params[key] = th.join(",");
        continue;
      }
      if (raw === undefined || raw === null || raw === "") { params[key] = def; continue; }
      const v = Number(raw);
      if (!Number.isFinite(v)) { problems.push(`shape ${i + 1}: ${key} must be a number`); continue; }
      params[key] = v;
    }
    const sizeKeys = ["dx", "dy", "dz", "r", "rx", "ry", "rz", "h", "r1", "width", "depth", "length", "height", "thickness", "crust_width", "crust_depth", "base_radius"];
    sizeKeys.filter((k) => k in params && k !== "r1").forEach((k) => {
      if (!(params[k] > 0)) problems.push(`shape ${i + 1}: ${k} must be greater than 0`);
    });
    if ("r1" in params && kind !== "cone" && !(params.r1 > 0)) problems.push(`shape ${i + 1}: r1 must be greater than 0`);
    if (kind === "cone" && !(params.r1 > 0 || params.r2 > 0)) problems.push(`shape ${i + 1}: a cone needs a radius`);
    solids.push({ kind, op, enabled: true, params, flags: { void: Boolean(s.void) } });
  });
  return { ok: !problems.length, solids, problems };
}

/** The mesher's verdict on this machine, from GET /capabilities, as a sentence or null. */
export function blenderUnavailable(caps) {
  if (!caps) return "The local sidecar is not connected — Blender runs through it. Start it and connect it in Settings.";
  const b = caps.blender || {};
  if (!b.binary && !b.mcp) {
    return "Blender is not installed on this machine. Install Blender 4.2 LTS or newer (blender.org, "
      + "or `sudo snap install blender --classic`) so `blender` is on PATH, then restart the sidecar. "
      + "To drive a Blender you have open instead, add the blender-mcp addon (github.com/ahujasid/blender-mcp) "
      + "and press Connect in its sidebar tab.";
  }
  if (!b.gmsh) {
    return "Blender is here, but gmsh is not: Blender builds the surfaces and gmsh fills the volume with tetrahedra. "
      + "Install it with `pip install gmsh`.";
  }
  return null;
}
