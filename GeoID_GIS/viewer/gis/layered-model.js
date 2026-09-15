/**
 * A layered 3D model on one surface — the pure half.
 *
 * The Model Builder built a single rock volume under the terrain and an air
 * volume over it. A real site is more than that, and the two things missing
 * are the ones a hazard model needs most:
 *
 *  - WATER. The sea, lakes and rivers are a domain of their own with their own
 *    material. Where the DEM is at or below sea level on the ocean mask, the
 *    water runs from 0 m down to the bathymetry; a lake stands at its surveyed
 *    surface over its bed; a river keeps the DEM as its water surface and is
 *    given a bed a channel depth below it (Moody & Troutman, from its width).
 *  - SOIL OVER BEDROCK. The ground is not one material. The soil (everything
 *    above bedrock — Pelletier et al. 2016) and the bedrock are two volumes
 *    sharing one surface: the bedrock top is the ground minus the soil's
 *    thickness.
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
 *   bedrock[i] solid[i] − soil thickness (never less than the minimum)
 *   top[i]    max(solid, water): the floor of the atmosphere
 */

import { channelDepth } from "./inundation.js?v=20260915-43c303e";

/** A TIN with a different z array, and its own extremes. */
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
  thicknessAt = null, minSoilM = 1, defaultSoilM = 2, offshoreSoilM = null,
  oceanAt = null, lakeAt = null, riverWidthAt = null, seaLevel = 0, water = true, soil = true,
  minWaterM = 1,
} = {}) {
  const n = tin.z.length;
  const solid = Float64Array.from(tin.z);
  const waterTop = Float64Array.from(tin.z);
  const wet = new Uint8Array(n);      // 0 dry, 1 sea, 2 lake, 3 river
  const bedrock = new Float64Array(n);
  let sea = 0; let lake = 0; let river = 0; let modelled = 0; let thickSum = 0; let deepened = 0;
  for (let i = 0; i < n; i += 1) {
    const z = tin.z[i];
    if (water) {
      const lk = lakeAt ? lakeAt(i) : null;
      const rw = riverWidthAt ? Number(riverWidthAt(i)) || 0 : 0;
      if (oceanAt && oceanAt(i) && z <= seaLevel) {
        // THE SEA: 0 m down to the bathymetry the DEM already carries — but
        // never shallower than `minWaterM`. Water that thins to nothing along
        // the shore pinches its side walls to zero height, the wall's top and
        // bottom rims touch, and gmsh reports "intersections in the 1D mesh"
        // and then "No elements in volume". The minimum lowers the bed by at
        // most that much in the shallowest water, and the count says where.
        wet[i] = 1; waterTop[i] = seaLevel; sea += 1;
        if (solid[i] > seaLevel - minWaterM) { solid[i] = seaLevel - minWaterM; deepened += 1; }
      } else if (lk && Number.isFinite(lk.level)) {
        // A LAKE stands at its surveyed surface; its bed is the DEM where the
        // DEM is below it, else the surface less the lake's mean depth.
        const bed = z < lk.level - 0.5 ? z : lk.level - Math.max(0.5, Number(lk.depth) || 2);
        wet[i] = 2; waterTop[i] = lk.level; solid[i] = Math.min(bed, lk.level - Math.max(0.5, minWaterM)); lake += 1;
      } else if (rw > 0) {
        // A RIVER: the DEM reads the water surface; the bed is a channel
        // depth below it.
        wet[i] = 3; waterTop[i] = z; solid[i] = z - channelDepth(rw); river += 1;
      }
    }
    let t = thicknessAt ? thicknessAt(i) : null;
    if (Number.isFinite(t)) { modelled += 1; thickSum += t; }
    else t = wet[i] === 1 && Number.isFinite(offshoreSoilM) ? offshoreSoilM : defaultSoilM;
    bedrock[i] = soil ? solid[i] - Math.max(minSoilM, t) : solid[i];
  }
  const top = new Float64Array(n);
  for (let i = 0; i < n; i += 1) top[i] = Math.max(solid[i], waterTop[i]);
  return {
    solid, water: waterTop, bedrock, top, wet,
    counts: { nodes: n, sea, lake, river, deepened, soilModelled: modelled, meanSoilM: modelled ? thickSum / modelled : null },
  };
}

function edgeKey(a, b) { return a < b ? `${a},${b}` : `${b},${a}`; }

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
  tin.tris.forEach((tri, k) => {
    if (keep && !keep(tri, k)) return;
    const [a, b, c] = tri;
    // Skip a triangle whose top and bottom coincide at all three nodes: it
    // holds no volume and would be two coplanar faces back to back.
    if (top[a] - zb(a) <= minGap && top[b] - zb(b) <= minGap && top[c] - zb(c) <= minGap) return;
    facets.push({ a: P(a, top[a]), b: P(b, top[b]), c: P(c, top[c]), hint: [0, 0, 1], face: topFace });
    facets.push({ a: P(a, zb(a)), b: P(c, zb(c)), c: P(b, zb(b)), hint: [0, 0, -1], face: bottomFace });
    [[a, b, c], [b, c, a], [c, a, b]].forEach(([u, v, w]) => {
      const key = edgeKey(u, v);
      const e = edges.get(key);
      if (e) e.count += 1; else edges.set(key, { u, v, w, count: 1 });
    });
  });
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
export function layeredGmshScript({ name, stlFile, meshFile, meshSizeM, minSizeM = 0, faceFlags = {}, volumeFlag = 10, volumeName = "domain" }) {
  return [
    `# GeoID Model Builder — the ${volumeName} volume of a layered model.`,
    "# Run: python3 this_script.py   (or through the sidecar's /jobs/gmsh)",
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
  top: 1, base: 2, sky: 4, sides: 5, sides_above: 6,
  bedrock_top: 7, water_surface: 8, bed: 9, water_sides: 3,
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
