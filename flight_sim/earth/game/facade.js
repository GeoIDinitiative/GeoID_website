/**
 * Procedural facades and roofs for extruded OSM buildings, as shader patches
 * on three.js Lambert materials. Shared by Earth Flight (buildings.js) and the
 * GeoHUB globe's streamed buildings (GeoID_GIS/viewer/gis/osm-buildings.js),
 * so it touches only shader strings and imports nothing: each side passes its
 * own three.js copy's material in.
 *
 * What the walls get, all from two numbers per vertex -- the facade metres in
 * `uv` (along the wall, up from its foot) and the style byte `aStyle`:
 *
 *   masonry (style 0)  storeys of 3.3 m, a slab line at each floor, punched
 *                      windows in 3 m bays, each pane a little different
 *                      (blinds, reflections) by a hash of its cell; tall
 *                      shopfront glazing below 4 m.
 *   curtain (style 1)  1.5 m glass bays with thin mullions and an opaque
 *                      spandrel at each floor, plus a sky sheen that grows
 *                      toward grazing angles (a Fresnel term).
 *   both               contact occlusion: darkest at the ground, gone by 5 m.
 *
 * Every pattern fades to its own average once a bay is smaller than about a
 * pixel and a half, so distant blocks do not shimmer. Cost per wall fragment:
 * two fract(), two hashes, a handful of mix/step, one fwidth -- measured as no
 * change in frame time at 1600x900 over central London (draws, not fill, are
 * the limit there), and one byte per vertex for the style.
 */

const WALL_PARS = /* glsl */`
varying vec2 vFacade;
varying float vStyle;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const WALL_COLOUR = /* glsl */`
  {
    vec2 w = fwidth(vFacade);
    float px = max(w.x, w.y);
    float glassDark = 0.0;
    vec3 glass = vec3(0.10, 0.13, 0.17);
    if (vStyle < 0.5) {
      // Masonry: 3 m bays, 3.3 m storeys.
      vec2 cell = vec2(vFacade.x / 3.0, vFacade.y / 3.3);
      vec2 f = fract(cell);
      float shop = 1.0 - step(4.0, vFacade.y);              // ground floor
      float lo = mix(0.30, 0.10, shop), hi = mix(0.80, 0.92, shop);
      float win = step(0.22, f.x) * step(f.x, 0.78) * step(lo, f.y) * step(f.y, hi);
      win *= step(0.6, vFacade.y);
      float slab = (1.0 - step(0.06, f.y)) * step(4.0, vFacade.y);
      float r = fHash(floor(cell));
      vec3 pane = glass * mix(0.8, 2.6, r * r);             // some panes lit, some blinds
      float fade = clamp(1.0 - px / 3.0 * 1.6, 0.0, 1.0);
      vec3 wall = diffuseColor.rgb * (1.0 + 0.10 * slab);
      vec3 near = mix(wall, pane, win);
      vec3 far = mix(diffuseColor.rgb, glass, 0.20 * step(0.6, vFacade.y));
      diffuseColor.rgb = mix(far, near, fade);
    } else {
      // Curtain wall: 1.5 m glass bays, mullions, a spandrel per floor.
      vec2 cell = vec2(vFacade.x / 1.5, vFacade.y / 3.6);
      vec2 f = fract(cell);
      float mull = step(f.x, 0.05) + step(0.95, f.x);
      float span = step(f.y, 0.20);
      float glassMask = (1.0 - clamp(mull + span, 0.0, 1.0));
      float r = fHash(vec2(floor(cell.y), floor(cell.x / 4.0)));
      vec3 pane = mix(glass * 1.4, diffuseColor.rgb * 0.55, 0.35 + 0.25 * r);
      float fade = clamp(1.0 - px / 1.5 * 1.6, 0.0, 1.0);
      vec3 near = mix(diffuseColor.rgb, pane, glassMask);
      vec3 far = mix(diffuseColor.rgb, pane, 0.75);
      diffuseColor.rgb = mix(far, near, fade);
      glassDark = mix(0.75, glassMask, fade);
    }
    // Contact occlusion: the street darkens the foot of every wall.
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(-1.0, 5.0, vFacade.y));
    vGlass = glassDark;
  }
`;

const WALL_SHEEN = /* glsl */`
  // Glass reflects the sky, most at grazing angles.
  {
    float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    totalEmissiveRadiance += vec3(0.42, 0.55, 0.70) * vGlass * fres * 0.9;
  }
`;

export function facade(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prev(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aStyle;\nvarying vec2 vFacade;\nvarying float vStyle;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vFacade = uv;\n  vStyle = aStyle;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + WALL_PARS + "float vGlass = 0.0;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + WALL_COLOUR)
      .replace("#include <lights_lambert_fragment>", WALL_SHEEN + "\n#include <lights_lambert_fragment>");
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : "") + "|facade2";
  return material;
}

/**
 * Roofs: the tile's imagery, a shade darker than the walls (a roof seen from
 * above at an angle catches less sky than the photo's straight-down view
 * suggests), and grey where the imagery has not landed yet -- the canvas
 * starts transparent so the same texture can also be the ground drape under
 * the tile without painting grey squares on it while it fills.
 */
export function roof(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_fragment>", `#include <map_fragment>
  diffuseColor.rgb = mix(vec3(0.30, 0.29, 0.28), diffuseColor.rgb * 0.86, diffuseColor.a);
  diffuseColor.a = 1.0;`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : "") + "|roof2";
  return material;
}
