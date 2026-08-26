import * as G from "./geometry.js?v=20260826-820cd84";
import { featureCollection, feature, polygonsOf } from "./geoprocessing.js?v=20260826-820cd84";

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

/**
 * Curvature (Zevenbergen & Thorne 1987, the ArcGIS convention): −100·(z_xx +
 * z_yy), positive over ridges/convexities, negative in hollows. Second
 * derivatives from the 3×3 window with each axis using its own metre cell
 * size — a degree of longitude is not a degree of latitude, and mixing them
 * skews curvature east–west.
 */
export function curvature(raster) {
  const cell = cellSizeMetres(raster);
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const z5 = valueAt(raster, x, y);
      const z4 = valueAt(raster, x - 1, y);
      const z6 = valueAt(raster, x + 1, y);
      const z2 = valueAt(raster, x, y - 1);
      const z8 = valueAt(raster, x, y + 1);
      if (z5 === null || z4 === null || z6 === null || z2 === null || z8 === null) continue;
      const d = ((z4 + z6) / 2 - z5) / (cell.x * cell.x);
      const e = ((z2 + z8) / 2 - z5) / (cell.y * cell.y);
      out[y * raster.width + x] = -200 * (d + e);
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

/**
 * Roughness, GDAL's definition: the largest absolute difference between a
 * cell and any of its 8 neighbours. Flat ground reads 0 in the units of the
 * band; a scarp reads its own local relief.
 */
export function roughness(raster) {
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const centre = valueAt(raster, x, y);
      if (centre === null) continue;
      let worst = null;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const v = valueAt(raster, x + dx, y + dy);
          if (v === null) continue;
          const diff = Math.abs(v - centre);
          if (worst === null || diff > worst) worst = diff;
        }
      }
      if (worst !== null) out[y * raster.width + x] = worst;
    }
  }
  return makeRaster(out, raster.width, raster.height, raster.bounds, NaN);
}

/**
 * Focal statistics over a square (2r+1)² window — QGIS's r.neighbors /
 * ArcGIS Focal Statistics. NoData cells are excluded from the window, never
 * averaged in as zero; a cell with no valid neighbour at all stays noData.
 */
export function focalStatistics(raster, { radius = 1, stat = "mean" } = {}) {
  const r = Math.max(1, Math.round(radius));
  const out = new Float32Array(raster.width * raster.height).fill(NaN);
  const values = [];
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      values.length = 0;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const v = valueAt(raster, x + dx, y + dy);
          if (v !== null) values.push(v);
        }
      }
      if (!values.length) continue;
      let result;
      if (stat === "min") result = Math.min(...values);
      else if (stat === "max") result = Math.max(...values);
      else if (stat === "sum") result = values.reduce((a, b) => a + b, 0);
      else if (stat === "range") result = Math.max(...values) - Math.min(...values);
      else if (stat === "std") {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        result = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
      } else {
        result = values.reduce((a, b) => a + b, 0) / values.length;
      }
      out[y * raster.width + x] = result;
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
 * Chain loose segments into polylines by shared endpoints.
 *
 * Marching squares emits one segment per crossed cell, and a contour is a
 * *line* — so unstitched output is unusable for anything past drawing: it
 * cannot be labelled, measured, simplified or exported as a contour, and a
 * modest DEM yields tens of thousands of two-point features.
 *
 * Endpoints are quantised to a grid before hashing. Neighbouring cells compute
 * the shared crossing from the same two corner values, so the coordinates
 * agree to the last bit in principle — but they arrive through different
 * arithmetic, and an exact-equality join silently leaves every chain in
 * pieces. The tolerance is a fraction of a cell, far below any real spacing.
 */
function stitchSegments(segments, cellSize) {
  const quantum = Math.max(cellSize * 1e-6, 1e-12);
  const key = (p) => `${Math.round(p[0] / quantum)},${Math.round(p[1] / quantum)}`;
  // Every endpoint to the segments that touch it.
  const ends = new Map();
  const push = (k, index) => {
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push(index);
  };
  segments.forEach((seg, i) => { push(key(seg[0]), i); push(key(seg[1]), i); });

  const used = new Array(segments.length).fill(false);
  const lines = [];
  // Walk from one end of a segment until the chain runs out, then the other,
  // so an open contour is built whichever segment of it is picked up first.
  const extend = (line, fromKey, atStart) => {
    let k = fromKey;
    for (;;) {
      const next = (ends.get(k) || []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = true;
      const [a, b] = segments[next];
      const forward = key(a) === k;
      const tip = forward ? b : a;
      if (atStart) line.unshift(tip); else line.push(tip);
      k = key(tip);
    }
  };
  segments.forEach((seg, i) => {
    if (used[i]) return;
    used[i] = true;
    const line = [seg[0], seg[1]];
    extend(line, key(seg[1]), false);
    extend(line, key(seg[0]), true);
    lines.push(line);
  });
  return lines;
}

/**
 * Marching squares contours, stitched into polylines and tagged with `level`.
 *
 * Closed contours come back with their first and last point equal, which is
 * how a caller tells a loop from an open line running off the raster edge.
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
    const cellSize = Math.abs(raster.bounds.maxX - raster.bounds.minX) / (raster.width || 1);
    stitchSegments(segments, cellSize).forEach((line) => {
      if (line.length < 2) return;
      features.push(feature({ type: "LineString", coordinates: line }, { level }));
    });
  });
  return featureCollection(features);
}


/**
 * Materialise a sampled layer into a real raster.
 *
 * A GEE drape carries a sampler — a reading of its rendered palette — but no
 * band, so none of the raster tools can touch it: slope, reclassify, the
 * calculator and zonal statistics all want cells. This grids the sampler over
 * its own bounds at cell centres, producing a raster every tool accepts, and
 * that the GeoTIFF writer can then export. The resolution honestly cannot
 * exceed what the drape delivered; the default 512 cells across is at or above
 * the delivered detail of every cache snapshot.
 *
 * Numeric samplers only. A colour-only sampler (no legend to invert) would
 * grid colours pretending to be values — the caller must refuse it first.
 */
export function samplerToRaster(sampler, bounds, { cellsAcross = 512, maxCells = 4000000 } = {}) {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (!(spanX > 0) || !(spanY > 0)) return null;
  let width = Math.max(2, Math.round(cellsAcross));
  let height = Math.max(2, Math.round(width * (spanY / spanX)));
  if (width * height > maxCells) {
    const shrink = Math.sqrt(maxCells / (width * height));
    width = Math.max(2, Math.floor(width * shrink));
    height = Math.max(2, Math.floor(height * shrink));
  }
  const band = new Float32Array(width * height).fill(NaN);
  let hits = 0;
  for (let y = 0; y < height; y += 1) {
    // Row 0 is the north edge, matching every raster in this module.
    const lat = bounds.maxY - ((y + 0.5) / height) * spanY;
    for (let x = 0; x < width; x += 1) {
      const lon = bounds.minX + ((x + 0.5) / width) * spanX;
      const v = sampler(lat, lon);
      if (typeof v === "number" && Number.isFinite(v)) {
        band[y * width + x] = v;
        hits += 1;
      }
    }
  }
  if (!hits) return null; // nothing numeric anywhere: not a raster
  const raster = makeRaster(band, width, height, bounds, NaN);
  raster.sampledCells = hits;
  return raster;
}

/**
 * Nearest-neighbour resample onto another raster's grid.
 *
 * The calculator zips bands by index, so two rasters on different grids give
 * silently wrong answers — HadUK's 1 km cells against a 100 m DEM is the NI
 * recipe's own case. Nearest-neighbour is deliberate for a browser tool:
 * it never invents values (a reclassified class grid must not be averaged),
 * and the sidecar's gdalwarp owns bilinear/cubic when fidelity matters.
 */
export function resampleToGrid(raster, template) {
  const out = new Float32Array(template.width * template.height).fill(NaN);
  const sb = raster.bounds;
  const tb = template.bounds;
  for (let y = 0; y < template.height; y += 1) {
    const lat = tb.maxY - ((y + 0.5) / template.height) * (tb.maxY - tb.minY);
    const sy = Math.floor(((sb.maxY - lat) / (sb.maxY - sb.minY)) * raster.height);
    if (sy < 0 || sy >= raster.height) continue;
    for (let x = 0; x < template.width; x += 1) {
      const lon = tb.minX + ((x + 0.5) / template.width) * (tb.maxX - tb.minX);
      const sx = Math.floor(((lon - sb.minX) / (sb.maxX - sb.minX)) * raster.width);
      if (sx < 0 || sx >= raster.width) continue;
      const v = raster.band[sy * raster.width + sx];
      if (Number.isFinite(v) && (raster.noData === null || v !== raster.noData)) {
        out[y * template.width + x] = v;
      }
    }
  }
  return makeRaster(out, template.width, template.height, tb, NaN);
}

/**
 * Rules text for reclassify: "0..5:1, 5..12:2, 30..90:5".
 *
 * `..` rather than `-` as the range mark, because a negative bound makes
 * "-10-10:5" unreadable — "-10..10:5" is not. Returns { ok, rules | message },
 * naming the first bad piece so the status line can point at it.
 */
export function parseReclassifyRules(text) {
  const rules = [];
  const pieces = String(text || "").split(",").map((piece) => piece.trim()).filter(Boolean);
  if (!pieces.length) return { ok: false, message: "No rules given." };
  for (const piece of pieces) {
    const m = piece.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/);
    if (!m) return { ok: false, message: `Cannot read "${piece}" — use min..max:class.` };
    const min = Number(m[1]);
    const max = Number(m[2]);
    const value = Number(m[3]);
    if (!(max > min)) return { ok: false, message: `"${piece}": max must exceed min.` };
    rules.push([min, max, value]);
  }
  return { ok: true, rules };
}

/**
 * Euclidean distance in metres from vector features, on a template grid.
 *
 * Two-pass chamfer transform with the cell's real ground size on each axis
 * (a degree of longitude is not a degree of latitude), so the answer is a
 * distance, not a cell count. Seeds are laid by walking every segment at
 * sub-cell steps — points seed their cell, lines and polygon BOUNDARIES seed
 * theirs. Distance to a polygon's interior is deliberately distance to its
 * edge: the drainage-proximity factor this exists for wants distance to the
 * river line, and a filled polygon would zero its whole floodplain.
 */
export function distanceRaster(fc, template) {
  const { width, height } = template;
  const tb = template.bounds;
  const dist = new Float64Array(width * height).fill(Infinity);

  const cellOf = (lon, lat) => {
    const x = Math.floor(((lon - tb.minX) / (tb.maxX - tb.minX)) * width);
    const y = Math.floor(((tb.maxY - lat) / (tb.maxY - tb.minY)) * height);
    return (x >= 0 && x < width && y >= 0 && y < height) ? y * width + x : -1;
  };
  const cell = cellSizeMetres(template);
  const seedSegment = (a, b) => {
    const steps = Math.max(1, Math.ceil(Math.max(
      Math.abs(b[0] - a[0]) / ((tb.maxX - tb.minX) / width),
      Math.abs(b[1] - a[1]) / ((tb.maxY - tb.minY) / height),
    ) * 2));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const at = cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (at >= 0) dist[at] = 0;
    }
  };
  fc.features.forEach((f) => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === "Point") {
      const at = cellOf(g.coordinates[0], g.coordinates[1]);
      if (at >= 0) dist[at] = 0;
    } else if (g.type === "MultiPoint") {
      g.coordinates.forEach((c) => {
        const at = cellOf(c[0], c[1]);
        if (at >= 0) dist[at] = 0;
      });
    } else {
      const lines = g.type === "LineString" ? [g.coordinates]
        : g.type === "MultiLineString" ? g.coordinates
          : g.type === "Polygon" ? g.coordinates
            : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
      lines.forEach((line) => {
        for (let i = 0; i < line.length - 1; i += 1) seedSegment(line[i], line[i + 1]);
      });
    }
  });

  const dx = cell.x;
  const dy = cell.y;
  const dd = Math.hypot(dx, dy);
  // Forward pass (top-left to bottom-right), then backward — the classic
  // chamfer sweep, within ~2% of true Euclidean (the known chamfer bound),
  // which is far inside what a proximity reclass band can tell apart.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + dx);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - width] + dy);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - width - 1] + dd);
      if (x < width - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - width + 1] + dd);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x < width - 1) dist[i] = Math.min(dist[i], dist[i + 1] + dx);
      if (y < height - 1) dist[i] = Math.min(dist[i], dist[i + width] + dy);
      if (x < width - 1 && y < height - 1) dist[i] = Math.min(dist[i], dist[i + width + 1] + dd);
      if (x > 0 && y < height - 1) dist[i] = Math.min(dist[i], dist[i + width - 1] + dd);
    }
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.isFinite(dist[i]) ? dist[i] : NaN;
  return makeRaster(out, width, height, tb, NaN);
}

/**
 * Vector → raster: burn a numeric attribute into a grid.
 *
 * Iterates FEATURES and fills each polygon's own bbox cell range, rather than
 * asking every cell which feature contains it — the difference between the sum
 * of the polygons' footprints and cells×features, which at NI scale (millions
 * of cells × hundreds of geology units) is the difference between running and
 * not. Later features win where polygons overlap, matching gdal_rasterize.
 */
export function rasterizeByAttribute(fc, field, template) {
  const { width, height } = template;
  const tb = template.bounds;
  const out = new Float32Array(width * height).fill(NaN);
  fc.features.forEach((f) => {
    const value = Number(f.properties?.[field]);
    if (!Number.isFinite(value)) return;
    polygonsOf(f.geometry).forEach((polygon) => {
      if (!polygon.length || polygon[0].length < 4) return;
      const pb = G.boundsOf(polygon[0]);
      const x0 = Math.max(0, Math.floor(((pb.minX - tb.minX) / (tb.maxX - tb.minX)) * width));
      const x1 = Math.min(width - 1, Math.ceil(((pb.maxX - tb.minX) / (tb.maxX - tb.minX)) * width));
      const y0 = Math.max(0, Math.floor(((tb.maxY - pb.maxY) / (tb.maxY - tb.minY)) * height));
      const y1 = Math.min(height - 1, Math.ceil(((tb.maxY - pb.minY) / (tb.maxY - tb.minY)) * height));
      for (let y = y0; y <= y1; y += 1) {
        const lat = tb.maxY - ((y + 0.5) / height) * (tb.maxY - tb.minY);
        for (let x = x0; x <= x1; x += 1) {
          const lon = tb.minX + ((x + 0.5) / width) * (tb.maxX - tb.minX);
          if (G.pointInPolygon([lon, lat], polygon)) out[y * width + x] = value;
        }
      }
    });
  });
  return makeRaster(out, width, height, tb, NaN);
}

/**
 * Weighted overlay: sum of weight × raster, on the first raster's grid.
 *
 * The multi-criteria core of every susceptibility map. Weights are normalised
 * so 30/30/40 and 0.3/0.3/0.4 mean the same thing; inputs off the reference
 * grid are nearest-resampled onto it first. A cell is scored only where EVERY
 * factor has a value — a missing factor silently defaulting to zero would read
 * as "safest class" exactly where the data is worst.
 */
export function weightedOverlay(entries) {
  if (!entries || !entries.length) return { ok: false, message: "No layers given." };
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (!(total > 0)) return { ok: false, message: "Weights must sum above zero." };
  const template = entries[0].raster;
  const sameGrid = (r) => r.width === template.width && r.height === template.height
    && r.bounds.minX === template.bounds.minX && r.bounds.maxX === template.bounds.maxX
    && r.bounds.minY === template.bounds.minY && r.bounds.maxY === template.bounds.maxY;
  let resampled = 0;
  const aligned = entries.map((e) => {
    const fits = sameGrid(e.raster);
    if (!fits) resampled += 1;
    return {
      weight: e.weight / total,
      band: (fits ? e.raster : resampleToGrid(e.raster, template)).band,
    };
  });
  const out = new Float32Array(template.width * template.height).fill(NaN);
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    let all = true;
    for (const { weight, band } of aligned) {
      const v = band[i];
      if (!Number.isFinite(v)) { all = false; break; }
      sum += weight * v;
    }
    if (all) out[i] = sum;
  }
  return {
    ok: true,
    resampled,
    raster: makeRaster(out, template.width, template.height, template.bounds, NaN),
  };
}

/**
 * Read the raster under each point feature, as a new attribute.
 *
 * The inverse of rasterToPoints, and the join that turns "a susceptibility
 * raster" into "a risk value at each school/road/gauge". Points outside the
 * raster or over noData get null rather than a made-up zero.
 */
export function sampleAtPoints(raster, fc, attrName = "value") {
  const features = [];
  let hits = 0;
  fc.features.forEach((f) => {
    const g = f.geometry;
    const coords = g?.type === "Point" ? [g.coordinates]
      : g?.type === "MultiPoint" ? g.coordinates : null;
    if (!coords) return;
    coords.forEach((c) => {
      const x = Math.floor(((c[0] - raster.bounds.minX)
        / (raster.bounds.maxX - raster.bounds.minX)) * raster.width);
      const y = Math.floor(((raster.bounds.maxY - c[1])
        / (raster.bounds.maxY - raster.bounds.minY)) * raster.height);
      const v = valueAt(raster, x, y);
      if (v !== null) hits += 1;
      features.push(feature(
        { type: "Point", coordinates: [c[0], c[1]] },
        { ...f.properties, [attrName]: v },
      ));
    });
  });
  const out = featureCollection(features);
  out.sampled = hits;
  return out;
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
