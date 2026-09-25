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
import { readFileSync } from "node:fs";
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
];

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

// frame-ancestors is IGNORED in a meta tag and logs a warning on every load.
// It is a response header, and it is in docs/security-runbook.md.
check("no page puts frame-ancestors in a meta tag, where it does nothing",
  PAGES.every((rel) => !/frame-ancestors/.test(readFileSync(join(ROOT, rel), "utf8"))));

process.on("exit", () => {
  console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
  if (failures) process.exitCode = 1;
});
