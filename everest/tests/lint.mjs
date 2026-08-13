/**
 * The checks that catch the two mistakes this project actually makes.
 *
 * Run: `node everest/tests/lint.mjs`
 *
 * 1. **A backtick inside a template literal ends the string.** Every shader
 *    here lives in one, and writing a uniform's name in backticks inside a
 *    GLSL comment silently truncates the module — it does not fail where the
 *    comment is, it fails as a JavaScript SyntaxError somewhere after it,
 *    naming an identifier that looks fine. This has now happened twice, and
 *    once before in the GIS viewer's zoom-bar.
 *
 * 2. **Every module must parse and import.** A module that will not load
 *    takes its whole feature with it and the page often still boots, so the
 *    absence looks like a placement bug rather than a syntax error.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, "..", "game");
const files = readdirSync(gameDir).filter((f) => f.endsWith(".js"));

let failures = 0;
const fail = (msg) => { console.error("  ✗ " + msg); failures++; };

/* ── 1. Backticks inside template literals ─────────────────────────────── */
for (const f of files) {
  const src = readFileSync(join(gameDir, f), "utf8");
  // Walk the source tracking whether we are inside a template literal, so
  // this understands nesting rather than pattern-matching one shape of it.
  let inTpl = false, inLine = false, inBlock = false, inStr = null, depth = 0;
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "\n") { line++; inLine = false; continue; }
    if (inLine) continue;
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (inTpl) {
      if (c === "\\") { i++; continue; }
      if (c === "$" && n === "{") { depth++; i++; continue; }
      if (c === "}" && depth > 0) { depth--; continue; }
      if (c === "`") { inTpl = false; continue; }
      continue;
    }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "`") { inTpl = true; depth = 0; continue; }
  }
  if (inTpl) fail(`${f}: unterminated template literal — a stray backtick, probably in a shader comment`);
}

/* A cheaper, blunter companion: a backtick on a line that is inside a GLSL
   comment is never intentional. Catches it at the right line number. */
for (const f of files) {
  const lines = readFileSync(join(gameDir, f), "utf8").split("\n");
  let inShader = false;
  lines.forEach((l, i) => {
    if (/\/\* glsl \*\/`/.test(l)) { inShader = true; return; }
    if (!inShader || !l.includes("`")) return;
    // A backtick that closes the literal has nothing but whitespace and the
    // shader's final brace before it. Anything else on the line means the
    // backtick is inside the GLSL, which always ends the string early.
    if (/^[\s}]*`\s*[;,)]?\s*$/.test(l)) { inShader = false; return; }
    fail(`${f}:${i + 1}: backtick inside a shader literal — "${l.trim().slice(0, 60)}"`);
  });
}

/* ── 2. Every module imports ───────────────────────────────────────────── */
for (const f of files) {
  try {
    await import(new URL(`../game/${f}`, import.meta.url).href);
  } catch (e) {
    // Modules that touch the DOM cannot load under node; that is not a
    // syntax error and must not be reported as one.
    const dom = /document|window|navigator|HTMLCanvas|self is not defined/i.test(e.message);
    if (!dom) fail(`${f}: ${e.message.split("\n")[0]}`);
  }
}

console.log(failures === 0
  ? `ok — ${files.length} modules, no stray backticks, all parse`
  : `${failures} problem(s)`);
process.exit(failures ? 1 : 0);
