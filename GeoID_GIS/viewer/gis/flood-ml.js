/**
 * Flood susceptibility by random forest: the FEATURES and the FOREST, once.
 *
 * The model is trained offline (services/bake-flood-global.py) on the Global
 * Flood Database's observed flood extents, and run in two places: the bake,
 * for the global 0.1° map, and this page, for a view or a drawn area at
 * ~250 m. A forest is only as good as the agreement between the features it
 * was trained on and the features it is fed, and two implementations of
 * "height above the nearest channel" agree until the day one is edited. So
 * the features are computed HERE and nowhere else: the bake hands its fetched
 * inputs to this module through node, the page hands the same inputs fetched
 * the same way, and `flood-ml.test.mjs` pins the arithmetic.
 *
 * Inputs, all reachable from a browser (each answers CORS), so the page needs
 * no proxy and no second recipe:
 *   - elevation      Terrarium PNG tiles (AWS Open Data), decoded as
 *                    dem-tiles.js decodes them
 *   - land cover     Esri / Impact Observatory Sentinel-2 10 m land cover,
 *                    ImageServer exportImage (CC BY 4.0). ESA WorldCover was
 *                    the first choice and its bucket sends no CORS header.
 *   - soil           Pelletier's soil and sediment thickness, the file the
 *                    Soil panel already serves (soil-thickness.js)
 *   - climate        CPC 1991-2020 annual precipitation, baked to a 0.5° asset
 *   - rain           the event's (CPC daily) or today's (Open-Meteo) wettest 3
 *                    days and the 30 days before, on CPC's 0.5° lattice
 *
 * Everything here is pure: arrays in, arrays out. The page's fetching and
 * drawing live in flood-ml-run.js.
 */

/** Feature order. The exported forest carries its own copy and must match. */
export const FEATURES = [
  "elevation_m", "slope_deg", "hand_m", "log10_upstream_km2", "channel_distance_m", "twi", "curvature",
  "water_frac", "trees_frac", "flooded_veg_frac", "crops_frac", "built_frac", "bare_frac", "range_frac",
  "soil_thickness_m", "rain_normal_mm", "rain_3day_max_mm", "rain_30day_mm",
];

/** The two tiers: a ~250 m model run on demand, and the 0.1° global bake. */
export const TIERS = Object.freeze({
  fine: { cell: 0.0025, zoom: 10, lcPerCell: 4, maxCells: 360000 },
  coarse: { cell: 0.1, zoom: 5, lcPerCell: 4, maxCells: Infinity },
});

/**
 * A cell is a CHANNEL once this many cells drain through it. Counted in cells,
 * not km², so the same rule picks out the stream network at 250 m and the
 * great rivers at 0.1° -- a fixed area would make every 0.1° cell a channel
 * and HAND zero everywhere.
 */
export const CHANNEL_CELLS = 50;
export const MAX_CHANNEL_DISTANCE_M = 100000;

/** Esri Sentinel-2 land cover class codes (Impact Observatory, 9 classes). */
export const LC_CLASSES = Object.freeze({
  water_frac: 1, trees_frac: 2, flooded_veg_frac: 4, crops_frac: 5, built_frac: 7, bare_frac: 8, range_frac: 11,
});
export const LC_SERVICE = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer";
/** One year for training and running, so the class mix does not drift. */
export const LC_YEAR = 2020;

/* ── the grid ───────────────────────────────────────────────────────────── */

/** A lon/lat lattice snapped to the cell size, rows north to south. */
export function makeGrid(bounds, cell) {
  const snap = (v, f) => f(v / cell) * cell;
  const west = snap(bounds.west, Math.floor);
  const east = snap(bounds.east, Math.ceil);
  const south = snap(bounds.south, Math.floor);
  const north = snap(bounds.north, Math.ceil);
  const width = Math.max(1, Math.round((east - west) / cell));
  const height = Math.max(1, Math.round((north - south) / cell));
  const midLat = (north + south) / 2;
  return {
    west, east, south, north, width, height, cell,
    mx: cell * 111320 * Math.cos((midLat * Math.PI) / 180),
    my: cell * 110574,
  };
}

export function cellCentre(grid, i) {
  const r = Math.floor(i / grid.width);
  const c = i - r * grid.width;
  return { lon: grid.west + (c + 0.5) * grid.cell, lat: grid.north - (r + 0.5) * grid.cell };
}

/* ── elevation ──────────────────────────────────────────────────────────── */

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const tileX = (lon, n) => ((lon + 180) / 360) * n;
const tileY = (lat, n) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;

/** Which Terrarium tiles a grid needs at a zoom. */
export function tilesFor(grid, zoom) {
  const n = 2 ** zoom;
  const x0 = Math.max(0, Math.floor(tileX(grid.west, n)));
  const x1 = Math.min(n - 1, Math.floor(tileX(grid.east - 1e-9, n)));
  const y0 = Math.max(0, Math.floor(tileY(Math.min(85.05, grid.north), n)));
  const y1 = Math.min(n - 1, Math.floor(tileY(Math.max(-85.05, grid.south + 1e-9), n)));
  return { zoom, x0, x1, y0, y1, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

/** RGB(A) bytes of one tile to metres: dem-tiles.js `decodeTerrarium`. */
export function decodeTile(bytes, channels = 4) {
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * channels;
    out[i] = bytes[o] * 256 + bytes[o + 1] + bytes[o + 2] / 256 - 32768;
  }
  return out;
}

/**
 * The DEM on the grid: bilinear in Web Mercator pixel space over a mosaic of
 * decoded tiles (`mosaic` is cols*256 x rows*256, row-major from the plan's
 * top-left tile). NaN off the mosaic.
 */
export function demOnGrid(mosaic, plan, grid) {
  const n = 2 ** plan.zoom;
  const mw = plan.cols * 256;
  const mh = plan.rows * 256;
  const out = new Float32Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r += 1) {
    const lat = grid.north - (r + 0.5) * grid.cell;
    const py = (tileY(lat, n) - plan.y0) * 256 - 0.5;
    for (let c = 0; c < grid.width; c += 1) {
      const lon = grid.west + (c + 0.5) * grid.cell;
      const px = (tileX(lon, n) - plan.x0) * 256 - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const i = r * grid.width + c;
      if (x0 < 0 || y0 < 0 || x0 >= mw - 1 || y0 >= mh - 1) { out[i] = NaN; continue; }
      const fx = px - x0;
      const fy = py - y0;
      const a = y0 * mw + x0;
      out[i] = mosaic[a] * (1 - fx) * (1 - fy) + mosaic[a + 1] * fx * (1 - fy)
        + mosaic[a + mw] * (1 - fx) * fy + mosaic[a + mw + 1] * fx * fy;
    }
  }
  return out;
}

/* ── terrain: fill, D8, accumulation, HAND, distance, TWI ───────────────── */

const D8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** A binary min-heap over (value, index) in typed arrays. */
class Heap {
  constructor(capacity) { this.v = new Float64Array(capacity); this.i = new Int32Array(capacity); this.n = 0; }
  push(value, index) {
    let k = this.n++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.v[p] <= value) break;
      this.v[k] = this.v[p]; this.i[k] = this.i[p]; k = p;
    }
    this.v[k] = value; this.i[k] = index;
  }
  pop() {
    const topV = this.v[0]; const topI = this.i[0];
    const lastV = this.v[--this.n]; const lastI = this.i[this.n];
    let k = 0;
    for (;;) {
      let m = 2 * k + 1;
      if (m >= this.n) break;
      if (m + 1 < this.n && this.v[m + 1] < this.v[m]) m += 1;
      if (this.v[m] >= lastV) break;
      this.v[k] = this.v[m]; this.i[k] = this.i[m]; k = m;
    }
    this.v[k] = lastV; this.i[k] = lastI;
    this.lastValue = topV;
    return topI;
  }
}

/**
 * Priority-flood with epsilon (Barnes et al. 2014): every hollow is raised to
 * its spill point plus a whisker of gradient, seeded from the grid's edge and
 * every land cell beside the sea. Returns the filled surface and the order
 * cells were settled, which runs downstream to upstream.
 */
export function priorityFlood(dem, mask, grid, eps = 1e-4) {
  const { width: w, height: h } = grid;
  const n = w * h;
  const filled = new Float64Array(n);
  const done = new Uint8Array(n);
  const heap = new Heap(n);
  for (let i = 0; i < n; i += 1) {
    if (!mask[i]) { done[i] = 1; continue; }
    filled[i] = dem[i];
    const r = Math.floor(i / w); const c = i - r * w;
    let edge = r === 0 || c === 0 || r === h - 1 || c === w - 1;
    for (let k = 0; !edge && k < 8; k += 1) {
      if (!mask[(r + D8[k][0]) * w + c + D8[k][1]]) edge = true;
    }
    if (edge) { heap.push(filled[i], i); done[i] = 1; }
  }
  const order = new Int32Array(n);
  let settled = 0;
  while (heap.n) {
    const i = heap.pop();
    const v = filled[i];
    order[settled++] = i;
    const r = Math.floor(i / w); const c = i - r * w;
    for (let k = 0; k < 8; k += 1) {
      const rr = r + D8[k][0]; const cc = c + D8[k][1];
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
      const j = rr * w + cc;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] <= v) filled[j] = v + eps;
      heap.push(filled[j], j);
    }
  }
  return { filled, order: order.subarray(0, settled) };
}

/** Steepest-descent receiver of each cell on the filled surface; -1 at an outlet. */
export function d8Receivers(filled, mask, grid) {
  const { width: w, height: h, mx, my } = grid;
  const recv = new Int32Array(w * h).fill(-1);
  const dist = D8.map(([dr, dc]) => Math.hypot(dr * my, dc * mx));
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      const i = r * w + c;
      if (!mask[i]) continue;
      let best = -1; let drop = 0;
      for (let k = 0; k < 8; k += 1) {
        const rr = r + D8[k][0]; const cc = c + D8[k][1];
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const j = rr * w + cc;
        if (!mask[j]) continue;
        const s = (filled[i] - filled[j]) / dist[k];
        if (s > drop) { drop = s; best = j; }
      }
      recv[i] = best;
    }
  }
  return recv;
}

/**
 * Exact Euclidean distance (metres) to the nearest `source` cell, anisotropic
 * cells: Felzenszwalb & Huttenlocher's two-pass lower envelope, columns then
 * rows, on squared metres.
 */
export function distanceTransform(source, grid) {
  const { width: w, height: h, mx, my } = grid;
  const INF = 1e30;
  const f = new Float64Array(w * h);
  for (let i = 0; i < f.length; i += 1) f[i] = source[i] ? 0 : INF;
  const pass = (get, set, len, step) => {
    const v = new Int32Array(len); const z = new Float64Array(len + 1); const d = new Float64Array(len);
    const g = new Float64Array(len);
    for (let q = 0; q < len; q += 1) g[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q += 1) {
      let s;
      for (;;) {
        const p = v[k];
        s = ((g[q] + (q * step) ** 2) - (g[p] + (p * step) ** 2)) / (2 * step * step * (q - p));
        if (s <= z[k] && k > 0) k -= 1; else break;
      }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q += 1) {
      while (z[k + 1] < q) k += 1;
      d[q] = ((q - v[k]) * step) ** 2 + g[v[k]];
    }
    for (let q = 0; q < len; q += 1) set(q, d[q]);
  };
  for (let c = 0; c < w; c += 1) pass((q) => f[q * w + c], (q, x) => { f[q * w + c] = x; }, h, my);
  for (let r = 0; r < h; r += 1) pass((q) => f[r * w + q], (q, x) => { f[r * w + q] = x; }, w, mx);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sqrt(Math.min(f[i], 1e20));
  return out;
}

/**
 * Every terrain feature from one DEM. `mask` marks land cells; outside it
 * every feature is NaN. Slope and curvature use the neighbours that exist
 * (one-sided at the edge of the land), so the coast has a value instead of a
 * gap -- the NaN that would otherwise need filling is never made.
 */
export function terrain(dem, mask, grid) {
  const { width: w, height: h, mx, my } = grid;
  const n = w * h;
  const { filled, order } = priorityFlood(dem, mask, grid);
  const recv = d8Receivers(filled, mask, grid);
  const acc = new Float64Array(n);
  for (let i = 0; i < n; i += 1) acc[i] = mask[i] ? 1 : 0;
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const i = order[k];
    if (recv[i] >= 0) acc[recv[i]] += acc[i];
  }
  const channel = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) channel[i] = mask[i] && acc[i] >= CHANNEL_CELLS ? 1 : 0;
  const drain = new Float64Array(n);
  for (let k = 0; k < order.length; k += 1) {
    const i = order[k];
    const j = recv[i];
    drain[i] = channel[i] || j < 0 ? dem[i] : drain[j];
  }
  const dist = distanceTransform(channel, grid);
  const cellKm2 = (mx * my) / 1e6;
  const out = {
    elevation_m: new Float32Array(n), slope_deg: new Float32Array(n), hand_m: new Float32Array(n),
    log10_upstream_km2: new Float32Array(n), channel_distance_m: new Float32Array(n),
    twi: new Float32Array(n), curvature: new Float32Array(n),
  };
  const z = (r, c) => {
    if (r < 0 || c < 0 || r >= h || c >= w) return NaN;
    const j = r * w + c;
    return mask[j] ? dem[j] : NaN;
  };
  const side = (a, b, s) => (Number.isFinite(a) && Number.isFinite(b) ? (a - b) / (2 * s) : 0);
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      const i = r * w + c;
      if (!mask[i]) {
        for (const k in out) out[k][i] = NaN;
        continue;
      }
      const zc = dem[i];
      const zw = z(r, c - 1); const ze = z(r, c + 1); const zn = z(r - 1, c); const zs = z(r + 1, c);
      const gx = Number.isFinite(zw) && Number.isFinite(ze) ? side(ze, zw, mx)
        : Number.isFinite(ze) ? (ze - zc) / mx : Number.isFinite(zw) ? (zc - zw) / mx : 0;
      const gy = Number.isFinite(zn) && Number.isFinite(zs) ? side(zs, zn, my)
        : Number.isFinite(zs) ? (zs - zc) / my : Number.isFinite(zn) ? (zc - zn) / my : 0;
      const slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
      let lap = 0;
      for (const v of [zw, ze, zn, zs]) lap += Number.isFinite(v) ? v - zc : 0;
      const a = (acc[i] * cellKm2 * 1e6) / Math.sqrt(mx * my);
      out.elevation_m[i] = zc;
      out.slope_deg[i] = slope;
      out.hand_m[i] = Math.max(0, zc - drain[i]);
      out.log10_upstream_km2[i] = Math.log10(acc[i] * cellKm2);
      // Capped: an island with no channel would otherwise measure to a river
      // on the next continent (10,430 km was seen at 0.1°), a number about the
      // grid's edge rather than the ground.
      out.channel_distance_m[i] = Math.min(dist[i], MAX_CHANNEL_DISTANCE_M);
      out.twi[i] = Math.log(a / Math.tan((Math.max(slope, 0.1) * Math.PI) / 180));
      out.curvature[i] = lap;
    }
  }
  return out;
}

/* ── land cover, soil, rain ─────────────────────────────────────────────── */

/**
 * Class fractions per cell from a class raster exported at `k` pixels per cell
 * edge (`classes` is (grid.width*k) x (grid.height*k)). 0 is no data; a cell
 * whose pixels are all no data is NaN in every fraction.
 */
export function landCover(classes, grid, k) {
  const n = grid.width * grid.height;
  const out = {};
  for (const name of Object.keys(LC_CLASSES)) out[name] = new Float32Array(n);
  const valid = new Float32Array(n);
  const cw = grid.width * k;
  const codeTo = new Map(Object.entries(LC_CLASSES).map(([name, code]) => [code, out[name]]));
  for (let y = 0; y < grid.height * k; y += 1) {
    const r = Math.floor(y / k);
    for (let x = 0; x < cw; x += 1) {
      const v = classes[y * cw + x];
      if (!v) continue;
      const i = r * grid.width + Math.floor(x / k);
      valid[i] += 1;
      const arr = codeTo.get(v);
      if (arr) arr[i] += 1;
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (const name in out) out[name][i] = valid[i] ? out[name][i] / valid[i] : NaN;
  }
  return { fractions: out, valid };
}

/** The exportImage request that gives `landCover` its input. */
export function landCoverUrl(grid, k) {
  const time = `${Date.UTC(LC_YEAR, 0, 1)},${Date.UTC(LC_YEAR, 11, 31, 23, 59, 59)}`;
  return `${LC_SERVICE}/exportImage?bbox=${grid.west},${grid.south},${grid.east},${grid.north}`
    + `&bboxSR=4326&imageSR=4326&size=${grid.width * k},${grid.height * k}&format=tiff&pixelType=U8`
    + `&interpolation=RSP_NearestNeighbor&time=${time}&f=image`;
}

/**
 * Soil thickness (m) at each cell centre, from a native window of Pelletier's
 * 30" grid ({band, width, height, origin, degrees, world, noData} as
 * soil-thickness.js `thicknessGridFor` returns it). Nearest cell, NaN on
 * no-data: the same cell `sampleAt` answers for.
 */
export function soilOnGrid(win, grid) {
  const n = grid.width * grid.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const { lon, lat } = cellCentre(grid, i);
    const x = Math.floor((lon - win.world.west) / win.degrees) - win.origin.x;
    const y = Math.floor((win.world.north - lat) / win.degrees) - win.origin.y;
    const v = x >= 0 && y >= 0 && x < win.width && y < win.height ? win.band[y * win.width + x] : win.noData;
    out[i] = v === win.noData ? NaN : v;
  }
  return out;
}

/**
 * A field on a regular lon/lat lattice (`lat0`/`lon0` the first row/column
 * centres, `step` degrees, rows running south when `step` < 0 in lat) onto
 * the grid, bilinear, clamped at the lattice's edge. NaN lattice values are
 * skipped and the weights renormalised, so one missing gauge cell does not
 * blank four of ours.
 */
export function latticeOnGrid(field, lattice, grid) {
  const { nLat, nLon, lat0, lon0, dLat, dLon } = lattice;
  const n = grid.width * grid.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const { lon, lat } = cellCentre(grid, i);
    const fy = Math.min(Math.max((lat - lat0) / dLat, 0), nLat - 1);
    let fx = (lon - lon0) / dLon;
    if (lattice.wrap) fx = ((fx % nLon) + nLon) % nLon;
    fx = Math.min(Math.max(fx, 0), nLon - 1);
    const y0 = Math.min(Math.floor(fy), nLat - 2 < 0 ? 0 : nLat - 2);
    const x0 = Math.min(Math.floor(fx), nLon - 2 < 0 ? 0 : nLon - 2);
    const ty = nLat > 1 ? fy - y0 : 0;
    const tx = nLon > 1 ? fx - x0 : 0;
    let sum = 0; let wsum = 0;
    for (const [yy, xx, wgt] of [[y0, x0, (1 - tx) * (1 - ty)], [y0, x0 + 1, tx * (1 - ty)],
      [y0 + 1, x0, (1 - tx) * ty], [y0 + 1, x0 + 1, tx * ty]]) {
      if (yy >= nLat || xx >= nLon || wgt <= 0) continue;
      const v = field[yy * nLon + xx];
      if (!Number.isFinite(v)) continue;
      sum += v * wgt; wsum += wgt;
    }
    out[i] = wsum > 0 ? sum / wsum : NaN;
  }
  return out;
}

/** The wettest run of 3 consecutive days in a daily series (NaN days as 0). */
export function wettest3(days) {
  let best = 0;
  for (let i = 0; i + 3 <= Math.max(3, days.length); i += 1) {
    let s = 0;
    for (let k = i; k < i + 3 && k < days.length; k += 1) s += Number.isFinite(days[k]) ? days[k] : 0;
    if (s > best) best = s;
  }
  return best;
}

/* ── assembling rows ────────────────────────────────────────────────────── */

/**
 * The feature matrix (row-major Float32Array, FEATURES order) for the cells
 * in `cells` (indices into the grid). A cell with any non-finite feature is
 * left out and reported, never filled with a guess here -- the gap rules are
 * the caller's to state (see the bake's FILLS).
 */
export function featureRows(stack, cells, features = FEATURES) {
  const F = features.length;
  const rows = new Float32Array(cells.length * F);
  const kept = [];
  let dropped = 0;
  for (const i of cells) {
    const base = kept.length * F;
    let ok = true;
    for (let f = 0; f < F; f += 1) {
      const v = stack[features[f]][i];
      if (!Number.isFinite(v)) { ok = false; break; }
      rows[base + f] = v;
    }
    if (ok) kept.push(i); else dropped += 1;
  }
  return { rows: rows.subarray(0, kept.length * F), cells: Int32Array.from(kept), dropped };
}

/**
 * Nearest-valid fill inside the mask, for a feature whose source has holes
 * (a land-cover pixel block of clouds, a soil cell of no data). Returns the
 * number of cells filled so the caller can publish it.
 */
export function fillNearest(arr, mask, grid) {
  const src = new Uint8Array(arr.length);
  let gaps = 0;
  for (let i = 0; i < arr.length; i += 1) {
    if (Number.isFinite(arr[i])) src[i] = 1;
    else if (mask[i]) gaps += 1;
  }
  if (!gaps) return 0;
  // A breadth-first spread from every valid cell: the nearest by steps, which
  // is the nearest by distance to within a cell on a near-square grid.
  const queue = new Int32Array(arr.length);
  let head = 0; let tail = 0;
  for (let i = 0; i < arr.length; i += 1) if (src[i]) queue[tail++] = i;
  const { width: w, height: h } = grid;
  while (head < tail) {
    const i = queue[head++];
    const r = Math.floor(i / w); const c = i - r * w;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr; const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
      const j = rr * w + cc;
      if (src[j]) continue;
      src[j] = 1; arr[j] = arr[i]; queue[tail++] = j;
    }
  }
  return gaps;
}

/**
 * The whole stack for a grid, from inputs already on it (or, for land cover,
 * at `lcK` pixels per cell). Shared by the bake (through node) and the page,
 * so the land mask and every gap rule are one rule.
 *
 *   land     DEM finite and >= -10 m (Terrarium carries bathymetry; -10 keeps
 *            the polders and the Caspian shore) AND at least half the cell's
 *            land-cover pixels hold a class (the service has no data at sea)
 *   gaps     soil no-data, a land-cover block that is all cloud, a rain cell
 *            missing: nearest valid cell, COUNTED and returned
 */
export function buildStack({ grid, dem, lcClasses, lcK, soil, rainNormal, rain3, rain30 }) {
  const n = grid.width * grid.height;
  const { fractions, valid } = landCover(lcClasses, grid, lcK);
  const mask = new Uint8Array(n);
  let land = 0;
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(dem[i]) && dem[i] >= -10 && valid[i] >= 0.5 * lcK * lcK) { mask[i] = 1; land += 1; }
  }
  const stack = { ...terrain(dem, mask, grid), ...fractions,
    soil_thickness_m: soil, rain_normal_mm: rainNormal, rain_3day_max_mm: rain3, rain_30day_mm: rain30 };
  const fills = {};
  for (const name of ["soil_thickness_m", ...Object.keys(LC_CLASSES), "rain_normal_mm", "rain_3day_max_mm", "rain_30day_mm"]) {
    fills[name] = fillNearest(stack[name], mask, grid);
  }
  for (const name of FEATURES) {
    const a = stack[name];
    for (let i = 0; i < n; i += 1) if (!mask[i]) a[i] = NaN;
  }
  return { stack, mask, land, fills };
}

/* ── the forest ─────────────────────────────────────────────────────────── */

function b64ToBytes(s) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The exported forest (services/bake-flood-global.py `export_forest`): per
 * tree, feature (int16, -2 at a leaf), threshold (float64), left/right (int32,
 * -1 at a leaf) and value (float32, the leaf's fraction of "flooded"), each
 * base64 little-endian.
 */
export function decodeForest(json) {
  const view = (b64, T) => { const b = b64ToBytes(b64); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
  return {
    ...json,
    trees: json.trees.map((t) => ({
      feature: view(t.feature, Int16Array), threshold: view(t.threshold, Float64Array),
      left: view(t.left, Int32Array), right: view(t.right, Int32Array), value: view(t.value, Float32Array),
    })),
  };
}

/**
 * P(flooded) per row: the mean over trees of the leaf's class fraction, which
 * is scikit-learn's predict_proba. `x <= threshold` goes left, as there; the
 * row is float32 like sklearn's own cast, the threshold float64.
 */
export function predictForest(forest, rows, nFeatures = FEATURES.length) {
  const n = rows.length / nFeatures;
  const out = new Float32Array(n);
  const T = forest.trees.length;
  for (let r = 0; r < n; r += 1) {
    const base = r * nFeatures;
    let s = 0;
    for (let t = 0; t < T; t += 1) {
      const tree = forest.trees[t];
      let node = 0;
      while (tree.left[node] !== -1) {
        node = rows[base + tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
      }
      s += tree.value[node];
    }
    out[r] = s / T;
  }
  return out;
}
