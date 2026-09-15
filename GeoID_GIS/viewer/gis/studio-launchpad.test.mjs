/** The launchpad opens doors that exist elsewhere on the page; it re-implements none of them. */
import { readFileSync } from "node:fs";
let pass = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) pass += 1; else failures.push(name); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`); }
process.on("exit", () => { console.log(`\n${pass} passed, ${failures.length} failed`); if (failures.length) process.exitCode = 1; });

const src = readFileSync(new URL("./studio-launchpad.js", import.meta.url), "utf8");
const strip = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("every door goes through a seam: mode, tab, results opener, project run", /setMode\?\.\("gis"\)/.test(strip) && /showGroup\?\.\("add"\)/.test(strip) && /results\(\)\?\.openFolder\?\.\(files\)/.test(strip) && /openProjectRun\?\.\(`fem_runs\/\$\{run\.name\}`\)/.test(strip));
check("it never parses a mesh, never fetches results by itself (the example goes through openFolder), and never builds a solid", !/parseMesh|readVtu|addSolid/.test(strip) && /openFolder\?\.\(files\)/.test(strip));
check("it shows only while the studio is empty, and a dismissal lasts the session", /studioIsEmpty\(\)/.test(strip) && /sessionStorage\.setItem\(DISMISS_KEY/.test(strip));
check("the example is offered only where the run answers (a gitignored tree)", /method: "HEAD"/.test(strip) && /if \(L\.example\)/.test(strip));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
check("loaded on the Earth page and on the planets", /gis\/studio-launchpad\.js\?v=/.test(html) && /"\.\/studio-launchpad\.js"/.test(boot));
