/**
 * Plots, drawn to a canvas.
 *
 * Small on purpose: line, scatter and heatmap are what the Plotter and the
 * signal pages need, and pulling in a charting library would mean vendoring a
 * browser build of it in a repo that has no build tooling. Everything here
 * takes plain arrays and returns a canvas, so a figure can be written straight
 * into the project's figures/ folder.
 */

const AXIS = "rgba(151, 182, 194, 0.55)";
const GRID = "rgba(151, 182, 194, 0.14)";
const TEXT = "#cfe6ee";
const SERIES = ["var(--skin-data)", "var(--skin-chrome)", "#9df58a", "#ffd36a", "#8ab6ff", "#ff8b8b"];

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}

function format(value) {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return value.toExponential(1);
  return String(Math.round(value * 1000) / 1000);
}

function extent(values, pad = 0.04) {
  let min = Infinity;
  let max = -Infinity;
  values.forEach((v) => {
    if (!Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  });
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (min === max) { min -= 0.5; max += 0.5; }
  const room = (max - min) * pad;
  return [min - room, max + room];
}

function frame(ctx, box, xRange, yRange, labels) {
  const { left, top, width, height } = box;
  ctx.strokeStyle = AXIS;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = 1;
  ctx.font = "11px 'Exo 2', system-ui, sans-serif";

  const xStep = niceStep(xRange[1] - xRange[0], 6);
  const yStep = niceStep(yRange[1] - yRange[0], 5);
  const toX = (v) => left + ((v - xRange[0]) / (xRange[1] - xRange[0])) * width;
  const toY = (v) => top + height - ((v - yRange[0]) / (yRange[1] - yRange[0])) * height;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let v = Math.ceil(xRange[0] / xStep) * xStep; v <= xRange[1]; v += xStep) {
    const x = toX(v);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
    ctx.fillText(format(v), x, top + height + 5);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = Math.ceil(yRange[0] / yStep) * yStep; v <= yRange[1]; v += yStep) {
    const y = toY(v);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke();
    ctx.fillText(format(v), left - 6, y);
  }
  ctx.strokeStyle = AXIS;
  ctx.strokeRect(left, top, width, height);

  if (labels?.x) {
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(labels.x, left + width / 2, top + height + 34);
  }
  if (labels?.y) {
    ctx.save();
    ctx.translate(left - 44, top + height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(labels.y, 0, 0);
    ctx.restore();
  }
  return { toX, toY };
}

function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  // Drawn at device resolution so an exported figure is not soft.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/**
 * @param {Array<{x:number[], y:number[], name?:string, mode?:"line"|"scatter"}>} series
 */
export function linePlot(series, {
  width = 720, height = 320, labels = {}, title = "",
} = {}) {
  const { canvas, ctx } = newCanvas(width, height);
  const box = { left: 62, top: title ? 26 : 12, width: width - 82, height: height - (title ? 74 : 60) };
  const allX = series.flatMap((s) => s.x);
  const allY = series.flatMap((s) => s.y);
  const xRange = extent(allX, 0.01);
  const yRange = extent(allY);

  if (title) {
    ctx.fillStyle = TEXT;
    ctx.font = "12px 'Exo 2', system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(title, box.left, 8);
  }
  const { toX, toY } = frame(ctx, box, xRange, yRange, labels);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();
  series.forEach((s, i) => {
    const colour = SERIES[i % SERIES.length];
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 1.4;
    if (s.mode === "scatter") {
      for (let k = 0; k < s.x.length; k += 1) {
        ctx.beginPath();
        ctx.arc(toX(s.x[k]), toY(s.y[k]), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.mode === "bar") {
      // A histogram drawn as a line is a different chart, and reads as one:
      // the bars are what say "these are counts in bins".
      const zero = toY(0);
      const step = s.x.length > 1
        ? Math.abs(toX(s.x[1]) - toX(s.x[0]))
        : box.width / 8;
      const barWidth = Math.max(1, step * 0.86);
      ctx.globalAlpha = 0.55;
      for (let k = 0; k < s.x.length; k += 1) {
        if (!Number.isFinite(s.y[k])) continue;
        const py = toY(s.y[k]);
        ctx.fillRect(toX(s.x[k]) - barWidth / 2, Math.min(py, zero),
                     barWidth, Math.abs(zero - py));
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < s.x.length; k += 1) {
        if (!Number.isFinite(s.y[k])) { started = false; continue; }
        const px = toX(s.x[k]);
        const py = toY(s.y[k]);
        if (started) ctx.lineTo(px, py);
        else { ctx.moveTo(px, py); started = true; }
      }
      ctx.stroke();
    }
  });
  ctx.restore();

  // Legend, only when there is more than one thing to tell apart.
  if (series.length > 1) {
    ctx.font = "11px 'Exo 2', system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    let x = box.left;
    series.forEach((s, i) => {
      const colour = SERIES[i % SERIES.length];
      ctx.fillStyle = colour;
      ctx.fillRect(x, height - 14, 10, 3);
      ctx.fillStyle = TEXT;
      const label = s.name || `series ${i + 1}`;
      ctx.fillText(label, x + 14, height - 12);
      x += 24 + ctx.measureText(label).width;
    });
  }
  return canvas;
}

/** Blue-to-hot ramp, dark where there is nothing. */
function heatColour(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const stops = [
    [8, 12, 32], [16, 60, 128], [30, 150, 170],
    [150, 210, 120], [250, 200, 80], [255, 90, 60],
  ];
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},`
    + `${Math.round(a[1] + (b[1] - a[1]) * f)},`
    + `${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/**
 * Spectrogram-style heatmap.
 * @param {number[][]} grid  grid[timeIndex][freqIndex]
 */
export function heatmap(grid, {
  width = 720, height = 320, xRange = [0, 1], yRange = [0, 1], labels = {}, title = "",
} = {}) {
  const { canvas, ctx } = newCanvas(width, height);
  const box = { left: 62, top: title ? 26 : 12, width: width - 82, height: height - (title ? 74 : 60) };
  if (title) {
    ctx.fillStyle = TEXT;
    ctx.font = "12px 'Exo 2', system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(title, box.left, 8);
  }

  let min = Infinity;
  let max = -Infinity;
  grid.forEach((col) => col.forEach((v) => {
    if (!Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  }));
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  const span = max - min || 1;

  const cols = grid.length;
  const rows = cols ? grid[0].length : 0;
  const cw = box.width / Math.max(1, cols);
  const ch = box.height / Math.max(1, rows);
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      ctx.fillStyle = heatColour((grid[i][j] - min) / span);
      // Low frequency at the bottom, as a spectrogram is normally read.
      ctx.fillRect(box.left + i * cw, box.top + box.height - (j + 1) * ch,
        Math.ceil(cw), Math.ceil(ch));
    }
  }
  frame(ctx, box, xRange, yRange, labels);
  return canvas;
}

/** A canvas as a PNG blob, for writing into the project's figures/. */
export function toPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
