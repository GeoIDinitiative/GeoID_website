/**
 * The Martian sky, the Sun's position, and the light everything else uses.
 *
 * WHAT IS COMPUTED AND WHAT IS PAINTED
 *  - The Sun's direction is computed: local true solar time from the sol
 *    clock, declination from the areocentric solar longitude Ls and Mars'
 *    25.19 degree obliquity, at the site's latitude. (The equation of time
 *    and the orbit's eccentricity are ignored: the clock IS local true solar
 *    time, and the solar constant is the mean one.)
 *  - The direct beam is attenuated by Beer-Lambert through the dust:
 *    exp(-tau / mu), with mu = sin(elevation) floored by a curved-atmosphere
 *    term. tau is the column optical depth, a game-state variable.
 *  - The sky's COLOUR is painted to match what the rovers photograph: a
 *    butterscotch day sky, brighter and yellower toward the horizon, a bright
 *    forward-scattering aureole around a small Sun (0.35 degrees across), and
 *    at low sun the inversion Mars is known for: a blue glow around the Sun in
 *    a dim brown sky, because the dust forward-scatters blue. It is an
 *    artist's fit to those photographs, not a radiative-transfer solution.
 *  - Stars are a hash on the sky dome, not a catalogue. Phobos and Deimos
 *    are not drawn.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { MARS } from "./config.js?v=b8cfe8e-efa5b7b7";

const D2R = Math.PI / 180;

/** Sun position for a site latitude. tod = seconds since local midnight; ls in degrees. */
export function sunPosition(latDeg, tod, ls) {
  const hourAngle = (tod / MARS.solSeconds - 0.5) * 2 * Math.PI;          // 0 at local noon
  const decl = Math.asin(Math.sin(MARS.obliquityDeg * D2R) * Math.sin(ls * D2R));
  const lat = latDeg * D2R;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // azimuth clockwise from north
  const az = Math.atan2(-Math.cos(decl) * Math.sin(hourAngle),
    Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle));
  return { elevation: el / D2R, azimuth: ((az / D2R) + 360) % 360, sinEl };
}

/** Fraction of the top-of-atmosphere beam that reaches the ground directly. */
export function directTransmittance(sinEl, tau) {
  if (sinEl <= 0) return 0;
  const mu = sinEl + 0.025 * Math.exp(-11 * sinEl);      // keeps the air mass finite at the horizon
  return Math.exp(-tau / mu);
}

/**
 * Irradiance on a horizontal surface as a fraction of the solar constant:
 * direct beam plus the dust's diffuse light. The diffuse term is a fit (dust
 * scatters most of what it removes forward and down), good to a few tens of
 * percent against published Mars surface irradiance tables.
 */
export function surfaceIrradiance(sinEl, tau) {
  if (sinEl <= 0) return { direct: 0, diffuse: 0, total: 0 };
  const T = directTransmittance(sinEl, tau);
  const direct = sinEl * T;
  const diffuse = sinEl * (1 - T) * 0.62 * Math.exp(-0.12 * tau);
  return { direct, diffuse, total: direct + diffuse };
}

/** GLSL shared by the sky dome and the terrain's haze, so the far ground fades into the sky it is in front of. */
export const SKY_GLSL = /* glsl */`
  uniform vec3  uSunDir;        // toward the Sun
  uniform float uSunEl;         // sine of the Sun's elevation
  uniform float uTau;           // dust optical depth
  uniform float uDay;           // 1 full day .. 0 night
  uniform vec3  uSunTint;       // colour of the direct beam at the ground
  uniform float uTerraform;     // 0..1, the story's terraforming (game.sky.terraform; tiers.js): the painted sky turns bluer from the horizon up

  vec3 marsSky(vec3 dir) {
    float up = clamp(dir.y, -0.2, 1.0);
    float cosT = dot(dir, uSunDir);
    float dust = clamp(uTau / 1.2, 0.25, 2.2);
    // Day: butterscotch, paler and brighter at the horizon where the dust path is long.
    vec3 zen = vec3(0.50, 0.37, 0.25);
    vec3 hor = vec3(0.86, 0.66, 0.44);
    float hz = pow(1.0 - max(up, 0.0), 2.6);
    vec3 day = mix(zen, hor, hz) * mix(0.62, 1.0, clamp(dust, 0.0, 1.0));
    // Low sun: the whole sky dims and browns...
    float low = 1.0 - smoothstep(0.02, 0.38, uSunEl);
    vec3 dusk = mix(vec3(0.17, 0.13, 0.105), vec3(0.30, 0.215, 0.16), hz);
    vec3 sky = mix(day, dusk, low) * uDay;
    sky = mix(sky, vec3(0.34, 0.50, 0.74) * mix(0.62, 1.0, hz) * uDay * (1.0 - 0.6 * low), clamp(uTerraform, 0.0, 1.0) * (0.25 + 0.75 * hz));
    // ...and the aureole turns blue. Forward scattering: a tight lobe and a wide one.
    float c = max(cosT, 0.0);
    float tight = pow(c, 220.0 / dust), wide = pow(c, 14.0 / dust);
    vec3 glowDay = vec3(1.0, 0.93, 0.80);
    vec3 glowLow = vec3(0.36, 0.55, 0.95);
    vec3 glow = mix(glowDay, glowLow, low);
    float sunUp = smoothstep(-0.10, 0.03, uSunEl);
    sky += glow * (tight * 1.6 + wide * mix(0.42, 0.30, low)) * sunUp * mix(1.0, 0.7, low);
    // Heavy dust (storms): the whole sky, aureole included, darkens and reddens. Nothing changes below tau 1.
    sky *= mix(vec3(1.0), vec3(0.42, 0.29, 0.19), smoothstep(1.0, 5.0, uTau));
    // Twilight floor, so night is not black the instant the Sun sets.
    sky += vec3(0.006, 0.007, 0.011) * (1.0 - uDay);
    return sky;
  }
`;

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;        // on the far plane
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  ${SKY_GLSL}
  uniform float uExposure;

  float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 col = marsSky(dir);
    // The disc: 0.35 degrees across, i.e. 0.0031 rad in radius.
    float cosT = dot(dir, uSunDir);
    float disc = smoothstep(0.99999400, 0.99999560, cosT);
    col += uSunTint * disc * 60.0 * step(-0.01, dir.y);
    // Stars: a hash on a grid over the sphere, shown as the sky darkens.
    float night = 1.0 - uDay;
    if (night > 0.02 && dir.y > -0.02) {
      vec3 g = floor(dir * 190.0);
      float h = hash3(g);
      vec3 centre = (g + 0.5) / 190.0;
      float d = length(dir - normalize(centre)) * 190.0;
      float star = step(0.992, h) * smoothstep(0.26, 0.04, d) * (0.3 + 2.4 * hash3(g + 7.0));
      col += vec3(0.85, 0.9, 1.0) * star * night * exp(-uTau * 0.6) * smoothstep(-0.02, 0.15, dir.y);
    }
    // Below the horizon the dome is the haze colour: the terrain covers it anyway.
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`;

export class Sky {
  constructor(latDeg) {
    this.lat = latDeg;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunEl: { value: 1 },
      uTau: { value: 0.5 },
      uDay: { value: 1 },
      uSunTint: { value: new THREE.Color(1, 1, 1) },
      uExposure: { value: 1 },
      uTerraform: { value: 0 },          // HOOK (story / tiers.js): set through this.terraform
    };
    const geo = new THREE.IcosahedronGeometry(1, 4);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthTest: false, depthWrite: false,
    }));
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.sunDir = this.uniforms.uSunDir.value;
    this.sunColor = new THREE.Color();      // direct beam at the ground, linear, scene units
    this.ambSky = new THREE.Color();        // diffuse light from above
    this.ambGround = new THREE.Color();     // and bounced from below
    this.sun = { elevation: 90, azimuth: 0, sinEl: 1 };
    this.irradiance = { direct: 1, diffuse: 0, total: 1 };
  }

  /** @param clock {tod, ls}  @param tau dust optical depth */
  update(clock, tau) {
    const s = sunPosition(this.lat, clock.tod, clock.ls);
    this.sun = s;
    const az = s.azimuth * D2R, el = s.elevation * D2R;
    // azimuth 0 = north = -Z, 90 = east = +X
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const U = this.uniforms;
    U.uSunEl.value = s.sinEl;
    U.uTau.value = tau;
    U.uTerraform.value = this.terraform || 0;
    const day = THREE.MathUtils.smoothstep(s.sinEl, -0.16, 0.06);
    U.uDay.value = day;
    this.irradiance = surfaceIrradiance(s.sinEl, tau);
    const T = directTransmittance(s.sinEl, tau);
    // Beam colour: white-yellow high up; bluish and weak through a long dust path.
    const low = 1 - THREE.MathUtils.smoothstep(s.sinEl, 0.02, 0.38);
    const tint = new THREE.Color(1.0, 0.95, 0.86).lerp(new THREE.Color(0.62, 0.74, 1.0), low);
    U.uSunTint.value.copy(tint).multiplyScalar(Math.max(T, 0.02));
    // Scene units: chosen so sunlit ground at tau 0.5 sits near mid-grey before the tone curve.
    this.sunColor.copy(tint).multiplyScalar(2.3 * T);
    // Sky light on the ground: a Lambert surface under a sky of mean radiance L reflects albedo x L, so the
    // ambient term IS the sky model's mean colour (the same numbers marsSky() paints), not a separate guess.
    const dust = Math.min(1, Math.max(0.25, tau / 1.2));
    this.ambSky.setRGB(0.66, 0.50, 0.33).multiplyScalar(0.62 + 0.38 * dust).lerp(new THREE.Color(0.23, 0.215, 0.215), low).multiplyScalar(day);
    { const k = THREE.MathUtils.smoothstep(tau, 1.0, 5.0); this.ambSky.multiply(new THREE.Color(1 - 0.58 * k, 1 - 0.71 * k, 1 - 0.81 * k)); }   // the same storm darkening marsSky() paints
    this.ambSky.add(new THREE.Color(0.030, 0.034, 0.050));          // starlight, generously: never pitch black
    this.ambGround.setRGB(0.62, 0.42, 0.30).multiplyScalar(0.45).multiply(this.ambSky);
  }
}
