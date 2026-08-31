/**
 * A polygon you drew is a layer.
 *
 * The Draw tool handed its shape to the viewer's `activateStudyArea`, which
 * kept it in viewer state — so the one piece of geometry the user made by hand
 * was the one piece the layer list did not carry. It could not be clipped,
 * buffered, sampled, symbolised, exported or restored, and no tool's input
 * select had ever heard of it.
 *
 * Registering it as an ordinary vector layer costs one call and buys all of
 * those at once, because everything downstream already works on layers. The
 * study area is still set: an area is both a place you are working and a shape
 * you can operate on, and it should not have to be captured twice.
 */

import { buildVectorLayerResult } from "./vector-render.js?v=20260831-b365f88";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260831-b365f88";

let counter = 0;

/**
 * The name the next drawn shape will take.
 *
 * Exported on the seam because the VIEWER writes it too: the annotation
 * inside the polygon names the shape while it is still being drawn, and a
 * label that predicts a different name from the one the layer ends up with
 * is two names for one thing — the fault `renameLayer` in import-manager.js
 * documents at length.
 */
export function nextDrawnName() {
  return `Study area ${counter + 1}`;
}

/**
 * On THIS body's radius, which is not Earth's anywhere but Earth.
 *
 * `sphericalPolygonAreaKm2` defaults to the Earth mean radius, and this call
 * did not override it — so every shape drawn on a planet recorded an area
 * scaled by (R_earth / R_body)^2: measured, a 4x3 degree box near Olympus
 * Mons reported 140,689 km2 against a true 39,826, exactly the 3.533 that
 * ratio predicts. On the Moon it would be 13.4x. The number rides on the
 * layer as `area_km2`, so it reached the annotation, the exports and the
 * project registry alike.
 *
 * area-labels.js already took its km-per-degree from `bodyRadiusKm` for the
 * live label — this is the SECOND area computation, and only the first had
 * been made per-body. Same shape as the polygon-area formula in ten files:
 * when a body constant is fixed in one place, grep for the others.
 */
function areaOf(ring) {
  try {
    // No radius passed on purpose: sphericalPolygonAreaKm2 defaults to THIS
    // body's, which is the only mechanism, so a fifth caller cannot be added
    // wrong the way the first four were.
    const km2 = sphericalPolygonAreaKm2(ring.map(([lon, lat]) => ({ lat, lon })));
    return Number.isFinite(km2) ? Number(km2.toFixed(3)) : null;
  } catch (error) {
    return null;
  }
}

/** The Draw tool's current geometry as a GeoJSON polygon feature. */
export function drawnFeature(geometry, options) {
  // Explicit null is a real caller, not a missing argument, and a default
  // parameter does not cover it — destructuring null throws.
  const { name = null, kind = "drawn" } = options || {};
  const vertices = geometry?.vertices;
  if (!Array.isArray(vertices) || vertices.length < 3) return null;
  const ring = vertices.map((v) => {
    let lon = Number(v.lon ?? v.longitude);
    const lat = Number(v.lat ?? v.latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // The viewer carries east-positive 0..360; a file means signed.
    if (lon > 180) lon -= 360;
    return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  }).filter(Boolean);
  if (ring.length < 3) return null;
  // A GeoJSON ring closes on itself; the drawn one does not.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return {
    type: "Feature",
    properties: {
      name: name || nextDrawnName(),
      kind,
      vertices: ring.length - 1,
      // Computed from the ring rather than read off the draw tool: the study
      // geometry does not always carry an area, and a layer whose attribute is
      // sometimes null is a layer nobody can chart or sort by.
      area_km2: areaOf(ring),
      drawn_at: null,          // stamped by the caller, which has a clock
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/**
 * Put whatever the Draw tool is currently holding into the layer list.
 *
 * Returns the layer, or null with a reason. Idempotent by shape: drawing the
 * same box twice would otherwise stack two identical layers, and the second
 * teaches the user nothing.
 */
export function captureDrawn({ name = null, stampedAt = null } = {}) {
  const viewer = window.GeoIDViewer;
  const geometry = viewer?.getExtractionGeometry?.("study")
    || viewer?.getExtractionGeometry?.("buffer");
  if (!geometry) return { ok: false, message: "Draw an area first — the Draw tool, or the box preset." };
  const feature = drawnFeature(geometry, { name });
  if (!feature) return { ok: false, message: "That shape has too few points to be a polygon." };
  feature.properties.drawn_at = stampedAt || new Date().toISOString();

  const signature = JSON.stringify(feature.geometry.coordinates);
  const existing = (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.ext === "drawn" && l.collection
      && JSON.stringify(l.collection.features?.[0]?.geometry?.coordinates) === signature);
  if (existing) return { ok: true, layer: existing, message: `That area is already a layer (${existing.name}).` };

  counter += 1;
  const layerName = feature.properties.name;
  const fc = { type: "FeatureCollection", features: [feature] };
  /**
   * OUTLINE, not fill — you drew this box to look at what is inside it.
   *
   * A solid polygon over a study area hides the ground it was drawn around,
   * which is the opposite of what it is for. A geological unit wants a fill
   * because the fill IS the statement; an extent wants an edge. The symbology
   * dialog switches it, and that choice survives every later recolour because
   * the mode lives on the layer rather than on a paint call.
   */
  const built = buildVectorLayerResult(fc, { name: layerName, outlineOnly: true });
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(layerName, built, "drawn");
  if (!layer) return { ok: false, message: "The layer could not be added — is the globe ready?" };
  // A shape somebody drew is their own input: it keeps an editable
  // classification, where a dataset the app defines does not.
  layer.userInput = true;
  // Same rule as every tool's output: it is a layer AND it is offered to the
  // project. A shape you drew and then lost with the tab is not a record.
  void (async () => {
    try {
      const bridge = await import(`./research/bridge.js${new URL(import.meta.url).search}`);
      const json = JSON.stringify(fc);
      await bridge.saveProcessed(`${layerName.replace(/\s+/g, "_").toLowerCase()}.geojson`,
        json,
        { mime: "application/geo+json", provenance: { tool: "draw", inputs: [] } });
      // And into the DATA REGISTRY with a data/raw copy: a drawn shape is a
      // dataset the pipeline can pick up — model definition, clipping,
      // extraction — not only a processed artefact in a folder.
      await bridge.registerImportedLayer(layer,
        new File([json], `${layerName.replace(/\s+/g, "_").toLowerCase()}.geojson`,
          { type: "application/geo+json" }));
    } catch (error) {
      /* never fail the draw because the project is closed */
    }
  })();

  return {
    ok: true,
    layer,
    message: `${layerName} added — every tool can take it as input now.`,
  };
}

/**
 * A transect is a layer too, and it cannot go through the path above.
 *
 * `drawnFeature` builds a Polygon and demands three points, which is right for
 * every closed shape and wrong for a line: a two-point transect has no interior,
 * so there is no study area to set and nothing to sample across. Closing it into
 * a ring instead would double it back on itself and report a length twice what
 * was asked for. So a line skips `setStudyAreaPolygon` entirely and becomes an
 * ordinary LineString layer -- which `vector-render.js` already draws, splitting
 * long spans the same way, and which every tool can take as input.
 */
export function captureDrawnLine(vertices, { name = null, stampedAt = null } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 2) {
    return { ok: false, message: "A line needs two points." };
  }
  const path = vertices.map((v) => {
    let lon = Number(v.lon);
    const lat = Number(v.lat);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // Same conversion the polygon path makes, and for the same reason: the
    // viewer carries east-positive 0..360 and a file means signed.
    if (lon > 180) lon -= 360;
    return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  }).filter(Boolean);
  if (path.length < 2) return { ok: false, message: "That line has no usable points." };

  counter += 1;
  const layerName = name || `Transect ${counter}`;
  const feature = {
    type: "Feature",
    properties: {
      name: layerName,
      kind: "drawn",
      vertices: path.length,
      drawn_at: stampedAt || new Date().toISOString(),
    },
    geometry: { type: "LineString", coordinates: path },
  };
  const fc = { type: "FeatureCollection", features: [feature] };
  const built = buildVectorLayerResult(fc, { name: layerName });
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(layerName, built, "drawn");
  if (!layer) return { ok: false, message: "The layer could not be added — is the globe ready?" };
  // Offered to the project on the same terms as every other tool output, and
  // never allowed to fail the draw when the project is closed.
  void (async () => {
    try {
      const { saveProcessed } = await import(`./research/bridge.js${new URL(import.meta.url).search}`);
      await saveProcessed(`${layerName.replace(/\s+/g, "_").toLowerCase()}.geojson`,
        JSON.stringify(fc),
        { mime: "application/geo+json", provenance: { tool: "draw", inputs: [] } });
    } catch (error) {
      /* never fail the draw because the project is closed */
    }
  })();
  return { ok: true, layer, message: `${layerName} added as a line layer.` };
}

if (typeof window !== "undefined") {
  window.GeoIDDrawnLayers = { captureDrawn, captureDrawnLine, drawnFeature, nextDrawnName };
}
