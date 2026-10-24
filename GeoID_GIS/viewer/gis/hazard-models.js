/**
 * The Analysis Hub's Models tab: every hazard map GeoHUB publishes, its model
 * parameters, and how well it predicts events it was not built from.
 *
 * A susceptibility map with no validation beside it is a confident picture.
 * The numbers here are made offline by the bakes (services/bake-flood-rf.py,
 * validate-landslide.py, validate-point-hazards.py, all through
 * hazard_metrics.py, which hazard-metrics.test.mjs holds equal to
 * validation.js) and published as one small file,
 * /data/global/hazard-validation.json. This module only READS it: no metric
 * is computed in the page, so what the hub shows is what the bake wrote.
 *
 * Each card says three things in one place, because each is meaningless
 * without the others:
 *   - the model and its parameters (what was run),
 *   - the hold-out (what it was scored against, and why that is fair),
 *   - the confusion matrix and its threshold, with accuracy, precision,
 *     recall, F1, kappa and AUC (how it did).
 * A map that could not be scored says NOT ASSESSABLE rather than showing a
 * number from too few events.
 */

export const SOURCE = "/data/global/hazard-validation.json";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

/** A rate as it is read: two decimals, a dash for "undefined", never "NaN". */
export function formatMetric(v) {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
}

/** How a parameter value is written in a card: short, and never "[object Object]". */
export function formatParam(v) {
  if (v == null) return "—";
  if (Array.isArray(v)) {
    if (v.every((x) => Array.isArray(x) && x.length === 2)) return v.map(([k, n]) => `${k} ${n}`).join(", ");
    return v.map(formatParam).join(", ");
  }
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${formatParam(x)}`).join("; ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
  return String(v);
}

/** The headline verdict for a card, from AUC alone (it does not depend on a threshold). */
export function skillWord(auc) {
  if (!Number.isFinite(auc)) return "not assessable";
  if (auc >= 0.9) return "excellent";
  if (auc >= 0.8) return "good";
  if (auc >= 0.7) return "fair";
  if (auc > 0.5) return "weak";
  return "no skill";
}

function confusionTable(v) {
  return `<table class="hm-cm" aria-label="Confusion matrix">
      <thead><tr><th></th><th>event happened</th><th>no event</th></tr></thead>
      <tbody>
        <tr><th>predicted</th><td class="hm-tp">${esc(v.tp)}<small>TP</small></td><td class="hm-fp">${esc(v.fp)}<small>FP</small></td></tr>
        <tr><th>not predicted</th><td class="hm-fn">${esc(v.fn)}<small>FN</small></td><td class="hm-tn">${esc(v.tn)}<small>TN</small></td></tr>
      </tbody>
    </table>`;
}

/**
 * A model validated by leaving each REGION out carries one row per region: the
 * skill where the forest never saw the ground, which is the number that says
 * whether "global" is earned. A region too thin to score says so in its row.
 */
export function regionTable(regions, unit = "products") {
  const rows = Object.entries(regions || {});
  if (!rows.length) return "";
  const cell = (v) => `<td>${formatMetric(v)}</td>`;
  return `<table class="hm-regions" aria-label="Validation by held-out region">
      <thead><tr><th>held-out region</th><th>AUC</th><th>acc</th><th>prec</th><th>rec</th><th>F1</th><th>${esc(unit)}</th></tr></thead>
      <tbody>${rows.map(([name, r]) => (r.assessable === false
    ? `<tr class="hm-na"><th>${esc(name.replace(/-/g, " "))}</th><td colspan="5">not assessable — ${esc(r.message || "")}</td><td>${esc(r.events ?? "")}</td></tr>`
    : `<tr data-skill="${esc(skillWord(r.auc).replace(/ /g, "-"))}"><th>${esc(name.replace(/-/g, " "))}</th>${cell(r.auc)}${cell(r.accuracy)}${cell(r.precision)}${cell(r.recall)}${cell(r.f1)}<td>${esc(r.events ?? "")}</td></tr>`)).join("")}</tbody>
    </table>`;
}

const METRICS = [
  ["auc", "AUC"], ["accuracy", "Accuracy"], ["precision", "Precision"],
  ["recall", "Recall"], ["f1", "F1"], ["kappa", "Kappa"],
];

/** One map's card. Pure: an entry in, an HTML string out. */
export function renderCard(entry) {
  const v = entry.validation || {};
  const m = entry.model || {};
  const assessable = v.assessable !== false && Number.isFinite(v.auc);
  const params = Object.entries(m.parameters || {});
  const inputs = (m.inputs || []).map((i) => `<li><b>${esc(i.name)}</b> — ${esc(i.source || i.citation || "")}${i.detail ? ` <span class="hm-dim">(${esc(i.detail)})</span>` : ""}${i.licence ? `<br><span class="hm-licence">Licence: ${esc(i.licence)}</span>` : ""}</li>`).join("");
  const fills = Object.entries(m.gap_fills || {}).map(([k, f]) => `<li><b>${esc(k)}</b>: ${esc(f.method)}${Number.isFinite(f.cells) ? `, ${f.cells.toLocaleString("en-GB")} cells` : ""}${f.why ? ` <span class="hm-dim">— ${esc(f.why)}</span>` : ""}</li>`).join("");
  const metrics = METRICS.map(([k, label]) => `<div class="hm-metric"><span>${label}</span><b>${formatMetric(v[k])}</b></div>`).join("");
  return `<article class="hm-card" data-model-id="${esc(entry.id)}">
    <header class="hm-head">
      <h3>${esc(entry.name)}</h3>
      <span class="hm-skill" data-skill="${esc(skillWord(v.auc).replace(/ /g, "-"))}">${assessable ? `AUC ${formatMetric(v.auc)} · ${skillWord(v.auc)}` : "NOT ASSESSABLE"}</span>
    </header>
    ${entry.membership ? `<p class="hm-membership">${esc(entry.membership)}</p>` : ""}
    <p class="hm-method">${esc(m.method)}</p>
    <div class="hm-cols">
      <section class="hm-validation">
        <h4>Validation</h4>
        <p class="hm-holdout">${esc(v.holdout || v.message || "")}</p>
        ${assessable ? `<div class="hm-metrics">${metrics}</div>
        ${confusionTable(v)}
        ${regionTable(v.regions, v.region_unit)}
        ${v.extra?.mid_north_wales_holdout ? `<p class="hm-compare">On the ground Recipe A failed on (Mid/North Wales, held out):
          AUC <b>${formatMetric(v.extra.mid_north_wales_holdout.auc)}</b>, F1 ${formatMetric(v.extra.mid_north_wales_holdout.f1)}
          — Recipe A scored 0.534 there. <span class="hm-dim">${esc(v.extra.mid_north_wales_holdout.compare || "")}</span></p>` : ""}
        ${v.auc_rule ? `<p class="hm-dim">Headline AUC: ${esc(v.auc_rule)} = ${formatMetric(v.auc_pooled)}.</p>` : ""}
        <p class="hm-dim">n = ${esc((v.n ?? 0).toLocaleString("en-GB"))} (${esc((v.positives ?? v.tp + v.fn).toLocaleString("en-GB"))} positive). Threshold: ${esc(v.threshold_rule || formatParam(v.threshold))}.</p>` : ""}
        <p class="hm-dim">${esc(v.events || "")}</p>
      </section>
      <section class="hm-params">
        <h4>Model parameters</h4>
        <dl>${params.map(([k, x]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(formatParam(x))}</dd>`).join("")}</dl>
        ${m.grid ? `<p class="hm-dim">Grid: ${esc(m.grid)}</p>` : ""}
      </section>
    </div>
    ${inputs ? `<details><summary>Inputs</summary><ul>${inputs}</ul></details>` : ""}
    ${fills ? `<details><summary>Gaps filled (no NaNs)</summary><ul>${fills}</ul></details>` : ""}
    ${(entry.limits || []).length ? `<details><summary>Limits</summary><ul>${entry.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
    <p class="hm-foot">${esc(entry.script || "")}${entry.generated ? ` · ${esc(entry.generated.slice(0, 10))}` : ""}</p>
  </article>`;
}

/**
 * Every input's licence, once each, for the hub's Metadata panel: what the
 * published models were built from and on what terms. A licence that does not
 * permit the use a member pays for is a fault in the product, so it is listed
 * where a reader looks for provenance, not only inside each model's card.
 */
export function licenceRows(data) {
  const seen = new Map();
  for (const map of data?.maps || []) {
    for (const input of map.model?.inputs || []) {
      const source = input.source || input.citation || input.name;
      const licence = input.licence || "";
      const key = `${source}|${licence}`;
      if (!seen.has(key)) seen.set(key, { source, licence, maps: new Set() });
      seen.get(key).maps.add(map.name);
    }
  }
  return [...seen.values()].map((r) => ({ ...r, maps: [...r.maps] }));
}

export function renderLicences(data) {
  const rows = licenceRows(data);
  if (!rows.length) return "";
  return `<section class="hm-licences"><h3>Model data and licences</h3><table>
      <thead><tr><th>source</th><th>licence</th><th>used by</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.source)}</td><td>${esc(r.licence || "stated in the source's citation")}</td><td>${esc(r.maps.join("; "))}</td></tr>`).join("")}</tbody>
    </table></section>`;
}

export function renderModels(data) {
  const maps = data?.maps || [];
  if (!maps.length) return `<p class="hm-dim">No validated models published yet.</p>`;
  return `<p class="hm-intro">Each hazard map GeoHUB publishes, scored against historical events it was not built from.
    AUC says how well the map ranks places (0.5 is a coin toss); the confusion matrix and the rates below it are
    at the stated threshold.</p>${maps.map(renderCard).join("")}`;
}

const CSS = `
.hm-intro { margin: 0 0 0.7rem; font-size: 0.82rem; color: rgba(255,255,255,0.62); max-width: 70rem; }
.hm-card { border: 1px solid rgba(255,255,255,0.08); border-radius: 0.55rem; background: rgba(255,255,255,0.025);
  padding: 0.7rem 0.85rem; margin-bottom: 0.7rem; }
.hm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
.hm-head h3 { margin: 0; font-size: 0.95rem; }
.hm-skill { font-size: 0.72rem; font-weight: 600; padding: 0.12rem 0.5rem; border-radius: 999px;
  background: rgba(255,255,255,0.07); }
.hm-skill[data-skill="excellent"], .hm-skill[data-skill="good"] { background: rgba(61,143,78,0.28); }
.hm-skill[data-skill="fair"] { background: rgba(253,174,97,0.25); }
.hm-skill[data-skill="weak"], .hm-skill[data-skill="no-skill"], .hm-skill[data-skill="not-assessable"] { background: rgba(215,25,28,0.25); }
.hm-method { margin: 0.35rem 0 0.5rem; font-size: 0.8rem; color: rgba(255,255,255,0.7); }
.hm-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.9rem; }
@media (max-width: 760px) { .hm-cols { grid-template-columns: 1fr; } }
.hm-card h4 { margin: 0 0 0.3rem; font-size: 0.68rem; letter-spacing: 0.07em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); }
.hm-holdout { margin: 0 0 0.45rem; font-size: 0.78rem; }
.hm-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.3rem; margin-bottom: 0.45rem; }
@media (max-width: 520px) { .hm-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.hm-metric { background: rgba(255,255,255,0.04); border-radius: 0.35rem; padding: 0.3rem 0.4rem; }
.hm-metric span { display: block; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255,255,255,0.45); }
.hm-metric b { font-size: 0.86rem; font-variant-numeric: tabular-nums; }
.hm-cm { border-collapse: collapse; font-size: 0.76rem; margin-bottom: 0.35rem; }
.hm-cm th, .hm-cm td { padding: 0.22rem 0.55rem; border: 1px solid rgba(255,255,255,0.08); text-align: right; }
.hm-cm thead th { font-weight: 500; color: rgba(255,255,255,0.5); }
.hm-cm tbody th { text-align: left; font-weight: 500; color: rgba(255,255,255,0.5); }
.hm-cm td { font-variant-numeric: tabular-nums; }
.hm-cm small { margin-left: 0.3rem; font-size: 0.6rem; color: rgba(255,255,255,0.4); }
.hm-regions { border-collapse: collapse; font-size: 0.72rem; margin: 0.2rem 0 0.4rem; width: 100%; }
.hm-regions th, .hm-regions td { padding: 0.18rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.06); text-align: right; font-variant-numeric: tabular-nums; }
.hm-regions th:first-child { text-align: left; font-weight: 500; text-transform: capitalize; }
.hm-regions thead th { color: rgba(255,255,255,0.5); font-weight: 500; }
.hm-regions tr[data-skill="weak"] td:nth-child(2), .hm-regions tr[data-skill="no-skill"] td:nth-child(2) { color: #ff8a80; }
.hm-regions tr.hm-na td { text-align: left; color: rgba(255,255,255,0.45); }
.hm-tp, .hm-tn { background: rgba(61,143,78,0.16); }
.hm-fp, .hm-fn { background: rgba(215,25,28,0.12); }
.hm-params dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.15rem 0.6rem;
  margin: 0; font-size: 0.75rem; }
.hm-params dt { color: rgba(255,255,255,0.5); }
.hm-params dd { margin: 0; overflow-wrap: anywhere; }
.hm-card details { margin-top: 0.4rem; font-size: 0.76rem; }
.hm-card summary { cursor: pointer; color: rgba(255,255,255,0.6); }
.hm-card ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
.hm-membership { display: inline-block; margin: 0.35rem 0 0; padding: 0.1rem 0.5rem; border-radius: 999px;
  font-size: 0.7rem; background: rgba(253,174,97,0.18); color: #fdae61; }
.hm-compare { font-size: 0.76rem; margin: 0.2rem 0 0.4rem; }
.hm-licence { font-size: 0.68rem; color: rgba(255,255,255,0.5); }
.hm-licences { margin-top: 0.8rem; }
.hm-licences h3 { margin: 0 0 0.35rem; font-size: 0.8rem; }
.hm-licences table { border-collapse: collapse; width: 100%; font-size: 0.72rem; }
.hm-licences th, .hm-licences td { text-align: left; padding: 0.22rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
.hm-licences th { color: rgba(255,255,255,0.5); font-weight: 500; }
.hm-dim { color: rgba(255,255,255,0.5); font-size: 0.74rem; margin: 0.2rem 0; }
.hm-foot { margin: 0.45rem 0 0; font-size: 0.66rem; color: rgba(255,255,255,0.35); }
:root[data-theme="light"] .hm-card { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.1); }
`;

async function mount() {
  const body = document.getElementById("models-body");
  if (!body) return;
  if (!document.getElementById("hazard-models-css")) {
    const style = document.createElement("style");
    style.id = "hazard-models-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  try {
    const response = await fetch(SOURCE, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    body.innerHTML = renderModels(data);
    const licences = document.getElementById("metadata-licences");
    if (licences) licences.innerHTML = renderLicences(data);
  } catch (error) {
    body.innerHTML = `<p class="hm-dim">Model validation could not be loaded (${esc(error.message)}).</p>`;
  }
  const empty = document.getElementById("models-empty");
  if (empty) empty.hidden = true;
  body.hidden = false;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
}
