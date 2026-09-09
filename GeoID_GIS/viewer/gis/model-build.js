import { sizeFieldLines } from "./mesh-size-fields.js";
/**
 * The Model Builder's arithmetic: a study area and its layers into a meshable
 * domain, a gmsh script and a GALES run spec.
 *
 * Pure on purpose — no DOM, no viewer, no fetch. The elevation sampler is
 * passed IN, so the whole packaging step can be checked in Node against closed
 * forms (a known ramp is a known volume, a closed surface has no open edges)
 * rather than only in a browser against a picture.
 *
 * Three facts decide most of what is here:
 *
 * - **A FEM domain is metres, not degrees.** Everything downstream — gmsh,
 *   GALES, the probe coordinates the post-processing reads — works in a local
 *   metric frame, so the grid is built in east/north metres about the study
 *   area's own centre and the conversion carries THIS BODY's radius. Earth's
 *   111.32 km/deg on Mars is the fault this file's neighbours already record.
 * - **A domain is a BLOCK.** The study polygon says where; the model is the
 *   axis-aligned box over it, because a mesh that follows a hand-drawn outline
 *   inherits every jag as a sliver element. The polygon still decides which
 *   samples and which features belong to the study.
 * - **gmsh meshes a WATERTIGHT surface.** `classifySurfaces` + `createGeometry`
 *   turns an STL into geometry, and a volume needs the boundary closed: the
 *   terrain skin alone is a lid, not a box. So the domain STL is terrain +
 *   skirt walls + a base, with every edge shared by exactly two triangles —
 *   an invariant `stlStats` measures rather than assumes.
 */

/** Metres per degree of latitude on a body of this radius. */
export function metresPerDegreeLat(radiusKm) {
  return (Math.PI * radiusKm * 1000) / 180;
}

/** Metres per degree of longitude at a latitude, on a body of this radius. */
export function metresPerDegreeLon(latDeg, radiusKm) {
  return metresPerDegreeLat(radiusKm) * Math.cos((latDeg * Math.PI) / 180);
}

/**
 * The local east/north frame about a centre: the one conversion every part of
 * the model shares, so a probe, an embedded point and a mesh node all mean the
 * same metre.
 */
export function makeLocalFrame({ lat, lon, radiusKm }) {
  const mLat = metresPerDegreeLat(radiusKm);
  const mLon = metresPerDegreeLon(lat, radiusKm);
  return {
    lat0: lat,
    lon0: lon,
    mPerDegLat: mLat,
    mPerDegLon: mLon,
    toLocal: (latDeg, lonDeg) => ({
      x: wrapLonDelta(lonDeg - lon) * mLon,
      y: (latDeg - lat) * mLat,
    }),
    fromLocal: (x, y) => ({
      lat: lat + y / mLat,
      lon: lon + x / mLon,
    }),
  };
}

/** Longitude difference taking the short way round. */
function wrapLonDelta(delta) {
  let d = delta;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export const DEFAULT_MAX_NODES = 160 * 160;

/**
 * How many nodes a step would need over these bounds, and the step actually
 * used once the node cap is applied. Separate from the sampling so a panel can
 * show the cost of a resolution BEFORE spending it.
 */
export function planGrid({ bounds, stepM, radiusKm, maxNodes = DEFAULT_MAX_NODES }) {
  const lat0 = (bounds.south + bounds.north) / 2;
  const lon0 = (bounds.west + bounds.east) / 2;
  const mLat = metresPerDegreeLat(radiusKm);
  const mLon = metresPerDegreeLon(lat0, radiusKm);
  const widthM = Math.abs(wrapLonDelta(bounds.east - bounds.west)) * mLon;
  const heightM = Math.abs(bounds.north - bounds.south) * mLat;
  const requested = Math.max(stepM, 0.01);
  let step = requested;
  let nx = Math.max(2, Math.round(widthM / step) + 1);
  let ny = Math.max(2, Math.round(heightM / step) + 1);
  let capped = false;
  if (nx * ny > maxNodes) {
    // Grow the step rather than truncating the area: a clipped domain is a
    // different study, a coarser one is the same study at a stated resolution.
    // Walked up rather than solved in one shot -- the +1 and the rounding put
    // a single scaled guess back over the cap (51x51 against a 2500 ceiling),
    // and a cap that does not hold is not a cap.
    capped = true;
    step = requested * Math.sqrt((nx * ny) / maxNodes);
    for (let guard = 0; guard < 200; guard += 1) {
      nx = Math.max(2, Math.round(widthM / step) + 1);
      ny = Math.max(2, Math.round(heightM / step) + 1);
      if (nx * ny <= maxNodes) break;
      step *= 1.02;
    }
  }
  return {
    nx,
    ny,
    nodes: nx * ny,
    widthM,
    heightM,
    stepM: step,
    requestedStepM: requested,
    capped,
    stepXm: widthM / (nx - 1),
    stepYm: heightM / (ny - 1),
    origin: { lat: lat0, lon: lon0 },
  };
}

/**
 * The terrain grid: a regular lattice over the study area's bounding box with
 * an elevation at every node.
 *
 * `sampleElevation(lat, lon)` is the injected reader — the viewer's DEM in the
 * page, a closed-form ramp in a test. A node it cannot answer for is filled
 * with the mean of the ones it could and COUNTED, because a hole silently
 * filled with zero is a sea-level pit in the middle of a mountain.
 */
/**
 * The elevation source's OWN sampling, in metres, measured rather than
 * declared.
 *
 * A sampler interpolates bilinearly, so between pixel centres the values run
 * exactly linearly and every kink in the second difference is a pixel
 * boundary; the median spacing of those kinks is the raster's own step. No
 * seam any viewer would have to grow, and it answers the question that decides
 * whether a fine grid is detail or arithmetic — on Earth the global DEM
 * measures about 19.6 km, so a 10 km study is a fraction of ONE pixel and a
 * 92 m grid over it is a smooth interpolation with a pixel boundary running
 * through it, not ground anybody surveyed.
 *
 * Lives here, with the rest of the pure half, because BOTH the Model Builder's
 * surface step and the terrain tool have to say the same number — and a
 * second copy of this is how the polygon-area formula came to be wrong in ten
 * files. Returns null where the ground is too flat to have a measurable kink.
 */
export function nativeStepM({ read, lat, lon, radiusKm = 6371.0088 }) {
  const mPerDegLat = (Math.PI * radiusKm * 1000) / 180;
  const samples = 512;
  const spanDeg = 2.0;
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    values.push(read(lat + (spanDeg * i) / (samples - 1) - spanDeg / 2, lon));
  }
  if (values.some((v) => !Number.isFinite(v))) return null;
  const second = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    second.push(Math.abs(values[i + 1] - 2 * values[i] + values[i - 1]));
  }
  const peak = Math.max(...second);
  if (!(peak > 0)) return null;
  const kinks = [];
  second.forEach((value, i) => { if (value > peak * 0.25) kinks.push(i); });
  if (kinks.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < kinks.length; i += 1) {
    const gap = kinks[i] - kinks[i - 1];
    if (gap > 1) gaps.push(gap);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  return ((spanDeg / (samples - 1)) * medianGap) * mPerDegLat;
}

export function buildSurface({
  bounds, stepM, radiusKm, sampleElevation, maxNodes = DEFAULT_MAX_NODES,
}) {
  const plan = planGrid({ bounds, stepM, radiusKm, maxNodes });
  const { nx, ny } = plan;
  const frame = makeLocalFrame({ lat: plan.origin.lat, lon: plan.origin.lon, radiusKm });
  const lats = new Float64Array(ny);
  const lons = new Float64Array(nx);
  for (let j = 0; j < ny; j += 1) {
    lats[j] = bounds.south + ((bounds.north - bounds.south) * j) / (ny - 1);
  }
  const lonSpan = wrapLonDelta(bounds.east - bounds.west);
  for (let i = 0; i < nx; i += 1) {
    lons[i] = bounds.west + (lonSpan * i) / (nx - 1);
  }

  const z = new Float64Array(nx * ny);
  const filled = [];
  let sum = 0;
  let count = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const value = sampleElevation(lats[j], lons[i]);
      const index = j * nx + i;
      if (Number.isFinite(value)) {
        z[index] = value;
        sum += value;
        count += 1;
      } else {
        z[index] = NaN;
        filled.push(index);
      }
    }
  }
  if (!count) {
    return { ok: false, message: "No elevation could be read anywhere in this area." };
  }
  const mean = sum / count;
  filled.forEach((index) => { z[index] = mean; });

  // Before the extremes are taken, or the relief reported is a void's.
  const spikes = despikeGrid(z, nx, ny, plan.stepM);

  let zMin = Infinity;
  let zMax = -Infinity;
  for (let k = 0; k < z.length; k += 1) {
    if (z[k] < zMin) zMin = z[k];
    if (z[k] > zMax) zMax = z[k];
  }

  const xs = new Float64Array(nx);
  const ys = new Float64Array(ny);
  for (let i = 0; i < nx; i += 1) xs[i] = frame.toLocal(plan.origin.lat, lons[i]).x;
  for (let j = 0; j < ny; j += 1) ys[j] = frame.toLocal(lats[j], plan.origin.lon).y;

  return {
    ok: true,
    nx,
    ny,
    xs,
    ys,
    z,
    lats,
    lons,
    frame,
    origin: plan.origin,
    bounds,
    widthM: plan.widthM,
    heightM: plan.heightM,
    stepXm: plan.stepXm,
    stepYm: plan.stepYm,
    stepM: plan.stepM,
    requestedStepM: plan.requestedStepM,
    capped: plan.capped,
    zMin,
    zMax,
    reliefM: zMax - zMin,
    nodes: nx * ny,
    filledNodes: filled.length,
    repairedNodes: spikes.repaired,
    repairWorstM: spikes.worst,
    repairToleranceM: spikes.toleranceM,
  };
}

/**
 * A HOLE IN THE SOURCE IS NOT A LANDFORM.
 *
 * `dem-tiles` despikes each tile as it decodes it, and cannot catch this: its
 * test is that a post's neighbours both disagree with it, which fails when the
 * bad posts come in a BLOCK. Measured over the Mournes at zoom 14, one such
 * block — two posts wide and four tall, reading −448 to −3,042 m against
 * ground at 4 to 13 — survived into the model grid as a single node at
 * **−3,173 m**, and the mesh grading then spent its finest elements on the
 * 88° walls of a pit that is not there.
 *
 * On the MODEL's grid the block is one node, because the grid is coarser than
 * the source's posts, so a median of the eight neighbours finds it exactly.
 * The tolerance scales with the spacing: at 57 m a 325 m step between adjacent
 * nodes is an 80° wall and therefore a hole, while at a kilometre the same
 * step is a mountainside and must be left alone. Where the grid is too coarse
 * to tell a hole from a cliff, this does nothing — which is the honest
 * behaviour, not a failure.
 */
const SPIKE_FLOOR_M = 300;
const SPIKE_SLOPE = Math.tan((80 * Math.PI) / 180);

export function despikeGrid(z, nx, ny, stepM) {
  const tolerance = Math.max(SPIKE_FLOOR_M, SPIKE_SLOPE * Math.max(stepM, 1));
  const before = Float64Array.from(z);
  const repaired = [];
  const window = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      window.length = 0;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (!di && !dj) continue;
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          window.push(before[y * nx + x]);
        }
      }
      if (window.length < 5) continue;              // a corner has too little to judge by
      window.sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)];
      const index = j * nx + i;
      if (Math.abs(before[index] - median) > tolerance) {
        z[index] = median;
        repaired.push({ i, j, was: before[index], now: median });
      }
    }
  }
  return { repaired: repaired.length, worst: repaired.reduce((a, r) =>
    Math.max(a, Math.abs(r.was - r.now)), 0), toleranceM: tolerance };
}

/* ── STL ─────────────────────────────────────────────────────────────────── */

export function triangleWriter(out, hint) {
  return (a, b, c) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let p = a;
    let q = b;
    let r = c;
    // Wind every facet so its normal agrees with the outward direction we know
    // this face has. Deriving the winding by hand per face is where a closed
    // surface silently becomes an inside-out one.
    if (hint && (nx * hint[0] + ny * hint[1] + nz * hint[2]) < 0) {
      q = c; r = b; nx = -nx; ny = -ny; nz = -nz;
    }
    out.push(`facet normal ${f(nx)} ${f(ny)} ${f(nz)}`);
    out.push("outer loop");
    out.push(`vertex ${f(p[0])} ${f(p[1])} ${f(p[2])}`);
    out.push(`vertex ${f(q[0])} ${f(q[1])} ${f(q[2])}`);
    out.push(`vertex ${f(r[0])} ${f(r[1])} ${f(r[2])}`);
    out.push("endloop");
    out.push("endfacet");
  };
}

function f(value) {
  return Number(value).toFixed(6);
}

function node(grid, i, j) {
  return [grid.xs[i], grid.ys[j], grid.z[j * grid.nx + i]];
}

/** The terrain skin alone — the surface an STL viewer or a mesher's top is. */
export function surfaceStl(grid, name = "geoid_surface") {
  const out = [`solid ${name}`];
  const tri = triangleWriter(out, [0, 0, 1]);
  for (let j = 0; j < grid.ny - 1; j += 1) {
    for (let i = 0; i < grid.nx - 1; i += 1) {
      const a = node(grid, i, j);
      const b = node(grid, i + 1, j);
      const c = node(grid, i + 1, j + 1);
      const d = node(grid, i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  out.push(`endsolid ${name}`);
  return `${out.join("\n")}\n`;
}

/** The grid's perimeter node indices, counter-clockwise seen from above. */
function perimeter(grid) {
  const { nx, ny } = grid;
  const loop = [];
  for (let i = 0; i < nx; i += 1) loop.push([i, 0]);
  for (let j = 1; j < ny; j += 1) loop.push([nx - 1, j]);
  for (let i = nx - 2; i >= 0; i -= 1) loop.push([i, ny - 1]);
  for (let j = ny - 2; j >= 1; j -= 1) loop.push([0, j]);
  return loop;
}

/**
 * The closed domain: terrain on top, vertical skirt walls, a base at
 * `zMin - depthM`.
 *
 * The base is a FAN from its own centre out to the perimeter nodes rather than
 * two big triangles, so every base edge on the boundary matches exactly one
 * wall edge. Two triangles would leave the walls' subdivisions meeting a
 * single long edge — T-junctions, which read as a watertight surface to the
 * eye and as an open one to a mesher.
 */
export function domainStl(grid, { depthM, name = "geoid_domain" } = {}) {
  const baseZ = grid.zMin - Math.max(depthM, 1);
  const out = [`solid ${name}`];
  const top = triangleWriter(out, [0, 0, 1]);
  for (let j = 0; j < grid.ny - 1; j += 1) {
    for (let i = 0; i < grid.nx - 1; i += 1) {
      const a = node(grid, i, j);
      const b = node(grid, i + 1, j);
      const c = node(grid, i + 1, j + 1);
      const d = node(grid, i, j + 1);
      top(a, c, b);
      top(a, d, c);
    }
  }

  const loop = perimeter(grid);
  const cx = (grid.xs[0] + grid.xs[grid.nx - 1]) / 2;
  const cy = (grid.ys[0] + grid.ys[grid.ny - 1]) / 2;
  const centre = [cx, cy, baseZ];
  const down = triangleWriter(out, [0, 0, -1]);
  for (let k = 0; k < loop.length; k += 1) {
    const [i0, j0] = loop[k];
    const [i1, j1] = loop[(k + 1) % loop.length];
    const p = [grid.xs[i0], grid.ys[j0], baseZ];
    const q = [grid.xs[i1], grid.ys[j1], baseZ];
    down(centre, p, q);

    // The wall above this base segment. Its outward direction is the segment's
    // right-hand normal in plan, which for a counter-clockwise loop points out.
    const top0 = node(grid, i0, j0);
    const top1 = node(grid, i1, j1);
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const wall = triangleWriter(out, [ey, -ex, 0]);
    wall(p, q, top1);
    wall(p, top1, top0);
  }
  out.push(`endsolid ${name}`);
  return { text: `${out.join("\n")}\n`, baseZ };
}

/**
 * THE AIR OVER THE GROUND: the same shell, mirrored.
 *
 * A separate closed solid rather than a second volume inside one file, and
 * gmsh is what decided that. Writing the terrain ONCE with a skirt going down
 * from it and another going up gives an interface shared by both volumes —
 * conforming by construction, which is what a coupled run wants — and it
 * cannot be read: the rim edges are then incident to THREE triangles, and
 * `classifySurfaces` refuses the file outright with "wrong topology of
 * triangulation for parametrization". The STL invariant said so first, with
 * `closed` going false on exactly those edges.
 *
 * So each domain is its own watertight solid, its own volume, its own flags.
 * They share the terrain's geometry exactly — the same nodes, from the same
 * grid — but they are two meshes, and a run that needs one conforming mesh
 * across the interface is a further piece of work rather than a flag here.
 */
export function atmosphereStl(grid, { heightM, name = "geoid_atmosphere" } = {}) {
  const skyZ = grid.zMax + Math.max(heightM, 1);
  const out = [`solid ${name}`];
  // The ground, facing DOWN: it is the floor of this solid, so its outward
  // direction is the opposite of the same triangles in the subsurface shell.
  const floor = triangleWriter(out, [0, 0, -1]);
  for (let j = 0; j < grid.ny - 1; j += 1) {
    for (let i = 0; i < grid.nx - 1; i += 1) {
      const a = node(grid, i, j);
      const b = node(grid, i + 1, j);
      const c = node(grid, i + 1, j + 1);
      const d = node(grid, i, j + 1);
      floor(a, b, c);
      floor(a, c, d);
    }
  }
  const loop = perimeter(grid);
  const cx = (grid.xs[0] + grid.xs[grid.nx - 1]) / 2;
  const cy = (grid.ys[0] + grid.ys[grid.ny - 1]) / 2;
  const centre = [cx, cy, skyZ];
  const lid = triangleWriter(out, [0, 0, 1]);
  for (let k = 0; k < loop.length; k += 1) {
    const [i0, j0] = loop[k];
    const [i1, j1] = loop[(k + 1) % loop.length];
    const p = [grid.xs[i0], grid.ys[j0], skyZ];
    const q = [grid.xs[i1], grid.ys[j1], skyZ];
    lid(centre, q, p);
    const top0 = node(grid, i0, j0);
    const top1 = node(grid, i1, j1);
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const wall = triangleWriter(out, [ey, -ex, 0]);
    wall(top0, top1, q);
    wall(top0, q, p);
  }
  out.push(`endsolid ${name}`);
  return { text: `${out.join("\n")}\n`, skyZ };
}

/**
 * What an STL actually contains, and whether it is closed.
 *
 * `openEdges` is the measurement that matters: in a closed surface every edge
 * belongs to exactly two triangles. Vertices are matched by quantised
 * coordinate because STL stores no shared vertices — two facets meeting at a
 * corner write that corner twice.
 */
export function stlStats(text) {
  const verts = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let match = re.exec(text);
  while (match) {
    verts.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    match = re.exec(text);
  }
  const triangles = Math.floor(verts.length / 3);
  const key = (v) => `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
  const unique = new Set();
  const edges = new Map();
  const bounds = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
  };
  for (let t = 0; t < triangles; t += 1) {
    const tri = [verts[t * 3], verts[t * 3 + 1], verts[t * 3 + 2]];
    tri.forEach((v) => {
      unique.add(key(v));
      bounds.minX = Math.min(bounds.minX, v[0]);
      bounds.maxX = Math.max(bounds.maxX, v[0]);
      bounds.minY = Math.min(bounds.minY, v[1]);
      bounds.maxY = Math.max(bounds.maxY, v[1]);
      bounds.minZ = Math.min(bounds.minZ, v[2]);
      bounds.maxZ = Math.max(bounds.maxZ, v[2]);
    });
    for (let e = 0; e < 3; e += 1) {
      const a = key(tri[e]);
      const b = key(tri[(e + 1) % 3]);
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(id, (edges.get(id) || 0) + 1);
    }
  }
  let openEdges = 0;
  edges.forEach((count) => { if (count !== 2) openEdges += 1; });
  return {
    triangles,
    vertices: unique.size,
    edges: edges.size,
    openEdges,
    closed: openEdges === 0,
    euler: unique.size - edges.size + triangles,
    bounds,
  };
}

/* ── the size field ──────────────────────────────────────────────────────── */

/**
 * A MESH SIZE PER PLACE, so the elements go where the ground needs them.
 *
 * One `MeshSizeMax` over a study area spends the same element count on a flat
 * plateau as on the headwall above it. What a FEM run wants is the opposite:
 * fine where the surface bends, on the slopes that carry the gradients the
 * solver is solving for, and coarse where nothing is happening — which is most
 * of a domain by area.
 *
 * gmsh already has the mechanism. A **background size field** is a grid of
 * target sizes it consults for every element it creates, and `Field.Structured`
 * reads one from a file on exactly the lattice this module already builds the
 * terrain from. So the field is computed here, on the same nodes, in the same
 * local metric frame the STL is written in — no second sampling, no
 * registration to get wrong.
 *
 * The map from slope to size is linear in the TANGENT, not the angle: tan is
 * the rise the mesh actually has to resolve across a cell, and it separates
 * 30° from 45° the way an angle does not (0.58 against 1.0, where the degrees
 * are only a third apart).
 */
export function sizeField(grid, {
  coarseM,
  fineM,
  slopeRefDeg = 30,
  padZ = 0,
} = {}) {
  if (!grid?.ok && !grid?.z) return null;
  const { nx, ny, xs, ys, z } = grid;
  const coarse = Number(coarseM) > 0 ? Number(coarseM) : grid.stepM * 2;
  const fine = Number(fineM) > 0 ? Number(fineM) : coarse / 4;
  const ref = Math.tan((Math.max(1, Number(slopeRefDeg)) * Math.PI) / 180);
  const values = new Float64Array(nx * ny);
  let min = Infinity;
  let max = -Infinity;
  let steepest = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      /**
       * Central differences where there are two neighbours and one-sided at
       * the edge, rather than Horn's 3x3: the field is a SIZE, and a size that
       * refuses to exist at the boundary leaves gmsh interpolating the domain's
       * own rim from the inside. Horn is the right estimator for a slope map
       * somebody reads; this one has to answer everywhere.
       */
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < nx - 1 ? i + 1 : i;
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < ny - 1 ? j + 1 : j;
      const dx = xs[i1] - xs[i0];
      const dy = ys[j1] - ys[j0];
      const dzdx = dx !== 0 ? (z[j * nx + i1] - z[j * nx + i0]) / dx : 0;
      const dzdy = dy !== 0 ? (z[j1 * nx + i] - z[j0 * nx + i]) / dy : 0;
      const rise = Math.hypot(dzdx, dzdy);
      if (rise > steepest) steepest = rise;
      const t = Math.min(1, rise / ref);
      values[j * nx + i] = coarse + (fine - coarse) * t;
      if (values[j * nx + i] < min) min = values[j * nx + i];
      if (values[j * nx + i] > max) max = values[j * nx + i];
    }
  }
  return {
    nx,
    ny,
    values,
    coarseM: coarse,
    fineM: fine,
    slopeRefDeg,
    minM: min,
    maxM: max,
    steepestDeg: (Math.atan(steepest) * 180) / Math.PI,
    x0: xs[0],
    y0: ys[0],
    dx: xs[nx - 1] - xs[0],
    dy: ys[ny - 1] - ys[0],
    z0: grid.zMin - padZ,
    dz: (grid.zMax - grid.zMin) + 2 * padZ,
  };
}

/**
 * The field as gmsh's `Field.Structured` text format.
 *
 *     X0 Y0 Z0
 *     DX DY DZ          (the SPACING, not the extent)
 *     NX NY NZ
 *     v … one per line, with the LAST index varying fastest
 *
 * Two planes in z, both the same, because the size depends on where you are in
 * plan and not on depth: a column under a steep face is refined all the way
 * down, which is what a solver wants when the gradient it is resolving arrives
 * from the surface.
 */
export function structuredFieldText(field) {
  if (!field) return "";
  const { nx, ny, values } = field;
  const spacingX = nx > 1 ? field.dx / (nx - 1) : 1;
  const spacingY = ny > 1 ? field.dy / (ny - 1) : 1;
  const spacingZ = field.dz > 0 ? field.dz : 1;
  const out = [
    `${f(field.x0)} ${f(field.y0)} ${f(field.z0)}`,
    `${f(spacingX)} ${f(spacingY)} ${f(spacingZ)}`,
    `${nx} ${ny} 2`,
  ];
  // x slowest, then y, then z fastest -- gmsh reads the last index innermost.
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const v = f(values[j * nx + i]);
      out.push(v, v);
    }
  }
  return `${out.join("\n")}\n`;
}

/* ── gmsh ────────────────────────────────────────────────────────────────── */

const PY = (value) => JSON.stringify(value);

/**
 * THE FLAGS A SOLVER READS, which are integers and not names.
 *
 * gmsh will happily carry both, and this file writes both — but the name is
 * for the reader and the NUMBER is what a deck refers to: GALES' own
 * `gmsh_to_gales.py` takes `int(result[5])` out of the `$Entities` block and
 * refuses outright a point whose tag is 0. The defaults follow the convention
 * `etna_3d/input/gmsh_mesh.py` uses — the volume at 10, the lateral boundaries
 * together at 5 — because a deck written against that pipeline already means
 * those numbers, and a study that wants different ones sets them.
 *
 * The sides share 5 by default, which is also how a shared edge is decided:
 * where two faces meet, the lowest flag owns the curve and its points, so four
 * sides at one number have no ambiguity between them at all.
 */
export const DEFAULT_FLAGS = {
  top: 1,
  base: 2,
  north: 5,
  south: 5,
  east: 5,
  west: 5,
  domain: 10,
  points: 20,
  /**
   * And the ones the EXTENDED form needs, where the study hands over a surface
   * and the volumes are built here. The lateral faces have no compass identity
   * in that form — they are whatever order gmsh returns the rim in — so they
   * are one flag apiece the way etna writes them, above and below kept apart
   * because a boundary condition on the air is not one on the rock.
   */
  terrain: 1,
  sky: 4,
  sides_below: 5,
  sides_above: 6,
  subsurface: 10,
  atmosphere: 11,
};

/**
 * A runnable gmsh Python script for the domain.
 *
 * The same shape the Model Studio emits and the sidecar's `/jobs/gmsh` runs,
 * so this is not a second meshing path: it merges the watertight STL, rebuilds
 * geometry from it, makes one volume, embeds the study's points and writes the
 * mesh where FEM Setup and the GALES prepare already look.
 *
 * The boundary NAMES are the whole point of the physical groups here: a FEM
 * boundary condition names a surface, so "top", "base", "north", "south",
 * "east" and "west" have to exist in the mesh with those names or the spec
 * refers to nothing. They are assigned by where each surface sits, because
 * `classifySurfaces` numbers its output however it likes.
 */
/**
 * The size-field half of the script.
 *
 * Three things have to be true together or the field is written and ignored,
 * which is the failure mode worth naming because the mesh still builds:
 *
 *  * **The background field must be the one gmsh asks.** `Field.setAsBackgroundMesh`
 *    is what makes it authoritative; without it the field is computed and no
 *    element ever consults it.
 *  * **The other size sources must be switched OFF.** By default gmsh takes a
 *    size from the points of the CAD entities and extends it from the
 *    boundary, and those win over a background field in exactly the places the
 *    field was written for — the terrain's own rim. `MeshSizeExtendFromBoundary`,
 *    `MeshSizeFromPoints` and `MeshSizeFromCurvature` all go to zero.
 * A THIRD THING WAS EXPECTED HERE AND MEASURED AWAY. An STL merged into gmsh
 * is a discrete surface whose triangles ARE the mesh — which is true, and led
 * to a `remeshSurface` flag on the belief that the ground would otherwise keep
 * the STL's own spacing. It does not: the script above already runs
 * `classifySurfaces` and `createGeometry`, so the terrain is parametrised
 * geometry before the field is ever consulted, and gmsh regrades it with
 * everything else. Run on a 25,290-triangle ridge STL: without a field the
 * ground came back at 267 m on the steep side and 279 on the flat — uniform,
 * and nothing like the 60 m it was written at — and with one, 40 m against
 * 294. The flag added a second `createGeometry` and changed the result by
 * 1 m in 294, so it is gone rather than kept as a comfort.
 */
function sizeSection({ sizeFieldFile, refineBoxes, meshSizeM, sizeFields = [], meshOptions = {} }) {
  const boxes = (refineBoxes || []).filter((b) =>
    [b.xMin, b.xMax, b.yMin, b.yMax].every((v) => Number.isFinite(Number(v))));
  // The refine-role layers as box fields, beside whatever the study defined.
  const fields = [
    ...boxes.map((box) => ({
      type: "box", name: String(box.name || "refine region"), on: true,
      xMin: box.xMin, xMax: box.xMax, yMin: box.yMin, yMax: box.yMax, zMin: box.zMin, zMax: box.zMax,
      sizeM: Number(box.sizeM) > 0 ? Number(box.sizeM) : Number(meshSizeM) / 4,
      sizeOutM: null,
      thicknessM: Math.max(Number(box.sizeM) > 0 ? Number(box.sizeM) : Number(meshSizeM) / 4, (Number(box.xMax) - Number(box.xMin)) * 0.25),
    })),
    ...(sizeFields || []),
  ];
  if (!sizeFieldFile && !fields.length && !Object.keys(meshOptions || {}).length) return [];
  return sizeFieldLines({
    fields, dim: 3, structuredFile: sizeFieldFile, coarseM: meshSizeM,
    options: { sizeMaxM: null, sizeMinM: null, ...meshOptions },
  });
}

/** The closed form: a watertight STL is already the boundary of one volume. */
/**
 * EXTEND THE BOUNDARY, etna's way — `mesh/etna.py`'s `outer_box`, verbatim in
 * its recipe: classify the terrain STL, take its four rim curves and their
 * corner points, carry the corners to `z_bd`, join them with lines, and close
 * the box with five plane surfaces. It is emitted whenever the study asks for
 * an extended domain, because it is the recipe the Etna decks were built with
 * and a reader of those decks expects to find it.
 *
 * It is OFF by default (`USE_OUTER_BOX = False`) for a measured reason: a
 * PLANE surface through a rim curve needs that curve to be nearly planar, and
 * a real rim is only planar where the ground happens to be flat as it leaves
 * the study area. On a ridge crossing its own boundary two of the four rim
 * curves spanned 593 m in z, `addPlaneSurface` refused them ("Unable to
 * recover the edge") and `addSurfaceFilling` refuses discrete curves outright.
 * The baked skirt the script merges by default conforms to any rim. Flip the
 * switch for a study whose rim is level, and the etna path is exactly there.
 */
function extendSection(extend, name) {
  if (!extend) return [];
  const lid = extend.which === "atmosphere" ? "sky" : "base";
  const sides = extend.which === "atmosphere" ? "sides_above" : "sides_below";
  return [
    "",
    "# EXTEND THE BOUNDARY (mesh/etna.py: outer_box). The study handed over the",
    "# terrain; the volume is built here from its rim. Kept verbatim as the",
    "# alternative path, OFF by default because it needs a rim close to planar:",
    "# measured on a ridge, two rim curves spanned 593 m in z and addPlaneSurface",
    "# refused them. The baked skirt merged above conforms to any rim.",
    "USE_OUTER_BOX = False",
    `EXTEND = ${PY({
      which: extend.which || "subsurface",
      z_bd: Number(extend.zBd),
      h: Number(extend.h) > 0 ? Number(extend.h) : 5000,
      surface_stl: String(extend.surfaceFile || ""),
      below_m: Number(extend.belowM) || 0,
      above_m: Number(extend.aboveM) || 0,
    })}`,
    "",
    "def outer_box(z_bd, h):",
    "    \"\"\"etna.py's outer_box: the rim's corners carried to z_bd, boxed in planes.\"\"\"",
    "    import math",
    "    gmsh.model.mesh.classifySurfaces(math.pi, curveAngle=math.pi / 3)",
    "    gmsh.model.mesh.createGeometry()",
    "    s = gmsh.model.getEntities(2)",
    "    c = gmsh.model.getBoundary(s)",
    "    if len(c) != 4:",
    "        gmsh.logger.write('Should have 4 boundary curves!', level='error')",
    "    p = []",
    "    xyz = []",
    "    for e in c:",
    "        pt = gmsh.model.getBoundary([e], combined=False)",
    "        p.extend([pt[0][1]])",
    "        xyz.extend(gmsh.model.getValue(0, pt[0][1], []))",
    "    p1 = gmsh.model.geo.addPoint(xyz[0], xyz[1], z_bd, h)",
    "    p2 = gmsh.model.geo.addPoint(xyz[3], xyz[4], z_bd, h)",
    "    p3 = gmsh.model.geo.addPoint(xyz[6], xyz[7], z_bd, h)",
    "    p4 = gmsh.model.geo.addPoint(xyz[9], xyz[10], z_bd, h)",
    "    c1 = gmsh.model.geo.addLine(p1, p2)",
    "    c2 = gmsh.model.geo.addLine(p2, p3)",
    "    c3 = gmsh.model.geo.addLine(p3, p4)",
    "    c4 = gmsh.model.geo.addLine(p4, p1)",
    "    c5 = gmsh.model.geo.addLine(p1, p[0])",
    "    c6 = gmsh.model.geo.addLine(p2, p[1])",
    "    c7 = gmsh.model.geo.addLine(p3, p[2])",
    "    c8 = gmsh.model.geo.addLine(p4, p[3])",
    "    ll1 = gmsh.model.geo.addCurveLoop([c1, c2, c3, c4])",
    "    s1 = gmsh.model.geo.addPlaneSurface([ll1])",
    "    ll2 = gmsh.model.geo.addCurveLoop([c1, c6, -c[0][1], -c5])",
    "    s2 = gmsh.model.geo.addPlaneSurface([ll2])",
    "    ll3 = gmsh.model.geo.addCurveLoop([c2, c7, -c[1][1], -c6])",
    "    s3 = gmsh.model.geo.addPlaneSurface([ll3])",
    "    ll4 = gmsh.model.geo.addCurveLoop([c3, c8, -c[2][1], -c7])",
    "    s4 = gmsh.model.geo.addPlaneSurface([ll4])",
    "    ll5 = gmsh.model.geo.addCurveLoop([c4, c5, -c[3][1], -c8])",
    "    s5 = gmsh.model.geo.addPlaneSurface([ll5])",
    "    sl = gmsh.model.geo.addSurfaceLoop([s1, s2, s3, s4, s5, s[0][1]])",
    "    return sl, s1, [s2, s3, s4, s5], s[0][1]",
    "",
    "if USE_OUTER_BOX:",
    "    gmsh.clear()",
    `    gmsh.model.add(${PY(name)})`,
    "    gmsh.merge(EXTEND[\"surface_stl\"])",
    "    sl, lid, sides, top = outer_box(EXTEND[\"z_bd\"], EXTEND[\"h\"])",
    "    volume = gmsh.model.geo.addVolume([sl])",
    "    volumes = {\"domain\": volume}",
    "    gmsh.model.geo.synchronize()",
    "    groups = {\"top\": [top], \"base\": [], \"sky\": [],",
    "              \"north\": [], \"south\": [], \"east\": [], \"west\": [],",
    "              \"sides_below\": [], \"sides_above\": []}",
    `    groups[${PY(lid)}] = [lid]`,
    `    groups[${PY(sides)}] = sides`,
  ];
}

function closedGeometry(stlFile) {
  return [
    "",
    "# The domain arrives as a watertight STL: terrain on top, skirt walls, a base.",
    `gmsh.merge(${PY(stlFile)})`,
    "",
    "# Rebuild geometry from the triangulation, then close it into one volume.",
    "angle = 40 * 3.141592653589793 / 180",
    "gmsh.model.mesh.classifySurfaces(angle, True, True, 180 * 3.141592653589793 / 180)",
    "gmsh.model.mesh.createGeometry()",
    "surfaces = [s[1] for s in gmsh.model.getEntities(2)]",
    "loop = gmsh.model.geo.addSurfaceLoop(surfaces)",
    "volume = gmsh.model.geo.addVolume([loop])",
    "volumes = {\"domain\": volume}",
    "gmsh.model.geo.synchronize()",
    "",
    "# Name the boundaries by where they sit — a boundary condition names a",
    "# surface, and classifySurfaces numbers its output arbitrarily.",
    "box = gmsh.model.getBoundingBox(-1, -1)",
    "x0, y0, z0, x1, y1, z1 = box",
    "span = max(x1 - x0, y1 - y0, 1e-9)",
    "tol = span * 1e-3",
    "groups = {\"top\": [], \"base\": [], \"sky\": [],",
    "          \"north\": [], \"south\": [], \"east\": [], \"west\": []}",
    "for (d, t) in gmsh.model.getEntities(2):",
    "    a0, b0, c0, a1, b1, c1 = gmsh.model.getBoundingBox(d, t)",
    "    if (a1 - a0) < tol:",
    "        groups[\"west\" if (a0 + a1) / 2 < (x0 + x1) / 2 else \"east\"].append(t)",
    "    elif (b1 - b0) < tol:",
    "        groups[\"south\" if (b0 + b1) / 2 < (y0 + y1) / 2 else \"north\"].append(t)",
    "    elif (c1 - c0) < tol:",
    "        # A FLAT LID, and which one it is depends on where it sits. A",
    "        # subsurface shell has one at the bottom and the ground on top; an",
    "        # atmosphere shell has the ground underneath and the sky above, and",
    "        # calling both of those \"top\" put the air's ceiling and the ground",
    "        # it stands on in the same boundary condition.",
    "        groups[\"base\" if (c0 + c1) / 2 < (z0 + z1) / 2 else \"sky\"].append(t)",
    "    else:",
    "        # Whatever is left is the ground: the only surface here that is",
    "        # neither flat nor vertical.",
    "        groups[\"top\"].append(t)",
  ];
}

/**
 * WHY THE VOLUMES ARE NOT BUILT IN GMSH, which is what etna does.
 *
 * `etna_3d/input/gmsh_mesh.py` merges a terrain-only STL and assembles the box
 * below it from built-in CAD entities — four bottom points, four lines, five
 * plane surfaces — whose boundary is the STL's own discrete rim. It was
 * written out here and RUN, and it fails on real ground:
 *
 *     addPlaneSurface  → "Unable to recover the edge 23826 on curve 6"
 *     addSurfaceFilling → "Cannot interpolate ruled surface with discrete
 *                          bounding curves"
 *
 * The reason is measurable. A side face's boundary contains the terrain's rim,
 * and a rim is only planar if the ground is flat where it leaves the study
 * area. Probed on a ridge crossing its own boundary, two of the four rim
 * curves spanned **593 m in z**: a "plane surface" through them is not a
 * plane, its projection self-intersects, and the 2D mesher cannot recover the
 * constrained edges. The ruled alternative refuses discrete curves outright.
 *
 * A TRIANGULATED SKIRT conforms to any rim, planar or not, which is why the
 * walls are built here as triangles instead. What moves to the model page is
 * the DECISION — how far down, how far up — rather than the geometry: the
 * package carries the ground and the extension is a parameter of it, so an
 * atmosphere can be added or a basin deepened without going back to the GIS
 * page to resample a DEM.
 */

export function gmshScript({
  name = "geoid_model",
  stlFile = "geoid_domain.stl",
  meshFile = "geoid_model.msh",
  meshSizeM = 100,
  minSizeM = 0,
  embedPoints = [],
  dim = 3,
  order = 1,
  sizeFieldFile = null,
  refineBoxes = [],
  sizeFields = [],
  meshOptions = null,
  flags = {},
  extend = null,
} = {}) {
  const flag = { ...DEFAULT_FLAGS, ...flags };
  const points = embedPoints.map((p, index) => ({
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    z: Number(p.z) || 0,
    size: Number(p.sizeM) > 0 ? Number(p.sizeM) : meshSizeM / 2,
    name: String(p.name || "point"),
    // A point may carry its own flag; without one they share the points flag,
    // which is what a solver reading "every observation point" expects.
    flag: Number.isFinite(Number(p.flag)) && Number(p.flag) > 0
      ? Math.round(Number(p.flag)) : flag.points + index * 0,
  }));
  return [
    "# GeoID Model Builder — generated from the GIS study area.",
    "# Run: python3 this_script.py   (or through the sidecar's /jobs/gmsh)",
    "import gmsh",
    "",
    "gmsh.initialize()",
    "gmsh.option.setNumber(\"General.Terminal\", 1)",
    `gmsh.model.add(${PY(name)})`,
    ...closedGeometry(stlFile, Boolean(extend?.split)),
    ...extendSection(extend, name),
    "",
    "# THE FLAGS. A solver reads the integer tag, not the name — GALES' own",
    "# preprocessor takes int(result[5]) out of the $Entities block and refuses",
    "# a point whose tag is 0 — so every group is created with the number the",
    "# study chose, and keeps its name beside it for anyone reading the file.",
    `flags = ${PY(flag)}`,
    "# ONE FLAG IS ONE GROUP. Faces given the same number are the same boundary",
    "# as far as gmsh and the solver are concerned -- asking for a second group",
    "# at a number already used is an error, not a merge -- so they are gathered",
    "# first. Four sides at one number is a single lateral boundary, which is",
    "# what a deck written that way means; distinct numbers keep them apart.",
    "faces = {}",
    "labels = {}",
    "for label, tags in groups.items():",
    "    if tags:",
    "        faces.setdefault(flags[label], []).extend(tags)",
    "        labels.setdefault(flags[label], []).append(label)",
    "for value, tags in sorted(faces.items()):",
    "    gmsh.model.addPhysicalGroup(2, sorted(tags), value,",
    "                                name=\"+\".join(sorted(labels[value])))",
    "# One volume or two: the extended form has a subsurface and may have an",
    "# atmosphere, and each is its own physical group.",
    "for vname, vtag in sorted(volumes.items()):",
    "    gmsh.model.addPhysicalGroup(3, [vtag], flags[vname], name=vname)",
    "",
    "# A SURFACE'S EDGES AND CORNERS CARRY ITS FLAG, or they carry none at all:",
    "# a physical group on a face does not reach the curves and points beneath",
    "# it, and an untagged point is what stops the mesh being read. Where two",
    "# faces share an edge the LOWEST flag owns it, so the study decides that",
    "# too by choosing its numbers.",
    "owner = {}",
    "for value in sorted(faces):",
    "    for surface in faces[value]:",
    "        for (_, curve) in gmsh.model.getBoundary([(2, surface)], oriented=False):",
    "            owner.setdefault((1, abs(curve)), value)",
    "            for (_, point) in gmsh.model.getBoundary([(1, abs(curve))], oriented=False):",
    "                owner.setdefault((0, abs(point)), value)",
    "by_flag = {}",
    "for (dim, tag), value in owner.items():",
    "    by_flag.setdefault((dim, value), []).append(tag)",
    "for (dim, value), tags in sorted(by_flag.items()):",
    "    gmsh.model.addPhysicalGroup(dim, sorted(tags), value)",
    "",
    "# Points the study asks the mesh to pass through — sites, boreholes, probes.",
    `embedded = ${PY(points.map((p) => [p.x, p.y, p.z, p.size, p.name, p.flag]))}`,
    "tags = []",
    "for (px, py, pz, psize, pname, pflag) in embedded:",
    "    tags.append((gmsh.model.geo.addPoint(px, py, pz, psize), pflag, pname))",
    "gmsh.model.geo.synchronize()",
    "if tags:",
    "    gmsh.model.mesh.embed(0, [t for (t, _, _) in tags], 3, volume)",
    "    for (t, pflag, pname) in tags:",
    "        gmsh.model.addPhysicalGroup(0, [t], pflag, name=pname)",
    "",
    ...sizeSection({ sizeFieldFile, refineBoxes, meshSizeM, sizeFields, meshOptions: meshOptions || {} }),
    // The cap and the floor are the study's to set; with `meshOptions` they
    // are written there (or left to gmsh), and these are the old one-number way.
    ...(meshOptions ? [] : [
      `gmsh.option.setNumber("Mesh.MeshSizeMax", ${Number(meshSizeM).toFixed(4)})`,
      `gmsh.option.setNumber("Mesh.MeshSizeMin", ${Number(minSizeM).toFixed(4)})`,
    ]),
    `gmsh.option.setNumber("Mesh.ElementOrder", ${Number(order) || 1})`,
    `gmsh.model.mesh.generate(${Number(dim) || 3})`,
    `gmsh.write(${PY(meshFile)})`,
    "gmsh.finalize()",
  ].join("\n");
}

/* ── The FEM run spec ────────────────────────────────────────────────────── */

/** GALES families the sidecar's deck prepare knows, by the domain chosen. */
export const DOMAIN_PHYSICS = {
  solid: "solid",
  fluid: "fluid",
  gas: "fluid",
  thermal: "thermal",
};

export const DEFAULT_MATERIALS = {
  solid: { density: 2700, young: 5e10, poisson: 0.25 },
  fluid: { density: 1000, viscosity: 1e-3 },
  gas: { density: 1.225, viscosity: 1.81e-5 },
  thermal: { density: 2700, young: 5e10, poisson: 0.25 },
};

/**
 * The run specification, in the shape `fem_runs/<run>/spec.json` already has —
 * `physics`, `time`, `properties`, `initial`, `boundary` are read by the FEM
 * pages AND by the sidecar's deck prepare, so the pipeline writes the file
 * those already consume rather than a format of its own.
 *
 * Everything the Model Builder knows that they do not rides under one
 * `geoid_model` key: additive, ignored by both readers, and the record of
 * where a mesh came from.
 */
export function femSpec({
  run,
  mesh,
  domain = "solid",
  dim = 3,
  time = {},
  materials = {},
  initial = {},
  boundary = [],
  provenance = {},
} = {}) {
  const physics = DOMAIN_PHYSICS[domain] || "solid";
  const properties = {
    fluid: { ...DEFAULT_MATERIALS.fluid, ...(materials.fluid || {}) },
    solid: { ...DEFAULT_MATERIALS.solid, ...(materials.solid || {}) },
  };
  if (domain === "gas" && !materials.fluid) properties.fluid = { ...DEFAULT_MATERIALS.gas };
  return {
    solver: "gales",
    physics,
    run: run || "",
    mesh: mesh || "",
    dim: Number(dim) || 3,
    time: {
      scheme: time.scheme || "bdf2",
      start: Number(time.start) || 0,
      end: Number(time.end) || 10,
      step: Number(time.step) || 0.01,
    },
    properties,
    initial: {
      velocity: initial.velocity || [0, 0, 0],
      pressure: Number(initial.pressure) || 0,
      temperature: Number(initial.temperature ?? 293.15),
    },
    boundary: boundary.map((bc) => ({
      surface: String(bc.surface || ""),
      type: String(bc.type || "dirichlet"),
      value: bc.value,
      ...(bc.field ? { field: bc.field } : {}),
      ...(bc.source ? { source: bc.source } : {}),
    })),
    created_by: "GeoID Model Builder (GIS)",
    geoid_model: provenance,
  };
}

/** The layer roles the pipeline understands, in the order they are offered. */
export const LAYER_ROLES = [
  { id: "ignore", label: "Not in the model" },
  { id: "surface", label: "Surface elevation" },
  { id: "initial", label: "Initial condition" },
  { id: "boundary", label: "Boundary condition" },
  { id: "material", label: "Material region" },
  { id: "points", label: "Embedded points" },
];
