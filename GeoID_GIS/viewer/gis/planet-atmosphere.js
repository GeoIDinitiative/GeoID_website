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
import { currentBodyId } from "./bodies.js?v=20261024-ea1a29e";

/*
 * dusk -- TWILIGHT at the terminator, as Earth now has (earth-viewer.js):
 *   colour  what that world's air does to sunlight on a long path;
 *   gain    how bright the band is; g how strongly it scatters FORWARD (a
 *           backlit limb); w how wide the band is in sun elevation.
 * Within realism: Mars's twilight is BLUE (its fine dust forward-scatters
 * blue, as the rovers photograph it); Venus's is broad and pale gold under
 * its thick cloud; the giants' faint and their own tint; Pluto's backlit
 * haze rings blue (New Horizons) and Titan's orange (Cassini). No air, no
 * dusk: Mercury and the Moon.
 */
const PROFILES = {
  mercury: null,
  moon: null,
  venus: { beta: [0.95, 0.82, 0.52], k: 0.16, h: 0.045, gain: 0.7, dusk: [1.0, 0.75, 0.42], duskGain: 0.45, duskG: 0.6, duskW: 0.14 },
  mars: { beta: [1.0, 0.68, 0.42], k: 0.05, h: 0.022, gain: 0.85, dusk: [0.36, 0.6, 1.0], duskGain: 0.38, duskG: 0.8, duskW: 0.08 },
  jupiter: { beta: [0.9, 0.82, 0.66], k: 0.07, h: 0.03, gain: 0.7, dusk: [1.0, 0.86, 0.62], duskGain: 0.2, duskG: 0.7, duskW: 0.08 },
  saturn: { beta: [0.98, 0.84, 0.55], k: 0.07, h: 0.03, gain: 0.7, dusk: [1.0, 0.84, 0.55], duskGain: 0.2, duskG: 0.7, duskW: 0.08 },
  uranus: { beta: [0.38, 0.82, 0.92], k: 0.09, h: 0.03, gain: 0.8, dusk: [0.55, 0.85, 1.0], duskGain: 0.18, duskG: 0.7, duskW: 0.08 },
  neptune: { beta: [0.24, 0.5, 1.0], k: 0.09, h: 0.03, gain: 0.85, dusk: [0.4, 0.6, 1.0], duskGain: 0.2, duskG: 0.7, duskW: 0.08 },
  pluto: { beta: [0.38, 0.6, 1.0], k: 0.03, h: 0.02, gain: 0.7, dusk: [0.45, 0.68, 1.0], duskGain: 0.5, duskG: 0.85, duskW: 0.12 },
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
  uniform vec3 uDusk;
  uniform float uDuskGain;
  uniform float uDuskG;
  uniform float uDuskW;
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
    // TWILIGHT (restored 2026-10-23). The air along the terminator is
    // lit by sunlight that has crossed a long path of air -- red on
    // Earth -- and scatters it FORWARD, so the band glows most when
    // you look toward the sun past the limb. A Gaussian band in the
    // sun's elevation at that air, the optical depth along the view,
    // and a Henyey-Greenstein forward lobe (uDuskG). Added on top, so
    // the cap above and the dark night limb are untouched elsewhere.
    float duskBand = exp(-(s - 0.02) * (s - 0.02) / (uDuskW * uDuskW));
    float duskG2 = uDuskG * uDuskG;
    float duskHG = (1.0 - duskG2) / pow(1.0 + duskG2 - 2.0 * uDuskG * c, 1.5);
    float duskLobe = 0.25 + 0.75 * min(duskHG / 6.0, 1.0);
    vec3 dusk = uDusk * duskBand * (1.0 - exp(-tau * 1.5)) * duskLobe * uDuskGain;
    vec3 col = sunlight * scatter * phase * uGain + dusk;
    gl_FragColor = vec4(min(col, vec3(1.2)) * uFade, 1.0);
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
function liftDaySide(THREE, material, sunView, lift = DAY_LIFT, night = NIGHT_LEVEL) {
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
          diffuseColor.rgb *= mix(${night.toFixed(2)}, 1.0, dayK) * (1.0 + ${lift.toFixed(2)} * lambert);
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ""}|geoid-day-lift-3`;
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
        uDusk: { value: new THREE.Vector3(...(profile.dusk || [0, 0, 0])) },
        uDuskGain: { value: profile.duskGain || 0 },
        uDuskG: { value: profile.duskG ?? 0.7 },
        uDuskW: { value: profile.duskW || 0.08 },
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
  // thick orange-brown haze; backlit, the orange ring Cassini photographed
  Titan: { beta: [1.0, 0.52, 0.16], k: 0.32, h: 0.07, gain: 0.75, dusk: [1.0, 0.58, 0.22], duskGain: 0.6, duskG: 0.8, duskW: 0.14 },
  // thin nitrogen; a faint cool twilight
  Triton: { beta: [0.38, 0.6, 1.0], k: 0.03, h: 0.02, gain: 0.6, dusk: [0.6, 0.75, 1.0], duskGain: 0.25, duskG: 0.8, duskW: 0.1 },
};
const MOON_LIFT = 0.45;
const MOON_NIGHT = 0.22;
const moonSun = { light: null, world: new THREE.Vector3(1, 0, 0), view: new THREE.Vector3(1, 0, 0) };
const seenMoons = new WeakSet();
// The same moons as a list, so the glare's per-frame occlusion test walks a
// handful of meshes instead of the whole scene (thousands of label objects on
// Mars, the Moon and Pluto -- it made the transit lag).
const moonList = [];

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
  moonList.push(mesh);
  // Airless and seen side-on, a moon's night is nearly black: the viewers'
  // ambient wash otherwise turns a half moon into a full one (seen on Earth's
  // Moon, which sits under Earth's strong ambient light).
  liftDaySide(THREE, mesh.material, moonSun.view, MOON_LIFT, MOON_NIGHT);
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
    // Keeps looking for the whole session: Earth builds its Moon only when the
    // moons are switched on (the moon viewer does it), often long after load,
    // and a Moon found late was never lit (reported). A traverse every 4 s is
    // cheap; meshes already handled are skipped.
    tries++;
    setTimeout(scan, tries < 30 ? 4000 : 15000);   // every 4 s for 2 min, then 15 s
  };
  scan();
}


/**
 * THE SUN'S GLARE, as a camera sees it (rebuilt 2026-10-18 after an ISS
 * photograph). A 2D overlay over the viewer's canvas, drawn each frame:
 *  - ANCHORED TO THE SUN IN THE SCENE: the visible sun disc's world position,
 *    projected. Projecting "camera +
 *    sun direction" put the glare beside the sun disc whenever the camera
 *    was away from the centre -- flight, moon view (reported);
 *  - a tight white CORE and a STARBURST: thin tapering diffraction rays of
 *    alternating length, slightly colour-fringed;
 *  - one long thin STREAK across the frame;
 *  - GHOSTS -- coloured discs and small dots strung along the line from the
 *    sun through the centre of the view, as internal lens reflections are.
 * The rays turn with the camera's roll and swing as the sun crosses the
 * frame; the ghosts slide along their line as the view moves. Fades as the
 * sun goes behind the planet, with a brief flare as it clears the limb.
 * Pointer-events none; reduced-transparency viewers get it at half strength.
 */
/**
 * THE SUN AT ITS REAL DISTANCE (asked for, 2026-10-18). Every viewer drew the
 * same sun -- a 1.8-unit disc 180 units out, about Earth's half-degree -- so
 * from Pluto it looked as big as from Earth. The disc now keeps its true
 * angular size, 1 / (the world's distance in AU) of Earth's (Jupiter 1/5,
 * Pluto 1/40 -- a bright point, as it is): see pinSunToSky below. The glare
 * shrinks more gently, as the square root (a point source still flares), and
 * dims as the inverse fourth root -- at 40 AU sunlight is 1/1600 as strong,
 * but a camera pointed at it still stops down to a starburst.
 */
const AU = { mercury: 0.387, venus: 0.723, earth: 1, moon: 1, mars: 1.524, jupiter: 5.2,
  saturn: 9.58, uranus: 19.2, neptune: 30.1, pluto: 39.5 };
const SUN = { au: 1, size: 1, bright: 1 };
function sunDistanceFactors() {
  const au = AU[currentBodyId()] || 1;
  SUN.au = au;
  SUN.size = Math.min(1.3, Math.max(0.18, 1 / Math.sqrt(au)));
  SUN.bright = Math.min(1, Math.max(0.35, 1 / Math.pow(au, 0.25)));
}
/**
 * THE SUN AT INFINITY (2026-10-18). Every viewer builds its sun as a small
 * sphere 180 units from the planet -- closer than Earth's Moon is drawn, and
 * close enough that zooming out let the camera pan round it (reported: "we
 * can peak behind the curtain"). The viewer's sun is left where it is (its
 * direction drives the lighting and every viewer's own sun code), but it is
 * DRAWN as a star is: just inside the far plane, along its direction from
 * the camera, at its true angular size for this world -- 0.27 deg at 1 AU,
 * shrinking as 1 / AU. Distance stops meaning anything: no zoom or orbit
 * reaches it, it never parallaxes against the planet or the Moon, and
 * anything in front -- planet, moons, rings -- hides it by depth. A floor of
 * a pixel and a half keeps the far worlds' sun from vanishing; the glare
 * carries it there, as a camera's would.
 */
const SUN_ANGULAR_RADIUS = 0.004654;   // rad, the Sun's disc seen from 1 AU
const _skyPos = new THREE.Vector3(), _camPos = new THREE.Vector3();
function skySunPosition(mesh, cam, out) {
  // Direction from the scene origin -- where every viewer aims its key light.
  out.setFromMatrixPosition(mesh.matrixWorld);
  if (out.lengthSq() < 1e-9) out.set(1, 0, 0);
  _camPos.setFromMatrixPosition(cam.matrixWorld);
  return out.normalize().multiplyScalar(cam.far * 0.92).add(_camPos);
}
function pinSunToSky(mesh, renderer) {
  if (mesh.userData.geoidSkySun) return;
  mesh.userData.geoidSkySun = true;
  mesh.frustumCulled = false;   // culled at its logical place otherwise
  mesh.renderOrder = -1;        // the farthest thing: first of the transparents
  const r0 = mesh.geometry?.parameters?.radius || 1;
  const saved = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _scene, cam) => {
    saved.copy(mesh.matrixWorld);
    skySunPosition(mesh, cam, _skyPos);
    const h = renderer.domElement.height || 1000;
    const perPx = THREE.MathUtils.degToRad(cam.fov || 45) / h;
    const ang = Math.max(SUN_ANGULAR_RADIUS / SUN.au, 1.5 * perPx);
    s.setScalar((cam.far * 0.92 * Math.tan(ang)) / r0);
    mesh.matrixWorld.compose(_skyPos, q, s);
  };
  mesh.onAfterRender = () => { mesh.matrixWorld.copy(saved); };
}

function startGlare() {
  sunDistanceFactors();
  let canvas = null, ctx = null, light = null, sunMesh = null;
  const v3 = () => new THREE.Vector3();
  const sunPos = v3(), sunDir = v3(), toC = v3(), proj = v3(), camDir = v3(), camUp = v3(), tmp = v3();
  const camL = v3(), sunL = v3(), inv = new THREE.Matrix4();
  const reduced = (() => { try { return window.matchMedia("(prefers-reduced-transparency: reduce)").matches; } catch { return false; } })();
  // Spikes: [angle offset in rad, length (fraction of diagonal), width px]. Alternating long/short, 16 rays.
  // Shorter and finer than a first pass, which read as a cartoon star: in the
  // photograph most rays die within a tenth of the frame and two or three run on.
  const RAYS = Array.from({ length: 16 }, (_, i) => [i * Math.PI / 8 + (i % 3) * 0.04,
    i % 4 === 0 ? 0.24 : i % 2 ? 0.06 + 0.02 * ((i * 7) % 3) : 0.11 + 0.03 * ((i * 5) % 3), i % 4 === 0 ? 1.4 : 0.9]);
  // Ghosts along the sun->centre axis: [t, radius (fraction of diagonal), rgb, alpha, hex?]
  const GHOSTS = [
    [0.22, 0.012, "255,240,220", 0.35, false],
    [0.48, 0.030, "150,120,255", 0.16, true],
    [0.70, 0.010, "120,255,170", 0.30, false],
    [1.05, 0.060, "175,110,255", 0.11, true],
    [1.22, 0.022, "120,255,190", 0.15, false],
    [1.45, 0.040, "255,170,90", 0.08, true],
    [1.70, 0.008, "220,235,255", 0.35, false],
    [1.95, 0.085, "140,90,255", 0.07, true],
  ];
  const poly = (x, y, r, n, rot) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  const frame = () => {
    requestAnimationFrame(frame);
    const viewer = window.GeoIDViewer;
    const cam = viewer?.camera, renderer = viewer?.renderer, globe = viewer?.globe;
    if (!cam || !renderer || !globe) return;
    light = light || findSun(viewer.scene);
    if (!light) return;
    const host = renderer.domElement;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "geoid-sun-glare";
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, { position: "fixed", pointerEvents: "none", zIndex: "1", mixBlendMode: "screen" });
      document.body.appendChild(canvas);
      ctx = canvas.getContext("2d");
    }
    const r = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    }
    Object.assign(canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (host.offsetParent === null) return;

    // The sun where the scene DRAWS it: the visible sun disc (a far, basic-
    // material sphere) if the viewer has one -- the key light on the planet
    // viewers is only ~10 units out, nowhere near it -- else far along the
    // light's direction.
    if (!sunMesh || !sunMesh.parent) {
      sunMesh = null;
      // The sun object specifically: every viewer builds it as an unlit
      // sphere marked nonInteractive with no feature record. "The first far
      // unlit sphere" was Charon on Pluto (its moons are unlit spheres far
      // out), so the glare sat on Charon opposite the real sun (reported).
      // Of the candidates, the one most aligned with the key light wins.
      let best = -2;
      light.getWorldPosition(sunDir);
      sunDir.normalize();
      viewer.scene.traverse((n) => {
        if (!(n.isMesh && n.geometry?.type === "SphereGeometry" && n.material?.isMeshBasicMaterial)) return;
        if (!n.userData?.nonInteractive || n.userData?.feature) return;
        n.getWorldPosition(tmp);
        if (tmp.length() < 50) return;
        const al = tmp.normalize().dot(sunDir);
        if (al > best) { best = al; sunMesh = n; }
      });
      if (sunMesh) { sunDistanceFactors(); pinSunToSky(sunMesh, renderer); }
    }
    if (sunMesh) { sunMesh.updateWorldMatrix(true, false); skySunPosition(sunMesh, cam, sunPos); }
    else {
      sunPos.copy(light.position);
      if (light.target) sunPos.sub(light.target.position);
      sunPos.normalize().multiplyScalar(5000).add(cam.position);
    }
    sunDir.copy(sunPos).sub(cam.position);
    if (sunDir.lengthSq() < 1e-9) return;
    const sunDist = sunDir.length();
    sunDir.normalize();
    cam.getWorldDirection(camDir);
    const facing = camDir.dot(sunDir);
    if (facing <= 0.05) return;                      // behind the camera

    // The planet in the way, tested against the HORIZON AS DRAWN (reported:
    // the sun showed through the planet just inside its limb). Done in the
    // globe's own frame, where it is a true sphere of its geometry radius --
    // so a flattened giant is tested as drawn, not as a sphere round it --
    // and against that radius plus the relief the displaced terrain stands
    // up to. The sun starts to show only once its line of sight clears that
    // horizon, and the limb flare rides on the clearing, never ahead of it.
    globe.updateWorldMatrix(true, false);
    inv.copy(globe.matrixWorld).invert();
    camL.copy(cam.position).applyMatrix4(inv);
    sunL.copy(sunPos).applyMatrix4(inv).sub(camL);
    const sunDistL = sunL.length();
    sunL.normalize();
    const R0 = Number(globe.geometry?.parameters?.radius) || Number(viewer.GLOBE_RADIUS) || 3.2;
    const reliefL = Math.max(0, Number(viewer.getEffectiveRelief?.()) || Number(globe.material?.displacementScale) || 0);
    const Rh = R0 + reliefL * 0.6 + R0 * 0.004;
    const alongL = -camL.dot(sunL);
    const aheadL = alongL > 0 && alongL < sunDistL;
    const miss = aheadL ? Math.sqrt(Math.max(camL.lengthSq() - alongL * alongL, 0)) : Infinity;
    const clear = aheadL ? THREE.MathUtils.smoothstep(miss, Rh, Rh + R0 * 0.035) : 1;
    const limb = aheadL ? Math.exp(-Math.pow((miss - Rh - R0 * 0.01) / (R0 * 0.012), 2)) : 0;
    let vis = Math.min(1.4, clear * (1 + 0.8 * limb));
    // MOON-VIEWER MODE (and flight past a moon): the camera sits beside a
    // moon, and THAT body hides the sun as much as the planet does. Every lit
    // moon sphere (seenMoons, from watchMoons) is tested the same way, with
    // the same flare as the sun clears its limb.
    for (const n of moonList) {
      if (vis < 0.01) break;
      if (!n.visible || !n.parent) continue;
      n.getWorldPosition(tmp);
      const mr = (n.geometry?.parameters?.radius || 0) * n.getWorldScale(toC).x;
      toC.copy(tmp).sub(cam.position);
      const al = toC.dot(sunDir);
      if (!(al > 0 && al < sunDist) || mr <= 0) continue;
      const mm = Math.sqrt(Math.max(toC.lengthSq() - al * al, 0));
      // Same rule as the planet: no light until the line clears the limb.
      const mClear = THREE.MathUtils.smoothstep(mm, mr * 1.004, mr * 1.04);
      const mLimb = Math.exp(-Math.pow((mm - mr * 1.014) / (mr * 0.012), 2));
      vis = Math.min(vis, Math.min(1.4, mClear * (1 + 0.8 * mLimb)));
    }
    if (vis < 0.01) return;

    proj.copy(sunPos).project(cam);
    const W = canvas.width, H = canvas.height, D = Math.hypot(W, H) * SUN.size;
    const sx = (proj.x * 0.5 + 0.5) * W, sy = (-proj.y * 0.5 + 0.5) * H;
    const cx = W / 2, cy = H / 2;
    const k = (reduced ? 0.5 : 1) * vis * THREE.MathUtils.smoothstep(facing, 0.05, 0.6) * SUN.bright;
    const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
    ctx.globalCompositeOperation = "lighter";

    // A faint veil as the sun nears the view, on or off screen.
    const veil = Math.pow(Math.max(facing, 0), 10) * 0.08 * k;
    if (veil > 0.003) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, D * 0.7);
      g.addColorStop(0, `rgba(255,240,220,${veil})`);
      g.addColorStop(1, "rgba(255,240,220,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (!onScreen) return;

    // The ray orientation: the camera's roll plus a swing with where the
    // sun sits in the frame, so the burst turns as the view moves.
    camUp.copy(cam.up).applyQuaternion(cam.quaternion);
    const roll = Math.atan2(camUp.x, camUp.y);
    const swing = 0.35 * Math.atan2(sy - cy, sx - cx);
    const rot = 0.19 + roll + swing;

    // Starburst: thin tapering rays, a faint warm/cool fringe either side.
    ctx.save();
    ctx.translate(sx, sy);
    RAYS.forEach(([a, len, w]) => {
      const L = D * len * (0.55 + 0.45 * k);
      ctx.save();
      ctx.rotate(rot + a);
      const grad = ctx.createLinearGradient(0, 0, L, 0);
      grad.addColorStop(0, `rgba(255,255,255,${0.75 * k})`);
      grad.addColorStop(0.18, `rgba(235,240,255,${0.22 * k})`);
      grad.addColorStop(1, "rgba(200,215,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(0, -w * dpr); ctx.lineTo(L, 0); ctx.lineTo(0, w * dpr); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    // The long thin streak across the frame.
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot + 0.62);
    const sl = D * 0.6;
    const sg = ctx.createLinearGradient(-sl, 0, sl, 0);
    sg.addColorStop(0, "rgba(160,190,255,0)");
    sg.addColorStop(0.42, `rgba(200,220,255,${0.18 * k})`);
    sg.addColorStop(0.5, `rgba(255,255,255,${0.42 * k})`);
    sg.addColorStop(0.58, `rgba(255,220,190,${0.18 * k})`);
    sg.addColorStop(1, "rgba(255,190,150,0)");
    ctx.fillStyle = sg; ctx.fillRect(-sl, -1.2 * dpr, sl * 2, 2.4 * dpr);
    ctx.restore();

    // Core: a hot white point with a tight halo.
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, D * 0.05);
    core.addColorStop(0, `rgba(255,255,255,${Math.min(1, 1.1 * k)})`);
    core.addColorStop(0.12, `rgba(255,252,240,${0.85 * k})`);
    core.addColorStop(0.35, `rgba(255,236,205,${0.22 * k})`);
    core.addColorStop(1, "rgba(255,225,190,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, D * 0.05, 0, Math.PI * 2); ctx.fill();

    // Ghosts along the sun -> centre axis, sliding as the view moves.
    GHOSTS.forEach(([t, size, rgb, alpha, hex]) => {
      const gx = sx + (cx - sx) * (1 + t), gy = sy + (cy - sy) * (1 + t);
      const gr = D * size;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(${rgb},${alpha * 0.55 * k})`);
      g.addColorStop(0.75, `rgba(${rgb},${alpha * k})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      if (hex) poly(gx, gy, gr, 6, rot); else { ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); }
      ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  };
  requestAnimationFrame(frame);
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
startGlare();
