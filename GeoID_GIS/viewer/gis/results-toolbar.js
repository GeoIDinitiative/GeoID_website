/**
 * THE RESULTS TOOLBAR: the run's field, component, time and colour map in
 * one row under the ribbon — ParaView's own arrangement, where the things
 * changed a hundred times a session are never behind a fold.
 *
 * It is a second face of the Results panel's "Field and time" and "Colour
 * map" sections, not a second implementation: every control reads the
 * panel's state and writes it back through the panel's own `refresh`, and
 * the panel's sections re-render themselves, so the two cannot disagree.
 * It shows while a run is open and folds with the ribbon.
 */

const byId = (id) => document.getElementById(id);
const R = () => window.GeoIDGalesResults;
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

const T = { node: null, key: "", built: false };

function fieldLabel(f) {
  if (f.temporal) return `${f.desc.label} · ${f.steps[0].name}`;
  if (f.gradient) return f.desc.label;
  if (f.calc) return `Calculated · ${f.desc.label}`;
  if (f.compare) return `Δ ${f.from}`;
  if (f.derived) return "Stress, strain and tilt";
  return f.desc?.label && f.desc.label !== f.field ? `${f.desc.label} (${f.field})` : f.field;
}

function componentOptions(S, desc) {
  if (!desc) return [];
  const canLos = Boolean(desc.displacement && desc.displacement.length >= 3);
  return [
    ...(desc.vector ? [["mag", desc.vector.label]] : []),
    ...desc.components.map((c, j) => [String(j), c.label]),
    ...(canLos ? [["los", "Satellite LOS (InSAR)"], ["fringe", "Fringes (wrapped)"]] : []),
  ];
}

/** Rebuilt only when what the selects list changes; otherwise values are synced in place. */
function render() {
  const results = R();
  const S = results?.state;
  const bar = T.node;
  if (!bar) return;
  if (!S?.mesh || window.GeoIDModeManager?.getMode?.() !== "model") { bar.hidden = true; T.key = ""; return; }
  bar.hidden = false;
  const f = S.fields[S.field];
  const desc = f?.desc || null;
  const comps = componentOptions(S, desc);
  const key = [S.fields.map((x) => `${x.field}:${x.ok}`).join("|"), S.field, comps.map((c) => c[0]).join(","), f?.steps.length || 0, Object.keys(results.colormaps?.() || {}).length].join("#");
  if (key !== T.key) {
    T.key = key;
    bar.textContent = "";
    const fieldSel = el("select", { class: "studio-select", title: "The field shown" });
    S.fields.forEach((x, k) => fieldSel.append(new Option(fieldLabel(x), String(k), false, k === S.field, )));
    [...fieldSel.options].forEach((o, k) => { o.disabled = !S.fields[k].ok; });
    fieldSel.addEventListener("change", () => { S.field = Number(fieldSel.value); const g = S.fields[S.field]; S.step = g ? g.steps.length - 1 : 0; S.component = ""; results.renderControls?.(); results.refresh(); });
    const compSel = el("select", { class: "studio-select", title: "The component drawn" });
    for (const [v, label] of comps) compSel.append(new Option(label, v, false, v === S.component));
    compSel.addEventListener("change", () => { S.component = compSel.value; results.renderControls?.(); results.refresh(); });
    const steps = f?.steps || [];
    const transport = el("span", { class: "studio-rbar-transport" });
    const btn = (label, title, fn) => { const b = el("button", { class: "studio-btn", type: "button", title }, label); b.addEventListener("click", fn); transport.append(b); return b; };
    btn("|◀", "First step (Home)", () => { S.step = 0; results.refresh(); });
    btn("◀", "The step before (,)", () => { S.step = Math.max(0, S.step - 1); results.refresh(); });
    const play = btn(S.playing ? "❚❚" : "▶", "Play through the steps (space)", () => (S.playing ? results.stop?.() : results.play?.()));
    play.dataset.role = "play";
    btn("▶", "The step after (.)", () => { S.step = Math.min(steps.length - 1, S.step + 1); results.refresh(); });
    btn("▶|", "Last step (End)", () => { S.step = steps.length - 1; results.refresh(); });
    const slider = el("input", { class: "studio-rbar-step", type: "range", min: "0", max: String(Math.max(0, steps.length - 1)), step: "1", value: String(S.step), title: "Time step" });
    slider.addEventListener("input", () => { S.step = Number(slider.value); results.refresh(); });
    slider.disabled = steps.length < 2;
    const readout = el("span", { class: "studio-rbar-readout", "data-role": "readout" });
    const mapSel = el("select", { class: "studio-select", title: "Colour map" });
    for (const name of Object.keys(results.colormaps?.() || {})) mapSel.append(new Option(name, name, false, name === S.colormap));
    mapSel.addEventListener("change", () => { S.colormap = mapSel.value; results.renderControls?.(); results.refresh(); });
    const rev = el("button", { class: `studio-btn is-toggle${S.reverse ? " is-on" : ""}`, type: "button", title: "Reverse the colour map" }, "⇄");
    rev.addEventListener("click", () => { S.reverse = !S.reverse; rev.classList.toggle("is-on", S.reverse); results.renderControls?.(); results.refresh(); });
    const range = el("button", { class: `studio-btn is-toggle${S.rangeMode === "step" ? " is-on" : ""}`, type: "button", title: "Rescale the colour range to this step (on) or keep it fixed (off)" }, "Auto");
    range.addEventListener("click", () => { S.rangeMode = S.rangeMode === "step" ? "fixed" : "step"; range.classList.toggle("is-on", S.rangeMode === "step"); results.renderControls?.(); results.refresh(); });
    bar.append(
      el("span", { class: "studio-label" }, "Field"), fieldSel,
      el("span", { class: "studio-label" }, "Show"), compSel,
      el("span", { class: "studio-sep" }),
      transport, slider, readout,
      el("span", { class: "studio-sep" }),
      el("span", { class: "studio-label" }, "Map"), mapSel, rev, range,
    );
    for (const s of bar.querySelectorAll("select, input")) s.addEventListener("keydown", (e) => e.stopPropagation());
    T.refs = { fieldSel, compSel, slider, readout, play, mapSel, rev, range };
  }
  const { fieldSel, compSel, slider, readout, play, mapSel, rev, range } = T.refs;
  if (fieldSel.value !== String(S.field)) fieldSel.value = String(S.field);
  if (compSel.value !== S.component && [...compSel.options].some((o) => o.value === S.component)) compSel.value = S.component;
  if (Number(slider.value) !== S.step) slider.value = String(S.step);
  const steps = f?.steps || [];
  readout.textContent = steps.length ? `t = ${steps[S.step]?.name}  (${S.step + 1}/${steps.length})` : "";
  play.textContent = S.playing ? "❚❚" : "▶";
  if (mapSel.value !== S.colormap) mapSel.value = S.colormap;
  rev.classList.toggle("is-on", Boolean(S.reverse));
  range.classList.toggle("is-on", S.rangeMode === "step");
}

/** Keys that move time, only while a run is open and nothing is being typed. */
function keys(event) {
  const results = R(); const S = results?.state;
  if (!S?.mesh || window.GeoIDModeManager?.getMode?.() !== "model") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  const f = S.fields[S.field];
  if (!f?.steps.length) return;
  const last = f.steps.length - 1;
  if (event.key === "." || event.key === "ArrowRight") { S.step = Math.min(last, S.step + 1); results.refresh(); }
  else if (event.key === "," || event.key === "ArrowLeft") { S.step = Math.max(0, S.step - 1); results.refresh(); }
  else if (event.key === "Home") { S.step = 0; results.refresh(); }
  else if (event.key === "End") { S.step = last; results.refresh(); }
  else if (event.key === " " && !event.ctrlKey && !event.metaKey) { if (S.playing) results.stop?.(); else results.play?.(); }
  else return;
  event.preventDefault();
}

function install() {
  const topbar = document.querySelector("#model-studio .studio-topbar");
  const ribbon = byId("studio-ribbon");
  if (!topbar || !ribbon || !R()) { setTimeout(install, 500); return; }
  T.node = el("div", { id: "studio-results-bar", class: "studio-ribbon studio-results-bar", hidden: true, "aria-label": "Results: field, time and colour" });
  topbar.append(T.node);
  // Folds with the ribbon: one gesture, one bar.
  new MutationObserver(() => { T.node.classList.toggle("is-folded", ribbon.classList.contains("is-folded")); }).observe(ribbon, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("geoid-gales:refreshed", render);
  setInterval(render, 1000);
  window.addEventListener("keydown", keys);
  render();
  window.GeoIDResultsToolbar = { render, state: T };
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
}
