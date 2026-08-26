import * as THREE from "../vendor/three.module.js";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260826-6a9ffa4";

// OBJ and PLY readers, matching the STL/Gmsh adapters' contract so imported
// meshes share the same normalisation, georeferencing and styling path.

function finalizeMesh(positions, name, { zUp = false, sourceBounds = null, color = 0xd8dee9 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const rawRadius = geometry.boundingSphere?.radius || 0;
  const scaleFactor = rawRadius > 0 ? MODEL_MODE_RADIUS / rawRadius : 1;

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
  }));
  mesh.name = name;
  mesh.scale.setScalar(scaleFactor);
  mesh.userData.localModel = true;
  mesh.userData.baseScale = scaleFactor;
  mesh.userData.zUp = zUp;
  if (sourceBounds) {
    mesh.userData.sourceBounds = sourceBounds;
  }

  const boundingSphere = geometry.boundingSphere ? geometry.boundingSphere.clone() : null;
  if (boundingSphere) {
    boundingSphere.radius *= scaleFactor;
  }
  return { mesh, boundingSphere, triangleCount: positions.length / 9 };
}

function boundsOfXyz(values) {
  const b = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
  };
  for (let i = 0; i < values.length; i += 3) {
    const x = values[i]; const y = values[i + 1]; const z = values[i + 2];
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/** Wavefront OBJ: v / f only — materials and normals are ignored. */
export async function loadObj(file) {
  const text = await file.text();
  const vertices = [];
  const positions = [];
  let faces = 0;

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === "v") {
      vertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (parts[0] === "f") {
      // Face entries are v, v/vt, v//vn or v/vt/vn; only the vertex index matters.
      const idx = parts.slice(1).map((token) => {
        const n = parseInt(token.split("/")[0], 10);
        return n < 0 ? vertices.length / 3 + n : n - 1;
      }).filter((n) => Number.isFinite(n) && n >= 0);
      // Fan-triangulate any n-gon.
      for (let i = 1; i + 1 < idx.length; i += 1) {
        [idx[0], idx[i], idx[i + 1]].forEach((v) => {
          positions.push(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]);
        });
        faces += 1;
      }
    }
  });

  if (!positions.length) {
    throw new Error("OBJ contained no faces.");
  }
  const sourceBounds = boundsOfXyz(vertices);
  const { mesh, boundingSphere, triangleCount } = finalizeMesh(positions, file.name, { sourceBounds });
  return {
    object3D: mesh,
    boundingSphere,
    georeferenced: false,
    info: { vertexCount: vertices.length / 3, faceCount: faces, triangleCount, sourceBounds },
  };
}

/** PLY, ASCII and binary-little-endian. */
export async function loadPly(file) {
  const buffer = await file.arrayBuffer();
  const headerText = new TextDecoder("latin1").decode(new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)));
  const endIndex = headerText.indexOf("end_header");
  if (endIndex === -1) {
    throw new Error("Not a PLY file (no header).");
  }
  const headerLines = headerText.slice(0, endIndex).split(/\r?\n/);
  const headerBytes = endIndex + headerText.slice(endIndex).indexOf("\n") + 1;

  let format = "ascii";
  let vertexCount = 0;
  let faceCount = 0;
  const vertexProps = [];
  let current = null;

  headerLines.forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") {
      format = parts[1];
    } else if (parts[0] === "element") {
      current = parts[1];
      if (current === "vertex") vertexCount = Number(parts[2]);
      if (current === "face") faceCount = Number(parts[2]);
    } else if (parts[0] === "property" && current === "vertex") {
      vertexProps.push({ type: parts[1], name: parts[parts.length - 1] });
    }
  });

  const vertices = new Float64Array(vertexCount * 3);
  const positions = [];

  if (format === "ascii") {
    const body = new TextDecoder().decode(new Uint8Array(buffer, headerBytes));
    const lines = body.split(/\r?\n/).filter((l) => l.trim());
    for (let i = 0; i < vertexCount; i += 1) {
      const parts = lines[i].trim().split(/\s+/).map(Number);
      vertices[i * 3] = parts[0];
      vertices[i * 3 + 1] = parts[1];
      vertices[i * 3 + 2] = parts[2];
    }
    for (let f = 0; f < faceCount; f += 1) {
      const parts = lines[vertexCount + f].trim().split(/\s+/).map(Number);
      const n = parts[0];
      for (let i = 1; i + 1 < n; i += 1) {
        [parts[1], parts[i + 1], parts[i + 2]].forEach((v) => {
          positions.push(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]);
        });
      }
    }
  } else if (format.startsWith("binary_little")) {
    const view = new DataView(buffer);
    const sizeOf = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const readAt = (type, offset) => {
      switch (type) {
        case "float": case "float32": return view.getFloat32(offset, true);
        case "double": case "float64": return view.getFloat64(offset, true);
        case "uchar": case "uint8": return view.getUint8(offset);
        case "char": case "int8": return view.getInt8(offset);
        case "ushort": case "uint16": return view.getUint16(offset, true);
        case "short": case "int16": return view.getInt16(offset, true);
        case "uint": case "uint32": return view.getUint32(offset, true);
        default: return view.getInt32(offset, true);
      }
    };
    let offset = headerBytes;
    const stride = vertexProps.reduce((s, p) => s + (sizeOf[p.type] || 4), 0);
    const xIndex = vertexProps.findIndex((p) => p.name === "x");
    for (let i = 0; i < vertexCount; i += 1) {
      let local = offset;
      vertexProps.forEach((prop, pi) => {
        const value = readAt(prop.type, local);
        if (pi >= xIndex && pi < xIndex + 3) {
          vertices[i * 3 + (pi - xIndex)] = value;
        }
        local += sizeOf[prop.type] || 4;
      });
      offset += stride;
    }
    for (let f = 0; f < faceCount && offset < buffer.byteLength; f += 1) {
      const n = view.getUint8(offset);
      offset += 1;
      const idx = [];
      for (let i = 0; i < n; i += 1) {
        idx.push(view.getInt32(offset, true));
        offset += 4;
      }
      for (let i = 1; i + 1 < n; i += 1) {
        [idx[0], idx[i], idx[i + 1]].forEach((v) => {
          positions.push(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]);
        });
      }
    }
  } else {
    throw new Error(`Unsupported PLY format: ${format}`);
  }

  if (!positions.length) {
    throw new Error("PLY contained no faces.");
  }
  const sourceBounds = boundsOfXyz(vertices);
  const { mesh, boundingSphere, triangleCount } = finalizeMesh(positions, file.name, { sourceBounds });
  return {
    object3D: mesh,
    boundingSphere,
    georeferenced: false,
    info: { vertexCount, faceCount, triangleCount, plyFormat: format, sourceBounds },
  };
}

/**
 * ESRI / GDAL ASCII grid (.asc). Header gives the origin and cell size, so the
 * grid can be georeferenced directly.
 */
export async function parseAsciiGrid(file) {
  const text = await file.text();
  const tokens = text.split(/\s+/).filter(Boolean);
  const header = {};
  let index = 0;
  const keys = ["ncols", "nrows", "xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize", "nodata_value"];
  while (index < tokens.length) {
    const key = String(tokens[index]).toLowerCase();
    if (!keys.includes(key)) {
      break;
    }
    header[key] = Number(tokens[index + 1]);
    index += 2;
  }
  const width = header.ncols;
  const height = header.nrows;
  if (!width || !height || !header.cellsize) {
    throw new Error("ASCII grid header is missing ncols/nrows/cellsize.");
  }
  const noData = Number.isFinite(header.nodata_value) ? header.nodata_value : -9999;
  const band = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const v = Number(tokens[index + i]);
    band[i] = Number.isFinite(v) && v !== noData ? v : NaN;
  }
  const originX = header.xllcorner ?? ((header.xllcenter ?? 0) - header.cellsize / 2);
  const originY = header.yllcorner ?? ((header.yllcenter ?? 0) - header.cellsize / 2);
  const bounds = {
    minX: originX,
    minY: originY,
    maxX: originX + width * header.cellsize,
    maxY: originY + height * header.cellsize,
  };
  return { band, width, height, bounds, noData: NaN, cellSize: header.cellsize };
}
