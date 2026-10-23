/**
 * Procedural facades for extruded OSM buildings, as a shader patch on a
 * three.js Lambert material. Shared by Earth Flight (buildings.js) and the
 * GeoHUB globe's streamed buildings (GeoID_GIS/viewer/gis/osm-buildings.js),
 * so it touches only shader strings and imports nothing: each side passes
 * its own three.js copy's material in.
 */

/* ── Facades ──────────────────────────────────────────────────────────────
   OSM has no facades, so every wall gets the same honest abstraction: storeys
   of 3.4 m and window bays of 3 m, dark glass in a pale frame, from the
   facade metres extrude.js puts in `uv`. The pattern fades to its own average
   once a bay is smaller than about a pixel and a half, so distant blocks do
   not shimmer. Below 3 m (the street level, and the sunk foot of the wall)
   there are no windows. */
export function facade(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prev(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFacade;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vFacade = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFacade;")
      .replace("#include <color_fragment>", `#include <color_fragment>
  {
    vec2 cell = vec2(vFacade.x / 3.0, vFacade.y / 3.4);
    vec2 f = fract(cell);
    float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.30, f.y) * step(f.y, 0.80);
    win *= step(3.0, vFacade.y);
    vec2 w = fwidth(cell);
    float fade = clamp(1.0 - max(w.x, w.y) * 1.6, 0.0, 1.0);
    float k = mix(0.17 * step(3.0, vFacade.y), win * 0.62, fade);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.16, 0.20), k);
  }`);
  };
  return material;
}
