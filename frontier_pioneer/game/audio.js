/**
 * SOUND. Everything is synthesised here with the Web Audio API: oscillators,
 * filtered noise, convolution with impulse responses generated in JavaScript,
 * and short buffers baked from noise grains and damped modes. No audio file is
 * downloaded or shipped.
 *
 * System "audio" (order 5: its load() must run before the missions system
 * replays objectives on a load, so the replay is not heard; it reads everyone
 * else's state in frame(), not tick()).
 *
 * THE PHYSICS OF THE MIX. Mars' air is about 1% as dense as Earth's (6 to 7
 * hPa of CO2), so sound carried by the air is about 20 dB fainter for the same
 * source and loses its high frequencies within metres: Perseverance's
 * microphones heard Ingenuity's rotors 80 m away only as their 84 Hz blade
 * tone (Maurice et al. 2022, Nature 605, "In situ recording of Mars
 * soundscape"; two speeds of sound, about 240 and 250 m/s). So what the crew
 * hears is mostly STRUCTURE-BORNE:
 *   - in the rover (driving, building): through the cab. Motor and inverter
 *     whine, gear hum, the regolith under the wheels, the suspension, dust
 *     hitting the hull and the wind's pressure on it, all through a cab filter
 *     (low shelf up, highs down) and a small metal room's generated echo.
 *   - on foot: through the suit. Breathing, the fans, the heart when the
 *     oxygen or the battery runs low, footsteps through the boots, the drill
 *     through the gloves, the helmet's own tiny echo.
 *   - from the world (construction crews, dust devils, the parked rover):
 *     positional (PannerNode, the listener rides the camera) and low-passed
 *     with distance the way thin CO2 does it (cutoff 6 kHz / (1 + d / 3 m):
 *     1.4 kHz at 10 m, about 220 Hz at 80 m), then once more by the hull or
 *     the helmet.
 * Wind is quieter than an Earth game would make it (dynamic pressure scales
 * with density), and a regional storm is mostly felt: a deep rumble and the
 * hiss of grains on the hull or the visor. Radio and alerts come through the
 * crew's own speakers, band-limited like a radio. Mission messages open and
 * close with Apollo's Quindar tones (2,525 Hz in, 2,475 Hz out).
 *
 * THE GRAPH is built once, when the AudioContext is created on the first key,
 * click or touch (browsers refuse audio before a gesture): about 120 nodes,
 * every continuous voice always running with its gain ramped per frame
 * (setTargetAtTime, skipped when the target has not moved). Only events
 * create nodes (a buffer source and a gain each, rate-limited, at most 24
 * alive). Nothing here throws when there is no Web Audio: game.audio.available
 * is false and every call is a no-op.
 *
 * BUSES. master -> mute -> limiter -> speakers. Effects (the world: ducked
 * and muffled in menus), Music (the generative score), Interface (clicks,
 * toasts, stings). Volumes and the mute live in game.settings.audio and the
 * game's settings store. Mute key: N (free in every controls table).
 *
 *   game.audio = { available, started, ctx, start(), mute(on), toggleMute(), setVolume(name, v),
 *                  stats(), play(name, bus), debugEnv }      // debugEnv: {wind, storm} overrides, for tests
 */
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { KEYBOARD_HELP } from "./input.js?v=b8cfe8e-efa5b7b7";

export const AUDIO_DEFAULTS = { master: 0.8, sfx: 0.85, music: 0.3, ui: 0.6, voice: 0.9, muted: false };
/** Voice presets: processing chains for the story's lines (see Sound.voice). */
export const VOICE_PRESETS = ["helmet", "grille", "memory", "broadcast", "dry", "live", "corrupted", "glitch"];
const DUCK = 0.316;                         // -10 dB on effects and music while a line plays
export const MUTE_KEY = "KeyN";
const MAX_ONESHOTS = 24;
const TAU = Math.PI * 2;

// Base level of each continuous voice at full intensity (before the buses).
const LV = { motor: 0.16, inverter: 0.035, gear: 0.06, idle: 0.05, hum: 0.02, sand: 0.3, firm: 0.32, rock: 0.34, susp: 0.55, grind: 0.3,
  wind: 0.5, storm: 0.7, hull: 0.22, breath: 0.42, fan: 0.07, drill: 0.32, scan: 0.05, con: 0.6, devil: 0.9, rover: 0.45 };

// Where the listener is, and what that does to the outside world.
const WHERE = {
  none:  { cab: 0, suit: 0, outLP: 300,  outG: 0,    windLP: [80, 5],   windG: 0,    hullHP: 1400, hullG: 0,    stormG: 0 },
  cab:   { cab: 1, suit: 0, outLP: 450,  outG: 0.35, windLP: [85, 9],   windG: 0.42, hullHP: 1300, hullG: 1,    stormG: 1 },
  // build mode: the crew watch the crews on the external cameras and their microphones (a gameplay concession: brighter than the hull)
  build: { cab: 1, suit: 0, outLP: 1700, outG: 0.75, windLP: [85, 9],   windG: 0.38, hullHP: 1300, hullG: 0.9,  stormG: 1 },
  suit:  { cab: 0, suit: 1, outLP: 2400, outG: 0.65, windLP: [150, 20], windG: 0.55, hullHP: 2600, hullG: 0.8,  stormG: 0.9 },
  hab:   { cab: 0, suit: 0, outLP: 300,  outG: 0.2,  windLP: [70, 5],   windG: 0.25, hullHP: 1200, hullG: 0.5,  stormG: 0.8 },
};

// The score: D lydian by day, D aeolian in a storm. MIDI note numbers.
const BRIGHT = [[50, 57, 61, 66], [52, 59, 62, 68], [47, 54, 61, 64], [45, 52, 61, 66], [54, 57, 64, 68]];
const DARK = [[50, 57, 60, 65], [46, 53, 58, 62], [43, 50, 58, 62], [45, 52, 57, 60]];
const SCALE_BRIGHT = [62, 64, 66, 68, 69, 71, 73], SCALE_DARK = [62, 64, 65, 67, 69, 70, 72];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const curve = (v) => Math.pow(clamp(v, 0, 1), 1.6);                  // slider -> gain (perceptual)
const martianLP = (d) => clamp(6000 / (1 + d / 3), 90, 8000);
const NOCTL = { throttle: 0, brake: 0 };

if (!KEYBOARD_HELP.some((r) => r[0] === "N")) KEYBOARD_HELP.push(["N", "Sound on / off"]);

/* ── baking: a little DSP in JavaScript ─────────────────────────────────── */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** An RBJ biquad as a closure: x -> y. type "lp" | "hp" | "bp" (0 dB peak). */
function filt(type, f, Q, sr) {
  const w = TAU * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q), a0 = 1 + al;
  let b0, b1, b2;
  if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = -2 * c / a0, A2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const arr = (sr, s) => new Float32Array(Math.max(1, Math.round(sr * s)));
function noise(n, colour, r) {
  const o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    if (colour === "white") o[i] = w;
    else if (colour === "pink") { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; o[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else { br = (br + 0.02 * w) / 1.02; o[i] = br * 3.5; }
  }
  return o;
}
function norm(o, peak = 0.9) { let m = 0; for (let i = 0; i < o.length; i++) { const a = Math.abs(o[i]); if (a > m) m = a; } if (m > 0) { const k = peak / m; for (let i = 0; i < o.length; i++) o[i] *= k; } return o; }
/** Crossfade the tail into the head and drop the tail: the buffer then loops without a seam. */
function loopify(o, sr, s = 0.06) {
  const L = o.length, n = Math.min(L >> 2, Math.round(sr * s)), out = new Float32Array(L - n);
  for (let i = 0; i < L - n; i++) out[i] = o[i];
  for (let i = 0; i < n; i++) { const k = i / n; out[i] = o[i] * k + o[L - n + i] * (1 - k); }
  return out;
}
/** A damped sinusoid (a struck mode). */
function mode(o, sr, t0, f, decay, amp, attack = 0.0015) {
  const s0 = Math.round(t0 * sr), n = Math.min(o.length - s0, Math.round(decay * 7 * sr)), w = TAU * f / sr, k = Math.exp(-1 / (decay * sr)), na = Math.max(1, attack * sr);
  let e = amp;
  for (let i = 0; i < n; i++) { o[s0 + i] += e * Math.min(1, i / na) * Math.sin(w * i); e *= k; }
}
/** A noise burst: linear attack, exponential decay (time constant `dur`), optionally filtered. */
function burst(o, sr, t0, dur, amp, r, f = null, attack = 0.0004) {
  const s0 = Math.round(t0 * sr), n = Math.min(o.length - s0, Math.round(dur * 6 * sr)), na = Math.max(1, attack * sr), k = Math.exp(-1 / (dur * sr));
  let e = amp;
  for (let i = 0; i < n; i++) { const x = (r() * 2 - 1) * e * Math.min(1, i / na); o[s0 + i] += f ? f(x) : x; if (i >= na) e *= k; }
}
/** A tone gliding exponentially from f0 to f1, with harmonics and short fades. */
function glide(o, sr, t0, dur, f0, f1, amp, harm = [1], fade = 0.008) {
  const s0 = Math.round(t0 * sr), n = Math.min(o.length - s0, Math.round(dur * sr)), nf = Math.max(1, fade * sr);
  const k = Math.pow(f1 / f0, 1 / Math.max(1, n));
  let ph = 0, f = f0;
  for (let i = 0; i < n; i++) {
    f *= k; ph += TAU * f / sr;
    let v = 0; for (let h = 0; h < harm.length; h++) if (harm[h]) v += harm[h] * Math.sin(ph * (h + 1));
    o[s0 + i] += v * amp * Math.min(1, i / nf, (n - i) / nf);
  }
}
/** A low thud: a sine whose pitch drops from f0 to f1. */
function thud(o, sr, t0, f0, f1, decay, amp) {
  const s0 = Math.round(t0 * sr), n = Math.min(o.length - s0, Math.round(decay * 7 * sr)), na = 0.002 * sr;
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.035)) / sr; o[s0 + i] += amp * Math.exp(-t / decay) * Math.min(1, i / na) * Math.sin(ph); }
}
/** A struck bell: four inharmonic partials. */
function bell(o, sr, t0, f, amp, dur) {
  const P = [[1, 1, 1], [2.756, 0.45, 0.5], [5.404, 0.22, 0.28], [8.933, 0.1, 0.14]];
  for (const [m, a, d] of P) mode(o, sr, t0, f * m, dur * d, amp * a, 0.003);
}
function grains(o, sr, r, t0, t1, n, amp, f0, f1) { for (let i = 0; i < n; i++) burst(o, sr, t0 + r() * (t1 - t0), 0.002 + r() * 0.005, amp * (0.3 + r() * 0.7), r, filt("bp", f0 + r() * (f1 - f0), 2, sr)); }
function process(o, ...fs) { for (let i = 0; i < o.length; i++) { let x = o[i]; for (const f of fs) x = f(x); o[i] = x; } return o; }
/** One-pole low-pass sweep (no clicks when the cutoff moves), cutoff(x) for x in 0..1 over the buffer. */
function sweep(o, sr, cutoff) { let y = 0; for (let i = 0; i < o.length; i++) { const a = 1 - Math.exp(-TAU * cutoff(i / o.length) / sr); y += a * (o[i] - y); o[i] = y; } return o; }
const radio = (o, sr) => process(o, filt("hp", 320, 0.7, sr), filt("hp", 320, 0.7, sr), filt("lp", 3200, 0.7, sr), filt("lp", 3200, 0.7, sr));

/* The continuous textures and the rooms, baked when the context is created. */
const TEXTURES = {
  white: (sr) => [11, 12].map((s) => loopify(norm(noise(sr * 3, "white", rng(s)), 0.7), sr)),
  pink: (sr) => [21, 22].map((s) => loopify(norm(noise(sr * 4, "pink", rng(s)), 0.8), sr)),
  brown: (sr) => [31, 32].map((s) => loopify(norm(noise(sr * 4, "brown", rng(s)), 0.85), sr)),
  // firm ground under a wheel: dense grains of crushed crust, and the body of the rolling
  crunch: (sr) => {
    const o = arr(sr, 2.6), r = rng(41);
    for (let t = 0; t < 2.6;) { t += -Math.log(1 - r()) / 46; burst(o, sr, t, 0.002 + r() * 0.007, Math.pow(0.2 + r(), 2), r, filt("bp", 500 + r() * 2200, 1.2 + r() * 3, sr)); }
    const b = noise(o.length, "brown", r); for (let i = 0; i < o.length; i++) o[i] += b[i] * 0.08;
    return norm(loopify(o, sr), 0.85);
  },
  // rocks: sparse sharp hits that ring, each with a low knock
  clatter: (sr) => {
    const o = arr(sr, 3), r = rng(43);
    for (let t = 0; t < 2.9;) {
      t += -Math.log(1 - r()) / 8;
      const hits = 1 + Math.floor(r() * 3);
      for (let h = 0; h < hits; h++) {
        const th = t + h * (0.006 + r() * 0.02); if (th > 2.95) break;
        burst(o, sr, th, 0.0008, 0.5, r, filt("bp", 3000, 1, sr));
        for (let k = 0; k < 2 + (r() < 0.5 ? 1 : 0); k++) mode(o, sr, th, 900 + r() * 3300, 0.006 + r() * 0.014, 0.25 + r() * 0.35, 0.0003);
        mode(o, sr, th, 140 + r() * 180, 0.025, 0.35, 0.0005);
      }
    }
    return norm(loopify(o, sr), 0.85);
  },
  // dust and sand grains hitting metal or a visor: a dense rain of ticks with a faint ring
  hull: (sr) => [51, 52].map((s) => {
    const o = arr(sr, 2), r = rng(s);
    for (let t = 0; t < 2;) { t += -Math.log(1 - r()) / 650; burst(o, sr, t, 0.00015 + r() * 0.0004, Math.pow(r(), 3), r); }
    const r1 = filt("bp", 2300, 18, sr), r2 = filt("bp", 4100, 14, sr), hp = filt("hp", 1200, 0.7, sr);
    for (let i = 0; i < o.length; i++) { const x = hp(o[i]); o[i] = x + 0.5 * r1(x) + 0.4 * r2(x); }
    return norm(loopify(o, sr), 0.8);
  }),
  // a construction crew: servo whirs, a ratchet, set-down thuds, hydraulics, a motor under it all
  machine: (sr) => {
    const o = arr(sr, 4.4), r = rng(61), H = [1, 0.5, 0.33, 0.25, 0.12];
    glide(o, sr, 0.2, 0.9, 280, 520, 0.22, H, 0.08); glide(o, sr, 1.6, 0.6, 520, 300, 0.2, H, 0.06); glide(o, sr, 3.0, 1.0, 300, 480, 0.2, H, 0.08);
    for (let t = 1.15; t < 1.5; t += 0.028) { burst(o, sr, t, 0.0006, 0.5, r, filt("bp", 3000, 1.5, sr)); mode(o, sr, t, 2500, 0.004, 0.25, 0.0003); }
    thud(o, sr, 2.4, 70, 45, 0.12, 0.6); mode(o, sr, 2.4, 180, 0.15, 0.2); mode(o, sr, 2.4, 330, 0.1, 0.12);
    thud(o, sr, 3.9, 80, 50, 0.08, 0.35);
    const hp = filt("hp", 2000, 0.7, sr); burst(o, sr, 2.5, 0.25, 0.12, r, hp, 0.08);
    glide(o, sr, 0, 4.4, 48, 48, 0.1, [1, 0.6, 0.3], 0.05);
    process(o, filt("lp", 4500, 0.7, sr));
    return norm(loopify(o, sr, 0.15), 0.85);
  },
  // a small metal room (the cab): early reflections and a short, low-heavy tail
  irCab: (sr) => [71, 72].map((s) => {
    const o = arr(sr, 0.45), r = rng(s), lp = filt("lp", 3500, 0.7, sr), bp = filt("bp", 600, 0.5, sr);
    for (let i = 0; i < o.length; i++) o[i] = (r() * 2 - 1) * Math.exp(-i / sr / 0.06);
    for (const [ms, a] of [[2.1, 0.6], [3.7 + r(), 0.5], [5.3, 0.4], [8.9 + r() * 2, 0.3], [11.4, 0.2]]) o[Math.round(ms / 1000 * sr)] += a * (r() < 0.5 ? -1 : 1);
    for (let i = 0; i < o.length; i++) { const x = o[i]; o[i] = 0.6 * lp(x) + 0.8 * bp(x); }
    return o;
  }),
  // inside a helmet: a few centimetres of air, so only the first milliseconds and its resonance
  irHelm: (sr) => [73, 74].map((s) => {
    const o = arr(sr, 0.14), r = rng(s);
    for (let i = 0; i < o.length; i++) o[i] = (r() * 2 - 1) * Math.exp(-i / sr / 0.015);
    mode(o, sr, 0, 560, 0.03, 0.3, 0.0002); mode(o, sr, 0, 1130, 0.03, 0.2, 0.0002); mode(o, sr, 0, 1690, 0.025, 0.12, 0.0002);
    return process(o, filt("lp", 3000, 0.7, sr));
  }),
  // the score's hall: a long tail that darkens as it decays
  irHall: (sr) => [75, 76].map((s) => {
    const n = Math.round(sr * 3.6), r = rng(s), lb = filt("lp", 7000, 0.7, sr), ld = filt("lp", 1400, 0.7, sr), o = new Float32Array(n), pre = Math.round(0.025 * sr);
    const kb = Math.exp(-1 / (0.5 * sr)), kd = Math.exp(-1 / (1.3 * sr)), na = 0.01 * sr;
    let eb = 1, ed = 0.8;
    for (let i = pre; i < n; i++) { const a = Math.min(1, (i - pre) / na); o[i] = a * (lb(r() * 2 - 1) * eb + ld(r() * 2 - 1) * ed); eb *= kb; ed *= kd; }
    return o;
  }),
};

/* Event sounds, baked on first use (a few milliseconds each). Each returns samples (mono) or [L, R]. */
const STEP = {
  sand: (o, sr, r) => { burst(o, sr, 0, 0.07, 0.6, r, filt("lp", 520, 0.7, sr), 0.03); grains(o, sr, r, 0.01, 0.08, 4, 0.12, 400, 1200); thud(o, sr, 0.005, 70, 50, 0.04, 0.35); },
  firm: (o, sr, r) => { thud(o, sr, 0, 95, 60, 0.03, 0.6); grains(o, sr, r, 0.005, 0.07, 8 + Math.floor(r() * 6), 0.4, 700, 2200); },
  rock: (o, sr, r) => { burst(o, sr, 0, 0.002, 0.6, r, filt("bp", 2500, 1, sr)); mode(o, sr, 0, 700 + r() * 800, 0.012, 0.3, 0.0003); thud(o, sr, 0, 110, 70, 0.025, 0.5); grains(o, sr, r, 0.01, 0.06, 3, 0.2, 900, 2600); },
};
const ONE = {
  thump: (sr, r) => { const o = arr(sr, 0.4); thud(o, sr, 0, 72, 40, 0.09, 0.9); burst(o, sr, 0, 0.012, 0.35, r, filt("lp", 700, 0.7, sr)); mode(o, sr, 0, 160, 0.06, 0.2); return norm(o, 0.9); },
  thumpHard: (sr, r) => { const o = arr(sr, 0.6); thud(o, sr, 0, 80, 38, 0.11, 1); burst(o, sr, 0, 0.015, 0.4, r, filt("lp", 1200, 0.7, sr)); for (const [f, a] of [[190, 0.25], [410, 0.18], [870, 0.1]]) mode(o, sr, 0, f, 0.12, a); grains(o, sr, r, 0.02, 0.15, 10, 0.12, 1500, 3500); return norm(o, 0.95); },
  impact: (sr, r) => {
    const o = arr(sr, 1.1); burst(o, sr, 0, 0.05, 1, r, filt("lp", 2500, 0.7, sr)); thud(o, sr, 0, 60, 35, 0.18, 1);
    [97, 143, 231, 388, 612, 1033, 1650, 2410].forEach((f, i) => mode(o, sr, 0, f * (0.97 + r() * 0.06), 0.15 + r() * 0.55, (0.15 + r() * 0.3) / (1 + i * 0.3), 0.0005));
    for (let i = 0; i < 40; i++) { const t = 0.03 + Math.pow(r(), 1.5) * 0.47; burst(o, sr, t, 0.003, 0.25 * (1 - t / 0.55), r, filt("bp", 1000 + r() * 3000, 2, sr)); }
    return norm(o, 0.95);
  },
  relay: (sr, r) => { const o = arr(sr, 0.08); for (const t of [0, 0.013]) { burst(o, sr, t, 0.0008, 0.8, r, filt("bp", 3000, 1, sr)); mode(o, sr, t, 3100, 0.004, 0.4, 0.0002); mode(o, sr, t, 950, 0.008, 0.25, 0.0002); } return norm(o, 0.8); },
  servo: (sr, r) => { const o = arr(sr, 0.45); glide(o, sr, 0.02, 0.34, 380, 720, 0.35, [1, 0.45, 0.3, 0.2], 0.04); process(o, filt("lp", 2500, 0.7, sr)); burst(o, sr, 0.37, 0.001, 0.4, r, filt("bp", 2800, 1, sr)); return norm(o, 0.7); },
  land: (sr, r) => { const o = arr(sr, 0.6); thud(o, sr, 0, 85, 42, 0.12, 1); burst(o, sr, 0, 0.06, 0.5, r, filt("lp", 600, 0.7, sr), 0.01); grains(o, sr, r, 0.02, 0.2, 10, 0.15, 800, 2000); return norm(o, 0.95); },
  scuff: (sr, r) => { const o = arr(sr, 0.2); burst(o, sr, 0, 0.05, 0.6, r, filt("lp", 900, 0.7, sr), 0.015); return norm(o, 0.6); },
  flag: (sr, r) => { const o = arr(sr, 0.9); thud(o, sr, 0, 110, 55, 0.07, 0.9); grains(o, sr, r, 0, 0.05, 6, 0.2, 600, 1800); [[523, 0.5, 0.18], [1412, 0.3, 0.12], [2634, 0.18, 0.08], [3870, 0.1, 0.05]].forEach(([f, d, a]) => mode(o, sr, 0.005, f, d, a)); return norm(o, 0.9); },
  beacon: (sr, r) => { const o = arr(sr, 0.9); thud(o, sr, 0, 110, 55, 0.07, 0.8); grains(o, sr, r, 0, 0.05, 6, 0.2, 600, 1800); for (const t of [0.18, 0.45]) { mode(o, sr, t, 1760, 0.25, 0.35, 0.002); mode(o, sr, t, 2640, 0.15, 0.15, 0.002); } return norm(o, 0.85); },
  tube: (sr, r) => { const o = arr(sr, 0.3); burst(o, sr, 0, 0.04, 0.2, r, filt("bp", 2500, 1, sr), 0.02); for (const t of [0.04, 0.11]) { burst(o, sr, t, 0.0008, 0.7, r, filt("bp", 3000, 1, sr)); mode(o, sr, t, 2100, 0.05, 0.3, 0.0003); mode(o, sr, t, 1350, 0.04, 0.2, 0.0003); } return norm(o, 0.8); },
  hatch: (sr, r) => {
    const o = arr(sr, 1.9); thud(o, sr, 0, 70, 40, 0.1, 0.9); [[210, 0.15, 0.3], [460, 0.1, 0.2], [980, 0.06, 0.1]].forEach(([f, d, a]) => mode(o, sr, 0, f, d, a));
    burst(o, sr, 0.12, 0.0008, 0.6, r, filt("bp", 3000, 1, sr));
    const h = new Float32Array(o.length), s0 = Math.round(0.25 * sr), n = Math.round(1.55 * sr), hp = filt("hp", 400, 0.7, sr);
    for (let i = 0; i < n; i++) { const x = i / n, e = Math.min(1, x / 0.04) * Math.pow(1 - x, 1.5); h[s0 + i] = hp(r() * 2 - 1) * e * 0.35; }
    sweep(h, sr, (x) => 3200 - 2400 * x); for (let i = 0; i < o.length; i++) o[i] += h[i];
    return norm(o, 0.9);
  },
  place: (sr) => { const o = arr(sr, 0.7); thud(o, sr, 0, 80, 45, 0.07, 0.8); mode(o, sr, 0, 240, 0.1, 0.25); mode(o, sr, 0, 520, 0.1, 0.12); thud(o, sr, 0.13, 95, 50, 0.06, 0.9); mode(o, sr, 0.13, 300, 0.08, 0.22); mode(o, sr, 0.13, 700, 0.08, 0.1); glide(o, sr, 0.2, 0.09, 660, 990, 0.16); glide(o, sr, 0.3, 0.12, 990, 990, 0.12, [1], 0.02); return norm(o, 0.9); },
  built: (sr) => { const o = arr(sr, 2.2); bell(o, sr, 0, 587.33, 0.5, 1.6); bell(o, sr, 0.12, 880, 0.45, 1.6); bell(o, sr, 0.24, 1479.98, 0.4, 1.8); return norm(o, 0.8); },
  purchase: (sr) => { const o = arr(sr, 2.2); bell(o, sr, 0, 783.99, 0.5, 1.4); bell(o, sr, 0.1, 1174.66, 0.45, 1.4); bell(o, sr, 0.2, 1567.98, 0.4, 1.6); return norm(o, 0.75); },
  salvage: (sr, r) => {
    const o = arr(sr, 1.1);
    for (let t = 0, d = 0.02; t < 0.6; t += d, d *= 1.06) { burst(o, sr, t, 0.0006, 0.5, r, filt("bp", 2800, 1.5, sr)); mode(o, sr, t, 2200, 0.004, 0.3, 0.0002); }
    const g = arr(sr, 1.1); glide(g, sr, 0, 0.8, 520, 170, 0.2, [1, 0.5, 0.3], 0.04); process(g, filt("lp", 1500, 0.7, sr)); for (let i = 0; i < o.length; i++) o[i] += g[i];
    thud(o, sr, 0.85, 70, 40, 0.08, 0.6); return norm(o, 0.85);
  },
  refuse: (sr) => { const o = arr(sr, 0.35), H = [1, 0, 0.33, 0, 0.2, 0, 0.14]; glide(o, sr, 0, 0.09, 150, 150, 0.5, H); glide(o, sr, 0.15, 0.09, 120, 120, 0.5, H); process(o, filt("lp", 1200, 0.7, sr)); return norm(o, 0.7); },
  click: (sr, r) => { const o = arr(sr, 0.03); mode(o, sr, 0, 2300, 0.0035, 0.8, 0.0002); burst(o, sr, 0, 0.0004, 0.4, r); return norm(o, 0.8); },
  hover: (sr) => { const o = arr(sr, 0.025); mode(o, sr, 0, 3600, 0.0022, 0.6, 0.0002); return norm(o, 0.5); },
  tick: (sr) => { const o = arr(sr, 0.02); mode(o, sr, 0, 2900, 0.0018, 0.6, 0.0002); return norm(o, 0.45); },
  toast: (sr) => { const o = arr(sr, 0.6); mode(o, sr, 0, 1318.5, 0.25, 0.5, 0.003); mode(o, sr, 0.045, 1975.5, 0.22, 0.35, 0.003); mode(o, sr, 0, 659.25, 0.3, 0.15, 0.003); return norm(o, 0.55); },
  objective: (sr) => {
    const o = arr(sr, 2); [[0, 587.33], [0.13, 880], [0.26, 1174.66]].forEach(([t, f]) => bell(o, sr, t, f, 0.4, 1.2));
    for (const f of [293.66, 440, 587.33]) for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] += 0.08 * Math.min(1, t / 0.2) * Math.exp(-t / 0.9) * Math.sin(TAU * f * t); }
    return norm(o, 0.75);
  },
  complete: (sr) => {
    const o = arr(sr, 3.4), F = [587.33, 739.99, 880, 1108.73, 1318.51];
    F.forEach((f, i) => bell(o, sr, i * 0.11, f, 0.38, 1.8));
    for (let i = 0; i < o.length; i++) {
      const t = i / sr, a = Math.min(1, t / 0.4) * Math.exp(-t / 1.6), v = Math.sin(TAU * 5 * t) * 0.002;
      let s = 0; for (const f of F) s += Math.sin(TAU * f * t * (1 + v)); o[i] += 0.05 * a * s + a * (0.12 * Math.sin(TAU * 146.83 * t) + 0.08 * Math.sin(TAU * 73.42 * t));
    }
    return norm(o, 0.8);
  },
  warpOn: (sr, r) => { const o = noise(Math.round(sr * 0.6), "white", r); for (let i = 0; i < o.length; i++) o[i] *= Math.sin(Math.PI * i / o.length) * 0.4; sweep(o, sr, (x) => 300 + 4200 * x * x); process(o, filt("hp", 200, 0.7, sr)); glide(o, sr, 0, 0.55, 220, 880, 0.08, [1], 0.1); return norm(o, 0.6); },
  warpOff: (sr, r) => { const o = noise(Math.round(sr * 0.6), "white", r); for (let i = 0; i < o.length; i++) o[i] *= Math.sin(Math.PI * i / o.length) * 0.4; sweep(o, sr, (x) => 300 + 4200 * (1 - x) * (1 - x)); process(o, filt("hp", 200, 0.7, sr)); glide(o, sr, 0, 0.55, 880, 220, 0.08, [1], 0.1); return norm(o, 0.6); },
  quindarIn: (sr, r) => { const o = arr(sr, 0.55); burst(o, sr, 0, 0.06, 0.25, r, filt("bp", 1800, 0.6, sr), 0.005); glide(o, sr, 0.08, 0.25, 2525, 2525, 0.5, [1], 0.004); return norm(radio(o, sr), 0.7); },
  quindarOut: (sr, r) => { const o = arr(sr, 0.5); glide(o, sr, 0, 0.25, 2475, 2475, 0.5, [1], 0.004); burst(o, sr, 0.27, 0.06, 0.2, r, filt("bp", 1800, 0.6, sr), 0.005); return norm(radio(o, sr), 0.7); },
  alert: (sr) => { const o = arr(sr, 0.9), H = [1, 0, 0.11, 0, 0.04]; for (const t of [0, 0.42]) { glide(o, sr, t, 0.15, 880, 880, 0.5, H); glide(o, sr, t + 0.18, 0.16, 660, 660, 0.5, H); } return norm(radio(o, sr), 0.7); },
  caution: (sr) => { const o = arr(sr, 0.6); for (const t of [0, 0.17, 0.34]) glide(o, sr, t, 0.09, 1000, 1000, 0.5, [1, 0, 0.2]); return norm(radio(o, sr), 0.7); },
  powerdown: (sr) => { const o = arr(sr, 1.1); glide(o, sr, 0, 1.0, 620, 110, 0.5, [1, 0.4, 0.2], 0.05); process(o, filt("lp", 1800, 0.7, sr)); return norm(o, 0.7); },
  heart: (sr, r) => { const o = arr(sr, 0.6); thud(o, sr, 0, 62, 44, 0.07, 1); burst(o, sr, 0, 0.02, 0.3, r, filt("lp", 200, 0.7, sr)); thud(o, sr, 0.26, 70, 50, 0.055, 0.65); return norm(o, 0.9); },
  suitAlarm: (sr) => { const o = arr(sr, 1.0); for (let k = 0; k < 8; k++) glide(o, sr, k * 0.125, 0.11, k % 2 ? 940 : 1250, k % 2 ? 940 : 1250, 0.45, [1, 0, 0.12]); return norm(radio(o, sr), 0.65); },
  sampleDone: (sr, r) => { const o = ONE.tube(sr, r), p = new Float32Array(Math.round(sr * 0.6)); p.set(o.subarray(0, Math.min(o.length, p.length))); mode(p, sr, 0.12, 1046.5, 0.12, 0.25, 0.003); mode(p, sr, 0.22, 1568, 0.14, 0.22, 0.003); return norm(p, 0.75); },
  scanDone: (sr) => { const o = arr(sr, 0.45); [1760, 2349, 1976, 2637, 2093, 3136].forEach((f, i) => glide(o, sr, i * 0.05, 0.035, f, f, 0.3, [1], 0.004)); return norm(o, 0.6); },
};
for (const k of Object.keys(STEP)) for (let v = 0; v < 3; v++) ONE[`step_${k}${v}`] = (sr) => { const o = arr(sr, 0.24); STEP[k](o, sr, rng(900 + v * 17 + k.length)); return norm(o, 0.9); };

/* ── the sound system ───────────────────────────────────────────────────── */

class Sound {
  constructor(game) {
    this.game = game;
    this.available = typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);
    this.ctx = null; this.error = null;
    game.settings.audio = Object.assign({}, AUDIO_DEFAULTS, game.settings.audio || {});
    this.levels = { construction: [0, 0], devils: [0, 0] };
    this.counts = {}; this.live = 0; this.total = 0; this.dropped = 0; this.nodes = 0;
    this.where = "none"; this.quietUntil = 0; this.debugEnv = null;
    this._rl = {}; this._bufs = {}; this._ms = { avg: 0, max: 0, n: 0, win: 0 };
    this._voices = new Set(); this._vid = 0; this._vcache = new Map(); this._telem = false;
    this.voiceQueue = makeQueue(this);
    const self = this;
    /** For the story: getSystem("audio").api, or game.audio.api. */
    this.api = {
      voice: (src, o) => self.voice(src, o),
      voiceQueue: this.voiceQueue,
      stopVoices: () => self.stopVoices(),
      preload: (urls) => Promise.all([].concat(urls || []).map((u) => self._load(u).catch(() => null))),
      filterGlitch: (intensity, seconds) => self.filterGlitch(intensity, seconds),
      telemetry: (on) => self.telemetry(on),
      get telemetryOn() { return self._telem; },
      get speaking() { return self._voices.size > 0; },
      presets: VOICE_PRESETS,
    };
    this._reset();
  }
  get s() { return this.game.settings.audio; }
  get started() { return !!this.ctx; }
  _reset() {
    this._loads = null; this._contact = null; this._air = null; this._pv = null; this._pp = null; this._suspE = 0; this._torque = 0;
    this._bat = null; this._flat = null; this._tipped = null; this._lights = null; this._rig = null; this._warp = null; this._hon = null; this._lamp = null;
    this._M = 115; this._bp = 0; this._huff = 0; this._hp = 0; this._alarmT = 0; this._bt = 0;
  }

  /* ── start (on a gesture), mute, volumes ── */

  start() {
    if (!this.available) return false;
    try {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        this.ctx = new C({ latencyHint: "interactive" });
        try { this._build(); }
        catch (e) { try { this.ctx.close(); } catch { /* already closed */ } this.ctx = null; throw e; }
      }
      if (this.ctx.state === "suspended" && !document.hidden) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      return true;
    } catch (err) {
      this.available = false; this.error = String((err && err.message) || err);
      console.warn("[audio] no sound:", this.error);
      return false;
    }
  }
  mute(on) {
    this.s.muted = !!on;
    this.applyVolumes(); this.game.applySettings(); this._syncUi();
    return this.s.muted;
  }
  toggleMute() {
    const m = this.mute(!this.s.muted);
    if (this.game.ready && this.game.hud && this.game.hud.toast) this.game.hud.toast(m ? "Sound off<small>N turns it back on</small>" : "Sound on", 1.8);
    return m;
  }
  setVolume(name, v) {
    if (!(name in AUDIO_DEFAULTS) || name === "muted") return;
    this.s[name] = clamp(+v || 0, 0, 1); this.applyVolumes(); this.game.applySettings(); this._syncUi();
  }
  applyVolumes() {
    if (!this.ctx) return;
    const s = this.s, B = this.bus;
    this.set(B.master.gain, curve(s.master), 0.03); this.set(B.sfx.gain, curve(s.sfx), 0.03);
    this.set(B.music.gain, curve(s.music), 0.05); this.set(B.ui.gain, curve(s.ui), 0.03);
    this.set(B.voice.gain, curve(s.voice ?? AUDIO_DEFAULTS.voice), 0.03);
    this.set(B.mute.gain, s.muted ? 0 : 1, 0.03);
  }
  /** Ramp a parameter toward v, unless it is already headed there. */
  set(p, v, tau = 0.05) {
    if (!p || !Number.isFinite(v)) return;
    if (p._last !== undefined && Math.abs(p._last - v) <= 1e-4 * Math.max(1, Math.abs(v))) return;
    p._last = v; p.setTargetAtTime(v, this.ctx.currentTime, tau);
  }

  /* ── the graph ── */

  _n(node) { this.nodes++; return node; }
  _g(v = 0, ...to) { const g = this._n(this.ctx.createGain()); g.gain.value = v; for (const t of to) g.connect(t); return g; }
  _f(type, f, Q = 0.7, ...to) { const b = this._n(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; for (const t of to) b.connect(t); return b; }
  _o(type, f, ...to) { const o = this._n(this.ctx.createOscillator()); if (typeof type === "string") o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; for (const t of to) o.connect(t); o.start(); return o; }
  _src(buf, ...to) { const s = this._n(this.ctx.createBufferSource()); s.buffer = buf; s.loop = true; for (const t of to) s.connect(t); s.start(0, Math.random() * buf.duration); return s; }
  _buffer(data) {
    const ch = Array.isArray(data) ? data : [data], b = this.ctx.createBuffer(ch.length, ch[0].length, this.ctx.sampleRate);
    ch.forEach((d, i) => b.getChannelData(i).set(d));
    return b;
  }
  _conv(buf, ...to) { const c = this._n(this.ctx.createConvolver()); c.buffer = buf; for (const t of to) c.connect(t); return c; }
  _panner(ref, roll, ...to) {
    const p = this._n(this.ctx.createPanner());
    p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 4000;
    for (const t of to) p.connect(t);
    return p;
  }
  _an(from) { const a = this._n(this.ctx.createAnalyser()); a.fftSize = 2048; from.connect(a); return a; }

  _build() {
    const c = this.ctx, sr = c.sampleRate, T = {};
    for (const k in TEXTURES) T[k] = this._buffer(TEXTURES[k](sr));
    // buses
    const lim = this._n(c.createDynamicsCompressor());
    lim.threshold.value = -9; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.25;
    lim.connect(c.destination);
    const mute = this._g(this.s.muted ? 0 : 1, lim), master = this._n(c.createGain()); master.gain.value = curve(this.s.master);
    // the glitch stage (filterGlitch): dry, a freezable delay loop (stutter), a bit-crusher; all scheduled, never per frame
    this._tex = T; this._curves = {};
    const glDry = this._g(1, mute), glWet = this._g(0, mute), glCrushG = this._g(0, mute), glDelay = this._n(c.createDelay(1));
    glDelay.delayTime.value = 0.08; glDelay.connect(glWet); const glFb = this._g(0, glDelay); glDelay.connect(glFb);
    const glIn = this._g(1, glDelay), glCrush = this._n(c.createWaveShaper()); glCrush.curve = this._crushCurve(5); glCrush.connect(glCrushG);
    master.connect(glDry); master.connect(glIn); master.connect(glCrush);
    this.gl = { dry: glDry, wet: glWet, fb: glFb, inp: glIn, delay: glDelay, crush: glCrushG };
    // effects and music are ducked while a voice line plays; the interface and the voices are not
    const duckFx = this._g(1, master), duckMus = this._g(1, master);
    const sfx = this._g(curve(this.s.sfx), duckFx), music = this._g(curve(this.s.music), duckMus), ui = this._g(curve(this.s.ui), master);
    const voice = this._g(curve(this.s.voice), master);
    this.vx = { room: this._conv(T.irCab, this._g(0.8, voice)), hall: this._conv(T.irHall, this._g(0.9, voice)) };
    // telemetry mode's mechanical hum (straight into the effects bus: it is all that is left)
    const telG = this._g(0, sfx); this.telG = telG;
    const worldLP = this._f("lowpass", 18000, 0.7, sfx), world = this._g(0, worldLP);
    this.bus = { lim, mute, master, sfx, music, ui, voice, duckFx, duckMus, world, worldLP };
    this.an = { master: this._an(lim), sfx: this._an(sfx), music: this._an(music), ui: this._an(ui), voice: this._an(voice) };
    // the cab: structure-borne, low shelf up, highs down, a small metal room
    const cabShelf = this._f("lowshelf", 160, 0.7, world); cabShelf.gain.value = 4;
    const cabLP = this._f("lowpass", 3200, 0.7, cabShelf), cabVerb = this._conv(T.irCab, this._g(0.5, world));
    const cabIn = this._g(1, cabLP, this._g(0.35, cabVerb)), cabGate = this._g(0, cabIn);
    // the suit: through the boots, the gloves, the helmet's few centimetres of air
    const suitLP = this._f("lowpass", 3800, 0.7, world), helmVerb = this._conv(T.irHelm, this._g(0.6, world));
    const suitIn = this._g(1, suitLP, this._g(0.5, helmVerb)), suitGate = this._g(0, suitIn);
    // the outside world, through thin air and then the hull or the visor
    const outG = this._g(0, world), outLP = this._f("lowpass", 1000, 0.7, outG);
    const comms = this._g(0.9, world);
    this.grp = { cabIn, cabGate, suitIn, suitGate, outLP, outG, comms };

    // noise beds: several sources per colour at different offsets, so the voices are not correlated
    const P1 = this._src(T.pink), P2 = this._src(T.pink), B1 = this._src(T.brown), B2 = this._src(T.brown), W1 = this._src(T.white);
    const V = this.v = {};
    // ── the rover (into the cab) ──
    const motorWave = c.createPeriodicWave(new Float32Array(13), Float32Array.from([0, 1, 0.5, 0.3, 0.12, 0, 0.25, 0, 0, 0, 0, 0, 0.12]));
    V.motorG = this._g(0, cabGate); V.motor = this._o(motorWave, 30, V.motorG);
    V.invG = this._g(0, cabGate); V.inv = this._o("sine", 900, V.invG);
    const vib = this._o("sine", 5.3, this._g(5, V.inv.frequency)); void vib;
    V.gearG = this._g(0, cabGate); V.gear = this._o("triangle", 120, this._f("lowpass", 1400, 0.7, V.gearG));
    V.idleG = this._g(0, cabGate); this._src(T.pink, this._f("bandpass", 240, 0.8, V.idleG));
    const humWave = c.createPeriodicWave(new Float32Array(6), Float32Array.from([0, 1, 0.6, 0.35, 0.2, 0.1]));
    this._o(humWave, 100, this._g(0.4, V.idleG));
    this._o(humWave, 60, this._g(0.5, telG)); this._src(T.pink, this._f("bandpass", 120, 1.2, this._g(0.6, telG)));
    this._o("square", 0.9, this._f("bandpass", 1800, 8, this._g(0.02, telG)));
    V.sandG = this._g(0, cabGate); V.sandLP = this._f("lowpass", 1800, 0.7, V.sandG); P1.connect(this._f("highpass", 500, 0.7, V.sandLP));
    V.firmG = this._g(0, cabGate); V.firm = this._src(T.crunch, this._f("bandpass", 1100, 0.5, V.firmG));
    V.rockG = this._g(0, cabGate); V.rock = this._src(T.clatter, V.rockG);
    V.suspG = this._g(0, cabGate); B2.connect(this._f("lowpass", 140, 0.9, V.suspG));
    V.grindG = this._g(0, cabGate); V.grindAM = this._g(0.5, V.grindG); V.grindBP = this._f("bandpass", 320, 4, V.grindAM); W1.connect(V.grindBP);
    V.grindLFO = this._o("square", 22, this._g(0.5, V.grindAM.gain));
    // ── weather (straight to the world; the filters depend on where you are) ──
    V.windG = this._g(0, world); V.windLP = this._f("lowpass", 200, 0.9, V.windG); B1.connect(V.windLP);
    V.stormG = this._g(0, world); this._src(T.brown, this._f("lowpass", 70, 0.8, V.stormG));
    V.hullG = this._g(0, world); V.hullHP = this._f("highpass", 1300, 0.7, V.hullG); V.hull = this._src(T.hull, V.hullHP);
    // ── the suit ──
    V.breathG = this._g(0, suitGate); V.breathBP = this._f("bandpass", 900, 1.1, this._f("lowpass", 3000, 0.7, V.breathG)); P1.connect(V.breathBP);
    V.fanG = this._g(0, suitGate); V.fanBP = this._f("bandpass", 700, 0.9, V.fanG); P2.connect(V.fanBP); this._o("sine", 190, this._g(0.12, V.fanG));
    V.drillG = this._g(0, suitGate); const dLP = this._f("lowpass", 2400, 0.7, V.drillG);
    V.drill = this._o("sawtooth", 80, this._g(0.45, dLP)); V.drillBP = this._f("bandpass", 1700, 2.5, this._g(0.9, dLP)); W1.connect(V.drillBP);
    V.scanG = this._g(0, suitGate); V.scan = this._o("sine", 1200, V.scanG);
    // ── positional sources (into the outside group) ──
    const Q = this.pos = { con: [], devil: [], rover: null };
    for (let i = 0; i < 2; i++) {
      const pan = this._panner(8, 1, outLP), lp = this._f("lowpass", 2000, 0.7, pan), g = this._g(0, lp), src = this._src(T.machine, g);
      src.playbackRate.value = i ? 0.93 : 1; Q.con.push({ pan, lp, g });
    }
    for (let i = 0; i < 2; i++) {
      const pan = this._panner(12, 1, outLP), lp = this._f("lowpass", 2000, 0.7, pan), g = this._g(0, lp), bp = this._f("bandpass", 300, 1.4, g);
      (i ? P2 : P1).connect(bp); Q.devil.push({ pan, lp, g, bp });
    }
    { const pan = this._panner(3, 1.4, outLP), lp = this._f("lowpass", 2000, 0.7, pan), g = this._g(0, lp);
      this._o(humWave, 96, this._g(0.5, g)); B2.connect(this._f("bandpass", 380, 1, g)); Q.rover = { pan, lp, g }; }
    // ── the score ──
    const M = this.mus = { voices: [], nextChord: 0, nextBell: 0, ci: 0, dark: false, first: true };
    const hall = this._conv(T.irHall, this._g(0.9, music));
    M.out = this._g(0, music, this._g(0.7, hall));
    M.lp = this._f("lowpass", 1200, 0.6, M.out);
    this._o("sine", 0.023, this._g(350, M.lp.frequency));
    [-0.6, -0.2, 0.2, 0.6].forEach((p) => {
      const pan = this._n(c.createStereoPanner()); pan.pan.value = p; pan.connect(M.lp);
      const g = this._g(0.11, pan), a = this._o("triangle", 147, g), b = this._o("sawtooth", 147, this._g(0.22, g));
      M.voices.push({ a, b });
    });
    M.bellG = this._g(0, M.out, this._g(0.5, hall));
    M.car = this._o("sine", 880, M.bellG); M.mod = this._o("sine", 2640, M.modG = this._g(0, M.car.frequency));
    const dly = this._n(c.createDelay(1.5)); dly.delayTime.value = 0.62;
    const fb = this._g(0.36, this._f("lowpass", 2400, 0.7, dly)); dly.connect(fb); dly.connect(this._g(0.5, M.out));
    M.bellG.connect(dly);
    this.applyVolumes();
    this._prebake();
  }
  /** Bake the event sounds in idle time, so none is baked in the middle of a frame when it is first needed. */
  _prebake() {
    const q = Object.keys(ONE), sched = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 40));
    const step = (dl) => {
      if (!this.ctx) return;
      let n = 0;
      while (q.length && (n === 0 || (dl && dl.timeRemaining && dl.timeRemaining() > 6))) { try { this._buf(q.shift()); } catch (e) { console.warn("[audio] bake", e); } n++; }
      if (q.length) sched(step);
    };
    sched(step);
  }

  /** An AudioBuffer for a one-shot, baked on first use. */
  _buf(name) {
    if (this._bufs[name]) return this._bufs[name];
    const f = ONE[name];
    if (!f) return null;
    return (this._bufs[name] = this._buffer(f(this.ctx.sampleRate, rng(1000 + name.length * 7 + name.charCodeAt(0)))));
  }
  /** Play a one-shot into a bus or group node. o: {gain, rate, delay}. */
  play(name, dest, o = {}) {
    const c = this.ctx;
    if (!c || c.state === "closed") return null;
    if (typeof dest === "string") dest = this.bus[dest] || this.grp[dest];
    if (!dest) return null;
    if (this.live >= MAX_ONESHOTS) { this.dropped++; return null; }
    const buf = this._buf(name);
    if (!buf) return null;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; if (o.rate) src.playbackRate.value = o.rate;
    g.gain.value = o.gain ?? 1;
    src.connect(g); g.connect(dest);
    this.live++; this.total++;
    src.onended = () => { this.live--; try { g.disconnect(); } catch { /* gone */ } };
    src.start(c.currentTime + (o.delay || 0));
    return src;
  }
  /** Rate limit by key (real milliseconds). */
  ok(key, ms) { const t = performance.now(); if (t - (this._rl[key] || -1e9) < ms) return false; this._rl[key] = t; return true; }
  count(name) { this.counts[name] = (this.counts[name] || 0) + 1; }
  /** Event sounds are not wanted while a game loads or replays its missions. */
  get eventsOk() { const g = this.game; return !!this.ctx && g.ready && g.mode !== "title" && g.mode !== "loading" && performance.now() > this.quietUntil; }
  fx(name, dest, o) { this.count(name); this._lastFx = performance.now(); if (this.ctx) this.play(name, dest, o); }
  ui(name, o) { this.count(name); if (this.ctx) this.play(name, this.bus.ui, o); }
  radio(level) {
    if (!this.eventsOk || !this.ok("radio", 3000)) return;
    if (level === "danger") this.fx("caution", "comms");
    else { this.fx("quindarIn", "comms"); this.play("quindarOut", "comms", { delay: 1.7 }); }
  }

  /* ── events ── */

  wire() {
    const g = this.game, on = (name, fn) => g.on(name, (d) => { try { if (this.eventsOk) fn(d || {}); } catch (e) { console.warn("[audio]", name, e); } });
    on("eva:exit", () => this.fx("hatch", "suitIn"));
    on("eva:enter", () => this.fx("hatch", "suitIn", { rate: 0.94 }));
    on("eva:hop", () => { this._bp = 0.02; this._huff = 0.2; this.fx("scuff", "suitIn", { gain: 0.7 }); });
    on("eva:land", (d) => { this._bp = 0.42; this._huff = 0.45; if (this.ok("land", 150)) this.fx("land", "suitIn", { gain: 0.35 + 0.65 * clamp((d.impact || 0) / 4.5, 0, 1) }); });
    on("eva:fall", () => { this.fx("impact", "suitIn", { gain: 0.6, rate: 1.3 }); this.play("suitAlarm", "comms", { delay: 0.35 }); });
    on("eva:sample", () => this.fx("sampleDone", "suitIn"));
    on("eva:deposit", () => this.fx("tube", "suitIn"));
    on("eva:plant", (d) => this.fx(d.what === "beacon" ? "beacon" : "flag", "suitIn"));
    on("eva:scan", () => this.fx("scanDone", "suitIn", { gain: 0.8 }));
    on("eva:refill", () => this.fx("relay", "suitIn", { gain: 0.6 }));
    on("mission:start", () => this.radio("info"));
    on("mission:objective", () => { if (this.ok("objective", 400)) this.ui("objective"); });
    on("mission:freeplay", () => this.ui("objective"));
    on("mission:complete", () => this.ui("complete"));
    on("complete", () => this.ui("complete"));
    on("hazard", (h) => { if (h.level === "warn" || h.level === "danger") this.radio(h.level); });
    on("recover", () => { this.fx("servo", "cabIn"); this.play("thumpHard", "cabIn", { delay: 0.4, gain: 0.8 }); });
    // progression (another work package): subscribe to what it may emit; nothing happens if it never does
    for (const ev of ["upgrade:bought", "upgrade:buy", "workshop:buy", "progression:unlock", "progression:upgrade"]) on(ev, () => this.ui("purchase"));
    // mute: N, in any mode, never while typing
    window.addEventListener("keydown", (e) => {
      if (e.code !== MUTE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      this.toggleMute(); e.preventDefault();
    });
    // the interface: clicks, hovers, slider ticks (delegated, so buttons added later by anyone are covered)
    const pick = (e, sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
    document.addEventListener("click", (e) => { const el = pick(e, "button, [role=button], select, input[type=checkbox], .site, .b-card"); if (el && !el.disabled && this.ok("click", 30)) this.ui("click"); }, true);
    document.addEventListener("pointerover", (e) => { const el = pick(e, "button, [role=button], .b-card, .site"); if (el && el !== this._hoverEl && !el.disabled) { this._hoverEl = el; if (this.ok("hover", 40)) this.ui("hover", { gain: 0.6 }); } else if (!el) this._hoverEl = null; }, true);
    document.addEventListener("focusin", (e) => { const el = pick(e, "button, select, input"); if (el && el !== this._hoverEl && this.ok("hover", 40)) { this._hoverEl = el; this.ui("hover", { gain: 0.5 }); } }, true);
    document.addEventListener("input", (e) => { if (e.target && e.target.type === "range" && this.ok("tick", 50)) this.ui("tick"); }, true);
    // start on the first gesture; suspend while the tab is hidden (nothing would ramp the voices down)
    const unlock = () => { if (this.start() && this.ctx && this.ctx.state === "running") for (const t of ["pointerdown", "keydown", "touchend", "mousedown"]) window.removeEventListener(t, unlock, true); };
    for (const t of ["pointerdown", "keydown", "touchend", "mousedown"]) window.addEventListener(t, unlock, true);
    const P = window.GeoIDPad;
    if (P && P.on) for (const b of ["cross", "circle", "options", "square", "triangle"]) P.on(b, () => { if (!this.ctx || this.ctx.state !== "running") unlock(); });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      try { const p = document.hidden ? this.ctx.suspend() : this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* closed */ }
    });
  }
  /** Hooks into other systems, made on the first frame (they exist by then). Every one is optional. */
  hook() {
    if (this._hooked) return;
    this._hooked = true;
    const g = this.game, self = this;
    const h = g.hud;
    if (h && typeof h.toast === "function" && !h.toast.__snd) {
      const orig = h.toast, w = function (...a) { const r = orig.apply(this, a); try { self._toast(); } catch { /* never into the HUD */ } return r; };
      w.__snd = true; h.toast = w;
    }
    const A = getSystem("avatar");
    if (A && A.avatar) {
      const av = this._av = A.avatar;
      this._full = typeof av._fullSuit === "function" ? av._fullSuit() : { o2: 0.6, power: 3.6e6 };
      if (typeof av._footfall === "function" && !av._footfall.__snd) {
        const orig = av._footfall, w = function (...a) { const r = orig.apply(this, a); try { self._step(); } catch { /* never into the walker */ } return r; };
        w.__snd = true; av._footfall = w;
      }
    }
    const E = getSystem("eva"); this._eva = E || null;
    const B = getSystem("base");
    if (B && B.api && B.api.on) {
      this._base = B;
      B.api.on("placed", () => { if (this.eventsOk) this.fx("place", "world"); });
      B.api.on("built", (m) => { if (this.eventsOk && this.ok("built", 250)) this.fx("built", "world", { gain: this._near(m, 0.35) }); });
      B.api.on("salvaged", () => { if (this.eventsOk) this.fx("salvage", "world"); });
    }
    const BU = getSystem("builder");
    if (BU && BU.ui && typeof BU.ui.flash === "function" && !BU.ui.flash.__snd) {
      const orig = BU.ui.flash, w = function (...a) { const r = orig.apply(this, a); try { if (self.eventsOk && self.ok("refuse", 300)) self.ui("refuse"); } catch { /* never into the UI */ } return r; };
      w.__snd = true; BU.ui.flash = w;
    }
  }
  _near(p, floor) {
    const cam = this.game.camera.position, d = p && Number.isFinite(p.x) ? Math.hypot(p.x - cam.x, p.z - cam.z) : 0;
    return Math.max(floor, 1 / (1 + d / 60));
  }
  _toast() {
    if (!this.ctx || !this.game.ready) return;
    const t = performance.now();
    if (t - (this._lastFx || -1e9) < 350 || t - (this._lastToast || -1e9) < 900) return;       // the event already made its own sound
    this._lastToast = t; this.ui("toast", { gain: 0.8 });
  }
  /** A footfall from the walker's animation: through the boots, by what is underfoot. */
  _step() {
    if (!this.ctx || this.where !== "suit" || !this._av) return;
    this.count("step");
    if (!this.ok("step", 110)) return;
    const av = this._av, sp = av.t.speed || 0, sand = av.t.sand || 0, reg = this.game.surface.regolith(av.p.x, av.p.z, this._reg || (this._reg = {}));
    const kind = sand > 0.55 ? "sand" : (reg.rock || 0) > 0.45 || (reg.rough || 0) > 0.6 ? "rock" : "firm";
    const gain = (0.4 + 0.6 * clamp(sp / 3.5, 0, 1)) * (av.crouch ? 0.6 : 1) * (av.t.stance === "SPRINT" ? 1.15 : 1);
    this.play(`step_${kind}${Math.floor(Math.random() * 3)}`, this.grp.suitIn, { gain, rate: 0.92 + Math.random() * 0.16 });
  }

  /* ── every frame ── */

  frame(dt) {
    this.hook();
    if (!this.ctx || this.ctx.state === "closed") return;
    const t0 = performance.now(), g = this.game, mode = g.mode;
    if (mode === "driving") this.where = "cab";
    else if (mode === "build") this.where = "build";
    else if (mode === "onfoot") this.where = this._av && this._av.inside ? "hab" : "suit";
    else if (mode === "title" || mode === "loading") this.where = "none";
    const where = this.where, W = WHERE[where], live = g.live, d = dt > 0 ? dt : 0;
    this.applyVolumes();
    this.set(this.bus.world.gain, where === "none" ? 0 : live ? 1 : 0.16, 0.12);
    this.set(this.bus.worldLP.frequency, live ? 18000 : 650, 0.1);
    this.set(this.grp.cabGate.gain, W.cab, 0.15); this.set(this.grp.suitGate.gain, W.suit, 0.15);
    this.set(this.grp.outLP.frequency, W.outLP, 0.2); this.set(this.grp.outG.gain, W.outG, 0.2);
    this._listener();
    this._rover(d, where, live);
    this._weather(d, W, where, live);
    this._suit(d, where, live);
    this._positional(where, live);
    this._music();
    this.set(this.telG.gain, this._telem && where !== "none" ? 0.14 : 0, 0.6);
    this.levels.telemetry = this._telem ? 1 : 0;
    const ms = performance.now() - t0, M = this._ms;
    M.avg += (ms - M.avg) * (M.n < 20 ? 1 / (M.n + 1) : 0.05); M.n++;
    M.win = Math.max(M.win * 0.995, ms); M.max = Math.max(M.max, ms);
  }

  _listener() {
    const L = this.ctx.listener, cam = this.game.camera, p = cam.position, q = cam.quaternion;
    // forward = (0, 0, -1) and up = (0, 1, 0) rotated by the camera's quaternion
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y));
    const ux = 2 * (x * y - w * z), uy = 1 - 2 * (x * x + z * z), uz = 2 * (y * z + w * x);
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  _rover(dt, where, live) {
    const g = this.game, v = g.vehicle, V = this.v, L = this.levels;
    if (!v || !v.t) return;
    const t = v.t, def = v.def || {}, n = v.wheels.length, moving = g.mode === "driving" && !g.paused;
    const sp = moving ? Math.abs(t.speed || 0) : 0;
    let contact = 0, sand = 0, slipX = 0;
    for (const w of v.wheels) if (w.contact) { contact++; sand += w.sand || 0; slipX += Math.max(0, (w.slip || 0) - 0.95); }
    const cf = contact / n; sand = contact ? sand / contact : 0;
    const reg = g.surface.regolith(v.p.x, v.p.z, this._rreg || (this._rreg = {})), rock = reg.rock || 0, rough = reg.rough || 0;
    const eff = (def.power && def.power.driveEfficiency) || 0.45, stall = (def.drive && def.drive.stallForce) || 9500;
    const torque = moving && !v.flat ? clamp((t.drive_W || 0) * eff / Math.max(0.5, sp) / stall, 0, 1.6) : 0;
    if (dt > 0) this._torque += (torque - this._torque) * (1 - Math.exp(-dt * 8)); else if (!moving) this._torque = 0;
    const grind = moving && contact ? clamp(slipX / contact * 1.6 + (t.slipping ? 0.4 : 0), 0, 1) * cf : 0;
    const spin = sp + grind * 3, tq = this._torque;
    L.speed = sp; L.torque = tq;
    L.motorHz = 26 + 40 * spin;
    L.motor = v.flat ? 0 : clamp(0.1 + 0.9 * Math.min(1, tq), 0, 1) * smooth(0.03, 0.6, spin + tq * 0.5);
    L.inverter = v.flat ? 0 : clamp(tq, 0, 1.2) * (0.35 + 0.65 * smooth(0, 4, spin));
    L.inverterHz = 820 + 150 * spin + 120 * tq;
    L.gear = smooth(0.1, 3, sp) * (0.4 + 0.6 * Math.min(1, sp / 8));
    L.idle = v.flat ? 0.25 : 1;
    const roll = cf * smooth(0.05, 2, sp) * (0.3 + 0.7 * Math.min(1, sp / 8));
    L.roll = roll; L.sand = roll * sand; L.firm = roll * (1 - sand) * (1 - 0.6 * rock); L.rock = roll * (1 - sand * 0.7) * clamp(rock * 0.9 + rough * 0.5, 0, 1);
    L.grind = grind;
    // suspension: load changes per wheel; a sharp one is a thump, the rest is a rumble
    const st = (def.mass || 3200) * 3.71 / n;
    let jolt = 0, big = 0, landed = 0;
    const jumped = this._pp && Math.hypot(v.p.x - this._pp[0], v.p.z - this._pp[1]) > 20;
    if (!this._loads || jumped || !moving) { this._loads = v.wheels.map((w) => w.load || 0); this._contact = v.wheels.map((w) => !!w.contact); this._air = v.wheels.map(() => 0); }
    else if (dt > 0) {
      v.wheels.forEach((w, i) => {
        const dl = ((w.load || 0) - this._loads[i]) / st; jolt += Math.abs(dl); if (dl > big) big = dl;
        if (w.contact && !this._contact[i] && this._air[i] > 0.2) landed = Math.max(landed, this._air[i]);
        this._air[i] = w.contact ? 0 : this._air[i] + dt;
        this._loads[i] = w.load || 0; this._contact[i] = !!w.contact;
      });
    }
    if (dt > 0) this._suspE += (clamp(jolt / dt / 60 * 0.5, 0, 1.5) - this._suspE) * (1 - Math.exp(-dt * 10));
    L.susp = moving ? clamp(this._suspE, 0, 1) : 0;
    // impacts: the body's velocity changing faster than driving can
    let impact = 0;
    if (this._pv && dt > 0 && moving && !jumped) { const a = Math.hypot(v.v.x - this._pv[0], v.v.y - this._pv[1], v.v.z - this._pv[2]) / dt; if (a > 28) impact = clamp((a - 28) / 70, 0.2, 1); }
    this._pv = [v.v.x, v.v.y, v.v.z]; this._pp = [v.p.x, v.p.z];
    const evOk = this.eventsOk && live && where === "cab";
    if (evOk) {
      if (impact && this.ok("impact", 350)) { this.fx("impact", "cabIn", { gain: 0.3 + 0.7 * impact }); this._rl.thump = performance.now(); }
      else if (landed && this.ok("thump", 120)) this.fx("thumpHard", "cabIn", { gain: clamp(0.4 + landed, 0.4, 1) });
      else if (big > 0.55 && this.ok("thump", 75)) this.fx(big > 1.2 ? "thumpHard" : "thump", "cabIn", { gain: clamp((big - 0.55) / 1.5, 0.15, 1), rate: 0.9 + Math.random() * 0.2 });
    }
    // switches and warnings
    const edge = (key, val, fn) => { const was = this[key]; this[key] = val; if (was !== null && was !== val && this.eventsOk) fn(val, was); };
    edge("_lights", !!v.headlights, () => this.fx("relay", "cabIn"));
    edge("_rig", g.rig ? g.rig.mode : null, () => this.fx("servo", "cabIn", { gain: 0.6 }));
    edge("_warp", !!g.warp, (on) => this.ui(on ? "warpOn" : "warpOff"));
    edge("_hon", !!(g.state && g.state.view && g.state.view.honesty), () => this.ui("click"));
    edge("_tipped", !!t.tipped, (on) => { if (on) { this.fx("impact", "cabIn"); this.fx("caution", "comms"); } });
    edge("_flat", !!v.flat, (on) => { if (on) this.fx("powerdown", "comms"); });
    const frac = v.batteryFraction;
    if (Number.isFinite(frac)) {
      if (!this._bat) this._bat = { 0.2: frac < 0.2, 0.1: frac < 0.1, 0.05: frac < 0.05 };     // a game loaded low is not an alarm
      for (const th of [0.2, 0.1, 0.05]) {
        if (frac < th && !this._bat[th]) { this._bat[th] = true; if (this.eventsOk) this.fx("alert", "comms"); }
        else if (frac > th + 0.03) this._bat[th] = false;
      }
    }
    // the voices
    const s = this.set.bind(this);
    s(V.motorG.gain, LV.motor * L.motor); s(V.motor.frequency, L.motorHz, 0.06);
    s(V.invG.gain, LV.inverter * L.inverter); s(V.inv.frequency, L.inverterHz, 0.06);
    s(V.gearG.gain, LV.gear * L.gear); s(V.gear.frequency, L.motorHz * 3.5, 0.06);
    s(V.idleG.gain, LV.idle * L.idle, 0.3);
    s(V.sandG.gain, LV.sand * L.sand, 0.08); s(V.sandLP.frequency, 900 + 220 * sp, 0.1);
    s(V.firmG.gain, LV.firm * L.firm, 0.08); s(V.firm.playbackRate, 0.55 + 0.11 * sp, 0.1);
    s(V.rockG.gain, LV.rock * L.rock, 0.08); s(V.rock.playbackRate, 0.6 + 0.1 * sp, 0.1);
    s(V.suspG.gain, LV.susp * L.susp, 0.05);
    s(V.grindG.gain, LV.grind * grind, 0.06); s(V.grindBP.frequency, 260 + 200 * sand + 30 * spin, 0.08); s(V.grindLFO.frequency, 14 + 6 * spin, 0.1);
  }

  _weather(dt, Wh, where, live) {
    let W = Wh;
    const g = this.game, e = g.env, V = this.v, L = this.levels, D = this.debugEnv;
    const wind = e && e.wind;
    let wvx = 1.2, wvz = 0.5;
    if (wind && wind.vec) { const sp = wind.speed_ms || 0, k = sp > 0.1 ? (wind.now_ms ?? sp) / sp : 1; wvx = wind.vec[0] * k; wvz = wind.vec[1] * k; }
    let bx = 0, bz = 0;
    if (where === "cab" && g.vehicle && g.mode === "driving" && live) { bx = g.vehicle.v.x; bz = g.vehicle.v.z; }
    else if (where === "suit" && this._av && this._av.vel) { bx = this._av.vel.x; bz = this._av.vel.z; }
    let air = Math.hypot(wvx - bx, wvz - bz);
    const s = e && e.dust && e.dust.storm;
    let storm = 0;
    if (s) {
      const k = { local: 0.5, regional: 0.85, global: 1 }[s.kind] || 0.7;
      storm = k * (s.phase === "peak" ? 1 : s.phase === "approaching" ? 0.35 * clamp(1 - (s.eta_s || 0) / 7398, 0, 1) : 0.55);
    }
    const lifting = !!(e && e.dust && e.dust.lifting);
    if (lifting && e && Number.isFinite(e.visibility_m)) storm = Math.max(storm, 0.8 * clamp(1 - Math.log(Math.max(40, e.visibility_m) / 40) / Math.log(125), 0, 1));
    if (D) { if (Number.isFinite(D.wind)) air = D.wind; if (Number.isFinite(D.storm)) storm = D.storm; }
    if (live) this._bt += dt;
    const b = this._bt, buffet = clamp(0.75 + 0.25 * Math.sin(b * 1.7) * Math.sin(b * 0.63 + 1) + 0.18 * Math.sin(b * 3.1 + 2) * Math.sin(b * 0.37), 0.35, 1.3);
    L.air = air; L.wind = clamp(Math.pow(air / 18, 1.4), 0, 1.3); L.storm = storm;
    L.hull = clamp(storm * 0.9 + (lifting ? 0.25 * clamp(air / 20, 0, 1) : 0), 0, 1);
    if (this._telem) { W = WHERE.none; L.wind = 0; L.hull = 0; }
    this.set(V.windG.gain, LV.wind * W.windG * L.wind * buffet, 0.12);
    this.set(V.windLP.frequency, W.windLP[0] + W.windLP[1] * air + 60 * storm, 0.2);
    this.set(V.stormG.gain, LV.storm * W.stormG * Math.pow(storm, 1.2) * (0.8 + 0.2 * buffet), 0.4);
    this.set(V.hullG.gain, LV.hull * W.hullG * L.hull, 0.25); this.set(V.hullHP.frequency, W.hullHP, 0.2);
    this.set(V.hull.playbackRate, 0.8 + 0.4 * clamp(air / 25, 0, 1), 0.3);
  }

  _suit(dt, where, live) {
    const V = this.v, L = this.levels, av = this._av, on = where === "suit" && av && av.onFoot && !av.inside;
    if (!on) {
      for (const k of ["breathG", "fanG", "drillG", "scanG"]) this.set(V[k].gain, 0, 0.1);
      L.breath = 0; L.breathDepth = 0; L.heart = 0; L.fan = 0; L.drill = 0; L.scan = 0;
      return;
    }
    const M = av.t.M || 115;
    if (dt > 0) this._M += (M - this._M) * (1 - Math.exp(-dt / (M > this._M ? 2.5 : 9)));        // breath follows effort, and recovers slowly
    const exert = clamp((this._M - 115) / 600, 0, 1.3);
    L.M = this._M; L.exertion = exert;
    L.breathRate = 11 + 22 * exert;
    if (live) this._bp = (this._bp + dt * L.breathRate / 60) % 1;
    this._huff = Math.max(0, this._huff - dt * 0.8);
    const p = this._bp;
    let env = 0, inhale = false;
    if (p < 0.36) { env = Math.pow(Math.sin(Math.PI * p / 0.36), 1.6) * 0.75; inhale = true; }
    else if (p > 0.42 && p < 0.97) { const x = (p - 0.42) / 0.55; env = Math.pow(Math.sin(Math.PI * x), 1.2) * (1 - 0.2 * x); }
    const depth = 0.4 + 0.6 * Math.min(1, exert) + this._huff;
    L.breath = live && !this._telem ? env * depth : 0; L.breathDepth = depth;
    this.set(V.breathG.gain, LV.breath * L.breath, 0.03);
    this.set(V.breathBP.frequency, inhale ? 1350 + 500 * exert : 650 + 250 * exert, 0.05);
    // the heart, when the oxygen or the battery is low
    const s = av.suit || {}, full = this._full || { o2: 0.6, power: 3.6e6 };
    const o2f = (s.o2 ?? full.o2) / full.o2, pwf = (s.power ?? full.power) / full.power;
    const low = Math.max(1 - smooth(0.06, 0.25, o2f), 1 - smooth(0.06, 0.25, pwf), av.emergency ? 1 : 0);
    L.heart = low; L.heartRate = low > 0.02 ? 68 + 55 * low + 25 * Math.min(1, exert) : 0;
    if (low > 0.02 && live && dt > 0 && !this._telem) {
      this._hp += dt * L.heartRate / 60;
      if (this._hp >= 1) { this._hp %= 1; this.count("heart"); if (this.ok("heart", 300)) this.play("heart", this.grp.suitIn, { gain: 0.3 + 0.7 * low }); }
    }
    // fans: they stop when the suit's battery is flat (the silence is the warning)
    const powered = (s.power ?? 1) > 0;
    L.fan = powered ? 0.75 + 0.25 * clamp(((av.t.power_W || 60) - 60) / 200, 0, 1) : 0;
    this.set(V.fanG.gain, LV.fan * L.fan, 0.3); this.set(V.fanBP.frequency, 620 + 0.6 * (av.t.power_W || 60), 0.5);
    if (av.emergency && live && this.eventsOk && this.ok("suitAlarm", 2600)) this.fx("suitAlarm", "comms", { gain: 0.8 });
    // the tools
    const pose = av.pose, k = pose ? clamp(pose.k || 0, 0, 1) : 0, now = this.ctx.currentTime;
    L.drill = pose && pose.kind === "drill" && live ? 1 : 0;
    L.scan = pose && pose.kind === "scan" && live ? 1 : 0;
    this.set(V.drillG.gain, LV.drill * L.drill, L.drill ? 0.08 : 0.15);
    if (L.drill) { this.set(V.drill.frequency, 70 + 110 * Math.min(1, k * 4) + (Math.random() - 0.5) * 8, 0.04); this.set(V.drillBP.frequency, 1400 + 500 * Math.sin(now * 13), 0.04); }
    this.set(V.scanG.gain, LV.scan * L.scan, 0.05);
    if (L.scan) this.set(V.scan.frequency, 1100 + 900 * (0.5 - 0.5 * Math.cos(TAU * k * 2)), 0.03);
    // the helmet lamp's switch
    const was = this._lamp; this._lamp = !!av.light;
    if (was !== null && was !== this._lamp && this.eventsOk) this.fx("relay", "suitIn", { gain: 0.7 });
  }

  _positional(where, live) {
    const g = this.game, P = this.pos, cam = g.camera.position, L = this.levels, s = this.set.bind(this);
    const place = (q, x, y, z, gain) => {
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      if (q.pan.positionX) { s(q.pan.positionX, x, 0.05); s(q.pan.positionY, y, 0.05); s(q.pan.positionZ, z, 0.05); } else q.pan.setPosition(x, y, z);
      s(q.lp.frequency, martianLP(d), 0.1); s(q.g.gain, gain, 0.2);
      return d;
    };
    // construction crews: the two nearest sites being built
    const t = performance.now();
    if (!this._sitesAt || t - this._sitesAt > 400) {
      this._sitesAt = t; const out = [], B = this._base;
      if (B && B.net && B.net.modules && B.worldOf) {
        for (const m of B.net.modules.values()) {
          if (!(m.progress < 1) || m.queued) continue;
          try { const w = B.worldOf(m); out.push({ id: m.id, x: w.x, y: (w.y || 0) + 1.5, z: w.z, d: Math.hypot(w.x - cam.x, w.z - cam.z) }); } catch { /* a module without a base yet */ }
        }
      }
      this._sites = out.sort((a, b) => a.d - b.d).slice(0, 2);
    }
    for (let i = 0; i < 2; i++) {
      const site = live && this._sites[i];
      if (site) { place(P.con[i], site.x, site.y, site.z, LV.con); L.construction[i] = 1; } else { s(P.con[i].g.gain, 0, 0.3); L.construction[i] = 0; }
    }
    // dust devils: the two nearest
    const devils = (g.env && g.env.dust && g.env.dust.devils) || [];
    let a = null, b = null, da = 1e9, db = 1e9;
    for (const dv of devils) { const d = Math.hypot(dv.x - cam.x, dv.z - cam.z); if (d < da) { b = a; db = da; a = dv; da = d; } else if (d < db) { b = dv; db = d; } }
    const now = this.ctx.currentTime;
    [a, b].forEach((dv, i) => {
      const q = P.devil[i];
      if (dv && live && where !== "none" && !this._telem) {
        const y = g.surface.height(dv.x, dv.z) + Math.min(8, (dv.height_m || 40) * 0.05), gain = LV.devil * clamp((dv.radius_m || 6) / 8, 0.3, 1.2);
        place(q, dv.x, y, dv.z, gain); s(q.bp.frequency, 240 + 160 * Math.sin(now * 0.9 + i * 2) + 60 * Math.sin(now * 2.3), 0.1);
        L.devils[i] = gain;
      } else { s(q.g.gain, 0, 0.4); L.devils[i] = 0; }
    });
    // the parked rover, heard from outside on foot (faintly: thin air)
    const v = g.vehicle;
    if (where === "suit" && live && v) { place(P.rover, v.p.x, v.p.y + 0.5, v.p.z, LV.rover * (v.flat ? 0.3 : 1)); L.rover = 1; }
    else { s(P.rover.g.gain, 0, 0.3); L.rover = 0; }
  }

  _music() {
    const c = this.ctx, M = this.mus, now = c.currentTime, on = this.s.music > 0.001 && !this.s.muted && this.where !== "none" && !this._telem;
    this.set(M.out.gain, on ? 1 : 0, 1.5);
    this.levels.music = on ? 1 : 0;
    if (!on) return;
    const sky = this.game.sky, sinEl = sky && sky.sun ? sky.sun.sinEl : 0.5, day = smooth(-0.12, 0.3, sinEl), storm = this.levels.storm || 0, dark = storm > 0.45;
    if (now >= M.nextChord || dark !== M.dark) {
      const set = dark ? DARK : BRIGHT;
      M.ci = dark !== M.dark ? 0 : (M.ci + 1 + Math.floor(Math.random() * (set.length - 1))) % set.length;
      M.dark = dark;
      const ch = set[M.ci % set.length];
      M.voices.forEach((vo, i) => {
        const f = hz(ch[i]);
        if (M.first) { vo.a.frequency.setValueAtTime(f, now); vo.b.frequency.setValueAtTime(f * 1.004, now); }
        else { vo.a.frequency.setTargetAtTime(f, now, 3); vo.b.frequency.setTargetAtTime(f * 1.004, now, 3); }
      });
      M.first = false; M.nextChord = now + 26 + Math.random() * 18;
      if (!M.nextBell) M.nextBell = now + 4;
    }
    this.set(M.lp.frequency, (500 + 1000 * day) * (1 - 0.45 * storm), 2);
    if (now >= M.nextBell) {
      const sc = dark ? SCALE_DARK : SCALE_BRIGHT, note = sc[Math.floor(Math.random() * sc.length)] + (day > 0.4 ? 12 : 0), f = hz(note), t = now + 0.05;
      M.car.frequency.setValueAtTime(f, t); M.mod.frequency.setValueAtTime(f * 3.01, t);
      M.modG.gain.cancelScheduledValues(t); M.modG.gain.setValueAtTime(f * 1.4, t); M.modG.gain.setTargetAtTime(f * 0.08, t, 0.35);
      M.bellG.gain.cancelScheduledValues(t); M.bellG.gain.setValueAtTime(0.0001, t); M.bellG.gain.linearRampToValueAtTime(0.14, t + 0.012); M.bellG.gain.setTargetAtTime(0, t + 0.02, 1.1);
      M.nextBell = now + (7 + Math.random() * 10) * (1 + 1.5 * storm);
      this.count("bell");
    }
  }

  /* ── voices: the story's lines ── */

  /**
   * Play one line. src: a URL (WAV / OGG, decoded once and cached) or an AudioBuffer.
   * o: { preset, gain, pan, glitch (0..1, on top of any preset), delay, speaker, text, duration, seed, onend(handle) }
   * Returns a handle { id, playing, duration, done (a Promise), stop(), glitch(intensity, seconds) }.
   * Emits "voice:start" and "voice:end" on the game with {id, speaker, text, preset} (the subtitles listen).
   * Without Web Audio the events still come, timed from the clip or the text, so the story keeps moving.
   */
  voice(src, o = {}) {
    const g = this.game, preset = VOICE_PRESETS.includes(o.preset) ? o.preset : "helmet";
    const h = { id: ++this._vid, preset, speaker: o.speaker || null, text: o.text || null, playing: false, stopped: false, ended: false, duration: 0, error: null };
    let resolve; h.done = new Promise((r) => { resolve = r; });
    const info = () => ({ id: h.id, speaker: h.speaker, text: h.text, preset, duration: h.duration });
    let chain = null, source = null;
    const finish = (stopped) => {
      if (h.ended) return;
      h.ended = true; h.playing = false; h.stopped = h.stopped || !!stopped;
      this._voices.delete(h); this._duck();
      if (chain) { const ch = chain; setTimeout(() => { for (const n of ch.sources) { try { n.stop(); } catch { /* not started */ } } for (const n of ch.nodes) { try { n.disconnect(); } catch { /* gone */ } } }, 60); }
      try { g.emit("voice:end", Object.assign(info(), { stopped: h.stopped })); } catch (e) { console.warn("[audio] voice:end listener", e); }
      try { if (o.onend) o.onend(h); } catch (e) { console.warn("[audio] onend", e); }
      resolve(h);
    };
    h.stop = () => { if (h.ended) return; h.stopped = true; if (source) { try { source.stop(); } catch { /* not started */ } } if (h._timer) clearTimeout(h._timer); finish(true); };
    h.glitch = (intensity = 0.5, seconds = 1) => { if (chain) this._glitchLine(chain, intensity, seconds); };
    const begin = (buf) => {
      if (h.stopped || h.ended) return finish(true);
      const c = this.ctx;
      const gl = preset === "corrupted" ? Math.max(0.85, o.glitch || 0) : preset === "glitch" ? (o.glitch ?? 0.55) : clamp(o.glitch || 0, 0, 1);
      const b = gl > 0 ? this._corrupt(buf, gl, o.seed ?? h.id) : buf;
      chain = this._vchain(preset, o);
      source = c.createBufferSource(); source.buffer = b; source.connect(chain.input);
      source.onended = () => finish(h.stopped);
      h.duration = b.duration; h.playing = true; h.buffer = b;
      this._voices.add(h); this._duck();
      const t = c.currentTime + (o.delay || 0);
      source.start(t); for (const n of chain.sources) n.start(t);
      if (preset === "corrupted") this._glitchLine(chain, 0.45, b.duration, t);
      this.count("voice");
      try { g.emit("voice:start", info()); } catch (e) { console.warn("[audio] voice:start listener", e); }
    };
    if (!this.ctx) this.start();
    if (!this.ctx) {
      // no audio: keep the story's clock
      const dur = o.duration || (src && src.duration) || Math.max(1.2, 0.065 * String(o.text || "").length);
      h.duration = dur; h.playing = true; this._voices.add(h);
      try { g.emit("voice:start", info()); } catch (e) { console.warn("[audio] voice:start listener", e); }
      h._timer = setTimeout(() => finish(false), dur * 1000);
      return h;
    }
    if (src && typeof src !== "string" && typeof src.getChannelData === "function") { try { begin(src); } catch (e) { h.error = String(e.message || e); finish(true); } }
    else this._load(String(src)).then(begin).catch((e) => { h.error = String((e && e.message) || e); console.warn("[audio] voice", src, h.error); finish(true); });
    return h;
  }
  stopVoices() { for (const h of [...this._voices]) h.stop(); this.voiceQueue.clear(); }
  _load(url) {
    if (!this.ctx) this.start();
    if (!this.ctx) return Promise.reject(new Error("no audio"));
    if (!this._vcache.has(url)) {
      const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + " " + url); return r.arrayBuffer(); })
        .then((a) => new Promise((ok, bad) => { const q = this.ctx.decodeAudioData(a, ok, bad); if (q && q.then) q.then(ok, bad); }));
      p.catch(() => this._vcache.delete(url));
      this._vcache.set(url, p);
    }
    return this._vcache.get(url);
  }
  _duck() {
    if (!this.ctx) return;
    const on = this._voices.size > 0;
    this.set(this.bus.duckFx.gain, on ? DUCK : 1, on ? 0.12 : 0.45); this.set(this.bus.duckMus.gain, on ? DUCK : 1, on ? 0.12 : 0.45);
  }
  _softCurve(drive) {
    const key = "s" + drive;
    if (!this._curves[key]) { const n = 1024, cv = new Float32Array(n), k = Math.tanh(drive); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(drive * x) / k; } this._curves[key] = cv; }
    return this._curves[key];
  }
  _crushCurve(steps) {
    const n = 2048, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.round(x * steps) / steps; }
    return cv;
  }
  /** The processing chain of one line: input -> preset -> out (+ a crusher path for live glitches) -> pan -> the voice bus. Built per line, freed at its end. */
  _vchain(preset, o) {
    const c = this.ctx, nodes = [], sources = [], mk = (n) => (nodes.push(n), n);
    const G = (v) => { const g = mk(c.createGain()); g.gain.value = v; return g; };
    const F = (type, f, Q = 0.7, gain = 0) => { const b = mk(c.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; return b; };
    const S = (drive) => { const w = mk(c.createWaveShaper()); w.curve = this._softCurve(drive); w.oversample = "2x"; return w; };
    const chain = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
    const input = G(1), gain = clamp(o.gain ?? 1, 0, 4), out = G(gain), crushG = G(0), pan = mk(c.createStereoPanner());
    pan.pan.value = clamp(o.pan || 0, -1, 1); out.connect(pan); crushG.connect(pan); pan.connect(this.bus.voice);
    let x = input;
    if (preset === "helmet" || preset === "glitch") {           // the player: close microphone, a little of the cab / helmet room
      x = chain(input, F("highpass", 90), F("peaking", 3000, 1, 3));
      x.connect(G(0.16)).connect(this.vx.room);
    } else if (preset === "grille") {                            // construction units: a small speaker behind a grille
      x = chain(input, F("highpass", 300), F("highpass", 300), F("peaking", 1800, 2, 5), S(2.5), F("lowpass", 3400), F("lowpass", 3400));
    } else if (preset === "memory") {                            // flashbacks: warm, soft top, a lush room, a slow wow
      const dl = mk(c.createDelay(0.1)); dl.delayTime.value = 0.014;
      const lfo = mk(c.createOscillator()); lfo.frequency.value = 0.55; lfo.connect(G(0.0016)).connect(dl.delayTime); sources.push(lfo);
      const lfo2 = mk(c.createOscillator()); lfo2.frequency.value = 0.13; lfo2.connect(G(0.0012)).connect(dl.delayTime); sources.push(lfo2);
      x = chain(input, F("lowshelf", 220, 0.7, 3), F("lowpass", 3200), dl);
      x.connect(G(0.55)).connect(this.vx.hall);
    } else if (preset === "broadcast") {                         // an old TV advert: squeezed, band-limited, hiss under it
      const comp = mk(c.createDynamicsCompressor()); comp.threshold.value = -32; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.15; comp.knee.value = 4;
      x = chain(input, F("highpass", 250), F("lowpass", 4200), comp, S(1.6), F("peaking", 1500, 1, 3), G(1.6));
      const hiss = mk(c.createBufferSource()); hiss.buffer = this._tex.white; hiss.loop = true; chain(hiss, F("highpass", 3500), G(0.012), out); sources.push(hiss);
    } else if (preset === "dry") {                               // KEEPER: no room at all, a faint comb that makes it slightly synthetic
      const hp = F("highpass", 110), sum = G(1), d = mk(c.createDelay(0.05)); d.delayTime.value = 0.0045;
      hp.connect(sum); hp.connect(d); d.connect(G(0.35)).connect(sum); d.connect(G(0.3)).connect(d);
      input.connect(hp); x = chain(sum, F("peaking", 2200, 1.2, 2));
    } else if (preset === "corrupted") {                         // the Pioneer-3 mainframe: the buffer itself is cut up (see _corrupt)
      x = chain(input, F("highpass", 180), F("lowpass", 5200), S(1.8));
    }
    // "live": real people, no processing at all
    x.connect(out);
    const cr = mk(c.createWaveShaper()); cr.curve = this._crushCurve(4); x.connect(cr); cr.connect(crushG);
    return { input, out, crushG, gain, nodes, sources };
  }
  /** Live dropouts and crusher bursts on one line (scheduled now, never per frame). */
  _glitchLine(ch, intensity, seconds, at) {
    if (!this.ctx) return;
    const i = clamp(intensity, 0, 1), t0 = Math.max(this.ctx.currentTime, at || 0) + 0.01, end = t0 + Math.max(0.05, seconds), r = Math.random, og = ch.out.gain, cg = ch.crushG.gain;
    let t = t0;
    while (t < end) {
      t += (0.06 + r() * 0.5) * (1.3 - i);
      if (t >= end) break;
      const d = Math.min(end - t, (0.03 + r() * 0.12) * (0.5 + i));
      if (r() < 0.5) { og.setValueAtTime(0, t); og.setValueAtTime(ch.gain, t + d); }
      else { og.setValueAtTime(0, t); cg.setValueAtTime(ch.gain * 0.7, t); og.setValueAtTime(ch.gain, t + d); cg.setValueAtTime(0, t + d); }
      t += d;
    }
  }
  /**
   * Cut a line up the way a failing machine would: stutters (a 40 to 140 ms fragment repeated), skips, loop-backs,
   * dropouts and bit-crushed stretches, more of each with intensity (0..1). Deterministic per seed. Returns a new buffer.
   */
  _corrupt(buf, intensity, seed) {
    const P = clamp(intensity, 0, 1), sr = buf.sampleRate, n = buf.length, chs = buf.numberOfChannels, r = rng((seed | 0) * 7919 + 13);
    const ms = (a, b) => Math.max(1, Math.round((a + r() * (b - a)) * sr / 1000));
    const segs = []; let pos = 0, outLen = 0, guard = 0;
    const cap = n * 1.8 + sr;
    while (pos < n && outLen < cap && guard++ < 20000) {
      const k = r();
      if (k < 0.22 * P) { const f = Math.min(n, ms(40, 140)), reps = 2 + Math.floor(r() * 3 + P * 2), from = Math.max(0, Math.min(pos, n - f)); for (let j = 0; j < reps; j++) segs.push([from, f, 0]); outLen += f * reps; pos = from + f; }
      else if (k < 0.36 * P) pos += Math.round(ms(50, 250) * (0.5 + P));
      else if (k < 0.47 * P) { const d = ms(30, 120); segs.push([-1, d, 0]); outLen += d; }
      else if (k < 0.62 * P) { const l = Math.min(n - pos, ms(60, 260)); segs.push([pos, l, 1, 3 + Math.floor(r() * 3), 3 + Math.floor(r() * 10)]); outLen += l; pos += l; }
      else if (k < 0.67 * P && pos > sr * 0.3) pos = Math.max(0, pos - ms(100, 300));
      else { const l = Math.min(n - pos, Math.round(ms(80, 400) * (1.4 - P * 0.6))); segs.push([pos, l, 0]); outLen += l; pos += l; }
    }
    const out = this.ctx.createBuffer(chs, Math.max(1, outLen), sr), fade = Math.round(sr * 0.001);
    for (let ch = 0; ch < chs; ch++) {
      const a = buf.getChannelData(ch), o = out.getChannelData(ch);
      let w = 0;
      for (const [from, len, kind, bits, hold] of segs) {
        for (let i = 0; i < len && w < o.length; i++, w++) {
          if (from < 0) { o[w] = 0; continue; }
          let v;
          if (kind === 1) { const q = Math.pow(2, bits - 1); v = Math.round(a[Math.min(n - 1, from + Math.floor(i / hold) * hold)] * q) / q; }
          else v = a[Math.min(n - 1, from + i)];
          o[w] = v * Math.min(1, i / fade, (len - i) / fade);
        }
      }
    }
    return out;
  }
  /**
   * The perception filter cracking: briefly corrupt ALL audio (dropouts, stutters of the last fragment, crusher bursts).
   * intensity 0..1, seconds. Scheduled on the audio clock at once. Emits "audio:glitch".
   */
  filterGlitch(intensity = 0.5, seconds = 1) {
    const i = clamp(+intensity || 0, 0, 1), secs = clamp(+seconds || 0, 0.05, 30);
    this.count("filterGlitch");
    try { this.game.emit("audio:glitch", { intensity: i, seconds: secs }); } catch { /* a listener */ }
    if (!this.ctx) return false;
    const c = this.ctx, Gl = this.gl, r = Math.random, t0 = c.currentTime + 0.01, end = t0 + secs;
    const P = [Gl.dry.gain, Gl.wet.gain, Gl.fb.gain, Gl.inp.gain, Gl.crush.gain];
    for (const p of P) { p.cancelScheduledValues(t0); }
    const at = (p, v, t) => p.setValueAtTime(v, t);
    const normal = (t) => { at(Gl.dry.gain, 1, t); at(Gl.wet.gain, 0, t); at(Gl.fb.gain, 0, t); at(Gl.inp.gain, 1, t); at(Gl.crush.gain, 0, t); };
    normal(t0);
    let t = t0, events = 0;
    while (t < end) {
      t += (0.03 + r() * 0.22) * (1.25 - i);
      if (t >= end) break;
      const d = Math.min(end - t, (0.03 + r() * 0.17) * (0.5 + i)), k = r();
      if (k < 0.4) at(Gl.dry.gain, 0, t);                                                        // dropout
      else if (k < 0.8) { Gl.delay.delayTime.setValueAtTime(0.04 + r() * 0.1, t); at(Gl.inp.gain, 0, t); at(Gl.fb.gain, 0.97, t); at(Gl.wet.gain, 1, t); at(Gl.dry.gain, 0, t); }   // stutter: loop the last fragment
      else { at(Gl.dry.gain, 0, t); at(Gl.crush.gain, 0.8, t); }                                 // crusher burst
      normal(t + d); t += d; events++;
    }
    normal(end);
    this._glitchUntil = performance.now() + secs * 1000;
    return events;
  }
  /** Telemetry mode (the Fugitive ending): the ambience is stripped to a mechanical hum. */
  telemetry(on) {
    this._telem = !!on;
    try { this.game.emit("audio:telemetry", { on: this._telem }); } catch { /* a listener */ }
    return this._telem;
  }

  /* ── tests and the report ── */

  rms(an) {
    if (!an) return 0;
    const b = this._rmsBuf || (this._rmsBuf = new Float32Array(2048));
    an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    return Math.sqrt(s / b.length);
  }
  stats() {
    const c = this.ctx, B = this.bus;
    return {
      available: this.available, started: !!c, state: c ? c.state : "none", error: this.error, where: this.where,
      muted: !!this.s.muted, volumes: Object.assign({}, this.s), key: "N",
      levels: JSON.parse(JSON.stringify(this.levels)),
      rms: c ? { master: this.rms(this.an.master), sfx: this.rms(this.an.sfx), music: this.rms(this.an.music), ui: this.rms(this.an.ui), voice: this.rms(this.an.voice) } : null,
      gains: c ? { master: B.master.gain.value, mute: B.mute.gain.value, sfx: B.sfx.gain.value, music: B.music.gain.value, ui: B.ui.gain.value, voice: B.voice.gain.value, world: B.world.gain.value,
        duckFx: B.duckFx.gain.value, duckMus: B.duckMus.gain.value, glDry: this.gl.dry.gain.value } : null,
      nodes: this.nodes, oneShots: { live: this.live, total: this.total, dropped: this.dropped, baked: Object.keys(this._bufs).length },
      counts: Object.assign({}, this.counts), frameMs: { avg: this._ms.avg, recentMax: this._ms.win, max: this._ms.max },
      sites: (this._sites || []).map((s) => s.id),
      voice: { speaking: this._voices.size, queued: this.voiceQueue.length, duck: c ? B.duckFx.gain.value : 1, telemetry: this._telem, glitching: performance.now() < (this._glitchUntil || 0) },
    };
  }
  _syncUi() {
    const m = document.getElementById("set-audio-mute"); if (m) m.checked = !!this.s.muted;
    for (const k of ["master", "sfx", "music", "voice", "ui"]) { const el = document.getElementById("set-audio-" + k), lab = document.getElementById("set-audio-" + k + "-val"); if (el) el.value = Math.round(this.s[k] * 100); if (lab) lab.textContent = Math.round(this.s[k] * 100) + "%"; }
  }
}

/**
 * Sequential lines: voiceQueue.push(line, ...) where line = { src | url | buffer, preset, gain, pan, speaker, text, gap (s, default 0.25), onend }.
 * push() returns a Promise that resolves when the last of those lines has finished (or was cleared). clear() stops and empties; skip() ends the current line.
 */
function makeQueue(snd) {
  const items = [];
  let current = null, timer = 0;
  const pump = () => {
    if (current || !items.length) return;
    const it = items.shift();
    current = snd.voice(it.src ?? it.url ?? it.buffer, it);
    current.done.then(() => { current = null; it._resolve(); timer = setTimeout(pump, Math.max(0, it.gap ?? 0.25) * 1000); });
  };
  return {
    push(...lines) {
      const ps = lines.flat().map((l) => new Promise((ok) => { items.push(Object.assign({}, l, { _resolve: ok })); }));
      pump();
      return Promise.all(ps).then(() => undefined);
    },
    clear() { clearTimeout(timer); while (items.length) items.shift()._resolve(); if (current) current.stop(); },
    skip() { if (current) current.stop(); },
    get length() { return items.length; },
    get busy() { return !!current || items.length > 0; },
    get current() { return current; },
  };
}

/** The "Sound" section of the Settings screen, injected beside the others (as wheelfx.js adds "Dust effects"). */
function addSettings(game, snd) {
  if (document.getElementById("set-audio-master")) return;
  const done = document.getElementById("btn-settings-close");
  const host = done ? done.parentElement : document.querySelector("#screen-settings .col");
  if (!host) return;
  const frag = document.createDocumentFragment(), s = snd.s;
  const head = document.createElement("div");
  head.className = "eyebrow"; head.id = "set-audio"; head.textContent = "Sound"; head.style.marginTop = "0.35rem";
  frag.appendChild(head);
  const rows = [["master", "Master volume"], ["sfx", "Effects (rover, suit, world)"], ["music", "Ambient music"], ["voice", "Voices (story)"], ["ui", "Interface"]];
  for (const [k, text] of rows) {
    const lab = document.createElement("label");
    lab.className = "field";
    lab.innerHTML = text + ' <b id="set-audio-' + k + '-val"></b><input type="range" id="set-audio-' + k + '" min="0" max="100" step="5">';
    frag.appendChild(lab);
    const input = lab.querySelector("input");
    let timer = 0;
    const apply = (save) => { s[k] = clamp(+input.value / 100, 0, 1); snd.applyVolumes(); snd._syncUi(); clearTimeout(timer); if (save) game.applySettings(); else timer = setTimeout(() => game.applySettings(), 300); };
    input.addEventListener("input", () => apply(false));
    input.addEventListener("change", () => apply(true));
  }
  const mute = document.createElement("label");
  mute.className = "field check";
  mute.innerHTML = '<input type="checkbox" id="set-audio-mute"> Mute all sound (N)';
  mute.querySelector("input").addEventListener("change", (e) => snd.mute(e.target.checked));
  frag.appendChild(mute);
  if (!snd.available) {
    const p = document.createElement("p");
    p.className = "fine"; p.id = "set-audio-none";
    p.textContent = "This browser gives the page no Web Audio: the game is silent. The settings are kept.";
    frag.appendChild(p);
  }
  if (done) host.insertBefore(frag, done); else host.appendChild(frag);
  snd._syncUi();
}

/**
 * Sound has to exist before the game boots (the title screen's clicks, its Settings, the first gesture), but systems
 * are initialised only at boot. So it attaches itself to the Game as soon as boot.js has made one (window.__mars).
 */
function attach(game) {
  if (game.audio instanceof Sound) return game.audio;
  const snd = new Sound(game);
  game.audio = snd;
  snd.wire();
  try { addSettings(game, snd); } catch (e) { console.warn("[audio] settings", e); }
  return snd;
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  let tries = 0;
  const look = () => { const g = window.__mars && window.__mars.game; if (g && g.settings) { try { attach(g); } catch (e) { console.warn("[audio] attach", e); } } else if (tries++ < 400) setTimeout(look, 25); };
  setTimeout(look, 0);
}

registerSystem({
  id: "audio",
  order: 5,
  snd: null,
  get api() { return this.snd ? this.snd.api : null; },
  init(game) { this.snd = attach(game); },
  load() { if (this.snd) { this.snd.quietUntil = performance.now() + 1200; this.snd._reset(); } },
  onMode(game, mode, prev) { if (this.snd && (prev === "loading" || prev === "title")) this.snd.quietUntil = performance.now() + 1200; if (this.snd && mode !== prev && (mode === "driving" || prev === "driving")) { this.snd._loads = null; this.snd._pv = null; } },
  frame(game, dt) { if (this.snd) this.snd.frame(dt); },
  dispose() { if (this.snd && this.snd.ctx) { try { this.snd.ctx.close(); } catch { /* closed */ } } this.snd = null; },
});
