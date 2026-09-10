/**
 * Variable-resolution sampling, against answers known on paper: a spacing
 * function with a closed form, a lattice whose node count is arithmetic, a
 * PLANE a TIN must reproduce exactly, and shells that must be closed.
 */
import {
  spacingFn, bufferLocal, bufferDistance, quadtreeLattice, boundaryLoop, buildTin,
  tinHeightAt, tinSurfaceStl, tinShellStl, samplingSizeField, extendBoundary,
  extendedBoundaryLines, despikeTin, shellPositions, gridAsTin, tinToGrid,
} from "./surface-sampling.js";
import { buildSurface, domainStl } from "./model-build.js";
import { makeLocalFrame, stlStats, gmshScript, structuredFieldText } from "./model-build.js";

let failures = 0;
let passes = 0;
function check(name, ok, detail = "") {
  if (ok) passes += 1; else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
const near = (name, got, want, tol) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

// ── The spacing function ──────────────────────────────────────────────────────
{
  const square = { name: "sq", shape: "square", cx: 0, cy: 0, halfM: 500, stepM: 25, gradeM: null };
  const s = spacingFn({ baseM: 200, buffers: [square], gradeM: 500 });
  near("inside a square buffer: the buffer's step", s(100, -400), 25, 1e-9);
  near("on the edge: still the buffer's step", s(500, 0), 25, 1e-9);
  near("halfway through the grade: halfway between", s(750, 0), 112.5, 1e-9);
  near("past the grade: the base", s(1200, 0), 200, 1e-9);
  near("the square is a square, not a disc: a corner is inside", s(499, 499), 25, 1e-9);
  const circle = { name: "c", shape: "circle", cx: 0, cy: 0, halfM: 500, stepM: 25, gradeM: 0 };
  const sc = spacingFn({ baseM: 200, buffers: [circle], gradeM: 0 });
  near("a circle's corner is outside", sc(499, 499), 200, 1e-9);
  near("no grade: a hard edge", sc(501, 0), 200, 1e-9);
  const coarse = { name: "k", shape: "square", cx: 0, cy: 0, halfM: 2000, stepM: 100, gradeM: 0 };
  const both = spacingFn({ baseM: 200, buffers: [coarse, square], gradeM: 0 });
  near("finest wins where buffers overlap", both(0, 0), 25, 1e-9);
  near("the coarser buffer still refines the base around it", both(1500, 0), 100, 1e-9);
  const loose = { name: "l", shape: "square", cx: 0, cy: 0, halfM: 500, stepM: 900, gradeM: 0 };
  near("a buffer coarser than the base cannot coarsen it", spacingFn({ baseM: 200, buffers: [loose] })(0, 0), 200, 1e-9);
  near("signed distance, circle", bufferDistance(circle, 300, 400), 0, 1e-9);
}

// ── A buffer from what somebody types ─────────────────────────────────────────
{
  const frame = makeLocalFrame({ lat: 54, lon: -6, radiusKm: 6371.0088 });
  const b = bufferLocal({ shape: "circle", lat: 54, lon: -6, sizeKm: 2, stepM: null }, frame, 30);
  near("a 2 km circle is a 1,000 m radius", b.halfM, 1000, 1e-9);
  near("native resolves to the DEM's own step", b.stepM, 30, 1e-9);
  check("centred at the origin", Math.abs(b.cx) < 1e-6 && Math.abs(b.cy) < 1e-6);
}

// ── The lattice ───────────────────────────────────────────────────────────────
{
  const uniform = quadtreeLattice({ x0: 0, y0: 0, widthM: 1000, heightM: 1000, spacing: () => 100 });
  near("uniform 100 m over 1 km square: 11 x 11 nodes", uniform.points.length, 121, 0);
  near("and 100 leaves", uniform.leaves, 100, 0);
  check("not capped", !uniform.capped && uniform.factor === 1);
  const buffered = quadtreeLattice({
    x0: 0, y0: 0, widthM: 1000, heightM: 1000,
    spacing: (x, y) => (Math.hypot(x - 500, y - 500) < 200 ? 25 : 100),
  });
  check("a fine buffer adds nodes", buffered.points.length > 121, String(buffered.points.length));
  check("and goes deeper", buffered.deepest >= 2, String(buffered.deepest));
  const capped = quadtreeLattice({ x0: 0, y0: 0, widthM: 1000, heightM: 1000, spacing: () => 100, maxNodes: 50 });
  check("a node budget coarsens everything, never truncates", capped.capped && capped.points.length <= 50 && capped.factor > 1,
    `${capped.points.length} nodes, factor ${capped.factor}`);
}

// ── A plane through a TIN comes back as the plane ─────────────────────────────
const bounds = { west: -6.05, east: -5.95, south: 53.97, north: 54.03 };
const R = 6371.0088;
const frame0 = makeLocalFrame({ lat: 54, lon: -6, radiusKm: R });
const plane = (lat, lon) => { const l = frame0.toLocal(lat, lon); return 10 + 0.002 * l.x + 0.003 * l.y; };
const tin = buildTin({
  bounds, radiusKm: R, heightAt: plane, maxNodes: 40000,
  spacing: { baseM: 400, gradeM: 300, buffers: [{ shape: "circle", lat: 54, lon: -6, sizeKm: 1.5, stepM: 50 }] },
  nativeM: 30,
});
check("the TIN builds", tin.ok, tin.message);
{
  let worst = 0;
  for (let i = 0; i < tin.nodes; i += 1) worst = Math.max(worst, Math.abs(tin.z[i] - plane(tin.lats[i], tin.lons[i])));
  near("every node carries the plane's own height", worst, 0, 1e-9);
  const probe = [[0, 0], [123.4, -321.9], [-2000, 1500], [2500, -1700]];
  let off = 0;
  probe.forEach(([x, y]) => {
    const got = tinHeightAt(tin, x, y);
    const ll = frame0.fromLocal(x, y);
    off = Math.max(off, Math.abs(got - plane(ll.lat, ll.lon)));
  });
  near("and interpolates the plane exactly between them", off, 0, 1e-6);
  check("off the TIN is null, not a number", tinHeightAt(tin, 1e6, 1e6) === null);
  check("finer inside the buffer than outside", tin.spacingMinM <= 50 && tin.spacingMaxM >= 400 * 0.5,
    `${tin.spacingMinM}–${tin.spacingMaxM}`);
  check("one rim, closed", tin.loops === 1 && tin.loop.length > 4, `${tin.loops} loops, ${tin.loop.length} nodes`);
  const sw = frame0.toLocal(bounds.south, bounds.west);
  const ne = frame0.toLocal(bounds.north, bounds.east);
  const ext = extendBoundary(tin, { belowM: 2000, aboveM: 3000 });
  near("SW corner is the box's", Math.hypot(ext.corners[0].x - sw.x, ext.corners[0].y - sw.y), 0, 1e-6);
  near("NE corner is the box's", Math.hypot(ext.corners[2].x - ne.x, ext.corners[2].y - ne.y), 0, 1e-6);
  near("the base is 2 km under the lowest node", ext.baseZ, tin.zMin - 2000, 1e-9);
  near("the sky is 3 km over the highest", ext.skyZ, tin.zMax + 3000, 1e-9);
  near("eight lines per level: a rim and four verticals", extendedBoundaryLines(tin, ext).length, 16, 0);
  check("no sky when not asked", extendBoundary(tin, { belowM: 500 }).skyZ === null);
}

// ── The shells close ──────────────────────────────────────────────────────────
{
  const skin = stlStats(tinSurfaceStl(tin, "t"));
  near("the skin has the TIN's triangles", skin.triangles, tin.triangles, 0);
  const below = tinShellStl(tin, { belowM: 1500, name: "d" });
  const sb = stlStats(below.text);
  check("the subsurface shell is watertight", sb.closed && sb.openEdges === 0, `${sb.openEdges} open edges`);
  near("its Euler characteristic is a ball's", sb.euler, 2, 0);
  near("its base sits 1.5 km under the lowest node", below.baseZ, tin.zMin - 1500, 1e-9);
  const above = tinShellStl(tin, { aboveM: 4000, name: "a" });
  const sa = stlStats(above.text);
  check("the atmosphere shell is watertight", sa.closed && sa.openEdges === 0, `${sa.openEdges} open edges`);
  near("its sky sits 4 km over the highest node", above.skyZ, tin.zMax + 4000, 1e-9);
}

// ── A grid reads as a TIN, and the studio's positions are the STL's facets ────
{
  const grid = buildSurface({ bounds, stepM: 500, radiusKm: R, sampleElevation: plane });
  const g = gridAsTin(grid);
  const stand = gridAsTin(tinToGrid(tin, { nx: 33, ny: 33 }));
  near("a TIN resampled onto a 33-grid is 2,048 triangles", stand.triangles, 32 * 32 * 2, 0);
  near("and keeps the plane", Math.abs(tinHeightAt(stand, 0, 0) - plane(54, -6)), 0, 1e-6);
  near("a grid has (nx-1)(ny-1)*2 triangles", g.triangles, (grid.nx - 1) * (grid.ny - 1) * 2, 0);
  near("its loop walks the perimeter once", g.loop.length, 2 * (grid.nx + grid.ny) - 4, 0);
  const sg = stlStats(tinShellStl(g, { belowM: 1000, name: "g" }).text);
  check("and closes as a shell", sg.closed && sg.openEdges === 0, `${sg.openEdges} open`);
  near("with the same facet count as the grid's own domainStl", sg.triangles, stlStats(domainStl(grid, { depthM: 1000 }).text).triangles, 0);
  const pos = shellPositions(tin, { belowM: 1500 }, 0.001);
  const walls = shellPositions(tin, { aboveM: 1500 }, 1, (f) => f.face !== "ground");
  near("a keep filter drops the ground facets", walls.length / 9, stlStats(tinShellStl(tin, { aboveM: 1500 }).text).triangles - tin.triangles, 0);
  near("studio positions: nine floats a facet", pos.length / 9, stlStats(tinShellStl(tin, { belowM: 1500 }).text).triangles, 0);
  near("scaled to kilometres", Math.min(...Array.from(pos).filter((_, i) => i % 3 === 2)), (tin.zMin - 1500) / 1000, 1e-6);
}

// ── The size field never exceeds the sampling ─────────────────────────────────
{
  const field = samplingSizeField(tin, { coarseM: 800, fineM: 100, slopeRefDeg: 30, nx: 40, ny: 40 });
  check("a field comes back", Boolean(field));
  let over = 0;
  for (let j = 0; j < 40; j += 1) for (let i = 0; i < 40; i += 1) {
    const s = tin.spacingOf(field.x0 + (field.dx * i) / 39, field.y0 + (field.dy * j) / 39);
    if (field.values[j * 40 + i] > s + 1e-9) over += 1;
  }
  near("no cell of the field is coarser than the sampling there", over, 0, 0);
  check("it writes as a structured field", structuredFieldText(field).split("\n")[2] === "40 40 2");
}

// ── Despike ───────────────────────────────────────────────────────────────────
{
  const z = Float64Array.from(tin.z);
  const mid = tin.tris[Math.floor(tin.tris.length / 2)][0];
  z[mid] = -5000;
  const fixed = despikeTin(Array.from({ length: tin.nodes }, (_, i) => [tin.xs[i], tin.ys[i]]), z, tin.tris);
  near("one planted void is repaired", fixed.repaired, 1, 0);
  near("to its neighbours' median", fixed.z[mid], plane(tin.lats[mid], tin.lons[mid]), 5);
}

// ── The gmsh script carries etna's outer_box when the boundary is extended ────
{
  const plain = gmshScript({ name: "m", stlFile: "m_domain.stl" });
  check("no extend, no outer_box", !/def outer_box/.test(plain));
  const ext = gmshScript({ name: "m", stlFile: "m_domain.stl",
    extend: { which: "subsurface", zBd: -1234.5, h: 500, surfaceFile: "m_surface.stl", belowM: 2000 } });
  check("extended: outer_box is defined", /def outer_box\(z_bd, h\):/.test(ext));
  check("and off by default, with the reason", /USE_OUTER_BOX = False/.test(ext) && /593 m/.test(ext));
  check("EXTEND carries the level and the surface file", /"z_bd":\s*-1234\.5/.test(ext) && /m_surface\.stl/.test(ext));
  check("the lid is the base for a subsurface", /groups\["base"\] = \[lid\]/.test(ext) && /groups\["sides_below"\] = sides/.test(ext));
  const air = gmshScript({ name: "m", stlFile: "m_atmosphere.stl", extend: { which: "atmosphere", zBd: 9000, h: 500, surfaceFile: "m_surface.stl", aboveM: 5000 } });
  check("and the sky for an atmosphere", /groups\["sky"\] = \[lid\]/.test(air) && /sides_above/.test(air));
  check("the etna recipe is intact: four corners, five planes, one loop",
    (ext.match(/= gmsh\.model\.geo\.addPlaneSurface\(/g) || []).length === 5 && /addSurfaceLoop\(\[s1, s2, s3, s4, s5, s\[0\]\[1\]\]\)/.test(ext));
}

// ── The GUI is wired to this module, both pages ───────────────────────────────
{
  const { readFileSync } = await import("node:fs");
  const pipeline = readFileSync(new URL("./model-pipeline.js", import.meta.url), "utf8");
  const studio = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  check("the Model Builder imports the sampling module", /from "\.\/surface-sampling\.js/.test(pipeline));
  check("its surface step offers uniform and variable sampling", /id: "variable", label: "Variable/.test(pipeline) && /function samplingControls/.test(pipeline));
  check("buffers are drawn on the globe as they are edited", /function drawBuffers/.test(pipeline) && /drawBuffers\(\);/.test(pipeline));
  check("the package writes the atmosphere shell and its own script", /tinShellStl\(grid, \{ aboveM/.test(pipeline) && /_atmosphere_gmsh\.py/.test(pipeline));
  check("every gmsh script carries the extend decision", /extend: \{\s*which: "subsurface"/.test(pipeline) && /which: "atmosphere"/.test(pipeline));
  check("placed points take the surface's interpolated height", /state\.customPoints\.forEach/.test(pipeline) && /groundAtLatLon\(p\.lat, p\.lon\)/.test(pipeline));
  check("the builder's own previews are never its inputs", /const own = new Set\(Object\.values\(PREVIEW_NAMES\)\)/.test(pipeline) && /!own\.has\(layer\.name\)/.test(pipeline));
  check("the studio adopts the terrain as a solid and exposes it", /export function adoptTerrainSolid/.test(studio) && /adoptTerrainSolid, adoptSectionModel, extendTerrain,/.test(studio));
  check("the studio fits the view to its OWN meshes, not to every GIS layer", /const own = all\.filter\(\(l\) => studioMeshes\.has\(l\.object3D\)/.test(studio));
  check("the studio draws the surface STL as its own skin and the air translucent", /surfacePositions\(display, km\)/.test(studio) && /opacity: 0\.22/.test(studio));
  check("the studio's camera floor and orbit follow a model that reaches below the ground", /function cameraFloorRadius/.test(studio) && /groundRadius \+ below - Math\.max\(span, 1000\)/.test(studio) && /Math\.PI - MIN_POLAR_RAD/.test(studio) && /uniforms\.uOpen\.value = 1;/.test(studio) && /if \(line < 0\.5 \|\| fade < 0\.04\) discard;/.test(studio) && /uHole\.value\.set\(/.test(studio));
  check("the studio's ground is ruled minimally: hairlines, no bloom, a distance fade", /fwidth\(lat\) \* 0\.7/.test(studio) && /bloom = 0\.0;/.test(studio) && /uFadeM/.test(studio));
  check("the cursor readout never raycasts during a drag, and at most a dozen times a second", /if \(event\.buttons\) return;/.test(studio) && /now - lastReadoutAt < 80/.test(studio));
  check("the studio draws a resampled stand-in of a big TIN and tests the full one", /gridAsTin\(tinToGrid\(surface, \{ nx: 129, ny: 129 \}\)\)/.test(studio) && /tinHeightAt\(surface, x \/ km/.test(studio));
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  check("the studio offers no stars, and a grid that can be switched off", !/data-toggle="stars"/.test(page) && /data-toggle="grid"/.test(page) && /setStarsVisible\(false\);/.test(studio) && /which === "grid"/.test(studio));
  check("the studio's readout reads the surface, not the air, in degrees east", /if \(gisTerrain\?\.skin\?\.visible\) targets\.push\(gisTerrain\.skin\);/.test(studio) && /h\.object\.material\.opacity < 1\)\)/.test(studio) && /const lonEast = \(\(geo\.lon % 360\) \+ 360\) % 360;/.test(studio));
  {
    const shell = readFileSync(new URL("./shell.html", import.meta.url), "utf8");
    const studioSection = (html) => html.slice(html.indexOf('<section id="model-studio"'), html.indexOf("</section>", html.indexOf('<section id="model-studio"')));
    const earth = studioSection(page); const planets = studioSection(shell);
    check("the studio has ONE ribbon of menus, not two toolbars, and no Atlas box", /id="studio-ribbon"/.test(earth) && !/studio-toolbar-main|studio-toolbars|id="studio-ai"/.test(earth) && ["file", "edit", "boolean", "export"].every((m) => earth.includes(`data-menu="${m}"`)));
    check("every action the old toolbar had is in a menu", ["new", "open", "save", "undo", "redo", "import-cad", "import-xyz", "fuse", "cut", "intersect", "fragment", "transform", "delete", "export-script", "mesh-gmsh", "to-gales", "to-explorer", "save-template", "snapshot"].every((a) => earth.includes(`data-act="${a}"`)));
    check("the ribbon and both decks fold", /class="studio-ribbon-fold"/.test(earth) && /data-fold="left"/.test(earth) && /data-fold="right"/.test(earth));
    check("the planets' studio is the same markup as Earth's", earth === planets);
    check("the studio wires every [data-act] on the page, folds the decks and cards the sections", /#model-studio \[data-act\]/.test(studio) && /function wireRibbonAndFolds\(\)/.test(studio) && /function foldPaneSections\(\)/.test(studio) && /--studio-ribbon-h/.test(studio) && /buildFromText,/.test(studio));
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8"); const shellCss = readFileSync(new URL("./shell.css", import.meta.url), "utf8");
    check("both stylesheets carry the studio's accent chrome and the same block", /Meshing Studio, in the GIS page's own chrome/.test(css) && /Meshing Studio, in the GIS page's own chrome/.test(shellCss) && css.slice(css.indexOf("Meshing Studio, in the GIS page's own chrome")) === shellCss.slice(shellCss.indexOf("Meshing Studio, in the GIS page's own chrome")));
    const atlas = readFileSync(new URL("./atlas-assistant.js", import.meta.url), "utf8");
    check("Atlas takes the build-a-volcano phrase the studio's box used to", /studio\.buildFromText\(question\)/.test(atlas));
  }
  check("every domain is its flagged faces, each a part with a row and a card", /function renderDomainsPanel/.test(studio) && /function showPartCard/.test(studio) && /\.studio-pane\[data-pane="model"\]/.test(studio) && /master\.indeterminate = shown > 0 && shown < own\.length;/.test(studio) && /\["sides", "wall", 0xa8703f, F\.sides_below/.test(studio) && /\["sky", "lid", 0x9fd8ff, F\.sky/.test(studio));
  check("embedded points are drawn and described", /id: `point:\$\{i\}`, name: `Point — \$\{p\.name\}`/.test(studio) && /flags: \{ \.\.\.state\.flags \},/.test(pipeline));
  check("a click in the view asks the parts before the solids", /const part = partAt\(event\.clientX, event\.clientY\);\n    if \(part\) \{\n      showPartCard/.test(studio));
  check("the grid is a dense lattice, lines only", /visibleMetres \/ 20/.test(studio) && /0x8e959f/.test(studio) && /uOpen\.value = 1;/.test(studio));
  check("no ground, no camera floor", /if \(!groundMesh\?\.visible\) return;/.test(studio));
  check("the studio's anchor is shown only with the model page", /anchor\.visible = event\.detail\?\.mode === "model";/.test(studio));
  check("one CRS: the studio reads the adopted terrain's own frame", /terrainFrame\(\)\.fromLocal\(eastM, northM\)/.test(studio) && /terrainFrame\(\)\.toLocal\(lat, lon\)/.test(studio) && /return gisTerrain\?\.surface\?\.frame \|\| gisTerrain\?\.frame \|\| null;/.test(studio));
  check("the package states its frame", /crs: `local east\/north metres about origin/.test(pipeline));
  check("returning to the studio puts its meshes back to metres and fits them", /clearZoomTarget\?\.\(\);\n        refreshStudioScale\(\);\n        if \(state\.solids\.length\) fitView\(\); else centreOnOrigin\(\);/.test(studio));
  check("the globe's embedded re-frame never runs in the studio", /if \(window\.GeoIDModeManager\?\.getMode\?\.\(\) === "model"\) return;\n\s+if \(performance\.now\(\) < suppressEmbeddedFrameCameraUntil\)/.test(viewer) && /cancelAnimationFrame\(embeddedFrameAnimation\);\n\s+embeddedFrameAnimation = null;\n\s+\}\n\s+return true;/.test(viewer));
  check("entering the studio forgets the globe's pending zoom", /clearZoomTarget\?\.\(\);/.test(studio) && /clearZoomTarget\(\) \{\n\s+zoomTargetSurfaceDistance = null;/.test(viewer));
  check("the studio hides the georeferenced GIS layers while it is up", /geo\.visible = false;/.test(studio) && /geoGroupWasVisible/.test(studio));
  check("neither shell draws its own copy of the ground: the surface is one mesh", /\? \[\["base", "lid"/.test(studio) && /: \[\["sky", "lid"/.test(studio) && !/polygonOffsetFactor = -2/.test(studio));
  check("the terrain keeps true elevations in the studio", /const zShift = 0;/.test(studio) && /elevation: 0,/.test(studio));
  check("the GIS page draws the full model — surface, subsurface, atmosphere", /function drawFullModel/.test(pipeline) && /Show the full model on the globe/.test(pipeline));
  check("the studio takes the terrain in METRES, its own scale", /const km = 1;/.test(studio) && /1 unit = 1 m/.test(studio));
  check("the studio's tree survives a kind it has no primitive for", !/PRIMITIVES\[entry\.kind\]\.label/.test(studio) && !/PRIMITIVES\[e\.kind\]\.label/.test(studio));
}

process.on("exit", () => {
  console.log(`surface-sampling: ${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
});
