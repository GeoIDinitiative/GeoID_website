/**
 * The one tool dialog — every descriptor renders through this template, so
 * every tool looks and behaves identically. Spec:
 * GeoID_GIS/docs/ni-prototype/tool-ux-spec.md §4 (dialog + chaining), §1
 * (the runner API this calls), §5 (prefs, via tool-prefs.js).
 *
 * It lives as a third workbench panel through the side-panels seam:
 * `window.GeoIDSidePanels.registerPanel(spec, contentNode)` — the extension
 * the spec adds to side-panels.js — then `open("tool")`, which inherits
 * placement, the exclusive-open rule, collapse and the sidebar shell for
 * free. Modules load in a list, so registerPanel is retried for a few
 * seconds before degrading to a fixed-position fallback container; the
 * dialog is then plainer but never absent.
 *
 * The runner (tool-runner.js) is resolved by dynamic import rather than a
 * static one so this module still parses and registers its seam when the
 * runner has not landed yet — same reasoning as the registerPanel retry.
 * A failed resolution is retried on the next openTool, never cached.
 *
 * Contract notes for integrators, called out rather than assumed:
 * - runTool(toolId, inputs, params, {outputName}) is called with layer
 *   RECORDS keyed by input name (what §1.1's engines consume:
 *   inputs.input.collection); if the runner wants ids instead, the mapping
 *   is one line in gatherAndRun().
 * - §4.3's "Chain into…" needs a prefilter the documented seam
 *   (open(query)) lacks; the chain context is passed as a SECOND argument —
 *   open("", {chain: {layerId, name, outputType}}) — which a strict
 *   open(query) ignores harmlessly. tool-search.js should consume it.
 * - History rows prefer a runner-exported getHistory() (sync or async, so a
 *   project-backed metadata/tool_history.json can answer) and fall back to
 *   the localStorage ring in tool-prefs. §1.3 names no reader export; one
 *   is requested here.
 * - resolveOutputName: a runner export is preferred when present; the local
 *   fallback implements §4.1 — {input} = first input's basename, {tool} =
 *   tool id, {n} = lowest free counter, collision appends _2.
 *
 * No document-level keydown is added here at all — Escape and the shortcut
 * belong to side-panels and tool-search — so the input/textarea exemption
 * law is honoured by having nothing to exempt.
 */

import { prefs, mergeParams } from "./tool-prefs.js?v=20260827-5caec2a";

const RUNNER_URL = "./tool-runner.js?v=20260827-5caec2a";

/* ── Dialog-only styles, injected as the house pattern dictates.
      NEVER a backtick inside this literal — it ends the string and kills the
      module silently (module-css.test.mjs pins this). ───────────────────── */
const STYLE = `
/* The favourite star in the panel header: quiet outline until it is one.
   Filled accent when favourited, matching the palette's star spec. */
.gis-tool-fav {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 5px;
  font-size: 0.9rem;
  line-height: 1;
  color: inherit;
  opacity: 0.35;
}
.gis-tool-fav:hover { opacity: 0.8; }
.gis-tool-fav.is-fav {
  color: rgb(var(--nav-accent-rgb));
  opacity: 1;
  text-shadow: 0 0 8px rgba(var(--nav-accent-rgb), 0.6);
}

/* Chain chips sit under the status line once a run succeeds. */
#gis-tool-chain { margin-top: 0.35rem; }

/* History rows: text in .gis-metric typography (the class rides on the
   span), this block adds only the layout around it. */
.gis-history-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
}
.gis-history-row .gis-history-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gis-history-row.is-failed .gis-history-text { opacity: 0.55; }
.gis-history-rerun { flex: 0 0 auto; }

/* The degraded shell when registerPanel never arrives: a fixed box where
   the workbench panels sit, borrowing the sidebar shell tokens by hand
   because there is no panel builder to lend them. z-index 30 clears the
   map legend (13) and tooltips (14) and stays under the modals (62). */
.gis-tool-dialog-fallback {
  position: fixed;
  top: 72px;
  right: 60px;
  width: 300px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 30;
  background: rgba(10, 2, 14, 0.92);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.34);
  border-radius: 10px;
  color: var(--text);
}
.gis-tool-dialog-fallback[hidden] { display: none; }
.gis-tool-dialog-fallback-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.75rem;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.2);
}
/* The heading law, value for value: Exo 2 white ink, not the accent. */
.gis-tool-dialog-fallback-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  font-size: 0.76rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gis-tool-dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 2px 4px;
  color: inherit;
  opacity: 0.6;
}
.gis-tool-dialog-close:hover { opacity: 1; }
.gis-tool-dialog-fallback-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem 0.55rem 0.85rem;
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisToolDialog = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── Runner resolution ──────────────────────────────────────────────────── */

let runnerPromise = null;

/**
 * Import the runner, retrying a few times because modules load in a list
 * and this one may be asked to open a tool before the registry's tag has
 * run. Success is cached; total failure clears the cache so a later call
 * tries again rather than being dead for the session.
 */
function ensureRunner() {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          return await import(RUNNER_URL);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      console.error("[GeoID GIS] tool-runner.js did not load; tool dialog idle");
      runnerPromise = null;
      return null;
    })();
  }
  return runnerPromise;
}

/* ── Shared state ───────────────────────────────────────────────────────── */

const state = {
  runner: null,        // resolved tool-runner module
  contentRoot: null,   // #gis-tool-dialog, handed to registerPanel
  registered: false,   // true once GeoIDSidePanels.registerPanel accepted it
  fallback: null,      // the fixed-position degraded shell, when needed
  fallbackTitle: null,
  star: null,          // the favourite button in whichever header exists
  desc: null,          // descriptor currently rendered
  lastResult: null,    // {layerId, name, outputType} of the last success
};

const raf = (fn) => (typeof window !== "undefined" && window.requestAnimationFrame
  ? window.requestAnimationFrame(fn)
  : setTimeout(fn, 16));

function byId(id) {
  // The dialog's own root first: renderTool fills its controls BEFORE the
  // fallback container joins the document, and getElementById cannot see a
  // detached tree — every select rendered empty for exactly that reason.
  // querySelector on the root works attached or not; the document fallback
  // still finds panel-host nodes that live outside the root.
  return state.contentRoot?.querySelector?.(`#${id}`) || document.getElementById(id);
}

function setStatus(text) {
  const node = byId("gis-tool-status");
  if (node) node.textContent = text;
}

/**
 * The toolbox-ops fillSelect semantics, copied not imported (it is not an
 * export there): previous choice preserved when it survives the refill.
 * Note: option accessors must not be named valueOf/toString — inherited
 * from Object.prototype, a destructuring default would never apply.
 */
function fillSelect(select, items, { getValue = (i) => i.id, getLabel = (i) => i.name } = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  if (!items.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "None available";
    select.appendChild(opt);
    return;
  }
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = getLabel(item);
    select.appendChild(opt);
  });
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

/* ── Layer plumbing ─────────────────────────────────────────────────────── */

function refreshInputSelects() {
  const { desc, runner } = state;
  if (!desc || !runner?.layersByType) return;
  (desc.inputs || []).forEach((input) => {
    fillSelect(byId(`gis-tool-in-${input.name}`), runner.layersByType(input.type || "any"));
  });
}

function selectedInputLayer(inputName) {
  const { desc, runner } = state;
  if (!desc || !runner?.layersByType) return null;
  const input = (desc.inputs || []).find((i) => i.name === inputName);
  if (!input) return null;
  const id = byId(`gis-tool-in-${inputName}`)?.value;
  if (!id) return null;
  return runner.layersByType(input.type || "any").find((l) => String(l.id) === id) || null;
}

/**
 * kind:"field" params list the *selected* input layer's fields — the
 * syncVectorOpInputs pattern (toolbox-ops.js:149–169) generalised. A param
 * may name its source input as `of`; the first declared input otherwise.
 */
function syncFieldParams() {
  const { desc, contentRoot } = state;
  if (!desc || !contentRoot) return;
  contentRoot.querySelectorAll('select[data-param-kind="field"]').forEach((select) => {
    const param = (desc.params || []).find((p) => p.name === select.dataset.paramName);
    const sourceName = param?.of || desc.inputs?.[0]?.name;
    const layer = sourceName ? selectedInputLayer(sourceName) : null;
    const fields = layer?.info?.fields || [];
    // The value to restore: what the user picked, else the merged prefill
    // parked on the node at build time.
    const want = select.value || select.dataset.want || "";
    fillSelect(select, fields.map((f) => ({ id: f, name: f })));
    if (want && [...select.options].some((o) => o.value === want)) {
      select.value = want;
    }
  });
}

/* ── Output naming (§4.1) ───────────────────────────────────────────────── */

function existingLayerNames() {
  return new Set((window.GeoIDImportManager?.getLayers?.() || []).map((l) => l.name));
}

function resolveOutputName() {
  const { desc, runner } = state;
  if (!desc) return "";
  const firstInput = desc.inputs?.[0];
  const layer = firstInput ? selectedInputLayer(firstInput.name) : null;
  // Prefer the runner's own resolver when it ships one, so the dialog and
  // the run pipeline cannot disagree about what a template means.
  if (typeof runner?.resolveOutputName === "function") {
    try {
      return runner.resolveOutputName(desc, firstInput ? { [firstInput.name]: layer } : {});
    } catch {
      /* fall through to the local rules */
    }
  }
  const base = (layer?.name || "layer").replace(/\.[^.]+$/, "");
  const template = desc.outputName || `${desc.id}_{input}`;
  const fill = (n) => template
    .replace(/\{input\}/g, base)
    .replace(/\{tool\}/g, desc.id)
    .replace(/\{n\}/g, n === null ? "" : String(n));
  const taken = existingLayerNames();
  if (/\{n\}/.test(template)) {
    for (let n = 1; n < 10000; n += 1) {
      if (!taken.has(fill(n))) return fill(n);
    }
  }
  const name = fill(null);
  if (!taken.has(name)) return name;
  for (let n = 2; n < 10000; n += 1) {
    if (!taken.has(`${name}_${n}`)) return `${name}_${n}`;
  }
  return name;
}

/** Re-resolve on input change UNLESS the user has typed — dataset.touched,
    the toolbox-ops:422 pattern. */
function resolveOutputNameIntoField() {
  const output = byId("gis-tool-output");
  if (!output || output.dataset.touched) return;
  output.value = resolveOutputName();
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

function buildParamRow(param, value) {
  const row = document.createElement("div");
  row.className = "row";
  const id = `gis-tool-param-${param.name}`;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = param.label || param.name;

  const kind = param.kind || "text";
  let control;
  if (kind === "number") {
    control = document.createElement("input");
    control.type = "number";
    control.className = "input";
    if (param.step !== undefined) control.step = String(param.step);
    if (value !== undefined && value !== null) control.value = String(value);
  } else if (kind === "checkbox") {
    control = document.createElement("input");
    control.type = "checkbox";
    control.checked = Boolean(value);
  } else if (kind === "select") {
    control = document.createElement("select");
    control.className = "mini-select";
    (param.options || []).forEach((option) => {
      const opt = document.createElement("option");
      const optValue = typeof option === "object" ? option.value ?? option.id : option;
      const optLabel = typeof option === "object" ? option.label ?? option.name ?? optValue : option;
      opt.value = String(optValue);
      opt.textContent = String(optLabel);
      control.appendChild(opt);
    });
    if (value !== undefined && value !== null) control.value = String(value);
  } else if (kind === "field") {
    control = document.createElement("select");
    control.className = "mini-select";
    // Options come from the selected input layer in syncFieldParams; the
    // merged value is parked on the node for that sync to restore.
    if (value !== undefined && value !== null) control.dataset.want = String(value);
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.className = "input";
    if (value !== undefined && value !== null) control.value = String(value);
  }
  control.id = id;
  control.dataset.paramName = param.name;
  control.dataset.paramKind = kind;
  row.append(label, control);
  return row;
}

/**
 * Render one descriptor into the panel, §4.1's markup shape: blurb, one
 * typed select per input, one row per param keyed on kind, output name,
 * Run/Defaults, status, chain chips (hidden until a success).
 */
function renderTool(desc, prefill = {}) {
  const root = state.contentRoot;
  if (!root) return;
  state.desc = desc;
  state.lastResult = null;
  root.innerHTML = "";
  root.dataset.tool = desc.id;

  const blurb = document.createElement("p");
  blurb.id = "gis-tool-blurb";
  blurb.className = "tool-copy";
  blurb.textContent = desc.blurb || "";
  root.appendChild(blurb);

  (desc.inputs || []).forEach((input) => {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.htmlFor = `gis-tool-in-${input.name}`;
    label.textContent = input.label || input.name;
    const select = document.createElement("select");
    select.id = `gis-tool-in-${input.name}`;
    select.className = "mini-select";
    select.dataset.inputName = input.name;
    select.addEventListener("change", () => {
      syncFieldParams();
      resolveOutputNameIntoField();
    });
    row.append(label, select);
    root.appendChild(row);
  });

  // §4.4's merge: descriptor defaults ← saved per-tool prefs ← prefill.
  const saved = prefs.getToolPrefs(desc.id) || {};
  const defaults = {};
  (desc.params || []).forEach((p) => { defaults[p.name] = p.default; });
  const merged = mergeParams(defaults, saved.params, prefill.params);
  (desc.params || []).forEach((param) => {
    root.appendChild(buildParamRow(param, merged[param.name]));
  });

  const outRow = document.createElement("div");
  outRow.className = "row";
  const outLabel = document.createElement("label");
  outLabel.htmlFor = "gis-tool-output";
  outLabel.textContent = "Output name";
  const output = document.createElement("input");
  output.id = "gis-tool-output";
  output.className = "input";
  output.type = "text";
  output.addEventListener("input", () => { output.dataset.touched = "1"; });
  outRow.append(outLabel, output);
  root.appendChild(outRow);

  const buttons = document.createElement("div");
  buttons.className = "gis-btn-row";
  const run = document.createElement("button");
  run.id = "gis-tool-run";
  run.className = "tool-button";
  run.type = "button";
  run.textContent = "Run";
  run.addEventListener("click", gatherAndRun);
  const reset = document.createElement("button");
  reset.id = "gis-tool-reset";
  reset.className = "button secondary";
  reset.type = "button";
  reset.textContent = "Defaults";
  reset.addEventListener("click", resetToDefaults);
  buttons.append(run, reset);
  root.appendChild(buttons);

  const status = document.createElement("div");
  status.id = "gis-tool-status";
  status.className = "gis-metric";
  status.setAttribute("aria-live", "polite");
  root.appendChild(status);

  const chain = document.createElement("div");
  chain.id = "gis-tool-chain";
  chain.className = "measure-actions";
  chain.hidden = true;
  const use = document.createElement("button");
  use.id = "gis-tool-chain-use";
  use.className = "button secondary";
  use.type = "button";
  use.textContent = "→ Use result as input";
  use.addEventListener("click", chainUseResult);
  const next = document.createElement("button");
  next.id = "gis-tool-chain-next";
  next.className = "button secondary";
  next.type = "button";
  next.textContent = "Chain into…";
  next.addEventListener("click", chainInto);
  chain.append(use, next);
  root.appendChild(chain);

  // Now the data: typed selects, then any explicit input prefill (§4.3's
  // chain hand-off), then field params off whatever is now selected.
  refreshInputSelects();
  Object.entries(prefill.prefillInputs || {}).forEach(([name, layerId]) => {
    const select = byId(`gis-tool-in-${name}`);
    if (select && [...select.options].some((o) => o.value === String(layerId))) {
      select.value = String(layerId);
    }
  });
  syncFieldParams();

  // Output name: an explicit prefill is an instruction and sticks (touched);
  // a saved name shows but yields to re-resolution when the input changes;
  // otherwise the descriptor template resolves now.
  if (prefill.outputName) {
    output.value = prefill.outputName;
    output.dataset.touched = "1";
  } else if (saved.outputName) {
    output.value = saved.outputName;
  } else {
    output.value = resolveOutputName();
  }
}

/** The Defaults button: clear the remembered per-tool prefs (§5) and render
    the descriptor's own values back in. */
function resetToDefaults() {
  const { desc } = state;
  if (!desc) return;
  prefs.clearToolPrefs(desc.id);
  renderTool(desc, {});
  setStatus("Descriptor defaults restored.");
}

/* ── Running (§1.2 through §4.1) ────────────────────────────────────────── */

function gatherAndRun() {
  const { desc, runner } = state;
  if (!desc || !runner?.runTool) {
    setStatus("Tool runner is not loaded yet.");
    return;
  }
  const inputs = {};
  for (const input of desc.inputs || []) {
    const layer = selectedInputLayer(input.name);
    if (!layer) {
      setStatus(`Select a layer for ${input.label || input.name}.`);
      return;
    }
    inputs[input.name] = layer;
  }
  const params = {};
  (desc.params || []).forEach((param) => {
    const control = byId(`gis-tool-param-${param.name}`);
    if (!control) return;
    if (param.kind === "number") params[param.name] = Number(control.value);
    else if (param.kind === "checkbox") params[param.name] = control.checked;
    else params[param.name] = control.value;
  });
  const outputName = byId("gis-tool-output")?.value?.trim() || undefined;

  // Status first, run inside requestAnimationFrame — the existing UX
  // (toolbox-ops.js:185–194) so long operations still paint their status.
  setStatus(`Running ${desc.label || desc.id}…`);
  raf(() => {
    Promise.resolve()
      // runToolAuto picks the engine (native here, or GDAL in the sidecar when
      // it is connected, capable and the input is big enough to be worth it)
      // and falls back to native by itself. A runner that predates it still
      // answers runTool, so the dialog works against either.
      .then(() => (runner.runToolAuto || runner.runTool)(desc.id, inputs, params, { outputName }))
      .then((result) => {
        if (!result || result.ok === false) {
          setStatus(result?.message || "Failed.");
          return;
        }
        setStatus(result.message || "Done.");
        // The returned layer record is what makes one-click chaining
        // possible at all (§1.2) — keep what the chips need.
        state.lastResult = {
          layerId: result.layer?.id,
          name: result.layer?.name || outputName,
          outputType: result.outputType || desc.outputType,
        };
        const chain = byId("gis-tool-chain");
        if (chain) chain.hidden = false;
        // Prefs on success (§4.1/§5): recents for the palette, params +
        // output name so the tool reopens as it was last used.
        prefs.pushRecent(desc.id);
        prefs.saveToolPrefs(desc.id, { params, outputName });
        renderHistoryRows();
        // The produced name is taken now; an untouched output field steps
        // to the next free one so an immediate re-run cannot collide.
        resolveOutputNameIntoField();
      })
      .catch((error) => {
        console.error("[GeoID GIS] tool run failed", error);
        setStatus(`Failed: ${error.message}`);
      });
  });
}

/* ── Chaining (§4.3) ────────────────────────────────────────────────────── */

function chainUseResult() {
  const { desc, lastResult } = state;
  if (!desc || !lastResult) return;
  const compatible = (desc.inputs || []).find((input) => {
    const type = input.type || "any";
    return type === "any" || !lastResult.outputType || type === lastResult.outputType;
  });
  if (!compatible) {
    setStatus(`No input on this tool takes a ${lastResult.outputType || "result"} layer.`);
    return;
  }
  const select = byId(`gis-tool-in-${compatible.name}`);
  if (!select) return;
  // The derived layer was announced through onChange as it was added, so
  // the option normally exists already; refresh if the notification has
  // not landed yet.
  if (![...select.options].some((o) => o.value === String(lastResult.layerId))) {
    refreshInputSelects();
  }
  select.value = String(lastResult.layerId);
  // Setting .value in code notifies nobody — the recorded lesson — so the
  // field params and output name resync off a dispatched change.
  select.dispatchEvent(new Event("change"));
}

function chainInto() {
  const { lastResult } = state;
  if (!lastResult) return;
  const search = window.GeoIDToolSearch;
  if (typeof search?.open !== "function") {
    setStatus("Tool search is not loaded yet.");
    return;
  }
  // Documented seam is open(query); the chain context rides as a second
  // argument for the palette to prefilter on (§4.3) — see the module
  // header's contract note.
  search.open("", {
    chain: {
      layerId: lastResult.layerId,
      name: lastResult.name,
      outputType: lastResult.outputType,
    },
  });
}

/* ── The panel shell ────────────────────────────────────────────────────── */

function buildStar() {
  const star = document.createElement("button");
  star.type = "button";
  star.className = "gis-tool-fav";
  star.textContent = "★";
  star.title = "Favourite";
  star.setAttribute("aria-label", "Toggle favourite");
  star.setAttribute("aria-pressed", "false");
  star.addEventListener("click", () => {
    if (!state.desc) return;
    const on = prefs.toggleFavourite(state.desc.id);
    star.classList.toggle("is-fav", on);
    star.setAttribute("aria-pressed", on ? "true" : "false");
  });
  return star;
}

function updateStar() {
  if (!state.star || !state.desc) return;
  const on = prefs.isFavourite(state.desc.id);
  state.star.classList.toggle("is-fav", on);
  state.star.setAttribute("aria-pressed", on ? "true" : "false");
}

function tryRegisterPanel() {
  if (state.registered || state.fallback) return true;
  const seam = window.GeoIDSidePanels;
  if (typeof seam?.registerPanel !== "function") return false;
  seam.registerPanel({ id: "tool", title: "Tool", hint: "Tool dialog" }, state.contentRoot);
  state.registered = true;
  // The favourite star joins the panel builder's own header, between the
  // title and the collapse/close actions it already provides (§4.1).
  const head = document.querySelector("#gis-side-panel-tool .brand-toprow");
  if (head) {
    state.star = buildStar();
    const title = head.querySelector(".gis-side-panel-title");
    if (title?.nextSibling) head.insertBefore(state.star, title.nextSibling);
    else head.appendChild(state.star);
  }
  return true;
}

function buildFallback() {
  if (state.registered || state.fallback) return;
  const panel = document.createElement("section");
  panel.className = "gis-tool-dialog-fallback";
  panel.id = "gis-tool-dialog-fallback";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Tool");

  const head = document.createElement("div");
  head.className = "gis-tool-dialog-fallback-head";
  const title = document.createElement("span");
  title.className = "gis-tool-dialog-fallback-title";
  title.textContent = "Tool";
  state.star = buildStar();
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-tool-dialog-close";
  close.textContent = "✕";
  close.title = "Close";
  close.setAttribute("aria-label", "Close tool dialog");
  close.addEventListener("click", () => { panel.hidden = true; });
  head.append(title, state.star, close);

  const body = document.createElement("div");
  body.className = "gis-tool-dialog-fallback-body";
  body.appendChild(state.contentRoot);

  panel.append(head, body);
  document.body.appendChild(panel);
  state.fallback = panel;
  state.fallbackTitle = title;
  console.warn("[GeoID GIS] GeoIDSidePanels.registerPanel absent; tool dialog using fallback container");
}

function setPanelTitle(text) {
  if (state.registered) {
    const title = document.querySelector("#gis-side-panel-tool .gis-side-panel-title");
    if (title) title.textContent = text;
  } else if (state.fallbackTitle) {
    state.fallbackTitle.textContent = text;
  }
}

function isPanelOpen() {
  if (state.registered) return window.GeoIDSidePanels?.isOpen?.("tool") === true;
  return state.fallback ? !state.fallback.hidden : false;
}

function openPanel() {
  // Neither container may exist yet — the side-panel seam arrives with the
  // sidebar and the fallback is only built when it doesn't. Both branches
  // being false used to mean "open" did nothing at all, silently: the tool
  // rendered into a contentRoot that was attached to no document. Opening
  // therefore ensures a container rather than assuming one.
  if (!state.registered && !state.fallback) {
    if (!tryRegisterPanel()) buildFallback();
  }
  if (state.registered && document.getElementById("gis-side-panel-tool")) {
    window.GeoIDSidePanels.open("tool");
    return;
  }
  if (state.registered && !state.fallback) {
    // Registered against a seam that never rendered the panel. Nothing would
    // ever become visible; build the fallback and use it.
    state.registered = false;
    buildFallback();
  }
  if (state.fallback) state.fallback.hidden = false;
}

function focusFirstEmpty() {
  try {
    const controls = [...state.contentRoot.querySelectorAll("select, input")];
    const target = controls.find((c) => c.type !== "checkbox" && !String(c.value || "").length)
      || controls[0];
    target?.focus?.();
  } catch {
    /* focus is a courtesy, never a failure */
  }
}

/* ── openTool — the one door (§4.4) ─────────────────────────────────────── */

/**
 * Render a descriptor into the panel and open it. `prefill` may carry
 * `params`, `prefillInputs` ({inputName: layerId}) and `outputName`;
 * defaults ← saved prefs ← prefill, later wins. The palette, the History
 * "Run again", the chain chip and Atlas all enter here.
 */
export async function openTool(id, prefill = {}) {
  try {
    const runner = await ensureRunner();
    if (!runner) return;
    const desc = runner.toolById?.(id);
    if (!desc) {
      console.error(`[GeoID GIS] tool dialog: unknown tool "${id}"`);
      return;
    }
    state.runner = runner;
    renderTool(desc, prefill || {});
    // SHOW IT FIRST. Everything after this is decoration — the title, the
    // favourite star, the focus — and each was running before the panel was
    // opened, so anything that threw in one of them left a fully built dialog
    // sitting hidden: the tool "did nothing" while its Run button existed in
    // the DOM the whole time. Opening cannot be the last step in a sequence
    // whose earlier steps are allowed to fail.
    openPanel();
    try {
      setPanelTitle(desc.label || desc.id);
      updateStar();
      focusFirstEmpty();
    } catch (error) {
      console.warn("[GeoID GIS] tool dialog trimming failed", error);
    }
  } catch (error) {
    console.error("[GeoID GIS] openTool failed", error);
  }
}

/* ── History tile (§1.3's UI) ───────────────────────────────────────────── */

/**
 * The runner owns writing history; this reads it. A runner-exported
 * getHistory (sync or async) is preferred so a project-backed
 * metadata/tool_history.json can answer; the localStorage ring in
 * tool-prefs is the no-project fallback either way.
 */
async function readHistory() {
  try {
    const viaRunner = state.runner?.getHistory?.();
    const rows = viaRunner && typeof viaRunner.then === "function" ? await viaRunner : viaRunner;
    if (Array.isArray(rows)) return rows;
  } catch {
    /* the ring below still answers */
  }
  return prefs.getHistory();
}

async function renderHistoryRows() {
  const host = byId("gis-tool-history-rows");
  if (!host) return;
  const records = await readHistory();
  host.innerHTML = "";
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "gis-metric";
    empty.textContent = "No runs yet.";
    host.appendChild(empty);
    return;
  }
  records.slice(0, 12).forEach((record) => {
    const row = document.createElement("div");
    row.className = `gis-history-row${record.ok === false ? " is-failed" : ""}`;
    const text = document.createElement("span");
    text.className = "gis-metric gis-history-text";
    const when = record.t ? new Date(record.t).toLocaleTimeString() : "";
    const output = record.output?.name ? ` → ${record.output.name}` : "";
    text.textContent = `${record.label || record.tool}${output}${when ? ` · ${when}` : ""}`;
    if (record.message) text.title = record.message;
    const again = document.createElement("button");
    again.type = "button";
    again.className = "gis-history-rerun button secondary";
    again.textContent = "Run again";
    again.addEventListener("click", () => { openTool(record.tool, { params: record.params }); });
    row.append(text, again);
    host.appendChild(row);
  });
}

/** One new .gis-tool-section appended to #gis-group-preprocess's body —
    re-run is one click, per Phase 2 item 5. Returns true once it exists. */
function buildHistoryTile() {
  if (byId("gis-tool-history-section")) return true;
  const body = byId("gis-group-preprocess")?.querySelector(".section-body");
  if (!body) return false;
  const tile = document.createElement("details");
  tile.className = "gis-tool-section";
  tile.id = "gis-tool-history-section";
  const summary = document.createElement("summary");
  summary.textContent = "History";
  const tileBody = document.createElement("div");
  tileBody.className = "gis-tool-body";
  const rows = document.createElement("div");
  rows.id = "gis-tool-history-rows";
  tileBody.appendChild(rows);
  tile.append(summary, tileBody);
  body.appendChild(tile);
  renderHistoryRows();
  return true;
}

/* ── Layer-change subscription ──────────────────────────────────────────── */

function onLayersChanged() {
  // Typed selects refresh while the panel is open (§4.1); a closed panel
  // re-fills on its next openTool anyway.
  if (state.desc && isPanelOpen()) {
    refreshInputSelects();
    syncFieldParams();
    resolveOutputNameIntoField();
  }
  // Any run — legacy tiles included, once they delegate to the runner —
  // may have appended history.
  renderHistoryRows();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function init() {
  injectStyle();
  state.contentRoot = document.createElement("div");
  state.contentRoot.id = "gis-tool-dialog";
  state.contentRoot.className = "gis-tool-body";

  // The seam, merged non-destructively and immediately: tool-search may
  // load before or after this module and each contributes its own keys.
  window.GeoIDToolSearch = Object.assign({}, window.GeoIDToolSearch, { openTool });

  // Warm the runner so the History tile can read a project-backed history
  // without waiting for the first openTool. Failure is quiet — ensureRunner
  // already said its piece and openTool retries.
  ensureRunner().then((runner) => {
    if (runner) {
      state.runner = runner;
      renderHistoryRows();
    }
  }).catch(() => {});

  // Modules load in a list and the toolbox markup is reordered after load,
  // so everything that needs another module retries on a ticker rather than
  // assuming a moment: registerPanel (degrading to the fallback container
  // after ~7.5 s), the import-manager subscription, and the History tile's
  // anchor. Bounded so a page without the toolbox does not tick forever.
  let ticks = 0;
  let panelDone = false;
  let subscribed = false;
  let tileDone = false;
  const tick = () => {
    ticks += 1;
    if (!panelDone) {
      panelDone = tryRegisterPanel();
      if (!panelDone && ticks > 25) {
        buildFallback();
        panelDone = true;
      }
    }
    if (!subscribed && window.GeoIDImportManager?.onChange) {
      window.GeoIDImportManager.onChange(onLayersChanged);
      subscribed = true;
    }
    if (!tileDone) tileDone = buildHistoryTile();
    if (panelDone && subscribed && tileDone) return;
    if (ticks > 80) return;
    setTimeout(tick, 300);
  };
  tick();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
