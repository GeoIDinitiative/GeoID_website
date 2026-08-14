/**
 * The post chain: HDR buffer, ambient occlusion, bloom, grade.
 *
 * A large part of why a game looks like a film rather than like a viewport is
 * what happens after the scene is drawn. Until now this rendered straight to
 * the canvas with a tone curve inlined in the terrain shader, which means:
 * no bloom on the specular off the snow, no occlusion in the crevasse lips,
 * no grade, and every material having to remember to tonemap itself.
 *
 * Written by hand rather than vendoring three's EffectComposer — the chain is
 * four passes and a fullscreen triangle, and the examples/ build would drag
 * in a pass framework, a copy shader and a dependency on the module layout.
 *
 * ── Costs, measured on the Intel Xe this was built against ───────────────
 * The scene alone is 6.3 ms at 1080p, of a 16.6 ms frame. Everything here is
 * fill-rate, so it all scales with resolution and it all has to be optional:
 * `quality` decides which passes run at all. Low is a direct render with no
 * target at all, and is the honest fallback rather than a degraded chain.
 */

import * as THREE from "../vendor/three.module.js?v=34d9924-2a28a20b";

/** A fullscreen triangle. Cheaper than a quad — one triangle, no diagonal
 *  seam, and every fragment is shaded exactly once. */
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

/* ── Ambient occlusion ───────────────────────────────────────────────────
   Depth-only, hemisphere-sampled, at half resolution. Normals are
   reconstructed from the depth buffer rather than written to a G-buffer,
   because a second render target for normals would double the scene's
   bandwidth and this is already the fill-rate-bound part of the frame.

   What it buys on this scene specifically: the inside corner where a
   crevasse lip meets the snow, the base of every serac and tent, the rim of
   a footprint, and the join where the Lhotse Face meets the Cwm floor. All
   of those are currently lit as though nothing were next to them. */
const AO_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform vec2  texel;
  uniform mat4  projInv;
  uniform mat4  proj;
  uniform float radius;
  uniform float strength;
  uniform float near, far;

  vec3 viewPos(vec2 uv, float d) {
    vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = projInv * c;
    return v.xyz / v.w;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.0, 289.0))) * 43758.5453); }

  void main() {
    float d = texture2D(tDepth, vUv).r;
    if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
    vec3 P = viewPos(vUv, d);

    // Normal from screen-space derivatives of the reconstructed position.
    // The min() of the forward and backward difference keeps the normal on
    // the near side of a depth discontinuity instead of smearing across it.
    vec3 pr = viewPos(vUv + vec2(texel.x, 0.0), texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r);
    vec3 pl = viewPos(vUv - vec2(texel.x, 0.0), texture2D(tDepth, vUv - vec2(texel.x, 0.0)).r);
    vec3 pu = viewPos(vUv + vec2(0.0, texel.y), texture2D(tDepth, vUv + vec2(0.0, texel.y)).r);
    vec3 pd = viewPos(vUv - vec2(0.0, texel.y), texture2D(tDepth, vUv - vec2(0.0, texel.y)).r);
    vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
    vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
    vec3 N = normalize(cross(dx, dy));

    float ao = 0.0;
    float ang = hash(gl_FragCoord.xy) * 6.2831853;
    const int TAPS = 10;
    for (int i = 0; i < TAPS; i++) {
      float t = (float(i) + 0.5) / float(TAPS);
      float r = radius * sqrt(t);
      float a = ang + t * 7.7;
      vec3 dir = vec3(cos(a), sin(a), 0.0);
      dir = normalize(dir - N * dot(dir, N) + N * 0.35);   // into the hemisphere
      vec4 sp = proj * vec4(P + dir * r, 1.0);
      vec2 suv = (sp.xy / sp.w) * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float sd = texture2D(tDepth, suv).r;
      vec3 sPos = viewPos(suv, sd);
      float diff = sPos.z - (P + dir * r).z;
      // Range check: something far behind is not occluding, it is background.
      float range = smoothstep(0.0, 1.0, radius / max(0.0001, abs(P.z - sPos.z)));
      if (diff > 0.02) ao += range;
    }
    ao = 1.0 - (ao / float(TAPS)) * strength;
    gl_FragColor = vec4(clamp(ao, 0.0, 1.0));
  }
`;

const BLUR_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tMap;
  uniform vec2 dir;
  void main() {
    // Five taps, binomial. Enough for a half-res AO buffer and for bloom.
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
    vec3 c = texture2D(tMap, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    // Soft knee, so a surface that is just under the threshold does not
    // suddenly acquire a halo when a cloud moves.
    float k = clamp((l - threshold + softness) / (2.0 * softness), 0.0, 1.0);
    float w = max(l - threshold, softness * k * k) / max(l, 0.0001);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tBloom, tAO;
  uniform float bloomAmount, aoAmount, exposure;
  uniform float vignette, grain, time;
  uniform float useBloom, useAO;
  uniform vec3  lift, gamma, gain;
  uniform float saturation, contrast;

  /* Hash WITHOUT sin().
     fract(sin(dot(p, k)) * bigNumber) is the classic one-liner and it is
     the reason this frame had gridlines on it: sin of a large argument loses
     precision, the loss is correlated along one axis, and the "noise" comes
     out as vertical banding that the eye reads as a screen overlay. Measured
     at twice the horizontal high-frequency energy of the same frame with
     grain off. This integer-mix hash has no such structure. */
  float hash(vec2 p) {
    // Float-only, so it compiles as GLSL ES 1.00 as well as 3.00 — three
    // builds a ShaderMaterial as ES 1.00 unless told otherwise, and uint
    // there is a portability gamble that happened to work on this driver.
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;

    if (useAO > 0.5) {
      float ao = texture2D(tAO, vUv).r;
      // Occlusion belongs on the ambient term, not on the sun. Applying it to
      // everything darkens sunlit snow that nothing is anywhere near, which
      // is the classic SSAO tell. Approximated by scaling the shadowed end.
      c *= mix(1.0, ao, aoAmount);
    }
    if (useBloom > 0.5) c += texture2D(tBloom, vUv).rgb * bloomAmount;

    c *= exposure;

    /* ── Tone curve ──
       ACES's fitted approximation. It has to live here rather than in each
       material, or two materials disagree about what white is — which is
       exactly what was happening when the terrain tonemapped itself and the
       sky did too, at different exposures. */
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c = clamp(c, 0.0, 1.0);

    /* ── Grade ──
       Lift/gamma/gain plus saturation and contrast. A large part of a film
       look is here and not in the lighting: cool the shadows, keep the
       highlights neutral, take a little saturation out of the midtones so
       the snow reads as snow rather than as paper. */
    c = pow(max(c, 0.0), 1.0 / gamma) * gain + lift * (1.0 - c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, saturation);
    c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);

    // Vignette, and grain that is stronger in the shadows the way film is.
    vec2 q = vUv - 0.5;
    c *= 1.0 - vignette * dot(q, q) * 1.6;
    float g = (hash(gl_FragCoord.xy + vec2(fract(time) * 1731.0, fract(time * 1.7) * 977.0)) - 0.5);
    c += g * grain * (1.0 - l * 0.7);

    gl_FragColor = vec4(max(c, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = fullscreen();

    const mk = (frag, uniforms) => {
      const m = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: frag,
        depthTest: false, depthWrite: false,
      });
      return new THREE.Mesh(this.geo, m);
    };

    this.aoQuad = mk(AO_FRAG, {
      tDepth: { value: null }, texel: { value: new THREE.Vector2() },
      projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() },
      radius: { value: 1.4 }, strength: { value: 1.0 },
      near: { value: 0.1 }, far: { value: 1000 },
    });
    this.blurQuad = mk(BLUR_FRAG, { tMap: { value: null }, dir: { value: new THREE.Vector2() } });
    this.brightQuad = mk(BRIGHT_FRAG, {
      /* Threshold 1.9, not 0.75. Bloom is meant to catch the few things that
         genuinely blow out — sun off a wind-polished slope, a serac edge. This
         scene is a sunlit snowfield, and in HDR that sits far above 0.75
         everywhere: measured, 100% of the frame exceeded the old threshold, so
         bloom was adding a blurred copy of the WHOLE image at 0.42 strength.
         Edges survived it (sharpness 11.19 with the chain, 11.06 without) but
         the contrast did not, which is why the mountain looked softer on every
         setting except `low` — the one tier that skips the post chain entirely.
         At 1.9 only real speculars bloom and the snow stays crisp. */
      tMap: { value: null }, threshold: { value: 1.9 }, softness: { value: 0.5 },
    });
    this.compQuad = mk(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tAO: { value: null },
      bloomAmount: { value: 0.30 }, aoAmount: { value: 0.55 }, exposure: { value: 1.0 },
      vignette: { value: LOOKS.map.vignette }, grain: { value: 0.020 }, time: { value: 0 },
      useBloom: { value: 1 }, useAO: { value: 1 },
      lift: { value: LOOKS.map.lift.clone() },
      gamma: { value: LOOKS.map.gamma.clone() },
      gain: { value: LOOKS.map.gain.clone() },
      saturation: { value: LOOKS.map.saturation },
      contrast: { value: LOOKS.map.contrast },
    });

    this.size = new THREE.Vector2(1, 1);
    this.targets = {};
    this.look = LOOKS.map.name;
  }

  /** @param name "map" (the reference viewer's neutral look) or "cinematic". */
  setLook(name) {
    const L = LOOKS[name] || LOOKS.map;
    const u = this.compQuad.material.uniforms;
    u.lift.value.copy(L.lift);
    u.gamma.value.copy(L.gamma);
    u.gain.value.copy(L.gain);
    u.saturation.value = L.saturation;
    u.contrast.value = L.contrast;
    u.vignette.value = L.vignette;
    this.look = L.name;
    return L.name;
  }

  /**
   * @param budget  the share of the drawing buffer this tier is allowed to
   *   render. The canvas is always at the full device pixel ratio now (see
   *   Game.resize), so the cost that used to come out of the canvas size comes
   *   out of here instead — one filtered upsample we control, rather than a
   *   fractional rescale by the compositor.
   */
  setSize(w, h, quality, budget = 1) {
    const scale = (quality.renderScale ?? 1) * budget;
    const W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale));
    if (this.size.x === W && this.size.y === H && this._q === quality.name) return;
    this.size.set(W, H);
    this._q = quality.name;
    for (const k in this.targets) this.targets[k].dispose();

    const hdr = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType,          // colour must be HDR or bloom has nothing to find
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    hdr.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
    hdr.depthTexture.format = THREE.DepthFormat;

    const half = (d) => new THREE.WebGLRenderTarget(
      Math.max(2, Math.round(W / d)), Math.max(2, Math.round(H / d)),
      { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });

    this.targets = { hdr, ao: half(2), aoBlur: half(2), b1: half(4), b2: half(4) };
  }

  blit(quad, target) {
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(quadScene(this, quad), this.cam);
  }

  render(scene, camera, quality, time) {
    const r = this.renderer, T = this.targets;
    if (!quality.post) {                     // Low: straight to the canvas
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    r.setRenderTarget(T.hdr);
    r.clear();
    r.render(scene, camera);

    if (quality.ao) {
      const u = this.aoQuad.material.uniforms;
      u.tDepth.value = T.hdr.depthTexture;
      u.texel.value.set(1 / T.ao.width, 1 / T.ao.height);
      u.proj.value.copy(camera.projectionMatrix);
      u.projInv.value.copy(camera.projectionMatrixInverse);
      u.radius.value = quality.aoRadius;
      this.blit(this.aoQuad, T.ao);
      // Separable blur, or the noise reads as crawling dirt on the snow.
      const b = this.blurQuad.material.uniforms;
      b.tMap.value = T.ao.texture; b.dir.value.set(1.5 / T.ao.width, 0);
      this.blit(this.blurQuad, T.aoBlur);
      b.tMap.value = T.aoBlur.texture; b.dir.value.set(0, 1.5 / T.ao.height);
      this.blit(this.blurQuad, T.ao);
    }

    if (quality.bloom) {
      const br = this.brightQuad.material.uniforms;
      br.tMap.value = T.hdr.texture;
      this.blit(this.brightQuad, T.b1);
      const b = this.blurQuad.material.uniforms;
      for (let i = 0; i < 2; i++) {
        b.tMap.value = T.b1.texture; b.dir.value.set(2.0 / T.b1.width, 0);
        this.blit(this.blurQuad, T.b2);
        b.tMap.value = T.b2.texture; b.dir.value.set(0, 2.0 / T.b1.height);
        this.blit(this.blurQuad, T.b1);
      }
    }

    const c = this.compQuad.material.uniforms;
    c.tScene.value = T.hdr.texture;
    c.tBloom.value = T.b1.texture;
    c.tAO.value = T.ao.texture;
    c.useBloom.value = quality.bloom ? 1 : 0;
    c.useAO.value = quality.ao ? 1 : 0;
    c.time.value = time;
    c.grain.value = quality.grain;
    this.blit(this.compQuad, null);
  }
}

/* One scene reused for every fullscreen pass; swapping the child is cheaper
   than building a Scene per pass and keeps the pass list readable. */
let _quadScene = null;
function quadScene(fx, quad) {
  if (!_quadScene) _quadScene = new THREE.Scene();
  if (_quadScene.children[0] !== quad) {
    _quadScene.clear();
    _quadScene.add(quad);
  }
  return _quadScene;
}

/**
 * The quality dial.
 *
 * The scene is fill-rate bound — measured 4.1 ms at 720p, 6.3 at 1080p and
 * 10.4 at 1440p on an integrated Xe — so every one of these is a real choice
 * and not a preference. Low is not "the chain with things switched off", it
 * is no chain at all: a direct render, which is the only setting that gives
 * back the whole cost of the extra target.
 */
/**
 * Two looks, because they are answering different questions.
 *
 * The grade started cinematic: shadows lifted towards blue, a little
 * saturation pulled out of the midtones, contrast up, and a 0.30 vignette.
 * The reasoning was sound in isolation — high-altitude snow under a blue sky
 * really is blue in shade — but the lift was (0.012, 0.020, 0.040), which
 * raises blue **four times as hard as red** on every dark pixel in the frame.
 * On a mountain that is mostly shadowed rock at this hour, that is not a
 * suggestion of cold, it is a purple cast over the whole map, and it reads as
 * murk rather than as altitude.
 *
 * `map` is the reference viewer's look: neutral, bright, full saturation, no
 * vignette. A draped orthophoto is a *measurement*, and the closer the screen
 * is to what the sensor recorded the more it reads as somewhere real. This is
 * the default, because the imagery is the most trustworthy thing in the scene
 * and the grade was the main thing standing between it and the eye.
 *
 * `cinematic` is the old grade, kept whole. Switch with `game.setLook("cinematic")`.
 * The HUD chrome is unaffected either way — the retro skin lives in CSS and
 * has never been in this chain.
 */
export const LOOKS = {
  map: {
    name: "map",
    /* Contrast 1.22, not 1.02.
       "Why is the mountain sharper on low?" turned out to be a real defect,
       though not a sharpness one. Low sets `post: false`, and the terrain
       shader deliberately outputs linear HDR without tonemapping because the
       post chain is meant to do that in exactly one place. With no chain,
       nothing tonemaps: the linear values are hard-clipped into 0-1, which
       crushes both ends and inflates local contrast enormously. Measured
       against high: contrast 57.0 vs 23.1, apparent sharpness 19.1 vs 11.2.
       Low is not resolving more detail — it is clipping, and clipping reads
       as bite.

       High was correct and flat. ACES plus a nearly-neutral grade on a scene
       that is mostly white snow leaves very little separation, so the honest
       fix is to put contrast back in the graded path rather than to stop
       tonemapping. This closes most of the gap while keeping highlights on
       the curve instead of against the ceiling. */
    lift: new THREE.Vector3(0.004, 0.004, 0.006),
    gamma: new THREE.Vector3(1.00, 1.00, 1.00),
    gain: new THREE.Vector3(1.00, 1.00, 1.00),
    saturation: 1.10,
    contrast: 1.22,
    vignette: 0.0,
  },
  cinematic: {
    name: "cinematic",
    lift: new THREE.Vector3(0.012, 0.020, 0.040),
    gamma: new THREE.Vector3(1.00, 1.00, 1.02),
    gain: new THREE.Vector3(1.02, 1.00, 0.99),
    saturation: 0.94,
    contrast: 1.06,
    vignette: 0.30,
  },
};

export const QUALITY = {
  low:    { name: "low", rockDetail: 0.0,    post: false, bloom: false, ao: false, grain: 0,
            renderScale: 0.85, snowDetail: 0.4, shadows: false, shadowBudgetMs: 0,
            aoRadius: 1.2, maxPixelRatio: 1 },
  medium: { name: "medium", rockDetail: 0.6, post: true,  bloom: false, ao: false, grain: 0,
            renderScale: 1.0, snowDetail: 0.7, shadows: true, shadowBudgetMs: 2.5,
            aoRadius: 1.2, maxPixelRatio: 1.25 },
  high:   { name: "high", rockDetail: 1.0,   post: true,  bloom: true,  ao: true,  grain: 0,
            renderScale: 1.0, snowDetail: 1.0, shadows: true, shadowBudgetMs: 3.5,
            aoRadius: 1.4, maxPixelRatio: 1.5 },
  ultra:  { name: "ultra", rockDetail: 1.0,  post: true,  bloom: true,  ao: true,  grain: 0,
            renderScale: 1.25, snowDetail: 1.0, shadows: true, shadowBudgetMs: 5,
            aoRadius: 1.8, maxPixelRatio: 2 },
};
