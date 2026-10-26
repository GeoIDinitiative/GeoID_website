/* =============================================================================
   Flight sound -- engine, rotor, wind and hazard-zone alerts for the flight sim
   (scripts/flightsim.js), synthesised with the Web Audio API: no audio files.

   Owner, 2026-10-26: "theres no sounds from the flight (no wind/plane/
   helicopter sounds)" -- and from the roadmap, "realistic sound: engine, wind,
   hazard-zone alerts". Reads `__flightSim.telemetry` (refreshed every flying
   frame) and never writes flight state.

   - Light aircraft: a four-cylinder piston engine (firing rate from ~1,000 rpm
     idle to ~2,700 at full throttle) and the two-blade propeller's buzz.
   - Helicopter: main-rotor blade slap (two blades, ~6.6 rev/s, rising a little
     with collective), turbine whine and the tail rotor's hum.
   - Anything else (shuttle, starship, saucer...): a thruster rumble, deeper
     and louder on boost.
   - Wind: filtered noise rising with airspeed, with slow gusts, scaled by the
     air's density (pressure), so it thins with altitude and is gone in space.
   - Hazard zones (Earth): every few seconds the aircraft's point is read
     against the long-term risk maps (window.GeoIDBackgroundRisk -- cyclone,
     seismic, volcanic ash; members' data, so silent where it cannot be read).
     Entering an annual chance of 2 % (elevated) or 10 % (high) chimes once
     and names it on the HUD; the zone must be left before it chimes again.

   Audio may only start from a user gesture: engaging flight is one, and any
   key or pointer press while flying resumes a suspended context. Sound fades
   out when flight is paused or left and when the tab is hidden. Parameters
   are set ten times a second with setTargetAtTime, never rebuilt per frame.
   ============================================================================= */
(function () {
  "use strict";

  const STORE = "geoid-flight-sound";
  const VOLUME = 0.55;
  const ELEVATED = 0.02, HIGH = 0.10;
  const HAZARD_NAMES = { cyclone: "TROPICAL CYCLONE", seismic: "SEISMIC SHAKING", volcanic: "VOLCANIC ASH" };

  let on = true;
  try { on = localStorage.getItem(STORE) !== "off"; } catch (e) { /* private mode */ }

  let ctx = null, master = null, graph = null, timer = 0, gustAt = 0, suspendTimer = 0;
  let lastCrashed = false, hazardTimer = 0, hazardBackoff = 0;
  const hazardTier = {};

  const fs = () => window.__flightSim;
  const flying = () => Boolean(fs()?.active) && !fs()?.paused && !document.hidden;

  function noiseBuffer(c, seconds, brown) {
    const n = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i += 1) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  function loop(c, buf) {
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }
  const gain = (c, v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };
  function filter(c, type, freq, q = 0.7) {
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  function osc(c, type, freq) {
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq; o.start();
    return o;
  }

  /** Every voice, built once; levels and pitches follow the telemetry. */
  function build(c) {
    const white = noiseBuffer(c, 2.5, false), brown = noiseBuffer(c, 4, true);
    const out = gain(c, 1);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    out.connect(comp).connect(master);

    // Wind: white noise through a band that opens with speed, and a low rumble.
    const windBand = filter(c, "bandpass", 500, 0.6), windLow = filter(c, "lowpass", 260);
    const wind = gain(c), windRumble = gain(c);
    loop(c, white).connect(windBand).connect(wind).connect(out);
    loop(c, brown).connect(windLow).connect(windRumble).connect(out);

    // Piston engine: two sawtooths at the firing rate and its half, through a
    // lowpass, roughened by an amplitude wobble at the crank rate.
    const firing = osc(c, "sawtooth", 40), half = osc(c, "sawtooth", 20);
    const pistonLp = filter(c, "lowpass", 500, 1.2), piston = gain(c);
    const pistonAm = gain(c, 1), crank = osc(c, "sine", 20), crankDepth = gain(c, 0.35);
    crank.connect(crankDepth).connect(pistonAm.gain);
    const halfGain = gain(c, 0.6);
    firing.connect(pistonLp); half.connect(halfGain).connect(pistonLp);
    pistonLp.connect(pistonAm).connect(piston).connect(out);
    // Propeller: noise in a band, chopped at the blade-pass rate.
    const propBand = filter(c, "bandpass", 180, 1.5), propChop = gain(c, 0.5), prop = gain(c);
    const blade = osc(c, "sine", 40), bladeDepth = gain(c, 0.5);
    blade.connect(bladeDepth).connect(propChop.gain);
    loop(c, white).connect(propBand).connect(propChop).connect(prop).connect(out);

    // Helicopter: low noise slapped by a sharpened pulse at the blade rate,
    // a turbine whine pair and a tail-rotor buzz.
    const slapLp = filter(c, "lowpass", 300, 1), slapAm = gain(c, 0), slap = gain(c);
    const rotor = osc(c, "sine", 13);
    const sharpen = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) { const x = (i / 1023) * 2 - 1; curve[i] = Math.pow(Math.max(0, x), 6); }
    sharpen.curve = curve;
    rotor.connect(sharpen).connect(slapAm.gain);
    loop(c, brown).connect(slapLp).connect(slapAm).connect(slap).connect(out);
    const whine1 = osc(c, "sine", 1850), whine2 = osc(c, "sine", 3720), whine = gain(c);
    const w2 = gain(c, 0.35);
    whine1.connect(whine); whine2.connect(w2).connect(whine); whine.connect(out);
    const tail = osc(c, "sawtooth", 85), tailLp = filter(c, "lowpass", 400), tailGain = gain(c);
    tail.connect(tailLp).connect(tailGain).connect(out);

    // Thrusters: brown noise, deep, with a hiss on top.
    const thrustLp = filter(c, "lowpass", 180, 0.8), thrust = gain(c);
    loop(c, brown).connect(thrustLp).connect(thrust).connect(out);
    const hissBand = filter(c, "highpass", 2500), hiss = gain(c);
    loop(c, white).connect(hissBand).connect(hiss).connect(out);

    return { windBand, windLow, wind, windRumble, firing, half, crank, pistonLp, piston, propBand, blade, prop,
      rotor, slap, slapLp, whine1, whine2, whine, tail, tailGain, thrustLp, thrust, hiss };
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = gain(ctx, 0);
    master.connect(ctx.destination);
    graph = build(ctx);
    return ctx;
  }

  const set = (param, v, tc = 0.15) => param.setTargetAtTime(v, ctx.currentTime, tc);

  function tick() {
    if (!ctx) return;
    const t = fs()?.telemetry;
    const live = on && flying() && t;
    set(master.gain, live ? VOLUME : 0, live ? 0.25 : 0.12);
    if (!live) {
      // Let the fade finish, then stop the audio clock (no CPU while silent).
      if (ctx.state === "running" && !suspendTimer) {
        suspendTimer = setTimeout(() => { suspendTimer = 0; if (!(on && flying())) ctx.suspend().catch(() => {}); }, 600);
      }
      return;
    }
    if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = 0; }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    const g = graph;
    const thr = Math.max(0, Math.min(1, t.throttle || 0));
    const spd = Math.max(0, t.speedMs || 0);
    const density = Math.max(0, Math.min(1.2, (t.pressurePa ?? 101325) / 101325));
    const crashed = Boolean(t.crashed);
    if (crashed && !lastCrashed) thump();
    lastCrashed = crashed;
    const craft = crashed ? "none" : t.craft === "helicopter" ? "heli" : t.craft === "aircraft" ? "prop" : "thrust";
    const inside = t.cam === "cockpit" ? 0.55 : 1;

    // Wind and its gusts.
    const now = ctx.currentTime;
    if (now > gustAt) gustAt = now + 1.5 + Math.random() * 3;
    const gust = 0.8 + 0.4 * Math.random();
    const v = Math.min(1, spd / 90);
    set(g.wind.gain, density * inside * 0.32 * Math.pow(v, 1.4) * gust, 0.6);
    set(g.windRumble.gain, density * inside * 0.5 * Math.pow(v, 1.2), 0.5);
    set(g.windBand.frequency, 350 + 1300 * v);
    set(g.windLow.frequency, 120 + 220 * v);

    // Piston aircraft: firing rate = rpm / 60 x 2 (four cylinders, four-stroke).
    const rpm = 1000 + 1700 * thr + 4 * Math.min(spd, 80);
    const fire = (rpm / 60) * 2;
    set(g.firing.frequency, fire, 0.2); set(g.half.frequency, fire / 2, 0.2);
    set(g.crank.frequency, rpm / 60, 0.2);
    set(g.pistonLp.frequency, 300 + 900 * thr, 0.3);
    set(g.piston.gain, craft === "prop" ? 0.10 + 0.16 * thr : 0, 0.3);
    set(g.blade.frequency, (rpm / 60) * 2, 0.2);
    set(g.propBand.frequency, 140 + 260 * thr, 0.3);
    set(g.prop.gain, craft === "prop" ? 0.08 + 0.18 * thr : 0, 0.3);

    // Helicopter: the rotor turns at a near-constant rate; collective loads it.
    const load = thr + Math.min(0.3, Math.abs(t.vsMs || 0) / 30);
    set(g.rotor.frequency, 12.5 + 1.2 * thr, 0.5);
    set(g.slapLp.frequency, 180 + 260 * load, 0.3);
    set(g.slap.gain, craft === "heli" ? 0.55 + 0.45 * load : 0, 0.3);
    set(g.whine1.frequency, 1700 + 300 * thr, 0.6); set(g.whine2.frequency, 3400 + 600 * thr, 0.6);
    set(g.whine.gain, craft === "heli" ? 0.010 + 0.012 * thr : 0, 0.4);
    set(g.tail.frequency, 80 + 15 * thr, 0.5);
    set(g.tailGain.gain, craft === "heli" ? 0.03 + 0.03 * thr : 0, 0.4);

    // Thrusters, with boost.
    const boost = t.boosting ? 1 : 0;
    set(g.thrustLp.frequency, 120 + 200 * thr + 250 * boost, 0.3);
    set(g.thrust.gain, craft === "thrust" ? (0.25 + 0.5 * thr + 0.4 * boost) : 0, 0.3);
    set(g.hiss.gain, craft === "thrust" ? 0.012 * thr + 0.03 * boost : 0, 0.3);
  }
  /** A crash: one low thump through a falling lowpass. */
  function thump() {
    const c = ctx, src = c.createBufferSource(), lp = filter(c, "lowpass", 900), g = gain(c, 0);
    src.buffer = noiseBuffer(c, 1.2, true);
    src.connect(lp).connect(g).connect(master);
    const t0 = c.currentTime;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1.6, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
    lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(60, t0 + 1);
    src.start(t0); src.stop(t0 + 1.2);
  }

  /** The hazard chime: two notes for elevated, three for high. */
  function chime(level) {
    if (!ctx || !on) return;
    const notes = level === 2 ? [880, 660, 880] : [740, 554];
    notes.forEach((f, k) => {
      const o = ctx.createOscillator(), g = gain(ctx, 0), t0 = ctx.currentTime + 0.05 + k * 0.22;
      o.type = "triangle"; o.frequency.value = f;
      o.connect(g).connect(master);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.22, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
  }

  async function checkHazards() {
    const risk = window.GeoIDBackgroundRisk, at = fs()?.shipLatLon;
    if (!risk?.backgroundAt || !at || !flying() || Date.now() < hazardBackoff) return;
    let answers;
    try { answers = await risk.backgroundAt(at.lat, at.lon); } catch (e) { return; }
    // Unreadable maps (not a member, offline): ask again in a minute, not every few seconds.
    if (answers.every((a) => a.error)) { hazardBackoff = Date.now() + 60000; return; }
    let worst = null;
    for (const a of answers) {
      if (a.error) continue;
      const tier = a.p >= HIGH ? 2 : a.p >= ELEVATED ? 1 : 0;
      const was = hazardTier[a.id] || 0;
      hazardTier[a.id] = tier;
      if (tier > was && (!worst || tier > worst.tier || a.p > worst.p)) worst = { ...a, tier };
    }
    if (!worst) return;
    const years = Math.max(1, Math.round(1 / worst.p));
    chime(worst.tier);
    fs()?.flash?.(`${worst.tier === 2 ? "HIGH" : "ELEVATED"} ${HAZARD_NAMES[worst.id] || worst.id.toUpperCase()} ZONE · ABOUT 1 IN ${years} YR`);
  }

  function setOn(v) {
    on = Boolean(v);
    try { localStorage.setItem(STORE, on ? "on" : "off"); } catch (e) { /* private mode */ }
    const b = document.getElementById("fs-sound-toggle");
    if (b) { b.setAttribute("aria-pressed", String(on)); b.classList.toggle("is-muted", !on); }
    if (on) start();
    else if (ctx) tick();
  }

  function start() {
    if (!on || !fs()?.active) return;
    if (!ensureContext()) return;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    if (!timer) {
      timer = setInterval(() => {
        tick();
        hazardTimer += 1;
        if (hazardTimer % 30 === 0) checkHazards();
      }, 100);
    }
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = 0; }
    for (const k of Object.keys(hazardTier)) delete hazardTier[k];
    lastCrashed = false;
    if (ctx) {
      set(master.gain, 0, 0.12);
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => { suspendTimer = 0; ctx.suspend().catch(() => {}); }, 600);
    }
  }

  // The event fires before `active` is set; a tick later is still inside the
  // engaging click's user activation, which is what lets audio start.
  window.addEventListener("flightsim:engaged", () => setTimeout(start, 0));
  window.addEventListener("flightsim:disengaged", stop);
  // A suspended context resumes only inside a gesture.
  const nudge = () => { if (on && fs()?.active) start(); };
  window.addEventListener("pointerdown", nudge, true);
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && fs()?.active && !e.ctrlKey && !e.metaKey && !e.altKey
      && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable) {
      setOn(!on);
      fs()?.flash?.(on ? "SOUND ON" : "SOUND OFF");
      return;
    }
    nudge();
  }, true);
  document.addEventListener("visibilitychange", () => { if (ctx) tick(); });

  function wireButton() {
    const b = document.getElementById("fs-sound-toggle");
    if (!b || b.dataset.wired) return Boolean(b);
    b.dataset.wired = "1";
    b.hidden = false;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("is-muted", !on);
    b.addEventListener("click", () => setOn(!on));
    return true;
  }
  // The HUD is injected by flightsim.js once the page is ready.
  if (!wireButton()) {
    let tries = 0;
    const wait = setInterval(() => { if (wireButton() || ++tries > 60) clearInterval(wait); }, 500);
  }

  window.GeoIDFlightSound = { setOn, isOn: () => on, state: () => ctx?.state || "none" };
})();
