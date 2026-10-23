/**
 * Interface sounds for the GeoID Network: always on (owner, 2026-10-23 --
 * the header switch was removed).
 *
 * Three sounds, each tied to one moment so it is obvious what caused it, and
 * each fired on the same frame as what it confirms:
 *   tick   -- you reacted to, or reshared, a post
 *   send   -- your post went out (two rising notes)
 *   arrive -- a new message or notification came in (a soft two-note chime)
 * Nothing on navigation, hover or typing: feedback heard every few seconds is
 * feedback people learn to ignore, and then switch off.
 *
 * Synthesised with Web Audio rather than loaded, so there are no files to
 * fetch and no new origins in the page's policy. Quiet (peak gain 0.06) and
 * short (under 400 ms). A browser that blocks audio until the first gesture
 * simply stays silent until then.
 */
let ctx = null;

/** One sine note with a fast attack and an exponential tail. */
function note(ac, freq, start, dur, peak) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

const SHAPES = {
  tick: [[1320, 0, 0.06, 0.05]],
  send: [[660, 0, 0.12, 0.05], [990, 0.09, 0.2, 0.05]],
  arrive: [[880, 0, 0.22, 0.06], [1175, 0.14, 0.32, 0.05]],
};

/** Play a named sound. Never throws. */
export function play(name) {
  const shape = SHAPES[name];
  if (!shape) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, at, dur, peak] of shape) note(ctx, freq, t0 + at, dur, peak);
  } catch (error) { /* no audio: silence is the fallback */ }
}
