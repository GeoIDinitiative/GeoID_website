import * as THREE from "../vendor/three.module.js";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260810-d5b078d";

// Gmsh files routinely reach hundreds of megabytes (the reference Etna mesh is
// 226MB / 4.7M lines), so the file is streamed and decoded incrementally
// instead of being materialised as one giant string and line array.
const TARGET_RADIUS = MODEL_MODE_RADIUS;

// Element type -> node count, for the types that describe renderable surfaces
// or volumes. Everything else is counted and skipped.
const TRIANGLE_TYPE = 2;
const QUAD_TYPE = 3;
const TET_TYPE = 4;
const HEX_TYPE = 5;
const NODES_PER_TYPE = { 1: 2, 2: 3, 3: 4, 4: 4, 5: 8, 6: 6, 7: 5, 15: 1 };

// Volume faces are only needed when a mesh stores no explicit surface. A large
// tet mesh yields tens of millions of them, so accumulation is capped: meshes
// that do ship surface triangles (the common case) never pay for it, and the
// cap is reported rather than silently producing a holed surface.
const MAX_VOLUME_FACE_INDICES = 6000000;

/** Faces of a volume element, used to derive a surface when none is stored. */
const TET_FACES = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
const HEX_FACES = [
  [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
  [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
];

async function* streamLines(file, onProgress) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let remainder = "";
  let bytesSeen = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      bytesSeen += value.length;
      onProgress?.(bytesSeen);
      const chunk = remainder + value;
      const lines = chunk.split("\n");
      remainder = lines.pop() ?? "";
      for (let i = 0; i < lines.length; i += 1) {
        yield lines[i];
      }
    }
    if (remainder.length) {
      yield remainder;
    }
  } finally {
    reader.releaseLock();
  }
}

function addFace(target, counts, a, b, c) {
  target.push(a, b, c);
  counts.faces += 1;
}

/**
 * Boundary faces of a volume mesh: any face referenced exactly once belongs to
 * the surface. Interior faces appear twice and are discarded, which keeps the
 * render to the visible skin rather than millions of hidden tetrahedra.
 */
function extractBoundaryFaces(volumeFaces) {
  const seen = new Map();
  for (let i = 0; i < volumeFaces.length; i += 3) {
    const a = volumeFaces[i];
    const b = volumeFaces[i + 1];
    const c = volumeFaces[i + 2];
    const key = [a, b, c].sort((p, q) => p - q).join(",");
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      seen.set(key, { count: 1, a, b, c });
    }
  }
  const boundary = [];
  seen.forEach((entry) => {
    if (entry.count === 1) {
      boundary.push(entry.a, entry.b, entry.c);
    }
  });
  return boundary;
}

export async function loadMshFile(file, { onProgress } = {}) {
  const nodeIds = [];
  const nodeXyz = [];
  const surfaceFaces = [];
  const volumeFaces = [];
  const counts = {
    nodes: 0, elements: 0, faces: 0, skipped: 0, volumeElements: 0, volumeCapped: false,
  };

  let section = null;
  let version = 2.2;
  let headerCountdown = 0;
  let maxNodeId = 0;

  // Format 4.1 groups nodes into entity blocks: a block header, then a run of
  // tags, then the matching run of coordinates.
  let v41 = null;

  for await (const rawLine of streamLines(file, onProgress)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.charCodeAt(0) === 36) { // '$'
      if (line === "$MeshFormat") {
        section = "meshformat";
      } else if (line === "$Nodes" || line === "$ParametricNodes") {
        section = "nodes";
        headerCountdown = 1;
        v41 = version >= 4 ? { stage: "block", tags: [], pending: 0 } : null;
      } else if (line === "$Elements") {
        section = "elements";
        headerCountdown = 1;
        v41 = version >= 4 ? { stage: "block", pending: 0, type: 0 } : null;
      } else if (line.startsWith("$End")) {
        section = null;
      } else {
        section = "skip";
      }
      continue;
    }

    if (section === "meshformat") {
      version = parseFloat(line.split(/\s+/)[0]) || 2.2;
      continue;
    }

    if (section === "nodes") {
      if (headerCountdown > 0) {
        headerCountdown = 0;
        continue;
      }
      const parts = line.split(/\s+/);
      if (version >= 4) {
        if (v41.stage === "block") {
          v41.pending = Number(parts[3]) || 0;
          v41.tags = [];
          v41.stage = v41.pending > 0 ? "tags" : "block";
        } else if (v41.stage === "tags") {
          v41.tags.push(Number(parts[0]));
          if (v41.tags.length >= v41.pending) {
            v41.stage = "coords";
            v41.coordIndex = 0;
          }
        } else if (v41.stage === "coords") {
          const id = v41.tags[v41.coordIndex];
          nodeIds.push(id);
          nodeXyz.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
          if (id > maxNodeId) maxNodeId = id;
          counts.nodes += 1;
          v41.coordIndex += 1;
          if (v41.coordIndex >= v41.pending) {
            v41.stage = "block";
          }
        }
      } else {
        const id = Number(parts[0]);
        nodeIds.push(id);
        nodeXyz.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
        if (id > maxNodeId) maxNodeId = id;
        counts.nodes += 1;
      }
      continue;
    }

    if (section === "elements") {
      if (headerCountdown > 0) {
        headerCountdown = 0;
        continue;
      }
      const parts = line.split(/\s+/);
      let type;
      let nodes;
      if (version >= 4) {
        if (v41.stage === "block") {
          v41.type = Number(parts[2]);
          v41.pending = Number(parts[3]) || 0;
          v41.stage = v41.pending > 0 ? "items" : "block";
          continue;
        }
        type = v41.type;
        nodes = parts.slice(1).map(Number);
        v41.pending -= 1;
        if (v41.pending <= 0) {
          v41.stage = "block";
        }
      } else {
        type = Number(parts[1]);
        const numTags = Number(parts[2]) || 0;
        nodes = parts.slice(3 + numTags).map(Number);
      }
      counts.elements += 1;

      const expected = NODES_PER_TYPE[type];
      if (!expected || nodes.length < expected) {
        counts.skipped += 1;
        continue;
      }

      if (type === TRIANGLE_TYPE) {
        addFace(surfaceFaces, counts, nodes[0], nodes[1], nodes[2]);
      } else if (type === QUAD_TYPE) {
        addFace(surfaceFaces, counts, nodes[0], nodes[1], nodes[2]);
        addFace(surfaceFaces, counts, nodes[0], nodes[2], nodes[3]);
      } else if (type === TET_TYPE || type === HEX_TYPE) {
        counts.volumeElements += 1;
        if (!surfaceFaces.length && volumeFaces.length < MAX_VOLUME_FACE_INDICES) {
          if (type === TET_TYPE) {
            TET_FACES.forEach(([a, b, c]) => volumeFaces.push(nodes[a], nodes[b], nodes[c]));
          } else {
            HEX_FACES.forEach(([a, b, c, d]) => {
              volumeFaces.push(nodes[a], nodes[b], nodes[c]);
              volumeFaces.push(nodes[a], nodes[c], nodes[d]);
            });
          }
        } else if (!surfaceFaces.length) {
          counts.volumeCapped = true;
        }
      } else {
        counts.skipped += 1;
      }
    }
  }

  if (!counts.nodes) {
    throw new Error("No nodes were found - not a recognised Gmsh mesh.");
  }

  // Explicit surface triangles win; otherwise the skin of the volume mesh is
  // derived so a tet-only mesh still renders.
  let faces = surfaceFaces;
  let derivedSurface = false;
  if (!faces.length && volumeFaces.length) {
    faces = extractBoundaryFaces(volumeFaces);
    derivedSurface = true;
  }
  if (!faces.length) {
    throw new Error(counts.volumeCapped
      ? "Volume mesh is too large to derive a surface from in the browser."
      : "Mesh contained no renderable surface elements.");
  }

  const indexById = new Int32Array(maxNodeId + 2).fill(-1);
  for (let i = 0; i < nodeIds.length; i += 1) {
    indexById[nodeIds[i]] = i;
  }

  // Source-coordinate extent, retained so the mesh can be georeferenced from
  // its original survey grid. Axes here are the raw file axes (Z-up).
  const sourceBounds = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (let i = 0; i < counts.nodes; i += 1) {
    const sx = nodeXyz[i * 3];
    const sy = nodeXyz[i * 3 + 1];
    const sz = nodeXyz[i * 3 + 2];
    if (sx < sourceBounds.minX) sourceBounds.minX = sx;
    if (sx > sourceBounds.maxX) sourceBounds.maxX = sx;
    if (sy < sourceBounds.minY) sourceBounds.minY = sy;
    if (sy > sourceBounds.maxY) sourceBounds.maxY = sy;
    if (sz < sourceBounds.minZ) sourceBounds.minZ = sz;
    if (sz > sourceBounds.maxZ) sourceBounds.maxZ = sz;
  }

  const positions = new Float32Array(faces.length * 3);
  let out = 0;
  let dropped = 0;
  for (let i = 0; i < faces.length; i += 1) {
    const idx = indexById[faces[i]];
    if (idx === undefined || idx < 0) {
      dropped += 1;
      positions[out] = 0;
      positions[out + 1] = 0;
      positions[out + 2] = 0;
      out += 3;
      continue;
    }
    positions[out] = nodeXyz[idx * 3];
    positions[out + 1] = nodeXyz[idx * 3 + 2];
    positions[out + 2] = -nodeXyz[idx * 3 + 1];
    out += 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const rawRadius = geometry.boundingSphere?.radius || 0;
  const scaleFactor = rawRadius > 0 ? TARGET_RADIUS / rawRadius : 1;

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xc9b79c,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
    flatShading: true,
  }));
  mesh.name = file.name;
  mesh.scale.setScalar(scaleFactor);
  mesh.userData.localModel = true;
  mesh.userData.baseScale = scaleFactor;
  mesh.userData.sourceBounds = sourceBounds;
  mesh.userData.zUp = true;

  const boundingSphere = geometry.boundingSphere?.clone() || null;
  if (boundingSphere) {
    boundingSphere.radius *= scaleFactor;
  }

  return {
    object3D: mesh,
    georeferenced: false,
    bounds: null,
    boundingSphere,
    info: {
      nodeCount: counts.nodes,
      elementCount: counts.elements,
      volumeElementCount: counts.volumeElements,
      triangleCount: faces.length / 3,
      derivedSurface,
      droppedVertices: dropped,
      gmshVersion: version,
      sourceBounds,
      spanX: sourceBounds.maxX - sourceBounds.minX,
      spanY: sourceBounds.maxY - sourceBounds.minY,
    },
  };
}
