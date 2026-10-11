/**
 * ONE UNIT IS ONE POLYGON, WHATEVER TILES IT WAS STREAMED IN.
 *
 * "Polygons become discontinuous across mapping boundaries, crippling our
 * sim/modelling process by hindering the map extraction." A vector tile CUTS
 * every polygon at its own edge — `mvt.js` then clips the buffer away so the
 * same ground is not drawn twice (see `clipRingToTile`) — so a geological unit
 * spanning four tiles reaches an extraction as four features, each with a
 * dead-straight artificial edge along the tile boundary. Nothing in the data
 * says those edges exist; they are the grid of the tiler, and every downstream
 * consumer (a clip, an area, a Model Builder region, a sampled column, an
 * export) inherits the grid as if it were geology.
 *
 * WHAT THIS DOES. For features from tiles at ONE zoom it dissolves the
 * fragments of each unit back together across the tile seams:
 *
 * 1. **Snap to the seam.** A vertex within rounding (`mvt.js` projects to six
 *    decimals) of its own tile's edge is put exactly on that edge, and
 *    vertices on a shared seam line from either side that sit within a couple
 *    of tile units of each other are pulled to one value (a tile corner wins
 *    if it is in the cluster). Both tiles clip the SAME source geometry on the
 *    same integer grid, so in practice the cut points already coincide; the
 *    snap only absorbs rounding and the occasional differing simplification.
 * 2. **Cancel the shared edges.** Every ring is oriented (outer CCW, holes
 *    CW, interior always on the left), every edge lying ALONG a seam is split
 *    at every other seam vertex on that line, and then each directed edge
 *    that meets its exact reverse is removed with it. That is a planar union
 *    for pieces whose interiors do not overlap — which tile-clipped fragments
 *    at one zoom cannot — and it costs a hash map, not boolean geometry. It
 *    also cannot drop a hole, which the general `GP.union` does.
 * 3. **Re-trace the rings** from what is left, turning as far left as possible
 *    at a pinch so touching lobes come out as separate simple rings, and drop
 *    the now-collinear vertices left where a boundary used to cross a seam.
 *    Rings are re-grouped by containment, as `mvt.js` does on decode.
 *
 * Identity is `map_id` (one mapped polygon in Macrostrat's terms), else the
 * full attribute set — never the colour, which many different units share.
 * Different units are never merged. A unit whose pieces do not actually meet
 * across a seam is left exactly as it arrived, object and all.
 *
 * WHAT THIS IS NOT: a cure for a mixed-zoom set. Fragments at two zooms
 * overlap and are generalised differently; the caller resolves a single zoom
 * first (`features()` returns the finest on screen, `featuresIn` one level
 * per probe) and merges within it.
 */

const EDGE_EPS = 1.5e-6;     // mvt.js rounds to 1e-6 degrees

/** A tile's exact bounds, the same formula as `mvt.js`'s projector. */
export function tileBoundsOf(z, x, y) {
  const n = 2 ** z;
  const lat = (yy) => {
    const t = Math.PI * (1 - (2 * yy) / n);
    return (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  };
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: lat(y),
    south: lat(y + 1),
  };
}

/** Which UNIT a feature is a piece of — `map_id`, else every attribute. */
export function unitKeyOf(feature) {
  const p = feature?.properties || {};
  if (p.map_id !== undefined && p.map_id !== null && p.map_id !== "") return `m:${p.map_id}`;
  const keys = Object.keys(p).sort();
  if (!keys.length) return null;          // nothing proves two pieces the same
  return `a:${JSON.stringify(keys.map((k) => [k, p[k]]))}`;
}

const polygonsOfGeometry = (g) => (g?.type === "Polygon" ? [g.coordinates]
  : g?.type === "MultiPolygon" ? g.coordinates : null);

function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return s / 2;
}

function pointInRing([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Open ring (no closing duplicate), consecutive duplicates removed. */
function openRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

function closeRing(ring) {
  return ring.length ? [...ring, [ring[0][0], ring[0][1]]] : ring;
}

/** Does any vertex of this feature sit on its own tile's edge? */
function touchesEdge(polygons, b) {
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (Math.abs(x - b.west) < EDGE_EPS || Math.abs(x - b.east) < EDGE_EPS
          || Math.abs(y - b.north) < EDGE_EPS || Math.abs(y - b.south) < EDGE_EPS) return true;
      }
    }
  }
  return false;
}

/**
 * Merge tile-clipped fragments of the same unit across tile seams.
 *
 * @param {Array<{z:number,x:number,y:number,features:object[]}>} tiles
 *   tiles at ONE zoom (mixed zooms are merged per zoom, never across)
 * @param {object} [options]
 * @param {function} [options.keyOf]   feature -> unit identity, or null
 * @param {number} [options.snapUnits] cluster tolerance in tile units (of 4096)
 * @returns {object[]} features: untouched pieces as they arrived, merged
 *   units as new features carrying the first piece's id and properties.
 */
export function mergeTileFragments(tiles, { keyOf = unitKeyOf, snapUnits = 2, extent = 4096 } = {}) {
  const list = (tiles || []).filter((t) => t && Array.isArray(t.features));
  if (!list.length) return [];
  const byZoom = new Map();
  list.forEach((t) => {
    const z = Number(t.z);
    if (!byZoom.has(z)) byZoom.set(z, []);
    byZoom.get(z).push(t);
  });
  if (byZoom.size > 1) {
    // Never across zooms: two generalisations of the same ground overlap.
    return [...byZoom.values()].flatMap((group) => mergeTileFragments(group,
      { keyOf, snapUnits, extent }));
  }

  const out = [];
  /** key -> [{ feature, polygons, bounds, order }] */
  const groups = new Map();
  let order = 0;
  for (const tile of list) {
    const bounds = tileBoundsOf(tile.z, tile.x, tile.y);
    for (const feature of tile.features) {
      const polygons = polygonsOfGeometry(feature?.geometry);
      const k = polygons ? keyOf(feature) : null;
      if (!polygons || k == null || !touchesEdge(polygons, bounds)) {
        out.push({ order: order++, feature });
        continue;
      }
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ feature, polygons, bounds, tile, order: order++ });
    }
  }

  const multiTile = [...groups.values()].filter((g) => new Set(g.map((p) => p.tile)).size > 1);
  const single = [...groups.values()].filter((g) => new Set(g.map((p) => p.tile)).size <= 1);
  single.forEach((g) => g.forEach((p) => out.push({ order: p.order, feature: p.feature })));

  if (multiTile.length) {
    const lines = seamLines(multiTile.flat(), snapUnits / extent);
    multiTile.forEach((g) => mergeGroup(g, lines).forEach((r) => out.push(r)));
  }
  out.sort((a, b) => a.order - b.order);
  return out.map((r) => r.feature);
}

/**
 * The SEAM LINES these pieces sit on, and the snapped value of every vertex on
 * them. Shared across all units, so neighbouring units snap alike and their
 * common boundary does not open a gap where it crosses the seam.
 */
function seamLines(pieces, fraction) {
  // line id -> { vertical, at, values: [{ v, tol, corner }] }
  const lines = new Map();
  const lineFor = (vertical, at) => {
    const id = `${vertical ? "V" : "H"}${at}`;
    if (!lines.has(id)) lines.set(id, { vertical, at, values: [] });
    return lines.get(id);
  };
  for (const piece of pieces) {
    const b = piece.bounds;
    const tolLat = (b.north - b.south) * fraction;
    const tolLon = (b.east - b.west) * fraction;
    // The corners are anchors: a cluster containing one snaps to it exactly.
    for (const x of [b.west, b.east]) {
      lineFor(true, x).values.push({ v: b.north, tol: tolLat, corner: true },
        { v: b.south, tol: tolLat, corner: true });
    }
    for (const y of [b.north, b.south]) {
      lineFor(false, y).values.push({ v: b.west, tol: tolLon, corner: true },
        { v: b.east, tol: tolLon, corner: true });
    }
    piece.snapped = piece.polygons.map((rings) => rings.map((ring) => ring.map(([x, y]) => {
      let px = x;
      let py = y;
      if (Math.abs(px - b.west) < EDGE_EPS) px = b.west;
      else if (Math.abs(px - b.east) < EDGE_EPS) px = b.east;
      if (Math.abs(py - b.north) < EDGE_EPS) py = b.north;
      else if (Math.abs(py - b.south) < EDGE_EPS) py = b.south;
      if (px === b.west || px === b.east) lineFor(true, px).values.push({ v: py, tol: tolLat });
      if (py === b.north || py === b.south) lineFor(false, py).values.push({ v: px, tol: tolLon });
      return [px, py];
    })));
  }
  // Cluster each line's values: consecutive within tolerance, span capped.
  for (const line of lines.values()) {
    const vals = line.values.sort((a, b) => a.v - b.v);
    const map = new Map();
    let i = 0;
    while (i < vals.length) {
      let j = i;
      const tol = vals[i].tol;
      while (j + 1 < vals.length && vals[j + 1].v - vals[j].v <= Math.max(tol, vals[j + 1].tol)
        && vals[j + 1].v - vals[i].v <= 2 * Math.max(tol, vals[j + 1].tol)) j += 1;
      const cluster = vals.slice(i, j + 1);
      const corner = cluster.find((c) => c.corner);
      const target = corner ? corner.v
        : cluster.reduce((s, c) => s + c.v, 0) / cluster.length;
      cluster.forEach((c) => map.set(c.v, target));
      i = j + 1;
    }
    line.snap = map;
    line.sorted = [...new Set(map.values())].sort((a, b) => a - b);
  }
  return lines;
}

function mergeGroup(group, lines) {
  const V = (x) => lines.get(`V${x}`);
  const H = (y) => lines.get(`H${y}`);
  const snapPoint = ([x, y]) => {
    let px = x;
    let py = y;
    const v = V(x);
    if (v && v.snap.has(y)) py = v.snap.get(y);
    const h = H(y);
    if (h && h.snap.has(x)) px = h.snap.get(x);
    return [px, py];
  };
  const pk = (p) => `${p[0]},${p[1]}`;

  // Union-find over the pieces, joined whenever they cancel an edge.
  const parent = group.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

  /** directed edge key -> stack of { a, b, owner } */
  const edges = new Map();
  let cancelled = 0;
  const addEdge = (a, b, owner) => {
    if (a[0] === b[0] && a[1] === b[1]) return;
    const rev = `${pk(b)}>${pk(a)}`;
    const stack = edges.get(rev);
    if (stack && stack.length) {
      const other = stack.pop();
      if (!stack.length) edges.delete(rev);
      if (other.owner !== owner) { join(other.owner, owner); cancelled += 1; }
      return;
    }
    const fwd = `${pk(a)}>${pk(b)}`;
    if (!edges.has(fwd)) edges.set(fwd, []);
    edges.get(fwd).push({ a, b, owner });
  };
  /** Split an edge along a seam at every seam vertex strictly inside it. */
  const splitOnSeam = (a, b) => {
    let line = null;
    let along = null;
    if (a[0] === b[0] && V(a[0])) { line = V(a[0]); along = 1; }
    else if (a[1] === b[1] && H(a[1])) { line = H(a[1]); along = 0; }
    if (!line) return [[a, b]];
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    const s = line.sorted;
    // first value > lo
    let k = 0;
    let top = s.length;
    while (k < top) { const m = (k + top) >> 1; if (s[m] <= lo) k = m + 1; else top = m; }
    const cuts = [];
    for (; k < s.length && s[k] < hi; k += 1) cuts.push(s[k]);
    if (!cuts.length) return [[a, b]];
    if (a[along] > b[along]) cuts.reverse();
    const pts = [a, ...cuts.map((c) => (along === 1 ? [a[0], c] : [c, a[1]])), b];
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i += 1) segs.push([pts[i], pts[i + 1]]);
    return segs;
  };

  group.forEach((piece, owner) => {
    piece.snapped.forEach((rings) => rings.forEach((raw, ri) => {
      const ring = openRing(raw.map(snapPoint));
      if (ring.length < 3) return;
      const area = signedArea(ring);
      if (area === 0) return;
      // Interior on the left: outer CCW, holes CW.
      const wantPositive = ri === 0;
      if ((area > 0) !== wantPositive) ring.reverse();
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        splitOnSeam(a, b).forEach(([p, q]) => addEdge(p, q, owner));
      }
    }));
  });

  if (!cancelled) {
    return group.map((p) => ({ order: p.order, feature: p.feature }));
  }

  // Outgoing edges per start vertex, for tracing.
  const outgoing = new Map();
  for (const stack of edges.values()) {
    for (const e of stack) {
      const k = pk(e.a);
      if (!outgoing.has(k)) outgoing.set(k, []);
      outgoing.get(k).push(e);
    }
  }
  const onSeam = (p) => Boolean(V(p[0]) || H(p[1]));
  const rings = [];   // { ring, owner }
  for (const list of outgoing.values()) {
    for (const start of list) {
      if (start.used) continue;
      const ring = [];
      let e = start;
      let guard = 0;
      while (e && !e.used && guard < 1e7) {
        guard += 1;
        e.used = true;
        ring.push(e.a);
        const options = (outgoing.get(pk(e.b)) || []).filter((o) => !o.used);
        if (!options.length) break;
        if (options.length === 1) { e = options[0]; continue; }
        // Turn as far LEFT as possible: touching lobes become separate rings.
        const dx = e.b[0] - e.a[0];
        const dy = e.b[1] - e.a[1];
        let best = null;
        let bestAngle = -Infinity;
        for (const o of options) {
          const ox = o.b[0] - o.a[0];
          const oy = o.b[1] - o.a[1];
          const angle = Math.atan2((dx * oy) - (dy * ox), (dx * ox) + (dy * oy));
          if (angle > bestAngle) { bestAngle = angle; best = o; }
        }
        e = best;
      }
      // Drop spikes and the collinear vertices a seam crossing leaves behind.
      let cleaned = ring;
      let changed = true;
      while (changed && cleaned.length >= 3) {
        changed = false;
        const next = [];
        for (let i = 0; i < cleaned.length; i += 1) {
          const p = cleaned[(i + cleaned.length - 1) % cleaned.length];
          const c = cleaned[i];
          const n = cleaned[(i + 1) % cleaned.length];
          if (p[0] === n[0] && p[1] === n[1]) { changed = true; continue; }   // spike
          if (onSeam(c)) {
            const ax = c[0] - p[0]; const ay = c[1] - p[1];
            const bx = n[0] - c[0]; const by = n[1] - c[1];
            const cross = (ax * by) - (ay * bx);
            const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
            if (Math.abs(cross) <= scale * 1e-9 && (ax * bx) + (ay * by) > 0) { changed = true; continue; }
          }
          next.push(c);
        }
        cleaned = next;
      }
      if (cleaned.length >= 3 && signedArea(cleaned) !== 0) {
        rings.push({ ring: cleaned, owner: find(start.owner) });
      }
    }
  }

  // One feature per connected component; a lone piece goes back untouched.
  const components = new Map();
  group.forEach((piece, i) => {
    const r = find(i);
    if (!components.has(r)) components.set(r, []);
    components.get(r).push(piece);
  });
  const out = [];
  for (const [root, pieces] of components) {
    if (pieces.length === 1) {
      out.push({ order: pieces[0].order, feature: pieces[0].feature });
      continue;
    }
    const mine = rings.filter((r) => r.owner === root).map((r) => r.ring);
    const outers = [];
    const holes = [];
    mine.forEach((ring) => {
      const a = signedArea(ring);
      if (a > 0) outers.push({ ring: closeRing(ring), area: a });
      else holes.push(closeRing(ring.slice().reverse()).reverse());
    });
    if (!outers.length) {
      pieces.forEach((p) => out.push({ order: p.order, feature: p.feature }));
      continue;
    }
    const polygons = outers.map((o) => [o.ring]);
    holes.forEach((hole) => {
      const probe = [(hole[0][0] + hole[1][0]) / 2, (hole[0][1] + hole[1][1]) / 2];
      let best = -1;
      let bestArea = Infinity;
      outers.forEach((o, i) => {
        if (o.area < bestArea && pointInRing(probe, o.ring)) { best = i; bestArea = o.area; }
      });
      if (best >= 0) polygons[best].push(hole);
    });
    const first = pieces.reduce((a, b) => (a.order <= b.order ? a : b));
    out.push({
      order: first.order,
      feature: {
        type: "Feature",
        ...(first.feature.id !== undefined ? { id: first.feature.id } : {}),
        properties: { ...(first.feature.properties || {}) },
        geometry: polygons.length === 1
          ? { type: "Polygon", coordinates: polygons[0] }
          : { type: "MultiPolygon", coordinates: polygons },
      },
    });
  }
  return out;
}
