/**
 * Running a tool Atlas was asked for — from a sentence or from a model — and
 * saying what came of it, in the {text, actions} shape the assistant draws.
 *
 * The registry (`atlas-tools.js`) says what exists and checks arguments; this
 * file is the one place each tool meets the page, through the seam of the
 * module that owns it. A tool whose module is not on this page answers so in
 * words rather than failing somewhere a reader cannot see.
 */

import { toolByName, checkArgs } from "./atlas-tools.js?v=20261018-96f79da";

const STAMP = new URL(import.meta.url).search || "";

async function ash() {
  if (!window.GeoIDAtlasAsh) await import(`./atlas-ash.js${STAMP}`);
  return window.GeoIDAtlasAsh;
}

const RUNNERS = {
  async ashfall(args, { onStatus }) {
    const A = await ash();
    const found = await A.findVolcano(args.volcano);
    if (!found) {
      return {
        text: `I couldn't find a volcano called “${args.volcano}” in the Smithsonian catalogue. `
          + "Give me its name as the catalogue spells it — “Etna”, “Vesuvius”, “Fuji”.",
        actions: [],
      };
    }
    const startMs = args.start ? Date.parse(args.start) : Date.now();
    const run = await A.run({
      volcano: found.volcano, vei: args.vei ?? 2, startMs,
      followHours: args.followHours ?? null, onStatus,
    });
    const heard = found.how === "exact" ? "" : `(I read “${args.volcano}” as ${found.volcano.name}.)\n`;
    return {
      text: heard + A.describe(run),
      actions: [
        ["Show the ash in the air in 3D", () => window.GeoIDAtlas?.ask?.("open the ash in 3D")],
      ],
    };
  },

  async ash3d() {
    const A = await ash();
    if (!A.last()) return { text: "There is no ash model yet — ask me to model an eruption first.", actions: [] };
    const out = await A.open3D();
    return {
      text: `Opened the ash in the air as ${out.steps} hourly steps in the Model page's Results — `
        + `peak ${out.peakMgM3.toFixed(1)} mg/m³. Heights are drawn ×10 (the true height is the height_m field); `
        + "Threshold by domain picks out the aviation classes (0.2, 2 and 4 mg/m³).",
      actions: [],
    };
  },

  async chamber(args) {
    const studio = window.GeoIDMeshStudio;
    if (!studio?.buildFromText) return { text: "The Meshing Studio is not loaded on this page.", actions: [] };
    if (window.GeoIDModeManager?.getMode?.() !== "model") window.GeoIDModeManager?.setMode?.("model");
    const result = studio.buildFromText(`volcano with a chamber ${args.description || ""}`);
    return result.ok
      ? { text: `Built ${result.built} in the Meshing Studio. Give the solids materials and the chamber wall a pressure in Study, then mesh and solve.`, actions: [] }
      : { text: "The studio could not build that template.", actions: [] };
  },

  async total_risk() {
    const T = window.GeoIDTotalRisk;
    if (!T?.compute) return { text: "Total risk is computed on the Earth globe only.", actions: [] };
    const out = await T.compute();
    if (!out) return { text: "Nothing could answer for the middle of the view yet. The Workspace shield reads each risk map for the people there.", actions: [] };
    const fos = out.fos ?? out.worst?.fos;
    return {
      text: Number.isFinite(fos)
        ? `Total factor of safety at the centre of the view over the next 3 days: **${fos.toFixed(2)}**. The Workspace shield reads each risk map for the people there.`
        : "Computed. The Workspace shield reads each risk map for the people there.",
      actions: [],
    };
  },

  async verification(args) {
    const L = window.GeoIDAtlasLedger;
    if (!L?.report) return { text: "The verification ledger is not loaded on this page.", actions: [] };
    return { text: await L.report(args.hazard || null), actions: [] };
  },
};

/** Run a tool by name with arguments, checked. Always answers {text, actions}. */
export async function runTool(name, rawArgs = {}, { onStatus = () => {} } = {}) {
  const tool = toolByName(name);
  if (!tool || !RUNNERS[name]) return { text: `There is no tool called “${name}”.`, actions: [] };
  const { ok, args, problems } = checkArgs(tool, rawArgs);
  if (!ok) return { text: `I can't run ${tool.title.toLowerCase()} with that: ${problems.join("; ")}.`, actions: [] };
  try {
    return await RUNNERS[name](args, { onStatus });
  } catch (error) {
    return { text: `${tool.title} did not work: ${error.message}`, actions: [] };
  }
}
