/**
 * Run one tool over many layers, or a chain over one.
 *
 * A tool you have to click once per input is a tool you use on one input. The
 * NI prototype is eleven steps; running it for a second catchment meant eleven
 * more dialogs, which is why the acceptance test was a script and not a
 * session in the GUI. The history records were always the serialisation format
 * for this — a run is `{tool, inputs, params}` and always has been — so a batch
 * is a list of those, not a new kind of thing.
 *
 * Deliberately NOT a graph editor. A list executed in order covers the case
 * people actually have (the same analysis over several areas), and the graph
 * can be built on this later without changing what a step is.
 */

const state = { running: false, cancel: false };

/** Parse a chain written as one tool per line: `slope`, `focal radius=2`. */
export function parseChain(text, toolById) {
  const steps = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [id, ...rest] = line.split(/\s+/);
    const desc = toolById?.(id);
    if (!desc) {
      errors.push(`line ${i + 1}: no tool called "${id}"`);
      return;
    }
    const params = {};
    rest.forEach((pair) => {
      const at = pair.indexOf("=");
      if (at <= 0) {
        errors.push(`line ${i + 1}: "${pair}" is not name=value`);
        return;
      }
      const key = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const known = (desc.params || []).some((p) => p.name === key);
      if (!known) errors.push(`line ${i + 1}: ${id} has no parameter "${key}"`);
      params[key] = Number.isFinite(Number(value)) && value !== "" ? Number(value) : value;
    });
    steps.push({ id, label: desc.label, params });
  });
  return { steps, errors };
}

/**
 * Run `steps` against each layer in `layers`, feeding each step's output into
 * the next. Returns one row per (layer, step) so a failure is attributable
 * rather than collapsing the whole run into "it didn't work".
 */
export async function runBatch({ layers, steps, runner, onProgress = null }) {
  if (state.running) return { ok: false, message: "a batch is already running" };
  if (!layers?.length) return { ok: false, message: "no input layers" };
  if (!steps?.length) return { ok: false, message: "no steps" };
  state.running = true;
  state.cancel = false;
  const rows = [];
  try {
    for (const layer of layers) {
      let current = layer;
      for (const step of steps) {
        if (state.cancel) {
          rows.push({ layer: layer.name, step: step.label, ok: false, note: "cancelled" });
          break;
        }
        const desc = runner.toolById(step.id);
        const inputName = (desc.inputs || [])[0]?.name || "input";
        const params = {};
        (desc.params || []).forEach((p) => { if (p.default !== undefined) params[p.name] = p.default; });
        Object.assign(params, step.params);
        let result;
        try {
          result = await runner.runToolAuto(step.id, { [inputName]: current }, params, {});
        } catch (error) {
          result = { ok: false, message: error?.message || String(error) };
        }
        rows.push({
          layer: layer.name, step: step.label, ok: Boolean(result?.ok),
          output: result?.layer?.name || "",
          note: result?.ok ? (result.message || "") : (result?.message || "failed"),
        });
        onProgress?.(rows.length, layers.length * steps.length, `${layer.name} → ${step.label}`);
        // A step that produced no layer cannot feed the next one; stopping
        // this chain and moving to the next input is more useful than running
        // the rest of the steps against a stale input and reporting successes.
        if (!result?.ok || !result.layer) break;
        current = result.layer;
      }
    }
  } finally {
    state.running = false;
  }
  const done = rows.filter((r) => r.ok).length;
  return {
    ok: true, rows,
    message: `${done} of ${rows.length} steps succeeded across ${layers.length} layers.`
      + (state.cancel ? " Cancelled part-way." : ""),
  };
}

export function cancelBatch() { state.cancel = true; }
export function isRunning() { return state.running; }

if (typeof window !== "undefined") {
  window.GeoIDBatch = { parseChain, runBatch, cancelBatch, isRunning };
}
