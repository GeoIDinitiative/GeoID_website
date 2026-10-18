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
import { currentBodyId } from "./bodies.js?v=20261018-c65e0e1";

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
  varying vec3 vP;
  const float TAU_PI = 6.2831853;
  void main() {
    vec3 rd = normalize(vP - cameraPosition);
    vec3 oc = cameraPosition - uCentre;
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
    float s = dot(n, uSun);
    float lit = smoothstep(-0.06, 0.16, s);
    vec3 sunlight = exp(-uBeta * uK * 0.7 / max(s + 0.22, 0.05)) * lit;
    vec3 scatter = 1.0 - exp(-uBeta * tau);
    float c = dot(rd, uSun);
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

function attach(viewer) {
  const { scene, globe } = viewer;
  if (!scene || !globe || globe.userData.atmosphere) return false;
  const sunLight = findSun(scene);
  if (!sunLight) return false;
  // The globe's TRUE size in the world: its geometry radius times its world
  // scale. GLOBE_RADIUS is the nominal 3.2, and Jupiter's globe is scaled
  // away from it -- the air came out as a band floating off the limb with a
  // dark gap between (seen in capture). Read each frame below, since a viewer
  // may rescale.
  const worldScale = new THREE.Vector3();
  const trueRadius = () => {
    const base = Number(globe.geometry?.parameters?.radius) || Number(viewer.GLOBE_RADIUS) || 3.2;
    globe.getWorldScale(worldScale);
    return base * Math.max(worldScale.x, worldScale.y, worldScale.z);
  };
  let R = trueRadius();
  const profile = PROFILES[currentBodyId()];
  const sunWorld = new THREE.Vector3(1, 0, 0);
  const sunView = new THREE.Vector3(1, 0, 0);
  const fade = { value: 1 };
  const sun = { value: sunWorld };

  liftDaySide(THREE, globe.material, sunView, LIFT_FOR[currentBodyId()] ?? DAY_LIFT);

  const layers = [];
  let shell = null;
  if (profile) {
    shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 120),
      new THREE.ShaderMaterial({
        uniforms: {
          uSun: sun, uFade: fade,
          uCentre: { value: new THREE.Vector3() },
          uGround: { value: R },
          uH: { value: R * profile.h },
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
    layers.push(shell);
    (globe.parent || scene).add(shell);
  }

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
    if (!shell) return;
    // THE CUTAWAY SHOWS THE INSIDE, so the air goes with the outer skin: a
    // glow wrapped round a half-sphere read as a lit shell round nothing
    // (reported on Venus). Every viewer carries the same #core-toggle.
    const cutaway = Boolean(document.getElementById("core-toggle")?.checked);
    shell.visible = globe.visible && !cutaway;
    const u = shell.material.uniforms;
    globe.getWorldPosition(u.uCentre.value);
    shell.position.copy(shell.parent ? shell.parent.worldToLocal(u.uCentre.value.clone()) : u.uCentre.value);
    R = trueRadius();
    const rel = relief();
    // The air's base sits LOW -- a fifth of the relief up, below most of the
    // ground. At half the relief (the old value) the brightest line of the
    // limb floated off any terrain lower than that, with a dark sliver of
    // space between (reported on Mars). Set low, the peak lands on or inside
    // the real edge and the haze runs over it, whatever the terrain there.
    const ground = R + rel * 0.2;
    u.uH.value = R * profile.h;
    u.uGround.value = ground;
    const parentScale = shell.parent ? shell.parent.getWorldScale(new THREE.Vector3()).x || 1 : 1;
    shell.scale.setScalar((ground + R * profile.h * TOP_IN_SCALE_HEIGHTS + rel * 0.5) / parentScale);
    const d = cam.position.distanceTo(u.uCentre.value) / ground;
    const t = Math.min(1, Math.max(0, (d - 1.03) / 0.22));
    fade.value = t * t * (3 - 2 * t);
  };
  globe.userData.atmosphere = layers;
  return true;
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
