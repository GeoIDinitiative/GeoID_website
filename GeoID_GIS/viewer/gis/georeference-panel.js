/**
 * Place an image on the globe: pick the file, say where its corners are (or
 * give control points), press once.
 *
 * The corners path is what most people want and is exact for a north-up
 * picture. The control-point path exists because a scan is rarely north-up,
 * and because residuals are the only way to know whether a registration is
 * good — so they are shown per point, in metres, rather than replaced by a
 * success message.
 */

import {
  solveAffine, transformFromBounds, boundsFromTransform, drapeWarning, imageToBands,
} from "./georeference.js?v=20260829-d3cc9f6";
import { parsePoints } from "./point-extract.js?v=20260829-d3cc9f6";

function byId(id) { return document.getElementById(id); }
const state = { file: null };

function status(text) {
  const node = byId("gis-geo-status");
  if (node) node.textContent = text;
}

/**
 * Control points are typed as `x y lat lon`, one per line — the same shape the
 * point list uses, with the pixel pair in front, so a user learns one format.
 */
function parseControlPoints(text) {
  const points = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const n = line.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
    if (n.length < 4) { errors.push(`line ${i + 1}: needs x y lat lon`); return; }
    points.push({ x: n[0], y: n[1], lat: n[2], lon: n[3] });
  });
  return { points, errors };
}

async function place() {
  if (!state.file) { status("Choose an image first."); return; }
  status("Reading the image…");
  let decoded;
  try {
    decoded = await imageToBands(state.file);
  } catch (error) {
    status(error.message);
    return;
  }
  const mode = byId("gis-geo-mode")?.value || "corners";
  let bounds = null;
  let warning = null;

  if (mode === "corners") {
    const num = (id) => Number(byId(id)?.value);
    const north = num("gis-geo-north");
    const south = num("gis-geo-south");
    const west = num("gis-geo-west");
    const east = num("gis-geo-east");
    if (![north, south, west, east].every(Number.isFinite)) {
      status("Fill in all four edges."); return;
    }
    if (north <= south || east <= west) {
      status("North must be above south and east right of west."); return;
    }
    bounds = { minX: west, minY: south, maxX: east, maxY: north };
  } else {
    const { points, errors } = parseControlPoints(byId("gis-geo-points")?.value || "");
    const fit = solveAffine(points);
    if (!fit.ok) { status(`${fit.message}${errors.length ? ` (${errors[0]})` : ""}`); return; }
    // The pixel coordinates are the ORIGINAL image's; the bands were decoded
    // at a capped size, so the transform has to be expressed in the decoded
    // grid or the picture lands scaled by however much the cap shrank it.
    const scale = decoded.width / decoded.sourceWidth;
    const scaled = {
      ...fit.coefficients,
      a: fit.coefficients.a / scale, b: fit.coefficients.b / scale,
      d: fit.coefficients.d / scale, e: fit.coefficients.e / scale,
    };
    bounds = boundsFromTransform(scaled, decoded.width, decoded.height);
    warning = drapeWarning(fit);
    const rows = fit.residuals
      .map((r) => `  (${r.x}, ${r.y}) off by ${r.errorM.toFixed(1)} m`).join("\n");
    const report = byId("gis-geo-report");
    if (report) {
      report.textContent = `RMS ${fit.rmsMetres} m over ${fit.points} points, `
        + `rotation ${fit.rotationDeg}°, skew ${fit.skewDeg}°\n${rows}`;
    }
  }

  status("Placing…");
  try {
    const stamp = new URL(import.meta.url).search;
    const adapter = await import(`./geotiff-adapter.js${stamp}`);
    const built = adapter.buildRasterLayer(
      decoded.bands, decoded.width, decoded.height, bounds,
      { name: state.file.name, isDem: false });
    // addDerivedLayer(name, result, ext) — positional, not an options object.
    // Passing one object made `result.object3D` undefined and the call
    // returned null, which reads as "the image failed to decode".
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      state.file.name, built, "image");
    // One output rule: a tool that makes a layer also offers it to the project,
    // with what it was made from. Georeferencing wrote nothing at all, so a
    // placed image survived only as long as the tab did.
    if (layer) {
      try {
        const { saveProcessed } = await import(`./research/bridge.js${new URL(import.meta.url).search}`);
        await saveProcessed(`${state.file.name.replace(/\.[a-z]+$/i, "")}.geojson`,
          JSON.stringify({
            type: "Feature",
            properties: { source: state.file.name, placed_by: mode, warning: warning || null },
            geometry: {
              type: "Polygon",
              coordinates: [[[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
                [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY], [bounds.minX, bounds.minY]]],
            },
          }),
          { mime: "application/geo+json", provenance: { tool: "georeference", inputs: [state.file.name] } });
      } catch (error) {
        /* a closed or unwritable project must never fail the placement */
      }
    }
    status(layer
      ? `${state.file.name} placed over ${bounds.minY.toFixed(3)}–${bounds.maxY.toFixed(3)}°N, `
        + `${bounds.minX.toFixed(3)}–${bounds.maxX.toFixed(3)}°E.${warning ? ` ${warning}` : ""}`
      : "The layer could not be added.");
  } catch (error) {
    status(`Placing failed: ${error.message}`);
  }
}

export function init() {
  const file = byId("gis-geo-file");
  if (!file) return;
  file.addEventListener("change", (e) => {
    state.file = e.target.files?.[0] || null;
    status(state.file ? `${state.file.name} ready — say where it goes.` : "Choose an image.");
  });
  byId("gis-geo-mode")?.addEventListener("change", (e) => {
    const points = e.target.value === "points";
    const cornersRow = byId("gis-geo-corners");
    const pointsRow = byId("gis-geo-points-row");
    if (cornersRow) cornersRow.hidden = points;
    if (pointsRow) pointsRow.hidden = !points;
  });
  byId("gis-geo-place")?.addEventListener("click", () => { void place(); });
}

if (typeof window !== "undefined") {
  window.GeoIDGeoreferencePanel = { init, parseControlPoints };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
