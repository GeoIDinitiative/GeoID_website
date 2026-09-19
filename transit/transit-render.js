/**
 * THE TRANSIT PICTURE, drawn off the main thread.
 *
 * The destination viewer loads in a same-origin iframe, and a same-origin
 * iframe shares the page's main thread. Its boot blocks that thread in long
 * stretches -- measured on Saturn, 3.7 s then 0.8, 0.85 and 0.5 s, all during
 * the chart and the start of the warp -- and every one froze a sequence drawn
 * on the main thread. So everything that moves is drawn HERE, on two
 * OffscreenCanvases in a worker (transit-render-worker.js): the stars, the
 * chart, Earth, the flybys, the flare AND the words, the brackets and the
 * progress bar. The main thread only reveals the viewer, decides when it has
 * drawn, scales it in for the arrival and plays the sound -- none of which
 * needs a frame from it while the viewer is booting.
 *
 * Where OffscreenCanvas is missing the same renderer runs on the main thread
 * (transit-sequence.js), exactly as before.
 *
 * The clock is owned here. It HOLDS at the gate until the page says the
 * viewer has drawn (`release`), and it runs on a canonical time that pauses
 * mid-warp for the extra flybys (see planFor).
 */
(function (root) {
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

  // THE ACTS, on the canonical clock. GATE is where the cruise holds.
  const REVEAL = 3.2, GATE = 6.6, APPROACH = 6.75, SHARP = 8.2, HAND = 8.9, CRUISE = 5.3;

  /** Hohmann transfer Δv (km/s) between two circular heliocentric orbits. */
  function hohmannDv(r1au, r2au) {
    const mu = 1.32712e11, au = 1.495979e8, r1 = r1au * au, r2 = r2au * au;
    const dv1 = Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    return Math.abs(dv1) + Math.abs(dv2);
  }

  /** Every world strictly between Earth and the destination, in the order passed. */
  function flybysFor(key) {
    const to = AU[key];
    if (!to || key === "moon" || key === "earth") return [];
    const lo = Math.min(1, to), hi = Math.max(1, to);
    return Object.keys(FLY_R).filter((k) => AU[k] > lo && AU[k] < hi)
      .sort((a, b) => to > 1 ? AU[a] - AU[b] : AU[b] - AU[a]);
  }

  /**
   * The timetable, shared by the picture (here) and the sound (the page), so
   * a whoosh lands on its flyby and a log line on its beat.
   *
   * THE CRUISE STRETCHES FOR THE WORLDS ON THE WAY. Up to three fit it as it
   * is; more are spaced 0.8 s apart and everything but the flybys runs on a
   * canonical clock that pauses at CRUISE for EXTRA seconds, mid-warp, when
   * nothing but the stars and the flybys is moving (Pluto: +1.8 s).
   */
  function planFor(config) {
    const key = config.key;
    const isMoon = key === "moon", isIss = key === "earth", plot = !isIss;
    const keys = flybysFor(key);
    const flybys = keys.map((k, i) => {
      const n = keys.length, at = n === 1 ? 5.6 : n <= 3 ? lerp(4.95, 6.35, i / (n - 1)) : 4.95 + 0.8 * i;
      const left = i % 2 === 0;
      return { key: k, at, ox: left ? -0.95 : 1.05, oy: left ? 0.28 : -0.22, big: FLY_R[k] > 0.3 };
    });
    const extra = Math.max(0, (flybys.length ? flybys[flybys.length - 1].at : 0) - 6.35);
    const logAt = plot ? [0.2, 0.7, 1.3, 2.2, 2.95, 3.4] : [0.4];
    flybys.forEach((fb) => logAt.push(fb.at - 0.15));
    logAt.push(7.3 + extra);
    return { key, isMoon, isIss, plot, flybys, extra, logAt };
  }
  const canonFor = (extra) => (x) => x < CRUISE ? x : x < CRUISE + extra ? CRUISE : x - extra;

  /** The arrival's frame style at canonical time c (applied by the page). */
  function approachAt(c) {
    return {
      scale: lerp(0.004, 1, ease.outExpo(seg(c, APPROACH, SHARP))),
      blur: lerp(16, 0, ease.inOut(seg(c, 7.35, SHARP))),
      maskOpen: ease.inOut(seg(c, SHARP, HAND)),
      opacity: seg(c, 6.7, 7.1),
      chrome: c >= SHARP,
    };
  }

  // ── the starfield: points in a tube, flown through ────────────────────
  function makeStars(n, seed) {
    let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: n }, () => {
      const a = rnd() * Math.PI * 2, r = 0.08 + Math.sqrt(rnd()) * 1.6;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z: rnd(), b: 0.35 + rnd() * 0.65, s: 0.5 + rnd() * 1.4 };
    });
  }
  /**
   * A streak is a faint tail and a bright head -- two strokes -- rather than a
   * gradient per star: 1,800 gradient objects a frame was most of the frame.
   */
  function drawStars(ctx, stars, dist, v, alpha, W, H, u) {
    const CX = W / 2, CY = H / 2, f = 260 * u;
    ctx.lineCap = "round";
    for (const st of stars) {
      const z = 1 - (((st.z + dist) % 1) + 1) % 1 + 0.02;
      const zt = Math.min(1.02, z + v * 0.05);
      const x = CX + st.x / z * f, y = CY + st.y / z * f;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const x0 = CX + st.x / zt * f, y0 = CY + st.y / zt * f;
      const near = clamp(1 - z);
      const a = st.b * clamp(0.25 + near * 1.1) * alpha;
      const lw = Math.max(0.6, st.s * (0.5 + near * 1.8) * Math.max(0.8, u));
      if (Math.abs(x - x0) + Math.abs(y - y0) > 2) {
        const mx = (x0 + x) / 2, my = (y0 + y) / 2;
        ctx.lineWidth = lw;
        ctx.strokeStyle = `rgba(235,244,255,${(a * 0.28).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(mx, my); ctx.stroke();
        ctx.strokeStyle = `rgba(235,244,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(x, y); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(235,244,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, lw * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  async function loadBitmap(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await createImageBitmap(await res.blob());
    } catch (_e) { return null; }
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }

  const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/%";
  const DATA = "#7ee7ff", GOLD = "#f7bd68", INK = "#fdf7ff";

  /**
   * createRenderer({ back, front, config, emit })
   *   back, front  canvases (Offscreen in a worker, elements on the page)
   *   config       key, name, km, etaDays, etaText, arrivalText, icons
   *   emit(type, data)   "reveal", "gate", "tick", "done"
   */
  function createRenderer({ back, front, config, emit }) {
    const plan = planFor(config);
    const { key, isMoon, isIss, plot, flybys, extra: EXTRA, logAt } = plan;
    const canon = canonFor(EXTRA);
    const destAu = isMoon ? null : AU[key];
    const bctx = back.getContext("2d"), fctx = front.getContext("2d");
    const bitmaps = {};
    loadBitmap("/assets/earth_icon.png").then((b) => { bitmaps.earth = b; });
    for (const fb of flybys) loadBitmap(config.icons[fb.key]).then((b) => { bitmaps[fb.key] = b; });

    // ── words ──
    const NAME = config.name.toUpperCase();
    const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
    const dv = isMoon ? 3.1 : isIss ? 7.8 : hohmannDv(1, destAu);
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    // A log line is parts: [text, colour, gap before]
    const logs = [];
    if (plot) {
      logs.push([["Reading ephemeris", DATA], ["J2000", "i"]]);
      logs.push([["Solving transfer ", DATA], [`Earth → ${config.name}`, GOLD]]);
      logs.push([["Δv budget", DATA], [`${dv.toFixed(1)} km/s`, "i"]]);
      logs.push([["Tracing arc", DATA], [`${fmt(Math.round(config.etaDays))} days`, "i"]]);
      logs.push([["Target locked ", DATA], [config.name, GOLD]]);
    }
    logs.push([["Warp engaged", DATA], ["OK", "i"]]);
    flybys.forEach((fb) => logs.push([[`${cap(fb.key)} flyby`, DATA], [`${AU[fb.key]} AU`, "i"]]));
    logs.push([["Orbit insertion · handing over", DATA]]);

    // ── the chart, in the mock-up's units about the frame centre ──
    const SUN = { x: -240, y: 40 }, K = 0.38, TH0 = Math.PI - 0.35, RMAX = 452;
    const orbitKeys = isMoon ? ["moon"] : Object.keys(AU).filter((k) => AU[k] <= Math.max(1, destAu || 1) + 1e-9);
    const auMax = isMoon ? 1 : Math.max(1, destAu);
    const radiusOf = (k) => isMoon ? (k === "moon" ? RMAX * 0.62 : 0) : RMAX * Math.sqrt(AU[k] / auMax);
    const centre = isMoon ? { x: -120, y: 40 } : SUN;
    const pt = (r, th) => ({ x: centre.x + r * Math.cos(th), y: centre.y + r * Math.sin(th) * K });
    const rE = isMoon ? 0 : radiusOf("earth"), rT = isMoon ? radiusOf("moon") : radiusOf(key);
    const target = pt(rT, TH0 + Math.PI);
    const arc = (p) => {
      if (isMoon) { const r = lerp(18, rT, ease.inOut(p)); return pt(r, TH0 + Math.PI * p); }
      const a = (rE + rT) / 2, e = Math.abs(rT - rE) / (rT + rE), ph = Math.PI * p;
      const r = a * (1 - e * e) / (1 + (rT >= rE ? 1 : -1) * e * Math.cos(ph));
      return pt(r, TH0 + ph);
    };

    const speed = (c) => c < REVEAL ? (plot ? 0.07 : 0.4) : c < 4.3 ? lerp(plot ? 0.07 : 0.4, 1.7, ease.in(seg(c, REVEAL, 4.3)))
      : c < 6.9 ? 1.7 : lerp(1.7, 0.02, ease.out(seg(c, 6.9, 8.0)));

    // ── size ──
    let W = 1, H = 1, u = 1, k6 = 1, stars = [], overlay = null;
    function resize(w, h, dpr) {
      W = w; H = h; u = Math.min(W / 1600, H / 785); k6 = Math.max(0.6, u);
      for (const c of [back, front]) {
        c.width = Math.max(1, Math.floor(W * dpr)); c.height = Math.max(1, Math.floor(H * dpr));
        c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      stars = makeStars(Math.round(clamp((W * H) / (1600 * 785), 0.35, 1.6) * 1150), 11);
      // The grid and scanlines never move: drawn once per size.
      overlay = makeCanvas(Math.max(1, Math.floor(W * dpr)), Math.max(1, Math.floor(H * dpr)));
      const o = overlay.getContext("2d"); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.fillStyle = "rgba(88,198,179,.05)";
      for (let x = 0; x < W; x += 56) o.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += 56) o.fillRect(0, y, W, 1);
      o.fillStyle = "rgba(255,255,255,.025)";
      for (let y = 0; y < H; y += 3) o.fillRect(0, y, W, 1);
    }

    let frac = 0.3;
    // ── the clock ──
    let t = 0, dist = 0, last = null, revealed = false, released = false, gated = false, done = false;

    function step(now) {
      if (done) return;
      const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000); last = now;
      let next = t + dt;
      if (!revealed && canon(next) >= REVEAL) { revealed = true; emit("reveal", {}); }
      if (!released && canon(next) >= GATE) {
        next = GATE + EXTRA;
        if (!gated) { gated = true; emit("gate", {}); }
      }
      dist += speed(canon(next)) * dt * 0.55;
      t = next;
      draw();
      const c = canon(t);
      emit("tick", { t, c, now, approach: released ? approachAt(c) : null });
      if (t >= HAND + EXTRA) { done = true; emit("done", {}); }
    }

    function release(f) {
      if (f > 0.02 && f < 0.6) frac = f;
      released = true;
    }
    function skip() { if (!done && t < GATE + EXTRA - 0.2) t = GATE + EXTRA - 0.2; }

    // ── drawing ──
    function text(ctx, s, x, y, { font, colour, spacing = "0px", align = "left", base = "alphabetic", alpha = 1 }) {
      ctx.font = font; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = base;
      if ("letterSpacing" in ctx) ctx.letterSpacing = spacing;
      ctx.globalAlpha = alpha; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    const width = (ctx, s, font, spacing) => {
      ctx.font = font; if ("letterSpacing" in ctx) ctx.letterSpacing = spacing;
      const w = ctx.measureText(s).width; if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; return w;
    };

    function drawChart(ctx, c) {
      const chartA = seg(c, 0.0, 0.5) * (1 - seg(c, 3.05, 3.6));
      if (!plot || chartA <= 0) return;
      ctx.save(); ctx.translate(W / 2, H / 2);
      const zoom = u * (1 + 0.25 * ease.in(seg(c, 3.05, 3.6)));
      ctx.scale(zoom, zoom); ctx.globalAlpha = chartA;
      const drawn = ease.out(seg(c, 0.05, 0.9));
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
      const p = ease.inOut(seg(c, 0.7, 2.9));
      ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,62,200,.35)"; ctx.beginPath();
      for (let i = 0; i <= 120; i += 1) { const q = arc(i / 120); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,62,200,.95)"; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i <= 120 * p; i += 1) { const q = arc(i / 120); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke();
      const sp = arc(p); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = "500 13px 'Exo 2', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(126,231,255,.9)";
      const ep = isMoon ? centre : pt(rE, TH0); ctx.fillText("EARTH", ep.x - 58, ep.y + 4);
      ctx.fillStyle = "rgba(247,189,104,.95)"; ctx.fillText(NAME, target.x + 14, target.y - 10);
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.fillText(`Δv ${dv.toFixed(1)} km/s · ${fmt(Math.round(p * config.etaDays))} / ${fmt(Math.round(config.etaDays))} d`, sp.x + 12, sp.y + 22);
      ctx.fillStyle = "rgba(247,189,104,1)"; ctx.beginPath(); ctx.arc(target.x, target.y, 5, 0, Math.PI * 2); ctx.fill();
      const close = seg(c, 2.5, 2.9), pulse = seg(c, 2.9, 3.4);
      if (close > 0 && close < 1) { ctx.strokeStyle = `rgba(247,189,104,${close})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(target.x, target.y, lerp(60, 10, ease.out(close)), 0, Math.PI * 2); ctx.stroke(); }
      if (pulse > 0 && pulse < 1) { ctx.strokeStyle = `rgba(247,189,104,${1 - pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(target.x, target.y, 10 + pulse * 60, 0, Math.PI * 2); ctx.stroke(); }
      if (c > 2.9) {
        ctx.strokeStyle = "rgba(247,189,104,.9)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(target.x, target.y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.font = "600 11px 'Exo 2', sans-serif"; ctx.fillStyle = "rgba(247,189,104,.95)"; ctx.fillText("LOCKED", target.x + 14, target.y + 14);
      }
      ctx.restore();
    }

    function drawFit(ctx, img, r) {
      // A planet image is r across at its WIDTH; a ringed icon keeps its aspect.
      const w = r * 2, h = w * (img.height / img.width);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }

    function draw() {
      const c = canon(t), CX = W / 2, CY = H / 2;
      bctx.globalCompositeOperation = "source-over";
      bctx.fillStyle = "#030608"; bctx.fillRect(0, 0, W, H);
      drawStars(bctx, stars, dist, speed(c), 1 - 0.55 * seg(c, 7.6, 8.6), W, H, u);
      drawChart(bctx, c);
      /*
       * A PLANET IS NEVER SEE-THROUGH. The stars are infinitely far off, so a
       * planet always hides them -- and a planet faded in or out lets the
       * streaks behind it show, which reads as stars passing IN FRONT of it.
       * So nothing here fades: Earth slides in from the corner and falls away
       * off the bottom of the frame, and each world on the way arrives as a
       * speck in the distance, opaque from its first pixel.
       */
      // Earth, falling away behind and below as the warp engages
      if (!isIss && bitmaps.earth && c > REVEAL - 0.1 && c < 5.25) {
        const slide = 1 - ease.out(seg(c, REVEAL - 0.1, REVEAL + 0.45));   // in from off-frame
        const ek = ease.in(seg(c, REVEAL - 0.05, 5.2));
        const r = lerp(H * 1.05, H * 0.05, ek);
        const x = lerp(-0.18 * W, -0.4 * W, ek) - r + W * 0.12 - slide * 0.6 * W;
        const y = lerp(H * 0.72, H * 1.45, ek) - r * 0.2 + slide * 0.5 * H;
        bctx.drawImage(bitmaps.earth, x, y, r * 2, r * 2);
      }
      // the worlds on the way, on the real clock
      for (const fb of flybys) {
        const p = seg(t, fb.at - 1.3, fb.at + 0.1), img = bitmaps[fb.key];
        if (p <= 0 || p >= 1 || !img) continue;
        // Far and small for most of the pass, then close and fast, as an
        // approach at a steady speed looks.
        const z = lerp(24, 0.12, Math.pow(p, 1.6));
        const r = (FLY_R[fb.key] * H) / z, x = CX + (fb.ox * W * 0.5) / z, y = CY + (fb.oy * H * 0.5) / z;
        if (r < 0.6) continue;
        bctx.save(); bctx.translate(x, y); bctx.rotate(Math.atan2(y - CY, x - CX)); bctx.scale(1 + 0.35 * seg(p, 0.75, 1), 1);
        drawFit(bctx, img, r); bctx.restore();
      }
      // the back steps aside as the viewer takes the whole frame
      const fade = seg(c, SHARP, HAND);
      if (fade > 0) { bctx.globalCompositeOperation = "destination-out"; bctx.fillStyle = `rgba(0,0,0,${fade})`; bctx.fillRect(0, 0, W, H); bctx.globalCompositeOperation = "source-over"; }

      fctx.clearRect(0, 0, W, H);
      // the flare crossing at the moment of focus, over the planet
      const fl = seg(c, 7.9, 8.55);
      if (fl > 0 && fl < 1) {
        const x = lerp(-0.25 * W, 1.15 * W, fl), al = Math.sin(fl * Math.PI) * 0.35;
        fctx.save(); fctx.transform(1, 0, -0.32, 1, 0, 0);
        const g = fctx.createLinearGradient(x - 160, 0, x + 160, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, `rgba(255,255,255,${al})`); g.addColorStop(1, "rgba(255,255,255,0)");
        fctx.fillStyle = g; fctx.fillRect(x - 160 + 0.32 * CY, 0, 320, H); fctx.restore();
      }
      drawHud(fctx, c);
    }

    function drawHud(ctx, c) {
      const hudA = 1 - seg(c, 8.3, HAND);
      if (hudA <= 0) return;
      ctx.save(); ctx.globalAlpha = hudA;
      if (overlay) ctx.drawImage(overlay, 0, 0, W, H);
      ctx.restore();
      const A = (a) => a * hudA;
      const CX = W / 2, CY = H / 2, inset = 34 * k6 + 20, small = W <= 760;

      // corners: the label and the caption, inside the brackets
      const lab = "GEOHUB · ", labF = "500 12px 'Exo 2', sans-serif";
      text(ctx, lab, inset, inset - 4, { font: labF, colour: "rgba(255,255,255,.45)", spacing: "0.3em", base: "top", alpha: A(1) });
      text(ctx, "TRANSIT", inset + width(ctx, lab, labF, "0.3em"), inset - 4, { font: "600 12px 'Exo 2', sans-serif", colour: GOLD, spacing: "0.3em", base: "top", alpha: A(1) });
      const rx = W - inset;
      text(ctx, `TRANSIT · ${NAME}`, rx, inset - 4, { font: "600 17px 'Exo 2', sans-serif", colour: INK, spacing: "0.06em", align: "right", base: "top", alpha: A(1) });
      text(ctx, `${fmt(config.km)} KM · ${String(config.etaText).toUpperCase()}`, rx, inset + 24, { font: "400 13px 'Exo 2', sans-serif", colour: "rgba(255,255,255,.55)", spacing: "0.14em", align: "right", base: "top", alpha: A(1) });
      const arr = `ARRIVAL · ${String(config.arrivalText).toUpperCase()}`, arrF = "500 11px 'Exo 2', sans-serif";
      const aw = width(ctx, arr, arrF, "0.14em") + 18;
      ctx.globalAlpha = A(1); ctx.strokeStyle = GOLD; ctx.lineWidth = 1; ctx.strokeRect(rx - aw + 0.5, inset + 48.5, aw - 1, 21); ctx.globalAlpha = 1;
      text(ctx, arr, rx - 9, inset + 53, { font: arrF, colour: GOLD, spacing: "0.14em", align: "right", base: "top", alpha: A(1) });

      // brackets: from the frame's corners onto the planet
      const s = approachAt(c).scale;
      const m = 34 * k6, kk = ease.inOut(seg(c, 7.2, SHARP)), R = frac * H * s + 20;
      const x0 = lerp(m, CX - R, kk), y0 = lerp(m, CY - R, kk), x1 = lerp(W - m, CX + R, kk), y1 = lerp(H - m, CY + R, kk);
      const S = 42 * k6, ba = seg(c, 0.05, 0.4) * (1 - seg(c, 8.35, 8.85));
      if (ba > 0) {
        ctx.globalAlpha = A(ba); ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(x0 + 1.5, y0 + S); ctx.lineTo(x0 + 1.5, y0 + 1.5); ctx.lineTo(x0 + S, y0 + 1.5);
        ctx.moveTo(x1 - S, y0 + 1.5); ctx.lineTo(x1 - 1.5, y0 + 1.5); ctx.lineTo(x1 - 1.5, y0 + S);
        ctx.moveTo(x0 + 1.5, y1 - S); ctx.lineTo(x0 + 1.5, y1 - 1.5); ctx.lineTo(x0 + S, y1 - 1.5);
        ctx.moveTo(x1 - S, y1 - 1.5); ctx.lineTo(x1 - 1.5, y1 - 1.5); ctx.lineTo(x1 - 1.5, y1 - S);
        ctx.stroke(); ctx.globalAlpha = 1;
      }

      // the name: decoded, then up and out of the way of the run
      let txt = "";
      for (let i = 0; i < NAME.length; i += 1) {
        const settle = 0.35 + i * (1.8 / Math.max(6, NAME.length));
        txt += c >= settle ? NAME[i] : c < 0.15 ? " " : GLYPHS[Math.floor((c * 23 + i * 7) % GLYPHS.length)];
      }
      const up = ease.inOut(seg(c, plot ? 3.0 : 1.6, plot ? 4.0 : 2.6));
      // While the chart is up the name stands in the free room RIGHT of it,
      // not over it: centred it lay across the orbits and the target's own
      // label. It moves to the centre as it rises, when the chart has gone.
      // The chart's right edge is its widest orbit about its centre, in the
      // same units drawChart scales by u.
      // The target's name and the delta-v line are drawn to the RIGHT of the
      // target, and an outer planet's target sits near that edge, so they count.
      const chartRight = CX + Math.max(centre.x + Math.max(...orbitKeys.map(radiusOf), rT) + 24, target.x + 210) * u;
      const slotL = chartRight + 24 * u, slotR = W - inset - 12;
      const side = plot && !small && slotR - slotL >= 260;
      const sideX = side ? (slotL + slotR) / 2 : CX;
      let fs = 112 * Math.max(0.55, u);
      if (side) {
        // a long name is set smaller to fit the slot rather than run into the chart
        ctx.save(); ctx.font = `${fs}px 'Orbitron', sans-serif`;
        const wNow = ctx.measureText(NAME).width * (1 + 0.1 * 0.9);
        ctx.restore();
        if (wNow > slotR - slotL) fs *= (slotR - slotL) / wNow;
      }
      const nameX = lerp(sideX, CX, up);
      const nameA = 1 - seg(c, 8.0, 8.5);
      if (nameA > 0) {
        ctx.save();
        ctx.translate(nameX, CY - 0.12 * fs - 300 * up * k6); ctx.scale(lerp(1, 0.42, up), lerp(1, 0.42, up));
        ctx.shadowColor = "rgba(126,231,255,.35)"; ctx.shadowBlur = 28;
        text(ctx, txt, 0, 0, { font: `${fs}px 'Orbitron', sans-serif`, colour: INK, spacing: "0.1em", align: "center", base: "middle", alpha: A(nameA) });
        ctx.restore();
      }
      // the line under it
      let line = plot ? `${isMoon ? "Translunar injection" : "Hohmann transfer"} · ${Math.round(ease.inOut(seg(c, 0.7, 2.9)) * 100)}%` : "orbit 408 km";
      if (plot && c > 2.9) line = "target locked";
      if (c > REVEAL) line = "engaging warp";
      if (c > 3.9 && !isIss) line = "departing Earth";
      for (const fb of flybys) if (t > fb.at - 0.9) line = `passing ${cap(fb.key)}`;
      const sys = `${config.name} ${isMoon || isIss ? "approach" : "system"}`;
      if (c > 6.7) line = sys;
      if (!released && c >= GATE) line = `${sys} · viewer loading`;
      if (c > 7.5) line = "orbit insertion";
      const subA = seg(c, 0.3, 0.8) * (1 - seg(c, 8.0, 8.5));
      if (subA > 0) text(ctx, line.toUpperCase(), nameX, CY + 58 - 338 * up * k6, { font: `500 ${16 * Math.max(0.7, u)}px 'Exo 2', sans-serif`, colour: DATA, spacing: "0.34em", align: "center", base: "top", alpha: A(subA) });
      const tagA = seg(c, 0.2, 0.6) * (1 - up);
      if (tagA > 0) text(ctx, plot && c < 2.9 ? "PLOTTING COURSE" : "TRAJECTORY LOCKED", nameX, CY - 150 * k6, { font: "500 13px 'Exo 2', sans-serif", colour: GOLD, spacing: "0.5em", align: "center", base: "top", alpha: A(tagA) });

      // the log, bottom left, one beat a line
      const lf = 15 * Math.max(0.75, u), lh = lf * 1.75, lx = small ? 20 : 62, lb = H - (small ? 44 : 58);
      logs.forEach((parts, i) => {
        const la = clamp((t - (logAt[i] ?? 99)) / 0.15);
        if (la <= 0) return;
        let x = lx; const y = lb - (logs.length - i) * lh + lh * 0.5;
        for (const [s, col] of parts) {
          const grey = col === "i";
          if (grey) x += 14;
          const font = `500 ${lf}px 'Exo 2', sans-serif`;
          text(ctx, s, x, y, { font, colour: grey ? "rgba(255,255,255,.42)" : col, spacing: "0.06em", base: "middle", alpha: A(la) });
          x += width(ctx, s, font, "0.06em") + (grey ? 0 : 6);
        }
      });

      // the progress bar
      ctx.globalAlpha = hudA;
      ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(0, H - 4, W, 4);
      ctx.fillStyle = DATA; ctx.shadowColor = DATA; ctx.shadowBlur = 12;
      ctx.fillRect(0, H - 4, W * clamp(t / (HAND + EXTRA)), 4);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    return {
      plan, resize, step, release, skip,
      state: () => ({ t, c: canon(t), released, revealed, done, held: gated && !released, frac }),
    };
  }

  root.GeoIDTransitRender = { createRenderer, planFor, canonFor, approachAt, flybysFor, hohmannDv,
    AU, RINGS, REVEAL, GATE, APPROACH, SHARP, HAND };
})(typeof self !== "undefined" ? self : this);
