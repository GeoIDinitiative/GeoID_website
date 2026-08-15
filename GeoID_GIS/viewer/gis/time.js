/**
 * Per-layer time: find the field that carries the dates, and step a window
 * through it.
 *
 * Two halves, and the split is the same one chart-core.js makes. `parseTime`,
 * `detectTimeField`, `timeRange` and `applyTimeFilter` are PURE — no clock, no
 * DOM, no layer objects beyond reading a FeatureCollection — which is what
 * makes time.test.mjs able to say they are right. The pill at the foot of the
 * screen is the impure part and does nothing the pure part has not decided.
 *
 * ── What counts as a date, and why a number usually does not ──────────────
 *
 * `Number("2020")` is 2020 and `Date.parse("300")` is a real date in the year
 * 300, so a permissive parser turns every numeric column in the project into a
 * time field: a magnitude, an elevation, a population. The rule here is
 * deliberately tight and stated rather than felt:
 *
 *   - a bare number is a date ONLY inside an epoch window — [1e11, 4.2e12) as
 *     milliseconds or [1e8, 4.2e9) as seconds, i.e. 1973 to 2103. That is what
 *     lets a USGS earthquake feed work (properties.time is epoch ms) while an
 *     elevation of 1200 or a magnitude of 4.5 is refused;
 *   - a string is a date only if it LOOKS like one: ISO, y/m/d, m/d/y, or
 *     something carrying a month name and a four-digit year. Date.parse is
 *     only ever called on a string that already matched one of those shapes;
 *   - a bare year ("1998") is not a date. It is a number that happens to be
 *     four digits, and treating it as midnight on 1 January is an invention.
 *
 * The cost is a real epoch-second column below 1973 reading as no field at
 * all. The alternative cost is every numeric column reading as a date, which
 * is worse: the first is visible immediately, the second silently filters a
 * layer by its elevation.
 *
 * ── Where the filter lands ────────────────────────────────────────────────
 *
 * `applyIndices` walks a three-rung ladder and reports which rung it used:
 *
 *   1. "meshes"  — per-feature children carrying userData.featureIndex get
 *                  their .visible set. Nothing produces those today
 *                  (vector-render.js merges a whole collection into ONE
 *                  LineSegments plus one Points for the vertex budget), so
 *                  this rung is waiting for an editing/selection renderer.
 *   2. "manager" — window.GeoIDImportManager.setLayerTimeFilter(layerId,
 *                  indices), if it ever exists. It does not today.
 *   3. "notify"  — the subscribers of GeoIDTime.onFilter are told, and that is
 *                  the whole effect.
 *
 * Rung 3 is the live path in this build. The callbacks fire on EVERY rung, not
 * only the last, so a subscriber never has to ask which one ran; `path` on the
 * event says which, so a panel can be honest about whether the globe changed.
 *
 * Seam: window.GeoIDTime = { open, close, onFilter, applyTimeFilter,
 *                            detectTimeField, timeRange, parseTime, getState }
 *
 * Run the tests: node GeoID_GIS/viewer/gis/time.test.mjs
 */

/* ── Parsing ────────────────────────────────────────────────────────────── */

// 1973-03-03 to 2103-02-04, in each unit. Disjoint by three orders of
// magnitude, so a number can never be read as both.
const MS_MIN = 1e11;
const MS_MAX = 4.2e12;
const SEC_MIN = 1e8;
const SEC_MAX = 4.2e9;

const SHAPES = [
  // 2024-05-01, 2024-05-01T12:30:00Z, 2024-05-01 12:30, 2024-05
  /^\d{4}-\d{1,2}(-\d{1,2})?([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/,
  // 2024/05/01
  /^\d{4}\/\d{1,2}\/\d{1,2}([T ].*)?$/,
  // 05/01/2024 — Date.parse reads this as month/day/year, as every browser does
  /^\d{1,2}\/\d{1,2}\/\d{4}([T ].*)?$/,
];
const MONTH_NAME = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const YEAR = /\b\d{4}\b/;
const INTEGER = /^[+-]?\d+$/;

/**
 * One attribute value as epoch milliseconds, or null.
 * @param {*} value
 * @returns {number|null}
 */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return fromEpochNumber(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (INTEGER.test(text)) return fromEpochNumber(Number(text));
  const looksLikeDate = SHAPES.some((shape) => shape.test(text))
    || (MONTH_NAME.test(text) && YEAR.test(text));
  if (!looksLikeDate) return null;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
}

function fromEpochNumber(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= MS_MIN && abs < MS_MAX) return n;
  if (abs >= SEC_MIN && abs < SEC_MAX) return n * 1000;
  return null;
}

/**
 * A slider bound, which comes from code rather than from data: any finite
 * number is taken as epoch milliseconds, a Date as itself, a string through
 * parseTime. null/undefined mean "open end".
 */
function parseBound(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseTime(value);
}

/* ── The collection, however it arrives ─────────────────────────────────── */

/** A layer record, a FeatureCollection or a bare feature array — one shape. */
function featuresOf(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (Array.isArray(source.features)) return source.features;
  if (source.collection && Array.isArray(source.collection.features)) {
    return source.collection.features;
  }
  return [];
}

const NAMED = /date|time|when|timestamp|epoch|datetime/i;

/**
 * The field whose values parse as dates for at least `threshold` of the
 * features.
 *
 * The denominator is the number of features considered, NOT the number that
 * carry the field — a field present on half the layer and parseable on all of
 * those is 50%, not 100%, because filtering on it would silently drop the other
 * half. A name matching /date|time|when|timestamp/ wins over a higher-scoring
 * unnamed one, which is how a layer carrying both `time` and some other
 * date-shaped column resolves.
 *
 * @param {object|Array} fc  FeatureCollection, layer record or feature array
 * @param {{threshold?:number, sample?:number}} [opts]
 *   sample caps how many features are read (from the start, so it is
 *   deterministic) — the tile scans every layer on the globe with it.
 * @returns {string|null}
 */
export function detectTimeField(fc, { threshold = 0.8, sample = Infinity } = {}) {
  const features = featuresOf(fc);
  const n = Math.min(features.length, Math.max(1, sample));
  if (!n) return null;
  const names = [];
  const hits = new Map();
  for (let i = 0; i < n; i += 1) {
    const props = features[i]?.properties;
    if (!props || typeof props !== "object") continue;
    for (const key of Object.keys(props)) {
      if (!hits.has(key)) { hits.set(key, 0); names.push(key); }
      if (parseTime(props[key]) !== null) hits.set(key, hits.get(key) + 1);
    }
  }
  const candidates = names
    .map((name) => ({ name, score: hits.get(name) / n }))
    .filter((c) => c.score >= threshold);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const named = Number(NAMED.test(b.name)) - Number(NAMED.test(a.name));
    if (named) return named;
    if (b.score !== a.score) return b.score - a.score;
    return names.indexOf(a.name) - names.indexOf(b.name);
  });
  return candidates[0].name;
}

/**
 * The span of `field` across the collection.
 * @returns {{from:number|null, to:number|null, count:number, field:string|null}}
 *   from/to are epoch ms; count is how many features had a parseable value.
 */
export function timeRange(fc, field = null) {
  const features = featuresOf(fc);
  const key = field || detectTimeField(fc);
  if (!key) return { from: null, to: null, count: 0, field: null };
  let from = Infinity;
  let to = -Infinity;
  let count = 0;
  for (let i = 0; i < features.length; i += 1) {
    const t = parseTime(features[i]?.properties?.[key]);
    if (t === null) continue;
    count += 1;
    if (t < from) from = t;
    if (t > to) to = t;
  }
  if (!count) return { from: null, to: null, count: 0, field: key };
  return { from, to, count, field: key };
}

/**
 * The indices of the features inside [from, to], both ends inclusive and
 * either end optional.
 *
 * Two behaviours worth stating, because both are choices:
 *
 *   - with BOTH ends open the filter is inert and every index comes back,
 *     undated features included. A feature with no date should not vanish
 *     because a slider exists and is at full range;
 *   - with either end set, a feature whose value does not parse is EXCLUDED.
 *     It cannot be shown to be inside a window it has no position in.
 *
 * A collection with no detectable time field is also inert — all indices —
 * rather than empty, for the same reason.
 *
 * @param {object|Array} layer  layer record, FeatureCollection or feature array
 * @param {{from?:*, to?:*, field?:string}} [range]
 * @returns {number[]}
 */
export function applyTimeFilter(layer, { from = null, to = null, field = null } = {}) {
  const features = featuresOf(layer);
  const all = () => features.map((_, i) => i);
  const lo = parseBound(from);
  const hi = parseBound(to);
  if (lo === null && hi === null) return all();
  const key = field || detectTimeField(layer);
  if (!key) return all();
  const min = lo === null ? -Infinity : lo;
  const max = hi === null ? Infinity : hi;
  const out = [];
  for (let i = 0; i < features.length; i += 1) {
    const t = parseTime(features[i]?.properties?.[key]);
    if (t === null) continue;
    if (t >= min && t <= max) out.push(i);
  }
  return out;
}

/* ── Applying the filter to whatever the layer actually is ──────────────── */

/**
 * Per-feature children, if this layer has any. Every child must carry a
 * numeric userData.featureIndex — a group of two merged buffers (which is what
 * vector-render.js builds) has children and no indices, and toggling those
 * would hide the entire layer on the first step.
 */
function perFeatureChildren(layer) {
  const root = layer?.object3D || layer?.object3d;
  const kids = root?.children;
  if (!Array.isArray(kids) || !kids.length) return null;
  const indexed = kids.filter((k) => Number.isFinite(k?.userData?.featureIndex));
  return indexed.length === kids.length ? indexed : null;
}

/**
 * Show exactly `indices` on the globe, by the best route this build offers.
 * @returns {"meshes"|"manager"|"notify"} which rung was used
 */
export function applyIndices(layer, indices) {
  const kids = perFeatureChildren(layer);
  if (kids) {
    const wanted = new Set(indices);
    kids.forEach((child) => { child.visible = wanted.has(child.userData.featureIndex); });
    return "meshes";
  }
  const manager = typeof window !== "undefined" ? window.GeoIDImportManager : null;
  if (typeof manager?.setLayerTimeFilter === "function") {
    manager.setLayerTimeFilter(layer?.id, indices);
    return "manager";
  }
  return "notify";
}

/* ── Subscribers ────────────────────────────────────────────────────────── */

const listeners = [];

/** Subscribe to filter changes. Returns an unsubscribe function. */
export function onFilter(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function announce(event) {
  listeners.slice().forEach((fn) => {
    try {
      fn(event);
    } catch (error) {
      console.warn("[GeoID GIS] a time filter listener threw:", error.message);
    }
  });
}

/* ── The pill ───────────────────────────────────────────────────────────── */

/* NEVER a backtick inside this literal — it ends the string and kills the
   module silently (module-css.test.mjs pins this). */
const STYLE = `
.gis-time-pill {
  position: fixed;
  left: 50%;
  bottom: 5.2rem;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.34rem 0.5rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.38);
  border-radius: 999px;
  background: rgba(6, 10, 16, 0.82);
  backdrop-filter: blur(10px);
  color: var(--text);
  box-sizing: border-box;
  max-width: min(46rem, calc(100vw - 2rem));
}
.gis-time-pill[hidden] { display: none; }
.gis-time-pill .gis-time-slider {
  flex: 1 1 12rem;
  min-width: 7rem;
  margin: 0;
  accent-color: rgb(var(--nav-accent-rgb));
}
.gis-time-pill .gis-time-label {
  flex: 0 0 auto;
  font-size: 0.72rem;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.gis-time-pill .gis-time-field {
  flex: 0 0 auto;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.72;
  white-space: nowrap;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gis-time-pill .gis-time-mode {
  flex: 0 0 auto;
  padding: 0.16rem 0.3rem;
  font-size: 0.7rem;
}
.gis-time-pill .gis-time-play {
  flex: 0 0 auto;
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  line-height: 1;
}
.gis-time-pill .gis-time-close {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1;
  padding: 2px 3px;
}
.gis-time-pill .gis-time-close:hover { opacity: 1; }

@media (max-width: 720px) {
  .gis-time-pill .gis-time-field { display: none; }
  .gis-time-pill { gap: 0.32rem; }
}
`;

const STEPS = 20;
const PLAY_MS = 700;

const state = {
  pill: null,
  slider: null,
  label: null,
  fieldTag: null,
  play: null,
  mode: null,
  layerId: null,
  field: null,
  from: null,
  to: null,
  index: STEPS,
  playing: false,
  timer: null,
  path: "notify",
  count: 0,
};

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisTime = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function layers() {
  return window.GeoIDImportManager?.getLayers?.() || [];
}

function layerById(id) {
  return layers().find((l) => String(l.id) === String(id)) || null;
}

/**
 * Sit ABOVE the planet dock rather than at a guessed offset. The dock's height
 * changes when its strip is collapsed, and the strip is per-page furniture, so
 * the gap is measured from the dock's own box every half second — the same
 * reasoning (and interval) as side-panels' place() and the Atlas launcher.
 */
function place() {
  if (!state.pill || state.pill.hidden) return;
  const dock = document.getElementById("gis-planet-dock");
  if (dock && !dock.hidden) {
    const box = dock.getBoundingClientRect();
    if (box.height > 0) {
      state.pill.style.bottom = `${Math.max(8, window.innerHeight - box.top + 10)}px`;
      return;
    }
  }
  state.pill.style.bottom = "";
}

function windowFor(index) {
  const { from, to } = state;
  if (from === null || to === null) return { from: null, to: null };
  const span = to - from;
  const step = span / STEPS;
  const at = from + step * index;
  if (state.mode?.value === "window") {
    // One step wide, so playing reads as a moving window rather than a filling
    // one. The first stop is the first step, not a zero-width slice at t0.
    return { from: Math.max(from, at - step), to: at };
  }
  return { from, to: at };
}

function formatStamp(t) {
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const span = (state.to ?? 0) - (state.from ?? 0);
  // Under two days the clock matters; over it, the date is the whole story.
  return span > 2 * 86400000
    ? d.toISOString().slice(0, 10)
    : d.toISOString().slice(0, 16).replace("T", " ");
}

function apply() {
  const layer = layerById(state.layerId);
  if (!layer) return;
  const range = windowFor(state.index);
  const indices = applyTimeFilter(layer, { ...range, field: state.field });
  state.path = applyIndices(layer, indices);
  state.count = indices.length;
  if (state.label) {
    const shown = state.mode?.value === "window"
      ? `${formatStamp(range.from)} → ${formatStamp(range.to)}`
      : `to ${formatStamp(range.to)}`;
    state.label.textContent = `${shown} · ${indices.length}`;
  }
  announce({
    layerId: state.layerId,
    field: state.field,
    from: range.from,
    to: range.to,
    indices,
    path: state.path,
    total: featuresOf(layer).length,
  });
}

function setPlaying(on) {
  state.playing = on;
  if (state.play) {
    state.play.textContent = on ? "❚❚" : "▶";
    state.play.setAttribute("aria-label", on ? "Pause" : "Play");
    state.play.classList.toggle("is-active", on);
  }
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (!on) return;
  state.timer = setInterval(() => {
    state.index = state.index >= STEPS ? 0 : state.index + 1;
    if (state.slider) state.slider.value = String(state.index);
    apply();
  }, PLAY_MS);
}

function build() {
  injectStyle();
  const pill = document.createElement("div");
  pill.className = "gis-time-pill";
  pill.id = "gis-time-pill";
  pill.hidden = true;
  pill.setAttribute("role", "group");
  pill.setAttribute("aria-label", "Time filter");

  const play = document.createElement("button");
  play.type = "button";
  play.className = "tool-button gis-time-play";
  play.textContent = "▶";
  play.title = "Play through the range";
  play.setAttribute("aria-label", "Play");
  play.addEventListener("click", () => setPlaying(!state.playing));

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "slider gis-time-slider";
  slider.min = "0";
  slider.max = String(STEPS);
  slider.step = "1";
  slider.value = String(STEPS);
  slider.setAttribute("aria-label", "Time position");
  slider.addEventListener("input", () => {
    state.index = Number(slider.value);
    if (state.playing) setPlaying(false);
    apply();
  });

  const label = document.createElement("span");
  label.className = "gis-metric gis-time-label";

  const fieldTag = document.createElement("span");
  fieldTag.className = "gis-metric gis-time-field";

  const mode = document.createElement("select");
  mode.className = "mini-select gis-time-mode";
  [["upto", "Up to"], ["window", "Window"]].forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    mode.appendChild(option);
  });
  mode.title = "Cumulative, or a one-step sliding window";
  mode.addEventListener("change", apply);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-time-close";
  close.textContent = "✕";
  close.title = "Close";
  close.setAttribute("aria-label", "Close the time filter");
  close.addEventListener("click", () => closeTime());

  pill.append(play, slider, label, fieldTag, mode, close);
  document.body.appendChild(pill);

  state.pill = pill;
  state.slider = slider;
  state.label = label;
  state.fieldTag = fieldTag;
  state.play = play;
  state.mode = mode;

  window.addEventListener("resize", place);
  // The dock moves without a resize: its strip collapses, and on a planet page
  // it is built after this module runs.
  setInterval(place, 500);
  return pill;
}

/**
 * Open the time pill on a layer.
 * @param {number|string} [layerId] defaults to the first layer with a time field
 * @returns {boolean} false when nothing on the globe carries dates
 */
export function open(layerId = null) {
  if (typeof document === "undefined") return false;
  if (!state.pill) build();
  let layer = layerId === null ? null : layerById(layerId);
  if (!layer) {
    layer = layers().find((l) => featuresOf(l).length
      && detectTimeField(l, { sample: 200 }));
  }
  if (!layer) {
    console.warn("[GeoID GIS] no layer on the globe carries a date field");
    return false;
  }
  const range = timeRange(layer);
  if (!range.field || range.from === null) {
    console.warn(`[GeoID GIS] ${layer.name} has no readable date field`);
    return false;
  }
  state.layerId = layer.id;
  state.field = range.field;
  state.from = range.from;
  state.to = range.to;
  state.index = STEPS;
  state.slider.value = String(STEPS);
  state.fieldTag.textContent = `${layer.name} · ${range.field}`;
  state.fieldTag.title = `${range.count} dated feature(s) in ${layer.name}`;
  state.pill.hidden = false;
  place();
  apply();
  return true;
}

/** Close the pill and put every feature back. */
export function closeTime() {
  setPlaying(false);
  if (state.pill) state.pill.hidden = true;
  const layer = layerById(state.layerId);
  if (layer) {
    const indices = featuresOf(layer).map((_, i) => i);
    state.path = applyIndices(layer, indices);
    announce({
      layerId: state.layerId,
      field: state.field,
      from: null,
      to: null,
      indices,
      path: state.path,
      total: indices.length,
      closed: true,
    });
  }
  state.layerId = null;
  state.field = null;
}

/** What the pill is currently showing — for a panel that wants to agree with it. */
export function getState() {
  const range = windowFor(state.index);
  return {
    open: Boolean(state.pill && !state.pill.hidden),
    layerId: state.layerId,
    field: state.field,
    from: range.from,
    to: range.to,
    rangeFrom: state.from,
    rangeTo: state.to,
    steps: STEPS,
    index: state.index,
    playing: state.playing,
    path: state.path,
    matched: state.count,
  };
}

/* ── The launcher tile ──────────────────────────────────────────────────── */

function buildTile() {
  if (document.getElementById("gis-time-section")) return true;
  const body = document.getElementById("gis-group-analysis")?.querySelector(".section-body");
  if (!body) return false;

  const tile = document.createElement("details");
  tile.className = "gis-tool-section";
  tile.id = "gis-time-section";
  const summary = document.createElement("summary");
  summary.textContent = "Time";
  const tileBody = document.createElement("div");
  tileBody.className = "gis-tool-body";

  const copy = document.createElement("p");
  copy.className = "tool-copy";
  copy.textContent = "Step a window through a layer's dates. The field is found "
    + "by reading the attributes, not by name alone.";

  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.htmlFor = "gis-time-layer";
  label.textContent = "Layer";
  const select = document.createElement("select");
  select.id = "gis-time-layer";
  select.className = "mini-select";
  row.append(label, select);

  const buttons = document.createElement("div");
  buttons.className = "gis-btn-row";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "tool-button";
  openBtn.textContent = "Time slider";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "button secondary";
  clearBtn.textContent = "Show all";
  buttons.append(openBtn, clearBtn);

  const status = document.createElement("div");
  status.className = "gis-metric";
  status.id = "gis-time-status";
  status.setAttribute("aria-live", "polite");

  tileBody.append(copy, row, buttons, status);
  tile.append(summary, tileBody);
  body.appendChild(tile);

  const refresh = () => {
    const dated = layers().filter((l) => featuresOf(l).length
      && detectTimeField(l, { sample: 200 }));
    const previous = select.value;
    select.innerHTML = "";
    if (!dated.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No dated layers";
      select.appendChild(option);
      status.textContent = "No layer on the globe has a field that reads as dates.";
      return;
    }
    dated.forEach((l) => {
      const option = document.createElement("option");
      option.value = String(l.id);
      option.textContent = l.name;
      select.appendChild(option);
    });
    if (previous && [...select.options].some((o) => o.value === previous)) {
      select.value = previous;
    }
    status.textContent = `${dated.length} dated layer(s).`;
  };

  openBtn.addEventListener("click", () => {
    const id = select.value;
    if (!id) { status.textContent = "Nothing to step through yet."; return; }
    const ok = open(id);
    status.textContent = ok
      ? `Stepping ${select.selectedOptions[0]?.textContent} by ${state.field}.`
      : "That layer has no readable date field.";
  });
  clearBtn.addEventListener("click", () => {
    closeTime();
    status.textContent = "Filter cleared.";
  });

  refresh();
  window.GeoIDImportManager?.onChange?.(refresh);
  // The tile's own view of the run: which rung the filter actually reached, so
  // "nothing happened on the globe" is stated rather than left to be guessed.
  onFilter((event) => {
    if (event.closed) return;
    status.textContent = event.path === "notify"
      ? `${event.indices.length} of ${event.total} in range (chart only — the globe `
        + "renderer has no per-feature handle yet)."
      : `${event.indices.length} of ${event.total} in range.`;
  });
  return true;
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function init() {
  window.GeoIDTime = Object.assign({}, window.GeoIDTime, {
    open,
    close: closeTime,
    onFilter,
    applyTimeFilter,
    detectTimeField,
    timeRange,
    parseTime,
    getState,
  });

  // The toolbox markup arrives with the shell on a planet page and is
  // reordered after load on Earth, so the anchor is waited for rather than
  // assumed — the tool-dialog tick, bounded the same way.
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    if (buildTile() || ticks > 60) return;
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
