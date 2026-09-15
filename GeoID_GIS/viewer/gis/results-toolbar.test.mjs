/** The results toolbar is a second face of the panel's own controls. */
import { readFileSync } from "node:fs";
let pass = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) pass += 1; else failures.push(name); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`); }
process.on("exit", () => { console.log(`\n${pass} passed, ${failures.length} failed`); if (failures.length) process.exitCode = 1; });
const src = readFileSync(new URL("./results-toolbar.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
check("every control writes the panel's state and calls the panel's refresh; nothing is drawn here", /results\.refresh\(\)/.test(src) && !/THREE|BufferGeometry|colourValues/.test(src));
check("the panel exposes what the bar drives: renderControls, play, stop, colormaps", /renderControls: \(\) => renderControls\(\)/.test(panel) && /play: \(\) => startPlay\(\)/.test(panel) && /stop: \(\) => stopPlay\(\)/.test(panel) && /colormaps: \(\) => COLORMAPS/.test(panel));
check("time keys move the step only while a run is open and nothing is being typed", /tag === "INPUT" \|\| tag === "SELECT" \|\| tag === "TEXTAREA"/.test(src) && /event\.key === "\." \|\| event\.key === "ArrowRight"/.test(src) && /if \(window\.GeoIDModeManager\?\.getMode\?\.\(\) !== "model"\) return;/.test(src) && /if \(!S\?\.mesh\) return;/.test(src));
check("the bar is rebuilt only when the lists change, and folds with the ribbon", /if \(key !== T\.key\)/.test(src) && /ribbon\.classList\.contains\("is-folded"\)/.test(src));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
check("loaded on the Earth page and on the planets", /gis\/results-toolbar\.js\?v=/.test(html) && /"\.\/results-toolbar\.js"/.test(boot));

{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const help = readFileSync(new URL("./studio-help.js", import.meta.url), "utf8");
  check("right-click on a result: a menu of the panel's own verbs at the clicked point, leaving a click the studio's menu took", /canvas\.addEventListener\("contextmenu"/.test(panel) && /document\.getElementById\("studio-context"\)\) return;/.test(panel) && /Slice here, normal \$\{axis\}/.test(panel) && /Profile from here \(A\)/.test(panel) && /Seed stream lines here/.test(panel) && /Add as a station/.test(panel) && /function hitAt\(clientX, clientY, canvas\)/.test(panel));
  check("drop anywhere: the page takes a dropped run, a mesh or VTK files and opens them in Results", /page\.addEventListener\("drop"/.test(panel) && /is-drop-target/.test(panel) && /openVtk\(files\.filter/.test(panel));
  check("view keys F X Y Z I and G W E press the ribbon's own buttons, never with a modifier, and the help lists them", /\{ f: "fit", x: "x", y: "y", z: "z", i: "iso" \}/.test(src) && /if \(event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return;/.test(src) && /\["F · X · Y · Z · I"/.test(help) && /Right-click a result/.test(help));
}
