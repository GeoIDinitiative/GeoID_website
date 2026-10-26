// Greater Manchester as the GeoHUB flight sim draws it. The flight sim's own modules are in src/geohub/,
// copied from GeoID_webpage_v1/flight_sim/earth/game unchanged: mvt.js (vector-tile decoder), extrude.js
// (footprints -> walls and roofs, inferred pitched roofs, stadium stands, churches, monuments), structures.js
// (bridges), facade.js (the wall and roof shaders) and lamps.js (street lamps). This file does what GeoHUB's
// osm-buildings.js, night-lights.js and flight-lights.js do on the globe, in the model's flat local frame:
//   buildings  one mesh per z14 tile, roofs first and walls second; walls Lambert + facade(), roofs Lambert +
//              roof() on the imagery under them (here the model's own orthos, sharpest available per roof)
//   night      the ground darkens to ~12 % and NASA Black Marble radiance is laid over it (night-lights.js);
//              about half the windows light (facade uNight); lamps stand along every OSM road, lit or dark
//              by the Black Marble radiance where they stand, each with a pool of light on the road
//              (lamps.js + flight-lights.js)
// Data: data/osm_tiles.png (tools/pack_osm_tiles.py) and data/blackmarble.png (tools/fetch_blackmarble.py).
import * as THREE from 'three';
import { decodeLayer, rings, polygons } from './geohub/mvt.js?v=1';
import { extrudeTile } from './geohub/extrude.js?v=9';
import { facade, roof } from './geohub/facade.js';
import { placeLamps, litPower, radianceAboveBackground, CLASS_BY_CODE } from './geohub/lamps.js?v=2';
import { pointInPoly } from './context.js';

const LAT0 = 53.463070, LON0 = -2.291349, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KZ = 110540, Z = 14;
const xToLon = (x) => (x / 2 ** Z) * 360 - 180, yToLat = (y) => Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** Z)) * 180 / Math.PI;
const local = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KZ];
export const NIGHT = { value: 0 };     // 0 day .. 1 night: windows, lamps and the night ground all read it
const BM = { b: [-40000, 40000, -40000, 40000] };
const LED = [1.0, 0.9, 0.78], SODIUM = [1.0, 0.56, 0.2];

async function pngBytes(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < px.length; i += 4) { out[j++] = px[i]; out[j++] = px[i + 1]; out[j++] = px[i + 2]; }
  const n = out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24);
  return out.slice(4, 4 + n);
}
async function imagePixels(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data, canvas: c };
}

export async function loadCity(base = './') {
  const [bytes, bm] = await Promise.all([pngBytes(base + 'data/osm_tiles.png'), imagePixels(base + 'data/blackmarble.png')]);
  const dv = new DataView(bytes.buffer), tiles = []; let o = 4;
  for (let i = 0, n = dv.getUint32(0, true); i < n; i++) {
    const x = dv.getUint16(o, true) + 8000, y = dv.getUint16(o + 2, true) + 5000, len = dv.getUint32(o + 4, true); o += 8;
    tiles.push({ x, y, buf: bytes.subarray(o, o + len) }); o += len;
  }
  const bmTex = new THREE.CanvasTexture(bm.canvas); bmTex.colorSpace = THREE.SRGBColorSpace;
  return { tiles, bm, bmTex };
}

// three's earcut wrapper wants Vector2s (it calls .equals on them), as buildings-worker.js
const v2 = (pts) => pts.map((p) => new THREE.Vector2(p.x, p.y));
const triangulate = (c, h) => THREE.ShapeUtils.triangulateShape(v2(c), h.map(v2));

// Black Marble radiance above its background (lamps.js) at a local point
function radianceAt(bm, x, z) {
  const [x0, x1, z0, z1] = BM.b, i = Math.floor((x - x0) / (x1 - x0) * bm.w), j = Math.floor((z - z0) / (z1 - z0) * bm.h);
  if (i < 0 || j < 0 || i >= bm.w || j >= bm.h) return null;
  const k = (j * bm.w + i) * 4; return radianceAboveBackground(bm.d[k], bm.d[k + 1], bm.d[k + 2]);
}
function lampColour(code, hash, power) {   // flight-lights' lights-worker.js
  const c = hash < (code <= 2 ? 0.8 : 0.6) ? LED : SODIUM, k = power * (code <= 1 ? 1.15 : code >= 5 ? 0.85 : 1.0);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * Build the city. `ortho` is { core, wide, mid } -> { tex, b }; `skip(p)` drops a building whose footprint centre
 * is at p (Old Trafford, which the model draws itself); `dev(p)` marks the land the scheme redevelops: buildings
 * there go in a separate mesh, shown only with the site as it is today, and lamps there are left to the scheme.
 */
export async function buildCity(city, { ortho, skip = () => false, skipAny = null, dev = () => false, onProgress } = {}) {
  const g = new THREE.Group(); g.name = 'city';
  const keepG = new THREE.Group(); keepG.name = 'cityKeep'; const devG = new THREE.Group(); devG.name = 'cityDev'; devG.visible = false;
  g.add(keepG, devG); g.userData.dev = devG;
  const night = NIGHT;
  const wallMat = facade(new THREE.MeshLambertMaterial({ vertexColors: true })); wallMat.userData.night = night;
  const order = ['core', 'wide', 'mid'].filter((k) => ortho[k]);
  const roofMats = order.map((k) => roof(new THREE.MeshLambertMaterial({ map: ortho[k].tex })));
  const inB = (x, z, b) => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
  const lampPos = [], lampCol = [], poolM = [];
  let n = 0;
  for (const t of city.tiles) {
    const lat0 = yToLat(t.y), lat1 = yToLat(t.y + 1), lon0 = xToLon(t.x), lon1 = xToLon(t.x + 1);
    const latM = (lat0 + lat1) / 2, sizeM = (2 * Math.PI * 6378137 / 2 ** Z) * Math.cos(latM * Math.PI / 180);
    const [X0, Z0] = local(lat0, lon0), [X1, Z1] = local(lat1, lon1), kx = (X1 - X0) / sizeM, kz = (Z1 - Z0) / sizeM;
    const layer = decodeLayer(t.buf, 'building') || { extent: 4096, features: [] }, ext = layer.extent || 4096;
    const toL = (u, v) => [X0 + (u / ext) * (X1 - X0), Z0 + (v / ext) * (Z1 - Z0)];
    const keepF = [], devF = [];
    for (const f of layer.features) {
      if (f.type !== 3) continue;
      const r = rings(f.geometry)[0]; if (!r || r.length < 3) continue;
      let cu = 0, cv = 0; for (const [u, v] of r) { cu += u; cv += v; } const c = toL(cu / r.length, cv / r.length);
      if (skip(c) || (skipAny && r.some(([u, v]) => skipAny(toL(u, v))))) continue;   // any corner inside: a stand whose centre is just outside
      (dev(c) || r.some(([u, v]) => dev(toL(u, v))) ? devF : keepF).push(f);   // any corner on the redeveloped land: it goes
    }
    const extra = { transport: decodeLayer(t.buf, 'transportation'), water: decodeLayer(t.buf, 'water'), landcover: decodeLayer(t.buf, 'landcover'),
      landuse: decodeLayer(t.buf, 'landuse'), poi: decodeLayer(t.buf, 'poi'), origin: [t.x, t.y] };
    for (const [feats, parent, ex] of [[keepF, keepG, extra], [devF, devG, { origin: [t.x, t.y] }]]) {
      if (!feats.length && parent === devG) continue;
      const m = extrudeTile({ ...layer, features: feats }, null, 0, sizeM, triangulate, ex);
      if (!m.index.length) continue;
      parent.add(tileMesh(m, { X0, Z0, kx, kz, ortho, order, inB, roofMats, wallMat, cut: parent === keepG ? (p) => skipAny?.(p) || dev(p) : skipAny }));
    }
    // street lamps along the tile's roads (lights-worker.js decode + stand)
    if (extra.transport) {
      const lines = [];
      for (const f of extra.transport.features) {
        if (f.type !== 2 || f.props.brunnel === 'tunnel') continue;
        const cls = String(f.props.class || '').replace(/_construction$/, '');
        for (const pts of rings(f.geometry)) lines.push({ cls, pts });
      }
      const L = placeLamps(lines, extra.transport.extent || 4096, sizeM);
      for (let i = 0; i < L.length; i += 4) {
        const [x, z] = [X0 + L[i] * (X1 - X0), Z0 + L[i + 1] * (Z1 - Z0)], code = L[i + 2], hash = L[i + 3];
        if (dev([x, z]) || skip([x, z])) continue;
        const rad = radianceAt(city.bm, x, z), power = rad == null ? 0 : litPower(code, rad); if (power <= 0) continue;
        lampPos.push(x, 9, z); const c = lampColour(code, hash, power); lampCol.push(...c);
        const d = CLASS_BY_CODE[code].offset * 1.5 + 9; poolM.push(x, z, d);
      }
    }
    if (++n % 6 === 0) { onProgress?.(n / city.tiles.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  g.add(lamps(lampPos, lampCol), pools(poolM, lampCol));
  g.userData.lampCount = lampPos.length / 3;
  return g;
}

// one tile: osm-buildings.js build(), with the roofs regrouped by which ortho covers them
function tileMesh(m, { X0, Z0, kx, kz, ortho, order, inB, roofMats, wallMat, cut }) {
  const P = m.position, uv = new Float32Array(m.uv), idx = m.index, rc = m.roofCount;
  const W = (i) => [X0 + P[i * 3] * kx, Z0 + P[i * 3 + 2] * kz];
  const buckets = order.map(() => []);
  const gone = (a, b, c) => { if (!cut) return false; const [ax, az] = W(a), [bx, bz] = W(b), [cx, cz] = W(c); return cut([(ax + bx + cx) / 3, (az + bz + cz) / 3]); };
  for (let t = 0; t < rc; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2], [ax, az] = W(a), [bx, bz] = W(b), [cx, cz] = W(c);
    if (gone(a, b, c)) continue;
    let k = order.findIndex((o) => inB(ax, az, ortho[o].b) && inB(bx, bz, ortho[o].b) && inB(cx, cz, ortho[o].b));
    if (k < 0) k = order.length - 1;
    buckets[k].push(a, b, c);
    const ob = ortho[order[k]].b;
    for (const v of [a, b, c]) { const [x, z] = W(v); uv[v * 2] = (x - ob[0]) / (ob[1] - ob[0]); uv[v * 2 + 1] = 1 - (z - ob[2]) / (ob[3] - ob[2]); }
  }
  const walls = []; for (let t = rc; t < idx.length; t += 3) if (!gone(idx[t], idx[t + 1], idx[t + 2])) walls.push(idx[t], idx[t + 1], idx[t + 2]);
  const roofIdx = buckets.flat(), all = new Uint32Array(roofIdx.length + walls.length);
  all.set(roofIdx, 0); all.set(walls, roofIdx.length);
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(all, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3, true));
  geo.setAttribute('aStyle', new THREE.BufferAttribute(m.style, 1, true));
  let s = 0; buckets.forEach((bk, k) => { if (bk.length) geo.addGroup(s, bk.length, k); s += bk.length; });
  geo.addGroup(roofIdx.length, walls.length, order.length);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, [...roofMats, wallMat]);
  mesh.position.set(X0, 0.02, Z0); mesh.scale.set(kx, 1, kz);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'GeoID-OSMBuildings';
  return mesh;
}

// flight-lights.js: lamps as points sized by their real distance, and pools of light on the road
function lamps(pos, col) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uNight: NIGHT, uPxScale: { value: 800 } }, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uNight, uPxScale; attribute vec3 color; varying vec3 vCol; varying float vA, vCore;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        float dCam = max(-mv.z, 1.0);
        float px = 12.0 * uPxScale / dCam;                      // the lantern's ~12 m glow in pixels
        float size = clamp(px * 2.0, 2.0, 32.0); gl_PointSize = size; vCore = clamp(1.6 / size, 0.03, 0.6);
        float lowA = px >= 0.35 ? min(px, 1.0) : 0.35 * pow(px / 0.35, 1.5);
        vA = uNight * lowA; vCol = color;
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA, vCore;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
        if (r > 1.0 || vA < 0.0005) discard;
        float core = exp(-(r * r) / (vCore * vCore)), halo = exp(-r * r * 5.0) * 0.28 + (1.0 - r) * (1.0 - r) * 0.08;
        gl_FragColor = vec4(vCol * (core * 1.8 + halo) * vA, 1.0);
      }` });
  const pts = new THREE.Points(geo, mat); pts.name = 'cityLamps'; pts.frustumCulled = false; pts.userData.noShadow = true;
  pts.onBeforeRender = (r, s, cam) => { mat.uniforms.uPxScale.value = r.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov || 40) / 2); };
  return pts;
}
function pools(m, col) {
  const n = m.length / 3, geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uNight: NIGHT }, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -16,
    vertexShader: `uniform float uNight; varying vec2 vUv; varying vec3 vCol; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
        vec4 wp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vA = uNight * (1.0 - smoothstep(3000.0, 4500.0, distance(wp.xyz, cameraPosition))); vCol = instanceColor; }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vCol; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv * 2.0 - 1.0); if (r > 1.0 || vA < 0.003) discard;
        float f = pow(1.0 - r, 3.0) * 0.13 + exp(-r * r * 22.0) * 0.12;
        gl_FragColor = vec4(vCol * f * vA, 1.0);
      }` });
  const im = new THREE.InstancedMesh(geo, mat, n), M = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < n; i++) { const d = m[i * 3 + 2]; M.makeScale(d, 1, d).setPosition(m[i * 3], 0.15, m[i * 3 + 1]); im.setMatrixAt(i, M); im.setColorAt(i, c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2])); }
  im.name = 'cityPools'; im.frustumCulled = false; im.userData.noShadow = true; im.renderOrder = 1;
  return im;
}

/**
 * night-lights.js's night pass, on a ground material instead of a globe shell: in daylight nothing; at night the
 * ground goes to ~12 % and the Black Marble radiance is laid over it.
 */
export function nightGround(material, bmTex) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prev?.(shader);
    shader.uniforms.uNight = NIGHT; shader.uniforms.uLights = { value: bmTex }; shader.uniforms.uBM = { value: new THREE.Vector4(...BM.b) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNightXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vNightXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; uniform sampler2D uLights; uniform vec4 uBM; varying vec2 vNightXZ;')
      .replace('#include <fog_fragment>', `{
    vec2 q = vec2((vNightXZ.x - uBM.x) / (uBM.y - uBM.x), 1.0 - (vNightXZ.y - uBM.z) / (uBM.w - uBM.z));
    vec3 light = texture2D(uLights, q).rgb;
    // night-lights.js boosts radiance seen from orbit (light * 1.6); this close the whole conurbation saturated into one
    // flat wash, so here it is a dim sky-glow under the lamps (squared, at a fifth): the lamps and their pools draw the streets
    vec3 glow = light * light * 0.2 * vec3(1.0, 0.8, 0.55);
    // Added, not mixed over: the imagery stays visible under the night lighting (night-lights.js darkened the
    // globe's unlit drapes to 12 %; these grounds are lit by the scene, which already makes them dark)
    // and a moonlit floor under the imagery itself, so maps, roads and paving still read at night
    gl_FragColor.rgb += (diffuseColor.rgb * 0.16 + glow * 0.4) * uNight;
  }
  #include <fog_fragment>`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '|nightGround';
  return material;
}
