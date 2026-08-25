/**
 * The batch panel: a recipe, a list of layers, one press.
 *
 * The recipe is written as text — one tool per line with `name=value`
 * parameters — because that is the form that can be pasted into a method
 * section, kept in a project, and diffed. A graph editor would look more like
 * a product and would not survive being written down.
 */

import { parseChain, runBatch, cancelBatch } from "./batch.js?v=20260825-db3d262";

const state = { runner: null };

function byId(id) { return document.getElementById(id); }

async function runner() {
  if (!state.runner) {
    const stamp = new URL(import.meta.url).search;
    state.runner = await import(`./tool-runner.js${stamp}`);
  }
  return state.runner;
}

function fillLayers() {
  const host = byId("gis-batch-layers");
  if (!host) return;
  const held = new Set([...host.querySelectorAll("input:checked")].map((i) => i.value));
  host.innerHTML = "";
  const layers = (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.status === "loaded" && (l.raster || l.collection));
  if (!layers.length) {
    host.innerHTML = '<div class="gis-metric">No layers loaded.</div>';
    return;
  }
  layers.forEach((layer) => {
    const id = String(layer.id ?? layer.name);
    const row = document.createElement("label");
    row.className = "gis-batch-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = id;
    box.checked = held.has(id);
    const text = document.createElement("span");
    text.textContent = layer.name;
    row.append(box, text);
    host.appendChild(row);
  });
}

function renderRows(rows) {
  const host = byId("gis-batch-results");
  if (!host) return;
  host.innerHTML = "";
  const table = document.createElement("table");
  table.className = "gis-point-table";
  table.innerHTML = "<tr><th>Layer</th><th>Step</th><th></th><th>Result</th></tr>";
  rows.forEach((row) => {
    const tr = table.insertRow();
    tr.insertCell().textContent = row.layer;
    tr.insertCell().textContent = row.step;
    tr.insertCell().textContent = row.ok ? "✓" : "✗";
    tr.insertCell().textContent = row.output || row.note || "";
  });
  host.appendChild(table);
}

async function run() {
  const engine = await runner();
  const chain = parseChain(byId("gis-batch-chain")?.value || "", engine.toolById);
  const status = byId("gis-batch-status");
  if (chain.errors.length) {
    status.textContent = `${chain.errors.length} problem(s): ${chain.errors[0]}`;
    if (!chain.steps.length) return;
  }
  const chosen = new Set([...document.querySelectorAll("#gis-batch-layers input:checked")]
    .map((i) => i.value));
  const layers = (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => chosen.has(String(l.id ?? l.name)));
  if (!layers.length) { status.textContent = "Tick at least one layer."; return; }

  byId("gis-batch-run").disabled = true;
  byId("gis-batch-stop").disabled = false;
  const out = await runBatch({
    layers, steps: chain.steps, runner: engine,
    onProgress: (done, total, what) => { status.textContent = `${done}/${total} — ${what}`; },
  });
  byId("gis-batch-run").disabled = false;
  byId("gis-batch-stop").disabled = true;
  status.textContent = out.ok ? out.message : out.message;
  if (out.rows) renderRows(out.rows);
}

export function init() {
  if (!byId("gis-batch-chain")) return;
  fillLayers();
  window.GeoIDImportManager?.onChange?.(fillLayers);
  byId("gis-batch-run")?.addEventListener("click", () => { void run(); });
  byId("gis-batch-stop")?.addEventListener("click", () => {
    cancelBatch();
    byId("gis-batch-status").textContent = "Stopping after the current step…";
  });
}

if (typeof window !== "undefined") {
  window.GeoIDBatchPanel = { init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
