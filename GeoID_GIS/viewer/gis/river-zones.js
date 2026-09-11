/**
 * RIVER CORRIDOR ZONES — incremental buffers round every GRWL river, sized by
 * the river itself.
 *
 * A fixed buffer cannot serve this data. GRWL runs from 30 m streams to Amazon
 * reaches several kilometres wide: 50 m is the whole valley of the first and
 * less than the sandbars of the second. Every zone here is therefore measured
 * from the MEAN-FLOW WATER EDGE (the centreline plus half GRWL's own width W,
 * which is the width at mean discharge) in multiples of W, with a fixed floor
 * only where a regulation or a bank sets one.
 *
 *   1  Seasonal margin   max(10 m, ¼ W)
 *      The ground a river covers between low flow and bankfull. At-a-station
 *      hydraulic geometry puts width ∝ Q^0.26 (Leopold & Maddock 1953), and
 *      bankfull discharge is a few times the mean, so the edge moves out by
 *      roughly 0.1–0.25 W a side before the river leaves its channel. Seasonal
 *      stage is a VERTICAL swing — under a metre on a small stream, 10–15 m on
 *      the Amazon — and this is its horizontal footprint. The 10 m floor is the
 *      bank itself, and the strip regulators name for works beside a river
 *      (8 m non-tidal and 16 m tidal in England, 15–30 m riparian strips
 *      elsewhere).
 *
 *   2  Migration belt    3 W
 *      Where the channel itself moves over decades. Meander belts run about
 *      6–8 W wide (Williams 1986: B ≈ 4.3 W^1.12), so about 3 W beyond each
 *      bank. Braided and bedrock-confined rivers differ; this is the alluvial
 *      default. Not drawn for canals, which are built not to move.
 *
 *   3  Floodplain        10 W, AND no more than 5 m above the channel
 *      Low ground an overbank flood reaches. Distance alone paints a valley's
 *      sides, so this zone also needs the ground to stand within 5 m of the
 *      water surface at its nearest channel — HAND, "height above nearest
 *      drainage", where ≤ 5 m is the floodplain class (Nobre et al. 2011).
 *      Measured on the same streamed DEM the sheet is drawn on.
 *
 * NEAREST RIVER PER WIDTH BAND. A cell's nearest river is not always the one
 * whose zone covers it: a stream 200 m away has a 10 m margin, while the
 * floodplain of a 2 km river 5 km away reaches right across it. So the
 * transform runs once per band of widths and a cell takes the innermost zone
 * any band gives it.
 */

/** Zone ids, innermost first. 0 is nothing; CHANNEL is the river itself. */
export const NONE = 0;
export const MARGIN = 1;
export const BELT = 2;
export const FLOODPLAIN = 3;
export const CHANNEL = 9;

export const ZONES = [
  { id: MARGIN, key: "margin", label: "Seasonal margin", rule: "max(10 m, ¼ W) from the bank",
    reach: (w) => Math.max(10, 0.25 * w), colour: [8, 81, 156] },
  { id: BELT, key: "belt", label: "Migration belt", rule: "3 W from the bank",
    reach: (w) => 3 * w, colour: [66, 146, 198] },
  { id: FLOODPLAIN, key: "floodplain", label: "Floodplain", rule: "10 W, ≤ 5 m above the channel",
    reach: (w) => 10 * w, colour: [158, 202, 225], maxAbove: 5 },
];

/** Width bands for the per-band transform, in metres. */
const BANDS = [30, 100, 300, 1000, 3000, Infinity];

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;

/**
 * Burn river centrelines onto a grid: each cell a line crosses takes the
 * widest river through it. `bounds` is west/south/east/north; row 0 is north.
 * A reach GRWL flags as running through a lake is left out (it is the lake's
 * business, not a channel's); a canal is marked so the migration zone can
 * skip it.
 */
export function burnRivers(features, bounds, width, height) {
  const riverWidth = new Float32Array(width * height).fill(NaN);
  const canal = new Uint8Array(width * height);
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  const mark = (x, y, w, isCanal) => {
    const i = Math.floor(x); const j = Math.floor(y);
    if (i < 0 || j < 0 || i >= width || j >= height) return;
    const c = (j * width) + i;
    if (!(riverWidth[c] >= w)) { riverWidth[c] = w; canal[c] = isCanal ? 1 : 0; }
  };
  for (const f of features || []) {
    const p = f?.properties || {};
    const w = Number(p.width_median_m);
    if (!Number.isFinite(w) || w <= 0) continue;
    const flag = Number(p.lake_flag);
    if (flag === 1) continue;
    const isCanal = flag === 3;
    const g = f.geometry;
    const lines = g?.type === "LineString" ? [g.coordinates]
      : g?.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      for (let k = 0; k + 1 < line.length; k += 1) {
        const x1 = (line[k][0] - bounds.west) * sx; const y1 = (bounds.north - line[k][1]) * sy;
        const x2 = (line[k + 1][0] - bounds.west) * sx; const y2 = (bounds.north - line[k + 1][1]) * sy;
        // Half-cell steps, so a diagonal marks every cell it crosses.
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          mark(x1 + ((x2 - x1) * t), y1 + ((y2 - y1) * t), w, isCanal);
        }
      }
    }
  }
  return { riverWidth, canal };
}

/**
 * Distance in metres from every cell to its nearest source cell, and WHICH
 * source: two raster passes propagating each neighbour's source and keeping
 * the nearer (the 8SSEDT idea), repeated so a source can reach round a corner.
 * Metres, because a degree of longitude is not a degree of latitude: the east–
 * west step is taken at the mean latitude of the two rows compared.
 */
export function nearestSource(isSource, width, height, bounds) {
  const n = width * height;
  const dist = new Float32Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  const degX = (bounds.east - bounds.west) / width;
  const degY = (bounds.north - bounds.south) / height;
  const lat = new Float64Array(height);
  for (let j = 0; j < height; j += 1) lat[j] = bounds.north - ((j + 0.5) * degY);
  const dy = M_PER_DEG_LAT * degY;
  const metres = (i, j, s) => {
    const si = s % width; const sj = (s - si) / width;
    const cos = Math.cos(((lat[j] + lat[sj]) / 2) * Math.PI / 180);
    const ex = (i - si) * degX * M_PER_DEG_LON * cos;
    const ny = (j - sj) * dy;
    return Math.sqrt((ex * ex) + (ny * ny));
  };
  let any = false;
  for (let c = 0; c < n; c += 1) if (isSource(c)) { dist[c] = 0; src[c] = c; any = true; }
  if (!any) return { dist, src };
  const relax = (i, j, ni, nj) => {
    if (ni < 0 || nj < 0 || ni >= width || nj >= height) return;
    const s = src[(nj * width) + ni];
    if (s < 0) return;
    const c = (j * width) + i;
    if (src[c] === s) return;
    const d = metres(i, j, s);
    if (d < dist[c]) { dist[c] = d; src[c] = s; }
  };
  for (let pass = 0; pass < 2; pass += 1) {
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        relax(i, j, i - 1, j); relax(i, j, i - 1, j - 1); relax(i, j, i, j - 1); relax(i, j, i + 1, j - 1);
      }
      for (let i = width - 1; i >= 0; i -= 1) relax(i, j, i + 1, j);
    }
    for (let j = height - 1; j >= 0; j -= 1) {
      for (let i = width - 1; i >= 0; i -= 1) {
        relax(i, j, i + 1, j); relax(i, j, i + 1, j + 1); relax(i, j, i, j + 1); relax(i, j, i - 1, j + 1);
      }
      for (let i = 0; i < width; i += 1) relax(i, j, i - 1, j);
    }
  }
  return { dist, src };
}

/**
 * The zone of every cell. `heights` is the DEM (NaN unknown), `water` a 0/1
 * mask of sea and lakes that is never painted. Returns ids from ZONES, CHANNEL
 * for the river's own water, NONE elsewhere.
 */
export function riverZones({ heights, riverWidth, canal, water = null, width, height, bounds }) {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let b = 0; b + 1 < BANDS.length; b += 1) {
    const lo = BANDS[b]; const hi = BANDS[b + 1];
    const inBand = (c) => riverWidth[c] >= lo && riverWidth[c] < hi;
    let present = false;
    for (let c = 0; c < n && !present; c += 1) present = inBand(c);
    if (!present) continue;
    const { dist, src } = nearestSource(inBand, width, height, bounds);
    for (let c = 0; c < n; c += 1) {
      const s = src[c];
      if (s < 0) continue;
      const w = riverWidth[s];
      const bank = dist[c] - (w / 2);
      let zone = NONE;
      if (bank <= 0) {
        zone = CHANNEL;
      } else {
        for (const z of ZONES) {
          if (bank > z.reach(w)) continue;
          if (z.id === BELT && canal[s]) continue;
          if (z.maxAbove !== undefined) {
            const h = heights[c]; const hs = heights[s];
            if (Number.isFinite(h) && Number.isFinite(hs) && h - hs > z.maxAbove) continue;
          }
          zone = z.id;
          break;
        }
      }
      if (zone === NONE) continue;
      // The innermost any band gives; CHANNEL outranks every zone.
      if (out[c] === NONE || zone === CHANNEL || (out[c] !== CHANNEL && zone < out[c])) out[c] = zone;
    }
  }
  if (water) for (let c = 0; c < n; c += 1) if (water[c] && out[c] !== CHANNEL) out[c] = NONE;
  return out;
}

/**
 * THE RIVERS JUST OUT OF SHOT still reach into it.
 *
 * A floodplain is ten channel widths from the bank, so a 1 km river 5 km
 * outside a view floods half of it — and a view computed on its own box has no
 * such river to measure from. Flying in therefore took zones AWAY: the closer
 * the camera, the smaller the box, the fewer rivers it held.
 *
 * `outer` is the zones computed over a bigger box round the view from the
 * rivers OUTSIDE it only (the view's own rivers are measured here, on the fine
 * heights). Each fine cell takes the innermost of the two — the same rule the
 * width bands already merge by — except that the sea and lakes stay unpainted
 * and a channel is never covered by a zone.
 */
export function mergeOuterZones(classes, outer, bounds, width, height, water = null) {
  if (!outer?.classes) return classes;
  const ob = outer.bounds;
  const ow = outer.width;
  const oh = outer.height;
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    const oj = Math.floor(((ob.north - lat) / (ob.north - ob.south)) * oh);
    if (oj < 0 || oj >= oh) continue;
    for (let i = 0; i < width; i += 1) {
      const c = (j * width) + i;
      if (water?.[c] || classes[c] === CHANNEL) continue;
      const lon = bounds.west + ((i + 0.5) / width) * (bounds.east - bounds.west);
      const oi = Math.floor(((lon - ob.west) / (ob.east - ob.west)) * ow);
      if (oi < 0 || oi >= ow) continue;
      const z = outer.classes[(oj * ow) + oi];
      if (z === NONE) continue;
      if (z === CHANNEL || classes[c] === NONE || z < classes[c]) classes[c] = z;
    }
  }
  return classes;
}

/** Ground area per zone, km², from the grid's own cells. */
export function zoneAreas(classes, width, height, bounds) {
  const R = 6371.0088;
  const dLon = ((bounds.east - bounds.west) / width) * (Math.PI / 180);
  const dLat = ((bounds.north - bounds.south) / height) * (Math.PI / 180);
  const areas = {};
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    const cell = R * R * dLon * dLat * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < width; i += 1) {
      const z = classes[(j * width) + i];
      if (z) areas[z] = (areas[z] || 0) + cell;
    }
  }
  return areas;
}
