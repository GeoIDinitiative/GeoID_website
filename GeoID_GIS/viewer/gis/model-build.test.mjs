/**
 * The Model Builder's arithmetic, against answers known independently.
 *
 * The elevation sampler is injected, so a planted ramp has a volume and a
 * relief anyone can work out on paper — and the domain surface has an
 * invariant no picture can show: a closed surface has no open edges.
 */
import {
  metresPerDegreeLat, metresPerDegreeLon, makeLocalFrame, planGrid, buildSurface,
  surfaceStl, domainStl, stlStats, gmshScript, femSpec, DOMAIN_PHYSICS,
  sizeField, structuredFieldText, despikeGrid, DEFAULT_FLAGS,
} from "./model-build.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
function near(name, got, want, tol) {
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
}

const EARTH_R = 6371.0088;
const MARS_R = 3389.5;

// ── The frame is the body's own ──────────────────────────────────────────────
near("a degree of latitude on Earth", metresPerDegreeLat(EARTH_R), 111194.9, 1);
near("a degree of latitude on Mars", metresPerDegreeLat(MARS_R), 59157.93, 0.1);

{
  const frame = makeLocalFrame({ lat: 45, lon: 7.5, radiusKm: EARTH_R });
  const p = frame.toLocal(45, 7.5);
  check("the centre is the origin", Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
  const north = frame.toLocal(45.01, 7.5);
  near("0.01° north is 1111.9 m", north.y, 1111.949, 0.01);
  const east = frame.toLocal(45, 7.51);
  near("0.01° east at 45° is 786.3 m", east.x, 786.25, 0.05);
  const back = frame.fromLocal(east.x, north.y);
  check("the frame round-trips", Math.abs(back.lat - 45.01) < 1e-9
    && Math.abs(back.lon - 7.51) < 1e-9);
  // A frame that ignored the antimeridian would answer half the planet here.
  const seam = makeLocalFrame({ lat: 0, lon: 179.99, radiusKm: EARTH_R });
  near("across the antimeridian it takes the short way", seam.toLocal(0, -179.99).x, 2224.4, 1);
}

// ── The grid plan is a cost, quoted before it is spent ───────────────────────
{
  // A 10 km box at 45°N: 0.0899° of latitude, 0.1271° of longitude.
  const bounds = { south: 44.955, north: 45.045, west: 7.4365, east: 7.5635 };
  const plan = planGrid({ bounds, stepM: 500, radiusKm: EARTH_R });
  near("a 10 km box is 10 km wide", plan.widthM, 10000, 60);
  near("and 10 km tall", plan.heightM, 10000, 60);
  check("a 500 m step over 10 km is 21 x 21", plan.nx === 21 && plan.ny === 21,
    `${plan.nx} x ${plan.ny}`);
  near("the achieved step is the one asked for", plan.stepXm, 500, 3);

  const fine = planGrid({ bounds, stepM: 5, radiusKm: EARTH_R, maxNodes: 2500 });
  check("an unaffordable step is COARSENED, never truncated", fine.capped
    && fine.nodes <= 2500 && fine.widthM === plan.widthM,
    `${fine.nx}x${fine.ny} over ${fine.widthM}`);
  check("and the cap keeps the area whole", Math.abs(fine.widthM - 10000) < 60);
}

// ── A planted ramp has a known relief and a known volume ─────────────────────
const bounds = { south: -0.045, north: 0.045, west: -0.045, east: 0.045 };
// 1000 m at the south edge rising to 2000 m at the north: a linear ramp.
const rampTop = 2000;
const rampBase = 1000;
const ramp = (lat) => rampBase
  + ((lat - bounds.south) / (bounds.north - bounds.south)) * (rampTop - rampBase);

const grid = buildSurface({
  bounds, stepM: 1000, radiusKm: EARTH_R, sampleElevation: (lat) => ramp(lat),
});
check("the surface builds", grid.ok, grid.message);
near("the relief is the ramp's", grid.reliefM, 1000, 1e-6);
near("the lowest node is the ramp's foot", grid.zMin, rampBase, 1e-6);
check("no node needed filling", grid.filledNodes === 0);
check("the grid is square over a square box", grid.nx === grid.ny, `${grid.nx}x${grid.ny}`);

{
  // A sampler that refuses a corner: the hole is filled and COUNTED.
  const holed = buildSurface({
    bounds, stepM: 2000, radiusKm: EARTH_R,
    sampleElevation: (lat, lon) => (lon < bounds.west + 1e-9 && lat < bounds.south + 1e-9
      ? NaN : ramp(lat)),
  });
  check("an unreadable node is filled and counted", holed.filledNodes === 1,
    `filled ${holed.filledNodes}`);
  check("and it is filled with the mean, never zero",
    holed.z[0] > rampBase && holed.z[0] < rampTop, String(holed.z[0]));
}

// ── The surface STL is the terrain, and the domain STL is CLOSED ─────────────
{
  const skin = stlStats(surfaceStl(grid));
  check("the skin is two triangles per cell",
    skin.triangles === 2 * (grid.nx - 1) * (grid.ny - 1), String(skin.triangles));
  check("a skin is NOT closed — it is a lid", !skin.closed);
  near("the skin spans the ramp", skin.bounds.maxZ - skin.bounds.minZ, 1000, 0.01);

  const depthM = 5000;
  const { text, baseZ } = domainStl(grid, { depthM });
  const dom = stlStats(text);
  near("the base sits depth below the lowest ground", baseZ, rampBase - depthM, 1e-6);
  check("the domain surface is CLOSED — no open edge", dom.closed,
    `${dom.openEdges} open edges of ${dom.edges}`);
  check("and has the topology of a sphere (V-E+F=2)", dom.euler === 2, String(dom.euler));
  near("its z spans terrain top to base", dom.bounds.maxZ - dom.bounds.minZ,
    (rampTop - rampBase) + depthM, 0.01);
  near("its x span is the study width", dom.bounds.maxX - dom.bounds.minX,
    grid.widthM, 1);

  // The enclosed volume by the divergence theorem: for a closed triangulated
  // surface, V = sum over facets of (a . (b x c)) / 6. A ramp over a square
  // box has a volume anybody can work out: width * height * (mean thickness).
  const verts = [...text.matchAll(/vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  let vol = 0;
  for (let t = 0; t < verts.length / 3; t += 1) {
    const [a, b, c] = [verts[t * 3], verts[t * 3 + 1], verts[t * 3 + 2]];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  const meanThickness = depthM + (rampTop - rampBase) / 2;
  const expected = grid.widthM * grid.heightM * meanThickness;
  check("the enclosed volume matches the closed form to 0.1%",
    Math.abs(vol - expected) / expected < 0.001,
    `got ${vol.toExponential(4)}, want ${expected.toExponential(4)}`);
  check("and the surface is outward-facing (positive volume)", vol > 0);
}

// ── The gmsh script says what it does ────────────────────────────────────────
{
  const script = gmshScript({
    name: "test", stlFile: "d.stl", meshFile: "m.msh", meshSizeM: 250,
    embedPoints: [{ x: 10, y: 20, z: 30, sizeM: 5, name: "borehole" }],
  });
  check("it merges the domain STL", script.includes('gmsh.merge("d.stl")'));
  check("it makes ONE volume from the closed surface",
    script.includes("addSurfaceLoop") && script.includes("addVolume"));
  check("it names the boundaries a condition can refer to",
    ["top", "base", "north", "south", "east", "west"]
      .every((n) => script.includes(`"${n}"`)));
  check("it embeds the study's points in the volume",
    script.includes("gmsh.model.mesh.embed(0, [t for (t, _, _) in tags], 3, volume)")
    && script.includes("[[10,20,30,5,\"borehole\",20]]"));
  check("and writes the mesh where FEM Setup looks", script.includes('gmsh.write("m.msh")'));
}

// ── The spec is the shape the FEM pages and the sidecar already read ─────────
{
  check("a solid domain is GALES' solid family", DOMAIN_PHYSICS.solid === "solid");
  check("gas is a fluid to the solver", DOMAIN_PHYSICS.gas === "fluid");

  const spec = femSpec({
    run: "run1", mesh: "m.msh", domain: "gas", dim: 3,
    time: { end: 60, step: 0.05 },
    initial: { temperature: 300 },
    boundary: [{ surface: "base", type: "dirichlet", value: 0, field: "velocity" }],
    provenance: { study_area: "Study area 1" },
  });
  check("the physics key is the family the deck prepare switches on",
    spec.physics === "fluid");
  check("a gas takes air's properties, not water's",
    spec.properties.fluid.density === 1.225);
  check("the solid block is always present — the prepare reads it",
    spec.properties.solid.young === 5e10);
  check("time carries through", spec.time.end === 60 && spec.time.step === 0.05);
  check("a boundary condition names a surface the script created",
    spec.boundary[0].surface === "base");
  check("provenance rides under one additive key",
    spec.geoid_model.study_area === "Study area 1");
  check("and the file still says it is for GALES", spec.solver === "gales");
}

/* ── the size field: elements where the ground needs them ──────────────────
   One MeshSizeMax spends the same element count on a plateau as on the
   headwall above it. A FEM run wants the opposite. */
{
  const bounds = { west: -7.1, east: -7.0, south: 54.9, north: 55.0 };
  // Flat on the west half, a 31-degree ramp on the east.
  const ramp = (lat, lon) => (lon > -7.05 ? 100 + (lon + 7.05) * 111320 * 0.6 : 100);
  const grid = buildSurface({ bounds, stepM: 200, radiusKm: 6371.0088, sampleElevation: ramp });
  const field = sizeField(grid, { coarseM: 400, fineM: 40, slopeRefDeg: 30 });
  const mid = Math.floor(field.ny / 2);
  const flat = field.values[mid * field.nx + 2];
  const steep = field.values[mid * field.nx + field.nx - 3];

  check("flat ground gets the coarse size", Math.abs(flat - 400) < 1e-6, `${flat}`);
  check("a slope past the reference angle gets the fine size",
    Math.abs(steep - 40) < 1e-6, `${steep}`);
  check("and nothing is ever outside the two",
    [...field.values].every((v) => v >= 40 - 1e-9 && v <= 400 + 1e-9));

  /* The map is linear in the TANGENT, not the angle: tan separates 30 from 45
     the way degrees do not. Half the reference tangent is half way down. */
  // In METRES per degree of longitude AT THIS LATITUDE -- 111,320 is the
  // equator's, and at 55N the ground is 1.74 times closer together, which is
  // the difference between a 26.7 degree ramp and the 15 this asks for.
  const mLon = metresPerDegreeLon(54.95, 6371.0088);
  const half = buildSurface({ bounds, stepM: 200, radiusKm: 6371.0088,
    sampleElevation: (lat, lon) => 100 + (lon + 7.1) * mLon * (Math.tan(Math.PI / 6) / 2) });
  const halfField = sizeField(half, { coarseM: 400, fineM: 40, slopeRefDeg: 30 });
  const middle = halfField.values[Math.floor(halfField.ny / 2) * halfField.nx + 3];
  check("half the reference tangent is half the way to the fine size",
    Math.abs(middle - 220) < 5, `${middle}`);

  /* The whole point of a field is that it varies; a flat study must not
     silently produce one, because then the mesh is uniform and nobody said so. */
  const flatGrid = buildSurface({ bounds, stepM: 200, radiusKm: 6371.0088,
    sampleElevation: () => 250 });
  const flatField = sizeField(flatGrid, { coarseM: 400, fineM: 40 });
  check("flat ground gives a field that is all one size",
    flatField.minM === flatField.maxM && flatField.maxM === 400,
    `${flatField.minM}..${flatField.maxM}`);

  /* The file format is gmsh's, and a wrong header is a field read as garbage
     rather than an error: origin, then SPACING, then counts. */
  const text = structuredFieldText(field);
  const lines = text.trim().split("\n");
  const [ox, oy] = lines[0].split(" ").map(Number);
  const [sx, sy] = lines[1].split(" ").map(Number);
  const [nx, ny, nz] = lines[2].split(" ").map(Number);
  check("the header states the grid's own origin", Math.abs(ox - field.x0) < 1e-6
    && Math.abs(oy - field.y0) < 1e-6);
  check("the second line is the SPACING, not the extent",
    Math.abs(sx - field.dx / (field.nx - 1)) < 1e-6, `${sx} against ${field.dx}`);
  check("two planes in z, because a size is a plan-view question", nz === 2);
  check("and every node is written twice, once per plane",
    lines.length - 3 === nx * ny * 2, `${lines.length - 3} for ${nx}x${ny}`);
}

/* ── the script has to USE the field, which is three things at once ──────── */
{
  const plain = gmshScript({});
  check("a run with no field is unchanged", !plain.includes("field.add"));

  const graded = gmshScript({
    sizeFieldFile: "geoid_size.dat",
    meshSizeM: 200,
    refineBoxes: [{ name: "dam", xMin: -500, xMax: 500, yMin: -500, yMax: 500, sizeM: 25 }],
  });
  check("the background field is read from the file", /Structured/.test(graded)
    && /geoid_size\.dat/.test(graded));
  check("and is set as the background mesh, or nothing consults it",
    /setAsBackgroundMesh/.test(graded));
  /* The failure mode worth naming: gmsh's own size sources win exactly where
     the field was written for, and the mesh still builds. */
  check("gmsh's own size sources are switched off",
    graded.includes('"Mesh.MeshSizeExtendFromBoundary", 0')
    && graded.includes('"Mesh.MeshSizeFromPoints", 0')
    && graded.includes('"Mesh.MeshSizeFromCurvature", 0'));
  check("a refine region is a Box with a taper", /field.add\("Box"/.test(graded)
    && /"Thickness"/.test(graded));
  check("the smallest size wins", /field.add\("Min"/.test(graded)
    && /FieldsList", \[1, 2\]/.test(graded));
  /* The ground is graded WITHOUT asking for anything extra, because the script
     rebuilds the STL as geometry before the field is consulted. Run on a
     25,290-triangle ridge: no field gave a uniform 267/279 m ground (nothing
     like the 60 m the STL was written at), a field gave 40 against 294. The
     `remeshSurface` flag that used to be here changed it by 1 m in 294. */
  check("the surface is rebuilt as geometry in every case",
    /createGeometry/.test(gmshScript({})) && /createGeometry/.test(graded));
  check("and there is no second switch pretending otherwise",
    !/remesh/i.test(graded) && !/"Mesh.Algorithm", 6/.test(graded));
}

/* ── a hole in the source is not a landform ────────────────────────────────
   dem-tiles despikes each tile and cannot catch a BLOCK of bad posts: its
   test is that a post's neighbours disagree with it, which fails when they
   are bad too. Measured over the Mournes at zoom 14: a block two posts wide
   and four tall, reading -448 to -3,042 m against ground at 4 to 13, arrived
   in the model grid as one node at -3,173 and the grading spent its finest
   elements on the 88-degree walls of a pit that is not there. */
{
  const nx = 9;
  const ny = 9;
  const flat = () => {
    const z = new Float64Array(nx * ny);
    for (let k = 0; k < z.length; k += 1) z[k] = 10;
    return z;
  };

  const holed = flat();
  holed[4 * nx + 4] = -3173;
  const out = despikeGrid(holed, nx, ny, 57);
  check("a single node hole is repaired to its neighbours", out.repaired === 1
    && Math.abs(holed[4 * nx + 4] - 10) < 1e-9, `${holed[4 * nx + 4]}`);
  check("and the size of the repair is reported", Math.abs(out.worst - 3183) < 1,
    `${out.worst}`);

  /* The tolerance is the point: at 57 m a 325 m step between nodes is an
     80-degree wall and therefore a hole; at a kilometre the same step is a
     mountainside, and a filter that flattened it would be deleting terrain. */
  const cliff = flat();
  cliff[4 * nx + 4] = 10 + 900;
  check("a real cliff on a coarse grid is left alone",
    despikeGrid(Float64Array.from(cliff), nx, ny, 1000).repaired === 0);
  check("and the same step on a fine grid is a hole",
    despikeGrid(Float64Array.from(cliff), nx, ny, 57).repaired === 1);

  /* A slope must survive: every node differs from its neighbours, and none of
     them is a spike. This is the check that would fail if the filter compared
     against a mean rather than a median. */
  const ramp = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) ramp[j * nx + i] = i * 40;
  }
  check("a uniform slope is not mistaken for spikes",
    despikeGrid(ramp, nx, ny, 57).repaired === 0);

  /* And the whole reason it is in buildSurface: the relief it reports must be
     the ground's, not a void's. */
  const bounds = { west: -6.0, east: -5.9, south: 54.15, north: 54.23 };
  const withHole = buildSurface({
    bounds, stepM: 100, radiusKm: 6371.0088,
    // Wide enough that a node of a 100 m grid must land in it: a hole placed
    // between the samples is a test of nothing.
    sampleElevation: (lat, lon) =>
      (Math.abs(lat - 54.19) < 0.0009 && Math.abs(lon + 5.95) < 0.0015 ? -3173 : 200),
  });
  check("the surface repairs it and says how many", withHole.repairedNodes >= 1,
    `${withHole.repairedNodes}`);
  check("so the relief is the ground's, not the void's",
    withHole.zMin > -100, `${withHole.zMin}`);
}

/* ── the flags, which are what a solver actually reads ─────────────────────
   gmsh carries a name and a number for every group; GALES' preprocessor takes
   the NUMBER -- int(result[5]) out of the $Entities block -- and refuses a
   point whose tag is 0. Run on the real mesher before this existed: 13 point
   entities, 1 tagged; 20 curves, none. */
{
  const script = gmshScript({
    flags: { top: 7, base: 3, north: 5, south: 5, east: 5, west: 5, domain: 10 },
    embedPoints: [{ x: 0, y: 0, z: 1, name: "gauge", flag: 21 }],
  });

  check("the study's own numbers reach the script",
    script.includes('"top":7') && script.includes('"base":3')
    && script.includes('"domain":10'), "the flag map is written out");
  check("a group is created WITH its number and its name",
    script.includes("addPhysicalGroup(2, sorted(tags), value,"));
  check("the volume carries its own", script.includes('flags["domain"], name="domain"'));
  check("and a point carries the one it was given",
    script.includes('[[0,0,1,'), script.slice(script.indexOf("embedded ="), 60));

  /* ONE FLAG IS ONE GROUP. Four sides at 5 is a single lateral boundary --
     and asking gmsh for a second group at a number already used is an ERROR,
     not a merge: "Physical surface 5 already exists", which is how this was
     found. So the faces are gathered by number before any group is made. */
  check("faces sharing a number are gathered before the group is made",
    script.includes("faces.setdefault(flags[label], []).extend(tags)")
    && script.indexOf("faces.setdefault") < script.indexOf("addPhysicalGroup(2"));

  /* A physical group on a face does not reach the curves and points beneath
     it, and an untagged point is what stops the mesh being read. */
  check("edges and corners inherit their face's flag",
    script.includes("getBoundary([(2, surface)]") && script.includes("owner.setdefault((0,"));
  check("and the lowest flag owns a shared edge, so the study decides that too",
    script.includes("for value in sorted(faces):"));

  check("the defaults follow the convention the GALES decks are written against",
    DEFAULT_FLAGS.domain === 10 && DEFAULT_FLAGS.north === 5
    && DEFAULT_FLAGS.south === 5 && DEFAULT_FLAGS.east === 5 && DEFAULT_FLAGS.west === 5,
    JSON.stringify(DEFAULT_FLAGS));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
