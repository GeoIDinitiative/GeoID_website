/**
 * Every third-party file this site ships is in vendor.json, at the hash
 * vendor.json says.
 *
 * WHY THIS EXISTS. There is no package.json for any of the browser code: the
 * libraries are committed into the tree, fifteen copies of three.js among
 * them. So nothing tells anybody what version is deployed, and "are we
 * affected by CVE-X" has no answer short of reading a minified bundle.
 * vendor.json is that answer and this is what stops it going stale -- a
 * library swapped without the manifest being updated fails here, naming the
 * file and the hash to paste.
 *
 * IT ALSO CATCHES DRIFT, which is the real hazard of fifteen copies: a patch
 * applied to one viewer's three.js and not the others is not a version
 * anybody could name. All fourteen copies of three.js and of OrbitControls
 * are byte-identical today. STLLoader has three variants across nine copies
 * and that is recorded rather than failed, because it is OUR code and
 * converging it is a separate change -- so a library may declare several
 * hashes, and then what is pinned is that it has no MORE than those.
 *
 * Scope is `git ls-files`, not a directory walk: what ships is what is
 * tracked, and the gitignored GALES tree contains broken symlinks that stop a
 * walk dead.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const manifest = JSON.parse(readFileSync(join(ROOT, "vendor.json"), "utf8"));
const declared = new Map();          // library name -> Set of short hashes
for (const lib of manifest.libraries) {
  const hashes = Array.isArray(lib.sha256) ? lib.sha256 : [lib.sha256];
  declared.set(lib.name, new Set(hashes));
}

// A file's library is its basename without .min/.js -- the manifest names
// libraries the way a person would ("satellite.js", not "satellite.min.js").
const libraryOf = (path) => {
  const base = path.split("/").pop().replace(/\.min\.js$|\.module\.js$|\.js$/, "");
  for (const name of declared.keys()) {
    if (name.replace(/\.js$/, "").toLowerCase() === base.toLowerCase()) return name;
  }
  return null;
};

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((p) => /(^|\/)vendor\//.test(p));

check("the manifest describes what it is for",
  Array.isArray(manifest._) && manifest._.length > 0);
check("there are vendored files to check", tracked.length > 0, `${tracked.length} files`);

const seen = new Map();              // library -> Set of hashes actually on disk
const unlisted = [];
const wrong = [];
for (const rel of tracked) {
  const name = libraryOf(rel);
  if (!name) { unlisted.push(rel); continue; }
  const full = createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
  const short = full.slice(0, 16);
  (seen.get(name) ?? seen.set(name, new Set()).get(name)).add(short);
  if (!declared.get(name).has(short)) wrong.push(`${rel} is ${short}`);
}

check("every vendored file belongs to a library the manifest names",
  unlisted.length === 0, unlisted.slice(0, 3).join(", "));
check("every vendored file is at a hash the manifest declares",
  wrong.length === 0, wrong.slice(0, 3).join("; "));

// The other direction: a hash declared and no longer present means the
// manifest is describing a library that has been removed or replaced.
const stale = [];
for (const [name, hashes] of declared) {
  const found = seen.get(name) ?? new Set();
  for (const h of hashes) if (!found.has(h)) stale.push(`${name} ${h}`);
}
check("every hash the manifest declares is still on disk",
  stale.length === 0, stale.join(", "));

// Drift: a library whose copies disagree is a library with no version.
for (const [name, hashes] of seen) {
  const allowed = declared.get(name).size;
  check(`${name}: its copies agree with each other (${hashes.size} distinct of ${allowed} allowed)`,
    hashes.size <= allowed, [...hashes].join(", "));
}

// A library nobody can name a version for cannot be checked against an
// advisory. That is allowed and must be SAID, not left blank.
for (const lib of manifest.libraries) {
  check(`${lib.name}: its version is stated, or its absence is explained`,
    Boolean(lib.version) && Boolean(lib.version_source),
    lib.version);
}

process.on("exit", () => {
  console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
  if (failures) process.exitCode = 1;
});
