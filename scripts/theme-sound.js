/**
 * THEME SOUNDS — a click that fits the skin, synthesised rather than shipped.
 *
 * Six themes want six different clicks, and six audio files would be six
 * downloads, six licences and six things to keep in step with a palette. Each
 * of these is a handful of oscillator parameters instead: nothing to fetch,
 * nothing to license, and the sound is defined next to the theme it belongs
 * to rather than in an assets folder.
 *
 * WHAT EACH ONE IS, and why:
 *   CRT      a short soft blip — a terminal beep with its edge taken off
 *   PIXEL    a two-step square wave, the NES menu-move sound
 *   VECTOR   a clean sine ping gliding down, the way a vector game's UI reads
 *   OUTRUN   a saw sweep with a fifth under it, an FM synth stab
 *   BEIGE    a mechanical tick: filtered noise, no pitch at all
 *   HUD      a quiet rising two-tone chirp, an instrument acknowledging
 *
 * THREE RULES THIS FILE KEEPS, and each is the difference between a nice
 * touch and something a reader turns off in a fortnight:
 *
 * - THE DEFAULT THEME IS SILENT. Sound is a thing a theme brings, not a thing
 *   the app starts doing to somebody who never asked for it.
 * - IT IS OFF UNTIL SWITCHED ON, and the switch is beside the theme picker.
 * - IT ONLY ANSWERS CONTROLS. A click on the globe, a drag, a text selection
 *   make no sound: the listener asks whether the target is a button, a tab, a
 *   tick or a select, and stays quiet otherwise.
 *
 * The AudioContext is created on the FIRST click and not before — a browser
 * refuses one outside a gesture, and creating it at load would leave a
 * suspended context running for every reader who never turns sound on.
 */
(function () {
  "use strict";

  var KEY = "geoid:skin-sound";

  /**
   * One entry per theme. `kind` picks the shape; everything else is that
   * shape's parameters, so a new theme's click is a row here rather than a
   * new function.
   */
  var VOICES = {
    crt: { kind: "tone", type: "square", from: 1180, to: 1180, ms: 46, gain: 0.055, tilt: 0.5 },
    pixel: { kind: "step", type: "square", from: 660, to: 990, ms: 62, gain: 0.06 },
    vector: { kind: "tone", type: "sine", from: 1560, to: 880, ms: 120, gain: 0.05 },
    outrun: { kind: "stab", type: "sawtooth", from: 520, to: 160, ms: 190, gain: 0.045 },
    beige: { kind: "tick", ms: 22, gain: 0.09 },
    hud: { kind: "chirp", type: "triangle", from: 700, to: 1500, ms: 90, gain: 0.045 }
  };

  var ctx = null;

  function audio() {
    if (ctx) return ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (error) { return null; }
    return ctx;
  }

  function enabled() {
    try { return window.localStorage.getItem(KEY) === "on"; } catch (error) { return false; }
  }

  function setEnabled(on) {
    try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch (error) { /* private window */ }
  }

  /** An envelope with no click of its own — a hard start IS an audible pop. */
  function envelope(gain, at, ms, peak) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  }

  function play(voice) {
    var c = audio();
    if (!c || !voice) return;
    if (c.state === "suspended") { try { c.resume(); } catch (error) { /* ignore */ } }
    var at = c.currentTime;
    var out = c.createGain();
    out.connect(c.destination);
    envelope(out, at, voice.ms, voice.gain);

    if (voice.kind === "tick") {
      // No pitch at all: a mouse button is a transient, not a note. A short
      // noise burst through a band-pass is exactly that.
      var frames = Math.max(1, Math.round(c.sampleRate * voice.ms / 1000));
      var buffer = c.createBuffer(1, frames, c.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      var noise = c.createBufferSource();
      noise.buffer = buffer;
      var band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2400;
      band.Q.value = 1.2;
      noise.connect(band); band.connect(out);
      noise.start(at); noise.stop(at + voice.ms / 1000);
      return;
    }

    var osc = c.createOscillator();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(voice.from, at);
    if (voice.kind === "step") {
      // Two pitches, not a glide — the era's hardware could not slide.
      osc.frequency.setValueAtTime(voice.to, at + voice.ms / 2000);
    } else if (voice.from !== voice.to) {
      osc.frequency.exponentialRampToValueAtTime(voice.to, at + voice.ms / 1000);
    }
    osc.connect(out);
    osc.start(at);
    osc.stop(at + voice.ms / 1000 + 0.02);

    if (voice.kind === "stab") {
      // A fifth under the fundamental: one oscillator is a beep, two are a
      // chord, and a chord is what an FM stab actually sounds like.
      var under = c.createOscillator();
      under.type = voice.type;
      under.frequency.setValueAtTime(voice.from / 1.5, at);
      under.frequency.exponentialRampToValueAtTime(voice.to / 1.5, at + voice.ms / 1000);
      var mix = c.createGain();
      mix.gain.value = 0.5;
      under.connect(mix); mix.connect(out);
      under.start(at); under.stop(at + voice.ms / 1000 + 0.02);
    }
  }

  /**
   * Is this a CONTROL? A click on the globe, on a card, on a paragraph of copy
   * or in the middle of a drag is not, and a sound on those is the thing that
   * makes people turn sound off.
   */
  function isControl(target) {
    if (!target || !target.closest) return false;
    return Boolean(target.closest(
      "button, summary, a[href], label.row, .gis-catalogue-row, .tool-rail-btn, "
      + "input[type='checkbox'], input[type='radio'], select, .button, .tool-button, "
      + ".legend-entry-head, .layer-row, [role='button']"));
  }

  function voiceForNow() {
    var skin = document.documentElement.getAttribute("data-skin");
    return skin ? VOICES[skin] : null;   // the default theme is silent
  }

  document.addEventListener("pointerdown", function (event) {
    // pointerdown rather than click: a control that feels instant has to
    // sound at the press, not on the release.
    if (!enabled() || !isControl(event.target)) return;
    play(voiceForNow());
  }, true);

  /** The switch, beside the theme picker, wired the way the picker is. */
  function wire() {
    var box = document.getElementById("gis-skin-sound");
    if (!box) { window.setTimeout(wire, 700); return; }
    box.checked = enabled();
  }
  document.addEventListener("change", function (event) {
    if (!event.target || event.target.id !== "gis-skin-sound") return;
    setEnabled(event.target.checked);
    // Play the theme's own click as the confirmation — switching it on with
    // no sound is indistinguishable from it not working.
    if (event.target.checked) play(voiceForNow());
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.GeoIDThemeSound = { VOICES: VOICES, play: play, enabled: enabled, setEnabled: setEnabled };
}());
