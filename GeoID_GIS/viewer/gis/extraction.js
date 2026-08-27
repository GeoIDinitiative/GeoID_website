import { computeBounds2D } from "./geo-utils.js?v=20260827-d109bf1";

// Sampling a polygon on a lat/lon grid: the spacing is expressed in km and
// converted per-row, because a degree of longitude shrinks toward the poles.
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
  const viewerFn = window.GeoIDViewer?.pointInProjectedPolygon;
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
export function extractPolygonSamples({
  vertices,
  center,
  stepKm = 1,
  includeBuiltIn = true,
  includeGeology = false,
  includeClimate = false,
  layers = [],
} = {}) {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    return { ok: false, message: "Draw an area polygon first.", rows: [] };
  }

  const viewer = window.GeoIDViewer;
  const bounds = polygonBounds(vertices);
  const stepLat = Math.max(stepKm, 0.001) / KM_PER_DEG_LAT;

  const rows = [];
  let truncated = false;

  for (let lat = bounds.minY; lat <= bounds.maxY + stepLat * 0.5; lat += stepLat) {
    // Longitude spacing widens toward the poles to keep ground spacing even.
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const stepLon = stepLat / cosLat;
    for (let lon = bounds.minX; lon <= bounds.maxX + stepLon * 0.5; lon += stepLon) {
      if (!pointInPolygon(lat, lon, vertices, center)) {
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
    areaKm2: viewer?.sphericalPolygonAreaKm2?.(vertices) ?? null,
    message: `${rows.length.toLocaleString()} samples${truncated ? " (truncated)" : ""}`,
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
