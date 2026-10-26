// Earth Flight's clouds: one high, low-resolution deck from the day's weather.
//
// Owner, 2026-10-24: "low resolution clouds at high altitude, informed by
// daily weather (aesthetic only)". So:
//
//   * WHERE the cloud is comes from yesterday's satellite cloud fraction --
//     NASA GIBS `MODIS_Terra_Cloud_Fraction_Day` (MODIS L2 cloud fraction,
//     daily, EPSG:3857, PNG to z6), with Aqua's afternoon pass filling Terra's
//     gaps between swaths. Yesterday because today's day is still being
//     swept. The tiles are a palette (one colour per per cent); CF_RGB is
//     GIBS's own colour map (colormaps/v1.3/MODIS_Cloud_Fraction.xml),
//     decoded back to a fraction here.
//   * It is read at z5, ~5 km a pixel, 4 x 4 tiles round the aircraft: low
//     resolution on purpose. The shader breaks the blocky fraction up with
//     drifting procedural noise, so it reads as cloud, not pixels; where the
//     satellite saw clear sky, there is none.
//   * ONE deck at CLOUD_M, depth-tested (a hill or a building in front hides
//     it), drawn after the ground and buildings and before the aircraft,
//     fading out at the patch's edges. Lit by the sun over it: white by day,
//     warm at a low sun, a faint grey-blue at night.
//
// Aesthetic only: no flight model reads it. Flight only.

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png";
const LAYERS = ["MODIS_Terra_Cloud_Fraction_Day", "MODIS_Aqua_Cloud_Fraction_Day"];
const Z = 5;
const SPAN = 4;                    // tiles across the patch
export const CLOUD_M = 8000;
const UNITS_PER_M = 3.2 / 6371000;
const SEG = 72;

// GIBS's colour map for MODIS cloud fraction: index = per cent.
const CF_RGB = [0x660077, 0x660177, 0x660277, 0x660377, 0x660477, 0x660577, 0xb70f8d, 0xb7108d, 0xb7118d, 0xb7128d, 0xb7138d, 0xb7148d, 0x000064, 0x000164, 0x000264, 0x000364, 0x000464, 0x000564, 0x000664, 0x0000aa, 0x0001aa, 0x0002aa, 0x0003aa, 0x0004aa, 0x0005aa, 0x0000ff, 0x0001ff, 0x0002ff, 0x0003ff, 0x0004ff, 0x0005ff, 0x0088ee, 0x0188ee, 0x0288ee, 0x0388ee, 0x0488ee, 0x0588ee, 0x0688ee, 0x005000, 0x015000, 0x025000, 0x035000, 0x045000, 0x055000, 0x008800, 0x018800, 0x028800, 0x038800, 0x048800, 0x058800, 0x00dc00, 0x01dc00, 0x02dc00, 0x03dc00, 0x04dc00, 0x05dc00, 0x06dc00, 0xffff00, 0xffff01, 0xffff02, 0xffff03, 0xffff04, 0xffff05, 0xf0be40, 0xf0be41, 0xf0be42, 0xf0be43, 0xf0be44, 0xf0be45, 0xbb8800, 0xbb8801, 0xbb8802, 0xbb8803, 0xbb8804, 0xbb8805, 0xbb8806, 0x7a5a03, 0x7a5a04, 0x7a5a05, 0x7a5a06, 0x7a5a07, 0x7a5a08, 0x6e0000, 0x6e0001, 0x6e0002, 0x6e0003, 0x6e0004, 0x6e0005, 0xaa0000, 0xaa0001, 0xaa0002, 0xaa0003, 0xaa0004, 0xaa0005, 0xaa0006, 0xff0000, 0xff0001, 0xff0002, 0xff0003, 0xff0004, 0xff0005];
const CF = new Map(CF_RGB.map((rgb, pc) => [rgb, pc]));

/** Cloud fraction 0..1 from a GIBS pixel, or null where the satellite has no data. */
export function fractionOf(r, g, b, a) {
  if (a < 128) return null;
  const pc = CF.get((r << 16) | (g << 8) | b);
  return pc === undefined ? null : pc / 100;
}

/** Yesterday, UTC, as GIBS wants it. */
export function cloudDate(nowMs = Date.now()) {
  return new Date(nowMs - 86400000).toISOString().slice(0, 10);
}

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const xToLon = (x, z) => (x / 2 ** z) * 360 - 180;
const yToLat = (y, z) => Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z)) * 180 / Math.PI;

/* ── Browser ────────────────────────────────────────────────────────────── */

let THREE = null;
let mesh = null, timer = null, running = false, building = false;
let patch = null;                  // { x0, y0, key }
let anyCloud = false;
const U = {
  uCloud: { value: null }, uSun: { value: { x: 1, y: 0, z: 0 } }, uTime: { value: 0 },   // never a null vec3 (osm-buildings.js FADE)
};

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The patch's fraction as a texture: R = cloud fraction, 0 where clear or unknown. */
async function fractionTexture(x0, y0, date) {
  const n = 2 ** Z, px = 256 * SPAN;
  const out = document.createElement("canvas");
  out.width = out.height = px;
  const octx = out.getContext("2d");
  const img = octx.createImageData(px, px);
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = 256;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const jobs = [];
  for (let j = 0; j < SPAN; j++) for (let i = 0; i < SPAN; i++) {
    const tx = ((x0 + i) % n + n) % n, ty = y0 + j;
    if (ty < 0 || ty >= n) continue;
    jobs.push(Promise.all(LAYERS.map((layer) => loadImage(GIBS.replace("{layer}", layer).replace("{date}", date)
      .replace("{z}", Z).replace("{y}", ty).replace("{x}", tx)))).then((imgs) => {
      const reads = imgs.map((im) => {
        if (!im) return null;
        sctx.clearRect(0, 0, 256, 256);
        sctx.drawImage(im, 0, 0);
        return sctx.getImageData(0, 0, 256, 256).data;
      });
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const k = (y * 256 + x) * 4;
        let f = null;
        for (const d of reads) {           // Terra first, Aqua where Terra has no data
          if (!d || f !== null) continue;
          f = fractionOf(d[k], d[k + 1], d[k + 2], d[k + 3]);
        }
        const o = ((j * 256 + y) * px + i * 256 + x) * 4;
        const v = Math.round((f ?? 0) * 255);
        if (v > 25) anyCloud = true;
        img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
      }
    }));
  }
  await Promise.all(jobs);
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const VERT = /* glsl */`
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FRAG = /* glsl */`
  uniform sampler2D uCloud;
  uniform vec3 uSun;          // x: sine of the sun's elevation over the patch
  uniform float uTime;
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
  void main() {
    #include <logdepthbuf_fragment>
    float frac = texture2D(uCloud, vUv).r;
    // ~5 km satellite pixels broken up into cloud: the fraction sets how much
    // of the noise field clears the threshold, and the field drifts slowly.
    vec2 p = vUv * 220.0 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(p) * 0.75 + fbm(p * 3.1 + 7.0) * 0.25;
    float cover = smoothstep(1.0 - frac, 1.0 - frac + 0.22, n) * smoothstep(0.03, 0.2, frac);
    // Even a 100 % cell is not a sheet: its thickness varies with a second,
    // larger field, so overcast has texture and thin places, never a filter.
    float thick = mix(0.45, 1.0, smoothstep(0.25, 0.75, fbm(vUv * 60.0 + 3.7 + uTime * 0.001)));
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
    float s = uSun.x;
    float day = smoothstep(-0.10, 0.12, s);
    // At night cloud is barely seen from above: thin and dark, so the ground
    // and its lights still read through it.
    float a = cover * thick * edge * mix(0.30, 0.85, day);
    if (a < 0.01) discard;
    float low = 1.0 - smoothstep(0.0, 0.30, abs(s));            // the sun near the horizon
    vec3 lit = mix(vec3(0.95, 0.96, 0.98), vec3(1.0, 0.72, 0.52), low * 0.7);
    vec3 night = vec3(0.035, 0.04, 0.055);
    // Billows: lighter tops and darker hollows from the noise itself.
    vec3 col = mix(night, lit, day) * (0.78 + 0.32 * n) * (1.0 - 0.15 * smoothstep(0.5, 1.0, cover * thick));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

function buildMesh(viewer, x0, y0, tex) {
  const zx0 = x0, zy0 = y0, zx1 = x0 + SPAN, zy1 = y0 + SPAN;
  const r = 3.2 + CLOUD_M * UNITS_PER_M;
  const centre = (() => {
    const p = viewer.surfacePoint(yToLat((zy0 + zy1) / 2, Z), xToLon((zx0 + zx1) / 2, Z), 0);
    return new THREE.Vector3(-p.x, p.y, -p.z).setLength(r);
  })();
  const pos = new Float32Array((SEG + 1) * (SEG + 1) * 3), uv = new Float32Array((SEG + 1) * (SEG + 1) * 2);
  for (let j = 0; j <= SEG; j++) {
    const lat = yToLat(zy0 + (zy1 - zy0) * j / SEG, Z);
    for (let i = 0; i <= SEG; i++) {
      const lon = xToLon(zx0 + (zx1 - zx0) * i / SEG, Z);
      const p = viewer.surfacePoint(lat, lon, 0);
      const v = new THREE.Vector3(-p.x, p.y, -p.z).setLength(r).sub(centre);
      const k = j * (SEG + 1) + i;
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
      uv[k * 2] = i / SEG; uv[k * 2 + 1] = 1 - j / SEG;
    }
  }
  const idx = [];
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  U.uCloud.value?.dispose();
  U.uCloud.value = tex;
  if (!mesh) {
    mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.name = "GeoID-FlightClouds";
    // After the ground (40.x) and the buildings (190), before the aircraft (400).
    mesh.renderOrder = 300;
    mesh.userData.keepRenderOrder = true;
    mesh.userData.nonInteractive = true;
    mesh.raycast = () => {};
  } else {
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }
  mesh.position.copy(centre);
  if (mesh.parent !== viewer.globe) viewer.globe.add(mesh);
}

async function tick() {
  const viewer = window.GeoIDViewer, f = window.__flightSim;
  if (!running || !viewer?.globe || !f?.active || !f.shipLatLon) return;
  U.uTime.value = performance.now() / 1000;
  // The sun over the patch.
  const sunW = viewer.getSunDirection?.();
  if (sunW && mesh) {
    const sunL = sunW.clone().normalize().transformDirection(new THREE.Matrix4().copy(viewer.globe.matrixWorld).invert());
    if (!U.uSun.value?.isVector3) U.uSun.value = new THREE.Vector3();
    U.uSun.value.set(mesh.position.clone().normalize().dot(sunL), 0, 0);
  }
  // A new patch once the aircraft leaves the middle two tiles of this one.
  const cx = lonToX(f.shipLatLon.lon, Z), cy = latToY(f.shipLatLon.lat, Z);
  const inside = patch && cx > patch.x0 + 1 && cx < patch.x0 + SPAN - 1 && cy > patch.y0 + 1 && cy < patch.y0 + SPAN - 1;
  if (inside || building) return;
  building = true;
  const x0 = Math.floor(cx) - SPAN / 2, y0 = Math.floor(cy) - SPAN / 2;
  try {
    const tex = await fractionTexture(x0, y0, cloudDate());
    if (running) { buildMesh(viewer, x0, y0, tex); patch = { x0, y0 }; } else tex.dispose();
  } finally { building = false; }
}

let anim = null;
function frame() {
  anim = requestAnimationFrame(frame);
  U.uTime.value = performance.now() / 1000;
}

/** Start the cloud deck (idempotent). */
export async function startFlightClouds() {
  if (running) return;
  running = true;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  if (!running) return;
  U.uSun.value = new THREE.Vector3(1, 0, 0);
  tick();
  timer = setInterval(tick, 1000);
  anim = requestAnimationFrame(frame);
}

/** Stop and free it. */
export function stopFlightClouds() {
  running = false;
  clearInterval(timer); timer = null;
  if (anim) cancelAnimationFrame(anim); anim = null;
  if (mesh) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  U.uCloud.value?.dispose(); U.uCloud.value = null;
  patch = null; anyCloud = false;
}

/** For the Metadata window while flying. */
export function creditNow() {
  if (!running || !mesh) return null;
  return {
    title: "Earth Flight clouds",
    source: `NASA GIBS MODIS_Terra_Cloud_Fraction_Day (Aqua filling gaps), ${cloudDate()}, z5 (~5 km), one deck at ${CLOUD_M / 1000} km, broken up procedurally`,
    citation: "Cloud fraction: NASA MODIS (Terra and Aqua) Level 2 cloud product, via NASA EOSDIS GIBS (Global Imagery Browse Services), public domain. The deck's shape within each ~5 km cell is procedural (aesthetic only).",
    crs: "EPSG:3857 tiles, drawn on the globe",
    licence: "Public domain (NASA)",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDFlightClouds = { active: () => running, startFlightClouds, stopFlightClouds, creditNow, hasCloud: () => anyCloud };
}
