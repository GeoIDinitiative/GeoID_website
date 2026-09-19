/**
 * THE TRANSIT SEQUENCE: plot, lock, run.
 *
 * Built from mock-up D, which put three earlier mock-ups together. It runs in
 * three acts:
 *
 *   0-3 s    the navigation chart: orbits drawn out, the transfer arc traced by
 *            the ship, the destination's name decoded letter by letter, and a
 *            ring closing onto the target -- LOCKED.
 *   3-6.6 s  the run: the chart falls away, Earth drops out of the corner, the
 *            starfield goes to warp and the worlds on the way sweep past.
 *   6.7-9 s  the arrival: the destination grows in out of focus and pulls
 *            sharp, and it IS the destination viewer -- the preloaded frame
 *            scaled up from a point, with a blur on it -- so the planet lands
 *            exactly where the viewer draws its globe, whatever the world, the
 *            window or the moment in its spin. Nothing is swapped at the end.
 *
 * THE RUN WAITS FOR THE VIEWER. The clock holds at the end of the cruise
 * (GATE) until the viewer has drawn a textured frame, the stars still
 * streaming, so a slow viewer means a longer cruise rather than an arrival at
 * a black frame. Capped, so a viewer that never draws is still handed over to.
 *
 * SOUND is synthesised here (no files): a deep pad and sub under the chart,
 * sonar on the lock, a boom and a roar into warp, a Doppler whoosh per flyby
 * and an impact and a wide chord on arrival, all through a long hall reverb.
 * The arrival is scheduled when the gate opens, so it lands on the planet
 * however long the hold was. localStorage "geoid:transit-sound" = "off" (or
 * the start screen's "geoid:boot-sound" = "off") mutes it.
 *
 * The page supplies the destination and the viewer hooks; this file owns the
 * picture, the words and the sound.
 */
(function () {
  "use strict";

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    inOut: (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
    out: (x) => 1 - Math.pow(1 - x, 3),
    outExpo: (x) => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
    in: (x) => x * x * x,
  };

  // Semi-major axes (AU), the order the worlds are passed in.
  const AU = { mercury: 0.387, venus: 0.723, earth: 1, mars: 1.524, jupiter: 5.203,
    saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
  // Flyby size (fraction of the frame's height at the passing distance).
  const FLY_R = { mercury: 0.1, venus: 0.15, mars: 0.14, jupiter: 0.42, saturn: 0.38,
    uranus: 0.26, neptune: 0.26 };

  // How far a ringed planet's rings reach, in globe radii (Saturn's A ring
  // edge is 2.27 R; Uranus's rings are narrow and faint).
  const RINGS = { saturn: 2.35, uranus: 1.7 };

  // THE ACTS. GATE is where the cruise holds for the viewer.
  const REVEAL = 3.2, GATE = 6.6, APPROACH = 6.75, SHARP = 8.2, HAND = 8.9;

  /** Hohmann transfer Δv (km/s) between two circular heliocentric orbits. */
  function hohmannDv(r1au, r2au) {
    const mu = 1.32712e11, au = 1.495979e8, r1 = r1au * au, r2 = r2au * au;
    const dv1 = Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    return Math.abs(dv1) + Math.abs(dv2);
  }

  /** The worlds strictly between Earth and the destination, at most three. */
  function flybysFor(key) {
    const to = AU[key];
    if (!to || key === "moon" || key === "earth") return [];
    const lo = Math.min(1, to), hi = Math.max(1, to);
    let between = Object.keys(FLY_R).filter((k) => AU[k] > lo && AU[k] < hi)
      .sort((a, b) => to > 1 ? AU[a] - AU[b] : AU[b] - AU[a]);
    // Pluto passes five worlds; three is what reads, so the giants win.
    if (between.length > 3) between = between.filter((k) => k !== "mars").slice(-3);
    return between;
  }

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
    s.pad(0, GATE + 1.6, { freqs: [55, 82.41, 110, 130.81], gain: 0.17, attack: 0.9, release: 1.6, lp0: 260, lp1: 1100, wet: 0.7 });
    s.tone(0, GATE + 1.4, { f0: 41.2, gain: 0.2, attack: 1.0, release: 1.2, wet: 0.2 });
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
    s.noise(REVEAL, GATE - REVEAL + 0.6, { type: "lowpass", f0: 70, f1: 240, q: 0.7, gain: 0.55, attack: 0.6, release: 0.8, wet: 0.3 });
    s.pad(3.3, GATE - 3.3 + 1.2, { freqs: [220, 329.63, 440, 659.25], gain: 0.07, attack: 1.4, release: 1.2, lp0: 500, lp1: 3200, wet: 0.9, spread: 18 });
    s.noise(3.3, 1.8, { f0: 180, f1: 3800, q: 0.9, gain: 0.4, attack: 1.5, release: 0.3, wet: 0.7 });
    s.noise(5.0, GATE - 5.0 + 0.6, { f0: 2200, f1: 1600, q: 0.8, gain: 0.32, attack: 0.3, release: 0.6, wet: 0.8 });
    [1318.5, 1975.5, 2637].forEach((f, i) => s.tone(3.8 + i * 0.25, GATE - 3.8, { f0: f, gain: 0.018, attack: 1.2, release: 1.0, vib: 8, vibRate: 5 + i, wet: 0.95 }));
    plan.flybys.forEach((fb) => {
      const side = fb.ox < 0 ? -1 : 1, big = FLY_R[fb.key] > 0.3;
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

  // ── the starfield: points in a tube, flown through ────────────────────
  function makeStars(n, seed) {
    let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: n }, () => {
      const a = rnd() * Math.PI * 2, r = 0.08 + Math.sqrt(rnd()) * 1.6;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: rnd(), b: 0.35 + rnd() * 0.65, s: 0.5 + rnd() * 1.4 };
    });
  }
  function drawStars(ctx, stars, dist, v, alpha, W, H, u) {
    const CX = W / 2, CY = H / 2, f = 260 * u;
    for (const st of stars) {
      const z = 1 - (((st.z + dist) % 1) + 1) % 1 + 0.02;
      const zt = Math.min(1.02, z + v * 0.05);
      const x = CX + st.x / z * f, y = CY + st.y / z * f;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const x0 = CX + st.x / zt * f, y0 = CY + st.y / zt * f;
      const near = clamp(1 - z);
      const a = st.b * clamp(0.25 + near * 1.1) * alpha;
      const lw = Math.max(0.6, st.s * (0.5 + near * 1.8) * Math.max(0.8, u));
      if (Math.hypot(x - x0, y - y0) > 1.5) {
        const g = ctx.createLinearGradient(x0, y0, x, y);
        g.addColorStop(0, "rgba(235,244,255,0)"); g.addColorStop(1, `rgba(235,244,255,${a})`);
        ctx.strokeStyle = g; ctx.lineWidth = lw; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(235,244,255,${a})`;
        ctx.beginPath(); ctx.arc(x, y, lw * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function loadImg(src) {
    const i = new Image(); i.decoding = "async"; i.src = src; return i;
  }
  const ready = (img) => img && img.complete && img.naturalWidth > 0;

  /**
   * start(config)
   *   key, name, km, etaDays, arrivalText, icons {key: url}
   *   hooks.reveal()          the viewer may start drawing (called once)
   *   hooks.viewerDrawn()     true once it has drawn a textured frame
   *   hooks.globeFraction()   the globe's radius as a fraction of frame height
   *   hooks.frame             the viewer iframe (scaled for the approach)
   *   hooks.crossover()       hand the page to the viewer
   */
  function start(config) {
    const { hooks } = config;
    const $ = (id) => document.getElementById(id);
    const back = $("tx-back"), front = $("tx-front"), hud = $("tx-hud");
    const bctx = back.getContext("2d"), fctx = front.getContext("2d");
    const key = config.key;
    const isMoon = key === "moon", isIss = key === "earth";
    const plot = !isIss;
    const destAu = isMoon ? null : AU[key];
    const flyKeys = flybysFor(key);
    // Spread over the cruise, alternating sides, the last clear of the gate.
    const flybys = flyKeys.map((k, i) => {
      const n = flyKeys.length, at = n === 1 ? 5.6 : lerp(4.95, 6.35, i / (n - 1));
      const left = i % 2 === 0;
      return { key: k, at, ox: left ? -0.95 : 1.05, oy: left ? 0.28 : -0.22, img: loadImg(config.icons[k]) };
    });
    const earthImg = loadImg("/assets/earth_icon.png");

    // ── words ──
    const NAME = config.name.toUpperCase();
    const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
    const dv = isMoon ? 3.1 : isIss ? 7.8 : hohmannDv(1, destAu);
    const logs = [];
    if (plot) {
      logs.push(["Reading ephemeris", "J2000"]);
      logs.push([`Solving transfer <em>Earth → ${config.name}</em>`, ""]);
      logs.push(["Δv budget", `${dv.toFixed(1)} km/s`]);
      logs.push(["Tracing arc", `${fmt(Math.round(config.etaDays))} days`]);
      logs.push([`Target locked <em>${config.name}</em>`, ""]);
    }
    logs.push(["Warp engaged", "OK"]);
    flybys.forEach((fb) => logs.push([`${fb.key[0].toUpperCase()}${fb.key.slice(1)} flyby`, `${AU[fb.key]} AU`]));
    logs.push(["Orbit insertion · handing over", ""]);
    const logAt = plot ? [0.2, 0.7, 1.3, 2.2, 2.95, 3.4] : [0.4];
    flybys.forEach((fb) => logAt.push(fb.at - 0.15));
    logAt.push(7.3);
    const logEl = $("tx-log");
    logEl.innerHTML = logs.map(([a, b]) => `<div>${a}${b ? ` <i>${b}</i>` : ""}</div>`).join("");
    const logLines = [...logEl.children];
    $("tx-cap").innerHTML = `<b>Transit · ${config.name}</b>${fmt(config.km)} km · ${config.etaText}<br><span class="n">Arrival · ${config.arrivalText}</span>`;
    const nameEl = $("tx-name"), subEl = $("tx-sub"), tagEl = $("tx-tag"), barEl = $("tx-bar");
    const brs = { tl: $("tx-br-tl"), tr: $("tx-br-tr"), bl: $("tx-br-bl"), br: $("tx-br-br") };
    const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/%";

    // ── the chart, in the mock-up's units about the frame centre ──
    const SUN = { x: -240, y: 40 }, K = 0.38, TH0 = Math.PI - 0.35, RMAX = 452;
    const orbitKeys = isMoon ? ["moon"] : Object.keys(AU).filter((k) => AU[k] <= Math.max(1, destAu || 1) + 1e-9);
    const auMax = isMoon ? 1 : Math.max(1, destAu);
    const radiusOf = (k) => isMoon ? (k === "moon" ? RMAX * 0.62 : 0) : RMAX * Math.sqrt(AU[k] / auMax);
    const centre = isMoon ? { x: -120, y: 40 } : SUN;
    const pt = (r, th) => ({ x: centre.x + r * Math.cos(th), y: centre.y + r * Math.sin(th) * K });
    const rE = isMoon ? 0 : radiusOf("earth"), rT = isMoon ? radiusOf("moon") : radiusOf(key);
    const target = pt(rT, TH0 + Math.PI);
    const arc = (u) => {
      if (isMoon) { const r = lerp(18, rT, ease.inOut(u)); return pt(r, TH0 + Math.PI * u); }
      const a = (rE + rT) / 2, e = Math.abs(rT - rE) / (rT + rE), ph = Math.PI * u;
      const r = a * (1 - e * e) / (1 + (rT >= rE ? 1 : -1) * e * Math.cos(ph));
      return pt(r, TH0 + ph);
    };

    // ── the run ──
    const speed = (t) => t < REVEAL ? (plot ? 0.07 : 0.4) : t < 4.3 ? lerp(plot ? 0.07 : 0.4, 1.7, ease.in(seg(t, REVEAL, 4.3)))
      : t < 6.9 ? 1.7 : lerp(1.7, 0.02, ease.out(seg(t, 6.9, 8.0)));
    let W = 0, H = 0, u = 1, stars = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight; u = Math.min(W / 1600, H / 785);
      for (const c of [back, front]) {
        c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
        c.style.width = `${W}px`; c.style.height = `${H}px`;
        c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      stars = makeStars(Math.round(clamp((W * H) / (1600 * 785), 0.35, 1.6) * 1150), 11);
      hud.style.setProperty("--u", String(Math.max(0.55, u)));
      document.documentElement.style.setProperty("--u", String(Math.max(0.55, u)));
    }
    resize();
    window.addEventListener("resize", resize);

    let frac = 0.3;             // the viewer's globe radius / frame height
    const planetR = (s) => frac * H * s;

    // ── the clock ──
    let t = 0, dist = 0, last = null, revealed = false, released = false, holdFrom = null;
    const holdCap = 9;          // seconds after the reveal, at most, to wait for a drawn frame
    let revealedAt = 0, done = false, raf = 0;
    let snd = null, sndHold = false, chromeShown = null;

    // ── sound ──
    function soundAt(tNow) {
      if (!soundAllowed() || snd) return;
      let ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_e) { return; }
      const go = () => {
        if (snd || done) return;
        snd = { ctx, run: Sound(ctx, tNow) };
        soundRun(snd.run, { plot, logAt, flybys });
      };
      if (ctx.state === "running") { go(); return; }
      // A browser that will not play before a gesture: start on the first one,
      // from wherever the sequence has got to.
      ctx.resume().then(() => { if (ctx.state === "running") go(); }).catch(() => {});
      const onGesture = () => {
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
        ctx.resume().then(() => {
          if (snd || done || ctx.state !== "running") return;
          snd = { ctx, run: Sound(ctx, t) };
          if (!released) soundRun(snd.run, { plot, logAt, flybys });
          else soundArrive(snd.run);
        }).catch(() => {});
      };
      window.addEventListener("pointerdown", onGesture, true);
      window.addEventListener("keydown", onGesture, true);
    }

    function approachStyle(frame, s, blurScreen, maskOpen, opacity) {
      frame.style.transformOrigin = "50% 50%";
      frame.style.transform = `scale(${s})`;
      const blurLocal = blurScreen > 0.3 ? Math.min(60, blurScreen / Math.max(s, 0.02)) : 0;
      frame.style.filter = blurLocal ? `blur(${blurLocal.toFixed(1)}px)` : "none";
      // A circle about the globe, in the frame's own pixels: the planet (and a
      // ringed planet's rings) and no more, so the viewer's own panels do not
      // show at the edge of the arrival. It opens like an iris at the end,
      // which is when the panels are meant to arrive.
      const inner = frac * H * (RINGS[key] || 1.1) * (1 + maskOpen * 4);
      const outer = inner + H * (0.06 + maskOpen * 2);
      const m = maskOpen >= 1 ? "none" : `radial-gradient(circle at 50% 50%, #000 ${inner.toFixed(0)}px, transparent ${outer.toFixed(0)}px)`;
      frame.style.webkitMaskImage = m; frame.style.maskImage = m;
      frame.style.opacity = String(opacity);
    }

    function frameStep(now) {
      if (done) return;
      const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000); last = now;
      let next = t + dt;
      // the reveal: the viewer is put in place (scaled to nothing) and told to draw
      if (!revealed && next >= REVEAL) { revealed = true; revealedAt = now; hooks.reveal(); approachStyle(hooks.frame, 0.004, 0, 0, 0); }
      // the gate: the cruise holds until the viewer has drawn
      if (!released && next >= GATE) {
        const ok = hooks.viewerDrawn() || (now - revealedAt) / 1000 > holdCap;
        if (!ok) {
          next = GATE;
          if (holdFrom == null) holdFrom = now;
          if (snd && !sndHold) { sndHold = true; soundHold(snd.run, t, 30); }
        } else {
          released = true;
          const f = hooks.globeFraction();
          if (f > 0.02 && f < 0.6) frac = f;
          if (snd) {
            if (sndHold) snd.run.silence(0.5);
            const again = Sound(snd.ctx, GATE); soundArrive(again); snd.run = again;
          }
        }
      }
      dist += speed(Math.min(next, released ? next : GATE)) * dt * 0.55;
      t = next;
      draw(t);
      if (t >= HAND) { finish(); return; }
      raf = requestAnimationFrame(frameStep);
    }

    function finish() {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      const f = hooks.frame;
      f.style.transform = ""; f.style.filter = ""; f.style.webkitMaskImage = ""; f.style.maskImage = "";
      hooks.crossover();
      if (snd && snd.ctx) setTimeout(() => { try { snd.ctx.close(); } catch (_e) {} }, 6000);
    }

    /** Jump to the gate (the Skip button). */
    function skip() {
      if (done) return;
      if (t < GATE - 0.2) { t = GATE - 0.2; if (snd) snd.run.silence(0.3); }
    }

    function drawChart(ctx) {
      const chartA = seg(t, 0.0, 0.5) * (1 - seg(t, 3.05, 3.6));
      if (!plot || chartA <= 0) return;
      ctx.save(); ctx.translate(W / 2, H / 2);
      const zoom = u * (1 + 0.25 * ease.in(seg(t, 3.05, 3.6)));
      ctx.scale(zoom, zoom); ctx.globalAlpha = chartA;
      const drawn = ease.out(seg(t, 0.05, 0.9));
      ctx.lineWidth = 1.2 / zoom;
      if (isMoon) {
        const g = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, 18);
        g.addColorStop(0, "rgba(120,200,255,1)"); g.addColorStop(1, "rgba(60,140,255,0)"); ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(centre.x, centre.y, 18, 0, Math.PI * 2); ctx.fill();
      }
      for (const k of orbitKeys) {
        const r = radiusOf(k);
        ctx.strokeStyle = k === key || (isMoon && k === "moon") ? "rgba(247,189,104,.75)" : k === "earth" ? "rgba(126,231,255,.7)" : "rgba(126,231,255,.22)";
        ctx.beginPath();
        for (let i = 0; i <= 180 * drawn; i += 1) { const q = pt(r, TH0 + (i / 180) * Math.PI * 2); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
        ctx.stroke();
      }
      if (!isMoon) {
        const g = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, 26);
        g.addColorStop(0, "rgba(255,230,170,1)"); g.addColorStop(1, "rgba(255,190,90,0)"); ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(centre.x, centre.y, 26, 0, Math.PI * 2); ctx.fill();
      }
      const p = ease.inOut(seg(t, 0.7, 2.9));
      ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,62,200,.35)"; ctx.beginPath();
      for (let i = 0; i <= 120; i += 1) { const q = arc(i / 120); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,62,200,.95)"; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i <= 120 * p; i += 1) { const q = arc(i / 120); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke();
      const sp = arc(p); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = "500 13px 'Exo 2', sans-serif"; ctx.fillStyle = "rgba(126,231,255,.9)";
      const ep = isMoon ? centre : pt(rE, TH0); ctx.fillText("EARTH", ep.x - 58, ep.y + 4);
      ctx.fillStyle = "rgba(247,189,104,.95)"; ctx.fillText(NAME, target.x + 14, target.y - 10);
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.fillText(`Δv ${dv.toFixed(1)} km/s · ${fmt(Math.round(p * config.etaDays))} / ${fmt(Math.round(config.etaDays))} d`, sp.x + 12, sp.y + 22);
      ctx.fillStyle = "rgba(247,189,104,1)"; ctx.beginPath(); ctx.arc(target.x, target.y, 5, 0, Math.PI * 2); ctx.fill();
      const close = seg(t, 2.5, 2.9), pulse = seg(t, 2.9, 3.4);
      if (close > 0 && close < 1) { ctx.strokeStyle = `rgba(247,189,104,${close})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(target.x, target.y, lerp(60, 10, ease.out(close)), 0, Math.PI * 2); ctx.stroke(); }
      if (pulse > 0 && pulse < 1) { ctx.strokeStyle = `rgba(247,189,104,${1 - pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(target.x, target.y, 10 + pulse * 60, 0, Math.PI * 2); ctx.stroke(); }
      if (t > 2.9) {
        ctx.strokeStyle = "rgba(247,189,104,.9)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(target.x, target.y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.font = "600 11px 'Exo 2', sans-serif"; ctx.fillStyle = "rgba(247,189,104,.95)"; ctx.fillText("LOCKED", target.x + 14, target.y + 14);
      }
      ctx.restore();
    }

    function drawImageFit(ctx, img, cx, cy, r) {
      // A planet image is r across at its WIDTH; a ringed or flattened icon
      // keeps its own aspect.
      const w = r * 2, h = w * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    }

    function draw(t) {
      const CX = W / 2, CY = H / 2, v = speed(released ? t : Math.min(t, GATE));
      bctx.fillStyle = "#030608"; bctx.fillRect(0, 0, W, H);
      drawStars(bctx, stars, dist, v, 1 - 0.55 * seg(t, 7.6, 8.6), W, H, u);
      drawChart(bctx);
      // Earth, falling away behind and below as the warp engages
      const ek = ease.in(seg(t, REVEAL - 0.05, 5.2));
      const ea = seg(t, REVEAL - 0.1, REVEAL + 0.3) * (1 - seg(t, 4.6, 5.2));
      if (!isIss && ea > 0 && ready(earthImg)) {
        const r = lerp(H * 1.05, H * 0.05, ek);
        bctx.globalAlpha = ea;
        bctx.drawImage(earthImg, lerp(-0.18 * W, -0.4 * W, ek) - r + W * 0.12, lerp(H * 0.72, H * 1.35, ek) - r * 0.2, r * 2, r * 2);
        bctx.globalAlpha = 1;
      }
      // the worlds on the way
      for (const fb of flybys) {
        const p = seg(t, fb.at - 1.3, fb.at + 0.1);
        if (p <= 0 || p >= 1 || !ready(fb.img)) continue;
        const z = lerp(7, 0.12, ease.in(p));
        const r = (FLY_R[fb.key] * H) / z, x = CX + (fb.ox * W * 0.5) / z, y = CY + (fb.oy * H * 0.5) / z;
        bctx.globalAlpha = seg(p, 0, 0.25);
        const st = 1 + 0.35 * seg(p, 0.75, 1);
        bctx.save(); bctx.translate(x, y); bctx.rotate(Math.atan2(y - CY, x - CX)); bctx.scale(st, 1);
        drawImageFit(bctx, fb.img, 0, 0, r); bctx.restore();
        bctx.globalAlpha = 1;
      }
      // the destination: the viewer itself, grown in and pulled sharp
      const s = lerp(0.004, 1, ease.outExpo(seg(t, APPROACH, SHARP)));
      if (released && hooks.chrome) {
        const show = t >= SHARP;
        if (show !== chromeShown) { chromeShown = show; hooks.chrome(show); }
      }
      if (released && hooks.frame) {
        const blur = lerp(16, 0, ease.inOut(seg(t, 7.35, SHARP)));
        approachStyle(hooks.frame, s, blur, ease.inOut(seg(t, SHARP, HAND)), seg(t, 6.7, 7.1));
      }
      // the flare crossing at the moment of focus, over the planet
      fctx.clearRect(0, 0, W, H);
      const fl = seg(t, 7.9, 8.55);
      if (fl > 0 && fl < 1) {
        const x = lerp(-0.25 * W, 1.15 * W, fl), al = Math.sin(fl * Math.PI) * 0.35;
        fctx.save(); fctx.transform(1, 0, -0.32, 1, 0, 0);
        const g = fctx.createLinearGradient(x - 160, 0, x + 160, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, `rgba(255,255,255,${al})`); g.addColorStop(1, "rgba(255,255,255,0)");
        fctx.fillStyle = g; fctx.fillRect(x - 160 + 0.32 * CY, 0, 320, H); fctx.restore();
      }
      // the back canvas steps aside as the viewer takes the whole frame
      back.style.opacity = String(1 - seg(t, SHARP, HAND));
      drawHud(t, s);
    }

    function drawHud(t, s) {
      const hudA = 1 - seg(t, 8.3, HAND);
      hud.style.opacity = String(hudA);
      logLines.forEach((el, i) => { el.style.opacity = String(clamp((t - (logAt[i] ?? 99)) / 0.15)); });
      barEl.style.width = `${clamp(t / HAND) * 100}%`;
      // brackets: from the frame's corners onto the planet
      const m = 34 * Math.max(0.6, u), k = ease.inOut(seg(t, 7.2, SHARP)), R = planetR(s) + 20;
      const box = { x0: lerp(m, W / 2 - R, k), y0: lerp(m, H / 2 - R, k), x1: lerp(W - m, W / 2 + R, k), y1: lerp(H - m, H / 2 + R, k) };
      const S = 42 * Math.max(0.6, u), ba = seg(t, 0.05, 0.4) * (1 - seg(t, 8.35, 8.85));
      const set = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = String(ba); };
      set(brs.tl, box.x0, box.y0); set(brs.tr, box.x1 - S, box.y0); set(brs.bl, box.x0, box.y1 - S); set(brs.br, box.x1 - S, box.y1 - S);
      // the name: decoded, then up and out of the way of the run
      let txt = "";
      for (let i = 0; i < NAME.length; i += 1) {
        const settle = 0.35 + i * (1.8 / Math.max(6, NAME.length));
        txt += t >= settle ? NAME[i] : t < 0.15 ? " " : GLYPHS[Math.floor((t * 23 + i * 7) % GLYPHS.length)];
      }
      nameEl.textContent = txt;
      const up = ease.inOut(seg(t, plot ? 3.0 : 1.6, plot ? 4.0 : 2.6));
      nameEl.style.transform = `translate(-50%,-60%) translateY(${-300 * up * Math.max(0.6, u)}px) scale(${lerp(1, 0.42, up)})`;
      nameEl.style.opacity = String(1 - seg(t, 8.0, 8.5));
      let line = plot ? `${isMoon ? "Translunar injection" : "Hohmann transfer"} · ${Math.round(ease.inOut(seg(t, 0.7, 2.9)) * 100)}%` : "orbit 408 km";
      if (plot && t > 2.9) line = "target locked";
      if (t > REVEAL) line = "engaging warp";
      if (t > 3.9 && !isIss) line = "departing Earth";
      for (const fb of flybys) if (t > fb.at - 0.9) line = `passing ${fb.key[0].toUpperCase()}${fb.key.slice(1)}`;
      if (t > 6.7) line = `${config.name} ${isMoon || isIss ? "approach" : "system"}`;
      if (!released && t >= GATE) line = `${config.name} ${isMoon || isIss ? "approach" : "system"} · viewer loading`;
      if (t > 7.5) line = "orbit insertion";
      subEl.textContent = line;
      subEl.style.transform = `translate(-50%,58px) translateY(${-338 * up * Math.max(0.6, u)}px)`;
      subEl.style.opacity = String(seg(t, 0.3, 0.8) * (1 - seg(t, 8.0, 8.5)));
      tagEl.textContent = plot && t < 2.9 ? "Plotting course" : "Trajectory locked";
      tagEl.style.opacity = String(seg(t, 0.2, 0.6) * (1 - up));
    }

    soundAt(0);
    const skipBtn = $("tx-skip");
    if (skipBtn) skipBtn.addEventListener("click", skip);
    raf = requestAnimationFrame(frameStep);
    const handle = { skip, state: () => ({ t, released, revealed, done, held: holdFrom != null, frac, sound: Boolean(snd) }) };
    window.GeoIDTransitSequence.current = handle;
    return handle;
  }

  window.GeoIDTransitSequence = { start, flybysFor, hohmannDv };
})();
