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

// Seams: across every edge of every leaf, edgeSteps reports how many levels
// coarser the leaf on the other side is -- exactly what the shader eases to
// at that edge.
{
  const leaves = T.selectLeaves(london, 300, 30000, { maxLeaves: Infinity });
  const set = new Set(leaves.map((L) => `${L.z}/${L.x}/${L.y}`));
  const isLeaf = (z, x, y) => set.has(`${z}/${x}/${y}`);
  let steps = 0, wrong = 0;
  for (const L of leaves) {
    const st = T.edgeSteps(L.z, L.x, L.y, isLeaf);
    const n = 2 ** L.z;
    const across = [[L.x, L.y - 1], [L.x, L.y + 1], [(L.x - 1 + n) % n, L.y], [(L.x + 1) % n, L.y]];
    st.forEach((k, e) => {
      const [nx, ny] = across[e];
      if (k > 0) {
        steps++;
        if (!isLeaf(L.z - k, nx >> k, ny >> k)) wrong++;
      }
    });
  }
  check(`level boundaries found (${steps}) and each names the coarser leaf`, steps > 20 && wrong === 0, String(wrong));
  check("the finest tile under the aircraft has no coarser neighbour", T.edgeSteps(leaves[0].z, leaves[0].x, leaves[0].y, isLeaf).every((k) => k === 0));
  check("a step is at most a couple of levels (the quadtree is balanced enough)", leaves.every((L) => T.edgeSteps(L.z, L.x, L.y, isLeaf).every((k) => k <= 3)));
}

/* ── Terrain to a flight-sim standard: filtered heights, stitched edges ──── */
{
  // A cliff: 0 m west of lon 0, 200 m east of it. One point sample at the
  // edge reads one side or the other; the filter reads the cell's mix.
  const cliff = (lat, lon) => (lon >= 0 ? 200 : 0);
  const f = T.filteredGround(cliff, 50, 0, 0.001, 0.001);
  check("a vertex on a cliff edge takes its cell's mix, not one side", f > 0 && f < 200, String(f));
  check("on even ground the filter changes nothing", T.filteredGround(() => 42, 50, 0, 0.01, 0.01) === 42);
  check("missing samples are skipped, not read as zero",
    T.filteredGround((la, lo) => (lo > 0 ? null : 10), 50, 0, 0.01, 0.01) === 10);

  // Stitching: an N=4 tile whose north neighbour is one level coarser with a
  // grid of 2 (vertex every half neighbour-tile = one of ours). The
  // neighbour's edge heights at its vertices are 0, 100, 0 (param 0, .5, 1 of
  // the neighbour); our tile is the neighbour's west half (o = 0).
  const N = 4, hM = new Float32Array((N + 1) * (N + 1)).fill(55);
  const nbAt = (p) => (p === 0.5 ? 100 : 0);           // the neighbour's own vertices
  T.stitchEdges(hM, N, [1, 0, 0, 0],
    () => ({ o: 0, Nc: 2 }),
    (e, sp, up) => nbAt(Math.round((sp / 2 ** up) * 1000) / 1000));
  const north = [0, 1, 2, 3, 4].map((i) => Math.round(hM[i]));
  check("a fine edge follows its coarse neighbour's line exactly (no crack)",
    JSON.stringify(north) === JSON.stringify([0, 25, 50, 75, 100]), JSON.stringify(north));
  check("...and only that edge is touched", hM[(N + 1) * 2 + 2] === 55);
  check("no step, no stitch", (() => { const g = new Float32Array(25).fill(7); T.stitchEdges(g, 4, [0, 0, 0, 0], () => ({}), () => 0); return g.every((v) => v === 7); })());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
