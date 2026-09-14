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

const asBytes = (input) => (input instanceof Uint8Array ? input
  : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : input instanceof ArrayBuffer ? new Uint8Array(input)
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
  // A planar mesh written in 3D coordinates with z = 0 everywhere stays 2D.
  return finishMesh({
    format: `msh ${version}`, dim, nodeCount, coords, nodeFlag: null,
    cells: top.conn.done(), cellOffsets: top.offsets.done(), cellFlag: top.flag.done(),
    sides: side.conn.done(), sideOffsets: side.offsets.done(), sideFlag: side.flag.done(),
    declared: {}, lastNode: nodeCount - 1,
  });
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
  const { cells, cellOffsets, cellCount } = mesh;
  let tets = 0;
  for (let c = 0; c < cellCount; c += 1) if (cellOffsets[c + 1] - cellOffsets[c] === 4) tets += 1;
  const nFaces = tets * 4;
  let cap = 1;
  while (cap < nFaces * 2) cap <<= 1;
  const slotA = new Int32Array(cap).fill(-1);
  const slotB = new Int32Array(cap);
  const slotC = new Int32Array(cap);
  const slotCount = new Uint8Array(cap);
  const slotFace = new Int32Array(cap * 3);
  const mask = cap - 1;
  for (let c = 0; c < cellCount; c += 1) {
    const s = cellOffsets[c];
    if (cellOffsets[c + 1] - s !== 4) continue;
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
          slotFace[h * 3] = p; slotFace[h * 3 + 1] = q; slotFace[h * 3 + 2] = r;
          break;
        }
        if (slotA[h] === a && slotB[h] === b && slotC[h] === d) { slotCount[h] = 2; break; }
        h = (h + 1) & mask;
      }
    }
  }
  const out = new IntBuffer();
  for (let h = 0; h < cap; h += 1) {
    if (slotA[h] !== -1 && slotCount[h] === 1) { out.push(slotFace[h * 3]); out.push(slotFace[h * 3 + 1]); out.push(slotFace[h * 3 + 2]); }
  }
  return out.done();
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
 */
export function groupResultFiles(entries) {
  const fields = new Map();
  for (const entry of entries) {
    const path = typeof entry === "string" ? entry : entry.path;
    const size = typeof entry === "string" ? null : entry.size ?? null;
    const parts = String(path).split("/");
    const name = parts.pop();
    const time = timeOf(name);
    if (time === null) continue;
    const r = parts.lastIndexOf("results");
    if (r < 0 || r === parts.length - 1) continue;
    const field = parts.slice(r + 1).join("/");
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push({ time, name, path, size });
  }
  return [...fields.entries()]
    .map(([field, steps]) => ({ field, steps: steps.sort((a, b) => a.time - b.time) }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

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
  if (/^solid\/u$|elastostatic_dofs$/.test(f)) out = vectorOf("Displacement", "m", "u", { displacement: [...Array(Math.min(dim, nbDofs)).keys()] });
  else if (/^solid\/v$/.test(f)) out = vectorOf("Velocity", "m/s", "v");
  else if (/^solid\/a$/.test(f)) out = vectorOf("Acceleration", "m/s²", "a");
  else if (/fluid_mesh$/.test(f)) out = { ...vectorOf("Mesh displacement", "m", "d", { displacement: [...Array(Math.min(dim, nbDofs)).keys()] }), blocked: true };
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
  } else out = { label: f, components: generic() };
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
export function colormapTable(name, { reverse = false, steps = 256 } = {}) {
  const stops = COLORMAPS[name] || COLORMAPS["Cool to Warm"];
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
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : span >= 0.1 ? 3 : 4;
  return v.toFixed(digits);
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
    for (let k = 0; k < 4; k += 1) {
      const node = cells[s + k];
      if (dist[node] >= 0) pos[np++] = node; else neg[nn++] = node;
    }
    if (np === 0 || nn === 0) continue;
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
  return { a: A.done(), b: B.done(), t: Float32Array.from(T), cells: cellOf.done(), normal: [nx, ny, nz], d: dn };
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

/**
 * The files of a simulation folder worth opening: mesh candidates (a GALES
 * `mesh_*.txt`, else any `.msh`, the one `setup.txt` names first) and the
 * result fields. `entries` are { path, size }.
 */
export function planSimulation(entries, setupText = "") {
  const named = new Set();
  for (const m of String(setupText).matchAll(/^\s*(solid_mesh_file|fluid_mesh_file|mesh_file)\s+(\S+)/gm)) named.add(m[2]);
  const meshes = entries
    .filter((e) => /\.(txt|msh)$/i.test(e.path) && !/(^|\/)results\//.test(e.path))
    .filter((e) => /\.msh$/i.test(e.path) || /(^|\/)mesh[^/]*\.txt$/i.test(e.path))
    .map((e) => ({ ...e, name: e.path.split("/").pop() }))
    .sort((a, b) => {
      const score = (m) => (named.has(m.name) ? 0 : /\.txt$/i.test(m.name) ? 1 : 2);
      return score(a) - score(b) || a.path.localeCompare(b.path);
    });
  return { meshes, fields: groupResultFiles(entries), setup: named.size ? [...named] : [] };
}
