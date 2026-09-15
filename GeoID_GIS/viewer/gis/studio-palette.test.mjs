/** The palette finds what is on the page, ranks a label hit first, and runs the page's own doors. */
import { readFileSync } from "node:fs";
import { search } from "./studio-palette.js";
let pass = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) pass += 1; else failures.push(name); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`); }
process.on("exit", () => { console.log(`\n${pass} passed, ${failures.length} failed`); if (failures.length) process.exitCode = 1; });
const items = [
  { label: "Isosurfaces", path: "Results ▸ Display", key: "isosurfaces results display levels" },
  { label: "Display", path: "Results", key: "display results" },
  { label: "Stream tracer", path: "Analysis", key: "stream tracer analysis streamline" },
  { label: "Mesh with gmsh", path: "Export menu", key: "mesh with gmsh export menu run the model through gmsh" },
];
check("search: every word must match; a label hit outranks a keyword hit; a shorter label wins a tie", search(items, "iso")[0].label === "Isosurfaces" && search(items, "stream")[0].label === "Stream tracer" && search(items, "gmsh")[0].label === "Mesh with gmsh" && search(items, "display")[0].label === "Display" && search(items, "zzz").length === 0 && search(items, "").length === 4);
const src = readFileSync(new URL("./studio-palette.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
check("gather: the display switches, every open field and every colour map are entries by seam, and a view button is labelled so a section beats it on the same word", /flip\("Isosurfaces"/.test(src) && /Field: \$\{/.test(src) && /Colour map: \$\{name\}/.test(src) && /`View: \$\{text\(b\)\}`/.test(src));
check("gather: read off the page at open — ribbon menus, deck tabs, Results sections, Analysis cards — and each entry runs the page's own control", /#studio-ribbon \.studio-menu/.test(src) && /studio-group\[data-group\]/.test(src) && /details\[data-gales-section\]/.test(src) && /#studio-analysis-host > details/.test(src) && /b\.click\(\)/.test(src) && /P\.items = gather\(\)/.test(src));
check("keys: Ctrl/⌘-K toggles it only on the Model page; the box swallows its own keys", /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "k"/.test(src) && /getMode\?\.\(\) !== "model"\) return;/.test(src) && /e\.stopPropagation\(\);\n    if \(e\.key === "ArrowDown"\)/.test(src));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
check("loaded on the Earth page and on the planets", /gis\/studio-palette\.js\?v=/.test(html) && /"\.\/studio-palette\.js"/.test(boot));
