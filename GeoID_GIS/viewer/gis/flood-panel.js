/**
 * The flood's controls: scenarios to start from, sliders to shape it.
 *
 * Every control is one field of `floodState.params` in `dem-layer.js`, and a
 * change REBUILDS the inundation sheet rather than fetching anything — the
 * heights, the rivers and each cell's nearest river are kept for the view, so
 * what moves is arithmetic. Debounced, because a slider fires on every pixel;
 * the last position is always drawn (`rebuildSheet` waits out a build already
 * running rather than dropping the request).
 *
 * THE NUMBERS ARE SAID IN METRES AS WELL, under the sliders: "a 50 m stream
 * rises +1.1 m, a 2 km river +7 m". A multiple of mean flow means nothing to
 * most readers; what it does to a river they can picture is the point.
 */

import { floodState, dischargeState, dischargeMean, rebuildSheet, sheetLayer }
  from "./dem-layer.js?v=20260912-8103bed";
import { SCENARIOS, DEFAULTS, stageRise, meanFlowFromWidth, flowRatio }
  from "./inundation.js?v=20260912-8103bed";

const byId = (id) => document.getElementById(id);
const say = (message) => { const n = byId("flood-status"); if (n) n.textContent = message || ""; };

/** River flow is a log slider, 1 to 50 times the mean: a doubling is one step wherever you are. */
const FLOW_MAX = 50;
const flowFromSlider = (v) => FLOW_MAX ** (Number(v) / 1000);
const sliderFromFlow = (q) => Math.round((Math.log(Math.max(1, q)) / Math.log(FLOW_MAX)) * 1000);

/** The widest river that floods, 30 m to 10 km on a log slider; the right end is every river. */
const CAP_MIN = 30;
const CAP_MAX = 10000;
const capFromSlider = (v) => (Number(v) >= 100 ? Infinity
  : Math.round(CAP_MIN * ((CAP_MAX / CAP_MIN) ** (Number(v) / 100))));
const sliderFromCap = (w) => (!Number.isFinite(w) ? 100
  : Math.round((Math.log(w / CAP_MIN) / Math.log(CAP_MAX / CAP_MIN)) * 100));

const fmtFlow = (q) => `× ${q < 10 ? q.toFixed(1) : Math.round(q)} mean`;
const signed = (m) => `${m >= 0 ? "+" : "−"}${Math.abs(m).toFixed(1)} m`;

let timer = null;

/** Which scenario, if any, the sliders still describe. */
function matchingScenario(p) {
  return SCENARIOS.find((s) => Math.abs(s.flow - p.flow) < 0.05 * s.flow
    && (s.widthCap ?? Infinity) === p.widthCap
    && Math.abs(p.exponent - DEFAULTS.exponent) < 1e-6 && p.extra === 0) || null;
}

function render() {
  const p = floodState.params;
  const set = (id, value) => { const n = byId(id); if (n && document.activeElement !== n) n.value = String(value); };
  const text = (id, value) => { const n = byId(id); if (n) n.textContent = value; };
  set("flood-flow", sliderFromFlow(p.flow));
  text("flood-flow-value", fmtFlow(p.flow));
  set("flood-extra", p.extra);
  text("flood-extra-value", signed(p.extra));
  set("flood-reach", p.reach);
  text("flood-reach-value", `${p.reach} channel widths`);
  set("flood-cap", sliderFromCap(p.widthCap));
  text("flood-cap-value", Number.isFinite(p.widthCap) ? `up to ${p.widthCap.toLocaleString()} m wide` : "every river");
  set("flood-exponent", p.exponent);
  text("flood-exponent-value", p.exponent.toFixed(2));
  const box = byId("flood-connected");
  if (box) box.checked = p.connected !== false;
  const held = byId("flood-defended");
  if (held) held.checked = p.defended !== false;
  const match = matchingScenario(p);
  p.scenario = match?.id || "custom";
  // The chosen flood is the one FILLED: the app's own primary against its
  // quiet secondary, since every plain button here is already filled.
  byId("flood-scenarios")?.querySelectorAll("[data-flood-scenario]").forEach((b) => {
    const on = b.dataset.floodScenario === p.scenario;
    b.classList.toggle("is-active", on);
    b.classList.toggle("secondary", !on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  // What the flood does, in metres, to rivers a reader can picture.
  const rivers = [[50, "a 50 m stream"], [300, "a 300 m river"], [2000, "a 2 km river"]];
  const parts = rivers.map(([w, name]) => {
    const rise = stageRise(w, p);
    return `${name} ${rise > 0.05 ? `rises ${signed(rise)}` : "stays in its channel"}`;
  });
  text("flood-rise-readout", `${match ? match.label : "This flood"}: ${parts.join(", ")}.`);
}

function change(patch) {
  Object.assign(floodState.params, patch);
  render();
  clearTimeout(timer);
  if (!sheetLayer("inundation")) return;
  say("Redrawing the flood…");
  timer = setTimeout(() => { void rebuildSheet("inundation", say); }, 350);
}

function init() {
  const host = byId("flood-scenarios");
  if (!host || !byId("flood-flow")) return;
  host.textContent = "";
  for (const s of SCENARIOS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button secondary";
    b.dataset.floodScenario = s.id;
    b.textContent = s.label;
    b.title = s.title;
    host.appendChild(b);
  }
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-flood-scenario]");
    const s = SCENARIOS.find((x) => x.id === b?.dataset.floodScenario);
    if (s) change({ flow: s.flow, widthCap: s.widthCap ?? Infinity, extra: 0, exponent: DEFAULTS.exponent });
  });
  byId("flood-flow").addEventListener("input", (e) => change({ flow: flowFromSlider(e.target.value) }));
  byId("flood-extra").addEventListener("input", (e) => change({ extra: Number(e.target.value) }));
  byId("flood-reach").addEventListener("input", (e) => change({ reach: Number(e.target.value) }));
  byId("flood-cap").addEventListener("input", (e) => change({ widthCap: capFromSlider(e.target.value) }));
  byId("flood-exponent").addEventListener("input", (e) => change({ exponent: Number(e.target.value) }));
  byId("flood-connected")?.addEventListener("change", (e) => change({ connected: e.target.checked }));
  byId("flood-defended")?.addEventListener("change", (e) => change({ defended: e.target.checked }));
  render();
}

/* ── the same flood, set by discharge ────────────────────────────────────── */

/**
 * ONE RIVER AT A FLOW IN m³/s. The slider runs from half the river's mean to a
 * hundred times it on a log scale; the number box takes any figure. Both are
 * the one `dischargeState.discharge`, and the mean it is read against is the
 * typed gauge figure if there is one, else the estimate from the river's width
 * — said beside it, so an estimate is never read as a gauge.
 */
const RATIO_MIN = 0.5;
const RATIO_MAX = 100;
const ratioFromSlider = (v) => RATIO_MIN * ((RATIO_MAX / RATIO_MIN) ** (Number(v) / 1000));
const sliderFromRatio = (r) => Math.round((Math.log(Math.max(RATIO_MIN, Math.min(RATIO_MAX, r))
  / RATIO_MIN) / Math.log(RATIO_MAX / RATIO_MIN)) * 1000);
const flowText = (q) => (q >= 100 ? Math.round(q).toLocaleString()
  : q >= 10 ? q.toFixed(0) : q.toFixed(1));

let dischargeTimer = null;
let picking = false;

function renderDischarge() {
  const st = dischargeState;
  const text = (id, value) => { const n = byId(id); if (n) n.textContent = value; };
  const mean = dischargeMean();
  if (!Number.isFinite(st.width) || !Number.isFinite(mean)) {
    text("discharge-river", "No river chosen yet: the one nearest the view's centre is "
      + "taken when the layer is drawn, or pick one on the map.");
    text("discharge-readout", "");
    return;
  }
  const estimate = meanFlowFromWidth(st.width);
  text("discharge-river", `River ${Math.round(st.width)} m wide at mean flow (the median of `
    + `its channel in view). Mean flow ${flowText(mean)} m³/s — `
    + (Number.isFinite(st.meanTyped) && st.meanTyped > 0 ? "as typed."
      : "estimated from its width, an order of magnitude; type a gauged mean for a better answer."));
  const box = byId("discharge-mean");
  if (box && document.activeElement !== box) {
    box.value = Number.isFinite(st.meanTyped) && st.meanTyped > 0 ? String(st.meanTyped) : "";
    box.placeholder = `≈ ${flowText(estimate)}`;
  }
  const q = Number.isFinite(st.discharge) ? st.discharge : 5 * mean;
  const r = flowRatio(q, mean);
  const set = (id, value) => { const n = byId(id); if (n && document.activeElement !== n) n.value = String(value); };
  set("discharge-flow", sliderFromRatio(r));
  set("discharge-box", Math.round(q));
  text("discharge-flow-value", `${flowText(q)} m³/s · ${r.toFixed(1)}× its mean`);
  set("discharge-reach", st.params.reach);
  text("discharge-reach-value", `${st.params.reach} channel widths`);
  const held = byId("discharge-defended");
  if (held) held.checked = st.params.defended !== false;
  const rise = stageRise(st.width, { ...st.params, flow: r });
  text("discharge-readout", r <= 1
    ? `At ${flowText(q)} m³/s the river is at or below its mean and stays in its channel.`
    : `At ${flowText(q)} m³/s it rises ${rise >= 0 ? "+" : "−"}${Math.abs(rise).toFixed(1)} m `
      + `where it is ${Math.round(st.width)} m wide, more where it narrows.`);
}

function sayDischarge(message) {
  const n = byId("discharge-readout");
  renderDischarge();
  if (n && message && !/^At /.test(n.textContent)) n.textContent = message;
  const status = byId("flood-status");
  if (status && message) status.textContent = message;
}

function changeDischarge(patch, paramsPatch = null) {
  Object.assign(dischargeState, patch);
  if (paramsPatch) Object.assign(dischargeState.params, paramsPatch);
  renderDischarge();
  clearTimeout(dischargeTimer);
  if (!sheetLayer("discharge")) return;
  const status = byId("flood-status");
  if (status) status.textContent = "Redrawing the river's flood…";
  dischargeTimer = setTimeout(() => { void rebuildSheet("discharge", sayDischarge); }, 350);
}

/**
 * The next click on the globe picks the river. A pointerup rather than a
 * click, so the popup's own click can be told to stand down in time; never a
 * stopPropagation on the pointer events, which the orbit controls need to see
 * a press end.
 */
function armPick(button) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas) return;
  if (picking) { picking = false; button.classList.remove("is-on"); button.classList.add("secondary"); return; }
  picking = true;
  button.classList.add("is-on");
  button.classList.remove("secondary");
  const was = button.textContent;
  button.textContent = "Click a river on the map…";
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const finish = () => {
    picking = false;
    button.textContent = was;
    button.classList.remove("is-on");
    button.classList.add("secondary");
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    document.removeEventListener("keydown", onKey, true);
  };
  const onUp = (e) => {
    if (!picking || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(e.clientX, e.clientY);
    if (!at) return;
    window.GeoIDFeaturePopup?.suppress?.(800);
    finish();
    changeDischarge({ pick: { lat: at.lat, lon: at.lon }, width: null, riverKey: null,
      meanTyped: null, discharge: null, selection: null });
  };
  const onKey = (e) => { if (e.key === "Escape") finish(); };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  document.addEventListener("keydown", onKey, true);
}

function initDischarge() {
  if (!byId("discharge-flow")) return;
  byId("discharge-flow").addEventListener("input", (e) => {
    const mean = dischargeMean();
    if (Number.isFinite(mean)) changeDischarge({ discharge: mean * ratioFromSlider(e.target.value) });
  });
  const box = byId("discharge-box");
  box?.addEventListener("keydown", (e) => e.stopPropagation());
  box?.addEventListener("change", () => {
    const q = Number(box.value);
    if (q > 0) changeDischarge({ discharge: q });
  });
  const mean = byId("discharge-mean");
  mean?.addEventListener("keydown", (e) => e.stopPropagation());
  mean?.addEventListener("change", () => {
    const v = Number(mean.value);
    // Blank is "use the estimate"; the discharge in m³/s stays as it was, so
    // what changes is how big a flood that water is for this river.
    changeDischarge({ meanTyped: mean.value.trim() && v > 0 ? v : null });
  });
  byId("discharge-reach")?.addEventListener("input", (e) => changeDischarge({}, { reach: Number(e.target.value) }));
  byId("discharge-defended")?.addEventListener("change", (e) => changeDischarge({}, { defended: e.target.checked }));
  const pick = byId("discharge-pick");
  pick?.addEventListener("click", () => armPick(pick));
  // A rebuild on view settle carries no status callback, and the first build
  // is what finds the river — so the drawer follows the sheet's own
  // announcement rather than the press that started it.
  document.addEventListener("geoid-gis:sheet-built", (e) => {
    if (e.detail?.kind !== "discharge") return;
    renderDischarge();
    const status = byId("flood-status");
    if (status && e.detail.message) status.textContent = e.detail.message;
  });
  renderDischarge();
}

function initAll() {
  init();
  initDischarge();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAll);
} else {
  initAll();
}
