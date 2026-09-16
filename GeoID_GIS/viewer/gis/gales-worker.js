/**
 * The GALES reader off the main thread.
 *
 * An 87 MB mesh is half a second of parsing and a quarter of a gigabyte of
 * transient memory; on the page's thread that is a frozen studio. The worker
 * parses, keeps the mesh (a slice needs the cells, and the cells never need
 * to cross back), and hands over only what is drawn: the coordinates and the
 * boundary triangles, by transfer.
 *
 *   { id, type: "parse", buffer }          → { id, ok, mesh }
 *   { id, type: "slice", normal, d }       → { id, ok, slice }
 *   { id, type: "iso", scalar, levels }   → { id, ok, iso }  (edge interpolants, and each vertex's level)
 *   { id, type: "locate", points }         → { id, ok, located }  (nodes ×4, weights ×4 per point)
 *   { id, type: "stream", vec, seeds, options } → { id, ok, lines } (streamlines, by transfer)
 *   { id, type: "stats", scalar, bins } → { id, ok, stats } (domainStats, per volume flag)
 *   { id, type: "gradient", scalar } → { id, ok, gradient } (nodalGradient: ∂x, ∂y, ∂z, |∇| per node)
 *   { id, type: "derive", u, nbDofs, material, gridText } → { id, ok, derived } (strain-stress.js)
 *   { id, type: "quality" }                → { id, ok, analysis }  (mesh-quality.js, by transfer)
 *   { id, type: "vtu", part, pointData, time } → { id, ok, blob, bytes, cells } (vtk-export.js; a Blob clones without copying)
 *   progress while parsing                 → { id, type: "progress", fraction }
 */
import { readVtkGrid, vtkCellsToRawMesh, isVtkFile } from "./vtk-read.js?v=20260916-2c5a8ad";
import { parseMesh, meshFromRaw, sliceTets, isoTets, cellLocator, locatePoints, streamlines, domainStats, exposedFaces, thresholdKeep, keptTriangles } from "./gales-results.js?v=20260916-2c5a8ad";
import { analyseMesh } from "./mesh-quality.js?v=20260916-2c5a8ad";
import { derivedFields, materialAt, nodalGradient } from "./strain-stress.js?v=20260916-2c5a8ad";
import { parseTable, buildGrid, sampleGrid } from "./tomography.js?v=20260916-2c5a8ad";
import { vtkCells, vtuParts } from "./vtk-export.js?v=20260916-2c5a8ad";

let mesh = null;
let locator = null; // built on the first locate, dropped with the mesh
let material = { key: "", fn: null }; // the run's E and nu as a function of position
let vtk = null; // the mesh's cells in VTK's layout, built once for every step exported

function reply(message, transfer = []) {
  self.postMessage(message, transfer);
}

async function handle(event) {
  const { id, type } = event.data || {};
  try {
    if (type === "parse") {
      mesh = null;
      vtk = null;
      const bytes = new Uint8Array(event.data.buffer);
      let vtkNote = null;
      let parsed;
      if (isVtkFile(bytes)) {
        // A VTK grid: its cells reduced to linear simplices, its flag array as the domains.
        const grid = await readVtkGrid(bytes, { pointData: [], cellData: true });
        const made = vtkCellsToRawMesh(grid);
        parsed = meshFromRaw(made.raw);
        vtkNote = { counts: made.counts, flagArray: made.flagArray };
      } else {
        parsed = parseMesh(bytes, { onProgress: (fraction) => reply({ id, type: "progress", fraction }) });
      }
      mesh = parsed;
      locator = null;
      const coords = parsed.coords.slice();
      const surface = parsed.surface.slice();
      const surfaceFlag = parsed.surfaceFlag.slice();
      const edges = parsed.edges ? parsed.edges.slice() : null;
      const nodeFlag = parsed.nodeFlag ? parsed.nodeFlag.slice() : null;
      const out = {
        format: parsed.format, dim: parsed.dim, nodeCount: parsed.nodeCount,
        cellCount: parsed.cellCount, sideCount: parsed.sideCount, bounds: parsed.bounds,
        surfaceFrom: parsed.surfaceFrom, coords, surface, surfaceFlag, edges, nodeFlag,
        tets: countTets(parsed),
        vtkNote,
        volumeFlags: volumeFlagCounts(parsed),
      };
      reply({ id, ok: true, mesh: out }, [coords.buffer, surface.buffer, surfaceFlag.buffer, ...(edges ? [edges.buffer] : []), ...(nodeFlag ? [nodeFlag.buffer] : [])]);
      return;
    }
    if (type === "slice") {
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const slice = sliceTets(mesh, event.data.normal, event.data.d);
      reply({ id, ok: true, slice }, [slice.a.buffer, slice.b.buffer, slice.t.buffer, slice.cells.buffer]);
      return;
    }
    if (type === "threshold") {
      // The skin of the cells a threshold keeps, each face with its cell's flag.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const { keep, kept } = thresholdKeep(mesh, event.data.scalar || null, event.data);
      const got = mesh.dim === 3 ? exposedFaces(mesh, keep) : keptTriangles(mesh, keep);
      const flags = new Int32Array(got.cells.length);
      if (mesh.cellFlag) for (let k = 0; k < got.cells.length; k += 1) flags[k] = mesh.cellFlag[got.cells[k]];
      reply({ id, ok: true, threshold: { triangles: got.triangles, flags, kept, of: mesh.cellCount } }, [got.triangles.buffer, flags.buffer]);
      return;
    }
    if (type === "iso") {
      // Isosurfaces: the same cut as a slice, of value minus level, per level.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const iso = isoSet(mesh, event.data.scalar, event.data.levels);
      reply({ id, ok: true, iso }, [iso.a.buffer, iso.b.buffer, iso.t.buffer, iso.level.buffer]);
      return;
    }
    if (type === "locate") {
      // Points inside the mesh: their element's nodes and barycentric weights.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      if (!locator) locator = cellLocator(mesh);
      const located = locatePoints(locator, event.data.points);
      reply({ id, ok: true, located }, [located.nodes.buffer, located.weights.buffer]);
      return;
    }
    if (type === "stream") {
      // A stream tracer walks element to element: the cells are here.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      if (!locator) locator = cellLocator(mesh);
      const lines = streamlines(locator, event.data.vec, event.data.seeds, event.data.options || {});
      reply({ id, ok: true, lines }, [lines.points.buffer, lines.values.buffer, lines.starts.buffer, lines.counts.buffer]);
      return;
    }
    if (type === "gradient") {
      // A scalar's gradient, per element and averaged to the nodes: the cells are here.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const out = nodalGradient(mesh, new Float64Array(event.data.scalar));
      reply({ id, ok: true, gradient: out }, [out.values.buffer]);
      return;
    }
    if (type === "derive") {
      // Strain and stress from one displacement step, with the run's own material.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const key = JSON.stringify(event.data.material || null) + (event.data.gridText ? `|${event.data.gridText.length}` : "");
      if (material.key !== key) {
        const spec = event.data.material;
        let grid = null;
        if (spec?.kind === "pointwise" && event.data.gridText) grid = buildGrid(parseTable(event.data.gridText), { dim: spec.dim });
        material = { key, fn: materialAt(spec, grid?.ok ? grid : null, sampleGrid) };
      }
      const out = derivedFields(mesh, new Float64Array(event.data.u), event.data.nbDofs, material.fn);
      reply({ id, ok: true, derived: out }, [out.values.buffer]);
      return;
    }
    if (type === "quality") {
      // The cells never cross to the page, so the metrics are computed where
      // they are, off the page's thread, and only the answer crosses back.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const analysis = qualityForTransfer(analyseMesh(mesh), mesh);
      reply({ id, ok: true, analysis }, analysis ? [...Object.values(analysis.metrics).map((m) => m.buffer), analysis.elements.coords.buffer, analysis.elements.conn.buffer] : []);
      return;
    }
    if (type === "stats") {
      // Per volume flag, weighted by element measure: the cells are here.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const stats = domainStats(mesh, event.data.scalar, { bins: event.data.bins || 24 });
      reply({ id, ok: true, stats }, stats.domains.map((d) => d.hist.buffer));
      return;
    }
    if (type === "vtu") {
      // ParaView: every node as a point (so point data aligns with the node
      // numbering), and the volume's cells or the boundary's triangles.
      if (!mesh) throw new Error("No mesh is loaded in the reader.");
      const part = event.data.part === "surface" && mesh.dim === 3 ? "surface" : "volume";
      if (vtk?.mesh !== mesh || vtk.part !== part) {
        let cells;
        let cellData;
        if (part === "surface") {
          const n = mesh.surface.length / 3;
          const offsets = new Int32Array(n);
          for (let k = 0; k < n; k += 1) offsets[k] = (k + 1) * 3;
          cells = { connectivity: Int32Array.from(mesh.surface), offsets, types: new Uint8Array(n).fill(5) };
          cellData = [{ name: "surface_flag", components: 1, values: Int32Array.from(mesh.surfaceFlag) }];
        } else {
          cells = vtkCells(mesh.cells, mesh.cellOffsets, mesh.dim);
          const flags = new Int32Array(cells.count);
          if (mesh.cellFlag) for (let k = 0; k < cells.count; k += 1) flags[k] = mesh.cellFlag[cells.source[k]];
          cellData = [{ name: "volume_flag", components: 1, values: flags }];
        }
        vtk = { mesh, part, cells, cellData };
      }
      const pointData = [...(event.data.pointData || [])];
      if (mesh.nodeFlag) pointData.push({ name: "node_flag", components: 1, values: Int32Array.from(mesh.nodeFlag) });
      const { parts, bytes } = vtuParts({ points: mesh.coords, cells: vtk.cells, pointData, cellData: vtk.cellData, time: event.data.time });
      const blob = new Blob(parts, { type: "application/octet-stream" });
      reply({ id, ok: true, blob, bytes, cells: vtk.cells.types.length, part });
      return;
    }
    if (type === "drop") {
      mesh = null;
      reply({ id, ok: true });
      return;
    }
    throw new Error(`Unknown request ${type}`);
  } catch (error) {
    reply({ id, ok: false, error: error?.message || String(error) });
  }
}

/** How many cells carry each volume flag, for the threshold's list of domains. */
export function volumeFlagCounts(source) {
  const counts = new Map();
  const flags = source.cellFlag;
  for (let c = 0; c < source.cellCount; c += 1) {
    const f = flags ? flags[c] : 0;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([flag, count]) => ({ flag, count }));
}

/** Several isosurfaces in one set of arrays, each vertex tagged with its level's index. */
export function isoSet(source, scalar, levels) {
  const parts = levels.map((L) => isoTets(source, scalar, L));
  const n = parts.reduce((a, p) => a + p.t.length, 0);
  const out = { a: new Int32Array(n), b: new Int32Array(n), t: new Float32Array(n), level: new Uint16Array(n) };
  let at = 0;
  parts.forEach((p, l) => {
    out.a.set(p.a, at); out.b.set(p.b, at); out.t.set(p.t, at); out.level.fill(l, at, at + p.t.length);
    at += p.t.length;
  });
  return out;
}

/** An analysis whose arrays can be transferred without taking the worker's mesh with them. */
export function qualityForTransfer(analysis, source) {
  if (!analysis) return null;
  const E = analysis.elements;
  return {
    count: analysis.count, dim: analysis.dim, per: analysis.per,
    inverted: analysis.inverted, degenerate: analysis.degenerate, metrics: analysis.metrics,
    elements: {
      per: E.per, dim: E.dim,
      coords: E.coords === source.coords ? E.coords.slice() : E.coords,
      conn: E.conn === source.cells ? E.conn.slice() : E.conn,
    },
  };
}

function countTets(m) {
  let n = 0;
  for (let c = 0; c < m.cellCount; c += 1) if (m.cellOffsets[c + 1] - m.cellOffsets[c] === 4) n += 1;
  return n;
}

// Only inside a worker: imported anywhere else this module does nothing.
if (typeof self !== "undefined" && typeof window === "undefined" && typeof self.postMessage === "function") {
  self.addEventListener("message", handle);
}
