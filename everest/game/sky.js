/**
 * Sky, sun and the light that comes off both.
 *
 * The sun is a real solar-position calculation for Everest's latitude and
 * longitude rather than a lamp on a circle, because the whole shape of a
 * summit day comes from it: you leave the South Col around 23:00 so that you
 * are on the Balcony when it gets light, and you turn around at a fixed hour
 * whether or not you are close, because being up there in the dark is what
 * kills people. A game where the sun rises at an arbitrary time cannot have
 * that conversation with the player.
 *
 * Nepal keeps UTC+5:45, which is not a joke and is why sunrise here lands at
 * a time that looks wrong if you assume a whole-hour zone.
 */

import * as THREE from "../vendor/three.module.js?v=cbbe893-1efb96f0";
import { ORIGIN } from "./config.js?v=cbbe893-1efb96f0";

export const NEPAL_UTC_OFFSET_H = 5.75;

/**
 * Solar altitude and azimuth, NOAA's algorithm, good to about a minute of
 * arc — far better than anything here needs, but it is short and it means
 * the answer is right rather than plausible.
 * @param date  a Date (UTC internally)
 */
export function sunPosition(date, lat = ORIGIN.lat, lon = ORIGIN.lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;                 // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;         // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;                // obliquity

  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));

  // Greenwich mean sidereal time → local hour angle
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  let ha = lst - ra;
  while (ha < -Math.PI) ha += 2 * Math.PI;
  while (ha > Math.PI) ha -= 2 * Math.PI;

  const phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec)
                      + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha),
                        Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { altitude: alt / rad, azimuth: ((az / rad) + 360) % 360 };
}

/**
 * The moon, to low precision — good to about a degree, which is far better
 * than anything here needs and is the difference between a night you can
 * walk in and a black screen.
 *
 * It matters for a reason beyond looking nice: summit day starts at
 * something like eleven at night, and whether there is a moon decides
 * whether the Triangular Face is a slope you can see or a rope you follow
 * by torchlight. Expeditions genuinely plan around it.
 */
export function moonPosition(date, lat = ORIGIN.lat, lon = ORIGIN.lon) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  // Mean elements, then the two largest periodic terms. Anything more is
  // invisible at this scale.
  const L = (218.316 + 13.176396 * d) * rad;        // mean longitude
  const M = (134.963 + 13.064993 * d) * rad;        // mean anomaly
  const F = (93.272 + 13.229350 * d) * rad;         // argument of latitude
  const lambda = L + 6.289 * rad * Math.sin(M);
  const beta = 5.128 * rad * Math.sin(F);
  const eps = 23.439 * rad;

  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps)
            + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));

  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let ha = (gmst * 15 + lon) * rad - ra;
  while (ha < -Math.PI) ha += 2 * Math.PI;
  while (ha > Math.PI) ha -= 2 * Math.PI;

  const phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec)
            + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha),
                        Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));

  /* Illuminated fraction, from the elongation between moon and sun. New moon
     is 0 and full is 1, and the light scales with it — which is why a summit
     night can be bright enough to leave the torch off, or not. */
  const sunLambda = (280.460 + 0.9856474 * d) * rad;
  const elong = Math.acos(Math.cos(beta) * Math.cos(lambda - sunLambda));
  const phase = (1 - Math.cos(elong)) / 2;

  return { altitude: alt / rad, azimuth: ((az / rad) + 360) % 360, phase };
}

/** Local-frame unit vector toward the sun (+x east, +y up, +z south). */
export function sunVector(alt, az) {
  const a = alt * Math.PI / 180, b = az * Math.PI / 180;
  const c = Math.cos(a);
  return new THREE.Vector3(c * Math.sin(b), Math.sin(a), -c * Math.cos(b));
}

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Sky is drawn at the far plane with the camera's translation removed, so
    // it can never be walked into or clipped by the near plane.
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3  sunDir;
  uniform vec3  zenith, horizon, ground;
  uniform vec3  sunTint;
  uniform float sunIntensity;
  uniform float starAmount;
  uniform float haze;         // weather: cloud closing in
  uniform float time;

  // Cheap hash-based starfield — no texture. STATIC by request: the
  // twinkle term made the whole field flicker, so each star holds a
  // fixed brightness (hash-varied so the field still has depth).
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float stars(vec3 d) {
    vec3 g = floor(d * 340.0);
    float h = hash(g);
    if (h < 0.9972) return 0.0;
    float mag = 0.55 + 0.45 * hash(g + 17.0);
    return smoothstep(0.9972, 1.0, h) * mag;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = d.y;

    /* The ramp has to run all the way to the zenith. A steeper one
       (up*1.6 + 0.12) saturates about 33° up, so everything above that is a
       single flat colour and the boundary reads as a large dark disc printed
       on the sky — which is exactly what it looked like. */
    float t = pow(clamp(up, 0.0, 1.0), 0.55);
    vec3 col = mix(horizon, zenith, t);
    if (up < 0.0) col = mix(horizon, ground, clamp(-up * 3.0, 0.0, 1.0));

    // The sun's disc and the glow around it. At 8,800 m there is a third of
    // the air, so the glow is tight and the sky above it is nearly black.
    float ca = dot(d, sunDir);
    float disc = smoothstep(0.99975, 0.99992, ca);
    float glow = pow(max(ca, 0.0), 220.0) * 0.6 + pow(max(ca, 0.0), 12.0) * 0.09;
    col += sunTint * (disc * 14.0 + glow) * sunIntensity;

    col += vec3(1.0) * stars(d) * starAmount * step(0.0, up);

    col = mix(col, mix(horizon, zenith, 0.4), haze * 0.85);

    // Linear HDR out; the composite pass tonemaps. The sun's disc is left
    // far above 1.0 on purpose — that is what bloom is for.
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor() {
    this.uniforms = {
      sunDir:       { value: new THREE.Vector3(0, 1, 0) },
      zenith:       { value: new THREE.Color() },
      horizon:      { value: new THREE.Color() },
      ground:       { value: new THREE.Color() },
      sunTint:      { value: new THREE.Color() },
      sunIntensity: { value: 1 },
      starAmount:   { value: 0 },
      haze:         { value: 0 },
      time:         { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }));
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = "sky";

    /** What the rest of the world should light itself with. */
    this.sun = { dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(), altitude: 0, azimuth: 0 };
    this.skyLight = new THREE.Color();
    this.fog = new THREE.Color();
  }

  /**
   * @param date   simulated clock (a real Date, in UTC)
   * @param cloud  0 clear .. 1 in the middle of a storm
   */
  update(date, cloud = 0, elapsed = 0) {
    const { altitude, azimuth } = sunPosition(date);
    const dir = sunVector(altitude, azimuth);
    this.sun.altitude = altitude;
    this.sun.azimuth = azimuth;
    this.sun.dir.copy(dir);

    // How much atmosphere the light is coming through. Below the horizon it
    // is twilight rather than off — on a mountain that is most of the summit
    // push, and the snow stays legible in it.
    const a = altitude;
    const day = clamp01((a + 3) / 9);
    const civil = clamp01((a + 12) / 12);

    // Reddening near the horizon: a long path takes the blue out.
    const warm = Math.pow(1 - clamp01((a + 4) / 22), 2.2);
    const sunCol = new THREE.Color().setRGB(
      1.0,
      lerp(1.0, 0.42, warm),
      lerp(0.97, 0.16, warm),
    );
    /* Sunlight on snow is not scaled to "as bright as possible". Snow's
       albedo is around 0.9 and the imagery it multiplies is already near
       white, so driving this above 1 puts every sunlit face past the top of
       the tone curve — which is uniform white, and uniform white has no
       shape. The whole of the mountain's form is carried by shadow, so the
       sunlit end has to sit below saturation to leave room for it. */
    const intensity = lerp(0.0, 1.0, day) * lerp(1, 0.35, cloud);
    this.sun.color.copy(sunCol).multiplyScalar(intensity * 0.92);

    /* Sky. Thin air gives a deep, saturated zenith — the famous near-black
       blue in summit photographs — but the first version took that too
       literally and painted a clear day the colour of dusk. Anyone standing
       on a glacier on a clear morning is under a *bright* sky: the zenith is
       a strong blue, not a dark one, and the horizon is nearly white with
       scattered light off the snow. The near-black only arrives in the last
       thousand metres, so it is driven by the tone curve at the top of the
       dome rather than by starting dark. */
    const zen = new THREE.Color().setRGB(0.13, 0.33, 0.86)
      .lerp(new THREE.Color(0.010, 0.014, 0.055), 1 - civil);
    const hor = new THREE.Color().setRGB(0.78, 0.88, 1.00)
      .lerp(new THREE.Color(0.98, 0.58, 0.30), warm * day)
      .lerp(new THREE.Color(0.02, 0.03, 0.09), 1 - civil);
    const grd = hor.clone().multiplyScalar(0.60);

    /* Cloud over a glacier is BRIGHT. This is the single most counter-
       intuitive thing about weather up here and the first version got it
       backwards: it dimmed everything, so a storm rendered as dusk. What
       actually happens is that the sun goes and the entire sky becomes one
       enormous diffuse source, bouncing between cloud and snow until there
       is light coming from every direction at once and no shadow anywhere.
       That is what a whiteout *is* — not darkness, but so much flat light
       that the ground and the air are the same colour and you cannot see the
       slope you are standing on. So: directional light down, ambient up. */
    const cloudGrey = new THREE.Color(0.82, 0.84, 0.88).multiplyScalar(lerp(1, 0.30, 1 - civil));
    zen.lerp(cloudGrey, cloud * 0.92);
    hor.lerp(cloudGrey, cloud * 0.96);

    this.uniforms.sunDir.value.copy(dir);
    this.uniforms.zenith.value.copy(zen);
    this.uniforms.horizon.value.copy(hor);
    this.uniforms.ground.value.copy(grd);
    this.uniforms.sunTint.value.copy(sunCol);
    this.uniforms.sunIntensity.value = lerp(0.05, 1, day) * lerp(1, 0.08, cloud);
    this.uniforms.starAmount.value = clamp01(1 - civil * 1.15) * lerp(1, 0.05, cloud);
    this.uniforms.haze.value = cloud;
    this.uniforms.time.value = elapsed;

    // Ambient: the sky itself, plus an enormous bounce off the snow. On a
    // glacier the light from below is a real and large term — it is what
    // sunburns the roof of your mouth.
    this.skyLight.copy(hor).lerp(zen, 0.35)
      .multiplyScalar(lerp(0.10, 0.62, civil) * (1 + cloud * 0.55));
    this.fog.copy(hor).lerp(zen, 0.18).lerp(cloudGrey, cloud * 0.8);

    /* ── Moonlight ──────────────────────────────────────────────────────
       Once the sun is well down the scene's one directional light becomes
       the moon: the same term at a fraction of the strength, and blue,
       because everything at night is blue to a dark-adapted eye. The disc in
       the dome follows it, so there is something up there to see.

       **This has to come after the uniforms above, not before**, or those
       assignments overwrite it and the moon silently does nothing.

       Below the horizon, or at new moon, there is only starlight — and then
       the torch is the only answer, which is the point of having one. */
    const moon = moonPosition(date);
    this.moon = moon;
    const moonUp = clamp01((moon.altitude + 2) / 8);
    const takeover = clamp01(-(a + 2) / 6);          // how far the sun is down
    const moonLight = moonUp * moon.phase * takeover;
    this.moonlight = moonLight;
    if (moonLight > 0.002) {
      const md = sunVector(moon.altitude, moon.azimuth);
      this.sun.dir.lerp(md, takeover).normalize();
      this.sun.color.add(_moonTint.setRGB(0.20, 0.26, 0.42).multiplyScalar(moonLight));
      this.uniforms.sunDir.value.copy(this.sun.dir);
      this.uniforms.sunTint.value.lerp(_moonDisc.setRGB(0.88, 0.92, 1.0), takeover);
      this.uniforms.sunIntensity.value = Math.max(
        this.uniforms.sunIntensity.value, 0.5 * moonUp * (0.25 + 0.75 * moon.phase));
    }
    // Starlight and moonlight on snow, for the shader's night ambient.
    this.nightLight = 0.10 + 0.90 * moonLight;
  }
}

const _moonTint = new THREE.Color();
const _moonDisc = new THREE.Color();

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
