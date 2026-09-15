/** Toasts are a second face of the page's own status writers, and only news becomes one. */
import { readFileSync } from "node:fs";
import { worthAToast } from "./studio-toast.js";
let pass = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) pass += 1; else failures.push(name); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`); }
process.on("exit", () => { console.log(`\n${pass} passed, ${failures.length} failed`); if (failures.length) process.exitCode = 1; });
check("news: a progress line, a change reported with a number or a verb, and every error are toasts; furniture is not", worthAToast("Reading mesh_4core.txt — 41%") && worthAToast("3D mesh: 251,147 nodes, 1,395,454 elements — 0.4 s.") && worthAToast("Could not open", "error") && worthAToast("Study written", "") && !worthAToast("") && !worthAToast("Exaggerated: a scale of one is the true displacement."));
const studio = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
const setup = readFileSync(new URL("./studio-setup-panel.js", import.meta.url), "utf8");
check("the studio's log, the Results status and the Study status each dispatch the notice, keeping their own readouts", [studio, panel, setup].every((s) => s.includes('new CustomEvent("geoid-studio:notice"')) && /source: "studio"/.test(studio) && /source: "results"/.test(panel) && /source: "study"/.test(setup));
const src = readFileSync(new URL("./studio-toast.js", import.meta.url), "utf8");
check("one toast per source, replaced in place; at most four; only on the Model page", /T\.bySource\.get\(source\)/.test(src) && /children\.length > 4/.test(src) && /getMode\?\.\(\) !== "model"\) return;/.test(src));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
check("loaded on the Earth page and on the planets", /gis\/studio-toast\.js\?v=/.test(html) && /"\.\/studio-toast\.js"/.test(boot));
