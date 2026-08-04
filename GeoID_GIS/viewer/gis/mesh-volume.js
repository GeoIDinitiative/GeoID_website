// Volumetric tetrahedral meshing, natively in the browser.
//
// Gmsh builds boundary-conforming Delaunay meshes from a CAD kernel, which is
// not something that can be reimplemented here. Instead this uses a lattice
// (Cartesian) mesher: sample a solid's inside-test on a grid, keep the cells
// inside it, and split each cell into tetrahedra. That yields a genuine
// conforming tet mesh with real element quality, at the cost of a stair-stepped
// boundary rather than one that follows the surface exactly.
//
// The pay-off is that booleans come free: a CSG tree is just a combination of
// inside-tests, so union/difference/intersection need no geometry kernel.

// Splitting a cube into 6 tets along a shared diagonal keeps neighbouring
// cells conforming (faces match across cell boundaries).
const CUBE_TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

function cellCorners(x, y, z, h) {
  return [
    [x, y, z], [x + h, y, z], [x + h, y + h, z], [x, y + h, z],
    [x, y, z + h], [x + h, y, z + h], [x + h, y + h, z + h], [x, y + h, z + h],
  ];
}

/**
 * Meshes a solid described by an inside-test.
 *
 * `refine` optionally names a focus sphere; cells intersecting it are split
 * once more, mirroring the Meshing Studio's ball refinement field.
 */
export function latticeTetMesh(insideFn, bounds, {
  cellSize = 1,
  refine = null,
  maxCells = 400000,
  regionFn = null,
} = {}) {
  const h = Math.max(cellSize, 1e-9);
  // No padding: bounds come from the solid itself, and padding by half a cell
  // would place cell centres exactly on planar faces, where an inclusive
  // inside-test (>=/<=) accepts them and inflates the mesh by a whole ring of
  // outside cells.
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / h));
  const ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / h));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / h));
  if (nx * ny * nz > maxCells) {
    return {
      ok: false,
      message: `Cell size too small: ${(nx * ny * nz).toLocaleString()} cells exceeds the ${maxCells.toLocaleString()} limit.`,
    };
  }

  const nodes = [];
  const nodeIndex = new Map();
  const tets = [];
  const regions = [];
  let cellsInside = 0;

  const nodeId = (p) => {
    // Quantise so shared corners collapse to one node.
    const key = `${Math.round(p[0] / h * 1e6)},${Math.round(p[1] / h * 1e6)},${Math.round(p[2] / h * 1e6)}`;
    let id = nodeIndex.get(key);
    if (id === undefined) {
      id = nodes.length / 3;
      nodes.push(p[0], p[1], p[2]);
      nodeIndex.set(key, id);
    }
    return id;
  };

  const emitCell = (ox, oy, oz, size) => {
    const corners = cellCorners(ox, oy, oz, size);
    const ids = corners.map(nodeId);
    const centre = [ox + size / 2, oy + size / 2, oz + size / 2];
    const region = regionFn ? regionFn(centre) : 1;
    CUBE_TETS.forEach(([a, b, c, d]) => {
      tets.push(ids[a], ids[b], ids[c], ids[d]);
      regions.push(region);
    });
  };

  const refineHit = refine && Number.isFinite(refine.radius) && refine.radius > 0
    ? (centre, size) => {
      const dx = centre[0] - refine.x;
      const dy = centre[1] - refine.y;
      const dz = centre[2] - refine.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= refine.radius + size;
    }
    : () => false;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const ox = bounds.minX + i * h;
        const oy = bounds.minY + j * h;
        const oz = bounds.minZ + k * h;
        const centre = [ox + h / 2, oy + h / 2, oz + h / 2];
        if (!insideFn(centre)) {
          continue;
        }
        cellsInside += 1;
        if (refineHit(centre, h)) {
          // One level of subdivision inside the refinement sphere.
          const hh = h / 2;
          for (let sk = 0; sk < 2; sk += 1) {
            for (let sj = 0; sj < 2; sj += 1) {
              for (let si = 0; si < 2; si += 1) {
                const sx = ox + si * hh;
                const sy = oy + sj * hh;
                const sz = oz + sk * hh;
                if (insideFn([sx + hh / 2, sy + hh / 2, sz + hh / 2])) {
                  emitCell(sx, sy, sz, hh);
                }
              }
            }
          }
        } else {
          emitCell(ox, oy, oz, h);
        }
      }
    }
  }

  if (!tets.length) {
    return { ok: false, message: "No cells fell inside the solid. Try a smaller cell size." };
  }

  return {
    ok: true,
    nodes: new Float64Array(nodes),
    tets: new Uint32Array(tets),
    regions: new Uint16Array(regions),
    cellsInside,
    lattice: { nx, ny, nz, h },
  };
}

/**
 * Boundary faces of a tet mesh: any triangular face used by exactly one
 * tetrahedron is on the surface. Interior faces appear twice and cancel.
 */
export function tetBoundarySurface(nodes, tets) {
  const faces = new Map();
  const add = (a, b, c) => {
    const key = [a, b, c].sort((p, q) => p - q).join(",");
    const hit = faces.get(key);
    if (hit) {
      hit.count += 1;
    } else {
      faces.set(key, { count: 1, a, b, c });
    }
  };
  for (let i = 0; i < tets.length; i += 4) {
    const [a, b, c, d] = [tets[i], tets[i + 1], tets[i + 2], tets[i + 3]];
    add(a, b, c); add(a, c, d); add(a, d, b); add(b, d, c);
  }
  const out = [];
  faces.forEach((f) => {
    if (f.count === 1) {
      [f.a, f.b, f.c].forEach((id) => {
        out.push(nodes[id * 3], nodes[id * 3 + 1], nodes[id * 3 + 2]);
      });
    }
  });
  return new Float32Array(out);
}

function tetVolume(nodes, a, b, c, d) {
  const ax = nodes[a * 3]; const ay = nodes[a * 3 + 1]; const az = nodes[a * 3 + 2];
  const bx = nodes[b * 3] - ax; const by = nodes[b * 3 + 1] - ay; const bz = nodes[b * 3 + 2] - az;
  const cx = nodes[c * 3] - ax; const cy = nodes[c * 3 + 1] - ay; const cz = nodes[c * 3 + 2] - az;
  const dx = nodes[d * 3] - ax; const dy = nodes[d * 3 + 1] - ay; const dz = nodes[d * 3 + 2] - az;
  return (bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx)) / 6;
}

function edgeLenSq(nodes, a, b) {
  const dx = nodes[a * 3] - nodes[b * 3];
  const dy = nodes[a * 3 + 1] - nodes[b * 3 + 1];
  const dz = nodes[a * 3 + 2] - nodes[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Element quality, reported the way the Meshing Studio does: a normalised
 * shape measure where 1 is a regular tetrahedron and 0 is degenerate.
 * This uses the volume-to-edge-length ratio (gamma), which is the standard
 * scale-invariant analogue of Gmsh's SICN for tetrahedra.
 */
export function qualityStats(nodes, tets, bins = 10) {
  const values = [];
  let negative = 0;
  let totalVolume = 0;
  for (let i = 0; i < tets.length; i += 4) {
    const [a, b, c, d] = [tets[i], tets[i + 1], tets[i + 2], tets[i + 3]];
    const v = tetVolume(nodes, a, b, c, d);
    if (v < 0) negative += 1;
    totalVolume += Math.abs(v);
    let sumSq = 0;
    [[a, b], [a, c], [a, d], [b, c], [b, d], [c, d]].forEach(([p, q]) => {
      sumSq += edgeLenSq(nodes, p, q);
    });
    const rms = Math.sqrt(sumSq / 6);
    // 6*sqrt(2) * V / rms^3 == 1 for a regular tetrahedron.
    const gamma = rms > 0 ? (6 * Math.SQRT2 * Math.abs(v)) / (rms ** 3) : 0;
    values.push(Math.min(1, gamma));
  }
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((x, y) => x - y);
  const sum = values.reduce((x, y) => x + y, 0);
  const histogram = new Array(bins).fill(0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor(v * bins));
    histogram[idx] += 1;
  });
  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    invertedElements: negative,
    volume: totalVolume,
    histogram,
  };
}

export function elementCounts(nodes, tets, surfacePositions) {
  return {
    nodes: nodes.length / 3,
    tetrahedra: tets.length / 4,
    boundaryTriangles: surfacePositions ? surfacePositions.length / 9 : 0,
  };
}

/** Gmsh 2.2 ASCII writer, so meshes round-trip back into the studio. */
export function toGmsh22(nodes, tets, regions) {
  const lines = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat", "$Nodes", String(nodes.length / 3)];
  for (let i = 0; i < nodes.length / 3; i += 1) {
    lines.push(`${i + 1} ${nodes[i * 3]} ${nodes[i * 3 + 1]} ${nodes[i * 3 + 2]}`);
  }
  lines.push("$EndNodes", "$Elements", String(tets.length / 4));
  for (let i = 0; i < tets.length / 4; i += 1) {
    const tag = regions ? regions[i] : 1;
    lines.push(`${i + 1} 4 2 ${tag} ${tag} ${tets[i * 4] + 1} ${tets[i * 4 + 1] + 1} `
      + `${tets[i * 4 + 2] + 1} ${tets[i * 4 + 3] + 1}`);
  }
  lines.push("$EndElements");
  return lines.join("\n");
}
