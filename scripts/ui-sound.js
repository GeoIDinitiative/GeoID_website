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

  function playHover() {
    // Rate-limit: sweeping the pointer across the sidebar shouldn't machine-gun.
    var now = performance.now();
    if (now - lastHoverAt < 45) return;
    lastHoverAt = now;
    // Peaks are pitched to sit above the ambient music bed, which runs its own
    // <audio> element well outside this gain graph -- Atlas's original values
    // were tuned for a silent GUI and got buried here.
    blip(2050, 0.032, 0.045, "sine"); // crisp high tick
  }

  function playClick() {
    // Quick high -> low pair reads as a positive "select".
    blip(1350, 0.055, 0.13, "triangle");
    blip(760, 0.065, 0.09, "square");
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
  };
})();
