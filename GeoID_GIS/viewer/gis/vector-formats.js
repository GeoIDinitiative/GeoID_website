import { featureCollection, feature, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260808-5ab803b";

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
