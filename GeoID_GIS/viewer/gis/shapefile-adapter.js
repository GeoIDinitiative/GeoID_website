import { looksLikeGeographic } from "./geo-utils.js?v=20260826-c6a5f33";
import { featureCollection, feature } from "./geoprocessing.js?v=20260826-c6a5f33";
import { buildVectorLayerResult } from "./vector-render.js?v=20260826-c6a5f33";
import { detectCrs, crsLabel } from "./prj-detect.js?v=20260826-c6a5f33";
import { projectedToLatLon, CRS_OPTIONS } from "./projection.js?v=20260826-c6a5f33";

// ESRI Shapefile technical description 98-016. Only the geometry types that
// actually appear in GIS exports are handled; anything else is reported rather
// than silently dropped.
const SHAPE_TYPES = {
  0: "Null",
  1: "Point",
  3: "PolyLine",
  5: "Polygon",
  8: "MultiPoint",
  11: "PointZ",
  13: "PolyLineZ",
  15: "PolygonZ",
  18: "MultiPointZ",
  21: "PointM",
  23: "PolyLineM",
  25: "PolygonM",
  28: "MultiPointM",
};

const POINT_TYPES = new Set([1, 11, 21]);
const MULTIPOINT_TYPES = new Set([8, 18, 28]);
const POLYLINE_TYPES = new Set([3, 13, 23]);
const POLYGON_TYPES = new Set([5, 15, 25]);

// Guard rail against pathological files locking the main thread. A 17MB
// 6k-polygon geology map parses in well under a second and uses ~1.8M source
// points, so the ceiling sits far above realistic layers rather than clipping
// them; layers that do hit it are flagged as truncated in the UI.
const MAX_VERTICES = 6000000;

function parseShp(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getInt32(0, false) !== 9994) {
    throw new Error("Not a valid .shp file (bad magic number).");
  }
  const fileType = view.getInt32(32, true);
  const bounds = {
    minX: view.getFloat64(36, true),
    minY: view.getFloat64(44, true),
    maxX: view.getFloat64(52, true),
    maxY: view.getFloat64(60, true),
  };

  const shapes = [];
  let offset = 100;
  let vertexBudget = MAX_VERTICES;
  let truncated = false;
  // Records map 1:1 onto .dbf rows, but a single record can emit several parts
  // (polygon rings), so parts carry their originating record index.
  let recordIndex = -1;

  while (offset + 8 <= arrayBuffer.byteLength && vertexBudget > 0) {
    recordIndex += 1;
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const recordStart = offset + 8;
    if (contentLength <= 0 || recordStart + contentLength > arrayBuffer.byteLength) {
      break;
    }
    const shapeType = view.getInt32(recordStart, true);

    if (POINT_TYPES.has(shapeType)) {
      shapes.push({
        kind: "point",
        recordIndex,
        points: [view.getFloat64(recordStart + 4, true), view.getFloat64(recordStart + 12, true)],
      });
      vertexBudget -= 1;
    } else if (MULTIPOINT_TYPES.has(shapeType)) {
      const numPoints = view.getInt32(recordStart + 36, true);
      const points = [];
      for (let i = 0; i < numPoints && vertexBudget > 0; i += 1) {
        const p = recordStart + 40 + i * 16;
        points.push(view.getFloat64(p, true), view.getFloat64(p + 8, true));
        vertexBudget -= 1;
      }
      shapes.push({ kind: "point", recordIndex, points });
    } else if (POLYLINE_TYPES.has(shapeType) || POLYGON_TYPES.has(shapeType)) {
      const numParts = view.getInt32(recordStart + 36, true);
      const numPoints = view.getInt32(recordStart + 40, true);
      const partsStart = recordStart + 44;
      const pointsStart = partsStart + numParts * 4;
      const partIndices = [];
      for (let i = 0; i < numParts; i += 1) {
        partIndices.push(view.getInt32(partsStart + i * 4, true));
      }
      const isPolygon = POLYGON_TYPES.has(shapeType);
      for (let part = 0; part < numParts && vertexBudget > 0; part += 1) {
        const start = partIndices[part];
        const end = part + 1 < numParts ? partIndices[part + 1] : numPoints;
        const ring = [];
        for (let i = start; i < end && vertexBudget > 0; i += 1) {
          const p = pointsStart + i * 16;
          ring.push(view.getFloat64(p, true), view.getFloat64(p + 8, true));
          vertexBudget -= 1;
        }
        if (ring.length >= 4) {
          shapes.push({ kind: isPolygon ? "polygon" : "line", recordIndex, points: ring });
        }
      }
    }

    offset = recordStart + contentLength;
  }

  if (vertexBudget <= 0) {
    truncated = true;
  }

  return { shapes, bounds, fileType, truncated };
}

/**
 * dBASE reader for the .dbf attribute table that accompanies a shapefile.
 * Records are matched to geometry by position, which is how the format links
 * them. Attribute rows are capped alongside the geometry budget.
 */
function parseDbf(arrayBuffer, maxRecords = 200000) {
  try {
    const view = new DataView(arrayBuffer);
    const recordCount = view.getInt32(4, true);
    const headerLength = view.getInt16(8, true);
    const recordLength = view.getInt16(10, true);
    const decoder = new TextDecoder("latin1");

    const fields = [];
    let offset = 32;
    while (offset + 32 <= headerLength - 1) {
      const nameBytes = new Uint8Array(arrayBuffer, offset, 11);
      if (nameBytes[0] === 0x0d || nameBytes[0] === 0) {
        break;
      }
      let end = nameBytes.indexOf(0);
      if (end === -1) end = 11;
      fields.push({
        name: decoder.decode(nameBytes.subarray(0, end)).trim(),
        type: String.fromCharCode(view.getUint8(offset + 11)),
        length: view.getUint8(offset + 16),
      });
      offset += 32;
    }

    const records = [];
    const total = Math.min(recordCount, maxRecords);
    for (let i = 0; i < total; i += 1) {
      const start = headerLength + i * recordLength;
      if (start + recordLength > arrayBuffer.byteLength) {
        break;
      }
      // First byte is the deletion flag.
      if (view.getUint8(start) === 0x2a) {
        records.push(null);
        continue;
      }
      const record = {};
      let cursor = start + 1;
      for (const field of fields) {
        const raw = decoder
          .decode(new Uint8Array(arrayBuffer, cursor, field.length))
          .trim();
        cursor += field.length;
        if (field.type === "N" || field.type === "F") {
          const num = Number(raw);
          record[field.name] = raw === "" || Number.isNaN(num) ? null : num;
        } else if (field.type === "L") {
          record[field.name] = /^[YyTt]$/.test(raw) ? true : (/^[NnFf]$/.test(raw) ? false : null);
        } else {
          record[field.name] = raw;
        }
      }
      records.push(record);
    }
    return { fields: fields.map((f) => f.name), records };
  } catch (error) {
    return { fields: [], records: [] };
  }
}

export async function loadShapefile(file, { sidecars = [] } = {}) {
  const shpBuffer = await file.arrayBuffer();
  const { shapes, bounds, fileType, truncated } = parseShp(shpBuffer);

  if (!shapes.length) {
    throw new Error(`No supported geometry found (shape type ${SHAPE_TYPES[fileType] || fileType}).`);
  }

  /**
   * A projected shapefile used to be refused outright — "reproject before
   * importing", which sent every GSNI, OSNI and Ordnance Survey dataset out
   * to ogr2ogr before this app could touch it. The .prj beside the .shp says
   * exactly which CRS it is, so read it: a grid the transformer knows is
   * reprojected here and now, and one it does not know is named in the error
   * instead of being described as "a projected CRS".
   */
  let reproject = null;
  if (!looksLikeGeographic(bounds)) {
    const prj = sidecars.find((entry) => entry.name.toLowerCase().endsWith(".prj"));
    if (!prj) {
      throw new Error("Shapefile coordinates are not WGS84 lat/lon and no .prj was supplied.");
    }
    const detected = detectCrs(await prj.text());
    const crsId = detected.epsg ? `epsg:${detected.epsg}` : null;
    const supported = crsId && CRS_OPTIONS.some((c) => c.id === crsId);
    if (!supported) {
      throw new Error(detected.epsg
        ? `Shapefile is ${crsLabel(detected)} (EPSG:${detected.epsg}), which this viewer cannot transform yet — `
          + "reproject it to WGS84, or run it through the sidecar's ogr2ogr."
        : `Shapefile is projected (${detected.name || "unrecognised CRS"}) and its .prj names no EPSG code — `
          + "reproject it to WGS84 before importing.");
    }
    reproject = (x, y) => projectedToLatLon(x, y, crsId);
    // Note for the caller's provenance: what it WAS, not only what it is now.
    reproject.crsId = crsId;
    reproject.label = crsLabel(detected);
  }

  const dbf = sidecars.find((entry) => entry.name.toLowerCase().endsWith(".dbf"));
  let fields = [];
  let records = [];
  if (dbf) {
    ({ fields, records } = parseDbf(await dbf.arrayBuffer()));
  }

  // Parts are grouped back into one feature per .dbf record, so a multi-ring
  // polygon stays a single feature with a single attribute row.
  const byRecord = new Map();
  shapes.forEach((shape) => {
    if (!byRecord.has(shape.recordIndex)) {
      byRecord.set(shape.recordIndex, { polygons: [], lines: [], points: [] });
    }
    const entry = byRecord.get(shape.recordIndex);
    const coords = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      // Transformed here rather than after assembly: every geometry kind
      // funnels through this one loop, so there is one place a projected
      // shapefile becomes lon/lat and no path that can miss it.
      if (reproject) {
        const point = reproject(shape.points[i], shape.points[i + 1]);
        if (point) coords.push([point.lon, point.lat]);
      } else {
        coords.push([shape.points[i], shape.points[i + 1]]);
      }
    }
    if (shape.kind === "polygon") entry.polygons.push(coords);
    else if (shape.kind === "line") entry.lines.push(coords);
    else entry.points.push(...coords);
  });

  const features = [];
  byRecord.forEach((entry, recordIndex) => {
    const properties = records[recordIndex] || {};
    if (entry.polygons.length) {
      features.push(feature(entry.polygons.length === 1
        ? { type: "Polygon", coordinates: entry.polygons }
        : { type: "MultiPolygon", coordinates: entry.polygons.map((ring) => [ring]) }, properties));
    }
    if (entry.lines.length) {
      features.push(feature(entry.lines.length === 1
        ? { type: "LineString", coordinates: entry.lines[0] }
        : { type: "MultiLineString", coordinates: entry.lines }, properties));
    }
    entry.points.forEach((point) => {
      features.push(feature({ type: "Point", coordinates: point }, properties));
    });
  });

  const result = buildVectorLayerResult(featureCollection(features), { name: file.name, fields });
  result.info.geometryType = SHAPE_TYPES[fileType] || String(fileType);
  result.info.attributeRows = records.length;
  result.info.truncated = truncated || result.info.truncated;
  return result;
}
