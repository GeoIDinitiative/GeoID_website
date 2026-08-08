/**
 * Signal processing, in plain JavaScript.
 *
 * No dependency: this repo has no build tooling, so a DSP library would have to
 * be hand-vendored as a browser build, and the handful of estimators actually
 * needed here are short enough to write and — more to the point — to check.
 * Every function below is verifiable against a signal whose answer is known in
 * advance, which is how they were developed.
 *
 * Conventions follow SciPy, because that is what the desktop app uses and
 * results are meant to be comparable: Welch PSD is one-sided and scaled by
 * 1/(fs·Σw²), spectrogram magnitudes are the same PSD per segment, and
 * correlation lags run negative-to-positive with lag 0 in the middle.
 */

// ── FFT ───────────────────────────────────────────────────────────────────────

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place iterative radix-2 Cooley-Tukey. Operates on separate real and
 * imaginary arrays to avoid allocating a complex object per sample.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fftInPlace(re, im) {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`fft length must be a power of two, got ${n}`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * One-sided amplitude spectrum.
 * @returns {{freqs: Float64Array, amps: Float64Array}} amps in the signal's own
 * units, so a sine of amplitude A peaks at A.
 */
export function amplitudeSpectrum(signal, fs, {
  window: windowName = "hann", detrendKind = "constant",
} = {}) {
  const n = signal.length;
  const size = nextPowerOfTwo(n);
  const w = makeWindow(windowName, n);
  // Detrended first, as welch already does. Real records drift -- a tilt or
  // tremor trace almost always carries an instrumental ramp -- and an
  // untreated ramp puts so much power near zero that it becomes the
  // "dominant" component and buries the signal that was actually asked about.
  const prepared = detrend(signal, detrendKind);
  // Coherent gain: a window scales the peak by its mean, so dividing it back
  // out keeps the reported amplitude in the signal's units.
  const gain = w.reduce((a, b) => a + b, 0) / n;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i += 1) re[i] = prepared[i] * w[i];
  fftInPlace(re, im);

  const half = size / 2;
  const freqs = new Float64Array(half);
  const amps = new Float64Array(half);
  for (let k = 0; k < half; k += 1) {
    freqs[k] = (k * fs) / size;
    const mag = Math.hypot(re[k], im[k]) / n / (gain || 1);
    // Everything but DC and Nyquist appears twice in a two-sided spectrum.
    amps[k] = (k === 0 || k === half) ? mag : mag * 2;
  }
  return { freqs, amps };
}

/**
 * The dominant peak, interpolated.
 *
 * A tone almost never lands exactly on a bin centre -- 50 Hz in a 4096-point
 * record at 500 Hz sits at bin 409.6 -- so its energy splits between neighbours
 * and the tallest single bin under-reads the true amplitude by up to 15% with a
 * Hann window. Fitting a parabola through the peak and its two neighbours (the
 * standard estimator) recovers both the frequency and the amplitude to well
 * under a percent, which is the difference between a tool that reports what is
 * there and one that quietly reports 2.7 for a signal of 3.
 */
export function dominantPeak(spectrum, { skipDc = 1, signal = null, fs = NaN } = {}) {
  const { freqs, amps } = spectrum;
  let k = skipDc;
  for (let i = skipDc; i < amps.length; i += 1) if (amps[i] > amps[k]) k = i;
  if (k <= 0 || k >= amps.length - 1) {
    return { frequency: freqs[k] ?? 0, amplitude: amps[k] ?? 0, bin: k };
  }
  const a = amps[k - 1];
  const b = amps[k];
  const c = amps[k + 1];
  const denom = a - 2 * b + c;
  // A flat or degenerate top means no interpolation to do.
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  const df = freqs[1] - freqs[0];
  const frequency = freqs[k] + shift * df;

  // Frequency interpolates well; amplitude does not. The parabola's vertex
  // assumes a shape the Hann main lobe does not have, and still under-reads by
  // about 5%. Given the signal, the amplitude is instead measured directly:
  // isolate the peak and take root-two times its RMS, which is exact for a
  // sinusoid however it falls between bins.
  let amplitude = b - 0.25 * (a - c) * shift;
  if (signal && Number.isFinite(fs)) {
    // Wide enough in *bins*, not just in hertz. A tenth of the frequency can
    // be two bins on a coarsely resolved record, which clips the main lobe and
    // under-reads the amplitude; six bins holds the lobe and its near leakage
    // whatever the resolution happens to be.
    const width = Math.max(6 * df, frequency * 0.1);
    const isolated = bandpass(signal, fs, {
      low: Math.max(0, frequency - width),
      high: frequency + width,
    });
    let power = 0;
    for (let i = 0; i < isolated.length; i += 1) power += isolated[i] * isolated[i];
    amplitude = Math.SQRT2 * Math.sqrt(power / isolated.length);
  }
  return { frequency, amplitude, bin: k + shift };
}

// ── Windows ───────────────────────────────────────────────────────────────────

export function makeWindow(name, n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = n === 1 ? 0 : i / (n - 1);
    switch (name) {
      case "hamming": w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * x); break;
      case "blackman":
        w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
        break;
      case "rect": case "boxcar": w[i] = 1; break;
      case "hann": default: w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * x); break;
    }
  }
  return w;
}

// ── Detrending and filtering ──────────────────────────────────────────────────

export function mean(values) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return values.length ? total / values.length : 0;
}

/** "constant" removes the mean; "linear" removes a least-squares straight line. */
export function detrend(signal, kind = "constant") {
  const n = signal.length;
  const out = new Float64Array(n);
  if (kind === "none") { out.set(signal); return out; }
  if (kind === "linear") {
    let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    for (let i = 0; i < n; i += 1) {
      sx += i; sy += signal[i]; sxx += i * i; sxy += i * signal[i];
    }
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    for (let i = 0; i < n; i += 1) out[i] = signal[i] - (slope * i + intercept);
    return out;
  }
  const m = mean(signal);
  for (let i = 0; i < n; i += 1) out[i] = signal[i] - m;
  return out;
}

/**
 * Zero-phase band-pass, by spectral masking rather than an IIR design.
 *
 * Chosen deliberately: an FFT mask has exactly zero phase distortion, which
 * matters when the point is to compare arrival times between stations, and it
 * needs no filter-design code to go wrong. The cost is edge effects on short
 * records, so the signal is detrended and tapered first.
 */
export function bandpass(signal, fs, { low = 0, high = Infinity } = {}) {
  const n = signal.length;
  const size = nextPowerOfTwo(n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const prepared = detrend(signal, "linear");
  for (let i = 0; i < n; i += 1) re[i] = prepared[i];
  fftInPlace(re, im);
  for (let k = 0; k <= size / 2; k += 1) {
    const f = (k * fs) / size;
    const keep = f >= low && f <= high;
    if (!keep) {
      re[k] = 0; im[k] = 0;
      // The mirrored negative frequency must go with it, or the result is
      // complex and the inverse transform leaves an imaginary residue.
      const mirror = (size - k) % size;
      re[mirror] = 0; im[mirror] = 0;
    }
  }
  // Inverse via conjugation, so there is only one transform to be right about.
  for (let i = 0; i < size; i += 1) im[i] = -im[i];
  fftInPlace(re, im);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = re[i] / size;
  return out;
}

// ── Welch PSD ─────────────────────────────────────────────────────────────────

/**
 * @returns {{freqs: Float64Array, psd: Float64Array}} one-sided power spectral
 * density in units²/Hz, matching scipy.signal.welch defaults.
 */
export function welch(signal, fs, {
  segment = 256, overlap = null, window: windowName = "hann", detrendKind = "constant",
} = {}) {
  const nper = Math.min(nextPowerOfTwo(segment), nextPowerOfTwo(signal.length));
  const step = nper - (overlap ?? Math.floor(nper / 2));
  const w = makeWindow(windowName, nper);
  // Noise-equivalent bandwidth: the density scaling SciPy uses.
  let winPower = 0;
  for (let i = 0; i < nper; i += 1) winPower += w[i] * w[i];
  const scale = 1 / (fs * winPower);

  const half = nper / 2;
  const psd = new Float64Array(half + 1);
  let segments = 0;
  for (let start = 0; start + nper <= signal.length; start += step) {
    const slice = detrend(signal.subarray
      ? signal.subarray(start, start + nper)
      : signal.slice(start, start + nper), detrendKind);
    const re = new Float64Array(nper);
    const im = new Float64Array(nper);
    for (let i = 0; i < nper; i += 1) re[i] = slice[i] * w[i];
    fftInPlace(re, im);
    for (let k = 0; k <= half; k += 1) {
      const power = (re[k] * re[k] + im[k] * im[k]) * scale;
      // One-sided: interior bins carry their mirror's power too.
      psd[k] += (k === 0 || k === half) ? power : power * 2;
    }
    segments += 1;
  }
  if (segments === 0) return { freqs: new Float64Array(0), psd: new Float64Array(0) };
  const freqs = new Float64Array(half + 1);
  for (let k = 0; k <= half; k += 1) {
    freqs[k] = (k * fs) / nper;
    psd[k] /= segments;
  }
  return { freqs, psd };
}

// ── Spectrogram ───────────────────────────────────────────────────────────────

/**
 * Short-time Fourier transform.
 * @returns {{times: Float64Array, freqs: Float64Array, grid: number[][]}}
 * grid[timeIndex][freqIndex], in dB relative to the strongest bin.
 */
export function spectrogram(signal, fs, {
  segment = 256, overlap = null, window: windowName = "hann", dB = true,
} = {}) {
  const nper = Math.min(nextPowerOfTwo(segment), nextPowerOfTwo(signal.length));
  const step = Math.max(1, nper - (overlap ?? Math.floor(nper * 0.75)));
  const w = makeWindow(windowName, nper);
  const half = nper / 2;
  const grid = [];
  const times = [];
  for (let start = 0; start + nper <= signal.length; start += step) {
    const re = new Float64Array(nper);
    const im = new Float64Array(nper);
    const slice = detrend(signal.slice(start, start + nper), "constant");
    for (let i = 0; i < nper; i += 1) re[i] = slice[i] * w[i];
    fftInPlace(re, im);
    const column = new Array(half);
    for (let k = 0; k < half; k += 1) {
      column[k] = Math.hypot(re[k], im[k]) / nper;
    }
    grid.push(column);
    times.push((start + nper / 2) / fs);
  }
  if (dB) {
    let peak = 0;
    grid.forEach((col) => col.forEach((v) => { if (v > peak) peak = v; }));
    const floor = peak * 1e-6 || 1e-12;
    grid.forEach((col) => {
      for (let k = 0; k < col.length; k += 1) {
        col[k] = 20 * Math.log10(Math.max(col[k], floor) / (peak || 1));
      }
    });
  }
  const freqs = new Float64Array(half);
  for (let k = 0; k < half; k += 1) freqs[k] = (k * fs) / nper;
  return { times: Float64Array.from(times), freqs, grid };
}

// ── Correlation and coherence ─────────────────────────────────────────────────

/**
 * Normalised cross-correlation over all lags, via FFT.
 * @returns {{lags: Float64Array, values: Float64Array}} lag in samples, positive
 * meaning `b` follows `a`.
 */
export function crossCorrelation(a, b, { normalise = true } = {}) {
  const n = Math.min(a.length, b.length);
  const x = detrend(a.slice(0, n), "constant");
  const y = detrend(b.slice(0, n), "constant");
  const size = nextPowerOfTwo(2 * n);

  const xr = new Float64Array(size); const xi = new Float64Array(size);
  const yr = new Float64Array(size); const yi = new Float64Array(size);
  xr.set(x); yr.set(y);
  fftInPlace(xr, xi);
  fftInPlace(yr, yi);
  // conj(X) * Y, so a positive lag means y lags x.
  const pr = new Float64Array(size);
  const pi = new Float64Array(size);
  for (let k = 0; k < size; k += 1) {
    pr[k] = xr[k] * yr[k] + xi[k] * yi[k];
    pi[k] = xr[k] * yi[k] - xi[k] * yr[k];
  }
  for (let k = 0; k < size; k += 1) pi[k] = -pi[k];
  fftInPlace(pr, pi);

  let norm = 1;
  if (normalise) {
    let sx = 0; let sy = 0;
    for (let i = 0; i < n; i += 1) { sx += x[i] * x[i]; sy += y[i] * y[i]; }
    norm = Math.sqrt(sx * sy) || 1;
  }
  const lags = new Float64Array(2 * n - 1);
  const values = new Float64Array(2 * n - 1);
  for (let i = 0; i < 2 * n - 1; i += 1) {
    const lag = i - (n - 1);
    lags[i] = lag;
    const index = ((lag % size) + size) % size;
    values[i] = pr[index] / size / norm;
  }
  return { lags, values };
}

/** The lag of the strongest correlation, in samples and in seconds. */
export function bestLag(correlation, fs) {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < correlation.values.length; i += 1) {
    if (correlation.values[i] > bestValue) { bestValue = correlation.values[i]; best = i; }
  }
  return {
    lagSamples: correlation.lags[best],
    lagSeconds: correlation.lags[best] / fs,
    value: bestValue,
  };
}

/** Magnitude-squared coherence, Welch-averaged. Runs 0..1 per frequency. */
export function coherence(a, b, fs, { segment = 256, window: windowName = "hann" } = {}) {
  const n = Math.min(a.length, b.length);
  const nper = Math.min(nextPowerOfTwo(segment), nextPowerOfTwo(n));
  const step = Math.floor(nper / 2);
  const w = makeWindow(windowName, nper);
  const half = nper / 2;
  const pxx = new Float64Array(half + 1);
  const pyy = new Float64Array(half + 1);
  const pxyRe = new Float64Array(half + 1);
  const pxyIm = new Float64Array(half + 1);
  let segments = 0;

  for (let start = 0; start + nper <= n; start += step) {
    const xs = detrend(a.slice(start, start + nper), "constant");
    const ys = detrend(b.slice(start, start + nper), "constant");
    const xr = new Float64Array(nper); const xi = new Float64Array(nper);
    const yr = new Float64Array(nper); const yi = new Float64Array(nper);
    for (let i = 0; i < nper; i += 1) { xr[i] = xs[i] * w[i]; yr[i] = ys[i] * w[i]; }
    fftInPlace(xr, xi);
    fftInPlace(yr, yi);
    for (let k = 0; k <= half; k += 1) {
      pxx[k] += xr[k] * xr[k] + xi[k] * xi[k];
      pyy[k] += yr[k] * yr[k] + yi[k] * yi[k];
      pxyRe[k] += xr[k] * yr[k] + xi[k] * yi[k];
      pxyIm[k] += xr[k] * yi[k] - xi[k] * yr[k];
    }
    segments += 1;
  }
  const freqs = new Float64Array(half + 1);
  const values = new Float64Array(half + 1);
  for (let k = 0; k <= half; k += 1) {
    freqs[k] = (k * fs) / nper;
    const denom = pxx[k] * pyy[k];
    values[k] = denom > 0 ? (pxyRe[k] * pxyRe[k] + pxyIm[k] * pxyIm[k]) / denom : 0;
  }
  return { freqs, values, segments };
}

// ── Descriptive statistics ────────────────────────────────────────────────────

export function statistics(signal) {
  const n = signal.length;
  if (!n) return null;
  const m = mean(signal);
  let variance = 0;
  let min = Infinity;
  let max = -Infinity;
  let rms = 0;
  for (let i = 0; i < n; i += 1) {
    const d = signal[i] - m;
    variance += d * d;
    rms += signal[i] * signal[i];
    if (signal[i] < min) min = signal[i];
    if (signal[i] > max) max = signal[i];
  }
  variance /= n > 1 ? n - 1 : 1;
  return {
    count: n,
    mean: m,
    std: Math.sqrt(variance),
    rms: Math.sqrt(rms / n),
    min,
    max,
    peakToPeak: max - min,
  };
}
