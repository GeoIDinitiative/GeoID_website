// node GeoID_GIS/viewer/gis/sidebar-nesting.test.mjs
//
// THE SIDEBAR'S SECTIONS STAY INSIDE IT. index.html is hand-written and
// thousands of lines long; one stray </div> (left when the 250 m landslide
// controls were removed, 2026-10-24) closed the `.controls` wrapper early, and
// Core View and Explorer Models fell out of Explorer into the bottom of the
// panel (reported). toolbox.js collects Explorer from `#ui-scroll-body`'s
// children, so anything that escapes it is silently left behind.
//
// Checked by walking the tags: every named section must sit inside
// #ui-scroll-body, and these must sit inside its `.controls` wrapper too.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source", "area", "col", "embed",
  "param", "track", "wbr", "base", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "use", "stop"]);

const where = {};
const stack = [];
const tag = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
let m;
while ((m = tag.exec(html))) {
  if (!m[2]) continue;                       // a comment
  const [, close, rawName, attrs, selfClose] = m;
  const name = rawName.toLowerCase();
  if (name === "script" && !close) {         // skip script bodies
    const end = html.indexOf("</script>", tag.lastIndex);
    if (end > -1) tag.lastIndex = end + 9;
    continue;
  }
  if (VOID.has(name) || selfClose) continue;
  if (close) {
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      if (stack[k].name === name) { stack.length = k; break; }
    }
    continue;
  }
  const id = (/\sid="([^"]+)"/.exec(attrs) || [])[1] || "";
  const cls = (/\sclass="([^"]+)"/.exec(attrs) || [])[1] || "";
  if (id) where[id] = { scroll: stack.some((s) => s.id === "ui-scroll-body"), controls: stack.some((s) => /(^|\s)controls(\s|$)/.test(s.cls)) };
  stack.push({ name, id, cls });
}

let pass = 0, fail = 0;
const check = (label, ok) => { if (ok) pass += 1; else { fail += 1; console.log("FAIL", label); } };

for (const id of ["earth-flight-section", "tour-mode-section"]) {
  check(`${id} is inside the sidebar's scroll body`, where[id]?.scroll);
}
for (const id of ["search-section", "locations-section", "core-view-section", "explorer-models-section",
  "moon-viewer-section", "metadata-section", "hazard-landslides-section", "hazard-landslide-preview-section",
  "hazard-cyclones-section", "hazard-flood-section"]) {
  check(`${id} exists`, Boolean(where[id]));
  check(`${id} is inside the .controls wrapper`, where[id]?.scroll && where[id]?.controls);
}
console.log(`sidebar-nesting: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
