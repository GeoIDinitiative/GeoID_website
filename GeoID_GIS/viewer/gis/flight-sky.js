// Earth Flight's sky: daylight, dusk and night over the aircraft, from the
// real sun.
//
// The globe viewer looks at Earth from space, so its backdrop is black with
// stars -- and Earth Flight, which flies inside that viewer, inherited it: at
// 16:39 in Northern Ireland on a late-October afternoon, with the sun eight
// degrees up, the sky over the aircraft was night (reported). This draws a
// sky dome round the camera while flying, and only while flying:
//
//   * a blue zenith shading to a pale horizon, from the sun's elevation at
//     the aircraft (the viewer's solar model, GeoIDViewer.getSunDirection);
//   * a warm glow round the sun, and an orange horizon under a low sun;
//   * civil twilight to night as the sun goes below the horizon;
//   * thinning to black space between 15 and 80 km up;
//   * and the stars fade out in daylight and back in at dusk or in space.
//
// The dome is drawn FIRST (render order far below everything) and writes no
// depth, so the globe, the buildings, the aircraft and every layer draw over
// it exactly as they did over the black.

let THREE = null;
let dome = null;
let stars = null;
let hooked = null;
const RADIUS = 100;          // scene units: inside the far plane, outside the globe
const KM_PER_UNIT = 6371 / 3.2;

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uSun;     // world
uniform vec3 uUp;      // world, at the camera
uniform float uSpace;  // 0 in the air, 1 in space
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = dot(d, uUp);                       // view elevation
  float h = dot(uSun, uUp);                    // sun elevation
  float day = smoothstep(-0.10, 0.10, h);      // night .. day, through twilight
  float low = 1.0 - smoothstep(0.02, 0.30, h); // how near the horizon the sun is

  vec3 zenith = vec3(0.16, 0.36, 0.74);
  vec3 horizon = vec3(0.66, 0.79, 0.93);
  vec3 sky = mix(horizon, zenith, pow(clamp(e, 0.0, 1.0), 0.45));
  if (e < 0.0) sky = horizon * (1.0 + 0.6 * e); // below the horizon line: haze

  // The horizon warms under a low sun, most towards the sun's own azimuth.
  vec3 dH = normalize(d - uUp * e);
  vec3 sH = normalize(uSun - uUp * h + 1e-5);
  float toward = pow(max(dot(dH, sH), 0.0), 2.0);
  float band = 1.0 - smoothstep(0.0, 0.35, abs(e));
  sky = mix(sky, vec3(1.0, 0.56, 0.30), low * toward * band * 0.75);

  // Sun glow: a broad halo and a tight core.
  float c = max(dot(d, uSun), 0.0);
  sky += vec3(1.0, 0.86, 0.64) * (0.22 * pow(c, 6.0) + 0.9 * pow(c, 300.0)) * (0.4 + 0.6 * day);

  // Night: a deep blue-black, with the last light on the sun's side at dusk.
  vec3 night = vec3(0.012, 0.018, 0.035) + vec3(0.10, 0.06, 0.05) * toward * band * smoothstep(-0.22, -0.02, h);
  sky = mix(night, sky, day);

  // Thinning into space with altitude.
  sky = mix(sky, vec3(0.0), uSpace);
  gl_FragColor = vec4(sky, 1.0);
}`;

function build() {
  const geo = new THREE.SphereGeometry(RADIUS, 48, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uSpace: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = "GeoID-FlightSky";
  m.renderOrder = -1e6;
  m.frustumCulled = false;
  m.raycast = () => {};
  m.userData.nonInteractive = true;
  m.userData.keepRenderOrder = true;
  return m;
}

const _centre = () => new THREE.Vector3();

function step() {
  const viewer = window.GeoIDViewer;
  if (!dome || !viewer?.camera) return;
  const cam = viewer.camera;
  dome.position.copy(cam.position);
  const centre = viewer.globe ? viewer.globe.getWorldPosition(_centre()) : _centre();
  const up = cam.position.clone().sub(centre);
  const altKm = (up.length() - (viewer.GLOBE_RADIUS || 3.2)) * KM_PER_UNIT;
  dome.material.uniforms.uUp.value.copy(up.normalize());
  const sun = viewer.getSunDirection?.();
  if (sun) dome.material.uniforms.uSun.value.copy(sun).normalize();
  const space = Math.min(1, Math.max(0, (altKm - 15) / 65));
  dome.material.uniforms.uSpace.value = space * space * (3 - 2 * space);
  // Stars: gone in daylight, back at dusk and in space.
  if (stars) {
    const h = dome.material.uniforms.uSun.value.dot(dome.material.uniforms.uUp.value);
    const day = Math.min(1, Math.max(0, (h + 0.10) / 0.20));
    stars.material.opacity = Math.max(dome.material.uniforms.uSpace.value, 1 - day);
    stars.visible = stars.material.opacity > 0.02;
  }
}

/** Show the flight sky (idempotent). */
export async function showFlightSky() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene) return;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  if (!dome) dome = build();
  if (!dome.parent) viewer.scene.add(dome);
  if (!stars) viewer.scene.traverse((o) => { if (o.name === "GeoID-Starfield") stars = o; });
  if (hooked !== viewer.scene) {
    hooked = viewer.scene;
    const previous = typeof viewer.scene.onBeforeRender === "function" ? viewer.scene.onBeforeRender.bind(viewer.scene) : null;
    viewer.scene.onBeforeRender = function flightSky(...args) {
      if (previous) previous(...args);
      if (dome?.parent) step();
    };
  }
  step();
}

/** Back to the viewer's own space backdrop. */
export function hideFlightSky() {
  dome?.parent?.remove(dome);
  if (stars) { stars.material.opacity = 1; stars.visible = true; }
}
