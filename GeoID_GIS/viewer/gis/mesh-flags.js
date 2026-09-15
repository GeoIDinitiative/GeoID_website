/**
 * WHAT A MESH ACTUALLY CARRIES, and whether the model's setup can land on it.
 *
 * A boundary condition in GALES is compiled against a FLAG NUMBER, and the
 * solver finds nothing to hold if the mesh gmsh wrote has no face with that
 * number — a physical group lost to a failed boolean, a flag renumbered
 * after the setup was written, a surface gmsh merged into its neighbour. None
 * of that fails loudly: the deck builds, the solve runs, and the model moves
 * as a rigid body or sits at zero. So the flags are read off the mesh itself
 * (a gmsh .msh or a GALES text mesh, parsed by gales-results.js) and set
 * against the conditions and materials before anything is prepared.
 *
 * Pure: the parsed mesh in, counts and sentences out.
 */

const count = (flags) => {
  const out = new Map();
  for (let i = 0; i < flags.length; i += 1) out.set(flags[i], (out.get(flags[i]) || 0) + 1);
  return out;
};

const ELEMENT_NAMES = {
  3: { 2: "2-node lines", 3: "3-node triangles", 4: "4-node tetrahedra", 6: "6-node triangles", 8: "8-node hexahedra", 10: "10-node tetrahedra" },
  2: { 2: "2-node lines", 3: "3-node triangles", 4: "4-node quadrilaterals", 6: "6-node triangles", 9: "9-node quadrilaterals" },
};

/**
 * Counts by flag: the cells (volumes in 3D, surfaces in 2D) by their
 * physical flag, the boundary sides by theirs, and the flags that live only
 * on nodes (an embedded point's own group). Element kinds by node count.
 */
export function meshFlagReport(mesh) {
  if (!mesh?.cellOffsets) return null;
  const cells = count(mesh.cellFlag || []);
  const sides = count(mesh.sideFlag || []);
  const kinds = new Map();
  for (let c = 0; c + 1 < mesh.cellOffsets.length; c += 1) {
    const n = mesh.cellOffsets[c + 1] - mesh.cellOffsets[c];
    kinds.set(n, (kinds.get(n) || 0) + 1);
  }
  const nodeOnly = new Map();
  const faceFlags = new Set(sides.keys());
  const cellFlags = new Set(cells.keys());
  for (const [flag, n] of count(mesh.nodeFlag || [])) {
    if (flag && !faceFlags.has(flag) && !cellFlags.has(flag)) nodeOnly.set(flag, n);
  }
  const sorted = (m) => [...m].filter(([flag]) => flag !== 0).sort((a, b) => a[0] - b[0]).map(([flag, n]) => ({ flag, count: n }));
  return {
    dim: mesh.dim,
    nodes: mesh.nodeCount,
    cells: mesh.cellOffsets.length - 1,
    sides: (mesh.sideOffsets?.length || 1) - 1,
    kinds: [...kinds].sort((a, b) => a[0] - b[0]).map(([nodes, n]) => ({ nodes, count: n, name: ELEMENT_NAMES[mesh.dim]?.[nodes] || `${nodes}-node elements` })),
    volumes: sorted(cells),
    faces: sorted(sides),
    points: sorted(nodeOnly),
    unflaggedCells: cells.get(0) || 0,
    unflaggedSides: sides.get(0) || 0,
  };
}

/**
 * THE SETUP AGAINST THE MESH, in the checklist's own shape ({ level, step,
 * text }). An error is a condition or material that will reach nothing; a
 * warning is a part of the mesh the setup says nothing about.
 */
export function flagCheck(setup, report) {
  if (!report) return [];
  const out = [];
  const faces = new Set(report.faces.map((f) => f.flag));
  const volumes = new Set(report.volumes.map((v) => v.flag));
  const set = Object.entries(setup?.conditions || {}).filter(([, c]) => c?.type && c.type !== "free").map(([flag]) => Number(flag));
  const lost = set.filter((flag) => !faces.has(flag));
  if (lost.length) {
    out.push({ level: "error", step: "physics", text: `The mesh has no boundary face with flag ${lost.join(", ")}: ${lost.length === 1 ? "that condition reaches" : "those conditions reach"} nothing. Mesh again, or move the condition to a flag the mesh carries (${[...faces].join(", ") || "none"}).` });
  }
  const assigned = Object.keys(setup?.materials || {}).map(Number).filter((flag) => setup.materials[flag]?.id);
  const missing = assigned.filter((flag) => !volumes.has(flag));
  if (missing.length && volumes.size) {
    out.push({ level: "warning", step: "materials", text: `No ${report.dim === 2 ? "surface" : "volume"} of the mesh carries flag ${missing.join(", ")}, which has a material.` });
  }
  const bare = [...volumes].filter((flag) => !assigned.includes(flag));
  if (bare.length && assigned.length) {
    out.push({ level: "warning", step: "materials", text: `Mesh ${report.dim === 2 ? "surface" : "volume"} flag ${bare.join(", ")} has no material of its own.` });
  }
  if (report.unflaggedSides) {
    out.push({ level: "warning", step: "physics", text: `${report.unflaggedSides.toLocaleString()} boundary face${report.unflaggedSides === 1 ? "" : "s"} carry no flag: no condition can be set on them, so they stay free.` });
  }
  if (report.unflaggedCells) {
    out.push({ level: "error", step: "mesh", text: `${report.unflaggedCells.toLocaleString()} element${report.unflaggedCells === 1 ? " carries" : "s carry"} no physical flag: gmsh_to_gales.py refuses a mesh with untagged elements.` });
  }
  return out;
}
