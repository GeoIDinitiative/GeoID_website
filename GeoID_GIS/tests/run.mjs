#!/usr/bin/env node
/**
 * The unit test runner — one command over every *.test.mjs in the viewer.
 *
 * The analysis code is the product's credibility: the DSP, the statistics and
 * the DOF interpolation are checked against answers that are known
 * independently (SciPy's own outputs, hand-worked cases, planted signals). Those
 * checks existed and nothing ran them, so a regression could sit for weeks. This
 * runs them all and fails loudly.
 *
 * Deliberately dependency-free — the repo has no build tooling and this keeps it
 * that way. Each test file is a standalone script that prints PASS/FAIL lines
 * and exits non-zero on failure; this discovers them, runs each in its own
 * process, and aggregates. `node GeoID_GIS/tests/run.mjs`, exit 0 when green.
 *
 * Add a test by dropping a `*.test.mjs` under GeoID_GIS/viewer/; it is picked up
 * with no registration.
 */

import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");                 // GeoID_GIS
const SEARCH = join(ROOT, "viewer");           // where the test files live

/** Every *.test.mjs under a directory, recursively. */
function findTests(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findTests(full));
    else if (name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

const tests = findTests(SEARCH).sort();
if (!tests.length) {
  console.error("No *.test.mjs found under", relative(process.cwd(), SEARCH));
  process.exit(1);
}

console.log(`Running ${tests.length} test file(s)\n`);

let failed = 0;
for (const file of tests) {
  const label = relative(ROOT, file);
  const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const ok = result.status === 0;
  if (!ok) failed += 1;
  // Count the PASS/FAIL lines each file prints, for a one-line-per-file summary.
  const lines = `${result.stdout || ""}`.split("\n");
  const passes = lines.filter((l) => l.startsWith("PASS")).length;
  const fails = lines.filter((l) => l.startsWith("FAIL")).length;
  console.log(`${ok ? "✓" : "✗"}  ${label}  —  ${passes} passed${fails ? `, ${fails} failed` : ""}`);
  if (!ok) {
    // On failure, surface the offending file's own output so the reason is here,
    // not one re-run away.
    process.stdout.write(`${result.stdout || ""}`);
    if (result.stderr) process.stderr.write(`${result.stderr}`);
  }
}

console.log(failed
  ? `\n${failed} test file(s) FAILED`
  : `\nall ${tests.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
