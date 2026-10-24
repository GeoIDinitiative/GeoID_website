// Earth Flight's ground quadtree: the leaves cover the ground round the
// aircraft exactly once (no overlaps, no holes), are finest under it, and an
// unloaded tile's crop of its ancestor lands on the right part of the image.
//
//   node GeoID_GIS/viewer/gis/flight-tiles.test.mjs

const T = await import("./flight-tiles.js");

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};

const london = { lat: 51.5, lon: -0.12 };
for (const altM of [150, 300, 1500, 6000]) {
  const reach = Math.max(25000, Math.min(400000, 1.4 * Math.sqrt(2 * 6371000 * altM)));
  const leaves = T.selectLeaves(london, altM, reach, { maxLeaves: Infinity });
  check(`${altM} m: within the leaf budget (${leaves.length})`, leaves.length <= T.MAX_LEAVES);
  const under = leaves[0];
  check(`${altM} m: the nearest leaf contains the aircraft`, under.d <= altM + 1e-6 && T.distToTileM(london.lat, london.lon, under.z, under.x, under.y) === 0);
  if (altM <= 300) check(`${altM} m: finest imagery (z${T.MAX_Z}) under the aircraft`, under.z === T.MAX_Z, `z${under.z}`);
  // No leaf is an ancestor of another: the surface never overlaps itself.
  const set = new Set(leaves.map((L) => `${L.z}/${L.x}/${L.y}`));
  let overlap = 0;
  for (const L of leaves) for (let up = 1; up <= L.z - 7; up++) if (set.has(`${L.z - up}/${L.x >> up}/${L.y >> up}`)) overlap++;
  check(`${altM} m: leaves never overlap`, overlap === 0, `${overlap}`);
  // Every point near the aircraft is covered by exactly one leaf.
  let holes = 0;
  for (let k = 0; k < 400; k++) {
    const a = (k * 2.399963) % (2 * Math.PI), r = Math.sqrt(k / 400) * Math.min(reach * 0.5, 20000);
    const lat = london.lat + r * Math.cos(a) / 111320, lon = london.lon + r * Math.sin(a) / (111320 * Math.cos(london.lat * Math.PI / 180));
    const n = leaves.filter((L) => T.distToTileM(lat, lon, L.z, L.x, L.y) === 0).length;
    if (n < 1) holes++;
  }
  check(`${altM} m: no holes in the ground round the aircraft`, holes === 0, `${holes}/400`);
}

// Ancestor crop: z10 tile (x=4*xa+1, y=4*ya+2) is the second column, third row
// of its z8 ancestor: u from 0.25, v (bottom-up) from 0.25, a quarter wide.
const [ou, ov, sc] = T.ancestorCrop(10, 4 * 100 + 1, 4 * 200 + 2, 8, 100, 200);
check("ancestor crop offset and scale", ou === 0.25 && ov === 0.25 && sc === 0.25, `${ou},${ov},${sc}`);
check("tile maths round trip", Math.abs(T.tileYToLat(T.latToTileY(51.5, 12), 12) - 51.5) < 1e-9 && Math.abs(T.tileXToLon(T.lonToTileX(-0.12, 12), 12) + 0.12) < 1e-9);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
