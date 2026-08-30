/**
 * The Geoprocessing panel and the tools window must not be two implementations.
 *
 * `toolbox-ops.js` and `tool-runner.js` grew the same operations under the same
 * ids — `clip`, `difference`, `intersect`, `union`, `buffer`, `dissolve` — and
 * `clip` is labelled "Clip by layer" in both. They drifted exactly as this
 * tree's history predicts: a long run of fixes to the tool-runner clip (asking
 * a streaming layer about GROUND instead of reading its snapshot, inheriting
 * the source's colours and legend, a Detail level, a self-refining output) went
 * to the tools window while the panel went on calling `GP.clip` directly, so
 * every one of them appeared to do nothing.
 *
 * This does not demand that every op delegate — some carry panel params whose
 * units differ from the tool's, and `buffer` is metres here against KILOMETRES
 * there, which would turn a 1 km buffer into 1,000 km. What it demands is that
 * a shared id is either DELEGATED or listed as a known duplicate with a reason
 * beside it, so the next one is a decision rather than an oversight.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const ops = readFileSync(new URL("./toolbox-ops.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./tool-runner.js", import.meta.url), "utf8");

const vectorOps = (() => {
  const start = ops.indexOf("const VECTOR_OPS = {");
  const body = ops.slice(start, ops.indexOf("\n};", start));
  return [...body.matchAll(/^  ([a-zA-Z]+): \{/gm)].map((m) => m[1]);
})();
const toolIds = new Set([...runner.matchAll(/^    id: "([a-zA-Z]+)",/gm)].map((m) => m[1]));
const delegated = (() => {
  const m = /const DELEGATED = new Set\(\[([^\]]*)\]\);/.exec(ops);
  return new Set(m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []);
})();

ok("the panel's vector ops were found", vectorOps.length >= 8);
ok("the runner's tool ids were found", toolIds.size >= 30);
ok("something is delegated", delegated.size > 0);

// Every delegated op must actually route through the runner, not just be named.
// Either helper counts: the raster one picks the second input by the tool's own
// declared type, which is still the runner deciding.
for (const id of delegated) {
  const re = new RegExp(`^  ${id}: \\{[\\s\\S]*?run(?:Raster)?ThroughRunner\\("${id}"`, "m");
  ok(`${id} really routes through the runner`, re.test(ops));
}

// Every SHARED id is either delegated or named in the "not yet delegated" note.
// The whole doc comment above the set, so a reason may be written anywhere in it.
const note = ops.slice(ops.indexOf("THE GEOPROCESSING PANEL RUNS"), ops.indexOf("const DELEGATED"));
const shared = vectorOps.filter((id) => toolIds.has(id));
const unexplained = shared.filter((id) => !delegated.has(id) && !note.includes(`\`${id}\``));
ok(`every shared id is delegated or explained (${shared.length} shared)`,
  unexplained.join(", ") === "" || (console.log("  unexplained:", unexplained.join(", ")), false));

// The delegated ops must no longer call the engine directly -- that is the
// duplication, and leaving one behind is how it comes back.
for (const id of delegated) {
  // A delegated op must not still call an engine itself -- that is the
  // duplication, and leaving one behind is how it comes back.
  const re = new RegExp(`^  ${id}: \\{[\\s\\S]*?\\n  \\},$`, "m");
  const block = (re.exec(ops) || [""])[0];
  ok(`${id} no longer calls an engine directly`, !/\b(GP|RA)\.[a-zA-Z]+\(/.test(block));
}

// And the panel must be able to receive a promise, or a delegated op's status
// line reads "undefined" while the work succeeds.
ok("the panel resolves an op that answers with a promise",
  /Promise\.resolve\(op\.run\(/.test(ops));

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
