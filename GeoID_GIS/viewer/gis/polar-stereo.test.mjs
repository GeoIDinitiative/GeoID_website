/**
 * POLAR STEREOGRAPHIC, CHECKED AGAINST THE PRODUCER AND AGAINST PROJ.
 *
 * The CPOM grids carry their own 2-D lat/lon arrays; the cells below are read
 * straight out of ESACCI-AIS-L3C-SEC-MULTIMISSION_ANNUAL_CUMULATIVE_DH_GRID-5KM
 * _199301_202412-fv2.nc, and PROJ (pyproj 3.6, EPSG:3031 → 4326) gives the same
 * numbers to nine decimals. A projection off by a sign draws Antarctica rotated
 * or mirrored, which looks plausible from far enough away — so the corners,
 * both sides of the pole and a cell in each quadrant are all pinned.
 */
import { forward, inverse, gridLattice, cellAt, gridBounds, PROJECTIONS } from "./polar-stereo.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

// Degrees of latitude per metre at the surface, near enough for a tolerance.
const M = 1 / 111320;
const lonErr = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// CPOM cell centres (x, y) and the lat/lon written beside them in the file.
const CPOM = [
  { x: -2817500.0, y: -2417500.0, lat: -56.758710717, lon: -130.630589103 },
  { x: 2817500.0, y: 2417500.0, lat: -56.758710717, lon: 49.369410897 },
  { x: 1682500.0, y: -1917500.0, lat: -66.829704817, lon: 138.734842222 },
  { x: 2500.0, y: 2500.0, lat: -89.967460153, lon: 45.0 },
  { x: -1817500.0, y: -917500.0, lat: -71.419742989, lon: -116.78529746 },
  { x: 2182500.0, y: 1082500.0, lat: -67.84698024, lon: 63.619009895 },
  { x: -2500.0, y: -2500.0, lat: -89.967460153, lon: -135.0 },
  { x: 682500.0, y: -1167500.0, lat: -77.600060984, lon: 149.69019353 },
];

for (const c of CPOM) {
  const ll = inverse(c.x, c.y, "EPSG:3031");
  const dLat = Math.abs(ll.lat - c.lat);
  const dLon = lonErr(ll.lon, c.lon) * Math.cos(c.lat * Math.PI / 180);
  ok(`3031 inverse (${c.x}, ${c.y}) matches CPOM's own lat/lon`,
    dLat < 1e-3 * M && dLon < 1e-3 * M, `got ${ll.lat}, ${ll.lon}`);
  const xy = forward(c.lat, c.lon, "EPSG:3031");
  ok(`3031 forward (${c.lat}, ${c.lon}) lands on the cell centre`,
    Math.abs(xy.x - c.x) < 1e-3 && Math.abs(xy.y - c.y) < 1e-3,
    `got ${xy.x.toFixed(4)}, ${xy.y.toFixed(4)}`);
}

// PROJ forward values, both poles. 3413 is Greenland's grid, the stub's.
const PROJ = [
  { crs: "EPSG:3031", lat: -71, lon: 0, x: 0.0, y: 2082760.109 },
  { crs: "EPSG:3031", lat: -75, lon: -100, x: -1613886.439, y: -284571.723 },
  { crs: "EPSG:3031", lat: -80, lon: 170, x: 189134.028, y: -1072632.372 },
  { crs: "EPSG:3413", lat: 70, lon: -45, x: 0.0, y: -2187927.649 },
  { crs: "EPSG:3413", lat: 72.5, lon: -40, x: 166468.234, y: -1902740.624 },
  { crs: "EPSG:3413", lat: 65, lon: -60, x: -711816.476, y: -2656535.253 },
  { crs: "EPSG:3413", lat: 80, lon: -20, x: 458929.748, y: -984178.022 },
  { crs: "EPSG:3413", lat: 85, lon: 10, x: 443953.131, y: -310859.329 },
];
for (const p of PROJ) {
  const xy = forward(p.lat, p.lon, p.crs);
  ok(`${p.crs} forward (${p.lat}, ${p.lon}) matches PROJ to a millimetre`,
    Math.abs(xy.x - p.x) < 1e-3 && Math.abs(xy.y - p.y) < 1e-3,
    `got ${xy.x.toFixed(4)}, ${xy.y.toFixed(4)}`);
  const ll = inverse(p.x, p.y, p.crs);
  // The fixture is PROJ's metres rounded to the millimetre, so the way back
  // is good to a few millimetres on the ground and no better.
  ok(`${p.crs} inverse comes back to (${p.lat}, ${p.lon}) within 3 mm`,
    Math.abs(ll.lat - p.lat) < 3e-3 * M
      && lonErr(ll.lon, p.lon) * Math.cos(p.lat * Math.PI / 180) < 3e-3 * M,
    `got ${ll.lat}, ${ll.lon}`);
}

// Orientation: the meridian that points up in each grid, and which way is east.
{
  const up = inverse(0, 1e6, "EPSG:3031");
  ok("3031: +y runs up the Greenwich meridian", Math.abs(up.lon) < 1e-9, `lon ${up.lon}`);
  const east = inverse(1e6, 0, "EPSG:3031");
  ok("3031: +x is 90°E (not mirrored)", Math.abs(east.lon - 90) < 1e-9, `lon ${east.lon}`);
  const down = inverse(0, -1e6, "EPSG:3413");
  ok("3413: −y runs down 45°W", Math.abs(down.lon + 45) < 1e-9, `lon ${down.lon}`);
  const pole = inverse(0, 0, "EPSG:3031");
  ok("the grid origin is the pole", pole.lat === -90, `lat ${pole.lat}`);
  ok("both projections are declared", Boolean(PROJECTIONS["EPSG:3031"] && PROJECTIONS["EPSG:3413"]));
}

// The CPOM grid as the bake's manifest describes it: north-up rows.
const GRID = { nx: 1128, ny: 968, dx: 5000, x0: -2817500, y0: 2417500 };
{
  const lat = gridLattice(GRID, { sx: 4, sy: 4 });
  ok("lattice has (sx+1)(sy+1) vertices", lat.lats.length === 25 && lat.uvs.length === 50);
  // The top-left vertex is the grid's outer corner, half a cell beyond the
  // first centre: x −2,820,000, y 2,420,000.
  const corner = inverse(-2820000, 2420000, "EPSG:3031");
  ok("lattice vertex 0 is the grid's top-left corner",
    Math.abs(lat.lats[0] - corner.lat) < 1e-12 && Math.abs(lat.lons[0] - corner.lon) < 1e-12);
  ok("UV of vertex 0 is (0, 1): the top row of the texture", lat.uvs[0] === 0 && lat.uvs[1] === 1);
  ok("UV of the last vertex is (1, 0)", lat.uvs[48] === 1 && lat.uvs[49] === 0);
  // The middle vertex of an even lattice is the grid's centre — the pole.
  ok("the centre vertex of the lattice is the South Pole", Math.abs(lat.lats[12] + 90) < 1e-9);
}

// cellAt is the inverse of the lattice: a CPOM centre maps to its own cell.
{
  for (const c of CPOM) {
    const cell = cellAt(GRID, c.lat, c.lon);
    const col = Math.round((c.x - GRID.x0) / GRID.dx);
    const row = Math.round((GRID.y0 - c.y) / GRID.dx);
    ok(`cellAt finds row ${row}, col ${col}`, cell && cell.row === row && cell.col === col,
      JSON.stringify(cell));
  }
  ok("cellAt is null off the grid (the equator)", cellAt(GRID, 0, 0) === null);
  const b = gridBounds(GRID);
  // The outer corner, half a cell beyond the corner cell's centre (−56.7587).
  const outer = inverse(-2820000, -2420000).lat;
  ok("gridBounds is the polar cap down to the grid's outer corners",
    b.south === -90 && b.west === -180 && b.east === 180 && Math.abs(b.north - outer) < 1e-12
      && b.north > -56.76 && b.north < -56.7,
    JSON.stringify(b));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
