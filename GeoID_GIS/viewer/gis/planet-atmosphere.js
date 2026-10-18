/**
 * SUNLIGHT AND AIR FOR EVERY OTHER WORLD.
 *
 * Earth's viewer builds its own (earth-viewer.js, "THE AIR, LIT BY THE SUN"):
 * a tight limb shell, a wide diffuse halo, a ground haze, and the day
 * hemisphere lifted so day and night read apart. The nine other worlds were
 * still a lit ball under an ambient wash. They share this module (boot.js runs
 * on all of them) and each viewer publishes the same seam -- scene, camera,
 * globe, GLOBE_RADIUS, getEffectiveRelief -- so the same treatment is attached
 * here once rather than ported into nine viewer copies.
 *
 * THE AIR IS COMPUTED, NOT PAINTED -- the same model as Earth's
 * (earth-viewer.js, "THE AIR, AS SCATTERED LIGHT"): one shell drawn from its
 * front faces, the line of sight's optical depth through an exponential
 * atmosphere (Chapman grazing depth off the limb, airmass over the disc),
 * scattering per channel, and sunlight filtered by its own path in. So every
 * edge dissolves into space over a few scale heights rather than ending at a
 * ring (reported of the painted shells: "needs to dissipate seamlessly into
 * space", "way more subtle and diffuse"). Per world:
 *   beta   which colours its air scatters most (its tint where thin);
 *   k      vertical optical depth at the ground (how much air);
 *   h      scale height as a fraction of R (how gradually it thins);
 *   gain   overall brightness.
 * Mercury and the Moon have no air: sunlight only. Venus is thick and pale
 * yellow; Mars thin and butterscotch; Jupiter and Saturn cream and gold;
 * Uranus cyan; Neptune blue; Pluto a faint blue haze.
 *
 * The SUN is the viewer's own key light (intensity 1.9 in every lineage), read
 * each frame, so the glow and the lift follow whatever drives that light. The
 * shells sit on the terrain at its current vertical exaggeration, and fade as
 * the camera comes down through them. Nothing here touches the night side's
 * mapping: the lift is zero where the sun is down.
 */

import * as THREE from "/GeoID_GIS/viewer/vendor/three.module.js";
import { currentBodyId } from "./bodies.js?v=20261018-fe9f231";

const PROFILES = {
  mercury: null,
  moon: null,
  venus: { beta: [0.95, 0.82, 0.52], k: 0.16, h: 0.045, gain: 0.7 },
  mars: { beta: [1.0, 0.68, 0.42], k: 0.05, h: 0.022, gain: 0.85 },
  jupiter: { beta: [0.9, 0.82, 0.66], k: 0.07, h: 0.03, gain: 0.7 },
  saturn: { beta: [0.98, 0.84, 0.55], k: 0.07, h: 0.03, gain: 0.7 },
  uranus: { beta: [0.38, 0.82, 0.92], k: 0.09, h: 0.03, gain: 0.8 },
  neptune: { beta: [0.24, 0.5, 1.0], k: 0.09, h: 0.03, gain: 0.85 },
  pluto: { beta: [0.38, 0.6, 1.0], k: 0.03, h: 0.02, gain: 0.7 },
};
const TOP_IN_SCALE_HEIGHTS = 7;
/**
 * SUNLIGHT ON THE SURFACE. A flat lift read as nothing (reported: "the day and
 * night sides need visualisation ... on the surface itself"), because every
 * viewer's ambient wash already lights the whole ball. So the lift follows the
 * sun's angle -- brightest under the sun and rolling off to the terminator,
 * the way a lit sphere shades -- and beyond the terminator the surface steps
 * down to NIGHT_LEVEL, so the two halves read apart from orbit. (Earth keeps
 * its night side as mapped; this is the other worlds' shading.)
 */
const DAY_LIFT = 0.6;
const NIGHT_LEVEL = 0.62;
// Bright, bare worlds blow out under the full lift; theirs is gentler.
const LIFT_FOR = { moon: 0.35, mercury: 0.45 };

const VERT = `
  varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = `
  uniform vec3 uSun;
  uniform float uFade;
  uniform vec3 uCentre;
  uniform float uGround;
  uniform float uH;
  uniform float uK;
  uniform vec3 uBeta;
  uniform float uGain;
  uniform mat3 uToLocal;   // world offsets -> the body's own (unsquashed) frame
  varying vec3 vP;
  const float TAU_PI = 6.2831853;
  void main() {
    // IN THE BODY'S OWN FRAME, where it is a true sphere of radius uGround.
    // Saturn and Jupiter are drawn flattened (Saturn ~10% at the poles) and
    // their moons inherit the squash; done in world space the air was a
    // sphere round an ellipsoid, with a gap at the poles (reported).
    vec3 oc = uToLocal * (cameraPosition - uCentre);
    vec3 rd = normalize(uToLocal * (vP - uCentre) - oc);
    vec3 sunL = normalize(uToLocal * uSun);
    float b = dot(oc, rd);
    vec3 closest = oc - b * rd;
    float h = length(closest);
    float tau;
    vec3 n;
    if (h < uGround) {
      float tHit = -b - sqrt(uGround * uGround - h * h);
      n = normalize(oc + rd * tHit);
      tau = uK / max(dot(n, -rd), 0.035);
    } else {
      n = normalize(closest);
      tau = uK * exp(-(h - uGround) / uH) * sqrt(TAU_PI * h / uH);
    }
    tau = min(tau, 2.2);
    float s = dot(n, sunL);
    float lit = smoothstep(-0.06, 0.16, s);
    vec3 sunlight = exp(-uBeta * uK * 0.7 / max(s + 0.22, 0.05)) * lit;
    vec3 scatter = 1.0 - exp(-uBeta * tau);
    float c = dot(rd, sunL);
    float phase = 0.75 * (1.0 + c * c);
    gl_FragColor = vec4(sunlight * scatter * phase * uGain * uFade, 1.0);
  }`;

function findSun(scene) {
  let light = null;
  scene.traverse((n) => {
    if (!light && n.isDirectionalLight && Math.abs(n.intensity - 1.9) < 0.05) light = n;
  });
  return light;
}

/** The sunlit hemisphere lifted; zero on the night side. Chained onto the
 *  globe material's own onBeforeCompile so a viewer's injections survive. */
function liftDaySide(THREE, material, sunView, lift = DAY_LIFT) {
  if (!material || material.userData.geoidDayLift) return;
  material.userData.geoidDayLift = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === "function") previous(shader, renderer);
    shader.uniforms.uSunView = { value: sunView };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunView;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          float ndl = dot(normalize(vNormal), uSunView);
          float dayK = smoothstep(-0.08, 0.18, ndl);
          float lambert = pow(max(ndl, 0.0), 0.75);
          diffuseColor.rgb *= mix(${NIGHT_LEVEL.toFixed(2)}, 1.0, dayK) * (1.0 + ${lift.toFixed(2)} * lambert);
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ""}|geoid-day-lift-2`;
  material.needsUpdate = true;
}


/**
 * A scattering shell parented to its BODY, so it takes the body's tilt, spin
 * and squash with it; the shader works in the body's local frame (uToLocal),
 * where the body is a sphere of its geometry radius. `update(ground, h, cam)`
 * sizes it each frame in those local units and fades it as the camera enters.
 */
function makeShell(body, profile, sun) {
  const fade = { value: 1 };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 120),
    new THREE.ShaderMaterial({
      uniforms: {
        uSun: sun, uFade: fade,
        uCentre: { value: new THREE.Vector3() },
        uToLocal: { value: new THREE.Matrix3() },
        uGround: { value: 1 }, uH: { value: 0.05 },
        uK: { value: profile.k },
        uBeta: { value: new THREE.Vector3(...profile.beta) },
        uGain: { value: profile.gain },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  shell.userData.nonInteractive = true;
  shell.raycast = () => {};
  shell.renderOrder = 3;
  shell.name = "geoid-atmosphere";
  body.add(shell);
  const m4 = new THREE.Matrix4();
  const camLocal = new THREE.Vector3();
  shell.userData.update = (ground, h, top, cam) => {
    const u = shell.material.uniforms;
    body.updateMatrixWorld();
    body.getWorldPosition(u.uCentre.value);
    u.uToLocal.value.setFromMatrix4(m4.copy(body.matrixWorld)).invert();
    u.uGround.value = ground;
    u.uH.value = h;
    shell.scale.setScalar(top);
    camLocal.copy(cam.position).applyMatrix4(m4.copy(body.matrixWorld).invert());
    const d = camLocal.length() / ground;
    const t = Math.min(1, Math.max(0, (d - 1.03) / 0.22));
    fade.value = t * t * (3 - 2 * t);
    const cutaway = Boolean(document.getElementById("core-toggle")?.checked);
    shell.visible = !cutaway;
  };
  return shell;
}


/**
 * RINGS THAT KNOW WHERE THE SUN IS (asked for, 2026-10-18). Saturn's rings
 * were a flat texture lit the same everywhere. Three things now come from the
 * sun direction, in the ring material's own shader:
 *  - THE PLANET'S SHADOW: where the line to the sun from a point on the rings
 *    passes through the planet, that part is in night (soft-edged), so the
 *    shadow sweeps round the rings as the planet turns against the sun;
 *  - THE UNLIT FACE: with the camera and the sun on opposite sides of the
 *    ring plane you are looking at the rings' dark side, which is dimmer;
 *  - FORWARD SCATTER: looking toward the sun through the rings brightens
 *    them -- a broad glow and a tight streak that moves with the camera, the
 *    way Cassini's backlit images show them -- strongest on the dark face.
 * Any ringed world's ring disc (a RingGeometry with a textured standard
 * material, outside the planet) gets it, so Uranus's too.
 */
function dressRings(globe, planetR, sunWorld) {
  const rings = [];
  const root = globe.parent || globe;
  root.traverse((n) => {
    if (n.isMesh && n.geometry?.type === "RingGeometry" && n.material?.isMeshStandardMaterial
        && n.material.map && (n.geometry.parameters?.innerRadius || 0) > planetR * 0.9) rings.push(n);
  });
  const uni = {
    uSunW: { value: sunWorld },
    uPlanetC: { value: new THREE.Vector3() },
    uPlanetR: { value: planetR },
    uRingN: { value: new THREE.Vector3(0, 1, 0) },
  };
  rings.forEach((ring) => {
    const m = ring.material;
    if (m.userData.geoidRingLight) return;
    m.userData.geoidRingLight = true;
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      if (typeof prev === "function") prev(shader, renderer);
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGeoidWorld;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvGeoidWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGeoidWorld;\nuniform vec3 uSunW;\nuniform vec3 uPlanetC;\nuniform float uPlanetR;\nuniform vec3 uRingN;")
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        {
          vec3 S = normalize(uSunW);
          vec3 oc = vGeoidWorld - uPlanetC;
          float b = dot(oc, S);
          float h = sqrt(max(dot(oc, oc) - b * b, 0.0));
          // In the planet's shadow: the sunward ray passes within the planet.
          float shadow = b < 0.0 ? 1.0 - smoothstep(uPlanetR * 0.96, uPlanetR * 1.04, h) : 0.0;
          vec3 V = normalize(vGeoidWorld - cameraPosition);
          float fwd = max(dot(V, S), 0.0);
          float unlit = dot(cameraPosition - uPlanetC, uRingN) * dot(S, uRingN) < 0.0 ? 1.0 : 0.0;
          float glint = 0.9 * pow(fwd, 3.0) + 2.4 * pow(fwd, 22.0);
          vec3 col = gl_FragColor.rgb;
          col *= mix(1.0, 0.42, unlit);
          col += col * glint * (1.0 + 1.5 * unlit);
          // The streak: sunlight mirrored off the ring plane toward the eye.
          // It sits where the camera meets the mirror angle and slides across
          // the rings as the camera moves.
          vec3 Nf = dot(uRingN, S) >= 0.0 ? uRingN : -uRingN;
          float spec = pow(max(dot(reflect(-S, Nf), -V), 0.0), 28.0);
          col += col * spec * 3.0 * (1.0 - unlit);
          col *= mix(1.0, 0.1, shadow);
          gl_FragColor.rgb = col;
        }`);
    };
    m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|geoid-ring-light`;
    m.needsUpdate = true;
  });
  const n = new THREE.Vector3();
  return {
    rings,
    update() {
      if (!rings.length) return;
      globe.getWorldPosition(uni.uPlanetC.value);
      // The ring disc's normal: its local +z after the viewer's -90 deg tilt.
      rings[0].updateMatrixWorld();
      n.setFromMatrixColumn(rings[0].matrixWorld, 2).normalize();
      uni.uRingN.value.copy(n);
    },
  };
}

function attach(viewer) {
  const { scene, globe } = viewer;
  if (!scene || !globe || globe.userData.atmosphere) return false;
  const sunLight = findSun(scene);
  if (!sunLight) return false;
  const profile = PROFILES[currentBodyId()];
  const sunWorld = new THREE.Vector3(1, 0, 0);
  const sunView = new THREE.Vector3(1, 0, 0);
  const fade = { value: 1 };
  const sun = { value: sunWorld };

  liftDaySide(THREE, globe.material, sunView, LIFT_FOR[currentBodyId()] ?? DAY_LIFT);
  const planetWorldR = (Number(globe.geometry?.parameters?.radius) || 3.2) * globe.getWorldScale(new THREE.Vector3()).x;
  let ringLight = dressRings(globe, planetWorldR, sunWorld);
  // The ring texture loads asynchronously, so the disc may not exist yet:
  // look again every 2 s for the first minute.
  let ringTries = 0;
  const ringRetry = setInterval(() => {
    if (ringLight.rings.length || ringTries++ > 30) { clearInterval(ringRetry); return; }
    ringLight = dressRings(globe, planetWorldR, sunWorld);
  }, 2000);

  const layers = [];
  const shell = profile ? makeShell(globe, profile, sun) : null;
  if (shell) layers.push(shell);

  const relief = () => {
    const r = Number(viewer.getEffectiveRelief?.());
    if (Number.isFinite(r)) return Math.max(0, r);
    return Math.max(0, Number(globe.material?.displacementScale) || 0);
  };

  // One hook, on the globe, per frame: the sun in world and view space, the
  // shell sized to the ground at its exaggeration, and the fade by height.
  const before = globe.onBeforeRender;
  globe.onBeforeRender = function (renderer, sc, cam, ...rest) {
    if (typeof before === "function") before.call(this, renderer, sc, cam, ...rest);
    sunWorld.copy(sunLight.position);
    if (sunLight.target) sunWorld.sub(sunLight.target.position);
    if (sunWorld.lengthSq() < 1e-9) sunWorld.set(1, 0, 0);
    sunWorld.normalize();
    sunView.copy(sunWorld).transformDirection(cam.matrixWorldInverse);
    ringLight.update();
    if (!shell) return;
    // In the globe's LOCAL units (its geometry radius; displacement is in the
    // same units). The air's base sits a fifth of the relief up: at half, the
    // limb's brightest line floated off lower terrain (reported on Mars).
    const base = Number(globe.geometry?.parameters?.radius) || Number(viewer.GLOBE_RADIUS) || 3.2;
    const rel = relief();
    const ground = base + rel * 0.2;
    shell.userData.update(ground, base * profile.h, ground + base * profile.h * TOP_IN_SCALE_HEIGHTS + rel * 0.5, cam);
  };
  globe.userData.atmosphere = layers;
  return true;
}

/**
 * THE MOONS, LIT THE SAME WAY. In moon-viewer mode the moon in front of the
 * camera was a flat, evenly lit ball with no day or night side, and Titan --
 * the one moon with a thick atmosphere -- had no air at all (reported: "the
 * glow on each planet is absent" in moon view). Every moon sphere a viewer
 * builds (a standard-material sphere tagged with its feature name, smaller
 * than the planet) gets the planet's sun-angle shading, and the moons that
 * really have air get the same scattering shell, sized and faded around the
 * moon. Runs on every world, Earth included, and keeps looking for moons for a
 * few minutes because a viewer builds its moon layer after its globe.
 */
const MOON_AIR = {
  Titan: { beta: [1.0, 0.52, 0.16], k: 0.32, h: 0.07, gain: 0.75 },  // thick orange-brown haze
  Triton: { beta: [0.38, 0.6, 1.0], k: 0.03, h: 0.02, gain: 0.6 },   // thin nitrogen
};
const MOON_LIFT = 0.45;
const moonSun = { light: null, world: new THREE.Vector3(1, 0, 0), view: new THREE.Vector3(1, 0, 0) };
const seenMoons = new WeakSet();

function moonName(mesh) {
  const f = mesh.userData?.feature || mesh.userData?.item;
  return (f && f.name) || "";
}

function isMoonMesh(mesh, globe, globeR) {
  if (!mesh.isMesh || mesh === globe || !mesh.material?.isMeshStandardMaterial) return false;
  if (mesh.geometry?.type !== "SphereGeometry") return false;
  if (!moonName(mesh)) return false;
  const r = (mesh.geometry.parameters?.radius || 0) * mesh.getWorldScale(new THREE.Vector3()).x;
  return r > 0 && r < globeR * 0.8;
}

function attachMoon(viewer, mesh) {
  seenMoons.add(mesh);
  liftDaySide(THREE, mesh.material, moonSun.view, MOON_LIFT);
  const air = MOON_AIR[moonName(mesh)];
  const shell = air ? makeShell(mesh, air, { value: moonSun.world }) : null;
  if (shell) shell.name = `geoid-atmosphere-${moonName(mesh)}`;
  const before = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, sc, cam, ...rest) {
    if (typeof before === "function") before.call(this, renderer, sc, cam, ...rest);
    const light = moonSun.light;
    if (light) {
      moonSun.world.copy(light.position);
      if (light.target) moonSun.world.sub(light.target.position);
      if (moonSun.world.lengthSq() < 1e-9) moonSun.world.set(1, 0, 0);
      moonSun.world.normalize();
      moonSun.view.copy(moonSun.world).transformDirection(cam.matrixWorldInverse);
    }
    if (!shell) return;
    // Local units: the moon's own geometry radius, squash and all inherited.
    const R = mesh.geometry.parameters?.radius || 1;
    shell.userData.update(R, R * air.h, R + R * air.h * TOP_IN_SCALE_HEIGHTS, cam);
  };
}

function watchMoons() {
  let tries = 0;
  const scan = () => {
    const viewer = window.GeoIDViewer;
    try {
      if (viewer?.scene && viewer.globe) {
        moonSun.light = moonSun.light || findSun(viewer.scene);
        const g = viewer.globe;
        const globeR = (g.geometry?.parameters?.radius || 3.2) * g.getWorldScale(new THREE.Vector3()).x;
        if (moonSun.light) {
          viewer.scene.traverse((n) => {
            if (!seenMoons.has(n) && isMoonMesh(n, g, globeR)) attachMoon(viewer, n);
          });
        }
      }
    } catch (error) {
      window.GeoIDAtmosphereError = String(error?.stack || error);
    }
    if (tries++ < 60) setTimeout(scan, 3000);
  };
  scan();
}

function start() {
  window.GeoIDAtmosphereState = `start:${currentBodyId()}`;
  let tries = 0;
  const attempt = () => {
    // Asked each time, not once at import: a planet page can declare its body
    // after this module has loaded, and a first answer of "earth" is wrong.
    if (currentBodyId() === "earth") {      // Earth's viewer builds its own
      if (tries++ < 180) setTimeout(attempt, 1000);
      return;
    }
    const viewer = window.GeoIDViewer;
    try {
      if (viewer && attach(viewer)) { window.GeoIDAtmosphereState = "attached"; return; }
      window.GeoIDAtmosphereState = `waiting:${Boolean(viewer?.scene)}/${Boolean(viewer?.globe)}`;
    } catch (error) {
      // Recorded rather than thrown: the GIS layer must not fall over for a
      // glow, and the next attempt may find the scene complete.
      window.GeoIDAtmosphereError = String(error?.stack || error);
      console.warn("[GeoID GIS] atmosphere:", error?.message || error);
    }
    if (tries++ < 180) setTimeout(attempt, 1000);
  };
  attempt();
}

start();
watchMoons();
