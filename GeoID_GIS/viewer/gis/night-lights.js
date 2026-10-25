// Night on the Earth globe: the ground darkens where the sun is down, and the
// cities light up -- NASA's VIIRS Black Marble, faded in through twilight.
//
// Asked for with Earth Flight (2026-10-24): the sun follows GeoHUB's model
// clock (LIVE, time-lapse or a picked date), and night should look like night
// from the cockpit. Two things stood in the way:
//
//   * the close-range imagery is UNLIT. The refine patch (basemap-drape.js)
//     and the building tiles' ground drapes are MeshBasic, so at 1 km up at
//     midnight the ground was as bright as noon. A night pass is needed OVER
//     the drapes, not a darker texture under them;
//   * there were no lights to see.
//
// So: one shell a hair above the globe, parented to it (it carries the spin
// and the half turn, and uses the globe's own 192-segment sphere so its UVs
// are the base texture's), drawn after the imagery drapes and before the
// buildings (renderOrder 43, depth test off). Per pixel it reads the sun from
// the globe's key light: in daylight it is fully transparent; through civil
// twilight it fades in; at night it darkens the ground to about 12 % and adds
// the Black Marble radiance on top. Close in, a sharper z7 patch of the same
// layer is laid round the camera so a city is streets of light, not a blur.
//
// Source: NASA GIBS WMTS, `VIIRS_Black_Marble` (2016 composite), EPSG:3857
// GoogleMapsCompatible_Level8, keyless, `Access-Control-Allow-Origin: *`
// (checked). Credited as a Workspace layer, like everything else on screen.

import { isEarth } from "./bodies.js?v=20261025-7084e6b";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
const GLOBAL_Z = 4;            // 16 x 16 tiles -> a 4096-px world, ~2.4 km/px at the equator
const LOCAL_Z = 7;             // the patch round a low camera: ~0.6-1.2 km/px
const LOCAL_SPAN = 4;          // 4 x 4 tiles
const LOCAL_BELOW_M = 400000;  // the patch exists below this camera height
const ORDER = 43;
const LAYER_NAME = "City lights at night (NASA Black Marble)";
const INFO = {
  source: "NASA GIBS WMTS: VIIRS_Black_Marble (2016 composite), EPSG:3857, z4 global and z7 round the camera",
  citation: "NASA Earth Observatory / NASA Goddard Space Flight Center: VIIRS Black Marble (Suomi NPP), 2016. Imagery via NASA EOSDIS GIBS (Global Imagery Browse Services), public domain.",
  crs: "EPSG:3857 tiles, reprojected onto the globe",
};

let THREE = null;
let shell = null, patch = null, keyLight = null;
const uniforms = {
  uSun: { value: null }, uLights: { value: null }, uPatch: { value: null },
  uPatchBox: { value: null }, uPatchOn: { value: 0 },
};
/** How dark it is where the camera is, 0 day .. 1 night -- read by osm-buildings.js. */
export const NIGHT = { value: 0 };

const VERT = /* glsl */`
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying vec3 vLocal;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    vLocal = position;
    vWorldNormal = normalize(mat3(modelMatrix) * position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FRAG = /* glsl */`
  uniform vec3 uSun;
  uniform sampler2D uLights;
  uniform sampler2D uPatch;
  uniform vec4 uPatchBox;      // lon0, lon1, mercY0, mercY1 (radians / Mercator units)
  uniform float uPatchOn;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying vec3 vLocal;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float s = dot(normalize(vWorldNormal), uSun);          // sine of the sun's elevation, roughly
    float night = smoothstep(0.10, -0.12, s);              // fades in from ~6 deg up to ~7 deg down
    if (night <= 0.001) discard;
    vec3 light = texture2D(uLights, vUv).rgb;
    if (uPatchOn > 0.5) {
      // The same frame latLonToVector3 answers in (the globe applies the half turn).
      vec3 p = normalize(vec3(-vLocal.x, vLocal.y, -vLocal.z));
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float lon = atan(p.z, -p.x);
      float my = log(tan(0.7853981634 + lat * 0.5));
      vec2 q = vec2((lon - uPatchBox.x) / (uPatchBox.y - uPatchBox.x), (my - uPatchBox.w) / (uPatchBox.z - uPatchBox.w));
      if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) light = texture2D(uPatch, q).rgb;
    }
    // Black Marble is radiance on black: boost it, and let the city cores burn.
    vec3 glow = min(vec3(1.0), light * 1.6) * vec3(1.0, 0.86, 0.62);
    // Normal blending: ground * (1 - a) + lights * a. The ground goes to ~12 %
    // at full night; the lights are what is left to see.
    gl_FragColor = vec4(glow, 0.88 * night);
    #include <colorspace_fragment>
  }
`;

/* ── Tiles ────────────────────────────────────────────────────────────── */

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
const tileUrl = (z, x, y) => GIBS.replace("{z}", z).replace("{x}", x).replace("{y}", y);

/** The whole world at GLOBAL_Z, reprojected Mercator -> equirectangular for the shell's UVs. */
async function globalTexture() {
  const n = 1 << GLOBAL_Z, px = 256 * n;
  const merc = document.createElement("canvas");
  merc.width = merc.height = px;
  const mctx = merc.getContext("2d");
  const jobs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    jobs.push(loadImage(tileUrl(GLOBAL_Z, x, y)).then((img) => img && mctx.drawImage(img, x * 256, y * 256)));
  for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16));
  const eq = document.createElement("canvas");
  eq.width = px; eq.height = px / 2;
  const ectx = eq.getContext("2d");
  // Row by row: equirectangular latitude -> Mercator source row.
  for (let row = 0; row < eq.height; row++) {
    const lat = (90 - (row + 0.5) * 180 / eq.height) * Math.PI / 180;
    if (Math.abs(lat) > 1.4844) continue;                     // past Mercator's 85.05 deg
    const my = Math.log(Math.tan(Math.PI / 4 + lat / 2));
    const src = (1 - my / Math.PI) / 2 * px;
    ectx.drawImage(merc, 0, Math.floor(src), px, 1, 0, row, px, 1);
  }
  const tex = new THREE.CanvasTexture(eq);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let patchKey = "";
async function updatePatch(lat, lon) {
  const n = 1 << LOCAL_Z;
  const cx = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180;
  const cy = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  const x0 = cx - LOCAL_SPAN / 2, y0 = cy - LOCAL_SPAN / 2;
  const key = `${x0}/${y0}`;
  if (key === patchKey) return;
  patchKey = key;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256 * LOCAL_SPAN;
  const ctx = canvas.getContext("2d");
  await Promise.all(Array.from({ length: LOCAL_SPAN * LOCAL_SPAN }, (_, k) => {
    const x = x0 + (k % LOCAL_SPAN), y = y0 + Math.floor(k / LOCAL_SPAN);
    return loadImage(tileUrl(LOCAL_Z, ((x % n) + n) % n, y)).then((img) => img && ctx.drawImage(img, (k % LOCAL_SPAN) * 256, Math.floor(k / LOCAL_SPAN) * 256));
  }));
  if (key !== patchKey) return;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  uniforms.uPatch.value?.dispose?.();
  uniforms.uPatch.value = tex;
  const lonOf = (x) => (x / n) * 2 * Math.PI - Math.PI;
  const myOf = (y) => Math.PI * (1 - 2 * y / n);
  // flipY: canvas row 0 (north) is texture v = 1.
  uniforms.uPatchBox.value = new THREE.Vector4(lonOf(x0), lonOf(x0 + LOCAL_SPAN), myOf(y0), myOf(y0 + LOCAL_SPAN));
  uniforms.uPatchOn.value = 1;
}

/* ── The loop ─────────────────────────────────────────────────────────── */

function findKeyLight(scene) {
  let best = null;
  scene.traverse((o) => { if (o.isDirectionalLight && o.name !== "GeoID-OSMBuildingsSun" && (!best || o.intensity > best.intensity)) best = o; });
  return best;
}

let loading = false, lastPatchCheck = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const viewer = window.GeoIDViewer;
  if (!viewer?.globe || !THREE) return;
  if (!keyLight || !keyLight.parent) keyLight = findKeyLight(viewer.scene);
  if (!keyLight) return;
  const sun = keyLight.position.clone().normalize();
  uniforms.uSun.value = sun;
  // Night where the camera is looking down: the shell's own test, at the camera.
  const up = viewer.camera.position.clone().normalize();
  NIGHT.value = Math.min(1, Math.max(0, (0.10 - up.dot(sun)) / 0.22));
  if (!shell) {
    if (loading) return;
    loading = true;
    globalTexture().then((tex) => {
      uniforms.uLights.value = tex;
      uniforms.uPatch.value = tex;
      uniforms.uPatchBox.value = new THREE.Vector4(0, 1, 1, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthTest: false, depthWrite: false,
      });
      shell = new THREE.Mesh(new THREE.SphereGeometry(3.2 * (1 + 2e-7), 192, 192), mat);
      shell.name = "GeoID-NightLights";
      shell.renderOrder = ORDER;
      shell.raycast = () => {};
      shell.userData.nonInteractive = true;
      // Its own Group so it sorts as one band (three compares groupOrder first).
      const g = new THREE.Group();
      g.renderOrder = ORDER;
      g.userData.keepRenderOrder = true;
      shell.userData.keepRenderOrder = true;
      g.add(shell);
      viewer.globe.add(g);
      const layer = window.GeoIDImportManager?.adoptLayer?.(LAYER_NAME, g, { ext: "wmts", role: "night", info: INFO });
      if (layer) layer.legendHidden = true;
    });
    return;
  }
  // The sharper patch, only when it is night where we are and we are low.
  if (now - lastPatchCheck > 1500) {
    lastPatchCheck = now;
    const alt = viewer.getZoomAltitudeMetres?.()?.metres ?? Infinity;
    if (NIGHT.value > 0.05 && alt < LOCAL_BELOW_M) {
      const c = viewer.getViewCentreLatLon?.();
      if (c) updatePatch(c.lat, ((c.lon + 540) % 360) - 180);
    } else {
      uniforms.uPatchOn.value = 0;
    }
  }
}

/**
 * PARKED BEHIND A FLAG for now (2026-10-24): on with `?nightlights=1` on the
 * viewer's address, or `localStorage["geoid-gis:night-lights"] = "1"`. Off,
 * nothing here runs and NIGHT stays 0, so the buildings are never dimmed.
 */
export function nightLightsWanted(search, stored) {
  try { if (new URLSearchParams(search || "").get("nightlights") === "1") return true; } catch (e) { /* no URL */ }
  return stored === "1";
}

async function boot() {
  if (typeof window === "undefined" || typeof document === "undefined" || !isEarth()) return;
  let stored = null;
  try { stored = localStorage.getItem("geoid-gis:night-lights"); } catch (e) { /* private mode */ }
  if (!nightLightsWanted(window.location.search, stored)) return;
  THREE = await import("../vendor/three.module.js");
  window.GeoIDNight = { NIGHT, uniforms };
  requestAnimationFrame(frame);
}
boot();
