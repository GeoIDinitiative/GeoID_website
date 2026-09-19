/**
 * THE TRANSIT SEQUENCE, the page's half: plot, lock, run.
 *
 * The picture is drawn by transit-render.js, in a worker wherever the browser
 * has OffscreenCanvas (see that file for why: the destination viewer boots on
 * this page's main thread, in long blocking stretches, and nothing drawn here
 * could move while it did). This half owns what only the page can do:
 *
 *   - the reveal: the viewer is shown, scaled to nothing, and told to draw;
 *   - the gate: the picture's clock holds at the end of the cruise until the
 *     viewer has drawn a textured frame (capped 9 s after the reveal), and is
 *     then released with the globe's measured size;
 *   - the arrival: the viewer frame is scaled up from a point, blurred and
 *     masked to the planet, on the picture's own clock (its `tick`);
 *   - the sound, synthesised through a hall reverb and scheduled up front,
 *     so a busy main thread cannot make it stutter either;
 *   - the hand-over.
 *
 * localStorage "geoid:transit-sound" = "off" (or the start screen's
 * "geoid:boot-sound" = "off") mutes it.
 */
(function () {
  "use strict";

  const R = window.GeoIDTransitRender;
  const { GATE, REVEAL, HAND } = R;
  // This file's own stamp, carried to the worker and its import.
  const STAMP = (() => {
    try { return new URL(document.currentScript.src).search; } catch (_e) { return ""; }
  })();

  // ── the sound engine ──────────────────────────────────────────────────
  function Sound(ctx, shift) {
    const out = ctx.createGain(); out.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    out.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver();
    rev.buffer = (() => {
      const len = Math.floor(ctx.sampleRate * 5.5), b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c += 1) {
        const d = b.getChannelData(c); let lp = 0;
        for (let i = 0; i < len; i += 1) { const t = i / len; lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1); }
      }
      return b;
    })();
    const revGain = ctx.createGain(); revGain.gain.value = 0.9; rev.connect(revGain); revGain.connect(out);
    const noiseBuf = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i += 1) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
      return b;
    })();
    // `shift` is the sequence time this schedule starts at. A cue already
    // over is dropped; one under way is trimmed to begin now.
    const T0 = ctx.currentTime + 0.05;
    const at = (s) => T0 + (s - shift);
    const trim = (start, dur) => {
      if (start + dur <= shift + 0.02) return null;
      if (start >= shift) return [start, dur];
      return [shift, dur - (shift - start)];
    };
    const voices = [];
    function route(node, wet, pan0, pan1, start, dur) {
      const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan0, at(start)); p.pan.linearRampToValueAtTime(pan1, at(start + dur));
      node.connect(p); p.connect(out);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(rev); }
    }
    function env(g, start, dur, gain, attack, release) {
      attack = Math.min(attack, dur * 0.9); release = Math.min(release, dur - attack);
      g.gain.setValueAtTime(0.0001, at(start));
      g.gain.exponentialRampToValueAtTime(gain, at(start + Math.max(0.005, attack)));
      g.gain.setValueAtTime(gain, at(start + Math.max(attack, dur - release)));
      g.gain.exponentialRampToValueAtTime(0.0001, at(start + dur));
    }
    const api = {
      noise(start, dur, { type = "bandpass", f0 = 400, f1 = 2000, q = 1.2, gain = 0.4, attack = 0.2, release = 0.4, pan0 = 0, pan1 = 0, wet = 0 } = {}) {
        const tr = trim(start, dur); if (!tr) return; [start, dur] = tr;
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
        fl.frequency.setValueAtTime(f0, at(start)); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at(start + dur));
        const g = ctx.createGain(); env(g, start, dur, gain, attack, release);
        src.connect(fl); fl.connect(g); route(g, wet, pan0, pan1, start, dur); src.start(at(start)); src.stop(at(start + dur + 0.05));
        voices.push(src);
      },
      tone(start, dur, { type = "sine", f0 = 440, f1 = null, gain = 0.2, attack = 0.01, release = null, lp = null, wet = 0, pan0 = 0, pan1 = pan0, vib = 0, vibRate = 5 } = {}) {
        const tr = trim(start, dur); if (!tr) return; [start, dur] = tr;
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, at(start)); if (f1) o.frequency.exponentialRampToValueAtTime(f1, at(start + dur));
        if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(at(start)); l.stop(at(start + dur + 0.05)); voices.push(l); }
        const g = ctx.createGain();
        if (release == null) { g.gain.setValueAtTime(0.0001, at(start)); g.gain.exponentialRampToValueAtTime(gain, at(start + Math.max(0.005, Math.min(attack, dur * 0.9)))); g.gain.exponentialRampToValueAtTime(0.0001, at(start + dur)); }
        else env(g, start, dur, gain, attack, release);
        let node = o; if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); node = f; }
        node.connect(g); route(g, wet, pan0, pan1, start, dur); o.start(at(start)); o.stop(at(start + dur + 0.05));
        voices.push(o);
      },
      pad(start, dur, { freqs = [110], gain = 0.08, attack = 1.5, release = 1.5, lp0 = 300, lp1 = 1400, wet = 0.6, spread = 12 } = {}) {
        const tr = trim(start, dur); if (!tr) return; [start, dur] = tr;
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 0.8;
        f.frequency.setValueAtTime(lp0, at(start)); f.frequency.exponentialRampToValueAtTime(lp1, at(start + dur * 0.85));
        const g = ctx.createGain(); env(g, start, dur, gain, attack, release); f.connect(g); route(g, wet, 0, 0, start, dur);
        freqs.forEach((fr, i) => [-spread, 0, spread].forEach((dt, j) => {
          const o = ctx.createOscillator(); o.type = j === 1 ? "triangle" : "sawtooth"; o.frequency.value = fr; o.detune.value = dt + (i % 2 ? 3 : -3);
          const og = ctx.createGain(); og.gain.value = 1 / (freqs.length * 2.2); o.connect(og);
          const p = ctx.createStereoPanner(); p.pan.value = (j - 1) * 0.6; og.connect(p); p.connect(f);
          o.start(at(start)); o.stop(at(start + dur + 0.05)); voices.push(o);
        }));
      },
      blip(start, f = 1800, gain = 0.05, wet = 0.35) { api.tone(start, 0.06, { f0: f, gain, wet, attack: 0.004 }); },
      echo(start, f, gain = 0.25, wet = 0.8) {
        if (start < shift) return;
        const d = ctx.createDelay(); d.delayTime.value = 0.31; const fb = ctx.createGain(); fb.gain.value = 0.45;
        const damp = ctx.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 2400;
        d.connect(damp); damp.connect(fb); fb.connect(d);
        const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at(start)); g.gain.exponentialRampToValueAtTime(gain, at(start + 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, at(start + 1.2));
        o.connect(g); route(g, wet, 0, 0, start, 1.2); g.connect(d); route(d, wet * 0.8, 0, 0, start, 1.2); o.start(at(start)); o.stop(at(start + 1.3));
        voices.push(o);
      },
      impact(start, { f0 = 70, f1 = 28, gain = 0.6, dur = 2.5, wet = 0.7 } = {}) {
        if (start < shift) return;
        api.tone(start, dur, { f0, f1, gain, attack: 0.008, wet });
        api.noise(start, 0.9, { type: "lowpass", f0: 900, f1: 60, q: 0.7, gain: gain * 0.7, attack: 0.005, release: 0.8, wet });
      },
      /** Fade everything scheduled so far out, now. */
      silence(sec = 0.6) {
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, sec / 4);
      },
    };
    return api;
  }

  /** The chart, the lock and the run -- everything up to the gate. */
  function soundRun(s, plan) {
    const X = plan.extra || 0;
    s.pad(0, GATE + X + 1.6, { freqs: [55, 82.41, 110, 130.81], gain: 0.17, attack: 0.9, release: 1.6, lp0: 260, lp1: 1100, wet: 0.7 });
    s.tone(0, GATE + X + 1.4, { f0: 41.2, gain: 0.2, attack: 1.0, release: 1.2, wet: 0.2 });
    if (plan.plot) {
      s.noise(0, 3.4, { type: "highpass", f0: 3000, f1: 4500, q: 0.5, gain: 0.05, attack: 0.5, release: 0.8, wet: 0.6 });
      for (let k = 0; k < 22; k += 1) s.blip(0.15 + k * 0.065, 1400 + ((k * 397) % 1200), 0.03, 0.5);
      plan.logAt.slice(0, 5).forEach((t) => s.blip(t, 2349, 0.05, 0.6));
      s.tone(0.7, 2.2, { f0: 440, f1: 880, gain: 0.025, attack: 1.8, release: 0.3, wet: 0.8, vib: 6, vibRate: 7 });
      s.tone(2.5, 0.4, { f0: 800, f1: 1600, gain: 0.05, attack: 0.3, wet: 0.6 });
      s.echo(2.9, 1318.5, 0.3, 0.9); s.echo(3.08, 1760, 0.16, 0.9);
      s.impact(2.9, { f0: 95, f1: 45, gain: 0.35, dur: 1.6, wet: 0.8 });
    }
    s.impact(REVEAL + 0.05, { f0: 62, f1: 24, gain: 0.85, dur: 3.2, wet: 0.6 });
    s.noise(REVEAL, GATE + X - REVEAL + 0.6, { type: "lowpass", f0: 70, f1: 240, q: 0.7, gain: 0.55, attack: 0.6, release: 0.8, wet: 0.3 });
    s.pad(3.3, GATE + X - 3.3 + 1.2, { freqs: [220, 329.63, 440, 659.25], gain: 0.07, attack: 1.4, release: 1.2, lp0: 500, lp1: 3200, wet: 0.9, spread: 18 });
    s.noise(3.3, 1.8, { f0: 180, f1: 3800, q: 0.9, gain: 0.4, attack: 1.5, release: 0.3, wet: 0.7 });
    s.noise(5.0, GATE + X - 5.0 + 0.6, { f0: 2200, f1: 1600, q: 0.8, gain: 0.32, attack: 0.3, release: 0.6, wet: 0.8 });
    [1318.5, 1975.5, 2637].forEach((f, i) => s.tone(3.8 + i * 0.25, GATE + X - 3.8, { f0: f, gain: 0.018, attack: 1.2, release: 1.0, vib: 8, vibRate: 5 + i, wet: 0.95 }));
    plan.flybys.forEach((fb) => {
      const side = fb.ox < 0 ? -1 : 1, big = fb.big;
      s.noise(fb.at - 1.15, 1.4, { f0: big ? 380 : 500, f1: big ? 2200 : 2600, q: 2.2, gain: big ? 0.55 : 0.5, attack: 1.05, release: 0.3, pan0: 0, pan1: side, wet: 0.6 });
      s.tone(fb.at - 0.45, big ? 1.1 : 0.9, { type: "triangle", f0: big ? 120 : 190, f1: big ? 52 : 95, gain: big ? 0.14 : 0.09, attack: 0.3, pan0: side * 0.3, pan1: side, wet: 0.5 });
    });
  }

  /** The hold's bed: the cruise, sustained until the gate opens. */
  function soundHold(s, from, dur) {
    s.noise(from, dur, { f0: 1900, f1: 1700, q: 0.8, gain: 0.26, attack: 0.4, release: 0.5, wet: 0.8 });
    s.noise(from, dur, { type: "lowpass", f0: 180, f1: 200, q: 0.7, gain: 0.4, attack: 0.4, release: 0.5, wet: 0.3 });
    s.pad(from, dur, { freqs: [55, 82.41, 110, 130.81], gain: 0.15, attack: 0.5, release: 0.6, lp0: 900, lp1: 1000, wet: 0.7 });
  }

  /** Braking and the arrival, scheduled when the gate opens. */
  function soundArrive(s) {
    s.pad(GATE, HAND - GATE + 3, { freqs: [55, 82.41, 110], gain: 0.12, attack: 0.3, release: 2.2, lp0: 900, lp1: 500, wet: 0.7 });
    s.noise(6.9, 1.3, { f0: 3000, f1: 180, q: 1.2, gain: 0.28, attack: 0.1, release: 0.9, wet: 0.7 });
    s.noise(7.0, 0.92, { type: "highpass", f0: 800, f1: 7000, q: 0.6, gain: 0.22, attack: 0.88, release: 0.03, wet: 0.4 });
    s.impact(7.92, { f0: 55, f1: 26, gain: 0.95, dur: 4.2, wet: 0.8 });
    s.pad(7.92, 4.2, { freqs: [130.81, 196, 261.63, 329.63, 392], gain: 0.13, attack: 0.08, release: 3.0, lp0: 900, lp1: 3400, wet: 0.95, spread: 10 });
    s.noise(7.92, 3.2, { type: "highpass", f0: 5500, f1: 9000, q: 0.5, gain: 0.08, attack: 0.05, release: 2.6, wet: 0.95 });
    s.echo(8.0, 2093, 0.14, 0.95);
  }

  function soundAllowed() {
    try {
      return localStorage.getItem("geoid:transit-sound") !== "off" && localStorage.getItem("geoid:boot-sound") !== "off";
    } catch (_e) { return true; }
  }

  function start(config) {
    const { hooks } = config;
    const $ = (id) => document.getElementById(id);
    const back = $("tx-back"), front = $("tx-front");
    const plan = R.planFor(config);
    const canon = R.canonFor(plan.extra);
    let H = window.innerHeight;
    let frac = 0.3, lastT = 0, lastC = 0, released = false, revealed = false, done = false, chromeShown = null;
    let revealedAt = 0, snd = null, sndHold = false, worker = null, main = null;
    const state = { t: 0, released: false, revealed: false, done: false, frac: 0.3, sound: false, worker: false };

    // ── sound ──
    function soundStart() {
      if (!soundAllowed() || snd) return;
      let ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_e) { return; }
      const go = () => {
        if (snd || done) return;
        snd = { ctx, run: Sound(ctx, lastT) };
        soundRun(snd.run, plan);
      };
      if (ctx.state === "running") { go(); return; }
      ctx.resume().then(() => { if (ctx.state === "running") go(); }).catch(() => {});
      // A browser that will not play before a gesture: start on the first
      // one, from wherever the sequence has got to.
      const onGesture = () => {
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
        ctx.resume().then(() => {
          if (snd || done || ctx.state !== "running") return;
          if (!released) { snd = { ctx, run: Sound(ctx, lastT) }; soundRun(snd.run, plan); }
          else { snd = { ctx, run: Sound(ctx, canon(lastT)) }; soundArrive(snd.run); }
        }).catch(() => {});
      };
      window.addEventListener("pointerdown", onGesture, true);
      window.addEventListener("keydown", onGesture, true);
    }

    // ── the viewer's frame, for the arrival ──
    /**
     * THE GROWTH RUNS ON THE COMPOSITOR. The viewer does another burst of
     * main-thread work as it starts drawing in earnest -- 1.2-1.6 s tasks,
     * measured, exactly during the arrival -- so a scale written on each tick
     * would jump. At the release the scale, fade and blur are handed to a Web
     * Animation sampled from the same curve (approachAt), which the browser
     * runs off the main thread; only the mask, which opens at the very end,
     * is still written per tick.
     */
    let growth = null;
    function startGrowth(frame, c0) {
      const { APPROACH, SHARP } = R, N = 40, keys = [];
      for (let i = 0; i <= N; i += 1) {
        const a = R.approachAt(APPROACH + (i / N) * (SHARP - APPROACH));
        const blurLocal = a.blur > 0.3 ? Math.min(60, a.blur / Math.max(a.scale, 0.02)) : 0;
        keys.push({ offset: i / N, transform: `scale(${a.scale})`, opacity: a.opacity, filter: `blur(${blurLocal.toFixed(1)}px)` });
      }
      frame.style.transformOrigin = "50% 50%";
      frame.style.willChange = "transform, filter, opacity";
      try {
        growth = frame.animate(keys, { duration: (SHARP - APPROACH) * 1000, delay: Math.max(0, (APPROACH - c0) * 1000), fill: "both", easing: "linear" });
      } catch (_e) { growth = null; }
    }
    function maskStyle(frame, maskOpen) {
      const inner = frac * H * (R.RINGS[plan.key] || 1.1) * (1 + maskOpen * 4);
      const outer = inner + H * (0.06 + maskOpen * 2);
      const m = maskOpen >= 1 ? "none" : `radial-gradient(circle at 50% 50%, #000 ${inner.toFixed(0)}px, transparent ${outer.toFixed(0)}px)`;
      if (frame.style.maskImage !== m) { frame.style.webkitMaskImage = m; frame.style.maskImage = m; }
    }
    function approachStyle(frame, a) {
      const s = a.scale;
      frame.style.transformOrigin = "50% 50%";
      frame.style.willChange = "transform, filter, opacity";
      frame.style.transform = `scale(${s})`;
      const blurLocal = a.blur > 0.3 ? Math.min(60, a.blur / Math.max(s, 0.02)) : 0;
      frame.style.filter = blurLocal ? `blur(${blurLocal.toFixed(1)}px)` : "none";
      // A circle about the globe, in the frame's own pixels: the planet (and a
      // ringed planet's rings) and no more, so the viewer's own panels do not
      // show at the edge of the arrival. It opens like an iris at the end,
      // which is when the panels are meant to arrive.
      const inner = frac * H * (R.RINGS[plan.key] || 1.1) * (1 + a.maskOpen * 4);
      const outer = inner + H * (0.06 + a.maskOpen * 2);
      const m = a.maskOpen >= 1 ? "none" : `radial-gradient(circle at 50% 50%, #000 ${inner.toFixed(0)}px, transparent ${outer.toFixed(0)}px)`;
      frame.style.webkitMaskImage = m; frame.style.maskImage = m;
      frame.style.opacity = String(a.opacity);
    }

    function release() {
      if (released || done) return;
      released = true; state.released = true;
      const f = hooks.globeFraction();
      if (f > 0.02 && f < 0.6) frac = f;
      state.frac = frac;
      send({ type: "release", frac });
      maskStyle(hooks.frame, 0);
      startGrowth(hooks.frame, Math.max(lastC, GATE));
      if (snd) {
        if (sndHold) snd.run.silence(0.5);
        const again = Sound(snd.ctx, GATE); soundArrive(again); snd.run = again;
      }
    }

    function waitForViewer() {
      if (released || done) return;
      if (hooks.viewerDrawn() || (performance.now() - revealedAt) / 1000 > 9) { release(); return; }
      if (snd && !sndHold) { sndHold = true; soundHold(snd.run, lastT, 30); }
      setTimeout(waitForViewer, 100);
    }

    function finish() {
      if (done) return; done = true; state.done = true;
      window.removeEventListener("resize", onResize);
      const f = hooks.frame;
      if (growth) { try { growth.cancel(); } catch (_e) {} growth = null; }
      f.style.transform = ""; f.style.filter = ""; f.style.webkitMaskImage = ""; f.style.maskImage = ""; f.style.willChange = "";
      hooks.crossover();
      if (worker) setTimeout(() => worker.terminate(), 1000);
      if (snd && snd.ctx) setTimeout(() => { try { snd.ctx.close(); } catch (_e) {} }, 6000);
    }

    // What the picture says, whichever thread it is on.
    function on(m) {
      if (m.type === "tick") {
        lastT = m.t; lastC = m.c; state.t = m.t;
        if (m.approach) {
          if (hooks.chrome && m.approach.chrome !== chromeShown) { chromeShown = m.approach.chrome; hooks.chrome(chromeShown); }
          if (growth) maskStyle(hooks.frame, m.approach.maskOpen);
          else approachStyle(hooks.frame, m.approach);
        }
      } else if (m.type === "reveal") {
        if (revealed) return;
        revealed = true; state.revealed = true; revealedAt = performance.now();
        hooks.reveal();
        approachStyle(hooks.frame, { scale: 0.004, blur: 0, maskOpen: 0, opacity: 0 });
      } else if (m.type === "gate") {
        waitForViewer();
      } else if (m.type === "done") {
        finish();
      } else if (m.type === "started") {
        soundStart();
      }
    }
    function send(m) {
      if (worker) worker.postMessage(m);
      else if (main) {
        if (m.type === "release") main.release(m.frac);
        else if (m.type === "skip") main.skip();
        else if (m.type === "resize") main.resize(m.width, m.height, m.dpr);
      }
    }
    const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);
    // The corner buttons sit inside the drawn brackets, which scale with this.
    const setScale = () => document.documentElement.style.setProperty("--u",
      String(Math.max(0.55, Math.min(window.innerWidth / 1600, window.innerHeight / 785))));
    setScale();
    const sr = $("tx-sr");
    if (sr) sr.textContent = `Transit to ${config.name}, ${config.km.toLocaleString("en-US")} km. Arrival ${config.arrivalText}.`;
    function onResize() {
      H = window.innerHeight; setScale();
      send({ type: "resize", width: window.innerWidth, height: window.innerHeight, dpr: dprNow() });
    }

    // ── the picture: in a worker where it can be ──
    const cfg = { key: config.key, name: config.name, km: config.km, etaDays: config.etaDays,
      etaText: config.etaText, arrivalText: config.arrivalText, icons: config.icons };
    const offscreen = typeof OffscreenCanvas !== "undefined" && typeof back.transferControlToOffscreen === "function";
    if (offscreen) {
      try {
        worker = new Worker(`transit-render-worker.js${STAMP}`);
        const b = back.transferControlToOffscreen(), f = front.transferControlToOffscreen();
        worker.onmessage = (e) => on(e.data);
        worker.onerror = () => {};
        worker.postMessage({ type: "init", back: b, front: f, config: cfg,
          width: window.innerWidth, height: window.innerHeight, dpr: dprNow() }, [b, f]);
        state.worker = true;
      } catch (_e) { worker = null; }
    }
    if (!worker) {
      main = R.createRenderer({ back, front, config: cfg, emit: (type, data) => on({ type, ...data }) });
      main.resize(window.innerWidth, window.innerHeight, dprNow());
      const loop = (now) => { main.step(now); if (!main.state().done) requestAnimationFrame(loop); };
      const fonts = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 900))]) : Promise.resolve();
      fonts.then(() => { on({ type: "started" }); requestAnimationFrame(loop); });
    }
    window.addEventListener("resize", onResize);

    /** Jump to the gate (the Skip button). */
    function skip() {
      if (done) return;
      send({ type: "skip" });
      if (snd && !released) snd.run.silence(0.3);
    }
    const skipBtn = $("tx-skip");
    if (skipBtn) skipBtn.addEventListener("click", skip);

    const handle = { skip, state: () => ({ ...state, sound: Boolean(snd), c: lastC, held: revealed && !released && canon(lastT) >= GATE }) };
    window.GeoIDTransitSequence.current = handle;
    return handle;
  }

  window.GeoIDTransitSequence = { start, flybysFor: R.flybysFor, hohmannDv: R.hohmannDv };
})();
