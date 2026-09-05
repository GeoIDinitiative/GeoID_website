import { computeBounds2D } from "./geo-utils.js?v=20260905-15e1ef6";

// Sampling a polygon on a lat/lon grid: the spacing is expressed in km and
// converted per-row, because a degree of longitude shrinks toward the poles.
import {
  clip as clipCollection, featureCollection, feature as makeFeature,
} from "./geoprocessing.js?v=20260905-15e1ef6";
import { splitLine } from "./delimited.js?v=20260905-15e1ef6";

const KM_PER_DEG_LAT = 111.32;
const MAX_SAMPLES = 250000;

function normalizeLon(lon) {
  return lon > 180 ? lon - 360 : lon;
}

/**
 * Ray-casting point-in-polygon over [{lat, lon}] vertices, done in lon/lat
 * space. The viewer's own pointInProjectedPolygon is preferred when available
 * so extraction agrees exactly with what the drawn polygon displays.
 */
function pointInPolygon(lat, lon, vertices, center) {
  const viewerFn = typeof window === "undefined"
    ? null : window.GeoIDViewer?.pointInProjectedPolygon;
  if (typeof viewerFn === "function" && center) {
    return viewerFn({ lat, lon }, vertices, center);
  }
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const xi = normalizeLon(vertices[i].lon);
    const yi = vertices[i].lat;
    const xj = normalizeLon(vertices[j].lon);
    const yj = vertices[j].lat;
    if (((yi > lat) !== (yj > lat))
      && (normalizeLon(lon) < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonBounds(vertices) {
  const flat = new Float64Array(vertices.length * 2);
  vertices.forEach((vertex, index) => {
    flat[index * 2] = normalizeLon(vertex.lon);
    flat[index * 2 + 1] = vertex.lat;
  });
  return computeBounds2D(flat);
}

function flattenAttributes(prefix, attributes, row) {
  if (!attributes || typeof attributes !== "object") {
    return;
  }
  Object.keys(attributes).forEach((key) => {
    const value = attributes[key];
    row[`${prefix}_${key}`] = value === null || value === undefined ? "" : value;
  });
}

/**
 * Samples every requested layer on a grid inside the polygon.
 *
 * Sources are the GeoID basemap itself (DEM elevation, slope, geology) plus any
 * imported layer exposing a sampler, so a drawn polygon yields one table that
 * combines built-in and user-imported data.
 */
/**
 * The BOUNDS as rings, from either shape a caller holds.
 *
 * The drawn overlay is one ring of {lat, lon}; a workspace polygon LAYER is a
 * GeoJSON collection whose features may be Multi and may carry holes. Both
 * normalise here to [{ vertices, holes, center }], which is what lets "within
 * any polygon" mean any polygon — including a dissolved multi-part study
 * area — rather than only the shape the Draw tool happens to be holding.
 */
export function ringsFromCollection(collection) {
  const rings = [];
  (collection?.features || []).forEach((f) => {
    const geom = f?.geometry;
    if (!geom) return;
    const polys = geom.type === "Polygon" ? [geom.coordinates]
      : geom.type === "MultiPolygon" ? geom.coordinates : [];
    polys.forEach((poly) => {
      if (!poly?.[0]?.length) return;
      const vertices = poly[0].map(([lon, lat]) => ({ lat, lon }));
      const centerLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
      const centerLon = vertices.reduce((s, v) => s + v.lon, 0) / vertices.length;
      rings.push({
        vertices,
        holes: poly.slice(1).map((h) => h.map(([lon, lat]) => ({ lat, lon }))),
        center: { lat: centerLat, lon: centerLon },
      });
    });
  });
  return rings;
}

export function pointInAnyRing(lat, lon, rings) {
  return rings.some((ring) => pointInPolygon(lat, lon, ring.vertices, ring.center)
    && !(ring.holes || []).some((hole) => pointInPolygon(lat, lon, hole, ring.center)));
}

/* ── Native resolution ────────────────────────────────────────────────────
 *
 * Extraction resampled EVERY layer onto one uniform grid whose spacing the
 * user typed, which is the right answer for a joined table and the wrong one
 * for the question "what does this dataset actually say here". A 30 m GeoTIFF
 * read at 500 m throws away 99.6% of what it holds; a global Earth Engine
 * snapshot read at 500 m invents 6,000 samples out of a single pixel. Both
 * come back looking equally authoritative.
 *
 * So a layer states the grid it actually has, and extraction can work on THAT.
 * Nothing here is declared -- each answer is read from what the layer really
 * carries, because a declared resolution is the thing that has been wrong
 * every time it has been trusted in this tree.
 */

/**
 * The grid a layer actually holds, or null where it has none.
 *
 * Three shapes, in the order of how much they know:
 *   - a RASTER layer (GeoTIFF, .asc, any tool output) IS its grid;
 *   - an Earth Engine drape carries the delivered image and its bounds, and
 *     the delivered pixel is not the dataset's native scale — a cached global
 *     snapshot is 1024 px for the whole world, 39 km a pixel, whatever the
 *     archive holds. That is exactly why this is measured from the image in
 *     hand rather than read off the catalogue entry;
 *   - a VECTOR has no resolution at all, and says so by returning null:
 *     features are clipped exactly, never sampled.
 */
export function nativeGridOf(layer) {
  if (!layer) return null;
  const metres = (bounds, width) => {
    const span = Math.abs(Number(bounds.maxX) - Number(bounds.minX));
    const midLat = (Number(bounds.minY) + Number(bounds.maxY)) / 2;
    if (!Number.isFinite(span) || !Number.isFinite(midLat) || !width) return null;
    return ((span / 360) * 40075017 * Math.cos((midLat * Math.PI) / 180)) / width;
  };
  if (layer.raster?.width && layer.raster?.bounds) {
    const { width, height, bounds } = layer.raster;
    return { width, height, bounds, metresPerPixel: metres(bounds, width), source: "raster" };
  }
  const image = layer.object3D?.userData?.geeImage;
  const bounds = layer.bounds || layer.info?.bounds;
  const width = image?.naturalWidth || image?.width;
  const height = image?.naturalHeight || image?.height;
  if (width && height && bounds && Number.isFinite(Number(bounds.minX))) {
    return { width, height, bounds, metresPerPixel: metres(bounds, width), source: "image" };
  }
  return null;
}

/**
 * One row per NATIVE CELL of this layer whose centre falls inside the polygon.
 *
 * Walked over the polygon's own bounding box in the layer's grid indices, not
 * over the layer -- a global drape is millions of cells and a study area is a
 * handful of them, and iterating the layer to find the handful is the
 * difference between an answer and a hung tab.
 *
 * Where the polygon is smaller than one cell the answer is ONE ROW, or none,
 * and that is the honest reading: it is what the dataset knows about this
 * ground. Padding it out to a grid somebody typed is how a single pixel comes
 * to look like a survey.
 */
export function extractNative({ rings, layer, max = MAX_SAMPLES }) {
  const grid = nativeGridOf(layer);
  if (!grid) {
    return { ok: false, message: `"${layer?.name}" has no grid of its own — a vector layer `
      + "is clipped exactly rather than sampled.", rows: [] };
  }
  const read = layer.sampler || null;
  const band = layer.raster?.band || null;
  if (!read && !band) {
    return { ok: false, message: `"${layer?.name}" cannot be read for values.`, rows: [] };
  }
  const allRings = rings && rings.length ? rings : null;
  if (!allRings) return { ok: false, message: "Draw an area polygon first.", rows: [] };

  const per = allRings.map((r) => polygonBounds(r.vertices));
  const box = {
    minX: Math.min(...per.map((b) => b.minX)), maxX: Math.max(...per.map((b) => b.maxX)),
    minY: Math.min(...per.map((b) => b.minY)), maxY: Math.max(...per.map((b) => b.maxY)),
  };
  const { width, height, bounds } = grid;
  const spanX = Number(bounds.maxX) - Number(bounds.minX);
  const spanY = Number(bounds.maxY) - Number(bounds.minY);
  // Cell centres, and the index window the polygon's box covers.
  const colOf = (lon) => Math.floor(((lon - bounds.minX) / spanX) * width);
  const rowOf = (lat) => Math.floor(((bounds.maxY - lat) / spanY) * height);
  const x0 = Math.max(0, colOf(box.minX) - 1);
  const x1 = Math.min(width - 1, colOf(box.maxX) + 1);
  const y0 = Math.max(0, rowOf(box.maxY) - 1);
  const y1 = Math.min(height - 1, rowOf(box.minY) + 1);
  if (x1 < x0 || y1 < y0) {
    return { ok: false, message: `"${layer.name}" does not cover that area.`, rows: [] };
  }

  const rows = [];
  let truncated = false;
  for (let y = y0; y <= y1 && !truncated; y += 1) {
    const lat = bounds.maxY - ((y + 0.5) / height) * spanY;
    for (let x = x0; x <= x1; x += 1) {
      const lon = bounds.minX + ((x + 0.5) / width) * spanX;
      if (!pointInAnyRing(lat, lon, allRings)) continue;
      if (rows.length >= max) { truncated = true; break; }
      const value = band ? band[y * width + x] : read(lat, lon);
      rows.push({
        lat: Number(lat.toFixed(6)),
        lon: Number(normalizeLon(lon).toFixed(6)),
        value: Number.isFinite(value) ? value : null,
      });
    }
  }
  const withValue = rows.filter((r) => r.value !== null).length;
  return {
    ok: true,
    rows,
    grid,
    truncated,
    message: `${rows.length} native cells (${withValue} with a value) at `
      + `${grid.metresPerPixel ? Math.round(grid.metresPerPixel) + " m" : "unknown"} per cell`
      + (truncated ? ` — capped at ${max}` : "") + ".",
  };
}

/** Features with their bounding boxes, for a cheap point test per sample. */
function buildGeologyIndex(features) {
  if (!Array.isArray(features) || !features.length) return null;
  const out = [];
  features.forEach((f) => {
    const parts = f?.geometry?.type === "MultiPolygon" ? f.geometry.coordinates
      : (f?.geometry?.type === "Polygon" ? [f.geometry.coordinates] : null);
    if (!parts) return;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    parts.forEach((rings) => rings[0].forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }));
    const name = f.properties?.name || f.properties?.lith || f.properties?.rock_type || "";
    if (!name) return;
    out.push({ parts, minX, minY, maxX, maxY, name });
  });
  return out.length ? out : null;
}

/** The named unit under a point, or null where there is no index to read. */
function geologyAt(lat, lon, index) {
  if (!index) return null;
  for (const entry of index) {
    if (lon < entry.minX || lon > entry.maxX || lat < entry.minY || lat > entry.maxY) continue;
    for (const rings of entry.parts) {
      if (!ringHas(rings[0], lat, lon)) continue;
      const inHole = rings.slice(1).some((hole) => ringHas(hole, lat, lon));
      if (!inHole) return entry.name;
    }
  }
  return "";
}

/** Ray casting over a GeoJSON [lon, lat] ring. */
function ringHas(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]; const yi = ring[i][1];
    const xj = ring[j][0]; const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function extractPolygonSamples({
  vertices,
  center,
  rings = null,
  stepKm = 1,
  includeBuiltIn = true,
  includeGeology = false,
  includeClimate = false,
  /**
   * The features to read the geology column FROM.
   *
   * The viewer's `getGeologyFeatureAtLatLon` answers from the map it currently
   * has DRAWN, which is right for a click on the globe and wrong for an
   * extraction: measured with the camera over Indonesia and a study area over
   * Northern Ireland, the column came back empty for every one of 7,567
   * samples while the clip beside it returned real units. Given the features
   * covering the polygon — the same ones the vector clip uses — the column and
   * the clipped layer cannot disagree, because they are one source of truth.
   */
  geologyFeatures = null,
  layers = [],
} = {}) {
  // One ring or many: the single-ring call is the multi-ring call with one.
  const allRings = rings && rings.length ? rings
    : (Array.isArray(vertices) && vertices.length >= 3
      ? [{ vertices, holes: [], center }] : null);
  if (!allRings) {
    return { ok: false, message: "Draw an area polygon first.", rows: [] };
  }

  const viewer = window.GeoIDViewer;
  const perRing = allRings.map((r) => polygonBounds(r.vertices));
  const bounds = {
    minX: Math.min(...perRing.map((b) => b.minX)),
    maxX: Math.max(...perRing.map((b) => b.maxX)),
    minY: Math.min(...perRing.map((b) => b.minY)),
    maxY: Math.max(...perRing.map((b) => b.maxY)),
  };
  // A kilometre is not a degree anywhere except Earth: sized on this body's
  // own radius, or a 0.5 km step on Mars quietly becomes 0.27 km and the
  // grid claims a resolution it does not have.
  const kmPerDegLat = viewer?.bodyRadiusKm
    ? (Math.PI * viewer.bodyRadiusKm) / 180 : KM_PER_DEG_LAT;
  const stepLat = Math.max(stepKm, 0.001) / kmPerDegLat;

  // Bounding boxes once, so the per-sample test rejects almost everything by
  // four comparisons rather than by walking rings.
  const geologyIndex = buildGeologyIndex(geologyFeatures);

  const rows = [];
  let truncated = false;

  for (let lat = bounds.minY; lat <= bounds.maxY + stepLat * 0.5; lat += stepLat) {
    // Longitude spacing widens toward the poles to keep ground spacing even.
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const stepLon = stepLat / cosLat;
    for (let lon = bounds.minX; lon <= bounds.maxX + stepLon * 0.5; lon += stepLon) {
      if (!pointInAnyRing(lat, lon, allRings)) {
        continue;
      }
      if (rows.length >= MAX_SAMPLES) {
        truncated = true;
        break;
      }
      const row = { lat_deg: +lat.toFixed(6), lon_deg: +normalizeLon(lon).toFixed(6) };

      if (includeBuiltIn && viewer) {
        // The viewer's DEM is indexed 0-360 east.
        const lon360 = ((lon % 360) + 360) % 360;
        const elevation = viewer.sampleElevationMeters?.(lat, lon360);
        row.geoid_elevation_m = Number.isFinite(elevation) ? +elevation.toFixed(2) : "";
        const slope = viewer.estimateSurfaceSlopeDegrees?.(lat, lon360);
        row.geoid_slope_deg = Number.isFinite(slope) ? +slope.toFixed(3) : "";
        if (includeGeology) {
          const named = geologyAt(lat, normalizeLon(lon), geologyIndex);
          if (named !== null) {
            row.geoid_geology = named;
          } else {
            const feature = viewer.getGeologyFeatureAtLatLon?.(lat, lon360);
            row.geoid_geology = feature?.rock_type || feature?.name || "";
          }
        }
      }

      if (includeClimate && viewer?.sampleEnvironment) {
        // Prefixed `geoid_`, and each already carries `model_` from the viewer:
        // these are analytic estimates from latitude and elevation, and must not
        // read like a reading beside a column that is one.
        const environment = viewer.sampleEnvironment(lat, ((lon % 360) + 360) % 360);
        Object.keys(environment).forEach((key) => {
          row[`geoid_${key}`] = environment[key];
        });
      }

      layers.forEach((layer) => {
        if (!layer.sampler) {
          return;
        }
        const value = layer.sampler(lat, normalizeLon(lon));
        // A layer may name its own column — a GEE drape does, so a rainfall
        // reading arrives as `Rainfall_CHIRPS_mm` rather than as the layer's
        // display name with its date range and "(cached)" welded on.
        const key = layer.info?.column
          || layer.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9]+/g, "_");
        if (value !== null && typeof value === "object") {
          flattenAttributes(key, value, row);
        } else {
          row[key] = Number.isFinite(value) ? +value.toFixed(3) : "";
        }
      });

      rows.push(row);
    }
    if (truncated) {
      break;
    }
  }

  if (!rows.length) {
    return {
      ok: false,
      message: "No sample points fell inside the polygon. Try a finer spacing.",
      rows: [],
    };
  }

  return {
    ok: true,
    rows,
    truncated,
    areaKm2: allRings.length === 1
      ? (viewer?.sphericalPolygonAreaKm2?.(allRings[0].vertices) ?? null)
      : (allRings.reduce((sum, r) => sum
        + (viewer?.sphericalPolygonAreaKm2?.(r.vertices) || 0), 0) || null),
    message: `${rows.length.toLocaleString()} samples${truncated ? " (truncated)" : ""}`,
  };
}

/* ── Vector and point-cloud extraction within the same bounds ────────────── */

/**
 * A mask collection from rings, for the clip path. Signed longitudes, since
 * that is what every workspace collection speaks.
 */
export function maskFromRings(rings) {
  return featureCollection(rings.map((ring) => makeFeature({
    type: "Polygon",
    coordinates: [
      ring.vertices.map((v) => [normalizeLon(v.lon), v.lat]),
      ...(ring.holes || []).map((h) => h.map((v) => [normalizeLon(v.lon), v.lat])),
    ].map((r) => (r.length && (r[0][0] !== r[r.length - 1][0]
      || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r)),
  }, {})));
}

/**
 * Every feature of a vector layer that falls WITHIN the mask — points
 * filtered by containment, lines and polygons genuinely CLIPPED at the
 * boundary (geoprocessing's clip, which cuts lines now rather than keeping
 * or dropping them whole).
 *
 * `fields` narrows each feature's properties to the ticked columns; null
 * keeps everything. Geometry always survives — an attribute tick list must
 * never be able to strip the shape off a shapefile.
 */
export function extractVectorWithin(collection, maskFc, { fields = null } = {}) {
  const total = collection?.features?.length || 0;
  const clipped = clipCollection(collection || featureCollection([]), maskFc);
  const narrowed = !fields ? clipped.features
    : clipped.features.map((f) => makeFeature(f.geometry,
      Object.fromEntries(Object.entries(f.properties || {})
        .filter(([key]) => fields.includes(key)))));
  return {
    ok: true,
    collection: featureCollection(narrowed),
    kept: narrowed.length,
    total,
  };
}

/** Vector features as table rows: lat/lon (point, else centroid) + fields. */
export function vectorRows(collection) {
  return (collection?.features || []).map((f) => {
    const geom = f.geometry || {};
    let lat = "";
    let lon = "";
    if (geom.type === "Point") {
      [lon, lat] = geom.coordinates;
    } else {
      const coords = [];
      const walk = (c) => (Array.isArray(c?.[0]) ? c.forEach(walk) : coords.push(c));
      walk(geom.coordinates || []);
      if (coords.length) {
        lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      }
    }
    return {
      lat_deg: Number.isFinite(lat) ? +lat.toFixed(6) : "",
      lon_deg: Number.isFinite(lon) ? +lon.toFixed(6) : "",
      geometry_type: geom.type || "",
      ...(f.properties || {}),
    };
  });
}

/**
 * The column names of a delimited source, by the SAME rule the extractor
 * uses — the panel's tick list and the extract must agree on what a column
 * is called, or a ticked name matches nothing.
 */
export function delimitedColumns(source) {
  const text = String(source?.text || "");
  if (!text) return [];
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!first) return [];
  const cells = splitLine(first, source.delimiter || ",");
  return source.hasHeader !== false ? cells : cells.map((_, i) => `column_${i + 1}`);
}

/**
 * The rows of a delimited point cloud (a CSV/XYZ that kept its source text)
 * that fall within the rings, with only the ticked columns.
 *
 * This is the path that makes a POINT CLOUD extractable at all: the renderer
 * kept x, y, z and a magnitude, but the file kept everything, and the file
 * is what this reads. Lat and lon ride along always — a spatial extract
 * whose rows cannot be placed is a spreadsheet, not an extract.
 */
export function extractDelimitedWithin(source, rings, { columns = null } = {}) {
  const text = String(source?.text || "");
  if (!text) return { ok: false, message: "This layer kept no source table.", rows: [] };
  const delimiter = source.delimiter || ",";
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const cells = lines.map((l) => splitLine(l, delimiter));
  const header = source.hasHeader !== false;
  const names = header ? cells[0] : cells[0].map((_, i) => `column_${i + 1}`);
  const body = header ? cells.slice(1) : cells;
  const lonIdx = source.mapping?.lon ?? source.mapping?.lonIndex ?? 0;
  const latIdx = source.mapping?.lat ?? source.mapping?.latIndex ?? 1;
  const picked = columns
    ? names.map((n, i) => ({ n, i })).filter(({ n, i }) =>
      columns.includes(n) || i === lonIdx || i === latIdx)
    : names.map((n, i) => ({ n, i }));
  const rows = [];
  body.forEach((row) => {
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!pointInAnyRing(lat, lon, rings)) return;
    const out = {};
    picked.forEach(({ n, i }) => { out[n] = row[i] ?? ""; });
    rows.push(out);
  });
  return {
    ok: true,
    rows,
    columns: picked.map(({ n }) => n),
    latName: names[latIdx],
    lonName: names[lonIdx],
    total: body.length,
    message: `${rows.length.toLocaleString()} of ${body.length.toLocaleString()} rows inside`,
  };
}

/** Union of keys across rows, since layers contribute different columns. */
function collectColumns(rows) {
  const columns = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    });
  });
  return columns;
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows) {
  const columns = collectColumns(rows);
  const lines = [columns.join(",")];
  rows.forEach((row) => {
    lines.push(columns.map((column) => escapeCsv(row[column])).join(","));
  });
  return lines.join("\n");
}

export function rowsToGeoJson(rows) {
  return JSON.stringify({
    type: "FeatureCollection",
    features: rows.map((row) => {
      const { lat_deg: lat, lon_deg: lon, ...properties } = row;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties,
      };
    }),
  });
}

export function downloadText(filename, text, mime = "text/plain", { project = true } = {}) {
  // With a project open the result belongs to it, not to the downloads folder.
  // Still downloaded as well, so the button does what it says either way.
  //
  // `project: false` opts out of the filing, for callers that file the same
  // bytes somewhere more specific themselves -- the studio's .msh export goes
  // to meshes/ via saveMesh, and letting this also write exports/ would put
  // the identical mesh in the registry twice under two kinds.
  if (project) {
    try {
      void window.GeoIDResearch?.bridge?.saveExport?.(filename, text);
    } catch (error) {
      /* no project open, or it declined -- the download below still happens */
    }
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
