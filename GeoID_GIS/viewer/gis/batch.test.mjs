/**
 * The batch runner, against a fake registry.
 *
 * The rule worth pinning is the failure one: a step that produces nothing must
 * stop ITS chain and not the whole run, and every row must say which layer and
 * which step it belongs to — a batch that reports one aggregate "failed" is a
 * batch you have to re-run by hand to learn anything.
 */

import { parseChain, runBatch, cancelBatch, isRunning } from "./batch.js";

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
async function checkAsync(name, fn) { try { await fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }

const TOOLS = {
  slope: { id: "slope", label: "Slope", inputs: [{ name: "input" }], params: [] },
  focal: { id: "focal", label: "Focal", inputs: [{ name: "input" }],
    params: [{ name: "radius", default: 1 }] },
};
const toolById = (id) => TOOLS[id] || null;

check("a chain is one tool per line, with parameters", () => {
  const { steps, errors } = parseChain("slope\nfocal radius=3", toolById);
  eq(steps.length, 2, "steps");
  eq(errors.length, 0, "errors");
  eq(steps[1].params.radius, 3, "numeric parameter");
});

check("an unknown tool or parameter is named, not swallowed", () => {
  const { steps, errors } = parseChain("slope\nnosuch\nfocal bogus=2", toolById);
  eq(steps.length, 2, "the good lines survive");
  eq(errors.length, 2, "both problems reported");
  if (!errors[0].includes("line 2")) throw new Error("no line number");
});

check("comments and blanks are skipped silently", () => {
  const { steps, errors } = parseChain("# the recipe\n\nslope\n", toolById);
  eq(steps.length, 1, "steps"); eq(errors.length, 0, "errors");
});

await checkAsync("every layer runs every step, in order", async () => {
  const calls = [];
  const runner = {
    toolById,
    runToolAuto: async (id, inputs) => {
      calls.push(`${id}:${inputs.input.name}`);
      return { ok: true, layer: { name: `${id}_${inputs.input.name}` }, message: "" };
    },
  };
  const out = await runBatch({
    layers: [{ name: "a" }, { name: "b" }],
    steps: parseChain("slope\nfocal", toolById).steps,
    runner,
  });
  eq(out.ok, true, "ok");
  eq(out.rows.length, 4, "rows");
  // The second step takes the first step's OUTPUT, which is what makes it a
  // chain rather than two independent runs.
  eq(calls[1], "focal:slope_a", "chained input");
  eq(calls[2], "slope:b", "second layer starts fresh");
});

await checkAsync("a failed step stops its own chain, not the batch", async () => {
  const runner = {
    toolById,
    runToolAuto: async (id, inputs) => (inputs.input.name === "bad"
      ? { ok: false, message: "no data" }
      : { ok: true, layer: { name: `${id}_out` }, message: "" }),
  };
  const out = await runBatch({
    layers: [{ name: "bad" }, { name: "good" }],
    steps: parseChain("slope\nfocal", toolById).steps,
    runner,
  });
  const bad = out.rows.filter((r) => r.layer === "bad");
  const good = out.rows.filter((r) => r.layer === "good");
  eq(bad.length, 1, "the bad chain stopped after one step");
  eq(bad[0].ok, false, "and said so");
  eq(good.length, 2, "the other layer ran in full");
  eq(out.rows.every((r) => r.layer && r.step), true, "every row is attributable");
});

await checkAsync("a thrown tool is a failed row, not a dead batch", async () => {
  const runner = {
    toolById,
    runToolAuto: async () => { throw new Error("boom"); },
  };
  const out = await runBatch({
    layers: [{ name: "a" }], steps: parseChain("slope", toolById).steps, runner,
  });
  eq(out.ok, true, "the batch completed");
  eq(out.rows[0].note, "boom", "the reason survived");
});

await checkAsync("empty input is refused with a reason", async () => {
  const runner = { toolById, runToolAuto: async () => ({ ok: true }) };
  eq((await runBatch({ layers: [], steps: [{ id: "slope" }], runner })).ok, false, "no layers");
  eq((await runBatch({ layers: [{ name: "a" }], steps: [], runner })).ok, false, "no steps");
});

check("nothing is running once it is over", () => { eq(isRunning(), false, "idle"); });

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
