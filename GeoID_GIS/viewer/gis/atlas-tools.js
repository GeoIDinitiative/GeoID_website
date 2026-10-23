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
    }
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
