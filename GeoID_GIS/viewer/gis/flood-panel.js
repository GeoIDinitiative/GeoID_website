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

import { floodState, rebuildSheet, sheetLayer } from "./dem-layer.js?v=20260911-231e03f";
import { SCENARIOS, DEFAULTS, stageRise } from "./inundation.js?v=20260911-231e03f";

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
