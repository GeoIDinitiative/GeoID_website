/**
 * The escaper, and the pin that keeps the sinks it was written for closed.
 *
 * The value half is easy and the SOURCE half is what matters: an attribute
 * value, a file extension, a mesh group's name, a field's unit and a data
 * registry's type are all strings this codebase did not write, and each one
 * was being interpolated into `innerHTML` raw. The source checks below fail
 * if any of them goes back to being raw, which is the only way this stays
 * fixed — a value test cannot see a call site that stopped calling.
 */
import { readFileSync } from "node:fs";
import { escapeHtml, safeUrl } from "./escape-html.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ── The value ──────────────────────────────────────────────────────────────

check("a script tag cannot survive",
  escapeHtml("<script>alert(1)</script>")
    === "&lt;script&gt;alert(1)&lt;/script&gt;", escapeHtml("<script>"));
check("the classic image payload cannot survive",
  !/[<>]/.test(escapeHtml('<img src=x onerror="alert(1)">')));
check("an attribute break cannot survive, in either quote",
  escapeHtml(`" onmouseover='x`) === "&quot; onmouseover=&#39;x");
check("the ampersand is escaped FIRST, or the escapes are escaped",
  escapeHtml("&lt;") === "&amp;lt;", escapeHtml("&lt;"));
check("null and undefined are empty rather than the words",
  escapeHtml(null) === "" && escapeHtml(undefined) === "");
check("a number survives as itself", escapeHtml(42) === "42");
check("ordinary text is untouched",
  escapeHtml("Southern Highland Group") === "Southern Highland Group");

// ── The sinks ──────────────────────────────────────────────────────────────

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  // Prose quoting a call site is not a call site. This file's own notes and
  // the escaper's header both name these strings.
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const toolbox = src("./toolbox.js");
check("the attribute query escapes the value it shows",
  /escapeHtml\(value\)/.test(toolbox) && !/\$\{value\} \(\$\{count\}\)/.test(toolbox));
check("the layer summary escapes the file extension",
  /escapeHtml\(String\(ext\)\.toUpperCase\(\)\)/.test(toolbox)
    && !/\$\{ext\.toUpperCase\(\)\}/.test(toolbox));

const studio = src("./model-studio.js");
check("the studio escapes a mesh group's name",
  /escapeHtml\(g\.name\)/.test(studio) && !/<span>\$\{g\.name\}<\/span>/.test(studio));
check("the studio escapes a field's unit",
  /escapeHtml\(f\.unit\)/.test(studio) && !/\$\{f\.unit\}/.test(studio));

const hierarchy = src("./layer-hierarchy.js");
check("the project summary escapes the registry's own type names",
  /escapeHtml\(k\)/.test(hierarchy) && !/`\$\{n\} \$\{k\}`/.test(hierarchy));

const events = src("./events.js");
check("a service's message is escaped before it is drawn",
  /escapeHtml\(out\?\.message/.test(events)
    && !/\$\{out\?\.message \|\| "No trace available\."\}/.test(events));

// ── safeUrl: a scheme check, because escaping does not make a link safe ─────
//
// `javascript:alert(1)` contains no character `escapeHtml` touches, so an
// escaped value in an `href` is still script the moment somebody clicks it.
// The feeds this app reads supply their own urls.

for (const bad of [
  "javascript:alert(1)", "  javascript:alert(1)", "JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox", "",
]) {
  check(`safeUrl refuses ${JSON.stringify(bad).slice(0, 38)}`, safeUrl(bad) === "",
    `got ${JSON.stringify(safeUrl(bad))}`);
}
check("safeUrl keeps an ordinary https link",
  safeUrl("https://earthquake.usgs.gov/x") === "https://earthquake.usgs.gov/x");
check("safeUrl keeps http too", safeUrl("http://example.org/a?b=1") === "http://example.org/a?b=1");
check("a url safeUrl allows can never break out of the attribute",
  !/["'<>]/.test(safeUrl('" onfocus=alert(1) x="')));

// ── The sinks the security review found, which the first sweep missed ──────
//
// All four were in files this work had ALREADY edited to close a sink — the
// first grep looked for an interpolation on the `innerHTML =` line itself and
// these build their markup a few lines above it. Pinned by source, because a
// value test cannot see a call site that has stopped calling.

check("the Metadata tab escapes the layer name and its provenance",
  /escapeHtml\(layer\.name \|\| "layer"\)/.test(hierarchy)
    && /<i>\$\{escapeHtml\(k\)\}<\/i> \$\{escapeHtml\(v\)\}/.test(hierarchy));
check("the point sample escapes the layer name and each attribute",
  /const name = escapeHtml\(layer\.name\)/.test(toolbox)
    && /escapeHtml\(k\)\}: \$\{escapeHtml\(v\)/.test(toolbox));
check("the event popup escapes the feed's own title, category and id",
  /escapeHtml\(event\.title\)/.test(events)
    && /escapeHtml\(event\.categoryTitle/.test(events)
    && /escapeHtml\(event\.id\)/.test(events));
check("the event popup's link is scheme-checked, not merely escaped",
  /const link = safeUrl\(event\.link\)/.test(events)
    && !/href="\$\{event\.link\}"/.test(events));

const gee = src("./gee.js");
check("the Earth Engine catalogue's own ids and names are escaped",
  /escapeHtml\(cat\.label\)/.test(gee) && /escapeHtml\(d\.name\)/.test(gee)
    && !/<option value="\$\{d\.id\}"/.test(gee));

const tags = src("./data-tags.js");
check("the data-tag chip escapes its label and note, not just the quote",
  /escapeHtml\(note \|\| label\)/.test(tags)
    && !/replace\(\/"\/g, "&quot;"\)/.test(tags));

process.on("exit", () => {
  console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
  if (failures) process.exitCode = 1;
});
