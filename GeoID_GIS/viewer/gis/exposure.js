/**
 * Exposure: who is under a hazard — the pure half.
 *
 * Every hazard map in this app says how often, or how badly, something happens
 * at a point. Risk needs the other half: how many people are there. This module
 * integrates WorldPop's count grid (people per ~1 km cell) against any hazard,
 * inside a study polygon, and keeps the arithmetic honest in three ways.
 *
 * PEOPLE ARE CONSERVED, NOT RESAMPLED. WorldPop's file is a COUNT per cell. A
 * hazard grid finer than it (a 27 m landslide map) gets each population cell's
 * count shared among the hazard cells whose centres fall in it — so the grid
 * sums to the population it was read from, and a hazard cell carries people in
 * proportion to its share of the cell's ground. A grid coarser than it (a
 * quadtree risk map) gets the population cells whose centres fall inside each
 * of its cells summed. Sampling the density at a centre and multiplying by an
 * area, the obvious shortcut, loses or duplicates people wherever the two grids
 * are misaligned, and the loss is invisible because the answer still looks
 * like a number of people.
 *
 * THE POLYGON IS TESTED AT CELL CENTRES, and the partial cells along its edge
 * are the error bar of the integral. `edgeShare` is reported so a reader can
 * see how much of the answer sits on that boundary.
 *
 * A CHANCE IS NOT A HEADCOUNT. On a probability map (a cell carrying `p_yr`,
 * the annual chance of the hazard reaching it) the expected number of people
 * reached in a year is Σ people × p — and people by return-period class is a
 * separate, equally honest number. Both are returned; neither is called "the
 * number of people at risk".
 */

/** A lat/lon box from any of this app's four box spellings. */
export function boxOf(b) {
  if (!b) return null;
  const west = b.west ?? b.minX ?? b.minLon; const east = b.east ?? b.maxX ?? b.maxLon;
  const south = b.south ?? b.minY ?? b.minLat; const north = b.north ?? b.maxY ?? b.maxLat;
  return [west, east, south, north].every(Number.isFinite) ? { west, east, south, north } : null;
}

/** Point in one GeoJSON ring (lon, lat), even–odd. */
export function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]; const yi = ring[i][1]; const xj = ring[j][0]; const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in a polygon given as GeoJSON coordinate arrays: outer ring then holes. */
export function inPolygon(lon, lat, polygon) {
  if (!polygon?.length || !inRing(lon, lat, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k += 1) if (inRing(lon, lat, polygon[k])) return false;
  return true;
}

/** Every polygon (outer + holes) in a FeatureCollection, with its bounding box. */
export function polygonsOf(fc) {
  const out = [];
  for (const f of fc?.features || []) {
    const g = f?.geometry;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) {
      if (!p?.[0]?.length) continue;
      let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
      for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      out.push({ coords: p, box: { west: w, east: e, south: s, north: n }, feature: f });
    }
  }
  return out;
}

/** Whether a point is inside any polygon of a list from `polygonsOf`. */
export function insideAny(lon, lat, polys) {
  for (const p of polys) {
    if (lon < p.box.west || lon > p.box.east || lat < p.box.south || lat > p.box.north) continue;
    if (inPolygon(lon, lat, p.coords)) return p;
  }
  return null;
}

/**
 * A BUCKET INDEX over polygons, for looking up which risk cell holds a point
 * among tens of thousands without testing every one. Buckets are a coarse
 * lat/lon lattice; each polygon is listed in every bucket its box touches.
 */
export function polygonIndex(polys, { bucketDeg = 1 } = {}) {
  const buckets = new Map();
  const key = (bx, by) => `${bx},${by}`;
  for (const p of polys) {
    const x0 = Math.floor(p.box.west / bucketDeg); const x1 = Math.floor(p.box.east / bucketDeg);
    const y0 = Math.floor(p.box.south / bucketDeg); const y1 = Math.floor(p.box.north / bucketDeg);
    for (let by = y0; by <= y1; by += 1) {
      for (let bx = x0; bx <= x1; bx += 1) {
        const k = key(bx, by);
        const list = buckets.get(k);
        if (list) list.push(p); else buckets.set(k, [p]);
      }
    }
  }
  return {
    at(lon, lat) {
      const list = buckets.get(key(Math.floor(lon / bucketDeg), Math.floor(lat / bucketDeg)));
      return list ? insideAny(lon, lat, list) : null;
    },
  };
}

/** The ground of one lat/lon cell, km², at its own latitude. */
export function cellKm2(dLonDeg, dLatDeg, lat) {
  return (dLatDeg * 110.574) * (dLonDeg * 111.32 * Math.cos((lat * Math.PI) / 180));
}

/**
 * People on a hazard grid, conserved.
 *
 * `pop` is a count window `{ band, width, height, bounds }` (people per source
 * cell, NaN or negative for no data). `grid` is the hazard's own lattice
 * `{ width, height, bounds }`, rows north to south. Returns a Float32Array of
 * people per hazard cell.
 */
export function peopleOnGrid(pop, grid) {
  const pb = boxOf(pop.bounds); const gb = boxOf(grid.bounds);
  const out = new Float32Array(grid.width * grid.height);
  if (!pb || !gb) return out;
  const pdx = (pb.east - pb.west) / pop.width; const pdy = (pb.north - pb.south) / pop.height;
  const gdx = (gb.east - gb.west) / grid.width; const gdy = (gb.north - gb.south) / grid.height;
  const popCol = (lon) => Math.floor((lon - pb.west) / pdx);
  const popRow = (lat) => Math.floor((pb.north - lat) / pdy);
  const count = (c, r) => {
    if (c < 0 || r < 0 || c >= pop.width || r >= pop.height) return 0;
    const v = pop.band[r * pop.width + c];
    return Number.isFinite(v) && v > 0 && v < 1e30 ? v : 0;
  };
  if (gdx * gdy < pdx * pdy) {
    // FINER hazard grid: share each population cell among the hazard cells
    // whose centres fall in it. Two passes: how many hazard cells each
    // population cell holds, then its count divided among them.
    const holders = new Map();
    const owner = new Int32Array(grid.width * grid.height).fill(-1);
    for (let y = 0; y < grid.height; y += 1) {
      const lat = gb.north - (y + 0.5) * gdy;
      const r = popRow(lat);
      for (let x = 0; x < grid.width; x += 1) {
        const lon = gb.west + (x + 0.5) * gdx;
        const c = popCol(lon);
        if (c < 0 || r < 0 || c >= pop.width || r >= pop.height) continue;
        const k = r * pop.width + c;
        owner[y * grid.width + x] = k;
        holders.set(k, (holders.get(k) || 0) + 1);
      }
    }
    for (let i = 0; i < out.length; i += 1) {
      const k = owner[i];
      if (k < 0) continue;
      const c = k % pop.width; const r = (k - c) / pop.width;
      out[i] = count(c, r) / holders.get(k);
    }
    return out;
  }
  // COARSER hazard grid: sum the population cells whose centres fall inside.
  for (let r = 0; r < pop.height; r += 1) {
    const lat = pb.north - (r + 0.5) * pdy;
    const gy = Math.floor((gb.north - lat) / gdy);
    if (gy < 0 || gy >= grid.height) continue;
    for (let c = 0; c < pop.width; c += 1) {
      const v = count(c, r);
      if (!v) continue;
      const lon = pb.west + (c + 0.5) * pdx;
      const gx = Math.floor((lon - gb.west) / gdx);
      if (gx < 0 || gx >= grid.width) continue;
      out[gy * grid.width + gx] += v;
    }
  }
  return out;
}

/** Which cells of a grid have their centre inside the study polygons: 1 inside. */
export function polygonMask(grid, polys) {
  const gb = boxOf(grid.bounds);
  const mask = new Uint8Array(grid.width * grid.height);
  if (!gb || !polys?.length) return mask;
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.box.west); e = Math.max(e, p.box.east); s = Math.min(s, p.box.south); n = Math.max(n, p.box.north); }
  const dx = (gb.east - gb.west) / grid.width; const dy = (gb.north - gb.south) / grid.height;
  for (let y = 0; y < grid.height; y += 1) {
    const lat = gb.north - (y + 0.5) * dy;
    if (lat < s || lat > n) continue;
    for (let x = 0; x < grid.width; x += 1) {
      const lon = gb.west + (x + 0.5) * dx;
      if (lon < w || lon > e) continue;
      if (insideAny(lon, lat, polys)) mask[y * grid.width + x] = 1;
    }
  }
  return mask;
}

/**
 * Exposure on a hazard GRID by class.
 *
 * `classOf(value, i)` returns a class index or −1 for "not exposed" (no data,
 * or a value below the hazard's threshold). Returns people inside the polygon,
 * people per class, and the share of the polygon's people in cells that touch
 * its edge.
 */
export function gridExposure({ people, values, mask, classOf, classes, width }) {
  const byClass = classes.map(() => 0);
  let total = 0; let exposed = 0; let edge = 0;
  for (let i = 0; i < people.length; i += 1) {
    if (mask && !mask[i]) continue;
    const p = people[i];
    if (!p) continue;
    total += p;
    if (width && mask) {
      const x = i % width;
      const onEdge = !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width] || x === 0 || x === width - 1;
      if (onEdge) edge += p;
    }
    const c = classOf(values ? values[i] : null, i);
    if (c >= 0 && c < byClass.length) { byClass[c] += p; exposed += p; }
  }
  return {
    total, exposed, share: total ? exposed / total : 0, edgeShare: total ? edge / total : 0,
    byClass: classes.map((label, k) => ({ label, people: byClass[k] })),
  };
}

/**
 * Exposure on a PROBABILITY map: each population cell inside the study polygon
 * looks up the risk cell at its centre. Returns the expected people reached
 * per year (Σ people × p_yr), people by return-period class, and people in
 * places the map has no cell for (outside its coverage).
 */
export function riskExposure({ pop, polys, index, edges, labels, field = "p_yr" }) {
  const pb = boxOf(pop.bounds);
  const out = { total: 0, expectedPerYear: 0, uncovered: 0, byClass: labels.map((label) => ({ label, people: 0 })) };
  if (!pb) return out;
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.box.west); e = Math.max(e, p.box.east); s = Math.min(s, p.box.south); n = Math.max(n, p.box.north); }
  const dx = (pb.east - pb.west) / pop.width; const dy = (pb.north - pb.south) / pop.height;
  for (let r = 0; r < pop.height; r += 1) {
    const lat = pb.north - (r + 0.5) * dy;
    if (lat < s || lat > n) continue;
    for (let c = 0; c < pop.width; c += 1) {
      const v = pop.band[r * pop.width + c];
      if (!(Number.isFinite(v) && v > 0 && v < 1e30)) continue;
      const lon = pb.west + (c + 0.5) * dx;
      if (lon < w || lon > e || !insideAny(lon, lat, polys)) continue;
      out.total += v;
      const hit = index.at(lon, lat);
      const pr = Number(hit?.feature?.properties?.[field]);
      if (!hit || !Number.isFinite(pr)) { out.uncovered += v; continue; }
      out.expectedPerYear += v * pr;
      let k = 0;
      while (k < edges.length && pr >= edges[k]) k += 1;
      const cls = Math.min(labels.length - 1, k);
      out.byClass[cls].people += v;
    }
  }
  return out;
}

/** A people figure said the way a reader says one. */
export function formatPeople(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return n > 0 ? "<1" : "0";
  if (n < 1000) return Math.round(n).toLocaleString("en-GB");
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} thousand`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} million`;
}

/** The time series as tidy CSV: a row per map, a column per class. */
export function seriesCsv({ times, total, series, header = "" }) {
  const cols = series.map((s) => s.label.replace(/[,\n]/g, " "));
  const lines = [`time,people_in_area,${cols.join(",")}`];
  times.forEach((t, k) => lines.push([t, Math.round(total), ...series.map((s) => Math.round(s.values[k] || 0))].join(",")));
  return `${header ? `# ${header}\n` : ""}${lines.join("\n")}\n`;
}
