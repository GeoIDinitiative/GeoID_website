/** A mesh's flags against the model's setup. */
import { meshFlagReport, flagCheck } from "./mesh-flags.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

// Two tets in volume 10, three flagged sides (1, 1, 2) and one unflagged, a point flag 20 on one node.
const mesh = {
  dim: 3, nodeCount: 5,
  cellOffsets: Uint32Array.from([0, 4, 8]), cellFlag: Int32Array.from([10, 10]),
  sideOffsets: Uint32Array.from([0, 3, 6, 9, 12]), sideFlag: Int32Array.from([1, 1, 2, 0]),
  nodeFlag: Int32Array.from([1, 2, 1, 0, 20]),
};
const r = meshFlagReport(mesh);
check("report: volumes, faces and point-only flags by count, flag 0 kept apart", JSON.stringify(r.volumes) === '[{"flag":10,"count":2}]' && JSON.stringify(r.faces) === '[{"flag":1,"count":2},{"flag":2,"count":1}]' && JSON.stringify(r.points) === '[{"flag":20,"count":1}]' && r.unflaggedSides === 1 && r.unflaggedCells === 0);
check("report: element kinds named by node count", r.kinds.length === 1 && r.kinds[0].name === "4-node tetrahedra" && r.kinds[0].count === 2);

const good = { conditions: { 2: { type: "fixed" }, 1: { type: "pressure" }, 7: { type: "free" } }, materials: { 10: { id: "granite" } } };
const issues = flagCheck(good, r);
check("check: conditions on flags the mesh carries pass; free ones are not checked; unflagged sides are named", !issues.some((i) => i.level === "error") && issues.some((i) => /carry no flag/.test(i.text)));
const lost = flagCheck({ conditions: { 5: { type: "fixed" } }, materials: { 11: { id: "granite" } } }, r);
check("check: a condition on a flag the mesh lacks is an error naming the flags it has", lost.some((i) => i.level === "error" && /flag 5/.test(i.text) && /\(1, 2\)/.test(i.text)));
check("check: a material on a missing volume flag, and a mesh volume without one, are warnings", lost.some((i) => i.step === "materials" && /flag 11/.test(i.text)) && lost.some((i) => /flag 10 has no material/.test(i.text)));
check("check: untagged elements are an error", flagCheck({}, { ...r, unflaggedCells: 3 }).some((i) => i.level === "error" && /untagged/.test(i.text)));
check("check: no mesh, no issues", flagCheck(good, null).length === 0 && meshFlagReport(null) === null);
