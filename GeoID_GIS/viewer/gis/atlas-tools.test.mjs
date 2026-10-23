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

{
  const call = callFromIntent({ task: "flight", route: { from: "London", to: "New York" }, time: { ms: Date.UTC(2026, 9, 23, 12) } });
  ok(call?.name === "flight_risk" && call.args.from === "London" && call.args.depart === "2026-10-23T12:00:00.000Z", "a flight question becomes a flight_risk call");
  ok(checkArgs(toolByName("flight_risk"), call.args).ok, "and passes the tool's checks");
  ok(callFromIntent({ task: "flight", route: null }) === null, "no route, no call");
}
// The meshers: gmsh or Blender, by name or by a list of shapes.
const meshTool = toolByName("mesh_model");
ok(checkArgs(meshTool, { mesher: "blender" }).ok, "mesh_model takes blender");
ok(/must be one of gmsh, blender/.test(checkArgs(meshTool, { mesher: "netgen" }).problems.join()), "an unknown mesher is refused by name");
const shapesTool = toolByName("blender_mesh");
ok(/shapes is required/.test(checkArgs(shapesTool, {}).problems.join()), "blender_mesh needs shapes");
ok(/must be a list/.test(checkArgs(shapesTool, { shapes: "a box" }).problems.join()), "shapes must be a list");
const shaped = checkArgs(shapesTool, { shapes: [{ kind: "box" }], replace: "false", via: "mcp" });
ok(shaped.ok && Array.isArray(shaped.args.shapes) && shaped.args.replace === false, "a list and a boolean string pass through as themselves");
ok(/via must be one of/.test(checkArgs(shapesTool, { shapes: [], via: "ssh" }).problems.join()), "via is one of auto, headless, mcp");
const blenderIntent = readIntent("Atlas, build a volcano with a chamber and mesh it in Blender");
ok(blenderIntent.task === "build_mesh", "a build sentence is a build_mesh request");
const blenderCall = callFromIntent(blenderIntent);
ok(blenderCall?.name === "build_mesh" && blenderCall.args.mesher === "blender" && /volcano/.test(blenderCall.args.description), "naming Blender picks the Blender mesher");
const sized = callFromIntent(readIntent("build a stratovolcano 3 km high with a magma chamber at 5 km depth"));
ok(sized?.name === "build_mesh" && !("mesher" in sized.args), "a sized build goes to build_mesh, the model's own mesher");
ok(callFromIntent(readIntent("build a layered crust block with a dipping dike"))?.name === "build_mesh", "a layered crust with a dike too");
const meshIt = callFromIntent(readIntent("mesh it with gmsh"));
ok(meshIt?.name === "mesh_model" && meshIt.args.mesher === "gmsh", "“mesh it with gmsh” meshes what the studio holds");
ok(readIntent("model a small ashfall from Etna at 4pm today").task === "ashfall", "an ash model is still an ash model");
ok(readIntent("simulate inflation of the magma chamber under Campi Flegrei").task === "chamber", "a chamber without Blender is still the chamber tool");
