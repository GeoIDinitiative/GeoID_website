/**
 * A watershed, extracted, and the runoff through it — the pure half.
 *
 * Everything here works on a DEM grid `{ band, width, height, bounds }` with
 * bounds as `{ minX, minY, maxX, maxY }` (degrees) and rows north to south,
 * which is the shape `demGridFor` in landslide-pipeline.js returns. No DOM, no
 * THREE, no network: the panel (watershed-panel.js) fetches the ground and
 * draws the answer, and the arithmetic is tested here against closed forms.
 *
 * THE WATERSHED IS D8 ON THE FILLED SURFACE. Multiple flow directions are
 * right for how water spreads on a hillslope (the landslide model uses them)
 * and wrong for a catchment BOUNDARY: a cell either drains to the outlet or it
 * does not, and MFD makes every divide a fractional smear. So membership is
 * D8, and the answer is a hard polygon a reader can clip with.
 *
 * THE OUTLET IS SNAPPED. A click is never exactly on the channel, and one post
 * beside the thalweg drains a few square metres — a watershed of one cell,
 * returned as success. The pour point moves to the largest accumulation within
 * a snap radius, which is what every GIS does and says it did.
 *
 * RUNOFF IS A TIME–AREA HYDROGRAPH. Each cell's travel time to the outlet is
 * the sum of its path's lengths over their velocities — shallow concentrated
 * flow on the hillslopes (NRCS TR-55: v = K·√S), a channel velocity where the
 * contributing area makes a channel — and the rain the ground does not take
 * (SCS curve number) arrives at the outlet delayed by that time. Linear, so it
 * says nothing about attenuation in storage: it is the upper-bound, unrouted
 * hydrograph, and the panel calls it that.
 */

/** D8 neighbour offsets, in the order hydrology.js uses. */
export const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Ground metres per cell, east–west and north–south, at the grid's mid-latitude. */
export function cellMetres(grid) {
  const { bounds: b, width, height } = grid;
  const midLat = (b.minY + b.maxY) / 2;
  return {
    x: ((b.maxX - b.minX) * 111320 * Math.cos(midLat * Math.PI / 180)) / width,
    y: ((b.maxY - b.minY) * 110574) / height,
  };
}

/** Grid indices of a lat/lon, or null when it is off the grid. */
export function cellOf(grid, lat, lon) {
  const { bounds: b, width, height } = grid;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) return null;
  const x = Math.min(width - 1, Math.floor(((lon - b.minX) / (b.maxX - b.minX)) * width));
  const y = Math.min(height - 1, Math.floor(((b.maxY - lat) / (b.maxY - b.minY)) * height));
  return { x, y, i: y * width + x };
}

/** The lat/lon of a cell's centre. */
export function centreOf(grid, i) {
  const { bounds: b, width, height } = grid;
  const x = i % width; const y = (i - x) / width;
  return {
    lat: b.maxY - ((y + 0.5) / height) * (b.maxY - b.minY),
    lon: b.minX + ((x + 0.5) / width) * (b.maxX - b.minX),
  };
}

/**
 * Priority-flood fill (Barnes et al. 2014) with an epsilon gradient, on typed
 * arrays. The same algorithm as hydrology.js's fillSinks, kept here so this
 * module stays free of the raster module's imports and testable alone.
 */
export function fill(grid, epsilon = 1e-4) {
  const { band, width, height } = grid;
  const n = width * height;
  const out = new Float32Array(n).fill(NaN);
  const done = new Uint8Array(n);
  const key = new Float64Array(n); const idx = new Int32Array(n);
  let size = 0;
  const push = (k, i) => {
    let c = size; size += 1;
    while (c > 0) { const p = (c - 1) >> 1; if (key[p] <= k) break; key[c] = key[p]; idx[c] = idx[p]; c = p; }
    key[c] = k; idx[c] = i;
  };
  const pop = () => {
    const top = idx[0];
    size -= 1;
    if (size > 0) {
      const k = key[size]; const i = idx[size];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1; if (l >= size) break;
        const r = l + 1; const m = r < size && key[r] < key[l] ? r : l;
        if (key[m] >= k) break;
        key[c] = key[m]; idx[c] = idx[m]; c = m;
      }
      key[c] = k; idx[c] = i;
    }
    return top;
  };
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(band[i])) { done[i] = 1; continue; }
    const x = i % width; const y = (i - x) / width;
    let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (!edge) {
      for (const [dx, dy] of NEIGHBOURS) {
        if (!Number.isFinite(band[(y + dy) * width + x + dx])) { edge = true; break; }
      }
    }
    if (edge) { out[i] = band[i]; done[i] = 1; push(band[i], i); }
  }
  while (size > 0) {
    const i = pop();
    const x = i % width; const y = (i - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (done[j]) continue;
      out[j] = Math.max(band[j], out[i] + epsilon);
      done[j] = 1;
      push(out[j], j);
    }
  }
  return out;
}

/**
 * D8 on a filled surface: the steepest-descent neighbour of every cell (−1
 * where water leaves the grid), the tangent of that descent, and a
 * high-to-low order so contributors are always met first.
 */
export function d8(filled, width, height, cell) {
  const n = width * height;
  const dir = new Int8Array(n).fill(-1);
  const tan = new Float32Array(n);
  const runs = NEIGHBOURS.map(([dx, dy]) => Math.hypot(dx * cell.x, dy * cell.y));
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const h = filled[i];
      if (!Number.isFinite(h)) continue;
      count += 1;
      let best = 0; let at = -1;
      for (let q = 0; q < 8; q += 1) {
        const nx = x + NEIGHBOURS[q][0]; const ny = y + NEIGHBOURS[q][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const hj = filled[ny * width + nx];
        if (!Number.isFinite(hj)) continue;
        const drop = (h - hj) / runs[q];
        if (drop > best) { best = drop; at = q; }
      }
      dir[i] = at;
      tan[i] = best;
    }
  }
  const order = new Int32Array(count);
  for (let i = 0, k = 0; i < n; i += 1) if (Number.isFinite(filled[i])) { order[k] = i; k += 1; }
  order.sort((a, b) => filled[b] - filled[a]);
  return { dir, tan, order, runs };
}

/** The cell a D8 direction points at. */
export function downstream(i, q, width) {
  if (q < 0) return -1;
  const x = i % width; const y = (i - x) / width;
  return (y + NEIGHBOURS[q][1]) * width + x + NEIGHBOURS[q][0];
}

/** Contributing cells through each cell (itself included), from the high-to-low order. */
export function accumulate(flow, width, height) {
  const acc = new Float64Array(width * height);
  const { order, dir } = flow;
  for (let o = 0; o < order.length; o += 1) acc[order[o]] += 1;
  for (let o = 0; o < order.length; o += 1) {
    const i = order[o];
    const j = downstream(i, dir[i], width);
    if (j >= 0) acc[j] += acc[i];
  }
  return acc;
}

/**
 * Move a pour point to the largest accumulation within `radius` cells. Ties go
 * to the nearer cell, so a click already on the channel stays where it is.
 */
export function snapOutlet(acc, width, height, x, y, radius) {
  let best = y * width + x; let bestAcc = acc[best] || 0; let bestD = 0;
  const r = Math.max(0, Math.round(radius));
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const d = dx * dx + dy * dy;
      if (d > r * r) continue;
      const j = ny * width + nx;
      const a = acc[j] || 0;
      if (a > bestAcc || (a === bestAcc && d < bestD)) { best = j; bestAcc = a; bestD = d; }
    }
  }
  return best;
}

/** Every cell that drains through `outlet`: 1 inside, 0 outside. Walks the order low to high. */
export function upstreamMask(flow, width, height, outlet) {
  const mask = new Uint8Array(width * height);
  mask[outlet] = 1;
  const { order, dir } = flow;
  let cells = 1;
  for (let o = order.length - 1; o >= 0; o -= 1) {
    const i = order[o];
    if (mask[i]) continue;
    const j = downstream(i, dir[i], width);
    if (j >= 0 && mask[j]) { mask[i] = 1; cells += 1; }
  }
  return { mask, cells };
}

/**
 * Whether the catchment reaches the edge of the grid. If it does, the DEM was
 * too small and part of the basin is outside it — the panel widens the box and
 * asks again rather than returning a basin cut at an arbitrary line.
 */
export function touchesEdge(mask, width, height) {
  for (let x = 0; x < width; x += 1) {
    if (mask[x] || mask[(height - 1) * width + x]) return true;
  }
  for (let y = 0; y < height; y += 1) {
    if (mask[y * width] || mask[y * width + width - 1]) return true;
  }
  return false;
}

/**
 * The catchment's outline as GeoJSON rings, [lon, lat], counter-clockwise for
 * an outer ring. Traced along CELL EDGES, so the polygon holds exactly the
 * cells in the mask — no marching-squares midpoints that nobody could clip to.
 * Collinear vertices are dropped. The largest ring is the boundary; any others
 * are holes (a closed depression the flow skips round).
 */
export function traceOutline(mask, width, height, bounds) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // Directed boundary edges on the vertex lattice (width+1)×(height+1), with
  // the inside kept on the LEFT, so outer rings wind counter-clockwise in
  // (x right, y up) and holes clockwise.
  const next = new Map();
  const vid = (vx, vy) => vy * (width + 1) + vx;
  // A LIST per vertex: where two cells meet only at a corner, two boundary
  // edges leave the same vertex, and a plain map would drop one of them.
  const add = (ax, ay, bx, by) => {
    const k = vid(ax, ay);
    const list = next.get(k);
    if (list) list.push(vid(bx, by)); else next.set(k, [vid(bx, by)]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      // Grid y runs DOWN; world y runs up. Vertex (vx, vy) with vy counted down.
      if (!inside(x, y - 1)) add(x + 1, y, x, y);       // north edge, heading west
      if (!inside(x, y + 1)) add(x, y + 1, x + 1, y + 1); // south edge, heading east
      if (!inside(x - 1, y)) add(x, y, x, y + 1);       // west edge, heading south
      if (!inside(x + 1, y)) add(x + 1, y + 1, x + 1, y); // east edge, heading north
    }
  }
  const toLonLat = (v) => {
    const vx = v % (width + 1); const vy = (v - vx) / (width + 1);
    return [bounds.minX + (vx / width) * (bounds.maxX - bounds.minX),
      bounds.maxY - (vy / height) * (bounds.maxY - bounds.minY)];
  };
  const rings = [];
  while (next.size) {
    const [start] = next.keys();
    const verts = [];
    let v = start;
    let guard = 0;
    do {
      verts.push(v);
      const list = next.get(v);
      const w = list?.pop();
      if (list && !list.length) next.delete(v);
      v = w;
      guard += 1;
    } while (v !== undefined && v !== start && guard < 1e7);
    if (verts.length < 4) continue;
    // Drop collinear vertices.
    const pts = verts.map((q) => [q % (width + 1), (q - (q % (width + 1))) / (width + 1)]);
    const kept = pts.filter((p, k) => {
      const a = pts[(k - 1 + pts.length) % pts.length]; const c = pts[(k + 1) % pts.length];
      return (p[0] - a[0]) * (c[1] - p[1]) !== (p[1] - a[1]) * (c[0] - p[0]);
    });
    const ring = kept.map(([vx, vy]) => toLonLat(vy * (width + 1) + vx));
    ring.push(ring[0]);
    rings.push(ring);
  }
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  return rings;
}

/** Signed shoelace area in the ring's own units; positive is counter-clockwise. */
export function ringArea(ring) {
  let s = 0;
  for (let k = 0; k < ring.length - 1; k += 1) s += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return s / 2;
}

/**
 * The channel network inside the catchment as LineStrings, each a reach from a
 * source or a junction to the next junction or the outlet, with its Strahler
 * order and upstream area. A channel is where the contributing area passes
 * `thresholdCells`.
 */
export function streamNetwork(flow, acc, mask, grid, thresholdCells) {
  const { width } = grid;
  const n = mask.length;
  const isStream = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (mask[i] && acc[i] >= thresholdCells) isStream[i] = 1;
  // Upstream stream contributors per cell, and Strahler order low to high.
  const inflow = new Uint8Array(n);
  const order = new Uint8Array(n);
  const maxIn = new Uint8Array(n); const maxCount = new Uint8Array(n);
  const { order: hiToLo, dir } = flow;
  for (let o = 0; o < hiToLo.length; o += 1) {
    const i = hiToLo[o];
    if (!isStream[i]) continue;
    const s = inflow[i] === 0 ? 1 : (maxCount[i] >= 2 ? maxIn[i] + 1 : maxIn[i]);
    order[i] = s;
    const j = downstream(i, dir[i], width);
    if (j >= 0 && isStream[j]) {
      inflow[j] += 1;
      if (s > maxIn[j]) { maxIn[j] = s; maxCount[j] = 1; } else if (s === maxIn[j]) maxCount[j] += 1;
    }
  }
  // A reach starts at a source (no stream inflow) or just below a junction.
  const starts = [];
  for (let o = 0; o < hiToLo.length; o += 1) {
    const i = hiToLo[o];
    if (!isStream[i]) continue;
    if (inflow[i] === 0) starts.push(i);
  }
  const junctionBelow = new Set();
  for (let i = 0; i < n; i += 1) if (isStream[i] && inflow[i] >= 2) junctionBelow.add(i);
  const features = [];
  const cm = cellMetres(grid);
  const cellKm2 = (cm.x * cm.y) / 1e6;
  const queue = [...starts];
  const begun = new Set(starts);
  while (queue.length) {
    const s = queue.shift();
    const coords = [];
    let i = s; let lengthM = 0; let last = -1;
    const reachOrder = order[s];
    for (let guard = 0; guard < n; guard += 1) {
      const c = centreOf(grid, i);
      coords.push([c.lon, c.lat]);
      const q = dir[i];
      const j = downstream(i, q, width);
      if (j < 0 || !isStream[j] || !mask[j]) { last = i; break; }
      lengthM += Math.hypot(NEIGHBOURS[q][0] * cm.x, NEIGHBOURS[q][1] * cm.y);
      if (junctionBelow.has(j) || order[j] !== reachOrder) {
        const cj = centreOf(grid, j);
        coords.push([cj.lon, cj.lat]);
        if (!begun.has(j)) { begun.add(j); queue.push(j); }
        last = j;
        break;
      }
      i = j;
    }
    if (coords.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { order: reachOrder, length_m: Math.round(lengthM), upstream_km2: Number((acc[last >= 0 ? last : i] * cellKm2).toFixed(3)) },
      });
    }
  }
  let maxOrder = 0;
  for (const f of features) maxOrder = Math.max(maxOrder, f.properties.order);
  return { features, maxOrder, streamCells: isStream.reduce((a, v) => a + v, 0), isStream };
}

/** NRCS TR-55 shallow concentrated flow coefficients, v = K·√S in m/s. */
export const OVERLAND_K = Object.freeze({ unpaved: 4.918, paved: 6.196, grassed: 2.3, forest: 1.2 });

/**
 * Per-cell flow velocity (m/s): hillslope cells take K·√S with a floor, so a
 * filled flat is slow rather than never draining; channel cells take the
 * channel velocity.
 */
export function velocities(flow, isStream, { overlandK = OVERLAND_K.unpaved, channelV = 1.5, floorV = 0.05 } = {}) {
  const v = new Float32Array(flow.tan.length);
  for (let i = 0; i < v.length; i += 1) {
    v[i] = isStream && isStream[i] ? channelV : Math.max(floorV, overlandK * Math.sqrt(Math.max(0, flow.tan[i])));
  }
  return v;
}

/**
 * Along-path distance (m) and travel time (s) from every catchment cell to
 * the outlet. Walked low to high, so a cell's downstream neighbour is always
 * done first: time(i) = time(j) + run / mean(v_i, v_j).
 */
export function travelToOutlet(flow, mask, width, outlet, vel) {
  const n = mask.length;
  const dist = new Float32Array(n).fill(NaN);
  const time = new Float32Array(n).fill(NaN);
  dist[outlet] = 0; time[outlet] = 0;
  const { order, dir, runs } = flow;
  for (let o = order.length - 1; o >= 0; o -= 1) {
    const i = order[o];
    if (!mask[i] || i === outlet) continue;
    const q = dir[i];
    const j = downstream(i, q, width);
    if (j < 0 || !Number.isFinite(time[j])) continue;
    dist[i] = dist[j] + runs[q];
    time[i] = time[j] + runs[q] / Math.max(1e-3, 0.5 * (vel[i] + vel[j]));
  }
  return { dist, time };
}

/** Kirpich (1940) time of concentration in minutes: L in metres, S the mean slope of that path. */
export function kirpichMinutes(lengthM, slope) {
  if (!(lengthM > 0) || !(slope > 0)) return NaN;
  return 0.0195 * lengthM ** 0.77 * slope ** -0.385;
}

/** SCS curve number: cumulative runoff depth (mm) from cumulative rainfall (mm). */
export function scsRunoff(pMm, cn, { lambda = 0.2 } = {}) {
  if (!(cn > 0) || cn > 100) return 0;
  const s = 25400 / cn - 254;
  const ia = lambda * s;
  return pMm <= ia ? 0 : ((pMm - ia) ** 2) / (pMm - ia + s);
}

/**
 * A storm's rainfall excess, step by step, for a uniform hyetograph of `depthMm`
 * over `durationH` hours: the difference of cumulative SCS runoff across each
 * step, in mm per step.
 */
export function excessSeries(depthMm, durationH, cn, dtS) {
  const steps = Math.max(1, Math.ceil((durationH * 3600) / dtS));
  const out = new Float64Array(steps);
  let prev = 0;
  for (let k = 0; k < steps; k += 1) {
    const cum = depthMm * Math.min(1, ((k + 1) * dtS) / (durationH * 3600));
    const q = scsRunoff(cum, cn);
    out[k] = q - prev;
    prev = q;
  }
  return out;
}

/**
 * The outlet hydrograph by time–area convolution. `time` is each cell's travel
 * time (s), `cellM2` a cell's ground area, `excess` mm per step of length dtS,
 * spread evenly over the catchment. Returns seconds and m³/s.
 */
export function timeAreaHydrograph(time, mask, cellM2, excess, dtS) {
  let tMax = 0;
  const bins = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || !Number.isFinite(time[i])) continue;
    const b = Math.floor(time[i] / dtS);
    bins[b] = (bins[b] || 0) + 1;
    if (time[i] > tMax) tMax = time[i];
  }
  const nBins = bins.length;
  const steps = excess.length + nBins + 1;
  const q = new Float64Array(steps);
  for (let k = 0; k < excess.length; k += 1) {
    const volumePerCell = (excess[k] / 1000) * cellM2;   // m³ over the step
    if (!volumePerCell) continue;
    for (let b = 0; b < nBins; b += 1) {
      if (!bins[b]) continue;
      q[k + b] += (volumePerCell * bins[b]) / dtS;
    }
  }
  const times = Array.from(q, (_, k) => (k + 1) * dtS);
  let peak = 0; let peakAt = 0; let volume = 0;
  for (let k = 0; k < steps; k += 1) {
    volume += q[k] * dtS;
    if (q[k] > peak) { peak = q[k]; peakAt = times[k]; }
  }
  return { times, q, peak, peakAt, volume, tcS: tMax };
}

/** Summary statistics of a catchment on its grid. */
export function catchmentStats(grid, filledOrBand, flow, mask, outlet, travel) {
  const cm = cellMetres(grid);
  let cells = 0; let lo = Infinity; let hi = -Infinity; let slopeSum = 0; let far = outlet; let farD = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    cells += 1;
    const h = grid.band[i];
    if (Number.isFinite(h)) { if (h < lo) lo = h; if (h > hi) hi = h; }
    slopeSum += Math.atan(flow.tan[i]);
    const d = travel.dist[i];
    if (Number.isFinite(d) && d > farD) { farD = d; far = i; }
  }
  const areaKm2 = (cells * cm.x * cm.y) / 1e6;
  const pathDrop = Number.isFinite(grid.band[far]) && Number.isFinite(grid.band[outlet]) ? grid.band[far] - grid.band[outlet] : NaN;
  const pathSlope = farD > 0 && pathDrop > 0 ? pathDrop / farD : NaN;
  return {
    cells, areaKm2, reliefM: hi - lo, minM: lo, maxM: hi,
    meanSlopeDeg: cells ? (slopeSum / cells) * (180 / Math.PI) : NaN,
    longestPathM: farD, longestPathSlope: pathSlope, sourceCell: far,
    kirpichMin: kirpichMinutes(farD, pathSlope),
  };
}
