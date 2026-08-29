import { computeBounds2D } from "./geo-utils.js?v=20260829-ffffb8a";

// Sampling a polygon on a lat/lon grid: the spacing is expressed in km and
// converted per-row, because a degree of longitude shrinks toward the poles.
import {
  clip as clipCollection, featureCollection, feature as makeFeature,
} from "./geoprocessing.js?v=20260829-ffffb8a";
import { splitLine } from "./delimited.js?v=20260829-ffffb8a";

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

export function extractPolygonSamples({
  vertices,
  center,
  rings = null,
  stepKm = 1,
  includeBuiltIn = true,
  includeGeology = false,
  includeClimate = false,
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
          const feature = viewer.getGeologyFeatureAtLatLon?.(lat, lon360);
          row.geoid_geology = feature?.rock_type || feature?.name || "";
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
