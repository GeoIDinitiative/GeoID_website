/**
 * What Atlas can DO, as a registry a model can read.
 *
 * Each tool is a name, a sentence, a JSON-schema of its arguments, and a run
 * function. Two callers use the same list, which is the point of it:
 *
 *   * the GROUNDED path — a sentence read by `atlas-intent.js` becomes a call
 *     here with no model at all (`callFromIntent`);
 *   * a CONNECTED model — the sidecar's subscription or an Atlas hub — is
 *     shown the list in its context (`toolPrompt`) and answers with a line
 *     `TOOL {"name": ..., "args": {...}}` that `parseToolCall` reads back.
 *
 * So a new capability is a row here, and both the phrase reader and any model
 * reach it the moment it is added. Nothing a model writes is run unless it
 * parses to a tool in this list with arguments that pass its own checks.
 */

import { readMeshRequest, readMesher } from "./atlas-mesh-spec.js?v=20261024-34ea3f0";

export const TOOLS = [
  {
    name: "ashfall",
    title: "Model ash from a volcanic eruption",
    says: "Where ash from an eruption would go in the air and land on the ground, carried by the "
      + "GFS wind over the vent at the time given: the deposit hour by hour on the globe, and the "
      + "ash in the air as a 3D model in the Model page.",
    args: {
      type: "object",
      required: ["volcano"],
      properties: {
        volcano: { type: "string", description: "The volcano's name, as the Smithsonian catalogue gives it" },
        vei: { type: "integer", minimum: 1, maximum: 5, description: "Size by Volcanic Explosivity Index; 2 is small, 4 large" },
        start: { type: "string", description: "When it erupts, ISO 8601 with a zone (default: now)" },
        followHours: { type: "number", minimum: 3, maximum: 72, description: "How long to follow the ash" },
      },
    },
  },
  {
    name: "ash3d",
    title: "Open the last ash model in 3D",
    says: "The ash in the air from the last ash model, as a 3D lattice an hour a step, opened in the "
      + "Model page's Results with aviation classes (0.2, 2, 4 mg/m³).",
    args: { type: "object", properties: {} },
  },
  {
    name: "chamber",
    title: "Build a volcano with a magma chamber for a finite-element model",
    says: "A volcano, its crust and a pressurised chamber as solids in the Meshing Studio, ready to "
      + "mesh and solve for ground deformation.",
    args: { type: "object", properties: { description: { type: "string" } } },
  },
  {
    name: "flight_risk",
    title: "How risky a flight is, along its route",
    says: "The great-circle route between two airports (or a live aircraft's onward path), flown at a "
      + "typical profile from the time given, with the hazards it passes through integrated along it: "
      + "active tropical cyclones (GDACS forecast and cone), clear-air turbulence and thunderstorms from "
      + "GFS, and ash from the last ash model. Answers the route's total in equivalent km at the limit, "
      + "the worst segment and the lowest factor of safety; draws the route and its risk profile.",
    args: {
      type: "object",
      properties: {
        from: { type: "string", description: "Departure airport: IATA/ICAO code, city or airport name" },
        to: { type: "string", description: "Arrival airport: IATA/ICAO code, city or airport name" },
        depart: { type: "string", description: "Departure time, ISO 8601 with a zone (default: now)" },
        callsign: { type: "string", description: "A live aircraft's callsign instead of from/to (it must be on the Aircraft layer)" },
      },
    },
  },
  {
    name: "build_mesh",
    title: "Build a model from a description and mesh it",
    says: "Reads a volcano with a magma chamber, or a layered crust block with a dike, from words — "
      + "with the heights, depths, radii, layer thicknesses and dips they name, in km or m — builds it "
      + "in the Meshing Studio and meshes it in the local sidecar with gmsh or Blender (the model's own "
      + "mesher unless the words name one). The mesh lands in the project's meshes/ and is drawn in the studio.",
    args: {
      type: "object",
      required: ["description"],
      properties: {
        description: { type: "string", description: "The model in words, e.g. a stratovolcano 3 km high with a magma chamber at 5 km depth" },
        mesher: { type: "string", enum: ["gmsh", "blender"], description: "Which mesher (default: the one the words or the model name, else gmsh)" },
      },
    },
  },
  {
    name: "mesh_model",
    title: "Mesh the Meshing Studio's model as it stands",
    says: "Meshes whatever is in the Meshing Studio now with gmsh (the default) or Blender, in the local "
      + "sidecar; the mesh lands in the open project's meshes/ and is drawn in the studio.",
    args: {
      type: "object",
      properties: {
        mesher: { type: "string", enum: ["gmsh", "blender"], description: "Which mesher (default: the model's own, gmsh unless chosen)" },
      },
    },
  },
  {
    name: "blender_mesh",
    title: "Build a model from shapes and mesh it with Blender",
    says: "Builds solids from a list of shapes in the Meshing Studio, then has Blender make them "
      + "(exact booleans; headless, or in the reader's open Blender through the blender-mcp addon) "
      + "and gmsh fill the volume. Metres, z up, z = 0 the ground. Each shape is {kind, op, ...numbers}: "
      + "box {x,y,z,dx,dy,dz} (x,y,z its corner), sphere {x,y,z,r}, ellipsoid {x,y,z,rx,ry,rz}, "
      + "cylinder {x,y,z,h,r} and cone {x,y,z,h,r1,r2} (x,y,z the base centre), torus {x,y,z,r1,r2}, "
      + "volcano_edifice {crust_width,crust_depth,height,base_radius,summit_radius}, "
      + "dike {x,y,length,height,thickness,top_depth,strike,dip}. op is union, difference or intersect "
      + "with everything before it (the first shape is the object); void: true on a cut leaves an empty hole "
      + "rather than a chamber volume.",
    args: {
      type: "object",
      required: ["shapes"],
      properties: {
        shapes: { type: "array", description: "The shapes, in order (at most 32)" },
        replace: { type: "boolean", description: "Clear the studio's model first (default true)" },
        via: { type: "string", enum: ["auto", "headless", "mcp"], description: "auto uses an open Blender if one is connected, else the installed binary" },
        name: { type: "string", description: "The mesh's file name in meshes/ (letters, digits, _ . -)" },
      },
    },
  },
  {
    name: "total_risk",
    title: "Score the total risk at a place",
    says: "Every hazard model that can answer for the centre of the view, combined hour by hour into one factor of safety.",
    args: { type: "object", properties: {} },
  },
  {
    name: "verification",
    title: "How well the hazard models have done against what happened",
    says: "The ledger of this browser's forecasts against the events observed since: hit rate, false "
      + "alarms, the Brier score and the calibration Atlas has learnt from them.",
    args: { type: "object", properties: { hazard: { type: "string" } } },
  },
  {
    name: "infrastructure_exposed",
    title: "List the infrastructure inside a hazard footprint",
    says: "Which cities and towns, seaports, airports, railways, roads, bridges, buildings and cables stand "
      + "inside a hazard map or drawn area on the globe, classed worst first on the hazard's own scale "
      + "(water depth, ash load, factor of safety, annual chance) and named. Cities, ports and airports "
      + "are always read; the other layers when they are on the globe.",
    args: {
      type: "object",
      properties: {
        hazard: { type: "string", description: "Which footprint: a hazard word (flood, ash, landslide, cyclone, volcanic, seismic, fire, sea level) or a layer's name; empty for the newest hazard map" },
        area: { type: "string", description: "\"drawn\" to cut the footprint to the drawn study area, or to read the drawn area alone" },
        bridges: { type: "boolean", description: "Fetch OpenStreetMap bridges over the footprint first" },
        buildings: { type: "boolean", description: "Fetch OpenStreetMap buildings over the footprint first (a district only)" },
      },
    },
  },
  {
    name: "community_near",
    title: "List community posts near the view",
    says: "Public GeoID Network posts, observations and projects near the centre of the view, with "
      + "who posted them and how each says it was made. Community content, unverified unless marked.",
    args: {
      type: "object",
      properties: {
        radiusKm: { type: "number", minimum: 1, maximum: 500, description: "How far from the centre of the view, in km (default 50)" },
      },
    },
  },
];

export function toolByName(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/**
 * Arguments checked against a tool's schema: required present, numbers in
 * range, integers whole. Returns { ok, args, problems } — never throws, so a
 * model's bad call becomes a sentence rather than an exception.
 */
export function checkArgs(tool, args = {}) {
  const problems = [];
  const schema = tool?.args || { properties: {} };
  const out = {};
  for (const name of schema.required || []) {
    if (args[name] === undefined || args[name] === null || args[name] === "") problems.push(`${name} is required`);
  }
  for (const [name, spec] of Object.entries(schema.properties || {})) {
    if (args[name] === undefined || args[name] === null || args[name] === "") continue;
    let v = args[name];
    if (spec.type === "number" || spec.type === "integer") {
      v = Number(v);
      if (!Number.isFinite(v)) { problems.push(`${name} must be a number`); continue; }
      if (spec.type === "integer" && !Number.isInteger(v)) { problems.push(`${name} must be a whole number`); continue; }
      if (spec.minimum !== undefined && v < spec.minimum) problems.push(`${name} must be at least ${spec.minimum}`);
      if (spec.maximum !== undefined && v > spec.maximum) problems.push(`${name} must be at most ${spec.maximum}`);
    } else if (spec.type === "string") {
      v = String(v);
    } else if (spec.type === "boolean") {
      // A model writes `true`, `"true"` or `"yes"` (and the opposites); anything
      // else is refused by name rather than guessed.
      if (typeof v === "string") {
        const w = v.trim().toLowerCase();
        v = ["true", "yes", "1"].includes(w) ? true : ["false", "no", "0"].includes(w) ? false : v;
      }
      if (typeof v !== "boolean") { problems.push(`${name} must be true or false`); continue; }
    } else if (spec.type === "array" && !Array.isArray(v)) {
      problems.push(`${name} must be a list`); continue;
    }
    if (spec.enum && !spec.enum.includes(v)) { problems.push(`${name} must be one of ${spec.enum.join(", ")}`); continue; }
    out[name] = v;
  }
  return { ok: !problems.length, args: out, problems };
}

/** The tools as a model is shown them, with the one way to call one. */
export function toolPrompt() {
  const lines = TOOLS.map((t) => `- ${t.name}: ${t.title}. ${t.says} Arguments (JSON schema): ${JSON.stringify(t.args)}`);
  return "You can run these GeoID tools. To run one, answer with a single line\n"
    + 'TOOL {"name": "<tool>", "args": {...}}\n'
    + "and nothing else on that line; say what you are doing in a sentence before it. Only call a tool the reader asked for.\n"
    + lines.join("\n");
}

/** The first `TOOL {...}` line in a model's answer, as { name, args, before }. */
export function parseToolCall(text) {
  const s = String(text || "");
  const at = s.search(/(^|\n)\s*TOOL\s*\{/);
  if (at < 0) return null;
  const start = s.indexOf("{", at);
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (!depth) {
        try {
          const obj = JSON.parse(s.slice(start, i + 1));
          if (!obj || typeof obj.name !== "string") return null;
          return { name: obj.name, args: obj.args && typeof obj.args === "object" ? obj.args : {}, before: s.slice(0, at).trim() };
        } catch { return null; }
      }
    }
  }
  return null;
}

const INFRA_WORDS = /\b(infrastructure|bridges?|ports?|seaports?|harbou?rs?|airports?|airfields?|railways?|rail(?:road)?s?|roads?|buildings?|hospitals?|schools?|cities|towns?|settlements?|cables?)\b/;
const INSIDE_WORDS = /\b(in|inside|within|under|exposed|affected|hit|at risk|reached|reach|which|what|how many|count|list)\b/;
const HAZARD_WORD = /\b(flood\w*|inundation|sea.?level|ash\w*|tephra|landslides?|cyclones?|hurricanes?|typhoons?|storm tracks?|volcan\w*|seismic|earthquakes?|wildfires?|fires?|alerts?|warnings?|river zones?|footprint|drawn area|study area|this area|my area)\b/;

/**
 * "Which bridges and ports are inside the flood?" as an `infrastructure_exposed`
 * call, read without a model. Needs a thing that is infrastructure, a word
 * that asks what is IN something, and either a hazard or an area to be in;
 * otherwise null, so "build a road" or "the port of Catania" pass by.
 */
export function infrastructureCall(text) {
  const q = String(text || "").toLowerCase();
  const thing = q.match(INFRA_WORDS);
  if (!thing || !INSIDE_WORDS.test(q)) return null;
  const hazard = q.match(HAZARD_WORD);
  if (!hazard) return null;
  const word = hazard[1];
  const isArea = /drawn area|study area|this area|my area/.test(word);
  return {
    name: "infrastructure_exposed",
    args: {
      ...(isArea || word === "footprint" ? {} : { hazard: word }),
      ...(isArea || /\b(drawn|study area|this area|my area)\b/.test(q) ? { area: "drawn" } : {}),
      ...(/\bbridges?\b/.test(q) ? { bridges: true } : {}),
      ...(/\b(buildings?|hospitals?|schools?)\b/.test(q) ? { buildings: true } : {}),
    },
  };
}

/** A read intent as a tool call, or null when no tool answers that task. */
export function callFromIntent(intent) {
  if (!intent) return null;
  switch (intent.task) {
    case "ashfall":
      return {
        name: "ashfall",
        args: {
          volcano: intent.place || "",
          vei: intent.vei ?? 2,
          start: new Date(intent.time?.ms ?? Date.now()).toISOString(),
          ...(intent.followHours ? { followHours: intent.followHours } : {}),
        },
      };
    case "chamber":
      return { name: "chamber", args: { description: intent.text } };
    case "build_mesh": {
      // A model named in the words is built from them; "mesh it" meshes
      // what the studio holds.
      const mesher = readMesher(intent.text);
      return readMeshRequest(intent.text)
        ? { name: "build_mesh", args: { description: intent.text, ...(mesher ? { mesher } : {}) } }
        : { name: "mesh_model", args: mesher ? { mesher } : {} };
    }
    case "risk":
      return { name: "total_risk", args: {} };
    case "flight":
      return intent.route
        ? { name: "flight_risk", args: { from: intent.route.from, to: intent.route.to, depart: new Date(intent.time?.ms ?? Date.now()).toISOString() } }
        : null;
    default:
      return null;
  }
}
