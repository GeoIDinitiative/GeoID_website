/**
 * The tool registry: argument checks, the prompt a model is shown, and
 * reading a model's call back — nothing a model writes runs unchecked.
 *
 *   node GeoID_GIS/viewer/gis/atlas-tools.test.mjs
 */

import { TOOLS, toolByName, checkArgs, toolPrompt, parseToolCall, callFromIntent } from "./atlas-tools.js";
import { readIntent } from "./atlas-intent.js";
import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

ok(new Set(TOOLS.map((t) => t.name)).size === TOOLS.length, "tool names are unique");
const ash = toolByName("ashfall");
ok(checkArgs(ash, { volcano: "Etna", vei: 2 }).ok, "good arguments pass");
ok(!checkArgs(ash, {}).ok && /volcano is required/.test(checkArgs(ash, {}).problems.join()), "a missing required argument is named");
ok(/at most 5/.test(checkArgs(ash, { volcano: "Etna", vei: 9 }).problems.join()), "a VEI out of range is refused");
ok(/whole number/.test(checkArgs(ash, { volcano: "Etna", vei: 2.5 }).problems.join()), "an integer must be whole");
ok(checkArgs(ash, { volcano: "Etna", vei: "3" }).args.vei === 3, "a numeric string is read as a number");
ok(!("rm" in checkArgs(ash, { volcano: "Etna", rm: "-rf" }).args), "arguments the schema does not name are dropped");

const prompt = toolPrompt();
ok(TOOLS.every((t) => prompt.includes(`- ${t.name}:`)), "every tool is in the prompt");
ok(/TOOL \{"name"/.test(prompt), "the prompt says how to call one");

const call = parseToolCall('Running it now.\nTOOL {"name": "ashfall", "args": {"volcano": "Etna", "vei": 2, "start": "2026-10-11T14:00:00Z"}}\nDone.');
ok(call?.name === "ashfall" && call.args.vei === 2 && call.before === "Running it now.", "a TOOL line is read back with what came before");
ok(parseToolCall('TOOL {"name": "x", "args": {"note": "a } brace"}}')?.args.note === "a } brace", "braces inside strings do not end the call");
ok(parseToolCall("no tools here") === null, "an answer with no TOOL line is just text");
ok(parseToolCall("TOOL {not json}") === null, "malformed JSON is not a call");

const intent = readIntent("Atlas, model a small ashfall cloud emanating from mount etna if it were to erupt at 4pm today",
  { nowMs: Date.UTC(2026, 9, 11, 9, 30), zoneOffsetMin: 0 });
const fromIntent = callFromIntent(intent);
ok(fromIntent.name === "ashfall" && fromIntent.args.volcano === "mount etna" && fromIntent.args.vei === 2
  && fromIntent.args.start === "2026-10-11T16:00:00.000Z", "the prompt becomes an ashfall call", JSON.stringify(fromIntent));
ok(checkArgs(ash, fromIntent.args).ok, "and its arguments pass the tool's own checks");

// Every tool has a runner on the page, and every runner a tool.
const runner = readFileSync(new URL("./atlas-runner.js", import.meta.url), "utf8");
for (const t of TOOLS) ok(new RegExp(`async ${t.name}\\(`).test(runner), `the ${t.name} tool has a runner`);
