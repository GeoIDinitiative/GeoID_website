/**
 * Sun, sky, haze, and the two lights that make photographs read as lit.
 *
 * The sun is Everest's solar-position calculation (everest/game/sky.js), run
 * for wherever the aircraft is. Time is local MEAN SOLAR time — noon is when
 * the sun crosses the meridian — because what a pilot means by "late
 * afternoon over Catania" is the light, not the clock in Rome.
 *
 * ── Lighting a photograph ───────────────────────────────────────────────
 * The imagery already has light in it. If the scene adds its own on top, a
 * sunlit field comes out either washed or muddy. So the lights are balanced
 * every frame so that flat open ground in sun renders at ~1.0 × the photo:
 *
 *     hemisphere (sky) 0.45  +  sun × sin(elevation)  ≈  1.0
 *
 * three r165 divides diffuse by π, so both intensities carry a π. What the
 * scene contributes is then only what the photo cannot: relief turned to or
 * away from the sun, walls, and the shadows of buildings — which fall at 45 %.
 * Below ~26° the sun term is capped (a wall square to a low sun would
 * otherwise blow out), so late light dims open ground a little, as it does.
 */

import * as THREE from "../../../everest/vendor/three.module.js?v=84ebb99-a7f30c15";
import { sunPosition, sunVector } from "../../../everest/game/sky.js?v=84ebb99-a7f30c15";

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p;
    #include <logdepthbuf_vertex>
  }
`;
const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 sunDir;
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunTint;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
    if (h < 0.0) col = horizon * (1.0 + h * 1.5);
    float ca = max(dot(d, sunDir), 0.0);
    col += sunTint * (pow(ca, 1800.0) * 6.0 + pow(ca, 12.0) * 0.18 + pow(ca, 3.0) * 0.06);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunTint: { value: new THREE.Color() },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1e6, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, fog: false,
      }));
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    this.dome = dome;
    scene.add(dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8174, 1);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xbfd1e5, 1e-5);
    scene.fog = this.fog;

    this.dir = new THREE.Vector3(0, 1, 0);
    this.altitude = 45; this.azimuth = 180;
  }

  /** @param hour local mean solar time, 0..24 */
  set(lat, lon, hour, date = new Date()) {
    const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      + (hour - lon / 15) * 3600e3;
    const { altitude, azimuth } = sunPosition(new Date(utc), lat, lon);
    this.altitude = altitude; this.azimuth = azimuth;
    this.dir.copy(sunVector(altitude, azimuth));
    this.uniforms.sunDir.value.copy(this.dir);

    const s = Math.sin(altitude * Math.PI / 180);
    const day = THREE.MathUtils.smoothstep(altitude, -6, 4);          // twilight → day
    const low = 1 - THREE.MathUtils.smoothstep(altitude, 2, 25);      // golden hour

    const sunCol = new THREE.Color(1, 1, 1).lerp(new THREE.Color(1.0, 0.72, 0.46), low);
    const SKY = 0.45;
    const hemiK = SKY * day + 0.06;
    const sunK = altitude > 0 ? Math.min((1 - SKY) / Math.max(s, 0.05), 1.25) * day : 0;
    this.sun.color.copy(sunCol);
    this.sun.intensity = sunK * Math.PI;
    this.hemi.intensity = hemiK * Math.PI;
    this.hemi.color.setRGB(0.92, 0.96, 1.0).lerp(new THREE.Color(1.0, 0.86, 0.74), low * 0.5);
    this.sun.visible = altitude > -1;

    const zen = new THREE.Color(0.20, 0.42, 0.78).lerp(new THREE.Color(0.02, 0.03, 0.08), 1 - day);
    const hor = new THREE.Color(0.72, 0.81, 0.92)
      .lerp(new THREE.Color(0.95, 0.66, 0.45), low * 0.65)
      .lerp(new THREE.Color(0.05, 0.06, 0.10), 1 - day);
    this.uniforms.zenith.value.copy(zen);
    this.uniforms.horizon.value.copy(hor);
    this.uniforms.sunTint.value.copy(sunCol).multiplyScalar(day);
    this.fog.color.copy(hor);
  }

  /** Haze thins with height: ~35 km visibility at sea level, ~150 km from 10 km up. */
  follow(camera, altitude) {
    this.dome.position.copy(camera.position);
    const vis = 35e3 + Math.max(altitude, 0) * 12;
    this.fog.density = 1.58 / vis;
  }
}
