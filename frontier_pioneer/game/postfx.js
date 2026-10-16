/**
 * The post chain, trimmed from the Everest game's: an HDR buffer, optional
 * bloom, then exposure, the ACES tone curve and a light grade, in exactly one
 * place. Every material in the scene writes LINEAR light; nothing tonemaps
 * itself. (Everest's lowest tier skipped the chain and so skipped the tone
 * curve, which made it look different rather than cheaper: here every tier
 * runs the composite, and the cheap tiers drop bloom and render the scene at
 * a reduced scale.)
 *
 * Ambient occlusion is not ported: Everest's reconstructs position from a
 * linear depth buffer and this renderer's is logarithmic.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";

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

const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tBloom;
  uniform float bloomAmount, exposure, useBloom, saturation, contrast, vignette;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    if (useBloom > 0.5) c += texture2D(tBloom, vUv).rgb * bloomAmount;
    c *= exposure;
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);      // ACES fit
    c = clamp(c, 0.0, 1.0);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, saturation);
    c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
    vec2 q = vUv - 0.5;
    c *= 1.0 - vignette * dot(q, q) * 1.6;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

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
    this.compQuad = mk(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, bloomAmount: { value: 0.22 }, exposure: { value: 1.0 },
      useBloom: { value: 1 }, saturation: { value: 1.06 }, contrast: { value: 1.10 }, vignette: { value: 0.12 },
    });
    this.size = new THREE.Vector2(0, 0);
    this.targets = null;
  }

  set exposure(v) { this.compQuad.material.uniforms.exposure.value = v; }

  setSize(w, h, quality) {
    const W = Math.max(2, Math.round(w * quality.renderScale)), H = Math.max(2, Math.round(h * quality.renderScale));
    if (this.targets && this.size.x === W && this.size.y === H) return;
    this.size.set(W, H);
    if (this.targets) for (const k in this.targets) this.targets[k].dispose();
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const hdr = new THREE.WebGLRenderTarget(W, H, Object.assign({ depthBuffer: true, samples: quality.msaa ?? 0 }, opts));
    const q = (d) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(W / d)), Math.max(2, Math.round(H / d)), Object.assign({ depthBuffer: false }, opts));
    this.targets = { hdr, b1: q(4), b2: q(4) };
  }

  blit(quad, target) {
    this.scene.clear(); this.scene.add(quad);
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene, camera, quality) {
    const r = this.renderer, T = this.targets;
    r.setRenderTarget(T.hdr);
    r.clear();
    r.render(scene, camera);
    if (quality.bloom) {
      this.brightQuad.material.uniforms.tMap.value = T.hdr.texture;
      this.blit(this.brightQuad, T.b1);
      const b = this.blurQuad.material.uniforms;
      for (let i = 0; i < 2; i++) {
        b.tMap.value = T.b1.texture; b.dir.value.set(2 / T.b1.width, 0); this.blit(this.blurQuad, T.b2);
        b.tMap.value = T.b2.texture; b.dir.value.set(0, 2 / T.b1.height); this.blit(this.blurQuad, T.b1);
      }
    }
    const c = this.compQuad.material.uniforms;
    c.tScene.value = T.hdr.texture; c.tBloom.value = T.b1.texture; c.useBloom.value = quality.bloom ? 1 : 0;
    this.blit(this.compQuad, null);
  }
}
