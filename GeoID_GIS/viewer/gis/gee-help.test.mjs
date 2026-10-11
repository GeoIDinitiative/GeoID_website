/** The guide's Earth Engine section opens real controls. Run: node gee-help.test.mjs */
import { readFileSync } from "node:fs";
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
process.on("exit", () => { console.log(`gee-help: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mod = readFileSync(new URL("./gee-help.js", import.meta.url), "utf8");
const gee = readFileSync(new URL("./gee.js", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../services/gee-tiles/README.md", import.meta.url), "utf8");
ok(/id="viewer-help-gee"/.test(page) && page.indexOf('id="viewer-help-gee"') > page.indexOf('id="viewer-help-overlay"'), "the section is in the ⓘ guide");
for (const a of ["gee-check", "settings", "catalogue", "project"]) {
  ok(page.includes(`data-help-action="${a}"`) && new RegExp(`(["']?)${a}\\1\\s*\\(|"${a}"\\(`).test(mod), `the ${a} button is wired`);
}
ok(/async check\(\)/.test(gee) && /\?list/.test(gee.slice(gee.indexOf("async check()"))), "the check asks the endpoint's ?list");
ok(/gcloud functions deploy geeImage --gen2/.test(page.replace(/\\\n\s*/g, "")) && /--entry-point=geeImage/.test(deploy) && /--entry-point=geeImage/.test(page), "the guide's deploy command is the service README's");
ok(/ALLOWED_ORIGINS/.test(page) && /code\.earthengine\.google\.com\/register/.test(page), "origins and registration are explained");
ok(/byId\("project-open-modal"\)/.test(mod) && /GeoIDSidePanels\?\.open\?\.\("settings"\)/.test(mod), "the doors are the real controls");
ok(page.indexOf("gis/gee-help.js") > 0, "the page loads the guide's wiring");
