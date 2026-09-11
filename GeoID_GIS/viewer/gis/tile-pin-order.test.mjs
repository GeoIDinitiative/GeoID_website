/**
 * THE WORLD GOES UNDER THE VIEW, NEVER OVER IT.
 *
 * For a layer off its own pyramid the world backdrop is pinned in the
 * BACKGROUND, so it can land after the view's tiles are already up. Showing
 * the pinned set alone then HID the view: measured on the hydrology rows, the
 * nine zoom-7 tiles of lakes and rivers over the Camargue built and hidden,
 * only the zoom-2 world showing — which holds no lake under 1,000 km² — so the
 * lakes were not there until the camera moved. Run: node tile-pin-order.test.mjs
 */
globalThis.window = globalThis.window || {};
const { createTiledVectorLayer } = await import("./vector-tiles.js");

let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { failures.push(name); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

// Every tile answers empty, the world's slowly: which order they land in is
// the only thing under test.
const slow = new Set();
globalThis.fetch = async (url) => {
  const z = Number(/\/(\d+)\/\d+\/\d+\.mvt/.exec(url)?.[1]);
  await new Promise((resolve) => setTimeout(resolve, slow.has(z) ? 60 : 1));
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
};

const view = { west: 4.2, east: 5.2, south: 43.1, north: 43.9 };
const WORLD = { west: -180, east: 180, south: -85, north: 85 };

{
  slow.add(2);
  const controller = createTiledVectorLayer({
    name: "lakes", kind: "lakes", maxZoom: 7,
    sources: { local: "/tiles", has: () => true, maxZoom: 7 },
  });
  const pinning = controller.pin({ bounds: WORLD, zoom: 2 });     // background
  const got = await controller.update({ bounds: view, zoom: 7, minZoom: 2 });
  const viewTiles = got?.tiles ?? 0;
  const before = controller.stats().visible;
  const world = (await pinning).tiles;
  const after = controller.stats().visible;
  ok("the view landed first, as it does for a layer off its own pyramid",
    viewTiles > 0 && before === viewTiles, `${viewTiles} view tiles, ${before} visible`);
  ok("and the world landing after it goes UNDER the view rather than replacing it",
    after === world + viewTiles, `visible ${before} → ${after}, world ${world}`);
}

{
  // The ordinary order still works: the world first, then the view on top.
  slow.clear();
  const controller = createTiledVectorLayer({
    name: "soil", kind: "units", maxZoom: 7,
    sources: { local: "/tiles", has: () => true, maxZoom: 7 },
  });
  const world = (await controller.pin({ bounds: WORLD, zoom: 2 })).tiles;
  const got = await controller.update({ bounds: view, zoom: 7, minZoom: 2 });
  ok("pinned first, the view still lands on top of the whole world",
    controller.stats().visible === world + got.tiles);
}
