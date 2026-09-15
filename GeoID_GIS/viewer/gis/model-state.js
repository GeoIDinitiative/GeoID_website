/**
 * A SAVED STATE of the Model page, as ParaView's .pvsm is one: the display
 * (field, step, colours, slice, contours, isosurfaces, threshold, calculated
 * fields, probe and points), the camera, and every analysis's settings with a
 * note of which had results -- so a figure can be made again from the run it
 * came from, by somebody else, next year.
 *
 * What a state does NOT hold is the data: the run is opened as it always is,
 * and the state applied to it. Fields are named, never indexed, so a state
 * outlives the order a folder happened to list them in; a name the open run
 * does not have is reported, not guessed.
 *
 * Pure: an object in, JSON out, and a reader that refuses what is not a state.
 */

export const STATE_KIND = "geoid-model-state";
export const STATE_VERSION = 1;

export function makeState({ results, analysis, camera, saved_at = new Date().toISOString(), note = "" }) {
  return { kind: STATE_KIND, version: STATE_VERSION, saved_at, note, results: results || null, analysis: analysis || null, camera: camera || null };
}

/** Parse and check a state file. Answers { state } or { error }. */
export function readState(text) {
  let obj;
  try { obj = typeof text === "string" ? JSON.parse(text) : text; } catch (error) { return { error: `Not JSON: ${error.message}` }; }
  if (!obj || typeof obj !== "object") return { error: "Not a state file." };
  if (obj.kind !== STATE_KIND) return { error: `Not a Model page state (kind is ${JSON.stringify(obj.kind ?? null)}).` };
  if (!Number.isInteger(obj.version) || obj.version > STATE_VERSION) return { error: `A state of version ${obj.version} is newer than this page reads (${STATE_VERSION}).` };
  const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (obj.camera && !(vec(obj.camera.position) && vec(obj.camera.target))) return { error: "The camera in the state is malformed." };
  if (obj.results?.calcs && !Array.isArray(obj.results.calcs)) return { error: "The calculated fields in the state are malformed." };
  return { state: obj };
}

/** A file name for a state: the run and field it shows. */
export function stateFileName(state) {
  const r = state?.results || {};
  const bits = [r.run, r.field, r.stepName !== null && r.stepName !== undefined ? `t${r.stepName}` : ""].filter(Boolean).join("_");
  return `model_state_${(bits || "session").replace(/[^A-Za-z0-9.]+/g, "_").slice(0, 80)}.json`;
}
