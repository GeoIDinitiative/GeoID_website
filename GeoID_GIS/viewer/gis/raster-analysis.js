import * as G from "./geometry.js?v=20260810-1e77f0e";
import { featureCollection, feature, polygonsOf } from "./geoprocessing.js?v=20260810-1e77f0e";

// Raster analysis equivalents of the QGIS Raster menu / ArcGIS Spatial Analyst
// surface tools. A raster here is { band, width, height, bounds, noData },
// where bounds is {minX, minY, maxX, maxY} in degrees.

export function makeRaster(band, width, height, bounds, noData = null) {
  return { band, width, height, bounds, noData };
}

function valueAt(raster, x, y) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    return null;
  }
  const v = raster.band[y * raster.width + x];
  if (!Number.isFinite(v) || (raster.noData !== null && v === raster.noData)) {
    return null;
  }
  return v;
}

/** Ground size of one cell, in metres, at the raster's centre latitude. */
export function cellSizeMetres(raster) {
  const midLat = (raster.bounds.minY + raster.bounds.maxY) / 2;
  const lonSpanM = (raster.bounds.maxX - raster.bounds.minX) * 111320 * Math.cos(midLat * Math.PI / 180);
  const latSpanM = (raster.bounds.maxY - raster.bounds.minY) * 110574;
  return { x: Math.abs(lonSpanM) / raster.width, y: Math.abs(latSpanM) / raster.height };
}

/**
 * Horn's 3x3 method — the same estimator QGIS and ArcGIS use for slope and
 * aspect, so results are comparable with those tools.
 */
function hornGradient(raster, x, y, cell) {
  const z = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const v = valueAt(raster, x + dx, y + dy);
      if (v === null) {
        return null;
      }
      z.push(v);
    }
  }
  // z indices: 0..8 => a b c / d e f / g h i
  const dzdx = ((z[2] + 2 * z[5] + z[8]) - (z[0] + 2 * z[3] + z[6])) / (8 * cell.x);
  const dzdy = ((z[6] + 2 * z[7] + z[8]) - (z[0] + 2 * z[1] + z[2])) / (8 * cell.y);
  return { dzdx, dzdy };
}

export function slope(raster, { degrees = true } = {}) {
  const cell = cellSizeMetres(raster);
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const g = hornGradient(raster, x, y, cell);
      if (!g) continue;
      const rise = Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy);
      out[y * raster.width + x] = degrees ? Math.atan(rise) * (180 / Math.PI) : rise * 100;
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

/** Aspect in compass degrees (0 = north, clockwise). Flat cells return -1. */
export function aspect(raster) {
  const cell = cellSizeMetres(raster);
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const g = hornGradient(raster, x, y, cell);
      if (!g) continue;
      if (Math.abs(g.dzdx) < 1e-12 && Math.abs(g.dzdy) < 1e-12) {
        out[y * raster.width + x] = -1;
        continue;
      }
      let a = Math.atan2(g.dzdy, -g.dzdx) * (180 / Math.PI);
      a = 90 - a;
      if (a < 0) a += 360;
      if (a >= 360) a -= 360;
      out[y * raster.width + x] = a;
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

export function hillshade(raster, { azimuth = 315, altitude = 45, zFactor = 1 } = {}) {
  const cell = cellSizeMetres(raster);
  const zenith = (90 - altitude) * (Math.PI / 180);
  const azimuthRad = (360 - azimuth + 90) * (Math.PI / 180);
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const g = hornGradient(raster, x, y, cell);
      if (!g) continue;
      const dzdx = g.dzdx * zFactor;
      const dzdy = g.dzdy * zFactor;
      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      let aspectRad = Math.atan2(dzdy, -dzdx);
      if (aspectRad < 0) aspectRad += 2 * Math.PI;
      const value = 255 * ((Math.cos(zenith) * Math.cos(slopeRad))
        + (Math.sin(zenith) * Math.sin(slopeRad) * Math.cos(azimuthRad - aspectRad)));
      out[y * raster.width + x] = Math.max(0, Math.min(255, value));
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

/** Reclassify by [min, max, newValue] rules; unmatched cells become noData. */
export function reclassify(raster, rules) {
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let i = 0; i < raster.band.length; i += 1) {
    const v = raster.band[i];
    if (!Number.isFinite(v) || (raster.noData !== null && v === raster.noData)) {
      continue;
    }
    const rule = rules.find(([min, max]) => v >= min && v <= max);
    if (rule) {
      out[i] = rule[2];
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

/** Cell-wise expression over one or two rasters, e.g. "a - b". */
export function rasterCalculator(rasterA, rasterB, expr) {
  let fn;
  try {
    fn = new Function("a", "b", "Math", `"use strict"; return (${expr});`);
  } catch (error) {
    return { ok: false, message: `Invalid expression: ${error.message}` };
  }
  const { width, height } = rasterA;
  const out = new Float32Array(width * height).fill(NaN);
  for (let i = 0; i < out.length; i += 1) {
    const a = rasterA.band[i];
    const b = rasterB ? rasterB.band[i] : 0;
    if (!Number.isFinite(a) || (rasterB && !Number.isFinite(b))) {
      continue;
    }
    try {
      const v = fn(a, b, Math);
      out[i] = Number.isFinite(v) ? v : NaN;
    } catch (error) {
      /* leave as NaN */
    }
  }
  return { ok: true, raster: makeRaster(out, width, height, rasterA.bounds, NaN) };
}

function cellCentre(raster, x, y) {
  const lon = raster.bounds.minX
    + ((x + 0.5) / raster.width) * (raster.bounds.maxX - raster.bounds.minX);
  const lat = raster.bounds.maxY
    - ((y + 0.5) / raster.height) * (raster.bounds.maxY - raster.bounds.minY);
  return [lon, lat];
}

/** Zonal statistics: summarises raster values inside each polygon feature. */
export function zonalStatistics(raster, zonesFc) {
  const results = [];
  zonesFc.features.forEach((zone) => {
    const polygons = polygonsOf(zone.geometry);
    if (!polygons.length) {
      return;
    }
    // Bounds must cover every ring of every part, not just the first.
    const allCoords = polygons.flat().flat();
    if (!allCoords.length) {
      return;
    }
    const bounds = G.boundsOf(allCoords);
    const values = [];
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        const [lon, lat] = cellCentre(raster, x, y);
        if (lon < bounds.minX || lon > bounds.maxX || lat < bounds.minY || lat > bounds.maxY) {
          continue;
        }
        if (!polygons.some((polygon) => G.pointInPolygon([lon, lat], polygon))) {
          continue;
        }
        const v = valueAt(raster, x, y);
        if (v !== null) {
          values.push(v);
        }
      }
    }
    if (!values.length) {
      // A zone smaller than one cell contains no cell centre. Rather than
      // reporting nothing (the trap in QGIS/ArcGIS zonal statistics), fall back
      // to the value under the zone's centroid and flag it as such.
      const centroid = G.ringCentroid(polygons[0][0]);
      const cx = Math.floor(((centroid[0] - raster.bounds.minX)
        / (raster.bounds.maxX - raster.bounds.minX)) * raster.width);
      const cy = Math.floor(((raster.bounds.maxY - centroid[1])
        / (raster.bounds.maxY - raster.bounds.minY)) * raster.height);
      const v = valueAt(raster, cx, cy);
      if (v === null) {
        results.push({ properties: zone.properties, count: 0 });
        return;
      }
      results.push({
        properties: zone.properties,
        count: 1,
        min: v,
        max: v,
        mean: v,
        sum: v,
        stdDev: 0,
        centroidFallback: true,
      });
      return;
    }
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    results.push({
      properties: zone.properties,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      sum,
      stdDev: Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length),
    });
  });
  return results;
}

/**
 * Marching squares contours. Returns a FeatureCollection of LineStrings, one
 * segment per crossed cell, tagged with the contour level.
 */
export function contours(raster, levels) {
  const features = [];
  const interp = (v1, v2, level) => (level - v1) / ((v2 - v1) || 1e-12);

  levels.forEach((level) => {
    const segments = [];
    for (let y = 0; y < raster.height - 1; y += 1) {
      for (let x = 0; x < raster.width - 1; x += 1) {
        const tl = valueAt(raster, x, y);
        const tr = valueAt(raster, x + 1, y);
        const br = valueAt(raster, x + 1, y + 1);
        const bl = valueAt(raster, x, y + 1);
        if (tl === null || tr === null || br === null || bl === null) {
          continue;
        }
        const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0)
          | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        if (idx === 0 || idx === 15) {
          continue;
        }
        const p = (cx, cy) => cellCentre(raster, cx, cy);
        const top = () => { const t = interp(tl, tr, level); const a = p(x, y); const b = p(x + 1, y); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
        const bottom = () => { const t = interp(bl, br, level); const a = p(x, y + 1); const b = p(x + 1, y + 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
        const left = () => { const t = interp(tl, bl, level); const a = p(x, y); const b = p(x, y + 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
        const right = () => { const t = interp(tr, br, level); const a = p(x + 1, y); const b = p(x + 1, y + 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };

        const cases = {
          1: [[left(), bottom()]], 2: [[bottom(), right()]], 3: [[left(), right()]],
          4: [[top(), right()]], 5: [[left(), top()], [bottom(), right()]],
          6: [[top(), bottom()]], 7: [[left(), top()]], 8: [[left(), top()]],
          9: [[top(), bottom()]], 10: [[left(), bottom()], [top(), right()]],
          11: [[top(), right()]], 12: [[left(), right()]], 13: [[bottom(), right()]],
          14: [[left(), bottom()]],
        };
        (cases[idx] || []).forEach((seg) => segments.push(seg));
      }
    }
    segments.forEach((seg) => {
      features.push(feature({ type: "LineString", coordinates: seg }, { level }));
    });
  });
  return featureCollection(features);
}

/** Raster cells to points, optionally thinned by a step. */
export function rasterToPoints(raster, { step = 1, maxPoints = 200000 } = {}) {
  const features = [];
  for (let y = 0; y < raster.height && features.length < maxPoints; y += step) {
    for (let x = 0; x < raster.width && features.length < maxPoints; x += step) {
      const v = valueAt(raster, x, y);
      if (v === null) continue;
      features.push(feature({ type: "Point", coordinates: cellCentre(raster, x, y) }, { value: v }));
    }
  }
  return featureCollection(features);
}

/** Masks a raster to a polygon, setting outside cells to noData. */
export function clipRasterByPolygon(raster, zonesFc) {
  const polygons = zonesFc.features.flatMap((f) => polygonsOf(f.geometry));
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const [lon, lat] = cellCentre(raster, x, y);
      if (!polygons.some((polygon) => G.pointInPolygon([lon, lat], polygon))) {
        continue;
      }
      const v = valueAt(raster, x, y);
      if (v !== null) {
        out[y * raster.width + x] = v;
      }
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

export function rasterStatistics(raster) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < raster.band.length; i += 1) {
    const v = raster.band[i];
    if (!Number.isFinite(v) || (raster.noData !== null && v === raster.noData)) {
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count += 1;
  }
  if (!count) {
    return { count: 0 };
  }
  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < raster.band.length; i += 1) {
    const v = raster.band[i];
    if (!Number.isFinite(v) || (raster.noData !== null && v === raster.noData)) continue;
    variance += (v - mean) ** 2;
  }
  return { count, min, max, mean, sum, stdDev: Math.sqrt(variance / count) };
}
