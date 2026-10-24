/**
 * Procedural facades and roofs for extruded OSM buildings, as shader patches
 * on three.js Lambert materials. Shared by Earth Flight (buildings.js) and the
 * GeoHUB globe's streamed buildings (GeoID_GIS/viewer/gis/osm-buildings.js),
 * so it touches only shader strings and imports nothing: each side passes its
 * own three.js copy's material in.
 *
 * What the walls get, all from two numbers per vertex -- the facade grid in
 * `uv` (bays along the wall, storeys up from its foot) and the style byte
 * `aStyle`:
 *
 *   masonry (style 0)  whole storeys (~3.2 m) and whole bays (~3 m) per wall
 *                      (`uv` is in bays and storeys, from extrude.js), a slab
 *                      line at each floor, one punched window per cell, each
 *                      pane a little different (blinds, reflections) by a
 *                      hash of its cell; taller openings on the ground floor.
 *   curtain (style 1)  ~1.5 m glass panels with thin mullions and an opaque
 *                      spandrel at each floor, plus a sky sheen that grows
 *                      toward grazing angles (a Fresnel term).
 *   both               contact occlusion: darkest at the ground, gone by 5 m.
 *   plain (style 0.5)  none of the above: bridge decks and piers, wheels.
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
uniform float uNight;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const WALL_COLOUR = /* glsl */`
  // Style 0.5 is "plain": bridge concrete, wheels -- no windows, no base shading.
  // vFacade is (bays, storeys): every wall segment holds whole bays and the
  // height whole equal storeys (extrude.js BAY_M / STOREY_M), so each cell is
  // exactly one window's worth of wall and none is cut by a corner or a roof.
  if (vStyle < 0.25 || vStyle > 0.75) {
    vec2 w = fwidth(vFacade);
    float glassDark = 0.0;
    vec3 glass = vec3(0.10, 0.13, 0.17);
    float storey = floor(vFacade.y);
    float above = step(0.0, vFacade.y);                   // not the sunk foot
    if (vStyle < 0.25) {
      // Masonry: one punched window per bay per storey, sill ~1 m up, head
      // ~0.6 m under the next floor; the ground floor's openings a little
      // taller (doors, shopfronts) but the same width.
      vec2 f = fract(vFacade);
      float ground = 1.0 - step(0.5, storey);
      float lo = mix(0.30, 0.10, ground), hi = 0.80;
      float win = step(0.24, f.x) * step(f.x, 0.76) * step(lo, f.y) * step(f.y, hi) * above;
      float slab = (1.0 - step(0.04, f.y)) * step(0.5, storey);
      float r = fHash(floor(vFacade));
      vec3 pane = glass * mix(0.8, 2.6, r * r);             // some panes lit, some blinds
      float fade = clamp(1.0 - max(w.x, w.y) * 1.6, 0.0, 1.0);
      vec3 wall = diffuseColor.rgb * (1.0 + 0.10 * slab);
      vec3 near = mix(wall, pane, win);
      vec3 far = mix(diffuseColor.rgb, glass, 0.20 * above);
      diffuseColor.rgb = mix(far, near, fade);
      vWinLit = win * step(r, 0.55) * fade + 0.18 * (1.0 - fade) * above;
    } else {
      // Curtain wall: two glass panels per bay (~1.5 m), mullions, a
      // spandrel at each floor.
      vec2 cell = vec2(vFacade.x * 2.0, vFacade.y);
      vec2 f = fract(cell);
      float mull = step(f.x, 0.05) + step(0.95, f.x);
      float span = step(f.y, 0.20);
      float glassMask = (1.0 - clamp(mull + span, 0.0, 1.0)) * above;
      float r = fHash(vec2(floor(cell.y), floor(cell.x / 4.0)));
      vec3 pane = mix(glass * 1.4, diffuseColor.rgb * 0.55, 0.35 + 0.25 * r);
      float fade = clamp(1.0 - max(w.x * 2.0, w.y) * 1.6, 0.0, 1.0);
      vec3 near = mix(diffuseColor.rgb, pane, glassMask);
      vec3 far = mix(diffuseColor.rgb, pane, 0.75);
      diffuseColor.rgb = mix(far, near, fade);
      glassDark = mix(0.75, glassMask, fade);
      vWinLit = (glassMask * step(r, 0.5) * fade + 0.25 * (1.0 - fade)) * 0.8;
    }
    // Contact occlusion: the street darkens the foot of every wall.
    diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(-0.3, 1.2, vFacade.y));
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
      .replace("#include <common>", "#include <common>\n" + WALL_PARS + "float vGlass = 0.0;\nfloat vWinLit = 0.0;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + WALL_COLOUR)
      .replace("#include <lights_lambert_fragment>", WALL_SHEEN + "\n#include <lights_lambert_fragment>")
      // At night about half the windows are lit (uNight, 0 day .. 1 night,
      // from the host: osm-buildings.js passes night-lights.js's value).
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.rgb += vec3(1.0, 0.78, 0.48) * vWinLit * uNight;");
    shader.uniforms.uNight = material.userData.night || { value: 0 };
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : "") + "|facade3";
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
