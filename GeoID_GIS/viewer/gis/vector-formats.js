import { featureCollection, feature, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260904-0dfb865";

// Readers and writers for the interchange formats a GIS is expected to handle.
// Everything normalises to / from GeoJSON so the toolbox only ever sees one
// feature model.

// ── GeoJSON ─────────────────────────────────────────────────────────────────

export function parseGeoJson(text) {
  const data = JSON.parse(text);
  if (data.type === "FeatureCollection") {
    return featureCollection((data.features || []).filter((f) => f && f.geometry));
  }
  if (data.type === "Feature") {
    return featureCollection([data]);
  }
  if (data.type && data.coordinates) {
    return featureCollection([feature(data, {})]);
  }
  throw new Error("Not a recognised GeoJSON document.");
}

export function toGeoJson(fc) {
  return JSON.stringify(fc, null, 2);
}

// ── WKT ─────────────────────────────────────────────────────────────────────

function parseWktCoordList(text) {
  return text.trim().split(",").map((pair) => {
    const parts = pair.trim().split(/\s+/).map(Number);
    return [parts[0], parts[1]];
  });
}

/** Splits "(a),(b)" into ["a","b"], respecting nesting. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") { depth += 1; if (depth === 1) { current = ""; continue; } }
    if (ch === ")") { depth -= 1; if (depth === 0) { parts.push(current); continue; } }
    if (depth >= 1) current += ch;
  }
  return parts;
}

export function parseWktGeometry(wkt) {
  const trimmed = wkt.trim();
  const match = /^([A-Za-z]+)\s*\((.*)\)$/s.exec(trimmed);
  if (!match) {
    return null;
  }
  const type = match[1].toUpperCase();
  const body = match[2];
  switch (type) {
    case "POINT": {
      const [c] = parseWktCoordList(body);
      return { type: "Point", coordinates: c };
    }
    case "MULTIPOINT":
      return { type: "MultiPoint", coordinates: body.includes("(")
        ? splitTopLevel(body).map((p) => parseWktCoordList(p)[0])
        : parseWktCoordList(body) };
    case "LINESTRING":
      return { type: "LineString", coordinates: parseWktCoordList(body) };
    case "MULTILINESTRING":
      return { type: "MultiLineString", coordinates: splitTopLevel(body).map(parseWktCoordList) };
    case "POLYGON":
      return { type: "Polygon", coordinates: splitTopLevel(body).map(parseWktCoordList) };
    case "MULTIPOLYGON":
      return {
        type: "MultiPolygon",
        coordinates: splitTopLevel(body).map((poly) => splitTopLevel(poly).map(parseWktCoordList)),
      };
    default:
      return null;
  }
}

/** One WKT geometry per non-empty line. */
export function parseWkt(text) {
  const features = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const geometry = parseWktGeometry(trimmed);
    if (geometry) {
      features.push(feature(geometry, { wkt_row: index + 1 }));
    }
  });
  if (!features.length) {
    throw new Error("No WKT geometries found.");
  }
  return featureCollection(features);
}

function coordText(c) {
  return `${c[0]} ${c[1]}`;
}

export function geometryToWkt(geometry) {
  if (!geometry) return "";
  const ring = (r) => `(${r.map(coordText).join(", ")})`;
  switch (geometry.type) {
    case "Point": return `POINT (${coordText(geometry.coordinates)})`;
    case "MultiPoint": return `MULTIPOINT (${geometry.coordinates.map(coordText).join(", ")})`;
    case "LineString": return `LINESTRING ${ring(geometry.coordinates)}`;
    case "MultiLineString": return `MULTILINESTRING (${geometry.coordinates.map(ring).join(", ")})`;
    case "Polygon": return `POLYGON (${geometry.coordinates.map(ring).join(", ")})`;
    case "MultiPolygon":
      return `MULTIPOLYGON (${geometry.coordinates.map((p) => `(${p.map(ring).join(", ")})`).join(", ")})`;
    default: return "";
  }
}

export function toWkt(fc) {
  return fc.features.map((f) => geometryToWkt(f.geometry)).filter(Boolean).join("\n");
}

// ── KML ─────────────────────────────────────────────────────────────────────

function kmlCoords(text) {
  return text.trim().split(/\s+/).filter(Boolean).map((triple) => {
    const [lon, lat] = triple.split(",").map(Number);
    return [lon, lat];
  });
}

function elementText(node, tag) {
  const child = node.getElementsByTagName(tag)[0];
  return child ? child.textContent.trim() : "";
}

export function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("KML is not well-formed XML.");
  }
  const features = [];
  const placemarks = doc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i += 1) {
    const placemark = placemarks[i];
    const properties = {
      name: elementText(placemark, "name"),
      description: elementText(placemark, "description"),
    };
    // ExtendedData carries the real attributes when present.
    const data = placemark.getElementsByTagName("Data");
    for (let d = 0; d < data.length; d += 1) {
      const key = data[d].getAttribute("name");
      if (key) {
        properties[key] = elementText(data[d], "value");
      }
    }
    const addGeometry = (tag, build) => {
      const nodes = placemark.getElementsByTagName(tag);
      for (let n = 0; n < nodes.length; n += 1) {
        const geometry = build(nodes[n]);
        if (geometry) {
          features.push(feature(geometry, properties));
        }
      }
    };
    addGeometry("Point", (node) => {
      const c = kmlCoords(elementText(node, "coordinates"));
      return c.length ? { type: "Point", coordinates: c[0] } : null;
    });
    addGeometry("LineString", (node) => {
      const c = kmlCoords(elementText(node, "coordinates"));
      return c.length >= 2 ? { type: "LineString", coordinates: c } : null;
    });
    addGeometry("Polygon", (node) => {
      const outerNode = node.getElementsByTagName("outerBoundaryIs")[0];
      if (!outerNode) return null;
      const outer = kmlCoords(elementText(outerNode, "coordinates"));
      if (outer.length < 4) return null;
      const holes = [];
      const inner = node.getElementsByTagName("innerBoundaryIs");
      for (let h = 0; h < inner.length; h += 1) {
        const ring = kmlCoords(elementText(inner[h], "coordinates"));
        if (ring.length >= 4) holes.push(ring);
      }
      return { type: "Polygon", coordinates: [outer, ...holes] };
    });
  }
  if (!features.length) {
    throw new Error("No placemarks with geometry were found.");
  }
  return featureCollection(features);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toKml(fc, { name = "GeoID export" } = {}) {
  const placemarks = fc.features.map((f) => {
    const props = f.properties || {};
    const data = Object.entries(props)
      .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`)
      .join("");
    const coordsOf = (coords) => coords.map((c) => `${c[0]},${c[1]},0`).join(" ");
    let geometry = "";
    const g = f.geometry;
    if (!g) return "";
    if (g.type === "Point") {
      geometry = `<Point><coordinates>${coordsOf([g.coordinates])}</coordinates></Point>`;
    } else if (linesOf(g).length) {
      geometry = linesOf(g)
        .map((line) => `<LineString><coordinates>${coordsOf(line)}</coordinates></LineString>`)
        .join("");
    } else if (polygonsOf(g).length) {
      geometry = polygonsOf(g).map((polygon) => {
        const outer = `<outerBoundaryIs><LinearRing><coordinates>${coordsOf(polygon[0])}</coordinates></LinearRing></outerBoundaryIs>`;
        const holes = polygon.slice(1)
          .map((ring) => `<innerBoundaryIs><LinearRing><coordinates>${coordsOf(ring)}</coordinates></LinearRing></innerBoundaryIs>`)
          .join("");
        return `<Polygon>${outer}${holes}</Polygon>`;
      }).join("");
    }
    return `<Placemark><name>${escapeXml(props.name || "")}</name>`
      + `<ExtendedData>${data}</ExtendedData>${geometry}</Placemark>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(name)}</name>\n`
    + `${placemarks}\n</Document></kml>`;
}

// ── GPX ─────────────────────────────────────────────────────────────────────

export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("GPX is not well-formed XML.");
  }
  const features = [];
  const readPoints = (nodes) => {
    const coords = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const lon = Number(nodes[i].getAttribute("lon"));
      const lat = Number(nodes[i].getAttribute("lat"));
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        coords.push([lon, lat]);
      }
    }
    return coords;
  };

  const waypoints = doc.getElementsByTagName("wpt");
  for (let i = 0; i < waypoints.length; i += 1) {
    const coords = readPoints([waypoints[i]]);
    if (coords.length) {
      features.push(feature({ type: "Point", coordinates: coords[0] }, {
        name: elementText(waypoints[i], "name"),
        ele: Number(elementText(waypoints[i], "ele")) || null,
      }));
    }
  }
  ["trkseg", "rte"].forEach((tag) => {
    const segments = doc.getElementsByTagName(tag);
    for (let i = 0; i < segments.length; i += 1) {
      const pointTag = tag === "rte" ? "rtept" : "trkpt";
      const coords = readPoints(segments[i].getElementsByTagName(pointTag));
      if (coords.length >= 2) {
        features.push(feature({ type: "LineString", coordinates: coords }, { source: tag }));
      }
    }
  });
  if (!features.length) {
    throw new Error("No waypoints, routes or tracks were found.");
  }
  return featureCollection(features);
}

// ── CSV export of attributes ────────────────────────────────────────────────

export function toCsv(fc, { includeGeometry = true } = {}) {
  const fields = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))];
  const headers = includeGeometry ? [...fields, "wkt"] : fields;
  const escape = (v) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = fc.features.map((f) => {
    const values = fields.map((field) => escape(f.properties?.[field]));
    if (includeGeometry) {
      values.push(escape(geometryToWkt(f.geometry)));
    }
    return values.join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

/** Points-only CSV with explicit lon/lat columns, for spreadsheet use. */
export function toPointCsv(fc) {
  const fields = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))];
  const escape = (v) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [];
  fc.features.forEach((f) => {
    geometryCoords(f.geometry).forEach((c) => {
      rows.push([c[0], c[1], ...fields.map((field) => escape(f.properties?.[field]))].join(","));
    });
  });
  return [["lon", "lat", ...fields].join(","), ...rows].join("\n");
}

/* ── Writing the delimited point family ──────────────────────────────────── */

/**
 * The columns a point layer COULD be written with, in the order most files
 * want them: the geometry first, then whatever the features carry.
 *
 * `x`, `y` and `z` are pseudo-fields -- they come off the geometry rather than
 * the properties -- and they are named that way because that is what the
 * reader on the other side will ask for. `z` is offered only when some feature
 * actually has a third ordinate or a `z` property, so a 2D survey is not given
 * a column of zeroes to explain.
 */
/**
 * The app's own bookkeeping, which is nobody's data.
 *
 * `data_type` and `data_note` are how a layer is filed in this app; written
 * into somebody's survey file they are a column headed "vector" that means
 * nothing to the next reader and has to be deleted by hand.
 */
const INTERNAL_PROPERTIES = new Set(["data_type", "data_note"]);

export function pointColumnsOf(fc, { exclude = [] } = {}) {
  const features = (fc?.features || []).filter((f) => /Point/.test(f?.geometry?.type || ""));
  const hasZ = features.some((f) => {
    const c = f.geometry.type === "Point" ? f.geometry.coordinates : f.geometry.coordinates?.[0];
    return Number.isFinite(c?.[2]) || Number.isFinite(Number(f.properties?.z));
  });
  /**
   * The columns a delimited import was READ from are dropped, because x, y and
   * z already carry them: a file that came in as `station,lon,lat,depth` was
   * going back out as `x,y,z,station,lon,lat,depth`, with every coordinate
   * written twice under two names. The caller passes those names in; the
   * chooser can still put them back for anyone who wants both.
   */
  const drop = new Set([...exclude, "z"]);
  const props = [...new Set(features.flatMap((f) => Object.keys(f.properties || {})))]
    .filter((k) => !drop.has(k) && !INTERNAL_PROPERTIES.has(k));
  return { geometry: hasZ ? ["x", "y", "z"] : ["x", "y"], properties: props };
}

/** Every point of a Point/MultiPoint collection, as {x, y, z, properties}. */
function pointRecords(fc) {
  const out = [];
  (fc?.features || []).forEach((f) => {
    const g = f?.geometry; if (!g) return;
    const coords = g.type === "Point" ? [g.coordinates]
      : g.type === "MultiPoint" ? g.coordinates : null;
    if (!coords) return;
    coords.forEach((c) => {
      const z = Number.isFinite(c?.[2]) ? c[2]
        : Number.isFinite(Number(f.properties?.z)) ? Number(f.properties.z) : null;
      out.push({ x: c[0], y: c[1], z, properties: f.properties || {} });
    });
  });
  return out;
}

/**
 * A delimited point file -- .xyz, .pts, .txt, or a CSV of columns somebody
 * chose.
 *
 * `columns` is the caller's ordered list, mixing the geometry pseudo-fields
 * with property names, because which column is X is the reader's decision on
 * the way in and has to be the writer's on the way out. The import dialog
 * already asks that question; this is the same question asked in reverse, and
 * a file written with the columns in an order the next reader does not expect
 * is the failure both ends exist to prevent.
 *
 * A header is optional because `.xyz` conventionally has none, and a reader
 * that meets one where it expects numbers skips the row -- so the default
 * follows the delimiter: whitespace means a bare cloud, anything else means a
 * table somebody will open in a spreadsheet.
 */
export function toDelimitedPoints(fc, {
  columns = null, delimiter = " ", header = null, precision = 6,
  exclude = [], geometryOnly = false,
} = {}) {
  const records = pointRecords(fc);
  const cols = columns && columns.length ? columns : (() => {
    const c = pointColumnsOf(fc, { exclude });
    return geometryOnly ? c.geometry : [...c.geometry, ...c.properties];
  })();
  const wantHeader = header === null ? delimiter.trim() !== "" : header;
  const num = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(precision))) : "");
  const quote = (v) => {
    const text = v === null || v === undefined ? "" : String(v);
    if (delimiter.trim() === "") return text.replace(/\s+/g, "_");
    return new RegExp(`["\n\r]|${delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)
      ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const cell = (rec, col) => {
    if (col === "x") return num(rec.x);
    if (col === "y") return num(rec.y);
    if (col === "z") return num(rec.z);
    return quote(rec.properties[col]);
  };
  const lines = records.map((rec) => cols.map((c) => cell(rec, c)).join(delimiter));
  return (wantHeader ? [cols.join(delimiter), ...lines] : lines).join("\n") + "\n";
}

/**
 * Points as a plain JSON array of records, which is not GeoJSON.
 *
 * GeoJSON is already offered and nests the coordinates inside a geometry; a
 * flat `[{x, y, z, ...}]` is what a script, a notebook or a database import
 * actually wants, and it is the shape the delimited readers here produce
 * internally anyway.
 */
export function toPointJson(fc, { columns = null, precision = 6, exclude = [] } = {}) {
  const records = pointRecords(fc);
  const cols = columns && columns.length ? columns : (() => {
    const c = pointColumnsOf(fc, { exclude });
    return [...c.geometry, ...c.properties];
  })();
  const round = (v) => (Number.isFinite(v) ? Number(v.toFixed(precision)) : null);
  const rows = records.map((rec) => {
    const out = {};
    cols.forEach((col) => {
      if (col === "x") out.x = round(rec.x);
      else if (col === "y") out.y = round(rec.y);
      else if (col === "z") out.z = round(rec.z);
      else out[col] = rec.properties[col] ?? null;
    });
    return out;
  });
  return JSON.stringify(rows, null, 2);
}

/**
 * GPX, so a layer can go back to the device it probably came from.
 *
 * Points become waypoints and lines become tracks, which is the mapping every
 * GPS reader expects; polygons have no GPX form and are written as the track
 * of their outer ring rather than silently dropped.
 */
export function toGpx(fc, { name = "GeoID export" } = {}) {
  const esc = (v) => String(v ?? "").replace(/[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
  const nameOf = (f) => f.properties?.name || f.properties?.Name || f.properties?.station || "";
  const parts = [];
  (fc?.features || []).forEach((f) => {
    const g = f?.geometry; if (!g) return;
    const pts = g.type === "Point" ? [g.coordinates]
      : g.type === "MultiPoint" ? g.coordinates : null;
    if (pts) {
      pts.forEach((c) => {
        const ele = Number.isFinite(c?.[2]) ? `<ele>${c[2]}</ele>` : "";
        parts.push(`  <wpt lat="${c[1]}" lon="${c[0]}">${ele}`
          + (nameOf(f) ? `<name>${esc(nameOf(f))}</name>` : "") + "</wpt>");
      });
      return;
    }
    const lines = g.type === "LineString" ? [g.coordinates]
      : g.type === "MultiLineString" ? g.coordinates
        : g.type === "Polygon" ? [g.coordinates[0]]
          : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : null;
    if (!lines) return;
    lines.forEach((line) => {
      const seg = line.map((c) => `      <trkpt lat="${c[1]}" lon="${c[0]}">`
        + (Number.isFinite(c?.[2]) ? `<ele>${c[2]}</ele>` : "") + "</trkpt>").join("\n");
      parts.push(`  <trk>${nameOf(f) ? `<name>${esc(nameOf(f))}</name>` : ""}`
        + `\n    <trkseg>\n${seg}\n    </trkseg>\n  </trk>`);
    });
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<gpx version="1.1" creator="${esc(name)}" xmlns="http://www.topografix.com/GPX/1/1">\n`
    + `${parts.join("\n")}\n</gpx>\n`;
}
