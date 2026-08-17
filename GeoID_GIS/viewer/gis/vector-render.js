import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic } from "./geo-utils.js?v=20260817-2497cbf";
import { collectionBounds, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260817-2497cbf";
import { categoricalSymbology, suggestCategoryField } from "./symbology.js?v=20260817-2497cbf";

// Single renderer for every vector source. Each parser produces a GeoJSON
// FeatureCollection and this turns it into draped globe geometry, so shapefile,
// GeoJSON, KML, GPX, WKT and any derived analysis layer look and behave alike.

const MAX_LINE_VERTICES = 6000000;

/**
 * A point on the globe's own displaced surface, plus clearance.
 *
 * Not radius + offset: the basemap is displaced by the relief, and at the
 * default setting its surface spans 3.2095 to 3.2989 while a flat 3.2 + 0.006
 * sits at 3.206 -- under the terrain everywhere, ocean included. Draped that
 * way a coastline was in the scene, visible, correctly georeferenced, and
 * drawing exactly nothing, because the planet was in front of it.
 */
function surfaceAt(lat, lon, drape) {
  const surfacePoint = window.GeoIDViewer?.surfacePoint;
  return surfacePoint
    ? surfacePoint(lat, lon, drape)
    : latLonToVector3(lat, lon, drapedRadius(drape));
}

// A straight line between two points on a sphere is a chord, and a chord sags
// below the surface. Across 12 degrees of arc -- ordinary for a coarse boundary
// polygon -- it sags 0.0175, nearly three times the clearance the geometry is
// lifted by, so the segment dives through the planet and is hidden for most of
// its length. Splitting long spans keeps the sag far under the clearance: at
// one degree it is 0.0001 against 0.006.
//
// The split is linear in longitude and latitude, which is also what a shapefile
// edge means -- straight in the coordinate space it was authored in, not a
// great circle -- so densifying draws the geometry more correctly, not less.
const MAX_SEGMENT_DEG = 1;
const MAX_SEGMENT_SPLITS = 512;

function pushSegment(target, a, b, drape) {
  const steps = Math.min(
    MAX_SEGMENT_SPLITS,
    Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / MAX_SEGMENT_DEG)),
  );
  let previous = surfaceAt(a[1], a[0], drape);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const next = surfaceAt(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t, drape);
    target.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
    previous = next;
  }
}

/**
 * Triangulate one polygon (outer ring plus holes) in lon/lat, then lift each
 * vertex to the globe.
 *
 * three.js's own `ShapeUtils.triangulateShape` handles holes, which matters
 * for geology more than anywhere: a formation with an inlier of something else
 * is a ring with a ring inside it, and filling the outer one alone paints over
 * the unit that is actually there.
 */
function fillTriangles(polygon, drape, out, colour) {
  const outer = polygon[0];
  if (!outer || outer.length < 4) return;
  const toV2 = (ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y));
  const contour = toV2(outer);
  const holes = polygon.slice(1).map(toV2).filter((h) => h.length >= 3);
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch (error) {
    return;                          // a self-touching ring is not worth a crash
  }
  const all = [...contour, ...holes.flat()];
  faces.forEach((face) => {
    face.forEach((index) => {
      const v = all[index];
      if (!v) return;
      const p = surfaceAt(v.y, v.x, drape);
      out.positions.push(p.x, p.y, p.z);
      out.colours.push(colour.r, colour.g, colour.b);
    });
  });
}

export function renderFeatureCollection(fc, {
  name = "vector",
  lineColor = 0x8ef6c4,
  pointColor = 0xffd166,
  drape = 0.006,
  pointSize = 0.018,
  // A function of the feature returning a CSS colour. With one, every feature
  // is drawn in its own colour and polygons are filled — which is the whole
  // difference between "there are polygons here" and a geological map.
  colourFor = null,
  fillOpacity = 0.55,
} = {}) {
  const linePositions = [];
  const lineColours = [];
  const pointPositions = [];
  const fill = { positions: [], colours: [] };
  const scratch = new THREE.Color();
  let truncated = false;

  fc.features.forEach((feature) => {
    if (linePositions.length >= MAX_LINE_VERTICES) {
      truncated = true;
      return;
    }
    const geometry = feature.geometry;
    if (!geometry) {
      return;
    }
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      geometryCoords(geometry).forEach((c) => {
        const v = surfaceAt(c[1], c[0], drape);
        pointPositions.push(v.x, v.y, v.z);
      });
      return;
    }
    // Polygon rings are drawn as closed boundaries; lines as-is.
    const polygons = polygonsOf(geometry);
    const rings = polygons.flat();
    const lines = linesOf(geometry);
    let colour = null;
    if (colourFor) {
      // A feature with no value in the chosen field still gets a colour — the
      // neutral grey the legend shows for it. Leaving it out desynchronised
      // the colour array from the position array by exactly that feature's
      // vertices, the lengths stopped matching, and the whole layer silently
      // fell back to one colour for its outlines while the fills were right.
      const css = colourFor(feature) || "#8a8a8a";
      scratch.set(css);
      colour = { r: scratch.r, g: scratch.g, b: scratch.b };
    }
    if (colour) polygons.forEach((polygon) => fillTriangles(polygon, drape, fill, colour));
    [...rings, ...lines].forEach((coords) => {
      const before = linePositions.length;
      for (let i = 0; i + 1 < coords.length; i += 1) {
        pushSegment(linePositions, coords[i], coords[i + 1], drape);
      }
      if (colour) {
        // One colour entry per position, added after the fact because
        // pushSegment splits long spans and only it knows how many it made.
        for (let i = before; i < linePositions.length; i += 3) {
          lineColours.push(colour.r, colour.g, colour.b);
        }
      }
    });
  });

  const group = new THREE.Group();
  group.name = name;

  if (fill.positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fill.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(fill.colours, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: fillOpacity,
      // Same rule the drapes follow: a flat facet cannot win on depth against
      // displaced terrain, so it does not compete — it is drawn over, and
      // single-sided so the far hemisphere is still culled.
      depthTest: false, depthWrite: false, side: THREE.FrontSide,
    }));
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  if (linePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const material = { transparent: true, opacity: 0.9, depthWrite: false };
    if (lineColours.length === linePositions.length) {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColours, 3));
      material.vertexColors = true;
    } else {
      material.color = lineColor;
    }
    const segments = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(material));
    segments.renderOrder = 2;
    group.add(segments);
  }
  if (pointPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
    group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      color: pointColor, size: pointSize, sizeAttenuation: true, depthWrite: false,
    })));
  }

  return { object3D: group, truncated };
}

/** Counts geometry kinds, for the layer list summary. */
export function describeCollection(fc) {
  const counts = { point: 0, line: 0, polygon: 0 };
  fc.features.forEach((f) => {
    const type = f.geometry?.type || "";
    if (type.includes("Point")) counts.point += 1;
    else if (type.includes("LineString")) counts.line += 1;
    else if (type.includes("Polygon")) counts.polygon += 1;
  });
  return counts;
}

/**
 * Wraps a FeatureCollection into the shape the import manager expects,
 * including an attribute sampler so it can take part in extraction.
 */
/**
 * A polygon layer is DRAWN as polygons, from the moment it lands.
 *
 * Rendering boundaries and nothing else made every vector layer look the same:
 * geology, catchments and a coastline were all the same green outline, and the
 * only way to see a geological map was to find the symbology panel and apply a
 * classification by hand. A map that requires a second step before it is a map
 * is not one.
 *
 * So the default symbology is computed at import — the rock-type column if the
 * layer has one, otherwise the best category field, otherwise a single wash —
 * and can be changed afterwards exactly as before. The legend is built from
 * the same object, so it agrees from the first frame.
 */
function defaultSymbology(fc) {
  const features = fc?.features || [];
  const hasPolygons = features.some((f) => polygonsOf(f.geometry).length);
  if (!hasPolygons) return null;
  const field = suggestCategoryField(features);
  if (field) {
    const sym = categoricalSymbology(features, field, { ramp: "spectral" });
    if (sym.ok) return sym;
  }
  // No attribute worth classifying: one colour, still filled, so the extent of
  // the thing is visible rather than only its edge.
  return {
    ok: true, categorical: false, field: null,
    rows: [{ value: "features", count: features.length, colour: "#4fd1a5" }],
    colourOf: () => "#4fd1a5",
  };
}

export function buildVectorLayerResult(fc, { name, fields = [], drape = 0.006 } = {}) {
  const bounds = collectionBounds(fc);
  const georeferenced = looksLikeGeographic(bounds);
  const symbology = defaultSymbology(fc);
  // Outlines first, fills straight after — NOT both in one pass.
  //
  // Filling means triangulating every ring and lifting every triangle vertex
  // onto the displaced surface, and doing that inside the import blocked it:
  // measured on the BGS bedrock layer, the import did not complete in five
  // minutes where it used to take seconds. The geometry is the same either
  // way; what changes is that the layer is on the globe immediately and gains
  // its colours a moment later, instead of the user waiting for both.
  const { object3D, truncated } = renderFeatureCollection(fc, { name, drape });

  /**
   * Redraw this layer with a colour per feature.
   *
   * The children are replaced inside the SAME group, so the layer keeps its
   * place in the scene, its parent's spin frame and its entry in the stack —
   * re-rendering into a new group would drop it out of the globe's frame and
   * leave it a fixed distance from a turning planet.
   */
  const repaintVector = (colourFor) => {
    const next = renderFeatureCollection(fc, { name, drape, colourFor });
    [...object3D.children].forEach((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      object3D.remove(child);
    });
    [...next.object3D.children].forEach((child) => object3D.add(child));
    return object3D.children.length > 0;
  };
  const counts = describeCollection(fc);

  const polygonIndex = fc.features
    .map((f) => ({ polygons: polygonsOf(f.geometry), properties: f.properties }))
    .filter((entry) => entry.polygons.length)
    .map((entry) => {
      const coords = entry.polygons.flat().flat();
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      coords.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      return { ...entry, bbox: { minX, minY, maxX, maxY } };
    });

  // Scheduled rather than awaited: `addDerivedLayer` puts `object3D` into the
  // scene as soon as this returns, and repaint replaces the children of that
  // same group, so the fills land in a layer that is already visible.
  if (symbology) {
    setTimeout(() => {
      try { repaintVector((f) => symbology.colourOf(f)); } catch (error) { /* outlines stand */ }
    }, 0);
  }

  return {
    object3D,
    repaint: repaintVector,
    // The legend is derived from the symbology that was actually drawn, never
    // from a second guess about it.
    legendInfo: symbology?.rows?.length
      ? {
        palette: symbology.rows.map((r) => r.colour.replace("#", "")),
        labels: symbology.rows.map((r) => r.value),
        categorical: Boolean(symbology.categorical),
        field: symbology.field || null,
      }
      : null,
    georeferenced,
    bounds: georeferenced ? bounds : null,
    collection: fc,
    features: fc.features,
    sampler: polygonIndex.length
      ? (lat, lon) => {
        const x = lon > 180 ? lon - 360 : lon;
        for (let i = 0; i < polygonIndex.length; i += 1) {
          const entry = polygonIndex[i];
          const b = entry.bbox;
          if (x < b.minX || x > b.maxX || lat < b.minY || lat > b.maxY) continue;
          const inside = entry.polygons.some((polygon) => {
            const ring = polygon[0];
            let hit = false;
            for (let a = 0, c = ring.length - 1; a < ring.length; c = a, a += 1) {
              const [xi, yi] = ring[a];
              const [xj, yj] = ring[c];
              if (((yi > lat) !== (yj > lat))
                && (x < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-15) + xi)) {
                hit = !hit;
              }
            }
            return hit;
          });
          if (inside) return entry.properties;
        }
        return null;
      }
      : null,
    info: {
      featureCount: fc.features.length,
      points: counts.point,
      lines: counts.line,
      polygons: counts.polygon,
      fields: fields.length
        ? fields
        : [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))],
      sampleable: polygonIndex.length > 0,
      valueKind: "attributes",
      truncated,
    },
  };
}
