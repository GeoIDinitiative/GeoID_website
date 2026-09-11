/**
 * FLOOD INUNDATION — how far a river's water reaches when it rises, on the
 * streamed DEM, for every GRWL river at once.
 *
 * The river corridor zones say where a river MIGHT go, by distance. This says
 * where a given flood DOES go, by height: it raises each river's water surface
 * by a stage that depends on the river and the flood, and floods the ground
 * that stands below that surface and is joined to the river through ground
 * that is also under it. The model is one line:
 *
 *   flooded(c)  ⇔  h(c) < h(r) + rise(W, Q)   and  c is joined to the channel
 *   depth(c)    =  h(r) + rise(W, Q) − h(c)
 *
 * r is the nearest river cell (found per band of widths, as the zones do, so a
 * stream cannot hide a big river's flood), h the streamed heights and W that
 * river's width at mean flow from GRWL.
 *
 * THE RISE COMES FROM THE RIVER'S OWN SIZE, because a metre is nothing on the
 * Amazon and a disaster on a stream:
 *
 *   D(W)     = 0.27 (W / 7.2)^0.6           channel depth from width
 *   rise     = D(W) · ((Q/Q̄)^f − 1) + extra
 *
 * D eliminates Q from Moody & Troutman's (2002) global downstream relations,
 * w = 7.2 Q^0.5 and d = 0.27 Q^0.3 — fitted at bankfull, applied here to
 * GRWL's mean-flow width, so it is an order-of-magnitude depth rather than a
 * surveyed one. The rise is at-a-station hydraulic geometry: depth grows as
 * discharge to the power f, 0.40 on Leopold & Maddock's (1953) average. Q/Q̄ is
 * the flood's discharge as a multiple of the river's mean flow, which is what
 * each scenario sets.
 *
 * AN UPPER SCREENING ESTIMATE, and it says so wherever it is shown. Past the
 * bank the water spreads over the floodplain and rises more slowly than the
 * in-channel law says; there are no defences finer than the DEM, no
 * attenuation, no volume limit and no tide. A reach cap in channel widths
 * stands in for the last: a flat stage carried without one floods whole
 * deltas from a single river.
 */

import { nearestSource, BANDS } from "./river-zones.js?v=20260911-bc6912f";

/** Leopold & Maddock (1953), the average at-a-station exponent of depth on discharge. */
export const DEPTH_EXPONENT = 0.40;

/**
 * The flood a scenario means, as a discharge against the river's mean flow.
 *
 * Only the annual flood's figure is a convention (bankfull ≈ the 50% annual
 * exceedance flood); the ratios are ASSUMED typical values and every one is a
 * slider, because they vary by an order of magnitude between a chalk stream,
 * a monsoon river and a desert wash. The 10- and 100-year floods take growth
 * factors of 1.6 and 2.5 over the annual flood, typical of humid-temperate
 * regional growth curves; arid rivers are far steeper.
 */
export const SCENARIOS = [
  { id: "seasonal", label: "Seasonal high", flow: 2, widthCap: Infinity,
    title: "The ordinary wet-season high: twice the mean flow. Water rises within "
      + "the banks on most rivers; this is the ground that is wet most years." },
  { id: "winter", label: "Winter flood", flow: 5, widthCap: Infinity,
    title: "The annual flood, about bankfull: taken as five times the mean flow "
      + "(an assumed typical ratio). Roughly the flood a river reaches one year in two." },
  { id: "ten", label: "1 in 10 years", flow: 8, widthCap: Infinity,
    title: "A 10% chance in any year: 1.6 times the annual flood, a typical "
      + "humid-temperate growth factor." },
  { id: "hundred", label: "1 in 100 years", flow: 12.5, widthCap: Infinity,
    title: "A 1% chance in any year — the flood planners design against: 2.5 times "
      + "the annual flood, a typical humid-temperate growth factor." },
  { id: "flash", label: "Flash flood", flow: 25, widthCap: 100,
    title: "A short, violent flood in small steep channels: 25 times the mean flow, "
      + "and only rivers up to 100 m wide respond — big rivers are too slow to "
      + "flash. GRWL starts at 30 m, so the gullies that flash first are not mapped." },
];

export const DEFAULTS = Object.freeze({
  scenario: "hundred", flow: 12.5, exponent: DEPTH_EXPONENT, extra: 0,
  reach: 20, widthCap: Infinity, connected: true, defended: true,
});

/** The channel's depth in metres, from its width in metres. */
export function channelDepth(widthM) {
  return 0.27 * ((Math.max(Number(widthM) || 0, 1) / 7.2) ** 0.6);
}

/** How far this river's water surface rises above its mean-flow level, in metres. */
export function stageRise(widthM, params = DEFAULTS) {
  // Below the mean the river FALLS: a negative rise, which floods nothing.
  const flow = Math.max(0.01, Number(params.flow) || 1);
  const f = Number.isFinite(params.exponent) ? params.exponent : DEPTH_EXPONENT;
  const responds = widthM <= (params.widthCap ?? Infinity);
  const rise = responds ? channelDepth(widthM) * ((flow ** f) - 1) : 0;
  return rise + (Number(params.extra) || 0);
}

/**
 * A river's MEAN discharge from its width, m³/s: Moody & Troutman's (2002)
 * w = 7.2 Q^0.5 turned round. An order of magnitude, and said so wherever it
 * is shown — the relation is fitted at bankfull and GRWL's width is the
 * mean-flow one, so it tends high (measured: the Rhône at 405 m reads about
 * 3,200 m³/s against about 1,700 gauged at Beaucaire). A gauged mean typed in
 * replaces it.
 */
export function meanFlowFromWidth(widthM) {
  return (Math.max(Number(widthM) || 0, 1) / 7.2) ** 2;
}

/**
 * ONE RIVER, out of a network that names none of them.
 *
 * GRWL is centrelines with widths and no river identifiers, so "this river" is
 * the channel JOINED to the river cell nearest the pick through cells of
 * similar width — within `tolerance` times the seed's, so a tributary a third
 * of its size stays out (it is carrying its own flow, not this one) while the
 * river's own widening and narrowing along its course stays in. `pick.width`
 * keeps the same river on a second grid (the ground round the view), where the
 * nearest cell to the pick might belong to another.
 *
 * Returns the mask, the seed cell, and the MEDIAN width of the cells selected —
 * the width the mean flow is estimated from, because one cell's width on a
 * braided reach is a poor account of the river.
 */
export function selectRiver(riverWidth, width, height, bounds, pick, { tolerance = 2.5 } = {}) {
  const mask = new Uint8Array(width * height);
  if (!pick || !Number.isFinite(pick.lat) || !Number.isFinite(pick.lon)) {
    return { mask, seed: -1, width: null, cells: 0 };
  }
  const degX = (bounds.east - bounds.west) / width;
  const degY = (bounds.north - bounds.south) / height;
  const cos = Math.cos((pick.lat * Math.PI) / 180);
  const fits = (w) => !Number.isFinite(pick.width)
    || (w >= pick.width / tolerance && w <= pick.width * tolerance);
  let seed = -1; let best = Infinity;
  for (let c = 0; c < riverWidth.length; c += 1) {
    const w = riverWidth[c];
    if (!(w > 0) || !fits(w)) continue;
    const i = c % width; const j = (c - i) / width;
    const lon = bounds.west + ((i + 0.5) * degX);
    const lat = bounds.north - ((j + 0.5) * degY);
    const d = ((lon - pick.lon) * cos) ** 2 + (lat - pick.lat) ** 2;
    if (d < best) { best = d; seed = c; }
  }
  if (seed < 0) return { mask, seed, width: null, cells: 0 };
  const w0 = Number.isFinite(pick.width) ? pick.width : riverWidth[seed];
  const lo = w0 / tolerance; const hi = w0 * tolerance;
  const queue = new Int32Array(width * height);
  let head = 0; let tail = 0;
  mask[seed] = 1; queue[tail] = seed; tail += 1;
  while (head < tail) {
    const c = queue[head]; head += 1;
    const ci = c % width; const cj = (c - ci) / width;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const ni = ci + di; const nj = cj + dj;
        if ((!di && !dj) || ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
        const m = (nj * width) + ni;
        const w = riverWidth[m];
        if (mask[m] || !(w >= lo && w <= hi)) continue;
        mask[m] = 1; queue[tail] = m; tail += 1;
      }
    }
  }
  const widths = [];
  for (let k = 0; k < tail; k += 1) widths.push(riverWidth[queue[k]]);
  widths.sort((a, b) => a - b);
  return { mask, seed, width: widths[Math.floor(widths.length / 2)], cells: tail };
}

/** The nearest cell of ONE river, for the discharge model: a single field. */
export function riverField(mask, width, height, bounds) {
  let any = false;
  for (let c = 0; c < mask.length && !any; c += 1) any = mask[c] === 1;
  if (!any) return [];
  return [{ lo: 0, hi: Infinity, ...nearestSource((c) => mask[c] === 1, width, height, bounds) }];
}

/** The discharge a flood of `q` m³/s is, against a mean of `mean`: the model's Q/Q̄. */
export function flowRatio(q, mean) {
  const r = Number(q) / Number(mean);
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * The nearest river cell of every cell, per band of widths. Geometry only —
 * it does not depend on the flood — so it is computed once per view and every
 * slider after that costs arithmetic.
 */
export function sourceFields(riverWidth, width, height, bounds) {
  const fields = [];
  for (let b = 0; b + 1 < BANDS.length; b += 1) {
    const lo = BANDS[b]; const hi = BANDS[b + 1];
    const inBand = (c) => riverWidth[c] >= lo && riverWidth[c] < hi;
    let present = false;
    for (let c = 0; c < riverWidth.length && !present; c += 1) present = inBand(c);
    if (!present) continue;
    fields.push({ lo, hi, ...nearestSource(inBand, width, height, bounds) });
  }
  return fields;
}

/**
 * The flood. Returns the DEPTH of water over every cell it reaches — over the
 * river's own channel, the rise above its normal level — NaN where dry and
 * over the sea and lakes, which are water already; and the cells below the
 * flood that it could not reach.
 */
export function inundate({ heights, riverWidth, water = null, fields, width, height, params = DEFAULTS }) {
  const n = width * height;
  const depth = new Float32Array(n).fill(NaN);
  const channel = new Uint8Array(n);
  const reach = Number.isFinite(params.reach) ? params.reach : DEFAULTS.reach;
  const defended = params.defended !== false;
  const riseOf = new Map();
  const surfaceOf = new Map();
  const below = new Uint8Array(n);
  const channelRise = new Float32Array(n);
  // The river's normal level behind every wet cell, so a level handed on to
  // another grid is SURFACE + rise, never a channel cell's own (bank-high)
  // height + rise — and so that grid can tell ground below the river from
  // ground under the flood.
  const normal = new Float32Array(n).fill(NaN);
  /**
   * THE RIVER'S SURFACE IS THE LOWEST GROUND AT IT. A grid cell on a
   * centreline also holds some of the bank, and on a narrow river most of it,
   * so its height reads high; the lowest of it and its eight neighbours is the
   * water. Reading it high floods everything a bank's height below it.
   */
  const surface = (s) => {
    let v = surfaceOf.get(s);
    if (v !== undefined) return v;
    const si = s % width; const sj = (s - si) / width;
    v = Infinity;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const i = si + di; const j = sj + dj;
        if (i < 0 || j < 0 || i >= width || j >= height) continue;
        const h = heights[(j * width) + i];
        if (Number.isFinite(h) && h < v) v = h;
      }
    }
    if (!Number.isFinite(v)) v = NaN;
    surfaceOf.set(s, v);
    return v;
  };
  for (const field of fields || []) {
    const { dist, src } = field;
    for (let c = 0; c < n; c += 1) {
      const s = src[c];
      if (s < 0) continue;
      const w = riverWidth[s];
      const bank = dist[c] - (w / 2);
      if (bank <= 0) {
        channel[c] = 1;
        // The channel is under the flood too: its water stands the river's
        // rise above its normal level, the same surface the banks see.
        let rise = riseOf.get(w);
        if (rise === undefined) { rise = stageRise(w, params); riseOf.set(w, rise); }
        if (rise > channelRise[c]) { channelRise[c] = rise; normal[c] = surface(s); }
        continue;
      }
      if (bank > reach * w) continue;
      const hs = surface(s); const hc = heights[c];
      if (!Number.isFinite(hs) || !Number.isFinite(hc)) continue;
      /**
       * GROUND ALREADY BELOW THE RIVER at mean flow is not flooded every day,
       * so something the heights cannot see is keeping the river off it: a
       * levee (the Rhône runs above the Camargue), a polder dyke, or a DEM
       * wrong at the channel. With defences holding it is left dry and
       * counted; with them failing it floods with the rest.
       */
      if (hc < hs) {
        below[c] = 1;
        if (defended) continue;
      }
      let rise = riseOf.get(w);
      if (rise === undefined) { rise = stageRise(w, params); riseOf.set(w, rise); }
      const d = hs + rise - hc;
      if (d > 0 && !(depth[c] >= d)) { depth[c] = d; normal[c] = hs; }
    }
  }
  const cutOff = new Uint8Array(n);
  if (params.connected !== false) {
    // Joined to the channel through ground that is itself under the flood.
    // Open water conducts (a river through a lake floods both shores) but is
    // never painted.
    const conducts = (c) => depth[c] > 0 || channel[c] === 1 || (water && water[c]);
    const reached = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0; let tail = 0;
    for (let c = 0; c < n; c += 1) {
      if (channel[c]) { reached[c] = 1; queue[tail] = c; tail += 1; }
    }
    while (head < tail) {
      const c = queue[head]; head += 1;
      const ci = c % width; const cj = (c - ci) / width;
      for (let dj = -1; dj <= 1; dj += 1) {
        const nj = cj + dj;
        if (nj < 0 || nj >= height) continue;
        for (let di = -1; di <= 1; di += 1) {
          const ni = ci + di;
          if ((!di && !dj) || ni < 0 || ni >= width) continue;
          const m = (nj * width) + ni;
          if (reached[m] || !conducts(m)) continue;
          reached[m] = 1; queue[tail] = m; tail += 1;
        }
      }
    }
    for (let c = 0; c < n; c += 1) {
      if (depth[c] > 0 && !reached[c]) { cutOff[c] = 1; depth[c] = NaN; }
    }
  }
  // Defended: below the river's normal level and, with defences holding, dry
  // — unless another river's flood reaches it on its own terms.
  const behind = new Uint8Array(n);
  for (let c = 0; c < n; c += 1) {
    if (water && water[c]) { depth[c] = NaN; continue; }
    /**
     * THE CHANNEL IS PAINTED, with the flood's height above the river's normal
     * level. Left out, a flood that should be one sheet of water had a hole
     * down its middle exactly where the river runs — which reads as the river
     * being the one place that stays dry. It is still water every day, so the
     * areas and the deepest reading leave it out (`floodAreas`).
     */
    if (channel[c]) {
      const d = Math.max(channelRise[c], depth[c] > 0 ? depth[c] : 0);
      depth[c] = d > 0 ? d : NaN;
      continue;
    }
    if (defended && below[c] && !(depth[c] > 0)) behind[c] = 1;
  }
  /**
   * THE WATER LEVEL, for a grid that reads this one. Ground: its height plus
   * its depth, which is the river's surface plus the rise. The channel: the
   * river's SURFACE plus the rise — its own height reads high (it holds the
   * bank), so height + depth there overstated the level beside every narrow
   * river, and a finer grid reading it flooded ground metres too deep.
   */
  const level = new Float32Array(n).fill(NaN);
  for (let c = 0; c < n; c += 1) {
    if (!(depth[c] > 0)) continue;
    if (channel[c] && Number.isFinite(normal[c])) level[c] = normal[c] + channelRise[c];
    else if (Number.isFinite(heights[c])) level[c] = heights[c] + depth[c];
  }
  return { depth, channel, cutOff, defended: behind, level, normal };
}

/**
 * Floods reaching in from rivers just out of shot, computed over the ground
 * round the view: taken where the view's own flood is dry, never over the
 * view's own answer or its water.
 */
export function mergeOuterDepth(depth, outer, bounds, width, height, water = null, heights = null,
  { defended = true } = {}) {
  if (!outer?.depth && !outer?.level) return depth;
  const ob = outer.bounds; const ow = outer.width; const oh = outer.height;
  /**
   * The WATER LEVEL comes in, not the depth, and it is INTERPOLATED between the
   * coarse cells' centres. Pasting a coarse cell's depth drew the outer flood
   * as blocks a context cell wide; reading its level at the coarse cell alone
   * still stopped the flood at the coarse cell's edge. Interpolated from
   * whichever of the four surrounding centres are under water, the level
   * reaches half a coarse cell past them, and this view's own heights decide
   * where in that the water actually stops.
   */
  const levelAt = (x, y, field = outer.level) => {
    const fx = x - 0.5; const fy = y - 0.5;
    const i0 = Math.floor(fx); const j0 = Math.floor(fy);
    const tx = fx - i0; const ty = fy - j0;
    let sum = 0; let wsum = 0;
    for (const [di, dj, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)],
      [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const i = Math.min(ow - 1, Math.max(0, i0 + di));
      const j = Math.min(oh - 1, Math.max(0, j0 + dj));
      // Only centres under water carry a level, and the normal level is read
      // at those same centres, so the two are one interpolation.
      if (!Number.isFinite(outer.level[(j * ow) + i])) continue;
      const v = field[(j * ow) + i];
      if (Number.isFinite(v) && wgt > 0) { sum += v * wgt; wsum += wgt; }
    }
    return wsum > 0 ? sum / wsum : NaN;
  };
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    const y = ((ob.north - lat) / (ob.north - ob.south)) * oh;
    if (y < 0 || y >= oh) continue;
    for (let i = 0; i < width; i += 1) {
      const c = (j * width) + i;
      if (water?.[c] || depth[c] > 0) continue;
      const lon = bounds.west + ((i + 0.5) / width) * (bounds.east - bounds.west);
      const x = ((lon - ob.west) / (ob.east - ob.west)) * ow;
      if (x < 0 || x >= ow) continue;
      let d;
      if (outer.level && heights && Number.isFinite(heights[c])) {
        d = levelAt(x, y) - heights[c];
        /**
         * GROUND BELOW THE RIVER'S NORMAL LEVEL is defended here too, as it is
         * in the view's own model. Without it the flood carried in from out of
         * shot poured into every pit, quarry and neighbouring channel lower
         * than the river it came from — measured, 12 m of water on a 1.1 m
         * rise, at the view's edge.
         */
        if (d > 0 && defended && outer.normal && heights[c] < levelAt(x, y, outer.normal)) d = 0;
      } else {
        d = outer.depth?.[(Math.floor(y) * ow) + Math.floor(x)];
      }
      if (d > 0) depth[c] = d;
    }
  }
  return depth;
}

/**
 * Depth classes a reader can picture, from the US National Weather Service's
 * "Turn Around Don't Drown": six inches of moving water can knock an adult
 * over, a foot can carry most cars away, two feet SUVs and trucks.
 */
export const DEPTH_CLASSES = [
  { max: 0.15, label: "Under 15 cm", colour: [198, 219, 239] },
  { max: 0.3, label: "15–30 cm · moving water knocks an adult over", colour: [158, 202, 225] },
  { max: 0.6, label: "30–60 cm · rushing water carries cars away", colour: [107, 174, 214] },
  { max: 1.5, label: "0.6–1.5 m · and SUVs and trucks", colour: [66, 146, 198] },
  { max: 3, label: "1.5–3 m · ground floors filled", colour: [33, 113, 181] },
  { max: Infinity, label: "Over 3 m · above a single storey", colour: [8, 69, 148] },
];

export function depthClass(d) {
  if (!(d > 0)) return -1;
  return DEPTH_CLASSES.findIndex((k) => d <= k.max);
}

export function depthColour(d) {
  const k = depthClass(d);
  return k < 0 ? null : DEPTH_CLASSES[k].colour;
}

/** Flooded ground per depth class and cut-off ground, in km², off the grid's own cells. */
export function floodAreas(depth, cutOff, width, height, bounds, defended = null, channel = null) {
  const R = 6371.0088;
  const dLon = ((bounds.east - bounds.west) / width) * (Math.PI / 180);
  const dLat = ((bounds.north - bounds.south) / height) * (Math.PI / 180);
  const byClass = DEPTH_CLASSES.map(() => 0);
  let cut = 0; let deepest = 0; let held = 0;
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    const cell = R * R * dLon * dLat * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < width; i += 1) {
      const c = (j * width) + i;
      // The river's own channel is water every day, not ground the flood took.
      const k = channel?.[c] ? -1 : depthClass(depth[c]);
      if (k >= 0) { byClass[k] += cell; if (depth[c] > deepest) deepest = depth[c]; }
      if (cutOff?.[c]) cut += cell;
      if (defended?.[c]) held += cell;
    }
  }
  return { byClass, total: byClass.reduce((a, v) => a + v, 0), cutOff: cut, deepest, defended: held };
}
