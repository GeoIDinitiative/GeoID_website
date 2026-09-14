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
 *   progress while parsing                 → { id, type: "progress", fraction }
 */
import { parseMesh, sliceTets } from "./gales-results.js?v=20260915-2db6686";

let mesh = null;

function reply(message, transfer = []) {
  self.postMessage(message, transfer);
}

async function handle(event) {
  const { id, type } = event.data || {};
  try {
    if (type === "parse") {
      mesh = null;
      const parsed = parseMesh(new Uint8Array(event.data.buffer), {
        onProgress: (fraction) => reply({ id, type: "progress", fraction }),
      });
      mesh = parsed;
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

function countTets(m) {
  let n = 0;
  for (let c = 0; c < m.cellCount; c += 1) if (m.cellOffsets[c + 1] - m.cellOffsets[c] === 4) n += 1;
  return n;
}

// Only inside a worker: imported anywhere else this module does nothing.
if (typeof self !== "undefined" && typeof window === "undefined" && typeof self.postMessage === "function") {
  self.addEventListener("message", handle);
}
