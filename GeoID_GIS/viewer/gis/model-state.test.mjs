/** A saved state reads back as itself, and anything else is refused by name. */
import { makeState, readState, stateFileName, STATE_KIND } from "./model-state.js";

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

const state = makeState({ results: { run: "etna", field: "solid/u", stepName: "1", calcs: [{ name: "h", expr: "sqrt(ux^2+uy^2)" }] }, analysis: { line: { a: [0, 0, 0] } }, camera: { position: [1, 2, 3], target: [0, 0, 0] }, saved_at: "t" });
const back = readState(JSON.stringify(state));
check("state: a saved state reads back unchanged", back.state && JSON.stringify(back.state) === JSON.stringify(state) && back.state.kind === STATE_KIND);
check("state: not JSON, not a state, a newer version and a broken camera are each refused by name", /Not JSON/.test(readState("{").error) && /kind is "x"/.test(readState('{"kind":"x"}').error) && /newer/.test(readState({ kind: STATE_KIND, version: 99 }).error) && /camera/.test(readState({ kind: STATE_KIND, version: 1, camera: { position: [1, 2], target: [0, 0, 0] } }).error));
check("state: named for the run, field and step it shows", stateFileName(state) === "model_state_etna_solid_u_t1.json" && stateFileName({}) === "model_state_session.json");

// The page reads and writes it through these seams, so a rename cannot leave a card talking to nothing.
import { readFileSync } from "node:fs";
const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
check("state: the Results seam gets and applies its display, and every STATE_KEY is a real field of S", /getState: \(\) => resultsState\(\)/.test(panel) && /applyState: [^\n]*applyResultsState/.test(panel) && (() => {
  const keys = JSON.parse(panel.match(/const STATE_KEYS = (\[[^\]]*\])/)[1]);
  const block = panel.slice(panel.indexOf("const S = {"), panel.indexOf("};", panel.indexOf("const S = {")));
  return keys.every((k) => new RegExp(`^\\s*${k}:`, "m").test(block));
})());
check("state: the analysis page saves through the save gate, files into post_processing and re-runs what had a result", /may\("save"\)/.test(analysis.slice(analysis.indexOf("export async function saveState"))) && /post_processing\/\$\{name\}/.test(analysis) && /if \(a\.line\?\.plotted\) await plot\(\)/.test(analysis) && /readState\(input\)/.test(analysis));
