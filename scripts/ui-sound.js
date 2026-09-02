// Arcade-style UI feedback for the viewers: a soft "tick" on hover and a
// firmer two-tone "click" on select. Ported from the Atlas GUI's uiSound.ts.
//
// Everything is synthesized with Web Audio -- no asset files, no extra network
// requests, ~0 latency. Wiring is a pair of delegated document listeners, so
// controls added later by flightsim.js or the viewer JS pick the sound up for
// free without registering anything.
(function () {
  "use strict";

  if (window.GeoIDUiSound) return; // already installed

  var ENABLED_KEY = "geoid_ui_sounds";
  var VOLUME_KEY = "geoid_ui_sound_volume";

  // Single source of truth -- the initialiser at the bottom reads this too, so
  // the default can't drift between the declaration and the localStorage load.
  var DEFAULT_VOLUME = 0.8;

  var enabled = true;
  var volume = DEFAULT_VOLUME; // user multiplier over the base gains
  var ctx = null;
  var lastHoverAt = 0;
  var lastControl = null;

  function readBool(key, dflt) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? dflt : v === "true";
    } catch (e) {
      return dflt;
    }
  }

  function readNum(key, dflt) {
    try {
      var raw = localStorage.getItem(key);
      // Number(null) === 0, not NaN -- an unset key has to short-circuit or the
      // default would silently become 0 and the whole thing would be muted.
      if (raw === null) return dflt;
      var v = Number(raw);
      return isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;
    } catch (e) {
      return dflt;
    }
  }

  function getCtx() {
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctx = new Ctor();
      } catch (e) {
        return null;
      }
    }
    // Autoplay policy parks the context until a gesture -- resume on the way past.
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One short enveloped oscillator "blip". peak is already scaled tiny.
  function blip(freq, durSec, peak, type) {
    if (!enabled || volume <= 0) return;
    var ac = getCtx();
    if (!ac) return;
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    var t = ac.currentTime;
    var level = Math.max(0.0002, peak * volume);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + durSec + 0.02);
  }

  /**
   * WHAT EACH THEME SOUNDS LIKE.
   *
   * The hover tick and the two-tone click are the same apparatus for every
   * skin; only their voices differ. A row here rather than a second sound
   * system: this file already owns the rate limiting, the control selector,
   * the disabled and `data-no-sound` opt-outs and the mute API, and a parallel
   * one meant two clicks on one press with the reader hearing whichever fired
   * first — which is exactly what "the sound is the same in every theme"
   * turned out to be.
   *
   * The DEFAULT entry is the values this file has always played, so a reader
   * on the GeoHUB theme hears no change at all.
   *
   *   crt      a soft terminal blip, squared off
   *   pixel    two square steps — the era's hardware could not glide
   *   vector   a clean sine pair, high and airy
   *   outrun   a saw stab with a fifth under it
   *   beige    a dry mechanical tick, almost no pitch movement
   *   hud      a rising two-tone chirp, quiet and instrument-like
   */
  var VOICES = {
    "default": { hover: [2050, 0.032, 0.045, "sine"],
      click: [[1350, 0.055, 0.13, "triangle"], [760, 0.065, 0.09, "square"]] },
    crt: { hover: [1500, 0.026, 0.035, "square"],
      click: [[1180, 0.046, 0.10, "square"], [880, 0.05, 0.05, "square"]] },
    pixel: { hover: [1760, 0.022, 0.04, "square"],
      click: [[660, 0.045, 0.12, "square"], [990, 0.05, 0.10, "square"]] },
    vector: { hover: [2400, 0.03, 0.04, "sine"],
      click: [[1560, 0.07, 0.11, "sine"], [880, 0.10, 0.06, "sine"]] },
    outrun: { hover: [1200, 0.03, 0.04, "triangle"],
      click: [[520, 0.13, 0.11, "sawtooth"], [347, 0.15, 0.06, "sawtooth"]] },
    beige: { hover: [900, 0.014, 0.03, "square"],
      click: [[240, 0.024, 0.16, "square"], [180, 0.02, 0.08, "square"]] },
    hud: { hover: [1900, 0.028, 0.035, "triangle"],
      click: [[700, 0.05, 0.09, "triangle"], [1500, 0.075, 0.07, "triangle"]] }
  };

  /** The voice for whatever theme is stamped on the root, right now. */
  function voice() {
    var skin = document.documentElement.getAttribute("data-skin");
    return (skin && VOICES[skin]) || VOICES["default"];
  }

  function playHover() {
    // Rate-limit: sweeping the pointer across the sidebar shouldn't machine-gun.
    var now = performance.now();
    if (now - lastHoverAt < 45) return;
    lastHoverAt = now;
    // Peaks are pitched to sit above the ambient music bed, which runs its own
    // <audio> element well outside this gain graph -- Atlas's original values
    // were tuned for a silent GUI and got buried here.
    var h = voice().hover;
    blip(h[0], h[1], h[2], h[3]);
  }

  function playClick() {
    // A PAIR, not a note: two blips read as a positive "select" where one
    // reads as a beep. Which two is the theme's business.
    var c = voice().click;
    blip(c[0][0], c[0][1], c[0][2], c[0][3]);
    blip(c[1][0], c[1][1], c[1][2], c[1][3]);
  }

  // Controls that should feel clicky. <summary> covers every collapsible
  // section header in the viewer sidebar; select covers the basemap and
  // contour pickers. Range sliders are deliberately absent -- dragging the
  // relief slider would chirp continuously.
  var CONTROL_SELECTOR =
    'button, [role="button"], a[href], summary, select, input[type="checkbox"]';

  function controlFor(target) {
    if (!target || target.nodeType !== 1) return null;
    var el = target.closest(CONTROL_SELECTOR);
    if (!el) return null;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return null;
    if (el.closest("[data-no-sound]")) return null;
    return el;
  }

  function onOver(e) {
    var ctrl = controlFor(e.target);
    if (!ctrl) {
      lastControl = null;
      return;
    }
    // Only fire when crossing into a *different* control, so moving within one
    // button's padding stays silent.
    if (ctrl !== lastControl) {
      lastControl = ctrl;
      playHover();
    }
  }

  function onClick(e) {
    if (controlFor(e.target)) playClick();
  }

  enabled = readBool(ENABLED_KEY, true);
  volume = readNum(VOLUME_KEY, DEFAULT_VOLUME);

  document.addEventListener("pointerover", onOver, { passive: true });
  document.addEventListener("click", onClick, { passive: true, capture: true });

  // Exposed so a settings toggle can be wired up later without touching this file.
  window.GeoIDUiSound = {
    isEnabled: function () {
      return enabled;
    },
    setEnabled: function (v) {
      enabled = !!v;
      try {
        localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
      } catch (e) {
        /* storage unavailable -- runtime state still applies */
      }
    },
    getVolume: function () {
      return volume;
    },
    setVolume: function (v) {
      volume = Math.min(1, Math.max(0, Number(v) || 0));
      try {
        localStorage.setItem(VOLUME_KEY, String(volume));
      } catch (e) {
        /* ignore */
      }
    },
    playHover: playHover,
    playClick: playClick,
    VOICES: VOICES,
    voice: voice,
  };
})();
