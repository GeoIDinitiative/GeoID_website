/**
 * A seismogram and its spectrogram, drawn small enough to live in a popup.
 *
 * Clicking an earthquake used to give its magnitude, its depth and a link. The
 * thing an earthquake actually IS — ground moving, over about a minute, at
 * frequencies that say how far away it happened — was three panels and a form
 * away, and most people never got there. This draws it where the click was.
 *
 * Two pictures, because they answer different questions and neither answers
 * the other's. The **waveform** says when the ground moved and how hard: the P
 * arrival, the S arrival, the coda decaying away. The **spectrogram** says at
 * what frequencies, which is what separates a local quarry blast from a
 * teleseism — distance is a low-pass filter, so a far earthquake arrives with
 * its high frequencies stripped off no matter how large it was.
 *
 * The drawing is canvas; the parts worth being sure about are pure and tested
 * here — the envelope, which is what keeps a decimated trace honest, and the
 * decibel ramp.
 */

/**
 * Min and max per pixel column, which is the only honest way to draw a trace
 * narrower than its own sample count.
 *
 * A 30,000-sample record in a 300-pixel box is 100 samples a pixel. Taking
 * every hundredth sample — the obvious thing — is decimation without a filter,
 * and on a seismogram it does not merely look wrong: the P arrival is a few
 * samples wide, so sampling straight through it draws a flat line where the
 * earthquake is. **The peak has to survive.** Drawing the min and the max of
 * each column as a vertical bar keeps every excursion the record contains and
 * is what every seismic viewer does.
 */
export function envelope(values, columns) {
  const n = values?.length || 0;
  const cols = Math.max(1, Math.floor(columns) || 1);
  if (!n) return [];
  const out = new Array(Math.min(cols, n));
  const per = n / out.length;
  for (let c = 0; c < out.length; c += 1) {
    const from = Math.floor(c * per);
    // The last column runs to the end rather than to a rounded boundary, or
    // the final samples are dropped and a trace that ends on its peak lies.
    const to = c === out.length - 1 ? n : Math.max(from + 1, Math.floor((c + 1) * per));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i += 1) {
      const v = values[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[c] = [lo, hi];
  }
  return out;
}

/** The mean, for a trace whose counts sit on an instrument's own offset. */
export function meanOf(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return values.length ? sum / values.length : 0;
}

/**
 * The ramp a spectrogram is painted in: dark through indigo and magenta into
 * pale yellow, which is the viewer's own palette rather than a borrowed
 * viridis. Ordered by brightness, so it reads as intensity even where the hue
 * means nothing to somebody.
 */
export const DB_RAMP = [
  { t: 0.00, rgb: [10, 7, 19] },
  { t: 0.45, rgb: [59, 26, 107] },
  { t: 0.78, rgb: [255, 43, 214] },
  { t: 0.92, rgb: [255, 138, 92] },
  { t: 1.00, rgb: [255, 233, 168] },
];

/**
 * A decibel value to a colour.
 *
 * `dB` arrives relative to the loudest cell in the picture — 0 at the peak,
 * negative everywhere else — and the floor is where the ramp bottoms out. Sixty
 * decibels is a million to one in power, which is about the range a
 * seismogram's noise-to-signal spans; a shallower floor paints the background
 * noise as signal and a deeper one paints the earthquake as a thin line.
 *
 * **Most of the ramp is dark on purpose.** The stops are weighted low — magenta
 * does not arrive until 0.78 — because the interesting part of a seismogram is
 * the top 10 or 20 dB and everything below it is the ground being quiet. Spread
 * evenly, the first attempt painted a station's ordinary background noise in
 * full magenta and the picture read as "loud everywhere", with the earthquake a
 * slightly brighter patch inside it.
 */
export function dbColour(db, floorDb = -60) {
  const t = Math.max(0, Math.min(1, 1 - (Math.min(0, db) / floorDb)));
  const stops = DB_RAMP;
  if (t <= stops[0].t) return stops[0].rgb.slice();
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1].rgb.slice();
  for (let i = 1; i < stops.length; i += 1) {
    if (t > stops[i].t) continue;
    const a = stops[i - 1];
    const b = stops[i];
    const k = (t - a.t) / (b.t - a.t);
    return a.rgb.map((v, j) => Math.round(v + (b.rgb[j] - v) * k));
  }
  return stops[stops.length - 1].rgb.slice();
}

/**
 * How much of the spectrum to show.
 *
 * Nyquist is half the sample rate — 50 Hz on a 100 Hz channel — and a
 * seismogram has almost nothing up there: local earthquakes live below about
 * 20 Hz and distant ones below 2. Painting the full band spends three quarters
 * of the picture on an empty strip. Capped at 25 Hz, or Nyquist where that is
 * lower, and the axis says which.
 */
export function displayBand(sampleRate, cap = 25) {
  const nyquist = (Number(sampleRate) || 0) / 2;
  return Math.max(0, Math.min(nyquist, cap));
}

/* ── the drawing, which needs a canvas ────────────────────────────────────── */

/** Sizes a canvas to its own CSS box at the screen's pixel density. */
function fitCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || 240));
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height: cssHeight };
}

/**
 * The trace itself: a zero line and the min-max envelope around it.
 *
 * Detrended by its MEAN before anything else, because a channel's counts sit on
 * whatever offset its digitiser has — tens of thousands, often — and a trace
 * plotted raw is a flat line hard against one edge of the box.
 */
export function drawWaveform(canvas, values, { colour = "#52e4e8", height = 84 } = {}) {
  const { ctx, width, height: h } = fitCanvas(canvas, height);
  ctx.clearRect(0, 0, width, h);
  if (!values?.length) return;

  const mid = meanOf(values);
  const bars = envelope(values, width);
  let peak = 0;
  bars.forEach(([lo, hi]) => {
    peak = Math.max(peak, Math.abs(lo - mid), Math.abs(hi - mid));
  });
  if (!(peak > 0)) peak = 1;

  const centre = h / 2;
  // The scale leaves a hair of room, so the largest excursion is a peak rather
  // than a line clipped flat against the top of the box.
  const scale = (h / 2 - 2) / peak;

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centre + 0.5);
  ctx.lineTo(width, centre + 0.5);
  ctx.stroke();

  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  bars.forEach(([lo, hi], i) => {
    const x = i + 0.5;
    const top = centre - (hi - mid) * scale;
    const bottom = centre - (lo - mid) * scale;
    ctx.moveTo(x, top);
    // A column whose min and max are equal still has to draw something, or a
    // quiet stretch of a trace comes out as a gap rather than as a flat line.
    ctx.lineTo(x, Math.max(bottom, top + 0.6));
  });
  ctx.stroke();
}

/**
 * The spectrogram: time across, frequency up, power as colour.
 *
 * Painted through an ImageData at the grid's own resolution and then scaled by
 * the canvas, rather than a rectangle per cell: a 300-column grid is 30,000
 * fills, which is visible as a stutter inside a popup that is supposed to open
 * instantly.
 */
export function drawSpectrogram(canvas, spec, { sampleRate, height = 92, floorDb = -60 } = {}) {
  const { ctx, width, height: h } = fitCanvas(canvas, height);
  ctx.clearRect(0, 0, width, h);
  const grid = spec?.grid;
  if (!grid?.length || !grid[0]?.length) return null;

  const band = displayBand(sampleRate);
  const binHz = (Number(sampleRate) || 0) / 2 / grid[0].length;
  const rows = band > 0 && binHz > 0
    ? Math.max(1, Math.min(grid[0].length, Math.round(band / binHz)))
    : grid[0].length;

  const image = ctx.createImageData(grid.length, rows);
  for (let x = 0; x < grid.length; x += 1) {
    const column = grid[x];
    for (let y = 0; y < rows; y += 1) {
      // Frequency runs UP the picture, so the row is read from the bottom.
      const [r, g, b] = dbColour(column[rows - 1 - y], floorDb);
      const at = (y * grid.length + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = 255;
    }
  }
  // Through an offscreen canvas, because putImageData ignores the transform
  // and cannot scale -- it writes device pixels wherever it is told.
  const off = document.createElement("canvas");
  off.width = grid.length;
  off.height = rows;
  off.getContext("2d").putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, width, h);
  return { band, rows };
}
