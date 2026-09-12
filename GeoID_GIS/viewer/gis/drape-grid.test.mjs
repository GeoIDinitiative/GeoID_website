/**
 * A DRAPE IS AS TIGHT AS ITS FACETS, and the facets were a guess.
 *
 * `drape()` built a SQUARE grid at whatever segment count its caller happened
 * to pass — 72 from the weather card, 96 by default, 180 for a global shell —
 * and none of those numbers knows how much ground a quad covers. Measured over
 * an 8° x 4° box across the Alps at the slider's default relief, facet centre
 * against the ground under it:
 *
 *   72 segments   6.1 km a quad   mean 555 m off the ground, worst 9,379 m
 *   96            4.6 km          mean 336 m,  worst 5,150 m
 *   192           2.3 km          mean  85 m,  worst 2,000 m
 *   384           1.2 km          mean  20 m,  worst   910 m
 *
 * That is the weather map standing half a kilometre off its own terrain, which
 * at any oblique view is the map sliding away from the ground it describes.
 * The grid comes from the GROUND now, per axis, and this pins the rule.
 *
 * Run with `node drape-grid.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis;
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.document = {
  createElement: () => ({ getContext: () => null, style: {}, appendChild() {}, setAttribute() {} }),
  addEventListener() {}, dispatchEvent() {}, querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, head: { appendChild() {} }, body: { appendChild() {} },
};
globalThis.addEventListener = () => {};

const { patchSegments } = await import("./gee.js");

let pass = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) pass += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`drape-grid: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const quadKm = (box, { sx, sy }) => {
  const midLat = (box.minY + box.maxY) / 2;
  return {
    x: ((box.maxX - box.minX) * 111.32 * Math.cos(midLat * Math.PI / 180)) / sx,
    y: ((box.maxY - box.minY) * 110.574) / sy,
  };
};

{
  // The weather card's own case: a quad of kilometres, not of six of them.
  const alps = { minX: 5.5, maxX: 13.5, minY: 44, maxY: 48 };
  const g = patchSegments(alps);
  const q = quadKm(alps, g);
  check("a weather-sized box gets a quad of about a kilometre and a half",
    q.x < 2 && q.y < 2, `${q.x.toFixed(2)} x ${q.y.toFixed(2)} km at ${g.sx}x${g.sy}`);
  check("and it is far finer than the 72 that stood it half a kilometre off the ground",
    g.sx > 300 && g.sy > 200, `${g.sx}x${g.sy}`);
}

{
  // THE AXES ARE SIZED SEPARATELY. A square grid over a wide, shallow box
  // spends its vertices where there is no ground to follow.
  const wide = { minX: 0, maxX: 8, minY: 44, maxY: 45 };
  const g = patchSegments(wide);
  check("a wide, shallow box gets more segments across than down", g.sx > g.sy * 3,
    `${g.sx}x${g.sy}`);
  const q = quadKm(wide, g);
  check("and both axes land on the same quad size", Math.abs(q.x - q.y) < 0.6,
    `${q.x.toFixed(2)} x ${q.y.toFixed(2)} km`);
}

{
  // A FLOOR IS A FLOOR. A small patch is not made coarser than its caller asked.
  const small = { minX: 4.6, maxX: 4.7, minY: 44.5, maxY: 44.6 };
  check("a caller's segments are a floor the ground rule may raise but never lower",
    patchSegments(small, 180).sx >= 180 && patchSegments(small, 180).sy >= 180);
  check("and the default floor still applies with none given",
    patchSegments(small).sx >= 32 && patchSegments(small).sy >= 32);
}

{
  // THE BUDGET IS VERTICES, not a per-axis cap: a wide, shallow box should be
  // allowed to spend them along the axis that has the ground.
  const world = { minX: -180, maxX: 180, minY: -85, maxY: 85 };
  const g = patchSegments(world, 180);
  const verts = (g.sx + 1) * (g.sy + 1);
  check("a shell round the planet is bounded by a vertex budget", verts < 200000, `${verts}`);
  check("and is still no coarser than the horizon it is drawn against",
    g.sx >= 180 && g.sy >= 180 ? true : g.sx > 400, `${g.sx}x${g.sy}`);
  check("a box with no size at all still yields a usable grid",
    patchSegments({ minX: 5, maxX: 5, minY: 44, maxY: 44 }).sx >= 8);
}

{
  // The wiring: `drape` must ask the rule, and must not build a square grid
  // out of the number its caller passed.
  const src = readFileSync(fileURLToPath(new URL("./gee.js", import.meta.url)), "utf8");
  check("drape sizes its grid from the ground", /const \{ sx, sy \} = patchSegments\(box, segments\);/.test(src));
  check("and builds the plane on both axes", /new THREE\.PlaneGeometry\(1, 1, sx, sy\)/.test(src));
  check("no square grid is built from the caller's segments any more",
    !/PlaneGeometry\(1, 1, segments, segments\)/.test(src));
  const weather = readFileSync(fileURLToPath(new URL("./weather-maps.js", import.meta.url)), "utf8");
  check("the weather card lets the rule choose rather than passing 72",
    !/segments: 72/.test(weather));
}
