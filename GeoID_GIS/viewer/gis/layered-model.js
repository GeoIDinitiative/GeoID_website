/**
 * A layered 3D model on one surface — the pure half.
 *
 * The Model Builder built a single rock volume under the terrain and an air
 * volume over it. A real site is more than that, and the two things missing
 * are the ones a hazard model needs most:
 *
 *  - WATER. The sea, lakes and rivers are a domain of their own with their own
 *    material. Where the DEM is at or below sea level on the ocean mask, the
 *    water runs from 0 m down to the bathymetry; a lake and a river keep the
 *    DEM as their water surface and are given a bed below it (a lake from its
 *    published mean depth, a river a channel depth from its width).
 *  - SOIL OVER BEDROCK. The ground is not one material. The soil (everything
 *    above bedrock — Pelletier et al. 2016) and the bedrock are two volumes
 *    sharing one surface: the bedrock top is the ground minus the soil's
 *    thickness. THE SURFACE IS ALWAYS THE DEM: nothing here moves the ground,
 *    the soil is carved down from it, and where there is no soil the bedrock
 *    IS the DEM.
 *
 * EVERY SURFACE IS THE SAME TIN WITH DIFFERENT HEIGHTS. The terrain, the
 * bedrock top and the water top are one triangulation carrying three z arrays,
 * so an interface between two volumes is the same triangles in both shells —
 * conforming by construction, the rule the rock and the air already follow.
 * Each volume is its own watertight shell: top triangles, bottom triangles and
 * walls along the rim, a wall edge collapsing to a single triangle where the
 * two surfaces meet at one end and vanishing where they meet at both.
 *
 * Heights per node, all metres above sea level:
 *   solid[i]  the top of the ground: land surface, seabed, lake bed, river bed
 *   water[i]  the water surface where the node is wet, else solid[i]
 *   bedrock[i] solid[i] − soil thickness (0 where there is no soil)
 *   top[i]    max(solid, water): the floor of the atmosphere
 */

import { channelDepth } from "./inundation.js?v=20260925-40bf2a5";

/** A TIN with a different z array, and its own extremes. */
import { faultScriptLines } from "./fault-planes.js?v=20260925-40bf2a5";

/** The weathered skin allowed over rock the bedrock map shows at the surface, in metres. */
export const REGOLITH_ON_ROCK_M = 2;

export function tinWith(tin, z) {
  let zMin = Infinity; let zMax = -Infinity;
  for (let i = 0; i < z.length; i += 1) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  return { ...tin, z, zMin, zMax, reliefM: zMax - zMin };
}

/**
 * The layers' heights at every node.
 *
 * `thicknessAt(i)` answers the soil thickness in metres or null (no model —
 * offshore, or outside the grid). `oceanAt(i)` is true on the ocean mask;
 * `lakeAt(i)` answers `{ level, depth }` for a lake node or null;
 * `riverWidthAt(i)` a GRWL width in metres or 0. Every reader is optional: a
 * model without water simply has none.
 */
export function layerHeights(tin, {
  thicknessAt = null, minSoilM = 0, defaultSoilM = 2, offshoreSoilM = null,
  oceanAt = null, seaBedAt = null, lakeAt = null, riverWidthAt = null, seaLevel = 0, water = true, soil = true,
  minWaterM = 1, groundStateAt = null, regolithOnRockM = REGOLITH_ON_ROCK_M,
} = {}) {
  const n = tin.z.length;
  const solid = Float64Array.from(tin.z);
  const waterTop = Float64Array.from(tin.z);
  const wet = new Uint8Array(n);      // 0 dry, 1 sea, 2 lake, 3 river
  const bedrock = new Float64Array(n);
  const lakeMean = new Float64Array(n).fill(NaN);
  // Lake nodes whose DEM is real bathymetry: the cone must not reshape them.
  const surveyed = new Uint8Array(n);
  let sea = 0; let lake = 0; let river = 0; let modelled = 0; let thickSum = 0; let deepened = 0; let bathy = 0;
  for (let i = 0; i < n; i += 1) {
    const z = tin.z[i];
    if (water) {
      const lk = lakeAt ? lakeAt(i) : null;
      const rw = riverWidthAt ? Number(riverWidthAt(i)) || 0 : 0;
      if (oceanAt && oceanAt(i) && z <= seaLevel) {
        // THE SEA: 0 m down to the seabed. A land DEM reads ~0 m over the
        // sea (measured: Mapzen gives 0.0 m in the Gulf of Izmit from z11 up),
        // so the bed comes from a bathymetry grid (`seaBedAt`) where there is
        // one, and from the DEM only where the DEM is itself below it. Never
        // shallower than `minWaterM`: water that thins to nothing along the
        // shore pinches its side walls to zero height, the wall's rims touch,
        // and gmsh reports "intersections in the 1D mesh" and then "No
        // elements in volume". The count says how many were deepened.
        wet[i] = 1; waterTop[i] = seaLevel; sea += 1;
        const sb = seaBedAt ? Number(seaBedAt(i)) : NaN;
        if (Number.isFinite(sb) && sb < solid[i]) { solid[i] = sb; bathy += 1; }
        if (solid[i] > seaLevel - minWaterM) { solid[i] = seaLevel - minWaterM; deepened += 1; }
      } else if (lk && Number.isFinite(lk.level)) {
        // A LAKE, and the DEM means one of two things.
        //
        // A LAND DEM READS A LAKE'S WATER, not its bed: Mapzen gives Sapanca
        // 29.1 m against HydroLAKES' surveyed 30, which is the SURFACE a
        // metre out, not a metre of water. Taken for a bed that is a lake
        // 1 m deep. So where the DEM sits at or just under the level it is
        // the surface, and the bed is shaped below it from the published MEAN
        // depth after this loop (`lakeBasins`).
        //
        // A DEM WELL BELOW THE LEVEL is the other case and is real
        // bathymetry -- somebody surveyed that basin and the grid carries it.
        // Then it IS the bed and the water stands at the surveyed level over
        // it, and `lakeBasins` must leave it alone: a cone fitted to a
        // published mean would overwrite a measurement with a guess, which on
        // a deep lake moves the bed by tens of metres.
        //
        // "Well below" is max(3 m, a quarter of the mean depth): 3 m clears
        // the metre or so a land DEM is out by, and the quarter keeps the
        // test in proportion on a deep lake.
        const level = Number(lk.level);
        const mean = Math.max(0.5, Number(lk.depth) || 2);
        wet[i] = 2; lake += 1; lakeMean[i] = mean;
        if (z < level - Math.max(3, mean / 4)) {
          waterTop[i] = level; solid[i] = z; surveyed[i] = 1; bathy += 1;
        } else {
          waterTop[i] = z; solid[i] = z - mean;
        }
      } else if (rw > 0) {
        // A RIVER: the DEM reads the water surface; the bed is a channel
        // depth below it.
        wet[i] = 3; waterTop[i] = z; solid[i] = z - channelDepth(rw); river += 1;
      }
    }
  }
  const basins = lake && tin.tris
    ? lakeBasins(tin, wet, lakeMean, waterTop, solid, minWaterM, surveyed) : [];
  // THE BEDROCK MAP DECIDES HOW MUCH OF THE MODELLED THICKNESS IS SOIL.
  // Pelletier's grid is a kilometre and knows nothing of what the survey
  // mapped: where the geology polygon is a loose deposit (alluvium, till,
  // sand, an unconsolidated sediment) the whole modelled column is soil; where
  // it is rock at the surface only a weathered skin is, so the modelled
  // thickness is capped at `regolithOnRockM`. Unmapped ground keeps the model.
  let onDeposit = 0; let onRock = 0; let capped = 0;
  for (let i = 0; i < n; i += 1) {
    let t = thicknessAt ? thicknessAt(i) : null;
    if (Number.isFinite(t)) { modelled += 1; thickSum += t; }
    else t = wet[i] === 1 && Number.isFinite(offshoreSoilM) ? offshoreSoilM : defaultSoilM;
    const g = groundStateAt ? groundStateAt(i) : null;
    if (g === "soil") onDeposit += 1;
    else if (g === "rock") { onRock += 1; if (t > regolithOnRockM) { t = regolithOnRockM; capped += 1; } }
    // THE CONTACT IS THE GROUND LESS THE SOIL: where there is no soil the
    // bedrock IS the surface, and the soil body simply pinches out there.
    bedrock[i] = soil ? solid[i] - Math.max(minSoilM, Math.max(0, t)) : solid[i];
  }
  const top = new Float64Array(n);
  let seaMax = 0; let riverMax = 0;
  for (let i = 0; i < n; i += 1) {
    top[i] = Math.max(solid[i], waterTop[i]);
    if (wet[i] === 1) seaMax = Math.max(seaMax, waterTop[i] - solid[i]);
    if (wet[i] === 3) riverMax = Math.max(riverMax, waterTop[i] - solid[i]);
  }
  return {
    solid, water: waterTop, bedrock, top, wet,
    counts: {
      nodes: n, sea, lake, river, deepened, bathy, seaMaxDepthM: seaMax, riverMaxDepthM: riverMax, lakes: basins,
      soilModelled: modelled, meanSoilM: modelled ? thickSum / modelled : null,
      onDeposit, onRock, cappedOnRock: capped,
    },
  };
}

/**
 * A LAKE IS A BASIN, not a slab. HydroLAKES publishes each lake's MEAN depth
 * and no shape, and a flat bed at that depth everywhere makes a lake a
 * uniform sheet with vertical walls at its shore. So each connected lake is
 * given a bed that deepens with distance from its shore — a cone in plan,
 * depth ∝ the shortest path through the lake to a dry node — scaled so the
 * mean over its nodes IS the published mean. A lake's deepest point comes out
 * two to three times its mean, the usual order for real lakes. It is a
 * stand-in for a surveyed bed, carved down from the DEM's own surface.
 */
export function lakeBasins(tin, wet, lakeMean, waterTop, solid, minWaterM = 1,
  surveyed = null) {
  const n = wet.length;
  const nbrs = Array.from({ length: n }, () => []);
  const link = (a, b) => {
    const d = Math.hypot(tin.xs[a] - tin.xs[b], tin.ys[a] - tin.ys[b]);
    nbrs[a].push(b, d); nbrs[b].push(a, d);
  };
  for (const [a, b, c] of tin.tris) { link(a, b); link(b, c); link(c, a); }
  // Distance to the shore, Dijkstra from every dry node's lake neighbours.
  const dist = new Float64Array(n).fill(Infinity);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1; const r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i += 1) {
    if (wet[i] !== 2) continue;
    const nb = nbrs[i];
    for (let k = 0; k < nb.length; k += 2) {
      if (wet[nb[k]] !== 2) { const d = nb[k + 1] / 2; if (d < dist[i]) { dist[i] = d; push(d, i); } }
    }
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const nb = nbrs[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k];
      if (wet[j] !== 2) continue;
      const nd = d + nb[k + 1];
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  // One basin per connected lake.
  const comp = new Int32Array(n).fill(-1);
  const out = [];
  for (let s = 0; s < n; s += 1) {
    if (wet[s] !== 2 || comp[s] >= 0) continue;
    const members = [s]; comp[s] = out.length;
    for (let q = 0; q < members.length; q += 1) {
      const nb = nbrs[members[q]];
      for (let k = 0; k < nb.length; k += 2) { const j = nb[k]; if (wet[j] === 2 && comp[j] < 0) { comp[j] = out.length; members.push(j); } }
    }
    // A node whose DEM is real bathymetry keeps it: it is part of the lake
    // and part of its deepest reading, and it is not reshaped.
    const shaped = members.filter((i) => Number.isFinite(dist[i])
      && !(surveyed && surveyed[i]));
    // An enclosed lake (no dry node reaches it inside the box) is flat at its mean.
    const meanD = shaped.length ? shaped.reduce((a, i) => a + dist[i], 0) / shaped.length : 0;
    const mean = lakeMean[s];
    let deepest = 0;
    for (const i of members) {
      if (surveyed && surveyed[i]) deepest = Math.max(deepest, waterTop[i] - solid[i]);
    }
    for (const i of shaped) {
      const depth = Math.max(Math.max(0.5, minWaterM), meanD > 0 ? mean * (dist[i] / meanD) : mean);
      solid[i] = waterTop[i] - depth;
      deepest = Math.max(deepest, depth);
    }
    out.push({ nodes: members.length, level: waterTop[s], meanDepthM: mean, maxDepthM: deepest });
  }
  return out;
}

function edgeKey(a, b) { return a < b ? `${a},${b}` : `${b},${a}`; }

/**
 * Drop admitted triangles until no node is a PINCH. Where two parts of a
 * region touch at a single node, that node carries four rim edges, and the
 * wall column standing on it is shared by four wall triangles — an edge gmsh
 * refuses ("wrong topology"). Measured on the Izmit water: one such edge in
 * 3,068 triangles. Removing a triangle at the pinch separates the two parts;
 * the one with the fewest interior (shared) edges goes first, so the region
 * loses as little as possible. Repeats until no node has more than two.
 */
export function unpinch(tris, admitted) {
  const keep = new Set(admitted);
  for (let pass = 0; pass < 64; pass += 1) {
    const count = new Map();
    for (const k of keep) {
      const [a, b, c] = tris[k];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = edgeKey(u, v);
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    const rim = new Map();
    for (const [key, n] of count) {
      if (n !== 1) continue;
      for (const s of key.split(",")) rim.set(+s, (rim.get(+s) || 0) + 1);
    }
    const pinched = new Set([...rim].filter(([, n]) => n > 2).map(([v]) => v));
    if (!pinched.size) break;
    const drop = new Set();
    for (const v of pinched) {
      let best = -1; let bestShared = Infinity;
      for (const k of keep) {
        if (drop.has(k)) continue;
        const [a, b, c] = tris[k];
        if (a !== v && b !== v && c !== v) continue;
        let shared = 0;
        for (const [u, w] of [[a, b], [b, c], [c, a]]) if (count.get(edgeKey(u, w)) > 1) shared += 1;
        if (shared < bestShared) { bestShared = shared; best = k; }
      }
      if (best >= 0) drop.add(best);
    }
    if (!drop.size) break;
    for (const k of drop) keep.delete(k);
  }
  return admitted.filter((k) => keep.has(k));
}

/**
 * A closed shell between two surfaces on the same TIN: `top` and `bottom` are
 * z arrays (or `bottom` a flat lid height), over the triangles `keep` admits.
 * Walls stand on every rim edge of the admitted triangles — the model's outer
 * rim, or a wet region's shoreline — and collapse where the two surfaces
 * meet. Returns facets `{ a, b, c, hint, face }` in the shape `shellFacets`
 * uses, so the same writers and displays read it.
 */
/**
 * `minGap` is ONE MILLIMETRE, the precision the STL is written at. A gap
 * smaller than that is written as none, and a sea node a fraction of a
 * millimetre under 0 m then rounds onto its own water surface: zero-area
 * slivers along the shore, which gmsh answers with "No elements in volume".
 */
export function betweenFacets(tin, { top, bottom, keep = null, topFace = "top", bottomFace = "bottom", wallFace = "wall", minGap = 1e-3 } = {}) {
  const flat = Number.isFinite(bottom);
  const zb = (i) => (flat ? bottom : bottom[i]);
  const P = (i, z) => [tin.xs[i], tin.ys[i], z];
  const facets = [];
  const edges = new Map();
  const admitted = [];
  tin.tris.forEach((tri, k) => {
    if (keep && !keep(tri, k)) return;
    const [a, b, c] = tri;
    // Skip a triangle whose top and bottom coincide at all three nodes: it
    // holds no volume and would be two coplanar faces back to back.
    if (top[a] - zb(a) <= minGap && top[b] - zb(b) <= minGap && top[c] - zb(c) <= minGap) return;
    admitted.push(k);
  });
  for (const k of unpinch(tin.tris, admitted)) {
    const [a, b, c] = tin.tris[k];
    facets.push({ a: P(a, top[a]), b: P(b, top[b]), c: P(c, top[c]), hint: [0, 0, 1], face: topFace });
    facets.push({ a: P(a, zb(a)), b: P(c, zb(c)), c: P(b, zb(b)), hint: [0, 0, -1], face: bottomFace });
    [[a, b, c], [b, c, a], [c, a, b]].forEach(([u, v, w]) => {
      const key = edgeKey(u, v);
      const e = edges.get(key);
      if (e) e.count += 1; else edges.set(key, { u, v, w, count: 1 });
    });
  }
  /**
   * Rim edges are used by one admitted triangle, and the wall faces AWAY FROM
   * THAT TRIANGLE — its third vertex says which side is inside. Pointing the
   * wall away from the whole TIN's middle instead is right for the model's
   * outer rim and wrong for a wet region's shoreline, where the east wall of a
   * western sea faces the TIN's centre: measured, a 2,000,000 m³ strip of sea
   * came out at 666,667 with one wall wound inward.
   */
  for (const { u, v, w, count } of edges.values()) {
    if (count !== 1) continue;
    const hu = top[u] - zb(u); const hv = top[v] - zb(v);
    if (hu <= minGap && hv <= minGap) continue;
    const mx = (tin.xs[u] + tin.xs[v]) / 2; const my = (tin.ys[u] + tin.ys[v]) / 2;
    const dx = tin.xs[v] - tin.xs[u]; const dy = tin.ys[v] - tin.ys[u];
    let hint = [dy, -dx, 0];
    if (hint[0] * (tin.xs[w] - mx) + hint[1] * (tin.ys[w] - my) > 0) hint = [-dy, dx, 0];
    const tu = P(u, top[u]); const tv = P(v, top[v]); const bu = P(u, zb(u)); const bv = P(v, zb(v));
    if (hu > minGap && hv > minGap) {
      facets.push({ a: bu, b: bv, c: tv, hint, face: wallFace });
      facets.push({ a: bu, b: tv, c: tu, hint, face: wallFace });
    } else if (hu > minGap) {
      facets.push({ a: bu, b: bv, c: tu, hint, face: wallFace });
    } else {
      facets.push({ a: bu, b: bv, c: tv, hint, face: wallFace });
    }
  }
  return facets;
}

/** Which triangles are water: every node wet. */
export function wetTriangles(tin, wet) {
  return (tri) => wet[tri[0]] && wet[tri[1]] && wet[tri[2]];
}

/**
 * The volumes of a layered model as facet lists: bedrock (base lid to the
 * bedrock top), soil (bedrock top to the ground), water (the ground to the
 * water surface, on wet triangles) and atmosphere (the top of everything to a
 * sky lid). Any of them can be switched off.
 */
export function layeredVolumes(tin, layers, { belowM = 5000, aboveM = 0, soil = true, water = true } = {}) {
  let zMin = Infinity; let zMax = -Infinity;
  const floor = soil ? layers.bedrock : layers.solid;
  for (let i = 0; i < floor.length; i += 1) { if (floor[i] < zMin) zMin = floor[i]; if (layers.top[i] > zMax) zMax = layers.top[i]; }
  const baseZ = zMin - Math.max(1, belowM);
  const skyZ = aboveM > 0 ? zMax + aboveM : null;
  const out = { baseZ, skyZ, volumes: [] };
  out.volumes.push({ id: "bedrock", label: soil ? "Bedrock" : "Subsurface",
    facets: betweenFacets(tin, { top: floor, bottom: baseZ, topFace: soil ? "bedrock_top" : "top", bottomFace: "base", wallFace: "sides" }) });
  if (soil) {
    out.volumes.push({ id: "soil", label: "Soil and regolith",
      facets: betweenFacets(tin, { top: layers.solid, bottom: layers.bedrock, topFace: "top", bottomFace: "bedrock_top", wallFace: "sides" }) });
  }
  if (water && layers.wet.some((w) => w)) {
    out.volumes.push({ id: "water", label: "Water",
      facets: betweenFacets(tin, { top: layers.water, bottom: layers.solid, keep: wetTriangles(tin, layers.wet), topFace: "water_surface", bottomFace: "bed", wallFace: "water_sides" }) });
  }
  if (skyZ !== null) {
    const sky = new Float64Array(tin.xs.length).fill(skyZ);
    out.volumes.push({ id: "atmosphere", label: "Atmosphere",
      facets: betweenFacets(tin, { top: sky, bottom: layers.top, topFace: "sky", bottomFace: "top", wallFace: "sides_above" }) });
  }
  return out;
}

/** A facet list as ASCII STL, each facet wound to its outward hint. */
export function facetsStl(facets, name) {
  const lines = [`solid ${name}`];
  for (const f of facets) {
    let { a, b, c } = f;
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    if (nx * f.hint[0] + ny * f.hint[1] + nz * f.hint[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    lines.push(` facet normal ${(nx / len).toFixed(6)} ${(ny / len).toFixed(6)} ${(nz / len).toFixed(6)}`,
      "  outer loop", ...[a, b, c].map((p) => `   vertex ${p[0].toFixed(3)} ${p[1].toFixed(3)} ${p[2].toFixed(3)}`), "  endloop", " endfacet");
  }
  lines.push(`endsolid ${name}`);
  return `${lines.join("\n")}\n`;
}

/** Flattened xyz for a display mesh, optionally only some faces. */
export function facetPositions(facets, keep = null) {
  const list = keep ? facets.filter(keep) : facets;
  const out = new Float32Array(list.length * 9);
  list.forEach((f, k) => {
    [f.a, f.b, f.c].forEach((p, m) => { out[k * 9 + m * 3] = p[0]; out[k * 9 + m * 3 + 1] = p[1]; out[k * 9 + m * 3 + 2] = p[2]; });
  });
  return out;
}

/** Signed volume of a closed facet list, wound outward: the divergence theorem. */
export function facetsVolume(facets) {
  let v = 0;
  for (const f of facets) {
    let { a, b, c } = f;
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    if (nx * f.hint[0] + ny * f.hint[1] + nz * f.hint[2] < 0) [b, c] = [c, b];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

/** Whether a facet list is closed: every edge used by exactly two facets. */
export function facetsClosed(facets) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
  const edges = new Map();
  for (const f of facets) {
    const ks = [key(f.a), key(f.b), key(f.c)];
    [[0, 1], [1, 2], [2, 0]].forEach(([i, j]) => {
      const e = ks[i] < ks[j] ? `${ks[i]}|${ks[j]}` : `${ks[j]}|${ks[i]}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    });
  }
  let open = 0;
  for (const c of edges.values()) if (c !== 2) open += 1;
  return { closed: open === 0, openEdges: open, edges: edges.size };
}

/**
 * A facet list as a MULTI-SOLID ASCII STL: one `solid` block per face name.
 *
 * gmsh's STL reader makes each block its own named discrete surface, so the
 * script can tag the ground, the bedrock top, the water surface and the sides
 * by NAME. The single-solid route (classifySurfaces, then naming by shape)
 * files a soil shell's ground and its bedrock top both as "top", because both
 * are neither flat nor vertical — the one distinction a layered model exists
 * to make.
 */
export function facetsStlByFace(facets, name) {
  const groups = new Map();
  for (const f of facets) {
    if (!groups.has(f.face)) groups.set(f.face, []);
    groups.get(f.face).push(f);
  }
  let out = "";
  for (const [face, list] of groups) out += facetsStl(list, face).replace(/^solid /, `solid `);
  return { text: out, faces: [...groups.keys()], name };
}

/** The value below which `share` of an array's finite values fall. */
export function quantile(values, share) {
  const list = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return NaN;
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(share * (list.length - 1))))];
}

const PY = (v) => JSON.stringify(v);

/**
 * The gmsh script for ONE layered volume, read from its multi-solid STL.
 *
 * `createTopology` + `createGeometry` keep the named surfaces as they came —
 * no classifySurfaces, which would re-cut them by angle and lose the names —
 * and the volume is their surface loop. Faces are grouped by the flag their
 * name maps to (one flag, one group), curves and points inherit the lowest
 * flag of the faces they bound, and the volume carries its own.
 *
 * A thin volume needs thin elements: the soil is a skin metres thick over
 * kilometres, and at the rock's element size gmsh returns "No elements in
 * volume". Measured on a 2–12 m skin over 2 km: 150 m failed, 40 m meshed in
 * 5 s. So `meshSizeM` here is the caller's already capped for thickness.
 */
export function layeredGmshScript({
  name, stlFile, meshFile, meshSizeM, minSizeM = 0, faceFlags = {}, volumeFlag = 10, volumeName = "domain",
  embedPoints = [], faults = [], estimate = null,
}) {
  /**
   * WHAT IS INSIDE THE VOLUME. A layered model used to lose the two things a
   * study puts inside the ground: the embedded points went into the unlayered
   * domain's script only, and a fault had nowhere to go at all. Each volume's
   * script now takes the points that lie in IT and, for the rock, the fault
   * planes -- embedded in the built-in kernel after the volume exists, filed
   * under their own flags with the named faces, so the one owner pass tags
   * their edges and corners too.
   */
  const faultFlags = {};
  (faults || []).forEach((f) => { faultFlags[`fault:${f.name}`] = Math.round(Number(f.flag)) || 30; });
  const points = (embedPoints || []).map((p) => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0,
    Number(p.sizeM) > 0 ? Number(p.sizeM) : meshSizeM / 2, String(p.name || "point"), Math.round(Number(p.flag)) || 20]);
  const faultBlock = faults?.length ? [
    "groups = {}",
    ...faultScriptLines(faults),
    `fault_flags = ${PY(faultFlags)}`,
  ] : [];
  const faultFaces = faults?.length ? [
    "for gname, stags in groups.items():",
    "    faces.setdefault(fault_flags[gname], []).extend(stags)",
    "    labels.setdefault(fault_flags[gname], set()).add(gname)",
  ] : [];
  const pointBlock = points.length ? [
    "",
    "# Points the study asks the mesh to pass through, the ones inside THIS volume.",
    `embedded = ${PY(points)}`,
    "ptags = []",
    "for (px, py, pz, psize, pname, pflag) in embedded:",
    "    ptags.append((gmsh.model.geo.addPoint(px, py, pz, psize), pflag, pname))",
    "gmsh.model.geo.synchronize()",
    "gmsh.model.mesh.embed(0, [t for (t, _, _) in ptags], 3, volume)",
    "pgroups = {}",
    "for (t, pflag, pname) in ptags:",
    "    pgroups.setdefault(pflag, []).append((t, pname))",
    "for pflag, members in sorted(pgroups.items()):",
    "    gmsh.model.addPhysicalGroup(0, [t for (t, _) in members], pflag, name='+'.join(n for (_, n) in members)[:120])",
  ] : [];
  return [
    `# GeoID Model Builder — the ${volumeName} volume of a layered model.`,
    "# Run: python3 this_script.py   (or through the sidecar's /jobs/gmsh)",
    ...(estimate ? [
      `# Estimated before meshing: ${estimateSentence(estimate)} at ${Math.round(meshSizeM)} m`,
      `# (~${estimate.nodes.toLocaleString("en-GB")} nodes; counted by ${estimate.by === "skin" ? "its surface - a thin layer" : "its volume"}). An order of magnitude, not a promise.`,
      ...(estimate.verdict === "compute" ? ["# Run this one on a compute target, not on a laptop."] : []),
    ] : []),
    "import gmsh",
    "",
    "gmsh.initialize()",
    "gmsh.option.setNumber(\"General.Terminal\", 1)",
    `gmsh.model.add(${PY(name)})`,
    "# One named solid per face: gmsh makes each its own surface, named.",
    `gmsh.merge(${PY(stlFile)})`,
    "gmsh.model.mesh.createTopology()",
    "gmsh.model.mesh.createGeometry()",
    "surfaces = [t for (_, t) in gmsh.model.getEntities(2)]",
    "loop = gmsh.model.geo.addSurfaceLoop(surfaces)",
    "volume = gmsh.model.geo.addVolume([loop])",
    "gmsh.model.geo.synchronize()",
    ...faultBlock,
    "",
    "# Faces by NAME, grouped by flag: one flag is one boundary.",
    `face_flags = ${PY(faceFlags)}`,
    "faces = {}",
    "labels = {}",
    "for (_, t) in gmsh.model.getEntities(2):",
    "    label = gmsh.model.getEntityName(2, t).split('/')[-1] or 'unnamed'",
    "    value = face_flags.get(label)",
    "    if value is None:",
    "        continue",
    "    faces.setdefault(value, []).append(t)",
    "    labels.setdefault(value, set()).add(label)",
    ...faultFaces,
    "for value, tags in sorted(faces.items()):",
    "    gmsh.model.addPhysicalGroup(2, sorted(tags), value, name='+'.join(sorted(labels[value])))",
    `gmsh.model.addPhysicalGroup(3, [volume], ${Number(volumeFlag)}, name=${PY(volumeName)})`,
    "",
    "# Edges and corners carry the lowest flag of the faces they bound.",
    "owner = {}",
    "for value in sorted(faces):",
    "    for surface in faces[value]:",
    "        for (_, curve) in gmsh.model.getBoundary([(2, surface)], oriented=False):",
    "            owner.setdefault((1, abs(curve)), value)",
    "            for (_, point) in gmsh.model.getBoundary([(1, abs(curve))], oriented=False):",
    "                owner.setdefault((0, abs(point)), value)",
    "# A closed curve has no end points, so a point on it is reached only",
    "# through its adjacencies — and an untagged point is what GALES refuses.",
    "for (_, point) in gmsh.model.getEntities(0):",
    "    if (0, point) in owner:",
    "        continue",
    "    up, _ = gmsh.model.getAdjacencies(0, point)",
    "    values = [owner[(1, abs(c))] for c in up if (1, abs(c)) in owner]",
    "    if values:",
    "        owner[(0, point)] = min(values)",
    "by_flag = {}",
    "for (dim, tag), value in owner.items():",
    "    by_flag.setdefault((dim, value), []).append(tag)",
    "for (dim, value), tags in sorted(by_flag.items()):",
    "    gmsh.model.addPhysicalGroup(dim, sorted(tags), value)",
    ...pointBlock,
    "",
    `gmsh.option.setNumber("Mesh.MeshSizeMax", ${Number(meshSizeM).toFixed(3)})`,
    `gmsh.option.setNumber("Mesh.MeshSizeMin", ${Number(minSizeM).toFixed(3)})`,
    "gmsh.model.mesh.generate(3)",
    `gmsh.write(${PY(meshFile)})`,
    "gmsh.finalize()",
    "",
  ].join("\n");
}

/** The flags a layered model uses, beside the Model Builder's own defaults. */
export const LAYER_FLAGS = Object.freeze({
  // The ground is 3, not 1: GALES's solid solvers read side flag 1 as the
  // fluid–solid interface. The water's sides moved to 14 to make room.
  top: 3, base: 2, sky: 4, sides: 5, sides_above: 6,
  bedrock_top: 7, water_surface: 8, bed: 9, water_sides: 14,
  bedrock: 10, atmosphere: 11, soil: 12, water: 13,
});

/**
 * The element size a THIN volume can be meshed at: twenty times the layer's
 * tenth-percentile thickness, never above the model's own size and never
 * below 5 m.
 *
 * Measured with gmsh 4.11.1 on a 2 km block: a soil skin 2–12 m thick (p10 3 m)
 * failed at 150 m and meshed at 60, 44 and 20 m; water 1–37 m deep (p10 3 m)
 * failed at 149 m with "intersections in the 1D mesh" and meshed at 60, 30 and
 * 15 m. The thin end of the layer is what decides it, not the mean.
 */
export function thinLayerSizeM(thicknesses, meshSizeM) {
  const p10 = quantile(thicknesses, 0.1);
  if (!Number.isFinite(p10)) return meshSizeM;
  return Math.max(5, Math.min(meshSizeM, 20 * p10));
}

/** The true area of the facets carrying one face name (all of them if none is named). */
export function facetsArea(facets, face = null) {
  let area = 0;
  for (const f of facets) {
    if (face && f.face !== face) continue;
    const ux = f.b[0] - f.a[0], uy = f.b[1] - f.a[1], uz = f.b[2] - f.a[2];
    const vx = f.c[0] - f.a[0], vy = f.c[1] - f.a[1], vz = f.c[2] - f.a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(nx, ny, nz);
  }
  return area;
}

/** Where an estimate stops being a laptop job. Tetrahedra, not nodes. */
export const ELEMENT_BANDS = Object.freeze({ slow: 300_000, compute: 2_000_000 });

/**
 * How many elements a volume will mesh to at one element size, BEFORE anybody
 * presses Mesh.
 *
 * Two floors, and the larger decides. A thick volume fills with tetrahedra of
 * about the regular one's volume, a³/(6√2) = 0.1178 a³. A THIN one cannot: its
 * top surface alone is meshed at the element size — A / (√3/4 · a²) triangles —
 * and a layer of prisms under them is three tetrahedra each, however little
 * volume there is to fill. That second floor is what makes a soil skin over a
 * thousand square kilometres a compute-target job while the rock under it is
 * nothing.
 *
 * An order-of-magnitude figure, and it says so: measured on the Izmit bedrock
 * at 2 km elements it gave 6,150 against gmsh's 7,505, and for the water at
 * 20 m about 1.3 million where gmsh had reached 601,044 NODES at a timeout.
 */
export function estimateElements({ volumeM3, topAreaM2 = 0, sizeM }) {
  const a = Number(sizeM);
  if (!(a > 0) || !(Math.abs(volumeM3) > 0)) return { tets: 0, nodes: 0, verdict: "empty", by: "none" };
  const byVolume = Math.abs(volumeM3) / (0.11785 * a * a * a);
  const bySkin = (3 * Math.max(0, topAreaM2)) / (0.43301 * a * a);
  const tets = Math.round(Math.max(byVolume, bySkin));
  const verdict = tets > ELEMENT_BANDS.compute ? "compute" : tets > ELEMENT_BANDS.slow ? "slow" : "laptop";
  return { tets, nodes: Math.round(tets / 5), verdict, by: bySkin > byVolume ? "skin" : "volume" };
}

/** The sentence a verdict is said as. */
export function estimateSentence(estimate) {
  const n = estimate.tets;
  const count = n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : `${n}`;
  if (estimate.verdict === "compute") return `about ${count} elements — a compute-target job, not a laptop one`;
  if (estimate.verdict === "slow") return `about ${count} elements — minutes of gmsh on a laptop`;
  if (estimate.verdict === "empty") return "nothing to mesh";
  return `about ${count} elements`;
}
