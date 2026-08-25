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

/* ── where the waves should arrive, and where one actually did ───────────── */

/**
 * A crustal velocity model, and a plain statement of what it is not.
 *
 * These are rule-of-thumb speeds, not a travel-time model. **Pg** — the direct
 * P wave through the upper crust — runs at about 6.0 km/s; past roughly 200 km
 * the first arrival is **Pn**, refracted along the top of the mantle at about
 * 8.0 km/s, which is why the crossover is here rather than one constant being
 * used throughout. S is taken as P over √3, the Poisson-solid ratio, which is
 * good to a few percent in ordinary crust.
 *
 * What this CANNOT do is a teleseism: past about 15° the ray turns deep into
 * the mantle, the speed rises with depth, and a straight-line divide is
 * nonsense. `arrivalTimes` therefore refuses beyond `MAX_MODEL_KM` rather than
 * drawing two lines somebody would read as fact.
 */
export const VELOCITY = { pgKmS: 6.0, pnKmS: 8.0, crossoverKm: 200, vpOverVs: Math.sqrt(3) };
export const MAX_MODEL_KM = 1500;

/**
 * Predicted P and S arrivals, in seconds from the start of the trace.
 *
 * Everything here is known independently of the waveform: the origin time and
 * hypocentre come from the USGS record, the station's position from the FDSN
 * station list, and the window start from the request that fetched the data.
 * That is what makes the markers worth drawing — they are a PREDICTION the
 * picture can be checked against, rather than a restatement of it.
 */
export function arrivalTimes({
  distanceKm, depthKm = 0, originMs, startMs, sampleRate, sampleCount,
} = {}) {
  /**
   * `Number(null)` is 0, not NaN — the same trap a blank station latitude set
   * once already, and worse here: a missing distance would come back as an
   * earthquake zero kilometres away, with P and S drawn confidently on top of
   * the origin time.
   */
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const surface = num(distanceKm);
  const origin = num(originMs);
  const start = num(startMs);
  if (!Number.isFinite(surface) || !Number.isFinite(origin) || !Number.isFinite(start)) return null;
  if (surface > MAX_MODEL_KM) return { tooFar: true, distanceKm: surface };
  // Hypocentral, not epicentral: a 600 km deep earthquake under a station 100
  // km away is 608 km of rock, and using the map distance would put the P
  // arrival most of a minute early.
  const depth = Math.max(0, Number(depthKm) || 0);
  const path = Math.sqrt(surface * surface + depth * depth);
  const vp = path > VELOCITY.crossoverKm ? VELOCITY.pnKmS : VELOCITY.pgKmS;
  const vs = vp / VELOCITY.vpOverVs;
  const offset = (origin - start) / 1000;
  const p = offset + path / vp;
  const sTime = offset + path / vs;
  const span = Number.isFinite(sampleRate) && Number.isFinite(sampleCount) && sampleRate > 0
    ? sampleCount / sampleRate
    : Infinity;
  return {
    p,
    s: sTime,
    // Whether they are inside the window that was fetched. Outside it there is
    // nothing to mark, and a line pinned to the edge of the picture would say
    // the wave arrived exactly there.
    inWindow: p >= 0 && p <= span,
    sInWindow: sTime >= 0 && sTime <= span,
    path,
    vp,
    model: `${vp.toFixed(1)} km/s P, ${vs.toFixed(1)} km/s S`,
  };
}

/**
 * The first onset in the trace, by the classic short-term/long-term average.
 *
 * The ratio of energy in a short window to energy in a long one jumps when a
 * wave arrives and is flat while the ground is merely noisy — which is what
 * makes it work regardless of how loud the station is. It is the detector every
 * seismic network has run for fifty years, and it is here because it is the one
 * thing on the picture MEASURED from the data: the P and S lines are a model,
 * and a model with nothing to check it against is decoration.
 *
 * Returns seconds from the start of the trace, or null when nothing crosses —
 * which is the honest answer for a trace that is all noise, and better than a
 * mark placed on the loudest piece of nothing.
 */
export function detectOnset(values, sampleRate, {
  staSeconds = 0.5, ltaSeconds = 10, threshold = 4, holdSeconds = 2, holdFactor = 0.6,
} = {}) {
  const fs = Number(sampleRate);
  const n = values?.length || 0;
  if (!Number.isFinite(fs) || fs <= 0 || n === 0) return null;
  const sta = Math.max(2, Math.round(staSeconds * fs));
  const lta = Math.max(sta * 3, Math.round(ltaSeconds * fs));
  const hold = Math.max(sta, Math.round(holdSeconds * fs));
  if (n < lta + sta) return null;

  // Squared deviation from the mean: the detector wants ENERGY, and a trace
  // sitting on a digitiser offset of forty thousand counts is all offset and
  // no energy until the mean comes off.
  const mid = meanOf(values);
  // Running sums rather than a window per sample: the naive form is O(n·lta),
  // which on a 30,000-sample trace at 100 Hz is 24 million operations inside a
  // popup that is meant to open at once.
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const d = values[i] - mid;
    cumulative[i + 1] = cumulative[i] + d * d;
  }
  const meanOver = (from, to) => (cumulative[to] - cumulative[from]) / (to - from);
  const ratioAt = (i) => {
    const longRun = meanOver(i - lta, i);
    return longRun > 0 ? meanOver(i, i + sta) / longRun : 0;
  };

  /**
   * A crossing is not enough on its own, and a real trace is what taught this.
   *
   * Measured on GE.MATE over an M4.4 in Albania: the ratio crossed 100 seconds
   * before the earthquake, on a tick in the station's own noise. STA/LTA is a
   * RELATIVE measure, so a small glitch in a very quiet minute is a large
   * ratio, and the first crossing of an ordinary record is routinely something
   * that is not the event.
   *
   * What separates them is DURATION: a tick is a few samples and is over; an
   * arrival stays elevated for seconds while the coda builds. So a candidate
   * has to hold most of its ratio across the next couple of seconds. That is
   * network practice -- trigger on, trigger off, minimum duration -- and it
   * needs no absolute scale, which matters because the traces this runs on
   * differ by orders of magnitude in counts.
   *
   * An earlier attempt used an absolute floor instead (a fraction of the
   * loudest short window anywhere in the trace) and was worse than useless: a
   * single-sample spike sets that floor, and on the same Albanian trace it
   * pushed the pick to 269 s, into the quiet after the coda had died away.
   */
  for (let i = lta; i + sta <= n; i += 1) {
    if (ratioAt(i) < threshold) continue;
    let held = true;
    const step = Math.max(1, Math.floor(sta / 2));
    for (let j = i; j <= i + hold && j + sta <= n; j += step) {
      if (ratioAt(j) < threshold * holdFactor) { held = false; break; }
    }
    if (held) return i / fs;
  }
  return null;
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
 * A vertical mark at a moment, labelled.
 *
 * Drawn over both pictures from the same list, because the waveform and the
 * spectrogram share one time axis and a reader compares them by eye: an S
 * arrival that lines up on one and not the other is worse than no mark at all.
 */
function drawMarks(ctx, marks, { width, height, seconds }) {
  if (!marks?.length || !(seconds > 0)) return;
  ctx.save();
  ctx.font = "600 9px 'Exo 2', system-ui, sans-serif";
  ctx.textBaseline = "top";
  /**
   * Labels take the first row they fit in.
   *
   * P, S and the measured onset are routinely seconds apart — at 240 km the
   * predicted P and S are 22 s apart on a 305 s trace, which is 20 pixels —
   * so at one height the later label simply paints over the earlier one and an
   * arrival appears to have no name. Measured on exactly that trace: "onset"
   * covered "S" completely.
   */
  const rows = [];
  marks.forEach((mark) => {
    const at = Number(mark.t);
    if (!Number.isFinite(at) || at < 0 || at > seconds) return;
    const x = Math.round((at / seconds) * width) + 0.5;
    ctx.strokeStyle = mark.colour;
    ctx.lineWidth = 1;
    // Dashed says PREDICTED and solid says measured, and the caption says which
    // is which -- two kinds of claim should not look identical.
    ctx.setLineDash(mark.dashed === false ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (!mark.label) return;
    ctx.setLineDash([]);
    const w = ctx.measureText(mark.label).width + 6;
    // The label flips to the left of its line near the right edge, or the last
    // arrival in a window has its name off the picture.
    const boxX = x + w + 2 > width ? x - w - 1 : x + 1;
    let row = rows.findIndex((used) => boxX > used);
    if (row === -1) { rows.push(0); row = rows.length - 1; }
    rows[row] = boxX + w + 2;
    const y = 1 + row * 12;
    // Never past the bottom of a short picture: better to overlap than to
    // write a label where it cannot be seen at all.
    if (y + 11 > height) return;
    ctx.fillStyle = "rgba(6, 8, 16, 0.72)";
    ctx.fillRect(boxX, y, w, 12);
    ctx.fillStyle = mark.colour;
    ctx.fillText(mark.label, boxX + 3, y + 1);
  });
  ctx.restore();
}

/**
 * The trace itself: a zero line and the min-max envelope around it.
 *
 * Detrended by its MEAN before anything else, because a channel's counts sit on
 * whatever offset its digitiser has — tens of thousands, often — and a trace
 * plotted raw is a flat line hard against one edge of the box.
 */
export function drawWaveform(canvas, values, {
  colour = "#52e4e8", height = 84, marks = null, sampleRate = null,
} = {}) {
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

  drawMarks(ctx, marks, {
    width, height: h, seconds: sampleRate > 0 ? values.length / sampleRate : 0,
  });
}

/**
 * The spectrogram: time across, frequency up, power as colour.
 *
 * Painted through an ImageData at the grid's own resolution and then scaled by
 * the canvas, rather than a rectangle per cell: a 300-column grid is 30,000
 * fills, which is visible as a stutter inside a popup that is supposed to open
 * instantly.
 */
export function drawSpectrogram(canvas, spec, {
  sampleRate, height = 92, floorDb = -60, marks = null, seconds = 0,
} = {}) {
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
  // The same marks, on the same axis. The spectrogram's own time axis is a
  // little shorter than the trace's -- an STFT column is centred inside a
  // window, so it starts half a window in and ends half a window early -- but
  // it is DRAWN across the full width, so the marks use the trace's own span
  // and land where a reader expects them.
  drawMarks(ctx, marks, { width, height: h, seconds });
  return { band, rows };
}
