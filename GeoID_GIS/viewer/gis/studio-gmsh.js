/**
 * THE STUDIO'S OWN GMSH ENVIRONMENT -- the same modular one the Model
 * Builder writes for a DEM, for geometry built on the model page.
 *
 * Two pure pieces:
 *
 * - `faceParts(positions)` splits a primitive's display surface into FACES a
 *   reader can point at: triangles are clustered by normal, a planar cluster
 *   is a face named by the axis it faces (top, base, north, south, east,
 *   west), and everything curved is one "side" (a sphere is one "surface").
 *   Each part carries its centroid and mean normal, which is how the script
 *   below finds the same face again among gmsh's OCC surfaces.
 *
 * - `studioGmshScript(model)` emits a runnable gmsh python: every primitive
 *   as an OCC solid, the booleans in the order the studio applied them, a
 *   layered halfspace as one volume per layer, an ATMOSPHERE as a box over
 *   the model cut by it, everything fragmented so shared interfaces conform,
 *   physical groups for every volume and every face by the flags chosen on
 *   the cards (faces matched to OCC surfaces by centroid and normal), the
 *   embedded points, and the size fields through mesh-size-fields.js.
 */
import { parseThicknesses } from "./mesh-primitives.js";
import { sizeFieldLines } from "./mesh-size-fields.js";

const PY = (v) => JSON.stringify(v);
/** A JSON value as a Python literal: true/false/null are True/False/None there. */
const PYL = (v) => JSON.stringify(v).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");
const f = (v) => Number(v).toFixed(6);
const DEG = Math.PI / 180;

/** Flags a face takes by where it faces, when the study has not chosen one. */
export const DEFAULT_FACE_FLAGS = { top: 1, base: 2, north: 5, south: 5, east: 5, west: 5, side: 5, surface: 5, sky: 4, sides_above: 6 };

function triNormal(p, i) {
  const ax = p[i], ay = p[i + 1], az = p[i + 2];
  const bx = p[i + 3] - ax, by = p[i + 4] - ay, bz = p[i + 5] - az;
  const cx = p[i + 6] - ax, cy = p[i + 7] - ay, cz = p[i + 8] - az;
  const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len, len / 2];
}

/**
 * Faces from a triangle soup. `planarTol` is the cosine below which two
 * normals are different faces; a cluster holding fewer than `minShare` of the
 * triangles (a facet of a curved surface) is curved, and every curved
 * triangle is one part.
 */
export function faceParts(positions, { planarTol = 0.9995, curvedCos = 0.906 } = {}) {
  const n = positions.length / 9;
  if (!n) return [];
  const normals = [];
  for (let t = 0; t < n; t += 1) normals.push(triNormal(positions, t * 9));
  // cluster by normal, greedily
  const clusters = [];
  for (let t = 0; t < n; t += 1) {
    const nt = normals[t];
    let found = null;
    for (const c of clusters) {
      if (c.n[0] * nt[0] + c.n[1] * nt[1] + c.n[2] * nt[2] >= planarTol) { found = c; break; }
    }
    if (found) found.tris.push(t); else clusters.push({ n: [nt[0], nt[1], nt[2]], tris: [t] });
  }
  /**
   * CURVED OR PLANAR is decided by the NEIGHBOURS, not by size. A facet of a
   * revolved surface has another facet a few degrees away (7.5° on a 48-segment
   * cone); a box face has nothing nearer than 90°. Counting triangles got it
   * wrong both ways: a crust's six faces are two triangles each and read as
   * curved beside a 96-triangle cone.
   */
  clusters.forEach((c) => {
    let nearest = -1;
    clusters.forEach((o) => { if (o !== c) nearest = Math.max(nearest, c.n[0] * o.n[0] + c.n[1] * o.n[1] + c.n[2] * o.n[2]); });
    c.curved = nearest >= curvedCos;
  });
  const planar = clusters.filter((c) => !c.curved);
  const curvedTris = clusters.filter((c) => c.curved).flatMap((c) => c.tris);
  const named = new Map();
  const partOf = (tris, normal, curved) => {
    let cx = 0, cy = 0, cz = 0, area = 0;
    tris.forEach((t) => {
      const i = t * 9; const a = normals[t][3];
      cx += ((positions[i] + positions[i + 3] + positions[i + 6]) / 3) * a;
      cy += ((positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3) * a;
      cz += ((positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3) * a;
      area += a;
    });
    const centroid = area ? [cx / area, cy / area, cz / area] : [0, 0, 0];
    let key;
    if (curved) key = "side";
    else {
      const [x, y, z] = normal; const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if (az >= ax && az >= ay) key = z > 0 ? "top" : "base";
      else if (ay >= ax) key = y > 0 ? "north" : "south";
      else key = x > 0 ? "east" : "west";
    }
    const count = (named.get(key) || 0) + 1; named.set(key, count);
    const face = count > 1 ? `${key}_${count}` : key;
    return { key, face, name: face, curved, normal: curved ? null : normal, centroid, triangles: tris, area, flag: DEFAULT_FACE_FLAGS[key] ?? 5 };
  };
  const parts = planar.map((c) => partOf(c.tris, c.n, false));
  if (curvedTris.length) {
    const only = !parts.length;
    const p = partOf(curvedTris, null, true);
    if (only) { p.key = "surface"; p.face = "surface"; p.name = "surface"; p.flag = DEFAULT_FACE_FLAGS.surface; }
    parts.push(p);
  }
  return parts;
}

/** The positions of one part, for a display mesh of its own. */
export function partPositions(positions, part) {
  const out = new Float32Array(part.triangles.length * 9);
  part.triangles.forEach((t, k) => { for (let j = 0; j < 9; j += 1) out[k * 9 + j] = positions[t * 9 + j]; });
  return out;
}

/** The OCC lines that make one primitive, leaving its volume tag(s) in `tags[i]`. */
function occLines(entry, i) {
  const p = entry.params || {};
  const lines = [];
  const kind = entry.kind;
  if (kind === "box") lines.push(`tags[${i}] = [occ.addBox(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.dx)}, ${f(p.dy)}, ${f(p.dz)})]`);
  else if (kind === "sphere") lines.push(`tags[${i}] = [occ.addSphere(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r)})]`);
  else if (kind === "ellipsoid") {
    lines.push(`tags[${i}] = [occ.addSphere(0.0, 0.0, 0.0, 1.0)]`,
      `occ.dilate([(3, tags[${i}][0])], 0.0, 0.0, 0.0, ${f(p.rx)}, ${f(p.ry)}, ${f(p.rz)})`,
      `occ.translate([(3, tags[${i}][0])], ${f(p.x)}, ${f(p.y)}, ${f(p.z)})`);
  } else if (kind === "cylinder") lines.push(`tags[${i}] = [occ.addCylinder(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0.0, 0.0, ${f(p.h)}, ${f(p.r)})]`);
  else if (kind === "cone") lines.push(`tags[${i}] = [occ.addCone(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0.0, 0.0, ${f(p.h)}, ${f(p.r1)}, ${f(p.r2)})]`);
  else if (kind === "torus") lines.push(`tags[${i}] = [occ.addTorus(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r1)}, ${f(p.r2)})]`);
  else if (kind === "layered_halfspace") {
    // ONE VOLUME PER LAYER: boxes stacked down from z = 0, fragmented later so
    // the interfaces are shared and each layer keeps its own flag.
    const ths = parseThicknesses(p.thicknesses);
    let z = 0; const parts = [];
    ths.forEach((th) => { parts.push(`occ.addBox(${f(-p.width / 2)}, ${f(-p.depth / 2)}, ${f(z - th)}, ${f(p.width)}, ${f(p.depth)}, ${f(th)})`); z -= th; });
    lines.push(`tags[${i}] = [${parts.join(", ")}]`);
  } else if (kind === "volcano_edifice") {
    lines.push(`_crust = occ.addBox(${f(-p.crust_width / 2)}, ${f(-p.crust_width / 2)}, ${f(-p.crust_depth)}, ${f(p.crust_width)}, ${f(p.crust_width)}, ${f(p.crust_depth)})`,
      `_cone = occ.addCone(0.0, 0.0, 0.0, 0.0, 0.0, ${f(p.height)}, ${f(p.base_radius)}, ${f(p.summit_radius)})`,
      `_fused, _ = occ.fuse([(3, _crust)], [(3, _cone)])`,
      `tags[${i}] = [t for (d, t) in _fused if d == 3]`);
  } else if (kind === "dike") {
    // The studio's own frame: a thin box about the origin, tilted from
    // vertical by (90 - dip) about y, turned by -strike about z, then moved.
    const zc = -Math.abs(p.top_depth) - p.height / 2;
    lines.push(`_d = occ.addBox(${f(-p.thickness / 2)}, ${f(-p.length / 2)}, ${f(-p.height / 2)}, ${f(p.thickness)}, ${f(p.length)}, ${f(p.height)})`,
      `occ.rotate([(3, _d)], 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, ${f((90 - p.dip) * DEG)})`,
      `occ.rotate([(3, _d)], 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, ${f(-p.strike * DEG)})`,
      `occ.translate([(3, _d)], ${f(p.x)}, ${f(p.y)}, ${f(zc)})`,
      `tags[${i}] = [_d]`);
  } else {
    lines.push(`tags[${i}] = []  # ${kind}: no OCC construction known; ${PY(p)}`);
  }
  return lines;
}

/**
 * The script. `solids` are the studio's entries (kind, op, params, flags
 * {volume, faces}, parts [{face, flag, centroid, normal}]), `atmosphere`
 * {on, heightM, baseZ}, `points` [{name, x, y, z, flag, sizeM}], `sizeFields`
 * resolved (see mesh-size-fields), `meshOptions` likewise. Units are the
 * studio's (metres).
 */
export function studioGmshScript({
  name = "geoid_studio", solids = [], atmosphere = null, points = [], sizeFields = [], meshOptions = null,
  flags = {}, meshFile = null, order = 1,
} = {}) {
  const F = { domain: 10, atmosphere: 11, sky: 4, sides_above: 6, points: 20, ...flags };
  // The air's volume flag is the page's choice where it made one (it takes a number
  // no primitive holds), else the default.
  if (Number(atmosphere?.flags?.volume) > 0) F.atmosphere = Number(atmosphere.flags.volume);
  const active = solids.filter((s) => s.enabled !== false && s.kind !== "atmosphere");
  const lines = [
    "# GeoID Meshing Studio — the model as gmsh OCC geometry, with every flag chosen on the page.",
    "# Run: python3 this_script.py   (or through the sidecar's /jobs/gmsh)",
    "import gmsh, math",
    "",
    "gmsh.initialize()",
    "gmsh.option.setNumber(\"General.Terminal\", 1)",
    `gmsh.model.add(${PY(name)})`,
    "occ = gmsh.model.occ",
    `tags = [None] * ${active.length}`,
    "",
    "# THE PRIMITIVES, in the order they were added.",
  ];
  active.forEach((entry, i) => { lines.push(`# ${i}: ${entry.kind} (${entry.op})`); lines.push(...occLines(entry, i)); });
  lines.push(
    "",
    "# THE BOOLEANS, in the studio's own order: the first union is the object; each",
    "# later entity fuses into it, is cut from it, or intersects it. A cut tool is",
    "# kept as a volume of its own (a chamber is a domain too) unless flagged void.",
    "model = []       # (dim, tag) of the object",
    "keep = []        # (dim, tag) of cut tools kept as their own volumes",
    `ops = ${PY(active.map((e) => e.op || "union"))}`,
    `void_tools = ${PYL(active.map((e) => Boolean(e.flags?.void)))}`,
    "for i, t in enumerate(tags):",
    "    ents = [(3, x) for x in (t or [])]",
    "    if not ents:",
    "        continue",
    "    if not model:",
    "        model = ents",
    "        continue",
    "    if ops[i] == 'union':",
    "        out, _ = occ.fuse(model, ents, removeObject=True, removeTool=True)",
    "        model = out",
    "    elif ops[i] == 'intersect':",
    "        out, _ = occ.intersect(model, ents, removeObject=True, removeTool=True)",
    "        model = out",
    "    else:",
    "        out, _ = occ.cut(model, ents, removeObject=True, removeTool=void_tools[i])",
    "        model = out",
    "        if not void_tools[i]:",
    "            keep += ents",
    "",
  );
  if (atmosphere?.on && Number(atmosphere.heightM) > 0) {
    const a = atmosphere;
    lines.push(
      "# THE ATMOSPHERE: a box over the model from its ground level up, with the model cut",
      "# out of it, so the air wraps whatever stands above the ground.",
      `air = [(3, occ.addBox(${f(a.minX)}, ${f(a.minY)}, ${f(a.baseZ)}, ${f(a.maxX - a.minX)}, ${f(a.maxY - a.minY)}, ${f(a.heightM)}))]`,
      "air, _ = occ.cut(air, model + keep, removeObject=True, removeTool=False)",
      "",
    );
  } else {
    lines.push("air = []", "");
  }
  lines.push(
    "# FRAGMENT everything so every shared interface is one surface, then synchronize.",
    "everything = model + keep + air",
    "if len(everything) > 1:",
    "    frag, _ = occ.fragment(everything[:1], everything[1:])",
    "occ.synchronize()",
    "volumes = [t for (d, t) in gmsh.model.getEntities(3)]",
    "",
    "# WHICH VOLUME IS WHICH: by the centre of mass of what each entity built.",
    `entity_names = ${PY(active.map((e, i) => e.name || `${e.kind}_${i + 1}`))}`,
    `entity_volume_flags = ${PY(active.map((e, i) => Number(e.flags?.volume) > 0 ? Number(e.flags.volume) : F.domain + i))}`,
    `layer_flags = ${PYL(active.map((e) => (e.kind === "layered_halfspace" ? parseThicknesses(e.params?.thicknesses).map((_, k) => (Number(e.flags?.layers?.[k]) > 0 ? Number(e.flags.layers[k]) : (Number(e.flags?.volume) > 0 ? Number(e.flags.volume) : F.domain) + k)) : null)))}`,
    `layer_tops = ${PYL(active.map((e) => (e.kind === "layered_halfspace" ? (() => { const ths = parseThicknesses(e.params?.thicknesses); let z = 0; return ths.map((th) => { const top = z; z -= th; return [top, z]; }); })() : null)))}`,
    `entity_tests = ${PYL(active.map((e) => ({ kind: e.kind, params: e.params || {} })))}`,
    "",
    `air_box = ${atmosphere?.on && Number(atmosphere.heightM) > 0 ? PYL([atmosphere.minX, atmosphere.minY, atmosphere.baseZ, atmosphere.maxX, atmosphere.maxY, atmosphere.baseZ + Number(atmosphere.heightM)]) : "None"}`,
    `air_flags = ${PY({ sky: Number(atmosphere?.flags?.sky) > 0 ? Number(atmosphere.flags.sky) : F.sky, sides: Number(atmosphere?.flags?.sides) > 0 ? Number(atmosphere.flags.sides) : F.sides_above })}`,
    "def inside_entity(i, x, y, z):",
    "    p = entity_tests[i]['params']; k = entity_tests[i]['kind']",
    "    if k == 'box': return p['x'] <= x <= p['x'] + p['dx'] and p['y'] <= y <= p['y'] + p['dy'] and p['z'] <= z <= p['z'] + p['dz']",
    "    if k == 'sphere': return (x - p['x'])**2 + (y - p['y'])**2 + (z - p['z'])**2 <= p['r']**2",
    "    if k == 'ellipsoid': return ((x - p['x']) / p['rx'])**2 + ((y - p['y']) / p['ry'])**2 + ((z - p['z']) / p['rz'])**2 <= 1",
    "    if k == 'cylinder': return p['z'] <= z <= p['z'] + p['h'] and (x - p['x'])**2 + (y - p['y'])**2 <= p['r']**2",
    "    if k == 'cone':",
    "        if not (p['z'] <= z <= p['z'] + p['h']): return False",
    "        t = 0 if p['h'] == 0 else (z - p['z']) / p['h']; r = p['r1'] + (p['r2'] - p['r1']) * t",
    "        return (x - p['x'])**2 + (y - p['y'])**2 <= r * r",
    "    if k == 'torus':",
    "        a = math.hypot(x - p['x'], y - p['y']) - p['r1']; return a * a + (z - p['z'])**2 <= p['r2']**2",
    "    if k == 'layered_halfspace':",
    "        total = -layer_tops[i][-1][1]",
    "        return abs(x) <= p['width'] / 2 and abs(y) <= p['depth'] / 2 and -total <= z <= 0",
    "    if k == 'volcano_edifice':",
    "        w = p['crust_width'] / 2",
    "        if abs(x) <= w and abs(y) <= w and -p['crust_depth'] <= z <= 0: return True",
    "        if z < 0 or z > p['height']: return False",
    "        t = 0 if p['height'] == 0 else z / p['height']; r = p['base_radius'] + (p['summit_radius'] - p['base_radius']) * t",
    "        return x * x + y * y <= r * r",
    "    if k == 'dike':",
    "        zc = -abs(p['top_depth']) - p['height'] / 2",
    "        dip = (90 - p['dip']) * math.pi / 180; st = -p['strike'] * math.pi / 180",
    "        cd, sd, cs, ss = math.cos(dip), math.sin(dip), math.cos(st), math.sin(st)",
    "        qx, qy, qz = x - p['x'], y - p['y'], z - zc",
    "        x1 = qx * cs + qy * ss; y1 = -qx * ss + qy * cs",
    "        lx, ly, lz = x1 * cd - qz * sd, y1, x1 * sd + qz * cd",
    "        return abs(lx) <= p['thickness'] / 2 and abs(ly) <= p['length'] / 2 and abs(lz) <= p['height'] / 2",
    "    return False",
    "",
    "def classify_volume(tag):",
    "    x, y, z = occ.getCenterOfMass(3, tag)",
    "    # THE AIR FIRST, by its box: its centre of mass can sit inside the edifice it wraps",
    "    # (measured -- a cone in a symmetric air box put the air's centroid in the cone).",
    "    if air_box is not None:",
    "        bb = gmsh.model.getBoundingBox(3, tag); x0, y0, z0, x1, y1, z1 = air_box",
    "        eps = 1e-6 * max(x1 - x0, y1 - y0, z1 - z0)",
    "        if abs(bb[5] - z1) < eps and bb[2] > z0 - eps: return ('atmosphere', " + `${F.atmosphere}` + ")",
    "    # the LAST entity containing the centre owns it: a chamber cut from a crust is the chamber",
    "    hit = None",
    "    for i in range(len(entity_tests)):",
    "        if inside_entity(i, x, y, z): hit = i",
    "    if hit is None:",
    "        return ('atmosphere', " + `${F.atmosphere}` + ")",
    "    if layer_flags[hit]:",
    "        for k, (top, bottom) in enumerate(layer_tops[hit]):",
    "            if bottom - 1e-9 <= z <= top + 1e-9: return (entity_names[hit] + '_layer_' + str(k + 1), layer_flags[hit][k])",
    "    return (entity_names[hit], entity_volume_flags[hit])",
    "",
    "by_flag = {}",
    "names = {}",
    "for v in volumes:",
    "    nm, flag = classify_volume(v)",
    "    by_flag.setdefault((3, flag), []).append(v); names[(3, flag)] = nm",
    "",
    "# THE FACES: every boundary surface of every volume, matched to the face the page",
    "# named by centroid and normal (each entity's faces, then the air's sky and sides).",
    `face_table = ${PYL(active.flatMap((e, i) => (e.parts || []).map((p) => [i, p.face, Number(p.flag) > 0 ? Number(p.flag) : 5, p.centroid || [0, 0, 0], p.normal || null])))}`,
    "",
    "def face_flag(surf):",
    "    x, y, z = occ.getCenterOfMass(2, surf)",
    "    try:",
    "        u, v = gmsh.model.getParametrization(2, surf, [x, y, z])[:2]",
    "        n = gmsh.model.getNormal(surf, [u, v])",
    "    except Exception:",
    "        n = [0.0, 0.0, 0.0]",
    "    if air_box is not None:",
    "        x0, y0, z0, x1, y1, z1 = air_box; eps = 1e-6 * max(x1 - x0, y1 - y0, z1 - z0)",
    "        if abs(z - z1) < eps and abs(abs(n[2]) - 1) < 1e-3: return ('sky', air_flags['sky'])",
    "        if z > z0 + eps and (abs(x - x0) < eps or abs(x - x1) < eps or abs(y - y0) < eps or abs(y - y1) < eps) and abs(n[2]) < 1e-3:",
    "            return ('sides_above', air_flags['sides'])",
    "    best = None; best_score = None",
    "    for (i, face, flag, c, fn) in face_table:",
    "        d = math.dist((x, y, z), c)",
    "        ang = 0.0 if fn is None else (1 - abs(n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2]))",
    "        score = d + 1e6 * ang * (0 if fn is None else 1)",
    "        if fn is None: score = d * 4  # a curved part matches by distance alone, weakly",
    "        if best_score is None or score < best_score: best, best_score = (face, flag), score",
    "    return best if best else ('surface', 5)",
    "",
    "for (_, v) in [(3, t) for t in volumes]:",
    "    for (d, s) in gmsh.model.getBoundary([(3, v)], oriented=False, recursive=False):",
    "        nm, flag = face_flag(s)",
    "        if s not in by_flag.setdefault((2, flag), []): by_flag[(2, flag)].append(s)",
    "        names.setdefault((2, flag), nm)",
    "",
    "# Edges and corners inherit the LOWEST flag of the faces they bound, so every",
    "# entity carries a number a deck can read (gmsh_to_gales refuses one without).",
    "for (dim, flag), tags_ in sorted(by_flag.items()):",
    "    if dim != 2: continue",
    "    for (d1, c) in gmsh.model.getBoundary([(2, s) for s in tags_], oriented=False, recursive=False):",
    "        by_flag.setdefault((1, flag), [])",
    "        if c not in by_flag[(1, flag)] and not any(c in v for (k, v) in by_flag.items() if k[0] == 1 and k[1] < flag): by_flag[(1, flag)].append(c)",
    "    for (d0, pnt) in gmsh.model.getBoundary([(2, s) for s in tags_], oriented=False, recursive=True):",
    "        if d0 != 0: continue",
    "        by_flag.setdefault((0, flag), [])",
    "        if pnt not in by_flag[(0, flag)] and not any(pnt in v for (k, v) in by_flag.items() if k[0] == 0 and k[1] < flag): by_flag[(0, flag)].append(pnt)",
    "for (dim, flag), tags_ in sorted(by_flag.items()):",
    "    if tags_: gmsh.model.addPhysicalGroup(dim, sorted(set(tags_)), flag, name=names.get((dim, flag), ''))",
    "",
    "# EMBEDDED POINTS: a node exactly there, in the volume that holds it.",
    `embedded = ${PYL((points || []).map((p) => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0, Number(p.sizeM) > 0 ? Number(p.sizeM) : 1, String(p.name || "point"), Number(p.flag) > 0 ? Math.round(Number(p.flag)) : F.points]))}`,
    "for (px, py, pz, psize, pname, pflag) in embedded:",
    "    tag = gmsh.model.occ.addPoint(px, py, pz, psize)",
    "    occ.synchronize()",
    "    for v in volumes:",
    "        if gmsh.model.isInside(3, v, [px, py, pz]):",
    "            gmsh.model.mesh.embed(0, [tag], 3, v)",
    "            break",
    "    gmsh.model.addPhysicalGroup(0, [tag], pflag, name=pname)",
    ...sizeFieldLines({ fields: sizeFields || [], dim: 3, coarseM: meshOptions?.sizeMaxM || null, options: meshOptions || {} }),
    `gmsh.option.setNumber("Mesh.ElementOrder", ${Number(order) || 1})`,
    "gmsh.model.mesh.generate(3)",
    `gmsh.write(${PY(meshFile || `${name}.msh`)})`,
    "gmsh.finalize()",
  );
  return lines.join("\n");
}
