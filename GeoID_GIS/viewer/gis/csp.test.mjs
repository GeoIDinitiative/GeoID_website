/**
 * The site's Content-Security-Policies, checked against the pages themselves.
 *
 * WHY THIS LIVES HERE, two directories above what it checks: `tests/run.mjs`
 * sweeps `viewer/` and `services/` and nothing else, and this tree's own
 * record of that rule is blunt — `gee-tiles/stac.test.mjs` sat outside the
 * sweep for months, passing and unrun, which is not a test. A file the runner
 * reaches beats a file in the tidy place. `global-data-bounds.test.mjs`
 * already reaches out of this directory for the same reason.
 *
 * What it holds:
 *
 * - EVERY PAGE'S POLICY IS CURRENT. The strict `script-src` is bought with a
 *   sha256 per inline script, and the standing objection to hashes is that
 *   they go stale on the next hand edit. This is the answer to that: edit an
 *   inline script without re-running `scripts/csp.py` and the suite says so,
 *   naming the page. Verified by drifting one script by one character —
 *   this failed, and Chrome refused the script.
 * - NO `'unsafe-inline'` IN `script-src`. The first policy shipped with it,
 *   and a security review was right that it bought almost nothing:
 *   `'unsafe-inline'` admits an inline event handler, and `<img src=x
 *   onerror=…>` IS an inline event handler — the payload an innerHTML
 *   injection delivers. `style-src` keeps it deliberately, and the reason is
 *   in `scripts/csp.py`.
 * - NO INLINE EVENT HANDLER on a page carrying a policy, because the policy
 *   now refuses it: one would be a control that silently stopped working.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PAGES = [
  "about/index.html", "about_geohub/index.html", "dashboard/index.html",
  "membership/index.html", "membership/welcome/index.html", "team/index.html",
  "contact/index.html", "get-involved/index.html", "data/index.html",
  "researchers/index.html", "updates/index.html", "fund.html",
  "privacy/index.html", "terms/index.html", "disclaimer/index.html",
  "refund/index.html", "sign-in/index.html", "account/index.html", "404.html",
  // The application. These carried NO policy until 2026-09-25, which was
  // backwards: they are the pages that take a reader's own files, other
  // people's vector tiles and a dozen live feeds, and so are where every
  // innerHTML sink this repository has had to fix actually lives.
  "index.html",
  "GeoID_GIS/viewer/index.html",
  "transit/index.html",
  "explorer/index.html",
  "earth_explorer/index.html",
  "earth_explorer/etna/index.html",
  "everest/index.html",
  ...["mercury", "venus", "moon", "mars", "jupiter",
      "saturn", "uranus", "neptune", "pluto"]
    .map((w) => `planet_explorer/${w}/viewer/index.html`),
];

// Code a PAGE loads. Not services/ (Workers and Cloud Functions, which have no
// CSP and no DOM), not vendor/ (three.js and friends, which we do not write),
// not the bake scripts, and not tests.
const CODE_TREES = ["GeoID_GIS/viewer", "planet_explorer", "earth_explorer",
  "everest", "transit", "scripts"];

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// The element's EXACT contents, nothing stripped: the browser hashes the
// bytes between the tags, so trimming here is how this stops matching.
// The same rule scripts/csp.py uses: a script with a `src` has no inline body,
// and `application/ld+json` is a data block the browser never executes, so
// script-src does not reach it. The two must agree or the check is checking
// something the generator does not write.
const INLINE = /<script(?![^>]*\ssrc=)(?![^>]*type\s*=\s*["']?application\/(?:ld\+json|json))[^>]*>([\s\S]*?)<\/script>/gi;
const HANDLER = /\son(?:click|load|error|change|input|submit|focus|blur|mouseover)\s*=/i;

for (const rel of PAGES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const meta = text.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if (!meta) {
    check(`${rel} carries a policy`, false, "no CSP meta tag");
    continue;
  }
  const policy = meta[1];
  const scriptSrc = (policy.match(/script-src ([^;]*)/) || [, ""])[1];

  const wanted = [...text.matchAll(INLINE)]
    .map(([, body]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  const listed = (scriptSrc.match(/'sha256-[^']+'/g) || []);

  check(`${rel}: every inline script is hashed, and no more`,
    wanted.length === listed.length && wanted.every((h) => listed.includes(h)),
    `${wanted.length} inline, ${listed.length} listed — re-run scripts/csp.py`);
  check(`${rel}: script-src has no 'unsafe-inline'`,
    !/'unsafe-inline'/.test(scriptSrc), scriptSrc.slice(0, 70));
  check(`${rel}: no inline event handler the policy would refuse`,
    !HANDLER.test(text.replace(/<!--[\s\S]*?-->/g, "")));
}

// NO PAGE CODE MAY TURN A STRING INTO RUNNING CODE.
//
// `script-src` without 'unsafe-eval' refuses eval() and new Function(), so any
// page reaching for one breaks under its own policy -- and the alternative,
// granting 'unsafe-eval', hands an injection the exact primitive it wants.
// Five calculators did this (raster, attribute field, curve fit and two
// Research pages); they compile through field-calculator.js's parser now,
// which is what that file was written for. This is the guard that stops a
// sixth being added: the fix is `compileScalar`, never the permission.
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "vendor" || name === "node_modules"
      || name === "page_backups" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs|html)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(full);
  }
  return out;
};
// Comments first, or this file's own explanation of the rule trips it -- the
// same reason tool-runner's param scanner strips them.
const BARE = /(^|[^.\w$])(?:eval|new\s+Function)\s*\(/;
const sinks = [];
for (const tree of CODE_TREES) {
  let files = [];
  try { files = walk(join(ROOT, tree)); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      .replace(/<!--[\s\S]*?-->/g, "");
    if (BARE.test(src)) sinks.push(file.slice(ROOT.length + 1));
  }
}
check("no page code calls eval() or new Function() -- use compileScalar",
  sinks.length === 0, sinks.slice(0, 4).join(", "));

// frame-ancestors is IGNORED in a meta tag and logs a warning on every load.
// It is a response header, and it is in docs/security-runbook.md.
check("no page puts frame-ancestors in a meta tag, where it does nothing",
  PAGES.every((rel) => !/frame-ancestors/.test(readFileSync(join(ROOT, rel), "utf8"))));

process.on("exit", () => {
  console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
  if (failures) process.exitCode = 1;
});
