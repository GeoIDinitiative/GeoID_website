/**
 * GALES results, read the way the solver writes them.
 *
 * Pure: no DOM, no three.js, no fetch. The worker parses with it, the panel
 * colours with it, and the tests check it against meshes whose answers are
 * exact. Everything here was read off the GALES source rather than assumed:
 *
 * THE MESH (`input/mesh_Ncore.txt`, custom_gales_mesh_reader.hpp) is text:
 *
 *     MESH! 3D                      or 2D
 *     nodes N / elements E / sides S
 *     X min max / Y min max / Z min max     (Z in 3D only)
 *     Node    gid x y z flag            (gid x y flag in 2D)
 *     Element gid pid nb_nodes n1..nk flag  (pid is the partition)
 *     Side    gid pid nb_nodes n1..nk flag  (the boundary, flag > 0)
 *
 * Node ids are 0-based and are the GLOBAL ids the results are indexed by.
 * A gmsh `.msh` (2.2 or 4.1 ASCII) is read too, with node gid = tag − 1,
 * which is what gmsh_to_gales.py assigns: Etna's mesh_4core.txt Node 0 is
 * mesh.msh node 1, coordinate for coordinate.
 *
 * THE RESULTS (io.hpp IO::write) are `results/<field>/<time>`: raw native
 * little-endian float64, `nodes * nb_dofs` long, a node's dofs together
 * (dof gid = node gid * nb_dofs + j). `write2` fields (mesh motion, the
 * secondary dofs) are per-node vectors CONCATENATED BY COMPONENT instead:
 * all x, then all y. The field's name decides which layout it is, because
 * the bytes cannot.
 */

// ── Byte tokenizer ──────────────────────────────────────────────────────────

const SPACE = new Uint8Array(256);
for (const c of [9, 10, 11, 12, 13, 32]) SPACE[c] = 1;

/**
 * A cursor over ASCII bytes. Parsing the bytes rather than a decoded string
 * keeps an 87 MB mesh at 87 MB: as a JS string it is twice that before a
 * single number is read, and `split("\n")` on it is a million strings more.
 */
export class ByteCursor {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.i = start;
    this.n = end;
  }
  skip() {
    const b = this.b;
    let i = this.i;
    while (i < this.n && SPACE[b[i]]) i += 1;
    this.i = i;
    return i < this.n;
  }
  word() {
    if (!this.skip()) return "";
    const b = this.b;
    const s = this.i;
    let i = s;
    while (i < this.n && !SPACE[b[i]]) i += 1;
    this.i = i;
    let out = "";
    for (let k = s; k < i; k += 1) out += String.fromCharCode(b[k]);
    return out;
  }
  int() {
    if (!this.skip()) return NaN;
    const b = this.b;
    let i = this.i;
    let neg = false;
    if (b[i] === 45) { neg = true; i += 1; } else if (b[i] === 43) i += 1;
    let v = 0;
    let any = false;
    while (i < this.n) {
      const c = b[i] - 48;
      if (c < 0 || c > 9) break;
      v = v * 10 + c;
      i += 1;
      any = true;
    }
    // A float where an int was expected ("5.0"): read and drop the fraction.
    if (i < this.n && (b[i] === 46 || b[i] === 101 || b[i] === 69)) {
      const f = this.float();
      return Number.isFinite(f) ? Math.trunc(f) : NaN;
    }
    this.i = i;
    return any ? (neg ? -v : v) : NaN;
  }
  float() {
    if (!this.skip()) return NaN;
    const b = this.b;
    let i = this.i;
    let neg = false;
    if (b[i] === 45) { neg = true; i += 1; } else if (b[i] === 43) i += 1;
    let mant = 0;
    let digits = 0;
    let exp = 0;
    let any = false;
    while (i < this.n) {
      const c = b[i] - 48;
      if (c < 0 || c > 9) break;
      if (digits < 17) { mant = mant * 10 + c; digits += mant ? 1 : 0; } else exp += 1;
      i += 1;
      any = true;
    }
    if (b[i] === 46) {
      i += 1;
      while (i < this.n) {
        const c = b[i] - 48;
        if (c < 0 || c > 9) break;
        if (digits < 17) { mant = mant * 10 + c; digits += mant ? 1 : 0; exp -= 1; }
        i += 1;
        any = true;
      }
    }
    if (any && (b[i] === 101 || b[i] === 69)) {
      i += 1;
      let eneg = false;
      if (b[i] === 45) { eneg = true; i += 1; } else if (b[i] === 43) i += 1;
      let e = 0;
      while (i < this.n) {
        const c = b[i] - 48;
        if (c < 0 || c > 9) break;
        e = e * 10 + c;
        i += 1;
      }
      exp += eneg ? -e : e;
    }
    if (!any) {
      // nan / inf, spelled however a C++ stream spells them
      const w = this.word().toLowerCase();
      if (w.includes("nan")) return NaN;
      if (w.includes("inf")) return w.startsWith("-") ? -Infinity : Infinity;
      return NaN;
    }
    this.i = i;
    // Two multiplications rather than one pow for the large and the tiny, so
    // 1e-320 does not underflow on the way to 1.0e-320.
    let v = mant;
    if (exp > 0) v *= 10 ** exp;
    else if (exp < 0) v = exp < -300 ? (v / 1e300) / 10 ** (-exp - 300) : v / 10 ** -exp;
    return neg ? -v : v;
  }
  /** The next line as text, from the cursor to the newline. */
  line() {
    const b = this.b;
    let i = this.i;
    while (i < this.n && (b[i] === 32 || b[i] === 9)) i += 1;
    const s = i;
    while (i < this.n && b[i] !== 10) i += 1;
    let out = "";
    for (let k = s; k < i; k += 1) if (b[k] !== 13) out += String.fromCharCode(b[k]);
    this.i = Math.min(i + 1, this.n);
    return out;
  }
  /** Moves past the next occurrence of `text`, returning false if absent. */
  seek(text) {
    const codes = [...text].map((c) => c.charCodeAt(0));
    const b = this.b;
    const first = codes[0];
    for (let i = this.i; i <= this.n - codes.length; i += 1) {
      if (b[i] !== first) continue;
      let k = 1;
      while (k < codes.length && b[i + k] === codes[k]) k += 1;
      if (k === codes.length) { this.i = i + codes.length; return true; }
    }
    return false;
  }
}

/** A growable Int32 buffer: sizes are known only after the file is read. */
class IntBuffer {
  constructor(capacity = 1024) { this.a = new Int32Array(Math.max(16, capacity)); this.length = 0; }
  push(v) {
    if (this.length === this.a.length) {
      const next = new Int32Array(this.a.length * 2);
      next.set(this.a);
      this.a = next;
    }
    this.a[this.length++] = v;
  }
  done() { return this.a.slice(0, this.length); }
}

// Realm-safe: bytes handed over by another document (a project store, a
// frame) fail `instanceof` here and would otherwise be encoded as the TEXT
// "[object Uint8Array]". ArrayBuffer.isView and the object tag are not realm-bound.
const asBytes = (input) => (ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  : Object.prototype.toString.call(input) === "[object ArrayBuffer]" ? new Uint8Array(input)
    : new TextEncoder().encode(String(input)));

// ── Mesh formats ────────────────────────────────────────────────────────────

/** What a file is, from its first bytes. */
export function sniffMesh(input) {
  const bytes = asBytes(input);
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(64, bytes.length)));
  if (/^\s*MESH!/.test(head)) return "gales";
  if (/^\s*\$MeshFormat/.test(head)) return "msh";
  return null;
}

/**
 * The GALES text mesh. `onProgress(fraction)` is called every quarter of a
 * million records so a worker can report, and nothing else is.
 */
export function parseGalesMesh(input, { onProgress } = {}) {
  const bytes = asBytes(input);
  const cur = new ByteCursor(bytes);
  if (cur.word() !== "MESH!") throw new Error("Not a GALES mesh: it does not begin with MESH!");
  const dimWord = cur.word();
  const dim = /2/.test(dimWord) ? 2 : 3;
  const header = {};
  // nodes / elements / sides, then the bounding rows; read until the first record.
  for (let guard = 0; guard < 12; guard += 1) {
    const save = cur.i;
    const key = cur.word();
    if (key === "Node" || key === "Element" || key === "Side" || !key) { cur.i = save; break; }
    if (key === "nodes" || key === "elements" || key === "sides") header[key] = cur.int();
    else if (key === "X" || key === "Y" || key === "Z") header[key] = [cur.float(), cur.float()];
    else cur.line();
  }
  const nodeCount = header.nodes || 0;
  const coords = new Float64Array(nodeCount * 3);
  const nodeFlag = new Int32Array(nodeCount);
  const conn = new IntBuffer((header.elements || 1024) * (dim === 3 ? 4 : 3));
  const offsets = new IntBuffer((header.elements || 1024) + 1);
  const cellFlag = new IntBuffer(header.elements || 1024);
  const sideConn = new IntBuffer((header.sides || 256) * (dim === 3 ? 3 : 2));
  const sideOffsets = new IntBuffer((header.sides || 256) + 1);
  const sideFlag = new IntBuffer(header.sides || 256);
  offsets.push(0);
  sideOffsets.push(0);
  const total = nodeCount + (header.elements || 0) + (header.sides || 0);
  let seen = 0;
  let maxNode = -1;
  for (;;) {
    const key = cur.word();
    if (!key) break;
    if (key === "Node") {
      const gid = cur.int();
      const x = cur.float();
      const y = cur.float();
      // A 2D node has no z column: GALES reads the flag at result[dim + 2].
      const z = dim === 3 ? cur.float() : 0;
      const flag = cur.int();
      if (gid >= 0 && gid < nodeCount) {
        coords[gid * 3] = x;
        coords[gid * 3 + 1] = y;
        coords[gid * 3 + 2] = dim === 3 ? z : 0;
        nodeFlag[gid] = flag;
        if (gid > maxNode) maxNode = gid;
      }
    } else if (key === "Element" || key === "Side") {
      cur.int(); // gid
      cur.int(); // pid
      const k = cur.int();
      const target = key === "Element" ? conn : sideConn;
      for (let j = 0; j < k; j += 1) target.push(cur.int());
      const flag = cur.int();
      if (key === "Element") { offsets.push(conn.length); cellFlag.push(flag); } else { sideOffsets.push(sideConn.length); sideFlag.push(flag); }
    } else {
      // An unknown row is skipped whole rather than read as numbers.
      cur.line();
      continue;
    }
    seen += 1;
    if (onProgress && seen % 250000 === 0 && total) onProgress(seen / total);
  }
  return finishMesh({
    format: "gales", dim, nodeCount, coords, nodeFlag,
    cells: conn.done(), cellOffsets: offsets.done(), cellFlag: cellFlag.done(),
    sides: sideConn.done(), sideOffsets: sideOffsets.done(), sideFlag: sideFlag.done(),
    declared: header, lastNode: maxNode,
  });
}

/** gmsh element type → node count and topological dimension. */
export const MSH_TYPES = {
  1: [2, 1], 2: [3, 2], 3: [4, 2], 4: [4, 3], 5: [8, 3], 6: [6, 3], 7: [5, 3],
  8: [3, 1], 9: [6, 2], 10: [9, 2], 11: [10, 3], 15: [1, 0], 16: [8, 2], 17: [20, 3],
};
/** Of a higher-order element, only the corner nodes are drawn. */
const MSH_CORNERS = { 8: 2, 9: 3, 10: 4, 11: 4, 16: 4, 17: 8 };

/**
 * A gmsh ASCII mesh, 2.2 or 4.1. The highest-dimension elements are the
 * cells; the dimension below them are the boundary sides, flagged by their
 * physical tag (2.2's first tag, 4.1's entity's physical group).
 */
export function parseMsh(input, { onProgress } = {}) {
  const bytes = asBytes(input);
  const cur = new ByteCursor(bytes);
  if (!cur.seek("$MeshFormat")) throw new Error("Not a gmsh mesh: no $MeshFormat");
  const version = cur.float();
  const binary = cur.int();
  if (binary === 1) throw new Error("This .msh is binary; save it from gmsh as ASCII (Mesh.Binary = 0).");
  const v4 = version >= 4;
  const physicalOf = new Map(); // `${dim}:${entityTag}` → physical tag
  if (v4) {
    const save = cur.i;
    if (cur.seek("$Entities")) {
      const counts = [cur.int(), cur.int(), cur.int(), cur.int()];
      for (let d = 0; d < 4; d += 1) {
        for (let e = 0; e < counts[d]; e += 1) {
          const tag = cur.int();
          if (d === 0) { cur.float(); cur.float(); cur.float(); } else { for (let k = 0; k < 6; k += 1) cur.float(); }
          const np = cur.int();
          let first = 0;
          for (let k = 0; k < np; k += 1) { const p = cur.int(); if (k === 0) first = p; }
          physicalOf.set(`${d}:${tag}`, first);
          if (d > 0) { const nb = cur.int(); for (let k = 0; k < nb; k += 1) cur.int(); }
        }
      }
    } else cur.i = save;
  }
  if (!cur.seek("$Nodes")) throw new Error("The .msh has no $Nodes section.");
  // NODE GID = TAG - 1, gmsh_to_gales.py's own rule (`nodeTag = int(line) - 1`),
  // so the results index the nodes the way this array does. A mesh whose tags
  // have gaps keeps the gaps as unused rows rather than renumbering.
  let nodeCount;
  let coords;
  const grow = (need) => {
    if (need <= coords.length / 3) return;
    const next = new Float64Array(Math.max(need, (coords.length / 3) * 2) * 3);
    next.set(coords);
    coords = next;
  };
  if (v4) {
    const blocks = cur.int();
    cur.int();
    cur.int();
    const maxTag = cur.int();
    coords = new Float64Array(maxTag * 3);
    nodeCount = 0;
    for (let b = 0; b < blocks; b += 1) {
      cur.int(); cur.int();
      const parametric = cur.int();
      const n = cur.int();
      const tags = new Int32Array(n);
      for (let k = 0; k < n; k += 1) tags[k] = cur.int();
      for (let k = 0; k < n; k += 1) {
        const at = tags[k] - 1;
        grow(at + 1);
        coords[at * 3] = cur.float(); coords[at * 3 + 1] = cur.float(); coords[at * 3 + 2] = cur.float();
        if (parametric) cur.line();
        if (at + 1 > nodeCount) nodeCount = at + 1;
      }
    }
  } else {
    const declared = cur.int();
    coords = new Float64Array(declared * 3);
    nodeCount = 0;
    for (let k = 0; k < declared; k += 1) {
      const at = cur.int() - 1;
      grow(at + 1);
      coords[at * 3] = cur.float(); coords[at * 3 + 1] = cur.float(); coords[at * 3 + 2] = cur.float();
      if (at + 1 > nodeCount) nodeCount = at + 1;
    }
  }
  if (coords.length !== nodeCount * 3) coords = coords.slice(0, nodeCount * 3);
  const lookup = (tag) => tag - 1;
  if (!cur.seek("$Elements")) throw new Error("The .msh has no $Elements section.");
  // Read every element into per-dimension buffers, then keep the top two.
  const byDim = [0, 1, 2, 3].map(() => ({ conn: new IntBuffer(), offsets: new IntBuffer(), flag: new IntBuffer() }));
  byDim.forEach((d) => d.offsets.push(0));
  const pushElement = (type, nodesTags, phys) => {
    const meta = MSH_TYPES[type];
    if (!meta) return;
    const d = byDim[meta[1]];
    const corners = MSH_CORNERS[type] || meta[0];
    for (let k = 0; k < corners; k += 1) d.conn.push(lookup(nodesTags[k]));
    d.offsets.push(d.conn.length);
    d.flag.push(phys);
  };
  if (v4) {
    const blocks = cur.int();
    const total = cur.int();
    cur.int(); cur.int();
    let done = 0;
    for (let b = 0; b < blocks; b += 1) {
      const entityDim = cur.int();
      const entityTag = cur.int();
      const type = cur.int();
      const n = cur.int();
      const phys = physicalOf.get(`${entityDim}:${entityTag}`) || entityTag;
      const count = MSH_TYPES[type]?.[0] ?? 0;
      const tags = new Int32Array(count);
      for (let e = 0; e < n; e += 1) {
        cur.int();
        for (let k = 0; k < count; k += 1) tags[k] = cur.int();
        pushElement(type, tags, phys);
        done += 1;
        if (onProgress && done % 250000 === 0) onProgress(done / total);
      }
    }
  } else {
    const total = cur.int();
    for (let e = 0; e < total; e += 1) {
      cur.int();
      const type = cur.int();
      const ntags = cur.int();
      let phys = 0;
      for (let k = 0; k < ntags; k += 1) { const t = cur.int(); if (k === 0) phys = t; }
      const count = MSH_TYPES[type]?.[0];
      if (!count) { cur.line(); continue; }
      const tags = new Int32Array(count);
      for (let k = 0; k < count; k += 1) tags[k] = cur.int();
      pushElement(type, tags, phys);
      if (onProgress && e % 250000 === 0 && e) onProgress(e / total);
    }
  }
  const dim = byDim[3].flag.length ? 3 : 2;
  const top = byDim[dim];
  const side = byDim[dim - 1];
  // NODE FLAGS AS gmsh_to_gales.py ASSIGNS THEM: the boundary faces' tags,
  // then the lines', then the POINTS' last, so an embedded point's node carries
  // its own physical flag -- which is what makes a flagged point findable.
  const nodeFlag = new Int32Array(nodeCount);
  for (let d = dim - 1; d >= 0; d -= 1) {
    const g = byDim[d];
    const conn = g.conn.a;
    const offsets = g.offsets.a;
    for (let e = 0; e < g.flag.length; e += 1) {
      const flag = g.flag.a[e];
      if (!flag) continue;
      for (let k = offsets[e]; k < offsets[e + 1]; k += 1) {
        const node = conn[k];
        if (node >= 0 && node < nodeCount) nodeFlag[node] = flag;
      }
    }
  }
  return finishMesh({
    format: `msh ${version}`, dim, nodeCount, coords, nodeFlag,
    cells: top.conn.done(), cellOffsets: top.offsets.done(), cellFlag: top.flag.done(),
    sides: side.conn.done(), sideOffsets: side.offsets.done(), sideFlag: side.flag.done(),
    declared: {}, lastNode: nodeCount - 1,
  });
}

/** A mesh assembled elsewhere (a VTK grid reduced to simplices), finished as a parsed one is. */
export function meshFromRaw(raw) {
  return finishMesh({ ...raw });
}

/** Either format, by its first bytes. */
export function parseMesh(input, options) {
  const kind = sniffMesh(input);
  if (kind === "gales") return parseGalesMesh(input, options);
  if (kind === "msh") return parseMsh(input, options);
  throw new Error("Not a mesh this reader knows: expected a GALES mesh (MESH! …) or a gmsh .msh.");
}

/** The bounding box, the element sizes and the drawable boundary. */
function finishMesh(mesh) {
  const { coords, nodeCount } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nodeCount; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const v = coords[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  mesh.bounds = { min, max };
  mesh.cellCount = mesh.cellOffsets.length - 1;
  mesh.sideCount = mesh.sideOffsets.length - 1;
  const surface = boundarySurface(mesh);
  mesh.surface = surface.triangles;
  mesh.surfaceFlag = surface.flags;
  mesh.surfaceFrom = surface.from;
  mesh.edges = mesh.dim === 2 ? outlineEdges(mesh) : null;
  return mesh;
}

// ── Boundary ────────────────────────────────────────────────────────────────

/** Triangles of a polygon face, as a fan (sides and 2D cells are convex). */
function fan(conn, s, e, out, flags, flag) {
  for (let k = s + 1; k < e - 1; k += 1) {
    out.push(conn[s]); out.push(conn[k]); out.push(conn[k + 1]);
    flags.push(flag);
  }
}

/**
 * What to draw of a mesh.
 *
 * In 2D it is every cell: the mesh IS the surface. In 3D it is the boundary,
 * and the file's own SIDE records are that boundary with its flags, so they
 * are used whenever they are there. Only a mesh with no sides has its
 * boundary DERIVED — every tet face seen once — which is exact and costs a
 * hash table of the faces.
 */
export function boundarySurface(mesh) {
  const tris = new IntBuffer();
  const flags = new IntBuffer();
  if (mesh.dim === 2) {
    for (let c = 0; c < mesh.cellCount; c += 1) {
      const s = mesh.cellOffsets[c];
      const e = mesh.cellOffsets[c + 1];
      if (e - s >= 3) fan(mesh.cells, s, e, tris, flags, mesh.cellFlag[c] || 0);
    }
    return { triangles: tris.done(), flags: flags.done(), from: "cells" };
  }
  let usable = 0;
  for (let f = 0; f < mesh.sideCount; f += 1) if (mesh.sideOffsets[f + 1] - mesh.sideOffsets[f] >= 3) usable += 1;
  if (usable) {
    for (let f = 0; f < mesh.sideCount; f += 1) {
      const s = mesh.sideOffsets[f];
      const e = mesh.sideOffsets[f + 1];
      if (e - s >= 3) fan(mesh.sides, s, e, tris, flags, mesh.sideFlag[f] || 0);
    }
    return { triangles: tris.done(), flags: flags.done(), from: "sides" };
  }
  const faces = exposedTetFaces(mesh);
  return { triangles: faces, flags: new Int32Array(faces.length / 3), from: "derived" };
}

/** Local faces of a tetrahedron, each listed outward for a positive tet. */
const TET_FACES = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];

/**
 * Tet faces seen exactly once. An open-addressed table keyed on the sorted
 * node triple, so there is no string per face: a million-tet mesh is four
 * million faces, and a Map of strings that size is the machine's memory.
 */
export function exposedTetFaces(mesh) {
  return exposedFaces(mesh, null).triangles;
}

/**
 * The boundary of a SUBSET of the tetrahedra: the faces seen once among the
 * cells `keep` admits (a Uint8Array per cell, or null for all), with the cell
 * each face belongs to -- so a threshold draws a closed skin, and the skin can
 * be coloured by the cells' own data (their volume flag).
 */
export function exposedFaces(mesh, keep) {
  const { cells, cellOffsets, cellCount } = mesh;
  let tets = 0;
  for (let c = 0; c < cellCount; c += 1) if (cellOffsets[c + 1] - cellOffsets[c] === 4 && (!keep || keep[c])) tets += 1;
  const nFaces = tets * 4;
  let cap = 1;
  while (cap < nFaces * 2) cap <<= 1;
  const slotA = new Int32Array(cap).fill(-1);
  const slotB = new Int32Array(cap);
  const slotC = new Int32Array(cap);
  const slotCount = new Uint8Array(cap);
  const slotFace = new Int32Array(cap * 3);
  const slotCell = new Int32Array(cap);
  const mask = cap - 1;
  for (let c = 0; c < cellCount; c += 1) {
    const s = cellOffsets[c];
    if (cellOffsets[c + 1] - s !== 4 || (keep && !keep[c])) continue;
    for (const f of TET_FACES) {
      const p = cells[s + f[0]]; const q = cells[s + f[1]]; const r = cells[s + f[2]];
      let a = p; let b = q; let d = r;
      if (a > b) { const t = a; a = b; b = t; }
      if (b > d) { const t = b; b = d; d = t; }
      if (a > b) { const t = a; a = b; b = t; }
      let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(d, 83492791)) & mask;
      for (;;) {
        if (slotA[h] === -1) {
          slotA[h] = a; slotB[h] = b; slotC[h] = d; slotCount[h] = 1;
          slotFace[h * 3] = p; slotFace[h * 3 + 1] = q; slotFace[h * 3 + 2] = r; slotCell[h] = c;
          break;
        }
        if (slotA[h] === a && slotB[h] === b && slotC[h] === d) { slotCount[h] = 2; break; }
        h = (h + 1) & mask;
      }
    }
  }
  const out = new IntBuffer();
  const owner = new IntBuffer();
  for (let h = 0; h < cap; h += 1) {
    if (slotA[h] !== -1 && slotCount[h] === 1) { out.push(slotFace[h * 3]); out.push(slotFace[h * 3 + 1]); out.push(slotFace[h * 3 + 2]); owner.push(slotCell[h]); }
  }
  return { triangles: out.done(), cells: owner.done() };
}

/**
 * Which cells a threshold keeps: those of the listed volume flags (all when
 * none is listed) whose value lies in [lo, hi] -- at every node ("all"), at any
 * node ("any"), or on average ("mean"). Without a scalar the flags alone decide.
 */
export function thresholdKeep(mesh, scalar, { lo = -Infinity, hi = Infinity, flags = null, mode = "all" } = {}) {
  const { cells, cellOffsets, cellCount } = mesh;
  const keep = new Uint8Array(cellCount);
  const flagSet = flags && flags.length ? new Set(flags.map(Number)) : null;
  let kept = 0;
  for (let c = 0; c < cellCount; c += 1) {
    if (flagSet && !flagSet.has(mesh.cellFlag ? mesh.cellFlag[c] : 0)) continue;
    const s = cellOffsets[c]; const e = cellOffsets[c + 1];
    let ok = true;
    if (scalar) {
      let inside = 0; let sum = 0; let count = 0;
      for (let k = s; k < e; k += 1) {
        const v = scalar[cells[k]];
        if (v !== v) continue;
        count += 1; sum += v;
        if (v >= lo && v <= hi) inside += 1;
      }
      ok = count > 0 && (mode === "any" ? inside > 0 : mode === "mean" ? sum / count >= lo && sum / count <= hi : inside === e - s);
    }
    if (ok) { keep[c] = 1; kept += 1; }
  }
  return { keep, kept };
}

/** A 2D mesh's kept cells as triangles (a quad as two), with each triangle's cell. */
export function keptTriangles(mesh, keep) {
  const { cells, cellOffsets, cellCount } = mesh;
  const out = new IntBuffer();
  const owner = new IntBuffer();
  for (let c = 0; c < cellCount; c += 1) {
    if (keep && !keep[c]) continue;
    const s = cellOffsets[c]; const n = cellOffsets[c + 1] - s;
    if (n < 3) continue;
    for (let k = 1; k + 1 < n; k += 1) { out.push(cells[s]); out.push(cells[s + k]); out.push(cells[s + k + 1]); owner.push(c); }
  }
  return { triangles: out.done(), cells: owner.done() };
}

/** Of a 2D mesh, the edges drawn as its outline: the sides, else none. */
function outlineEdges(mesh) {
  const out = new IntBuffer();
  for (let f = 0; f < mesh.sideCount; f += 1) {
    const s = mesh.sideOffsets[f];
    const e = mesh.sideOffsets[f + 1];
    for (let k = s; k < e - 1; k += 1) { out.push(mesh.sides[k]); out.push(mesh.sides[k + 1]); }
  }
  return out.done();
}

// ── Results ─────────────────────────────────────────────────────────────────

/** A time step's file name as a number, or null for anything else. */
export function timeOf(name) {
  const base = String(name).split("/").pop();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(base)) return null;
  const t = Number(base);
  return Number.isFinite(t) ? t : null;
}

/**
 * Result files grouped into fields. `paths` are any relative paths; a field
 * is the directory under the nearest `results/` holding numbered files.
 * Returns [{ field, steps: [{ time, path, size }] }], fields in name order,
 * steps in time order.
 *
 * A PICK THAT IS NOT A WHOLE RUN still has fields. Where no path passes
 * through a results/ directory (the reader chose results/solid, or just the u
 * folder), a directory of numbered files is a field named by its own path, so
 * "u/1" is the field "u". Build and input trees are never fields. A numbered
 * file with no directory at all (steps picked one by one) belongs to
 * `looseField` when one is given, and is left out when not: a bare "1" says
 * nothing about which field it is.
 */
export function groupResultFiles(entries, { looseField = "" } = {}) {
  const fields = new Map();
  const pathOf = (entry) => String(typeof entry === "string" ? entry : entry.path);
  const underResults = entries.some((entry) => pathOf(entry).split("/").slice(0, -1).includes("results"));
  for (const entry of entries) {
    const path = pathOf(entry);
    const size = typeof entry === "string" ? null : entry.size ?? null;
    const parts = path.split("/");
    const name = parts.pop();
    const time = timeOf(name);
    if (time === null) continue;
    let field = "";
    if (underResults) {
      const r = parts.lastIndexOf("results");
      if (r < 0 || r === parts.length - 1) continue;
      field = parts.slice(r + 1).join("/");
    } else if (parts.length) {
      if (parts.some((part) => /^(build|input|CMakeFiles|src)$/.test(part))) continue;
      field = parts.join("/");
    } else if (looseField) {
      field = String(looseField).replace(/^\/+|\/+$/g, "");
    }
    if (!field) continue;
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push({ time, name, path, size });
  }
  return [...fields.entries()]
    .map(([field, steps]) => ({ field, steps: steps.sort((a, b) => a.time - b.time) }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * A comparison with a reference run on the same mesh: for every field this
 * run has and the reference has too, a field whose step is this run's minus
 * the reference's step at the same time (the latest at or before it). Fields
 * are matched by name, else by leaf where the leaf is unique on both sides --
 * a reference opened as its bare "u" folder is still solid/u.
 *
 * Answers [{ field: "compare/<name>", compare: true, from, refField,
 * steps: [{ name, time, path: "compare:<a>|<b>", base, ref, refName }] }].
 */
export function referencePlan(baseFields, refFields) {
  const leaf = (name) => String(name).split("/").pop();
  const unique = (list) => {
    const counts = new Map();
    list.forEach((f) => counts.set(leaf(f.field), (counts.get(leaf(f.field)) || 0) + 1));
    return (name) => counts.get(leaf(name)) === 1;
  };
  const baseUnique = unique(baseFields);
  const refUnique = unique(refFields);
  const out = [];
  for (const base of baseFields) {
    if (base.derived || base.compare) continue;
    const ref = refFields.find((r) => r.field === base.field)
      || (baseUnique(base.field) ? refFields.find((r) => leaf(r.field) === leaf(base.field) && refUnique(r.field)) : null);
    if (!ref?.steps?.length) continue;
    const steps = [];
    for (const st of base.steps) {
      let pick = null;
      for (const r of ref.steps) if (r.time <= st.time + 1e-12) pick = r;
      if (!pick) continue;
      steps.push({ name: st.name, time: st.time, path: `compare:${st.path}|${pick.path}`, base: st.path, ref: pick.path, refName: pick.name, size: st.size });
    }
    if (steps.length) out.push({ field: `compare/${base.field}`, compare: true, from: base.field, refField: ref.field, steps });
  }
  return out;
}

/** This run minus the reference, value for value; refused when the two are not the same length. */
export function differenceOf(a, b) {
  if (a.length !== b.length) throw new Error(`The reference step holds ${b.length.toLocaleString()} values and this run's ${a.length.toLocaleString()}: not the same mesh.`);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] - b[i];
  return out;
}

/**
 * One number from a step, for a sweep's response curve: the value at a node
 * (a component, or the vector's length), or the largest absolute value over
 * every node when no node is named -- "the peak uplift", "the displacement at
 * the summit".
 */
export function stepReading(values, nodeCount, desc, { component = "mag", node = null } = {}) {
  const nb = values.length / nodeCount;
  const at = (i, j) => (desc?.blocked ? values[j * nodeCount + i] : values[i * nb + j]);
  const from = desc?.vector?.from || desc?.displacement || null;
  const read = component === "mag" && from
    ? (i) => Math.hypot(...from.map((j) => at(i, j)))
    : (i) => at(i, Number(component) || 0);
  if (Number.isInteger(node) && node >= 0 && node < nodeCount) return read(node);
  let best = NaN;
  for (let i = 0; i < nodeCount; i += 1) {
    const v = read(i);
    if (v === v && !(Math.abs(v) <= Math.abs(best))) best = v;
  }
  return best;
}

/**
 * The slope of log|response| against log(parameter): the sensitivity a sweep
 * measures. For a linear elastic model displacement goes as pressure (slope 1)
 * and as 1/E (slope −1), so the number is also a check on the runs. Points with
 * a non-positive parameter or a zero response are left out.
 */
export function powerLawSlope(xs, ys) {
  const pts = xs.map((x, k) => [x, ys[k]]).filter(([x, y]) => x > 0 && Number.isFinite(y) && y !== 0).map(([x, y]) => [Math.log(x), Math.log(Math.abs(y))]);
  const n = pts.length;
  if (n < 2) return { slope: NaN, r2: NaN, n };
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!(sxx > 0)) return { slope: NaN, r2: NaN, n };
  const slope = sxy / sxx;
  return { slope, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1, n };
}

/** The components of the derived stress field, in strain-stress.js's order. */
const DERIVED_LABELS = [
  ["exx", "Strain εxx", ""], ["eyy", "Strain εyy", ""], ["ezz", "Strain εzz", ""],
  ["exy", "Strain εxy", ""], ["eyz", "Strain εyz", ""], ["exz", "Strain εxz", ""],
  ["sxx", "Stress σxx", "Pa"], ["syy", "Stress σyy", "Pa"], ["szz", "Stress σzz", "Pa"],
  ["sxy", "Stress σxy", "Pa"], ["syz", "Stress σyz", "Pa"], ["sxz", "Stress σxz", "Pa"],
  ["vm", "Von Mises stress", "Pa"], ["s1", "Max principal stress σ₁", "Pa"], ["s3", "Min principal stress σ₃", "Pa"],
  ["ev", "Volumetric strain", ""],
  ["tx", "Tilt east ∂u_z/∂x", "rad"], ["ty", "Tilt north ∂u_z/∂y", "rad"], ["tilt", "Tilt magnitude", "rad"],
].map(([key, label, unit]) => ({ key, label, unit }));

/** How many components the derived stress-strain-tilt field carries (strain-stress.js's DERIVED_COMPONENTS). */
export const DERIVED_DOFS = DERIVED_LABELS.length;

const VEC = (dim, prefix, unit, label) => ({
  components: ["x", "y", "z"].slice(0, dim).map((c) => ({ key: `${prefix}${c}`, label: `${label} ${c}`, unit })),
});

/**
 * What a field's numbers are, from its name and how many there are per node.
 *
 * The name is the solver's own directory (io.hpp make_dirs); the count is
 * inferred from the file size, so a field this table does not know still
 * opens, with its components numbered. `vector` names the components that
 * make a vector (a magnitude is offered for it) and `displacement` the ones
 * a deformed shape can be drawn from.
 */
export function describeField(field, nbDofs, dim = 3) {
  const f = String(field).replace(/^\/+|\/+$/g, "");
  const leaf = f.split("/").pop();
  const generic = () => Array.from({ length: nbDofs }, (_, j) => ({ key: `c${j}`, label: `component ${j}`, unit: "" }));
  const vectorOf = (label, unit, prefix, extra = {}) => {
    const d = Math.min(dim, nbDofs);
    const comps = VEC(d, prefix, unit, label).components;
    return { label, blocked: false, components: nbDofs === d ? comps : generic(), vector: nbDofs >= d ? { label: `${label} magnitude`, unit, from: [...Array(d).keys()] } : null, ...extra };
  };
  let out;
  // By the LEAF, so a field opened on its own ("u") or under another folder
  // ("mine/solid/u") is still the displacement GALES writes as solid/u.
  if (/(^|\/)u$|elastostatic_dofs$/.test(f)) out = vectorOf("Displacement", "m", "u", { displacement: [...Array(Math.min(dim, nbDofs)).keys()] });
  else if (/(^|\/)v$/.test(f)) out = vectorOf("Velocity", "m/s", "v");
  else if (/(^|\/)a$/.test(f)) out = vectorOf("Acceleration", "m/s²", "a");
  else if (/^derived\/stress$/.test(f)) {
    out = { label: "Stress, strain and tilt", blocked: false, derived: true, defaultComponent: "12", components: DERIVED_LABELS.slice(0, nbDofs) };
  } else if (/fluid_mesh$/.test(f)) out = { ...vectorOf("Mesh displacement", "m", "d", { displacement: [...Array(Math.min(dim, nbDofs)).keys()] }), blocked: true };
  else if (/^fluid_(dot_)?dofs$/.test(f)) {
    const dot = /dot/.test(f) ? " rate" : "";
    const comps = [{ key: "p", label: `Pressure${dot}`, unit: dot ? "Pa/s" : "Pa" }];
    ["x", "y", "z"].slice(0, dim).forEach((c) => comps.push({ key: `v${c}`, label: `Velocity${dot} ${c}`, unit: dot ? "m/s²" : "m/s" }));
    if (nbDofs >= dim + 2) comps.push({ key: "T", label: `Temperature${dot}`, unit: dot ? "K/s" : "K" });
    for (let y = 1; comps.length < nbDofs; y += 1) comps.push({ key: `Y${y}`, label: `Mass fraction ${y}${dot}`, unit: "" });
    const ok = nbDofs >= dim + 1;
    out = {
      label: dot ? "Fluid dof rates" : "Fluid dofs", blocked: false,
      components: ok ? comps.slice(0, nbDofs) : generic(),
      vector: ok ? { label: `Velocity${dot} magnitude`, unit: dot ? "m/s²" : "m/s", from: [...Array(dim).keys()].map((k) => k + 1) } : null,
    };
  } else if (/heat_eq\/T_dot$/.test(f)) out = { label: "Temperature rate", components: [{ key: "Tdot", label: "Temperature rate", unit: "K/s" }] };
  else if (/heat_eq\/T$/.test(f)) out = { label: "Temperature", components: [{ key: "T", label: "Temperature", unit: "K" }] };
  else if (/\/Y_dot$|^Y_dot$/.test(f)) out = { label: "Mass fraction rates", components: generic().map((c, j) => ({ ...c, key: `Ydot${j + 1}`, label: `Mass fraction rate ${j + 1}` })) };
  else if (/(^|\/)Y$/.test(f)) out = { label: "Mass fractions", components: generic().map((c, j) => ({ ...c, key: `Y${j + 1}`, label: `Mass fraction ${j + 1}` })) };
  else if (/sigma/.test(leaf)) out = { label: `Stress ${leaf}`, components: [{ key: leaf, label: `Stress ${leaf.replace(/^sigma/, "σ")}`, unit: "Pa" }] };
  else if (/sec_dofs|^solid\/(rho|E|nu)$/.test(f)) {
    const known = { rho: ["Density", "kg/m³"], E: ["Young's modulus", "Pa"], nu: ["Poisson's ratio", ""], cp: ["Specific heat", "J/(kg·K)"], kappa: ["Thermal conductivity", "W/(m·K)"], mu: ["Viscosity", "Pa·s"] };
    const [label, unit] = known[leaf] || [leaf, ""];
    out = { label, blocked: /sec_dofs/.test(f), components: nbDofs === 1 ? [{ key: leaf, label, unit }] : generic() };
  } else out = { label: f, components: nbDofs === 1 ? [{ key: leaf.replace(/[^A-Za-z0-9_]/g, "_") || "value", label: leaf, unit: "" }] : generic() };
  out.field = f;
  out.nbDofs = nbDofs;
  if (out.components.length !== nbDofs) out.components = generic();
  if (out.vector && out.vector.from.some((j) => j >= nbDofs)) out.vector = null;
  if (out.displacement && out.displacement.some((j) => j >= nbDofs)) out.displacement = null;
  out.blocked = Boolean(out.blocked);
  return out;
}

/**
 * dofs per node from a file's size, or a sentence saying why it does not fit.
 * A field written for another mesh (the fluid mesh of an FSI run, say) does
 * not divide, and that is reported rather than read as garbage.
 */
export function dofsPerNode(byteLength, nodeCount) {
  if (!nodeCount) return { ok: false, reason: "No mesh is loaded." };
  if (byteLength % 8) return { ok: false, reason: `${byteLength} bytes is not a whole number of float64 values.` };
  const values = byteLength / 8;
  if (values % nodeCount) return { ok: false, reason: `${values} values do not divide into ${nodeCount} nodes: this field belongs to another mesh.` };
  return { ok: true, nbDofs: values / nodeCount };
}

/** The file's values, little-endian whatever the machine. */
export function float64View(buffer) {
  const bytes = asBytes(buffer);
  if (bytes.byteLength % 8) throw new Error("Not a whole number of float64 values.");
  const little = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (little && bytes.byteOffset % 8 === 0) return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
  const out = new Float64Array(bytes.byteLength / 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i += 1) out[i] = view.getFloat64(i * 8, true);
  return out;
}

/** One component per node, from either layout. */
export function componentOf(values, nodeCount, nbDofs, j, blocked = false) {
  const out = new Float32Array(nodeCount);
  if (blocked) for (let i = 0; i < nodeCount; i += 1) out[i] = values[j * nodeCount + i];
  else for (let i = 0; i < nodeCount; i += 1) out[i] = values[i * nbDofs + j];
  return out;
}

/** The Euclidean length of some components per node. */
export function magnitudeOf(values, nodeCount, nbDofs, from, blocked = false) {
  const out = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    let s = 0;
    for (const j of from) {
      const v = blocked ? values[j * nodeCount + i] : values[i * nbDofs + j];
      s += v * v;
    }
    out[i] = Math.sqrt(s);
  }
  return out;
}

/** Byte range of one node's dofs in a file, for reading a probe over time. */
export function nodeByteRange(node, nodeCount, nbDofs, blocked = false) {
  if (blocked) return null; // a blocked node's dofs are spread through the file
  return [node * nbDofs * 8, (node + 1) * nbDofs * 8];
}

/**
 * Minimum and maximum over the nodes that are drawn, ignoring NaN. `nodes`
 * (an index list) restricts it: the colour range of a surface view should be
 * the range on the surface, not deep inside the volume.
 */
export function rangeOf(values, nodes = null) {
  let lo = Infinity;
  let hi = -Infinity;
  const n = nodes ? nodes.length : values.length;
  for (let k = 0; k < n; k += 1) {
    const v = values[nodes ? nodes[k] : k];
    if (v !== v) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 0];
}

/** Nodes a triangle list touches, each once. */
export function usedNodes(triangles, nodeCount) {
  const mark = new Uint8Array(nodeCount);
  for (let k = 0; k < triangles.length; k += 1) mark[triangles[k]] = 1;
  let n = 0;
  for (let i = 0; i < nodeCount; i += 1) n += mark[i];
  const out = new Int32Array(n);
  for (let i = 0, k = 0; i < nodeCount; i += 1) if (mark[i]) out[k++] = i;
  return out;
}

// ── Colour maps ─────────────────────────────────────────────────────────────

/** Stops interpolated in RGB; the ParaView names a reader of results expects. */
export const COLORMAPS = {
  "Cool to Warm": [[59, 76, 192], [124, 159, 249], [192, 212, 245], [242, 203, 183], [238, 133, 105], [180, 4, 38]],
  "Viridis": [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  "Turbo": [[48, 18, 59], [70, 107, 227], [41, 187, 236], [49, 242, 153], [163, 253, 61], [237, 208, 58], [251, 128, 34], [208, 47, 5], [122, 4, 3]],
  "Jet": [[0, 0, 143], [0, 0, 255], [0, 255, 255], [255, 255, 0], [255, 0, 0], [128, 0, 0]],
  "Inferno": [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]],
  "Greys": [[20, 20, 20], [128, 128, 128], [240, 240, 240]],
  "Blue to Red (diverging)": [[5, 48, 97], [67, 147, 195], [247, 247, 247], [214, 96, 77], [103, 0, 31]],
};

/** A 256-entry RGB table, 0..1 floats. */
export function colormapTable(name, { reverse = false, steps = 256, stops: given = null } = {}) {
  const stops = given || COLORMAPS[name] || COLORMAPS["Cool to Warm"];
  const out = new Float32Array(steps * 3);
  for (let s = 0; s < steps; s += 1) {
    let u = steps > 1 ? s / (steps - 1) : 0;
    if (reverse) u = 1 - u;
    const at = u * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(at));
    const f = at - i;
    for (let c = 0; c < 3; c += 1) out[s * 3 + c] = (stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) / 255;
  }
  return out;
}

/**
 * RGB per value into `out`, with `bands` discrete steps when asked (0 is a
 * smooth ramp) and NaN in grey. A value outside [lo, hi] takes the end colour.
 */
export function colourValues(values, lo, hi, table, out, { bands = 0, nanColour = [0.5, 0.5, 0.5], log = false } = {}) {
  const steps = table.length / 3;
  let a = lo;
  let b = hi;
  if (log) { a = Math.log10(Math.max(lo, 1e-300)); b = Math.log10(Math.max(hi, 1e-300)); }
  const span = b - a || 1;
  for (let i = 0; i < values.length; i += 1) {
    let v = values[i];
    if (v !== v) { out[i * 3] = nanColour[0]; out[i * 3 + 1] = nanColour[1]; out[i * 3 + 2] = nanColour[2]; continue; }
    if (log) v = Math.log10(Math.max(v, 1e-300));
    let u = (v - a) / span;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    if (bands > 1) u = Math.min(bands - 1, Math.floor(u * bands)) / (bands - 1);
    const s = Math.round(u * (steps - 1)) * 3;
    out[i * 3] = table[s]; out[i * 3 + 1] = table[s + 1]; out[i * 3 + 2] = table[s + 2];
  }
  return out;
}

/** Tick values for a legend: round numbers spanning [lo, hi]. */
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const first = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** A number for a legend or a readout, at a precision the range deserves. */
export function formatValue(v, span = Math.abs(v)) {
  if (!Number.isFinite(v)) return String(v);
  // Rounding noise against the range is zero: a magnitude of 1e-17 on a
  // 2 m/s legend is not a value anyone measured.
  if (span > 0 && Math.abs(v) < span * 1e-9) return "0";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : span >= 0.1 ? 3 : 4;
  return v.toFixed(digits);
}

/**
 * A tick label is read at a glance under a 15rem bar, so an exponent keeps
 * only the digits it needs: 5.000e+7 beside 1.000e+8 overprints its
 * neighbours, where 5e7 and 1e8 do not. The ends line keeps formatValue.
 */
export function tickLabel(v, span = Math.abs(v)) {
  const text = formatValue(v, span);
  if (!/e/.test(text)) return text;
  return text.replace(/\.?0+e/, "e").replace("e+", "e");
}

// ── Statistics by domain ────────────────────────────────────────────────────

/**
 * A scalar summarised over each volume flag, weighted by element measure.
 *
 * A node-by-node mean is a mean over wherever the mesher put nodes, and a
 * mesher puts them where the geometry is difficult: a chamber wall at 20 m
 * against a crust at 2 km would be counted a hundred times over. So each
 * linear element takes the mean of its nodes (exact for a first-order
 * element's integral) and is weighted by its volume, or its area in 2D.
 *
 * Min and max are over the NODES of the domain's elements, which is the range
 * the field actually takes there; the histogram is volume-weighted over the
 * element means, on one set of bins for every domain so they can be compared.
 * Elements that are not simplices, and elements touching a NaN, are counted
 * and left out rather than guessed at.
 */
export function domainStats(mesh, scalar, { bins = 24, lo = null, hi = null } = {}) {
  const { cells, cellOffsets, coords, dim } = mesh;
  const flags = mesh.cellFlag || new Int32Array(cellOffsets.length - 1);
  const count = cellOffsets.length - 1;
  const means = new Float64Array(count);
  const measure = new Float64Array(count);
  const keep = new Uint8Array(count);
  let skipped = 0;
  let nanCells = 0;
  const P = (i, a) => coords[i * 3 + a];
  for (let c = 0; c < count; c += 1) {
    const s = cellOffsets[c];
    const e = cellOffsets[c + 1];
    const n = e - s;
    const simplex = dim === 3 ? n === 4 : n === 3;
    if (!simplex) { skipped += 1; continue; }
    let sum = 0;
    let bad = false;
    for (let k = s; k < e; k += 1) { const v = scalar[cells[k]]; if (v !== v) { bad = true; break; } sum += v; }
    if (bad) { nanCells += 1; continue; }
    const a = cells[s];
    const b = cells[s + 1];
    const d = cells[s + 2];
    let m;
    if (dim === 3) {
      const f = cells[s + 3];
      const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2);
      const vx = P(d, 0) - P(a, 0), vy = P(d, 1) - P(a, 1), vz = P(d, 2) - P(a, 2);
      const wx = P(f, 0) - P(a, 0), wy = P(f, 1) - P(a, 1), wz = P(f, 2) - P(a, 2);
      m = Math.abs(ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx)) / 6;
    } else {
      m = Math.abs((P(b, 0) - P(a, 0)) * (P(d, 1) - P(a, 1)) - (P(d, 0) - P(a, 0)) * (P(b, 1) - P(a, 1))) / 2;
    }
    means[c] = sum / n;
    measure[c] = m;
    keep[c] = 1;
  }
  let gLo = lo;
  let gHi = hi;
  if (gLo === null || gHi === null) {
    let a = Infinity;
    let b = -Infinity;
    for (let c = 0; c < count; c += 1) if (keep[c]) { if (means[c] < a) a = means[c]; if (means[c] > b) b = means[c]; }
    if (gLo === null) gLo = Number.isFinite(a) ? a : 0;
    if (gHi === null) gHi = Number.isFinite(b) ? b : 0;
  }
  const span = gHi - gLo;
  const byFlag = new Map();
  for (let c = 0; c < count; c += 1) {
    if (!keep[c]) continue;
    const flag = flags[c];
    let g = byFlag.get(flag);
    if (!g) { g = { flag, cells: 0, measure: 0, wsum: 0, wsq: 0, min: Infinity, max: -Infinity, hist: new Float64Array(bins) }; byFlag.set(flag, g); }
    const w = measure[c];
    const v = means[c];
    g.cells += 1;
    g.measure += w;
    g.wsum += w * v;
    g.wsq += w * v * v;
    for (let k = cellOffsets[c]; k < cellOffsets[c + 1]; k += 1) { const x = scalar[cells[k]]; if (x < g.min) g.min = x; if (x > g.max) g.max = x; }
    let bin = span > 0 ? Math.floor(((v - gLo) / span) * bins) : 0;
    bin = bin < 0 ? 0 : bin >= bins ? bins - 1 : bin;
    g.hist[bin] += w;
  }
  const domains = [...byFlag.values()].sort((a, b) => a.flag - b.flag).map((g) => {
    const mean = g.measure > 0 ? g.wsum / g.measure : NaN;
    const variance = g.measure > 0 ? Math.max(0, g.wsq / g.measure - mean * mean) : NaN;
    return { flag: g.flag, cells: g.cells, measure: g.measure, mean, std: Math.sqrt(variance), min: g.min, max: g.max, hist: g.hist };
  });
  return { dim, domains, lo: gLo, hi: gHi, bins, skipped, nanCells };
}

/** One row per domain, units named by the caller; the histogram's bin edges follow. */
export function domainStatsCsv(stats, { label = "value", unit = "" } = {}) {
  const u = unit ? ` (${unit})` : "";
  const m = stats.dim === 3 ? "volume_m3" : "area_m2";
  const lines = [`flag,elements,${m},mean ${label}${u},std${u},min${u},max${u}`];
  for (const d of stats.domains) lines.push([d.flag, d.cells, d.measure, d.mean, d.std, d.min, d.max].join(","));
  lines.push("");
  const edges = Array.from({ length: stats.bins }, (_, k) => stats.lo + ((stats.hi - stats.lo) * k) / stats.bins);
  lines.push(`bin_from${u},${stats.domains.map((d) => `flag ${d.flag} ${stats.dim === 3 ? "volume_m3" : "area_m2"}`).join(",")}`);
  edges.forEach((e, k) => lines.push([e, ...stats.domains.map((d) => d.hist[k])].join(",")));
  return `${lines.join("\n")}\n`;
}

// ── Slicing ─────────────────────────────────────────────────────────────────

/**
 * Tetrahedra cut by the plane n·x = d.
 *
 * The answer is not positions but WHERE ON WHICH EDGE: every vertex is
 * (node a, node b, t), so the slice is computed once per plane and any field,
 * any time step and any deformation are interpolated onto it afterwards
 * without cutting again. Triangles are non-indexed: three vertices each.
 * A tet with one node on each side of the plane gives a triangle, two and two
 * a quad (two triangles); a node exactly on the plane counts as positive.
 */
export function sliceTets(mesh, normal, d) {
  const { coords, nodeCount, cells, cellOffsets, cellCount } = mesh;
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  // The plane is n·x = d for the normal AS GIVEN; normalising n alone would
  // move the plane (x+y+z = 1.5 is not x̂·x = 1.5).
  const nx = normal[0] / len; const ny = normal[1] / len; const nz = normal[2] / len;
  const dn = d / len;
  const dist = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) dist[i] = coords[i * 3] * nx + coords[i * 3 + 1] * ny + coords[i * 3 + 2] * nz - dn;
  return { ...cutTets(mesh, dist), normal: [nx, ny, nz], d: dn };
}

/**
 * The zero set of a per-node function over the tetrahedra, as edge
 * interpolants: the slice (signed distance to a plane) and the isosurface
 * (value minus level) are both this. A tet touching a NaN node is left out --
 * a value that is not there has no level to cross.
 */
export function cutTets(mesh, dist) {
  const { cells, cellOffsets, cellCount } = mesh;
  const A = new IntBuffer();
  const B = new IntBuffer();
  const T = [];
  const cellOf = new IntBuffer();
  const edge = (a, b) => {
    const da = dist[a];
    const db = dist[b];
    A.push(a); B.push(b);
    T.push(da === db ? 0 : da / (da - db));
  };
  const pos = [0, 0, 0, 0];
  const neg = [0, 0, 0, 0];
  for (let c = 0; c < cellCount; c += 1) {
    const s = cellOffsets[c];
    if (cellOffsets[c + 1] - s !== 4) continue;
    let np = 0;
    let nn = 0;
    let gap = false;
    for (let k = 0; k < 4; k += 1) {
      const node = cells[s + k];
      const v = dist[node];
      if (v !== v) { gap = true; break; }
      if (v >= 0) pos[np++] = node; else neg[nn++] = node;
    }
    if (gap || np === 0 || nn === 0) continue;
    if (np === 1 || nn === 1) {
      const lone = np === 1 ? pos[0] : neg[0];
      const others = np === 1 ? neg : pos;
      edge(lone, others[0]); edge(lone, others[1]); edge(lone, others[2]);
      cellOf.push(c);
    } else {
      const [p0, p1] = pos;
      const [n0, n1] = neg;
      edge(p0, n0); edge(p0, n1); edge(p1, n1);
      edge(p0, n0); edge(p1, n1); edge(p1, n0);
      cellOf.push(c); cellOf.push(c);
    }
  }
  return { a: A.done(), b: B.done(), t: Float32Array.from(T), cells: cellOf.done() };
}

/** The isosurface scalar = level, as the same edge interpolants a slice is. */
export function isoTets(mesh, scalar, level) {
  const dist = new Float64Array(mesh.nodeCount);
  for (let i = 0; i < mesh.nodeCount; i += 1) dist[i] = scalar[i] - level;
  return cutTets(mesh, dist);
}

/** Contour levels strictly inside a range: round numbers, about `count` of them. */
export function contourLevels(lo, hi, count = 10) {
  if (!(hi > lo)) return [];
  return niceTicks(lo, hi, count).filter((v) => v > lo + (hi - lo) * 1e-9 && v < hi - (hi - lo) * 1e-9);
}

/**
 * Contour lines over triangles by marching triangles. `positions` are xyz per
 * vertex, `values` one per vertex, `index` the triangles (null: every three
 * vertices in order, as a slice's are). A value equal to the level counts as
 * above it, as a node on a slice's plane does, so a line is never drawn twice
 * along a shared edge. Answers segment endpoints (xyz, two per segment) and
 * each endpoint's level index.
 */
export function contourSegments(positions, values, index, levels) {
  const out = [];
  const which = [];
  const tris = index ? index.length / 3 : positions.length / 9;
  const at = (k) => (index ? index[k] : k);
  const point = (i, j, L) => {
    const vi = values[i]; const vj = values[j];
    const t = vi === vj ? 0.5 : (L - vi) / (vj - vi);
    out.push(
      positions[i * 3] + (positions[j * 3] - positions[i * 3]) * t,
      positions[i * 3 + 1] + (positions[j * 3 + 1] - positions[i * 3 + 1]) * t,
      positions[i * 3 + 2] + (positions[j * 3 + 2] - positions[i * 3 + 2]) * t,
    );
  };
  for (let tIdx = 0; tIdx < tris; tIdx += 1) {
    const i0 = at(tIdx * 3); const i1 = at(tIdx * 3 + 1); const i2 = at(tIdx * 3 + 2);
    const v0 = values[i0]; const v1 = values[i1]; const v2 = values[i2];
    if (v0 !== v0 || v1 !== v1 || v2 !== v2) continue;
    const mn = Math.min(v0, v1, v2); const mx = Math.max(v0, v1, v2);
    for (let l = 0; l < levels.length; l += 1) {
      const L = levels[l];
      if (L < mn || L > mx) continue;
      const a0 = v0 >= L; const a1 = v1 >= L; const a2 = v2 >= L;
      if (a0 === a1 && a1 === a2) continue;
      // The lone vertex on its side of the level; the line crosses its two edges.
      const lone = a0 !== a1 && a0 !== a2 ? 0 : a1 !== a0 && a1 !== a2 ? 1 : 2;
      const [p, q, r] = lone === 0 ? [i0, i1, i2] : lone === 1 ? [i1, i2, i0] : [i2, i0, i1];
      point(p, q, L); point(p, r, L);
      which.push(l, l);
    }
  }
  return { positions: Float32Array.from(out), level: Uint16Array.from(which) };
}

/** A per-node array interpolated onto slice vertices (or positions, stride 3). */
export function interpolateOnSlice(slice, values, stride = 1, out = new Float32Array(slice.t.length * stride)) {
  const { a, b, t } = slice;
  for (let v = 0; v < t.length; v += 1) {
    const ia = a[v] * stride;
    const ib = b[v] * stride;
    const w = t[v];
    for (let s = 0; s < stride; s += 1) out[v * stride + s] = values[ia + s] + (values[ib + s] - values[ia + s]) * w;
  }
  return out;
}

/** The plane through the box's middle, or at `fraction` of it along `axis`. */
export function axisPlane(bounds, axis = "z", fraction = 0.5) {
  const k = { x: 0, y: 1, z: 2 }[axis] ?? 2;
  const normal = [0, 0, 0];
  normal[k] = 1;
  const d = bounds.min[k] + (bounds.max[k] - bounds.min[k]) * fraction;
  return { normal, d };
}

/** Nearest node of a list to a point, for a probe on a picked face. */
export function nearestNode(coords, nodes, p) {
  let best = -1;
  let bestD = Infinity;
  for (const i of nodes) {
    const d = (coords[i * 3] - p[0]) ** 2 + (coords[i * 3 + 1] - p[1]) ** 2 + (coords[i * 3 + 2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** A probe's series as CSV: one row per time, a column per component. */
export function probeCsv(series, desc, { node, x, y, z } = {}) {
  const cols = desc.components.map((c) => (c.unit ? `${c.key}_${c.unit.replace(/[^\w]+/g, "")}` : c.key));
  if (desc.vector) cols.push(`${desc.vector.label.toLowerCase().replace(/\s+/g, "_")}`);
  const head = [`# GALES ${desc.field} at node ${node}`, Number.isFinite(x) ? `# x=${x} y=${y} z=${z}` : null].filter(Boolean);
  const lines = [...head, ["time", ...cols].join(",")];
  for (const row of series) {
    const vals = [...row.values];
    if (desc.vector) vals.push(Math.hypot(...desc.vector.from.map((j) => row.values[j])));
    lines.push([row.time, ...vals.map((v) => (Number.isFinite(v) ? String(v) : ""))].join(","));
  }
  return `${lines.join("\n")}\n`;
}

// ── Points: flagged nodes and embedded points, and their time series ───────

/** Node flags in use, fewest nodes first: an embedded point's flag is a small group. */
export function flagSummary(nodeFlag) {
  if (!nodeFlag) return [];
  const counts = new Map();
  for (let i = 0; i < nodeFlag.length; i += 1) {
    const f = nodeFlag[i];
    if (f) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => a.count - b.count || a.flag - b.flag);
}

/** Nodes carrying a flag, as stations, capped. */
export function stationsForFlag(mesh, flag, { cap = 500 } = {}) {
  const out = [];
  let found = 0;
  for (let i = 0; i < mesh.nodeCount; i += 1) {
    if (mesh.nodeFlag?.[i] !== flag) continue;
    found += 1;
    if (out.length < cap) out.push({ name: `flag${flag}_node${i}`, node: i, x: mesh.coords[i * 3], y: mesh.coords[i * 3 + 1], z: mesh.coords[i * 3 + 2], flag, source: `flag ${flag}`, distance: 0 });
  }
  return { stations: out, found, capped: found > cap };
}

/**
 * The nearest node to any point, through a bucket grid built once: a thousand
 * points against a quarter of a million nodes is otherwise a quarter of a
 * billion distances.
 */
export function nodeLocator(mesh, { perBucket = 8 } = {}) {
  const { coords, nodeCount, bounds } = mesh;
  const span = [0, 1, 2].map((a) => Math.max(bounds.max[a] - bounds.min[a], 1e-9));
  const dims = mesh.dim === 2 ? 2 : 3;
  const cellsWanted = Math.max(1, nodeCount / perBucket);
  const side = dims === 3 ? Math.cbrt((span[0] * span[1] * span[2]) / cellsWanted) : Math.sqrt((span[0] * span[1]) / cellsWanted);
  const n = [0, 1, 2].map((a) => (a < dims ? Math.max(1, Math.min(512, Math.ceil(span[a] / side))) : 1));
  const cellOf = (v, a) => Math.min(n[a] - 1, Math.max(0, Math.floor(((v - bounds.min[a]) / span[a]) * n[a])));
  const head = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  const next = new Int32Array(nodeCount).fill(-1);
  for (let i = 0; i < nodeCount; i += 1) {
    const k = (cellOf(coords[i * 3 + 2], 2) * n[1] + cellOf(coords[i * 3 + 1], 1)) * n[0] + cellOf(coords[i * 3], 0);
    next[i] = head[k];
    head[k] = i;
  }
  const nearest = (p) => {
    const c = [cellOf(p[0], 0), cellOf(p[1], 1), cellOf(p[2] ?? 0, 2)];
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= Math.max(...n); ring += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        const z = c[2] + dz; if (z < 0 || z >= n[2]) continue;
        for (let dy = -ring; dy <= ring; dy += 1) {
          const y = c[1] + dy; if (y < 0 || y >= n[1]) continue;
          for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const x = c[0] + dx; if (x < 0 || x >= n[0]) continue;
            for (let i = head[(z * n[1] + y) * n[0] + x]; i >= 0; i = next[i]) {
              const d = (coords[i * 3] - p[0]) ** 2 + (coords[i * 3 + 1] - p[1]) ** 2 + (coords[i * 3 + 2] - (p[2] ?? 0)) ** 2;
              if (d < bestD) { bestD = d; best = i; }
            }
          }
        }
      }
      // A ring further out cannot hold anything nearer than the best found
      // once the best is closer than that ring's inner distance.
      const inner = ring * Math.min(...[0, 1, 2].slice(0, dims).map((a) => span[a] / n[a]));
      if (best >= 0 && Math.sqrt(bestD) <= inner) break;
    }
    return { node: best, distance: Math.sqrt(bestD) };
  };
  return { nearest };
}

/**
 * The Model Builder's embedded points, from a run's spec.json
 * (`geoid_model.embedded_points`): x, y, z in the mesh's frame, or s, z for a
 * cross-section, whose 2D mesh is written in (s, z).
 */
export function specPoints(spec) {
  const list = spec?.geoid_model?.embedded_points || spec?.embedded_points || [];
  return list.map((p, k) => {
    const name = String(p.name || `point_${k + 1}`);
    const flag = Number.isFinite(Number(p.flag)) ? Number(p.flag) : null;
    if (Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) return { name, x: Number(p.x), y: Number(p.y), z: Number(p.z) || 0, flag, source: "Model Builder" };
    if (Number.isFinite(Number(p.s)) && Number.isFinite(Number(p.z))) return { name, x: Number(p.s), y: Number(p.z), z: 0, flag, source: "Model Builder section" };
    return null;
  }).filter(Boolean);
}

/** Points typed or pasted: `name, x, y, z` a line, a header optional, any delimiter. */
export function parsePointList(text) {
  const out = [];
  String(text || "").split(/\r?\n/).forEach((line, k) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = t.split(/[,;\t]|\s+/).map((x) => x.trim()).filter((x) => x !== "");
    const nums = parts.map(Number);
    if (parts.length >= 3 && nums.slice(-3).every(Number.isFinite) && parts.length >= 4) out.push({ name: parts.slice(0, parts.length - 3).join(" "), x: nums[parts.length - 3], y: nums[parts.length - 2], z: nums[parts.length - 1], source: "typed" });
    else if (parts.length >= 2 && nums.every(Number.isFinite)) out.push({ name: `point_${out.length + 1}`, x: nums[0], y: nums[1], z: nums[2] ?? 0, source: "typed" });
  });
  return out;
}

const slugOf = (s) => String(s).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "x";

/**
 * Column heads for the chosen fields: `<field>_<component>_<unit>`, and the
 * magnitude of a vector after its components.
 */
export function seriesColumns(fields) {
  const cols = [];
  for (const f of fields) {
    const base = slugOf(f.desc.field.replace(/\//g, "_"));
    f.desc.components.forEach((c, j) => cols.push({ field: f, j, head: `${base}_${c.key}${c.unit ? `_${slugOf(c.unit.replace("²", "2").replace("³", "3"))}` : ""}` }));
    if (f.desc.vector) cols.push({ field: f, j: "mag", head: `${base}_magnitude${f.desc.vector.unit ? `_${slugOf(f.desc.vector.unit.replace("²", "2"))}` : ""}` });
  }
  return cols;
}

/**
 * The extracted values as CSV files.
 *
 * `fields`: [{ desc, times: [t…], values: Float64Array(steps × stations × nbDofs) }].
 * Times are the union over the fields, each field blank where it has no step.
 * `layout`: "station" (a file per point, a row per time), "step" (a file per
 * time, a row per point) or "tidy" (one file, a row per point per time).
 */
export function stationCsvFiles({ stations, fields, layout = "station", prefix = "gales", header = [] }) {
  const cols = seriesColumns(fields);
  const times = [...new Set(fields.flatMap((f) => f.times))].sort((a, b) => a - b);
  const stepOf = fields.map((f) => new Map(f.times.map((t, k) => [t, k])));
  const valueOf = (col, fi, ti, si) => {
    const f = fields[fi];
    const k = stepOf[fi].get(times[ti]);
    if (k === undefined) return "";
    const nb = f.desc.nbDofs;
    const at = (j) => f.values[(k * stations.length + si) * nb + j];
    const v = col.j === "mag" ? Math.hypot(...f.desc.vector.from.map(at)) : at(col.j);
    return Number.isFinite(v) ? String(v) : "";
  };
  const fieldIndex = new Map(fields.map((f, k) => [f, k]));
  const rowValues = (ti, si) => cols.map((c) => valueOf(c, fieldIndex.get(c.field), ti, si));
  const meta = (s) => [s.name, s.node, s.x, s.y, s.z, s.flag ?? "", Number.isFinite(s.distance) ? s.distance : ""];
  const quote = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const comment = header.map((h) => `# ${h}`);
  const files = [];
  if (layout === "station") {
    stations.forEach((s, si) => {
      const lines = [...comment, `# point ${s.name} · node ${s.node} · x=${s.x} y=${s.y} z=${s.z}${s.flag != null ? ` · flag ${s.flag}` : ""}${Number.isFinite(s.distance) && s.distance > 0 ? ` · ${s.distance.toFixed(3)} m from the point asked for` : ""}`, ["time", ...cols.map((c) => c.head)].join(",")];
      times.forEach((t, ti) => lines.push([t, ...rowValues(ti, si)].join(",")));
      files.push({ name: `${prefix}_${slugOf(s.name)}.csv`, text: `${lines.join("\n")}\n` });
    });
  } else if (layout === "step") {
    times.forEach((t, ti) => {
      const lines = [...comment, `# time ${t}`, ["point", "node", "x", "y", "z", "flag", "distance_m", ...cols.map((c) => c.head)].join(",")];
      stations.forEach((s, si) => lines.push([...meta(s).map(quote), ...rowValues(ti, si)].join(",")));
      files.push({ name: `${prefix}_t${slugOf(String(t))}.csv`, text: `${lines.join("\n")}\n` });
    });
  } else {
    const lines = [...comment, ["time", "point", "node", "x", "y", "z", "flag", "distance_m", ...cols.map((c) => c.head)].join(",")];
    times.forEach((t, ti) => stations.forEach((s, si) => lines.push([t, ...meta(s).map(quote), ...rowValues(ti, si)].join(","))));
    files.push({ name: `${prefix}_points.csv`, text: `${lines.join("\n")}\n` });
  }
  return { files, times, columns: cols.map((c) => c.head) };
}

/**
 * The files of a simulation folder worth opening: mesh candidates (a GALES
 * `mesh_*.txt`, else any `.msh`, the one `setup.txt` names first) and the
 * result fields. `entries` are { path, size }.
 */
export function planSimulation(entries, setupText = "", { meshes: chosen = [], looseField = "" } = {}) {
  const named = new Set();
  for (const m of String(setupText).matchAll(/^\s*(solid_mesh_file|fluid_mesh_file|mesh_file)\s+(\S+)/gm)) named.add(m[2]);
  const meshes = entries
    .filter((e) => /\.(txt|msh|vtu)$/i.test(e.path) && !/(^|\/)results\//.test(e.path))
    .filter((e) => chosen.includes(e.path) || /\.(msh|vtu)$/i.test(e.path) || /(^|\/)mesh[^/]*\.txt$/i.test(e.path))
    .map((e) => ({ ...e, name: e.path.split("/").pop() }))
    .sort((a, b) => {
      // A mesh the reader opened by hand comes first: it is the one they meant.
      const score = (m) => (chosen.includes(m.path) ? -1 : named.has(m.name) ? 0 : /\.txt$/i.test(m.name) ? 1 : 2);
      return score(a) - score(b) || a.path.localeCompare(b.path);
    });
  return { meshes, fields: groupResultFiles(entries, { looseField }), setup: named.size ? [...named] : [] };
}

// ── Sampling inside the mesh: plot over line ────────────────────────────────

/**
 * WHICH ELEMENT HOLDS A POINT, and its barycentric weights there.
 *
 * A field on nodes is linear inside a first-order element, so the value at
 * any point is the weighted sum of its element's nodal values — exact, not an
 * approximation of one. That is what makes a line profile through the volume
 * honest: it reads the solution, rather than the nearest node's value.
 *
 * Elements are bucketed by bounding box on a grid sized to a few elements per
 * cell; a point tests only its own cell's elements. 3D uses tetrahedra, 2D
 * triangles in the xy plane. Higher-order cells are tested on their corner
 * nodes (the first 4 or 3), which is linear interpolation of their vertices.
 */
export function cellLocator(mesh, { perBucket = 6 } = {}) {
  const dim = mesh.dim === 2 ? 2 : 3;
  const need = dim === 3 ? 4 : 3;
  const { coords, bounds } = mesh;
  const offsets = mesh.cellOffsets;
  const cells = [];
  for (let c = 0; c + 1 < offsets.length; c += 1) if (offsets[c + 1] - offsets[c] >= need) cells.push(c);
  const span = [0, 1, 2].map((a) => Math.max(bounds.max[a] - bounds.min[a], 1e-12));
  const volume = dim === 3 ? span[0] * span[1] * span[2] : span[0] * span[1];
  const side = dim === 3 ? Math.cbrt(volume / Math.max(1, cells.length / perBucket)) : Math.sqrt(volume / Math.max(1, cells.length / perBucket));
  const n = [0, 1, 2].map((a) => (a < dim ? Math.max(1, Math.min(256, Math.ceil(span[a] / side))) : 1));
  const cellOf = (v, a) => Math.min(n[a] - 1, Math.max(0, Math.floor(((v - bounds.min[a]) / span[a]) * n[a])));
  const buckets = Array.from({ length: n[0] * n[1] * n[2] }, () => []);
  for (const c of cells) {
    const s = offsets[c];
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < need; k += 1) {
      const i = mesh.cells[s + k];
      for (let a = 0; a < 3; a += 1) { const v = coords[i * 3 + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    }
    const a0 = [0, 1, 2].map((a) => cellOf(lo[a], a)); const a1 = [0, 1, 2].map((a) => cellOf(hi[a], a));
    for (let z = a0[2]; z <= a1[2]; z += 1) for (let y = a0[1]; y <= a1[1]; y += 1) for (let x = a0[0]; x <= a1[0]; x += 1) buckets[(z * n[1] + y) * n[0] + x].push(c);
  }
  const P = (i, a) => coords[i * 3 + a];
  const tol = 1e-9;
  const inTet = (c, p) => {
    const s = offsets[c];
    const [i0, i1, i2, i3] = [mesh.cells[s], mesh.cells[s + 1], mesh.cells[s + 2], mesh.cells[s + 3]];
    const a = [P(i1, 0) - P(i0, 0), P(i1, 1) - P(i0, 1), P(i1, 2) - P(i0, 2)];
    const b = [P(i2, 0) - P(i0, 0), P(i2, 1) - P(i0, 1), P(i2, 2) - P(i0, 2)];
    const d = [P(i3, 0) - P(i0, 0), P(i3, 1) - P(i0, 1), P(i3, 2) - P(i0, 2)];
    const r = [p[0] - P(i0, 0), p[1] - P(i0, 1), p[2] - P(i0, 2)];
    const det = a[0] * (b[1] * d[2] - b[2] * d[1]) - b[0] * (a[1] * d[2] - a[2] * d[1]) + d[0] * (a[1] * b[2] - a[2] * b[1]);
    if (Math.abs(det) < 1e-300) return null;
    const u = (r[0] * (b[1] * d[2] - b[2] * d[1]) - b[0] * (r[1] * d[2] - r[2] * d[1]) + d[0] * (r[1] * b[2] - r[2] * b[1])) / det;
    const v = (a[0] * (r[1] * d[2] - r[2] * d[1]) - r[0] * (a[1] * d[2] - a[2] * d[1]) + d[0] * (a[1] * r[2] - a[2] * r[1])) / det;
    const w = (a[0] * (b[1] * r[2] - b[2] * r[1]) - b[0] * (a[1] * r[2] - a[2] * r[1]) + r[0] * (a[1] * b[2] - a[2] * b[1])) / det;
    const t = 1 - u - v - w;
    if (u < -tol || v < -tol || w < -tol || t < -tol) return null;
    return { nodes: [i0, i1, i2, i3], weights: [t, u, v, w] };
  };
  const inTri = (c, p) => {
    const s = offsets[c];
    const [i0, i1, i2] = [mesh.cells[s], mesh.cells[s + 1], mesh.cells[s + 2]];
    const x0 = P(i0, 0); const y0 = P(i0, 1);
    const ax = P(i1, 0) - x0; const ay = P(i1, 1) - y0; const bx = P(i2, 0) - x0; const by = P(i2, 1) - y0;
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-300) return null;
    const rx = p[0] - x0; const ry = p[1] - y0;
    const u = (rx * by - ry * bx) / det; const v = (ax * ry - ay * rx) / det; const t = 1 - u - v;
    if (u < -tol || v < -tol || t < -tol) return null;
    return { nodes: [i0, i1, i2], weights: [t, u, v] };
  };
  return {
    cells: cells.length,
    locate(p) {
      for (let a = 0; a < dim; a += 1) if (p[a] < bounds.min[a] - span[a] * 1e-9 || p[a] > bounds.max[a] + span[a] * 1e-9) return null;
      const bucket = buckets[(cellOf(dim === 3 ? p[2] : 0, 2) * n[1] + cellOf(p[1], 1)) * n[0] + cellOf(p[0], 0)];
      for (const c of bucket) {
        const hit = dim === 3 ? inTet(c, p) : inTri(c, p);
        if (hit) return { cell: c, ...hit };
      }
      return null;
    },
  };
}

/** `count` points evenly from a to b, with their distance along the line. */
export function lineSamples(a, b, count = 256) {
  const n = Math.max(2, Math.round(count));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));
  const points = new Float64Array(n * 3);
  const distance = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const t = k / (n - 1);
    points[k * 3] = a[0] + (b[0] - a[0]) * t;
    points[k * 3 + 1] = a[1] + (b[1] - a[1]) * t;
    points[k * 3 + 2] = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t;
    distance[k] = len * t;
  }
  return { points, distance, length: len };
}

/**
 * Locate many points at once, packed for a worker to hand back: four node
 * indices and four weights per point (a triangle's fourth weight is zero),
 * node −1 where a point is outside the mesh.
 */
export function locatePoints(locator, points) {
  const n = points.length / 3;
  const nodes = new Int32Array(n * 4).fill(-1);
  const weights = new Float64Array(n * 4);
  let inside = 0;
  for (let k = 0; k < n; k += 1) {
    const hit = locator.locate([points[k * 3], points[k * 3 + 1], points[k * 3 + 2]]);
    if (!hit) continue;
    inside += 1;
    hit.nodes.forEach((node, j) => { nodes[k * 4 + j] = node; weights[k * 4 + j] = hit.weights[j]; });
  }
  return { nodes, weights, inside };
}

/** A nodal scalar at located points; NaN outside the mesh. */
export function sampleLocated(located, scalar) {
  const n = located.nodes.length / 4;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    if (located.nodes[k * 4] < 0) { out[k] = NaN; continue; }
    let v = 0;
    for (let j = 0; j < 4; j += 1) {
      const node = located.nodes[k * 4 + j];
      if (node >= 0) v += located.weights[k * 4 + j] * scalar[node];
    }
    out[k] = v;
  }
  return out;
}

/**
 * SELECTION through a screen rectangle — ParaView's frustum selection.
 *
 * Every candidate node (warped if `disp` is given) is carried through
 * `matrix` (the frame's world matrix, column-major 16) and `viewProjection`
 * (projection × view, column-major 16) to normalised device coordinates, and
 * kept when it is in front of the camera and inside the rectangle, given in
 * NDC as { x0, x1, y0, y1 } (either order). `candidates` limits the test to a
 * set of nodes (the surface's, for "on the surface"); omitted, every node.
 */
export function selectInRect(coords, { disp = null, matrix, viewProjection, rect, candidates = null }) {
  const m = matrix; const P = viewProjection;
  const x0 = Math.min(rect.x0, rect.x1); const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1); const y1 = Math.max(rect.y0, rect.y1);
  const n = candidates ? candidates.length : coords.length / 3;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const i = candidates ? candidates[k] : k;
    const px = coords[i * 3] + (disp ? disp[i * 3] : 0);
    const py = coords[i * 3 + 1] + (disp ? disp[i * 3 + 1] : 0);
    const pz = coords[i * 3 + 2] + (disp ? disp[i * 3 + 2] : 0);
    const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
    const cw = P[3] * wx + P[7] * wy + P[11] * wz + P[15];
    if (!(cw > 0)) continue;
    const nx = (P[0] * wx + P[4] * wy + P[8] * wz + P[12]) / cw;
    if (nx < x0 || nx > x1) continue;
    const ny = (P[1] * wx + P[5] * wy + P[9] * wz + P[13]) / cw;
    if (ny < y0 || ny > y1) continue;
    const nz = (P[2] * wx + P[6] * wy + P[10] * wz + P[14]) / cw;
    if (nz < -1 || nz > 1) continue;
    out.push(i);
  }
  return Int32Array.from(out);
}

/** A scalar over a selection: count, finite count, min, max, mean. */
export function selectionSummary(scalar, ids) {
  let lo = Infinity; let hi = -Infinity; let sum = 0; let finite = 0;
  for (const i of ids) {
    const v = scalar[i];
    if (!Number.isFinite(v)) continue;
    finite += 1; sum += v;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  return { count: ids.length, finite, min: finite ? lo : NaN, max: finite ? hi : NaN, mean: finite ? sum / finite : NaN };
}

/**
 * TEMPORAL STATISTICS: each node's minimum, maximum, mean and standard
 * deviation over the steps of one scalar, with the time of the minimum and of
 * the maximum — ParaView's Temporal Statistics. Steps are added one at a time
 * so a long run is never held in memory at once; the mean is over STEPS (each
 * written step counts once, as ParaView's filter does), not weighted by the
 * time between them. A non-finite value at a node is skipped at that node.
 *
 *   → Float64Array nodes × 6: min, max, mean, std, t_min, t_max
 */
export function temporalAccumulator(nodeCount) {
  const min = new Float64Array(nodeCount).fill(Infinity);
  const max = new Float64Array(nodeCount).fill(-Infinity);
  const sum = new Float64Array(nodeCount); const sq = new Float64Array(nodeCount);
  const count = new Uint32Array(nodeCount);
  const tmin = new Float64Array(nodeCount).fill(NaN); const tmax = new Float64Array(nodeCount).fill(NaN);
  let steps = 0;
  return {
    add(scalar, time) {
      steps += 1;
      for (let i = 0; i < nodeCount; i += 1) {
        const v = scalar[i];
        if (!Number.isFinite(v)) continue;
        if (v < min[i]) { min[i] = v; tmin[i] = time; }
        if (v > max[i]) { max[i] = v; tmax[i] = time; }
        sum[i] += v; sq[i] += v * v; count[i] += 1;
      }
    },
    get steps() { return steps; },
    result() {
      const out = new Float64Array(nodeCount * 6);
      for (let i = 0; i < nodeCount; i += 1) {
        const c = count[i];
        const o = i * 6;
        if (!c) { out.fill(NaN, o, o + 6); continue; }
        const mean = sum[i] / c;
        out[o] = min[i]; out[o + 1] = max[i]; out[o + 2] = mean;
        out[o + 3] = Math.sqrt(Math.max(0, sq[i] / c - mean * mean));
        out[o + 4] = tmin[i]; out[o + 5] = tmax[i];
      }
      return out;
    },
  };
}

/**
 * STREAM TRACER: curves everywhere tangent to a vector field, as ParaView's
 * Stream Tracer draws them.
 *
 * The field is interpolated in each element exactly as a profile is (the
 * element's own nodal values, barycentrically), and the curve is integrated
 * with classical RK4 on the UNIT field — dx/ds = v/|v| — so a step is a length
 * in space and the curve's shape does not depend on the field's size. It stops
 * where it leaves the mesh, where the field vanishes (below `stallFraction` of
 * the largest nodal magnitude), after `maxSteps`, or past `maxLength`. A seed
 * traced both ways gives one polyline, backward half reversed onto forward.
 *
 *   vec    per-node interleaved (vx, vy, vz)
 *   seeds  flat xyz
 *   →      { points (xyz), values (|v| at each point), starts (first point of
 *            each line), counts, reasons, seeded, traced }
 */
export function streamlines(locator, vec, seeds, {
  step, maxSteps = 2000, maxLength = Infinity, direction = "both", stallFraction = 1e-6,
} = {}) {
  const nodeCount = vec.length / 3;
  let vmax = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    const m = Math.hypot(vec[i * 3], vec[i * 3 + 1], vec[i * 3 + 2]);
    if (m > vmax) vmax = m;
  }
  const stall = vmax * stallFraction;
  const field = (p) => {
    const hit = locator.locate(p);
    if (!hit) return null;
    let x = 0; let y = 0; let z = 0;
    for (let j = 0; j < hit.nodes.length; j += 1) {
      const node = hit.nodes[j]; const w = hit.weights[j];
      x += w * vec[node * 3]; y += w * vec[node * 3 + 1]; z += w * vec[node * 3 + 2];
    }
    const m = Math.hypot(x, y, z);
    return { x, y, z, m };
  };
  const unit = (f) => [f.x / f.m, f.y / f.m, f.z / f.m];
  const trace = (seed, sign) => {
    const pts = [seed.slice()]; const mags = [];
    const first = field(seed);
    if (!first || !(first.m > stall)) return { pts: [], mags: [], reason: first ? "stalled" : "outside" };
    mags.push(first.m);
    let p = seed.slice(); let length = 0; let reason = "steps"; let cur = first;
    for (let k = 0; k < maxSteps; k += 1) {
      const h = sign * step;
      const f1 = cur; if (!(f1.m > stall)) { reason = "stalled"; break; }
      const k1 = unit(f1);
      const f2 = field([p[0] + 0.5 * h * k1[0], p[1] + 0.5 * h * k1[1], p[2] + 0.5 * h * k1[2]]); if (!f2 || !(f2.m > stall)) { reason = f2 ? "stalled" : "outside"; break; }
      const k2 = unit(f2);
      const f3 = field([p[0] + 0.5 * h * k2[0], p[1] + 0.5 * h * k2[1], p[2] + 0.5 * h * k2[2]]); if (!f3 || !(f3.m > stall)) { reason = f3 ? "stalled" : "outside"; break; }
      const k3 = unit(f3);
      const f4 = field([p[0] + h * k3[0], p[1] + h * k3[1], p[2] + h * k3[2]]); if (!f4 || !(f4.m > stall)) { reason = f4 ? "stalled" : "outside"; break; }
      const k4 = unit(f4);
      const next = [0, 1, 2].map((a) => p[a] + (h / 6) * (k1[a] + 2 * k2[a] + 2 * k3[a] + k4[a]));
      const fn = field(next);
      if (!fn) { reason = "outside"; break; }
      length += Math.abs(h);
      p = next; cur = fn; pts.push(next); mags.push(fn.m);
      if (length >= maxLength) { reason = "length"; break; }
    }
    return { pts, mags, reason };
  };
  const points = []; const values = []; const starts = []; const counts = []; const reasons = [];
  const n = seeds.length / 3;
  let traced = 0;
  for (let s = 0; s < n; s += 1) {
    const seed = [seeds[s * 3], seeds[s * 3 + 1], seeds[s * 3 + 2]];
    const fwd = direction === "backward" ? { pts: [], mags: [], reason: "" } : trace(seed, 1);
    const bwd = direction === "forward" ? { pts: [], mags: [], reason: "" } : trace(seed, -1);
    // Backward reversed, without repeating the seed, then forward.
    const line = [...bwd.pts.slice(1).reverse(), ...(fwd.pts.length ? fwd.pts : bwd.pts.slice(0, 1))];
    const mags = [...bwd.mags.slice(1).reverse(), ...(fwd.pts.length ? fwd.mags : bwd.mags.slice(0, 1))];
    if (line.length < 2) { reasons.push(fwd.reason || bwd.reason || "outside"); continue; }
    traced += 1;
    starts.push(points.length / 3); counts.push(line.length); reasons.push([bwd.reason, fwd.reason].filter(Boolean).join("/"));
    for (const q of line) points.push(q[0], q[1], q[2]);
    values.push(...mags);
  }
  return { points: Float64Array.from(points), values: Float64Array.from(values), starts: Int32Array.from(starts), counts: Int32Array.from(counts), reasons, seeded: n, traced, vmax };
}

/** Seeds for a stream tracer: evenly along a line, or spread through a sphere (a Fibonacci shell per radius, deterministic). */
export function streamSeeds(kind, { a, b, centre, radius, count = 50 } = {}) {
  const n = Math.max(1, Math.floor(count));
  const out = new Float64Array(n * 3);
  if (kind === "line") {
    for (let k = 0; k < n; k += 1) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      for (let ax = 0; ax < 3; ax += 1) out[k * 3 + ax] = a[ax] + t * (b[ax] - a[ax]);
    }
    return out;
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < n; k += 1) {
    const r = radius * Math.cbrt((k + 0.5) / n); // uniform in volume
    const y = 1 - (2 * (k + 0.5)) / n; const ring = Math.sqrt(Math.max(0, 1 - y * y)); const th = golden * k;
    out[k * 3] = centre[0] + r * ring * Math.cos(th);
    out[k * 3 + 1] = centre[1] + r * y;
    out[k * 3 + 2] = centre[2] + r * ring * Math.sin(th);
  }
  return out;
}

/** Stream lines as CSV: line, point, arc length, x, y, z, magnitude. */
export function streamlinesCsv(lines, { header = [], unit = "" } = {}) {
  const out = [...header.map((h) => `# ${h}`), `line,point,s_m,x,y,z,magnitude${unit ? `_${unit.replace(/[^A-Za-z0-9]/g, "")}` : ""}`];
  const P = lines.points;
  for (let l = 0; l < lines.starts.length; l += 1) {
    let s = 0;
    for (let k = 0; k < lines.counts[l]; k += 1) {
      const i = lines.starts[l] + k;
      if (k) s += Math.hypot(P[i * 3] - P[(i - 1) * 3], P[i * 3 + 1] - P[(i - 1) * 3 + 1], P[i * 3 + 2] - P[(i - 1) * 3 + 2]);
      out.push([l, k, s, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], lines.values[i]].map((v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10))))).join(","));
    }
  }
  return `${out.join("\n")}\n`;
}

/** A profile as CSV: distance, x, y, z, then one column per series. */
export function profileCsv({ distance, points, series, header = [] }) {
  const cols = ["distance_m", "x", "y", "z", ...series.map((s) => s.name)];
  const lines = [...header.map((h) => `# ${h}`), cols.join(",")];
  for (let k = 0; k < distance.length; k += 1) {
    const row = [distance[k], points[k * 3], points[k * 3 + 1], points[k * 3 + 2], ...series.map((s) => s.values[k])];
    lines.push(row.map((v) => (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}
