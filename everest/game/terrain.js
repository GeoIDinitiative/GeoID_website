/**
 * The ground, as a geometry clipmap: nine nested square levels centred on the
 * player, each level twice the cell size and twice the reach of the one
 * inside it. Four metres under your boots, a kilometre out at the horizon.
 *
 * ── Why rings and not nested full grids ──────────────────────────────────
 * Nested full grids are far simpler and were tried first. They cannot work
 * here: a 1024 m grid interpolates straight across the Western Cwm, so its
 * surface sits *above* the true valley floor, and drawing it under the fine
 * level puts a lid over the whole valley at about 7,000 m. A coarse level
 * must not exist where a fine one covers, hence the hole.
 *
 * ── Why the holes always line up ─────────────────────────────────────────
 * Level i snaps its centre to a multiple of 2·sᵢ. Since sᵢ₊₁ = 2·sᵢ, every
 * such multiple is also on level i+1's vertex lattice — so a child's boundary
 * always falls exactly on parent grid lines, and the parent's hole is always
 * a whole number of parent cells. The child can still be up to one parent
 * cell off-centre in the hole, so the hole's position is recomputed (and the
 * index buffer refilled) whenever it moves, which for the coarse levels is
 * hundreds of metres of walking apart.
 *
 * ── Why there are no cracks ──────────────────────────────────────────────
 * The outer 20% of every level morphs its height toward what its *parent*
 * would have drawn there, reaching it exactly at the edge. At the boundary
 * the child's midpoint vertices therefore sit at the average of the two
 * parent vertices either side — which is precisely where the parent's own
 * triangle edge runs. The surfaces are coincident, so there is nothing to
 * crack. It also kills the pop when a level re-snaps, for free.
 */

import * as THREE from "../vendor/three.module.js?v=05c6ecf-cd980f5f";
import { CLIPMAP, RENDER } from "./config.js?v=05c6ecf-cd980f5f";

const { levels: LEVELS, cells: N, baseCell: BASE } = CLIPMAP;
const VERTS = N + 1;
/** Guard cells sampled around every level so a central difference at the
 *  edge of the drawn grid still has both of its neighbours. */
const AP = 2;
/** Where the blend toward the parent's surface begins, as a fraction of the
 *  level's half-extent. */
const MORPH_START = 0.78;
/** The cell size, in metres, beyond which a level must low-pass the height
 *  field before sampling it (see resample). Twice the elevation model's real
 *  ~17 m resolution: cells finer than this are at or below the data's own
 *  scale and read the field directly; cells coarser are sampling above
 *  Nyquist and must filter first or the fold IS the vertical striping. */
const NRM_STEP = 32;

/* ── The shader ──────────────────────────────────────────────────────────*/

const VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float morph;          // 0 in the interior, 1 at this level's edge
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vMorph;
  varying float vDist;
  varying float vDetail;

  uniform sampler2D detailMap;
  uniform vec4  detailBounds;
  uniform float detailRange;
  uniform float detailOn;

  /* Relief the elevation model does not have, recovered from the imagery —
     see photoclino.js. Decoded from a 16-bit fixed point in RG, scaled by the
     confidence in B.

     Displacing here rather than only perturbing the normal in the fragment
     shader is the entire point: a normal makes a flat surface *look* bumpy
     from one angle, geometry breaks the skyline and occludes things. It is
     also crack-free across clipmap levels for free — the lookup is by world
     position, so a vertex shared by two levels gets one answer regardless of
     which level is asking. */
  float detailAt(vec2 world) {
    if (detailOn <= 0.0) return 0.0;
    vec2 uv = (world - detailBounds.xy) / detailBounds.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
    vec4 t = texture2D(detailMap, uv);
    float hgt = ((t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * 2.0 - 1.0) * detailRange;
    // Fade at the edge of the source imagery, or the displacement ends in a
    // step that reads as a wall running along nothing.
    vec2 e = min(uv, 1.0 - uv);
    float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
    return hgt * t.b * edge * detailOn;
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDetail = detailAt(wp.xz);
    wp.y += vDetail;
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vMorph = morph;
    vec4 mv = viewMatrix * wp;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D map_vast, map_far, map_mid, map_near, map_ultra;
  uniform vec4 bounds_vast, bounds_far, bounds_mid, bounds_near, bounds_ultra;

  uniform vec3  sunDir;          // toward the sun, normalised
  uniform vec3  sunColor;
  uniform vec3  skyColor;
  uniform vec3  fogColor;
  uniform float fogDensity;      // 1/metres
  uniform float fogHeightFalloff;
  uniform float whiteout;        // 0 clear .. 1 cannot see your own feet
  uniform float snowFall;        // fresh snow lying, 0..1
  uniform float microRelief;     // strength of the imagery-derived detail
  uniform float exposure;
  uniform float time;
  uniform vec3  cameraPosW;

  /* Where the glacier is torn open. The terrain is a continuous surface and
     a clipmap cannot have a hole cut in its geometry cheaply, so the hole is
     cut in the fragment stage instead: a 1 m/px mask over the ground near the
     player, painted by glacier.js, and anything inside a crevasse is
     discarded so the trench walls behind it are what you see. */
  uniform sampler2D crevasseMask;
  uniform vec4  crevasseBounds;
  uniform float crevasseOn;

  /* The head torch. The terrain runs its own material and never sees a
     three.js light, so the lamp has to be a term in here — and it is the
     only light there is between about eight in the evening and five in the
     morning, which is most of a summit push. */
  uniform vec3  lampPos;
  uniform vec3  lampDir;         // where it points, normalised
  uniform vec3  lampColour;
  uniform float lampIntensity;   // 0 when off
  uniform float lampCosInner, lampCosOuter;
  uniform float lampRange;

  /* Starlight and moonlight, so that a clear night is navigable and a
     clouded one is not. Snow under a half moon is genuinely enough to walk
     on; this is what stops "night" meaning "a black screen". */
  uniform vec3  nightSky;

  /* The live snow surface: R trodden, G drifted, B unused. 0.25 m per pixel
     over 256 m around the player, written by snowfield.js. */
  uniform sampler2D snowField;
  uniform vec4  snowFieldBounds;
  uniform float windPhase;      // metres the sastrugi have advected
  uniform vec2  windAxis;       // unit, direction the wind blows
  uniform float snowDetail;     // 0..1 quality dial
  uniform float rockDetail;     // 0..1 — the rock material on steep ground

  /* Terrain self-shadowing. horizonMap holds, per point, the sine of the
     elevation angle of the highest ground along the sun's bearing; a point
     is in shadow when the sun is below it. One fetch, no cascades. */
  uniform sampler2D horizonMap;
  uniform vec4  horizonBounds;
  uniform float sunSin;         // sine of the sun's altitude
  uniform float shadowsOn;

  /* De-lighting: where the sun was when the imagery was taken (estimated at
     boot by correlating the picture against the elevation model). */
  uniform vec3  captureSun;
  uniform float delightAmount;
  uniform float delightFloor;
  uniform float meanAlbedo;

  varying vec3  vWorld;
  varying vec3  vNormal;
  varying float vMorph;
  varying float vDist;
  varying float vDetail;

  uniform sampler2D detailMap;
  uniform vec4  detailBounds;
  uniform float detailRange;
  uniform float detailOn;
  uniform float debugMode;   // 0 normal, 1 shape only, 2 picture only, 3 coarse tier
  uniform sampler2D moraineTex;
  uniform float moraineOn;
  uniform sampler2D snowTex;
  uniform float snowTexOn;
  uniform sampler2D boulderTex;
  uniform float boulderOn;
  uniform float dayLight;       // 0 night .. 1 day, from solar altitude
  uniform float basemapMode;    // 0 real, 1 hillshade, 2 slope, 3 contours, 4 risk
  uniform sampler2D routeMask;
  uniform vec4 routeMaskBounds;
  uniform float routeOn;

  /* Same decode as the vertex shader — the surface was displaced there, so the
     normal has to be built from the same field or the relief only exists in
     silhouette and vanishes the moment light hits it. */
  float detailAt(vec2 world) {
    if (detailOn <= 0.0) return 0.0;
    vec2 uv = (world - detailBounds.xy) / detailBounds.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
    vec4 t = texture2D(detailMap, uv);
    float hgt = ((t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * 2.0 - 1.0) * detailRange;
    vec2 e = min(uv, 1.0 - uv);
    return hgt * t.b * smoothstep(0.0, 0.06, min(e.x, e.y)) * detailOn;
  }

  /* UV into a tier's canvas, plus how far inside it this point is (in metres),
     which is what fades one tier into the next instead of stepping. */
  vec3 tierUV(vec4 b, vec3 p) {
    vec2 uv = vec2((p.x - b.x) / b.z, (p.z - b.y) / b.w);
    vec2 d = min(uv, 1.0 - uv) * b.zw;      // metres to the nearest edge
    return vec3(uv, min(d.x, d.y));
  }

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  /* Value noise on world XZ, for the last few metres.
     Half-metre imagery is the finest thing that exists for this mountain and
     it still cannot describe the ground you are standing on: at eye height
     the snow two metres in front of you is seen at a grazing angle, so one
     texel covers several metres of screen and the foreground renders as a
     smooth grey ramp. Snow underfoot is sastrugi, wind ripple and boot
     track — sub-decimetre relief — and none of it is in any dataset. This is
     invented, it is faded out by twenty metres so it can never be mistaken
     for terrain, and it is the difference between standing on a glacier and
     standing on a gradient. */
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  /* ── Rock, as a material rather than as a photograph ───────────────────
     A third of this massif is steeper than 45°, and satellites look straight
     down. On a 55° face one half-metre nadir pixel smears across 0.87 m of
     rock; at 75° it is nearly two metres. Those surfaces — the Lhotse Face,
     the Yellow Band, the summit pyramid, every wall of the Cwm — are exactly
     what you look at from a climbing route, and they are the ground the
     imagery describes worst.

     So above a slope threshold the albedo stops being the photograph and
     becomes a material. It is evaluated as 3D noise at the world position,
     which is triplanar by construction: no UVs to invent on a clipmap, no
     projection blend to seam, and a vertical face is sampled exactly as
     well as a horizontal one.

     Two things make it read as *this* mountain rather than as generic rock:
     bedding runs horizontally in world space, because sedimentary beds do;
     and the palette shifts to the Yellow Band's yellow limestone through its
     real altitude window, which is the one rock band on Everest that
     everybody can name. */
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                   mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                   mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  /**
   * Rock surface height, in metres of relief.
   *
   * Frequencies are in WORLD units and fixed. An earlier version scaled the
   * sample coordinate by distance to keep the noise from aliasing, which
   * changes the feature size as you walk toward a face — the rock crawls, and
   * on a steep wall the bedding compressed into moiré. Distance is handled by
   * fading the amplitude instead, which is the honest way to lose detail.
   *
   * Scales: ~30 m blocks, ~9 m ribs, ~3 m rubble, and bedding every ~40 m.
   * Bedding is deliberately faint — it is a hint of stratification, not a
   * corduroy, and at 0.12 amplitude it read as contour lines drawn on the hill.
   */
  float rockH(vec3 p) {
    float h = vnoise3(p * 0.034) * 1.00;
    h += vnoise3(p * 0.105) * 0.44;
    h += vnoise3(p * 0.330) * 0.17;
    h += sin(p.y * 0.16 + vnoise3(p * 0.021) * 4.0) * 0.055;
    return h;
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 P = vWorld;

    /* The far shells approximate the surface from 70 m and 586 m posts, and
       on a 45-degree face that approximation misses by more than any tuck —
       near the camera they poked THROUGH the detail mesh as featureless
       walls. So near the camera they do not draw at all: the detail mesh
       owns everything within its own half-extent, and each shell yields the
       ground it cannot honestly represent. vMorph doubles as the flag (the
       walkable mesh only ever writes 0..1; the shells write 2 and 3). */
    if (vMorph > 1.5 && vDist < (vMorph > 2.5 ? 30000.0 : 7000.0)) discard;

    float lipShade = 0.0;
    if (crevasseOn > 0.5) {
      vec2 cu = vec2((P.x - crevasseBounds.x) / crevasseBounds.z,
                     (P.z - crevasseBounds.y) / crevasseBounds.w);
      if (cu.x > 0.0 && cu.x < 1.0 && cu.y > 0.0 && cu.y < 1.0) {
        float m = texture2D(crevasseMask, cu).r;
        // Red channel is the hole; green is the shadow the lip casts inward,
        // painted a couple of metres wider, which is what stops the edge
        // reading as a sticker cut out of the snow.
        /* Black, not discarded. The discard showed whatever happened to be
           behind the surface — often the far shell or sky — so a slot read
           as a gap in the MAPPING rather than a hole in the GLACIER. A
           crevasse seen from above is black: no sky reaches the bottom. */
        if (m > 0.5) { gl_FragColor = vec4(0.010, 0.012, 0.016, 1.0); return; }
        lipShade = texture2D(crevasseMask, cu).g;
      }
    }

    /* ── Albedo: four windows, coarsest first ───────────────────────────
       Each is faded in twice over: by how far inside its own window the
       point is, and — for the two close ones — by how far it is from the
       camera.

       **The in-window fade has to be a fraction of the window, not a fixed
       number of metres.** It was 60 m, which is a smooth gradient when you
       are standing in it and a two-pixel line when the same edge is two
       kilometres away — and a two-pixel step across the whole view is
       exactly what it looked like: a hard diagonal seam running down the
       Nuptse wall that read as a crack in the geometry.

       **The camera fade is what keeps the seam off screen at all.** Both
       close windows follow the player, so their edges are always at least
       1.5 km and 180 m away respectively; fading them out before that means
       the boundary is never reached, and the finest texture is only sampled
       where it is finer than the screen. */
    /* The vast window is the floor of the stack: it is the only tier that
       reaches the outer shell, so it samples clamped (there is nothing
       coarser to hand to) and everything sharper fades in over it. */
    vec3 uvv = tierUV(bounds_vast, P);
    vec3 col = texture2D(map_vast, clamp(uvv.xy, 0.0, 1.0)).rgb;
    vec3 uvf = tierUV(bounds_far, P);
    if (uvf.z > 0.0) {
      vec4 tf = texture2D(map_far, uvf.xy);
      col = mix(col, tf.rgb, tf.a * smoothstep(0.0, 0.06 * bounds_far.z, uvf.z));
    }
    vec3 colBroad = col;        // kept for the steep-face fallback below

    vec3 uvm = tierUV(bounds_mid, P);
    if (uvm.z > 0.0) {
      vec4 t = texture2D(map_mid, uvm.xy);
      col = mix(col, t.rgb, t.a * smoothstep(0.0, 0.20 * bounds_mid.z, uvm.z));
    }

    vec3 uvn = tierUV(bounds_near, P);
    float nearMask = 0.0;
    if (uvn.z > 0.0) {
      vec4 t = texture2D(map_near, uvn.xy);
      /* The distance fade used to end at 900 m, chosen when the near window
         was 2.2 km wide and its edge could be that close. The window is
         4.2 km now, and the fade was quietly costing four times the
         resolution on exactly the ground people look at most: a wall at
         1.3 km was drawn from the 8.4 m mid tier while 2.1 m data for it sat
         loaded in this very texture. On a steep face draped with a nadir
         photograph, texel columns smear down the wall — 8.4 m ribbons read
         as vertical lines at that range; 2.1 m ribbons read as texture. Same
         picture, four times finer grain. The in-window inset fade above
         still retires the tier before its edge can ever be on screen. */
      /* 0.35 of the window, not 0.10. Two adjacent tiers are different levels
         of Esri's mosaic and can come from different captures with different
         exposure, so the join is a colour step as well as a resolution one.
         Compressed into a 432 m band that step lands as a straight line —
         and because a tier window is an axis-aligned square, that line is
         dead straight across the world and sweeps across the screen as you
         turn. Measured at 42 luminance units, far more than a 2x resolution
         change alone can explain. Spread over ~1500 m it is a gradient
         instead of an edge; the imagery itself is still untouched. */
      nearMask = t.a * smoothstep(0.0, 0.35 * bounds_near.z, uvn.z);
      col = mix(col, t.rgb, nearMask);
    }

    vec3 uvu = tierUV(bounds_ultra, P);
    float ultraMask = 0.0;
    if (uvu.z > 0.0) {
      vec4 t = texture2D(map_ultra, uvu.xy);
      ultraMask = t.a * smoothstep(0.0, 0.35 * bounds_ultra.z, uvu.z);
      col = mix(col, t.rgb, ultraMask);
    }

    vec3 nrm = normalize(vNormal);

    /* ── The recovered relief, as geometry ──────────────────────────────
       vNormal describes the elevation model's surface, and the vertex
       shader has just moved the vertices off it. Central differences on the
       same field bring the normal back into agreement. The step is 2 m, which
       is the shortest wavelength the field is allowed to carry anyway (its
       source is ~2 m per pixel), so this samples the band it was built for
       and nothing finer. */
    if (detailOn > 0.0) {
      float e = 2.0;
      float hx = detailAt(P.xz + vec2(e, 0.0)) - detailAt(P.xz - vec2(e, 0.0));
      float hz = detailAt(P.xz + vec2(0.0, e)) - detailAt(P.xz - vec2(0.0, e));
      nrm = normalize(nrm + vec3(-hx, 0.0, -hz) / (2.0 * e));
    }

    /* ── Steep faces: fall back to the coarse tier ──────────────────────
       Those vertical streaks running down every wall are not a rendering
       artifact — they are in the imagery, and they are orthorectification
       smear. The tiles are rectified against a coarse elevation model, and
       where the true surface is far steeper than that model thinks, each
       source pixel gets stretched down the fall line. The flat glacier has
       none of it; the Nuptse wall and the Icefall headwall are full of it,
       which is exactly the signature.

       There is no recovering the detail — it was never resolved. So where
       the ground is too steep for the rectification to be trustworthy, the
       albedo falls back toward the *far* tier, which at 67 m per pixel is
       too coarse to carry the streaks at all. It costs nothing: that sample
       has already been taken. A soft wall is better than a striped one.

       De-lighting is also pulled back here, because it was multiplying the
       streaks up — measured at 2.34 against 1.64 with it off. */
    float slopeDeg = degrees(acos(clamp(nrm.y, 0.0, 1.0)));
    float steep = smoothstep(42.0, 68.0, slopeDeg);
    col = mix(col, colBroad, steep * 0.35);

    /* ── Rock material on the steep ground ──────────────────────────────
       Only where the imagery is untrustworthy and only where it can be
       seen: steep, and within a few kilometres. Everywhere else this whole
       block is skipped, which is what keeps a 3D-noise material affordable
       on an integrated GPU. */
    /* Near enough to resolve, and steep enough that the imagery is smeared.
       Fading out by 2.2 km is not timidity — past that a 3 m rock feature is
       under a pixel, and drawing it is aliasing, not detail. */
    float rockMask = smoothstep(44.0, 60.0, slopeDeg)
                   * (1.0 - smoothstep(900.0, 2200.0, vDist))
                   * rockDetail;
    if (rockMask > 0.004) {
      vec3 q = P;
      float e = 1.6;
      float h  = rockH(q);
      float hx = rockH(q + vec3(e, 0.0, 0.0));
      float hz = rockH(q + vec3(0.0, 0.0, e));
      float hy = rockH(q + vec3(0.0, e, 0.0));

      /* Two rocks and a fill of snow. Everest's summit pyramid is dark
         gneiss and schist; the Yellow Band at 7,500–8,100 m is a pale
         yellow Ordovician limestone, marine sediment lifted eight
         kilometres by a collision that has not finished. */
      float band = smoothstep(7350.0, 7600.0, P.y) * (1.0 - smoothstep(7950.0, 8250.0, P.y));
      vec3 dark  = mix(vec3(0.125, 0.113, 0.104), vec3(0.27, 0.245, 0.222), smoothstep(0.55, 1.45, h));
      vec3 yellow = mix(vec3(0.40, 0.335, 0.205), vec3(0.62, 0.545, 0.35), smoothstep(0.55, 1.45, h));
      vec3 rock = mix(dark, yellow, band);

      // Snow lodges on ledges — where the local surface is flat-ish — and
      // slides off everything else. That contrast is most of what a big
      // rock face looks like.
      float ledge = smoothstep(0.05, -0.09, (hy - h) / e);
      float snowOnRock = ledge * (1.0 - smoothstep(52.0, 70.0, slopeDeg)) * (0.35 + 0.65 * snowFall);
      rock = mix(rock, vec3(0.90, 0.925, 0.97), snowOnRock * 0.85);

      // Keep a little of the satellite's broad tone so the face still
      // belongs to the mountain around it.
      rock *= 0.72 + 0.55 * lum(colBroad);

      col = mix(col, rock, rockMask);

      // Relief from the same height field: blocks, ledges and bedding.
      vec2 g = vec2(hx - h, hz - h) / e;
      nrm = normalize(nrm + vec3(-g.x, 0.0, -g.y) * rockMask * 0.40);
    }

    /* ── De-lighting ────────────────────────────────────────────────────
       The imagery already contains the sun that was up when the satellite
       passed. Divide that shading back out so what is left is closer to an
       albedo, and the game's own lighting is the only lighting.

       Three guards, all of them necessary:
        - Never divide by less than delightFloor. Where the source is truly
          black there is no albedo information left, and dividing by a small
          number amplifies compression noise into coloured confetti.
        - Only trust it over bright ground. Rock has genuine albedo variation
          and de-lighting it just makes it grey.
        - What cannot be recovered is *lifted* toward the scene's mean snow
          albedo instead. That is the difference between a pit on the Khumbu
          that is black at every hour of the day and one that is merely in
          shadow when the game says it should be. */
    if (delightAmount > 0.001) {
      float ndlCap = dot(normalize(vNormal), captureSun);
      float shade = delightFloor + (1.0 - delightFloor) * max(ndlCap, 0.0);
      float lumC = lum(col);
      // Bright ground is snow, and snow is where this is valid. Steep ground
      // is smeared, and dividing a smear by a cosine sharpens the smear.
      float trust = smoothstep(0.16, 0.42, lumC) * delightAmount * (1.0 - steep * 0.8);
      vec3 recovered = col / max(shade, delightFloor);
      col = mix(col, clamp(recovered, 0.0, 1.6), trust);
      // Lift what the division could not reach.
      float deficit = max(0.0, meanAlbedo * 0.55 - lum(col));
      col += vec3(0.96, 0.98, 1.0) * deficit * trust * 0.75;
    }

    /* ── Micro-relief from the imagery ──────────────────────────────────
       The elevation model stops at a 4 m grid over ~30 m source data, and
       the imagery is half a metre. Over snow — which is close to a uniform
       albedo — brightness variation at that scale is very nearly all
       shading, and shading encodes slope. So the high-frequency part of the
       imagery's luminance is read back as a slope perturbation.

       This is synthesised relief, not measured relief. It is a
       shape-from-shading approximation, it is only honest over snow, and it
       is deliberately weak on rock where albedo really does vary. It is what
       makes the ground read as a surface rather than as a photograph
       stretched over a smooth ramp — which is exactly what the first pass
       looked like.

       Both close windows feed it: the half-metre one where it exists, and
       the four-metre one out to a kilometre and a half, so the detail does
       not stop dead at the edge of the finest tier. */
    float glitter = 0.0;
    if (microRelief > 0.0) {
      /* Units matter here and getting them wrong is spectacular. The
         luminance gradient is per metre, and luminance spans 0..1, so over a
         0.8 m step a rock edge gives ~0.2 per metre. Scaling that by 26 adds
         five to a unit normal: every fragment ends up facing an arbitrary
         direction, the specular term fires on all of them, and the glacier
         renders as polished chrome. Which is exactly what the first attempt
         looked like from eye height — it was invisible from thirty metres up,
         because the distance fades had already turned it off.

         The perturbation is therefore expressed as a TILT, clamped to about
         20°, which is as much as sub-metre snow relief can plausibly be. */
      vec2 g = vec2(0.0);
      float lc = 0.5;
      if (ultraMask > 0.01) {
        float d = 0.8;
        vec2 du = vec2(d / bounds_ultra.z, 0.0), dv = vec2(0.0, d / bounds_ultra.w);
        lc = lum(texture2D(map_ultra, uvu.xy).rgb);
        float lx = lum(texture2D(map_ultra, uvu.xy + du).rgb) - lum(texture2D(map_ultra, uvu.xy - du).rgb);
        float lz = lum(texture2D(map_ultra, uvu.xy + dv).rgb) - lum(texture2D(map_ultra, uvu.xy - dv).rgb);
        // Subtract the low-frequency part, or a rock/snow boundary — a real
        // albedo change — reads as a cliff that is not there.
        float bx = lum(texture2D(map_ultra, uvu.xy + du * 6.0).rgb) - lum(texture2D(map_ultra, uvu.xy - du * 6.0).rgb);
        float bz = lum(texture2D(map_ultra, uvu.xy + dv * 6.0).rgb) - lum(texture2D(map_ultra, uvu.xy - dv * 6.0).rgb);
        g += vec2(lx - bx / 6.0, lz - bz / 6.0) * 0.55 * ultraMask;
      }
      if (nearMask > 0.01) {
        float d = 3.5;                      // ~2 texels at the near tier's 2.1 m/px
        vec2 du = vec2(d / bounds_near.z, 0.0), dv = vec2(0.0, d / bounds_near.w);
        lc = mix(lc, lum(texture2D(map_near, uvn.xy).rgb), 1.0 - ultraMask);
        float lx = lum(texture2D(map_near, uvn.xy + du).rgb) - lum(texture2D(map_near, uvn.xy - du).rgb);
        float lz = lum(texture2D(map_near, uvn.xy + dv).rgb) - lum(texture2D(map_near, uvn.xy - dv).rgb);
        float bx = lum(texture2D(map_near, uvn.xy + du * 6.0).rgb) - lum(texture2D(map_near, uvn.xy - du * 6.0).rgb);
        float bz = lum(texture2D(map_near, uvn.xy + dv * 6.0).rgb) - lum(texture2D(map_near, uvn.xy - dv * 6.0).rgb);
        g += vec2(lx - bx / 6.0, lz - bz / 6.0) * 0.75 * nearMask * (1.0 - 0.6 * ultraMask);
      }
      float snowish = smoothstep(0.30, 0.62, lc);

      /* Brightness only encodes slope ALONG the sun. Across it, a Lambertian
         surface returns the same radiance whatever it does, so the cross-sun
         component of this gradient is not shape — it is JPEG, resampling and
         albedo, amplified. Projecting onto the sun's horizontal direction
         throws that half away and keeps the half that means something.

         This is the same physics photoclino.js integrates at 4–17 m; here it
         is left as a tilt because below about 3 m there are not enough pixels
         per feature to integrate a height worth having. The two bands do not
         overlap: this one starts where the recovered geometry stops. */
      vec2 sdir = captureSun.xz;
      float sl = length(sdir);
      if (sl > 0.05) g = (sdir / sl) * dot(g, sdir / sl);

      g = clamp(g * microRelief * (0.35 + 0.65 * snowish), -0.36, 0.36);
      nrm = normalize(nrm + vec3(-g.x, 0.0, -g.y));

      /* Snow grain, close in only. Two octaves stretched across the wind
         direction, because sastrugi are cut by wind and run with it. */
      /* ── The snow surface itself ──────────────────────────────────────
         Four scales, each doing a different job, all of them faded out by
         distance so nothing is computed where it cannot be seen:

           sastrugi   0.6–3 m  wind-carved ridges, ADVECTED along the wind
           ripple     10–30 cm the fine grain of the surface
           glitter    per-facet specular, the sparkle of ice crystals
           the field  footprints and drift, live, from snowfield.js

         The sastrugi move. That is the point of windPhase: a wind-worked
         snow surface is not a texture, it is a slow fluid, and a field of
         ridges that migrates downwind at a few centimetres a minute is the
         difference between standing on snow and standing on a photograph of
         snow. It is cheap — one scalar added to the noise coordinate. */
      float grainFade = 1.0 - smoothstep(14.0, 46.0, vDist);
      if (grainFade > 0.01 && snowDetail > 0.0) {
        // Work in a frame aligned to the wind, so ridges run across it.
        vec2 wa = windAxis;
        vec2 wp = vec2(dot(P.xz, wa), dot(P.xz, vec2(-wa.y, wa.x)));
        wp.x -= windPhase;

        float amt = grainFade * (0.30 + 0.70 * snowish) * microRelief * snowDetail;

        // Sastrugi: long across the wind, short along it.
        vec2 qs = vec2(wp.x * 1.25, wp.y * 0.34);
        float e = 0.5;
        float s1 = vnoise(qs + vec2(e, 0.0)) - vnoise(qs - vec2(e, 0.0));
        float s2 = vnoise(qs + vec2(0.0, e)) - vnoise(qs - vec2(0.0, e));

        /* Ripple, an octave down and TURNED. Value noise is built on an
           axis-aligned lattice, so two octaves in the same frame line their
           grids up and the surface comes out cross-hatched like graph paper.
           Rotating this one by about 32° breaks the alignment. */
        vec2 wr = vec2(wp.x * 0.848 - wp.y * 0.530, wp.x * 0.530 + wp.y * 0.848);
        vec2 qr = vec2(wr.x * 5.4 + 31.0, wr.y * 3.9 - 17.0);
        float r1 = vnoise(qr + vec2(e, 0.0)) - vnoise(qr - vec2(e, 0.0));
        float r2 = vnoise(qr + vec2(0.0, e)) - vnoise(qr - vec2(0.0, e));

        // Grain, the finest thing there is, and it dies off fastest.
        float fine = 1.0 - smoothstep(3.0, 12.0, vDist);
        vec2 qf = wp * 17.0;
        float f1 = (vnoise(qf + vec2(e, 0.0)) - vnoise(qf - vec2(e, 0.0))) * fine;
        float f2 = (vnoise(qf + vec2(0.0, e)) - vnoise(qf - vec2(0.0, e))) * fine;

        vec2 gw = vec2(s1 * 0.95 + r1 * 0.42 + f1 * 0.22,
                       s2 * 0.95 + r2 * 0.42 + f2 * 0.22);
        // Back out of the wind frame.
        vec2 gr = wa * gw.x + vec2(-wa.y, wa.x) * gw.y;
        nrm = normalize(nrm + vec3(gr.x, 0.0, gr.y) * amt);

        /* Shading alone is nearly invisible on frontally-lit snow — measured
           at 1.5× the foreground contrast of a flat surface, on a surface
           that had almost none. Real snow also varies in tone: old wind crust
           against fresh, and the shadow inside every ripple. A few percent of
           albedo does more for it than any amount of normal. */
        col *= 1.0 + (vnoise(qs * 1.6) - 0.5) * 0.15 * amt
                   + (vnoise(qr * 1.1) - 0.5) * 0.08 * amt;

        /* ── Footprints and drift ──
           The live field. Trodden snow is broken snow: it is darker, because
           the crystals that were reflecting light in every direction have
           been crushed, and it is rougher. Drift is the opposite — smooth,
           bright, and it fills the prints in. */
        vec2 su = (P.xz - snowFieldBounds.xy) / snowFieldBounds.zw;
        if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
          vec4 sf = texture2D(snowField, su);
          float tread = sf.r * grainFade;
          float drift = sf.g * grainFade;
          // A print has a rim and a hollow; the gradient of the field is
          // what makes it read as a dent rather than a stain.
          vec2 t = vec2(1.5 / snowFieldBounds.z, 0.0);
          float gx = texture2D(snowField, su + t.xy).r - texture2D(snowField, su - t.xy).r;
          float gy = texture2D(snowField, su + t.yx).r - texture2D(snowField, su - t.yx).r;
          /* A boot print is a shallow dent, not a hole. At 3.2 the normal
             tilted far enough to catch pure sky and every print rendered as
             a blue blob lying on the snow rather than a mark pressed into
             it. Trodden snow is only slightly darker than untrodden — the
             crystals are broken so it scatters less — and the shape has to
             come from the shading, not from the tint. */
          nrm = normalize(nrm + vec3(gx, 0.0, gy) * 1.45 * grainFade * snowDetail);
          col *= 1.0 - tread * 0.085 + drift * 0.05;
          lc -= tread * 0.06;
        }

        /* ── Glitter ──
           Snow is a heap of flat crystals and some of them are aimed at you.
           A high-frequency threshold on a hashed facet normal gives the
           scintillation without a specular map, and it is the single most
           recognisable thing about sunlit snow up close. */
        float sparkleFade = 1.0 - smoothstep(2.0, 26.0, vDist);
        if (sparkleFade > 0.01) {
          float h = vnoise(P.xz * 190.0) * vnoise(P.xz * 133.0 + 7.0);
          glitter = smoothstep(0.62, 0.95, h) * sparkleFade * snowish * snowDetail;
        }
      }
    }

    /* ── Fresh snow ─────────────────────────────────────────────────────
       Lies on anything shallower than about 50°, which is also roughly the
       angle above which the mountain keeps no snow of its own. */
    float slopeCos = clamp(nrm.y, 0.0, 1.0);
    float holds = smoothstep(0.62, 0.88, slopeCos);
    float lying = snowFall * holds;
    vec3 snowAlbedo = vec3(0.94, 0.955, 0.99);
    col = mix(col, snowAlbedo, lying * 0.8);

    /* ── Light ──────────────────────────────────────────────────────────
       The first pass wrapped the diffuse term hard and gave the sky a large
       share, on the reasoning that snow is bright. The result was a mountain
       with no shadows at all: uniformly white, and shapeless, because on
       snow the *only* thing carrying form is the shadow. Photographs of this
       place have brilliant sunlit faces against deep blue-grey shade, and
       the numbers here are chosen to reproduce that separation rather than
       to be physically defensible. The wrap term stays — snow really does
       scatter light around a shadow edge — but small. */
    /* ── Isolation modes ────────────────────────────────────────────────
       Every measurement this artifact has been chased with was taken on a
       machine that does not show it, and the frame-to-frame noise (17%) turned
       out to be the same size as every "signal" found. The eye looking at the
       real screen is the reliable instrument here, so give it a clean split:

         1  flat albedo, lighting kept   — anything left is the SHAPE
         2  raw albedo, lighting removed — anything left is the PICTURE

       One of those two will show the lines and the other will not, and that
       single answer halves the search. There is no cleverness in it; it is
       just the bisection that should have been offered on the first report. */
    if (debugMode > 0.5 && debugMode < 1.5) col = vec3(0.55);
    bool pictureOnly = (debugMode > 1.5 && debugMode < 2.5);
    if (debugMode > 2.5) col = colBroad;      // 3: coarse tier only

    /* ── Picture-only: flat far away, lit underfoot ──────────────────────
       This returns AFTER the surface materials above, and applies a shading
       term that fades in only near the camera.

       Both halves are needed and neither works alone. Returning before the
       materials skipped snow and rock entirely — and they are the only source
       of structure finer than the imagery, which tops out at 0.53 m/px while
       the screen resolves ~0.1 m at arm's length. But running them without
       light did nothing either, because they work by perturbing the NORMAL,
       and a normal with nothing to catch it is invisible: measured gain from
       switching all three on was exactly 1.00.

       So: a plain N.L term, faded in over the last 60 m. Past that the map
       stays exactly as flat and bright as it is now; underfoot the sastrugi,
       grain and rock relief finally have something to shade against. The
       imagery is still the only source of colour — this modulates it, it does
       not relight the scene. */
    /* ── Picture-only: detail as ALBEDO, not as normals ──────────────────
       The imagery already carries the mountain's real shadows, baked in by
       the sun that was shining when it was captured, so this path stays
       unlit — and that is the whole reason the surface materials above were
       invisible. They work by perturbing the NORMAL, and a normal with no
       light to catch it changes nothing: measured effect of switching every
       detail dial on was exactly 1.00, three times over.

       In an unlit renderer the only thing that can carry sub-metre structure
       is albedo. So the recovered surface normal is converted into a
       brightness modulation here: ground tilted toward the capture sun reads
       a little brighter, ground tilted away a little darker. It is the same
       information the materials computed, expressed in the one channel this
       path actually outputs.

       Faded out by 90 m, because past that a texel is smaller than a pixel
       and the modulation would alias rather than resolve. */
    if (pictureOnly) {
      /* Mapped tiles, as they are. The synthesised foreground (sastrugi,
         wind-ripple, per-material noise) was tried here and rejected on
         sight — it read as static stuck to a photograph, worse than the
         blur it replaced. The imagery stands alone again.

         One exception, and it is a data repair rather than an effect: the
         Esri mosaic around Base Camp contains patches that are simply BLACK —
         no capture, not shadow. A void on the ground reads as a hole in the
         world. Base Camp sits on moraine gravel, so where the imagery is
         near-black and the ground is close enough to matter, a repeating
         pebble texture stands in, blended over the darkness ramp so the
         patch has no hard rim. */
      /* The dark streaky bands running across the Base Camp glacier are the
         target here — the user reads them as wind scour painted on the snow.
         They are in the source imagery (medial moraine and no-capture voids,
         luminance roughly 0.18-0.34), which is why a strict lum < 0.16
         "black only" test never fired on a single one of them. The test now
         matches what the eye objects to: DARK AND GREY. Dark alone is not
         enough — a blue-tinted shadow is real mountain and must survive — so
         saturation gates the mask. Two texture scales break up the tiling. */
      /* Thresholds MEASURED off the composited near tier, not guessed —
         two guesses in a row covered 0.7% of pixels and the user rightly
         reported no pebbles at all. The histogram: snow is the 40% of pixels
         above 0.9; the grey streak bands live at 0.40-0.70; almost nothing
         exists below 0.34, which is why a "dark" mask found nothing to
         replace. Full gravel below 0.55, fading out by 0.78 so genuine
         snow is never touched; the saturation gate only spares blue-tinted
         shadow and actual colour. */
      float lumA = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float satA = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
      /* Foreground only. The luminance band that reads as "dark patch" on
         the glacier underfoot is the same band every shaded rock face in the
         distance lives in, so a mask with no range limit repainted the
         mountains and smeared their detail. 200 m is where an individual
         pebble stops being resolvable anyway (a 3 cm stone is under a fifth
         of a screen pixel there), so past it the fill can only do harm.
         Faded over the last 60 m rather than cut, so the gravel has no
         visible circular rim. */
      float reach = 1.0 - smoothstep(140.0, 200.0, vDist);
      /* Two thresholds, because "dark" means different things at different
         heights. In the valley the fill targets the measured 0.40-0.70
         moraine streak band. On the mountain those same numbers matched
         ordinary scree and shadow — genuine mapping — and after a fast
         travel the whole 200 m reach circle around the spawn repainted as
         imported rock while real snow showed beyond it: a stamp around the
         player. Above the valley only a true void (near-black, no-capture)
         qualifies; dark ground that the satellite actually saw stands. */
      /* One mask, all altitudes: the measured dark-and-grey band. An
         earlier fix restricted the mountain to near-black voids only —
         which also switched off the boulder texture on genuine exposed
         rock and starved the summit's snow fill. The stamp that fix
         chased is prevented differently now: the fill inherits the
         imagery's own luminance below, so filled ground keeps its
         shading and the reach circle has no visible rim. */
      float darkness = (1.0 - smoothstep(0.55, 0.78, lumA))
                     * (1.0 - smoothstep(0.12, 0.22, satA))
                     * reach;
      /* The glacier band — the Khumbu and the Cwm floor, between the Base
         Camp moraine below and the South Col's rock above. Altitude alone
         cannot draw it (the glacier and the valley moraine overlap in
         height), so the spatial half comes from the route mask's blue
         channel: a ~500 m corridor painted along the route, which IS the
         glacier the whole way. Dark imagery inside the band is the
         glacier's own crevasse bands, so both rock fills stand down there
         and the darkness reads as slots. The rope line itself overwrites
         blue with red in the mask, hence max(b, r). */
      float glacBand = smoothstep(5390.0, 5460.0, P.y)
                     * (1.0 - smoothstep(6480.0, 6650.0, P.y));
      {
        vec2 gru = (P.xz - routeMaskBounds.xy) / routeMaskBounds.zw;
        if (gru.x > 0.0 && gru.x < 1.0 && gru.y > 0.0 && gru.y < 1.0) {
          vec4 grm = texture2D(routeMask, gru);
          glacBand *= max(grm.b, grm.r);
        } else {
          glacBand = 0.0;
        }
      }
      /* One rule, settled after three rounds: the pebble fill exists for
         the Base Camp valley's no-capture voids and dark moraine streaks,
         and ONLY there. Above the valley the satellite imagery takes
         precedence, always — the boulder-skin and snow fills that briefly
         stood in for dark ground kept winning fights they should not have
         been in. The fill still wears the ground's own light so the reach
         fade has no rim. */
      darkness *= 1.0 - smoothstep(5550.0, 5750.0, P.y);
      darkness *= 1.0 - glacBand;
      if (moraineOn > 0.5 && darkness > 0.01) {
        vec3 fill = mix(texture2D(moraineTex, P.xz * 0.85).rgb,
                        texture2D(moraineTex, P.xz * 0.16).rgb, 0.35);
        fill *= 0.45 + 1.15 * lumA;
        col = mix(col, fill, darkness * 0.88);
      }
      /* Boulder skin, conditionally: above the valley, dark ground gets
         the broken-rock texture ONLY where the land is flat — a col or a
         scree terrace is boulder ground; a steep face is not, and there
         the imagery keeps absolute precedence. Flatness comes from the
         surface normal: full at slopes under ~15\u00b0, gone by ~25\u00b0. */
      if (boulderOn > 0.5) {
        float rockBand = smoothstep(5550.0, 5750.0, P.y);
        float flatness = smoothstep(0.906, 0.966, normalize(vNormal).y);
        /* Inside the glacier band flat dark ground is not scree — the
           imagery's dark patches on the Khumbu are its crevasse bands, so
           they read as slots (cold, near-black, a little of the ground's
           own light) instead of wearing the boulder skin. Above the band
           the South Col's dark flats are genuine broken rock and keep the
           boulders. The slot gate accepts steeper ground than the boulder
           gate because the Icefall itself leans. */
        float dDark = (1.0 - smoothstep(0.55, 0.78, lumA))
                    * (1.0 - smoothstep(0.12, 0.22, satA))
                    * reach;
        float dRock = dDark * flatness * rockBand * (1.0 - glacBand);
        if (dRock > 0.01) {
          vec3 rock = mix(texture2D(boulderTex, P.xz * 0.55).rgb,
                          texture2D(boulderTex, P.xz * 0.11).rgb, 0.35);
          rock *= 0.45 + 1.15 * lumA;
          col = mix(col, rock, dRock * 0.85);
        }
        float softFlat = smoothstep(0.819, 0.906, normalize(vNormal).y);
        float dCrev = dDark * softFlat * glacBand;
        if (dCrev > 0.01) {
          /* Not a flat paint: the imagery keeps its own band structure and
             is pulled down and cooled, so the glacier's dark stripes read
             as shadowed slots in the ice rather than as an unlit void. */
          vec3 slot = col * vec3(0.30, 0.36, 0.50) + vec3(0.012, 0.016, 0.028);
          col = mix(col, slot, dCrev * 0.75);
        }
      }
      /* Snow grain above the valley, the counterpart of the valley's
         pebbles: where the imagery is featureless bright snow, a grain
         texture MODULATES it in the same 200 m reach — the satellite
         keeps precedence (this multiplies, never replaces), but white
         ground underfoot reads as snow rather than as blank paper. */
      if (snowTexOn > 0.5) {
        float snowBand = smoothstep(5550.0, 5750.0, P.y);
        float white = smoothstep(0.60, 0.78, lumA)
                    * (1.0 - smoothstep(0.16, 0.28, satA));
        float g = snowBand * white * reach;
        if (g > 0.01) {
          float n = mix(texture2D(snowTex, P.xz * 0.9).r,
                        texture2D(snowTex, P.xz * 0.17).r, 0.4);
          col *= 1.0 + (n - 0.5) * 0.26 * g;
          float sp = texture2D(snowTex, P.xz * 2.3).g;
          col += vec3(0.09) * smoothstep(0.965, 1.0, sp) * g;
        }
      }
      /* ── Analytical basemaps ─────────────────────────────────────────
         Every alternative drape is computed from the surface itself —
         height and normal — so nothing streams and nothing is licensed:
         hillshade (fixed NW sun over a hypsometric tint), slope (the
         mountaineer's ramp, green flat to violet past sixty degrees),
         contours (the map sheet: paper, brown lines, heavy every 500 m),
         and risk (avalanche-angle slopes burn red, glacier flats cool).
         Night, the route line and aerial perspective still apply over
         whichever surface is chosen. */
      if (basemapMode > 0.5) {
        vec3 an = normalize(vNormal);
        float slopeDeg = degrees(acos(clamp(an.y, 0.0, 1.0)));
        float hyp = clamp((P.y - 4200.0) / 4400.0, 0.0, 1.0);
        if (basemapMode < 1.5) {
          float sh = clamp(dot(an, normalize(vec3(-0.5, 0.8, -0.5))), 0.0, 1.0);
          col = (vec3(0.74, 0.75, 0.76) + hyp * 0.22) * (0.35 + 0.65 * sh);
        } else if (basemapMode < 2.5) {
          vec3 ramp = slopeDeg < 15.0 ? mix(vec3(0.22, 0.62, 0.32), vec3(0.92, 0.85, 0.25), slopeDeg / 15.0)
                    : slopeDeg < 30.0 ? mix(vec3(0.92, 0.85, 0.25), vec3(0.94, 0.52, 0.16), (slopeDeg - 15.0) / 15.0)
                    : slopeDeg < 45.0 ? mix(vec3(0.94, 0.52, 0.16), vec3(0.86, 0.16, 0.16), (slopeDeg - 30.0) / 15.0)
                    : mix(vec3(0.86, 0.16, 0.16), vec3(0.48, 0.12, 0.62), clamp((slopeDeg - 45.0) / 15.0, 0.0, 1.0));
          float sh = 0.75 + 0.25 * clamp(dot(an, normalize(vec3(-0.5, 0.8, -0.5))), 0.0, 1.0);
          col = ramp * sh;
        } else if (basemapMode < 3.5) {
          float w100 = fwidth(P.y) * 1.2 + 0.35;
          float d100 = abs(fract(P.y / 100.0 + 0.5) - 0.5) * 100.0;
          float d500 = abs(fract(P.y / 500.0 + 0.5) - 0.5) * 500.0;
          float minor = 1.0 - smoothstep(w100, w100 * 2.0, d100);
          float major = 1.0 - smoothstep(w100 * 1.6, w100 * 3.2, d500);
          col = vec3(0.94, 0.92, 0.87);
          col = mix(col, vec3(0.62, 0.44, 0.26), minor * 0.55);
          col = mix(col, vec3(0.42, 0.28, 0.14), major * 0.8);
          float sh = clamp(dot(an, normalize(vec3(-0.5, 0.8, -0.5))), 0.0, 1.0);
          col *= 0.82 + 0.18 * sh;
        } else {
          float avy = smoothstep(28.0, 35.0, slopeDeg) * (1.0 - smoothstep(48.0, 58.0, slopeDeg));
          float wall = smoothstep(50.0, 60.0, slopeDeg);
          float ice = (1.0 - smoothstep(0.0, 14.0, slopeDeg)) * smoothstep(5300.0, 5600.0, P.y);
          vec3 base = vec3(0.35, 0.62, 0.42);
          col = mix(base, vec3(0.92, 0.75, 0.20), smoothstep(18.0, 28.0, slopeDeg));
          col = mix(col, vec3(0.88, 0.15, 0.12), avy);
          col = mix(col, vec3(0.35, 0.10, 0.30), wall);
          col = mix(col, vec3(0.30, 0.55, 0.85), ice * 0.6);
          float sh = 0.75 + 0.25 * clamp(dot(an, normalize(vec3(-0.5, 0.8, -0.5))), 0.0, 1.0);
          col *= sh;
        }
      }
      /* The fixed line, as surface paint. The mask's R channel is the
         rope, G carries along-distance so the gold pulse still travels
         toward the summit; conformance is perfect by construction because
         this IS the ground being shaded. Fades with distance like the old
         ribbon so it stays a hint near you, not a line across the massif. */
      if (routeOn > 0.5) {
        vec2 ru = (P.xz - routeMaskBounds.xy) / routeMaskBounds.zw;
        if (ru.x > 0.0 && ru.x < 1.0 && ru.y > 0.0 && ru.y < 1.0) {
          vec4 rm = texture2D(routeMask, ru);
          if (rm.r > 0.08) {
            /* A steady line — the travelling pulse read as an electrical
               current running up the mountain and is retired by request.
               (The along-distance still rides the mask's G channel if a
               use for it returns.) */
            float aR = 0.52 * rm.r * (1.0 - smoothstep(700.0, 2600.0, vDist))
                     * smoothstep(2.5, 9.0, vDist);   // not a gold carpet underfoot
            col = mix(col, vec3(0.16, 0.72, 0.34), clamp(aR, 0.0, 0.9));   // route green
          }
        }
      }
      /* ── Night, fully implemented in the bare path ──────────────────
         pictureOnly used to return daylight imagery at any hour: the sky
         turned black and the ground stayed noon. Three terms fix it, all
         from uniforms the full path already maintains:
         day    — the sun's altitude dims the ground through twilight;
         moon   — nightSky (starlight + moonlight, set per phase) gives a
                  blue-grey floor so a clear night is navigable;
         torch  — the head lamp's cone, without which L at night lit
                  nothing because this path returned before the lamp. */
      /* dayLight is fed from the sky model in degrees — sunDir here is
         the CAPTURE sun (the light baked into the imagery), which never
         sets, and reading it kept the ground at noon all night. */
      float day = dayLight;
      vec3 nightGround = col * (vec3(0.05, 0.065, 0.11) + nightSky * 0.85);
      if (lampIntensity > 0.001) {
        vec3 Ld = P - lampPos;
        float lDist = length(Ld);
        Ld /= max(lDist, 0.001);
        float spot = smoothstep(lampCosOuter, lampCosInner, dot(Ld, lampDir));
        float fall = 1.0 - smoothstep(lampRange * 0.25, lampRange, lDist);
        nightGround += col * lampColour * lampIntensity * spot * fall;
      }
      col = mix(nightGround, col, day);
      /* Aerial perspective — the one thing raw mapping cannot carry. The
         old far tier was z11, whose pixels arrive pre-hazed by the
         atmosphere the satellite itself looked through, so the horizon
         looked "mapped perfectly" for free; z12 and z9 are cleaner data,
         and their shadowed faces at 60 km rendered as raw black — sharper
         pixels, less real picture. This is the physical term put back:
         light scattered into the view path over distance, tinted by the
         actual sky of the actual hour. Beer-Lambert with k chosen so the
         near field is untouched (1% at 1 km), the middle distance reads as
         depth (23% at 20 km), and the far ranges recede into the sky they
         stand against (73% at 100 km). Distance is data too, and this is
         how the eye reads it. */
      float aer = 1.0 - exp(-vDist * 0.000013);
      col = mix(col, mix(fogColor, skyColor, 0.6), aer);
      gl_FragColor = vec4(col, 1.0);
      return;
    }

    float ndl = dot(nrm, sunDir);
    float wrap = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    float direct = pow(wrap, 1.45);

    /* ── Cast shadow ────────────────────────────────────────────────────
       The sun's own disc is half a degree across, so a shadow edge is never
       hard: the penumbra widens with how far the caster is, and 0.012 in
       sine is about right for a ridge a kilometre off. Shadowed ground keeps
       all of its sky light, which is why a Himalayan shadow is deep blue
       rather than black.

       Called sunVis, because CAST IS A RESERVED WORD IN GLSL.
       Using it compiles nothing, three logs the error to the console, and
       the mesh still issues its draw calls — so the symptom is 129,000
       triangles of pure black with correct geometry, correct uniforms and a
       bound texture, which reads as anything except a syntax error. */
    float sunVis = 1.0;
    if (shadowsOn > 0.5) {
      vec2 hu = (P.xz - horizonBounds.xy) / horizonBounds.zw;
      if (hu.x > 0.001 && hu.x < 0.999 && hu.y > 0.001 && hu.y < 0.999) {
        float horizon = texture2D(horizonMap, hu).r;
        sunVis = smoothstep(horizon - 0.012, horizon + 0.012, sunSin);
        // Fade the effect out at the edge of the map rather than stepping.
        vec2 e = min(hu, 1.0 - hu);
        sunVis = mix(1.0, sunVis, smoothstep(0.0, 0.03, min(e.x, e.y)));
      }
    }
    direct *= sunVis;
    // A surface facing away from the sun is already dark; do not also let a
    // stale horizon map brighten it.
    direct = min(direct, pow(wrap, 1.45));

    vec3 V = normalize(cameraPosW - P);
    vec3 H = normalize(V + sunDir);
    float spec = pow(max(dot(nrm, H), 0.0), 64.0) * (0.10 + 0.55 * lying) * step(0.0, ndl);
    // The crystals that happen to be aimed at you. Narrow, bright, and only
    // where the sun is actually on the snow.
    spec += glitter * pow(max(dot(nrm, H), 0.0), 6.0) * 1.5 * step(0.02, ndl);
    spec *= sunVis;

    // Sky light comes from above, so an upward face gets more of it — and a
    // glacier bounces a great deal back up, which is why the underside of
    // every serac is lit.
    /* Shadowed snow under a clear high-altitude sky is not dark — it is
       maybe a quarter as bright as the sunlit snow beside it and strongly
       blue, and it is where most of the picture lives before the sun gets
       into a valley. */
    float skyAmt = 0.21 + 0.30 * clamp(nrm.y, 0.0, 1.0);
    float bounce = 0.09 * clamp(1.0 - nrm.y, 0.0, 1.0) * lying;

    vec3 lit = col * (sunColor * direct + skyColor * (skyAmt + bounce) + nightSky * skyAmt)
             + sunColor * spec;
    lit *= 1.0 - 0.46 * lipShade;

    /* Head torch. A cone with a soft edge, inverse-square falloff, and a
       little specular so wet ice flashes back at you — which is the tell
       for blue ice under a torch and the reason you can see a crevasse lip
       at night at all. */
    if (lampIntensity > 0.001) {
      vec3 toP = P - lampPos;
      float dist = length(toP);
      vec3 L = toP / max(dist, 0.001);
      float cone = smoothstep(lampCosOuter, lampCosInner, dot(L, lampDir));
      float atten = lampRange * lampRange / (lampRange * lampRange + dist * dist * 3.0);
      float nl = max(dot(nrm, -L), 0.0);
      vec3 hv = normalize(-L + V);
      float sp = pow(max(dot(nrm, hv), 0.0), 90.0) * 0.5;
      lit += (col * nl + sp) * lampColour * lampIntensity * cone * atten
             * (1.0 - 0.46 * lipShade);
    }

    /* A little contrast about mid-grey, before the tone curve rather than
       after it, so the shoulder still has somewhere to roll off to. Snow
       photographs with more separation than a linear render gives it. */
    lit = clamp((lit - 0.5) * 1.16 + 0.5, 0.0, 4.0);

    /* ── Aerial perspective ─────────────────────────────────────────────
       Density falls off with height, because the air does. Without the
       height term the Cwm and the summit haze identically and the mountain
       loses all sense of scale. */
    float hFactor = exp(-max(P.y - 5000.0, 0.0) * fogHeightFalloff);
    float f = 1.0 - exp(-vDist * fogDensity * hFactor);
    f = clamp(f, 0.0, 1.0);
    vec3 outc = mix(lit, fogColor, f);

    // A whiteout is not fog: it is loss of contrast in every direction at
    // once, with no horizon and no shadow to tell you which way is down.
    outc = mix(outc, fogColor, whiteout * (0.35 + 0.65 * clamp(vDist / 90.0, 0.0, 1.0)));

    outc *= exposure;

    /* Linear HDR out — NOT tonemapped, NOT sRGB-encoded.
       The tone curve lives in the composite pass now (postfx.js). It has to
       be in exactly one place: when the terrain applied ACES and the sky
       applied ACES separately, the two disagreed about what white was, and
       bloom had nothing above 1.0 to find because every material had already
       clamped itself into display range. */
    gl_FragColor = vec4(outc, 1.0);
  }
`;

/* ── One clipmap level ───────────────────────────────────────────────────*/

class Level {
  constructor(index, material) {
    this.index = index;
    this.cell = BASE * Math.pow(2, index);
    this.half = N * this.cell / 2;
    this.isFinest = index === 0;

    const count = VERTS * VERTS;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const morph = new Float32Array(count);

    // Local grid: fixed. Only Y, the normals and the mesh's own position
    // ever change, which is what makes an update cheap.
    for (let j = 0; j < VERTS; j++) {
      for (let i = 0; i < VERTS; i++) {
        const k = j * VERTS + i;
        pos[k * 3] = (i - N / 2) * this.cell;
        pos[k * 3 + 2] = (j - N / 2) * this.cell;
        nrm[k * 3 + 1] = 1;
        const r = Math.max(Math.abs(i - N / 2), Math.abs(j - N / 2)) / (N / 2);
        morph[k] = smoothstep(MORPH_START, 1.0, r);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("morph", new THREE.BufferAttribute(morph, 1));
    this.indices = new Uint32Array(N * N * 6);
    g.setIndex(new THREE.BufferAttribute(this.indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.half * 2.2);

    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;   // the bounding sphere moves every snap
    this.mesh.renderOrder = LEVELS - index;   // finest first: early-z does the rest

    this.centre = { x: NaN, z: NaN };
    this.hole = { i0: -1, j0: -1, i1: -1, j1: -1 };
    this.dirty = true;
    if (this.isFinest) this.rebuildIndices(null);   // no child, so never changes
  }

  /** The hole this level must leave for its child, in this level's own grid
   *  indices. Returns null for level 0, which has no child. */
  computeHole(child) {
    if (!child) return null;
    const i0 = Math.round((child.centre.x - child.half - (this.centre.x - this.half)) / this.cell);
    const j0 = Math.round((child.centre.z - child.half - (this.centre.z - this.half)) / this.cell);
    const n = Math.round(child.half * 2 / this.cell);
    return { i0, j0, i1: i0 + n, j1: j0 + n };
  }

  /** Refill the index buffer around the hole. Only called when the hole
   *  actually moves — every few hundred metres on the coarse levels. */
  rebuildIndices(hole) {
    const idx = this.indices;
    let n = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (hole && i >= hole.i0 && i < hole.i1 && j >= hole.j0 && j < hole.j1) continue;
        const a = j * VERTS + i, b = a + 1, c = a + VERTS, d = c + 1;
        idx[n++] = a; idx[n++] = c; idx[n++] = b;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    }
    this.geometry.index.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.hole = hole || { i0: -1, j0: -1, i1: -1, j1: -1 };
  }

  /**
   * Resample heights and normals over the whole level.
   *
   * ── The apron, and why the rings were visible ──────────────────────────
   * Heights are sampled over a grid two cells LARGER than the one drawn, and
   * the normals are central differences on that larger grid.
   *
   * Without it, a vertex on the outermost row has no neighbour outside, so
   * the difference gets clamped to a one-sided one and comes out at half the
   * true gradient. That is one row of wrongly-lit vertices at the outer edge
   * of every level — and, for the same reason, at the edge of every hole,
   * because the vertices inside a hole were skipped as "not drawn" while the
   * ring around them still differenced against them. Seen from above it drew
   * the clipmap as a set of concentric squares, which reads as cracks in the
   * geometry and is nothing of the sort: the surface was continuous the whole
   * time and only its shading had steps in it.
   *
   * ── The morph ─────────────────────────────────────────────────────────
   * In the outer band each height is blended toward what the *parent* level
   * draws there. A child vertex is either on a parent vertex, on the midpoint
   * of a parent edge, or in the middle of a parent cell — decided by parity —
   * so the parent's surface at that point is exact, not interpolated twice.
   * Beyond the edge (in the apron) the morph is already saturated, so the
   * apron is the parent's surface, which is what the neighbouring level
   * actually draws there.
   */
  resample(field, hasParent) {
    const pos = this.geometry.attributes.position.array;
    const nrm = this.geometry.attributes.normal.array;
    const mo = this.geometry.attributes.morph.array;
    const s = this.cell;
    const cx = this.centre.x, cz = this.centre.z;
    const HW = VERTS + 2 * AP;
    const heights = this._h || (this._h = new Float32Array(HW * HW));
    const hole = this.hole;
    const half = N / 2;

    /* The hole interior used to be skipped here — nothing inside it is drawn,
       so why pay for it. That optimisation punched holes through the mountain.
       The hole MOVES: when a child level re-snaps, this level's index buffer
       is refilled around the new hole, and vertices that sat inside the old
       hole become drawn while still holding the 0 they were allocated with.
       Measured at (-1920, 2048): a drawn parent vertex reading exactly 0.0
       against a child at 7,353 m and a true height of 7,364 m — a 7 km cliff
       to nowhere at one ring, which is the wedge missing from the face.

       Guarding it properly would mean re-resampling whenever the hole moves,
       and getting that invalidation right in every path. Filling every vertex
       unconditionally cannot be got wrong, and the cost is the hole interior
       of a 97x97 grid — a few thousand samples per rebuild, against the ~100
       network fetches the same rebuild is about to make. */
    const gi0 = 1e9, gi1 = -1e9, gj0 = 1e9, gj1 = -1e9;

    for (let j = -AP; j < VERTS + AP; j++) {
      const jIn = j > gj0 && j < gj1;
      const wz = cz + (j - half) * s;
      for (let i = -AP; i < VERTS + AP; i++) {
        if (jIn && i > gi0 && i < gi1) continue;
        const wx = cx + (i - half) * s;

        /* ── Sampling: low-pass whatever the ring is too coarse to resolve ──
           A coarse ring point-sampling the height field at 64 m+ spacing is
           sampling above Nyquist over data with real 17 m structure, and the
           folded ridges shade as false undulations at the cell frequency. So
           anything coarser than NRM_STEP reads the mean of its own cell (3x3
           box) instead of one point.

           `sampleAt` takes the cell size because the morph band needs the
           PARENT's filtering, not this level's. Getting that wrong opened a
           wedge in the massif: the child blended toward a raw field.height()
           while the parent actually drew the filtered value, so the surfaces
           stopped being coincident at the ring boundary and the clipmap's
           no-cracks guarantee — which depends on them being exactly equal
           there — failed.

           Fixing that left ONE seam broken, and the threshold itself was why.
           With the rule `cell > 32 filters`, the 32 m level sampled raw while
           its 64 m parent filtered: the only pair in the stack straddling the
           boundary, disagreeing by the local relief. Measured across the
           child's whole edge: every other seam 0.000 m, that one **6,248 m**.
           A kilometres-tall tear at one ring, which is exactly a slice missing
           from a distant face.

           So the decision is made on the LEVEL PAIR, not on each level alone:
           a level filters if it or its parent would, which makes the rule
           agree on both sides of every boundary by construction. The finest
           levels (2-16 m) are untouched, so the ground underfoot still reads
           the field directly. */
        const sampleAt = (ax, az, cell) => {
          // `cell / 2 > NRM_STEP` would make a level and its parent disagree
          // at the one boundary that straddles the threshold. Filtering when
          // EITHER side would filter keeps the rule identical on both sides.
          if (cell <= NRM_STEP) return field.height(ax, az);
          const q = cell / 3;
          let acc = 0;
          for (let oj = -1; oj <= 1; oj++)
            for (let oi = -1; oi <= 1; oi++)
              acc += field.height(ax + oi * q, az + oj * q);
          return acc / 9;
        };
        let h = sampleAt(wx, wz, s);

        if (hasParent) {
          const r = Math.max(Math.abs(i - half), Math.abs(j - half)) / half;
          const m = smoothstep(MORPH_START, 1.0, r);
          if (m > 0) {
            const oddI = (i & 1) !== 0, oddJ = (j & 1) !== 0;
            let hp;
            const ps = s * 2;                       // the parent's cell size
            if (!oddI && !oddJ) hp = sampleAt(wx, wz, ps);
            else if (oddI && !oddJ) hp = 0.5 * (sampleAt(wx - s, wz, ps) + sampleAt(wx + s, wz, ps));
            else if (!oddI && oddJ) hp = 0.5 * (sampleAt(wx, wz - s, ps) + sampleAt(wx, wz + s, ps));
            else hp = 0.25 * (sampleAt(wx - s, wz - s, ps) + sampleAt(wx + s, wz - s, ps)
                            + sampleAt(wx - s, wz + s, ps) + sampleAt(wx + s, wz + s, ps));
            h += (hp - h) * m;
          }
        }
        heights[(j + AP) * HW + (i + AP)] = h;
      }
    }

    for (let j = 0; j < VERTS; j++) {
      const jIn = j > gj0 && j < gj1;
      for (let i = 0; i < VERTS; i++) {
        if (jIn && i > gi0 && i < gi1) continue;
        const k = j * VERTS + i;
        const hk = (j + AP) * HW + (i + AP);
        pos[k * 3 + 1] = heights[hk] * RENDER.vertExag;

        /* ── Normals: from the field at a capped step, not the drawn grid ──
           These were central differences on the level's own grid, at the
           level's own spacing s — 64 m on the ring that draws the 2–5 km
           band, 1024 m on the outermost. The reasoning was that shading
           should match the drawn geometry. The visible consequence took a
           day to find: the elevation data resolves 17 m, so a 64 m stencil
           lights four facets' worth of real slope as one flat facet, and on
           a mountainside those facet columns run straight down the fall
           line. Evenly spaced vertical stripes, in an annulus at a fixed
           radius from the player — the artifact reported six times over,
           surviving every imagery and shading toggle, because it was baked
           into the vertex normals of the coarse rings.

           So: wherever the grid is coarser than the data, the normal is
           sampled from the field itself at NRM_STEP. The facets are still in
           the silhouette — nothing changes the vertex count — but shading is
           what the eye reads at 3 km, and the shading is now as smooth as
           the data. Every coarse level uses the SAME step, so normals agree
           across ring boundaries by construction, which is better seam
           behaviour than the per-level stencil ever had. Fine levels
           (s <= NRM_STEP) keep the grid stencil: at their scale the grid IS
           the data, and it stays consistent with the morphed band. */
        /* Normals from the drawn grid. Two earlier versions of this block
           chased the vertical stripes by reworking the stencil — first
           narrower (wrong: made the aliasing worse), then supersampled
           (half-right: smoothed the shading of a surface that was still
           aliased). Both were treating the symptom. The heights themselves
           are now low-passed to each ring's Nyquist where they are sampled,
           so a plain central difference on the grid is differencing clean
           data — and it keeps the morph-band widening, which the field-based
           versions quietly lost. */
        let dx = (heights[hk + 1] - heights[hk - 1]) / (2 * s);
        let dz = (heights[hk + HW] - heights[hk - HW]) / (2 * s);
        const m = mo[k];
        if (m > 0) {
          const dx2 = (heights[hk + 2] - heights[hk - 2]) / (4 * s);
          const dz2 = (heights[hk + 2 * HW] - heights[hk - 2 * HW]) / (4 * s);
          dx += (dx2 - dx) * m;
          dz += (dz2 - dz) * m;
        }
        dx *= RENDER.vertExag; dz *= RENDER.vertExag;
        const inv = 1 / Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx * inv; nrm[k * 3 + 1] = inv; nrm[k * 3 + 2] = -dz * inv;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.mesh.position.set(cx, 0, cz);
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ── The terrain ─────────────────────────────────────────────────────────*/

export class Terrain {
  constructor(field, imagery) {
    this.field = field;
    this.imagery = imagery;

    this.uniforms = Object.assign({
      sunDir:   { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
      skyColor: { value: new THREE.Color(0.42, 0.56, 0.82) },
      fogColor: { value: new THREE.Color(0.72, 0.80, 0.90) },
      fogDensity:       { value: 1 / 42000 },
      fogHeightFalloff: { value: 1 / 3200 },
      whiteout:    { value: 0 },
      snowFall:    { value: 0.15 },
      microRelief: { value: 1.0 },
      exposure:    { value: 0.88 },
      time:        { value: 0 },
      cameraPosW:  { value: new THREE.Vector3() },
      crevasseMask:   { value: null },
      crevasseBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      crevasseOn:     { value: 0 },
      lampPos:        { value: new THREE.Vector3() },
      lampDir:        { value: new THREE.Vector3(0, 0, -1) },
      lampColour:     { value: new THREE.Color(1.0, 0.96, 0.86) },
      lampIntensity:  { value: 0 },
      lampCosInner:   { value: Math.cos(0.20) },
      lampCosOuter:   { value: Math.cos(0.42) },
      lampRange:      { value: 42 },
      nightSky:       { value: new THREE.Color(0, 0, 0) },
      snowField:       { value: null },
      snowFieldBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      windPhase:       { value: 0 },
      windAxis:        { value: new THREE.Vector2(1, 0) },
      snowDetail:      { value: 1 },
      rockDetail:      { value: 1 },
      horizonMap:    { value: null },
      horizonBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      sunSin:        { value: 0.5 },
      shadowsOn:     { value: 1 },
      captureSun:    { value: new THREE.Vector3(0.4, 0.8, -0.4).normalize() },
      delightAmount: { value: 0 },      // 0 until the estimate lands
      delightFloor:  { value: 0.32 },
      meanAlbedo:    { value: 0.82 },
      detailMap:     { value: null },   // photoclinometric relief, 0 until built
      detailBounds:  { value: new THREE.Vector4(0, 0, 1, 1) },
      detailRange:   { value: 3.0 },
      detailOn:      { value: 0 },
      moraineTex:    { value: null },   // gravel stand-in for black imagery voids
      moraineOn:     { value: 0 },
      snowTex:       { value: null },   // procedural grain for featureless white ground
      snowTexOn:     { value: 0 },
      boulderTex:    { value: null },   // broken rock for FLAT dark ground above the valley
      boulderOn:     { value: 0 },
      dayLight:      { value: 1 },
      basemapMode:   { value: 0 },
      routeMask:     { value: null },   // the fixed line, painted onto the surface
      routeMaskBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      routeOn:       { value: 1 },
      debugMode:     { value: 0 },   // isolation modes, cycled with F10
    }, imagery.uniforms());

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.FrontSide,
    });

    this.group = new THREE.Group();
    this.group.name = "terrain-clipmap";
    this.levels = [];
    for (let i = 0; i < LEVELS; i++) {
      const lv = new Level(i, this.material);
      this.levels.push(lv);
      this.group.add(lv.mesh);
    }
    this.queue = [];

    /* ── The far shell ───────────────────────────────────────────────────
       The detailed mesh ends 8.2 km out; the real horizon is much further.
       Earlier versions closed that gap with a polar disc whose triangle
       density fell off with distance — and at any density the radial rings
       aliased ridgelines into plains and shards. This is its replacement,
       and it is nothing new: a second copy of the construction the massif
       mesh already proved. One full square grid, 1024 cells of 70 m, 71.7 km
       across, pinned to the origin, built once at boot from the fixed DEM
       tiers (17 m posts to 26 km, 135 m beyond) and sampled plainly — raw
       mapping, no filters, no silhouette heuristics. 70 m posts are denser
       than the disc was at 5 km, uniformly, all the way to the rim. It
       shares the terrain material so the imagery drapes it identically, and
       sits 2 m under the true surface so the detailed mesh covers it
       wherever detail exists and can neither gap nor fight it at the seam.
       1.05M static vertices, one draw, never rebuilt. */
    {
      const N = 1024, CELL = 70, half = (N * CELL) / 2;
      const pos = new Float32Array((N + 1) * (N + 1) * 3);
      const uv = new Float32Array((N + 1) * (N + 1) * 2);
      const morph = new Float32Array((N + 1) * (N + 1)).fill(2); // shell flag: yield to the detail mesh near the camera
      let p = 0, u = 0;
      for (let j = 0; j <= N; j++) {
        const z = j * CELL - half;
        for (let i = 0; i <= N; i++) {
          const x = i * CELL - half;
          pos[p++] = x; pos[p++] = field.height(x, z) - 2; pos[p++] = z;
          uv[u++] = 0; uv[u++] = 0;
        }
      }
      const idx = new Uint32Array(N * N * 6);
      let k = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setAttribute("morph", new THREE.BufferAttribute(morph, 1));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      this.horizon = new THREE.Mesh(geo, this.material);
      this.horizon.name = "far-shell";
      this.horizon.frustumCulled = false;
      this.group.add(this.horizon);

      /* And beneath it, the rest of the earth. The inner shell ends 36 km
         out, which from the summit is a hard rim a third of the way to the
         real horizon. This grid carries the remaining 264 km: 512 cells of
         586 m — matching the 540 m posts of the vast DEM tier that feeds
         it — tucked 8 m down so the inner shell and the detail mesh always
         win where they exist. 263k static vertices, one draw. */
      const N2 = 512, CELL2 = 586, half2 = (N2 * CELL2) / 2;
      const pos2 = new Float32Array((N2 + 1) * (N2 + 1) * 3);
      const uv2 = new Float32Array((N2 + 1) * (N2 + 1) * 2);
      const morph2 = new Float32Array((N2 + 1) * (N2 + 1)).fill(3); // outer-shell flag
      let p2 = 0;
      for (let j = 0; j <= N2; j++) {
        const z = j * CELL2 - half2;
        for (let i = 0; i <= N2; i++) {
          const x = i * CELL2 - half2;
          pos2[p2++] = x; pos2[p2++] = field.height(x, z) - 8; pos2[p2++] = z;
        }
      }
      const idx2 = new Uint32Array(N2 * N2 * 6);
      let k2 = 0;
      for (let j = 0; j < N2; j++) {
        for (let i = 0; i < N2; i++) {
          const a = j * (N2 + 1) + i, b = a + 1, c = a + N2 + 1, d = c + 1;
          idx2[k2++] = a; idx2[k2++] = c; idx2[k2++] = b;
          idx2[k2++] = b; idx2[k2++] = c; idx2[k2++] = d;
        }
      }
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute("position", new THREE.BufferAttribute(pos2, 3));
      geo2.setAttribute("uv", new THREE.BufferAttribute(uv2, 2));
      geo2.setAttribute("morph", new THREE.BufferAttribute(morph2, 1));
      geo2.setIndex(new THREE.BufferAttribute(idx2, 1));
      geo2.computeVertexNormals();
      this.horizonOuter = new THREE.Mesh(geo2, this.material);
      this.horizonOuter.name = "far-shell-outer";
      this.horizonOuter.frustumCulled = false;
      this.group.add(this.horizonOuter);
    }
  }

  /** Snap every level to the player and resample whatever moved. At most one
   *  level is resampled per frame — a full pass is 85,000 height lookups and
   *  doing them all at once is a visible hitch. */
  update(px, pz, budgetMs = 4) {
    /* New elevation data invalidates every level, wherever the player is
       standing. Without this a level resampled before its tiles landed keeps
       a sheet of zeros until the player happens to walk far enough to move
       that level's centre — which is why the hole in the massif looked
       permanent from a standstill and healed as soon as you moved. */
    const v = this.field.version;
    if (v !== this._fieldVersion) {
      /* Coalesced, and rebuilt in one pass. The field commits on every tile
         that lands — 121 times during a boot — and marking all ten levels
         dirty each time left them permanently mid-rebuild, so no two levels
         were ever resampled against the same surface and every ring seam
         disagreed. Two rules fix that: wait until the data has been quiet for
         a moment, then resample EVERY level in the same call so they cannot
         be built from different versions of the ground. A full pass is the
         only state in which the seams are guaranteed to agree. */
      const now = performance.now();
      if (this._fieldSeenAt === undefined || v !== this._fieldPending) {
        this._fieldPending = v;
        this._fieldSeenAt = now;
      } else if (now - this._fieldSeenAt > 350) {
        this._fieldVersion = v;
        this._fieldSeenAt = undefined;
        for (const lv of this.levels) lv.dirty = true;
        this._fullPass = true;      // finish them all, ignoring the budget
      }
    }

    for (let i = 0; i < LEVELS; i++) {
      const lv = this.levels[i];
      const step = lv.cell * 2;
      const cx = Math.round(px / step) * step;
      const cz = Math.round(pz / step) * step;
      if (cx !== lv.centre.x || cz !== lv.centre.z) {
        lv.centre = { x: cx, z: cz };
        lv.dirty = true;
        if (i + 1 < LEVELS) this.levels[i + 1].dirty = true;   // its hole moved
      }
    }

    /* The per-frame budget spreads resampling so a re-snap never stalls a
       frame. It must NOT apply to the first pass: at boot every level is
       dirty, the budget stops after two or three, and a level that has not
       been resampled yet is still all zeros — a flat sheet at y=0 under a
       mountain. Measured at boot: the 128 m level read exactly 0.0 where the
       64 m child read 7,353 m, which is a seven-kilometre hole through the
       massif at one ring. It healed the moment the player walked far enough
       to dirty that level again, which is why it looked intermittent.

       So the first build runs to completion, however long it takes — nobody
       is looking yet, the loading screen is still up — and every pass after
       it is budgeted as before. */
    const t0 = performance.now();
    for (let i = 0; i < LEVELS; i++) {
      const lv = this.levels[i];
      if (!lv.dirty) continue;
      if (i > 0) lv.rebuildIndices(lv.computeHole(this.levels[i - 1]));
      lv.resample(this.field, i < LEVELS - 1);
      lv.dirty = false;
      lv.everBuilt = true;
      if (this._primed && !this._fullPass && performance.now() - t0 > budgetMs) break;
    }
    this._fullPass = false;
    if (!this._primed) this._primed = this.levels.every((l) => l.everBuilt);
  }

  /** Everything must be resampled — the near DEM tier just landed and the
   *  ground it describes is not the ground currently drawn. */
  invalidate() { for (const lv of this.levels) lv.dirty = true; }

  setCamera(cam) {
    this.uniforms.cameraPosW.value.copy(cam.position);
    this.imagery.syncUniforms(this.uniforms);
  }
}
