/**
 * Running a tool Atlas was asked for — from a sentence or from a model — and
 * saying what came of it, in the {text, actions} shape the assistant draws.
 *
 * The registry (`atlas-tools.js`) says what exists and checks arguments; this
 * file is the one place each tool meets the page, through the seam of the
 * module that owns it. A tool whose module is not on this page answers so in
 * words rather than failing somewhere a reader cannot see.
 */

import { toolByName, checkArgs } from "./atlas-tools.js?v=20261025-f5a5da0";

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

  async flight_risk(args, { onStatus }) {
    if (!window.GeoIDFlightRisk) await import(`./flight-risk-panel.js${STAMP}`);
    const F = window.GeoIDFlightRisk;
    if (!F?.assess) return { text: "Flight route risk is computed on the Earth globe only.", actions: [] };
    if (!args.callsign && (!args.from || !args.to)) {
      return { text: "Which flight? Say “how risky is a flight from London to New York today”, or give a live callsign.", actions: [] };
    }
    const out = await F.assess({
      from: args.from, to: args.to, callsign: args.callsign,
      departMs: args.depart ? Date.parse(args.depart) : Date.now(), onStatus,
    });
    return { text: out.text, actions: [["Show the risk profile", () => F.open()]] };
  },

  async build_mesh(args) {
    const studio = window.GeoIDMeshStudio;
    if (!studio?.addShapes) return { text: "The Meshing Studio is not loaded on this page.", actions: [] };
    const { readMeshRequest } = await import(`./atlas-mesh-spec.js${STAMP}`);
    const spec = readMeshRequest(args.description);
    if (!spec) {
      return {
        text: "I can build a volcano with a magma chamber, or a layered crust with a dike, and mesh it — "
          + "say the sizes, e.g. “build a stratovolcano 3 km high with a magma chamber at 5 km depth”.",
        actions: [],
      };
    }
    if (window.GeoIDModeManager?.getMode?.() !== "model") window.GeoIDModeManager?.setMode?.("model");
    const added = studio.addShapes(spec.shapes, { replace: true });
    if (!added.ok) return { text: `I couldn't build that: ${added.problems.join("; ")}.`, actions: [] };
    studio.setMeshSizes({ maxM: spec.sizeM, minM: 0, curvature: spec.curvature });
    studio.fitView?.();
    const heard = spec.said.length ? `from your words: ${spec.said.join(", ")}` : "every size assumed";
    const built = `Built ${spec.label} (${heard}${spec.said.length && spec.assumed.length ? "; the rest in proportion" : ""}). `;
    const mesher = args.mesher || spec.mesher || studio.getMesher();
    const missing = await studio.setMesher(mesher);
    if (missing) {
      return { text: built + missing, actions: [["Mesh it with gmsh instead", () => window.GeoIDAtlas?.ask?.("mesh it with gmsh")]] };
    }
    const out = await studio.meshWith(mesher, { name: `atlas_${spec.template}` });
    return { text: `${built}${mesher === "blender" ? "Blender" : "gmsh"}, ${(spec.sizeM / 1000).toFixed(spec.sizeM < 1000 ? 2 : 1)} km elements: ${out.text}`, actions: [] };
  },

  async mesh_model(args) {
    const studio = window.GeoIDMeshStudio;
    if (!studio?.meshWith) return { text: "The Meshing Studio is not loaded on this page.", actions: [] };
    if (window.GeoIDModeManager?.getMode?.() !== "model") window.GeoIDModeManager?.setMode?.("model");
    const mesher = args.mesher || studio.getMesher();
    const missing = await studio.setMesher(mesher);
    if (missing) return { text: missing, actions: [] };
    const out = await studio.meshWith(mesher);
    return { text: out.text, actions: [] };
  },

  async blender_mesh(args) {
    const studio = window.GeoIDMeshStudio;
    if (!studio?.addShapes) return { text: "The Meshing Studio is not loaded on this page.", actions: [] };
    if (window.GeoIDModeManager?.getMode?.() !== "model") window.GeoIDModeManager?.setMode?.("model");
    const added = studio.addShapes(args.shapes, { replace: args.replace !== false });
    if (!added.ok) return { text: `I can't build those shapes: ${added.problems.join("; ")}.`, actions: [] };
    const missing = await studio.setMesher("blender");
    if (missing) return { text: `Added ${added.added} shape(s) to the Meshing Studio, but ${missing.charAt(0).toLowerCase()}${missing.slice(1)}`, actions: [] };
    const out = await studio.meshWithBlender({ name: args.name || null, via: args.via || "auto" });
    return {
      text: `Added ${added.added} shape(s). ${out.text}`,
      actions: out.ok ? [] : [["Mesh it with gmsh instead", () => studio.meshWithGmsh()]],
    };
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

  async infrastructure_exposed(args, { onStatus }) {
    if (!window.GeoIDInfrastructure) await import(`./infrastructure-panel.js${STAMP}`);
    const I = window.GeoIDInfrastructure;
    if (!I?.ask) return { text: "The infrastructure readout is on the Earth globe only.", actions: [] };
    const out = await I.ask({
      hazard: args.hazard || "", area: args.area || "",
      bridges: Boolean(args.bridges), buildings: Boolean(args.buildings), onStatus,
    });
    const top = out.summary?.top?.find((i) => i.at);
    return {
      text: out.text,
      actions: top
        ? [[`Fly to ${top.name || top.type}`, () => I.flyToPoint(top.at[1], top.at[0])]]
        : [],
    };
  },

  async community_near(args) {
    const S = window.GeoIDSocial;
    if (!S?.near) return { text: "GeoID Network is not loaded on this page.", actions: [] };
    const out = await S.near({ radiusKm: args.radiusKm ?? 50 });
    return {
      text: out.text,
      actions: out.items.length
        ? [["Show the Community layer", () => S.setCommunity(true)]]
        : [],
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
