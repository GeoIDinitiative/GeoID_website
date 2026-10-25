#!/usr/bin/env node
/**
 * THE PUBLIC SITE, AND ONLY THE PUBLIC SITE.
 *
 *     npm ci --prefix scripts/public-build
 *     node scripts/public-build/build.mjs            # writes _site/
 *     node scripts/public-build/build.mjs --out DIR
 *
 * GitHub Pages used to publish the `main` branch as it stands, so everything
 * in the repository was a URL: the engineering notes (GeoID_GIS/CLAUDE.md,
 * docs/notes/), the security runbook, the Workers' and Supabase functions'
 * source, the SQL migrations, every Python baker and test, the development
 * plans. A private repository does not make its Pages site private. Now the
 * Pages workflow (.github/workflows/pages.yml) publishes what this script
 * builds instead.
 *
 * What it does, per tracked file (`git ls-files`, so nothing untracked or
 * ignored can ever reach the site):
 *   - INTERNAL (see isInternal): left out. Notes, docs, plans, tests and
 *     fixtures, server and tooling source, page backups, dotfiles, and every
 *     file type a browser never fetches from this site (.md .py .txt .sql ...).
 *   - .js / .mjs / .css: minified with every comment stripped, including
 *     those inside GLSL/CSS/HTML template strings (stripStringComments), except
 *     third-party files (a `vendor` folder or a `.min.` name), which are
 *     copied as shipped so their licence banners stay intact.
 *   - .html: HTML comments stripped outside <script>, <style>, <pre> and
 *     <textarea>; inline scripts minified, and the sha256 that each page's
 *     CSP (scripts/csp.py) pins for them swapped for the new one. Inline
 *     styles are left alone.
 *   - .json .geojson .csv .svg .xml .webmanifest .txt: copied with any path
 *     on the build machine ("/home/<user>/...") blanked; scripts too.
 *   - anything else: copied.
 *
 * URLs do not change, so the `?v=` stamps, the service worker and the
 * sitemap all work exactly as before.
 *
 * Then it checks its own output and exits 1, failing the deploy, if:
 *   - any file it wrote is of an internal kind (a rule above was bypassed);
 *   - any file it wrote still names a path on the build machine;
 *   - a page, script, stylesheet or JSON file in the output refers to a site
 *     file that was left out, other than a text mention of a source file
 *     (data provenance names its baker: "GeoID_GIS/services/bake-x.py").
 *     A broken page is caught here and not by a visitor.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { parse } from "acorn";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.resolve(ROOT, argValue("--out") || "_site");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

// ---------------------------------------------------------------------------
// What never leaves the repository
// ---------------------------------------------------------------------------

/** Whole folders, from the repository root. */
const INTERNAL_DIRS = [
  "docs/",                       // security runbook
  "page_backups/",
  "tools/",                      // planet tooling, Supabase functions and schema
  "graphify-out/",
  "GeoID_GIS/docs/",             // the engineering notes
  "GeoID_GIS/tests/",
  "GeoID_GIS/services/",         // Workers, bakers, publishers
  "GeoID_GIS/sidecar/",          // the local Python sidecar
  "GeoID_GIS/projects/",         // a test project's metadata
  "scripts/public-build/",       // this script
];

/** A folder of this name anywhere in a path: tests, fixtures, build tooling. */
const INTERNAL_SEGMENTS = new Set(["tests", "test", "fixtures", "tools", "node_modules", "__pycache__"]);

/** File types a browser never fetches from this site. */
const INTERNAL_EXT = new Set([
  ".md", ".py", ".pyc", ".sh", ".txt", ".sql", ".log", ".toml", ".yml", ".yaml",
  ".ts", ".ipynb", ".patch", ".msh", ".geo", ".vrt", ".xls", ".xlsx", ".pdf",
  ".gitkeep", ".gitignore", ".env", ".lock",
]);

/** Single files at the root: repository furniture, scratch files, plans. */
const INTERNAL_FILES = new Set([
  "LICENSE", "CNAME", "_headers", "serve.py", "sync-root.sh", "rg.js", "vendor.json",
]);

/** Kept whatever the rules above say: a crawler reads it. */
const PUBLIC_ANYWAY = new Set(["robots.txt"]);

export function isInternal(rel) {
  if (PUBLIC_ANYWAY.has(rel)) return false;
  if (INTERNAL_FILES.has(rel)) return true;
  if (INTERNAL_DIRS.some((d) => rel.startsWith(d))) return true;
  const parts = rel.split("/");
  // a dotfile or dot-folder anywhere (.github, .claude, .vscode, editor locks)
  if (parts.some((p) => p.startsWith("."))) return true;
  if (parts.slice(0, -1).some((p) => INTERNAL_SEGMENTS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (/\.(test|spec)\.m?js$/.test(base)) return true;
  if (/\.broken-/.test(base)) return true;
  // the trained flood and landslide forests: GeoID's models, never site files
  if (/^data\/global\/[^/]+-ml\/forest-[^/]*\.json$/.test(rel)) return true;
  if (/^(CLAUDE|README|ROADMAP|QUICKSTART|CONTRACT)\b/i.test(base)) return true;
  const ext = path.extname(base).toLowerCase();
  if (!ext) return true;                       // extensionless: repo furniture
  return INTERNAL_EXT.has(ext);
}

const isThirdParty = (rel) => rel.split("/").includes("vendor") || /\.min\./.test(rel);

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

async function minify(rel, source) {
  const ext = path.extname(rel).toLowerCase();
  const loader = ext === ".css" ? "css" : "js";
  // No `format`: esbuild then leaves top-level names alone (a classic script's
  // top level is global and another script may read it) and renames only what
  // is provably local. No target: nothing is lowered, the syntax ships as is.
  const result = await transform(source, {
    loader,
    minify: true,
    legalComments: "none",
    charset: "utf8",
    sourcefile: rel,
  });
  return result.code;
}

/**
 * COMMENTS INSIDE STRINGS. A minifier cannot touch a comment that is part of
 * a string's value, and the viewers keep their GLSL shaders, CSS and HTML
 * templates in template literals: a shader's explanatory comments shipped
 * verbatim. So the minified code is parsed and each template literal that is
 * recognisably GLSL, CSS or HTML loses its comments (GLSL // and block
 * comments, CSS block comments, HTML comments) and its blank lines.
 *
 * A comment that spans a `${...}` substitution is left alone: removing it
 * would move the substitution into the shader. GLSL needs its line breaks
 * (preprocessor directives end at one), so every newline stays.
 */
const GLSL = /\b(?:gl_Position|gl_FragColor|gl_FragCoord|void\s+main\s*\(|precision\s+(?:high|medium|low)p|uniform\s+\w|varying\s+\w|#include\s*<|\b(?:vec[234]|mat[34])\s*\()/;
const CSS = /[{;]\s*[-\w]+\s*:/;
const HOLE = /\u0000\d+\u0000/;

function stripKind(text) {
  let out = text;
  const keep = (m, fn) => (HOLE.test(m) ? m : fn(m));
  if (GLSL.test(text)) {
    out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => keep(m, () => ""));
    out = out.replace(/(^|[^:\\])\/\/[^\n]*/g, (m, lead) => keep(m, () => lead));
  } else if (CSS.test(text) && text.includes("/*")) {
    out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => keep(m, () => ""));
  } else if (/<[a-z]/i.test(text) && text.includes("<!--")) {
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => keep(m, () => ""));
  } else {
    return text;
  }
  return out.replace(/[ \t]+$/gm, "").replace(/\n\s*\n/g, "\n");
}

function walk(node, fn) {
  if (!node || typeof node.type !== "string") return;
  fn(node);
  for (const key in node) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, fn);
    else if (v && typeof v === "object" && typeof v.type === "string") walk(v, fn);
  }
}

export function stripStringComments(code, stats = { stripped: 0 }) {
  let ast = null;
  for (const sourceType of ["module", "script"]) {
    try {
      ast = parse(code, { ecmaVersion: "latest", sourceType, allowHashBang: true,
        allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
      break;
    } catch { /* try the other source type */ }
  }
  if (!ast) return code;
  const edits = [];
  walk(ast, (node) => {
    if (node.type !== "TemplateLiteral") return;
    const raws = node.quasis.map((q) => code.slice(q.start, q.end));
    const joined = raws.map((r, i) => (i ? `\u0000${i}\u0000` : "") + r).join("");
    const stripped = stripKind(joined);
    if (stripped === joined) return;
    const back = stripped.split(/\u0000\d+\u0000/);
    if (back.length !== raws.length) return;
    back.forEach((text, i) => {
      if (text !== raws[i]) edits.push({ start: node.quasis[i].start, end: node.quasis[i].end, text });
    });
    stats.stripped++;
  });
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * A PATH ON THE MACHINE THAT BUILT THE DATA. Bakers record where they read
 * and wrote ("/home/<user>/mars_game_assets/...", "file:///home/<user>/..."),
 * which names the account and lays out its folders. Useless to a visitor and
 * private, so it is blanked in every published script and data file. A page
 * is not rewritten (an inline script's CSP hash would break); one carrying a
 * path fails the self-check instead, to be fixed at the source.
 */
const LOCAL_PATH = /(?:file:\/\/)?(?:\/home\/|\/Users\/|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2})[A-Za-z0-9_.-]+(?:[\\/][^"'`\s,)<>\]}]*)?/g;
export const scrubLocalPaths = (text) => text.replace(LOCAL_PATH, "(local path)");
const SCRUBBED_EXT = new Set([".json", ".geojson", ".csv", ".svg", ".xml", ".webmanifest", ".txt"]);

const KEEP_BLOCK = /<(script|style|pre|textarea)\b[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--(?!\[if|<!\[endif)[\s\S]*?-->/g;

/** HTML comments out, everything inside script/style/pre/textarea untouched. */
export function stripHtmlComments(html) {
  let out = "";
  let last = 0;
  for (const m of html.matchAll(KEEP_BLOCK)) {
    out += html.slice(last, m.index).replace(HTML_COMMENT, "");
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + html.slice(last).replace(HTML_COMMENT, "");
}

const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const INLINE_SCRIPT = /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi;

/**
 * INLINE SCRIPTS, MINIFIED WITH THEIR CSP HASHES MOVED TO MATCH.
 *
 * Each page's CSP (scripts/csp.py) allows an inline script by the sha256 of
 * its exact text, so a script is minified only when the page's policy names
 * its hash, and that hash is swapped for the new one in the same pass. A
 * script the policy does not name (a page with no CSP, JSON-LD, a type that
 * is not JavaScript) is left exactly as written.
 */
export async function minifyInlineScripts(html) {
  const hasCsp = /http-equiv=["']Content-Security-Policy["']/i.test(html);
  const swaps = new Map();
  const parts = [];
  let last = 0;
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    const [whole, open, attrs, body, close] = m;
    parts.push(html.slice(last, m.index));
    last = m.index + whole.length;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1]?.toLowerCase();
    const isJs = !type || type === "module" || type === "text/javascript" || type === "application/javascript";
    const oldHash = sha256(body);
    if (!isJs || /\bsrc\s*=/i.test(attrs) || !body.trim() || (hasCsp && !html.includes(oldHash))) {
      parts.push(whole);
      continue;
    }
    let code;
    try {
      code = (await minify(type === "module" ? "inline.mjs" : "inline.js", body)).trimEnd();
    } catch (error) {
      // A script that does not parse is broken in the browser too: shipped
      // as written, so the build changes nothing about how the page behaves.
      console.warn(`warning    inline script not minified (${error.errors?.[0]?.text || error.message.split("\n")[0]})`);
      parts.push(whole);
      continue;
    }
    parts.push(open + code + close);
    if (hasCsp) swaps.set(oldHash, sha256(code));
  }
  parts.push(html.slice(last));
  let out = parts.join("");
  // the hashes live in the policy's content attribute, before any script
  for (const [from, to] of swaps) out = out.split(from).join(to);
  return out;
}

/** How many inline scripts the page's own CSP allows: must not drop in the build. */
export function allowedInlineScripts(html) {
  let n = 0;
  for (const m of html.matchAll(INLINE_SCRIPT)) if (m[3].trim() && html.includes(sha256(m[3]))) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Self-check: nothing internal written, nothing a page needs left out
// ---------------------------------------------------------------------------

const REF = /["'`(]((?:\.{0,2}\/)?[A-Za-z0-9_\-./%]+\.[A-Za-z0-9]{1,6})(?:[?#][^"'`)\s]*)?["'`)]/g;
const TEXT_MENTION_EXT = new Set([".py", ".md", ".txt", ".sh", ".sql", ".toml", ".yml", ".ts", ".pdf", ".xls", ".log", ".msh", ".geo", ".vrt", ".ipynb", ".patch"]);

export function brokenRefs(rel, text, tracked, published) {
  const broken = [];
  const dir = path.posix.dirname(rel);
  for (const m of text.matchAll(REF)) {
    const raw = decodeURIComponent(m[1].replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
    if (/^[a-z]+:/i.test(raw)) continue;
    const target = raw.startsWith("/") ? raw.slice(1) : path.posix.normalize(path.posix.join(dir, raw));
    for (const cand of new Set([target, raw.replace(/^\.?\//, "")])) {
      if (!tracked.has(cand) || published.has(cand)) continue;
      // a provenance string naming a script or a doc is text, not a fetch
      if (TEXT_MENTION_EXT.has(path.posix.extname(cand).toLowerCase())) continue;
      broken.push(cand);
    }
  }
  return broken;
}

// ---------------------------------------------------------------------------

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function main() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString("utf8").split("\0").filter(Boolean);
  const tracked = new Set(files);
  const publish = files.filter((f) => !isInternal(f));
  const published = new Set(publish);

  await rm(OUT, { recursive: true, force: true });
  const stats = { copied: 0, minified: 0, html: 0, bytesIn: 0, bytesOut: 0, stripped: 0 };
  const failures = [];
  const written = new Set();

  await pool(publish, 16, async (rel) => {
    const src = path.join(ROOT, rel);
    const dst = path.join(OUT, rel);
    await mkdir(path.dirname(dst), { recursive: true });
    const ext = path.extname(rel).toLowerCase();
    try {
      if ((ext === ".js" || ext === ".mjs" || ext === ".css") && !isThirdParty(rel)) {
        const text = await readFile(src, "utf8");
        const code = scrubLocalPaths(ext === ".css" ? await minify(rel, text) : stripStringComments(await minify(rel, text), stats));
        await writeFile(dst, code);
        stats.minified++; stats.bytesIn += Buffer.byteLength(text); stats.bytesOut += Buffer.byteLength(code);
      } else if (ext === ".html") {
        const text = await readFile(src, "utf8");
        const html = await minifyInlineScripts(stripHtmlComments(text));
        if (allowedInlineScripts(html) < allowedInlineScripts(text)) failures.push(`${rel}: an inline script lost its CSP hash`);
        await writeFile(dst, html);
        stats.html++;
      } else if (SCRUBBED_EXT.has(ext)) {
        await writeFile(dst, scrubLocalPaths(await readFile(src, "utf8")));
        stats.copied++;
      } else {
        await copyFile(src, dst);
        stats.copied++;
      }
      written.add(rel);
    } catch (error) {
      failures.push(`${rel}: ${error.message.split("\n")[0]}`);
    }
  });

  // Self-check over what was WRITTEN.
  const leaked = publish.filter((f) => isInternal(f));
  const broken = [];
  const localPaths = [];
  await pool(publish.filter((f) => written.has(f) && /\.(html|m?js|css|json|geojson|csv|svg|webmanifest|xml|txt)$/i.test(f)), 16, async (rel) => {
    const text = await readFile(path.join(OUT, rel), "utf8");
    // third-party files ship as published upstream (PDF.js's Emscripten
    // runtime carries a stock HOME of "/home/web_user", nobody's machine)
    if (!isThirdParty(rel) && LOCAL_PATH.test(text)) localPaths.push(rel);
    LOCAL_PATH.lastIndex = 0;
    // sources.json names BUCKET objects (data-base.js reads them from there),
    // not files this site serves, so its keys are not references to check
    if (!/\.(geojson|csv|svg|txt)$/i.test(rel) && rel !== "data/global/sources.json") {
      for (const b of brokenRefs(rel, text, tracked, published)) broken.push(`${rel} -> ${b}`);
    }
  });

  const kb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`public build: ${publish.length} of ${files.length} tracked files published to ${path.relative(ROOT, OUT) || OUT}`);
  console.log(`  ${stats.minified} scripts/styles minified (${kb(stats.bytesIn)} -> ${kb(stats.bytesOut)}), ${stats.html} pages, ${stats.copied} copied`);
  console.log(`  ${stats.stripped} shader/CSS/HTML templates inside scripts had their comments stripped`);
  console.log(`  ${files.length - publish.length} internal files left out`);
  for (const f of failures) console.error(`FAILED     ${f}`);
  for (const f of leaked) console.error(`LEAKED     ${f}`);
  for (const b of [...new Set(broken)].sort()) console.error(`NEEDS      ${b}`);
  for (const f of localPaths) console.error(`LOCAL PATH ${f}`);
  if (failures.length || leaked.length || broken.length || localPaths.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
