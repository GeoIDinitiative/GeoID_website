/**
 * A backtick inside a module's CSS template literal.
 *
 * Several modules carry their own stylesheet as `const STYLE = \`…\`` and inject
 * it, which is how a rule reaches Earth and the nine planet pages from one
 * place. A backtick written inside that CSS — almost always in a comment
 * naming a function or a class — **ends the string early**. What follows is
 * parsed as code, and the module still loads, so there is no error anywhere:
 * the page simply has no styles from it.
 *
 * This has now cost two debugging passes:
 *   - zoom-bar.js, a comment saying `fitLabel()` — the module stopped parsing
 *     at that point and the whole zoom control vanished from the page;
 *   - side-panels.js, a comment saying `.atlas-close` — the injected stylesheet
 *     evaluated to the string "NaN" and every rule in it was lost, while the
 *     panel it styled carried on working.
 *
 * A note in CLAUDE.md did not prevent the second, so this checks it instead.
 *
 * Run: node GeoID_GIS/viewer/gis/module-css.test.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Every `const <NAME> = \`` … \`` block that looks like a stylesheet. */
function cssBlocks(source) {
  const blocks = [];
  const opener = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`/g;
  let match;
  while ((match = opener.exec(source))) {
    const start = opener.lastIndex;
    const end = source.indexOf("`", start);
    if (end < 0) continue;
    const body = source.slice(start, end);
    // Only the ones that are actually CSS: a declaration block and a property.
    if (/\{[^}]*:[^}]*\}/.test(body)) blocks.push({ name: match[1], body, start, end });
  }
  return blocks;
}

const files = readdirSync(here)
  .filter((name) => name.endsWith(".js"))
  .sort();

let checked = 0;
for (const file of files) {
  const source = readFileSync(join(here, file), "utf8");
  for (const block of cssBlocks(source)) {
    checked += 1;
    // The block already ends at the first backtick, so the only way to see the
    // fault is to look at what follows: a genuine stylesheet ends with `;`
    // after its closing backtick, a truncated one ends mid-CSS.
    const after = source.slice(block.end + 1, block.end + 3);
    const closesCleanly = after.startsWith(";");
    check(`${file}: ${block.name} closes where its CSS ends`, closesCleanly,
      closesCleanly ? "" : `ends mid-rule, next chars ${JSON.stringify(after)}`);
    // And the tail of the block should look like CSS, not prose.
    const tail = block.body.trimEnd().slice(-1);
    check(`${file}: ${block.name} ends on a complete rule`, tail === "}",
      tail === "}" ? "" : `last character is ${JSON.stringify(tail)}`);
  }
}

check("there are module stylesheets to check", checked > 0, `${checked} block(s)`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
