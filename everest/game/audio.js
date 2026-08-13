/**
 * Sound, synthesised rather than sampled — no asset downloads, and wind that
 * responds continuously to speed instead of crossfading between three loops.
 *
 * Everything here is filtered noise and a couple of oscillators. That is
 * genuinely what this mountain sounds like: wind, your own breathing, and
 * crampons. There is no music above Base Camp.
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
  }

  /** Must be called from a user gesture — browsers will not start audio
   *  otherwise, and a silent game that gives no reason is a bug report. */
  start() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    const noise = this.noiseBuffer(ctx, 4);

    /* Wind: two bands. A low roar that carries the weight of it, and a high
       band that does the whistling — the ratio between them is what makes a
       gust sound like a gust rather than like the volume going up. */
    this.windLow = this.noiseVoice(ctx, noise, "lowpass", 220, 0.9);
    this.windHigh = this.noiseVoice(ctx, noise, "bandpass", 1400, 3.2);
    this.windLow.gain.connect(this.master);
    this.windHigh.gain.connect(this.master);

    /* Spindrift/snow hiss. */
    this.hiss = this.noiseVoice(ctx, noise, "highpass", 3800, 0.7);
    this.hiss.gain.connect(this.master);

    /* Breathing: a band of noise gated by an envelope, plus the regulator. */
    this.breath = this.noiseVoice(ctx, noise, "bandpass", 620, 1.6);
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breath.gain.disconnect();
    this.breath.gain.connect(this.breathGain);
    this.breathGain.connect(this.master);

    this.rumble = this.noiseVoice(ctx, noise, "lowpass", 90, 1.1);
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.gain.disconnect();
    this.rumble.gain.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);

    this.noise = noise;
    this.ready = true;
    this.lastStep = 0;
    this.breathPhase = 0;
  }

  noiseBuffer(ctx, seconds) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Slightly pink rather than white — white noise sounds like a hiss, and
    // wind is weighted toward the bottom.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    return buf;
  }

  noiseVoice(ctx, buffer, type, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true; src.start();
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter); filter.connect(gain);
    return { src, filter, gain };
  }

  set(param, value, time = 0.15) {
    if (!this.ready) return;
    param.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  /**
   * @param s {windMs, sheltered, precip, distress, speed, onSnow, o2Mask, rumble}
   */
  update(dt, s) {
    if (!this.ready || !this.enabled) return;
    const shelter = s.sheltered ? 0.25 : 1;
    const w = Math.min(1, s.windMs / 38);

    this.set(this.windLow.gain.gain, w * 0.55 * shelter, 0.25);
    this.set(this.windLow.filter.frequency, 120 + w * 340, 0.4);
    this.set(this.windHigh.gain.gain, Math.pow(w, 1.7) * 0.30 * shelter, 0.20);
    this.set(this.windHigh.filter.frequency, 900 + w * 2600, 0.3);
    this.set(this.hiss.gain.gain, Math.min(0.16, s.precip * 0.20) * shelter, 0.3);
    this.set(this.rumbleGain.gain, (s.rumble || 0) * 0.7, 0.2);

    /* Breathing. Faster and much louder the worse you are doing; through a
       mask it is a different, closer sound. Above 8,000 m without gas it is
       the only thing you can hear. */
    const rate = 0.35 + s.distress * 1.5 + Math.min(1, s.speed) * 0.5;
    this.breathPhase += dt * rate;
    const env = Math.max(0, Math.sin(this.breathPhase * Math.PI * 2));
    const level = (0.05 + s.distress * 0.30) * (s.o2Mask ? 1.25 : 1);
    this.breathGain.gain.value = env * env * level;
    this.set(this.breath.filter.frequency, s.o2Mask ? 420 : 700, 0.2);

    /* Crampons: one crunch per footfall, pitched at random so a walk cycle
       does not turn into a drum machine. */
    if (s.speed > 0.15) {
      const interval = 0.62 / Math.max(0.2, s.speed);
      this.lastStep += dt;
      if (this.lastStep > interval) { this.lastStep = 0; this.step(s.onSnow); }
    }
  }

  step(onSnow = true) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = onSnow ? "bandpass" : "highpass";
    f.frequency.value = onSnow ? 1500 + Math.random() * 900 : 2600;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t + Math.random() * 0.02);
    src.stop(t + 0.2);
  }

  /** One-shots. */
  cue(kind) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(this.master);

    if (kind === "flare") {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g); o.start(t); o.stop(t + 1.5);
      return;
    }
    if (kind === "crack" || kind === "serac" || kind === "collapse") {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.35;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = kind === "crack" ? 900 : 220;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === "crack" ? 0.4 : 0.55, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "crack" ? 0.9 : 3.6));
      src.connect(f); f.connect(g);
      src.start(t); src.stop(t + 4);
      return;
    }
    if (kind === "chime" || kind === "arrive") {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(kind === "arrive" ? 392 : 523.25, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); o.start(t); o.stop(t + 1.3);
    }
  }
}
