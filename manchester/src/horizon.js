// The wider world round the scheme: imagery out to the horizon on real terrain, Greater Manchester's buildings,
// and a cloud deck. Everything is baked into data/ by tools/fetch_ortho.py, fetch_terrain.py.
//   mid ground   data/ortho_mid.jpg   Esri World Imagery z15, 12 km square, flat
//   far terrain  data/ortho_far.jpg   Esri World Imagery z12, 80 km square, on data/terrain.png (AWS Terrain Tiles)
//   (the city's buildings are src/city.js, the GeoHUB flight sim's pipeline)
import * as THREE from 'three';

export const HORIZON = {
  mid: { url: 'data/ortho_mid.jpg', b: [-6000, 6000, -6000, 6000] },
  far: { url: 'data/ortho_far.jpg', b: [-40000, 40000, -40000, 40000] },
  inner: [-1800, 1000, -1400, 1400],     // the detailed context's wide ortho: the mid ground stops here
  terrainN: 321, terrainR: 40000,
  cloudY: 2600,
};
export const BOUNDS = { x: [-5200, 4200], z: [-5000, 4400], maxY: 1900 };   // where the camera may go

export async function loadHorizon(base = './') {
  const L = new THREE.TextureLoader();
  const tex = async (u) => { const t = await L.loadAsync(base + u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const [mid, far, dem] = await Promise.all([tex(HORIZON.mid.url), tex(HORIZON.far.url), pngBytes(base + 'data/terrain.png')]);
  return { mid, far, dem: new Int16Array(dem) };
}

// binary payloads travel as lossless RGB PNGs (tools/bin2png.py): uint32 length, then 3 bytes a pixel
async function pngBytes(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < px.length; i += 4) { out[j++] = px[i]; out[j++] = px[i + 1]; out[j++] = px[i + 2]; }
  const n = out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24);
  return out.slice(4, 4 + n).buffer;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildHorizon(h) {
  const g = new THREE.Group(); g.name = 'horizon';
  const tint = new THREE.Color().setRGB(1.25, 1.22, 1.18);

  // mid ground: a 12 km square of imagery with the detailed context cut out of it
  {
    const [x0, x1, z0, z1] = HORIZON.mid.b, [i0, i1, j0, j1] = HORIZON.inner;
    const s = new THREE.Shape([new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)]);
    s.holes.push(new THREE.Path([new THREE.Vector2(i0, j0), new THREE.Vector2(i0, j1), new THREE.Vector2(i1, j1), new THREE.Vector2(i1, j0)]));
    const geo = new THREE.ShapeGeometry(s); const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getY(i); p.setXYZ(i, x, -0.14, z); uv.setXY(i, (x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)); }
    geo.computeVertexNormals(); if (geo.attributes.normal.getY(0) < 0) { geo.index.array.reverse(); geo.computeVertexNormals(); }
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: h.mid, color: tint })); m.receiveShadow = true; m.name = 'ground_mid'; g.add(m);
  }

  // far terrain: 80 km of imagery draped on the real relief, flat (and hidden) under the mid ground, falling away with
  // the Earth's curvature so the hills sit on a true horizon
  {
    const N = HORIZON.terrainN, R = HORIZON.terrainR, Re = 6371000;
    const geo = new THREE.PlaneGeometry(2 * R, 2 * R, N - 1, N - 1); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), col = Math.round((x + R) / (2 * R) * (N - 1)), row = Math.round((z + R) / (2 * R) * (N - 1));
      const cheb = Math.max(Math.abs(x), Math.abs(z)), r = Math.hypot(x, z);
      const e = h.dem[row * N + col] * smooth(6300, 13000, cheb);
      p.setY(i, -1.2 + e - Math.max(0, r - 6000) ** 2 / (2 * Re));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: h.far, color: tint })); m.name = 'terrain'; m.userData.noShadow = true; g.add(m);
  }

  g.add(buildClouds());
  g.userData.labels = [
    { cat: 'city', name: 'Manchester city centre', x: 2950, z: -1650, y: 160, major: true, desc: 'Deansgate Square, Beetham Tower and the city centre, 3.4 km north-east of Old Trafford.' },
    { cat: 'city', name: 'MediaCityUK & Salford Quays', x: -900, z: -1950, y: 70, desc: 'The BBC and ITV studios, the Lowry and Imperial War Museum North round the old Manchester Docks.' },
    { cat: 'city', name: 'Etihad Stadium', x: 5980, z: -2210, y: 50, desc: 'Manchester City, 6 km across the city.' },
    { cat: 'city', name: 'The Pennines', x: 26000, z: -6000, y: 420, desc: 'The moors east of Manchester, rising to around 500 m on the horizon.' },
  ];
  return g;
}

// one drifting cloud deck: fbm noise, lit by the sun, thinning toward the horizon
function buildClouds() {
  const S = 90000, geo = new THREE.PlaneGeometry(S, S, 1, 1); geo.rotateX(Math.PI / 2);   // faces down
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(0xffffff) }, uShade: { value: new THREE.Color(0xb9c2cc) }, uCover: { value: 0.52 }, uAlpha: { value: 0.9 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uCover, uAlpha; uniform vec3 uSun, uLit, uShade; varying vec3 vW;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz / 5200.0 + vec2(uTime * 0.004, uTime * 0.0015);
        float d = fbm(p), dl = fbm(p + uSun.xz * 0.06);
        float c = smoothstep(uCover, uCover + 0.22, d);
        float r = length(vW.xz - cameraPosition.xz);
        c *= 1.0 - smoothstep(18000.0, 44000.0, r);
        if (c < 0.01) discard;
        float lit = clamp(0.55 + (d - dl) * 3.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(uShade, uLit, lit), c * uAlpha);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(geo, mat); m.position.y = HORIZON.cloudY; m.name = 'clouds'; m.userData.noShadow = true; m.frustumCulled = false; m.renderOrder = 2;
  const t0 = performance.now(); m.onBeforeRender = () => { mat.uniforms.uTime.value = (performance.now() - t0) / 1000; };
  return m;
}

// keep a camera (and an orbit target) inside the mapped world
export function clampToWorld(pos, target) {
  const B = BOUNDS;
  for (const v of [pos, target].filter(Boolean)) { v.x = THREE.MathUtils.clamp(v.x, B.x[0], B.x[1]); v.z = THREE.MathUtils.clamp(v.z, B.z[0], B.z[1]); }
  pos.y = THREE.MathUtils.clamp(pos.y, 1.5, B.maxY);
  if (target) target.y = THREE.MathUtils.clamp(target.y, 0, 400);
}
