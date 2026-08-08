/**
 * Checks for dsp.js, against signals whose answers are known in advance.
 *
 *     node GeoID_GIS/viewer/gis/research/dsp.test.mjs
 *
 * No test runner: the repo has no build tooling, and these are assertions with
 * printed numbers, which is what makes a wrong answer readable rather than just
 * red. Every case here failed at least once during development.
 */
import * as dsp from "./dsp.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// 1. A 50 Hz sine must peak at 50 Hz, at its own amplitude.
const fs = 500, N = 4096;
const t = Array.from({ length: N }, (_, i) => i / fs);
const sine = t.map((x) => 3 * Math.sin(2 * Math.PI * 50 * x));
const { freqs, amps } = dsp.amplitudeSpectrum(sine, fs);
let peak = 0;
for (let i = 1; i < amps.length; i++) if (amps[i] > amps[peak]) peak = i;
check("FFT locates 50 Hz", Math.abs(freqs[peak] - 50) < fs / N * 2,
  `peak at ${freqs[peak].toFixed(2)} Hz`);
// 50 Hz sits at bin 409.6, so the tallest single bin under-reads it: that is
// scalloping, not an error, and the peak estimator is what corrects it.
const off = dsp.dominantPeak({ freqs, amps }, { signal: sine, fs });
check("interpolated peak recovers 50 Hz and amplitude 3",
  Math.abs(off.frequency - 50) < 0.05 && Math.abs(off.amplitude - 3) < 0.03,
  `${off.frequency.toFixed(3)} Hz, amplitude ${off.amplitude.toFixed(4)} `
  + `(tallest bin alone: ${amps[peak].toFixed(3)})`);

// On a frequency that lands exactly on a bin, the raw spectrum is already exact.
const onBin = 500 / 4096 * 410;
const exact = t.map((x) => 3 * Math.sin(2 * Math.PI * onBin * x));
const se = dsp.amplitudeSpectrum(exact, fs);
let ep = 1; for (let i = 2; i < se.amps.length; i++) if (se.amps[i] > se.amps[ep]) ep = i;
check("on-bin tone needs no correction", Math.abs(se.amps[ep] - 3) < 0.02,
  `got ${se.amps[ep].toFixed(4)} at ${se.freqs[ep].toFixed(3)} Hz`);

// 2. Two tones must give two peaks, not one.
const two = t.map((x) => Math.sin(2 * Math.PI * 20 * x) + 0.5 * Math.sin(2 * Math.PI * 120 * x));
const s2 = dsp.amplitudeSpectrum(two, fs);
const peaks = [];
for (let i = 2; i < s2.amps.length - 2; i++) {
  if (s2.amps[i] > 0.2 && s2.amps[i] > s2.amps[i-1] && s2.amps[i] >= s2.amps[i+1]) {
    peaks.push(+s2.freqs[i].toFixed(1));
  }
}
check("two tones resolved", peaks.length === 2
  && Math.abs(peaks[0]-20) < 1 && Math.abs(peaks[1]-120) < 1, `peaks ${peaks}`);

// 3. Parseval: Welch PSD integrated over frequency = signal variance.
function rng(seed){ let s=seed; return ()=> (s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff-0.5; }
const r = rng(42);
const noise = Array.from({ length: 1 << 15 }, () => r() * Math.sqrt(12)); // variance ~1
const wl = dsp.welch(noise, fs, { segment: 1024 });
const df = wl.freqs[1] - wl.freqs[0];
const integral = wl.psd.reduce((a, b) => a + b, 0) * df;
const variance = dsp.statistics(noise).std ** 2;
check("Welch PSD integrates to variance (Parseval)",
  Math.abs(integral - variance) / variance < 0.05,
  `integral ${integral.toFixed(4)} vs variance ${variance.toFixed(4)}`);

// 4. White noise PSD must be flat.
const mid = wl.psd.slice(5, wl.psd.length - 5);
const mp = mid.reduce((a,b)=>a+b,0)/mid.length;
const spread = Math.sqrt(mid.reduce((a,b)=>a+(b-mp)**2,0)/mid.length)/mp;
check("white-noise PSD is flat", spread < 0.35, `relative spread ${spread.toFixed(3)}`);

// 5. Cross-correlation finds a known delay.
const DELAY = 37;
const base = Array.from({ length: 2048 }, () => r());
const delayed = base.map((_, i) => (i >= DELAY ? base[i - DELAY] : 0));
const cc = dsp.crossCorrelation(base, delayed);
const best = dsp.bestLag(cc, fs);
check("cross-correlation finds a 37-sample delay", best.lagSamples === DELAY,
  `lag ${best.lagSamples} samples (${best.lagSeconds.toFixed(4)} s), r=${best.value.toFixed(3)}`);

// 6. A signal against itself: lag 0, correlation 1.
const self = dsp.bestLag(dsp.crossCorrelation(base, base), fs);
check("autocorrelation peaks at lag 0 with r=1",
  self.lagSamples === 0 && Math.abs(self.value - 1) < 1e-9,
  `lag ${self.lagSamples}, r=${self.value.toFixed(9)}`);

// 7. Band-pass keeps the wanted tone and removes the other.
const mixed = t.map((x) => Math.sin(2*Math.PI*10*x) + Math.sin(2*Math.PI*150*x));
const bp = dsp.bandpass(mixed, fs, { low: 5, high: 30 });
const bpSpec = dsp.amplitudeSpectrum(bp, fs);
const at = (f) => bpSpec.amps[Math.round(f / (fs / dsp.nextPowerOfTwo(N)))];
check("band-pass keeps 10 Hz, rejects 150 Hz",
  at(10) > 0.8 && at(150) < 0.02, `10Hz ${at(10).toFixed(3)}, 150Hz ${at(150).toFixed(4)}`);

// 8. Coherence: identical signals = 1, independent noise << 1.
const co1 = dsp.coherence(base, base, fs, { segment: 256 });
const meanCo1 = co1.values.reduce((a,b)=>a+b,0)/co1.values.length;
const other = Array.from({ length: base.length }, () => r());
const co2 = dsp.coherence(base, other, fs, { segment: 256 });
const meanCo2 = co2.values.reduce((a,b)=>a+b,0)/co2.values.length;
check("coherence is 1 for identical signals", Math.abs(meanCo1 - 1) < 1e-9,
  `mean ${meanCo1.toFixed(6)}`);
check("coherence is low for independent noise", meanCo2 < 0.35,
  `mean ${meanCo2.toFixed(3)} over ${co2.segments} segments`);

// 9. Spectrogram tracks a chirp upward in frequency.
const chirp = Array.from({ length: 8192 }, (_, i) => {
  const x = i / fs;
  return Math.sin(2 * Math.PI * (10 + 40 * (x / (8192 / fs))) * x);
});
const sg = dsp.spectrogram(chirp, fs, { segment: 256 });
const peakFreqAt = (col) => { let b=0; for (let k=1;k<col.length;k++) if (col[k]>col[b]) b=k;
  return sg.freqs[b]; };
const firstF = peakFreqAt(sg.grid[2]);
const lastF = peakFreqAt(sg.grid[sg.grid.length - 3]);
check("spectrogram follows a rising chirp", lastF > firstF + 20,
  `${firstF.toFixed(1)} Hz -> ${lastF.toFixed(1)} Hz over ${sg.grid.length} frames`);

// 10. Detrend removes a known linear ramp.
const ramp = Array.from({ length: 500 }, (_, i) => 5 + 0.3 * i + Math.sin(i / 10));
const flat = dsp.detrend(ramp, "linear");
check("linear detrend removes the ramp", Math.abs(dsp.mean(flat)) < 1e-9
  && Math.abs(flat[0] - flat[flat.length-1]) < 2,
  `mean ${dsp.mean(flat).toExponential(2)}`);

// 11. A tone riding a drift: the ramp must not become the "dominant" component.
//     This is the case the browser found and the pure-tone tests all missed.
const drifting = t.map((x, i) => 2.5 * Math.sin(2 * Math.PI * 3 * x) + 0.002 * i);
const ds = dsp.amplitudeSpectrum(drifting, fs);
const dp = dsp.dominantPeak(ds, { signal: drifting, fs });
check("drift does not masquerade as the dominant frequency",
  Math.abs(dp.frequency - 3) < 0.1 && Math.abs(dp.amplitude - 2.5) < 0.1,
  `${dp.frequency.toFixed(4)} Hz, amplitude ${dp.amplitude.toFixed(4)}`);

// 12. And with detrending off, the ramp genuinely does win -- so the default is
//     doing the work, not the test.
const raw = dsp.amplitudeSpectrum(drifting, fs, { detrendKind: "none" });
const rawPeak = dsp.dominantPeak(raw);
check("without detrending the ramp does dominate (control)", rawPeak.frequency < 1,
  `${rawPeak.frequency.toFixed(4)} Hz`);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
