/**
 * A GALES run as VTK files, for ParaView.
 *
 * The Results reader answers most questions on the page, and ParaView answers
 * the rest: a run leaves here as an XML UnstructuredGrid (.vtu) per step, and
 * a .pvd collection that names each one's time, which ParaView opens as one
 * time series.
 *
 * Appended RAW binary, UInt64 headers: no base64 (a third larger and a string
 * the size of the file on the heap), and no compression (ParaView reads it
 * fastest and a browser zip stores it anyway). The file is returned as Blob
 * PARTS -- the XML head as a string, then each array's bytes -- so a 60 MB
 * volume is never copied into one buffer before the Blob holds it.
 *
 * Pure: arrays in, parts out. The reader worker, which holds the cells, calls
 * it; the tests read the parts back with the small reader below.
 */

/** VTK cell type by node count, in the mesh's own dimension; 0 where it is not a cell of that dimension. */
export function vtkCellType(nodes, dim) {
  if (dim === 3) return { 4: 10, 5: 14, 6: 13, 8: 12, 10: 24 }[nodes] || 0;
  if (dim === 2) return { 3: 5, 4: 9, 6: 22, 8: 23 }[nodes] || 0;
  return nodes === 2 ? 3 : 0;
}

/**
 * The cells of the mesh's own dimension, in VTK's layout: connectivity, END
 * offsets (VTK counts them from the first node, without a leading 0), types,
 * and which source cell each came from (for cell data such as the volume flag).
 */
export function vtkCells(cells, cellOffsets, dim) {
  const count = cellOffsets.length - 1;
  const keep = [];
  let conn = 0;
  for (let c = 0; c < count; c += 1) {
    const n = cellOffsets[c + 1] - cellOffsets[c];
    if (vtkCellType(n, dim)) { keep.push(c); conn += n; }
  }
  const connectivity = new Int32Array(conn);
  const offsets = new Int32Array(keep.length);
  const types = new Uint8Array(keep.length);
  const source = new Int32Array(keep.length);
  let at = 0;
  keep.forEach((c, k) => {
    const s = cellOffsets[c];
    const e = cellOffsets[c + 1];
    for (let i = s; i < e; i += 1) connectivity[at++] = cells[i];
    offsets[k] = at;
    types[k] = vtkCellType(e - s, dim);
    source[k] = c;
  });
  return { connectivity, offsets, types, source, count: keep.length };
}

const TYPE_NAME = new Map([
  [Float64Array, "Float64"], [Float32Array, "Float32"], [Int32Array, "Int32"],
  [Uint8Array, "UInt8"], [Int8Array, "Int8"], [Uint32Array, "UInt32"], [Int16Array, "Int16"], [Uint16Array, "UInt16"],
]);

const xmlName = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/**
 * One .vtu as Blob parts.
 *   points     Float64Array | Float32Array, 3 per point (a 2D mesh carries z = 0)
 *   cells      { connectivity, offsets, types }
 *   pointData  [{ name, components, values }]   values: a typed array, components per point
 *   cellData   [{ name, components, values }]
 *   fieldData  { TimeValue }                    written as FieldData, which ParaView reads as the time
 * Answers { parts, bytes }.
 */
export function vtuParts({ points, cells, pointData = [], cellData = [], time = null }) {
  const nPoints = points.length / 3;
  const blocks = [];
  let offset = 0;
  const add = (arr) => {
    const type = TYPE_NAME.get(arr.constructor);
    if (!type) throw new Error(`No VTK type for ${arr.constructor.name}`);
    const at = offset;
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const head = new Uint8Array(8);
    new DataView(head.buffer).setBigUint64(0, BigInt(bytes.byteLength), true);
    blocks.push(head, bytes);
    offset += 8 + bytes.byteLength;
    return { type, at };
  };
  const arrayXml = (name, components, arr) => {
    const { type, at } = add(arr);
    return `        <DataArray type="${type}" Name="${xmlName(name)}"${components > 1 ? ` NumberOfComponents="${components}"` : ""} format="appended" offset="${at}"/>\n`;
  };
  for (const d of pointData) if (d.values.length !== nPoints * d.components) throw new Error(`${d.name}: ${d.values.length} values for ${nPoints} points × ${d.components}`);
  for (const d of cellData) if (d.values.length !== cells.types.length * d.components) throw new Error(`${d.name}: ${d.values.length} values for ${cells.types.length} cells × ${d.components}`);

  let xml = `<?xml version="1.0"?>\n<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian" header_type="UInt64">\n  <UnstructuredGrid>\n`;
  if (Number.isFinite(time)) {
    const t = new Float64Array([time]);
    const { type, at } = add(t);
    xml += `    <FieldData>\n      <DataArray type="${type}" Name="TimeValue" NumberOfTuples="1" format="appended" offset="${at}"/>\n    </FieldData>\n`;
  }
  xml += `    <Piece NumberOfPoints="${nPoints}" NumberOfCells="${cells.types.length}">\n`;
  xml += "      <PointData>\n";
  for (const d of pointData) xml += arrayXml(d.name, d.components, d.values);
  xml += "      </PointData>\n      <CellData>\n";
  for (const d of cellData) xml += arrayXml(d.name, d.components, d.values);
  xml += "      </CellData>\n      <Points>\n";
  xml += arrayXml("Points", 3, points);
  xml += "      </Points>\n      <Cells>\n";
  xml += arrayXml("connectivity", 1, cells.connectivity);
  xml += arrayXml("offsets", 1, cells.offsets);
  xml += arrayXml("types", 1, cells.types);
  xml += "      </Cells>\n    </Piece>\n  </UnstructuredGrid>\n  <AppendedData encoding=\"raw\">\n   _";
  const tail = "\n  </AppendedData>\n</VTKFile>\n";
  const head = new TextEncoder().encode(xml);
  const end = new TextEncoder().encode(tail);
  return { parts: [head, ...blocks, end], bytes: head.byteLength + offset + end.byteLength };
}

/** The .pvd that makes a folder of .vtu one time series. */
export function pvdText(entries) {
  const rows = entries.map((e) => `    <DataSet timestep="${Number(e.time)}" group="" part="0" file="${xmlName(e.file)}"/>`).join("\n");
  return `<?xml version="1.0"?>\n<VTKFile type="Collection" version="0.1" byte_order="LittleEndian">\n  <Collection>\n${rows}\n  </Collection>\n</VTKFile>\n`;
}

/**
 * A field's per-node numbers as VTK point arrays. A vector (displacement,
 * velocity) is ONE three-component array, which ParaView's Warp By Vector and
 * Glyph filters take as it is; every other component is its own scalar. A
 * field written by component (GALES write2) is re-interleaved. Float64, so a
 * solution leaves exactly as the solver wrote it (Float32 moved Etna's u by 4 µm).
 */
export function fieldArrays(desc, values, nodeCount, dim = 3) {
  const nb = desc.nbDofs;
  const at = (i, j) => (desc.blocked ? values[j * nodeCount + i] : values[i * nb + j]);
  const out = [];
  const base = String(desc.field).replace(/^derived\//, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
  const vecFrom = desc.displacement || desc.vector?.from || null;
  const used = new Set();
  if (vecFrom && vecFrom.length >= 2) {
    const v = new Float64Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i += 1) vecFrom.slice(0, 3).forEach((j, a) => { v[i * 3 + a] = at(i, j); });
    // "solid_u" for a displacement; "fluid_dofs_v" where the vector is part of a larger dof set.
    const key = desc.components[vecFrom[0]]?.key?.replace(/x$/, "") || "";
    out.push({ name: !key || base.endsWith(`_${key}`) || base === key ? base : `${base}_${key}`, components: 3, values: v });
    vecFrom.forEach((j) => used.add(j));
  }
  desc.components.forEach((c, j) => {
    if (used.has(j)) return;
    const s = new Float64Array(nodeCount);
    for (let i = 0; i < nodeCount; i += 1) s[i] = at(i, j);
    out.push({ name: `${base}_${c.key}`, components: 1, values: s });
  });
  return out;
}

/** A .vtu read back from its bytes: enough to check what was written (tests). */
export function readVtu(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // The XML head is ASCII, so it can be searched as text up to the marker.
  const probe = new TextDecoder("latin1").decode(u8.subarray(0, Math.min(u8.length, 1 << 20)));
  const tag = probe.indexOf('<AppendedData encoding="raw">');
  const marker = probe.indexOf("_", tag);
  const xml = new TextDecoder().decode(u8.subarray(0, marker));
  const start = marker + 1;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const CTOR = { Float64: Float64Array, Float32: Float32Array, Int32: Int32Array, UInt8: Uint8Array, Int8: Int8Array, UInt32: Uint32Array };
  const arrays = {};
  for (const m of xml.matchAll(/<DataArray type="(\w+)" Name="([^"]+)"(?: NumberOfComponents="(\d+)")?(?: NumberOfTuples="\d+")? format="appended" offset="(\d+)"\/>/g)) {
    const [, type, name, comps, off] = m;
    const at = start + Number(off);
    const n = Number(view.getBigUint64(at, true));
    const C = CTOR[type];
    const copy = u8.slice(at + 8, at + 8 + n);
    arrays[name] = { type, components: Number(comps || 1), values: new C(copy.buffer) };
  }
  const piece = /NumberOfPoints="(\d+)" NumberOfCells="(\d+)"/.exec(xml);
  return { xml, arrays, points: Number(piece[1]), cells: Number(piece[2]) };
}
