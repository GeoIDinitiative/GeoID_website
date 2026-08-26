/**
 * Charts bound to map layers.
 *
 * A histogram of a field, a scatter of two, a box plot per category — drawn
 * from the SAME layer records the toolbox operates on
 * (window.GeoIDImportManager.getLayers()), never from a copy. That is the
 * whole point of it being here rather than in the Research Hub's plotter: a
 * chart of a layer and the layer on the globe are the same object, so brushing
 * one selects the other.
 *
 * ── The three seams it reaches for, and what happens without each ─────────
 *
 *   window.GeoIDImportManager  required. No layers, no chart.
 *   window.GeoIDSelection      optional. Present, a brush sets the map
 *                              selection and a selection made elsewhere
 *                              re-tints the marks. Absent, the brush still
 *                              highlights inside the chart and the status line
 *                              says the selection store is not loaded — the
 *                              chart is never silently inert.
 *   window.GeoIDTime           optional. Its filter narrows the charted rows
 *                              to the visible time window, which is what makes
 *                              the time pill visible in this build at all
 *                              (see time.js: the globe renderer has no
 *                              per-feature handle yet).
 *
 * The selection store is reached through a TOLERANT adapter — set/setSelection/
 * select for writing, get/getSelection for reading, onChange/subscribe/on for
 * listening. selection.js ships the first name of each, so the aliases are
 * dead weight in this build and are kept only because they cost nothing and
 * this module was written before that store landed. `SELECTION_CONTRACT`
 * records the shape actually used. Feature INDICES are the currency, because
 * that is what a FeatureCollection has and what applyTimeFilter already
 * returns.
 *
 * The panel lives in a fixed fallback container: side-panels.js exposes only
 * open/close/isOpen, with no registerPanel, so there is no workbench panel to
 * join. tool-dialog.js's .gis-tool-dialog-fallback is the pattern, copied
 * rather than shared because the two panels must be able to be open at once.
 *
 * Seam: window.GeoIDCharts = { open, close, refresh, getState }
 */

import {
  binData, boxStats, chartColors, drawBox, drawHistogram, drawScatter,
  formatNumber, plotRect, prepareCanvas, toNumber,
} from "./chart-core.js?v=20260826-92d555e";

/**
 * What this module calls on window.GeoIDSelection. selection.js ships exactly
 * these under their first names; the aliases are the tolerance that let this
 * module be written before that store existed, and they cost nothing to keep.
 *
 * The one thing a consumer MUST get right is the key: the store holds a Map
 * keyed by the id it is handed, so the string "3" out of a <select>.value and
 * the number 3 off a layer record are two different layers with two different
 * selections. Everything below goes through selectionKey(), which resolves the
 * select's string back to the layer record's own id.
 */
export const SELECTION_CONTRACT = {
  write: "set(layerId, indices) — also tried as setSelection / select / replace",
  read: "get(layerId) -> Set|number[] — also tried as getSelection / selected",
  listen: "onChange(fn) -> unsubscribe; called as fn({layerId}), layerId null = all",
  clear: "written as set(layerId, []) rather than clear(), so one path covers both",
  key: "the layer record's own id, never a stringified copy of it",
};

/* ── Panel styles. NEVER a backtick inside this literal: it ends the string
      and kills the module silently (module-css.test.mjs pins this). ─────── */
const STYLE = `
.gis-charts-panel {
  position: fixed;
  top: 72px;
  right: 60px;
  width: 340px;
  max-width: calc(100vw - 90px);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 30;
  box-sizing: border-box;
  background: rgba(10, 2, 14, 0.92);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.34);
  border-radius: 10px;
  color: var(--text);
}
.gis-charts-panel[hidden] { display: none; }

.gis-charts-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.75rem;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.2);
}
.gis-charts-title {
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
.gis-charts-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 2px 4px;
  color: inherit;
  opacity: 0.6;
}
.gis-charts-close:hover { opacity: 1; }

.gis-charts-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem 0.55rem 0.85rem;
  display: grid;
  gap: 0.5rem;
}

/* .row sets display:grid, which OUTRANKS the UA stylesheet's [hidden] rule —
   the same trap the Research Hub hit. Without this, hiding the Y-field row
   leaves it on the page. */
.gis-charts-body .row[hidden] { display: none; }

.gis-charts-figure {
  border: 1px solid rgba(var(--nav-accent-rgb), 0.16);
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.02);
  padding: 0.3rem;
  overflow: hidden;
}
.gis-charts-figure canvas {
  display: block;
  width: 100%;
  cursor: crosshair;
  touch-action: none;
}
.gis-charts-hint {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1.4;
  opacity: 0.62;
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisCharts = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── Selection adapter ──────────────────────────────────────────────────── */

function store() {
  return typeof window !== "undefined" ? window.GeoIDSelection : null;
}

function pick(target, names) {
  if (!target) return null;
  for (const name of names) {
    if (typeof target[name] === "function") return target[name].bind(target);
  }
  return null;
}

/**
 * The store returns false from `set` when the members did not change, which is
 * not a refusal — re-running the same brush must not make every subscriber
 * redraw. So the return here means "the call went through", and only a throw
 * counts as a failure.
 */
function writeSelection(layerId, indices) {
  const fn = pick(store(), ["set", "setSelection", "select", "replace"]);
  if (!fn) return false;
  try {
    fn(layerId, indices);
    return true;
  } catch (error) {
    console.warn("[GeoID GIS] charts could not write the selection:", error.message);
    return false;
  }
}

function readSelection(layerId) {
  const fn = pick(store(), ["get", "getSelection", "selected"]);
  if (!fn) return null;
  try {
    const raw = fn(layerId);
    if (!raw) return null;
    if (raw instanceof Set) return raw;
    if (Array.isArray(raw)) return new Set(raw);
    if (Array.isArray(raw.indices)) return new Set(raw.indices);
    return null;
  } catch {
    return null;
  }
}

function listenSelection(fn) {
  const on = pick(store(), ["onChange", "subscribe", "on"]);
  if (!on) return false;
  try {
    on(fn);
    return true;
  } catch {
    return false;
  }
}

/* ── Layer plumbing ─────────────────────────────────────────────────────── */

const FIELD_SAMPLE = 500;      // features read to decide whether a field is numeric
const RASTER_CELL_LIMIT = 100000;

function allLayers() {
  return window.GeoIDImportManager?.getLayers?.() || [];
}

function chartableLayers() {
  return allLayers().filter((l) => l.status !== "failed"
    && (l.collection?.features?.length || l.features?.length || l.raster?.band));
}

function layerById(id) {
  return chartableLayers().find((l) => String(l.id) === String(id)) || null;
}

/**
 * The id to hand the selection store: the layer record's OWN id.
 *
 * state.layerId arrives from a <select>.value, which is always a string, while
 * every other surface passes layer.id — a number. The store keys a Map by
 * whatever it is given, so writing under "3" and reading under 3 gives two
 * selections that never see each other, and the symptom is a chart and an
 * attribute table that disagree with no error anywhere.
 */
function selectionKey() {
  const layer = layerById(state.layerId);
  return layer ? layer.id : state.layerId;
}

function featuresOf(layer) {
  return layer?.collection?.features || layer?.features || [];
}

/**
 * The layer's fields, split by whether they read as numbers.
 *
 * `info.fields` is the declared list where an adapter provides one; the
 * properties of the first few hundred features fill in where it does not (a
 * derived layer from the geoprocessing tools often has no info block).
 */
function fieldsOf(layer) {
  const features = featuresOf(layer);
  const declared = Array.isArray(layer?.info?.fields) ? layer.info.fields.slice() : [];
  const names = declared.slice();
  const limit = Math.min(features.length, FIELD_SAMPLE);
  for (let i = 0; i < limit; i += 1) {
    const props = features[i]?.properties;
    if (!props || typeof props !== "object") continue;
    for (const key of Object.keys(props)) {
      if (!names.includes(key)) names.push(key);
    }
  }
  const numeric = [];
  const categorical = [];
  names.forEach((name) => {
    let seen = 0;
    let isNumber = 0;
    for (let i = 0; i < limit; i += 1) {
      const value = features[i]?.properties?.[name];
      if (value === null || value === undefined || value === "") continue;
      seen += 1;
      if (Number.isFinite(toNumber(value))) isNumber += 1;
    }
    if (seen && isNumber / seen >= 0.8) numeric.push(name);
    else categorical.push(name);
  });
  return { names, numeric, categorical };
}

/** Feature values for `field`, index-aligned with the collection. */
function columnOf(layer, field) {
  const features = featuresOf(layer);
  const out = new Array(features.length);
  for (let i = 0; i < features.length; i += 1) {
    out[i] = toNumber(features[i]?.properties?.[field]);
  }
  return out;
}

/**
 * Raster band values, thinned to at most 100k cells.
 *
 * The stride is over the flat array rather than per row, which is the cheap
 * way to avoid sampling one part of the grid: a stride coprime with the row
 * width walks a diagonal across the whole raster instead of a single column.
 * noData and non-finite cells are dropped, not zeroed.
 */
function rasterValues(layer, limit = RASTER_CELL_LIMIT) {
  const raster = layer?.raster;
  const band = raster?.band;
  if (!band || !band.length) return { values: [], total: 0, skipped: 0 };
  const total = band.length;
  let stride = Math.max(1, Math.ceil(total / limit));
  // An even stride over a raster whose width is even samples the same columns
  // forever; nudging it odd costs nothing and breaks the pattern.
  if (stride > 1 && stride % 2 === 0) stride += 1;
  const noData = raster.noData;
  const values = [];
  let skipped = 0;
  for (let i = 0; i < total; i += stride) {
    const v = band[i];
    if (!Number.isFinite(v) || (noData !== null && noData !== undefined && v === noData)) {
      skipped += 1;
      continue;
    }
    values.push(v);
  }
  return { values, total, skipped, stride };
}

/* ── State ──────────────────────────────────────────────────────────────── */

const state = {
  panel: null,
  body: null,
  title: null,
  canvas: null,
  status: null,
  hint: null,
  selects: {},
  rows: {},
  layerId: null,
  kind: "histogram",
  axes: null,
  rect: null,
  data: null,          // {mode, values, xs, ys, indices, groups, bins}
  selected: new Set(), // feature indices
  brush: null,         // {x0,y0,x1,y1} in canvas px while dragging
  brushRange: null,    // [lo, hi] in data units, once a histogram brush lands
  timeMask: null,      // Set of indices allowed by the time filter, or null
  timeLayerId: null,
};

/* ── Panel ──────────────────────────────────────────────────────────────── */

function fillSelect(select, items, { value = (i) => i, label = (i) => i, empty = "None" } = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = empty;
    select.appendChild(option);
    return;
  }
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(value(item));
    option.textContent = String(label(item));
    select.appendChild(option);
  });
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

function row(labelText, control, id) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  control.id = id;
  wrap.append(label, control);
  return wrap;
}

function select(id, onChange) {
  const node = document.createElement("select");
  node.className = "mini-select";
  node.addEventListener("change", onChange);
  return node;
}

function build() {
  injectStyle();
  const panel = document.createElement("section");
  panel.className = "gis-charts-panel";
  panel.id = "gis-charts-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Charts");

  const head = document.createElement("div");
  head.className = "gis-charts-head";
  const title = document.createElement("span");
  title.className = "gis-charts-title";
  title.textContent = "Charts";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-charts-close";
  close.textContent = "✕";
  close.title = "Close";
  close.setAttribute("aria-label", "Close charts");
  close.addEventListener("click", () => closeCharts());
  head.append(title, close);

  const body = document.createElement("div");
  body.className = "gis-charts-body";

  const layerSelect = select("gis-chart-layer", () => {
    state.layerId = layerById(layerSelect.value)?.id ?? layerSelect.value;
    state.selected = new Set();
    syncFields();
    render();
  });
  const kindSelect = select("gis-chart-kind", () => {
    state.kind = kindSelect.value;
    syncFields();
    render();
  });
  [["histogram", "Histogram"], ["scatter", "Scatter"], ["box", "Box plot"]]
    .forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      kindSelect.appendChild(option);
    });

  const xSelect = select("gis-chart-x", render);
  const ySelect = select("gis-chart-y", render);
  const groupSelect = select("gis-chart-group", render);

  const bins = document.createElement("input");
  bins.type = "number";
  bins.className = "input";
  bins.min = "2";
  bins.max = "200";
  bins.step = "1";
  bins.value = "24";
  bins.addEventListener("change", render);

  const rows = {
    layer: row("Layer", layerSelect, "gis-chart-layer"),
    kind: row("Chart", kindSelect, "gis-chart-kind"),
    x: row("Field", xSelect, "gis-chart-x"),
    y: row("Y field", ySelect, "gis-chart-y"),
    group: row("Group by", groupSelect, "gis-chart-group"),
    bins: row("Bins", bins, "gis-chart-bins"),
  };

  const figure = document.createElement("div");
  figure.className = "gis-charts-figure";
  const canvas = document.createElement("canvas");
  figure.appendChild(canvas);

  const status = document.createElement("div");
  status.className = "gis-metric";
  status.id = "gis-chart-status";
  status.setAttribute("aria-live", "polite");

  const hint = document.createElement("p");
  hint.className = "gis-charts-hint";

  const buttons = document.createElement("div");
  buttons.className = "gis-btn-row";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button secondary";
  clear.textContent = "Clear selection";
  clear.addEventListener("click", () => {
    state.selected = new Set();
    state.brush = null;
    writeSelection(selectionKey(), []);
    render();
  });
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "button secondary";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => { syncLayers(); render(); });
  buttons.append(clear, refreshBtn);

  body.append(rows.layer, rows.kind, rows.x, rows.y, rows.group, rows.bins,
    figure, status, hint, buttons);
  panel.append(head, body);
  document.body.appendChild(panel);

  state.panel = panel;
  state.body = body;
  state.title = title;
  state.canvas = canvas;
  state.status = status;
  state.hint = hint;
  state.rows = rows;
  state.selects = { layer: layerSelect, kind: kindSelect, x: xSelect, y: ySelect, group: groupSelect, bins };

  installBrush(canvas);
  window.addEventListener("resize", () => { if (!panel.hidden) scheduleRender(); });
  return panel;
}

/* ── Field synchronisation ──────────────────────────────────────────────── */

function syncLayers() {
  const layers = chartableLayers();
  fillSelect(state.selects.layer, layers, {
    value: (l) => l.id,
    label: (l) => l.name,
    empty: "No layers imported",
  });
  if (state.layerId && layers.some((l) => String(l.id) === String(state.layerId))) {
    state.selects.layer.value = String(state.layerId);
  } else {
    state.layerId = layerById(state.selects.layer.value)?.id ?? null;
  }
  syncFields();
}

function syncFields() {
  const layer = layerById(state.layerId);
  const isRaster = Boolean(layer?.raster?.band) && !featuresOf(layer).length;
  const fields = layer && !isRaster ? fieldsOf(layer) : { numeric: [], categorical: [] };

  // A raster has one column of numbers and no attributes, so only a histogram
  // means anything; saying so beats offering a scatter that cannot be drawn.
  [...state.selects.kind.options].forEach((option) => {
    option.disabled = isRaster && option.value !== "histogram";
  });
  if (isRaster && state.kind !== "histogram") {
    state.kind = "histogram";
    state.selects.kind.value = "histogram";
  }

  fillSelect(state.selects.x, fields.numeric, { empty: isRaster ? "Band values" : "No numeric fields" });
  fillSelect(state.selects.y, fields.numeric, { empty: "No numeric fields" });
  fillSelect(state.selects.group,
    fields.categorical.length ? fields.categorical : fields.numeric,
    { empty: "No fields" });
  if (state.selects.y.options.length > 1 && state.selects.y.value === state.selects.x.value) {
    state.selects.y.selectedIndex = 1;
  }

  state.rows.x.hidden = isRaster;
  state.rows.y.hidden = state.kind !== "scatter";
  state.rows.group.hidden = state.kind !== "box";
  state.rows.bins.hidden = state.kind !== "histogram";

  // The same select means a different thing in each chart, and a caption of
  // "Field" beside a scatter's X axis is the kind of small lie that costs
  // someone a minute every time.
  const caption = state.rows.x.querySelector("label");
  if (caption) {
    caption.textContent = state.kind === "scatter" ? "X field"
      : state.kind === "box" ? "Value field" : "Field";
  }
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

function canvasSize() {
  const width = Math.max(220, (state.body?.clientWidth || 300) - 22);
  return { width, height: Math.round(Math.min(240, Math.max(150, width * 0.62))) };
}

/** Indices the time filter currently allows, or null when it allows all. */
function timeAllows(index) {
  if (!state.timeMask) return true;
  if (String(state.timeLayerId) !== String(state.layerId)) return true;
  return state.timeMask.has(index);
}

/**
 * One redraw per frame at most.
 *
 * A drag fires pointermove far faster than a frame, and each redraw re-reads
 * the whole column — a 100k-feature layer would rebuild its histogram dozens
 * of times between two painted frames. Coalescing onto rAF costs three lines
 * and removes the only place this panel could feel slow.
 */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => { renderQueued = false; render(); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function setStatus(text) {
  if (state.status) state.status.textContent = text;
}

function setHint(text) {
  if (state.hint) state.hint.textContent = text;
}

function render() {
  if (!state.panel || state.panel.hidden) return;
  const layer = layerById(state.layerId);
  const { width, height } = canvasSize();
  const ctx = prepareCanvas(state.canvas, width, height);
  const colors = chartColors(state.panel);
  if (!layer) {
    state.data = null;
    setStatus("Import a layer to chart it.");
    setHint("");
    return;
  }
  state.title.textContent = `Charts · ${layer.name}`;

  if (state.kind === "histogram") renderHistogram(ctx, layer, colors, width, height);
  else if (state.kind === "scatter") renderScatter(ctx, layer, colors, width, height);
  else renderBox(ctx, layer, colors, width, height);

  drawBrushOverlay(ctx);
}

function renderHistogram(ctx, layer, colors, width, height) {
  const isRaster = Boolean(layer.raster?.band) && !featuresOf(layer).length;
  const bins = Math.max(2, Math.min(200, Number(state.selects.bins.value) || 24));
  let values;
  let indices = null;
  let label;
  let note;

  if (isRaster) {
    const sampled = rasterValues(layer);
    values = sampled.values;
    label = "band value";
    note = sampled.stride > 1
      ? `${values.length} of ${sampled.total} cells (every ${sampled.stride}th)`
      : `${values.length} cells`;
    setHint("A raster histogram counts cells, not features, so there is nothing "
      + "to brush a selection onto.");
  } else {
    const field = state.selects.x.value;
    if (!field) { setStatus("This layer has no numeric field to bin."); return; }
    const column = columnOf(layer, field);
    values = [];
    indices = [];
    for (let i = 0; i < column.length; i += 1) {
      if (!Number.isFinite(column[i]) || !timeAllows(i)) continue;
      values.push(column[i]);
      indices.push(i);
    }
    label = field;
    note = `${values.length} of ${column.length} features`;
    setHint("Drag across the bars to select those features on the map.");
  }

  const binned = binData(values, { bins });
  const rect = plotRect(width, height, { xLabel: label });
  const selectedRange = state.brushRange || null;
  const axes = drawHistogram(ctx, rect, binned, {
    colors, xLabel: label, yLabel: "", selectedRange,
  });
  state.axes = axes;
  state.rect = rect;
  state.data = { mode: "histogram", values, indices, binned, field: label };
  const range = selectedRange
    ? ` · brushed ${formatNumber(Math.min(...selectedRange))}–${formatNumber(Math.max(...selectedRange))}`
    : "";
  setStatus(`${note}${range}${selectionNote()}`);
}

function renderScatter(ctx, layer, colors, width, height) {
  const xField = state.selects.x.value;
  const yField = state.selects.y.value;
  if (!xField || !yField) { setStatus("Two numeric fields are needed for a scatter."); return; }
  const xs = [];
  const ys = [];
  const indices = [];
  const selected = new Set();
  const xc = columnOf(layer, xField);
  const yc = columnOf(layer, yField);
  for (let i = 0; i < xc.length; i += 1) {
    if (!Number.isFinite(xc[i]) || !Number.isFinite(yc[i]) || !timeAllows(i)) continue;
    if (state.selected.has(i)) selected.add(xs.length);
    xs.push(xc[i]);
    ys.push(yc[i]);
    indices.push(i);
  }
  const rect = plotRect(width, height, { xLabel: xField, yLabel: yField });
  const axes = drawScatter(ctx, rect, { x: xs, y: ys }, {
    colors, xLabel: xField, yLabel: yField, selected,
  });
  state.axes = axes;
  state.rect = rect;
  state.data = { mode: "scatter", xs, ys, indices, xField, yField };
  setHint("Drag a box over the points to select those features on the map.");
  setStatus(`${xs.length} of ${xc.length} features plotted${selectionNote()}`);
}

function renderBox(ctx, layer, colors, width, height) {
  const valueField = state.selects.x.value;
  const groupField = state.selects.group.value;
  if (!valueField) { setStatus("A numeric field is needed for a box plot."); return; }
  const features = featuresOf(layer);
  const column = columnOf(layer, valueField);
  const groups = new Map();
  for (let i = 0; i < column.length; i += 1) {
    if (!Number.isFinite(column[i]) || !timeAllows(i)) continue;
    const key = groupField
      ? String(features[i]?.properties?.[groupField] ?? "—")
      : "all";
    if (!groups.has(key)) groups.set(key, { values: [], indices: [] });
    const bucket = groups.get(key);
    bucket.values.push(column[i]);
    bucket.indices.push(i);
  }
  // Largest groups first, then the tail is what gets thinned off rather than
  // whichever categories happened to be sorted last.
  const ordered = [...groups.entries()]
    .sort((a, b) => b[1].values.length - a[1].values.length)
    .slice(0, 12);
  const stats = ordered.map(([label, bucket]) => ({
    label,
    ...boxStats(bucket.values),
    selected: bucket.indices.some((i) => state.selected.has(i)),
  }));
  const rect = plotRect(width, height, { xLabel: groupField || "", yLabel: valueField });
  const axes = drawBox(ctx, rect, stats, {
    colors, xLabel: groupField || "", yLabel: valueField,
  });
  state.axes = axes;
  state.rect = rect;
  state.data = {
    mode: "box",
    groups: ordered.map(([label, bucket]) => ({ label, indices: bucket.indices })),
    valueField,
    groupField,
  };
  setHint("Click a box to select that category on the map.");
  setStatus(`${ordered.length} of ${groups.size} group(s) shown${selectionNote()}`);
}

function selectionNote() {
  if (!state.selected.size) return "";
  const store_ = store();
  return store_
    ? ` · ${state.selected.size} selected`
    : ` · ${state.selected.size} highlighted (no selection store loaded)`;
}

/* ── Brushing ───────────────────────────────────────────────────────────── */

function drawBrushOverlay(ctx) {
  const brush = state.brush;
  if (!brush || !state.rect) return;
  const x = Math.min(brush.x0, brush.x1);
  const w = Math.abs(brush.x1 - brush.x0);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 43, 214, 0.85)";
  ctx.fillStyle = "rgba(255, 43, 214, 0.12)";
  ctx.lineWidth = 1;
  if (state.kind === "scatter") {
    const y = Math.min(brush.y0, brush.y1);
    const h = Math.abs(brush.y1 - brush.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else {
    ctx.fillRect(x, state.rect.y, w, state.rect.h);
    ctx.strokeRect(x, state.rect.y, w, state.rect.h);
  }
  ctx.restore();
}

function canvasPoint(event) {
  const box = state.canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** The feature indices the current brush covers. */
function brushedIndices() {
  const { brush, axes, data } = state;
  if (!brush || !axes || !data) return [];
  if (data.mode === "histogram") {
    if (!data.indices) return [];   // a raster histogram has no features
    const lo = axes.fromX(Math.min(brush.x0, brush.x1));
    const hi = axes.fromX(Math.max(brush.x0, brush.x1));
    const out = [];
    for (let k = 0; k < data.values.length; k += 1) {
      if (data.values[k] >= lo && data.values[k] <= hi) out.push(data.indices[k]);
    }
    state.brushRange = [lo, hi];
    return out;
  }
  if (data.mode === "scatter") {
    const x0 = axes.fromX(Math.min(brush.x0, brush.x1));
    const x1 = axes.fromX(Math.max(brush.x0, brush.x1));
    // Canvas y grows downward, so the LOWER pixel is the HIGHER value.
    const y0 = axes.fromY(Math.max(brush.y0, brush.y1));
    const y1 = axes.fromY(Math.min(brush.y0, brush.y1));
    const out = [];
    for (let k = 0; k < data.xs.length; k += 1) {
      if (data.xs[k] >= x0 && data.xs[k] <= x1 && data.ys[k] >= y0 && data.ys[k] <= y1) {
        out.push(data.indices[k]);
      }
    }
    return out;
  }
  return [];
}

function commitSelection(indices) {
  state.selected = new Set(indices);
  const wrote = writeSelection(selectionKey(), indices);
  if (!wrote && store()) {
    setStatus("The selection store is loaded but refused the write — see the console.");
  }
  render();
}

function installBrush(canvas) {
  let dragging = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.data) return;
    const point = canvasPoint(event);
    if (state.data.mode === "box") {
      // A box plot has categories, not a continuum: the gesture is a click on
      // one box, not a drag across a range.
      const index = Math.round(state.axes.fromX(point.x));
      const group = state.data.groups[index];
      if (group) commitSelection(group.indices);
      return;
    }
    dragging = true;
    state.brushRange = null;
    state.brush = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || !state.brush) return;
    const point = canvasPoint(event);
    state.brush.x1 = point.x;
    state.brush.y1 = point.y;
    scheduleRender();
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
    const moved = Math.abs(state.brush.x1 - state.brush.x0) > 2
      || Math.abs(state.brush.y1 - state.brush.y0) > 2;
    const indices = moved ? brushedIndices() : [];
    // A brush that selected nothing — a click, empty ground, or a raster
    // histogram, which has cells rather than features — leaves no mark, so the
    // rectangle goes with it rather than hanging there implying a filter.
    if (!indices.length) { state.brush = null; state.brushRange = null; }
    commitSelection(indices);
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
}

/* ── Seam ───────────────────────────────────────────────────────────────── */

/**
 * Open the charts panel, optionally on a named layer.
 * @param {number|string} [layerId]
 * @returns {boolean} false when there is nothing to chart
 */
export function open(layerId = null) {
  if (typeof document === "undefined") return false;
  if (!state.panel) build();
  if (layerId !== null && layerId !== undefined) state.layerId = layerId;
  syncLayers();
  if (!state.layerId) {
    state.panel.hidden = false;
    setStatus("Import a layer to chart it.");
    return false;
  }
  state.panel.hidden = false;
  render();
  return true;
}

export function close() {
  if (state.panel) state.panel.hidden = true;
}
const closeCharts = close;

export function refresh() {
  if (!state.panel || state.panel.hidden) return;
  syncLayers();
  render();
}

export function getState() {
  return {
    open: Boolean(state.panel && !state.panel.hidden),
    layerId: state.layerId,
    kind: state.kind,
    selected: [...state.selected],
    brushRange: state.brushRange || null,
    hasSelectionStore: Boolean(store()),
    timeFiltered: Boolean(state.timeMask),
  };
}

/* ── The launcher tile ──────────────────────────────────────────────────── */

function buildTile() {
  if (document.getElementById("gis-charts-section")) return true;
  const body = document.getElementById("gis-group-analysis")?.querySelector(".section-body");
  if (!body) return false;
  const tile = document.createElement("details");
  tile.className = "gis-tool-section";
  tile.id = "gis-charts-section";
  const summary = document.createElement("summary");
  summary.textContent = "Charts";
  const tileBody = document.createElement("div");
  tileBody.className = "gis-tool-body";
  const copy = document.createElement("p");
  copy.className = "tool-copy";
  copy.textContent = "Histogram, scatter or box plot of a layer already on the "
    + "globe. Brushing a chart selects the features it covers.";
  const buttons = document.createElement("div");
  buttons.className = "gis-btn-row";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "tool-button";
  openBtn.textContent = "Open charts";
  openBtn.addEventListener("click", () => open());
  buttons.appendChild(openBtn);
  tileBody.append(copy, buttons);
  tile.append(summary, tileBody);
  body.appendChild(tile);
  return true;
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function init() {
  window.GeoIDCharts = Object.assign({}, window.GeoIDCharts, {
    open, close, refresh, getState, SELECTION_CONTRACT,
  });

  let ticks = 0;
  let tileDone = false;
  let layersBound = false;
  let selectionBound = false;
  let timeBound = false;
  const tick = () => {
    ticks += 1;
    if (!tileDone) tileDone = buildTile();
    if (!layersBound && window.GeoIDImportManager?.onChange) {
      window.GeoIDImportManager.onChange(() => refresh());
      layersBound = true;
    }
    if (!selectionBound) {
      selectionBound = listenSelection((event) => {
        // A selection made anywhere else re-tints the marks. The event shape is
        // not settled, so both {layerId, indices} and a bare read are handled.
        const id = event?.layerId ?? state.layerId;
        if (String(id) !== String(state.layerId)) return;
        const set = event?.indices ? new Set(event.indices) : readSelection(selectionKey());
        state.selected = set || new Set();
        state.brush = null;
        state.brushRange = null;
        scheduleRender();
      });
    }
    if (!timeBound && typeof window.GeoIDTime?.onFilter === "function") {
      window.GeoIDTime.onFilter((event) => {
        state.timeLayerId = event.layerId;
        state.timeMask = event.closed ? null : new Set(event.indices);
        scheduleRender();
      });
      timeBound = true;
    }
    if (tileDone && layersBound && selectionBound && timeBound) return;
    if (ticks > 60) return;
    setTimeout(tick, 400);
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
