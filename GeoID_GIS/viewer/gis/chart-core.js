/**
 * Chart primitives: five marks, one axis frame, three pure statistics.
 *
 * Written in the spirit of research/plot.js — plain arrays in, canvas out, no
 * charting library in a repo with no build tooling — but standalone and
 * inverted in one important way: plot.js OWNS its canvas (it creates one and
 * returns it, which is right for a figure written into figures/), while these
 * draw into a canvas the caller already has. A chart bound to a map layer is
 * re-drawn on every selection change, every time filter and every resize, and
 * a function that mints a canvas each time cannot be used that way.
 *
 * The split that matters here is DOM versus not:
 *
 *   - binData, boxStats, niceTicks, quantile, extent are PURE. They touch no
 *     canvas, no document and no window, which is what makes them testable in
 *     node (chart-core.test.mjs) rather than only by looking at a picture.
 *   - drawLine/drawBars/drawScatter/drawHistogram/drawBox need a 2d context.
 *     They are thin: place the marks, call drawAxes, hand back the transforms.
 *
 * Every draw function returns its transforms, INCLUDING the inverses
 * (fromX/fromY). That is not decoration — brushing a chart to select features
 * means turning a pixel the user dragged over back into a data value, and a
 * caller that had to re-derive the mapping would eventually derive it slightly
 * differently from the one the marks were drawn with.
 *
 * Colours come from the page's own tokens — var(--text) and
 * var(--nav-accent-rgb) resolved through getComputedStyle — so a chart looks
 * like the panel it sits in, on Earth and on the nine planet pages, and follows
 * the ember/amber overrides for free. Every one has a literal fallback, because
 * getComputedStyle answers nothing useful before the stylesheet lands.
 *
 * Run the tests: node GeoID_GIS/viewer/gis/chart-core.test.mjs
 */

/* ── Pure statistics ────────────────────────────────────────────────────── */

/**
 * One value as a number, or NaN.
 *
 * Number() is not enough on its own: `Number(null)`, `Number("")`, `Number([])`
 * and `Number(false)` are all 0, so a column of missing values would read as a
 * spike of zeros in every histogram and drag the domain down to meet it. Only
 * a number, or a string with something in it, is allowed to be a number.
 */
export function toNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return NaN;
    const v = Number(trimmed);
    return Number.isFinite(v) ? v : NaN;
  }
  return NaN;
}

/** The finite numbers in `values`, as a plain array. Strings that are numbers
    count: an attribute table read from a CSV or a shapefile carries them. */
function finiteNumbers(values) {
  const out = [];
  if (!values) return out;
  for (let i = 0; i < values.length; i += 1) {
    const v = toNumber(values[i]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * The min and max of `values`, padded outward by `pad` of the span so marks do
 * not sit on the frame. A degenerate range is widened rather than returned as
 * a zero-width one, which would divide by zero in every transform below.
 */
export function extent(values, pad = 0.04) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = toNumber(values[i]);
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [0, 1];
  if (min === max) return [min - 0.5, max + 0.5];
  const room = (max - min) * pad;
  return [min - room, max + room];
}

/**
 * Heckbert's nice number: the 1/2/5/10 × 10^k nearest `range`.
 * `round` picks the nearest such number; otherwise the smallest one at least
 * as large.
 */
function niceNum(range, round) {
  if (!(range > 0)) return 0;
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) {
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
  } else if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * 10 ** exp;
}

/**
 * Tick values across [min, max], every one a whole multiple of one nice step.
 *
 * `n` is a TARGET, not a promise: the point of nice ticks is that they land on
 * round numbers, and rounding the step is exactly what stops the count being
 * exact. Expect n ± 2. An empty array comes back for a non-finite range and a
 * single tick for a degenerate one, so a caller can always iterate the result.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} n  target tick count
 * @returns {number[]}
 */
export function niceTicks(min, max, n = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (lo === hi) return [lo];
  const target = Math.max(2, Math.floor(n) || 2);
  const step = niceNum((hi - lo) / (target - 1), true);
  if (!(step > 0)) return [lo, hi];
  // Ticks are built as k × step and then snapped to the step's own precision:
  // 3 × 0.2 is 0.6000000000000001 in binary floating point, and a tick label
  // reading "0.6000000000000001" is the kind of thing nobody reports as a bug
  // and everybody notices.
  const decimals = Math.min(20, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const ticks = [];
  for (let k = first; k <= last; k += 1) {
    ticks.push(Number((k * step).toFixed(decimals)));
  }
  return ticks.length ? ticks : [lo, hi];
}

/**
 * The p-quantile of an already-sorted array, by linear interpolation of the
 * empirical distribution — R's type 7 and numpy's default, so a quartile
 * quoted here is the quartile every other tool in the stack would quote.
 */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Bin `values` into `bins` equal-width buckets.
 *
 * Two conventions, both load-bearing and neither guessable from the outside:
 * a bin is half-open [edge, nextEdge) so a value sitting exactly on an
 * internal edge belongs to the bin ABOVE it, and the maximum — which by that
 * rule would fall off the end — is folded into the last bin. That is what
 * makes the counts sum to the number of values in range.
 *
 * @param {ArrayLike<number>} values
 * @param {{bins?:number, min?:number, max?:number}} [opts]
 *   min/max fix the domain (a shared domain is what lets two histograms be
 *   compared); values outside a fixed domain are dropped, not clamped.
 * @returns {{edges:number[], counts:number[], width:number, min:number,
 *            max:number, total:number}}
 */
export function binData(values, { bins = 20, min, max } = {}) {
  const data = finiteNumbers(values);
  const count = Math.max(1, Math.floor(bins) || 1);
  let lo = Number.isFinite(min) ? min : Infinity;
  let hi = Number.isFinite(max) ? max : -Infinity;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    for (let i = 0; i < data.length; i += 1) {
      if (!Number.isFinite(min) && data[i] < lo) lo = data[i];
      if (!Number.isFinite(max) && data[i] > hi) hi = data[i];
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }
  const width = (hi - lo) / count;
  const counts = new Array(count).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (v < lo || v > hi) continue;
    let k = Math.floor((v - lo) / width);
    if (k >= count) k = count - 1;
    if (k < 0) k = 0;
    counts[k] += 1;
    total += 1;
  }
  const edges = new Array(count + 1);
  for (let i = 0; i <= count; i += 1) edges[i] = lo + i * width;
  // The last edge is set from hi rather than accumulated, so edges[n] is
  // exactly the maximum and a caller can trust it as a domain bound.
  edges[count] = hi;
  return { edges, counts, width, min: lo, max: hi, total };
}

/**
 * The five numbers a box plot draws, plus the points outside the whiskers.
 *
 * `min` and `max` are the WHISKER ends — the most extreme values still within
 * 1.5 IQR of the quartiles — not the extremes of the data, which are in
 * `lowest`/`highest`. Tukey's convention, and the reason a box plot says
 * anything: whiskers drawn to the true extremes would make every outlier
 * invisible by definition.
 *
 * @param {ArrayLike<number>} values
 * @returns {{min:number,q1:number,median:number,q3:number,max:number,
 *            outliers:number[],iqr:number,count:number,
 *            lowest:number,highest:number}}
 */
export function boxStats(values) {
  const sorted = finiteNumbers(values).sort((a, b) => a - b);
  if (!sorted.length) {
    return {
      min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN,
      outliers: [], iqr: NaN, count: 0, lowest: NaN, highest: NaN,
    };
  }
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const outliers = [];
  let whiskerLo = NaN;
  let whiskerHi = NaN;
  for (let i = 0; i < sorted.length; i += 1) {
    const v = sorted[i];
    if (v < loFence || v > hiFence) { outliers.push(v); continue; }
    if (!Number.isFinite(whiskerLo)) whiskerLo = v;
    whiskerHi = v;
  }
  // Every point an outlier happens only when the IQR is zero and the tails are
  // not; the whiskers then collapse onto the box rather than becoming NaN.
  if (!Number.isFinite(whiskerLo)) { whiskerLo = q1; whiskerHi = q3; }
  return {
    min: whiskerLo,
    q1,
    median,
    q3,
    max: whiskerHi,
    outliers,
    iqr,
    count: sorted.length,
    lowest: sorted[0],
    highest: sorted[sorted.length - 1],
  };
}

/** Short, readable numbers for a tick or a readout. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return value.toExponential(1);
  return String(Math.round(value * 1000) / 1000);
}

/* ── Palette ────────────────────────────────────────────────────────────── */

const FALLBACK = {
  text: "#e8f7f4",
  accentRgb: "88, 198, 179",
};

/**
 * The page's own tokens, resolved once per draw.
 *
 * Both are read from the element the chart lives in rather than from :root, so
 * a chart inside #research-hub — which rebinds --text and --nav-accent-rgb —
 * takes the hub's palette and not the viewer's.
 */
export function chartColors(node) {
  let text = FALLBACK.text;
  let accentRgb = FALLBACK.accentRgb;
  try {
    const target = node || (typeof document !== "undefined" ? document.body : null);
    if (target && typeof getComputedStyle === "function") {
      const style = getComputedStyle(target);
      const t = style.getPropertyValue("--text").trim();
      const a = style.getPropertyValue("--nav-accent-rgb").trim();
      if (t) text = t;
      if (a) accentRgb = a;
    }
  } catch {
    /* no stylesheet yet, or no DOM at all: the fallbacks are the answer */
  }
  const rgb = (alpha) => `rgba(${accentRgb}, ${alpha})`;
  return {
    text,
    accentRgb,
    accent: `rgb(${accentRgb})`,
    axis: rgb(0.55),
    grid: rgb(0.14),
    mark: rgb(0.75),
    fill: rgb(0.4),
    // The selection tint is deliberately NOT the accent: a selected mark has to
    // be distinguishable from an ordinary one at a glance, and two shades of
    // the same hue are not.
    selected: "var(--skin-chrome)",
    muted: "rgba(255, 255, 255, 0.28)",
  };
}

/* ── Canvas plumbing ────────────────────────────────────────────────────── */

/**
 * Size a canvas for the device and return its context, already scaled so every
 * coordinate below is in CSS pixels. Called by the UI, never by the tests.
 */
export function prepareCanvas(canvas, width, height, background = "rgba(0,0,0,0)") {
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background && background !== "rgba(0,0,0,0)") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  return ctx;
}

/**
 * The plot rectangle inside a canvas of `width` × `height`: room on the left
 * for y tick labels, at the foot for x tick labels, and a little more of each
 * when an axis is titled.
 */
export function plotRect(width, height, { xLabel = "", yLabel = "", title = "" } = {}) {
  const left = yLabel ? 54 : 40;
  const bottom = xLabel ? 40 : 24;
  const top = title ? 22 : 8;
  return {
    x: left,
    y: top,
    w: Math.max(10, width - left - 10),
    h: Math.max(10, height - top - bottom),
  };
}

/* ── The axis frame ─────────────────────────────────────────────────────── */

/**
 * Grid, ticks, labels and the box, and the four transforms that go with them.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,w:number,h:number}} rect  the PLOT area
 * @param {object} opts
 *   xRange/yRange  [min,max] in data units
 *   xCategories    labels for a categorical x axis; positions are 0..n-1
 *   xTicks/yTicks  explicit tick values (nice ticks by default)
 *   xLabel/yLabel/title
 *   colors         a chartColors() result
 * @returns {{toX:function, toY:function, fromX:function, fromY:function}}
 */
export function drawAxes(ctx, rect, {
  xRange = [0, 1], yRange = [0, 1], xCategories = null,
  xTicks = null, yTicks = null,
  xLabel = "", yLabel = "", title = "",
  colors = chartColors(),
  xFormat = formatNumber, yFormat = formatNumber,
} = {}) {
  const { x, y, w, h } = rect;
  const xSpan = (xRange[1] - xRange[0]) || 1;
  const ySpan = (yRange[1] - yRange[0]) || 1;
  const toX = (v) => x + ((v - xRange[0]) / xSpan) * w;
  const toY = (v) => y + h - ((v - yRange[0]) / ySpan) * h;
  const fromX = (px) => xRange[0] + ((px - x) / w) * xSpan;
  const fromY = (py) => yRange[0] + ((y + h - py) / h) * ySpan;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = "10px 'Exo 2', system-ui, sans-serif";

  if (title) {
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, x, Math.max(2, y - 16));
  }

  // Vertical grid + x tick labels.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (xCategories) {
    // One label per category, thinned so they cannot overlap: a box plot of
    // forty land-cover classes is unreadable with forty labels and perfectly
    // readable with eight.
    const stride = Math.max(1, Math.ceil(xCategories.length / Math.max(1, Math.floor(w / 54))));
    xCategories.forEach((label, i) => {
      if (i % stride) return;
      const px = toX(i);
      ctx.fillStyle = colors.text;
      const text = String(label);
      ctx.fillText(text.length > 10 ? `${text.slice(0, 9)}…` : text, px, y + h + 5);
    });
  } else {
    const ticks = xTicks || niceTicks(xRange[0], xRange[1], 5);
    ticks.forEach((v) => {
      const px = toX(v);
      if (px < x - 0.5 || px > x + w + 0.5) return;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + h);
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.fillText(xFormat(v), px, y + h + 5);
    });
  }

  // Horizontal grid + y tick labels.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  (yTicks || niceTicks(yRange[0], yRange[1], 4)).forEach((v) => {
    const py = toY(v);
    if (py < y - 0.5 || py > y + h + 0.5) return;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.fillText(yFormat(v), x - 5, py);
  });

  ctx.strokeStyle = colors.axis;
  ctx.strokeRect(x, y, w, h);

  if (xLabel) {
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(xLabel, x + w / 2, y + h + 34);
  }
  if (yLabel) {
    ctx.fillStyle = colors.text;
    ctx.save();
    ctx.translate(Math.max(9, x - 38), y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return { toX, toY, fromX, fromY };
}

/* ── Marks ──────────────────────────────────────────────────────────────── */

/** Normalise {x:[],y:[]} or [{x,y}] into parallel arrays. */
function asXY(points) {
  if (!points) return { x: [], y: [] };
  if (Array.isArray(points)) {
    if (!points.length) return { x: [], y: [] };
    if (typeof points[0] === "object" && points[0] !== null) {
      return { x: points.map((p) => p.x), y: points.map((p) => p.y) };
    }
    return { x: points.map((_, i) => i), y: points.slice() };
  }
  return { x: points.x || [], y: points.y || [] };
}

/**
 * A line (or several). `series` is one {x, y, name} or an array of them.
 * Non-finite y values break the line rather than being interpolated across,
 * which is what a gap in a time series actually is.
 */
export function drawLine(ctx, rect, series, opts = {}) {
  const list = Array.isArray(series) ? series : [series];
  const parts = list.map(asXY);
  const colors = opts.colors || chartColors();
  const xRange = opts.xRange || extent(parts.flatMap((p) => p.x), 0.01);
  const yRange = opts.yRange || extent(parts.flatMap((p) => p.y));
  const axes = drawAxes(ctx, rect, { ...opts, xRange, yRange, colors });
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  parts.forEach((part, index) => {
    ctx.strokeStyle = index === 0 ? colors.accent : colors.selected;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < part.x.length; i += 1) {
      const vx = toNumber(part.x[i]);
      const vy = toNumber(part.y[i]);
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) { started = false; continue; }
      const px = axes.toX(vx);
      const py = axes.toY(vy);
      if (started) ctx.lineTo(px, py);
      else { ctx.moveTo(px, py); started = true; }
    }
    ctx.stroke();
  });
  ctx.restore();
  return axes;
}

/**
 * Categorical bars. `bars` is [{label, value, selected?}] or
 * {labels, values}. Bar i is centred on x = i, so the axis is categorical and
 * `fromX` rounds back to an index.
 */
export function drawBars(ctx, rect, bars, opts = {}) {
  const list = Array.isArray(bars)
    ? bars
    : (bars.labels || []).map((label, i) => ({ label, value: bars.values[i] }));
  const colors = opts.colors || chartColors();
  const values = list.map((b) => toNumber(b.value) || 0);
  const top = opts.yRange || [Math.min(0, ...values, 0), Math.max(1, ...values)];
  const axes = drawAxes(ctx, rect, {
    ...opts,
    xRange: [-0.5, list.length - 0.5],
    yRange: top,
    xCategories: list.map((b) => b.label),
    colors,
  });
  const slot = rect.w / Math.max(1, list.length);
  const barWidth = Math.max(1, slot * 0.72);
  const zero = axes.toY(Math.max(top[0], 0));
  list.forEach((bar, i) => {
    const value = toNumber(bar.value);
    if (!Number.isFinite(value)) return;
    const py = axes.toY(value);
    ctx.fillStyle = bar.selected ? colors.selected : colors.fill;
    ctx.fillRect(axes.toX(i) - barWidth / 2, Math.min(py, zero), barWidth, Math.abs(zero - py));
  });
  return axes;
}

/**
 * A scatter. `points` is [{x,y}] or {x:[],y:[]}; `opts.selected` is a Set of
 * point indices drawn in the selection colour and on top, so a small selection
 * inside a dense cloud is still visible.
 */
export function drawScatter(ctx, rect, points, opts = {}) {
  const { x: xs, y: ys } = asXY(points);
  const colors = opts.colors || chartColors();
  const xRange = opts.xRange || extent(xs);
  const yRange = opts.yRange || extent(ys);
  const axes = drawAxes(ctx, rect, { ...opts, xRange, yRange, colors });
  const selected = opts.selected instanceof Set ? opts.selected : null;
  const radius = opts.radius || 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const paint = (wantSelected) => {
    ctx.fillStyle = wantSelected ? colors.selected : colors.mark;
    for (let i = 0; i < xs.length; i += 1) {
      const isSelected = selected ? selected.has(i) : false;
      if (isSelected !== wantSelected) continue;
      const vx = toNumber(xs[i]);
      const vy = toNumber(ys[i]);
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      ctx.beginPath();
      ctx.arc(axes.toX(vx), axes.toY(vy), wantSelected ? radius + 1 : radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  paint(false);
  if (selected && selected.size) paint(true);
  ctx.restore();
  return axes;
}

/**
 * A histogram of a binData() result. Bars span their bin's edges exactly, so
 * the x axis is in DATA units and a brush across it reads straight off
 * `fromX` — which is what makes brushing a histogram into a map selection a
 * couple of lines rather than an index lookup table.
 *
 * `opts.selectedRange` shades [lo, hi] behind the bars.
 */
export function drawHistogram(ctx, rect, bins, opts = {}) {
  const colors = opts.colors || chartColors();
  const edges = bins?.edges || [0, 1];
  const counts = bins?.counts || [0];
  const maxCount = counts.reduce((a, b) => Math.max(a, b), 0);
  const xRange = opts.xRange || [edges[0], edges[edges.length - 1]];
  const yRange = opts.yRange || [0, Math.max(1, maxCount)];
  const axes = drawAxes(ctx, rect, { ...opts, xRange, yRange, colors });
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const range = opts.selectedRange;
  if (range && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
    const a = axes.toX(Math.min(range[0], range[1]));
    const b = axes.toX(Math.max(range[0], range[1]));
    ctx.fillStyle = "rgba(var(--skin-chrome-rgb), 0.16)";
    ctx.fillRect(a, rect.y, Math.max(1, b - a), rect.h);
  }
  const zero = axes.toY(Math.max(0, yRange[0]));
  for (let i = 0; i < counts.length; i += 1) {
    const left = axes.toX(edges[i]);
    const right = axes.toX(edges[i + 1]);
    const py = axes.toY(counts[i]);
    const inRange = range
      && edges[i] >= Math.min(range[0], range[1]) - 1e-12
      && edges[i + 1] <= Math.max(range[0], range[1]) + 1e-12;
    ctx.fillStyle = inRange ? colors.selected : colors.fill;
    ctx.fillRect(left + 0.5, Math.min(py, zero), Math.max(1, right - left - 1), Math.abs(zero - py));
  }
  ctx.restore();
  return axes;
}

/**
 * One or more box plots. `stats` is a boxStats() result or an array of
 * {label, ...boxStats()}; box i is centred on x = i.
 */
export function drawBox(ctx, rect, stats, opts = {}) {
  const list = Array.isArray(stats) ? stats : [{ label: opts.label || "", ...stats }];
  const colors = opts.colors || chartColors();
  const all = [];
  list.forEach((s) => {
    [s.min, s.q1, s.median, s.q3, s.max].forEach((v) => {
      if (Number.isFinite(v)) all.push(v);
    });
    (s.outliers || []).forEach((v) => all.push(v));
  });
  const yRange = opts.yRange || extent(all, 0.08);
  const axes = drawAxes(ctx, rect, {
    ...opts,
    xRange: [-0.5, list.length - 0.5],
    yRange,
    xCategories: list.map((s) => s.label ?? ""),
    colors,
  });
  const slot = rect.w / Math.max(1, list.length);
  const boxWidth = Math.max(4, Math.min(38, slot * 0.5));
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y - 2, rect.w, rect.h + 4);
  ctx.clip();
  list.forEach((s, i) => {
    if (!Number.isFinite(s.median)) return;
    const cx = axes.toX(i);
    const left = cx - boxWidth / 2;
    ctx.strokeStyle = s.selected ? colors.selected : colors.axis;
    ctx.fillStyle = s.selected ? "rgba(var(--skin-chrome-rgb), 0.22)" : colors.grid;
    ctx.lineWidth = 1;
    // Whiskers first, so the box paints over their ends.
    ctx.beginPath();
    ctx.moveTo(cx, axes.toY(s.max));
    ctx.lineTo(cx, axes.toY(s.q3));
    ctx.moveTo(cx, axes.toY(s.q1));
    ctx.lineTo(cx, axes.toY(s.min));
    ctx.moveTo(left + boxWidth * 0.25, axes.toY(s.max));
    ctx.lineTo(left + boxWidth * 0.75, axes.toY(s.max));
    ctx.moveTo(left + boxWidth * 0.25, axes.toY(s.min));
    ctx.lineTo(left + boxWidth * 0.75, axes.toY(s.min));
    ctx.stroke();
    const topY = axes.toY(s.q3);
    const height = Math.max(1, axes.toY(s.q1) - topY);
    ctx.fillRect(left, topY, boxWidth, height);
    ctx.strokeRect(left, topY, boxWidth, height);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(left, axes.toY(s.median));
    ctx.lineTo(left + boxWidth, axes.toY(s.median));
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    (s.outliers || []).forEach((v) => {
      ctx.beginPath();
      ctx.arc(cx, axes.toY(v), 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.restore();
  return axes;
}
