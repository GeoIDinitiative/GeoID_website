// Real-world surroundings from OpenStreetMap (projected to local metres, origin = Old Trafford centre spot).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, flatPoly, ribbon, std, rng, canvasTex } from './kit.js';

export function pointInPoly([x, z], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const centroid = (p) => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);

function wallsGeo(poly, h, color) {
  const pos = [], col = [], c = new THREE.Color(color);
  for (let i = 0; i < poly.length - 1; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[i + 1];
    pos.push(x1, 0, z1, x2, 0, z2, x2, h, z2, x1, 0, z1, x2, h, z2, x1, h, z1);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); return g;
}
function roofGeo(poly, h, color) {
  const g = flatPoly(poly.slice(0, -1), h); const c = new THREE.Color(color), n = g.attributes.position.count, col = [];
  for (let i = 0; i < n; i++) col.push(c.r, c.g, c.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

const ROOF = { house: 0xb59a88, semidetached_house: 0xb39684, terrace: 0xad9180, detached: 0xb89d8b };
const WALL = { house: 0xa98670, semidetached_house: 0xa6826c, terrace: 0x9d7a64, detached: 0xae8c76, industrial: 0xc9cacb, warehouse: 0xcfd0d0, apartments: 0xc7b9a8, office: 0xb3b9bd };
const LAND = { grass: 0x7fa05a, park: 0x6f9a4e, garden: 0x7aa25a, recreation_ground: 0x76a052, playground: 0x8db56a, meadow: 0x8aa862,
  residential: 0xcfc8ba, industrial: 0xc4bdb0, commercial: 0xcbc3b6, retail: 0xcdc4b6, railway: 0xa89b88, construction: 0xb7a893,
  brownfield: 0xa99c86, cemetery: 0x86a06a, allotments: 0x8fa564, forest: 0x557a3f, farmland: 0xa8b07a };

// Orthoimagery extents (local metres) — must match tools/fetch_ortho.py runs
export const ORTHO = { wide: { url: 'data/ortho.jpg', b: [-1800, 1000, -1400, 1400] }, core: { url: 'data/ortho_core.jpg', b: [-1200, 300, -700, 800] } };

export async function loadOrtho(base = './') {
  const L = new THREE.TextureLoader(); const out = {};
  for (const [k, o] of Object.entries(ORTHO)) {
    const t = await L.loadAsync(base + o.url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.generateMipmaps = true;
    out[k] = { tex: t, b: o.b };
  }
  return out;
}
const inB = ([x, z], b) => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
function orthoUV(geo, b) {
  const p = geo.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) - b[0]) / (b[1] - b[0]), 1 - (p.getZ(i) - b[2]) / (b[3] - b[2]));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return geo;
}

export function buildContext(ctx, { clear = () => false, ortho, buildings = true } = {}) {
  const g = new THREE.Group(); g.name = 'context';
  const skip = (p) => clear(centroid(p));
  const tint = new THREE.Color().setRGB(1.25, 1.22, 1.18);
  // imagery ground: wide ortho, sharp core ortho
  // (beyond the wide ortho the ground is horizon.js: mid imagery, then terrain)
  for (const [k, y] of [['wide', -0.12], ['core', -0.06]]) {
    const { tex, b } = ortho[k];
    const geo = new THREE.PlaneGeometry(b[1] - b[0], b[3] - b[2]); geo.rotateX(-Math.PI / 2); geo.translate((b[0] + b[1]) / 2, y, (b[2] + b[3]) / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: tint }));
    m.receiveShadow = true; m.name = 'ortho_' + k; g.add(m);
  }
  // buildings: neutral walls, rooftops textured from the imagery itself
  const walls = [], roofsCore = [], roofsWide = [];
  for (const b of buildings ? ctx.buildings : []) {   // off when src/city.js draws the city
    if (b.p.length < 4 || skip(b.p)) continue;
    const c = centroid(b.p); if (!inB(c, ortho.wide.b)) continue;
    const wc = new THREE.Color(WALL[b.k] ?? 0xcfc9bf);
    walls.push(wallsGeo(b.p, b.h, wc));
    const r = flatPoly(b.p.slice(0, -1), b.h + 0.05); r.deleteAttribute('uv');
    const core = inB(c, ortho.core.b);
    (core ? roofsCore : roofsWide).push(orthoUV(r.index ? r.toNonIndexed() : r, core ? ortho.core.b : ortho.wide.b));
  }
  if (walls.length) {
  const wm = new THREE.Mesh(mergeGeometries(walls), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
  }
  for (const [list, k] of [[roofsCore, 'core'], [roofsWide, 'wide']]) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ map: ortho[k].tex, color: tint, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  return g;
}

// Instanced deciduous trees (crown + trunk)
export function trees(pts, R = Math.random, { scale = 1, colors = [0x4f7a35, 0x5d8a3c, 0x46703a, 0x6b8f3f] } = {}) {
  const g = new THREE.Group();
  const crown = new THREE.IcosahedronGeometry(1, 1), trunk = new THREE.CylinderGeometry(0.18, 0.25, 1, 5);
  const cm = new THREE.InstancedMesh(crown, std(0xffffff, { roughness: 0.95, flatShading: true }), pts.length);
  const tm = new THREE.InstancedMesh(trunk, std(0x5a4636), pts.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  pts.forEach(([x, z], i) => {
    const s = (3 + R() * 2.5) * scale, h = s * 1.3;
    M.compose(new THREE.Vector3(x, h + s * 0.6, z), q, new THREE.Vector3(s, s * 1.15, s)); cm.setMatrixAt(i, M);
    cm.setColorAt(i, c.set(colors[Math.floor(R() * colors.length)]));
    M.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(s * 0.6, h, s * 0.6)); tm.setMatrixAt(i, M);
  });
  cm.castShadow = true; cm.receiveShadow = true; tm.castShadow = true;
  g.add(cm, tm); return g;
}
