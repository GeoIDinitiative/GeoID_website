/**
 * A TIME SERIES, drawn to a canvas — one line per station against dates.
 *
 * `research/plot.js` plots numbers against numbers; a model run is plotted
 * against TIME, whose ticks want to land on midnights and six-hourly marks and
 * be labelled as dates. That is the whole reason this is its own file, and why
 * `timeTicks` is pure and tested.
 *
 * Kept deliberately plain so the same function draws the small plot in a card
 * and the large one in a window, and later the analysis hub's panels.
 */

const AXIS = "rgba(151, 182, 194, 0.55)";
const GRID = "rgba(151, 182, 194, 0.13)";
const TEXT = "#cfe6ee";
const HOUR = 3600000;
const DAY = 24 * HOUR;
const STEPS = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY, 365 * DAY];

/** Tick instants between t0 and t1 (ms, UTC), at a step giving at most `max` ticks. */
export function timeTicks(t0, t1, max = 6) {
  if (!(t1 > t0)) return { step: DAY, ticks: [t0] };
  const step = STEPS.find((s) => (t1 - t0) / s <= max) || STEPS[STEPS.length - 1];
  const ticks = [];
  if (step >= 30 * DAY) {
    const d = new Date(t0); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    const months = Math.round(step / (30 * DAY));
    while (d.getTime() < t0) d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1 && ticks.length < 100) { ticks.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + months); }
  } else {
    for (let t = Math.ceil(t0 / step) * step; t <= t1 && ticks.length < 200; t += step) ticks.push(t);
  }
  return { step, ticks };
}

/** A tick's label, as much of the date as the step needs. */
export function tickLabel(t, step) {
  const iso = new Date(t).toISOString();
  if (step < DAY) return iso.slice(11, 13) === "00" ? iso.slice(5, 10) : `${iso.slice(11, 13)}h`;
  if (step < 30 * DAY) return iso.slice(5, 10);
  return iso.slice(0, 7);
}

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
}

const fmtY = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

/** The range to draw: the data's, padded, pulled in to `clip` above if asked. */
export function yRangeOf(lines, { min = null, max = null, clip = null, floor = null } = {}) {
  let lo = Infinity; let hi = -Infinity;
  for (const l of lines) for (const v of l.values || []) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (clip !== null && hi > clip) hi = clip;
  if (min !== null) lo = Math.min(lo, min);
  if (max !== null) hi = Math.max(hi, max);
  if (floor !== null) lo = Math.max(lo, floor);
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const pad = (hi - lo) * 0.06;
  return [floor !== null && lo - pad < floor ? floor : lo - pad, hi + pad];
}

/**
 * Draw it. `canvas` is sized here to its CSS box at the device pixel ratio.
 * Returns the layout, so a caller can turn a pointer into the nearest time.
 */
export function drawTimeSeries(canvas, {
  times = [], lines = [], yLabel = "", range = null, refs = [], marker = -1, hover = -1, empty = "No readings yet.", now = null,
} = {}) {
  const dpr = globalThis.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320; const cssH = canvas.clientHeight || 180;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = "10.5px 'Exo 2', system-ui, sans-serif";
  const ms = times.map((t) => (typeof t === "number" ? t : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}${t.length <= 10 ? "T00:00" : ""}Z`)));
  const box = { left: 38, right: cssW - 8, top: 8, bottom: cssH - 20 };
  const layout = { box, ms, toX: null, indexAt: () => -1 };
  if (!ms.length || !lines.length) {
    ctx.fillStyle = TEXT; ctx.globalAlpha = 0.65; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(empty, cssW / 2, cssH / 2); ctx.globalAlpha = 1;
    return layout;
  }
  const t0 = ms[0]; const t1 = ms[ms.length - 1] > t0 ? ms[ms.length - 1] : t0 + HOUR;
  const [y0, y1] = range || yRangeOf(lines);
  const toX = (t) => box.left + ((t - t0) / (t1 - t0)) * (box.right - box.left);
  const toY = (v) => box.bottom - ((v - y0) / (y1 - y0)) * (box.bottom - box.top);
  layout.toX = toX;
  layout.indexAt = (px) => {
    let best = -1; let d = Infinity;
    ms.forEach((t, k) => { const dd = Math.abs(toX(t) - px); if (dd < d) { d = dd; best = k; } });
    return best;
  };

  // Grid and axes.
  ctx.lineWidth = 1;
  const yStep = niceStep(y1 - y0, 4);
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + 1e-9; v += yStep) {
    const y = Math.round(toY(v)) + 0.5;
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();
    ctx.fillStyle = TEXT; ctx.fillText(fmtY(v), box.left - 4, y);
  }
  const { step, ticks } = timeTicks(t0, t1, Math.max(2, Math.floor((box.right - box.left) / 58)));
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const t of ticks) {
    const x = Math.round(toX(t)) + 0.5;
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke();
    ctx.fillStyle = TEXT; ctx.fillText(tickLabel(t, step), x, box.bottom + 4);
  }
  ctx.strokeStyle = AXIS;
  ctx.beginPath(); ctx.moveTo(box.left + 0.5, box.top); ctx.lineTo(box.left + 0.5, box.bottom + 0.5); ctx.lineTo(box.right, box.bottom + 0.5); ctx.stroke();
  if (yLabel) {
    ctx.save(); ctx.translate(9, (box.top + box.bottom) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = TEXT; ctx.globalAlpha = 0.8;
    ctx.fillText(yLabel, 0, 0); ctx.restore();
  }

  // Reference lines (FoS = 1).
  for (const r of refs) {
    if (!(r.value >= y0 && r.value <= y1)) continue;
    const y = Math.round(toY(r.value)) + 0.5;
    ctx.strokeStyle = r.colour || "#ff7b7b"; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke(); ctx.setLineDash([]);
    if (r.label) { ctx.fillStyle = r.colour || "#ff7b7b"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(r.label, box.right - 2, y - 1); }
  }

  // Now: the record to its left, the forecast to its right, shaded so the two
  // are never read as one kind of number.
  if (Number.isFinite(now) && now > t0 && now < t1) {
    const x = Math.round(toX(now)) + 0.5;
    ctx.fillStyle = "rgba(255, 211, 106, 0.06)"; ctx.fillRect(x, box.top, box.right - x, box.bottom - box.top);
    ctx.strokeStyle = "rgba(255, 211, 106, 0.8)"; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 211, 106, 0.95)"; ctx.textBaseline = "top";
    ctx.textAlign = "right"; ctx.fillText("record", x - 3, box.top + 1);
    ctx.textAlign = "left"; ctx.fillText("forecast", x + 3, box.top + 1);
  }

  // The frame on the globe.
  const vline = (k, colour, dash) => {
    if (!(k >= 0 && k < ms.length)) return;
    const x = Math.round(toX(ms[k])) + 0.5;
    ctx.strokeStyle = colour; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke(); ctx.setLineDash([]);
  };
  vline(marker, "rgba(255, 43, 214, 0.85)", []);
  if (hover !== marker) vline(hover, "rgba(207, 230, 238, 0.55)", [2, 3]);

  // The lines. A value above the range is drawn ON the top edge, with a tick,
  // rather than off the plot: "stable, off the scale" is still a reading.
  ctx.save();
  ctx.beginPath(); ctx.rect(box.left, box.top - 2, box.right - box.left, box.bottom - box.top + 4); ctx.clip();
  for (const l of lines) {
    ctx.strokeStyle = l.colour; ctx.lineWidth = l.bold ? 2.2 : 1.5;
    ctx.beginPath(); let pen = false;
    l.values.forEach((v, k) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      const x = toX(ms[k]); const y = toY(Math.min(v, y1));
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
    if (ms.length <= 90) {
      ctx.fillStyle = l.colour;
      l.values.forEach((v, k) => {
        if (!Number.isFinite(v)) return;
        ctx.beginPath(); ctx.arc(toX(ms[k]), toY(Math.min(v, y1)), v > y1 ? 1.2 : 1.8, 0, Math.PI * 2); ctx.fill();
      });
    }
  }
  ctx.restore();
  return layout;
}
