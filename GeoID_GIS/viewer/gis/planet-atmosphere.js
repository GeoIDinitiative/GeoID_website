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
 * Per world, the air is what the world has:
 *   - Mercury and the Moon have none: sunlight only, no glow.
 *   - Venus: a thick pale-yellow envelope, the strongest of them.
 *   - Mars: thin and butterscotch by day, BLUE at sunset (its dust scatters
 *     blue forward, which is why Curiosity's sunsets are blue).
 *   - Jupiter and Saturn: thin cream and gold limbs; Uranus cyan; Neptune a
 *     deep blue; Pluto a faint blue haze (New Horizons' backlit rings).
 *
 * The SUN is the viewer's own key light (intensity 1.9 in every lineage), read
 * each frame, so the glow and the lift follow whatever drives that light. The
 * shells sit on the terrain at its current vertical exaggeration, and fade as
 * the camera comes down through them. Nothing here touches the night side's
 * mapping: the lift is zero where the sun is down.
 */

import * as THREE from "/GeoID_GIS/viewer/vendor/three.module.js";
import { currentBodyId } from "./bodies.js?v=20261018-6f942b9";

const PROFILES = {
  mercury: null,
  moon: null,
  venus: { day: [1.0, 0.9, 0.62], dusk: [1.0, 0.62, 0.3], gain: 1.05, tight: 0.05, wide: 0.15, haze: 0.6 },
  mars: { day: [0.96, 0.64, 0.44], dusk: [0.42, 0.62, 1.0], gain: 0.42, tight: 0.018, wide: 0.06, haze: 0.28 },
  jupiter: { day: [0.92, 0.86, 0.74], dusk: [1.0, 0.62, 0.36], gain: 0.55, tight: 0.025, wide: 0.07, haze: 0.3 },
  saturn: { day: [0.96, 0.86, 0.6], dusk: [1.0, 0.6, 0.32], gain: 0.55, tight: 0.025, wide: 0.07, haze: 0.3 },
  uranus: { day: [0.55, 0.9, 0.95], dusk: [0.7, 0.85, 1.0], gain: 0.7, tight: 0.03, wide: 0.08, haze: 0.4 },
  neptune: { day: [0.34, 0.55, 1.0], dusk: [0.6, 0.6, 1.0], gain: 0.75, tight: 0.03, wide: 0.08, haze: 0.42 },
  pluto: { day: [0.5, 0.7, 1.0], dusk: [0.6, 0.75, 1.0], gain: 0.32, tight: 0.015, wide: 0.05, haze: 0.18 },
};
const DAY_LIFT = 0.22;

const VERT = `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const SHELL_FRAG = `
  uniform vec3 uSun;
  uniform float uFade;
  uniform float uEdge;
  uniform float uGain;
  uniform float uPow;
  uniform vec3 uDay;
  uniform vec3 uDusk;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vec3 v = normalize(cameraPosition - vP);
    float f = clamp(-dot(vN, v) / max(uEdge, 0.01), 0.0, 1.0);
    float glow = pow(f, uPow);
    float s = dot(vN, uSun);
    float day = smoothstep(-0.22, 0.22, s);
    float back = smoothstep(0.0, 0.85, dot(-v, uSun));
    float dusk = back * (1.0 - smoothstep(-0.12, 0.35, s));
    vec3 col = mix(uDay, uDusk, dusk);
    float night = mix(1.0, 0.28, back);
    gl_FragColor = vec4(col * glow * day * night * uGain * uFade, 1.0);
  }`;

const HAZE_FRAG = `
  uniform vec3 uSun;
  uniform float uFade;
  uniform float uGain;
  uniform vec3 uDay;
  uniform vec3 uDusk;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vec3 v = normalize(cameraPosition - vP);
    float rim = pow(1.0 - max(dot(vN, v), 0.0), 2.4);
    float s = dot(vN, uSun);
    float day = smoothstep(-0.12, 0.45, s);
    float back = smoothstep(0.0, 0.85, dot(-v, uSun));
    float dusk = back * (1.0 - smoothstep(0.0, 0.35, s));
    vec3 col = mix(uDay, uDusk, dusk);
    gl_FragColor = vec4(col * rim * 0.75 * uGain * day * (1.0 - 0.7 * back) * uFade, 1.0);
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
function liftDaySide(THREE, material, sunView) {
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
          float dayK = smoothstep(-0.06, 0.32, dot(normalize(vNormal), uSunView));
          diffuseColor.rgb *= 1.0 + ${DAY_LIFT.toFixed(2)} * dayK;
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ""}|geoid-day-lift`;
  material.needsUpdate = true;
}

function attach(viewer) {
  const { scene, globe } = viewer;
  if (!scene || !globe || globe.userData.atmosphere) return false;
  const sunLight = findSun(scene);
  if (!sunLight) return false;
  const R = Number(viewer.GLOBE_RADIUS) || 3.2;
  const profile = PROFILES[currentBodyId()];
  const sunWorld = new THREE.Vector3(1, 0, 0);
  const sunView = new THREE.Vector3(1, 0, 0);
  const fade = { value: 1 };
  const sun = { value: sunWorld };

  liftDaySide(THREE, globe.material, sunView);

  const layers = [];
  if (profile) {
    const colour = (rgb) => new THREE.Vector3(...rgb);
    const shell = (gain, pow) => new THREE.ShaderMaterial({
      uniforms: {
        uSun: sun, uFade: fade, uEdge: { value: 0.3 }, uGain: { value: gain }, uPow: { value: pow },
        uDay: { value: colour(profile.day) }, uDusk: { value: colour(profile.dusk) },
      },
      vertexShader: VERT,
      fragmentShader: SHELL_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const unit = new THREE.SphereGeometry(1, 128, 96);
    const halo = new THREE.Mesh(unit, shell(profile.gain * 0.36, 2.4));
    const limb = new THREE.Mesh(unit, shell(profile.gain, 1.35));
    const haze = new THREE.Mesh(unit, new THREE.ShaderMaterial({
      uniforms: {
        uSun: sun, uFade: fade, uGain: { value: profile.haze },
        uDay: { value: colour(profile.day) }, uDusk: { value: colour(profile.dusk) },
      },
      vertexShader: VERT,
      fragmentShader: HAZE_FRAG,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    [halo, limb, haze].forEach((mesh, i) => {
      mesh.userData.nonInteractive = true;
      mesh.raycast = () => {};
      mesh.renderOrder = 2 + i;
      mesh.name = "geoid-atmosphere";
    });
    halo.userData.thickness = profile.wide;
    limb.userData.thickness = profile.tight;
    layers.push(halo, limb, haze);
    // Into the globe's own parent: the shells are spheres, so the planet's
    // tilt and spin do not move them, but its position does.
    (globe.parent || scene).add(halo, limb, haze);
  }

  const relief = () => {
    const r = Number(viewer.getEffectiveRelief?.());
    if (Number.isFinite(r)) return Math.max(0, r);
    return Math.max(0, Number(globe.material?.displacementScale) || 0);
  };

  // One hook, on the globe, per frame: the sun in world and view space, the
  // shells sized to the ground at its exaggeration, and the fade by height.
  const before = globe.onBeforeRender;
  globe.onBeforeRender = function (renderer, sc, cam, ...rest) {
    if (typeof before === "function") before.call(this, renderer, sc, cam, ...rest);
    sunWorld.copy(sunLight.position);
    if (sunLight.target) sunWorld.sub(sunLight.target.position);
    if (sunWorld.lengthSq() < 1e-9) sunWorld.set(1, 0, 0);
    sunWorld.normalize();
    sunView.copy(sunWorld).transformDirection(cam.matrixWorldInverse);
    if (!layers.length) return;
    const centre = new THREE.Vector3();
    globe.getWorldPosition(centre);
    const ground = R + relief();
    layers.forEach((mesh) => {
      mesh.position.copy(mesh.parent ? mesh.parent.worldToLocal(centre.clone()) : centre);
      mesh.visible = globe.visible;
      if (mesh.material.uniforms.uEdge) {
        const r = ground + R * mesh.userData.thickness;
        mesh.scale.setScalar(r);
        mesh.material.uniforms.uEdge.value = Math.sqrt(Math.max(0, 1 - (ground / r) ** 2));
      } else {
        mesh.scale.setScalar(R + relief() * 0.5 + 0.012);
      }
    });
    const d = cam.position.distanceTo(centre) / ground;
    fade.value = Math.min(1, Math.max(0, (d - 1.03) / 0.22));
    fade.value = fade.value * fade.value * (3 - 2 * fade.value);
  };
  globe.userData.atmosphere = layers;
  return true;
}

function start() {
  if (currentBodyId() === "earth") return;   // Earth's viewer builds its own
  let tries = 0;
  const attempt = () => {
    const viewer = window.GeoIDViewer;
    if (viewer && attach(viewer)) return;
    if (tries++ < 60) setTimeout(attempt, 500);
  };
  attempt();
}

start();
