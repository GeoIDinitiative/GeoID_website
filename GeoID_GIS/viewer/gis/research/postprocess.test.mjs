/**
 * Checks for the DOF extraction in pages/postprocess.js.
 *
 *     node GeoID_GIS/viewer/gis/research/postprocess.test.mjs
 *
 * The interpolation is the part worth testing: it decides what number a
 * scientist reads off a model, and getting it subtly wrong is invisible.
 * Cases here have answers that can be worked out by hand.
 */
import { parseProbes, idwSample, extractSeries } from "./pages/postprocess.js";
import { parseTable } from "./table.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// --- probe parsing -----------------------------------------------------------
const probes = parseProbes(`
# a comment
P1,0.25,0.25,0.0,1
P2,0.75,0.50,0.0
bad,notanumber,0,0
`);
check("probes parse, comments and bad rows dropped", probes.length === 2,
  JSON.stringify(probes.map((p) => p.name)));
check("entity is optional", probes[0].entity === "1" && probes[1].entity === "",
  `"${probes[0].entity}" / "${probes[1].entity}"`);

// --- exact hit short-circuits ------------------------------------------------
const nodes = [
  { x: 0, y: 0, z: 0, entity: "1", value: 10 },
  { x: 1, y: 0, z: 0, entity: "1", value: 20 },
  { x: 0, y: 1, z: 0, entity: "1", value: 30 },
];
check("a probe sitting on a node returns that node's value exactly",
  idwSample(nodes, { x: 1, y: 0, z: 0, entity: "" }) === 20, "got 20");

// --- symmetry: equidistant between two nodes gives their mean ----------------
const two = [
  { x: -1, y: 0, z: 0, entity: "", value: 0 },
  { x: 1, y: 0, z: 0, entity: "", value: 100 },
];
check("midpoint of two equal-distance nodes is their mean",
  near(idwSample(two, { x: 0, y: 0, z: 0, entity: "" }), 50), 
  `got ${idwSample(two, { x: 0, y: 0, z: 0, entity: "" })}`);

// --- weighting: closer node dominates, by 1/d^2 ------------------------------
// At x=0: d^2 to the near node (x=1,v=100) is 1; to the far (x=3,v=0) is 9.
// weights 1 and 1/9 -> (1*100 + 1/9*0)/(1+1/9) = 90.
const weighted = [
  { x: 1, y: 0, z: 0, entity: "", value: 100 },
  { x: 3, y: 0, z: 0, entity: "", value: 0 },
];
const w = idwSample(weighted, { x: 0, y: 0, z: 0, entity: "" });
check("inverse-square weighting matches the hand calculation", near(w, 90),
  `expected 90, got ${w}`);

// --- nearest mode ignores the far node entirely ------------------------------
const n = idwSample(weighted, { x: 0, y: 0, z: 0, entity: "" }, { mode: "nearest" });
check("nearest mode takes the closest node only", n === 100, `got ${n}`);

// --- entity filtering --------------------------------------------------------
const mixed = [
  { x: 0, y: 0, z: 0, entity: "1", value: 5 },
  { x: 0.1, y: 0, z: 0, entity: "2", value: 999 },
];
const filtered = idwSample(mixed, { x: 0.2, y: 0, z: 0, entity: "1" });
check("an entity id confines the probe to that entity", filtered === 5,
  `got ${filtered} (999 would mean the filter leaked)`);
check("a probe on an entity with no nodes returns null",
  idwSample(mixed, { x: 0, y: 0, z: 0, entity: "7" }) === null);

// --- end to end over a long-format table ------------------------------------
// Two timesteps, four corner nodes of a unit square. A probe at the centre must
// read the mean of the corners by symmetry; one on a corner must read it exactly.
const rows = ["time,x,y,z,entity,velocity_x"];
[0, 1].forEach((t) => {
  [[0, 0, 1], [1, 0, 3], [0, 1, 5], [1, 1, 7]].forEach(([x, y, v]) => {
    rows.push(`${t},${x},${y},0,1,${v + t * 10}`);
  });
});
const table = parseTable(rows.join("\n"));
const out = extractSeries(table, parseProbes("C,0.5,0.5,0,1\nCorner,0,0,0,1"),
  { time: "time", x: "x", y: "y", z: "z", entity: "entity", dof: "velocity_x" });
check("timesteps are grouped and ordered", out.times.length === 2 && out.times[0] === 0,
  JSON.stringify(out.times));
check("centre probe reads the symmetric mean of the corners",
  near(out.series[0].values[0], 4) && near(out.series[0].values[1], 14),
  `t=0 ${out.series[0].values[0]}, t=1 ${out.series[0].values[1]} (expected 4, 14)`);
check("corner probe reads its node exactly",
  out.series[1].values[0] === 1 && out.series[1].values[1] === 11,
  `${out.series[1].values.join(", ")}`);

// --- a missing column is an error, not a silent empty series ----------------
let threw = false;
try {
  extractSeries(table, probes, { time: "time", x: "x", y: "y", z: "z", dof: "nope" });
} catch (error) { threw = true; }
check("naming a column that is not there fails loudly", threw);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
