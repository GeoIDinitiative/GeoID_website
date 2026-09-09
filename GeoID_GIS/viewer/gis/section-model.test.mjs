import { profileAlong, profileHeightAt, sectionPolygons, ringArea, sectionPositions, sectionGmshScript, profileCsv, triangulateRing } from "./section-model.js";
import { makeLocalFrame } from "./model-build.js";

let passes = 0; let failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes += 1; else failures += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const near = (name, got, want, tol) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

const R = 6371.0088;
const frame = makeLocalFrame({ lat: 54, lon: -6, radiusKm: R });
const plane = (lat, lon) => { const l = frame.toLocal(lat, lon); return 100 + 0.01 * l.x + 0.02 * l.y; };
const a = { lat: 53.97, lon: -6.05 }; const b = { lat: 54.03, lon: -5.95 };
const p = profileAlong({ a, b, n: 101, heightAt: plane, radiusKm: R, frame });
check("a profile builds", p.ok, p.message);
near("101 samples", p.n, 101, 0);
{
  const A = frame.toLocal(a.lat, a.lon); const B = frame.toLocal(b.lat, b.lon);
  near("its length is the local distance A–B", p.lengthM, Math.hypot(B.x - A.x, B.y - A.y), 1e-6);
  let worst = 0;
  for (let i = 0; i < p.n; i += 1) worst = Math.max(worst, Math.abs(p.z[i] - plane(p.lats[i], p.lons[i])));
  near("every sample carries the plane's height", worst, 0, 1e-9);
  const mid = profileHeightAt(p, p.lengthM / 2);
  near("the height half way along is the plane at the midpoint", mid, plane((a.lat + b.lat) / 2, (a.lon + b.lon) / 2), 1e-6);
  check("off the ends is clamped, not null", Number.isFinite(profileHeightAt(p, -100)) && Number.isFinite(profileHeightAt(p, 1e9)));
}
{
  const polys = sectionPolygons(p, { belowM: 2000, aboveM: 3000 });
  near("the base is 2 km under the lowest sample", polys.baseZ, p.zMin - 2000, 1e-9);
  near("the sky is 3 km over the highest", polys.skyZ, p.zMax + 3000, 1e-9);
  // area under a straight profile is a trapezoid: length × mean height above the base
  const meanH = (p.z[0] + p.z[p.n - 1]) / 2 - polys.baseZ;
  near("the rock face's area is the trapezoid under the profile", ringArea(polys.rock), p.lengthM * meanH, 1);
  const meanA = polys.skyZ - (p.z[0] + p.z[p.n - 1]) / 2;
  near("the air face's area is the trapezoid over it", ringArea(polys.air), p.lengthM * meanA, 1);
  check("both wound counter-clockwise", ringArea(polys.rock) > 0 && ringArea(polys.air) > 0);
  check("no rock without a depth", sectionPolygons(p, { aboveM: 500 }).rock === null);
  const tri = sectionPositions(p, polys.rock);
  near("the rock face fans into ring-length minus two triangles", tri.length / 9, polys.rock.length - 2, 0);
  // every triangle's vertices lie on the line's vertical plane: their plan positions are on A–B
  let off = 0;
  for (let i = 0; i < tri.length; i += 3) { const x = tri[i]; const y = tri[i + 1]; const t = ((x - p.start.x) * p.dir.x + (y - p.start.y) * p.dir.y); const px = p.start.x + p.dir.x * t; const py = p.start.y + p.dir.y * t; off = Math.max(off, Math.hypot(x - px, y - py)); }
  near("the face stands in the vertical plane through the line (float32 positions)", off, 0, 1e-2);
}
{
  const script = sectionGmshScript({ name: "sec", profile: p, belowM: 2000, aboveM: 3000, meshSizeM: 150, embedPoints: [{ s: 1000, z: 50, name: "well" }] });
  check("two plane surfaces sharing the profile", /surfaces\["subsurface"\] = gmsh\.model\.geo\.addPlaneSurface/.test(script) && /surfaces\["atmosphere"\] = gmsh\.model\.geo\.addPlaneSurface/.test(script) && /\[-c for c in reversed\(top_curves\)\]/.test(script) && /addCurveLoop\(top_curves \+ \[awall_r, sky, awall_l\]\)/.test(script));
  check("the profile is flag 1 on both faces, the base 2, the sky 4, the sides 5 and 6", /flags\["top"\], name="top"/.test(script) && /flags\["base"\], name="base"/.test(script) && /flags\["sky"\], name="sky"/.test(script) && /flags\["sides_below"\]/.test(script) && /flags\["sides_above"\]/.test(script));
  check("the embedded point is placed in whichever face holds it", /gmsh\.model\.isInside\(2, surf, \[ps, pz, 0\.0\]\)/.test(script) && /\[1000,50,/.test(script));
  check("it meshes in two dimensions", /gmsh\.model\.mesh\.generate\(2\)/.test(script) && /gmsh\.write\("sec\.msh"\)/.test(script));
  const only = sectionGmshScript({ name: "s2", profile: p, belowM: 1000 });
  check("no atmosphere, no air face", !/surfaces\["atmosphere"\]/.test(only) && /surfaces\["subsurface"\]/.test(only));
  const csv = profileCsv(p).split("\n");
  check("the CSV carries one row per sample with its coordinates", csv[0] === "s_m,lat,lon,z_m" && csv.length === p.n + 2);
}

/* ── The faces do not overlap: a ridge between A and B, the case a fan gets wrong ── */
{
  const ridge = (lat, lon) => { const l = frame.toLocal(lat, lon); return 100 + 800 * Math.exp(-((l.x) ** 2) / (1500 ** 2)); };
  const pr = profileAlong({ a, b, n: 121, heightAt: ridge, radiusKm: R, frame });
  const polys = sectionPolygons(pr, { belowM: 2000, aboveM: 1500 });
  const triArea = (ring, [i, j, k]) => Math.abs((ring[j][0] - ring[i][0]) * (ring[k][1] - ring[i][1]) - (ring[k][0] - ring[i][0]) * (ring[j][1] - ring[i][1])) / 2;
  const centroidInRock = (ring, tri) => {
    const cs = (ring[tri[0]][0] + ring[tri[1]][0] + ring[tri[2]][0]) / 3;
    const cz = (ring[tri[0]][1] + ring[tri[1]][1] + ring[tri[2]][1]) / 3;
    return cz < profileHeightAt(pr, cs);
  };
  for (const [name, ring, wantRock] of [["rock", polys.rock, true], ["air", polys.air, false]]) {
    const tris = triangulateRing(ring);
    near(`${name} face: the triangles tile the ring's area`, tris.reduce((sum, tri) => sum + triArea(ring, tri), 0), ringArea(ring), 1e-3);
    check(`${name} face: no triangle of it sits in the other domain`, tris.every((tri) => centroidInRock(ring, tri) === wantRock));
    near(`${name} face: n − 2 triangles`, tris.length, ring.length - 2, 0);
  }
  // The fan the faces used to be built from FAILS this on the same ridge -- the control.
  const fan = []; for (let i = 1; i < polys.air.length - 1; i += 1) fan.push([0, i, i + 1]);
  check("control: a fan from A puts air triangles in the rock on a ridge", fan.some((tri) => centroidInRock(polys.air, tri)));
  check("the 3D positions come from the same triangulation", sectionPositions(pr, polys.air).length === triangulateRing(polys.air).length * 9);
}

/* ── Structural pins on the pages that carry a section and edit its flags ── */
{
  const { readFileSync } = await import("node:fs");
  const pipeline = readFileSync(new URL("./model-pipeline.js", import.meta.url), "utf8");
  const studio = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
  check("the builder offers 3D, 2D surface-only and 2D cross-section", /\{ id: "3d", label: "3D block/.test(pipeline) && /\{ id: "surface", label: "2D surface only/.test(pipeline) && /\{ id: "section", label: "2D cross-section/.test(pipeline));
  check("a section's surface step is the profile, built from the finest DEM", /function stepProfile\(body\)/.test(pipeline) && /const best = await ensureBestDem\(box\);/.test(pipeline) && /profileAlong\(\{ a: sec\.a, b: sec\.b, n: sec\.n, heightAt: source\.read/.test(pipeline));
  check("A and B are picked on the globe and default west–east through the centre", /Pick \$\{end\.toUpperCase\(\)\} on the globe/.test(pipeline) && /sec\.a = \{ lat: c\.lat, lon: b0\.west \+/.test(pipeline));
  check("the section package is a CSV, a faces STL, a 2D gmsh script and a dim-2 spec", /meshes\/\$\{name\}_section\.csv/.test(pipeline) && /meshes\/\$\{name\}_section\.stl/.test(pipeline) && /meshes\/\$\{name\}_section_gmsh\.py/.test(pipeline) && /domain: state\.domain\.type, dim: 2,/.test(pipeline));
  check("surface-only writes the surface STL and no shells", /const surfaceOnly = state\.kind === "surface";/.test(pipeline) && /if \(!surfaceOnly\) await store\.writeProjectFile\(`meshes\/\$\{name\}_domain\.stl`/.test(pipeline));
  check("the profile's CRS is stated in the spec", /crs: `2D: s = metres along the line from A, z = metres above sea level;/.test(pipeline));
  check("the studio adopts a section as faces in the vertical plane", /export function adoptSectionModel\(/.test(studio) && /sectionPositions\(profile, ring, 1\)/.test(studio) && /adoptTerrainSolid, adoptSectionModel, extendTerrain,/.test(studio));
  check("the studio reads lat/lon through the terrain's frame, section or TIN", /function terrainFrame\(\)/.test(studio) && /gisTerrain\?\.surface\?\.frame \|\| gisTerrain\?\.frame/.test(studio) && /function terrainHeightAt\(x, y\)/.test(studio) && /return profileHeightAt\(p, sM\);/.test(studio));
  check("every part's flag is edited on its card and its row, and the GIS page is told", /function flagKeysOf\(part\)/.test(studio) && /function assignFlag\(/.test(studio) && /pipeline\?\.setFlag\?\.\(key, n\)/.test(studio) && /pipeline\?\.setPointFlag\?\.\(point, n\)/.test(studio) && /row\.appendChild\(flagBox\)/.test(studio) && /if \(k === "Physical flag"\) \{/.test(studio));
  check("a section face edits its edges' flags too", /\{ own: "subsurface", edges: \[\["base", "base"\], \["sides", "sides_below"\]\] \}/.test(studio) && /\{ own: "atmosphere", edges: \[\["sky", "sky"\], \["sides", "sides_above"\]\] \}/.test(studio));
  check("the builder offers gmsh's fields: point, boundary, box, ball, formula, with the cap optional", /function sizeFieldControls\(body\)/.test(pipeline) && /\[\["point", "\+ At a point"\], \["boundary", "\+ Along a boundary"\], \["box", "\+ In a box"\], \["ball", "\+ In a circle"\], \["expr", "\+ A formula"\]\]/.test(pipeline) && /blank = gmsh decides/.test(pipeline) && /function resolveSizeFields\(which\)/.test(pipeline) && /function drawSizeFields\(\)/.test(pipeline));
  check("both packages carry the fields and the options, and say what was left out", /sizeFields: resolvedRock\.fields,/.test(pipeline) && /sizeFields: resolvedAir\.fields,/.test(pipeline) && /sizeFields: resolved\.fields, meshOptions,/.test(pipeline) && /left_out: resolved\.skipped,/.test(pipeline) && /left_out: resolvedRock\.skipped,/.test(pipeline));
  check("a boundary field goes only into the script whose flag it names", /const SCRIPT_KEYS = \{ subsurface: \["top", "base", "sides_below"\], atmosphere: \["top", "sky", "sides_above"\]/.test(pipeline));
  check("the model page adds a size field from a part's card through the seam", /addSizeField: \(spec\) => \{/.test(pipeline) && /setPointSize: \(name, value\) => \{/.test(pipeline) && /pipeline\.addSizeField\(spec\)/.test(studio) && /type: "boundary", name: `size along \$\{keys\.own\}`/.test(studio) && /type: "point", name: `size at \$\{keys\.point\}`, pointName: keys\.point/.test(studio));
  check("a section face's size is a box over the face, a 3D face's a boundary field", /gisTerrain\?\.kind === "section" && part\.kind === "face"/.test(studio) && /type: "box", name: `size in the \$\{part\.which\} face`/.test(studio));
  check("a point's chosen size reaches its embed entry", /sizeM: sizeFor\(f\.properties\?\.name/.test(pipeline) && /state\.pointSizeByName\.get\(String\(name\)\)/.test(pipeline));
  check("a section's later steps unblock on the profile, not on a surface it never builds", /state\.kind === "section" \? !state\.profile : !state\.surface/.test(pipeline));
  check("the pipeline carries a flag chosen on the model page into the package", /setFlag: \(key, value\) => \{/.test(pipeline) && /setPointFlag: \(name, value\) => \{/.test(pipeline) && /state\.pointFlagByName\.get\(/.test(pipeline));
}

process.on("exit", () => { console.log(`section-model: ${passes} passed, ${failures} failed`); if (failures) process.exitCode = 1; });
