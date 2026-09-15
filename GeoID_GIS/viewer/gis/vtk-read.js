/**
 * READING VTK: ParaView's own formats, so the Results reader opens any
 * solver's output and not only GALES's.
 *
 *   - XML UnstructuredGrid (.vtu), every encoding VTK writes: ascii, inline
 *     base64 ("binary"), and appended data raw or base64; uncompressed or
 *     zlib-compressed in blocks; UInt32 or UInt64 headers.
 *   - A .pvd collection: the time series of .vtu files ParaView opens as one.
 *
 * No DOMParser: a worker has none, and a 58 MB appended file is not a string
 * to hand to one. The XML head is read with a scanner up to <AppendedData>;
 * the appended bytes are read in place.
 *
 * Two things VTK does that a reader has to know:
 *   - A compressed array's HEADER and its DATA are base64-encoded as two
 *     separate streams ("…==eF5…"). The header's own padding says which: a
 *     header chunk ending in "=" was encoded on its own. Where the header is a
 *     multiple of three bytes the two encodings coincide, so either reading is
 *     right.
 *   - An inline DataArray may carry <InformationKey> children after its data,
 *     so its text is taken up to the first child element.
 */

const TYPES = {
  Int8: [Int8Array, 1], UInt8: [Uint8Array, 1], Int16: [Int16Array, 2], UInt16: [Uint16Array, 2],
  Int32: [Int32Array, 4], UInt32: [Uint32Array, 4], Int64: [BigInt64Array, 8], UInt64: [BigUint64Array, 8],
  Float32: [Float32Array, 4], Float64: [Float64Array, 8],
};

const attrsOf = (text) => {
  const out = Object.create(null);
  for (const m of String(text).matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const latin1 = (u8, start = 0, end = u8.length) => {
  let s = "";
  for (let i = start; i < end; i += 65536) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(end, i + 65536)));
  return s;
};

function findBytes(u8, needle, from = 0) {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= u8.length - n; i += 1) {
    if (u8[i] !== first) continue;
    for (let k = 1; k < n; k += 1) if (u8[i + k] !== needle.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

function base64Bytes(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/=]/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("This browser cannot decompress zlib data (no DecompressionStream).");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Everything the head of a .vtu says, without decoding an array. */
export function vtuHead(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const appendedTag = findBytes(u8, "<AppendedData");
  const headEnd = appendedTag >= 0 ? appendedTag : u8.length;
  const xml = latin1(u8, 0, headEnd);
  const file = /<VTKFile\b([^>]*)>/.exec(xml);
  if (!file) throw new Error("Not a VTK XML file (no <VTKFile>).");
  const fa = attrsOf(file[1]);
  if (fa.type !== "UnstructuredGrid") throw new Error(`A VTK ${fa.type || "file"} is not an unstructured grid: open the .vtu the solver wrote, or save it as one in ParaView.`);
  if (fa.byte_order && fa.byte_order !== "LittleEndian") throw new Error("Big-endian VTK files are not read here.");
  const compressor = fa.compressor || "";
  if (compressor && !/ZLib/i.test(compressor)) throw new Error(`${compressor} is not read here: save the file uncompressed or with zlib.`);
  const pieces = [...xml.matchAll(/<Piece\b([^>]*)>/g)];
  if (!pieces.length) throw new Error("The unstructured grid has no <Piece>.");
  const piece = attrsOf(pieces[0][1]);
  let appended = null;
  if (appendedTag >= 0) {
    const close = findBytes(u8, ">", appendedTag);
    const encoding = attrsOf(latin1(u8, appendedTag, close)).encoding || "raw";
    const underscore = findBytes(u8, "_", close);
    appended = { start: underscore + 1, encoding };
  }
  const body = xml.slice(0, pieces[1] ? pieces[1].index : xml.length);
  const section = (tag) => {
    const open = new RegExp(`<${tag}\\b([^>]*?)(/?)>`).exec(body);
    if (!open) return null;
    if (open[2] === "/") return { attrs: attrsOf(open[1]), inner: "" };
    const end = body.indexOf(`</${tag}>`, open.index);
    return { attrs: attrsOf(open[1]), inner: body.slice(open.index + open[0].length, end < 0 ? body.length : end) };
  };
  const arraysIn = (sec) => {
    if (!sec) return [];
    const out = [];
    for (const m of sec.inner.matchAll(/<DataArray\b([^>]*?)(\/>|>([\s\S]*?)<\/DataArray>)/g)) {
      const a = attrsOf(m[1]);
      const content = m[3] ? m[3].split("<")[0] : "";
      out.push({ name: a.Name || "", type: a.type, components: Number(a.NumberOfComponents || 1), format: a.format || "ascii", offset: Number(a.offset || 0), content });
    }
    return out;
  };
  return {
    headerBytes: fa.header_type === "UInt64" ? 8 : 4,
    compressed: Boolean(compressor),
    pieces: pieces.length,
    points: Number(piece.NumberOfPoints || 0),
    cells: Number(piece.NumberOfCells || 0),
    appended,
    pointsArray: arraysIn(section("Points"))[0] || null,
    cellArrays: arraysIn(section("Cells")),
    pointData: arraysIn(section("PointData")),
    cellData: arraysIn(section("CellData")),
    bytes: u8,
  };
}

const readUint = (u8, at, size) => {
  const dv = new DataView(u8.buffer, u8.byteOffset + at, size);
  return size === 8 ? Number(dv.getBigUint64(0, true)) : dv.getUint32(0, true);
};

/** One DataArray's values as a typed array of its own type (Int64 as Float64: node ids fit). */
export async function decodeArray(head, array, expectCount = null) {
  const def = TYPES[array.type];
  if (!def) throw new Error(`${array.name || "an array"} is of type ${array.type}, which is not read here.`);
  const [Ctor, size] = def;
  const finish = (raw) => {
    const n = Math.floor(raw.length / size);
    const aligned = new Uint8Array(n * size);
    aligned.set(raw.subarray(0, n * size));
    const typed = new Ctor(aligned.buffer);
    return size === 8 && (array.type === "Int64" || array.type === "UInt64") ? Float64Array.from(typed, Number) : typed;
  };
  if (array.format === "ascii") {
    const parts = array.content.trim().split(/\s+/).filter(Boolean);
    if (array.type === "Float32" || array.type === "Float64") return (array.type === "Float32" ? Float32Array : Float64Array).from(parts, Number);
    return Float64Array.from(parts, Number);
  }
  const H = head.headerBytes;
  let blockBytes;
  if (array.format === "binary" || (array.format === "appended" && head.appended?.encoding === "base64")) {
    let chars;
    if (array.format === "binary") {
      const text = array.content.replace(/\s+/g, "");
      chars = (from, count) => text.slice(from, from + count);
    } else {
      const base = head.appended.start + array.offset;
      chars = (from, count) => latin1(head.bytes, base + from, Math.min(head.bytes.length, base + from + count));
    }
    blockBytes = await decodeBase64Blocks(chars, head, H);
  } else if (array.format === "appended") {
    blockBytes = await decodeRawBlocks(head.bytes, head.appended.start + array.offset, head, H);
  } else throw new Error(`DataArray format "${array.format}" is not read here.`);
  return finish(blockBytes);
}

async function decodeRawBlocks(u8, at, head, H) {
  if (!head.compressed) {
    const n = readUint(u8, at, H);
    return u8.subarray(at + H, at + H + n);
  }
  const nb = readUint(u8, at, H);
  const blockSize = readUint(u8, at + H, H);
  const lastSize = readUint(u8, at + 2 * H, H);
  const sizes = [];
  for (let k = 0; k < nb; k += 1) sizes.push(readUint(u8, at + (3 + k) * H, H));
  let p = at + (3 + nb) * H;
  const total = nb ? (nb - 1) * blockSize + (lastSize || blockSize) : 0;
  const out = new Uint8Array(total);
  let o = 0;
  for (const s of sizes) {
    const part = await inflate(u8.subarray(p, p + s));
    out.set(part, o); o += part.length; p += s;
  }
  return out;
}

async function decodeBase64Blocks(chars, head, H) {
  const chunk = (bytes) => 4 * Math.ceil(bytes / 3);
  if (!head.compressed) {
    const hc = chunk(H);
    const lead = chars(0, hc);
    const n = readUint(base64Bytes(lead), 0, H);
    if (lead.endsWith("=")) return base64Bytes(chars(hc, chunk(n))).subarray(0, n);
    return base64Bytes(chars(0, chunk(H + n))).subarray(H, H + n);
  }
  const lead = base64Bytes(chars(0, chunk(3 * H)));
  const nb = readUint(lead, 0, H);
  const blockSize = readUint(lead, H, H);
  const lastSize = readUint(lead, 2 * H, H);
  const hc = chunk((3 + nb) * H);
  const headText = chars(0, hc);
  const separate = headText.endsWith("=");
  const header = base64Bytes(headText);
  let sum = 0;
  const sizes = [];
  for (let k = 0; k < nb; k += 1) { const s = readUint(header, (3 + k) * H, H); sizes.push(s); sum += s; }
  const data = separate ? base64Bytes(chars(hc, chunk(sum))) : base64Bytes(chars(0, chunk((3 + nb) * H + sum))).subarray((3 + nb) * H);
  const total = nb ? (nb - 1) * blockSize + (lastSize || blockSize) : 0;
  const out = new Uint8Array(total);
  let o = 0; let p = 0;
  for (const s of sizes) {
    const part = await inflate(data.subarray(p, p + s));
    out.set(part, o); o += part.length; p += s;
  }
  return out;
}

/** The grid's points, cells and cell data (for flags); point data by name on request. */
export async function readVtu(bytes, { pointData = [], cellData = true } = {}) {
  const head = vtuHead(bytes);
  if (head.pieces > 1) throw new Error(`This .vtu holds ${head.pieces} pieces: merge them in ParaView (Merge Blocks) and save one.`);
  if (!head.pointsArray) throw new Error("The grid has no <Points>.");
  const pts = await decodeArray(head, head.pointsArray, head.points * 3);
  const points = Float64Array.from(pts.subarray ? pts.subarray(0, head.points * 3) : pts);
  const cell = (name) => head.cellArrays.find((a) => a.name === name);
  const conn = cell("connectivity"); const offs = cell("offsets"); const types = cell("types");
  if (!conn || !offs || !types) throw new Error("The grid's <Cells> needs connectivity, offsets and types.");
  const out = {
    head,
    points,
    connectivity: Float64Array.from(await decodeArray(head, conn)),
    offsets: Float64Array.from(await decodeArray(head, offs, head.cells)),
    types: Uint8Array.from(await decodeArray(head, types, head.cells)),
    pointData: [],
    cellData: [],
  };
  for (const a of head.pointData) {
    if (pointData !== true && !pointData.includes(a.name)) continue;
    const v = await decodeArray(head, a, head.points * a.components);
    out.pointData.push({ name: a.name, components: a.components, values: Float64Array.from(v.subarray ? v.subarray(0, head.points * a.components) : v) });
  }
  if (cellData) {
    for (const a of head.cellData) {
      if (a.components !== 1) continue;
      const v = await decodeArray(head, a, head.cells);
      out.cellData.push({ name: a.name, type: a.type, values: Float64Array.from(v.subarray ? v.subarray(0, head.cells) : v) });
    }
  }
  return out;
}

/** A .pvd collection's datasets in time order (part 0 of each). */
export function parsePvd(text) {
  const out = [];
  for (const m of String(text).matchAll(/<DataSet\b([^>]*)\/?>/g)) {
    const a = attrsOf(m[1]);
    if (!a.file) continue;
    if (a.part && Number(a.part) !== 0) continue;
    const t = Number(a.timestep);
    out.push({ time: Number.isFinite(t) ? t : out.length, file: a.file });
  }
  return out.sort((x, y) => x.time - y.time);
}

/** True when bytes start like a VTK XML file. */
export function isVtkXml(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = latin1(u8, 0, Math.min(u8.length, 512));
  return /<VTKFile\b/.test(head);
}

// Cells, in VTK's node order, as the reader's linear simplices.
const HEX_TETS = [[0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6]];
const WEDGE_TETS = [[0, 1, 2, 5], [0, 1, 4, 5], [0, 3, 4, 5]];
const PYRAMID_TETS = [[0, 1, 2, 4], [0, 2, 3, 4]];
const VOXEL_TO_HEX = [0, 1, 3, 2, 4, 5, 7, 6];
const PIXEL_TO_QUAD = [0, 1, 3, 2];

/** Which cell-data array carries a domain number, by name, else the first integer one. */
export function flagArrayOf(cellData) {
  const named = cellData.find((a) => /^(gmsh:physical|material(_?ids?)?|materialids|region|flag|cell_?flag|domain|block_?id|subdomain|elementblockids|cellentityids)$/i.test(a.name));
  if (named) return named;
  return cellData.find((a) => /Int/.test(a.type)) || null;
}

/**
 * The raw mesh the reader finishes: tets (3D) or triangles (2D), with every
 * 3D cell reduced to linear tets on its corner nodes and 2D cells in a 3D
 * grid kept as flagged sides. Answers counts of what was reduced or skipped.
 */
export function vtkCellsToRawMesh(grid) {
  const { points, connectivity, offsets, types } = grid;
  const nodeCount = points.length / 3;
  const flags = flagArrayOf(grid.cellData || []);
  const flagOf = (c) => (flags ? Math.round(flags.values[c]) || 0 : 0);
  const cells = []; const cellOffsets = [0]; const cellFlag = [];
  const sides = []; const sideOffsets = [0]; const sideFlag = [];
  const counts = { tet: 0, hex: 0, wedge: 0, pyramid: 0, quadratic: 0, tri: 0, quad: 0, polygon: 0, skipped: 0 };
  let has3 = false;
  for (let c = 0; c < types.length; c += 1) if ([10, 11, 12, 13, 14, 24, 25, 26, 27, 29].includes(types[c])) { has3 = true; break; }
  const nodesOf = (c) => {
    const e = offsets[c]; const s = c ? offsets[c - 1] : 0;
    const out = new Array(e - s);
    for (let k = s; k < e; k += 1) out[k - s] = connectivity[k];
    return out;
  };
  const pushTet = (n, idx, flag) => { for (const i of idx) cells.push(n[i]); cellOffsets.push(cells.length); cellFlag.push(flag); };
  const pushTri = (n, idx, flag, asSide) => {
    const [arr, offs, fl] = asSide ? [sides, sideOffsets, sideFlag] : [cells, cellOffsets, cellFlag];
    for (const i of idx) arr.push(n[i]); offs.push(arr.length); fl.push(flag);
  };
  for (let c = 0; c < types.length; c += 1) {
    const t = types[c]; const n = nodesOf(c); const f = flagOf(c);
    if (t === 10 || t === 24) { pushTet(n, [0, 1, 2, 3], f); counts[t === 10 ? "tet" : "quadratic"] += 1; } else if (t === 12 || t === 25 || t === 29 || t === 11) {
      const hex = t === 11 ? VOXEL_TO_HEX.map((i) => n[i]) : n;
      for (const tet of HEX_TETS) pushTet(hex, tet, f);
      counts[t === 12 || t === 11 ? "hex" : "quadratic"] += 1;
    } else if (t === 13 || t === 26) { for (const tet of WEDGE_TETS) pushTet(n, tet, f); counts[t === 13 ? "wedge" : "quadratic"] += 1; } else if (t === 14 || t === 27) { for (const tet of PYRAMID_TETS) pushTet(n, tet, f); counts[t === 14 ? "pyramid" : "quadratic"] += 1; } else if (t === 5 || t === 22) { pushTri(n, [0, 1, 2], f, has3); counts[t === 5 ? "tri" : "quadratic"] += 1; } else if (t === 9 || t === 23 || t === 8 || t === 28) {
      const q = t === 8 ? PIXEL_TO_QUAD.map((i) => n[i]) : n;
      pushTri(q, [0, 1, 2], f, has3); pushTri(q, [0, 2, 3], f, has3);
      counts[t === 9 || t === 8 ? "quad" : "quadratic"] += 1;
    } else if (t === 7) {
      for (let k = 1; k + 1 < n.length; k += 1) pushTri([n[0], n[k], n[k + 1]], [0, 1, 2], f, has3);
      counts.polygon += 1;
    } else counts.skipped += 1;
  }
  if (!cellFlag.length) throw new Error("The grid has no 2D or 3D cells to read (lines and vertices only).");
  return {
    raw: {
      format: "vtu", dim: has3 ? 3 : 2, nodeCount, coords: points, nodeFlag: new Int32Array(nodeCount),
      cells: Int32Array.from(cells), cellOffsets: Int32Array.from(cellOffsets), cellFlag: Int32Array.from(cellFlag),
      sides: Int32Array.from(sides), sideOffsets: Int32Array.from(sideOffsets), sideFlag: Int32Array.from(sideFlag),
      declared: {}, lastNode: nodeCount - 1,
    },
    counts,
    flagArray: flags?.name || null,
  };
}

/**
 * A field name the reader's describer understands: a displacement-like
 * array becomes "<name>/u" (Displacement, its magnitude and a warp), a
 * velocity "<name>/v"; anything else keeps its name, made path-safe.
 */
export function vtkFieldName(name, components) {
  const safe = String(name || "array").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "array";
  if (components === 3 && /^(u|disp|displacement|displacements|dispvec)$/i.test(name)) return `${safe}/u`;
  if (components === 3 && /^(v|vel|velocity|velocities)$/i.test(name)) return `${safe}/v`;
  return safe;
}
