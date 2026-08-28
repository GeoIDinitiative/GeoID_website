/**
 * The Model Builder's arithmetic, against answers known independently.
 *
 * The elevation sampler is injected, so a planted ramp has a volume and a
 * relief anyone can work out on paper — and the domain surface has an
 * invariant no picture can show: a closed surface has no open edges.
 */
import {
  metresPerDegreeLat, makeLocalFrame, planGrid, buildSurface,
  surfaceStl, domainStl, stlStats, gmshScript, femSpec, DOMAIN_PHYSICS,
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
    script.includes("gmsh.model.mesh.embed(0, tags, 3, volume)")
    && script.includes("[[10,20,30,5,\"borehole\"]]"));
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

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
