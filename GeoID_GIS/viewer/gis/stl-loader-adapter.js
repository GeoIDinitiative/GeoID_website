import * as THREE from "../vendor/three.module.js";
import { STLLoader } from "../vendor/STLLoader.js";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260829-5cd6a46";

const loader = new STLLoader();

// Imported STL files can use any real-world unit (mm, m, km, arbitrary CAD
// units). The scene/camera/OrbitControls are tuned for the ~3.2-unit globe,
// so every imported mesh is rescaled to this target radius rather than
// trusting its native units.
const TARGET_RADIUS = MODEL_MODE_RADIUS;

const DEFAULT_MATERIAL = () => new THREE.MeshStandardMaterial({
  color: 0xd8dee9,
  metalness: 0.05,
  roughness: 0.85,
  side: THREE.DoubleSide,
});

/**
 * Survey, CAD and mesh-generator output is Z-up (X=east, Y=north, Z=elevation)
 * while three.js is Y-up, so an unconverted STL renders lying on its side. The
 * mapping matches the one the Etna viewer bakes into its own STL load:
 * X stays east, source Z becomes up, and source Y (north) becomes -Z.
 */
function convertZUpToYUp(geometry) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    position.setXYZ(i, x, z, -y);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute("normal");
}

export async function loadStlFromArrayBuffer(arrayBuffer, { name = "Imported Mesh", zUp = true } = {}) {
  const geometry = loader.parse(arrayBuffer);

  // Captured before any recentring so the original survey coordinates survive
  // for georeferencing.
  geometry.computeBoundingBox();
  const raw = geometry.boundingBox.clone();
  const sourceBounds = {
    minX: raw.min.x,
    maxX: raw.max.x,
    minY: zUp ? raw.min.y : -raw.max.z,
    maxY: zUp ? raw.max.y : -raw.min.z,
    minZ: zUp ? raw.min.z : raw.min.y,
    maxZ: zUp ? raw.max.z : raw.max.y,
  };

  if (zUp) {
    convertZUpToYUp(geometry);
  }
  geometry.center();
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();

  const rawRadius = geometry.boundingSphere?.radius || 0;
  const scaleFactor = rawRadius > 0 ? TARGET_RADIUS / rawRadius : 1;

  const mesh = new THREE.Mesh(geometry, DEFAULT_MATERIAL());
  mesh.name = name;
  mesh.scale.setScalar(scaleFactor);
  mesh.userData.localModel = true;
  mesh.userData.baseScale = scaleFactor;
  mesh.userData.sourceBounds = sourceBounds;
  mesh.userData.zUp = zUp;

  const boundingSphere = geometry.boundingSphere ? geometry.boundingSphere.clone() : null;
  if (boundingSphere) {
    boundingSphere.radius *= scaleFactor;
  }

  return {
    object3D: mesh,
    boundingSphere,
    info: {
      sourceBounds,
      spanX: sourceBounds.maxX - sourceBounds.minX,
      spanY: sourceBounds.maxY - sourceBounds.minY,
      spanZ: sourceBounds.maxZ - sourceBounds.minZ,
      zUp,
    },
  };
}
