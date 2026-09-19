// The layered model: soil over bedrock over one surface, water from the sea
// surface to the bathymetry, each volume a closed shell whose volume is what
// the heights say it must be.
import { layerHeights, layeredVolumes, betweenFacets, facetsVolume, facetsClosed, facetsStl, tinWith } from "./layered-model.js";
import { channelDepth } from "./inundation.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`layered-model: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A 6×6-node grid, 100 m spacing, as a TIN: two triangles a cell.
function gridTin(nx = 6, ny = 6, step = 100, zOf = () => 50) {
  const n = nx * ny;
  const xs = new Float64Array(n); const ys = new Float64Array(n); const z = new Float64Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; xs[k] = i * step; ys[k] = j * step; z[k] = zOf(i, j); }
  const tris = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    tris.push([a, b, d], [a, d, c]);
  }
  return tinWith({ xs, ys, tris }, z);
}

// Flat ground at 50 m, soil 10 m thick everywhere: soil volume 500×500×10.
{
  const tin = gridTin();
  const L = layerHeights(tin, { thicknessAt: () => 10, water: false });
  ok("bedrock is the ground minus the thickness", L.bedrock.every((b, i) => close(b, tin.z[i] - 10)));
  const V = layeredVolumes(tin, L, { belowM: 1000, aboveM: 200, water: false });
  const soil = V.volumes.find((v) => v.id === "soil");
  const rock = V.volumes.find((v) => v.id === "bedrock");
  const air = V.volumes.find((v) => v.id === "atmosphere");
  ok("the soil shell is closed", facetsClosed(soil.facets).closed, JSON.stringify(facetsClosed(soil.facets)));
  ok("the soil holds area × thickness", close(facetsVolume(soil.facets), 500 * 500 * 10), `${facetsVolume(soil.facets)}`);
  ok("the bedrock shell is closed", facetsClosed(rock.facets).closed);
  ok("the bedrock runs from its top to the base", close(facetsVolume(rock.facets), 500 * 500 * (40 - V.baseZ)));
  ok("the base is below the lowest bedrock by the depth", close(V.baseZ, 40 - 1000));
  ok("the atmosphere is closed and holds its column", facetsClosed(air.facets).closed && close(facetsVolume(air.facets), 500 * 500 * 200));
  ok("soil + bedrock fill the ground to the base", close(facetsVolume(soil.facets) + facetsVolume(rock.facets), 500 * 500 * (50 - V.baseZ)));
  const stl = facetsStl(soil.facets, "soil");
  ok("the STL is written with a facet per triangle", stl.split("facet normal").length - 1 === soil.facets.length);
}

// A minimum soil thickness is kept where the model says none.
{
  const tin = gridTin();
  const L = layerHeights(tin, { thicknessAt: () => 0, minSoilM: 1, water: false });
  ok("a zero thickness keeps the minimum", L.bedrock.every((b, i) => close(b, tin.z[i] - 1)));
}

// Sea: the western half is seabed at −20 m on the ocean mask; the eastern half
// is land at +10 m. Water is 0 down to −20 over the wet triangles.
{
  const tin = gridTin(6, 6, 100, (i) => (i <= 2 ? -20 : 10));
  const ocean = (k) => (k % 6) <= 2;
  const L = layerHeights(tin, { thicknessAt: () => 5, oceanAt: ocean });
  ok("sea nodes stand at 0 m", [...L.water].every((w, k) => (ocean(k) ? w === 0 : w === tin.z[k])));
  ok("sea nodes are counted", L.counts.sea === 18);
  ok("the seabed is the bathymetry", L.solid.every((s, k) => s === tin.z[k]));
  ok("the atmosphere's floor is the sea surface over the sea", [...L.top].every((t, k) => (ocean(k) ? t === 0 : t === 10)));
  const V = layeredVolumes(tin, L, { belowM: 500, aboveM: 0 });
  const water = V.volumes.find((v) => v.id === "water");
  ok("the water shell is closed", facetsClosed(water.facets).closed, JSON.stringify(facetsClosed(water.facets)));
  // Wet triangles: every node wet — columns 0..2, so a 200 m × 500 m strip of
  // 20 m deep water.
  ok("the water holds the wet strip's depth", close(facetsVolume(water.facets), 200 * 500 * 20), `${facetsVolume(water.facets)}`);
}

// A lake: surveyed level 100 m over DEM 95 m — the bed is the DEM.
{
  const tin = gridTin(6, 6, 100, () => 95);
  const L = layerHeights(tin, { lakeAt: () => ({ level: 100, depth: 8 }), thicknessAt: () => 3 });
  ok("a lake stands at its level over the DEM's bed", L.water.every((w) => w === 100) && L.solid.every((s) => s === 95));
  const V = layeredVolumes(tin, L, { belowM: 100 });
  const water = V.volumes.find((v) => v.id === "water");
  ok("the lake holds area × (level − bed)", close(facetsVolume(water.facets), 500 * 500 * 5));
}

// A river 200 m wide: water surface is the DEM, bed a channel depth below.
{
  const tin = gridTin(6, 6, 100, () => 30);
  const L = layerHeights(tin, { riverWidthAt: () => 200, thicknessAt: () => 4 });
  const d = channelDepth(200);
  ok("a river's bed is a channel depth under the DEM", L.solid.every((s) => close(s, 30 - d)) && L.water.every((w) => w === 30));
  ok("the soil sits under the river bed", L.bedrock.every((b) => close(b, 30 - d - 4)));
}

// Walls collapse where the two surfaces meet at one end: a wedge of soil from
// 0 at the west edge to 10 m at the east still closes.
{
  const tin = gridTin();
  const L = layerHeights(tin, { thicknessAt: (k) => (k % 6) * 2, minSoilM: 0, water: false });
  const V = layeredVolumes(tin, L, { belowM: 100, water: false });
  const soil = V.volumes.find((v) => v.id === "soil");
  ok("a wedge that pinches to zero still closes", facetsClosed(soil.facets).closed, JSON.stringify(facetsClosed(soil.facets)));
  // Thickness rises 2 m per 100 m: mean over the 500 m × 500 m block is 5 m.
  ok("and holds its mean thickness", close(facetsVolume(soil.facets), 500 * 500 * 5, 1e-6), `${facetsVolume(soil.facets)}`);
}

import { thinLayerSizeM, facetsStlByFace, layeredGmshScript, LAYER_FLAGS } from "./layered-model.js";
{
  const thick = Array.from({ length: 100 }, (_, i) => 2 + i * 0.1);  // p10 ≈ 3
  ok("a thin layer's size is twenty times its thin end", close(thinLayerSizeM(thick, 150), 20 * thick[Math.floor(0.1 * 99)]));
  ok("never above the model's own size", thinLayerSizeM([100, 200], 150) === 150);
  ok("never below 5 m", thinLayerSizeM([0.01, 0.02], 150) === 5);
  const tin = gridTin();
  const L = layerHeights(tin, { thicknessAt: () => 10, water: false });
  const V = layeredVolumes(tin, L, { belowM: 100, water: false });
  const soil = V.volumes.find((v) => v.id === "soil");
  const stl = facetsStlByFace(soil.facets, "soil");
  ok("the STL is one solid per face name", (stl.text.match(/^solid /gm) || []).length === stl.faces.length && stl.faces.includes("bedrock_top") && stl.faces.includes("top"));
  const py = layeredGmshScript({ name: "m", stlFile: "m_soil.stl", meshFile: "m_soil.msh", meshSizeM: 60, faceFlags: LAYER_FLAGS, volumeFlag: LAYER_FLAGS.soil, volumeName: "soil" });
  ok("the script tags faces by name, not by shape", py.includes("getEntityName(2, t)") && !py.includes("classifySurfaces"));
  ok("the script tags points reached only through adjacencies", py.includes("getAdjacencies(0, point)"));
  ok("the soil and the bedrock share the interface's flag", LAYER_FLAGS.bedrock_top !== LAYER_FLAGS.top && py.includes(`"bedrock_top":${LAYER_FLAGS.bedrock_top}`));
}

import { facetsArea, estimateElements, estimateSentence, ELEMENT_BANDS } from "./layered-model.js";
{
  const tin = gridTin();
  const L = layerHeights(tin, { thicknessAt: () => 10, water: false });
  const V = layeredVolumes(tin, L, { belowM: 1000, water: false });
  const soil = V.volumes.find((v) => v.id === "soil");
  ok("a flat top's area is its plan area", close(facetsArea(soil.facets, "top"), 500 * 500), `${facetsArea(soil.facets, "top")}`);
  ok("a closed slab's whole area is its six sides", close(facetsArea(soil.facets), 2 * 500 * 500 + 4 * 500 * 10));

  // A thick block: volume decides. 1 km³ at 100 m is 1e9 / (0.11785e6).
  const block = estimateElements({ volumeM3: 1e9, topAreaM2: 1e6, sizeM: 100 });
  ok("a thick block is counted by its volume", block.by === "volume" && close(block.tets, 1e9 / 0.11785e6, 1e-3), JSON.stringify(block));
  // A skin: 10 m of soil over 1,000 km² at 20 m — the top surface decides.
  const skin = estimateElements({ volumeM3: 1e9 * 10, topAreaM2: 1e9, sizeM: 20 });
  ok("a thin skin is counted by its surface", skin.by === "skin" && close(skin.tets, 3 * 1e9 / (0.43301 * 400), 1e-3), JSON.stringify(skin));
  ok("and is a compute-target job", skin.verdict === "compute" && skin.tets > ELEMENT_BANDS.compute);
  ok("which the sentence says", /compute-target/.test(estimateSentence(skin)) && /million/.test(estimateSentence(skin)));
  ok("the Izmit bedrock at 2 km is a laptop job of the measured order", (() => {
    const e = estimateElements({ volumeM3: 5.8e12, topAreaM2: 966e6, sizeM: 2000 });
    return e.verdict === "laptop" && e.tets > 3000 && e.tets < 15000;
  })());
  ok("halving the size costs eight times a block and four times a skin",
    close(estimateElements({ volumeM3: 1e9, sizeM: 50 }).tets / block.tets, 8, 1e-3)
    // 1 m over 1,000 km²: still a skin at both sizes, so the surface decides both.
    && close(estimateElements({ volumeM3: 1e9, topAreaM2: 1e9, sizeM: 10 }).tets / estimateElements({ volumeM3: 1e9, topAreaM2: 1e9, sizeM: 20 }).tets, 4, 1e-3));
  ok("a layer stops being a skin once its elements are as thin as it is",
    estimateElements({ volumeM3: 1e10, topAreaM2: 1e9, sizeM: 10 }).by === "volume" && skin.by === "skin");
  ok("nodes are about a fifth of the tetrahedra", close(block.nodes, block.tets / 5, 1e-3));
  ok("no volume, no size: nothing, not NaN", estimateElements({ volumeM3: 0, sizeM: 20 }).verdict === "empty" && estimateElements({ volumeM3: 1e6, sizeM: 0 }).tets === 0);
}
{
  const e = estimateElements({ volumeM3: 1e10, topAreaM2: 1e9, sizeM: 20 });
  const args = { name: "m", stlFile: "m.stl", meshFile: "m.msh", meshSizeM: 20, faceFlags: LAYER_FLAGS, volumeFlag: 12, volumeName: "soil" };
  const py = layeredGmshScript({ ...args, estimate: e });
  ok("the script says how big it is before it is run", /# Estimated before meshing: about 17\.3 million elements/.test(py) && py.includes("compute target, not on a laptop"));
  ok("and says nothing where no estimate was made", !layeredGmshScript(args).includes("Estimated before meshing"));
}
