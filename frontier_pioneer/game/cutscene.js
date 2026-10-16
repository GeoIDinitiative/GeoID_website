/**
 * CUTSCENES: story/cutscenes.json (C01 to C20, timed beats) played on the
 * story layer of the interface (uistory.js: letterbox, subtitles, cards,
 * stills, choices, the perception filter), the voice bus (audio.js), and the
 * game's own camera.
 *
 *   const cs = new Cutscenes(game, story);
 *   await cs.play("C01")      -> { id, skipped, choices: { choice_id: option id } }
 *   cs.skip(); cs.active; cs.frame(dt)   // frame(): the camera intents, after the rig has run (systems' frame)
 *
 * BEATS. line (a voiced line: the speech queue in storydata.js), direction (a stage direction, shown small
 * at the top: the illustrated path reads as a radio play with pictures), still (a 2D panel: a line-art
 * illustration composed from the panel's brief, in the skin's colours, with the brief as its caption),
 * camera (an intent for the game camera: orbit, dolly, crane, look_at, static, pov, edge (out over a drop), around a resolved
 * target), title (act cards through ui.card; HUD, stencil, plaque, telemetry, archive and epilogue
 * cards here; "[engine]" titles are computed by the story), glitch (ui.glitch + audio filterGlitch, and
 * the caretakers drop the filter for a frame), fade, sfx and music (logged; the score is generative),
 * choice (ui.choose: the option's `set` is written, then its own beats play), set (a story variable).
 * `parallel` beats do not wait; `if` conditions use the story's variables.
 *
 * SKIPPING (hold Circle or Esc, uistory.js) stops the voices and the subtitles at once, writes every
 * `set` still to come, and still asks every choice still to come (a choice is never skipped: the
 * endings depend on them), without its lines.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { loadStory, speech, evalCond, esc, hash, ensureStoryStyles } from "./storydata.js?v=b8cfe8e-efa5b7b7";

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const ease = (k) => k * k * (3 - 2 * k);
const PACE = 0.85;          // stage directions and titles: a little quicker than their duration hints

/* ── the illustrated path: line-art panels composed from the brief ───────── */

function tokens() {
  const cs = getComputedStyle(document.documentElement), v = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
  const rgb = (n, d) => `rgb(${v(n, d)})`;
  return { chrome: v("--skin-chrome", "#ff2bd6"), data: v("--skin-data", "#00e5ff"), ink: v("--skin-ink", "#fdf7ff"), bg: v("--skin-bg", "#0d0221"),
    panel: rgb("--skin-panel", "31, 14, 69"), vig: rgb("--skin-vignette", "13, 2, 33"), muted: rgb("--skin-muted", "226, 214, 255"), warn: v("--c-interp", "#ffb826") };
}
/** A still as an SVG data URL: sky, horizon and a few line-art figures chosen by the words in the brief. */
export function stillSVG(brief, seed = 1) {
  const T = tokens(), b = String(brief || "").toLowerCase(), r = (() => { let a = (hash(brief) ^ seed) >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const on = (re) => re.test(b);
  const night = on(/night|star|dark|black|lantern|lit |glow/), dusk = on(/dawn|dusk|evening|sunset|sunrise|morning/);
  const interior = on(/inside|interior|room|kitchen|corridor|bedroom|hospital|bay|module|cramped|garage|tube|cave|hideout|school/);
  const out = [];
  const W = 1600, H = 900, hz = interior ? 640 : 560;
  out.push(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.vig}"/><stop offset="1" stop-color="${night ? T.panel : dusk ? T.warn : T.panel}" stop-opacity="${night ? 1 : 0.55}"/></linearGradient>
    <radialGradient id="g"><stop offset="0" stop-color="${T.warn}" stop-opacity="0.9"/><stop offset="1" stop-color="${T.warn}" stop-opacity="0"/></radialGradient></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#s)"/>`);
  if (night || on(/sky|stars|halo|station/)) for (let i = 0; i < 140; i++) out.push(`<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * hz * 0.95).toFixed(0)}" r="${(0.6 + r() * 1.6).toFixed(1)}" fill="${T.ink}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`);
  if (on(/twelve|string of|chain|equator/)) for (let i = 0; i < 12; i++) out.push(`<circle cx="${200 + i * 100}" cy="${170 + Math.sin(i / 11 * Math.PI) * -40}" r="4" fill="${T.data}"/>`);
  if (on(/streak|falling|flare|burn|shooting|meteor|braking/)) { const x = 1000 + r() * 300; out.push(`<line x1="${x}" y1="60" x2="${x - 260}" y2="360" stroke="${T.warn}" stroke-width="5" stroke-linecap="round"/><circle cx="${x - 260}" cy="360" r="40" fill="url(#g)"/>`); }
  if (on(/earth|blue (dot|star)|evening star/)) out.push(`<circle cx="1240" cy="200" r="7" fill="${T.data}"/><circle cx="1240" cy="200" r="22" fill="none" stroke="${T.data}" stroke-opacity="0.4"/>`);
  if (interior) {
    // a room in one-point perspective
    out.push(`<g fill="none" stroke="${T.chrome}" stroke-width="2" opacity="0.8"><rect x="520" y="240" width="560" height="330"/><line x1="0" y1="0" x2="520" y2="240"/><line x1="${W}" y1="0" x2="1080" y2="240"/><line x1="0" y1="${H}" x2="520" y2="570"/><line x1="${W}" y1="${H}" x2="1080" y2="570"/></g>`);
    if (on(/porthole|window|glass/)) out.push(`<circle cx="800" cy="380" r="90" fill="${T.vig}" stroke="${T.data}" stroke-width="3"/>`);
    if (on(/helmet/)) for (let i = 0; i < 7; i++) out.push(`<circle cx="${580 + i * 74}" cy="300" r="28" fill="none" stroke="${T.ink}" stroke-width="2"/><rect x="${562 + i * 74}" y="292" width="36" height="12" fill="${T.data}" opacity="0.5"/>`);
    if (on(/drawing|red planet|crayon/)) out.push(`<rect x="1120" y="300" width="170" height="220" fill="${T.ink}" opacity="0.9" transform="rotate(4 1205 410)"/><circle cx="1205" cy="440" r="55" fill="${T.chrome}" opacity="0.85"/>`);
  } else {
    // ground, a crater rim on the horizon
    let d = `M0 ${hz}`; for (let x = 0; x <= W; x += 80) d += ` L${x} ${hz - 18 - Math.sin(x / 260 + r() * 0.4) * 22 - (r() * 10)}`; d += ` L${W} ${H} L0 ${H} Z`;
    out.push(`<path d="${d}" fill="${T.vig}" stroke="${T.chrome}" stroke-width="2"/>`);
    for (let i = 0; i < 6; i++) { const y = hz + 40 + i * 50; out.push(`<line x1="${200 - i * 40}" y1="${y}" x2="${1400 + i * 40}" y2="${y}" stroke="${T.chrome}" stroke-opacity="${(0.25 - i * 0.03).toFixed(2)}" stroke-width="1"/>`); }
    if (on(/dome|city|cities|lantern/)) for (let i = 0; i < (on(/city|cities/) ? 7 : 1); i++) { const x = 380 + i * 150 + (i % 2) * 40, rr = on(/city|cities/) ? 60 + r() * 50 : 180; out.push(`<path d="M${x - rr} ${hz} A${rr} ${rr} 0 0 1 ${x + rr} ${hz}" fill="${night ? T.warn : "none"}" fill-opacity="${night ? 0.18 : 0}" stroke="${T.data}" stroke-width="2.5"/>`); }
    if (on(/lander|pod|capsule|cone/)) out.push(`<g transform="translate(560 ${hz - 10}) rotate(${on(/tip|tilt/) ? -34 : 0})" fill="${T.panel}" stroke="${T.ink}" stroke-width="3"><path d="M-70 0 L-45 -130 L45 -130 L70 0 Z"/><path d="M-45 -130 L0 -175 L45 -130 Z"/><line x1="-70" y1="0" x2="-110" y2="40"/><line x1="70" y1="0" x2="110" y2="40"/></g>`);
    if (on(/machine|unit|yellow|robot|construction/)) out.push(`<g transform="translate(1020 ${hz + 30})" fill="${T.warn}" fill-opacity="0.85" stroke="${T.ink}" stroke-width="3"><rect x="-70" y="-110" width="140" height="90"/><rect x="-56" y="-142" width="112" height="22" fill="${T.vig}"/><rect x="-80" y="-20" width="160" height="26" fill="${T.vig}"/><line x1="70" y1="-80" x2="130" y2="-40"/></g>`);
    if (on(/rover/)) out.push(`<g transform="translate(1180 ${hz + 20})" fill="${T.panel}" stroke="${T.ink}" stroke-width="3"><rect x="-110" y="-70" width="220" height="60"/><circle cx="-80" cy="0" r="22"/><circle cx="0" cy="0" r="22"/><circle cx="80" cy="0" r="22"/></g>`);
    if (on(/beach|tide|sea|wave|lake|water/)) for (let i = 0; i < 5; i++) out.push(`<path d="M0 ${hz + 60 + i * 34} Q400 ${hz + 40 + i * 34} 800 ${hz + 60 + i * 34} T1600 ${hz + 60 + i * 34}" fill="none" stroke="${T.data}" stroke-opacity="0.5" stroke-width="2"/>`);
  }
  if (on(/figure|suited|man |woman|pioneer|silhouette|astronaut|girl|child|he |she /)) {
    const x = interior ? 800 : 740, y = interior ? 600 : hz + 10;
    out.push(`<g transform="translate(${x} ${y})" fill="${T.vig}" stroke="${T.ink}" stroke-width="3"><circle cx="0" cy="-150" r="26"/><rect x="-30" y="-122" width="60" height="80"/><line x1="-14" y1="-42" x2="-18" y2="0"/><line x1="14" y1="-42" x2="18" y2="0"/></g>`);
    if (on(/girl|child|daughter|two figures|two of them|woman/)) out.push(`<g transform="translate(${x + 120} ${y})" fill="${T.vig}" stroke="${T.ink}" stroke-width="3"><circle cx="0" cy="-104" r="18"/><rect x="-20" y="-86" width="40" height="52"/><line x1="-8" y1="-34" x2="-10" y2="0"/><line x1="8" y1="-34" x2="10" y2="0"/></g>`);
  }
  if (on(/hands/)) out.push(`<g fill="${T.panel}" stroke="${T.ink}" stroke-width="3"><path d="M560 900 L600 620 L700 600 L720 900 Z"/><path d="M1040 900 L1000 620 L900 600 L880 900 Z"/></g>`);
  out.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="${T.chrome}" stroke-opacity="0.35" stroke-width="2"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${out.join("")}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/* ── the player ─────────────────────────────────────────────────────────── */

export class Cutscenes {
  constructor(game, story) {
    this.game = game; this.story = story; this.cur = null; this.cam = null; this.queue = Promise.resolve();
    ensureStoryStyles();
    const root = document.getElementById("story") || document.body;
    this.dirEl = document.createElement("div"); this.dirEl.className = "cs-dir"; this.dirEl.hidden = true;
    this.titleEl = document.createElement("div"); this.titleEl.className = "cs-title"; this.titleEl.hidden = true;
    root.appendChild(this.dirEl); root.appendChild(this.titleEl);
  }
  get active() { return !!this.cur; }
  get ui() { return this.game.hud.ui; }

  /** Queue a cutscene (one plays at a time). */
  play(id, o = {}) { const p = this.queue.then(() => this._play(id, o)); this.queue = p.catch(() => {}); return p; }
  skip() { const u = this.ui; if (this.cur && u && u.cutscene && u.cutscene.active) u.cutscene.skip(); else if (this.cur) this._onSkip(); }
  _onSkip() {
    const c = this.cur; if (!c || c.skipped) return;
    c.skipped = true; speech(this.game).clear();
    for (const r of c.wakers) r(); c.wakers.clear();
  }
  _wait(sec) {
    const c = this.cur; if (!c || c.skipped || !(sec > 0)) return Promise.resolve();
    const s = this.game.headless && c.fast ? Math.min(sec, 0.05) : sec;
    return new Promise((res) => { const t = setTimeout(() => { c.wakers.delete(w); res(); }, s * 1000); const w = () => { clearTimeout(t); res(); }; c.wakers.add(w); });
  }

  async _play(id, o = {}) {
    const D = await loadStory(), cs = D.cutscene(id), g = this.game, ui = this.ui;
    if (!cs) { console.warn("[cutscene] no such cutscene", id); return { id, skipped: true, missing: true }; }
    const c = this.cur = { id, cs, skipped: false, wakers: new Set(), choices: {}, fast: !!o.fast, t0: performance.now(), fov: g.camera.fov };
    speech(g).clear();                   // the cutscene speaks next: gameplay lines still queued are dropped
    g.emit("cutscene:start", { id, title: cs.title });
    this.story.notify("cutscene_start", { id });
    if (ui && ui.cutscene) ui.cutscene.start({ letterbox: true, skippable: o.skippable !== false, onSkip: () => this._onSkip() });
    const beats = cs.beats || [];
    let i = 0;
    try {
      for (; i < beats.length && !c.skipped; i++) await this._beat(beats[i], beats, i, c);
    } catch (e) { console.error("[cutscene]", id, e); }
    // skipped: write every `set` still to come, and still ask every choice (without its lines)
    if (c.skipped) {
      const rest = beats.slice(i);
      for (const b of rest) if (b.kind === "set") this.story.setVar(b.var, b.value);
      if (ui && ui.cutscene && ui.cutscene.active) ui.cutscene.end();
      for (const b of rest) if (b.kind === "choice") await this._choice(b, c, true);
    }
    // close: whatever was on screen goes, the camera is the game's again
    this.dirEl.hidden = true; this.titleEl.hidden = true; this.cam = null;
    if (g.camera.fov !== c.fov) { g.camera.fov = c.fov; g.camera.updateProjectionMatrix(); }
    if (ui) { if (ui.fadeTo) await ui.fadeTo(false, c.skipped ? 0.3 : 0.8); if (ui.cutscene && ui.cutscene.active) ui.cutscene.end(); }
    const st = document.querySelector("#story .st-fade"); if (st) st.classList.remove("cs-white");
    this.cur = null;
    const res = { id, skipped: c.skipped, choices: c.choices, seconds: (performance.now() - c.t0) / 1000 };
    g.emit("cutscene:end", res);
    return res;
  }

  _vars() { return this.story.vars(); }
  async _beat(b, beats, i, c) {
    const g = this.game, ui = this.ui, sp = speech(g);
    if (b.if && !evalCond(b.if, this._vars())) return;
    const par = !!b.parallel, dur = (b.duration_hint || 0) * PACE;
    switch (b.kind) {
      case "line": {
        const p = sp.say(b, { preset: b.preset });
        if (!par) { await p; await this._wait(0.15); }
        return;
      }
      case "direction": {
        let t = String(b.text || "");
        const m = t.match(/^\[if ([^\]]+)\]\s*/); if (m) { const cond = m[1].replace(/\bin \(([^)]*)\)/g, "in [$1]"); if (!evalCond(cond, this._vars())) return; t = t.slice(m[0].length); }
        t = t.replace(/\[if ([^\]]+)\]\s*/g, "");
        this.dirEl.textContent = t; this.dirEl.hidden = false;
        if (!par) await this._wait(Math.max(1.6, dur));
        return;
      }
      case "still": {
        // the game's own picture wins: when a camera beat at the same moment frames something real (the pod, the lander, a unit), no panel
        const cam = beats.find((x) => x.kind === "camera" && Math.abs((x.t || 0) - (b.t || 0)) < 0.05);
        if (cam && this.story.resolveTarget((cam.camera || {}).target || (cam.camera || {}).to || "", cam.camera || {}).world) return;
        // until the next still or camera beat, a few seconds at most
        let span = 5;
        for (let k = i + 1; k < beats.length; k++) if (beats[k].kind === "still" || beats[k].kind === "camera") { span = Math.max(2.4, Math.min(6, (beats[k].t || 0) - (b.t || 0))); break; }
        if (ui && ui.still) ui.still({ src: stillSVG(b.panel, hash(c.id)), caption: b.panel, seconds: this.game.headless && c.fast ? 0.1 : span, pan: ["right", "in", "left", "out"][hash(b.panel) % 4] });
        return;
      }
      case "camera": this._camera(b.camera || {}); return;
      case "title": {
        const text = String(b.text || "").startsWith("[engine]") ? this.story.engineText(c.id, b) : b.text;
        if (b.style === "act" && ui && ui.card) {
          const [eyebrow, title] = String(text).split(/\s*·\s*/);
          this.story.markActCard(eyebrow);
          const p = ui.card({ eyebrow, title: title || "", seconds: Math.max(2.5, dur || 3) });
          if (!par) await Promise.race([p, this._wait(Math.max(2.5, dur || 3) + 0.2)]);
          return;
        }
        this.titleEl.className = "cs-title cs-" + (b.style || "hud");
        this.titleEl.innerHTML = String(text).split("\n").map((l) => `<span>${esc(l)}</span>`).join("");
        this.titleEl.hidden = false;
        const mine = this.titleEl.innerHTML, hide = () => { if (this.titleEl.innerHTML === mine) this.titleEl.hidden = true; };
        if (!par) { await this._wait(Math.max(1.2, (b.duration_hint || 1.5))); hide(); }
        else setTimeout(hide, Math.max(1200, (b.duration_hint || 1.5) * 1000));
        return;
      }
      case "glitch": {
        const k = b.intensity == null ? 0.5 : b.intensity, s = Math.max(0.15, b.duration_hint || 0.3);
        if (ui && ui.glitch) ui.glitch(k, s);
        const A = getSystem("audio"); if (A && A.api && k >= 0.2) A.api.filterGlitch(k, s);
        this.story.notify("glitch", { intensity: k, seconds: s, cutscene: c.id, unfiltered: /render|glove|hand|frame/.test(b.desc || "") });
        if (!par && s > 0.3) await this._wait(s);
        return;
      }
      case "fade": {
        const st = document.querySelector("#story .st-fade");
        if (b.to === "white" && st) st.classList.add("cs-white"); else if (st && b.to !== "white" && b.to !== "black") st.classList.remove("cs-white");
        const black = b.to === "black" || b.to === "white";
        if (ui && ui.fadeTo) { const p = ui.fadeTo(black, Math.max(0.2, b.duration_hint || 1)); if (!par) await Promise.race([p, this._wait(b.duration_hint || 1)]); }
        if (!black) { const s2 = document.querySelector("#story .st-still"); if (s2 && ui && ui.fade) ui.fade(s2, false); }
        return;
      }
      case "sfx": this._sfx(b); return;
      case "music": return;
      case "choice": await this._choice(b, c, false); return;
      case "set": this.story.setVar(b.var, b.value); return;
      default: if (!par && dur) await this._wait(dur);
    }
  }
  async _choice(b, c, quick) {
    const ui = this.ui, opts = (b.options || []).filter((o) => !o.if || evalCond(o.if, this._vars()));
    if (!opts.length) return;
    let k = ui && ui.choose ? await ui.choose({ options: opts.map((o) => o.label), prompt: b.prompt || "", style: "live" }) : 0;
    if (k < 0) k = 0;
    const o = opts[k];
    c.choices[b.choice_id] = o.id;
    this.story.setVar("choice." + b.choice_id, o.id);
    for (const [key, v] of Object.entries(o.set || {})) this.story.setVar(key, v);
    if (o.clue) this.story.clue(o.clue);
    this.story.notify("choose", { choice_id: b.choice_id, option: o.id });
    if (!quick) for (let j = 0; j < (o.then || []).length && !c.skipped; j++) await this._beat(o.then[j], o.then, j, c);
    else for (const t of o.then || []) if (t.kind === "set") this.story.setVar(t.var, t.value);
  }
  _sfx(b) {
    try {
      const A = getSystem("audio"), snd = A && A.snd;
      if (!snd || !snd.fx) return;
      const n = String(b.sfx || "") + " " + String(b.desc || "");
      if (/impact|thud|thump|tip|land|knock/.test(n)) snd.fx("impact", "world");
    } catch { /* no sound */ }
  }

  /* ── camera intents ── */
  _camera(cam) {
    const g = this.game, t = this.story.resolveTarget(cam.target || cam.to || "", cam);
    const from = g.camera.position.clone(), q0 = g.camera.quaternion.clone();
    // edge: anchored on the player where the shot starts (a cliff lip), pushing out over the drop toward the target
    const pp = this.story.playerPos ? this.story.playerPos() : null;
    this.cam = { p0: pp ? { x: pp.x, y: g.surface ? g.surface.height(pp.x, pp.z) : pp.y || 0, z: pp.z } : null, mode: cam.mode || "static", t, dur: Math.max(0.5, cam.duration_s || 4), age: 0, from, q0, radius: cam.radius_m || 9,
      a0: ((cam.from_deg ?? (hash(cam.target || "") % 360)) * Math.PI) / 180, a1: ((cam.to_deg ?? ((hash(cam.target || "") % 360) + 40)) * Math.PI) / 180, fov: cam.lens_mm ? THREE.MathUtils.clamp(2 * Math.atan(12 / cam.lens_mm) * 180 / Math.PI, 18, 80) : null };
  }
  /** After the rig: put the camera where the intent says. */
  frame(dt) {
    const C = this.cam, g = this.game;
    if (!C || !this.cur) return;
    C.age += dt || 1 / 60;
    const k = ease(Math.min(1, C.age / C.dur)), cam = g.camera, T = C.t;
    const P0 = T.at ? T.at() : T, tp = _a.set(P0.x, P0.y, P0.z);
    if (T.sky) {
      // a sky target: from where the camera is, look up along its direction
      _b.set(T.dir[0], T.dir[1], T.dir[2]).normalize().multiplyScalar(100).add(cam.position);
      _m.lookAt(cam.position, _b, cam.up); _q.setFromRotationMatrix(_m); cam.quaternion.copy(C.q0).slerp(_q, Math.min(1, C.age / 1.2));
      return;
    }
    const ground = (x, z) => (g.surface ? g.surface.height(x, z) : 0);
    let px, py, pz;
    if (C.mode === "orbit") { const a = C.a0 + (C.a1 - C.a0) * k; px = tp.x + Math.sin(a) * C.radius; pz = tp.z + Math.cos(a) * C.radius; py = Math.max(ground(px, pz) + 1.2, tp.y + 2.4); }
    else if (C.mode === "dolly") { const d = 22 - 15 * k; _b.copy(C.from).sub(tp).setY(0).normalize(); if (!isFinite(_b.x)) _b.set(0, 0, 1); px = tp.x + _b.x * d; pz = tp.z + _b.z * d; py = Math.max(ground(px, pz) + 1.4, tp.y + 1.6 + d * 0.08); }
    else if (C.mode === "crane") { const h = 2 + 40 * k, d = 10 + 30 * k; _b.copy(C.from).sub(tp).setY(0).normalize(); if (!isFinite(_b.x)) _b.set(0, 0, 1); px = tp.x + _b.x * d; pz = tp.z + _b.z * d; py = Math.max(ground(px, pz) + 1.4, tp.y + h); }
    else if (C.mode === "look_at") { px = C.from.x; py = C.from.y; pz = C.from.z; }
    else if (C.mode === "pov") { const p = this.story.playerPos(); px = p.x; pz = p.z; py = ground(px, pz) + 1.7; }
    else if (C.mode === "edge" && C.p0) {
      // from just behind the player at the lip, out over the drop and up, looking down at the target (the Olympus finale)
      // starts high and to one side behind the player (so the rover or the suit sits in the frame, not across it), ends ~90 m out
      const p = C.p0, d = -20 + 110 * k, side = 9 * (1 - k); _b.set(tp.x - p.x, 0, tp.z - p.z); if (_b.lengthSq() < 1e-6) _b.set(0, 0, -1); _b.normalize();
      px = p.x + _b.x * d - _b.z * side; pz = p.z + _b.z * d + _b.x * side; py = Math.max(ground(px, pz) + 3, p.y + 7 + 38 * k);
    }
    else { const a = C.a0, d = 14; px = tp.x + Math.sin(a) * d; pz = tp.z + Math.cos(a) * d; py = Math.max(ground(px, pz) + 1.5, tp.y + 3.5); }
    const blend = Math.min(1, C.age / 0.6);
    cam.position.set(C.from.x + (px - C.from.x) * blend, C.from.y + (py - C.from.y) * blend, C.from.z + (pz - C.from.z) * blend);
    if (C.mode === "pov" && /hand/.test(String(T.name || ""))) tp.set(px + 0.4, py - 1.2, pz - 0.6);
    _m.lookAt(cam.position, tp, cam.up); cam.quaternion.setFromRotationMatrix(_m);
    if (C.fov) { cam.fov = cam.fov + (C.fov - cam.fov) * Math.min(1, (dt || 0.016) * 3); cam.updateProjectionMatrix(); }
  }
}
