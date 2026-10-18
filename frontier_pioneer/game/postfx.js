/**
 * The post chain, trimmed from the Everest game's: an HDR buffer, optional
 * bloom, then exposure, the ACES tone curve and a light grade, in exactly one
 * place. Every material in the scene writes LINEAR light; nothing tonemaps
 * itself. (Everest's lowest tier skipped the chain and so skipped the tone
 * curve, which made it look different rather than cheaper: here every tier
 * runs the composite, and the cheap tiers drop bloom and render the scene at
 * a reduced scale.)
 *
 * THE CINEMATIC LAYER (post.cine, set by the director in game/cinema.js every
 * frame of a cutscene, null otherwise):
 *   dof: { focus (m), fstop, lens (mm) }   thin-lens depth of field from the depth buffer. The renderer's
 *                       depth is logarithmic (z = 2^(d log2(far + 1)) - 1 recovers view depth exactly), so
 *                       no second depth pass. A circle of confusion per pixel, gathered on a golden-angle disc
 *                       (bokeh): Medium 12 taps at half resolution, High 22 at half, Ultra 32 at full; Low: none.
 *   grain               film grain (luminance-weighted, animated); the settings can turn it off
 *   vignette, exposure (a multiplier on the game's own; exposureAbs replaces it: interiors), temp (-1 cool .. 1 warm), tint, sat, con,
 *   lift / gamma / gain (vec3, LUT-like curves), bloom (a multiplier: it lowers the threshold, for the
 *                       Sun's disc, lamps, retro burns; Mars daylight never blooms)
 *   memory 0..1         the reconstructed-memory look: warm, a soft glow, scanlines, the frame's edges breaking
 *                       up into points, a touch of chromatic fringe
 *   vhs 0..1            archive tape: line jitter, colour bleed, tracking noise (C13's advert, C20's tape)
 *   ca                  chromatic aberration (glitches)
 * Settings: settings.dof and settings.grain (Settings > Game). Outside cutscenes nothing here costs more than
 * the grade's few multiplies.
 *
 * Ambient occlusion is not ported: Everest's reconstructs position from a
 * linear depth buffer and this renderer's is logarithmic.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

function fullscreen() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return g;
}

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BLUR_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tMap;
  uniform vec2 dir;
  void main() {
    vec4 c = texture2D(tMap, vUv) * 0.375;
    c += (texture2D(tMap, vUv + dir) + texture2D(tMap, vUv - dir)) * 0.25;
    c += (texture2D(tMap, vUv + dir * 2.0) + texture2D(tMap, vUv - dir * 2.0)) * 0.0625;
    gl_FragColor = c;
  }
`;

const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tMap;
  uniform float threshold, softness;
  void main() {
    vec3 c = min(texture2D(tMap, vUv).rgb, vec3(40.0));
    float l = max(c.r, max(c.g, c.b));
    float k = clamp((l - threshold + softness) / (2.0 * softness), 0.0, 1.0);
    float w = max(l - threshold, softness * k * k) / max(l, 0.0001);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

// circle of confusion (radius, full-resolution pixels; negative nearer than the focus) into alpha
const COC_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tDepth;
  uniform float logFar, focus, k, maxCoc;
  void main() {
    float d = texture2D(tDepth, vUv).x;
    float z = exp2(d * logFar) - 1.0;
    float coc = clamp(k * (z - focus) / max(z, 0.05), -maxCoc, maxCoc);
    gl_FragColor = vec4(texture2D(tScene, vUv).rgb, coc);
  }
`;
// the gather: a golden-angle disc; a sample counts where its own blur reaches this pixel, the near field
// spreads over the sharp ground behind it, the far field does not bleed onto what is in focus
const DOF_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tCoc;
  uniform vec2 px;
  uniform float taps, maxCoc;
  void main() {
    vec4 c0 = texture2D(tCoc, vUv);
    float r0 = abs(c0.a);
    vec3 acc = c0.rgb; float wsum = 1.0, near = max(0.0, -c0.a);
    const float GA = 2.39996323;
    // a per-pixel rotation of the disc: the few taps' banding becomes fine noise (grain hides it)
    float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
    for (int i = 1; i < 33; i++) {
      if (float(i) >= taps) break;
      float fi = float(i), r = sqrt((fi - 0.5 + 0.5 * fract(rot)) / taps) * maxCoc;
      vec4 s = texture2D(tCoc, vUv + vec2(cos(fi * GA + rot), sin(fi * GA + rot)) * r * px);
      float rs = abs(s.a);
      float reach = smoothstep(r - 1.5, r + 0.5, s.a < 0.0 ? rs : min(rs, r0 + 1.0));
      acc += s.rgb * reach; wsum += reach;
      near = max(near, s.a < 0.0 ? rs * reach : 0.0);
    }
    gl_FragColor = vec4(acc / wsum, max(r0, near));
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tBloom, tDof;
  uniform float bloomAmount, exposure, useBloom, saturation, contrast, vignette;
  uniform float useDof, grain, time, memory, vhs, ca;
  uniform vec3 wb, lift, gamma, gain;
  uniform vec2 res;
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 sceneAt(vec2 uv) {
    vec3 c = texture2D(tScene, uv).rgb;
    if (useDof > 0.5) { vec4 d = texture2D(tDof, uv); c = mix(c, d.rgb, smoothstep(0.6, 2.2, d.a)); }
    return c;
  }
  void main() {
    vec2 uv = vUv;
    if (vhs > 0.0) {
      float line = floor(uv.y * res.y / 2.0);
      uv.x += vhs * (h(vec2(line, floor(time * 24.0))) - 0.5) * 0.004 + vhs * 0.012 * smoothstep(0.97, 1.0, sin(uv.y * 3.0 - time * 1.3));
    }
    vec3 c;
    float fr = ca + memory * 0.0012 + vhs * 0.002;
    if (fr > 0.0) {
      vec2 q0 = (uv - 0.5) * fr;
      c = vec3(sceneAt(uv + q0).r, sceneAt(uv).g, sceneAt(uv - q0).b);
    } else c = sceneAt(uv);
    if (useBloom > 0.5) c += texture2D(tBloom, uv).rgb * bloomAmount * (1.0 + memory * 1.6);
    c *= exposure * wb;
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);      // ACES fit
    c = clamp(c, 0.0, 1.0);
    c = clamp(gain * (c + lift * (1.0 - c)), 0.0, 1.0);                // lift / gain
    c = pow(c, 1.0 / max(gamma, vec3(0.05)));                          // gamma
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, saturation);
    c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
    vec2 q = vUv - 0.5;
    c *= 1.0 - vignette * dot(q, q) * 1.6;
    if (memory > 0.0) {
      c *= 1.0 - memory * 0.07 * step(0.5, fract(vUv.y * res.y / 3.0));
      float edge = smoothstep(0.30, 0.5, max(abs(q.x) * 1.15, abs(q.y) * 1.25));
      float pts = h(floor(vUv * res / 3.0) + floor(time * 10.0));
      c = mix(c, c * step(0.55 + 0.4 * edge, pts) * 1.6, edge * memory);
      c = mix(c, c * vec3(1.08, 0.98, 0.86), memory * 0.5);
    }
    if (vhs > 0.0) {
      c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))) * vec3(1.05, 1.0, 0.92), vhs * 0.35);
      c += vhs * 0.05 * (h(vUv * res + time) - 0.5);
      c *= 1.0 - vhs * 0.12 * step(0.5, fract(vUv.y * res.y / 2.0));
    }
    if (grain > 0.0) {
      float n = h(vUv * res + fract(time * 7.13) * 100.0) + h(vUv * res * 1.7 - fract(time * 3.1) * 50.0) - 1.0;
      c += n * grain * (0.35 + 0.65 * (1.0 - l)) * 0.12;
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export const DEFAULT_CINE = { grain: 0, vignette: 0.12, exposure: 1, temp: 0, tint: 0, sat: 1.06, con: 1.10, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], bloom: 1, memory: 0, vhs: 0, ca: 0, dof: null };

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = fullscreen();
    this.scene = new THREE.Scene();
    const mk = (frag, uniforms) => {
      const m = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false }));
      m.frustumCulled = false;
      return m;
    };
    this.blurQuad = mk(BLUR_FRAG, { tMap: { value: null }, dir: { value: new THREE.Vector2() } });
    this.brightQuad = mk(BRIGHT_FRAG, { tMap: { value: null }, threshold: { value: 2.6 }, softness: { value: 0.6 } });
    this.cocQuad = mk(COC_FRAG, { tScene: { value: null }, tDepth: { value: null }, logFar: { value: 1 }, focus: { value: 10 }, k: { value: 0 }, maxCoc: { value: 12 } });
    this.dofQuad = mk(DOF_FRAG, { tCoc: { value: null }, px: { value: new THREE.Vector2() }, taps: { value: 22 }, maxCoc: { value: 12 } });
    this.compQuad = mk(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tDof: { value: null }, bloomAmount: { value: 0.22 }, exposure: { value: 1.0 },
      useBloom: { value: 1 }, saturation: { value: 1.06 }, contrast: { value: 1.10 }, vignette: { value: 0.12 },
      useDof: { value: 0 }, grain: { value: 0 }, time: { value: 0 }, memory: { value: 0 }, vhs: { value: 0 }, ca: { value: 0 },
      wb: { value: new THREE.Vector3(1, 1, 1) }, lift: { value: new THREE.Vector3() }, gamma: { value: new THREE.Vector3(1, 1, 1) }, gain: { value: new THREE.Vector3(1, 1, 1) },
      res: { value: new THREE.Vector2(1, 1) },
    });
    this.size = new THREE.Vector2(0, 0);
    this.targets = null;
    this._exposure = 1;
    /** set by the cinematic director every frame of a cutscene; null in play */
    this.cine = null;
    this.settings = { dof: true, grain: true };
    this.stats = { dof: false, taps: 0, grain: 0 };
    this._t0 = performance.now();
  }

  set exposure(v) { this._exposure = v; }
  get exposure() { return this._exposure; }

  setSize(w, h, quality) {
    const W = Math.max(2, Math.round(w * quality.renderScale)), H = Math.max(2, Math.round(h * quality.renderScale));
    const dofScale = (quality.dof || 0) >= 3 ? 1 : 0.5;
    if (this.targets && this.size.x === W && this.size.y === H && this._dofScale === dofScale) return;
    this.size.set(W, H); this._dofScale = dofScale;
    if (this.targets) for (const k in this.targets) this.targets[k].dispose();
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const hdr = new THREE.WebGLRenderTarget(W, H, Object.assign({ depthBuffer: true, samples: quality.msaa ?? 0 }, opts));
    hdr.depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);
    const q = (d) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(W / d)), Math.max(2, Math.round(H / d)), Object.assign({ depthBuffer: false }, opts));
    this.targets = { hdr, b1: q(4), b2: q(4), coc: q(1 / dofScale), dof: q(1 / dofScale) };
  }

  blit(quad, target) {
    this.scene.clear(); this.scene.add(quad);
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene, camera, quality) {
    const r = this.renderer, T = this.targets, C = this.cine || DEFAULT_CINE;
    r.setRenderTarget(T.hdr);
    r.clear();
    r.render(scene, camera);
    if (quality.bloom) {
      this.brightQuad.material.uniforms.threshold.value = 2.6 / Math.max(0.3, C.bloom ?? 1);
      this.brightQuad.material.uniforms.tMap.value = T.hdr.texture;
      this.blit(this.brightQuad, T.b1);
      const b = this.blurQuad.material.uniforms;
      for (let i = 0; i < 2; i++) {
        b.tMap.value = T.b1.texture; b.dir.value.set(2 / T.b1.width, 0); this.blit(this.blurQuad, T.b2);
        b.tMap.value = T.b2.texture; b.dir.value.set(0, 2 / T.b1.height); this.blit(this.blurQuad, T.b1);
      }
    }
    // depth of field: a cutscene asks for it, the tier allows it, the player has not turned it off
    const dof = !!(C.dof && (quality.dof || 0) > 0 && this.settings.dof !== false);
    this.stats.dof = dof;
    if (dof) {
      const W = T.hdr.width, H = T.hdr.height, f = (C.dof.lens || 35) / 1000, N = Math.max(0.7, C.dof.fstop || 2.8), s = Math.max(0.3, C.dof.focus || 10);
      // thin lens, blur radius on a 24 mm-high frame in pixels: 0.5 (f^2 / N) |z - s| / (z (s - f)) / 0.024 H
      const K = 0.5 * f * f / (N * Math.max(1e-3, s - f)) / 0.024 * H * (C.dof.boost || 1);
      const cu = this.cocQuad.material.uniforms, maxCoc = quality.dof >= 3 ? 16 : 12;
      cu.tScene.value = T.hdr.texture; cu.tDepth.value = T.hdr.depthTexture; cu.logFar.value = Math.log2(camera.far + 1); cu.focus.value = s; cu.k.value = K; cu.maxCoc.value = maxCoc;
      this.blit(this.cocQuad, T.coc);
      const du = this.dofQuad.material.uniforms, taps = quality.dof >= 3 ? 32 : quality.dof >= 2 ? 22 : 12;
      du.tCoc.value = T.coc.texture; du.px.value.set(1 / W, 1 / H); du.taps.value = taps; du.maxCoc.value = maxCoc;
      this.stats.taps = taps;
      this.blit(this.dofQuad, T.dof);
    }
    const c = this.compQuad.material.uniforms;
    c.tScene.value = T.hdr.texture; c.tBloom.value = T.b1.texture; c.tDof.value = T.dof.texture; c.useBloom.value = quality.bloom ? 1 : 0;
    c.useDof.value = dof ? 1 : 0;
    c.exposure.value = (C.exposureAbs || this._exposure) * (C.exposure ?? 1);
    c.saturation.value = C.sat ?? 1.06; c.contrast.value = C.con ?? 1.10; c.vignette.value = C.vignette ?? 0.12;
    c.grain.value = this.settings.grain !== false ? (C.grain || 0) : 0;
    this.stats.grain = c.grain.value;
    c.memory.value = C.memory || 0; c.vhs.value = C.vhs || 0; c.ca.value = C.ca || 0;
    const t = C.temp || 0, ti = C.tint || 0;
    c.wb.value.set(1 + 0.12 * t, 1 + 0.02 * t - 0.06 * ti, 1 - 0.14 * t);
    const L = C.lift || DEFAULT_CINE.lift, G = C.gamma || DEFAULT_CINE.gamma, N2 = C.gain || DEFAULT_CINE.gain;
    c.lift.value.set(L[0], L[1], L[2]); c.gamma.value.set(G[0], G[1], G[2]); c.gain.value.set(N2[0], N2[1], N2[2]);
    c.time.value = (performance.now() - this._t0) / 1000;
    c.res.value.set(T.hdr.width, T.hdr.height);
    this.blit(this.compQuad, null);
  }
}
