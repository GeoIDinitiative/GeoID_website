/** The Model page's two workspaces, and the pipeline strip's states. */
import { readFileSync } from "node:fs";
import { stepStates } from "./studio-workspaces.js";

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

const empty = stepStates({});
check("states: an empty model has no geometry and nothing begun downstream", empty.geometry === "error" && empty.materials === "" && empty.results === "");
const ready = stepStates({ targets: { source: "gis", domains: [{ flag: 10, void: false }] }, summary: { materials: { level: "ok" }, physics: { level: "warning" }, study: { errors: 0 } }, realMesh: { unflaggedCells: 0, unflaggedSides: 0 }, results: {} });
check("states: a GIS model, a mesh with every flag, a study with no errors and an open run", ready.gis === "ok" && ready.geometry === "ok" && ready.physics === "warning" && ready.mesh === "ok" && ready.study === "ok" && ready.results === "ok");
check("states: only a lattice preview is a warning; an untagged solver mesh is an error", stepStates({ targets: { domains: [{}] }, latticeMesh: {} }).mesh === "warning" && stepStates({ realMesh: { unflaggedCells: 2 } }).mesh === "error");

const src = readFileSync(new URL("./studio-workspaces.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const groups = [...index.matchAll(/class="control-section toolbox-group studio-group" data-group="([a-z]+)"/g)].map((m) => m[1]);
const table = Object.fromEntries([...src.slice(src.indexOf("const SPACE_OF")).matchAll(/([a-z]+): "(build|analyse|both)"/g)].map((m) => [m[1], m[2]]));
check("every tab on the page is assigned a workspace", groups.length >= 12 && groups.every((g) => table[g]), groups.filter((g) => !table[g]).join(","));
check("results live in Analyse, geometry and mesh in Build, and Study in both", table.results === "analyse" && table.add === "build" && table.mesh === "build" && table.study === "both");
check("a tab opened from anywhere brings its workspace forward", /own !== "both" && own !== space\) setSpace\(own\)/.test(src));
check("the strip's ends leave for the GIS page and the Research hub", /leave: "gis"/.test(src) && /leave: "research"/.test(src));
check("loaded on the Earth page and in the planets' module list", /src="gis\/studio-workspaces\.js\?v=/.test(index) && /"\.\/studio-workspaces\.js",/.test(readFileSync(new URL("./boot.js", import.meta.url), "utf8")));
const realSrc = readFileSync(new URL("./real-mesh-panel.js", import.meta.url), "utf8");
check("solver mesh: drawn under the model anchor in the studio frame, one mesh per face flag, registered in the Visibility box", /anchor\.add\(group\)/.test(realSrc) && /geometry\.applyMatrix4\(MODEL_TO_SCENE\)/.test(realSrc) && /registerVisibility\("real-mesh", visibility\)/.test(realSrc));
check("solver mesh: the Mesh pane hosts it on both pages", index.includes('id="studio-realmesh-host"') && readFileSync(new URL("./shell.html", import.meta.url), "utf8").includes('id="studio-realmesh-host"'));
const setupSrc = readFileSync(new URL("./studio-setup-panel.js", import.meta.url), "utf8");
check("tomography: written into the run's input/ in GALES's order, and refused when the grid is not loaded", /writeProjectFile\(`\$\{runDir\(\)\}\/input\/\$\{setup\.pointwise\.file\}`, pointwiseText\(tomo\.grid\)\)/.test(setupSrc) && /not loaded in this session/.test(setupSrc));
// ONE DESIGN: the runtime panels carry no style blocks; one stylesheet, loaded last.
for (const [file, text] of [["studio-workspaces.js", src], ["real-mesh-panel.js", realSrc], ["studio-setup-panel.js", setupSrc]]) {
  check(`style: ${file} injects no style block of its own`, !text.includes("const STYLE = `"));
}
const css = readFileSync(new URL("./studio-ui.css", import.meta.url), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
check("studio-ui.css: loaded by the workspaces module under its own stamp", /studio-ui\.css\$\{new URL\(import\.meta\.url\)\.search\}/.test(src));
check("studio-ui.css: braces balance", (bare.match(/\{/g) || []).length === (bare.match(/\}/g) || []).length);
check("studio-ui.css: every rule is scoped to the Model page", bare.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean).every((sel) => sel.replace(/\([^)]*\)/g, "()").split(",").every((part) => /#model-studio/.test(part))));
check("studio-ui.css: a section inside a tab is never filled when open (one loud level)", /details\.gis-tool-section\[open\] > summary[\s\S]*?\{[^}]*color: var\(--st-accent\) !important/.test(bare) && /details\.gis-tool-section > summary[\s\S]*?background: transparent !important/.test(bare));
check("studio-ui.css: the other workspace's tabs are hidden", /#model-studio\[data-space="build"\] \.studio-group\[data-space="analyse"\],\s*#model-studio\[data-space="analyse"\] \.studio-group\[data-space="build"\] \{ display: none !important; \}/.test(css));
