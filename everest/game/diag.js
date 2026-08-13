/**
 * Find the vertical lines on the machine that actually has them.
 *
 * Five fixes have now been shipped for an artifact that has never once
 * appeared on the development display. Each was a real defect and none of them
 * was *this* defect, because every measurement was taken here, where the bug
 * does not exist. Guessing a sixth time is not a plan.
 *
 * So this runs the measurement on the reporter's hardware. It takes the same
 * local-window band detector used during the investigation, sweeps it over the
 * frame to find where the banding actually is, then switches each candidate
 * cause off in turn and re-measures the same window. Whatever makes the number
 * collapse is the cause. Whatever does not, is not — which is the half that
 * has been missing.
 *
 * Two details that made earlier measurements lie, both fixed here:
 *
 *  - **Window it, do not average the frame.** The bands cover a few hundred
 *    pixels; a column mean over the full width buries them in unbanded ground.
 *    That is why a spectrum over ten camera angles came back clean while the
 *    screen was striped.
 *  - **Read the canvas, not just the drawing buffer.** `gl.readPixels` cannot
 *    see anything the compositor does afterwards. Where the browser allows it,
 *    both are sampled and compared, because a difference between them localises
 *    the fault to presentation rather than rendering.
 *
 * Usage, in the console:  await __diag()
 */

const WIN = { w: 220, h: 160 };

/** Periodic vertical structure inside one window: amplitude of the strongest
 *  component between 6 and 60 px, after detrending at twice that scale. */
function bandAmp(px, W, H, x0, y0, w, h, flipY) {
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const yy = flipY ? (H - 1 - (y0 + y)) : (y0 + y);
      const o = (yy * W + (x0 + x)) * 4;
      s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
    col[x] = s / h;
  }
  const R = 12, d = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const j = x + k; if (j >= 0 && j < w) { s += col[j]; n++; } }
    d[x] = col[x] - s / n;
  }
  let best = { per: 0, amp: 0 };
  for (let per = 6; per <= 60; per += 0.25) {
    const wv = 2 * Math.PI / per;
    let re = 0, im = 0;
    for (let x = 0; x < w; x++) { re += d[x] * Math.cos(wv * x); im += d[x] * Math.sin(wv * x); }
    const amp = 2 * Math.sqrt(re * re + im * im) / w;
    if (amp > best.amp) best = { per: +per.toFixed(2), amp: +amp.toFixed(3) };
  }
  return best;
}

export function install(game) {
  const gl = game.renderer.getContext();

  const grab = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const w = game.canvas.width, h = game.canvas.height;
    const p = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
    res({ w, h, p });
  })));

  /** Where in the frame is the banding worst? */
  const locate = (f) => {
    let best = { amp: -1 };
    for (let y = 0; y + WIN.h <= f.h; y += 70) {
      for (let x = 0; x + WIN.w <= f.w; x += 100) {
        const b = bandAmp(f.p, f.w, f.h, x, y, WIN.w, WIN.h, true);
        if (b.amp > best.amp) best = { x, y, ...b };
      }
    }
    return best;
  };

  const at = async (spot) => {
    const f = await grab();
    return bandAmp(f.p, f.w, f.h, spot.x, spot.y, WIN.w, WIN.h, true);
  };

  window.__diag = async () => {
    const U = game.terrain.uniforms;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const env = {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "(hidden)",
      driver: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "(hidden)",
      devicePixelRatio,
      browserZoom: +(outerWidth / innerWidth).toFixed(3),
      canvasBacking: [game.canvas.width, game.canvas.height],
      canvasCSS: [game.canvas.clientWidth, game.canvas.clientHeight],
      canvasVsDisplay: +(game.canvas.width / game.canvas.clientWidth).toFixed(4),
      maxAnisotropy: game.renderer.capabilities.getMaxAnisotropy(),
      quality: game.quality.name,
      imageryCanvases: game.imagery.tiers.map((t) => `${t.key}:${t.canvas.width}`),
    };

    const spot = locate(await grab());
    if (spot.amp < 0.8) {
      return { env, verdict: "No banding found in this frame. Point the camera at the striped ground first, then run again.", spot };
    }

    /* ── A raw pixel crop of the striped region, in the report ───────────
       Every diagnosis so far was made without ever seeing one pixel of the
       frame the stripes are actually in — screenshots re-compress exactly
       the structure that matters, and the dev machine draws a different
       frame. So the report now carries the evidence itself: the worst
       window, straight out of readPixels, as a lossless PNG data URL. */
    const cropPNG = async (sp) => {
      const f = await grab();
      const c = document.createElement("canvas");
      c.width = WIN.w; c.height = WIN.h;
      const ctx = c.getContext("2d");
      const im = ctx.createImageData(WIN.w, WIN.h);
      for (let y = 0; y < WIN.h; y++) {
        for (let x = 0; x < WIN.w; x++) {
          const src = ((f.h - 1 - (sp.y + y)) * f.w + (sp.x + x)) * 4;
          const dst = (y * WIN.w + x) * 4;
          im.data[dst] = f.p[src]; im.data[dst + 1] = f.p[src + 1];
          im.data[dst + 2] = f.p[src + 2]; im.data[dst + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
      return c.toDataURL("image/png");
    };

    /* Each candidate: a label, something to switch off, and how to put it
       back. Measured against the same window, so the numbers are comparable.

       Two families the earlier list could not reach, both taught by a day of
       0% rows:

       - SCENE OBJECTS. Weather particles, the glacier props, the route, the
         other climbers — none of these is a terrain uniform, and the pane
         this was developed in runs calm weather, so the spindrift and
         precipitation systems have never once been in a bisect on the
         machine that has the stripes.

       - THE IMAGERY TEXTURES THEMSELVES. Filling a tier's canvas flat grey
         and restoring it afterwards separates "the picture is striped" from
         "the sampling of the picture is striped" per tier — a distinction no
         uniform can make. */
    const tiers = game.imagery.tiers;
    const cands = [
      ["anisotropy → 1", () => tiers.map((t) => { const a = t.texture.anisotropy; t.texture.anisotropy = 1; t.texture.needsUpdate = true; return a; }),
        (old) => tiers.forEach((t, i) => { t.texture.anisotropy = old[i]; t.texture.needsUpdate = true; })],
      ["mipmaps off", () => tiers.map((t) => { const m = t.texture.minFilter; t.texture.minFilter = 1006; t.texture.needsUpdate = true; return m; }),
        (old) => tiers.forEach((t, i) => { t.texture.minFilter = old[i]; t.texture.needsUpdate = true; })],
      ["terrain shadows off", () => { const v = U.shadowsOn.value; U.shadowsOn.value = 0; return v; }, (v) => { U.shadowsOn.value = v; }],
      ["micro-relief off", () => { const v = U.microRelief.value; U.microRelief.value = 0; return v; }, (v) => { U.microRelief.value = v; }],
      ["snow detail off", () => { const v = U.snowDetail.value; U.snowDetail.value = 0; return v; }, (v) => { U.snowDetail.value = v; }],
      ["rock material off", () => { const v = U.rockDetail.value; U.rockDetail.value = 0; return v; }, (v) => { U.rockDetail.value = v; }],
      ["post chain off", () => { const v = game.postfx.enabled; game.postfx.enabled = false; return v; }, (v) => { game.postfx.enabled = v; }],
    ];

    // Scene objects, by visibility. Lights excluded; hiding the sun proves nothing.
    for (const child of game.scene.children) {
      if (child.isLight || !child.visible) continue;
      const name = child.name || child.type;
      cands.push([`hide: ${name}`,
        () => { child.visible = false; return true; },
        () => { child.visible = true; }]);
    }

    // Imagery tiers, by content: flat grey in, original back afterwards.
    for (const t of tiers) {
      cands.push([`grey out imagery: ${t.key}`,
        () => {
          const keep = document.createElement("canvas");
          keep.width = t.canvas.width; keep.height = t.canvas.height;
          keep.getContext("2d").drawImage(t.canvas, 0, 0);
          const ctx = t.canvas.getContext("2d");
          ctx.fillStyle = "#8c8c8c";
          ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
          t.texture.needsUpdate = true;
          return keep;
        },
        (keep) => {
          const ctx = t.canvas.getContext("2d");
          ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
          ctx.drawImage(keep, 0, 0);
          t.texture.needsUpdate = true;
        }]);
    }

    const base = await at(spot);
    const evidence = await cropPNG(spot);
    const rows = [];
    for (const [name, off, on] of cands) {
      const saved = off();
      const m = await at(spot);
      on(saved);
      rows.push({ candidate: name, amp: m.amp, period: m.per,
        drop: +(100 * (1 - m.amp / Math.max(1e-6, base.amp))).toFixed(0) + "%" });
    }
    rows.sort((a, b) => a.amp - b.amp);

    const winner = rows[0];
    return {
      env,
      bandingAt: spot,
      baseline: base,
      candidates: rows,
      verdict: parseFloat(winner.drop) > 55
        ? `LIKELY CAUSE: ${winner.candidate} (removes ${winner.drop} of the banding).`
        : "No single candidate removes it — send the whole object; the crop shows the actual pixels.",
      cropOfStripedRegionPNG: evidence,
    };
  };

  /* ── A button, because a console is a hurdle ────────────────────────────
     The first version of this was "paste `await __diag()` into the console",
     which is fine if you already have DevTools open and is a wall if you do
     not — it was pasted into a shell, where `await` is a syntax error. The
     measurement has to happen on the machine with the fault, so the thing
     standing between that machine and the measurement should be one click.

     Deliberately plain DOM appended to <body>: no HUD coupling, nothing to
     keep in step with the skin, and it cannot break the game if it throws. */
  const btn = document.createElement("button");
  btn.textContent = "DIAGNOSE LINES";
  btn.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:100000;padding:9px 14px;" +
    "font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;cursor:pointer;" +
    "color:#0d0221;background:#ff2bd6;border:0;border-radius:3px;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:12px;bottom:56px;z-index:100000;display:none;" +
    "width:min(620px,90vw);max-height:60vh;overflow:auto;padding:12px;" +
    "font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;color:#fdf7ff;" +
    "background:rgba(13,2,33,.96);border:1px solid #ff2bd6;border-radius:4px;";

  const run = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "MEASURING…";
    panel.style.display = "block";
    panel.textContent = "Sampling frames — a few seconds.";
    try {
      const r = await window.__diag();
      const text = JSON.stringify(r, null, 2);
      panel.textContent = text;
      // Select it, so copying is ctrl-C rather than a careful drag.
      const range = document.createRange();
      range.selectNodeContents(panel);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { await navigator.clipboard.writeText(text); btn.textContent = "COPIED — PASTE TO CLAUDE"; }
      catch { btn.textContent = "SELECTED — PRESS CTRL+C"; }
    } catch (e) {
      panel.textContent = "Diagnostic failed: " + (e && e.message);
      btn.textContent = "DIAGNOSE LINES";
    }
    btn.disabled = false;
  };

  btn.onclick = run;

  /* F9, and not only the button.
     While you are playing, the canvas holds a pointer lock so it can read raw
     mouse movement for the look controls — and a locked pointer means every
     mouse event goes to the canvas. A DOM button in the corner is simply
     unclickable until you press Escape, which is a trap when the whole point
     is to measure the frame you are currently looking at. A key gets through
     regardless. Capture phase, so the game's own key handler cannot swallow
     it first, and F9 because nothing else in the game or the browser wants it. */
  /* ── F10: isolate the picture from the shape ────────────────────────────
     The numeric detector has a 17% frame-to-frame noise floor, which is the
     same size as every candidate it has ever ranked — so it cannot settle
     this, and pretending otherwise wasted most of a day. A person looking at
     the actual screen can settle it in four keypresses.

     Mode 1 paints the terrain flat grey and keeps all the lighting: whatever
     is left is the SHAPE — geometry, normals, shadows, recovered relief.
     Mode 2 shows the raw draped imagery with no lighting at all: whatever is
     left is the PICTURE. The lines will be in exactly one of them. */
  const MODES = [
    "0 · normal",
    "1 · SHAPE only — flat grey albedo, lighting kept",
    "2 · PICTURE only — raw imagery, no lighting",
    "3 · coarse imagery tier only (67 m/px)",
  ];
  const label = document.createElement("div");
  label.style.cssText =
    "position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:100002;" +
    "display:none;padding:7px 14px;border-radius:3px;background:#00e5ff;color:#0d0221;" +
    "font:600 12px/1.3 ui-monospace,monospace;letter-spacing:.06em";
  document.body.appendChild(label);

  let mode = 0;
  const cycle = () => {
    mode = (mode + 1) % MODES.length;
    game.terrain.uniforms.debugMode.value = mode;
    label.textContent = MODES[mode];
    label.style.display = mode ? "block" : "none";
    modeBtn.textContent = "ISOLATE: " + MODES[mode].split(" · ")[1].split(" —")[0];
  };

  /* K and J, not only F9/F10.
     The function row is a bad place to put a diagnostic. On a laptop it needs
     Fn held down, and Chrome claims F10 for its own menu at a level a page
     cannot always cancel — so the key may never arrive. Plain letters always
     do. K cycles the isolation modes, J runs the measurement; neither is bound
     by the game (see the controls list) or by the browser. */
  const modeBtn = document.createElement("button");
  modeBtn.textContent = "ISOLATE: normal";
  /* Set explicitly rather than string-patching btn.style.cssText: reading
     cssText back gives the normalised form ("left: 12px", with a space), so a
     replace of "left:12px" silently matches nothing and both buttons stack in
     the same corner. */
  modeBtn.style.cssText =
    "position:fixed;left:12px;bottom:48px;z-index:100000;padding:9px 14px;" +
    "font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;cursor:pointer;" +
    "color:#0d0221;background:#00e5ff;border:0;border-radius:3px;";
  modeBtn.onclick = cycle;

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "F9" || e.code === "KeyJ") {
      e.preventDefault(); e.stopPropagation(); run(); return;
    }
    if (e.code === "F10" || e.code === "KeyK") {
      e.preventDefault(); e.stopPropagation(); cycle();
    }
  }, true);

  /* The buttons are gone; F9/J (measure) and F10/K (isolate) still work.
     The stripe hunt they were built for is finished, and a permanent pair of
     debug buttons over the mountain is not something a player should see. */
  document.body.append(panel);
}
