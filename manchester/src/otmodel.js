// Optional present-day Old Trafford mesh. Drop one file into models/ (old_trafford.glb, .gltf, .stl or .obj).
// It is auto-fitted to Old Trafford's real footprint: up-axis detected, long axis aligned to the pitch,
// scaled to the OSM stadium outline, centred on the centre spot. models/old_trafford.json can override:
// { "rotateDeg": 180, "scale": 1.02, "offset": [0, 0, 0], "upAxis": "z" }
import * as THREE from 'three';

const FOOTPRINT_LONG = 262;   // m, long side of the stadium outline in OpenStreetMap

async function exists(url) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; } }

export async function loadOldTraffordModel(base = './models/') {
  const tries = ['old_trafford.glb', 'old_trafford.gltf', 'old_trafford.stl', 'old_trafford.obj'];
  let file = null; for (const f of tries) if (await exists(base + f)) { file = f; break; }
  if (!file) return null;
  let opts = {}; try { const r = await fetch(base + 'old_trafford.json'); if (r.ok) opts = await r.json(); } catch {}
  let obj;
  if (file.endsWith('.stl')) {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const geo = await new STLLoader().loadAsync(base + file); geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9d6d0, roughness: 0.7 }));
  } else if (file.endsWith('.obj')) {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    obj = await new OBJLoader().loadAsync(base + file);
    obj.traverse((o) => { if (o.isMesh && !o.material?.map) o.material = new THREE.MeshStandardMaterial({ color: 0xd9d6d0, roughness: 0.7 }); });
  } else {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    obj = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(base + file)).scene;
  }
  const holder = new THREE.Group(); holder.add(obj); holder.name = 'oldTraffordModel';
  if (opts.fitted) {   // already in metres, pitch centre at the origin, pitch long axis on x, north stand on -z
    obj.rotation.y = THREE.MathUtils.degToRad(opts.rotateDeg || 0);
    if (opts.offset) obj.position.set(...opts.offset);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) { o.material.side = THREE.DoubleSide; } } });
    holder.userData.file = file; return holder;
  }
  // up axis: STL / many CAD exports are Z-up
  let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const zUp = opts.upAxis ? opts.upAxis === 'z' : (file.endsWith('.stl') && size.z < Math.min(size.x, size.y));
  if (zUp) obj.rotation.x = -Math.PI / 2;
  obj.updateMatrixWorld(true);
  // plan principal axis from vertices
  const pts = []; const v = new THREE.Vector3();
  obj.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 4000)); for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push([v.x, v.z]); } });
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const inner = new THREE.Group(); holder.remove(obj); inner.add(obj); holder.add(inner);
  obj.position.x -= mx; obj.position.z -= mz;
  inner.rotation.y = ang + THREE.MathUtils.degToRad(opts.rotateDeg || 0);    // long axis -> local x
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner); size = box.getSize(new THREE.Vector3());
  const s = (FOOTPRINT_LONG / Math.max(size.x, size.z)) * (opts.scale || 1);
  inner.scale.setScalar(s); inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  inner.position.y -= box.min.y;
  if (opts.offset) inner.position.add(new THREE.Vector3(...opts.offset));
  holder.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  holder.userData.file = file;
  return holder;
}
