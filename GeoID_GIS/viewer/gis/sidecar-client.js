/**
 * The GIS layer's view of the local sidecar: what it can do, and how a tool
 * gets run over there instead of here.
 *
 * The browser keeps a complete native toolset — that is the site's promise,
 * and nothing below may weaken it. This module only answers two questions:
 *
 *   1. Can this machine do better? (`probe()` — GDAL binaries, Python
 *      modules, gmsh, all PROBED, never assumed.)
 *   2. Is this particular job big enough to be worth the round trip?
 *      (`shouldOffload()` — a 6x6 grid is not.)
 *
 * A tool with a sidecar engine that cannot run for any reason falls back to
 * native and SAYS WHY in the status line. An absent GDAL is a fact about this
 * machine, not an error: "gdalwarp is not installed" is a better answer than a
 * disabled button with no explanation, and far better than a silent failure.
 *
 * Everything crossing the wire goes through the project folder, because that
 * is the sidecar's sandbox: inputs are written into `data/processed/_tmp/`,
 * the job names them by project-relative path, and the output is read back and
 * imported through the SAME import path a dropped file uses. No project open
 * therefore means no sidecar engine — stated as such rather than half-tried.
 */

import * as sidecar from "./research/sidecar.js?v=20260903-fae9a8b";
import { toGeoJson } from "./vector-formats.js?v=20260903-fae9a8b";
import { writeGeoTiff } from "./geotiff-writer.js?v=20260903-fae9a8b";

/* ── capability probe ─────────────────────────────────────────────────────── */

let cached = null;
let inflight = null;

/**
 * The capability report, cached for the session.
 *
 * Cached because it describes the machine, not the moment — but the cache is
 * dropped whenever the connection state changes, since connecting to a
 * different sidecar is exactly when the answer changes.
 */
export async function probe({ force = false } = {}) {
  if (!sidecar.isConnected()) return null;
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;
  inflight = sidecar.capabilities()
    .then((report) => { cached = report; inflight = null; return report; })
    .catch(() => { inflight = null; return null; });
  return inflight;
}

/** Forget the probe — the connection changed, so the machine may have too. */
export function invalidate() {
  cached = null;
  inflight = null;
}

if (typeof sidecar.onChange === "function") {
  sidecar.onChange(invalidate);
}

/** The last probe without waiting — null when nothing has been probed yet. */
export function capabilities() {
  return cached;
}

/**
 * Whether a named binary or module is present, from the cached probe.
 * Unknown (never probed) reads as absent: claiming a capability we have not
 * confirmed is the one answer that cannot be recovered from.
 */
export function has(name) {
  if (!cached) return false;
  return Boolean(cached.bins?.[name] || cached.geo?.[name] || cached.python?.[name]);
}

/* ── engine selection ─────────────────────────────────────────────────────── */

/** Cells above which a raster job is worth a round trip through the sidecar. */
const OFFLOAD_CELLS = 4_000_000;
/** Features above which a vector job is. */
const OFFLOAD_FEATURES = 20_000;

/**
 * Is this input big enough that the sidecar would win?
 *
 * The round trip costs a write, a subprocess and a read; below these sizes the
 * native pass has finished before the file is on disk. The numbers are the
 * point where a browser pass stops being interactive (a 2000x2000 raster is
 * ~4 M cells, the NI working grid's order), not a measurement of GDAL.
 */
export function shouldOffload(inputs = {}) {
  return Object.values(inputs).some((layer) => {
    if (!layer) return false;
    if (layer.raster) return layer.raster.width * layer.raster.height > OFFLOAD_CELLS;
    if (layer.collection) return (layer.collection.features?.length || 0) > OFFLOAD_FEATURES;
    return false;
  });
}

/**
 * Can this descriptor's sidecar engine run right now, and if not, why not?
 *
 * Returns {ok} or {ok: false, reason} — the reason is UI text, so it names the
 * thing to install or the step to take rather than reporting a state.
 */
export function engineStatus(desc) {
  const engine = desc?.engines?.sidecar;
  if (!engine) return { ok: false, reason: "This tool has no sidecar engine." };
  if (!sidecar.isConnected()) {
    return { ok: false, reason: "The local sidecar is not connected (Settings ▸ Local Sidecar)." };
  }
  if (!window.GeoIDResearch?.store?.getActive?.()) {
    return { ok: false, reason: "Open a project first — the sidecar works inside the project folder." };
  }
  const missing = (engine.requires || []).filter((name) => !has(name));
  if (missing.length) {
    return {
      ok: false,
      reason: `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not installed on this machine.`,
    };
  }
  return { ok: true };
}

/* ── running a job ────────────────────────────────────────────────────────── */

const TMP_DIR = "data/processed/_tmp";

/** A filename that cannot collide with a sibling run or upset a shell. */
function tmpName(stem, ext) {
  const safe = String(stem).replace(/[^\w.-]/g, "_").slice(0, 60);
  return `${TMP_DIR}/${safe}_${Date.now().toString(36)}.${ext}`;
}

/**
 * Write a layer into the project so the sidecar can see it, and return the
 * project-relative path. Vectors go out as GeoJSON, rasters as GeoTIFF —
 * the same writers the export path uses, so what GDAL reads is exactly what
 * the layer is.
 */
async function stageInput(layer, store) {
  if (layer.raster) {
    const path = tmpName(layer.name || "input", "tif");
    await store.writeProjectFile(path, new Blob([writeGeoTiff(layer.raster)], { type: "image/tiff" }));
    return path;
  }
  if (layer.collection) {
    const path = tmpName(layer.name || "input", "geojson");
    await store.writeProjectFile(path, toGeoJson(layer.collection));
    return path;
  }
  throw new Error(`${layer.name || "layer"} has nothing a sidecar tool could read.`);
}

/**
 * Run a descriptor's sidecar engine end to end and import its output.
 *
 * The engine describes the job — which program or tool, which arguments, what
 * the output is called — and this performs it: stage the inputs, start the
 * job, wait, read the result back through the standard import path. It never
 * throws for a job that merely failed; the caller decides whether to fall back
 * to native, and needs the message to say so.
 */
export async function runSidecarEngine(desc, inputs, params, outputName) {
  const engine = desc.engines.sidecar;
  const store = window.GeoIDResearch?.store;
  const status = engineStatus(desc);
  if (!status.ok) return { ok: false, message: status.reason };

  const staged = {};
  for (const [name, layer] of Object.entries(inputs)) {
    if (layer) staged[name] = await stageInput(layer, store);
  }
  // The engine builds its own request from the staged paths, so a tool that
  // needs three inputs in a particular order says so once, here.
  // `layers` as well as `inputs`: a tool whose contract carries the data in
  // its params (kriging takes the sample points inline) needs the features,
  // not a path to them.
  const request = engine.build({ inputs: staged, layers: inputs, params, outputName, tmpName });
  const outPath = request.output;

  const jobId = request.tool
    ? await sidecar.runToolJob({ ...request, label: desc.label })
    : await sidecar.runGdal({ ...request, label: desc.label });
  const snap = await sidecar.awaitJob(jobId);
  if (snap.status !== "done" || snap.exit_code) {
    return {
      ok: false,
      message: `${desc.label} failed in the sidecar (exit ${snap.exit_code ?? "?"}). `
        + "Open the Jobs drawer for its log.",
    };
  }

  // Back through the ONE import path, so a sidecar result drapes exactly like
  // a dropped file — no second georeferencing path to keep in step.
  const bridge = await import("./research/bridge.js?v=20260903-fae9a8b");
  const layer = await bridge.sendToGlobe(outPath);
  return {
    ok: true,
    message: `${outputName} created by ${request.program || request.tool} in the sidecar.`,
    layer: layer || null,
    outputType: desc.outputType,
    engine: "sidecar",
    path: outPath,
  };
}

if (typeof window !== "undefined") {
  window.GeoIDSidecarClient = { probe, capabilities, has, engineStatus, shouldOffload, invalidate };
}
